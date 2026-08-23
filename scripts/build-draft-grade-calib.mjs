/**
 * Genera data/model/draft_grade_calib.json — le soglie-lettera del Draft Grade.
 *
 * Le soglie NON sono inventate: sono i quantili empirici di tutte le pick e di
 * tutti i draft di squadra dal 2019 in poi, mappati su una curva di voti che
 * somiglia a una pagella vera (poche A, poche F, la massa in B/C). Era il pezzo
 * che mancava al vecchio Draft Score v2, che usava cut point assoluti e per
 * questo schiacciava metà lega in C.
 *
 * Lo script fa anche il BACKTEST contro i punti veri della regular season, così
 * ogni rigenerazione dice a che punto siamo: `talentRho` è la correlazione del
 * solo asse talento, `gradeRho` quella del voto finale. Se il voto finale
 * correla PEGGIO del solo talento, i pesi in draft-grade.js vanno rivisti.
 *
 * Uso:  node scripts/build-draft-grade-calib.mjs
 *       node scripts/build-draft-grade-calib.mjs 2019 2025
 *
 * Richiede rete (proiezioni Sleeper). Le risposte vengono messe in cache in
 * .cache/ così le riesecuzioni sono immediate e riproducibili.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = path.join(ROOT, '.cache', 'draft-grade-calib');

// ── shim browser: i moduli di js/data girano nel browser ──────────
const store = new Map();
globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, v),
    removeItem: (k) => store.delete(k),
};
const realFetch = globalThis.fetch;
fs.mkdirSync(CACHE, { recursive: true });
globalThis.fetch = async (url, opts) => {
    if (typeof url === 'string' && !/^https?:/.test(url)) {
        const f = path.join(ROOT, url);
        if (!fs.existsSync(f)) return { ok: false, status: 404, json: async () => null };
        return { ok: true, status: 200, json: async () => JSON.parse(fs.readFileSync(f, 'utf8')) };
    }
    const key = path.join(CACHE, Buffer.from(String(url)).toString('base64url').slice(0, 120) + '.json');
    if (fs.existsSync(key)) return { ok: true, status: 200, json: async () => JSON.parse(fs.readFileSync(key, 'utf8')) };
    const r = await realFetch(url, opts);
    if (!r.ok) return r;
    const j = await r.json();
    fs.writeFileSync(key, JSON.stringify(j));
    return { ok: true, status: 200, json: async () => j };
};

const { getSeasonProjections, matchProjection } = await import('../js/data/projections.js');
const { getHistoryIndex, blendValue } = await import('../js/data/player-history.js');
const { computeDraftGrade, TALENT_WEIGHT, EFFICIENCY_WEIGHT } = await import('../js/data/draft-grade.js');

// ── costanti di lega (duplicate qui: data.js importa Firebase) ────
const TEAM_DISPLAY = { riccardo97com: 'Oscurus', lasers: 'Lasers', FedCom: 'Sommo', 'Capi dei Pianeti': 'Capi dei Pianeti' };
const TEAM_KEYS = { 'Capi dei Pianeti': 'capi', Lasers: 'lasers', Oscurus: 'oscurus', Sommo: 'sommo' };
const POS_FALLBACK = { K: 125, DEF: 110 };
const keyOf = (raw) => TEAM_KEYS[TEAM_DISPLAY[raw] || raw] || null;

/**
 * Curva-obiettivo: che QUOTA di pick/draft deve prendere ogni lettera, dal
 * basso verso l'alto. È la forma di una pagella vera — la massa in C+/B-/B,
 * le A rare e le F rarissime — non una distribuzione uniforme. Le somme fanno 1.
 */
const PICK_BANDS = [['F', 0.02], ['D', 0.05], ['C-', 0.08], ['C', 0.12], ['C+', 0.15], ['B-', 0.15], ['B', 0.13], ['B+', 0.12], ['A-', 0.09], ['A', 0.06], ['A+', 0.03]];
// Le SQUADRE non prendono F: la fascia più bassa è D e parte dal minimo storico,
// così nessun draft cade sotto tutte le soglie. Una singola pick sprecata è una
// F sensata, un intero draft di 15 pick praticamente mai.
const TEAM_BANDS = [['D', 0.06], ['C-', 0.08], ['C', 0.11], ['C+', 0.14], ['B-', 0.16], ['B', 0.14], ['B+', 0.13], ['A-', 0.10], ['A', 0.05], ['A+', 0.03]];

const quantile = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))))];

/**
 * Da una distribuzione di punteggi alle soglie [[score, letter], …] decrescenti,
 * nel formato che si aspetta letterForScore (prima soglia superata = lettera).
 * La soglia di una lettera è il quantile pari alla quota CUMULATA di tutte le
 * lettere sotto di lei: sopra quel punteggio comincia la sua fascia.
 */
