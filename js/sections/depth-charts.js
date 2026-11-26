/**
 * Depth Charts (#depth, sotto Players) — le 32 squadre NFL in una griglia:
 * per ognuna QB, due RB, tre WR e il TE titolari del depth chart, con la quota
 * di palloni che ricevono, chi e' infortunato e chi ne prende il posto.
 * Cliccando una card si apre la scheda della squadra: titolari e riserve,
 * come si dividono target e portate partita per partita, la tabella completa
 * dei giocatori (con il tabellino di ogni giornata) e la storia dei titolari.
 *
 * I conti stanno in `js/data/depth-usage.js`. Qui la pagina e le fonti:
 *  - depth chart: `data/nfl/depth/{Y}_{TEAM}.json` (foto pre-kickoff ESPN via
 *    nflverse, giro giornaliero). Esiste dal 2025: per questo la pagina offre
 *    solo le stagioni da li' in poi;
 *  - quote: tabellini Sleeper (`getWeekStats`), SOLO giornate chiuse come in
 *    Trends — una partita a meta' sporcherebbe le ultime tre;
 *  - infortuni: `data/nfl/injuries_{Y}.json` (report ESPN di oggi nel campo
 *    `espn`), solo sulla stagione in corso;
 *  - calendario: Sleeper, per prossima avversaria e bye.
 */

import { SEASONS_DESC, CURRENT_SEASON } from '../data.js?v=597';
import { TEAMS } from './team.js?v=868';
import { pickDropdownHTML, bindPickDropdown } from '../ui/dropdown-pick.js?v=2';
import { getWeekStats } from '../data/projections.js?v=637';
import { fmt, headshotImg, posBadge, hydrateImages } from './analysis.js?v=918';
import { roseDellaLega } from './leaders.js?v=157';
import { finestraStagione } from './player-trends.js?v=13';
import { partite, calendarioPerSquadra } from '../data/player-trends.js?v=7';
import { NFL_TEAMS } from '../data/nfl-teams.js?v=513';
import { TEAM_PALETTE } from '../data/team-config.js?v=538';
import { canonAbbr } from '../data/nfl-schedule.js?v=557';
import { teamLogoUrl, esc } from '../data/player-search-core.js?v=624';
import { costruisciSquadra, indiceInfortuni, quotePerGiornata, SLOT_CARD } from '../data/depth-usage.js?v=1';

const PRIMO_ANNO = 2025;   // prima del 2025 non ci sono le foto del depth chart
const DIVISIONI = ['AFC East', 'AFC North', 'AFC South', 'AFC West', 'NFC East', 'NFC North', 'NFC South', 'NFC West'];

let initialized = false;
let anno = String(CURRENT_SEASON);
let mostra = 'all';        // 'all' | 'inj' (solo squadre con un titolare fuori)
let coloraRose = false;    // righe dei giocatori in una rosa di lega tinte nel colore della squadra
let stato = null;          // { anno, squadre: Map, rose, chiuseFino, prossima, inCorso }

export function initDepthCharts() {
    if (initialized) return;
    initialized = true;
    renderPickRow();
    bindContent();
    load();
}

function anni() {
    return SEASONS_DESC.filter(y => Number(y) >= PRIMO_ANNO);
}

function renderPickRow() {
    const box = document.getElementById('du-pick-row');
    if (!box) return;
    const lista = anni();
    if (!lista.includes(anno)) anno = lista[0];
    box.innerHTML = pickDropdownHTML('year', lista.map(y => ({ value: y, label: y })), lista.indexOf(anno));
    bindPickDropdown(box, (id, value) => {
        if (id !== 'year') return;
        anno = String(value);
        renderPickRow();
        load();
    });
}

/* ============================================================
   DATI
   ============================================================ */

const fetchJson = (url) => fetch(url).then(r => (r.ok ? r.json() : null)).catch(() => null);

