/**
 * All-Pro Team — la formazione ideale della stagione.
 * First e Second Team per gli slot di lineup della lega
 * (QB, RB×2, WR×2, TE, FLEX, K, DEF), da js/data/honors.js.
 */

import { CURRENT_SEASON } from '../data.js?v=22';
import { getHonorsBundle, honorsSeasons } from '../data/honors.js?v=4';
import { TEAMS } from './team.js?v=14';

let initialized = false;
let currentYear = CURRENT_SEASON;

const fmtPts = (n) => n.toLocaleString('it-IT', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export function initAllPro() {
    if (initialized) return;
    initialized = true;
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
    wrap.innerHTML = `<div class="loading-state"><div class="spinner"></div><p>Caricamento All-Pro ${year}...</p></div>`;

    const bundle = await getHonorsBundle(year);
    if (!bundle) {
        wrap.innerHTML = `<div class="empty-state"><p class="empty-state-text">Nessun dato per la stagione ${year}</p></div>`;
        return;
    }

    if (!bundle.rsComplete) {
        wrap.innerHTML = `
        <div class="honors-teaser">
            <h2 class="honors-teaser-title">Selezioni in corso</h2>
            <p class="honors-teaser-text">L'All-Pro Team viene selezionato a regular season conclusa, insieme ai Topina Honors.</p>
        </div>`;
        return;
    }

    wrap.innerHTML = `
        ${allProTeamHTML('First Team', bundle.allPro.first, 1)}
        ${allProTeamHTML('Second Team', bundle.allPro.second, 2)}
    `;
}

function allProTeamHTML(label, team, tier) {
    const rows = team.map((slot, i) => allProRow(slot, i)).join('');
    return `
    <div class="allpro-team allpro-team--${tier}">
        <h2 class="allpro-team-label">${label}</h2>
        <div class="allpro-rows">${rows}</div>
    </div>`;
}

function allProRow({ slot, player }, i) {
    if (!player) {
        return `<div class="allpro-row" style="--row-i:${i}">
            <span class="allpro-pos pos-${slot.toLowerCase()}">${slot}</span>
            <span class="allpro-name">—</span>
        </div>`;
    }
    const team = TEAMS[player.teamKey];
    return `
    <div class="allpro-row" style="--row-i:${i};--team-color:${team?.color || 'var(--accent-red)'}">
        <span class="allpro-pos pos-${slot.toLowerCase()}">${slot}</span>
        <div class="allpro-info">
            <span class="allpro-name">${player.name}</span>
            <span class="allpro-meta">${player.pos}${player.nfl ? ` · ${player.nfl}` : ''}${team ? ` · ${team.name}` : ''}</span>
        </div>
        ${team ? `<img class="allpro-team-logo" src="${team.logo}" alt="${team.name}" onerror="this.style.display='none'">` : ''}
        <span class="allpro-pts">${fmtPts(player.total)}<small>pt</small></span>
    </div>`;
}
