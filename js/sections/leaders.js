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

import { SEASONS_DESC, CURRENT_SEASON, displayName } from '../data.js?v=597';
import { TEAM_KEYS } from '../data/team-config.js?v=538';
import { fetchLeagueWeek } from '../data/espn-fantasy.js?v=178';
import { TEAMS } from './team.js?v=868';
import { pickDropdownHTML, bindPickDropdown } from '../ui/dropdown-pick.js?v=2';
import { getSeasonStats, getWeekStats, sommaGiornate, normName } from '../data/projections.js?v=637';
import {
    buildSeasonModel, fmt, headshotImg, posBadge,
    hydrateImages, limitedRows, toggleExtraRows, playerSeasonDrill,
} from './analysis.js?v=918';
import { getPlayerWeekly, statsSleeperALega } from '../data/player-full.js?v=674';
import { squadraPreferita } from '../utils/preferenze.js?v=1';
import { getAdvancedPlayers } from '../data/context-score.js?v=684';
import { getTeamStats } from '../data/nfl-team-stats.js?v=856';
import { niceTicks } from '../ui/charts.js?v=9';

let initialized = false;
let currentYear = CURRENT_SEASON;
// I ruoli accesi. Multi-scelta: si guarda "RB e WR" molto più spesso di un
// ruolo solo, e con un radio si sarebbe dovuto scegliere.
let attivi = new Set(['QB', 'RB', 'WR', 'TE', 'K']);
let ordine = 'total';      // 'total' | 'perGame'
let soloLiberi = false;    // filtro "Available": solo chi non e' in nessuna rosa
// "Last N games": 0 = tutta la stagione, altrimenti punti e statistiche delle
// sole ultime N partite GIOCATE da ciascuno (le bye e le assenze non contano:
// chi e' stato fuori tre settimane ha come "ultime 2" le due prima dello stop).
let ultime = 0;
const ULTIME = [1, 2, 3, 4, 5];
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
 * Chi ha chi, per le pagine sorelle (Trends): la stessa fonte e la stessa
 * chiave di questa lista, cosi' targhetta e filtro "Available" dicono le
 * stesse cose nelle due pagine. Ritorna nome → { finale, ultimo, nome } o null.
 */
