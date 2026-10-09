/**
 * L'esito della giornata — hai vinto o hai perso — per la schermata che si
 * apre la prima volta che si entra nel sito dopo che la giornata e' stata
 * chiusa e caricata su Firebase (il martedi' mattina, dopo `espn-live.yml`).
 *
 * Conti puri: niente DOM e niente rete. Chi chiama passa i dati della
 * stagione (`fetchFantasyData`), la giornata e la squadra; qui si decide
 * cosa raccontare. La scena sta in `sections/week-result.js`.
 */

import { getSeasonConfig } from '../data.js?v=595';
import { TEAM_KEYS } from './team-config.js?v=535';

const P = (v) => Number.parseFloat(v) || 0;
const chiaveDi = (nomeVisto) => TEAM_KEYS[nomeVisto] || null;

/** Come si chiama una giornata: Week N, o il turno di playoff. */
export function etichettaGiornata(year, week) {
    const c = getSeasonConfig(year);
    if (week === c.superBowlWeek) return 'Topina Bowl';
    if (week === c.playoffWeek) return 'Semifinal';
    return `Week ${week}`;
}

/** Una giornata e' chiusa quando su Firebase ha punteggi veri (non 0-0). */
function giornataGiocata(w) {
    return (w?.matchups || []).some(m => P(m.team1?.score) > 0 || P(m.team2?.score) > 0);
}

/** L'ultima giornata chiusa della stagione, o null. */
export function ultimaGiornataChiusa(data) {
    const chiuse = Object.entries(data?.weeks || {})
        .filter(([, w]) => giornataGiocata(w)).map(([k]) => Number(k));
    return chiuse.length ? Math.max(...chiuse) : null;
}

/** Tutte le giornate chiuse, in ordine: servono al banco di prova. */
export function giornateChiuse(data) {
    return Object.entries(data?.weeks || {})
        .filter(([, w]) => giornataGiocata(w)).map(([k]) => Number(k)).sort((a, b) => a - b);
}

/**
 * Record e posizione in classifica DOPO una giornata, contando solo la
 * regular season fino a lei. Stesso criterio della pagina Standings: vittorie,
 * poi punti fatti.
 */
function classificaFino(data, year, fino, displayName) {
    const c = getSeasonConfig(year);
    const t = {};
    const reg = (n) => (t[n] ||= { w: 0, l: 0, tie: 0, pf: 0 });
    for (let w = 1; w <= Math.min(fino, c.regularSeasonWeeks); w++) {
        for (const m of data?.weeks?.[String(w)]?.matchups || []) {
            if (!m.team1 || !m.team2) continue;
            const a = reg(displayName(m.team1.name)), b = reg(displayName(m.team2.name));
            const s1 = P(m.team1.score), s2 = P(m.team2.score);
            if (s1 <= 0 && s2 <= 0) continue;
            a.pf += s1; b.pf += s2;
            if (s1 > s2) { a.w++; b.l++; } else if (s2 > s1) { b.w++; a.l++; } else { a.tie++; b.tie++; }
        }
    }
    const ordine = Object.entries(t).sort(([, x], [, y]) => (y.w - x.w) || (y.pf - x.pf)).map(([n]) => n);
    return { tabella: t, ordine };
}
const record = (r) => (r ? `${r.w}–${r.l}${r.tie ? `–${r.tie}` : ''}` : '0–0');

/** I giocatori di una squadra, coi punti della giornata. */
function giocatori(lista) {
    return (lista || []).filter(p => p?.name).map(p => ({
        name: p.name,
        pos: String(p.position_in_team || p.position || '').toUpperCase(),
        slot: String(p.position || '').toUpperCase(),
        nfl: p.nfl_team || '',
        pts: P(p.fantasy_points),
    }));
}

