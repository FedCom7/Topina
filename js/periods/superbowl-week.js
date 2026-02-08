/**
 * Super Bowl Week - Home Page Layout
 * 
 * This module handles all UI changes specific to Super Bowl Week period.
 * It hides default elements and shows only the matchup display.
 */

// Team logos with transparent backgrounds
const TEAM_LOGOS_TRANSPARENT = {
    'Capi dei Pianeti': 'images/team_capi_transparent.png',
    'Lasers': 'images/team_lasers_transparent.png',
    'Oscurus': 'images/team_oscurus_transparent.png',
    'Sommo': 'images/team_sommo_transparent.png'
};

/**
 * Activate Super Bowl Week layout
 * Hides all default elements and shows only matchup display
 */
function activateSuperBowlWeek(finalists) {
    console.log('[SuperBowlWeek] Activating layout');

    // === HIDE ELEMENTS ===

    // 1. Hide Topina League header (the rotating banner)
    const normalHeader = document.getElementById('parallax-header-normal');
    if (normalHeader) {
        normalHeader.style.display = 'none';
        console.log('[SuperBowlWeek] Hidden: parallax-header-normal');
    }

    // 2. Hide period badge ("Super Bowl Week" text)
    const periodBadge = document.getElementById('period-badge');
    if (periodBadge) {
        periodBadge.style.display = 'none';
        console.log('[SuperBowlWeek] Hidden: period-badge');
    }

    // 3. Hide period message ("The championship game is here!")
    const periodMessage = document.getElementById('period-message');
    if (periodMessage) {
        periodMessage.style.display = 'none';
        console.log('[SuperBowlWeek] Hidden: period-message');
    }

    // 4. Hide period content
    const periodContent = document.getElementById('period-content');
    if (periodContent) {
        periodContent.style.display = 'none';
        console.log('[SuperBowlWeek] Hidden: period-content');
    }

    // 5. Hide stats (12 Teams, 5 Seasons, 840 Games)
    const homeStats = document.getElementById('home-stats');
    if (homeStats) {
        homeStats.style.display = 'none';
        console.log('[SuperBowlWeek] Hidden: home-stats');
    }

    // 6. Hide the superbowl-section (the one with Season Stats)
    const superbowlSection = document.getElementById('superbowl-section');
    if (superbowlSection) {
        superbowlSection.style.display = 'none';
        console.log('[SuperBowlWeek] Hidden: superbowl-section');
    }

    // === SHOW ELEMENTS ===

    // Show main matchup display
    const sbMainMatchup = document.getElementById('sb-main-matchup');
    if (sbMainMatchup) {
        sbMainMatchup.style.display = 'flex';
        sbMainMatchup.classList.remove('hidden');
        console.log('[SuperBowlWeek] Shown: sb-main-matchup');
    }

    // === UPDATE TEAM LOGOS AND NAMES ===

    if (finalists) {
        updateMatchupDisplay(finalists);
    }
}

/**
 * Update matchup display with finalist team info
 */
function updateMatchupDisplay(finalists) {
    const team1Logo = document.getElementById('sb-main-team1-logo');
    const team1Name = document.getElementById('sb-main-team1-name');
    const team2Logo = document.getElementById('sb-main-team2-logo');
    const team2Name = document.getElementById('sb-main-team2-name');

    if (team1Logo && TEAM_LOGOS_TRANSPARENT[finalists.teamTop]) {
        team1Logo.src = TEAM_LOGOS_TRANSPARENT[finalists.teamTop];
        team1Logo.alt = finalists.teamTop;
    }
    if (team1Name) {
        team1Name.textContent = finalists.teamTop;
    }
    if (team2Logo && TEAM_LOGOS_TRANSPARENT[finalists.teamBottom]) {
        team2Logo.src = TEAM_LOGOS_TRANSPARENT[finalists.teamBottom];
        team2Logo.alt = finalists.teamBottom;
    }
    if (team2Name) {
        team2Name.textContent = finalists.teamBottom;
    }

    console.log('[SuperBowlWeek] Updated matchup:', finalists.teamTop, 'vs', finalists.teamBottom);
}

/**
 * Deactivate Super Bowl Week layout
 * Restores all default elements
 */
function deactivateSuperBowlWeek() {
    console.log('[SuperBowlWeek] Deactivating layout');

    // Show all hidden elements
    const elementsToShow = [
        'parallax-header-normal',
        'period-badge',
        'period-message',
        'period-content',
        'home-stats'
    ];

    elementsToShow.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.style.display = '';
            el.classList.remove('hidden');
        }
    });

    // Hide matchup display
    const sbMainMatchup = document.getElementById('sb-main-matchup');
    if (sbMainMatchup) {
        sbMainMatchup.style.display = 'none';
        sbMainMatchup.classList.add('hidden');
    }
}

// Export functions for use in main script
window.SuperBowlWeek = {
    activate: activateSuperBowlWeek,
    deactivate: deactivateSuperBowlWeek,
    updateMatchup: updateMatchupDisplay
};