async function load() {
    const wrap = document.getElementById('depth-content');
    if (!wrap) return;
    wrap.innerHTML = `<div class="loading-state"><div class="spinner"></div><p>Loading depth charts...</p></div>`;
    const y = anno;
    const inCorso = y === String(CURRENT_SEASON);
    const { fino, prossima } = await finestraStagione(y);
    const sett = Array.from({ length: fino }, (_, i) => i + 1);
    const sigle = Object.keys(NFL_TEAMS);
    const [mappe, schedule, rose, injJson, depth] = await Promise.all([
        Promise.all(sett.map(w => getWeekStats(y, w))),
        fetchJson(`https://api.sleeper.com/schedule/nfl/regular/${y}`),
        roseDellaLega(y).catch(() => () => null),
        inCorso ? fetchJson(`data/nfl/injuries_${y}.json?v=${Math.floor(Date.now() / 36e5)}`) : null,
        Promise.all(sigle.map(t => fetchJson(`data/nfl/depth/${y}_${t}.json?v=${Math.floor(Date.now() / 36e5)}`))),
    ]);
    if (anno !== y) return;   // l'utente ha gia' cambiato anno

    // Sleeper e i file nflverse usano quasi sempre le stesse sigle; dove no
    // (LA/LAR, WSH/WAS) si porta tutto alla forma canonica di nfl-teams.js.
    const settimane = sett.map((w, i) => [w, mappe[i]]).filter(([, m]) => m.size)
        .map(([w, m]) => [w, new Map([...m].map(([k, v]) => [k, { ...v, team: canonAbbr(v.team), opp: v.opp ? canonAbbr(v.opp) : v.opp }]))]);
    const giocatori = partite(settimane);
    const calendario = new Map([...calendarioPerSquadra((schedule || []).map(g => ({
        ...g, home: canonAbbr(g.home), away: canonAbbr(g.away),
    })))]);
    const infortuni = indiceInfortuni(injJson, inCorso);

    const squadre = new Map();
    sigle.forEach((t, i) => {
        squadre.set(t, costruisciSquadra({
            team: t, depthJson: depth[i], giocatori,
            infortuni: infortuni.get(t) || new Map(), cal: calendario.get(t) || null,
        }));
    });
    stato = { anno: y, squadre, rose, inCorso, prossima, chiuseFino: settimane.at(-1)?.[0] || 0 };
    render();
}

/* ============================================================
   FORMATI
   ============================================================ */

const pct = (v) => (v == null ? '—' : `${fmt(v * 100, 0)}%`);
const corto = (nome) => {
    const p = String(nome || '').trim().split(/\s+/);
    return p.length < 2 ? (nome || '—') : `${p[0][0]}. ${p.slice(1).join(' ')}`;
};
const cognome = (nome) => {
    const p = String(nome || '').trim().split(/\s+/).filter(x => !/^(jr\.?|sr\.?|ii|iii|iv|v)$/i.test(x));
    return p.length ? p.at(-1) : '';
};
const data = (iso) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

const NOMI_STATO = { IR: 'Injured reserve', OUT: 'Out', D: 'Doubtful', Q: 'Questionable', SUS: 'Suspended', PUP: 'PUP list' };

function chipStato(inf) {
    if (!inf) return '';
    const t = `${NOMI_STATO[inf.sigla] || inf.sigla}${inf.cosa ? ` — ${inf.cosa}` : ''}${inf.rientro ? ` · est. return ${data(inf.rientro)}` : ''}`;
    return `<span class="du-inj du-inj--${inf.sigla.toLowerCase()}" title="${esc(t)}">${inf.sigla}</span>`;
}

/**
 * La squadra di lega che ha il giocatore in rosa, come attributi della riga:
 * classe + `--own` nel colore `bright` della palette (bordeaux e petrolio,
 * i colori `identity` di Oscurus e Sommo, su fondo nero sparirebbero).
 * La tinta si accende solo con l'interruttore (`.du-show-own` sul
 * contenitore): cosi' accenderlo e spegnerlo non ridisegna niente.
 */
function attrRosa(nome) {
    const k = stato.rose(nome)?.finale;
    const c = k ? TEAM_PALETTE[k]?.bright : null;
    return c ? { cls: ' du-owned', style: ` style="--own:${c}"` } : { cls: '', style: '' };
}

