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
 * Calendario di una week: Map(abbr → { start: Date, end: Date }).
 * Ritorna null se l'API non è raggiungibile (il chiamante nasconde il grafico).
 */
export async function getWeekSchedule(year, week) {
    const cacheKey = `nfl-sched-${year}-${week}`;
    try {
        const cached = localStorage.getItem(cacheKey);
        if (cached) return _toMap(JSON.parse(cached));
    } catch { /* localStorage pieno o disabilitato: si rifà il fetch */ }

    try {
        const url = `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?seasontype=2&week=${week}&dates=${year}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`ESPN ${res.status}`);
        const data = await res.json();

        const entries = [];
        (data.events || []).forEach(ev => {
            const comp = ev.competitions?.[0];
            if (!comp?.date) return;
            (comp.competitors || []).forEach(c => {
                const abbr = canonAbbr(c.team?.abbreviation);
                if (abbr) entries.push([abbr, comp.date]);
            });
        });
        if (!entries.length) return null;

        try { localStorage.setItem(cacheKey, JSON.stringify(entries)); } catch { /* cache best-effort */ }
        return _toMap(entries);
    } catch (e) {
        console.warn(`[nfl-schedule] calendario ${year} W${week} non disponibile:`, e.message);
        return null;
    }
}

function _toMap(entries) {
    const map = new Map();
    entries.forEach(([abbr, iso]) => {
        const start = new Date(iso);
        map.set(abbr, { start, end: new Date(start.getTime() + GAME_DURATION_MS) });
    });
    return map;
}
