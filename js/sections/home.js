/**
 * Home — mosaico dinamico di card (stile Apple).
 *
 * La home è una griglia di card in stile "All Teams" che si rivelano allo
 * scroll (IntersectionObserver) con leggeri effetti parallax ([data-depth]).
 * Il CONTENUTO del mosaico dipende dal momento della lega, rilevato dai
 * dati Firebase — non da date hardcoded:
 *
 *   REGULAR_SEASON → risultati week, classifica, rail top performance
 *   PLAYOFFS       → semifinali, honors sigillati, rail corsa MVP
 *   SB_WEEK        → finale, rail premiati, all-pro
 *   OFFSEASON      → campione, premiati, rail albo d'oro, countdown
 *
 * Per aggiungere una fase (es. PRE_DRAFT, POST_DRAFT): aggiungere il caso
 * in detectPhase() e una entry nel registro MOSAIC qui sotto. Le card sono
 * funzioni riusabili: ogni fase compone la propria sequenza.
 */

import { displayName, teamNameHTML, fetchFantasyData, getPlayoffMatchups, getSuperBowlMatchup } from '../data.js?v=33';
import { getLeagueData, TEAM_KEY_LIST } from '../data/league-data.js?v=11';
import { getHonorsBundle } from '../data/honors.js?v=72';
import { electHallOfFame } from '../data/hall-of-fame.js?v=71';
import { TEAMS } from './team.js?v=87';
import { TEAM_LOGO_SCALE } from '../data/team-config.js?v=33';
import { teamsCardsHTML } from './teams.js?v=64';
import { playerImageService } from '../services/player-image-service.js?v=15';

let initialized = false;