/** Il pallino della squadra di lega che ha il giocatore in rosa. */
function pallinoRosa(nome) {
    const info = stato.rose(nome);
    const sq = info?.finale ? TEAMS[info.finale] : null;
    return sq ? `<i class="du-own" style="--c:${sq.color}" title="On ${esc(sq.name)}'s roster"></i>` : '';
}

function badgeRosa(nome) {
    const info = stato.rose(nome);
    const sq = info?.finale ? TEAMS[info.finale] : null;
    return sq ? ` <span class="an-badge ld-team-badge" style="--team-color:${sq.color}">${esc(sq.name)}</span>` : '';
}

/** Freccia del trend: quota delle ultime 3 contro quella di stagione. */
function freccia(s, campo) {
    const a = s?.[campo], b = s?.recent?.[campo];
    if (a == null || b == null) return '<span class="du-tr"></span>';
    const d = b - a;
    const t = `Last ${s.recent.g} games ${pct(b)} vs ${pct(a)} on the season`;
    if (d >= 0.05) return `<span class="du-tr du-tr--up" title="${t}">▲</span>`;
    if (d <= -0.05) return `<span class="du-tr du-tr--down" title="${t}">▼</span>`;
    return `<span class="du-tr" title="${t}"></span>`;
}

/**
 * Il numero di uno slot nella card: la quota che conta per il ruolo.
 * QB → lanci a partita; RB → quota portate (con i target accanto);
 * WR/TE → quota target. La barra si riempie al 35% dei target e al 75% delle
 * portate: oltre, sono gia' i primi della lega (la nota lo dice).
 */
function misura(p, pos) {
    const s = p?.stat;
    if (!s) return `<span class="du-bar"></span><span class="du-val du-val--none">—</span><span class="du-tr"></span>`;
    if (pos === 'QB') {
        return `<span class="du-bar du-bar--txt">${fmt(s.passYd / s.g, 0)} yd/g</span>
            <span class="du-val" title="Pass attempts per game">${fmt(s.pa / s.g, 1)}<small> att</small></span><span class="du-tr"></span>`;
    }
    const rb = pos === 'RB';
    const q = rb ? s.carShare : s.tgtShare;
    const pieno = rb ? 0.75 : 0.35;
    const w = Math.min(100, (q || 0) / pieno * 100);
    const titolo = rb ? `Carry share ${pct(s.carShare)} · target share ${pct(s.tgtShare)} (${s.g} G)`
        : `Target share ${pct(s.tgtShare)} · ${fmt(s.tgt / s.g, 1)} targets a game (${s.g} G)`;
    return `<span class="du-bar" title="${titolo}"><i style="width:${w}%"></i></span>
        <span class="du-val" title="${titolo}">${pct(q)}${rb ? `<small> · ${pct(s.tgtShare)} tgt</small>` : ''}</span>
        ${freccia(s, rb ? 'carShare' : 'tgtShare')}`;
}

/* ============================================================
   GRIGLIA
   ============================================================ */

const haFuori = (sq) => sq.titolari.some(t => t.p?.fuori);

