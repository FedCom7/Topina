/**
 * Analysis — analisi per team/anno dei giocatori.
 * Per il team selezionato: rendimento stagionale di ogni giocatore passato
 * dal roster (con drill-down settimanale), squadra draftata, mercato
 * (innesti in-season), miglior formazione e confronto punti
 * (reali / draftati / ottimali / persi in panchina).
 */

import { fetchFantasyData, fetchDraftData, displayName, getSeasonConfig, SEASONS, CURRENT_SEASON } from '../data.js?v=5';
import { TEAMS } from './team.js?v=12';
import { playerImageService } from '../services/player-image-service.js?v=4';

let initialized = false;
let currentYear = CURRENT_SEASON;
let currentTeam = 'capi';
let currentTab = 'season';
const modelCache = {};

const TABS = [
    { id: 'season', label: 'Stagione' },
    { id: 'draft', label: 'Draft' },
    { id: 'market', label: 'Mercato' },
    { id: 'lineup', label: 'Formazione' },
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
            🏆 Totale
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

async function buildSeasonModel(year) {
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
    const agg = { games: 0, pts: 0, stats: {}, firstWeek: null, lastWeekOn: null, weeks: [] };
    for (const [wkStr, w] of Object.entries(rec.weeks)) {
        if (w.teamKey !== teamKey) continue;
        const wk = Number(wkStr);
        agg.games++;
        agg.pts += w.pts;
        sumStats(agg.stats, w.stats);
        if (agg.firstWeek === null || wk < agg.firstWeek) agg.firstWeek = wk;
        if (agg.lastWeekOn === null || wk > agg.lastWeekOn) agg.lastWeekOn = wk;
        agg.weeks.push(wk);
    }
    return agg;
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

function marketView(model, teamKey) {
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

function pointsComparison(model, teamKey) {
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
        wrap.innerHTML = `<div class="empty-state"><div class="empty-state-icon">⚠️</div><p class="empty-state-text">Errore nel caricamento: ${e.message}</p></div>`;
        return;
    }
    if (!model) {
        wrap.innerHTML = `<div class="empty-state"><div class="empty-state-icon">📭</div><p class="empty-state-text">Nessun dato per la stagione ${currentYear}</p></div>`;
        return;
    }

    render(model);
}

function render(model) {
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

    let viewHtml = '';
    switch (currentTab) {
        case 'season': viewHtml = renderSeasonTab(model); break;
        case 'draft': viewHtml = renderDraftTab(model); break;
        case 'market': viewHtml = renderMarketTab(model); break;
        case 'lineup': viewHtml = renderLineupTab(model); break;
    }

    wrap.innerHTML = renderKpi(kpi) + tabsHtml + `<div class="an-view">${viewHtml}</div>`;
    hydrateImages();
}

function renderKpi(kpi) {
    const missHtml = kpi.worstMiss
        ? `<div class="an-kpi-note">Peggior svista: <b>${kpi.worstMiss.name}</b> — ${fmt(kpi.worstMiss.pts, 2)} pt in panchina (W${kpi.worstMiss.wk})</div>`
        : '';
    return `
    <div class="stats-summary an-kpi">
        <div class="summary-stat">
            <div class="summary-stat-value">${fmt(kpi.real)}</div>
            <div class="summary-stat-label">Punti Reali</div>
        </div>
        <div class="summary-stat">
            <div class="summary-stat-value">${kpi.drafted !== null ? fmt(kpi.drafted) : '—'}</div>
            <div class="summary-stat-label">Punti Squadra Draftata</div>
        </div>
        <div class="summary-stat">
            <div class="summary-stat-value">${fmt(kpi.optimal)}</div>
            <div class="summary-stat-label">Punti Formazione Ottimale</div>
        </div>
        <div class="summary-stat summary-stat--accent">
            <div class="summary-stat-value">−${fmt(kpi.benchLost)}</div>
            <div class="summary-stat-label">Punti Persi in Panchina</div>
        </div>
    </div>
    ${missHtml}`;
}

function renderSeasonTab(model) {
    const rows = seasonView(model, currentTeam);
    if (!rows.length) return emptyState('Nessun giocatore trovato per questo team');

    // Nomi draftati dal team, per distinguere gli innesti in-season
    const draftedNames = new Set();
    const raw = rawFromTeamKey(model.draft?.teams, currentTeam);
    if (raw) for (const p of model.draft.teams[raw] || []) draftedNames.add(p.name);

    return `
    <div class="an-list-head">
        <span></span><span>Giocatore</span><span>G</span><span>Punti</span><span>Media</span><span class="an-head-stats">Statistiche</span><span></span>
    </div>
    ${rows.map(({ rec, agg }) => {
        const badges = [];
        // "Preso": innesto in-season (non draftato) o comunque arrivato dopo W1
        if (raw && !draftedNames.has(rec.name)) {
            badges.push(`<span class="an-badge an-badge-in">Preso W${agg.firstWeek}</span>`);
        } else if (agg.firstWeek > 1) {
            badges.push(`<span class="an-badge an-badge-in">Dal W${agg.firstWeek}</span>`);
        }
        // "Svincolato": non è più nel roster dell'ultima settimana disputata
        if (agg.lastWeekOn < model.lastWeek) {
            const w = rec.weeks[model.lastWeek];
            const label = w && w.teamKey !== currentTeam
                ? `Ceduto dopo W${agg.lastWeekOn}`
                : `Svincolato dopo W${agg.lastWeekOn}`;
            badges.push(`<span class="an-badge an-badge-drop">${label}</span>`);
        }
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
        <span class="an-cell">${fmt(agg.games ? agg.pts / agg.games : 0, 1)}</span>
        <span class="an-keystats">${keyStatLine(rec.position, agg.stats)}</span>
        <span class="an-chevron">›</span>
    </div>
    <div class="an-week-drill" data-drill="${encodeURIComponent(rec.name)}" hidden></div>`;
}

function renderDraftTab(model) {
    const picks = draftView(model, currentTeam);
    if (!picks) return emptyState(`Dati draft non disponibili per il ${currentYear}`);

    return `
    <div class="an-list-head">
        <span></span><span>Pick · Giocatore</span><span>G</span><span>Punti</span><span>Media</span><span class="an-head-stats">Statistiche</span><span></span>
    </div>
    ${picks.map(({ pick, rec, agg }) => {
        if (!rec || !agg || agg.games === 0) {
            return `
            <div class="an-player-row an-row-static">
                <img src="images/fallback-player.svg" class="an-headshot an-img" loading="lazy" data-player-name="${pick.name}" data-team="${pick.nfl_team || ''}" data-pos="${pick.position || ''}" alt="${pick.name}">
                <span class="an-player-name"><span class="an-pick-num">#${pick.pick}</span> ${pick.name} ${posBadge(pick.position)} <span class="an-badge an-badge-drop">Mai schierato</span></span>
                <span class="an-cell">0</span><span class="an-cell an-pts">0</span><span class="an-cell">—</span>
                <span class="an-keystats"></span><span></span>
            </div>`;
        }
        const dropped = model.seasonOver && agg.lastWeekOn < model.lastWeek;
        const badge = dropped ? `<span class="an-badge an-badge-drop">Svincolato dopo W${agg.lastWeekOn}</span>` : '';
        return playerRow(rec, agg, `<span class="an-pick-num">#${pick.pick}</span> ${badge}`);
    }).join('')}`;
}

function renderMarketTab(model) {
    const { finalRoster, additions, hasDraft } = marketView(model, currentTeam);

    const additionsHtml = additions.length ? `
        <h3 class="an-sub-title">Innesti in stagione${hasDraft ? '' : ' (draft non disponibile)'}</h3>
        <div class="an-list-head an-list-head-market">
            <span></span><span>Giocatore</span><span>Preso</span><span>G</span><span>Punti qui</span><span>Altrove</span><span></span>
        </div>
        ${additions.map(({ rec, agg, elsewhere, onFinal }) => `
        <div class="an-player-row" data-player="${encodeURIComponent(rec.name)}">
            ${headshotImg(rec)}
            <span class="an-player-name">${rec.name} ${posBadge(rec.position)} ${onFinal ? '<span class="an-badge an-badge-start">In roster finale</span>' : ''}</span>
            <span class="an-cell">W${agg.firstWeek}</span>
            <span class="an-cell">${agg.games}</span>
            <span class="an-cell an-pts an-split-here">${fmt(agg.pts, 2)}</span>
            <span class="an-cell an-split-away">${elsewhere > 0 ? fmt(elsewhere, 2) : '—'}</span>
            <span class="an-chevron">›</span>
        </div>
        <div class="an-week-drill" data-drill="${encodeURIComponent(rec.name)}" hidden></div>`).join('')}
        <p class="an-footnote">"Altrove" = punti fatti nelle settimane in cui il giocatore era nel roster di un altro team. Le settimane da svincolato non sono tracciate.</p>
    ` : `<h3 class="an-sub-title">Innesti in stagione</h3>${emptyState('Nessun innesto: roster invariato rispetto al draft')}`;

    const finalHtml = finalRoster.length ? `
        <h3 class="an-sub-title">Roster finale (W${model.lastWeek})</h3>
        <div class="an-final-roster">
            ${finalRoster.map(({ rec, agg, drafted }) => `
            <span class="an-roster-chip${drafted ? '' : ' an-roster-chip--add'}" title="${fmt(agg.pts, 2)} pt">
                ${rec.name} <b>${fmt(agg.pts, 0)}</b>
            </span>`).join('')}
        </div>
        <p class="an-footnote">In <span class="an-split-here">rosso</span> gli innesti arrivati durante la stagione, il numero è il totale punti per il team.</p>
    ` : '';

    return additionsHtml + finalHtml;
}

function renderLineupTab(model) {
    const slots = lineupView(model, currentTeam);
    return `
    <h3 class="an-sub-title">Miglior formazione ${currentYear} — chi ha reso di più per slot</h3>
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
            <div class="an-lineup-meta">${posBadge(rec.position)} <span class="an-lineup-nfl">${rec.nflTeam || ''}</span></div>
            <div class="an-lineup-pts">${fmt(agg.pts, 2)} <span>pt</span></div>
            <div class="an-lineup-avg">${fmt(agg.games ? agg.pts / agg.games : 0, 1)} di media · ${agg.games} G</div>
        </div>`;
    }).join('')}
    </div>`;
}

