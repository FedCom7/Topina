// ... Import line needs to be updated first, doing it in separate Replace or assuming user can handle multiple chunks? 
// I will do the import update in a separate call or merged if possible. 
// Actually, `replace_file_content` checks contiguous blocks. The import is at the top, logic in middle, render at bottom.
// I'll do the logic and render first in one chunk if they are close? No, logic is line ~199, render is ~350.
// I'll do them as separate calls or use `multi_replace_file_content`.

// Wait, I can use `multi_replace_file_content` for this!

import { fetchAllSeasonsData, fetchFantasyData, displayName, SEASONS, getSuperBowlMatchup, getSeasonConfig } from '../data.js?v=21';
import { TEAM_LOGOS } from '../data/team-config.js?v=21';

let loaded = false;

export async function initStats() {
    if (loaded) return;
    loaded = true;

    const grid = document.getElementById('stats-grid');
    const recordsGrid = document.getElementById('records-grid-loading'); // Re-using existing structure

    // Clear loading states
    if (grid) grid.innerHTML = '<div class="stat-card">Loading full history...</div>';
    if (recordsGrid) recordsGrid.innerHTML = '<div class="loading-state"><p>Initializing data fetch...</p></div>';

    try {
        const allSeasons = {};
        for (const season of SEASONS) {
            if (recordsGrid) recordsGrid.innerHTML = `<div class="loading-state"><div class="spinner"></div><p>Fetching data for ${season}...</p></div>`;
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

        if (recordsGrid) recordsGrid.innerHTML = '<div class="loading-state"><p>Data fetched. Calculating...</p></div>';
        const stats = calculateStats(allSeasons);
        renderStats(stats);
    } catch (e) {
        console.error("Stats Init Error:", e);
        if (recordsGrid) recordsGrid.innerHTML = `<div class="error-state" style="color:red; padding:20px;">Error loading stats: ${e.message}</div>`;
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

function renderStats(stats) {
    const grid = document.getElementById('stats-grid');
    if (!grid) return;

    // 1. CARDS (No icons)
    const cards = [];

    // Basic stuff
    cards.push(card(stats.seasonsCount, 'Stagioni Giocate', '', 0));
    cards.push(card(stats.totalGames, 'Partite Totali', '', 50));
    cards.push(card(parseInt(stats.totalPoints).toLocaleString(), 'Punti Totali', '', 100));

    // Records
    const h = stats.highestScore;
    cards.push(card(h.value, 'Highest Score', `${displayName(h.team)}<br>W${h.week}, ${h.season}`, 150));

    const l = stats.lowestScore;
    cards.push(card(l.value, 'Lowest Score', `${displayName(l.team)}<br>W${l.week}, ${l.season}`, 200));

    const m = stats.largestMargin;
    cards.push(card(m.value, 'Largest Margin', `${displayName(m.winner)} def. ${displayName(m.loser)}<br>W${m.week}, ${m.season}`, 250));

    const sm = stats.smallestMargin;
    cards.push(card(sm.value, 'Smallest Margin', `${displayName(sm.winner)} def. ${displayName(sm.loser)}<br>W${sm.week}, ${sm.season}`, 275));

    const mp = stats.mostPointsSeason;
    cards.push(card(parseFloat(mp.value).toLocaleString(), 'Most Points (Season)', `${displayName(mp.team)} — ${mp.season}`, 300));

    const fp = stats.fewestPointsSeason;
    cards.push(card(parseFloat(fp.value).toLocaleString(), 'Fewest Points (Season)', `${displayName(fp.team)} — ${fp.season}`, 350));

    // Streaks
    const ws = stats.maxWinStreak;
    cards.push(card(ws.value, 'Longest Win Streak', `${displayName(ws.team)}<br>${ws.start} — ${ws.end}`, 375));

    const ls = stats.maxLossStreak;
    cards.push(card(ls.value, 'Longest Loss Streak', `${displayName(ls.team)}<br>${ls.start} — ${ls.end}`, 390));

    // Avg Points
    const avg = (stats.totalPoints / stats.totalGames).toFixed(1);
    cards.push(card(avg, 'Avg Pts / Game', '', 400));

    grid.innerHTML = cards.join('');


    // 2. ALL-TIME RECORDS TABLE
    const recordsSection = document.querySelector('.records-section');
    if (recordsSection) {
        // Clear previous content
        recordsSection.innerHTML = '<h2 class="records-title animate-on-scroll" style="text-align:center; margin-bottom: 2rem;">All-Time Records</h2>';

        const table = document.createElement('table');
        table.className = 'standings-table animate-on-scroll';
        table.innerHTML = `
            <thead>
                <tr>
                    <th style="padding-left:24px; width: 35%; text-align: left; color: #fff;">Team</th>
                    <th class="text-center" style="width: 8%; color: #fff;">W</th>
                    <th class="text-center" style="width: 8%; color: #fff;">L</th>
                    <th class="text-center" style="width: 8%; color: #fff;">PF</th>
                    <th class="text-center" style="width: 8%; color: #fff;">PA</th>
                    <th class="text-center" style="width: 8%; color: #fff;">%</th>
                    <th class="text-center" style="width: 8%; color: #fff; font-weight:700;">PO W</th>
                    <th class="text-center" style="width: 8%; color: #fff; font-weight:700;">SB W</th>
                    <th class="text-center" style="width: 9%; color: #fff;">SB App</th>
                </tr>
            </thead>
            <tbody>
                ${Object.entries(stats.teamRecords)
                .sort(([, a], [, b]) => b.w - a.w || b.pf - a.pf)
                .map(([name, r]) => `
                        <tr>
                            <td class="team-name-cell" style="padding-left:24px; text-align: left; color: #fff;">${displayName(name)}</td>
                            <td class="text-center" style="color:var(--accent-green); font-weight:700;">${r.w}</td>
                            <td class="text-center" style="color:var(--accent-red); font-weight:700;">${r.l}</td>
                            <td class="text-center" style="color: rgba(255,255,255,0.7);">${r.pf.toFixed(0)}</td>
                            <td class="text-center" style="color: rgba(255,255,255,0.7);">${r.pa.toFixed(0)}</td>
                            <td class="text-center" style="color: rgba(255,255,255,0.7);">${((r.w / (r.w + r.l || 1)) * 100).toFixed(1)}%</td>
                            <td class="text-center" style="color: #fff; font-weight:700;">${r.playoffWins || 0}</td>
                            <td class="text-center" style="color: #fff; font-weight:800;">${r.sbWins || 0}</td>
                            <td class="text-center" style="color: #fff;">${r.sbApps || 0}</td>
                        </tr>
                    `).join('')}
            </tbody>
        `;
        recordsSection.appendChild(table);
    }


    // 3. HEAD-TO-HEAD SECTION
    renderHeadToHead(stats.headToHead, recordsSection);
}

function card(value, label, detail, delay) {
    return `
    <div class="stat-card" style="animation-delay:${delay}ms">
        <div class="stat-card-value">${value}</div>
        <div class="stat-card-label gradient-text" style="font-weight:800; text-transform:uppercase; letter-spacing:1px; font-size:0.9rem;">${label}</div>
        ${detail ? `<div class="stat-card-detail">${detail}</div>` : ''}
    </div>`;
}

function renderHeadToHead(h2hData, container) {
    const section = document.createElement('div');
    section.className = 'h2h-section animate-on-scroll';

    section.innerHTML = '<h2 class="records-title gradient-text" style="text-align:center; margin-top:3rem; margin-bottom:2rem;">Head to Head</h2>';

    const grid = document.createElement('div');
    grid.style.display = 'grid';
    grid.style.gridTemplateColumns = 'repeat(auto-fit, minmax(300px, 1fr))';
    grid.style.gap = '2rem';

    // Get sorted team list
    const teams = Object.keys(h2hData).sort();

    teams.forEach(team => {
        const card = document.createElement('div');
        card.className = 'h2h-card';
        // Removed inline styles to rely more on CSS if possible, but keeping basic layout
        card.style.background = 'rgba(255, 255, 255, 0.03)';
        card.style.padding = '1.5rem';
        card.style.borderRadius = '16px';
        card.style.border = '1px solid rgba(255, 255, 255, 0.08)';

        let html = `<h3 style="margin-bottom:1.5rem; font-size:1.3rem; color:var(--text-primary); border-bottom:1px solid rgba(255,255,255,0.1); padding-bottom:10px;">${displayName(team)}</h3>`;
        html += '<div style="display:flex; flex-direction:column; gap:0.8rem;">';

        const opponents = h2hData[team];
        Object.entries(opponents).forEach(([opp, rec]) => {
            // Only show if they have played at least once
            if (rec.w + rec.l + rec.t > 0) {
                html += `
                <div style="display:flex; align-items:center; justify-content:space-between; font-size:0.95rem; padding: 4px 0;">
                    <span style="color:var(--text-secondary); font-weight:500;">vs ${displayName(opp)}</span>
                    <span style="font-family:var(--font-primary); font-weight:700; background:rgba(0,0,0,0.2); padding:4px 12px; border-radius:20px;">
                        <span style="color:#4ade80">${rec.w} W</span> 
                        <span style="color:rgba(255,255,255,0.2); margin:0 4px;">|</span>
                        <span style="color:#f87171">${rec.l} L</span>
                    </span>
                </div>`;
            }
        });
        html += '</div>';
        card.innerHTML = html;
        grid.appendChild(card);
    });

    section.appendChild(grid);
    container.appendChild(section);
}
