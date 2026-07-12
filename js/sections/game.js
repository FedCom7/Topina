/**
 * Game Analysis — pagina analisi di un singolo matchup.
 * Route: #game/{year}/{week}/{indice matchup}
 * Score bug → confronto punti per ruolo → grafico temporale del weekend
 * (kickoff reali via nfl-schedule) → articolo recap + tabella outcome →
 * confronto stats di squadra + difference maker → player notes.
 */

import { fetchFantasyData, displayName, getSeasonConfig } from '../data.js?v=5';
import { TEAM_KEYS } from '../data/team-config.js?v=5';
import { getLeagueData } from '../data/league-data.js?v=1';
import { getHonorsBundle } from '../data/honors.js?v=2';
import { getWeekSchedule, canonAbbr } from '../data/nfl-schedule.js?v=1';
import {
    slotPairs, weekPosRanks, diffMakers, teamStatTotals,
    playerComment, playerNotes, recapArticle, statLine,
} from '../data/matchup-analysis.js?v=2';
import { TEAMS } from './team.js?v=12';
import { playerImageService } from '../services/player-image-service.js?v=4';

const _fantasyCache = {};
const fmt = (n) => (+n).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const P = (p) => parseFloat(p?.fantasy_points) || 0;

function teamOf(rawName) {
    return TEAMS[TEAM_KEYS[displayName(rawName)]] || null;
}

export async function initGame() {
    const section = document.getElementById('game');
    if (!section) return;

    // #game/2025/17/0
    const [, year, weekStr, idxStr] = location.hash.slice(1).split('/');
    const week = parseInt(weekStr), idx = parseInt(idxStr);
    section.innerHTML = `<div class="section-inner"><div class="loading-state"><div class="spinner"></div><p>Caricamento analisi...</p></div></div>`;

    try {
        if (!_fantasyCache[year]) _fantasyCache[year] = await fetchFantasyData(year);
        const data = _fantasyCache[year];
        const weekData = data?.weeks?.[String(week)];
        const m = weekData?.matchups?.[idx];
        if (!m?.team1 || !m?.team2) {
            section.innerHTML = `<div class="section-inner"><div class="empty-state"><div class="empty-state-icon">📭</div><p class="empty-state-text">Matchup non trovato</p></div></div>`;
            return;
        }

        const [bundle, league] = await Promise.all([getHonorsBundle(year), getLeagueData()]);
        const ranks = weekPosRanks(weekData);
        const config = getSeasonConfig(year);
        const isPlayoff = week === config.playoffWeek;
        const isSB = week === config.superBowlWeek;
        const weekLabel = isSB ? 'Super Bowl' : isPlayoff ? 'Playoffs' : `Week ${week}`;

        // precedenti stagionali dal punto di vista del vincitore
        const winnerRaw = P({ fantasy_points: m.team1.score }) >= P({ fantasy_points: m.team2.score }) ? m.team1 : m.team2;
        const loserRaw = winnerRaw === m.team1 ? m.team2 : m.team1;
        const wKey = TEAM_KEYS[displayName(winnerRaw.name)];
        const lKey = TEAM_KEYS[displayName(loserRaw.name)];
        const seriesGames = (league.seasons.find(s => s.year === year)?.perTeam?.[wKey]?.games || [])
            .filter(g => g.opp === lKey && g.week < week);

        const article = recapArticle(m, bundle, ranks, {
            year, weekNum: week, weekLabel, isPlayoff, isSB, seriesGames,
            teamName: (raw) => teamOf(raw)?.name || displayName(raw),
        });
        const dm = diffMakers(m);
        const notes = playerNotes(m, bundle, ranks);

        section.innerHTML = `
        <div class="section-inner gb-page">
            <a class="gb-back" href="#game-center"><span aria-hidden="true">←</span> Game Center</a>
            ${scoreBugHTML(m, weekLabel, year)}
            ${roleCompareHTML(m)}
            <div class="mosaic-card mc-wide gb-card mc-in" id="gb-chart-card">
                <span class="mc-kicker">Andamento del weekend</span>
                <h2 class="mc-title">Punto a punto</h2>
                <div class="mc-body" id="gb-chart">
                    <div class="loading-state"><div class="spinner"></div><p>Caricamento calendario NFL...</p></div>
                </div>
            </div>
            <div class="gb-article-grid">
                ${articleHTML(article, weekLabel)}
                ${outcomeHTML(m)}
            </div>
            <div class="gb-halves">
                ${statBarsHTML(m)}
                ${diffMakerHTML(m, dm, bundle, ranks)}
            </div>
            ${notesHTML(notes)}
        </div>`;

        loadHeadshots(section, year);
        renderChart(m, year, week);
    } catch (e) {
        console.error('[Game] errore analisi:', e);
        section.innerHTML = `<div class="section-inner"><div class="empty-state"><div class="empty-state-icon">📡</div><p class="empty-state-text">Errore nel caricamento dell'analisi</p></div></div>`;
    }
}

