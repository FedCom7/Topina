import { fetchFantasyData, displayName, SEASONS, getSuperBowlMatchup, getSeasonConfig } from '../data.js?v=540';
import { TEAM_LOGOS, TEAM_KEYS } from '../data/team-config.js?v=533';
import { TEAMS } from './team.js?v=665';
import { buildSeasonModel, pointsComparison, marketView } from './analysis.js?v=712';

let loaded = false;

// Player-record granularity toggle state (League Records section)
let recordMode = 'season'; // 'game' | 'season' | 'career'
let statsCache = null;
let recordsListenerBound = false;

// Andamento Giocatori: titolari-only vs tutti i giocatori
let playerViewMode = 'all'; // 'all' | 'starters'
let chartsListenerBound = false;
let chartMarkersCache = null;
let byRoleCache = null;         // { role: [pts, ...] } — titolari + panchina
let byRoleStartersCache = null; // { role: [pts, ...] } — solo titolari

// Categorie di statistiche giocatore unificate su tre granularità (game/season/career)
const STAT_CATS = [
    { key: 'pts', label: 'Fantasy Points', extract: p => Number(p.fantasy_points) || 0, decimals: 1 },
    { key: 'passYds', label: 'Pass Yards', extract: p => Number(p.stats.pass_yds) || 0 },
    { key: 'passTd', label: 'Pass TDs', extract: p => Number(p.stats.pass_td) || 0 },
    { key: 'rushYds', label: 'Rush Yards', extract: p => Number(p.stats.rush_yds) || 0 },
    { key: 'rushTd', label: 'Rush TDs', extract: p => Number(p.stats.rush_td) || 0 },
    { key: 'recYds', label: 'Receiving Yards', extract: p => Number(p.stats.rec_yds) || 0 },
    { key: 'recTd', label: 'Receiving TDs', extract: p => Number(p.stats.rec_td) || 0 },
    { key: 'sacks', label: 'Sacks', extract: p => Number(p.stats.sack) || 0 },
    { key: 'defTo', label: 'Turnovers Forced', extract: p => (Number(p.stats.def_int) || 0) + (Number(p.stats.fum_rec) || 0) },
    { key: 'defTd', label: 'Defensive TDs', extract: p => Number(p.stats.def_td) || 0 },
    { key: 'patMade', label: 'Extra Points Made', extract: p => Number(p.stats.pat_made) || 0 },
    { key: 'fgMade', label: 'Field Goals Made', extract: p => ['fg_0_19', 'fg_20_29', 'fg_30_39', 'fg_40_49', 'fg_50_plus'].reduce((s, f) => s + (Number(p.stats[f]) || 0), 0) },
];

function emptyLeader(extra) {
    return { value: 0, player: '', team: '', ...extra };
}

export async function initStats() {
    if (loaded) return;
    loaded = true;

    const summary = document.getElementById('stats-summary');

    // Il cerchio deve restare LO STESSO nodo dall'inizio alla fine: ogni volta
    // che lo si ricrea l'animazione CSS riparte da zero e si vede scattare
    // all'indietro — prima capitava a ognuna delle otto stagioni. Si riusa
    // quello già in index.html e si cambia solo la scritta sotto.
    let etichetta = summary?.querySelector('.loading-state p') || null;
    if (summary && !etichetta) {
        summary.innerHTML = `<div class="loading-state"><div class="spinner"></div><p></p></div>`;
        etichetta = summary.querySelector('.loading-state p');
    }

    try {
        const allSeasons = {};
        for (const season of SEASONS) {
            if (etichetta) etichetta.textContent = `Loading ${season} data...`;
            try {
                const data = await fetchFantasyData(season);
                if (data) {
                    allSeasons[season] = data;
                } else {
                    console.warn(`No data for ${season}`);
                }
            } catch (err) {
                console.error(`Error fetching ${season}:`, err);
            }
        }

        const stats = calculateStats(allSeasons);
        statsCache = stats;
        renderStats(stats);
    } catch (e) {
        console.error("Stats Init Error:", e);
        if (summary) summary.innerHTML = `<div class="error-state" style="color:red; padding:20px;">Error loading stats: ${e.message}</div>`;
    }
}

