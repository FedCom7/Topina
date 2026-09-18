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

import { buildPlayerIndex, teamResults, playerResults, resultRow, teamLogoUrl, esc } from '../data/player-search-core.js?v=623';
import { NFL_TEAMS } from '../data/nfl-teams.js?v=513';

const MOBILE_MQ = '(max-width: 768px)';

export function initNavbar() {
    const navbar = document.querySelector('.navbar');
    if (!navbar) return;

    window.addEventListener('scroll', () => {
        navbar.classList.toggle('scrolled', window.scrollY > 50);
    });

    numeraVoci(navbar);
    initDropdowns(navbar);
    initSearch(navbar);
    initTheme();
}

/**
 * Tema chiaro / scuro.
 *
 * Lo stato vive in un posto solo: `data-theme="light"` sulla radice. Il CSS
 * ridefinisce le variabili di colore sotto quel selettore, e tutto cio' che
 * passa dalle variabili cambia da se'. Lo scuro resta il tema di partenza.
 *
 * La prima applicazione non avviene qui ma in uno script in testa a
 * index.html, prima del CSS: aspettare questo modulo farebbe comparire il
 * nero per un attimo a chi ha scelto il chiaro. Qui si aggancia solo il
 * bottone, e si salva la scelta.
 */
function initTheme() {
    const btn = document.getElementById('nav-theme-btn');
    if (!btn) return;
    const root = document.documentElement;

    const sync = () => {
        const chiaro = root.dataset.theme === 'light';
        btn.setAttribute('aria-pressed', String(chiaro));
        btn.setAttribute('aria-label', chiaro ? 'Switch to dark theme' : 'Switch to light theme');
    };

    btn.addEventListener('click', () => {
        const chiaro = root.dataset.theme !== 'light';
        if (chiaro) root.dataset.theme = 'light';
        else delete root.dataset.theme;
        // Una preferenza di pochi byte, non una cache: niente cacheSet.
        try { localStorage.setItem('topina-theme', chiaro ? 'light' : 'dark'); } catch { /* storage bloccato: vale per la visita */ }
        sync();
        // Chi disegna colori da JS (grafici, campo) puo' ridisegnarsi.
        window.dispatchEvent(new CustomEvent('topina:theme', { detail: { theme: chiaro ? 'light' : 'dark' } }));
    });
    sync();
}

/**
 * Numera le voci del menu per la cascata mobile.
 *
 * I ritardi stavano scritti a mano in CSS, una regola `nth-child` per voce e
 * una per il verso opposto alla chiusura. Si fermavano a nove: aggiungendo
 * "Season" le voci sono diventate dieci, e History — l'unica senza regola —
 * compariva di colpo insieme alla prima invece che per ultima. Un bug che si
 * ripresenta a ogni voce nuova, e che non da' nessun segnale a chi la aggiunge.
 *
 * Qui l'indice lo mette il DOM: `--i` conta dall'alto, `--i-giu` dal basso, e
 * il CSS li moltiplica per il passo. Aggiungere o togliere una voce non
 * richiede piu' di toccare niente.
 */
function numeraVoci(navbar) {
    const voci = navbar.querySelectorAll('.nav-links > .nav-item');
    voci.forEach((li, i) => {
        li.style.setProperty('--i', i + 1);
        li.style.setProperty('--i-giu', voci.length - i);
    });
}

