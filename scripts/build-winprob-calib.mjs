/**
 * Genera data/model/winprob_calib.json — la dispersione delle proiezioni ESPN,
 * cioè l'unico ingrediente che serve a trasformare due proiezioni in una
 * probabilità di vittoria.
 *
 * PERCHÉ ESISTE. Il tabellone del Live mostrava come percentuale la QUOTA DI
 * PUNTI già a referto (`s1 / (s1 + s2)`). Il 19/09/2026, col solo Thursday
 * Night giocato, Sommo aveva 58,50 e Oscurus 0,00: la barra diceva 100% mentre
 * restavano 142 punti proiettati ancora da giocare. Non era un errore di
 * calcolo, era la domanda sbagliata.
 *
 * COSA SI MISURA. Per ogni titolare schierato nella lega dal 2019 a oggi si
 * prende la proiezione ESPN di quella settimana e il punteggio vero, e si
 * guarda quanto sbaglia la proiezione. Le proiezioni storiche arrivano da
 * `leaguedefaults/3` (il pool pubblico di ESPN, che risponde anche per le
 * stagioni chiuse: la nostra lega su ESPN nasce nel 2026 e per gli anni prima
 * non esiste), e i punti si RICALCOLANO dalle statistiche col punteggio della
 * NOSTRA lega — proiezione e realtà sulla stessa scala, sempre.
 *
 * Il modello è volutamente povero: due parametri per ruolo, `sd = a + b·proj`.
 * Con ~4000 righe per sei ruoli qualcosa di più ricco sarebbe rumore adattato.
 *
 * COSA VIENE VALIDATO (lo stampa a ogni esecuzione):
 *   1. taratura pre-giornata su tutte le sfide vere: Brier, log-loss e la
 *      tabella osservato-contro-previsto per decili;
 *   2. taratura A GIORNATA IN CORSO, che è il caso che ci interessa: si
 *      scoprono k titolari per squadra e si rifà il conto (`reveal backtest`);
 *   3. il fattore di scala `scale` che minimizza la log-loss. Se esce lontano
 *      da 1 il modello di dispersione è sbagliato, non i dati.
 *
 * Uso:  node scripts/build-winprob-calib.mjs
 *       node scripts/build-winprob-calib.mjs 2019 2026
 *
 * Richiede rete. Le risposte finiscono in .cache/winprob-calib/ (le stagioni
 * chiuse non cambiano più), quindi la seconda esecuzione è immediata e dà lo
 * stesso file a meno di `generatedAt`.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { nameKey } from './lib/nflverse.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = path.join(ROOT, '.cache', 'winprob-calib');
const HOST = 'https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl';
const LEAGUE_ID = '1948241900';

const FROM = Number(process.argv[2] || 2019);
const TO = Number(process.argv[3] || 2026);

const POS_LABEL = { 1: 'QB', 2: 'RB', 3: 'WR', 4: 'TE', 5: 'K', 16: 'DEF' };
const POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];

/**
 * Nome esteso della difesa → id squadra ESPN. Ci sono anche i nomi VECCHI:
 * lo storico di lega conserva "Oakland Raiders" e "Washington Redskins", e
 * senza queste righe quelle difese resterebbero senza proiezione.
 */
const DEF_NAME_TO_PRO = {
    'atlanta falcons': 1, 'buffalo bills': 2, 'chicago bears': 3,
    'cincinnati bengals': 4, 'cleveland browns': 5, 'dallas cowboys': 6,
    'denver broncos': 7, 'detroit lions': 8, 'green bay packers': 9,
    'tennessee titans': 10, 'indianapolis colts': 11, 'kansas city chiefs': 12,
    'las vegas raiders': 13, 'oakland raiders': 13, 'los angeles rams': 14,
    'st. louis rams': 14, 'miami dolphins': 15, 'minnesota vikings': 16,
    'new england patriots': 17, 'new orleans saints': 18, 'new york giants': 19,
    'new york jets': 20, 'philadelphia eagles': 21, 'arizona cardinals': 22,
    'pittsburgh steelers': 23, 'los angeles chargers': 24, 'san diego chargers': 24,
    'san francisco 49ers': 25, 'seattle seahawks': 26, 'tampa bay buccaneers': 27,
    'washington commanders': 28, 'washington football team': 28, 'washington redskins': 28,
    'carolina panthers': 29, 'jacksonville jaguars': 30, 'baltimore ravens': 33,
    'houston texans': 34,
};

