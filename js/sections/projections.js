/**
 * Projections — il listone preseason su cui sono costruiti i Draft Grades.
 *
 * Per ogni ruolo i giocatori in ordine di punti proiettati, con l'ADP di
 * consenso e chi se li è presi a quale pick. Sono le stesse identiche
 * proiezioni Sleeper/Rotowire dell'anno del draft che alimentano
 * js/data/draft-grade.js: la sezione esiste perché un voto si possa
 * contestare guardando i numeri veri invece che fidarsi.
 *
 * Nota su K e DEF: una proiezione ce l'hanno (`projPts`), ma è grossolana —
 * Sleeper non spacchetta i field goal per distanza né i punti subiti in fasce,
 * che sono proprio i pezzi dove lo scoring della lega si discosta. I numeri si
 * mostrano lo stesso, con l'avvertenza a schermo. Il fallback storico da 125 pt
 * NON entra mai qui: vive solo dentro al motore per non lasciare una pick senza
 * valore, e a schermo sarebbe un numero inventato.
 *
 * Come draft.js: `loaded` per non re-inizializzare, stato del ruolo in modulo.
 */

import { fetchDraftData, flattenDraft, displayName, SEASONS, SEASONS_DESC, CURRENT_SEASON } from '../data.js?v=580';
import { TEAM_KEYS } from '../data/team-config.js?v=533';
import { TEAMS } from './team.js?v=709';
import { initPlayerModal } from '../components/player-modal.js?v=713';
import { getSeasonProjections, getSeasonStats, matchProjection, normName } from '../data/projections.js?v=595';
import { pickDropdownHTML, bindPickDropdown } from '../ui/dropdown-pick.js?v=1';
import { computeStrategy, simulateDraft, POSITION_COLORS, TAIL_COLORS, lastName, ordinal, roundOf } from '../data/draft-strategy.js?v=47';
import { multiLine, dumbbell } from '../ui/charts.js?v=7';
import { renderPreDraft, resetPreDraft } from './predraft.js?v=64';
import { decomposeSeason, seasonVerdict, getPerfCauses, describeCauses } from '../data/perf-explain.js?v=587';
import { perfWaterfall, injuryLabelForSeason, injuryHistoryDetails, fmt0 } from './player-page.js?v=928';
import { getPlayerInjuries } from '../data/nfl-team-extras.js?v=1001';

const POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];
const POS_NAME = { QB: 'Quarterback', RB: 'Running back', WR: 'Wide receiver', TE: 'Tight end' };
const TOP_N = 40;
// Il pannello "Why" (proiettato→reale stat per stat) esiste solo per i ruoli
// che decomposeSeason sa scomporre — K/DEF non hanno le stat di scoring giuste.
const WHY_POSITIONS = new Set(['QB', 'RB', 'WR', 'TE']);

let loaded = false;
let currentYear = null;
let currentPos = 'RB';
let byPos = null;      // { POS: [ {name, team, pts, adp, pick, real, gp, projRaw, actualRaw} ] }
let seasonDone = false;  // stagione conclusa → si mostrano i punti veri
let sortBy = 'proj';     // 'proj' | 'real' — solo a stagione conclusa
let _rowIndex = new Map(); // normName(r.name) → r, ricostruita a ogni renderList: serve al toggle "Why"
/**
 * 'board'    — il listone di sempre, un ruolo alla volta
 * 'strategy' — che FORMA ha il board: VORP, tier, dove crolla ogni ruolo
 * 'predraft' — quanto vale ciascuno RISPETTO A QUANTO COSTA, e cosa fare al
 *              proprio turno. Vive in sections/predraft.js: è la vista più
 *              grossa delle tre e teneva insieme questo file non aiutava
 *              nessuno (renderStrategy da sola è già mezzo file).
 */
let view = 'board';
let slotSel = 1;         // da che posizione dello snake si guarda il draft simulato
let simMode = 'optimal'; // 'optimal' (tutti ottimizzano) | 'realistic' (avversari da ADP)

export async function initProjections() {
    if (loaded) return;
    loaded = true;
    initPlayerModal();
    currentYear = CURRENT_SEASON;
    renderPickRow();
    await loadYear(CURRENT_SEASON);
}

/**
 * Riga di controlli: il tab Board/Strategy a sinistra (spinto lì da
 * `margin-right:auto`, vedi CSS), le due capsule a scomparsa a destra — ruolo
 * (solo in Board, in Strategy i ruoli stanno tutti insieme) e anno.
 */
function renderPickRow() {
    const container = document.getElementById('pj-pick-row');
    if (!container) return;

    const tabs = `
    <div class="db-sort pj-view-tabs" id="pj-view-tabs" role="group" aria-label="View">
        <button class="db-sort-btn${view === 'board' ? ' active' : ''}" data-view="board">Board</button>
        <button class="db-sort-btn${view === 'strategy' ? ' active' : ''}" data-view="strategy">Draft Strategy</button>
        <button class="db-sort-btn${view === 'predraft' ? ' active' : ''}" data-view="predraft">Pre-Draft</button>
    </div>`;

    const posItems = view === 'board' ? POSITIONS.filter(p => byPos?.[p]?.length).map(p => ({ value: p, label: p })) : [];
    const posIdx = posItems.findIndex(it => it.value === currentPos);
    // Dalla piu' recente: voci e indice dalla STESSA lista, o la capsula
    // mostrerebbe un anno diverso da quello caricato.
    const yearItems = SEASONS_DESC.map(y => ({ value: y, label: y }));
    const yearIdx = SEASONS_DESC.indexOf(String(currentYear));

    container.innerHTML = tabs
        + (view === 'board' ? pickDropdownHTML('pos', posItems, posIdx) : '')
        + pickDropdownHTML('year', yearItems, yearIdx);
    bindPickDropdown(container, (id, value) => {
        if (id === 'year') {
            loadYear(value);
        } else if (id === 'pos') {
            currentPos = value;
            renderPickRow(); // altrimenti la capsula resta ferma sul ruolo precedente
            renderList();
        }
    });
    container.querySelector('#pj-view-tabs')?.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-view]');
        if (!btn || btn.dataset.view === view) return;
        view = btn.dataset.view;
        renderPickRow();
        renderCurrent();
    });
}

/** Smista fra le tre viste. Pre-Draft è asincrona: fa il suo spinner da sé. */
function renderCurrent() {
    if (view === 'predraft') renderPreDraft(document.getElementById('pj-content'), { byPos, year: currentYear });
    else if (view === 'strategy') renderStrategy();
    else renderList();
}

async function loadYear(year) {
    currentYear = year;
    // il Pre-Draft tiene in cache la board COSTRUITA di un anno: cambiando anno
    // va buttata, altrimenti la prima pittura mostrerebbe quella vecchia
    resetPreDraft();
    const host = document.getElementById('pj-content');
    host.innerHTML = `<div class="loading-state"><div class="spinner"></div><p>Loading ${year} projections...</p></div>`;

    let proj;
    try {
        proj = await getSeasonProjections(year);
    } catch {
        host.innerHTML = `<div class="empty-state"><p class="empty-state-text">Projections for ${year} are not available</p></div>`;
        byPos = null;
        renderPickRow();
        return;
    }
    if (currentYear !== year) return;

    // il draft dell'anno, per agganciare ogni riga alla pick vera. Se manca
    // (stagione non ancora draftata) il listone si vede lo stesso.
    let picks = [];
    try { picks = flattenDraft(await fetchDraftData(year)) || []; } catch { /* board nudo */ }

    /**
     * Statistiche REALI, per il confronto proiezione → resa. Si mostrano solo a
     * stagione conclusa: a metà anno un totale parziale letto accanto a una
     * proiezione stagionale sembra un crollo di tutti quanti.
     * Il test è "l'anno è passato" oppure "qualcuno ha già giocato 17 gare".
     */
    let stats = null;
    try { stats = await getSeasonStats(year); } catch { /* niente colonna */ }
    if (currentYear !== year) return;
    const maxGp = stats ? Math.max(0, ...[...stats.values()].map(e => e.gp || 0)) : 0;
    seasonDone = !!stats && (Number(year) < Number(CURRENT_SEASON) || maxGp >= 17);
    const drafted = new Map();
    for (const p of picks) {
        const hit = matchProjection(proj, p.player, p.pos);
        drafted.set(hit ? `${normName(hit.name)}|${p.pos}` : `${normName(p.player)}|${p.pos}`, p);
    }

    byPos = {};
    for (const e of proj.values()) {
        if (!POSITIONS.includes(e.pos)) continue;
        const key = `${normName(e.name)}|${e.pos}`;
        // per le DIFESE ptsLeague resta null (mancano le fasce punti-subiti):
        // si ripiega su pts_std, che nel nostro scoring ci va molto vicino
        const st = seasonDone ? stats.get(key) : null;
        (byPos[e.pos] = byPos[e.pos] || []).push({
            name: e.name, team: e.team,
            pts: e.projPts ?? e.ptsStd ?? null,
            adp: e.adp,
            pick: drafted.get(key) || null,
            real: st ? (st.ptsLeague ?? st.ptsStd ?? null) : null,
            gp: st?.gp ?? null,
            // stat grezze proiettate/reali (stessi nomi-campo Sleeper): alimentano
            // il pannello "Why", vedi buildWhyPanel più sotto
            projRaw: e.raw || null,
            actualRaw: st?.raw || null,
        });
    }
    // senza proiezione (i kicker) si ordina per ADP, l'unico segnale rimasto
    for (const pos of POSITIONS) {
        (byPos[pos] || []).sort((a, b) => (b.pts ?? -1) - (a.pts ?? -1) || (a.adp ?? 999) - (b.adp ?? 999));
    }
    if (!POSITIONS.some(p => byPos[p]?.length)) {
        host.innerHTML = `<div class="empty-state"><p class="empty-state-text">No projections for ${year}</p></div>`;
        byPos = null;
        renderPickRow();
        return;
    }
    if (!byPos[currentPos]?.length) currentPos = POSITIONS.find(p => byPos[p]?.length);

    renderPickRow();
    renderCurrent();
}

