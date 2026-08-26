import { fetchFantasyData, fetchDraftData, getWeekCount, displayName, teamNameHTML, SEASONS, CURRENT_SEASON, getSeasonConfig } from '../data.js?v=538';
import { fetchLeagueWeek, fillMissingProjections } from '../data/espn-fantasy.js?v=8';
import { applyDraftLineups } from '../data/draft-lineups.js?v=6';
import { getWeekSchedule } from '../data/nfl-schedule.js?v=525';
import { TEAM_LOGOS, TEAM_KEYS } from '../data/team-config.js?v=533';
import { TEAMS } from './team.js?v=608';
import { initPlayerModal } from '../components/player-modal.js?v=613';
import { playerImageService } from '../services/player-image-service.js?v=520';
import { pickDropdownHTML, bindPickDropdown } from '../ui/dropdown-pick.js?v=1';
import { cachedAsset } from '../utils/asset-cache.js?v=1';

let currentData = null;
let currentYear = CURRENT_SEASON;
let currentWeek = 1;
let loaded = false;
// Prima del draft ESPN riempie le squadre di rose segnaposto: giocatori che non
// sono di nessuno. Con questo a falso non se ne mostra nessuno.
let leagueDrafted = true;

// Mapping display names → image filename abbreviations
const TEAM_FIELD_KEYS = {
    'Oscurus': 'OSCURUS',
    'Lasers': 'LASERS',
    'Sommo': 'SOMMO',
    'Capi dei Pianeti': 'C.D.P'
};

// Cache-bust dei wallpaper del campo: da bumpare quando si sostituiscono i file
// (il browser altrimenti li tiene in cache disco a tempo indefinito, non avendo
// header Cache-Control il server locale di sviluppo).
const FIELD_IMG_VERSION = 3;

/** Build the correct field image path for a matchup */
function getFieldImage(team1Name, team2Name) {
    const k1 = TEAM_FIELD_KEYS[displayName(team1Name)];
    const k2 = TEAM_FIELD_KEYS[displayName(team2Name)];
    const file = (k1 && k2) ? `Wallpapers/GameCenterHorizontal_${k1}_${k2}.png` : 'Wallpapers/GameCenterHorizontal.PNG';
    return `${file}?v=${FIELD_IMG_VERSION}`;
}

// --- Solo dati REALI ---------------------------------------------------
// Dal 2026 i dati portano anche `projected_points`/`projected_score`, ma qui
// non si usano mai: il Game Center è il resoconto di quello che è successo
// davvero, quindi prima del kickoff mostra zero. Le proiezioni stanno nella
// pagina Live.
function pEffPts(p) {
    return parseFloat(p?.fantasy_points) || 0;
}
function pPtsHTML(p) {
    return p.fantasy_points;
}
/** Matchup concluso: i dati vecchi non hanno `winner`, quindi sono sempre finali. */
function mIsFinal(m) {
    return !('winner' in m) || m.winner !== 'UNDECIDED';
}
function teamEffScore(t) {
    return parseFloat(t?.score) || 0;
}
function teamScoreHTML(t) {
    return t.score;
}

export async function initGameCenter() {
    if (loaded) return;
    loaded = true;
    initPlayerModal();
    renderPickRow();
    await loadYear(CURRENT_SEASON);
}

async function loadYear(year) {
    currentYear = year;
    const grid = document.getElementById('gc-matchup-grid');
    grid.innerHTML = `<div class="loading-state"><div class="spinner"></div><p>Loading ${year}...</p></div>`;

    currentData = await fetchFantasyData(year);
    if (!currentData?.weeks) {
        grid.innerHTML = `<div class="empty-state"><p class="empty-state-text">No data for the ${year} season</p></div>`;
        renderPickRow();
        return;
    }

    const maxWeek = getWeekCount(currentData);
    currentWeek = lastPlayedWeek(maxWeek);
    renderPickRow(maxWeek);
    await showMatchups();
}

