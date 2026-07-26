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

import { getCareer, getPlayerAwards } from '../data/careers.js?v=4';
import { getSeasonStats, getSeasonProjections, matchProjection, normName } from '../data/projections.js?v=6';
import { TEAMS } from '../sections/team.js?v=12';
import { playerImageService } from '../services/player-image-service.js?v=4';
import { getPlayerInfo } from '../data/player-full.js?v=3';
import { getHallOfFameYear } from '../data/hall-of-fame.js?v=2';

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

    document.addEventListener('click', (e) => {
        const el = e.target.closest('[data-player-modal]');
        if (!el) return;
        const { playerName, pos, nfl, year } = el.dataset;
        if (!playerName) return;
        openPlayerModal({ name: playerName, pos: pos || '', nfl: nfl || '', year: year || '' });
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && _overlay && !_overlay.hidden) closePlayerModal();
    });
}

function ensureDom() {
    if (_overlay) return _overlay;
    _overlay = document.createElement('div');
    _overlay.className = 'pm-overlay';
    _overlay.hidden = true;
    _overlay.innerHTML = `
        <div class="pm-dialog" role="dialog" aria-modal="true" aria-label="Scheda giocatore">
            <button class="pm-close" aria-label="Chiudi">✕</button>
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

export async function openPlayerModal({ name, pos, nfl, year }) {
    const overlay = ensureDom();
    const dialog = overlay.querySelector('.pm-dialog');
    const content = overlay.querySelector('.pm-content');
    const token = ++_openToken;

    overlay.hidden = false;
    document.body.classList.add('pm-open');
    dialog.scrollTop = 0;

    const cacheKey = `${normName(name)}|${pos}`;
    if (_cache.has(cacheKey)) {
        const { html, color } = _cache.get(cacheKey);
        dialog.style.setProperty('--team-color', color || '');
        content.innerHTML = html;
        appendFullStatsLink(content, { name, pos, year });
        hydrateHeadshot(content, name, nfl, pos, year);
        return;
    }

    dialog.style.removeProperty('--team-color');
    content.innerHTML = `
        <div class="pm-layout">
            <div class="pm-left">${paniniCard({ name, pos, nfl })}</div>
            <div class="pm-right">
                <div class="loading-state"><div class="spinner"></div><p>Apertura della scheda...</p></div>
            </div>
        </div>`;
    hydrateHeadshot(content, name, nfl, pos, year);

    try {
        const { html, color } = await buildCard({ name, pos, nfl, year });
        if (token !== _openToken) return; // nel frattempo è stata aperta un'altra scheda
        _cache.set(cacheKey, { html, color });
        dialog.style.setProperty('--team-color', color || '');
        content.innerHTML = html;
        appendFullStatsLink(content, { name, pos, year });
        hydrateHeadshot(content, name, nfl, pos, year);
    } catch (e) {
        console.error('[player-modal]', e);
        if (token !== _openToken) return;
        content.querySelector('.loading-state')?.replaceWith(
            Object.assign(document.createElement('p'), {
                className: 'pm-error', textContent: 'Errore nel caricamento della scheda.',
            }));
    }
}

/**
 * Link alla pagina completa. Aggiunto fuori da buildCard perché l'HTML
 * della scheda è cachato per giocatore e congelerebbe l'anno del primo open.
 */
function appendFullStatsLink(content, { name, pos, year }) {
    const y = year || new Date().getFullYear();
    content.insertAdjacentHTML('beforeend',
        `<a class="pm-fullstats" href="#player/${y}/${pos || ''}/${encodeURIComponent(name)}">Apri tutte le statistiche →</a>`);
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

    const html = `
        <div class="pm-layout">
            <div class="pm-left">${paniniCard({ name, pos, nfl, info, career, hofYear })}</div>
            <div class="pm-right">
                ${bigStatsBlock(career)}
                ${careerTableBlock(name, pos, years, byYear, career)}
            </div>
        </div>
        ${awardsBlock(career, awards)}`;

    return { html, color };
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
export function paniniCard({ name, pos, nfl, info, career, hofYear }) {
    const gold = !!hofYear;
    const stars = career?.sbWins ? '★'.repeat(Math.min(career.sbWins, 5)) : '';
    const bio = bioLine(info);
    const seasons = career ? `${career.seasons.size} stagion${career.seasons.size === 1 ? 'e' : 'i'} Topina` : '';

    return `
    <div class="pm-panini${gold ? ' pm-panini--gold' : ''}">
        <div class="pm-panini-inner">
            <span class="pm-panini-side-name">${name}</span>
            <div class="pm-panini-top">
                ${pos ? `<span class="pm-panini-pos">${pos}</span>` : '<span></span>'}
                <div class="pm-panini-badges">
                    ${stars ? `<span class="pm-panini-stars">${stars}</span>` : ''}
                    ${career?.firstTeam ? `<span class="pm-panini-allpro pm-panini-allpro--1">${career.firstTeam}× AP1</span>` : ''}
                    ${career?.secondTeam ? `<span class="pm-panini-allpro pm-panini-allpro--2">${career.secondTeam}× AP2</span>` : ''}
                </div>
            </div>
            <div class="pm-panini-photo-wrap">
                <img class="pm-headshot pm-panini-photo" src="images/fallback-player.svg" alt="${name}"
                     data-player-name="${name}" data-team="${nfl || ''}" data-pos="${pos || ''}">
            </div>
            ${bio || seasons ? `
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
        [fmt0(career.totPts), 'Punti fantasy'],
        [career.seasons.size, 'Stagioni'],
        [fmt0(career.gamesStarted), 'Da titolare'],
    ];
    if (career.sbWins) items.push([`×${career.sbWins}`, 'Anelli SB']);
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
        <span class="mc-kicker">Statistiche per stagione</span>
        <div class="pm-table-wrap">
            <table class="pm-table">
                <thead><tr><th>Anno</th><th>NFL</th><th>GP</th><th>Proj</th><th>Punti</th><th>Rank</th><th>Topina</th><th>Titolare</th></tr></thead>
                <tbody>${rows}</tbody>
            </table>
        </div>
        <p class="pm-note">Punti nello scoring della lega: reali Topina dove disponibili, altrimenti ricalcolati da Sleeper. «Proj» è la proiezione preseason (dal 2018).</p>
    </section>`;
}

// ─── Blocco: carriera Topina ─────────────────────────────────────

export function topinaBlock(career) {
    if (!career) {
        return `
        <section class="pm-block">
            <span class="mc-kicker">Carriera Topina</span>
            <p class="pm-empty">Mai schierato in Topina League.</p>
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
            ? `draftato #${dr.pick} (R${dr.round}) da ${TEAMS[dr.teamKey].name}` : 'non draftato (waiver/mercato)';
        return `
        <div class="pm-season-row">
            <span class="pm-season-year">${y}</span>
            <span class="pm-season-logos">${logos}</span>
            <span class="pm-season-pts">${fmt0(bs.pts)} pt</span>
            <span class="pm-season-note">${bs.gamesStarted} da titolare · ${drLabel}</span>
        </div>`;
    }).join('');

    // draft già fatto per una stagione non ancora nei dati (es. anno prossimo)
    const upcoming = career.draftedBy.filter(d => !career.bySeason[d.year] && TEAMS[d.teamKey])
        .map(d => `
        <div class="pm-season-row pm-season-row--future">
            <span class="pm-season-year">${d.year}</span>
            <span class="pm-season-logos"><img class="pm-team-logo" src="${TEAMS[d.teamKey].logo}" alt="" onerror="this.style.display='none'"></span>
            <span class="pm-season-pts">—</span>
            <span class="pm-season-note">draftato #${d.pick} (R${d.round}) da ${TEAMS[d.teamKey].name}</span>
        </div>`).join('');

    return `
    <section class="pm-block">
        <span class="mc-kicker">Carriera Topina</span>
        <div class="pm-ministats">
            <div class="ministat"><span class="ministat-value">${fmt0(career.totPts)}</span><span class="ministat-label">Punti fantasy</span></div>
            <div class="ministat"><span class="ministat-value">${career.seasons.size}</span><span class="ministat-label">Stagioni</span></div>
            <div class="ministat"><span class="ministat-value">${fmt0(career.gamesStarted)}</span><span class="ministat-label">Da titolare</span></div>
        </div>
        <div class="pm-seasons">${seasonRows}${upcoming}</div>
    </section>`;
}