// ── rete, con cache su disco ──────────────────────────────────────

fs.mkdirSync(CACHE, { recursive: true });

async function getJson(url, cacheFile, headers = {}) {
    const file = cacheFile ? path.join(CACHE, cacheFile) : null;
    if (file && fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
    for (let tentativo = 1; tentativo <= 3; tentativo++) {
        try {
            const res = await fetch(url, { headers });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            if (file) fs.writeFileSync(file, JSON.stringify(data));
            return data;
        } catch (e) {
            if (tentativo === 3) throw e;
            await new Promise(r => setTimeout(r, 1500 * tentativo));
        }
    }
    return null;
}

/** Il punteggio della NOSTRA lega: statId → punti. Serve a mettere proiezioni
 *  storiche e punti veri sulla stessa scala di oggi. */
async function leagueScoring() {
    const d = await getJson(
        `${HOST}/seasons/2026/segments/0/leagues/${LEAGUE_ID}?view=mSettings`,
        'scoring-2026.json');
    const out = {};
    for (const item of d?.settings?.scoringSettings?.scoringItems || []) {
        out[Number(item.statId)] = Number(item.points) || 0;
    }
    if (!Object.keys(out).length) throw new Error('punteggio di lega non leggibile');
    return out;
}

/**
 * Proiezioni e punti veri di una settimana, per tutti i giocatori posseduti.
 * `leaguedefaults/3` risponde anche per le stagioni chiuse; l'ordinamento per
 * percentuale di possesso è l'unico che mette davvero in cima i giocatori che
 * in una lega a 4 squadre si schierano (l'ordine per draft rank, sulle stagioni
 * vecchie, restituisce prima gente che non ha mai giocato).
 */
async function weekPool(year, week, scoring) {
    // In cache va solo l'ESTRATTO (nome → proiezione e punti), non la risposta
    // grezza: sono 1200 giocatori con tutte le statistiche di ogni riga, 10 MB
    // a settimana, 1,3 GB per otto stagioni. L'estratto è 50 KB.
    const slim = path.join(CACHE, `pool-${year}-w${week}.slim.json`);
    if (fs.existsSync(slim)) {
        const s = JSON.parse(fs.readFileSync(slim, 'utf8'));
        return {
            byName: new Map(Object.entries(s.byName).map(([k, v]) => [k, { proj: v[0], real: v[1], pos: v[2] }])),
            byDef: new Map(Object.entries(s.byDef).map(([k, v]) => [Number(k), { proj: v[0], real: v[1], pos: 'DEF' }])),
        };
    }

    const url = `${HOST}/seasons/${year}/segments/0/leaguedefaults/3`
        + `?scoringPeriodId=${week}&view=kona_player_info`;
    const filtro = { players: { limit: 1200, sortPercOwned: { sortPriority: 1, sortAsc: false } } };
    const grezzo = path.join(CACHE, `pool-${year}-w${week}.json`);   // vecchia cache, se c'è
    const d = fs.existsSync(grezzo)
        ? JSON.parse(fs.readFileSync(grezzo, 'utf8'))
        : await getJson(url, null, { 'x-fantasy-filter': JSON.stringify(filtro) });

    const punti = (row) => {
        if (!row) return null;
        // `appliedTotal` è nel punteggio della lega di default: lo si rifà col
        // nostro. Verificato sul 2026: la ricostruzione coincide al centesimo.
        let out = 0;
        for (const [id, v] of Object.entries(row.stats || {})) {
            out += (Number.parseFloat(v) || 0) * (scoring[Number(id)] || 0);
        }
        return out;
    };

    const byName = new Map();   // nameKey(nome, pos) → { proj, real }
    const byDef = new Map();    // proTeamId → { proj, real }
    for (const voce of d?.players || []) {
        const p = voce.player || {};
        const pos = POS_LABEL[p.defaultPositionId];
        if (!pos) continue;
        let real = null, proj = null;
        for (const row of p.stats || []) {
            if (row.scoringPeriodId !== week) continue;
            if (row.statSplitTypeId != null && row.statSplitTypeId !== 1) continue;
            if (row.statSourceId === 0) real = row;
            else if (row.statSourceId === 1) proj = row;
        }
        if (!proj) continue;                      // senza proiezione la riga non serve
        const voto = { proj: punti(proj), real: real ? punti(real) : null, pos };
        if (pos === 'DEF') byDef.set(p.proTeamId, voto);
        else byName.set(nameKey(p.fullName, pos), voto);
    }

    fs.writeFileSync(slim, JSON.stringify({
        byName: Object.fromEntries([...byName].map(([k, v]) => [k, [v.proj, v.real, v.pos]])),
        byDef: Object.fromEntries([...byDef].map(([k, v]) => [k, [v.proj, v.real]])),
    }));
    if (fs.existsSync(grezzo)) fs.rmSync(grezzo);   // la grezza non serve più
    return { byName, byDef };
}

// ── lo storico di lega: chi era TITOLARE, settimana per settimana ──

function leagueWeeks() {
    const out = [];
    for (let year = FROM; year <= TO; year++) {
        const file = path.join(ROOT, 'data', 'fantasy', `fantasy_data_${year}.json`);
        if (!fs.existsSync(file)) continue;
        const d = JSON.parse(fs.readFileSync(file, 'utf8'));
        for (const [w, week] of Object.entries(d.weeks || {})) {
            const matchups = (week.matchups || []).filter(m => m.team1 && m.team2);
            if (matchups.length) out.push({ year, week: Number(w), matchups });
        }
    }
    return out.sort((a, b) => a.year - b.year || a.week - b.week);
}

const num = (v) => Number.parseFloat(v) || 0;

/** Proiezione + punti veri di un titolare, cercati nel pool ESPN della settimana. */
function lookup(p, pool) {
    const pos = (p.position_in_team || p.position || '').toUpperCase();
    if (pos === 'DEF') {
        const id = DEF_NAME_TO_PRO[(p.name || '').toLowerCase()];
        const hit = id == null ? null : pool.byDef.get(id);
        return hit ? { ...hit, pos } : null;
    }
    const hit = pool.byName.get(nameKey(p.name, pos));
    return hit ? { ...hit, pos } : null;
}

// ── statistica di servizio ────────────────────────────────────────

const mean = (a) => a.reduce((s, x) => s + x, 0) / (a.length || 1);
const sd = (a) => {
    if (a.length < 2) return 0;
    const m = mean(a);
    return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1));
};
/** Normale standard cumulata (Abramowitz-Stegun 7.1.26 su erf). */
function phi(z) {
    const s = z < 0 ? -1 : 1;
    const x = Math.abs(z) / Math.SQRT2;
    const t = 1 / (1 + 0.3275911 * x);
    const erf = 1 - t * (0.254829592 + t * (-0.284496736 + t * (1.421413741
        + t * (-1.453152027 + t * 1.061405429)))) * Math.exp(-x * x);
    return 0.5 * (1 + s * erf);
}

