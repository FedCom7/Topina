/**
 * Team Page Section
 * Attivata via hash #team-capi | #team-lasers | #team-oscurus | #team-sommo
 * Un'unica sezione che si ricostruisce al cambio di team.
 */

import { fetchFantasyData, fetchDraftData, processStandings, getSuperBowlMatchup, flattenDraft, displayName, SEASONS } from '../data.js?v=5';
import { TEAM_KEYS } from '../data/team-config.js?v=5';

// Converte numero in romano minuscolo per il nome file
function _toRoman(n) {
    const vals = [[10,'x'],[9,'ix'],[5,'v'],[4,'iv'],[1,'i']];
    let r = '';
    for (const [v, s] of vals) { while (n >= v) { r += s; n -= v; } }
    return r;
}

// Restituisce il path del logo SB dato l'anno (stagione 2019 = I, 2020 = II, …)
function _sbLogoPath(year) {
    const num = parseInt(year) - 2018;
    if (num < 1) return '';
    return `Superbowl-logo/superbowl_${_toRoman(num)}_logo.png`;
}

// Posizioni esatte dei portoni nell'immagine (px originali 1264×841) — uguale per tutti i team
const PHOTO_FRAME = { imgW: 1264, imgH: 841, cropTopFrac: 0.18, firstX: 236, firstY: 509, bW: 118, bH: 183, gap: 23 };

const TEAMS = {
    capi: {
        key: 'capi',
        name: 'Capi dei Pianeti',
        color: '#FF6600',
        logo: 'Team%20Logo/team_capi_transparent.png',
        wallpaper: 'Wallpapers/capi_profile_wallpapaper.PNG',
        uniform: 'Team%20Uniform/Philadelphia_Eagles_Uniforms_(2024).png',
        photoFrame: PHOTO_FRAME,
        bio: `Fondati nel 2019 con la visione di chi guarda lontano, i Capi dei Pianeti hanno sempre operato su una scala diversa. Il loro arancione brucia come il sole di un sistema solare lontano: impossibile ignorarlo, impossibile non riconoscerlo. Ogni draft è stato un'invasione pianificata, ogni stagione una conquista. Non giocano in una lega — governano un universo.`,
    },
    lasers: {
        key: 'lasers',
        name: 'Lasers',
        color: '#D4AF37',
        logo: 'Team%20Logo/team_lasers_transparent.png',
        wallpaper: 'Wallpapers/lasers_profile_wallpapaper.PNG',
        uniform: 'Team%20Uniform/Philadelphia_Eagles_Uniforms_(2024).png',
        photoFrame: PHOTO_FRAME,
        bio: `I Lasers non gridano. Tagliano. Dal 2019, questo franchise ha costruito la propria identità sulla precisione assoluta: ogni scelta di draft una mossa calcolata, ogni lineup una formula perfetta. L'oro del loro simbolo non è ornamento — è la firma di chi non sbaglia. Quando i Lasers accendono il raggio, la partita è già decisa.`,
    },
    oscurus: {
        key: 'oscurus',
        name: 'Oscurus',
        color: '#800020',
        logo: 'Team%20Logo/team_oscurus_transparent.png',
        wallpaper: 'Wallpapers/oscurus_profile_wallpapaper.PNG',
        uniform: 'Team%20Uniform/Philadelphia_Eagles_Uniforms_(2024).png',
        photoFrame: PHOTO_FRAME,
        bio: `Dal buio nascono i dominatori. Oscurus esiste dal 2019 come una forza silenziosa che cresce nell'ombra fino a quando è troppo tardi per fermarla. Il bordeaux scuro del loro stemma parla di sangue versato in ogni week, di difese infrante e di vittorie costruite col ferro. Non cercano l'amore della folla — cercano l'anello. E quando lo trovano, nessuno è sorpreso.`,
    },
    sommo: {
        key: 'sommo',
        name: 'Sommo',
        color: '#1c4750',
        logo: 'Team%20Logo/team_sommo_transparent.png',
        wallpaper: 'Wallpapers/sommo_profile_wallpapaper.PNG',
        uniform: 'Team%20Uniform/Philadelphia_Eagles_Uniforms_(2024).png',
        photoFrame: PHOTO_FRAME,
        bio: `Il nome non mente. Sommo è, fin dal 2019, il franchise che ha scelto la strada della strategia dove altri sceglievano l'istinto. Il verde profondo del loro colore è quello degli oceani inesplorati, dei piani a lungo termine, delle decisioni che si capiscono solo con il senno di poi. Non serve urlare quando sei già il più forte nella stanza.`,
    },
};

