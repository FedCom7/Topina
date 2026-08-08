/**
 * Regole ufficiali della Topina League — fonte di verità unica.
 *
 * Confermate da Federico l'12/07/2026. In precedenza lo scoring era stato
 * DEDOTTO per regressione sulle prestazioni storiche (vedi git log di
 * scoring.js): il confronto con queste regole ufficiali ha validato quei
 * coefficienti quasi alla perfezione — l'unico pezzo mancante era il ritorno
 * di un 2pt conversion avversario da parte della difesa.
 *
 * Se la lega cambia regolamento, modifica SOLO questo file: scoring.js,
 * i moduli di proiezione/pronostico (projections.js, player-full.js,
 * draft-predictions.js) e lo script build-nfl-team-stats.mjs leggono tutti
 * da qui.
 */

// Formazione titolare. Il FLEX di questa lega è SOLO RB/WR (niente TE).
export const ROSTER_SLOTS = { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DEF: 1 };
export const FLEX_ELIGIBLE = ['RB', 'WR'];
export const BENCH_SIZE = 6;
export const RESERVE_SIZE = 1; // slot IR

// Playoff: settimane 16-17 (eccezione 2021, 18 settimane totali, gestita
// separatamente in data.js:getSeasonConfig).
export const PLAYOFF_WEEKS = { start: 16, end: 17 };
export const STANDINGS_TIEBREAKER = 'head-to-head';

/** Punti lega per statistica. Nomi coerenti sia col formato Sleeper (via
 * scoring.js:SLEEPER_MAP) sia col formato Firebase della lega (plurale). */
export const SCORING = {
    // passaggio — 25 yard = 1 punto
    pass_yd: 1 / 25,
    pass_td: 4,
    pass_int: -2,
    // corsa — 10 yard = 1 punto
    rush_yd: 1 / 10,
    rush_td: 6,
    // ricezione — full PPR, 10 yard = 1 punto
    rec: 1,
    rec_yd: 1 / 10,
    rec_td: 6,
    // varie offense
    fum_lost: -2,
    two_pt: 2, // conversione da 2 punti: passaggio, corsa o ricezione
    ret_td: 6, // TD su ritorno kickoff/punt
    fum_td: 6, // fumble recuperato e portato in touchdown
    // kicker (nota: FG 40-49 vale 3, non 4 come lo standard Yahoo)
    fg_0_19: 3,
    fg_20_29: 3,
    fg_30_39: 3,
    fg_40_49: 3,
    fg_50_plus: 5,
    pat_made: 1,
    // difesa / special teams
    sack: 1,
    def_int: 2,
    fum_rec: 2,
    def_td: 6,
    def_ret_td: 6,     // TD su ritorno kickoff/punt della difesa
    def_two_pt_ret: 2, // difesa che ritorna un 2pt conversion avversario
    safety: 2,
    // punti subiti dalla difesa per gara: [maxPuntiSubiti, punti]
    // Fasce verificate sui dati veri: 68 difese della stagione 2024, per
    // ognuna punti concessi e bonus effettivamente assegnato. Il confine è
    // 20 → 1 e 21 → 0, senza eccezioni.
    //
    // Nota: l'8 agosto 2026 avevo spostato quel confine a 21 assumendo che le
    // fasce fossero le nove standard ESPN (…/18-21/22-27/…). Assunzione
    // sbagliata, ripristinato. L'unica fascia non confermata dai dati è quella
    // dello shutout: nel campione non c'è nessuna difesa che abbia davvero
    // concesso 0 punti.
    def_pts_allowed_tiers: [
        [0, 10], [6, 7], [13, 4], [20, 1], [27, 0], [34, -1], [Infinity, -4],
    ],
};
