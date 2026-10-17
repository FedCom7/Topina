/*
 * GHIERA — una fila di pastiglie che sul telefono diventa un rullo.
 *
 * Quando le voci non ci stanno in una riga andavano a capo su due (le tab
 * della vista squadra in Analysis, i ruoli di Player Stats): qui restano in
 * fila su una ghiera che si gira col dito, e la voce che si ferma in mezzo,
 * sotto la tacca, si apre. Le voci si piegano e sbiadiscono allontanandosi
 * dal centro (--d, --ad), come su un rullo vero.
 *
 * Markup: `<div class="ghiera"><div class="ghiera-riga">…bottoni…</div></div>`.
 * Il CSS (in main.css, sotto "GHIERA") decide QUANDO e' una ghiera: sotto i
 * 700px la riga non va a capo e scorre. Qui conta solo se la riga scorre
 * davvero: se ci sta tutta (desktop) il clic resta quello di sempre e la
 * ghiera non fa niente.
 *
 * Aprire una voce = cliccarla: chi usa la ghiera non cambia il suo
 * ascoltatore. Il clic "vero" (dito sulla voce) invece fa girare la ghiera
 * fino al centro, ed e' l'arrivo in mezzo ad aprirla — come quando si gira.
 * Il segno `data-dalla-ghiera` distingue i due.
 *
 * La riga va rimontata a ogni ridisegno: chi la usa riscrive l'HTML, e i
 * nodi nuovi non hanno gli ascoltatori.
 */
export function montaGhiera(riga, { voce = 'button', attiva = '.active' } = {}) {
    if (!riga || riga.dataset.ghieraPronta) return;
    riga.dataset.ghieraPronta = '1';
    const voci = [...riga.querySelectorAll(voce)];
    if (!voci.length) return;
    const gira = () => riga.scrollWidth > riga.clientWidth + 2;
    const centro = () => { const r = riga.getBoundingClientRect(); return r.left + r.width / 2; };
    const scarto = (b) => { const r = b.getBoundingClientRect(); return r.left + r.width / 2 - centro(); };
    const eAttiva = (b) => b.matches(attiva);

    function disegna() {
        const meta = riga.clientWidth / 2 || 1;
        let vicina = null, min = Infinity;
        for (const b of voci) {
            const d = Math.max(-1.6, Math.min(1.6, scarto(b) / meta));
            b.style.setProperty('--d', d.toFixed(3));
            b.style.setProperty('--ad', Math.abs(d).toFixed(3));
            if (Math.abs(d) < min) { min = Math.abs(d); vicina = b; }
        }
        voci.forEach(b => b.classList.toggle('is-centro', b === vicina));
        return vicina;
    }

    function apri(b) {
        b.dataset.dallaGhiera = '1';
        b.click();
    }

    // all'apertura la voce scelta sta gia' in mezzo, senza animazione
    const scelta = voci.find(eAttiva);
    if (scelta && gira()) riga.scrollLeft += scarto(scelta);
    disegna();

    let ferma = null;
    riga.addEventListener('scroll', () => {
        requestAnimationFrame(disegna);
        clearTimeout(ferma);
        ferma = setTimeout(() => {
            const b = disegna();
            if (!b || eAttiva(b) || !gira() || !riga.isConnected) return;
            apri(b);
        }, 170);
    }, { passive: true });

    riga.addEventListener('click', (e) => {
        const b = e.target.closest(voce);
        if (!b || !riga.contains(b) || !gira() || b.dataset.dallaGhiera) return;
        e.stopPropagation();
        // Gia' in mezzo: niente giro. Uno scorrimento di mezzo pixel non e'
        // innocuo — con lo snap obbligatorio Chrome lo legge come "vai alla
        // tacca dopo in quella direzione", e la ghiera scattava sulla voce
        // accanto. Per lo stesso motivo il giro va a una posizione assoluta
        // (scrollTo), non a uno scarto (scrollBy, che lo snap tratta come
        // direzionale).
        const d = scarto(b);
        if (Math.abs(d) < 6) {
            if (!eAttiva(b)) apri(b);
            return;
        }
        riga.scrollTo({ left: riga.scrollLeft + d, behavior: 'smooth' });
    });
}
