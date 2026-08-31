/**
 * Motion — animazioni del mosaico della home.
 *
 * Quattro cose, con una regola sola: si animano solo `transform` e `opacity`,
 * mai proprietà che facciano rifare il layout a ogni frame.
 *
 *   revealOnScroll() — un IntersectionObserver per tutta la pagina, con
 *                      sfalsamento fra le card che entrano INSIEME
 *   countUp()        — conteggio dei numeri grandi (stesso contratto di
 *                      attributi già in uso in sections/team.js: data-count,
 *                      data-decimals, data-suffix)
 *   parallax()       — un solo listener di scroll per tutti i [data-depth]
 *   spotlight()      — la luce che segue il puntatore sulla card sotto il mouse
 *
 * `prefers-reduced-motion` non rallenta le animazioni: le toglie. Chi lo
 * attiva vede subito lo stato finale, senza observer e senza listener.
 */

export function prefersReduced() {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Sotto questa soglia parallax e spotlight restano spenti: costano e rendono poco. */
export function isDesktop() {
    return window.matchMedia('(min-width: 769px)').matches;
}

/**
 * Rivela gli elementi che entrano nel viewport aggiungendo `.mc-in`.
 *
 * Lo sfalsamento è calcolato sul GRUPPO che entra nello stesso callback, non
 * sull'indice nella pagina: due card affiancate partono a 90ms l'una dall'
 * altra, ma una card raggiunta da sola dopo mezzo scroll parte subito. Con un
 * `--i` fisso assegnato al render, l'ultima card della pagina si sarebbe
 * portata dietro mezzo secondo di ritardo per sempre.
 */
export function revealOnScroll(root, { selector = '.mosaic-card, .mc-rail', onReveal } = {}) {
    const els = [...root.querySelectorAll(selector)];
    if (!els.length) return;

    if (prefersReduced() || !('IntersectionObserver' in window)) {
        els.forEach(el => { el.classList.add('mc-in'); onReveal?.(el); });
        return;
    }

    const io = new IntersectionObserver((entries) => {
        entries.filter(e => e.isIntersecting).forEach((e, i) => {
            e.target.style.setProperty('--i', i);
            e.target.classList.add('mc-in');
            io.unobserve(e.target);
            onReveal?.(e.target);
        });
    }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });

    els.forEach(el => io.observe(el));
}

/**
 * Conta da 0 al valore in `data-count`. Con reduced-motion scrive il numero e
 * basta: anche un conteggio è movimento.
 */
export function countUp(el, ms = 1000) {
    const target = parseFloat(el.dataset.count);
    if (!Number.isFinite(target)) return;
    const decimals = parseInt(el.dataset.decimals, 10) || 0;
    const suffix = el.dataset.suffix || '';
    const fmt = (v) => v.toLocaleString('it-IT', {
        minimumFractionDigits: decimals, maximumFractionDigits: decimals,
    }) + suffix;

    if (prefersReduced()) { el.textContent = fmt(target); return; }

    const t0 = performance.now();
    const step = (now) => {
        const p = Math.min(1, (now - t0) / ms);
        el.textContent = fmt(target * (1 - Math.pow(1 - p, 3)));
        if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
}

/** Fa partire i contatori dentro `el`, una volta sola ciascuno. */
export function countUpWithin(el, ms) {
    el.querySelectorAll('[data-count]:not([data-counted])').forEach(n => {
        n.dataset.counted = '1';
        countUp(n, ms);
    });
}

/** Rifà partire i contatori (usato quando una card cambia i propri numeri). */
export function recountWithin(el, ms) {
    el.querySelectorAll('[data-count]').forEach(n => {
        n.dataset.counted = '1';
        countUp(n, ms);
    });
}

/**
 * Parallax leggero sugli elementi [data-depth]: un solo listener di scroll,
 * throttlato a un frame.
 *
 * `isActive()` evita di lavorare quando la home non è la sezione a schermo: la
 * home si renderizza una volta sola e il listener resterebbe vivo per tutta la
 * sessione, anche navigando altrove.
 */
export function parallax(root, { isActive = () => true } = {}) {
    if (prefersReduced() || !isDesktop()) return () => { };
    const els = [...root.querySelectorAll('[data-depth]')];
    if (!els.length) return () => { };

    let ticking = false;
    const update = () => {
        ticking = false;
        if (!isActive()) return;
        const vh = window.innerHeight;
        els.forEach(el => {
            const host = el.closest('.mosaic-card') || el;
            const r = host.getBoundingClientRect();
            if (r.bottom < -100 || r.top > vh + 100) return;
            const p = (r.top + r.height / 2 - vh / 2) / vh;
            el.style.transform = `translate3d(0, ${(-p * parseFloat(el.dataset.depth) * 120).toFixed(1)}px, 0)`;
        });
    };
    const onScroll = () => {
        if (ticking) return;
        ticking = true;
        requestAnimationFrame(update);
    };

    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
}

/**
 * Luce morbida che segue il puntatore sulla card sotto il mouse.
 *
 * Un solo listener delegato su tutta la griglia, e le coordinate finiscono in
 * due variabili CSS (--mx/--my) lette da un ::after: nessun elemento nuovo,
 * nessuna misura di layout per frame oltre al rect della card puntata.
 */
export function spotlight(root) {
    if (prefersReduced() || !isDesktop()) return () => { };
    let raf = 0, last = null;

    const onMove = (e) => {
        const card = e.target.closest?.('.mosaic-card, .mc-rail-card');
        if (card !== last) {
            last?.style.removeProperty('--mx');
            last?.style.removeProperty('--my');
            last?.classList.remove('mc-lit');
            last = card;
            card?.classList.add('mc-lit');
        }
        if (!card || raf) return;
        raf = requestAnimationFrame(() => {
            raf = 0;
            const r = card.getBoundingClientRect();
            card.style.setProperty('--mx', `${((e.clientX - r.left) / r.width * 100).toFixed(1)}%`);
            card.style.setProperty('--my', `${((e.clientY - r.top) / r.height * 100).toFixed(1)}%`);
        });
    };
    const onLeave = () => {
        last?.classList.remove('mc-lit');
        last = null;
    };

    root.addEventListener('pointermove', onMove, { passive: true });
    root.addEventListener('pointerleave', onLeave, { passive: true });
    return () => {
        root.removeEventListener('pointermove', onMove);
        root.removeEventListener('pointerleave', onLeave);
    };
}