function thresholdsFrom(scores, bands) {
    const s = [...scores].sort((a, b) => a - b);
    const out = [];
    let cum = 0;
    for (const [letter, share] of bands) {
        cum += share;
        if (letter === 'F') continue; // F è il residuo: nessuna soglia, la ritorna letterForScore
        out.push([+quantile(s, cum - share).toFixed(1), letter]);
    }
    out.sort((a, b) => b[0] - a[0]);
    // quantili appiattiti (tanti punteggi uguali) possono dare soglie ripetute:
    // le rendo strettamente decrescenti, altrimenti una lettera diventa irraggiungibile
    for (let i = 1; i < out.length; i++) {
        if (out[i][0] >= out[i - 1][0]) out[i][0] = +(out[i - 1][0] - 0.1).toFixed(1);
    }
    return out;
}

function loadDraft(year) {
    const f = path.join(ROOT, 'data', 'draft', `draft_data_${year}.json`);
    if (!fs.existsSync(f)) return null;
    return JSON.parse(fs.readFileSync(f, 'utf8'));
}

/**
 * Squadre + pick valorizzate ESATTAMENTE come fa il sito.
 *
 * Deve replicare draftgrades.makeEvaluator, blend storico di K/DEF compreso:
 * calibrare le soglie su una distribuzione di punteggi diversa da quella che
 * poi viene votata a schermo significa assegnare lettere sbagliate ai bordi
 * (era il motivo per cui il draft peggiore prendeva F invece di D).
 */
async function seasonGrades(year) {
    const draft = loadDraft(year);
    if (!draft?.teams) return null;
    const proj = await getSeasonProjections(year);
    const histIndex = await getHistoryIndex(year).catch(() => null);
    const size = Object.keys(draft.teams).length || 4;
    const teams = {};
    for (const [raw, list] of Object.entries(draft.teams)) {
        const key = keyOf(raw);
        if (!key) continue;
        for (const p of list) {
            const hit = matchProjection(proj, p.name, p.position);
            const projValue = hit?.projPts ?? hit?.ptsStd ?? POS_FALLBACK[p.position] ?? 0;
            const hist = histIndex ? histIndex.forPlayer(p.name, p.position) : null;
            (teams[key] = teams[key] || []).push({
                pick: p.pick, round: Math.ceil(p.pick / size),
                player: p.name, pos: p.position, nfl: p.nfl_team,
                value: blendValue(projValue, hist, p.position).value,
                adp: hit?.adp ?? null,
            });
        }
    }
    const grades = Object.entries(teams).map(([key, list]) => ({ key, list: list.sort((a, b) => a.pick - b.pick) }));
    return grades.length === 4 ? { grades, proj } : null;
}

/** Dispersione ADP FFC precalcolata (build-adp-ffc.mjs). */
function adpDispersion(year) {
    const f = path.join(ROOT, 'data', 'nfl', `adp_ffc_${year}.json`);
    if (!fs.existsSync(f)) return null;
    const data = JSON.parse(fs.readFileSync(f, 'utf8'));
    const map = new Map(Object.entries(data.players || {}));
    return map.size ? map : null;
}

/** Punti fatti e vittorie reali in regular season, per il backtest. */
function realSeason(year) {
    const f = path.join(ROOT, 'data', 'fantasy', `fantasy_data_${year}.json`);
    if (!fs.existsSync(f)) return null;
    const data = JSON.parse(fs.readFileSync(f, 'utf8'));
    const regWeeks = String(year) === '2021' ? 16 : 15; // vedi data.js:getSeasonConfig
    const out = {};
    for (let w = 1; w <= regWeeks; w++) {
        for (const m of data.weeks?.[String(w)]?.matchups || []) {
            const a = keyOf(m.team1?.name), b = keyOf(m.team2?.name);
            if (!a || !b) continue;
            const sa = parseFloat(m.team1.score), sb = parseFloat(m.team2.score);
            if (!Number.isFinite(sa) || !Number.isFinite(sb)) continue;
            out[a] = out[a] || { pf: 0, w: 0 }; out[b] = out[b] || { pf: 0, w: 0 };
            out[a].pf += sa; out[b].pf += sb;
            if (sa >= sb) out[a].w++; else out[b].w++;
        }
    }
    return Object.keys(out).length ? out : null;
}

function spearman(a, b) {
    const rank = (x) => {
        const idx = x.map((v, i) => i).sort((i, j) => x[i] - x[j]);
        const r = new Array(x.length);
        idx.forEach((i, p) => { r[i] = p; });
        return r;
    };
    const ra = rank(a), rb = rank(b), n = a.length;
    const ma = ra.reduce((s, v) => s + v, 0) / n, mb = rb.reduce((s, v) => s + v, 0) / n;
    let num = 0, da = 0, db = 0;
    for (let i = 0; i < n; i++) { num += (ra[i] - ma) * (rb[i] - mb); da += (ra[i] - ma) ** 2; db += (rb[i] - mb) ** 2; }
    return da && db ? num / Math.sqrt(da * db) : 0;
}

