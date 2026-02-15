/**
 * Standings Section
 * Year selector → full standings table
 */
import { fetchFantasyData, processStandings, displayName, SEASONS, CURRENT_SEASON } from '../data.js?v=5';

let loaded = false;

export async function initStandings() {
    if (loaded) return;
    loaded = true;
    renderYearSelector();
    await loadYear(CURRENT_SEASON);
}

function renderYearSelector() {
    const container = document.getElementById('st-year-selector');
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
    const wrap = document.getElementById('standings-table-wrap');
    wrap.innerHTML = `<div class="loading-state"><div class="spinner"></div><p>Caricamento ${year}...</p></div>`;

    const data = await fetchFantasyData(year);
    if (!data) {
        wrap.innerHTML = `<div class="empty-state"><div class="empty-state-icon">📭</div><p class="empty-state-text">Nessun dato per il ${year}</p></div>`;
        return;
    }

    const standings = processStandings(data, year);
    if (!standings.length) {
        wrap.innerHTML = `<div class="empty-state"><div class="empty-state-icon">📭</div><p class="empty-state-text">Nessun risultato</p></div>`;
        return;
    }

    wrap.innerHTML = `
    <table class="standings-table">
        <thead>
            <tr>
                <th>#</th>
                <th>Team</th>
                <th>W</th>
                <th>L</th>
                <th>PF</th>
                <th>PA</th>
                <th>Streak</th>
            </tr>
        </thead>
        <tbody>
            ${standings.map((t, i) => {
        const rank = i + 1;
        const rankClass = rank <= 3 ? ` rank-${rank}` : '';
        const streakType = t.streak.startsWith('W') ? 'w' : t.streak.startsWith('L') ? 'l' : 't';
        return `
                <tr class="standings-row" style="animation-delay:${i * 60}ms">
                    <td><span class="rank-badge${rankClass}">${rank}</span></td>
                    <td class="team-name-cell">${displayName(t.name)}</td>
                    <td class="stat-cell">${t.w}</td>
                    <td class="stat-cell">${t.l}</td>
                    <td class="stat-cell">${t.pf.toLocaleString()}</td>
                    <td class="stat-cell">${t.pa.toLocaleString()}</td>
                    <td><span class="streak-badge streak-${streakType}">${t.streak}</span></td>
                </tr>`;
    }).join('')}
        </tbody>
    </table>`;
}
