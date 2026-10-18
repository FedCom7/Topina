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
 * giocatori, punteggio della lega). Chi ha chi, sulla stagione in corso, lo
 * dicono le rose ESPN LIVE; per le stagioni chiuse il modello di Firebase.
 */

import { SEASONS_DESC, CURRENT_SEASON, displayName } from '../data.js?v=596';
import { TEAM_KEYS } from '../data/team-config.js?v=538';
import { fetchLeagueWeek } from '../data/espn-fantasy.js?v=178';
import { TEAMS } from './team.js?v=865';
import { pickDropdownHTML, bindPickDropdown } from '../ui/dropdown-pick.js?v=1';
import { getSeasonStats, normName } from '../data/projections.js?v=635';
import {
    buildSeasonModel, fmt, headshotImg, posBadge,
    hydrateImages, limitedRows, toggleExtraRows, playerSeasonDrill,
} from './analysis.js?v=915';
import { getPlayerWeekly, statsSleeperALega } from '../data/player-full.js?v=674';
import { squadraPreferita } from '../utils/preferenze.js?v=1';
import { getAdvancedPlayers } from '../data/context-score.js?v=684';
import { getTeamStats } from '../data/nfl-team-stats.js?v=856';

let initialized = false;
let currentYear = CURRENT_SEASON;
// I ruoli accesi. Multi-scelta: si guarda "RB e WR" molto più spesso di un
// ruolo solo, e con un radio si sarebbe dovuto scegliere.
let attivi = new Set(['QB', 'RB', 'WR', 'TE', 'K']);
let ordine = 'total';      // 'total' | 'perGame'
let soloLiberi = false;    // filtro "Available": solo chi non e' in nessuna rosa
// Il confronto fra due giocatori: `a` e `b` sono chiavi di `stato.stats`
// ("nome|ruolo"), `scegli` dice quale dei due posti si sta riempiendo.
let confronto = { attivo: false, a: null, b: null, scegli: null, cerca: '' };

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
    // Compare sta accanto all'anno: e' un modo di guardare la pagina, come
    // l'anno, non un filtro della lista. Lo stesso bottone ci riporta.
    // a sinistra dell'anno, che resta all'estremo destro come nelle altre pagine
    box.innerHTML = `<button type="button" class="year-pill ld-cmp-btn${confronto.attivo ? ' is-on' : ''}" data-ld-cmp-toggle>${
            confronto.attivo ? '← Back to the list' : 'Compare'}</button>
        ${pickDropdownHTML('year', items, SEASONS_DESC.indexOf(String(currentYear)))}`;
    box.querySelector('[data-ld-cmp-toggle]')?.addEventListener('click', () =>
        azioneConfronto(confronto.attivo ? 'chiudi' : 'apri'));
    bindPickDropdown(box, (id, value) => {
        if (id !== 'year') return;
        currentYear = value;
        renderPickRow();
        if (confronto.attivo) caricaContesto();
        load();
    });
}

/* ============================================================
   SEASON LEADERS
   ============================================================ */

/**
 * Chi ha chi ADESSO, letto dalle rose ESPN.
 *
 * Firebase archivia le giornate CHIUSE piu' un segnaposto della settimana
 * dopo, scritto il martedi': una presa fatta il mercoledi' li' non c'e'
 * ancora. Bryce Young, preso da Sommo il 23/09/2026, in questa pagina
 * risultava svincolato — e nella lista "Available" compariva fra i liberi.
 *
 * Ritorna `null` quando non si sa: stagione chiusa, ESPN che non risponde, o
 * draft non ancora fatto (li' le rose sono segnaposto di ESPN e non sono di
 * nessuno). In quel caso comanda Firebase, come prima.
 */
async function roseVive(anno) {
    if (String(anno) !== String(CURRENT_SEASON)) return null;
    try {
        const { week, matchups, drafted } = await fetchLeagueWeek(anno);
        if (!drafted) return null;
        const out = rosePerNome(matchups);
        // La settimana di ESPN e se e' gia' cominciata: servono al dettaglio
        // per sapere quali giornate mostrare (vedi giornateNonArchiviate).
        out.settimana = week;
        out.cominciata = (matchups || []).some(m => [m.team1, m.team2]
            .some(t => (t?.starters || []).some(p => p.started)));
        return out.size ? out : null;
    } catch {
        return null;
    }
}

