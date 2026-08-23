/**
 * Scheda giocatore — modal riusabile aperto dal click su un giocatore in
 * Draft Recap, Draft Grades e nella pagina team dei Draft Grades.
 *
 * Contenuto: foto, statistiche NFL stagionali reali (Sleeper, convertite
 * nello scoring della lega, con la proiezione preseason a confronto dove
 * disponibile — dal 2018), carriera Topina (punti, stagioni, chi lo ha
 * draftato) e bacheca premi di lega (MVP, OPOY, premi di posizione, Steal,
 * All-Pro, anelli SB).
 *
 * Attivazione: qualsiasi elemento con `data-player-modal` e i dataset
 * data-player-name / data-pos / data-nfl / data-year. Un solo listener
 * delegato su document; DOM del modal creato pigramente una volta sola.
 */

import { getCareer, getPlayerAwards } from '../data/careers.js?v=591';
import { getSeasonStats, getSeasonProjections, matchProjection, normName } from '../data/projections.js?v=591';
import { TEAMS } from '../sections/team.js?v=601';
import { playerImageService } from '../services/player-image-service.js?v=516';
import { getPlayerInfo } from '../data/player-full.js?v=589';
import { getHallOfFameYear } from '../data/hall-of-fame.js?v=585';

const MAX_NFL_YEARS = 5;
const FIRST_PROJ_YEAR = 2018; // Sleeper non ha proiezioni prima
const FIRST_STATS_YEAR = 2015;

let _wired = false;
let _overlay = null;
let _openToken = 0;
const _cache = new Map(); // `${normName}|${pos}` → { html, color } della scheda

const fmt0 = (n) => Math.round(n).toLocaleString('it-IT');

// ─── Wiring ──────────────────────────────────────────────────────

export function initPlayerModal() {
    if (_wired) return;
    _wired = true;

    // Flag sul document, non solo sul modulo: se una copia stale del modulo
    // resta viva in cache, il suo listener non registra un secondo handler.
    if (document.documentElement.dataset.pmWired) return;
    document.documentElement.dataset.pmWired = '1';

    document.addEventListener('click', (e) => {
        const el = e.target.closest('[data-player-modal]');
        if (!el) return;
        const { playerName, pos, nfl, year, game } = el.dataset;
        if (!playerName) return;

        // Contesto partita opzionale (Game Center): stats della singola gara
        let gameCtx = null;
        if (game) {
            try { gameCtx = JSON.parse(decodeURIComponent(game)); }
            catch { /* payload malformato: si apre la scheda senza il blocco partita */ }
        }
        openPlayerModal({ name: playerName, pos: pos || '', nfl: nfl || '', year: year || '', game: gameCtx });
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && _overlay && !_overlay.hidden) closePlayerModal();
    });
}

function ensureDom() {
    if (_overlay?.isConnected) return _overlay;

    // Se un overlay esiste già nel DOM lo riusiamo: così anche con due istanze
    // del modulo vive insieme (copia stale in cache del browser) resta una sola
    // scheda a schermo, invece di due sovrapposte.
    const existing = document.querySelector('.pm-overlay');
    if (existing) {
        _overlay = existing;
        return _overlay;
    }

    _overlay = document.createElement('div');
    _overlay.className = 'pm-overlay';
    _overlay.hidden = true;
    _overlay.innerHTML = `
        <div class="pm-dialog" role="dialog" aria-modal="true" aria-label="Player card">
            <button class="pm-close" aria-label="Close">✕</button>
            <div class="pm-content"></div>
        </div>`;
    _overlay.addEventListener('click', (e) => {
        if (e.target === _overlay) closePlayerModal();
        if (e.target.closest('.pm-fullstats')) closePlayerModal(); // il link cambia l'hash, qui si chiude solo il modal
    });
    _overlay.querySelector('.pm-close').addEventListener('click', closePlayerModal);
    document.body.appendChild(_overlay);
    return _overlay;
}

export function closePlayerModal() {
    _openToken++;
    if (_overlay) _overlay.hidden = true;
    document.body.classList.remove('pm-open');
}

// ─── Apertura e caricamento ──────────────────────────────────────