// ─── Score bug ───────────────────────────────────────────────────

function scoreBugHTML(m, weekLabel, year) {
    const s1 = P({ fantasy_points: m.team1.score });
    const s2 = P({ fantasy_points: m.team2.score });
    const t1 = teamOf(m.team1.name), t2 = teamOf(m.team2.name);
    const side = (t, raw) => `
        <div class="gb-bug-side">
            <span class="gb-bug-name">${t?.name || displayName(raw.name)}</span>
        </div>`;
    return `
    <div class="gb-scorebug" style="--tc1:${t1?.color || 'var(--accent-red)'};--tc2:${t2?.color || 'var(--accent-blue)'}">
        ${t1 ? `<img class="gb-bug-wm gb-bug-wm-l" src="${t1.logo}" alt="" aria-hidden="true">` : ''}
        ${t2 ? `<img class="gb-bug-wm gb-bug-wm-r" src="${t2.logo}" alt="" aria-hidden="true">` : ''}
        <div class="gb-bug-inner">
            ${side(t1, m.team1)}
            <span class="gb-bug-score${s1 >= s2 ? ' winner' : ''}">${fmt(s1)}</span>
            <div class="gb-bug-mid">
                <span class="gb-bug-final">Finale</span>
                <span class="gb-bug-week">${weekLabel} · ${year}</span>
            </div>
            <span class="gb-bug-score${s2 >= s1 ? ' winner' : ''}">${fmt(s2)}</span>
            ${side(t2, m.team2)}
        </div>
    </div>`;
}

// ─── Confronto punti per ruolo ───────────────────────────────────

function roleCompareHTML(m) {
    const pairs = slotPairs(m);
    const t1 = teamOf(m.team1.name), t2 = teamOf(m.team2.name);
    const s1 = P({ fantasy_points: m.team1.score });
    const s2 = P({ fantasy_points: m.team2.score });

    const row = (team, getP, color, score, align) => `
        <tr class="gb-role-row" style="--tc:${color}">
            <th class="gb-role-team">${team?.name || ''}</th>
            ${pairs.map(pair => {
        const mine = P(getP(pair));
        const other = P(getP === getA ? pair.b : pair.a);
        return `<td class="${mine > other ? 'gb-role-win' : ''}">${mine.toFixed(2)}</td>`;
    }).join('')}
            <td class="gb-role-total">${fmt(score)}</td>
        </tr>`;
    const getA = (pair) => pair.a;
    const getB = (pair) => pair.b;

    return `
    <div class="mosaic-card mc-wide gb-card mc-in">
        <span class="mc-kicker">Testa a testa</span>
        <h2 class="mc-title">Punti per ruolo</h2>
        <div class="mc-body gb-role-scroll">
            <table class="gb-role-table">
                <thead><tr><th></th>${pairs.map(p => `<th>${p.slot}</th>`).join('')}<th>TOT</th></tr></thead>
                <tbody>
                    ${row(t1, getA, t1?.color || 'var(--accent-red)', s1)}
                    ${row(t2, getB, t2?.color || 'var(--accent-blue)', s2)}
                </tbody>
            </table>
        </div>
    </div>`;
}

// ─── Grafico temporale (SVG) ─────────────────────────────────────

async function renderChart(m, year, week) {
    const el = document.getElementById('gb-chart');
    if (!el) return;
    const sched = await getWeekSchedule(year, week);
    if (!sched) {
        document.getElementById('gb-chart-card')?.remove();
        return;
    }
    el.innerHTML = buildChartSVG(m, sched);
}

