/**
 * Badge Engine — sistema di badge stile "adesivi sul casco".
 * Tutti i badge sono calcolati automaticamente dai dati di lega (league-data.js).
 *
 * Categorie:
 *  - evergreen : sempre attivo, si aggiorna da solo (es. anzianità di lega)
 *  - career    : permanente, un'istanza per ogni conquista (con anno)
 *  - exclusive : solo UN team per stagione completata può averlo
 *  - seasonal  : sbloccabile ogni stagione, si resetta l'anno dopo
 */
import { SEASONS } from '../data.js?v=540';
import { TEAM_KEYS } from './team-config.js?v=533';
import { TEAM_KEY_LIST } from './league-data.js?v=539';

// chiave team → nome display
const KEY_NAMES = Object.fromEntries(Object.entries(TEAM_KEYS).map(([name, key]) => [key, name]));
export function keyToName(key) { return KEY_NAMES[key] || key; }

const WIN_MILESTONES = [25, 50, 75, 100];

/**
 * Badge manuali/speciali futuri (premi simpatia, eventi di lega…).
 * Formato: { teamKey, name, description, shape, icon, season, detail }
 */
export const SPECIAL_BADGES = [];

/**
 * Helper per badge esclusivi annuali: per ogni stagione COMPLETATA calcola
 * una metrica per team e premia il migliore.
 * metric(perTeamEntry, season) → { value, tiebreak?, detail } | null
 * Vince il value più alto; a parità, il tiebreak più BASSO.
 */
function seasonExclusive(league, teamKey, metric) {
    const instances = [];
    league.seasons.filter(s => s.complete).forEach(season => {
        let best = null;
        TEAM_KEY_LIST.forEach(key => {
            const entry = season.perTeam[key];
            if (!entry || !entry.games.length) return;
            const m = metric(entry, season);
            if (m == null) return;
            if (!best
                || m.value > best.m.value
                || (m.value === best.m.value && (m.tiebreak ?? 0) < (best.m.tiebreak ?? 0))) {
                best = { key, m };
            }
        });
        if (best && best.key === teamKey) {
            instances.push({ season: season.year, detail: best.m.detail });
        }
    });
    return instances;
}

const fmt = (n) => (+n).toFixed(1).replace(/\.0$/, '');
const ord = (n) => `${n}${n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th'}`;

