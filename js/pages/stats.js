/**
 * Stats Page Renderer
 * Renders all-time stats cards and records on both home and stats pages.
 */
import { formatNumber, initScrollAnimations, initCounterAnimations } from '../ui/animations.js';

/**
 * Render quick stats on the home page
 */
export function renderHomeStats(stats) {
    const container = document.getElementById('home-stats');
    if (!container || !stats) return;

    const animateValue = (obj, start, end, duration) => {
        let startTimestamp = null;
        const step = (timestamp) => {
            if (!startTimestamp) startTimestamp = timestamp;
            const progress = Math.min((timestamp - startTimestamp) / duration, 1);
            obj.innerHTML = Math.floor(progress * (end - start) + start);
            if (progress < 1) requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
    };

    const statItems = container.querySelectorAll('.home-stat');
    if (statItems.length >= 3) {
        const seasonEl = statItems[1]?.querySelector('.stat-number');
        if (seasonEl) animateValue(seasonEl, 0, stats.seasons_count || 5, 2000);

        const gamesEl = statItems[2]?.querySelector('.stat-number');
        if (gamesEl) animateValue(gamesEl, 0, stats.total_games || 0, 2000);
    }
}

/**
 * Render the full Stats page with stat cards and record cards
 */
export function renderStatsPage(stats) {
    const statsGrid = document.querySelector('.stats-grid');
    const recordsGrid = document.querySelector('.records-grid');
    if (!statsGrid || !recordsGrid) return;

    const statCard = (icon, value, name, delay) => `
        <div class="stat-card animate-on-scroll" data-delay="${delay}">
            <div class="stat-icon">${icon}</div>
            <div class="stat-value">${value}</div>
            <div class="stat-name">${name}</div>
        </div>
    `;

    let statsHtml = statCard('🏆', '5', 'Championships', '0');
    if (stats.total_points) statsHtml += statCard('📊', formatNumber(stats.total_points), 'Total Points Scored', '100');
    if (stats.highest_score) statsHtml += statCard('🎯', stats.highest_score.value, 'Highest Weekly Score', '200');
    if (stats.total_points && stats.total_games) {
        statsHtml += statCard('📈', (stats.total_points / stats.total_games).toFixed(1), 'Avg Points/Game', '300');
    }
    statsGrid.innerHTML = statsHtml;

    const recordCard = (icon, type, value, holder, date, delay) => `
        <div class="record-card animate-on-scroll" data-delay="${delay}">
            <div class="record-header">
                <span class="record-icon">${icon}</span>
                <span class="record-type">${type}</span>
            </div>
            <div class="record-value">${value}</div>
            <div class="record-holder">${holder}</div>
            <div class="record-date">${date}</div>
        </div>
    `;

    let recordsHtml = '';
    if (stats.highest_score) recordsHtml += recordCard('⬆️', 'Highest Score', stats.highest_score.value, stats.highest_score.team, `Week ${stats.highest_score.week}, ${stats.highest_score.season}`, '0');
    if (stats.lowest_score) recordsHtml += recordCard('⬇️', 'Lowest Score', stats.lowest_score.value, stats.lowest_score.team, `Week ${stats.lowest_score.week}, ${stats.lowest_score.season}`, '100');
    if (stats.longest_win_streak) recordsHtml += recordCard('🔥', 'Win Streak', stats.longest_win_streak.value, stats.longest_win_streak.team, `${stats.longest_win_streak.season} Season`, '200');
    if (stats.longest_loss_streak) recordsHtml += recordCard('💀', 'Loss Streak', stats.longest_loss_streak.value, stats.longest_loss_streak.team, `${stats.longest_loss_streak.season} Season`, '300');
    if (stats.most_points_season) recordsHtml += recordCard('📅', 'Season Points', formatNumber(stats.most_points_season.value), stats.most_points_season.team, `${stats.most_points_season.season} Season`, '400');
    if (stats.largest_margin) recordsHtml += recordCard('⚔️', 'Largest Margin', stats.largest_margin.value, `${stats.largest_margin.winner} def. ${stats.largest_margin.loser}`, `Week ${stats.largest_margin.week}, ${stats.largest_margin.season}`, '500');

    recordsGrid.innerHTML = recordsHtml;

    initCounterAnimations();
    initScrollAnimations();
}
