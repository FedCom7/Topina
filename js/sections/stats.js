import { fetchFantasyData, displayName, SEASONS, getSuperBowlMatchup, getSeasonConfig } from '../data.js?v=21';
import { TEAM_LOGOS } from '../data/team-config.js?v=21';

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

    // Team aggregated stats
    const teamRecords = {}; // { name: { w, l, t, pf, pa, games } }
    const headToHead = {};  // { teamA: { teamB: { w, l, t } } }

    // Tracking current streaks during iteration
    const currentStreaks = {}; // { teamName: { type: 'W'|'L'|'T', count: 0 } }

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
        wins ? recordTile(wins.min.value, 'Fewest Wins All-Time', wins.min.teams) : ''
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
        pct: Math.max(...entries.map(([, r]) => r.w / (r.w + r.l || 1)))
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