export async function roseDellaLega(anno) {
    const [model, vive] = await Promise.all([buildSeasonModel(anno).catch(() => null), roseVive(anno)]);
    const idx = indiceRose(model, vive);
    return (nome) => idx.get(chiave(nome)) || null;
}

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
    // Il numero in evidenza e' quello per cui la lista e' ordinata. Sul telefono
    // resta visibile solo lui: con "Points per game" mostrava il totale, e la
    // lista ordinata per media sembrava in disordine.
    const perPartita = ordine === 'perGame';
    // Un clic apre sotto la riga la stagione giornata per giornata — lo stesso
    // dettaglio della pagina squadra e del Best Available qui sotto. La scheda
    // completa resta raggiungibile da un link in fondo al dettaglio.
    return `
    <div class="an-player-row ld-row" data-ld-open="${i}">
        <span class="ld-rank">${i + 1}</span>
        ${headshotImg(rec)}
        <span class="an-player-name">${e.name} ${posBadge(e.pos)}${e.team ? ` <span class="ld-nfl">${e.team}</span>` : ''}${targhettaRosa(info)}</span>
        <span class="an-cell">${gp || '—'}</span>
        ${perPartita ? `
        <span class="an-cell an-pts">${fmt(avg, 2)}<small class="ld-pts-base">${fmt(e.ptsLeague, 1)} / ${gp} G</small></span>
        <span class="an-cell">${fmt(e.ptsLeague, 2)}</span>` : `
        <span class="an-cell an-pts">${fmt(e.ptsLeague, 2)}</span>
        <span class="an-cell">${fmt(avg, 1)}</span>`}
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
    const finestra = [{ value: '0', label: 'All games' },
        ...ULTIME.map(n => ({ value: String(n), label: n === 1 ? 'Last game' : `Last ${n} games` }))];
    return `
    <div class="an-controls ld-controls">
        ${pickDropdownHTML('games', finestra, ultime ? ULTIME.indexOf(ultime) + 1 : 0)}
        ${pickDropdownHTML('sort', ordina, ordine === 'perGame' ? 1 : 0)}
        ${pickDropdownHTML('show', mostra, soloLiberi ? 1 : 0)}
        ${pickDropdownHTML('pos', ruoli, ruoli.findIndex(r => r.value === ruolo))}
    </div>`;
}

// Oltre il centesimo nessuno guarda, e ogni riga in piu' e' una foto da
// risolvere: la lista si ferma qui.
const MASSIMO = 100;

/** Ordina e taglia: la lista intera sono migliaia di righe, e nessuno le legge. */
function classifica(stats, roseIdx) {
    const fuori = [];
    for (const e of stats.values()) {
        if (!attivi.has(e.pos)) continue;
        if (e.ptsLeague == null) continue;
        // Libero = nessuna squadra lo ha nell'ultima giornata archiviata. Chi
        // e' stato tagliato resta dentro, con la targhetta "Dropped by".
        if (soloLiberi && roseIdx.get(chiave(e.name))?.finale) continue;
        const gp = e.gp || 0;
        // Punti totali diviso partite giocate, per TUTTI quelli che ne hanno
        // giocata almeno una: chi non ha partite non ha una media.
        if (ordine === 'perGame' && !gp) continue;
        fuori.push({ e, chiave: ordine === 'perGame' ? (gp ? e.ptsLeague / gp : 0) : e.ptsLeague });
    }
    fuori.sort((a, b) => b.chiave - a.chiave);
    return fuori.slice(0, MASSIMO).map(x => x.e);
}

/**
 * Le ultime N partite di ciascuno, sommate: Map con le stesse chiavi e la
 * stessa forma di `stato.stats`, cosi' classifica, righe e confronto non
 * sanno che stanno guardando una finestra.
 *
 * Le giornate si leggono una per una da Sleeper (getWeekStats) e restano in
 * `stato.giornateStat`: cambiare N non richiede niente di nuovo. Nome, squadra
 * e id restano quelli della voce di stagione — il dettaglio sotto la riga li
 * usa per trovare il giocatore.
 */
async function caricaGiornate(anno) {
    if (stato.giornateStat) return stato.giornateStat;
    // Stagione in corso: fino all'ultima giornata cominciata. Chiusa: tutte e
    // diciotto quelle di regular season (una 18 vuota non costa niente).
    const fino = String(anno) === String(CURRENT_SEASON) ? (ultimaGiornata() || 1) : 18;
    const settimane = Array.from({ length: fino }, (_, i) => i + 1);
    const mappe = await Promise.all(settimane.map(w => getWeekStats(anno, w)));
    return (stato.giornateStat = settimane.map((w, i) => [w, mappe[i]]));
}

function finestraUltime(n) {
    const perGiocatore = new Map();
    for (const [w, mappa] of stato.giornateStat || []) {
        for (const [k, voce] of mappa) {
            if (!perGiocatore.has(k)) perGiocatore.set(k, []);
            perGiocatore.get(k).push({ w, voce });
        }
    }
    const out = new Map();
    for (const [k, lista] of perGiocatore) {
        // in ordine di giornata: l'ultima somma porta la squadra di oggi
        const prese = lista.sort((a, b) => a.w - b.w).slice(-n).map(x => x.voce);
        const somma = sommaGiornate(prese);
        if (!somma) continue;
        const base = stato.stats.get(k);
        out.set(k, base
            ? { ...somma, name: base.name, playerId: base.playerId ?? somma.playerId, team: base.team || somma.team, gp: prese.length }
            : { ...somma, gp: prese.length });
    }
    return out;
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
        <span></span><span></span><span>Player</span><span>G</span>${ordine === 'perGame' ? '<span>Avg</span><span>Points</span>' : '<span>Points</span><span>Avg</span>'}<span class="an-head-stats">Stats</span><span></span>
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
    // "Last N games": le giornate si scaricano alla prima scelta, intanto la
    // lista dice che sta caricando invece di mostrare la stagione intera.
    const inAttesa = ultime && !stato.giornateStat;
    const fonte = ultime && stato.giornateStat ? finestraUltime(ultime) : stato.stats;
    const lista = inAttesa ? [] : classifica(fonte, stato.roseIdx);
    stato.lista = lista;   // il data-ld-open della riga e' l'indice qui dentro
    wrap.innerHTML = `
    ${pillsRuolo()}
    <div id="ld-list">${inAttesa
        ? '<div class="loading-state"><div class="spinner"></div><p>Loading game logs...</p></div>'
        : listaHTML(lista, stato.roseIdx)}</div>
    <p class="an-footnote">Every NFL player, scored with the league's own rules — ${lista.length} shown for the
       selected positions. The badge on the right says whether one of the four teams has him now, or had him.
       "Available" keeps only players on none of the four latest rosters on file: dropped players included,
       the most recent pickups only once the league data is updated.
       "Points per game" is total points divided by games played, for everyone with at least one game.
       "Last N games" counts each player's own last N games played — bye weeks and games missed don't count,
       so the window can reach further back for someone who was out.
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
        else if (id === 'games') ultime = Number(value) || 0;
        render();
    });
    hydrateImages(wrap);
    if (inAttesa) {
        const s = stato, anno = currentYear;
        caricaGiornate(anno).then(() => {
            // anno cambiato o pagina ricaricata nel frattempo: niente da ridisegnare
            if (stato === s && String(anno) === String(currentYear)) render();
        });
    }
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
    <section class="live-cmpteam ld-cmp-stats ld-forma" data-ld-forma>
        <div class="live-cmpteam-head"><span></span><span class="live-cmpteam-title">Consistency &amp; trend</span><span></span></div>
        <p class="an-footnote">Loading…</p>
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

