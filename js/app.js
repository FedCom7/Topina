/**
 * Topina League — SPA Router & Init
 */
import { initHome } from './sections/home.js?v=826';
import { initGameCenter } from './sections/game-center.js?v=760';
import { initStandings, initPlayoffs } from './sections/standings.js?v=719';
import { initDraft } from './sections/draft.js?v=751';
import { initDraftGrades } from './sections/draftgrades.js?v=755';
import { initProjections } from './sections/projections.js?v=116';
import { initManagerDna } from './sections/managerdna.js?v=3';
import { initManagerDnaTeam } from './sections/managerdna-team.js?v=3';
import { initDraftGradeTeam } from './sections/draftgrade-team.js?v=762';
import { initPlayerPage } from './sections/player-page.js?v=984';
import { initNflTeamPage } from './sections/nfl-team-page.js?v=1038';
import { initPlayersSearch } from './sections/players-search.js?v=978';
import { initStats } from './sections/stats.js?v=812';
import { initHistory } from './sections/history.js?v=707';
import { initHonors } from './sections/honors.js?v=691';
import { initAllPro } from './sections/allpro.js?v=698';
import { initHallOfFame } from './sections/halloffame.js?v=714';
import { initTeam } from './sections/team.js?v=709';
import { initTeams } from './sections/teams.js?v=684';
import { initGame } from './sections/game.js?v=772';
import { initAnalysis } from './sections/analysis.js?v=774';
import { initLeaders } from './sections/leaders.js?v=11';
import { initWaivers } from './sections/waivers.js?v=15';
import { initMagazine } from './sections/magazine.js?v=738';
import { initLive } from './sections/live.js?v=1022';
import { initNavbar } from './ui/navbar.js?v=639';
import { startAutoAbbr } from './utils/team-abbr.js?v=501';
import { startLoadingArt } from './ui/spinner.js?v=6';

const SECTIONS = {
    'home': initHome,
    'game-center': initGameCenter,
    'standings': initStandings,
    'playoffs': initPlayoffs,
    'teams': initTeams,
    'analysis': initAnalysis,
    'leaders': initLeaders,
    'waivers': initWaivers,
    'draft': initDraft,
    'draftgrades': initDraftGrades,
    'projections': initProjections,
    'managerdna': initManagerDna,
    'stats': initStats,
    'history': initHistory,
    'honors': initHonors,
    'allpro': initAllPro,
    'halloffame': initHallOfFame,
    'magazine': initMagazine,
    'players': initPlayersSearch,
    'live': initLive,
};

// Sezioni raggiungibili solo dai dropdown: nel nav si evidenzia la voce madre
const NAV_PARENT = {
    'honors': 'history',
    'allpro': 'history',
    'halloffame': 'history',
    'draftgrades': 'draft',
    'projections': 'draft',
    'managerdna': 'draft',
    'playoffs': 'standings',
    'magazine': 'game-center',
    'leaders': 'analysis',
    'waivers': 'analysis',
};

const TEAM_KEYS_NAV = new Set(['team-capi', 'team-lasers', 'team-oscurus', 'team-sommo']);

function getSection() {
    const hash = location.hash.slice(1) || 'home';
    if (TEAM_KEYS_NAV.has(hash)) return hash;
    if (hash.startsWith('game/')) return hash; // #game/{year}/{week}/{idx}
    if (hash.startsWith('draftgrades/')) return hash; // #draftgrades/{year}/{teamKey}
    if (hash.startsWith('managerdna/')) return hash; // #managerdna/{teamKey}
    if (hash.startsWith('player/')) return hash; // #player/{year}/{pos}/{nome}
    if (hash.startsWith('nfl-team/')) return hash; // #nfl-team/{abbr}/{anno?}
    return SECTIONS[hash] ? hash : 'home';
}

