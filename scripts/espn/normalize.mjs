/**
 * Normalizer: risposte ESPN (mMatchup + mBoxscore) → schema legacy
 * fantasy_data_YYYY.json (lo stesso prodotto per anni dallo scraper NFL.com,
 * vedi data/fantasy/fantasy_data_2025.json). Il frontend non cambia: legge
 * sempre questo schema via js/data.js.
 *
 * ATTENZIONE — validare contro una risposta reale prima del primo run
 * ufficiale (blueprint Step 4): la forma esatta di mBoxscore.schedule[] e
 * dei campi player (stats[], appliedStatTotal) è documentata dalla
 * community, non da ESPN. Se il parsing non trova i campi attesi,
 * `normalizeSeason` lancia un errore invece di produrre un JSON parziale
 * (fail-safe: mai dati corrotti in RTDB).
 */

import { STAT_ID_MAP, SLOT_ID_MAP, BENCH_SLOT_IDS, PRO_TEAM_ABBR, TEAM_ID_TO_NAME } from './league-config.mjs';

function teamName(teamId, teamsById) {
    return TEAM_ID_TO_NAME[teamId] || teamsById?.[teamId] || `Team ${teamId}`;
}

/** Estrae dizionario {statId: valore} dall'entry stats[] più pertinente (statSourceId 0 = attuale, no proiezione). */
function actualStatLine(player, scoringPeriodId) {
    const line = (player?.stats || []).find(s =>
        s.scoringPeriodId === scoringPeriodId && s.statSourceId === 0 && s.statSplitTypeId === 1
    );
    return line?.stats || {};
}

function mapStats(rawStats) {
    const out = {};
    for (const [statId, value] of Object.entries(rawStats || {})) {
        const key = STAT_ID_MAP[Number(statId)];
        if (!key) continue;
        out[key] = (out[key] || 0) + value; // somma per chiavi accorpate (es. two_pt)
    }
    return out;
}

/** Una entry di roster (mBoxscore .rosterForCurrentScoringPeriod.entries[]) → player legacy. */
function normalizeEntry(entry, scoringPeriodId) {
    const player = entry?.playerPoolEntry?.player;
    if (!player) return null;

    const slotId = entry.lineupSlotId;
    const position = SLOT_ID_MAP[slotId] || `SLOT_${slotId}`;
    const proTeam = PRO_TEAM_ABBR[player.proTeamId] || '';
    const rawStats = actualStatLine(player, scoringPeriodId);
    const points = entry.playerPoolEntry.appliedStatTotal ?? 0;

    return {
        position,
        name: player.fullName || '',
        position_in_team: (player.eligibleSlots || [])[0] != null ? (SLOT_ID_MAP[slotId] || '') : '',
        nfl_team: proTeam,
        // ESPN non fornisce un campo "opponent"/"status" testuale come NFL.com nella
        // stessa risposta: derivabile dallo scoreboard NFL pubblico (già in uso lato
        // client per i dati NFL reali). Lasciato vuoto qui, arricchito a valle se serve.
        opponent: '',
        status: '',
        fantasy_points: String(points.toFixed ? points.toFixed(2) : points),
        stats: mapStats(rawStats),
        _slotId: slotId, // usato solo per lo smistamento starters/bench sotto, rimosso dopo
    };
}

function splitStartersBench(entries, scoringPeriodId) {
    const starters = [];
    const bench = [];
    for (const raw of entries || []) {
        const player = normalizeEntry(raw, scoringPeriodId);
        if (!player) continue;
        const { _slotId, ...clean } = player;
        (BENCH_SLOT_IDS.has(_slotId) ? bench : starters).push(clean);
    }
    return { starters, bench };
}

function normalizeTeamSide(side, scoringPeriodId, teamsById) {
    if (!side) return null;
    const { starters, bench } = splitStartersBench(
        side.rosterForCurrentScoringPeriod?.entries, scoringPeriodId
    );
    return {
        name: teamName(side.teamId, teamsById),
        score: String((side.totalPoints ?? 0).toFixed ? side.totalPoints.toFixed(2) : side.totalPoints),
        starters,
        bench,
    };
}

/**
 * Normalizza un singolo periodo (settimana) da una risposta mBoxscore.
 * `boxscoreData.schedule` contiene tutti i matchup della lega per quel
 * scoringPeriodId; filtriamo per matchupPeriodId === week.
 */
export function normalizeWeek(boxscoreData, week, teamsById) {
    const scoringPeriodId = Number(week);
    const schedule = boxscoreData?.schedule;
    if (!Array.isArray(schedule)) {
        throw new Error(`normalizeWeek: campo schedule mancante/non valido per week ${week} — risposta ESPN inattesa.`);
    }

    const matchups = schedule
        .filter(m => m.matchupPeriodId === scoringPeriodId)
        .map(m => {
            const team1 = normalizeTeamSide(m.home, scoringPeriodId, teamsById);
            const team2 = normalizeTeamSide(m.away, scoringPeriodId, teamsById);
            if (!team1 || !team2) return null;
            return { team1, team2 };
        })
        .filter(Boolean);

    return { matchups };
}

/**
 * Costruisce il fantasy_data_YYYY.json completo per una stagione, dato un
 * fetcher `getBoxscore(week) => Promise<espnResponse>` (iniettato per poter
 * testare senza rete) e la mappa teamId→nome squadra.
 */
export async function normalizeSeason(season, weeksToFetch, getBoxscore, teamsById) {
    const weeks = {};
    for (const week of weeksToFetch) {
        const data = await getBoxscore(week);
        const weekResult = normalizeWeek(data, week, teamsById);
        if (!weekResult.matchups.length) {
            console.warn(`  [normalize] week ${week}: nessun matchup trovato (stagione non ancora a questo punto?)`);
        }
        weeks[String(week)] = weekResult;
    }

    return {
        league_id: null, // valorizzato dal chiamante con ESPN_LEAGUE_ID + source:'espn'
        source: 'espn',
        season: String(season),
        synced_at: new Date().toISOString(),
        weeks,
    };
}
