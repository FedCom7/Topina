/**
 * Hall of Fame — le leggende della Topina League.
 * Un giocatore è eleggibile 2 anni pieni dopo l'ultima apparizione nei dati
 * (classe X → ritirati entro X-3), con almeno 3 stagioni in lega, DEF escluse.
 * Ballottaggio cumulativo: chi non viene eletto resta candidato negli anni
 * successivi. Criterio: punti fantasy totali carriera come voce principale,
 * più bonus per anelli SB, stagioni da Top 1 di ruolo e selezioni All-Pro
 * (1° e 2° team). Un eletto all'anno.
 */

import { fetchFantasyData, SEASONS, CURRENT_SEASON, getSeasonConfig, getSuperBowlMatchup } from '../data.js?v=5';
import { getHonorsBundle } from '../data/honors.js?v=1';
import { playerImageService } from '../services/player-image-service.js?v=4';

let initialized = false;
let careersCache = null;

const FIRST_CLASS_YEAR = 2022;
const MIN_SEASONS = 3;
const SB_BONUS = 120;
const TOP1_BONUS = 80;
const ALLPRO1_BONUS = 120;
const ALLPRO2_BONUS = 60;

export function initHallOfFame() {
    if (initialized) return;
    initialized = true;
    load();
}

async function load() {
    const wrap = document.getElementById('hof-content');
    if (!wrap) return;
    wrap.innerHTML = `<div class="loading-state"><div class="spinner"></div><p>Spoglio delle schede...</p></div>`;

    try {
        const careers = await buildCareers();
        await attachAllPro(careers);
        const classes = electClasses(careers);
        render(wrap, classes);
    } catch (e) {
        console.error('Hall of Fame error:', e);
        wrap.innerHTML = `<div class="empty-state"><div class="empty-state-icon">⚠️</div><p class="empty-state-text">Errore nel caricamento: ${e.message}</p></div>`;
    }
}

/* ============================================================
   CARRIERE
   ============================================================ */

async function buildCareers() {
    if (careersCache) return careersCache;

    const careers = new Map(); // name -> career

    for (const season of SEASONS) {
        let data;
        try {
            data = await fetchFantasyData(season);
        } catch (e) {
            console.warn(`HOF: dati ${season} non disponibili`, e);
            continue;
        }
        if (!data?.weeks) continue;

        const config = getSeasonConfig(season);
        const seasonTotals = new Map(); // name -> { position, pts } per il Top1 di ruolo

        // Campione della stagione (per gli anelli)
        let championName = null;
        const sbMatchup = getSuperBowlMatchup(data, season);
        if (sbMatchup?.team1 && sbMatchup?.team2) {
            const s1 = parseFloat(sbMatchup.team1.score);
            const s2 = parseFloat(sbMatchup.team2.score);
            if (s1 !== s2) championName = s1 > s2 ? sbMatchup.team1.name : sbMatchup.team2.name;
        }
        const championRing = new Set(); // giocatori nel roster del campione alla settimana del SB

        for (const [wkStr, wkData] of Object.entries(data.weeks)) {
            const wk = Number(wkStr);
            for (const m of wkData.matchups || []) {
                for (const side of [m.team1, m.team2]) {
                    if (!side?.name) continue;
                    const isChampSbWeek = championName && side.name === championName && wk === config.superBowlWeek;

                    for (const [list, started] of [[side.starters, true], [side.bench, false]]) {
                        for (const p of list || []) {
                            if (!p?.name) continue;
                            const pos = p.position_in_team || p.position;
                            if (pos === 'DEF') continue;

                            let c = careers.get(p.name);
                            if (!c) careers.set(p.name, c = {
                                name: p.name, position: pos, nflTeam: p.nfl_team || '',
                                seasons: new Set(), lastSeason: season,
                                totPts: 0, stats: {}, top1Count: 0, sbWins: 0, gamesStarted: 0,
                                firstTeam: 0, secondTeam: 0,
                            });
                            if (pos) c.position = pos;
                            if (p.nfl_team) c.nflTeam = p.nfl_team;
                            c.seasons.add(season);
                            if (season > c.lastSeason) c.lastSeason = season;
                            if (started) c.gamesStarted++;

                            const pts = parseFloat(p.fantasy_points || 0);
                            c.totPts += pts;
                            for (const [k, v] of Object.entries(p.stats || {})) {
                                c.stats[k] = (c.stats[k] || 0) + (Number(v) || 0);
                            }

                            // Totali stagionali per il Top1 di ruolo
                            let st = seasonTotals.get(p.name);
                            if (!st) seasonTotals.set(p.name, st = { position: pos, pts: 0 });
                            st.pts += pts;

                            if (isChampSbWeek) championRing.add(p.name);
                        }
                    }
                }
            }
        }

        // Top 1 di ruolo della stagione
        const bestByPos = {};
        for (const [name, st] of seasonTotals) {
            if (!bestByPos[st.position] || st.pts > bestByPos[st.position].pts) {
                bestByPos[st.position] = { name, pts: st.pts };
            }
        }
        for (const best of Object.values(bestByPos)) {
            const c = careers.get(best.name);
            if (c) c.top1Count++;
        }

        // Anelli
        for (const name of championRing) {
            const c = careers.get(name);
            if (c) c.sbWins++;
        }
    }

    careersCache = careers;
    return careers;
}

