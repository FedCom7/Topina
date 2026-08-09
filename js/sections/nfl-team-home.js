/**
 * Blocchi della tab Home della pagina squadra NFL (layout a 3 colonne):
 * calendario a blocchi (sx), campo formazione da depth chart (centro-alto),
 * draft più recente (dx-alto), classifica di division + team stats (dx-basso).
 * Il riassunto grafici (centro-basso) resta in nfl-team-page.js, che riusa
 * gli helper privati dei grafici già montati nella tab Stats.
 * Nessun fetch proprio: riceve dati già caricati da nfl-team-page.js.
 */

import { esc, teamLogo } from './player-page.js?v=828';
import { NFL_TEAMS } from '../data/nfl-teams.js?v=505';
import { playerImageService } from '../services/player-image-service.js?v=515';

// ─── Calendario a blocchi ─────────────────────────────────────────────────

const _dateFmt = (iso) => {
    if (!iso) return '—';
    const d = new Date(iso);
    return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
};
const _timeFmt = (g) => {
    const d = g.date ? new Date(g.date) : null;
    if (!d || isNaN(d.getTime())) return null;
    if (g.timeValid === false) return 'TBD';
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }) + ' ET';
};

function gameCardHtml(g, seasonType, nextKey) {
    const ha = g.homeAway === 'home' ? 'vs' : '@';
    const isNext = (g.eventId || `${g.seasonType}-${g.weekNum}-${g.date}`) === nextKey;
    const wk = seasonType === 3 ? (g.weekText || 'Post') : (g.weekNum != null ? `Wk ${g.weekNum}` : '');
    let resultHtml;
    if (g.completed && g.score != null && g.oppScore != null) {
        const s = +g.score, o = +g.oppScore;
        const cls = s > o ? 'w' : s < o ? 'l' : 't';
        const letter = cls === 'w' ? 'W' : cls === 'l' ? 'L' : 'T';
        resultHtml = `<span class="pp-res pp-res--${cls}">${letter} ${g.score}-${g.oppScore}</span>`;
    } else {
        const t = _timeFmt(g);
        resultHtml = `${t ? `<span class="nfl-home-game-time">${esc(t)}</span>` : ''}${g.tv ? `<span class="nfl-sched-tv">${esc(g.tv)}</span>` : ''}`;
    }
    return `
    <div class="nfl-home-game-card${isNext ? ' is-next' : ''}">
        <span class="nfl-home-game-wk">${esc(wk)}</span>
        <img class="nfl-home-game-logo" src="${teamLogo(g.opp)}" alt="" onerror="this.style.display='none'">
        <div class="nfl-home-game-body">
            <b>${esc(ha)} ${esc(g.opp || g.oppName || '—')}</b>
            <span class="pm-note">${esc(_dateFmt(g.date))}</span>
        </div>
        <div class="nfl-home-game-result">${resultHtml}</div>
    </div>`;
}

/** Calendario a blocchi (una card per gara): Preseason → Regular → Postseason, tutta la stagione. */
export function calendarBlocksBlock(live) {
    const all = live?.fullSchedule;
    if (!all?.length) return '';
    const groups = [
        { type: 1, label: 'Preseason' },
        { type: 2, label: 'Regular Season' },
        { type: 3, label: 'Postseason' },
    ];
    // Prossima gara (o l'ultima in corso/appena passata) da evidenziare e a cui scrollare.
    const now = Date.now();
    let nextKey = null, minDelta = Infinity;
    for (const g of all) {
        if (g.completed || !g.date) continue;
        const dt = new Date(g.date).getTime() - now;
        if (dt > -6 * 3600 * 1000 && dt < minDelta) { minDelta = dt; nextKey = g.eventId || `${g.seasonType}-${g.weekNum}-${g.date}`; }
    }
    const body = groups.map(grp => {
        const gs = all.filter(g => g.seasonType === grp.type)
            .sort((a, b) => (a.weekNum || 0) - (b.weekNum || 0) || (new Date(a.date) - new Date(b.date)));
        if (!gs.length) return '';
        return `<h4 class="nfl-sched-group nfl-home-cal-group">${grp.label}</h4>${gs.map(g => gameCardHtml(g, grp.type, nextKey)).join('')}`;
    }).join('');
    if (!body.trim()) return '';
    return `
    <section class="pm-block pp-block nfl-home-cal">
        <span class="mc-kicker">Full schedule</span>
        <div class="nfl-home-cal-list">${body}</div>
    </section>`;
}

