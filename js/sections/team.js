/**
 * Team Page Section — Franchise page
 * Attivata via hash #team-capi | #team-lasers | #team-oscurus | #team-sommo
 * Hero grafico (niente foto) + bento grid: badge wall, stats, storia,
 * identità, franchise players, rivalità, divisa.
 */

import { CURRENT_SEASON } from '../data.js?v=580';
import { getLeagueData, TEAM_KEY_LIST } from '../data/league-data.js?v=579';
import { computeTeamBadges } from '../data/badges.js?v=557';
import { stickerSVG, sbStickerSVG, champStickerSVG } from '../ui/badge-svg.js?v=518';
import { paniniCard, initPlayerModal, hydratePaniniBadges } from '../components/player-modal.js?v=710';
import { playerImageService } from '../services/player-image-service.js?v=522';

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

// Cache-bust delle divise: da bumpare quando si sostituiscono i file in
// "Team Uniform/". Senza, il browser continua a servire la vecchia immagine
// dalla cache disco — il nome del file non cambia (stessa ragione per cui i
// wallpaper del Game Center hanno FIELD_IMG_VERSION).
const UNIFORM_IMG_VERSION = 2;

export const TEAMS = {
    capi: {
        key: 'capi',
        name: 'Capi dei Pianeti',
        color: '#FF6600',
        logo: 'Team%20Logo/team_capi_transparent.png',
        uniform: `Team%20Uniform/CDP_Uniform.jpg?v=${UNIFORM_IMG_VERSION}`,
        bio: `Founded in 2019 with the vision of those who look far ahead, Capi dei Pianeti have always operated on a different scale. Their orange burns like the sun of a distant solar system: impossible to ignore, impossible not to recognize. Every draft has been a planned invasion, every season a conquest. They don't play in a league — they rule a universe.`,
    },
    lasers: {
        key: 'lasers',
        name: 'Lasers',
        color: '#D4AF37',
        logo: 'Team%20Logo/team_lasers_transparent.png',
        uniform: `Team%20Uniform/LASERS_Uniform.jpg?v=${UNIFORM_IMG_VERSION}`,
        bio: `The Lasers don't shout. They cut. Since 2019, this franchise has built its identity on absolute precision: every draft pick a calculated move, every lineup a perfect formula. The gold in their emblem isn't decoration — it's the signature of those who don't make mistakes. When the Lasers fire the beam, the game is already decided.`,
    },
    oscurus: {
        key: 'oscurus',
        name: 'Oscurus',
        color: '#800020',
        logo: 'Team%20Logo/team_oscurus_transparent.png',
        uniform: `Team%20Uniform/OBSCURUS__Uniform.jpg?v=${UNIFORM_IMG_VERSION}`,
        bio: `From darkness rise the dominators. Oscurus has existed since 2019 as a silent force that grows in the shadows until it's too late to stop it. Their dark maroon crest speaks of blood spilled every week, of broken defenses and victories built with iron. They don't seek the crowd's love — they seek the ring. And when they find it, no one is surprised.`,
    },
    sommo: {
        key: 'sommo',
        name: 'Sommo',
        color: '#1c4750',
        logo: 'Team%20Logo/team_sommo_transparent.png',
        uniform: `Team%20Uniform/SOMMO__Uniform.jpg?v=${UNIFORM_IMG_VERSION}`,
        bio: `The name doesn't lie. Sommo has been, since 2019, the franchise that chose the path of strategy where others chose instinct. Their deep green is that of unexplored oceans, of long-term plans, of decisions that only make sense in hindsight. There's no need to shout when you're already the strongest in the room.`,
    },
};

let _badgesByTile = null; // badge correnti indicizzati per il popover