/**
 * Retta `sd = a + b·proj` per un ruolo, stimata sui BIN di proiezione.
 *
 * Non si regredisce sui residui grezzi: la deviazione standard è una proprietà
 * di un gruppo, non di una riga. Si spezza la proiezione in bin di uguale
 * numerosità, si misura la sd dentro ciascuno e si tira la retta pesata per la
 * numerosità del bin.
 */
function fitSigma(rows, bins = 6) {
    if (rows.length < 40) return null;
    const ord = [...rows].sort((x, y) => x.proj - y.proj);
    const size = Math.floor(ord.length / bins);
    const pts = [];
    for (let i = 0; i < bins; i++) {
        const chunk = ord.slice(i * size, i === bins - 1 ? ord.length : (i + 1) * size);
        if (chunk.length < 8) continue;
        pts.push({ x: mean(chunk.map(r => r.proj)), y: sd(chunk.map(r => r.real - r.proj)), n: chunk.length });
    }
    if (pts.length < 3) return null;
    const W = pts.reduce((s, p) => s + p.n, 0);
    const mx = pts.reduce((s, p) => s + p.n * p.x, 0) / W;
    const my = pts.reduce((s, p) => s + p.n * p.y, 0) / W;
    let sxy = 0, sxx = 0;
    for (const p of pts) { sxy += p.n * (p.x - mx) * (p.y - my); sxx += p.n * (p.x - mx) ** 2; }
    const b = sxx ? sxy / sxx : 0;
    return { a: my - b * mx, b, bins: pts };
}

