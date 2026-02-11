/**
 * History Section
 * Per-year recap built entirely from Firebase data:
 *  - Regular season standings
 *  - Super Bowl final (last week matchup)
 *  - Champion
 */
import { fetchFantasyData, processStandings, getSuperBowlMatchup, displayName, SEASONS } from '../data.js';

let loaded = false;

export async function initHistory() {
    if (loaded) return;
    loaded = true;

    const container = document.getElementById('history-timeline');
    container.innerHTML = `<div class="loading-state"><div class="spinner"></div><p>Caricamento storico...</p></div>`;

    // Load all seasons in parallel
    const results = await Promise.all(
        SEASONS.map(async (year) => {
            const data = await fetchFantasyData(year);
            if (!data) return null;
            const standings = processStandings(data);
            const sbMatchup = getSuperBowlMatchup(data);
            return { year, standings, sbMatchup };
        })
    );

    // Filter out empty results and render newest first
    const seasons = results.filter(Boolean).reverse();

    if (!seasons.length) {
        container.innerHTML = `<div class="empty-state"><div class="empty-state-icon">📜</div><p class="empty-state-text">Nessun dato storico disponibile</p></div>`;
        return;
    }

    container.innerHTML = seasons.map((s, i) => renderSeasonCard(s, i)).join('');
}

function renderSeasonCard({ year, standings, sbMatchup }, index) {
    // Determine champion from SB matchup
    let champion = null;
    let sbHtml = '';

    if (sbMatchup) {
        const s1 = parseFloat(sbMatchup.team1.score);
        const s2 = parseFloat(sbMatchup.team2.score);
        const winner = s1 >= s2 ? sbMatchup.team1 : sbMatchup.team2;
        const loser = s1 >= s2 ? sbMatchup.team2 : sbMatchup.team1;
        const ws = s1 >= s2 ? s1 : s2;
        const ls = s1 >= s2 ? s2 : s1;
        champion = winner.name;

        sbHtml = `
        <div class="history-sub-title">🏆 Super Bowl Final</div>
        <div class="history-final">
            <div class="final-team winner">
                <div class="final-team-name">${displayName(winner.name)}</div>
                <div class="final-team-score">${ws.toFixed(2)}</div>
            </div>
            <span class="final-vs">VS</span>
            <div class="final-team loser">
                <div class="final-team-name">${displayName(loser.name)}</div>
                <div class="final-team-score">${ls.toFixed(2)}</div>
            </div>
        </div>`;
    }

    // Regular season mini-standings
    const standingsHtml = standings.length ? `
        <div class="history-sub-title">📊 Regular Season</div>
        <div class="history-mini-standings">
            ${standings.map((t, i) => `
                <div class="history-mini-row${t.name === champion ? ' champion' : ''}">
                    <span class="mini-rank">${i + 1}</span>
                    <span class="mini-team">${displayName(t.name)}</span>
                    <span class="mini-record">${t.w}-${t.l}</span>
                    <span class="mini-pts">${t.pf.toLocaleString()} PF</span>
                </div>
            `).join('')}
        </div>
    ` : '';

    return `
    <div class="history-season-card" style="animation-delay:${index * 100}ms">
        <div class="history-year-header">
            <span class="history-year-badge">${year}</span>
            ${champion ? `<span class="history-champion"><span class="trophy">🏆</span> ${displayName(champion)}</span>` : ''}
        </div>
        <div class="history-body">
            ${standingsHtml}
            ${sbHtml}
        </div>
    </div>`;
}
