/**
 * Genera data/nfl/roster_{Y}.json — rosa completa (tutte le posizioni, non
 * solo skill) per squadra NFL e stagione, per il blocco "Compagni di squadra"
 * della pagina giocatore/DEF.
 *
 * Fonte: roster_{Y}.csv (nflverse), lo stesso file già scaricato da
 * loadIdMap() in scripts/lib/nflverse.mjs — nessun costo aggiuntivo di rete
 * se il build-nflverse-features è già stato lanciato (cache condivisa).
 *
 * Include anche lo snap% medio (offense/defense/special teams, regular
 * season) da snap_counts_{Y}.csv, per ruoli (OL/DL/LB/...) non coperti da
 * adv_players_{Y}.json (che ha solo QB/RB/WR/TE/K).
 *
 * Uso:  npm run build-nfl-roster            # 2019..2025
 *       npm run build-nfl-roster -- 2024    # una o più stagioni
 */

import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { ROOT, canonAbbr, loadCsv, num } from './lib/nflverse.mjs';

const OUT_DIR = path.join(ROOT, 'data', 'nfl');
const DEFAULT_SEASONS = ['2019', '2020', '2021', '2022', '2023', '2024', '2025'];
const r1 = (v) => (v == null || Number.isNaN(v) ? null : +v.toFixed(1));

/** Snap% medio (0-100) di regular season per pfr_player_id. */
async function loadSnapPct(year) {
    const rows = await loadCsv('snap_counts', [`snap_counts_${year}.csv`]);
    const byPfr = {};
    for (const r of rows || []) {
        if (r.game_type !== 'REG' || !r.pfr_player_id) continue;
        const off = num(r.offense_pct), def = num(r.defense_pct), st = num(r.st_pct);
        const pct = Math.max(off || 0, def || 0, st || 0); // il side dove gioca di più
        (byPfr[r.pfr_player_id] ??= []).push(pct);
    }
    const out = {};
    for (const [pfr, arr] of Object.entries(byPfr)) out[pfr] = r1(arr.reduce((a, b) => a + b, 0) / arr.length * 100);
    return out;
}

/**
 * Titolari (per squadra e formazione Offense/Defense) dall'ultimo depth
 * chart disponibile della stagione. nflverse ha DUE schemi diversi per
 * depth_charts_{Y}.csv:
 *  - fino al 2024: settimanale, colonne week/game_type/depth_team/formation/
 *    full_name/depth_position — si prende l'ultima settimana di regular
 *    season, depth_team===1.
 *  - dal 2025: snapshot giornaliero (colonna `dt`, nessun week/game_type),
 *    colonne player_name/pos_abb/pos_grp/pos_rank — si prende l'ultimo `dt`
 *    entro la stagione (i timestamp proseguono in offseason con già i pick
 *    del draft successivo, da escludere), pos_rank===1. pos_grp distingue le
 *    unità: "Special Teams" si scarta, "Base 4-3 D"/"Base 3-4 D" = difesa,
 *    tutto il resto (es. "3WR 1TE") = attacco.
 */
