/**
 * Pre-Draft — la vista. Il calcolo sta tutto in js/data/predraft.js.
 *
 * NON è una route: è la terza vista di `#projections`, montata dentro
 * `#pj-content` da sections/projections.js — stesso rapporto che c'è fra
 * draftgrades.js e draftgrade-team.js, con la differenza che qui non cambia
 * nemmeno l'hash. Per questo il file non esporta `initPreDraft` ma
 * `renderPreDraft(host, opts)`: chi comanda lo stato (anno, listone) resta la
 * sezione, questo file disegna e basta.
 *
 * ── Come sono ordinate le card ────────────────────────────────────────
 * Dalla domanda più larga alla più stretta, che è anche l'ordine in cui uno
 * prepara un draft: che anno è (outlook) → chi c'è (board) → come sono
 * raggruppati (tier) → quali ruoli scottano (scarsità) → chi costa poco e chi
 * troppo (valore) → chi può esplodere e chi può fare male (segnali) → cosa
 * faccio io al mio turno (piano per giro) → e infine il confronto diretto.
 *
 * ── Una regola che vale per tutta la pagina ───────────────────────────
 * Ogni numero deve poter dire da dove viene. Quando la fonte non è ovvia lo
 * dice l'etichetta o la nota della card, e i dati che NON esistono si vedono
 * come "N/A" invece di essere stimati. L'elenco completo è nella card
 * metodologica in fondo, che non è un dettaglio burocratico: è la card che
 * rende contestabili tutte le altre.
 */

import { buildPreDraft, buildRoundPlan, hydrateContext } from '../data/predraft.js?v=62';
import { POSITION_COLORS, TAIL_COLORS, lastName, ordinal, ROUND_MAX } from '../data/draft-strategy.js?v=47';
import { scatter, dumbbell } from '../ui/charts.js?v=7';

const POS_COLOR = { ...POSITION_COLORS, ...TAIL_COLORS };
const OFF = ['QB', 'RB', 'WR', 'TE'];
const RISK_ORDER = ['SAFE', 'MODERATE', 'VOLATILE', 'HIGH RISK'];
const PAGE = 60;

/* ── stato della vista, non della sezione ── */
let ctx = null;
let loadedYear = null;
let slot = 1;
let sortBy = 'vor';
let valueAxis = 'vor';
let limit = PAGE;
let compare = [];
const filters = { pos: 'ALL', tier: 'ALL', round: 'ALL', risk: 'ALL', value: 'ALL', flag: 'ALL' };

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const n0 = (v) => (v == null ? '—' : Math.round(v).toLocaleString('en-US'));
const sign = (v) => (v == null ? '—' : `${v > 0 ? '+' : ''}${Math.round(v)}`);
const posBadge = (p) => `<span class="allpro-pos pos-${String(p).toLowerCase()}">${esc(p)}</span>`;

/* ═════════════════════════════ entry point ═════════════════════════════ */

export async function renderPreDraft(host, { byPos, year }) {
    if (!host) return;
    if (!byPos) {
        host.innerHTML = empty(`No projections for ${esc(year)}.`);
        return;
    }
    // ricostruire tutto a ogni cambio di tab costerebbe qualche centinaio di
    // millisecondi per niente: il listone di un anno non cambia sotto i piedi
    if (loadedYear !== String(year) || !ctx) {
        host.innerHTML = `<div class="loading-state"><div class="spinner"></div><p>Building the ${esc(year)} pre-draft board…</p></div>`;
        const built = await buildPreDraft(byPos, year).catch((e) => {
            console.warn('[predraft] build fallita:', e?.message || e);
            return null;
        });
        if (!built) {
            host.innerHTML = empty(`Not enough projected players for ${esc(year)} to run a pre-draft analysis.`);
            return;
        }
        ctx = built;
        loadedYear = String(year);
        // lo stato di navigazione appartiene al board di QUELL'anno: un filtro
        // "tier 4" o un giocatore in confronto non hanno senso su un altro anno
        compare = [];
        limit = PAGE;
        for (const k of Object.keys(filters)) filters[k] = 'ALL';
    }

    paint(host);

    // seconda fase: SOS+, calendario e probabilità di flop. Arriva dopo perché
    // tira giù un file da 7,8 MB — vedi hydrateContext.
    if (!ctx.contextReady) {
        const want = loadedYear;
        hydrateContext(ctx, year)
            .then(() => {
                if (loadedYear !== want || !document.getElementById('pd-signals')) return;
                repaintSignals();
            })
            .catch(() => { /* la pagina resta quella della fase 1 */ });
    }
}

/** Chiamata dalla sezione quando si cambia anno o si esce dal tab. */
export function resetPreDraft() {
    ctx = null;
    loadedYear = null;
    compare = [];
    limit = PAGE;
}

const empty = (msg) => `<div class="empty-state"><p class="empty-state-text">${msg}</p></div>`;

function paint(host) {
    host.innerHTML = [
        subnav(),
        outlookCard(),
        boardCard(),
        tierCard(),
        scarcityCard(),
        valueCard(),
        rangeCard(),
        signalsCard(),
        strategyCard(),
        roundsCard(),
        compareCard(),
        methodCard(),
    ].join('');
    bindAll(host);
}

/* ════════════════════════════ 0 · sotto-nav ════════════════════════════ */

const SECTIONS = [
    ['pd-outlook', 'Outlook'], ['pd-board', 'Board'], ['pd-tiers', 'Tiers'],
    ['pd-scarcity', 'Scarcity'], ['pd-value', 'Value'], ['pd-range', 'Range'],
    ['pd-signals', 'Signals'], ['pd-rounds', 'Rounds'], ['pd-compare', 'Compare'],
];

function subnav() {
    return `<nav class="db-sort pd-subnav" id="pd-subnav" aria-label="Jump to section">
        ${SECTIONS.map(([id, label]) =>
        `<button class="db-sort-btn" data-goto="${id}">${label}</button>`).join('')}
    </nav>`;
}

/* ══════════════════════════ 1 · Draft Outlook ═════════════════════════ */