/* ============================================================
   COSTANZA E TREND — media, varianza e andamento dei due
   ============================================================ */

/*
 * Le partite sono quelle GIOCATE (getPlayerWeekly: Sleeper, punteggio della
 * lega; bye e settimane da inattivo non ci sono): una media che contasse gli
 * zeri delle assenze direbbe "incostante" di chi e' stato solo infortunato.
 *
 * Tre misure, tre domande:
 *  - σ (e la varianza σ², chiesta esplicitamente) dice di quanti punti oscilla
 *    di solito. E' in punti, quindi confrontabile solo a parita' di media;
 *  - la volatilita' σ ÷ media e' la stessa oscillazione in proporzione: e' lei
 *    a dire chi e' piu' affidabile fra uno da 20 e uno da 10;
 *  - il trend e' la pendenza della retta dei minimi quadrati sui punti per
 *    SETTIMANA (non per partita: un mese fermo e' tempo che passa), in punti
 *    guadagnati o persi a settimana. Sotto le 3 partite non si calcola.
 * Media mobile a 3 partite nel grafico, ultime 4 contro la stagione nei
 * numeri: e' la versione "a occhio" della stessa domanda.
 */
const FINESTRA_MOBILE = 3;
const ULTIME_FORMA = 4;

function statForma(giochi) {
    const g = (giochi || []).map(x => ({ w: x.week, p: Number(x.pts) || 0, x })).sort((a, z) => a.w - z.w);
    const n = g.length;
    if (!n) return null;
    const pts = g.map(x => x.p);
    const media = pts.reduce((s, v) => s + v, 0) / n;
    const ord = [...pts].sort((a, z) => a - z);
    const quantile = (q) => { const i = (n - 1) * q, lo = Math.floor(i), hi = Math.ceil(i); return ord[lo] + (ord[hi] - ord[lo]) * (i - lo); };
    // Varianza campionaria (n − 1): sono le partite di una stagione, un campione.
    const varianza = n > 1 ? pts.reduce((s, v) => s + (v - media) ** 2, 0) / (n - 1) : null;
    const sd = varianza == null ? null : Math.sqrt(varianza);
    let pendenza = null, intercetta = null;
    if (n >= 3) {
        const mw = g.reduce((s, x) => s + x.w, 0) / n;
        const sxx = g.reduce((s, x) => s + (x.w - mw) ** 2, 0);
        if (sxx > 0) {
            pendenza = g.reduce((s, x) => s + (x.w - mw) * (x.p - media), 0) / sxx;
            intercetta = media - pendenza * mw;
        }
    }
    const ultime = pts.slice(-ULTIME_FORMA);
    const mediaUltime = n >= ULTIME_FORMA + 1 ? ultime.reduce((s, v) => s + v, 0) / ultime.length : null;
    const mobile = g.map((x, i) => {
        const fin = pts.slice(Math.max(0, i - FINESTRA_MOBILE + 1), i + 1);
        return { w: x.w, v: fin.reduce((s, v) => s + v, 0) / fin.length };
    });
    return {
        n, g, media, mediana: quantile(0.5), sd, varianza, cv: sd != null && media > 0 ? sd / media : null,
        p25: quantile(0.25), p75: quantile(0.75), min: ord[0], max: ord[n - 1],
        pendenza, intercetta, mediaUltime, mobile,
    };
}

