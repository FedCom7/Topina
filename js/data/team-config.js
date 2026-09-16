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
    logo: '',
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

/**
 * I TRE COLORI DI OGNI SQUADRA — fonte unica.
 *
 * Prima ce n'era uno solo (`TEAMS[].color` in sections/team.js) più un secondo
 * set schiarito COPIATO in due file (`CHART_COLORS` in analysis.js e
 * `CHART_COLORS_BY_KEY` in stats.js), con gli stessi valori scritti due volte.
 * I tre ruoli adesso sono dichiarati:
 *
 *  - `identity` — il colore della franchigia. È quello che finisce in
 *    `--team-color` e tinge hero, sticker, card e bordi.
 *  - `bright`   — lo stesso colore reso leggibile SU FONDO NERO. Per Capi e
 *    Lasers coincide con l'identità; per Oscurus e Sommo no, ed è il motivo per
 *    cui il secondo set esisteva: un bordeaux #800020 e un petrolio #1c4750 su
 *    un grafico nero spariscono. Va usato per linee, punti e testo su scuro.
 *  - `ink`      — la versione cupa, per i pieni grandi e i fondali: una
 *    campitura larga del colore d'identità copre troppo.
 *
 * Cambiando un valore qui cambia ovunque. Le altre tinte (i colori dei
 * grafici) NON vanno reintrodotte altrove: si legge da qui.
 */
export const TEAM_PALETTE = {
    capi: { identity: '#FF6600', bright: '#FF6600', ink: '#7a3000' },
    lasers: { identity: '#D4AF37', bright: '#D4AF37', ink: '#6b5416' },
    oscurus: { identity: '#800020', bright: '#d4506a', ink: '#4d0013' },
    sommo: { identity: '#1c4750', bright: '#4fa3b8', ink: '#0e2429' },
};

/** Le tre tinte come variabili CSS, da appendere a un contenitore. */
export function teamPaletteVars(key) {
    const p = TEAM_PALETTE[key];
    if (!p) return '';
    return `--team-color:${p.identity};--team-bright:${p.bright};--team-ink:${p.ink}`;
}

// Team logo paths
export const TEAM_LOGOS = {
    'Capi dei Pianeti': 'Team Logo/team_capi_transparent.png',
    'Lasers': 'Team Logo/team_lasers_transparent.png',
    'Oscurus': 'Team Logo/team_oscurus_transparent.png',
    'Sommo': 'Team Logo/team_sommo_transparent.png'
};

/**
 * Correzione ottica dei loghi: i quattro PNG sono quadrati, ma il disegno
 * occupa una porzione diversa della tela (misurata sul bounding box opaco:
 * lasers 79% dell'altezza, oscurus 74%, capi 70%, sommo 59%). Affiancati alla
 * stessa dimensione, Sommo sembra piccolo e Lasers grande.
 *
 * I fattori pareggiano l'altezza disegnata e sono tutti <= 1, cioè si scala
 * solo verso il basso: scalando verso l'alto il logo uscirebbe dal proprio
 * riquadro e verrebbe tagliato. Per ingrandirli si allarga il riquadro, non
 * questi valori. Da applicare come `scale` — proporzioni intatte.
 */
export const TEAM_LOGO_SCALE = {
    capi: 0.845,
    lasers: 0.744,
    oscurus: 0.794,
    sommo: 1,
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
