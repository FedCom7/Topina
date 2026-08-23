/**
 * Analysis — analisi per team/anno dei giocatori.
 * Per il team selezionato: rendimento stagionale di ogni giocatore passato
 * dal roster (con drill-down settimanale), squadra draftata, mercato
 * (innesti in-season), miglior formazione e confronto punti
 * (reali / draftati / ottimali / persi in panchina).
 */

import { fetchFantasyData, fetchDraftData, displayName, getSeasonConfig, SEASONS, CURRENT_SEASON } from '../data.js?v=534';
import { TEAMS } from './team.js?v=599';
import { playerImageService } from '../services/player-image-service.js?v=516';

let initialized = false;
let currentYear = CURRENT_SEASON;
let currentTeam = 'all';
let currentTab = 'season';
let avgMode = 'total'; // 'total' | 'starter' — base per la colonna Media
// Punti totali vs punti a partita nelle tabelle di confronto — toggle indipendente per sezione
let rosterPtsMode = { drafted: 'total', best: 'total', pickups: 'total' };
const modelCache = {};

const TABS = [
    { id: 'season', label: 'Stagione' },
    { id: 'draft', label: 'Draft' },
    { id: 'market', label: 'Mercato' },
    { id: 'lineup', label: 'Formazione' },
    { id: 'compare', label: 'Confronto' },
];

// Slot reali dei lineup nei matchup
const LINEUP_SLOTS = [
    { slot: 'QB', eligible: ['QB'] },
    { slot: 'RB', eligible: ['RB'] },
    { slot: 'RB', eligible: ['RB'] },
    { slot: 'WR', eligible: ['WR'] },
    { slot: 'WR', eligible: ['WR'] },
    { slot: 'TE', eligible: ['TE'] },
    { slot: 'W/R', eligible: ['RB', 'WR', 'TE'] },
    { slot: 'K', eligible: ['K'] },
    { slot: 'DEF', eligible: ['DEF'] },
];

export function initAnalysis() {
    if (initialized) return;
    initialized = true;
    renderYearSelector();
    renderTeamSelector();
    bindContentEvents();
    load();
}

function renderYearSelector() {
    const container = document.getElementById('an-year-selector');
    if (!container) return;
    container.innerHTML = SEASONS.map(y =>
        `<button class="year-pill${y === currentYear ? ' active' : ''}" data-year="${y}">${y}</button>`
    ).join('');
    container.addEventListener('click', (e) => {
        const btn = e.target.closest('.year-pill');
        if (!btn) return;
        container.querySelectorAll('.year-pill').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentYear = btn.dataset.year;
        load();
    });
}

function renderTeamSelector() {
    const container = document.getElementById('an-team-selector');
    if (!container) return;
    container.innerHTML = `
        <button class="an-team-pill${currentTeam === 'all' ? ' active' : ''}" data-team="all" style="--team-color:#B8433A">
            Totale
        </button>` + Object.values(TEAMS).map(t =>
        `<button class="an-team-pill${t.key === currentTeam ? ' active' : ''}" data-team="${t.key}" style="--team-color:${t.color}">
            <img src="${t.logo}" alt="" class="an-team-pill-logo">${t.name}
        </button>`
    ).join('');
    container.addEventListener('click', (e) => {
        const btn = e.target.closest('.an-team-pill');
        if (!btn) return;
        container.querySelectorAll('.an-team-pill').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentTeam = btn.dataset.team;
        load();
    });
}

function teamKeyFromRaw(raw) {
    const dn = displayName(raw);
    const team = Object.values(TEAMS).find(t => t.name === dn);
    return team ? team.key : raw;
}

function rawFromTeamKey(draftTeams, teamKey) {
    return Object.keys(draftTeams || {}).find(raw => teamKeyFromRaw(raw) === teamKey) || null;
}

/* ============================================================
   MODEL
   ============================================================ */

export async function buildSeasonModel(year) {
    if (modelCache[year]) return modelCache[year];

    const [fantasy, draft] = await Promise.all([fetchFantasyData(year), fetchDraftData(year)]);
    if (!fantasy?.weeks) return null;

    const players = new Map(); // name -> { name, position, nflTeam, weeks: {wk: {...}} }
    const teamWeeks = {};      // teamKey -> { wk: { starters: [names], bench: [names], score } }
    let lastWeek = 0;

    for (const [wkStr, wkData] of Object.entries(fantasy.weeks)) {
        const wk = Number(wkStr);
        for (const m of wkData.matchups || []) {
            for (const side of [m.team1, m.team2]) {
                if (!side?.name) continue;
                const teamKey = teamKeyFromRaw(side.name);
                if (!teamWeeks[teamKey]) teamWeeks[teamKey] = {};
                const tw = teamWeeks[teamKey][wk] = { starters: [], bench: [], score: parseFloat(side.score || 0) };

                for (const [list, started] of [[side.starters, true], [side.bench, false]]) {
                    for (const p of list || []) {
                        if (!p?.name) continue;
                        let rec = players.get(p.name);
                        if (!rec) players.set(p.name, rec = { name: p.name, position: p.position_in_team || p.position, nflTeam: p.nfl_team, weeks: {} });
                        if (p.position_in_team) rec.position = p.position_in_team;
                        if (p.nfl_team) rec.nflTeam = p.nfl_team;
                        rec.weeks[wk] = {
                            pts: parseFloat(p.fantasy_points || 0),
                            stats: p.stats || {},
                            started,
                            teamKey,
                            opponent: p.opponent || '',
                        };
                        (started ? tw.starters : tw.bench).push(p.name);
                    }
                }
                if (wk > lastWeek) lastWeek = wk;
            }
        }
    }

    const config = getSeasonConfig(year);
    const model = {
        year, players, teamWeeks, draft, lastWeek,
        seasonOver: lastWeek >= config.superBowlWeek,
    };
    modelCache[year] = model;
    return model;
}

/* ============================================================
   AGGREGAZIONI
   ============================================================ */

function sumStats(target, stats) {
    for (const [k, v] of Object.entries(stats || {})) {
        target[k] = (target[k] || 0) + (Number(v) || 0);
    }
}

// Aggrega un giocatore sulle settimane in cui era su questo roster
function aggregateOnTeam(rec, teamKey) {
    const agg = { games: 0, pts: 0, gamesStarted: 0, ptsStarted: 0, stats: {}, firstWeek: null, lastWeekOn: null, weeks: [] };
    for (const [wkStr, w] of Object.entries(rec.weeks)) {
        if (w.teamKey !== teamKey) continue;
        const wk = Number(wkStr);
        agg.games++;
        agg.pts += w.pts;
        if (w.started) { agg.gamesStarted++; agg.ptsStarted += w.pts; }
        sumStats(agg.stats, w.stats);
        if (agg.firstWeek === null || wk < agg.firstWeek) agg.firstWeek = wk;
        if (agg.lastWeekOn === null || wk > agg.lastWeekOn) agg.lastWeekOn = wk;
        agg.weeks.push(wk);
    }
    return agg;
}

// Media punti secondo la modalità corrente: 'starter' (solo da titolare) o 'total'
function avgOf(agg) {
    if (avgMode === 'starter') return agg.gamesStarted ? agg.ptsStarted / agg.gamesStarted : 0;
    return agg.games ? agg.pts / agg.games : 0;
}

function ptsElsewhere(rec, teamKey) {
    let pts = 0;
    for (const w of Object.values(rec.weeks)) {
        if (w.teamKey !== teamKey) pts += w.pts;
    }
    return pts;
}

function seasonView(model, teamKey) {
    const rows = [];
    for (const rec of model.players.values()) {
        const agg = aggregateOnTeam(rec, teamKey);
        if (agg.games > 0) rows.push({ rec, agg });
    }
    rows.sort((a, b) => b.agg.pts - a.agg.pts);
    return rows;
}

function draftView(model, teamKey) {
    const raw = rawFromTeamKey(model.draft?.teams, teamKey);
    if (!raw) return null;
    return (model.draft.teams[raw] || []).map(pick => {
        const rec = model.players.get(pick.name);
        const agg = rec ? aggregateOnTeam(rec, teamKey) : null;
        return { pick, rec, agg };
    });
}

export function marketView(model, teamKey) {
    const draftedNames = new Set();
    const raw = rawFromTeamKey(model.draft?.teams, teamKey);
    if (raw) for (const p of model.draft.teams[raw] || []) draftedNames.add(p.name);

    const additions = [];
    const finalRoster = [];
    for (const rec of model.players.values()) {
        const agg = aggregateOnTeam(rec, teamKey);
        if (agg.games === 0) continue;
        const onFinal = rec.weeks[model.lastWeek]?.teamKey === teamKey;
        if (onFinal) finalRoster.push({ rec, agg, drafted: draftedNames.has(rec.name) });
        if (!draftedNames.has(rec.name)) {
            additions.push({ rec, agg, elsewhere: ptsElsewhere(rec, teamKey), onFinal });
        }
    }
    finalRoster.sort((a, b) => b.agg.pts - a.agg.pts);
    additions.sort((a, b) => b.agg.pts - a.agg.pts);
    return { finalRoster, additions, hasDraft: !!raw };
}

function lineupView(model, teamKey) {
    const pool = seasonView(model, teamKey);
    const used = new Set();
    return LINEUP_SLOTS.map(({ slot, eligible }) => {
        const best = pool.find(r => !used.has(r.rec.name) && eligible.includes(r.rec.position));
        if (best) used.add(best.rec.name);
        return { slot, row: best || null };
    });
}

