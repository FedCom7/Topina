/**
 * Season Story — i dati in più che servono alle card interattive della home.
 *
 * Nessuna richiesta di rete: tutto esce da quello che la home ha già in mano
 * (`getLeagueData()`). Funzioni pure, un input un output.
 *
 * Regola di questo file: **niente numeri inventati**. Quando un dato non c'è
 * la voce sparisce dalla lista, e la card si richiude da sola. Meglio una riga
 * in meno che una cifra finta.
 */

import { displayName } from '../data.js?v=547';
import { TEAM_KEYS } from './team-config.js?v=533';
import { TEAM_KEY_LIST } from './league-data.js?v=546';

const toKey = (rawName) => TEAM_KEYS[displayName(rawName)] || null;

/**
 * Le stagioni davvero giocate. `league.seasons` contiene anche quella che deve
 * ancora cominciare: prima del via ESPN pubblica la week 1 con rose vuote e
 * 0.00–0.00, che in `allTime` diventano partite e stagioni vere. Contarle
 * significherebbe scrivere "8 seasons" a una lega che ne ha giocate 7.
 */
export function playedSeasons(league) {
    return league.seasons.filter(seasonStarted);
}

export function seasonStarted(season) {
    return Object.values(season.perTeam)
        .some(t => t.games.some(g => g.pts > 0 || g.oppPts > 0));
}

/** Le settimane davvero giocate della stagione, in ordine. */
function weeksOf(season) {
    const set = new Set();
    TEAM_KEY_LIST.forEach(k => (season.perTeam[k]?.games || [])
        .forEach(g => { if (g.pts > 0 || g.oppPts > 0) set.add(g.week); }));
    return [...set].sort((a, b) => a - b);
}

// ─── Serie per settimana (base dei grafici) ──────────────────────

/**
 * La classifica settimana per settimana: la base del bump chart.
 *
 * Non esiste da nessuna parte perché `processStandings` fotografa solo la fine
 * della regular season. Qui si applica la SUA STESSA regola al cumulato fino a
 * ogni giornata — vittorie, poi punti fatti (`js/data.js:249`). Usare un
 * criterio diverso darebbe una classifica che non combacia con `#standings`,
 * ed è il primo posto dove un lettore andrebbe a controllare.
 *
 * → [{ week, ranks: { [key]: 1..4 } }]
 */
export function weeklyStandings(season) {
    const cum = {};
    TEAM_KEY_LIST.forEach(k => { cum[k] = { w: 0, pf: 0 }; });

    return weeksOf(season).map(week => {
        TEAM_KEY_LIST.forEach(k => {
            const g = (season.perTeam[k]?.games || []).find(x => x.week === week);
            if (!g) return;
            cum[k].pf += g.pts;
            if (g.pts > g.oppPts) cum[k].w++;
        });
        const ordered = TEAM_KEY_LIST
            .filter(k => season.perTeam[k])
            .map(k => ({ k, ...cum[k] }))
            .sort((a, b) => (b.w !== a.w ? b.w - a.w : b.pf - a.pf));
        const ranks = {};
        ordered.forEach((t, i) => { ranks[t.k] = i + 1; });
        return { week, ranks };
    });
}

/**
 * Punti cumulati di ogni squadra MENO la media di lega di quella giornata.
 *
 * Sopra lo zero stai scappando, sotto stai crollando. Dice la cosa che la
 * classifica nasconde: chi vince di misura e chi domina perdendo.
 *
 * → [{ key, values: [{ x: week, y: scarto, tip }] }]
 */
export function cumulativeVsAverage(season) {
    const weeks = weeksOf(season);
    if (weeks.length < 2) return [];

    const cum = {};
    TEAM_KEY_LIST.forEach(k => { cum[k] = 0; });
    const out = {};
    TEAM_KEY_LIST.forEach(k => { out[k] = []; });

    weeks.forEach(week => {
        const played = [];
        TEAM_KEY_LIST.forEach(k => {
            const g = (season.perTeam[k]?.games || []).find(x => x.week === week);
            if (!g) return;
            cum[k] += g.pts;
            played.push(k);
        });
        if (!played.length) return;
        const media = played.reduce((s, k) => s + cum[k], 0) / played.length;
        played.forEach(k => {
            const y = +(cum[k] - media).toFixed(2);
            out[k].push({ x: week, y, tip: `Week ${week} · ${y >= 0 ? '+' : ''}${y.toFixed(1)}` });
        });
    });

    return TEAM_KEY_LIST
        .filter(k => out[k].length)
        .map(k => ({ key: k, values: out[k] }));
}