/** Nome → { key, nome, titolare } dalle formazioni di una giornata ESPN. */
function rosePerNome(matchups) {
    const out = new Map();
    for (const m of matchups || []) {
        for (const t of [m.team1, m.team2]) {
            const k = TEAM_KEYS[displayName(t?.name)] || null;
            if (!k) continue;
            for (const [lista, titolare] of [[t.starters || [], true], [t.bench || [], false]]) {
                for (const p of lista) {
                    if (p?.name && !p.placeholder) out.set(chiave(p.name), { key: k, nome: p.name, titolare });
                }
            }
        }
    }
    return out;
}

/**
 * Le formazioni delle giornate GIOCATE che Firebase non ha ancora archiviato,
 * lette da ESPN giornata per giornata: Map(settimana → rose).
 *
 * Due buchi, e questo li copre tutti e due:
 *  - durante la giornata, Firebase ha solo il segnaposto del martedi', scritto
 *    prima delle prese del mercoledi' (Young, preso da Oscurus in settimana,
 *    in week 3 risultava "Unrostered" mentre giocava titolare);
 *  - dal Monday Night all'archivio del martedi', ESPN e' gia' passata alla
 *    settimana dopo: le rose di ADESSO sono quelle della week 4, e date alla
 *    week 3 sbaglierebbero chi aveva chi quel giorno.
 * La settimana di ESPN entra solo se una sua partita e' cominciata: prima non
 * e' una giornata giocata, e nel dettaglio compariva una W4 da "Starter" a
 * zero punti.
 */
async function giornateNonArchiviate(anno, model, vive) {
    const out = new Map();
    if (!vive?.settimana) return out;
    const ultima = vive.cominciata ? vive.settimana : vive.settimana - 1;
    const archiviate = model?.playedWeeks || new Set();
    for (let w = 1; w <= ultima; w++) {
        if (archiviate.has(w)) continue;
        if (w === vive.settimana) { out.set(w, vive); continue; }
        try {
            const r = await fetchLeagueWeek(anno, w);
            if (r?.drafted) out.set(w, rosePerNome(r.matchups));
        } catch { /* quella giornata resta com'e' nel modello */ }
    }
    return out;
}

/**
 * Chi aveva questo giocatore, e in quale settimana è arrivato.
 *
 * Il nome del modello di Firebase e quello di Sleeper non coincidono sempre
 * (suffissi, punteggiatura): si confronta la forma normalizzata, la stessa che
 * usa il resto del sito.
 */
function indiceRose(model, vive) {
    const idx = new Map();
    if (!model) return applicaRoseVive(idx, vive);
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
    return applicaRoseVive(idx, vive);
}

/**
 * Le rose vive hanno l'ultima parola su CHI HA CHI.
 *
 * Tre casi, e servono tutti e tre: chi e' in una rosa ESPN prende quella
 * squadra (anche se per Firebase era di un'altra, o di nessuno); chi Firebase
 * dava in rosa e nelle rose vive non c'e' piu' e' stato tagliato, quindi passa
 * a "Dropped by"; chi nel modello non c'e' proprio — preso dopo l'ultima
 * giornata archiviata, come Young — entra adesso.
 */