// Lineup ottimale di una singola settimana dal roster di quella settimana
function optimalWeekPoints(model, teamKey, wk) {
    const tw = model.teamWeeks[teamKey]?.[wk];
    if (!tw) return null;
    const roster = [...tw.starters, ...tw.bench]
        .map(name => {
            const rec = model.players.get(name);
            const w = rec?.weeks[wk];
            return w ? { name, position: rec.position, pts: w.pts, started: w.started } : null;
        })
        .filter(Boolean)
        .sort((a, b) => b.pts - a.pts);

    const used = new Set();
    let total = 0;
    for (const { eligible } of LINEUP_SLOTS) {
        const best = roster.find(p => !used.has(p.name) && eligible.includes(p.position));
        if (best) { used.add(best.name); total += best.pts; }
    }
    return total;
}

export function pointsComparison(model, teamKey) {
    let real = 0, optimal = 0;
    let worstMiss = null; // miglior prestazione lasciata in panchina

    for (const wkStr of Object.keys(model.teamWeeks[teamKey] || {})) {
        const wk = Number(wkStr);
        const tw = model.teamWeeks[teamKey][wk];
        let realWk = 0;
        for (const name of tw.starters) realWk += model.players.get(name)?.weeks[wk]?.pts || 0;
        real += realWk;

        const opt = optimalWeekPoints(model, teamKey, wk);
        optimal += opt !== null ? opt : realWk;

        for (const name of tw.bench) {
            const w = model.players.get(name)?.weeks[wk];
            if (w && (!worstMiss || w.pts > worstMiss.pts)) {
                worstMiss = { name, wk, pts: w.pts };
            }
        }
    }

    let drafted = 0;
    const raw = rawFromTeamKey(model.draft?.teams, teamKey);
    if (raw) {
        for (const p of model.draft.teams[raw] || []) {
            const rec = model.players.get(p.name);
            if (rec) for (const w of Object.values(rec.weeks)) drafted += w.pts;
        }
    }

    return { real, drafted: raw ? drafted : null, optimal, benchLost: optimal - real, worstMiss };
}

/* ============================================================
   FORMAT HELPERS
   ============================================================ */

const fmt = (n, dec = 0) => Number(n || 0).toLocaleString('it-IT', { minimumFractionDigits: dec, maximumFractionDigits: dec });

function keyStatLine(position, s) {
    if (!s) return '';
    switch (position) {
        case 'QB': {
            const parts = [`${fmt(s.pass_yds)} pass yds`, `${fmt(s.pass_td)} TD`, `${fmt(s.pass_int)} INT`];
            if (s.rush_yds) parts.push(`${fmt(s.rush_yds)} rush yds`);
            return parts.join(' · ');
        }
        case 'RB': {
            const parts = [`${fmt(s.rush_yds)} rush yds`, `${fmt(s.rush_td)} TD`];
            if (s.rec) parts.push(`${fmt(s.rec)} rec, ${fmt(s.rec_yds)} yds`);
            return parts.join(' · ');
        }
        case 'WR':
        case 'TE': {
            const parts = [`${fmt(s.rec)} rec`, `${fmt(s.rec_yds)} yds`, `${fmt(s.rec_td)} TD`];
            if (s.rush_yds) parts.push(`${fmt(s.rush_yds)} rush yds`);
            return parts.join(' · ');
        }
        case 'K': {
            const fg = (s.fg_0_19 || 0) + (s.fg_20_29 || 0) + (s.fg_30_39 || 0) + (s.fg_40_49 || 0) + (s.fg_50_plus || 0);
            const parts = [`${fmt(fg)} FG`, `${fmt(s.pat_made)} PAT`];
            if (s.fg_50_plus) parts.push(`${fmt(s.fg_50_plus)} da 50+`);
            return parts.join(' · ');
        }
        case 'DEF': {
            return [`${fmt(s.sack)} sack`, `${fmt((s.def_int || 0) + (s.fum_rec || 0))} TO`, `${fmt(s.def_td)} TD`].join(' · ');
        }
        default:
            return '';
    }
}

function headshotImg(rec, cls = 'an-headshot') {
    return `<img src="images/fallback-player.svg" class="${cls} an-img" loading="lazy"
        data-player-name="${rec.name}" data-team="${rec.nflTeam || ''}" data-pos="${rec.position || ''}" alt="${rec.name}">`;
}

function posBadge(position) {
    const posClass = `pos-${(position || '').toLowerCase().replace('/', '')}`;
    return `<span class="player-pos ${posClass}">${position || '—'}</span>`;
}

// Rank (1-3) di ogni giocatore all'interno del proprio ruolo, per punti totali stagionali
// in TUTTA la lega (non per singolo team): il Top1 di un ruolo è unico per anno,
// indipendentemente da quale team lo abbia in roster.
function leaguePositionRanks(model) {
    const totals = new Map(); // name -> { position, pts }
    for (const rec of model.players.values()) {
        let pts = 0;
        for (const w of Object.values(rec.weeks)) pts += w.pts;
        if (pts > 0) totals.set(rec.name, { position: rec.position, pts });
    }
    const byPos = {};
    for (const [name, t] of totals) {
        if (!byPos[t.position]) byPos[t.position] = [];
        byPos[t.position].push({ name, pts: t.pts });
    }
    const ranks = new Map();
    for (const pos in byPos) {
        const sorted = byPos[pos].sort((a, b) => b.pts - a.pts);
        sorted.slice(0, 3).forEach((r, i) => ranks.set(r.name, i + 1));
    }
    return ranks;
}

function topBadge(name, ranks) {
    const rank = ranks.get(name);
    if (!rank) return '';
    return `<span class="an-badge an-badge-top an-badge-top${rank}">Top ${rank}</span>`;
}

// Round di draft (snake) per ogni pick del team
function draftRoundLookup(model, teamKey) {
    const raw = rawFromTeamKey(model.draft?.teams, teamKey);
    const map = new Map();
    if (!raw) return map;
    const numTeams = Object.keys(model.draft.teams).length || 1;
    for (const p of model.draft.teams[raw] || []) {
        map.set(p.name, Math.ceil(p.pick / numTeams));
    }
    return map;
}

function roundBadge(round) {
    if (!round) return '';
    return `<span class="an-badge an-badge-round">R${round}</span>`;
}

/* ============================================================
   RENDER
   ============================================================ */

async function load() {
    const wrap = document.getElementById('analysis-content');
    if (!wrap) return;
    wrap.innerHTML = `<div class="loading-state"><div class="spinner"></div><p>Caricamento analisi ${currentYear}...</p></div>`;

    let model;
    try {
        model = await buildSeasonModel(currentYear);
    } catch (e) {
        console.error('Analysis load error:', e);
        wrap.innerHTML = `<div class="empty-state"><p class="empty-state-text">Errore nel caricamento: ${e.message}</p></div>`;
        return;
    }
    if (!model) {
        wrap.innerHTML = `<div class="empty-state"><p class="empty-state-text">Nessun dato per la stagione ${currentYear}</p></div>`;
        return;
    }

    render(model);
}

async function render(model) {
    const wrap = document.getElementById('analysis-content');

    if (currentTeam === 'all') {
        wrap.innerHTML = renderLeagueView(model);
        bindCharts(wrap, model);
        return;
    }

    const kpi = pointsComparison(model, currentTeam);

    const tabsHtml = `
        <div class="an-tabs">
            ${TABS.map(t => `<button class="year-pill an-tab${t.id === currentTab ? ' active' : ''}" data-tab="${t.id}">${t.label}</button>`).join('')}
        </div>`;

    const controlsHtml = `
        <div class="an-controls">
            <div class="an-avg-toggle">
                <span class="an-avg-label">Average:</span>
                <button class="an-avg-pill${avgMode === 'total' ? ' active' : ''}" data-avg="total">Total</button>
                <button class="an-avg-pill${avgMode === 'starter' ? ' active' : ''}" data-avg="starter">As starter</button>
            </div>
            <details class="an-legend-box">
                <summary>What do the labels mean?</summary>
                <ul class="an-legend-list">
                    <li><span class="an-badge an-badge-round">R1</span> Draft round in which they were picked (R1 = first round).</li>
                    <li><span class="an-badge an-badge-top an-badge-top1">Top 1</span> Best 1st/2nd/3rd of their position across the whole league that year.</li>
                    <li><span class="an-badge an-badge-in">Added W5</span> In-season pickup: week they joined the roster.</li>
                    <li><span class="an-badge an-badge-drop">Dropped W9</span> Left the roster after that week (<b>Traded</b> if moved to another team).</li>
                    <li><span class="an-badge an-badge-start">On final roster</span> Present on the roster in the last week.</li>
                    <li><b>G</b> = games on roster · <b>Avg</b> = points per game (see selector above) · <b>Points here</b> vs <b>Elsewhere</b> = points scored on this roster vs on others.</li>
                </ul>
            </details>
        </div>`;

    wrap.innerHTML = renderKpi(kpi) + tabsHtml + controlsHtml + `<div class="an-view" id="an-view"><div class="loading-state"><div class="spinner"></div><p>Loading...</p></div></div>`;

    let viewHtml = '';
    switch (currentTab) {
        case 'season': viewHtml = renderSeasonTab(model); break;
        case 'draft': viewHtml = renderDraftTab(model); break;
        case 'market': viewHtml = renderMarketTab(model); break;
        case 'lineup': viewHtml = renderLineupTab(model); break;
        case 'compare': {
            const prevModel = await getPreviousModel(currentYear);
            viewHtml = renderCompareTab(model, prevModel);
            break;
        }
    }

    const viewEl = document.getElementById('an-view');
    if (viewEl) viewEl.innerHTML = viewHtml;
    hydrateImages();
}

