/**
 * Genera data/nfl/team_stats_{stagione}.json — statistiche di squadra NFL
 * (attacco, difesa, fantasy points concessi per ruolo, calendario, pace)
 * per la pagina giocatore e, in futuro, per i Draft Grades.
 *
 * Fonte primaria: dump settimanali Sleeper (regular season esatta, stesse
 * abbreviazioni del resto dell'app). Le entry DEF portano punti/yard subiti
 * e fan_pts_allow per ruolo; le entry giocatore aggregate per team danno
 * l'attacco; aggregate per avversario danno le yard concesse.
 * Per stagioni future senza stats: solo calendario da api.nfldata.org.
 *
 * Uso:  npm run build-team-stats            # tutte le stagioni 2019-2025
 *       npm run build-team-stats -- 2024    # una o più stagioni specifiche
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(new URL('.', import.meta.url).pathname, '..');
const OUT_DIR = path.join(ROOT, 'data', 'nfl');
const DEFAULT_SEASONS = ['2019', '2020', '2021', '2022', '2023', '2024', '2025'];
const POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];

// stessa canonicalizzazione di js/data/nfl-schedule.js
const ALIAS = { WSH: 'WAS', JAC: 'JAX', LA: 'LAR', STL: 'LAR', SD: 'LAC', OAK: 'LV' };
const canon = (a) => { const u = (a || '').toUpperCase().trim(); return ALIAS[u] || u; };

const { scoreProjectedStats, LEAGUE_SCORING } =
    await import(pathToFileURL(path.join(ROOT, 'js', 'data', 'scoring.js')));

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function getJson(url, tries = 3) {
    for (let i = 0; i < tries; i++) {
        try {
            const res = await fetch(url, { headers: { 'User-Agent': 'topina-league-build/1.0' } });
            if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
            if (!res.ok) return null;
            return await res.json();
        } catch (e) {
            if (i === tries - 1) throw e;
            await sleep(1000 * (i + 1));
        }
    }
}

function weeklyUrl(season, week) {
    const pos = POSITIONS.map(p => `position%5B%5D=${p}`).join('&');
    return `https://api.sleeper.com/stats/nfl/${season}/${week}?season_type=regular&${pos}`;
}

/** Punti-lega di una prestazione (coefficienti + fasce punti-subiti per le DEF). */
function leaguePts(stats, pos) {
    let pts = scoreProjectedStats(stats) ?? 0;
    if (pos === 'DEF' && stats.pts_allow != null) {
        for (const [max, p] of LEAGUE_SCORING.def_pts_allowed_tiers) {
            if (stats.pts_allow <= max) { pts += p; break; }
        }
    }
    return pts;
}

const r1 = (v) => (v == null || Number.isNaN(v) ? null : +v.toFixed(1));
const r2 = (v) => (v == null || Number.isNaN(v) ? null : +v.toFixed(2));

function blankTeam() {
    return {
        games: 0, record: { w: 0, l: 0, t: 0 },
        offense: null, defense: null, fpa: null, ranks: null, schedule: [],
        _off: { passYd: 0, passTd: 0, passInt: 0, passAtt: 0, passCmp: 0, sacked: 0, rushAtt: 0, rushYd: 0, rushTd: 0, fumLost: 0, rz: 0, snaps: 0 },
        _def: { sack: 0, int: 0, ff: 0, fumRec: 0, defTd: 0, safety: 0, qbHit: 0, passDef: 0, tklLoss: 0, blkKick: 0, ptsAllow: 0, ydsAllow: 0 },
        _allowed: { passYd: 0, rushYd: 0 },
        _fpa: {}, // pos → { league, half }
        _weekSnaps: {}, // week → max tm_off_snp
    };
}

