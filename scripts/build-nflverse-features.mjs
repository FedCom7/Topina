/**
 * Genera i JSON feature avanzati da nflverse (dati NFL aperti) per il
 * Player Context Score (SOS+), la pagina "tutte le statistiche" e il modello
 * draft. Committa SOLO output compatti; i CSV grezzi restano in .nflverse-cache/.
 *
 * Output (data/nfl/):
 *   adv_players_{Y}.json  — per skill player: volume, efficienza, produzione,
 *                           game-log punti-lega (per varianza/boom-bust), id.
 *   adv_team_{Y}.json     — contesto attacco squadra (EPA/play, success, PROE)
 *                           da play-by-play.
 *   playerids.json        — mappa sleeper↔gsis↔pfr↔nome (unione anni).
 *
 * Vincolo: questi dati alimentano SOLO il modello e le pagine full-stats.
 * Non entrano nel resto dell'app. Vedi il piano e context-score.js.
 *
 * Uso:  npm run build-nflverse            # 2015..2025
 *       npm run build-nflverse -- 2023    # una o più stagioni
 */

import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import {
    ROOT, canonAbbr, loadCsv, loadIdMap, fetchAsset, parseCsvSelect, num, nameKey,
} from './lib/nflverse.mjs';

const OUT_DIR = path.join(ROOT, 'data', 'nfl');
const DEFAULT_SEASONS = ['2015', '2016', '2017', '2018', '2019', '2020', '2021', '2022', '2023', '2024', '2025'];
const SKILL = new Set(['QB', 'RB', 'WR', 'TE', 'K']);

const { LEAGUE_SCORING: S } =
    await import(pathToFileURL(path.join(ROOT, 'js', 'data', 'scoring.js')));

const r1 = (v) => (v == null || Number.isNaN(v) ? null : +(+v).toFixed(1));
const r2 = (v) => (v == null || Number.isNaN(v) ? null : +(+v).toFixed(2));
const r3 = (v) => (v == null || Number.isNaN(v) ? null : +(+v).toFixed(3));
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);

/** Punti-lega di una prestazione settimanale offensiva dai campi nflverse. */
function scoreOffenseWeek(r) {
    const g = (k) => num(r[k]) || 0;
    const fumLost = g('sack_fumbles_lost') + g('rushing_fumbles_lost') + g('receiving_fumbles_lost');
    const twoPt = g('passing_2pt_conversions') + g('rushing_2pt_conversions') + g('receiving_2pt_conversions');
    return g('passing_yards') * S.pass_yd + g('passing_tds') * S.pass_td + g('interceptions') * S.pass_int
        + g('rushing_yards') * S.rush_yd + g('rushing_tds') * S.rush_td
        + g('receptions') * S.rec + g('receiving_yards') * S.rec_yd + g('receiving_tds') * S.rec_td
        + fumLost * S.fum_lost + twoPt * S.two_pt + g('special_teams_tds') * S.ret_td;
}

/** Punti-lega stagionali di un kicker dai bucket FG del file season. */
function scoreKickerSeason(r) {
    const g = (k) => num(r[k]) || 0;
    return g('fg_made_0_19') * S.fg_0_19 + g('fg_made_20_29') * S.fg_20_29 + g('fg_made_30_39') * S.fg_30_39
        + g('fg_made_40_49') * S.fg_40_49 + (g('fg_made_50_59') + g('fg_made_60_')) * S.fg_50_plus
        + g('pat_made') * S.pat_made;
}

/**
 * Weekly player stats della stagione. nflverse ha rinominato la release: fino
 * al 2024 il file storico è `player_stats/player_stats_{Y}.csv`; dal 2025 è
 * `stats_player/stats_player_week_{Y}.csv.gz` (nuovo schema, più colonne e
 * alcune rinomine). Provo prima il vecchio (output storici invariati), poi il
 * nuovo, e normalizzo le due-tre colonne rinominate così il resto del build
 * non cambia. `recent_team`→`team`, `interceptions`→`passing_interceptions`.
 */
