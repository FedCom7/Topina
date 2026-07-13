/**
 * Statistiche complete di un singolo giocatore via API Sleeper
 * (endpoint per-player non documentati ma stabili, CORS aperto):
 *  - /players/nfl/{id}            → anagrafica completa + ID esterni
 *  - /stats/nfl/player/{id}       → game log settimanale o totali stagionali
 *
 * L'id Sleeper non esiste nei dati del draft: si risolve per nome+ruolo
 * dalle stats stagionali già cachate (projections.js, campo playerId).
 * Le DEF hanno come id l'abbreviazione della squadra (es. "DAL").
 */

import { getSeasonStats, matchProjection } from './projections.js?v=6';
import { scoreProjectedStats, LEAGUE_SCORING } from './scoring.js?v=3';
import { TEAM_ABBR_MAP } from './player-map.js?v=3';
import { canonAbbr } from './nfl-schedule.js?v=2';
import { CURRENT_SEASON } from '../data.js?v=22';

export const FIRST_STATS_YEAR = 2015; // prima stagione con stats Sleeper affidabili
const MAX_SEASONS = 10;

// Franchigie con nome storico diverso nei vecchi draft (TEAM_ABBR_MAP ha solo i nomi attuali)
const LEGACY_DEF_NAMES = {
    'washington redskins': 'WAS',
    'washington football team': 'WAS',
    'oakland raiders': 'LV',
    'san diego chargers': 'LAC',
    'st louis rams': 'LAR',
    'st. louis rams': 'LAR',
};

const DAY_MS = 24 * 60 * 60 * 1000;
const _mem = {};

function cached(key, ttlMs) {
    if (_mem[key]) return _mem[key];
    try {
        const c = JSON.parse(localStorage.getItem(key) || 'null');
        if (c && Date.now() - c.at < ttlMs) return (_mem[key] = c.data);
    } catch { /* cache corrotta: si rifà il fetch */ }
    return null;
}

function store(key, data) {
    _mem[key] = data;
    try { localStorage.setItem(key, JSON.stringify({ at: Date.now(), data })); }
    catch { /* quota piena: pazienza */ }
}

/** Punti-lega di una prestazione DEF: coefficienti + fascia punti subiti. */
function defLeaguePts(s) {
    if (!s || s.pts_allow == null) return null;
    let pts = scoreProjectedStats(s) ?? 0;
    for (const [max, p] of LEAGUE_SCORING.def_pts_allowed_tiers) {
        if (s.pts_allow <= max) { pts += p; break; }
    }
    return +pts.toFixed(1);
}

/** Punti di riferimento di una prestazione: lega se calcolabili, altrimenti half-PPR. */
function refPts(s, pos) {
    if (pos === 'DEF') return defLeaguePts(s) ?? s?.pts_half_ppr ?? s?.pts_std ?? null;
    return scoreProjectedStats(s) ?? s?.pts_half_ppr ?? null;
}

/** Abbreviazione NFL di una difesa dal nome completo (anche nomi storici). */
export function resolveDefAbbrSync(name) {
    const abbr = TEAM_ABBR_MAP[name] || LEGACY_DEF_NAMES[(name || '').toLowerCase().trim()];
    return abbr ? canonAbbr(abbr) : null;
}

/**
 * Risolve l'id Sleeper di un giocatore. DEF: abbreviazione squadra.
 * Altrimenti cerca nome+ruolo nelle stats stagionali (anni recenti prima).
 */
export async function resolveSleeperId(name, pos, seasons) {
    const P = (pos || '').toUpperCase();
    if (P === 'DEF') return resolveDefAbbrSync(name);
    for (const y of seasons) {
        try {
            const map = await getSeasonStats(y);
            const hit = matchProjection(map, name, P);
            if (hit?.playerId) return hit.playerId;
        } catch { /* stagione senza dati: si prova la successiva */ }
    }
    return null;
}

/** Anagrafica completa + ID esterni. Cache 7 giorni. */
export async function getPlayerInfo(playerId) {
    const key = `topina_pinfo_v1_${playerId}`;
    const hit = cached(key, 7 * DAY_MS);
    if (hit) return hit;

    const res = await fetch(`https://api.sleeper.com/players/nfl/${playerId}`);
    if (!res.ok) throw new Error(`Sleeper player ${res.status}`);
    const info = await res.json();
    store(key, info);
    return info;
}