async function loadStarters(year) {
    const rows = await loadCsv('depth_charts', [`depth_charts_${year}.csv`]);
    if (!rows?.length) return {};

    const out = {};
    const push = (team, side, entry) => (out[team] ??= { offense: [], defense: [] })[side].push(entry);

    if (rows[0].week !== undefined) {
        // schema storico (settimanale)
        const reg = rows.filter(r => r.game_type === 'REG');
        const lastWeekByTeam = {};
        for (const r of reg) {
            const team = canonAbbr(r.club_code);
            const wk = num(r.week) || 0;
            if (!lastWeekByTeam[team] || wk > lastWeekByTeam[team]) lastWeekByTeam[team] = wk;
        }
        for (const r of reg) {
            const team = canonAbbr(r.club_code);
            if (!team || num(r.week) !== lastWeekByTeam[team] || num(r.depth_team) !== 1) continue;
            const formation = (r.formation || '').toLowerCase();
            if (!formation.startsWith('offense') && !formation.startsWith('defense')) continue; // niente special teams
            push(team, formation.startsWith('offense') ? 'offense' : 'defense', {
                gsis: r.gsis_id || null, name: r.full_name || null,
                pos: r.depth_position || r.position || null, jersey: r.jersey_number ? +r.jersey_number : null,
            });
        }
        return out;
    }

    // schema nuovo (snapshot giornaliero, dal 2025): un `dt` per squadra, non
    // globale — evita di scartare intere squadre se una ha aggiornato il
    // depth chart un giorno diverso dalle altre. Limite alla finestra
    // stagionale (1 set anno → 28 feb anno+1) per non finire nell'offseason
    // successivo (già coi pick del draft dell'anno dopo).
    const seasonStart = `${year}-09-01`, seasonEnd = `${+year + 1}-03-01`;
    const inSeason = rows.filter(r => r.dt >= seasonStart && r.dt < seasonEnd);
    const pool = inSeason.length ? inSeason : rows; // fallback: nessun dato nella finestra, meglio dell'ultimo disponibile
    const lastDtByTeam = {};
    for (const r of pool) {
        const team = canonAbbr(r.team);
        if (!lastDtByTeam[team] || r.dt > lastDtByTeam[team]) lastDtByTeam[team] = r.dt;
    }
    for (const r of pool) {
        const team = canonAbbr(r.team);
        if (!team || r.dt !== lastDtByTeam[team] || num(r.pos_rank) !== 1) continue;
        const grp = r.pos_grp || '';
        if (grp === 'Special Teams') continue;
        push(team, /^Base \d-\d D$/.test(grp) ? 'defense' : 'offense', {
            gsis: r.gsis_id || null, name: r.player_name || null, pos: r.pos_abb || null, jersey: null,
        });
    }
    return out;
}

async function buildSeason(year) {
    const [rows, snapPct, starters] = await Promise.all([
        loadCsv('rosters', [`roster_${year}.csv`, `roster_${year}.csv.gz`]),
        loadSnapPct(year),
        loadStarters(year),
    ]);
    if (!rows) return null;

    // Una entry per gsis per team: l'ultima riga incontrata vince (stato più recente).
    const byTeam = {};
    for (const r of rows) {
        const gsis = r.gsis_id || '';
        const team = canonAbbr(r.team);
        if (!gsis || !team) continue;
        const list = (byTeam[team] ??= {});
        list[gsis] = {
            gsis,
            name: r.full_name || r.football_name || '',
            pos: (r.position || '').toUpperCase(),
            jersey: r.jersey_number ? +r.jersey_number : null,
            status: r.status || null,
            college: r.college || null,
            yearsExp: num(r.years_exp),
            depthPosition: r.depth_chart_position || null,
            snapPct: r.pfr_id ? (snapPct[r.pfr_id] ?? null) : null,
            height: r.height || null, weight: num(r.weight),
            rookieYear: num(r.rookie_year) ?? num(r.entry_year),
            draftClub: r.draft_club || null, draftNumber: num(r.draft_number),
        };
    }

    const teams = {};
    for (const [team, byGsis] of Object.entries(byTeam)) {
        teams[team] = Object.values(byGsis).sort((a, b) => (a.pos || '').localeCompare(b.pos || ''));
    }
    return { season: +year, generatedAt: new Date().toISOString(), teams, starters };
}

const seasons = process.argv.slice(2).filter(a => /^\d{4}$/.test(a));
await mkdir(OUT_DIR, { recursive: true });
for (const season of (seasons.length ? seasons : DEFAULT_SEASONS)) {
    console.log(`Stagione ${season}…`);
    const out = await buildSeason(season);
    if (!out) { console.log(`  ${season}: nessun roster nflverse, salto.`); continue; }
    const file = path.join(OUT_DIR, `roster_${season}.json`);
    await writeFile(file, JSON.stringify(out));
    console.log(`  → ${path.relative(ROOT, file)} (${Object.keys(out.teams).length} squadre)`);
}
