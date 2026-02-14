/**
 * Stats Section
 * Client-side calculation of all-time league records
 */
import { fetchAllSeasonsData, displayName } from '../data.js';
import { TEAM_LOGOS } from '../data/team-config.js';

let loaded = false;

export async function initStats() {
    if (loaded) return;
    loaded = true;

    const grid = document.getElementById('stats-grid');
    const recordsGrid = document.getElementById('records-grid-loading'); // Re-using existing structure

    // Clear loading states
    if (grid) grid.innerHTML = '<div class="stat-card">Loading full history...</div>';
    if (recordsGrid) recordsGrid.innerHTML = '';

    const allSeasons = await fetchAllSeasonsData();
    const stats = calculateStats(allSeasons);

    renderStats(stats);
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

    // Team aggregated stats
    const teamRecords = {}; // { name: { w, l, t, pf, pa, games } }
    const headToHead = {};  // { teamA: { teamB: { w, l, t } } }

    const initTeam = (name) => {
        if (!teamRecords[name]) teamRecords[name] = { w: 0, l: 0, t: 0, pf: 0, pa: 0, games: 0 };
        if (!headToHead[name]) headToHead[name] = {};
    };

    const initH2H = (t1, t2) => {
        if (!headToHead[t1][t2]) headToHead[t1][t2] = { w: 0, l: 0, t: 0 };
        if (!headToHead[t2][t1]) headToHead[t2][t1] = { w: 0, l: 0, t: 0 };
    };

    Object.entries(allSeasons).forEach(([season, data]) => {
        if (!data.weeks) return;

        const seasonPoints = {}; // Track points for this season

        Object.entries(data.weeks).forEach(([weekNum, weekData]) => {
            if (!weekData.matchups) return;

            weekData.matchups.forEach(m => {
                if (!m.team1 || !m.team2) return;

                const t1 = m.team1.name;
                const t2 = m.team2.name;
                const s1 = parseFloat(m.team1.score || 0);
                const s2 = parseFloat(m.team2.score || 0);

                initTeam(t1);
                initTeam(t2);
                initH2H(t1, t2);

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

                // Season Points Tracking
                seasonPoints[t1] = (seasonPoints[t1] || 0) + s1;
                seasonPoints[t2] = (seasonPoints[t2] || 0) + s2;

                // W/L/T & H2H
                if (s1 > s2) {
                    teamRecords[t1].w++;
                    teamRecords[t2].l++;
                    headToHead[t1][t2].w++;
                    headToHead[t2][t1].l++;
                } else if (s2 > s1) {
                    teamRecords[t2].w++;
                    teamRecords[t1].l++;
                    headToHead[t2][t1].w++;
                    headToHead[t1][t2].l++;
                } else {
                    teamRecords[t1].t++;
                    teamRecords[t2].t++;
                    headToHead[t1][t2].t++;
                    headToHead[t2][t1].t++;
                }

                // Records: Highest / Lowest Score
                if (s1 > highestScore.value) highestScore = { value: s1, team: t1, week: weekNum, season };
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

                // Smallest Margin (excluding 0 if that's a thing, but usually > 0)
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
        teamRecords,
        headToHead
    };
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

    // Avg Points
    const avg = (stats.totalPoints / stats.totalGames).toFixed(1);
    cards.push(card(avg, 'Avg Pts / Game', '', 400));

    grid.innerHTML = cards.join('');


    // 2. ALL-TIME RECORDS TABLE
    const recordsSection = document.querySelector('.records-section');
    if (recordsSection) {
        // Clear previous content
        recordsSection.innerHTML = '<h2 class="records-title animate-on-scroll">All-Time Records</h2>';

        const table = document.createElement('table');
        table.className = 'standings-table animate-on-scroll';
        table.innerHTML = `
            <thead>
                <tr>
                    <th>Team</th>
                    <th class="text-center">W</th>
                    <th class="text-center">L</th>
                    <th class="text-center">PF</th>
                    <th class="text-center">PA</th>
                    <th class="text-center">%</th>
                </tr>
            </thead>
            <tbody>
                ${Object.entries(stats.teamRecords)
                .sort(([, a], [, b]) => b.w - a.w || b.pf - a.pf)
                .map(([name, r]) => `
                        <tr>
                            <td class="team-name-cell">${displayName(name)}</td>
                            <td class="text-center" style="color:var(--accent-green); font-weight:700;">${r.w}</td>
                            <td class="text-center" style="color:var(--accent-red); font-weight:700;">${r.l}</td>
                            <td class="text-center">${r.pf.toFixed(0)}</td>
                            <td class="text-center">${r.pa.toFixed(0)}</td>
                            <td class="text-center">${((r.w / (r.w + r.l || 1)) * 100).toFixed(1)}%</td>
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
    // User requested separation from top cards -> Increased margin top for H2H section?
    // Actually user said "staccami ALL time record dalle card sopra" which is the table.
    // I handled that in CSS step (or will). 

    // For H2H, user said "staccami le w dai nomi delle squadre". 
    // "nella card il nokme della statistica mettimela nel rosso arancione del titolo" -> handled in card() function above.
    // "lo stesso per i nomi delle sottos ezioni" -> handled here.

    section.innerHTML = '<h2 class="records-title gradient-text">Head to Head</h2>';

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