function outlookCard() {
    const m = ctx.meta;
    const age = m.projAgeMs == null ? null
        : m.projAgeMs < 3.6e6 ? 'less than an hour ago'
            : m.projAgeMs < 8.64e7 ? `${Math.round(m.projAgeMs / 3.6e6)}h ago`
                : `${Math.round(m.projAgeMs / 8.64e7)}d ago`;

    const tiles = [
        ['Season', m.year, 'projections and ADP'],
        ['Scoring', m.scoring, `reception = ${m.ppr} pt · FLEX ${m.flex}`],
        ['Teams', `${m.teams}`, `${m.rounds} rounds · ${m.teams * m.rounds} picks total`],
        ['Roster', `${m.starters} + ${m.bench}`, `${m.slots.join(' · ')} + ${m.bench} bench + ${m.reserve} IR`],
    ].map(([l, v, note]) => `
        <div class="dgt-metric">
            <span class="dgt-metric-label">${l}</span>
            <span class="dgt-metric-val">${esc(v)}</span>
            <span class="dgt-metric-note">${esc(note)}</span>
        </div>`).join('');

    const gaps = [];
    if (!m.hasAdpDispersion) gaps.push(`no ADP dispersion is published for ${m.year}, so "still available at your pick" uses the model's floor for spread and reads coarser than usual`);
    if (!m.hasRosterChange) gaps.push(`the ${m.priorYear} roster diff is unavailable, so vacated volume and team changes are switched off`);
    if (!m.hasByes) gaps.push('bye weeks are unavailable for this season');

    return `
    <section class="mosaic-card mc-wide db-card mc-in dgt-card" id="pd-outlook">
        <span class="mc-kicker">${m.year} pre-draft · this league's rules, not a generic one</span>
        <h2 class="mc-title">Draft outlook</h2>
        <p class="dgt-card-sub">Everything below is computed for <b>this</b> league — ${m.scoring}, ${m.teams} teams,
            ${m.rounds} rounds — from the same projections the Board tab shows and the Draft Grades are built on.
            ${age ? `Projections last refreshed <b>${age}</b>.` : ''}</p>
        <div class="dgt-metrics">${tiles}</div>
        <div class="pd-slot-row">
            <span class="pd-slot-label">Your slot in the snake</span>
            <div class="db-sort pj-slot-pills" id="pd-slot-pills" role="group" aria-label="Draft slot">
                ${Array.from({ length: m.teams }, (_, i) => i + 1).map(s =>
        `<button class="db-sort-btn${s === slot ? ' active' : ''}" data-slot="${s}">${ordinal(s)}</button>`).join('')}
            </div>
        </div>
        <div class="pd-snake-grid" id="pd-snake-grid">${snakeGridHtml()}</div>
        <ul class="pd-outlook">
            ${ctx.outlook.map(o => `<li class="pd-outlook-item pd-outlook--${o.tone}">${esc(o.text)}</li>`).join('')
        || '<li class="pd-outlook-item">Not enough ADP coverage this season to read the shape of the board.</li>'}
        </ul>
        ${gaps.length ? `<p class="db-foot pd-gap">Missing data, stated rather than filled in: ${gaps.join('; ')}.</p>` : ''}
    </section>`;
}

const pickAt = (round) => {
    const base = (round - 1) * ctx.meta.teams;
    return round % 2 ? base + slot : base + (ctx.meta.teams + 1 - slot);
};

/** Numero di pick assoluto per (giro, colonna=slot): stessa formula di pickAt,
 *  ma per uno slot qualsiasi — serve a disegnare la griglia intera invece del
 *  solo slot scelto. */
const pickAtSlot = (round, col) => {
    const base = (round - 1) * ctx.meta.teams;
    return round % 2 ? base + col : base + (ctx.meta.teams + 1 - col);
};

/** Griglia snake dei primi 4 giri: colonne = slot (fisse, come sul serpentone
 *  vero), righe = giro. I numeri scorrono da sinistra a destra e poi
 *  "serpeggiano" al giro pari — la colonna dello slot scelto resta identica
 *  a ogni giro, quindi evidenziarla mostra a colpo d'occhio le tue 4 pick. */
function snakeGridHtml() {
    const teams = ctx.meta.teams;
    const rounds = Math.min(4, ctx.meta.rounds);
    const head = Array.from({ length: teams }, (_, i) => i + 1)
        .map(s => `<span class="pd-snake-head${s === slot ? ' is-mine' : ''}">${ordinal(s)}</span>`).join('');
    const rows = Array.from({ length: rounds }, (_, i) => i + 1).map(r => {
        const cells = Array.from({ length: teams }, (_, i) => i + 1).map(col => `
            <span class="pd-snake-cell${col === slot ? ' is-mine' : ''}">${pickAtSlot(r, col)}</span>`).join('');
        return `<span class="pd-snake-rlabel">R${r}</span>${cells}`;
    }).join('');
    return `
        <div class="pd-snake-inner" style="--pd-snake-cols:${teams}">
            <span class="pd-snake-rlabel" aria-hidden="true"></span>${head}
            ${rows}
        </div>`;
}

/* ═════════════════════════════ 2 · Big Board ═══════════════════════════ */

const SORTS = [
    ['vor', 'Value'], ['proj', 'Projected'], ['adp', 'ADP'],
    ['vaa', 'vs ADP'], ['ceiling', 'Ceiling'], ['floor', 'Floor'],
];

function visibleRows() {
    let rows = ctx.board.filter(r => r.adp != null || r.vor > 0);
    const f = filters;
    if (f.pos !== 'ALL') rows = rows.filter(r => r.pos === f.pos);
    if (f.tier !== 'ALL') rows = rows.filter(r => String(r.tier) === f.tier);
    if (f.round !== 'ALL') {
        const [lo, hi] = f.round.split('-').map(Number);
        rows = rows.filter(r => r.adpRound != null && r.adpRound >= lo && r.adpRound <= hi);
    }
    if (f.risk !== 'ALL') rows = rows.filter(r => r.riskProfile === f.risk);
    if (f.value !== 'ALL') rows = rows.filter(r => r.valueBand === f.value);
    if (f.flag === 'breakout') rows = rows.filter(r => ctx.signals.breakout.includes(r));
    if (f.flag === 'risk') rows = rows.filter(r => ctx.signals.risk.includes(r));
    if (f.flag === 'rookie') rows = rows.filter(r => r.rookie);
    if (f.flag === 'moved') rows = rows.filter(r => r.movedTeam);

    // K e DEF in coda a meno che non sia proprio quello che stai guardando:
    // il loro valore è costruito su una proiezione grossolana (vedi attachValue)
    // e frammisto all'attacco mandava dodici difese in mezzo ai titolari.
    const tail = !['K', 'DEF'].includes(f.pos);
    const k = sortBy;
    return rows.sort((a, b) => {
        if (tail) {
            const ta = OFF.includes(a.pos) ? 0 : 1, tb = OFF.includes(b.pos) ? 0 : 1;
            if (ta !== tb) return ta - tb;
        }
        if (k === 'adp') return (a.adp ?? 9999) - (b.adp ?? 9999);
        const va = a[k], vb = b[k];
        if (va == null && vb == null) return (a.adp ?? 9999) - (b.adp ?? 9999);
        if (va == null) return 1;
        if (vb == null) return -1;
        return vb - va;
    });
}