// ─── Draft (anno corrente) ──────────────────────────────────────────────────

/** Pick del draft NFL reale più recente della squadra: Round(Pick) / Player / Pos / School. La home mostra solo l'anno corrente. */
export function draftBlock(draftHistory) {
    if (!draftHistory?.length) return '';
    const latestSeason = Math.max(...draftHistory.map(p => p.season));
    const picks = draftHistory.filter(p => p.season === latestSeason).sort((a, b) => (a.pick || 0) - (b.pick || 0));
    if (!picks.length) return '';
    const rows = picks.map(p => `
        <tr>
            <td>R${p.round ?? '—'} (${p.pick ?? '—'})</td>
            <td>${esc(p.name || '—')}</td>
            <td>${esc(p.pos || '—')}</td>
            <td>${esc(p.college || '—')}</td>
        </tr>`).join('');
    return `
    <section class="pm-block pp-block nfl-home-draft">
        <span class="mc-kicker">Draft ${latestSeason}</span>
        <div class="pm-table-wrap pp-scroll">
            <table class="pm-table pp-table">
                <thead><tr><th>Round (Pick)</th><th>Player</th><th>Pos</th><th>School</th></tr></thead>
                <tbody>${rows}</tbody>
            </table>
        </div>
        <p class="pm-note">Full draft history (all years) is in the Franchise tab.</p>
    </section>`;
}

// ─── Classifica di division + team stats ───────────────────────────────────

/** Classifica dei soli 4 team della division della squadra (da getLeagueStandings) + PF/PA/diff. */
export function divisionStandingsBlock(standings, identity, abbr) {
    if (!standings?.length || !identity) return '';
    const teammates = new Set(Object.entries(NFL_TEAMS).filter(([, v]) => v.division === identity.division).map(([k]) => k));
    const entries = standings.flatMap(c => c.entries || []).filter(e => teammates.has(e.abbr))
        .sort((a, b) => (a.seed ?? 99) - (b.seed ?? 99) || (b.wins ?? 0) - (a.wins ?? 0));
    if (!entries.length) return '';
    const rows = entries.map(e => `
        <tr class="${e.abbr === abbr ? 'is-self' : ''}">
            <td class="nfl-home-stand-team"><img src="${teamLogo(e.abbr)}" alt="" onerror="this.style.display='none'">${esc(e.abbr)}</td>
            <td>${e.wins ?? 0}-${e.losses ?? 0}${e.ties ? '-' + e.ties : ''}</td>
            <td>${e.pf ?? '—'}</td>
            <td>${e.pa ?? '—'}</td>
            <td>${e.diff ?? '—'}</td>
        </tr>`).join('');
    const self = entries.find(e => e.abbr === abbr);
    return `
    <section class="pm-block pp-block nfl-home-stand">
        <span class="mc-kicker">${esc(identity.division)} standings</span>
        <div class="pm-table-wrap pp-scroll">
            <table class="pm-table pp-table">
                <thead><tr><th>Team</th><th>W-L-T</th><th>PF</th><th>PA</th><th>Diff</th></tr></thead>
                <tbody>${rows}</tbody>
            </table>
        </div>
        ${self ? `<p class="pm-note">Streak: ${esc(self.streak || '—')}${self.clincher ? ` · ${esc(self.clincher)}` : ''}</p>` : ''}
    </section>`;
}

// ─── Campo formazione (depth chart, vista dall'alto) ───────────────────────

// Proiezione lineare pura (vera vista dall'alto, niente omografia/prospettiva).
// Scala non uniforme x/y intenzionale: campo "ritratto" stilizzato per impilare
// attacco/difesa e lasciare spazio ai nomi sotto ogni foto.
const TDF = { W: 53.3, vbW: 460, spanY: 24, vbH: 660, losY: 13.3 };
const tdX = (fx) => (fx / TDF.W) * TDF.vbW;
const tdY = (fy) => (fy / TDF.spanY) * TDF.vbH;