// ─── Blocco: bacheca premi ───────────────────────────────────────

export function awardsBlock(career, awards) {
    const chips = [];
    for (const a of awards.awards) {
        chips.push(`<span class="pm-award">${a.icon} ${a.name} <b>${a.year}</b></span>`);
    }
    if (awards.allProFirst.length) {
        chips.push(`<span class="pm-award pm-award--gold">🥇 All-Pro 1° Team <b>${awards.allProFirst.join(', ')}</b></span>`);
    }
    if (awards.allProSecond.length) {
        chips.push(`<span class="pm-award">🥈 All-Pro 2° Team <b>${awards.allProSecond.join(', ')}</b></span>`);
    }
    if (career?.sbWins) {
        chips.push(`<span class="pm-award pm-award--gold">🏆 Anell${career.sbWins === 1 ? 'o' : 'i'} Super Bowl ×${career.sbWins}</span>`);
    }
    if (career?.top1Count) {
        chips.push(`<span class="pm-award">⭐ Top 1 di ruolo ×${career.top1Count}</span>`);
    }

    return `
    <section class="pm-block">
        <span class="mc-kicker">Bacheca premi</span>
        ${chips.length ? `<div class="pm-awards">${chips.join('')}</div>`
            : `<p class="pm-empty">Nessun premio in bacheca (per ora).</p>`}
    </section>`;
}