async function getPreviousModel(year) {
    const prevYear = String(Number(year) - 1);
    if (!SEASONS.includes(prevYear)) return null;
    try {
        return await buildSeasonModel(prevYear);
    } catch (e) {
        console.error('Errore caricamento anno precedente:', e);
        return null;
    }
}

function renderKpi(kpi) {
    const missHtml = kpi.worstMiss
        ? `<div class="an-kpi-note">Worst miss: <b>${kpi.worstMiss.name}</b> — ${fmt(kpi.worstMiss.pts, 2)} pt left on the bench (W${kpi.worstMiss.wk})</div>`
        : '';
    return `
    <div class="stats-summary an-kpi">
        <div class="summary-stat">
            <div class="summary-stat-value">${fmt(kpi.real)}</div>
            <div class="summary-stat-label">Real Points</div>
        </div>
        <div class="summary-stat">
            <div class="summary-stat-value">${kpi.drafted !== null ? fmt(kpi.drafted) : '—'}</div>
            <div class="summary-stat-label">Drafted Team Points</div>
        </div>
        <div class="summary-stat">
            <div class="summary-stat-value">${fmt(kpi.optimal)}</div>
            <div class="summary-stat-label">Optimal Lineup Points</div>
        </div>
        <div class="summary-stat summary-stat--accent">
            <div class="summary-stat-value">−${fmt(kpi.benchLost)}</div>
            <div class="summary-stat-label">Points Left on the Bench</div>
        </div>
    </div>
    ${missHtml}`;
}

function renderSeasonTab(model) {
    const rows = seasonView(model, currentTeam);
    if (!rows.length) return emptyState('No player found for this team');

    // Nomi draftati dal team, per distinguere gli innesti in-season
    const draftedNames = new Set();
    const raw = rawFromTeamKey(model.draft?.teams, currentTeam);
    if (raw) for (const p of model.draft.teams[raw] || []) draftedNames.add(p.name);

    const rounds = draftRoundLookup(model, currentTeam);
    const ranks = leaguePositionRanks(model);

    return `
    <div class="an-list-head">
        <span></span><span>Player</span><span>G</span><span>Points</span><span>Avg</span><span class="an-head-stats">Stats</span><span></span>
    </div>
    ${rows.map(({ rec, agg }) => {
        const badges = [];
        // Round di draft, se questo giocatore è stato draftato dal team
        const round = rounds.get(rec.name);
        if (round) badges.push(roundBadge(round));
        // "Preso": innesto in-season (non draftato) o comunque arrivato dopo W1
        if (raw && !draftedNames.has(rec.name)) {
            badges.push(`<span class="an-badge an-badge-in">Added W${agg.firstWeek}</span>`);
        } else if (agg.firstWeek > 1) {
            badges.push(`<span class="an-badge an-badge-in">Since W${agg.firstWeek}</span>`);
        }
        // "Svincolato": non è più nel roster dell'ultima settimana disputata
        if (agg.lastWeekOn < model.lastWeek) {
            const w = rec.weeks[model.lastWeek];
            const label = w && w.teamKey !== currentTeam
                ? `Traded after W${agg.lastWeekOn}`
                : `Dropped after W${agg.lastWeekOn}`;
            badges.push(`<span class="an-badge an-badge-drop">${label}</span>`);
        }
        badges.push(topBadge(rec.name, ranks));
        return playerRow(rec, agg, badges.join(' '));
    }).join('')}`;
}

function playerRow(rec, agg, extraBadge = '') {
    return `
    <div class="an-player-row" data-player="${encodeURIComponent(rec.name)}">
        ${headshotImg(rec)}
        <span class="an-player-name">${rec.name} ${posBadge(rec.position)} ${extraBadge}</span>
        <span class="an-cell">${agg.games}</span>
        <span class="an-cell an-pts">${fmt(agg.pts, 2)}</span>
        <span class="an-cell">${fmt(avgOf(agg), 1)}</span>
        <span class="an-keystats">${keyStatLine(rec.position, agg.stats)}</span>
        <span class="an-chevron">›</span>
    </div>
    <div class="an-week-drill" data-drill="${encodeURIComponent(rec.name)}" hidden></div>`;
}

function renderDraftTab(model) {
    const picks = draftView(model, currentTeam);
    if (!picks) return emptyState(`Draft data not available for ${currentYear}`);

    const ranks = leaguePositionRanks(model);

    return `
    <div class="an-list-head">
        <span></span><span>Pick · Player</span><span>G</span><span>Points</span><span>Avg</span><span class="an-head-stats">Stats</span><span></span>
    </div>
    ${picks.map(({ pick, rec, agg }) => {
        if (!rec || !agg || agg.games === 0) {
            return `
            <div class="an-player-row an-row-static">
                <img src="images/fallback-player.svg" class="an-headshot an-img" loading="lazy" data-player-name="${pick.name}" data-team="${pick.nfl_team || ''}" data-pos="${pick.position || ''}" alt="${pick.name}">
                <span class="an-player-name"><span class="an-pick-num">#${pick.pick}</span> ${pick.name} ${posBadge(pick.position)} <span class="an-badge an-badge-drop">Never fielded</span></span>
                <span class="an-cell">0</span><span class="an-cell an-pts">0</span><span class="an-cell">—</span>
                <span class="an-keystats"></span><span></span>
            </div>`;
        }
        const dropped = model.seasonOver && agg.lastWeekOn < model.lastWeek;
        const badge = dropped ? `<span class="an-badge an-badge-drop">Dropped after W${agg.lastWeekOn}</span>` : '';
        return playerRow(rec, agg, `<span class="an-pick-num">#${pick.pick}</span> ${badge} ${topBadge(rec.name, ranks)}`);
    }).join('')}`;
}

function renderMarketTab(model) {
    const { finalRoster, additions, hasDraft } = marketView(model, currentTeam);
    const ranks = leaguePositionRanks(model);

    const additionsHtml = additions.length ? `
        <h3 class="an-sub-title">In-season pickups${hasDraft ? '' : ' (draft not available)'}</h3>
        <div class="an-list-head">
            <span></span><span>Player</span><span>G</span><span>Points</span><span>Avg</span><span class="an-head-stats">Stats</span><span></span>
        </div>
        ${additions.map(({ rec, agg, elsewhere, onFinal }) => {
        const badges = [`<span class="an-badge an-badge-in">Added W${agg.firstWeek}</span>`];
        if (agg.lastWeekOn < model.lastWeek) {
            const w = rec.weeks[model.lastWeek];
            badges.push(`<span class="an-badge an-badge-drop">${w && w.teamKey !== currentTeam ? 'Traded' : 'Dropped'} after W${agg.lastWeekOn}</span>`);
        }
        if (elsewhere > 0) badges.push(`<span class="an-badge an-badge-away">Elsewhere ${fmt(elsewhere, 0)} pt</span>`);
        if (onFinal) badges.push('<span class="an-badge an-badge-start">On final roster</span>');
        badges.push(topBadge(rec.name, ranks));
        return playerRow(rec, agg, badges.join(' '));
    }).join('')}
        <p class="an-footnote">"Elsewhere" = points scored in the weeks the player was on another team's roster. Weeks as a free agent aren't tracked.</p>
    ` : `<h3 class="an-sub-title">In-season pickups</h3>${emptyState('No pickups: roster unchanged from the draft')}`;

    const finalHtml = finalRoster.length ? `
        <h3 class="an-sub-title">Final roster (W${model.lastWeek})</h3>
        <div class="an-final-roster">
            ${finalRoster.map(({ rec, agg, drafted }) => `
            <span class="an-roster-chip${drafted ? '' : ' an-roster-chip--add'}" title="${fmt(agg.pts, 2)} pt">
                ${rec.name} <b>${fmt(agg.pts, 0)}</b>
            </span>`).join('')}
        </div>
        <p class="an-footnote">In <span class="an-split-here">red</span> the pickups added during the season, the number is the total points for the team.</p>
    ` : '';

    return additionsHtml + finalHtml;
}

function renderLineupTab(model) {
    const slots = lineupView(model, currentTeam);
    const ranks = leaguePositionRanks(model);
    return `
    <h3 class="an-sub-title">Best lineup ${currentYear} — top performer per slot</h3>
    <div class="an-lineup-grid">
        ${slots.map(({ slot, row }) => {
        if (!row) {
            return `<div class="an-lineup-card an-lineup-card--empty"><div class="an-lineup-slot">${slot}</div><div class="an-lineup-name">—</div></div>`;
        }
        const { rec, agg } = row;
        return `
        <div class="an-lineup-card">
            <div class="an-lineup-slot">${slot}</div>
            <div class="an-lineup-img-wrap">
                ${headshotImg(rec, 'an-lineup-headshot')}
            </div>
            <div class="an-lineup-name">${rec.name}</div>
            <div class="an-lineup-meta">${posBadge(rec.position)} ${topBadge(rec.name, ranks)} <span class="an-lineup-nfl">${rec.nflTeam || ''}</span></div>
            <div class="an-lineup-pts">${fmt(agg.pts, 2)} <span>pt</span></div>
            <div class="an-lineup-avg">${fmt(avgOf(agg), 1)} avg · ${agg.games} G</div>
        </div>`;
    }).join('')}
    </div>`;
}

function renderCompareTab(model, prevModel) {
    const prevYear = Number(currentYear) - 1;
    if (!prevModel) {
        return emptyState(`No data available for ${prevYear} (probably the league's first season)`);
    }

    const ranks = leaguePositionRanks(model);
    const rows = seasonView(model, currentTeam).map(({ rec, agg }) => {
        const prevRec = prevModel.players.get(rec.name);
        let prevPts = null;
        if (prevRec) {
            prevPts = 0;
            for (const w of Object.values(prevRec.weeks)) prevPts += w.pts;
        }
        return { rec, agg, prevPts };
    });
    if (!rows.length) return emptyState('No player found for this team');

    return `
    <div class="an-list-head an-list-head-compare">
        <span></span><span>Player</span><span>${currentYear} Points</span><span>${prevYear} Points</span><span>Δ</span><span></span>
    </div>
    ${rows.map(r => compareRow(r, ranks)).join('')}`;
}

