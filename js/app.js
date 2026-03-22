/**
 * Topina League — SPA Router & Init
 */
import { initHome } from './sections/home.js?v=21';
import { initGameCenter } from './sections/game-center.js?v=28';
import { initStandings } from './sections/standings.js?v=25';
import { initDraft } from './sections/draft.js?v=21';
import { initStats } from './sections/stats.js?v=21';
import { initHistory } from './sections/history.js?v=21';
import { initTeam } from './sections/team.js?v=1';
import { initMagazine } from './sections/magazine.js';
import { initNavbar } from './ui/navbar.js';

const SECTIONS = {
    'home': initHome,
    'game-center': initGameCenter,
    'standings': initStandings,
    'draft': initDraft,
    'stats': initStats,
    'history': initHistory,
    'magazine': initMagazine,
};

const TEAM_KEYS_NAV = new Set(['team-capi', 'team-lasers', 'team-oscurus', 'team-sommo']);

function getSection() {
    const hash = location.hash.slice(1) || 'home';
    if (TEAM_KEYS_NAV.has(hash)) return hash;
    return SECTIONS[hash] ? hash : 'home';
}

function navigate() {
    const active = getSection();
    const isTeam = TEAM_KEYS_NAV.has(active);
    const sectionId = isTeam ? 'team' : active;

    // Update sections
    document.querySelectorAll('.page-section').forEach(s => s.classList.remove('active'));
    const section = document.getElementById(sectionId);
    if (section) section.classList.add('active');

    // Update nav — team pages mantengono "Standings" evidenziato
    document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
    const navTarget = isTeam ? 'standings' : active;
    document.querySelector(`.nav-link[data-section="${navTarget}"]`)?.classList.add('active');

    // Close mobile menu
    document.querySelector('.nav-links')?.classList.remove('open');

    // Init section
    if (isTeam) {
        initTeam();
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
