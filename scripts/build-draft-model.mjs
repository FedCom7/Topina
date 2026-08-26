/**
 * Allena il modello draft (SOS+) e scrive data/model/draft_model_v1.json.
 *
 * Filosofia "residuo sul baseline": pred = baseline + f(context), dove
 * baseline = proiezione preseason Sleeper e f è una ridge sui feature di
 * contesto nflverse dell'anno PRECEDENTE. Con forte regolarizzazione f→0 e
 * pred→baseline: il modello deve MERITARSI lo scostamento in validazione
 * leave-one-season-out (LOSO). Se non batte il baseline → adopted:false e il
 * browser usa la proiezione (regressione zero rispetto a oggi).
 *
 * Universo di training: tutti i giocatori skill di attacco con proiezione
 * Sleeper dell'anno Y, feature nflverse dell'anno Y-1 e punti reali (nflverse)
 * dell'anno Y. Target = punti-lega reali; bust = reale < 0.55·baseline.
 *
 * Uso:  npm run build-draft-model
 */

import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { ROOT, fetchAsset, num } from './lib/nflverse.mjs';

const OUT_DIR = path.join(ROOT, 'data', 'model');
const NFL_DIR = path.join(ROOT, 'data', 'nfl');
const TRAIN_YEARS = [2019, 2020, 2021, 2022, 2023, 2024, 2025];
const OFF = new Set(['QB', 'RB', 'WR', 'TE']);

const { scoreProjectedStats } = await import(pathToFileURL(path.join(ROOT, 'js', 'data', 'scoring.js')));