function calculateStats(allSeasons) {
    let totalGames = 0;
    let totalPoints = 0;

    // Global Records
    let highestScore = { value: 0, team: '', week: '', season: '' };
    let lowestScore = { value: 1000, team: '', week: '', season: '' };
    let largestMargin = { value: 0, winner: '', loser: '', week: '', season: '' };
    let mostPointsSeason = { value: 0, team: '', season: '' };
    let fewestPointsSeason = { value: 10000, team: '', season: '' };
    let smallestMargin = { value: 1000, winner: '', loser: '', week: '', season: '' };

    // Streaks
    let maxWinStreak = { value: 0, team: '', start: '', end: '' };
    let maxLossStreak = { value: 0, team: '', start: '', end: '' };

    // Player stat leaders su tre granularità (una entry per STAT_CATS key)
    const perGameLeaders = {};
    const perSeasonLeaders = {};
    const perCareerLeaders = {};
    STAT_CATS.forEach(c => {
        perGameLeaders[c.key] = emptyLeader({ season: '', week: '' });
        perSeasonLeaders[c.key] = emptyLeader({ season: '' });
        perCareerLeaders[c.key] = emptyLeader();
    });

    // Career totals per player (tutte le stagioni, sola regular season) — anche sorgente dei Top 5
    const playerCareerStats = {}; // player -> { ...STAT_CATS totals, team }

    // Team aggregated stats
    const teamRecords = {}; // { name: { w, l, t, pf, pa, games } }
    const headToHead = {};  // { teamA: { teamB: { w, l, t } } }

    // Tracking current streaks during iteration
    const currentStreaks = {}; // { teamName: { type: 'W'|'L'|'T', count: 0 } }

    // Chart data (per-season trends, playoffs included)
    const chartTeamPoints = {};   // season -> { rawTeamName: pts }
    const chartPlayerTotals = {}; // season -> total fantasy points by all players (starters+bench)
    const chartPlayerTotalsStarters = {}; // season -> total fantasy points, solo titolari
    const chartRolePoints = {};   // season -> { role: pts }
    const chartRolePointsStarters = {}; // season -> { role: pts }, solo titolari
    const chartGiornate = {};     // season -> giornate effettivamente giocate (matchup presenti)

    const initTeam = (name) => {
        if (!teamRecords[name]) teamRecords[name] = { w: 0, l: 0, t: 0, pf: 0, pa: 0, games: 0, sbWins: 0, sbApps: 0, playoffWins: 0, playoffGames: 0, apW: 0, apL: 0 };
        if (!headToHead[name]) headToHead[name] = {};
        if (!currentStreaks[name]) currentStreaks[name] = { type: '', count: 0 };
    };

    const initH2H = (t1, t2) => {
        if (!headToHead[t1][t2]) headToHead[t1][t2] = { w: 0, l: 0, t: 0 };
        if (!headToHead[t2][t1]) headToHead[t2][t1] = { w: 0, l: 0, t: 0 };
    };

    // Helper to update highest/lowest score
    const checkHighLowScore = (team, score, week, season, highest, lowest) => {
        if (score > highest.value) highest.value = score, highest.team = team, highest.week = week, highest.season = season;
        if (score > 0 && score < lowest.value) lowest.value = score, lowest.team = team, lowest.week = week, lowest.season = season;
    };

    // Helper to update largest/smallest margin
    const checkMaxMargin = (winner, loser, scoreW, scoreL, week, season, largest, smallest) => {
        const margin = Math.abs(scoreW - scoreL);
        if (margin > largest.value) {
            largest.value = margin.toFixed(2);
            largest.winner = winner;
            largest.loser = loser;
            largest.week = week;
            largest.season = season;
        }
        if (margin < smallest.value && margin >= 0) {
            smallest.value = margin.toFixed(2);
            smallest.winner = winner;
            smallest.loser = loser;
            smallest.week = week;
            smallest.season = season;
        }
    };

    // Iterate seasons chronologically
    SEASONS.forEach(season => {
        const data = allSeasons[season];
        if (!data?.weeks) return;

        // Get config for this season (Playoff/SB weeks)
        const config = getSeasonConfig ? getSeasonConfig(season) : (season === '2021' ? { regularSeasonWeeks: 16, playoffWeek: 17, superBowlWeek: 18 } : { regularSeasonWeeks: 15, playoffWeek: 16, superBowlWeek: 17 });

        const seasonPoints = {}; // Track points for this season
        const playerSeasonStats = {}; // `${team}||${player}` -> aggregated season stat totals
        const chartSeasonTeamPts = {}; // team -> pts (tutte le settimane, playoff inclusi)
        const seasonRolePoints = {}; // role -> fantasy points (all players, playoff inclusi)
        const seasonRolePointsStarters = {}; // role -> fantasy points (solo titolari, playoff inclusi)
        let seasonPlayerTotal = 0;
        let seasonPlayerTotalStarters = 0;
        let playedWeeks = 0;

        // Identify the actual Super Bowl matchup for this season
        const sbMatchup = getSuperBowlMatchup(data, season);
        const sbTeams = new Set();
        if (sbMatchup && sbMatchup.team1 && sbMatchup.team2) {
            sbTeams.add(sbMatchup.team1.name);
            sbTeams.add(sbMatchup.team2.name);
        }

        // Sort weeks numerically
        const weeks = Object.keys(data.weeks).sort((a, b) => Number(a) - Number(b));

        weeks.forEach(weekNum => {
            const wNum = parseInt(weekNum);
            const weekData = data.weeks[weekNum];
            if (!weekData.matchups) return;
            if (weekData.matchups.length > 0) playedWeeks++;

            // Track who played this week
            const teamsPlayed = new Set();

            // All-play della giornata: il punteggio di ognuno contro quello di
            // TUTTI gli altri, non solo contro l'avversario di calendario. In
            // una lega a 4 il record vero è poca roba; così ogni giornata ne
            // vale tre. Solo regular season, come il record.
            if (wNum <= config.regularSeasonWeeks) {
                const puntiSettimana = [];
                weekData.matchups.forEach(m => {
                    if (!m.team1 || !m.team2) return;
                    puntiSettimana.push([m.team1.name, parseFloat(m.team1.score || 0)]);
                    puntiSettimana.push([m.team2.name, parseFloat(m.team2.score || 0)]);
                });
                for (const [nome, punti] of puntiSettimana) {
                    initTeam(nome);
                    let battuti = 0;
                    for (const [altro, suoi] of puntiSettimana) {
                        if (altro === nome) continue;
                        if (punti > suoi) battuti += 1;
                        else if (punti === suoi) battuti += 0.5;
                    }
                    teamRecords[nome].apW += battuti;
                    teamRecords[nome].apL += (puntiSettimana.length - 1) - battuti;
                }
            }

            weekData.matchups.forEach(m => {
                if (!m.team1 || !m.team2) return;

                const t1 = m.team1.name;
                const t2 = m.team2.name;
                const s1 = parseFloat(m.team1.score || 0);
                const s2 = parseFloat(m.team2.score || 0);

                // Initialize if new
                initTeam(t1);
                initTeam(t2);
                initH2H(t1, t2);

                // Chart accumulation — tutte le settimane, playoff e SB inclusi
                chartSeasonTeamPts[t1] = (chartSeasonTeamPts[t1] || 0) + s1;
                chartSeasonTeamPts[t2] = (chartSeasonTeamPts[t2] || 0) + s2;
                for (const side of [m.team1, m.team2]) {
                    for (const [list, isStarter] of [[side.starters, true], [side.bench, false]]) {
                        for (const p of list || []) {
                            if (!p?.name) continue;
                            const pPts = parseFloat(p.fantasy_points || 0);
                            seasonPlayerTotal += pPts;
                            if (isStarter) seasonPlayerTotalStarters += pPts;
                            const role = p.position_in_team || p.position;
                            if (role) {
                                seasonRolePoints[role] = (seasonRolePoints[role] || 0) + pPts;
                                if (isStarter) seasonRolePointsStarters[role] = (seasonRolePointsStarters[role] || 0) + pPts;
                            }
                        }
                    }
                }
                // === REGULAR SEASON Stats ===
                if (wNum <= config.regularSeasonWeeks) {
                    // Global totals
                    totalGames++;
                    totalPoints += (s1 + s2);

                    // Team Stats
                    teamRecords[t1].games++;
                    teamRecords[t2].games++;
                    teamRecords[t1].pf += s1;
                    teamRecords[t1].pa += s2;
                    teamRecords[t2].pf += s2;
                    teamRecords[t2].pa += s1;

                    // W/L/T & H2H & Streaks
                    if (s1 > s2) {
                        teamRecords[t1].w++;
                        teamRecords[t2].l++;
                        headToHead[t1][t2].w++;
                        headToHead[t2][t1].l++;

                        updateStreak(t1, 'W', currentStreaks, season, wNum);
                        updateStreak(t2, 'L', currentStreaks, season, wNum);

                        checkMaxMargin(t1, t2, s1, s2, wNum, season, largestMargin, smallestMargin);
                    } else if (s2 > s1) {
                        teamRecords[t2].w++;
                        teamRecords[t1].l++;
                        headToHead[t2][t1].w++;
                        headToHead[t1][t2].l++;

                        updateStreak(t2, 'W', currentStreaks, season, wNum);
                        updateStreak(t1, 'L', currentStreaks, season, wNum);

                        checkMaxMargin(t2, t1, s2, s1, wNum, season, largestMargin, smallestMargin);
                    } else {
                        teamRecords[t1].t++;
                        teamRecords[t2].t++;
                        headToHead[t1][t2].t++;
                        headToHead[t2][t1].t++;

                        updateStreak(t1, 'T', currentStreaks, season, wNum);
                        updateStreak(t2, 'T', currentStreaks, season, wNum);
                    }

                    // Season Points Tracking
                    if (!seasonPoints[t1]) seasonPoints[t1] = 0;
                    if (!seasonPoints[t2]) seasonPoints[t2] = 0;
                    seasonPoints[t1] += s1;
                    seasonPoints[t2] += s2;

                    // High/Low Score Checks
                    checkHighLowScore(t1, s1, wNum, season, highestScore, lowestScore);
                    checkHighLowScore(t2, s2, wNum, season, highestScore, lowestScore);

                    // Per-player stat aggregation (rush/pass yards+TD, defense) — both rosters
                    [[t1, m.team1], [t2, m.team2]].forEach(([teamName, side]) => {
                        const allPlayers = [...(side.starters || []), ...(side.bench || [])];
                        allPlayers.forEach(p => {
                            if (!p?.name || !p.stats) return;
                            const key = `${teamName}||${p.name}`;
                            if (!playerSeasonStats[key]) {
                                playerSeasonStats[key] = Object.fromEntries(STAT_CATS.map(c => [c.key, 0]));
                            }
                            if (!playerCareerStats[p.name]) {
                                playerCareerStats[p.name] = { ...Object.fromEntries(STAT_CATS.map(c => [c.key, 0])), team: teamName, pos: '' };
                            }
                            const car = playerCareerStats[p.name];
                            const acc = playerSeasonStats[key];
                            car.team = teamName;
                            // `position` è lo slot (BN, W/R, RES…): il ruolo vero è position_in_team
                            const truePos = (p.position_in_team || '').toUpperCase();
                            if (truePos) car.pos = truePos;

                            STAT_CATS.forEach(c => {
                                const val = c.extract(p);
                                acc[c.key] += val;
                                car[c.key] += val;
                                // Per-game leader: confronto immediato, nessun accumulatore persistente
                                if (val > perGameLeaders[c.key].value) {
                                    perGameLeaders[c.key] = { value: val, player: p.name, team: teamName, season, week: wNum };
                                }
                            });

                            // All-time team TD + yardage totals (regular season only, matches PF/PA scope)
                            const rec = teamRecords[teamName];
                            rec.rushTD = (rec.rushTD || 0) + (Number(p.stats.rush_td) || 0);
                            rec.passTD = (rec.passTD || 0) + (Number(p.stats.pass_td) || 0);
                            rec.recTD = (rec.recTD || 0) + (Number(p.stats.rec_td) || 0);
                            rec.defTD = (rec.defTD || 0) + (Number(p.stats.def_td) || 0);
                            rec.rushYds = (rec.rushYds || 0) + (Number(p.stats.rush_yds) || 0);
                            rec.passYds = (rec.passYds || 0) + (Number(p.stats.pass_yds) || 0);
                            rec.recYds = (rec.recYds || 0) + (Number(p.stats.rec_yds) || 0);

                            // Receiving-TD breakdown by position
                            if (!rec.recTDByPos) rec.recTDByPos = { WR: 0, RB: 0, TE: 0 };
                            const posKey = p.position_in_team || p.position;
                            if (posKey === 'WR' || posKey === 'RB' || posKey === 'TE') {
                                rec.recTDByPos[posKey] += Number(p.stats.rec_td) || 0;
                            }

                        });
                    });
                }

                // === PLAYOFFS (Semi-Finals) ===
                if (wNum === config.playoffWeek) {
                    teamRecords[t1].playoffGames++;
                    teamRecords[t2].playoffGames++;
                    if (s1 > s2) teamRecords[t1].playoffWins++;
                    else if (s2 > s1) teamRecords[t2].playoffWins++;
                }

                // === SUPER BOWL ===
                if (wNum === config.superBowlWeek) {
                    // Only count if this is the confirmed SB matchup (Playoff Winners)
                    if (sbTeams.has(t1) && sbTeams.has(t2)) {
                        // Start SB Appearance (both played)
                        teamRecords[t1].sbApps++;
                        teamRecords[t2].sbApps++;
                        teamRecords[t1].playoffGames++;
                        teamRecords[t2].playoffGames++;

                        // Count Win
                        if (s1 > s2) {
                            teamRecords[t1].sbWins++;
                            teamRecords[t1].playoffWins++; // SB win is also a playoff win
                        } else if (s2 > s1) {
                            teamRecords[t2].sbWins++;
                            teamRecords[t2].playoffWins++; // SB win is also a playoff win
                        }
                    }
                }

                // Check Max Streaks (streaks can span across regular season/playoffs, so check after each game)
                checkMaxStreak(t1, currentStreaks[t1], maxWinStreak, maxLossStreak);
                checkMaxStreak(t2, currentStreaks[t2], maxWinStreak, maxLossStreak);
                if (s2 > highestScore.value) highestScore = { value: s2, team: t2, week: weekNum, season };

                if (s1 > 0 && s1 < lowestScore.value) lowestScore = { value: s1, team: t1, week: weekNum, season };
                if (s2 > 0 && s2 < lowestScore.value) lowestScore = { value: s2, team: t2, week: weekNum, season };

                // Margin
                const margin = Math.abs(s1 - s2);
                if (margin > largestMargin.value) {
                    largestMargin = {
                        value: margin.toFixed(2),
                        winner: s1 > s2 ? t1 : t2,
                        loser: s1 > s2 ? t2 : t1,
                        week: weekNum,
                        season
                    };
                }

                // Smallest Margin
                if (margin < smallestMargin.value && margin >= 0) {
                    smallestMargin = {
                        value: margin.toFixed(2),
                        winner: s1 > s2 ? t1 : t2,
                        loser: s1 > s2 ? t2 : t1,
                        week: weekNum,
                        season
                    };
                }
            });
        });

        // End of Season: Check Most/Fewest Points
        Object.entries(seasonPoints).forEach(([team, points]) => {
            if (points > mostPointsSeason.value) {
                mostPointsSeason = { value: points.toFixed(2), team, season };
            }
            if (points < fewestPointsSeason.value && points > 0) {
                fewestPointsSeason = { value: points.toFixed(2), team, season };
            }
        });

        // End of Season: store chart trends (playoff inclusi)
        chartTeamPoints[season] = { ...chartSeasonTeamPts };
        chartPlayerTotals[season] = seasonPlayerTotal;
        chartPlayerTotalsStarters[season] = seasonPlayerTotalStarters;
        chartRolePoints[season] = seasonRolePoints;
        chartRolePointsStarters[season] = seasonRolePointsStarters;
        chartGiornate[season] = playedWeeks;

        // End of Season: Check single-season player/defense records
        Object.entries(playerSeasonStats).forEach(([key, acc]) => {
            const [team, player] = key.split('||');
            STAT_CATS.forEach(c => {
                if (acc[c.key] > perSeasonLeaders[c.key].value) {
                    perSeasonLeaders[c.key] = { value: acc[c.key], player, team, season };
                }
            });
        });
    });

    // Career leaders (tutte le stagioni)
    Object.entries(playerCareerStats).forEach(([player, c]) => {
        STAT_CATS.forEach(cat => {
            if (c[cat.key] > perCareerLeaders[cat.key].value) {
                perCareerLeaders[cat.key] = { value: c[cat.key], player, team: c.team };
            }
        });
    });

    // Top 5 all-time (career). `pos` filtra per ruolo (TE, K, punti per ruolo);
    // `valueFn` permette totali derivati (es. TD complessivi).
    const top5By = ({ key, pos, valueFn } = {}) => Object.entries(playerCareerStats)
        .filter(([, c]) => !pos || c.pos === pos)
        .map(([player, c]) => ({
            player, team: c.team,
            value: valueFn ? valueFn(c) : c[key],
        }))
        .filter(r => r.value > 0)
        .sort((a, b) => b.value - a.value)
        .slice(0, 5);

    const allTd = (c) => c.rushTd + c.passTd + c.recTd + c.defTd;

    const top5 = {
        passYds: top5By({ key: 'passYds' }),
        rushYds: top5By({ key: 'rushYds' }),
        recYds: top5By({ key: 'recYds' }),
        passTd: top5By({ key: 'passTd' }),
        rushTd: top5By({ key: 'rushTd' }),
        recTd: top5By({ key: 'recTd' }),
        defTd: top5By({ key: 'defTd' }),
        totalTd: top5By({ valueFn: allTd }),

        // Tight end e kicker
        teRecYds: top5By({ key: 'recYds', pos: 'TE' }),
        teRecTd: top5By({ key: 'recTd', pos: 'TE' }),
        kFg: top5By({ key: 'fgMade', pos: 'K' }),
        kPat: top5By({ key: 'patMade', pos: 'K' }),

        // Punti fantasy di carriera, per ruolo
        ptsQB: top5By({ key: 'pts', pos: 'QB' }),
        ptsRB: top5By({ key: 'pts', pos: 'RB' }),
        ptsWR: top5By({ key: 'pts', pos: 'WR' }),
        ptsTE: top5By({ key: 'pts', pos: 'TE' }),
        ptsK: top5By({ key: 'pts', pos: 'K' }),
        ptsDEF: top5By({ key: 'pts', pos: 'DEF' }),
    };

    return {
        seasonsCount: Object.keys(allSeasons).length,
        totalGames,
        totalPoints: totalPoints.toFixed(2),
        recordLeaders: { game: perGameLeaders, season: perSeasonLeaders, career: perCareerLeaders },
        statCats: STAT_CATS,
        top5,
        highestScore,
        lowestScore,
        largestMargin,
        smallestMargin,
        mostPointsSeason,
        fewestPointsSeason,
        maxWinStreak,
        maxLossStreak,
        chartData: {
            teamPoints: chartTeamPoints,
            playerTotals: chartPlayerTotals,
            playerTotalsStarters: chartPlayerTotalsStarters,
            rolePoints: chartRolePoints,
            rolePointsStarters: chartRolePointsStarters,
            giornate: chartGiornate,
        },
        teamRecords,
        headToHead
    };
}

