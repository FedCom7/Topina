/**
 * Lega fantasy ESPN letta direttamente dal browser.
 *
 * Da quando la lega è pubblica l'API risponde 200 senza cookie e manda gli
 * header CORS con l'origin del sito: non serve più il Cloudflare Worker, che
 * esisteva solo per iniettare i cookie lato server.
 *
 * `fetchLeagueWeek()` restituisce ESATTAMENTE la shape che il sito legge da
 * Firebase — stessi campi, stessi nomi, stessi formati. È quel contratto a
 * permettere di cambiare fonte senza toccare il rendering.
 *
 * Cosa dà l'API in una chiamata sola (26 KB gzip):
 *   - titolari e panchina aggiornati in tempo reale (`lineupSlotId`)
 *   - proiezioni (statSourceId 1) e punti reali (statSourceId 0)
 *   - `appliedTotal` già nello scoring della lega
 *   - regole di punteggio ufficiali (`mSettings`), che servono alle difese
 *
 * La logica è il porto fedele di scraper/espn/{maps,normalize}.py, che è
 * l'implementazione mantenuta: se una delle due cambia, allineare l'altra.
 */

import { canonAbbr } from './nfl-schedule.js?v=546';

const HOST = 'https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl';
const LEAGUE_ID = '1948241900';

// ─── Mappe (porto di scraper/espn/maps.py) ───────────────────────

const OFFENSE_STAT_IDS = {
    3: 'pass_yds', 4: 'pass_td', 20: 'pass_int',
    24: 'rush_yds', 25: 'rush_td',
    42: 'rec_yds', 43: 'rec_td', 53: 'rec',
    72: 'fum_lost',
    0: 'pass_att', 1: 'pass_comp', 23: 'rush_att', 58: 'targets',
};
const OFFENSE_COMPOSITE = {
    two_pt: [19, 26, 44],   // conversioni da 2: passaggio / corsa / ricezione
    ret_td: [101, 102],     // TD su ritorno di kickoff e di punt
    fum_td: [103, 106],     // TD su fumble recuperato
};

const KICKER_STAT_IDS = {
    86: 'pat_made', 80: 'fg_0_39', 77: 'fg_40_49', 74: 'fg_50_plus',
    83: 'fg_made', 84: 'fg_att',
};

const DEFENSE_STAT_IDS = {
    99: 'sack', 95: 'def_int', 96: 'fum_rec', 98: 'safety',
    105: 'def_td', 120: 'pts_allowed', 127: 'yds_allowed',
};
const DEFENSE_COMPOSITE = {
    def_ret_td: [101, 102, 103],
    def_2pt_ret: [104],
};

const SLOT_TO_POSITION = {
    0: 'QB', 1: 'QB', 2: 'RB', 3: 'W/R', 4: 'WR', 5: 'W/T', 6: 'TE',
    7: 'W/R/T', 16: 'DEF', 17: 'K', 20: 'BN', 21: 'RES', 23: 'W/R/T',
};
const BENCH_SLOTS = new Set([20, 21]);

const POSITION_ID_TO_LABEL = { 1: 'QB', 2: 'RB', 3: 'WR', 4: 'TE', 5: 'K', 16: 'DEF' };

const PRO_TEAM_ABBREV = {
    0: 'FA', 1: 'ATL', 2: 'BUF', 3: 'CHI', 4: 'CIN', 5: 'CLE', 6: 'DAL',
    7: 'DEN', 8: 'DET', 9: 'GB', 10: 'TEN', 11: 'IND', 12: 'KC', 13: 'LV',
    14: 'LAR', 15: 'MIA', 16: 'MIN', 17: 'NE', 18: 'NO', 19: 'NYG', 20: 'NYJ',
    21: 'PHI', 22: 'ARI', 23: 'PIT', 24: 'LAC', 25: 'SF', 26: 'SEA', 27: 'TB',
    28: 'WSH', 29: 'CAR', 30: 'JAX', 33: 'BAL', 34: 'HOU',
};

/** Le difese nell'API si chiamano "Patriots D/ST": il sito si aspetta il nome
 *  completo, o saltano logo, colore e aggancio con le rose. */