export const BADGE_DEFS = [
    // ── Evergreen ──────────────────────────────────────────────
    {
        id: 'fondazione', name: 'Founding', category: 'evergreen',
        shape: 'circle', icon: 'laurel',
        description: 'Founding member of the Topina League, since 2019.',
        compute: () => [{ season: null, detail: `EST. 2019 · ${ord(SEASONS.length)} season` }],
    },

    // ── Carriera (permanenti, un tile per istanza) ─────────────
    {
        id: 'sb-title', name: 'World Champion', category: 'career',
        shape: 'banner', icon: 'trophy', tilePerInstance: true,
        description: 'Won the Topina Super Bowl.',
        compute: (L, k) => L.allTime[k].sbWins.map(year => ({ season: year, detail: 'World champion' })),
    },
    {
        id: 'rs-title', name: 'Regular Season Champion', category: 'career',
        shape: 'shield', icon: 'crown', tilePerInstance: true,
        description: 'First place at the end of the regular season.',
        compute: (L, k) => L.allTime[k].rsTitles.map(year => ({ season: year, detail: '1st in regular season' })),
    },
    {
        id: 'sb-appearance', name: 'Super Bowl Appearance', category: 'career',
        shape: 'circle', icon: 'rings', tilePerInstance: true,
        description: 'Played in the Topina Super Bowl.',
        compute: (L, k) => L.allTime[k].sbApps.map(year => ({
            season: year,
            detail: L.allTime[k].sbWins.includes(year) ? 'Won' : 'Runner-up',
        })),
    },
    {
        id: 'wins-club', name: 'Career Wins Club', category: 'career',
        shape: 'hex', icon: 'numeral', tilePerInstance: true,
        description: 'Career win milestones (regular season).',
        compute: (L, k) => {
            const instances = [];
            let cumulative = 0;
            let idx = 0;
            L.seasons.forEach(season => {
                const t = season.perTeam[k];
                if (!t) return;
                cumulative += t.w;
                while (idx < WIN_MILESTONES.length && cumulative >= WIN_MILESTONES[idx]) {
                    instances.push({
                        season: season.year,
                        detail: `${WIN_MILESTONES[idx]} career wins`,
                        iconText: String(WIN_MILESTONES[idx]),
                    });
                    idx++;
                }
            });
            return instances;
        },
    },

    // ── Esclusivi annuali (uno solo per stagione) ──────────────
    {
        id: 'scoring-title', name: 'Scoring Title', category: 'exclusive',
        shape: 'star', icon: 'bolt',
        description: "Most points scored in the league in the regular season.",
        compute: (L, k) => seasonExclusive(L, k, t => ({ value: t.pf, detail: `${fmt(t.pf)} total pt` })),
    },
    {
        id: 'weekly-record', name: 'Weekly Record', category: 'exclusive',
        shape: 'star', icon: 'flame',
        description: 'Highest single-game score of the season.',
        compute: (L, k) => seasonExclusive(L, k, t => t.highGame
            ? { value: t.highGame.pts, detail: `${fmt(t.highGame.pts)} pt — W${t.highGame.week}` }
            : null),
    },
    {
        id: 'streak-king', name: 'Streak King', category: 'exclusive',
        shape: 'star', icon: 'streak',
        description: "Longest winning streak of the season.",
        compute: (L, k) => seasonExclusive(L, k, t => t.bestStreak.len > 1
            ? { value: t.bestStreak.len, tiebreak: t.bestStreak.endWeek, detail: `${t.bestStreak.len} wins in a row` }
            : null),
    },
    {
        id: 'bench-king', name: 'Bench King', category: 'exclusive',
        shape: 'hex', icon: 'couch',
        description: 'Most points left on the bench across the whole season.',
        compute: (L, k) => seasonExclusive(L, k, t => t.benchPts > 0
            ? { value: t.benchPts, detail: `${fmt(t.benchPts)} pt on the bench` }
            : null),
    },
    {
        id: 'hammer', name: 'The Hammer', category: 'exclusive',
        shape: 'hex', icon: 'hammer',
        description: 'Win by the widest margin of the season.',
        compute: (L, k) => seasonExclusive(L, k, t => {
            const wins = t.games.filter(g => g.won);
            if (!wins.length) return null;
            const big = wins.reduce((a, b) => (b.margin > a.margin ? b : a));
            return { value: big.margin, detail: `+${fmt(big.margin)} vs ${keyToName(big.opp)} — W${big.week}` };
        }),
    },

    // ── Stagionali (si resettano ogni anno) ────────────────────
    {
        id: 'sb-run', name: 'Super Bowl Run', category: 'seasonal',
        shape: 'shield', icon: 'football',
        description: 'Won the semifinal, reaching the Super Bowl.',
        compute: (L, k) => L.seasons
            .filter(s => s.complete && s.perTeam[k]?.sbAppearance)
            .map(s => ({ season: s.year, detail: s.perTeam[k].sbWin ? 'Won the final' : 'Reached the final' })),
    },
    {
        id: 'club-150', name: 'Club 150', category: 'seasonal',
        shape: 'hex', icon: 'rocket',
        description: 'At least 150 points in a regular season game.',
        compute: (L, k) => L.seasons.filter(s => s.complete).flatMap(s => {
            const t = s.perTeam[k];
            const big = (t?.games || []).filter(g => g.pts >= 150);
            if (!big.length) return [];
            const best = big.reduce((a, b) => (b.pts > a.pts ? b : a));
            return [{ season: s.year, detail: `${fmt(best.pts)} pt — W${best.week}${big.length > 1 ? ` (×${big.length})` : ''}` }];
        }),
    },
    {
        id: 'sweep', name: 'Sweep', category: 'seasonal',
        shape: 'circle', icon: 'broom',
        description: 'Beat the same opponent in every matchup of the season.',
        compute: (L, k) => L.seasons.filter(s => s.complete).flatMap(s =>
            (s.perTeam[k]?.sweeps || []).map(opp => ({ season: s.year, detail: `vs ${keyToName(opp)}` }))
        ),
    },
    {
        id: 'clutch', name: 'Clutch Gene', category: 'seasonal',
        shape: 'circle', icon: 'target',
        description: 'Nail-biter win with less than 3 points of margin.',
        compute: (L, k) => L.seasons.filter(s => s.complete).flatMap(s => {
            const close = (s.perTeam[k]?.games || []).filter(g => g.won && g.margin < 3);
            if (!close.length) return [];
            const best = close.reduce((a, b) => (b.margin < a.margin ? b : a));
            return [{ season: s.year, detail: `+${fmt(best.margin)} vs ${keyToName(best.opp)} — W${best.week}` }];
        }),
    },
    {
        id: 'hot-start', name: 'Hot Start', category: 'seasonal',
        shape: 'hex', icon: 'sun',
        description: "Won the season's first three games.",
        compute: (L, k) => L.seasons.filter(s => s.complete).flatMap(s => {
            const games = [...(s.perTeam[k]?.games || [])].sort((a, b) => a.week - b.week);
            return games.length >= 3 && games.slice(0, 3).every(g => g.won)
                ? [{ season: s.year, detail: '3-0 start' }]
                : [];
        }),
    },
    {
        id: 'century-club', name: 'Century Club', category: 'seasonal',
        shape: 'shield', icon: 'castle',
        description: 'Never below 100 points across the entire regular season.',
        compute: (L, k) => L.seasons.filter(s => s.complete).flatMap(s => {
            const games = s.perTeam[k]?.games || [];
            return games.length > 0 && games.every(g => g.pts >= 100)
                ? [{ season: s.year, detail: 'Never below 100 pt' }]
                : [];
        }),
    },
];

export const CATEGORY_LABELS = {
    evergreen: 'Franchise',
    career: 'Career',
    exclusive: 'Annual Exclusives',
    seasonal: 'Seasonal',
};

/**
 * Calcola tutti i badge per un team.
 * → [{ ...def, instances, earned, count }]
 */
export function computeTeamBadges(league, teamKey) {
    const computed = BADGE_DEFS.map(def => {
        const instances = def.compute(league, teamKey);
        return { ...def, instances, earned: instances.length > 0, count: instances.length };
    });
    SPECIAL_BADGES.filter(b => b.teamKey === teamKey).forEach(b => {
        computed.push({
            id: `special-${b.name}`, name: b.name, category: 'seasonal',
            shape: b.shape || 'circle', icon: b.icon || 'laurel',
            description: b.description || '',
            instances: [{ season: b.season || null, detail: b.detail || '' }],
            earned: true, count: 1,
        });
    });
    return computed;
}
