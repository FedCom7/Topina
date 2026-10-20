/**
 * Catalogo delle dimensioni tattiche — UNA definizione per dimensione, letta
 * da due parti:
 *  - `scripts/build-nfl-tactics.mjs` usa `filtro` e `valore` per contare le
 *    giocate di ogni squadra (in attacco e in difesa);
 *  - `js/sections/nfl-tactics.js` usa `label`, `gruppo` e `ordine` per
 *    disegnarle.
 * Aggiungere una dimensione qui la porta in tutti e due i posti; non va
 * ripetuta altrove.
 *
 * Le funzioni leggono la riga GREZZA della giocata, con i nomi di colonna di
 * nflverse: play-by-play (`pbp`), participation (`part_*`, prefissate dal
 * builder perché alcune colonne si chiamano come quelle del pbp) e FTN
 * charting (`ftn_*`). Una funzione che restituisce null scarta la giocata
 * per quella dimensione.
 *
 * `fonte` dice da dove viene, e quindi per quali anni esiste:
 *   pbp   1999–oggi (il sito parte dal 2016)
 *   part  2016–2025 (participation: la stagione in corso esce a fine anno)
 *   ftn   2022–oggi (FTN charting)
 */

const sì = (v) => v === 'TRUE' || v === '1' || v === 1 || v === true;
const n = (v) => (v === '' || v == null || v === 'NA' ? null : Number(v));
const pass = (r) => r.pass === '1';
const run = (r) => r.rush === '1' && r.pass !== '1';
const dropback = (r) => r.qb_dropback === '1';
const bersaglio = (r) => r.pass_attempt === '1' && r.sack !== '1' && !!r.receiver_player_id;
/** FTN segna "0" le giocate che non ha classificato: non sono un valore. */
const ftnVal = (v) => (v === '0' || v === '' || v == null ? null : v);

/** "1 C, 2 G, 1 QB, 1 RB, 2 T, 1 TE, 3 WR" (dal 2023) o "1 RB, 1 TE, 3 WR"
 *  (prima) → "11". Uomini di linea oltre i cinque: "+OL" (jumbo). */
export function codicePersonnel(s) {
    if (!s) return null;
    const c = {};
    for (const parte of String(s).split(',')) {
        const m = /(\d+)\s+([A-Z]+)/.exec(parte.trim());
        if (m) c[m[2]] = (c[m[2]] || 0) + +m[1];
    }
    const rb = (c.RB || 0) + (c.FB || 0), te = c.TE || 0, wr = c.WR || 0;
    if (!rb && !te && !wr) return null;
    const ol = (c.OL || 0) + (c.T || 0) + (c.G || 0) + (c.C || 0);
    const extra = ol > 5 ? ` +${ol - 5}OL` : '';
    // Un DL o un LB schierato in attacco (goal line) conta come "extra".
    const dif = (c.DL || 0) + (c.DT || 0) + (c.DE || 0) + (c.LB || 0) + (c.ILB || 0) + (c.OLB || 0) + (c.NT || 0);
    return `${rb}${te}${extra}${dif ? ' +D' : ''}`;
}

/** "3 CB, 2 DT, 1 FS, 2 ILB, 2 OLB, 1 SS" o "4 DL, 2 LB, 5 DB" → pacchetto.
 *  Si conta per reparto (DL / LB / DB): è il conto che distingue una nickel
 *  da una base, a prescindere da come la squadra chiama i suoi edge. */
export function pacchettoDifesa(s) {
    if (!s) return null;
    let dl = 0, lb = 0, db = 0;
    for (const parte of String(s).split(',')) {
        const m = /(\d+)\s+([A-Z]+)/.exec(parte.trim());
        if (!m) continue;
        const k = +m[1], p = m[2];
        if (['DL', 'DT', 'DE', 'NT'].includes(p)) dl += k;
        else if (['LB', 'ILB', 'OLB', 'MLB'].includes(p)) lb += k;
        else if (['DB', 'CB', 'S', 'SS', 'FS'].includes(p)) db += k;
    }
    if (dl + lb + db < 10) return null;
    const forma = `${dl}-${lb}-${db}`;
    if (db <= 3) return `Goal line / heavy (${forma})`;
    if (db === 4) return `Base (${forma})`;
    if (db === 5) return `Nickel (${forma})`;
    if (db === 6) return `Dime (${forma})`;
    return `Quarter / dollar (${forma})`;
}

