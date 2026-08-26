/**
 * Play-by-play NFL da ESPN, con i protagonisti identificati.
 *
 * Endpoint (host con `Access-Control-Allow-Origin: *`, quindi chiamabile
 * direttamente dal browser come gli altri di nfl-team-live.js):
 *
 *   sports.core.api.espn.com/v2/.../events/{id}/competitions/{id}/plays
 *
 * A differenza del `summary` del sito, qui ogni giocata porta `participants[]`
 * con l'ID atleta ESPN e il ruolo avuto nell'azione (passer, receiver, rusher,
 * kicker, returner, sackedBy...). È quello che permette di dire "questo
 * passaggio è di Love per Golden" invece di leggerlo dal testo.
 *
 * Costi misurati su una partita conclusa (189 giocate): tutte insieme 39 KB
 * gzip, l'ultima pagina da 20 giocate 2 KB. Il polling usa la seconda forma.
 */

import { cacheGet, cacheSet } from '../utils/storage.js?v=3';

const CORE = 'https://sports.core.api.espn.com/v2/sports/football/leagues/nfl';

/** Ruoli che ci interessano; gli altri (tackler, assistedBy, penalized...) si scartano. */
const KEEP_ROLES = new Set([
    'passer', 'receiver', 'rusher', 'kicker', 'punter', 'returner',
    'sackedBy', 'passDefender', 'scorer', 'patScorer',
]);

/** Fetch con scadenza: senza, una risposta che non arriva mai terrebbe il
 *  polling appeso e la pagina sullo spinner. */
async function getJson(url, ms = 8000) {
    const stop = new AbortController();
    const timer = setTimeout(() => stop.abort(), ms);
    try {
        const res = await fetch(url, { signal: stop.signal });
        if (!res.ok) throw new Error(`ESPN ${res.status}`);
        return await res.json();
    } finally { clearTimeout(timer); }
}

const athleteId = (ref) => (String(ref || '').match(/\/athletes\/(\d+)/) || [])[1] || null;
const teamId = (ref) => (String(ref || '').match(/\/teams\/(\d+)/) || [])[1] || null;

/**
 * Yard da accreditare al giocatore.
 *
 * Di norma `statYardage`. Ma quando la giocata ha una penalità accettata quel
 * campo diventa il risultato NETTO dell'azione (guadagno meno l'arretramento),
 * mentre al giocatore le statistiche contano le yard davvero fatte — quelle
 * scritte nel testo. Verificato su una partita intera contro il box score
 * ufficiale: senza questa distinzione una ricezione da 3 yard con penalità
 * veniva contata −17, e sballava sia il ricevitore sia il quarterback.
 */
function playYards(p, text) {
    const raw = Number(p.statYardage) || 0;
    if (!p.isPenalty) return raw;
    const m = text.match(/for (-?\d+) yards?/i);
    if (m) return Number(m[1]);
    return /for no gain/i.test(text) ? 0 : raw;
}

/**
 * Giocata normalizzata:
 *   { id, seq, type, text, yards, scoring, period, clock, ts,
 *     actors: { passer: '11252', receiver: '3123076', ... },
 *     offenseTeamId, defenseTeamId }
 */
function normalizePlay(p) {
    const actors = {};
    for (const part of p.participants || []) {
        if (!KEEP_ROLES.has(part.type)) continue;
        const id = athleteId(part.athlete?.$ref);
        // primo attore per ruolo: su una giocata sola non ce ne sono due
        if (id && !actors[part.type]) actors[part.type] = id;
    }
    const tp = p.teamParticipants || [];
    const text = p.text || '';
    return {
        id: String(p.id),
        seq: Number(p.sequenceNumber) || 0,
        type: p.type?.text || '',
        text,
        yards: playYards(p, text),
        scoring: !!p.scoringPlay,
        period: p.period?.number ?? null,
        clock: p.clock?.displayValue || null,
        ts: p.wallclock ? Date.parse(p.wallclock) : Date.now(),
        actors,
        offenseTeamId: teamId(tp.find(t => t.type === 'offense')?.team?.$ref) || tp.find(t => t.type === 'offense')?.id || null,
        defenseTeamId: teamId(tp.find(t => t.type === 'defense')?.team?.$ref) || tp.find(t => t.type === 'defense')?.id || null,
    };
}

/**
 * Ultime giocate di una partita. Senza `all` scarica solo l'ultima pagina
 * (~2 KB): abbastanza per un polling ogni 10s, dove tra un giro e l'altro
 * nascono al massimo un paio di azioni.
 *
 * Ritorna [] su qualsiasi errore: il widget non deve rompersi se una singola
 * partita non risponde.
 */
export async function fetchPlays(eventId, { all = false, pageSize = 25 } = {}) {
    if (!eventId) return [];
    const base = `${CORE}/events/${eventId}/competitions/${eventId}/plays`;
    try {
        if (all) {
            return ((await getJson(`${base}?limit=400`)).items || []).map(normalizePlay);
        }
        // Una prima richiesta minima serve solo a sapere quante pagine ci sono;
        // la risposta utile è la seconda, sull'ultima pagina.
        const meta = await getJson(`${base}?limit=${pageSize}`);
        const last = Math.max(1, Number(meta.pageCount) || 1);
        if (last === 1) return (meta.items || []).map(normalizePlay);
        const page = await getJson(`${base}?limit=${pageSize}&page=${last}`);
        return (page.items || []).map(normalizePlay);
    } catch (e) {
        console.warn(`[nfl-plays] giocate non disponibili per ${eventId}:`, e.message);
        return [];
    }
}

// ─── Anagrafica atleti ───────────────────────────────────────────

const ATHLETE_CACHE_KEY = 'topina-espn-athletes';
let _athletes = null;

function athleteCache() {
    if (_athletes) return _athletes;
    _athletes = cacheGet(ATHLETE_CACHE_KEY, Infinity) || {};
    return _athletes;
}

/** Foto ufficiale ESPN: URL deterministico dall'ID, nessuna chiamata. */
export const headshotUrl = (espnId) =>
    espnId ? `https://a.espncdn.com/i/headshots/nfl/players/full/${espnId}.png` : '';

/**
 * Nome e ruolo di un atleta dal suo ID ESPN, per i protagonisti che non
 * stanno in PLAYER_ID_MAP (rookie: quella mappa è generata da dati Sleeper
 * più vecchi). Una chiamata per atleta, poi localStorage — i giocatori che
 * ricorrono in una partita sono poche decine.
 */
export async function resolveAthlete(espnId) {
    if (!espnId) return null;
    const cache = athleteCache();
    if (cache[espnId]) return cache[espnId];
    try {
        const a = (await getJson(
            `https://site.web.api.espn.com/apis/common/v3/sports/football/nfl/athletes/${espnId}`)).athlete || {};
        const info = {
            name: a.displayName || a.fullName || '',
            pos: a.position?.abbreviation || '',
            team: a.team?.abbreviation || '',
        };
        if (!info.name) return null;
        cache[espnId] = info;
        cacheSet(ATHLETE_CACHE_KEY, cache);
        return info;
    } catch {
        return null;
    }
}
