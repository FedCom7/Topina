/**
 * Team Configuration & Constants
 * Central source of truth for team data, season dates, and mappings.
 */

// Current active season
export const CURRENT_SEASON = '2024';

// NFL Season Dates (2024–2025)
export const NFL_DATES = {
    draftStart: new Date('2025-04-24'),
    draftEnd: new Date('2025-04-26'),
    seasonStart: new Date('2024-09-05'),
    seasonEnd: new Date('2025-01-05'),
    playoffsStart: new Date('2025-01-11'),
    superBowl: new Date('2025-02-09'),
    celebrationEnd: new Date('2025-02-23'),
};

// Current champion (update after each season)
export const CURRENT_CHAMPION = {
    name: 'Loading...',
    logo: '🏆',
    record: '-',
    year: '-'
};

// Team name → key mapping
export const TEAM_KEYS = {
    'Capi dei Pianeti': 'capi',
    'Lasers': 'lasers',
    'Oscurus': 'oscurus',
    'Sommo': 'sommo'
};

// Team logo paths
export const TEAM_LOGOS = {
    'Capi dei Pianeti': 'Team Logo/IMG_1065.JPG',
    'Lasers': 'Team Logo/IMG_4979.JPG',
    'Oscurus': 'Team Logo/IMG_8063.JPG',
    'Sommo': 'Team Logo/IMG_8064.JPG'
};

// Stadium background images for Super Bowl matchups
export const STADIUM_IMAGES = {
    'capi_lasers': 'images/sb_capi_lasers.png',
    'capi_oscurus': 'images/sb_capi_oscurus.png',
    'capi_sommo': 'images/sb_capi_sommo.png',
    'lasers_oscurus': 'images/sb_lasers_oscurus.png',
    'lasers_sommo': 'images/sb_lasers_sommo.png',
    'oscurus_sommo': 'images/sb_oscurus_sommo.png',
    'default': 'images/stadium_bg.png'
};

/**
 * Get stadium image path for a given matchup
 */
export function getStadiumImage(team1, team2) {
    const key1 = TEAM_KEYS[team1];
    const key2 = TEAM_KEYS[team2];
    if (!key1 || !key2) return STADIUM_IMAGES.default;

    const matchupKey = [key1, key2].sort().join('_');
    return STADIUM_IMAGES[matchupKey] || STADIUM_IMAGES.default;
}
