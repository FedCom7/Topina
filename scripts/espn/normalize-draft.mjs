/**
 * Normalizer: risposta ESPN mDraftDetail → schema legacy draft_data_YYYY.json
 * (vedi data/draft/draft_data_2025.json). Come per normalize.mjs, la forma
 * esatta di draftDetail.picks[] è community-sourced: verificare contro un
 * draft reale prima del primo run (Step 5 del blueprint).
 */

import { PRO_TEAM_ABBR, TEAM_ID_TO_NAME, SLOT_ID_MAP } from './league-config.mjs';

function teamName(teamId, teamsById) {
    return TEAM_ID_TO_NAME[teamId] || teamsById?.[teamId] || `Team ${teamId}`;
}

/**
 * `draftDetailData` è la risposta ESPN con view=mDraftDetail
 * (draftDetail.picks[]: { overallPickNumber, teamId, playerId, ... } — il
 * nome/posizione/pro team del giocatore vive altrove nella stessa risposta
 * sotto `players[]`/`playerPoolEntry` a seconda della view combinata; qui si
 * assume che ogni pick includa già un `playerPoolEntry.player` annidato —
 * DA VERIFICARE sulla risposta reale, altrimenti serve un fetch aggiuntivo
 * su players?view=kona_player_info per risolvere playerId → dettagli).
 */
export function normalizeDraft(draftDetailData, season, teamsById) {
    const picks = draftDetailData?.draftDetail?.picks;
    if (!Array.isArray(picks)) {
        throw new Error('normalizeDraft: draftDetail.picks mancante — risposta ESPN inattesa.');
    }

    const teams = {};
    for (const pick of picks) {
        const player = pick.playerPoolEntry?.player;
        if (!player) {
            console.warn(`  [normalize-draft] pick #${pick.overallPickNumber}: nessun player risolto (playerId ${pick.playerId}) — servirà un fetch kona_player_info separato.`);
            continue;
        }

        const name = teamName(pick.teamId, teamsById);
        (teams[name] ??= []).push({
            pick: pick.overallPickNumber,
            name: player.fullName || '',
            position: SLOT_ID_MAP[player.defaultPositionId] || player.defaultPositionId,
            nfl_team: PRO_TEAM_ABBR[player.proTeamId] || '',
        });
    }

    for (const team of Object.values(teams)) {
        team.sort((a, b) => a.pick - b.pick);
    }

    return {
        season: String(season),
        source: 'espn',
        synced_at: new Date().toISOString(),
        teams,
    };
}