async function loadWeekly(year) {
    const rows = (await loadCsv('player_stats', [`player_stats_${year}.csv`, `player_stats_${year}.csv.gz`]))
        || (await loadCsv('stats_player', [`stats_player_week_${year}.csv.gz`, `stats_player_week_${year}.csv`]));
    if (!rows) return null;
    for (const r of rows) {
        if (r.recent_team == null || r.recent_team === '') r.recent_team = r.team;
        if (r.interceptions == null || r.interceptions === '') r.interceptions = r.passing_interceptions;
    }
    return rows;
}

/** Aggrega snap_counts_{Y}: pfr_player_id → media offense_pct e gare. */
async function loadSnapShare(year) {
    const rows = await loadCsv('snap_counts', [`snap_counts_${year}.csv`, `snap_counts_${year}.csv.gz`]);
    if (!rows) return {};
    const byPfr = {};
    for (const r of rows) {
        if (r.game_type !== 'REG') continue;
        const pct = num(r.offense_pct);
        if (pct == null) continue;
        (byPfr[r.pfr_player_id] ??= []).push(pct);
    }
    const out = {};
    for (const [pfr, arr] of Object.entries(byPfr)) out[pfr] = mean(arr);
    return out;
}

/**
 * Righe NGS di un tipo. nflverse ora pubblica un file COMBINATO (tutti gli
 * anni, es. `ngs_receiving.csv.gz`) al posto dei per-anno `ngs_{Y}_...`. Provo
 * il per-anno (storico), poi il combinato; il chiamante filtra per stagione.
 */
async function ngsRows(kind, year) {
    return (await loadCsv('nextgen_stats', [`ngs_${year}_${kind}.csv.gz`, `ngs_${year}_${kind}.csv`]))
        || (await loadCsv('nextgen_stats', [`ngs_${kind}.csv.gz`, `ngs_${kind}.csv`]));
}

/** NGS stagionali (riga week==0): tracking receiving/rushing/passing. gsis → {}. */
async function loadNgs(year) {
    const out = {};
    const add = (gsis, obj) => { out[gsis] = { ...(out[gsis] || {}), ...obj }; };
    const seasonReg0 = (r) => r.season_type === 'REG' && +r.week === 0 && +r.season === +year;
    const rec = await ngsRows('receiving', year);
    for (const r of rec || []) {
        if (!seasonReg0(r)) continue;
        add(r.player_gsis_id, {
            sep: num(r.avg_separation), cushion: num(r.avg_cushion),
            yacOE: num(r.avg_yac_above_expectation), aySharePct: num(r.percent_share_of_intended_air_yards),
            intendedAirYd: num(r.avg_intended_air_yards),
        });
    }
    const rush = await ngsRows('rushing', year);
    for (const r of rush || []) {
        if (!seasonReg0(r)) continue;
        add(r.player_gsis_id, {
            ryoePerAtt: num(r.rush_yards_over_expected_per_att),
            rushEff: num(r.efficiency), rushPctOE: num(r.rush_pct_over_expected),
            timeToLos: num(r.avg_time_to_los), pctAtt8Def: num(r.percent_attempts_gte_eight_defenders),
        });
    }
    const pass = await ngsRows('passing', year);
    for (const r of pass || []) {
        if (!seasonReg0(r)) continue;
        add(r.player_gsis_id, {
            cpoe: num(r.completion_percentage_above_expectation),
            timeToThrow: num(r.avg_time_to_throw), aggressiveness: num(r.aggressiveness),
            expComplPct: num(r.expected_completion_percentage), airYdToSticks: num(r.avg_air_yards_to_sticks),
        });
    }
    return out;
}

