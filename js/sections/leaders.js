/**
 * Players — chi sta facendo punti quest'anno, e chi di loro è ancora libero.
 *
 * Due liste, una sopra l'altra, perché rispondono a due domande diverse:
 *
 *  1. **Season leaders** — tutti i giocatori NFL, ordinati per punti secondo il
 *     punteggio della lega. È la classifica assoluta: dice quanto vale davvero
 *     una prestazione, che il giocatore sia in una nostra rosa o no.
 *  2. **Best Available** — di quella classifica, chi in questo momento non ha
 *     nessuna delle quattro rose. Viveva in fondo ad Analysis, una pagina che
 *     parla d'altro; qui sta accanto alla lista da cui si legge.
 *
 * La prima viene da Sleeper (`getSeasonStats`: stagione intera, tutti i
 * giocatori, punti già calcolati col punteggio della lega). La seconda dal file
 * `data/nfl/best_available_<anno>.json`. Il modello di stagione di Firebase
 * serve solo a dire CHI aveva chi: senza, "libero" e "in rosa" si
 * confonderebbero.
 */

import { SEASONS_DESC, CURRENT_SEASON } from '../data.js?v=580';
import { TEAMS } from './team.js?v=709';
import { pickDropdownHTML, bindPickDropdown } from '../ui/dropdown-pick.js?v=1';
import { getSeasonStats } from '../data/projections.js?v=595';
import { getBestAvailable } from '../data/nfl-team-extras.js?v=1001';
import {
    buildSeasonModel, fmt, keyStatLine, headshotImg, posBadge, drillRow,
    hydrateImages, limitedRows, toggleExtraRows, sumWeeklyStats, playerSeasonDrill,
} from './analysis.js?v=774';
import { getPlayerWeekly } from '../data/player-full.js?v=656';

let initialized = false;
let currentYear = CURRENT_SEASON;
// I ruoli accesi. Multi-scelta: si guarda "RB e WR" molto più spesso di un
// ruolo solo, e con un radio si sarebbe dovuto scegliere.
let attivi = new Set(['QB', 'RB', 'WR', 'TE']);
let ordine = 'total';      // 'total' | 'perGame'

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
        const finale = rec.weeks[model.lastWeek]?.teamKey || null;
        idx.set(chiave(rec.name), { ultimo, finale, settimane: Object.keys(rec.weeks).length });
    }
    return idx;
}