function compareRow({ rec, agg, prevPts }, ranks) {
    const delta = prevPts !== null ? agg.pts - prevPts : null;
    const deltaClass = delta === null ? '' : delta >= 0 ? 'an-delta-up' : 'an-delta-down';
    const deltaText = delta === null ? 'Rookie/N.A.' : `${delta >= 0 ? '+' : ''}${fmt(delta, 1)}`;
    return `
    <div class="an-player-row" data-player="${encodeURIComponent(rec.name)}">
        ${headshotImg(rec)}
        <span class="an-player-name">${rec.name} ${posBadge(rec.position)} ${topBadge(rec.name, ranks)}</span>
        <span class="an-cell an-pts">${fmt(agg.pts, 2)}</span>
        <span class="an-cell">${prevPts !== null ? fmt(prevPts, 2) : '—'}</span>
        <span class="an-cell ${deltaClass}">${deltaText}</span>
        <span class="an-chevron">›</span>
    </div>
    <div class="an-week-drill" data-drill="${encodeURIComponent(rec.name)}" hidden></div>`;
}

function emptyState(text) {
    return `<div class="empty-state"><p class="empty-state-text">${text}</p></div>`;
}

/* ============================================================
   DRILL-DOWN + IMAGES
   ============================================================ */

function bindContentEvents() {
    const wrap = document.getElementById('analysis-content');
    if (!wrap) return;

    wrap.addEventListener('click', (e) => {
        const tab = e.target.closest('.an-tab');
        if (tab) {
            currentTab = tab.dataset.tab;
            const model = modelCache[currentYear];
            if (model) render(model);
            return;
        }

        const avgBtn = e.target.closest('.an-avg-pill');
        if (avgBtn) {
            avgMode = avgBtn.dataset.avg;
            const model = modelCache[currentYear];
            if (model) render(model);
            return;
        }

        const ptsBtn = e.target.closest('.an-ptbl-mode-pill');
        if (ptsBtn) {
            rosterPtsMode[ptsBtn.dataset.ptsSection] = ptsBtn.dataset.ptsMode;
            const model = modelCache[currentYear];
            if (model) render(model);
            return;
        }

        const moreBtn = e.target.closest('.an-ptbl-more-btn');
        if (moreBtn) {
            const moreRow = moreBtn.closest('.an-ptbl-more-row');
            const tableWrap = moreBtn.closest('.an-ptbl-wrap');
            const extraRows = tableWrap ? [...tableWrap.querySelectorAll('.an-ptbl-extra-row')] : [];
            const collapsing = moreBtn.dataset.expanded === '1';
            extraRows.forEach(r => r.hidden = collapsing);
            moreBtn.dataset.expanded = collapsing ? '0' : '1';
            moreBtn.textContent = collapsing ? moreBtn.dataset.showLabel : 'Hide';
            return;
        }

        const row = e.target.closest('.an-player-row');
        if (!row || row.classList.contains('an-row-static')) return;
        const name = row.dataset.player;
        if (!name) return;
        const drill = wrap.querySelector(`.an-week-drill[data-drill="${name}"]`);
        if (!drill) return;

        const expanded = row.classList.toggle('expanded');
        drill.hidden = !expanded;
        if (expanded && !drill.dataset.loaded) {
            drill.innerHTML = currentTab === 'compare'
                ? compareWeekDrillHtml(decodeURIComponent(name))
                : weekDrillHtml(decodeURIComponent(name));
            drill.dataset.loaded = '1';
        }
    });
}

function drillRow(rec, w, withTeam = false) {
    const teamCell = withTeam ? `<span class="an-drill-team">${TEAMS[w.teamKey]?.name || ''}</span>` : '';
    return `
        <div class="an-drill-row${withTeam ? ' an-drill-row--team' : ''}">
            <span class="an-drill-week">W${w.wk}</span>
            <span class="an-drill-opp">${w.opponent || '—'}</span>
            ${teamCell}
            <span class="an-drill-pts">${fmt(w.pts, 2)}</span>
            <span class="an-drill-stats">${keyStatLine(rec.position, w.stats)}</span>
            <span class="an-badge ${w.started ? 'an-badge-start' : 'an-badge-bench'}">${w.started ? 'Starter' : 'Bench'}</span>
        </div>`;
}

function weekDrillHtml(playerName) {
    const model = modelCache[currentYear];
    const rec = model?.players.get(playerName);
    if (!rec) return '';

    const weeks = Object.entries(rec.weeks)
        .map(([wk, w]) => ({ wk: Number(wk), ...w }))
        .filter(w => w.teamKey === currentTeam)
        .sort((a, b) => a.wk - b.wk);

    return weeks.map(w => drillRow(rec, w)).join('');
}

// Drill-down della tab Confronto: settimane dell'anno corrente affiancate a quelle dell'anno precedente
function compareWeekDrillHtml(playerName) {
    const model = modelCache[currentYear];
    const prevYear = String(Number(currentYear) - 1);
    const prevModel = modelCache[prevYear];
    const rec = model?.players.get(playerName);
    if (!rec) return '';

    const curWeeks = Object.entries(rec.weeks)
        .map(([wk, w]) => ({ wk: Number(wk), ...w }))
        .filter(w => w.teamKey === currentTeam)
        .sort((a, b) => a.wk - b.wk);

    const curBlock = `
        <div class="an-drill-season-label">${currentYear}</div>
        ${curWeeks.length ? curWeeks.map(w => drillRow(rec, w)).join('') : `<p class="an-footnote">No weeks on this team.</p>`}`;

    let prevBlock;
    if (!prevModel) {
        prevBlock = `<div class="an-drill-season-label">${prevYear}</div><p class="an-footnote">Data not available.</p>`;
    } else {
        const prevRec = prevModel.players.get(playerName);
        if (!prevRec) {
            prevBlock = `<div class="an-drill-season-label">${prevYear}</div><p class="an-footnote">Not present in that year's fantasy data.</p>`;
        } else {
            const prevWeeks = Object.entries(prevRec.weeks)
                .map(([wk, w]) => ({ wk: Number(wk), ...w }))
                .sort((a, b) => a.wk - b.wk);
            prevBlock = `
                <div class="an-drill-season-label">${prevYear}</div>
                ${prevWeeks.map(w => drillRow(prevRec, w, true)).join('')}`;
        }
    }

    return `
    <div class="an-drill-compare">
        <div class="an-drill-season">${curBlock}</div>
        <div class="an-drill-season">${prevBlock}</div>
    </div>`;
}

function hydrateImages() {
    const images = document.querySelectorAll('#analysis-content .an-img');
    images.forEach(async (img) => {
        const name = img.dataset.playerName;
        if (!name) return;

        img.onerror = () => {
            if (!img.src.endsWith('images/fallback-player.svg')) {
                img.src = 'images/fallback-player.svg';
            }
        };

        try {
            const url = await playerImageService.getPlayerImageUrl(name, img.dataset.team, img.dataset.pos, currentYear);
            if (url) img.src = url;
        } catch (e) {
            /* fallback già impostato */
        }
    });
}

/* ============================================================
   VISTA TOTALE (LEGA)
   ============================================================ */

// Colori serie per i grafici: stessa identità dei team ma step schiariti
// per restare leggibili sulla superficie nera (oscurus/sommo sono troppo scuri).
const CHART_COLORS = { capi: '#FF6600', lasers: '#D4AF37', oscurus: '#d4506a', sommo: '#4fa3b8' };
const ROLES = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];

function weeklyScores(model) {
    const teams = Object.values(TEAMS).map(t => {
        const values = [];
        let cumulative = 0;
        for (let wk = 1; wk <= model.lastWeek; wk++) {
            const tw = model.teamWeeks[t.key]?.[wk];
            if (tw) {
                cumulative += tw.score;
                values.push({ wk, cum: cumulative, weekScore: tw.score, score: cumulative });
            }
        }
        return { key: t.key, name: t.name, color: CHART_COLORS[t.key] || '#888', values };
    }).filter(s => s.values.length > 0);

    // score = distacco cumulativo dalla media di lega a quella settimana
    // (linee attorno a 0 → differenze molto più leggibili di quelle cumulative pure)
    for (let wk = 1; wk <= model.lastWeek; wk++) {
        const cums = [];
        for (const s of teams) {
            const v = s.values.find(x => x.wk === wk);
            if (v) cums.push(v.cum);
        }
        if (!cums.length) continue;
        const mean = cums.reduce((a, b) => a + b, 0) / cums.length;
        for (const s of teams) {
            const v = s.values.find(x => x.wk === wk);
            if (v) v.score = v.cum - mean;
        }
    }
    return teams;
}

function roleBreakdown(model) {
    return Object.values(TEAMS).map(t => {
        const byRole = {};
        for (const [wkStr, tw] of Object.entries(model.teamWeeks[t.key] || {})) {
            const wk = Number(wkStr);
            for (const name of tw.starters) {
                const rec = model.players.get(name);
                const w = rec?.weeks[wk];
                if (!w) continue;
                if (!ROLES.includes(rec.position)) continue;
                byRole[rec.position] = (byRole[rec.position] || 0) + w.pts;
            }
        }
        return { key: t.key, name: t.name, color: CHART_COLORS[t.key] || '#888', byRole };
    });
}

