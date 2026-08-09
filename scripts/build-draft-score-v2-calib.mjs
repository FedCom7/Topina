/**
 * Backtest + calibrazione del Draft Score v2 → data/model/draft_score_v2_calib.json.
 *
 * Esegue il MOTORE REALE (js/data/draft-score-v2.js) sui draft storici 2019-2025 e
 * verifica se il voto v2 (col senno del giorno del draft) CORRELA con la produzione
 * reale poi ottenuta dai giocatori scelti (Spearman entro ogni stagione). Filosofia
 * identica a build-draft-model.mjs: i pesi/soglie a mano restano finché non c'è un
 * segnale che meriti l'adozione (gate). Con sole 4 squadre/anno il campione è piccolo:
 * lo script è soprattutto un monitor di validazione + il gancio per pesi tarati.
 *
 * Output: { adopted, backtest:{perSeason, meanRho}, thresholds, weights, note }.
 * Il browser lo legge (getDraftScoreV2Calib) e usa i valori tarati SOLO se adopted:true;
 * altrimenti tiene i default del motore (degradazione graceful, comportamento invariato).
 *
 * Uso:  node scripts/build-draft-score-v2-calib.mjs
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { ROOT } from './lib/nflverse.mjs';

// shim minimale: il motore/projections usano localStorage solo come cache
globalThis.localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} };

const NFL_DIR = path.join(ROOT, 'data', 'nfl');
const DRAFT_DIR = path.join(ROOT, 'data', 'draft');
const OUT_DIR = path.join(ROOT, 'data', 'model');
const SEASONS = ['2019', '2020', '2021', '2022', '2023', '2024', '2025'];
const POS_FALLBACK = { K: 125, DEF: 110 };

const imp = (p) => import(pathToFileURL(path.join(ROOT, p)));
const { computeDraftScoreV2 } = await imp('js/data/draft-score-v2.js');
const { getSeasonProjections, matchProjection, normName } = await imp('js/data/projections.js');

const readJson = async (p) => { try { return JSON.parse(await readFile(p, 'utf8')); } catch { return null; } };

/** grades minimale (come computeGrades) per una stagione, valore = proiezione. */
function buildGrades(draft, proj) {
    const teams = draft?.teams || {};
    const size = Object.keys(teams).length || 4;
    const grades = [];
    for (const [team, list] of Object.entries(teams)) {
        const picks = (list || []).map(p => {
            const hit = matchProjection(proj, p.name, p.position);
            const value = hit?.projPts ?? hit?.ptsStd ?? POS_FALLBACK[p.position] ?? 0;
            return {
                pick: p.pick, round: Math.ceil(p.pick / size), player: p.name,
                pos: p.position, nfl: p.nfl_team, adp: hit?.adp ?? null, value, team,
            };
        }).sort((a, b) => a.pick - b.pick);
        grades.push({ key: team, list: picks });
    }
    return grades;
}

/** produzione reale per team: somma fpLeague dei giocatori scelti (offense+K, nflverse). */
function realizedByTeam(grades, advReal) {
    const real = {};
    for (const g of grades) {
        let sum = 0;
        for (const p of g.list) {
            const r = advReal.get(`${normName(p.player)}|${p.pos}`);
            if (r != null) sum += r;
        }
        real[g.key] = sum;
    }
    return real;
}

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
    const m = (x) => x.reduce((s, v) => s + v, 0) / x.length;
    const ma = m(ra), mb = m(rb);
    let num = 0, da = 0, db = 0;
    for (let i = 0; i < a.length; i++) { num += (ra[i] - ma) * (rb[i] - mb); da += (ra[i] - ma) ** 2; db += (rb[i] - mb) ** 2; }
    return num / (Math.sqrt(da * db) || 1);
}

async function loadAdvReal(year) {
    const adv = await readJson(path.join(NFL_DIR, `adv_players_${year}.json`));
    if (!adv?.players) return null;
    const map = new Map();
    for (const p of Object.values(adv.players)) {
        if (p.fpLeague == null) continue;
        map.set(`${normName(p.name)}|${p.pos}`, p.fpLeague);
    }
    return map;
}

async function loadAdpDisp(year) {
    const d = await readJson(path.join(NFL_DIR, `adp_ffc_${year}.json`));
    if (!d?.players) return null;
    const map = new Map();
    for (const [k, v] of Object.entries(d.players)) map.set(k, v);
    return map;
}

async function run() {
    const perSeason = [];
    for (const year of SEASONS) {
        const draft = await readJson(path.join(DRAFT_DIR, `draft_data_${year}.json`));
        if (!draft?.teams) { console.log(`  ${year}: nessun draft`); continue; }
        let proj;
        try { proj = await getSeasonProjections(year); } catch (e) { console.log(`  ${year}: proj ${e.message}`); continue; }
        if (!proj?.size) { console.log(`  ${year}: proiezioni vuote`); continue; }
        const advReal = await loadAdvReal(year);
        if (!advReal) { console.log(`  ${year}: adv_players mancante → niente target reale`); continue; }
        const adpDisp = await loadAdpDisp(year);

        const grades = buildGrades(draft, proj);
        const v2 = computeDraftScoreV2(grades, proj, { adpDisp });
        if (!v2) { console.log(`  ${year}: v2 null`); continue; }

        const real = realizedByTeam(grades, advReal);
        const keys = grades.map(g => g.key);
        const scores = keys.map(k => v2.byKey[k].score);
        const reals = keys.map(k => real[k]);
        const rho = spearman(scores, reals);
        perSeason.push({ year: +year, teams: keys.length, rho: +rho.toFixed(3), scores: scores.map(s => +s.toFixed(1)) });
        console.log(`  ${year}: ρ(v2, realized) = ${rho.toFixed(3)}  scores=[${scores.map(s => Math.round(s)).join(',')}]`);
    }

    const rhos = perSeason.map(s => s.rho);
    const meanRho = rhos.length ? +(rhos.reduce((a, b) => a + b, 0) / rhos.length).toFixed(3) : 0;
    // gate: adotta (validando i pesi ATTUALI) solo con segnale positivo robusto
    const positive = perSeason.filter(s => s.rho > 0).length;
    const adopted = perSeason.length >= 5 && meanRho >= 0.5 && positive >= Math.ceil(perSeason.length * 0.7);

    const out = {
        version: 'v2-calib-1',
        generatedAt: new Date().toISOString(),
        adopted,
        // pesi/soglie ATTUALI del motore (echo): se un giorno il gate li tara, cambiano qui
        thresholds: [[80, 'A+'], [73, 'A'], [68, 'A-'], [63, 'B+'], [58, 'B'], [53, 'B-'], [47, 'C+'], [41, 'C'], [35, 'C-'], [28, 'D']],
        weights: { starterBase: 0.65, starterMult: 18, balanceMult: 0.06 },
        backtest: { perSeason, meanRho, positiveSeasons: `${positive}/${perSeason.length}` },
        note: 'ρ = Spearman entro-stagione tra voto v2 (draft-day) e fpLeague reale dei giocatori scelti (nflverse). n=4 team/anno: segnale indicativo. adopted:false = il browser tiene i default del motore (invariato).',
    };
    await mkdir(OUT_DIR, { recursive: true });
    await writeFile(path.join(OUT_DIR, 'draft_score_v2_calib.json'), JSON.stringify(out, null, 1));
    console.log(`\n→ data/model/draft_score_v2_calib.json  meanρ=${meanRho} (${positive}/${perSeason.length} positivi) → adopted:${adopted}`);
}

await run();