/**
 * Tutto quello che la schermata racconta di una giornata, dal punto di vista
 * di una squadra. Null se la squadra quella giornata non ha giocato (bye dei
 * playoff) o se la giornata non e' chiusa.
 *
 * @param data         fetchFantasyData(year)
 * @param displayName  la funzione di data.js (passata per non tirarsi dietro
 *                     Firebase nei test)
 */
export function esitoSettimana(data, year, week, teamKey, displayName) {
    const w = data?.weeks?.[String(week)];
    if (!giornataGiocata(w)) return null;
    let mia = null, opp = null;
    for (const m of w.matchups || []) {
        if (!m.team1 || !m.team2) continue;
        if (chiaveDi(displayName(m.team1.name)) === teamKey) { mia = m.team1; opp = m.team2; }
        else if (chiaveDi(displayName(m.team2.name)) === teamKey) { mia = m.team2; opp = m.team1; }
        if (mia) break;
    }
    if (!mia) return null;

    const lato = (t) => {
        const titolari = giocatori(t.starters).sort((a, b) => b.pts - a.pts);
        const panchina = giocatori(t.bench);
        return {
            nome: displayName(t.name),
            chiave: chiaveDi(displayName(t.name)),
            punti: P(t.score),
            titolari,
            panchina,
            puntiPanchina: +panchina.reduce((s, p) => s + p.pts, 0).toFixed(2),
            mvp: titolari[0] || null,
        };
    };
    const io = lato(mia), loro = lato(opp);
    const margine = +(io.punti - loro.punti).toFixed(2);
    const esito = margine > 0 ? 'win' : margine < 0 ? 'loss' : 'tie';

    // Record e posto: prima e dopo questa giornata (solo regular season).
    const c = getSeasonConfig(year);
    const regolare = week <= c.regularSeasonWeeks;
    let classifica = null;
    if (regolare) {
        const prima = classificaFino(data, year, week - 1, displayName);
        const dopo = classificaFino(data, year, week, displayName);
        classifica = {
            recordPrima: record(prima.tabella[io.nome]),
            recordDopo: record(dopo.tabella[io.nome]),
            postoPrima: week > 1 ? prima.ordine.indexOf(io.nome) + 1 : null,
            postoDopo: dopo.ordine.indexOf(io.nome) + 1,
            squadre: dopo.ordine.length,
        };
    }

    // Una riga da raccontare: chi ha vinto, di quanto, e il dettaglio che pesa.
    const tutti = (w.matchups || []).flatMap(m => [P(m.team1?.score), P(m.team2?.score)]);
    const migliore = Math.max(...tutti);
    const scarti = (w.matchups || []).map(m => Math.abs(P(m.team1?.score) - P(m.team2?.score)));
    const note = [];
    if (io.punti === migliore) note.push('Top score of the week');
    if (Math.abs(margine) === Math.min(...scarti) && scarti.length > 1) note.push('Closest game of the week');
    if (Math.abs(margine) < 5 && esito !== 'tie') note.push(esito === 'win' ? 'Won by a whisker' : 'Lost by a whisker');
    // La panchina che avrebbe ribaltato la partita: solo se il totale della
    // panchina supera lo scarto — e' una frase, non un calcolo di formazione.
    if (esito === 'loss' && io.puntiPanchina > Math.abs(margine)) {
        note.push(`${io.puntiPanchina.toFixed(1)} pts left on the bench`);
    }

    return {
        year: Number(year), week, etichetta: etichettaGiornata(year, week),
        esito, margine, io, loro, classifica, note,
        playoff: !regolare,
    };
}

/* ============================================================
   QUANDO APRIRLA — deciso senza rete, prima che la home disegni
   ============================================================ */

/**
 * Il segnalibro: l'ultima giornata gia' vista su questo dispositivo, e
 * l'ultima volta che si e' andati a controllare su Firebase.
 *
 * NON passa da `utils/storage.js`, per la stessa ragione del segnalibro del
 * Night Recap (`topina-recap-v1`): non e' una cache che si riscarica, e' lo
 * stato di chi guarda. Se sparisse, si rivedrebbe una giornata gia' vista.
 * Sono poche decine di byte.
 */