function boardCard() {
    const tiers = [...new Set(ctx.board.map(r => r.tier).filter(t => t != null))].sort((a, b) => a - b);
    const chip = (group, value, label) =>
        `<button class="pd-chip${filters[group] === value ? ' active' : ''}" data-filter="${group}" data-value="${value}">${label}</button>`;

    return `
    <section class="mosaic-card mc-wide db-card mc-in dgt-card" id="pd-board">
        <div class="db-head">
            <div>
                <span class="mc-kicker">Big board · every player this league would realistically draft</span>
                <h2 class="mc-title">The board</h2>
            </div>
            <div class="db-sort" id="pd-sort" role="group" aria-label="Sort board by">
                ${SORTS.map(([k, l]) => `<button class="db-sort-btn${sortBy === k ? ' active' : ''}" data-sort="${k}">${l}</button>`).join('')}
            </div>
        </div>
        <p class="dgt-card-sub">Sorted by <b>value over replacement</b> by default — points above the last player this
            league would actually start at that position, the same baseline the Draft Grades use. <b>vs ADP</b> is what
            you gain or lose against what that pick usually returns. The bar is the range between floor and ceiling,
            with the projection marked inside it. <b>Kickers and defences sit at the end</b> and carry no price
            comparison: Sleeper does not project them finely enough for this league's scoring, and ranking them
            against real starters would quietly tell you to draft a defence early. Click a row for the player's card,
            <b>+</b> to compare.</p>

        <div class="pd-filters" id="pd-filters">
            <div class="pd-filter-group">${['ALL', ...OFF, 'K', 'DEF'].map(p => chip('pos', p, p === 'ALL' ? 'All' : p)).join('')}</div>
            <div class="pd-filter-group">${['ALL', 'value', 'fair', 'over'].map(v =>
        chip('value', v, v === 'ALL' ? 'Any price' : v === 'value' ? 'Value' : v === 'fair' ? 'Fair' : 'Overpriced')).join('')}</div>
            <div class="pd-filter-group">${['ALL', ...RISK_ORDER].map(v =>
            chip('risk', v, v === 'ALL' ? 'Any risk' : v[0] + v.slice(1).toLowerCase())).join('')}</div>
            <div class="pd-filter-group">${['ALL', '1-3', '4-7', '8-11', '12-16'].map(v =>
                chip('round', v, v === 'ALL' ? 'Any round' : `R${v}`)).join('')}</div>
            <div class="pd-filter-group">${['ALL', ...tiers.map(String)].map(v =>
                    chip('tier', v, v === 'ALL' ? 'Any tier' : `T${v}`)).join('')}</div>
            <div class="pd-filter-group">${['ALL', 'breakout', 'risk', 'rookie', 'moved'].map(v =>
                        chip('flag', v, v === 'ALL' ? 'Everyone' : v === 'moved' ? 'New team' : v[0].toUpperCase() + v.slice(1))).join('')}</div>
        </div>

        <div id="pd-board-body">${boardBody()}</div>
    </section>`;
}

function boardBody() {
    const rows = visibleRows();
    if (!rows.length) return empty('No player matches these filters.');
    const shown = rows.slice(0, limit);
    // scala della barra: comune a tutta la tabella, altrimenti due righe con la
    // stessa larghezza direbbero numeri diversi
    const hi = Math.max(...ctx.board.map(r => r.ceiling ?? r.proj), 1);

    return `
    <div class="db-colhead pd-colhead">
        <span>#</span><span>Player</span><span>Pos</span><span>Tier</span>
        <span class="db-colhead-num">ADP</span><span class="db-colhead-num">Proj</span>
        <span class="db-colhead-bar">Floor · projection · ceiling</span>
        <span class="db-colhead-num">vs ADP</span><span>Risk</span>
    </div>
    <div class="db-rows pd-rows">${shown.map((r, i) => boardRow(r, i, hi)).join('')}</div>
    <div class="pd-more-row">
        <p class="db-foot">Showing ${shown.length} of ${rows.length} players${rows.length !== ctx.board.length ? ` (${ctx.board.length} on the full board)` : ''}.
            ${ctx.contextReady ? '' : '<em>Schedule, flop probability and context scores are still loading.</em>'}</p>
        ${rows.length > shown.length ? '<button class="btn btn-outline pd-more" id="pd-more">Show more</button>' : ''}
    </div>`;
}

function boardRow(r, i, hi) {
    const color = POS_COLOR[r.pos] || 'var(--accent-blue)';
    const band = r.valueBand;
    const dot = band ? `<i class="pd-dot pd-dot--${band}" title="${band === 'value' ? 'Value at this price' : band === 'over' ? 'Costs more than the projection supports' : 'Priced about right'}"></i>` : '';
    const flags = [
        r.tier === 1 && r.posRank <= 3 ? '<em class="db-tag pd-tag--elite">elite</em>' : '',
        ctx.signals.breakout.includes(r) ? '<em class="db-tag db-tag--up">breakout</em>' : '',
        ctx.signals.risk.includes(r) ? '<em class="db-tag db-tag--down">risk</em>' : '',
    ].filter(Boolean).slice(0, 2).join('');

    // barra floor→ceiling con il tacchino della proiezione: senza game-log
    // dell'anno scorso non c'è banda da disegnare, e si dichiara
    const bar = r.floor == null
        ? `<span class="pd-range-cell pd-range-cell--na" title="No prior-season game log: floor and ceiling cannot be estimated">N/A</span>`
        : `<span class="pd-range-cell" title="Floor ${r.floor} · projection ${r.proj} · ceiling ${r.ceiling}">
             <span class="pd-range-track">
               <span class="pd-range-fill" style="left:${(r.floor / hi * 100).toFixed(1)}%;width:${((r.ceiling - r.floor) / hi * 100).toFixed(1)}%;background:${color}"></span>
               <span class="pd-range-mid" style="left:${(r.proj / hi * 100).toFixed(1)}%"></span>
             </span>
             <small>${r.floor}–${r.ceiling}</small>
           </span>`;

    const sub = [r.team, r.bye ? `bye ${r.bye}` : null, r.exp != null ? `${r.exp === 0 ? 'rookie' : `${r.exp}y exp`}` : null]
        .filter(Boolean).join(' · ');

    return `
    <div class="db-row pd-row${r.pick ? '' : ' db-row--free'}" style="--team-color:${color}"
         data-player-modal data-player-name="${esc(r.name)}" data-pos="${r.pos}"
         data-nfl="${esc(r.team || '')}" data-year="${esc(ctx.year)}">
        <span class="db-rank">${i + 1}<em class="pd-posrank">${r.pos}${r.posRank}</em></span>
        <span class="db-name">${esc(r.name)}${flags}<small>${esc(sub)}</small>
            <button class="pd-cmp${compare.includes(r.key) ? ' active' : ''}" data-cmp="${esc(r.key)}"
                    title="Add to comparison" aria-label="Compare ${esc(r.name)}">${compare.includes(r.key) ? '−' : '+'}</button></span>
        <span class="pd-cell-pos">${posBadge(r.pos)}</span>
        <span class="pd-cell-tier">${r.tier ? `T${r.tier}` : '—'}</span>
        <span class="db-adp pd-cell-adp">${r.adp != null ? Math.round(r.adp) : '—'}<small>${r.draftable ? `R${r.adpRound}` : r.adp != null ? 'late' : ''}</small></span>
        <span class="db-pts">${n0(r.proj)}<small>${r.ppg != null ? `${r.ppg}/g` : ''}</small></span>
        ${bar}
        <span class="pd-cell-vaa ${r.vaa == null ? '' : r.vaa >= 0 ? 'up' : 'down'}">${dot}${r.vaa == null ? '—' : sign(r.vaa)}</span>
        <span class="pd-cell-risk">${r.riskProfile
            ? `<em class="pd-risk pd-risk--${r.riskProfile.toLowerCase().replace(' ', '-')}">${r.riskProfile}</em>`
            : '<em class="pd-risk pd-risk--na">N/A</em>'}</span>
    </div>`;
}

/* ═══════════════════════════ 3 · Tier analysis ═════════════════════════ */