function emptyState(text) {
    return `<div class="empty-state"><div class="empty-state-icon">📭</div><p class="empty-state-text">${text}</p></div>`;
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

        const row = e.target.closest('.an-player-row');
        if (!row || row.classList.contains('an-row-static')) return;
        const name = row.dataset.player;
        if (!name) return;
        const drill = wrap.querySelector(`.an-week-drill[data-drill="${name}"]`);
        if (!drill) return;

        const expanded = row.classList.toggle('expanded');
        drill.hidden = !expanded;
        if (expanded && !drill.dataset.loaded) {
            drill.innerHTML = weekDrillHtml(decodeURIComponent(name));
            drill.dataset.loaded = '1';
        }
    });
}

function weekDrillHtml(playerName) {
    const model = modelCache[currentYear];
    const rec = model?.players.get(playerName);
    if (!rec) return '';

    const weeks = Object.entries(rec.weeks)
        .map(([wk, w]) => ({ wk: Number(wk), ...w }))
        .filter(w => w.teamKey === currentTeam)
        .sort((a, b) => a.wk - b.wk);

    return weeks.map(w => `
        <div class="an-drill-row">
            <span class="an-drill-week">W${w.wk}</span>
            <span class="an-drill-opp">${w.opponent || '—'}</span>
            <span class="an-drill-pts">${fmt(w.pts, 2)}</span>
            <span class="an-drill-stats">${keyStatLine(rec.position, w.stats)}</span>
            <span class="an-badge ${w.started ? 'an-badge-start' : 'an-badge-bench'}">${w.started ? 'Titolare' : 'Panchina'}</span>
        </div>`).join('');
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
    return Object.values(TEAMS).map(t => {
        const values = [];
        let cumulative = 0;
        for (let wk = 1; wk <= model.lastWeek; wk++) {
            const tw = model.teamWeeks[t.key]?.[wk];
            if (tw) {
                cumulative += tw.score;
                values.push({ wk, score: cumulative, weekScore: tw.score });
            }
        }
        return { key: t.key, name: t.name, color: CHART_COLORS[t.key] || '#888', values };
    }).filter(s => s.values.length > 0);
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
        return {
            key: t.key, name: t.name, color: CHART_COLORS[t.key] || '#888',
            drafted: kpi.drafted, pickupPts, topPickup, benchLost: kpi.benchLost, worstMiss: kpi.worstMiss,
        };
    });
    return {
        draft: [...rows].sort((a, b) => (b.drafted || 0) - (a.drafted || 0)),
        pickups: [...rows].sort((a, b) => b.pickupPts - a.pickupPts),
        bench: [...rows].sort((a, b) => b.benchLost - a.benchLost),
    };
}

