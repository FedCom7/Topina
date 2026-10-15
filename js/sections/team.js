/**
 * Team Page Section — Franchise page
 * Attivata via hash #team-capi | #team-lasers | #team-oscurus | #team-sommo
 *
 * Sopra l'hero (badge, nome, Topina Bowl, quickstats). Sotto, sette capitoli
 * con una barra che li segue scorrendo: la stagione in corso, la bacheca, anno
 * per anno, la rosa, draft e allenatore, le rivalità, l'identità (colori e
 * divise). L'ordine è quello delle domande di chi apre la pagina: come va
 * adesso, cosa ha vinto, com'è andata negli anni, chi c'è in campo.
 *
 * La barra dei capitoli NON usa link `#tp-…`: il router è a hash, e un
 * `href="#tp-season"` porterebbe via dalla pagina squadra. Sono bottoni che
 * scorrono.
 */

import { getLeagueData, TEAM_KEY_LIST } from '../data/league-data.js?v=586';
import { computeTeamBadges } from '../data/badges.js?v=559';
import { stickerSVG, champStickerSVG, fitStickerTexts } from '../ui/badge-svg.js?v=521';
import { superBowlLogoSVG, sbEdition, faceFor, ensureFaceFont } from '../ui/sb-logo-svg.js?v=13';
import { paniniCard, initPlayerModal, hydratePaniniBadges } from '../components/player-modal.js?v=798';
import { playerImageService } from '../services/player-image-service.js?v=533';
import { apHalfFieldSvg, sbLineup } from '../ui/field-allpro.js?v=13';
import { hydrateFieldPhotos } from '../ui/field-formation.js?v=3';
import { CURRENT_SEASON, fetchFantasyData, SEASONS, SEASONS_DESC, displayName, getSeasonConfig } from '../data.js?v=595';
import { getWaiverMoves } from '../data/waiver-moves.js?v=29';
import { TEAM_PALETTE, TEAM_KEYS, teamPaletteVars } from '../data/team-config.js?v=538';
import { teamLoader } from '../ui/loading-page.js?v=6';
import { niceTicks } from '../ui/charts.js?v=9';
import { uniformSVG, uniformsFor } from '../ui/uniform-svg.js?v=5';
import { getManagerDNA, CONFIDENCE_LABEL, CONFIDENCE_NOTE } from '../data/manager-dna.js?v=2';
import { fetchSeasonSchedule } from '../data/espn-fantasy.js?v=178';

// Il motore del Draft Grade si carica solo quando il capitolo Draft entra a
// schermo: sono proiezioni di sette stagioni, e chi guarda la classifica in
// cima non deve pagarle. La versione è la stessa degli altri import di
// draftgrades.js, o il modulo verrebbe caricato due volte con due cache.
const loadDraftGrades = () => import('./draftgrades.js?v=839');

// Converte numero in romano per gli sticker Super Bowl (stagione 2019 = I, 2020 = II, …)
function _toRoman(n) {
    const vals = [[10,'X'],[9,'IX'],[5,'V'],[4,'IV'],[1,'I']];
    let r = '';
    for (const [v, s] of vals) { while (n >= v) { r += s; n -= v; } }
    return r;
}

function _sbRoman(year) {
    return _toRoman(parseInt(year) - 2018);
}

/* `color` è il ruolo `identity` della palette in js/data/team-config.js, non
   un valore scritto qui: le tinte di una squadra stanno in un posto solo,
   e cambiarle là le cambia ovunque. Le divise non sono più un JPG per squadra:
   le disegna js/ui/uniform-svg.js con le stesse tinte. */
export const TEAMS = {
    capi: {
        key: 'capi',
        name: 'Capi dei Pianeti',
        color: TEAM_PALETTE.capi.identity,
        logo: 'Team%20Logo/team_capi_transparent.png',
        bio: `Founded in 2019 with the vision of those who look far ahead, Capi dei Pianeti have always operated on a different scale. Their orange burns like the sun of a distant solar system: impossible to ignore, impossible not to recognize. Every draft has been a planned invasion, every season a conquest. They don't play in a league — they rule a universe.`,
    },
    lasers: {
        key: 'lasers',
        name: 'Lasers',
        color: TEAM_PALETTE.lasers.identity,
        logo: 'Team%20Logo/team_lasers_transparent.png',
        bio: `The Lasers don't shout. They cut. Since 2019, this franchise has built its identity on absolute precision: every draft pick a calculated move, every lineup a perfect formula. The gold in their emblem isn't decoration — it's the signature of those who don't make mistakes. When the Lasers fire the beam, the game is already decided.`,
    },
    oscurus: {
        key: 'oscurus',
        name: 'Oscurus',
        color: TEAM_PALETTE.oscurus.identity,
        logo: 'Team%20Logo/team_oscurus_transparent.png',
        bio: `From darkness rise the dominators. Oscurus has existed since 2019 as a silent force that grows in the shadows until it's too late to stop it. Their dark maroon crest speaks of blood spilled every week, of broken defenses and victories built with iron. They don't seek the crowd's love — they seek the ring. And when they find it, no one is surprised.`,
    },
    sommo: {
        key: 'sommo',
        name: 'Sommo',
        color: TEAM_PALETTE.sommo.identity,
        logo: 'Team%20Logo/team_sommo_transparent.png',
        bio: `The name doesn't lie. Sommo has been, since 2019, the franchise that chose the path of strategy where others chose instinct. Their midnight green is that of deep water at night, of long-term plans, of decisions that only make sense in hindsight. There's no need to shout when you're already the strongest in the room.`,
    },
};

let _badgesByTile = null; // badge correnti indicizzati per il popover

const CHAPTERS = [
    ['season', 'This Season'],
    ['trophies', 'Trophy Room'],
    ['years', 'Year by Year'],
    ['roster', 'Roster'],
    ['draft', 'Draft & Manager'],
    ['rivals', 'Rivalries'],
    ['identity', 'Identity'],
];

const ordinal = (n) => `${n}${n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th'}`;
const recordStr = (w, l, t) => `${w}–${l}${t ? `–${t}` : ''}`;
const resultOf = (g) => g.pts > g.oppPts ? 'W' : g.pts < g.oppPts ? 'L' : 'T';

function chapterHead(n, id, title, sub = '') {
    return `
    <header class="tp-ch-head">
        <span class="tp-ch-n">${String(n).padStart(2, '0')}</span>
        <h2 class="tp-ch-title">${title}</h2>
        <span class="tp-ch-stripe" aria-hidden="true"><i></i><i></i><i></i></span>
        <span class="tp-ch-sub" id="tp-${id}-sub">${sub}</span>
    </header>`;
}

/* Il corpo della pagina. Non si stampa al primo render: finche' i dati non ci
   sono al suo posto c'e' UN caricamento grosso, non venti spinnerini dentro
   venti riquadri vuoti. L'hero sopra invece si stampa subito: nome, colori e
   logo non aspettano nessuna fetch.
   I `${spinner}` qui dentro restano: valgono per i riquadri che DOPO si
   riempiono per conto loro (rosa, waiver, draft fanno le loro richieste). */
function pageHTML(team, spinner) {
    return `
    <div class="section-inner team-bento" id="team-bento">
        <nav class="tp-nav" id="tp-nav" aria-label="${team.name} chapters">
            <div class="tp-nav-track">${CHAPTERS.map(([id, label], i) => `
                <button type="button" class="tp-nav-btn" data-ch="${id}">
                    <span class="tp-nav-n">${String(i + 1).padStart(2, '0')}</span>${label}
                </button>`).join('')}
            </div>
        </nav>

        <section class="tp-chapter" id="tp-season" data-ch="season">
            ${chapterHead(1, 'season', 'This Season')}
            <div class="tp-grid">
                <div class="bento-cell cell-season" style="--cell-i:0"><div id="team-season">${spinner}</div></div>
            </div>
        </section>

        <section class="tp-chapter" id="tp-trophies" data-ch="trophies">
            ${chapterHead(2, 'trophies', 'Trophy Room', 'Titles, finals and franchise records')}
            <div class="tp-grid">
                <div class="bento-cell cell-shelf" style="--cell-i:1"><div id="team-shelf"></div></div>
                <div class="bento-cell cell-records" style="--cell-i:2">
                    <div class="bento-cell-head">
                        <h3 class="bento-cell-title">Franchise Records</h3>
                        <span class="bento-cell-sub">Regular season · <span class="tr-lr-key">League record</span> = best of all four</span>
                    </div>
                    <div id="team-records"></div>
                </div>
            </div>
        </section>

        <section class="tp-chapter" id="tp-years" data-ch="years">
            ${chapterHead(3, 'years', 'Year by Year', 'Pick a season')}
            <div class="tp-grid">
                <div class="bento-cell cell-history" style="--cell-i:3">
                    <div class="bento-cell-head"><h3 class="bento-cell-title">Seasons</h3></div>
                    <div id="team-history"></div>
                </div>
                <div class="bento-cell cell-years" style="--cell-i:4"><div id="team-years"></div></div>
            </div>
        </section>

        <section class="tp-chapter" id="tp-roster" data-ch="roster">
            ${chapterHead(4, 'roster', 'Roster')}
            <div class="tp-grid">
                <div class="bento-cell cell-roster" style="--cell-i:5">
                    <div class="bento-cell-head">
                        <h3 class="bento-cell-title">The Lineup</h3>
                        <span class="bento-cell-sub" id="team-roster-sub">Last completed week</span>
                    </div>
                    <div id="team-roster">${spinner}</div>
                </div>
                <div class="bento-cell cell-bench" style="--cell-i:6">
                    <div class="bento-cell-head">
                        <h3 class="bento-cell-title">Bench</h3>
                        <span class="bento-cell-sub" id="team-bench-sub">Reserves</span>
                    </div>
                    <div id="team-bench">${spinner}</div>
                </div>
                <div class="bento-cell cell-waivers" style="--cell-i:7">
                    <div class="bento-cell-head">
                        <h3 class="bento-cell-title">Waiver Wire</h3>
                        <span class="bento-cell-sub" id="team-waivers-sub">In and out</span>
                    </div>
                    <div id="team-waivers">${spinner}</div>
                </div>
            </div>
        </section>

        <section class="tp-chapter" id="tp-draft" data-ch="draft">
            ${chapterHead(5, 'draft', 'Draft & Manager')}
            <div class="tp-grid">
                <div class="bento-cell cell-dna" style="--cell-i:8"><div id="team-dna">${spinner}</div></div>
                <div class="bento-cell cell-drafts" style="--cell-i:9">
                    <div class="bento-cell-head">
                        <h3 class="bento-cell-title">Draft Grades</h3>
                        <span class="bento-cell-sub">Judged on draft-day projections</span>
                    </div>
                    <div id="team-drafts"></div>
                </div>
                <div class="bento-cell cell-players" style="--cell-i:10">
                    <div class="bento-cell-head">
                        <h3 class="bento-cell-title">Franchise Players</h3>
                        <span class="bento-cell-sub">Drafted in 3+ seasons</span>
                    </div>
                    <div class="team-flags" id="team-flags">${spinner}</div>
                </div>
            </div>
        </section>

        <section class="tp-chapter" id="tp-rivals" data-ch="rivals">
            ${chapterHead(6, 'rivals', 'Rivalries', 'Regular-season head to head')}
            <div class="tp-grid" id="team-rivals"></div>
        </section>

        <section class="tp-chapter" id="tp-identity" data-ch="identity">
            ${chapterHead(7, 'identity', 'Identity')}
            <div class="tp-grid">
                <div class="bento-cell cell-identity" style="--cell-i:11">
                    <div class="team-identity-head">
                        <img src="${team.logo}" alt="${team.name}" class="team-identity-logo"
                             onerror="this.style.display='none'">
                        <div>
                            <h3 class="bento-cell-title">The Franchise</h3>
                            <span class="team-identity-sub">Since 2019</span>
                        </div>
                    </div>
                    <p class="team-bio">${team.bio}</p>
                </div>
                <div class="bento-cell cell-colors" style="--cell-i:12">
                    <div class="bento-cell-head">
                        <h3 class="bento-cell-title">Colors</h3>
                        <span class="bento-cell-sub">Click a colour to copy it</span>
                    </div>
                    <div id="team-colors"></div>
                </div>
                <div class="bento-cell cell-uniform" style="--cell-i:13">
                    <div class="bento-cell-head">
                        <h3 class="bento-cell-title">Uniforms</h3>
                        <span class="bento-cell-sub">Pick a set, then mix helmet, jersey and pants</span>
                    </div>
                    <div id="team-uniform"></div>
                </div>
            </div>
        </section>
    </div>`;
}