function card(team) {
    const sq = stato.squadre.get(team);
    const t = NFL_TEAMS[team];
    const prox = sq.prossima
        ? `W${sq.prossima.w} ${sq.prossima.home ? 'vs' : '@'} ${sq.prossima.opp}`
        : '';
    const righe = sq.titolari.map(({ slot, p, sost }) => {
        if (!p) return `<li class="du-row du-row--empty"><span class="du-slot">${slot.id}</span><span class="du-nm">—</span></li>`;
        const ra = attrRosa(p.nome);
        const riga = `
        <li class="du-row${p.fuori ? ' du-row--out' : ''}${ra.cls}"${ra.style}>
            <span class="du-slot">${slot.id}</span>
            <span class="du-nm" title="${esc(p.nome)}">${esc(corto(p.nome))}${chipStato(p.inf)}${pallinoRosa(p.nome)}</span>
            ${misura(p, slot.pos)}
        </li>`;
        const rs = sost ? attrRosa(sost.nome) : null;
        const sub = sost ? `
        <li class="du-row du-row--sub${rs.cls}"${rs.style} title="Next on the depth chart while ${esc(p.nome)} is out">
            <span class="du-slot">↳</span>
            <span class="du-nm">${esc(corto(sost.nome))}${chipStato(sost.inf)}${pallinoRosa(sost.nome)}</span>
            ${misura(sost, slot.pos)}
        </li>` : '';
        return riga + sub;
    }).join('');
    return `
    <article class="du-card" data-du-team="${team}" style="--nfl:${t.color}" tabindex="0" role="button" aria-label="${esc(t.name)} depth chart and usage">
        <header class="du-head">
            <img class="du-logo" src="${teamLogoUrl(team)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">
            <span class="du-team"><b>${team}</b><span>${esc(t.name.split(' ').slice(-1)[0])}</span></span>
            <span class="du-next">${prox}</span>
        </header>
        <ul class="du-rows">${righe}</ul>
    </article>`;
}

function render() {
    const wrap = document.getElementById('depth-content');
    if (!wrap || !stato) return;
    const opzioni = [{ value: 'all', label: 'All teams' }, { value: 'inj', label: 'Injured starters' }];
    const blocchi = DIVISIONI.map(div => {
        const sigle = Object.entries(NFL_TEAMS).filter(([, t]) => t.division === div)
            .sort((a, b) => a[1].name.localeCompare(b[1].name)).map(([s]) => s)
            .filter(s => mostra === 'all' || haFuori(stato.squadre.get(s)));
        if (!sigle.length) return '';
        return `<section class="du-div"><h2 class="du-div-title">${div}</h2><div class="du-grid">${sigle.map(card).join('')}</div></section>`;
    }).join('');
    const dt = [...stato.squadre.values()].map(s => s.oggi?.dt).filter(Boolean).sort().at(-1);
    wrap.classList.toggle('du-show-own', coloraRose);
    wrap.innerHTML = `
    <div class="tr-bar">
        <p class="du-lede">Starters from each team's latest pregame depth chart${dt ? ` (as of ${data(dt)})` : ''}.
           Shares are of the team's targets and carries in the games each player played${stato.chiuseFino ? `, weeks 1–${stato.chiuseFino}` : ''}.
           ${stato.inCorso ? 'Injury tags are today\'s ESPN report; when a starter is out, the next healthy player on the chart is shown under him.' : ''}
           Click a team for the full picture.</p>
        <div class="an-controls tr-controls">
            ${stato.inCorso ? pickDropdownHTML('show', opzioni, mostra === 'inj' ? 1 : 0) : ''}
            <button class="year-pill du-own-btn${coloraRose ? ' is-on' : ''}" type="button" data-du-own aria-pressed="${coloraRose}"
                title="Colour the players on a Topina League roster with their fantasy team's colour">Fantasy rosters</button>
        </div>
        <div class="du-own-legend"${coloraRose ? '' : ' hidden'}>${Object.entries(TEAM_PALETTE).map(([k, p]) =>
            `<span class="du-leg"><i class="du-sw" style="background:${p.bright}"></i>${esc(TEAMS[k]?.name || k)}</span>`).join('')}</div>
    </div>
    ${blocchi || '<p class="an-footnote">No team has a starter out right now.</p>'}
    ${notaMetodo()}`;
    bindPickDropdown(wrap, (id, value) => {
        if (id === 'show') { mostra = value; render(); }
    });
}

function notaMetodo() {
    return `
    <p class="an-footnote">How to read it. RB: carry share, with target share after the dot. WR and TE: target share.
       QB: passing yards and attempts per game. Bars fill at 35% of the team's targets and 75% of its carries — past that a
       player is already among the league's busiest. ▲ ▼: the share over his last 3 games is at least 5 points above or below
       his season share. A coloured dot means the player is on a Topina League roster.
       Shares come from Sleeper box scores and count only the games each player played for that team; fullbacks are missing
       from the team totals, so shares run a touch high — the same for everyone.</p>`;
}