function applicaRoseVive(idx, vive) {
    if (!vive) return idx;
    for (const info of idx.values()) {
        const ora = vive.get(chiave(info.nome));
        if (ora) { info.finale = ora.key; continue; }
        if (info.finale) { info.ultimo = info.finale; info.finale = null; }
    }
    for (const [k, v] of vive) {
        if (idx.has(k)) continue;
        idx.set(k, { nome: v.nome, ultimo: null, finale: v.key, settimane: 0 });
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

/**
 * La targhetta dice CHI CE L'HA ADESSO, e solo quello.
 *
 * Chi e' stato tagliato non ne ha una: "Dropped by" rispondeva a una domanda
 * diversa da quella della lista ("di chi e'?") e in coda a cento righe si
 * leggeva come un possesso. Dove e' passato durante l'anno lo dice il
 * dettaglio, riga per riga, accanto a Starter/Bench — che e' il posto dove
 * quella storia ha una data.
 */
function targhettaRosa(info) {
    if (!info?.finale) return '';
    // Nel colore della squadra, non nel verde/ambra generici di "titolare" e
    // "tagliato": in una lista di cento righe la squadra si riconosce dal
    // colore prima che dal nome.
    const colore = TEAMS[info.finale]?.color ? ` style="--team-color:${TEAMS[info.finale].color}"` : '';
    return ` <span class="an-badge ld-team-badge"${colore}>${TEAMS[info.finale]?.name || info.finale}</span>`;
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
    // RB / WR insieme: sono i due ruoli che si contendono il flex, e al
    // momento di scegliere chi schierare li' e' la domanda — uno contro l'altro
    // nella stessa classifica. Sta subito dopo i due ruoli che unisce.
    const ruoli = [{ value: 'all', label: 'All positions' },
        ...RUOLI.flatMap(r => r === 'WR'
            ? [{ value: r, label: r }, { value: 'RB/WR', label: 'RB / WR' }]
            : [{ value: r, label: r }])];
    const ruolo = attivi.size === 1 ? [...attivi][0]
        : (attivi.size === 2 && attivi.has('RB') && attivi.has('WR')) ? 'RB/WR' : 'all';
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
    const [stats, model, vive] = await Promise.all([
        getSeasonStats(anno).catch(() => null),
        buildSeasonModel(anno).catch(() => null),
        roseVive(anno),
    ]);
    if (String(currentYear) !== String(anno)) return;   // l'utente ha già cambiato anno

    if (!stats) {
        wrap.innerHTML = `<div class="empty-state"><p class="empty-state-text">No player stats for ${anno}</p></div>`;
        return;
    }
    const giornate = await giornateNonArchiviate(anno, model, vive);
    if (String(currentYear) !== String(anno)) return;
    stato = { stats, model, vive, giornate, roseIdx: indiceRose(model, vive) };
    render();
}

function render() {
    const wrap = document.getElementById('leaders-content');
    if (!wrap || !stato) return;
    if (confronto.attivo) { wrap.innerHTML = confrontoHTML(); dopoConfronto(wrap); return; }
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
        if (id === 'pos') attivi = value === 'all' ? new Set(RUOLI) : new Set(value.split('/'));
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

// La traduzione dei nomi-campo Sleeper → lega sta in player-full.js
// (`statsSleeperALega`), condivisa con Analysis.

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
            stats: statsSleeperALega(g.stats),
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
    const giocate = [...(stato?.giornate?.keys() || [])];
    return Math.max(stato?.model?.lastPlayedWeek || 0, gp, ...giocate) || null;
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
        // La giornata in corso non e' ancora su Firebase — o c'e' solo il
        // segnaposto del martedi', scritto prima delle prese del mercoledi':
        // Bryce Young, preso da Oscurus in settimana, in week 3 risultava
        // "Unrostered" mentre giocava titolare. Per quella giornata comandano
        // le rose ESPN vive.
        const liveWeeks = [...(stato.giornate || new Map())].map(([week, rose]) => {
            const r = rose.get(chiave(e.name));
            return { week, teamKey: r?.key || null, started: !!r?.titolare };
        });
        righe = await playerSeasonDrill(anno, { name: nomeLega, position: e.pos, nflTeam: e.team },
            { model: stato.model, extraScores, lastWeek: ultimaGiornata(), teamOnBadge: true, liveWeeks });
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

        const cmp = e.target.closest('[data-ld-cmp]');
        if (cmp) { azioneConfronto(cmp.dataset.ldCmp, cmp.dataset.key); return; }
    });
    // la ricerca del giocatore riscrive solo l'elenco, cosi' il campo non
    // perde il fuoco a ogni lettera
    wrap.addEventListener('input', (e) => {
        if (!e.target.matches('[data-ld-cerca]')) return;
        confronto.cerca = e.target.value;
        const lista = wrap.querySelector('.ld-pick-list');
        if (lista) { lista.innerHTML = sceltaListaHTML(); hydrateImages(lista); }
    });
}

