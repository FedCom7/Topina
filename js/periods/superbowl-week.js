/**
 * Super Bowl Week Layout
 * Handles all UI changes specific to Super Bowl Week period.
 */

const TEAM_LOGOS_TRANSPARENT = {
    'Capi dei Pianeti': 'images/team_capi_transparent.png',
    'Lasers': 'images/team_lasers_transparent.png',
    'Oscurus': 'images/team_oscurus_transparent.png',
    'Sommo': 'images/team_sommo_transparent.png'
};

function getLogo(teamName) {
    return TEAM_LOGOS_TRANSPARENT[teamName] || 'images/nfl_logo.png';
}

/**
 * Activate Super Bowl Week layout
 */
export function activateSuperBowlWeek(finalists) {
    // Hide default elements
    ['parallax-header-normal', 'period-badge', 'period-message', 'period-content', 'home-stats', 'superbowl-section'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
    });

    // Show matchup display
    const sbMatchup = document.getElementById('sb-main-matchup');
    if (sbMatchup) {
        sbMatchup.style.display = 'flex';
        sbMatchup.classList.remove('hidden');
    }

    // Show stadium window
    const stadiumWindow = document.getElementById('stadium-window');
    if (stadiumWindow) {
        stadiumWindow.style.display = 'block';
        stadiumWindow.classList.remove('hidden');
    }

    // Update team logos and names
    if (finalists) updateMatchupDisplay(finalists);
}

/**
 * Update matchup display with finalist team info
 */
function updateMatchupDisplay(finalists) {
    const { teamTop, teamBottom, matchup } = finalists;

    // Main matchup display
    const team1Logo = document.getElementById('sb-main-team1-logo');
    const team1Name = document.getElementById('sb-main-team1-name');
    const team2Logo = document.getElementById('sb-main-team2-logo');
    const team2Name = document.getElementById('sb-main-team2-name');

    if (team1Logo) { team1Logo.src = getLogo(teamTop); team1Logo.alt = teamTop; }
    if (team1Name) team1Name.textContent = teamTop;
    if (team2Logo) { team2Logo.src = getLogo(teamBottom); team2Logo.alt = teamBottom; }
    if (team2Name) team2Name.textContent = teamBottom;

    // Update scores
    if (matchup) {
        const isTeam1Top = matchup.team1.name === teamTop;
        const scoreTop = isTeam1Top ? matchup.team1.score : matchup.team2.score;
        const scoreBottom = isTeam1Top ? matchup.team2.score : matchup.team1.score;

        const score1El = document.getElementById('sb-score1');
        const score2El = document.getElementById('sb-score2');
        if (score1El) score1El.textContent = scoreTop;
        if (score2El) score2El.textContent = scoreBottom;
    }

    // Detailed section
    const sbTeam1Name = document.getElementById('sb-team1-name');
    const sbTeam2Name = document.getElementById('sb-team2-name');
    const sbTeam1Logo = document.getElementById('sb-team1-logo-img');
    const sbTeam2Logo = document.getElementById('sb-team2-logo-img');

    if (sbTeam1Name) sbTeam1Name.textContent = teamTop;
    if (sbTeam2Name) sbTeam2Name.textContent = teamBottom;
    if (sbTeam1Logo) sbTeam1Logo.src = getLogo(teamTop);
    if (sbTeam2Logo) sbTeam2Logo.src = getLogo(teamBottom);

    // Stats comparison
    if (matchup) {
        const statsTop = matchup.team1.name === teamTop ? matchup.team1 : matchup.team2;
        const statsBottom = matchup.team1.name === teamTop ? matchup.team2 : matchup.team1;

        const pf1 = document.getElementById('sb-stat1-pf');
        const pf2 = document.getElementById('sb-stat2-pf');
        if (pf1) pf1.textContent = statsTop.score;
        if (pf2) pf2.textContent = statsBottom.score;

        const pa1 = document.getElementById('sb-stat1-pa');
        const pa2 = document.getElementById('sb-stat2-pa');
        if (pa1) pa1.textContent = statsBottom.score;
        if (pa2) pa2.textContent = statsTop.score;
    }
}

/**
 * Deactivate Super Bowl Week layout
 */
export function deactivateSuperBowlWeek() {
    // Restore default elements
    ['parallax-header-normal', 'period-badge', 'period-message', 'period-content', 'home-stats'].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.style.display = '';
            el.classList.remove('hidden');
        }
    });

    // Hide matchup display
    const sbMatchup = document.getElementById('sb-main-matchup');
    if (sbMatchup) { sbMatchup.style.display = 'none'; sbMatchup.classList.add('hidden'); }

    // Hide stadium window
    const stadiumWindow = document.getElementById('stadium-window');
    if (stadiumWindow) { stadiumWindow.style.display = 'none'; stadiumWindow.classList.add('hidden'); }
}