// ── main ──────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const from = +(args[0] || 2019), to = +(args[1] || 2025);
const years = [];
for (let y = from; y <= to; y++) if (loadDraft(y)) years.push(String(y));

console.log(`Draft Grade — calibrazione su ${years.length} stagioni (${years[0]}-${years[years.length - 1]})`);

const pickScores = [], teamScores = [], perSeason = [];
const seasons = [];

// PRIMA passata: punteggi grezzi con le soglie di default (le lettere non contano)
for (const year of years) {
    const s = await seasonGrades(year);
    if (!s) { console.log(`  ${year}: draft incompleto, salto`); continue; }
    const dg = computeDraftGrade(s.grades, s.proj, { adpDisp: adpDispersion(year) });
    if (!dg) { console.log(`  ${year}: nessun voto`); continue; }
    seasons.push({ year, dg });
    for (const k of dg.ranking) {
        const t = dg.byKey[k];
        teamScores.push(t.score);
        for (const r of t.picks) pickScores.push(r.score);
    }
    const real = realSeason(year);
    if (real) {
        const keys = dg.ranking.filter(k => real[k]);
        if (keys.length >= 3) {
            const pf = keys.map(k => real[k].pf);
            perSeason.push({
                year: +year,
                gradeRho: +spearman(keys.map(k => dg.byKey[k].score), pf).toFixed(3),
                talentRho: +spearman(keys.map(k => dg.byKey[k].components.talent), pf).toFixed(3),
                efficiencyRho: +spearman(keys.map(k => dg.byKey[k].components.efficiency), pf).toFixed(3),
            });
        }
    }
    console.log(`  ${year}: ${dg.ranking.map(k => `${k} ${dg.byKey[k].score.toFixed(0)}`).join('  ')}`);
}

if (!pickScores.length) { console.error('Nessun dato: interrotto.'); process.exit(1); }

const pickThresholds = thresholdsFrom(pickScores, PICK_BANDS);
const teamThresholds = thresholdsFrom(teamScores, TEAM_BANDS);

const mean = (a) => a.reduce((s, v) => s + v, 0) / (a.length || 1);
const backtest = {
    perSeason,
    meanGradeRho: +mean(perSeason.map(s => s.gradeRho)).toFixed(3),
    meanTalentRho: +mean(perSeason.map(s => s.talentRho)).toFixed(3),
    meanEfficiencyRho: +mean(perSeason.map(s => s.efficiencyRho)).toFixed(3),
    positiveSeasons: `${perSeason.filter(s => s.gradeRho > 0).length}/${perSeason.length}`,
};

const out = {
    version: 'draft-grade-1',
    generatedAt: new Date().toISOString(),
    seasons: years,
    weights: { talent: TALENT_WEIGHT, efficiency: EFFICIENCY_WEIGHT },
    pickThresholds,
    teamThresholds,
    sample: { picks: pickScores.length, teams: teamScores.length },
    backtest,
    note: 'Soglie = quantili empirici dei punteggi storici mappati sulla curva di voti (PICK_BANDS/TEAM_BANDS in build-draft-grade-calib.mjs). rho = Spearman entro-stagione contro i punti fatti reali in regular season; n=4 team/anno, segnale indicativo. Se meanGradeRho scende sotto meanTalentRho, rivedere i pesi in draft-grade.js.',
};

const outFile = path.join(ROOT, 'data', 'model', 'draft_grade_calib.json');
fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, JSON.stringify(out, null, 1));

console.log(`\nSoglie pick:  ${pickThresholds.map(([s, l]) => `${l}≥${s}`).join('  ')}`);
console.log(`Soglie team:  ${teamThresholds.map(([s, l]) => `${l}≥${s}`).join('  ')}`);
console.log(`\nBacktest contro i punti veri (ρ medio entro-stagione):`);
console.log(`  voto finale  ${backtest.meanGradeRho >= 0 ? '+' : ''}${backtest.meanGradeRho}   (${backtest.positiveSeasons} stagioni positive)`);
console.log(`  solo talento ${backtest.meanTalentRho >= 0 ? '+' : ''}${backtest.meanTalentRho}`);
console.log(`  solo effic.  ${backtest.meanEfficiencyRho >= 0 ? '+' : ''}${backtest.meanEfficiencyRho}`);
console.log(`\n→ ${path.relative(ROOT, outFile)} (${pickScores.length} pick, ${teamScores.length} draft di squadra)`);
