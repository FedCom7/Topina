/**
 * Auto-abbreviazione dei nomi squadra — attivo in tutto il sito.
 *
 * Ogni nome renderizzato con `teamNameHTML()` (js/data.js) è uno
 * `<span class="tname" data-abbr="...">Nome Completo</span>` con
 * `overflow:hidden; white-space:nowrap` (css/main.css). `refitTeamNames()`
 * confronta `scrollWidth` vs `clientWidth`: se il nome completo trabocca dalla
 * cella che lo contiene, mostra la sigla al suo posto.
 *
 * `startAutoAbbr()` (chiamato una volta dal router) installa un MutationObserver
 * sul body: ogni render di sezione — anche quelli asincroni dopo un fetch — fa
 * ripartire la misura. Un listener sul resize rimisura quando cambia la
 * larghezza. Così non serve cablare nulla nelle singole sezioni.
 */

export function refitTeamNames(root) {
    const scope = root || document.body;
    if (!scope || !scope.querySelectorAll) return;
    scope.querySelectorAll('.tname[data-abbr]').forEach((el) => {
        // Fuori dal layout (la sezione non attiva è `display:none`) non si
        // tocca NIENTE. Il controllo stava sotto al ripristino, e il
        // ripristino restava: passando a un'altra sezione i nomi tornavano
        // interi, e al ritorno nessuna mutazione faceva ripartire la misura —
        // la sigla non tornava più e il nome usciva tagliato dai puntini.
        if (!el.clientWidth) return;

        const full = el.dataset.tnFull || (el.dataset.tnFull = (el.textContent || '').trim());
        // Ripristina il nome completo per misurare il trabocco reale.
        if (el.textContent !== full) el.textContent = full;

        if (el.scrollWidth > el.clientWidth + 0.5) {
            el.textContent = el.dataset.abbr;
        }
    });
}

let _observer = null;
let _pending = false;

function _run() {
    _pending = false;
    // Ci auto-disconnettiamo: refit muta il textContent degli span e
    // rigenererebbe mutazioni → loop. Disconnesso durante la misura, poi riattacco.
    if (_observer) _observer.disconnect();
    refitTeamNames(document.body);
    if (_observer) _observer.observe(document.body, { childList: true, subtree: true });
}

function _schedule() {
    if (_pending) return;
    _pending = true;
    requestAnimationFrame(_run);
}

let _resizeT;
export function startAutoAbbr() {
    if (_observer) return; // già avviato
    _observer = new MutationObserver(_schedule);
    _observer.observe(document.body, { childList: true, subtree: true });
    refitTeamNames(document.body);

    window.addEventListener('resize', () => {
        clearTimeout(_resizeT);
        _resizeT = setTimeout(() => refitTeamNames(document.body), 120);
    });

    // I font veri (Inter / Inter Tight) si scaricano: il primo render misura
    // il RIPIEGO di sistema, che è più stretto. "Sommo" nel ripiego entrava
    // nei 52px del banner, col font vero ne chiede 63 — e senza questa
    // rimisura restava il nome intero tagliato dai puntini ("SOM…") invece
    // della sigla, che i tre caratteri ce li ha proprio per quel caso.
    document.fonts?.ready?.then(_schedule);
    document.fonts?.addEventListener?.('loadingdone', _schedule);
}