const segnato = (v, d = 1) => (v == null ? '–' : `${v > 0 ? '+' : v < 0 ? '−' : ''}${fmt(Math.abs(v), d)}`);
const cognomeDi = (n) => { const p = String(n || '').replace(/ (Jr\.|Sr\.|II|III|IV|V)$/, '').split(' '); return p.length > 1 ? p.slice(1).join(' ') : p[0]; };
const escF = (v) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/** I numeri a specchio, sullo stesso disegno delle altre sezioni del confronto. */
function formaRigheHTML(sa, sb) {
    const r = (label, va, vb, o = {}) => rigaSpecchio(label, va ?? null, vb ?? null, {
        ...o,
        scrivi: o.scrivi || ((v, lato) => { const x = lato === 'a' ? va : vb; return x == null ? '–' : fmt(x, o.dec ?? 1); }),
    });
    const ultime = (s, lato) => {
        if (!s?.mediaUltime && s?.mediaUltime !== 0) return '–';
        return `${fmt(s.mediaUltime, 1)}<small class="ld-cmp-opp">${segnato(s.mediaUltime - s.media)} vs season</small>`;
    };
    return [
        r('Games played', sa?.n, sb?.n, { dec: 0, neutro: true }),
        r('Mean (points per game)', sa?.media, sb?.media),
        r('Median', sa?.mediana, sb?.mediana),
        r('Standard deviation σ', sa?.sd, sb?.sd, { neutro: true }),
        r('Variance σ²', sa?.varianza, sb?.varianza, { neutro: true, dec: 0 }),
        r('Volatility (σ ÷ mean)', sa?.cv, sb?.cv, { basso: true, scrivi: (v, lato) => { const x = (lato === 'a' ? sa : sb)?.cv; return x == null ? '–' : `${Math.round(x * 100)}%`; } }),
        r('Floor · 25th percentile', sa?.p25, sb?.p25),
        r('Ceiling · 75th percentile', sa?.p75, sb?.p75),
        r('Worst game', sa?.min, sb?.min),
        r('Best game', sa?.max, sb?.max),
        r('Trend (points per week)', sa?.pendenza, sb?.pendenza, { scrivi: (v, lato) => segnato((lato === 'a' ? sa : sb)?.pendenza, 2) }),
        r(`Last ${ULTIME_FORMA} games`, sa?.mediaUltime, sb?.mediaUltime, { scrivi: (v, lato) => ultime(lato === 'a' ? sa : sb, lato) }),
    ].join('');
}

