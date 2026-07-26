/**
 * Standings Section
 * Due pagine distinte, raggiungibili dal sotto-menu di Standings:
 *   #standings → Regular Season (card di classifica col seed gigante)
 *   #playoffs  → Playoff Picture (tabellone semifinali + Super Bowl)
 */
import { fetchFantasyData, processStandings, displayName, teamAbbr, teamNameHTML, CURRENT_SEASON, getPlayoffMatchups, getSuperBowlMatchup, getSeasonConfig } from '../data.js?v=32';
import { TEAMS } from './team.js?v=23';

let loadedStandings = false;
let loadedPlayoffs = false;
let _season = null; // { data, standings, config, playoffsStarted } — condiviso dalle due viste

// Team info (colore + logo) dal display name
function teamInfo(rawName) {
    const dn = displayName(rawName);
    return Object.values(TEAMS).find(t => t.name === dn) || { name: dn, color: '#888', logo: 'images/nfl_logo.png' };
}

/** Dati di stagione, calcolati una volta sola e riusati da entrambe le viste. */
async function getSeason() {
    if (_season) return _season;
    const data = await fetchFantasyData(CURRENT_SEASON);
    if (!data) return null;

    const standings = processStandings(data, CURRENT_SEASON);
    const config = getSeasonConfig(CURRENT_SEASON);
    const maxWeek = Math.max(...Object.keys(data.weeks || {}).map(Number), 0);
    const playoffsStarted = maxWeek >= config.playoffWeek;

    return (_season = { data, standings, config, playoffsStarted });
}

const spinner = (label) =>
    `<div class="loading-state"><div class="spinner"></div><p>Caricamento ${label}...</p></div>`;
const noData = '<div class="empty-state"><p class="empty-state-text">Dati non disponibili</p></div>';

export async function initStandings() {
    if (loadedStandings) return;
    loadedStandings = true;

    const selector = document.getElementById('st-year-selector');
    if (selector) selector.style.display = 'none';

    const wrap = document.getElementById('standings-table-wrap');
    wrap.innerHTML = spinner('Classifica');

    const s = await getSeason();
    if (!s) { wrap.innerHTML = noData; return; }

    wrap.innerHTML = `
        <p class="st-block-desc">${rankingDescription()}</p>
        ${generateRankingCards(s.standings)}`;
}

export async function initPlayoffs() {
    if (loadedPlayoffs) return;
    loadedPlayoffs = true;

    const wrap = document.getElementById('playoffs-wrap');
    if (!wrap) return;
    wrap.innerHTML = spinner('Playoff Picture');

    const s = await getSeason();
    if (!s) { wrap.innerHTML = noData; return; }

    wrap.innerHTML = `
        <p class="st-block-desc">${bracketDescription(s.standings, s.data, s.config, s.playoffsStarted)}</p>
        ${generateBracket(s.standings, s.data, s.config, s.playoffsStarted)}`;
}

/* ============================================================
   DESCRIZIONI DEI BLOCCHI
   ============================================================ */

function bracketDescription(standings, data, config, playoffsStarted) {
    const base = `Il tabellone dei playoff: 1ª contro 4ª e 2ª contro 3ª in semifinale (W${config.playoffWeek}), le vincenti al Super Bowl (W${config.superBowlWeek}).`;
    return playoffsStarted
        ? `${base} In grigio le eliminate, in oro il campione.`
        : `${base} Proiezione basata sulla classifica attuale.`;
}

function rankingDescription() {
    return `La classifica della stagione, ordinata per record: il numero grande è il seed playoff. Clicca una card per aprire la pagina del franchise.`;
}

/* ============================================================
   RANKING — card stile teams con numero gigante sporgente
   ============================================================ */

