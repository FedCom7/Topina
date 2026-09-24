/**
 * Le preferenze di chi guarda: poche, piccole, e di questo browser soltanto.
 *
 * NON sono una cache e non passano da `utils/storage.js`: quella tiene dati
 * che si possono sempre riscaricare e che lo sfratto puo' buttare via. Qui
 * dentro c'e' una scelta dell'utente — la squadra del cuore — che se sparisse
 * andrebbe rifatta a mano. Stessa eccezione del tema, per lo stesso motivo, e
 * sono in tutto una manciata di byte.
 *
 * Chi cambia una preferenza emette un evento sulla finestra, cosi' una pagina
 * gia' aperta si adegua senza ricaricare.
 */

const CHIAVE_SQUADRA = 'topina-team';

/** La squadra del cuore (chiave: capi | lasers | oscurus | sommo), o null. */
export function squadraPreferita() {
    try {
        const v = localStorage.getItem(CHIAVE_SQUADRA);
        return v || null;
    } catch {
        return null;   // storage bloccato: si vive senza preferenze
    }
}

/** La imposta (null per toglierla) e avvisa chi e' gia' a schermo. */
export function impostaSquadraPreferita(chiave) {
    try {
        if (chiave) localStorage.setItem(CHIAVE_SQUADRA, chiave);
        else localStorage.removeItem(CHIAVE_SQUADRA);
    } catch { /* storage bloccato: vale per questa visita */ }
    window.dispatchEvent(new CustomEvent('topina:squadra', { detail: { chiave: chiave || null } }));
}
