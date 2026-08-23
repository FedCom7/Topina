/**
 * NFL Schedule — orari di kickoff reali per week/stagione.
 * Fonte: API pubblica ESPN scoreboard (funziona anche per stagioni passate).
 * Serve al grafico temporale della pagina analisi partita: sapendo QUANDO
 * ha giocato la squadra NFL di ogni giocatore, i suoi punti fantasy vengono
 * distribuiti nella finestra oraria reale della sua partita.
 * Cache in localStorage: il calendario storico non cambia mai.
 */

import { cacheGet, cacheSet } from '../utils/storage.js?v=1';
import { NFL_TEAMS } from './nfl-teams.js?v=508';

const GAME_DURATION_MS = 3.25 * 60 * 60 * 1000; // ~3h15m

// Abbreviazioni → forma canonica (ESPN e Yahoo/Firebase differiscono su alcune)
const ALIAS = {
    WSH: 'WAS', JAC: 'JAX', LA: 'LAR', STL: 'LAR', SD: 'LAC', OAK: 'LV',
};

export function canonAbbr(abbr) {
    const a = (abbr || '').toUpperCase().trim();
    return ALIAS[a] || a;
}

/**
 * Calendario di una week: Map(abbr → { start, end, eventId, state }).
 * `eventId` è l'id partita ESPN, serve al play-by-play; `state` è
 * 'pre' | 'in' | 'post'. Ritorna null se l'API non è raggiungibile
 * (il chiamante nasconde il grafico).
 *
 * La cache su localStorage vale solo per una week interamente conclusa: su
 * una week in corso `state` cambia, e servirlo dalla cache terrebbe il
 * play-by-play convinto che non ci sia niente da seguire.
 */
export async function getWeekSchedule(year, week, seasonType = 2) {
    // seasonType 1 = preseason, 2 = stagione regolare. La preseason serve solo
    // al collaudo della pagina live fuori stagione: la lega non la gioca, e
    // quelle statistiche non devono mai entrare nei totali fantasy.
    const cacheKey = `nfl-sched4-${year}-${seasonType}-${week}`;
    // Infinity: una week conclusa non cambia più, scade solo per sfratto.
    const hit = cacheGet(cacheKey, Infinity);
    if (hit) return _toMap(hit);

    try {
        const url = `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?seasontype=${seasonType}&week=${week}&dates=${year}`;
        // con scadenza: senza, una risposta che non arriva mai lascia il
        // chiamante in attesa e la pagina sullo spinner
        const stop = new AbortController();
        const timer = setTimeout(() => stop.abort(), 8000);
        let data;
        try {
            const res = await fetch(url, { signal: stop.signal });
            if (!res.ok) throw new Error(`ESPN ${res.status}`);
            data = await res.json();
        } finally { clearTimeout(timer); }

        const entries = [];
        (data.events || []).forEach(ev => {
            const comp = ev.competitions?.[0];
            if (!comp?.date) return;
            const st = comp.status?.type || ev.status?.type || {};
            const state = st.state || 'pre';
            const teams = comp.competitors || [];
            teams.forEach(c => {
                const abbr = canonAbbr(c.team?.abbreviation);
                const other = teams.find(x => x !== c);
                if (!abbr || !other) return;
                // La chiave della mappa è canonica (serve agli agganci interni),
                // ma l'avversario MOSTRATO tiene la sigla grezza di ESPN, come
                // nello schema storico: lì Washington è "WSH", non "WAS".
                const oppAbbr = (other.team?.abbreviation || '').toUpperCase();
                // "BUF" in casa, "@BUF" in trasferta
                const opponent = c.homeAway === 'home' ? oppAbbr : `@${oppAbbr}`;
                entries.push([abbr, comp.date, ev.id, state, opponent,
                    gameStatus(c, other, st), Number(c.score) || 0,
                    Number(other.score) || 0, st.shortDetail || '']);
            });
        });
        if (!entries.length) return null;

        if (entries.every(e => e[3] === 'post')) {
            cacheSet(cacheKey, entries);
        }
        return _toMap(entries);
    } catch (e) {
        console.warn(`[nfl-schedule] calendario ${year} W${week} non disponibile:`, e.message);
        return null;
    }
}

/**
 * Esito dal punto di vista di questa squadra: "Win, 42-10" a partita finita,
 * altrimenti l'etichetta breve del tabellone (orario di kickoff se deve ancora
 * cominciare, quarto e cronometro se è in corso).
 */
function gameStatus(team, other, statusType) {
    if (!statusType.completed) return statusType.shortDetail || statusType.description || '';
    const mine = parseInt(team.score, 10) || 0;
    const theirs = parseInt(other.score, 10) || 0;
    const esito = mine > theirs ? 'Win' : mine < theirs ? 'Loss' : 'Tie';
    return `${esito}, ${mine}-${theirs}`;
}

// ─── Tabellone di una settimana (tutte le partite) ───────────────────────
// Stessa risposta ESPN di getWeekSchedule, letta però PARTITA per partita
// invece che squadra per squadra: serve al calendario della pagina Players,
// che mostra le 16 gare della giornata con punteggio, record e rete TV.

