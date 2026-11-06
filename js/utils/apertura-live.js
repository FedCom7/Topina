/**
 * Aprendo l'app mentre si gioca, si finisce sul Live.
 *
 * Vale solo per l'APERTURA: indirizzo vuoto o `#home`, caricamento vero. Un
 * link diretto (`#stats`, una partita, un giocatore) porta dove dice; ricaricare
 * la pagina resta dov'e'; tornare su Home durante la partita, dal menu, e' una
 * scelta e non si tocca — quello e' un cambio di hash, qui non passa nemmeno.
 *
 * `boot()` aspetta la risposta PRIMA di disegnare la home, per non farla
 * lampeggiare: l'attesa e' quella di una richiesta, con il tetto di
 * `getPartiteOra` (1,5 s). Se ESPN non risponde si apre la home:
 * meglio la solita pagina che uno spinner, e niente salto al Live a pagina
 * gia' aperta.
 *
 * Fuori partita quell'attesa sarebbe un costo per niente, quindi si ricorda
 * quando vale la pena riguardare: il prossimo kickoff, ma mai oltre 12 ore —
 * una partita puo' essere spostata, e dopo il Monday Night ESPN non ha ancora
 * in tabellone la settimana nuova. Fino ad allora nessuna richiesta e nessuna
 * attesa: `controllaApertura` si decide senza rete.
 */

import { cacheGet, cacheSet } from './storage.js?v=19';
import { getPartiteOra } from '../data/nfl-schedule.js?v=557';
import { CURRENT_SEASON, getSeasonConfig } from '../data.js?v=597';

const CHIAVE = 'topina_apertura_v1';
const RIVEDI_ENTRO_MS = 12 * 60 * 60 * 1000;

/** Sincrona e senza rete: vale la pena chiedere a ESPN? */
export function controllaApertura() {
    if (location.hash && location.hash !== '#home') return false;
    // 'reload' e 'back_forward' non sono un'apertura
    const tipo = performance.getEntriesByType?.('navigation')?.[0]?.type;
    if (tipo && tipo !== 'navigate') return false;
    const nota = cacheGet(CHIAVE, Infinity);
    return !(nota?.rivedi > Date.now());
}

/**
 * Si sta giocando una partita della NOSTRA stagione? Conta qualunque partita
 * NFL in corso, non solo quelle dei nostri: e' il Live a dire chi gioca. Le
 * settimane oltre il Super Bowl della lega e i playoff NFL restano fuori: li'
 * il Live non ha sfide da mostrare.
 */
export async function siGiocaOra() {
    const ora = await getPartiteOra();
    if (!ora) return false;
    if (!ora.inCorso) {
        const adesso = Date.now();
        cacheSet(CHIAVE, { rivedi: Math.min(ora.prossimoKickoff ?? Infinity, adesso + RIVEDI_ENTRO_MS) });
        return false;
    }
    return ora.type === 2 && String(ora.year) === String(CURRENT_SEASON)
        && ora.week <= getSeasonConfig(ora.year).superBowlWeek;
}