/* ============================================================
   SCHEDA SQUADRA (popup)
   ============================================================ */

// Palette categoriale validata (dataviz, scale dark su fondo nero e light su
// bianco): l'ordine e' fisso e il colore segue il giocatore, non il rango
// della giornata. Il sesto posto e' "Other", grigio.
const SERIE = 5;

let overlay = null;
function apriOverlay() {
    if (!overlay?.isConnected) {
        overlay = document.createElement('div');
        overlay.className = 'pm-overlay du-overlay';
        overlay.hidden = true;
        overlay.innerHTML = `
            <div class="pm-dialog du-dialog" role="dialog" aria-modal="true" aria-label="Team depth chart">
                <button class="pm-close" aria-label="Close">✕</button>
                <div class="du-dlg-content"></div>
            </div>`;
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay || e.target.closest('.pm-close')) { chiudi(); return; }
            onDialogClick(e);
        });
        document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && overlay && !overlay.hidden) chiudi(); });
        document.body.appendChild(overlay);
    }
    overlay.hidden = false;
    overlay.classList.toggle('du-show-own', coloraRose);
    document.body.classList.add('du-lock');
    return overlay.querySelector('.du-dlg-content');
}

function chiudi() {
    if (overlay) overlay.hidden = true;
    document.body.classList.remove('du-lock');
}

function apriSquadra(team) {
    const sq = stato?.squadre.get(team);
    if (!sq) return;
    const box = apriOverlay();
    const t = NFL_TEAMS[team];
    box.closest('.du-dialog').style.setProperty('--nfl', t.color);
    box.closest('.du-dialog').scrollTop = 0;
    box.innerHTML = `
    <header class="du-dlg-head">
        <img class="du-dlg-logo" src="${teamLogoUrl(team)}" alt="" onerror="this.style.visibility='hidden'">
        <div>
            <h2 class="du-dlg-title">${esc(t.name)}</h2>
            <p class="du-dlg-sub">${t.division} · ${stato.anno}${sq.prossima ? ` · next: week ${sq.prossima.w} ${sq.prossima.home ? 'vs' : '@'} ${sq.prossima.opp}` : ''}${sq.bye ? ` · bye week ${sq.bye}` : ''}
               · <a href="#nfl-team/${team}">Team page →</a></p>
        </div>
    </header>
    ${bloccoTitolari(sq)}
    ${bloccoQuote(sq, 'tgt', 'Target share, game by game', 'Who the team threw to each week: each bar is 100% of the team\'s targets.')}
    ${bloccoQuote(sq, 'car', 'Carry share, game by game', 'Who carried the ball each week: each bar is 100% of the team\'s carries.')}
    ${bloccoTabella(sq)}
    ${bloccoStoria(sq)}`;
    hydrateImages(box);
}