function tierCard() {
    const blocks = ctx.positions.map(p => {
        const rows = p.tiers.map(t => `
            <div class="pd-tier-row${t.material ? ' pd-tier-row--cliff' : ''}">
                <span class="pd-tier-name">Tier ${t.tier}</span>
                <span class="pd-tier-size">${t.size} player${t.size === 1 ? '' : 's'}</span>
                <span class="pd-tier-pts">${t.ptsTo}–${t.ptsFrom} pt</span>
                <span class="pd-tier-adp">${t.adpFirst != null ? `ADP ${t.adpFirst}–${t.adpLast}` : 'no ADP'}</span>
                <span class="pd-tier-spread" title="Gap between the best and the worst inside this tier">±${Math.round(t.spread)}</span>
                <span class="pd-tier-drop${t.material ? ' pd-tier-drop--big' : ''}">${t.dropNext != null ? `−${t.dropNext} to next` : 'last tier'}</span>
                <span class="pd-tier-names">${t.names.slice(0, 5).map(esc).join(', ')}${t.names.length > 5 ? ` +${t.names.length - 5}` : ''}</span>
            </div>`).join('');
        return `
        <div class="pd-tier-block" style="--pos-color:${POS_COLOR[p.pos]}">
            <h3 class="pd-tier-head">${posBadge(p.pos)} <b>${p.tiers.length} tiers</b>
                ${p.cliffRound ? `<em>first real drop around round ${p.cliffRound}</em>` : '<em>no cliff — it fades smoothly</em>'}</h3>
            ${rows}
        </div>`;
    }).join('');

    return `
    <section class="mosaic-card mc-wide db-card mc-in dgt-card" id="pd-tiers">
        <span class="mc-kicker">Tiers · players who are worth the same</span>
        <h2 class="mc-title">Where the groups break</h2>
        <p class="dgt-card-sub">Tiers come from natural breaks in projected value (the same Jenks split the Draft
            Strategy tab draws), not from round numbers. Inside a tier it barely matters which one you get — the
            <b>drop to the next tier</b> is what you actually pay for missing it. A highlighted row means that drop is
            material: at least 12% of what is in play at that position.</p>
        <div class="pd-tier-grid">${blocks}</div>
    </section>`;
}

/* ════════════════════════ 4 · Positional scarcity ══════════════════════ */

function scarcityCard() {
    const panels = ctx.positions.map(p => {
        const d = p.depth;
        const rows = [
            ['Top 5 average', d.top5], ['Top 10', d.top10], ['Top 12', d.top12],
            ['Top 24', d.top24], ['Top 36', d.top36], ['Median of the pool', d.median],
        ].filter(([, v]) => v != null)
            .map(([l, v]) => `<div class="pd-depth-row"><span>${l}</span><b>${n0(v)}</b></div>`).join('');
        return `
        <figure class="pd-scar-panel" style="--pos-color:${POS_COLOR[p.pos]}">
            <figcaption class="pd-scar-head">
                ${posBadge(p.pos)}
                <em class="pd-scar-band pd-scar-band--${p.scarcity.toLowerCase()}">${p.scarcity}</em>
            </figcaption>
            <p class="pd-scar-lead">Deferring ${p.pos} by one turn costs <b>${p.waitCost}</b> points of value on
                average${p.holdsUntil ? `; the best available still clears replacement through round <b>${p.holdsUntil}</b>` : ''}.</p>
            <div class="pd-depth">${rows}</div>
            <div class="pd-depth pd-depth--gaps">
                <div class="pd-depth-row"><span>Best minus replacement</span><b>${sign(d.elite)}</b></div>
                <div class="pd-depth-row"><span>Last league starter minus replacement</span><b>${sign(d.starter)}</b></div>
                <div class="pd-depth-row"><span>Above replacement</span><b>${d.aboveReplacement} of ${d.total}</b></div>
                <div class="pd-depth-row"><span>League starters needed</span><b>${p.needed}</b></div>
            </div>
        </figure>`;
    }).join('');

    return `
    <section class="mosaic-card mc-wide db-card mc-in dgt-card" id="pd-scarcity">
        <span class="mc-kicker">Scarcity · the cost of waiting, not the size of the drop</span>
        <h2 class="mc-title">Which positions punish you for waiting</h2>
        <p class="dgt-card-sub">Scarcity here is measured as <b>how much value you lose by deferring a position for
            one turn</b>, averaged over every slot in the snake and the first eight rounds, using consensus ADP to say
            who is still on the board. It is deliberately not "how good is the best one": the top QB towers over the
            fourth QB, and it still costs nothing to wait, because there are 32 starting quarterbacks for four league
            spots. The bands are relative to the scarcest position <em>this</em> season — an absolute cut-off would be
            a number nobody measured.</p>
        <div class="pd-scar-grid">${panels}</div>
    </section>`;
}

/* ══════════════════════════ 5 · ADP vs projection ══════════════════════ */

/**
 * Due assi possibili, e il motivo per cui non sono intercambiabili.
 *
 * `vor` — valore sopra il replacement. È l'asse su cui è definito il "vs ADP",
 *   quindi è l'unico su cui la curva di mercato è LA baseline vera e non una
 *   somiglianza. Confronta ruoli diversi in modo onesto: un QB ad ADP 40
 *   proietta molti più punti grezzi di un WR ad ADP 40 e vale di meno, perché
 *   sotto ha un replacement molto più alto.
 * `proj` — punti proiettati grezzi. Si legge più naturale, ed è il numero che
 *   uno ha in testa, ma i ruoli non si confrontano: la nuvola si dispone in
 *   fasce per ruolo. Per questo su questo asse la curva NON si disegna —
 *   sarebbe una linea che sembra la baseline del "vs ADP" senza esserlo.
 */
function valueChart() {
    // un po' oltre le 64 pick vere: la fascia appena fuori dal draft è
    // informativa (è lì che si vede quanto in fretta finisce il valore), e
    // resta distinguibile perché quei punti non vengono mai etichettati
    const priced = ctx.board.filter(r => r.adp != null && r.adp <= ctx.meta.lastPick * 1.5);
    const labelled = new Set([...ctx.value.best.slice(0, 6), ...ctx.value.over.slice(0, 5)].map(r => r.key));
    const useVor = valueAxis === 'vor';
    const points = priced.map(r => ({
        x: r.adp, y: useVor ? r.vor : r.proj, color: POS_COLOR[r.pos],
        dim: !labelled.has(r.key),
        label: labelled.has(r.key) ? lastName(r.name) : null,
        tip: `${r.name} · ${r.pos}${r.team ? ` ${r.team}` : ''}\nADP ${Math.round(r.adp)} (round ${r.adpRound})\n${r.proj} projected · value over replacement ${sign(r.vor)}\nvs ADP ${sign(r.vaa)}`,
    }));
    return scatter(points, {
        height: 400, xInvert: true, xLabel: 'ADP — earlier to the right',
        yLabel: useVor ? 'Value over replacement' : 'Projected points',
        curve: useVor ? ctx.marketCurve : null,
        curveLabel: useVor ? 'what the price usually buys' : null,
    });
}

