/**
 * Orchestratore della sync ESPN → JSON legacy (blueprint Step 6).
 *
 * Uso:  node scripts/espn/sync.mjs [season]      # default: FIRST_ESPN_SEASON..anno corrente
 *       node scripts/espn/sync.mjs 2026 --draft  # include anche il draft
 *
 * Guardia storica: qualunque stagione < FIRST_ESPN_SEASON viene rifiutata
 * subito — 2019–2025 sono JSON congelati, mai riscritti da questo script
 * (blueprint Step 1).
 *
 * Fail-safe: se un fetch o il parsing fallisce per una stagione, lo script
 * si ferma con exit code 1 SENZA scrivere file parziali — il workflow CI non
 * fa il commit e Firebase continua a servire l'ultimo snapshot buono.
 */

import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchLeagueTeams, fetchBoxscore, fetchDraftDetail } from './client.mjs';
import { normalizeSeason } from './normalize.mjs';
import { normalizeDraft } from './normalize-draft.mjs';
import { ESPN_LEAGUE_ID, FIRST_ESPN_SEASON, TEAM_ID_TO_NAME } from './league-config.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const FANTASY_DIR = path.join(ROOT, 'data', 'fantasy');
const DRAFT_DIR = path.join(ROOT, 'data', 'draft');

/**
 * mTeam → mappa teamId(number) → displayName. `teams[].name` è il nome
 * diretto della squadra su ESPN (confermato via smoke test — location e
 * nickname sono vuoti in questa lega). TEAM_ID_TO_NAME resta l'override
 * manuale prioritario per allinearsi esattamente a TEAM_DISPLAY_NAMES.
 */
function buildTeamsById(leagueTeamsData) {
    const out = {};
    for (const t of leagueTeamsData?.teams || []) {
        out[t.id] = TEAM_ID_TO_NAME[t.id] || t.name || `${t.location || ''} ${t.nickname || ''}`.trim() || `Team ${t.id}`;
    }
    return out;
}

/** Settimane regular-season+playoff da mSettings (scheduleSettings). Fallback 1-18 se mancante. */
function weeksFromSettings(leagueTeamsData) {
    const totalWeeks = leagueTeamsData?.settings?.scheduleSettings?.matchupPeriodCount;
    const n = Number.isInteger(totalWeeks) ? totalWeeks : 18;
    return Array.from({ length: n }, (_, i) => i + 1);
}

async function syncSeason(season, { includeDraft }) {
    if (season < FIRST_ESPN_SEASON) {
        throw new Error(`Stagione ${season} < FIRST_ESPN_SEASON (${FIRST_ESPN_SEASON}) — è storia congelata, non va toccata da ESPN sync.`);
    }

    console.log(`\n=== Sync ESPN — stagione ${season} (league ${ESPN_LEAGUE_ID}) ===`);

    console.log('Fetching mSettings + mTeam...');
    const leagueTeams = await fetchLeagueTeams(ESPN_LEAGUE_ID, season);
    const teamsById = buildTeamsById(leagueTeams);
    const weeks = weeksFromSettings(leagueTeams);
    console.log(`  Team mappati: ${JSON.stringify(teamsById)}`);
    console.log(`  Settimane da sincronizzare: ${weeks[0]}-${weeks[weeks.length - 1]}`);

    const fantasyData = await normalizeSeason(
        season,
        weeks,
        (week) => fetchBoxscore(ESPN_LEAGUE_ID, season, week),
        teamsById
    );
    fantasyData.league_id = ESPN_LEAGUE_ID;

    await mkdir(FANTASY_DIR, { recursive: true });
    const fantasyPath = path.join(FANTASY_DIR, `fantasy_data_${season}.json`);
    await writeFile(fantasyPath, JSON.stringify(fantasyData, null, 2), 'utf8');
    console.log(`  Scritto ${fantasyPath}`);

    if (includeDraft) {
        console.log('Fetching mDraftDetail...');
        const draftDetail = await fetchDraftDetail(ESPN_LEAGUE_ID, season);
        const draftData = normalizeDraft(draftDetail, season, teamsById);

        await mkdir(DRAFT_DIR, { recursive: true });
        const draftPath = path.join(DRAFT_DIR, `draft_data_${season}.json`);
        await writeFile(draftPath, JSON.stringify(draftData, null, 2), 'utf8');
        console.log(`  Scritto ${draftPath}`);
    }
}

async function main() {
    const args = process.argv.slice(2);
    const includeDraft = args.includes('--draft');
    const seasonArg = args.find(a => /^\d{4}$/.test(a));
    const seasons = seasonArg ? [Number(seasonArg)] : [FIRST_ESPN_SEASON];

    for (const season of seasons) {
        await syncSeason(season, { includeDraft });
    }
    console.log('\nSync ESPN completata.');
}

main().catch(err => {
    console.error('\nSync ESPN FALLITA — nessun file scritto/aggiornato dopo questo punto:', err.message);
    process.exit(1);
});
