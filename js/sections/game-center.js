/**
 * Game Center Section
 * Year + Week selectors → matchup cards with expandable rosters
 */
import { fetchFantasyData, getWeekCount, displayName, SEASONS, CURRENT_SEASON, PLAYOFF_WEEK, SUPERBOWL_WEEK } from '../data.js';

let currentData = null;
let currentYear = CURRENT_SEASON;
let currentWeek = 1;
let loaded = false;

export async function initGameCenter() {
    if (loaded) return;
    loaded = true;
    renderYearSelector();
    await loadYear(CURRENT_SEASON);
}

function renderYearSelector() {
    const container = document.getElementById('gc-year-selector');
    container.innerHTML = SEASONS.map(y =>
        `<button class="year-pill${y === currentYear ? ' active' : ''}" data-year="${y}">${y}</button>`
    ).join('');
    container.addEventListener('click', async (e) => {
        const btn = e.target.closest('.year-pill');
        if (!btn) return;
        container.querySelectorAll('.year-pill').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        await loadYear(btn.dataset.year);
    });
}

async function loadYear(year) {
    currentYear = year;
    const grid = document.getElementById('gc-matchup-grid');
    grid.innerHTML = `<div class="loading-state"><div class="spinner"></div><p>Caricamento ${year}...</p></div>`;

    currentData = await fetchFantasyData(year);
    if (!currentData?.weeks) {
        grid.innerHTML = `<div class="empty-state"><div class="empty-state-icon">📭</div><p class="empty-state-text">Nessun dato per la stagione ${year}</p></div>`;
        document.getElementById('gc-week-selector').innerHTML = '';
        return;
    }

    const maxWeek = getWeekCount(currentData);
    currentWeek = 1;
    renderWeekSelector(maxWeek);
    renderMatchups();
}

function renderWeekSelector(maxWeek) {
    const container = document.getElementById('gc-week-selector');
    let html = '';
    for (let w = 1; w <= maxWeek; w++) {
        let label = String(w);
        let extraClass = '';
        if (w === PLAYOFF_WEEK) { label = '🏈 Playoffs'; extraClass = ' playoff-pill'; }
        else if (w === SUPERBOWL_WEEK) { label = '🏆 Super Bowl'; extraClass = ' sb-pill'; }
        html += `<button class="week-pill${w === 1 ? ' active' : ''}${extraClass}" data-week="${w}">${label}</button>`;
    }
    container.innerHTML = html;
    container.addEventListener('click', (e) => {
        const btn = e.target.closest('.week-pill');
        if (!btn) return;
        container.querySelectorAll('.week-pill').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentWeek = parseInt(btn.dataset.week);
        renderMatchups();
    });
}

function weekLabel(w) {
    if (w === PLAYOFF_WEEK) return 'Playoffs';
    if (w === SUPERBOWL_WEEK) return 'Super Bowl';
    return `Week ${w}`;
}

function renderMatchups() {
    const grid = document.getElementById('gc-matchup-grid');
    const weekData = currentData?.weeks?.[String(currentWeek)];
    if (!weekData?.matchups?.length) {
        grid.innerHTML = `<div class="empty-state"><div class="empty-state-icon">🏈</div><p class="empty-state-text">Nessun matchup per ${weekLabel(currentWeek)}</p></div>`;
        return;
    }

    grid.innerHTML = weekData.matchups.map((m, i) => {
        const s1 = parseFloat(m.team1.score);
        const s2 = parseFloat(m.team2.score);
        const w1 = s1 >= s2;

        return `
        <div class="matchup-card" style="animation-delay:${i * 80}ms" data-idx="${i}">
            <div class="matchup-main">
                <div class="matchup-team">
                    <span class="matchup-team-name">${displayName(m.team1.name)}</span>
                    <span class="matchup-score ${w1 ? 'winner' : 'loser'}">${m.team1.score}</span>
                </div>
                <span class="matchup-vs">VS</span>
                <div class="matchup-team right">
                    <span class="matchup-score ${!w1 ? 'winner' : 'loser'}">${m.team2.score}</span>
                    <span class="matchup-team-name">${displayName(m.team2.name)}</span>
                </div>
            </div>
            <div class="matchup-roster">
                <div class="roster-grid">
                    <div class="roster-side">
                        <h4>${displayName(m.team1.name)}</h4>
                        ${renderRoster(m.team1)}
                    </div>
                    <div class="roster-side">
                        <h4>${displayName(m.team2.name)}</h4>
                        ${renderRoster(m.team2)}
                    </div>
                </div>
            </div>
        </div>`;
    }).join('');
}