const CHIAVE = 'topina-esito-v1';

export function segnalibroEsito() {
    try {
        const s = JSON.parse(localStorage.getItem(CHIAVE) || 'null');
        return { visto: s?.visto || '', controllato: Number(s?.controllato) || 0 };
    } catch {
        return { visto: '', controllato: 0 };
    }
}
function scrivi(s) {
    try { localStorage.setItem(CHIAVE, JSON.stringify(s)); } catch { /* bloccato: si rivedra' */ }
}
export const chiaveGiornata = (year, week) => `${year}-${week}`;

/** Giornata vista: da qui in poi non si apre piu', fino alla prossima chiusa. */
export function segnaEsitoVisto(year, week) {
    scrivi({ visto: chiaveGiornata(year, week), controllato: Date.now() });
}
/** Si e' controllato e non c'era niente di nuovo (vedi `valeControllare`). */
export function segnaControllato() {
    const s = segnalibroEsito();
    scrivi({ ...s, controllato: Date.now() });
}
/** Il confronto fra due chiavi "anno-week". */
export function piuNuova(a, b) {
    const [ya, wa] = String(a || '0-0').split('-').map(Number);
    const [yb, wb] = String(b || '0-0').split('-').map(Number);
    return ya !== yb ? ya > yb : wa > wb;
}

/** Giorno della settimana a Roma: 0 domenica … 2 martedi', 3 mercoledi'. */
function giornoSettimanaRoma(d) {
    const nome = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Rome', weekday: 'short' }).format(d);
    return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(nome);
}
function oraRoma(d) {
    return Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Rome', hour: '2-digit', hour12: false }).format(d));
}

/**
 * Se vale la pena coprire la pagina e andare a vedere su Firebase — senza
 * rete, perche' la risposta serve prima che la home mostri il risultato.
 *
 * Una giornata si chiude su Firebase solo il martedi' (espn-live.yml, dalle
 * 05:20 italiane, spesso in ritardo di ore). Quindi:
 *  - il martedi' e il mercoledi' si controlla, ma al massimo una volta l'ora:
 *    se alle 8 il dato non c'e' ancora, alle 9 si riprova invece di
 *    aspettare la settimana dopo;
 *  - negli altri giorni si controlla solo se dall'ultimo controllo e'
 *    passato un martedi' mattina (es. il sito aperto per la prima volta di
 *    venerdi', dopo una settimana di assenza).
 * Prima delle 6 del martedi' no: la giornata non puo' essere ancora chiusa.
 */
export function valeControllare(ora = new Date()) {
    const s = segnalibroEsito();
    if (!s.controllato) return true;
    const g = giornoSettimanaRoma(ora);
    const martediDaOre = g === 2 && oraRoma(ora) >= 6;
    if (martediDaOre || g === 3) return ora.getTime() - s.controllato >= 60 * 60 * 1000;
    // Altri giorni: c'e' stato un martedi' (dalle 6) fra l'ultimo controllo e adesso?
    const giorni = Math.floor((ora.getTime() - s.controllato) / 86400000);
    if (giorni >= 7) return true;
    for (let k = 0; k <= giorni + 1; k++) {
        const d = new Date(ora.getTime() - k * 86400000);
        if (giornoSettimanaRoma(d) === 2 && d.getTime() > s.controllato) return true;
    }
    return false;
}

/**
 * La prima volta su un dispositivo (segnalibro vuoto) non si mostra una
 * giornata vecchia: solo se e' martedi' o mercoledi', cioe' se la giornata
 * chiusa e' ragionevolmente quella appena finita. Negli altri giorni si
 * segna come vista e basta — la schermata e' per il "com'e' andata", non un
 * archivio.
 */
export function primaVoltaMostrabile(ora = new Date()) {
    const g = giornoSettimanaRoma(ora);
    return g === 2 || g === 3;
}
