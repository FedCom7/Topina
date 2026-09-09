/**
 * Genera data/model/manager_dna.json — la carta d'identità di ogni allenatore,
 * al draft e sul mercato, con i due cancelli statistici che decidono cosa la
 * pagina ha il diritto di chiamare "abitudine".
 *
 * Uso:  node scripts/build-manager-dna.mjs
 *       node scripts/build-manager-dna.mjs 2019 2025
 *
 * NON SERVE LA RETE. Legge solo `data/**`, e due esecuzioni di fila devono
 * produrre un file identico (il seed è fisso, sotto). Se serve la rete o se il
 * file cambia fra due giri, qualcosa si è rotto.
 *
 * Non tocca in alcun modo il motore del voto: Manager DNA misura COMPORTAMENTI,
 * le Pagelle giudicano le SCELTE. Nessun import da draftgrades.js,
 * draft-grade.js o data.js — vedi l'intestazione di js/data/manager-dna.js.
 *
 * I DUE CANCELLI
 *
 *   1. differenza — gli allenatori differiscono più di quanto farebbe il caso?
 *      Permutazione delle etichette + Benjamini-Hochberg su tutta la famiglia.
 *      Due nulli diversi: i tratti di draft si permutano DENTRO IL GIRO (in uno
 *      snake a 4 ogni allenatore ha esattamente una pick per giro, e rimescolare
 *      liberamente gonfierebbe ogni tratto legato al timing), quelli di mercato
 *      DENTRO LA STAGIONE (lì di snake non ce n'è).
 *
 *   2. persistenza — quel valore si ripete di anno in anno? Autocorrelazione
 *      lag-1 dentro allenatore. È il cancello che distingue un'identità dalla
 *      fortuna: i colpi tardivi e gli infortuni passano il primo e falliscono
 *      il secondo, e infatti sono fortuna.
 *
 * Solo chi passa ENTRAMBI può diventare un'etichetta di archetipo.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    TRAITS, TRAIT_GROUPS, archetypeFor, classifyMoves, normName, roundOf, mean, median,
    CONFIDENCE_LABEL,
} from '../js/data/manager-dna.js';
import { SEASONS, TEAM_KEY_LIST, NUM_TEAMS, keyOf } from './lib/league.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'data', 'model', 'manager_dna.json');

/** Seed fisso: senza, ogni giro dell'Action committerebbe rumore. */
const SEED = 20260901;
const B_DIFF = 4000;    // permutazioni per il cancello 1
const B_PERSIST = 1000; // permutazioni per il cancello 2 (r è più stabile)
const FDR_Q = 0.10;