const fascia = (x, tagli, etichette) => {
    if (x == null || Number.isNaN(x)) return null;
    for (let i = 0; i < tagli.length; i++) if (x <= tagli[i]) return etichette[i];
    return etichette[etichette.length - 1];
};

/**
 * Le dimensioni. `lato` dice da chi si leggono:
 *   'both'  la stessa misura in attacco (cosa fai) e in difesa (cosa concedi);
 *   le dimensioni di schema difensivo (copertura, box, blitz) restano 'both'
 *   anche loro: in difesa è cosa mostri, in attacco è cosa ti hanno mostrato.
 */
export const DIMS = [
    // ── Tipo di giocata e ritmo ───────────────────────────────────────────
    { key: 'playType', gruppo: 'style', fonte: 'pbp', label: 'Pass or run', filtro: (r) => pass(r) || run(r), valore: (r) => (pass(r) ? 'Pass' : 'Run'), ordine: ['Pass', 'Run'] },
    { key: 'shotgun', gruppo: 'style', fonte: 'pbp', label: 'Shotgun', filtro: () => true, valore: (r) => (r.shotgun === '1' ? 'Shotgun' : 'Under center / pistol'), ordine: ['Shotgun', 'Under center / pistol'] },
    { key: 'noHuddle', gruppo: 'style', fonte: 'pbp', label: 'No huddle', filtro: () => true, valore: (r) => (r.no_huddle === '1' ? 'No huddle' : 'Huddle'), ordine: ['No huddle', 'Huddle'] },
    { key: 'scramble', gruppo: 'pass', fonte: 'pbp', label: 'Scrambles (of dropbacks)', filtro: dropback, valore: (r) => (r.qb_scramble === '1' ? 'Scramble' : 'Stayed in pocket / threw'), ordine: ['Scramble', 'Stayed in pocket / threw'] },

    // ── Formazione e personnel (participation) ────────────────────────────
    { key: 'formation', gruppo: 'formation', fonte: 'part', label: 'Offensive formation', filtro: () => true, valore: (r) => r.part_offense_formation || null,
      ordine: ['SHOTGUN', 'UNDER CENTER', 'PISTOL', 'SINGLEBACK', 'I_FORM', 'EMPTY', 'JUMBO', 'WILDCAT'] },
    { key: 'personnel', gruppo: 'formation', fonte: 'part', label: 'Offensive personnel (RB-TE)', filtro: () => true, valore: (r) => codicePersonnel(r.part_offense_personnel),
      ordine: ['11', '12', '21', '13', '10', '22', '20', '01', '02', '00', '23', '31', '32'] },
    { key: 'defPackage', gruppo: 'coverage', fonte: 'part', label: 'Defensive package (DL-LB-DB)', filtro: () => true, valore: (r) => pacchettoDifesa(r.part_defense_personnel) },
    { key: 'box', gruppo: 'coverage', fonte: 'part', label: 'Defenders in the box', filtro: (r) => n(r.part_defenders_in_box) > 0, valore: (r) => fascia(n(r.part_defenders_in_box), [5, 6, 7], ['5 or fewer', '6', '7', '8+']), ordine: ['5 or fewer', '6', '7', '8+'] },
    { key: 'rushers', gruppo: 'coverage', fonte: 'part', label: 'Pass rushers', filtro: (r) => dropback(r) && n(r.part_number_of_pass_rushers) > 0, valore: (r) => fascia(n(r.part_number_of_pass_rushers), [3, 4, 5], ['3 or fewer', '4', '5', '6+']), ordine: ['3 or fewer', '4', '5', '6+'] },
    { key: 'coverage', gruppo: 'coverage', fonte: 'part', label: 'Coverage shell', filtro: dropback, valore: (r) => r.part_defense_coverage_type || null,
      ordine: ['COVER_0', 'COVER_1', '2_MAN', 'COVER_2', 'COVER_3', 'COVER_4', 'COVER_6', 'COVER_9', 'COMBO', 'BLOWN'] },
    { key: 'manZone', gruppo: 'coverage', fonte: 'part', label: 'Man or zone', filtro: dropback, valore: (r) => ({ MAN_COVERAGE: 'Man', ZONE_COVERAGE: 'Zone' })[r.part_defense_man_zone_type] || null, ordine: ['Man', 'Zone'] },
    { key: 'pressure', gruppo: 'pass', fonte: 'part', label: 'Pressure on the QB', filtro: (r) => dropback(r) && (r.part_was_pressure === 'TRUE' || r.part_was_pressure === 'FALSE'), valore: (r) => (r.part_was_pressure === 'TRUE' ? 'Pressured' : 'Clean pocket'), ordine: ['Pressured', 'Clean pocket'] },
    { key: 'timeToThrow', gruppo: 'pass', fonte: 'part', label: 'Time to throw', filtro: (r) => n(r.part_time_to_throw) > 0, valore: (r) => fascia(n(r.part_time_to_throw), [2.0, 2.5, 3.0, 3.5], ['Under 2.0s', '2.0–2.5s', '2.5–3.0s', '3.0–3.5s', 'Over 3.5s']), ordine: ['Under 2.0s', '2.0–2.5s', '2.5–3.0s', '3.0–3.5s', 'Over 3.5s'] },
    { key: 'route', gruppo: 'pass', fonte: 'part', label: 'Route of the targeted receiver', filtro: bersaglio, valore: (r) => r.part_route || null },

    // ── Pre-snap e concetti (FTN) ─────────────────────────────────────────
    { key: 'motion', gruppo: 'presnap', fonte: 'ftn', label: 'Pre-snap motion', filtro: (r) => r.ftn_is_motion != null, valore: (r) => (sì(r.ftn_is_motion) ? 'Motion' : 'No motion'), ordine: ['Motion', 'No motion'] },
    { key: 'playAction', gruppo: 'presnap', fonte: 'ftn', label: 'Play action (of dropbacks)', filtro: (r) => dropback(r) && r.ftn_is_play_action != null, valore: (r) => (sì(r.ftn_is_play_action) ? 'Play action' : 'Straight dropback'), ordine: ['Play action', 'Straight dropback'] },
    { key: 'rpo', gruppo: 'presnap', fonte: 'ftn', label: 'RPO', filtro: (r) => r.ftn_is_rpo != null, valore: (r) => (sì(r.ftn_is_rpo) ? 'RPO' : 'Not RPO'), ordine: ['RPO', 'Not RPO'] },
    { key: 'screen', gruppo: 'presnap', fonte: 'ftn', label: 'Screen (of passes)', filtro: (r) => pass(r) && r.ftn_is_screen_pass != null, valore: (r) => (sì(r.ftn_is_screen_pass) ? 'Screen' : 'Not a screen'), ordine: ['Screen', 'Not a screen'] },
    { key: 'trick', gruppo: 'presnap', fonte: 'ftn', label: 'Trick play', filtro: (r) => r.ftn_is_trick_play != null, valore: (r) => (sì(r.ftn_is_trick_play) ? 'Trick play' : 'Standard'), ordine: ['Trick play', 'Standard'] },
    { key: 'ftnNoHuddle', gruppo: 'presnap', fonte: 'ftn', label: 'No huddle (FTN charting)', filtro: (r) => r.ftn_is_no_huddle != null, valore: (r) => (sì(r.ftn_is_no_huddle) ? 'No huddle' : 'Huddle'), ordine: ['No huddle', 'Huddle'] },
    { key: 'hash', gruppo: 'presnap', fonte: 'ftn', label: 'Starting hash', filtro: (r) => ftnVal(r.ftn_starting_hash) != null, valore: (r) => ({ L: 'Left hash', M: 'Middle', R: 'Right hash' })[r.ftn_starting_hash] || null, ordine: ['Left hash', 'Middle', 'Right hash'] },
    { key: 'qbLocation', gruppo: 'presnap', fonte: 'ftn', label: 'QB alignment', filtro: (r) => ftnVal(r.ftn_qb_location) != null, valore: (r) => ({ U: 'Under center', S: 'Shotgun', P: 'Pistol' })[r.ftn_qb_location] || null, ordine: ['Under center', 'Shotgun', 'Pistol'] },
    { key: 'backfield', gruppo: 'presnap', fonte: 'ftn', label: 'Players in the backfield', filtro: (r) => ftnVal(r.ftn_qb_location) != null && r.ftn_n_offense_backfield != null, valore: (r) => fascia(n(r.ftn_n_offense_backfield), [0, 1, 2], ['Empty (0)', '1', '2', '3+']), ordine: ['Empty (0)', '1', '2', '3+'] },
    { key: 'ftnBox', gruppo: 'coverage', fonte: 'ftn', label: 'Defenders in the box (FTN)', filtro: (r) => n(r.ftn_n_defense_box) > 0, valore: (r) => fascia(n(r.ftn_n_defense_box), [5, 6, 7], ['5 or fewer', '6', '7', '8+']), ordine: ['5 or fewer', '6', '7', '8+'] },
    { key: 'blitzers', gruppo: 'coverage', fonte: 'ftn', label: 'Blitzers (beyond the front)', filtro: (r) => dropback(r) && n(r.ftn_n_pass_rushers) > 0, valore: (r) => fascia(n(r.ftn_n_blitzers), [0, 1, 2], ['No blitz', '1', '2', '3+']), ordine: ['No blitz', '1', '2', '3+'] },
    { key: 'ftnRushers', gruppo: 'coverage', fonte: 'ftn', label: 'Pass rushers (FTN)', filtro: (r) => dropback(r) && n(r.ftn_n_pass_rushers) > 0, valore: (r) => fascia(n(r.ftn_n_pass_rushers), [3, 4, 5], ['3 or fewer', '4', '5', '6+']), ordine: ['3 or fewer', '4', '5', '6+'] },
    { key: 'outOfPocket', gruppo: 'pass', fonte: 'ftn', label: 'QB out of the pocket', filtro: (r) => dropback(r) && r.ftn_is_qb_out_of_pocket != null, valore: (r) => (sì(r.ftn_is_qb_out_of_pocket) ? 'Out of pocket' : 'In the pocket'), ordine: ['Out of pocket', 'In the pocket'] },
    { key: 'readThrown', gruppo: 'pass', fonte: 'ftn', label: 'Read the ball went to', filtro: (r) => pass(r) && ftnVal(r.ftn_read_thrown) != null, valore: (r) => ({ 1: '1st read', 2: '2nd read', SD: 'Scramble drill', CHK: 'Checkdown', DES: 'Designed (screen, RPO…)' })[r.ftn_read_thrown] || `Read ${r.ftn_read_thrown}`, ordine: ['1st read', '2nd read', 'Checkdown', 'Scramble drill', 'Designed (screen, RPO…)'] },
    { key: 'catchable', gruppo: 'pass', fonte: 'ftn', label: 'Catchable ball (of targets)', filtro: (r) => bersaglio(r) && r.ftn_is_catchable_ball != null, valore: (r) => (sì(r.ftn_is_catchable_ball) ? 'Catchable' : 'Uncatchable'), ordine: ['Catchable', 'Uncatchable'] },
    { key: 'contested', gruppo: 'pass', fonte: 'ftn', label: 'Contested catch point (of targets)', filtro: (r) => bersaglio(r) && r.ftn_is_contested_ball != null, valore: (r) => (sì(r.ftn_is_contested_ball) ? 'Contested' : 'Open'), ordine: ['Contested', 'Open'] },
    { key: 'drop', gruppo: 'pass', fonte: 'ftn', label: 'Drops (of targets)', filtro: (r) => bersaglio(r) && r.ftn_is_drop != null, valore: (r) => (sì(r.ftn_is_drop) ? 'Dropped' : 'Not dropped'), ordine: ['Dropped', 'Not dropped'] },
    { key: 'created', gruppo: 'pass', fonte: 'ftn', label: 'Created reception (of catches)', filtro: (r) => r.complete_pass === '1' && r.ftn_is_created_reception != null, valore: (r) => (sì(r.ftn_is_created_reception) ? 'Created by the receiver' : 'Routine'), ordine: ['Created by the receiver', 'Routine'] },
    { key: 'intWorthy', gruppo: 'pass', fonte: 'ftn', label: 'Interception-worthy throws', filtro: (r) => r.pass_attempt === '1' && r.sack !== '1' && r.ftn_is_interception_worthy != null, valore: (r) => (sì(r.ftn_is_interception_worthy) ? 'Interception-worthy' : 'Safe'), ordine: ['Interception-worthy', 'Safe'] },
    { key: 'throwAway', gruppo: 'pass', fonte: 'ftn', label: 'Throwaways (of attempts)', filtro: (r) => r.pass_attempt === '1' && r.sack !== '1' && r.ftn_is_throw_away != null, valore: (r) => (sì(r.ftn_is_throw_away) ? 'Thrown away' : 'Aimed'), ordine: ['Thrown away', 'Aimed'] },
    { key: 'qbFaultSack', gruppo: 'pass', fonte: 'ftn', label: 'Sacks the QB caused', filtro: (r) => r.sack === '1' && r.ftn_is_qb_fault_sack != null, valore: (r) => (sì(r.ftn_is_qb_fault_sack) ? 'QB fault' : 'Protection / coverage'), ordine: ['QB fault', 'Protection / coverage'] },
    { key: 'sneak', gruppo: 'run', fonte: 'ftn', label: 'QB sneaks (of runs)', filtro: (r) => run(r) && r.ftn_is_qb_sneak != null, valore: (r) => (sì(r.ftn_is_qb_sneak) ? 'QB sneak' : 'Other run'), ordine: ['QB sneak', 'Other run'] },

    // ── Gioco di passaggio (pbp) ──────────────────────────────────────────
    { key: 'passDepth', gruppo: 'pass', fonte: 'pbp', label: 'Pass depth', filtro: (r) => pass(r) && !!r.pass_length, valore: (r) => (r.pass_length === 'deep' ? 'Deep (15+ air yards)' : 'Short'), ordine: ['Short', 'Deep (15+ air yards)'] },
    { key: 'passDir', gruppo: 'pass', fonte: 'pbp', label: 'Pass direction', filtro: (r) => pass(r) && !!r.pass_location, valore: (r) => ({ left: 'Left', middle: 'Middle', right: 'Right' })[r.pass_location], ordine: ['Left', 'Middle', 'Right'] },
    { key: 'airYards', gruppo: 'pass', fonte: 'pbp', label: 'Air yards', filtro: (r) => pass(r) && n(r.air_yards) != null, valore: (r) => fascia(n(r.air_yards), [-0.01, 9, 19], ['Behind the line', '0–9', '10–19', '20+']), ordine: ['Behind the line', '0–9', '10–19', '20+'] },

    // ── Gioco di corsa (pbp) ──────────────────────────────────────────────
    { key: 'runGap', gruppo: 'run', fonte: 'pbp', label: 'Run gap', filtro: (r) => run(r) && !!r.run_location && r.qb_scramble !== '1',
      valore: (r) => (r.run_location === 'middle' ? 'Middle' : `${r.run_location === 'left' ? 'Left' : 'Right'} ${({ end: 'end', tackle: 'tackle', guard: 'guard' })[r.run_gap] || ''}`.trim()),
      ordine: ['Left end', 'Left tackle', 'Left guard', 'Middle', 'Right guard', 'Right tackle', 'Right end'] },

    // ── Situazioni (pbp) ──────────────────────────────────────────────────
    { key: 'down', gruppo: 'situation', fonte: 'pbp', label: 'Down', filtro: (r) => n(r.down) >= 1, valore: (r) => `${r.down}${({ 1: 'st', 2: 'nd', 3: 'rd', 4: 'th' })[r.down]} down`, ordine: ['1st down', '2nd down', '3rd down', '4th down'] },
    { key: 'thirdDown', gruppo: 'situation', fonte: 'pbp', label: '3rd down by distance', filtro: (r) => r.down === '3', valore: (r) => fascia(n(r.ydstogo), [2, 6, 10], ['3rd & 1–2', '3rd & 3–6', '3rd & 7–10', '3rd & 11+']), ordine: ['3rd & 1–2', '3rd & 3–6', '3rd & 7–10', '3rd & 11+'] },
    { key: 'earlyDown', gruppo: 'situation', fonte: 'pbp', label: 'Early downs (1st & 2nd), pass or run', filtro: (r) => (r.down === '1' || r.down === '2') && (pass(r) || run(r)), valore: (r) => (pass(r) ? 'Pass' : 'Run'), ordine: ['Pass', 'Run'] },
    { key: 'zone', gruppo: 'situation', fonte: 'pbp', label: 'Field zone', filtro: (r) => n(r.yardline_100) != null,
      valore: (r) => fascia(n(r.yardline_100), [10, 20, 50, 80], ['Inside the 10', 'Red zone 11–20', 'Opponent half', 'Own 21–50', 'Backed up (own 1–20)']),
      ordine: ['Backed up (own 1–20)', 'Own 21–50', 'Opponent half', 'Red zone 11–20', 'Inside the 10'] },
    { key: 'score', gruppo: 'situation', fonte: 'pbp', label: 'Score state', filtro: (r) => n(r.score_differential) != null,
      valore: (r) => fascia(n(r.score_differential), [-9, -1, 0, 8], ['Trailing by 9+', 'Trailing by 1–8', 'Tied', 'Leading by 1–8', 'Leading by 9+']),
      ordine: ['Trailing by 9+', 'Trailing by 1–8', 'Tied', 'Leading by 1–8', 'Leading by 9+'] },
    { key: 'quarter', gruppo: 'situation', fonte: 'pbp', label: 'Quarter', filtro: (r) => n(r.qtr) >= 1, valore: (r) => (n(r.qtr) >= 5 ? 'Overtime' : `Q${r.qtr}`), ordine: ['Q1', 'Q2', 'Q3', 'Q4', 'Overtime'] },
    { key: 'twoMinute', gruppo: 'situation', fonte: 'pbp', label: 'Two-minute drill', filtro: (r) => n(r.half_seconds_remaining) != null, valore: (r) => (n(r.half_seconds_remaining) <= 120 ? 'Last 2:00 of a half' : 'Rest of the game'), ordine: ['Last 2:00 of a half', 'Rest of the game'] },
];

