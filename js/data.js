/**
 * Topina League — Data Layer
 * All Firebase RTDB fetching and processing.
 */
import { db } from './firebase-config.js?v=2';
import { ref, child, get } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-database.js';

/**
 * Stagioni disponibili — lette da Firebase all'avvio, non più scritte a mano.
 *
 * Lo script che carica i dati crea nodi `fantasy/fantasy_data_YYYY`: qui si
 * chiede solo l'ELENCO delle chiavi (`?shallow=true`, poche centinaia di byte,
 * non i ~750 KB di una stagione), così appena una nuova stagione viene
 * caricata il sito la mostra senza toccare il codice.
 *
 * È un top-level await: data.js è importato da tutti gli altri moduli, quindi
 * quando loro partono SEASONS e CURRENT_SEASON hanno già il valore giusto
 * (diversi moduli li copiano in variabili al primo caricamento).
 */
const RTDB_URL = 'https://topina-9cd75-default-rtdb.firebaseio.com';
const FALLBACK_SEASONS = ['2019', '2020', '2021', '2022', '2023', '2024', '2025'];

async function discoverSeasons() {
    try {
        const timeout = new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Request timed out')), 6000));
        const res = await Promise.race([fetch(`${RTDB_URL}/fantasy.json?shallow=true`), timeout]);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const years = Object.keys(await res.json() || {})
            .map(k => k.match(/^fantasy_data_(\d{4})$/)?.[1])
            .filter(Boolean)
            .sort();
        return years.length ? years : FALLBACK_SEASONS;
    } catch (e) {
        // Rete/regole KO: si continua con l'elenco statico invece di lasciare il sito vuoto.
        console.warn('[data] elenco stagioni non recuperabile, uso la lista statica:', e.message);
        return FALLBACK_SEASONS;
    }
}

export const SEASONS = await discoverSeasons();
export const CURRENT_SEASON = SEASONS[SEASONS.length - 1];

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

// Abbreviazioni ufficiali — usate come fallback quando il nome non entra.
export const TEAM_ABBR = {
    'Capi dei Pianeti': 'CDP',
    'Lasers': 'LAS',
    'Oscurus': 'OSC',
    'Sommo': 'SOM',
};

export function teamAbbr(raw) {
    const dn = displayName(raw);
    return TEAM_ABBR[dn] || dn;
}

/**
 * Markup del nome squadra che si auto-abbrevia quando non entra nello spazio.
 * Renderizza il nome completo; `refitTeamNames()` (js/utils/team-abbr.js),
 * invocato dal router a ogni render e sul resize, lo sostituisce con la sigla
 * solo se non ci sta. `cls` aggiunge classi extra allo span.
 */
export function teamNameHTML(raw, cls = '') {
    const dn = displayName(raw);
    const ab = TEAM_ABBR[dn];
    const extra = cls ? ` ${cls}` : '';
    if (!ab) return `<span class="tname${extra}">${dn}</span>`;
    return `<span class="tname${extra}" data-abbr="${ab}">${dn}</span>`;
}

// ─── Fetch functions ───

export async function fetchFantasyData(season) {
    try {
        const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('Request timed out')), 10000));
        const dbRef = ref(db);
        const fetchPromise = get(child(dbRef, `fantasy/fantasy_data_${season}`));
        const snap = await Promise.race([fetchPromise, timeout]);
        return snap.exists() ? snap.val() : null;
    } catch (e) {
        console.error(`fetchFantasyData error for ${season}:`, e);
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
    console.log('fetchAllSeasonsData starting...');
    const promises = SEASONS.map(async season => {
        console.log(`Fetching fantasy data for ${season}...`);
        const data = await fetchFantasyData(season);
        console.log(`Fetched fantasy data for ${season}:`, data ? 'OK' : 'NULL');
        return data;
    });
    const results = await Promise.all(promises);
    console.log('fetchAllSeasonsData finished');

    const data = {};
    SEASONS.forEach((season, index) => {
        if (results[index]) {
            data[season] = results[index];
        }
    });
    return data;
}

// ─── Processing functions ───

// ─── Processing functions ───

export function getSeasonConfig(year) {
    // 2021 had 18 weeks (17 regular + 1 playoff + 1 superfine/SB?)
    // Actually user said: "2021 ci sono 18 giornate quindi playoffs e supoerbowl devono essere la week 17 e 18"
    // So:
    // 2021: Total 18. Playoffs = 17, SB = 18. Regular = 16.

    // Standard (2019, 2020, 2022+ ?)
    // Previous constants: PLAYOFF = 16, SB = 17, Regular = 15.

    if (String(year) === '2021') {
        return {
            regularSeasonWeeks: 16,
            playoffWeek: 17,
            superBowlWeek: 18
        };
    }

    // Default / Standard
    return {
        regularSeasonWeeks: 15,
        playoffWeek: 16,
        superBowlWeek: 17
    };
}

/**
 * Process fantasy data into standings array sorted by wins then PF.
 * Only counts regular-season weeks. Playoffs & SB are excluded.
 */
export function processStandings(fantasyData, year) {
    if (!fantasyData?.weeks) return [];

    const config = getSeasonConfig(year);
    const teams = {};
    const init = (n) => {
        if (!teams[n]) teams[n] = { name: n, w: 0, l: 0, pf: 0, pa: 0, streak: [] };
    };

    // Only iterate regular-season weeks
    for (let w = 1; w <= config.regularSeasonWeeks; w++) {
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
 * Get the Super Bowl matchup.
 */
export function getSuperBowlMatchup(fantasyData, year) {
    if (!fantasyData?.weeks) return null;

    const config = getSeasonConfig(year);

    // 1. Find the two winners of playoffs week
    const poWeek = fantasyData.weeks[String(config.playoffWeek)];
    if (!poWeek?.matchups?.length) return null;

    const playoffWinners = new Set();
    poWeek.matchups.forEach(m => {
        if (!m.team1 || !m.team2) return;
        const s1 = parseFloat(m.team1.score);
        const s2 = parseFloat(m.team2.score);
        playoffWinners.add(s1 >= s2 ? m.team1.name : m.team2.name);
    });

    // 2. In SB week, find the matchup between the two playoff winners
    const sbWeek = fantasyData.weeks[String(config.superBowlWeek)];
    if (!sbWeek?.matchups?.length) return null;

    const sbMatchup = sbWeek.matchups.find(m =>
        m.team1 && m.team2 &&
        playoffWinners.has(m.team1.name) && playoffWinners.has(m.team2.name)
    );

    return sbMatchup || sbWeek.matchups[0]; // fallback to first if not found
}

/**
 * Get the Playoff matchups
 */
export function getPlayoffMatchups(fantasyData, year) {
    if (!fantasyData?.weeks) return null;
    const config = getSeasonConfig(year);
    const poWeek = fantasyData.weeks[String(config.playoffWeek)];
    if (!poWeek?.matchups) return null;
    return poWeek.matchups;
}