/**
 * Posizione finale in classifica, stagione per stagione: l'arco pluriennale.
 * Salta le stagioni non ancora giocate (`playedSeasons`).
 *
 * → [{ key, values: [{ x: anno, y: rank, tip }] }]
 */
export function seasonRankHistory(league) {
    const played = playedSeasons(league);
    if (played.length < 2) return [];

    return TEAM_KEY_LIST.map(key => ({
        key,
        values: played
            .map(s => {
                const t = s.perTeam[key];
                if (!t?.rank) return null;
                return {
                    x: +s.year,
                    y: t.rank,
                    tip: `${s.year} · #${t.rank} · ${t.w}–${t.l}${t.sbWin ? ' · Champion' : ''}`,
                };
            })
            .filter(Boolean),
    })).filter(s => s.values.length);
}

/**
 * Dettaglio di una squadra nella stagione: è quello che si apre cliccando una
 * riga della card classifica. `form` sono le ultime cinque, dalla più vecchia.
 */
export function teamSeasonDetail(ctx) {
    const { league, season } = ctx;
    const detail = {};
    TEAM_KEY_LIST.forEach(key => {
        const t = season.perTeam[key];
        if (!t) return;
        const row = season.standings.find(s => toKey(s.name) === key);
        const at = league.allTime[key];
        detail[key] = {
            pf: t.pf,
            pa: t.pa,
            diff: +(t.pf - t.pa).toFixed(2),
            streak: row?.streak && row.streak !== '-' ? row.streak : null,
            form: t.games.slice(-5).map(g => (g.won ? 'W' : g.pts < g.oppPts ? 'L' : 'T')),
            highGame: t.highGame,
            benchPts: +t.benchPts.toFixed(1),
            bestStreak: t.bestStreak?.len || 0,
            titles: at?.sbWins.length || 0,
            // Rivalità: record all-time contro le altre tre
            h2h: TEAM_KEY_LIST.filter(k => k !== key)
                .map(k => ({ key: k, ...(at?.vs?.[k] || { w: 0, l: 0, t: 0 }) }))
                .filter(v => v.w + v.l + v.t > 0),
        };
    });
    return detail;
}

/**
 * I due insiemi di numeri fra cui si commuta nella card "by the numbers":
 * questa stagione e tutta la storia della lega. `null` quando l'insieme non ha
 * senso — a stagione non ancora cominciata "Season" non ha niente da dire.
 */
export function numberSets(ctx) {
    const { league, season } = ctx;

    const seasonGames = TEAM_KEY_LIST
        .flatMap(k => (season.perTeam[k]?.games || []))
        .filter(g => g.pts > 0 || g.oppPts > 0);

    const seasonSet = seasonGames.length ? (() => {
        const top = seasonGames.reduce((a, g) => (g.pts > a.pts ? g : a));
        const bench = TEAM_KEY_LIST.reduce((s, k) => s + (season.perTeam[k]?.benchPts || 0), 0);
        return [
            { value: seasonGames.length / 2, label: 'Games' },
            { value: seasonGames.reduce((s, g) => s + g.pts, 0), label: 'Points scored' },
            { value: top.pts, label: 'Best week', decimals: 1, note: `W${top.week}` },
            { value: bench, label: 'Left on the bench' },
        ];
    })() : null;

    const played = playedSeasons(league);
    const allGames = played.flatMap(s =>
        TEAM_KEY_LIST.flatMap(k => (s.perTeam[k]?.games || []).map(g => ({ ...g, season: s.year }))));

    const allSet = allGames.length ? (() => {
        const top = allGames.reduce((a, g) => (g.pts > a.pts ? g : a));
        const titles = TEAM_KEY_LIST
            .map(k => ({ k, n: league.allTime[k].sbWins.length }))
            .sort((a, b) => b.n - a.n)[0];
        return [
            { value: played.length, label: 'Seasons' },
            { value: allGames.length / 2, label: 'Games' },
            { value: allGames.reduce((s, g) => s + g.pts, 0), label: 'Points scored' },
            { value: top.pts, label: 'Best week ever', decimals: 1, note: `${top.season} · W${top.week}` },
            { value: titles.n, label: 'Most titles', teamKey: titles.k },
        ].slice(0, 4);
    })() : null;

    return { season: seasonSet, allTime: allSet };
}
