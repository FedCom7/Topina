import { fetchFantasyData, getWeekCount, displayName, teamNameHTML, SEASONS, CURRENT_SEASON, getSeasonConfig } from '../data.js?v=32';
import { TEAM_LOGOS, TEAM_KEYS } from '../data/team-config.js?v=31';
import { TEAMS } from './team.js?v=23';
import { initPlayerModal } from '../components/player-modal.js?v=25';
import { playerImageService } from '../services/player-image-service.js?v=15';

let currentData = null;
let currentYear = CURRENT_SEASON;
let currentWeek = 1;
let loaded = false;

// Mapping display names → image filename abbreviations
const TEAM_FIELD_KEYS = {
    'Oscurus': 'OSCURUS',
    'Lasers': 'LASERS',
    'Sommo': 'SOMMO',
    'Capi dei Pianeti': 'C.D.P'
};

// Cache-bust dei wallpaper del campo: da bumpare quando si sostituiscono i file
// (il browser altrimenti li tiene in cache disco a tempo indefinito, non avendo
// header Cache-Control il server locale di sviluppo).
const FIELD_IMG_VERSION = 2;

/** Build the correct field image path for a matchup */
function getFieldImage(team1Name, team2Name) {
    const k1 = TEAM_FIELD_KEYS[displayName(team1Name)];
    const k2 = TEAM_FIELD_KEYS[displayName(team2Name)];
    const file = (k1 && k2) ? `Wallpapers/GameCenterHorizontal_${k1}_${k2}.png` : 'Wallpapers/GameCenterHorizontal.PNG';
    return `${file}?v=${FIELD_IMG_VERSION}`;
}

export async function initGameCenter() {
    if (loaded) return;
    loaded = true;
    initPlayerModal();
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
        grid.innerHTML = `<div class="empty-state"><p class="empty-state-text">Nessun dato per la stagione ${year}</p></div>`;
        document.getElementById('gc-week-selector').innerHTML = '';
        return;
    }

    const maxWeek = getWeekCount(currentData);
    currentWeek = lastPlayedWeek(maxWeek);
    renderWeekSelector(maxWeek);
    renderMatchups();
}

/** Ultima week con punti giocati (default all'apertura); 1 se la stagione non è iniziata. */
function lastPlayedWeek(maxWeek) {
    for (let w = maxWeek; w >= 1; w--) {
        const wk = currentData.weeks[String(w)];
        if (wk?.matchups?.some(m =>
            (parseFloat(m.team1?.score) || 0) > 0 || (parseFloat(m.team2?.score) || 0) > 0)) {
            return w;
        }
    }
    return 1;
}

