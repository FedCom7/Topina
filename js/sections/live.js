/**
 * Live Matchup Center — route #live.
 *
 * Le fonti, in ordine:
 *   1. API della lega ESPN letta dal browser (js/data/espn-fantasy.js), ogni
 *      10 secondi. Da quando la lega è pubblica non servono cookie né Worker.
 *      Dà formazioni sempre aggiornate, proiezioni prima del kickoff e punti
 *      ufficiali durante le partite.
 *   2. Firebase, se l'API non risponde: è l'archivio delle settimane chiuse,
 *      scritto una volta a settimana dall'Action.
 *   3. Tabellino ufficiale ESPN (js/data/espn-boxscore.js), se una partita è
 *      cominciata ma nessuno ha ancora punti — vuol dire che chi doveva darceli
 *      non sta rispondendo.
 *
 * Non si inventano mai dati: se non c'è niente da mostrare si dice.
 */

import { fetchFantasyData, fetchDraftData, displayName, teamNameHTML, CURRENT_SEASON, getSeasonConfig } from '../data.js?v=534';
import { TEAM_KEYS } from '../data/team-config.js?v=533';
import { TEAMS } from './team.js?v=601';
import { getWeekSchedule, canonAbbr } from '../data/nfl-schedule.js?v=520';
import { fetchPlays, resolveAthlete, headshotUrl } from '../data/nfl-plays.js?v=509';
import { scorePlay, scoreWeeklyStats } from '../data/scoring.js?v=592';
import { fetchBoxscoreTotals, normName } from '../data/espn-boxscore.js?v=504';
import { fetchLeagueWeek, teamAbbrFromName, teamNameFromAbbr, fillMissingProjections } from '../data/espn-fantasy.js?v=5';
import { applyDraftLineups } from '../data/draft-lineups.js?v=4';
import { fieldSVG } from '../ui/field-svg.js?v=4';
import { PLAYER_ID_MAP, ESPN_TEAM_IDS } from '../data/player-map.js?v=513';
import { slotPairs } from '../data/matchup-analysis.js?v=525';
import { initPlayerModal } from '../components/player-modal.js?v=607';
import { playerImageService } from '../services/player-image-service.js?v=515';

const POLL_MS = 30000;

// Settimana di lega in corso: la dice l'API (status.currentMatchupPeriod) alla
// prima lettura, poi si riusa per non richiederla a ogni giro.
let espnWeek = null;

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
// Finché il draft non è fatto ESPN riempie le squadre di rose segnaposto:
// giocatori che non sono di nessuno. Con questo a falso non se ne mostra
// nessuno, invece di far credere che quelle formazioni esistano.
let leagueDrafted = true;
// formazioni prese dal draft: i punti non arriveranno mai dalla lega, vanno
// sempre ricomposti dal tabellino
let lineupsFromDraft = false;

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
/** La squadra fantasy che ha questo giocatore in rosa, per la scheda. */
function squadraDi(p) {
    for (const m of matchups) {
        for (const lato of ['team1', 'team2']) {
            const t = m[lato];
            if (!t) continue;
            if ([...(t.starters || []), ...(t.bench || [])].some(x => x.name === p?.name)) {
                return displayName(t.name);
            }
        }
    }
    return '';
}

function gameAttr(p) {
    const payload = {
        pts: effPts(p),
        projected: pIsProjected(p),
        opponent: p.opponent || '',
        status: p.status || '',
        week: currentWeekNum,
        year: CURRENT_SEASON,
        started: true,
        fantasyTeam: squadraDi(p),
        stats: (pIsProjected(p) ? p.projected_stats : p.stats) || p.stats || {},
        // sempre anche la previsione, che la scheda mostra in piccolo accanto
        // a ogni numero reale — a giornata iniziata è l'unico modo per capire
        // se uno sta andando meglio o peggio di quanto ci si aspettava
        projPts: pIsProjected(p) || p.projected_points == null ? null : P(p.projected_points),
        projStats: pIsProjected(p) ? null : (p.projected_stats || null),
    };
    return `data-game="${encodeURIComponent(JSON.stringify(payload))}"`;
}

const P = (m) => parseFloat(m) || 0;
const fmt = (n) => (+n).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

// Projections: before kickoff (started === false) show the projected value.
// Older/real data without `started`/`projected_*` falls back to real points.
// Appena la giornata comincia le proiezioni spariscono da TUTTA la pagina, non
// solo dai giocatori già scesi in campo: da quel momento il tabellone racconta
// quello che sta succedendo, e chi non ha ancora giocato sta a zero.
let giornataCominciata = false;
const pIsProjected = (p) => !giornataCominciata && p && p.started === false && p.projected_points != null;
const effPts = (p) => P(pIsProjected(p) ? p.projected_points : p.fantasy_points);
// Effective team score: projected total pre-game, real once points exist.
// Il totale di squadra segue la stessa regola dei singoli: proiezione solo
// finché la giornata non è cominciata.
const teamIsProjected = (t) => !giornataCominciata && P(t.score) === 0 && t.projected_score != null;
const teamEffScore = (t) => (teamIsProjected(t) ? P(t.projected_score) : P(t.score));

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

/** Il play-by-play non dipende dal feed fantasy: gli bastano il calendario NFL
 *  e le partite in corso, quindi vive di vita propria. */
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

const PBP_POLL_MS = 30000;
const PBP_MAX_CARDS = 30;

let pbpTimer = null;
let pbpSeen = new Set();   // id giocate già trasformate in card
let pbpCards = [];         // card pronte, più recenti in testa
let pbpFirstRun = true;    // al primo giro si riempie senza animare
let pbpBusy = false;

/** ESPN athlete id → giocatore di una nostra rosa (con la squadra fantasy,
 *  che serve a mostrare solo le giocate di chi stai guardando). */
