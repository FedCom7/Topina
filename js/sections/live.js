/**
 * Live Matchup Center — Fase 1 (layout + dati reali, senza motore eventi).
 * Route: #live
 *
 * Fonte dati primaria: il Cloudflare Worker ESPN live (worker/espn-live-proxy.js
 * → normalizeWeek), stessa shape di fantasy_data (team1/team2/starters/bench).
 * Finché il worker non è pubblicato (`wrangler deploy`) NON si inventano dati:
 * si mostra l'ultima settimana reale disponibile su Firebase con un'etichetta
 * esplicita "non è live", mai un finto punteggio.
 *
 * Fase 2 (successiva): motore eventi a delta, animazioni per giocata,
 * scontrini, timeline, notifiche — vedi piano di sessione.
 */

import { fetchFantasyData, displayName, teamNameHTML, CURRENT_SEASON, getSeasonConfig } from '../data.js?v=33';
import { TEAM_KEYS } from '../data/team-config.js?v=33';
import { TEAMS } from './team.js?v=83';
import { getWeekSchedule, canonAbbr } from '../data/nfl-schedule.js?v=20';
import { fetchPlays, resolveAthlete, headshotUrl } from '../data/nfl-plays.js?v=9';
import { scorePlay } from '../data/scoring.js?v=77';
import { PLAYER_ID_MAP, ESPN_TEAM_IDS } from '../data/player-map.js?v=13';
import { slotPairs } from '../data/matchup-analysis.js?v=13';
import { initPlayerModal } from '../components/player-modal.js?v=87';
import { playerImageService } from '../services/player-image-service.js?v=15';

// Da valorizzare dopo `wrangler deploy` (worker/espn-live-proxy.js), es.
// 'https://topina-espn-live-proxy.<account>.workers.dev'.
/**
 * URL del Cloudflare Worker live (worker/espn-live-proxy.js). Si imposta in
 * index.html senza toccare questo file:
 *   <script>window.TOPINA_LIVE_WORKER_URL = 'https://....workers.dev';</script>
 * Se non è impostato la pagina ripiega sull'ultima settimana reale di Firebase.
 */
const liveWorkerUrl = () => (typeof window !== 'undefined' && window.TOPINA_LIVE_WORKER_URL) || '';
const POLL_MS = 10000;

/** Etichette leggibili + segno atteso per ogni statistica tracciata. */
const STAT_LABELS = {
    pass_yds: 'Pass yds', pass_td: 'Passing TD', pass_int: 'Interception',
    pass_att: 'Pass attempts', pass_comp: 'Completions',
    rush_yds: 'Rush yds', rush_td: 'Rushing TD', rush_att: 'Carries',
    rec: 'Reception', rec_yds: 'Rec yds', rec_td: 'Receiving TD', targets: 'Target',
    ret_td: 'Return TD', fum_td: 'Fumble TD', two_pt: '2-PT', fum_lost: 'Fumble lost',
    pat_made: 'Extra point', fg_made: 'Field goal', fg_att: 'FG attempt',
    fg_0_39: 'FG 0-39', fg_40_49: 'FG 40-49', fg_50_plus: 'FG 50+',
    sack: 'Sack', def_int: 'DEF interception', fum_rec: 'Fumble recovery',
    safety: 'Safety', def_td: 'DEF TD', def_2pt_ret: 'DEF 2-PT return',
    def_ret_td: 'DEF return TD', pts_allowed: 'Points allowed', yds_allowed: 'Yards allowed',
};

/**
 * Statistiche mostrate sulla card: sempre 6 per ruolo (griglia 2×3), così tutti
 * i riquadri hanno la stessa dimensione e i valori a 0 diventano un trattino.
 * Le chiavi sono quelle reali dei dati 2026+ (fg_made/fg_att sono già forniti,
 * non vanno più ricalcolati sommando le fasce di distanza).
 */
const STATS_BY_ROLE = {
    QB: ['pass_comp', 'pass_att', 'pass_yds', 'pass_td', 'pass_int', 'rush_yds'],
    RB: ['rush_att', 'rush_yds', 'rush_td', 'targets', 'rec', 'rec_yds'],
    WR: ['targets', 'rec', 'rec_yds', 'rec_td', 'rush_yds', 'rush_td'],
    TE: ['targets', 'rec', 'rec_yds', 'rec_td', 'rush_yds', 'rush_td'],
    K: ['pat_made', 'fg_made', 'fg_att', 'fg_0_39', 'fg_40_49', 'fg_50_plus'],
    DEF: ['sack', 'def_int', 'fum_rec', 'def_td', 'pts_allowed', 'yds_allowed'],
};

/** Eventi "grossi": meritano evidenza nello scontrino. */
const BIG_EVENTS = new Set(['pass_td', 'rush_td', 'rec_td', 'ret_td', 'fum_td', 'def_td', 'def_ret_td',
    'pass_int', 'fum_lost', 'safety', 'fg_50_plus']);

let prevSnapshot = null;   // { playerName: { pts, stats } }
let receipts = [];         // storico scontrini (più recenti in testa)
let compareMode = false;   // false = campo, true = confronto titolari

let loaded = false;
let pollTimer = null;
let matchups = [];
let teamIdx = 0; // indice nell'elenco "piatto" delle 4 squadre (teamEntries())
let isLiveSource = false;
let weekLabelText = '';
let currentWeekNum = 1;  // settimana mostrata, passata alla scheda giocatore
let liveSchedule = null; // Map abbr → {start,end} per la settimana corrente (liveNow)

/**
 * Le 4 squadre della settimana, ciascuna con il proprio avversario — una entry
 * per squadra, non per matchup. `m` conserva l'ordine originale del matchup:
 * il banner resta sempre disposto allo stesso modo, cambia solo quale nome
 * viene evidenziato.
 */
function teamEntries() {
    const entries = [];
    for (const m of matchups) {
        entries.push({ team: m.team1, opp: m.team2, m });
        entries.push({ team: m.team2, opp: m.team1, m });
    }
    return entries;
}

/**
 * Stato infortunio del giocatore, o null se sta bene. I dati usano
 * `injury_status` (snake_case); il vecchio schema NFL.com usava `injuryStatus`,
 * quindi si accettano entrambi. NORMAL/ACTIVE significano "nessun problema".
 */
function injuryOf(p) {
    const v = p?.injury_status ?? p?.injuryStatus;
    return v && !['ACTIVE', 'NORMAL'].includes(v) ? v : null;
}

function teamOf(rawName) {
    return TEAMS[TEAM_KEYS[displayName(rawName)]] || null;
}

/**
 * Contesto partita per la scheda giocatore: nel Live conta la gara in corso,
 * non la carriera, quindi si passano punti e statistiche mostrati (proiezione
 * prima del kickoff, reali da lì in poi).
 */
function gameAttr(p) {
    const payload = {
        pts: effPts(p),
        projected: pIsProjected(p),
        opponent: p.opponent || '',
        status: p.status || '',
        week: currentWeekNum,
        year: CURRENT_SEASON,
        started: true,
        stats: (pIsProjected(p) ? p.projected_stats : p.stats) || p.stats || {},
    };
    return `data-game="${encodeURIComponent(JSON.stringify(payload))}"`;
}

const P = (m) => parseFloat(m) || 0;
const fmt = (n) => (+n).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

// Projections: before kickoff (started === false) show the projected value.
// Older/real data without `started`/`projected_*` falls back to real points.
const pIsProjected = (p) => p && p.started === false && p.projected_points != null;
const effPts = (p) => P(pIsProjected(p) ? p.projected_points : p.fantasy_points);
// Effective team score: projected total pre-game, real once points exist.
const teamEffScore = (t) => (P(t.score) === 0 && t.projected_score != null ? P(t.projected_score) : P(t.score));

export async function initLive() {
    if (loaded) return;
    loaded = true;
    initPlayerModal();
    restoreReceipts();

    const root = document.getElementById('live-root');
    if (!root) return;

    window.addEventListener('hashchange', () => {
        if (!location.hash.startsWith('#live')) { stopPolling(); stopPlayPolling(); }
    });
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) { stopPolling(); stopPlayPolling(); }
        else {
            if (isLiveSource) startPolling();
            startPlayPolling();
        }
    });

    await loadData();
}

function stopPolling() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}

function startPolling() {
    stopPolling();
    pollTimer = setInterval(() => loadData({ silent: true }), POLL_MS);
}

/** Il play-by-play non dipende dal Worker: gli bastano il calendario NFL e
 *  le partite in corso, quindi vive di vita propria rispetto al feed fantasy. */
function stopPlayPolling() {
    if (pbpTimer) { clearInterval(pbpTimer); pbpTimer = null; }
}

function startPlayPolling() {
    stopPlayPolling();
    if (!gamesToWatch().length) return;
    pollPlays();
    pbpTimer = setInterval(pollPlays, PBP_POLL_MS);
}

// ─── Play-by-play: una card per ogni azione dei nostri giocatori ──
//
// Il feed a delta (scontrini) sa solo che un totale è cambiato. Qui invece si
// legge il play-by-play vero di ESPN, dove ogni azione porta con sé i suoi
// protagonisti (chi ha lanciato, chi ha ricevuto) e le yard: da lì si ricava
// il tipo di giocata e — ricalcolandoli con lo scoring della lega — i punti
// che quella singola azione ha fruttato.
//
// I punti sulla card sono un NOSTRO ricalcolo: il totale del giocatore resta
// quello ufficiale del feed fantasy, che non viene mai toccato da qui.