/* ============================================================
   COMPARE — due giocatori uno contro l'altro
   ============================================================ */

/**
 * Uso dei giocatori (quote di snap, bersagli, air yards, portate: nflverse) e
 * statistiche delle squadre NFL, per l'anno a schermo. Si scaricano solo al
 * primo "Compare": la lista non ne ha bisogno. Sono due file locali.
 */
let contesto = { anno: null, adv: null, squadre: null, promessa: null };
function caricaContesto() {
    const anno = currentYear;
    if (contesto.anno === anno && contesto.promessa) return contesto.promessa;
    contesto = { anno, adv: null, squadre: null, promessa: null };
    contesto.promessa = Promise.all([
        getAdvancedPlayers(anno).catch(() => []),
        getTeamStats(anno).catch(() => null),
    ]).then(([adv, squadre]) => {
        if (contesto.anno !== anno) return;
        contesto.adv = new Map((adv || []).map(r => [String(r.sleeper), r]));
        contesto.squadre = squadre?.teams || {};
        if (confronto.attivo) render();
    });
    return contesto.promessa;
}

function azioneConfronto(azione, chiaveGiocatore) {
    if (azione === 'apri') {
        caricaContesto();
        confronto.attivo = true;
        if (!confronto.a) confronto.scegli = 'a';
    } else if (azione === 'chiudi') {
        confronto.attivo = false;
    } else if (azione === 'a' || azione === 'b') {
        confronto.scegli = confronto.scegli === azione ? null : azione;
        confronto.cerca = '';
    } else if (azione === 'scegli' && confronto.scegli) {
        confronto[confronto.scegli] = chiaveGiocatore;
        // riempito il primo, si passa da solo al secondo se e' ancora vuoto
        confronto.scegli = confronto.scegli === 'a' && !confronto.b ? 'b' : null;
        confronto.cerca = '';
    } else if (azione === 'scambia') {
        [confronto.a, confronto.b] = [confronto.b, confronto.a];
    }
    if (azione === 'apri' || azione === 'chiudi') renderPickRow();
    render();
}

const voce = (k) => (k ? stato.stats.get(k) : null);
const chiaveVoce = (e) => `${normName(e.name)}|${e.pos}`;

/** Il posto di un giocatore in testa al confronto: foto, nome, squadra. */
function postoHTML(lato) {
    const e = voce(confronto[lato]);
    const attivo = confronto.scegli === lato;
    if (!e) {
        return `<button type="button" class="ld-cmp-slot is-empty${attivo ? ' is-on' : ''}" data-ld-cmp="${lato}">
            <span class="ld-cmp-plus">+</span><span>Choose player</span></button>`;
    }
    const info = stato.roseIdx.get(chiave(e.name));
    return `
    <button type="button" class="ld-cmp-slot${attivo ? ' is-on' : ''}" data-ld-cmp="${lato}" title="Change player">
        ${headshotImg({ name: e.name, position: e.pos, nflTeam: e.team }, 'ld-cmp-foto')}
        <span class="ld-cmp-nome">${e.name}</span>
        <span class="ld-cmp-sub">${posBadge(e.pos)}${e.team ? ` <span class="ld-nfl">${e.team}</span>` : ''}${targhettaRosa(info)}</span>
        <span class="ld-cmp-cambia">Change</span>
    </button>`;
}

/**
 * Chi si puo' scegliere: prima i giocatori della squadra selezionata (la
 * squadra del cuore, dalla barra in alto), poi tutti gli altri in ordine di
 * punti. La ricerca filtra tutti e due i gruppi per nome.
 */
