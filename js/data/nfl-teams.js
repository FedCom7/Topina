/**
 * Identità delle 32 squadre NFL (nome esteso, conference/division, colori
 * ufficiali) — dato statico e stabile (cambia solo su rebrand/trasloco di
 * franchigia), sorgente nflverse `teams_colors_logos.csv`. Chiavi canoniche
 * come `canonAbbr()` in nfl-schedule.js/lib/nflverse.mjs (WAS non WSH, JAX
 * non JAC, LAR non LA/STL, LAC non SD, LV non OAK).
 */

export const NFL_TEAMS = {
    ARI: { name: 'Arizona Cardinals', conf: 'NFC', division: 'NFC West', color: '#97233F', color2: '#000000' },
    ATL: { name: 'Atlanta Falcons', conf: 'NFC', division: 'NFC South', color: '#A71930', color2: '#000000' },
    BAL: { name: 'Baltimore Ravens', conf: 'AFC', division: 'AFC North', color: '#241773', color2: '#9E7C0C' },
    BUF: { name: 'Buffalo Bills', conf: 'AFC', division: 'AFC East', color: '#00338D', color2: '#C60C30' },
    CAR: { name: 'Carolina Panthers', conf: 'NFC', division: 'NFC South', color: '#0085CA', color2: '#000000' },
    CHI: { name: 'Chicago Bears', conf: 'NFC', division: 'NFC North', color: '#0B162A', color2: '#E64100' },
    CIN: { name: 'Cincinnati Bengals', conf: 'AFC', division: 'AFC North', color: '#FB4F14', color2: '#000000' },
    CLE: { name: 'Cleveland Browns', conf: 'AFC', division: 'AFC North', color: '#FF3C00', color2: '#311D00' },
    DAL: { name: 'Dallas Cowboys', conf: 'NFC', division: 'NFC East', color: '#002244', color2: '#B0B7BC' },
    DEN: { name: 'Denver Broncos', conf: 'AFC', division: 'AFC West', color: '#002244', color2: '#FB4F14' },
    DET: { name: 'Detroit Lions', conf: 'NFC', division: 'NFC North', color: '#0076B6', color2: '#B0B7BC' },
    GB: { name: 'Green Bay Packers', conf: 'NFC', division: 'NFC North', color: '#203731', color2: '#FFB612' },
    HOU: { name: 'Houston Texans', conf: 'AFC', division: 'AFC South', color: '#03202F', color2: '#A71930' },
    IND: { name: 'Indianapolis Colts', conf: 'AFC', division: 'AFC South', color: '#002C5F', color2: '#A5ACAF' },
    JAX: { name: 'Jacksonville Jaguars', conf: 'AFC', division: 'AFC South', color: '#006778', color2: '#000000' },
    KC: { name: 'Kansas City Chiefs', conf: 'AFC', division: 'AFC West', color: '#E31837', color2: '#FFB612' },
    LAR: { name: 'Los Angeles Rams', conf: 'NFC', division: 'NFC West', color: '#003594', color2: '#FFD100' },
    LAC: { name: 'Los Angeles Chargers', conf: 'AFC', division: 'AFC West', color: '#007BC7', color2: '#FFC20E' },
    LV: { name: 'Las Vegas Raiders', conf: 'AFC', division: 'AFC West', color: '#000000', color2: '#A5ACAF' },
    MIA: { name: 'Miami Dolphins', conf: 'AFC', division: 'AFC East', color: '#008E97', color2: '#F58220' },
    MIN: { name: 'Minnesota Vikings', conf: 'NFC', division: 'NFC North', color: '#4F2683', color2: '#FFC62F' },
    NE: { name: 'New England Patriots', conf: 'AFC', division: 'AFC East', color: '#002244', color2: '#C60C30' },
    NO: { name: 'New Orleans Saints', conf: 'NFC', division: 'NFC South', color: '#D3BC8D', color2: '#000000' },
    NYG: { name: 'New York Giants', conf: 'NFC', division: 'NFC East', color: '#0B2265', color2: '#A71930' },
    NYJ: { name: 'New York Jets', conf: 'AFC', division: 'AFC East', color: '#003F2D', color2: '#000000' },
    PHI: { name: 'Philadelphia Eagles', conf: 'NFC', division: 'NFC East', color: '#004C54', color2: '#A5ACAF' },
    PIT: { name: 'Pittsburgh Steelers', conf: 'AFC', division: 'AFC North', color: '#000000', color2: '#FFB612' },
    SEA: { name: 'Seattle Seahawks', conf: 'NFC', division: 'NFC West', color: '#002244', color2: '#69BE28' },
    SF: { name: 'San Francisco 49ers', conf: 'NFC', division: 'NFC West', color: '#AA0000', color2: '#B3995D' },
    TB: { name: 'Tampa Bay Buccaneers', conf: 'NFC', division: 'NFC South', color: '#A71930', color2: '#322F2B' },
    TEN: { name: 'Tennessee Titans', conf: 'AFC', division: 'AFC South', color: '#4495D2', color2: '#D50A0A' },
    WAS: { name: 'Washington Commanders', conf: 'NFC', division: 'NFC East', color: '#5A1414', color2: '#FFB612' },
};

/** Identità squadra per sigla canonica, o null se non riconosciuta. */
export function getTeamIdentity(abbr) {
    return NFL_TEAMS[(abbr || '').toUpperCase()] || null;
}
