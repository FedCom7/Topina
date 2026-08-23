/**
 * Core della ricerca "Players" — indice giocatori (storico Topina, da
 * careers.js::buildCareers) + lookup statico delle 32 squadre NFL, con
 * rendering delle righe risultato. Condiviso tra la sezione Players
 * (sections/players-search.js) e la lente di ricerca nella navbar mobile
 * (ui/navbar.js), così esiste una sola fonte di verità.
 */

import { buildCareers } from './careers.js?v=589';
import { NFL_TEAMS } from './nfl-teams.js?v=508';
import { normName } from './projections.js?v=591';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const teamLogoUrl = (abbr) => `https://a.espncdn.com/i/teamlogos/nfl/500/${(abbr || '').toLowerCase()}.png`;

let playerIndex = null;

/** Un'entry per giocatore mai apparso in un roster Topina: nome, ruolo, un anno valido per la scheda completa. */
export async function buildPlayerIndex() {
    if (playerIndex) return playerIndex;
    const careers = await buildCareers();
    playerIndex = [...careers.values()].map(c => {
        const lastDraft = c.draftedBy?.length ? c.draftedBy[c.draftedBy.length - 1] : null;
        return {
            name: c.name,
            pos: c.position || '',
            nflTeam: c.nflTeam || '',
            year: lastDraft?.year || c.lastSeason,
            seasonsCount: c.seasons.size,
        };
    });
    return playerIndex;
}

export function teamResults(query) {
    const q = query.toLowerCase();
    return Object.entries(NFL_TEAMS)
        .filter(([abbr, t]) => t.name.toLowerCase().includes(q) || abbr.toLowerCase().includes(q))
        .slice(0, 8)
        .map(([abbr, t]) => ({ type: 'team', abbr, name: t.name, sub: `${t.conf} · ${t.division}` }));
}

export function playerResults(query, index) {
    const q = normName(query);
    if (!q) return [];
    return index
        .filter(p => normName(p.name).includes(q))
        .sort((a, b) => b.seasonsCount - a.seasonsCount)
        .slice(0, 20)
        .map(p => ({
            type: 'player', name: p.name, pos: p.pos, year: p.year,
            sub: `${p.seasonsCount} Topina season${p.seasonsCount === 1 ? '' : 's'}${p.nflTeam ? ` · ${esc(p.nflTeam)}` : ''}`,
        }));
}

export function resultRow(r) {
    if (r.type === 'team') {
        return `
        <a class="ps-row" href="#nfl-team/${r.abbr}">
            <img class="ps-row-logo" src="${teamLogoUrl(r.abbr)}" alt="" onerror="this.style.display='none'">
            <span class="ps-row-name">${esc(r.name)}</span>
            <span class="ps-row-sub">${esc(r.sub)}</span>
            <span class="ps-row-badge">NFL Team</span>
        </a>`;
    }
    return `
    <a class="ps-row" href="#player/${r.year}/${encodeURIComponent(r.pos)}/${encodeURIComponent(r.name)}">
        <span class="pp-lb-pos">${esc(r.pos || '—')}</span>
        <span class="ps-row-name">${esc(r.name)}</span>
        <span class="ps-row-sub">${r.sub}</span>
        <span class="ps-row-badge ps-row-badge--player">Player</span>
    </a>`;
}