function valueCard() {
    const list = (rows, cls, note) => `
        <div class="pd-val-col">
            <h3 class="pd-val-head ${cls}">${note}</h3>
            ${rows.length ? rows.map(r => `
            <div class="pd-val-row" data-player-modal data-player-name="${esc(r.name)}" data-pos="${r.pos}"
                 data-nfl="${esc(r.team || '')}" data-year="${esc(ctx.year)}" style="--pos-color:${POS_COLOR[r.pos]}">
                ${posBadge(r.pos)}
                <span class="pd-val-name">${esc(r.name)}<small>ADP ${Math.round(r.adp)}${r.draftable ? ` · R${r.adpRound}` : ''}</small></span>
                <b class="pd-val-num ${r.vaa >= 0 ? 'up' : 'down'}">${sign(r.vaa)}</b>
            </div>`).join('') : '<p class="pd-val-none">Nothing stands out this far from the market.</p>'}
        </div>`;

    return `
    <section class="mosaic-card mc-wide db-card mc-in dgt-card" id="pd-value">
        <div class="db-head">
            <div>
                <span class="mc-kicker">Price against projection · every drafted-range player</span>
                <h2 class="mc-title">What costs what</h2>
            </div>
            <div class="db-sort" id="pd-axis" role="group" aria-label="Vertical axis">
                <button class="db-sort-btn${valueAxis === 'vor' ? ' active' : ''}" data-axis="vor">Value</button>
                <button class="db-sort-btn${valueAxis === 'proj' ? ' active' : ''}" data-axis="proj">Points</button>
            </div>
        </div>
        <p class="dgt-card-sub">Each dot is a player: how early the market takes him against what he is worth. On
            <b>Value</b> the dashed line is what a pick at that price usually returns — above it you get more than you
            pay for. Switch to <b>Points</b> to read raw projected totals instead; the line disappears there on
            purpose, because raw points do not compare across positions and a baseline drawn through them would
            look like the same one and not be.</p>
        <div id="pd-value-chart">${valueChart()}</div>
        <div class="pd-val-cols">
            ${list(ctx.value.best, 'up', 'Best values')}
            ${list(ctx.value.neutral, '', 'Priced about right')}
            ${list(ctx.value.over, 'down', 'Costs more than it projects')}
        </div>
        <details class="an-legend-box">
            <summary>How "vs ADP" is calculated</summary>
            <div class="an-legend-list">
                <p><b>Value over replacement (VOR)</b> — projected points minus the last player this league would
                start at that position. Four teams starting one QB means the fourth-best QB is the baseline, which is
                why quarterbacks rarely lead the board here.</p>
                <p><b>The market curve</b> — sort every priced player by ADP and take the rolling median of VOR over a
                seven-player window. That is what a pick at that point in the draft returns on a normal day. The
                median, not the average, so a single outlier does not drag his neighbours' price.</p>
                <p><b>vs ADP</b> = a player's VOR minus the market curve at his ADP. Positive means the price buys
                less than he projects. Bands are drawn at half a standard deviation <em>within each position</em>,
                because a quarterback's spread and a running back's spread are not the same size.</p>
                <p>Players with no consensus ADP have no price, so they have no vs-ADP figure — it reads "—", not zero.</p>
            </div>
        </details>
    </section>`;
}

/* ═══════════════════ 6 · floor / projection / ceiling ══════════════════ */

function rangeCard() {
    const rows = ctx.board
        .filter(r => r.floor != null && r.draftable && r.adpRound <= 10)
        .sort((a, b) => (b.ceiling - b.floor) - (a.ceiling - a.floor))
        .slice(0, 14)
        .map(r => ({
            label: `${lastName(r.name)} · ${r.pos}`,
            a: r.floor, b: r.ceiling,
            tip: `${r.name}\nFloor ${r.floor} · projection ${r.proj} · ceiling ${r.ceiling}\nWeek-to-week variation last season: ${r.cv}`,
        }));

    const safest = ctx.board.filter(r => r.riskProfile === 'SAFE' && r.draftable)
        .sort((a, b) => b.floor - a.floor).slice(0, 6);
    const swingiest = ctx.board.filter(r => r.ceiling != null && r.draftable)
        .sort((a, b) => (b.ceiling - b.proj) - (a.ceiling - a.proj)).slice(0, 6);

    const mini = (list, kind) => list.map(r => `
        <div class="pd-mini-row" data-player-modal data-player-name="${esc(r.name)}" data-pos="${r.pos}"
             data-nfl="${esc(r.team || '')}" data-year="${esc(ctx.year)}" style="--pos-color:${POS_COLOR[r.pos]}">
            ${posBadge(r.pos)}<span class="pd-mini-name">${esc(r.name)}</span>
            <b>${kind === 'floor' ? r.floor : r.ceiling}</b>
            <small>${kind === 'floor' ? 'floor' : `+${r.ceiling - r.proj} upside`}</small>
        </div>`).join('');

    if (!rows.length) {
        return `
        <section class="mosaic-card mc-wide db-card mc-in dgt-card" id="pd-range">
            <span class="mc-kicker">Range · floor, projection, ceiling</span>
            <h2 class="mc-title">How wide each outcome is</h2>
            <p class="dgt-card-sub">No prior-season game logs are available for ${esc(ctx.year)}, so no range can be
                estimated. Rather than invent one, this section stays empty.</p>
        </section>`;
    }

    return `
    <section class="mosaic-card mc-wide db-card mc-in dgt-card" id="pd-range">
        <span class="mc-kicker">Range · from last season's week-to-week swing</span>
        <h2 class="mc-title">How wide each outcome is</h2>
        <p class="dgt-card-sub">The band around a projection comes from how much that player actually swung
            week to week last season, applied to this season's number — the same calculation the Draft Grades use, so
            a wide player here is a wide player there. <b>Rookies and anyone without a prior game log have no band</b>
            and read N/A: a floor invented for a rookie would be the most dangerous number on the page.</p>
        ${dumbbell(rows, {
        a: { name: 'Floor', color: 'var(--text-muted)' },
        b: { name: 'Ceiling', color: 'var(--accent-green)' },
        unit: ' pt', labelW: 132,
    })}
        <div class="pd-mini-cols">
            <div class="pd-mini-col"><h3 class="pd-val-head up">Highest floors</h3>${mini(safest, 'floor')}</div>
            <div class="pd-mini-col"><h3 class="pd-val-head">Biggest upside over the projection</h3>${mini(swingiest, 'ceiling')}</div>
        </div>
        <p class="db-foot">Risk profile is the quartile of week-to-week variation <em>within the position</em> — a tight
            end who swings like a running back is not the same thing — moved one band worse for anyone carrying an
            injury designation or coming off a season under 13 games.</p>
    </section>`;
}

/* ═════════════════════ 7 · breakout and risk signals ═══════════════════ */

function signalsCard() {
    return `
    <section class="mosaic-card mc-wide db-card mc-in dgt-card" id="pd-signals">
        <span class="mc-kicker">Signals · each one is a number you can check</span>
        <h2 class="mc-title">Who could break out, and who could hurt</h2>
        <p class="dgt-card-sub">These are <b>signals, not predictions</b>. A player appears here when at least two
            measurable things point the same way, and every line carries the number behind it. Nothing on this card
            says anyone will bust or boom — the data does not support that sentence, and neither do we.</p>
        <div id="pd-signals-body">${signalsBody()}</div>
    </section>`;
}

