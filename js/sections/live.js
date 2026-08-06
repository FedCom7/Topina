/**
 * Live Matchup Center — Fase 1 (layout + dati reali, senza motore eventi).
 * Route: #live
 *
 * Fonte dati primaria: il Cloudflare Worker ESPN live (worker/espn-live-proxy.js
 * → normalizeWeek), stessa shape di fantasy_data (team1/team2/starters/bench).
 * Finché il worker non è pubblicato (`wrangler deploy`) NON si inventano dati:
 * si mostra l'ultima settimana reale disponibile su Firebase con un'etichetta
 * esplicita "non è live", mai un finto punteggio.
 *
 * Fase 2 (successiva): motore eventi a delta, animazioni per giocata,
 * scontrini, timeline, notifiche — vedi piano di sessione.
 */

import { fetchFantasyData, displayName, teamNameHTML, CURRENT_SEASON, getSeasonConfig } from '../data.js?v=33';
import { TEAM_KEYS } from '../data/team-config.js?v=31';
import { TEAMS } from './team.js?v=25';
import { getWeekSchedule, canonAbbr } from '../data/nfl-schedule.js?v=11';
import { slotPairs } from '../data/matchup-analysis.js?v=13';
import { initPlayerModal } from '../components/player-modal.js?v=26';
import { playerImageService } from '../services/player-image-service.js?v=15';

// Da valorizzare dopo `wrangler deploy` (worker/espn-live-proxy.js), es.
// 'https://topina-espn-live-proxy.<account>.workers.dev'.
/**
 * URL del Cloudflare Worker live (worker/espn-live-proxy.js). Si imposta in
 * index.html senza toccare questo file:
 *   <script>window.TOPINA_LIVE_WORKER_URL = 'https://....workers.dev';</script>
 * Se non è impostato la pagina ripiega sull'ultima settimana reale di Firebase.
 */
const liveWorkerUrl = () => (typeof window !== 'undefined' && window.TOPINA_LIVE_WORKER_URL) || '';
const POLL_MS = 10000;

/** Etichette leggibili + segno atteso per ogni statistica tracciata. */
const STAT_LABELS = {
    pass_yds: 'Pass yds', pass_td: 'Passing TD', pass_int: 'Interception',
    pass_att: 'Pass attempts', pass_comp: 'Completions',
    rush_yds: 'Rush yds', rush_td: 'Rushing TD', rush_att: 'Carries',
    rec: 'Reception', rec_yds: 'Rec yds', rec_td: 'Receiving TD', targets: 'Target',
    ret_td: 'Return TD', fum_td: 'Fumble TD', two_pt: '2-PT', fum_lost: 'Fumble lost',
    pat_made: 'Extra point', fg_made: 'Field goal', fg_att: 'FG attempt',
    fg_0_39: 'FG 0-39', fg_40_49: 'FG 40-49', fg_50_plus: 'FG 50+',
    sack: 'Sack', def_int: 'DEF interception', fum_rec: 'Fumble recovery',
    safety: 'Safety', def_td: 'DEF TD', def_2pt_ret: 'DEF 2-PT return',
    def_ret_td: 'DEF return TD', pts_allowed: 'Points allowed', yds_allowed: 'Yards allowed',
};

/**
 * Statistiche mostrate sulla card: sempre 6 per ruolo (griglia 2×3), così tutti
 * i riquadri hanno la stessa dimensione e i valori a 0 diventano un trattino.
 * Le chiavi sono quelle reali dei dati 2026+ (fg_made/fg_att sono già forniti,
 * non vanno più ricalcolati sommando le fasce di distanza).
 */
const STATS_BY_ROLE = {
    QB: ['pass_comp', 'pass_att', 'pass_yds', 'pass_td', 'pass_int', 'rush_yds'],
    RB: ['rush_att', 'rush_yds', 'rush_td', 'targets', 'rec', 'rec_yds'],
    WR: ['targets', 'rec', 'rec_yds', 'rec_td', 'rush_yds', 'rush_td'],
    TE: ['targets', 'rec', 'rec_yds', 'rec_td', 'rush_yds', 'rush_td'],
    K: ['pat_made', 'fg_made', 'fg_att', 'fg_0_39', 'fg_40_49', 'fg_50_plus'],
    DEF: ['sack', 'def_int', 'fum_rec', 'def_td', 'pts_allowed', 'yds_allowed'],
};

/** Eventi "grossi": meritano evidenza nello scontrino. */
const BIG_EVENTS = new Set(['pass_td', 'rush_td', 'rec_td', 'ret_td', 'fum_td', 'def_td', 'def_ret_td',
    'pass_int', 'fum_lost', 'safety', 'fg_50_plus']);

let prevSnapshot = null;   // { playerName: { pts, stats } }
let receipts = [];         // storico scontrini (più recenti in testa)
let compareMode = false;   // false = campo, true = confronto titolari
let slideFrom = null;      // 'right' | 'left': direzione di entrata dopo uno swap

let loaded = false;
let pollTimer = null;
let matchups = [];
let teamIdx = 0; // indice nell'elenco "piatto" delle 4 squadre (teamEntries())
let isLiveSource = false;
let weekLabelText = '';
let liveSchedule = null; // Map abbr → {start,end} per la settimana corrente (liveNow)

/**
 * Le 4 squadre della settimana, ciascuna con il proprio avversario — una entry
 * per squadra, non per matchup. `m` conserva l'ordine originale del matchup:
 * il banner resta sempre disposto allo stesso modo, cambia solo quale nome
 * viene evidenziato.
 */
function teamEntries() {
    const entries = [];
    for (const m of matchups) {
        entries.push({ team: m.team1, opp: m.team2, m });
        entries.push({ team: m.team2, opp: m.team1, m });
    }
    return entries;
}

