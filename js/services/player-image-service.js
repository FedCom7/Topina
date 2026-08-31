import { PLAYER_ID_MAP, TEAM_ABBR_MAP, ESPN_TEAM_IDS } from '../data/player-map.js?v=513';

// Bump della versione = svuota la cache locale: le versioni v3 e precedenti
// hanno accumulato ID sbagliati dall'era del bug di ricerca (q= invece di
// query=), che restituivano URL headshot in 404.
import { cacheGet, cacheSet } from '../utils/storage.js?v=4';

const CACHE_KEY = 'topina_player_ids_v4';
const FALLBACK_IMAGE = 'images/fallback-player.svg';

// Quanto ci si fida di un "non trovato" prima di riprovare. Serve un tempo, non
// un sì/no: un rookie che oggi non è nei roster ESPN domani c'è, ma senza
// scadenza si riprovava a OGNI caricamento di pagina — misurate 44 richieste
// per visita, sempre le stesse, sempre a vuoto, perché il ramo di lettura della
// cache scartava apposta il valore 'NOT_FOUND'.
const MISS_TTL_MS = 3 * 24 * 60 * 60 * 1000;
const MISS = 'NOT_FOUND';

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

        // 1. Check Manual Map (override curato): PRIMA della cache, così una
        // correzione manuale vince sempre su un ID errato eventualmente cachato.
        if (PLAYER_ID_MAP[playerName]) {
            const val = PLAYER_ID_MAP[playerName];
            const url = val.startsWith('http') ? val : this._buildUrl(val);
            this.cache[playerName] = url;
            this._saveCache();
            this._log(`-> Found in Manual Map: ${url}`);
            return url;
        }

        // 2. Check Cache (local storage)
        const cached = this.cache[playerName];
        if (cached && !this._isMiss(cached)) {
            this._log(`-> Found in Cache: ${cached}`);
            return cached.startsWith('http') ? cached : this._buildUrl(cached);
        }
        // Cercato di recente e non trovato: si sta sul fallback senza rifare il
        // giro dei roster. Scaduto il termine si riprova, per i rookie.
        if (cached && this._isMiss(cached) && !this._missExpired(cached)) {
            this._log(`-> Miss ancora valido: fallback senza richieste`);
            return FALLBACK_IMAGE;
        }

        // 3. ROSTER STRATEGY (If team is known and current season)
        if (teamAbbr && ESPN_TEAM_IDS[teamAbbr] && this._isCurrentSeason(year)) {
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
        this.cache[playerName] = `${MISS}:${Date.now()}`;
        this._saveCache();
        this._log(`-> NOT FOUND in API. Using fallback.`);
        return FALLBACK_IMAGE;
    }

    /** Un "non trovato". La forma vecchia (senza data) risulta scaduta: si
     *  riprova una volta sola, poi viene riscritta con la data di oggi. */
    _isMiss(val) {
        return typeof val === 'string' && val.startsWith(MISS);
    }

    _missExpired(val) {
        const at = Number(val.split(':')[1]) || 0;
        return Date.now() - at > MISS_TTL_MS;
    }

    _buildUrl(id) {
        return `https://a.espncdn.com/combiner/i?img=/i/headshots/nfl/players/full/${id}.png&w=350&h=254&scale=crop`;
    }

    _normalizeName(name) {
        return name.toLowerCase()
            .replace(/[.,']/g, '')
            .trim();
    }

    /**
     * In cache va la PROMESSA, non la rosa gia' pronta. Le foto si risolvono
     * tutte insieme, quindi decine di chiamate per la stessa squadra partivano
     * prima che la prima rispondesse e non trovavano mai la cache piena:
     * misurato su Game Center a browser pulito, le rose NFL venivano scaricate
     * due o tre volte ciascuna. Restituendo la promessa, la prima scarica e le
     * altre si agganciano.
     * Un fallimento non resta in cache: e' un endpoint di rete e puo' tornare su.
     */
    _fetchTeamRoster(teamId) {
        if (this._rosterCache[teamId]) return this._rosterCache[teamId];

        const p = fetch(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/${teamId}/roster`)
            .then(res => (res.ok ? res.json() : null))
            .then(data => {
                if (!data?.athletes) {
                    delete this._rosterCache[teamId];
                    return [];
                }
                // Flatten the groups (Offense, Defense, Special Teams) into one list
                return data.athletes.flatMap(group => group.items || []);
            })
            .catch(e => {
                console.error(`Error fetching roster for team ${teamId}`, e);
                delete this._rosterCache[teamId];
                return [];
            });

        this._rosterCache[teamId] = p;
        return p;
    }

    async _findInRoster(playerName, teamId) {
        const roster = await this._fetchTeamRoster(teamId);
        if (!roster || roster.length === 0) return null;

        // Use the smart fuzzy match on the roster list
        const match = this._findBestMatch(roster, playerName);
        if (match) {
            // Priorità all'headshot fornito dal roster: esiste per certo.
            // Solo se manca ripieghiamo sull'URL costruito dall'id (può 404).
            if (match.headshot && match.headshot.href) {
                return match.headshot.href;
            }
            if (match.id) {
                return this._buildUrl(match.id);
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
            // NB: il parametro è `query=` — con `q=` ESPN ignora il filtro e
            // restituisce i giocatori più popolari, mandando in fallback chiunque
            // non fosse già in mappa o nel roster corrente.
            const searchUrl = `https://site.api.espn.com/apis/common/v3/search?limit=5&type=player&sport=football&league=nfl&query=${encodeURIComponent(name)}`;
            const searchRes = await fetch(searchUrl);

            if (searchRes.ok) {
                const searchData = await searchRes.json();
                if (searchData.items && searchData.items.length > 0) {
                    const bestMatch = this._findBestMatch(searchData.items, name);
                    if (bestMatch) {
                        const item = bestMatch;
                        // Priorità all'headshot fornito da ESPN: se c'è, l'immagine
                        // esiste per certo (evita 404 su id validi ma senza foto).
                        const imageUrl = item.headshot?.href || item.image?.href;
                        if (imageUrl) return { id: item.id || 'unknown', url: imageUrl };
                        if (item.id) return item.id;
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

    // Come nel commento sopra: si usa il roster ESPN corrente solo per la
    // stagione corrente, sennò si cercherebbe un giocatore del 2012 nella
    // rosa 2025 — vale sia per l'headshot che per il numero di maglia.
    _isCurrentSeason(year) {
        return !year || year == new Date().getFullYear() || year == '2025'; // Simplification for demo
    }

    /**
     * Numero di maglia, a costo quasi zero quando il roster è già stato
     * scaricato per l'headshot: stessa cache in memoria (`_rosterCache`),
     * solo letta due volte. Come le foto, vale per la rosa CORRENTE — su una
     * stagione passata il giocatore potrebbe aver cambiato maglia o squadra
     * (o non fetcha proprio, stesso cancello di `_isCurrentSeason`), quindi
     * qui si preferisce niente numero piuttosto che uno sbagliato.
     */
    async getPlayerJersey(playerName, teamAbbr, year) {
        if (!playerName || !teamAbbr || !ESPN_TEAM_IDS[teamAbbr] || !this._isCurrentSeason(year)) return null;
        try {
            const roster = await this._fetchTeamRoster(ESPN_TEAM_IDS[teamAbbr]);
            const match = this._findBestMatch(roster, playerName);
            return match?.jersey ?? null;
        } catch {
            return null;
        }
    }

    _loadCache() {
        return cacheGet(CACHE_KEY, Infinity) || {};
    }

    _saveCache() {
        cacheSet(CACHE_KEY, this.cache);
    }
}

// Singleton instance
export const playerImageService = new PlayerImageService();

