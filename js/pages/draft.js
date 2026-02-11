/**
 * Draft Page Renderer
 * Renders draft pick cards and handles round filtering.
 */
import { initScrollAnimations } from '../ui/animations.js';

/**
 * Render draft cards into the grid
 */
export function renderDraft(draftPicks, round = 'all') {
    const grid = document.querySelector('.draft-grid');
    if (!grid || !draftPicks?.length) return;

    grid.innerHTML = '';

    const filteredPicks = round === 'all'
        ? draftPicks
        : draftPicks.filter(pick => pick.round === parseInt(round));

    filteredPicks.forEach((pick, index) => {
        const posClass = pick.position ? pick.position.toLowerCase() : '';
        const delay = (index % 8) * 50;

        const card = document.createElement('div');
        card.className = 'draft-card animate-on-scroll';
        card.dataset.delay = delay;
        card.dataset.round = pick.round;

        card.innerHTML = `
            <div class="card-glow"></div>
            <div class="pick-number">#${pick.pick}</div>
            <div class="player-position ${posClass}">${pick.position}</div>
            <div class="player-info">
                <h3 class="player-name">${pick.playerName}</h3>
                <p class="player-team">${pick.nflTeam}</p>
                <p class="team-drafted">→ ${pick.fantasyTeam}</p>
            </div>
        `;

        grid.appendChild(card);
    });

    initScrollAnimations();
}

/**
 * Initialize round selector buttons (wires up click handlers)
 */
export function initRoundSelector(draftPicks) {
    const roundBtns = document.querySelectorAll('.round-btn');
    if (!roundBtns.length) return;

    roundBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            roundBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            if (draftPicks) {
                renderDraft(draftPicks, btn.dataset.round);
            }
        });
    });
}
