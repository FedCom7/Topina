/**
 * Home — vetrina dinamica.
 * La home è un recap del sito che cambia in base al momento della lega,
 * ricavato dai dati Firebase (non da date hardcoded):
 *   REGULAR_SEASON → recap ultima week, classifica, corsa all'MVP
 *   PLAYOFFS       → semifinali, honors "sigillati"
 *   SB_WEEK        → finale + Topina Honors svelati
 *   OFFSEASON      → campione, premiati, all-pro, countdown nuova stagione
 */

import { getSeasonConfig, displayName, fetchFantasyData, getPlayoffMatchups, getSuperBowlMatchup } from '../data.js?v=5';
import { getLeagueData, TEAM_KEY_LIST } from '../data/league-data.js?v=1';
import { getHonorsBundle } from '../data/honors.js?v=1';
import { TEAMS } from './team.js?v=12';

let initialized = false;

const fmtPts = (n) => Math.round(n).toLocaleString('it-IT');
const fmtScore = (n) => (+n).toFixed(2);

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

        const blocks = [heroHTML(phase, season, league)];
        switch (phase.type) {
            case 'REGULAR_SEASON':
                blocks.push(blockLastWeek(season, phase.week));
                blocks.push(blockStandings(season));
                if (bundle) blocks.push(blockMvpRace(bundle, season.year));
                blocks.push(blockAllTime(league));
                break;
            case 'PLAYOFFS':
                blocks.push(await blockPlayoffs(season));
                blocks.push(blockHonorsSealed(season.year));
                blocks.push(blockAllTime(league));
                break;
            case 'SB_WEEK':
                blocks.push(await blockSuperBowl(season));
                if (bundle) blocks.push(blockHonorsRecap(bundle, season.year));
                blocks.push(blockAllProTeaser(bundle, season.year));
                break;
            case 'OFFSEASON':
            default:
                blocks.push(blockChampion(season, league));
                if (bundle?.revealed) blocks.push(blockHonorsRecap(bundle, season.year));
                if (bundle?.revealed) blocks.push(blockAllProTeaser(bundle, season.year));
                blocks.push(blockAllTime(league));
                blocks.push(blockNextSeason(season.year));
                break;
        }

        wrap.innerHTML = blocks.filter(Boolean).map((html, i) =>
            html.replace('--blk-i:@', `--blk-i:${i}`)).join('');
    } catch (e) {
        console.error('Home load error:', e);
        wrap.innerHTML = `<div class="empty-state"><div class="empty-state-icon">📡</div><p class="empty-state-text">Impossibile caricare i dati della lega</p></div>`;
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

function phaseLabel(phase, season) {
    switch (phase.type) {
        case 'REGULAR_SEASON': return `🏈 Stagione ${season.year} · Week ${phase.week}`;
        case 'PLAYOFFS': return `🔥 Playoffs ${season.year}`;
        case 'SB_WEEK': return `🏆 Super Bowl Week ${season.year}`;
        default: {
            const days = daysToKickoff(season.year);
            return days > 0
                ? `⏳ Offseason · Kickoff ${+season.year + 1} tra ${days} giorni`
                : `⏳ Offseason`;
        }
    }
}

/** Giorni al primo giovedì di settembre della prossima stagione */
function daysToKickoff(latestYear) {
    const y = +latestYear + 1;
    const d = new Date(y, 8, 1);
    d.setDate(1 + ((4 - d.getDay() + 7) % 7)); // primo giovedì
    return Math.ceil((d - new Date()) / 86400000);
}

// ─── Hero: identità della lega, ripensata ────────────────────────

function heroHTML(phase, season, league) {
    const championKey = [...league.seasons].reverse()
        .find(s => s.sbWinnerKey)?.sbWinnerKey;

    const crests = TEAM_KEY_LIST.map((key, i) => {
        const t = TEAMS[key];
        return `
        <a href="#team-${key}" class="hs-crest${key === championKey ? ' hs-crest--champ' : ''}"
           style="--team-color:${t.color};--crest-i:${i}">
            <img src="${t.logo}" alt="${t.name}" onerror="this.style.display='none'">
            <span>${t.name}</span>
            ${key === championKey ? '<span class="hs-crest-crown">👑</span>' : ''}
        </a>`;
    }).join('');

    return `
    <header class="hs-hero">
        <div class="hs-hero-bg"><div class="hs-hero-glow"></div><div class="hs-hero-grid"></div></div>
        <span class="hs-phase-pill">${phaseLabel(phase, season)}</span>
        <h1 class="hs-wordmark">
            <span class="hs-word hs-word--outline">Topina</span>
            <span class="hs-word hs-word--fill">League</span>
        </h1>
        <p class="hs-tagline">Quattro franchise. Una corona. Dal 2019.</p>
        <div class="hs-crests">${crests}</div>
    </header>`;
}

// ─── Blocchi vetrina ─────────────────────────────────────────────

function block({ kicker, title, body, cta, href, mod = '' }) {
    return `
    <section class="hs-block ${mod}" style="--blk-i:@">
        <span class="hs-block-kicker">${kicker}</span>
        <h2 class="hs-block-title">${title}</h2>
        <div class="hs-block-body">${body}</div>
        ${cta ? `<a class="hs-block-cta" href="${href}">${cta} <span aria-hidden="true">→</span></a>` : ''}
    </section>`;
}

function teamLabel(key) {
    const t = TEAMS[key];
    return t ? `<span class="hs-team" style="--team-color:${t.color}">
        <img src="${t.logo}" alt="" onerror="this.style.display='none'">${t.name}</span>` : key;
}

function blockChampion(season, league) {
    const key = season.sbWinnerKey;
    if (!key) return '';
    const t = TEAMS[key];
    const titles = league.allTime[key]?.sbWins.length || 1;
    return block({
        mod: 'hs-block--champion',
        kicker: `Super Bowl · Stagione ${season.year}`,
        title: `${t.name} sul trono`,
        body: `
        <div class="hs-champion" style="--team-color:${t.color}">
            <img class="hs-champion-logo" src="${t.logo}" alt="${t.name}" onerror="this.style.display='none'">
            <div class="hs-champion-info">
                <span class="hs-champion-line">Campioni in carica della Topina League</span>
                <span class="hs-champion-titles">${titles}° titolo del franchise</span>
            </div>
        </div>`,
        cta: 'La pagina del franchise', href: `#team-${key}`,
    });
}

function blockHonorsRecap(bundle, year) {
    const wanted = ['mvp', 'dpoy', 'coach'];
    const cards = bundle.awards
        .filter(a => wanted.includes(a.id) && a.winner)
        .map(a => {
            const name = a.kind === 'coach' ? (TEAMS[a.winner.teamKey]?.name || '—') : a.winner.name;
            return `
            <div class="hs-mini-award">
                <span class="hs-mini-award-icon">${a.icon}</span>
                <span class="hs-mini-award-label">${a.id.toUpperCase() === 'COACH' ? 'Coach of the Year' : a.id.toUpperCase()}</span>
                <span class="hs-mini-award-name">${name}</span>
            </div>`;
        }).join('');
    return block({
        kicker: `Topina Honors ${year}`,
        title: 'I premiati della stagione',
        body: `<div class="hs-mini-awards">${cards}</div>`,
        cta: 'Tutti i premi', href: '#honors',
    });
}

function blockHonorsSealed(year) {
    return block({
        kicker: `Topina Honors ${year}`,
        title: 'Le buste sono sigillate',
        body: `<p class="hs-block-text">Regular season in archivio: MVP, premi di posizione e All-Pro Team sono decisi. Si svelano alla vigilia del Super Bowl.</p>`,
        cta: 'Guarda i finalisti', href: '#honors',
    });
}

function blockAllProTeaser(bundle, year) {
    if (!bundle?.allPro) return '';
    const top = bundle.allPro.first
        .filter(s => ['QB', 'RB', 'WR'].includes(s.slot) && s.player)
        .slice(0, 3)
        .map(({ slot, player }) => `
        <div class="hs-allpro-row">
            <span class="allpro-pos pos-${slot.toLowerCase()}">${slot}</span>
            <span class="hs-allpro-name">${player.name}</span>
            <span class="hs-allpro-pts">${player.total.toLocaleString('it-IT', { maximumFractionDigits: 1 })} pt</span>
        </div>`).join('');
    return block({
        kicker: `All-Pro Team ${year}`,
        title: 'La formazione ideale',
        body: `<div class="hs-allpro">${top}</div>`,
        cta: 'First e Second Team completi', href: '#allpro',
    });
}

function blockLastWeek(season, week) {
    const seen = new Set();
    const rows = [];
    TEAM_KEY_LIST.forEach(key => {
        if (seen.has(key)) return;
        const g = season.perTeam[key]?.games.find(x => x.week === week);
        if (!g || !g.opp) return;
        seen.add(key); seen.add(g.opp);
        const won1 = g.won;
        rows.push(`
        <div class="hs-score-row">
            ${teamLabel(key)}
            <span class="hs-score"><b class="${won1 ? 'w' : ''}">${fmtScore(g.pts)}</b> – <b class="${!won1 ? 'w' : ''}">${fmtScore(g.oppPts)}</b></span>
            ${teamLabel(g.opp)}
        </div>`);
    });
    if (!rows.length) return '';
    return block({
        kicker: `Week ${week}`,
        title: 'Gli ultimi risultati',
        body: `<div class="hs-scores">${rows.join('')}</div>`,
        cta: 'Tutti i matchup nel Game Center', href: '#game-center',
    });
}

function blockStandings(season) {
    const rows = season.standings.slice(0, 4).map((s, i) => {
        const key = TEAM_KEY_LIST.find(k => TEAMS[k].name === displayName(s.name));
        return `
        <div class="hs-standing-row">
            <span class="hs-standing-rank">${i + 1}</span>
            ${key ? teamLabel(key) : displayName(s.name)}
            <span class="hs-standing-rec">${s.w}–${s.l}${s.t ? `–${s.t}` : ''}</span>
        </div>`;
    }).join('');
    return block({
        kicker: `Stagione ${season.year}`,
        title: 'La corsa ai playoff',
        body: `<div class="hs-standings">${rows}</div>`,
        cta: 'Classifica e playoff picture', href: '#standings',
    });
}

function blockMvpRace(bundle, year) {
    const race = Object.values(bundle.players)
        .filter(p => p.pos !== 'DEF')
        .sort((a, b) => b.total - a.total)
        .slice(0, 3);
    if (!race.length) return '';
    const rows = race.map((p, i) => `
        <div class="hs-allpro-row">
            <span class="hs-standing-rank">${i + 1}</span>
            <span class="hs-allpro-name">${p.name} <small>${p.pos}</small></span>
            <span class="hs-allpro-pts">${p.total.toLocaleString('it-IT', { maximumFractionDigits: 1 })} pt</span>
        </div>`).join('');
    return block({
        kicker: `Topina Honors ${year}`,
        title: 'La corsa all’MVP',
        body: `<div class="hs-allpro">${rows}</div>`,
        cta: 'La situazione di tutti i premi', href: '#honors',
    });
}

async function blockPlayoffs(season) {
    const data = await fetchFantasyData(season.year);
    const matchups = data ? getPlayoffMatchups(data, season.year) : null;
    const s = season.standings;
    const pair = (a, b) => `
        <div class="hs-score-row">
            ${teamName(a)}<span class="hs-score">vs</span>${teamName(b)}
        </div>`;
    const teamName = (t) => {
        const key = TEAM_KEY_LIST.find(k => TEAMS[k].name === displayName(t.name));
        return key ? teamLabel(key) : displayName(t.name);
    };
    const body = matchups?.length
        ? matchups.map(m => pair(m.team1, m.team2)).join('')
        : (s.length >= 4 ? pair(s[0], s[3]) + pair(s[1], s[2]) : '');
    return block({
        kicker: `Playoffs ${season.year}`,
        title: 'Semifinali: dentro o fuori',
        body: `<div class="hs-scores">${body}</div>`,
        cta: 'La playoff picture', href: '#standings',
    });
}

async function blockSuperBowl(season) {
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
        const key = TEAM_KEY_LIST.find(k => TEAMS[k].name === displayName(t.name));
        const team = key ? TEAMS[key] : null;
        return `
        <div class="hs-sb-side" style="--team-color:${team?.color || 'var(--accent-red)'}">
            ${team ? `<img src="${team.logo}" alt="" onerror="this.style.display='none'">` : ''}
            <span>${displayName(t.name)}</span>
        </div>`;
    };
    return block({
        mod: 'hs-block--sb',
        kicker: `Super Bowl · Stagione ${season.year}`,
        title: 'Tutto in una notte',
        body: `<div class="hs-sb">${chip(t1)}<span class="hs-sb-vs">VS</span>${chip(t2)}</div>`,
        cta: 'Segui nel Game Center', href: '#game-center',
    });
}