function bloccoTitolari(sq) {
    const oggi = sq.oggi ? `Depth chart before the ${data(sq.oggi.dt)} game` : 'No depth chart available';
    const slot = sq.titolari.map(({ slot, p, sost, lista }) => {
        if (!p) return '';
        const s = p.stat;
        const rb = slot.pos === 'RB', qb = slot.pos === 'QB';
        const numeri = !s ? '<span class="du-st-none">No snaps for this team yet</span>' : qb
            ? `${fmt(s.pa / s.g, 1)} att · ${fmt(s.passYd / s.g, 0)} yd · ${s.passTd} TD · ${s.int} INT · ${fmt(s.ppg, 1)} pts/g`
            : `${rb ? `${pct(s.carShare)} carries · ` : ''}${pct(s.tgtShare)} targets · ${pct(s.snapShare)} snaps · ${s.recTd + s.rushTd} TD · ${fmt(s.ppg, 1)} pts/g`;
        const dietro = lista.slice(slot.idx + 1, slot.idx + 4).filter(x => x.espnId !== sost?.espnId)
            .map(x => `<span class="du-behind${x.fuori ? ' is-out' : ''}">${esc(corto(x.nome))}${chipStato(x.inf)}</span>`).join('');
        return `
        <div class="du-st${p.fuori ? ' du-st--out' : ''}${attrRosa(p.nome).cls}"${attrRosa(p.nome).style}>
            <span class="du-st-slot">${slot.id}</span>
            ${headshotImg({ name: p.nome, position: slot.pos, nflTeam: sq.team }, 'an-headshot du-st-img')}
            <div class="du-st-who">
                <span class="du-st-name">${esc(p.nome)} ${chipStato(p.inf)}${badgeRosa(p.nome)}</span>
                <span class="du-st-nums">${numeri}</span>
                ${p.inf?.nota ? `<span class="du-st-note" title="${esc(p.inf.nota)}">${esc(p.inf.nota)}</span>` : ''}
                ${sost ? `<span class="du-st-sub">↳ Next up: <b>${esc(sost.nome)}</b>${chipStato(sost.inf)}${badgeRosa(sost.nome)}
                    ${sost.stat && !qb ? `<small class="du-st-subn">${pct(rb ? sost.stat.carShare : sost.stat.tgtShare)} of the ${rb ? 'carries' : 'targets'} in his games so far</small>` : ''}</span>` : ''}
                ${dietro ? `<span class="du-st-behind"><span class="du-k">Behind him</span>${dietro}</span>` : ''}
            </div>
        </div>`;
    }).join('');
    return `
    <section class="du-blk">
        <h3 class="du-blk-title">Starters <small>${oggi}</small></h3>
        <div class="du-starters">${slot}</div>
    </section>`;
}

/** Barre impilate al 100%: una colonna per giornata, un colore per giocatore. */
function bloccoQuote(sq, campo, titolo, sotto) {
    const { serie, colonne } = quotePerGiornata(sq, campo, SERIE);
    if (!colonne.length || !serie.length) return '';
    const legenda = serie.map((s, i) => `<span class="du-leg"><i class="du-sw du-c${i + 1}"></i>${esc(corto(s.name))} <small>${s.pos}</small></span>`).join('')
        + `<span class="du-leg"><i class="du-sw du-c0"></i>Other</span>`;
    const unita = campo === 'tgt' ? 'targets' : 'carries';
    const col = colonne.map(c => {
        const seg = c.parti.map((p, i) => ({ ...p, cls: `du-c${i + 1}`, name: serie[i].name }))
            .concat([{ key: 'altro', v: c.altro.v, q: c.altro.q, cls: 'du-c0', name: 'Other' }])
            .filter(p => p.q > 0)
            .map(p => `<i class="du-seg ${p.cls}" data-k="${esc(p.key)}" style="flex-grow:${p.q}" title="Week ${c.w}${c.opp ? ` vs ${c.opp}` : ''} · ${esc(p.name)}: ${p.v} of ${c.den} ${unita} (${pct(p.q)})"></i>`).join('');
        return `<div class="du-col"><div class="du-stack">${seg}</div><span class="du-col-w">W${c.w}</span><span class="du-col-o">${c.opp || ''}</span></div>`;
    }).join('');
    return `
    <section class="du-blk">
        <h3 class="du-blk-title">${titolo}</h3>
        <p class="du-blk-sub">${sotto} Hover a block for the numbers; the table below has them all.</p>
        <div class="du-legend">${legenda}</div>
        <div class="du-chart" style="--cols:${colonne.length}">${col}</div>
    </section>`;
}