/*
 * I due grafici sono le forme di Analysis, con le sue classi: la dispersione
 * è il dot plot dei margini (buildMarginDotPlot: puntini tenui, fascia ±1σ
 * senza bordo, tacca della media col valore sopra nel colore della serie),
 * l'andamento è il suo grafico a linee (buildLineChart: linee da 2px, pallino
 * e nome a fine linea, crosshair, fumetto .an-chart-tooltip). Copiarne
 * l'aspetto e non il codice: quelle funzioni sono locali ad analysis.js.
 * I colori dei due giocatori sono le variabili --ld-a / --ld-b (validate per
 * il daltonismo, vedi css), passate in `style` perché valgono anche in chiaro.
 */
const COLORE = { a: 'var(--ld-a)', b: 'var(--ld-b)' };

/** Dispersione: una corsia per giocatore, come i margini di Analysis. */
function grafDistribuzione(lati, stretto) {
    // Sul telefono un riquadro più stretto, non lo stesso rimpicciolito: a
    // 800 unità su 340 pixel le scritte scendevano sotto i 6 pixel.
    const D = stretto ? { w: 420, l: 84, r: 10, t: 22, b: 26, lane: 70 } : { w: 800, l: 130, r: 16, t: 22, b: 28, lane: 78 };
    const tuttiP = lati.flatMap(l => l.s.g.map(x => x.p));
    const max = Math.max(1, ...tuttiP, ...lati.map(l => l.s.media + (l.s.sd || 0)));
    const ticks = niceTicks(0, max, 5);
    const hi = ticks[ticks.length - 1];
    const plotW = D.w - D.l - D.r;
    const h = D.t + D.b + lati.length * D.lane;
    const x = (v) => D.l + (Math.max(0, v) / (hi || 1)) * plotW;
    const griglia = ticks.map(v => `
        <line x1="${x(v).toFixed(1)}" y1="${D.t}" x2="${x(v).toFixed(1)}" y2="${D.t + lati.length * D.lane}" class="an-gridline"/>
        <text x="${x(v).toFixed(1)}" y="${h - 8}" class="an-tick" text-anchor="middle">${fmt(v, 0)}</text>`).join('');
    // Stesso sfalsamento pseudo-casuale a seme fisso di Analysis: il disegno
    // non cambia fra un giro e l'altro.
    let seme = 7;
    const rnd = () => { seme = (seme * 9301 + 49297) % 233280; return seme / 233280; };
    const corsie = lati.map((l, i) => {
        const cy = D.t + i * D.lane + D.lane / 2;
        const jitH = D.lane * 0.6;
        const { s } = l, c = COLORE[l.k];
        const banda = s.sd != null
            ? `<rect x="${x(s.media - s.sd).toFixed(1)}" y="${(cy - jitH / 2).toFixed(1)}" width="${(x(s.media + s.sd) - x(s.media - s.sd)).toFixed(1)}" height="${jitH.toFixed(1)}" rx="3" style="fill:${c}" opacity="0.12"
                 data-tt="${escF(`${l.nome}|±1σ|${fmt(s.media - s.sd, 1)} – ${fmt(s.media + s.sd, 1)}|σ ${fmt(s.sd, 1)} · variance ${fmt(s.varianza, 0)}`)}" data-k="${l.k}"/>`
            : '';
        const punti = s.g.map(g => `<circle cx="${x(g.p).toFixed(1)}" cy="${(cy + (rnd() - 0.5) * jitH).toFixed(1)}" r="2.6" style="fill:${c}" opacity="0.45"
            data-tt="${escF(`${l.nome}|Week ${g.w}|${fmt(g.p, 1)}|${g.x.opponent ? `${g.x.isAway ? '@' : 'vs'} ${g.x.opponent}` : ''}`)}" data-k="${l.k}"/>`).join('');
        const mx = x(s.media);
        return `${banda}${punti}
            <line x1="${mx.toFixed(1)}" y1="${(cy - jitH / 2 - 3).toFixed(1)}" x2="${mx.toFixed(1)}" y2="${(cy + jitH / 2 + 3).toFixed(1)}" style="stroke:${c}" stroke-width="2.5"/>
            <text x="${mx.toFixed(1)}" y="${(cy - jitH / 2 - 6).toFixed(1)}" class="an-tick" text-anchor="middle" style="fill:${c};font-weight:700">${fmt(s.media, 1)}</text>
            <text x="${D.l - 10}" y="${(cy + 4).toFixed(1)}" class="st-role-label" text-anchor="end">${escF(l.nome)}</text>`;
    }).join('');
    return `<div class="an-chart ld-forma-chart"><svg viewBox="0 0 ${D.w} ${h}" class="an-svg" role="img" aria-label="Fantasy points per game: spread of each player">${griglia}${corsie}</svg><div class="an-chart-tooltip" hidden></div></div>`;
}