function blockAllTime(league) {
    const totalGames = TEAM_KEY_LIST.reduce((s, k) => s + league.allTime[k].games, 0) / 2;
    const totalPts = TEAM_KEY_LIST.reduce((s, k) => s + league.allTime[k].pf, 0);
    const most = TEAM_KEY_LIST.map(k => ({ k, n: league.allTime[k].sbWins.length }))
        .sort((a, b) => b.n - a.n)[0];
    const tiles = [
        [league.seasons.length, 'Stagioni'],
        [fmtPts(totalGames), 'Partite'],
        [fmtPts(totalPts), 'Punti totali'],
        [`${TEAMS[most.k].name} (${most.n})`, 'Più titoli'],
    ].map(([v, l]) => `
        <div class="hs-num"><span class="hs-num-value">${v}</span><span class="hs-num-label">${l}</span></div>`).join('');
    return block({
        kicker: 'Dal 2019',
        title: 'La lega in numeri',
        body: `<div class="hs-nums">${tiles}</div>`,
        cta: 'Record e statistiche all-time', href: '#stats',
    });
}

function blockNextSeason(latestYear) {
    const days = daysToKickoff(latestYear);
    if (days <= 0) return '';
    const y = +latestYear + 1;
    return block({
        mod: 'hs-block--next',
        kicker: 'Prossimo capitolo',
        title: `Stagione ${y}`,
        body: `
        <div class="hs-countdown">
            <span class="hs-countdown-days">${days}</span>
            <span class="hs-countdown-label">giorni al kickoff</span>
        </div>
        <p class="hs-block-text">Nuovo draft, nuovi roster, stessa corona in palio.</p>`,
        cta: 'Ripassa i draft del passato', href: '#draft',
    });
}
