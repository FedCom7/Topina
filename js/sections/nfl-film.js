/**
 * Sala video — ogni snap di una partita, come lo rivede un QB il lunedì
 * (#nfl-tactics/{SIGLA}/{ANNO}/film/{game_id}).
 *
 * I dati sono quelli di scripts/build-nfl-plays.mjs: una partita per file,
 * OGNI campo di play-by-play, participation (`part_*`) e FTN (`ftn_*`). Da
 * qui nessuna richiesta di rete oltre a index.json e al file della partita.
 *
 * I filtri sono le dimensioni di Tactics (js/data/tactics-catalog.js), le
 * stesse funzioni applicate alla singola giocata: "tutti i 3° down contro
 * Cover 1" qui e la riga "3rd down" × "Cover 1" là contano le stesse giocate.
 * Per questo le righe si ricostruiscono coi valori in STRINGA, come escono
 * dal CSV: il catalogo confronta `r.pass === '1'`.
 *
 * Il campo disegnato sotto ogni giocata è uno schema: lunghezza vera (yard
 * del referto, air yards, YAC), direzione vera (left/middle/right, gap), ma
 * la traccia è disegnata — il tracking non è pubblico. La nota lo dice.
 *
 * Modulo caricato a richiesta da nfl-tactics.js: chi non apre la sala video
 * non lo scarica.
 */

import { DIMS } from '../data/tactics-catalog.js?v=1';
import { getTeamIdentity } from '../data/nfl-teams.js?v=513';

const LOGO = (abbr) => `https://a.espncdn.com/i/teamlogos/nfl/500/${String(abbr || '').toLowerCase()}.png`;
const esc = (v) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
/** nflverse chiama i Rams "LA"; il sito "LAR". */
const sito = (a) => (a === 'LA' ? 'LAR' : a);
const nflv = (a) => (a === 'LAR' ? 'LA' : a);

const _cache = {};
const carica = (url) => (_cache[url] ??= fetch(url).then(r => (r.ok ? r.json() : null)).catch(() => null));

/** File compatto → array di righe { colonna: 'valore' } (solo i campi pieni). */
function decodifica(file, cols) {
    const rows = Array.from({ length: file.n }, () => ({}));
    for (const [idx, e] of Object.entries(file.c)) {
        const nome = cols[idx];
        if ('k' in e) { const v = String(e.k); for (const r of rows) r[nome] = v; }
        else if ('s' in e) { for (const [i, v] of Object.entries(e.s)) rows[i][nome] = String(v); }
        else e.a.forEach((v, i) => { if (v != null) rows[i][nome] = String(v); });
    }
    rows.forEach((r, i) => { r._i = i; });
    return rows;
}

// ─── stato ───────────────────────────────────────────────────────────────

let S = null; // { team, anno, gid, idx, rows, game, filtri, sel, lato }

const FILTRI = ['down', 'playType', 'formation', 'personnel', 'defPackage', 'coverage', 'manZone', 'box', 'rushers', 'blitzers',
    'motion', 'playAction', 'rpo', 'screen', 'pressure', 'passDepth', 'passDir', 'runGap', 'route', 'readThrown', 'zone', 'quarter', 'thirdDown', 'score'];
const ESITI = {
    success: ['Successful', (r) => r.success === '1'],
    fail: ['Unsuccessful', (r) => r.success === '0'],
    explosive: ['Explosive (pass 20+, run 10+)', (r) => (r.pass === '1' ? +r.yards_gained >= 20 : r.rush === '1' && +r.yards_gained >= 10)],
    td: ['Touchdown', (r) => r.touchdown === '1'],
    turnover: ['Turnover', (r) => r.interception === '1' || r.fumble_lost === '1'],
    sack: ['Sack', (r) => r.sack === '1'],
    firstdown: ['First down', (r) => r.first_down === '1'],
    penalty: ['Penalty', (r) => r.penalty === '1'],
};

export async function renderFilm(corpo, { team, anno, gid }) {
    const idx = await carica(`data/nfl/plays/${anno}/index.json`);
    if (!idx) {
        corpo.innerHTML = `<p class="pm-note">The film room covers 2023 to today (that is when participation starts listing all 22 players on the field by name and number). Pick a season from 2023.</p>`;
        return;
    }
    const partite = idx.games.filter(g => g.home === nflv(team) || g.away === nflv(team));
    if (!partite.length) { corpo.innerHTML = '<p class="pm-note">No games for this team in this season yet.</p>'; return; }
    const scelta = partite.find(g => g.id === gid) || partite[partite.length - 1];
    S = { team, anno, gid: scelta.id, idx, partite, rows: null, game: scelta, filtri: {}, esito: '', cerca: '', sel: null, lato: 'all' };
    corpo.innerHTML = `
        <div class="fr-games" role="tablist" aria-label="Games">${partite.map(g => pillola(g, team)).join('')}</div>
        <div id="fr-game"><div class="loading-state"><div class="spinner"></div></div></div>`;
    corpo.querySelector('.fr-games .is-active')?.scrollIntoView({ block: 'nearest', inline: 'center' });
    leghe(corpo);
    await caricaPartita(corpo);
}