function signalsBody() {
    const card = (r, kind) => `
        <article class="pd-sig dg-pick ${kind === 'up' ? 'dg-pick--best' : 'dg-pick--worst'}"
                 data-player-modal data-player-name="${esc(r.name)}" data-pos="${r.pos}"
                 data-nfl="${esc(r.team || '')}" data-year="${esc(ctx.year)}">
            <header class="pd-sig-head">
                ${posBadge(r.pos)}
                <span class="pd-sig-name">${esc(r.name)}<small>${esc(r.team || '')} · ADP ${r.adp != null ? Math.round(r.adp) : '—'}${r.draftable ? ` (R${r.adpRound})` : ''}</small></span>
                <span class="pd-sig-num">${n0(r.proj)}<small>projected</small></span>
            </header>
            <p class="pd-sig-why">Why it matters</p>
            <ul class="pd-sig-list">${(kind === 'up' ? r.breakout : r.risk).reasons.map(x => `<li>${esc(x.text)}</li>`).join('')}</ul>
            ${contextLine(r)}
        </article>`;

    const up = ctx.signals.breakout, down = ctx.signals.risk;
    return `
    <div class="pd-sig-cols">
        <div class="pd-sig-col">
            <h3 class="pd-val-head up">Breakout candidates</h3>
            <p class="pd-sig-sub">Players going after round 3 whose surroundings changed in their favour.</p>
            ${up.length ? up.map(r => card(r, 'up')).join('') : '<p class="pd-val-none">No player clears two independent breakout signals this season.</p>'}
        </div>
        <div class="pd-sig-col">
            <h3 class="pd-val-head down">Risk signals inside the first ten rounds</h3>
            <p class="pd-sig-sub">Not "avoid" — "know what you are paying for".</p>
            ${down.length ? down.map(r => card(r, 'down')).join('') : '<p class="pd-val-none">No player inside the drafted range clears two independent risk signals.</p>'}
        </div>
    </div>`;
}

/**
 * La riga del modello, sotto le motivazioni.
 *
 * Sta qui e non fra le motivazioni perché è un'altra cosa: le motivazioni sono
 * fatti misurati, questa è la stima di un modello. E si mostra SEMPRE quando
 * esiste, anche bassa — la soglia (40%, la stessa dei Draft Grades: un solo
 * metro nel sito) decide se vale come segnale, non se il numero si può vedere.
 * Nascondere una stima bassa lascerebbe credere che il modello non si sia
 * espresso, quando invece si è espresso e ha detto "poco rischio".
 */
function contextLine(r) {
    if (!r.ctx) return '';
    const bits = [];
    if (r.ctx.contextScore != null) bits.push(`SOS+ <b>${r.ctx.contextScore}</b>/100`);
    if (r.ctx.schedule != null) bits.push(`schedule <b>${r.ctx.schedule}</b>/100`);
    if (r.ctx.bustProb != null) bits.push(`model flop risk <b>${Math.round(r.ctx.bustProb * 100)}%</b>`);
    return bits.length ? `<p class="pd-sig-model">${bits.join(' · ')}</p>` : '';
}

function repaintSignals() {
    const body = document.getElementById('pd-signals-body');
    if (body) body.innerHTML = signalsBody();
    const boardBodyEl = document.getElementById('pd-board-body');
    if (boardBodyEl) boardBodyEl.innerHTML = boardBody();
}

/* ══════════════════════ 8 · strategy by position ═══════════════════════ */

function strategyCard() {
    const rows = [...ctx.positions].sort((a, b) => b.waitRel - a.waitRel).map(p => {
        const t1 = p.tiers[0], t2 = p.tiers[1];
        // Da quando esce il primo del tier 1 a quando comincia a sparire il
        // tier 2. Non "fino alla fine del tier 2": i tier sono ordinati per
        // valore, non per prezzo, quindi l'ultimo del tier 2 può avere un ADP
        // lontanissimo e la finestra diventava "giri 6–26" — un consiglio che
        // non dice niente. E per la stessa ragione il fondo va tenuto ≥ della
        // cima, altrimenti esce "giri 6–5".
        const lo = t1?.adpFirst != null ? roundFor(t1.adpFirst) : null;
        const hi = lo == null ? null : Math.max(lo, roundFor(t2?.adpFirst ?? t1.adpLast));
        const window_ = lo == null ? 'no clear window'
            : lo === hi ? `round ${lo}` : `rounds ${lo}–${hi}`;
        const late = ctx.board
            .filter(r => r.pos === p.pos && r.valueBand === 'value' && r.draftable && r.adpRound >= 7)
            .slice(0, 3);
        const verdict = p.scarcity === 'Extreme' || p.scarcity === 'High'
            ? { cls: 'early', icon: '!', label: 'Take it early' }
            : p.scarcity === 'Medium'
                ? { cls: 'even', icon: '=', label: 'Take it when the value lines up' }
                : { cls: 'right', icon: '✓', label: 'You can wait' };
        return `
        <div class="dgt-strat-row dgt-strat--${verdict.cls}" style="--pos-color:${POS_COLOR[p.pos]}">
            ${posBadge(p.pos)}
            <div class="dgt-strat-main">
                <p class="dgt-strat-head">Best window: <b>${window_}</b> · ${p.tiers.length} tiers ·
                    ${p.depth.aboveReplacement} above replacement${p.holdsUntil ? ` · holds through round ${p.holdsUntil}` : ''}</p>
                <p class="dgt-strat-note">${strategyNote(p, late)}</p>
            </div>
            <div class="dgt-strat-verdict">
                <span class="dgt-strat-icon">${verdict.icon}</span>
                <span class="dgt-strat-label">${verdict.label}</span>
                <span class="dgt-strat-edge">${p.waitCost} pt / turn</span>
            </div>
        </div>`;
    }).join('');

    return `
    <section class="mosaic-card mc-wide db-card mc-in dgt-card" id="pd-strategy">
        <span class="mc-kicker">By position · early or late, and why</span>
        <h2 class="mc-title">Where each position belongs in your draft</h2>
        <p class="dgt-card-sub">Ordered by how much it costs to wait. The window is where that position's top two
            tiers actually go in real drafts, converted to this league's rounds.</p>
        <div class="dgt-strat">${rows}</div>
    </section>`;
}

/** ADP → giro di QUESTA lega, con il tetto dei giri veri (16, non 26). */
const roundFor = (adp) => Math.max(1, Math.min(ROUND_MAX, Math.ceil(adp / ctx.meta.teams)));

function strategyNote(p, late) {
    const bits = [];
    const n = p.tiers[0].size;
    if (p.cliffRound) bits.push(`The first material drop lands around round ${p.cliffRound}${p.contested ? `, and only ${n} player${n === 1 ? '' : 's'} sit${n === 1 ? 's' : ''} above it for ${ctx.meta.teams} teams` : ''}`);
    else bits.push('No single cliff — the curve fades, so any turn is about as good as the next');
    if (p.deepest) bits.push(`it drops again after ${p.pos}${p.deepest.at}${p.deepest.adp ? ` (ADP ${p.deepest.adp})` : ''}`);
    if (late.length) bits.push(`late value: ${late.map(r => `${lastName(r.name)} (R${r.adpRound})`).join(', ')}`);
    return `${bits.join('; ')}.`;
}

/* ═════════════════════════ 9 · round-by-round plan ═════════════════════ */

function roundsCard() {
    return `
    <section class="mosaic-card mc-wide db-card mc-in dgt-card" id="pd-rounds">
        <span class="mc-kicker">Your plan · ${ordinal(slot)} pick in a ${ctx.meta.teams}-team snake</span>
        <h2 class="mc-title">Round by round, from your seat</h2>
        <p class="dgt-card-sub">Not sixteen independent lists: each round assumes you took its first target, and the
            roster that leaves you changes what the next round recommends. "Still there" is the market's probability
            that a player survives to your pick — the same survival model the Draft Grades use to judge whether a pick
            could have waited${ctx.meta.hasAdpDispersion ? '' : ', running on its default spread because this season has no published ADP dispersion'}.</p>
        <div id="pd-rounds-body">${roundsBody()}</div>
    </section>`;
}