const sigmaOf = (model, pos, proj) => {
    const m = model[pos] || model.WR;
    return Math.max(m.min, m.a + m.b * Math.max(0, proj));
};

// ── probabilità di una sfida ──────────────────────────────────────

/**
 * Probabilità che la squadra 1 vinca.
 *
 * `rows` sono i titolari: `real` non null = ha già finito (punti certi),
 * altrimenti conta la proiezione con la sua dispersione. La somma di nove
 * variabili si tratta come normale; la correlazione fra compagni di squadra NFL
 * entra come termine aggiuntivo sulla varianza.
 */
function matchProb(rowsA, rowsB, model, scale, corr) {
    const lato = (rows) => {
        let mu = 0;
        const aperti = [];
        for (const r of rows) {
            if (r.real != null) { mu += r.real; continue; }
            mu += Math.max(0, r.proj + (model[r.pos]?.bias || 0));
            aperti.push({ sd: sigmaOf(model, r.pos, r.proj) * scale, nfl: r.nfl || '' });
        }
        let varTot = aperti.reduce((s, x) => s + x.sd ** 2, 0);
        for (let i = 0; i < aperti.length; i++) {
            for (let j = i + 1; j < aperti.length; j++) {
                if (aperti[i].nfl && aperti[i].nfl === aperti[j].nfl) {
                    varTot += 2 * corr * aperti[i].sd * aperti[j].sd;
                }
            }
        }
        return { mu, varTot };
    };
    const A = lato(rowsA), B = lato(rowsB);
    const sdDiff = Math.sqrt(A.varTot + B.varTot);
    if (!(sdDiff > 0)) return A.mu > B.mu ? 1 : A.mu < B.mu ? 0 : 0.5;
    return phi((A.mu - B.mu) / sdDiff);
}

/** Generatore pseudo-casuale con seme: il reveal backtest deve essere ripetibile. */
function rng(seed) {
    let s = seed >>> 0;
    return () => {
        s = (s * 1664525 + 1013904223) >>> 0;
        return s / 4294967296;
    };
}

function scoreProbs(coppie) {
    let brier = 0, logloss = 0;
    for (const [p, y] of coppie) {
        const q = Math.min(1 - 1e-6, Math.max(1e-6, p));
        brier += (q - y) ** 2;
        logloss += -(y * Math.log(q) + (1 - y) * Math.log(1 - q));
    }
    return { n: coppie.length, brier: brier / coppie.length, logloss: logloss / coppie.length };
}

function calibTable(coppie, bucket = 5) {
    const righe = [];
    for (let i = 0; i < bucket; i++) {
        const lo = i / bucket, hi = (i + 1) / bucket;
        const sub = coppie.filter(([p]) => p >= lo && (p < hi || (i === bucket - 1 && p <= 1)));
        if (!sub.length) continue;
        righe.push({
            fascia: `${(lo * 100).toFixed(0)}-${(hi * 100).toFixed(0)}%`,
            n: sub.length,
            previsto: mean(sub.map(([p]) => p)),
            osservato: mean(sub.map(([, y]) => y)),
        });
    }
    return righe;
}

// ── programma ─────────────────────────────────────────────────────

const scoring = await leagueScoring();
const weeks = leagueWeeks();
console.log(`Settimane di lega da valutare: ${weeks.length} (${FROM}-${TO})`);

/** Righe giocatore-settimana e sfide, con proiezione e punti veri appaiati. */
const rows = [];
const sfide = [];
let mancanti = 0, totali = 0;