export async function openPlayerModal({ name, pos, nfl, year, game = null }) {
    const overlay = ensureDom();
    const dialog = overlay.querySelector('.pm-dialog');
    const content = overlay.querySelector('.pm-content');
    const token = ++_openToken;

    overlay.hidden = false;
    document.body.classList.add('pm-open');
    dialog.scrollTop = 0;

    const cacheKey = `${normName(name)}|${pos}`;
    if (_cache.has(cacheKey)) {
        const { html, color, career, awards } = _cache.get(cacheKey);
        dialog.style.setProperty('--team-color', color || '');
        content.innerHTML = html;
        appendContextBlocks(content, { game, pos, career, awards });
        appendFullStatsLink(content, { name, pos, year });
        hydrateHeadshot(content, name, nfl, pos, year);
        return;
    }

    dialog.style.removeProperty('--team-color');
    content.innerHTML = `
        <div class="pm-layout">
            <div class="pm-left">${paniniCard({ name, pos, nfl })}</div>
            <div class="pm-right">
                <div class="loading-state"><div class="spinner"></div><p>Opening card...</p></div>
            </div>
        </div>`;
    hydrateHeadshot(content, name, nfl, pos, year);

    try {
        const built = await buildCard({ name, pos, nfl, year });
        if (token !== _openToken) return; // nel frattempo è stata aperta un'altra scheda
        _cache.set(cacheKey, built);
        dialog.style.setProperty('--team-color', built.color || '');
        content.innerHTML = built.html;
        appendContextBlocks(content, { game, pos, career: built.career, awards: built.awards });
        appendFullStatsLink(content, { name, pos, year });
        hydrateHeadshot(content, name, nfl, pos, year);
    } catch (e) {
        console.error('[player-modal]', e);
        if (token !== _openToken) return;
        content.querySelector('.loading-state')?.replaceWith(
            Object.assign(document.createElement('p'), {
                className: 'pm-error', textContent: 'Error loading the card.',
            }));
    }
}

/**
 * Blocchi che dipendono da DA DOVE è stata aperta la scheda, quindi composti
 * qui e non dentro buildCard (il cui HTML è cachato per giocatore e resterebbe
 * congelato sul primo contesto):
 *   - dal Game Center → "Questa partita" (le stats di quella singola gara)
 *   - da ogni altra parte → la bacheca premi di carriera
 * Sono alternativi: nel Game Center conta la partita, non la carriera.
 */
function appendContextBlocks(content, { game, pos, career, awards }) {
    // Aperto da Game Center / Live: conta la partita, non la carriera. Via i
    // totali di carriera e la tabella per stagione, che restano in tutte le
    // altre pagine (l'HTML di buildCard è cachato, quindi si potano qui).
    if (game) {
        content.querySelector('.pm-big-stats')?.remove();
        content.querySelectorAll('.pm-block').forEach(b => {
            if (/stats by season/i.test(b.querySelector('.mc-kicker')?.textContent || '')) b.remove();
        });
    }

    // Il blocco partita prende il posto lasciato libero nella colonna destra,
    // così sta a fianco della figurina invece che sotto tutta la scheda.
    if (game) {
        const col = content.querySelector('.pm-right');
        (col || content).insertAdjacentHTML('beforeend', gameBlockHtml(game, pos));
        return;
    }

    const html = awards ? awardsBlock(career, awards) : '';
    if (html) content.insertAdjacentHTML('beforeend', html);
}

/** Etichetta leggibile per ogni statistica di gara conosciuta. */
const GAME_STAT_LABELS = {
    pass_comp: 'Completions', pass_att: 'Attempts', pass_yds: 'Pass yd',
    pass_td: 'Pass TD', pass_int: 'INT',
    rush_att: 'Carries', rush_yds: 'Rush yd', rush_td: 'Rush TD',
    targets: 'Targets', rec: 'Receptions', rec_yds: 'Rec yd', rec_td: 'Rec TD',
    ret_td: 'Return TD', fum_td: 'Fumble TD', fum_lost: 'Fumbles lost', two_pt: '2-PT',
    pat_made: 'Extra points', fg_made: 'Field goals', fg_att: 'FG attempts',
    fg_0_19: 'FG 0-19', fg_20_29: 'FG 20-29', fg_30_39: 'FG 30-39',
    fg_0_39: 'FG 0-39', fg_40_49: 'FG 40-49', fg_50_plus: 'FG 50+',
    sack: 'Sacks', def_int: 'Interceptions', fum_rec: 'Fumble rec.',
    def_td: 'Def. TDs', safety: 'Safeties', def_2pt_ret: '2-PT return',
    def_ret_td: 'Return TD', pts_allowed: 'Points allowed', pts_allow: 'Points allowed',
    yds_allowed: 'Yards allowed',
};

