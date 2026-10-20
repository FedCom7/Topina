/**
 * Pagina giocatore — TUTTE le colonne di Next Gen Stats e PFR advanced.
 *
 * Il blocco "Advanced metrics" della pagina (`advancedNflverseBlock`) mostra
 * quattordici-diciassette colonne scelte per ruolo, le stesse che alimentano
 * il modello (Player Context Score, SOS+). Questo modulo mostra il resto:
 * ogni colonna che le due fonti pubblicano per quel giocatore, con i nomi
 * della fonte, anno per anno e partita per partita.
 *
 * I dati stanno in data/nfl/advfull/{Y}.json (stagione) e
 * data/nfl/advweek/{Y}.json (partita), generati da
 * scripts/build-nfl-advfull.mjs. Si scaricano SOLO quando si apre il blocco,
 * e il file delle partite solo quando si sceglie quell'anno.
 *
 * Una cosa da sapere: le fonti mescolano percentuali già in 0–100 e frazioni
 * 0–1 sotto nomi quasi uguali (`drop_pct` in PFR stagione è 0–100,
 * `drop_percent` è 0–1). Quali colonne sono frazioni sta in FRAZIONI, scritto
 * guardando i dati: una frazione mostrata senza moltiplicare si leggerebbe
 * come "0,07%".
 */

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const _cache = {};
const carica = (url) => (_cache[url] ??= fetch(url).then(r => (r.ok ? r.json() : null)).catch(() => null));

const NGS = [['passing', 'Next Gen Stats · passing'], ['rushing', 'Next Gen Stats · rushing'], ['receiving', 'Next Gen Stats · receiving']];
const PFR = [['pass', 'PFR advanced · passing'], ['rush', 'PFR advanced · rushing'], ['rec', 'PFR advanced · receiving'], ['def', 'PFR advanced · defense']];

/** Colonne che la fonte dà come frazione 0–1 (verificato sui dati). */
const FRAZIONI = {
    'ngs/rushing': ['rush_pct_over_expected'],
    'pfr/rec': ['drop_percent', 'passing_drop_pct', 'receiving_drop_pct'],
    'pfr/def': ['cmp_percent', 'm_tkl_percent', 'def_completion_pct', 'def_missed_tackle_pct'],
    'pfr/pass': ['passing_drop_pct', 'passing_bad_throw_pct', 'times_pressured_pct'],
};
/** Colonne che non si mostrano perché ripetono il contesto della pagina. */
const NASCOSTE = new Set(['player', 'player_display_name']);

