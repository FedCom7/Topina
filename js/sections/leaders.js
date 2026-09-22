/**
 * Players — chi sta facendo punti quest'anno, e chi di loro è ancora libero.
 *
 * UNA lista: tutti i giocatori NFL ordinati per punti secondo il punteggio
 * della lega, con un filtro "Available" che tiene solo chi in questo momento
 * non sta in nessuna delle quattro rose.
 *
 * Erano due liste una sopra l'altra — Season leaders e, sotto, Best Available
 * per ruolo — e dicevano due numeri diversi per lo stesso giocatore: la prima
 * i punti di Sleeper, la seconda quelli ricalcolati da un file a parte. Con il
 * filtro il liberato si legge nella stessa classifica, con lo stesso numero,
 * e si vede a che posto sta rispetto a chi e' gia' in rosa.
 *
 * I punti vengono da Sleeper (`getSeasonStats`: stagione intera, tutti i
 * giocatori, punteggio della lega). Il modello di stagione di Firebase dice
 * CHI aveva chi: "libero" vuol dire nessuna squadra nell'ultima giornata
 * archiviata — la stessa regola che usava il Best Available.
 */

import { SEASONS_DESC, CURRENT_SEASON } from '../data.js?v=594';
import { TEAMS } from './team.js?v=829';
import { pickDropdownHTML, bindPickDropdown } from '../ui/dropdown-pick.js?v=1';
import { getSeasonStats } from '../data/projections.js?v=611';
import {
    buildSeasonModel, fmt, headshotImg, posBadge,
    hydrateImages, limitedRows, toggleExtraRows, playerSeasonDrill,
} from './analysis.js?v=856';
import { getPlayerWeekly } from '../data/player-full.js?v=671';

let initialized = false;
let currentYear = CURRENT_SEASON;
// I ruoli accesi. Multi-scelta: si guarda "RB e WR" molto più spesso di un
// ruolo solo, e con un radio si sarebbe dovuto scegliere.
let attivi = new Set(['QB', 'RB', 'WR', 'TE', 'K']);
let ordine = 'total';      // 'total' | 'perGame'
let soloLiberi = false;    // filtro "Available": solo chi non e' in nessuna rosa

// DEF resta fuori: Sleeper non pubblica le fasce di punti/yard subiti che il
// nostro punteggio usa per le difese, quindi il loro totale sarebbe un numero
// inventato. I kicker invece sono coperti.
const RUOLI = ['QB', 'RB', 'WR', 'TE', 'K'];
const VISIBILI = 25;

export function initLeaders() {
    if (initialized) return;
    initialized = true;
    renderPickRow();
    bindContent();
    load();
}

function renderPickRow() {
    const box = document.getElementById('ld-pick-row');
    if (!box) return;
    const items = SEASONS_DESC.map(y => ({ value: y, label: y }));
    box.innerHTML = pickDropdownHTML('year', items, SEASONS_DESC.indexOf(String(currentYear)));
    bindPickDropdown(box, (id, value) => {
        if (id !== 'year') return;
        currentYear = value;
        renderPickRow();
        load();
    });
}

/* ============================================================
   SEASON LEADERS
   ============================================================ */

/**
 * Chi aveva questo giocatore, e in quale settimana è arrivato.
 *
 * Il nome del modello di Firebase e quello di Sleeper non coincidono sempre
 * (suffissi, punteggiatura): si confronta la forma normalizzata, la stessa che
 * usa il resto del sito.
 */
function indiceRose(model) {
    const idx = new Map();
    if (!model) return idx;
    for (const rec of model.players.values()) {
        let ultimo = null, wk = -1;
        for (const [w, dati] of Object.entries(rec.weeks)) {
            if (dati.teamKey && Number(w) > wk) { wk = Number(w); ultimo = dati.teamKey; }
        }
        // La rosa piu' recente: quella della settimana a venire se c'e' (le
        // prese dopo l'ultima giornata chiusa stanno solo li'), altrimenti
        // quella dell'ultima giocata.
        const pendenti = Object.keys(rec.pending || {}).map(Number);
        const finale = (pendenti.length ? rec.pending[Math.max(...pendenti)]?.teamKey : null)
            ?? rec.weeks[model.lastWeek]?.teamKey ?? null;
        // `nome` e' come lo scrive la lega: serve al dettaglio, che nel modello
        // cerca il giocatore per nome esatto.
        idx.set(chiave(rec.name), { nome: rec.name, ultimo, finale, settimane: Object.keys(rec.weeks).length });
    }
    return idx;
}

