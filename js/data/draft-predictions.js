/**
 * Pronostico stagione dai valori del draft — Monte Carlo.
 *
 * Dai valori delle pick (gli stessi dei Draft Grades) costruisce il lineup
 * ottimale settimana per settimana tenendo conto delle BYE WEEK NFL (dai
 * JSON data/nfl/team_stats_{Y}.json), genera il calendario di lega (rotazione
 * fissa a 3 settimane, identica ogni anno dal 2019) e simula N stagioni
 * complete: regular season, playoff (1ª vs 4ª, 2ª vs 3ª) e Super Bowl.
 *
 * Rumore settimanale: varianza PER GIOCATORE. Ogni titolare porta il suo
 * coefficiente di variazione (cv) dal game-log dell'anno precedente (nflverse,
 * via context-score); la varianza di squadra è la somma delle varianze dei
 * titolari (σ_team = √Σ(perGame·cv)²). Roster consistenti → σ più bassa → più
 * vittorie H2H. I cv di default sono tarati per riprodurre il ~18% di squadra
 * calibrato sulle stagioni reali quando i dati per-giocatore mancano.
 * RNG seedato per anno: risultati stabili tra i reload.
 */

import { getSeasonConfig } from '../data.js?v=32';
import { getTeamStats } from './nfl-team-stats.js?v=11';
import { canonAbbr } from './nfl-schedule.js?v=11';
import { resolveDefAbbrSync } from './player-full.js?v=13';
import { ROSTER_SLOTS, FLEX_ELIGIBLE } from './league-rules.js?v=11';
import { perGameCv } from './context-score.js?v=7';

const { FLEX, ...SLOTS } = ROSTER_SLOTS; // FLEX gestito a parte (pool RB/WR)
const FLEX_POS = FLEX_ELIGIBLE;
const GAMES_PER_SEASON = 16; // gare NFL utili di un titolare (17 - bye)
const SIGMA_MIN = 16;
const ITERATIONS = 4000;
// cv di default per ruolo (senza game-log): scelti perché aggregati su un
// lineup danno σ_team ≈ 18% della media, come la vecchia calibrazione.
const DEFAULT_CV = { QB: 0.42, RB: 0.55, WR: 0.60, TE: 0.62, K: 0.55, DEF: 0.60 };

// rotazione reale della lega (verificata 2019-2025): periodo 3
const ROTATION = [
    [['oscurus', 'lasers'], ['sommo', 'capi']],
    [['oscurus', 'sommo'], ['lasers', 'capi']],
    [['oscurus', 'capi'], ['lasers', 'sommo']],
];