function updateStreak(team, result, currentStreaks, season, week) {
    if (currentStreaks[team].type === result) {
        currentStreaks[team].count++;
        currentStreaks[team].end = `W${week}, ${season}`;
    } else {
        currentStreaks[team].type = result;
        currentStreaks[team].count = 1;
        currentStreaks[team].start = `W${week}, ${season}`;
        currentStreaks[team].end = `W${week}, ${season}`;
    }
}

function checkMaxStreak(team, current, maxWin, maxLoss) {
    if (current.type === 'W' && current.count > maxWin.value) {
        maxWin.value = current.count;
        maxWin.team = team;
        maxWin.start = current.start;
        maxWin.end = current.end;
    }
    if (current.type === 'L' && current.count > maxLoss.value) {
        maxLoss.value = current.count;
        maxLoss.team = team;
        maxLoss.start = current.start;
        maxLoss.end = current.end;
    }
}

// Finds which team(s) hold the max and min of a stat key; ties are joined with " / "
function extremesBy(teamRecords, key) {
    const entries = Object.entries(teamRecords);
    if (!entries.length) return null;
    const values = entries.map(([, r]) => r[key] || 0);
    const maxVal = Math.max(...values);
    const minVal = Math.min(...values);
    const holders = (v) => entries.filter(([, r]) => (r[key] || 0) === v).map(([name]) => displayName(name)).join(' / ');
    return {
        max: { value: maxVal, teams: holders(maxVal) },
        min: { value: minVal, teams: holders(minVal) }
    };
}

function renderStats(stats) {
    renderSummary(stats);
    renderRecords(stats);
    renderTeamPanels(stats);
    renderCharts(stats);
}

function renderSummary(stats) {
    const el = document.getElementById('stats-summary');
    if (!el) return;

    const avgPerTeam = (stats.totalPoints / (stats.totalGames * 2)).toFixed(1);
    const compactPoints = (stats.totalPoints / 1000).toFixed(1) + 'k';

    el.innerHTML = `
        ${summaryStat(stats.seasonsCount, 'Seasons', false, 0)}
        ${summaryStat(stats.totalGames, 'Total Games', false, 80)}
        ${summaryStat(compactPoints, 'Total Points', true, 160)}
        ${summaryStat(avgPerTeam, 'Avg Points / Team / Game', false, 240)}
    `;
}

function summaryStat(value, label, accent, delay) {
    return `
    <div class="summary-stat${accent ? ' summary-stat--accent' : ''}" style="animation-delay:${delay}ms">
        <div class="summary-stat-value">${value}</div>
        <div class="summary-stat-label">${label}</div>
    </div>`;
}

function renderRecords(stats) {
    const el = document.getElementById('records-block');
    if (!el) return;

    const h = stats.highestScore;
    const l = stats.lowestScore;
    const m = stats.largestMargin;
    const sm = stats.smallestMargin;
    const mp = stats.mostPointsSeason;
    const fp = stats.fewestPointsSeason;
    const ws = stats.maxWinStreak;
    const ls = stats.maxLossStreak;
    const titles = extremesBy(stats.teamRecords, 'sbWins');
    const wins = extremesBy(stats.teamRecords, 'w');

    const teamTiles = [
        recordTile(h.value, 'Highest Score', `${displayName(h.team)} — W${h.week}, ${h.season}`),
        recordTile(l.value, 'Lowest Score', `${displayName(l.team)} — W${l.week}, ${l.season}`),
        recordTile(m.value, 'Largest Margin', `${displayName(m.winner)} def. ${displayName(m.loser)} — W${m.week}, ${m.season}`),
        recordTile(sm.value, 'Smallest Margin', `${displayName(sm.winner)} def. ${displayName(sm.loser)} — W${sm.week}, ${sm.season}`),
        recordTile(parseFloat(mp.value).toLocaleString('en-US'), 'Most Points (Season)', `${displayName(mp.team)} — ${mp.season}`),
        recordTile(parseFloat(fp.value).toLocaleString('en-US'), 'Fewest Points (Season)', `${displayName(fp.team)} — ${fp.season}`),
        recordTile(ws.value, 'Longest Win Streak', `${displayName(ws.team)} — ${ws.start} → ${ws.end}`),
        recordTile(ls.value, 'Longest Loss Streak', `${displayName(ls.team)} — ${ls.start} → ${ls.end}`),
        titles ? recordTile(titles.max.value, 'Most Championships', titles.max.teams) : '',
        titles ? recordTile(titles.min.value, 'Fewest Championships', titles.min.teams) : '',
        wins ? recordTile(wins.max.value, 'Most Wins All-Time', wins.max.teams) : '',
        wins ? recordTile(wins.min.value, 'Fewest Wins All-Time', wins.min.teams) : ''
    ];

    const leaders = stats.recordLeaders[recordMode];
    const playerTiles = stats.statCats.map(cat => {
        const r = leaders[cat.key];
        if (!r.value) return '';
        const value = cat.decimals
            ? r.value.toLocaleString('en-US', { maximumFractionDigits: cat.decimals })
            : r.value.toLocaleString('en-US');
        const holder = recordMode === 'game'
            ? `${r.player} — ${displayName(r.team)}, W${r.week} ${r.season}`
            : recordMode === 'season'
                ? `${r.player} — ${displayName(r.team)}, ${r.season}`
                : `${r.player} — ${displayName(r.team)}`;
        return recordTile(value, `Most ${cat.label}`, holder);
    });

    el.innerHTML = `
        <h2 class="records-title">League Records</h2>
        <div class="record-tiles">${teamTiles.join('')}</div>

        <div class="st-records-divider"></div>

        <div class="an-avg-toggle st-record-mode-toggle">
            <button class="an-avg-pill st-record-mode-pill${recordMode === 'game' ? ' active' : ''}" data-record-mode="game">Per Game</button>
            <button class="an-avg-pill st-record-mode-pill${recordMode === 'season' ? ' active' : ''}" data-record-mode="season">Per Season</button>
            <button class="an-avg-pill st-record-mode-pill${recordMode === 'career' ? ' active' : ''}" data-record-mode="career">Per Career</button>
        </div>
        <div class="record-tiles">${playerTiles.join('')}</div>

        <h2 class="records-title st-leader-title">Top 5 All-Time</h2>
        <h3 class="an-sub-title st-leader-sub">Career Fantasy Stats by Position</h3>
        <div class="st-leader-grid">
            ${leaderPanel('Passing Yards — QB', stats.top5.passYds)}
            ${leaderPanel('Rushing Yards — RB', stats.top5.rushYds)}
            ${leaderPanel('Receiving Yards — WR', stats.top5.recYds)}
            ${leaderPanel('Receiving Yards — TE', stats.top5.teRecYds)}
        </div>
        <div class="st-leader-grid">
            ${leaderPanel('Passing TDs', stats.top5.passTd)}
            ${leaderPanel('Rushing TDs', stats.top5.rushTd)}
            ${leaderPanel('Receiving TDs', stats.top5.recTd)}
            ${leaderPanel('Receiving TDs — TE', stats.top5.teRecTd)}
        </div>
        <div class="st-leader-grid">
            ${leaderPanel('Total TDs', stats.top5.totalTd)}
            ${leaderPanel('Defensive TDs', stats.top5.defTd)}
            ${leaderPanel('Field Goals — K', stats.top5.kFg)}
            ${leaderPanel('Extra Points — K', stats.top5.kPat)}
        </div>

        <h3 class="an-sub-title st-leader-sub">Career Fantasy Points by Position</h3>
        <div class="st-leader-grid st-leader-grid--3">
            ${leaderPanel('QB', stats.top5.ptsQB, 1)}
            ${leaderPanel('RB', stats.top5.ptsRB, 1)}
            ${leaderPanel('WR', stats.top5.ptsWR, 1)}
            ${leaderPanel('TE', stats.top5.ptsTE, 1)}
            ${leaderPanel('K', stats.top5.ptsK, 1)}
            ${leaderPanel('DEF', stats.top5.ptsDEF, 1)}
        </div>
    `;

    bindRecordModeToggle();
}

