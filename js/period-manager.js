/**
 * Period Manager
 * Orchestrates period-specific layout changes on the home page.
 */
import { activateSuperBowlWeek, deactivateSuperBowlWeek } from './periods/superbowl-week.js';
import { activateDefaultLayout } from './periods/default.js';

/**
 * Apply period-specific layout
 */
export function applyPeriodLayout(period, config = {}) {
    // First, reset everything to default
    activateDefaultLayout();

    // Then apply period-specific layout
    switch (period) {
        case 'PLAYOFFS':
            activateSuperBowlWeek(config.finalists);
            break;

        case 'REGULAR_SEASON':
        case 'PRE_DRAFT':
        case 'POST_SUPER_BOWL':
        default:
            // Default layout is already active
            break;
    }
}
