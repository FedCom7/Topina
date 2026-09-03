/**
 * Standings Section
 * Due pagine distinte, raggiungibili dal sotto-menu di Standings:
 *   #standings → Regular Season (card di classifica col seed gigante)
 *   #playoffs  → Playoff Picture (tabellone semifinali + Super Bowl)
 */
import { fetchFantasyData, processStandings, displayName, teamAbbr, teamNameHTML, CURRENT_SEASON, SEASONS, SEASONS_DESC, getPlayoffMatchups, getSuperBowlMatchup, getSeasonConfig } from '../data.js?v=580';
import { TEAMS } from './team.js?v=709';
import { pickDropdownHTML, bindPickDropdown } from '../ui/dropdown-pick.js?v=1';

let loadedStandings = false;
let loadedPlayoffs = false;

/* L'anno scelto vale per TUTTE E DUE le viste: classifica e tabellone sono lo
   stesso anno guardato da due lati, e vederli su stagioni diverse passando da
   una voce all'altra del menu sarebbe solo un modo per sbagliarsi. */
let annoScelto = CURRENT_SEASON;

/* Una stagione per anno, tenuta da parte: tornando indietro non si riscarica
   niente. `fetchFantasyData` ha gia' una cache sua, ma qui c'e' anche il
   lavoro di `processStandings` e del conteggio delle settimane. */
const stagioni = new Map();

// Team info (colore + logo) dal display name
function teamInfo(rawName) {
    const dn = displayName(rawName);
    return Object.values(TEAMS).find(t => t.name === dn) || { name: dn, color: '#888', logo: 'images/nfl_logo.png' };
}

/** Dati di una stagione, calcolati una volta sola e riusati da entrambe le viste. */
async function getSeason(year = annoScelto) {
    const chiave = String(year);
    if (stagioni.has(chiave)) return stagioni.get(chiave);
    const data = await fetchFantasyData(year);
    if (!data) return null;

    const standings = processStandings(data, year);
    const config = getSeasonConfig(year);
    const maxWeek = Math.max(...Object.keys(data.weeks || {}).map(Number), 0);
    const playoffsStarted = maxWeek >= config.playoffWeek;

    const s = { year, data, standings, config, playoffsStarted };
    stagioni.set(chiave, s);
    return s;
}

/**
 * Il selettore dell'anno, uguale a quello delle altre pagine. Ce n'e' uno per
 * vista perche' sono due sezioni distinte del sito, ma leggono e scrivono lo
 * stesso `annoScelto`: cambiandolo di qua si aggiorna anche di la'.
 */
function montaSelettore(contenitore) {
    if (!contenitore) return;
    const anni = SEASONS_DESC;
    const voci = anni.map(y => ({ value: String(y), label: String(y) }));
    contenitore.style.display = '';
    // Confronto per stringa: `SEASONS` sono stringhe ('2026'), e cercando un
    // numero l'indice tornava -1 — la capsula ripiegava allora sulla prima
    // voce e diceva sempre l'anno corrente mentre sotto cambiava tutto.
    const attivo = anni.findIndex(y => String(y) === String(annoScelto));
    // L'id e' 'year' e non qualcosa di piu' preciso: e' la chiave con cui il
    // CSS colora di rosso la capsula dell'anno (`[data-pick-id="year"]`), la
    // stessa di Draft, Analysis e All-Pro.
    contenitore.innerHTML = pickDropdownHTML('year', voci, attivo < 0 ? 0 : attivo);
    bindPickDropdown(contenitore, (_id, valore) => {
        const y = String(valore);
        if (y === String(annoScelto)) return;
        annoScelto = y;
        // La capsula non si riscrive da sola: `bindPickDropdown` cambia la
        // voce accesa nel menu, l'etichetta la ridisegna chi lo usa. Senza
        // questo il contenuto passava al 2021 e il bottone continuava a dire
        // 2026.
        montaSelettori();
        // Si ridisegnano entrambe le viste: le sezioni restano nel DOM anche
        // quando non si vedono, quindi quella nascosta e' gia' pronta quando
        // ci si torna.
        disegnaStandings();
        disegnaPlayoffs();
    });
}

/** Le due capsule, tenute allineate sull'anno scelto. */
function montaSelettori() {
    montaSelettore(document.getElementById('st-year-selector'));
    montaSelettore(document.getElementById('po-year-selector'));
}

const spinner = (label) =>
    `<div class="loading-state"><div class="spinner"></div><p>Loading ${label}...</p></div>`;