/**
 * Stato infortunio del giocatore, o null se sta bene. I dati usano
 * `injury_status` (snake_case); il vecchio schema NFL.com usava `injuryStatus`,
 * quindi si accettano entrambi. NORMAL/ACTIVE significano "nessun problema".
 */
function injuryOf(p) {
    const v = p?.injury_status ?? p?.injuryStatus;
    return v && !['ACTIVE', 'NORMAL'].includes(v) ? v : null;
}

function teamOf(rawName) {
    return TEAMS[TEAM_KEYS[displayName(rawName)]] || null;
}

const P = (m) => parseFloat(m) || 0;
const fmt = (n) => (+n).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

// Projections: before kickoff (started === false) show the projected value.
// Older/real data without `started`/`projected_*` falls back to real points.
const pIsProjected = (p) => p && p.started === false && p.projected_points != null;
const effPts = (p) => P(pIsProjected(p) ? p.projected_points : p.fantasy_points);
// Effective team score: projected total pre-game, real once points exist.
const teamEffScore = (t) => (P(t.score) === 0 && t.projected_score != null ? P(t.projected_score) : P(t.score));

export async function initLive() {
    if (loaded) return;
    loaded = true;
    initPlayerModal();
    restoreReceipts();

    const root = document.getElementById('live-root');
    if (!root) return;

    window.addEventListener('hashchange', () => {
        if (!location.hash.startsWith('#live')) stopPolling();
    });
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) stopPolling();
        else if (isLiveSource) startPolling();
    });

    await loadData();
}

function stopPolling() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}

function startPolling() {
    stopPolling();
    pollTimer = setInterval(() => loadData({ silent: true }), POLL_MS);
}

async function loadData({ silent = false } = {}) {
    const root = document.getElementById('live-root');
    if (!silent) root.innerHTML = `<div class="loading-state"><div class="spinner"></div><p>Loading live matchups...</p></div>`;

    const workerUrl = liveWorkerUrl();
    if (workerUrl) {
        try {
            const year = new Date().getFullYear();
            const res = await fetch(`${workerUrl}/live?season=${year}&week=${currentEspnWeek(year)}`);
            if (!res.ok) throw new Error(`worker ${res.status}`);
            const json = await res.json();
            if (Array.isArray(json.matchups) && json.matchups.length) {
                matchups = json.matchups;
                isLiveSource = true;
                weekLabelText = `${year} · Week ${currentEspnWeek(year)}`;
                await hydrateScheduleAndRender(String(year), currentEspnWeek(year));
                startPolling();
                return;
            }
        } catch (e) {
            console.warn('[live] worker non raggiungibile, fallback a Firebase:', e.message);
        }
    }

    // Fallback: ultima settimana reale disponibile su Firebase (non live).
    isLiveSource = false;
    stopPolling();
    const data = await fetchFantasyData(CURRENT_SEASON);
    if (!data?.weeks) {
        root.innerHTML = `<div class="empty-state"><p class="empty-state-text">No data available</p></div>`;
        return;
    }
    const weeks = Object.keys(data.weeks).map(Number).sort((a, b) => a - b);
    let pickedWeek = weeks[0];
    for (const w of weeks) {
        const wk = data.weeks[String(w)];
        if (wk?.matchups?.some(m => P(m.team1?.score) > 0 || P(m.team2?.score) > 0)) pickedWeek = w;
    }
    matchups = data.weeks[String(pickedWeek)]?.matchups || [];
    const config = getSeasonConfig(CURRENT_SEASON);
    const roundLabel = pickedWeek === config.superBowlWeek ? 'Super Bowl'
        : pickedWeek === config.playoffWeek ? 'Playoffs' : `Week ${pickedWeek}`;
    weekLabelText = `${CURRENT_SEASON} · ${roundLabel}`;
    await hydrateScheduleAndRender(CURRENT_SEASON, pickedWeek);
}

/** Placeholder finché non è nota la week ESPN corrente lato client — il worker
 *  stesso di default usa status.currentMatchupPeriod se week è assente. */
function currentEspnWeek() {
    return 1;
}

async function hydrateScheduleAndRender(year, week) {
    try {
        liveSchedule = await getWeekSchedule(year, week);
    } catch {
        liveSchedule = null;
    }
    if (teamIdx >= teamEntries().length) teamIdx = 0;
    const fresh = updateReceipts();
    render();
    if (fresh.length) flashNewReceipts(fresh);
}

// ─── Motore eventi (delta tra due poll) ──────────────────────────

/** Fotografia dei giocatori correnti: nome → punti + stat, per il confronto al poll successivo. */
function takeSnapshot() {
    const snap = {};
    for (const m of matchups) {
        for (const side of ['team1', 'team2']) {
            const t = m[side];
            if (!t) continue;
            for (const p of [...(t.starters || []), ...(t.bench || [])]) {
                snap[p.name] = {
                    pts: P(p.fantasy_points),
                    stats: { ...(p.stats || {}) },
                    team: t.name,
                    pos: (p.position_in_team || p.position || '').toUpperCase(),
                    nfl: p.nfl_team || '',
                };
            }
        }
    }
    return snap;
}

/**
 * Confronta due fotografie e produce uno scontrino per ogni giocatore che ha
 * mosso qualcosa. Il delta punti può essere positivo, negativo o nullo:
 * anche una ricezione che non porta punti va segnalata, come richiesto.
 */