const PRO_TEAM_FULL_NAME = {
    1: 'Atlanta Falcons', 2: 'Buffalo Bills', 3: 'Chicago Bears',
    4: 'Cincinnati Bengals', 5: 'Cleveland Browns', 6: 'Dallas Cowboys',
    7: 'Denver Broncos', 8: 'Detroit Lions', 9: 'Green Bay Packers',
    10: 'Tennessee Titans', 11: 'Indianapolis Colts', 12: 'Kansas City Chiefs',
    13: 'Las Vegas Raiders', 14: 'Los Angeles Rams', 15: 'Miami Dolphins',
    16: 'Minnesota Vikings', 17: 'New England Patriots', 18: 'New Orleans Saints',
    19: 'New York Giants', 20: 'New York Jets', 21: 'Philadelphia Eagles',
    22: 'Arizona Cardinals', 23: 'Pittsburgh Steelers', 24: 'Los Angeles Chargers',
    25: 'San Francisco 49ers', 26: 'Seattle Seahawks', 27: 'Tampa Bay Buccaneers',
    28: 'Washington Commanders', 29: 'Carolina Panthers', 30: 'Jacksonville Jaguars',
    33: 'Baltimore Ravens', 34: 'Houston Texans',
};

/** Sigla → nome esteso della squadra NFL ("KC" → "Kansas City Chiefs"). */
export function teamNameFromAbbr(abbr) {
    const sigla = String(abbr || '').toUpperCase();
    for (const [id, nome] of Object.entries(PRO_TEAM_FULL_NAME)) {
        if (PRO_TEAM_ABBREV[Number(id)] === sigla) return nome;
    }
    return sigla;
}

/** "New England Patriots" → "NE". Serve a chi ha in mano solo il nome, come
 *  le difese, che nello schema storico non portano `nfl_team`. */
const NAME_TO_ABBREV = new Map(Object.entries(PRO_TEAM_FULL_NAME)
    .map(([id, nome]) => [nome.toLowerCase(), PRO_TEAM_ABBREV[Number(id)]]));

export function teamAbbrFromName(nome) {
    return NAME_TO_ABBREV.get(String(nome || '').toLowerCase()) || '';
}

/** teamId della lega → nome squadra come lo mostra il sito. */
const TEAM_ID_TO_NAME = { 1: 'Oscurus', 2: 'Lasers', 3: 'Sommo', 4: 'Capi dei Pianeti' };

// ─── Utilità ─────────────────────────────────────────────────────

const money = (v) => (Number.parseFloat(v) || 0).toFixed(2);

/** Intero quando è intero, altrimenti due decimali — come parse_stat_value. */
function statNum(v) {
    const f = Number.parseFloat(v);
    if (!Number.isFinite(f)) return 0;
    return f === Math.trunc(f) ? Math.trunc(f) : Math.round(f * 100) / 100;
}

/**
 * Statistiche nel vocabolario legacy, con TUTTE le voci del tipo (zero incluse)
 * così le colonne a schermo restano complete e la riga resta classificabile.
 */
function buildStats(raw = {}, type) {
    const g = (id) => Number.parseFloat(raw[String(id)] ?? raw[id] ?? 0) || 0;
    const [ids, composite] = type === 'K' ? [KICKER_STAT_IDS, {}]
        : type === 'DEF' ? [DEFENSE_STAT_IDS, DEFENSE_COMPOSITE]
            : [OFFENSE_STAT_IDS, OFFENSE_COMPOSITE];

    const out = {};
    for (const [id, key] of Object.entries(ids)) out[key] = statNum(g(id));
    for (const [key, list] of Object.entries(composite)) {
        out[key] = statNum(list.reduce((s, id) => s + g(id), 0));
    }
    return out;
}

/** Riga statistiche reale e proiettata della settimana. */
function statRows(player, week) {
    let real = null, proj = null;
    for (const row of player.stats || []) {
        if (row.statSplitTypeId !== 1 && row.statSplitTypeId != null) continue;
        if (row.scoringPeriodId !== week && row.scoringPeriodId != null) continue;
        if (row.statSourceId === 0) real = row;
        else if (row.statSourceId === 1) proj = row;
    }
    return { real, proj };
}

/**
 * Punti proiettati. Per attacco e kicker basta `appliedTotal`; per le difese
 * ESPN lo restituisce a ZERO pur avendo le statistiche proiettate, e va
 * ricostruito sommando ogni statId per il suo valore in punti.
 *
 * Verificato sui dati veri (2026 week 1): la ricostruzione riproduce al
 * centesimo i valori che lo scraper Python ha caricato su Firebase —
 * 6.45, 5.58, 6.84, 7.91, 6.58. Applicare invece le fasce dei punti subiti al
 * valore atteso darebbe numeri diversi, perché nelle proiezioni ESPN dà una
 * frazione per ogni fascia, non una fascia sola.
 */