function leagueRankings(model) {
    const rows = Object.values(TEAMS).map(t => {
        const kpi = pointsComparison(model, t.key);
        const { additions } = marketView(model, t.key);
        const pickupPts = additions.reduce((s, a) => s + a.agg.pts, 0);
        const topPickup = additions[0] || null;
        const draftPicks = (draftView(model, t.key) || []).filter(p => p.rec && p.agg);
        const topDraft = draftPicks.length
            ? draftPicks.reduce((best, p) => p.agg.pts > best.agg.pts ? p : best)
            : null;
        return {
            key: t.key, name: t.name, color: CHART_COLORS[t.key] || '#888',
            drafted: kpi.drafted, pickupPts, topPickup, topDraft, benchLost: kpi.benchLost, worstMiss: kpi.worstMiss,
        };
    });
    return {
        draft: [...rows].sort((a, b) => (b.drafted || 0) - (a.drafted || 0)),
        pickups: [...rows].sort((a, b) => b.pickupPts - a.pickupPts),
        bench: [...rows].sort((a, b) => b.benchLost - a.benchLost),
    };
}

function scoreDistribution(model) {
    return Object.values(TEAMS).map(t => {
        const scores = Object.values(model.teamWeeks[t.key] || {}).map(tw => tw.score);
        if (!scores.length) return null;
        const sorted = [...scores].sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
        return { key: t.key, name: t.name, color: CHART_COLORS[t.key] || '#888', min: sorted[0], median, max: sorted[sorted.length - 1] };
    }).filter(Boolean);
}

function draftValueScatter(model) {
    const points = [];
    for (const t of Object.values(TEAMS)) {
        const raw = rawFromTeamKey(model.draft?.teams, t.key);
        if (!raw) continue;
        for (const pick of model.draft.teams[raw] || []) {
            const rec = model.players.get(pick.name);
            const agg = rec ? aggregateOnTeam(rec, t.key) : null;
            points.push({
                pick: pick.pick, name: pick.name, position: pick.position,
                teamKey: t.key, teamName: t.name, color: CHART_COLORS[t.key] || '#888',
                pts: agg ? agg.pts : 0,
            });
        }
    }
    return points.sort((a, b) => a.pick - b.pick);
}

function topFlopPerformances(model, limit = 10) {
    const rows = [];
    for (const rec of model.players.values()) {
        for (const [wkStr, w] of Object.entries(rec.weeks)) {
            if (!w.started) continue; // solo prestazioni da titolare
            rows.push({ name: rec.name, position: rec.position, teamKey: w.teamKey, wk: Number(wkStr), pts: w.pts });
        }
    }
    rows.sort((a, b) => b.pts - a.pts);
    return {
        top: rows.slice(0, limit),
        flop: rows.slice(-limit).reverse(), // peggiore in cima
    };
}

function renderLeagueView(model) {
    const series = weeklyScores(model);
    if (!series.length) return emptyState(`No data for the ${currentYear} season`);

    const allScores = series.flatMap(s => s.values.map(v => v.weekScore));
    const totalPts = allScores.reduce((a, b) => a + b, 0);
    const avgPts = totalPts / allScores.length;
    let bestWeek = { weekScore: -1 };
    let worstWeek = { weekScore: Infinity };
    for (const s of series) {
        for (const v of s.values) {
            if (v.weekScore > bestWeek.weekScore) bestWeek = { ...v, name: s.name };
            if (v.weekScore > 0 && v.weekScore < worstWeek.weekScore) worstWeek = { ...v, name: s.name };
        }
    }

    const legend = `
    <div class="an-chart-legend">
        ${series.map(s => `<span class="an-legend-item"><span class="an-legend-key" style="background:${s.color}"></span>${s.name}</span>`).join('')}
    </div>`;

    const rk = leagueRankings(model);
    const topFlop = topFlopPerformances(model, 5);

    return `
    <div class="stats-summary an-kpi">
        <div class="summary-stat">
            <div class="summary-stat-value">${fmt(totalPts)}</div>
            <div class="summary-stat-label">Total League Points</div>
        </div>
        <div class="summary-stat">
            <div class="summary-stat-value">${fmt(avgPts, 1)}</div>
            <div class="summary-stat-label">Average per Game</div>
        </div>
        <div class="summary-stat summary-stat--accent">
            <div class="summary-stat-value">${fmt(bestWeek.weekScore, 1)}</div>
            <div class="summary-stat-label">Top Week — ${bestWeek.name} (W${bestWeek.wk})</div>
        </div>
        <div class="summary-stat">
            <div class="summary-stat-value">${fmt(worstWeek.weekScore, 1)}</div>
            <div class="summary-stat-label">Flop Week — ${worstWeek.name} (W${worstWeek.wk})</div>
        </div>
    </div>

    <h3 class="an-sub-title">Cumulative gap from league average</h3>
    ${legend}
    <div class="an-chart" id="an-line-chart">${buildLineChart(series)}<div class="an-chart-tooltip" hidden></div></div>
    <p class="an-footnote">Each line is the team's cumulative score minus the league average at the same week: above 0 = above average, below = below. The tooltip shows the real cumulative total.</p>

    <h3 class="an-sub-title">Points by position (starters)</h3>
    ${legend}
    <div class="an-chart" id="an-role-chart">${buildRoleChart(roleBreakdown(model))}<div class="an-chart-tooltip" hidden></div></div>

    <div class="an-rankings">
        ${rankingBlock('Best Draft', rk.draft, r => r.drafted, r => r.topDraft ? `Top: ${r.topDraft.rec.name} (${fmt(r.topDraft.agg.pts, 0)} pt)` : null, 'win')}
        ${rankingBlock('Best Pickups', rk.pickups, r => r.pickupPts, r => r.topPickup ? `Top: ${r.topPickup.rec.name} (${fmt(r.topPickup.agg.pts, 0)} pt)` : null, 'win')}
        ${rankingBlock('Points Left on the Bench', rk.bench, r => r.benchLost, r => r.worstMiss ? `Worst miss: ${r.worstMiss.name}, ${fmt(r.worstMiss.pts, 1)} pt (W${r.worstMiss.wk})` : null, 'loss')}
    </div>

    <h3 class="an-sub-title">Scoring Consistency</h3>
    ${buildDistributionChart(scoreDistribution(model))}

    <h3 class="an-sub-title">Draft: Value per Pick</h3>
    ${legend}
    ${buildDraftScatterSection(draftValueScatter(model))}

    <div class="an-rankings">
        ${rankingBlockPerf('Top 5 Performance', topFlop.top, 'top')}
        ${rankingBlockPerf('Flop 5 Performance', topFlop.flop, 'flop')}
    </div>

    <h3 class="an-sub-title">Roster Comparison — Drafted Team</h3>
    ${buildRosterCompareTable(model, 'drafted')}

    <h3 class="an-sub-title">Roster Comparison — Best Team</h3>
    ${buildRosterCompareTable(model, 'best')}
    <p class="an-footnote">Starting slots filled with the best available player at the position (W/R = flex RB/WR/TE) among everyone who passed through the roster that season; below the line, the bench players. "Starters" = sum of starting slots only, "Total" = every player on the roster.</p>

    <h3 class="an-sub-title">Pickups Comparison</h3>
    ${buildPickupsCompareTable(model)}
    <p class="an-footnote">In-season pickups sorted by points scored (best first), not by position.</p>`;
}

function seasonTotalPts(rec) {
    let p = 0;
    for (const w of Object.values(rec.weeks)) p += w.pts;
    return p;
}

// Assegna i migliori giocatori agli slot del lineup titolare; il resto va in panchina.
// L'ordinamento segue la metrica attualmente selezionata per la sezione (totale o punti/partita).
function assignLineup(players, section) {
    const pool = [...players].sort((a, b) => ptblValue(b.pts, b.games, section) - ptblValue(a.pts, a.games, section));
    const used = new Set();
    const starters = LINEUP_SLOTS.map(({ eligible }) => {
        const idx = pool.findIndex((p, i) => !used.has(i) && eligible.includes(p.pos));
        if (idx === -1) return null;
        used.add(idx);
        return pool[idx];
    });
    const bench = pool.filter((_, i) => !used.has(i));
    const startersPts = starters.reduce((s, p) => s + (p ? p.pts : 0), 0);
    const startersGames = starters.reduce((s, p) => s + (p ? p.games : 0), 0);
    const totalPts = pool.reduce((s, p) => s + p.pts, 0);
    const totalGames = pool.reduce((s, p) => s + p.games, 0);
    return { starters, bench, startersPts, startersGames, totalPts, totalGames };
}

// Valore da mostrare secondo rosterPtsMode[section]: punti totali o punti a partita
function ptblValue(pts, games, section) {
    if (pts === null || pts === undefined) return null;
    if (rosterPtsMode[section] === 'pg') return games ? pts / games : 0;
    return pts;
}

function ptblModeToggleHtml(section) {
    const mode = rosterPtsMode[section];
    return `
    <div class="an-avg-toggle an-ptbl-mode-toggle">
        <button class="an-ptbl-mode-pill${mode === 'total' ? ' active' : ''}" data-pts-section="${section}" data-pts-mode="total">Total Points</button>
        <button class="an-ptbl-mode-pill${mode === 'pg' ? ' active' : ''}" data-pts-section="${section}" data-pts-mode="pg">Points per Game</button>
    </div>`;
}

// Righe oltre questa soglia vengono nascoste dietro un pulsante "Mostra altri"
const PTBL_COLLAPSE_AFTER = 10;