function renderList() {
    const host = document.getElementById('pj-content');
    if (!host || !byPos) return;
    const all = byPos[currentPos] || [];
    const byReal = seasonDone && sortBy === 'real';
    _rowIndex = new Map();

/**
     * L'ordinamento cambia SOLO l'ordine delle righe e le frecce di movimento.
     * Ogni colonna tiene il suo significato: la barra sta accanto ai punti
     * PROIETTATI e mostra sempre quelli. Farle seguire la chiave di
     * ordinamento sembrava più coerente, ma metteva una barra dei punti reali
     * di fianco al numero proiettato — due cose diverse attaccate. Ordinando
     * per resa vera le barre risultano sparpagliate, ed è esattamente
     * l'informazione: quanto il listone aveva sbagliato la scaletta.
     */
    const keyOf = (r) => byReal ? r.real : r.pts;
    const sorted = [...all].sort((a, b) => {
        const ka = keyOf(a), kb = keyOf(b);
        if (ka == null && kb == null) return (a.adp ?? 999) - (b.adp ?? 999);
        if (ka == null) return 1;          // chi non ha il dato va in fondo
        if (kb == null) return -1;
        return kb - ka || (a.adp ?? 999) - (b.adp ?? 999);
    });
    // rank proiettato stabile, per mostrare di quanto uno si è mosso
    const projRank = new Map(all.map((r, i) => [r, i + 1]));

    const list = sorted.slice(0, TOP_N);
    const max = Math.max(...list.map(r => r.pts || 0), 1);   // scala della barra: sempre i proiettati
    const drafted = all.filter(r => r.pick).length;

    const rows = list.map((r, i) => {
        const key = r.pick ? TEAM_KEYS[displayName(r.pick.team)] : null;
        const t = key ? TEAMS[key] : null;
        // la linea di fine tier segue il criterio attivo (è una proprietà
        // dell'ordinamento), la barra no (è una proprietà della colonna)
        const v = keyOf(r);
        const prevV = list[i - 1] ? keyOf(list[i - 1]) : null;
        const scale = byReal ? Math.max(...list.map(x => x.real || 0), 1) : max;
        const drop = prevV != null && v != null ? prevV - v : 0;
        const cliff = drop >= scale * 0.06 ? ' db-row--cliff' : '';
        const w = r.pts != null ? Math.max(2, Math.round(r.pts / max * 100)) : 0;
        // di quanti posti si è mosso rispetto al rank proiettato
        const move = byReal ? projRank.get(r) - (i + 1) : 0;
        // "Why": solo a stagione conclusa, sui ruoli che decomposeSeason sa
        // scomporre, e solo se abbiamo sia la proiezione che il reale grezzi
        const canWhy = seasonDone && WHY_POSITIONS.has(currentPos) && r.pts != null && r.real != null && r.projRaw && r.actualRaw;
        const whyKey = normName(r.name);
        if (canWhy) _rowIndex.set(whyKey, r);
        return `
        <div class="db-row${cliff}${r.pick ? '' : ' db-row--free'}"${t ? ` style="--team-color:${t.color}"` : ''}
             data-player-modal data-player-name="${r.name}" data-pos="${currentPos}"
             data-nfl="${r.team || ''}" data-year="${currentYear}">
            <span class="db-rank">${currentPos}${i + 1}${move
                ? `<em class="db-move ${move > 0 ? 'up' : 'down'}">${move > 0 ? '▲' : '▼'}${Math.abs(move)}</em>`
                : ''}</span>
            <span class="db-name">${r.name}<small>${r.team ? ` · ${r.team}` : ''}</small></span>
            <span class="db-bar"><span style="width:${w}%"></span></span>
            <span class="db-pts">${r.pts != null ? Math.round(r.pts) : '—'}</span>
            <span class="db-adp">${r.adp != null ? `ADP ${Math.round(r.adp)}` : ''}</span>
            <span class="db-taken">${r.pick
                ? `<b>#${r.pick.pick}</b> ${t ? t.name : displayName(r.pick.team)}`
                : '<i>undrafted</i>'}</span>
            ${seasonDone ? realCell(r, canWhy, whyKey) : ''}
        </div>${canWhy ? `<div class="db-accordion" hidden data-why-panel data-why-key="${whyKey}"></div>` : ''}`;
    }).join('');

    host.innerHTML = `
    <section class="mosaic-card mc-wide db-card mc-in${seasonDone ? ' db-card--real' : ''}">
        <div class="db-head">
            <div>
                <span class="mc-kicker">${currentYear} preseason · Rotowire via Sleeper</span>
                <h2 class="mc-title">${byReal ? 'Actual points' : 'Projected points'} — ${currentPos}</h2>
            </div>
            ${seasonDone ? `
            <div class="db-sort" id="db-sort" role="group" aria-label="Sort players by">
                <button class="db-sort-btn${byReal ? '' : ' active'}" data-sort="proj">Projected</button>
                <button class="db-sort-btn${byReal ? ' active' : ''}" data-sort="real">Actual</button>
            </div>` : ''}
        </div>
        <p class="db-sub">Projections converted into this league's scoring: the same numbers the Draft Grades are built on. Consensus ADP is full-PPR, 12-team. A line marks a drop of 6% or more from the player above — that is where a tier ends.${byReal ? ' Sorted by what they actually scored, with the arrow showing how far each moved from where the projection had them.' : ''}${currentPos === 'K' || currentPos === 'DEF'
            ? ` Treat these as rough: Sleeper does not break ${currentPos === 'K' ? 'field goals down by distance' : 'points allowed into tiers'}, which is exactly where this league's scoring differs.`
            : ''}${seasonDone
            ? ` The season is over, so what each player actually scored is shown on the right, with the gap against the projection. <b>Beat</b> and <b>missed</b> flag the players who ended more than 35% above or 45% below what was expected of them.`
            : ''}</p>
        <div class="db-colhead">
            <span>#</span>
            <span>Player</span>
            <span class="db-colhead-bar">Projected</span>
            <span class="db-colhead-num">pt</span>
            <span>ADP</span>
            <span>Drafted</span>
            ${seasonDone ? '<span class="db-colhead-num">Actual</span>' : ''}
        </div>
        <div class="db-rows">${rows}</div>
        <p class="db-foot">Top ${list.length} of ${all.length} projected ${currentPos}s · the league drafted ${drafted}.${seasonDone
            ? ` Real points are ${currentYear} season totals in this league's scoring${currentPos === 'DEF' ? ', defenses on standard scoring' : ''}.`
            : ''} Click a row for the player's card${seasonDone && WHY_POSITIONS.has(currentPos) ? `, or "Why" for the stat-by-stat breakdown of the gap` : ''}.</p>
    </section>`;

    document.getElementById('db-sort')?.addEventListener('click', (e) => {
        const btn = e.target.closest('.db-sort-btn');
        if (!btn || btn.dataset.sort === sortBy) return;
        sortBy = btn.dataset.sort;
        renderList();
    });
    host.querySelector('.db-rows')?.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-why-toggle]');
        if (!btn) return;
        e.stopPropagation(); // non deve anche aprire la scheda giocatore della riga
        handleWhyToggle(btn);
    });
}

/**
 * Cella "com'è andata poi": punti veri, scarto dalla proiezione e, quando lo
 * scarto è grosso, l'etichetta. Le soglie sono le stesse di outcomeBadge nei
 * Draft Grades (+35% / −45%) così una "rivelazione" qui è la stessa cosa che
 * là: un solo metro in tutto il sito.
 * Senza proiezione (i kicker) non c'è scarto da mostrare, solo il totale.
 */
function realCell(r, canWhy = false, whyKey = '') {
    if (r.real == null) return `<span class="db-real db-real--none">—</span>`;
    const real = Math.round(r.real);
    if (r.pts == null) {
        return `<span class="db-real"><small>${r.gp ? `${r.gp} games` : ''}</small><b>${real}</b></span>`;
    }
    const delta = Math.round(r.real - r.pts);
    const ratio = r.pts > 0 ? r.real / r.pts : null;
    const tag = ratio == null ? ''
        : ratio >= 1.35 ? '<em class="db-tag db-tag--up">beat</em>'
            : ratio <= 0.55 ? '<em class="db-tag db-tag--down">missed</em>' : '';
    const cls = delta >= 0 ? 'up' : 'down';
    // il bottone apre l'accordion sotto la riga (vedi handleWhyToggle): tocca
    // fermare la propagazione al click o riapre anche la scheda giocatore
    const why = canWhy
        ? `<button type="button" class="db-why-btn" data-why-toggle data-why-key="${whyKey}" aria-expanded="false">Why<span class="db-why-chevron" aria-hidden="true">▾</span></button>`
        : '';
    // ordine di lettura: badge, scarto, punti — il totale vero resta all'estrema
    // destra, in colonna con gli altri numeri della riga
    return `<span class="db-real">${tag}<em class="db-delta ${cls}">${delta >= 0 ? '+' : ''}${delta}</em><b>${real}</b>${why}</span>`;
}

/**
 * Apre/chiude il pannello "Why" sotto la riga cliccata, e la prima volta
 * costruisce il contenuto (lazy: nessun fetch finché nessuno lo chiede).
 */
async function handleWhyToggle(btn) {
    const panel = btn.closest('.db-row')?.nextElementSibling;
    if (!panel?.matches('.db-accordion')) return;
    const opening = panel.hidden;
    panel.hidden = !opening;
    btn.setAttribute('aria-expanded', String(opening));
    btn.classList.toggle('db-why-btn--open', opening);
    if (!opening || panel.dataset.loaded) return;
    panel.dataset.loaded = '1';
    const r = _rowIndex.get(btn.dataset.whyKey);
    const pos = currentPos, year = currentYear;
    panel.innerHTML = `<div class="db-why-loading"><div class="spinner"></div></div>`;
    try {
        panel.innerHTML = await buildWhyPanel(r, pos, year);
    } catch {
        panel.innerHTML = `<p class="db-foot">Analysis not available for this player right now.</p>`;
    }
}

/**
 * Il pannello "perché ha reso così": stessa scomposizione stat-per-stat di
 * perfExplainBlock in player-page.js (js/data/perf-explain.js), per la SOLA
 * stagione mostrata qui. Le cause (infortuni compagni, arrivi/partenze,
 * produzione di squadra, protezione) vengono da perf_causes_{year}.json;
 * l'infortunio proprio dal referto nflverse via getPlayerInjuries.
 */
async function buildWhyPanel(r, pos, year) {
    const dec = decomposeSeason({ pos, proj: r.projRaw, actual: r.actualRaw });
    if (!dec) return `<p class="db-foot">Not enough detail to break down this player's season.</p>`;

    const [causesMap, injRecords] = await Promise.all([
        getPerfCauses(year).catch(() => null),
        getPlayerInjuries(null, r.name, pos, [year]).catch(() => []),
    ]);
    const causes = causesMap?.get(`${normName(r.name)}|${pos}`);
    const pi = injRecords?.[0] || null;
    const injLabel = injuryLabelForSeason(pi);
    const verdict = seasonVerdict(dec, injLabel);
    const causeItems = describeCauses(causes, dec);
    const shown = dec.rows.filter(x => Math.abs(x.pts) >= 1);

    // (lo snap% lo racconta già la riga sotto l'anello: usageChart lo scarta)
    const readoutHtml = usageChart(dec);
    const shareHtml = shareSunburst(causes, r.name);
    const causesHtml = causeItems.length
        ? `<div class="pp-pe-causes"><span class="pp-pe-causes-lbl">Why</span>${causeItems.map(c => `<div class="pp-pe-cause"><span class="pp-pe-cause-ic">${c.icon}</span> ${c.text}</div>`).join('')}</div>`
        : '';
    const injHtml = pi?.weeks?.length ? injuryHistoryDetails(pi.weeks) : '';
    const missed = dec.gpP - dec.gpA;

    // Due colonne quando c'è anche l'anello: a sinistra DA DOVE arriva lo
    // scarto (cascata) e perché (le cause a parole, che riempiono la colonna
    // fino in fondo invece di lasciarci un vuoto sotto il grafico); a destra
    // QUANTO dell'attacco è passato da lui. I readout sono una riga sola di
    // testo e stanno sotto a tutta larghezza, non spezzati in una colonna
    // stretta. Senza anello la cascata si prende da sola tutta la larghezza.
    const waterfallFig = `
        <figure class="pp-pe-fig">
            <figcaption class="pp-pe-fig-cap">From projected to actual</figcaption>
            ${perfWaterfall(dec, shown, { compact: !!shareHtml })}
        </figure>`;
    const body = shareHtml
        ? `<div class="pp-pe-charts pp-pe-charts--two">
               <div class="pp-pe-col">${waterfallFig}${causesHtml}</div>
               ${shareHtml}
           </div>
           ${readoutHtml}`
        : `<div class="pp-pe-charts">${waterfallFig}</div>
           ${readoutHtml}${causesHtml}`;

    return `
    <div class="pp-pe-season">
        <div class="pp-pe-head">${year}: actual <b>${fmt0(dec.actPts)}</b> − projected ${fmt0(dec.projPts)} = <span class="pp-res pp-res--${dec.error >= 0 ? 'w' : 'l'}">${dec.error >= 0 ? '+' : ''}${fmt0(dec.error)}</span> · ${dec.gpA}/${dec.gpP} games${missed >= 2 ? ` <span class="pp-pe-miss">(${missed} missed)</span>` : ''}</div>
        ${verdict?.headline ? `<div class="pp-perr-verdict pp-perr-verdict--${dec.error >= 0 ? 'w' : 'l'}">${verdict.headline}</div>` : ''}
        ${body}
        ${injHtml}
    </div>`;
}