/** Ordine di presentazione preferito per ruolo; il resto segue come si trova. */
const GAME_STAT_ORDER = {
    QB: ['pass_comp', 'pass_att', 'pass_yds', 'pass_td', 'pass_int', 'rush_att', 'rush_yds', 'rush_td'],
    RB: ['rush_att', 'rush_yds', 'rush_td', 'targets', 'rec', 'rec_yds', 'rec_td'],
    WR: ['targets', 'rec', 'rec_yds', 'rec_td', 'rush_att', 'rush_yds', 'rush_td'],
    K: ['fg_made', 'fg_att', 'pat_made', 'fg_0_39', 'fg_0_19', 'fg_20_29', 'fg_30_39', 'fg_40_49', 'fg_50_plus'],
    DEF: ['sack', 'def_int', 'fum_rec', 'def_td', 'safety', 'pts_allowed', 'yds_allowed'],
};

/**
 * TUTTE le statistiche registrate per la gara, non una selezione: si mostra
 * quello che i dati contengono davvero, ordinato per ruolo e con le voci ignote
 * in coda (così una chiave nuova non sparisce silenziosamente).
 */
function gameStatCells(pos, s = {}, proj = null) {
    let role = (pos || '').toUpperCase();
    if (role === 'W/R' || role === 'RB/WR' || role === 'FLEX' || role === 'TE') role = role === 'TE' ? 'WR' : 'WR';
    if (role === 'D/ST') role = 'DEF';

    // Le voci da mostrare sono quelle con un dato reale OPPURE una previsione:
    // a partita appena cominciata i numeri veri sono tutti a zero, e senza
    // questo la scheda direbbe "nessuna statistica" proprio quando serve.
    const present = [...new Set([
        ...Object.keys(s).filter(k => s[k] != null),
        ...Object.keys(proj || {}).filter(k => proj[k] != null),
    ])];
    const preferred = (GAME_STAT_ORDER[role] || []).filter(k => present.includes(k));
    const rest = present.filter(k => !preferred.includes(k));

    const round = (v) => {
        const n = Number(v) || 0;
        return Number.isInteger(n) ? n : Math.round(n * 10) / 10;
    };
    return [...preferred, ...rest].map(k => ({
        label: GAME_STAT_LABELS[k] || k.replace(/_/g, ' '),
        value: round(s[k] ?? 0),
        // la stessa voce nelle proiezioni, per il confronto a colpo d'occhio
        proj: proj && proj[k] != null ? round(proj[k]) : null,
    }));
}

function gameBlockHtml(game, pos) {
    const { pts = 0, opponent = '', status = '', week, year, started, stats,
        projPts = null, projStats = null, fantasyTeam = '' } = game;
    // accanto a ogni numero reale, in piccolo, quello che era previsto
    const cells = gameStatCells(pos, stats, projStats); // include già fum_lost se presente

    const meta = [
        fantasyTeam,                       // la squadra fantasy che lo ha in rosa
        week ? `Week ${week}` : '',
        year || '',
        opponent ? `vs ${opponent}` : '',
        started ? 'Starter' : 'Bench',
    ].filter(Boolean).join(' · ');

    const grid = cells.length
        ? `<div class="pm-game-grid">${cells.map(c => `
            <div class="pm-game-cell">
                <span class="pm-game-cell-val">${c.value}${c.proj != null
                    ? `<small class="pm-proj" title="projected">${c.proj}</small>` : ''}</span>
                <span class="pm-game-cell-lbl">${c.label}</span>
            </div>`).join('')}</div>`
        : '<p class="pm-game-empty">No stats recorded for this game.</p>';

    return `
    <section class="pm-block pm-game">
        <h3 class="pm-block-title">This game</h3>
        <div class="pm-game-head">
            <span class="pm-game-pts">${pts.toFixed(2)}<small> pt</small>${projPts != null
                ? `<small class="pm-proj" title="projected">${Number(projPts).toFixed(1)}</small>` : ''}</span>
            <span class="pm-game-meta">${meta}</span>
        </div>
        ${status ? `<p class="pm-game-status">${status}</p>` : ''}
        ${grid}
    </section>`;
}