const LABEL = {
    // NGS passing
    avg_time_to_throw: 'Avg time to throw (s)', avg_completed_air_yards: 'Avg completed air yds', avg_intended_air_yards: 'Avg intended air yds',
    avg_air_yards_differential: 'Air yds differential', aggressiveness: 'Aggressiveness %', max_completed_air_distance: 'Longest completion (air dist.)',
    avg_air_yards_to_sticks: 'Air yds to the sticks', attempts: 'Attempts', pass_yards: 'Pass yds', pass_touchdowns: 'Pass TD', interceptions: 'INT',
    passer_rating: 'Passer rating', completions: 'Completions', completion_percentage: 'Cmp %', expected_completion_percentage: 'Expected cmp %',
    completion_percentage_above_expectation: 'CPOE', avg_air_distance: 'Avg air distance', max_air_distance: 'Max air distance',
    // NGS rushing
    efficiency: 'Efficiency', percent_attempts_gte_eight_defenders: '% att vs 8+ in box', avg_time_to_los: 'Avg time to LOS (s)', rush_attempts: 'Rush att',
    rush_yards: 'Rush yds', avg_rush_yards: 'Yds/att', rush_touchdowns: 'Rush TD', expected_rush_yards: 'Expected rush yds', rush_yards_over_expected: 'RYOE',
    rush_yards_over_expected_per_att: 'RYOE/att', rush_pct_over_expected: '% rush over expected',
    // NGS receiving
    avg_cushion: 'Avg cushion (yds)', avg_separation: 'Avg separation (yds)', percent_share_of_intended_air_yards: 'Intended air yds share %',
    receptions: 'Rec', targets: 'Targets', catch_percentage: 'Catch %', yards: 'Yds', rec_touchdowns: 'Rec TD', avg_yac: 'Avg YAC',
    avg_expected_yac: 'Avg expected YAC', avg_yac_above_expectation: 'YAC above expected',
    // comuni
    season_type: 'Type', week: 'Week', player_position: 'Pos', team_abbr: 'Team', player_jersey_number: '#', team: 'Team', tm: 'Team', pos: 'Pos', age: 'Age',
    g: 'G', gs: 'GS', opponent: 'Opp', game_type: 'Type',
    // PFR passing (stagione)
    pass_attempts: 'Pass att', throwaways: 'Throwaways', spikes: 'Spikes', drops: 'Drops', drop_pct: 'Drop %', bad_throws: 'Bad throws', bad_throw_pct: 'Bad throw %',
    pocket_time: 'Pocket time (s)', times_blitzed: 'Times blitzed', times_hurried: 'Times hurried', times_hit: 'Times hit', times_pressured: 'Times pressured',
    pressure_pct: 'Pressure %', batted_balls: 'Batted balls', on_tgt_throws: 'On-target throws', on_tgt_pct: 'On-target %', rpo_plays: 'RPO plays', rpo_yards: 'RPO yds',
    rpo_pass_att: 'RPO pass att', rpo_pass_yards: 'RPO pass yds', rpo_rush_att: 'RPO rush att', rpo_rush_yards: 'RPO rush yds', pa_pass_att: 'Play-action pass att',
    pa_pass_yards: 'Play-action pass yds', intended_air_yards: 'Intended air yds', intended_air_yards_per_pass_attempt: 'Intended air yds/att',
    completed_air_yards: 'Completed air yds', completed_air_yards_per_completion: 'Completed air yds/cmp', completed_air_yards_per_pass_attempt: 'Completed air yds/att',
    pass_yards_after_catch: 'Pass yds after catch', pass_yards_after_catch_per_completion: 'YAC/cmp', scrambles: 'Scrambles', scramble_yards_per_attempt: 'Scramble yds/att',
    // PFR rushing/receiving (stagione)
    att: 'Att', yds: 'Yds', td: 'TD', x1d: '1st downs', ybc: 'Yds before contact', ybc_att: 'YBC/att', yac: 'Yds after contact/catch', yac_att: 'YAC/att',
    brk_tkl: 'Broken tackles', att_br: 'Att per broken tackle', tgt: 'Targets', rec: 'Rec', ybc_r: 'YBC/rec', yac_r: 'YAC/rec', adot: 'aDOT', rec_br: 'Rec per broken tackle',
    drop: 'Drops', drop_percent: 'Drop %', int: 'INT', rat: 'Rating when targeted',
    // PFR defense (stagione)
    cmp: 'Cmp allowed', cmp_percent: 'Cmp % allowed', yds_cmp: 'Yds/cmp', yds_tgt: 'Yds/target', dadot: 'aDOT allowed', air: 'Air yds allowed', bltz: 'Blitzes',
    hrry: 'Hurries', qbkd: 'QB knockdowns', sk: 'Sacks', prss: 'Pressures', comb: 'Tackles', m_tkl: 'Missed tackles', m_tkl_percent: 'Missed tackle %', bats: 'Batted passes',
    // PFR settimana
    passing_drops: 'Drops (as QB)', passing_drop_pct: 'Drop % (as QB)', receiving_drop: 'Drops (as receiver)', receiving_drop_pct: 'Drop % (as receiver)',
    passing_bad_throws: 'Bad throws', passing_bad_throw_pct: 'Bad throw %', times_sacked: 'Sacked', times_pressured_pct: 'Pressure %', def_times_blitzed: 'Blitzes (def)',
    def_times_hurried: 'Hurries (def)', def_times_hitqb: 'QB hits (def)', carries: 'Carries', rushing_yards_before_contact: 'Yds before contact',
    rushing_yards_before_contact_avg: 'YBC/att', rushing_yards_after_contact: 'Yds after contact', rushing_yards_after_contact_avg: 'YAC/att',
    rushing_broken_tackles: 'Broken tackles (rush)', receiving_broken_tackles: 'Broken tackles (rec)', receiving_int: 'INT when targeted', receiving_rat: 'Rating when targeted',
    def_ints: 'INT', def_targets: 'Targets', def_completions_allowed: 'Cmp allowed', def_completion_pct: 'Cmp % allowed', def_yards_allowed: 'Yds allowed',
    def_yards_allowed_per_cmp: 'Yds/cmp', def_yards_allowed_per_tgt: 'Yds/target', def_receiving_td_allowed: 'TD allowed', def_passer_rating_allowed: 'Passer rating allowed',
    def_adot: 'aDOT allowed', def_air_yards_completed: 'Completed air yds allowed', def_yards_after_catch: 'YAC allowed', def_sacks: 'Sacks', def_pressures: 'Pressures',
    def_tackles_combined: 'Tackles', def_missed_tackles: 'Missed tackles', def_missed_tackle_pct: 'Missed tackle %',
};
const etichetta = (c) => LABEL[c] || c.replace(/_/g, ' ').replace(/^\w/, (x) => x.toUpperCase());