/**
 * Lente di ricerca mobile: overlay a tutta pagina che cerca giocatori (storico
 * Topina) e squadre NFL, con la stessa logica della sezione NFL Hub. Lente e
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

    const teamsGroup = (t) => t.length ? `<div class="ps-group"><h3 class="pp-cat-title">NFL Teams</h3>${t.map(resultRow).join('')}</div>` : '';
    const playersGroup = (p) => p.length ? `<div class="ps-group"><h3 class="pp-cat-title">Players</h3>${p.map(resultRow).join('')}</div>` : '';

    input.addEventListener('input', async () => {
        const q = input.value.trim();
        if (q.length < 2) {
            results.innerHTML = q.length
                ? '<p class="pm-empty">Type at least 2 characters.</p>'
                : '<p class="pm-empty">Start typing to search — e.g. a name, or "Chiefs".</p>';
            return;
        }
        // Le squadre sono un lookup statico: si mostrano subito, senza attendere
        // l'indice giocatori (buildPlayerIndex legge tutte le stagioni da Firebase).
        const teams = teamResults(q);
        results.innerHTML = teamsGroup(teams) || '<p class="pm-empty">Searching players...</p>';

        const index = await buildPlayerIndex();
        if (input.value.trim() !== q) return; // l'utente ha già scritto altro
        const players = playerResults(q, index);
        if (!teams.length && !players.length) { results.innerHTML = '<p class="pm-empty">No results.</p>'; return; }
        results.innerHTML = `${teamsGroup(teams)}${playersGroup(players)}`;
    });
}

function initDropdowns(navbar) {
    const mq = window.matchMedia(MOBILE_MQ);
    const navLinks = navbar.querySelector('.nav-links');
    const level2 = buildLevel2(navbar);
    buildNflPanel(navbar);

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

    // Rotazione del telefono: si attraversa il breakpoint e le regole del menu
    // cambiano in blocco. Senza precauzioni il browser ANIMA quel salto — in
    // verticale il menu chiuso ripartiva dallo stato desktop (visibile) e
    // sfumava via, come se si aprisse e si richiudesse da solo. Quindi:
    // si riparte sempre da menu e lente chiusi, con le transizioni sospese
    // per un frame in modo che il nuovo layout compaia già a regime.
    mq.addEventListener('change', () => {
        navbar.classList.add('no-anim');
        closeMenu();
        document.getElementById('nav-search')?.classList.remove('open');
        document.getElementById('nav-search-btn')?.setAttribute('aria-expanded', 'false');
        void navbar.offsetWidth; // flush degli stili senza transizione
        requestAnimationFrame(() => {
            requestAnimationFrame(() => navbar.classList.remove('no-anim'));
        });
    });

    /* ── Desktop: hover ─────────────────────────────────────────────
       Il timer di chiusura e' UNO SOLO per tutta la barra, non uno per voce.
       Con un timer per voce, passando da una sezione a quella di fianco
       succedeva questo: la prima programmava la sua chiusura, la seconda
       apriva azzerando IL PROPRIO timer — non quello della prima — e 150ms
       dopo il timer della prima toglieva `dropdown-active`, che sta sulla
       BARRA ed e' condivisa. Il sottomenu della seconda compariva e spariva
       subito, pur essendoci il puntatore sopra.

       Per lo stesso motivo l'apertura chiude il pannello precedente: con due
       `panel-active` insieme i due sottomenu si sovrapponevano per un attimo. */
    let closeTimer = null;
    let apertoOra = null;

    const open = (panel) => {
        clearTimeout(closeTimer);
        if (apertoOra && apertoOra !== panel) apertoOra.classList.remove('panel-active');
        // L'altezza della barra aperta la decide il pannello, non una costante:
        // le voci a una riga restano 56px, il mega pannello NFL ne chiede ~330.
        // Si misura il pannello vero (e' in position:absolute, quindi la sua
        // altezza non dipende dalla barra che lo contiene).
        navbar.style.setProperty('--dd-h', `${panel.offsetHeight}px`);
        navbar.classList.add('dropdown-active');
        panel.classList.add('panel-active');
        apertoOra = panel;
    };

    const scheduleClose = () => {
        clearTimeout(closeTimer);
        closeTimer = setTimeout(() => {
            navbar.classList.remove('dropdown-active');
            navbar.querySelectorAll('.nav-dropdown-panel.panel-active')
                .forEach(p => p.classList.remove('panel-active'));
            apertoOra = null;
        }, 150); // 150ms di grazia per spostarsi sul pannello
    };

    navbar.querySelectorAll('.nav-item.has-dropdown').forEach(item => {
        const panelName = item.dataset.dropdown;
        const panel = navbar.querySelector(`[data-panel="${panelName}"]`);
        if (!panel) return;

        item.addEventListener('mouseenter', () => open(panel));
        item.addEventListener('mouseleave', scheduleClose);
        panel.addEventListener('mouseenter', () => open(panel));
        panel.addEventListener('mouseleave', scheduleClose);

        // ── Mobile: apre il secondo livello invece di navigare ──
        item.querySelector('.nav-link')?.addEventListener('click', (e) => {
            if (!mq.matches) return; // desktop: il link naviga normalmente
            // Voce con `data-no-drill` (NFL Hub): il pannello esiste solo per
            // l'hover desktop, da telefono resta un link normale.
            if (item.dataset.noDrill !== undefined) return;
            e.preventDefault();
            fillLevel2(level2, item, panel);
            navbar.classList.add('l2-open');
        });
    });
}

/**
 * Mega pannello "NFL Hub": le 32 squadre raggruppate per division, logo +
 * nome, per arrivare alla pagina squadra (`#nfl-team/{ABBR}`) con un solo
 * movimento invece di passare dall'hub e cercarla.
 *
 * Generato da NFL_TEAMS: scritto in index.html sarebbe una seconda lista di
 * squadre da tenere allineata a mano a ogni rebrand. L'ordine delle division
 * e' fisso (AFC poi NFC, East/North/South/West) perche' e' quello con cui si
 * leggono le classifiche; le squadre dentro ognuna vanno in ordine alfabetico.
 *
 * Vive solo su desktop: su mobile il CSS nasconde i pannelli hover e la voce
 * resta un link (vedi `data-no-drill`).
 */
function buildNflPanel(navbar) {
    const panel = navbar.querySelector('[data-panel="nfl"]');
    if (!panel) return;

    const divisions = ['AFC East', 'AFC North', 'AFC South', 'AFC West',
        'NFC East', 'NFC North', 'NFC South', 'NFC West'];

    const blocco = (div) => {
        const squadre = Object.entries(NFL_TEAMS)
            .filter(([, t]) => t.division === div)
            .sort((a, b) => a[1].name.localeCompare(b[1].name));
        return `
        <div class="nav-nfl-div">
            <h3 class="nav-nfl-div-title">${esc(div)}</h3>
            ${squadre.map(([abbr, t]) => `
            <a class="nav-nfl-team" href="#nfl-team/${abbr}">
                <img class="nav-nfl-team-logo" src="${teamLogoUrl(abbr)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">
                <span class="nav-nfl-team-name">${esc(t.name)}</span>
            </a>`).join('')}
        </div>`;
    };

    panel.innerHTML = `<div class="nav-nfl-grid">${divisions.map(blocco).join('')}</div>`;
}

/** Contenitore del secondo livello, creato una volta sola.
 *
 *  Niente pulsante "Back" qui dentro: per tornare indietro ci sono gia' la
 *  freccia in alto a sinistra (#nav-back) e la X, ed erano tre comandi per due
 *  gesti. Quello che c'era non lo ascoltava nemmeno nessuno — scriveva "Back" e
 *  basta. Via anche il titolo, che non veniva mai riempito. */
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