/**
 * Settimana ancora aperta della stagione in corso: i dati su Firebase li
 * scrive l'Action una volta a settimana, quindi finché la giornata non è
 * chiusa lì ci sono zeri. Gli stessi numeri si leggono in diretta dall'API
 * della lega, che dal browser è raggiungibile senza cookie.
 *
 * Si aggiorna all'apertura e a ogni cambio settimana, senza polling: qui non
 * ci sono animazioni per giocata, e il Live esiste apposta per il minuto per
 * minuto. Sulle stagioni passate e sulle giornate chiuse non parte nessuna
 * chiamata.
 */
let draftSuFirebase;
async function draftOnFirebase() {
    if (draftSuFirebase === undefined) {
        try { draftSuFirebase = (await fetchDraftData(CURRENT_SEASON)) || null; }
        catch { draftSuFirebase = null; }
    }
    return draftSuFirebase;
}

async function refreshOpenWeek() {
    if (String(currentYear) !== String(CURRENT_SEASON)) return;
    const wk = currentData?.weeks?.[String(currentWeek)];
    if (wk?.matchups?.some(m => m.winner && m.winner !== 'UNDECIDED')) return;

    const week = currentWeek;
    try {
        const games = (await getWeekSchedule(currentYear, week)) || new Map();
        const { matchups, drafted } = await fetchLeagueWeek(currentYear, week, games);
        // Come nel Live: le rose segnaposto di ESPN non si mostrano mai. Se il
        // draft non è stato fatto si usano le scelte caricate su Firebase.
        leagueDrafted = drafted;
        if (!drafted) {
            const draft = await draftOnFirebase();
            leagueDrafted = !!draft && applyDraftLineups(matchups, draft);
        }
        if (!matchups.length) return;
        await fillMissingProjections(matchups, currentYear, week);
        // La settimana può essere cambiata mentre si aspettava la risposta
        if (week !== currentWeek || String(currentYear) !== String(CURRENT_SEASON)) return;
        currentData.weeks[String(week)] = { ...(wk || {}), matchups };
    } catch (e) {
        console.warn('[game-center] API ESPN non raggiungibile, resta Firebase:', e.message);
    }
}

/** Ultima week con punti giocati (default all'apertura); 1 se la stagione non è iniziata. */
function lastPlayedWeek(maxWeek) {
    for (let w = maxWeek; w >= 1; w--) {
        const wk = currentData.weeks[String(w)];
        if (wk?.matchups?.some(m =>
            (parseFloat(m.team1?.score) || 0) > 0 || (parseFloat(m.team2?.score) || 0) > 0)) {
            return w;
        }
    }
    return 1;
}

/** Riga con le due capsule a scomparsa: week a sinistra, anno a destra. */
function renderPickRow(maxWeek) {
    const container = document.getElementById('gc-pick-row');
    if (!container) return;

    let weekHtml = '';
    if (maxWeek) {
        const weekItems = [];
        for (let w = 1; w <= maxWeek; w++) weekItems.push({ value: String(w), label: weekLabel(w) });
        const weekIdx = weekItems.findIndex(it => it.value === String(currentWeek));
        weekHtml = pickDropdownHTML('week', weekItems, weekIdx);
    }
    const yearItems = SEASONS.map(y => ({ value: y, label: y }));
    const yearIdx = SEASONS.indexOf(String(currentYear));

    container.innerHTML = weekHtml + pickDropdownHTML('year', yearItems, yearIdx);
    bindPickDropdown(container, (id, value) => {
        if (id === 'year') {
            loadYear(value);
        } else if (id === 'week') {
            currentWeek = parseInt(value, 10);
            renderPickRow(maxWeek);
            showMatchups();
        }
    });
}

function weekLabel(w) {
    const config = getSeasonConfig(currentYear);
    if (w === config.playoffWeek) return 'Playoffs';
    if (w === config.superBowlWeek) return 'Super Bowl';
    return `Week ${w}`;
}

// Oltre questo non si aspetta più: una foto che non arriva non deve tenere
// ferma tutta la giornata. Quelle in ritardo compaiono dopo, come prima.
const READY_TIMEOUT_MS = 2500;

const attendi = (ms) => new Promise(r => setTimeout(r, ms));

/**
 * Disegna la giornata e la mostra COMPLETA: sfondo, foto e punteggi insieme.
 *
 * Prima erano quattro stadi visibili — intestazione, poi card con i punti di
 * Firebase, poi lo sfondo, poi le foto una a una — e sulla settimana aperta la
 * griglia veniva addirittura ricostruita due volte, perché i punti veri
 * arrivano dall'API della lega dopo quelli di Firebase. Qui si prepara tutto
 * fuori pagina, mentre resta lo spinner, e si mette in pagina una volta sola.
 */