const PBP_POLL_MS = 10000;
const PBP_MAX_CARDS = 30;

let pbpTimer = null;
let pbpSeen = new Set();   // id giocate già trasformate in card
let pbpCards = [];         // card pronte, più recenti in testa
let pbpFirstRun = true;    // al primo giro si riempie senza animare
let pbpBusy = false;

/** ESPN athlete id → giocatore di una nostra rosa. */
function rosterIndex() {
    const byAthlete = new Map();
    const byDefTeam = new Map();
    for (const m of matchups) {
        for (const side of ['team1', 'team2']) {
            const t = m[side];
            if (!t) continue;
            for (const p of [...(t.starters || []), ...(t.bench || [])]) {
                const pos = (p.position_in_team || p.position || '').toUpperCase();
                const entry = { name: p.name, team: t.name, pos, nfl: canonAbbr(p.nfl_team || '') };
                if (pos === 'DEF' || pos === 'D/ST') {
                    const id = ESPN_TEAM_IDS[entry.nfl];
                    if (id) byDefTeam.set(String(id), entry);
                } else {
                    const id = PLAYER_ID_MAP[p.name];
                    if (id) byAthlete.set(String(id), entry);
                }
            }
        }
    }
    return { byAthlete, byDefTeam };
}

/**
 * Modalità dimostrativa: `window.TOPINA_PBP_DEMO = '401772842'` (un id partita
 * ESPN) fa scorrere il play-by-play di una gara già giocata come se fosse in
 * corso, senza filtrare per rosa. Serve a vedere il widget fuori stagione —
 * fuori da qui non cambia niente del comportamento reale.
 */
/**
 * Solo in demo: i protagonisti della partita riprodotta vengono assegnati ai
 * giocatori delle nostre rose con lo stesso ruolo, e i numeri della giocata
 * finiscono davvero nei loro totali. Da lì in poi si accende TUTTO il resto
 * della pagina — punteggi che salgono, cerchi che lampeggiano, scontrini nello
 * scoring feed, infortuni — perché legge gli stessi dati di sempre.
 *
 * I numeri che compaiono a schermo in questo stato NON sono della lega: è per
 * questo che l'intestazione mostra un bollino DEMO ben visibile.
 */
const DEMO_ROLE_POS = {
    passer: ['QB'], rusher: ['RB'], receiver: ['WR', 'TE', 'W/R', 'RB/WR', 'FLEX'],
    kicker: ['K'], returner: ['WR', 'RB'],
};
let demoActorMap = new Map(); // espnId → giocatore di una nostra rosa
let demoNextTeam = 0;

/** Un giocatore nostro con quel ruolo, sempre lo stesso per lo stesso atleta. */
function demoPlayerFor(espnId, role) {
    if (demoActorMap.has(espnId)) return demoActorMap.get(espnId);
    const wanted = DEMO_ROLE_POS[role] || [];
    const entries = teamEntries();
    // alterna le squadre, così il punteggio si muove da entrambe le parti
    for (let k = 0; k < entries.length; k++) {
        const t = entries[(demoNextTeam + k) % entries.length].team;
        const cand = (t.starters || []).filter(p =>
            wanted.includes((p.position_in_team || p.position || '').toUpperCase()) &&
            ![...demoActorMap.values()].includes(p));
        if (cand.length) {
            demoNextTeam = (demoNextTeam + k + 1) % entries.length;
            demoActorMap.set(espnId, cand[0]);
            return cand[0];
        }
    }
    demoActorMap.set(espnId, null);
    return null;
}

/**
 * Azzera il tabellone all'inizio della demo: tutti i titolari "in campo" e a
 * zero punti, come al kickoff. Senza questo il banner sommerebbe punti reali
 * mentre le card dei giocatori mostrano ancora le proiezioni, e i due numeri
 * non tornerebbero mai.
 */
let demoBoardReady = false;
function resetDemoBoard() {
    if (demoBoardReady) return;
    demoBoardReady = true;
    for (const m of matchups) {
        for (const side of ['team1', 'team2']) {
            for (const p of [...(m[side]?.starters || []), ...(m[side]?.bench || [])]) {
                p.started = true;
                p.fantasy_points = 0;
                p.stats = {};
                delete p.injury_status;
            }
        }
    }
}

/** Riversa i numeri di una giocata sui giocatori mappati (solo demo). */
function applyDemoPlay(play, contribs) {
    resetDemoBoard();
    const touched = [];
    for (const c of contribs) {
        if (!c.espnId) continue;
        const p = demoPlayerFor(c.espnId, c.role);
        if (!p) continue;
        touched.push(p);
        p.stats = p.stats || {};
        for (const [k, v] of Object.entries(c.stats || {})) {
            if (v) p.stats[k] = (parseFloat(p.stats[k]) || 0) + v;
        }
        p.fantasy_points = +((parseFloat(p.fantasy_points) || 0) + c.pts).toFixed(2);
    }

    // Il referto medico si riempie da solo: il testo delle giocate segnala
    // davvero chi resta a terra ("... was injured during the play"). Si segna
    // uno dei protagonisti di QUESTA giocata, non uno a caso dello storico.
    if (touched.length && /was injured during the play/i.test(play.text || '')) {
        // Il referto mostra solo il matchup a schermo: si preferisce un
        // giocatore di quello, altrimenti la voce non si vedrebbe mai.
        const shown = teamEntries()[teamIdx];
        const inView = touched.find(p =>
            [...(shown.team.starters || []), ...(shown.opp.starters || [])].includes(p));
        (inView || touched[touched.length - 1]).injury_status = 'QUESTIONABLE';
    }

    // il punteggio di squadra è la somma dei titolari
    for (const m of matchups) {
        for (const side of ['team1', 'team2']) {
            const t = m[side];
            if (!t) continue;
            t.score = (t.starters || []).reduce((s, p) => s + (parseFloat(p.fantasy_points) || 0), 0).toFixed(2);
        }
    }
}

const pbpDemo = () => {
    if (typeof window === 'undefined') return '';
    // ?pbpdemo=401772842 così basta un link, senza toccare index.html
    const fromUrl = new URLSearchParams(location.search).get('pbpdemo');
    return fromUrl || window.TOPINA_PBP_DEMO || '';
};
let pbpDemoQueue = null;

/** Partite NFL in corso in cui gioca almeno un nostro tesserato. */
function gamesToWatch() {
    if (pbpDemo()) return [pbpDemo()];
    if (!liveSchedule) return [];
    const ids = new Map();
    for (const m of matchups) {
        for (const side of ['team1', 'team2']) {
            for (const p of [...(m[side]?.starters || []), ...(m[side]?.bench || [])]) {
                const g = liveSchedule.get(canonAbbr(p.nfl_team || ''));
                if (g?.eventId && g.state === 'in') ids.set(g.eventId, true);
            }
        }
    }
    return [...ids.keys()];
}

/**
 * Da giocata ESPN a card, se coinvolge qualcuno delle nostre rose.
 * Ritorna null se la giocata non ci riguarda.
 */
function playToCard(play, idx) {
    const contribs = scorePlay(play);
    const actors = [];
    let mine = false;

    // I due protagonisti dell'azione, nell'ordine in cui è avvenuta
    const order = ['passer', 'rusher', 'receiver', 'kicker', 'returner'];
    for (const role of order) {
        const espnId = play.actors[role];
        if (!espnId) continue;
        const own = idx.byAthlete.get(String(espnId)) || null;
        const c = contribs.find(x => x.espnId === espnId) || null;
        if (own) mine = true;
        actors.push({
            espnId, role, own,
            mine: !!own, // vera appartenenza alla rosa: la demo finge `own`, non questo
            pts: c ? c.pts : null,
            line: c ? c.line : '',
        });
    }

    // Difesa: il merito è dell'unità, non del singolo (sack, intercetto)
    for (const c of contribs.filter(x => x.defTeamId)) {
        const own = idx.byDefTeam.get(c.defTeamId);
        if (!own) continue;
        mine = true;
        actors.push({ espnId: null, defTeamId: c.defTeamId, role: c.role, own, mine: true, pts: c.pts, line: c.line });
    }

    // In demo non c'è una rosa da filtrare: si mostra tutto, con i protagonisti
    // accesi come se fossero nostri.
    if (pbpDemo()) {
        if (!actors.length) return null;
        actors.forEach(a => { a.own = a.own || { name: a.name || '', team: '', pos: '', nfl: '' }; });
    } else if (!mine) {
        return null;
    }
    return {
        id: play.id,
        type: play.type,
        text: play.text,
        yards: play.yards,
        scoring: play.scoring,
        period: play.period,
        clock: play.clock,
        ts: play.ts,
        actors,
    };
}