function collapseRowsHtml(rows, colspan, label) {
    if (rows.length <= PTBL_COLLAPSE_AFTER) return rows.join('');
    const visible = rows.slice(0, PTBL_COLLAPSE_AFTER).join('');
    const hidden = rows.slice(PTBL_COLLAPSE_AFTER)
        .map(r => r.replace('<tr>', '<tr class="an-ptbl-extra-row" hidden>'))
        .join('');
    const hiddenCount = rows.length - PTBL_COLLAPSE_AFTER;
    const showLabel = `Show ${hiddenCount} more ${label}`;
    const moreRow = `
        <tr class="an-ptbl-more-row">
            <td colspan="${colspan}"><button class="an-ptbl-more-btn" data-expanded="0" data-show-label="${showLabel}">${showLabel}</button></td>
        </tr>`;
    return visible + hidden + moreRow;
}

// Tabella confronto rose: colonne = team, righe = slot titolari + panchinari + somme
function buildRosterCompareTable(model, mode) {
    const teams = Object.values(TEAMS).map(t => {
        let players;
        if (mode === 'drafted') {
            const raw = rawFromTeamKey(model.draft?.teams, t.key);
            if (!raw) return { key: t.key, name: t.name, color: CHART_COLORS[t.key] || '#888', missing: true };
            players = (model.draft.teams[raw] || []).map(pick => {
                const rec = model.players.get(pick.name);
                return { name: pick.name, pos: rec?.position || pick.position, pts: rec ? seasonTotalPts(rec) : 0, games: rec ? Object.keys(rec.weeks).length : 0 };
            });
        } else {
            // 'best': tutti i giocatori passati dalla rosa in stagione (non solo quelli finali)
            players = seasonView(model, t.key).map(({ rec, agg }) => ({ name: rec.name, pos: rec.position, pts: agg.pts, games: agg.games }));
        }
        return { key: t.key, name: t.name, color: CHART_COLORS[t.key] || '#888', ...assignLineup(players, mode) };
    });

    if (mode === 'drafted' && teams.every(t => t.missing)) {
        return emptyState(`Draft data not available for ${currentYear}`);
    }

    const maxBench = Math.max(0, ...teams.map(t => (t.bench || []).length));
    const decimals = rosterPtsMode[mode] === 'pg' ? 1 : 0;

    // Delta rispetto al migliore della stessa riga (0 = leader di riga, in oro)
    const rowMaxOf = (arr) => { const n = arr.filter(v => v !== null && v !== undefined); return n.length ? Math.max(...n) : null; };
    const delta = (val, rowMax) => {
        if (val === null || val === undefined || rowMax === null) return '';
        const gap = rowMax - val;
        return gap <= 0.05
            ? '<span class="an-ptbl-delta an-ptbl-delta--best">0</span>'
            : `<span class="an-ptbl-delta">−${fmt(gap, decimals)}</span>`;
    };
    const isLeader = (val, rowMax) => val !== null && val !== undefined && rowMax !== null && (rowMax - val) <= 0.05;
    const playerCell = (p, rowMax) => {
        if (!p) return '<span class="an-ptbl-empty">—</span>';
        const val = ptblValue(p.pts, p.games, mode);
        const leader = isLeader(val, rowMax);
        return `<span class="an-ptbl-name${leader ? ' an-ptbl-name--best' : ''}">${p.name}</span><span class="an-ptbl-pos">${p.pos}</span><span class="an-ptbl-val"><b class="an-ptbl-pts${leader ? ' an-ptbl-pts--best' : ''}">${fmt(val, decimals)}</b>${delta(val, rowMax)}</span>`;
    };
    const emptyTd = '<td class="an-ptbl-cell"><span class="an-ptbl-empty">—</span></td>';

    // Righe slot titolari
    let body = LINEUP_SLOTS.map((slot, si) => {
        const arr = teams.map(t => t.missing ? null : (t.starters?.[si] ? ptblValue(t.starters[si].pts, t.starters[si].games, mode) : null));
        const rowMax = rowMaxOf(arr);
        return `
        <tr>
            <td class="an-ptbl-slot">${slot.slot}</td>
            ${teams.map(t => t.missing ? emptyTd : `<td class="an-ptbl-cell">${playerCell(t.starters?.[si], rowMax)}</td>`).join('')}
        </tr>`;
    }).join('');

    body += `<tr class="an-ptbl-seprow"><td colspan="${teams.length + 1}"></td></tr>`;

    // Righe panchina (collassate oltre PTBL_COLLAPSE_AFTER)
    const benchRows = [];
    for (let i = 0; i < maxBench; i++) {
        const arr = teams.map(t => t.missing ? null : (t.bench?.[i] ? ptblValue(t.bench[i].pts, t.bench[i].games, mode) : null));
        const rowMax = rowMaxOf(arr);
        benchRows.push(`
        <tr>
            <td class="an-ptbl-slot an-ptbl-slot--bn">BN</td>
            ${teams.map(t => t.missing ? emptyTd : `<td class="an-ptbl-cell">${playerCell(t.bench?.[i], rowMax)}</td>`).join('')}
        </tr>`);
    }
    body += collapseRowsHtml(benchRows, teams.length + 1, 'bench players');

    // Righe somma (delta anche qui)
    const sumRow = (label, ptsFn, gamesFn, extraClass = '') => {
        const arr = teams.map(t => t.missing ? null : ptblValue(ptsFn(t), gamesFn(t), mode));
        const rowMax = rowMaxOf(arr);
        return `
        <tr class="an-ptbl-sumrow${extraClass}">
            <td class="an-ptbl-slot">${label}</td>
            ${teams.map((t, ti) => {
            if (t.missing) return `<td class="an-ptbl-cell"><span class="an-ptbl-empty">—</span></td>`;
            const leader = isLeader(arr[ti], rowMax);
            return `<td class="an-ptbl-cell"><span class="an-ptbl-val"><b class="an-ptbl-pts${leader ? ' an-ptbl-pts--best' : ''}">${fmt(arr[ti], decimals)}</b>${delta(arr[ti], rowMax)}</span></td>`;
        }).join('')}
        </tr>`;
    };
    body += sumRow('Starters', t => t.startersPts, t => t.startersGames);
    body += sumRow('Total', t => t.totalPts, t => t.totalGames, ' an-ptbl-sumrow--total');

    return `
    ${ptblModeToggleHtml(mode)}
    <div class="an-ptbl-wrap">
        <table class="an-ptbl">
            <thead><tr>
                <th></th>
                ${teams.map(t => `<th style="color:${t.color}">${t.name}</th>`).join('')}
            </tr></thead>
            <tbody>${body}</tbody>
        </table>
    </div>`;
}

// Tabella confronto innesti: righe in ordine di punti (non di ruolo/rosa)
function buildPickupsCompareTable(model) {
    const section = 'pickups';
    const teams = Object.values(TEAMS).map(t => {
        const additions = marketView(model, t.key).additions
            .map(({ rec, agg }) => ({ name: rec.name, pos: rec.position, pts: agg.pts, games: agg.games }))
            .sort((a, b) => ptblValue(b.pts, b.games, section) - ptblValue(a.pts, a.games, section));
        const totalPts = additions.reduce((s, p) => s + p.pts, 0);
        const totalGames = additions.reduce((s, p) => s + p.games, 0);
        return { key: t.key, name: t.name, color: CHART_COLORS[t.key] || '#888', additions, totalPts, totalGames };
    });

    const maxRows = Math.max(0, ...teams.map(t => t.additions.length));
    if (!maxRows) return emptyState('No pickups this season for any team');

    const decimals = rosterPtsMode[section] === 'pg' ? 1 : 0;
    const rowMaxOf = (arr) => { const n = arr.filter(v => v !== null && v !== undefined); return n.length ? Math.max(...n) : null; };
    const delta = (val, rowMax) => {
        if (val === null || val === undefined || rowMax === null) return '';
        const gap = rowMax - val;
        return gap <= 0.05
            ? '<span class="an-ptbl-delta an-ptbl-delta--best">0</span>'
            : `<span class="an-ptbl-delta">−${fmt(gap, decimals)}</span>`;
    };
    const isLeader = (val, rowMax) => val !== null && val !== undefined && rowMax !== null && (rowMax - val) <= 0.05;
    const playerCell = (p, rowMax) => {
        if (!p) return '<span class="an-ptbl-empty">—</span>';
        const val = ptblValue(p.pts, p.games, section);
        const leader = isLeader(val, rowMax);
        return `<span class="an-ptbl-name${leader ? ' an-ptbl-name--best' : ''}">${p.name}</span><span class="an-ptbl-pos">${p.pos}</span><span class="an-ptbl-val"><b class="an-ptbl-pts${leader ? ' an-ptbl-pts--best' : ''}">${fmt(val, decimals)}</b>${delta(val, rowMax)}</span>`;
    };

    const rows = [];
    for (let i = 0; i < maxRows; i++) {
        const arr = teams.map(t => t.additions[i] ? ptblValue(t.additions[i].pts, t.additions[i].games, section) : null);
        const rowMax = rowMaxOf(arr);
        rows.push(`
        <tr>
            <td class="an-ptbl-slot">#${i + 1}</td>
            ${teams.map(t => `<td class="an-ptbl-cell">${playerCell(t.additions[i], rowMax)}</td>`).join('')}
        </tr>`);
    }
    let body = collapseRowsHtml(rows, teams.length + 1, 'pickups');

    const totalArr = teams.map(t => ptblValue(t.totalPts, t.totalGames, section));
    const totalRowMax = rowMaxOf(totalArr);
    body += `
        <tr class="an-ptbl-sumrow an-ptbl-sumrow--total">
            <td class="an-ptbl-slot">Total</td>
            ${teams.map((t, ti) => {
        const leader = isLeader(totalArr[ti], totalRowMax);
        return `<td class="an-ptbl-cell"><span class="an-ptbl-val"><b class="an-ptbl-pts${leader ? ' an-ptbl-pts--best' : ''}">${fmt(totalArr[ti], decimals)}</b>${delta(totalArr[ti], totalRowMax)}</span></td>`;
    }).join('')}
        </tr>`;

    return `
    ${ptblModeToggleHtml(section)}
    <div class="an-ptbl-wrap">
        <table class="an-ptbl">
            <thead><tr>
                <th></th>
                ${teams.map(t => `<th style="color:${t.color}">${t.name}</th>`).join('')}
            </tr></thead>
            <tbody>${body}</tbody>
        </table>
    </div>`;
}

