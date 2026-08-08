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
 * statId ESPN → chiave legacy in starters[].stats{}.
 *
 * Verificati il 2026-08-08 contro due fonti reali, non più contro le fonti
 * community: le voci di punteggio ufficiali della lega
 * (`?view=mSettings` → settings.scoringSettings.scoringItems, 30 voci) e
 * l'insieme di statId realmente presenti in un boxscore per posizione.
 * Il punteggio associato a ogni ID combacia con SCORING in
 * js/data/league-rules.js, che era stato dedotto per regressione: è la
 * conferma incrociata che quei coefficienti erano corretti.
 *
 * Correzioni rispetto alla versione precedente (indovinata): kicker
 * 74/77/80/86 al posto di 77-81/83, DEF TD 105 al posto di 97, aggiunto
 * il ritorno di un 2-pt avversario (205).
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
    // 2-pt conversion (pass/rush/rec) — sommati in un solo two_pt legacy.
    // A punteggio la lega usa una voce unica (62); qui restano i tre ID di
    // conteggio grezzo, tutti presenti nel boxscore.
    19: 'two_pt', 26: 'two_pt', 44: 'two_pt',
    // Return/fumble TD — nessuna voce di punteggio dedicata nelle impostazioni
    // (la lega usa la voce unica 63 da 6 punti): questi restano gli ID di
    // conteggio, da confermare su una partita giocata.
    101: 'ret_td', 102: 'ret_td', 103: 'ret_td', 104: 'ret_td',
    // Kicker: 74/77/80 sono i FG riusciti per fascia (50+, 40-49, 0-39),
    // 83/84 il totale fatti/tentati, 86 gli extra point.
    74: 'fg_50_plus', 77: 'fg_40_49', 80: 'fg_0_39',
    83: 'fg_made', 84: 'fg_att', 86: 'pat_made',
    // Defense/ST
    99: 'sack',
    95: 'def_int',
    96: 'fum_rec',
    98: 'safety',
    105: 'def_td',
    205: 'def_2pt_ret',
    120: 'pts_allowed',
};

/**
 * Voci di punteggio ufficiali della lega, lette da
 * `?view=mSettings` il 2026-08-08 (statId → punti). Serve come riferimento
 * per non re-indovinare gli ID: chi calcola punti usa SCORING in
 * js/data/league-rules.js, che dice le stesse cose in chiave leggibile.
 *
 * Le fasce di punti subiti dalla difesa sono le nove standard ESPN:
 * 0 / 1-6 / 7-13 / 14-17 / 18-21 / 22-27 / 28-34 / 35-45 / 46+.
 */
export const LEAGUE_SCORING_ITEMS = {
    8: 1,    // ogni 25 yard su passaggio
    4: 4,    // TD su passaggio
    20: -2,  // intercetto subito
    28: 1,   // ogni 10 yard su corsa
    25: 6,   // TD su corsa
    48: 1,   // ogni 10 yard su ricezione
    53: 1,   // ricezione (PPR pieno)
    43: 6,   // TD su ricezione
    72: -2,  // fumble perso
    62: 2,   // conversione da 2 punti
    63: 6,   // TD su ritorno / fumble recuperato
    74: 5, 77: 3, 80: 3, 86: 1,                    // kicker
    99: 1, 95: 2, 96: 2, 98: 2, 105: 6, 205: 2,    // difesa
    89: 10, 90: 7, 91: 4, 92: 1,                   // punti subiti 0 / 1-6 / 7-13 / 14-17
    121: 1, 122: 0, 123: -1, 124: -4, 125: -4,     // 18-21 / 22-27 / 28-34 / 35-45 / 46+
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
