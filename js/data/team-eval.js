/**
 * Team Evaluation Engine — Team Strength Index (TSI 0-100).
 *
 * Distinzione fondamentale rispetto al Draft Grade classico:
 *   Player Value  = Projection            (invariato, prodotto dal Prediction Engine)
 *   Team Strength = Projection + costruzione roster + rischio + scarsità + contesto
 *
 * Il TSI NON è Σ player value: è una misura di QUANTO È FORTE LA ROSA, che
 * ragiona come un fantasy player (titolari, profondità, bilanciamento, bye,
 * stack, contesto NFL, rischio). Il Draft Grade UFFICIALE resta invariato:
 * il TSI gli si affianca come indicatore di qualità del roster.
 *
 * IMPORTANTE — i pesi qui (TSI_WEIGHTS) sono una SCELTA DI DESIGN documentata
 * (un indice editoriale, ritoccabile), NON un modello predittivo: quindi NON
 * passano dal gate empirico di build-draft-model.mjs (che vale solo per il
 * modello che STIMA i punti). Tenere le due cose separate ed esplicite in UI.
 *
 * Scala: 0-100, dove 50 ≈ media della lega per le componenti relative
 * (projection/starter/posAdv/vor/bench/context/ceiling — normalizzate fra le 4
 * squadre) e valore assoluto per le componenti di costruzione (risk/balance/
 * bye/stack/consistency).
 *
 * Riusa: ROSTER_SLOTS/FLEX_ELIGIBLE (league-rules), il livello di replacement
 * calibrato su QUESTA lega (4 team), i sub-score già calcolati da
 * getContextScore (bust/cv/durability/ageCurve/teamOffense/ceiling) attaccati
 * come p.ctx dai Draft Grades. Degradazione graceful: senza ctx le componenti
 * forward-looking diventano neutre (50), il TSI resta calcolabile dal roster.
 */

import { ROSTER_SLOTS, FLEX_ELIGIBLE } from './league-rules.js?v=528';
import { getTeamStats } from './nfl-team-stats.js?v=588';
import { canonAbbr } from './nfl-schedule.js?v=546';

const { FLEX, ...SLOTS } = ROSTER_SLOTS; // {QB:1,RB:2,WR:2,TE:1,K:1,DEF:1}
export const NUM_TEAMS = 4;
const OFF = new Set(['QB', 'RB', 'WR', 'TE']);

/** Pesi dell'indice (design, documentati — NON gated). Sommano a 1. */
export const TSI_WEIGHTS = {
    projection: 0.20, // valore proiettato totale della rosa
    starter: 0.18,    // forza dei soli titolari (lineup ottimale)
    posAdv: 0.12,     // vantaggio posizionale slot-per-slot vs lega
    vor: 0.10,        // valore sopra il replacement (scarsità)
    bench: 0.08,      // qualità panchina, con diminishing return
    risk: 0.08,       // 100 − Risk Index composito (meno rischio = meglio)
    balance: 0.07,    // costruzione roster / bilanciamento posizionale
    context: 0.05,    // contesto offensivo NFL (EPA) dei giocatori
    bye: 0.03,        // ottimizzazione bye week (starter critici sovrapposti)
    stack: 0.03,      // sinergia QB+ricevitore stessa squadra NFL
    consistency: 0.03,// affidabilità/consistenza storica
    ceiling: 0.03,    // upside della rosa
};

export const TSI_LABELS = {
    projection: 'Projection', starter: 'Starters', posAdv: 'Positional advantage',
    vor: 'Scarcity (VOR)', bench: 'Bench', risk: 'Risk', balance: 'Construction',
    context: 'NFL Context', bye: 'Bye week', stack: 'Stack', consistency: 'Consistency',
    ceiling: 'Upside',
};

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const stdev = (a) => { const m = mean(a); return Math.sqrt(mean(a.map(x => (x - m) ** 2))); };

/** Normalizza una grandezza "relativa alla lega" a 0-100 (50 = media lega). */
function relScore(raw, allRaws) {
    const sd = stdev(allRaws) || 1;
    return clamp(50 + 20 * ((raw - mean(allRaws)) / sd), 0, 100);
}

/**
 * Fabbisogno titolari di lega per ruolo: numTeams × slot, con il FLEX diviso
 * RB/WR a metà. È il numero di giocatori che la lega manda in campo ogni
 * settimana per quel ruolo — la soglia che definisce il replacement.
 */
export function demandByPos() {
    const demand = {};
    for (const [pos, n] of Object.entries(SLOTS)) demand[pos] = NUM_TEAMS * n;
    demand.RB += NUM_TEAMS * (FLEX || 0) / 2;
    demand.WR += NUM_TEAMS * (FLEX || 0) / 2;
    return demand;
}