// Conta le apparizioni All-Pro (First/Second Team) per ogni carriera,
// riusando il calcolo della sezione All-Pro (js/data/honors.js).
async function attachAllPro(careers) {
    for (const year of SEASONS) {
        let bundle;
        try {
            bundle = await getHonorsBundle(year);
        } catch (e) {
            continue;
        }
        if (!bundle || !bundle.rsComplete) continue; // conta solo stagioni con RS conclusa
        for (const { player } of bundle.allPro.first) {
            const c = player && careers.get(player.name);
            if (c) c.firstTeam++;
        }
        for (const { player } of bundle.allPro.second) {
            const c = player && careers.get(player.name);
            if (c) c.secondTeam++;
        }
    }
}

/* ============================================================
   ELEZIONI — ballottaggio cumulativo, un eletto all'anno
   ============================================================ */

function electClasses(careers) {
    const classes = [];
    const inducted = new Set();

    for (let year = FIRST_CLASS_YEAR; year <= Number(CURRENT_SEASON); year++) {
        const cutoff = String(year - 3);

        // Coorte: ritirati da almeno 2 anni pieni, >=3 stagioni, non ancora eletti
        const ballot = [...careers.values()].filter(c =>
            c.lastSeason <= cutoff &&
            c.seasons.size >= MIN_SEASONS &&
            !inducted.has(c.name)
        );

        if (!ballot.length) {
            classes.push({ year, inductee: null });
            continue;
        }

        // Punti carriera come base + bonus anelli, Top 1 di ruolo e selezioni All-Pro
        const scored = ballot.map(c => {
            const score = c.totPts
                + SB_BONUS * c.sbWins
                + TOP1_BONUS * c.top1Count
                + ALLPRO1_BONUS * c.firstTeam
                + ALLPRO2_BONUS * c.secondTeam;
            return { career: c, score };
        }).sort((a, b) => b.score - a.score);

        const winner = scored[0];
        inducted.add(winner.career.name);
        classes.push({ year, inductee: winner.career });
    }

    return classes;
}

/* ============================================================
   RENDER — card Panini con cornice oro
   ============================================================ */

const fmt = (n, dec = 0) => Number(n || 0).toLocaleString('it-IT', { minimumFractionDigits: dec, maximumFractionDigits: dec });

function careerStatRows(c) {
    const rows = [];
    const s = c.stats;

    if (c.position === 'K') {
        const fg = (s.fg_0_19 || 0) + (s.fg_20_29 || 0) + (s.fg_30_39 || 0) + (s.fg_40_49 || 0) + (s.fg_50_plus || 0);
        rows.push(['Field Goal', fmt(fg)], ['PAT', fmt(s.pat_made)]);
    } else {
        // Tutte le categorie, ma solo se il giocatore ha prodotto qualcosa
        if (s.pass_yds > 0) rows.push(['Pass Yds', fmt(s.pass_yds)], ['Pass TD', fmt(s.pass_td)]);
        if (s.rush_yds > 0) rows.push(['Rush Yds', fmt(s.rush_yds)], ['Rush TD', fmt(s.rush_td)]);
        if (s.rec > 0) rows.push(['Ricezioni', fmt(s.rec)], ['Rec Yds', fmt(s.rec_yds)], ['Rec TD', fmt(s.rec_td)]);
    }

    rows.push(['Partite (Titolare)', c.gamesStarted]);
    if (c.sbWins > 0) rows.push(['Anelli SB 🏆', c.sbWins]);
    if (c.top1Count > 0) rows.push(['Stagioni Top 1', c.top1Count]);
    if (c.firstTeam > 0) rows.push(['All-Pro 1° Team', c.firstTeam]);
    if (c.secondTeam > 0) rows.push(['All-Pro 2° Team', c.secondTeam]);
    return rows;
}