// Template fisso: 11 offense (11 personnel: 5 OL, QB, RB, 3 WR, TE) + 11 difesa (base 4-3).
// Coordinate distanziate (split di linea "aperti") così che disco foto + nome
// sotto non si sovrappongano tra giocatori adiacenti.
const OFFENSE_SLOTS = [
    { key: 'WR1', fx: 5, fy: 14.2, label: 'WR' },
    { key: 'WR3', fx: 10, fy: 16.4, label: 'WR' },
    { key: 'LT', fx: 15, fy: 14.8, label: 'LT' },
    { key: 'LG', fx: 20.6, fy: 14.8, label: 'LG' },
    { key: 'C', fx: 26.65, fy: 14.8, label: 'C' },
    { key: 'RG', fx: 32.7, fy: 14.8, label: 'RG' },
    { key: 'RT', fx: 38.3, fy: 14.8, label: 'RT' },
    { key: 'TE', fx: 44, fy: 14.8, label: 'TE' },
    { key: 'WR2', fx: 48.6, fy: 14.2, label: 'WR' },
    { key: 'QB', fx: 26.65, fy: 17.8, label: 'QB' },
    { key: 'RB', fx: 21, fy: 19.8, label: 'RB' },
];
const DEFENSE_SLOTS = [
    { key: 'LE', fx: 15, fy: 11.8, label: 'DE' },
    { key: 'DT1', fx: 22, fy: 11.8, label: 'DT' },
    { key: 'DT2', fx: 31.3, fy: 11.8, label: 'DT' },
    { key: 'RE', fx: 38.3, fy: 11.8, label: 'DE' },
    { key: 'WLB', fx: 17.5, fy: 9, label: 'LB' },
    { key: 'MLB', fx: 26.65, fy: 9, label: 'LB' },
    { key: 'SLB', fx: 35.8, fy: 9, label: 'LB' },
    { key: 'CBL', fx: 4, fy: 7, label: 'CB' },
    { key: 'CBR', fx: 49.3, fy: 7, label: 'CB' },
    { key: 'FS', fx: 24, fy: 2.2, label: 'FS' },
    { key: 'SS', fx: 33, fy: 4.4, label: 'SS' },
];

const _norm = (s) => (s || '').toUpperCase();

// Cognome del giocatore per l'etichetta sotto la foto (stile screenshot: nome + posizione).
const _SUFFIX = new Set(['JR', 'JR.', 'SR', 'SR.', 'II', 'III', 'IV', 'V']);
function _lastName(full) {
    const parts = (full || '').trim().split(/\s+/).filter(Boolean);
    while (parts.length > 1 && _SUFFIX.has(parts[parts.length - 1].toUpperCase())) parts.pop();
    return parts.length ? parts[parts.length - 1] : (full || '');
}

/** Primi `count` giocatori (dedup per nome) dai gruppi depth-chart il cui `pos` matcha uno dei pattern, in ordine. */
function _pickFrom(groups, patterns, count, used) {
    const out = [];
    for (const re of patterns) {
        for (const grp of groups) {
            if (!re.test(_norm(grp.pos))) continue;
            for (const pl of grp.players || []) {
                if (out.length >= count) break;
                if (used.has(pl.name)) continue;
                out.push(pl);
                used.add(pl.name);
            }
        }
        if (out.length >= count) break;
    }
    return out;
}

/**
 * Mappa i gruppi generici del depth chart (getTeamDepthChart) sul template
 * fisso 11+11. Tollerante alle diverse fonti/etichette osservate:
 * - nflverse (stagioni passate / fallback): etichette semplici (DE, DT, OLB,
 *   ILB, CB, FS, SS, ...);
 * - ESPN live (stagione corrente): etichette con lato (LDE/RDE, LDT/RDT,
 *   WLB/MLB/SLB, LCB/RCB, ...), verificate sull'endpoint reale /depthcharts.
 * Ogni gruppo prova prima i pattern più specifici poi quelli generici; un
 *'ultimo giro raccoglie qualunque giocatore avanzato dello stesso lato per
 * riempire gli slot ancora vuoti, così la formazione mostra sempre 11+11
 * titolari quando il depth chart ne contiene abbastanza (quasi sempre).
 */
