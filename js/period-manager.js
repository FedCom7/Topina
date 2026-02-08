/**
 * Period Manager
 * 
 * Central module for managing home page period layouts.
 * Determines current period and activates appropriate layout module.
 */

/**
 * Apply period-specific layout
 * @param {string} period - The period to apply (e.g., 'PLAYOFFS', 'REGULAR_SEASON')
 * @param {object} config - Configuration object (e.g., finalists for Super Bowl)
 */
function applyPeriodLayout(period, config = {}) {
    console.log('[PeriodManager] Applying layout for period:', period);

    // First, reset everything to default
    if (window.DefaultPeriod) {
        window.DefaultPeriod.activate();
    }

    // Then apply period-specific layout
    switch (period) {
        case 'PLAYOFFS':
            if (window.SuperBowlWeek) {
                window.SuperBowlWeek.activate(config.finalists);
            } else {
                console.error('[PeriodManager] SuperBowlWeek module not loaded!');
            }
            break;

        case 'REGULAR_SEASON':
            // Game Week layout - to be implemented
            console.log('[PeriodManager] Regular season - using default layout');
            break;

        case 'PRE_DRAFT':
        case 'POST_SUPER_BOWL':
        default:
            // Use default layout
            console.log('[PeriodManager] Using default layout');
            break;
    }
}

/**
 * Initialize period layouts
 * Called on page load
 */
function initPeriodLayouts() {
    console.log('[PeriodManager] Initializing period layouts');

    // Check if modules are loaded
    if (!window.SuperBowlWeek) {
        console.warn('[PeriodManager] SuperBowlWeek module not loaded');
    }
    if (!window.DefaultPeriod) {
        console.warn('[PeriodManager] DefaultPeriod module not loaded');
    }
}

// Export for use in main script
window.PeriodManager = {
    apply: applyPeriodLayout,
    init: initPeriodLayouts
};