/**
 * Come lo ha usato la squadra: una riga per tipo di pallone, TUTTO A PARTITA.
 *
 * L'unità è la cosa importante qui. Prima la riga diceva "Targets/game 5.1→6.1
 * · Red zone targets 12": una media a partita e un totale di stagione appaiati,
 * che non si possono confrontare — 12 sembra enorme accanto a 6.1 ed è invece
 * un undicesimo del volume. Portati tutti a partita i tre numeri stanno sullo
 * STESSO ASSE e si leggono l'uno contro l'altro.
 *
 * A partita e non in totale perché il confronto con la proiezione deve reggere
 * anche per chi ha saltato gare: chi ne gioca 12 su 17 ha meno target in totale
 * per assenza, non perché la squadra lo cerchi di meno.
 *
 * Forma: bullet chart. La barra chiara è il volume vero, il pezzo pieno in
 * fondo è la parte in zona da punto, il trattino verticale è quanto ce ne
 * aspettavamo. Tre cose sulla stessa riga senza tre grafici.
 */
function usageChart(dec) {
    const readouts = (dec.readouts || []).filter(x => x.key !== 'snap');
    const RZ_OF = { tgt: 'rzTgt', carries: 'rzAtt' };
    const gp = dec.gpA || 1;
    const rows = readouts.filter(r => r.proj != null && r.actual != null).map(r => {
        const rz = readouts.find(x => x.key === RZ_OF[r.key]);
        return {
            label: r.label.replace('/game', ''),
            actual: +r.actual,
            proj: +r.proj,
            // il conteggio di red zone è di stagione: diviso per le gare
            // GIOCATE diventa confrontabile col resto della riga
            rz: rz != null ? +rz.actual / gp : null,
            rzTotal: rz != null ? +rz.actual : null,
        };
    });
    if (!rows.length) return '';

    const W = 560, L = 104, R = 104, TOP = 10, ROW = 42;
    const plotW = W - L - R;
    const bottom = TOP + rows.length * ROW;
    const H = bottom + 30;
    const max = Math.max(...rows.flatMap(r => [r.actual, r.proj]), 1);
    const ticks = niceTicksLocal(0, max);
    const xMax = ticks[ticks.length - 1] || 1;
    const xx = (v) => L + (Math.max(0, v) / xMax) * plotW;
    const n1 = (v) => (Math.round(v * 10) / 10).toFixed(1);

    const grid = ticks.map(v => `
        <line x1="${xx(v).toFixed(1)}" y1="${TOP}" x2="${xx(v).toFixed(1)}" y2="${bottom}" class="an-gridline"/>
        <text x="${xx(v).toFixed(1)}" y="${H - 11}" class="an-tick" text-anchor="middle">${Number.isInteger(v) ? v : n1(v)}</text>`).join('');

    const BAR = 15;
    const body = rows.map((r, i) => {
        const yc = TOP + i * ROW + ROW / 2;
        const yb = yc - BAR / 2;
        const d = r.actual - r.proj;
        const rzPart = r.rz != null ? `
            <rect x="${L}" y="${yb}" width="${(xx(r.rz) - L).toFixed(1)}" height="${BAR}" rx="2" class="pp-us-rz">
                <title>${n1(r.rz)} ${r.label.toLowerCase()} per game in the red zone (${r.rzTotal} in the season)</title>
            </rect>` : '';
        return `
        <g class="pp-us-row">
            <text x="${L - 12}" y="${(yc + 4).toFixed(1)}" class="an-tick" text-anchor="end">${r.label}</text>
            <rect x="${L}" y="${yb}" width="${(xx(r.actual) - L).toFixed(1)}" height="${BAR}" rx="2" class="pp-us-bar">
                <title>${n1(r.actual)} ${r.label.toLowerCase()} per game</title>
            </rect>
            ${rzPart}
            <line x1="${xx(r.proj).toFixed(1)}" y1="${(yb - 4).toFixed(1)}" x2="${xx(r.proj).toFixed(1)}" y2="${(yb + BAR + 4).toFixed(1)}" class="pp-us-proj">
                <title>Projected ${n1(r.proj)} per game</title>
            </line>
            <text x="${W - R + 10}" y="${(yc + 1).toFixed(1)}" class="pp-us-val">${n1(r.actual)}</text>
            <text x="${W - R + 10}" y="${(yc + 12).toFixed(1)}" class="pp-us-delta${d === 0 ? '' : ` pp-us-delta--${d > 0 ? 'up' : 'down'}`}">${d === 0 ? 'as projected' : `${d > 0 ? '+' : '−'}${n1(Math.abs(d))} vs proj.`}</text>
        </g>`;
    }).join('');

    const hasRz = rows.some(r => r.rz != null);
    return `
    <figure class="pp-pe-fig pp-pe-fig--usage">
        <figcaption class="pp-pe-fig-cap">How the offense used him — everything per game</figcaption>
        <div class="pp-us-legend">
            <span class="pp-us-key"><i class="pp-us-key-bar"></i>Actual</span>
            ${hasRz ? '<span class="pp-us-key"><i class="pp-us-key-rz"></i>Of which in the red zone</span>' : ''}
            <span class="pp-us-key"><i class="pp-us-key-proj"></i>Projected</span>
        </div>
        <div class="an-scroll"><svg viewBox="0 0 ${W} ${H}" class="an-svg pp-us-svg">${grid}${body}</svg></div>
    </figure>`;
}