/** PFR advanced (broken tackle, YBC/YAC, drop, pressioni QB). pfr_id → {}, poi → gsis. */
async function loadPfrAdv(year, idMap) {
    const byPfr = {};
    const get = (pfr) => (byPfr[pfr] ??= { _rushG: 0, _recG: 0, _passG: 0 });
    const rush = await loadCsv('pfr_advstats', [`advstats_week_rush_${year}.csv`]);
    for (const r of rush || []) {
        if (r.game_type !== 'REG') continue;
        const a = get(r.pfr_player_id); a._rushG++;
        a.carries = (a.carries || 0) + (num(r.carries) || 0);
        a.ybc = (a.ybc || 0) + (num(r.rushing_yards_before_contact) || 0);
        a.yac = (a.yac || 0) + (num(r.rushing_yards_after_contact) || 0);
        a.rushBt = (a.rushBt || 0) + (num(r.rushing_broken_tackles) || 0);
    }
    const rec = await loadCsv('pfr_advstats', [`advstats_week_rec_${year}.csv`]);
    for (const r of rec || []) {
        if (r.game_type !== 'REG') continue;
        const a = get(r.pfr_player_id); a._recG++;
        a.drops = (a.drops || 0) + (num(r.receiving_drop) || 0);
        a.recBt = (a.recBt || 0) + (num(r.receiving_broken_tackles) || 0);
        a._dropPct = (a._dropPct || 0) + (num(r.receiving_drop_pct) || 0);
    }
    const pass = await loadCsv('pfr_advstats', [`advstats_week_pass_${year}.csv`]);
    for (const r of pass || []) {
        if (r.game_type !== 'REG') continue;
        const a = get(r.pfr_player_id); a._passG++;
        a.sacked = (a.sacked || 0) + (num(r.times_sacked) || 0);
        a.blitzed = (a.blitzed || 0) + (num(r.times_blitzed) || 0);
        a.hurried = (a.hurried || 0) + (num(r.times_hurried) || 0);
        a.hit = (a.hit || 0) + (num(r.times_hit) || 0);
        a.pressured = (a.pressured || 0) + (num(r.times_pressured) || 0);
        a._badPct = (a._badPct || 0) + (num(r.passing_bad_throw_pct) || 0);
        a._prPct = (a._prPct || 0) + (num(r.times_pressured_pct) || 0);
    }
    // pfr → gsis, con derivate
    const out = {};
    for (const [pfr, a] of Object.entries(byPfr)) {
        const e = idMap?.byPfr[pfr];
        if (!e) continue;
        out[e.gsis] = {
            ybcPerAtt: a.carries ? +(a.ybc / a.carries).toFixed(2) : null,
            yacPerAtt: a.carries ? +(a.yac / a.carries).toFixed(2) : null,
            rushBrokenTk: a.rushBt || null,
            recDrops: a.drops || null,
            recDropPct: a._recG ? +(a._dropPct / a._recG).toFixed(3) : null,
            recBrokenTk: a.recBt || null,
            qbSacked: a.sacked || null, qbBlitzed: a.blitzed || null, qbHurried: a.hurried || null,
            qbHit: a.hit || null, qbPressured: a.pressured || null,
            qbBadThrowPct: a._passG ? +(a._badPct / a._passG).toFixed(3) : null,
            qbPressuredPct: a._passG ? +(a._prPct / a._passG).toFixed(3) : null,
        };
    }
    return out;
}

/** Punti-lega stagionali dei kicker (file season stats_player_reg_{Y}). gsis → pts. */
async function loadKickers(year) {
    const rows = (await loadCsv('player_stats', [`stats_player_reg_${year}.csv.gz`, `stats_player_reg_${year}.csv`]))
        || (await loadCsv('stats_player', [`stats_player_reg_${year}.csv.gz`, `stats_player_reg_${year}.csv`]));
    const out = {};
    for (const r of rows || []) {
        if ((r.position || '').toUpperCase() !== 'K') continue;
        out[r.player_id] = { fpLeague: scoreKickerSeason(r), gp: num(r.games), fgAtt: num(r.fg_att), fgMade: num(r.fg_made) };
    }
    return out;
}

/**
 * Contesto squadra da play-by-play. ATTACCO (aggregato per `posteam`): EPA/play,
 * success, PROE, pass rate, ritmo. DIFESA (STESSO EPA aggregato per `defteam` —
 * chi subisce la giocata): EPA e success rate CONCESSI, split pass/corsa. Per la
 * difesa un valore più BASSO è migliore (concede meno). Simmetrico all'attacco:
 * lo stesso play-by-play riletto dalle due prospettive.
 */
