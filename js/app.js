/**
 * Topina League — SPA Router & Init
 */
import { initHome } from './sections/home.js?v=38';
import { initGameCenter } from './sections/game-center.js?v=43';
import { initStandings, initPlayoffs } from './sections/standings.js?v=46';
import { initDraft } from './sections/draft.js?v=43';
import { initDraftGrades } from './sections/draftgrades.js?v=27';
import { initDraftGradeTeam } from './sections/draftgrade-team.js?v=25';
import { initPlayerPage } from './sections/player-page.js?v=52';
import { initNflTeamPage } from './sections/nfl-team-page.js?v=10';
import { initPlayersSearch } from './sections/players-search.js?v=9';
import { initStats } from './sections/stats.js?v=57';
import { initHistory } from './sections/history.js?v=33';
import { initHonors } from './sections/honors.js?v=13';
import { initAllPro } from './sections/allpro.js?v=14';
import { initHallOfFame } from './sections/halloffame.js?v=28';
import { initTeam } from './sections/team.js?v=23';
import { initTeams } from './sections/teams.js?v=13';
import { initGame } from './sections/game.js?v=26';
import { initAnalysis } from './sections/analysis.js?v=26';
import { initMagazine } from './sections/magazine.js?v=27';
import { initNavbar } from './ui/navbar.js?v=12';
import { startAutoAbbr } from './utils/team-abbr.js?v=1';

const SECTIONS = {
    'home': initHome,
    'game-center': initGameCenter,
    'standings': initStandings,
    'playoffs': initPlayoffs,
    'teams': initTeams,
    'analysis': initAnalysis,
    'draft': initDraft,
    'draftgrades': initDraftGrades,
    'stats': initStats,
    'history': initHistory,
    'honors': initHonors,
    'allpro': initAllPro,
    'halloffame': initHallOfFame,
    'magazine': initMagazine,
    'players': initPlayersSearch,
};

// Sezioni raggiungibili solo dai dropdown: nel nav si evidenzia la voce madre
const NAV_PARENT = {
    'honors': 'history',
    'allpro': 'history',
    'halloffame': 'history',
    'draftgrades': 'draft',
    'playoffs': 'standings',
    'magazine': 'game-center',
};

const TEAM_KEYS_NAV = new Set(['team-capi', 'team-lasers', 'team-oscurus', 'team-sommo']);

function getSection() {
    const hash = location.hash.slice(1) || 'home';
    if (TEAM_KEYS_NAV.has(hash)) return hash;
    if (hash.startsWith('game/')) return hash; // #game/{year}/{week}/{idx}
    if (hash.startsWith('draftgrades/')) return hash; // #draftgrades/{year}/{teamKey}
    if (hash.startsWith('player/')) return hash; // #player/{year}/{pos}/{nome}
    if (hash.startsWith('nfl-team/')) return hash; // #nfl-team/{abbr}/{anno?}
    return SECTIONS[hash] ? hash : 'home';
}

function navigate() {
    const active = getSection();
    const isTeam = TEAM_KEYS_NAV.has(active);
    const isGame = active.startsWith('game/');
    const isDGTeam = active.startsWith('draftgrades/');
    const isPlayer = active.startsWith('player/');
    const isNflTeam = active.startsWith('nfl-team/');
    const sectionId = isTeam ? 'team' : isGame ? 'game' : isDGTeam ? 'draftgrade-team' : isPlayer ? 'player-page' : isNflTeam ? 'nfl-team-page' : active;

    // Update sections
    document.querySelectorAll('.page-section').forEach(s => s.classList.remove('active'));
    const section = document.getElementById(sectionId);
    if (section) section.classList.add('active');

    // Update nav — team pages mantengono "Teams" evidenziato,
    // le voci da dropdown evidenziano la voce madre
    document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
    const navTarget = isTeam ? 'teams' : isGame ? 'game-center' : isDGTeam ? 'draft' : (isPlayer || isNflTeam) ? 'players' : (NAV_PARENT[active] || active);
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
document.addEventListener('DOMContentLoaded', () => {
    initNavbar();
    startAutoAbbr();
    navigate();
});
