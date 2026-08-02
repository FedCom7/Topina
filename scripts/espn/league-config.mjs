/**
 * Configurazione della lega ESPN — valori noti/confermati e mappe di
 * traduzione ESPN → schema legacy. Il mapping teamId→displayName si popola
 * dopo il primo smoke test su mTeam (Step 3 del blueprint): finché è vuoto,
 * il normalizer usa l'abbreviazione ESPN come fallback.
 */

export const ESPN_LEAGUE_ID = '1948241900';

// Prima stagione nativa ESPN. 2019–2025 restano i JSON storici, mai riscritti.
export const FIRST_ESPN_SEASON = 2026;

/**
 * teamId ESPN (numero, in mTeam[].id) → displayName legacy (lo stesso usato
 * in TEAM_DISPLAY_NAMES / js/sections/team.js). Confermato via smoke test
 * reale su mTeam (2026-08-02): il campo utile è teams[].name diretto — NON
 * location+nickname (entrambi vuoti in questa lega). Team id=2 ("lasers",
 * abbrev TM2) non ha ancora un owner assegnato (teamsJoined:3/4) — nome
 * comunque già leggibile dalla lega.
 */
export const TEAM_ID_TO_NAME = {
    1: 'Oscurus',
    2: 'Lasers',
    3: 'Sommo',
    4: 'Capi dei Pianeti',
};

/**
 * statId ESPN → chiave legacy in starters[].stats{}. Gli ID base (yardaggio,
 * TD, ricezioni) sono stabili e concordi tra le fonti community; fumble,
 * 2-pt e return-TD vanno verificati contro un boxscore reale prima di
 * fidarsi (vedi Step 4.3 del blueprint — validare i totali fantasy_points).
 */
export const STAT_ID_MAP = {
    3: 'pass_yds',
    4: 'pass_td',
    20: 'pass_int',
    24: 'rush_yds',
    25: 'rush_td',
    53: 'rec',
    42: 'rec_yds',
    43: 'rec_td',
    72: 'fum_lost',
    // 2-pt conversion (pass/rush/rec) — sommati in un solo two_pt legacy
    19: 'two_pt', 26: 'two_pt', 44: 'two_pt',
    // Return/fumble TD — da confermare, ID incerti nelle fonti community
    101: 'ret_td', 102: 'ret_td', 103: 'ret_td', 104: 'ret_td',
    // Kicker
    83: 'pat_made',
    77: 'fg_0_19', 78: 'fg_20_29', 79: 'fg_30_39', 80: 'fg_40_49', 81: 'fg_50_plus',
    // Defense/IDP
    99: 'sack',
    95: 'def_int',
    96: 'fum_rec',
    98: 'safety',
    97: 'def_td',
};

/**
 * lineupSlotId ESPN → posizione legacy. 20 (Bench) e 21 (IR) non sono
 * "starter": vanno smistati in bench[] come su NFL.com.
 */
export const SLOT_ID_MAP = {
    0: 'QB',
    2: 'RB',
    3: 'RB/WR',
    4: 'WR',
    6: 'TE',
    16: 'D/ST',
    17: 'K',
    23: 'FLEX',
    20: 'BN',
    21: 'IR',
};

export const BENCH_SLOT_IDS = new Set([20, 21]);

/** proTeamId ESPN → abbreviazione NFL (2/3 lettere), per opponent/nfl_team. */
export const PRO_TEAM_ABBR = {
    0: 'FA', 1: 'ATL', 2: 'BUF', 3: 'CHI', 4: 'CIN', 5: 'CLE', 6: 'DAL', 7: 'DEN',
    8: 'DET', 9: 'GB', 10: 'TEN', 11: 'IND', 12: 'KC', 13: 'LV', 14: 'LAR', 15: 'MIA',
    16: 'MIN', 17: 'NE', 18: 'NO', 19: 'NYG', 20: 'NYJ', 21: 'PHI', 22: 'ARI', 23: 'PIT',
    24: 'LAC', 25: 'SF', 26: 'SEA', 27: 'TB', 28: 'WSH', 29: 'CAR', 30: 'JAX', 33: 'BAL', 34: 'HOU',
};