function formatta(v, frazione) {
    if (v == null || v === '') return '';
    if (typeof v !== 'number') return esc(v);
    if (frazione) return `${(v * 100).toFixed(1)}%`;
    return Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100);
}

// ─── blocco ──────────────────────────────────────────────────────────────

/** Placeholder nella pagina: si riempie al primo apertura. Solo se il
 *  giocatore ha un id nflverse (gsis o pfr) da cercare nei file. */
export function advFullBlock(advSeasons) {
    const reali = (advSeasons || []).filter(s => !s.provisional && (s.gsis || s.pfr));
    if (!reali.length) return '';
    return `<section class="pm-block pp-block pp-advfull" id="pp-advfull">
        <span class="mc-kicker">Every Next Gen Stats and PFR column</span>
        <details class="pp-af-box" data-af-season>
            <summary><b>Season by season</b> <small>all columns of Next Gen Stats and PFR advanced, ${reali.length} season${reali.length > 1 ? 's' : ''}</small></summary>
            <div class="pp-af-body" data-af-body-season></div>
        </details>
        <details class="pp-af-box" data-af-week>
            <summary><b>Game by game</b> <small>the same columns, week by week — pick a season</small></summary>
            <div class="pp-af-body" data-af-body-week></div>
        </details>
        <p class="pm-note">Columns are the sources' own. Next Gen Stats tracking starts in 2016, PFR advanced in 2018; the most recent season appears when nflverse publishes it. Percentages are shown as the source gives them, with fractions converted to %.</p>
    </section>`;
}

/** Tabella di una fonte: una riga per anno (o per partita), tutte le colonne. */
function tabella(titolo, righe, cols, frazioni, primaColonna) {
    if (!righe.length) return '';
    const visibili = cols.map((c, i) => [c, i]).filter(([c]) => !NASCOSTE.has(c));
    return `<h5 class="pp-af-h">${esc(titolo)}</h5>
    <div class="pm-table-wrap pp-scroll"><table class="pm-table pp-table pp-af-table">
        <thead><tr><th>${esc(primaColonna)}</th>${visibili.map(([c]) => `<th>${esc(etichetta(c))}</th>`).join('')}</tr></thead>
        <tbody>${righe.map(([lab, r]) => `<tr><td>${esc(lab)}</td>${visibili.map(([c, i]) => `<td>${c === 'week' && r[i] === 0 ? 'Season' : formatta(r[i], frazioni.includes(c))}</td>`).join('')}</tr>`).join('')}</tbody>
    </table></div>`;
}

/** Tutte le tabelle di un file (stagione o partita) per questo giocatore. */
function tabelleDi(file, ids, anno, settimana) {
    let out = '';
    const blocchi = [['ngs', NGS, ids.gsis], ['pfr', PFR, ids.pfr]];
    for (const [fonte, kinds, id] of blocchi) {
        if (!id || !file?.[fonte]) continue;
        for (const [k, titolo] of kinds) {
            const t = file[fonte][k];
            const righe = t?.rows?.[id];
            if (!righe?.length) continue;
            const frazioni = FRAZIONI[`${fonte}/${k}`] || [];
            // Stagione: etichetta = anno (+ squadra se PFR ne dà più d'una).
            // Partita: etichetta = "W3 vs DAL" da week/opponent o da week.
            const ic = (n) => t.cols.indexOf(n);
            const lab = (r) => {
                if (settimana) {
                    const w = r[ic('week')];
                    const tipo = r[ic('season_type')] ?? r[ic('game_type')];
                    const opp = ic('opponent') >= 0 ? r[ic('opponent')] : null;
                    return `${tipo && tipo !== 'REG' ? `${tipo} ` : ''}W${w}${opp ? ` vs ${opp}` : ''}`;
                }
                const sq = r[ic('team_abbr')] ?? r[ic('team')] ?? r[ic('tm')];
                return `${anno}${sq ? ` ${sq}` : ''}`;
            };
            out += tabella(titolo, righe.map(r => [lab(r), r]), t.cols, frazioni, settimana ? 'Game' : 'Season');
        }
    }
    return out;
}

