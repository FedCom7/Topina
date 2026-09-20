/**
 * Cambio sezione col dito, per le barre a tab del sito.
 *
 * Due pagine hanno la stessa forma — una barra di pill sticky e un pannello
 * per volta sotto — e sul telefono avevano lo stesso difetto: nove voci che
 * andavano a capo su tre righe (112px di altezza sulla pagina squadra NFL,
 * 79px su quella giocatore) e nessun modo di passare da una sezione all'altra
 * se non tornando su a premere la pill giusta. Ora la barra è una riga sola
 * che scorre e il pannello si cambia scorrendo in orizzontale.
 *
 * Sta qui e non nelle due sezioni perché il gesto è delicato in un punto — il
 * riconoscimento di cosa NON è uno scorrimento di pagina — e due copie di quel
 * pezzo divergono al primo ritocco. Contratto come gli altri moduli di
 * `js/ui/`: entrano nodi e una funzione, esce il comportamento.
 */

/** Uno scorrimento sotto questa soglia (px) è un tremolio del dito, non un gesto. */
const MIN_DX = 56;
/** Quanto più orizzontale che verticale deve essere, per non rubare lo scroll. */
const RATIO = 1.6;
/** Oltre questo tempo (ms) non è più una sfogliata: è un dito appoggiato. */
const MAX_MS = 800;

/**
 * Il gesto è di qualcun altro? Allora giù le mani.
 *
 * Due casi, e si riconoscono entrambi dal CSS invece che da un elenco di
 * classi da tenere aggiornato:
 *
 *  1. **Un antenato scorre di lato.** Dentro questi pannelli ci sono tabelle
 *     larghe, caroselli e la barra delle sezioni stessa: là il dito serve a
 *     loro, e cambiare sezione mentre si scorre una tabella sarebbe la cosa
 *     più fastidiosa del sito. `overflow-x` dichiarato non basta — un `auto`
 *     su un contenuto che ci sta dentro non scorre affatto — quindi si guarda
 *     anche la misura vera.
 *  2. **Un antenato si è prenotato l'orizzontale** con `touch-action`. È il
 *     modo standard di dire "i gesti di lato li gestisco io": il grafico della
 *     win probability nella scheda giocatore (`.pp-wp`) sta a `pan-y` proprio
 *     perché il dito lo scorre per leggere i minuti. Senza questo controllo,
 *     scorrere quel grafico cambiava tab.
 */
function gestoAltrui(nodo, limite) {
    for (let el = nodo; el && el !== limite; el = el.parentElement) {
        if (!(el instanceof Element)) continue;
        const st = getComputedStyle(el);
        const ox = st.overflowX;
        if ((ox === 'auto' || ox === 'scroll') && el.scrollWidth > el.clientWidth + 2) return true;
        const ta = st.touchAction;
        if (ta === 'none' || (ta.includes('pan-y') && !ta.includes('pan-x'))) return true;
    }
    return false;
}

/**
 * Scorrendo dentro `area` si va alla sezione precedente o successiva.
 *
 * @param {Element} area   il contenitore dei pannelli
 * @param {(dir: 1|-1) => void} vai  +1 = sezione dopo (dito verso sinistra)
 */
export function bindTabSwipe(area, vai) {
    if (!area || typeof vai !== 'function') return;
    let x0 = 0, y0 = 0, t0 = 0, x = 0, y = 0, valido = false;

    // Tutti passivi: il gesto si RICONOSCE, non si intercetta. Senza
    // preventDefault lo scorrimento verticale della pagina resta quello del
    // browser, e un gesto obliquo continua a scorrere come prima.
    area.addEventListener('touchstart', (e) => {
        if (e.touches.length !== 1) { valido = false; return; }
        const t = e.touches[0];
        x0 = x = t.clientX; y0 = y = t.clientY; t0 = Date.now();
        valido = !gestoAltrui(e.target, area);
    }, { passive: true });

    area.addEventListener('touchmove', (e) => {
        if (!valido || e.touches.length !== 1) return;
        x = e.touches[0].clientX;
        y = e.touches[0].clientY;
    }, { passive: true });

    area.addEventListener('touchend', () => {
        if (!valido) return;
        valido = false;
        const dx = x - x0, dy = y - y0;
        if (Date.now() - t0 > MAX_MS) return;
        if (Math.abs(dx) < MIN_DX || Math.abs(dx) < Math.abs(dy) * RATIO) return;
        vai(dx < 0 ? 1 : -1);
    }, { passive: true });
}

/**
 * Porta la pill attiva al centro della barra che scorre.
 *
 * Si sposta `scrollLeft` a mano invece di usare `scrollIntoView()`: quello
 * muove anche la pagina in verticale, e su una barra sticky vuol dire un salto
 * a ogni cambio di sezione.
 */
export function centerActiveTab(bar, btn) {
    if (!bar || !btn || bar.scrollWidth <= bar.clientWidth + 2) return;
    const left = btn.offsetLeft - (bar.clientWidth - btn.offsetWidth) / 2;
    bar.scrollTo({ left: Math.max(0, left), behavior: 'smooth' });
}

/**
 * La voce prima o dopo quella attiva, saltando quelle nascoste (la scheda
 * giocatore spegne i tab senza dati) e fermandosi ai capi: un gesto oltre
 * l'ultima sezione non riporta alla prima, perché una lista che gira su se
 * stessa fa perdere il conto di dove si è.
 */
export function nextTab(btns, attivo, dir) {
    const vive = btns.filter(b => !b.hidden && b.offsetParent !== null);
    const i = vive.indexOf(attivo);
    if (i < 0) return null;
    return vive[i + dir] || null;
}
