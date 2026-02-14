/**
 * Topina League — Data Layer
 * All Firebase RTDB fetching and processing.
 */
import { db } from './firebase-config.js';
import { ref, child, get } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-database.js';

// Available seasons in the database
export const SEASONS = ['2019', '2020', '2021', '2022', '2023', '2024', '2025'];
export const CURRENT_SEASON = '2025';

// Team display-name mapping (Firebase name → display name)
const TEAM_DISPLAY_NAMES = {
    'riccardo97com': 'Oscurus',
    'lasers': 'Lasers',
    'FedCom': 'Sommo',
    'Capi dei Pianeti': 'Capi dei Pianeti'
};

export function displayName(raw) {
    return TEAM_DISPLAY_NAMES[raw] || raw;
}

// ─── Fetch functions ───

export async function fetchFantasyData(season) {
    try {
        const snap = await get(child(ref(db), `fantasy/fantasy_data_${season}`));
        return snap.exists() ? snap.val() : null;
    } catch (e) {
        console.error('fetchFantasyData error:', e);
        return null;
    }
}

export async function fetchDraftData(season) {
    try {
        const snap = await get(child(ref(db), `draft/draft_data_${season}`));
        return snap.exists() ? snap.val() : null;
    } catch (e) {
        console.error('fetchDraftData error:', e);
        return null;
    }
}

export async function fetchAllTimeStats() {
    try {
        const snap = await get(child(ref(db), 'stats/all_time'));
        return snap.exists() ? snap.val() : null;
    } catch (e) {
        console.error('fetchAllTimeStats error:', e);
        return null;
    }
}

export async function fetchAllSeasonsData() {
    const promises = SEASONS.map(season => fetchFantasyData(season));
    const results = await Promise.all(promises);

    const data = {};
    SEASONS.forEach((season, index) => {
        if (results[index]) {
            data[season] = results[index];
        }
    });
    return data;
}

// ─── Processing functions ───

// Week 16 = Playoffs, Week 17 = Super Bowl
export const PLAYOFF_WEEK = 16;
export const SUPERBOWL_WEEK = 17;
export const REGULAR_SEASON_WEEKS = 15; // weeks 1–15

/**
 * Process fantasy data into standings array sorted by wins then PF.
 * Only counts regular-season weeks (1–15). Playoffs & SB are excluded.
 */
export function processStandings(fantasyData) {
    if (!fantasyData?.weeks) return [];

    const teams = {};
    const init = (n) => {
        if (!teams[n]) teams[n] = { name: n, w: 0, l: 0, pf: 0, pa: 0, streak: [] };
    };

    // Only iterate regular-season weeks (1 .. REGULAR_SEASON_WEEKS)
    for (let w = 1; w <= REGULAR_SEASON_WEEKS; w++) {
        const week = fantasyData.weeks[String(w)];
        if (!week?.matchups) continue;
        week.matchups.forEach(m => {
            if (!m.team1 || !m.team2) return;
            init(m.team1.name);
            init(m.team2.name);
            const s1 = parseFloat(m.team1.score);
            const s2 = parseFloat(m.team2.score);
            teams[m.team1.name].pf += s1;
            teams[m.team1.name].pa += s2;
            teams[m.team2.name].pf += s2;
            teams[m.team2.name].pa += s1;
            if (s1 > s2) {
                teams[m.team1.name].w++;
                teams[m.team2.name].l++;
                teams[m.team1.name].streak.push('W');
                teams[m.team2.name].streak.push('L');
            } else if (s2 > s1) {
                teams[m.team2.name].w++;
                teams[m.team1.name].l++;
                teams[m.team2.name].streak.push('W');
                teams[m.team1.name].streak.push('L');
            } else {
                teams[m.team1.name].streak.push('T');
                teams[m.team2.name].streak.push('T');
            }
        });
    }

    return Object.values(teams).map(t => {
        let streak = '-';
        if (t.streak.length) {
            const last = t.streak[t.streak.length - 1];
            let c = 0;
            for (let i = t.streak.length - 1; i >= 0; i--) { if (t.streak[i] === last) c++; else break; }
            streak = `${last}${c}`;
        }
        return { ...t, pf: +t.pf.toFixed(2), pa: +t.pa.toFixed(2), streak };
    }).sort((a, b) => b.w !== a.w ? b.w - a.w : b.pf - a.pf);
}

/**
 * Flatten draft data into sorted pick array
 */
export function flattenDraft(draftData) {
    if (!draftData?.teams) return [];
    const picks = [];
    const size = Object.keys(draftData.teams).length || 4;
    Object.entries(draftData.teams).forEach(([team, list]) => {
        list.forEach(p => {
            picks.push({
                pick: p.pick,
                round: Math.ceil(p.pick / size),
                player: p.name,
                pos: p.position,
                nfl: p.nfl_team,
                team
            });
        });
    });
    return picks.sort((a, b) => a.pick - b.pick);
}

/**
 * Get max week number from fantasy data
 */
export function getWeekCount(fantasyData) {
    if (!fantasyData?.weeks) return 0;
    return Math.max(...Object.keys(fantasyData.weeks).map(Number));
}

/**
 * Get the Super Bowl matchup (Week 17).
 * Week 17 has two games: the SB final (between week-16 winners) and
 * a consolation game (between week-16 losers). We identify the real
 * SB by finding the matchup whose teams are both week-16 winners.
 */
export function getSuperBowlMatchup(fantasyData) {
    if (!fantasyData?.weeks) return null;

    // 1. Find the two winners of week 16 (playoffs)
    const poWeek = fantasyData.weeks[String(PLAYOFF_WEEK)];
    if (!poWeek?.matchups?.length) return null;

    const playoffWinners = new Set();
    poWeek.matchups.forEach(m => {
        if (!m.team1 || !m.team2) return;
        const s1 = parseFloat(m.team1.score);
        const s2 = parseFloat(m.team2.score);
        playoffWinners.add(s1 >= s2 ? m.team1.name : m.team2.name);
    });

    // 2. In week 17, find the matchup between the two playoff winners
    const sbWeek = fantasyData.weeks[String(SUPERBOWL_WEEK)];
    if (!sbWeek?.matchups?.length) return null;

    const sbMatchup = sbWeek.matchups.find(m =>
        m.team1 && m.team2 &&
        playoffWinners.has(m.team1.name) && playoffWinners.has(m.team2.name)
    );

    return sbMatchup || sbWeek.matchups[0]; // fallback to first if not found
}

/**
 * Get the Playoff matchups (Week 16)
 */
export function getPlayoffMatchups(fantasyData) {
    if (!fantasyData?.weeks) return null;
    const poWeek = fantasyData.weeks[String(PLAYOFF_WEEK)];
    if (!poWeek?.matchups) return null;
    return poWeek.matchups;
}