/*
 * Chiave di confronto fra i nomi di Sleeper e quelli della lega. Oltre a
 * punteggiatura e spazi toglie i SUFFISSI in coda (Jr, Sr, II, III, IV, V):
 * Sleeper scrive "Kenneth Walker", la lega "Kenneth Walker III", e senza
 * questo il giocatore di Sommo risultava senza squadra — niente targhetta,
 * "libero" nel filtro Available e "Unrostered" nel dettaglio.
 */
const chiave = (nome) => String(nome || '').toLowerCase().replace(/[.,']/g, '')
    .replace(/\s+(jr|sr|ii|iii|iv|v)\s*$/, '').replace(/\s+/g, ' ').trim();

/** La targhetta della squadra Topina, o niente se non l'ha mai avuto nessuno. */
function targhettaRosa(info) {
    if (!info) return '';
    // Nel colore della squadra, non nel verde/ambra generici di "titolare" e
    // "tagliato": in una lista di cento righe la squadra si riconosce dal
    // colore prima che dal nome.
    const colore = (k) => TEAMS[k]?.color ? ` style="--team-color:${TEAMS[k].color}"` : '';
    if (info.finale) return ` <span class="an-badge ld-team-badge"${colore(info.finale)}>${TEAMS[info.finale]?.name || info.finale}</span>`;
    if (info.ultimo) return ` <span class="an-badge ld-team-badge ld-team-badge--drop"${colore(info.ultimo)}>Dropped by ${TEAMS[info.ultimo]?.name || info.ultimo}</span>`;
    return '';
}

/**
 * La riga di statistiche. NON riusa `keyStatLine` di Analysis: quella legge i
 * nomi-campo di Firebase (`rec_yds`, `pass_yds`, `fg_40_49`), qui i dati sono
 * di Sleeper e i nomi sono altri (`rec_yd`, `pass_yd`, `fgm_40_49`). Passarle
 * queste stat dava zero dappertutto senza sbagliare niente, che e' il modo
 * peggiore di sbagliare.
 */
function statLine(e) {
    const r = e.raw || {};
    const n = (v) => fmt(v || 0);
    // Volume oltre ai risultati: bersagli e ricezioni per chi riceve, portate
    // per chi corre, completi su tentati per i quarterback. Senza, 90 yard da
    // 5 bersagli e 90 yard da 14 si leggevano uguali.
    switch (e.pos) {
        case 'QB': {
            const p = [`${n(r.pass_cmp)}/${n(e.passAtt)} comp`, `${n(e.passYd)} pass yds`, `${n(e.passTd)} TD`, `${n(r.pass_int)} INT`];
            if (e.rushYd) p.push(`${n(e.rushAtt)} att, ${n(e.rushYd)} rush yds`);
            return p.join(' · ');
        }
        case 'RB': {
            const p = [`${n(e.rushAtt)} att`, `${n(e.rushYd)} rush yds`, `${n(e.rushTd)} TD`];
            if (e.tgt || e.rec) p.push(`${n(e.tgt)} tgt, ${n(e.rec)} rec, ${n(e.recYd)} yds`);
            return p.join(' · ');
        }
        case 'WR':
        case 'TE': {
            const p = [`${n(e.tgt)} tgt`, `${n(e.rec)} rec`, `${n(e.recYd)} yds`, `${n(e.recTd)} TD`];
            if (e.rushAtt) p.push(`${n(e.rushAtt)} att, ${n(e.rushYd)} rush yds`);
            return p.join(' · ');
        }
        case 'K': {
            const p = [`${n(e.fgm)}/${n(r.fga)} FG`, `${n(e.xpm)} PAT`];
            if (r.fgm_50p) p.push(`${n(r.fgm_50p)} from 50+`);
            return p.join(' · ');
        }
        default: return '';
    }
}

function rigaLeader(e, i, info) {
    const rec = { name: e.name, position: e.pos, nflTeam: e.team };
    const gp = e.gp || 0;
    const avg = gp ? e.ptsLeague / gp : 0;
    // Un clic apre sotto la riga la stagione giornata per giornata — lo stesso
    // dettaglio della pagina squadra e del Best Available qui sotto. La scheda
    // completa resta raggiungibile da un link in fondo al dettaglio.
    return `
    <div class="an-player-row ld-row" data-ld-open="${i}">
        <span class="ld-rank">${i + 1}</span>
        ${headshotImg(rec)}
        <span class="an-player-name">${e.name} ${posBadge(e.pos)}${e.team ? ` <span class="ld-nfl">${e.team}</span>` : ''}${targhettaRosa(info)}</span>
        <span class="an-cell">${gp || '—'}</span>
        <span class="an-cell an-pts">${fmt(e.ptsLeague, 2)}</span>
        <span class="an-cell">${fmt(avg, 1)}</span>
        <span class="an-keystats">${statLine(e)}</span>
        <span class="an-chevron">›</span>
    </div>
    <div class="an-week-drill ld-drill" data-ld-drill="${i}" hidden></div>`;
}

/**
 * Una riga sola: le pastiglie dei ruoli e, accanto, due tendine per cosa
 * mostrare e come ordinare. Niente etichette ("Positions:", "Show:", "Sort:"):
 * le voci si spiegano da sole, e le tre etichette occupavano mezza riga.
 * Per questo le voci delle tendine dicono per intero cosa fanno — "Total
 * points", non "Total" — visto che non c'e' piu' un "Sort:" a dare contesto.
 */
function pillsRuolo() {
    // Anche il ruolo e' una tendina: una scelta sola. Prima erano pastiglie a
    // scelta multipla ("RB e WR"), ma sei pastiglie accanto a due tendine non
    // stavano su una riga.
    const ruoli = [{ value: 'all', label: 'All positions' }, ...RUOLI.map(r => ({ value: r, label: r }))];
    const ruolo = attivi.size === 1 ? [...attivi][0] : 'all';
    const mostra = [{ value: 'all', label: 'All players' }, { value: 'available', label: 'Available' }];
    const ordina = [{ value: 'total', label: 'Total points' }, { value: 'perGame', label: 'Points per game' }];
    return `
    <div class="an-controls ld-controls">
        ${pickDropdownHTML('sort', ordina, ordine === 'perGame' ? 1 : 0)}
        ${pickDropdownHTML('show', mostra, soloLiberi ? 1 : 0)}
        ${pickDropdownHTML('pos', ruoli, ruoli.findIndex(r => r.value === ruolo))}
    </div>`;
}

// Oltre il centesimo nessuno guarda, e ogni riga in piu' e' una foto da
// risolvere: la lista si ferma qui.
const MASSIMO = 100;

/** Ordina e taglia: la lista intera sono migliaia di righe, e nessuno le legge. */
/**
 * Quante partite servono per entrare nella classifica "Per Game".
 *
 * Era un 4 fisso, pensato a stagione avviata: sotto le quattro presenze una
 * media dice solo che uno ha giocato poco. Ma alla week 1 nessuno ne ha piu' di
 * una, e il filtro svuotava la lista intera — "No player matches", a qualunque
 * ruolo. La soglia ora segue la stagione: meta' delle giornate giocate finora,
 * mai sotto 1 e mai sopra 4. Alla week 1-2 basta una partita, alla 4 ne servono
 * due, dall'ottava in poi torna la regola di sempre.
 */
function minPartite(stats) {
    let max = 0;
    for (const e of stats.values()) if ((e.gp || 0) > max) max = e.gp;
    return Math.min(4, Math.max(1, Math.ceil(max / 2)));
}

function classifica(stats, roseIdx) {
    const soglia = minPartite(stats);
    const fuori = [];
    for (const e of stats.values()) {
        if (!attivi.has(e.pos)) continue;
        if (e.ptsLeague == null) continue;
        // Libero = nessuna squadra lo ha nell'ultima giornata archiviata. Chi
        // e' stato tagliato resta dentro, con la targhetta "Dropped by".
        if (soloLiberi && roseIdx.get(chiave(e.name))?.finale) continue;
        const gp = e.gp || 0;
        // Per-partita su chi ha giocato una gara sola non è una media, è un
        // caso: sotto le quattro presenze il numero dice solo che ha giocato poco.
        if (ordine === 'perGame' && gp < soglia) continue;
        fuori.push({ e, chiave: ordine === 'perGame' ? (gp ? e.ptsLeague / gp : 0) : e.ptsLeague });
    }
    fuori.sort((a, b) => b.chiave - a.chiave);
    return fuori.slice(0, MASSIMO).map(x => x.e);
}

function listaHTML(lista, roseIdx) {
    if (!lista.length) {
        return `<p class="an-footnote">${soloLiberi
            ? 'Every player matching these filters is already on a roster.'
            : 'No player matches the selected positions.'}</p>`;
    }
    const righe = lista.map((e, i) => rigaLeader(e, i, roseIdx.get(chiave(e.name))));
    return `
    <div class="an-list-head ld-head">
        <span></span><span></span><span>Player</span><span>G</span><span>Points</span><span>Avg</span><span class="an-head-stats">Stats</span><span></span>
    </div>
    ${limitedRows(righe, VISIBILI, 'leaders')}`;
}

/* ============================================================
   PAGINA
   ============================================================ */

let stato = null;   // { stats, model, roseIdx, lista }

async function load() {
    const wrap = document.getElementById('leaders-content');
    if (!wrap) return;
    wrap.innerHTML = `<div class="loading-state"><div class="spinner"></div><p>Loading players...</p></div>`;
    const anno = currentYear;

    // Le due fonti sono indipendenti: se il modello manca la lista esce lo
    // stesso, solo senza targhette di rosa.
    const [stats, model] = await Promise.all([
        getSeasonStats(anno).catch(() => null),
        buildSeasonModel(anno).catch(() => null),
    ]);
    if (String(currentYear) !== String(anno)) return;   // l'utente ha già cambiato anno

    if (!stats) {
        wrap.innerHTML = `<div class="empty-state"><p class="empty-state-text">No player stats for ${anno}</p></div>`;
        return;
    }
    stato = { stats, model, roseIdx: indiceRose(model) };
    render();
}

function render() {
    const wrap = document.getElementById('leaders-content');
    if (!wrap || !stato) return;
    const lista = classifica(stato.stats, stato.roseIdx);
    stato.lista = lista;   // il data-ld-open della riga e' l'indice qui dentro
    wrap.innerHTML = `
    ${pillsRuolo()}
    <div id="ld-list">${listaHTML(lista, stato.roseIdx)}</div>
    <p class="an-footnote">Every NFL player, scored with the league's own rules — ${lista.length} shown for the
       selected positions. The badge on the right says whether one of the four teams has him now, or had him.
       "Available" keeps only players on none of the four latest rosters on file: dropped players included,
       the most recent pickups only once the league data is updated.
       "Per Game" only ranks players with at least ${minPartite(stato.stats)} game${minPartite(stato.stats) === 1 ? '' : 's'}
       — half the weeks played so far, up to 4: below that an average says nothing.
       Defenses are missing: the source doesn't publish the points/yards-allowed brackets our scoring needs.</p>
    <p class="an-footnote ld-legend">In the week-by-week detail, <sup>*</sup> marks weeks no team in the league
       had him: those points are calculated from real NFL stats with our scoring, not a league number.
       <sup class="an-live-mark">●</sup> marks a week still being played or not yet on file: the points are live
       and turn into the official league number once the week is closed.</p>`;
    // La pagina si riscrive tutta a ogni filtro: le tendine sono nodi nuovi e
    // vanno riagganciate ogni volta.
    bindPickDropdown(wrap, (id, value) => {
        if (id === 'pos') attivi = value === 'all' ? new Set(RUOLI) : new Set([value]);
        else if (id === 'show') soloLiberi = value === 'available';
        else if (id === 'sort') ordine = value;
        render();
    });
    hydrateImages(wrap);
}

/** Un solo ascoltatore sul contenitore: la lista si riscrive tutta a ogni filtro. */
/* ============================================================
   DRILL DI STAGIONE — si apre sotto la riga
   ============================================================ */

/*
 * Da nome-campo di Sleeper a nome-campo di Firebase.
 *
 * Il drill disegna le statistiche con `keyStatLine`, che parla la lingua di
 * Firebase; il game log di Sleeper usa un'altra lingua per le stesse cose
 * (`rec_yd` invece di `rec_yds`, `fgm_40_49` invece di `fg_40_49`). Senza
 * questa traduzione la riga usciva con tutti zeri senza sbagliare niente.
 */
const STAT_SLEEPER_A_LEGA = {
    pass_yd: 'pass_yds', pass_td: 'pass_td', pass_int: 'pass_int',
    pass_att: 'pass_att', pass_cmp: 'pass_comp',
    rush_yd: 'rush_yds', rush_td: 'rush_td', rush_att: 'rush_att',
    rec: 'rec', rec_yd: 'rec_yds', rec_td: 'rec_td', rec_tgt: 'targets',
    fgm_0_19: 'fg_0_19', fgm_20_29: 'fg_20_29', fgm_30_39: 'fg_30_39',
    fgm_40_49: 'fg_40_49', fgm_50p: 'fg_50_plus', xpm: 'pat_made',
    sack: 'sack', int: 'def_int', fum_rec: 'fum_rec', def_td: 'def_td',
};

function statsTradotte(s) {
    const out = {};
    for (const [da, a] of Object.entries(STAT_SLEEPER_A_LEGA)) {
        if (s?.[da] != null) out[a] = s[da];
    }
    return out;
}

/**
 * Le giornate di un giocatore prese da Sleeper.
 *
 * Serve perche' il file di lega degli "unrostered" tiene solo una cinquantina
 * di giocatori: per tutti gli altri il drill avrebbe mostrato diciassette
 * righe "Unrostered —", cioe' niente. Da qui invece arrivano avversario,
 * punti e statistiche di chiunque. Restano righe CALCOLATE — nessuna squadra
 * della lega le ha registrate — quindi spente e con l'asterisco.
 */
async function giornateDaSleeper(e) {
    if (!e.playerId) return null;
    try {
        const log = await getPlayerWeekly(e.playerId, currentYear, e.pos);
        if (!log?.length) return null;
        return new Map(log.map(g => [g.week, {
            pts: g.pts ?? 0,
            stats: statsTradotte(g.stats),
            opponent: g.opponent ? `${g.isAway ? '@' : ''}${g.opponent}` : '',
        }]));
    } catch {
        return null;
    }
}

/**
 * L'ultima giornata cominciata. Non `model.lastWeek`: ESPN scrive in anticipo
 * le rose della settimana dopo e il modello le vede. La risposta e' nei dati:
 * l'ultima archiviata con punti, oppure le partite di chi ne ha giocate di piu'
 * secondo Sleeper — che in week 1 fa 1, non 2.
 */
function ultimaGiornata() {
    let gp = 0;
    for (const e of stato?.stats?.values() || []) if ((e.gp || 0) > gp) gp = e.gp;
    return Math.max(stato?.model?.lastPlayedWeek || 0, gp) || null;
}

/** Apre (o richiude) il dettaglio settimana per settimana sotto la riga. */
async function apriDrill(row, idx) {
    const e = stato?.lista?.[idx];
    const box = document.querySelector(`.an-week-drill[data-ld-drill="${idx}"]`);
    if (!e || !box) return;

    const aperto = row.classList.toggle('expanded');
    box.hidden = !aperto;
    if (!aperto || box.dataset.loaded) return;

    box.dataset.loaded = '1';
    box.innerHTML = `<p class="an-footnote">Loading season…</p>`;
    const anno = currentYear;
    let righe = '';
    try {
        const extraScores = await giornateDaSleeper(e);
        // Il nome della lega se il giocatore e' passato da una rosa: il modello
        // lo conosce cosi' ("Kenneth Walker III"), non come lo scrive Sleeper.
        const nomeLega = stato.roseIdx.get(chiave(e.name))?.nome || e.name;
        righe = await playerSeasonDrill(anno, { name: nomeLega, position: e.pos, nflTeam: e.team },
            { model: stato.model, extraScores, lastWeek: ultimaGiornata() });
    } catch { righe = ''; }
    // Nel frattempo si puo' aver cambiato anno o filtro: il contenitore di
    // allora non esiste piu', e scriverci dentro riempirebbe una riga che ora
    // appartiene a un altro giocatore.
    if (!box.isConnected || String(anno) !== String(currentYear)) return;

    const link = `#player/${anno}/${encodeURIComponent(e.pos)}/${encodeURIComponent(e.name)}`;
    box.innerHTML = righe
        ? `${righe}
           <div class="ld-drill-foot">
               <a href="${link}">Full player page →</a>
           </div>`
        : `<p class="an-footnote">No week-by-week data for ${anno} yet.</p>`;
}

function bindContent() {
    const wrap = document.getElementById('leaders-content');
    if (!wrap) return;
    wrap.addEventListener('click', (e) => {
        const more = e.target.closest('[data-leaders-more]');
        if (more) {
            toggleExtraRows(more);
            // Le righe appena scoperte hanno ancora la sagoma: le foto si
            // risolvono adesso, non al primo disegno (vedi hydrateImages).
            const box = more.previousElementSibling;
            if (box && !box.hidden) hydrateImages(box);
            return;
        }

        const apre = e.target.closest('[data-ld-open]');
        if (apre) { apriDrill(apre, Number(apre.dataset.ldOpen)); return; }
    });
}

