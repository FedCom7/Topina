/**
 * All-Pro Team — la formazione ideale della stagione.
 * First e Second Team per gli slot di lineup della lega
 * (QB, RB×2, WR×2, TE, FLEX, K, DEF), da js/data/honors.js.
 */

import { CURRENT_SEASON } from '../data.js?v=32';
import { getHonorsBundle, honorsSeasons } from '../data/honors.js?v=14';
import { TEAMS } from './team.js?v=25';
import { paniniCard, initPlayerModal, hydratePaniniBadges } from '../components/player-modal.js?v=26';
import { playerImageService } from '../services/player-image-service.js?v=15';

let initialized = false;
let currentYear = CURRENT_SEASON;

const fmtPts = (n) => n.toLocaleString('it-IT', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export function initAllPro() {
    if (initialized) return;
    initialized = true;
    initPlayerModal(); // click su una figurina → scheda completa
    renderYearSelector();
    loadYear(currentYear);
}

function renderYearSelector() {
    const container = document.getElementById('ap-year-selector');
    if (!container) return;
    container.innerHTML = honorsSeasons().map(y =>
        `<button class="year-pill${y === currentYear ? ' active' : ''}" data-year="${y}">${y}</button>`
    ).join('');
    container.addEventListener('click', (e) => {
        const btn = e.target.closest('.year-pill');
        if (!btn) return;
        container.querySelectorAll('.year-pill').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        loadYear(btn.dataset.year);
    });
}

async function loadYear(year) {
    currentYear = year;
    const wrap = document.getElementById('allpro-content');
    wrap.innerHTML = `<div class="loading-state"><div class="spinner"></div><p>Loading ${year} All-Pro...</p></div>`;

    const bundle = await getHonorsBundle(year);
    if (!bundle) {
        wrap.innerHTML = `<div class="empty-state"><p class="empty-state-text">No data for the ${year} season</p></div>`;
        return;
    }

    if (!bundle.rsComplete) {
        wrap.innerHTML = `
        <div class="honors-teaser">
            <h2 class="honors-teaser-title">Selections in progress</h2>
            <p class="honors-teaser-text">The All-Pro Team is selected once the regular season ends, together with the Topina Honors.</p>
        </div>`;
        return;
    }

    wrap.innerHTML = `
        ${allProTeamHTML('First Team', bundle.allPro.first, 1)}
        ${allProTeamHTML('Second Team', bundle.allPro.second, 2)}
    `;
    hydrateImages(wrap);
    hydratePaniniBadges(wrap);
    bindCarousels(wrap);
}

function allProTeamHTML(label, team, tier) {
    const figs = team.map(({ slot, player }) => allProFig(slot, player)).join('');
    return `
    <div class="allpro-team allpro-team--${tier}">
        <div class="allpro-car-head">
            <h2 class="allpro-team-label">${label}</h2>
            <div class="allpro-car-nav">
                <button class="allpro-car-btn" data-dir="-1" aria-label="Previous">‹</button>
                <button class="allpro-car-btn" data-dir="1" aria-label="Next">›</button>
            </div>
        </div>
        <div class="allpro-track">${figs}</div>
    </div>`;
}

function allProFig(slot, player) {
    const posCls = slot.toLowerCase().replace('/', '');
    if (!player) {
        return `<div class="allpro-fig">
            <span class="allpro-fig-slot pos-${posCls}">${slot}</span>
            <div class="allpro-fig--empty">—</div>
        </div>`;
    }
    const team = TEAMS[player.teamKey];
    return `
    <div class="allpro-fig" style="--team-color:${team?.color || 'var(--accent-red)'}"
         data-player-modal data-player-name="${player.name}" data-pos="${player.pos || ''}"
         data-nfl="${player.nfl || ''}" data-year="${currentYear}">
        <span class="allpro-fig-slot pos-${posCls}">${slot}</span>
        ${paniniCard({ name: player.name, pos: player.pos, nfl: player.nfl, compact: true })}
        <div class="allpro-fig-cap">
            <span class="allpro-fig-pts">${fmtPts(player.total)}<small>pt</small></span>
            ${team ? `<span class="allpro-fig-team"><img src="${team.logo}" alt="" onerror="this.style.display='none'">${team.name}</span>` : ''}
        </div>
    </div>`;
}

/** Frecce del carosello: scorrono la track di ~una card e mezza. */
function bindCarousels(wrap) {
    wrap.querySelectorAll('.allpro-team').forEach(teamEl => {
        const track = teamEl.querySelector('.allpro-track');
        if (!track) return;
        teamEl.querySelectorAll('.allpro-car-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const step = Math.round(track.clientWidth * 0.7);
                track.scrollBy({ left: step * Number(btn.dataset.dir), behavior: 'smooth' });
            });
        });
    });
}

function hydrateImages(wrap) {
    wrap.querySelectorAll('.pm-headshot').forEach(async (img) => {
        const name = img.dataset.playerName;
        if (!name) return;
        img.onerror = () => {
            if (!img.src.endsWith('images/fallback-player.svg')) img.src = 'images/fallback-player.svg';
        };
        try {
            const url = await playerImageService.getPlayerImageUrl(name, img.dataset.team, img.dataset.pos, currentYear);
            if (url) img.src = url;
        } catch (e) { /* fallback già impostato */ }
    });
}
