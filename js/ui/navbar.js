/**
 * Navbar Module
 * Scroll-based styling + dropdown.
 *
 * Desktop: i pannelli si aprono in hover (con timer di grazia).
 * Mobile: l'hover non esiste e i pannelli sono nascosti dal CSS, quindi le
 * voci figlie (Magazine, Playoff Picture, Draft Grades, Honors, All-Pro,
 * Hall of Fame, pagine team) sarebbero irraggiungibili. Qui il menu diventa
 * un drill-down a due livelli: tap su una categoria → il secondo livello
 * prende il posto del primo, con "Indietro" per tornare.
 */

const MOBILE_MQ = '(max-width: 768px)';

export function initNavbar() {
    const navbar = document.querySelector('.navbar');
    if (!navbar) return;

    window.addEventListener('scroll', () => {
        navbar.classList.toggle('scrolled', window.scrollY > 50);
    });

    initDropdowns(navbar);
}

function initDropdowns(navbar) {
    const mq = window.matchMedia(MOBILE_MQ);
    const navLinks = navbar.querySelector('.nav-links');
    const level2 = buildLevel2(navbar);

    const closeMenu = () => {
        navbar.classList.remove('l2-open');
        navLinks?.classList.remove('open');
    };
    const backToLevel1 = () => navbar.classList.remove('l2-open');

    level2.back.addEventListener('click', backToLevel1);

    // Chiusa la tendina, il secondo livello non deve restare "armato"
    document.getElementById('nav-hamburger')?.addEventListener('click', backToLevel1);

    // Scelta una voce del secondo livello: si naviga e si chiude tutto
    level2.list.addEventListener('click', (e) => {
        if (e.target.closest('a')) closeMenu();
    });

    // Tornando a schermo largo, il drill-down non ha più senso
    mq.addEventListener('change', (e) => { if (!e.matches) closeMenu(); });

    navbar.querySelectorAll('.nav-item.has-dropdown').forEach(item => {
        const panelName = item.dataset.dropdown;
        const panel = navbar.querySelector(`[data-panel="${panelName}"]`);
        if (!panel) return;

        // ── Desktop: hover ──
        let closeTimer = null;

        const open = () => {
            clearTimeout(closeTimer);
            navbar.classList.add('dropdown-active');
            panel.classList.add('panel-active');
        };

        const scheduleClose = () => {
            closeTimer = setTimeout(() => {
                navbar.classList.remove('dropdown-active');
                panel.classList.remove('panel-active');
            }, 150); // 150ms di grazia per spostarsi sul panel
        };

        item.addEventListener('mouseenter', open);
        item.addEventListener('mouseleave', scheduleClose);
        panel.addEventListener('mouseenter', open);
        panel.addEventListener('mouseleave', scheduleClose);

        // ── Mobile: apre il secondo livello invece di navigare ──
        item.querySelector('.nav-link')?.addEventListener('click', (e) => {
            if (!mq.matches) return; // desktop: il link naviga normalmente
            e.preventDefault();
            fillLevel2(level2, item, panel);
            navbar.classList.add('l2-open');
        });
    });
}

/** Contenitore del secondo livello, creato una volta sola. */
function buildLevel2(navbar) {
    const el = document.createElement('div');
    el.className = 'nav-l2';
    el.innerHTML = `
        <button class="nav-l2-back" type="button">
            <span class="nav-l2-back-icon" aria-hidden="true">‹</span>
            <span class="nav-l2-back-label">Indietro</span>
        </button>
        <span class="nav-l2-title"></span>
        <ul class="nav-l2-list"></ul>`;
    navbar.appendChild(el);

    return {
        el,
        back: el.querySelector('.nav-l2-back'),
        title: el.querySelector('.nav-l2-title'),
        list: el.querySelector('.nav-l2-list'),
    };
}

/** Riempie il secondo livello con le voci del pannello della categoria. */
function fillLevel2(level2, item, panel) {
    level2.title.textContent = item.querySelector('.nav-link')?.textContent.trim() || '';
    level2.list.replaceChildren();

    panel.querySelectorAll('.nav-dp-item').forEach(a => {
        const li = document.createElement('li');
        const link = document.createElement('a');
        link.href = a.getAttribute('href');
        link.textContent = a.textContent.trim();
        link.className = 'nav-l2-link'
            + (a.classList.contains('nav-dp-header') ? ' nav-l2-link--header' : '');
        if (a.dataset.section) link.dataset.section = a.dataset.section;
        li.appendChild(link);
        level2.list.appendChild(li);
    });

    level2.el.scrollTop = 0;
}