async function showMatchups({ refresh = true } = {}) {
    const grid = document.getElementById('gc-matchup-grid');
    if (!grid) return;

    // I punti veri PRIMA di disegnare: così non si vede la giornata a zero e
    // poi di colpo con i punteggi. Sulle settimane chiuse non parte nulla.
    if (refresh) await refreshOpenWeek();

    const holder = document.createElement('div');
    if (!renderMatchups(holder)) {           // stato vuoto: niente da attendere
        grid.replaceChildren(...holder.childNodes);
        return;
    }

    // Le immagini partono anche fuori dal documento: si aspetta che siano
    // davvero dipinte, ma non oltre il tetto.
    await Promise.race([
        Promise.all([hydrateFieldImages(holder), hydrateSlotPhotos(holder)]),
        attendi(READY_TIMEOUT_MS),
    ]);
    grid.replaceChildren(...holder.childNodes);
}

/** Scrive le card in `grid`. Torna false se ha scritto uno stato vuoto. */
function renderMatchups(grid) {
    const weekData = currentData?.weeks?.[String(currentWeek)];
    if (!weekData?.matchups?.length) {
        grid.innerHTML = `<div class="empty-state"><p class="empty-state-text">No matchups for ${weekLabel(currentWeek)}</p></div>`;
        return false;
    }

    // Le rose che ESPN mostra prima del draft sono segnaposto: nessuno le ha
    // scelte, e verranno sostituite di sana pianta. Meglio dirlo che mostrarle.
    if (!leagueDrafted && String(currentYear) === String(CURRENT_SEASON)) {
        grid.innerHTML = `
        <div class="live-nodraft">
            <p class="live-nodraft-title">The draft has not happened yet</p>
            <p class="live-nodraft-text">Lineups will show up as soon as it is done.
               What ESPN shows now are placeholders: nobody picked them.</p>
            <a class="mc-cta" href="#draft">Go to the draft <span aria-hidden="true">→</span></a>
        </div>`;
        return false;
    }

    // Sort Super Bowl week: Final (highest score?) first — conservando
    // l'indice originale, usato dalla route #game/{year}/{week}/{idx}
    let matchups = weekData.matchups.map((m, idx) => ({ m, idx }));
    if (currentWeek === getSeasonConfig(currentYear).superBowlWeek) {
        matchups.sort((a, b) => {
            const totalA = parseFloat(a.m.team1.score) + parseFloat(a.m.team2.score);
            const totalB = parseFloat(b.m.team1.score) + parseFloat(b.m.team2.score);
            return totalB - totalA; // Descending
        });
    }

    grid.innerHTML = matchups.map(({ m, idx }, i) => {
        const s1 = teamEffScore(m.team1);
        const s2 = teamEffScore(m.team2);
        const w1 = mIsFinal(m) && s1 >= s2;
        const w2 = mIsFinal(m) && s2 > s1;

        const logo1 = TEAM_LOGOS[displayName(m.team1.name)] || 'images/nfl_logo.png';
        const logo2 = TEAM_LOGOS[displayName(m.team2.name)] || 'images/nfl_logo.png';
        const c1 = TEAMS[TEAM_KEYS[displayName(m.team1.name)]]?.color || 'var(--accent-red)';
        const c2 = TEAMS[TEAM_KEYS[displayName(m.team2.name)]]?.color || 'var(--accent-blue)';
        const fieldImg = getFieldImage(m.team1.name, m.team2.name);

        return `
        <div class="matchup-card" style="animation-delay:${i * 80}ms" data-idx="${idx}">
            <a class="gc-banner" href="#game/${currentYear}/${currentWeek}/${idx}"
               style="--tc1:${c1};--tc2:${c2}" title="Open the game analysis">
                <img class="gc-banner-wm gc-banner-wm-l" src="${logo1}" alt="" aria-hidden="true">
                <img class="gc-banner-wm gc-banner-wm-r" src="${logo2}" alt="" aria-hidden="true">
                <div class="gc-banner-inner">
                    <div class="gc-banner-side">
                        <span class="gc-banner-name">${teamNameHTML(m.team1.name)}</span>
                    </div>
                    <span class="gc-banner-score${w1 ? ' winner' : ''}">${teamScoreHTML(m.team1)}</span>
                    <div class="gc-banner-mid">
                        <span class="gc-banner-vs">vs</span>
                        <span class="gc-banner-cta">Analysis <span aria-hidden="true">→</span></span>
                    </div>
                    <span class="gc-banner-score${w2 ? ' winner' : ''}">${teamScoreHTML(m.team2)}</span>
                    <div class="gc-banner-side gc-banner-side-r">
                        <span class="gc-banner-name">${teamNameHTML(m.team2.name)}</span>
                    </div>
                </div>
            </a>
            <div class="matchup-field-horizontal">
                <span class="field-team-label field-team-label-top">${teamNameHTML(m.team1.name)}</span>
                <img data-field="${fieldImg}" class="field-bg" alt="">
                <div class="field-overlay">
                    <div class="formations-area">
                        <div class="team-formation left">
                            ${renderRoster(m.team1, 'left')}
                        </div>
                        <div class="scrimmage-center"></div>
                        <div class="team-formation right">
                            ${renderRoster(m.team2, 'right')}
                        </div>
                    </div>
                    
                    <!-- DEF/K positioned by CSS -->
                    ${renderDefK(m.team1, 'left')}
                    ${renderDefK(m.team2, 'right')}
                </div>
                <span class="field-team-label field-team-label-bottom">${teamNameHTML(m.team2.name)}</span>
            </div>
            <div class="field-bottom-row">
                <div class="bench-half bench-left">
                    <span class="bench-label">${teamNameHTML(m.team1.name)}</span>
                    ${renderBench(m.team1)}
                </div>
                <div class="bench-half bench-right">
                    <span class="bench-label">${teamNameHTML(m.team2.name)}</span>
                    ${renderBench(m.team2)}
                </div>
            </div>
        </div>`;
    }).join('');

    return true;
}