/* ── Quota di squadra: sunburst a due anelli ──────────────────────────
 *
 * Anello interno: come si divide l'attacco fra aria e terra (i palloni che la
 * squadra ha mosso NELLE GARE DEL GIOCATORE). Anello esterno: dentro ciascuno
 * dei due, la sua fetta contro quella di tutti gli altri. Al centro, quanto
 * dell'attacco è passato dalle sue mani in tutto.
 *
 * Così il target share di un RB e la quota di corse di un ricevitore non sono
 * due grafici scollegati: sono due spicchi dello stesso attacco, e si legge in
 * un colpo d'occhio se uno prende palloni dove la squadra ne muove tanti.
 *
 * IL DENOMINATORE — le quote nflverse sono sulle gare GIOCATE, non sulla
 * stagione: i totali di squadra qui sono "nelle sue N gare", e la didascalia
 * lo dice. Vedi shareDetail() in scripts/build-perf-causes.mjs.
 */

const SB_PHASES = [
    { key: 'target', label: 'Through the air', unit: 'targets', tone: 'pass' },
    { key: 'rush', label: 'On the ground', unit: 'carries', tone: 'rush' },
];

function shareSunburst(causes, playerName) {
    const s = causes?.shares;
    if (!s) return '';
    // un ramo esiste solo col totale di squadra: sotto il 2% di quota la
    // divisione è rumore (vedi build-perf-causes), e un ramo senza denominatore
    // non si può disegnare
    const branches = SB_PHASES
        .map(p => ({ ...p, d: s[p.key] }))
        .filter(b => b.d?.team > 0)
        .map(b => ({ ...b, mine: b.d.player, team: b.d.team, rest: Math.max(0, b.d.team - b.d.player) }));
    if (!branches.length) return '';

    // `total` serve solo a dare l'ampiezza ai due settori dell'anello interno:
    // quanto pesa l'aria e quanto la terra nell'attacco di quella squadra.
    const total = branches.reduce((t, b) => t + b.team, 0);
    const two = branches.length > 1;

    const W = 420, H = 300, cx = 210, cy = 146;
    // un anello solo quando c'è un ramo: un cerchio interno intero non
    // direbbe nulla (è per forza il 100%), quindi si allarga la corona
    const rings = two
        ? { in: [58, 84], out: [88, 112] }
        : { in: null, out: [62, 112] };

    const parts = [], labels = [];
    let angle = 0;
    for (const b of branches) {
        const sweep = b.team / total * 360;
        const mineSweep = sweep * (b.mine / b.team);

        if (two) {
            parts.push(arcSeg(cx, cy, rings.in[0], rings.in[1], angle, angle + sweep,
                `pp-sb-band pp-sb-band--${b.tone}`, `${b.label}: ${fmt0(b.team)} ${b.unit}`));
            // etichetta di categoria DENTRO la fascia, come nel modello
            const midIn = angle + sweep / 2;
            const pIn = sbPoint(cx, cy, (rings.in[0] + rings.in[1]) / 2, midIn);
            labels.push(`<text x="${pIn.x.toFixed(1)}" y="${(pIn.y - 2).toFixed(1)}" class="pp-sb-band-lbl" text-anchor="middle">${b.label.split(' ')[0] === 'Through' ? 'Air' : 'Ground'}</text>
                <text x="${pIn.x.toFixed(1)}" y="${(pIn.y + 10).toFixed(1)}" class="pp-sb-band-val" text-anchor="middle">${fmt0(b.team)}</text>`);
        }

        // fetta del giocatore, poi il resto della squadra
        parts.push(arcSeg(cx, cy, rings.out[0], rings.out[1], angle, angle + mineSweep,
            `pp-sb-mine pp-sb-mine--${b.tone}`, `${playerName}: ${fmt0(b.mine)} ${b.unit} (${b.d.pct}%)`));
        parts.push(arcSeg(cx, cy, rings.out[0], rings.out[1], angle + mineSweep, angle + sweep,
            `pp-sb-rest pp-sb-rest--${b.tone}`, `Rest of the offense: ${fmt0(b.rest)} ${b.unit}`));

        // etichette dirette fuori dall'anello: nome sopra, valore in grassetto
        // sotto. La fetta del giocatore la etichetto solo se è visibile.
        if (mineSweep >= 12) {
            labels.push(sbLabel(cx, cy, rings.out[1] + 8, angle + mineSweep / 2, lastName(playerName), `${fmt0(b.mine)} ${b.unit}`, 'pp-sb-lbl--mine'));
        }
        if (sweep - mineSweep >= 12) {
            labels.push(sbLabel(cx, cy, rings.out[1] + 8, angle + mineSweep + (sweep - mineSweep) / 2, 'Rest of offense', `${fmt0(b.rest)} ${b.unit}`));
        }
        angle += sweep;
    }

    // Al centro le quote RESTANO SEPARATE, una riga per reparto: "20% dei
    // target" e "60% delle corse" dicono due cose diverse su come lo usa la
    // squadra, e sommarle in un unico numero (la opportunity share) le
    // nascondeva entrambe — un 39% che non si capiva da dove uscisse.
    // Il pallino colorato lega la riga al suo anello: così l'identità non è
    // affidata al solo colore del numero, e non serve una legenda.
    const centreRows = branches.map(b => ({
        pct: b.d.pct, unit: b.unit, tone: b.tone,
        title: `${fmt0(b.mine)} of ${fmt0(b.team)} ${b.unit} (${b.d.pct}%)`,
    }));
    const capWhat = two ? 'the offense'
        : (branches[0].key === 'rush' ? 'the running game' : 'the passing game');
    const gp = s.gp ? ` in his ${s.gp} games` : '';
    const snapLine = s.snapPct != null
        ? `On the field for <b>${s.snapPct}%</b> of the offensive snaps${s.snapPctPrev != null ? ` <span class="pp-sb-prev">(${s.snapPctPrev}% the year before)</span>` : ''}.`
        : '';

    // le righe si impilano centrate nel buco: una sola sta al centro esatto,
    // due si aprono simmetriche attorno ad esso
    const ROW_H = 40;
    const top = cy - ((centreRows.length - 1) * ROW_H) / 2;
    const centre = centreRows.map((r, i) => {
        const y = top + i * ROW_H;
        return `
        <text x="${cx}" y="${y.toFixed(1)}" class="pp-sb-centre-num" text-anchor="middle">${r.pct}%<title>${r.title}</title></text>
        <text x="${cx}" y="${(y + 13).toFixed(1)}" class="pp-sb-centre-lbl" text-anchor="middle"><tspan class="pp-sb-dot pp-sb-dot--${r.tone}">●</tspan> of ${r.unit}</text>`;
    }).join('');

    return `
    <figure class="pp-pe-fig pp-pe-fig--sb">
        <figcaption class="pp-pe-fig-cap">Share of ${capWhat}${gp}</figcaption>
        <svg viewBox="0 0 ${W} ${H}" class="pp-sb-svg" role="img"
             aria-label="Share of ${capWhat}${gp}: ${centreRows.map(r => r.title).join('; ')}">
            ${parts.join('')}
            ${centre}
            ${labels.join('')}
        </svg>
        ${snapLine ? `<div class="pp-sb-foot">${snapLine}</div>` : ''}
    </figure>`;
}