const noData = '<div class="empty-state"><p class="empty-state-text">Data not available</p></div>';

async function disegnaStandings() {
    const wrap = document.getElementById('standings-table-wrap');
    if (!wrap) return;
    const atteso = annoScelto;
    wrap.innerHTML = spinner('Standings');

    const s = await getSeason(atteso);
    // L'anno puo' essere cambiato mentre si aspettava la risposta: scrivere
    // adesso vorrebbe dire mostrare la stagione che l'utente ha gia' lasciato.
    if (atteso !== annoScelto) return;
    if (!s) { wrap.innerHTML = noData; return; }

    wrap.innerHTML = generateRankingCards(s.standings);
}

async function disegnaPlayoffs() {
    const wrap = document.getElementById('playoffs-wrap');
    if (!wrap) return;
    const atteso = annoScelto;
    wrap.innerHTML = spinner('Playoff Picture');

    const s = await getSeason(atteso);
    if (atteso !== annoScelto) return;
    if (!s) { wrap.innerHTML = noData; return; }

    wrap.innerHTML = generateBracket(s.standings, s.data, s.config, s.playoffsStarted, s.year);
}

export async function initStandings() {
    if (loadedStandings) return;
    loadedStandings = true;
    montaSelettori();
    await disegnaStandings();
}

export async function initPlayoffs() {
    if (loadedPlayoffs) return;
    loadedPlayoffs = true;
    montaSelettori();
    await disegnaPlayoffs();
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

function generateBracket(standings, fantasyData, config, playoffsStarted, year) {
    if (standings.length < 4) return '';

    const seed1 = standings[0];
    const seed2 = standings[1];
    const seed3 = standings[2];
    const seed4 = standings[3];

    // L'anno e' quello SCELTO, non quello corrente: con la costante il
    // tabellone di una stagione vecchia sarebbe stato letto con le settimane
    // di quest'anno, e il 2021 (che ha un calendario suo) sarebbe uscito
    // sbagliato.
    const playoffMatchups = getPlayoffMatchups(fantasyData, year);
    const sbMatchup = getSuperBowlMatchup(fantasyData, year);

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

    // Riga a "angoli": squadra sx — vincitore (con punteggio finale) al centro — squadra dx
    const pobCornerRow = (tA, tB, scores, winnerName, midTeam) => {
        const decided = !!winnerName;
        const infoA = teamInfo(nameOf(tA));
        const infoB = teamInfo(nameOf(tB));
        const clsA = decided ? (nameOf(tA) === winnerName ? ' pob-corner-team--win' : ' pob-corner-team--lose') : '';
        const clsB = decided ? (nameOf(tB) === winnerName ? ' pob-corner-team--win' : ' pob-corner-team--lose') : '';
        return `
        <div class="pob-corner-row">
            <div class="pob-corner-team pob-corner-team--left${clsA}" style="--team-color:${infoA.color}">${pobTeam(tA, scores, winnerName, decided)}</div>
            <div class="pob-corner-mid">${pobTeam(midTeam, sbScores, champion, !!champion)}</div>
            <div class="pob-corner-team pob-corner-team--right${clsB}" style="--team-color:${infoB.color}">${pobTeam(tB, scores, winnerName, decided)}</div>
        </div>`;
    };

    const projectionNote = !playoffsStarted
        ? `<p class="st-bracket-note">Projection based on the current standings — playoffs start at W${config.playoffWeek}</p>`
        : '';

    return `
    <div class="playoff-picture-container">
        <!-- ===== DESKTOP: griglia a loghi ===== -->
        <div class="playoff-desktop">
            <div class="playoff-rounds">
                <span class="playoff-round-label">Semifinal</span>
                <span class="playoff-round-label playoff-round-label--final">Topina Bowl</span>
                <span class="playoff-round-label">Semifinal</span>
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

        <!-- ===== MOBILE: bracket ad angoli (squadre ai bordi, vincitori al centro) ===== -->
        <div class="playoff-mobile pob-corners">
            <span class="pob-label">Semifinal</span>
            ${pobCornerRow(seed1, seed4, sf1Scores, nameOf(winner1v4), winner1v4)}
            <span class="pob-corners-divider">Topina Bowl</span>
            ${pobCornerRow(seed2, seed3, sf2Scores, nameOf(winner2v3), winner2v3)}
            <span class="pob-label">Semifinal</span>
        </div>

        ${projectionNote}
    </div>
    `;
}