function generateRankingCards(standings) {
    if (!standings.length) return '';

    return `
    <div class="st-ranking">
        ${standings.map((t, i) => {
        const rank = i + 1;
        const info = teamInfo(t.name);
        const side = rank % 2 === 1 ? 'left' : 'right'; // 1 sx, 2 dx, 3 sx, 4 dx
        const streakType = t.streak.startsWith('W') ? 'w' : t.streak.startsWith('L') ? 'l' : 't';

        return `
        <div class="st-rank-wrap st-rank-wrap--${side}" style="--team-color:${info.color}; --card-i:${i}">
            <span class="st-rank-number" aria-hidden="true">${rank}</span>
            <a href="#team-${info.key || ''}" class="st-rank-card">
                <img class="st-rank-watermark" src="${info.logo}" alt="" aria-hidden="true" onerror="this.style.display='none'">
                <div class="st-rank-body">
                    <div class="st-rank-info">
                        <span class="st-rank-kicker">Seed #${rank}</span>
                        <h2 class="st-rank-name">${teamNameHTML(info.name)}</h2>
                        <div class="st-rank-stats">
                            <span class="st-rank-stat"><strong>${t.w}–${t.l}</strong> Record</span>
                            <span class="st-rank-stat"><strong>${t.pf.toLocaleString('it-IT')}</strong> PF</span>
                            <span class="st-rank-stat"><strong>${t.pa.toLocaleString('it-IT')}</strong> PA</span>
                            <span class="streak-badge streak-${streakType}">${t.streak}</span>
                        </div>
                    </div>
                </div>
            </a>
        </div>`;
    }).join('')}
    </div>`;
}

/* ============================================================
   PLAYOFF PICTURE — griglia esplicita (1v4 sx, finalisti centro, 2v3 dx)
   ============================================================ */