/** Punto sul cerchio: 0° = ore 12, in senso orario. */
function sbPoint(cx, cy, r, deg) {
    const rad = (deg - 90) * Math.PI / 180;
    return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

/** Settore di corona circolare (donut segment) da startDeg a endDeg. */
function arcSeg(cx, cy, rIn, rOut, startDeg, endDeg, cls, title) {
    if (endDeg - startDeg <= 0.05) return '';
    // 359.99 e non 360: un arco che torna al punto di partenza non viene reso
    const end = Math.min(endDeg, startDeg + 359.99);
    const large = end - startDeg > 180 ? 1 : 0;
    const a = sbPoint(cx, cy, rOut, startDeg), b = sbPoint(cx, cy, rOut, end);
    const c = sbPoint(cx, cy, rIn, end), d = sbPoint(cx, cy, rIn, startDeg);
    const p = (v) => v.toFixed(2);
    return `<path class="${cls}" d="M ${p(a.x)} ${p(a.y)} A ${rOut} ${rOut} 0 ${large} 1 ${p(b.x)} ${p(b.y)} L ${p(c.x)} ${p(c.y)} A ${rIn} ${rIn} 0 ${large} 0 ${p(d.x)} ${p(d.y)} Z"><title>${title}</title></path>`;
}

/** Etichetta diretta fuori dall'anello: nome sopra, valore in grassetto sotto. */
function sbLabel(cx, cy, r, deg, name, value, extraCls = '') {
    const p = sbPoint(cx, cy, r, deg);
    const right = p.x >= cx;
    const anchor = right ? 'start' : 'end';
    const x = (p.x + (right ? 4 : -4)).toFixed(1);
    return `
    <text x="${x}" y="${(p.y - 3).toFixed(1)}" class="pp-sb-lbl ${extraCls}" text-anchor="${anchor}">${name}</text>
    <text x="${x}" y="${(p.y + 9).toFixed(1)}" class="pp-sb-lbl-val ${extraCls}" text-anchor="${anchor}">${value}</text>`;
}

/* ═══════════════════════════ Draft Strategy ═══════════════════════════
 * VORP, drop-off, scarsità posizionale e piano per round sullo stesso
 * listone della Board — vedi js/data/draft-strategy.js per il calcolo.
 * Grafico prima, didascalia corta dopo (1-2 frasi, non un muro di testo):
 * verdetto → piano per round → forma della curva → dettaglio scarsità →
 * quanto pesa ogni reparto sul punteggio → K/DEF vs panchina → leaderboard.
 */

function renderStrategy() {
    const host = document.getElementById('pj-content');
    if (!host) return;
    const strategy = byPos ? computeStrategy(byPos) : null;
    if (!strategy) {
        host.innerHTML = `<div class="empty-state"><p class="empty-state-text">Not enough projected players for ${currentYear} to run this analysis.</p></div>`;
        return;
    }

    host.innerHTML = `
    <section class="mosaic-card mc-wide db-card mc-in">
        <span class="mc-kicker">${currentYear} preseason · VORP, this league's scoring and roster</span>
        <h2 class="mc-title">Where each position's value collapses</h2>
        <p class="dgt-card-sub">Ranked by <b>when</b> the drop between tiers hits, not how big it looks in points. A
            position with no cliff listed doesn't have one — it fades smoothly, which is its own answer.</p>
        <div class="dgt-strat">${priorityRows(strategy)}</div>
    </section>
    <section class="mosaic-card mc-wide db-card mc-in dgt-card">
        <span class="mc-kicker">Tier map · players who are worth the same</span>
        <h2 class="mc-title">The tiers, on one shared scale</h2>
        <p class="dgt-card-sub">Each block is a tier — players close enough in value that which one you get barely
            matters. <b>The empty space between blocks is what does matter</b>: that's the drop you eat by missing
            the tier above.</p>
        ${tierMapChart(strategy)}
    </section>
    <section class="mosaic-card mc-wide db-card mc-in dgt-card">
        <span class="mc-kicker">Tier timeline · when each tier empties out</span>
        <h2 class="mc-title">When to jump from one position to the next</h2>
        <p class="dgt-card-sub">The same tiers, placed where the market expects them to go. Read down a round to see
            what's still on the board everywhere at once.</p>
        ${tierTimelineChart(strategy)}
    </section>
    <section class="mosaic-card mc-wide db-card mc-in dgt-card">
        <span class="mc-kicker">VORP by positional rank · every likely pick, one chart</span>
        <h2 class="mc-title">Positional comparison</h2>
        <p class="dgt-card-sub">Rank 1 through as many as this league actually drafts at each position — starters
            plus bench. Below zero is bench value, taken anyway. One dot per real player, hover for the name.</p>
        ${vorpCurveChart(strategy)}
    </section>
    <section class="mosaic-card mc-wide db-card mc-in dgt-card">
        <span class="mc-kicker">Positional scarcity · same scale, all four roles</span>
        <h2 class="mc-title">Where each position runs out</h2>
        <p class="dgt-card-sub">Same pool as above, one bar per player. Dashed line is replacement; solid bars sit
            before the steepest drop, faded ones after.</p>
        <div class="dgt-sc-grid">${strategy.positions.map(p => scarcityPanel(p, strategy.maxVorp, strategy.minVorp)).join('')}</div>
    </section>
    <section class="mosaic-card mc-wide db-card mc-in dgt-card">
        <span class="mc-kicker">Lineup composition · where your points actually come from</span>
        <h2 class="mc-title">Points share of an average roster</h2>
        <p class="dgt-card-sub">A ${strategy.numTeams}-team team's starters, split by position — K and DEF included
            here on purpose: not a scarcity question, just what shows up on the scoreboard.</p>
        ${lineupShareChart(strategy)}
    </section>
    <section class="mosaic-card mc-wide db-card mc-in dgt-card">
        <span class="mc-kicker">Bench flyers vs. K/DEF · the late-round call</span>
        <h2 class="mc-title">Should you draft a bench player before a defense?</h2>
        <p class="dgt-card-sub">The spread between the best and worst left in each position's late tier. A wide gap
            means who you get still matters; a flat one means it doesn't — grab it last.</p>
        ${kdefCompareChart(strategy)}
    </section>
    <section class="mosaic-card mc-wide db-card mc-in dgt-card" id="pj-slot-card">
        <span class="mc-kicker">Simulated draft · ${strategy.numTeams}-team snake, all 16 rounds</span>
        <h2 class="mc-title">How the draft plays out from each slot</h2>
        <p class="dgt-card-sub">One draft, all sixteen rounds. <b>Optimal</b> has every team maximising its own
            lineup off the projections; <b>Realistic</b> has every team following the market. The draft itself does
            not change when you switch slot — only which row is framed as yours. Hover a square for the player and
            how often the simulation lands there.</p>
        ${slotAnalysis(strategy)}
    </section>
    <section class="mosaic-card mc-wide db-card mc-in dgt-card">
        <span class="mc-kicker">Cross-position · every role, one list</span>
        <h2 class="mc-title">Best value on the board, any position</h2>
        <p class="dgt-card-sub">Same VORP, sorted by value alone instead of by position — QB and TE rarely lead
            because this league only starts ${strategy.positions.find(p => p.pos === 'QB')?.needed ?? 4} and
            ${strategy.positions.find(p => p.pos === 'TE')?.needed ?? 4} of them leaguewide.</p>
        <div class="pj-lead-rows">${strategy.leaderboard.map((r, i) => leaderboardRow(r, i, strategy.maxVorp)).join('')}</div>
        <p class="db-foot">Top ${strategy.leaderboard.length} players above replacement across QB/RB/WR/TE. K and DEF
            are left out — see the note on the Board tab. Click a row for the player's card.</p>
    </section>`;

    bindSlotPills(strategy);
}

/**
 * Cambio di slot: si ridisegna SOLO il corpo di quella card, non tutta la
 * vista. Rifare l'innerHTML dell'intera sezione rieseguirebbe le animazioni
 * d'ingresso (`mc-in`) di sei card per un clic su una capsula.
 */
function bindSlotPills(strategy) {
    const card = document.getElementById('pj-slot-card');
    if (!card) return;
    const redraw = () => {
        // NB: deve coprire OGNI nodo prodotto da slotAnalysis, altrimenti il
        // vecchio board resta e il nuovo si accoda sotto.
        card.querySelectorAll('.pj-sim-controls, .pj-slot-seq, .an-scroll, .dgt-board-legend, .pj-sim-picks, .db-foot')
            .forEach(n => n.remove());
        card.insertAdjacentHTML('beforeend', slotAnalysis(strategy));
        bindSlotPills(strategy);
    };
    card.querySelector('#pj-slot-pills')?.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-slot]');
        if (!btn || Number(btn.dataset.slot) === slotSel) return;
        slotSel = Number(btn.dataset.slot);
        redraw();
    });
    card.querySelector('#pj-sim-modes')?.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-mode]');
        if (!btn || btn.dataset.mode === simMode) return;
        simMode = btn.dataset.mode;
        redraw();
    });
}

const fmtPerTeam = (v) => (Number.isInteger(v) ? String(v) : v.toFixed(1));

/** Le righe della card verdetto: riusa dgt-strat-*, già a schermo nei Draft Grades. */
function priorityRows(strategy) {
    const n = strategy.priority.length;
    return strategy.priority.map((p, i) => {
        const cls = i === 0 ? 'early' : i === n - 1 ? 'right' : 'even';
        const label = cls === 'early' ? 'Move early' : cls === 'right' ? 'Can wait' : 'Middling';
        const icon = cls === 'early' ? '▲' : cls === 'right' ? '=' : '·';
        const top = p.players[0];
        return `
        <div class="dgt-strat-row dgt-strat--${cls}">
            <span class="allpro-pos pos-${p.pos.toLowerCase()}">${p.pos}</span>
            <div class="dgt-strat-main">
                <span class="dgt-strat-head">${POS_NAME[p.pos]} <small>top: ${top.name} · ${Math.round(top.pts)} pts, +${top.vorp} VORP</small></span>
                <span class="dgt-strat-note">${priorityNote(p, strategy.numTeams)}</span>
            </div>
            <div class="dgt-strat-verdict">
                <span class="dgt-strat-icon" aria-hidden="true">${icon}</span>
                <span class="dgt-strat-label">${label}</span>
                <span class="dgt-strat-edge">${p.cliffAdp != null ? `ADP ${p.cliffAdp}` : 'no cliff'}</span>
            </div>
        </div>`;
    }).join('');
}

/**
 * Il crollo in una frase: QUANDO (ADP) prima di QUANTO (punti), e se il tier
 * sopra basta per tutti. Il secondo crollo, quando c'è, prende una frase sua:
 * dice una cosa diversa dal primo — non "corri a prenderne uno" ma "entro qui
 * devi averli tutti".
 */
function priorityNote(p, nTeams) {
    const t1 = p.tiers[0];
    if (p.cliffAt < 0) {
        return `No real cliff: the ${p.tiers.length} tiers step down gently, so the ${ordinal(t1.size + 1)}-best is never far from the ${ordinal(t1.size)}. Waiting costs little here.`;
    }
    const when = p.cliffAdp != null ? `, gone by pick ${p.cliffAdp}` : '';
    const race = p.contested
        ? `Only ${p.cliffAt} clear the top tier — fewer than the ${nTeams} teams drafting, so someone misses out.`
        : `The top ${p.cliffAt} are enough to go around${p.tight ? ', but only just' : ''}.`;
    const second = p.deepest
        ? ` It falls another ${p.deepest.drop} after the top ${p.deepest.at}${p.deepest.adp != null ? ` (pick ${p.deepest.adp})` : ''}${p.dryAtDemand ? ', right where the league runs out of starting spots' : ''}.`
        : '';
    return `${race} Value drops ${p.cliffDrop} after them${when}.${second}`;
}

/** Opacità per profondità di tier: T1 pieno, poi sempre più spento. */
const tierAlpha = (t) => Math.max(0.22, 1 - (t - 1) * 0.34);

