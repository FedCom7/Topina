/**
 * Blocchi esclusivi "squadra" per la pagina DEF (la pick DEF è la difesa di
 * una squadra NFL): trade storiche, record ATS, storia franchigia. Non hanno
 * equivalente nella pagina giocatore.
 *
 * - Trade: nflverse trades.csv (build, data/nfl/team_trades.json).
 * - Record ATS: solo live, ESPN core API (nessuna fonte build/nfldata.org).
 * - Storia franchigia: solo live, ESPN site API (dato editoriale, nessuna
 *   fonte build) — l'endpoint risulta spesso vuoto (ESPN lo ha in parte
 *   dismesso); wired comunque così se ESPN lo riattiva compare da solo,
 *   stesso principio di NFLData per gli endpoint "documentati ma morti".
 */

import { canonAbbr } from './nfl-schedule.js?v=526';
import { ESPN_TEAM_IDS } from './player-map.js?v=513';

let _trades; // Promise<{teams}> | undefined
const _ats = {};      // `${abbr}-${season}` → risultato | null
const _history = {};  // abbr → risultato | null

async function fetchJson(url, timeoutMs = 10000) {
    // Timeout esplicito: senza, un endpoint ESPN appeso bloccherebbe il Promise.all
    // iniziale della pagina squadra (spinner infinito).
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try { const r = await fetch(url, { signal: ctrl.signal }); return r.ok ? await r.json() : null; }
    catch { return null; }
    finally { clearTimeout(t); }
}

async function tradesJson() {
    if (_trades !== undefined) return _trades;
    return (_trades = await fetchJson('data/nfl/team_trades.json'));
}

/** Ultime trade della squadra (nflverse, storico). */
export async function getTeamTrades(abbr) {
    const data = await tradesJson();
    return data?.teams?.[canonAbbr(abbr)] || [];
}

/** Record contro lo spread della stagione (solo ESPN, nessuna altra fonte). */
export async function getTeamATS(abbr, season) {
    const A = canonAbbr(abbr);
    const teamId = ESPN_TEAM_IDS[A];
    if (!teamId) return null;
    const cacheKey = `${A}-${season}`;
    if (cacheKey in _ats) return _ats[cacheKey];
    const data = await fetchJson(`https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/seasons/${season}/types/2/teams/${teamId}/ats`);
    const items = data?.items;
    if (!items?.length) return (_ats[cacheKey] = null);
    const overall = items.find(i => i.type?.name === 'atsOverall') || items[0];
    return (_ats[cacheKey] = {
        wins: overall.wins ?? null, losses: overall.losses ?? null, pushes: overall.pushes ?? null,
        home: items.find(i => i.type?.name === 'atsHome') || null,
        away: items.find(i => i.type?.name === 'atsAway') || null,
        favorite: items.find(i => i.type?.name === 'atsFavorite') || null,
        underdog: items.find(i => i.type?.name === 'atsUnderdog') || null,
    });
}

/** Storia franchigia (editoriale, solo ESPN). null se l'endpoint non risponde con dati utili. */
export async function getFranchiseHistory(abbr) {
    const A = canonAbbr(abbr);
    const teamId = ESPN_TEAM_IDS[A];
    if (!teamId) return null;
    if (A in _history) return _history[A];
    const data = await fetchJson(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/${teamId}/history`);
    // Schema non stabile/spesso vuoto lato ESPN: si prende solo ciò che è
    // riconoscibile, altrimenti si tratta come assente.
    const items = data?.items || data?.seasons || null;
    return (_history[A] = items?.length ? items : null);
}
