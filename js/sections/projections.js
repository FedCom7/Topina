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

import { fetchDraftData, flattenDraft, displayName, SEASONS, CURRENT_SEASON } from '../data.js?v=538';
import { TEAM_KEYS } from '../data/team-config.js?v=533';
import { TEAMS } from './team.js?v=608';
import { initPlayerModal } from '../components/player-modal.js?v=613';
import { getSeasonProjections, getSeasonStats, matchProjection, normName } from '../data/projections.js?v=594';

const POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];
const TOP_N = 40;

let loaded = false;
let currentYear = null;
let currentPos = 'RB';
let byPos = null;      // { POS: [ {name, team, pts, adp, pick, real, gp} ] }
let seasonDone = false;  // stagione conclusa → si mostrano i punti veri
let sortBy = 'proj';     // 'proj' | 'real' — solo a stagione conclusa

export async function initProjections() {
    if (loaded) return;
    loaded = true;
    initPlayerModal();
    renderYearSelector();
    await loadYear(CURRENT_SEASON);
}

function renderYearSelector() {
    const el = document.getElementById('pj-year-selector');
    if (!el) return;
    el.innerHTML = SEASONS.map(y =>
        `<button class="year-pill${y === CURRENT_SEASON ? ' active' : ''}" data-year="${y}">${y}</button>`).join('');
    el.addEventListener('click', async (e) => {
        const btn = e.target.closest('.year-pill');
        if (!btn) return;
        el.querySelectorAll('.year-pill').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        await loadYear(btn.dataset.year);
    });
}

function renderPosSelector() {
    const el = document.getElementById('pj-pos-selector');
    if (!el) return;
    el.innerHTML = POSITIONS.filter(p => byPos?.[p]?.length).map(p =>
        `<button class="round-pill${p === currentPos ? ' active' : ''}" data-pos="${p}">${p}</button>`).join('');
    if (el.dataset.bound) return;
    el.dataset.bound = '1';
    el.addEventListener('click', (e) => {
        const btn = e.target.closest('.round-pill');
        if (!btn) return;
        el.querySelectorAll('.round-pill').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentPos = btn.dataset.pos;
        renderList();
    });
}

async function loadYear(year) {
    currentYear = year;
    const host = document.getElementById('pj-content');
    host.innerHTML = `<div class="loading-state"><div class="spinner"></div><p>Loading ${year} projections...</p></div>`;

    let proj;
    try {
        proj = await getSeasonProjections(year);
    } catch {
        host.innerHTML = `<div class="empty-state"><p class="empty-state-text">Projections for ${year} are not available</p></div>`;
        document.getElementById('pj-pos-selector').innerHTML = '';
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
        });
    }
    // senza proiezione (i kicker) si ordina per ADP, l'unico segnale rimasto
    for (const pos of POSITIONS) {
        (byPos[pos] || []).sort((a, b) => (b.pts ?? -1) - (a.pts ?? -1) || (a.adp ?? 999) - (b.adp ?? 999));
    }
    if (!POSITIONS.some(p => byPos[p]?.length)) {
        host.innerHTML = `<div class="empty-state"><p class="empty-state-text">No projections for ${year}</p></div>`;
        return;
    }
    if (!byPos[currentPos]?.length) currentPos = POSITIONS.find(p => byPos[p]?.length);

    renderPosSelector();
    renderList();
}

function renderList() {
    const host = document.getElementById('pj-content');
    if (!host || !byPos) return;
    const all = byPos[currentPos] || [];
    const byReal = seasonDone && sortBy === 'real';

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
            ${seasonDone ? realCell(r) : ''}
        </div>`;
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
            : ''} Click a row for the player's card.</p>
    </section>`;

    document.getElementById('db-sort')?.addEventListener('click', (e) => {
        const btn = e.target.closest('.db-sort-btn');
        if (!btn || btn.dataset.sort === sortBy) return;
        sortBy = btn.dataset.sort;
        renderList();
    });
}

/**
 * Cella "com'è andata poi": punti veri, scarto dalla proiezione e, quando lo
 * scarto è grosso, l'etichetta. Le soglie sono le stesse di outcomeBadge nei
 * Draft Grades (+35% / −45%) così una "rivelazione" qui è la stessa cosa che
 * là: un solo metro in tutto il sito.
 * Senza proiezione (i kicker) non c'è scarto da mostrare, solo il totale.
 */
function realCell(r) {
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
    // ordine di lettura: badge, scarto, punti — il totale vero resta all'estrema
    // destra, in colonna con gli altri numeri della riga
    return `<span class="db-real">${tag}<em class="db-delta ${cls}">${delta >= 0 ? '+' : ''}${delta}</em><b>${real}</b></span>`;
}