const fmtInt = (n) => Math.round(n).toLocaleString('it-IT');
const fmtScore = (n) => (+n).toFixed(2);
const fmtPts = (n) => n.toLocaleString('it-IT', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export async function initHome() {
    if (initialized) return;
    initialized = true;

    const wrap = document.getElementById('home-showcase');
    if (!wrap) return;

    try {
        const league = await getLeagueData();
        const season = [...league.seasons].reverse().find(s =>
            Object.values(s.perTeam).some(t => t.games.length));
        const bundle = await getHonorsBundle(season.year);
        const phase = detectPhase(season, bundle);
        const ctx = { league, season, bundle, phase };

        const builder = MOSAIC[phase.type] || MOSAIC.OFFSEASON;
        const cards = (await Promise.all(builder(ctx))).filter(Boolean);

        wrap.innerHTML = `<div class="mosaic">${cards.join('')}</div>`;
        initScrollFX(wrap);
        hydrateHeadshots(wrap); // fire-and-forget: il mosaico dipinge subito coi fallback
    } catch (e) {
        console.error('Home load error:', e);
        wrap.innerHTML = `<div class="empty-state"><p class="empty-state-text">Could not load league data</p></div>`;
    }
}

// ─── Fase della lega (dai dati, non dal calendario) ──────────────

function detectPhase(season, bundle) {
    if (season.complete) return { type: 'OFFSEASON' };
    if (bundle?.revealed) return { type: 'SB_WEEK' };
    if (bundle?.rsComplete) return { type: 'PLAYOFFS' };
    const week = Math.max(0, ...Object.values(season.perTeam)
        .flatMap(t => t.games.map(g => g.week)));
    return { type: 'REGULAR_SEASON', week };
}

function phaseLabel({ phase, season }) {
    switch (phase.type) {
        case 'REGULAR_SEASON': return `Season ${season.year} · Week ${phase.week}`;
        case 'PLAYOFFS': return `Playoffs ${season.year}`;
        case 'SB_WEEK': return `Super Bowl Week ${season.year}`;
        default: {
            const days = daysToKickoff(season.year);
            return days > 0
                ? `⏳ Offseason · Kickoff ${+season.year + 1} in ${days} days`
                : '⏳ Offseason';
        }
    }
}

/** Giorni al primo giovedì di settembre della prossima stagione */
function daysToKickoff(latestYear) {
    const d = new Date(+latestYear + 1, 8, 1);
    d.setDate(1 + ((4 - d.getDay() + 7) % 7));
    return Math.ceil((d - new Date()) / 86400000);
}

// ─── Registro del mosaico: una sequenza di card per fase ─────────

const MOSAIC = {
    OFFSEASON: (ctx) => [
        cardHero(ctx),
        cardChampion(ctx),
        cardHonors(ctx),
        cardHallOfFame(ctx),
        cardTeams(ctx),
        railChampions(ctx),
        cardAllPro(ctx),
        cardNumbers(ctx),
        cardCountdown(ctx),
    ],
    REGULAR_SEASON: (ctx) => [
        cardHero(ctx),
        cardLastWeek(ctx),
        cardStandings(ctx),
        railTopPerformances(ctx),
        cardTeams(ctx),
        cardMvpRace(ctx),
        cardNumbers(ctx),
    ],
    PLAYOFFS: (ctx) => [
        cardHero(ctx),
        cardPlayoffs(ctx),
        cardHonorsSealed(ctx),
        cardStandings(ctx),
        railMvpRace(ctx),
        cardTeams(ctx),
    ],
    SB_WEEK: (ctx) => [
        cardHero(ctx),
        cardSuperBowl(ctx),
        railHonors(ctx),
        cardAllPro(ctx),
        cardTeams(ctx),
        cardNumbers(ctx),
    ],
};

// ─── Scaffolding card ────────────────────────────────────────────

/**
 * Card standard del mosaico. span: 'hero' | 'wide' | 'half'
 * watermarkKey: logo team in filigrana dietro il contenuto.
 * bg: immagine di sfondo a piena card (con overlay scuro per leggibilità).
 */
function card({ span = 'half', glow, kicker, title, body, cta, href, cls = '', parallax = false, watermarkKey, bg, sideImg }) {
    const wm = watermarkKey && TEAMS[watermarkKey];
    const styles = [
        glow ? `--card-glow:${glow}` : '',
        wm ? `--team-color:${wm.color}` : '',
    ].filter(Boolean).join(';');
    return `
    <article class="mosaic-card mc-${span} ${cls}" ${parallax ? 'data-parallax' : ''}
             ${styles ? `style="${styles}"` : ''}>
        ${bg ? `<div class="mc-bg"><img src="${bg}" alt="" aria-hidden="true" onerror="this.parentElement.remove()"></div>` : ''}
        ${wm ? `<img class="mc-watermark" src="${wm.logo}" alt="" aria-hidden="true" onerror="this.remove()">` : ''}
        ${sideImg ? `<img class="mc-side-img" src="${sideImg}" alt="" aria-hidden="true" data-depth="0.1" onerror="this.remove()">` : ''}
        ${kicker ? `<span class="mc-kicker">${kicker}</span>` : ''}
        ${title ? `<h2 class="mc-title">${title}</h2>` : ''}
        <div class="mc-body">${body}</div>
        ${cta ? `<a class="mc-cta" href="${href}">${cta} <span aria-hidden="true">→</span></a>` : ''}
    </article>`;
}

/** Rail a scorrimento orizzontale (stile Apple TV) */
function rail({ kicker, title, cards, cta, href }) {
    return `
    <div class="mc-rail">
        <header class="mc-rail-head">
            <div>
                <span class="mc-kicker">${kicker}</span>
                <h2 class="mc-title">${title}</h2>
            </div>
            ${cta ? `<a class="mc-cta" href="${href}">${cta} <span aria-hidden="true">→</span></a>` : ''}
        </header>
        <div class="mc-rail-track">${cards.join('')}</div>
    </div>`;
}

function railCard({ glow, top, media, title, sub }) {
    return `
    <div class="mc-rail-card" ${glow ? `style="--card-glow:${glow}"` : ''}>
        ${top ? `<span class="mc-rail-top">${top}</span>` : ''}
        ${media || ''}
        <span class="mc-rail-title">${title}</span>
        ${sub ? `<span class="mc-rail-sub">${sub}</span>` : ''}
    </div>`;
}

function teamChip(key) {
    const t = TEAMS[key];
    return t ? `<span class="mc-team" style="--team-color:${t.color}">
        <img src="${t.logo}" alt="" onerror="this.style.display='none'">${teamNameHTML(t.name)}</span>` : key;
}

function keyOf(rawName) {
    return TEAM_KEY_LIST.find(k => TEAMS[k].name === displayName(rawName)) || null;
}

/**
 * Avatar tondo del giocatore. Rende subito il fallback SVG; la foto vera
 * arriva dopo, via hydrateHeadshots. ring: '' | 'mc-avatar--gold' | 'mc-avatar--rail'…
 */
function playerAvatar(name, nfl, pos, year, ring = '') {
    return `<span class="mc-avatar ${ring}">
        <img src="images/fallback-player.svg" alt="" loading="lazy"
             data-headshot data-player-name="${name}" data-team="${nfl || ''}"
             data-pos="${pos || ''}" data-year="${year || ''}"></span>`;
}

/** Sostituisce i fallback con gli headshot ESPN, senza mai bloccare il render. */
function hydrateHeadshots(wrap) {
    wrap.querySelectorAll('img[data-headshot]').forEach(img => {
        img.onerror = () => {
            if (!img.src.endsWith('fallback-player.svg')) img.src = 'images/fallback-player.svg';
        };
        playerImageService.getPlayerImageUrl(img.dataset.playerName, img.dataset.team, img.dataset.pos, img.dataset.year)
            .then(url => { if (url) img.src = url; })
            .catch(() => { /* resta il fallback */ });
    });
}

// ─── Card comuni ─────────────────────────────────────────────────

function cardHero(ctx) {
    return `
    <article class="mosaic-card mc-hero" data-parallax>
        <div class="mc-hero-glow" data-depth="0.22"></div>
        <div class="mc-hero-grid"></div>
        <div class="mc-hero-content" data-depth="0.06">
            <span class="mc-pill">${phaseLabel(ctx)}</span>
            <h1 class="mc-wordmark">
                <span class="mc-word mc-word--outline">Topina</span>
                <span class="mc-word mc-word--fill">League</span>
            </h1>
            <p class="mc-tagline">Four franchises. One crown. Since 2019.</p>
        </div>
    </article>`;
}

function cardTeams({ league }) {
    // Card identiche alla pagina All Teams (stessa funzione di render)
    return `
    <div class="mc-rail mc-teams-block">
        <header class="mc-rail-head">
            <div>
                <span class="mc-kicker">The franchises</span>
                <h2 class="mc-title">Four contenders</h2>
            </div>
            <a class="mc-cta" href="#teams">All franchises <span aria-hidden="true">→</span></a>
        </header>
        <div class="teams-index">${teamsCardsHTML(league)}</div>
    </div>`;
}

function cardNumbers({ league }) {
    const totalGames = TEAM_KEY_LIST.reduce((s, k) => s + league.allTime[k].games, 0) / 2;
    const totalPts = TEAM_KEY_LIST.reduce((s, k) => s + league.allTime[k].pf, 0);
    const most = TEAM_KEY_LIST.map(k => ({ k, n: league.allTime[k].sbWins.length }))
        .sort((a, b) => b.n - a.n)[0];
    // Il nome della squadra è il dato, il conteggio è una postilla: "Lasers ×3"
    // si legge meglio di "Lasers (3)", dove la parentesi sembrava un anno.
    const tiles = [
        [league.seasons.length, 'Seasons'],
        [fmtInt(totalGames), 'Games'],
        [fmtInt(totalPts), 'Total points'],
        [TEAMS[most.k].name, 'Most titles', `×${most.n}`],
    ].map(([v, l, note]) => `
        <div class="mc-num">
            <span class="mc-num-value">${v}${note ? `<small class="mc-num-note">${note}</small>` : ''}</span>
            <span class="mc-num-label">${l}</span>
        </div>`).join('');
    return card({
        kicker: 'Since 2019',
        title: 'The league by the numbers',
        body: `<div class="mc-nums">${tiles}</div>`,
        cta: 'Records & stats', href: '#stats',
    });
}

// ─── Card di fase ────────────────────────────────────────────────

function cardChampion({ season, league }) {
    const key = season.sbWinnerKey;
    if (!key) return '';
    const t = TEAMS[key];
    const titles = league.allTime[key]?.sbWins.length || 1;
    return card({
        span: 'wide', cls: 'mc-champion-card', glow: t.color, parallax: true, sideImg: t.logo,
        kicker: `Super Bowl Champ · Stagione ${season.year}`,
        body: `
        <div class="mc-champion" style="--team-color:${t.color}">
            <span class="mc-champion-titles">${titles}° titolo del franchise</span>
            <span class="mc-champion-name">${t.name}</span>
        </div>`,
    });
}

function cardHonors({ bundle, season }) {
    if (!bundle?.revealed) return '';
    const wanted = { mvp: 'MVP', dpoy: 'DPOY', oroy: 'OROY', coach: 'COACH' };
    const rows = bundle.awards
        .filter(a => wanted[a.id] && a.winner)
        .map(a => {
            const isCoach = a.kind === 'coach';
            const team = TEAMS[a.winner.teamKey];
            const media = isCoach
                ? (team ? `<span class="mc-avatar mc-avatar--logo"><img src="${team.logo}" alt="" onerror="this.parentElement.remove()"></span>` : '')
                : playerAvatar(a.winner.name, a.winner.nfl, a.winner.pos, season.year);
            const name = isCoach ? (team?.name || '—') : a.winner.name;
            return `
        <div class="mc-row mc-row--tinted" style="--team-color:${team?.color || 'var(--accent-red)'}">
            <span class="mc-honor-tag">${wanted[a.id]}</span>
            ${media}
            <span class="mc-row-name">${name}</span>
        </div>`;
        }).join('');
    return card({
        kicker: `Topina Honors ${season.year}`,
        title: "This season's award winners",
        body: `<div class="mc-rows">${rows}</div>`,
        cta: 'All the awards', href: '#honors',
    });
}

async function cardHallOfFame({ season }) {
    const classes = await electHallOfFame();
    const latest = [...classes].reverse().find(c => c.inductee);
    if (!latest) return '';
    const p = latest.inductee;
    const teamKey = p.draftedBy?.length ? p.draftedBy[p.draftedBy.length - 1].teamKey : null;
    const team = teamKey ? TEAMS[teamKey] : null;
    return card({
        glow: team?.color,
        kicker: `Hall of Fame · Class of ${latest.year}`,
        title: 'The latest inductee',
        body: `
        <div class="mc-hof-feature" style="--team-color:${team?.color || 'var(--accent-amber)'}">
            ${playerAvatar(p.name, p.nflTeam, p.position, p.lastSeason, 'mc-avatar--gold mc-avatar--hof')}
            <span class="mc-hof-name">${p.name}</span>
            <span class="mc-hof-role">${p.position}</span>
        </div>`,
        cta: 'The Hall of Fame', href: '#halloffame',
    });
}

function cardHonorsSealed({ season }) {
    return card({
        glow: 'var(--accent-amber)',
        kicker: `Topina Honors ${season.year}`,
        title: 'The envelopes are sealed',
        body: `<p class="mc-text">Regular season in the books: the winners are set and will be revealed on Super Bowl eve.</p>`,
        cta: 'See the finalists', href: '#honors',
    });
}

function cardAllPro({ bundle, season }) {
    if (!bundle?.allPro) return '';
    const rows = bundle.allPro.first
        .filter(s => ['QB', 'RB', 'WR'].includes(s.slot) && s.player)
        .slice(0, 3)
        .map(({ slot, player }) => `
        <div class="mc-row mc-row--tinted" style="--team-color:${TEAMS[player.teamKey]?.color || 'var(--accent-red)'}">
            <span class="allpro-pos pos-${slot.toLowerCase()}">${slot}</span>
            ${playerAvatar(player.name, player.nfl, player.pos, season.year)}
            <span class="mc-row-name">${player.name}</span>
            <span class="mc-row-value">${fmtPts(player.total)} pt</span>
        </div>`).join('');
    return card({
        kicker: `All-Pro Team ${season.year}`,
        title: 'The ideal lineup',
        body: `<div class="mc-rows">${rows}</div>`,
        cta: 'First and Second Team', href: '#allpro',
    });
}

function cardCountdown({ season }) {
    const days = daysToKickoff(season.year);
    if (days <= 0) return '';
    return card({
        span: 'wide', cls: 'mc-center', parallax: true,
        kicker: 'Next chapter',
        title: `Season ${+season.year + 1}`,
        body: `
        <div class="mc-countdown" data-depth="0.08">
            <span class="mc-countdown-days">${days}</span>
            <span class="mc-countdown-label">days to kickoff</span>
        </div>`,
        cta: 'Look back at past drafts', href: '#draft',
    });
}

function cardLastWeek({ season, phase }) {
    const seen = new Set();
    const rows = [];
    TEAM_KEY_LIST.forEach(key => {
        if (seen.has(key)) return;
        const g = season.perTeam[key]?.games.find(x => x.week === phase.week);
        if (!g || !g.opp) return;
        seen.add(key); seen.add(g.opp);
        const winSide = g.won ? 'mc-vs-row--w1' : 'mc-vs-row--w2';
        rows.push(`
        <div class="mc-vs-row ${winSide}"
             style="--t1:${TEAMS[key]?.color || 'transparent'};--t2:${TEAMS[g.opp]?.color || 'transparent'}">
            ${teamCrest(key)}
            <span class="mc-vs-score mc-vs-score--l${g.won ? ' w' : ''}">${fmtScore(g.pts)}</span>
            <span class="mc-vs-dash">–</span>
            <span class="mc-vs-score mc-vs-score--r${!g.won ? ' w' : ''}">${fmtScore(g.oppPts)}</span>
            ${teamCrest(g.opp)}
        </div>`);
    });
    if (!rows.length) return '';
    return card({
        cls: 'mc-results-card',
        kicker: `Week ${phase.week}`,
        title: 'Latest results',
        body: `<div class="mc-vs-rows">${rows.join('')}</div>`,
        cta: 'Game Center', href: '#game-center',
    });
}

/** Solo lo stemma, grande: nei risultati il logo basta a dire chi è. */
function teamCrest(key) {
    const t = TEAMS[key];
    if (!t) return '<span class="mc-vs-crest"></span>';
    // --crest-scale pareggia la dimensione *disegnata* dei loghi (vedi
    // TEAM_LOGO_SCALE): senza, Sommo sembra molto più piccolo degli altri.
    return `<span class="mc-vs-crest" style="--team-color:${t.color};--crest-scale:${TEAM_LOGO_SCALE[key] || 1}" title="${t.name}">
        <img src="${t.logo}" alt="${t.name}" onerror="this.style.display='none'"></span>`;
}

function cardStandings({ season }) {
    const rows = season.standings.slice(0, 4).map((s, i) => {
        const key = keyOf(s.name);
        const color = key ? TEAMS[key].color : 'var(--accent-red)';
        return `
        <div class="mc-row" style="--team-color:${color}">
            <span class="mc-seed">${i + 1}</span>
            ${key ? teamChip(key) : displayName(s.name)}
            <span class="mc-row-value">${s.w}–${s.l}${s.t ? `–${s.t}` : ''}</span>
        </div>`;
    }).join('');
    return card({
        watermarkKey: keyOf(season.standings[0]?.name),
        kicker: `Season ${season.year}`,
        title: 'The playoff race',
        body: `<div class="mc-rows">${rows}</div>`,
        cta: 'Full standings', href: '#standings',
    });
}

function cardMvpRace({ bundle, season }) {
    if (!bundle) return '';
    const race = Object.values(bundle.players)
        .filter(p => p.pos !== 'DEF')
        .sort((a, b) => b.total - a.total)
        .slice(0, 3);
    if (!race.length) return '';
    const rows = race.map((p, i) => `
        <div class="mc-row mc-row--tinted" style="--team-color:${TEAMS[p.teamKey]?.color || 'var(--accent-red)'}">
            <span class="mc-rank">${i + 1}</span>
            ${playerAvatar(p.name, p.nfl, p.pos, season.year, i === 0 ? 'mc-avatar--gold' : '')}
            <span class="mc-row-name">${p.name} <small>${p.pos}</small></span>
            <span class="mc-row-value">${fmtPts(p.total)} pt</span>
        </div>`).join('');
    return card({
        kicker: `Topina Honors ${season.year}`,
        title: 'The MVP race',
        body: `<div class="mc-rows">${rows}</div>`,
        cta: 'All the awards', href: '#honors',
    });
}

async function cardPlayoffs({ season }) {
    const data = await fetchFantasyData(season.year);
    const matchups = data ? getPlayoffMatchups(data, season.year) : null;
    const s = season.standings;
    const side = (t) => {
        const key = keyOf(t.name);
        return key ? teamChip(key) : displayName(t.name);
    };
    const pair = (a, b) => {
        const c1 = TEAMS[keyOf(a.name)]?.color || 'transparent';
        const c2 = TEAMS[keyOf(b.name)]?.color || 'transparent';
        return `
        <div class="mc-score-row mc-score-row--vs" style="--t1:${c1};--t2:${c2}">
            ${side(a)}<span class="mc-score">vs</span>${side(b)}
        </div>`;
    };
    const body = matchups?.length
        ? matchups.map(m => pair(m.team1, m.team2)).join('')
        : (s.length >= 4 ? pair(s[0], s[3]) + pair(s[1], s[2]) : '');
    return card({
        span: 'wide',
        kicker: `Playoffs ${season.year}`,
        title: 'Semifinals: win or go home',
        body: `<div class="mc-rows">${body}</div>`,
        cta: 'The playoff picture', href: '#standings',
    });
}

async function cardSuperBowl({ season }) {
    const data = await fetchFantasyData(season.year);
    const sb = data ? getSuperBowlMatchup(data, season.year) : null;
    const playoffs = data ? getPlayoffMatchups(data, season.year) : null;
    let t1 = sb?.team1, t2 = sb?.team2;
    if ((!t1 || !t2) && playoffs?.length >= 2) {
        const winnerOf = (m) => parseFloat(m.team1.score) >= parseFloat(m.team2.score) ? m.team1 : m.team2;
        t1 = winnerOf(playoffs[0]); t2 = winnerOf(playoffs[1]);
    }
    if (!t1 || !t2) return '';
    const chip = (t) => {
        const key = keyOf(t.name);
        const team = key ? TEAMS[key] : null;
        return `
        <div class="mc-sb-side" style="--team-color:${team?.color || 'var(--accent-red)'}">
            ${team ? `<img src="${team.logo}" alt="" data-depth="0.1" onerror="this.style.display='none'">` : ''}
            <span>${teamNameHTML(t.name)}</span>
        </div>`;
    };
    // Sfondo: lo stadio della finale (coppie in ordine alfabetico), fallback generico
    const k1 = keyOf(t1.name), k2 = keyOf(t2.name);
    const bg = k1 && k2 ? `Wallpapers/sb_${[k1, k2].sort().join('_')}.png` : 'Wallpapers/stadium_bg.png';
    return card({
        span: 'wide', cls: 'mc-center', parallax: true, bg,
        kicker: `Super Bowl · Season ${season.year}`,
        title: 'It all comes down to one night',
        body: `<div class="mc-sb">${chip(t1)}<span class="mc-sb-vs">VS</span>${chip(t2)}</div>`,
        cta: 'Follow it in the Game Center', href: '#game-center',
    });
}

// ─── Rail per fase ───────────────────────────────────────────────

function railChampions({ league }) {
    const cards = [...league.seasons]
        .filter(s => s.sbWinnerKey)
        .reverse()
        .map(s => {
            const t = TEAMS[s.sbWinnerKey];
            const rec = s.perTeam[s.sbWinnerKey];
            return railCard({
                glow: t.color,
                top: s.year,
                media: `<img class="mc-rail-logo" src="${t.logo}" alt="${t.name}" onerror="this.style.display='none'">`,
                title: t.name,
                sub: rec ? `${rec.w}–${rec.l}${rec.t ? `–${rec.t}` : ''} · Champion` : 'Champion',
            });
        });
    return rail({
        kicker: 'Hall of champions',
        title: 'Every champion',
        cards,
        cta: 'The full history', href: '#history',
    });
}

async function railTopPerformances({ season, phase }) {
    const data = await fetchFantasyData(season.year);
    const week = data?.weeks?.[String(phase.week)];
    if (!week?.matchups) return '';
    const perf = [];
    week.matchups.forEach(m => [m.team1, m.team2].forEach(team => {
        if (!team) return;
        const key = keyOf(team.name);
        (team.starters || []).forEach(p => perf.push({
            name: p.name,
            pos: (p.position_in_team || p.position || '').toUpperCase(),
            pts: parseFloat(p.fantasy_points) || 0,
            nfl: p.nfl_team || '',
            key,
        }));
    }));
    const cards = perf.sort((a, b) => b.pts - a.pts).slice(0, 8).map(p => railCard({
        glow: TEAMS[p.key]?.color,
        top: `${p.pos}${TEAMS[p.key] ? ` · ${TEAMS[p.key].name}` : ''}`,
        media: playerAvatar(p.name, p.nfl, p.pos, season.year, 'mc-avatar--rail')
            + `<span class="mc-rail-big mc-rail-big--sm">${fmtPts(p.pts)}</span>`,
        title: p.name,
        sub: 'fantasy points',
    }));
    return rail({
        kicker: `Week ${phase.week}`,
        title: 'Top performances',
        cards,
        cta: 'Game Center', href: '#game-center',
    });
}

function railMvpRace({ bundle, season }) {
    if (!bundle) return '';
    const cards = Object.values(bundle.players)
        .filter(p => p.pos !== 'DEF')
        .sort((a, b) => b.total - a.total)
        .slice(0, 8)
        .map((p, i) => railCard({
            glow: TEAMS[p.teamKey]?.color,
            top: `#${i + 1} · ${p.pos}`,
            media: playerAvatar(p.name, p.nfl, p.pos, season?.year, `mc-avatar--rail${i === 0 ? ' mc-avatar--gold' : ''}`)
                + `<span class="mc-rail-big mc-rail-big--sm">${fmtPts(p.total)}</span>`,
            title: p.name,
            sub: 'season points',
        }));
    return rail({
        kicker: 'Topina Honors',
        title: 'The MVP race',
        cards,
        cta: 'The finalists', href: '#honors',
    });
}

function railHonors({ bundle, season }) {
    if (!bundle?.revealed) return '';
    const cards = bundle.awards
        .filter(a => a.winner)
        .map(a => {
            const isCoach = a.kind === 'coach';
            const team = TEAMS[a.winner.teamKey];
            const media = isCoach
                ? (team ? `<img class="mc-rail-logo" src="${team.logo}" alt="" onerror="this.style.display='none'">` : '')
                : playerAvatar(a.winner.name, a.winner.nfl, a.winner.pos, season?.year, 'mc-avatar--rail mc-avatar--gold');
            return railCard({
                glow: team?.color,
                top: a.abbr ? `${a.abbr} · ${a.name}` : a.name,
                media,
                title: isCoach ? (team?.name || '—') : a.winner.name,
                sub: a.kind === 'player' && a.winner.pos ? `${a.winner.pos} · ${fmtPts(a.winner.total)} pt` : '',
            });
        });
    return rail({
        kicker: 'Topina Honors',
        title: 'The award winners',
        cards,
        cta: 'The full ceremony', href: '#honors',
    });
}

// ─── Effetti scroll: reveal + parallax ───────────────────────────

function initScrollFX(wrap) {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const cards = wrap.querySelectorAll('.mosaic-card, .mc-rail');

    if (reduced || !('IntersectionObserver' in window)) {
        cards.forEach(c => c.classList.add('mc-in'));
        return;
    }

    // Reveal progressivo allo scroll
    const io = new IntersectionObserver((entries) => {
        entries.forEach(e => {
            if (e.isIntersecting) {
                e.target.classList.add('mc-in');
                io.unobserve(e.target);
            }
        });
    }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });
    cards.forEach(c => io.observe(c));

    // Parallax leggero sugli elementi [data-depth]
    const els = [...wrap.querySelectorAll('[data-depth]')];
    if (!els.length) return;
    let ticking = false;
    const update = () => {
        ticking = false;
        const vh = window.innerHeight;
        els.forEach(el => {
            const host = el.closest('.mosaic-card') || el;
            const r = host.getBoundingClientRect();
            if (r.bottom < -100 || r.top > vh + 100) return;
            const p = (r.top + r.height / 2 - vh / 2) / vh;
            el.style.transform = `translate3d(0, ${(-p * parseFloat(el.dataset.depth) * 120).toFixed(1)}px, 0)`;
        });
    };
    window.addEventListener('scroll', () => {
        if (!ticking) { ticking = true; requestAnimationFrame(update); }
    }, { passive: true });
    update();
}
