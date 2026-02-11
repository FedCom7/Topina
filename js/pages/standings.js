/**
 * Standings Page Renderer
 * Renders the standings table from processed fantasy data.
 */
import { formatNumber, initTableAnimations } from '../ui/animations.js';

export function renderStandings(standings) {
    const tbody = document.querySelector('.standings-table tbody');
    if (!tbody || !standings?.length) return;

    tbody.innerHTML = '';

    standings.forEach((team, index) => {
        const rank = index + 1;
        const rankClass = rank === 1 ? 'gold' : rank === 2 ? 'silver' : rank === 3 ? 'bronze' : '';
        const streakClass = team.streak.startsWith('W') ? 'win' : 'loss';

        const row = document.createElement('tr');
        row.className = 'table-row';
        row.dataset.rank = rank;

        row.innerHTML = `
            <td><span class="rank ${rankClass}">${rank}</span></td>
            <td class="team-name">
                <span class="team-logo">🏈</span>
                <span>${team.teamName}</span>
            </td>
            <td>${team.wins}</td>
            <td>${team.losses}</td>
            <td>${formatNumber(team.pointsFor)}</td>
            <td>${formatNumber(team.pointsAgainst)}</td>
            <td><span class="streak ${streakClass}">${team.streak}</span></td>
        `;

        tbody.appendChild(row);
    });

    initTableAnimations();
}

/**
 * Update page subtitle with scraped-at date
 */
export function updateWeekInfo(data) {
    const subtitle = document.querySelector('.page-subtitle');
    if (subtitle && data?.scraped_at) {
        const formattedDate = new Date(data.scraped_at).toLocaleDateString('it-IT', {
            day: 'numeric', month: 'short', year: 'numeric'
        });
        subtitle.textContent = `Aggiornato: ${formattedDate}`;
    }
}