function recordTile(value, label, holder) {
    return `
    <div class="record-tile">
        <div class="record-tile-value">${value}</div>
        <div class="record-tile-label">${label}</div>
        ${holder ? `<div class="record-tile-holder">${holder}</div>` : ''}
    </div>`;
}

function leaderPanel(title, rows, decimals = 0) {
    if (!rows.length) return `<div class="st-leader-panel"><div class="st-leader-panel-title">${title}</div></div>`;
    const fmtVal = (v) => v.toLocaleString('en-US', {
        minimumFractionDigits: decimals, maximumFractionDigits: decimals,
    });
    return `
    <div class="st-leader-panel">
        <div class="st-leader-panel-title">${title}</div>
        ${rows.map((r, i) => `
        <div class="st-leader-row${i === 0 ? ' st-leader-row--top' : ''}">
            <span class="st-leader-rank">${i + 1}</span>
            <span class="st-leader-name">${r.player}<span class="st-leader-team">${displayName(r.team)}</span></span>
            <span class="st-leader-value">${fmtVal(r.value)}</span>
        </div>`).join('')}
    </div>`;
}

function bindRecordModeToggle() {
    if (recordsListenerBound) return;
    recordsListenerBound = true;
    const el = document.getElementById('records-block');
    if (!el) return;
    el.addEventListener('click', (e) => {
        const btn = e.target.closest('.st-record-mode-pill');
        if (!btn) return;
        recordMode = btn.dataset.recordMode;
        if (statsCache) renderRecords(statsCache);
    });
}

function renderTeamPanels(stats) {
    const el = document.getElementById('teams-alltime-block');
    if (!el) return;

    const entries = Object.entries(stats.teamRecords)
        .sort(([, a], [, b]) => b.sbWins - a.sbWins || b.w - a.w);

    const maxTitles = entries.length ? entries[0][1].sbWins : 0;

    // Best-in-league value per ministat (used to gold-highlight the top team)
    const best = {
        pf: Math.max(...entries.map(([, r]) => r.pf)),
        pa: Math.min(...entries.map(([, r]) => r.pa)),
        playoffWins: Math.max(...entries.map(([, r]) => r.playoffWins || 0)),
        sbApps: Math.max(...entries.map(([, r]) => r.sbApps || 0)),
        sbWins: Math.max(...entries.map(([, r]) => r.sbWins || 0)),
        pct: Math.max(...entries.map(([, r]) => r.w / (r.w + r.l || 1))),
        apW: Math.max(...entries.map(([, r]) => r.apW || 0)),
        rushTD: Math.max(...entries.map(([, r]) => r.rushTD || 0)),
        passTD: Math.max(...entries.map(([, r]) => r.passTD || 0)),
        recTD: Math.max(...entries.map(([, r]) => r.recTD || 0)),
        defTD: Math.max(...entries.map(([, r]) => r.defTD || 0)),
        rushYds: Math.max(...entries.map(([, r]) => r.rushYds || 0)),
        passYds: Math.max(...entries.map(([, r]) => r.passYds || 0)),
        recYds: Math.max(...entries.map(([, r]) => r.recYds || 0))
    };

    const panels = entries.map(([name, r], i) => {
        const disp = displayName(name);
        const logo = TEAM_LOGOS[disp] || 'images/nfl_logo.png';
        const winFrac = r.w / (r.w + r.l || 1);
        const pct = (winFrac * 100).toFixed(1);
        const isChamp = maxTitles > 0 && r.sbWins === maxTitles;

        const pills = Object.entries(stats.headToHead[name] || {})
            .filter(([, rec]) => rec.w + rec.l + rec.t > 0)
            .map(([opp, rec]) => {
                const mod = rec.w > rec.l ? ' h2h-pill--win' : rec.l > rec.w ? ' h2h-pill--loss' : '';
                const tie = rec.t > 0 ? `–${rec.t}` : '';
                return `<span class="h2h-pill${mod}">vs ${displayName(opp)} <b class="h2h-pill-w">${rec.w}</b>–<b class="h2h-pill-l">${rec.l}</b>${tie}</span>`;
            }).join('');

        return `
        <div class="team-alltime-panel${isChamp ? ' team-alltime-panel--champ' : ''}" style="animation-delay:${i * 100}ms">
            <div class="team-alltime-header">
                <img class="team-alltime-logo" src="${logo}" alt="${disp}">
                <span class="team-alltime-name">${disp}</span>
                ${r.sbWins > 0 ? `<span class="team-alltime-titles">${r.sbWins}× Champion</span>` : ''}
            </div>
            <div class="team-alltime-hero">
                <span class="team-alltime-record${winFrac === best.pct ? ' stat-best' : ''}">${r.w}–${r.l}${r.t > 0 ? `–${r.t}` : ''}</span>
                <span class="team-alltime-pct">${pct}%</span>
                <span class="team-alltime-ap" title="Record giocando ogni giornata contro tutte le altre">
                    ${apRecord(r)}<small>all-play</small>
                </span>
            </div>
            <div class="team-alltime-hero-label">Regular Season Record</div>
            <div class="team-alltime-ministats">
                ${ministat(r.pf.toFixed(0), 'Points For', r.pf === best.pf)}
                ${ministat(r.pa.toFixed(0), 'Points Against', r.pa === best.pa)}
                ${ministat(`${r.playoffWins || 0}<small class="ministat-of">/${r.playoffGames || 0}</small>`,
        'Playoff Wins', (r.playoffWins || 0) === best.playoffWins && best.playoffWins > 0)}
                ${ministat(r.sbApps || 0, 'SB Apps', (r.sbApps || 0) === best.sbApps && best.sbApps > 0)}
                ${ministat(r.sbWins || 0, 'Titles', (r.sbWins || 0) === best.sbWins && best.sbWins > 0)}
            </div>
            <div class="team-alltime-ministats team-alltime-ministats--td">
                ${ministat(r.rushTD || 0, 'Rush TDs', (r.rushTD || 0) === best.rushTD && best.rushTD > 0)}
                ${ministat(r.passTD || 0, 'Pass TDs', (r.passTD || 0) === best.passTD && best.passTD > 0)}
                ${ministat(r.recTD || 0, 'Rec TDs', (r.recTD || 0) === best.recTD && best.recTD > 0)}
                ${ministat(r.defTD || 0, 'Def TDs', (r.defTD || 0) === best.defTD && best.defTD > 0)}
            </div>
            <div class="team-alltime-ministats team-alltime-ministats--td">
                ${ministat((r.rushYds || 0).toLocaleString('en-US'), 'Rush Yds', (r.rushYds || 0) === best.rushYds && best.rushYds > 0)}
                ${ministat((r.passYds || 0).toLocaleString('en-US'), 'Pass Yds', (r.passYds || 0) === best.passYds && best.passYds > 0)}
                ${ministat((r.recYds || 0).toLocaleString('en-US'), 'Rec Yds', (r.recYds || 0) === best.recYds && best.recYds > 0)}
            </div>
            ${recTdSplit(r.recTDByPos)}
            <div class="team-h2h-row">${pills}</div>
        </div>`;
    }).join('');

    el.innerHTML = `
        <h2 class="records-title">All-Time Teams</h2>
        <div class="team-alltime-grid">${panels}</div>
    `;
}

/**
 * Record all-play: quanto avrebbe fatto giocando ogni giornata contro tutti.
 * Sono conteggi, quindi niente decimali — a meno che un pareggio non abbia
 * lasciato un mezzo punto.
 */
function apRecord(r) {
    const n = (v) => (Number.isInteger(v) ? String(v) : String(Math.round(v * 10) / 10));
    return `${n(r.apW || 0)}–${n(r.apL || 0)}`;
}