/** Livello di replacement per ruolo calibrato su QUESTA lega (4 team). */
export function replacementLevels(allPicks, valueField) {
    const demand = demandByPos();
    const repl = {};
    for (const pos of Object.keys(SLOTS)) {
        const vals = allPicks.filter(p => p.pos === pos)
            .map(p => p[valueField] || 0).sort((a, b) => b - a);
        // replacement = primo giocatore OLTRE il fabbisogno titolari della lega
        const idx = Math.min(Math.round(demand[pos]), vals.length - 1);
        repl[pos] = vals.length ? (vals[idx] ?? vals[vals.length - 1] ?? 0) : 0;
    }
    return repl;
}

/**
 * Lineup titolare ottimale (per valore stagionale): QB/2RB/2WR/TE/FLEX/K/DEF.
 * Ritorna { starters:[picks], slotValues:{slotKey:value}, benchByValue:[picks] }.
 * slotKey: QB, RB1, RB2, WR1, WR2, TE, FLEX, K, DEF.
 */
export function pickStarters(list, valueField) {
    const byPos = {};
    for (const p of list) (byPos[p.pos] = byPos[p.pos] || []).push(p);
    for (const l of Object.values(byPos)) l.sort((a, b) => (b[valueField] || 0) - (a[valueField] || 0));

    const starters = [], used = new Set(), slotValues = {}, bySlot = {};
    for (const [pos, n] of Object.entries(SLOTS)) {
        const l = byPos[pos] || [];
        for (let i = 0; i < n; i++) {
            const p = l[i];
            const slotKey = n > 1 ? `${pos}${i + 1}` : pos;
            slotValues[slotKey] = p ? (p[valueField] || 0) : 0;
            bySlot[slotKey] = p || null;
            if (p) { starters.push(p); used.add(p); }
        }
    }
    // FLEX: miglior RB/WR rimasto
    const flex = FLEX_ELIGIBLE.flatMap(pos => (byPos[pos] || []).filter(p => !used.has(p)))
        .sort((a, b) => (b[valueField] || 0) - (a[valueField] || 0))[0];
    slotValues.FLEX = flex ? (flex[valueField] || 0) : 0;
    bySlot.FLEX = flex || null;
    if (flex) { starters.push(flex); used.add(flex); }

    const benchByValue = list.filter(p => !used.has(p)).sort((a, b) => (b[valueField] || 0) - (a[valueField] || 0));
    return { starters, slotValues, bySlot, benchByValue };
}

const SLOT_KEYS = ['QB', 'RB1', 'RB2', 'WR1', 'WR2', 'TE', 'FLEX', 'K', 'DEF'];
// importanza relativa dello slot per posAdv/bye (i RB/WR titolari pesano di più)
const SLOT_IMPORTANCE = { QB: 1, RB1: 1.2, RB2: 1.1, WR1: 1.2, WR2: 1.1, TE: 0.9, FLEX: 1, K: 0.5, DEF: 0.6 };

/** Risk Index composito 0-100 di un singolo giocatore (100 = rischio max). */
export function playerRiskIndex(ctx) {
    if (!ctx) return null;
    const bust = ctx.bustProb != null ? ctx.bustProb * 100 : null;
    const vol = ctx.cv != null ? clamp((ctx.cv - 0.15) / (1.2 - 0.15) * 100, 0, 100) : null;
    const dur = ctx.subScores?.durability != null ? 100 - ctx.subScores.durability : null;
    const age = ctx.subScores?.ageCurve != null ? 100 - ctx.subScores.ageCurve : null;
    // media pesata sui componenti disponibili (rinormalizzata)
    const parts = [[bust, 0.35], [vol, 0.25], [dur, 0.20], [age, 0.20]].filter(([v]) => v != null);
    if (!parts.length) return null;
    const num = parts.reduce((s, [v, w]) => s + v * w, 0);
    const den = parts.reduce((s, [, w]) => s + w, 0);
    return +(num / den).toFixed(0);
}