/** RNG deterministico (mulberry32) + campione normale standard (Box-Muller). */
function makeRng(seed) {
    let a = seed >>> 0;
    const rnd = () => {
        a |= 0; a = a + 0x6D2B79F5 | 0;
        let t = Math.imul(a ^ a >>> 15, 1 | a);
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
    return {
        normal() {
            const u = Math.max(rnd(), 1e-9), v = rnd();
            return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
        },
    };
}

/** Bye week per squadra NFL nella stagione: settimana 1..N assente dal calendario. */
async function getByeWeeks(year) {
    try {
        const data = await getTeamStats(year);
        const byes = {};
        for (const [abbr, t] of Object.entries(data.teams || {})) {
            const played = new Set((t.schedule || []).map(g => g.week));
            if (!played.size) continue;
            for (let w = 1; w <= (data.weeks || 18); w++) {
                if (!played.has(w)) { byes[abbr] = w; break; }
            }
        }
        return Object.keys(byes).length ? byes : null;
    } catch { return null; }
}

/** Punti per gara di replacement (waiver) per ruolo: 60% della mediana draftata. */
function replacementPerGame(allPicks) {
    const repl = {};
    for (const pos of Object.keys({ ...SLOTS })) {
        const vals = allPicks.filter(p => p.pos === pos).map(p => p.value).sort((a, b) => a - b);
        const med = vals.length ? vals[Math.floor(vals.length / 2)] : 0;
        repl[pos] = (med / GAMES_PER_SEASON) * 0.6;
    }
    return repl;
}

/**
 * Lineup ottimale di una settimana (bye esclusi): ritorna media e VARIANZA.
 * mu = Σ perGame dei titolari; variance = Σ (perGame·cv)² (giocatori
 * indipendenti). Le slot vuote usano il replacement col cv di default.
 */
function weeklyMu(roster, week, repl) {
    const avail = roster.filter(p => p.bye !== week);
    const byPos = {};
    for (const p of avail) (byPos[p.pos] = byPos[p.pos] || []).push(p);
    for (const list of Object.values(byPos)) list.sort((a, b) => b.perGame - a.perGame);

    let mu = 0, variance = 0;
    const used = new Set();
    const addVar = (pg, cv) => { const s = pg * cv; variance += s * s; };
    for (const [pos, n] of Object.entries(SLOTS)) {
        const list = byPos[pos] || [];
        for (let i = 0; i < n; i++) {
            if (list[i]) { mu += list[i].perGame; addVar(list[i].perGame, list[i].cv); used.add(list[i]); }
            else { mu += repl[pos] || 0; addVar(repl[pos] || 0, DEFAULT_CV[pos] || 0.55); }
        }
    }
    // FLEX: miglior RB/WR/TE rimasto
    const flex = FLEX_POS.flatMap(pos => (byPos[pos] || []).filter(p => !used.has(p)))
        .sort((a, b) => b.perGame - a.perGame)[0];
    if (flex) { mu += flex.perGame; addVar(flex.perGame, flex.cv); }
    else {
        const bestReplPos = FLEX_POS.reduce((a, b) => (repl[b] || 0) > (repl[a] || 0) ? b : a, FLEX_POS[0]);
        mu += repl[bestReplPos] || 0; addVar(repl[bestReplPos] || 0, DEFAULT_CV[bestReplPos] || 0.6);
    }
    return { mu, variance };
}

/**
 * Pronostico per tutte le squadre di un draft.
 * `grades` è l'output di computeGrades (list con {pos, nfl, player, value}).
 * Ritorna null se mancano squadre; altrimenti
 * { byTeam: { key: { expW, expL, record, sbPct, muAvg } }, weeks, byesKnown }.
 */
export async function predictSeason(year, grades) {
    const keys = grades.map(g => g.key);
    if (keys.length !== 4) return null;

    const cfg = getSeasonConfig(year);
    const weeks = cfg.regularSeasonWeeks;
    const byes = await getByeWeeks(year);
    const allPicks = grades.flatMap(g => g.list);
    const repl = replacementPerGame(allPicks);

    // roster con per-gara, bye e cv per-giocatore (dal game-log dell'anno prima)
    const rosters = {};
    for (const g of grades) {
        rosters[g.key] = await Promise.all(g.list.map(async p => {
            const abbr = p.pos === 'DEF'
                ? resolveDefAbbrSync(p.player)
                : canonAbbr(p.nfl);
            let cv = null;
            try { cv = await perGameCv({ name: p.player, pos: p.pos, year: +year }); } catch { /* default */ }
            return {
                pos: p.pos,
                perGame: (p.value || 0) / GAMES_PER_SEASON,
                cv: cv ?? DEFAULT_CV[p.pos] ?? 0.55,
                bye: (byes && abbr && byes[abbr]) || null,
            };
        }));
    }

    // profilo settimanale (regular season) + settimana "piena" per i playoff
    const mus = {}, muFull = {};
    for (const key of keys) {
        mus[key] = Array.from({ length: weeks }, (_, i) => weeklyMu(rosters[key], i + 1, repl));
        muFull[key] = weeklyMu(rosters[key], 0, repl); // week 0: nessuno in bye
    }

    const sigmaOf = (prof) => Math.max(SIGMA_MIN, Math.sqrt(prof.variance));
    const rng = makeRng((+year || 1) * 9973);
    const wins = Object.fromEntries(keys.map(k => [k, 0]));
    const sb = Object.fromEntries(keys.map(k => [k, 0]));

    for (let it = 0; it < ITERATIONS; it++) {
        const w = Object.fromEntries(keys.map(k => [k, 0]));
        const pf = Object.fromEntries(keys.map(k => [k, 0]));
        for (let wk = 1; wk <= weeks; wk++) {
            for (const [a, b] of ROTATION[(wk - 1) % 3]) {
                const pa = mus[a][wk - 1], pb = mus[b][wk - 1];
                const sa = pa.mu + sigmaOf(pa) * rng.normal();
                const sBpts = pb.mu + sigmaOf(pb) * rng.normal();
                pf[a] += sa; pf[b] += sBpts;
                if (sa >= sBpts) w[a]++; else w[b]++;
            }
        }
        for (const k of keys) wins[k] += w[k];

        // playoff: 1ª vs 4ª, 2ª vs 3ª (tiebreak: punti fatti), poi Super Bowl
        const seed = [...keys].sort((a, b) => w[b] - w[a] || pf[b] - pf[a]);
        const game = (a, b) => {
            const sa = muFull[a].mu + sigmaOf(muFull[a]) * rng.normal();
            const sBpts = muFull[b].mu + sigmaOf(muFull[b]) * rng.normal();
            return sa >= sBpts ? a : b;
        };
        sb[game(game(seed[0], seed[3]), game(seed[1], seed[2]))]++;
    }

    const byTeam = {};
    for (const k of keys) {
        const expW = wins[k] / ITERATIONS;
        const intW = Math.round(expW);
        byTeam[k] = {
            expW: +expW.toFixed(1),
            expL: +(weeks - expW).toFixed(1),
            record: `${intW}-${weeks - intW}`,
            sbPct: Math.round(sb[k] / ITERATIONS * 100),
            muAvg: +(mus[k].reduce((s, m) => s + m.mu, 0) / weeks).toFixed(1),
        };
    }
    return { byTeam, weeks, byesKnown: !!byes, iterations: ITERATIONS };
}
