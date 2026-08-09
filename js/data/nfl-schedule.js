/**
 * NFL Schedule — orari di kickoff reali per week/stagione.
 * Fonte: API pubblica ESPN scoreboard (funziona anche per stagioni passate).
 * Serve al grafico temporale della pagina analisi partita: sapendo QUANDO
 * ha giocato la squadra NFL di ogni giocatore, i suoi punti fantasy vengono
 * distribuiti nella finestra oraria reale della sua partita.
 * Cache in localStorage: il calendario storico non cambia mai.
 */

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
    try {
        const cached = localStorage.getItem(cacheKey);
        if (cached) return _toMap(JSON.parse(cached));
    } catch { /* localStorage pieno o disabilitato: si rifà il fetch */ }

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
            try { localStorage.setItem(cacheKey, JSON.stringify(entries)); } catch { /* best-effort */ }
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