/** Calendario ufficiale (punteggi e casa/trasferta esatti) da nfldata.org. */
async function fetchOfficialGames(season, lastWeek) {
    try {
        const res = await getJson(`https://api.nfldata.org/v1/games?season=${season}&limit=400`);
        const games = (res?.data || []).filter(x => x.game_type === 'REG' && x.week <= lastWeek);
        return games.length ? games : null;
    } catch { return null; }
}

function scheduleFromGames(games) {
    const byTeam = {};
    for (const x of games) {
        const H = canon(x.home_team), A = canon(x.away_team);
        const hs = x.home_score ?? null, as = x.away_score ?? null;
        const res = (pf, pa) => (pf == null || pa == null) ? null : pf > pa ? 'W' : pf < pa ? 'L' : 'T';
        (byTeam[H] ??= []).push({ week: x.week, opp: A, home: true, pf: hs, pa: as, result: res(hs, as) });
        (byTeam[A] ??= []).push({ week: x.week, opp: H, home: false, pf: as, pa: hs, result: res(as, hs) });
    }
    for (const list of Object.values(byTeam)) list.sort((a, b) => a.week - b.week);
    return byTeam;
}

async function buildSeason(season) {
    const lastWeek = +season <= 2020 ? 17 : 18;
    const teams = {};
    const team = (abbr) => (teams[abbr] ??= blankTeam());
    let anyData = false;

    for (let w = 1; w <= lastWeek; w++) {
        const list = await getJson(weeklyUrl(season, w));
        await sleep(300);
        if (!Array.isArray(list) || !list.length) continue;
        anyData = true;
        process.stdout.write(`  ${season} W${w}: ${list.length} entries\n`);

        for (const e of list) {
            const s = e.stats || {};
            const pos = (e.player?.position || '').toUpperCase();
            const T = canon(e.team), O = canon(e.opponent);
            if (!T || !POSITIONS.includes(pos)) continue;

            if (pos === 'DEF') {
                // una entry DEF per team-week: calendario, punti e difesa
                const t = team(T);
                const pa = s.pts_allow ?? null;
                t.schedule.push({ week: w, opp: O || null, home: e.is_away_team === false, pa, pf: null, result: null });
                const d = t._def;
                d.sack += s.sack || 0; d.int += s.int || 0; d.ff += s.ff || 0;
                d.fumRec += s.fum_rec || 0; d.defTd += s.def_td || 0; d.safety += s.safe || 0;
                d.qbHit += s.qb_hit || 0; d.passDef += s.def_pass_def || 0;
                d.tklLoss += s.tkl_loss || 0; d.blkKick += s.blk_kick || 0;
                d.ptsAllow += pa || 0; d.ydsAllow += s.yds_allow || 0;
                t.games++;
            } else {
                const t = team(T);
                const o = t._off;
                o.passYd += s.pass_yd || 0; o.passTd += s.pass_td || 0; o.passInt += s.pass_int || 0;
                o.passAtt += s.pass_att || 0; o.passCmp += s.pass_cmp || 0; o.sacked += s.pass_sack || 0;
                o.rushAtt += s.rush_att || 0; o.rushYd += s.rush_yd || 0; o.rushTd += s.rush_td || 0;
                o.fumLost += s.fum_lost || 0;
                o.rz += (s.pass_rz_att || 0) + (s.rush_rz_att || 0);
                if (s.tm_off_snp) t._weekSnaps[w] = Math.max(t._weekSnaps[w] || 0, s.tm_off_snp);
                if (O) {
                    const opp = team(O);
                    opp._allowed.passYd += s.pass_yd || 0;
                    opp._allowed.rushYd += s.rush_yd || 0;
                }
            }
            // fantasy points concessi dall'avversario al ruolo
            if (O) {
                const f = (team(O)._fpa[pos] ??= { league: 0, half: 0 });
                f.league += leaguePts(s, pos);
                f.half += s.pts_half_ppr || 0;
            }
        }
    }

    if (!anyData) return buildScheduleOnly(season, lastWeek);

    // calendario ufficiale (punteggi reali, casa/trasferta); fallback: quello
    // derivato dalle DEF (pts_allow ≈ punteggio, casa/trasferta inaffidabile)
    const official = await fetchOfficialGames(season, lastWeek);
    const officialSched = official ? scheduleFromGames(official) : null;
    for (const [abbr, t] of Object.entries(teams)) {
        if (officialSched?.[abbr]) {
            t.schedule = officialSched[abbr];
            t.games = t.schedule.filter(g => g.result != null).length || t.games;
        } else {
            // fallback: punti fatti = punti subiti dalla difesa avversaria
            for (const g of t.schedule) {
                const oppGame = teams[g.opp]?.schedule.find(x => x.week === g.week);
                g.pf = oppGame?.pa ?? null;
                if (g.pf != null && g.pa != null) g.result = g.pf > g.pa ? 'W' : g.pf < g.pa ? 'L' : 'T';
            }
            t.schedule.sort((a, b) => a.week - b.week);
        }
        for (const g of t.schedule) if (g.result) t.record[g.result.toLowerCase()]++;
    }

    // metriche per gara
    for (const t of Object.values(teams)) {
        const g = t.games || 1;
        const o = t._off, d = t._def, a = t._allowed;
        const plays = o.passAtt + o.rushAtt + o.sacked;
        t.offense = {
            ppg: r1(t.schedule.reduce((s2, x) => s2 + (x.pf || 0), 0) / g),
            totYdsPg: r1((o.passYd + o.rushYd) / g),
            passYdsPg: r1(o.passYd / g), rushYdsPg: r1(o.rushYd / g),
            playsPg: r1(plays / g),
            ydsPerPlay: plays ? r2((o.passYd + o.rushYd) / plays) : null,
            passRate: (o.passAtt + o.rushAtt) ? r2(o.passAtt / (o.passAtt + o.rushAtt)) : null,
            rzPlaysPg: r1(o.rz / g),
            turnovers: o.passInt + o.fumLost,
            sacksAllowed: o.sacked,
            passTd: o.passTd, rushTd: o.rushTd, passInt: o.passInt,
            snapsPg: r1(Object.values(t._weekSnaps).reduce((s2, v) => s2 + v, 0) / g) || null,
        };
        const paSum = t.schedule.reduce((s2, x) => s2 + (x.pa || 0), 0);
        t.defense = {
            papg: r1((paSum || d.ptsAllow) / g),
            totYdsAllowedPg: r1(d.ydsAllow / g),
            passYdsAllowedPg: r1(a.passYd / g), rushYdsAllowedPg: r1(a.rushYd / g),
            sacks: d.sack, interceptions: d.int, fumblesForced: d.ff,
            fumbleRecoveries: d.fumRec, defTds: d.defTd, safeties: d.safety,
            takeaways: d.int + d.fumRec,
            passDefended: d.passDef, tacklesForLoss: d.tklLoss,
            qbHits: d.qbHit, blockedKicks: d.blkKick,
        };
        t.fpa = {};
        for (const pos of POSITIONS) {
            const f = t._fpa[pos];
            t.fpa[pos] = f
                ? { pgLeague: r1(f.league / g), pgHalf: r1(f.half / g), rank: null }
                : { pgLeague: null, pgHalf: null, rank: null };
        }
        delete t._off; delete t._def; delete t._allowed; delete t._fpa; delete t._weekSnaps;
    }

    computeRanks(teams);
    return { season: +season, generatedAt: new Date().toISOString(), weeks: lastWeek, scheduleOnly: false, teams };
}