function mulberry32(a) {
    return function () {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
function shuffleInPlace(arr, rnd) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(rnd() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
}

const readJSON = (rel) => {
    const f = path.join(ROOT, rel);
    return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null;
};

// ─── caricamento ─────────────────────────────────────────────────────────────

const argYears = process.argv.slice(2).filter((a) => /^\d{4}$/.test(a));
const years = (argYears.length === 2
    ? SEASONS.filter((y) => +y >= +argYears[0] && +y <= +argYears[1])
    : SEASONS
).map(Number).filter((y) => fs.existsSync(path.join(ROOT, `data/draft/draft_data_${y}.json`)));

if (!years.length) {
    console.error('Nessun draft trovato in data/draft/. Niente da fare.');
    process.exit(1);
}

/** roster NFL dell'anno: nome normalizzato → anagrafica */
function loadRoster(y) {
    const d = readJSON(`data/nfl/roster_${y}.json`);
    const m = new Map();
    if (!d?.teams) return m;
    for (const list of Object.values(d.teams)) {
        for (const p of list) {
            const nm = normName(p.name);
            if (!m.has(nm)) m.set(nm, p);
        }
    }
    return m;
}

/** settimane con status Out / Injured Reserve, per giocatore */
function loadInjuries(y) {
    const d = readJSON(`data/nfl/injuries_${y}.json`);
    const m = new Map();
    if (!d?.teams) return m;
    for (const list of Object.values(d.teams)) {
        for (const p of list) {
            const nm = normName(p.name);
            let n = 0;
            for (const w of p.weeks || []) {
                if (w.status === 'Out' || w.status === 'Injured Reserve') n++;
            }
            m.set(nm, (m.get(nm) || 0) + n);
        }
    }
    return m;
}

/** rango del giocatore nella lista ADP FFC (1 = il primo del listone) */
function loadAdpRanks(y) {
    const d = readJSON(`data/nfl/adp_ffc_${y}.json`);
    const m = new Map();
    if (!d?.players) return m;
    const rows = Object.entries(d.players).sort((a, b) => a[1].adp - b[1].adp);
    rows.forEach(([key, v], i) => {
        // la chiave del file è già "nome normalizzato|POS"
        m.set(key, { rank: i + 1, adp: v.adp, stdev: v.stdev });
    });
    return m;
}

/**
 * Roster settimanali di lega + punti per giocatore-settimana + totali stagionali.
 * `starters` e `bench` portano entrambi `fantasy_points`, quindi il totale
 * stagionale è completo; `unrostered_scores` copre le settimane da svincolato.
 */
function loadSeason(y) {
    const d = readJSON(`data/fantasy/fantasy_data_${y}.json`);
    const rosters = {};   // key -> { week: Set(nm) }
    const meta = {};      // key -> { week: Map(nm -> {name,pos,pts,started}) }
    const totals = new Map();
    if (!d?.weeks) return { rosters, meta, totals, weeks: [] };

    const weeks = Object.keys(d.weeks).map(Number).sort((a, b) => a - b);
    for (const k of TEAM_KEY_LIST) { rosters[k] = {}; meta[k] = {}; }

    for (const w of weeks) {
        for (const mu of d.weeks[String(w)].matchups || []) {
            for (const side of ['team1', 'team2']) {
                const t = mu[side];
                if (!t?.name) continue;
                const k = keyOf(t.name);
                if (!k) continue;
                const set = new Set();
                const mm = new Map();
                for (const [grp, started] of [['starters', true], ['bench', false]]) {
                    for (const p of t[grp] || []) {
                        const nm = normName(p.name);
                        const pts = Number(p.fantasy_points);
                        set.add(nm);
                        mm.set(nm, {
                            name: p.name,
                            pos: p.position_in_team || p.position,
                            pts: Number.isFinite(pts) ? pts : 0,
                            started,
                        });
                        if (Number.isFinite(pts)) totals.set(nm, (totals.get(nm) || 0) + pts);
                    }
                }
                rosters[k][w] = set;
                meta[k][w] = mm;
            }
        }
    }

    const un = readJSON(`data/nfl/unrostered_scores_${y}.json`);
    if (un?.players) {
        for (const [rawKey, list] of Object.entries(un.players)) {
            // le chiavi qui sono senza spazi: si aggancia solo il già noto
            const nm = normName(rawKey);
            if (!totals.has(nm)) continue;
            for (const w of list) totals.set(nm, totals.get(nm) + (w.pts || 0));
        }
    }
    return { rosters, meta, totals, weeks };
}

// ─── costruzione delle righe ─────────────────────────────────────────────────

const pickRows = [];
const moveRows = [];
const bars = {};           // anno → soglia "ha reso come una pick dei primi 4 giri"
const cov = { picks: 0, adp: 0, roster: 0, pts: 0, moves: 0, clean: 0, boomerang: 0, trade: 0 };

for (const y of years) {
    const draft = readJSON(`data/draft/draft_data_${y}.json`);
    const roster = loadRoster(y);
    const inj = loadInjuries(y);
    const injPrev = loadInjuries(y - 1);
    const adp = loadAdpRanks(y);
    const season = loadSeason(y);
    const lastWeek = season.weeks.length ? season.weeks[season.weeks.length - 1] : null;

    for (const [raw, picks] of Object.entries(draft.teams || {})) {
        const k = keyOf(raw);
        if (!k) continue;
        for (const p of picks) {
            const nm = normName(p.name);
            const r = roster.get(nm) || null;
            const a = adp.get(`${nm}|${p.position}`) || null;
            const pts = season.totals.has(nm) ? season.totals.get(nm) : null;
            cov.picks++;
            if (a) cov.adp++;
            if (r) cov.roster++;
            if (pts !== null) cov.pts++;
            pickRows.push({
                y, k,
                pick: p.pick,
                round: roundOf(p.pick, NUM_TEAMS),
                name: p.name,
                nm,
                pos: p.position,
                nfl: p.nfl_team || null,
                adpRank: a ? a.rank : null,
                adp: a ? a.adp : null,
                adpStdev: a ? a.stdev : null,
                exp: r && Number.isFinite(r.yearsExp) ? r.yearsExp : null,
                rookie: r?.rookieYear ? r.rookieYear === y : null,
                nflDraftNo: r?.draftNumber || null,
                college: r?.college || null,
                snapPrior: Number.isFinite(r?.snapPct) ? r.snapPct : null,
                changedTeam: r?.draftClub && p.nfl_team ? r.draftClub !== p.nfl_team : null,
                injWeeks: inj.get(nm) || 0,
                injPrev: y > years[0] ? (injPrev.get(nm) || 0) : null,
                pts: pts === null ? null : Math.round(pts * 100) / 100,
                heldW8: season.rosters[k]?.[8] ? season.rosters[k][8].has(nm) : null,
                heldEnd: lastWeek && season.rosters[k]?.[lastWeek]
                    ? season.rosters[k][lastWeek].has(nm) : null,
            });
        }
    }

    // soglia annuale interna: la mediana dei punti delle pick dei primi 4 giri
    bars[y] = median(pickRows.filter((r) => r.y === y && r.round <= 4 && r.pts !== null).map((r) => r.pts));

    const moves = classifyMoves(season.rosters, season.meta, y);
    for (const m of moves) {
        cov.moves++;
        cov[m.kind]++;
        moveRows.push(m);
    }
}

// ─── calcolo dei tratti ──────────────────────────────────────────────────────

const CTX = { seasons: years, bars };
const ctxFor = (year) => ({ ...CTX, year });

const byScope = { draft: pickRows, market: moveRows };

/** valore di un tratto per un allenatore, dato un assegnamento di etichette */
function valueOf(t, rowsByKey, year) {
    const rows = rowsByKey[t.scope];
    try {
        const v = t.fn(rows, ctxFor(year));
        return Number.isFinite(v) ? v : null;
    } catch {
        return null;
    }
}

/** { key: { draft:[], market:[] } } dall'assegnamento corrente */
function groupRows(pickLabels, moveLabels) {
    const out = {};
    for (const k of TEAM_KEY_LIST) out[k] = { draft: [], market: [] };
    pickRows.forEach((r, i) => out[pickLabels[i]].draft.push(r));
    moveRows.forEach((m, i) => out[moveLabels[i]].market.push(m));
    return out;
}

const realPickLabels = pickRows.map((r) => r.k);
const realMoveLabels = moveRows.map((m) => m.k);
const realGroups = groupRows(realPickLabels, realMoveLabels);

/** valori osservati: pooled e per stagione */
const observed = {};
for (const t of TRAITS) {
    const pooled = {};
    const perYear = {};
    for (const k of TEAM_KEY_LIST) {
        pooled[k] = valueOf(t, realGroups[k], null);
        perYear[k] = {};
        for (const y of years) perYear[k][y] = valueOf(t, realGroups[k], y);
    }
    observed[t.id] = { pooled, perYear };
}

const spreadOf = (vals) => {
    const v = Object.values(vals).filter((x) => x !== null);
    return v.length > 1 ? Math.max(...v) - Math.min(...v) : null;
};

// ─── cancello 1: differenza ──────────────────────────────────────────────────

// gli indici dei gruppi da permutare, precalcolati una volta
const roundGroups = new Map();   // "anno|giro" → indici in pickRows
pickRows.forEach((r, i) => {
    const key = `${r.y}|${r.round}`;
    if (!roundGroups.has(key)) roundGroups.set(key, []);
    roundGroups.get(key).push(i);
});
const seasonMoveIdx = new Map();  // anno → { key → indici in moveRows }
for (const y of years) seasonMoveIdx.set(y, {});
moveRows.forEach((m, i) => {
    const bucket = seasonMoveIdx.get(m.y);
    (bucket[m.k] ||= []).push(i);
});

function permutedLabels(rnd) {
    const pickLabels = new Array(pickRows.length);
    for (const idx of roundGroups.values()) {
        // ogni giro ha esattamente una pick per allenatore: si riassegnano le
        // quattro etichette di QUEL giro, e lo snake resta intatto
        const labs = idx.map((i) => pickRows[i].k);
        shuffleInPlace(labs, rnd);
        idx.forEach((i, j) => { pickLabels[i] = labs[j]; });
    }
    const moveLabels = new Array(moveRows.length);
    for (const y of years) {
        const bucket = seasonMoveIdx.get(y);
        const from = TEAM_KEY_LIST.filter((k) => bucket[k]);
        const to = [...from];
        shuffleInPlace(to, rnd);
        from.forEach((k, j) => { for (const i of bucket[k]) moveLabels[i] = to[j]; });
    }
    return { pickLabels, moveLabels };
}

const rnd1 = mulberry32(SEED);
const diffHits = Object.fromEntries(TRAITS.map((t) => [t.id, 0]));
const obsSpread = Object.fromEntries(TRAITS.map((t) => [t.id, spreadOf(observed[t.id].pooled)]));
const maxAbsZNull = [];

process.stderr.write(`Cancello 1 — ${B_DIFF} permutazioni su ${TRAITS.length} tratti…\n`);
for (let b = 0; b < B_DIFF; b++) {
    const { pickLabels, moveLabels } = permutedLabels(rnd1);
    const g = groupRows(pickLabels, moveLabels);
    let maxZ = 0;
    for (const t of TRAITS) {
        const vals = {};
        for (const k of TEAM_KEY_LIST) vals[k] = valueOf(t, g[k], null);
        const s = spreadOf(vals);
        if (s !== null && obsSpread[t.id] !== null && s >= obsSpread[t.id]) diffHits[t.id]++;
        // per la banda maxT serve lo z, non lo spread
        const v = Object.values(vals).filter((x) => x !== null);
        if (v.length > 1) {
            const mu = mean(v);
            const sd = Math.sqrt(mean(v.map((x) => (x - mu) ** 2))) || 1;
            maxZ = Math.max(maxZ, ...v.map((x) => Math.abs((x - mu) / sd)));
        }
    }
    maxAbsZNull.push(maxZ);
    if ((b + 1) % 500 === 0) process.stderr.write(`  ${b + 1}/${B_DIFF}\n`);
}
maxAbsZNull.sort((a, b) => a - b);
const zCritFWER = maxAbsZNull[Math.floor(0.95 * (maxAbsZNull.length - 1))];

// ─── cancello 2: persistenza ─────────────────────────────────────────────────

/** r di Pearson sulle coppie (stagione s, stagione s+1) di tutti gli allenatori */
function lag1(t, groups) {
    const xs = [];
    const ys = [];
    for (const k of TEAM_KEY_LIST) {
        const per = {};
        for (const y of years) per[y] = valueOf(t, groups[k], y);
        for (let i = 0; i < years.length - 1; i++) {
            const a = per[years[i]];
            const b = per[years[i + 1]];
            if (a !== null && b !== null) { xs.push(a); ys.push(b); }
        }
    }
    if (xs.length < 8) return null;
    const mx = mean(xs);
    const my = mean(ys);
    let num = 0;
    let dx = 0;
    let dy = 0;
    for (let i = 0; i < xs.length; i++) {
        num += (xs[i] - mx) * (ys[i] - my);
        dx += (xs[i] - mx) ** 2;
        dy += (ys[i] - my) ** 2;
    }
    const den = Math.sqrt(dx * dy);
    return { r: den ? num / den : 0, n: xs.length };
}

const testable = TRAITS.filter((t) => t.testable !== false);
const obsPersist = {};
for (const t of testable) obsPersist[t.id] = lag1(t, realGroups);

const rnd2 = mulberry32(SEED + 1);
const persistHits = Object.fromEntries(testable.map((t) => [t.id, 0]));
process.stderr.write(`Cancello 2 — ${B_PERSIST} permutazioni…\n`);
for (let b = 0; b < B_PERSIST; b++) {
    const { pickLabels, moveLabels } = permutedLabels(rnd2);
    const g = groupRows(pickLabels, moveLabels);
    for (const t of testable) {
        const o = obsPersist[t.id];
        if (!o) continue;
        const r0 = lag1(t, g);
        if (r0 && Math.abs(r0.r) >= Math.abs(o.r)) persistHits[t.id]++;
    }
    if ((b + 1) % 250 === 0) process.stderr.write(`  ${b + 1}/${B_PERSIST}\n`);
}

// ─── p, q, tier ──────────────────────────────────────────────────────────────

const stats = {};
for (const t of TRAITS) {
    const p = obsSpread[t.id] === null ? 1 : (1 + diffHits[t.id]) / (B_DIFF + 1);
    const o = obsPersist[t.id] || null;
    const pp = o ? (1 + persistHits[t.id]) / (B_PERSIST + 1) : null;
    stats[t.id] = {
        spread: obsSpread[t.id],
        p,
        persistR: o ? o.r : null,
        persistP: pp,
        persistN: o ? o.n : null,
    };
}

// Benjamini-Hochberg su TUTTA la famiglia insieme. Non a lotti: le q calcolate
// su un sottoinsieme sono ottimistiche, e aggiungere un tratto PEGGIORA le q di
// quelli già dentro. Chi allarga il catalogo deve rileggere questo report.
{
    const ord = [...TRAITS].sort((a, b) => stats[a.id].p - stats[b.id].p);
    const m = ord.length;
    let running = 1;
    for (let i = m - 1; i >= 0; i--) {
        running = Math.min(running, (stats[ord[i].id].p * m) / (i + 1));
        stats[ord[i].id].q = running;
    }
}

for (const t of TRAITS) {
    const s = stats[t.id];
    const differs = s.q <= FDR_Q;
    const persists = s.persistR !== null && s.persistR > 0 && s.persistP < 0.05;
    s.tier = differs && persists ? 'signature'
        : differs ? 'differs'
            : t.group === 'luck' ? 'luck' : 'noise';
}

// ─── z per allenatore (centrati per stagione) ────────────────────────────────

function zFor(traitId) {
    const t = TRAITS.find((x) => x.id === traitId);
    const obs = observed[traitId];
    const out = {};
    if (t.testable === false) {
        // niente valori annuali: si standardizza sui quattro valori pooled
        const v = TEAM_KEY_LIST.map((k) => obs.pooled[k]).filter((x) => x !== null);
        const mu = mean(v);
        const sd = Math.sqrt(mean(v.map((x) => (x - mu) ** 2))) || 1;
        for (const k of TEAM_KEY_LIST) {
            out[k] = obs.pooled[k] === null ? null : (obs.pooled[k] - mu) / sd;
        }
        return out;
    }
    const acc = Object.fromEntries(TEAM_KEY_LIST.map((k) => [k, []]));
    for (const y of years) {
        const v = TEAM_KEY_LIST.map((k) => obs.perYear[k][y]).filter((x) => x !== null);
        if (v.length < 2) continue;
        const mu = mean(v);
        const sd = Math.sqrt(mean(v.map((x) => (x - mu) ** 2)));
        if (!sd) continue;
        for (const k of TEAM_KEY_LIST) {
            const x = obs.perYear[k][y];
            if (x !== null) acc[k].push((x - mu) / sd);
        }
    }
    for (const k of TEAM_KEY_LIST) out[k] = acc[k].length ? mean(acc[k]) : null;
    return out;
}

const zByTrait = Object.fromEntries(TRAITS.map((t) => [t.id, zFor(t.id)]));

// ─── report a schermo ────────────────────────────────────────────────────────

const fmt = (v, d = 2) => (v === null || v === undefined ? '—' : (+v).toFixed(d));
console.log(`\nManager DNA — ${years.length} stagioni (${years[0]}–${years[years.length - 1]})`);
console.log(`copertura: ${cov.picks} pick · ADP ${cov.adp} · roster ${cov.roster} · punti ${cov.pts}`);
console.log(`movimenti: ${cov.moves} — clean ${cov.clean} (${Math.round(100 * cov.clean / cov.moves)}%) · `
    + `boomerang ${cov.boomerang} (${Math.round(100 * cov.boomerang / cov.moves)}%) · `
    + `trade ${cov.trade} (${Math.round(100 * cov.trade / cov.moves)}%)`);
console.log(`soglie annuali "reso come un primo giro": `
    + years.map((y) => `${y}:${Math.round(bars[y])}`).join(' '));
console.log(`banda del caso (maxT 95°): ±${fmt(zCritFWER)} σ\n`);

const order = [...TRAITS].sort((a, b) => stats[a.id].p - stats[b.id].p);
const pad = (s, n) => String(s).padEnd(n).slice(0, n);
console.log(`${pad('tratto', 34)} ${pad('grp', 9)} ${'p'.padStart(7)} ${'q'.padStart(6)} `
    + `${'r'.padStart(6)} ${'pr'.padStart(6)}  ${pad('tier', 9)} capi/lasers/oscurus/sommo`);
for (const t of order) {
    const s = stats[t.id];
    const vals = TEAM_KEY_LIST.map((k) => fmt(observed[t.id].pooled[k], 1)).join('/');
    console.log(`${pad(t.label, 34)} ${pad(t.group, 9)} ${fmt(s.p, 4).padStart(7)} `
        + `${fmt(s.q, 3).padStart(6)} ${fmt(s.persistR, 2).padStart(6)} `
        + `${fmt(s.persistP, 3).padStart(6)}  ${pad(s.tier, 9)} ${vals}`);
}

// ─── archetipi ───────────────────────────────────────────────────────────────

const managers = {};
for (const k of TEAM_KEY_LIST) {
    const traits = {};
    for (const t of TRAITS) {
        traits[t.id] = {
            raw: observed[t.id].pooled[k],
            z: zByTrait[t.id][k],
            tier: stats[t.id].tier,
            byYear: years.map((y) => ({ year: y, raw: observed[t.id].perYear[k][y] })),
        };
    }
    const arch = archetypeFor(traits);
    managers[k] = {
        key: k,
        nPicks: realGroups[k].draft.length,
        nMoves: realGroups[k].market.filter((m) => m.kind === 'clean').length,
        nSeasons: years.length,
        traits,
        archetype: arch,
    };
}

console.log('\narchetipi:');
for (const k of TEAM_KEY_LIST) {
    const a = managers[k].archetype;
    console.log(`  ${pad(k, 9)} ${a ? `${pad(a.label, 20)} [${CONFIDENCE_LABEL[a.confidence]}]  `
        + `${a.evidence.map((e) => `${e.trait} ${e.z > 0 ? '+' : ''}${fmt(e.z, 1)}σ`).join(', ')}`
        : 'nessuna corrispondenza'}`);
}

// ─── scrittura ───────────────────────────────────────────────────────────────

const out = {
    version: 'manager-dna-1',
    generatedAt: new Date().toISOString(),
    seasons: years.map(String),
    coverage: {
        picks: cov.picks, adpMatched: cov.adp, rosterMatched: cov.roster, ptsMatched: cov.pts,
        moves: cov.moves,
        movesByKind: { clean: cov.clean, boomerang: cov.boomerang, trade: cov.trade },
    },
    test: {
        B: B_DIFF, bPersist: B_PERSIST, seed: SEED, fdrQ: FDR_Q,
        nTests: TRAITS.length,
        nullDraft: 'within-round manager-label permutation',
        nullMarket: 'within-season manager-label permutation',
        zCritFWER,
        note: 'La permutazione dentro il giro non conserva l\'ordine DENTRO il giro '
            + '(pick 5 contro pick 8 nel secondo giro). È una perdita minore e riguarda '
            + 'solo tratti guidati dalla sola posizione intra-giro, di cui il catalogo non ha esempi.',
    },
    groups: TRAIT_GROUPS,
    bars,
    traits: TRAITS.map((t) => ({
        id: t.id, label: t.label, group: t.group, unit: t.unit || null,
        higherIs: t.higherIs || null, scope: t.scope, testable: t.testable !== false,
        archetype: !!t.archetype,
        ...stats[t.id],
        z: zByTrait[t.id],
    })),
    managers,
    picks: pickRows.map((r) => ({
        y: r.y, k: r.k, pick: r.pick, round: r.round, player: r.name, pos: r.pos, nfl: r.nfl,
        adp: r.adp, adpRank: r.adpRank, exp: r.exp, rookie: r.rookie, nflDraftNo: r.nflDraftNo,
        college: r.college, injWeeks: r.injWeeks, pts: r.pts, heldW8: r.heldW8, heldEnd: r.heldEnd,
    })),
    moves: moveRows.map((m) => ({
        y: m.y, k: m.k, week: m.week, player: m.name, pos: m.pos,
        kind: m.kind, tenure: m.tenure, started: m.started, startedPts: m.startedPts,
    })),
};

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, `${JSON.stringify(out)}\n`);
const kb = Math.round(fs.statSync(OUT).size / 1024);
console.log(`\nscritto ${path.relative(ROOT, OUT)} (${kb} KB)`);