function buildChartSVG(m, sched) {
    const t1 = teamOf(m.team1.name), t2 = teamOf(m.team2.name);
    const colors = [t1?.color || '#B8433A', t2?.color || '#4f8cff'];

    const mkSeries = (team) => (team.starters || []).map(p => ({
        pts: P(p), name: p.name, win: sched.get(canonAbbr(p.nfl_team)) || null,
    }));
    const series = [mkSeries(m.team1), mkSeries(m.team2)];

    const matched = series.flat().filter(x => x.win);
    if (!matched.length) return '<p class="mc-text">Calendario non disponibile per questa settimana.</p>';
    let t0 = Math.min(...matched.map(x => x.win.start.getTime()));
    let tEnd = Math.max(...matched.map(x => x.win.end.getTime()));
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

    const W = 920, H = 340, padL = 6, padR = 42, padT = 12, padB = 44;
    const X = (t) => padL + (t - T0) / (T1 - T0) * (W - padL - padR);
    const Y = (v) => padT + (1 - v / yTop) * (H - padT - padB);

    // griglia orizzontale
    let grid = '';
    for (let v = 0; v <= yTop; v += 25) {
        grid += `<line x1="${padL}" y1="${Y(v)}" x2="${W - padR}" y2="${Y(v)}" class="gbc-grid"/>
                 <text x="${W - padR + 8}" y="${Y(v) + 4}" class="gbc-ylabel">${v}</text>`;
    }

    // tick asse X: kickoff distinti (dedup entro 40')
    const kicks = [...new Set(matched.map(x => x.win.start.getTime()))].sort((a, b) => a - b);
    let lastKept = -Infinity, ticks = '';
    const dayFmt = new Intl.DateTimeFormat('it-IT', { timeZone: 'Europe/Rome', weekday: 'short' });
    const hourFmt = new Intl.DateTimeFormat('it-IT', { timeZone: 'Europe/Rome', hour: '2-digit', minute: '2-digit' });
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
                <title>${x.name} · ${x.pts.toFixed(2)} pt</title></circle>`;
    }).join('');

    const legend = `
        <div class="gbc-legend">
            <span class="gbc-legend-item"><i style="background:${colors[0]}"></i>${t1?.name || displayName(m.team1.name)}</span>
            <span class="gbc-legend-item"><i style="background:${colors[1]}"></i>${t2?.name || displayName(m.team2.name)}</span>
            <span class="gbc-legend-hint">· i punti si accumulano durante le partite reali dei titolari, un pallino a fine partita</span>
        </div>`;

    return `${legend}
    <div class="gbc-wrap">
        <svg viewBox="0 0 ${W} ${H}" class="gbc-svg" role="img" aria-label="Andamento punti nel weekend">
            ${grid}${ticks}
            ${line(series[0], colors[0])}${line(series[1], colors[1])}
            ${dots(series[0], colors[0])}${dots(series[1], colors[1])}
        </svg>
    </div>`;
}

// ─── Articolo + tabella outcome ──────────────────────────────────

function articleHTML(article, weekLabel) {
    return `
    <article class="mosaic-card gb-card gb-article mc-in">
        <span class="mc-kicker">${article.dateline}</span>
        <h2 class="gb-article-headline">${article.headline}</h2>
        ${article.paras.map(p => `<p class="gb-article-p">${p}</p>`).join('')}
    </article>`;
}

function outcomeHTML(m) {
    const pairs = slotPairs(m);
    const cell = (p) => {
        if (!p) return '<div class="gb-out-player"><span class="gb-out-name">—</span></div>';
        return `
        <div class="gb-out-player">
            <span class="gb-out-name">${p.name}</span>
            <span class="gb-out-meta">${(p.position_in_team || p.position || '')} - ${p.nfl_team || ''}${p.opponent ? ` | vs ${p.opponent.replace('@', '')}` : ''}</span>
        </div>`;
    };
    const rows = pairs.map(({ slot, a, b }) => {
        const pa = P(a), pb = P(b);
        return `
        <div class="gb-out-row">
            <span class="allpro-pos pos-${slot.toLowerCase().replace('/', '')}">${slot}</span>
            ${cell(a)}
            <span class="gb-out-pts${pa > pb ? ' win' : ''}">${pa.toFixed(2)}</span>
            <span class="gb-out-pts${pb > pa ? ' win' : ''}">${pb.toFixed(2)}</span>
            ${cell(b)}
        </div>`;
    }).join('');
    const t1 = teamOf(m.team1.name), t2 = teamOf(m.team2.name);
    return `
    <aside class="mosaic-card gb-card gb-outcome mc-in">
        <span class="mc-kicker">Matchup outcome</span>
        <div class="gb-out-head">
            <span style="color:${t1?.color || 'inherit'}">${t1?.name || displayName(m.team1.name)}</span>
            <span style="color:${t2?.color || 'inherit'}">${t2?.name || displayName(m.team2.name)}</span>
        </div>
        <div class="gb-out-rows">${rows}</div>
    </aside>`;
}

// ─── Barre stats di squadra ──────────────────────────────────────

function statBarsHTML(m) {
    const a = teamStatTotals(m.team1);
    const b = teamStatTotals(m.team2);
    const t1 = teamOf(m.team1.name), t2 = teamOf(m.team2.name);
    const LABELS = [
        ['passYds', 'Yard lancio'], ['rushYds', 'Yard corsa'],
        ['recYds', 'Yard ricezione'], ['td', 'Touchdown'], ['to', 'Palle perse'],
    ];
    const rows = LABELS.map(([k, label]) => {
        const max = Math.max(a[k], b[k], 1);
        return `
        <div class="gb-statbar">
            <span class="gb-statbar-label">${label}</span>
            <div class="gb-statbar-track"><div class="gb-statbar-fill" style="width:${(a[k] / max * 100).toFixed(0)}%;background:${t1?.color || 'var(--accent-red)'}"></div><span>${a[k]}</span></div>
            <div class="gb-statbar-track"><div class="gb-statbar-fill" style="width:${(b[k] / max * 100).toFixed(0)}%;background:${t2?.color || 'var(--accent-blue)'}"></div><span>${b[k]}</span></div>
        </div>`;
    }).join('');
    return `
    <div class="mosaic-card gb-card mc-in">
        <span class="mc-kicker">Confronto squadre</span>
        <h2 class="mc-title">Le cifre dei titolari</h2>
        <div class="mc-body gb-statbars">${rows}</div>
    </div>`;
}

// ─── Difference maker ────────────────────────────────────────────

function diffMakerHTML(m, dm, bundle, ranks) {
    const side = (p, rawName) => {
        if (!p) return '';
        const t = teamOf(rawName);
        return `
        <div class="gb-dm-side" style="--tc:${t?.color || 'var(--accent-red)'}">
            <img class="gb-headshot" src="images/fallback-player.svg" alt="${p.name}"
                 data-player-name="${p.name}" data-team="${p.nfl_team}" data-pos="${p.position_in_team || p.position}">
            <div class="gb-dm-info">
                <span class="gb-dm-name">${p.name}</span>
                <span class="gb-dm-meta">${(p.position_in_team || p.position || '')} · ${p.nfl_team || ''} · ${t?.name || displayName(rawName)}</span>
                <span class="gb-dm-pts">${fmt(P(p))} <small>pt</small></span>
            </div>
            <p class="gb-dm-comment">${playerComment(p, bundle, ranks)}</p>
        </div>`;
    };
    return `
    <div class="mosaic-card gb-card mc-in">
        <span class="mc-kicker">Difference maker</span>
        <h2 class="mc-title">Chi ha fatto la differenza</h2>
        <div class="mc-body gb-dm">
            ${side(dm.a, m.team1.name)}
            ${side(dm.b, m.team2.name)}
        </div>
    </div>`;
}

// ─── Player notes ────────────────────────────────────────────────

function notesHTML(notes) {
    if (!notes.length) return '';
    const rows = notes.map(({ player, teamRaw, text }) => {
        const t = teamOf(teamRaw);
        return `
        <div class="gb-note">
            <img class="gb-headshot gb-headshot-sm" src="images/fallback-player.svg" alt="${player.name}"
                 data-player-name="${player.name}" data-team="${player.nfl_team}" data-pos="${player.position_in_team || player.position}">
            <div class="gb-note-body">
                <div class="gb-note-head">
                    <span class="gb-note-name">${player.name}</span>
                    <span class="gb-note-meta">${(player.position_in_team || player.position || '')} · ${player.nfl_team || ''}</span>
                    ${t ? `<span class="gb-note-team" style="--tc:${t.color}">${t.name}</span>` : ''}
                </div>
                <p class="gb-note-text">${text}</p>
            </div>
        </div>`;
    }).join('');
    return `
    <div class="mosaic-card mc-wide gb-card mc-in">
        <span class="mc-kicker">Player notes</span>
        <h2 class="mc-title">I protagonisti</h2>
        <div class="mc-body gb-notes">${rows}</div>
    </div>`;
}

/** Headshot async via player-image-service (stesso pattern del draft) */
function loadHeadshots(section, year) {
    section.querySelectorAll('.gb-headshot').forEach(async (img) => {
        img.onerror = () => {
            if (!img.src.endsWith('fallback-player.svg')) img.src = 'images/fallback-player.svg';
        };
        try {
            const url = await playerImageService.getPlayerImageUrl(
                img.dataset.playerName, img.dataset.team, img.dataset.pos, year);
            if (url) img.src = url;
        } catch { /* resta il fallback */ }
    });
}