/**
 * Link alla pagina completa. Aggiunto fuori da buildCard perché l'HTML
 * della scheda è cachato per giocatore e congelerebbe l'anno del primo open.
 */
function appendFullStatsLink(content, { name, pos, year }) {
    const y = year || new Date().getFullYear();
    content.insertAdjacentHTML('beforeend',
        `<a class="pm-fullstats" href="#player/${y}/${pos || ''}/${encodeURIComponent(name)}">Open full stats →</a>`);
}

function hydrateHeadshot(content, name, nfl, pos, year) {
    const img = content.querySelector('.pm-headshot');
    if (!img) return;
    img.onerror = () => {
        if (!img.src.endsWith('fallback-player.svg')) img.src = 'images/fallback-player.svg';
    };
    playerImageService.getPlayerImageUrl(name, nfl, pos, year)
        .then(url => { if (url) img.src = url; })
        .catch(() => { /* resta il fallback */ });
}

// ─── Costruzione della scheda ────────────────────────────────────

async function buildCard({ name, pos, nfl, year }) {
    const [careerRes, awardsRes] = await Promise.allSettled([
        getCareer(name), getPlayerAwards(name),
    ]);
    const career = careerRes.status === 'fulfilled' ? careerRes.value : null;
    const awards = awardsRes.status === 'fulfilled' ? awardsRes.value
        : { awards: [], allProFirst: [], allProSecond: [] };

    // Hall of Fame: DOPO getCareer (non in parallelo) così riusa la cache di
    // buildCareers() invece di rifare da capo l'aggregazione di tutte le stagioni.
    const hofYear = career ? await getHallOfFameYear(career.name).catch(() => null) : null;

    // anni per la tabella: stagioni Topina ∪ anno cliccato, le più recenti
    let years = career ? Object.keys(career.bySeason).map(Number) : [];
    if (year) years.push(+year);
    if (!years.length) years = [new Date().getFullYear() - 1];
    years = [...new Set(years)].filter(y => y >= FIRST_STATS_YEAR)
        .sort((a, b) => b - a).slice(0, MAX_NFL_YEARS);

    const settled = await Promise.allSettled(years.flatMap(y => [
        getSeasonStats(y).then(m => ({ y, kind: 'stats', map: m })),
        y >= FIRST_PROJ_YEAR
            ? getSeasonProjections(y).then(m => ({ y, kind: 'proj', map: m }))
            : Promise.reject(new Error('no proj')),
    ]));
    const byYear = {};
    for (const r of settled) {
        if (r.status !== 'fulfilled') continue;
        (byYear[r.value.y] = byYear[r.value.y] || {})[r.value.kind] = r.value.map;
    }

    // anagrafica Panini (data di nascita, altezza, peso): riusa il playerId
    // già presente nelle stat stagionali appena caricate (niente fetch duplicati)
    const playerId = years
        .map(y => byYear[y]?.stats ? matchProjection(byYear[y].stats, name, pos)?.playerId : null)
        .find(Boolean) || null;
    const info = playerId ? await getPlayerInfo(playerId).catch(() => null) : null;

    // colore/squadra: la squadra Topina prevalente in carriera
    const teamKey = prevalentTeam(career);
    const color = teamKey ? TEAMS[teamKey]?.color : null;

    // La bacheca premi NON entra qui: è composta per-apertura in openPlayerModal,
    // perché dal Game Center va nascosta (lì conta la singola partita).
    const html = `
        <div class="pm-layout">
            <div class="pm-left">${paniniCard({ name, pos, nfl, info, career, hofYear, compact: true })}</div>
            <div class="pm-right">
                ${bigStatsBlock(career)}
                ${careerTableBlock(name, pos, years, byYear, career)}
            </div>
        </div>`;

    return { html, color, career, awards };
}