export function initTeam() {
    const hash = location.hash.slice(1); // es. 'team-capi'
    const teamKey = hash.replace('team-', '');
    const team = TEAMS[teamKey];
    if (!team) return;

    const section = document.getElementById('team');
    section.setAttribute('style', teamPaletteVars(team.key));

    const spinner = '<div class="loading-state"><div class="spinner"></div></div>';
    section.innerHTML = `
        <header class="team-hero">
            <div class="th-bg">
                <div class="th-glow th-glow-a"></div>
                <div class="th-glow th-glow-b"></div>
                <div class="th-grid"></div>
            </div>
            <img class="th-watermark" src="${team.logo}" alt="" aria-hidden="true"
                 onerror="this.style.display='none'">
            <div class="th-sb-stickers" id="team-sb-stickers"></div>
            <div class="sticker-field" id="team-stickers"></div>
            <div class="th-content section-inner">
                <span class="th-kicker">Topina League · Est. 2019</span>
                <h1 class="th-name">${team.name}</h1>
                <div class="th-quickstats" id="team-quickstats"></div>
                <div class="badge-pop" id="badge-pop" hidden></div>
            </div>
            <div class="th-fade"></div>
        </header>
        <!-- stessa classe del corpo vero, team-bento: ha un margin-top di
             -84px che lo fa risalire sotto l'hero, e senza il caricamento
             starebbe 84px piu' in basso del contenuto che sostituisce. -->
        <div class="section-inner team-bento" id="team-body">${teamLoader(team.logo, team.color, `Opening the ${team.name} vault`)}</div>
    `;

    getLeagueData().then(league => {
        // Se nel frattempo l'utente ha cambiato pagina, non renderizzare
        if (!location.hash.includes(team.key)) return;
        // il corpo nasce adesso, al posto del caricamento
        document.getElementById('team-body').outerHTML = pageHTML(team, spinner);
        const at = league.allTime[team.key];
        const lastComplete = [...league.seasons].reverse().find(s => s.complete);
        const isReigningChamp = lastComplete?.sbWinnerKey === team.key;
        renderSBStickers(at.sbWins);
        renderQuickStats(at);
        renderStickers(computeTeamBadges(league, team.key), isReigningChamp, lastComplete?.year);
        bindChapterNav(section);
        renderSeason(league, team);
        renderShelf(at);
        renderRecords(league, team.key);
        renderYears(league, team);
        renderRoster(team, league);
        renderWaivers(team);
        renderDNA(team);
        renderDrafts(league, team);
        renderFlags(league.franchisePlayers[team.key] || []);
        renderRivals(league, team.key);
        renderColors(team);
        renderUniforms(team);
        bindTips(section);
        bindStickerPop(section);
    }).catch(e => {
        console.error('Team page load error:', e);
    });
}

/* ─── Hero: i Topina Bowl vinti (in alto a destra, uno per titolo) ───
   Fino al 2026-09-08 qui c'era lo sticker ovale di `badge-svg.js`: numero
   romano dentro un ovale nei colori del team, tre righe di testo in 96×56.
   Adesso c'è il LOGO dell'edizione — lo stesso che il Game Center dipinge sul
   campo della finale — così il titolo del 2025 si riconosce dal suo logo e non
   da una scritta.

   `crop` toglie l'aria sopra e sotto il marchio: dentro un riquadro di 104px
   la tela quadrata sprecherebbe un terzo dell'altezza. Il rapporto del
   riquadro nel CSS (104×84) è quello del marchio, se no il logo entra
   rimpicciolito.

   Il carattere del numero cambia ogni sette edizioni: dalla VIII in poi va
   chiesto, perché il sito carica a monte solo Archivo Black. */
function renderSBStickers(years) {
    const el = document.getElementById('team-sb-stickers');
    if (!el) return;
    if (!years.length) { el.innerHTML = ''; return; }
    el.innerHTML = years.map((year, i) => {
        const ed = sbEdition(year);
        ensureFaceFont(faceFor(ed));
        return `
        <div class="sb-sticker" style="--stk-i:${i}" title="Topina Bowl ${_sbRoman(year)} — ${year}">
            ${superBowlLogoSVG({ edition: ed, crop: true, className: 'sb-logo-badge', idPrefix: `hero-${year}` })}
        </div>`;
    }).join('');
}

function renderQuickStats(at) {
    const el = document.getElementById('team-quickstats');
    if (!el) return;
    const winPct = at.games ? (at.w / at.games * 100) : 0;
    const chips = [
        { label: 'Record', value: `${at.w}–${at.l}${at.t ? `–${at.t}` : ''}` },
        { label: 'Win %', value: `${winPct.toFixed(1)}%`, count: winPct, decimals: 1, suffix: '%' },
        { label: 'Titles', value: String(at.sbWins.length), count: at.sbWins.length, decimals: 0 },
        { label: 'Points scored', value: fmtPts(at.pf), count: at.pf, decimals: 0 },
    ];
    el.innerHTML = chips.map((c, i) => `
        <div class="th-chip" style="--chip-i:${i}">
            <span class="th-chip-value" ${c.count != null ? `data-count="${c.count}" data-decimals="${c.decimals}" data-suffix="${c.suffix || ''}"` : ''}>${c.value}</span>
            <span class="th-chip-label">${c.label}</span>
        </div>
    `).join('');
    el.querySelectorAll('[data-count]').forEach(_countUp);
}

