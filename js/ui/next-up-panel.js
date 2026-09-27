/**
 * La linguetta sul bordo destro dello schermo e il pannello che ne esce.
 *
 * Solo il contenitore: cosa ci va dentro lo decide chi lo usa (il Live, con
 * `aggiornaPannello`). Linguetta e pannello stanno su `body` e non dentro la
 * pagina: il Live si ridisegna a ogni polling, e con lui sparirebbero a
 * pannello aperto.
 *
 * Si chiude in quattro modi, perche' ognuno ha il suo: la X, un tocco sul velo
 * fuori dal pannello, Esc, e trascinandolo verso destra col dito — lo stesso
 * gesto con cui e' entrato.
 */

let tab = null, velo = null, pannello = null, corpo = null;
let aperto = false;

function monta() {
    if (tab) return;
    tab = document.createElement('button');
    tab.type = 'button';
    tab.className = 'nu-tab';
    tab.setAttribute('aria-haspopup', 'dialog');
    tab.innerHTML = '<span class="nu-tab-txt">Next up</span><span class="nu-tab-badge" hidden></span>';
    tab.addEventListener('click', () => apri());

    velo = document.createElement('div');
    velo.className = 'nu-velo';
    velo.addEventListener('click', () => chiudi());

    pannello = document.createElement('aside');
    pannello.className = 'nu-panel';
    pannello.setAttribute('role', 'dialog');
    pannello.setAttribute('aria-label', 'Next up');
    pannello.setAttribute('aria-hidden', 'true');
    pannello.innerHTML = `
        <div class="nu-bar">
            <span class="nu-kicker">Next up</span>
            <button type="button" class="nu-close" aria-label="Close">✕</button>
        </div>
        <div class="nu-body"></div>`;
    corpo = pannello.querySelector('.nu-body');
    pannello.querySelector('.nu-close').addEventListener('click', () => chiudi());

    document.body.append(tab, velo, pannello);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && aperto) chiudi(); });
    trascina();
}

/**
 * Col dito il pannello segue il trascinamento verso destra; lasciato oltre un
 * quarto della sua larghezza si chiude, se no torna al suo posto. Solo in
 * orizzontale: uno scorrimento verticale e' la lista che scorre, non un addio.
 */
function trascina() {
    let x0 = null, y0 = null, dx = 0, orizzontale = null;
    pannello.addEventListener('touchstart', (e) => {
        const t = e.touches[0];
        x0 = t.clientX; y0 = t.clientY; dx = 0; orizzontale = null;
    }, { passive: true });
    pannello.addEventListener('touchmove', (e) => {
        if (x0 == null) return;
        const t = e.touches[0];
        const mx = t.clientX - x0, my = t.clientY - y0;
        if (orizzontale == null && (Math.abs(mx) > 8 || Math.abs(my) > 8)) orizzontale = Math.abs(mx) > Math.abs(my);
        if (!orizzontale) return;
        dx = Math.max(0, mx);
        pannello.style.transition = 'none';
        pannello.style.transform = `translateX(${dx}px)`;
    }, { passive: true });
    pannello.addEventListener('touchend', () => {
        if (x0 == null) return;
        pannello.style.transition = '';
        pannello.style.transform = '';
        if (orizzontale && dx > pannello.offsetWidth * 0.25) chiudi();
        x0 = null;
    });
}

export function apri() {
    if (!pannello) return;
    aperto = true;
    document.body.classList.add('nu-open');
    pannello.setAttribute('aria-hidden', 'false');
    pannello.querySelector('.nu-close')?.focus({ preventScroll: true });
}

export function chiudi() {
    if (!pannello || !aperto) return;
    aperto = false;
    document.body.classList.remove('nu-open');
    pannello.setAttribute('aria-hidden', 'true');
}

/**
 * @param {object} o
 *   visibile  la linguetta si vede? (fuori dal Live, o senza partite da giocare, no)
 *   html      il contenuto del pannello
 *   badge     { n, livello: 'fix'|'check' } — il pallino sulla linguetta
 *   dopo      (corpo) → chiamata dopo aver scritto il contenuto (foto da caricare)
 */
export function aggiornaPannello({ visibile, html = '', badge = null, dopo = null }) {
    monta();
    tab.hidden = !visibile;
    if (!visibile) { chiudi(); return; }
    const b = tab.querySelector('.nu-tab-badge');
    b.hidden = !badge?.n;
    if (badge?.n) {
        b.textContent = String(badge.n);
        b.className = `nu-tab-badge nu-tab-badge--${badge.livello}`;
    }
    // la posizione della lista resta dov'era: riscriverla ad ogni polling non
    // deve riportare in cima chi sta leggendo in fondo
    const scroll = corpo.scrollTop;
    corpo.innerHTML = html;
    corpo.scrollTop = scroll;
    if (dopo) dopo(corpo);
}
