/**
 * Topina Honors — dati e calcolo premi.
 * Aggrega le prestazioni dei singoli giocatori dalla regular season
 * (weeks 1..regularSeasonWeeks) e ne deriva premi in stile NFL Honors
 * e l'All-Pro Team. Tutto è calcolato dai dati Firebase, zero curation.
 */

import {
    fetchFantasyData, fetchDraftData, flattenDraft,
    getSeasonConfig, displayName, SEASONS
} from '../data.js?v=534';
import { TEAM_KEYS } from './team-config.js?v=533';
import { FLEX_ELIGIBLE } from './league-rules.js?v=528';

// nome raw Firebase → chiave team ('capi' | 'lasers' | 'oscurus' | 'sommo')
function toKey(rawName) {
    return TEAM_KEYS[displayName(rawName)] || null;
}

// Cache per stagione: honors e all-pro sono immutabili una volta calcolati
const _cache = {};

/**
 * Bundle completo per una stagione: { players, managers, awards, allPro, revealed }
 * `revealed` = i vincitori si possono mostrare (playoff giocati → siamo
 * almeno in Super Bowl week, come la cerimonia reale alla vigilia del SB).
 */
export function getHonorsBundle(year) {
    if (!_cache[year]) _cache[year] = _build(year);
    return _cache[year];
}

async function _build(year) {
    const [fantasyData, draftData] = await Promise.all([
        fetchFantasyData(year),
        fetchDraftData(year),
    ]);
    if (!fantasyData?.weeks) return null;

    const config = getSeasonConfig(year);
    const { players, managers } = buildSeasonPlayers(fantasyData, config);
    if (!Object.keys(players).length) return null;

    const draftPicks = draftData ? flattenDraft(draftData) : [];
    const rsComplete = _weekPlayed(fantasyData, config.regularSeasonWeeks);
    const revealed = _weekPlayed(fantasyData, config.playoffWeek);

    // OROY e Comeback Player of the Year servono uno storico precedente:
    // niente per la prima stagione della lega (non esiste un "prima" con cui confrontare).
    const rookieCtx = await _buildRookieContext(year);

    return {
        year,
        players,
        managers,
        awards: computeAwards(players, managers, draftPicks, rookieCtx),
        allPro: computeAllPro(players),
        rsComplete,
        revealed,
    };
}

/**
 * Contesto per i premi che richiedono lo storico delle stagioni precedenti:
 * - priorNames: nomi di tutti i giocatori mai apparsi prima di `year` (per OROY)
 * - prevTotals: punti totali della stagione immediatamente precedente, per nome (per CPOY)
 * Entrambi null per la prima stagione della lega.
 */
async function _buildRookieContext(year) {
    const idx = SEASONS.indexOf(String(year));
    if (idx <= 0) return { priorNames: null, prevTotals: null };

    const priorNames = new Set();
    for (const prevYear of SEASONS.slice(0, idx)) {
        const prevBundle = await getHonorsBundle(prevYear);
        if (prevBundle) Object.keys(prevBundle.players).forEach(n => priorNames.add(n));
    }

    let prevTotals = null;
    const immediatePrev = await getHonorsBundle(SEASONS[idx - 1]);
    if (immediatePrev) {
        prevTotals = {};
        Object.values(immediatePrev.players).forEach(p => { prevTotals[p.name] = p.total; });
    }

    return { priorNames, prevTotals };
}

function _weekPlayed(fantasyData, weekNum) {
    const wk = fantasyData.weeks[String(weekNum)];
    if (!wk?.matchups?.length) return false;
    return wk.matchups.some(m =>
        m.team1 && m.team2 &&
        (parseFloat(m.team1.score) > 0 || parseFloat(m.team2.score) > 0));
}

/**
 * Aggregazione giocatori sulla sola regular season.
 * players[name] = { name, pos, nfl, total, started, gamesStarted, weeksRostered,
 *                   best: {pts, week}, teamKey }
 * managers[key] = { actual, optimal } per la lineup efficiency (Coach of the Year)
 */