function roundsBody() {
    const plan = buildRoundPlan(ctx, slot);
    if (!plan.length) return empty('Not enough ADP coverage to build a round-by-round plan this season.');

    return `<div class="pd-rounds">${plan.map(rd => {
        const b = rd.best.row;
        const alts = rd.targets.slice(1).map(t => `
            <span class="pd-alt" title="${esc(t.row.name)} · ${t.row.proj} projected · ${Math.round(t.here * 100)}% still there">
                ${posBadge(t.row.pos)}${esc(lastName(t.row.name))}<em>${Math.round(t.here * 100)}%</em></span>`).join('');
        return `
        <div class="pd-round" style="--pos-color:${POS_COLOR[b.pos]}">
            <div class="pd-round-no">
                <b>R${rd.round}</b><small>pick ${rd.pick}</small>
            </div>
            <div class="pd-round-best" data-player-modal data-player-name="${esc(b.name)}" data-pos="${b.pos}"
                 data-nfl="${esc(b.team || '')}" data-year="${esc(ctx.year)}">
                <span class="pd-round-label">Best pick</span>
                <span class="pd-round-name">${posBadge(b.pos)}${esc(b.name)}</span>
                <span class="pd-round-meta">${n0(b.proj)} pt · VOR ${sign(b.vor)}${b.vaa != null ? ` · vs ADP ${sign(b.vaa)}` : ''}
                    · <b class="${survClass(rd.best.here)}">${Math.round(rd.best.here * 100)}% still there</b>
                    ${b.riskProfile ? ` · ${b.riskProfile.toLowerCase()}` : ''}</span>
            </div>
            <div class="pd-round-side">
                ${alts ? `<div class="pd-round-alts"><span class="pd-round-label">Alternatives</span>${alts}</div>` : ''}
                ${rd.wait.length ? `<div class="pd-round-wait"><span class="pd-round-label">Can wait</span>
                    ${rd.wait.map(w => `<span class="pd-alt pd-alt--wait">${posBadge(w.pos)}${esc(lastName(w.name))} next turn</span>`).join('')}</div>` : ''}
                ${rd.avoid.length ? `<div class="pd-round-avoid"><span class="pd-round-label">Costs too much here</span>
                    ${rd.avoid.map(a => `<span class="pd-alt pd-alt--avoid">${posBadge(a.row.pos)}${esc(lastName(a.row.name))}<em>${sign(a.row.vaa)}</em></span>`).join('')}</div>` : ''}
            </div>
        </div>`;
    }).join('')}</div>
    <p class="db-foot">The plan fills ${ctx.meta.slots.join(', ')} plus the bench across ${ROUND_MAX} rounds. Kickers and
        defences sit at the end on purpose — the Draft Strategy tab shows how little separates them.</p>`;
}

const survClass = (p) => (p >= 0.72 ? 'up' : p >= 0.45 ? '' : 'down');

/* ═══════════════════════════ 10 · comparison ═══════════════════════════ */

const CMP_ROWS = [
    ['ADP', r => (r.adp != null ? Math.round(r.adp) : null), 'low'],
    ['Round', r => r.adpRound, 'low'],
    ['Tier', r => r.tier, 'low'],
    ['Projected points', r => r.proj, 'high'],
    ['Points per game', r => r.ppg, 'high'],
    ['Value over replacement', r => r.vor, 'high'],
    ['vs ADP', r => r.vaa, 'high'],
    ['Floor', r => r.floor, 'high'],
    ['Ceiling', r => r.ceiling, 'high'],
    ['Risk-adjusted value', r => r.ce, 'high'],
    ['Last season, points per game', r => r.prior?.fpgLeague ?? null, 'high'],
    ['Last season, games', r => r.prior?.gp ?? null, 'high'],
    ['Last season, target share', r => (r.prior?.targetShare != null ? +(r.prior.targetShare * 100).toFixed(1) : null), 'high'],
    ['Seasons of experience', r => r.exp, null],
    ['Bye week', r => r.bye, null],
    ['Schedule (SOS+)', r => r.ctx?.schedule ?? null, 'high'],
];

function compareCard() {
    const rows = compare.map(k => ctx.byKey.get(k)).filter(Boolean);
    return `
    <section class="mosaic-card mc-wide db-card mc-in dgt-card" id="pd-compare">
        <span class="mc-kicker">Head to head · up to four at a time</span>
        <h2 class="mc-title">Compare</h2>
        <p class="dgt-card-sub">Pick players with the <b>+</b> on the board above. The verdict at the bottom is
            generated from these same numbers — it is a reading of the table, not an extra opinion.</p>
        <div id="pd-compare-body">${compareBody(rows)}</div>
    </section>`;
}

function compareBody(rows) {
    if (!rows.length) {
        return `<p class="pd-val-none">Nothing selected yet — hit <b>+</b> on any board row to add a player here.</p>`;
    }
    const head = rows.map(r => `
        <div class="pd-cmp-col" style="--pos-color:${POS_COLOR[r.pos]}">
            ${posBadge(r.pos)}<b>${esc(r.name)}</b><small>${esc(r.team || '')}</small>
            <button class="pd-cmp-x" data-cmp="${esc(r.key)}" aria-label="Remove ${esc(r.name)}">×</button>
        </div>`).join('');

    const body = CMP_ROWS.map(([label, get, better]) => {
        const vals = rows.map(get);
        const nums = vals.filter(v => typeof v === 'number');
        const best = !better || !nums.length ? null : better === 'high' ? Math.max(...nums) : Math.min(...nums);
        return `
        <div class="pd-cmp-row">
            <span class="pd-cmp-label">${label}</span>
            ${vals.map(v => `<span class="pd-cmp-val${v != null && v === best && nums.length > 1 ? ' pd-cmp-val--best' : ''}">${v == null ? 'N/A' : v}</span>`).join('')}
        </div>`;
    }).join('');

    return `
    <div class="pd-cmp-grid" style="--cmp-cols:${rows.length}">
        <div class="pd-cmp-row pd-cmp-row--head"><span class="pd-cmp-label"></span>${head}</div>
        ${body}
    </div>
    <div class="pd-verdict">
        <span class="pd-verdict-label">Draft verdict</span>
        <p>${compareVerdict(rows)}</p>
    </div>`;
}

/**
 * Il verdetto è una LETTURA della tabella, non un secondo parere: ogni frase
 * nasce da un confronto fra due numeri già a schermo, e se i numeri non ci
 * sono la frase non esiste. È il motivo per cui non c'è mai un "prendi X":
 * la scelta dipende da cosa ti serve, e quello lo sa solo chi sta draftando.
 */
