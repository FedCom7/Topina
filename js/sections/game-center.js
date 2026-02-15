import { fetchFantasyData, getWeekCount, displayName, SEASONS, CURRENT_SEASON, PLAYOFF_WEEK, SUPERBOWL_WEEK } from '../data.js';
import { TEAM_LOGOS } from '../data/team-config.js';

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

    // Sort Super Bowl week: Final (highest score?) first
    let matchups = [...weekData.matchups];
    if (currentWeek === SUPERBOWL_WEEK) {
        matchups.sort((a, b) => {
            const totalA = parseFloat(a.team1.score) + parseFloat(a.team2.score);
            const totalB = parseFloat(b.team1.score) + parseFloat(b.team2.score);
            return totalB - totalA; // Descending
        });
    }

    grid.innerHTML = matchups.map((m, i) => {
        const s1 = parseFloat(m.team1.score);
        const s2 = parseFloat(m.team2.score);
        const w1 = s1 >= s2;

        const logo1 = TEAM_LOGOS[displayName(m.team1.name)] || 'images/nfl_logo.png';
        const logo2 = TEAM_LOGOS[displayName(m.team2.name)] || 'images/nfl_logo.png';

        return `
        <div class="matchup-card" style="animation-delay:${i * 80}ms" data-idx="${i}">
            <div class="matchup-main fox-scoreboard">
                <div class="logo-3d logo-3d-left">
                    <img src="${logo1}" alt="${m.team1.name}" class="fox-logo">
                </div>
                <span class="fox-name">${displayName(m.team1.name)}</span>
                <div class="score-block">
                    <span class="fox-score ${w1 ? 'winner' : ''}">${m.team1.score}</span>
                    <span class="fox-vs">vs</span>
                    <span class="fox-score ${!w1 ? 'winner' : ''}">${m.team2.score}</span>
                </div>
                <span class="fox-name">${displayName(m.team2.name)}</span>
                <div class="logo-3d logo-3d-right">
                    <img src="${logo2}" alt="${m.team2.name}" class="fox-logo">
                </div>
            </div>
            <div class="matchup-field-horizontal">
                <img src="Wallpapers/GameCenterHorizontal.PNG" class="field-bg" alt="">
                <div class="field-overlay">
                    <div class="formations-area">
                        <div class="team-formation left">
                            ${renderRoster(m.team1, 'left')}
                        </div>
                        <div class="scrimmage-center"></div>
                        <div class="team-formation right">
                            ${renderRoster(m.team2, 'right')}
                        </div>
                    </div>
                    
                    <!-- ABSOLUTE POSITIONED DEF/K -->
                    ${renderDefK(m.team1, 'left')}
                    ${renderDefK(m.team2, 'right')}

                    <div class="field-bottom-row">
                        <div class="bench-half bench-left">${renderBench(m.team1)}</div>
                        <div class="bench-half bench-right">${renderBench(m.team2)}</div>
                    </div>
                </div>
            </div>
        </div>`;
    }).join('');
}

/** DEF + K positioned absolutely on field */
function renderDefK(team, side) {
    const starters = team.starters || [];
    const getP = (pos) => starters.find(p => (p.position || '').toUpperCase() === pos);

    const def = getP('DEF');
    const k = getP('K');

    // Return HTML with specific classes for positioning
    // We'll use specific classes: .special-slot.left-def, .special-slot.left-k, etc.
    let html = '';
    if (def) html += specialSlot(def, side, 'DEF');
    if (k) html += specialSlot(k, side, 'K');
    return html;
}

function specialSlot(p, side, type) {
    // type is 'DEF' or 'K'
    // side is 'left' or 'right'
    return `<div class="formation-slot special-slot ${side}-${type.toLowerCase()}">
        ${slotContent(p)}
    </div>`;
}

function slotContent(p) {
    const raw = (p.position || 'BN').toUpperCase();
    const pos = raw === 'W/R' ? 'FLEX' : raw;
    const posLower = pos.toLowerCase();
    return `<span class="slot-pos pos-${posLower}">${raw}</span>
            <span class="slot-name">${p.name}</span>
            <span class="slot-pts">${p.fantasy_points}</span>`;
}

function renderRoster(team, side) {
    const starters = team.starters || [];

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

    // Column: QB
    const qbCol =
        `<div class="formation-col col-qb">` +
        slotCard(byPos('QB', 0)) +
        `</div>`;

    // Column: RBs (behind QB, further from scrimmage)
    const rbCol =
        `<div class="formation-col col-rb">` +
        slotCard(byPos('RB', 0)) +
        slotCard(byPos('RB', 1)) +
        `</div>`;

    // Column: Line of scrimmage
    const lineCol =
        `<div class="formation-col col-line">` +
        slotCard(byPos('WR', 0)) +
        slotCard(byPos('TE', 0)) +
        olineSlot() + olineSlot() + olineSlot() + olineSlot() + olineSlot() +
        slotCard(byPos('FLEX', 0)) +
        slotCard(byPos('WR', 1)) +
        `</div>`;

    // Left team: RBs → QB → Line (faces right →)
    // Right team: Line → QB → RBs (faces left ←)
    if (side === 'left') {
        return rbCol + qbCol + lineCol;
    } else {
        return lineCol + qbCol + rbCol;
    }
}

function renderBench(team) {
    const bench = team.bench || [];
    if (!bench.length) return '';
    return bench.map(p => slotCard(p, true)).join('');
}

/** OL marker — small, transparent with dark border and X */
function olineSlot() {
    return `<div class="formation-slot oline-x">✕</div>`;
}

function slotCard(p, isBench = false) {
    if (!p) return '';
    return `<div class="formation-slot${isBench ? ' bench-slot' : ''}">
        ${slotContent(p)}
    </div>`;
}

