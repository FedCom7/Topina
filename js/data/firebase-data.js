/**
 * Firebase Data Layer
 * All fetch and data-processing functions for Firebase RTDB.
 */
import { db } from '../firebase-config.js';
import { ref, child, get } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-database.js';
import { CURRENT_SEASON } from './team-config.js';

/**
 * Fetch draft data from Realtime Database
 */
export async function fetchDraftData(season = CURRENT_SEASON) {
    try {
        const dbRef = ref(db);
        const snapshot = await get(child(dbRef, `draft/draft_data_${season}`));
        return snapshot.exists() ? snapshot.val() : null;
    } catch (error) {
        console.error('Error getting draft data:', error);
        return null;
    }
}

/**
 * Fetch fantasy data from Realtime Database
 */
export async function fetchFantasyData(season = CURRENT_SEASON) {
    try {
        const dbRef = ref(db);
        const snapshot = await get(child(dbRef, `fantasy/fantasy_data_${season}`));
        return snapshot.exists() ? snapshot.val() : null;
    } catch (error) {
        console.error('Error fetching fantasy data:', error);
        return null;
    }
}

/**
 * Fetch all-time stats from Realtime Database
 */
export async function fetchAllTimeStats() {
    try {
        const dbRef = ref(db);
        const snapshot = await get(child(dbRef, 'stats/all_time'));
        return snapshot.exists() ? snapshot.val() : null;
    } catch (error) {
        console.error('Error getting stats data:', error);
        return null;
    }
}

/**
 * Fetch Super Bowl (Week 17) matchup
 */
export async function fetchSuperBowlMatchup(season) {
    try {
        const fantasyData = await fetchFantasyData(season);
        if (!fantasyData?.weeks) return null;

        const week17 = fantasyData.weeks['17'];
        if (!week17?.matchups?.length) return null;

        return week17.matchups[0];
    } catch (error) {
        console.error('Error fetching Super Bowl matchup:', error);
        return null;
    }
}

/**
 * Convert structured draft data into a flat, sorted array for the grid
 */
export function flattenDraftData(draftData) {
    if (!draftData?.teams) return [];

    const flatPicks = [];
    const leagueSize = Object.keys(draftData.teams).length || 4;

    Object.entries(draftData.teams).forEach(([fantasyTeam, picks]) => {
        picks.forEach(pick => {
            flatPicks.push({
                pick: pick.pick,
                round: Math.ceil(pick.pick / leagueSize),
                playerName: pick.name,
                position: pick.position,
                nflTeam: pick.nfl_team,
                fantasyTeam
            });
        });
    });

    return flatPicks.sort((a, b) => a.pick - b.pick);
}

/**
 * Process fantasy data to calculate standings
 */
export function processFantasyData(fantasyData) {
    if (!fantasyData?.weeks) return [];

    const teams = {};

    const initTeam = (name) => {
        if (!teams[name]) {
            teams[name] = {
                teamName: name,
                wins: 0, losses: 0, ties: 0,
                pointsFor: 0, pointsAgainst: 0,
                streak: []
            };
        }
    };

    Object.values(fantasyData.weeks).forEach(week => {
        if (!week.matchups) return;

        week.matchups.forEach(matchup => {
            if (!matchup.team1 || !matchup.team2) return;

            const t1 = matchup.team1;
            const t2 = matchup.team2;
            initTeam(t1.name);
            initTeam(t2.name);

            const s1 = parseFloat(t1.score);
            const s2 = parseFloat(t2.score);

            teams[t1.name].pointsFor += s1;
            teams[t1.name].pointsAgainst += s2;
            teams[t2.name].pointsFor += s2;
            teams[t2.name].pointsAgainst += s1;

            if (s1 > s2) {
                teams[t1.name].wins++;
                teams[t2.name].losses++;
                teams[t1.name].streak.push('W');
                teams[t2.name].streak.push('L');
            } else if (s2 > s1) {
                teams[t2.name].wins++;
                teams[t1.name].losses++;
                teams[t2.name].streak.push('W');
                teams[t1.name].streak.push('L');
            } else {
                teams[t1.name].ties++;
                teams[t2.name].ties++;
                teams[t1.name].streak.push('T');
                teams[t2.name].streak.push('T');
            }
        });
    });

    const standings = Object.values(teams).map(team => {
        let currentStreak = '-';
        if (team.streak.length > 0) {
            let count = 0;
            const type = team.streak[team.streak.length - 1];
            for (let i = team.streak.length - 1; i >= 0; i--) {
                if (team.streak[i] === type) count++;
                else break;
            }
            currentStreak = `${type}${count}`;
        }

        return {
            ...team,
            streak: currentStreak,
            pointsFor: parseFloat(team.pointsFor.toFixed(2)),
            pointsAgainst: parseFloat(team.pointsAgainst.toFixed(2))
        };
    });

    return standings.sort((a, b) => {
        if (b.wins !== a.wins) return b.wins - a.wins;
        return b.pointsFor - a.pointsFor;
    });
}