function sceltaListaHTML() {
    const mia = squadraPreferita();
    const q = normName(confronto.cerca || '');
    const tutti = [...stato.stats.values()].filter(e => RUOLI.includes(e.pos) && e.ptsLeague != null);
    const passa = (e) => !q || normName(e.name).includes(q);
    const diMia = (e) => mia && stato.roseIdx.get(chiave(e.name))?.finale === mia;
    const giaPreso = new Set([confronto.a, confronto.b].filter(Boolean));
    const miei = tutti.filter(e => diMia(e) && passa(e)).sort((x, y) => y.ptsLeague - x.ptsLeague);
    const altri = tutti.filter(e => !diMia(e) && passa(e) && (e.gp || 0) > 0)
        .sort((x, y) => y.ptsLeague - x.ptsLeague).slice(0, q ? 40 : 60);
    const riga = (e) => {
        const k = chiaveVoce(e);
        return `
        <button type="button" class="ld-pick-row${giaPreso.has(k) ? ' is-taken' : ''}" data-ld-cmp="scegli" data-key="${k}">
            ${headshotImg({ name: e.name, position: e.pos, nflTeam: e.team })}
            <span class="ld-pick-name">${e.name} ${posBadge(e.pos)}${e.team ? ` <span class="ld-nfl">${e.team}</span>` : ''}${
                targhettaRosa(stato.roseIdx.get(chiave(e.name))) || ' <span class="an-badge ld-free-badge">Unrostered</span>'}</span>
            <span class="ld-pick-pts">${fmt(e.ptsLeague, 1)}</span>
        </button>`;
    };
    const nomeMia = mia ? (TEAMS[mia]?.name || mia) : '';
    return `
        ${miei.length ? `<span class="ld-pick-group">Your team · ${nomeMia}</span>${miei.map(riga).join('')}` : ''}
        <span class="ld-pick-group">${q ? 'Results' : 'All players'}</span>
        ${altri.map(riga).join('') || '<p class="an-footnote">No player with that name.</p>'}`;
}

/* Le righe del confronto. `v` legge il valore dalla voce; `basso`: meglio
   meno; `testo`: come si scrive (se no il numero con un decimale). */
const pct = (a, b) => (b ? a / b : null);
const RIGHE_COMUNI = [
    { k: 'pts', label: 'Fantasy points', v: (e) => e.ptsLeague, dec: 1 },
    { k: 'gp', label: 'Games', v: (e) => e.gp || 0, dec: 0 },
    { k: 'ppg', label: 'Points per game', v: (e) => (e.gp ? e.ptsLeague / e.gp : 0), dec: 1 },
];
const RIGHE_RUOLO = {
    QB: [
        { k: 'cmp', label: 'Completion %', v: (e) => pct(e.raw?.pass_cmp || 0, e.passAtt || 0), perc: true,
            testo: (e) => `${fmt(e.raw?.pass_cmp || 0)}/${fmt(e.passAtt || 0)}` },
        { k: 'pyd', label: 'Passing yards', v: (e) => e.passYd || 0, dec: 0 },
        { k: 'ptd', label: 'Passing TD', v: (e) => e.passTd || 0, dec: 0 },
        { k: 'int', label: 'Interceptions', v: (e) => e.raw?.pass_int || 0, dec: 0, basso: true },
        { k: 'ryd', label: 'Rushing yards', v: (e) => e.rushYd || 0, dec: 0 },
        { k: 'rtd', label: 'Rushing TD', v: (e) => e.rushTd || 0, dec: 0 },
    ],
    RB: [
        { k: 'car', label: 'Carries', v: (e) => e.rushAtt || 0, dec: 0 },
        { k: 'ryd', label: 'Rushing yards', v: (e) => e.rushYd || 0, dec: 0 },
        { k: 'ypc', label: 'Yards per carry', v: (e) => pct(e.rushYd || 0, e.rushAtt || 0), dec: 1 },
        { k: 'rtd', label: 'Rushing TD', v: (e) => e.rushTd || 0, dec: 0 },
        { k: 'tgt', label: 'Targets', v: (e) => e.tgt || 0, dec: 0 },
        { k: 'rec', label: 'Receptions', v: (e) => e.rec || 0, dec: 0 },
        { k: 'reyd', label: 'Receiving yards', v: (e) => e.recYd || 0, dec: 0 },
        { k: 'retd', label: 'Receiving TD', v: (e) => e.recTd || 0, dec: 0 },
    ],
    WR: [
        { k: 'tgt', label: 'Targets', v: (e) => e.tgt || 0, dec: 0 },
        { k: 'rec', label: 'Receptions', v: (e) => e.rec || 0, dec: 0 },
        { k: 'cat', label: 'Catch %', v: (e) => pct(e.rec || 0, e.tgt || 0), perc: true },
        { k: 'reyd', label: 'Receiving yards', v: (e) => e.recYd || 0, dec: 0 },
        { k: 'ypr', label: 'Yards per catch', v: (e) => pct(e.recYd || 0, e.rec || 0), dec: 1 },
        { k: 'retd', label: 'Receiving TD', v: (e) => e.recTd || 0, dec: 0 },
        { k: 'ryd', label: 'Rushing yards', v: (e) => e.rushYd || 0, dec: 0 },
    ],
    K: [
        { k: 'fg', label: 'Field goal %', v: (e) => pct(e.fgm || 0, e.raw?.fga || 0), perc: true,
            testo: (e) => `${fmt(e.fgm || 0)}/${fmt(e.raw?.fga || 0)}` },
        { k: 'fg50', label: 'Field goals 50+', v: (e) => e.raw?.fgm_50p || 0, dec: 0 },
        { k: 'xp', label: 'Extra points', v: (e) => e.xpm || 0, dec: 0 },
    ],
};
RIGHE_RUOLO.TE = RIGHE_RUOLO.WR;