/**
 * Gli sfondi del campo arrivano dalla cache degli asset invece che dalla rete:
 * pesano ~3,5 MB l'uno e senza cache si riscaricavano a ogni visita. Il
 * riquadro ha già la sua proporzione dal CSS, quindi la card non si muove
 * mentre l'immagine arriva.
 */
function hydrateFieldImages(grid) {
    const imgs = [...grid.querySelectorAll('img.field-bg[data-field]')];
    return Promise.all(imgs.map(async (img) => {
        const path = img.dataset.field;
        if (!path) return;
        try { img.src = await cachedAsset(path, FIELD_IMG_VERSION); }
        catch { img.src = path; }
        await dipinta(img);
    }));
}

/** Attende che l'immagine sia davvero decodificata; un errore non blocca. */
function dipinta(img) {
    if (img.complete && img.naturalWidth > 0) return Promise.resolve();
    return img.decode().catch(() => { /* rotta o sostituita: si va avanti */ });
}

/** DEF + K positioned absolutely on field */
function renderDefK(team, side) {
    const starters = team.starters || [];
    const getP = (pos) => starters.find(p => (p.position || '').toUpperCase() === pos);

    const def = getP('DEF');
    const k = getP('K');

    // Return HTML with specific classes for positioning
    // We'll use specific classes: .special-slot.left-def, .special-slot.left-k, etc.
    let html = '';
    if (def) html += specialSlot(def, side, 'DEF');
    if (k) html += specialSlot(k, side, 'K');
    return html;
}

function specialSlot(p, side, type) {
    // type is 'DEF' or 'K'
    // side is 'left' or 'right'
    return `<div class="formation-slot special-slot ${side}-${type.toLowerCase()}" ${modalAttrs(p)}>
        ${slotContent(p)}
    </div>`;
}

/**
 * Attributi per aprire la scheda giocatore sul click, col contesto della
 * partita mostrata (punti, avversario, esito, stats): il modal ci costruisce
 * il blocco "Questa partita".
 */