function pillola(g, team) {
    const casa = g.home === nflv(team);
    const opp = sito(casa ? g.away : g.home);
    const mio = casa ? g.hs : g.as, suo = casa ? g.as : g.hs;
    const esito = mio == null ? '' : mio > suo ? 'W' : mio < suo ? 'L' : 'T';
    const sett = g.type === 'POST' ? ({ 19: 'WC', 20: 'DIV', 21: 'CC', 22: 'SB', 23: 'SB' })[g.week] || 'PO' : `W${g.week}`;
    return `<button type="button" class="fr-game${g.id === S?.gid ? ' is-active' : ''}" data-fr-game="${g.id}" title="${esc(g.date)}">
        <small>${sett}</small><span>${casa ? 'vs' : '@'} <img src="${LOGO(opp)}" alt="">${esc(opp)}</span>
        <b class="fr-res fr-res--${esito}">${esito} ${mio ?? ''}-${suo ?? ''}</b></button>`;
}

async function caricaPartita(corpo) {
    const box = corpo.querySelector('#fr-game');
    const { anno, gid } = S;
    box.innerHTML = '<div class="loading-state"><div class="spinner"></div></div>';
    const file = await carica(`data/nfl/plays/${anno}/${gid}.json`);
    if (S?.gid !== gid) return;
    if (!file) { box.innerHTML = '<p class="pm-note">This game could not be loaded.</p>'; return; }
    S.rows = decodifica(file, S.idx.cols);
    S.sel = null;
    box.innerHTML = `${testataPartita()}<div class="fr-layout"><div class="fr-left">${filtriHtml()}<div id="fr-list"></div></div><aside class="fr-detail" id="fr-detail"></aside></div>`;
    disegnaLista(corpo);
    const primo = visibili()[0];
    if (primo) scegli(corpo, primo._i, false);
}

// ─── testata della partita ───────────────────────────────────────────────

function testataPartita() {
    const r = S.rows[0] || {}, g = S.game;
    const pezzi = [
        r.game_date, r.stadium || r.game_stadium, r.roof && `Roof: ${r.roof}`, r.surface && `Surface: ${r.surface}`,
        r.temp && `${r.temp}°F`, r.wind && `Wind ${r.wind} mph`, r.weather,
    ].filter(Boolean);
    const coach = [r.away_coach && `${sito(g.away)}: ${r.away_coach}`, r.home_coach && `${sito(g.home)}: ${r.home_coach}`].filter(Boolean).join(' · ');
    const linea = [r.spread_line && `Spread ${r.spread_line > 0 ? `${sito(g.home)} -${r.spread_line}` : `${sito(g.away)} -${-r.spread_line}`}`, r.total_line && `O/U ${r.total_line}`].filter(Boolean).join(' · ');
    return `<div class="fr-head">
        <div class="fr-score">
            <span class="fr-team"><img src="${LOGO(sito(g.away))}" alt="">${esc(sito(g.away))}<b>${g.as ?? ''}</b></span>
            <span class="fr-at">@</span>
            <span class="fr-team"><b>${g.hs ?? ''}</b>${esc(sito(g.home))}<img src="${LOGO(sito(g.home))}" alt=""></span>
        </div>
        <p class="fr-meta">${esc(pezzi.join(' · '))}</p>
        ${coach || linea ? `<p class="fr-meta">${esc([coach, linea].filter(Boolean).join(' · '))}</p>` : ''}
        <p class="fr-meta fr-src">${g.part ? '● Participation' : '○ Participation (not published yet for this season)'} · ${g.ftn ? '● FTN charting' : '○ FTN charting'} · ● Play-by-play · ${S.rows.length} plays</p>
    </div>`;
}

// ─── filtri ──────────────────────────────────────────────────────────────

const ETICHETTE = {
    COVER_0: 'Cover 0', COVER_1: 'Cover 1', '2_MAN': '2-Man', COVER_2: 'Cover 2', COVER_3: 'Cover 3', COVER_4: 'Cover 4',
    COVER_6: 'Cover 6', COVER_9: 'Cover 9', COMBO: 'Combo', BLOWN: 'Blown', SHOTGUN: 'Shotgun', 'UNDER CENTER': 'Under center', PISTOL: 'Pistol',
};
const et = (v) => ETICHETTE[v] || v;