function ministat(value, label, isBest) {
    return `
    <div class="ministat">
        <div class="ministat-value${isBest ? ' stat-best' : ''}">${value}</div>
        <div class="ministat-label">${label}</div>
    </div>`;
}

function recTdSplit(byPos) {
    const wr = byPos?.WR || 0;
    const rb = byPos?.RB || 0;
    const te = byPos?.TE || 0;
    const total = wr + rb + te;
    if (total === 0) return '';

    const wrPct = (wr / total) * 100;
    const rbPct = (rb / total) * 100;
    const tePct = (te / total) * 100;

    return `
    <div class="team-tdsplit">
        <div class="team-tdsplit-label">Receiving TDs by Position</div>
        <div class="team-tdsplit-bar">
            <span class="team-tdsplit-wr" style="width:${wrPct.toFixed(1)}%"></span>
            <span class="team-tdsplit-rb" style="width:${rbPct.toFixed(1)}%"></span>
            <span class="team-tdsplit-te" style="width:${tePct.toFixed(1)}%"></span>
        </div>
        <div class="team-tdsplit-legend">
            <span><i class="team-tdsplit-dot team-tdsplit-dot--wr"></i>WR ${wrPct.toFixed(0)}%</span>
            <span><i class="team-tdsplit-dot team-tdsplit-dot--rb"></i>RB ${rbPct.toFixed(0)}%</span>
            <span><i class="team-tdsplit-dot team-tdsplit-dot--te"></i>TE ${tePct.toFixed(0)}%</span>
        </div>
    </div>`;
}

/* ============================================================
   TRENDS — grafici per stagione (riusa le classi chart an-*)
   ============================================================ */

// Colori serie: identità team schiarite per il fondo nero (come in Analysis)
const CHART_COLORS_BY_KEY = { capi: '#FF6600', lasers: '#D4AF37', oscurus: '#d4506a', sommo: '#4fa3b8' };
// Colori ruolo (6 serie: direct labels + legenda obbligatorie)
const ROLE_COLORS = { QB: '#f87171', RB: '#4f8cff', WR: '#22c55e', TE: '#f59e0b', K: '#a855f7', DEF: '#9ca3af' };

function teamChartColor(rawName) {
    const key = TEAM_KEYS[displayName(rawName)];
    return CHART_COLORS_BY_KEY[key] || '#888';
}

function legendOf(series) {
    return `
    <div class="an-chart-legend">
        ${series.map(s => `<span class="an-legend-item"><span class="an-legend-key" style="background:${s.color}"></span>${s.name}</span>`).join('')}
    </div>`;
}

// Grafici "Total Player Production" + "Player Production by Role" — reattivi al toggle Tutti/Solo Titolari
function renderPlayerProdCharts() {
    const el = document.getElementById('player-trend-charts');
    if (!el || !statsCache?.chartData || !chartMarkersCache) return;

    const { rolePoints, rolePointsStarters, playerTotals, playerTotalsStarters } = statsCache.chartData;
    const totals = playerViewMode === 'starters' ? playerTotalsStarters : playerTotals;
    const roleTotals = playerViewMode === 'starters' ? rolePointsStarters : rolePoints;
    const seasons = Object.keys(playerTotals).sort();

    const prodSeries = [{
        name: 'All Players',
        color: '#d4665e',
        values: seasons.map(s => ({ x: s, y: totals[s] || 0 })),
    }];

    const roles = Object.keys(ROLE_COLORS).filter(r => seasons.some(s => (roleTotals[s] || {})[r] > 0));
    const roleSeries = roles.map(role => ({
        name: role,
        color: ROLE_COLORS[role],
        values: seasons.map(s => ({ x: s, y: (roleTotals[s] || {})[role] || 0 })),
    }));

    el.innerHTML = `
        <h3 class="an-sub-title">Total Player Production by Season</h3>
        <div class="an-chart st-trend-chart">${buildSeasonLineChart(prodSeries, chartMarkersCache)}<div class="an-chart-tooltip" hidden></div></div>
        <p class="an-footnote">Sum of every player's fantasy points across the whole league, season by season.</p>

        <h3 class="an-sub-title">Player Production by Role</h3>
        ${legendOf(roleSeries)}
        <div class="an-chart st-trend-chart">${buildSeasonLineChart(roleSeries, chartMarkersCache)}<div class="an-chart-tooltip" hidden></div></div>
        <p class="an-footnote">${playerViewMode === 'starters' ? 'Starters only.' : 'Player production includes bench points.'}</p>
    `;
    el.querySelectorAll('.st-trend-chart').forEach(bindSeasonChart);
}

function bindPlayerViewToggle() {
    if (chartsListenerBound) return;
    chartsListenerBound = true;
    const el = document.getElementById('charts-block');
    if (!el) return;
    el.addEventListener('click', (e) => {
        const btn = e.target.closest('.st-player-mode-pill');
        if (!btn) return;
        playerViewMode = btn.dataset.playerMode;
        btn.parentElement.querySelectorAll('.st-player-mode-pill').forEach(b => b.classList.toggle('active', b === btn));
        renderPlayerProdCharts();
        if (byRoleCache && byRoleStartersCache) renderRoleDistChart();
    });
}

function renderRoleDistChart() {
    const roleDist = document.getElementById('charts-role-dist');
    if (!roleDist) return;
    const byRole = playerViewMode === 'starters' ? byRoleStartersCache : byRoleCache;
    roleDist.innerHTML = `
        <h3 class="an-sub-title">Weekly scores by position</h3>
        <div class="an-chart">${buildRoleDistribution(byRole)}</div>
        <p class="an-footnote">Each dot is a weekly performance (${playerViewMode === 'starters' ? 'starters only' : 'starters and bench'}, all seasons). The band is ±1 standard deviation around the average (vertical line).</p>
    `;
}

function renderCharts(stats) {
    const el = document.getElementById('charts-block');
    if (!el || !stats.chartData) return;

    const { teamPoints, giornate } = stats.chartData;
    const seasons = Object.keys(teamPoints).sort();
    if (seasons.length < 2) { el.innerHTML = ''; return; }

    // Marker verticali dove cambia il numero di giornate giocate (playoff inclusi)
    const markers = [];
    for (let i = 1; i < seasons.length; i++) {
        const prev = giornate[seasons[i - 1]] || 0;
        const cur = giornate[seasons[i]] || 0;
        const diff = cur - prev;
        if (diff !== 0) {
            markers.push({
                x: seasons[i],
                label: `${diff > 0 ? '+' : '−'}${Math.abs(diff)} week${Math.abs(diff) === 1 ? '' : 's'}`,
            });
        }
    }
    chartMarkersCache = markers;

    // 1) Punti totali per team nelle stagioni
    const teamNames = [...new Set(seasons.flatMap(s => Object.keys(teamPoints[s])))];
    const teamSeries = teamNames.map(raw => ({
        name: displayName(raw),
        color: teamChartColor(raw),
        values: seasons.filter(s => teamPoints[s][raw] !== undefined)
            .map(s => ({ x: s, y: teamPoints[s][raw] })),
    })).filter(s => s.values.length > 0);

    el.innerHTML = `
        <h2 class="records-title">Trends</h2>

        <h2 class="an-sub-title" style="font-size:1.4rem; text-transform:none; letter-spacing:0; margin-top:8px;">Team Trends</h2>
        <p class="st-block-desc">The 4 teams' scores season by season: how they perform on the field, how consistent their scoring is, and how their management choices (draft, market, bench) hold up over time.</p>

        <h3 class="an-sub-title">Team Points by Season</h3>
        ${legendOf(teamSeries)}
        <div class="an-chart st-trend-chart">${buildSeasonLineChart(teamSeries, markers)}<div class="an-chart-tooltip" hidden></div></div>
        <p class="an-footnote">Playoffs and Super Bowl included. Dashed lines mark seasons where the number of weeks changed.</p>

        <div id="charts-team-rest">
            <div class="loading-state"><div class="spinner"></div><p>Loading...</p></div>
        </div>

        <h2 class="an-sub-title" style="font-size:1.4rem; text-transform:none; letter-spacing:0; margin-top:56px;">Player Trends</h2>
        <p class="st-block-desc">How many points the league's players produce overall each year, and how they split across positions (QB, RB, WR, TE, K, DEF).</p>

        <div class="an-avg-toggle st-player-mode-toggle">
            <button class="an-avg-pill st-player-mode-pill${playerViewMode === 'all' ? ' active' : ''}" data-player-mode="all">All</button>
            <button class="an-avg-pill st-player-mode-pill${playerViewMode === 'starters' ? ' active' : ''}" data-player-mode="starters">Starters Only</button>
        </div>
        <div id="player-trend-charts"></div>

        <div id="charts-role-dist">
            <div class="loading-state"><div class="spinner"></div><p>Caricamento...</p></div>
        </div>

        <div id="charts-draft-section">
            <div class="loading-state"><div class="spinner"></div><p>Caricamento...</p></div>
        </div>
    `;

    el.querySelectorAll('.st-trend-chart').forEach(bindSeasonChart);
    renderPlayerProdCharts();
    bindPlayerViewToggle();

    // Grafici che richiedono il modello di Analysis (draft + roster per settimana)
    renderAdvancedCharts(markers).catch(e => {
        console.error('Advanced charts error:', e);
        const teamRest = document.getElementById('charts-team-rest');
        if (teamRest) teamRest.innerHTML = '';
        const roleDist = document.getElementById('charts-role-dist');
        if (roleDist) roleDist.innerHTML = '';
        const draftSection = document.getElementById('charts-draft-section');
        if (draftSection) draftSection.innerHTML = '';
    });
}

/* ---------- Grafici avanzati (draftata / innesti / panchina / costanza) ---------- */