function modalAttrs(p, isBench = false) {
    const game = {
        pts: pEffPts(p),
        opponent: p.opponent || '',
        status: p.status || '',
        week: currentWeek,
        year: currentYear,
        started: !isBench,
        stats: p.stats || {},
    };
    const payload = encodeURIComponent(JSON.stringify(game));
    return `data-player-modal
             data-player-name="${escAttr(p.name)}"
             data-pos="${escAttr((p.position || '').toUpperCase())}"
             data-nfl="${escAttr(p.nfl_team || '')}"
             data-year="${currentYear}"
             data-game="${payload}"`;
}

function escAttr(s) {
    return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

/** "Marvin Guiu" → "M. Guiu". Le DEF restano col nome squadra intero. */
function shortName(p) {
    const role = (p.position_in_team || p.position || '').toUpperCase();
    if (role === 'DEF') return p.name;
    const parts = String(p.name).trim().split(/\s+/);
    if (parts.length < 2) return p.name;
    return `${parts[0][0]}. ${parts.slice(1).join(' ')}`;
}

function slotContent(p) {
    const role = (p.position_in_team || p.position || '').toUpperCase();
    return `<span class="slot-photo"><img src="images/fallback-player.svg" alt="" loading="lazy"
                data-headshot data-player-name="${p.name}" data-team="${p.nfl_team || ''}"
                data-pos="${role}" data-year="${currentYear}"></span>
            <span class="slot-name">${shortName(p)}</span>
            <span class="slot-pts">${pPtsHTML(p)}</span>`;
}

/**
 * Riempie le foto degli slot. Torna una promessa che si chiude quando sono
 * dipinte: chi disegna la giornata la aspetta (con un tetto) per mostrare le
 * card già complete, invece di vederle spuntare una a una.
 */
function hydrateSlotPhotos(grid) {
    const imgs = [...grid.querySelectorAll('img[data-headshot]')];
    return Promise.all(imgs.map(async (img) => {
        img.onerror = () => {
            if (!img.src.endsWith('fallback-player.svg')) img.src = 'images/fallback-player.svg';
        };
        try {
            const url = await playerImageService.getPlayerImageUrl(
                img.dataset.playerName, img.dataset.team, img.dataset.pos, img.dataset.year);
            if (url) img.src = url;
        } catch { /* resta il fallback */ }
        await dipinta(img);
    }));
}

function renderRoster(team, side) {
    const starters = team.starters || [];

    const byPos = (pos, nth = 0) => {
        let count = 0;
        for (const p of starters) {
            const pPos = (p.position || '').toUpperCase();
            if (pPos === pos.toUpperCase() || (pos === 'FLEX' && pPos === 'W/R')) {
                if (count === nth) return p;
                count++;
            }
        }
        return null;
    };

    // Column: QB
    const qbCol =
        `<div class="formation-col col-qb">` +
        slotCard(byPos('QB', 0)) +
        `</div>`;

    // Column: RBs (behind QB, further from scrimmage)
    const rbCol =
        `<div class="formation-col col-rb">` +
        slotCard(byPos('RB', 0)) +
        slotCard(byPos('RB', 1)) +
        `</div>`;

    // Column: Line of scrimmage
    const lineCol =
        `<div class="formation-col col-line">` +
        slotCard(byPos('WR', 0)) +
        slotCard(byPos('TE', 0)) +
        olineSlot() + olineSlot() + olineSlot() + olineSlot() + olineSlot() +
        slotCard(byPos('FLEX', 0)) +
        slotCard(byPos('WR', 1)) +
        `</div>`;

    // Left team: RBs → QB → Line (faces right →)
    // Right team: Line → QB → RBs (faces left ←)
    if (side === 'left') {
        return rbCol + qbCol + lineCol;
    } else {
        return lineCol + qbCol + rbCol;
    }
}

function renderBench(team) {
    const bench = team.bench || [];
    if (!bench.length) return '';
    return bench.map(p => slotCard(p, true)).join('');
}

/** OL marker — small, transparent with dark border and X */
function olineSlot() {
    return `<div class="formation-slot oline-x">✕</div>`;
}

function slotCard(p, isBench = false) {
    if (!p) return '';
    return `<div class="formation-slot${isBench ? ' bench-slot' : ''}" ${modalAttrs(p, isBench)}>
        ${slotContent(p)}
    </div>`;
}

