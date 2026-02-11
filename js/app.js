/**
 * Topina League — SPA Router & Init
 */
import { initHome } from './sections/home.js';
import { initGameCenter } from './sections/game-center.js';
import { initStandings } from './sections/standings.js';
import { initDraft } from './sections/draft.js';
import { initStats } from './sections/stats.js';
import { initHistory } from './sections/history.js';

const SECTIONS = {
    'home': initHome,
    'game-center': initGameCenter,
    'standings': initStandings,
    'draft': initDraft,
    'stats': initStats,
    'history': initHistory,
};

function getSection() {
    const hash = location.hash.slice(1) || 'home';
    return SECTIONS[hash] ? hash : 'home';
}

function navigate() {
    const active = getSection();

    // Update sections
    document.querySelectorAll('.page-section').forEach(s => s.classList.remove('active'));
    const section = document.getElementById(active);
    if (section) section.classList.add('active');

    // Update nav
    document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
    const link = document.querySelector(`.nav-link[data-section="${active}"]`);
    if (link) link.classList.add('active');

    // Close mobile menu
    document.querySelector('.nav-links')?.classList.remove('open');

    // Init section if needed
    const initFn = SECTIONS[active];
    if (initFn) initFn();

    // Scroll to top
    window.scrollTo({ top: 0, behavior: 'instant' });
}

// Hamburger
document.getElementById('nav-hamburger')?.addEventListener('click', () => {
    document.querySelector('.nav-links')?.classList.toggle('open');
});

// Navbar scroll effect
window.addEventListener('scroll', () => {
    document.getElementById('navbar')?.classList.toggle('scrolled', window.scrollY > 30);
});

// Route on hash change and initial load
window.addEventListener('hashchange', navigate);
document.addEventListener('DOMContentLoaded', navigate);