/** Gruppi, nell'ordine in cui si mostrano. */
export const GRUPPI = [
    { key: 'style', label: 'Play style' },
    { key: 'formation', label: 'Formation & personnel' },
    { key: 'presnap', label: 'Pre-snap & concepts' },
    { key: 'pass', label: 'Passing game' },
    { key: 'run', label: 'Run game' },
    { key: 'coverage', label: 'Defensive looks: package, box, rush, coverage' },
    { key: 'situation', label: 'Situations' },
];

export const FONTI = {
    pbp: { label: 'Play-by-play', da: 1999, a: null },
    part: { label: 'Participation (NGS/FTN)', da: 2016, a: 2025 },
    ftn: { label: 'FTN charting', da: 2022, a: null },
};

/**
 * Metriche continue di squadra (una media per lato, con rank). `meglio` dice
 * in che verso è "buono" per l'attacco: in difesa si legge al contrario.
 * Calcolate nel builder; qui solo nome, unità e formato.
 */
export const METRICHE = [
    { key: 'epa', label: 'EPA per play', fmt: 'epa', meglio: 'alto' },
    { key: 'success', label: 'Success rate', fmt: 'pct', meglio: 'alto' },
    { key: 'passRate', label: 'Pass rate', fmt: 'pct', meglio: null },
    { key: 'proe', label: 'Pass rate over expected (PROE)', fmt: 'pp', meglio: null },
    { key: 'xpass', label: 'Expected pass rate (xPass)', fmt: 'pct', meglio: null },
    { key: 'neutralPassRate', label: 'Neutral-situation pass rate', fmt: 'pct', meglio: null },
    { key: 'secPerPlay', label: 'Seconds per play (neutral)', fmt: 'sec', meglio: null },
    { key: 'adot', label: 'Average depth of target (aDOT)', fmt: 'yd', meglio: null },
    { key: 'cpoe', label: 'Completion % over expected (CPOE)', fmt: 'pp', meglio: 'alto' },
    { key: 'yac', label: 'Yards after catch per catch', fmt: 'yd', meglio: 'alto' },
    { key: 'yacOE', label: 'YAC over expected per catch', fmt: 'yd', meglio: 'alto' },
    { key: 'sackRate', label: 'Sack rate (of dropbacks)', fmt: 'pct', meglio: 'basso' },
    { key: 'hitRate', label: 'QB hit rate (of dropbacks)', fmt: 'pct', meglio: 'basso' },
    { key: 'explosive', label: 'Explosive play rate (pass 20+, run 10+)', fmt: 'pct', meglio: 'alto' },
    { key: 'stuffed', label: 'Runs stuffed at or behind the line', fmt: 'pct', meglio: 'basso' },
    { key: 'turnoverRate', label: 'Turnovers per play', fmt: 'pct', meglio: 'basso' },
    { key: 'timeToThrow', label: 'Average time to throw', fmt: 'sec', meglio: null, fonte: 'part' },
    { key: 'pressureRate', label: 'Pressure rate (of dropbacks)', fmt: 'pct', meglio: 'basso', fonte: 'part' },
    { key: 'ngsAirYards', label: 'NGS air yards per attempt', fmt: 'yd', meglio: null, fonte: 'part' },
    { key: 'drivePoints', label: 'Points per drive', fmt: 'num2', meglio: 'alto' },
    { key: 'driveTdRate', label: 'Drives ending in a TD', fmt: 'pct', meglio: 'alto' },
    { key: 'driveScoreRate', label: 'Drives ending in a score', fmt: 'pct', meglio: 'alto' },
    { key: 'drivePlays', label: 'Plays per drive', fmt: 'num1', meglio: null },
    { key: 'driveTop', label: 'Time of possession per drive', fmt: 'mmss', meglio: null },
    { key: 'driveStart', label: 'Average drive start (yards from own goal)', fmt: 'num1', meglio: 'alto' },
    { key: 'fourthGoRate', label: '4th down go-for-it rate', fmt: 'pct', meglio: null },
    { key: 'fourthConv', label: '4th down conversion rate', fmt: 'pct', meglio: 'alto' },
    { key: 'redZoneTd', label: 'Red zone TD rate (per trip)', fmt: 'pct', meglio: 'alto' },
    { key: 'penaltiesPg', label: 'Penalties per game (accepted)', fmt: 'num1', meglio: 'basso' },
    { key: 'penaltyYdsPg', label: 'Penalty yards per game', fmt: 'num1', meglio: 'basso' },
];
