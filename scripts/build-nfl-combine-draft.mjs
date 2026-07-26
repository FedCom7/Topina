/**
 * Genera data/nfl/combine_draft.json — combine, draft NFL reale (non Topina)
 * e contratto per giocatore, più lo storico draft per squadra. Dato storico,
 * si rigenera raramente (una volta a stagione basta, quando escono nuovi
 * pick/contratti), non ha bisogno di fallback live: se un giocatore non
 * compare si omette semplicemente la tessera in pagina.
 *
 * Fonti (nflverse, via scripts/lib/nflverse.mjs):
 *   draft_picks.csv          — round/pick/team, età, HOF, All-Pro/Pro-Bowl
 *                               di carriera, AV, presenze (join per gsis_id)
 *   combine.csv              — misure combine (join per pfr_id)
 *   historical_contracts.csv.gz (OTC) — contratto attivo (join per nome+ruolo,
 *                               niente id condiviso con nflverse in questo file)
 *
 * Uso:  npm run build-nfl-combine-draft
 */

import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { ROOT, canonAbbr, loadCsv, num, nameKey } from './lib/nflverse.mjs';

const OUT_DIR = path.join(ROOT, 'data', 'nfl');
const isTrue = (v) => /^true$|^1$/i.test(String(v || '').trim());

// draft_picks.csv usa sigle in stile PFR (storiche/di franchigia), diverse da
// quelle nflverse standard già gestite da canonAbbr(): le normalizziamo qui.
const PFR_ALIAS = {
    GNB: 'GB', KAN: 'KC', NOR: 'NO', NWE: 'NE', SFO: 'SF', TAM: 'TB',
    PHO: 'ARI', CRD: 'ARI', RAI: 'LV', RAM: 'LAR', SDG: 'LAC', LVR: 'LV',
    OTI: 'TEN', CLT: 'IND', HTX: 'HOU', RAV: 'BAL',
};
const canonDraftTeam = (t) => canonAbbr(PFR_ALIAS[(t || '').toUpperCase().trim()] || t);

async function loadCombineByPfr() {
    const rows = await loadCsv('combine', ['combine.csv']);
    const byPfr = {};
    for (const r of rows || []) {
        if (!r.pfr_id) continue;
        byPfr[r.pfr_id] = {
            ht: r.ht || null, wt: num(r.wt), forty: num(r.forty), bench: num(r.bench),
            vertical: num(r.vertical), broadJump: num(r.broad_jump), cone: num(r.cone), shuttle: num(r.shuttle),
        };
    }
    return byPfr;
}

/** Contratti OTC attivi, ultimo per firma, chiave nome+ruolo normalizzato. */
async function loadActiveContractsByNameKey() {
    const rows = await loadCsv('contracts', ['historical_contracts.csv.gz']);
    const byKey = {};
    for (const r of rows || []) {
        if (!isTrue(r.is_active)) continue;
        const key = nameKey(r.player, r.position);
        const yearSigned = num(r.year_signed);
        const existing = byKey[key];
        if (existing && (existing.yearSigned || 0) >= (yearSigned || 0)) continue;
        byKey[key] = {
            value: num(r.value), apy: num(r.apy), guaranteed: num(r.guaranteed),
            years: num(r.years), yearSigned,
        };
    }
    return byKey;
}

async function build() {
    const [draftRows, combineByPfr, contractsByKey] = await Promise.all([
        loadCsv('draft_picks', ['draft_picks.csv']),
        loadCombineByPfr(),
        loadActiveContractsByNameKey(),
    ]);
    if (!draftRows) return null;

    const players = {};
    const teamDraftHistory = {};

    for (const r of draftRows) {
        const gsis = r.gsis_id || '';
        if (!gsis) continue; // niente chiave per collegarlo a un giocatore Topina
        const name = r.pfr_player_name || '';
        const pos = (r.position || '').toUpperCase();
        const team = canonDraftTeam(r.team);
        const draft = {
            season: num(r.season), round: num(r.round), pick: num(r.pick), team,
            age: num(r.age), hof: isTrue(r.hof),
            allproCareer: num(r.allpro), probowlsCareer: num(r.probowls),
            seasonsStarted: num(r.seasons_started), careerAV: num(r.car_av), games: num(r.games),
            lastSeason: num(r.to), weightedAV: num(r.w_av), draftTeamAV: num(r.dr_av),
        };
        // Totali di carriera PFR (dalla stessa riga draft_picks.csv): copre anche
        // le stagioni precedenti al 2015 che Sleeper (player-full.js) non ha —
        // gap-fill per i giocatori con carriera iniziata prima del 2015.
        const careerTotals = {
            passCmp: num(r.pass_completions), passAtt: num(r.pass_attempts), passYd: num(r.pass_yards),
            passTd: num(r.pass_tds), passInt: num(r.pass_ints),
            rushAtt: num(r.rush_atts), rushYd: num(r.rush_yards), rushTd: num(r.rush_tds),
            rec: num(r.receptions), recYd: num(r.rec_yards), recTd: num(r.rec_tds),
            defSoloTkl: num(r.def_solo_tackles), defInt: num(r.def_ints), defSack: num(r.def_sacks),
        };
        const hasCareerTotals = Object.values(careerTotals).some(v => v != null);
        const combine = r.pfr_player_id ? (combineByPfr[r.pfr_player_id] || null) : null;
        const contract = contractsByKey[nameKey(name, pos)] || null;

        players[gsis] = { name, pos, college: r.college || null, draft, combine, contract, careerTotals: hasCareerTotals ? careerTotals : null };

        if (team) {
            (teamDraftHistory[team] ??= []).push({
                season: draft.season, round: draft.round, pick: draft.pick,
                gsis, name, pos, college: r.college || null,
                allpro: draft.allproCareer, probowls: draft.probowlsCareer, careerAV: draft.careerAV,
            });
        }
    }

    for (const list of Object.values(teamDraftHistory)) {
        list.sort((a, b) => (b.season || 0) - (a.season || 0) || (a.pick || 0) - (b.pick || 0));
    }

    // Percentile draft per ruolo: dove si piazza il pick (overall) di questo
    // giocatore tra tutti quelli della STESSA posizione drafted nello STESSO
    // anno (confronto equo: ogni classe di draft ha la sua profondità).
    // rank 1 = scelto per primo tra i suoi; percentile 100 = il migliore.
    const byYearPos = {};
    for (const [gsis, p] of Object.entries(players)) {
        if (p.draft?.season == null || p.draft?.pick == null || !p.pos) continue;
        (byYearPos[`${p.draft.season}|${p.pos}`] ??= []).push(gsis);
    }
    for (const list of Object.values(byYearPos)) {
        list.sort((a, b) => players[a].draft.pick - players[b].draft.pick);
        const total = list.length;
        list.forEach((gsis, i) => {
            const rank = i + 1;
            players[gsis].draft.posRank = rank;
            players[gsis].draft.posCount = total;
            players[gsis].draft.posPercentile = total > 1 ? Math.round((total - rank) / (total - 1) * 100) : null;
        });
    }

    return { generatedAt: new Date().toISOString(), players, teamDraftHistory };
}

await mkdir(OUT_DIR, { recursive: true });
console.log('Combine + draft NFL reale + contratti…');
const out = await build();
if (!out) { console.log('  nessun dato draft_picks nflverse, interrotto.'); process.exit(1); }
const file = path.join(OUT_DIR, 'combine_draft.json');
await writeFile(file, JSON.stringify(out));
console.log(`  → ${path.relative(ROOT, file)} (${Object.keys(out.players).length} giocatori, ${Object.keys(out.teamDraftHistory).length} squadre)`);