/** Stagione futura: solo calendario, da api.nfldata.org (nomi campi verificati sull'API live). */
async function buildScheduleOnly(season, lastWeek) {
    console.log(`  ${season}: nessuna stat Sleeper — provo il calendario da nfldata.org`);
    const res = await getJson(`https://api.nfldata.org/v1/games?season=${season}&limit=400`);
    const games = (res?.data || []).filter(x => x.game_type === 'REG');
    if (!games.length) return null;

    const teams = {};
    const team = (abbr) => (teams[abbr] ??= { ...blankTeam(), games: 0 });
    for (const x of games) {
        const H = canon(x.home_team), A = canon(x.away_team);
        team(H).schedule.push({ week: x.week, opp: A, home: true, pf: null, pa: null, result: null });
        team(A).schedule.push({ week: x.week, opp: H, home: false, pf: null, pa: null, result: null });
    }
    for (const t of Object.values(teams)) {
        t.schedule.sort((a, b) => a.week - b.week);
        ['_off', '_def', '_allowed', '_fpa', '_weekSnaps'].forEach(k => delete t[k]);
        t.offense = null; t.defense = null; t.fpa = null; t.ranks = null;
    }
    return { season: +season, generatedAt: new Date().toISOString(), weeks: lastWeek, scheduleOnly: true, teams };
}