function render(wrap, classes) {
    const withInductee = classes.filter(cl => cl.inductee);
    if (!withInductee.length) {
        wrap.innerHTML = `<div class="empty-state"><div class="empty-state-icon">🏛️</div><p class="empty-state-text">Nessun giocatore ancora eletto</p></div>`;
        return;
    }

    wrap.innerHTML = `
    <div class="hof-grid">
        ${withInductee.map((cl, i) => {
        const c = cl.inductee;
        return `
        <div class="hof-card-wrap" style="--card-i:${i}">
            <div class="hof-card" role="button" tabindex="0" aria-label="${c.name} — clicca per girare la carta">
                <div class="hof-card-flip">
                    <!-- Fronte: immagine -->
                    <div class="hof-card-face hof-card-front">
                        <div class="hof-card-inner">
                            <span class="hof-side-name">${c.name}</span>
                            <div class="hof-card-top">
                                <span class="hof-pos-badge">${c.position}</span>
                                <div class="hof-badges">
                                    ${c.sbWins > 0 ? `<span class="hof-stars">${'★'.repeat(c.sbWins)}</span>` : ''}
                                    ${c.firstTeam > 0 ? `<span class="hof-allpro hof-allpro--1">${c.firstTeam}× All-Pro 1</span>` : ''}
                                    ${c.secondTeam > 0 ? `<span class="hof-allpro hof-allpro--2">${c.secondTeam}× All-Pro 2</span>` : ''}
                                </div>
                            </div>
                            <div class="hof-headshot-wrap">
                                <img src="images/fallback-player.svg" class="hof-headshot" loading="lazy"
                                    data-player-name="${c.name}" data-team="${c.nflTeam || ''}" data-pos="${c.position || ''}" alt="${c.name}">
                            </div>
                            <div class="hof-front-stats">
                                <div class="hof-front-stat">
                                    <span class="hof-front-stat-value">${fmt(c.totPts)}</span>
                                    <span class="hof-front-stat-label">Punti Fantasy</span>
                                </div>
                                <div class="hof-front-stat">
                                    <span class="hof-front-stat-value">${c.seasons.size}</span>
                                    <span class="hof-front-stat-label">Stagioni</span>
                                </div>
                            </div>
                        </div>
                    </div>
                    <!-- Retro: statistiche -->
                    <div class="hof-card-face hof-card-back">
                        <div class="hof-card-inner">
                            <div class="hof-back-title">${c.name}</div>
                            <div class="hof-stats">
                                ${careerStatRows(c).map(([label, value]) => `
                                <div class="hof-stat-row">
                                    <span class="hof-stat-label">${label}</span>
                                    <span class="hof-stat-value">${value}</span>
                                </div>`).join('')}
                            </div>
                            <div class="hof-foil-label">Topina Hall of Fame</div>
                        </div>
                    </div>
                </div>
            </div>
            <div class="hof-caption">
                <span class="hof-caption-name">${c.name}</span>
                <span class="hof-caption-class">Classe ${cl.year}</span>
            </div>
        </div>`;
    }).join('')}
    </div>
    <p class="hof-footnote">Eleggibilità: 2 anni dal ritiro, minimo ${MIN_SEASONS} stagioni in lega. Un eletto all'anno dal ${FIRST_CLASS_YEAR}; i candidati non eletti restano in ballottaggio. Clicca una carta per girarla.</p>`;

    bindFlip(wrap);
    hydrateImages(wrap);
}

function bindFlip(wrap) {
    wrap.querySelectorAll('.hof-card').forEach(card => {
        const toggle = () => card.classList.toggle('flipped');
        card.addEventListener('click', toggle);
        card.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
        });
    });
}

function hydrateImages(wrap) {
    wrap.querySelectorAll('.hof-headshot').forEach(async (img) => {
        const name = img.dataset.playerName;
        if (!name) return;
        img.onerror = () => {
            if (!img.src.endsWith('images/fallback-player.svg')) img.src = 'images/fallback-player.svg';
        };
        try {
            const url = await playerImageService.getPlayerImageUrl(name, img.dataset.team, img.dataset.pos, CURRENT_SEASON);
            if (url) img.src = url;
        } catch (e) {
            /* fallback già impostato */
        }
    });
}
