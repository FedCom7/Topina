/**
 * Draft Section
 * Year selector + Round filter → draft pick cards
 */
import { fetchDraftData, flattenDraft, displayName, SEASONS, CURRENT_SEASON } from '../data.js';

let loaded = false;
let currentPicks = [];

export async function initDraft() {
    if (loaded) return;
    loaded = true;
    renderYearSelector();
    await loadYear(CURRENT_SEASON);
}

function renderYearSelector() {
    const container = document.getElementById('dr-year-selector');
    container.innerHTML = SEASONS.map(y =>
        `<button class="year-pill${y === CURRENT_SEASON ? ' active' : ''}" data-year="${y}">${y}</button>`
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
    const grid = document.getElementById('draft-grid');
    grid.innerHTML = `<div class="loading-state"><div class="spinner"></div><p>Caricamento draft ${year}...</p></div>`;

    const data = await fetchDraftData(year);
    if (!data) {
        grid.innerHTML = `<div class="empty-state"><div class="empty-state-icon">📭</div><p class="empty-state-text">Nessun draft per il ${year}</p></div>`;
        document.getElementById('dr-round-selector').innerHTML = '';
        return;
    }

    currentPicks = flattenDraft(data);
    if (!currentPicks.length) {
        grid.innerHTML = `<div class="empty-state"><div class="empty-state-icon">📋</div><p class="empty-state-text">Dati draft non disponibili</p></div>`;
        return;
    }

    const maxRound = Math.max(...currentPicks.map(p => p.round));
    renderRoundSelector(maxRound);
    renderCards('all');
}

function renderRoundSelector(maxRound) {
    const container = document.getElementById('dr-round-selector');
    let html = `<button class="round-pill active" data-round="all">Tutti</button>`;
    for (let r = 1; r <= maxRound; r++) {
        html += `<button class="round-pill" data-round="${r}">R${r}</button>`;
    }
    container.innerHTML = html;
    container.addEventListener('click', (e) => {
        const btn = e.target.closest('.round-pill');
        if (!btn) return;
        container.querySelectorAll('.round-pill').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        renderCards(btn.dataset.round);
    });
}

function renderCards(round) {
    const grid = document.getElementById('draft-grid');
    const picks = round === 'all' ? currentPicks : currentPicks.filter(p => p.round === parseInt(round));

    grid.innerHTML = picks.map((p, i) => {
        const posClass = `pos-${(p.pos || '').toLowerCase().replace('/', '')}`;
        return `
        <div class="draft-card" style="animation-delay:${(i % 12) * 40}ms">
            <div class="draft-pick-num">#${p.pick}</div>
            <div class="draft-info">
                <div class="draft-player">${p.player}</div>
                <div class="draft-meta">
                    <span class="player-pos ${posClass}" style="display:inline-block;margin-right:6px;">${p.pos}</span>
                    ${p.nfl} → <strong>${displayName(p.team)}</strong>
                </div>
            </div>
        </div>`;
    }).join('');
}