function projectedTotal(proj, scoring) {
    const applied = proj?.appliedTotal || 0;
    if (applied || !scoring) return applied;
    let out = 0;
    for (const [id, v] of Object.entries(proj?.stats || {})) {
        out += (Number.parseFloat(v) || 0) * (scoring[Number(id)] || 0);
    }
    return out;
}

// ─── Normalizzazione (porto di scraper/espn/normalize.py) ────────

function normalizePlayer(entry, week, games, scoring) {
    const ppe = entry.playerPoolEntry || {};
    const player = ppe.player || {};
    const posLabel = POSITION_ID_TO_LABEL[player.defaultPositionId] || '';
    const abbr = PRO_TEAM_ABBREV[player.proTeamId] || '';

    let name = player.fullName || '';
    let nflTeam = abbr;
    if (posLabel === 'DEF') {
        nflTeam = '';  // lo schema storico lascia vuoto il team delle difese
        name = PRO_TEAM_FULL_NAME[player.proTeamId] || name.replace(/\s*D\/ST$/, '');
    }
    if (!name) return null;

    const { real, proj } = statRows(player, week);
    const type = posLabel === 'K' ? 'K' : posLabel === 'DEF' ? 'DEF' : 'OFF';
    const game = games.get(canonAbbr(abbr)) || {};

    // Il tabellone NFL è la fonte autorevole sul fatto che la partita sia
    // cominciata. Se non è raggiungibile si guarda solo se ci sono punti veri:
    // il lucchetto della formazione NON va usato, perché può risultare chiuso
    // prima del kickoff e farebbe sparire le proiezioni mostrando degli zeri.
    const started = game.state === 'in' || game.state === 'post' ? true
        : game.state === 'pre' ? false
            : Boolean(ppe.appliedStatTotal) || Boolean(real?.appliedTotal);

    const out = {
        position: SLOT_TO_POSITION[entry.lineupSlotId] || String(entry.lineupSlotId),
        name,
        position_in_team: posLabel,
        nfl_team: nflTeam,
        opponent: game.opponent || '',
        status: game.status || '',
        fantasy_points: money(ppe.appliedStatTotal),
        stats: buildStats(real?.stats, type),
        injury_status: entry.injuryStatus || (player.injured ? 'INJURED' : 'NORMAL'),
        locked: started,
        started,
    };
    if (proj) {
        out.projected_points = money(projectedTotal(proj, scoring));
        out.projected_stats = buildStats(proj.stats, type);
    }
    return out;
}

function normalizeTeam(side, week, games, scoring) {
    const starters = [], bench = [];
    for (const entry of side?.rosterForCurrentScoringPeriod?.entries || []) {
        const p = normalizePlayer(entry, week, games, scoring);
        if (!p) continue;
        (BENCH_SLOTS.has(entry.lineupSlotId) ? bench : starters).push(p);
    }
    // Totale proiettato: punti reali per chi ha già giocato, proiezione per gli
    // altri. Converge sul punteggio vero via via che le partite finiscono.
    const eff = (p) => Number.parseFloat(
        !p.started && p.projected_points != null ? p.projected_points : p.fantasy_points) || 0;

    return {
        name: TEAM_ID_TO_NAME[side?.teamId] || `Team ${side?.teamId}`,
        score: money(side?.totalPoints),
        starters,
        bench,
        projected_score: money(starters.reduce((s, p) => s + eff(p), 0)),
        team_id: side?.teamId,
    };
}

// ─── Lettura ─────────────────────────────────────────────────────

/**
 * Fetch con scadenza. Senza, una risposta che non arriva mai lascia la pagina
 * sullo spinner all'infinito: il chiamante non ha modo di accorgersene e di
 * ripiegare su Firebase.
 */
async function fetchWithTimeout(url, ms = 8000) {
    const stop = new AbortController();
    const timer = setTimeout(() => stop.abort(), ms);
    try {
        const res = await fetch(url, { signal: stop.signal });
        if (!res.ok) throw new Error(`ESPN ${res.status}`);
        return await res.json();
    } finally {
        clearTimeout(timer);
    }
}

async function readLeague(year, week) {
    const url = new URL(`${HOST}/seasons/${year}/segments/0/leagues/${LEAGUE_ID}`);
    for (const v of ['mBoxscore', 'mMatchup', 'mRoster', 'mSettings', 'mDraftDetail']) {
        url.searchParams.append('view', v);
    }
    if (week) url.searchParams.set('scoringPeriodId', String(week));
    return fetchWithTimeout(url);
}