function generateBracket(standings, fantasyData, config, playoffsStarted) {
    if (standings.length < 4) return '';

    const seed1 = standings[0];
    const seed2 = standings[1];
    const seed3 = standings[2];
    const seed4 = standings[3];

    const playoffMatchups = getPlayoffMatchups(fantasyData, CURRENT_SEASON);
    const sbMatchup = getSuperBowlMatchup(fantasyData, CURRENT_SEASON);

    let winner1v4 = null, loser1v4 = null;
    let winner2v3 = null, loser2v3 = null;
    let champion = null, sbLoser = null;

    // --- Round 1 results from playoff matchups ---
    if (playoffMatchups) {
        const resolveMatchup = (teamA, teamB) => {
            const m = playoffMatchups.find(mu =>
                mu.team1 && mu.team2 &&
                [mu.team1.name, mu.team2.name].includes(teamA.name) &&
                [mu.team1.name, mu.team2.name].includes(teamB.name)
            );
            if (!m) return null;
            const s1 = parseFloat(m.team1.score);
            const s2 = parseFloat(m.team2.score);
            if (s1 === s2) return null;
            const winnerName = s1 > s2 ? m.team1.name : m.team2.name;
            return winnerName === teamA.name ? { winner: teamA, loser: teamB } : { winner: teamB, loser: teamA };
        };

        const r1 = resolveMatchup(seed1, seed4);
        if (r1) { winner1v4 = r1.winner; loser1v4 = r1.loser; }

        const r2 = resolveMatchup(seed2, seed3);
        if (r2) { winner2v3 = r2.winner; loser2v3 = r2.loser; }
    }

    // --- Super Bowl results ---
    if (sbMatchup?.team1 && sbMatchup?.team2) {
        const s1 = parseFloat(sbMatchup.team1.score);
        const s2 = parseFloat(sbMatchup.team2.score);
        if (s1 > s2) { champion = sbMatchup.team1.name; sbLoser = sbMatchup.team2.name; }
        else if (s2 > s1) { champion = sbMatchup.team2.name; sbLoser = sbMatchup.team1.name; }
    }

    // --- Render card ---
    const renderCard = (team, posClass, seed = null, isLoser = false, isChampion = false) => {
        const isTall = posClass === 'pos-3' || posClass === 'pos-4';

        if (!team) return `
            <div class="playoff-card ${posClass} empty ${isTall ? 'tall' : ''}"></div>`;

        const name = team.name ?? team;
        const info = teamInfo(name);
        const loserClass = isLoser ? 'loser' : '';
        const champClass = isChampion ? 'champion' : '';
        const seedBadge = seed !== null ? `<span class="playoff-seed">#${seed}</span>` : '';

        return `
            <div class="playoff-card ${posClass} ${isTall ? 'tall' : ''} ${loserClass} ${champClass}" style="--team-color:${info.color}">
                ${seedBadge}
                <img src="${info.logo}" alt="${info.name}" class="playoff-logo">
            </div>
        `;
    };

    const nameOf = (t) => t?.name ?? t;

    /* ---- Punteggi per la vista mobile (card-matchup) ---- */
    const abbrOf = (info) => teamAbbr(info.name);
    const fmt = (v) => Number.isFinite(v) ? (Number.isInteger(v) ? String(v) : v.toFixed(1)) : '';

    const scoresOf = (teamA, teamB) => {
        if (!playoffMatchups || !teamA || !teamB) return null;
        const m = playoffMatchups.find(mu =>
            mu.team1 && mu.team2 &&
            [mu.team1.name, mu.team2.name].includes(teamA.name) &&
            [mu.team1.name, mu.team2.name].includes(teamB.name));
        if (!m) return null;
        return { [m.team1.name]: parseFloat(m.team1.score), [m.team2.name]: parseFloat(m.team2.score) };
    };
    const sf1Scores = scoresOf(seed1, seed4);
    const sf2Scores = scoresOf(seed2, seed3);
    const sbScores = (sbMatchup?.team1 && sbMatchup?.team2)
        ? { [sbMatchup.team1.name]: parseFloat(sbMatchup.team1.score), [sbMatchup.team2.name]: parseFloat(sbMatchup.team2.score) }
        : null;

    // Riga squadra dentro una card-matchup mobile
    const pobTeam = (team, scores, winnerName, decided) => {
        if (!team) return `<div class="pob-team pob-team--tbd"><span class="pob-abbr">—</span></div>`;
        const name = nameOf(team);
        const info = teamInfo(name);
        const isWin = decided && name === winnerName;
        const cls = decided ? (isWin ? ' pob-team--win' : ' pob-team--lose') : '';
        const sc = scores ? fmt(scores[name]) : '';
        return `
        <a href="#team-${info.key || ''}" class="pob-team${cls}" style="--team-color:${info.color}">
            <img class="pob-logo" src="${info.logo}" alt="" onerror="this.style.display='none'">
            <span class="pob-abbr">${abbrOf(info)}</span>
            <span class="pob-score">${sc}</span>
        </a>`;
    };

    const pobSemi = (side, tA, tB, scores, winnerName) => `
        <div class="pob-semi pob-semi--${side}">
            <span class="pob-label">Semifinale</span>
            ${pobTeam(tA, scores, winnerName, !!winnerName)}
            ${pobTeam(tB, scores, winnerName, !!winnerName)}
        </div>`;

    const projectionNote = !playoffsStarted
        ? `<p class="st-bracket-note">Proiezione basata sulla classifica attuale — i playoff iniziano alla W${config.playoffWeek}</p>`
        : '';

    return `
    <div class="playoff-picture-container">
        <!-- ===== DESKTOP: griglia a loghi ===== -->
        <div class="playoff-desktop">
            <div class="playoff-rounds">
                <span class="playoff-round-label">Semifinale</span>
                <span class="playoff-round-label playoff-round-label--final">Topina Bowl</span>
                <span class="playoff-round-label">Semifinale</span>
            </div>
            <div class="playoff-grid-explicit">
                <!-- LEFT COLUMN: 1 vs 4 -->
                ${renderCard(seed1, 'pos-1', 1, loser1v4?.name === seed1.name)}
                ${renderCard(seed4, 'pos-2', 4, loser1v4?.name === seed4.name)}

                <!-- MID LEFT: winner of 1v4 -->
                ${renderCard(winner1v4, 'pos-3', null, sbLoser === nameOf(winner1v4), champion === nameOf(winner1v4))}

                <!-- MID RIGHT: winner of 2v3 -->
                ${renderCard(winner2v3, 'pos-4', null, sbLoser === nameOf(winner2v3), champion === nameOf(winner2v3))}

                <!-- RIGHT COLUMN: 2 vs 3 -->
                ${renderCard(seed2, 'pos-5', 2, loser2v3?.name === seed2.name)}
                ${renderCard(seed3, 'pos-6', 3, loser2v3?.name === seed3.name)}

                <!-- SUPER BOWL LOGO OVERLAY -->
                <img src="Wallpapers/superbowl_vii_logo.png" alt="Topina Bowl" class="sb-logo-overlay">
            </div>
        </div>

        <!-- ===== MOBILE: bracket a card-matchup (semi | Topina Bowl | semi) ===== -->
        <div class="playoff-mobile pob-bracket">
            ${pobSemi('left', seed1, seed4, sf1Scores, nameOf(winner1v4))}
            <div class="pob-final">
                <div class="pob-trophy">
                    <img class="pob-trophy-img" src="Wallpapers/superbowl_vii_logo.png" alt="Topina Bowl" onerror="this.style.display='none'">
                    <span class="pob-trophy-year">${CURRENT_SEASON}</span>
                </div>
                ${pobTeam(winner1v4, sbScores, champion, !!champion)}
                ${pobTeam(winner2v3, sbScores, champion, !!champion)}
            </div>
            ${pobSemi('right', seed2, seed3, sf2Scores, nameOf(winner2v3))}
        </div>

        ${projectionNote}
    </div>
    `;
}