function weeklyTtl(season) {
    return +season < +CURRENT_SEASON ? 180 * DAY_MS : 6 * 60 * 60 * 1000;
}

/**
 * Game log di una stagione: array ordinato per week di
 * { week, date, opponent, isAway, team, stats, pts (punti lega o half-PPR) }.
 * Array vuoto se il giocatore non ha giocato quella stagione.
 */
export async function getPlayerWeekly(playerId, season, pos) {
    const key = `topina_pweek_v1_${season}_${playerId}`;
    const hit = cached(key, weeklyTtl(season));
    if (hit) return hit;

    const res = await fetch(`https://api.sleeper.com/stats/nfl/player/${playerId}?season_type=regular&season=${season}&grouping=week`);
    if (!res.ok) throw new Error(`Sleeper weekly ${res.status}`);
    const raw = await res.json();

    const games = Object.values(raw || {})
        // gms_active da solo = a roster ma mai in campo (riga vuota): serve gp o un punteggio
        .filter(g => g && g.stats && (g.stats.gp || g.stats.pts_half_ppr != null || g.stats.pts_std != null))
        .map(g => ({
            week: g.week,
            date: g.date || null,
            opponent: canonAbbr(g.opponent) || null,
            isAway: g.is_away_team ?? null,
            team: canonAbbr(g.team) || null,
            stats: g.stats,
            pts: refPts(g.stats, pos),
        }))
        .sort((a, b) => a.week - b.week);

    store(key, games);
    return games;
}

/** Totali stagionali raw ({ stats, pts, posRank }) o null se stagione vuota. */
export async function getPlayerSeasonTotals(playerId, season, pos) {
    const key = `topina_pseason_v1_${season}_${playerId}`;
    const hit = cached(key, weeklyTtl(season));
    if (hit) return hit.empty ? null : hit;

    const res = await fetch(`https://api.sleeper.com/stats/nfl/player/${playerId}?season_type=regular&season=${season}&grouping=season`);
    if (!res.ok) throw new Error(`Sleeper season ${res.status}`);
    const raw = await res.json();

    const s = raw?.stats;
    if (!s || !s.gp) { store(key, { empty: true }); return null; } // gp=0: mai sceso in campo
    const totals = {
        stats: s,
        pts: refPts(s, pos),
        posRank: s.pos_rank_half_ppr ?? null,
        team: canonAbbr(raw.team) || null,
    };
    store(key, totals);
    return totals;
}

/**
 * Orchestratore per la pagina giocatore: risolve l'id, carica anagrafica
 * e tutte le stagioni con dati (game log + totali), dalla più recente.
 * Ritorna { playerId, info, seasons: [{ year, totals, weekly }], resolved }.
 */
export async function getFullPlayer({ name, pos, year, topinaSeasons = [] }) {
    const P = (pos || '').toUpperCase().replace('W/R', 'WR');
    const latest = +CURRENT_SEASON; // le stagioni future non hanno ancora stats

    // ordine di ricerca id: anno della scheda, poi stagioni Topina, poi le recenti
    const lookup = [...new Set([
        ...(+year >= FIRST_STATS_YEAR && +year <= +CURRENT_SEASON ? [+year] : []),
        ...topinaSeasons.map(Number).filter(y => y >= FIRST_STATS_YEAR && y <= +CURRENT_SEASON),
        ...Array.from({ length: 4 }, (_, i) => +CURRENT_SEASON - i),
    ])];

    const playerId = await resolveSleeperId(name, P, lookup);
    if (!playerId) return { playerId: null, info: null, seasons: [], resolved: false };

    let info = null;
    try { info = await getPlayerInfo(playerId); } catch { /* anagrafica opzionale */ }

    const rookieYear = info?.metadata?.rookie_year ? +info.metadata.rookie_year : null;
    const from = Math.max(FIRST_STATS_YEAR, rookieYear || FIRST_STATS_YEAR, latest - MAX_SEASONS + 1);
    const years = [];
    for (let y = latest; y >= from; y--) years.push(y);

    const results = await Promise.allSettled(years.map(async y => ({
        year: y,
        totals: await getPlayerSeasonTotals(playerId, y, P),
        weekly: await getPlayerWeekly(playerId, y, P),
    })));

    const seasons = results
        .filter(r => r.status === 'fulfilled' && (r.value.totals || r.value.weekly.length))
        .map(r => r.value);

    return { playerId, info, seasons, resolved: true };
}