function buildFormationSlots(depthChart) {
    const offense = depthChart?.offense || [];
    const defense = depthChart?.defense || [];
    const usedOff = new Set(), usedDef = new Set();

    const qb = _pickFrom(offense, [/^QB$/], 1, usedOff);
    const rb = _pickFrom(offense, [/^RB$/, /^FB$/], 1, usedOff);
    const wr = _pickFrom(offense, [/^WR/], 3, usedOff);
    const te = _pickFrom(offense, [/^TE/], 1, usedOff);
    const lt = _pickFrom(offense, [/^LT$/, /^T$/, /^OT$/, /^OL$/], 1, usedOff);
    const rt = _pickFrom(offense, [/^RT$/, /^T$/, /^OT$/, /^OL$/], 1, usedOff);
    const lg = _pickFrom(offense, [/^LG$/, /^G$/, /^OG$/, /^OL$/], 1, usedOff);
    const rg = _pickFrom(offense, [/^RG$/, /^G$/, /^OG$/, /^OL$/], 1, usedOff);
    const c = _pickFrom(offense, [/^C$/, /^OL$/], 1, usedOff);
    const offAssign = {
        QB: qb[0], RB: rb[0], WR1: wr[0], WR2: wr[1], WR3: wr[2], TE: te[0],
        LT: lt[0], LG: lg[0], C: c[0], RG: rg[0], RT: rt[0],
    };
    _fillRemaining(offense, OFFENSE_SLOTS, offAssign, usedOff);

    const de = _pickFrom(defense, [/^(DE|EDGE|LDE|RDE)$/, /^DL$/], 2, usedDef);
    const dt = _pickFrom(defense, [/^(DT|NT|LDT|RDT)$/, /^DL$/], 2, usedDef);
    const lbMid = _pickFrom(defense, [/^(ILB|MLB|MIKE)$/], 1, usedDef);
    const lbOut = _pickFrom(defense, [/^(OLB|WLB|SLB|WILL|SAM)$/], 2, usedDef);
    const lbAll = lbMid.concat(lbOut);
    const lbFill = _pickFrom(defense, [/^LB$/], Math.max(0, 3 - lbAll.length), usedDef);
    lbAll.push(...lbFill);
    const cb = _pickFrom(defense, [/^(CB|LCB|RCB)$/], 2, usedDef);
    const cbFill = _pickFrom(defense, [/^(DB|NB)$/], Math.max(0, 2 - cb.length), usedDef);
    const cbAll = cb.concat(cbFill);
    const fs = _pickFrom(defense, [/^FS$/], 1, usedDef);
    const ss = _pickFrom(defense, [/^SS$/], 1, usedDef);
    const sFill = _pickFrom(defense, [/^(S|DB|NB)$/], (fs.length ? 0 : 1) + (ss.length ? 0 : 1), usedDef);
    let sIdx = 0;
    const defAssign = {
        LE: de[0], RE: de[1], DT1: dt[0], DT2: dt[1],
        WLB: lbAll[0], MLB: lbAll[1], SLB: lbAll[2],
        CBL: cbAll[0], CBR: cbAll[1],
        FS: fs[0] || sFill[sIdx++], SS: ss[0] || sFill[sIdx++],
    };
    _fillRemaining(defense, DEFENSE_SLOTS, defAssign, usedDef);
    return { offAssign, defAssign };
}

/** Ultimo giro: qualunque slot ancora senza giocatore viene riempito con il primo titolare avanzato dello stesso lato (dedup già garantito da `used`). */
function _fillRemaining(groups, slots, assign, used) {
    for (const slot of slots) {
        if (assign[slot.key]) continue;
        const leftover = _pickFrom(groups, [/./], 1, used);
        if (leftover[0]) assign[slot.key] = leftover[0];
    }
}

