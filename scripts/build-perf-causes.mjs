/**
 * Genera le CAUSE reali di "perché ha reso così" per la scorecard della pagina
 * giocatore (js/data/perf-explain.js). Per ogni giocatore-stagione d'attacco:
 *   - infortuni dei compagni dello stesso reparto (vuoto liberato)
 *   - mosse di mercato: partenze/arrivi forti nel reparto (diff pool anno-su-anno)
 *   - contesto squadra: punti/gara e mix pass-corsa vs anno precedente
 *   - difficoltà calendario: media rank FPA degli avversari per il ruolo
 *
 * Legge SOLO JSON committati + cache proiezioni Sleeper (nessun ricalcolo del
 * modello): adv_players_{Y}, roster_{Y}, team_stats_{Y} (e {Y-1}). Scrive
 * data/model/perf_causes_{Y}.json (compatto, letto dal client).
 *
 * NB: la scorecard stat-per-stat è tutta CLIENT-SIDE (perf-explain.js) — qui si
 * generano solo le annotazioni di contesto che richiedono dati cross-squadra.
 *
 * Uso:  npm run build-perf-causes        (default: 2019..2024)
 *       node scripts/build-perf-causes.mjs 2023 2024
 */

import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { ROOT } from './lib/nflverse.mjs';

const OUT_DIR = path.join(ROOT, 'data', 'model');
const NFL_DIR = path.join(ROOT, 'data', 'nfl');
const OFF = new Set(['QB', 'RB', 'WR', 'TE']);
const DEFAULT_YEARS = [2019, 2020, 2021, 2022, 2023, 2024];
const POOL_OF = { WR: 'REC', TE: 'REC', RB: 'RUSH', QB: 'QB' };