/** Una riga a specchio: valore di A, etichetta con la barra, valore di B. */
function rigaSpecchio(label, va, vb, { basso = false, neutro = false, scrivi = (v) => v } = {}) {
    const na = Number(va), nb = Number(vb);
    const validi = va != null && vb != null && Number.isFinite(na) && Number.isFinite(nb);
    const tot = validi ? Math.abs(na) + Math.abs(nb) : 0;
    const quota = tot > 0 ? Math.round((Math.abs(na) / tot) * 100) : 50;
    const vinceA = neutro || !validi || na === nb ? null : basso ? na < nb : na > nb;
    return `
    <div class="live-cmpteam-row">
        <span class="live-cmpteam-val${vinceA === true ? ' is-top' : ''}">${scrivi(va, 'a')}</span>
        <span class="live-cmpteam-mid">
            <span class="live-cmpteam-label">${label}${basso ? '<i class="live-cmpteam-giu" title="lower is better">↓</i>' : ''}</span>
            <span class="live-cmpteam-bar"><i class="live-cmpteam-fill${basso ? ' is-inverse' : ''}" style="width:${quota}%"></i></span>
        </span>
        <span class="live-cmpteam-val live-cmpteam-val--r${vinceA === false ? ' is-top' : ''}">${scrivi(vb, 'b')}</span>
    </div>`;
}

function righeStatisticheHTML(a, b) {
    // Le righe comuni, poi quelle del ruolo di A e quelle in piu' del ruolo di
    // B: un RB contro un WR si confrontano su corse E ricezioni.
    const viste = new Set();
    const righe = [...RIGHE_COMUNI, ...(RIGHE_RUOLO[a.pos] || []), ...(RIGHE_RUOLO[b.pos] || [])]
        .filter(r => !viste.has(r.k) && viste.add(r.k));
    return righe.map(r => {
        const va = r.v(a), vb = r.v(b);
        const scrivi = (v, lato) => {
            if (r.testo) return `${r.testo(lato === 'a' ? a : b)}${v != null ? ` <small>${Math.round(v * 100)}%</small>` : ''}`;
            if (v == null) return '–';
            return r.perc ? `${Math.round(v * 100)}%` : fmt(v, r.dec ?? 1);
        };
        return rigaSpecchio(r.label, va ?? 0, vb ?? 0, { basso: r.basso, scrivi: (v, lato) => scrivi(lato === 'a' ? va : vb, lato) });
    }).join('');
}

const quota = (v) => (v == null ? '–' : `${Math.round(v * 100)}%`);

/**
 * Quanto lo usa la sua squadra: la fetta di snap, bersagli, air yards e
 * portate che gli arriva. E' il numero che separa chi fa punti perche' e' al
 * centro dell'attacco da chi li fa con due palloni a partita. Da nflverse,
 * aggiornato il martedi': durante la giornata e' indietro di una partita.
 */
