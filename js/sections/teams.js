/**
 * Teams Index Section — indice dei franchise
 * Griglia dei 4 team con record all-time e titoli; ogni card porta
 * alla pagina franchise (#team-capi, #team-lasers, …).
 */

import { TEAMS } from './team.js?v=12';
import { getLeagueData } from '../data/league-data.js?v=1';

let loaded = false;

export async function initTeams() {
    if (loaded) return;
    loaded = true;

    const grid = document.getElementById('teams-index');
    if (!grid) return;

    // Render immediato con i dati statici, poi arricchito con i record
    grid.innerHTML = Object.values(TEAMS).map((team, i) => `
        <a href="#team-${team.key}" class="teams-card" style="--team-color:${team.color};--card-i:${i}">
            <img class="teams-card-watermark" src="${team.logo}" alt="" aria-hidden="true"
                 onerror="this.style.display='none'">
            <div class="teams-card-body">
                <img class="teams-card-logo" src="${team.logo}" alt="${team.name}"
                     onerror="this.style.display='none'">
                <div class="teams-card-info">
                    <span class="teams-card-kicker">Est. 2019</span>
                    <h2 class="teams-card-name">${team.name}</h2>
                    <div class="teams-card-stats" data-team="${team.key}"></div>
                </div>
                <span class="teams-card-arrow" aria-hidden="true">&rarr;</span>
            </div>
        </a>
    `).join('');

    try {
        const league = await getLeagueData();
        Object.values(TEAMS).forEach(team => {
            const at = league.allTime[team.key];
            const el = grid.querySelector(`.teams-card-stats[data-team="${team.key}"]`);
            if (!at || !el) return;
            const winPct = at.games ? (at.w / at.games * 100).toFixed(1) : '0.0';
            const titles = at.sbWins.length;
            el.innerHTML = `
                <span class="teams-card-stat"><strong>${at.w}–${at.l}${at.t ? `–${at.t}` : ''}</strong> Record</span>
                <span class="teams-card-stat"><strong>${winPct}%</strong> Win</span>
                <span class="teams-card-stat"><strong>${titles}</strong> ${titles === 1 ? 'Titolo' : 'Titoli'}</span>
            `;
        });
    } catch (e) {
        console.error('Teams index load error:', e);
    }
}