/** Un giro di polling: legge le nuove giocate e infila le card in cima. */
async function pollPlays() {
    if (pbpBusy) return;
    const games = gamesToWatch();
    if (!games.length) return;
    pbpBusy = true;
    try {
        const idx = rosterIndex();
        let lists;
        if (pbpDemo()) {
            // La partita è già finita: si scarica una volta e si rilasciano
            // poche giocate per giro, per riprodurre il ritmo del vivo.
            if (!pbpDemoQueue) pbpDemoQueue = await fetchPlays(games[0], { all: true });
            lists = [pbpDemoQueue.splice(0, 3)];
        } else {
            lists = await Promise.all(games.map(id => fetchPlays(id, { all: pbpFirstRun })));
        }
        const fresh = [];
        for (const plays of lists) {
            for (const play of plays) {
                if (pbpSeen.has(play.id)) continue;
                pbpSeen.add(play.id);
                if (pbpDemo()) applyDemoPlay(play, scorePlay(play));
                const card = playToCard(play, idx);
                if (card) fresh.push(card);
            }
        }
        if (!fresh.length) return;

        // nomi mancanti dalla mappa locale (rookie): risolti una volta sola
        await hydrateActorNames(fresh);

        fresh.sort((a, b) => a.ts - b.ts); // le più vecchie prima: entrano sotto
        for (const c of fresh) pbpCards.unshift(c);
        pbpCards = pbpCards.slice(0, PBP_MAX_CARDS);

        if (pbpDemo()) {
            // I totali sono cambiati: si passa dal percorso normale, quello che
            // in stagione reagisce ai dati del Worker. Così in demo si accendono
            // anche scoring feed, lampeggi sul campo, conteggi e referto medico.
            const events = updateReceipts();
            refreshInPlace(events);
            if (events.length) flashNewReceipts(events);
        }
        // Al primo giro la pila si riempie in blocco: animare tutto sarebbe
        // rumore. In demo invece ogni giro è "nuovo" per definizione.
        paintPlayCards(pbpFirstRun && !pbpDemo() ? [] : fresh.map(c => c.id));
    } finally {
        pbpFirstRun = false;
        pbpBusy = false;
    }
}

/** Nome leggibile per ogni protagonista: prima la mappa locale, poi ESPN. */
async function hydrateActorNames(cards) {
    const missing = new Set();
    for (const c of cards) {
        for (const a of c.actors) {
            if (a.own?.name || !a.espnId) continue;
            a.name = ESPN_ID_TO_NAME.get(String(a.espnId)) || null;
            if (!a.name) missing.add(String(a.espnId));
        }
    }
    if (!missing.size) return;
    const found = new Map();
    await Promise.all([...missing].map(async id => {
        const info = await resolveAthlete(id);
        if (info?.name) found.set(id, info.name);
    }));
    for (const c of cards) {
        for (const a of c.actors) {
            if (!a.name && a.espnId) a.name = found.get(String(a.espnId)) || '';
        }
    }
}

/** Mappa inversa nome→id, costruita una volta sola alla prima richiesta. */
const ESPN_ID_TO_NAME = new Map(
    Object.entries(PLAYER_ID_MAP).map(([name, id]) => [String(id), name]));

async function loadData({ silent = false } = {}) {
    const root = document.getElementById('live-root');
    if (!silent) root.innerHTML = `<div class="loading-state"><div class="spinner"></div><p>Loading live matchups...</p></div>`;

    const workerUrl = liveWorkerUrl();
    if (workerUrl) {
        try {
            const year = new Date().getFullYear();
            const res = await fetch(`${workerUrl}/live?season=${year}&week=${currentEspnWeek(year)}`);
            if (!res.ok) throw new Error(`worker ${res.status}`);
            const json = await res.json();
            if (Array.isArray(json.matchups) && json.matchups.length) {
                matchups = json.matchups;
                isLiveSource = true;
                weekLabelText = `${year} · Week ${currentEspnWeek(year)}`;
                await hydrateScheduleAndRender(String(year), currentEspnWeek(year));
                startPolling();
                return;
            }
        } catch (e) {
            console.warn('[live] worker non raggiungibile, fallback a Firebase:', e.message);
        }
    }

    // Fallback: ultima settimana reale disponibile su Firebase (non live).
    isLiveSource = false;
    stopPolling();
    const data = await fetchFantasyData(CURRENT_SEASON);
    if (!data?.weeks) {
        root.innerHTML = `<div class="empty-state"><p class="empty-state-text">No data available</p></div>`;
        return;
    }
    const weeks = Object.keys(data.weeks).map(Number).sort((a, b) => a - b);
    let pickedWeek = weeks[0];
    for (const w of weeks) {
        const wk = data.weeks[String(w)];
        if (wk?.matchups?.some(m => P(m.team1?.score) > 0 || P(m.team2?.score) > 0)) pickedWeek = w;
    }
    matchups = data.weeks[String(pickedWeek)]?.matchups || [];
    currentWeekNum = pickedWeek;
    const config = getSeasonConfig(CURRENT_SEASON);
    const roundLabel = pickedWeek === config.superBowlWeek ? 'Super Bowl'
        : pickedWeek === config.playoffWeek ? 'Playoffs' : `Week ${pickedWeek}`;
    weekLabelText = `${CURRENT_SEASON} · ${roundLabel}`;
    await hydrateScheduleAndRender(CURRENT_SEASON, pickedWeek);
}

/** Placeholder finché non è nota la week ESPN corrente lato client — il worker
 *  stesso di default usa status.currentMatchupPeriod se week è assente. */
function currentEspnWeek() {
    return 1;
}

async function hydrateScheduleAndRender(year, week) {
    try {
        liveSchedule = await getWeekSchedule(year, week);
    } catch {
        liveSchedule = null;
    }
    if (teamIdx >= teamEntries().length) teamIdx = 0;
    const fresh = updateReceipts();
    // Al primo giro la pagina va costruita; dai successivi si toccano solo i
    // numeri, altrimenti a ogni poll sparirebbero e ricomparirebbero le foto.
    if (document.getElementById('live-root')?.querySelector('.live-header')) refreshInPlace(fresh);
    else render();
    if (fresh.length) flashNewReceipts(fresh);
    if (!pbpTimer) startPlayPolling();
}

// ─── Motore eventi (delta tra due poll) ──────────────────────────

/** Fotografia dei giocatori correnti: nome → punti + stat, per il confronto al poll successivo. */
function takeSnapshot() {
    const snap = {};
    for (const m of matchups) {
        for (const side of ['team1', 'team2']) {
            const t = m[side];
            if (!t) continue;
            for (const p of [...(t.starters || []), ...(t.bench || [])]) {
                snap[p.name] = {
                    pts: P(p.fantasy_points),
                    stats: { ...(p.stats || {}) },
                    team: t.name,
                    pos: (p.position_in_team || p.position || '').toUpperCase(),
                    nfl: p.nfl_team || '',
                };
            }
        }
    }
    return snap;
}

/**
 * Confronta due fotografie e produce uno scontrino per ogni giocatore che ha
 * mosso qualcosa. Il delta punti può essere positivo, negativo o nullo:
 * anche una ricezione che non porta punti va segnalata, come richiesto.
 */