const normName = (n) => (n || '').toLowerCase().replace(/[.,']/g, '').replace(/\s+/g, ' ').trim();
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// ---- fetch proiezioni Sleeper (baseline), con cache su disco ----
async function sleeperProjections(year) {
    const cacheFile = path.join(ROOT, '.nflverse-cache', 'sleeper', `proj_${year}.json`);
    try { return JSON.parse(await readFile(cacheFile, 'utf8')); } catch { /* miss */ }
    const pos = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'].map(p => `position%5B%5D=${p}`).join('&');
    // ADP full PPR: la lega è full PPR (rec=1, vedi league-rules.js)
    const url = `https://api.sleeper.com/projections/nfl/${year}?season_type=regular&${pos}&order_by=adp_ppr`;
    const res = await fetch(url, { headers: { 'User-Agent': 'topina-league-build/1.0' } });
    if (!res.ok) return {};
    const list = await res.json();
    const map = {};
    for (const e of list) {
        const pl = e.player; if (!pl) continue;
        const p = (pl.position || '').toUpperCase();
        const name = `${pl.first_name} ${pl.last_name}`;
        const projPts = scoreProjectedStats(e.stats || {});
        if (projPts == null) continue;
        map[`${normName(name)}|${p}`] = { projPts, adp: (e.stats?.adp_ppr && e.stats.adp_ppr < 999) ? e.stats.adp_ppr : null };
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
const _advT = {};
async function advTeam(year) {
    if (year in _advT) return _advT[year];
    try { return (_advT[year] = JSON.parse(await readFile(path.join(NFL_DIR, `adv_team_${year}.json`), 'utf8'))); }
    catch { return (_advT[year] = null); }
}
let _combine; // combine_draft.json (statico, storico)
async function combineDraft() {
    if (_combine !== undefined) return _combine;
    try { return (_combine = JSON.parse(await readFile(path.join(NFL_DIR, 'combine_draft.json'), 'utf8'))); }
    catch { return (_combine = null); }
}

// ── feature pre-draft leak-safe (identiche a runtime in context-score.js) ──
/** Draft capital NFL 0-1 (pick 1 ≈ 1, undrafted = 0). Statico → no leak. */
export function draftCapOf(gsis, cd) {
    const pick = cd?.players?.[gsis]?.draft?.pick;
    return pick ? (263 - Math.min(pick, 263)) / 262 : 0;
}
/** Durabilità 0-1: media gare (Y-1, Y-2) su 17. Usa solo dati < Y → no leak. */
export function durabOf(p, p2) {
    const gps = [p?.gp, p2?.gp].filter(v => v != null);
    return gps.length ? (gps.reduce((a, b) => a + b, 0) / gps.length) / 17 : 0;
}

// composito efficienza grezza (come context-score)
function rawEff(p) {
    if (p.pos === 'RB') return (p.ryoePerAtt || 0) + 0.2 * ((p.ydsPerCarry || 0) - 4);
    if (p.pos === 'WR' || p.pos === 'TE') return 0.4 * (p.sep || 0) + 0.1 * (p.yacOE || 0) + 2 * ((p.catchRate || 0) - 0.62);
    if (p.pos === 'QB') return 0.4 * (p.cpoe || 0) + (p.epaPerGame || 0);
    return 0;
}
function rawVolume(p) {
    if (p.pos === 'RB') return (p.rushShare || 0) + 0.5 * (p.targetShare || 0) + 0.3 * (p.snapPct || 0);
    if (p.pos === 'WR' || p.pos === 'TE') return (p.wopr ?? ((p.targetShare || 0))) + 0.3 * (p.snapPct || 0);
    if (p.pos === 'QB') return (p.snapPct || 0) + (p.passAtt || 0) / 600;
    return 0;
}
function teamOffEpa(team, tData) {
    return (team && tData?.teams?.[team]?.offEpaPerPlay) ?? 0;
}

// NB: le nuove feature pre-draft vanno APPESE in fondo — così gli indici 0-10
// (usati da rawVolume/rawEff/context-score) restano invariati e un modello
// vecchio (11 coef) continua a funzionare a runtime (applyLinear itera sui coef).
const FEATURES = ['proj', 'priorFpg', 'priorGp', 'volume', 'eff', 'teamOff', 'trend', 'yearsExp', 'isRB', 'isWR', 'isTE', 'draftCap', 'durab'];

/*
 * ── ESTENDERE IL MODELLO (Livello 2, da fare al PC) ─────────────────────────
 * Candidate feature PRE-DRAFT già disponibili nei JSON committati (nessun
 * download): draft capital rookie e atletismo combine + APY contratto
 * (data/nfl/combine_draft.json), durabilità storica (data/nfl/injuries_{Y-1}),
 * competizione target da trade (data/nfl/team_trades.json), continuità/cambi
 * OL-QB (diff su data/nfl/roster_{Y} vs {Y-1}), consistenza/usage-trend ultime 8.
 *
 * Per aggiungerne una servono TRE modifiche COORDINATE (altrimenti il runtime
 * usa un vettore di lunghezza diversa dai coef salvati → bustProb sbagliata):
 *   1) qui: aggiungi il nome a FEATURES e il valore in rowsForYear().f[...]
 *   2) js/data/context-score.js → modelFeatures(): stesso ordine, stesso calcolo
 *      a runtime (dai dati Y-1 leak-safe)
 *   3) ri-esegui `npm run build-draft-model`: il GATE LOSO decide adopted:true
 *      solo se batte la baseline (medDRho>0, migliora ≥70%, MAE non peggiora).
 * Se non vince, adopted:false e il voto resta = proiezione (come oggi).
 * Il voto UFFICIALE post-draft non cambia finché il gate non adotta il modello.
 */

/** Costruisce le righe di training per un anno. */
async function rowsForYear(Y) {
    const proj = await sleeperProjections(Y);
    const prev = await adv(Y - 1);
    const prev2 = await adv(Y - 2);
    const actual = await adv(Y);
    const tPrev = await advTeam(Y - 1);
    const cd = await combineDraft();
    if (!prev || !actual) return [];

    const rows = [];
    for (const p of Object.values(prev.players)) {
        if (!OFF.has(p.pos)) continue;
        if ((p.gp || 0) < 4) continue;
        const k = `${normName(p.name)}|${p.pos}`;
        const pr = proj[k];
        if (!pr || pr.projPts == null || pr.projPts <= 0) continue; // serve il baseline
        const act = actual.players[p.gsis];
        if (!act || (act.gp || 0) < 1) continue; // richiede una stagione Y giocata
        const p2 = prev2?.players?.[p.gsis];
        const trend = (p2 && p2.gp >= 4) ? (p.fpgLeague - p2.fpgLeague) : 0;
        rows.push({
            year: Y, name: p.name, pos: p.pos, baseline: pr.projPts, target: act.fpLeague,
            f: [
                pr.projPts, p.fpgLeague || 0, p.gp || 0, rawVolume(p), rawEff(p),
                teamOffEpa(p.team, tPrev), trend, p.yearsExp || 0,
                p.pos === 'RB' ? 1 : 0, p.pos === 'WR' ? 1 : 0, p.pos === 'TE' ? 1 : 0,
                draftCapOf(p.gsis, cd), durabOf(p, p2), // pre-draft leak-safe
            ],
        });
    }
    return rows;
}

// ---------- algebra lineare (piccola) ----------
function standardize(rows) {
    const n = FEATURES.length;
    const mu = new Array(n).fill(0), sd = new Array(n).fill(0);
    for (const r of rows) for (let j = 0; j < n; j++) mu[j] += r.f[j];
    for (let j = 0; j < n; j++) mu[j] /= rows.length;
    for (const r of rows) for (let j = 0; j < n; j++) sd[j] += (r.f[j] - mu[j]) ** 2;
    for (let j = 0; j < n; j++) sd[j] = Math.sqrt(sd[j] / rows.length) || 1;
    return { mu, sd };
}
const z = (f, mu, sd) => f.map((v, j) => (v - mu[j]) / sd[j]);

/** Ridge closed-form su feature standardizzate. Ritorna {coef, intercept}. */
function ridgeFit(rows, targetFn, mu, sd, lambda) {
    const n = FEATURES.length;
    const X = rows.map(r => [1, ...z(r.f, mu, sd)]); // colonna bias
    const y = rows.map(targetFn);
    const p = n + 1;
    // A = XᵀX + λI (senza penalizzare il bias), b = Xᵀy
    const A = Array.from({ length: p }, () => new Array(p).fill(0));
    const b = new Array(p).fill(0);
    for (let i = 0; i < X.length; i++) {
        for (let a = 0; a < p; a++) {
            b[a] += X[i][a] * y[i];
            for (let c = 0; c < p; c++) A[a][c] += X[i][a] * X[i][c];
        }
    }
    for (let a = 1; a < p; a++) A[a][a] += lambda;
    const w = solve(A, b);
    return { intercept: w[0], coef: w.slice(1) };
}
function ridgePredict(f, mu, sd, model) {
    const zz = z(f, mu, sd);
    let v = model.intercept;
    for (let j = 0; j < zz.length; j++) v += model.coef[j] * zz[j];
    return v;
}
/** Gauss-Jordan con pivot parziale. */
function solve(A, b) {
    const n = b.length;
    const M = A.map((row, i) => [...row, b[i]]);
    for (let col = 0; col < n; col++) {
        let piv = col;
        for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
        [M[col], M[piv]] = [M[piv], M[col]];
        const d = M[col][col] || 1e-9;
        for (let c = col; c <= n; c++) M[col][c] /= d;
        for (let r = 0; r < n; r++) {
            if (r === col) continue;
            const factor = M[r][col];
            for (let c = col; c <= n; c++) M[r][c] -= factor * M[col][c];
        }
    }
    return M.map(row => row[n]);
}

/** Logistica L2 via gradient descent. */
function logisticFit(rows, labelFn, mu, sd, lambda, iters = 400, lr = 0.1) {
    const n = FEATURES.length;
    const w = new Array(n + 1).fill(0);
    const X = rows.map(r => [1, ...z(r.f, mu, sd)]);
    const y = rows.map(labelFn);
    for (let it = 0; it < iters; it++) {
        const g = new Array(n + 1).fill(0);
        for (let i = 0; i < X.length; i++) {
            let s = 0; for (let j = 0; j <= n; j++) s += w[j] * X[i][j];
            const pred = 1 / (1 + Math.exp(-s));
            const err = pred - y[i];
            for (let j = 0; j <= n; j++) g[j] += err * X[i][j];
        }
        for (let j = 0; j <= n; j++) {
            g[j] /= X.length;
            if (j > 0) g[j] += lambda * w[j];
            w[j] -= lr * g[j];
        }
    }
    return { intercept: w[0], coef: w.slice(1) };
}
const sigmoid = (f, mu, sd, m) => {
    const zz = z(f, mu, sd); let s = m.intercept;
    for (let j = 0; j < zz.length; j++) s += m.coef[j] * zz[j];
    return 1 / (1 + Math.exp(-s));
};

// ---------- metriche ----------
function spearman(a, b) {
    const rank = (arr) => {
        const idx = arr.map((v, i) => [v, i]).sort((x, y) => x[0] - y[0]);
        const r = new Array(arr.length);
        for (let i = 0; i < idx.length;) {
            let j = i; while (j < idx.length && idx[j][0] === idx[i][0]) j++;
            const avg = (i + j - 1) / 2;
            for (let k = i; k < j; k++) r[idx[k][1]] = avg;
            i = j;
        }
        return r;
    };
    const ra = rank(a), rb = rank(b);
    const ma = mean(ra), mb = mean(rb);
    let num = 0, da = 0, db = 0;
    for (let i = 0; i < a.length; i++) { num += (ra[i] - ma) * (rb[i] - mb); da += (ra[i] - ma) ** 2; db += (rb[i] - mb) ** 2; }
    return num / (Math.sqrt(da * db) || 1);
}
const mae = (pred, act) => mean(pred.map((p, i) => Math.abs(p - act[i])));

async function run() {
    // raccogli tutte le righe
    const allRows = [];
    for (const Y of TRAIN_YEARS) {
        const rows = await rowsForYear(Y);
        allRows.push(...rows);
        console.log(`  ${Y}: ${rows.length} righe`);
    }
    console.log(`Totale: ${allRows.length} righe (attacco)\n`);

    const lambdas = [1, 3, 10, 30, 100, 300];
    const testYears = TRAIN_YEARS;

    // ---- LOSO per la regressione (residuo) ----
    const foldStats = [];
    for (const Yt of testYears) {
        const train = allRows.filter(r => r.year !== Yt);
        const test = allRows.filter(r => r.year === Yt);
        if (!test.length || !train.length) continue;
        const { mu, sd } = standardize(train);
        // λ via LOSO interno (semplificato: media MAE su un anno di validazione interno)
        let bestL = lambdas[0], bestErr = Infinity;
        for (const lam of lambdas) {
            const innerYears = [...new Set(train.map(r => r.year))];
            let err = 0, cnt = 0;
            for (const Yi of innerYears) {
                const itr = train.filter(r => r.year !== Yi), ite = train.filter(r => r.year === Yi);
                if (!ite.length) continue;
                const m = ridgeFit(itr, r => r.target - r.baseline, mu, sd, lam);
                const pred = ite.map(r => r.baseline + ridgePredict(r.f, mu, sd, m));
                err += mae(pred, ite.map(r => r.target)) * ite.length; cnt += ite.length;
            }
            const avg = err / (cnt || 1);
            if (avg < bestErr) { bestErr = avg; bestL = lam; }
        }
        const m = ridgeFit(train, r => r.target - r.baseline, mu, sd, bestL);
        const act = test.map(r => r.target);
        const base = test.map(r => r.baseline);
        const pred = test.map(r => r.baseline + ridgePredict(r.f, mu, sd, m));
        foldStats.push({
            year: Yt, n: test.length, lambda: bestL,
            rhoBase: spearman(base, act), rhoModel: spearman(pred, act),
            maeBase: mae(base, act), maeModel: mae(pred, act),
        });
    }

    console.log('LOSO regressione (attacco):');
    console.log('  anno    n   λ     ρ_base  ρ_model   MAE_base  MAE_model');
    for (const f of foldStats) {
        console.log(`  ${f.year}  ${String(f.n).padStart(3)}  ${String(f.lambda).padStart(3)}   ${f.rhoBase.toFixed(3)}   ${f.rhoModel.toFixed(3)}    ${f.maeBase.toFixed(1)}     ${f.maeModel.toFixed(1)}`);
    }
    const dRho = foldStats.map(f => f.rhoModel - f.rhoBase).sort((a, b) => a - b);
    const medDRho = dRho[Math.floor(dRho.length / 2)];
    const improved = foldStats.filter(f => f.rhoModel > f.rhoBase).length;
    const worseMae = foldStats.filter(f => f.maeModel > f.maeBase * 1.05).length;
    const regAdopted = medDRho > 0 && improved >= Math.ceil(foldStats.length * 0.7) && worseMae === 0;
    console.log(`  → Δρ mediano ${medDRho.toFixed(3)}, migliora ${improved}/${foldStats.length}, MAE peggiore ${worseMae} → adopted: ${regAdopted}\n`);

    // ---- bust logistic (LOSO, Brier vs base-rate) ----
    const bustFolds = [];
    for (const Yt of testYears) {
        const train = allRows.filter(r => r.year !== Yt);
        const test = allRows.filter(r => r.year === Yt);
        if (!test.length) continue;
        const { mu, sd } = standardize(train);
        const label = r => (r.target < 0.55 * r.baseline ? 1 : 0);
        const m = logisticFit(train, label, mu, sd, 1.0);
        const base = mean(train.map(label)); // base-rate
        const yTest = test.map(label);
        const pModel = test.map(r => sigmoid(r.f, mu, sd, m));
        const brierModel = mean(pModel.map((p, i) => (p - yTest[i]) ** 2));
        const brierBase = mean(yTest.map(y => (base - y) ** 2));
        bustFolds.push({ year: Yt, n: test.length, rate: mean(yTest), brierBase, brierModel });
    }
    console.log('LOSO bust probability:');
    console.log('  anno    n   bust%   Brier_base  Brier_model');
    for (const f of bustFolds) console.log(`  ${f.year}  ${String(f.n).padStart(3)}   ${(f.rate * 100).toFixed(0)}%     ${f.brierBase.toFixed(3)}       ${f.brierModel.toFixed(3)}`);
    const bustImproved = bustFolds.filter(f => f.brierModel < f.brierBase).length;
    const bustAdopted = bustImproved >= Math.ceil(bustFolds.length * 0.7);
    console.log(`  → migliora ${bustImproved}/${bustFolds.length} → adopted: ${bustAdopted}\n`);

    // ---- fit finale su TUTTI gli anni (coeff da salvare) ----
    const { mu, sd } = standardize(allRows);
    const bestLambdaFinal = foldStats.length
        ? foldStats.map(f => f.lambda).sort((a, b) => a - b)[Math.floor(foldStats.length / 2)] : 30;
    const regFinal = ridgeFit(allRows, r => r.target - r.baseline, mu, sd, bestLambdaFinal);
    const bustFinal = logisticFit(allRows, r => (r.target < 0.55 * r.baseline ? 1 : 0), mu, sd, 1.0);

    const out = {
        version: 'v1',
        generatedAt: new Date().toISOString(),
        trainedRows: allRows.length,
        group: 'OFF',
        features: FEATURES,
        standardize: { mu, sd },
        reg: { adopted: regAdopted, lambda: bestLambdaFinal, intercept: regFinal.intercept, coef: regFinal.coef, mode: 'residual' },
        bust: { adopted: bustAdopted, intercept: bustFinal.intercept, coef: bustFinal.coef, threshold: 0.55 },
        backtest: { reg: foldStats, bust: bustFolds, medDeltaRho: +medDRho.toFixed(3), regImproved: `${improved}/${foldStats.length}` },
        note: 'pred = baseline(proj) + ridge(residuo) su feature nflverse Y-1; K/DEF non modellati (baseline). Vedi piano.',
    };
    await mkdir(OUT_DIR, { recursive: true });
    await writeFile(path.join(OUT_DIR, 'draft_model_v1.json'), JSON.stringify(out, null, 1));
    console.log(`→ data/model/draft_model_v1.json (reg adopted:${regAdopted}, bust adopted:${bustAdopted}, λ=${bestLambdaFinal})`);
}

await run();