for (const { year, week, matchups } of weeks) {
    let pool;
    try {
        pool = await weekPool(year, week, scoring);
    } catch (e) {
        console.warn(`  ${year} W${week}: pool non disponibile (${e.message})`);
        continue;
    }
    for (const m of matchups) {
        const lati = [m.team1, m.team2].map(t => (t.starters || []).map(p => {
            totali++;
            const hit = lookup(p, pool);
            if (!hit || hit.real == null) { mancanti++; return null; }
            const r = {
                year, week, pos: hit.pos, name: p.name, nfl: p.nfl_team || '',
                proj: hit.proj, real: hit.real, officiale: num(p.fantasy_points),
            };
            rows.push(r);
            return r;
        }));
        // Una sfida entra nel backtest solo se TUTTI e diciotto i titolari
        // hanno proiezione e punti: con un buco il totale è falsato e la
        // probabilità che ne esce non è confrontabile con l'esito.
        if (lati[0].length === 9 && lati[1].length === 9
            && lati.every(l => l.every(Boolean))) {
            const s1 = num(m.team1.score), s2 = num(m.team2.score);
            if (s1 !== s2) sfide.push({ year, week, a: lati[0], b: lati[1], vinceA: s1 > s2 ? 1 : 0 });
        }
    }
}

console.log(`Righe titolare-settimana appaiate: ${rows.length}`
    + ` (non trovate ${mancanti}/${totali}, ${(100 * mancanti / totali).toFixed(1)}%)`);
console.log(`Sfide complete per il backtest: ${sfide.length}`);

// ── 1. dispersione per ruolo ──────────────────────────────────────

console.log('\n── Dispersione delle proiezioni ESPN, per ruolo ──');
console.log('ruolo    n   proj medio   errore medio   sd   sd = a + b·proj');
const model = {};
for (const pos of POSITIONS) {
    const sub = rows.filter(r => r.pos === pos && r.proj >= 1);
    if (sub.length < 40) { console.log(`${pos.padEnd(5)} ${String(sub.length).padStart(5)}   (troppo poche)`); continue; }
    const res = sub.map(r => r.real - r.proj);
    const fit = fitSigma(sub);
    // Il pavimento è la sd del bin più basso: sotto quel livello di proiezione
    // non ci sono dati, e una retta lasciata libera arriverebbe a zero o sotto.
    const min = fit ? Math.max(1, Math.min(...fit.bins.map(b => b.y)) * 0.9) : 4;
    model[pos] = {
        a: Math.round((fit?.a ?? sd(res)) * 1000) / 1000,
        b: Math.round((fit?.b ?? 0) * 1000) / 1000,
        min: Math.round(min * 100) / 100,
        // Scarto medio del ruolo: le proiezioni ESPN sono un po' ottimiste su
        // RB e WR. Nella differenza fra due squadre si annulla — tranne quando
        // una delle due ha più titolari ancora da giocare dell'altra, che è
        // esattamente il momento in cui questa probabilità si guarda.
        bias: Math.round(mean(res) * 100) / 100,
    };
    console.log(`${pos.padEnd(5)} ${String(sub.length).padStart(5)}`
        + `   ${mean(sub.map(r => r.proj)).toFixed(1).padStart(9)}`
        + `   ${mean(res).toFixed(2).padStart(12)}`
        + `   ${sd(res).toFixed(2).padStart(5)}`
        + `   a=${model[pos].a.toFixed(2)} b=${model[pos].b.toFixed(3)} min=${model[pos].min}`);
    if (fit) {
        console.log('        bin: ' + fit.bins.map(b => `${b.x.toFixed(1)}→${b.y.toFixed(1)}`).join('  '));
    }
}