export function initTeam() {
    const hash = location.hash.slice(1); // es. 'team-capi'
    const teamKey = hash.replace('team-', '');
    const team = TEAMS[teamKey];
    if (!team) return;

    const section = document.getElementById('team');
    section.style.setProperty('--team-color', team.color);

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
        <div class="section-inner team-bento" id="team-bento">
            <div class="bento-cell cell-history" style="--cell-i:0">
                <div class="bento-cell-head"><h2 class="bento-cell-title">History</h2></div>
                <div id="team-history">${spinner}</div>
            </div>
            <div class="bento-cell cell-stats" style="--cell-i:1">
                <div class="bento-cell-head"><h2 class="bento-cell-title">All-Time</h2></div>
                <div id="team-alltime">${spinner}</div>
            </div>
            <div class="bento-cell cell-identity" style="--cell-i:2">
                <div class="team-identity-head">
                    <img src="${team.logo}" alt="${team.name}" class="team-identity-logo"
                         onerror="this.style.display='none'">
                    <div>
                        <h2 class="bento-cell-title">The Franchise</h2>
                        <span class="team-identity-sub">Since 2019</span>
                    </div>
                </div>
                <p class="team-bio">${team.bio}</p>
            </div>
            <div class="bento-cell cell-h2h" style="--cell-i:3">
                <div class="bento-cell-head"><h2 class="bento-cell-title">Rivalry</h2></div>
                <div id="team-h2h">${spinner}</div>
            </div>
            <div class="bento-cell cell-uniform" style="--cell-i:4">
                <div class="bento-cell-head"><h2 class="bento-cell-title">Uniform</h2></div>
                <img src="${team.uniform}" alt="${team.name} Uniform" class="team-uniform-img"
                     onerror="this.style.display='none'">
            </div>
            <div class="bento-cell cell-players" style="--cell-i:5">
                <div class="bento-cell-head">
                    <h2 class="bento-cell-title">Franchise Players</h2>
                    <span class="bento-cell-sub">Drafted in 2+ seasons</span>
                </div>
                <div class="team-flags" id="team-flags">${spinner}</div>
            </div>
        </div>
    `;

    getLeagueData().then(league => {
        // Se nel frattempo l'utente ha cambiato pagina, non renderizzare
        if (!location.hash.includes(team.key)) return;
        const at = league.allTime[team.key];
        const lastComplete = [...league.seasons].reverse().find(s => s.complete);
        const isReigningChamp = lastComplete?.sbWinnerKey === team.key;
        renderSBStickers(at.sbWins);
        renderQuickStats(at);
        renderStickers(computeTeamBadges(league, team.key), isReigningChamp, lastComplete?.year);
        renderAllTime(at);
        renderHistory(league, team.key);
        renderH2H(at, team.key);
        renderFlags(league.franchisePlayers[team.key] || []);
        bindStickerPop(section);
    }).catch(e => {
        console.error('Team page load error:', e);
    });
}

// ─── Hero: sticker Super Bowl (in alto a destra, uno per titolo) ──

function renderSBStickers(years) {
    const el = document.getElementById('team-sb-stickers');
    if (!el) return;
    if (!years.length) { el.innerHTML = ''; return; }
    el.innerHTML = years.map((year, i) => `
        <div class="sb-sticker" style="--stk-i:${i}" title="Super Bowl ${_sbRoman(year)} — ${year}">
            ${sbStickerSVG(_sbRoman(year), year)}
        </div>
    `).join('');
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
            // Dentro l'ovale: il milestone per wins-club, l'anno per il resto
            const text = b.id === 'wins-club' ? inst.iconText : (inst.season || null);
            items.push({ id: tileId, name: b.name, svg: stickerSVG({ icon: b.icon, text }), champ: false });
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

// ─── Celle bento ─────────────────────────────────────────────────

function renderAllTime(at) {
    const el = document.getElementById('team-alltime');
    if (!el) return;
    const winPct = at.games ? (at.w / at.games * 100) : 0;
    el.innerHTML = `
        <div class="at-record">${at.w}<span class="at-record-sep">–</span>${at.l}${at.t ? `<span class="at-record-sep">–</span>${at.t}` : ''}</div>
        <div class="at-record-label">All-time record</div>
        <div class="at-winbar"><div class="at-winbar-fill" style="width:${winPct.toFixed(1)}%"></div></div>
        <div class="at-winbar-label">${winPct.toFixed(1)}% wins</div>
        <div class="at-ministats">
            <div class="at-ministat"><span class="at-ms-value">${fmtPts(at.pf)}</span><span class="at-ms-label">Points scored</span></div>
            <div class="at-ministat"><span class="at-ms-value">${fmtPts(at.pa)}</span><span class="at-ms-label">Points allowed</span></div>
            <div class="at-ministat"><span class="at-ms-value">${at.sbApps.length}</span><span class="at-ms-label">Finals played</span></div>
            <div class="at-ministat"><span class="at-ms-value">${at.bestStreak.len || '—'}</span><span class="at-ms-label">Best streak</span></div>
            <div class="at-ministat"><span class="at-ms-value">${at.highGame ? fmtScore(at.highGame.pts) : '—'}</span><span class="at-ms-label">Best game${at.highGame ? ` · ${at.highGame.season}` : ''}</span></div>
            <div class="at-ministat"><span class="at-ms-value">${at.games ? fmtScore(at.pf / at.games) : '—'}</span><span class="at-ms-label">Avg. points</span></div>
        </div>
    `;
}

function fmtScore(n) {
    return (+n).toFixed(1).replace('.', ',');
}

function renderHistory(league, teamKey) {
    const el = document.getElementById('team-history');
    if (!el) return;
    const rows = [...league.seasons].reverse().map(s => {
        const t = s.perTeam[teamKey];
        if (!t || !t.games.length) return '';
        let chip;
        if (!s.complete) {
            chip = '<span class="hist-chip hist-chip--live">In progress</span>';
        } else if (t.sbWin) {
            chip = '<span class="hist-chip hist-chip--champ">Champion</span>';
        } else if (t.sbAppearance) {
            chip = '<span class="hist-chip hist-chip--runnerup">Runner-up</span>';
        } else if (t.rsTitle) {
            chip = '<span class="hist-chip hist-chip--rs">RS Champ</span>';
        } else {
            chip = `<span class="hist-chip">#${t.rank || '—'}</span>`;
        }
        return `
        <div class="hist-row${s.year === CURRENT_SEASON ? ' hist-row--current' : ''}">
            <span class="hist-year">${s.year}</span>
            <span class="hist-record">${t.w}–${t.l}${t.t ? `–${t.t}` : ''}</span>
            <span class="hist-pf">${fmtPts(t.pf)} pt</span>
            ${chip}
        </div>`;
    }).join('');
    el.innerHTML = rows || '<p class="empty-state-text">No seasons played.</p>';
}

function renderH2H(at, teamKey) {
    const el = document.getElementById('team-h2h');
    if (!el) return;
    const rows = TEAM_KEY_LIST.filter(k => k !== teamKey).map(opp => {
        const r = at.vs[opp] || { w: 0, l: 0, t: 0 };
        const games = r.w + r.l + r.t;
        const pct = games ? (r.w / games * 100) : 0;
        const oppTeam = TEAMS[opp];
        return `
        <div class="h2h-row">
            <img src="${oppTeam.logo}" alt="${oppTeam.name}" class="h2h-logo" onerror="this.style.display='none'">
            <div class="h2h-info">
                <div class="h2h-name">vs ${oppTeam.name}</div>
                <div class="h2h-bar"><div class="h2h-bar-fill" style="width:${pct.toFixed(0)}%"></div></div>
            </div>
            <span class="h2h-record">${r.w}–${r.l}${r.t ? `–${r.t}` : ''}</span>
        </div>`;
    }).join('');
    el.innerHTML = rows;
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