function buildDistributionChart(rows) {
    if (!rows.length) return emptyState('No scoring data available');
    const maxVal = Math.max(...rows.map(r => r.max), 1);
    return `
    <div class="an-dist-chart">
        ${rows.map(r => `
        <div class="an-dist-row">
            <span class="an-dist-name">${r.name}</span>
            <span class="an-dist-track">
                <span class="an-dist-range" style="left:${(r.min / maxVal * 100).toFixed(1)}%; width:${((r.max - r.min) / maxVal * 100).toFixed(1)}%; background:${r.color}"></span>
                <span class="an-dist-median" style="left:${(r.median / maxVal * 100).toFixed(1)}%"></span>
            </span>
            <span class="an-dist-values">
                <span class="an-dist-min">${fmt(r.min, 1)}</span>
                <span class="an-dist-med">${fmt(r.median, 1)}</span>
                <span class="an-dist-max">${fmt(r.max, 1)}</span>
            </span>
        </div>`).join('')}
    </div>
    <p class="an-footnote">Bar = min–max range of weekly scores; the vertical mark is the median.</p>`;
}

function buildDraftScatterSection(points) {
    if (!points.length) return emptyState(`Draft data not available for ${currentYear}`);
    return `<div class="an-chart" id="an-scatter-chart">${buildDraftScatter(points)}<div class="an-chart-tooltip" hidden></div></div>`;
}

function rankingBlock(title, rows, valueFn, noteFn, highlightMode) {
    const values = rows.map(r => valueFn(r) || 0);
    const max = Math.max(...values, 1);
    return `
    <div class="an-ranking">
        <h3 class="an-sub-title">${title}</h3>
        ${rows.map((r, i) => {
        const val = valueFn(r);
        const note = noteFn(r);
        const highlight = i === 0 ? (highlightMode === 'win' ? ' an-rank-row--win' : ' an-rank-row--loss') : '';
        return `
        <div class="an-rank-row${highlight}">
            <span class="an-rank-pos">${i + 1}</span>
            <img src="${TEAMS[r.key].logo}" alt="" class="an-rank-logo">
            <span class="an-rank-name">${r.name}${note ? `<span class="an-rank-note">${note}</span>` : ''}</span>
            <span class="an-rank-bar"><span style="width:${((val || 0) / max * 100).toFixed(1)}%; background:${r.color}"></span></span>
            <span class="an-rank-val">${val !== null && val !== undefined ? fmt(val, 0) : '—'}</span>
        </div>`;
    }).join('')}
    </div>`;
}

function rankingBlockPerf(title, rows, variant = 'top') {
    if (!rows.length) return `<div class="an-ranking"><h3 class="an-sub-title">${title}</h3>${emptyState('Nessuna prestazione disponibile')}</div>`;
    const max = Math.max(...rows.map(r => r.pts), 1);
    const highlight = variant === 'flop' ? 'an-rank-row--loss' : 'an-rank-row--win';
    return `
    <div class="an-ranking">
        <h3 class="an-sub-title">${title}</h3>
        ${rows.map((r, i) => {
        const team = TEAMS[r.teamKey];
        const barW = max > 0 ? Math.max(r.pts / max * 100, 3) : 3;
        return `
        <div class="an-rank-row${i === 0 ? ' ' + highlight : ''}">
            <span class="an-rank-pos">${i + 1}</span>
            <img src="${team ? team.logo : 'images/fallback-player.svg'}" alt="" class="an-rank-logo">
            <span class="an-rank-name">${r.name} ${posBadge(r.position)}<span class="an-rank-note">${team ? team.name : ''} — W${r.wk}</span></span>
            <span class="an-rank-bar"><span style="width:${barW.toFixed(1)}%; background:${CHART_COLORS[r.teamKey] || '#888'}"></span></span>
            <span class="an-rank-val">${fmt(r.pts, 1)}</span>
        </div>`;
    }).join('')}
    </div>`;
}

/* ---------- Line chart (SVG) ---------- */

const LC = { w: 800, h: 300, l: 44, r: 120, t: 16, b: 30 };

function niceTicks(min, max, count = 4) {
    const span = max - min || 1;
    const step = Math.pow(10, Math.floor(Math.log10(span / count)));
    const err = span / count / step;
    const mult = err >= 7.5 ? 10 : err >= 3.5 ? 5 : err >= 1.5 ? 2 : 1;
    const s = mult * step;
    const lo = Math.floor(min / s) * s;
    const hi = Math.ceil(max / s) * s;
    const ticks = [];
    for (let v = lo; v <= hi + 1e-9; v += s) ticks.push(v);
    return ticks;
}