function usoHTML(a, b) {
    if (!contesto.adv) return `<section class="live-cmpteam ld-cmp-stats"><p class="an-footnote">Loading usage…</p></section>`;
    const ua = contesto.adv.get(String(a.playerId)), ub = contesto.adv.get(String(b.playerId));
    if (!ua && !ub) return '';
    const righe = [
        ['Snap share', 'snapPct'],
        ['Target share', 'targetShare'],
        ['Air yards share', 'airYardsShare'],
        ['Rush share', 'rushShare'],
        ['Targets per game', 'tgtPerGame', 1],
        ['Carries per game', 'carriesPerGame', 1],
    ].filter(([, k]) => (ua?.[k] || 0) > 0 || (ub?.[k] || 0) > 0)
        .map(([label, k, dec]) => rigaSpecchio(label, ua?.[k] ?? null, ub?.[k] ?? null, {
            scrivi: (v, lato) => {
                const x = (lato === 'a' ? ua : ub)?.[k];
                return x == null ? '–' : dec ? fmt(x, dec) : quota(x);
            },
        })).join('');
    if (!righe) return '';
    return `
    <section class="live-cmpteam ld-cmp-stats">
        <div class="live-cmpteam-head"><span></span><span class="live-cmpteam-title">Usage in their team</span><span></span></div>
        ${righe}
        <p class="an-footnote ld-cmp-nota">Share of the team's snaps, targets, air yards and carries (nflverse, updated every Tuesday).</p>
    </section>`;
}

/**
 * La squadra NFL di ciascuno: se segna, quanto muove la palla, quanto lancia.
 * Ogni valore col suo posto fra le 32 (#1 = la migliore), cosi' si legge
 * subito se uno gioca in un attacco che produce o in uno che fatica.
 */
function squadraHTML(a, b) {
    if (!contesto.squadre) return '';
    const ta = contesto.squadre[a.team], tb = contesto.squadre[b.team];
    if (!ta && !tb) return '';
    const rec = (t) => (t?.record ? `${t.record.w}–${t.record.l}${t.record.t ? `–${t.record.t}` : ''}` : '');
    const logo = (abbr) => `<img class="ld-cmp-logo" src="https://a.espncdn.com/i/teamlogos/nfl/500/${String(abbr || '').toLowerCase()}.png" alt="">`;
    const voci = [
        { label: 'Points per game', v: (t) => t?.offense?.ppg, r: (t) => t?.ranks?.offense?.ppg, dec: 1 },
        { label: 'Yards per game', v: (t) => t?.offense?.totYdsPg, r: (t) => t?.ranks?.offense?.totYdsPg, dec: 0 },
        { label: 'Passing yards per game', v: (t) => t?.offense?.passYdsPg, r: (t) => t?.ranks?.offense?.passYdsPg, dec: 0 },
        { label: 'Rushing yards per game', v: (t) => t?.offense?.rushYdsPg, r: (t) => t?.ranks?.offense?.rushYdsPg, dec: 0 },
        { label: 'Plays per game', v: (t) => t?.offense?.playsPg, r: (t) => t?.ranks?.offense?.playsPg, dec: 1 },
        { label: 'Red zone plays per game', v: (t) => t?.offense?.rzPlaysPg, r: (t) => t?.ranks?.offense?.rzPlaysPg, dec: 1 },
        { label: 'Pass rate', v: (t) => t?.offense?.passRate, perc: true, neutro: true },
    ];
    const righe = voci.map(x => rigaSpecchio(x.label, x.v(ta) ?? null, x.v(tb) ?? null, {
        neutro: x.neutro,
        scrivi: (v, lato) => {
            const t = lato === 'a' ? ta : tb;
            const val = x.v(t);
            if (val == null) return '–';
            const r = x.r ? x.r(t) : null;
            return `${x.perc ? quota(val) : fmt(val, x.dec)}${r ? `<small class="ld-cmp-opp">#${r} of 32</small>` : ''}`;
        },
    })).join('');
    return `
    <section class="live-cmpteam ld-cmp-stats ld-cmp-team">
        <div class="live-cmpteam-head">
            <span>${logo(a.team)}${a.team || ''}<small>${rec(ta)}</small></span>
            <span class="live-cmpteam-title">Their NFL team</span>
            <span>${b.team || ''}${logo(b.team)}<small>${rec(tb)}</small></span>
        </div>
        ${righe}
    </section>`;
}

