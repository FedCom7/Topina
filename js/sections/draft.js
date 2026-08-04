/**
 * Draft Section
 * Year selector + Round filter → draft pick cards
 */
import { fetchDraftData, flattenDraft, displayName, SEASONS, CURRENT_SEASON } from '../data.js?v=33';
import { TEAM_KEYS } from '../data/team-config.js?v=31';
import { TEAMS } from './team.js?v=25';
import { playerImageService } from '../services/player-image-service.js?v=15';
import { initPlayerModal, paniniCard, hydratePaniniBadges } from '../components/player-modal.js?v=26';
import { db } from '../firebase-config.js';

let loaded = false;
let currentPicks = [];
let currentYear = null;

export async function initDraft() {
    if (loaded) return;
    loaded = true;
    initPlayerModal();
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
    grid.innerHTML = `<div class="loading-state"><div class="spinner"></div><p>Loading ${year} draft...</p></div>`;

    try {
        const data = await fetchDraftData(year);
        if (!data) {
            grid.innerHTML = `<div class="empty-state"><p class="empty-state-text">No draft for ${year}</p></div>`;
            document.getElementById('dr-round-selector').innerHTML = '';
            return;
        }

        currentPicks = flattenDraft(data);

        if (!currentPicks.length) {
            grid.innerHTML = `<div class="empty-state"><p class="empty-state-text">Draft data not available</p></div>`;
            return;
        }

        const maxRound = Math.max(...currentPicks.map(p => p.round));
        renderRoundSelector(maxRound);
        renderCards('all');
    } catch (e) {
        console.error(`[Draft] Error loading year ${year}:`, e);
        grid.innerHTML = `<div class="error-state"><p>Error loading: ${e.message}</p></div>`;
    }
}

function renderRoundSelector(maxRound) {
    const container = document.getElementById('dr-round-selector');
    let html = `<button class="round-pill active" data-round="all">All</button>`;
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
        const teamKey = TEAM_KEYS[displayName(p.team)] || null;
        const team = TEAMS[teamKey] || null;

        return `
        <div class="draft-fig" data-player-modal
             data-player-name="${p.player}" data-pos="${p.pos}" data-nfl="${p.nfl || ''}" data-year="${currentYear}"
             style="--team-color:${team?.color || 'var(--accent-red)'};animation-delay:${(i % 12) * 40}ms">
            <div class="draft-fig-card">
                <span class="draft-fig-pick">#${p.pick}</span>
                ${paniniCard({ name: p.player, pos: p.pos, nfl: p.nfl, compact: true })}
            </div>
            <div class="draft-fig-cap">
                <span class="draft-fig-label">Drafted by</span>
                <span class="draft-fig-team">
                    ${team ? `<img src="${team.logo}" alt="" onerror="this.style.display='none'">` : ''}
                    ${team?.name || displayName(p.team)}
                </span>
            </div>
        </div>`;
    }).join('');

    // Load images asynchronously
    updateDraftImages(currentYear);
    hydratePaniniBadges(grid);
}

/** Update src for all player headshots */
function updateDraftImages(year) {
    const images = document.querySelectorAll('.pm-headshot'); images.forEach(async (img) => {
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
