import { PLAYER_ID_MAP, TEAM_ABBR_MAP, ESPN_TEAM_IDS } from '../data/player-map.js?v=2';

const CACHE_KEY = 'topina_player_ids_v3';
const FALLBACK_IMAGE = 'images/fallback-player.svg';

export class PlayerImageService {
    constructor() {
        this.cache = this._loadCache();
        this._rosterCache = {}; // In-memory cache for rosters: { teamId: [players] }
        this.debug = false;
    }

    setDebug(enabled) {
        this.debug = enabled;
        console.log(`[PlayerImageService] Debug mode ${enabled ? 'ENABLED' : 'DISABLED'}`);
    }

    _log(msg, ...args) {
        if (this.debug) console.log(`[PlayerImageService] ${msg}`, ...args);
    }

    /**
     * Get the headshot URL for a player.
     * Returns a promise that resolves to the image URL (or fallback).
     * @param {string} playerName
     * @param {string|null} teamAbbr
     * @param {string|null} position
     * @param {number|string|null} year - Draft year (optional)
     */
    async getPlayerImageUrl(playerName, teamAbbr = null, position = null, year = null) {
        if (!playerName) return FALLBACK_IMAGE;

        this._log(`Requesting image for: ${playerName} (Year: ${year || 'Current'})`);

        // 0. Check Defense/Team Map first
        if (TEAM_ABBR_MAP[playerName]) {
            this._log(`-> Found in TEAM_ABBR_MAP: ${TEAM_ABBR_MAP[playerName]}`);
            return `https://a.espncdn.com/i/teamlogos/nfl/500/${TEAM_ABBR_MAP[playerName]}.png`;
        }

        // 1. Check Cache first (local storage)
        if (this.cache[playerName] && this.cache[playerName] !== 'NOT_FOUND') {
            const val = this.cache[playerName];
            this._log(`-> Found in Cache: ${val}`);
            return val.startsWith('http') ? val : this._buildUrl(val);
        }

        // 2. Check Manual Map (Legacy)
        if (PLAYER_ID_MAP[playerName]) {
            const val = PLAYER_ID_MAP[playerName];
            const url = val.startsWith('http') ? val : this._buildUrl(val);
            this.cache[playerName] = url;
            this._saveCache();
            this._log(`-> Found in Manual Map: ${url}`);
            return url;
        }

        // Check if we should use roster strategy
        // We only use roster strategy if:
        // 1. Team is known
        // 2. We are in the current season (or no year specified)
        // This avoids searching for 2012 players in 2025 rosters
        const isCurrentSeason = !year || year == new Date().getFullYear() || year == '2025'; // Simplification for demo

        // 3. ROSTER STRATEGY (If team is known and current season)
        if (teamAbbr && ESPN_TEAM_IDS[teamAbbr] && isCurrentSeason) {
            const teamId = ESPN_TEAM_IDS[teamAbbr];
            const rosterImage = await this._findInRoster(playerName, teamId);
            if (rosterImage) {
                this.cache[playerName] = rosterImage;
                this._saveCache();
                this._log(`-> Found in Roster: ${rosterImage}`);
                return rosterImage;
            }
        }

        // 4. Fallback: API (Last Resort)
        // User requested to minimize API calls. 
        // We only try this if all else fails.
        // We also log this as a "New Player" event for the user to see.
        console.warn(`[Topina] NEW PLAYER DETECTED (Not in Map): ${playerName}`);
        this._log(`-> Searching API for ${playerName}...`);

        try {
            const result = await this._fetchPlayerId(playerName);
            if (result) {
                let url;
                if (typeof result === 'object' && result.url) {
                    url = result.url; // Already full URL
                } else if (typeof result === 'string' && result.startsWith('http')) {
                    url = result;
                } else if (typeof result === 'object' && result.id) {
                    url = this._buildUrl(result.id);
                } else {
                    url = this._buildUrl(result);
                }

                this.cache[playerName] = url;
                this._saveCache();
                this._log(`-> Found via API: ${url}`);
                return url;
            }
        } catch (err) {
            console.error("API Error:", err);
        }

        // Final Fallback
        this.cache[playerName] = 'NOT_FOUND';
        this._saveCache();
        this._log(`-> NOT FOUND in API. Using fallback.`);
        return FALLBACK_IMAGE;
    }