function filtriHtml() {
    const base = righeLato();
    const tutti = FILTRI.map(k => {
        const dim = DIMS.find(d => d.key === k);
        if (!dim) return '';
        const conta = {};
        for (const r of base) { if (!dim.filtro(r)) continue; const v = dim.valore(r); if (v != null) conta[v] = (conta[v] || 0) + 1; }
        const vals = Object.keys(conta);
        if (vals.length < 2 && !S.filtri[k]) return '';
        const ord = dim.ordine || [];
        vals.sort((a, b) => { const ia = ord.indexOf(a), ib = ord.indexOf(b); return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || conta[b] - conta[a]; });
        return [k, `<label class="fr-f"><span>${esc(dim.label.replace(/ \(.*\)$/, ''))}</span><select data-fr-f="${k}"><option value="">All</option>${vals.map(v => `<option value="${esc(v)}"${S.filtri[k] === v ? ' selected' : ''}>${esc(et(v))} (${conta[v]})</option>`).join('')}</select></label>`];
    }).filter(Boolean);
    // Otto filtri in vista, gli altri sotto "More filters": aperti da soli
    // se uno di loro è attivo, se no il filtro attivo sparirebbe alla vista.
    const IN_VISTA = 8;
    const altriAttivi = tutti.slice(IN_VISTA).some(([k]) => S.filtri[k]);
    const aperti = S.altri || altriAttivi;
    const sel = tutti.slice(0, IN_VISTA).map(x => x[1]).join('');
    const altri = tutti.slice(IN_VISTA).map(x => x[1]).join('');
    const g = S.game;
    return `<div class="fr-filters">
        <div class="fr-sides">
            ${[['all', 'All plays'], ['off', `${S.team} offense`], ['def', `${S.team} defense`], ['st', 'Special teams']].map(([k, l]) => `<button type="button" class="fr-side${S.lato === k ? ' is-active' : ''}" data-fr-lato="${k}">${esc(l)}</button>`).join('')}
        </div>
        <div class="fr-fgrid">
            ${sel}
            <label class="fr-f"><span>Result</span><select data-fr-esito><option value="">All</option>${Object.entries(ESITI).map(([k, [l]]) => `<option value="${k}"${S.esito === k ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></label>
            <label class="fr-f fr-f--search"><span>Search the play text</span><input type="search" data-fr-cerca value="${esc(S.cerca)}" placeholder="e.g. Barkley, sack, deep left"></label>
        </div>
        ${altri ? `<div class="fr-fgrid fr-fmore"${aperti ? '' : ' hidden'}>${altri}</div>` : ''}
        <div class="fr-factions">
            ${altri ? `<button type="button" class="tx-more" data-fr-altri>${aperti ? 'Fewer filters' : `More filters (${tutti.length - IN_VISTA})`}</button>` : ''}
            <button type="button" class="tx-more" data-fr-reset>Clear filters</button>
        </div>
    </div>`;
}

const scrimmage = (r) => r.pass === '1' || r.rush === '1';
function righeLato() {
    const t = nflv(S.team);
    return S.rows.filter(r => {
        if (S.lato === 'off') return r.posteam === t && scrimmage(r);
        if (S.lato === 'def') return r.defteam === t && scrimmage(r);
        if (S.lato === 'st') return r.special_teams_play === '1' || ['kickoff', 'punt', 'field_goal', 'extra_point'].includes(r.play_type);
        // Le righe senza play_type sono amministrative ("GAME", "END
        // QUARTER 1"): nei dati grezzi restano, nella lista no.
        return !!r.play_type;
    });
}

function visibili() {
    const cerca = S.cerca.trim().toLowerCase();
    return righeLato().filter(r => {
        for (const [k, v] of Object.entries(S.filtri)) {
            if (!v) continue;
            const dim = DIMS.find(d => d.key === k);
            if (!dim.filtro(r) || dim.valore(r) !== v) return false;
        }
        if (S.esito && !ESITI[S.esito][1](r)) return false;
        if (cerca && !String(r.desc || '').toLowerCase().includes(cerca)) return false;
        return true;
    });
}

// ─── lista per drive ─────────────────────────────────────────────────────

const ord = (d) => ({ 1: '1st', 2: '2nd', 3: '3rd', 4: '4th' })[d] || '';
const segno = (x, d = 2) => (x == null || x === '' || Number.isNaN(+x) ? '—' : `${+x > 0 ? '+' : ''}${(+x).toFixed(d)}`);
const orologio = (r) => (r.qtr ? `${+r.qtr >= 5 ? 'OT' : `Q${r.qtr}`} ${r.time || ''}` : '');
const situazione = (r) => (r.down ? `${ord(r.down)} & ${r.goal_to_go === '1' ? 'Goal' : r.ydstogo} · ${r.yrdln || ''}` : (r.yrdln || ''));

function chips(r) {
    const c = [];
    if (!scrimmage(r)) return c;
    const fv = dv('formation', r) || dv('qbLocation', r) || (r.shotgun === '1' ? 'Shotgun' : null);
    if (fv) c.push(et(fv));
    const pv = dv('personnel', r); if (pv) c.push(`${pv} pers.`);
    const kv = dv('defPackage', r); if (kv) c.push(kv.replace(/ \(.*/, ''));
    if (r.part_defense_coverage_type) c.push(et(r.part_defense_coverage_type));
    if (r.ftn_is_motion === 'TRUE') c.push('Motion');
    if (r.ftn_is_play_action === 'TRUE') c.push('PA');
    if (r.ftn_is_rpo === 'TRUE') c.push('RPO');
    if (r.ftn_is_screen_pass === 'TRUE') c.push('Screen');
    if (+r.ftn_n_blitzers > 0) c.push(`Blitz ${r.ftn_n_blitzers}`);
    if (r.part_was_pressure === 'TRUE') c.push('Pressure');
    return c;
}

function disegnaLista(corpo) {
    const lista = corpo.querySelector('#fr-list');
    const vis = visibili();
    const set = new Set(vis.map(r => r._i));
    // Riassunto del taglio: è la domanda "come va questo tipo di giocata?".
    const sc = vis.filter(r => scrimmage(r) && r.epa != null);
    const epa = sc.length ? sc.reduce((s, r) => s + +r.epa, 0) / sc.length : null;
    const succ = sc.length ? sc.filter(r => r.success === '1').length / sc.length : null;
    const yds = sc.length ? sc.reduce((s, r) => s + (+r.yards_gained || 0), 0) / sc.length : null;
    let html = `<p class="fr-summary"><b>${vis.length}</b> play${vis.length === 1 ? '' : 's'}${sc.length ? ` · EPA/play <b class="${epa > 0 ? 'is-good' : 'is-bad'}">${segno(epa)}</b> · success <b>${Math.round(succ * 100)}%</b> · ${yds.toFixed(1)} yds/play` : ''}</p>`;
    // Raggruppate per drive, nell'ordine della partita.
    let driveCorr = null;
    for (const r of S.rows) {
        if (!set.has(r._i)) continue;
        const dk = `${r.fixed_drive}|${r.posteam}`;
        if (dk !== driveCorr) {
            if (driveCorr) html += '</ol>';
            driveCorr = dk;
            const pos = sito(r.posteam);
            html += `<div class="fr-drive"><img src="${LOGO(pos)}" alt=""><b>${esc(pos || '—')}</b> drive ${esc(r.fixed_drive || '')}<span>${esc(r.fixed_drive_result || '')}${r.drive_play_count ? ` · ${r.drive_play_count} plays` : ''}${r.drive_time_of_possession ? ` · ${r.drive_time_of_possession}` : ''}${r.drive_start_yard_line ? ` · from ${r.drive_start_yard_line}` : ''}</span></div><ol class="fr-plays">`;
        }
        const y = r.yards_gained;
        html += `<li><button type="button" class="fr-play${S.sel === r._i ? ' is-sel' : ''}${r.touchdown === '1' ? ' is-td' : ''}${r.interception === '1' || r.fumble_lost === '1' ? ' is-to' : ''}" data-fr-play="${r._i}">
            <span class="fr-clock">${esc(orologio(r))}</span>
            <span class="fr-sit">${esc(situazione(r))}</span>
            <span class="fr-desc">${esc(r.desc || r.play_type || '')}<span class="fr-chips">${chips(r).map(c => `<i>${esc(c)}</i>`).join('')}</span></span>
            <span class="fr-yds">${y != null && scrimmage(r) ? `${+y > 0 ? '+' : ''}${y}` : ''}</span>
            <span class="fr-epa ${r.epa != null ? epaTono(r) : ''}">${r.epa != null ? segno(r.epa) : ''}</span>
        </button></li>`;
    }
    if (driveCorr) html += '</ol>';
    if (!vis.length) html += '<p class="pm-note">No play matches these filters.</p>';
    lista.innerHTML = html;
}
/** Colore dell'EPA dal punto di vista della squadra scelta: un +0.8 degli
 *  avversari è una brutta giocata per la sua difesa. */
function epaTono(r) {
    const e = +r.epa;
    const mio = r.posteam === nflv(S.team) ? e : -e;
    return mio > 0.05 ? 'is-good' : mio < -0.05 ? 'is-bad' : '';
}

// ─── dettaglio della giocata ─────────────────────────────────────────────

function scegli(corpo, i, scorri = true, apri = scorri) {
    S.sel = i;
    corpo.querySelectorAll('.fr-play.is-sel').forEach(b => b.classList.remove('is-sel'));
    const btn = corpo.querySelector(`.fr-play[data-fr-play="${i}"]`);
    btn?.classList.add('is-sel');
    if (scorri) btn?.scrollIntoView({ block: 'nearest' });
    const det = corpo.querySelector('#fr-detail');
    det.innerHTML = dettaglioHtml(S.rows[i]);
    // Sul telefono il dettaglio è un foglio a tutto schermo: si apre quando
    // si sceglie una giocata, non al caricamento.
    if (apri) { det.classList.add('is-open'); det.scrollTop = 0; }
}

/** Valore di una dimensione del catalogo su una giocata, rispettandone il
 *  filtro: chiamare `valore` da solo su un punt dava "Read undefined". */
const dv = (key, r) => { const d = DIMS.find(x => x.key === key); return d && d.filtro(r) ? d.valore(r) : null; };
const SN = (v) => (v === 'TRUE' ? 'Yes' : v === 'FALSE' ? 'No' : v);
function voce(label, v, cls = '') {
    if (v == null || v === '') return '';
    return `<div class="fr-kv ${cls}"><span>${esc(label)}</span><b>${esc(v)}</b></div>`;
}

function dettaglioHtml(r) {
    const vis = visibili(), pos = vis.findIndex(x => x._i === r._i);
    const pct = (x) => (x == null || x === '' ? null : `${(+x * 100).toFixed(1)}%`);
    const wpA = r.wp != null ? +r.wp : null, wpB = r.wpa != null && wpA != null ? wpA + +r.wpa : null;
    const situ = [
        voce('Clock', orologio(r)), voce('Down & distance', r.down ? `${ord(r.down)} & ${r.goal_to_go === '1' ? 'Goal' : r.ydstogo}` : null),
        voce('Ball on', r.yrdln), voce('Yards to end zone', r.yardline_100),
        voce('Score', r.posteam ? `${sito(r.posteam)} ${r.posteam_score ?? ''} – ${r.defteam_score ?? ''} ${sito(r.defteam)}` : null),
        voce('Win prob. (offense)', wpA != null ? `${(wpA * 100).toFixed(1)}% → ${wpB != null ? `${(wpB * 100).toFixed(1)}%` : '—'}` : null),
        voce('Expected points', r.ep != null ? `${(+r.ep).toFixed(2)} → ${segno(r.epa)} EPA` : null),
        voce('Success', r.success === '1' ? 'Yes' : r.success === '0' ? 'No' : null),
        voce('Timeouts left', r.posteam_timeouts_remaining != null ? `${sito(r.posteam)} ${r.posteam_timeouts_remaining} · ${sito(r.defteam)} ${r.defteam_timeouts_remaining}` : null),
    ].join('');
    const pre = [
        voce('Formation', r.part_offense_formation ? et(r.part_offense_formation) : null), voce('QB alignment', dv('qbLocation', r)),
        voce('Shotgun', r.shotgun === '1' ? 'Yes' : r.shotgun === '0' ? 'No' : null), voce('No huddle', r.no_huddle === '1' ? 'Yes' : null),
        voce('Offensive personnel', r.part_offense_personnel), voce('Defensive personnel', r.part_defense_personnel),
        voce('Defensive package', dv('defPackage', r)),
        voce('Players in backfield', r.ftn_n_offense_backfield && r.ftn_qb_location && r.ftn_qb_location !== '0' ? r.ftn_n_offense_backfield : null),
        voce('Box (participation)', +r.part_defenders_in_box ? r.part_defenders_in_box : null), voce('Box (FTN)', +r.ftn_n_defense_box ? r.ftn_n_defense_box : null),
        voce('Hash', ({ L: 'Left', M: 'Middle', R: 'Right' })[r.ftn_starting_hash]),
        voce('Motion', SN(r.ftn_is_motion)), voce('Play action', SN(r.ftn_is_play_action)), voce('RPO', SN(r.ftn_is_rpo)),
        voce('Screen', SN(r.ftn_is_screen_pass)), voce('Trick play', r.ftn_is_trick_play === 'TRUE' ? 'Yes' : null),
    ].join('');
    const dif = [
        voce('Coverage', r.part_defense_coverage_type ? et(r.part_defense_coverage_type) : null), voce('Man / zone', ({ MAN_COVERAGE: 'Man', ZONE_COVERAGE: 'Zone' })[r.part_defense_man_zone_type]),
        voce('Pass rushers', +r.part_number_of_pass_rushers ? r.part_number_of_pass_rushers : (+r.ftn_n_pass_rushers ? r.ftn_n_pass_rushers : null)),
        voce('Blitzers', r.ftn_n_blitzers != null && +r.ftn_n_pass_rushers ? r.ftn_n_blitzers : null),
        voce('Pressure', SN(r.part_was_pressure)), voce('QB hit', r.qb_hit === '1' ? 'Yes' : null),
        voce('Time to throw', r.part_time_to_throw ? `${(+r.part_time_to_throw).toFixed(2)}s` : null),
    ].join('');
    const esito = [
        voce('Play type', r.play_type), voce('Yards gained', r.yards_gained),
        voce('Pass', r.pass_length || r.pass_location ? `${r.pass_length || ''} ${r.pass_location || ''}`.trim() : null),
        voce('Air yards', r.air_yards), voce('Yards after catch', r.yards_after_catch), voce('Expected YAC', r.xyac_mean_yardage != null ? (+r.xyac_mean_yardage).toFixed(1) : null),
        voce('Route of target', r.part_route), voce('Read thrown', dv('readThrown', r)),
        voce('Completion prob.', pct(r.cp)), voce('CPOE', r.cpoe != null ? segno(r.cpoe, 1) : null),
        voce('Expected pass (xPass)', pct(r.xpass)), voce('Pass over expected', r.pass_oe != null ? `${segno(r.pass_oe, 1)} pts` : null),
        voce('Catchable', SN(r.ftn_is_catchable_ball)), voce('Contested', SN(r.ftn_is_contested_ball)), voce('Drop', r.ftn_is_drop === 'TRUE' ? 'Yes' : null),
        voce('Created reception', r.ftn_is_created_reception === 'TRUE' ? 'Yes' : null), voce('Interception-worthy', r.ftn_is_interception_worthy === 'TRUE' ? 'Yes' : null),
        voce('Throwaway', r.ftn_is_throw_away === 'TRUE' ? 'Yes' : null), voce('Out of pocket', r.ftn_is_qb_out_of_pocket === 'TRUE' ? 'Yes' : null),
        voce('Run', r.run_location ? `${r.run_location}${r.run_gap ? ` ${r.run_gap}` : ''}` : null),
        voce('Scramble', r.qb_scramble === '1' ? 'Yes' : null),
        voce('Penalty', r.penalty === '1' ? `${r.penalty_type || ''} on ${sito(r.penalty_team) || ''}${r.penalty_player_name ? ` (${r.penalty_player_name})` : ''}, ${r.penalty_yards || 0} yds` : null),
    ].join('');
    return `
        <button type="button" class="fr-close" data-fr-close>✕ Back to the plays</button>
        <div class="fr-nav">
            <button type="button" data-fr-step="-1" ${pos <= 0 ? 'disabled' : ''} aria-label="Previous play">‹ Prev</button>
            <span>${pos >= 0 ? `${pos + 1} / ${vis.length}` : 'Not in the current filter'}</span>
            <button type="button" data-fr-step="1" ${pos < 0 || pos >= vis.length - 1 ? 'disabled' : ''} aria-label="Next play">Next ›</button>
        </div>
        <p class="fr-dtitle">${esc(r.desc || '')}</p>
        ${campoHtml(r)}
        <div class="fr-sec"><h4>Situation</h4><div class="fr-kvs">${situ}</div></div>
        ${pre ? `<div class="fr-sec"><h4>Pre-snap</h4><div class="fr-kvs">${pre}</div></div>` : ''}
        ${dif ? `<div class="fr-sec"><h4>Defense & pressure</h4><div class="fr-kvs">${dif}</div></div>` : ''}
        <div class="fr-sec"><h4>Result</h4><div class="fr-kvs">${esito}</div></div>
        ${ventidueHtml(r)}
        ${grezziHtml(r)}
        <p class="fr-hint">Keyboard: ← → previous / next play.</p>`;
}

// ─── campo della giocata (schema) ────────────────────────────────────────

/**
 * Campo orizzontale dal punto di vista dell'attacco, che va verso destra.
 * VERI: linea di scrimmage, linea del primo down, lunghezza del passaggio
 * (air yards), YAC, yard della corsa, corsia (left/middle/right, gap).
 * DISEGNATA: la forma della traccia.
 */
function campoHtml(r) {
    const yl = r.yardline_100 != null ? +r.yardline_100 : null;
    if (yl == null || !r.posteam) return '';
    const W = 600, H = 150, M = 30; // 100 yard su W-2M, più due end zone da 10 yard
    const X = (yd) => M + ((110 - yd) / 120) * (W - 2 * M) + 0; // yd = yard dalla end zone avversaria
    const xEz = (d) => M + ((d + 10) / 120) * (W - 2 * M);
    const los = X(yl);
    const fd = r.ydstogo && r.down ? X(Math.max(0, yl - +r.ydstogo)) : null;
    const corsia = (v) => ({ left: 0.25, middle: 0.5, right: 0.75 })[v] ?? 0.5;
    const gapY = (loc, gap) => (loc === 'middle' ? 0.5 : loc === 'left' ? ({ guard: 0.42, tackle: 0.34, end: 0.2 })[gap] ?? 0.3 : ({ guard: 0.58, tackle: 0.66, end: 0.8 })[gap] ?? 0.7);
    let traccia = '';
    const yIn = (f) => 14 + f * (H - 28);
    const y0 = yIn(0.5);
    if (r.pass === '1' && r.sack !== '1' && r.air_yards != null) {
        const ay = +r.air_yards, yy = yIn(corsia(r.pass_location));
        const xC = X(yl - ay);
        const ok = r.complete_pass === '1';
        traccia += `<path d="M${los - 14},${y0} Q${(los + xC) / 2},${Math.min(y0, yy) - 34} ${xC},${yy}" class="fr-air${ok ? '' : ' is-inc'}"/>`;
        if (ok && r.yards_after_catch != null) traccia += `<line x1="${xC}" y1="${yy}" x2="${X(yl - ay - +r.yards_after_catch)}" y2="${yy}" class="fr-yac"/>`;
        traccia += `<circle cx="${ok && r.yards_after_catch != null ? X(yl - ay - +r.yards_after_catch) : xC}" cy="${yy}" r="5" class="fr-ball${ok ? '' : ' is-inc'}"/>`;
    } else if (r.kick_distance != null && (r.punt_attempt === '1' || r.kickoff_attempt === '1' || r.field_goal_attempt === '1')) {
        // Sul kickoff `posteam` è chi RICEVE: il calcio va verso la sua end
        // zone (a sinistra), e il ritorno torna verso destra. Su punt e
        // field goal calcia chi ha la palla, verso destra.
        const ko = r.kickoff_attempt === '1', dir = ko ? -1 : 1;
        const kd = +r.kick_distance, ret = +r.return_yards || 0;
        const xK = X(yl - dir * kd);
        traccia += `<path d="M${los},${y0} Q${(los + xK) / 2},${y0 - 52} ${xK},${y0}" class="fr-kick"/><circle cx="${xK}" cy="${y0}" r="5" class="fr-ball"/>`;
        if (ret) traccia += `<line x1="${xK}" y1="${y0 + 8}" x2="${X(yl - dir * kd + dir * ret)}" y2="${y0 + 8}" class="fr-ret"/>`;
    } else if (r.rush === '1' || r.sack === '1') {
        const yy = r.sack === '1' ? y0 : yIn(gapY(r.run_location, r.run_gap));
        const xF = X(yl - (+r.yards_gained || 0));
        traccia += `<path d="M${los - 10},${y0} L${los + 2},${yy} L${xF},${yy}" class="fr-run${(+r.yards_gained || 0) < 0 ? ' is-loss' : ''}"/><circle cx="${xF}" cy="${yy}" r="5" class="fr-ball"/>`;
    }
    const tacche = [];
    for (let d = 10; d <= 90; d += 10) tacche.push(`<line x1="${xEz(d)}" y1="0" x2="${xEz(d)}" y2="${H}" class="fr-yl"/><text x="${xEz(d)}" y="${H - 4}" class="fr-yn">${d <= 50 ? d : 100 - d}</text>`);
    const pos = sito(r.posteam), def = sito(r.defteam);
    return `<figure class="fr-field">
        <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Play diagram">
            <rect x="${M}" y="0" width="${W - 2 * M}" height="${H}" class="fr-grass"/>
            <rect x="${M}" y="0" width="${(W - 2 * M) / 12}" height="${H}" class="fr-ez" style="fill:${getTeamIdentity(pos)?.color || '#333'}"/>
            <rect x="${W - M - (W - 2 * M) / 12}" y="0" width="${(W - 2 * M) / 12}" height="${H}" class="fr-ez" style="fill:${getTeamIdentity(def)?.color || '#333'}"/>
            ${tacche.join('')}
            <line x1="${los}" y1="0" x2="${los}" y2="${H}" class="fr-los"/>
            ${fd != null ? `<line x1="${fd}" y1="0" x2="${fd}" y2="${H}" class="fr-fd"/>` : ''}
            ${traccia}
        </svg>
        <figcaption>${esc(pos)} → attacking right. Blue = line of scrimmage, yellow = first down. Lengths and direction are real (air yards, YAC, yards, gap, kick and return distance); the shape of the path is drawn — tracking data is not public.</figcaption>
    </figure>`;
}

// ─── i 22 in campo ───────────────────────────────────────────────────────

const ORDINE_RUOLI = ['QB', 'RB', 'FB', 'WR', 'TE', 'T', 'G', 'C', 'OL', 'DE', 'DT', 'NT', 'DL', 'OLB', 'ILB', 'MLB', 'LB', 'CB', 'SS', 'FS', 'S', 'DB', 'K', 'P', 'LS'];
const posto = (r) => { const i = ORDINE_RUOLI.indexOf(r); return i === -1 ? 99 : i; };
function lato22(nomi, ruoli, numeri) {
    const N = String(nomi || '').split(';'), R = String(ruoli || '').split(';'), U = String(numeri || '').split(';');
    return N.map((n, i) => ({ n, r: R[i] || '', u: U[i] || '' })).filter(x => x.n)
        .sort((a, b) => posto(a.r) - posto(b.r));
}
function ventidueHtml(r) {
    if (!r.part_offense_names && !r.part_defense_names) {
        return `<div class="fr-sec"><h4>On the field</h4><p class="fr-miss">${S.game.part ? 'Not listed for this play.' : 'The players on the field come from participation data, which nflverse publishes after the season.'}</p></div>`;
    }
    const col = (lista, squadra) => `<div><h5>${esc(sito(squadra) || '')}</h5><ol class="fr-22">${lista.map(x => `<li><b>${esc(x.u)}</b><span>${esc(x.n)}</span><i>${esc(x.r)}</i></li>`).join('')}</ol></div>`;
    return `<div class="fr-sec"><h4>On the field</h4><div class="fr-22s">
        ${col(lato22(r.part_offense_names, r.part_offense_positions, r.part_offense_numbers), r.posteam)}
        ${col(lato22(r.part_defense_names, r.part_defense_positions, r.part_defense_numbers), r.defteam)}
    </div></div>`;
}

// ─── tutti i campi ───────────────────────────────────────────────────────

function grezziHtml(r) {
    const { cols, fonti } = S.idx;
    const NOMI = { pbp: 'Play-by-play', part: 'Participation', ftn: 'FTN charting' };
    const gruppi = Object.entries(fonti).filter(([, [a, b]]) => b > a).map(([k, [a, b]]) => {
        const righe = cols.slice(a, b).map(c => {
            const v = r[c];
            const nome = k === 'pbp' ? c : c.replace(/^(part|ftn)_/, '');
            return `<tr${v == null ? ' class="is-empty"' : ''}><th>${esc(nome)}</th><td>${v == null ? '—' : esc(v)}</td></tr>`;
        }).join('');
        const pieni = cols.slice(a, b).filter(c => r[c] != null).length;
        return `<details class="fr-raw"><summary>${NOMI[k]} <small>${pieni} of ${b - a} fields filled</small></summary><div class="fr-raw-wrap"><table>${righe}</table></div></details>`;
    }).join('');
    return `<div class="fr-sec"><h4>Raw data — every field</h4>${gruppi}</div>`;
}

// ─── eventi ──────────────────────────────────────────────────────────────

function passo(corpo, d) {
    const vis = visibili();
    const i = vis.findIndex(x => x._i === S.sel);
    const nx = vis[i + d];
    if (nx) scegli(corpo, nx._i, true, corpo.querySelector('#fr-detail')?.classList.contains('is-open'));
}

let _tasti = null;
function leghe(corpo) {
    if (!corpo.dataset.frBound) {
        corpo.dataset.frBound = '1';
        corpo.addEventListener('click', (e) => {
            if (!S) return;
            const g = e.target.closest('[data-fr-game]');
            if (g) {
                S.gid = g.dataset.frGame;
                S.game = S.partite.find(x => x.id === S.gid);
                corpo.querySelectorAll('.fr-game').forEach(b => b.classList.toggle('is-active', b === g));
                history.replaceState(null, '', `#nfl-tactics/${S.team}/${S.anno}/film/${S.gid}`);
                caricaPartita(corpo);
                return;
            }
            const p = e.target.closest('[data-fr-play]');
            if (p) { scegli(corpo, +p.dataset.frPlay, false, true); return; }
            if (e.target.closest('[data-fr-close]')) { corpo.querySelector('#fr-detail')?.classList.remove('is-open'); return; }
            const st = e.target.closest('[data-fr-step]');
            if (st) { passo(corpo, +st.dataset.frStep); return; }
            const l = e.target.closest('[data-fr-lato]');
            if (l) { S.lato = l.dataset.frLato; S.filtri = {}; rifaiFiltri(corpo); return; }
            if (e.target.closest('[data-fr-altri]')) { S.altri = !(S.altri || Object.keys(S.filtri).some(k => S.filtri[k] && FILTRI.indexOf(k) >= 8)); rifaiFiltri(corpo); return; }
            if (e.target.closest('[data-fr-reset]')) { S.filtri = {}; S.esito = ''; S.cerca = ''; rifaiFiltri(corpo); }
        });
        corpo.addEventListener('change', (e) => {
            if (!S) return;
            const f = e.target.closest('[data-fr-f]');
            if (f) { S.filtri[f.dataset.frF] = f.value; rifaiFiltri(corpo); return; }
            if (e.target.matches('[data-fr-esito]')) { S.esito = e.target.value; disegnaLista(corpo); aggiornaDettaglio(corpo); }
        });
        corpo.addEventListener('input', (e) => {
            if (S && e.target.matches('[data-fr-cerca]')) { S.cerca = e.target.value; disegnaLista(corpo); aggiornaDettaglio(corpo); }
        });
    }
    if (_tasti) document.removeEventListener('keydown', _tasti);
    _tasti = (e) => {
        if (!S || !document.body.contains(corpo) || !corpo.querySelector('#fr-list')) return;
        if (e.target.closest?.('input, select, textarea')) return;
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); passo(corpo, 1); }
        else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); passo(corpo, -1); }
    };
    document.addEventListener('keydown', _tasti);
}

/** Cambiano i filtri: si ridisegnano i select (le conte dipendono dal lato)
 *  e la lista, e il dettaglio va sulla prima giocata rimasta se quella
 *  scelta è uscita dal taglio. */
function rifaiFiltri(corpo) {
    const box = corpo.querySelector('.fr-filters');
    if (box) box.outerHTML = filtriHtml();
    disegnaLista(corpo);
    aggiornaDettaglio(corpo);
}
function aggiornaDettaglio(corpo) {
    const vis = visibili();
    if (!vis.length) { corpo.querySelector('#fr-detail').innerHTML = ''; return; }
    scegli(corpo, vis.some(r => r._i === S.sel) ? S.sel : vis[0]._i, false);
}

/** Da chiamare uscendo dalla vista: stacca le frecce della tastiera. */
export function lasciaFilm() {
    if (_tasti) document.removeEventListener('keydown', _tasti);
    _tasti = null;
    S = null;
}