export function buildSeasonPlayers(fantasyData, config) {
    const players = {};
    const managers = {};

    const touch = (p) => {
        const name = p.name;
        if (!players[name]) {
            players[name] = {
                name,
                pos: (p.position_in_team || p.position || '').toUpperCase(),
                nfl: p.nfl_team || '',
                total: 0, started: 0, gamesStarted: 0, weeksRostered: 0,
                best: { pts: 0, week: 0 },
                _teamCounts: {},
            };
        }
        return players[name];
    };

    for (let w = 1; w <= config.regularSeasonWeeks; w++) {
        const week = fantasyData.weeks[String(w)];
        if (!week?.matchups) continue;
        week.matchups.forEach(m => {
            [m.team1, m.team2].forEach(team => {
                if (!team) return;
                const teamKey = toKey(team.name);
                const starters = team.starters || [];
                const bench = team.bench || [];

                starters.forEach(p => {
                    const pts = parseFloat(p.fantasy_points) || 0;
                    const e = touch(p);
                    e.total += pts;
                    e.started += pts;
                    e.gamesStarted++;
                    e.weeksRostered++;
                    if (pts > e.best.pts) e.best = { pts, week: w };
                    if (teamKey) e._teamCounts[teamKey] = (e._teamCounts[teamKey] || 0) + 1;
                });
                bench.forEach(p => {
                    const pts = parseFloat(p.fantasy_points) || 0;
                    const e = touch(p);
                    e.total += pts;
                    e.weeksRostered++;
                    if (pts > e.best.pts) e.best = { pts, week: w };
                    if (teamKey) e._teamCounts[teamKey] = (e._teamCounts[teamKey] || 0) + 1;
                });

                // Lineup efficiency del manager: punti reali vs lineup ottimale
                if (teamKey) {
                    if (!managers[teamKey]) managers[teamKey] = { actual: 0, optimal: 0 };
                    const actual = starters.reduce((s, p) => s + (parseFloat(p.fantasy_points) || 0), 0);
                    managers[teamKey].actual += actual;
                    managers[teamKey].optimal += _optimalLineupPts([...starters, ...bench]);
                }
            });
        });
    }

    // Team di appartenenza = quello che l'ha avuto in roster più settimane
    Object.values(players).forEach(p => {
        p.teamKey = Object.entries(p._teamCounts)
            .sort((a, b) => b[1] - a[1])[0]?.[0] || null;
        delete p._teamCounts;
        p.total = +p.total.toFixed(2);
        p.started = +p.started.toFixed(2);
    });

    Object.values(managers).forEach(mgr => {
        mgr.efficiency = mgr.optimal ? (mgr.actual / mgr.optimal * 100) : 0;
    });

    return { players, managers };
}

/** Punti della miglior lineup possibile (QB, 2RB, 2WR, TE, FLEX RB/WR, K, DEF) */
function _optimalLineupPts(roster) {
    const byPos = {};
    roster.forEach(p => {
        const pos = (p.position_in_team || p.position || '').toUpperCase();
        if (!byPos[pos]) byPos[pos] = [];
        byPos[pos].push(parseFloat(p.fantasy_points) || 0);
    });
    Object.values(byPos).forEach(list => list.sort((a, b) => b - a));

    const take = (pos, n) => {
        const list = byPos[pos] || [];
        return list.splice(0, n).reduce((s, v) => s + v, 0);
    };

    let pts = take('QB', 1) + take('RB', 2) + take('WR', 2) + take('TE', 1)
        + take('K', 1) + take('DEF', 1);
    // FLEX: il migliore rimasto tra i ruoli ammessi (RB/WR in questa lega)
    const flexPool = FLEX_ELIGIBLE.flatMap(pos => byPos[pos] || []);
    if (flexPool.length) pts += Math.max(...flexPool);
    return pts;
}

// ─── Premi ───────────────────────────────────────────────────────

