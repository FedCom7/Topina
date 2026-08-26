/**
 * Teams Index Section — indice dei franchise
 * Griglia dei 4 team con record all-time e titoli; ogni card porta
 * alla pagina franchise (#team-capi, #team-lasers, …).
 * teamsCardsHTML è riusata dalla home (mosaico) per card identiche.
 */

import { TEAMS } from './team.js?v=610';
import { getLeagueData } from '../data/league-data.js?v=539';
import { teamNameHTML } from '../data.js?v=540';

let loaded = false;

/** HTML delle 4 card franchise (league può essere null: stats omesse) */
export function teamsCardsHTML(league) {
    return Object.values(TEAMS).map((team, i) => {
        const at = league?.allTime?.[team.key];
        let stats = '';
        if (at) {
            const winPct = at.games ? (at.w / at.games * 100).toFixed(1) : '0.0';
            const titles = at.sbWins.length;
            stats = `
                <span class="teams-card-stat"><strong>${at.w}–${at.l}${at.t ? `–${at.t}` : ''}</strong> Record</span>
                <span class="teams-card-stat"><strong>${winPct}%</strong> Win</span>
                <span class="teams-card-stat"><strong>${titles}</strong> ${titles === 1 ? 'Titolo' : 'Titoli'}</span>`;
        }
        return `
        <a href="#team-${team.key}" class="teams-card" style="--team-color:${team.color};--card-i:${i}">
            <img class="teams-card-watermark" src="${team.logo}" alt="" aria-hidden="true"
                 onerror="this.style.display='none'">
            <div class="teams-card-body">
                <div class="teams-card-info">
                    <span class="teams-card-kicker">Est. 2019</span>
                    <h2 class="teams-card-name">${teamNameHTML(team.name)}</h2>
                    <div class="teams-card-stats">${stats}</div>
                </div>
                <span class="teams-card-arrow" aria-hidden="true">&rarr;</span>
            </div>
        </a>`;
    }).join('');
}

export async function initTeams() {
    if (loaded) return;
    loaded = true;

    const grid = document.getElementById('teams-index');
    if (!grid) return;

    // Render immediato senza stats, poi arricchito coi record
    grid.innerHTML = teamsCardsHTML(null);
    try {
        const league = await getLeagueData();
        grid.innerHTML = teamsCardsHTML(league);
    } catch (e) {
        console.error('Teams index load error:', e);
    }
}