function _countUp(el) {
    const target = parseFloat(el.dataset.count);
    const decimals = parseInt(el.dataset.decimals) || 0;
    const suffix = el.dataset.suffix || '';
    const dur = 900;
    const fmt = (v) => decimals ? v.toFixed(decimals) : Math.round(v).toLocaleString('it-IT');
    const start = performance.now();
    const tick = (now) => {
        const p = Math.min((now - start) / dur, 1);
        const eased = 1 - Math.pow(1 - p, 3);
        el.textContent = fmt(target * eased) + suffix;
        if (p < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
}

function fmtPts(n) {
    return Math.round(n).toLocaleString('it-IT');
}

// ─── Hero: sticker wall (solo badge sbloccati) ───────────────────

let _lastStickerArgs = null; // per ricalcolare il layout al resize

// Le misure del titolo sono affidabili solo a layout stabile: rimanda di
// due frame il primo calcolo (font e reflow del contenuto appena iniettato)
function renderStickers(...args) {
    requestAnimationFrame(() => requestAnimationFrame(() => _renderStickers(...args)));
}

function _renderStickers(badges, isReigningChamp, champYear) {
    _lastStickerArgs = [badges, isReigningChamp, champYear];
    const field = document.getElementById('team-stickers');
    const nameEl = document.querySelector('#team .th-name');
    if (!field || !nameEl) return;

    _badgesByTile = {};
    const jitter = (i, freq, amp) => Math.sin((i + 1) * freq) * amp;

    // Lista sticker: UNO per ogni conquista (come sul casco: ogni volta
    // che lo vinci, un nuovo adesivo) + campione in carica al centro
    const items = [];
    badges.filter(b => b.earned).forEach(b => {
        b.instances.forEach((inst, k) => {
            const tileId = `${b.id}-${k}`;
            _badgesByTile[tileId] = { badge: b, instance: inst };
            /* Dentro l'ovale: il numero che il badge si è portato dietro
               (punti, striscia, margine, milestone) e in mancanza l'anno.
               `comp` decide la forma di ciò che ci sta dentro — vedi
               COMPOSITIONS in ui/badge-svg.js. */
            const text = inst.iconText || inst.season || null;
            items.push({
                id: tileId, name: b.name, champ: false,
                svg: stickerSVG({ comp: b.comp, icon: b.icon, label: b.label || b.name, word: b.word, text }),
            });
        });
    });
    if (isReigningChamp) {
        _badgesByTile['reigning-champ'] = {
            badge: {
                name: 'Reigning Champion',
                description: `Holder of the ${champYear} Topina League title.`,
                instances: [{ season: champYear, detail: 'Reigns until someone dethrones them' }],
            },
        };
        // Al CENTRO della rosa: è il primo della spirale
        items.unshift({
            id: 'reigning-champ', name: 'Reigning Champion', svg: champStickerSVG(), champ: true,
        });
    }

    const kickerEl = document.querySelector('#team .th-kicker');
    const fw0 = field.getBoundingClientRect().width;
    const isMobile = fw0 < 640;
    const w = isMobile ? 58 : 96;
    const h = w * 56 / 96;
    const GAP = 4; // sticker quasi attaccati, come sul foglio reale

    // Assicura abbastanza spazio sopra il titolo per TUTTI gli sticker:
    // adatta il padding-top dell'hero al numero di badge (contando anche
    // le celle occupate dal campione e dagli sticker Super Bowl)
    const contentEl = document.querySelector('#team .th-content');
    if (contentEl) {
        const cols = Math.max(3, Math.floor((fw0 * 0.96) / (w + GAP)));
        const rowsNeeded = Math.ceil((items.length + 6) / cols);
        const basePad = isMobile ? 196 : 248;
        const sbSpace = isMobile ? 66 : 96;
        contentEl.style.paddingTop = Math.max(basePad, sbSpace + rowsNeeded * (h + GAP) + 24) + 'px';
    }

    const fieldRect = field.getBoundingClientRect();
    const nameRect = nameEl.getBoundingClientRect();
    const fw = fieldRect.width;
    const fh = fieldRect.height;

    const boundY = ((kickerEl || nameEl).getBoundingClientRect().top) - fieldRect.top; // inizio fascia titolo
    const nameLeft = nameRect.left - fieldRect.left;
    const nameRight = nameLeft + nameRect.width;
    const nameCx = (nameLeft + nameRight) / 2;
    const nameBottom = (nameRect.top - fieldRect.top) + nameRect.height;

    const clamp = (v, min, max) => Math.max(min, Math.min(v, max));

    const cx = clamp(nameCx, w * 1.6, fw - w * 1.6);          // sopra il nome
    const cy = Math.max(boundY - 14 - h / 2, h / 2 + 4);      // riga base appena sopra il titolo

    // Griglia esagonale di celle disgiunte (zero sovrapposizioni per
    // costruzione), riempita in ordine di distanza dal centro dello spazio
    // vuoto: prima a cerchio, poi in orizzontale; le celle sulla fascia del
    // titolo vengono saltate, così il surplus scivola ai lati del nome.
    const cellW = w + GAP;
    const cellH = h + GAP;
    const cells = [];
    for (let j = -3; j <= 12; j++) {
        for (let i = -10; i <= 10; i++) {
            const x = cx + (i + (j % 2 ? 0.5 : 0)) * cellW;
            const y = cy - j * cellH; // j>0 = righe sopra, j<0 = fianchi del nome
            // ordina: cerchio dal centro (la distanza verticale pesa un po' di più,
            // così si allarga in orizzontale quando lo spazio sopra finisce)
            cells.push({ x, y, d: Math.hypot(x - cx, (y - cy) * 1.2) });
        }
    }
    cells.sort((a, b) => a.d - b.d);

    const title = { left: nameLeft - 6, right: nameRight + 6, top: boundY - 6, bottom: nameBottom + 6 };
    const boxes = []; // già piazzati
    // Gli sticker Super Bowl (in alto a dx) sono zona occupata
    const sbEl = document.getElementById('team-sb-stickers');
    if (sbEl?.children.length) {
        const r = sbEl.getBoundingClientRect();
        boxes.push({
            l: r.left - fieldRect.left - 4, t: r.top - fieldRect.top - 4,
            r: r.right - fieldRect.left + 4, b: r.bottom - fieldRect.top + 4,
        });
    }
    const collides = (l, t, r, btm) =>
        (r > title.left && l < title.right && btm > title.top && t < title.bottom)
        || boxes.some(bx => r > bx.l && l < bx.r && btm > bx.t && t < bx.b);

    const nodes = items.map(it => {
        const iw = it.champ ? w * 0.78 : w;
        const ih = it.champ ? iw * 522 / 395 : h; // proporzioni di SB-Champ-sticker.png
        if (it.champ) {
            // Campione in carica: al centro, a cavallo delle righe,
            // col fondo allineato alla riga base (come il CFP sul casco)
            const x = cx;
            const y = Math.max(cy + (h - ih) / 2, ih / 2 + 2);
            boxes.push({ l: x - iw / 2, t: y - ih / 2, r: x + iw / 2, b: y + ih / 2 });
            // Celle "hug" appiccicate ai bordi del campione: gli altri
            // sticker lo circondano da vicino invece di lasciare vuoto
            const hx = iw / 2 + GAP / 2 + w / 2;
            const hugs = [
                { x: x - hx, y: y + ih / 2 - h / 2 },       // sx in basso
                { x: x + hx, y: y + ih / 2 - h / 2 },       // dx in basso
                { x: x - hx, y: y + ih / 2 - h * 1.5 - GAP }, // sx in alto
                { x: x + hx, y: y + ih / 2 - h * 1.5 - GAP }, // dx in alto
                { x, y: y - ih / 2 - GAP / 2 - h / 2 },     // sopra, centrato
            ];
            cells.unshift(...hugs.map(c => ({ ...c, d: -1 })));
            return { it, iw, ih, x, y };
        }
        for (const c of cells) {
            const l = c.x - iw / 2, r = c.x + iw / 2;
            const t = c.y - ih / 2, btm = c.y + ih / 2;
            // mai sotto il fondo del nome (zona chips) né fuori dal campo
            if (t < 2 || btm > nameBottom + 6 || l < 2 || r > fw - 2) continue;
            if (collides(l - 2, t - 2, r + 2, btm + 2)) continue;
            boxes.push({ l, t, r, b: btm });
            return { it, iw, ih, x: c.x, y: c.y };
        }
        return { it, iw, ih, x: cx, y: cy }; // fallback (non dovrebbe accadere)
    });

    field.innerHTML = nodes.map((nd, i) => {
        const rot = (nd.it.champ ? -3 : jitter(i, 4.7, 7)).toFixed(1);
        const left = nd.x - nd.iw / 2 + jitter(i, 12.9898, 1.5);
        const top = nd.y - nd.ih / 2 + jitter(i, 78.233, 1.5);
        return `
        <button type="button" class="sticker${nd.it.champ ? ' sticker--champ' : ''}" data-tile="${nd.it.id}" aria-label="${nd.it.name}"
                style="--stk-i:${i};--rot:${rot}deg;left:${left.toFixed(0)}px;top:${top.toFixed(0)}px;width:${nd.iw.toFixed(0)}px">
            ${nd.it.svg}
        </button>`;
    }).join('');

    /* Le scritte dentro gli sticker si misurano solo una volta che sono nel
       documento: la stima a monte non sa quanto è larga davvero una parola, e
       Archivo Black si scarica quando serve, non all'apertura della pagina. */
    fitStickerTexts(field);

    if (!_resizeBound) {
        _resizeBound = true;
        let t = null;
        window.addEventListener('resize', () => {
            clearTimeout(t);
            t = setTimeout(() => {
                if (_lastStickerArgs && document.getElementById('team-stickers')) {
                    renderStickers(..._lastStickerArgs);
                }
            }, 150);
        });
    }
    // Il primo render può avvenire prima che il font display sia caricato: le misure
    // del nome cambiano col font → ricalcola il layout quando i font sono pronti
    if (!_fontsBound && document.fonts?.ready) {
        _fontsBound = true;
        document.fonts.ready.then(() => {
            if (_lastStickerArgs && document.getElementById('team-stickers')) {
                renderStickers(..._lastStickerArgs);
            }
        });
    }
}
let _resizeBound = false;
let _fontsBound = false;

function bindStickerPop(section) {
    const wall = section.querySelector('.team-hero');
    const pop = document.getElementById('badge-pop');
    if (!wall || !pop) return;

    const show = (tile) => {
        const data = _badgesByTile?.[tile.dataset.tile];
        if (!data) return;
        const { badge, instance } = data;
        const instances = instance ? [instance] : badge.instances;
        const list = instances.length
            ? `<ul class="badge-pop-list">${instances.map(i =>
                `<li>${i.season ? `<strong>${i.season}</strong> · ` : ''}${i.detail || ''}</li>`).join('')}</ul>`
            : '<p class="badge-pop-locked">Not unlocked yet</p>';
        pop.innerHTML = `
            <div class="badge-pop-name">${badge.name}</div>
            <div class="badge-pop-desc">${badge.description}</div>
            ${list}`;
        pop.hidden = false;
        // Posiziona vicino al tile, dentro la cella
        const cell = pop.parentElement;
        const cellRect = cell.getBoundingClientRect();
        const tileRect = tile.getBoundingClientRect();
        const popW = Math.min(280, cellRect.width - 24);
        pop.style.width = popW + 'px';
        let left = tileRect.left - cellRect.left + tileRect.width / 2 - popW / 2;
        left = Math.max(12, Math.min(left, cellRect.width - popW - 12));
        pop.style.left = left + 'px';
        pop.style.top = (tileRect.bottom - cellRect.top + 8) + 'px';
    };
    const hide = () => { pop.hidden = true; };

    wall.addEventListener('click', (e) => {
        const tile = e.target.closest('.sticker');
        if (!tile) return;
        pop.dataset.tile = tile.dataset.tile;
        show(tile);
    });
    wall.addEventListener('mouseover', (e) => {
        const tile = e.target.closest('.sticker');
        if (tile) { pop.dataset.tile = tile.dataset.tile; show(tile); }
    });
    wall.addEventListener('mouseleave', hide);
    section.addEventListener('click', (e) => {
        if (!e.target.closest('.sticker') && !e.target.closest('.badge-pop')) hide();
    });
    if (!_escBound) {
        _escBound = true;
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                const p = document.getElementById('badge-pop');
                if (p) p.hidden = true;
            }
        });
    }
}
let _escBound = false;

// ─── La barra dei capitoli ──────────────────────────────────────

/* Bottoni, non link: vedi l'intestazione del file. Il capitolo acceso è
   quello che occupa la fascia alta dello schermo (rootMargin), non il primo
   che spunta dal basso: con capitoli alti il secondo criterio accendeva quello
   sotto mentre si stava ancora leggendo quello sopra. */