function renderWeekSelector(maxWeek) {
    const container = document.getElementById('gc-week-selector');
    const config = getSeasonConfig(currentYear);

    let html = '';
    for (let w = 1; w <= maxWeek; w++) {
        let label = String(w);
        let extraClass = '';
        if (w === config.playoffWeek) { label = 'Playoffs'; extraClass = ' playoff-pill'; }
        else if (w === config.superBowlWeek) { label = 'Super Bowl'; extraClass = ' sb-pill'; }
        html += `<button class="week-pill${w === currentWeek ? ' active' : ''}${extraClass}" data-week="${w}">${label}</button>`;
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
    const config = getSeasonConfig(currentYear);
    if (w === config.playoffWeek) return 'Playoffs';
    if (w === config.superBowlWeek) return 'Super Bowl';
    return `Week ${w}`;
}

function renderMatchups() {
    const grid = document.getElementById('gc-matchup-grid');
    const weekData = currentData?.weeks?.[String(currentWeek)];
    if (!weekData?.matchups?.length) {
        grid.innerHTML = `<div class="empty-state"><p class="empty-state-text">Nessun matchup per ${weekLabel(currentWeek)}</p></div>`;
        return;
    }

    // Sort Super Bowl week: Final (highest score?) first — conservando
    // l'indice originale, usato dalla route #game/{year}/{week}/{idx}
    let matchups = weekData.matchups.map((m, idx) => ({ m, idx }));
    if (currentWeek === getSeasonConfig(currentYear).superBowlWeek) {
        matchups.sort((a, b) => {
            const totalA = parseFloat(a.m.team1.score) + parseFloat(a.m.team2.score);
            const totalB = parseFloat(b.m.team1.score) + parseFloat(b.m.team2.score);
            return totalB - totalA; // Descending
        });
    }

    grid.innerHTML = matchups.map(({ m, idx }, i) => {
        const s1 = parseFloat(m.team1.score);
        const s2 = parseFloat(m.team2.score);
        const w1 = s1 >= s2;

        const logo1 = TEAM_LOGOS[displayName(m.team1.name)] || 'images/nfl_logo.png';
        const logo2 = TEAM_LOGOS[displayName(m.team2.name)] || 'images/nfl_logo.png';
        const c1 = TEAMS[TEAM_KEYS[displayName(m.team1.name)]]?.color || 'var(--accent-red)';
        const c2 = TEAMS[TEAM_KEYS[displayName(m.team2.name)]]?.color || 'var(--accent-blue)';
        const fieldImg = getFieldImage(m.team1.name, m.team2.name);

        return `
        <div class="matchup-card" style="animation-delay:${i * 80}ms" data-idx="${idx}">
            <a class="gc-banner" href="#game/${currentYear}/${currentWeek}/${idx}"
               style="--tc1:${c1};--tc2:${c2}" title="Apri l'analisi della partita">
                <img class="gc-banner-wm gc-banner-wm-l" src="${logo1}" alt="" aria-hidden="true">
                <img class="gc-banner-wm gc-banner-wm-r" src="${logo2}" alt="" aria-hidden="true">
                <div class="gc-banner-inner">
                    <div class="gc-banner-side">
                        <span class="gc-banner-name">${teamNameHTML(m.team1.name)}</span>
                    </div>
                    <span class="gc-banner-score${w1 ? ' winner' : ''}">${m.team1.score}</span>
                    <div class="gc-banner-mid">
                        <span class="gc-banner-vs">vs</span>
                        <span class="gc-banner-cta">Analisi <span aria-hidden="true">→</span></span>
                    </div>
                    <span class="gc-banner-score${!w1 ? ' winner' : ''}">${m.team2.score}</span>
                    <div class="gc-banner-side gc-banner-side-r">
                        <span class="gc-banner-name">${teamNameHTML(m.team2.name)}</span>
                    </div>
                </div>
            </a>
            <div class="matchup-field-horizontal">
                <span class="field-team-label field-team-label-top">${teamNameHTML(m.team1.name)}</span>
                <img src="${fieldImg}" class="field-bg" alt="">
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
                    
                    <!-- DEF/K positioned by CSS -->
                    ${renderDefK(m.team1, 'left')}
                    ${renderDefK(m.team2, 'right')}
                </div>
                <span class="field-team-label field-team-label-bottom">${teamNameHTML(m.team2.name)}</span>
            </div>
            <div class="field-bottom-row">
                <div class="bench-half bench-left">
                    <span class="bench-label">${teamNameHTML(m.team1.name)}</span>
                    ${renderBench(m.team1)}
                </div>
                <div class="bench-half bench-right">
                    <span class="bench-label">${teamNameHTML(m.team2.name)}</span>
                    ${renderBench(m.team2)}
                </div>
            </div>
        </div>`;
    }).join('');

    hydrateSlotPhotos(grid);
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
    return `<div class="formation-slot special-slot ${side}-${type.toLowerCase()}" ${modalAttrs(p)}>
        ${slotContent(p)}
    </div>`;
}

/**
 * Attributi per aprire la scheda giocatore sul click, col contesto della
 * partita mostrata (punti, avversario, esito, stats): il modal ci costruisce
 * il blocco "Questa partita".
 */
function modalAttrs(p, isBench = false) {
    const game = {
        pts: parseFloat(p.fantasy_points) || 0,
        opponent: p.opponent || '',
        status: p.status || '',
        week: currentWeek,
        year: currentYear,
        started: !isBench,
        stats: p.stats || {},
    };
    const payload = encodeURIComponent(JSON.stringify(game));
    return `data-player-modal
             data-player-name="${escAttr(p.name)}"
             data-pos="${escAttr((p.position || '').toUpperCase())}"
             data-nfl="${escAttr(p.nfl_team || '')}"
             data-year="${currentYear}"
             data-game="${payload}"`;
}

function escAttr(s) {
    return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

/** "Marvin Guiu" → "M. Guiu". Le DEF restano col nome squadra intero. */
function shortName(p) {
    const role = (p.position_in_team || p.position || '').toUpperCase();
    if (role === 'DEF') return p.name;
    const parts = String(p.name).trim().split(/\s+/);
    if (parts.length < 2) return p.name;
    return `${parts[0][0]}. ${parts.slice(1).join(' ')}`;
}

function slotContent(p) {
    const role = (p.position_in_team || p.position || '').toUpperCase();
    return `<span class="slot-photo"><img src="images/fallback-player.svg" alt="" loading="lazy"
                data-headshot data-player-name="${p.name}" data-team="${p.nfl_team || ''}"
                data-pos="${role}" data-year="${currentYear}"></span>
            <span class="slot-name">${shortName(p)}</span>
            <span class="slot-pts">${p.fantasy_points}</span>`;
}

/** Riempie le foto degli slot dopo il render, senza bloccare (pattern draft/home). */
function hydrateSlotPhotos(grid) {
    grid.querySelectorAll('img[data-headshot]').forEach(img => {
        img.onerror = () => {
            if (!img.src.endsWith('fallback-player.svg')) img.src = 'images/fallback-player.svg';
        };
        playerImageService.getPlayerImageUrl(img.dataset.playerName, img.dataset.team, img.dataset.pos, img.dataset.year)
            .then(url => { if (url) img.src = url; })
            .catch(() => { /* resta il fallback */ });
    });
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
    return `<div class="formation-slot${isBench ? ' bench-slot' : ''}" ${modalAttrs(p, isBench)}>
        ${slotContent(p)}
    </div>`;
}

