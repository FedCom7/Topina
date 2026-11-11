/**
 * Game Day ha un'identita' sua quando la si aggiunge alla schermata Home.
 *
 * L'iPhone prende icona e nome dal `<head>` della pagina nel momento in cui si
 * crea il collegamento, e questo sito e' una pagina sola: senza cambiare il
 * `<head>` qui, anche Game Day diventerebbe un secondo "Topina" che si apre
 * sulla home. Il manifesto separato serve a riaprire proprio Game Day: la
 * query in `start_url` c'e' perche' un `id` calcolato ignorerebbe il `#`, e le
 * due app risulterebbero la stessa.
 *
 * Uscendo da Game Day si torna ai valori di index.html. L'icona (il tabellone
 * NE 3 - ATL 28) la disegna scripts/build-gameday-icon.mjs.
 */

const GAME_DAY = {
    icona: 'icons/gameday-180.png?v=2',
    manifesto: 'manifest-gameday.webmanifest?v=2',
    nome: 'Game Day',
};
let base = null;

export function identitaApp(gameDay) {
    const icona = document.querySelector('link[rel="apple-touch-icon"]');
    const manifesto = document.querySelector('link[rel="manifest"]');
    const nome = document.querySelector('meta[name="apple-mobile-web-app-title"]');
    if (!icona || !manifesto || !nome) return;
    base ||= { icona: icona.getAttribute('href'), manifesto: manifesto.getAttribute('href'), nome: nome.content };
    const v = gameDay ? GAME_DAY : base;
    if (icona.getAttribute('href') === v.icona) return;
    icona.setAttribute('href', v.icona);
    manifesto.setAttribute('href', v.manifesto);
    nome.content = v.nome;
}