async function renderAdvancedCharts(markers) {
    const teamRest = document.getElementById('charts-team-rest');
    const roleDist = document.getElementById('charts-role-dist');
    const draftSection = document.getElementById('charts-draft-section');
    if (!teamRest && !roleDist && !draftSection) return;

    // Costruisce (o recupera dalla cache) il modello Analysis per ogni stagione
    const models = {};
    for (const year of SEASONS) {
        try {
            const m = await buildSeasonModel(year);
            if (m) models[year] = m;
        } catch (e) { /* stagione senza dati: skip */ }
    }
    const seasons = Object.keys(models).sort();
    if (seasons.length < 2) {
        if (teamRest) teamRest.innerHTML = '';
        if (roleDist) roleDist.innerHTML = '';
        if (draftSection) draftSection.innerHTML = '';
        return;
    }

    const teamKeys = Object.keys(TEAMS); // capi, lasers, oscurus, sommo

    // Serie multi-team su una metrica (fn(model, teamKey) -> valore o null)
    const buildTeamMetric = (metricFn) => teamKeys.map(key => ({
        name: TEAMS[key].name,
        color: CHART_COLORS_BY_KEY[key] || '#888',
        values: seasons
            .map(s => ({ x: s, y: metricFn(models[s], key) }))
            .filter(v => v.y !== null && v.y !== undefined),
    })).filter(s => s.values.length > 0);

    // 1) Punti squadra draftata
    const draftedSeries = buildTeamMetric((m, k) => pointsComparison(m, k).drafted);

    // 2) Punti dagli innesti (somma punti "qui" degli acquisti in-season)
    const pickupSeries = buildTeamMetric((m, k) => {
        const { additions } = marketView(m, k);
        return additions.reduce((s, a) => s + a.agg.pts, 0);
    });

    // 3) Punti lasciati in panchina (ottimale − reale)
    const benchSeries = buildTeamMetric((m, k) => pointsComparison(m, k).benchLost);

    // 4) Costanza dei punteggi su tutte le stagioni (range min–mediana–max per team)
    const distRows = teamKeys.map(key => {
        const scores = [];
        for (const s of seasons) {
            for (const tw of Object.values(models[s].teamWeeks[key] || {})) scores.push(tw.score);
        }
        if (!scores.length) return null;
        const sorted = scores.sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
        return { name: TEAMS[key].name, color: CHART_COLORS_BY_KEY[key] || '#888', min: sorted[0], median, max: sorted[sorted.length - 1] };
    }).filter(Boolean);

    // 5) Draft: Value per Pick su tutte le stagioni insieme, con la media per numero di pick
    const draftPoints = [];
    for (const year of seasons) {
        const m = models[year];
        for (const key of teamKeys) {
            const raw = Object.keys(m.draft?.teams || {}).find(r => rawKeyMatches(m, r, key));
            if (!raw) continue;
            for (const pick of m.draft.teams[raw] || []) {
                const rec = m.players.get(pick.name);
                let pts = 0;
                if (rec) for (const w of Object.values(rec.weeks)) if (w.teamKey === key) pts += w.pts;
                draftPoints.push({ year, pick: pick.pick, name: pick.name, position: pick.position, teamName: TEAMS[key].name, color: CHART_COLORS_BY_KEY[key] || '#888', pts });
            }
        }
    }

    // 6) Distribuzione punteggi per ruolo (titolari + panchina, tutte le stagioni) — anche solo titolari
    const byRole = {};
    const byRoleStarters = {};
    for (const s of seasons) {
        for (const rec of models[s].players.values()) {
            const role = rec.position;
            if (!ROLE_COLORS[role]) continue;
            (byRole[role] ||= []);
            (byRoleStarters[role] ||= []);
            for (const w of Object.values(rec.weeks)) {
                byRole[role].push(w.pts);
                if (w.started) byRoleStarters[role].push(w.pts);
            }
        }
    }
    byRoleCache = byRole;
    byRoleStartersCache = byRoleStarters;

    // 7) Margine di vittoria/sconfitta per team (media + varianza), da tutti i matchup
    const teamMarginStats = {}; // key -> { wins: [margini], losses: [margini] }
    for (const year of seasons) {
        let data;
        try { data = await fetchFantasyData(year); } catch (e) { continue; }
        if (!data?.weeks) continue;
        for (const wkData of Object.values(data.weeks)) {
            for (const m of wkData.matchups || []) {
                if (!m.team1 || !m.team2) continue;
                const s1 = parseFloat(m.team1.score || 0);
                const s2 = parseFloat(m.team2.score || 0);
                if (s1 === 0 && s2 === 0) continue;
                if (s1 === s2) continue; // pareggio: nessun vincitore/perdente
                const margin = Math.abs(s1 - s2);
                const winnerRaw = s1 > s2 ? m.team1.name : m.team2.name;
                const loserRaw = s1 > s2 ? m.team2.name : m.team1.name;
                const wKey = TEAM_KEYS[displayName(winnerRaw)];
                const lKey = TEAM_KEYS[displayName(loserRaw)];
                if (wKey) (teamMarginStats[wKey] ||= { wins: [], losses: [] }).wins.push(margin);
                if (lKey) (teamMarginStats[lKey] ||= { wins: [], losses: [] }).losses.push(margin);
            }
        }
    }

    if (teamRest) {
        teamRest.innerHTML = `
            <h3 class="an-sub-title">Scoring Consistency (all seasons)</h3>
            ${buildConsistencyChart(distRows)}

            <h3 class="an-sub-title">Drafted Team Points by Season</h3>
            ${legendOf(draftedSeries)}
            <div class="an-chart st-trend-chart">${buildSeasonLineChart(draftedSeries, markers)}<div class="an-chart-tooltip" hidden></div></div>
            <p class="an-footnote">Total points scored by the players picked at the draft that season, whether they stayed on the roster or not.</p>

            <h3 class="an-sub-title">In-Season Pickup Points by Season</h3>
            ${legendOf(pickupSeries)}
            <div class="an-chart st-trend-chart">${buildSeasonLineChart(pickupSeries, markers)}<div class="an-chart-tooltip" hidden></div></div>
            <p class="an-footnote">Points scored on this roster by players added off the waiver wire during the season, not from the draft.</p>

            <h3 class="an-sub-title">Points Left on the Bench by Season</h3>
            ${legendOf(benchSeries)}
            <div class="an-chart st-trend-chart">${buildSeasonLineChart(benchSeries, markers)}<div class="an-chart-tooltip" hidden></div></div>
            <p class="an-footnote">Optimal lineup points minus what was actually started, added up across the season.</p>

            <h3 class="an-sub-title">Margin: Wins vs Losses</h3>
            <div class="an-chart">${buildMarginDotPlot(teamMarginStats)}</div>
            <p class="an-footnote">Each dot is a game: to the right (+) wins, to the left (−) losses, distance from 0 = margin. The vertical mark is the average, the band is ±1 standard deviation.</p>
        `;
        teamRest.querySelectorAll('.st-trend-chart').forEach(bindSeasonChart);
    }

    if (roleDist) renderRoleDistChart();

    if (draftSection) {
        draftSection.innerHTML = `
            <h2 class="an-sub-title" style="font-size:1.4rem; text-transform:none; letter-spacing:0; margin-top:56px;">Draft Trends</h2>
            <p class="st-block-desc">The value of every draft pick across all seasons: where the steals and busts land relative to the league average for that pick number.</p>

            <h3 class="an-sub-title">Draft: Value per Pick (All Years)</h3>
            <div class="an-chart-legend">
                <span class="an-legend-item"><span class="an-legend-key" style="background:#f5d576"></span>Average per pick</span>
            </div>
            <div class="an-chart" id="draft-scatter-all">${buildDraftScatterAll(draftPoints)}<div class="an-chart-tooltip" hidden></div></div>
            <p class="an-footnote">Each dot is a player drafted in a season, positioned by pick number and points scored for the team. The gold line is the average points for each pick number across all years.</p>
        `;
        const scatterAll = draftSection.querySelector('#draft-scatter-all');
        if (scatterAll) bindDraftScatterAll(scatterAll);
    }
}

// Confronta la chiave raw del draft con la chiave team (stessa logica di teamKeyFromRaw in analysis.js)
function rawKeyMatches(model, raw, teamKey) {
    return TEAM_KEYS[displayName(raw)] === teamKey;
}

// Range bar per team (min → max, tick sulla mediana) — riusa le classi .an-dist-*
function buildConsistencyChart(rows) {
    if (!rows.length) return '';
    const maxVal = Math.max(...rows.map(r => r.max), 1);
    return `
    <div class="an-dist-chart">
        ${rows.map(r => `
        <div class="an-dist-row">
            <span class="an-dist-name">${r.name}</span>
            <span class="an-dist-track">
                <span class="an-dist-range" style="left:${(r.min / maxVal * 100).toFixed(1)}%; width:${((r.max - r.min) / maxVal * 100).toFixed(1)}%; background:${r.color}"></span>
                <span class="an-dist-median" style="left:${(r.median / maxVal * 100).toFixed(1)}%"></span>
            </span>
            <span class="an-dist-values">
                <span class="an-dist-min">${Math.round(r.min)}</span>
                <span class="an-dist-med">${Math.round(r.median)}</span>
                <span class="an-dist-max">${Math.round(r.max)}</span>
            </span>
        </div>`).join('')}
    </div>
    <p class="an-footnote">Min–max range of weekly scores (all seasons, playoffs included); the vertical mark is the median. Shorter bar = more consistent team.</p>`;
}

/* ---------- Line chart per stagioni (SVG, x categorico = anni) ---------- */

const SLC = { w: 800, h: 300, l: 56, r: 96, t: 16, b: 30 };

