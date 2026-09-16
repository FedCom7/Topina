/**
 * MISURA (non riscrive niente): dove cadrebbero i 28 draft storici su una
 * scala ASSOLUTA, per decidere se il voto può smettere di essere un percentile.
 *
 * La domanda a cui risponde: fissando «0 = nove titolari da waiver» e
 * «10 = i nove migliori che il board ti permetteva dai TUOI turni», i draft
 * veri si spargono abbastanza da poterci mettere sopra fasce tonde e fisse
 * (A ≥ 80, B ≥ 70…), o si ammassano tutti in due lettere come nel vecchio
 * Draft Score v2 (che con i cut point assoluti schiacciava mezza lega in C)?
 *
 * Tre numeri per squadra-stagione:
 *   ptWeek   punti a settimana della formazione titolare sopra il replacement
 *            (assoluto, ma dipende dall'inflazione delle proiezioni di quell'anno)
 *   ceiling  lo stesso, ma della MIGLIOR rosa costruibile dai suoi turni
 *   capture  ptWeek / ceiling → 0..1, la quota di raggiungibile catturata.
 *            Normalizza da sé la posizione al draft: chi sceglie per primo ha
 *            un tetto più alto, non un voto più alto.
 *
 * Il tetto si calcola con avidità + ricerca locale sulle alternative davvero
 * disponibili a ogni turno (disponibile = scelto da qualcuno DOPO quel turno,
 * o non scelto affatto). È un limite superiore ottimista — assume che il board
 * non reagisca alle tue scelte diverse — e quindi `capture` è semmai
 * sottostimato, mai gonfiato.
 *
 * Uso:  node scripts/analyze-absolute-scale.mjs [dal] [al]
 * Rete: come il calibratore, usa .cache/draft-grade-calib (stesse risposte).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = path.join(ROOT, '.cache', 'draft-grade-calib');

// ── shim browser (identico al calibratore) ────────────────────────
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
const { computeDraftGrade } = await import('../js/data/draft-grade.js');
const { replacementLevels, pickStarters } = await import('../js/data/team-eval.js');

const TEAM_DISPLAY = { riccardo97com: 'Oscurus', lasers: 'Lasers', FedCom: 'Sommo', 'Capi dei Pianeti': 'Capi dei Pianeti' };
const TEAM_KEYS = { 'Capi dei Pianeti': 'capi', Lasers: 'lasers', Oscurus: 'oscurus', Sommo: 'sommo' };
const POS_FALLBACK = { K: 125, DEF: 110 };
const WEEKS = 17;
const keyOf = (raw) => TEAM_KEYS[TEAM_DISPLAY[raw] || raw] || null;

const loadDraft = (year) => {
    const f = path.join(ROOT, 'data', 'draft', `draft_data_${year}.json`);
    return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null;
};

/** Squadre + pick valorizzate come il sito (stesso codice del calibratore). */
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

const adpDispersion = (year) => {
    const f = path.join(ROOT, 'data', 'nfl', `adp_ffc_${year}.json`);
    if (!fs.existsSync(f)) return null;
    const map = new Map(Object.entries(JSON.parse(fs.readFileSync(f, 'utf8')).players || {}));
    return map.size ? map : null;
};