// Cleanup del parallax listener al cambio pagina
let _parallaxCleanup = null;

export function initTeam() {
    if (_parallaxCleanup) { _parallaxCleanup(); _parallaxCleanup = null; }

    const hash = location.hash.slice(1); // es. 'team-capi'
    const teamKey = hash.replace('team-', '');
    const team = TEAMS[teamKey];
    if (!team) return;

    const section = document.getElementById('team');
    // Imposta il colore del team come CSS var sulla sezione intera
    section.style.setProperty('--team-color', team.color);

    const heroClass = team.wallpaper ? 'team-movie-hero has-wallpaper' : 'team-movie-hero';

    section.innerHTML = `
        <div class="${heroClass}" style="opacity:0;transition:opacity 0.5s ease;">
            <div class="team-hero-bg"></div>
            ${team.wallpaper
                ? `<div class="team-hero-photo-wrap">
                       <img src="${team.wallpaper}" class="team-hero-photo" alt="${team.name} stadium">
                       <div class="team-sb-stage" id="team-sb-stage"></div>
                   </div>`
                : `<div class="team-sb-stage" id="team-sb-stage">
                       <div class="loading-state"><div class="spinner"></div></div>
                   </div>`
            }
            <div class="team-hero-vignette"></div>
            <div class="team-hero-id">
                <div class="team-id-text">
                    <span class="team-id-league">Topina League · Dal 2019</span>
                    <h1 class="team-id-name">${team.name}</h1>
                </div>
            </div>
        </div>
        <div class="section-inner team-page-body">
            <div class="team-intro">
                <p class="team-bio">${team.bio}</p>
                ${team.uniform ? `<div class="team-uniform"><img src="${team.uniform}" alt="${team.name} Uniform" class="team-uniform-img"></div>` : ''}
            </div>

            <div class="team-block">
                <h2 class="team-block-title">Badge</h2>
                <div class="team-badges" id="team-badges">
                    <div class="loading-state"><div class="spinner"></div></div>
                </div>
            </div>

            <div class="team-block">
                <h2 class="team-block-title">Franchise Players</h2>
                <p class="team-block-sub">Giocatori scelti in 2 o più stagioni di draft</p>
                <div class="team-flags" id="team-flags">
                    <div class="loading-state"><div class="spinner"></div></div>
                </div>
            </div>
        </div>
    `;

    _parallaxCleanup = _startParallax();
    loadTeamData(team);
}

function _showHero() {
    const hero = document.querySelector('.team-movie-hero');
    if (hero) hero.style.opacity = '1';
}

