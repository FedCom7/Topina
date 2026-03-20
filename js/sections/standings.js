/**
 * Standings Section
 * Standard Standings + Playoff Picture
 */
import { fetchFantasyData, processStandings, displayName, CURRENT_SEASON, getPlayoffMatchups, getSuperBowlMatchup } from '../data.js?v=5';

let loaded = false;

// Map team names to transparent logo filenames
const TEAM_LOGOS = {
    'riccardo97com': 'Team%20Logo/team_oscurus_transparent.png',
    'FedCom': 'Team%20Logo/team_sommo_transparent.png',
    'lasers': 'Team%20Logo/team_lasers_transparent.png',
    'Capi dei Pianeti': 'Team%20Logo/team_capi_transparent.png'
};

function getLogoPath(teamName) {
    return TEAM_LOGOS[teamName] || 'images/fallback-player.svg';
}

export async function initStandings() {
    if (loaded) return;
    loaded = true;

    // Remove year selector if it exists in DOM (cleanup)
    const selector = document.getElementById('st-year-selector');
    if (selector) selector.style.display = 'none';

    await loadStandings();
}

async function loadStandings() {
    const wrap = document.getElementById('standings-table-wrap');
    wrap.innerHTML = `<div class="loading-state"><div class="spinner"></div><p>Caricamento Classifica...</p></div>`;

    const data = await fetchFantasyData(CURRENT_SEASON);

    if (!data) {
        wrap.innerHTML = `<div class="empty-state"><div class="empty-state-icon">📭</div><p class="empty-state-text">Dati non disponibili</p></div>`;
        return;
    }

    const standings = processStandings(data, CURRENT_SEASON);
    const playoffPictureHTML = generatePlayoffPicture(standings, data);
    const standingsTableHTML = generateStandingsTable(standings);

    wrap.innerHTML = `
        ${playoffPictureHTML}
        <h3 class="section-title" style="margin-top: 48px; margin-bottom: 20px;">Regular Season Standings</h3>
        ${standingsTableHTML}
    `;
}

function generatePlayoffPicture(standings, fantasyData) {
    if (standings.length < 4) return '';

    const seed1 = standings[0];
    const seed2 = standings[1];
    const seed3 = standings[2];
    const seed4 = standings[3];

    const playoffMatchups = getPlayoffMatchups(fantasyData, CURRENT_SEASON);
    const sbMatchup = getSuperBowlMatchup(fantasyData, CURRENT_SEASON);

    let winner1v4 = null, loser1v4 = null;
    let winner2v3 = null, loser2v3 = null;
    let champion = null, sbLoser = null;

    // --- Round 1 results from playoff matchups ---
    if (playoffMatchups) {
        const resolveMatchup = (teamA, teamB) => {
            const m = playoffMatchups.find(mu =>
                mu.team1 && mu.team2 &&
                [mu.team1.name, mu.team2.name].includes(teamA.name) &&
                [mu.team1.name, mu.team2.name].includes(teamB.name)
            );
            if (!m) return null;
            const s1 = parseFloat(m.team1.score);
            const s2 = parseFloat(m.team2.score);
            if (s1 === s2) return null;
            const winnerName = s1 > s2 ? m.team1.name : m.team2.name;
            return winnerName === teamA.name ? { winner: teamA, loser: teamB } : { winner: teamB, loser: teamA };
        };

        const r1 = resolveMatchup(seed1, seed4);
        if (r1) { winner1v4 = r1.winner; loser1v4 = r1.loser; }

        const r2 = resolveMatchup(seed2, seed3);
        if (r2) { winner2v3 = r2.winner; loser2v3 = r2.loser; }
    }

    // --- Super Bowl results ---
    if (sbMatchup?.team1 && sbMatchup?.team2) {
        const s1 = parseFloat(sbMatchup.team1.score);
        const s2 = parseFloat(sbMatchup.team2.score);
        if (s1 > s2) { champion = sbMatchup.team1.name; sbLoser = sbMatchup.team2.name; }
        else if (s2 > s1) { champion = sbMatchup.team2.name; sbLoser = sbMatchup.team1.name; }
    }

    // --- Render card ---
    const renderCard = (team, posClass, seed = null, isLoser = false, isChampion = false) => {
        const isTall = posClass === 'pos-3' || posClass === 'pos-4';

        if (!team) return `
            <div class="playoff-card ${posClass} empty ${isTall ? 'tall' : ''}"></div>`;

        const name = team.name ?? team;
        const teamClass = `team-${displayName(name).toLowerCase().replace(/\s+/g, '-')}`;
        const loserClass = isLoser ? 'loser' : '';
        const champClass = isChampion ? 'champion' : '';
        const seedBadge = seed !== null ? `<span class="playoff-seed">#${seed}</span>` : '';

        return `
            <div class="playoff-card ${posClass} ${teamClass} ${isTall ? 'tall' : ''} ${loserClass} ${champClass}">
                ${seedBadge}
                <img src="${getLogoPath(name)}" alt="${name}" class="playoff-logo">
            </div>
        `;
    };

    const nameOf = (t) => t?.name ?? t;

    return `
    <div class="playoff-picture-container">
        <div class="playoff-grid-explicit">
            <!-- LEFT COLUMN: 1 vs 4 -->
            ${renderCard(seed1, 'pos-1', 1, loser1v4?.name === seed1.name)}
            ${renderCard(seed4, 'pos-2', 4, loser1v4?.name === seed4.name)}

            <!-- MID LEFT: winner of 1v4 -->
            ${renderCard(winner1v4, 'pos-3', null, sbLoser === nameOf(winner1v4), champion === nameOf(winner1v4))}

            <!-- MID RIGHT: winner of 2v3 -->
            ${renderCard(winner2v3, 'pos-4', null, sbLoser === nameOf(winner2v3), champion === nameOf(winner2v3))}

            <!-- RIGHT COLUMN: 2 vs 3 -->
            ${renderCard(seed2, 'pos-5', 2, loser2v3?.name === seed2.name)}
            ${renderCard(seed3, 'pos-6', 3, loser2v3?.name === seed3.name)}

            <!-- SUPER BOWL LOGO OVERLAY -->
            <img src="Wallpapers/superbowl_vii_logo.png" alt="Super Bowl VII" class="sb-logo-overlay">
        </div>
    </div>
    `;
}

function generateStandingsTable(standings) {
    if (!standings.length) return '';

    return `
    <table class="standings-table">
        <thead>
            <tr>
                <th>#</th>
                <th>Team</th>
                <th>W</th>
                <th>L</th>
                <th>PF</th>
                <th>PA</th>
                <th>Streak</th>
            </tr>
        </thead>
        <tbody>
            ${standings.map((t, i) => {
        const rank = i + 1;
        const rankClass = rank <= 3 ? ` rank-${rank}` : '';
        const streakType = t.streak.startsWith('W') ? 'w' : t.streak.startsWith('L') ? 'l' : 't';
        return `
                <tr class="standings-row" style="animation-delay:${i * 60}ms">
                    <td><span class="rank-badge${rankClass}">${rank}</span></td>
                    <td class="team-name-cell">${displayName(t.name)}</td>
                    <td class="stat-cell">${t.w}</td>
                    <td class="stat-cell">${t.l}</td>
                    <td class="stat-cell">${t.pf.toLocaleString()}</td>
                    <td class="stat-cell">${t.pa.toLocaleString()}</td>
                    <td><span class="streak-badge streak-${streakType}">${t.streak}</span></td>
                </tr>`;
    }).join('')}
        </tbody>
    </table>`;
}
