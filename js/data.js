/**
 * Topina League — Data Layer
 * All Firebase RTDB fetching and processing.
 */
import { db } from './firebase-config.js?v=3';
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

/*
 * Le stesse stagioni dalla piu' RECENTE. E' l'ordine con cui vanno riempite le
 * tendine dell'anno: si apre quasi sempre sull'anno in corso, e da li' si
 * guarda indietro — con le piu' vecchie in cima bisogna scorrere fino in
 * fondo per trovare quella che serve.
 *
 * Esiste come costante e non come `[...SEASONS].reverse()` sparso nei file
 * perche' voci e indice della voce attiva devono venire dalla STESSA lista:
 * calcolando l'indice su una e le voci sull'altra la capsula mostra un anno e
 * il contenuto ne carica un altro. E' successo davvero.
 */
export const SEASONS_DESC = [...SEASONS].reverse();

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

/**
 * Cache condivisa delle letture di lega.
 *
 * Senza, la stessa stagione veniva riscaricata a ripetizione: Stats la
 * chiedeva TRE volte (tre cicli indipendenti sulle stagioni) e una sessione
 * che gira fra le sezioni arrivava a QUATTRO — 8,7 MB dal websocket per dati
 * identici, misurati il 26/08/2026. Ogni chiamante aveva la sua cache o
 * nessuna, e nessuno vedeva quella degli altri.
 *
 * Si mette in cache la PROMESSA, non il risultato: cosi' anche le richieste
 * che partono insieme, prima che la prima risponda, si agganciano a quella.
 *
 * Una stagione chiusa non cambia piu': si tiene per sempre. Quella in corso
 * cambia una volta a settimana (il martedi', quando lo scraper carica la
 * giornata), quindi le si da' una scadenza breve — abbastanza da azzerare le
 * raffiche, abbastanza corta da non far invecchiare una scheda lasciata
 * aperta. Un buco (errore di rete o nodo assente) non si mette in cache,
 * altrimenti un singolo timeout resterebbe appiccicato li' per sempre.
 */
const _letture = new Map();
const TTL_STAGIONE_IN_CORSO = 5 * 60 * 1000;

/**
 * Ogni chiamante riceve una COPIA, non l'originale in cache.
 *
 * Prima della cache ogni chiamata tornava un oggetto nuovo appena letto dal
 * database, quindi chi lo riceveva poteva modificarlo senza pensarci — e
 * qualcuno lo fa: il Game Center sovrascrive la settimana ancora aperta con i
 * dati in diretta di ESPN (`currentData.weeks[week] = ...`). Restituendo
 * l'originale, quella scrittura sarebbe finita anche in Analysis e Stats, che
 * si sarebbero ritrovate dati ESPN al posto di quelli di lega senza che
 * nessuno lo avesse chiesto. La copia ridà la stessa garanzia di prima,
 * lasciando intatto il risparmio di rete.
 */
const copia = (d) => (d == null ? d : (typeof structuredClone === 'function'
    ? structuredClone(d)
    : JSON.parse(JSON.stringify(d))));

function letturaCachata(chiave, season, carica) {
    const vecchia = _letture.get(chiave);
    const inCorso = String(season) === String(CURRENT_SEASON);
    if (vecchia && !(inCorso && Date.now() - vecchia.quando > TTL_STAGIONE_IN_CORSO)) {
        return vecchia.promessa.then(copia);
    }
    const promessa = carica().then(dati => {
        if (dati == null) _letture.delete(chiave); // niente non si cacha
        return dati;
    });
    _letture.set(chiave, { quando: Date.now(), promessa });
    return promessa.then(copia);
}

export function fetchFantasyData(season) {
    return letturaCachata(`fantasy:${season}`, season, async () => {
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
    });
}

export function fetchDraftData(season) {
    return letturaCachata(`draft:${season}`, season, async () => {
        try {
            const snap = await get(child(ref(db), `draft/draft_data_${season}`));
            return snap.exists() ? snap.val() : null;
        } catch (e) {
            console.error('fetchDraftData error:', e);
            return null;
        }
    });
}