// Numero yard stile NFL: 2 cifre "a cavallo" della linea (la yard line passa in
// mezzo), ruotate di 90° e leggibili dalla linea laterale più vicina (i due lati
// sono specchiati, come su un campo vero). Il "40" ha una freccia verso la
// endzone più vicina (endDir: -1 = verso l'alto, +1 = verso il basso; il 50 no).
function _yardNumber(fx, fy, num, endDir) {
    const x = tdX(fx), y = tdY(fy);
    const rot = fx < TDF.W / 2 ? 90 : -90;   // sinistra e destra specchiati
    const gap = 12;                          // semi-distanza cifre attorno alla linea (la yard line passa in mezzo)
    const d1 = num[0], d2 = num[1];
    // La yard line passa tra le due cifre; le cifre sopra/sotto la linea si
    // scambiano tra i due lati così il numero resta leggibile dalla propria
    // linea laterale (i due lati sono specchiati, come su un campo vero).
    const near = rot === 90 ? d1 : d2, far = rot === 90 ? d2 : d1;
    let s = `
        <text x="${x.toFixed(1)}" y="${(y - gap).toFixed(1)}" class="nfl-fd2-num" text-anchor="middle" dominant-baseline="central" transform="rotate(${rot} ${x.toFixed(1)} ${(y - gap).toFixed(1)})">${near}</text>
        <text x="${x.toFixed(1)}" y="${(y + gap).toFixed(1)}" class="nfl-fd2-num" text-anchor="middle" dominant-baseline="central" transform="rotate(${rot} ${x.toFixed(1)} ${(y + gap).toFixed(1)})">${far}</text>`;
    if (endDir) {
        // Freccia adiacente al top del numero, verso la endzone. Proporzioni da
        // regolamento NFL: lati lunghi 36" / base 18" → rapporto lato:base ≈ 2:1.
        const baseY = y + endDir * 28;        // base appena oltre il bordo goalward del numero
        const halfBase = 4;                   // base 8px
        const tipY = baseY + endDir * 15;     // altezza → lati ≈ √(4²+15²) ≈ 15.5 ≈ 2× base
        s += `<path d="M ${(x - halfBase).toFixed(1)} ${baseY.toFixed(1)} L ${(x + halfBase).toFixed(1)} ${baseY.toFixed(1)} L ${x.toFixed(1)} ${tipY.toFixed(1)} Z" class="nfl-fd2-arrow"/>`;
    }
    return s;
}

// Righe stile football americano: linee bianche ogni 5 yard, numeri (40·50·40)
// ogni 10 yard vicino a entrambe le linee laterali, hash mark centrali ogni yard.
function _fieldMarkings() {
    let s = '';
    // Bande "erba tagliata" alternate ogni 5 yard.
    for (let fy = 0; fy < TDF.spanY; fy += 5) {
        if (((fy / 5) | 0) % 2 === 0) continue;
        s += `<rect x="0" y="${tdY(fy).toFixed(1)}" width="${TDF.vbW}" height="${(tdY(Math.min(fy + 5, TDF.spanY)) - tdY(fy)).toFixed(1)}" class="nfl-fd2-band"/>`;
    }
    // Linee yard ogni 5 (a fy 2,7,12,17,22 così il midfield "50" cade al centro).
    for (let fy = 2; fy <= 22; fy += 5) {
        const y = tdY(fy);
        s += `<line x1="0" y1="${y.toFixed(1)}" x2="${TDF.vbW}" y2="${y.toFixed(1)}" class="nfl-fd2-yl"/>`;
    }
    // Numeri: 40 in alto (freccia su), 50 al centro (no freccia), 40 in basso (freccia giù).
    // A ~9 yд dalla linea laterale (regolamento: tops dei numeri 9 yd dal bordo).
    for (const [fy, num, endDir] of [[2, '40', -1], [12, '50', 0], [22, '40', 1]]) {
        s += _yardNumber(9, fy, num, endDir);
        s += _yardNumber(44.3, fy, num, endDir);
    }
    // Hash mark ogni yard su due colonne centrali (NFL: 6,17 yd dal centro) + tacche a bordo campo.
    for (let fy = 1; fy < TDF.spanY; fy++) {
        const y = tdY(fy);
        for (const hx of [23.58, 29.72]) {
            const x = tdX(hx);
            s += `<line x1="${(x - 2).toFixed(1)}" y1="${y.toFixed(1)}" x2="${(x + 2).toFixed(1)}" y2="${y.toFixed(1)}" class="nfl-fd2-hash"/>`;
        }
        s += `<line x1="0" y1="${y.toFixed(1)}" x2="6" y2="${y.toFixed(1)}" class="nfl-fd2-hash"/>`;
        s += `<line x1="${(TDF.vbW - 6).toFixed(1)}" y1="${y.toFixed(1)}" x2="${TDF.vbW}" y2="${y.toFixed(1)}" class="nfl-fd2-hash"/>`;
    }
    return s;
}