function bloccoTabella(sq) {
    if (!sq.roster.length) return '';
    const righe = sq.roster.map((v, i) => {
        const s = v.stat;
        return `
        <tr class="du-tr-row${attrRosa(v.name).cls}"${attrRosa(v.name).style} data-du-row="${i}" tabindex="0">
            <th scope="row"><span class="du-tb-name">${posBadge(v.pos)} ${esc(v.name)}${chipStato(v.inf)}${v.partito ? ' <small class="du-gone" title="Now with another team">left</small>' : ''}</span></th>
            <td>${s.g}</td><td>${pct(s.snapShare)}</td>
            <td>${s.tgt || '—'}</td><td><b>${s.tgt ? pct(s.tgtShare) : '—'}</b>${s.tgt ? freccia(s, 'tgtShare') : ''}</td>
            <td>${s.rec || '—'}</td><td>${s.recYd || '—'}</td>
            <td>${s.car || '—'}</td><td><b>${s.car ? pct(s.carShare) : '—'}</b>${s.car ? freccia(s, 'carShare') : ''}</td>
            <td>${s.rushYd || '—'}</td>
            <td>${s.pa ? `${s.passYd}` : '—'}</td>
            <td>${s.recTd + s.rushTd + s.passTd || '—'}</td>
            <td>${s.rz || '—'}</td>
            <td>${fmt(s.ppg, 1)}</td>
            <td class="du-chev">›</td>
        </tr>
        <tr class="du-log" data-du-log="${i}" hidden><td colspan="15"></td></tr>`;
    }).join('');
    stato.rosterAperto = sq.roster;
    stato.squadraAperta = sq;
    return `
    <section class="du-blk">
        <h3 class="du-blk-title">Every player who touched the ball</h3>
        <p class="du-blk-sub">Season totals with this team. Click a player for his game-by-game log.</p>
        <div class="du-tbl-wrap">
        <table class="du-tbl">
            <thead><tr><th>Player</th><th>G</th><th>Snap%</th><th>Tgt</th><th>Tgt%</th><th>Rec</th><th>Rec yd</th>
                <th>Car</th><th>Car%</th><th>Rush yd</th><th>Pass yd</th><th>TD</th><th title="Red-zone targets + carries">RZ</th><th>Pts/G</th><th></th></tr></thead>
            <tbody>${righe}</tbody>
        </table>
        </div>
    </section>`;
}

/** Il tabellino partita per partita di un giocatore, con le quote a barre. */
function logGiocatore(v, sq) {
    const s = v.stat;
    const qb = v.pos === 'QB', rb = v.pos === 'RB';
    const barra = (q, max) => q == null ? '' : `<span class="du-mini"><i style="width:${Math.min(100, q / max * 100)}%"></i></span>`;
    const righe = s.perGiornata.map(g => g.assente
        ? `<tr class="is-off"><td>W${g.w}</td><td>${g.opp || ''}</td><td colspan="7">Did not play</td></tr>`
        : `<tr>
            <td>W${g.w}</td><td>${g.opp || ''}</td>
            <td>${pct(g.snapShare)}</td>
            <td>${g.tgt}${g.tgt ? ` <small>${pct(g.tgtShare)}</small>` : ''}${barra(g.tgtShare, 0.4)}</td>
            <td>${g.car}${g.car ? ` <small>${pct(g.carShare)}</small>` : ''}${rb || qb ? barra(g.carShare, 0.8) : ''}</td>
            <td>${qb ? `${g.passYd} yd · ${g.passTd} TD${g.int ? ` · ${g.int} INT` : ''}` : `${g.rec}-${g.recYd}`}</td>
            <td>${g.rushYd}</td>
            <td>${(g.recTd + g.rushTd + (qb ? g.passTd : 0)) || ''}</td>
            <td><b>${fmt(g.pts, 1)}</b></td>
        </tr>`).join('');
    const link = `#player/${stato.anno}/${encodeURIComponent(v.pos)}/${encodeURIComponent(v.name)}`;
    const rec = s.recent;
    const frase = rec ? `<p class="du-log-sum">Last ${rec.g} games: ${!qb ? `${pct(rec.tgtShare)} target share (season ${pct(s.tgtShare)})` : ''}${rb || qb ? `${!qb ? ', ' : ''}${pct(rec.carShare)} carry share (season ${pct(s.carShare)})` : ''}${!qb ? `, ${pct(rec.snapShare)} of snaps (season ${pct(s.snapShare)})` : ''}, ${fmt(rec.ppg, 1)} pts a game (season ${fmt(s.ppg, 1)}).</p>` : '';
    return `
    <div class="du-log-box">
        ${frase}
        <table class="du-log-tbl">
            <thead><tr><th>Week</th><th>Opp</th><th>Snap%</th><th>Tgt</th><th>Car</th><th>${qb ? 'Passing' : 'Rec-Yd'}</th><th>Rush yd</th><th>TD</th><th>Pts</th></tr></thead>
            <tbody>${righe}</tbody>
        </table>
        <a class="du-log-link" href="${link}">Full player page →</a>
    </div>`;
}