/**
 * TIER MAP — la struttura del valore, tutti i ruoli sulla stessa scala.
 *
 * Un blocco per tier, alto quanto il suo intervallo di VORP. Il pezzo che
 * conta non è il blocco ma il VUOTO fra due blocchi: è il salto che si paga
 * arrivando tardi. Con l'asse Y condiviso i vuoti si confrontano fra ruoli a
 * occhio, che è tutto il punto ("il buco del RB è tre volte quello del WR").
 */
function tierMapChart(strategy) {
    const cols = strategy.positions;
    const W = 880, H = 380;
    const M = { l: 44, r: 16, t: 16, b: 34 };
    const plotW = W - M.l - M.r, plotH = H - M.t - M.b;
    const lo = Math.min(strategy.minVorp, 0), hi = strategy.maxVorp;
    const y = (v) => M.t + (1 - (v - lo) / ((hi - lo) || 1)) * plotH;
    const colW = plotW / cols.length;
    const boxW = Math.min(96, colW * 0.52);

    const ticks = niceTicksLocal(lo, hi);
    const grid = ticks.map(v => `
        <line x1="${M.l}" y1="${y(v).toFixed(1)}" x2="${(M.l + plotW).toFixed(1)}" y2="${y(v).toFixed(1)}" class="an-gridline"/>
        <text x="${M.l - 8}" y="${(y(v) + 3).toFixed(1)}" class="an-tick" text-anchor="end">${Math.round(v)}</text>`).join('');
    const zero = `<line x1="${M.l}" y1="${y(0).toFixed(1)}" x2="${(M.l + plotW).toFixed(1)}" y2="${y(0).toFixed(1)}"
        stroke="var(--text-muted)" stroke-width="1" stroke-dasharray="3 3" opacity="0.65"/>
        <text x="${(M.l + plotW - 2).toFixed(1)}" y="${(y(0) - 5).toFixed(1)}" text-anchor="end" class="an-tick">replacement</text>`;

    const body = cols.map((p, ci) => {
        const cx = M.l + ci * colW + colW / 2;
        const blocks = p.tiers.map(t => {
            const yTop = y(t.topVorp), yBot = y(t.bottomVorp);
            const h = Math.max(11, yBot - yTop);
            // un blocco sottile è informazione, non un difetto: vuol dire che
            // quei giocatori valgono praticamente uguale. Ma l'etichetta non ci
            // sta dentro, e allora va accanto.
            const wide = h >= 20;
            const label = `<text x="${(wide ? cx : cx - boxW / 2 - 6).toFixed(1)}" y="${(yTop + h / 2 + 4).toFixed(1)}"
                text-anchor="${wide ? 'middle' : 'end'}"
                style="font:800 ${wide ? 11 : 9.5}px var(--font-body,sans-serif);fill:${wide ? '#fff' : 'var(--text-muted)'};${wide ? 'paint-order:stroke;stroke:rgba(0,0,0,.5);stroke-width:2.5px' : ''}">T${t.tier}·${t.size}</text>`;
            return `<g>
                <title>${p.pos} tier ${t.tier}: ${t.size} players (${p.pos}${t.fromRank}-${t.toRank}) · VORP ${t.topVorp} to ${t.bottomVorp} · ADP ${t.adpFirst ?? '?'}-${t.adpLast ?? '?'}\n${t.names.slice(0, 4).join(', ')}${t.names.length > 4 ? '…' : ''}</title>
                <rect x="${(cx - boxW / 2).toFixed(1)}" y="${yTop.toFixed(1)}" width="${boxW.toFixed(1)}" height="${h.toFixed(1)}"
                      rx="4" fill="${POSITION_COLORS[p.pos]}" opacity="${tierAlpha(t.tier)}"/>
                ${label}</g>`;
        }).join('');

        /**
         * Il salto: quota il VUOTO, non il blocco. Ma solo DUE, non tutti
         * quelli materiali: da quando ogni salto materiale è un confine di
         * tier, il TE 2026 ne ha quattro e le etichette rosse si impilavano
         * fino a sovrapporsi. Restano i due di cui parla anche il testo — il
         * primo (quello su cui decidi ora) e il più profondo — e gli altri
         * restano visibili come vuoti, che è il punto del grafico.
         */
        const shown = [p.cliffAt, p.deepest?.at].filter(v => v != null && v > 0);
        const gaps = p.tiers.filter(t => t.material && shown.includes(t.toRank)).map(t => {
            const yA = y(t.bottomVorp), yB = y(p.tiers[t.tier].topVorp); // tier è 1-based: [t.tier] è il successivo
            const mid = (yA + yB) / 2;
            return `<g>
                <line x1="${(cx + boxW / 2 + 5).toFixed(1)}" y1="${yA.toFixed(1)}" x2="${(cx + boxW / 2 + 5).toFixed(1)}" y2="${yB.toFixed(1)}"
                      stroke="var(--accent-red, #ff453a)" stroke-width="1.4"/>
                <text x="${(cx + boxW / 2 + 10).toFixed(1)}" y="${(mid + 4).toFixed(1)}" class="dgt-sc-callout">−${t.dropNext}</text></g>`;
        }).join('');

        return `${blocks}${gaps}
            <text x="${cx.toFixed(1)}" y="${(H - 12).toFixed(1)}" text-anchor="middle"
                  style="font:800 12px var(--font-display,sans-serif);fill:${POSITION_COLORS[p.pos]}">${p.pos}</text>`;
    }).join('');

    return `<div class="an-scroll"><svg viewBox="0 0 ${W} ${H}" class="an-svg an-svg--wide" role="img"
        aria-label="Value tiers by position on a shared VORP scale">${grid}${zero}${body}</svg></div>`;
}

/** niceTicks locale: charts.js la esporta ma qui serve anche sul negativo. */
function niceTicksLocal(min, max, count = 5) {
    const span = (max - min) || 1;
    const step = Math.pow(10, Math.floor(Math.log10(span / count)));
    const err = span / count / step;
    const mult = err >= 7.5 ? 10 : err >= 3.5 ? 5 : err >= 1.5 ? 2 : 1;
    const s = mult * step;
    const out = [];
    for (let v = Math.floor(min / s) * s; v <= Math.ceil(max / s) * s + 1e-9; v += s) out.push(v);
    return out;
}

/**
 * TIER TIMELINE — gli stessi tier, ma collocati nel tempo del draft.
 *
 * Sostituisce il vecchio "Draft Plan" a due bande, che conosceva un solo
 * cliff per ruolo e quindi disegnava il crollo del RB dopo RB2 invece che
 * dopo RB11. Qui ogni tier è un segmento fra il suo primo e il suo ultimo
 * ADP: leggendo una colonna in verticale si vede cosa è ancora sul board
 * ovunque a quel giro, che è la domanda vera.
 */
function tierTimelineChart(strategy) {
    const rows = strategy.priority;
    const W = 880;
    const M = { l: 44, r: 16, t: 10, b: 30 };
    const rowH = 52, barH = 22;
    const H = M.t + rows.length * rowH + M.b;
    const plotW = W - M.l - M.r;
    const rMax = strategy.roundMax;
    const x = (round) => M.l + ((Math.max(1, Math.min(rMax, round)) - 1) / (rMax - 1)) * plotW;

    const ticks = [1, 2, 4, 6, 8, 10, 12, 14, 16].filter(r => r <= rMax);
    const grid = ticks.map(r => `
        <line x1="${x(r).toFixed(1)}" y1="${M.t}" x2="${x(r).toFixed(1)}" y2="${(H - M.b).toFixed(1)}" class="an-gridline"/>
        <text x="${x(r).toFixed(1)}" y="${H - 10}" class="an-tick" text-anchor="middle">R${r}</text>`).join('');

    const body = rows.map((p, i) => {
        const yc = M.t + i * rowH + rowH / 2;
        const color = POSITION_COLORS[p.pos];
        const segs = p.tiers.filter(t => t.adpFirst != null).map(t => {
            const x1 = x(roundOf(t.adpFirst));
            const x2 = x(roundOf(t.adpLast));
            const w = Math.max(6, x2 - x1);
            const inside = w >= 30
                ? `<text x="${(x1 + w / 2).toFixed(1)}" y="${(yc + 4).toFixed(1)}" text-anchor="middle"
                     style="font:800 10.5px var(--font-body,sans-serif);fill:#fff;paint-order:stroke;stroke:rgba(0,0,0,.5);stroke-width:2.5px">T${t.tier}</text>` : '';
            return `<g>
                <title>${p.pos} tier ${t.tier} · ${t.size} players · ADP ${t.adpFirst}-${t.adpLast} (rounds ${roundOf(t.adpFirst)}-${roundOf(t.adpLast)}) · VORP ${t.topVorp} to ${t.bottomVorp}</title>
                <rect x="${x1.toFixed(1)}" y="${(yc - barH / 2).toFixed(1)}" width="${w.toFixed(1)}" height="${barH}"
                      rx="3" fill="${color}" opacity="${tierAlpha(t.tier)}"/>${inside}</g>`;
        }).join('');

        // la linea rossa dove il ruolo crolla: l'unica annotazione della riga
        const cliff = p.cliffAdp != null ? (() => {
            const cx = x(roundOf(p.cliffAdp));
            const end = cx > W * 0.66;
            return `<line x1="${cx.toFixed(1)}" y1="${(yc - rowH / 2 + 4).toFixed(1)}" x2="${cx.toFixed(1)}" y2="${(yc + rowH / 2 - 4).toFixed(1)}" class="dgt-sc-cliff"/>
                <text x="${(cx + (end ? -6 : 6)).toFixed(1)}" y="${(yc - barH / 2 - 5).toFixed(1)}" text-anchor="${end ? 'end' : 'start'}" class="dgt-sc-callout">−${p.cliffDrop}</text>`;
        })()
            // senza cliff l'etichetta va CENTRATA sulla riga: messa sopra la barra
            // finiva a metà strada fra due ruoli e sembrava riferita a quello sopra
            : `<text x="${(M.l + plotW).toFixed(1)}" y="${(yc + 4).toFixed(1)}" text-anchor="end" class="an-callout">no cliff</text>`;

        return `<g>
            <text x="${(M.l - 10).toFixed(1)}" y="${(yc + 4).toFixed(1)}" text-anchor="end"
                  style="font:800 12px var(--font-display,sans-serif);fill:${color}">${p.pos}</text>
            ${segs}${cliff}</g>`;
    }).join('');

    return `<div class="an-scroll"><svg viewBox="0 0 ${W} ${H}" class="an-svg an-svg--wide" role="img"
        aria-label="Tier timeline by draft round for each position">${grid}${body}</svg></div>`;
}

