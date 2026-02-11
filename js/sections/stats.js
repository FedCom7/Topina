/**
 * Stats Section
 * All-time league records as stat cards
 */
import { fetchAllTimeStats, displayName } from '../data.js';

let loaded = false;

export async function initStats() {
    if (loaded) return;
    loaded = true;

    const grid = document.getElementById('stats-grid');
    const stats = await fetchAllTimeStats();

    if (!stats) {
        grid.innerHTML = `<div class="empty-state"><div class="empty-state-icon">📊</div><p class="empty-state-text">Statistiche non disponibili</p></div>`;
        return;
    }

    const cards = [];

    if (stats.seasons_count) {
        cards.push(card('🏆', stats.seasons_count, 'Stagioni Giocate', '', 0));
    }
    if (stats.total_games) {
        cards.push(card('🏈', stats.total_games.toLocaleString(), 'Partite Totali', '', 80));
    }
    if (stats.total_points) {
        cards.push(card('📊', stats.total_points.toLocaleString(), 'Punti Totali', '', 160));
    }
    if (stats.highest_score) {
        const h = stats.highest_score;
        cards.push(card('⬆️', h.value, 'Highest Score', `${displayName(h.team)} — Week ${h.week}, ${h.season}`, 240));
    }
    if (stats.lowest_score) {
        const l = stats.lowest_score;
        cards.push(card('⬇️', l.value, 'Lowest Score', `${displayName(l.team)} — Week ${l.week}, ${l.season}`, 320));
    }
    if (stats.largest_margin) {
        const m = stats.largest_margin;
        cards.push(card('⚔️', m.value + ' pts', 'Largest Margin', `${displayName(m.winner)} def. ${displayName(m.loser)} — Week ${m.week}, ${m.season}`, 400));
    }
    if (stats.most_points_season) {
        const p = stats.most_points_season;
        cards.push(card('📅', p.value.toLocaleString(), 'Most Points (Season)', `${displayName(p.team)} — ${p.season}`, 480));
    }
    if (stats.total_points && stats.total_games) {
        const avg = (stats.total_points / stats.total_games).toFixed(1);
        cards.push(card('📈', avg, 'Media Punti/Partita', '', 560));
    }

    grid.innerHTML = cards.join('');
}

function card(icon, value, label, detail, delay) {
    return `
    <div class="stat-card" style="animation-delay:${delay}ms">
        <div class="stat-card-icon">${icon}</div>
        <div class="stat-card-value">${value}</div>
        <div class="stat-card-label">${label}</div>
        ${detail ? `<div class="stat-card-detail">${detail}</div>` : ''}
    </div>`;
}
