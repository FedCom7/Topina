/**
 * Home Section — Fetches and displays the reigning champion
 */
import { fetchFantasyData, getSuperBowlMatchup, displayName, SEASONS } from '../data.js?v=5';

let homeInitialized = false;

export async function initHome() {
    if (homeInitialized) return;
    homeInitialized = true;

    // Find the most recent completed season with a Super Bowl winner
    // Iterate from newest to oldest
    const reversedSeasons = [...SEASONS].reverse();

    for (const year of reversedSeasons) {
        try {
            const data = await fetchFantasyData(year);
            if (!data) continue;

            const sbMatchup = getSuperBowlMatchup(data, year);
            if (!sbMatchup) continue;

            const s1 = parseFloat(sbMatchup.team1.score);
            const s2 = parseFloat(sbMatchup.team2.score);

            // If both scores are 0, season hasn't been played yet
            if (s1 === 0 && s2 === 0) continue;

            const winner = s1 >= s2 ? sbMatchup.team1 : sbMatchup.team2;
            const championName = displayName(winner.name);

            // Update the champion card
            const nameEl = document.getElementById('champion-name');
            const seasonEl = document.getElementById('champion-season');
            if (nameEl) nameEl.textContent = championName;
            if (seasonEl) seasonEl.textContent = `Stagione ${year}`;

            break; // Found the most recent champion, stop
        } catch (e) {
            console.warn(`Error fetching season ${year}:`, e);
        }
    }
}