/**
 * Tutte le partite di una settimana: { year, week, seasonType, games, bye }.
 * `games` è ordinato per orario di kickoff, `bye` sono le sigle delle squadre
 * che quella settimana non giocano. Ritorna null se ESPN non risponde o la
 * settimana non esiste (il chiamante mostra il ripiego).
 *
 * Come in getWeekSchedule la cache vale solo per una giornata interamente
 * conclusa: su una settimana in corso lo stato cambia di minuto in minuto.
 */
export async function getWeekGames(year, week, seasonType = 2) {
    const cacheKey = `nfl-weekgames1-${year}-${seasonType}-${week}`;
    const hit = cacheGet(cacheKey, Infinity);
    if (hit) return hit;

    try {
        const url = `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?seasontype=${seasonType}&week=${week}&dates=${year}`;
        const stop = new AbortController();
        const timer = setTimeout(() => stop.abort(), 8000);
        let data;
        try {
            const res = await fetch(url, { signal: stop.signal });
            if (!res.ok) throw new Error(`ESPN ${res.status}`);
            data = await res.json();
        } finally { clearTimeout(timer); }

        const games = (data.events || []).map(_toGame).filter(Boolean)
            .sort((a, b) => new Date(a.date) - new Date(b.date));
        if (!games.length) return null;

        // Bye: le 32 squadre meno quelle in campo. In week 1-18 sono 0, 2, 4 o 6.
        const playing = new Set(games.flatMap(g => [g.home.abbr, g.away.abbr]));
        const bye = Object.keys(NFL_TEAMS).filter(a => !playing.has(a)).sort();

        const out = { year, week, seasonType, games, bye };
        if (games.every(g => g.state === 'post')) {
            cacheSet(cacheKey, out);
        }
        return out;
    } catch (e) {
        console.warn(`[nfl-schedule] tabellone ${year} W${week} non disponibile:`, e.message);
        return null;
    }
}

function _toGame(ev) {
    const comp = ev.competitions?.[0];
    if (!comp) return null;
    const st = comp.status?.type || ev.status?.type || {};
    const side = (homeAway) => {
        const c = (comp.competitors || []).find(x => x.homeAway === homeAway);
        if (!c) return null;
        const raw = c.score;
        const score = raw == null || raw === '' ? null : Number(typeof raw === 'object' ? (raw.value ?? raw.displayValue) : raw);
        return {
            abbr: canonAbbr(c.team?.abbreviation),
            name: c.team?.shortDisplayName || c.team?.displayName || '',
            score: Number.isFinite(score) ? score : null,
            record: (c.records || []).find(r => r.type === 'total')?.summary || null,
            winner: c.winner === true,
        };
    };
    const home = side('home'), away = side('away');
    if (!home?.abbr || !away?.abbr) return null;
    return {
        eventId: ev.id || comp.id || null,
        date: comp.date || ev.date || null,
        state: st.state || 'pre',                     // pre · in · post
        completed: !!st.completed,
        status: st.shortDetail || st.description || '',
        // rete TV nazionale/locale: geoBroadcasts è più preciso, broadcasts il ripiego
        tv: comp.geoBroadcasts?.find(b => b.type?.shortName === 'TV')?.media?.shortName
            || comp.broadcasts?.[0]?.names?.[0] || null,
        home, away,
    };
}

/**
 * Dove si trova OGGI la stagione NFL, riportato alla regular season:
 * { year, week }. In preseason/offseason punta alla week 1 che deve ancora
 * cominciare, a playoff in corso all'ultima giornata di regular season.
 * Null se ESPN non risponde (il chiamante ripiega sulla week 1).
 */
export async function getCurrentNflWeek() {
    try {
        const stop = new AbortController();
        const timer = setTimeout(() => stop.abort(), 8000);
        let data;
        try {
            const res = await fetch('https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard', { signal: stop.signal });
            if (!res.ok) throw new Error(`ESPN ${res.status}`);
            data = await res.json();
        } finally { clearTimeout(timer); }

        const year = data.season?.year || new Date().getFullYear();
        const type = data.season?.type ?? 2;
        if (type === 2) return { year, week: Math.min(Math.max(data.week?.number || 1, 1), 18) };
        if (type === 3) return { year, week: 18 };
        return { year, week: 1 };
    } catch (e) {
        console.warn('[nfl-schedule] settimana corrente non disponibile:', e.message);
        return null;
    }
}

function _toMap(entries) {
    const map = new Map();
    entries.forEach(([abbr, iso, eventId = null, state = 'pre', opponent = '',
        status = '', score = 0, oppScore = 0, detail = ''] ) => {
        const start = new Date(iso);
        map.set(abbr, {
            start, end: new Date(start.getTime() + GAME_DURATION_MS),
            eventId, state, opponent, status,
            // punteggio della partita NFL vera, per il riquadro risultati
            score, oppScore, detail,
        });
    });
    return map;
}