/** Andamento: il grafico a linee di Analysis, sulla media mobile. */
function grafTrend(lati, ultima, stretto) {
    const C = stretto ? { w: 420, h: 260, l: 30, r: 74, t: 14, b: 26 } : { w: 800, h: 300, l: 44, r: 120, t: 16, b: 30 };
    const prima = Math.min(...lati.map(l => l.s.g[0].w));
    const settimane = [];
    for (let w = prima; w <= ultima; w++) settimane.push(w);
    const tutti = lati.flatMap(l => l.s.g.map(g => g.p));
    const ticks = niceTicks(0, Math.max(1, ...tutti));
    const yMin = ticks[0], yMax = ticks[ticks.length - 1];
    const plotW = C.w - C.l - C.r, plotH = C.h - C.t - C.b;
    const x = (w) => C.l + (settimane.length > 1 ? ((w - prima) / (ultima - prima)) * plotW : plotW / 2);
    const y = (v) => C.t + (1 - (v - yMin) / ((yMax - yMin) || 1)) * plotH;
    const griglia = ticks.map(v => `
        <line x1="${C.l}" y1="${y(v).toFixed(1)}" x2="${C.l + plotW}" y2="${y(v).toFixed(1)}" class="an-gridline"/>
        <text x="${C.l - 8}" y="${(y(v) + 3).toFixed(1)}" class="an-tick" text-anchor="end">${fmt(v, 0)}</text>`).join('');
    const passo = settimane.length > 1 ? plotW / (settimane.length - 1) : plotW;
    const xTicks = settimane.map(w => `<text x="${x(w).toFixed(1)}" y="${C.h - 8}" class="an-tick" text-anchor="middle">${passo < 22 ? w : `W${w}`}</text>`).join('');
    // Le partite vere: puntini tenui come nel dot plot; la linea è la media
    // mobile, la retta del trend tratteggiata (come le proiezioni del sito).
    const serie = lati.map(l => {
        const { s } = l, c = COLORE[l.k];
        const punti = s.g.map(g => `<circle cx="${x(g.w).toFixed(1)}" cy="${y(g.p).toFixed(1)}" r="2.6" style="fill:${c}" opacity="0.45"/>`).join('');
        const w0 = s.g[0].w, w1 = s.g[s.n - 1].w;
        const retta = s.pendenza != null ? `<line x1="${x(w0).toFixed(1)}" y1="${y(s.intercetta + s.pendenza * w0).toFixed(1)}" x2="${x(w1).toFixed(1)}" y2="${y(s.intercetta + s.pendenza * w1).toFixed(1)}" style="stroke:${c}" stroke-width="1.4" stroke-dasharray="5 4" opacity="0.7"/>` : '';
        const linea = `<polyline points="${s.mobile.map(m => `${x(m.w).toFixed(1)},${y(m.v).toFixed(1)}`).join(' ')}" fill="none" style="stroke:${c}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
        return punti + retta + linea;
    }).join('');
    // Pallino e nome a fine linea, con lo scostamento anti-collisione di Analysis.
    const fini = lati.map(l => { const u = l.s.mobile[l.s.mobile.length - 1]; return { l, lx: x(u.w), ly: y(u.v), labelY: y(u.v) }; }).sort((a, z) => a.ly - z.ly);
    for (let i = 1; i < fini.length; i++) if (fini[i].labelY - fini[i - 1].labelY < 15) fini[i].labelY = fini[i - 1].labelY + 15;
    const capi = fini.map(({ l, lx, ly, labelY }) => `
        ${Math.abs(labelY - ly) > 2 ? `<line x1="${lx + 5}" y1="${ly}" x2="${lx + 12}" y2="${labelY}" class="an-leader"/>` : ''}
        <circle cx="${lx.toFixed(1)}" cy="${ly.toFixed(1)}" r="4.5" style="fill:${COLORE[l.k]}" stroke="#000" stroke-width="2"/>
        <text x="${(lx + 14).toFixed(1)}" y="${(labelY + 3.5).toFixed(1)}" class="an-endlabel">${escF(l.nome)}</text>`).join('');
    // Per il fumetto: ogni settimana con i due giocatori (punti, media mobile).
    const dati = settimane.map(w => ({
        w, x: +x(w).toFixed(1),
        righe: lati.map(l => {
            const g = l.s.g.find(q => q.w === w), m = l.s.mobile.find(q => q.w === w);
            return { k: l.k, nome: l.nome, p: g ? g.p : null, m: m ? m.v : null, opp: g?.x.opponent ? `${g.x.isAway ? '@' : 'vs'} ${g.x.opponent}` : '' };
        }),
    }));
    return `<div class="an-chart ld-forma-chart">
        <svg viewBox="0 0 ${C.w} ${C.h}" class="an-svg" role="img" aria-label="Fantasy points week by week, with 3-game average and trend line" data-forma='${JSON.stringify({ C, dati }).replace(/'/g, '&#39;')}'>
            ${griglia}${xTicks}${serie}${capi}
            <line class="an-crosshair" x1="0" y1="${C.t}" x2="0" y2="${C.t + plotH}" visibility="hidden"/>
            <rect class="an-hit" x="${C.l}" y="${C.t}" width="${plotW}" height="${plotH}" fill="transparent"/>
        </svg>
        <div class="an-chart-tooltip" hidden></div>
    </div>`;
}

/** Fumetto e crosshair, col markup del tooltip di Analysis. */
function bindForma(box) {
    const piazza = (chart, tt, e) => {
        const r = chart.getBoundingClientRect();
        let tx = e.clientX - r.left + 14;
        const tw = tt.offsetWidth || 140;
        if (tx + tw > r.width - 4) tx = e.clientX - r.left - tw - 14;
        // dentro i bordi: sul telefono, girato a sinistra, usciva dallo schermo
        tx = Math.max(4, Math.min(tx, r.width - tw - 4));
        tt.style.left = `${tx}px`;
        tt.style.top = `${e.clientY - r.top - 10}px`;
    };
    const riga = (k, valore, nome) => `<div class="an-tt-row"><span class="an-tt-key" style="background:${COLORE[k]}"></span><b>${escF(valore)}</b><span class="an-tt-name">${escF(nome)}</span></div>`;
    box.querySelectorAll('.ld-forma-chart').forEach(chart => {
        const svg = chart.querySelector('svg'), tt = chart.querySelector('.an-chart-tooltip');
        const cross = svg.querySelector('.an-crosshair');
        if (svg.dataset.forma) {
            const { C, dati } = JSON.parse(svg.dataset.forma);
            const hit = svg.querySelector('.an-hit');
            hit.addEventListener('pointermove', (e) => {
                const r = svg.getBoundingClientRect();
                const px = (e.clientX - r.left) * (C.w / r.width);
                const d = dati.reduce((m, q) => (Math.abs(q.x - px) < Math.abs(m.x - px) ? q : m), dati[0]);
                cross.setAttribute('x1', d.x); cross.setAttribute('x2', d.x); cross.setAttribute('visibility', 'visible');
                tt.innerHTML = `<div class="an-tt-title">Week ${d.w}</div>${[...d.righe].sort((a, z) => (z.p ?? -1) - (a.p ?? -1)).map(q => riga(q.k,
                    q.p == null ? '–' : fmt(q.p, 1),
                    q.p == null ? `${q.nome} (did not play)` : `${q.nome} ${q.opp ? `${q.opp} ` : ''}· avg ${fmt(q.m, 1)}`)).join('')}`;
                tt.hidden = false;
                piazza(chart, tt, e);
            });
            hit.addEventListener('pointerleave', () => { cross.setAttribute('visibility', 'hidden'); tt.hidden = true; });
            return;
        }
        svg.addEventListener('pointermove', (e) => {
            const el = e.target.closest('[data-tt]');
            if (!el) { tt.hidden = true; return; }
            const [nome, titolo, valore, nota] = el.dataset.tt.split('|');
            tt.innerHTML = `<div class="an-tt-title">${escF(titolo)}</div>${riga(el.dataset.k, valore, [nome, nota].filter(Boolean).join(' · '))}`;
            tt.hidden = false;
            piazza(chart, tt, e);
        });
        svg.addEventListener('pointerleave', () => { tt.hidden = true; });
    });
}

function formaHTML(a, b, ga, gb) {
    const sa = statForma(ga), sb = statForma(gb);
    const titolo = `<div class="live-cmpteam-head"><span></span><span class="live-cmpteam-title">Consistency &amp; trend</span><span></span></div>`;
    if (!sa && !sb) return `${titolo}<p class="an-footnote">No games played yet.</p>`;
    const lati = [
        sa && { k: 'a', nome: cognomeDi(a.name), s: sa },
        sb && { k: 'b', nome: cognomeDi(b.name), s: sb },
    ].filter(Boolean);
    const ultima = Math.max(...lati.map(l => l.s.g[l.s.n - 1].w));
    const stretto = matchMedia('(max-width: 560px)').matches;
    return `${titolo}
        ${formaRigheHTML(sa, sb)}
        <h3 class="an-sub-title ld-forma-sub">Points per game: mean and spread</h3>
        ${grafDistribuzione(lati, stretto)}
        <p class="an-footnote">Each dot is a game played. The vertical mark is the average, the band is ±1 standard deviation: the wider the band, the bigger the variance.</p>
        <h3 class="an-sub-title ld-forma-sub">Week by week: average and trend</h3>
        ${grafTrend(lati, ultima, stretto)}
        <p class="an-footnote">The line is the ${FINESTRA_MOBILE}-game moving average, the dots are the single games, the dashed line is the trend (least-squares slope over the weeks).</p>
        <p class="an-footnote ld-cmp-nota">Games actually played only — bye weeks and games missed are left out, so an injury does not count as a bad game. σ is in points, so it only compares players with a similar mean; volatility (σ ÷ mean) is the same swing in proportion, the fair way to say who is steadier. Trend from 3 games, in points gained or lost per week. Points with the league's scoring (Sleeper stats).</p>`;
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
        const forma = wrap.querySelector('[data-ld-forma]');
        if (forma) { forma.innerHTML = formaHTML(a, b, ga, gb); bindForma(forma); }
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

