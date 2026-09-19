/**
 * Da hash a sezione: l'unico posto in cui e' scritto quale `#...` accende
 * quale `<section class="page-section">`.
 *
 * Esiste perche' la mappa serve in DUE momenti diversi. Il primo e' il
 * caricamento a pagina piena in `index.html`, che gira prima di tutto e deve
 * gia' sapere quale sezione mostrare: senza, resta acceso `#home` — che
 * nell'HTML nasce `active` — e per mezzo secondo si vede il "Loading..." della
 * home anche quando si sta aprendo tutt'altro. Il secondo e' `js/app.js`, che
 * rifa la stessa cosa a ogni cambio di hash.
 * Due copie di questa mappa divergerebbero al primo indirizzo nuovo, e il
 * sintomo sarebbe proprio quello che si voleva togliere.
 */

/* Gli indirizzi con un parametro dentro (#team-capi, #nfl-team/BUF, ...) non
   si chiamano come la loro sezione. La corrispondenza NON sta qui: la dichiara
   ogni `<section>` con `data-route`, e la legge anche lo script immediato in
   index.html. Scritta in due posti divergerebbe al primo indirizzo nuovo, e il
   sintomo sarebbe proprio il doppio caricamento che si voleva togliere.
   `team-` prende `#team-capi` ma NON `#teams`, che e' un'altra cosa. */

/** L'id della `<section>` da accendere per un hash. Ripiega su `home`. */
export function sectionIdFor(hash) {
    const h = String(hash || '').replace(/^#/, '') || 'home';
    for (const s of document.querySelectorAll('.page-section[data-route]')) {
        if (h.startsWith(s.dataset.route)) return s.id;
    }
    const el = document.getElementById(h);
    return el && el.classList.contains('page-section') ? h : 'home';
}

/** Accende quella sezione e spegne le altre. */
export function activateSection(id) {
    for (const s of document.querySelectorAll('.page-section')) {
        s.classList.toggle('active', s.id === id);
    }
}