function renderRoster(team) {
    const starters = team.starters || [];
    const bench = team.bench || [];

    const byPos = (pos, nth = 0) => {
        let count = 0;
        for (const p of starters) {
            const pPos = (p.position || '').toUpperCase();
            if (pPos === pos.toUpperCase() || (pos === 'FLEX' && pPos === 'W/R')) {
                if (count === nth) return p;
                count++;
            }
        }
        return null;
    };

    // American football — Trips Right formation (top-down view)
    //
    //              [DEF]           [K]  ← defensive side, K top-right
    //  ═══════ LINE OF SCRIMMAGE ═══════
    //  WR  TE [X X X X X]  W/R  WR    ← offensive line
    //              [QB]                 ← under center
    //           [RB]  [RB]              ← backfield

    // Row 0: DEF centered + K in top-right corner
    const defRow =
        `<div class="formation-row row-def">` +
        slotCard(byPos('DEF', 0)) +
        slotCard(byPos('K', 0)) +
        `</div>`;

    // Scrimmage line divider
    const scrimmage = `<div class="scrimmage-line"></div>`;

    // Row 1: Line of scrimmage — WR (left) + TE + 5 OL + FLEX + WR (right)
    const lineRow =
        `<div class="formation-row row-line">` +
        slotCard(byPos('WR', 0)) +
        slotCard(byPos('TE', 0)) +
        olineX() + olineX() + olineX() + olineX() + olineX() +
        slotCard(byPos('FLEX', 0)) +
        slotCard(byPos('WR', 1)) +
        `</div>`;

    // Row 2: QB under center
    const qbRow =
        `<div class="formation-row row-qb">` +
        slotCard(byPos('QB', 0)) +
        `</div>`;

    // Row 3: RBs in the backfield
    const rbRow =
        `<div class="formation-row row-rb">` +
        slotCard(byPos('RB', 0)) +
        slotCard(byPos('RB', 1)) +
        `</div>`;

    const fieldHtml = defRow + scrimmage + lineRow + qbRow + rbRow;

    const benchHtml = bench.map(p => slotCard(p, true)).join('');

    return `<div class="formation-container">
        <div class="formation-field">
            ${fieldMarkings()}
            ${fieldHtml}
        </div>
        ${bench.length ? `<div class="formation-bench">
            <div class="bench-title">Panchina</div>${benchHtml}
        </div>` : ''}
    </div>`;
}

/** Football field yard-line overlay (watermark) */
function fieldMarkings() {
    // Yard numbers mirrored: 10 20 30 40 50 40 30 20 10
    const yards = [10, 20, 30, 40, 50, 40, 30, 20, 10];
    // Position each line evenly from 8% to 92% of the field height
    const lines = yards.map((y, i) => {
        const top = 8 + i * (84 / (yards.length - 1));   // 8% … 92%
        return `<div class="yard-line" style="top:${top.toFixed(1)}%">
            <span class="yard-num yl">${y}</span>
            <span class="yard-hash yhl"></span>
            <span class="yard-hash yhr"></span>
            <span class="yard-num yr">${y}</span>
        </div>`;
    }).join('');
    return `<div class="field-markings">${lines}</div>`;
}

/** Transparent offensive lineman marker */
function olineX() {
    return `<div class="formation-slot oline-x">✕</div>`;
}

function slotCard(p, isBench = false) {
    if (!p) return '';
    const raw = (p.position || 'BN').toUpperCase();
    const pos = raw === 'W/R' ? 'FLEX' : raw;
    const posLower = pos.toLowerCase();
    return `<div class="formation-slot${isBench ? ' bench-slot' : ''}">
        <span class="slot-pos pos-${posLower}">${raw}</span>
        <span class="slot-name">${p.name}</span>
        <span class="slot-pts">${p.fantasy_points}</span>
    </div>`;
}