async function buildTeamContext(year) {
    // pbp è enorme: elabora in RAM senza scriverlo in cache (disco frugale).
    const text = await fetchAsset('pbp', `play_by_play_${year}.csv.gz`, { noCache: true });
    if (!text) return null;
    const rows = parseCsvSelect(text, [
        'posteam', 'defteam', 'season_type', 'play_type', 'epa', 'success', 'pass', 'rush', 'qb_dropback', 'pass_oe', 'week',
    ]);
    const T = {}, D = {};
    const newT = () => ({ plays: 0, pass: 0, rush: 0, epaSum: 0, epaN: 0, passEpaSum: 0, passN: 0, rushEpaSum: 0, rushN: 0, succSum: 0, succN: 0, proeSum: 0, proeN: 0, weeks: new Set() });
    for (const r of rows) {
        if (r.season_type !== 'REG') continue;
        const isPass = r.pass === '1', isRush = r.rush === '1';
        if (!isPass && !isRush) continue;
        const epa = num(r.epa);
        const succ = num(r.success);
        const pt = canonAbbr(r.posteam);
        if (pt) {
            const t = T[pt] ??= newT();
            t.plays++;
            if (r.week) t.weeks.add(r.week);
            if (isPass) t.pass++; if (isRush) t.rush++;
            if (epa != null) {
                t.epaSum += epa; t.epaN++;
                if (isPass) { t.passEpaSum += epa; t.passN++; } else { t.rushEpaSum += epa; t.rushN++; }
            }
            if (succ != null) { t.succSum += succ; t.succN++; }
            const proe = num(r.pass_oe);
            if (proe != null) { t.proeSum += proe; t.proeN++; }
        }
        const dt = canonAbbr(r.defteam);
        if (dt) {
            const d = D[dt] ??= newT();
            d.plays++;
            if (r.week) d.weeks.add(r.week);
            if (epa != null) {
                d.epaSum += epa; d.epaN++;
                if (isPass) { d.passEpaSum += epa; d.passN++; } else { d.rushEpaSum += epa; d.rushN++; }
            }
            if (succ != null) { d.succSum += succ; d.succN++; }
        }
    }
    const teams = {};
    for (const abbr of new Set([...Object.keys(T), ...Object.keys(D)])) {
        const t = T[abbr], d = D[abbr];
        const games = (t?.weeks.size || d?.weeks.size) || 1;
        teams[abbr] = {
            games,
            offEpaPerPlay: t?.epaN ? r3(t.epaSum / t.epaN) : null,
            passEpaPerPlay: t?.passN ? r3(t.passEpaSum / t.passN) : null,
            rushEpaPerPlay: t?.rushN ? r3(t.rushEpaSum / t.rushN) : null,
            successRate: t?.succN ? r3(t.succSum / t.succN) : null,
            passRate: t?.plays ? r3(t.pass / (t.pass + t.rush)) : null,
            proe: t?.proeN ? r2(t.proeSum / t.proeN) : null,
            playsPg: t ? r1(t.plays / games) : null,
            // difesa: EPA/success CONCESSI (più basso = meglio) + split pass/corsa
            defEpaPerPlay: d?.epaN ? r3(d.epaSum / d.epaN) : null,
            defPassEpaPerPlay: d?.passN ? r3(d.passEpaSum / d.passN) : null,
            defRushEpaPerPlay: d?.rushN ? r3(d.rushEpaSum / d.rushN) : null,
            defSuccessRate: d?.succN ? r3(d.succSum / d.succN) : null,
        };
    }
    return { season: +year, generatedAt: new Date().toISOString(), teams };
}