function confrontoHTML() {
    const a = voce(confronto.a), b = voce(confronto.b);
    const scelta = confronto.scegli ? `
    <div class="ld-pick">
        <input type="search" class="ld-pick-search" data-ld-cerca placeholder="Search a player…" value="${(confronto.cerca || '').replace(/"/g, '&quot;')}" autocomplete="off">
        <div class="ld-pick-list">${sceltaListaHTML()}</div>
    </div>` : '';
    const corpo = a && b && !confronto.scegli ? `
    <section class="live-cmpteam ld-cmp-stats">
        <div class="live-cmpteam-head"><span></span><span class="live-cmpteam-title">${currentYear} season</span><span></span></div>
        ${righeStatisticheHTML(a, b)}
    </section>
    ${usoHTML(a, b)}
    ${squadraHTML(a, b)}
    <section class="live-cmpteam ld-cmp-weeks" data-ld-settimane>
        <div class="live-cmpteam-head"><span></span><span class="live-cmpteam-title">Week by week</span><span></span></div>
        <p class="an-footnote">Loading…</p>
    </section>` : '';
    return `
    <div class="ld-cmp-head">
        ${postoHTML('a')}
        <button type="button" class="ld-cmp-vs" data-ld-cmp="scambia" title="Swap sides" ${a && b ? '' : 'disabled'}>vs</button>
        ${postoHTML('b')}
    </div>
    ${scelta}
    ${corpo}`;
}

/** Dopo il disegno: foto, fuoco sulla ricerca, e le settimane dei due. */
function dopoConfronto(wrap) {
    hydrateImages(wrap);
    if (confronto.scegli) wrap.querySelector('[data-ld-cerca]')?.focus({ preventScroll: true });
    const a = voce(confronto.a), b = voce(confronto.b);
    if (!a || !b || confronto.scegli) return;
    const anno = currentYear;
    const settimane = (e) => (e.playerId ? getPlayerWeekly(e.playerId, anno, e.pos).catch(() => []) : Promise.resolve([]));
    Promise.all([settimane(a), settimane(b)]).then(([ga, gb]) => {
        const box = wrap.querySelector('[data-ld-settimane]');
        if (!box || voce(confronto.a) !== a || voce(confronto.b) !== b) return;
        const ma = new Map(ga.map(g => [g.week, g])), mb = new Map(gb.map(g => [g.week, g]));
        const ultima = Math.max(0, ...ga.map(g => g.week), ...gb.map(g => g.week));
        if (!ultima) { box.querySelector('.an-footnote').textContent = 'No games yet.'; return; }
        const punti = (g) => (g ? Number(g.pts) || 0 : null);
        const righe = [];
        for (let w = 1; w <= ultima; w++) {
            const xa = punti(ma.get(w)), xb = punti(mb.get(w));
            const scrivi = (v, lato) => {
                const g = (lato === 'a' ? ma : mb).get(w);
                if (!g) return '<span class="ld-cmp-bye">bye</span>';
                return `${fmt(v, 1)}<small class="ld-cmp-opp">${g.isAway ? '@' : 'vs'} ${g.opponent || ''}</small>`;
            };
            righe.push(rigaSpecchio(`Week ${w}`, xa ?? 0, xb ?? 0, { scrivi: (v, lato) => scrivi(lato === 'a' ? xa : xb, lato) }));
        }
        // quante settimane ha vinto ciascuno, contando solo quelle giocate da tutti e due
        let va = 0, vb = 0;
        for (let w = 1; w <= ultima; w++) {
            const xa = punti(ma.get(w)), xb = punti(mb.get(w));
            if (xa == null || xb == null || xa === xb) continue;
            if (xa > xb) va++; else vb++;
        }
        box.innerHTML = `
            <div class="live-cmpteam-head"><span>${va} won</span><span class="live-cmpteam-title">Week by week</span><span>${vb} won</span></div>
            ${righe.join('')}`;
    });
}