// quattro tinte + due neutri per la coda (K/DEF): vedi la nota in draft-strategy.js
const ALL_POS_COLORS = { ...POSITION_COLORS, ...TAIL_COLORS };

/**
 * IL BOARD SIMULATO — stessa forma di "The whole board" nei Draft Grades:
 * una riga per squadra, una colonna per giro, un quadrato colorato per ruolo,
 * la tua riga incorniciata. Lì il board è quello VERO di una stagione passata;
 * qui è simulato dalle proiezioni, ed è l'unica differenza.
 *
 * Sotto, le tue pick in chiaro: giocatore, tier, VORP e quanto spesso la
 * simulazione ci arriva davvero.
 */
function slotAnalysis(strategy) {
    const sim = simulateDraft(strategy.simPool, slotSel, simMode);
    const modes = [['optimal', 'Optimal'], ['realistic', 'Realistic']].map(([m, label]) => `
        <button class="db-sort-btn${m === simMode ? ' active' : ''}" data-mode="${m}">${label}</button>`).join('');
    const pills = [1, 2, 3, 4].map(s => `
        <button class="db-sort-btn${s === slotSel ? ' active' : ''}" data-slot="${s}">Pick ${s}</button>`).join('');
    const head = `<div class="pj-sim-controls">
        <div class="db-sort" id="pj-sim-modes" role="group" aria-label="Simulation mode">${modes}</div>
        <div class="db-sort pj-slot-pills" id="pj-slot-pills" role="group" aria-label="Draft slot">${pills}</div>
    </div>`;
    if (!sim) return `${head}<p class="db-foot">Not enough projected players to simulate this draft.</p>`;

    const rMax = strategy.roundMax;
    const SQ = 36, GAP = 5, LABEL = 108, PAD = 6, HEAD = 22;
    const gridLeft = PAD + LABEL;
    const plotW = rMax * SQ + (rMax - 1) * GAP;
    const gridTop = HEAD + 8;
    const W = gridLeft + plotW + PAD;
    const H = gridTop + sim.board.length * SQ + (sim.board.length - 1) * GAP + 10;
    const colX = (r) => gridLeft + (r - 1) * (SQ + GAP);
    const rowY = (i) => gridTop + i * (SQ + GAP);

    /**
     * Righe in ordine FISSO di slot (1→4). Prima la riga scelta veniva
     * spostata in fondo e a ogni cambio di capsula tutto il board saltava:
     * impossibile confrontare due posizioni. Ora si sposta solo
     * l'evidenziazione.
     */
    const header = Array.from({ length: rMax }, (_, i) => `
        <text x="${(colX(i + 1) + SQ / 2).toFixed(1)}" y="${HEAD - 6}" text-anchor="middle" class="dgt-lb-round">R${i + 1}</text>`).join('');

    const mineIdx = sim.board.findIndex(b => b.mine);
    const band = `<rect x="${(gridLeft - 4).toFixed(1)}" y="${(rowY(mineIdx) - 4).toFixed(1)}"
        width="${(plotW + 8).toFixed(1)}" height="${SQ + 8}" rx="10" fill="var(--text-primary)" fill-opacity="0.08"/>`;

    const cells = sim.board.map((b, ri) => {
        const mine = b.mine;
        // a sinistra: chi e, e quanto vale la rosa che esce da quel draft —
        // punti PROIETTATI, divisi fra chi scende in campo e chi resta fuori
        const lx = (PAD + LABEL - 12).toFixed(1);
        const label = `
            <text x="${lx}" y="${(rowY(ri) + SQ / 2 - 3).toFixed(1)}" text-anchor="end"
                class="dgt-lb-team${mine ? ' dgt-lb-team--mine' : ''}"
                fill="${mine ? 'var(--text-primary)' : 'var(--text-secondary)'}">Pick ${b.slot}</text>
            <text x="${lx}" y="${(rowY(ri) + SQ / 2 + 11).toFixed(1)}" text-anchor="end" class="pj-sim-pts">
                ${b.points.starters} <tspan class="pj-sim-pts-bn">+${b.points.bench} bn</tspan></text>`;
        const sq = b.rounds.map(r => {
            if (!r.pos) return '';
            const x = colX(r.round), y = rowY(ri);
            const color = ALL_POS_COLORS[r.pos] || 'var(--text-muted)';
            const who = r.name ? `\n${r.name} — still there ${r.namePct}% of runs` : '';
            // il numero assoluto del pick DENTRO la casella: senza, con lo
            // snake non si capiva in che ordine si erano succedute le scelte
            return `
            <rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${SQ}" height="${SQ}" rx="7"
                fill="${color}" fill-opacity="${mine ? 1 : 0.55}"
                stroke="${mine ? 'var(--text-primary)' : 'none'}" stroke-width="${mine ? 1.3 : 0}">
                <title>Pick #${r.pick} (round ${r.round}, slot ${b.slot}) · ${r.pos}${who}</title>
            </rect>
            <text x="${(x + SQ / 2).toFixed(1)}" y="${(y + SQ / 2 + 1).toFixed(1)}" text-anchor="middle" class="dgt-lb-pos">${r.pos}</text>
            <text x="${(x + SQ / 2).toFixed(1)}" y="${(y + SQ - 4).toFixed(1)}" text-anchor="middle" class="pj-sim-no">${r.pick}</text>`;
        }).join('');
        return label + sq;
    }).join('');

    const mineRow = sim.board[mineIdx];
    const picks = mineRow.rounds.map(r => `
        <div class="pj-sim-pick">
            <span class="pj-sim-rd">#${r.pick}<small>R${r.round}</small></span>
            <span class="allpro-pos pos-${(r.pos || '').toLowerCase()}">${r.pos || '—'}</span>
            <span class="pj-sim-name" title="${r.name || ''}">${r.name ? lastName(r.name) : '—'}${r.tier ? `<small> · T${r.tier}</small>` : ''}</span>
            <span class="pj-sim-pct" title="how often this exact player is still there at this pick">${r.namePct}%</span>
            <span class="pj-sim-vorp">${r.vorp != null ? (r.vorp >= 0 ? '+' : '') + r.vorp : ''}</span>
        </div>`).join('');

    // legenda con i colori di QUESTO grafico: i badge .pos-* del sito hanno
    // la palette accesa di sempre e accanto al board sembrerebbero altri ruoli
    const legend = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF']
        .map(p => `<span class="pj-sim-key"><i style="background:${ALL_POS_COLORS[p]}"></i>${p}</span>`).join('');

    const sv = sim.starterVorp;
    const note = simMode === 'optimal'
        ? `All four teams maximise their own lineup off the same projections, so this is what a perfectly played
           draft would look like — a benchmark, not a forecast.`
        : `All four teams follow the opponent model the Draft Grades are graded against — consensus ADP nudged by
           roster need — so this is the likely shape of a real draft.`;

    return `${head}
    <p class="pj-slot-seq"><b>${mineRow.rounds.slice(0, 7).map(r => r.pos).join(' → ')}</b>
        <span>starters worth ${sv.median} pts above replacement (${sv.low} to ${sv.high} across ${sim.runs} runs)</span></p>
    <div class="an-scroll"><svg viewBox="0 0 ${W} ${H}" class="an-svg an-svg--wide" role="img"
        aria-label="Simulated draft board, ${sim.runs} runs">${band}${header}${cells}</svg></div>
    <div class="dgt-board-legend">${legend}</div>
    <div class="pj-sim-picks">${picks}</div>
    <p class="db-foot">${note} Squares are numbered by absolute pick, so you can follow the snake straight through.
        ${sim.runs} runs; the percentage is how often that exact player is still on the board at that pick.</p>`;
}

/**
 * Quota di punti per reparto su una formazione media: una sola barra
 * orizzontale, un segmento per ruolo, larghezza = percentuale. Include K/DEF
 * (vedi la nota in draft-strategy.js) — qui non contano quanto sono scarsi,
 * solo quanti punti veri mettono a referto.
 */
function lineupShareChart(strategy) {
    const rows = strategy.lineupShare;
    if (!rows.length) return '';
    const segs = rows.map(r => {
        const color = ALL_POS_COLORS[r.pos] || 'var(--text-muted)';
        return `<div class="pj-share-seg" style="width:${r.pct}%;background:${color}"
            title="${r.pos} · ${r.teamPts} pts/team · ${r.pct}%">${r.pct >= 7 ? `<span>${r.pos} ${r.pct}%</span>` : ''}</div>`;
    }).join('');
    // legenda sotto: i segmenti piccoli (K/DEF) non hanno spazio per il testo
    // dentro la barra, ma l'identità non può restare solo nel colore
    const legend = rows.map(r => `
        <span class="pj-share-key"><span class="allpro-pos pos-${r.pos.toLowerCase()}">${r.pos}</span> ${r.pct}%</span>`).join('');
    return `<div class="pj-share-bar">${segs}</div><div class="pj-share-legend">${legend}</div>`;
}