function renderLeagueView(model) {
    const series = weeklyScores(model);
    if (!series.length) return emptyState(`Nessun dato per la stagione ${currentYear}`);

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

    return `
    <div class="stats-summary an-kpi">
        <div class="summary-stat">
            <div class="summary-stat-value">${fmt(totalPts)}</div>
            <div class="summary-stat-label">Punti Totali Lega</div>
        </div>
        <div class="summary-stat">
            <div class="summary-stat-value">${fmt(avgPts, 1)}</div>
            <div class="summary-stat-label">Media a Partita</div>
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

    <h3 class="an-sub-title">Punti cumulativi week per week</h3>
    ${legend}
    <div class="an-chart" id="an-line-chart">${buildLineChart(series)}<div class="an-chart-tooltip" hidden></div></div>

    <h3 class="an-sub-title">Punti per ruolo (titolari)</h3>
    ${legend}
    <div class="an-chart" id="an-role-chart">${buildRoleChart(roleBreakdown(model))}<div class="an-chart-tooltip" hidden></div></div>

    <div class="an-rankings">
        ${rankingBlock('Miglior Draft', rk.draft, r => r.drafted, () => null, 'win')}
        ${rankingBlock('Migliori Innesti', rk.pickups, r => r.pickupPts, r => r.topPickup ? `Top: ${r.topPickup.rec.name} (${fmt(r.topPickup.agg.pts, 0)} pt)` : null, 'win')}
        ${rankingBlock('Punti Lasciati in Panchina', rk.bench, r => r.benchLost, r => r.worstMiss ? `Peggior svista: ${r.worstMiss.name}, ${fmt(r.worstMiss.pts, 1)} pt (W${r.worstMiss.wk})` : null, 'loss')}
    </div>`;
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

/* ---------- Hover layer ---------- */

function bindCharts(wrap) {
    const lineChart = wrap.querySelector('#an-line-chart');
    if (lineChart) bindLineChart(lineChart);
    const roleChart = wrap.querySelector('#an-role-chart');
    if (roleChart) bindBarChart(roleChart);
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
            val.textContent = fmt(v.score, 1);
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
