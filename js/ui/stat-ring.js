/**
 * Le statistiche scritte ATTORNO alla foto del giocatore, lungo il cerchio.
 *
 * Ogni carattere è un elemento a sé, ruotato di un passo fisso: il testo segue
 * la curva come su un timbro invece di stare dritto sotto la foto. Si parte
 * dalle "40 di orologio" (in basso a sinistra) e si prosegue in senso orario.
 * Il posizionamento vero lo fa il CSS (`.live-slot-stats--ring`), qui si
 * prepara solo la sequenza di caratteri col suo indice.
 *
 * Nato in `sections/live.js` per il campo del Live. Sta qui da quando lo usa
 * anche il Night Recap: è la stessa forma, e due copie divergono — basta
 * aggiungere una statistica di là e lo stesso giocatore si legge in due modi
 * diversi in due punti del sito.
 *
 * La firma prende `stats` e `role` invece di un giocatore: il Live deve poter
 * scegliere fra statistiche vere e proiettate (prima del kickoff quelle vere
 * sono tutte a zero), e quella scelta è roba sua — qui arriva già fatta.
 */

import { shortStatLabel } from '../data/stat-labels.js?v=1';

/**
 * Le statistiche mostrate, sempre SEI per ruolo: così tutti i cerchi hanno lo
 * stesso ingombro e i valori a zero diventano un trattino invece di far
 * ballare la lunghezza della scritta da un giocatore all'altro.
 */
export const STATS_BY_ROLE = {
    QB: ['pass_comp', 'pass_att', 'pass_yds', 'pass_td', 'pass_int', 'rush_yds'],
    RB: ['rush_att', 'rush_yds', 'rush_td', 'targets', 'rec', 'rec_yds'],
    WR: ['targets', 'rec', 'rec_yds', 'rec_td', 'rush_yds', 'rush_td'],
    TE: ['targets', 'rec', 'rec_yds', 'rec_td', 'rush_yds', 'rush_td'],
    K: ['pat_made', 'fg_made', 'fg_att', 'fg_0_39', 'fg_40_49', 'fg_50_plus'],
    DEF: ['sack', 'def_int', 'fum_rec', 'def_td', 'pts_allowed', 'yds_allowed'],
};

/** I ruoli del campo ricondotti ai sei elenchi qui sopra. */
export function ruoloCanonico(raw) {
    const r = String(raw || '').toUpperCase();
    if (r === 'W/R' || r === 'RB/WR' || r === 'FLEX') return 'WR';
    if (r === 'D/ST') return 'DEF';
    return r;
}

export function statValue(stats, key) {
    if (key === 'fg_made') {
        // I dati 2026+ forniscono già il totale; le fasce si sommano solo per
        // il vecchio schema NFL.com, che non aveva fg_made.
        if (stats.fg_made != null) return stats.fg_made;
        return ['fg_0_19', 'fg_20_29', 'fg_30_39', 'fg_0_39', 'fg_40_49', 'fg_50_plus']
            .reduce((s, k) => s + (stats[k] || 0), 0);
    }
    return stats[key] || 0;
}

/** Le sei voci di un ruolo: [{ valore, etichetta, zero }]. */
export function statVoci(stats, role) {
    const keys = STATS_BY_ROLE[ruoloCanonico(role)] || STATS_BY_ROLE.WR;
    const s = stats || {};
    return keys.map(k => {
        const raw = statValue(s, k);
        /*
         * Interi per i conteggi, un decimale per le frazioni piccole — e vale
         * per TUTTI i numeri, non solo per le proiezioni.
         *
         * Basta che una somma passi per un float e ne esce la coda binaria
         * (241.00000000000003). Sull'anello ogni carattere costa un pezzo di
         * circonferenza, quindi diciassette cifre si mangiavano il giro intero
         * e coprivano tutte le altre voci.
         */
        const v = Math.abs(raw) >= 10 ? Math.round(raw) : Math.round(raw * 10) / 10;
        return { valore: v === 0 ? '–' : String(v), etichetta: shortStatLabel(k), zero: v === 0 };
    });
}

const escAttr = (s) => String(s ?? '').replace(/[&<>"]/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/** Le voci come catena di caratteri lungo il cerchio. */
export function statRingHTML(stats, role) {
    const pezzi = [];
    statVoci(stats, role).forEach((v, i) => {
        // separatore senza spazi: ogni carattere costa un pezzo di
        // circonferenza, e tre caratteri per sei voci sarebbero mezzo giro
        if (i) pezzi.push({ testo: '·', classe: 'live-ring-sep' });
        pezzi.push({ testo: v.valore, classe: 'live-ring-num' + (v.zero ? ' live-stat--zero' : '') });
        pezzi.push({ testo: ' ' + v.etichetta, classe: 'live-ring-lbl' + (v.zero ? ' live-stat--zero' : '') });
    });

    let n = 0;
    return pezzi.map(({ testo, classe }) => [...testo].map(ch =>
        // lo spazio non si può disegnare: occupa il suo passo e basta
        `<i class="live-ring-ch ${classe}" style="--c:${n++}">${ch === ' ' ? '&nbsp;' : escAttr(ch)}</i>`
    ).join('')).join('');
}