// ── 2. correlazione fra compagni di squadra NFL ───────────────────
// Due titolari della stessa squadra NFL nella stessa settimana sbagliano
// insieme (il QB e il suo ricevitore). Si misura sui residui normalizzati.
const perWeekTeam = new Map();
for (const r of rows) {
    if (!r.nfl) continue;
    const k = `${r.year}-${r.week}-${r.nfl}`;
    (perWeekTeam.get(k) || perWeekTeam.set(k, []).get(k)).push(r);
}
const coppieZ = [];
for (const list of perWeekTeam.values()) {
    if (list.length < 2) continue;
    for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
            const zi = (list[i].real - list[i].proj) / sigmaOf(model, list[i].pos, list[i].proj);
            const zj = (list[j].real - list[j].proj) / sigmaOf(model, list[j].pos, list[j].proj);
            coppieZ.push([zi, zj]);
        }
    }
}
let corr = 0;
if (coppieZ.length >= 30) {
    const xs = coppieZ.map(c => c[0]), ys = coppieZ.map(c => c[1]);
    const mxz = mean(xs), myz = mean(ys);
    let sxy = 0, sxx = 0, syy = 0;
    for (let i = 0; i < xs.length; i++) {
        sxy += (xs[i] - mxz) * (ys[i] - myz);
        sxx += (xs[i] - mxz) ** 2; syy += (ys[i] - myz) ** 2;
    }
    corr = sxy / Math.sqrt(sxx * syy);
}
console.log(`\nCorrelazione fra titolari della stessa squadra NFL: r ${corr.toFixed(3)}`
    + ` su ${coppieZ.length} coppie`);
// Si tiene solo se positiva e non irrisoria: una correlazione negativa fra
// compagni non ha senso fisico, e una da 0.02 aggiunge parametri e niente altro.
const corrUsata = corr > 0.05 ? Math.round(corr * 100) / 100 : 0;

// ── 3. taratura pre-giornata e a giornata in corso ────────────────

/** Tutte le coppie (probabilità, esito) a un dato numero di titolari scoperti.
 *  `k = 0` è il pronostico della vigilia, `k = 9` la giornata finita. */
function coppieRivelate(k, scale, seme = 7) {
    const out = [];
    for (const s of sfide) {
        const r = rng(seme + s.year * 100 + s.week);
        const mix = (list) => {
            const ordine = list.map((x, i) => ({ x, ord: r() + i * 0 }))
                .sort((p, q) => p.ord - q.ord).map(p => p.x);
            return ordine.map((row, i) => (i < k ? row : { ...row, real: null }));
        };
        out.push([matchProb(mix(s.a), mix(s.b), model, scale, corrUsata), s.vinceA]);
    }
    return out;
}

/**
 * La scala della dispersione, MISURATA sui totali di squadra.
 *
 * Nove giocatori indipendenti darebbero `sqrt(Σ sd²)`. I totali veri sbagliano
 * di più: nella stessa settimana c'è un tempo, un arbitraggio, un modo di
 * proiettare tutto il listone che si sposta insieme, e nessuno di questi è nei
 * residui individuali. Il rapporto fra la dispersione vera dei totali e quella
 * teorica è il fattore che manca, e si misura su 400+ squadra-settimana invece
 * di stimarlo su 216 esiti testa-o-croce.
 */
function teamLevelScale() {
    const residui = [], teorici = [];
    for (const s of sfide) {
        for (const lato of [s.a, s.b]) {
            const proj = lato.reduce((t, r) => t + Math.max(0, r.proj + (model[r.pos]?.bias || 0)), 0);
            const real = lato.reduce((t, r) => t + r.real, 0);
            let varTot = 0;
            const sds = lato.map(r => ({ sd: sigmaOf(model, r.pos, r.proj), nfl: r.nfl || '' }));
            for (const x of sds) varTot += x.sd ** 2;
            for (let i = 0; i < sds.length; i++) {
                for (let j = i + 1; j < sds.length; j++) {
                    if (sds[i].nfl && sds[i].nfl === sds[j].nfl) {
                        varTot += 2 * corrUsata * sds[i].sd * sds[j].sd;
                    }
                }
            }
            residui.push(real - proj);
            teorici.push(Math.sqrt(varTot));
        }
    }
    return { vera: sd(residui), teorica: mean(teorici), bias: mean(residui), n: residui.length };
}

const tl = teamLevelScale();
const scale = Math.round((tl.vera / tl.teorica) * 100) / 100;
console.log(`\n── Scala della dispersione, misurata sui totali di squadra ──`);
console.log(`squadra-settimana ${tl.n}  ·  sd teorica ${tl.teorica.toFixed(2)}`
    + `  ·  sd vera ${tl.vera.toFixed(2)}  ·  scarto medio residuo ${tl.bias.toFixed(2)}`);
console.log(`scale = ${scale}`);

