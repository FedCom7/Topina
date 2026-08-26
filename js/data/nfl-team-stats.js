/**
 * Statistiche di squadra NFL precalcolate (attacco, difesa, FPA per ruolo,
 * calendario, rank 1-32). File statici data/nfl/team_stats_{Y}.json generati
 * da scripts/build-nfl-team-stats.mjs — vedi lì per lo schema.
 */

import { canonAbbr } from './nfl-schedule.js?v=523';

const _mem = {};

/** Dati di squadra di una stagione. Lancia se il JSON non esiste. */
export async function getTeamStats(season) {
    if (_mem[season]) return _mem[season];
    const res = await fetch(`data/nfl/team_stats_${season}.json`);
    if (!res.ok) throw new Error(`team_stats_${season} non disponibile (${res.status})`);
    return (_mem[season] = await res.json());
}

/**
 * Contesto completo di una squadra: la squadra stessa, il calendario con le
 * stats di ogni avversario e lo strength of schedule per ruolo.
 * Se la stagione richiesta manca prova quella precedente
 * (ritorna season effettiva in `season` e `fallback: true`).
 */
export async function getTeamContext(abbr, season) {
    const A = canonAbbr(abbr);
    let data = null, used = +season, fallback = false;
    try { data = await getTeamStats(used); }
    catch {
        try { data = await getTeamStats(--used); fallback = true; }
        catch { return null; }
    }

    const team = data.teams?.[A];
    if (!team) return null;

    const opponents = (team.schedule || []).map(g => {
        const opp = data.teams?.[g.opp] || null;
        return {
            ...g,
            def: opp?.defense || null,
            off: opp?.offense || null,
            fpa: opp?.fpa || null,
            ranks: opp?.ranks || null,
            record: opp?.record || null,
        };
    });

    // SOS per ruolo: rank FPA medio degli avversari (1 = concede tanto = facile)
    const sos = {};
    for (const pos of ['QB', 'RB', 'WR', 'TE', 'K', 'DEF']) {
        const ranks = opponents.map(o => o.fpa?.[pos]?.rank).filter(r => r != null);
        sos[pos] = ranks.length ? +(ranks.reduce((a, b) => a + b, 0) / ranks.length).toFixed(1) : null;
    }

    return { abbr: A, season: used, fallback, scheduleOnly: !!data.scheduleOnly, team, opponents, sos };
}