/** Bilanciamento roster: fabbisogno realistico su 15 pick + diversità NFL. */
export function balanceScore(list) {
    const TARGET = { QB: 2, RB: 5, WR: 5, TE: 2, K: 1, DEF: 1 }; // rosa "sana"
    const CRIT = { RB: 1.4, WR: 1.4, QB: 1, TE: 0.9, K: 0.6, DEF: 0.6 };
    const cnt = {};
    for (const p of list) cnt[p.pos] = (cnt[p.pos] || 0) + 1;
    let penalty = 0;
    for (const [pos, tgt] of Object.entries(TARGET)) {
        const n = cnt[pos] || 0;
        const w = CRIT[pos] || 1;
        if (n < tgt) penalty += (tgt - n) * 6 * w;        // buchi (peggio nei ruoli chiave)
        else if (n > tgt) penalty += (n - tgt) * 3 * w;   // spreco (es. 4 QB / 3 TE)
    }
    // diversità: troppi giocatori dalla stessa squadra NFL = rischio concentrazione
    const byNfl = {};
    for (const p of list) if (p.nfl && OFF.has(p.pos)) byNfl[p.nfl] = (byNfl[p.nfl] || 0) + 1;
    const maxSame = Math.max(0, ...Object.values(byNfl));
    if (maxSame > 3) penalty += (maxSame - 3) * 5;
    return clamp(100 - penalty, 0, 100);
}

/** Bye: penalizza titolari critici sovrapposti nella stessa settimana. */
function byeScore(starters, byes) {
    if (!byes) return null;
    // raggruppa i titolari per bye e per ruolo di scarsità (RB/WR pesano di più)
    const perWeek = {}; // week → { pos → count }
    for (const p of starters) {
        const abbr = canonAbbr(p.nfl);
        const bye = abbr && byes[abbr];
        if (!bye) continue;
        (perWeek[bye] = perWeek[bye] || {});
        perWeek[bye][p.pos] = (perWeek[bye][p.pos] || 0) + 1;
    }
    let penalty = 0;
    const POSW = { RB: 12, WR: 10, TE: 6, QB: 8, K: 2, DEF: 2 };
    for (const posCnt of Object.values(perWeek)) {
        for (const [pos, n] of Object.entries(posCnt)) {
            if (n >= 2) penalty += (n - 1) * (POSW[pos] || 5); // 2 RB titolari stessa bye = grosso
        }
    }
    return clamp(100 - penalty, 0, 100);
}

/** Stack: QB titolare con un ricevitore titolare della stessa squadra NFL. */
function stackScore(starters) {
    const qbs = starters.filter(p => p.pos === 'QB' && p.nfl);
    let bonus = 0;
    for (const qb of qbs) {
        const mates = starters.filter(p => (p.pos === 'WR' || p.pos === 'TE') && p.nfl === qb.nfl);
        if (mates.length) bonus += 25 + (mates.length - 1) * 12; // stack solido
    }
    return clamp(50 + bonus, 0, 100);
}

/** Media pesata per valore di un campo ctx (0-100) sui titolari d'attacco. */
function wavgCtx(starters, get, valueField, fallback = 50) {
    let num = 0, den = 0;
    for (const p of starters) {
        if (!OFF.has(p.pos)) continue;
        const w = (p[valueField] || 0) || 1;
        const v = get(p.ctx);
        num += (v == null ? fallback : v) * w;
        den += w;
    }
    return den ? num / den : fallback;
}

/**
 * Bye week per abbr NFL (settimana mancante dal calendario). Derivata, non
 * archiviata: nessun file la contiene, ma il calendario c'è già — anche per la
 * stagione che deve ancora cominciare (team_stats_{Y} con `scheduleOnly`).
 * Esportata perché la usa anche il tab Pre-Draft di Projections.
 */
export async function getByeWeeks(year) {
    try {
        const data = await getTeamStats(year);
        const byes = {};
        for (const [abbr, t] of Object.entries(data.teams || {})) {
            const played = new Set((t.schedule || []).map(g => g.week));
            if (!played.size) continue;
            for (let w = 1; w <= (data.weeks || 18); w++) if (!played.has(w)) { byes[abbr] = w; break; }
        }
        return Object.keys(byes).length ? byes : null;
    } catch { return null; }
}

/**
 * Valuta l'intera lega e attacca il TSI a ogni squadra di `grades`.
 * @param grades output di computeGrades (con p.ctx già attaccato dove disponibile)
 * @param year   stagione del draft
 * @param opts   { mode: 'proj' | 'realized' } — realized usa p.actual come valore
 * @returns lo stesso array grades, con g.tsi, g.tsiSub{...}, g.starterValue,
 *          g.replacement e p.riskIndex su ogni pick d'attacco.
 */