// Controprova, non parametro: la scala che minimizzerebbe la log-loss sugli
// esiti. Se le due sono lontane fra loro c'è qualcosa che non torna.
let controprova = { scale: 1, logloss: Infinity };
for (let sc = 0.6; sc <= 1.8001; sc += 0.02) {
    const tutte = [];
    for (const k of [0, 2, 4, 6, 8]) tutte.push(...coppieRivelate(k, sc));
    const s = scoreProbs(tutte);
    if (s.logloss < controprova.logloss) {
        controprova = { scale: Math.round(sc * 100) / 100, logloss: s.logloss };
    }
}
console.log(`controprova sugli esiti: la log-loss minima sarebbe a scale ${controprova.scale}`
    + ` (${controprova.logloss.toFixed(4)}); a ${scale} è`
    + ` ${scoreProbs([0, 2, 4, 6, 8].flatMap(k => coppieRivelate(k, scale))).logloss.toFixed(4)}`);

console.log('\n── Taratura per stato della giornata ──');
console.log('scoperti   n    Brier   log-loss   Brier a 50%');
for (const k of [0, 2, 4, 6, 8, 9]) {
    const c = coppieRivelate(k, scale);
    const s = scoreProbs(c);
    const base = scoreProbs(c.map(([, y]) => [0.5, y]));
    console.log(`${String(k).padStart(5)}    ${String(s.n).padStart(4)}`
        + `   ${s.brier.toFixed(4)}   ${s.logloss.toFixed(4)}   ${base.brier.toFixed(4)}`);
}

console.log('\n── Osservato contro previsto (vigilia, k = 0) ──');
for (const r of calibTable(coppieRivelate(0, scale))) {
    console.log(`${r.fascia.padStart(8)}  n ${String(r.n).padStart(4)}`
        + `  previsto ${(r.previsto * 100).toFixed(1)}%  osservato ${(r.osservato * 100).toFixed(1)}%`);
}
console.log('\n── Osservato contro previsto (giornata a metà, k = 4) ──');
for (const r of calibTable(coppieRivelate(4, scale))) {
    console.log(`${r.fascia.padStart(8)}  n ${String(r.n).padStart(4)}`
        + `  previsto ${(r.previsto * 100).toFixed(1)}%  osservato ${(r.osservato * 100).toFixed(1)}%`);
}

// ── 4. il file ────────────────────────────────────────────────────

const diagnostica = {
    playerWeeks: rows.length,
    matchups: sfide.length,
    unmatchedPct: Math.round(1000 * mancanti / totali) / 10,
    teamCorrRaw: Math.round(corr * 1000) / 1000,
    teamCorrPairs: coppieZ.length,
    teamTotals: {
        n: tl.n,
        sdTheory: Math.round(tl.teorica * 100) / 100,
        sdActual: Math.round(tl.vera * 100) / 100,
        residualBias: Math.round(tl.bias * 100) / 100,
        loglossOptimalScale: controprova.scale,
    },
    byReveal: [0, 2, 4, 6, 8, 9].map(k => {
        const c = coppieRivelate(k, scale);
        const s = scoreProbs(c);
        return { revealed: k, n: s.n, brier: Math.round(s.brier * 1e4) / 1e4,
            logloss: Math.round(s.logloss * 1e4) / 1e4,
            brierAtHalf: Math.round(scoreProbs(c.map(([, y]) => [0.5, y])).brier * 1e4) / 1e4 };
    }),
    calibration: calibTable(coppieRivelate(0, scale)).map(r => ({
        band: r.fascia, n: r.n,
        predicted: Math.round(r.previsto * 1000) / 10,
        observed: Math.round(r.osservato * 1000) / 10,
    })),
};

const out = {
    generatedAt: new Date().toISOString(),
    source: 'ESPN kona_player_info (leaguedefaults/3), punti ricalcolati col punteggio di lega',
    seasons: [FROM, TO],
    sigma: model,
    scale,
    teamCorr: corrUsata,
    diagnostics: diagnostica,
};

const outFile = path.join(ROOT, 'data', 'model', 'winprob_calib.json');
fs.writeFileSync(outFile, JSON.stringify(out, null, 2) + '\n');
console.log(`\nScritto ${path.relative(ROOT, outFile)}`);
