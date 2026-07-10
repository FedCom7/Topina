/**
 * Topina League — SPA Router & Init
 */
import { initHome } from './sections/home.js?v=24';
import { initGameCenter } from './sections/game-center.js?v=30';
import { initStandings } from './sections/standings.js?v=28';
import { initDraft } from './sections/draft.js?v=22';
import { initStats } from './sections/stats.js?v=33';
import { initHistory } from './sections/history.js?v=23';
import { initHonors } from './sections/honors.js?v=1';
import { initAllPro } from './sections/allpro.js?v=1';
import { initHallOfFame } from './sections/halloffame.js?v=9';
import { initTeam } from './sections/team.js?v=12';
import { initTeams } from './sections/teams.js?v=2';
import { initGame } from './sections/game.js?v=2';
import { initAnalysis } from './sections/analysis.js?v=12';
import { initMagazine } from './sections/magazine.js?v=15';
import { initNavbar } from './ui/navbar.js';

const SECTIONS = {
    'home': initHome,
    'game-center': initGameCenter,
    'standings': initStandings,
    'teams': initTeams,
    'analysis': initAnalysis,
    'draft': initDraft,
    'stats': initStats,
    'history': initHistory,
    'honors': initHonors,
    'allpro': initAllPro,
    'halloffame': initHallOfFame,
    'magazine': initMagazine,
};

// Sezioni raggiungibili solo dai dropdown: nel nav si evidenzia la voce madre
const NAV_PARENT = {
    'honors': 'history',
    'allpro': 'history',
    'halloffame': 'history',
    'magazine': 'game-center',
};

const TEAM_KEYS_NAV = new Set(['team-capi', 'team-lasers', 'team-oscurus', 'team-sommo']);

function getSection() {
    const hash = location.hash.slice(1) || 'home';
    if (TEAM_KEYS_NAV.has(hash)) return hash;
    if (hash.startsWith('game/')) return hash; // #game/{year}/{week}/{idx}
    return SECTIONS[hash] ? hash : 'home';
}

function navigate() {
    const active = getSection();
    const isTeam = TEAM_KEYS_NAV.has(active);
    const isGame = active.startsWith('game/');
    const sectionId = isTeam ? 'team' : isGame ? 'game' : active;

    // Update sections
    document.querySelectorAll('.page-section').forEach(s => s.classList.remove('active'));
    const section = document.getElementById(sectionId);
    if (section) section.classList.add('active');

    // Update nav — team pages mantengono "Teams" evidenziato,
    // le voci da dropdown evidenziano la voce madre
    document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
    const navTarget = isTeam ? 'teams' : isGame ? 'game-center' : (NAV_PARENT[active] || active);
    document.querySelector(`.nav-link[data-section="${navTarget}"]`)?.classList.add('active');

    // Close mobile menu
    document.querySelector('.nav-links')?.classList.remove('open');

    // Init section
    if (isTeam) {
        initTeam();
    } else if (isGame) {
        initGame();
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
document.addEventListener('DOMContentLoaded', () => {
    initNavbar();
    navigate();
});