/** Rank 1–32 per ogni metrica. `asc: true` = valore basso → rank 1 (migliore). */
function computeRanks(teams) {
    const entries = Object.entries(teams);
    const rank = (get, asc) => {
        const vals = entries
            .map(([abbr, t]) => [abbr, get(t)])
            .filter(([, v]) => v != null)
            .sort((a, b) => asc ? a[1] - b[1] : b[1] - a[1]);
        const out = {};
        vals.forEach(([abbr], i) => { out[abbr] = i + 1; });
        return out;
    };

    const OFF = { ppg: 0, totYdsPg: 0, passYdsPg: 0, rushYdsPg: 0, playsPg: 0, ydsPerPlay: 0, rzPlaysPg: 0, passTd: 0, rushTd: 0, turnovers: 1, sacksAllowed: 1, passInt: 1 };
    const DEF = { papg: 1, totYdsAllowedPg: 1, passYdsAllowedPg: 1, rushYdsAllowedPg: 1, sacks: 0, interceptions: 0, fumblesForced: 0, defTds: 0, takeaways: 0, passDefended: 0, tacklesForLoss: 0, qbHits: 0 };

    const offRanks = {}, defRanks = {};
    for (const [m, asc] of Object.entries(OFF)) offRanks[m] = rank(t => t.offense?.[m], !!asc);
    for (const [m, asc] of Object.entries(DEF)) defRanks[m] = rank(t => t.defense?.[m], !!asc);
    // FPA: rank 1 = concede PIÙ punti fantasy al ruolo (matchup facile)
    const fpaRanks = {};
    for (const pos of POSITIONS) fpaRanks[pos] = rank(t => t.fpa?.[pos]?.pgLeague ?? t.fpa?.[pos]?.pgHalf, false);

    for (const [abbr, t] of entries) {
        t.ranks = {
            offense: Object.fromEntries(Object.keys(OFF).map(m => [m, offRanks[m][abbr] ?? null])),
            defense: Object.fromEntries(Object.keys(DEF).map(m => [m, defRanks[m][abbr] ?? null])),
        };
        for (const pos of POSITIONS) if (t.fpa?.[pos]) t.fpa[pos].rank = fpaRanks[pos][abbr] ?? null;
    }
}

const seasons = process.argv.slice(2).filter(a => /^\d{4}$/.test(a));
await mkdir(OUT_DIR, { recursive: true });
for (const season of (seasons.length ? seasons : DEFAULT_SEASONS)) {
    console.log(`Stagione ${season}…`);
    const out = await buildSeason(season);
    if (!out) { console.log(`  ${season}: nessun dato disponibile, salto.`); continue; }
    const file = path.join(OUT_DIR, `team_stats_${season}.json`);
    await writeFile(file, JSON.stringify(out, null, 1));
    console.log(`  → ${path.relative(ROOT, file)} (${Object.keys(out.teams).length} team${out.scheduleOnly ? ', solo calendario' : ''})`);
}