const { scoreProjectedStats } = await import(pathToFileURL(path.join(ROOT, 'js', 'data', 'scoring.js')));
const normName = (n) => (n || '').toLowerCase().replace(/[.,']/g, '').replace(/\s+/g, ' ').trim();

// ---- proiezioni Sleeper (baseline dei pool), con cache su disco ----
async function sleeperProjections(year) {
    const cacheFile = path.join(ROOT, '.nflverse-cache', 'sleeper', `proj_${year}.json`);
    try {
        const cached = JSON.parse(await readFile(cacheFile, 'utf8'));
        if (Object.values(cached).some(v => v && 'projPts' in v)) return cached;
    } catch { /* miss */ }
    const pos = ['QB', 'RB', 'WR', 'TE'].map(p => `position%5B%5D=${p}`).join('&');
    const url = `https://api.sleeper.com/projections/nfl/${year}?season_type=regular&${pos}&order_by=adp_half_ppr`;
    const res = await fetch(url, { headers: { 'User-Agent': 'topina-league-build/1.0' } });
    if (!res.ok) return {};
    const list = await res.json();
    const map = {};
    for (const e of list) {
        const pl = e.player; if (!pl) continue;
        const p = (pl.position || '').toUpperCase(); if (!OFF.has(p)) continue;
        const name = `${pl.first_name} ${pl.last_name}`;
        const projPts = scoreProjectedStats(e.stats || {});
        if (projPts == null) continue;
        map[`${normName(name)}|${p}`] = { name, pos: p, projPts: +projPts.toFixed(1), gp: e.stats?.gp != null ? +e.stats.gp : null };
    }
    await mkdir(path.dirname(cacheFile), { recursive: true });
    await writeFile(cacheFile, JSON.stringify(map));
    return map;
}

const _adv = {};
async function adv(year) {
    if (year in _adv) return _adv[year];
    try { return (_adv[year] = JSON.parse(await readFile(path.join(NFL_DIR, `adv_players_${year}.json`), 'utf8'))); }
    catch { return (_adv[year] = null); }
}
function advIndex(data) {
    const idx = {};
    if (data) for (const p of Object.values(data.players)) idx[`${normName(p.name)}|${p.pos}`] = p;
    return idx;
}
const _roster = {};
async function roster(year) {
    if (year in _roster) return _roster[year];
    try { return (_roster[year] = JSON.parse(await readFile(path.join(NFL_DIR, `roster_${year}.json`), 'utf8'))); }
    catch { return (_roster[year] = null); }
}
const _ts = {};
async function teamStats(year) {
    if (year in _ts) return _ts[year];
    try { return (_ts[year] = JSON.parse(await readFile(path.join(NFL_DIR, `team_stats_${year}.json`), 'utf8'))); }
    catch { return (_ts[year] = null); }
}

/** name|pos → { team, gsis } dal roster (include anche chi ha saltato tutta la stagione). */
function rosterTeamMap(rData) {
    const map = {};
    if (rData?.teams) for (const [team, list] of Object.entries(rData.teams)) {
        for (const p of list) map[`${normName(p.name)}|${p.pos}`] = { team, gsis: p.gsis };
    }
    return map;
}

/** Pool di reparto (team → pool → contributori proiettati con gare giocate). */
function buildPools(baseline, advIdx, rMap) {
    const pools = {};
    for (const [key, pr] of Object.entries(baseline)) {
        if (!pr || (pr.projPts || 0) <= 0) continue;
        const pool = POOL_OF[pr.pos]; if (!pool) continue;
        const info = rMap[key]; const team = info?.team; if (!team) continue;
        const projGp = Math.min(pr.gp && pr.gp > 0 ? pr.gp : 17, 17);
        const actualGp = advIdx[key]?.gp ?? 0;
        ((pools[team] ??= {})[pool] ??= []).push({ key, name: pr.name, pos: pr.pos, projPts: pr.projPts, projGp, actualGp, gsis: info.gsis });
    }
    return pools;
}

/** Cause di un giocatore-stagione (vedi header). null se niente di rilevante.
 * `a`/`aPrev` = record adv del giocatore (anno / anno prima) per i proxy O-line. */
function buildCauses({ k, pos, team, prevTeam, pool, poolsCur, poolsPrev, tsCur, tsPrev, a, aPrev }) {
    const curList = (poolsCur?.[team]?.[pool]) || [];
    const prevList = (poolsPrev?.[prevTeam]?.[pool]) || [];
    const curKeys = new Set(curList.map(t => t.key));
    const prevKeys = new Set(prevList.map(t => t.key));

    // Infortuni dei compagni che LIBERANO davvero opportunità: nel reparto REC
    // (WR/TE) i target si redistribuiscono → basta un co-titolare (≥100 pt); nel
    // reparto RUSH un backup dietro il titolare non libera tocchi → serve un
    // vero co-lead back (≥140 pt). Dedup: chi è "out" non è anche "arrivo".
    const injMin = pool === 'REC' ? 100 : 140;
    const injuredEntries = curList
        .filter(t => t.key !== k && (t.projGp - t.actualGp) >= 4 && t.projPts >= injMin)
        .sort((a, b) => (b.projPts * (b.projGp - b.actualGp)) - (a.projPts * (a.projGp - a.actualGp)));
    const injuredKeys = new Set(injuredEntries.map(t => t.key));
    const teammateInjuries = injuredEntries.slice(0, 3)
        .map(t => ({ name: t.name, pos: t.pos, missed: Math.round(t.projGp - t.actualGp), projPts: Math.round(t.projPts) }));

    const departures = prevList
        .filter(t => t.key !== k && !curKeys.has(t.key) && t.projPts >= 90)
        .map(t => ({ name: t.name, pos: t.pos, projPts: Math.round(t.projPts) }))
        .sort((a, b) => b.projPts - a.projPts).slice(0, 2);

    const arrivals = curList
        .filter(t => t.key !== k && !prevKeys.has(t.key) && !injuredKeys.has(t.key) && t.projPts >= 90)
        .map(t => ({ name: t.name, pos: t.pos, projPts: Math.round(t.projPts) }))
        .sort((a, b) => b.projPts - a.projPts).slice(0, 2);

    // Contesto scoring squadra: TD aerei/di corsa (e anno prima) → il client li lega
    // ai TD REALI del giocatore (prova l'effetto: se l'attacco segna meno TD e anche
    // i suoi calano). ppg/record come contorno.
    const tc = tsCur?.teams?.[team], tp = tsPrev?.teams?.[team];
    const teamCtx = tc?.offense ? {
        ppg: tc.offense.ppg ?? null, ppgPrev: tp?.offense?.ppg ?? null,
        passTd: tc.offense.passTd ?? null, passTdPrev: tp?.offense?.passTd ?? null,
        rushTd: tc.offense.rushTd ?? null, rushTdPrev: tp?.offense?.rushTd ?? null,
        wins: tc.record?.w ?? null, losses: tc.record?.l ?? null,
    } : null;

    // O-LINE (proxy diretti PER-GIOCATORE — no snap OL). QB: pressione subita DAL QB
    // (qbPressuredPct, non i sack di squadra). RB: yard prima del contatto (ybcPerAtt,
    // metrica O-line standard per la corsa). Ricevitori meno sensibili → niente.
    let oline = null;
    if (pos === 'QB') {
        const p = a?.qbPressuredPct, pp = aPrev?.qbPressuredPct;
        if (p != null && pp != null && Math.abs(p - pp) >= 0.04) oline = { kind: 'pass', worse: p > pp, pressure: Math.round(p * 100), pressurePrev: Math.round(pp * 100) };
    } else if (pos === 'RB') {
        const y = a?.ybcPerAtt, yp = aPrev?.ybcPerAtt;
        if (y != null && yp != null && Math.abs(y - yp) >= 0.4) oline = { kind: 'run', worse: y < yp, ybc: +y.toFixed(1), ybcPrev: +yp.toFixed(1) };
    }

    // Quota di gioco REALE (per validare le mosse di mercato): se arriva un big ma
    // il target share tiene, per il ricevitore non è cambiato nulla. REC → target
    // share, RUSH → quota corse. Confronto con l'anno prima.
    const shareKey = pool === 'REC' ? 'targetShare' : (pool === 'RUSH' ? 'rushShare' : null);
    let share = null;
    if (shareKey && a && a[shareKey] != null) {
        share = { key: shareKey, pct: Math.round(a[shareKey] * 100), pctPrev: (aPrev && aPrev[shareKey] != null) ? Math.round(aPrev[shareKey] * 100) : null };
    }

    const has = teammateInjuries.length || departures.length || arrivals.length || teamCtx || oline || share;
    return has ? { teammateInjuries, departures, arrivals, team: teamCtx, oline, share } : null;
}

async function buildYear(Y) {
    const proj = await sleeperProjections(Y);
    const curData = await adv(Y);
    if (!curData) { console.log(`  ${Y}: adv_players mancante → salto`); return null; }
    const cur = advIndex(curData);
    const prevData = await adv(Y - 1);
    const prevIdx = advIndex(prevData);
    const rMapCur = rosterTeamMap(await roster(Y));
    const rMapPrev = rosterTeamMap(await roster(Y - 1));
    const poolsCur = buildPools(proj, cur, rMapCur);
    const projPrev = await sleeperProjections(Y - 1).catch(() => ({}));
    const poolsPrev = buildPools(projPrev || {}, prevIdx, rMapPrev);
    const tsCur = await teamStats(Y);
    const tsPrev = await teamStats(Y - 1);

    const players = [];
    for (const [k, pr] of Object.entries(proj)) {
        if (pr.projPts == null || pr.projPts <= 0) continue;
        const a = cur[k]; if (!a || (a.gp || 0) < 1) continue; // serve una stagione giocata
        const team = a.team; const pool = POOL_OF[pr.pos];
        const prevTeam = rMapPrev[k]?.team || team;
        const causes = buildCauses({ k, pos: pr.pos, team, prevTeam, pool, poolsCur, poolsPrev, tsCur, tsPrev, a, aPrev: prevIdx[k] });
        if (causes) players.push({ name: pr.name, pos: pr.pos, gsis: a.gsis, team, causes });
    }
    return { season: Y, generatedAt: new Date().toISOString(), players };
}

async function main() {
    const years = process.argv.slice(2).map(Number).filter(Boolean);
    const list = years.length ? years : DEFAULT_YEARS;
    await mkdir(OUT_DIR, { recursive: true });
    console.log(`build-perf-causes — anni: ${list.join(', ')}`);
    for (const Y of list) {
        const out = await buildYear(Y);
        if (!out) continue;
        await writeFile(path.join(OUT_DIR, `perf_causes_${Y}.json`), JSON.stringify(out));
        console.log(`  ${Y}: ${out.players.length} giocatori con cause`);
    }
    console.log('fatto.');
}

main().catch(e => { console.error(e); process.exit(1); });