function realSeason(year) {
    const f = path.join(ROOT, 'data', 'fantasy', `fantasy_data_${year}.json`);
    if (!fs.existsSync(f)) return null;
    const data = JSON.parse(fs.readFileSync(f, 'utf8'));
    const regWeeks = String(year) === '2021' ? 16 : 15;
    const out = {};
    for (let w = 1; w <= regWeeks; w++) {
        for (const m of data.weeks?.[String(w)]?.matchups || []) {
            const a = keyOf(m.team1?.name), b = keyOf(m.team2?.name);
            if (!a || !b) continue;
            const sa = parseFloat(m.team1.score), sb = parseFloat(m.team2.score);
            if (!Number.isFinite(sa) || !Number.isFinite(sb)) continue;
            out[a] = out[a] || { pf: 0 }; out[b] = out[b] || { pf: 0 };
            out[a].pf += sa; out[b].pf += sb;
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

const pearson = (a, b) => {
    const n = a.length, ma = a.reduce((s, v) => s + v, 0) / n, mb = b.reduce((s, v) => s + v, 0) / n;
    let num = 0, da = 0, db = 0;
    for (let i = 0; i < n; i++) { num += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2; }
    return da && db ? num / Math.sqrt(da * db) : 0;
};

/** VOR della formazione titolare di una rosa. */
const lineupVOR = (list, repl) => pickStarters(list, 'value').starters
    .reduce((s, p) => s + Math.max(0, (p.value || 0) - (repl[p.pos] || 0)), 0);

/**
 * Il TETTO: la miglior formazione titolare costruibile dai turni di QUESTA
 * squadra, con il board vero.
 *
 * Un giocatore è prendibile a un tuo turno se nel draft vero è stato scelto a
 * quel turno o dopo. Quindi ogni giocatore è prendibile in un PREFISSO dei tuoi
 * turni (i primi k), e un insieme di giocatori è realizzabile se e solo se,
 * ordinando i prefissi in modo crescente, l'i-esimo è lungo almeno i — la
 * condizione di Hall, che qui è esatta perché i prefissi sono annidati.
 *
 * La prima stesura assegnava un giocatore per turno in avanti e i turni saltati
 * disallineavano gli indici: usciva un tetto SOTTO la rosa vera (capture 121%,
 * che è impossibile). Ora si sceglie l'INSIEME, con la condizione di Hall a fare
 * da vincolo, e la ricerca locale parte anche dalla rosa vera — così il tetto
 * non può che essere ≥ quello che la squadra ha davvero fatto.
 */
function ceilingVOR(mySlots, allPicks, repl) {
    const slots = [...mySlots].sort((a, b) => a - b);
    const prefixLen = (pl) => slots.filter(p => p <= pl.pick).length;
    const feasible = (set) => set.map(prefixLen).sort((a, b) => a - b).every((l, i) => l >= i + 1);

    const improve = (start) => {
        let set = [...start];
        let best = lineupVOR(set, repl);
        // aggiunte: il giocatore che alza di più la formazione, finché alza
        for (let n = set.length; n < slots.length; n++) {
            let cand = null, candVal = best;
            for (const x of allPicks) {
                if (set.includes(x)) continue;
                const next = [...set, x];
                if (!feasible(next)) continue;
                const v = lineupVOR(next, repl);
                if (v > candVal + 1e-9) { candVal = v; cand = x; }
            }
            if (!cand) break;
            set.push(cand); best = candVal;
        }
        // scambi: uno dentro, uno fuori, finché si guadagna
        for (let guard = 0; guard < 12; guard++) {
            let moved = false;
            for (let i = 0; i < set.length; i++) {
                const rest = set.filter((_, j) => j !== i);
                for (const x of allPicks) {
                    if (set.includes(x)) continue;
                    const next = [...rest, x];
                    if (!feasible(next)) continue;
                    const v = lineupVOR(next, repl);
                    if (v > best + 1e-9) { best = v; set = next; moved = true; break; }
                }
                if (moved) break;
            }
            if (!moved) break;
        }
        return { vor: best, roster: set };
    };

    // da zero e dalla rosa vera: si tiene il migliore dei due
    const da0 = improve([]);
    const daVera = improve(allPicks.filter(p => slots.includes(p.pick)));
    return da0.vor >= daVera.vor ? da0 : daVera;
}

// ── main ──────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const from = +(args[0] || 2019), to = +(args[1] || 2025);
const years = [];
for (let y = from; y <= to; y++) if (loadDraft(y)) years.push(String(y));

console.log(`Scala assoluta — misura su ${years.length} stagioni (${years[0]}-${years[years.length - 1]})\n`);

const rows = [];
const perSeason = [];
for (const year of years) {
    const s = await seasonGrades(year);
    if (!s) { console.log(`  ${year}: draft incompleto, salto`); continue; }
    const dg = computeDraftGrade(s.grades, s.proj, { adpDisp: adpDispersion(year) });
    if (!dg) continue;

    const allPicks = s.grades.flatMap(g => g.list).filter(p => p.value != null);
    const repl = replacementLevels(allPicks, 'value');
    const real = realSeason(year);

    for (const g of s.grades) {
        const t = dg.byKey[g.key];
        const mine = g.list.filter(p => p.value != null);
        const actual = lineupVOR(mine, repl);
        const { vor: ceil } = ceilingVOR(mine.map(p => p.pick), allPicks, repl);
        rows.push({
            year: +year, key: g.key,
            firstPick: Math.min(...mine.map(p => p.pick)),
            actual, ceil, capture: ceil > 0 ? actual / ceil : 0,
            ptWeek: actual / WEEKS, ceilWeek: ceil / WEEKS,
            score: t.score, talent: t.components.talent, efficiency: t.components.efficiency,
            letter: t.letter, grade: t.grade,
            pf: real?.[g.key]?.pf ?? null,
        });
    }

    const yr = rows.filter(r => r.year === +year && r.pf != null);
    if (yr.length >= 3) {
        perSeason.push({
            year: +year,
            captureRho: +spearman(yr.map(r => r.capture), yr.map(r => r.pf)).toFixed(3),
            ptWeekRho: +spearman(yr.map(r => r.ptWeek), yr.map(r => r.pf)).toFixed(3),
            scoreRho: +spearman(yr.map(r => r.score), yr.map(r => r.pf)).toFixed(3),
        });
    }
    const line = rows.filter(r => r.year === +year)
        .sort((a, b) => b.capture - a.capture)
        .map(r => `${r.key} ${(r.capture * 100).toFixed(0)}%`).join('  ');
    console.log(`  ${year}: ${line}`);
}

const cap = rows.map(r => r.capture * 100).sort((a, b) => a - b);
const q = (p) => cap[Math.min(cap.length - 1, Math.round(p * (cap.length - 1)))];
const mean = (a) => a.reduce((s, v) => s + v, 0) / (a.length || 1);

console.log(`\n── Distribuzione di CAPTURE (${rows.length} squadre-stagione) ──`);
console.log(`  min ${q(0).toFixed(1)}%  q1 ${q(0.25).toFixed(1)}%  mediana ${q(0.5).toFixed(1)}%  q3 ${q(0.75).toFixed(1)}%  max ${q(1).toFixed(1)}%`);
console.log(`  media ${mean(cap).toFixed(1)}%  ampiezza ${(q(1) - q(0)).toFixed(1)} punti`);

console.log('\n  istogramma per decile:');
for (let d = 0; d < 10; d++) {
    const lo = d * 10, hi = lo + 10;
    const n = cap.filter(v => v >= lo && (d === 9 ? v <= 100 : v < hi)).length;
    if (n || (lo >= 30 && lo <= 90)) console.log(`   ${String(lo).padStart(3)}-${hi}%  ${'█'.repeat(n)}${n ? ' ' : ''}${n || ''}`);
}

console.log('\n── Se usassimo fasce TONDE e fisse su capture ──');
const FIXED = [['A+', 90], ['A', 85], ['A-', 80], ['B+', 75], ['B', 70], ['B-', 65], ['C+', 60], ['C', 55], ['C-', 50], ['D', 0]];
for (const [letter, lo] of FIXED) {
    const hi = FIXED[FIXED.findIndex(f => f[0] === letter) - 1]?.[1] ?? 101;
    const n = cap.filter(v => v >= lo && v < hi).length;
    console.log(`  ${letter.padEnd(2)} ≥ ${String(lo).padStart(2)}  ${'█'.repeat(n)} ${n} (${(n / cap.length * 100).toFixed(0)}%)`);
}

console.log('\n── Le due assi assolute si sovrappongono? ──');
console.log(`  capture ↔ ptWeek        r ${pearson(rows.map(r => r.capture), rows.map(r => r.ptWeek)).toFixed(3)}`);
console.log(`  capture ↔ efficiency    r ${pearson(rows.map(r => r.capture), rows.map(r => r.efficiency)).toFixed(3)}`);
console.log(`  capture ↔ talent        r ${pearson(rows.map(r => r.capture), rows.map(r => r.talent)).toFixed(3)}`);
console.log(`  capture ↔ score (oggi)  r ${pearson(rows.map(r => r.capture), rows.map(r => r.score)).toFixed(3)}`);
console.log(`  ptWeek  ↔ talent        r ${pearson(rows.map(r => r.ptWeek), rows.map(r => r.talent)).toFixed(3)}`);

console.log('\n── Il tetto dipende da dove peschi? (se sì, capture normalizza bene) ──');
console.log(`  ceiling ↔ prima pick    r ${pearson(rows.map(r => r.ceilWeek), rows.map(r => r.firstPick)).toFixed(3)}`);
console.log(`  capture ↔ prima pick    r ${pearson(rows.map(r => r.capture), rows.map(r => r.firstPick)).toFixed(3)}`);
console.log(`  talent  ↔ prima pick    r ${pearson(rows.map(r => r.talent), rows.map(r => r.firstPick)).toFixed(3)}`);

console.log('\n── Backtest contro i punti VERI della regular season (Spearman, n=4/anno) ──');
for (const s of perSeason) console.log(`  ${s.year}  capture ${String(s.captureRho).padStart(6)}   ptWeek ${String(s.ptWeekRho).padStart(6)}   score attuale ${String(s.scoreRho).padStart(6)}`);
console.log(`  media capture ${mean(perSeason.map(s => s.captureRho)).toFixed(3)} · ptWeek ${mean(perSeason.map(s => s.ptWeekRho)).toFixed(3)} · score attuale ${mean(perSeason.map(s => s.scoreRho)).toFixed(3)}`);

console.log('\n── Tabella completa ──');
console.log('  anno  squadra   1ª pick   pt/sett   tetto   capture   oggi');
for (const r of [...rows].sort((a, b) => a.year - b.year || b.capture - a.capture)) {
    console.log(`  ${r.year}  ${r.key.padEnd(9)} ${String(r.firstPick).padStart(4)}   ${r.ptWeek.toFixed(1).padStart(6)}  ${r.ceilWeek.toFixed(1).padStart(6)}   ${(r.capture * 100).toFixed(1).padStart(5)}%   ${r.letter.padEnd(2)} ${String(r.grade).padStart(3)}`);
}

fs.writeFileSync(path.join(CACHE, 'absolute-scale.json'), JSON.stringify({ rows, perSeason }, null, 1));
console.log(`\nDati grezzi in ${path.relative(ROOT, path.join(CACHE, 'absolute-scale.json'))}`);
