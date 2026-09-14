/**
 * L'orario di una partita NFL in ora ITALIANA.
 *
 * ESPN manda gia' pronta la stringa `shortDetail` — "8/28 - 6:00 PM EDT" — ma
 * e' l'ora della costa est americana, con l'orologio a dodici ore e il mese
 * prima del giorno. Chi guarda da qui deve fare due conti a mente per sapere
 * se la partita e' stanotte o domani mattina. Qui si riparte dall'istante vero
 * (la data ISO della risposta) e lo si scrive come lo scriviamo noi: giorno
 * prima del mese, orologio a ventiquattro ore, fuso di Roma — il passaggio
 * dall'ora legale lo gestisce il browser.
 *
 * Il giorno della settimana resta in inglese come il resto del sito.
 * Nato in live.js, spostato qui quando e' servito anche alla scheda giocatore.
 */
export function oraItaliana(d) {
    const q = d instanceof Date ? d : new Date(d);
    if (!d || Number.isNaN(q.getTime())) return '';
    const f = (opz) => new Intl.DateTimeFormat('en-GB',
        { timeZone: 'Europe/Rome', ...opz }).format(q);
    return `${f({ weekday: 'short' })} ${f({ day: '2-digit', month: '2-digit' })}` +
        ` · ${f({ hour: '2-digit', minute: '2-digit', hour12: false })}`;
}
