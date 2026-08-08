/**
 * League Data — aggregazione condivisa di tutte le stagioni.
 * Fetch unico (promise cache a livello modulo): navigando tra le pagine team
 * Firebase viene interrogato una sola volta per sessione.
 */
import {
    fetchFantasyData, fetchDraftData, processStandings, getSuperBowlMatchup,
    getSeasonConfig, flattenDraft, displayName, SEASONS
} from '../data.js?v=33';
import { TEAM_KEYS } from './team-config.js?v=33';

export const TEAM_KEY_LIST = ['capi', 'lasers', 'oscurus', 'sommo'];

// nome raw Firebase → chiave team
function toKey(rawName) {
    return TEAM_KEYS[displayName(rawName)] || null;
}

let _promise = null;

export function getLeagueData() {
    if (!_promise) _promise = _build();
    return _promise;
}

async function _build() {
    const [fantasyResults, draftResults] = await Promise.all([
        Promise.all(SEASONS.map(y => fetchFantasyData(y))),
        Promise.all(SEASONS.map(y => fetchDraftData(y)))
    ]);

    const seasons = [];
    SEASONS.forEach((year, i) => {
        const data = fantasyResults[i];
        if (!data?.weeks) return;
        seasons.push(_buildSeason(year, data, draftResults[i]));
    });

    return {
        seasons,
        allTime: _buildAllTime(seasons),
        franchisePlayers: _buildFranchisePlayers(seasons),
    };
}

function _buildSeason(year, fantasyData, draftData) {
    const config = getSeasonConfig(year);
    const standings = processStandings(fantasyData, year);
    const complete = !!fantasyData.weeks[String(config.superBowlWeek)]?.matchups?.length;

    const perTeam = {};
    const initTeam = (key) => {
        if (!perTeam[key]) {
            perTeam[key] = {
                w: 0, l: 0, t: 0, pf: 0, pa: 0, rank: 0,
                games: [], highGame: null, benchPts: 0,
                bestStreak: { len: 0, endWeek: 0 },
                sweeps: [], sbAppearance: false, sbWin: false, rsTitle: false,
            };
        }
        return perTeam[key];
    };
    TEAM_KEY_LIST.forEach(initTeam);

    // Game log regular season
    for (let w = 1; w <= config.regularSeasonWeeks; w++) {
        const week = fantasyData.weeks[String(w)];
        if (!week?.matchups) continue;
        week.matchups.forEach(m => {
            if (!m.team1 || !m.team2) return;
            const sides = [[m.team1, m.team2], [m.team2, m.team1]];
            sides.forEach(([me, opp]) => {
                const key = toKey(me.name);
                const oppKey = toKey(opp.name);
                if (!key) return;
                const t = initTeam(key);
                const pts = parseFloat(me.score);
                const oppPts = parseFloat(opp.score);
                t.games.push({ week: w, opp: oppKey, pts, oppPts, won: pts > oppPts, margin: pts - oppPts });
                t.pf += pts;
                t.pa += oppPts;
                if (pts > oppPts) t.w++;
                else if (pts < oppPts) t.l++;
                else t.t++;
                if (!t.highGame || pts > t.highGame.pts) t.highGame = { pts, week: w };
                (me.bench || []).forEach(p => { t.benchPts += parseFloat(p.fantasy_points) || 0; });
            });
        });
    }

    // Streak migliore della stagione + sweep
    TEAM_KEY_LIST.forEach(key => {
        const t = perTeam[key];
        let run = 0;
        t.games.forEach(g => {
            if (g.won) {
                run++;
                if (run > t.bestStreak.len) t.bestStreak = { len: run, endWeek: g.week };
            } else {
                run = 0;
            }
        });
        const byOpp = {};
        t.games.forEach(g => {
            if (!g.opp) return;
            if (!byOpp[g.opp]) byOpp[g.opp] = { games: 0, wins: 0 };
            byOpp[g.opp].games++;
            if (g.won) byOpp[g.opp].wins++;
        });
        t.sweeps = Object.entries(byOpp)
            .filter(([, v]) => v.games >= 2 && v.wins === v.games)
            .map(([opp]) => opp);
        t.pf = +t.pf.toFixed(2);
        t.pa = +t.pa.toFixed(2);
    });

    // Rank e titolo regular season
    standings.forEach((s, idx) => {
        const key = toKey(s.name);
        if (key && perTeam[key]) {
            perTeam[key].rank = idx + 1;
            if (idx === 0) perTeam[key].rsTitle = true;
        }
    });

    // Super Bowl
    let sbWinnerKey = null;
    let sbLoserKey = null;
    if (complete) {
        const sb = getSuperBowlMatchup(fantasyData, year);
        if (sb?.team1 && sb?.team2) {
            const s1 = parseFloat(sb.team1.score);
            const s2 = parseFloat(sb.team2.score);
            const winner = s1 >= s2 ? sb.team1 : sb.team2;
            const loser = s1 >= s2 ? sb.team2 : sb.team1;
            sbWinnerKey = toKey(winner.name);
            sbLoserKey = toKey(loser.name);
            if (sbWinnerKey && perTeam[sbWinnerKey]) {
                perTeam[sbWinnerKey].sbWin = true;
                perTeam[sbWinnerKey].sbAppearance = true;
            }
            if (sbLoserKey && perTeam[sbLoserKey]) {
                perTeam[sbLoserKey].sbAppearance = true;
            }
        }
    }

    // Draft picks per team
    const draftPicks = {};
    if (draftData) {
        flattenDraft(draftData).forEach(p => {
            const key = toKey(p.team);
            if (!key) return;
            if (!draftPicks[key]) draftPicks[key] = [];
            draftPicks[key].push(p);
        });
    }

    return { year, complete, standings, sbWinnerKey, sbLoserKey, perTeam, draftPicks };
}