export async function evaluateLeague(grades, year, { mode = 'proj' } = {}) {
    if (!grades?.length) return grades;
    const valueField = mode === 'realized' ? 'actual' : 'value';
    const allPicks = grades.flatMap(g => g.list).filter(p => p[valueField] != null);
    const repl = replacementLevels(allPicks, valueField);
    const byes = await getByeWeeks(year);

    // 1) grandezze grezze per squadra
    const raw = grades.map(g => {
        const list = g.list.filter(p => p[valueField] != null);
        const { starters, slotValues, benchByValue } = pickStarters(list, valueField);

        const projection = list.reduce((s, p) => s + (p[valueField] || 0), 0);
        const starterValue = starters.reduce((s, p) => s + (p[valueField] || 0), 0);
        const vor = list.reduce((s, p) => s + Math.max(0, (p[valueField] || 0) - (repl[p.pos] || 0)), 0);
        const bench = benchByValue.reduce((s, p, i) => s + (p[valueField] || 0) * Math.pow(0.55, i), 0);
        const ceiling = starters.reduce((s, p) => s + (p.ctx?.ceiling ?? (p[valueField] || 0) * 1.3), 0);

        // Risk Index per giocatore d'attacco (memorizzato sulla pick per la UI)
        for (const p of list) if (OFF.has(p.pos)) p.riskIndex = playerRiskIndex(p.ctx);
        return { g, list, starters, slotValues, benchByValue, projection, starterValue, vor, bench, ceiling };
    });

    // 2) medie lega per slot (per il vantaggio posizionale)
    const leagueSlotVals = {};
    for (const k of SLOT_KEYS) leagueSlotVals[k] = raw.map(r => r.slotValues[k] || 0);

    // 3) componenti finali 0-100
    const projAll = raw.map(r => r.projection);
    const starterAll = raw.map(r => r.starterValue);
    const vorAll = raw.map(r => r.vor);
    const benchAll = raw.map(r => r.bench);
    const ceilAll = raw.map(r => r.ceiling);

    for (const r of raw) {
        const g = r.g;
        // vantaggio posizionale: percentile dello slot fra le 4 squadre, pesato
        let paNum = 0, paDen = 0;
        for (const k of SLOT_KEYS) {
            const vals = leagueSlotVals[k];
            const mine = r.slotValues[k] || 0;
            const better = vals.filter(v => v < mine).length;
            const equal = vals.filter(v => v === mine).length;
            const pct = ((better + (equal - 1) / 2) / NUM_TEAMS) * 100; // 0..100 fra i pari
            const w = SLOT_IMPORTANCE[k] || 1;
            paNum += clamp(pct, 0, 100) * w; paDen += w;
        }
        const posAdv = paDen ? paNum / paDen : 50;

        // risk: media pesata del Risk Index dei titolari d'attacco → 100 − rischio
        let rNum = 0, rDen = 0;
        for (const p of r.starters) {
            if (!OFF.has(p.pos)) continue;
            const ri = p.riskIndex;
            const w = (p[valueField] || 0) || 1;
            rNum += (ri == null ? 45 : ri) * w; rDen += w;
        }
        const teamRisk = rDen ? rNum / rDen : 45;

        const context = wavgCtx(r.starters, ctx => ctx?.subScores?.teamOffense, valueField, 50);
        const consistency = wavgCtx(r.starters, ctx => {
            if (!ctx) return null;
            const dur = ctx.subScores?.durability ?? 60;
            const vol = ctx.cv != null ? clamp((ctx.cv - 0.15) / (1.2 - 0.15) * 100, 0, 100) : 40;
            return 0.5 * dur + 0.5 * (100 - vol);
        }, valueField, 55);

        const sub = {
            projection: relScore(r.projection, projAll),
            starter: relScore(r.starterValue, starterAll),
            posAdv,
            vor: relScore(r.vor, vorAll),
            bench: relScore(r.bench, benchAll),
            risk: clamp(100 - teamRisk, 0, 100),
            balance: balanceScore(r.list),
            context,
            bye: byeScore(r.starters, byes),
            stack: stackScore(r.starters),
            consistency,
            ceiling: relScore(r.ceiling, ceilAll),
        };

        // TSI: somma pesata; le componenti null (es. bye senza calendario) sono
        // escluse rinormalizzando i pesi rimanenti (degradazione graceful).
        let num = 0, den = 0;
        for (const [k, w] of Object.entries(TSI_WEIGHTS)) {
            if (sub[k] == null) continue;
            num += w * sub[k]; den += w;
        }
        g.tsi = den ? +(num / den).toFixed(1) : null;
        g.tsiSub = Object.fromEntries(Object.entries(sub).map(([k, v]) => [k, v == null ? null : +v.toFixed(0)]));
        g.tsiRisk = +teamRisk.toFixed(0);
        g.starterValue = +r.starterValue.toFixed(0);
        g.replacement = repl;
        g.starters = r.starters;
        g.benchByValue = r.benchByValue;
        g.byesKnown = !!byes;
    }

    // rank TSI
    const byTsi = [...grades].filter(g => g.tsi != null).sort((a, b) => b.tsi - a.tsi);
    byTsi.forEach((g, i) => { g.tsiRank = i + 1; });
    return grades;
}