const fmtPts = (n) => n.toLocaleString('it-IT', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/**
 * Set completo dei Topina Honors.
 * Ogni premio: { id, abbr, name, desc, winner, finalists, statLine(entry) }
 * winner/finalists per i premi giocatore sono entry di `players`;
 * per il Coach of the Year sono { teamKey, efficiency, ... }.
 * `rookieCtx` ({ priorNames, prevTotals }) arriva da _buildRookieContext e
 * serve solo a OROY e Comeback Player of the Year — entrambi assenti nella
 * prima stagione della lega, perché richiedono uno storico precedente.
 */
export function computeAwards(players, managers, draftPicks, rookieCtx = {}) {
    const all = Object.values(players);
    const rank = (filter) => all.filter(filter).sort((a, b) => b.total - a.total);

    const playerStat = (p) => `${fmtPts(p.total)} pt · best ${fmtPts(p.best.pts)} (W${p.best.week})`;

    const playerAward = (id, abbr, name, desc, filter) => {
        const list = rank(filter);
        return {
            id, abbr, name, desc, kind: 'player',
            winner: list[0] || null,
            finalists: list.slice(0, 3),
            statLine: playerStat,
        };
    };

    const awards = [
        playerAward('mvp', 'MVP', 'Most Valuable Player',
            'The player with the most fantasy points in the regular season.',
            p => p.pos !== 'DEF'),
        playerAward('opoy', 'OPOY', 'Offensive Player of the Year',
            'The best skill player (RB/WR/TE) of the season.',
            p => ['RB', 'WR', 'TE'].includes(p.pos)),
    ];

    // Offensive Rookie of the Year — il rookie offensive con più punti.
    // "Rookie" = al suo primo anno nella lega (mai apparso nelle stagioni precedenti).
    // Niente nella prima stagione della lega: tutti sarebbero "rookie", il dato non ha senso.
    if (rookieCtx.priorNames) {
        const rookies = rank(p =>
            p.pos !== 'DEF' && p.pos !== 'K' && !rookieCtx.priorNames.has(p.name));
        if (rookies.length) {
            awards.push({
                id: 'oroy', abbr: 'OROY', name: 'Offensive Rookie of the Year',
                desc: "The offensive rookie with the most fantasy points: in their first year in the league.",
                kind: 'player',
                winner: rookies[0] || null,
                finalists: rookies.slice(0, 3),
                statLine: playerStat,
            });
        }
    }

    awards.push(
        playerAward('dpoy', 'DPOY', 'Defensive Player of the Year',
            'The defense that brought the most points to its team.',
            p => p.pos === 'DEF'),
    );

    // Coach of the Year — non basta più la sola lineup efficiency: un manager si
    // giudica anche su come ha draftato e su cosa ha saputo pescare dopo. Tre
    // metriche, ognuna con la sua classifica, e vince chi sta meglio nella somma
    // delle tre posizioni (a parità, chi ha lasciato meno punti in panchina).
    const coaches = Object.entries(managers).map(([teamKey, m]) => {
        const suoi = all.filter(p => p.teamKey === teamKey);
        // "draftato da lui" = scelto al draft da questa squadra. Chi è finito
        // altrove non conta, e chi è arrivato dopo il draft è pescato.
        const draftati = new Set(draftPicks.filter(pk => toKey(pk.team) === teamKey).map(pk => pk.player));
        const draftPts = suoi.filter(p => draftati.has(p.name)).reduce((s, p) => s + p.total, 0);
        const waiverPts = suoi.filter(p => !draftati.has(p.name)).reduce((s, p) => s + p.total, 0);
        return { teamKey, ...m, draftPts: +draftPts.toFixed(2), waiverPts: +waiverPts.toFixed(2) };
    });

    const posizione = (lista, chiave) => {
        const ordinata = [...lista].sort((a, b) => b[chiave] - a[chiave]);
        return new Map(ordinata.map((c, i) => [c.teamKey, i + 1]));
    };
    const rEff = posizione(coaches, 'efficiency');
    const rDraft = posizione(coaches, 'draftPts');
    const rWaiver = posizione(coaches, 'waiverPts');
    coaches.forEach(c => {
        c.rankEff = rEff.get(c.teamKey);
        c.rankDraft = rDraft.get(c.teamKey);
        c.rankWaiver = rWaiver.get(c.teamKey);
        c.score = c.rankEff + c.rankDraft + c.rankWaiver;
    });
    coaches.sort((a, b) => a.score - b.score || b.efficiency - a.efficiency);

    // Il draft non c'è in tutte le stagioni: senza, si torna alla sola efficiency.
    const conDraft = draftPicks.length > 0;
    awards.push({
        id: 'coach', abbr: 'COTY', name: 'Coach of the Year',
        desc: conDraft
            ? 'The best manager across three counts: lineup efficiency, points from his own draft picks, and points from players added after the draft.'
            : 'The manager with the best lineup efficiency: points started vs the optimal lineup.',
        kind: 'coach',
        winner: coaches[0] || null,
        finalists: coaches,
        statLine: (c) => conDraft
            ? `${c.efficiency.toFixed(1)}% efficiency · ${Math.round(c.draftPts)} pt drafted · ${Math.round(c.waiverPts)} pt added`
            : `${c.efficiency.toFixed(1)}% efficiency · ${fmtPts(c.optimal - c.actual)} pt left on the bench`,
    });

    // Comeback Player of the Year — il salto di punti più grande rispetto alla stagione precedente.
    // Niente nella prima stagione della lega: non esiste un "anno prima" con cui confrontare.
    if (rookieCtx.prevTotals) {
        const withDelta = all
            .filter(p => p.pos !== 'DEF' && rookieCtx.prevTotals[p.name] != null)
            .map(p => ({ ...p, delta: p.total - rookieCtx.prevTotals[p.name] }))
            .sort((a, b) => b.delta - a.delta);
        if (withDelta.length) {
            awards.push({
                id: 'cpoy', abbr: 'CPOY', name: 'Comeback Player of the Year',
                desc: "The biggest jump in fantasy points compared to the previous season.",
                kind: 'player',
                winner: withDelta[0] || null,
                finalists: withDelta.slice(0, 3),
                statLine: (p) => `${fmtPts(p.total)} pt (${p.delta >= 0 ? '+' : ''}${fmtPts(p.delta)} vs prior year)`,
            });
        }
    }

    // Steal of the Draft — chi, pescato nella metà bassa del draft, ha reso di più
    if (draftPicks.length) {
        const half = Math.ceil(draftPicks.length / 2);
        const steals = draftPicks
            .filter(pk => pk.pick > half)
            .map(pk => ({ ...players[pk.player], pick: pk.pick, round: pk.round }))
            .filter(p => p.name && p.total > 0)
            .sort((a, b) => b.total - a.total);
        awards.push({
            id: 'steal', name: 'Steal of the Draft',
            desc: 'The most rewarding pick from the bottom half of the draft.',
            kind: 'player',
            winner: steals[0] || null,
            finalists: steals.slice(0, 3),
            statLine: (p) => `Pick #${p.pick} (round ${p.round}) · ${fmtPts(p.total)} pt`,
        });
    }

    // Premi di posizione
    const POS_AWARDS = [
        ['qb', 'QB of the Year', 'QB'],
        ['rb', 'RB of the Year', 'RB'],
        ['wr', 'WR of the Year', 'WR'],
        ['te', 'TE of the Year', 'TE'],
        ['k', 'Kicker of the Year', 'K'],
    ];
    POS_AWARDS.forEach(([id, name, pos]) => {
        awards.push(playerAward(id, null, name,
            `The best ${pos} of the regular season.`, p => p.pos === pos));
    });

    return awards;
}

// ─── All-Pro Team ────────────────────────────────────────────────

const ALLPRO_SLOTS = [
    ['QB', 1], ['RB', 2], ['WR', 2], ['TE', 1], ['FLEX', 1], ['K', 1], ['DEF', 1],
];

/**
 * First e Second Team per gli slot di lineup della lega.
 * → { first: [{slot, player}], second: [{slot, player}] }
 */
export function computeAllPro(players) {
    const pool = {};
    ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'].forEach(pos => {
        pool[pos] = Object.values(players)
            .filter(p => p.pos === pos)
            .sort((a, b) => b.total - a.total);
    });

    const used = new Set();
    const draw = (pos) => {
        const p = (pool[pos] || []).find(x => !used.has(x.name)) || null;
        if (p) used.add(p.name);
        return p;
    };
    const drawFlex = () => {
        const candidates = FLEX_ELIGIBLE
            .map(pos => (pool[pos] || []).find(x => !used.has(x.name)))
            .filter(Boolean)
            .sort((a, b) => b.total - a.total);
        const p = candidates[0] || null;
        if (p) used.add(p.name);
        return p;
    };

    const buildTeam = () => {
        const team = [];
        ALLPRO_SLOTS.forEach(([slot, n]) => {
            for (let i = 0; i < n; i++) {
                const player = slot === 'FLEX' ? drawFlex() : draw(slot);
                team.push({ slot, player });
            }
        });
        return team;
    };

    return { first: buildTeam(), second: buildTeam() };
}

/** Stagioni con dati (per i selettori anno delle pagine honors/all-pro) */
export function honorsSeasons() {
    return [...SEASONS];
}
