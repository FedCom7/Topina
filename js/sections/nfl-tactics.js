/**
 * Tactics — come gioca una squadra NFL, in attacco e in difesa, con tutti i
 * dati di schema e stile che nflverse pubblica (#nfl-tactics/{SIGLA}/{ANNO}).
 *
 * I numeri sono precalcolati da scripts/build-nfl-tactics.mjs in
 * data/nfl/tactics/{Y}/{SIGLA}.json + league.json; cosa si conta e come si
 * chiama sta in js/data/tactics-catalog.js, lo stesso modulo che usa il
 * builder. Questa pagina non ricalcola niente: divide somme per giocate.
 *
 * Tre regole, tutte e tre per non far dire ai numeri più di quello che sanno:
 *  - ogni fonte dichiara se per quell'anno c'è (participation 2016–2025, FTN
 *    dal 2022, PFR dal 2018): una dimensione senza dati non si disegna vuota,
 *    si dice perché manca;
 *  - in DIFESA l'EPA è quello concesso, quindi "buono" è basso: colori e
 *    rank si leggono al contrario e la testata del lato lo scrive;
 *  - sotto le 30 giocate un valore resta a schermo ma spento: un EPA su 8
 *    snap è rumore, e colorato sembrerebbe una tendenza.
 *
 * Si entra dalla pagina NFL Hub e dalla pagina squadra NFL: il menu delle 32
 * squadre per division non si tocca.
 */

import { DIMS, GRUPPI, FONTI, METRICHE } from '../data/tactics-catalog.js?v=1';
import { NFL_TEAMS, getTeamIdentity } from '../data/nfl-teams.js?v=513';

const PRIMO_ANNO = 2016;
const MIN_PLAYS = 30;
const LOGO = (abbr) => `https://a.espncdn.com/i/teamlogos/nfl/500/${String(abbr || '').toLowerCase()}.png`;
const esc = (v) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const annoCorrente = () => { const d = new Date(); return d.getMonth() + 1 >= 3 ? d.getFullYear() : d.getFullYear() - 1; };

const _cache = {};
const carica = (url) => (_cache[url] ??= fetch(url).then(r => (r.ok ? r.json() : null)).catch(() => null));

let _film = null; // modulo della sala video, se è già stato aperto
let stato = { team: null, anno: null, lato: 'off', vista: 'season', gid: null };