/*
 * Zoom spento su tutto il sito da telefono.
 *
 * Le pagine sono gia' disegnate per lo schermo stretto: il pizzico non serviva
 * a leggere niente e partiva per sbaglio in mezzo a uno swipe o a un tocco, sul
 * Live come altrove. Su desktop non cambia niente — lo zoom del browser (ctrl
 * e rotella) non passa di qui.
 *
 * Quattro pezzi, perche' nessun browser li guarda tutti:
 *
 *  - il `meta viewport` in `index.html` — ferma il pizzico su Android e su
 *    qualunque cosa non sia WebKit;
 *  - `touch-action` in CSS (su `body`) — si prende il doppio tocco;
 *  - `gesturestart` — l'appiglio di Safari, che il meta lo ignora dal 2016;
 *  - il secondo dito su `touchstart` — rete di sicurezza per i casi in cui
 *    `gesturestart` non arriva affatto: WebView, "richiedi sito desktop", e
 *    ogni browser non-Safari su iPhone. E' un evento proprietario di WebKit,
 *    dove non c'e' non lo sostituisce nessuno.
 *
 * Il guardiano su `touchstart` lascia passare tutto quello che ha UN dito solo,
 * cioe' ogni scorrimento e ogni swipe del Live: interviene solo quando le dita
 * diventano due, che a quel punto e' un pizzico e nient'altro.
 */
['gesturestart', 'gesturechange', 'gestureend'].forEach(ev =>
    document.addEventListener(ev, (e) => e.preventDefault(), { passive: false }));

document.addEventListener('touchstart', (e) => {
    if (e.touches.length > 1) e.preventDefault();
}, { passive: false });

function navigate() {
    const active = getSection();
    const isTeam = TEAM_KEYS_NAV.has(active);
    const isGame = active.startsWith('game/');
    const isDGTeam = active.startsWith('draftgrades/');
    const isDnaTeam = active.startsWith('managerdna/');
    const isPlayer = active.startsWith('player/');
    const isNflTeam = active.startsWith('nfl-team/');
    const sectionId = isTeam ? 'team' : isGame ? 'game' : isDGTeam ? 'draftgrade-team' : isDnaTeam ? 'managerdna-team' : isPlayer ? 'player-page' : isNflTeam ? 'nfl-team-page' : active;

    // Update sections
    document.querySelectorAll('.page-section').forEach(s => s.classList.remove('active'));
    const section = document.getElementById(sectionId);
    if (section) section.classList.add('active');

    // Update nav — team pages mantengono "Teams" evidenziato,
    // le voci da dropdown evidenziano la voce madre
    document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
    const navTarget = isTeam ? 'teams' : isGame ? 'game-center' : (isDGTeam || isDnaTeam) ? 'draft' : (isPlayer || isNflTeam) ? 'players' : (NAV_PARENT[active] || active);
    document.querySelector(`.nav-link[data-section="${navTarget}"]`)?.classList.add('active');

    // Close mobile menu
    document.querySelector('.nav-links')?.classList.remove('open');

    // Init section
    if (isTeam) {
        initTeam();
    } else if (isGame) {
        initGame();
    } else if (isDGTeam) {
        initDraftGradeTeam();
    } else if (isDnaTeam) {
        initManagerDnaTeam();
    } else if (isPlayer) {
        initPlayerPage();
    } else if (isNflTeam) {
        initNflTeamPage();
    } else {
        SECTIONS[active]?.();
    }

    // Scroll to top
    window.scrollTo({ top: 0, behavior: 'instant' });
}

// Hamburger
document.getElementById('nav-hamburger')?.addEventListener('click', () => {
    document.querySelector('.nav-links')?.classList.toggle('open');
});

// Route on hash change and initial load
window.addEventListener('hashchange', navigate);

/**
 * Avvio. Non basta ascoltare DOMContentLoaded: data.js risolve le stagioni da
 * Firebase con un top-level await, quindi questo modulo può essere eseguito
 * quando l'evento è GIÀ scattato — in quel caso il listener non partirebbe mai
 * e la pagina iniziale resterebbe in "Loading...".
 */
function boot() {
    initNavbar();
    startAutoAbbr();
    startLoadingArt();
    navigate();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
} else {
    boot();
}