/** adv_players_{Y}.json — aggregazione per giocatore skill. */
async function buildPlayers(year, idMap) {
    const weekly = await loadWeekly(year);
    if (!weekly) return null;
    const [snap, ngs, pfr, kickers] = await Promise.all([
        loadSnapShare(year), loadNgs(year), loadPfrAdv(year, idMap), loadKickers(year),
    ]);

    // totali di squadra (per share): carries e target per team-week
    const teamTot = {}; // team → { carries, targets }
    for (const r of weekly) {
        if (r.season_type !== 'REG') continue;
        const tm = canonAbbr(r.recent_team);
        const t = teamTot[tm] ??= { carries: 0, targets: 0 };
        t.carries += num(r.carries) || 0;
        t.targets += num(r.targets) || 0;
    }

    const P = {};
    for (const r of weekly) {
        if (r.season_type !== 'REG') continue;
        const pos = (r.position || '').toUpperCase();
        if (!SKILL.has(pos) || pos === 'K') continue; // K trattati a parte
        const gsis = r.player_id;
        if (!gsis) continue;
        const p = P[gsis] ??= {
            gsis, name: r.player_display_name || r.player_name, pos,
            team: canonAbbr(r.recent_team), weeks: [], _v: [],
            carries: 0, targets: 0, rec: 0, recYd: 0, rushYd: 0, recAY: 0, recYac: 0,
            passYd: 0, passTd: 0, passAtt: 0, epa: 0,
        };
        p.team = canonAbbr(r.recent_team); // team più recente
        const fp = scoreOffenseWeek(r);
        p.weeks.push({ wk: +r.week, opp: canonAbbr(r.opponent_team), fp: r1(fp) });
        p.carries += num(r.carries) || 0;
        p.targets += num(r.targets) || 0;
        p.rec += num(r.receptions) || 0;
        p.recYd += num(r.receiving_yards) || 0;
        p.rushYd += num(r.rushing_yards) || 0;
        p.recAY += num(r.receiving_air_yards) || 0;
        p.recYac += num(r.receiving_yards_after_catch) || 0;
        p.passYd += num(r.passing_yards) || 0;
        p.passTd += num(r.passing_tds) || 0;
        p.passAtt += num(r.attempts) || 0;
        p.epa += (num(r.receiving_epa) || 0) + (num(r.rushing_epa) || 0) + (num(r.passing_epa) || 0);
        // share settimanali (medie)
        const ts = num(r.target_share), as = num(r.air_yards_share), wp = num(r.wopr), rc = num(r.racr);
        (p._v ??= []).push({ ts, as, wp, rc });
    }

    const players = {};
    for (const [gsis, p] of Object.entries(P)) {
        const gp = p.weeks.length;
        const id = idMap?.byGsis[gsis];
        const tm = p.team;
        const fpLeague = p.weeks.reduce((s, w) => s + (w.fp || 0), 0);
        const vShare = (k) => mean(p._v.map(x => x[k]).filter(v => v != null));
        players[gsis] = {
            gsis, sleeper: id?.sleeper || null, pfr: id?.pfr || null,
            name: p.name, pos: p.pos, team: tm,
            yearsExp: id?.yearsExp ?? null, rookieYear: id?.rookieYear ?? null,
            gp,
            fpLeague: r1(fpLeague), fpgLeague: r1(fpLeague / (gp || 1)),
            // volume
            targetShare: r3(vShare('ts')), airYardsShare: r3(vShare('as')), wopr: r3(vShare('wp')), racr: r2(vShare('rc')),
            rushShare: teamTot[tm]?.carries ? r3(p.carries / teamTot[tm].carries) : null,
            tgtPerGame: r1(p.targets / (gp || 1)), carriesPerGame: r1(p.carries / (gp || 1)),
            snapPct: id?.pfr && snap[id.pfr] != null ? r3(snap[id.pfr]) : null,
            // efficienza
            catchRate: p.targets ? r3(p.rec / p.targets) : null,
            ydsPerTgt: p.targets ? r2(p.recYd / p.targets) : null,
            yacPerRec: p.rec ? r2(p.recYac / p.rec) : null,
            ydsPerCarry: p.carries ? r2(p.rushYd / p.carries) : null,
            epaTotal: r1(p.epa), epaPerGame: r2(p.epa / (gp || 1)),
            // passing (QB)
            passYd: p.passYd || null, passTd: p.passTd || null, passAtt: p.passAtt || null,
            // NGS (Next Gen Stats tracking)
            ...(ngs[gsis] ? {
                sep: r2(ngs[gsis].sep), cushion: r2(ngs[gsis].cushion), yacOE: r2(ngs[gsis].yacOE),
                aySharePct: r1(ngs[gsis].aySharePct), intendedAirYd: r2(ngs[gsis].intendedAirYd),
                ryoePerAtt: r2(ngs[gsis].ryoePerAtt), rushEff: r2(ngs[gsis].rushEff),
                timeToLos: r2(ngs[gsis].timeToLos), pctAtt8Def: r1(ngs[gsis].pctAtt8Def),
                cpoe: r2(ngs[gsis].cpoe), timeToThrow: r2(ngs[gsis].timeToThrow),
                aggressiveness: r1(ngs[gsis].aggressiveness), expComplPct: r1(ngs[gsis].expComplPct),
                airYdToSticks: r2(ngs[gsis].airYdToSticks),
            } : {}),
            // PFR advanced (broken tackle, YBC/YAC, drop, pressioni)
            ...(pfr[gsis] || {}),
            // game log per varianza (solo punti-lega)
            weekly: p.weeks.sort((a, b) => a.wk - b.wk).map(w => w.fp),
        };
    }

    // kicker (produzione stagionale, senza game-log)
    for (const [gsis, k] of Object.entries(kickers)) {
        const id = idMap?.byGsis[gsis];
        players[gsis] = {
            gsis, sleeper: id?.sleeper || null, pfr: id?.pfr || null,
            name: id?.name || gsis, pos: 'K', team: id?.team || null,
            yearsExp: id?.yearsExp ?? null, rookieYear: id?.rookieYear ?? null,
            gp: k.gp, fpLeague: r1(k.fpLeague), fpgLeague: r1(k.fpLeague / (k.gp || 1)),
            fgAtt: k.fgAtt, fgMade: k.fgMade, weekly: [],
        };
    }

    return { season: +year, generatedAt: new Date().toISOString(), count: Object.keys(players).length, players };
}

