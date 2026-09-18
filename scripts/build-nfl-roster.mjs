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
 * Ogni giocatore porta anche `list`: la lista roster su cui si trova ADESSO
 * (ACT, PS, CUT, IR, PUP, NFI, SUSP, RES, INA, EXE, RET). nflverse da solo non
 * basta: mette IR, PUP, NFI e sospesi tutti sotto `RES`, e la colonna
 * `status_description_abbr` a monte per il 2026 vale "REG" nel 97% dei casi.
 * L'etichetta fine arriva da `injury_status` di Sleeper (IR/PUP/NA/Sus), che
 * combacia quasi uno a uno con i RES di nflverse: 243 su 276 (88%) al
 * 18/09/2026. Il resto resta `RES`, che a schermo è "Reserve" e non una
 * bugia. Il dump Sleeper pesa 14 MB e per questo si scarica QUI e non nel
 * browser — è tutto il punto di avere un builder.
 *
 * L'etichetta Sleeper si applica solo alla STAGIONE IN CORSO: il dump è uno
 * stato attuale, non uno storico, e appiccicarlo al 2021 direbbe che un
 * giocatore era in IR cinque anni fa perché lo è oggi.
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

/** Stagione NFL in corso — stessa regola di js/data/nfl-team-extras.js. */
const currentNflSeason = (d = new Date()) => (d.getMonth() + 1 >= 3 ? d.getFullYear() : d.getFullYear() - 1);

/** Codice nflverse → lista roster. `RES` si affina con Sleeper (vedi sotto). */
const LIST_BY_STATUS = { ACT: 'ACT', DEV: 'PS', CUT: 'CUT', RES: 'RES', INA: 'INA', EXE: 'EXE', RET: 'RET' };
/** `injury_status` Sleeper → lista, per i soli giocatori che nflverse dà in RES. */
const LIST_BY_SLEEPER = { IR: 'IR', PUP: 'PUP', NA: 'NFI', Sus: 'SUSP', DNR: 'DNR', COV: 'COV' };

const normName = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z ]/g, '').replace(/\b(jr|sr|ii|iii|iv|v)\b/g, '').replace(/\s+/g, ' ').trim();

/**
 * Indice Sleeper per etichettare le riserve. Tre chiavi in ordine di fiducia:
 * gsis (esatto ma Sleeper ce l'ha solo per 3888 giocatori su 12228),
 * squadra+nome, e nome da solo quando non è ambiguo — quest'ultimo recupera i
 * 34 giocatori a cui Sleeper ha già tolto la squadra mettendoli in riserva.
 */
async function loadSleeperLists() {
    try {
        const res = await fetch('https://api.sleeper.app/v1/players/nfl');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const all = await res.json();
        const byGsis = {}, byTeamName = {}, byName = {};
        for (const p of Object.values(all)) {
            const n = normName(p.full_name || p.search_full_name);
            if (p.gsis_id) byGsis[p.gsis_id] ??= p;
            if (p.team && n) byTeamName[`${canonAbbr(p.team)}|${n}`] ??= p;
            if (n) byName[n] = (n in byName) ? null : p; // null = omonimi, non si usa
        }
        return (team, gsis, name) => {
            const n = normName(name);
            const p = byGsis[gsis] || byTeamName[`${team}|${n}`] || byName[n] || null;
            return p ? LIST_BY_SLEEPER[p.injury_status] || null : null;
        };
    } catch (e) {
        console.log(`  Sleeper non raggiungibile (${e.message}): le riserve restano "RES".`);
        return () => null;
    }
}

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
    const corrente = +year === currentNflSeason();
    const [rows, snapPct, starters, sleeperList] = await Promise.all([
        loadCsv('rosters', [`roster_${year}.csv`, `roster_${year}.csv.gz`]),
        loadSnapPct(year),
        loadStarters(year),
        corrente ? loadSleeperLists() : Promise.resolve(() => null),
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
            list: null, // riempita sotto: serve il nome già normalizzato
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
        for (const p of Object.values(byGsis)) {
            const base = LIST_BY_STATUS[p.status] || (p.status ? 'RES' : null);
            p.list = base === 'RES' ? (sleeperList(team, p.gsis, p.name) || 'RES') : base;
        }
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