function _playerMarker({ fx, fy, label, player, side, abbr, year }) {
    const x = tdX(fx), y = tdY(fy);
    const name = player?.name || '';
    const jersey = player?.jersey;
    const hasPlayer = !!name;
    return `
    <g class="nfl-fd-slot nfl-fd-slot--${side}${hasPlayer ? '' : ' is-empty'}" transform="translate(${x.toFixed(1)},${y.toFixed(1)})">
        <circle r="19" class="nfl-fd-disc"/>
        ${hasPlayer ? `<image class="nfl-fd-photo" data-headshot data-player-name="${esc(name)}" data-team="${esc(abbr)}" data-pos="${esc(label)}" data-year="${year}"
            href="images/fallback-player.svg" x="-19" y="-19" width="38" height="38"
            clip-path="url(#nfl-fd-clip)" preserveAspectRatio="xMidYMid slice"><title>${esc(name)}${jersey != null ? ` · #${esc(String(jersey))}` : ''}</title></image>` : ''}
        ${hasPlayer && jersey != null ? `<text class="nfl-fd-jersey" y="-23" text-anchor="middle">${esc(String(jersey))}</text>` : ''}
        ${hasPlayer ? `<text class="nfl-fd-name" y="32" text-anchor="middle">${esc(_lastName(name))}</text>` : ''}
        <text class="nfl-fd-pos" y="${hasPlayer ? 43 : 5}" text-anchor="middle">${esc(label)}</text>
    </g>`;
}

/** Campo vista dall'alto con attacco/difesa titolari schierati (template 11 personnel / 4-3 base). */
export function formationFieldBlock(depthChart, abbr, year) {
    if (!depthChart || (!depthChart.offense?.length && !depthChart.defense?.length)) {
        return `
        <section class="pm-block pp-block nfl-home-field">
            <span class="mc-kicker">Starting lineup</span>
            <div class="empty-state" style="padding:20px 0"><p class="empty-state-text">Depth chart not available for this season.</p></div>
        </section>`;
    }
    const { offAssign, defAssign } = buildFormationSlots(depthChart);
    const marker = (slot, assign, side) => _playerMarker({ fx: slot.fx, fy: slot.fy, label: slot.label, player: assign[slot.key], side, abbr, year });
    const offMarkers = OFFENSE_SLOTS.map(s => marker(s, offAssign, 'off')).join('');
    const defMarkers = DEFENSE_SLOTS.map(s => marker(s, defAssign, 'def')).join('');
    const losY = tdY(TDF.losY);
    return `
    <section class="pm-block pp-block nfl-home-field">
        <span class="mc-kicker">Starting lineup · base 4-3</span>
        <div class="nfl-fd2" data-fd2>
            <svg class="nfl-fd2-svg" viewBox="0 0 ${TDF.vbW} ${TDF.vbH}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Starting lineup, top-down view">
                <defs><clipPath id="nfl-fd-clip" clipPathUnits="userSpaceOnUse"><circle r="19" cx="0" cy="0"/></clipPath></defs>
                <rect x="0" y="0" width="${TDF.vbW}" height="${TDF.vbH}" class="nfl-fd2-turf"/>
                ${_fieldMarkings()}
                <line x1="0" y1="${losY.toFixed(1)}" x2="${TDF.vbW}" y2="${losY.toFixed(1)}" class="nfl-fd2-los"/>
                <text x="10" y="16" class="nfl-fd2-side-lbl">DEFENSE</text>
                <text x="10" y="${TDF.vbH - 8}" class="nfl-fd2-side-lbl">OFFENSE</text>
                ${defMarkers}${offMarkers}
            </svg>
        </div>
        <p class="pm-note">Starters from the current depth chart, laid out in a generic template (11 personnel offense, base 4-3 defense) — not the team's actual scheme, which the data doesn't specify. Top-down "lineup" view, not a real play alignment.</p>
    </section>`;
}

/** Idrata le foto (elementi SVG &lt;image&gt;: si aggiorna l'attributo href, non .src). */
export function hydrateFormationPhotos(section) {
    section.querySelectorAll('.nfl-fd-photo[data-headshot]').forEach((img) => {
        img.addEventListener('error', () => {
            if (!img.getAttribute('href')?.endsWith('fallback-player.svg')) img.setAttribute('href', 'images/fallback-player.svg');
        });
        playerImageService.getPlayerImageUrl(img.dataset.playerName, img.dataset.team, img.dataset.pos, img.dataset.year)
            .then((url) => { if (url) img.setAttribute('href', url); })
            .catch(() => {});
    });
}
