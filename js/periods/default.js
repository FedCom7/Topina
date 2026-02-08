/**
 * Default Period - Home Page Layout
 * 
 * This module handles the default/fallback home page layout.
 * Used for periods that don't have specific layouts.
 */

/**
 * Activate default layout
 * Shows all standard home page elements
 */
function activateDefaultLayout() {
    console.log('[DefaultPeriod] Activating default layout');

    // Show Topina League header
    const normalHeader = document.getElementById('parallax-header-normal');
    if (normalHeader) {
        normalHeader.style.display = '';
        normalHeader.classList.remove('hidden');
    }

    // Show period badge
    const periodBadge = document.getElementById('period-badge');
    if (periodBadge) {
        periodBadge.style.display = '';
        periodBadge.classList.remove('hidden');
    }

    // Show period message
    const periodMessage = document.getElementById('period-message');
    if (periodMessage) {
        periodMessage.style.display = '';
        periodMessage.classList.remove('hidden');
    }

    // Show period content
    const periodContent = document.getElementById('period-content');
    if (periodContent) {
        periodContent.style.display = '';
        periodContent.classList.remove('hidden');
    }

    // Show stats
    const homeStats = document.getElementById('home-stats');
    if (homeStats) {
        homeStats.style.display = '';
        homeStats.classList.remove('hidden');
    }

    // Hide Super Bowl matchup display
    const sbMainMatchup = document.getElementById('sb-main-matchup');
    if (sbMainMatchup) {
        sbMainMatchup.style.display = 'none';
        sbMainMatchup.classList.add('hidden');
    }
}

// Export for use in main script
window.DefaultPeriod = {
    activate: activateDefaultLayout
};
