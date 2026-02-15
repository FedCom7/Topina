/**
 * Draft Section
 * Year selector + Round filter → draft pick cards
 */
import { fetchDraftData, flattenDraft, displayName, SEASONS, CURRENT_SEASON } from '../data.js';
import { TEAM_KEYS } from '../data/team-config.js';
import { playerImageService } from '../services/player-image-service.js?v=4';
import { db } from '../firebase-config.js';

let loaded = false;
let currentPicks = [];
let currentYear = null;

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
    currentYear = year; // Update global
    const grid = document.getElementById('draft-grid');
    grid.innerHTML = `<div class="loading-state"><div class="spinner"></div><p>Caricamento draft ${year}...</p></div>`;

    try {
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
    } catch (e) {
        console.error(`[Draft] Error loading year ${year}:`, e);
        grid.innerHTML = `<div class="error-state"><p>Errore nel caricamento: ${e.message}</p></div>`;
    }
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
        const teamKey = TEAM_KEYS[displayName(p.team)] || 'default';
        const fallback = 'images/fallback-player.svg';

        return `
        <div class="draft-card bg-team-${teamKey}" style="animation-delay:${(i % 12) * 40}ms">
            <div class="draft-card-image">
                 <img src="${fallback}" class="draft-headshot" data-player-name="${p.player}" data-team="${p.nfl}" data-pos="${p.pos}" alt="${p.player}">
                 <div class="draft-pick-badge">#${p.pick}</div>
            </div>
            <div class="draft-card-info">
                <div class="draft-player-name">${p.player}</div>
                <div class="draft-meta-row">
                    <span class="player-pos ${posClass}">${p.pos}</span>
                    <span class="draft-nfl-team">${p.nfl}</span>
                </div>
                <div class="draft-fantasy-team">
                    <span class="label">Drafted by</span>
                    <span class="team-name">${displayName(p.team)}</span>
                </div>
            </div>
        </div>`;
    }).join('');

    // Load images asynchronously
    updateDraftImages(currentYear);
}

/** Update src for all player headshots */
function updateDraftImages(year) {
    const images = document.querySelectorAll('.draft-headshot'); images.forEach(async (img) => {
        const name = img.dataset.playerName;
        const team = img.dataset.team;
        const pos = img.dataset.pos;

        // Setup error handler for 404s
        img.onerror = () => {
            if (img.src !== 'images/fallback-player.svg') {
                img.src = 'images/fallback-player.svg';
            }
        };

        if (name) {
            try {
                // Pass Team and Position to the service!
                // Pass YEAR to avoid searching current rosters for old players
                const url = await playerImageService.getPlayerImageUrl(name, team, pos, year);
                img.src = url;
            } catch (e) {
                console.warn('Failed to load image for', name);
                img.src = 'images/fallback-player.svg';
            }
        }
    });
}