/**
 * Il draft è stato davvero fatto?
 *
 * Serve perché prima del draft ESPN riempie le squadre di **rose segnaposto**
 * per non mostrarle vuote: 62 giocatori con `acquisitionType: null`, mai
 * acquisiti da nessuno, che verranno sostituiti di sana pianta. Mostrarli
 * sarebbe far credere che quelle rose esistano.
 *
 * `drafted` è la dichiarazione ufficiale; i pick con `playerId > 0` reggono
 * anche se ESPN tardasse ad alzare la bandiera (a draft non fatto gli slot ci
 * sono già, ma con `playerId: -1`).
 */
function draftIsDone(data) {
    const d = data?.draftDetail;
    if (!d) return true;   // senza informazione non si nasconde niente
    if (d.drafted) return true;
    return (d.picks || []).some(p => (p.playerId ?? -1) > 0);
}

/** Data del draft, se il commissioner l'ha programmato. Oggi ESPN non espone
 *  la chiave finché non viene fissata: in quel caso `null`. */
function draftDate(data) {
    const ms = data?.settings?.draftSettings?.date;
    return ms ? new Date(ms) : null;
}

/**
 * Stato del draft della lega, per la pagina Draft e per chi deve decidere se
 * mostrare le rose. Una chiamata sola, la stessa già usata per la settimana.
 */
export async function fetchDraftStatus(year) {
    const data = await readLeague(year, null);
    return { drafted: draftIsDone(data), date: draftDate(data) };
}

/**
 * Una settimana di lega nella shape di Firebase.
 *
 * `week` può essere omessa: la si ricava da `status.currentMatchupPeriod` e si
 * rilegge con quella. `games` è la mappa del tabellone NFL (da getWeekSchedule):
 * serve a sapere se la partita è cominciata e chi è l'avversario.
 *
 * `games` può essere anche una FUNZIONE `(week) => Promise<Map>`, e va usata
 * così quando la settimana non si sa ancora. Chi chiamava passando una mappa
 * caricata prima doveva indovinare la settimana: il Live tirava giù il
 * tabellone della week 1, dove ogni partita risulta finita, e finché non
 * arrivava il poll successivo ogni giocatore veniva contato come "ha già
 * giocato" — nessuna proiezione a schermo e totale proiettato a zero.
 */
export async function fetchLeagueWeek(year, week = null, games = new Map()) {
    let data = await readLeague(year, week);
    const current = data.status?.currentMatchupPeriod || 1;
    if (!week) {
        week = current;
        data = await readLeague(year, week);
    }
    if (typeof games === 'function') games = (await games(week)) || new Map();

    const scoring = {};
    for (const item of data.settings?.scoringSettings?.scoringItems || []) {
        scoring[Number(item.statId)] = Number(item.points) || 0;
    }

    const matchups = [];
    for (const m of data.schedule || []) {
        if (m.matchupPeriodId !== week) continue;
        if (!m.home?.rosterForCurrentScoringPeriod && !m.away?.rosterForCurrentScoringPeriod) continue;
        const team1 = normalizeTeam(m.home, week, games, scoring);
        const team2 = normalizeTeam(m.away, week, games, scoring);
        matchups.push({
            team1, team2,
            winner: m.winner && m.winner !== 'UNDECIDED'
                ? (m.winner === 'HOME' ? team1.name : team2.name)
                : 'UNDECIDED',
        });
    }
    // `drafted` falso ⇒ le rose sono segnaposto di ESPN, non squadre vere
    return { week, matchups, drafted: draftIsDone(data), draftDate: draftDate(data) };
}

// ─── Proiezioni per giocatori fuori dalle rose ESPN ──────────────

/**
 * Proiezioni di giornata di TUTTI i giocatori, non solo di quelli che ESPN ha
 * messo nelle quattro squadre.
 *
 * Serve quando le formazioni arrivano dal draft (prima che la lega abbia
 * draftato): quei giocatori nelle rose ESPN non ci sono, quindi la chiamata
 * normale non porta la loro proiezione. Il listone `kona_player_info` invece le
 * ha per tutti, e `appliedTotal` è già calcolato col punteggio della lega.
 *
 * Ritorna Map(nome normalizzato → { points, stats, pos }).
 */