function detectEvents(prev, curr) {
    if (!prev) return [];
    const out = [];
    for (const [name, now] of Object.entries(curr)) {
        const before = prev[name];
        if (!before) continue;

        const changes = [];
        const keys = new Set([...Object.keys(before.stats), ...Object.keys(now.stats)]);
        for (const k of keys) {
            const d = (now.stats[k] || 0) - (before.stats[k] || 0);
            if (d !== 0) changes.push({ key: k, delta: d, big: BIG_EVENTS.has(k) });
        }

        const ptsDelta = +(now.pts - before.pts).toFixed(2);
        if (!changes.length && ptsDelta === 0) continue;

        // i TD e gli eventi negativi in cima allo scontrino
        changes.sort((a, b) => (b.big ? 1 : 0) - (a.big ? 1 : 0));
        out.push({
            id: `${name}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            name, team: now.team, pos: now.pos, nfl: now.nfl,
            changes, ptsDelta, ts: Date.now(),
            headline: headlineOf(changes),
        });
    }
    return out;
}

/**
 * Titolo dello scontrino. Prima gli eventi grossi, poi le azioni che si
 * raccontano da sole, e solo alla fine il ripiego. Senza questa scala il
 * titolo era la prima statistica che capitava, e si leggevano scontrini
 * intitolati "PASS ATTEMPTS" o "TARGET" — cioè niente.
 */
const HEADLINE_ORDER = [
    'fg_made', 'pat_made', 'sack', 'def_int', 'fum_rec',
    'rec', 'rec_yds', 'rush_yds', 'pass_yds', 'rush_att',
];

function headlineOf(changes) {
    const big = changes.find(c => c.big);
    if (big) return big.key;
    for (const key of HEADLINE_ORDER) {
        if (changes.some(c => c.key === key && c.delta > 0)) return key;
    }
    return null; // receiptHTML mostra "Update"
}

// ─── Aggiornamento senza ridisegno ───────────────────────────────
//
// A ogni poll cambiano dei numeri, non la pagina. Rifare l'HTML da capo
// ricostruiva anche tutte le foto, che sparivano e ricomparivano: la pagina
// resta ferma e si toccano solo i valori.

/** Tutti i giocatori del turno corrente, per nome. */
function playersByName() {
    const map = new Map();
    for (const m of matchups) {
        for (const side of ['team1', 'team2']) {
            for (const p of [...(m[side]?.starters || []), ...(m[side]?.bench || [])]) {
                if (p?.name) map.set(p.name, p);
            }
        }
    }
    return map;
}

/** Scrive un punteggio conservando lo stile "proiezione" quando serve. */
function writePts(el, p) {
    const val = fmt(effPts(p));
    const html = pIsProjected(p) ? `<span class="proj-pts">${val}</span>` : val;
    if (el.innerHTML !== html) el.innerHTML = html;
}

function refreshInPlace(events = []) {
    const root = document.getElementById('live-root');
    const entry = teamEntries()[teamIdx];
    if (!root || !entry) return;
    const byName = playersByName();

    // punteggi di squadra nel banner
    const { m } = entry;
    const scores = root.querySelectorAll('.gc-banner-score');
    const s = [teamEffScore(m.team1), teamEffScore(m.team2)];
    scores.forEach((el, i) => {
        const proj = P(m[`team${i + 1}`].score) === 0 && m[`team${i + 1}`].projected_score != null;
        const from = P(el.textContent);
        el.innerHTML = proj ? `<span class="proj-pts">${fmt(s[i])}</span>` : fmt(s[i]);
        el.classList.toggle('winner', s[i] >= s[1 - i]);
        if (!proj && from !== s[i]) countUp(el, from, s[i]);
    });

    // punti e statistiche di ogni giocatore a schermo (campo, panchina, chip,
    // righe di confronto: tutti marcati con la stessa chiave)
    root.querySelectorAll('[data-slot-player]').forEach(el => {
        const p = byName.get(el.dataset.slotPlayer);
        if (!p) return;
        if (el.classList.contains('live-cmp-pts')) { writePts(el, p); return; }
        const pts = el.querySelector('.slot-pts, .live-chip-pts');
        if (pts) writePts(pts, p);
        const stats = el.querySelector('.live-slot-stats');
        if (stats) stats.innerHTML = statLineHTML(p);
        el.setAttribute('data-game', gameAttr(p).slice('data-game="'.length, -1));
    });

    root.querySelectorAll('[data-cmp-stats]').forEach(el => {
        const p = byName.get(el.dataset.cmpStats);
        if (p) el.innerHTML = compareStatsHTML(p, el.dataset.cmpSide);
    });

    // scoring feed: si accodano i nuovi in cima, senza rifare la lista
    const feed = document.getElementById('live-receipts');
    if (feed && events.length) {
        if (feed.querySelector('.pm-empty')) feed.innerHTML = '';
        feed.insertAdjacentHTML('afterbegin', events.map(receiptHTML).join(''));
        while (feed.children.length > 40) feed.lastElementChild.remove();
        // le card entrano fuori da render(): le foto vanno risolte a mano,
        // o resterebbero per sempre sul segnaposto
        hydrateHeadshots(feed);
    }

    // referto medico: nessuna immagine, si può riscrivere per intero
    const inj = document.getElementById('live-injuries');
    if (inj) inj.innerHTML = injuriesHTML(entry.team, entry.opp);
}

/** Aggiorna lo storico scontrini dopo un poll (tenuti gli ultimi 40). */
function updateReceipts() {
    const curr = takeSnapshot();
    const events = detectEvents(prevSnapshot, curr);
    prevSnapshot = curr;
    if (events.length) {
        receipts = [...events, ...receipts].slice(0, 40);
        try { sessionStorage.setItem('topina-live-receipts', JSON.stringify(receipts)); } catch { /* quota */ }
    }
    return events;
}

function restoreReceipts() {
    try {
        const raw = sessionStorage.getItem('topina-live-receipts');
        if (raw) receipts = JSON.parse(raw) || [];
    } catch { receipts = []; }
}

function liveNow(p) {
    const w = p?.nfl_team ? liveSchedule?.get(canonAbbr(p.nfl_team)) : null;
    const now = Date.now();
    return !!w && now >= w.start.getTime() && now <= w.end.getTime();
}

// ─── Rendering ────────────────────────────────────────────────────

function render() {
    const root = document.getElementById('live-root');
    const entries = teamEntries();
    if (!entries.length) {
        root.innerHTML = `<div class="empty-state"><p class="empty-state-text">No live matchups right now</p></div>`;
        return;
    }
    const entry = entries[teamIdx];
    const { team, opp } = entry;

    root.innerHTML = `
    ${headerHTML()}
    ${teamSwitcherHTML(entries)}
    ${matchupCardHTML(entry)}
    ${compareMode ? compareHTML(team, opp) : fieldHTML(team)}
    <div class="live-widgets">
        ${playFeedHTML()}
        ${receiptsPanelHTML()}
        ${sidebarHTML(team, opp)}
    </div>
    <div class="live-layout">
        <div class="live-main">
            ${rosterLiveHTML(team, opp)}
        </div>
    </div>`;

    hydrateHeadshots(root);
    root.querySelector('.live-refresh-btn')?.addEventListener('click', () => loadData());
    root.querySelectorAll('.live-team-pill').forEach(btn => {
        btn.addEventListener('click', () => {
            teamIdx = Number(btn.dataset.idx);
            render();
        });
    });

    root.querySelector('[data-compare]')?.addEventListener('click', () => {
        compareMode = !compareMode;
        render();
    });
    root.querySelector('[data-swap]')?.addEventListener('click', showOpponent);
    bindSwipe(root.querySelector('[data-swipe]'));
    bindDeck(root);
    layoutDeck();
}

/**
 * Passa alla squadra avversaria mantenendo la vista corrente. La scheda
 * dell'avversario entra dal lato verso cui punta la freccia.
 */
function showOpponent() {
    const entries = teamEntries();
    const { opp } = entries[teamIdx];
    const goingForward = teamIdx % 2 === 0;
    const next = entries.findIndex(e => e.team === opp);
    if (next >= 0) teamIdx = next;

    // Dissolvenza incrociata: le due schede si muovono INSIEME, quella che
    // esce sfuma mentre l'altra entra dal lato opposto. Prima uscivano una
    // dopo l'altra, e in mezzo restava un istante di vuoto.
    //
    // Il contenuto vecchio non si può animare dopo render(), che riscrive
    // tutta la pagina: se ne tiene una copia sovrapposta al nuovo, e sparisce
    // a fine transizione.
    const outgoing = document.querySelector('[data-swipe]');
    const stage = outgoing?.closest('.live-stage');
    if (!outgoing || !stage || !outgoing.animate || matchMedia('(prefers-reduced-motion: reduce)').matches) {
        render();
        return;
    }

    const ghost = outgoing.cloneNode(true);
    ghost.classList.add('live-ghost');
    ghost.removeAttribute('data-swipe');
    const frozenHeight = stage.getBoundingClientRect().height;

    render();

    const newStage = document.querySelector('.live-stage');
    const incoming = document.querySelector('[data-swipe]');
    if (!newStage || !incoming) return;
    // la copia è fuori flusso: senza questo il palco collasserebbe per un
    // istante all'altezza del nuovo contenuto non ancora disegnato
    newStage.style.minHeight = `${frozenHeight}px`;
    newStage.appendChild(ghost);

    const D = 440;
    const E = 'cubic-bezier(0.22, 1, 0.36, 1)';
    const out = goingForward ? '-42%' : '42%';
    const inFrom = goingForward ? '42%' : '-42%';

    ghost.animate([
        { transform: 'translateX(0)', opacity: 1 },
        { transform: `translateX(${out})`, opacity: 0 },
    ], { duration: D, easing: E, fill: 'forwards' }).onfinish = () => {
        ghost.remove();
        newStage.style.minHeight = '';
    };

    incoming.animate([
        { transform: `translateX(${inFrom})`, opacity: 0 },
        { transform: 'none', opacity: 1 },
    ], { duration: D, easing: E });
}

/** Swipe orizzontale sul campo/confronto → mostra l'avversario. */
function bindSwipe(el) {
    if (!el) return;
    let x0 = null;
    el.addEventListener('touchstart', (e) => { x0 = e.changedTouches[0].clientX; }, { passive: true });
    el.addEventListener('touchend', (e) => {
        if (x0 == null) return;
        const dx = e.changedTouches[0].clientX - x0;
        x0 = null;
        if (Math.abs(dx) > 60) showOpponent();
    }, { passive: true });
}

/**
 * Stato in alto: pallino pulsante quando ci sono partite in corso, icona di
 * proiezione quando i numeri mostrati sono stime pre-kickoff.
 */
function statusBadgeHTML() {
    const entries = teamEntries();
    const shown = entries[teamIdx];
    const players = shown
        ? [...(shown.team.starters || []), ...(shown.opp.starters || [])]
        : [];
    const anyLive = players.some(p => p && p.started === true);
    const anyProjected = players.some(pIsProjected);

    if (anyLive) return '<i class="gb-live-dot"></i> LIVE';
    if (anyProjected) return `
        <svg class="live-proj-icon" viewBox="0 0 24 24" width="13" height="13" fill="none"
             stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <polyline points="3 17 9 11 13 15 21 7"></polyline>
            <polyline points="15 7 21 7 21 13"></polyline>
        </svg> PROJECTED`;
    return 'FINAL';
}

function headerHTML() {
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    return `
    <div class="live-header">
        <div class="live-header-left">
            <h1 class="live-header-title">${weekLabelText}</h1>
            <span class="live-header-kicker">
                ${pbpDemo() ? '<span class="live-demo-badge">DEMO · numeri non reali</span>' : ''}
                ${statusBadgeHTML()}
            </span>
        </div>
        <div class="live-header-right">
            <span class="live-header-updated">Updated ${hh}:${mm}</span>
            <button class="live-refresh-btn" type="button" aria-label="Refresh">↻</button>
        </div>
    </div>`;
}

/** Selettore a 4 squadre — stessa classe .year-pill usata altrove nel sito (game-center.js). */
function teamSwitcherHTML(entries) {
    return `
    <div class="year-selector live-team-selector">
        ${entries.map(({ team }, i) => `
        <button class="year-pill live-team-pill${i === teamIdx ? ' active' : ''}" data-idx="${i}">
            ${teamNameHTML(team.name)}
        </button>`).join('')}
    </div>`;
}

/**
 * Banner punteggio — stessa identità visiva del banner di Game Center.
 * La disposizione segue sempre l'ordine del matchup (team1 a sinistra):
 * cambiando squadra si sposta solo il contorno colorato sul nome selezionato.
 */
function matchupCardHTML(entry) {
    const { m, team: selected } = entry;
    const left = m.team1, right = m.team2;
    const proj1 = P(left.score) === 0 && left.projected_score != null;
    const proj2 = P(right.score) === 0 && right.projected_score != null;
    const s1 = teamEffScore(left), s2 = teamEffScore(right);
    const t1 = teamOf(left.name), t2 = teamOf(right.name);
    const total = s1 + s2;
    const pct1 = total > 0 ? Math.round((s1 / total) * 100) : 50;
    const selLeft = selected === left;

    return `
    <div class="live-scorebar" style="--tc1:${t1?.color || 'var(--accent-red)'};--tc2:${t2?.color || 'var(--accent-blue)'};--tc-sel:${(selLeft ? t1 : t2)?.color || 'var(--accent-red)'}">
        <div class="gc-banner">
            ${t1?.logo ? `<img class="gc-banner-wm gc-banner-wm-l" src="${t1.logo}" alt="" aria-hidden="true">` : ''}
            ${t2?.logo ? `<img class="gc-banner-wm gc-banner-wm-r" src="${t2.logo}" alt="" aria-hidden="true">` : ''}
            <div class="gc-banner-inner">
                <div class="gc-banner-side">
                    <span class="gc-banner-name${selLeft ? ' live-name-selected' : ''}">${teamNameHTML(t1?.name || left.name)}</span>
                </div>
                <span class="gc-banner-score${s1 >= s2 ? ' winner' : ''}">${proj1 ? `<span class="proj-pts">${fmt(s1)}</span>` : fmt(s1)}</span>
                <div class="gc-banner-mid">
                    <span class="gc-banner-vs">${isLiveSource ? 'live' : 'vs'}</span>
                </div>
                <span class="gc-banner-score${s2 >= s1 ? ' winner' : ''}">${proj2 ? `<span class="proj-pts">${fmt(s2)}</span>` : fmt(s2)}</span>
                <div class="gc-banner-side gc-banner-side-r">
                    <span class="gc-banner-name${selLeft ? '' : ' live-name-selected'}">${teamNameHTML(t2?.name || right.name)}</span>
                </div>
            </div>
        </div>
        <div class="live-mc-probbar">
            <div class="live-mc-probfill" style="width:${pct1}%"></div>
        </div>
        <div class="live-mc-probLabels">
            <span>${pct1}%</span>
            <span>${100 - pct1}%</span>
        </div>
    </div>`;
}

function chip(p, side) {
    if (!p) return '<div class="live-chip live-chip--empty"></div>';
    const role = (p.position_in_team || p.position || '').toUpperCase();
    const live = liveNow(p);
    const injury = injuryOf(p);
    return `
    <div class="live-chip${live ? ' live-chip--live' : ''}${injury ? ' live-chip--injury' : ''}" data-player-modal
         data-slot-player="${escAttr(p.name)}"
         data-player-name="${escAttr(p.name)}" data-pos="${escAttr(role)}" data-nfl="${escAttr(p.nfl_team || '')}" data-year="${CURRENT_SEASON}"
         ${gameAttr(p)}>
        <span class="live-chip-photo">
            <img src="${cachedHeadshot(p.name)}" alt="" loading="lazy"
                 data-headshot data-player-name="${p.name}" data-team="${p.nfl_team || ''}" data-pos="${role}">
            ${live ? '<i class="gb-live-dot live-chip-dot"></i>' : ''}
        </span>
        <span class="live-chip-name">${shortName(p)}</span>
        <span class="live-chip-pts">${pIsProjected(p) ? `<span class="proj-pts">${fmt(effPts(p))}</span>` : fmt(effPts(p))}</span>
        ${injury ? `<span class="live-chip-injury-badge">${injury}</span>` : ''}
    </div>`;
}

function shortName(p) {
    const role = (p.position_in_team || p.position || '').toUpperCase();
    if (role === 'DEF' || role === 'D/ST') return p.name;
    const parts = String(p.name).trim().split(/\s+/);
    return parts.length < 2 ? p.name : `${parts[0][0]}. ${parts.slice(1).join(' ')}`;
}

function escAttr(s) {
    return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function byPos(starters, pos, nth = 0) {
    let count = 0;
    for (const p of starters) {
        const pp = (p.position || '').toUpperCase();
        if (pp === pos || (pos === 'FLEX' && (pp === 'RB/WR' || pp === 'W/R'))) {
            if (count === nth) return p;
            count++;
        }
    }
    return null;
}

/** Valore di una statistica, con la somma dei field goal per la chiave virtuale fg_made. */
function statValue(stats, key) {
    if (key === 'fg_made') {
        // I dati 2026+ forniscono già il totale; le fasce si sommano solo per
        // il vecchio schema NFL.com, che non aveva fg_made.
        if (stats.fg_made != null) return stats.fg_made;
        return ['fg_0_19', 'fg_20_29', 'fg_30_39', 'fg_0_39', 'fg_40_49', 'fg_50_plus']
            .reduce((s, k) => s + (stats[k] || 0), 0);
    }
    return stats[key] || 0;
}

/** Riquadro statistiche: sempre 4 voci per ruolo, trattino se a zero. */
function statLineHTML(p) {
    let role = (p.position_in_team || p.position || '').toUpperCase();
    if (role === 'W/R' || role === 'RB/WR' || role === 'FLEX') role = 'WR';
    if (role === 'D/ST') role = 'DEF';
    const keys = STATS_BY_ROLE[role] || STATS_BY_ROLE.WR;
    // Before kickoff show the projected stat line (real stats are all zero).
    const proj = pIsProjected(p);
    const stats = (proj ? p.projected_stats : p.stats) || p.stats || {};
    return keys.map(k => {
        const raw = statValue(stats, k);
        // Le proiezioni arrivano con due decimali (es. 83.48): troppo lunghe per
        // la card, verrebbero troncate. Interi per i conteggi, un decimale per
        // le frazioni piccole.
        const v = proj ? (raw >= 10 ? Math.round(raw) : Math.round(raw * 10) / 10) : raw;
        return `<span class="live-stat${v === 0 ? ' live-stat--zero' : ''}">
            <b>${v === 0 ? '–' : v}</b> ${shortStatLabel(k)}</span>`;
    }).join('');
}

/** Etichetta corta per la card (quella lunga sta negli scontrini). */
function shortStatLabel(k) {
    return ({
        pass_yds: 'PaYd', pass_td: 'PaTD', pass_int: 'INT',
        rush_yds: 'RuYd', rush_td: 'RuTD',
        rec: 'Rec', rec_yds: 'ReYd', rec_td: 'ReTD',
        pass_att: 'Att', pass_comp: 'Cmp', rush_att: 'Car', targets: 'Tgt',
        pat_made: 'XP', fg_made: 'FG', fg_att: 'FGA',
        fg_0_39: 'FG0-39', fg_40_49: 'FG40', fg_50_plus: 'FG50+',
        sack: 'Sck', def_int: 'INT', fum_rec: 'FR', def_td: 'TD',
        safety: 'SAF', pts_allowed: 'PA', yds_allowed: 'YdA',
    })[k] || k;
}

/** Slot giocatore sul campo — card con foto, nome, punti e statistiche. */
function fieldSlot(p, extraClass = '') {
    if (!p) return '';
    const role = (p.position_in_team || p.position || '').toUpperCase();
    const live = liveNow(p);
    const injury = injuryOf(p);
    return `
    <div class="formation-slot live-slot${live ? ' live-slot--live' : ''}${extraClass}" data-player-modal
         data-slot-player="${escAttr(p.name)}"
         data-player-name="${escAttr(p.name)}" data-pos="${escAttr(role)}" data-nfl="${escAttr(p.nfl_team || '')}" data-year="${CURRENT_SEASON}"
         ${gameAttr(p)}>
        <span class="slot-photo"><img src="${cachedHeadshot(p.name)}" alt="" loading="lazy"
            data-headshot data-player-name="${p.name}" data-team="${p.nfl_team || ''}" data-pos="${role}">
            ${live ? '<i class="gb-live-dot live-slot-dot"></i>' : ''}</span>
        <span class="slot-name">${shortName(p)}</span>
        <span class="slot-pts">${pIsProjected(p) ? `<span class="proj-pts">${fmt(effPts(p))}</span>` : fmt(effPts(p))}</span>
        <span class="live-slot-stats">${statLineHTML(p)}</span>
        ${injury ? `<span class="live-slot-inj">${escAttr(injury)}</span>` : ''}
    </div>`;
}

function olineSlot() {
    return `<div class="formation-slot oline-x">✕</div>`;
}

/**
 * Formazione vista dall'alto, con l'attacco rivolto verso la end zone in alto:
 * righe orizzontali (scrimmage → QB → RB → K/DEF), come le yard line del campo.
 */
function fieldFormationHTML(team) {
    const s = team.starters || [];
    return `
    <div class="live-row live-row--st">${fieldSlot(byPos(s, 'K'))}${fieldSlot(byPos(s, 'DEF') || byPos(s, 'D/ST'))}</div>
    <div class="live-formation-bottom">
        <div class="live-row live-row--line">
            ${fieldSlot(byPos(s, 'WR', 0))}${fieldSlot(byPos(s, 'TE'))}
            ${olineSlot()}${olineSlot()}${olineSlot()}${olineSlot()}${olineSlot()}
            ${fieldSlot(byPos(s, 'FLEX'))}${fieldSlot(byPos(s, 'WR', 1))}
        </div>
        <div class="live-row live-row--backfield">
            ${fieldSlot(byPos(s, 'RB', 0))}
            ${fieldSlot(byPos(s, 'QB'))}
            ${fieldSlot(byPos(s, 'RB', 1))}
        </div>
    </div>`;
}

/**
 * Freccia accanto all'immagine: punta a destra quando si guarda la prima
 * squadra del matchup (si va all'avversario), a sinistra sull'avversario
 * (si torna indietro).
 */
function swapArrowHTML() {
    const back = teamIdx % 2 === 1;
    const points = back ? '15 6 9 12 15 18' : '9 6 15 12 9 18';
    return `
    <button class="live-swap-btn live-swap-btn--${back ? 'left' : 'right'}" type="button" data-swap
            aria-label="${back ? 'Back to the other team' : 'Show the opponent'}">
        <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor"
             stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <polyline points="${points}"></polyline>
        </svg>
    </button>`;
}

/** Classe di animazione da applicare al riquadro dopo uno swap. */
/** Campo di una singola squadra, orizzontale, sfondo campo visibile (stile Game Center). */
function fieldHTML(team) {
    return `
    <div class="live-field-head">
        <span class="live-field-label">${teamNameHTML(team.name)}</span>
        <div class="live-field-controls">
            <button class="live-compare-btn" type="button" data-compare>Compare</button>
        </div>
    </div>
    <div class="live-stage">
        <div class="live-field-slider" data-swipe>
            <div class="matchup-field-horizontal live-field-solo">
                <img src="Wallpapers/IMG_5984.PNG" class="field-bg" alt="">
                <div class="field-overlay">
                    <div class="live-formation-stack">
                        ${fieldFormationHTML(team)}
                    </div>
                </div>
                <!-- la freccia sta DENTRO il campo: così resta centrata su di
                     esso e non sull'insieme campo+panchina -->
                ${swapArrowHTML()}
            </div>
            ${benchHTML(team)}
        </div>
    </div>`;
}

/** Panchina in riga sotto al campo: stesse card, in formato ridotto. */
function benchHTML(team) {
    const bench = team.bench || [];
    if (!bench.length) return '';
    return `
    <div class="live-bench">
        <span class="live-bench-label">Bench</span>
        <div class="live-bench-row">
            ${bench.map(p => fieldSlot(p, ' live-slot--bench')).join('')}
        </div>
    </div>`;
}

/** Foto tonda usata nel confronto (stesso trattamento a vetro del campo). */
function comparePhoto(p) {
    if (!p) return '<span class="live-cmp-photo live-cmp-photo--empty"></span>';
    const role = (p.position_in_team || p.position || '').toUpperCase();
    return `<span class="live-cmp-photo"><img src="${cachedHeadshot(p.name)}" alt="" loading="lazy"
        data-headshot data-player-name="${p.name}" data-team="${p.nfl_team || ''}" data-pos="${role}"></span>`;
}

/**
 * Statistiche del confronto a riquadri (numero sopra, etichetta sotto), come
 * in Game Center: i primi due valori escono sempre, il resto solo se > 0.
 */
function compareStatsHTML(p, side) {
    // Prima del kickoff le stat reali sono tutte a zero: si mostrano le proiezioni
    // (stesso criterio dei punti, vedi pIsProjected).
    const proj = pIsProjected(p);
    const s = (proj ? p?.projected_stats : p?.stats) || p?.stats || {};
    // le proiezioni sono decimali (es. 2.52 ricezioni): una cifra basta
    const n = (v) => {
        const x = Number(v) || 0;
        return proj ? Math.round(x * 10) / 10 : x;
    };
    let role = (p?.position_in_team || p?.position || '').toUpperCase();
    if (role === 'W/R' || role === 'RB/WR' || role === 'FLEX') role = 'WR';
    if (role === 'D/ST') role = 'DEF';

    const CANDIDATES = {
        QB: [[n(s.pass_yds), 'pass yd'], [n(s.pass_td), 'td'], [n(s.pass_int), 'int'], [n(s.rush_yds), 'rush yd']],
        RB: [[n(s.rush_yds), 'rush yd'], [n(s.rush_td), 'td'], [n(s.rec_yds), 'rec yd'], [n(s.rec_td), 'rec td']],
        WR: [[n(s.rec), 'rec'], [n(s.rec_yds), 'rec yd'], [n(s.rec_td), 'td']],
        TE: [[n(s.rec), 'rec'], [n(s.rec_yds), 'rec yd'], [n(s.rec_td), 'td']],
        K: [[n(s.fg_0_19) + n(s.fg_20_29) + n(s.fg_30_39) + n(s.fg_40_49) + n(s.fg_50_plus), 'fg'], [n(s.pat_made), 'xp']],
        DEF: [[n(s.sack), 'sack'], [n(s.def_int) + n(s.fum_rec), 'to'], [n(s.def_td), 'td']],
    };
    const list = (CANDIDATES[role] || CANDIDATES.WR).filter(([v], i) => i < 2 || v > 0).slice(0, 3);
    const cells = list.map(([v, l]) =>
        `<span class="live-cmp-mini"><b${proj ? ' class="proj-pts"' : ''}>${v}</b><i>${l}</i></span>`);

    // Sempre tre celle: chi ne ha meno viene riempito con caselle vuote dal lato
    // esterno, così le colonne restano incolonnate fra righe con ruoli diversi
    // (un kicker ha 2 valori, un QB 3) e i valori restano accostati al punteggio.
    const pad = '<span class="live-cmp-mini live-cmp-mini--pad"></span>';
    while (cells.length < CMP_STAT_COLS) side === 'l' ? cells.unshift(pad) : cells.push(pad);
    return cells.join('');
}

/** Colonne di statistica per lato nel confronto (vedi .live-cmp-stats). */
const CMP_STAT_COLS = 3;

/** Nome + ruolo/squadra, sul bordo esterno della riga. */
function compareName(p, side) {
    if (!p) return `<div class="live-cmp-who live-cmp-who--${side}"><span class="live-cmp-empty">—</span></div>`;
    const role = (p.position_in_team || p.position || '').toUpperCase();
    const meta = [role, p.nfl_team].filter(Boolean).join(' · ')
        + (p.opponent ? ` | vs ${String(p.opponent).replace('@', '')}` : '');
    return `
    <div class="live-cmp-who live-cmp-who--${side}"
         data-player-modal data-player-name="${escAttr(p.name)}"
         data-pos="${escAttr(role)}" data-nfl="${escAttr(p.nfl_team || '')}" data-year="${CURRENT_SEASON}"
         ${gameAttr(p)}>
        <span class="live-cmp-name">${escAttr(p.name)}</span>
        <span class="live-cmp-meta">${escAttr(meta)}</span>
    </div>`;
}

/** Statistiche di un lato, accostate al punteggio centrale. */
function compareStatsBlock(p, win, side) {
    // Anche senza giocatore il blocco tiene le sue colonne, altrimenti la riga
    // si stringe e i punteggi non sono più incolonnati con quelli sopra e sotto.
    const inner = p
        ? compareStatsHTML(p, side)
        : `<span class="live-cmp-mini live-cmp-mini--pad"></span>`.repeat(CMP_STAT_COLS);
    return `<span class="live-cmp-stats live-cmp-stats--${side}${win ? ' live-cmp-stats--win' : ''}"${p ? ` data-cmp-stats="${escAttr(p.name)}" data-cmp-side="${side}"` : ''}>${inner}</span>`;
}

/**
 * Confronto titolari: foto tonde ai lati, ruolo al centro, statistiche e punti
 * di ciascuno. I numeri di chi ha fatto meglio nella riga restano accesi,
 * quelli dell'altro sono "spenti".
 */
function compareHTML(team, opp) {
    const pairs = slotPairs({ team1: team, team2: opp });
    const t1 = teamOf(team.name), t2 = teamOf(opp.name);

    return `
    <div class="live-field-head">
        <span class="live-field-label">${teamNameHTML(team.name)} <span class="live-cmp-vs">vs</span> ${teamNameHTML(opp.name)}</span>
        <div class="live-field-controls">
            <button class="live-compare-btn live-compare-btn--on" type="button" data-compare>Field</button>
        </div>
    </div>
    <div class="live-stage">
    <div class="live-compare" style="--tc1:${t1?.color || 'var(--accent-red)'};--tc2:${t2?.color || 'var(--accent-blue)'}" data-swipe>
        ${pairs.map(({ slot, a, b }) => {
        const pa = a ? effPts(a) : 0, pb = b ? effPts(b) : 0;
        const aWin = !!a && pa >= pb;
        const bWin = !!b && pb >= pa;
        return `
        <div class="live-cmp-row">
            ${comparePhoto(a)}
            ${compareName(a, 'l')}
            ${compareStatsBlock(a, aWin, 'l')}
            <span class="live-cmp-pts${aWin ? ' live-cmp-pts--win' : ''}"${a ? ` data-slot-player="${escAttr(a.name)}"` : ''}>${a ? (pIsProjected(a) ? `<span class="proj-pts">${fmt(pa)}</span>` : fmt(pa)) : '—'}</span>
            <span class="live-cmp-slot">${slot}</span>
            <span class="live-cmp-pts${bWin ? ' live-cmp-pts--win' : ''}"${b ? ` data-slot-player="${escAttr(b.name)}"` : ''}>${b ? (pIsProjected(b) ? `<span class="proj-pts">${fmt(pb)}</span>` : fmt(pb)) : '—'}</span>
            ${compareStatsBlock(b, bWin, 'r')}
            ${compareName(b, 'r')}
            ${comparePhoto(b)}
        </div>`;
    }).join('')}
    </div>
    ${swapArrowHTML()}
    </div>`;
}

function rosterLiveHTML(team, opp) {
    const all = [...(team.starters || []), ...(team.bench || []),
    ...(opp.starters || []), ...(opp.bench || [])];
    const live = all.filter(liveNow);
    if (!live.length) return '';
    return `
    <div class="mosaic-card mc-wide mc-in live-card">
        <span class="mc-kicker">Currently playing</span>
        <div class="live-roster-grid">
            ${live.map(p => chip(p)).join('')}
        </div>
    </div>`;
}

/** Scontrino singolo: cosa è cambiato e quanti punti ha prodotto. */
function receiptHTML(r) {
    const time = new Date(r.ts).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
    const sign = r.ptsDelta > 0 ? 'pos' : r.ptsDelta < 0 ? 'neg' : 'flat';
    const head = r.headline ? (STAT_LABELS[r.headline] || r.headline) : 'Update';
    const isBig = r.headline && BIG_EVENTS.has(r.headline);
    // Stesse classi delle card di Live plays: i due pannelli raccontano la
    // stessa partita da due fonti diverse, devono somigliarsi. Qui c'è sempre
    // un solo giocatore, quindi i punti stanno sulla sua riga e la riga
    // "totale" non serve — ripeterebbe lo stesso numero.
    const role = (r.pos || '').toUpperCase();
    const lines = r.changes.map(c =>
        `${STAT_LABELS[c.key] || c.key} ${c.delta > 0 ? '+' : ''}${c.delta}`).join(' · ');
    return `
    <article class="pbp-card${isBig ? ' pbp-card--score' : ''}" data-receipt="${r.id}">
        <header class="pbp-card-head">
            <span class="pbp-card-type">${escAttr(head)}</span>
            <span class="pbp-card-when">${time}</span>
        </header>
        <div class="pbp-card-actors">
            <div class="pbp-actor pbp-actor--own">
                <span class="pbp-actor-photo">
                    <img src="${cachedHeadshot(r.name)}" alt="" loading="lazy"
                         data-headshot data-player-name="${escAttr(r.name)}"
                         data-team="${escAttr(r.nfl || '')}" data-pos="${escAttr(role)}">
                </span>
                <span class="pbp-actor-meta">
                    <b>${escAttr(r.name)}</b>
                    <i>${escAttr([role, r.nfl].filter(Boolean).join(' · '))}</i>
                </span>
                <span class="pbp-actor-pts ${sign}">${r.ptsDelta > 0 ? '+' : ''}${r.ptsDelta.toFixed(2)}</span>
            </div>
        </div>
        <p class="pbp-card-text">${escAttr(lines)}</p>
    </article>`;
}

// ─── Widget play-by-play: HTML ───────────────────────────────────

/** Etichetta breve del tipo di giocata. */
const PLAY_LABEL = {
    'Pass Reception': 'Reception',
    'Passing Touchdown': 'Passing TD',
    'Rushing Touchdown': 'Rushing TD',
    'Pass Incompletion': 'Incomplete',
    'Pass Interception Return': 'Interception',
    'Field Goal Good': 'Field goal',
    'Rush': 'Rush',
    'Sack': 'Sack',
};

const ROLE_LABEL = {
    passer: 'QB', receiver: 'REC', rusher: 'RUSH',
    kicker: 'K', returner: 'RET', sack: 'DEF', def_int: 'DEF',
};

function playActorHTML(a) {
    const name = a.own?.name || a.name || '—';
    const photo = a.defTeamId
        ? (TEAMS[TEAM_KEYS[displayName(a.own?.team || '')]]?.logo || '')
        : headshotUrl(a.espnId);
    const pts = a.pts == null ? '' :
        `<span class="pbp-actor-pts ${a.pts > 0 ? 'pos' : a.pts < 0 ? 'neg' : 'flat'}">${a.pts > 0 ? '+' : ''}${a.pts.toFixed(2)}</span>`;
    return `
    <div class="pbp-actor${a.own ? ' pbp-actor--own' : ''}">
        <span class="pbp-actor-photo">
            <img src="${photo}" alt="" loading="lazy" onerror="this.src='images/fallback-player.svg'">
        </span>
        <span class="pbp-actor-meta">
            <b>${escAttr(name)}</b>
            <i>${ROLE_LABEL[a.role] || a.role}${a.line ? ` · ${escAttr(a.line)}` : ''}</i>
        </span>
        ${pts}
    </div>`;
}

function playCardHTML(c) {
    const label = PLAY_LABEL[c.type] || c.type || 'Play';
    const when = [c.period ? `Q${c.period}` : '', c.clock].filter(Boolean).join(' ');
    // Il totale ha senso solo se in quella giocata ci sono DUE miei giocatori
    // (il lancio del mio QB al mio ricevitore): con uno solo ripeterebbe il
    // numero già scritto sulla sua riga, e sommare i punti di un avversario
    // non vorrebbe dire niente.
    const ours = c.actors.filter(a => a.mine && a.pts);
    const total = ours.length >= 2 ? ours.reduce((s, a) => s + a.pts, 0) : 0;
    return `
    <article class="pbp-card${c.scoring ? ' pbp-card--score' : ''}" data-play="${c.id}">
        <header class="pbp-card-head">
            <span class="pbp-card-type">${escAttr(label)}</span>
            <span class="pbp-card-when">${escAttr(when)}</span>
        </header>
        <div class="pbp-card-actors">${c.actors.map(playActorHTML).join('')}</div>
        <p class="pbp-card-text">${escAttr(c.text)}</p>
        ${total ? `<div class="pbp-card-total"><span>Fantasy</span><b class="${total > 0 ? 'pos' : 'neg'}">${total > 0 ? '+' : ''}${total.toFixed(2)}</b></div>` : ''}
    </article>`;
}

function playFeedHTML() {
    return `
    <div class="mosaic-card mc-in live-side-card pbp-card-stack">
        <span class="mc-kicker">Live plays</span>
        <div class="pbp-stack" id="pbp-stack" data-deck>
            ${pbpCards.length
            ? pbpCards.map(playCardHTML).join('')
            : `<p class="pm-empty">${gamesToWatch().length
                ? 'Waiting for the next play...'
                : 'No NFL game in progress with your players.'}</p>`}
        </div>
        <div class="pbp-deck-nav" hidden>
            <button type="button" class="pbp-deck-btn" data-deck-step="-1" aria-label="Newer play">↑</button>
            <span class="pbp-deck-count"></span>
            <button type="button" class="pbp-deck-btn" data-deck-step="1" aria-label="Older play">↓</button>
        </div>
    </div>`;
}

/**
 * Mazzo: la giocata più recente sta sopra, le precedenti sbucano da sotto
 * sfalsate e rimpicciolite. `pbpIndex` è la carta in cima; girando la rotella
 * (o con le frecce) si torna indietro nel tempo e le carte passano davanti.
 *
 * L'impilamento vive solo da desktop in su: sotto i 900px la card torna una
 * lista che scorre normalmente, dove la rotella serve alla pagina.
 */
let pbpIndex = 0;
const isDeck = () => matchMedia('(min-width: 901px)').matches;

function layoutDeck() {
    const stack = document.getElementById('pbp-stack');
    if (!stack) return;
    const cards = [...stack.querySelectorAll('.pbp-card')];
    pbpIndex = Math.max(0, Math.min(pbpIndex, Math.max(0, cards.length - 1)));
    cards.forEach((el, i) => {
        const depth = i - pbpIndex;
        el.style.setProperty('--i', depth);
        el.classList.toggle('pbp-card--gone', depth < 0);   // già passata
        el.classList.toggle('pbp-card--deep', depth > 3);   // troppo in fondo
    });
    const nav = stack.parentElement.querySelector('.pbp-deck-nav');
    if (nav) {
        nav.hidden = !(isDeck() && cards.length > 1);
        nav.querySelector('.pbp-deck-count').textContent = cards.length
            ? `${pbpIndex + 1} / ${cards.length}` : '';
    }
}

function stepDeck(delta) {
    const n = pbpCards.length;
    if (!n) return false;
    const next = Math.max(0, Math.min(pbpIndex + delta, n - 1));
    if (next === pbpIndex) return false; // già al capo: la pagina può scorrere
    pbpIndex = next;
    layoutDeck();
    return true;
}

/** Rotella sul mazzo: una carta per scatto, senza rubare lo scroll ai bordi. */
function bindDeck(root) {
    const stack = root.querySelector('[data-deck]');
    if (!stack) return;
    let last = 0;
    stack.addEventListener('wheel', (e) => {
        if (!isDeck() || pbpCards.length < 2) return;
        const now = performance.now();
        if (now - last < 110) { e.preventDefault(); return; }
        if (stepDeck(e.deltaY > 0 ? 1 : -1)) {
            e.preventDefault();  // solo se il mazzo si è davvero mosso
            last = now;
        }
    }, { passive: false });

    root.querySelectorAll('[data-deck-step]').forEach(btn =>
        btn.addEventListener('click', () => stepDeck(Number(btn.dataset.deckStep))));
}

/**
 * Ridisegna il mazzo. Le card nuove entrano dall'alto; se stavi guardando
 * indietro nel tempo, l'indice segue la carta che avevi davanti invece di
 * riportarti di colpo in cima.
 */
function paintPlayCards(newIds = []) {
    const stack = document.getElementById('pbp-stack');
    if (!stack) return;
    if (pbpIndex > 0) pbpIndex += newIds.length;
    stack.innerHTML = pbpCards.map(playCardHTML).join('');
    layoutDeck();
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    for (const id of newIds) {
        stack.querySelector(`[data-play="${CSS.escape(String(id))}"]`)?.animate([
            { transform: 'translateY(-26px) scale(1.03)', opacity: 0 },
            { transform: 'none', opacity: 1 },
        ], { duration: 420, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' });
    }
}

function receiptsPanelHTML() {
    return `
    <div class="mosaic-card mc-in live-side-card live-receipts-card">
        <span class="mc-kicker">Scoring feed</span>
        <div class="live-receipts" id="live-receipts">
            ${receipts.length
            ? receipts.map(receiptHTML).join('')
            : `<p class="pm-empty">${isLiveSource
                ? 'Waiting for the first play...'
                : 'Live feed off — receipts appear when games are running.'}</p>`}
        </div>
    </div>`;
}

/**
 * Conteggio animato: il numero sale/scende invece di cambiare di scatto.
 * `from` è il valore precedente, `to` quello nuovo già scritto nel DOM.
 */
function countUp(el, from, to, ms = 900) {
    if (!el || from === to || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const t0 = performance.now();
    const step = (now) => {
        const k = Math.min(1, (now - t0) / ms);
        const eased = 1 - Math.pow(1 - k, 3); // decelera verso il valore finale
        el.textContent = fmt(from + (to - from) * eased);
        if (k < 1) requestAnimationFrame(step);
        else el.textContent = fmt(to);
    };
    requestAnimationFrame(step);
}

/** Evidenzia sul campo i giocatori appena aggiornati + fa "stampare" lo scontrino. */
const FLASH_MS = 10000;    // quanto resta accesa la foto del giocatore
const POP_DELAY_MS = 5000; // l'etichetta dei punti resta fuori tanto, poi il totale sale

function flashNewReceipts(events) {
    for (const ev of events) {
        // stesso giocatore può stare in più punti (campo, panchina, confronto)
        for (const slot of document.querySelectorAll(`[data-slot-player="${CSS.escape(ev.name)}"]`)) {
            const color = ev.ptsDelta > 0 ? 'var(--accent-green)' : ev.ptsDelta < 0 ? 'var(--live-red)' : 'var(--live-yellow)';
            // si accende solo il cerchio della foto, non tutta la card
            const photo = slot.querySelector('.slot-photo, .live-chip-photo, .live-cmp-photo');
            photo?.animate([
                { boxShadow: '0 0 0 0 transparent', borderColor: 'rgba(255,255,255,0.35)', offset: 0 },
                { boxShadow: `0 0 22px 6px ${color}`, borderColor: color, offset: 0.04 },
                { boxShadow: `0 0 18px 5px ${color}`, borderColor: color, offset: 0.88 },
                { boxShadow: '0 0 0 0 transparent', borderColor: 'rgba(255,255,255,0.35)', offset: 1 },
            ], { duration: FLASH_MS, easing: 'ease-out' });

            // Il totale non si muove subito: prima si legge quanto è arrivato
            // accanto alla foto, poi il numero in basso lo assorbe salendo.
            // La somma parte alla FINE dell'etichetta, non a tempo: così i due
            // momenti si toccano invece di lasciare un vuoto in mezzo.
            const ptsEl = slot.querySelector('.slot-pts, .live-chip-pts')
                || (slot.classList.contains('live-cmp-pts') ? slot : null);
            let sum = () => { };
            if (ptsEl && ev.ptsDelta) {
                const to = P(ptsEl.textContent);
                const from = +(to - ev.ptsDelta).toFixed(2);
                ptsEl.textContent = fmt(from);
                sum = () => countUp(ptsEl, from, to);
            }
            if (ev.ptsDelta) popPoints(slot, ev.ptsDelta, sum);
            else sum();
        }
        document.querySelector(`[data-receipt="${ev.id}"]`)?.classList.add('live-receipt--new');
    }
}

/**
 * Etichetta volante accanto alla bolla: quanti punti ha portato l'azione.
 * `onDone` scatta quando sparisce — è lì che il totale comincia a salire.
 */
function popPoints(slot, delta, onDone = () => { }) {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { onDone(); return; }
    const tag = document.createElement('span');
    tag.className = `live-pop ${delta > 0 ? 'pos' : 'neg'}`;
    tag.textContent = `${delta > 0 ? '+' : ''}${delta.toFixed(2)}`;
    slot.appendChild(tag);
    // Compare subito, resta piena quasi fino in fondo e sparisce in fretta:
    // l'ultimo 8% è la dissolvenza, e appena finita parte la somma.
    tag.animate([
        { transform: 'translateY(6px) scale(0.85)', opacity: 0 },
        { transform: 'translateY(0) scale(1)', opacity: 1, offset: 0.05 },
        { transform: 'translateY(-2px) scale(1)', opacity: 1, offset: 0.92 },
        { transform: 'translateY(-10px) scale(0.95)', opacity: 0 },
    ], { duration: POP_DELAY_MS, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' })
        .onfinish = () => { tag.remove(); onDone(); };
}

function sidebarHTML(team, opp) {
    return `
    <div class="mosaic-card mc-in live-side-card">
        <span class="mc-kicker">Injury report</span>
        <div id="live-injuries">${injuriesHTML(team, opp)}</div>
    </div>`;
}

/** Solo l'elenco: è la parte che cambia, aggiornata senza toccare il resto. */
function injuriesHTML(team, opp) {
    const all = [...(team.starters || []), ...(team.bench || []),
    ...(opp.starters || []), ...(opp.bench || [])];
    const injuries = all.filter(p => injuryOf(p));
    return injuries.length
        ? `<ul class="live-side-list">${injuries.map(p =>
            `<li>${escAttr(p.name)} — <span class="live-injury-tag">${escAttr(injuryOf(p))}</span></li>`).join('')}</ul>`
        : '<p class="pm-empty">No injuries reported.</p>';
}

/**
 * Foto già risolte in questa sessione. Servono a scriverle direttamente
 * nell'HTML: se si ripartisse sempre dal segnaposto, ogni ridisegno farebbe
 * sparire e ricomparire tutte le facce.
 */
const headshotCache = new Map();
const cachedHeadshot = (name) => headshotCache.get(name) || 'images/fallback-player.svg';

function hydrateHeadshots(root) {
    root.querySelectorAll('img[data-headshot]').forEach(img => {
        img.onerror = () => { if (!img.src.endsWith('fallback-player.svg')) img.src = 'images/fallback-player.svg'; };
        const known = headshotCache.get(img.dataset.playerName);
        if (known) { if (img.src !== known) img.src = known; return; }
        playerImageService.getPlayerImageUrl(img.dataset.playerName, img.dataset.team, img.dataset.pos, CURRENT_SEASON)
            .then(url => {
                if (!url) return;
                headshotCache.set(img.dataset.playerName, url);
                img.src = url;
            }).catch(() => {});
    });
}