/** Aggancia i due <details>: carica i file solo all'apertura. */
export function bindAdvFull(section, advSeasons) {
    const box = section.querySelector('#pp-advfull');
    if (!box) return;
    const anni = [...new Set((advSeasons || []).filter(s => !s.provisional && (s.gsis || s.pfr)).map(s => +s.year))].sort((a, b) => b - a);
    const idDi = (y) => { const r = advSeasons.find(s => +s.year === y && (s.gsis || s.pfr)); return { gsis: r?.gsis || null, pfr: r?.pfr || null }; };

    const dSeason = box.querySelector('[data-af-season]');
    dSeason.addEventListener('toggle', async () => {
        if (!dSeason.open || dSeason.dataset.fatto) return;
        dSeason.dataset.fatto = '1';
        const body = dSeason.querySelector('[data-af-body-season]');
        body.innerHTML = '<div class="loading-state"><div class="spinner"></div></div>';
        const files = await Promise.all(anni.map(y => carica(`data/nfl/advfull/${y}.json`)));
        // Una tabella per fonte con TUTTI gli anni insieme (le colonne sono
        // le stesse da un anno all'altro), non una per anno.
        const html = [];
        for (const [fonte, kinds] of [['ngs', NGS], ['pfr', PFR]]) {
            for (const [k, titolo] of kinds) {
                let cols = null; const righe = [];
                anni.forEach((y, i) => {
                    const t = files[i]?.[fonte]?.[k];
                    const id = fonte === 'ngs' ? idDi(y).gsis : idDi(y).pfr;
                    const rr = t?.rows?.[id];
                    if (!rr?.length) return;
                    cols ??= t.cols;
                    for (const r of rr) {
                        const ic = (n) => t.cols.indexOf(n);
                        // Nel file NGS la riga porta anche `week` (0 = totale di stagione).
                        const sq = r[ic('team_abbr')] ?? r[ic('team')] ?? r[ic('tm')];
                        righe.push([`${y}${sq ? ` ${sq}` : ''}`, r]);
                    }
                });
                if (cols) html.push(tabella(titolo, righe, cols, FRAZIONI[`${fonte}/${k}`] || [], 'Season'));
            }
        }
        body.innerHTML = html.join('') || '<p class="pm-note">No Next Gen Stats or PFR rows for this player.</p>';
    });

    const dWeek = box.querySelector('[data-af-week]');
    dWeek.addEventListener('toggle', () => {
        if (!dWeek.open || dWeek.dataset.fatto) return;
        dWeek.dataset.fatto = '1';
        const body = dWeek.querySelector('[data-af-body-week]');
        body.innerHTML = `<div class="pp-af-years" role="tablist">${anni.map((y, i) => `<button type="button" class="pp-af-year${i === 0 ? ' is-active' : ''}" data-af-y="${y}">${y}</button>`).join('')}</div><div data-af-week-tables></div>`;
        const mostra = async (y) => {
            const dest = body.querySelector('[data-af-week-tables]');
            dest.innerHTML = '<div class="loading-state"><div class="spinner"></div></div>';
            const f = await carica(`data/nfl/advweek/${y}.json`);
            dest.innerHTML = tabelleDi(f, idDi(y), y, true) || '<p class="pm-note">No game-by-game rows for this season.</p>';
        };
        body.addEventListener('click', (e) => {
            const b = e.target.closest('[data-af-y]');
            if (!b) return;
            body.querySelectorAll('.pp-af-year').forEach(x => x.classList.toggle('is-active', x === b));
            mostra(+b.dataset.afY);
        });
        mostra(anni[0]);
    });
}