const fmtDate = (iso) => {
    const d = new Date(iso);
    if (isNaN(d)) return null;
    return d.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

/** Data di nascita · altezza (m) · peso (kg), stile didascalia Panini. */
function bioLine(info) {
    if (!info) return '';
    const parts = [];
    const date = info.birth_date ? fmtDate(info.birth_date) : null;
    if (date) parts.push(date);
    const hIn = parseFloat(info.height);
    if (hIn) parts.push(`${(hIn * 0.0254).toFixed(2).replace('.', ',')} m`);
    const wLb = parseFloat(info.weight);
    if (wLb) parts.push(`${Math.round(wLb * 0.453592)} kg`);
    return parts.join(' · ');
}

/**
 * Figurina Panini (proporzioni fisse 464×631, stesso stile delle card della
 * Hall of Fame): dorata solo per chi è REALMENTE eletto, bianca per tutti
 * gli altri. In alto a sx il ruolo, a dx anelli SB e selezioni All-Pro; busto
 * al centro; nome scritto in verticale sul bordo sinistro; in basso data di
 * nascita/altezza/peso e squadra Topina prevalente + stagioni.
 * `info`/`career`/`hofYear`/`teamKey` sono opzionali (assenti nello
 * scheletro di caricamento, popolati a scheda pronta).
 */
/**
 * Badge di carriera (MVP di stagione, anelli SB, All-Pro 1°/2° Team).
 * Estratto per poterlo iniettare a posteriori nelle card sparse per il sito
 * (All-Pro, Franchise Players, Draft) senza passare `career` al render.
 */
export function paniniBadgesHTML(career) {
    if (!career) return '';
    const stars = career.sbWins ? '★'.repeat(Math.min(career.sbWins, 5)) : '';
    return `
        ${career.mvp ? `<span class="pm-panini-mvp">${career.mvp}× MVP</span>` : ''}
        ${stars ? `<span class="pm-panini-stars">${stars}</span>` : ''}
        ${career.firstTeam ? `<span class="pm-panini-allpro pm-panini-allpro--1">${career.firstTeam}× AP1</span>` : ''}
        ${career.secondTeam ? `<span class="pm-panini-allpro pm-panini-allpro--2">${career.secondTeam}× AP2</span>` : ''}`;
}

/** Riempie i badge di carriera nelle card già renderizzate (foto a parte). */
export async function hydratePaniniBadges(container) {
    const cards = container.querySelectorAll('.pm-panini');
    for (const card of cards) {
        const badges = card.querySelector('.pm-panini-badges');
        const name = card.querySelector('.pm-headshot')?.dataset.playerName;
        if (!badges || !name) continue;
        const career = await getCareer(name).catch(() => null);
        if (career) badges.innerHTML = paniniBadgesHTML(career);
    }
}

export function paniniCard({ name, pos, nfl, info, career, hofYear, compact = false }) {
    const gold = !!hofYear;
    const stars = career?.sbWins ? '★'.repeat(Math.min(career.sbWins, 5)) : '';
    const bio = bioLine(info);
    const seasons = career ? `${career.seasons.size} Topina season${career.seasons.size === 1 ? '' : 's'}` : '';
    const showBubble = !compact && (bio || seasons);

    return `
    <div class="pm-panini${gold ? ' pm-panini--gold' : ''}">
        <div class="pm-panini-inner">
            <span class="pm-panini-side-name">${name}</span>
            <div class="pm-panini-top">
                ${pos ? `<span class="pm-panini-pos">${pos}</span>` : '<span></span>'}
                <div class="pm-panini-badges">${paniniBadgesHTML(career)}</div>
            </div>
            <div class="pm-panini-photo-wrap">
                <img class="pm-headshot pm-panini-photo" src="images/fallback-player.svg" alt="${name}"
                     data-player-name="${name}" data-team="${nfl || ''}" data-pos="${pos || ''}">
            </div>
            ${showBubble ? `
            <div class="pm-panini-info">
                <div class="pm-panini-bubble">
                    ${bio ? `<span class="pm-panini-bio">${bio}</span>` : ''}
                    ${seasons ? `<span class="pm-panini-seasons">${seasons}</span>` : ''}
                </div>
            </div>` : ''}
        </div>
    </div>`;
}

/** Statistiche grandi in cima alla colonna destra: i totali di carriera Topina. */
function bigStatsBlock(career) {
    if (!career) return '';
    const items = [
        [fmt0(career.totPts), 'Fantasy points'],
        [career.seasons.size, 'Seasons'],
        [fmt0(career.gamesStarted), 'Starts'],
    ];
    if (career.sbWins) items.push([`×${career.sbWins}`, 'SB rings']);
    return `
    <div class="pm-big-stats">
        ${items.map(([v, l]) => `<div class="pm-big-stat"><span class="pm-big-stat-value">${v}</span><span class="pm-big-stat-label">${l}</span></div>`).join('')}
    </div>`;
}

function prevalentTeam(career) {
    if (!career) return null;
    const weeks = {};
    for (const bs of Object.values(career.bySeason)) {
        for (const [k, n] of Object.entries(bs.teamKeys)) weeks[k] = (weeks[k] || 0) + n;
    }
    return Object.entries(weeks).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
}

// ─── Blocco: statistiche per stagione (NFL + Topina, colonne unite) ──

/**
 * Una riga per anno con le stat NFL (Sleeper) E quelle Topina insieme:
 * niente due colonne "punti" separate — i punti reali sono quelli
 * registrati in Topina quando il giocatore era in lega quell'anno,
 * altrimenti il ricalcolo Sleeper (proiezione/anno non ancora draftato).
 */
function careerTableBlock(name, pos, years, byYear, career) {
    const rows = years.map(y => {
        const stats = byYear[y]?.stats ? matchProjection(byYear[y].stats, name, pos) : null;
        const proj = byYear[y]?.proj ? matchProjection(byYear[y].proj, name, pos) : null;
        const bs = career?.bySeason?.[y];
        if (!stats && !proj && !bs) return '';

        const nflReal = stats ? (stats.ptsLeague ?? stats.ptsStd) : null;
        const pts = bs ? bs.pts : nflReal;
        const projPts = proj ? (proj.projPts ?? proj.ptsStd) : null;
        let diff = '';
        if (pts != null && projPts != null && projPts >= 30) {
            const pct = (pts - projPts) / projPts * 100;
            if (pct >= 15) diff = `<span class="dg-row-delta up">▲ ${Math.round(pct)}%</span>`;
            else if (pct <= -15) diff = `<span class="dg-row-delta down">▼ ${Math.round(Math.abs(pct))}%</span>`;
        }

        const logos = bs ? Object.keys(bs.teamKeys)
            .sort((a, b) => bs.teamKeys[b] - bs.teamKeys[a])
            .map(k => TEAMS[k] ? `<img class="pm-team-logo" src="${TEAMS[k].logo}" alt="${TEAMS[k].name}" title="${TEAMS[k].name}" onerror="this.style.display='none'">` : '')
            .join('') : '';

        return `
        <tr>
            <td>${y}</td>
            <td>${stats?.team || proj?.team || '—'}</td>
            <td>${stats?.gp != null ? fmt0(stats.gp) : '—'}</td>
            <td>${projPts != null ? fmt0(projPts) : '—'}</td>
            <td class="pm-td-strong">${pts != null ? fmt0(pts) : '—'} ${diff}</td>
            <td>${stats?.posRank ? `${pos}${stats.posRank}` : '—'}</td>
            <td class="pm-season-logos">${logos || '—'}</td>
            <td>${bs ? fmt0(bs.gamesStarted) : '—'}</td>
        </tr>`;
    }).filter(Boolean).join('');

    if (!rows) return '';
    return `
    <section class="pm-block">
        <span class="mc-kicker">Stats by season</span>
        <div class="pm-table-wrap">
            <table class="pm-table">
                <thead><tr><th>Year</th><th>NFL</th><th>GP</th><th>Proj</th><th>Points</th><th>Rank</th><th>Topina</th><th>Starts</th></tr></thead>
                <tbody>${rows}</tbody>
            </table>
        </div>
        <p class="pm-note">Points in the league's scoring: real Topina points where available, otherwise recalculated from Sleeper. "Proj" is the preseason projection (from 2018).</p>
    </section>`;
}

// ─── Blocco: carriera Topina ─────────────────────────────────────

export function topinaBlock(career) {
    if (!career) {
        return `
        <section class="pm-block">
            <span class="mc-kicker">Topina Career</span>
            <p class="pm-empty">Never fielded in Topina League.</p>
        </section>`;
    }

    const seasons = Object.keys(career.bySeason).sort((a, b) => b - a);
    const seasonRows = seasons.map(y => {
        const bs = career.bySeason[y];
        const logos = Object.keys(bs.teamKeys)
            .sort((a, b) => bs.teamKeys[b] - bs.teamKeys[a])
            .map(k => TEAMS[k] ? `<img class="pm-team-logo" src="${TEAMS[k].logo}" alt="${TEAMS[k].name}" title="${TEAMS[k].name}" onerror="this.style.display='none'">` : '')
            .join('');
        const dr = career.draftedBy.find(d => d.year === y);
        const drLabel = dr && TEAMS[dr.teamKey]
            ? `drafted #${dr.pick} (R${dr.round}) by ${TEAMS[dr.teamKey].name}` : 'undrafted (waiver/market)';
        return `
        <div class="pm-season-row">
            <span class="pm-season-year">${y}</span>
            <span class="pm-season-logos">${logos}</span>
            <span class="pm-season-pts">${fmt0(bs.pts)} pt</span>
            <span class="pm-season-note">${bs.gamesStarted} starts · ${drLabel}</span>
        </div>`;
    }).join('');

    // draft già fatto per una stagione non ancora nei dati (es. anno prossimo)
    const upcoming = career.draftedBy.filter(d => !career.bySeason[d.year] && TEAMS[d.teamKey])
        .map(d => `
        <div class="pm-season-row pm-season-row--future">
            <span class="pm-season-year">${d.year}</span>
            <span class="pm-season-logos"><img class="pm-team-logo" src="${TEAMS[d.teamKey].logo}" alt="" onerror="this.style.display='none'"></span>
            <span class="pm-season-pts">—</span>
            <span class="pm-season-note">drafted #${d.pick} (R${d.round}) by ${TEAMS[d.teamKey].name}</span>
        </div>`).join('');

    return `
    <section class="pm-block">
        <span class="mc-kicker">Topina Career</span>
        <div class="pm-ministats">
            <div class="ministat"><span class="ministat-value">${fmt0(career.totPts)}</span><span class="ministat-label">Fantasy points</span></div>
            <div class="ministat"><span class="ministat-value">${career.seasons.size}</span><span class="ministat-label">Seasons</span></div>
            <div class="ministat"><span class="ministat-value">${fmt0(career.gamesStarted)}</span><span class="ministat-label">Starts</span></div>
        </div>
        <div class="pm-seasons">${seasonRows}${upcoming}</div>
    </section>`;
}

// ─── Blocco: bacheca premi ───────────────────────────────────────

export function awardsBlock(career, awards) {
    const chips = [];
    for (const a of awards.awards) {
        chips.push(`<span class="pm-award">${a.name} <b>${a.year}</b></span>`);
    }
    if (awards.allProFirst.length) {
        chips.push(`<span class="pm-award pm-award--gold">All-Pro 1st Team <b>${awards.allProFirst.join(', ')}</b></span>`);
    }
    if (awards.allProSecond.length) {
        chips.push(`<span class="pm-award">All-Pro 2nd Team <b>${awards.allProSecond.join(', ')}</b></span>`);
    }
    if (career?.sbWins) {
        chips.push(`<span class="pm-award pm-award--gold">Super Bowl ring${career.sbWins === 1 ? '' : 's'} ×${career.sbWins}</span>`);
    }
    if (career?.top1Count) {
        chips.push(`<span class="pm-award">Position top 1 ×${career.top1Count}</span>`);
    }

    return `
    <section class="pm-block">
        <span class="mc-kicker">Trophy case</span>
        ${chips.length ? `<div class="pm-awards">${chips.join('')}</div>`
            : `<p class="pm-empty">No awards in the trophy case (yet).</p>`}
    </section>`;
}