// Qui vivevano fetchAllTimeStats() (nodo stats/all_time) e
// fetchAllSeasonsData(): nessuna delle due aveva un chiamante. La prima era
// anche l'unico punto che leggeva stats/all_time, quindi quel nodo ora non lo
// tocca piu' nessuno.

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
            const s1 = parseFloat(m.team1.score) || 0;
            const s2 = parseFloat(m.team2.score) || 0;
            /*
             * Una partita SENZA DATI non si conta. Su Firebase il calendario
             * esiste per intero fin da subito, con i punteggi a zero: la
             * giornata in corso, e tutte quelle dopo, arrivavano qui come 0-0
             * e finivano nel ramo del pareggio. Il record mostrava allora un
             * pareggio che non e' mai stato giocato, e la serie in corso
             * diventava una fila di "T".
             *
             * Zero contro zero non e' un pareggio possibile: nel fantasy
             * qualcuno segna sempre qualcosa. E' quindi il segnale che la
             * partita non c'e' ancora — la stessa regola che usa il Magazine
             * per sapere quali edizioni esistono.
             */
            // Le squadre si registrano comunque, anche a stagione non
            // cominciata: la classifica deve mostrarle a 0-0, non sparire.
            init(m.team1.name);
            init(m.team2.name);
            if (s1 <= 0 && s2 <= 0) return;
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
 * Classifica FINALE della stagione: quella che esce dai playoff, non dal
 * record.
 *
 * In una lega a quattro non c'e' un tabellone da ricostruire. La settimana dei
 * playoff sono due semifinali; la settimana dopo si giocano la finale, fra le
 * due che hanno vinto, e la finalina fra le due che hanno perso. Il posto di
 * ognuno e' deciso da quelle due partite, e puo' non somigliare per niente
 * alla regular season — e' esattamente il motivo per cui vale la pena
 * mostrarla accanto.
 *
 * Sui pari punti vince `team1`, la stessa convenzione di
 * `getSuperBowlMatchup`: due regole diverse avrebbero potuto dare due campioni
 * diversi nella stessa pagina.
 */
export function processPlayoffStandings(fantasyData, year) {
    if (!fantasyData?.weeks) return [];
    const config = getSeasonConfig(year);
    const po = fantasyData.weeks[String(config.playoffWeek)]?.matchups || [];
    const sb = fantasyData.weeks[String(config.superBowlWeek)]?.matchups || [];
    if (!po.length || !sb.length) return [];

    const punti = (t) => parseFloat(t?.score) || 0;
    const vinta = (m) => (punti(m.team1) >= punti(m.team2) ? m.team1 : m.team2);
    const persa = (m) => (punti(m.team1) >= punti(m.team2) ? m.team2 : m.team1);

    const vincenti = new Set();
    for (const m of po) {
        if (!m.team1 || !m.team2) continue;
        vincenti.add(vinta(m).name);
    }

    const finale = sb.find(m => m.team1 && m.team2
        && vincenti.has(m.team1.name) && vincenti.has(m.team2.name));
    if (!finale) return [];
    const finalina = sb.find(m => m !== finale && m.team1 && m.team2);

    const ordine = [vinta(finale).name, persa(finale).name];
    if (finalina) {
        ordine.push(vinta(finalina).name, persa(finalina).name);
    } else {
        // Niente finalina (e' successo in qualche stagione): terzo e quarto si
        // ordinano allora sui punti della semifinale persa, che e' l'unico
        // confronto diretto che hanno.
        const perdenti = po.filter(m => m.team1 && m.team2).map(m => persa(m));
        perdenti.sort((a, b) => punti(b) - punti(a));
        ordine.push(...perdenti.map(t => t.name));
    }

    // Record e punti della POSTSEASON: due partite a testa, ed e' quello che
    // racconta come ci sono arrivati.
    const conto = new Map();
    for (const m of [...po, ...sb]) {
        if (!m.team1 || !m.team2) continue;
        for (const [t, mio, suo] of [[m.team1, punti(m.team1), punti(m.team2)],
            [m.team2, punti(m.team2), punti(m.team1)]]) {
            const c = conto.get(t.name) || { w: 0, l: 0, pf: 0, pa: 0 };
            if (mio >= suo) c.w++; else c.l++;
            c.pf += mio;
            c.pa += suo;
            conto.set(t.name, c);
        }
    }

    return ordine.map(name => ({ name, ...(conto.get(name) || { w: 0, l: 0, pf: 0, pa: 0 }) }));
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