const chiave = (nome) => String(nome || '').toLowerCase().replace(/[.,']/g, '').replace(/\s+/g, ' ').trim();

/** La targhetta della squadra Topina, o niente se non l'ha mai avuto nessuno. */
function targhettaRosa(info) {
    if (!info) return '';
    if (info.finale) return ` <span class="an-badge an-badge-start">${TEAMS[info.finale]?.name || info.finale}</span>`;
    if (info.ultimo) return ` <span class="an-badge an-badge-drop">Dropped by ${TEAMS[info.ultimo]?.name || info.ultimo}</span>`;
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
    switch (e.pos) {
        case 'QB': {
            const p = [`${n(e.passYd)} pass yds`, `${n(e.passTd)} TD`, `${n(r.pass_int)} INT`];
            if (e.rushYd) p.push(`${n(e.rushYd)} rush yds`);
            return p.join(' · ');
        }
        case 'RB': {
            const p = [`${n(e.rushYd)} rush yds`, `${n(e.rushTd)} TD`];
            if (e.rec) p.push(`${n(e.rec)} rec, ${n(e.recYd)} yds`);
            return p.join(' · ');
        }
        case 'WR':
        case 'TE': {
            const p = [`${n(e.rec)} rec`, `${n(e.recYd)} yds`, `${n(e.recTd)} TD`];
            if (e.rushYd) p.push(`${n(e.rushYd)} rush yds`);
            return p.join(' · ');
        }
        case 'K': {
            const p = [`${n(e.fgm)} FG`, `${n(e.xpm)} PAT`];
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

function pillsRuolo() {
    const tutti = attivi.size === RUOLI.length;
    return `
    <div class="an-controls ld-controls">
        <div class="an-avg-toggle ld-pos">
            <span class="an-avg-label">Positions:</span>
            <button class="an-avg-pill${tutti ? ' active' : ''}" data-ld-pos="all">All</button>
            ${RUOLI.map(p => `<button class="an-avg-pill${attivi.has(p) ? ' active' : ''}" data-ld-pos="${p}">${p}</button>`).join('')}
        </div>
        <div class="an-avg-toggle">
            <span class="an-avg-label">Sort:</span>
            <button class="an-avg-pill${ordine === 'total' ? ' active' : ''}" data-ld-sort="total">Total</button>
            <button class="an-avg-pill${ordine === 'perGame' ? ' active' : ''}" data-ld-sort="perGame">Per Game</button>
        </div>
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
        const gp = e.gp || 0;
        // Per-partita su chi ha giocato una gara sola non è una media, è un
        // caso: sotto le quattro presenze il numero dice solo che ha giocato poco.
        if (ordine === 'perGame' && gp < 4) continue;
        fuori.push({ e, chiave: ordine === 'perGame' ? (gp ? e.ptsLeague / gp : 0) : e.ptsLeague });
    }
    fuori.sort((a, b) => b.chiave - a.chiave);
    return fuori.slice(0, MASSIMO).map(x => x.e);
}

function listaHTML(lista, roseIdx) {
    if (!lista.length) {
        return `<p class="an-footnote">No player matches the selected positions.</p>`;
    }
    const righe = lista.map((e, i) => rigaLeader(e, i, roseIdx.get(chiave(e.name))));
    return `
    <div class="an-list-head ld-head">
        <span></span><span></span><span>Player</span><span>G</span><span>Points</span><span>Avg</span><span class="an-head-stats">Stats</span><span></span>
    </div>
    ${limitedRows(righe, VISIBILI, 'leaders')}`;
}

/* ============================================================
   BEST AVAILABLE — arrivato qui da Analysis, invariato nella sostanza.
   ============================================================ */

const BESTAVAIL_POSITIONS = ['QB', 'RB', 'WR', 'TE'];
const BESTAVAIL_VISIBLE = 5;

function bestAvailRowHTML(p, pos, uid, exSquadra) {
    const rec = { name: p.name, position: pos, nflTeam: p.team };
    const avg = p.weeks.length ? p.totPts / p.weeks.length : 0;
    // Ora la lista include chi è stato svincolato a stagione in corso: dirlo,
    // altrimenti "libero" sembrerebbe "mai preso da nessuno".
    const badge = exSquadra
        ? ` <span class="an-badge an-badge-drop">Dropped by ${exSquadra}</span>` : '';
    return `
    <div class="an-player-row" data-bestavail="${uid}">
        ${headshotImg(rec)}
        <span class="an-player-name">${p.name} ${posBadge(pos)}${badge}</span>
        <span class="an-cell">${p.weeks.length}</span>
        <span class="an-cell an-pts">${fmt(p.totPts, 2)}<sup>*</sup></span>
        <span class="an-cell">${fmt(avg, 1)}</span>
        <span class="an-keystats">${keyStatLine(pos, sumWeeklyStats(p.weeks))}</span>
        <span class="an-chevron">›</span>
    </div>
    <div class="an-week-drill" data-bestavail-drill="${uid}" hidden></div>`;
}

/**
 * Riusa drillRow. Le giornate in cui una delle 4 squadre lo aveva davvero si
 * leggono dal modello di stagione, così escono con "On {squadra}" invece che
 * tutte "Unrostered": adesso in lista ci sono anche gli svincolati, e dire
 * che non li aveva mai nessuno sarebbe falso.
 */
function bestAvailDrillHTML(model, p, pos) {
    const rec = model.players.get(p.name) || { position: pos };
    return p.weeks.map(w => {
        const vero = rec.weeks?.[w.week];
        const riga = vero
            ? { ...vero, opponent: vero.opponent || w.opponent }
            : { pts: w.pts, stats: w.stats, opponent: w.opponent, teamKey: null, started: null, calculated: true };
        // showTeamCol: qui il giocatore non appartiene a nessuna squadra in
        // particolare, quindi le giornate in cui qualcuno lo aveva devono dire
        // CHI lo aveva — altrimenti si legge "Starter" senza sapere di chi.
        return drillRow(rec, w.week, riga, { showTeamCol: true, teamKey: null });
    }).join('');
}

function bestAvailHTML(byPosition, model) {
    if (!byPosition) {
        return `<h3 class="an-sub-title an-rule">Best Available</h3>
            <p class="an-footnote">Data not available for ${currentYear} yet.</p>`;
    }
    // Chi lo aveva per ultimo, se è uno svincolato in corsa: serve alla riga.
    const ultimaSquadra = (nome) => {
        const rec = model?.players.get(nome);
        if (!rec) return null;
        let ultima = null, wk = -1;
        for (const [w, dati] of Object.entries(rec.weeks)) {
            if (dati.teamKey && Number(w) > wk) { wk = Number(w); ultima = dati.teamKey; }
        }
        return ultima ? (TEAMS[ultima]?.name || null) : null;
    };

    const groups = BESTAVAIL_POSITIONS.map(pos => {
        const list = byPosition[pos] || [];
        if (!list.length) return '';
        const rows = list.map((p, i) => bestAvailRowHTML(p, pos, `${pos}:${i}`, ultimaSquadra(p.name)));
        return `
        <div class="an-bestavail-group">
            <span class="an-bestavail-pos">${pos}</span>
            <div class="an-list-head">
                <span></span><span>Player</span><span>G</span><span>Points</span><span>Avg</span><span class="an-head-stats">Stats</span><span></span>
            </div>
            ${limitedRows(rows, BESTAVAIL_VISIBLE, 'bestavail')}
        </div>`;
    }).join('');

    return `
    <h3 class="an-sub-title an-rule">Best Available</h3>
    <p class="an-footnote">Top QB/RB/WR/TE by total points among the players <b>no team had in week
       ${model?.lastWeek ?? '—'}</b> — who you could pick up right now, dropped mid-season included.
       Points<sup>*</sup> are calculated from real NFL stats using the league's own scoring rules, not an
       official league number. Kickers and defenses aren't covered.</p>
    <div class="an-bestavail-grid">${groups}</div>`;
}

/* ============================================================
   PAGINA
   ============================================================ */

let stato = null;   // { stats, model, byPosition, roseIdx }

async function load() {
    const wrap = document.getElementById('leaders-content');
    if (!wrap) return;
    wrap.innerHTML = `<div class="loading-state"><div class="spinner"></div><p>Loading players...</p></div>`;
    const anno = currentYear;

    // Le tre fonti sono indipendenti: se una manca la pagina esce lo stesso
    // con quello che c'è, invece di restare su uno spinner per sempre.
    const [stats, model, byPosition] = await Promise.all([
        getSeasonStats(anno).catch(() => null),
        buildSeasonModel(anno).catch(() => null),
        getBestAvailable(anno).catch(() => null),
    ]);
    if (String(currentYear) !== String(anno)) return;   // l'utente ha già cambiato anno

    if (!stats) {
        wrap.innerHTML = `<div class="empty-state"><p class="empty-state-text">No player stats for ${anno}</p></div>`;
        return;
    }
    stato = { stats, model, byPosition, roseIdx: indiceRose(model) };
    render();
}

function render() {
    const wrap = document.getElementById('leaders-content');
    if (!wrap || !stato) return;
    const lista = classifica(stato.stats, stato.roseIdx);
    stato.lista = lista;   // il data-ld-open della riga e' l'indice qui dentro
    wrap.innerHTML = `
    <h3 class="an-sub-title">Season leaders</h3>
    ${pillsRuolo()}
    <div id="ld-list">${listaHTML(lista, stato.roseIdx)}</div>
    <p class="an-footnote">Every NFL player, scored with the league's own rules — ${lista.length} shown for the
       selected positions. The badge on the right says whether one of the four teams has him now, or had him.
       "Per Game" only ranks players with at least 4 games: below that an average says nothing.
       Defenses are missing: the source doesn't publish the points/yards-allowed brackets our scoring needs.</p>
    ${bestAvailHTML(stato.byPosition, stato.model)}`;
    hydrateImages(wrap);
}

/** Un solo ascoltatore sul contenitore: la lista si riscrive tutta a ogni filtro. */
/* ============================================================
   DRILL DI STAGIONE — si apre sotto la riga, come nel Best Available
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
    rush_yd: 'rush_yds', rush_td: 'rush_td',
    rec: 'rec', rec_yd: 'rec_yds', rec_td: 'rec_td',
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
        righe = await playerSeasonDrill(anno, { name: e.name, position: e.pos, nflTeam: e.team },
            { model: stato.model, extraScores });
    } catch { righe = ''; }
    // Nel frattempo si puo' aver cambiato anno o filtro: il contenitore di
    // allora non esiste piu', e scriverci dentro riempirebbe una riga che ora
    // appartiene a un altro giocatore.
    if (!box.isConnected || String(anno) !== String(currentYear)) return;

    const link = `#player/${anno}/${encodeURIComponent(e.pos)}/${encodeURIComponent(e.name)}`;
    box.innerHTML = righe
        ? `${righe}
           <div class="ld-drill-foot">
               <span>Greyed rows with a <sup>*</sup> are weeks no team in the league had him: those points are
                     calculated from real NFL stats with our scoring, not a league number.</span>
               <a href="${link}">Full player page →</a>
           </div>`
        : `<p class="an-footnote">No week-by-week data for ${anno} yet.</p>`;
}

function bindContent() {
    const wrap = document.getElementById('leaders-content');
    if (!wrap) return;
    wrap.addEventListener('click', (e) => {
        const more = e.target.closest('[data-leaders-more], [data-bestavail-more]');
        if (more) {
            toggleExtraRows(more);
            // Le righe appena scoperte hanno ancora la sagoma: le foto si
            // risolvono adesso, non al primo disegno (vedi hydrateImages).
            const box = more.previousElementSibling;
            if (box && !box.hidden) hydrateImages(box);
            return;
        }

        const pos = e.target.closest('[data-ld-pos]');
        if (pos) {
            const v = pos.dataset.ldPos;
            if (v === 'all') attivi = new Set(RUOLI);
            else if (attivi.has(v)) { attivi.delete(v); if (!attivi.size) attivi = new Set(RUOLI); }
            else attivi.add(v);
            render();
            return;
        }
        const sort = e.target.closest('[data-ld-sort]');
        if (sort) { ordine = sort.dataset.ldSort; render(); return; }

        const apre = e.target.closest('[data-ld-open]');
        if (apre) { apriDrill(apre, Number(apre.dataset.ldOpen)); return; }

        // Best Available: apertura del dettaglio settimana per settimana
        const row = e.target.closest('.an-player-row[data-bestavail]');
        if (!row || !stato) return;
        const uid = row.dataset.bestavail;
        const drill = wrap.querySelector(`.an-week-drill[data-bestavail-drill="${uid}"]`);
        if (!drill) return;
        const aperto = row.classList.toggle('expanded');
        drill.hidden = !aperto;
        if (aperto && !drill.dataset.loaded) {
            drill.dataset.loaded = '1';
            const [pos2, idx] = uid.split(':');
            const p = stato.byPosition?.[pos2]?.[+idx];
            if (p && stato.model) drill.innerHTML = bestAvailDrillHTML(stato.model, p, pos2);
        }
    });
}

