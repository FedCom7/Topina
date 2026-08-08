/**
 * Scoring della Topina League — regole ufficiali, vedi league-rules.js
 * (unica fonte da modificare se la lega cambia regolamento).
 *
 * Nota storica: prima di avere le regole ufficiali questi coefficienti
 * erano stati DEDOTTI per regressione sulle prestazioni storiche e si sono
 * rivelati esatti al confronto — mancava solo il ritorno di un 2pt
 * conversion avversario da parte della difesa (`def_two_pt_ret`).
 */

import { SCORING as LEAGUE_SCORING } from './league-rules.js?v=20';
export { LEAGUE_SCORING };

/**
 * Mappa campi proiezioni Sleeper → coefficienti nostri.
 * (Sleeper usa nomi al singolare: pass_yd, rush_yd, rec_yd, fgm_*)
 */
const SLEEPER_MAP = {
    pass_yd: 'pass_yd', pass_td: 'pass_td', pass_int: 'pass_int',
    rush_yd: 'rush_yd', rush_td: 'rush_td',
    rec: 'rec', rec_yd: 'rec_yd', rec_td: 'rec_td',
    fum_lost: 'fum_lost',
    pass_2pt: 'two_pt', rush_2pt: 'two_pt', rec_2pt: 'two_pt',
    fgm_0_19: 'fg_0_19', fgm_20_29: 'fg_20_29', fgm_30_39: 'fg_30_39',
    fgm_40_49: 'fg_40_49', fgm_50p: 'fg_50_plus', xpm: 'pat_made',
    sack: 'sack', int: 'def_int', fum_rec: 'fum_rec',
    def_td: 'def_td', def_st_td: 'def_ret_td', safe: 'safety',
    def_2pt: 'def_two_pt_ret',
};

/**
 * Converte le stat proiettate di Sleeper (stagionali) nei punti della lega.
 * Ritorna null se le stat non contengono nulla di valutabile (es. kicker
 * senza proiezioni): il chiamante applicherà il fallback su pts_std.
 */
export function scoreProjectedStats(stats) {
    if (!stats) return null;
    let pts = 0, hit = false;
    for (const [sk, ours] of Object.entries(SLEEPER_MAP)) {
        const v = parseFloat(stats[sk]);
        if (!v) continue;
        pts += v * LEAGUE_SCORING[ours];
        hit = true;
    }
    return hit ? +pts.toFixed(1) : null;
}

/** Punti di una singola prestazione storica dai raw stats (per validazione) */
export function scoreWeeklyStats(stats, pos) {
    if (!stats) return null;
    const S = LEAGUE_SCORING;
    const g = (k) => parseFloat(stats[k]) || 0;
    let pts =
        g('pass_yds') * S.pass_yd + g('pass_td') * S.pass_td + g('pass_int') * S.pass_int +
        g('rush_yds') * S.rush_yd + g('rush_td') * S.rush_td +
        g('rec') * S.rec + g('rec_yds') * S.rec_yd + g('rec_td') * S.rec_td +
        g('fum_lost') * S.fum_lost + g('two_pt') * S.two_pt +
        g('ret_td') * S.ret_td + g('fum_td') * S.fum_td +
        g('fg_0_19') * S.fg_0_19 + g('fg_20_29') * S.fg_20_29 + g('fg_30_39') * S.fg_30_39 +
        g('fg_40_49') * S.fg_40_49 + g('fg_50_plus') * S.fg_50_plus + g('pat_made') * S.pat_made;
    if (pos === 'DEF') {
        pts += g('sack') * S.sack + g('def_int') * S.def_int + g('fum_rec') * S.fum_rec +
            g('def_td') * S.def_td + g('def_ret_td') * S.def_ret_td + g('safety') * S.safety +
            g('def_2pt_ret') * S.def_two_pt_ret;
        const pa = g('pts_allowed');
        for (const [max, p] of S.def_pts_allowed_tiers) {
            if (pa <= max) { pts += p; break; }
        }
    }
    return pts;
}

/**
 * Guardia di qualità (dev): confronta i punti ricalcolati con quelli
 * registrati su una stagione e logga l'errore. Da chiamare in console.
 */
export function validateScoring(fantasyData) {
    let n = 0, sum = 0, max = 0, worst = null;
    Object.values(fantasyData?.weeks || {}).forEach(wk => (wk.matchups || []).forEach(m =>
        [m.team1, m.team2].forEach(t => t && [...(t.starters || []), ...(t.bench || [])].forEach(p => {
            if (!p.stats) return;
            const pos = (p.position_in_team || p.position || '').toUpperCase();
            const calc = scoreWeeklyStats(p.stats, pos);
            const real = parseFloat(p.fantasy_points) || 0;
            const err = Math.abs(calc - real);
            n++; sum += err;
            if (err > max) { max = err; worst = `${p.name} (${pos}): calc ${calc.toFixed(2)} vs real ${real}`; }
        }))));
    console.log(`[scoring] ${n} prestazioni — errore medio ${(sum / n).toFixed(4)}, max ${max.toFixed(2)} (${worst})`);
    return { n, avg: sum / n, max };
}
