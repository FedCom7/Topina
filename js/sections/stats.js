import { fetchFantasyData, displayName, SEASONS, getSuperBowlMatchup, getSeasonConfig } from '../data.js?v=21';
import { TEAM_LOGOS, TEAM_KEYS } from '../data/team-config.js?v=21';

let loaded = false;

export async function initStats() {
    if (loaded) return;
    loaded = true;

    const summary = document.getElementById('stats-summary');

    try {
        const allSeasons = {};
        for (const season of SEASONS) {
            if (summary) summary.innerHTML = `<div class="loading-state"><div class="spinner"></div><p>Loading ${season} data...</p></div>`;
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

    // Single-season player/defense records (from new per-player stat data)
    let mostRushYardsSeason = { value: 0, player: '', team: '', season: '' };
    let mostRushTDSeason = { value: 0, player: '', team: '', season: '' };
    let mostPassYardsSeason = { value: 0, player: '', team: '', season: '' };
    let mostPassTDSeason = { value: 0, player: '', team: '', season: '' };
    let mostRecYardsSeason = { value: 0, player: '', team: '', season: '' };
    let mostRecTDSeason = { value: 0, player: '', team: '', season: '' };
    let mostSacksSeason = { value: 0, player: '', team: '', season: '' };
    let mostDefTurnoversSeason = { value: 0, player: '', team: '', season: '' };
    let mostDefTDSeason = { value: 0, player: '', team: '', season: '' };

    // Team aggregated stats
    const teamRecords = {}; // { name: { w, l, t, pf, pa, games } }
    const headToHead = {};  // { teamA: { teamB: { w, l, t } } }

    // Tracking current streaks during iteration
    const currentStreaks = {}; // { teamName: { type: 'W'|'L'|'T', count: 0 } }

    // Chart data (per-season trends, playoffs included)
    const chartTeamPoints = {};   // season -> { rawTeamName: pts }
    const chartPlayerTotals = {}; // season -> total fantasy points by all players (starters+bench)
    const chartRolePoints = {};   // season -> { role: pts }
    const chartGiornate = {};     // season -> giornate effettivamente giocate (matchup presenti)

    const initTeam = (name) => {
        if (!teamRecords[name]) teamRecords[name] = { w: 0, l: 0, t: 0, pf: 0, pa: 0, games: 0, sbWins: 0, sbApps: 0, playoffWins: 0 };
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
        let seasonPlayerTotal = 0;
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
                    for (const list of [side.starters, side.bench]) {
                        for (const p of list || []) {
                            if (!p?.name) continue;
                            const pPts = parseFloat(p.fantasy_points || 0);
                            seasonPlayerTotal += pPts;
                            const role = p.position_in_team || p.position;
                            if (role) seasonRolePoints[role] = (seasonRolePoints[role] || 0) + pPts;
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
                                playerSeasonStats[key] = { rushYds: 0, rushTd: 0, passYds: 0, passTd: 0, recYds: 0, recTd: 0, sacks: 0, defTo: 0, defTd: 0 };
                            }
                            const acc = playerSeasonStats[key];
                            acc.rushYds += Number(p.stats.rush_yds) || 0;
                            acc.rushTd += Number(p.stats.rush_td) || 0;
                            acc.passYds += Number(p.stats.pass_yds) || 0;
                            acc.passTd += Number(p.stats.pass_td) || 0;
                            acc.recYds += Number(p.stats.rec_yds) || 0;
                            acc.recTd += Number(p.stats.rec_td) || 0;
                            acc.sacks += Number(p.stats.sack) || 0;
                            acc.defTo += (Number(p.stats.def_int) || 0) + (Number(p.stats.fum_rec) || 0);
                            acc.defTd += Number(p.stats.def_td) || 0;

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
        chartRolePoints[season] = seasonRolePoints;
        chartGiornate[season] = playedWeeks;

        // End of Season: Check single-season player/defense records
        Object.entries(playerSeasonStats).forEach(([key, acc]) => {
            const [team, player] = key.split('||');
            if (acc.rushYds > mostRushYardsSeason.value) mostRushYardsSeason = { value: acc.rushYds, player, team, season };
            if (acc.rushTd > mostRushTDSeason.value) mostRushTDSeason = { value: acc.rushTd, player, team, season };
            if (acc.passYds > mostPassYardsSeason.value) mostPassYardsSeason = { value: acc.passYds, player, team, season };
            if (acc.passTd > mostPassTDSeason.value) mostPassTDSeason = { value: acc.passTd, player, team, season };
            if (acc.recYds > mostRecYardsSeason.value) mostRecYardsSeason = { value: acc.recYds, player, team, season };
            if (acc.recTd > mostRecTDSeason.value) mostRecTDSeason = { value: acc.recTd, player, team, season };
            if (acc.sacks > mostSacksSeason.value) mostSacksSeason = { value: acc.sacks, player, team, season };
            if (acc.defTo > mostDefTurnoversSeason.value) mostDefTurnoversSeason = { value: acc.defTo, player, team, season };
            if (acc.defTd > mostDefTDSeason.value) mostDefTDSeason = { value: acc.defTd, player, team, season };
        });
    });

    return {
        seasonsCount: Object.keys(allSeasons).length,
        totalGames,
        totalPoints: totalPoints.toFixed(2),
        highestScore,
        lowestScore,
        largestMargin,
        smallestMargin,
        mostPointsSeason,
        fewestPointsSeason,
        maxWinStreak,
        maxLossStreak,
        mostRushYardsSeason,
        mostRushTDSeason,
        mostPassYardsSeason,
        mostPassTDSeason,
        mostRecYardsSeason,
        mostRecTDSeason,
        chartData: {
            teamPoints: chartTeamPoints,
            playerTotals: chartPlayerTotals,
            rolePoints: chartRolePoints,
            giornate: chartGiornate,
        },
        mostSacksSeason,
        mostDefTurnoversSeason,
        mostDefTDSeason,
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

    const ry = stats.mostRushYardsSeason;
    const rt = stats.mostRushTDSeason;
    const py = stats.mostPassYardsSeason;
    const pt = stats.mostPassTDSeason;
    const cy = stats.mostRecYardsSeason;
    const ct = stats.mostRecTDSeason;
    const sk = stats.mostSacksSeason;
    const dto = stats.mostDefTurnoversSeason;
    const dtd = stats.mostDefTDSeason;

    const tiles = [
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
        wins ? recordTile(wins.min.value, 'Fewest Wins All-Time', wins.min.teams) : '',
        ry.value ? recordTile(ry.value.toLocaleString('en-US'), 'Most Rush Yards (Season)', `${ry.player} — ${displayName(ry.team)}, ${ry.season}`) : '',
        rt.value ? recordTile(rt.value, 'Most Rush TDs (Season)', `${rt.player} — ${displayName(rt.team)}, ${rt.season}`) : '',
        py.value ? recordTile(py.value.toLocaleString('en-US'), 'Most Pass Yards (Season)', `${py.player} — ${displayName(py.team)}, ${py.season}`) : '',
        pt.value ? recordTile(pt.value, 'Most Pass TDs (Season)', `${pt.player} — ${displayName(pt.team)}, ${pt.season}`) : '',
        cy.value ? recordTile(cy.value.toLocaleString('en-US'), 'Most Reception Yards (Season)', `${cy.player} — ${displayName(cy.team)}, ${cy.season}`) : '',
        ct.value ? recordTile(ct.value, 'Most Reception TDs (Season)', `${ct.player} — ${displayName(ct.team)}, ${ct.season}`) : '',
        sk.value ? recordTile(sk.value, 'Most Sacks (Season)', `${sk.player} — ${displayName(sk.team)}, ${sk.season}`) : '',
        dto.value ? recordTile(dto.value, 'Most Turnovers Forced (Season)', `${dto.player} — ${displayName(dto.team)}, ${dto.season}`) : '',
        dtd.value ? recordTile(dtd.value, 'Most Defensive TDs (Season)', `${dtd.player} — ${displayName(dtd.team)}, ${dtd.season}`) : ''
    ];

    el.innerHTML = `
        <h2 class="records-title">League Records</h2>
        <div class="record-tiles">${tiles.join('')}</div>
    `;
}

function recordTile(value, label, holder) {
    return `
    <div class="record-tile">
        <div class="record-tile-value">${value}</div>
        <div class="record-tile-label">${label}</div>
        ${holder ? `<div class="record-tile-holder">${holder}</div>` : ''}
    </div>`;
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
            </div>
            <div class="team-alltime-hero-label">Regular Season Record</div>
            <div class="team-alltime-ministats">
                ${ministat(r.pf.toFixed(0), 'Points For', r.pf === best.pf)}
                ${ministat(r.pa.toFixed(0), 'Points Against', r.pa === best.pa)}
                ${ministat(r.playoffWins || 0, 'Playoff Wins', (r.playoffWins || 0) === best.playoffWins && best.playoffWins > 0)}
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

function renderCharts(stats) {
    const el = document.getElementById('charts-block');
    if (!el || !stats.chartData) return;

    const { teamPoints, playerTotals, rolePoints, giornate } = stats.chartData;
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
                label: `${diff > 0 ? '+' : '−'}${Math.abs(diff)} giornat${Math.abs(diff) === 1 ? 'a' : 'e'}`,
            });
        }
    }

    // 1) Punti totali per team nelle stagioni
    const teamNames = [...new Set(seasons.flatMap(s => Object.keys(teamPoints[s])))];
    const teamSeries = teamNames.map(raw => ({
        name: displayName(raw),
        color: teamChartColor(raw),
        values: seasons.filter(s => teamPoints[s][raw] !== undefined)
            .map(s => ({ x: s, y: teamPoints[s][raw] })),
    })).filter(s => s.values.length > 0);

    // 2) Produzione totale di tutti i giocatori
    const prodSeries = [{
        name: 'All Players',
        color: '#d4665e',
        values: seasons.map(s => ({ x: s, y: playerTotals[s] || 0 })),
    }];

    // 3) Produzione per ruolo
    const roles = Object.keys(ROLE_COLORS).filter(r => seasons.some(s => (rolePoints[s] || {})[r] > 0));
    const roleSeries = roles.map(role => ({
        name: role,
        color: ROLE_COLORS[role],
        values: seasons.map(s => ({ x: s, y: (rolePoints[s] || {})[role] || 0 })),
    }));

    const legendOf = (series) => `
    <div class="an-chart-legend">
        ${series.map(s => `<span class="an-legend-item"><span class="an-legend-key" style="background:${s.color}"></span>${s.name}</span>`).join('')}
    </div>`;

    el.innerHTML = `
        <h2 class="records-title">Trends</h2>

        <h3 class="an-sub-title">Team Points by Season</h3>
        ${legendOf(teamSeries)}
        <div class="an-chart st-trend-chart">${buildSeasonLineChart(teamSeries, markers)}<div class="an-chart-tooltip" hidden></div></div>

        <h3 class="an-sub-title">Total Player Production by Season</h3>
        <div class="an-chart st-trend-chart">${buildSeasonLineChart(prodSeries, markers)}<div class="an-chart-tooltip" hidden></div></div>

        <h3 class="an-sub-title">Player Production by Role</h3>
        ${legendOf(roleSeries)}
        <div class="an-chart st-trend-chart">${buildSeasonLineChart(roleSeries, markers)}<div class="an-chart-tooltip" hidden></div></div>

        <p class="an-footnote">Playoffs and Super Bowl included. Player production includes bench points; team points are actual matchup scores. Dashed lines mark seasons where the number of giornate changed.</p>
    `;

    el.querySelectorAll('.st-trend-chart').forEach(bindSeasonChart);
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