async function run() {
    const args = process.argv.slice(2);
    const noTeam = args.includes('--no-team');     // salta il play-by-play (pesante)
    const teamOnly = args.includes('--team-only'); // solo adv_team (salta i player, rigenerazione leggera)
    const seasons = args.filter(a => /^\d{4}$/.test(a));
    await mkdir(OUT_DIR, { recursive: true });
    // playerids.json va UNITO all'esistente: una run parziale non deve azzerarlo
    let idIndex = {};
    try { idIndex = JSON.parse(await readFile(path.join(OUT_DIR, 'playerids.json'), 'utf8')).bySleeper || {}; }
    catch { /* prima generazione */ }

    for (const year of (seasons.length ? seasons : DEFAULT_SEASONS)) {
        console.log(`Stagione ${year}…`);
        const idMap = await loadIdMap(year);
        if (idMap) {
            for (const e of idMap.all) {
                if (!e.sleeper) continue;
                idIndex[e.sleeper] = { gsis: e.gsis, pfr: e.pfr, name: e.name, pos: e.pos };
            }
        }

        const players = teamOnly ? null : await buildPlayers(year, idMap);
        if (players) {
            await writeFile(path.join(OUT_DIR, `adv_players_${year}.json`), JSON.stringify(players));
            console.log(`  → adv_players_${year}.json (${players.count} giocatori)`);
        } else if (teamOnly) {
            console.log(`  ${year}: --team-only, salto players.`);
        } else {
            console.log(`  ${year}: nessuna stat player nflverse, salto players.`);
        }

        const team = noTeam ? null : await buildTeamContext(year);
        if (noTeam) console.log(`  ${year}: --no-team, salto play-by-play.`);
        if (team) {
            await writeFile(path.join(OUT_DIR, `adv_team_${year}.json`), JSON.stringify(team, null, 0));
            console.log(`  → adv_team_${year}.json (${Object.keys(team.teams).length} squadre)`);
        } else {
            console.log(`  ${year}: nessun play-by-play, salto team.`);
        }
    }

    if (Object.keys(idIndex).length) {
        await writeFile(path.join(OUT_DIR, 'playerids.json'), JSON.stringify({ generatedAt: new Date().toISOString(), bySleeper: idIndex }));
        console.log(`\n→ playerids.json (${Object.keys(idIndex).length} sleeper id)`);
    }
}

await run();
