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

// ─── Punti di una singola giocata (play-by-play) ─────────────────

/**
 * Quanti punti fantasy ha prodotto UNA giocata, e a chi.
 *
 * Prende una giocata normalizzata da js/data/nfl-plays.js e restituisce un
 * contributo per ogni protagonista che guadagna (o perde) punti:
 *
 *   [{ espnId, role, pts, line }]           giocatori
 *   [{ defTeamId, role, pts, line }]        unità di difesa (l'ID team ESPN)
 *
 * I tipi coperti sono quelli osservati sul play-by-play reale: ricezione,
 * corsa, TD su passaggio/corsa (che include già l'extra point nella stessa
 * giocata), incompleto, intercetto, sack, field goal, TD su ritorno.
 * Tutto il resto ritorna [] — la giocata resta visibile, senza punti.
 *
 * ATTENZIONE: è un ricalcolo nostro, non un dato ESPN. Serve a dire "questa
 * azione vale +1.6", non a sostituire il totale ufficiale del giocatore, che
 * resta quello del feed fantasy.
 */
export function scorePlay(play) {
    if (!play) return [];
    const S = LEAGUE_SCORING;
    const { type = '', text = '', yards = 0, actors = {}, defenseTeamId } = play;

    // Penalità che annulla l'azione: il tipo resta "Pass Reception" o "Rush",
    // ma la giocata non è mai avvenuta e a nessuno conta niente. Senza questo
    // controllo a Mahomes finivano 31 yard di passaggio e 14 di corsa mai
    // realizzate (misurato contro i punti veri della lega, week 3 2025).
    if (/No Play/i.test(text)) return [];
    const out = [];
    // `stats` sono gli incrementi grezzi della giocata (una ricezione, otto
    // yard...): servono a chi deve aggiornare un totale, non solo a mostrare
    // i punti.
    const add = (espnId, role, pts, line, stats) => {
        if (espnId) out.push({ espnId, role, pts: +(+pts).toFixed(2), line, stats: stats || {} });
    };
    const addDef = (role, pts, line, stats) => {
        if (defenseTeamId) out.push({ defTeamId: String(defenseTeamId), role, pts: +(+pts).toFixed(2), line, stats: stats || {} });
    };

    const passTD = type === 'Passing Touchdown';
    const rushTD = type === 'Rushing Touchdown';
    const retTD = /Return Touchdown/i.test(type) && !/Interception/i.test(type);

    // Su un fumble la giocata che lo precede conta comunque: chi ha ricevuto
    // tiene ricezione e yard, chi correva tiene le sue. Il tipo però è
    // "Fumble Recovery (…)", non "Pass Reception", e senza questo ramo quelle
    // statistiche sparivano (misurato: -2.50 su una ricezione da 15 yard).
    const fumble = /^Fumble Recovery|^Sack Opp Fumble/i.test(type);
    if (fumble) {
        if (actors.receiver) {
            add(actors.receiver, 'receiver', S.rec + yards * S.rec_yd, `${yards} yd · 1 rec`,
                { targets: 1, rec: 1, rec_yds: yards });
            add(actors.passer, 'passer', yards * S.pass_yd, `${yards} yd`,
                { pass_att: 1, pass_comp: 1, pass_yds: yards });
        } else if (actors.rusher) {
            add(actors.rusher, 'rusher', yards * S.rush_yd, `${yards} yd`,
                { rush_att: 1, rush_yds: yards });
        }
        // Il fumble perso pesa su chi aveva la palla, che ESPN non marca fra i
        // partecipanti: si prende il protagonista della giocata.
        if (/Opponent|Sack Opp Fumble/i.test(type)) {
            add(actors.receiver || actors.rusher || actors.passer, 'fumble',
                S.fum_lost, 'fumble lost', { fum_lost: 1 });
        }
        return out;
    }

    if (type === 'Pass Reception' || passTD) {
        add(actors.passer, 'passer', yards * S.pass_yd + (passTD ? S.pass_td : 0), `${yards} yd`,
            { pass_att: 1, pass_comp: 1, pass_yds: yards, pass_td: passTD ? 1 : 0 });
        add(actors.receiver, 'receiver', S.rec + yards * S.rec_yd + (passTD ? S.rec_td : 0), `${yards} yd · 1 rec`,
            { targets: 1, rec: 1, rec_yds: yards, rec_td: passTD ? 1 : 0 });
    } else if (type === 'Rush' || rushTD) {
        add(actors.rusher, 'rusher', yards * S.rush_yd + (rushTD ? S.rush_td : 0), `${yards} yd`,
            { rush_att: 1, rush_yds: yards, rush_td: rushTD ? 1 : 0 });
    } else if (type === 'Pass Incompletion') {
        add(actors.passer, 'passer', 0, 'incomplete', { pass_att: 1 });
        add(actors.receiver, 'receiver', 0, 'target', { targets: 1 });
    } else if (/^Pass Interception Return|^Interception Return Touchdown/i.test(type)) {
        // il pick-six resta un intercetto per il quarterback
        add(actors.passer, 'passer', S.pass_int, 'intercepted', { pass_att: 1, pass_int: 1 });
        const six = /Touchdown/i.test(type);
        addDef('def_int', S.def_int + (six ? S.def_td : 0), six ? 'pick six' : 'interception',
            { def_int: 1, def_td: six ? 1 : 0 });
    } else if (type === 'Sack') {
        add(actors.passer, 'passer', 0, `sacked · ${yards} yd`, {});
        addDef('sack', S.sack, 'sack', { sack: 1 });
    } else if (type === 'Field Goal Good') {
        const pts = yards >= 50 ? S.fg_50_plus : yards >= 40 ? S.fg_40_49 : S.fg_30_39;
        const band = yards >= 50 ? 'fg_50_plus' : yards >= 40 ? 'fg_40_49' : 'fg_0_39';
        add(actors.kicker, 'kicker', pts, `${yards} yd FG`,
            { fg_made: 1, fg_att: 1, [band]: 1 });
    } else if (retTD) {
        add(actors.returner, 'returner', S.ret_td, `${yards} yd return`, { ret_td: 1 });
    }

    // L'extra point sta nella stessa giocata del touchdown, non in una sua.
    // Si accredita solo se il testo dice che è andato dentro.
    if ((passTD || rushTD || retTD) && /extra point is good/i.test(text)) {
        add(actors.patScorer || actors.kicker, 'kicker', S.pat_made, 'extra point', { pat_made: 1 });
    }

    return out;
}