/** #nfl-tactics/{SIGLA}/{ANNO}[/film[/{game_id}]] */
function leggiHash() {
    const [, team, anno, vista, gid] = location.hash.replace(/^#/, '').split('/');
    return { team: (team || '').toUpperCase() || null, anno: +anno || null, vista: ['film', 'study'].includes(vista) ? vista : 'season', gid: gid || null };
}
const indirizzo = (team, anno, vista = stato.vista) => `#nfl-tactics/${team}/${anno}${vista === 'season' ? '' : `/${vista}`}`;

export async function initNflTactics() {
    const sez = document.getElementById('nfl-tactics');
    if (!sez) return;
    const h = leggiHash();
    const team = NFL_TEAMS[h.team] ? h.team : (stato.team || 'PHI');
    const anno = h.anno && h.anno >= PRIMO_ANNO && h.anno <= annoCorrente() ? h.anno : (stato.anno || annoCorrente());
    stato = { ...stato, team, anno, vista: h.vista, gid: h.gid };
    sez.innerHTML = `<div class="tx-wrap">${testata(team, anno)}<div id="tx-body"><div class="loading-state"><div class="spinner"></div></div></div></div>`;
    lega(sez);
    await disegna(sez);
}

// ─── testata ─────────────────────────────────────────────────────────────

function selettoreSquadre(team) {
    const perDiv = {};
    for (const [abbr, t] of Object.entries(NFL_TEAMS)) (perDiv[t.division] ??= []).push([abbr, t.name]);
    const divs = Object.keys(perDiv).sort();
    return `<select class="tx-select" id="tx-team" aria-label="Team">${divs.map(d => `<optgroup label="${esc(d)}">${perDiv[d].sort((a, b) => a[1].localeCompare(b[1])).map(([a, n]) => `<option value="${a}"${a === team ? ' selected' : ''}>${esc(n)}</option>`).join('')}</optgroup>`).join('')}</select>`;
}

function testata(team, anno) {
    const id = getTeamIdentity(team);
    const anni = [];
    for (let y = annoCorrente(); y >= PRIMO_ANNO; y--) anni.push(y);
    return `
    <header class="tx-head" style="--tx-team:${id?.color || '#888'}">
        <div class="tx-head-id">
            <img src="${LOGO(team)}" alt="" class="tx-logo">
            <div>
                <span class="mc-kicker">NFL Hub · Tactics</span>
                <h1 class="tx-title">${esc(id?.name || team)}</h1>
            </div>
        </div>
        <div class="tx-controls">
            ${selettoreSquadre(team)}
            <select class="tx-select" id="tx-year" aria-label="Season">${anni.map(y => `<option value="${y}"${y === anno ? ' selected' : ''}>${y}</option>`).join('')}</select>
            <a class="tx-link" href="#nfl-team/${team}/${anno}">Team page ›</a>
        </div>
    </header>
    <nav class="tx-views" aria-label="View">
        <a href="${indirizzo(team, anno, 'season')}" class="tx-view${stato.vista === 'season' ? ' is-active' : ''}">Season analysis</a>
        <a href="${indirizzo(team, anno, 'film')}" class="tx-view${stato.vista === 'film' ? ' is-active' : ''}">Film room <small>snap by snap · 2023+</small></a>
        <a href="${indirizzo(team, anno, 'study')}" class="tx-view${stato.vista === 'study' ? ' is-active' : ''}">Study of the Game <small>the lab</small></a>
    </nav>`;
}

function lega(sez) {
    // La sezione resta nel documento fra una visita e l'altra: il click
    // delegato si aggancia una volta sola, i due select sono nuovi a ogni giro.
    if (!sez.dataset.txBound) {
        sez.dataset.txBound = '1';
        sez.addEventListener('click', (e) => {
            const b = e.target.closest('[data-tx-lato]');
            if (b) { stato.lato = b.dataset.txLato; disegna(sez); return; }
            const piu = e.target.closest('[data-tx-rare]');
            if (piu) {
                const tb = piu.closest('.tx-dim')?.querySelector('.tx-rare');
                if (!tb) return;
                tb.hidden = !tb.hidden;
                piu.textContent = tb.hidden ? piu.dataset.chiuso : 'Hide rarer values';
            }
        });
    }
    sez.querySelector('#tx-team')?.addEventListener('change', (e) => { location.hash = indirizzo(e.target.value, stato.anno); });
    sez.querySelector('#tx-year')?.addEventListener('change', (e) => { location.hash = indirizzo(stato.team, e.target.value); });
}

// ─── corpo ───────────────────────────────────────────────────────────────

async function disegna(sez) {
    const corpo = sez.querySelector('#tx-body');
    const { team, anno, lato } = stato;
    // Sala video: modulo a parte, caricato solo quando la si apre.
    if (stato.vista === 'film') {
        const m = _film = await import('./nfl-film.js?v=4').catch(() => null);
        if (!m) { corpo.innerHTML = '<p class="pm-note">The film room could not be loaded.</p>'; return; }
        await m.renderFilm(corpo, { team, anno, gid: stato.gid });
        return;
    }
    _film?.lasciaFilm();
    // Study of the Game: anche lui a parte, caricato solo quando lo si apre.
    if (stato.vista === 'study') {
        const m = await import('./nfl-study.js?v=5').catch(() => null);
        if (!m) { corpo.innerHTML = '<p class="pm-note">The lab could not be loaded.</p>'; return; }
        await m.renderStudy(corpo, { team, anno, avv: stato.gid });
        return;
    }
    const [d, L] = await Promise.all([carica(`data/nfl/tactics/${anno}/${team}.json`), carica(`data/nfl/tactics/${anno}/league.json`)]);
    if (stato.team !== team || stato.anno !== anno) return;
    if (!d || !L) { corpo.innerHTML = `<p class="pm-note">No tactical data for ${esc(team)} in ${anno} yet.</p>`; return; }
    corpo.innerHTML = `
        ${fontiHtml(d, anno)}
        <div class="tx-sidebar" role="tablist">
            <button type="button" class="tx-side${lato === 'off' ? ' is-active' : ''}" data-tx-lato="off" role="tab">Offense</button>
            <button type="button" class="tx-side${lato === 'def' ? ' is-active' : ''}" data-tx-lato="def" role="tab">Defense</button>
        </div>
        <p class="tx-sidenote">${lato === 'off'
            ? `What <b>${esc(team)}</b> does with the ball. EPA is what they produce: higher is better. "vs" columns compare with the league average.`
            : `What <b>${esc(team)}</b> shows and allows on defense. EPA is what opponents produce against them: <b>lower is better</b>, and colors and ranks are read that way.`}
            Regular season only, through week ${d.throughWeek} · ${d.games} games.</p>
        ${metricheHtml(d, L, lato)}
        ${GRUPPI.map(g => gruppoHtml(g, d, L, lato)).join('')}
        ${matriciHtml(d, L, lato)}
        ${driveEFalliHtml(d, L, lato)}
        ${giocatoriHtml(d)}
        <p class="pm-note tx-foot">Sources: nflverse play-by-play, participation (NGS/FTN), FTN charting, Next Gen Stats, Pro Football Reference advanced stats and snap counts. EPA = expected points added; success = a play that gains enough to keep the drive on schedule (nflfastR definition). Ranks are among the 32 teams for that season; "usage rank" 1 = uses it most.</p>`;
}

function fontiHtml(d, anno) {
    const a = d.avail || {};
    const voce = (ok, nome, perche) => `<span class="tx-src ${ok ? 'is-on' : 'is-off'}" title="${esc(perche)}">${ok ? '●' : '○'} ${esc(nome)}</span>`;
    const partPerche = a.part ? 'Formation, personnel, box, rushers, coverage, man/zone, routes, time to throw, pressure.'
        : anno >= 2026 ? `nflverse publishes participation after the season: formation, personnel, coverage and the players on the field for ${anno} are not out yet.`
        : 'Not available for this season.';
    return `<div class="tx-sources">
        ${voce(a.pbp, 'Play-by-play', 'Every play: down, distance, pass/run, depth, direction, gap, EPA, success, xPass.')}
        ${voce(a.part, 'Participation', partPerche)}
        ${voce(a.ftn, 'FTN charting', a.ftn ? 'Motion, play action, RPO, screens, hash, QB alignment, backfield, blitzers, catchable/contested, drops, reads.' : 'FTN charting starts in 2022.')}
        ${voce(a.ngs, 'Next Gen Stats', 'Player tracking: time to throw, separation, cushion, rush yards over expected…')}
        ${voce(a.pfr, 'PFR advanced', a.pfr ? 'Pressures, blitzes, drops, broken tackles, coverage allowed…' : 'PFR advanced stats start in 2018.')}
        ${voce(a.snaps, 'Snap counts', 'Snaps and share per player.')}
    </div>`;
}

// ─── formati ─────────────────────────────────────────────────────────────

const pct = (x, d = 1) => (x == null ? '—' : `${(x * 100).toFixed(d)}%`);
const segno = (x, d = 2) => (x == null ? '—' : `${x > 0 ? '+' : ''}${x.toFixed(d)}`);
function fmt(v, f) {
    if (v == null) return '—';
    switch (f) {
        case 'pct': return pct(v);
        case 'pp': return `${v > 0 ? '+' : ''}${v.toFixed(1)}`;
        case 'epa': return segno(v, 3);
        case 'sec': return `${v.toFixed(2)}s`;
        case 'yd': return v.toFixed(1);
        case 'num1': return v.toFixed(1);
        case 'num2': return v.toFixed(2);
        case 'mmss': { const s = Math.round(v); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }
        default: return String(v);
    }
}

/** Il rank "buono" per il lato: in attacco 1 = valore più alto se `alto` è
 *  buono; in difesa si rovescia, perché lì il numero è quello concesso. */
function rankBuono(rank, meglio, lato, tot = 32) {
    if (rank == null || !meglio) return null;
    const altoBuono = (meglio === 'alto') !== (lato === 'def');
    return altoBuono ? rank : tot + 1 - rank;
}
const classeRank = (r) => (r == null ? '' : r <= 8 ? 'is-good' : r >= 25 ? 'is-bad' : 'is-mid');

// ─── metriche di squadra ─────────────────────────────────────────────────

function metricheHtml(d, L, lato) {
    const M = d.side[lato].metrics;
    const celle = METRICHE.map(m => {
        const [v, rank] = M[m.key] || [];
        if (v == null) return '';
        const rb = rankBuono(rank, m.meglio, lato);
        const lg = L.metrics?.[m.key];
        return `<div class="tx-metric">
            <span class="tx-metric-label">${esc(m.label)}</span>
            <b class="tx-metric-val">${fmt(v, m.fmt)}</b>
            <span class="tx-metric-sub">League ${fmt(lg, m.fmt)}${rank ? ` · <i class="tx-rank ${classeRank(rb)}" title="${m.meglio ? 'Rank where 1 = best' : 'Rank where 1 = highest'}">#${m.meglio ? rb : rank}</i>` : ''}</span>
        </div>`;
    }).join('');
    return `<section class="tx-block"><h2 class="tx-h2">Profile</h2><div class="tx-metrics">${celle}</div></section>`;
}

// ─── dimensioni ──────────────────────────────────────────────────────────

const ETICHETTE_VALORE = {
    COVER_0: 'Cover 0', COVER_1: 'Cover 1', '2_MAN': '2-Man', COVER_2: 'Cover 2', COVER_3: 'Cover 3', COVER_4: 'Cover 4 (quarters)',
    COVER_6: 'Cover 6', COVER_9: 'Cover 9', COMBO: 'Combination', BLOWN: 'Blown coverage',
    SHOTGUN: 'Shotgun', 'UNDER CENTER': 'Under center', PISTOL: 'Pistol', SINGLEBACK: 'Singleback', I_FORM: 'I-formation',
    EMPTY: 'Empty', JUMBO: 'Jumbo', WILDCAT: 'Wildcat',
};
const etichettaValore = (dim, v) => (dim.key === 'personnel' ? `${v} personnel` : ETICHETTE_VALORE[v] || (v === v.toUpperCase() && v.length > 3 ? v.charAt(0) + v.slice(1).toLowerCase() : v));

function gruppoHtml(g, d, L, lato) {
    const dims = DIMS.filter(x => x.gruppo === g.key);
    const carte = dims.map(dim => dimHtml(dim, d, L, lato)).filter(Boolean);
    if (!carte.length) return '';
    return `<section class="tx-block"><h2 class="tx-h2">${esc(g.label)}</h2><div class="tx-dims">${carte.join('')}</div></section>`;
}

function dimHtml(dim, d, L, lato) {
    const vals = d.side[lato].dims[dim.key];
    const fonte = FONTI[dim.fonte];
    if (!vals || !Object.keys(vals).length) {
        const ok = d.avail?.[dim.fonte];
        if (ok) return '';
        return `<article class="tx-dim tx-dim--off"><header><h3>${esc(dim.label)}</h3><span class="tx-tag">${esc(fonte.label)}</span></header>
            <p class="tx-miss">${dim.fonte === 'part' ? `Participation data ${d.season >= 2026 ? `for ${d.season} is published after the season` : 'is not available for this season'}.` : dim.fonte === 'ftn' ? 'FTN charting starts in 2022.' : 'Not available.'}</p></article>`;
    }
    const lv = L.dims[dim.key] || {};
    const tot = Object.values(vals).reduce((s, a) => s + a[0], 0);
    const totL = Object.values(lv).reduce((s, a) => s + a[0], 0);
    const chiavi = Object.keys({ ...lv, ...vals });
    const ordine = dim.ordine || [];
    chiavi.sort((a, b) => {
        const ia = ordine.indexOf(a), ib = ordine.indexOf(b);
        if (ia !== -1 || ib !== -1) return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
        return (vals[b]?.[0] || 0) - (vals[a]?.[0] || 0);
    });
    // Le combinazioni rare (sotto l'1% sia per la squadra sia per la lega)
    // restano tutte, ma in un gruppo chiuso: personnel e pacchetti ne hanno
    // decine, e aperte coprirebbero le poche che contano.
    const raro = (v) => {
        const a = vals[v], b = lv[v];
        return (!a || a[0] / tot < 0.01) && (!b || b[0] / totL < 0.01);
    };
    const riga = (v) => {
        const a = vals[v] || [0, 0, 0, 0, 0, 0, 0, 0, null, null];
        const b = lv[v];
        const share = tot ? a[0] / tot : 0;
        const shareL = b && totL ? b[0] / totL : null;
        const epa = a[0] ? a[1] / a[0] : null;
        const epaL = b && b[0] ? b[1] / b[0] : null;
        const succ = a[0] ? a[2] / a[0] : null;
        const ypp = a[0] ? a[3] / a[0] : null;
        const poco = a[0] < MIN_PLAYS;
        const diff = epa != null && epaL != null ? epa - epaL : null;
        const tono = poco || diff == null ? '' : ((lato === 'off' ? diff : -diff) > 0.03 ? 'is-good' : (lato === 'off' ? diff : -diff) < -0.03 ? 'is-bad' : '');
        const rEpa = a[9] != null ? (lato === 'off' ? a[9] : 33 - a[9]) : null;
        return `<tr class="${poco ? 'is-thin' : ''}">
            <th scope="row">${esc(etichettaValore(dim, v))}</th>
            <td class="tx-bar-cell"><span class="tx-bar"><span class="tx-bar-fill" style="width:${(share * 100).toFixed(1)}%"></span>${shareL != null ? `<span class="tx-bar-lg" style="left:${(shareL * 100).toFixed(1)}%" title="League ${pct(shareL)}"></span>` : ''}</span></td>
            <td class="tx-num">${pct(share)}<small>${shareL != null ? `lg ${pct(shareL, 0)}` : ''}</small></td>
            <td class="tx-num">${a[0]}</td>
            <td class="tx-num ${tono}">${segno(epa)}<small>${diff != null ? `vs ${segno(diff)}` : ''}</small></td>
            <td class="tx-num">${pct(succ, 0)}</td>
            <td class="tx-num">${ypp == null ? '—' : ypp.toFixed(1)}</td>
            <td class="tx-num tx-ranks">${a[8] ?? '—'}<small>${rEpa != null ? `EPA #${rEpa}` : ''}</small></td>
        </tr>`;
    };
    const comuni = chiavi.filter(v => !raro(v)), rari = chiavi.filter(raro);
    const righe = comuni.map(riga).join('');
    const righeRare = rari.map(riga).join('');
    return `<article class="tx-dim">
        <header><h3>${esc(dim.label)}</h3><span class="tx-tag">${esc(fonte.label)}</span></header>
        <div class="tx-table-wrap"><table class="tx-table">
            <thead><tr><th></th><th>Usage</th><th class="tx-num">Share</th><th class="tx-num">Plays</th><th class="tx-num">EPA/play</th><th class="tx-num">Success</th><th class="tx-num">Yds/play</th><th class="tx-num" title="Usage rank among 32 (1 = uses it most) and EPA rank (1 = best for this side)">Rank</th></tr></thead>
            <tbody>${righe}</tbody>
            ${rari.length ? `<tbody class="tx-rare" hidden>${righeRare}</tbody>` : ''}
        </table></div>
        ${rari.length ? `<button type="button" class="tx-more" data-tx-rare data-chiuso="Show ${rari.length} rarer value${rari.length > 1 ? 's' : ''} (under 1% for team and league)">Show ${rari.length} rarer value${rari.length > 1 ? 's' : ''} (under 1% for team and league)</button>` : ''}
    </article>`;
}

// ─── matrici personnel × difesa ──────────────────────────────────────────

function matriceHtml(titolo, sotto, mx, etC, lato) {
    const righe = Object.entries(mx || {}).map(([p, row]) => [p, row, Object.values(row).reduce((s, a) => s + a[0], 0)])
        .sort((a, b) => b[2] - a[2]).slice(0, 8);
    if (!righe.length) return '';
    const colTot = {};
    for (const [, row] of righe) for (const [c, a] of Object.entries(row)) colTot[c] = (colTot[c] || 0) + a[0];
    const cols = Object.entries(colTot).sort((a, b) => b[1] - a[1]).slice(0, 7).map(([c]) => c);
    const corpo = righe.map(([p, row, tot]) => `<tr><th scope="row">${esc(p)} <small>${tot}</small></th>${cols.map(c => {
        const a = row[c];
        if (!a) return '<td class="tx-mx-cell"></td>';
        const share = a[0] / tot, epa = a[1] / a[0];
        const buono = lato === 'off' ? epa : -epa;
        const tono = a[0] < MIN_PLAYS ? 'is-thin' : buono > 0.05 ? 'is-good' : buono < -0.05 ? 'is-bad' : '';
        return `<td class="tx-mx-cell ${tono}" style="--tx-a:${Math.min(1, share * 1.6).toFixed(2)}" title="${a[0]} plays · EPA ${segno(epa)} · success ${pct(a[2] / a[0], 0)}"><b>${pct(share, 0)}</b><small>${segno(epa)}</small></td>`;
    }).join('')}</tr>`).join('');
    return `<article class="tx-dim tx-dim--wide"><header><h3>${esc(titolo)}</h3><span class="tx-tag">Participation</span></header>
        <p class="tx-mx-note">${sotto}</p>
        <div class="tx-table-wrap"><table class="tx-table tx-mx"><thead><tr><th>Personnel</th>${cols.map(c => `<th>${esc(etC(c))}</th>`).join('')}</tr></thead><tbody>${corpo}</tbody></table></div></article>`;
}

function matriciHtml(d, L, lato) {
    const mx = d.side[lato].mx || {};
    const etCov = (c) => ETICHETTE_VALORE[c] || c;
    const a = matriceHtml(lato === 'off' ? 'What defenses showed against each personnel' : 'What they showed against each personnel',
        'Row = offensive personnel, cell = share of those snaps in that defensive package, with EPA/play below.', mx.persPkg, (c) => c, lato);
    const b = matriceHtml(lato === 'off' ? 'Coverage faced by personnel (dropbacks)' : 'Coverage called by personnel (dropbacks)',
        'Row = offensive personnel, cell = share of dropbacks in that coverage, with EPA/play below.', mx.persCov, etCov, lato);
    if (!a && !b) return '';
    return `<section class="tx-block"><h2 class="tx-h2">Personnel matchups</h2><div class="tx-dims">${a}${b}</div></section>`;
}

// ─── drive e falli ───────────────────────────────────────────────────────

function driveEFalliHtml(d, L, lato) {
    const S = d.side[lato];
    const tot = Object.values(S.driveRes || {}).reduce((s, x) => s + x, 0);
    const totL = Object.values(L.driveRes || {}).reduce((s, x) => s + x, 0);
    const drive = Object.entries(S.driveRes || {}).sort((a, b) => b[1] - a[1]).map(([k, n]) => `<tr><th scope="row">${esc(k)}</th><td class="tx-bar-cell"><span class="tx-bar"><span class="tx-bar-fill" style="width:${(100 * n / tot).toFixed(1)}%"></span>${L.driveRes?.[k] ? `<span class="tx-bar-lg" style="left:${(100 * L.driveRes[k] / totL).toFixed(1)}%"></span>` : ''}</span></td><td class="tx-num">${pct(n / tot)}</td><td class="tx-num">${n}</td></tr>`).join('');
    const pen = Object.entries(S.pen || {}).sort((a, b) => b[1][0] - a[1][0]).map(([k, a]) => `<tr><th scope="row">${esc(k)}</th><td class="tx-num">${a[0]}</td><td class="tx-num">${a[1]}</td><td class="tx-num">${(a[0] / (d.games || 1)).toFixed(2)}</td></tr>`).join('');
    return `<section class="tx-block"><h2 class="tx-h2">Drives & penalties</h2><div class="tx-dims">
        <article class="tx-dim"><header><h3>How drives ended</h3><span class="tx-tag">Play-by-play</span></header>
            <div class="tx-table-wrap"><table class="tx-table"><thead><tr><th></th><th>Share</th><th class="tx-num">%</th><th class="tx-num">Drives</th></tr></thead><tbody>${drive}</tbody></table></div></article>
        <article class="tx-dim"><header><h3>Penalties ${lato === 'off' ? 'committed by the offense' : 'committed by the defense'}</h3><span class="tx-tag">Play-by-play</span></header>
            <div class="tx-table-wrap tx-scroll-y"><table class="tx-table"><thead><tr><th>Type</th><th class="tx-num">Count</th><th class="tx-num">Yards</th><th class="tx-num">Per game</th></tr></thead><tbody>${pen || '<tr><td colspan="4">None</td></tr>'}</tbody></table></div></article>
    </div></section>`;
}

// ─── chi esegue ──────────────────────────────────────────────────────────

const TABELLE = [
    ['snaps', 'Snap counts', 'Snap counts'],
    ['ngs_passing', 'Next Gen Stats · passing', 'Next Gen Stats'],
    ['ngs_rushing', 'Next Gen Stats · rushing', 'Next Gen Stats'],
    ['ngs_receiving', 'Next Gen Stats · receiving', 'Next Gen Stats'],
    ['pfr_pass', 'PFR advanced · passing', 'PFR advanced'],
    ['pfr_rush', 'PFR advanced · rushing', 'PFR advanced'],
    ['pfr_rec', 'PFR advanced · receiving', 'PFR advanced'],
    ['pfr_def', 'PFR advanced · defense', 'PFR advanced'],
];
/** Intestazioni leggibili per le colonne grezze (tutte, nessuna tolta). */
const COL = {
    player: 'Player', player_display_name: 'Player', pos: 'Pos', position: 'Pos', player_position: 'Pos', player_jersey_number: '#',
    g: 'G', gs: 'GS', age: 'Age', att: 'Att', yds: 'Yds', td: 'TD', x1d: '1st downs', ybc: 'Yds before contact', ybc_att: 'YBC/att', yac: 'Yds after contact/catch',
    yac_att: 'YAC/att', brk_tkl: 'Broken tackles', att_br: 'Att per broken tackle', tgt: 'Targets', rec: 'Rec', ybc_r: 'YBC/rec', yac_r: 'YAC/rec', adot: 'aDOT',
    rec_br: 'Rec per broken tackle', drop: 'Drops', drop_percent: 'Drop %', int: 'INT', rat: 'Rating when targeted', cmp: 'Completions allowed', cmp_percent: 'Cmp % allowed',
    yds_cmp: 'Yds/cmp allowed', yds_tgt: 'Yds/target allowed', dadot: 'aDOT allowed', air: 'Air yds allowed', bltz: 'Blitzes', hrry: 'Hurries', qbkd: 'QB knockdowns',
    sk: 'Sacks', prss: 'Pressures', comb: 'Tackles', m_tkl: 'Missed tackles', m_tkl_percent: 'Missed tackle %', bats: 'Batted passes', multiTeam: 'Traded (season total)',
};
const colLabel = (c) => COL[c] || c.replace(/_/g, ' ').replace(/\bpct\b/, '%').replace(/^\w/, (x) => x.toUpperCase());

function giocatoriHtml(d) {
    const P = d.players || {};
    const blocchi = TABELLE.map(([k, titolo, fonte]) => {
        const t = P[k];
        if (!t?.rows?.length) return '';
        const righe = [...t.rows];
        return `<details class="tx-players"${k === 'snaps' ? '' : ''}>
            <summary><b>${esc(titolo)}</b> <small>${righe.length} players · ${esc(fonte)}</small></summary>
            <div class="tx-table-wrap"><table class="tx-table tx-raw"><thead><tr>${t.cols.map(c => `<th>${esc(colLabel(c))}</th>`).join('')}</tr></thead>
            <tbody>${righe.map(r => `<tr>${r.map((v, i) => `<td${i ? ' class="tx-num"' : ''}>${esc(v)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
        </details>`;
    }).join('');
    if (!blocchi) return '';
    return `<section class="tx-block"><h2 class="tx-h2">Who executes it</h2>
        <p class="tx-sidenote">Every column the sources publish for this team's players, season totals. Players traded during the season show their numbers for this team; when PFR only has one total across teams, that row appears under each team they played for, marked.</p>
        ${blocchi}</section>`;
}