function compareVerdict(rows) {
    if (rows.length < 2) return 'Add a second player to get a comparison.';
    const parts = [];
    const byCe = [...rows].filter(r => r.ce != null).sort((a, b) => b.ce - a.ce);
    const byCeil = [...rows].filter(r => r.ceiling != null).sort((a, b) => b.ceiling - a.ceiling);
    const byAdp = [...rows].filter(r => r.adp != null).sort((a, b) => a.adp - b.adp);

    if (byCe.length >= 2 && byCeil.length >= 2 && byCe[0] !== byCeil[0]) {
        parts.push(`<b>${esc(byCe[0].name)}</b> is the safer pick — a floor of ${byCe[0].floor} against ${byCeil[0].floor} — while <b>${esc(byCeil[0].name)}</b> carries ${byCeil[0].ceiling - byCe[0].ceiling} more points of ceiling`);
    } else if (byCe.length >= 2) {
        parts.push(`<b>${esc(byCe[0].name)}</b> leads on both floor and ceiling, so the choice is not really a trade-off`);
    }
    if (byAdp.length >= 2) {
        const gap = Math.round(byAdp[byAdp.length - 1].adp - byAdp[0].adp);
        parts.push(gap <= 6
            ? `they cost about the same (${gap} picks apart)`
            : `<b>${esc(byAdp[byAdp.length - 1].name)}</b> comes ${gap} picks later, so taking him first would spend a pick you did not have to`);
    }
    const value = [...rows].filter(r => r.vaa != null).sort((a, b) => b.vaa - a.vaa)[0];
    if (value && value.vaa > 0) parts.push(`against the market, <b>${esc(value.name)}</b> is the one the price undervalues (${sign(value.vaa)})`);
    const risky = rows.find(r => r.risk?.reasons.length >= 2);
    if (risky) parts.push(`the clearest caution is on <b>${esc(risky.name)}</b>: ${esc(risky.risk.reasons[0].text.toLowerCase())}`);

    return `${parts.join('. ')}.`;
}

/* ═══════════════════════════ 11 · methodology ══════════════════════════ */

function methodCard() {
    const m = ctx.meta;
    return `
    <section class="mosaic-card mc-wide db-card mc-in dgt-card" id="pd-method">
        <span class="mc-kicker">Where every number comes from</span>
        <h2 class="mc-title">Methodology</h2>
        <p class="dg-footnote">
        <b>Real data.</b> Consensus ADP is full-PPR (Sleeper), the same market price the Draft Grades survival model
        uses. NFL team, years of experience, injury designation and rookie year come with the projections. Bye weeks
        are derived from the ${m.year} schedule — the week each team does not appear. Everything about last season is
        measured, not modelled: points per game, games played, target and rush share, snap share and the full
        week-by-week game log come from the nflverse build (<code>adv_players_${m.priorYear}.json</code>). Who changed
        team, which players a team lost and who arrived to compete for the ball are recomputed here by diffing the
        ${m.priorYear} and ${m.year} rosters on player ID.
        <br><b>Projected data.</b> Season point totals and the underlying statistics are Rotowire's projections via
        Sleeper, converted into this league's scoring. Note that Sleeper does not project <em>targets</em> — it
        projects receptions — so projected opportunity is stated as receptions and carries, and target share is only
        ever quoted as last season's real figure.
        <br><b>Calculated here.</b> Value over replacement, tiers, the market curve and vs-ADP, floor and ceiling,
        the cost of waiting and the scarcity bands, risk profiles, and the round-by-round plan. Each has its
        definition next to it or in the note under its chart.
        <br><b>Model output.</b> Flop probability comes from the trained model in
        <code>draft_model_v1.json</code>, whose regression half is deliberately <em>not</em> adopted because it does
        not beat the projection; only the flop classifier is. SOS+ is the Player Context Score, a context index and
        never a grade.
        <br><b>Not available, and therefore not shown.</b> Calendar age exists in no offline source, so the page shows
        <em>seasons of experience</em> and says so; the age-curve signals are built on that, not on birthdays. There is
        no snap-share projection for ${m.year}, no ordered depth chart beyond who starts, no coaching-change or
        offensive-line data, and ${m.hasAdpDispersion ? 'ADP dispersion is available' : `no published ADP dispersion for ${m.year}`}.
        Where a player has no prior game log there is no floor and no ceiling, and the cell reads N/A rather than a
        number nobody measured.
        </p>
    </section>`;
}

/* ═══════════════════════════════ binding ══════════════════════════════ */

function bindAll(host) {
    host.addEventListener('click', (e) => {
        // il modal è agganciato su document: fermare qui la propagazione è
        // l'unico modo perché un bottone dentro una riga non apra anche la scheda
        const goto = e.target.closest('[data-goto]');
        if (goto) {
            document.getElementById(goto.dataset.goto)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            return;
        }
        const cmp = e.target.closest('[data-cmp]');
        if (cmp) {
            e.stopPropagation();
            e.preventDefault();
            toggleCompare(cmp.dataset.cmp);
            return;
        }
        const slotBtn = e.target.closest('#pd-slot-pills [data-slot]');
        if (slotBtn) {
            const s = Number(slotBtn.dataset.slot);
            if (s === slot) return;
            slot = s;
            host.querySelectorAll('#pd-slot-pills .db-sort-btn').forEach(b =>
                b.classList.toggle('active', Number(b.dataset.slot) === slot));
            const kicker = document.querySelector('#pd-rounds .mc-kicker');
            if (kicker) kicker.textContent = `Your plan · ${ordinal(slot)} pick in a ${ctx.meta.teams}-team snake`;
            const grid = host.querySelector('#pd-snake-grid');
            if (grid) grid.innerHTML = snakeGridHtml();
            const body = document.getElementById('pd-rounds-body');
            if (body) body.innerHTML = roundsBody();
            return;
        }
        const axisBtn = e.target.closest('#pd-axis [data-axis]');
        if (axisBtn) {
            if (axisBtn.dataset.axis === valueAxis) return;
            valueAxis = axisBtn.dataset.axis;
            host.querySelectorAll('#pd-axis .db-sort-btn').forEach(b =>
                b.classList.toggle('active', b.dataset.axis === valueAxis));
            const chart = document.getElementById('pd-value-chart');
            if (chart) chart.innerHTML = valueChart();
            return;
        }
        const sortBtn = e.target.closest('#pd-sort [data-sort]');
        if (sortBtn) {
            if (sortBtn.dataset.sort === sortBy) return;
            sortBy = sortBtn.dataset.sort;
            host.querySelectorAll('#pd-sort .db-sort-btn').forEach(b =>
                b.classList.toggle('active', b.dataset.sort === sortBy));
            limit = PAGE;
            refreshBoard();
            return;
        }
        const chip = e.target.closest('[data-filter]');
        if (chip) {
            const { filter, value } = chip.dataset;
            filters[filter] = filters[filter] === value ? 'ALL' : value;
            host.querySelectorAll(`[data-filter="${filter}"]`).forEach(b =>
                b.classList.toggle('active', b.dataset.value === filters[filter]));
            limit = PAGE;
            refreshBoard();
            return;
        }
        if (e.target.closest('#pd-more')) {
            limit += PAGE;
            refreshBoard();
        }
    });
}

function refreshBoard() {
    const body = document.getElementById('pd-board-body');
    if (body) body.innerHTML = boardBody();
}

function toggleCompare(k) {
    if (compare.includes(k)) compare = compare.filter(x => x !== k);
    else if (compare.length < 4) compare.push(k);
    else return; // quattro è il massimo leggibile su una riga

    const body = document.getElementById('pd-compare-body');
    if (body) body.innerHTML = compareBody(compare.map(x => ctx.byKey.get(x)).filter(Boolean));
    // i "+" sulla board seguono la selezione senza ridisegnare tutta la tabella
    document.querySelectorAll('.pd-row [data-cmp]').forEach(btn => {
        const on = compare.includes(btn.dataset.cmp);
        btn.classList.toggle('active', on);
        btn.textContent = on ? '−' : '+';
    });
}