function _buildAllTime(seasons) {
    const allTime = {};
    TEAM_KEY_LIST.forEach(key => {
        allTime[key] = {
            w: 0, l: 0, t: 0, pf: 0, pa: 0, games: 0,
            sbWins: [], sbApps: [], rsTitles: [],
            bestStreak: { len: 0, season: null },
            highGame: null,
            vs: {}, // rivalità: { [oppKey]: { w, l, t } }
        };
    });

    seasons.forEach(({ year, perTeam }) => {
        TEAM_KEY_LIST.forEach(key => {
            const t = perTeam[key];
            const a = allTime[key];
            if (!t || !t.games.length) return;
            a.w += t.w; a.l += t.l; a.t += t.t;
            a.pf += t.pf; a.pa += t.pa;
            a.games += t.games.length;
            if (t.sbWin) a.sbWins.push(year);
            if (t.sbAppearance) a.sbApps.push(year);
            if (t.rsTitle) a.rsTitles.push(year);
            if (t.bestStreak.len > a.bestStreak.len) a.bestStreak = { len: t.bestStreak.len, season: year };
            if (t.highGame && (!a.highGame || t.highGame.pts > a.highGame.pts)) {
                a.highGame = { ...t.highGame, season: year };
            }
            t.games.forEach(g => {
                if (!g.opp) return;
                if (!a.vs[g.opp]) a.vs[g.opp] = { w: 0, l: 0, t: 0 };
                if (g.won) a.vs[g.opp].w++;
                else if (g.pts < g.oppPts) a.vs[g.opp].l++;
                else a.vs[g.opp].t++;
            });
        });
    });

    TEAM_KEY_LIST.forEach(key => {
        allTime[key].pf = +allTime[key].pf.toFixed(2);
        allTime[key].pa = +allTime[key].pa.toFixed(2);
    });
    return allTime;
}

function _buildFranchisePlayers(seasons) {
    const result = {};
    TEAM_KEY_LIST.forEach(key => {
        const playerMap = {};
        seasons.forEach(({ year, draftPicks }) => {
            const picks = draftPicks[key] || [];
            const seenThisYear = new Set();
            picks.forEach(p => {
                if (seenThisYear.has(p.player)) return;
                seenThisYear.add(p.player);
                if (!playerMap[p.player]) playerMap[p.player] = { name: p.player, pos: p.pos, seasons: [] };
                playerMap[p.player].seasons.push(year);
            });
        });
        result[key] = Object.values(playerMap)
            .filter(p => p.seasons.length >= 2)
            .sort((a, b) => b.seasons.length - a.seasons.length);
    });
    return result;
}