    _buildUrl(id) {
        return `https://a.espncdn.com/combiner/i?img=/i/headshots/nfl/players/full/${id}.png&w=350&h=254&scale=crop`;
    }

    _normalizeName(name) {
        return name.toLowerCase()
            .replace(/[.,']/g, '')
            .trim();
    }

    async _fetchTeamRoster(teamId) {
        if (this._rosterCache[teamId]) return this._rosterCache[teamId];

        try {
            console.log(`Fetching full roster for Team ID ${teamId}...`);
            const response = await fetch(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/${teamId}/roster`);
            if (!response.ok) return [];

            const data = await response.json();
            // Flatten the groups (Offense, Defense, Special Teams) into one list
            const athletes = data.athletes.flatMap(group => group.items);

            this._rosterCache[teamId] = athletes;
            return athletes;
        } catch (e) {
            console.error(`Error fetching roster for team ${teamId}`, e);
            return [];
        }
    }

    async _findInRoster(playerName, teamId) {
        const roster = await this._fetchTeamRoster(teamId);
        if (!roster || roster.length === 0) return null;

        // Use the smart fuzzy match on the roster list
        const match = this._findBestMatch(roster, playerName);
        if (match) {
            // Priority 1: Use ID to build standard URL
            if (match.id) {
                return this._buildUrl(match.id);
            }
            if (match.headshot && match.headshot.href) {
                return match.headshot.href;
            }
        }
        return null;
    }

    _findBestMatch(candidates, targetName) {
        if (!candidates || candidates.length === 0) return null;

        const normalizedTarget = this._normalizeName(targetName);
        let bestMatch = null;
        let bestScore = 0;

        for (const candidate of candidates) {
            const candidateName = candidate.displayName || candidate.fullName || '';
            const normalizedCandidate = this._normalizeName(candidateName);

            let score = 0;

            if (normalizedCandidate === normalizedTarget) {
                score = 100;
            } else if (normalizedCandidate.includes(normalizedTarget)) {
                score = 80;
            } else if (normalizedTarget.includes(normalizedCandidate)) {
                score = 70;
            }

            if (score > bestScore) {
                bestScore = score;
                bestMatch = candidate;
            }
        }
        return bestScore >= 50 ? bestMatch : null;
    }

    async _fetchPlayerId(name) {
        try {
            const searchUrl = `https://site.api.espn.com/apis/common/v3/search?limit=5&type=player&sport=football&league=nfl&q=${encodeURIComponent(name)}`;
            const searchRes = await fetch(searchUrl);

            if (searchRes.ok) {
                const searchData = await searchRes.json();
                if (searchData.items && searchData.items.length > 0) {
                    const bestMatch = this._findBestMatch(searchData.items, name);
                    if (bestMatch) {
                        const item = bestMatch;
                        if (item.id) return item.id;
                        let imageUrl = item.headshot?.href || item.image?.href;
                        if (imageUrl) {
                            const idMatch = imageUrl.match(/\/(\d+)\.png/);
                            if (idMatch && idMatch[1]) return idMatch[1];
                            return { id: item.id || 'unknown', url: imageUrl };
                        }
                        if (item.uid) {
                            const parts = item.uid.split('~a:');
                            if (parts.length > 1) return parts[1];
                        }
                    }
                }
            }
            return null;
        } catch (e) {
            console.warn(`Error fetching ID for ${name}:`, e);
            return null;
        }
    }

    _loadCache() {
        try {
            const data = localStorage.getItem(CACHE_KEY);
            return data ? JSON.parse(data) : {};
        } catch (e) {
            console.error('Error loading player cache', e);
            return {};
        }
    }

    _saveCache() {
        try {
            localStorage.setItem(CACHE_KEY, JSON.stringify(this.cache));
        } catch (e) {
            console.error('Error saving player cache', e);
        }
    }
}

// Singleton instance
export const playerImageService = new PlayerImageService();