function buildLineChart(series) {
    const weeks = [...new Set(series.flatMap(s => s.values.map(v => v.wk)))].sort((a, b) => a - b);
    const scores = series.flatMap(s => s.values.map(v => v.score));
    const ticks = niceTicks(Math.min(...scores), Math.max(...scores));
    const yMin = ticks[0], yMax = ticks[ticks.length - 1];

    const plotW = LC.w - LC.l - LC.r;
    const plotH = LC.h - LC.t - LC.b;
    const x = wk => LC.l + (weeks.length > 1 ? (weeks.indexOf(wk) / (weeks.length - 1)) * plotW : plotW / 2);
    const y = v => LC.t + (1 - (v - yMin) / (yMax - yMin || 1)) * plotH;

    const grid = ticks.map(v => `
        <line x1="${LC.l}" y1="${y(v)}" x2="${LC.l + plotW}" y2="${y(v)}" class="an-gridline"/>
        <text x="${LC.l - 8}" y="${y(v) + 3}" class="an-tick" text-anchor="end">${fmt(v)}</text>`).join('');

    const xTicks = weeks.filter((_, i) => weeks.length <= 10 || i % 2 === 0).map(wk =>
        `<text x="${x(wk)}" y="${LC.h - 8}" class="an-tick" text-anchor="middle">W${wk}</text>`).join('');

    // Etichette di fine linea con anti-collisione verticale semplice
    const ends = series.map(s => {
        const last = s.values[s.values.length - 1];
        return { s, lx: x(last.wk), ly: y(last.score), labelY: y(last.score) };
    }).sort((a, b) => a.ly - b.ly);
    const MIN_GAP = 15;
    for (let i = 1; i < ends.length; i++) {
        if (ends[i].labelY - ends[i - 1].labelY < MIN_GAP) ends[i].labelY = ends[i - 1].labelY + MIN_GAP;
    }

    const lines = series.map(s => {
        const pts = s.values.map(v => `${x(v.wk).toFixed(1)},${y(v.score).toFixed(1)}`).join(' ');
        return `<polyline points="${pts}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
    }).join('');

    const endDots = ends.map(({ s, lx, ly, labelY }) => `
        ${Math.abs(labelY - ly) > 2 ? `<line x1="${lx + 5}" y1="${ly}" x2="${lx + 12}" y2="${labelY}" class="an-leader"/>` : ''}
        <circle cx="${lx}" cy="${ly}" r="4.5" fill="${s.color}" stroke="#000" stroke-width="2"/>
        <text x="${lx + 14}" y="${labelY + 3.5}" class="an-endlabel">${s.name}</text>`).join('');

    // Dati per il crosshair, serializzati sull'svg
    const data = { weeks, series: series.map(s => ({ name: s.name, color: s.color, values: s.values })) };
    const dataAttr = JSON.stringify(data).replace(/'/g, '&#39;');

    return `
    <svg viewBox="0 0 ${LC.w} ${LC.h}" class="an-svg" data-chart="line" data-series='${dataAttr}'>
        ${grid}${xTicks}${lines}${endDots}
        <line class="an-crosshair" x1="0" y1="${LC.t}" x2="0" y2="${LC.t + plotH}" visibility="hidden"/>
        <rect class="an-hit" x="${LC.l}" y="${LC.t}" width="${plotW}" height="${plotH}" fill="transparent"/>
    </svg>`;
}

/* ---------- Grouped bar chart (SVG) ---------- */

const BC = { w: 800, h: 280, l: 48, r: 12, t: 16, b: 30 };

function barPath(x, y, w, h, r) {
    if (h <= 0) return '';
    const rr = Math.min(r, w / 2, h);
    return `M${x},${y + h} V${y + rr} Q${x},${y} ${x + rr},${y} H${x + w - rr} Q${x + w},${y} ${x + w},${y + rr} V${y + h} Z`;
}

function buildRoleChart(teams) {
    const maxVal = Math.max(...teams.flatMap(t => ROLES.map(r => t.byRole[r] || 0)), 1);
    const ticks = niceTicks(0, maxVal);
    const yMax = ticks[ticks.length - 1];

    const plotW = BC.w - BC.l - BC.r;
    const plotH = BC.h - BC.t - BC.b;
    const groupW = plotW / ROLES.length;
    const barW = Math.min(24, (groupW - 24) / teams.length - 2);
    const y = v => BC.t + (1 - v / yMax) * plotH;

    const grid = ticks.map(v => `
        <line x1="${BC.l}" y1="${y(v)}" x2="${BC.l + plotW}" y2="${y(v)}" class="an-gridline"/>
        <text x="${BC.l - 8}" y="${y(v) + 3}" class="an-tick" text-anchor="end">${fmt(v)}</text>`).join('');

    const bars = ROLES.map((role, ri) => {
        const groupX = BC.l + ri * groupW;
        const totalBars = teams.length * barW + (teams.length - 1) * 2;
        const start = groupX + (groupW - totalBars) / 2;
        return teams.map((t, ti) => {
            const val = t.byRole[role] || 0;
            const bx = start + ti * (barW + 2);
            const by = y(val);
            return `<path d="${barPath(bx, by, barW, BC.t + plotH - by, 4)}" fill="${t.color}" class="an-bar"
                data-team="${t.name}" data-role="${role}" data-val="${val.toFixed(1)}"/>`;
        }).join('');
    }).join('');

    const xLabels = ROLES.map((role, ri) =>
        `<text x="${BC.l + ri * groupW + groupW / 2}" y="${BC.h - 8}" class="an-tick" text-anchor="middle">${role}</text>`).join('');

    return `
    <svg viewBox="0 0 ${BC.w} ${BC.h}" class="an-svg" data-chart="bars">
        ${grid}${xLabels}${bars}
    </svg>`;
}

/* ---------- Scatter chart (SVG) ---------- */

const SC = { w: 800, h: 320, l: 48, r: 12, t: 16, b: 34 };

function buildDraftScatter(points) {
    const maxPick = Math.max(...points.map(p => p.pick), 1);
    const maxPts = Math.max(...points.map(p => p.pts), 1);
    const yTicks = niceTicks(0, maxPts);
    const yMax = yTicks[yTicks.length - 1];

    const plotW = SC.w - SC.l - SC.r;
    const plotH = SC.h - SC.t - SC.b;
    const x = pick => SC.l + ((pick - 1) / Math.max(maxPick - 1, 1)) * plotW;
    const y = pts => SC.t + (1 - pts / yMax) * plotH;

    const grid = yTicks.map(v => `
        <line x1="${SC.l}" y1="${y(v)}" x2="${SC.l + plotW}" y2="${y(v)}" class="an-gridline"/>
        <text x="${SC.l - 8}" y="${y(v) + 3}" class="an-tick" text-anchor="end">${fmt(v)}</text>`).join('');

    const xTickStep = maxPick > 20 ? 4 : 2;
    const xTicks = [];
    for (let p = 1; p <= maxPick; p += xTickStep) {
        xTicks.push(`<text x="${x(p)}" y="${SC.h - 10}" class="an-tick" text-anchor="middle">${p}</text>`);
    }

    // Outlier di rilievo: miglior affare (pick tardiva, punti alti) e peggior bust (pick precoce, punti bassi)
    const lateHalf = points.filter(p => p.pick > maxPick / 2);
    const earlyHalf = points.filter(p => p.pick <= maxPick / 2);
    const bestSteal = lateHalf.length ? lateHalf.reduce((a, b) => (b.pts > a.pts ? b : a)) : null;
    const worstBust = earlyHalf.length ? earlyHalf.reduce((a, b) => (b.pts < a.pts ? b : a)) : null;
    const labeled = new Set([bestSteal, worstBust].filter(Boolean).map(p => p.pick));

    const dots = points.map(p => {
        const cx = x(p.pick), cy = y(p.pts);
        const label = labeled.has(p.pick) ? `<text x="${cx}" y="${cy - 10}" class="an-endlabel" text-anchor="middle">${p.name}</text>` : '';
        return `${label}<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="5" fill="${p.color}" stroke="#000" stroke-width="2"
            class="an-dot" data-name="${p.name}" data-pick="${p.pick}" data-team="${p.teamName}" data-pos="${p.position || ''}" data-pts="${p.pts.toFixed(1)}"/>`;
    }).join('');

    return `
    <svg viewBox="0 0 ${SC.w} ${SC.h}" class="an-svg">
        ${grid}${xTicks.join('')}${dots}
        <text x="${SC.l + plotW / 2}" y="${SC.h - 2}" class="an-tick" text-anchor="middle" opacity="0">Pick</text>
    </svg>`;
}

function bindDraftScatter(container) {
    const svg = container.querySelector('svg');
    const tooltip = container.querySelector('.an-chart-tooltip');

    svg.addEventListener('pointermove', (e) => {
        const dot = e.target.closest('.an-dot');
        if (!dot) { tooltip.hidden = true; return; }
        tooltip.replaceChildren();
        const title = document.createElement('div');
        title.className = 'an-tt-title';
        title.textContent = `Pick #${dot.dataset.pick}`;
        const row = document.createElement('div');
        row.className = 'an-tt-row';
        const key = document.createElement('span');
        key.className = 'an-tt-key';
        key.style.background = dot.getAttribute('fill');
        const val = document.createElement('b');
        val.textContent = fmt(Number(dot.dataset.pts), 1);
        const name = document.createElement('span');
        name.className = 'an-tt-name';
        name.textContent = `${dot.dataset.name} (${dot.dataset.pos}) — ${dot.dataset.team}`;
        row.append(key, val, name);
        tooltip.append(title, row);
        tooltip.hidden = false;
        positionTooltip(container, tooltip, e);
    });

    svg.addEventListener('pointerleave', () => { tooltip.hidden = true; });
}

/* ---------- Hover layer ---------- */

function bindCharts(wrap) {
    const lineChart = wrap.querySelector('#an-line-chart');
    if (lineChart) bindLineChart(lineChart);
    const roleChart = wrap.querySelector('#an-role-chart');
    if (roleChart) bindBarChart(roleChart);
    const scatterChart = wrap.querySelector('#an-scatter-chart');
    if (scatterChart) bindDraftScatter(scatterChart);
}

function bindLineChart(container) {
    const svg = container.querySelector('svg');
    const tooltip = container.querySelector('.an-chart-tooltip');
    const crosshair = svg.querySelector('.an-crosshair');
    const hit = svg.querySelector('.an-hit');
    const data = JSON.parse(svg.dataset.series);
    const plotW = LC.w - LC.l - LC.r;

    const xFor = wk => LC.l + (data.weeks.length > 1 ? (data.weeks.indexOf(wk) / (data.weeks.length - 1)) * plotW : plotW / 2);

    hit.addEventListener('pointermove', (e) => {
        const rect = svg.getBoundingClientRect();
        const scale = LC.w / rect.width;
        const px = (e.clientX - rect.left) * scale;
        // Snap alla week più vicina
        let nearest = data.weeks[0], best = Infinity;
        for (const wk of data.weeks) {
            const d = Math.abs(xFor(wk) - px);
            if (d < best) { best = d; nearest = wk; }
        }
        const cx = xFor(nearest);
        crosshair.setAttribute('x1', cx);
        crosshair.setAttribute('x2', cx);
        crosshair.setAttribute('visibility', 'visible');

        // Tooltip: tutte le serie a quella week, valore in evidenza
        tooltip.replaceChildren();
        const title = document.createElement('div');
        title.className = 'an-tt-title';
        title.textContent = `Week ${nearest}`;
        tooltip.appendChild(title);
        const rows = data.series
            .map(s => ({ s, v: s.values.find(v => v.wk === nearest) }))
            .filter(r => r.v)
            .sort((a, b) => b.v.score - a.v.score);
        for (const { s, v } of rows) {
            const row = document.createElement('div');
            row.className = 'an-tt-row';
            const key = document.createElement('span');
            key.className = 'an-tt-key';
            key.style.background = s.color;
            const val = document.createElement('b');
            val.textContent = fmt(v.cum !== undefined ? v.cum : v.score, 1);
            const name = document.createElement('span');
            name.className = 'an-tt-name';
            name.textContent = v.weekScore !== undefined ? `${s.name} (+${fmt(v.weekScore, 1)})` : s.name;
            row.append(key, val, name);
            tooltip.appendChild(row);
        }
        tooltip.hidden = false;
        positionTooltip(container, tooltip, e);
    });

    hit.addEventListener('pointerleave', () => {
        crosshair.setAttribute('visibility', 'hidden');
        tooltip.hidden = true;
    });
}

function bindBarChart(container) {
    const svg = container.querySelector('svg');
    const tooltip = container.querySelector('.an-chart-tooltip');

    svg.addEventListener('pointermove', (e) => {
        const bar = e.target.closest('.an-bar');
        if (!bar) { tooltip.hidden = true; return; }
        tooltip.replaceChildren();
        const title = document.createElement('div');
        title.className = 'an-tt-title';
        title.textContent = bar.dataset.role;
        const row = document.createElement('div');
        row.className = 'an-tt-row';
        const key = document.createElement('span');
        key.className = 'an-tt-key';
        key.style.background = bar.getAttribute('fill');
        const val = document.createElement('b');
        val.textContent = fmt(Number(bar.dataset.val), 1);
        const name = document.createElement('span');
        name.className = 'an-tt-name';
        name.textContent = bar.dataset.team;
        row.append(key, val, name);
        tooltip.append(title, row);
        tooltip.hidden = false;
        positionTooltip(container, tooltip, e);
    });

    svg.addEventListener('pointerleave', () => { tooltip.hidden = true; });
}

function positionTooltip(container, tooltip, e) {
    const rect = container.getBoundingClientRect();
    let tx = e.clientX - rect.left + 14;
    const ty = e.clientY - rect.top - 10;
    const tw = tooltip.offsetWidth || 140;
    if (tx + tw > rect.width - 4) tx = e.clientX - rect.left - tw - 14;
    tooltip.style.left = `${tx}px`;
    tooltip.style.top = `${ty}px`;
}