function rosterIndex() {
    const byAthlete = new Map();
    const byDefTeam = new Map();
    const byName = new Map();
    for (const m of matchups) {
        for (const side of ['team1', 'team2']) {
            const t = m[side];
            if (!t) continue;
            for (const p of [...(t.starters || []), ...(t.bench || [])]) {
                const pos = (p.position_in_team || p.position || '').toUpperCase();
                // le difese non hanno `nfl_team` nei dati: la squadra sta nel nome
                const nfl = canonAbbr(p.nfl_team || '') || teamAbbrFromName(p.name) || '';
                const entry = { name: p.name, team: t.name, pos, nfl };
                if (pos === 'DEF' || pos === 'D/ST') {
                    const id = ESPN_TEAM_IDS[nfl];
                    if (id) byDefTeam.set(String(id), entry);
                } else {
                    // PLAYER_ID_MAP è generata da dati vecchi: riserve e rookie
                    // non ci sono. Il nome normalizzato è la rete di sicurezza,
                    // e con le rose prese dal draft è la via principale.
                    const id = PLAYER_ID_MAP[p.name];
                    if (id) byAthlete.set(String(id), entry);
                    byName.set(normName(p.name), entry);
                }
            }
        }
    }
    return { byAthlete, byDefTeam, byName };
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
    if (!liveSchedule || !leagueDrafted) return [];
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
function playToCard(play, idx, nomiAtleti = new Map()) {
    const contribs = scorePlay(play);
    const actors = [];
    let mine = false;

    // I due protagonisti dell'azione, nell'ordine in cui è avvenuta
    const order = ['passer', 'rusher', 'receiver', 'kicker', 'returner'];
    for (const role of order) {
        const espnId = play.actors[role];
        if (!espnId) continue;
        const nome = nomiAtleti.get(String(espnId)) || '';
        const own = idx.byAthlete.get(String(espnId))
            || (nome ? idx.byName.get(normName(nome)) : null) || null;
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
        // Squadre fantasy che hanno un protagonista in questa giocata. Le card
        // restano tutte in memoria e si filtrano qui: cambiando squadra dal
        // selettore non si perde lo storico e non si rifà il polling.
        teams: [...new Set(actors.map(a => a.own?.team).filter(Boolean))],
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
        const nuove = [];
        for (const plays of lists) {
            for (const play of plays) {
                if (pbpSeen.has(play.id)) continue;
                pbpSeen.add(play.id);
                if (pbpDemo()) applyDemoPlay(play, scorePlay(play));
                nuove.push(play);
            }
        }
        // Chi sono i protagonisti: serve PRIMA di decidere se la giocata ci
        // riguarda, perché la mappa statica dei nomi non copre riserve e
        // rookie — cioè quasi tutti quando le rose vengono dal draft.
        const nomiAtleti = await risolviNomiAttori(nuove, idx);
        const fresh = [];
        for (const play of nuove) {
            const card = playToCard(play, idx, nomiAtleti);
            if (card) fresh.push(card);
        }
        if (!fresh.length) return;

        // nomi mancanti dalla mappa locale (rookie): risolti una volta sola
        await hydrateActorNames(fresh);

        fresh.sort((a, b) => a.ts - b.ts); // le più vecchie prima: entrano sotto
        for (const c of fresh) pbpCards.unshift(c);
        pbpCards = pbpCards.slice(0, PBP_MAX_CARDS);

        if (pbpDemo()) {
            // I totali sono cambiati: si passa dal percorso normale, quello che
            // in stagione reagisce ai dati veri. Così in demo si accendono
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
/**
 * Nome di ogni atleta che compare nelle giocate nuove, per gli id che la mappa
 * locale non conosce. Una chiamata per atleta, poi cache in localStorage: in
 * una partita i protagonisti sono poche decine.
 */
async function risolviNomiAttori(plays, idx) {
    const fuori = new Set();
    for (const play of plays) {
        for (const id of Object.values(play.actors || {})) {
            const s = String(id);
            if (!idx.byAthlete.has(s)) fuori.add(s);
        }
    }
    const nomi = new Map();
    if (!fuori.size) return nomi;
    await Promise.all([...fuori].map(async id => {
        const noto = ESPN_ID_TO_NAME.get(id);
        if (noto) { nomi.set(id, noto); return; }
        const info = await resolveAthlete(id);
        if (info?.name) nomi.set(id, info.name);
    }));
    return nomi;
}

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

/**
 * Il draft dell'anno esiste su Firebase?
 *
 * ESPN dichiara `drafted` solo dopo il draft vero, ma il draft caricato
 * sull'archivio è altrettanto buono come prova che la lega ha le sue rose —
 * ed è ciò che tiene in piedi le pagine durante il collaudo di preseason.
 * Una lettura sola per sessione: il nodo non cambia mentre si guarda.
 */
let draftSuFirebase;
async function draftOnFirebase() {
    if (draftSuFirebase === undefined) {
        try { draftSuFirebase = (await fetchDraftData(CURRENT_SEASON)) || null; }
        catch { draftSuFirebase = null; }
    }
    return draftSuFirebase;
}

async function loadData({ silent = false } = {}) {
    const root = document.getElementById('live-root');
    if (!silent) root.innerHTML = `<div class="loading-state"><div class="spinner"></div><p>Loading live matchups...</p></div>`;

    // Fonte primaria: la lega ESPN letta direttamente dal browser. Da quando è
    // pubblica non servono cookie, quindi niente Worker di mezzo. A ogni giro si
    // rilegge tutto — non solo i punti — perché è così che titolari e panchina
    // restano allineati se un GM cambia formazione a partite in corso.
    try {
        const games = (await getWeekSchedule(CURRENT_SEASON, espnWeek || 1)) || new Map();
        const { week, matchups: live, drafted } = await fetchLeagueWeek(CURRENT_SEASON, espnWeek, games);
        if (live.length) {
            espnWeek = week;
            // Se la lega non ha ancora draftato, le rose che ESPN espone sono
            // segnaposto suoi: si buttano e si usano le scelte del draft, se
            // ci sono. Senza nemmeno quelle il campo resta vuoto.
            leagueDrafted = drafted;
            lineupsFromDraft = false;
            if (!drafted) {
                const draft = await draftOnFirebase();
                leagueDrafted = !!draft && applyDraftLineups(live, draft);
                lineupsFromDraft = leagueDrafted;
            }
            matchups = live;
            // chi non ha una proiezione la riceve dal listone; se ce l'hanno
            // già tutti (rose ESPN) non parte nessuna chiamata
            await fillMissingProjections(matchups, CURRENT_SEASON, week);
            currentWeekNum = week;
            isLiveSource = true;
            const config = getSeasonConfig(CURRENT_SEASON);
            const round = week === config.superBowlWeek ? 'Super Bowl'
                : week === config.playoffWeek ? 'Playoffs' : `Week ${week}`;
            weekLabelText = `${CURRENT_SEASON} · ${round}`;
            await hydrateScheduleAndRender(CURRENT_SEASON, week);
            startPolling();
            return;
        }
    } catch (e) {
        console.warn('[live] API ESPN non raggiungibile, si ripiega su Firebase:', e.message);
    }

    // Ripiego: ultima settimana reale disponibile su Firebase (non live).
    isLiveSource = false;
    stopPolling();
    const data = await fetchFantasyData(CURRENT_SEASON);
    if (!data?.weeks) {
        matchups = [];
        render();   // campo a posti vuoti: nessuna fonte ha risposto
        return;
    }
    // Anche qui vale la regola: senza draft non si mostra nessuna rosa. Il
    // draft caricato è ciò che certifica che le rose sono di qualcuno.
    const draftArchivio = await draftOnFirebase();
    leagueDrafted = !!draftArchivio;
    const weeks = Object.keys(data.weeks).map(Number).sort((a, b) => a - b);
    let pickedWeek = weeks[0];
    for (const w of weeks) {
        const wk = data.weeks[String(w)];
        if (wk?.matchups?.some(m => P(m.team1?.score) > 0 || P(m.team2?.score) > 0)) pickedWeek = w;
    }
    matchups = data.weeks[String(pickedWeek)]?.matchups || [];
    // Prima del draft l'archivio porta le sfide ma non le formazioni: le
    // compongono le scelte, come sul percorso principale.
    if (draftArchivio && matchups.every(m =>
        !(m.team1?.starters || []).length && !(m.team2?.starters || []).length)) {
        applyDraftLineups(matchups, draftArchivio);
        lineupsFromDraft = true;
    }
    await fillMissingProjections(matchups, CURRENT_SEASON, pickedWeek);
    currentWeekNum = pickedWeek;
    const config = getSeasonConfig(CURRENT_SEASON);
    const roundLabel = pickedWeek === config.superBowlWeek ? 'Super Bowl'
        : pickedWeek === config.playoffWeek ? 'Playoffs' : `Week ${pickedWeek}`;
    weekLabelText = `${CURRENT_SEASON} · ${roundLabel}`;
    await hydrateScheduleAndRender(CURRENT_SEASON, pickedWeek);
}

// ─── Ripiego sugli endpoint pubblici ESPN ────────────────────────
//
// I punti arrivano da Firebase, dove li carica lo script esterno. Se quello
// non è ancora passato, la settimana è tutta a zero anche se le partite sono
// cominciate: invece di mostrare una pagina di zeri si compongono gli stessi
// totali dal tabellino ufficiale ESPN, che è pubblico e si aggiorna in diretta.
//
// Fedeltà verificata sull'intera stagione 2025 (605 titolari, 605 esatti):
// il banco di prova è scripts/espn/validate_boxscore.py.

let usingEspnFallback = false;

// ─── Modalità preseason (solo collaudo) ──────────────────────────
//
// La lega non gioca la preseason, quindi in condizioni normali il calendario
// chiede solo la stagione regolare. Ad agosto però le uniche partite vere in
// corso sono quelle: questo interruttore le fa seguire alla pagina, per poter
// collaudare in diretta il play-by-play e il ripiego mesi prima del kickoff.
//
// I punti che compaiono in questo stato NON sono della lega: l'intestazione lo
// dichiara con un bollino, come per la demo.

const PRESEASON_KEY = 'topina-live-preseason';
let preseasonMode = (() => {
    try { return localStorage.getItem(PRESEASON_KEY) === '1'; } catch { return false; }
})();

/**
 * Quale giornata di preseason seguire: quella con una partita in corso, se
 * c'è; altrimenti la più vicina nel tempo, così fuori dagli orari di gioco la
 * pagina mostra comunque qualcosa di sensato.
 */
async function pickPreseasonWeek(year) {
    let migliore = null;
    for (let w = 1; w <= 4; w++) {
        const sched = await getWeekSchedule(year, w, 1);
        if (!sched?.size) continue;
        const partite = [...sched.values()];
        if (partite.some(g => g.state === 'in')) return { week: w, sched };
        const vicinanza = Math.min(...partite.map(g => Math.abs(g.start - Date.now())));
        if (!migliore || vicinanza < migliore.vicinanza) migliore = { week: w, sched, vicinanza };
    }
    return migliore;
}

/** Tutti a zero: nessun punto reale in tutta la settimana. */
function boardIsEmpty() {
    for (const m of matchups) {
        for (const side of ['team1', 'team2']) {
            for (const p of [...(m[side]?.starters || []), ...(m[side]?.bench || [])]) {
                if (P(p.fantasy_points) !== 0) return false;
            }
        }
    }
    return true;
}

/** Partite della settimana già cominciate in cui gioca un nostro tesserato. */
function startedGames() {
    if (!liveSchedule) return [];
    const ids = new Set();
    for (const m of matchups) {
        for (const side of ['team1', 'team2']) {
            for (const p of [...(m[side]?.starters || []), ...(m[side]?.bench || [])]) {
                const g = liveSchedule.get(canonAbbr(p.nfl_team || ''));
                if (g?.eventId && g.state !== 'pre') ids.add(g.eventId);
            }
        }
    }
    return [...ids];
}

/**
 * Riempie punti e statistiche dal tabellino ESPN. Tocca solo i giocatori che
 * hanno davvero giocato: chi non compare nel tabellino resta a zero, che è il
 * suo punteggio corretto.
 */
/**
 * Tabellini delle partite già cominciate, letti una volta sola per giro.
 * Servono a due cose diverse: ricomporre i punti dei nostri (`fillFromEspn`) e
 * disegnare il "dentro la partita", che vive anche quando i punti arrivano
 * regolarmente dalla lega.
 */
let boxData = null;

async function loadBoxscores() {
    const games = startedGames();
    if (!games.length) { boxData = null; return; }
    // Le partite finite si leggono una volta sola: il loro tabellino non cambia
    // più, e con sedici partite di preseason aperte rileggerle tutte ogni dieci
    // secondi significa farsi strozzare le richieste da ESPN.
    const finite = new Set();
    if (liveSchedule) {
        for (const g of liveSchedule.values()) {
            if (g.eventId && g.state === 'post') finite.add(String(g.eventId));
        }
    }
    boxData = await fetchBoxscoreTotals(games, finite);
}

async function fillFromEspn() {
    if (!boxData) return false;
    const { players, defenses, teamByName } = boxData;
    if (!players.size && !defenses.size) return false;

    for (const m of matchups) {
        for (const side of ['team1', 'team2']) {
            const t = m[side];
            if (!t) continue;
            for (const p of [...(t.starters || []), ...(t.bench || [])]) {
                const pos = (p.position_in_team || p.position || '').toUpperCase();
                const difesa = pos === 'DEF' || pos === 'D/ST';
                // le difese non hanno nfl_team nei dati: la squadra sta nel nome
                const ab = difesa
                    ? (canonAbbr(p.nfl_team || '') || teamByName.get(normName(p.name)) || teamAbbrFromName(p.name))
                    : canonAbbr(p.nfl_team || '');
                const stats = difesa ? (defenses.get(ab) || null) : (players.get(normName(p.name)) || null);

                // Appena la sua partita comincia si passa ai punti veri, anche
                // se non ha ancora fatto nulla: zero è il suo punteggio, non un
                // dato mancante, e mostrare la proiezione a partita in corso
                // racconterebbe una cosa non vera.
                const g = ab ? liveSchedule?.get(ab) : null;
                if (g && (g.state === 'in' || g.state === 'post')) {
                    p.started = true;
                    if (!stats) p.fantasy_points = '0.00';
                }
                if (!stats) continue;
                p.stats = { ...stats };
                p.started = true;
                p.fantasy_points = +(scoreWeeklyStats(stats, pos === 'D/ST' ? 'DEF' : pos) || 0).toFixed(2);
            }
            // Somma di quello che le card mostrano davvero: punti reali per chi
            // ha giocato, proiezione per gli altri. Sommando solo i punti reali
            // il banner direbbe un numero che nessuna card conferma.
            t.score = (t.starters || []).reduce((s, p) => s + effPts(p), 0).toFixed(2);
        }
    }
    usingEspnFallback = true;
    return true;
}

async function hydrateScheduleAndRender(year, week) {
    try {
        if (preseasonMode) {
            const pre = await pickPreseasonWeek(year);
            liveSchedule = pre?.sched || null;
            if (pre) weekLabelText = `${year} · Preseason week ${pre.week}`;
        } else {
            liveSchedule = await getWeekSchedule(year, week);
        }
    } catch {
        liveSchedule = null;
    }
    // Rete di sicurezza: se una partita è cominciata ma nessuno ha ancora un
    // punto, chi doveva darceli non sta rispondendo — l'API fantasy o lo script
    // che riempie Firebase. Si compongono allora i totali dal tabellino
    // ufficiale, validato sull'intera stagione 2025.
    // Una sola verità per il badge e per i punti: se una partita dei nostri è
    // cominciata, la giornata è cominciata.
    giornataCominciata = startedGames().length > 0;
    try { await loadBoxscores(); }
    catch (e) { console.warn('[live] tabellino ESPN non disponibile:', e.message); boxData = null; }
    if (boardIsEmpty() || lineupsFromDraft) {
        try { await fillFromEspn(); }
        catch (e) { console.warn('[live] punti dal tabellino non ricomposti:', e.message); }
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
    return null; // senza un evento notevole non si titola niente
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

/**
 * Punteggio di un giocatore come va mostrato: prima del kickoff la proiezione
 * nel suo colore, a giornata iniziata il punteggio vero con accanto, in
 * piccolo, quello che era previsto.
 */
function ptsHTML(p) {
    const val = fmt(effPts(p));
    if (pIsProjected(p)) return `<span class="pts-val proj-pts">${val}</span>`;
    // Non ha ancora giocato: uno zero direbbe "ha giocato e non ha fatto
    // niente", che è un'altra cosa. Trattino finché la sua partita non parte.
    if (!daGiocare(p)) return `<span class="pts-val">–</span>`;
    const previsto = p?.projected_points == null ? ''
        : `<small class="pts-proj" title="projected">${fmt(P(p.projected_points))}</small>`;
    return `<span class="pts-val">${val}</span>${previsto}`;
}

/** La sua partita è cominciata? (se non si sa nulla, si suppone di sì) */
function daGiocare(p) {
    if (!p || p.placeholder) return false;
    const ab = canonAbbr(p.nfl_team || '') || teamAbbrFromName(p.name);
    const g = ab ? liveSchedule?.get(ab) : null;
    return g ? g.state !== 'pre' : true;
}

/** Il solo numero dentro una casella punti: è quello che si anima e si legge,
 *  mentre accanto può esserci la proiezione, che non va toccata. */
const numEl = (el) => el?.querySelector?.('.pts-val') || el;

function writePts(el, p) {
    const html = ptsHTML(p);
    if (el.innerHTML !== html) el.innerHTML = html;
}

/**
 * La formazione a schermo è ancora quella dei dati?
 *
 * Serve perché un GM può cambiare titolari a partite in corso: aggiornare solo
 * i numeri lascerebbe in campo un giocatore che è andato in panchina. Quando
 * cambia l'insieme dei nomi non basta ritoccare i valori, va ridisegnato.
 */
function lineupChanged(entry) {
    const attesi = new Set([...(entry.team.starters || []), ...(entry.team.bench || [])]
        .map(p => p.name));
    const aSchermo = new Set([...document.querySelectorAll(
        '.live-field-solo [data-slot-player], .live-bench [data-slot-player]')]
        .map(el => el.dataset.slotPlayer));
    if (!aSchermo.size) return false;   // non c'è ancora niente da confrontare
    if (aSchermo.size !== attesi.size) return true;
    for (const n of aSchermo) if (!attesi.has(n)) return true;
    return false;
}

function refreshInPlace(events = []) {
    const root = document.getElementById('live-root');
    const entry = teamEntries()[teamIdx];
    if (!root || !entry) return;
    // Prima del draft a schermo c'è solo il messaggio: aggiornare in posto
    // riscriverebbe nel banner i punti delle rose segnaposto, che è proprio
    // quello che non vogliamo mostrare.
    if (!leagueDrafted) return;
    if (lineupChanged(entry)) { render(); return; }
    const byName = playersByName();

    // punteggi di squadra nel banner
    const { m } = entry;
    const scores = root.querySelectorAll('.gc-banner-score');
    const s = [teamEffScore(m.team1), teamEffScore(m.team2)];
    scores.forEach((el, i) => {
        const squadra = m[`team${i + 1}`];
        const proj = teamIsProjected(squadra);
        const from = P(numEl(el).textContent);
        el.innerHTML = bannerScoreHTML(squadra, s[i], proj);
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
        if (stats) stats.innerHTML = stats.classList.contains('live-slot-stats--ring')
            ? statRingHTML(p) : statBoxHTML(p);
        // la partita può finire mentre si guarda: la card si spegne senza
        // aspettare che la pagina venga rifatta
        el.classList.toggle('live-slot--done', gameOver(p));
        el.classList.toggle('live-slot--live', liveNow(p));
        el.classList.toggle('live-slot--soon', !daGiocare(p));
        // il puntino "sta giocando": prima compariva solo ridisegnando la
        // pagina, quindi una partita che cominciava non lo accendeva mai

        el.setAttribute('data-game', gameAttr(p).slice('data-game="'.length, -1));
    });

    root.querySelectorAll('[data-cmp-stats]').forEach(el => {
        const p = byName.get(el.dataset.cmpStats);
        if (p) el.innerHTML = compareStatsHTML(p, el.dataset.cmpSide);
    });

    // risultati NFL: cambiano punteggio e cronometro, nessuna immagine
    // l'orologio in alto: si aggiorna a ogni giro, come i numeri
    const orologio = root.querySelector('.live-header-updated');
    if (orologio) orologio.textContent = `Updated ${oraCorrente()}`;

    const nfl = document.getElementById('live-nfl-games');
    if (nfl) nfl.innerHTML = nflGamesListHTML(entry.team);

    // "dentro la partita": cambiano i numeri e le barre, non le foto
    const deep = document.getElementById('live-deep');
    const deepHTML = deepDiveHTML(entry.team);
    if (deep && deepHTML) {
        const nuovo = deepHTML.trim();
        if (deep.outerHTML !== nuovo) {
            deep.outerHTML = nuovo;
            bindDeepDive(root);
        }
    } else if (deep && !deepHTML) {
        deep.remove();          // le partite sono finite fuori dal tabellino
    } else if (deepHTML && !deep) {
        render();               // prima partita cominciata: la sezione va creata
        return;
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
    if (!p || p.placeholder) return false;
    const ab = canonAbbr(p.nfl_team || '') || teamAbbrFromName(p.name);
    const w = ab ? liveSchedule?.get(ab) : null;
    if (!w) return false;
    // Il tabellone è la fonte vera: dice "in corso" o "finita". La finestra
    // oraria resta solo come ripiego, per quando lo stato non c'è — una
    // partita che va ai supplementari sfora le tre ore e un quarto stimate.
    if (w.state === 'in') return true;
    if (w.state === 'post') return false;
    const now = Date.now();
    return now >= w.start.getTime() && now <= w.end.getTime();
}

/**
 * La sua partita è finita: il punteggio non si muoverà più.
 * Vale anche per le difese, che il team lo tengono nel nome.
 */
function gameOver(p) {
    if (!p || p.placeholder) return false;
    const ab = canonAbbr(p.nfl_team || '') || teamAbbrFromName(p.name);
    return ab ? liveSchedule?.get(ab)?.state === 'post' : false;
}

// ─── Rendering ────────────────────────────────────────────────────

/**
 * Il campo con i posti vuoti, unica risposta a "non ci sono giocatori":
 * prima del draft e quando nessuna fonte risponde. Cambia solo la riga di
 * spiegazione sotto. Senza rose non ci sono giocate, partite da seguire né
 * infortuni, quindi i pannelli laterali non si disegnano.
 */
function renderEmptyField(root, entry, entries, nota) {
    const team = entry?.team || { name: '' };
    root.innerHTML = `
    ${headerHTML()}
    ${entry ? matchupCardHTML(entry) : ''}
    ${fieldHTML(emptyRoster(team))}
    <p class="live-nodraft-note">${nota}</p>`;
    root.querySelector('.live-compare-btn')?.remove();   // niente da confrontare
    root.querySelector('.live-refresh-btn')?.addEventListener('click', () => loadData());
    bindTeamPick(root);
    if (entry) {
        root.querySelector('[data-swap]')?.addEventListener('click', showOpponent);
        bindSwipe(root.querySelector('[data-swipe]'));
    } else {
        root.querySelector('[data-swap]')?.remove();
    }
}

function render() {
    const root = document.getElementById('live-root');
    const entries = teamEntries();

    // Nessuna sfida: né l'API né Firebase hanno risposto. Meglio il campo a
    // posti vuoti di una riga di scuse — la pagina resta quella, e si vede
    // che manca il contenuto, non che è rotta.
    if (!entries.length) {
        renderEmptyField(root, null, [],
            'Lineups are not reachable right now. Try again in a moment.');
        return;
    }
    const entry = entries[teamIdx];
    const { team, opp } = entry;

    if (!leagueDrafted) {
        renderEmptyField(root, entry, entries,
            `The draft has not happened yet: rosters will appear as soon as it is
             done. <a href="#draft">Go to the draft →</a>`);
        return;
    }

    root.innerHTML = `
    ${headerHTML()}
    ${matchupCardHTML(entry)}
    ${compareMode ? compareHTML(team, opp) : fieldHTML(team)}
    <div class="live-widgets">
        ${playFeedHTML()}
        ${nflGamesHTML(team)}
        ${sidebarHTML(team, opp)}
    </div>
    ${deepDiveHTML(team)}
`;

    hydrateHeadshots(root);
    root.querySelector('.live-refresh-btn')?.addEventListener('click', () => loadData());
    root.querySelector('[data-preseason]')?.addEventListener('click', () => {
        preseasonMode = !preseasonMode;
        try { localStorage.setItem(PRESEASON_KEY, preseasonMode ? '1' : '0'); } catch { /* niente */ }
        // Le giocate viste e gli scontrini si riferiscono all'altro calendario:
        // vanno buttati, o il feed mescolerebbe due insiemi di partite.
        stopPlayPolling();
        pbpSeen = new Set(); pbpCards = []; pbpDemoQueue = null;
        pbpFirstRun = true;
        receipts = []; prevSnapshot = null;
        try { sessionStorage.removeItem('topina-live-receipts'); } catch { /* niente */ }
        loadData();
    });
    bindTeamPick(root);

    root.querySelector('[data-compare]')?.addEventListener('click', () => {
        compareMode = !compareMode;
        render();
    });
    root.querySelector('[data-swap]')?.addEventListener('click', showOpponent);
    bindSwipe(root.querySelector('[data-swipe]'));
    bindDeepDive(root);
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
/**
 * Swipe per passare all'avversario. Deve essere un gesto voluto, non un dito
 * che scorre la pagina: serve mezzo schermo di corsa orizzontale, il movimento
 * dev'essere chiaramente più largo che alto, e abbastanza svelto da non essere
 * uno scroll incerto.
 */
function bindSwipe(el) {
    if (!el) return;
    const MIN_DX = () => Math.max(90, Math.min(220, window.innerWidth * 0.45));
    let x0 = null, y0 = null, t0 = 0;
    el.addEventListener('touchstart', (e) => {
        if (e.touches.length > 1) { x0 = null; return; }
        x0 = e.changedTouches[0].clientX;
        y0 = e.changedTouches[0].clientY;
        t0 = performance.now();
    }, { passive: true });
    el.addEventListener('touchend', (e) => {
        if (x0 == null) return;
        const dx = e.changedTouches[0].clientX - x0;
        const dy = e.changedTouches[0].clientY - y0;
        const dt = performance.now() - t0;
        x0 = null;
        if (Math.abs(dx) < MIN_DX()) return;          // corsa troppo corta
        if (Math.abs(dx) < Math.abs(dy) * 2.2) return; // era uno scroll verticale
        if (dt > 800) return;                          // troppo lento: non è uno swipe
        showOpponent();
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
    // "in corso" lo dice il tabellone NFL, non il fatto che i punti siano
    // arrivati: un giocatore può essere in campo e non aver ancora fatto nulla.
    const anyLive = giornataCominciata || players.some(p => p && (p.started === true || liveNow(p)));
    const anyProjected = players.some(pIsProjected);

    if (anyLive) return '<i class="gb-live-dot"></i> LIVE';
    if (anyProjected) return `
        <svg class="live-proj-icon" viewBox="0 0 24 24" width="13" height="13" fill="none"
             stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <polyline points="3 17 9 11 13 15 21 7"></polyline>
            <polyline points="15 7 21 7 21 13"></polyline>
        </svg> PROJECTED`;
    // niente etichetta: senza partite in corso e senza proiezioni non c'è
    // niente di vero da dichiarare, e "FINAL" su una settimana che deve ancora
    // cominciare diceva il falso
    return '';
}

/** Ora locale hh:mm, per l'etichetta "Updated". */
function oraCorrente() {
    const now = new Date();
    return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}

function headerHTML() {
    return `
    <div class="live-header">
        <div class="live-header-left">
            <h1 class="live-header-title">${weekLabelText}</h1>
            <span class="live-header-kicker">
                ${pbpDemo() ? '<span class="live-demo-badge">DEMO · not real numbers</span>' : ''}
                ${preseasonMode ? '<span class="live-demo-badge">PRESEASON · test mode</span>' : ''}
                ${usingEspnFallback ? '<span class="live-source-badge">da ESPN</span>' : ''}
                ${statusBadgeHTML()}
            </span>
        </div>
        <div class="live-header-right">
            ${teamSwitcherHTML(teamEntries())}
            <span class="live-header-updated">Updated ${oraCorrente()}</span>
            <button class="live-preseason-btn${preseasonMode ? ' is-on' : ''}" type="button"
                    data-preseason title="Follow preseason games (test mode only)">Preseason</button>
            <button class="live-refresh-btn" type="button" aria-label="Refresh">↻</button>
        </div>
    </div>`;
}

/**
 * Selettore squadra: una capsula sola con il nome di quella scelta, e la
 * tendina con le altre. Prima erano quattro capsule in fila sotto
 * l'intestazione, che occupavano una riga per dire una cosa sola.
 */
/** Capsula e tendina: apre, sceglie, chiude. */
function bindTeamPick(root) {
    const box = root.querySelector('.live-teampick');
    if (!box) return;
    const capsula = box.querySelector('[data-teampick]');
    const menu = box.querySelector('.live-teampick-menu');
    const apri = (si) => {
        menu.hidden = !si;
        capsula.setAttribute('aria-expanded', String(si));
        box.classList.toggle('is-open', si);
    };
    capsula.addEventListener('click', (e) => { e.stopPropagation(); apri(menu.hidden); });
    menu.querySelectorAll('[data-idx]').forEach(b =>
        b.addEventListener('click', () => { teamIdx = Number(b.dataset.idx); render(); }));
    // un clic fuori chiude, come ci si aspetta da una tendina
    document.addEventListener('click', (e) => {
        if (!box.contains(e.target)) apri(false);
    }, { once: true });
}

function teamSwitcherHTML(entries) {
    if (!entries.length) return '';
    const scelta = entries[Math.min(teamIdx, entries.length - 1)];
    return `
    <div class="live-teampick">
        <button class="year-pill live-team-pill active" type="button" data-teampick
                aria-haspopup="listbox" aria-expanded="false">
            ${teamNameHTML(scelta.team.name)}
            <span class="live-teampick-caret" aria-hidden="true">▾</span>
        </button>
        <div class="live-teampick-menu" role="listbox" hidden>
            ${entries.map(({ team }, i) => `
            <button class="live-teampick-item${i === teamIdx ? ' is-on' : ''}" type="button"
                    role="option" aria-selected="${i === teamIdx}" data-idx="${i}">
                ${teamNameHTML(team.name)}
            </button>`).join('')}
        </div>
    </div>`;
}

/** Totale di squadra nel banner, con la proiezione in piccolo a giornata iniziata. */
function bannerScoreHTML(t, score, proiettato) {
    if (!leagueDrafted) return '–';
    if (proiettato) return `<span class="pts-val proj-pts">${fmt(score)}</span>`;
    const previsto = t?.projected_score == null ? ''
        : `<small class="pts-proj" title="projected">${fmt(P(t.projected_score))}</small>`;
    return `<span class="pts-val">${fmt(score)}</span>${previsto}`;
}

/**
 * Banner punteggio — stessa identità visiva del banner di Game Center.
 * La disposizione segue sempre l'ordine del matchup (team1 a sinistra):
 * cambiando squadra si sposta solo il contorno colorato sul nome selezionato.
 */
function matchupCardHTML(entry) {
    const { m, team: selected } = entry;
    const left = m.team1, right = m.team2;
    const proj1 = teamIsProjected(left);
    const proj2 = teamIsProjected(right);
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
                <span class="gc-banner-score${leagueDrafted && s1 >= s2 ? ' winner' : ''}">${bannerScoreHTML(left, s1, proj1)}</span>
                <div class="gc-banner-mid">
                    <span class="gc-banner-vs">${isLiveSource ? 'live' : 'vs'}</span>
                </div>
                <span class="gc-banner-score${leagueDrafted && s2 >= s1 ? ' winner' : ''}">${bannerScoreHTML(right, s2, proj2)}</span>
                <div class="gc-banner-side gc-banner-side-r">
                    <span class="gc-banner-name${selLeft ? '' : ' live-name-selected'}">${teamNameHTML(t2?.name || right.name)}</span>
                </div>
            </div>
            <div class="live-mc-prob">
                <span class="live-mc-probpct">${pct1}%</span>
                <span class="live-mc-probbar"><i class="live-mc-probfill" style="width:${pct1}%"></i></span>
                <span class="live-mc-probpct live-mc-probpct--r">${100 - pct1}%</span>
            </div>
        </div>
    </div>`;
}

function chip(p, side) {
    if (!p) return '<div class="live-chip live-chip--empty"></div>';
    const role = (p.position_in_team || p.position || '').toUpperCase();
    const live = liveNow(p);
    const injury = injuryOf(p);
    return `
    <div class="live-chip${live ? ' live-chip--live' : ''}${gameOver(p) ? ' live-slot--done' : ''}${injury ? ' live-chip--injury' : ''}" data-player-modal
         data-slot-player="${escAttr(p.name)}"
         data-player-name="${escAttr(p.name)}" data-pos="${escAttr(role)}" data-nfl="${escAttr(p.nfl_team || '')}" data-year="${CURRENT_SEASON}"
         ${gameAttr(p)}>
        <span class="live-chip-photo">
            <img src="${cachedHeadshot(p.name)}" alt="" loading="lazy"
                 data-headshot data-player-name="${p.name}" data-team="${p.nfl_team || ''}" data-pos="${role}">
        </span>
        <span class="live-chip-name">${shortName(p)}</span>
        <span class="live-chip-pts">${ptsHTML(p)}</span>
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

/** Le voci da mostrare per un giocatore: [{ testo, forte, zero }]. */
function statVoci(p) {
    let role = (p.position_in_team || p.position || '').toUpperCase();
    if (role === 'W/R' || role === 'RB/WR' || role === 'FLEX') role = 'WR';
    if (role === 'D/ST') role = 'DEF';
    const keys = STATS_BY_ROLE[role] || STATS_BY_ROLE.WR;
    // Prima del kickoff si mostra la riga proiettata: quella reale è tutta a zero.
    const proj = pIsProjected(p);
    const stats = (proj ? p.projected_stats : p.stats) || p.stats || {};
    return keys.map(k => {
        const raw = statValue(stats, k);
        // Le proiezioni arrivano con due decimali (es. 83.48): troppo lunghe per
        // la card. Interi per i conteggi, un decimale per le frazioni piccole.
        const v = proj ? (raw >= 10 ? Math.round(raw) : Math.round(raw * 10) / 10) : raw;
        return { valore: v === 0 ? '–' : String(v), etichetta: shortStatLabel(k), zero: v === 0 };
    });
}

/** Riquadro statistiche sotto la foto: due colonne, per la panchina. */
function statBoxHTML(p) {
    return statVoci(p).map(v =>
        `<span class="live-stat${v.zero ? ' live-stat--zero' : ''}"><b>${v.valore}</b> ${v.etichetta}</span>`
    ).join('');
}

/**
 * Le stesse voci scritte lungo il cerchio della foto, come una sola stringa
 * continua: ogni carattere è un pezzo a sé, ruotato di un passo fisso, così il
 * testo segue la curva invece di stare dritto. Si parte dalle "40 di orologio"
 * e si prosegue in senso orario fin dove la stringa arriva.
 */
function statRingHTML(p) {
    const pezzi = [];
    statVoci(p).forEach((v, i) => {
        // separatore senza spazi: ogni carattere costa un pezzo di
        // circonferenza, e tre caratteri per sei voci sarebbero mezzo giro
        if (i) pezzi.push({ testo: '·', classe: 'live-ring-sep' });
        pezzi.push({ testo: v.valore, classe: 'live-ring-num' + (v.zero ? ' live-stat--zero' : '') });
        pezzi.push({ testo: ' ' + v.etichetta, classe: 'live-ring-lbl' + (v.zero ? ' live-stat--zero' : '') });
    });

    let n = 0;
    return pezzi.map(({ testo, classe }) => [...testo].map(ch =>
        // lo spazio non si può disegnare: occupa il suo passo e basta
        `<i class="live-ring-ch ${classe}" style="--c:${n++}">${ch === ' ' ? '&nbsp;' : escAttr(ch)}</i>`
    ).join('')).join('');
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
    if (p.placeholder) return emptySlot(p, extraClass);
    const role = (p.position_in_team || p.position || '').toUpperCase();
    const live = liveNow(p);
    const injury = injuryOf(p);
    return `
    <div class="formation-slot live-slot${live ? ' live-slot--live' : ''}${gameOver(p) ? ' live-slot--done' : ''}${daGiocare(p) ? '' : ' live-slot--soon'}${extraClass}" data-player-modal
         data-slot-player="${escAttr(p.name)}"
         data-player-name="${escAttr(p.name)}" data-pos="${escAttr(role)}" data-nfl="${escAttr(p.nfl_team || '')}" data-year="${CURRENT_SEASON}"
         ${gameAttr(p)}>
        <span class="slot-photo"><img src="${cachedHeadshot(p.name)}" alt="" loading="lazy"
            data-headshot data-player-name="${p.name}" data-team="${p.nfl_team || ''}" data-pos="${role}"></span>
        <span class="slot-name">${shortName(p)}</span>
        <span class="slot-pts">${ptsHTML(p)}</span>
        <span class="live-slot-stats live-slot-stats--ring">${statRingHTML(p)}</span>
        ${injury ? `<span class="live-slot-inj">${escAttr(injury)}</span>` : ''}
    </div>`;
}

function olineSlot() {
    return `<div class="formation-slot oline-x">✕</div>`;
}

/**
 * Posto vuoto: prima del draft il campo si vede lo stesso, con i suoi ruoli al
 * posto giusto, ma al posto del giocatore ci sono trattini e la sagoma grigia.
 * Niente `data-slot-player` né `data-player-modal`: non c'è nessuno da
 * aggiornare e nessuna scheda da aprire.
 */
function emptySlot(p, extraClass = '') {
    const role = (p.position_in_team || p.position || '').toUpperCase();
    return `
    <div class="formation-slot live-slot live-slot--empty${extraClass}">
        <span class="slot-photo"><img src="images/fallback-player.svg" alt="" loading="lazy"></span>
        <span class="slot-name">–</span>
        <span class="slot-pts">–</span>
        <span class="live-slot-stats">${statBoxHTML({ position: role, stats: {} })}</span>
    </div>`;
}

/** Le nove maglie titolari e i sei posti in panchina, tutti vuoti. */
function emptyRoster(team) {
    const vuoto = (pos) => ({ name: '–', position: pos, position_in_team: pos,
        nfl_team: '', stats: {}, placeholder: true });
    return {
        ...team,
        starters: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'RB/WR', 'K', 'DEF'].map(vuoto),
        bench: Array.from({ length: 6 }, () => vuoto('BE')),
    };
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
    // Niente intestazione sopra il campo: il nome della squadra lo dicono già
    // il selettore in cima e il banner del punteggio. Il tasto Compare vive
    // dentro il campo, in alto a destra.
    return `
    <div class="live-stage">
        <div class="live-field-slider" data-swipe>
            <div class="matchup-field-horizontal live-field-solo">
                ${fieldSVG()}
                <div class="field-overlay">
                    <div class="live-formation-stack">
                        ${fieldFormationHTML(team)}
                    </div>
                </div>
                <button class="live-compare-btn" type="button" data-compare>Compare</button>
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
    <div class="live-stage">
    <div class="live-compare" style="--tc1:${t1?.color || 'var(--accent-red)'};--tc2:${t2?.color || 'var(--accent-blue)'}" data-swipe>
        <button class="live-compare-btn live-compare-btn--on" type="button" data-compare>Field</button>
        ${pairs.map(({ slot, a, b }) => {
        const pa = a ? effPts(a) : 0, pb = b ? effPts(b) : 0;
        const aWin = !!a && pa >= pb;
        const bWin = !!b && pb >= pa;
        return `
        <div class="live-cmp-row${gameOver(a) && gameOver(b) ? ' live-cmp-row--done' : ''}">
            ${comparePhoto(a)}
            ${compareName(a, 'l')}
            ${compareStatsBlock(a, aWin, 'l')}
            <span class="live-cmp-pts${aWin ? ' live-cmp-pts--win' : ''}"${a ? ` data-slot-player="${escAttr(a.name)}"` : ''}>${a ? ptsHTML(a) : '—'}</span>
            <span class="live-cmp-slot">${slot}</span>
            <span class="live-cmp-pts${bWin ? ' live-cmp-pts--win' : ''}"${b ? ` data-slot-player="${escAttr(b.name)}"` : ''}>${b ? ptsHTML(b) : '—'}</span>
            ${compareStatsBlock(b, bWin, 'r')}
            ${compareName(b, 'r')}
            ${comparePhoto(b)}
        </div>`;
    }).join('')}
    </div>
    ${swapArrowHTML()}
    </div>`;
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

/** Solo le giocate che riguardano la squadra a schermo. In demo non c'è una
 *  rosa da filtrare, quindi passano tutte. */
function visibleCards() {
    if (pbpDemo()) return pbpCards;
    const squadra = teamEntries()[teamIdx]?.team?.name;
    if (!squadra) return pbpCards;
    return pbpCards.filter(c => (c.teams || []).includes(squadra));
}

function playFeedHTML() {
    const cards = visibleCards();
    return `
    <div class="mosaic-card mc-in live-side-card pbp-card-stack">
        <span class="mc-kicker">Live plays</span>
        <div class="pbp-stack" id="pbp-stack">
            ${cards.length
            ? cards.map(playCardHTML).join('')
            : `<p class="pm-empty">${gamesToWatch().length
                ? 'Waiting for the next play...'
                : 'No NFL game in progress with your players.'}</p>`}
        </div>
    </div>`;
}

/**
 * Ridisegna l'elenco delle giocate: la più recente in cima, le altre sotto.
 * Le nuove entrano dall'alto con una piccola animazione.
 */
function paintPlayCards(newIds = []) {
    const stack = document.getElementById('pbp-stack');
    if (!stack) return;
    const cards = visibleCards();
    stack.innerHTML = cards.length ? cards.map(playCardHTML).join('')
        : `<p class="pm-empty">Waiting for the next play...</p>`;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    for (const id of newIds) {
        stack.querySelector(`[data-play="${CSS.escape(String(id))}"]`)?.animate([
            { transform: 'translateY(-26px) scale(1.03)', opacity: 0 },
            { transform: 'none', opacity: 1 },
        ], { duration: 420, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' });
    }
}


/**
 * Conteggio animato: il numero sale/scende invece di cambiare di scatto.
 * `from` è il valore precedente, `to` quello nuovo già scritto nel DOM.
 */
function countUp(el, from, to, ms = 900) {
    const num = numEl(el);
    if (!num || from === to || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const t0 = performance.now();
    const step = (now) => {
        const k = Math.min(1, (now - t0) / ms);
        const eased = 1 - Math.pow(1 - k, 3); // decelera verso il valore finale
        num.textContent = fmt(from + (to - from) * eased);
        if (k < 1) requestAnimationFrame(step);
        else num.textContent = fmt(to);
    };
    requestAnimationFrame(step);
}

/** Evidenzia sul campo i giocatori appena aggiornati + fa "stampare" lo scontrino. */
const FLASH_MS = 10000;     // quanto resta accesa la foto del giocatore
const POP_DELAY_MS = 10000; // l'etichetta dei punti resta fuori tanto, poi il totale sale

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
                const to = P(numEl(ptsEl).textContent);
                const from = +(to - ev.ptsDelta).toFixed(2);
                numEl(ptsEl).textContent = fmt(from);
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
    // Dieci secondi fuori, lampeggiando: entra, poi pulsa piano fino alla fine
    // e sparisce. Appena sparisce, il totale in basso assorbe i punti.
    tag.animate([
        { transform: 'translateY(6px) scale(0.85)', opacity: 0 },
        { transform: 'translateY(0) scale(1)', opacity: 1, offset: 0.03 },
        { transform: 'translateY(-1px) scale(1.06)', opacity: 0.45, offset: 0.14 },
        { transform: 'translateY(0) scale(1)', opacity: 1, offset: 0.25 },
        { transform: 'translateY(-1px) scale(1.06)', opacity: 0.45, offset: 0.36 },
        { transform: 'translateY(0) scale(1)', opacity: 1, offset: 0.47 },
        { transform: 'translateY(-1px) scale(1.06)', opacity: 0.45, offset: 0.58 },
        { transform: 'translateY(0) scale(1)', opacity: 1, offset: 0.69 },
        { transform: 'translateY(-1px) scale(1.06)', opacity: 0.45, offset: 0.8 },
        { transform: 'translateY(0) scale(1)', opacity: 1, offset: 0.93 },
        { transform: 'translateY(-10px) scale(0.95)', opacity: 0 },
    ], { duration: POP_DELAY_MS, easing: 'ease-in-out' })
        .onfinish = () => { tag.remove(); onDone(); };
}

function sidebarHTML(team, opp) {
    return `
    <div class="mosaic-card mc-in live-side-card">
        <span class="mc-kicker">Injury report</span>
        <div id="live-injuries">${injuriesHTML(team, opp)}</div>
    </div>`;
}

// ─── Risultati delle partite NFL vere ────────────────────────────

/**
 * Le partite NFL che contano per la squadra a schermo: quelle in cui gioca
 * almeno un suo tesserato. In corso per prime, poi quelle finite, poi quelle
 * ancora da giocare — così il riquadro dice sempre qualcosa invece di restare
 * vuoto per sei giorni su sette.
 */
function nflGamesFor(team) {
    if (!liveSchedule) return [];
    const per = new Map();   // id partita → { partita, giocatori }
    for (const p of [...(team.starters || []), ...(team.bench || [])]) {
        // Le difese non portano `nfl_team`: la squadra sta nel nome. Ricavarla
        // dall'avversario le metterebbe dalla parte sbagliata, e la stessa
        // partita comparirebbe due volte.
        const sigla = canonAbbr(p.nfl_team || '') || canonAbbr(teamAbbrFromName(p.name));
        const g = liveSchedule.get(sigla);
        if (!g) continue;
        // una riga per PARTITA, non per squadra: avendo giocatori da entrambe
        // le parti la gara resta una sola
        const chiave = g.eventId || sigla;
        if (!per.has(chiave)) per.set(chiave, { sigla, ...g, giocatori: [] });
        per.get(chiave).giocatori.push(p);
    }
    const ordine = { in: 0, post: 1, pre: 2 };
    return [...per.values()].sort((a, b) =>
        (ordine[a.state] ?? 3) - (ordine[b.state] ?? 3) || a.start - b.start);
}

function nflGamesListHTML(team) {
    const partite = nflGamesFor(team);
    if (!partite.length) return '<p class="pm-empty">No NFL games for this roster.</p>';
    return partite.map(g => {
        const avversario = (g.opponent || '').replace('@', '');
        const fuoriCasa = (g.opponent || '').startsWith('@');
        const nomi = g.giocatori.map(p => shortName(p)).join(', ');
        const punteggio = g.state === 'pre'
            ? `<span class="live-nfl-kick">${escAttr(g.detail || g.status || '')}</span>`
            : `<span class="live-nfl-score"><b>${g.score}</b> – <b>${g.oppScore}</b></span>`;
        return `
        <div class="live-nfl-row${g.state === 'in' ? ' live-nfl-row--live' : ''}">
            <span class="live-nfl-teams">
                ${g.state === 'in' ? '<i class="gb-live-dot"></i>' : ''}
                ${escAttr(fuoriCasa ? `${g.sigla} @ ${avversario}` : `${avversario} @ ${g.sigla}`)}
            </span>
            ${punteggio}
            <span class="live-nfl-when">${escAttr(g.state === 'in' ? (g.detail || '') : g.state === 'post' ? 'Final' : '')}</span>
            <span class="live-nfl-mine">${escAttr(nomi)}</span>
        </div>`;
    }).join('');
}

// ─── Dentro la partita ───────────────────────────────────────────
//
// Il punteggio dice chi sta vincendo, non se il MIO giocatore sta ricevendo
// palloni. Qui, per ogni squadra NFL in cui ho qualcuno, si guarda come
// l'attacco distribuisce il gioco: quanti bersagli e quante ricezioni per ogni
// ricevitore, quanti portati per ogni running back. Il mio è evidenziato, così
// si vede subito se davanti a lui c'è un compagno che gli sta togliendo palloni.

/** Le sigle NFL in cui la squadra selezionata ha giocatori, con i giocatori. */
function sigleDeiNostri(team) {
    const out = new Map();
    for (const p of [...(team.starters || []), ...(team.bench || [])]) {
        const ab = canonAbbr(p.nfl_team || '') || teamAbbrFromName(p.name);
        if (!ab) continue;
        if (!out.has(ab)) out.set(ab, []);
        out.get(ab).push(p);
    }
    return out;
}

/**
 * Riga di un mio giocatore che nel tabellino non c'è: niente bersagli, niente
 * portate, nemmeno una riga. Va mostrato lo stesso, in fondo al suo reparto,
 * o sembrerebbe che non l'ho in squadra invece che fermo.
 */
function usoRowAssente(p) {
    return `
    <div class="live-uso-row live-uso-row--mio live-uso-row--fermo">
        <span class="live-uso-nome">${escAttr(shortName(p))}</span>
        <span class="live-uso-bar"></span>
        <span class="live-uso-val">no stats yet</span>
        <span class="live-uso-pts">–</span>
    </div>`;
}

/** Punti fantasy di un giocatore qualunque del tabellino, con le regole della
 *  lega: serve a dire "il tuo ne sta facendo meno del suo compagno". */
function puntiDaTabellino(nome, difesa = false) {
    const s = boxData?.players?.get(normName(nome));
    if (!s) return null;
    return (scoreWeeklyStats(s, difesa ? 'DEF' : 'WR') || 0).toFixed(1);
}

/**
 * Le voci numeriche a destra: sempre tutte, anche quelle a zero, ognuna nella
 * sua colonna. Così le righe si leggono incolonnate invece di ballare a
 * seconda di chi ha segnato; gli zeri restano scuri e le altre risaltano.
 */
function usoStats(voci) {
    return voci.map(([v, etichetta]) => `
        <span class="live-uso-stat${v ? '' : ' is-zero'}"><b>${v || 0}</b> ${etichetta}</span>`).join('');
}

/** Una riga del grafico: barra proporzionale al massimo della squadra. */
function usoRow(nome, valore, massimo, dettaglio, mio, secondario = 0) {
    const punti = puntiDaTabellino(nome);
    const pct = massimo > 0 ? Math.round((valore / massimo) * 100) : 0;
    // la parte piena è il "concretizzato" (ricezioni sui bersagli): si legge
    // dentro la stessa barra, senza un secondo grafico
    const pieno = valore > 0 ? Math.round((secondario / valore) * 100) : 0;
    return `
    <div class="live-uso-row${mio ? ' live-uso-row--mio' : ''}">
        <span class="live-uso-nome">${escAttr(shortName({ name: nome }))}</span>
        <span class="live-uso-bar" style="--w:${pct}%">
            <span class="live-uso-fill" style="width:${pct}%">
                ${secondario ? `<i class="live-uso-done" style="width:${pieno}%"></i>` : ''}
            </span>
        </span>
        <span class="live-uso-val">${dettaglio}</span>
        <span class="live-uso-pts">${punti == null ? '–' : punti}</span>
    </div>`;
}

function usoBloccoHTML(titolo, righe) {
    if (!righe) return '';
    return `<div class="live-uso-blocco"><span class="live-uso-titolo">${titolo}</span>${righe}</div>`;
}

/** Quale partita si sta guardando nel "dentro la partita". */
let deepIdx = 0;

/** Le partite da mostrare, una per squadra NFL in cui ho qualcuno. */
function deepGames(team) {
    const out = [];
    for (const [sigla, miei] of sigleDeiNostri(team)) {
        const quadro = boxData?.usage?.get(sigla);
        if (quadro?.info && quadro.players?.length) {
            out.push({ sigla, miei, quadro });
            continue;
        }
        // Partita non ancora cominciata (o tabellino non arrivato): la scheda
        // si mostra lo stesso, con i miei elencati come fermi. Sparire del
        // tutto farebbe pensare di non avere nessuno in quella squadra.
        const g = liveSchedule?.get(sigla);
        if (!g) continue;
        out.push({
            sigla, miei,
            quadro: {
                players: [],
                info: {
                    team: sigla, teamName: teamNameFromAbbr(sigla), logo: '',
                    opponent: (g.opponent || '').replace('@', ''),
                    opponentName: (g.opponent || '').replace('@', ''),
                    home: !String(g.opponent || '').startsWith('@'),
                    score: g.score || 0, oppScore: g.oppScore || 0,
                    detail: g.detail || g.status || '', state: g.state || 'pre',
                },
            },
        });
    }
    return out;
}

/**
 * Confronto di squadra: chi ha fatto più fatica, e da dove è arrivata la
 * vittoria. Le voci sono in coppia — mia a sinistra, avversaria a destra — con
 * una barra che divide il totale fra le due: si legge di colpo se uno ha
 * dominato per aria o per terra, quante volte è finito a terra il quarterback
 * e quanti palloni ha buttato via.
 */
const CONFRONTO = [
    { key: 'totalYards', label: 'Total yards' },
    { key: 'netPassingYards', label: 'Passing yards' },
    { key: 'rushingYards', label: 'Rushing yards' },
    { key: 'firstDowns', label: 'First downs' },
    { key: 'thirdDownEff', label: '3rd down', testo: true },
    { key: 'sacksYardsLost', label: 'Sacks allowed', testo: true, meglioBasso: true },
    { key: 'turnovers', label: 'Turnovers', meglioBasso: true },
    { key: 'totalPenaltiesYards', label: 'Penalties', testo: true, meglioBasso: true },
    { key: 'possessionTime', label: 'Possession', testo: true },
];

/** Primo numero di un valore composto: "9-14" → 9, "25:39" → 25. */
const primoNumero = (v) => {
    const m = String(v ?? '').match(/-?\d+(\.\d+)?/);
    return m ? parseFloat(m[0]) : 0;
};

function confrontoHTML(quadro, sigla) {
    const mie = quadro.teamStats, loro = quadro.oppStats;
    if (!mie || !loro) return '';
    const opp = quadro.info?.opponent || '';

    const righe = CONFRONTO.map(({ key, label, testo, meglioBasso }) => {
        const a = mie[key], b = loro[key];
        if (a == null && b == null) return '';
        const na = primoNumero(a), nb = primoNumero(b);
        const tot = na + nb;
        const pct = tot > 0 ? Math.round((na / tot) * 100) : 50;
        // chi sta meglio su questa voce: di norma chi ha il numero più alto,
        // ma su sack subiti, palle perse e penalità è il contrario
        const vinceA = na === nb ? null : meglioBasso ? na < nb : na > nb;
        return `
        <div class="live-cmpteam-row">
            <span class="live-cmpteam-val${vinceA === true ? ' is-top' : ''}">${escAttr(testo ? (a ?? '–') : na)}</span>
            <span class="live-cmpteam-mid">
                <span class="live-cmpteam-label">${label}${meglioBasso
                    ? '<i class="live-cmpteam-giu" title="lower is better">↓</i>' : ''}</span>
                <span class="live-cmpteam-bar">
                    <i class="live-cmpteam-fill${meglioBasso ? ' is-inverse' : ''}" style="width:${pct}%"></i>
                </span>
            </span>
            <span class="live-cmpteam-val live-cmpteam-val--r${vinceA === false ? ' is-top' : ''}">${escAttr(testo ? (b ?? '–') : nb)}</span>
        </div>`;
    }).join('');

    if (!righe) return '';
    return `
    <div class="live-cmpteam">
        <div class="live-cmpteam-head">
            <span>${escAttr(sigla)}</span>
            <span class="live-cmpteam-title">Team comparison</span>
            <span>${escAttr(opp)}</span>
        </div>
        ${righe}
    </div>`;
}

function deepGameHTML({ sigla, miei, quadro }) {
    const g = quadro.info;
    const nomiMiei = new Set(miei.map(p => normName(p.name)));
    const ruoloDi = (p) => (p.position_in_team || p.position || '').toUpperCase();
    // I miei che nel tabellino non compaiono proprio: vanno in coda al reparto
    // che gli compete. Difese e kicker no: non hanno bersagli né portate.
    const fermi = miei.filter(p => !quadro.players.some(x => normName(x.name) === normName(p.name))
        && !['DEF', 'D/ST', 'K'].includes(ruoloDi(p)));
    const fermiDi = (...ruoli) => fermi.filter(p => ruoli.includes(ruoloDi(p))).map(usoRowAssente).join('');
    const ricevitori = quadro.players.filter(p => (p.targets || 0) > 0)
        .sort((a, b) => (b.targets || 0) - (a.targets || 0)).slice(0, 6);
    const maxTgt = Math.max(...ricevitori.map(p => p.targets || 0), 0);
    const corridori = quadro.players.filter(p => (p.rush_att || 0) > 0)
        .sort((a, b) => (b.rush_att || 0) - (a.rush_att || 0)).slice(0, 4);
    const maxCar = Math.max(...corridori.map(p => p.rush_att || 0), 0);
    const passatori = quadro.players.filter(p => (p.pass_yds || 0) !== 0 || (p.pass_td || 0) > 0)
        .sort((a, b) => (b.pass_yds || 0) - (a.pass_yds || 0)).slice(0, 2);

    const mio = (p) => nomiMiei.has(normName(p.name));
    const nostri = [...quadro.players.filter(mio).map(p => shortName({ name: p.name })),
        ...fermi.map(p => shortName(p))];

    return `
    <article class="live-deep-game">
        <header class="live-deep-head">
            ${g.logo ? `<img class="live-deep-logo" src="${g.logo}" alt="" loading="lazy">` : ''}
            <span class="live-deep-team">${escAttr(g.teamName || sigla)}</span>
            <span class="live-deep-vs">${g.home ? 'vs' : '@'} ${escAttr(g.opponentName || g.opponent || '')}</span>
            ${g.state === 'pre' ? ''
                : `<span class="live-deep-score">${g.score}<i>–</i>${g.oppScore}</span>`}
            <span class="live-deep-when">${escAttr(g.detail || '')}</span>
        </header>
        <p class="live-deep-sub">${escAttr(g.teamName || sigla)} offense only${nostri.length
            ? ` · yours: <b>${nostri.map(escAttr).join(', ')}</b>` : ''}</p>
        ${usoBloccoHTML('Targets and catches', ricevitori.map(p => usoRow(
            p.name, p.targets || 0, maxTgt,
            usoStats([[p.targets, 'tgt'], [p.rec, 'rec'], [p.rec_yds, 'yd'], [p.rec_td, 'TD']]),
            mio(p), p.rec || 0)).join('') + fermiDi('WR', 'TE', 'RB/WR', 'W/R', 'FLEX'))}
        ${usoBloccoHTML('Carries', corridori.map(p => usoRow(
            p.name, p.rush_att || 0, maxCar,
            usoStats([[p.rush_att, 'car'], [p.rush_yds, 'yd'], [p.rush_td, 'TD']]),
            mio(p))).join('') + fermiDi('RB'))}
        ${passatori.length || fermiDi('QB') ? `<div class="live-uso-blocco">
            <span class="live-uso-titolo">Passing</span>
            ${passatori.map(p => `<div class="live-uso-qb${mio(p) ? ' live-uso-row--mio' : ''}">
                <span class="live-uso-nome">${escAttr(shortName({ name: p.name }))}</span>
                <span class="live-uso-val">${usoStats([[p.pass_yds, 'yd'], [p.pass_td, 'TD']])}</span>
                <span class="live-uso-pts">${puntiDaTabellino(p.name) ?? '–'}</span>
            </div>`).join('')}
            ${fermi.filter(p => ruoloDi(p) === 'QB').map(p => `
            <div class="live-uso-qb live-uso-row--mio live-uso-row--fermo">
                <span class="live-uso-nome">${escAttr(shortName(p))}</span>
                <span class="live-uso-val">no stats yet</span>
                <span class="live-uso-pts">–</span>
            </div>`).join('')}
        </div>` : ''}
        ${confrontoHTML(quadro, sigla)}
    </article>`;
}

function deepDiveHTML(team) {
    const partite = deepGames(team);
    if (!partite.length) return '';
    if (deepIdx >= partite.length) deepIdx = 0;

    // Con più partite se ne guarda una per volta e si gira, come le card delle
    // giocate: affiancarle le stringerebbe fino a rendere illeggibili le barre.
    // Solo le sigle, cliccabili: niente frecce e soprattutto niente rotella.
    // La rotella qui sopra rubava lo scroll alla pagina, che arrivata a questa
    // sezione si impuntava invece di proseguire.
    const nav = partite.length < 2 ? '' : `
        <div class="live-deep-nav">
            ${partite.map((p, i) => `<button class="live-deep-dot${i === deepIdx ? ' active' : ''}"
                type="button" data-deep-go="${i}">${escAttr(p.sigla)}</button>`).join('')}
        </div>`;

    const colore = teamOf(team.name)?.color || 'var(--accent-red)';
    return `
    <section class="live-deep" id="live-deep" style="--tc-sel:${colore}">
        <div class="live-deep-title">
            <span class="mc-kicker">Inside the game</span>
            <span class="live-deep-hint">how the offense spreads the ball — yours highlighted</span>
            ${nav}
        </div>
        ${deepGameHTML(partite[deepIdx])}
    </section>`;
}

/** Si cambia partita solo cliccando una sigla: lo scroll resta della pagina. */
function bindDeepDive(root) {
    const sez = root.querySelector('#live-deep');
    if (!sez) return;
    const quante = sez.querySelectorAll('[data-deep-go]').length;
    sez.querySelectorAll('[data-deep-go]').forEach(b =>
        b.addEventListener('click', () => {
            if (quante < 2) return;
            deepIdx = (Number(b.dataset.deepGo) + quante) % quante;
            const entry = teamEntries()[teamIdx];
            if (!entry) return;
            sez.outerHTML = deepDiveHTML(entry.team).trim();
            bindDeepDive(root);
        }));
}

function nflGamesHTML(team) {
    return `
    <div class="mosaic-card mc-in live-side-card">
        <span class="mc-kicker">NFL scoreboard</span>
        <div class="live-nfl-games" id="live-nfl-games">${nflGamesListHTML(team)}</div>
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
