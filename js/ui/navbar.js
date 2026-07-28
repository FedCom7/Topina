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

import { buildPlayerIndex, teamResults, playerResults, resultRow } from '../data/player-search-core.js?v=1';

const MOBILE_MQ = '(max-width: 768px)';

export function initNavbar() {
    const navbar = document.querySelector('.navbar');
    if (!navbar) return;

    window.addEventListener('scroll', () => {
        navbar.classList.toggle('scrolled', window.scrollY > 50);
    });

    initDropdowns(navbar);
    initSearch(navbar);
}

/**
 * Lente di ricerca mobile: overlay a tutta pagina che cerca giocatori (storico
 * Topina) e squadre NFL, con la stessa logica della sezione Players. Lente e
 * menu hamburger sono mutuamente esclusivi: aprirne uno chiude l'altro.
 */
function initSearch(navbar) {
    const btn = document.getElementById('nav-search-btn');
    const box = document.getElementById('nav-search');
    const input = document.getElementById('nav-search-input');
    const results = document.getElementById('nav-search-results');
    if (!btn || !box || !input || !results) return;

    const navLinks = navbar.querySelector('.nav-links');

    const closeSearch = () => {
        box.classList.remove('open');
        btn.setAttribute('aria-expanded', 'false');
    };

    btn.addEventListener('click', () => {
        const willOpen = !box.classList.contains('open');
        // Aprendo la lente si chiude il menu (e viceversa: vedi hamburger)
        navbar.classList.remove('l2-open');
        navLinks?.classList.remove('open');
        box.classList.toggle('open', willOpen);
        btn.setAttribute('aria-expanded', String(willOpen));
        if (willOpen) input.focus();
    });

    // Aprendo il menu si chiude la lente
    document.getElementById('nav-hamburger')?.addEventListener('click', closeSearch);

    // Scelto un risultato si naviga (hash link) e si chiude tutto
    results.addEventListener('click', (e) => { if (e.target.closest('a')) closeSearch(); });

    const teamsGroup = (t) => t.length ? `<div class="ps-group"><h3 class="pp-cat-title">Squadre NFL</h3>${t.map(resultRow).join('')}</div>` : '';
    const playersGroup = (p) => p.length ? `<div class="ps-group"><h3 class="pp-cat-title">Giocatori</h3>${p.map(resultRow).join('')}</div>` : '';

    input.addEventListener('input', async () => {
        const q = input.value.trim();
        if (q.length < 2) {
            results.innerHTML = q.length
                ? '<p class="pm-empty">Scrivi almeno 2 caratteri.</p>'
                : '<p class="pm-empty">Inizia a scrivere per cercare — es. un nome, o "Chiefs".</p>';
            return;
        }
        // Le squadre sono un lookup statico: si mostrano subito, senza attendere
        // l'indice giocatori (buildPlayerIndex legge tutte le stagioni da Firebase).
        const teams = teamResults(q);
        results.innerHTML = teamsGroup(teams) || '<p class="pm-empty">Ricerca giocatori...</p>';

        const index = await buildPlayerIndex();
        if (input.value.trim() !== q) return; // l'utente ha già scritto altro
        const players = playerResults(q, index);
        if (!teams.length && !players.length) { results.innerHTML = '<p class="pm-empty">Nessun risultato.</p>'; return; }
        results.innerHTML = `${teamsGroup(teams)}${playersGroup(players)}`;
    });
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

    // Freccia "indietro" in alto a sinistra (speculare alla X): torna al livello 1
    document.getElementById('nav-back')?.addEventListener('click', backToLevel1);

    // La X (hamburger) chiude tutto il menu; il secondo livello non deve
    // restare "armato" per la prossima apertura.
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

/** Contenitore del secondo livello, creato una volta sola. Il controllo
 *  "indietro" vive nella barra in alto (#nav-back), non qui dentro. */
function buildLevel2(navbar) {
    const el = document.createElement('div');
    el.className = 'nav-l2';
    el.innerHTML = `<ul class="nav-l2-list"></ul>`;
    navbar.appendChild(el);

    return {
        el,
        list: el.querySelector('.nav-l2-list'),
    };
}

/** Riempie il secondo livello con le voci del pannello della categoria. */
function fillLevel2(level2, item, panel) {
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