function _startParallax() {
    const hero = document.querySelector('.team-movie-hero');
    const img = hero?.querySelector('.team-hero-photo');
    const stage = hero?.querySelector('.team-sb-stage');
    if (!img) return null;

    const onScroll = () => {
        const scrollY = window.scrollY;
        if (scrollY > hero.offsetHeight) return;
        const tx = `translateY(${scrollY * -0.4}px)`;
        img.style.transform = tx;
        if (stage) stage.style.transform = tx;
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
}

async function loadTeamData(team) {
    const [seasonResults, draftResults] = await Promise.all([
        Promise.all(SEASONS.map(async year => {
            const data = await fetchFantasyData(year);
            if (!data) return null;
            const standings = processStandings(data, year);
            const sbMatchup = getSuperBowlMatchup(data, year);
            return { year, standings, sbMatchup };
        })),
        Promise.all(SEASONS.map(async year => {
            const data = await fetchDraftData(year);
            if (!data) return null;
            return { year, picks: flattenDraft(data) };
        }))
    ]);

    // --- Trofei ---
    const trophies = { champion: [], regularSeason: [] };
    seasonResults.filter(Boolean).forEach(({ year, standings, sbMatchup }) => {
        if (sbMatchup) {
            const s1 = parseFloat(sbMatchup.team1.score);
            const s2 = parseFloat(sbMatchup.team2.score);
            const winner = s1 >= s2 ? sbMatchup.team1 : sbMatchup.team2;
            if (TEAM_KEYS[displayName(winner.name)] === team.key) {
                trophies.champion.push(year);
            }
        }
        if (standings.length > 0) {
            if (TEAM_KEYS[displayName(standings[0].name)] === team.key) {
                trophies.regularSeason.push(year);
            }
        }
    });

    // --- Franchise Players (2+ draft) ---
    const playerMap = {};
    draftResults.filter(Boolean).forEach(({ year, picks }) => {
        const teamPicks = picks.filter(p => TEAM_KEYS[displayName(p.team)] === team.key);
        const seenThisYear = new Set();
        teamPicks.forEach(p => {
            if (seenThisYear.has(p.player)) return;
            seenThisYear.add(p.player);
            if (!playerMap[p.player]) playerMap[p.player] = { name: p.player, pos: p.pos, seasons: [] };
            playerMap[p.player].seasons.push(year);
        });
    });
    const franchisePlayers = Object.values(playerMap)
        .filter(p => p.seasons.length >= 2)
        .sort((a, b) => b.seasons.length - a.seasons.length);

    renderSBStage(team, trophies);
    renderBadges(trophies);
    renderFlags(franchisePlayers);
}

function renderSBStage(team, trophies) {
    const stage = document.getElementById('team-sb-stage');
    const years = trophies.champion;

    if (!years.length) {
        stage.innerHTML = '';
        const wallpaperImg = document.querySelector('.team-hero-photo');
        if (!wallpaperImg || wallpaperImg.complete) {
            _showHero();
        } else {
            wallpaperImg.addEventListener('load', _showHero, { once: true });
            wallpaperImg.addEventListener('error', _showHero, { once: true });
        }
        return;
    }

    const makeBanner = (year, extraStyle = '') => {
        const sbLogo = _sbLogoPath(year);
        const sbLogoHtml = sbLogo
            ? `<img src="${sbLogo}" alt="Super Bowl ${year}" class="sbb-sb-logo" onerror="this.style.display='none'">`
            : '';
        return `
        <div class="team-sb-banner"${extraStyle ? ` style="${extraStyle}"` : ''}>
            <img src="${team.logo}" alt="${team.name}" class="sbb-team-logo"
                 onerror="this.style.opacity='0'">
            <div class="sbb-team-name">${team.name}</div>
            <div class="sbb-sb-logo-wrap">${sbLogoHtml}</div>
            <div class="sbb-wc-text">
                <span>World</span>
                <span>Champions</span>
            </div>
            <div class="sbb-year">${year}</div>
        </div>`;
    };

    if (team.photoFrame) {
        const { imgW, imgH, cropTopFrac, firstX, firstY, bW, gap } = team.photoFrame;
        const cropPx  = cropTopFrac * imgW;
        const visibleH = imgH - cropPx;
        const step    = bW + gap;
        const topPct  = ((firstY - cropPx) / visibleH * 100).toFixed(2);
        const wPct    = (bW / imgW * 100).toFixed(2);

        stage.innerHTML = years.map((year, i) => {
            const leftPct = ((firstX + i * step) / imgW * 100).toFixed(2);
            const style = `position:absolute;left:${leftPct}%;top:${topPct}%;width:${wPct}%;aspect-ratio:1/1.94;`;
            return makeBanner(year, style);
        }).join('');
    } else {
        stage.innerHTML = years.map(year => makeBanner(year)).join('');
    }

    // Fade-in hero: aspetta che il wallpaper sia caricato prima di mostrare tutto
    const wallpaperImg = document.querySelector('.team-hero-photo');
    if (!wallpaperImg || wallpaperImg.complete) {
        _showHero();
    } else {
        wallpaperImg.addEventListener('load', _showHero, { once: true });
        wallpaperImg.addEventListener('error', _showHero, { once: true });
    }
}

function renderBadges(trophies) {
    const container = document.getElementById('team-badges');
    const badges = [
        { label: 'Topina Champions',         icon: '🏆', count: trophies.champion.length },
        { label: 'Regular Season Champions', icon: '🥇', count: trophies.regularSeason.length },
    ];

    container.innerHTML = badges.map(b => `
        <div class="team-badge ${b.count > 0 ? 'team-badge-active' : 'team-badge-empty'}">
            <div class="team-badge-icon">${b.icon}</div>
            <div class="team-badge-label">${b.label}</div>
            ${b.count > 0 ? `<div class="team-badge-count">×${b.count}</div>` : `<div class="team-badge-none">—</div>`}
        </div>
    `).join('');
}

function renderFlags(players) {
    const container = document.getElementById('team-flags');
    if (!players.length) {
        container.innerHTML = `<p class="empty-state-text">Nessun giocatore ripescato in più stagioni.</p>`;
        return;
    }

    container.innerHTML = players.map(p => `
        <div class="team-flag-card">
            <div class="team-flag-pos pos-${(p.pos || '').toLowerCase().replace('/', '')}">${p.pos || '—'}</div>
            <div class="team-flag-info">
                <div class="team-flag-name">${p.name}</div>
                <div class="team-flag-years">${p.seasons.join(' · ')}</div>
            </div>
            <div class="team-flag-count">${p.seasons.length}×</div>
        </div>
    `).join('');
}