function detectEvents(prev, curr) {
    if (!prev) return [];
    const out = [];
    for (const [name, now] of Object.entries(curr)) {
        const before = prev[name];
        if (!before) continue;

        const changes = [];
        const keys = new Set([...Object.keys(before.stats), ...Object.keys(now.stats)]);
        for (const k of keys) {
            const d = (now.stats[k] || 0) - (before.stats[k] || 0);
            if (d !== 0) changes.push({ key: k, delta: d, big: BIG_EVENTS.has(k) });
        }

        const ptsDelta = +(now.pts - before.pts).toFixed(2);
        if (!changes.length && ptsDelta === 0) continue;

        // i TD e gli eventi negativi in cima allo scontrino
        changes.sort((a, b) => (b.big ? 1 : 0) - (a.big ? 1 : 0));
        out.push({
            id: `${name}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            name, team: now.team, pos: now.pos, nfl: now.nfl,
            changes, ptsDelta, ts: Date.now(),
            headline: changes.find(c => c.big)?.key || changes[0]?.key || null,
        });
    }
    return out;
}

/** Aggiorna lo storico scontrini dopo un poll (tenuti gli ultimi 40). */
function updateReceipts() {
    const curr = takeSnapshot();
    const events = detectEvents(prevSnapshot, curr);
    prevSnapshot = curr;
    if (events.length) {
        receipts = [...events, ...receipts].slice(0, 40);
        try { sessionStorage.setItem('topina-live-receipts', JSON.stringify(receipts)); } catch { /* quota */ }
    }
    return events;
}

function restoreReceipts() {
    try {
        const raw = sessionStorage.getItem('topina-live-receipts');
        if (raw) receipts = JSON.parse(raw) || [];
    } catch { receipts = []; }
}

function liveNow(p) {
    const w = p?.nfl_team ? liveSchedule?.get(canonAbbr(p.nfl_team)) : null;
    const now = Date.now();
    return !!w && now >= w.start.getTime() && now <= w.end.getTime();
}

// ─── Rendering ────────────────────────────────────────────────────

function render() {
    const root = document.getElementById('live-root');
    const entries = teamEntries();
    if (!entries.length) {
        root.innerHTML = `<div class="empty-state"><p class="empty-state-text">No live matchups right now</p></div>`;
        return;
    }
    const entry = entries[teamIdx];
    const { team, opp } = entry;

    root.innerHTML = `
    ${headerHTML()}
    ${teamSwitcherHTML(entries)}
    ${matchupCardHTML(entry)}
    ${compareMode ? compareHTML(team, opp) : fieldHTML(team)}
    <div class="live-layout">
        <div class="live-main">
            ${chartHTML(team, opp)}
            ${rosterLiveHTML(team, opp)}
        </div>
        <aside class="live-sidebar">
            ${receiptsPanelHTML()}
            ${sidebarHTML(team, opp)}
        </aside>
    </div>`;

    hydrateHeadshots(root);
    root.querySelector('.live-refresh-btn')?.addEventListener('click', () => loadData());
    root.querySelectorAll('.live-team-pill').forEach(btn => {
        btn.addEventListener('click', () => {
            teamIdx = Number(btn.dataset.idx);
            render();
        });
    });

    root.querySelector('[data-compare]')?.addEventListener('click', () => {
        compareMode = !compareMode;
        render();
    });
    root.querySelector('[data-swap]')?.addEventListener('click', showOpponent);
    bindSwipe(root.querySelector('[data-swipe]'));
}

/**
 * Passa alla squadra avversaria mantenendo la vista corrente. La scheda
 * dell'avversario entra dal lato verso cui punta la freccia.
 */
function showOpponent() {
    const entries = teamEntries();
    const { opp } = entries[teamIdx];
    const goingForward = teamIdx % 2 === 0;
    const next = entries.findIndex(e => e.team === opp);
    if (next >= 0) teamIdx = next;

    const swap = () => {
        slideFrom = goingForward ? 'right' : 'left';
        render();
        slideFrom = null;
    };

    // La scheda corrente esce prima (sfuma e scivola dal lato opposto), poi
    // entra quella nuova: il ricambio è continuo invece di uno scatto secco.
    const outgoing = document.querySelector('[data-swipe]');
    if (!outgoing || !outgoing.animate || matchMedia('(prefers-reduced-motion: reduce)').matches) {
        swap();
        return;
    }
    const anim = outgoing.animate([
        { transform: 'translateX(0)', opacity: 1 },
        { transform: `translateX(${goingForward ? '-38%' : '38%'})`, opacity: 0 },
    ], { duration: 260, easing: 'cubic-bezier(0.4, 0, 1, 1)', fill: 'forwards' });
    anim.onfinish = swap;
}

/** Swipe orizzontale sul campo/confronto → mostra l'avversario. */
function bindSwipe(el) {
    if (!el) return;
    let x0 = null;
    el.addEventListener('touchstart', (e) => { x0 = e.changedTouches[0].clientX; }, { passive: true });
    el.addEventListener('touchend', (e) => {
        if (x0 == null) return;
        const dx = e.changedTouches[0].clientX - x0;
        x0 = null;
        if (Math.abs(dx) > 60) showOpponent();
    }, { passive: true });
}

/**
 * Stato in alto: pallino pulsante quando ci sono partite in corso, icona di
 * proiezione quando i numeri mostrati sono stime pre-kickoff.
 */
function statusBadgeHTML() {
    const entries = teamEntries();
    const shown = entries[teamIdx];
    const players = shown
        ? [...(shown.team.starters || []), ...(shown.opp.starters || [])]
        : [];
    const anyLive = players.some(p => p && p.started === true);
    const anyProjected = players.some(pIsProjected);

    if (anyLive) return '<i class="gb-live-dot"></i> LIVE';
    if (anyProjected) return `
        <svg class="live-proj-icon" viewBox="0 0 24 24" width="13" height="13" fill="none"
             stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <polyline points="3 17 9 11 13 15 21 7"></polyline>
            <polyline points="15 7 21 7 21 13"></polyline>
        </svg> PROJECTED`;
    return 'FINAL';
}

function headerHTML() {
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    return `
    <div class="live-header">
        <div class="live-header-left">
            <h1 class="live-header-title">${weekLabelText}</h1>
            <span class="live-header-kicker">${statusBadgeHTML()}</span>
        </div>
        <div class="live-header-right">
            <span class="live-header-updated">Updated ${hh}:${mm}</span>
            <button class="live-refresh-btn" type="button" aria-label="Refresh">↻</button>
        </div>
    </div>`;
}

/** Selettore a 4 squadre — stessa classe .year-pill usata altrove nel sito (game-center.js). */
function teamSwitcherHTML(entries) {
    return `
    <div class="year-selector live-team-selector">
        ${entries.map(({ team }, i) => `
        <button class="year-pill live-team-pill${i === teamIdx ? ' active' : ''}" data-idx="${i}">
            ${teamNameHTML(team.name)}
        </button>`).join('')}
    </div>`;
}

/**
 * Banner punteggio — stessa identità visiva del banner di Game Center.
 * La disposizione segue sempre l'ordine del matchup (team1 a sinistra):
 * cambiando squadra si sposta solo il contorno colorato sul nome selezionato.
 */
function matchupCardHTML(entry) {
    const { m, team: selected } = entry;
    const left = m.team1, right = m.team2;
    const proj1 = P(left.score) === 0 && left.projected_score != null;
    const proj2 = P(right.score) === 0 && right.projected_score != null;
    const s1 = teamEffScore(left), s2 = teamEffScore(right);
    const t1 = teamOf(left.name), t2 = teamOf(right.name);
    const total = s1 + s2;
    const pct1 = total > 0 ? Math.round((s1 / total) * 100) : 50;
    const selLeft = selected === left;

    return `
    <div class="live-scorebar" style="--tc1:${t1?.color || 'var(--accent-red)'};--tc2:${t2?.color || 'var(--accent-blue)'};--tc-sel:${(selLeft ? t1 : t2)?.color || 'var(--accent-red)'}">
        <div class="gc-banner">
            ${t1?.logo ? `<img class="gc-banner-wm gc-banner-wm-l" src="${t1.logo}" alt="" aria-hidden="true">` : ''}
            ${t2?.logo ? `<img class="gc-banner-wm gc-banner-wm-r" src="${t2.logo}" alt="" aria-hidden="true">` : ''}
            <div class="gc-banner-inner">
                <div class="gc-banner-side">
                    <span class="gc-banner-name${selLeft ? ' live-name-selected' : ''}">${teamNameHTML(t1?.name || left.name)}</span>
                </div>
                <span class="gc-banner-score${s1 >= s2 ? ' winner' : ''}">${proj1 ? `<span class="proj-pts">${fmt(s1)}</span>` : fmt(s1)}</span>
                <div class="gc-banner-mid">
                    <span class="gc-banner-vs">${isLiveSource ? 'live' : 'vs'}</span>
                </div>
                <span class="gc-banner-score${s2 >= s1 ? ' winner' : ''}">${proj2 ? `<span class="proj-pts">${fmt(s2)}</span>` : fmt(s2)}</span>
                <div class="gc-banner-side gc-banner-side-r">
                    <span class="gc-banner-name${selLeft ? '' : ' live-name-selected'}">${teamNameHTML(t2?.name || right.name)}</span>
                </div>
            </div>
        </div>
        <div class="live-mc-probbar">
            <div class="live-mc-probfill" style="width:${pct1}%"></div>
        </div>
        <div class="live-mc-probLabels">
            <span>${pct1}%</span>
            <span>${100 - pct1}%</span>
        </div>
    </div>`;
}

function chip(p, side) {
    if (!p) return '<div class="live-chip live-chip--empty"></div>';
    const role = (p.position_in_team || p.position || '').toUpperCase();
    const live = liveNow(p);
    const injury = injuryOf(p);
    return `
    <div class="live-chip${live ? ' live-chip--live' : ''}${injury ? ' live-chip--injury' : ''}" data-player-modal
         data-player-name="${escAttr(p.name)}" data-pos="${escAttr(role)}" data-nfl="${escAttr(p.nfl_team || '')}" data-year="${CURRENT_SEASON}">
        <span class="live-chip-photo">
            <img src="images/fallback-player.svg" alt="" loading="lazy"
                 data-headshot data-player-name="${p.name}" data-team="${p.nfl_team || ''}" data-pos="${role}">
            ${live ? '<i class="gb-live-dot live-chip-dot"></i>' : ''}
        </span>
        <span class="live-chip-name">${shortName(p)}</span>
        <span class="live-chip-pts">${pIsProjected(p) ? `<span class="proj-pts">${fmt(effPts(p))}</span>` : fmt(effPts(p))}</span>
        ${injury ? `<span class="live-chip-injury-badge">${injury}</span>` : ''}
    </div>`;
}

function shortName(p) {
    const role = (p.position_in_team || p.position || '').toUpperCase();
    if (role === 'DEF' || role === 'D/ST') return p.name;
    const parts = String(p.name).trim().split(/\s+/);
    return parts.length < 2 ? p.name : `${parts[0][0]}. ${parts.slice(1).join(' ')}`;
}

function escAttr(s) {
    return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function byPos(starters, pos, nth = 0) {
    let count = 0;
    for (const p of starters) {
        const pp = (p.position || '').toUpperCase();
        if (pp === pos || (pos === 'FLEX' && (pp === 'RB/WR' || pp === 'W/R'))) {
            if (count === nth) return p;
            count++;
        }
    }
    return null;
}

/** Valore di una statistica, con la somma dei field goal per la chiave virtuale fg_made. */
function statValue(stats, key) {
    if (key === 'fg_made') {
        // I dati 2026+ forniscono già il totale; le fasce si sommano solo per
        // il vecchio schema NFL.com, che non aveva fg_made.
        if (stats.fg_made != null) return stats.fg_made;
        return ['fg_0_19', 'fg_20_29', 'fg_30_39', 'fg_0_39', 'fg_40_49', 'fg_50_plus']
            .reduce((s, k) => s + (stats[k] || 0), 0);
    }
    return stats[key] || 0;
}

/** Riquadro statistiche: sempre 4 voci per ruolo, trattino se a zero. */
function statLineHTML(p) {
    let role = (p.position_in_team || p.position || '').toUpperCase();
    if (role === 'W/R' || role === 'RB/WR' || role === 'FLEX') role = 'WR';
    if (role === 'D/ST') role = 'DEF';
    const keys = STATS_BY_ROLE[role] || STATS_BY_ROLE.WR;
    // Before kickoff show the projected stat line (real stats are all zero).
    const proj = pIsProjected(p);
    const stats = (proj ? p.projected_stats : p.stats) || p.stats || {};
    return keys.map(k => {
        const raw = statValue(stats, k);
        // Le proiezioni arrivano con due decimali (es. 83.48): troppo lunghe per
        // la card, verrebbero troncate. Interi per i conteggi, un decimale per
        // le frazioni piccole.
        const v = proj ? (raw >= 10 ? Math.round(raw) : Math.round(raw * 10) / 10) : raw;
        return `<span class="live-stat${v === 0 ? ' live-stat--zero' : ''}">
            <b>${v === 0 ? '–' : v}</b> ${shortStatLabel(k)}</span>`;
    }).join('');
}

/** Etichetta corta per la card (quella lunga sta negli scontrini). */
function shortStatLabel(k) {
    return ({
        pass_yds: 'PaYd', pass_td: 'PaTD', pass_int: 'INT',
        rush_yds: 'RuYd', rush_td: 'RuTD',
        rec: 'Rec', rec_yds: 'ReYd', rec_td: 'ReTD',
        pass_att: 'Att', pass_comp: 'Cmp', rush_att: 'Car', targets: 'Tgt',
        pat_made: 'XP', fg_made: 'FG', fg_att: 'FGA',
        fg_0_39: 'FG0-39', fg_40_49: 'FG40', fg_50_plus: 'FG50+',
        sack: 'Sck', def_int: 'INT', fum_rec: 'FR', def_td: 'TD',
        safety: 'SAF', pts_allowed: 'PA', yds_allowed: 'YdA',
    })[k] || k;
}

/** Slot giocatore sul campo — card con foto, nome, punti e statistiche. */
function fieldSlot(p, extraClass = '') {
    if (!p) return '';
    const role = (p.position_in_team || p.position || '').toUpperCase();
    const live = liveNow(p);
    const injury = injuryOf(p);
    return `
    <div class="formation-slot live-slot${live ? ' live-slot--live' : ''}${extraClass}" data-player-modal
         data-slot-player="${escAttr(p.name)}"
         data-player-name="${escAttr(p.name)}" data-pos="${escAttr(role)}" data-nfl="${escAttr(p.nfl_team || '')}" data-year="${CURRENT_SEASON}">
        <span class="slot-photo"><img src="images/fallback-player.svg" alt="" loading="lazy"
            data-headshot data-player-name="${p.name}" data-team="${p.nfl_team || ''}" data-pos="${role}">
            ${live ? '<i class="gb-live-dot live-slot-dot"></i>' : ''}</span>
        <span class="slot-name">${shortName(p)}</span>
        <span class="slot-pts">${pIsProjected(p) ? `<span class="proj-pts">${fmt(effPts(p))}</span>` : fmt(effPts(p))}</span>
        <span class="live-slot-stats">${statLineHTML(p)}</span>
        ${injury ? `<span class="live-slot-inj">${escAttr(injury)}</span>` : ''}
    </div>`;
}

function olineSlot() {
    return `<div class="formation-slot oline-x">✕</div>`;
}

/**
 * Formazione vista dall'alto, con l'attacco rivolto verso la end zone in alto:
 * righe orizzontali (scrimmage → QB → RB → K/DEF), come le yard line del campo.
 */
function fieldFormationHTML(team) {
    const s = team.starters || [];
    return `
    <div class="live-row live-row--st">${fieldSlot(byPos(s, 'K'))}${fieldSlot(byPos(s, 'DEF') || byPos(s, 'D/ST'))}</div>
    <div class="live-formation-bottom">
        <div class="live-row live-row--line">
            ${fieldSlot(byPos(s, 'WR', 0))}${fieldSlot(byPos(s, 'TE'))}
            ${olineSlot()}${olineSlot()}${olineSlot()}${olineSlot()}${olineSlot()}
            ${fieldSlot(byPos(s, 'FLEX'))}${fieldSlot(byPos(s, 'WR', 1))}
        </div>
        <div class="live-row live-row--backfield">
            ${fieldSlot(byPos(s, 'RB', 0))}
            ${fieldSlot(byPos(s, 'QB'))}
            ${fieldSlot(byPos(s, 'RB', 1))}
        </div>
    </div>`;
}

/**
 * Freccia accanto all'immagine: punta a destra quando si guarda la prima
 * squadra del matchup (si va all'avversario), a sinistra sull'avversario
 * (si torna indietro).
 */
function swapArrowHTML() {
    const back = teamIdx % 2 === 1;
    const points = back ? '15 6 9 12 15 18' : '9 6 15 12 9 18';
    return `
    <button class="live-swap-btn live-swap-btn--${back ? 'left' : 'right'}" type="button" data-swap
            aria-label="${back ? 'Back to the other team' : 'Show the opponent'}">
        <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor"
             stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <polyline points="${points}"></polyline>
        </svg>
    </button>`;
}

/** Classe di animazione da applicare al riquadro dopo uno swap. */
function slideClass() {
    return slideFrom ? ` live-slide-${slideFrom}` : '';
}

/** Campo di una singola squadra, orizzontale, sfondo campo visibile (stile Game Center). */
function fieldHTML(team) {
    return `
    <div class="live-field-head">
        <span class="live-field-label">${teamNameHTML(team.name)}</span>
        <div class="live-field-controls">
            <button class="live-compare-btn" type="button" data-compare>Compare</button>
        </div>
    </div>
    <div class="live-stage">
        <div class="live-field-slider${slideClass()}" data-swipe>
            <div class="matchup-field-horizontal live-field-solo">
                <img src="Wallpapers/IMG_5984.PNG" class="field-bg" alt="">
                <div class="field-overlay">
                    <div class="live-formation-stack">
                        ${fieldFormationHTML(team)}
                    </div>
                </div>
            </div>
            ${benchHTML(team)}
        </div>
        ${swapArrowHTML()}
    </div>`;
}

/** Panchina in riga sotto al campo: stesse card, in formato ridotto. */
function benchHTML(team) {
    const bench = team.bench || [];
    if (!bench.length) return '';
    return `
    <div class="live-bench">
        <span class="live-bench-label">Bench</span>
        <div class="live-bench-row">
            ${bench.map(p => fieldSlot(p, ' live-slot--bench')).join('')}
        </div>
    </div>`;
}

/** Foto tonda usata nel confronto (stesso trattamento a vetro del campo). */
function comparePhoto(p) {
    if (!p) return '<span class="live-cmp-photo live-cmp-photo--empty"></span>';
    const role = (p.position_in_team || p.position || '').toUpperCase();
    return `<span class="live-cmp-photo"><img src="images/fallback-player.svg" alt="" loading="lazy"
        data-headshot data-player-name="${p.name}" data-team="${p.nfl_team || ''}" data-pos="${role}"></span>`;
}

/**
 * Statistiche del confronto a riquadri (numero sopra, etichetta sotto), come
 * in Game Center: i primi due valori escono sempre, il resto solo se > 0.
 */
function compareStatsHTML(p) {
    // Prima del kickoff le stat reali sono tutte a zero: si mostrano le proiezioni
    // (stesso criterio dei punti, vedi pIsProjected).
    const proj = pIsProjected(p);
    const s = (proj ? p?.projected_stats : p?.stats) || p?.stats || {};
    // le proiezioni sono decimali (es. 2.52 ricezioni): una cifra basta
    const n = (v) => {
        const x = Number(v) || 0;
        return proj ? Math.round(x * 10) / 10 : x;
    };
    let role = (p?.position_in_team || p?.position || '').toUpperCase();
    if (role === 'W/R' || role === 'RB/WR' || role === 'FLEX') role = 'WR';
    if (role === 'D/ST') role = 'DEF';

    const CANDIDATES = {
        QB: [[n(s.pass_yds), 'pass yd'], [n(s.pass_td), 'td'], [n(s.pass_int), 'int'], [n(s.rush_yds), 'rush yd']],
        RB: [[n(s.rush_yds), 'rush yd'], [n(s.rush_td), 'td'], [n(s.rec_yds), 'rec yd'], [n(s.rec_td), 'rec td']],
        WR: [[n(s.rec), 'rec'], [n(s.rec_yds), 'rec yd'], [n(s.rec_td), 'td']],
        TE: [[n(s.rec), 'rec'], [n(s.rec_yds), 'rec yd'], [n(s.rec_td), 'td']],
        K: [[n(s.fg_0_19) + n(s.fg_20_29) + n(s.fg_30_39) + n(s.fg_40_49) + n(s.fg_50_plus), 'fg'], [n(s.pat_made), 'xp']],
        DEF: [[n(s.sack), 'sack'], [n(s.def_int) + n(s.fum_rec), 'to'], [n(s.def_td), 'td']],
    };
    const list = (CANDIDATES[role] || CANDIDATES.WR).filter(([v], i) => i < 2 || v > 0).slice(0, 3);
    return list.map(([v, l]) =>
        `<span class="live-cmp-mini"><b${proj ? ' class="proj-pts"' : ''}>${v}</b><i>${l}</i></span>`).join('');
}

/** Nome + ruolo/squadra, sul bordo esterno della riga. */
function compareName(p, side) {
    if (!p) return `<div class="live-cmp-who live-cmp-who--${side}"><span class="live-cmp-empty">—</span></div>`;
    const role = (p.position_in_team || p.position || '').toUpperCase();
    const meta = [role, p.nfl_team].filter(Boolean).join(' · ')
        + (p.opponent ? ` | vs ${String(p.opponent).replace('@', '')}` : '');
    return `
    <div class="live-cmp-who live-cmp-who--${side}"
         data-player-modal data-player-name="${escAttr(p.name)}"
         data-pos="${escAttr(role)}" data-nfl="${escAttr(p.nfl_team || '')}" data-year="${CURRENT_SEASON}">
        <span class="live-cmp-name">${escAttr(p.name)}</span>
        <span class="live-cmp-meta">${escAttr(meta)}</span>
    </div>`;
}

/** Statistiche di un lato, accostate al punteggio centrale. */
function compareStatsBlock(p, win, side) {
    if (!p) return `<span class="live-cmp-stats live-cmp-stats--${side}"></span>`;
    return `<span class="live-cmp-stats live-cmp-stats--${side}${win ? ' live-cmp-stats--win' : ''}">${compareStatsHTML(p)}</span>`;
}

/**
 * Confronto titolari: foto tonde ai lati, ruolo al centro, statistiche e punti
 * di ciascuno. I numeri di chi ha fatto meglio nella riga restano accesi,
 * quelli dell'altro sono "spenti".
 */
function compareHTML(team, opp) {
    const pairs = slotPairs({ team1: team, team2: opp });
    const t1 = teamOf(team.name), t2 = teamOf(opp.name);

    return `
    <div class="live-field-head">
        <span class="live-field-label">${teamNameHTML(team.name)} <span class="live-cmp-vs">vs</span> ${teamNameHTML(opp.name)}</span>
        <div class="live-field-controls">
            <button class="live-compare-btn live-compare-btn--on" type="button" data-compare>Field</button>
        </div>
    </div>
    <div class="live-stage">
    <div class="live-compare${slideClass()}" style="--tc1:${t1?.color || 'var(--accent-red)'};--tc2:${t2?.color || 'var(--accent-blue)'}" data-swipe>
        ${pairs.map(({ slot, a, b }) => {
        const pa = a ? effPts(a) : 0, pb = b ? effPts(b) : 0;
        const aWin = !!a && pa >= pb;
        const bWin = !!b && pb >= pa;
        return `
        <div class="live-cmp-row">
            ${comparePhoto(a)}
            ${compareName(a, 'l')}
            ${compareStatsBlock(a, aWin, 'l')}
            <span class="live-cmp-pts${aWin ? ' live-cmp-pts--win' : ''}">${a ? (pIsProjected(a) ? `<span class="proj-pts">${fmt(pa)}</span>` : fmt(pa)) : '—'}</span>
            <span class="live-cmp-slot">${slot}</span>
            <span class="live-cmp-pts${bWin ? ' live-cmp-pts--win' : ''}">${b ? (pIsProjected(b) ? `<span class="proj-pts">${fmt(pb)}</span>` : fmt(pb)) : '—'}</span>
            ${compareStatsBlock(b, bWin, 'r')}
            ${compareName(b, 'r')}
            ${comparePhoto(b)}
        </div>`;
    }).join('')}
    </div>
    ${swapArrowHTML()}
    </div>`;
}

/**
 * Andamento punti nel weekend: i punti di ogni titolare si accumulano
 * linearmente dentro la finestra della sua partita NFL reale (kickoff→fine da
 * nfl-schedule). Stessa tecnica del grafico in game.js, qui per la squadra
 * selezionata contro l'avversario. Riusa le classi .gbc-* già esistenti.
 */
function chartHTML(team, opp) {
    if (!liveSchedule) return '';
    const t1 = teamOf(team.name), t2 = teamOf(opp.name);
    const colors = [t1?.color || 'var(--accent-red)', t2?.color || 'var(--accent-blue)'];

    const mkSeries = (t) => (t.starters || []).map(p => ({
        pts: P(p.fantasy_points), name: p.name,
        win: liveSchedule.get(canonAbbr(p.nfl_team)) || null,
    }));
    const series = [mkSeries(team), mkSeries(opp)];

    const matched = series.flat().filter(x => x.win);
    if (!matched.length) return '';

    const t0 = Math.min(...matched.map(x => x.win.start.getTime()));
    const tEnd = Math.max(...matched.map(x => x.win.end.getTime()));
    series.forEach(list => list.forEach(x => {
        if (!x.win) x.win = { start: new Date(t0), end: new Date(tEnd) };
    }));
    const pad = 25 * 60 * 1000;
    const T0 = t0 - pad, T1 = tEnd + pad;

    const valueAt = (list, t) => list.reduce((s, x) => {
        const a = x.win.start.getTime(), b = x.win.end.getTime();
        const f = t <= a ? 0 : t >= b ? 1 : (t - a) / (b - a);
        return s + x.pts * f;
    }, 0);

    const times = [...new Set([T0, T1, ...series.flat().flatMap(x => [x.win.start.getTime(), x.win.end.getTime()])])].sort((a, b) => a - b);
    const maxV = Math.max(valueAt(series[0], T1), valueAt(series[1], T1));
    const yTop = Math.max(25, Math.ceil(maxV * 1.06 / 25) * 25);

    const W = 920, H = 300, padL = 6, padR = 42, padT = 12, padB = 44;
    const X = (t) => padL + (t - T0) / (T1 - T0) * (W - padL - padR);
    const Y = (v) => padT + (1 - v / yTop) * (H - padT - padB);

    let grid = '';
    for (let v = 0; v <= yTop; v += 25) {
        grid += `<line x1="${padL}" y1="${Y(v)}" x2="${W - padR}" y2="${Y(v)}" class="gbc-grid"/>
                 <text x="${W - padR + 8}" y="${Y(v) + 4}" class="gbc-ylabel">${v}</text>`;
    }

    const kicks = [...new Set(matched.map(x => x.win.start.getTime()))].sort((a, b) => a - b);
    const dayFmt = new Intl.DateTimeFormat('en-US', { weekday: 'short' });
    const hourFmt = new Intl.DateTimeFormat('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
    let lastKept = -Infinity, ticks = '';
    kicks.forEach(k => {
        if (k - lastKept < 40 * 60 * 1000) return;
        lastKept = k;
        const d = new Date(k);
        ticks += `<line x1="${X(k)}" y1="${padT}" x2="${X(k)}" y2="${H - padB}" class="gbc-tickline"/>
                  <text x="${X(k)}" y="${H - padB + 16}" class="gbc-xlabel">${hourFmt.format(d)}</text>
                  <text x="${X(k)}" y="${H - padB + 30}" class="gbc-xlabel gbc-xday">${dayFmt.format(d)}</text>`;
    });

    const line = (list, color) =>
        `<polyline fill="none" stroke="${color}" stroke-width="2.5" stroke-linejoin="round"
            points="${times.map(t => `${X(t).toFixed(1)},${Y(valueAt(list, t)).toFixed(1)}`).join(' ')}"/>`;

    const dots = (list, color) => list.filter(x => x.pts !== 0).map(x => {
        const te = x.win.end.getTime();
        return `<circle cx="${X(te).toFixed(1)}" cy="${Y(valueAt(list, te)).toFixed(1)}" r="4.5"
                    fill="${color}" stroke="var(--bg-primary)" stroke-width="1.5" class="gbc-dot">
                <title>${escAttr(x.name)} · ${x.pts.toFixed(1)} pt</title></circle>`;
    }).join('');

    return `
    <div class="mosaic-card mc-wide mc-in live-card">
        <span class="mc-kicker">Weekend trend</span>
        <div class="gbc-legend">
            <span class="gbc-legend-item"><i style="background:${colors[0]}"></i>${teamNameHTML(t1?.name || team.name)}</span>
            <span class="gbc-legend-item"><i style="background:${colors[1]}"></i>${teamNameHTML(t2?.name || opp.name)}</span>
        </div>
        <div class="gbc-wrap">
            <svg viewBox="0 0 ${W} ${H}" class="gbc-svg" role="img" aria-label="Points trend across the weekend">
                ${grid}${ticks}
                ${line(series[0], colors[0])}${line(series[1], colors[1])}
                ${dots(series[0], colors[0])}${dots(series[1], colors[1])}
            </svg>
        </div>
    </div>`;
}

function rosterLiveHTML(team, opp) {
    const all = [...(team.starters || []), ...(team.bench || []),
    ...(opp.starters || []), ...(opp.bench || [])];
    const live = all.filter(liveNow);
    if (!live.length) return '';
    return `
    <div class="mosaic-card mc-wide mc-in live-card">
        <span class="mc-kicker">Currently playing</span>
        <div class="live-roster-grid">
            ${live.map(p => chip(p)).join('')}
        </div>
    </div>`;
}

/** Scontrino singolo: cosa è cambiato e quanti punti ha prodotto. */
function receiptHTML(r) {
    const time = new Date(r.ts).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
    const sign = r.ptsDelta > 0 ? 'pos' : r.ptsDelta < 0 ? 'neg' : 'flat';
    const head = r.headline ? (STAT_LABELS[r.headline] || r.headline) : 'Update';
    const isBig = r.headline && BIG_EVENTS.has(r.headline);
    return `
    <div class="live-receipt${isBig ? ' live-receipt--big' : ''}" data-receipt="${r.id}">
        <div class="live-receipt-head">
            <span class="live-receipt-type">${head}</span>
            <span class="live-receipt-time">${time}</span>
        </div>
        <div class="live-receipt-player">${escAttr(r.name)}<span class="live-receipt-team">${escAttr(r.nfl)}</span></div>
        <ul class="live-receipt-lines">
            ${r.changes.map(c => `
            <li>
                <span>${STAT_LABELS[c.key] || c.key}</span>
                <b class="${c.delta > 0 ? 'pos' : 'neg'}">${c.delta > 0 ? '+' : ''}${c.delta}</b>
            </li>`).join('')}
        </ul>
        <div class="live-receipt-total ${sign}">
            <span>TOTAL</span>
            <b>${r.ptsDelta > 0 ? '+' : ''}${r.ptsDelta.toFixed(2)}</b>
        </div>
    </div>`;
}

function receiptsPanelHTML() {
    return `
    <div class="mosaic-card mc-in live-side-card live-receipts-card">
        <span class="mc-kicker">Scoring feed</span>
        <div class="live-receipts" id="live-receipts">
            ${receipts.length
            ? receipts.map(receiptHTML).join('')
            : `<p class="pm-empty">${isLiveSource
                ? 'Waiting for the first play...'
                : 'Live feed off — receipts appear when games are running.'}</p>`}
        </div>
    </div>`;
}

/**
 * Conteggio animato: il numero sale/scende invece di cambiare di scatto.
 * `from` è il valore precedente, `to` quello nuovo già scritto nel DOM.
 */
function countUp(el, from, to, ms = 900) {
    if (!el || from === to || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const t0 = performance.now();
    const step = (now) => {
        const k = Math.min(1, (now - t0) / ms);
        const eased = 1 - Math.pow(1 - k, 3); // decelera verso il valore finale
        el.textContent = fmt(from + (to - from) * eased);
        if (k < 1) requestAnimationFrame(step);
        else el.textContent = fmt(to);
    };
    requestAnimationFrame(step);
}

/** Evidenzia sul campo i giocatori appena aggiornati + fa "stampare" lo scontrino. */
function flashNewReceipts(events) {
    for (const ev of events) {
        const slot = document.querySelector(`[data-slot-player="${CSS.escape(ev.name)}"]`);
        if (slot) {
            const color = ev.ptsDelta > 0 ? 'var(--accent-green)' : ev.ptsDelta < 0 ? 'var(--live-red)' : 'var(--live-yellow)';
            slot.animate([
                { boxShadow: '0 0 0 0 transparent' },
                { boxShadow: `0 0 22px 4px ${color}` },
                { boxShadow: '0 0 0 0 transparent' },
            ], { duration: 1600, easing: 'ease-out' });
            // i punti salgono progressivamente dal valore precedente a quello nuovo
            const ptsEl = slot.querySelector('.slot-pts');
            if (ptsEl && ev.ptsDelta) {
                const to = P(ptsEl.textContent);
                countUp(ptsEl, to - ev.ptsDelta, to);
            }
        }
        document.querySelector(`[data-receipt="${ev.id}"]`)?.classList.add('live-receipt--new');
    }
}

function sidebarHTML(team, opp) {
    const all = [...(team.starters || []), ...(team.bench || []),
    ...(opp.starters || []), ...(opp.bench || [])];
    // il campo nei dati è injury_status (snake_case), non injuryStatus
    const injuries = all.filter(p => injuryOf(p));

    return `
    <div class="mosaic-card mc-in live-side-card">
        <span class="mc-kicker">Injury report</span>
        ${injuries.length
            ? `<ul class="live-side-list">${injuries.map(p =>
                `<li>${escAttr(p.name)} — <span class="live-injury-tag">${escAttr(injuryOf(p))}</span></li>`).join('')}</ul>`
            : '<p class="pm-empty">No injuries reported.</p>'}
    </div>`;
}

function hydrateHeadshots(root) {
    root.querySelectorAll('img[data-headshot]').forEach(img => {
        img.onerror = () => { if (!img.src.endsWith('fallback-player.svg')) img.src = 'images/fallback-player.svg'; };
        playerImageService.getPlayerImageUrl(img.dataset.playerName, img.dataset.team, img.dataset.pos, CURRENT_SEASON)
            .then(url => { if (url) img.src = url; }).catch(() => {});
    });
}