let _chapterObs = null;
function bindChapterNav(section) {
    const nav = section.querySelector('#tp-nav');
    if (!nav) return;
    const btns = [...nav.querySelectorAll('.tp-nav-btn')];
    const setActive = (id) => btns.forEach(b => {
        const on = b.dataset.ch === id;
        b.classList.toggle('is-active', on);
        if (on) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current');
        // la barra su telefono scorre in orizzontale: il bottone acceso resta in vista
        if (on && nav.scrollWidth > nav.clientWidth) {
            nav.scrollTo({ left: b.offsetLeft - nav.clientWidth / 2 + b.offsetWidth / 2, behavior: 'smooth' });
        }
    });
    nav.addEventListener('click', (e) => {
        const b = e.target.closest('.tp-nav-btn');
        if (!b) return;
        section.querySelector(`#tp-${b.dataset.ch}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    _chapterObs?.disconnect();
    _chapterObs = new IntersectionObserver((entries) => {
        entries.forEach(en => { if (en.isIntersecting) setActive(en.target.dataset.ch); });
    }, { rootMargin: '-30% 0px -60% 0px' });
    section.querySelectorAll('.tp-chapter').forEach(ch => _chapterObs.observe(ch));
    setActive('season');
}

// ─── Tooltip condiviso ──────────────────────────────────────────

/* Un solo fumetto per tutta la pagina: ogni segno con `data-tip` lo chiama.
   Il testo è già HTML pronto (lo scrive chi disegna il segno). Il fumetto sta
   in `position: fixed`, quindi non serve un contenitore posizionato attorno a
   ogni grafico, e non viene tagliato dall'overflow delle card. */
function bindTips(section) {
    let tip = document.getElementById('tp-tip');
    if (!tip) {
        tip = document.createElement('div');
        tip.id = 'tp-tip';
        tip.className = 'tp-tip';
        tip.setAttribute('role', 'tooltip');
        document.body.appendChild(tip);
    }
    const place = (e) => {
        const pad = 14;
        const r = tip.getBoundingClientRect();
        let x = e.clientX + pad;
        let y = e.clientY - r.height - pad;
        if (x + r.width > innerWidth - 8) x = e.clientX - r.width - pad;
        if (y < 8) y = e.clientY + pad;
        tip.style.transform = `translate(${Math.max(8, x)}px, ${y}px)`;
    };
    section.addEventListener('pointerover', (e) => {
        const t = e.target.closest('[data-tip]');
        if (!t) return;
        tip.innerHTML = t.dataset.tip;
        tip.classList.add('is-on');
        place(e);
    });
    section.addEventListener('pointermove', (e) => {
        if (tip.classList.contains('is-on') && e.target.closest('[data-tip]')) place(e);
    });
    section.addEventListener('pointerout', (e) => {
        const t = e.target.closest('[data-tip]');
        if (t && !t.contains(e.relatedTarget)) tip.classList.remove('is-on');
    });
}

const esc = (v) => String(v ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

// ─── 01 · La stagione in corso ──────────────────────────────────

function currentStreak(games) {
    if (!games.length) return '—';
    const kind = resultOf(games[games.length - 1]);
    let n = 0;
    for (let i = games.length - 1; i >= 0 && resultOf(games[i]) === kind; i--) n++;
    return `${kind}${n}`;
}

function weekLabel(w, cfg) {
    if (w === cfg.superBowlWeek) return 'Topina Bowl';
    if (w > cfg.regularSeasonWeeks) return 'Playoffs';
    return `Week ${w}`;
}

/** Il prossimo avversario: la prima giornata dopo l'ultima giocata in cui la
 *  squadra compare. Il calendario su Firebase c'è per intero dal primo giorno,
 *  coi punteggi a zero. */
function nextMatchup(data, teamKey, afterWeek) {
    if (!data?.weeks) return null;
    const weeks = Object.keys(data.weeks).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
    for (const w of weeks) {
        if (w <= afterWeek) continue;
        for (const m of (data.weeks[String(w)]?.matchups || [])) {
            const k1 = TEAM_KEYS[displayName(m.team1?.name)];
            const k2 = TEAM_KEYS[displayName(m.team2?.name)];
            if (k1 === teamKey && k2) return { week: w, opp: k2 };
            if (k2 === teamKey && k1) return { week: w, opp: k1 };
        }
    }
    return null;
}

async function renderSeason(league, team) {
    const box = document.getElementById('team-season');
    const sub = document.getElementById('tp-season-sub');
    if (!box) return;
    const key = team.key;
    let s = league.seasons.find(x => x.year === CURRENT_SEASON && x.perTeam[key]?.games.length);
    const live = !!s && !s.complete;
    // prima del primo kickoff la stagione "in corso" non ha partite: si
    // racconta l'ultima giocata, e lo si dice nel sottotitolo
    if (!s) s = [...league.seasons].reverse().find(x => x.perTeam[key]?.games.length);
    if (!s) { box.innerHTML = '<p class="team-empty">No games played yet.</p>'; return; }

    const t = s.perTeam[key];
    const cfg = getSeasonConfig(s.year);
    const games = t.games;
    const last = games[games.length - 1];
    if (sub) {
        sub.textContent = s.year === CURRENT_SEASON
            ? `${s.year} · through week ${last.week}${s.complete ? ' · final' : ''}`
            : `${s.year} · last season played`;
    }

    // rank nei punti fatti fra le quattro
    const pfRank = 1 + TEAM_KEY_LIST.filter(k => k !== key && (s.perTeam[k]?.pf || 0) > t.pf).length;
    const paRank = 1 + TEAM_KEY_LIST.filter(k => k !== key && (s.perTeam[k]?.pa || 0) < t.pa).length;
    const avg = t.pf / games.length;

    let outcome = '';
    if (s.complete) {
        outcome = t.sbWin ? 'Champion' : t.sbAppearance ? 'Runner-up' : `Finished ${ordinal(t.rank)}`;
    }

    // media di lega di ogni giornata: il metro della colonna
    const leagueAvg = {};
    for (let w = 1; w <= cfg.regularSeasonWeeks; w++) {
        const pts = TEAM_KEY_LIST.flatMap(k => (s.perTeam[k]?.games || []).filter(g => g.week === w).map(g => g.pts));
        if (pts.length) leagueAvg[w] = pts.reduce((a, b) => a + b, 0) / pts.length;
    }

    const kpi = (v, label, extra = '') => `
        <div class="ts-kpi"><b>${v}</b><span>${label}</span>${extra ? `<small>${extra}</small>` : ''}</div>`;

    box.innerHTML = `
    <div class="ts-wrap">
        <div class="ts-left">
            <div class="ts-record">
                <span class="ts-record-n">${recordStr(t.w, t.l, t.t)}</span>
                <span class="ts-record-lab">${s.year} record${outcome ? ` · <b>${outcome}</b>` : ''}</span>
            </div>
            <div class="ts-kpis">
                ${kpi(ordinal(t.rank || 0), 'Standing', 'of 4')}
                ${kpi(currentStreak(games), 'Streak')}
                ${kpi(fmtScore(avg), 'Pts / game')}
                ${kpi(fmtPts(t.pf), 'Points for', `${ordinal(pfRank)} in league`)}
                ${kpi(fmtPts(t.pa), 'Points against', `${ordinal(paRank)} fewest`)}
                ${kpi(t.highGame ? fmtScore(t.highGame.pts) : '—', 'Season high', t.highGame ? `week ${t.highGame.week}` : '')}
            </div>
            <div class="ts-games" id="ts-games">${gameCard('Last game', last, cfg)}</div>
        </div>
        <div class="ts-chart">
            <div class="ts-chart-head">
                <span class="ts-chart-title">Points by week</span>
                <span class="tl-legend">
                    <span class="tl-leg"><i class="tl-sw tl-sw--w"></i>Win</span>
                    <span class="tl-leg"><i class="tl-sw tl-sw--l"></i>Loss</span>
                    <span class="tl-leg"><i class="tl-sw tl-sw--avg"></i>League average</span>
                </span>
            </div>
            ${weeklyChart(games, leagueAvg, cfg, team)}
        </div>
    </div>
    <div class="ts-h2h-head">
        <span class="ts-chart-title">Head to head · ${s.year}</span>
        <span class="ts-h2h-note">Regular season only</span>
    </div>
    <div class="ts-h2h" id="ts-h2h"></div>`;

    // il calendario intero viene da ESPN: su Firebase le giornate future non ci sono
    const [data, espnSched] = await Promise.all([
        fetchFantasyData(s.year).catch(() => null),
        s.complete ? null : fetchSeasonSchedule(s.year).catch(() => null),
    ]);
    renderSeasonH2H(s, key, data, cfg, espnSched);
    if (!live) return;
    // prima Firebase (c'è solo la giornata dopo, e non sempre), poi ESPN
    let next = nextMatchup(data, key, last.week);
    if (!next && espnSched) {
        const keyOf = (n) => TEAM_KEYS[displayName(n)];
        const m = espnSched.filter(x => x.week > last.week).sort((a, b) => a.week - b.week)
            .find(x => keyOf(x.home) === key || keyOf(x.away) === key);
        const opp = m && keyOf(keyOf(m.home) === key ? m.away : m.home);
        if (opp) next = { week: m.week, opp };
    }
    const slot = document.getElementById('ts-games');
    if (next && slot) {
        const opp = TEAMS[next.opp];
        const o = s.perTeam[next.opp];
        const h2h = games.filter(g => g.opp === next.opp);
        slot.insertAdjacentHTML('beforeend', `
        <div class="ts-game ts-game--next" style="--opp:${opp.color}">
            <span class="ts-game-k">Up next · ${weekLabel(next.week, cfg)}</span>
            <div class="ts-game-row">
                <img src="${opp.logo}" alt="" class="ts-game-logo">
                <div class="ts-game-who">
                    <a href="#team-${next.opp}" class="ts-game-opp">${opp.name}</a>
                    <span class="ts-game-meta">${o ? `${recordStr(o.w, o.l, o.t)} · ${ordinal(o.rank)}` : ''}${h2h.length ? ` · ${h2h.filter(g => g.won).length}–${h2h.filter(g => resultOf(g) === 'L').length} this year` : ''}</span>
                </div>
            </div>
        </div>`);
    }
}

/* Gli scontri diretti di QUESTA stagione, uno per avversario. In una lega a
   quattro ci si incontra cinque volte in regular season: le sfide giocate
   hanno il risultato, quelle ancora in calendario restano come caselle vuote
   con la giornata — così si vede anche quanto manca, non solo com'è andata.
   Le partite giocate vengono dal registro della stagione (`games`), il
   calendario da Firebase, dove le giornate future ci sono già coi punteggi a
   zero. */
function renderSeasonH2H(s, key, data, cfg, espnSched = null) {
    const box = document.getElementById('ts-h2h');
    if (!box) return;
    const games = s.perTeam[key]?.games || [];
    const played = new Map(games.map(g => [g.week, g]));
    // il calendario di regular season: giornata → avversario
    const sched = [];
    for (let w = 1; w <= cfg.regularSeasonWeeks; w++) {
        const g = played.get(w);
        if (g) { sched.push({ week: w, opp: g.opp, g }); continue; }
        const pairs = [
            ...(espnSched || []).filter(m => m.week === w).map(m => [m.home, m.away]),
            ...(data?.weeks?.[String(w)]?.matchups || []).map(m => [m.team1?.name, m.team2?.name]),
        ];
        for (const [a, b] of pairs) {
            const k1 = TEAM_KEYS[displayName(a)];
            const k2 = TEAM_KEYS[displayName(b)];
            if (k1 === key && k2) { sched.push({ week: w, opp: k2, g: null }); break; }
            if (k2 === key && k1) { sched.push({ week: w, opp: k1, g: null }); break; }
        }
    }
    /* Senza il calendario intero (ESPN non risponde) non si sa quante sfide
       restano: allora una serie non si dichiara mai chiusa — "Swept them"
       dopo due partite su cinque sarebbe falso. */
    const known = s.complete || sched.length === cfg.regularSeasonWeeks;
    const nextWeek = sched.find(x => !x.g)?.week ?? null;

    box.innerHTML = TEAM_KEY_LIST.filter(k => k !== key).map(opp => {
        const o = TEAMS[opp];
        const mine = sched.filter(x => x.opp === opp);
        const done = mine.filter(x => x.g).map(x => x.g);
        const w = done.filter(g => resultOf(g) === 'W').length;
        const l = done.filter(g => resultOf(g) === 'L').length;
        const t = done.length - w - l;
        const left = known ? mine.length - done.length : 1;
        let status;
        if (!done.length) status = 'Not played yet';
        else if (w > l) status = `${left ? 'Leads' : 'Won'} the series ${recordStr(w, l, t)}`;
        else if (l > w) status = `${left ? 'Trails' : 'Lost'} the series ${recordStr(w, l, t)}`;
        else status = `Series ${left ? 'tied' : 'split'} ${recordStr(w, l, t)}`;
        if (done.length && !left && (w === done.length)) status = `Swept them ${recordStr(w, l, t)}`;
        if (done.length && !left && (l === done.length)) status = `Swept by them ${recordStr(w, l, t)}`;
        const avgFor = done.length ? done.reduce((a, g) => a + g.pts, 0) / done.length : null;
        const avgAg = done.length ? done.reduce((a, g) => a + g.oppPts, 0) / done.length : null;
        const net = done.reduce((a, g) => a + g.margin, 0);
        const rec = s.perTeam[opp];
        const chips = mine.map(x => {
            if (x.g) {
                const r = resultOf(x.g);
                return `<span class="h2s-chip h2s-chip--${r}" data-tip="${esc(`<b>Week ${x.week}</b><br>${fmtScore(x.g.pts)} – ${fmtScore(x.g.oppPts)} <span class='tip-${r}'>${r}</span>`)}">
                    <b>${r}</b><small>W${x.week}</small></span>`;
            }
            const isNext = x.week === nextWeek;
            return `<span class="h2s-chip h2s-chip--todo${isNext ? ' is-next' : ''}" data-tip="${esc(`<b>Week ${x.week}</b><br>${isNext ? 'Next game' : 'Scheduled'}`)}">
                <b>${isNext ? 'Next' : '·'}</b><small>W${x.week}</small></span>`;
        }).join('');
        const lean = !done.length ? '' : w > l ? 'is-up' : l > w ? 'is-down' : '';
        return `
        <div class="h2s-card ${lean}" style="--opp:${o.color}">
            <div class="h2s-head">
                <img src="${o.logo}" alt="" class="h2s-logo">
                <div class="h2s-who">
                    <a href="#team-${opp}" class="h2s-name">vs ${o.name}</a>
                    <span class="h2s-opp">${rec ? `${recordStr(rec.w, rec.l, rec.t)} · ${ordinal(rec.rank || 0)} in league` : ''}</span>
                </div>
                <b class="h2s-rec">${done.length ? recordStr(w, l, t) : '—'}</b>
            </div>
            <span class="h2s-status">${status}</span>
            <div class="h2s-chips">${chips || '<span class="h2s-none">No meetings scheduled</span>'}</div>
            <div class="h2s-stats">
                <div><b>${avgFor != null ? fmtScore(avgFor) : '—'}</b><span>Avg scored</span></div>
                <div><b>${avgAg != null ? fmtScore(avgAg) : '—'}</b><span>Avg allowed</span></div>
                <div><b class="${net > 0 ? 'is-pos' : net < 0 ? 'is-neg' : ''}">${done.length ? `${net > 0 ? '+' : ''}${fmtScore(net)}` : '—'}</b><span>Point diff.</span></div>
            </div>
        </div>`;
    }).join('');
}

function gameCard(kicker, g, cfg) {
    const opp = TEAMS[g.opp];
    if (!opp) return '';
    const r = resultOf(g);
    return `
    <div class="ts-game ts-game--${r}" style="--opp:${opp.color}">
        <span class="ts-game-k">${kicker} · ${weekLabel(g.week, cfg)}</span>
        <div class="ts-game-row">
            <img src="${opp.logo}" alt="" class="ts-game-logo">
            <div class="ts-game-who">
                <a href="#team-${g.opp}" class="ts-game-opp">vs ${opp.name}</a>
                <span class="ts-game-meta">${fmtScore(g.pts)} – ${fmtScore(g.oppPts)}</span>
            </div>
            <span class="ts-res ts-res--${r}">${r}</span>
        </div>
    </div>`;
}

/* Una colonna per giornata di regular season. Le giornate ancora da giocare
   restano come segnaposto tratteggiati: la colonna dice anche a che punto
   della stagione si è. La media di lega è un tratto neutro, non una seconda
   serie colorata: è il metro, non un avversario. */
function weeklyChart(games, leagueAvg, cfg, team) {
    const W = 640, H = 230, L = 36, R = 8, T = 14, B = 40;
    const n = cfg.regularSeasonWeeks;
    const band = (W - L - R) / n;
    const bw = Math.min(30, band * 0.62);
    const maxV = Math.max(...games.map(g => g.pts), ...Object.values(leagueAvg), 1);
    const ticks = niceTicks(0, maxV, 4);
    const top = ticks[ticks.length - 1];
    const y = (v) => T + (H - T - B) * (1 - v / top);
    const x = (w) => L + band * (w - 1) + band / 2;
    const byWeek = new Map(games.map(g => [g.week, g]));

    const grid = ticks.map(v => `
        <line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" class="tc-grid"/>
        <text x="${L - 6}" y="${y(v) + 3.5}" text-anchor="end" class="tc-axis">${v}</text>`).join('');

    const bars = [];
    for (let w = 1; w <= n; w++) {
        const g = byWeek.get(w);
        const cx = x(w);
        if (!g) {
            bars.push(`<rect x="${cx - bw / 2}" y="${y(0) - 6}" width="${bw}" height="6" rx="3" class="tc-slot"/>
                <text x="${cx}" y="${H - B + 16}" text-anchor="middle" class="tc-axis">${w}</text>`);
            continue;
        }
        const r = resultOf(g);
        const opp = TEAMS[g.opp];
        const h = Math.max(2, y(0) - y(g.pts));
        const tip = `<b>Week ${w}</b> · vs ${esc(opp?.name)}<br>${fmtScore(g.pts)} – ${fmtScore(g.oppPts)} <span class="tip-${r}">${r}</span>`
            + (leagueAvg[w] != null ? `<br><span class="tip-muted">League avg ${fmtScore(leagueAvg[w])}</span>` : '');
        bars.push(`
            <g class="tc-col" data-tip="${esc(tip)}">
                <rect x="${cx - band / 2}" y="${T}" width="${band}" height="${H - T - B + 30}" class="tc-hit"/>
                <path d="M${cx - bw / 2} ${y(0)} V${y(0) - h + 4} q0 -4 4 -4 h${bw - 8} q4 0 4 4 V${y(0)} Z" class="tc-bar tc-bar--${r}"/>
                <text x="${cx}" y="${H - B + 16}" text-anchor="middle" class="tc-axis">${w}</text>
                <text x="${cx}" y="${H - B + 31}" text-anchor="middle" class="tc-res tc-res--${r}">${r}</text>
            </g>`);
    }
    const avgPts = Object.entries(leagueAvg).map(([w, v]) => `${x(+w)},${y(v)}`).join(' ');
    const avgDots = Object.entries(leagueAvg).map(([w, v]) => `<circle cx="${x(+w)}" cy="${y(v)}" r="2.5" class="tc-avg-dot"/>`).join('');
    return `
    <svg class="ts-svg" viewBox="0 0 ${W} ${H}" role="img"
         aria-label="${esc(team.name)} points by week, with the league average">
        ${grid}
        <line x1="${L}" x2="${W - R}" y1="${y(0)}" y2="${y(0)}" class="tc-base"/>
        ${bars.join('')}
        ${avgPts ? `<polyline points="${avgPts}" class="tc-avg"/>${avgDots}` : ''}
    </svg>`;
}

// ─── 02 · La bacheca ────────────────────────────────────────────

function renderShelf(at) {
    const box = document.getElementById('team-shelf');
    if (!box) return;
    const finalsLost = at.sbApps.filter(y => !at.sbWins.includes(y));
    const logos = at.sbWins.map(year => {
        const ed = sbEdition(year);
        ensureFaceFont(faceFor(ed));
        return `
        <figure class="tr-trophy" data-tip="${esc(`<b>Topina Bowl ${_sbRoman(year)}</b><br>Champions ${year}`)}">
            ${superBowlLogoSVG({ edition: ed, crop: true, className: 'tr-trophy-logo', idPrefix: `shelf-${year}` })}
            <figcaption>${year}</figcaption>
        </figure>`;
    }).join('');
    const chips = (list, cls) => list.length
        ? list.map(y => `<span class="tr-year ${cls}">${y}</span>`).join('')
        : '<span class="tr-year tr-year--none">None yet</span>';
    box.innerHTML = `
    <div class="tr-shelf${at.sbWins.length ? '' : ' tr-shelf--empty'}">
        ${logos || '<p class="tr-empty">The shelf is still waiting for its first Topina Bowl.</p>'}
    </div>
    <div class="tr-counts">
        <div class="tr-count">
            <b>${at.sbWins.length}</b><span>Topina Bowls</span>
            <div class="tr-years">${chips(at.sbWins, 'tr-year--gold')}</div>
        </div>
        <div class="tr-count">
            <b>${at.sbApps.length}</b><span>Finals played</span>
            <div class="tr-years">${chips(finalsLost, '')}</div>
            <small>${at.sbApps.length ? `${at.sbWins.length}–${finalsLost.length} in finals` : ''}</small>
        </div>
        <div class="tr-count">
            <b>${at.rsTitles.length}</b><span>Regular-season titles</span>
            <div class="tr-years">${chips(at.rsTitles, '')}</div>
        </div>
    </div>`;
}

/* I record di franchigia. Ognuno si calcola per TUTTE e quattro le squadre,
   così si può dire quando il record della squadra è anche quello della lega.
   I record di stagione guardano solo le stagioni chiuse: un 3-0 a settembre
   non è la miglior stagione di sempre. */
function franchiseRecords(league, key) {
    const allGames = [];
    const seasons = [];
    league.seasons.forEach(s => {
        const t = s.perTeam[key];
        if (!t?.games.length) return;
        t.games.forEach(g => allGames.push({ ...g, year: s.year }));
        if (s.complete) seasons.push({ year: s.year, t });
    });
    const best = (list, f) => list.reduce((a, b) => (a == null || f(b) > f(a) ? b : a), null);
    const hi = best(allGames, g => g.pts);
    const lo = best(allGames, g => -g.pts);
    const blow = best(allGames.filter(g => g.won), g => g.margin);
    const close = best(allGames.filter(g => g.won), g => -g.margin);
    const pct = (t) => (t.w + t.t / 2) / Math.max(1, t.games.length);
    const bs = best(seasons, x => pct(x.t));
    const bp = best(seasons, x => x.t.pf / x.t.games.length);
    let streak = { len: 0, year: null };
    seasons.concat(league.seasons.filter(s => !s.complete).map(s => ({ year: s.year, t: s.perTeam[key] })).filter(x => x.t))
        .forEach(x => { if (x.t.bestStreak.len > streak.len) streak = { len: x.t.bestStreak.len, year: x.year }; });
    const opp = (g) => TEAMS[g.opp]?.name || '—';
    return [
        { id: 'hi', label: 'Highest score', v: hi?.pts, show: hi && fmtScore(hi.pts), ctx: hi && `vs ${opp(hi)} · W${hi.week} ${hi.year}`, dir: 1 },
        { id: 'blow', label: 'Biggest win', v: blow?.margin, show: blow && `+${fmtScore(blow.margin)}`, ctx: blow && `${fmtScore(blow.pts)}–${fmtScore(blow.oppPts)} vs ${opp(blow)} · ${blow.year}`, dir: 1 },
        { id: 'bs', label: 'Best season', v: bs && pct(bs.t), show: bs && recordStr(bs.t.w, bs.t.l, bs.t.t), ctx: bs && `${bs.year} · ${(pct(bs.t) * 100).toFixed(0)}% wins`, dir: 1 },
        { id: 'bp', label: 'Most points per game', v: bp && bp.t.pf / bp.t.games.length, show: bp && fmtScore(bp.t.pf / bp.t.games.length), ctx: bp && `${bp.year} season`, dir: 1 },
        { id: 'streak', label: 'Longest win streak', v: streak.len, show: streak.len ? `${streak.len} W` : null, ctx: streak.year && `${streak.year}`, dir: 1 },
        { id: 'close', label: 'Narrowest win', v: close?.margin, show: close && `+${fmtScore(close.margin)}`, ctx: close && `vs ${opp(close)} · W${close.week} ${close.year}`, dir: -1 },
        { id: 'lo', label: 'Lowest score', v: lo?.pts, show: lo && fmtScore(lo.pts), ctx: lo && `vs ${opp(lo)} · W${lo.week} ${lo.year}`, dir: -1 },
    ];
}

function renderRecords(league, key) {
    const box = document.getElementById('team-records');
    if (!box) return;
    const all = Object.fromEntries(TEAM_KEY_LIST.map(k => [k, franchiseRecords(league, k)]));
    const mine = all[key];
    box.innerHTML = `<div class="tr-records">${mine.map((r, i) => {
        if (!r.show) return '';
        // record di lega: nessun'altra squadra fa meglio (pari conta come record condiviso)
        const others = TEAM_KEY_LIST.filter(k => k !== key).map(k => all[k][i].v).filter(v => v != null);
        const isLeague = others.every(v => r.dir > 0 ? r.v >= v : r.v <= v);
        return `
        <div class="tr-rec${isLeague ? ' is-league' : ''}${r.dir < 0 ? ' tr-rec--low' : ''}">
            <span class="tr-rec-label">${r.label}</span>
            <b class="tr-rec-v">${r.show}</b>
            <span class="tr-rec-ctx">${r.ctx || ''}</span>
            ${isLeague ? '<span class="tr-rec-lr">League record</span>' : ''}
        </div>`;
    }).join('')}</div>`;
}

// ─── 03 · Anno per anno ─────────────────────────────────────────

const YEAR_METRICS = [
    ['pct', 'Win %'],
    ['ppg', 'Points / game'],
    ['finish', 'Finish'],
];
let _yearsState = null;

function seasonRows(league, key) {
    return league.seasons.map(s => {
        const t = s.perTeam[key];
        if (!t?.games.length) return null;
        const lgPpg = TEAM_KEY_LIST.reduce((a, k) => a + (s.perTeam[k]?.pf || 0), 0)
            / Math.max(1, TEAM_KEY_LIST.reduce((a, k) => a + (s.perTeam[k]?.games.length || 0), 0));
        const outcome = !s.complete ? 'live' : t.sbWin ? 'champ' : t.sbAppearance ? 'runnerup' : t.rsTitle ? 'rs' : 'rank';
        return {
            year: s.year, t, complete: s.complete, outcome, lgPpg,
            pct: (t.w + t.t / 2) / t.games.length * 100,
            ppg: t.pf / t.games.length,
            finish: t.rank,
        };
    }).filter(Boolean);
}

function outcomeChip(r) {
    switch (r.outcome) {
        case 'live': return '<span class="hist-chip hist-chip--live">In progress</span>';
        case 'champ': return '<span class="hist-chip hist-chip--champ">Champion</span>';
        case 'runnerup': return '<span class="hist-chip hist-chip--runnerup">Runner-up</span>';
        case 'rs': return '<span class="hist-chip hist-chip--rs">RS Champ</span>';
        default: return `<span class="hist-chip">#${r.t.rank || '—'}</span>`;
    }
}

function renderYears(league, team) {
    const list = document.getElementById('team-history');
    const box = document.getElementById('team-years');
    if (!list || !box) return;
    const rows = seasonRows(league, team.key);
    if (!rows.length) { list.innerHTML = '<p class="empty-state-text">No seasons played.</p>'; return; }
    _yearsState = { rows, team, metric: 'pct', year: rows[rows.length - 1].year, grades: {} };

    /* La lista è anche la vista-tabella del grafico: gli stessi numeri, in
       righe, e cliccabili come le colonne. */
    list.innerHTML = [...rows].reverse().map(r => `
        <button type="button" class="hist-row hist-row--btn" data-year="${r.year}">
            <span class="hist-year">${r.year}</span>
            <span class="hist-record">${recordStr(r.t.w, r.t.l, r.t.t)}</span>
            <span class="hist-pf">${fmtPts(r.t.pf)} pt</span>
            ${outcomeChip(r)}
        </button>`).join('');
    list.addEventListener('click', (e) => {
        const b = e.target.closest('[data-year]');
        if (b) { _yearsState.year = b.dataset.year; drawYears(); }
    });

    box.innerHTML = `
        <div class="ty-head">
            <div class="ty-seg" role="tablist" aria-label="Metric">${YEAR_METRICS.map(([id, label]) => `
                <button type="button" role="tab" class="ty-seg-btn" data-metric="${id}">${label}</button>`).join('')}
            </div>
            <span class="tl-legend" id="ty-legend"></span>
        </div>
        <div id="ty-chart"></div>
        <div class="ty-detail" id="ty-detail"></div>`;
    box.addEventListener('click', (e) => {
        const m = e.target.closest('[data-metric]');
        if (m) { _yearsState.metric = m.dataset.metric; drawYears(); return; }
        const c = e.target.closest('[data-year]');
        if (c) { _yearsState.year = c.dataset.year; drawYears(); }
    });
    drawYears();
}

function drawYears() {
    const st = _yearsState;
    if (!st) return;
    const { rows, metric, year } = st;
    document.querySelectorAll('#team-years .ty-seg-btn').forEach(b => {
        const on = b.dataset.metric === metric;
        b.classList.toggle('is-active', on);
        b.setAttribute('aria-selected', on);
    });
    document.querySelectorAll('#team-history .hist-row--btn').forEach(b =>
        b.classList.toggle('is-selected', b.dataset.year === year));

    const W = 640, H = 230, L = 40, R = 8, T = 22, B = 30;
    const band = (W - L - R) / rows.length;
    const bw = Math.min(46, band * 0.56);
    const x = (i) => L + band * i + band / 2;
    let top, y, ticks, fmt, ref = null;
    if (metric === 'finish') {
        // 1° = colonna piena. Quattro squadre: quattro gradini.
        ticks = [1, 2, 3, 4];
        y = (rank) => T + (H - T - B) * ((rank - 1) / 4);
        fmt = (v) => ordinal(v);
    } else {
        const vals = rows.map(r => r[metric]).concat(metric === 'ppg' ? rows.map(r => r.lgPpg) : [100]);
        ticks = metric === 'pct' ? [0, 25, 50, 75, 100] : niceTicks(0, Math.max(...vals), 4);
        top = ticks[ticks.length - 1];
        y = (v) => T + (H - T - B) * (1 - v / top);
        fmt = metric === 'pct' ? (v) => `${v.toFixed(0)}%` : (v) => fmtScore(v);
        if (metric === 'pct') ref = 50;
    }
    const base = metric === 'finish' ? H - B : y(0);
    const grid = metric === 'finish'
        ? ticks.map(v => `<text x="${L - 8}" y="${y(v) + 12}" text-anchor="end" class="tc-axis">${ordinal(v)}</text>
                          <line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" class="tc-grid"/>`).join('')
        : ticks.map(v => `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" class="tc-grid"/>
                          <text x="${L - 8}" y="${y(v) + 3.5}" text-anchor="end" class="tc-axis">${metric === 'pct' ? `${v}%` : v}</text>`).join('');

    const cols = rows.map((r, i) => {
        const cx = x(i);
        const v = r[metric];
        const yTop = metric === 'finish' ? y(v) : y(v);
        const h = Math.max(2, base - yTop);
        const sel = r.year === year;
        const tip = `<b>${r.year}</b> · ${recordStr(r.t.w, r.t.l, r.t.t)}<br>${fmtScore(r.ppg)} pts/game · ${ordinal(r.t.rank)}`
            + (metric === 'ppg' ? `<br><span class="tip-muted">League ${fmtScore(r.lgPpg)}</span>` : '');
        const crown = r.outcome === 'champ'
            ? `<polygon points="${cx - 7},${yTop - 6} ${cx - 7},${yTop - 15} ${cx - 3.5},${yTop - 10} ${cx},${yTop - 17} ${cx + 3.5},${yTop - 10} ${cx + 7},${yTop - 15} ${cx + 7},${yTop - 6}" class="ty-crown"/>`
            : '';
        const lg = metric === 'ppg'
            ? `<line x1="${cx - bw / 2 - 5}" x2="${cx + bw / 2 + 5}" y1="${y(r.lgPpg)}" y2="${y(r.lgPpg)}" class="ty-lg"/>` : '';
        return `
        <g class="tc-col ty-col${sel ? ' is-selected' : ''}${r.complete ? '' : ' is-live'}" data-year="${r.year}" data-tip="${esc(tip)}">
            <rect x="${cx - band / 2}" y="0" width="${band}" height="${H}" class="tc-hit"/>
            <path d="M${cx - bw / 2} ${base} V${base - h + 4} q0 -4 4 -4 h${bw - 8} q4 0 4 4 V${base} Z" class="ty-bar"/>
            ${lg}
            <text x="${cx}" y="${yTop - (crown ? 21 : 6)}" text-anchor="middle" class="ty-val">${fmt(v)}</text>
            ${crown}
            <text x="${cx}" y="${H - B + 18}" text-anchor="middle" class="tc-axis ty-year">${r.year}</text>
        </g>`;
    }).join('');

    const legend = document.getElementById('ty-legend');
    if (legend) {
        legend.innerHTML = metric === 'ppg'
            ? '<span class="tl-leg"><i class="tl-sw tl-sw--avg"></i>League average</span>'
            : metric === 'pct' ? '<span class="tl-leg"><i class="tl-sw tl-sw--avg"></i>.500</span>'
                : '<span class="tl-leg"><i class="ty-crown-sw"></i>Champion</span>';
    }
    document.getElementById('ty-chart').innerHTML = `
    <svg class="ts-svg ty-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(st.team.name)} ${YEAR_METRICS.find(m => m[0] === metric)[1]} by season">
        ${grid}
        ${ref != null ? `<line x1="${L}" x2="${W - R}" y1="${y(ref)}" y2="${y(ref)}" class="tc-avg"/>` : ''}
        ${cols}
    </svg>`;
    drawYearDetail();
}

function drawYearDetail() {
    const st = _yearsState;
    const box = document.getElementById('ty-detail');
    if (!st || !box) return;
    const r = st.rows.find(x => x.year === st.year);
    if (!r) return;
    const t = r.t;
    const g = st.grades[r.year];
    const grade = g === undefined
        ? '<span class="ty-d-muted">Loading…</span>'
        : g ? `<span class="dg-letter dg-letter--${g.letter[0]}">${g.letter}</span> <small>${g.grade}/100 · ${ordinal(g.rank)}</small>`
            : '<span class="ty-d-muted">n/a</span>';
    const item = (label, v) => `<div class="ty-d-item"><span>${label}</span><b>${v}</b></div>`;
    box.innerHTML = `
        <div class="ty-d-title"><b>${r.year}</b> ${outcomeChip(r)}</div>
        <div class="ty-d-grid">
            ${item('Record', recordStr(t.w, t.l, t.t))}
            ${item('Finish', t.rank ? ordinal(t.rank) : '—')}
            ${item('Points for', fmtPts(t.pf))}
            ${item('Points against', fmtPts(t.pa))}
            ${item('Pts / game', fmtScore(r.ppg))}
            ${item('Best game', t.highGame ? `${fmtScore(t.highGame.pts)} <small>W${t.highGame.week}</small>` : '—')}
            ${item('Win streak', t.bestStreak.len || '—')}
            ${item('Draft grade', `<a class="ty-d-link" href="#draftgrades/${r.year}/${st.team.key}">${grade}</a>`)}
        </div>`;
}

// ─── 05 · Draft e allenatore ────────────────────────────────────

async function renderDNA(team) {
    const box = document.getElementById('team-dna');
    if (!box) return;
    const dna = await getManagerDNA();
    const a = dna?.managers?.[team.key]?.archetype;
    if (!a) { box.innerHTML = '<p class="team-empty">Manager DNA isn\'t built yet.</p>'; return; }
    box.innerHTML = `
    <div class="td-dna">
        <span class="td-kicker">Manager DNA · ${dna.seasons?.length || ''} seasons</span>
        <h3 class="td-arch">${esc(a.label)}</h3>
        <span class="dna-conf dna-conf--${a.confidence}" title="${esc(CONFIDENCE_NOTE[a.confidence])}">${esc(CONFIDENCE_LABEL[a.confidence])}</span>
        <p class="td-blurb">${esc(a.blurb)}</p>
        <a class="tw-more" href="#managerdna/${team.key}">The full Manager DNA &rarr;</a>
    </div>`;
}

/* Una tessera per stagione. I voti si calcolano solo quando il capitolo entra
   a schermo, uno dopo l'altro dal più recente: ogni stagione sono le sue
   proiezioni, e farle partire tutte insieme all'apertura della pagina
   rallentava proprio la parte alta, che è quella che si guarda per prima. */
function renderDrafts(league, team) {
    const box = document.getElementById('team-drafts');
    if (!box) return;
    const years = [...SEASONS].reverse().filter(y => league.seasons.find(s => s.year === y)?.draftPicks?.[team.key]?.length);
    if (!years.length) { box.innerHTML = '<p class="team-empty">No drafts on record.</p>'; return; }
    box.innerHTML = `<div class="td-tiles">${years.map(y => {
        const picks = league.seasons.find(s => s.year === y).draftPicks[team.key];
        const first = [...picks].sort((a, b) => a.pick - b.pick)[0];
        return `
        <a class="td-tile" href="#draftgrades/${y}/${team.key}" data-dg-year="${y}">
            <span class="td-year">${y}</span>
            <span class="td-letter" data-dg-letter><span class="td-wait"></span></span>
            <span class="td-score" data-dg-score>&nbsp;</span>
            <span class="td-first">${first ? `1st pick · ${esc(first.player)}` : ''}</span>
        </a>`;
    }).join('')}</div>`;

    const fill = (y, dg) => {
        const tile = box.querySelector(`[data-dg-year="${y}"]`);
        const g = dg?.byKey?.[team.key] || null;
        if (_yearsState) { _yearsState.grades[y] = g; if (_yearsState.year === y) drawYearDetail(); }
        if (!tile) return;
        tile.querySelector('[data-dg-letter]').innerHTML = g
            ? `<span class="dg-letter dg-letter--${g.letter[0]}">${g.letter}</span>` : '<span class="td-na">—</span>';
        tile.querySelector('[data-dg-score]').textContent = g ? `${g.grade}/100 · ${ordinal(g.rank)} of 4` : 'Not graded';
    };
    const run = async () => {
        let mod;
        try { mod = await loadDraftGrades(); } catch (e) { years.forEach(y => fill(y, null)); return; }
        for (const y of years) {
            if (!location.hash.includes(team.key)) return;
            fill(y, await mod.seasonDraftGrade(y));
        }
    };
    const io = new IntersectionObserver((entries) => {
        if (entries.some(e => e.isIntersecting)) { io.disconnect(); run(); }
    }, { rootMargin: '200px 0px' });
    // anche il dettaglio di "Year by Year" mostra il voto: basta che uno dei due sia in vista
    io.observe(box);
    const yd = document.getElementById('team-years');
    if (yd) io.observe(yd);
}

// ─── 06 · Le rivalità ───────────────────────────────────────────

function renderRivals(league, key) {
    const box = document.getElementById('team-rivals');
    if (!box) return;
    box.innerHTML = TEAM_KEY_LIST.filter(k => k !== key).map((opp, i) => {
        const games = [];
        league.seasons.forEach(s => (s.perTeam[key]?.games || [])
            .filter(g => g.opp === opp).forEach(g => games.push({ ...g, year: s.year })));
        const o = TEAMS[opp];
        if (!games.length) return '';
        const w = games.filter(g => resultOf(g) === 'W').length;
        const l = games.filter(g => resultOf(g) === 'L').length;
        const t = games.length - w - l;
        const pct = (w + t / 2) / games.length * 100;
        const avgFor = games.reduce((a, g) => a + g.pts, 0) / games.length;
        const avgAg = games.reduce((a, g) => a + g.oppPts, 0) / games.length;
        const bigW = games.filter(g => g.won).sort((a, b) => b.margin - a.margin)[0];
        const bigL = games.filter(g => resultOf(g) === 'L').sort((a, b) => a.margin - b.margin)[0];
        const streak = currentStreak(games);
        const recent = games.slice(-10);
        const verdict = pct > 55 ? 'You own this one' : pct < 45 ? 'Their number' : 'Dead even';
        return `
        <div class="bento-cell cell-rival" style="--cell-i:${14 + i};--opp:${o.color}">
            <div class="rv-head">
                <img src="${o.logo}" alt="" class="rv-logo">
                <div class="rv-who">
                    <a href="#team-${opp}" class="rv-name">vs ${o.name}</a>
                    <span class="rv-verdict">${verdict}</span>
                </div>
                <b class="rv-rec">${recordStr(w, l, t)}</b>
            </div>
            <div class="rv-bar" data-tip="${esc(`${w} wins · ${l} losses${t ? ` · ${t} ties` : ''}<br>${pct.toFixed(0)}% of ${games.length} games`)}">
                <span class="rv-bar-me" style="width:${pct.toFixed(1)}%"></span>
                <span class="rv-bar-opp"></span>
            </div>
            <div class="rv-stats">
                <div><b>${fmtScore(avgFor)}</b><span>Avg scored</span></div>
                <div><b>${fmtScore(avgAg)}</b><span>Avg allowed</span></div>
                <div><b>${streak}</b><span>Streak</span></div>
            </div>
            <div class="rv-last">
                <span class="rv-last-k">Last ${recent.length}</span>
                <span class="rv-dots">${recent.map(g => {
                    const r = resultOf(g);
                    return `<i class="rv-dot rv-dot--${r}" data-tip="${esc(`<b>${g.year} · W${g.week}</b><br>${fmtScore(g.pts)} – ${fmtScore(g.oppPts)} <span class='tip-${r}'>${r}</span>`)}"></i>`;
                }).join('')}</span>
            </div>
            <div class="rv-ext">
                ${bigW ? `<span>Biggest win <b>+${fmtScore(bigW.margin)}</b> <small>${bigW.year}</small></span>` : ''}
                ${bigL ? `<span>Worst loss <b>${fmtScore(bigL.margin)}</b> <small>${bigL.year}</small></span>` : ''}
            </div>
        </div>`;
    }).join('');
}

// ─── 07 · Identità: colori e divise ─────────────────────────────

/* Non è decorazione: è la legenda della palette. Le tinte arrivano da
   TEAM_PALETTE in js/data/team-config.js, che è la fonte unica — cambiare un
   valore là cambia hero, sticker, grafici, divise e questo blocco insieme. Il
   codice esadecimale si mostra apposta, e si copia con un clic. */
const COLOR_ROLES = [
    ['identity', 'Primary', 'The franchise itself: hero, stickers, borders, jerseys.'],
    ['secondary', 'Secondary', 'Numbers, trim and the second uniform colour.'],
    ['tertiary', 'Tertiary', 'Stripes and accents.'],
];
const DERIVED_ROLES = [
    ['bright', 'On black', 'Chart lines on a dark background'],
    ['ink', 'Ink', 'Large fills and backdrops'],
    ['throwback', 'Throwback', 'Only on the throwback uniform'],
];

function renderColors(team) {
    const box = document.getElementById('team-colors');
    const pal = TEAM_PALETTE[team.key];
    if (!box || !pal) return;
    box.innerHTML = `
    <div class="tc-main">${COLOR_ROLES.map(([role, label, why]) => `
        <button type="button" class="tc-big" data-hex="${pal[role].toUpperCase()}" style="--sw:${pal[role]}">
            <span class="tc-big-chip"></span>
            <span class="tc-big-meta">
                <span class="tc-name">${label}</span>
                <code class="tc-hex">${pal[role].toUpperCase()}</code>
                <span class="tc-why">${why}</span>
            </span>
        </button>`).join('')}
    </div>
    <div class="tc-derived">${DERIVED_ROLES.filter(([r]) => pal[r]).map(([role, label, why]) => `
        <button type="button" class="tc-mini" data-hex="${pal[role].toUpperCase()}" title="${why}">
            <span class="tc-chip" style="background:${pal[role]}"></span>
            <span class="tc-name">${label}</span><code class="tc-hex">${pal[role].toUpperCase()}</code>
        </button>`).join('')}
    </div>`;
    box.addEventListener('click', async (e) => {
        const b = e.target.closest('[data-hex]');
        if (!b) return;
        try { await navigator.clipboard.writeText(b.dataset.hex); } catch { return; }
        b.classList.add('is-copied');
        const hex = b.querySelector('.tc-hex');
        const was = hex.textContent;
        hex.textContent = 'Copied';
        setTimeout(() => { b.classList.remove('is-copied'); hex.textContent = was; }, 1100);
    });
}

/* Il guardaroba: quattro set, e i tre pezzi si possono prendere da set
   diversi. Lo stato è di modulo e riparte da Home a ogni squadra. */
const PIECES = [['helmet', 'Helmet'], ['jersey', 'Jersey'], ['pants', 'Pants']];
const PIECE_SWATCH = { helmet: (u) => u.helmet.shell, jersey: (u) => u.jersey.body, pants: (u) => u.pants.body };

function renderUniforms(team) {
    const box = document.getElementById('team-uniform');
    const sets = uniformsFor(team.key);
    if (!box || !sets.length) return;
    const st = { helmet: 0, jersey: 0, pants: 0, number: '10' };

    box.innerHTML = `
    <div class="tu-wrap">
        <div class="tu-stage">
            <div class="tu-figure" id="tu-figure"></div>
            <span class="tu-caption" id="tu-caption"></span>
        </div>
        <div class="tu-controls">
            <div class="tu-sets">${sets.map((u, i) => `
                <button type="button" class="tu-set" data-set="${i}">
                    ${uniformSVG({ team: team.key, ...u, idPrefix: `tus-${team.key}-${i}`, label: u.label })}
                    <span class="tu-set-label">${u.label}</span>
                    <span class="tu-set-note">${u.note}</span>
                </button>`).join('')}
            </div>
            <div class="tu-mix">
                <span class="tu-mix-k">Mix &amp; match</span>
                ${PIECES.map(([p, label]) => `
                <div class="tu-mix-row" role="radiogroup" aria-label="${label}">
                    <span class="tu-mix-label">${label}</span>
                    ${sets.map((u, i) => `
                    <button type="button" class="tu-swatch" role="radio" data-piece="${p}" data-i="${i}"
                            style="--sw:${PIECE_SWATCH[p](u)}" title="${label} from ${u.label}">
                        <span></span>${u.label}
                    </button>`).join('')}
                </div>`).join('')}
                <label class="tu-num">Number
                    <input type="text" inputmode="numeric" maxlength="2" value="${st.number}" id="tu-number" aria-label="Jersey number">
                </label>
            </div>
        </div>
    </div>`;

    const draw = () => {
        const fig = box.querySelector('#tu-figure');
        const h = sets[st.helmet], j = sets[st.jersey], p = sets[st.pants];
        fig.innerHTML = uniformSVG({
            team: team.key, helmet: h.helmet, jersey: j.jersey, pants: p.pants,
            number: st.number || '0', idPrefix: `tu-${team.key}`, label: `${team.name} uniform`,
        });
        const same = st.helmet === st.jersey && st.jersey === st.pants;
        box.querySelector('#tu-caption').textContent = same
            ? `${h.label} · ${h.note}`
            : `Custom · ${h.label} helmet, ${j.label} jersey, ${p.label} pants`;
        box.querySelectorAll('.tu-set').forEach(b => b.classList.toggle('is-active', same && +b.dataset.set === st.helmet));
        box.querySelectorAll('.tu-swatch').forEach(b => {
            const on = st[b.dataset.piece] === +b.dataset.i;
            b.classList.toggle('is-active', on);
            b.setAttribute('aria-checked', on);
        });
    };
    box.addEventListener('click', (e) => {
        const set = e.target.closest('[data-set]');
        if (set) { st.helmet = st.jersey = st.pants = +set.dataset.set; draw(); return; }
        const sw = e.target.closest('[data-piece]');
        if (sw) { st[sw.dataset.piece] = +sw.dataset.i; draw(); }
    });
    box.querySelector('#tu-number').addEventListener('input', (e) => {
        e.target.value = e.target.value.replace(/\D/g, '').slice(0, 2);
        st.number = e.target.value;
        draw();
    });
    draw();
}

function fmtScore(n) {
    return (+n).toFixed(1).replace('.', ',');
}

/* ─── La rosa, schierata ──────────────────────────────────────────
   Lo stesso campo della finale in home (`ui/field-allpro.js`), ma con una
   squadra sola: i nove titolari sulla propria metà e — sulla metà che là è
   dell’avversaria e qui resterebbe prato vuoto — i sei di panchina.

   La giornata è l’ULTIMA CHIUSA: la settimana in corso ha punteggi a zero fino
   alla domenica, e una rosa con nove zeri non dice niente. */
function lastClosedWeek(data) {
    if (!data?.weeks) return null;
    const weeks = Object.keys(data.weeks).map(Number).filter(Number.isFinite).sort((a, b) => b - a);
    for (const w of weeks) {
        const ms = data.weeks[String(w)]?.matchups || [];
        // "chiusa" = qualcuno ha segnato: prima del kickoff sono tutti a 0.00
        if (ms.some(m => parseFloat(m.team1?.score) > 0 || parseFloat(m.team2?.score) > 0)) return w;
    }
    return null;
}

/** La squadra dentro una giornata, qualunque lato del matchup occupi. */
function sideInWeek(week, teamKey) {
    for (const m of (week?.matchups || [])) {
        for (const side of [m.team1, m.team2]) {
            if (TEAM_KEYS[displayName(side?.name)] === teamKey) return side;
        }
    }
    return null;
}

async function renderRoster(team, league) {
    const box = document.getElementById('team-roster');
    const sub = document.getElementById('team-roster-sub');
    if (!box) return;
    try {
        // Si parte dalla stagione in corso e si scende: a inizio anno, prima
        // del primo kickoff, la rosa più recente è quella dell’anno prima.
        let data = null, week = null, year = null;
        for (const y of SEASONS_DESC) {
            data = await fetchFantasyData(y).catch(() => null);
            week = lastClosedWeek(data);
            if (week != null) { year = y; break; }
        }
        const side = week != null ? sideInWeek(data.weeks[String(week)], team.key) : null;
        if (!side) { box.innerHTML = '<p class="team-empty">No roster on record yet.</p>'; return; }

        const pts = (p) => { const v = parseFloat(p.fantasy_points); return Number.isFinite(v) ? v : null; };
        /* Nella panchina di Firebase i due campi sono "al contrario": `position`
           è lo SLOT (BN, o RES per la riserva infortunati) e `position_in_team`
           il ruolo del giocatore. Il ruolo era letto da `position`, e alla
           ricerca della foto arrivava "BN". */
        const reserve = (side.bench || []).map(p => ({
            slot: (p.position || 'BN').toUpperCase(),
            player: {
                name: p.name, nfl: p.nfl_team, pts: pts(p),
                pos: (p.position_in_team || '').toUpperCase(),
            },
        }));
        const bench = reserve.filter(b => b.slot !== 'RES');
        const ir = reserve.find(b => b.slot === 'RES') || null;
        const total = parseFloat(side.score);
        if (sub) sub.textContent = `Season ${year} · Week ${week}${Number.isFinite(total) ? ` · ${fmtScore(total)} pts` : ''}`;
        /* Mezzo campo in piedi: con una squadra sola il campo disteso è per
           metà prato vuoto, e i giocatori vengono la metà di quanto potrebbero.
           Stessa geometria, presa a metà e girata — vedi apHalfFieldSvg. */
        box.innerHTML = apHalfFieldSvg({
            team: { lineup: sbLineup(side), name: team.name, color: team.color, logo: team.logo },
            /* Alto quanto la panchina accanto (sei riservisti più lo slot IR):
               dischi un po' più piccoli e distanze verticali compresse. */
            year, clipId: `tm-fd-${team.key}`, cls: 'mc-duel--night', r: 22, olR: 12, depth: 0.74,
            label: `${team.name} starting lineup, week ${week} of season ${year}`,
        });
        hydrateFieldPhotos(box, playerImageService);
        decorateLineup(box, side.starters || [], year);
        // La panchina non è più la fascia sotto il campo: è la colonna accanto.
        renderBench(bench, ir, year);
    } catch (e) {
        console.error('Team roster error:', e);
        box.innerHTML = '<p class="team-empty">Roster unavailable.</p>';
    }
}

/* I punti della giornata sul campo. Non si aggiungono righe sotto al
   giocatore — il campo è tarato perché il cognome del QB arrivi appena sopra
   la fila dei RB, e una riga in più li sovrapporrebbe — ma si allunga la riga
   del ruolo: "QB · 24,3". Lo si fa dopo il disegno, qui, e non dentro
   fieldMarker: quel marcatore lo usano anche la home e la pagina NFL, che i
   punti non li hanno. Ogni giocatore apre la sua scheda, come in panchina. */
function decorateLineup(box, starters, year) {
    const byName = new Map(starters.map(p => [p.name, p]));
    box.querySelectorAll('.nfl-fd-slot[data-player-name]').forEach(g => {
        const p = byName.get(g.dataset.playerName);
        if (!p) return;
        const v = parseFloat(p.fantasy_points);
        const label = g.querySelector('.nfl-fd-pos');
        if (label && Number.isFinite(v)) {
            label.textContent = `${label.textContent} · ${fmtScore(v)}`;
        }
        g.dataset.playerModal = '';
        g.dataset.pos = (p.position || '').toUpperCase();
        g.dataset.nfl = p.nfl_team || '';
        g.dataset.year = year;
        // nel dataset va l'HTML del fumetto così com'è: escapati solo i dati
        g.dataset.tip = `<b>${esc(p.name)}</b><br>${esc(g.dataset.pos)}${p.nfl_team ? ` · ${esc(p.nfl_team)}` : ''}`
            + (Number.isFinite(v) ? `<br>${fmtScore(v)} pts` : '');
    });
    initPlayerModal();
}

/* ─── La panchina ────────────────────────────────────────────────
   Stava sulla fascia di fuoricampo sotto il campo. Da colonna accanto al campo
   ci sta meglio: i riservisti sono sei o sette e in orizzontale diventavano
   dischi piccoli in fila, qui hanno nome, ruolo e punti della giornata. */
function renderBench(list, ir, year) {
    const box = document.getElementById('team-bench');
    const sub = document.getElementById('team-bench-sub');
    if (!box) return;
    if (sub) sub.textContent = `${list.length} reserve${list.length === 1 ? '' : 's'}${ir ? ' · 1 on IR' : ''}`;
    const row = ({ slot, player }, cls = '') => `
        <button type="button" class="tb-row ${cls}" data-player-modal data-player-name="${esc(player.name)}"
                data-pos="${esc(player.pos || '')}" data-nfl="${esc(player.nfl || '')}" data-year="${year}">
            <img class="pm-headshot tb-photo" src="images/fallback-player.svg" alt=""
                 data-player-name="${esc(player.name)}" data-team="${esc(player.nfl || '')}" data-pos="${esc(player.pos || '')}">
            <span class="tb-name">${esc(player.name)}</span>
            <span class="tb-pos">${player.pos || slot}${player.nfl ? ` · ${player.nfl}` : ''}</span>
            <span class="tb-pts">${player.pts != null ? fmtScore(player.pts) : '—'}</span>
        </button>`;
    /* Lo slot IR c'è sempre, anche vuoto: è un posto della rosa, e la sua
       assenza non si noterebbe. Pieno solo se qualcuno ci è stato messo. */
    const irBox = ir
        ? `<div class="tb-ir is-full"><span class="tb-ir-tag">IR</span>${row(ir, 'tb-row--ir')}</div>`
        : `<div class="tb-ir"><span class="tb-ir-tag">IR</span><span class="tb-ir-empty">Injured reserve slot open</span></div>`;
    box.innerHTML = `<div class="tb-list">${list.map(b => row(b)).join('')}${irBox}</div>`;
    hydrateFlagImages(box);
    initPlayerModal();
}

/* ─── Il mercato della squadra ────────────────────────────────────
   Le stesse mosse della sezione Waivers (`data/waiver-moves.js`), filtrate su
   questa squadra e ridotte alle più recenti: qui è un assaggio, la lista
   intera sta là. */
const WV_PREVIEW = 18;   // a tutta larghezza stanno su tre colonne

async function renderWaivers(team) {
    const box = document.getElementById('team-waivers');
    const sub = document.getElementById('team-waivers-sub');
    if (!box) return;
    try {
        /* Solo la stagione in corso: il mercato è una cosa di ADESSO, e
           ripescare l'ultimo anno con delle mosse faceva comparire il 2025
           sotto il titolo di una pagina che parla del 2026. A inizio stagione
           il blocco è vuoto, ed è giusto così. */
        const year = CURRENT_SEASON;
        const { mosse: tutte, fonte } = await getWaiverMoves(year)
            .catch(() => ({ mosse: [], fonte: 'rose' }));
        const mosse = tutte.filter(m => m.squadra === team.key);
        if (!mosse.length) {
            if (sub) sub.textContent = `Season ${year}`;
            box.innerHTML = '<p class="team-empty">No moves yet this season.</p>';
            return;
        }
        const dentro = mosse.filter(m => m.verso === 'in').length;
        if (sub) {
            sub.textContent = `Season ${year} · ${dentro} in, ${mosse.length - dentro} out`
                + (fonte === 'rose' ? ' · reconstructed' : '');
        }
        box.innerHTML = `<div class="tw-list">${mosse.slice(0, WV_PREVIEW).map(m => `
            <div class="tw-row">
                <span class="tw-week">${m.settimana != null ? `W${m.settimana}` : '—'}</span>
                <span class="tw-dir ${m.verso === 'in' ? 'tw-in' : 'tw-out'}">${m.verso === 'in' ? 'IN' : 'OUT'}</span>
                <span class="tw-name">${m.nome}</span>
                <span class="tw-pos">${m.pos || ''}${m.nfl ? ` · ${m.nfl}` : ''}</span>
            </div>`).join('')}</div>
        <a class="tw-more" href="#waivers">All moves in the Waiver Wire &rarr;</a>`;
    } catch (e) {
        console.error('Team waivers error:', e);
        box.innerHTML = '<p class="team-empty">Moves unavailable.</p>';
    }
}

function renderFlags(players) {
    const container = document.getElementById('team-flags');
    if (!container) return;
    if (!players.length) {
        container.innerHTML = `<p class="empty-state-text">No player drafted in multiple seasons.</p>`;
        return;
    }

    const figs = players.map(p => franchiseFig(p)).join('');
    container.innerHTML = `
        <div class="allpro-car-nav tf-nav">
            <button class="allpro-car-btn" data-dir="-1" aria-label="Precedente">‹</button>
            <button class="allpro-car-btn" data-dir="1" aria-label="Successivo">›</button>
        </div>
        <div class="allpro-track tf-track">${figs}</div>`;

    hydrateFlagImages(container);
    hydratePaniniBadges(container);
    initPlayerModal(); // click su figurina → scheda completa
    const track = container.querySelector('.tf-track');
    container.querySelectorAll('.allpro-car-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const step = Math.round(track.clientWidth * 0.7);
            track.scrollBy({ left: step * Number(btn.dataset.dir), behavior: 'smooth' });
        });
    });
}

function franchiseFig(p) {
    return `
    <div class="allpro-fig" data-player-modal data-player-name="${p.name}" data-pos="${p.pos || ''}" data-nfl="">
        ${paniniCard({ name: p.name, pos: p.pos, nfl: '', compact: true })}
        <div class="allpro-fig-cap tf-cap">
            <span class="allpro-fig-pts">${p.seasons.length}<small>× draft</small></span>
            <span class="tf-seasons">${p.seasons.join(' · ')}</span>
        </div>
    </div>`;
}

function hydrateFlagImages(container) {
    container.querySelectorAll('.pm-headshot').forEach(async (img) => {
        const name = img.dataset.playerName;
        if (!name) return;
        img.onerror = () => {
            if (!img.src.endsWith('images/fallback-player.svg')) img.src = 'images/fallback-player.svg';
        };
        try {
            const url = await playerImageService.getPlayerImageUrl(name, img.dataset.team, img.dataset.pos, CURRENT_SEASON);
            if (url) img.src = url;
        } catch (e) { /* fallback già impostato */ }
    });
}