/** Chi e' partito titolare in ogni giornata, slot per slot: i cambi si accendono. */
function bloccoStoria(sq) {
    if (sq.storia.length < 2) return '';
    const testa = sq.storia.map(f => `<th title="Depth chart of ${data(f.dt)}">${f.w ? `W${f.w}` : data(f.dt)}</th>`).join('');
    const righe = SLOT_CARD.map(s => {
        let prima = null;
        const celle = sq.storia.map(f => {
            const nome = f.slot[s.id];
            const cambio = prima !== null && nome !== prima;
            prima = nome;
            return `<td class="${cambio ? 'is-new' : ''}" title="${esc(nome || '—')}">${esc(cognome(nome)) || '—'}</td>`;
        }).join('');
        return `<tr><th scope="row">${s.id}</th>${celle}</tr>`;
    }).join('');
    return `
    <section class="du-blk">
        <h3 class="du-blk-title">Starters, week by week</h3>
        <p class="du-blk-sub">The depth chart before each game. Highlighted: a new name in that spot.</p>
        <div class="du-tbl-wrap"><table class="du-hist">${'<thead><tr><th></th>' + testa + '</tr></thead>'}<tbody>${righe}</tbody></table></div>
    </section>`;
}

function onDialogClick(e) {
    if (e.target.closest('a')) { if (!e.target.closest('a').hash?.startsWith('#depth')) chiudi(); return; }
    const row = e.target.closest('[data-du-row]');
    if (row) apriLog(row);
}

function apriLog(row) {
    const i = Number(row.dataset.duRow);
    const v = stato?.rosterAperto?.[i];
    const box = overlay?.querySelector(`[data-du-log="${i}"]`);
    if (!v || !box) return;
    const aperto = row.classList.toggle('expanded');
    box.hidden = !aperto;
    if (aperto && !box.dataset.loaded) {
        box.dataset.loaded = '1';
        box.firstElementChild.innerHTML = logGiocatore(v, stato.squadraAperta);
    }
}

/* ============================================================
   EVENTI
   ============================================================ */

/** Accende/spegne la tinta delle rose: griglia e popup, senza ridisegnare. */
function impostaRose(on) {
    coloraRose = on;
    const wrap = document.getElementById('depth-content');
    wrap?.classList.toggle('du-show-own', on);
    const btn = wrap?.querySelector('[data-du-own]');
    btn?.classList.toggle('is-on', on);
    btn?.setAttribute('aria-pressed', String(on));
    const leg = wrap?.querySelector('.du-own-legend');
    if (leg) leg.hidden = !on;
    overlay?.classList.toggle('du-show-own', on);
}

function bindContent() {
    const wrap = document.getElementById('depth-content');
    if (!wrap) return;
    wrap.addEventListener('click', (e) => {
        const own = e.target.closest('[data-du-own]');
        if (own) { impostaRose(!coloraRose); return; }
        const c = e.target.closest('[data-du-team]');
        if (c) apriSquadra(c.dataset.duTeam);
    });
    wrap.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        const c = e.target.closest('[data-du-team]');
        if (c) { e.preventDefault(); apriSquadra(c.dataset.duTeam); }
    });
    document.addEventListener('keydown', (e) => {
        if ((e.key === 'Enter' || e.key === ' ') && overlay && !overlay.hidden) {
            const row = e.target.closest?.('[data-du-row]');
            if (row) { e.preventDefault(); apriLog(row); }
        }
    });
    // cambiando sezione col popup aperto, il popup si chiude
    window.addEventListener('hashchange', chiudi);
}