export async function fetchProjections(year, week) {
    const url = new URL(`${HOST}/seasons/${year}/segments/0/leagues/${LEAGUE_ID}`);
    url.searchParams.set('scoringPeriodId', String(week));
    url.searchParams.append('view', 'kona_player_info');
    url.searchParams.append('view', 'mSettings');

    const filtro = { players: { limit: 1500,
        sortDraftRanks: { sortPriority: 1, sortAsc: true, value: 'STANDARD' } } };

    const stop = new AbortController();
    const timer = setTimeout(() => stop.abort(), 12000);
    let data;
    try {
        const res = await fetch(url, { signal: stop.signal,
            headers: { 'x-fantasy-filter': JSON.stringify(filtro) } });
        if (!res.ok) throw new Error(`ESPN ${res.status}`);
        data = await res.json();
    } finally { clearTimeout(timer); }

    const scoring = {};
    for (const item of data.settings?.scoringSettings?.scoringItems || []) {
        scoring[Number(item.statId)] = Number(item.points) || 0;
    }

    const out = new Map();
    for (const voce of data.players || []) {
        const p = voce.player || {};
        const pos = POSITION_ID_TO_LABEL[p.defaultPositionId] || '';
        const { proj } = statRows(p, week);
        if (!proj) continue;
        // le difese si cercano col nome completo della squadra, come ovunque
        const nome = pos === 'DEF'
            ? (PRO_TEAM_FULL_NAME[p.proTeamId] || String(p.fullName).replace(/\s*D\/ST$/, ''))
            : p.fullName;
        if (!nome) continue;
        out.set(projKey(nome), {
            points: money(projectedTotal(proj, scoring)),
            stats: buildStats(proj.stats, pos === 'K' ? 'K' : pos === 'DEF' ? 'DEF' : 'OFF'),
            pos,
        });
    }
    return out;
}

/** Chiave di confronto fra nomi: le fonti scrivono accenti e punti a modo loro. */
export const projKey = (s) => String(s || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim();

/**
 * Riempie le proiezioni che mancano, chiunque sia il giocatore a schermo.
 *
 * Quando le formazioni arrivano dalle rose ESPN la proiezione c'è già dentro la
 * risposta della lega (27 KB, la stessa che porta i punti ufficiali): questa
 * funzione non fa nulla e non chiede niente. Serve quando i giocatori NON
 * stanno in quelle rose — oggi perché vengono dal draft — e allora l'unica
 * fonte è il listone di tutti i giocatori, che pesa 630 KB: per questo si legge
 * al massimo una volta al minuto e solo se manca davvero qualcosa, mentre punti
 * e statistiche continuano ad aggiornarsi ogni dieci secondi.
 */
let cacheProiezioni = { chiave: '', quando: 0, mappa: null };
// nomi che nel listone non ci sono (rincalzi senza stima): chiederli di nuovo
// ogni minuto significherebbe scaricare 630 KB per sempre, senza guadagnarci
const senzaStima = new Set();

export async function fillMissingProjections(matchups, year, week) {
    const tutti = [];
    const titolari = [];
    for (const m of matchups || []) {
        for (const lato of ['team1', 'team2']) {
            const t = m[lato];
            if (!t) continue;
            tutti.push(...(t.starters || []), ...(t.bench || []));
            titolari.push(...(t.starters || []));
        }
    }
    // Si va a cercare solo per i TITOLARI che non hanno ancora giocato: sono
    // quelli che il banner somma. Un panchinaro senza stima non vale una
    // richiesta da mezzo mega.
    const manca = (p) => !p.started && p.projected_points == null && !senzaStima.has(projKey(p.name));
    if (!titolari.some(manca)) return false;

    const chiave = `${year}-${week}`;
    if (cacheProiezioni.chiave !== chiave || Date.now() - cacheProiezioni.quando > 60000) {
        try {
            cacheProiezioni = { chiave, quando: Date.now(), mappa: await fetchProjections(year, week) };
        } catch (e) {
            console.warn('[espn-fantasy] proiezioni non disponibili:', e.message);
            if (cacheProiezioni.chiave !== chiave) return false;
        }
    }
    const proiezioni = cacheProiezioni.mappa;
    if (!proiezioni?.size) return false;

    for (const p of tutti) {
        if (p.projected_points != null) continue;
        const chiaveNome = projKey(p.name);
        const v = proiezioni.get(chiaveNome);
        if (!v) { senzaStima.add(chiaveNome); continue; }
        p.projected_points = v.points;
        p.projected_stats = v.stats;
    }
    for (const m of matchups || []) {
        for (const lato of ['team1', 'team2']) {
            const t = m[lato];
            if (!t) continue;
            // stesso criterio del resto della pagina: proiezione per chi non ha
            // ancora giocato, punti veri per gli altri
            t.projected_score = money((t.starters || []).reduce((s, p) => s + (Number.parseFloat(
                !p.started && p.projected_points != null ? p.projected_points : p.fantasy_points) || 0), 0));
        }
    }
    return true;
}