/**
 * "Panchinari o K/DEF, cosa prendo per ultimo?" — dumbbell (riuso diretto da
 * charts.js): per ogni riga, il migliore e il peggiore rimasti nella fascia
 * finale di quel ruolo. Uno scarto largo dice che scegliere conta ancora;
 * uno scarto minuscolo (tipico di K/DEF) dice che è indifferente — si
 * riempie per ultimo, senza pensarci.
 */
function kdefCompareChart(strategy) {
    const rows = strategy.kdefCompare;
    if (!rows.length) return '';
    const data = rows.map(r => ({
        label: r.pos === 'K' || r.pos === 'DEF' ? r.pos : `${r.pos} bench`,
        a: r.a, b: r.b,
        tip: `${r.pos === 'K' || r.pos === 'DEF' ? r.pos : `${r.pos} bench tail`} · spread ${r.span} pt`,
    }));
    return dumbbell(data, {
        a: { name: 'Best left in the tier', color: 'var(--accent-green, #30d158)' },
        b: { name: 'Worst left in the tier', color: 'var(--text-muted, #8a8a8e)' },
        fmt: (v) => String(Math.round(v)), // il segno del DELTA lo mette già dumbbell (evita il "++")
    });
}

/**
 * Il confronto cross-ruolo richiesto: VORP sulle Y, posizione in classifica di
 * ruolo sulle X, le quattro curve sugli stessi assi.
 *
 * Linea, non scatter: con 4 ruoli uno scatter sfora il tetto delle forme
 * "a coppie" (bubble/scatter reggono fino a 3 serie leggibili, una linea
 * arriva fino a 4 con le etichette dirette — vedi la skill dataviz del
 * sito). La linea porta comunque la forma che conta qui (il crollo), i
 * pallini (`opts.points`) restano a mostrare il singolo giocatore.
 *
 * Riusa multiLine di js/ui/charts.js (stesso componente del Live e di
 * Analysis) invece di un SVG a sé — è già lo stile del sito per le linee con
 * etichetta a fine serie; `points`/`tip` sono l'aggiunta fatta apposta per
 * questo caso (un asse X di voci reali, non di tempo continuo).
 */
function vorpCurveChart(strategy) {
    const maxLen = Math.max(...strategy.positions.map(p => p.players.length));
    const series = strategy.positions.map(p => ({
        name: p.pos,
        color: POSITION_COLORS[p.pos],
        values: p.players.map((pl, i) => ({
            x: i + 1, y: pl.vorp,
            tip: `${p.pos}${i + 1} ${pl.name}${pl.team ? ` (${pl.team})` : ''} · ${Math.round(pl.pts)} pts · ${pl.vorp >= 0 ? '+' : ''}${pl.vorp} VORP`,
        })),
    }));
    const xTicks = Array.from({ length: maxLen }, (_, i) => ({ x: i + 1, label: String(i + 1) }));
    return multiLine(series, { height: 300, xTicks, xMinGap: 26, points: true, yFmt: (v) => String(Math.round(v)) });
}

/**
 * Pannello di scarsità per un ruolo: stessa forma di scarcityCard in
 * draftgrade-team.js (dgt-sc-*), ma senza una squadra a cui appartenere —
 * qui il colore pieno segna "prima del crollo", spento "dopo, ma sopra il
 * replacement lo stesso" invece di "mio/altrui". `maxVorp`/`minVorp` sono
 * condivisi fra tutti e quattro i pannelli (vedi renderStrategy): è quello
 * che rende le altezze confrontabili a occhio.
 *
 * La baseline non è più il fondo del grafico: è lo ZERO (il replacement).
 * Da computeStrategy in poi i giocatori includono anche la panchina attesa
 * (VORP negativo), quindi le barre scendono sotto quella linea tratteggiata
 * invece di sparire — è lì che si vede quanto la panchina di un ruolo vale
 * meno di quella di un altro.
 */
function scarcityPanel(p, maxVorp, minVorp) {
    const { pos, players, cliffAt, cliffDrop } = p;
    const W = 300, H = 224, L = 8, R = 8, T = 16, B = 30;
    const iw = W - L - R, ih = H - T - B;
    const step = iw / players.length;
    const span = (maxVorp - minVorp) || 1;
    const y = (v) => T + ih - ((v - minVorp) / span) * ih;
    const y0 = y(0);
    const meaningful = cliffAt > 0;

    const bars = players.map((pl, i) => {
        const before = !meaningful || i < cliffAt;
        const cls = before ? 'dgt-sc-mine' : 'dgt-sc-free';
        const x = L + i * step, w = Math.max(2, step - 3);
        const yv = y(pl.vorp);
        const top = Math.min(y0, yv), h = Math.max(1, Math.abs(y0 - yv));
        const taken = pl.pick ? ` · taken #${pl.pick.pick}` : '';
        return `<rect class="dgt-sc-bar ${cls}" x="${x.toFixed(1)}" y="${top.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="1.5"
            ${before ? `style="fill:${POSITION_COLORS[pos]}"` : ''}><title>${pl.name}${pl.team ? ` (${pl.team})` : ''} · ${Math.round(pl.pts)} pts · ${pl.vorp >= 0 ? '+' : ''}${pl.vorp} VORP${taken}</title></rect>`;
    }).join('');

    const cliffMark = meaningful ? (() => {
        const x = L + cliffAt * step - 1.5;
        return `
        <line class="dgt-sc-cliff" x1="${x.toFixed(1)}" y1="${T - 4}" x2="${x.toFixed(1)}" y2="${T + ih}"/>
        <text class="dgt-sc-callout" x="${Math.min(x + 5, W - R - 4).toFixed(1)}" y="${(T + 6).toFixed(1)}" text-anchor="${x > W * 0.55 ? 'end' : 'start'}"
              ${x > W * 0.55 ? `transform="translate(-10,0)"` : ''}>−${cliffDrop} pt</text>`;
    })() : '';

    const label = (i, anchor) => {
        const p = players[i]; if (!p) return '';
        const x = L + i * step + (anchor === 'end' ? step - 3 : 0);
        return `<text class="dgt-sc-name" x="${x.toFixed(1)}" y="${(T + ih + 12).toFixed(1)}" text-anchor="${anchor}">${p.name.split(' ').slice(-1)[0]}</text>`;
    };

    return `
    <figure class="dgt-sc-panel">
        <figcaption><b>${pos}</b> <span>${meaningful ? `cliff after ${pos}${cliffAt}` : 'no clear cliff'}</span></figcaption>
        <svg viewBox="0 0 ${W} ${H}" class="dgt-sc-svg" role="img"
             aria-label="${pos} value above replacement across the likely draft pool${meaningful ? `, with the tier cliff after player ${cliffAt}` : ''}">
            <line class="dgt-sc-base" x1="${L}" y1="${T + ih}" x2="${L + step * players.length}" y2="${T + ih}"/>
            <line x1="${L}" y1="${y0.toFixed(1)}" x2="${(L + step * players.length).toFixed(1)}" y2="${y0.toFixed(1)}"
                  stroke="var(--text-muted)" stroke-width="1" stroke-dasharray="2 2" opacity="0.6"/>
            <text x="${(L + step * players.length - 2).toFixed(1)}" y="${(y0 - 3).toFixed(1)}" text-anchor="end"
                  style="font:600 9px var(--font-body, sans-serif); fill:var(--text-muted)">replacement</text>
            ${bars}
            ${cliffMark}
            ${label(0, 'start')}
            ${meaningful && cliffAt < players.length && cliffAt * step >= 46 ? label(cliffAt, 'start') : ''}
        </svg>
        <p class="dgt-sc-note">${scarcityNote(p)}</p>
    </figure>`;
}

/**
 * Due numeri onesti: quanti se ne draftano davvero (starter + panchina
 * attesa, la profondità di computeStrategy) e dove, dentro quel gruppo,
 * cade il crollo più netto.
 */
function scarcityNote({ needed, players, cliffAt }) {
    const above = players.filter(pl => pl.vorp > 0).length;
    const base = `${players.length} likely picks at this position (${needed} starters, the rest bench) — ${above} clear replacement value.`;
    if (cliffAt < 0) return `${base} No single cliff — value declines evenly across them.`;
    return `${base} The steepest drop comes right after the top ${cliffAt}.`;
}

/** Riga della leaderboard cross-ruolo: barra colorata per posizione, badge, valore. */
function leaderboardRow(r, i, maxVorp) {
    const w = Math.max(2, Math.round(r.vorp / maxVorp * 100));
    return `
    <div class="pj-lead-row" style="--pos-color:${POSITION_COLORS[r.pos]}"
         data-player-modal data-player-name="${r.name}" data-pos="${r.pos}" data-nfl="${r.team || ''}" data-year="${currentYear}"
         title="${r.name}${r.team ? ` (${r.team})` : ''} · ${Math.round(r.pts)} pts · +${r.vorp} VORP${r.pick ? ` · taken #${r.pick.pick}` : ' · undrafted'}">
        <span class="pj-lead-rank">${i + 1}</span>
        <span class="allpro-pos pos-${r.pos.toLowerCase()}">${r.pos}</span>
        <span class="pj-lead-name">${r.name}<small>${r.team ? ` · ${r.team}` : ''}</small></span>
        <span class="pj-lead-bar"><span style="width:${w}%"></span></span>
        <span class="pj-lead-val">+${r.vorp}</span>
    </div>`;
}