function chartNiceTicks(min, max, count = 4) {
    const span = max - min || 1;
    const step = Math.pow(10, Math.floor(Math.log10(span / count)));
    const err = span / count / step;
    const mult = err >= 7.5 ? 10 : err >= 3.5 ? 5 : err >= 1.5 ? 2 : 1;
    const s = mult * step;
    const lo = Math.floor(min / s) * s;
    const hi = Math.ceil(max / s) * s;
    const ticks = [];
    for (let v = lo; v <= hi + 1e-9; v += s) ticks.push(v);
    return ticks;
}

function buildSeasonLineChart(series, markers = []) {
    const xs = [...new Set(series.flatMap(s => s.values.map(v => v.x)))].sort();
    const ys = series.flatMap(s => s.values.map(v => v.y));
    const ticks = chartNiceTicks(Math.min(...ys), Math.max(...ys));
    const yMin = ticks[0], yMax = ticks[ticks.length - 1];

    const plotW = SLC.w - SLC.l - SLC.r;
    const plotH = SLC.h - SLC.t - SLC.b;
    const x = (xv) => SLC.l + (xs.length > 1 ? (xs.indexOf(xv) / (xs.length - 1)) * plotW : plotW / 2);
    const y = (v) => SLC.t + (1 - (v - yMin) / (yMax - yMin || 1)) * plotH;

    const grid = ticks.map(v => `
        <line x1="${SLC.l}" y1="${y(v)}" x2="${SLC.l + plotW}" y2="${y(v)}" class="an-gridline"/>
        <text x="${SLC.l - 8}" y="${y(v) + 3}" class="an-tick" text-anchor="end">${parseInt(v).toLocaleString('en-US')}</text>`).join('');

    const xTicks = xs.map(xv =>
        `<text x="${x(xv)}" y="${SLC.h - 8}" class="an-tick" text-anchor="middle">${xv}</text>`).join('');

    // Linee verticali tratteggiate dove cambia il numero di giornate
    const vRules = markers.filter(mk => xs.includes(mk.x)).map(mk => `
        <line x1="${x(mk.x)}" y1="${SLC.t}" x2="${x(mk.x)}" y2="${SLC.t + plotH}" class="an-vrule"/>
        <text x="${x(mk.x) + 5}" y="${SLC.t + 10}" class="an-vrule-label">${mk.label}</text>`).join('');

    // Etichette di fine linea con anti-collisione verticale
    const ends = series.map(s => {
        const last = s.values[s.values.length - 1];
        return { s, lx: x(last.x), ly: y(last.y), labelY: y(last.y) };
    }).sort((a, b) => a.ly - b.ly);
    const MIN_GAP = 14;
    for (let i = 1; i < ends.length; i++) {
        if (ends[i].labelY - ends[i - 1].labelY < MIN_GAP) ends[i].labelY = ends[i - 1].labelY + MIN_GAP;
    }

    const lines = series.map(s => {
        const pts = s.values.map(v => `${x(v.x).toFixed(1)},${y(v.y).toFixed(1)}`).join(' ');
        return `<polyline points="${pts}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
    }).join('');

    // Marker su ogni punto dati (ring color superficie per leggibilità sugli incroci)
    const pointDots = series.map(s =>
        s.values.map(v =>
            `<circle cx="${x(v.x).toFixed(1)}" cy="${y(v.y).toFixed(1)}" r="3.5" fill="${s.color}" stroke="#000" stroke-width="1.5"/>`
        ).join('')
    ).join('');

    const endDots = ends.map(({ s, lx, ly, labelY }) => `
        ${Math.abs(labelY - ly) > 2 ? `<line x1="${lx + 5}" y1="${ly}" x2="${lx + 12}" y2="${labelY}" class="an-leader"/>` : ''}
        <circle cx="${lx}" cy="${ly}" r="4.5" fill="${s.color}" stroke="#000" stroke-width="2"/>
        ${series.length > 1 ? `<text x="${lx + 14}" y="${labelY + 3.5}" class="an-endlabel">${s.name}</text>` : ''}`).join('');

    const data = { xs, series: series.map(s => ({ name: s.name, color: s.color, values: s.values })) };
    const dataAttr = JSON.stringify(data).replace(/'/g, '&#39;');

    return `
    <svg viewBox="0 0 ${SLC.w} ${SLC.h}" class="an-svg" data-series='${dataAttr}'>
        ${grid}${xTicks}${vRules}${lines}${pointDots}${endDots}
        <line class="an-crosshair" x1="0" y1="${SLC.t}" x2="0" y2="${SLC.t + plotH}" visibility="hidden"/>
        <rect class="an-hit" x="${SLC.l}" y="${SLC.t}" width="${plotW}" height="${plotH}" fill="transparent"/>
    </svg>`;
}

function bindSeasonChart(container) {
    const svg = container.querySelector('svg');
    const tooltip = container.querySelector('.an-chart-tooltip');
    const crosshair = svg.querySelector('.an-crosshair');
    const hit = svg.querySelector('.an-hit');
    const data = JSON.parse(svg.dataset.series);
    const plotW = SLC.w - SLC.l - SLC.r;

    const xFor = (xv) => SLC.l + (data.xs.length > 1 ? (data.xs.indexOf(xv) / (data.xs.length - 1)) * plotW : plotW / 2);

    hit.addEventListener('pointermove', (e) => {
        const rect = svg.getBoundingClientRect();
        const scale = SLC.w / rect.width;
        const px = (e.clientX - rect.left) * scale;
        let nearest = data.xs[0], best = Infinity;
        for (const xv of data.xs) {
            const d = Math.abs(xFor(xv) - px);
            if (d < best) { best = d; nearest = xv; }
        }
        const cx = xFor(nearest);
        crosshair.setAttribute('x1', cx);
        crosshair.setAttribute('x2', cx);
        crosshair.setAttribute('visibility', 'visible');

        tooltip.replaceChildren();
        const title = document.createElement('div');
        title.className = 'an-tt-title';
        title.textContent = `Season ${nearest}`;
        tooltip.appendChild(title);
        const rows = data.series
            .map(s => ({ s, v: s.values.find(v => v.x === nearest) }))
            .filter(r => r.v)
            .sort((a, b) => b.v.y - a.v.y);
        for (const { s, v } of rows) {
            const row = document.createElement('div');
            row.className = 'an-tt-row';
            const key = document.createElement('span');
            key.className = 'an-tt-key';
            key.style.background = s.color;
            const val = document.createElement('b');
            val.textContent = Math.round(v.y).toLocaleString('en-US');
            const name = document.createElement('span');
            name.className = 'an-tt-name';
            name.textContent = s.name;
            row.append(key, val, name);
            tooltip.appendChild(row);
        }
        tooltip.hidden = false;

        const crect = container.getBoundingClientRect();
        let tx = e.clientX - crect.left + 14;
        const tw = tooltip.offsetWidth || 140;
        if (tx + tw > crect.width - 4) tx = e.clientX - crect.left - tw - 14;
        tooltip.style.left = `${tx}px`;
        tooltip.style.top = `${e.clientY - crect.top - 10}px`;
    });

    hit.addEventListener('pointerleave', () => {
        crosshair.setAttribute('visibility', 'hidden');
        tooltip.hidden = true;
    });
}

/* ---------- Draft: Value per Pick — tutte le stagioni + media per pick ---------- */

const DSC = { w: 800, h: 340, l: 48, r: 12, t: 16, b: 34 };
const fmtN = (n, dec = 0) => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });

function buildDraftScatterAll(points) {
    if (!points.length) return '<div class="empty-state"><p class="empty-state-text">No draft data available</p></div>';

    const maxPick = Math.max(...points.map(p => p.pick), 1);
    const maxPts = Math.max(...points.map(p => p.pts), 1);
    const yTicks = chartNiceTicks(0, maxPts);
    const yMax = yTicks[yTicks.length - 1];

    const plotW = DSC.w - DSC.l - DSC.r;
    const plotH = DSC.h - DSC.t - DSC.b;
    const x = pick => DSC.l + ((pick - 1) / Math.max(maxPick - 1, 1)) * plotW;
    const y = pts => DSC.t + (1 - pts / yMax) * plotH;

    const grid = yTicks.map(v => `
        <line x1="${DSC.l}" y1="${y(v)}" x2="${DSC.l + plotW}" y2="${y(v)}" class="an-gridline"/>
        <text x="${DSC.l - 8}" y="${y(v) + 3}" class="an-tick" text-anchor="end">${fmtN(v)}</text>`).join('');

    const xTickStep = maxPick > 20 ? 4 : 2;
    const xTicks = [];
    for (let p = 1; p <= maxPick; p += xTickStep) {
        xTicks.push(`<text x="${x(p)}" y="${DSC.h - 10}" class="an-tick" text-anchor="middle">${p}</text>`);
    }

    // Media punti per numero di pick, su tutte le stagioni
    const byPick = {};
    for (const p of points) { (byPick[p.pick] ||= []).push(p.pts); }
    const avgPoints = Object.keys(byPick).map(Number).sort((a, b) => a - b)
        .map(pick => ({ pick, avg: byPick[pick].reduce((s, v) => s + v, 0) / byPick[pick].length }));
    const avgLine = avgPoints.map(a => `${x(a.pick).toFixed(1)},${y(a.avg).toFixed(1)}`).join(' ');

    const dots = points.map(p => {
        const cx = x(p.pick), cy = y(p.pts);
        return `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="4" fill="${p.color}" stroke="#000" stroke-width="1.5" opacity="0.85"
            class="an-dot" data-name="${p.name}" data-pick="${p.pick}" data-year="${p.year}" data-team="${p.teamName}" data-pos="${p.position || ''}" data-pts="${p.pts.toFixed(1)}"/>`;
    }).join('');

    return `
    <svg viewBox="0 0 ${DSC.w} ${DSC.h}" class="an-svg">
        ${grid}${xTicks.join('')}${dots}
        <polyline points="${avgLine}" fill="none" stroke="#f5d576" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
    </svg>`;
}

function bindDraftScatterAll(container) {
    const svg = container.querySelector('svg');
    const tooltip = container.querySelector('.an-chart-tooltip');

    svg.addEventListener('pointermove', (e) => {
        const dot = e.target.closest('.an-dot');
        if (!dot) { tooltip.hidden = true; return; }
        tooltip.replaceChildren();
        const title = document.createElement('div');
        title.className = 'an-tt-title';
        title.textContent = `Pick #${dot.dataset.pick} — ${dot.dataset.year}`;
        const row = document.createElement('div');
        row.className = 'an-tt-row';
        const key = document.createElement('span');
        key.className = 'an-tt-key';
        key.style.background = dot.getAttribute('fill');
        const val = document.createElement('b');
        val.textContent = fmtN(Number(dot.dataset.pts), 1);
        const name = document.createElement('span');
        name.className = 'an-tt-name';
        name.textContent = `${dot.dataset.name} (${dot.dataset.pos}) — ${dot.dataset.team}`;
        row.append(key, val, name);
        tooltip.append(title, row);
        tooltip.hidden = false;

        const crect = container.getBoundingClientRect();
        let tx = e.clientX - crect.left + 14;
        const tw = tooltip.offsetWidth || 140;
        if (tx + tw > crect.width - 4) tx = e.clientX - crect.left - tw - 14;
        tooltip.style.left = `${tx}px`;
        tooltip.style.top = `${e.clientY - crect.top - 10}px`;
    });

    svg.addEventListener('pointerleave', () => { tooltip.hidden = true; });
}

