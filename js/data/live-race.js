/**
 * La race di una sfida del Live: i punti delle due squadre, giocata per
 * giocata, dal primo kickoff della settimana a adesso.
 *
 * Si ricostruisce dal play-by-play che il Live scarica gia' per le card delle
 * giocate, non da quello che la pagina ha visto mentre era aperta: registrare i
 * punteggi a ogni polling avrebbe dato la race solo da quando la si apre (chi
 * arriva la domenica sera vedrebbe una riga piatta e un salto), e a ogni
 * ricarica sarebbe ripartita da zero. Il play-by-play invece ha tutte le
 * giocate con l'orario, e `scorePlay` sa quanti punti vale ognuna e a chi.
 *
 * Il ricalcolo per giocata pero' non e' il punteggio ufficiale: i punti
 * concessi da una difesa si assegnano a fine partita, qualche tipo di giocata
 * raro manca, e ogni tanto ESPN rettifica una statistica. Percio' per ogni
 * titolare lo SCARTO fra ufficiale e ricostruito entra nel grafico come un
 * passo a se', alla fine della sua partita (o all'ultima giocata, se e' ancora
 * in corso): la linea finisce esattamente sul numero del tabellone, e lo
 * scarto resta riconoscibile invece di sparire spalmato sulle giocate.
 *
 * Conti puri: niente DOM, niente rete. Il Live gli passa le giocate, le due
 * formazioni e due funzioni per sapere di chi e' una giocata e dove finisce la
 * partita di un giocatore.
 */

import { scorePlay } from './scoring.js?v=592';

/** Sotto questa soglia lo scarto e' arrotondamento, non una giocata mancante. */
const SOGLIA_SCARTO = 0.05;

/**
 * @param {Array}    giocate  tutte le giocate note della settimana, con `ts` ed `eventId`
 * @param {Array}    lati     [{ nome, titolari: [{ name, fantasy_points, ... }] }] × 2
 * @param {Function} chiE     (contributo di scorePlay) → { name, team } | null
 * @param {Function} fineDi   (titolare) → { ts, eventId } | null — dove va il suo scarto
 * @returns {{ eventi: Array, finali: number[] }}
 *   eventi: [{ ts, eventId, lato, pts, chi, testo, scarto }] in ordine di tempo
 */
export function costruisciRace(giocate, lati, chiE, fineDi) {
    const nomi = lati.map(l => l.nome);
    const titolari = lati.map(l => new Set((l.titolari || []).map(p => p.name)));
    const fatti = lati.map(() => new Map());   // giocatore → punti dalle giocate
    const eventi = [];

    const ordinate = [...giocate].sort((a, b) => (a.ts - b.ts) || ((a.seq || 0) - (b.seq || 0)));
    for (const g of ordinate) {
        for (const c of scorePlay(g)) {
            if (!c.pts) continue;
            const chi = chiE(c);
            if (!chi) continue;
            const lato = nomi.indexOf(chi.team);
            // solo i TITOLARI fanno il punteggio della sfida: la panchina gioca
            // ma non conta
            if (lato < 0 || !titolari[lato].has(chi.name)) continue;
            fatti[lato].set(chi.name, (fatti[lato].get(chi.name) || 0) + c.pts);
            eventi.push({
                ts: g.ts, eventId: g.eventId, lato, pts: c.pts,
                chi: chi.name, testo: c.line || g.type || '', scarto: false,
                // touchdown: lanciato, ricevuto, su corsa, su ritorno o della
                // difesa — scorePlay lo segna nelle statistiche della giocata
                td: Object.entries(c.stats || {}).some(([k, v]) => /_td$/.test(k) && v > 0),
            });
        }
    }

    lati.forEach((l, lato) => {
        for (const p of l.titolari || []) {
            const ufficiale = parseFloat(p.fantasy_points) || 0;
            const scarto = +(ufficiale - (fatti[lato].get(p.name) || 0)).toFixed(2);
            if (Math.abs(scarto) < SOGLIA_SCARTO) continue;
            const dove = fineDi(p);
            if (!dove) continue;
            eventi.push({
                ts: dove.ts, eventId: dove.eventId, lato, pts: scarto,
                chi: p.name, testo: 'settled with the official total', scarto: true,
            });
        }
    });

    eventi.sort((a, b) => a.ts - b.ts);
    const finali = lati.map(l => (l.titolari || []).reduce((s, p) => s + (parseFloat(p.fantasy_points) || 0), 0));
    return { eventi, finali };
}

/**
 * I blocchi di tempo in cui si gioca: l'unione delle finestre delle partite.
 * Serve a comprimere l'asse come in "Point by point" (Game Center): fra il
 * giovedi' sera e la domenica non segna nessuno, e su un asse a tempo reale
 * quella pausa si prendeva quasi tutta la larghezza.
 *
 * `finestre`: [{ a, b }] in millisecondi. Ritorna la funzione `vivo(ts)`: il
 * tempo di gioco accumulato fino a `ts` — dentro una pausa non avanza.
 */
export function asseVivo(finestre, margine = 10 * 60 * 1000) {
    const blocchi = [];
    for (const f of [...finestre].sort((x, y) => x.a - y.a)) {
        const a = f.a - margine, b = f.b + margine;
        const ultimo = blocchi[blocchi.length - 1];
        if (ultimo && a <= ultimo.b) ultimo.b = Math.max(ultimo.b, b);
        else blocchi.push({ a, b });
    }
    const vivo = (t) => {
        let acc = 0;
        for (const x of blocchi) {
            if (t <= x.a) break;
            acc += Math.min(t, x.b) - x.a;
            if (t <= x.b) break;
        }
        return acc;
    };
    return { vivo, blocchi };
}