/* ---------- Dot plot: distribuzione punteggi per ruolo (media + ±σ) ---------- */

const RDP = { w: 800, l: 52, r: 16, t: 14, b: 28, lane: 46 };

function buildRoleDistribution(byRole) {
    const roles = Object.keys(ROLE_COLORS).filter(r => (byRole[r] || []).length);
    if (!roles.length) return '<div class="empty-state"><p class="empty-state-text">No data available</p></div>';

    const allPts = roles.flatMap(r => byRole[r]);
    const maxPts = Math.max(...allPts, 1);
    const xTicks = chartNiceTicks(0, maxPts);
    const xMax = xTicks[xTicks.length - 1];

    const plotW = RDP.w - RDP.l - RDP.r;
    const h = RDP.t + RDP.b + roles.length * RDP.lane;
    const x = v => RDP.l + (v / xMax) * plotW;

    // Jitter deterministico
    let seed = 1;
    const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };

    const gridX = xTicks.map(v => `
        <line x1="${x(v)}" y1="${RDP.t}" x2="${x(v)}" y2="${RDP.t + roles.length * RDP.lane}" class="an-gridline"/>
        <text x="${x(v)}" y="${h - 8}" class="an-tick" text-anchor="middle">${Math.round(v)}</text>`).join('');

    const lanes = roles.map((role, ri) => {
        const pts = byRole[role];
        const n = pts.length;
        const mean = pts.reduce((a, b) => a + b, 0) / n;
        const variance = pts.reduce((a, b) => a + (b - mean) * (b - mean), 0) / n;
        const std = Math.sqrt(variance);
        const color = ROLE_COLORS[role];
        const cy = RDP.t + ri * RDP.lane + RDP.lane / 2;
        const jitH = RDP.lane * 0.62;

        const band = `<rect x="${x(Math.max(mean - std, 0)).toFixed(1)}" y="${(cy - jitH / 2).toFixed(1)}"
            width="${(x(mean + std) - x(Math.max(mean - std, 0))).toFixed(1)}" height="${jitH.toFixed(1)}"
            fill="${color}" opacity="0.12" rx="3"/>`;

        const dots = pts.map(p => {
            const dy = cy + (rnd() - 0.5) * jitH;
            return `<circle cx="${x(p).toFixed(1)}" cy="${dy.toFixed(1)}" r="2" fill="${color}" opacity="0.35"/>`;
        }).join('');

        const meanLine = `<line x1="${x(mean).toFixed(1)}" y1="${(cy - jitH / 2 - 3).toFixed(1)}" x2="${x(mean).toFixed(1)}" y2="${(cy + jitH / 2 + 3).toFixed(1)}" stroke="${color}" stroke-width="2.5"/>`;
        const meanLabel = `<text x="${x(mean).toFixed(1)}" y="${(cy - jitH / 2 - 6).toFixed(1)}" class="an-tick" text-anchor="middle" style="fill:${color};font-weight:700">${mean.toFixed(1)}</text>`;
        const roleLabel = `<text x="${RDP.l - 10}" y="${(cy + 4).toFixed(1)}" class="st-role-label" text-anchor="end">${role}</text>`;

        return `${band}${dots}${meanLine}${meanLabel}${roleLabel}`;
    }).join('');

    return `
    <svg viewBox="0 0 ${RDP.w} ${h}" class="an-svg">
        ${gridX}${lanes}
    </svg>`;
}

/* ---------- Dot plot divergente: margine Vittorie (+) / Sconfitte (−), centrato su 0 ---------- */

function meanStd(arr) {
    if (!arr.length) return { mean: 0, std: 0, n: 0 };
    const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
    const variance = arr.reduce((a, b) => a + (b - mean) * (b - mean), 0) / arr.length;
    return { mean, std: Math.sqrt(variance), n: arr.length };
}

const MDP = { w: 800, l: 90, r: 16, t: 14, b: 28, lane: 56 };
const SHORT_TEAM_NAME = { capi: 'CDP', lasers: 'Lasers', oscurus: 'Oscurus', sommo: 'Sommo' };

function buildMarginDotPlot(teamMarginStats) {
    const teamKeys = Object.keys(TEAMS);
    const rows = teamKeys.map(key => {
        const stat = teamMarginStats[key] || { wins: [], losses: [] };
        return { key, name: SHORT_TEAM_NAME[key] || TEAMS[key].name, wins: stat.wins, losses: stat.losses, win: meanStd(stat.wins), loss: meanStd(stat.losses) };
    });
    const allMargins = rows.flatMap(r => [...r.wins, ...r.losses]);
    if (!allMargins.length) return '<div class="empty-state"><p class="empty-state-text">No data available</p></div>';

    const maxAbs = Math.max(...allMargins, 1);
    const magTicks = chartNiceTicks(0, maxAbs).filter(v => v > 0);
    const maxTick = magTicks.length ? magTicks[magTicks.length - 1] : maxAbs;

    const plotW = MDP.w - MDP.l - MDP.r;
    const halfW = plotW / 2;
    const centerX = MDP.l + halfW;
    const h = MDP.t + MDP.b + rows.length * MDP.lane;
    const x = v => centerX + (v / maxTick) * halfW; // v positivo = vittoria (destra), negativo = sconfitta (sinistra)

    // Griglia: 0 al centro + tick speculari con segno (+ a destra, − a sinistra)
    const tickValues = [0, ...magTicks, ...magTicks.map(v => -v)];
    const grid = tickValues.map(v => `
        <line x1="${x(v).toFixed(1)}" y1="${MDP.t}" x2="${x(v).toFixed(1)}" y2="${MDP.t + rows.length * MDP.lane}" class="${v === 0 ? 'an-vrule' : 'an-gridline'}"/>
        <text x="${x(v).toFixed(1)}" y="${h - 8}" class="an-tick" text-anchor="middle">${v === 0 ? '0' : (v > 0 ? '+' + Math.round(v) : Math.round(v))}</text>`).join('');

    // Jitter deterministico
    let seed = 7;
    const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };

    const lanes = rows.map((r, ri) => {
        const cy = MDP.t + ri * MDP.lane + MDP.lane / 2;
        const jitH = MDP.lane * 0.6;

        const dotsFor = (values, sign, color) => values.map(m => {
            const dy = cy + (rnd() - 0.5) * jitH;
            return `<circle cx="${x(sign * m).toFixed(1)}" cy="${dy.toFixed(1)}" r="2" fill="${color}" opacity="0.4"/>`;
        }).join('');

        const bandFor = (stat, sign, color) => {
            if (!stat.n) return '';
            const lo = sign > 0 ? Math.max(stat.mean - stat.std, 0) : -(stat.mean + stat.std);
            const hi = sign > 0 ? (stat.mean + stat.std) : -Math.max(stat.mean - stat.std, 0);
            return `<rect x="${x(lo).toFixed(1)}" y="${(cy - jitH / 2).toFixed(1)}" width="${(x(hi) - x(lo)).toFixed(1)}" height="${jitH.toFixed(1)}" fill="${color}" opacity="0.12" rx="3"/>`;
        };

        const meanMarkFor = (stat, sign, color) => {
            if (!stat.n) return '';
            const mx = x(sign * stat.mean);
            return `
            <line x1="${mx.toFixed(1)}" y1="${(cy - jitH / 2 - 3).toFixed(1)}" x2="${mx.toFixed(1)}" y2="${(cy + jitH / 2 + 3).toFixed(1)}" stroke="${color}" stroke-width="2.5"/>
            <text x="${mx.toFixed(1)}" y="${(cy - jitH / 2 - 6).toFixed(1)}" class="an-tick" text-anchor="middle" style="fill:${color};font-weight:700">${fmtN(stat.mean, 1)}</text>`;
        };

        const winColor = '#22c55e';
        const lossColor = '#B8433A';
        const label = `<text x="${MDP.l - 10}" y="${(cy + 4).toFixed(1)}" class="st-role-label" text-anchor="end">${r.name}</text>`;

        return `
            ${bandFor(r.loss, -1, lossColor)}${bandFor(r.win, 1, winColor)}
            ${dotsFor(r.losses, -1, lossColor)}${dotsFor(r.wins, 1, winColor)}
            ${meanMarkFor(r.loss, -1, lossColor)}${meanMarkFor(r.win, 1, winColor)}
            ${label}`;
    }).join('');

    return `
    <svg viewBox="0 0 ${MDP.w} ${h}" class="an-svg">
        ${grid}${lanes}
    </svg>`;
}
