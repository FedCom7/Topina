/**
 * Sezione "Players" — ricerca di un giocatore Topina (storico completo di
 * chi ha mai giocato in lega, da careers.js::buildCareers) o di una delle
 * 32 squadre NFL, con link diretto alla scheda completa del giocatore
 * (#player/{year}/{pos}/{nome}) o alla pagina squadra NFL (#nfl-team/{abbr}).
 */

import { getLeagueStandings, getLeaguePowerRankings, getNews, getLeagueLeaders } from '../data/nfl-team-live.js?v=613';
import { CURRENT_SEASON } from '../data.js?v=535';
import { esc, teamLogoUrl, buildPlayerIndex, teamResults, playerResults, resultRow } from '../data/player-search-core.js?v=580';
import { getTeamStats } from '../data/nfl-team-stats.js?v=556';
import { getLeagueTeamsAdvanced } from '../data/context-score.js?v=608';
import { canonAbbr, getWeekGames, getCurrentNflWeek } from '../data/nfl-schedule.js?v=525';
import { getTeamIdentity, NFL_TEAMS } from '../data/nfl-teams.js?v=513';
import { getSeasonStats, getSeasonProjections } from '../data/projections.js?v=594';

// ─── Confronto lega · tutte le 32 squadre (nflverse team_stats + advanced) ───
// Modulo interattivo in testa al pannello NFL: un grande scatter Attacco×Difesa
// (hero) + un unico scatter CONFIGURABILE (assi X/Y liberi + terza metrica sul
// colore dei punti) con evidenziazione/isolamento squadra e tooltip ricchi, più
// la tabella completa sotto "Statistiche estese". Riusa team_stats, advanced
// nflverse e FPI ESPN già scaricati.
const _lcF0 = v => v == null ? '—' : Math.round(v).toString();
const _lcF1 = v => v == null ? '—' : v.toFixed(1);
const _lcF2 = v => v == null ? '—' : v.toFixed(2);
const _lcPct = v => v == null ? '—' : Math.round(v * 100) + '%';
const _lcSigned = v => v == null ? '—' : (v >= 0 ? '+' : '') + _lcF1(v);
const _lcTierT = r => r == null ? '' : r <= 10 ? 'ts-good-t' : r >= 23 ? 'ts-bad-t' : 'ts-mid-t';

/** Metriche selezionabili sugli assi/colore dello scatter configurabile.
 *  low:true = valore più basso è migliore → assi e colore orientati così che
 *  "in alto / a destra / verde = meglio". */
const LC_METRICS = [
    { key: 'epa', label: 'Offensive EPA/play', fmt: _lcF2, low: false },
    { key: 'defEpa', label: 'Defensive EPA allowed', fmt: _lcF2, low: true },
    { key: 'net', label: 'Point differential', fmt: _lcSigned, low: false },
    { key: 'succ', label: 'Offensive success rate', fmt: _lcPct, low: false },
    { key: 'defSucc', label: 'Success rate allowed', fmt: _lcPct, low: true },
    { key: 'ppg', label: 'Points scored/game', fmt: _lcF1, low: false },
    { key: 'papg', label: 'Points allowed/game', fmt: _lcF1, low: true },
    { key: 'ydsPerPlay', label: 'Yards per play', fmt: _lcF1, low: false },
    { key: 'totYdsPg', label: 'Total yards/game', fmt: _lcF0, low: false },
    { key: 'passYdsPg', label: 'Passing yards/game', fmt: _lcF0, low: false },
    { key: 'rushYdsPg', label: 'Rushing yards/game', fmt: _lcF0, low: false },
    { key: 'ydsAllowedPg', label: 'Yards allowed/game', fmt: _lcF0, low: true },
    { key: 'take', label: 'Takeaways', fmt: _lcF0, low: false },
    { key: 'giveaway', label: 'Giveaways', fmt: _lcF0, low: true },
    { key: 'sacks', label: 'Sacks (defense)', fmt: _lcF0, low: false },
    { key: 'sacksAllowed', label: 'Sacks allowed', fmt: _lcF0, low: true },
    { key: 'proe', label: 'PROE (pass aggressiveness)', fmt: _lcSigned, low: false },
    { key: 'playsPg', label: 'Pace · plays/game', fmt: _lcF1, low: false },
    { key: 'fpi', label: 'FPI (ESPN rating)', fmt: _lcSigned, low: false },
];
const _lcMetric = k => LC_METRICS.find(m => m.key === k) || { key: k, label: k, fmt: _lcF1, low: false };

/** Confronti "consigliati": coppie X↔Y con un legame analitico (+ colore utile).
 *  Impostano i tre selettori con un click; l'utente resta libero di personalizzare. */
const LC_PRESETS = [
    { label: 'Points scored × allowed', x: 'ppg', y: 'papg', c: 'net' },
    { label: 'Offense · explosiveness (EPA) × consistency (success)', x: 'epa', y: 'succ', c: 'net' },
    { label: 'Offense × Defense (EPA)', x: 'epa', y: 'defEpa', c: 'net' },
    { label: 'Turnovers · takeaways × giveaways', x: 'take', y: 'giveaway', c: 'net' },
    { label: 'Defense · EPA allowed × success allowed', x: 'defEpa', y: 'defSucc', c: 'papg' },
    { label: 'Offense · volume (total yds) × efficiency (yds/play)', x: 'totYdsPg', y: 'ydsPerPlay', c: 'net' },
    { label: 'Air × ground (passing × rushing yds)', x: 'passYdsPg', y: 'rushYdsPg', c: 'net' },
    { label: 'Pace (plays/game) × offensive efficiency (EPA)', x: 'playsPg', y: 'epa', c: 'net' },
    { label: 'Disruptive defense · pass rush (sacks) × takeaways', x: 'sacks', y: 'take', c: 'papg' },
    { label: 'QB protection (sacks allowed) × offensive efficiency', x: 'sacksAllowed', y: 'epa', c: 'net' },
    { label: 'Differential × FPI (actual vs expected)', x: 'net', y: 'fpi', c: 'succ' },
];

// Frazione 0..1 dei valori <= v (per la scala colore a percentile).
const _lcPctile = (v, sorted) => {
    if (v == null || !sorted.length) return null;
    let lo = 0, hi = sorted.length;
    while (lo < hi) { const md = (lo + hi) >> 1; if (sorted[md] <= v) lo = md + 1; else hi = md; }
    return lo / sorted.length;
};

let _lcState = { rows: [] }; // dati dell'ultima costruzione (una sola istanza per pagina)

/** Stagione nflverse più recente con dati offensivi + advanced lega. */
async function pickLeagueStats() {
    for (const y of [CURRENT_SEASON, CURRENT_SEASON - 1]) {
        const [stats, adv] = await Promise.all([
            getTeamStats(y).catch(() => null),
            getLeagueTeamsAdvanced(y).catch(() => ({})),
        ]);
        if (Object.values(stats?.teams || {}).some(t => t.offense?.ppg != null)) return { year: y, stats, adv };
    }
    return null;
}

/** Una riga per squadra con metriche chiave e rank NFL (differenziale calcolato qui). */
function buildLeagueRows(stats, adv, fpiByAbbr) {
    const teams = stats?.teams || {};
    const advByAbbr = {};
    for (const [k, v] of Object.entries(adv || {})) advByAbbr[canonAbbr(k)] = v;
    const advVals = Object.values(advByAbbr);
    const rankOf = (val, arr, hi = true) => val == null || !arr.length ? null
        : arr.filter(v => v != null && (hi ? v > val : v < val)).length + 1;
    const epaArr = advVals.map(t => t.offEpaPerPlay), succArr = advVals.map(t => t.successRate);
    const defEpaArr = advVals.map(t => t.defEpaPerPlay);
    const rows = [];
    for (const [ab, t] of Object.entries(teams)) {
        const cab = canonAbbr(ab);
        const o = t.offense || {}, d = t.defense || {}, ro = t.ranks?.offense || {}, rd = t.ranks?.defense || {};
        const a = advByAbbr[cab] || {};
        rows.push({
            abbr: cab, name: getTeamIdentity(cab)?.name || cab,
            net: (o.ppg != null && d.papg != null) ? o.ppg - d.papg : null, netRank: null,
            epa: a.offEpaPerPlay ?? null, epaRank: rankOf(a.offEpaPerPlay, epaArr),
            defEpa: a.defEpaPerPlay ?? null, defEpaRank: rankOf(a.defEpaPerPlay, defEpaArr, false),
            succ: a.successRate ?? null, succRank: rankOf(a.successRate, succArr),
            defSucc: a.defSuccessRate ?? null,
            ppg: o.ppg ?? null, ppgRank: ro.ppg ?? null,
            papg: d.papg ?? null, papgRank: rd.papg ?? null,
            ydsPerPlay: o.ydsPerPlay ?? null, totYdsPg: o.totYdsPg ?? null,
            passYdsPg: o.passYdsPg ?? null, rushYdsPg: o.rushYdsPg ?? null,
            ydsAllowedPg: d.totYdsAllowedPg ?? null,
            take: d.takeaways ?? null, takeRank: rd.takeaways ?? null,
            giveaway: o.turnovers ?? null,
            sacks: d.sacks ?? null, sacksAllowed: o.sacksAllowed ?? null,
            proe: a.proe ?? null, playsPg: a.playsPg ?? o.playsPg ?? null,
            fpi: fpiByAbbr[cab] ?? null,
        });
    }
    const netVals = rows.map(r => r.net).filter(v => v != null);
    rows.forEach(r => { r.netRank = r.net == null ? null : netVals.filter(v => v > r.net).length + 1; });
    return rows;
}

// Tick "tondi" per gli assi dello scatter.
function _lcTicks(min, max, n = 4) {
    const span = (max - min) || 1;
    const mag = Math.pow(10, Math.floor(Math.log10(span / n)));
    const norm = span / n / mag;
    const step = (norm >= 5 ? 5 : norm >= 2 ? 2 : 1) * mag;
    const out = [];
    for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) out.push(+v.toFixed(6));
    return out;
}

/**
 * Scatter grande e interattivo (lo usano sia l'hero che il configurabile).
 * cfg: { xKey, yKey, cKey?, hi?, iso? }. Assi orientati per metrica (low-good →
 * invertito) così che "in alto a destra = meglio". Terza metrica opzionale sul
 * colore (rosso = peggio → verde = meglio, per percentile). Ogni punto è un link
 * alla scheda squadra con tooltip ricco (data-tip letto in hover).
 */
function _lcBigScatter(rows, cfg) {
    const mx = _lcMetric(cfg.xKey), my = _lcMetric(cfg.yKey), mc = cfg.cKey ? _lcMetric(cfg.cKey) : null;
    const P = rows.map(r => ({ abbr: r.abbr, name: r.name, x: r[cfg.xKey], y: r[cfg.yKey], c: mc ? r[cfg.cKey] : null }))
        .filter(p => p.x != null && p.y != null);
    if (P.length < 6) return '<p class="pm-note">Not enough data for this metric combination.</p>';
    const W = 900, H = 500, m = { l: 66, r: 26, t: 30, b: 60 };
    const pw = W - m.l - m.r, ph = H - m.t - m.b;
    const xs = P.map(p => p.x), ys = P.map(p => p.y);
    let xmin = Math.min(...xs), xmax = Math.max(...xs), ymin = Math.min(...ys), ymax = Math.max(...ys);
    const padx = (xmax - xmin) * 0.09 || 1, pady = (ymax - ymin) * 0.09 || 1;
    xmin -= padx; xmax += padx; ymin -= pady; ymax += pady;
    const xr = (xmax - xmin) || 1, yr = (ymax - ymin) || 1;
    const X = v => m.l + (mx.low ? (xmax - v) : (v - xmin)) / xr * pw; // low-good → migliore a destra
    const Y = v => m.t + (my.low ? (v - ymin) : (ymax - v)) / yr * ph; // low-good → migliore in alto
    const med = arr => { const a = [...arr].sort((p, q) => p - q); return a[Math.floor(a.length / 2)]; };
    const yTicks = _lcTicks(ymin, ymax).map(v => `<line x1="${m.l}" y1="${Y(v).toFixed(1)}" x2="${m.l + pw}" y2="${Y(v).toFixed(1)}" stroke="var(--border-subtle)"/><text x="${m.l - 8}" y="${(Y(v) + 4).toFixed(1)}" text-anchor="end" font-size="12" fill="var(--text-muted)">${my.fmt(v)}</text>`).join('');
    const xTicks = _lcTicks(xmin, xmax).map(v => `<line x1="${X(v).toFixed(1)}" y1="${m.t}" x2="${X(v).toFixed(1)}" y2="${m.t + ph}" stroke="var(--border-subtle)" opacity="0.55"/><text x="${X(v).toFixed(1)}" y="${(m.t + ph + 20).toFixed(1)}" text-anchor="middle" font-size="12" fill="var(--text-muted)">${mx.fmt(v)}</text>`).join('');
    const guides = `<line x1="${X(med(xs)).toFixed(1)}" y1="${m.t}" x2="${X(med(xs)).toFixed(1)}" y2="${m.t + ph}" class="ts-guide"/><line x1="${m.l}" y1="${Y(med(ys)).toFixed(1)}" x2="${m.l + pw}" y2="${Y(med(ys)).toFixed(1)}" class="ts-guide"/>`;
    let colOf = () => 'var(--text-muted)';
    if (mc) {
        const sorted = P.map(p => p.c).filter(v => v != null).sort((a, b) => a - b);
        colOf = (v) => { if (v == null) return 'var(--text-muted)'; let p = _lcPctile(v, sorted); if (mc.low) p = 1 - p; return `hsl(${Math.round(p * 125)}, 60%, 47%)`; };
    }
    // Logo (trasparente) della squadra al posto del punto; la 3ª metrica, se attiva,
    // resta leggibile come alone colorato dietro il logo (verde=meglio, rosso=peggio).
    const draw = cfg.hi ? [...P].sort((a, b) => (a.abbr === cfg.hi ? 1 : 0) - (b.abbr === cfg.hi ? 1 : 0)) : P; // evidenziata sopra
    const dots = draw.map(p => {
        const isHi = cfg.hi && p.abbr === cfg.hi;
        const dim = cfg.iso && cfg.hi && !isHi;
        const s = isHi ? 30 : 22, cx = X(p.x), cy = Y(p.y);
        const auraCol = isHi ? 'var(--accent-red)' : (mc ? colOf(p.c) : null);
        const aura = auraCol
            ? (isHi
                ? `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${(s / 2 + 3).toFixed(1)}" fill="none" stroke="var(--accent-red)" stroke-width="2.5"/>`
                : `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${(s / 2 + 2).toFixed(1)}" fill="${auraCol}" fill-opacity="0.9"/>`)
            : '';
        const lbl = dim ? '' : `<text x="${(cx + s / 2 + 2).toFixed(1)}" y="${(cy + 3).toFixed(1)}" font-size="${isHi ? 13 : 11}" font-weight="${isHi ? 800 : 600}" fill="${isHi ? 'var(--accent-red)' : 'var(--text-secondary)'}">${esc(p.abbr)}</text>`;
        const tip = `${p.name}\n${mx.label}: ${mx.fmt(p.x)}\n${my.label}: ${my.fmt(p.y)}${mc ? `\n${mc.label}: ${mc.fmt(p.c)}` : ''}`;
        return `<a href="#nfl-team/${p.abbr}" data-tip="${esc(tip)}"><g opacity="${dim ? 0.14 : 1}">${aura}<image href="${teamLogoUrl(p.abbr)}" x="${(cx - s / 2).toFixed(1)}" y="${(cy - s / 2).toFixed(1)}" width="${s}" height="${s}"/>${lbl}</g></a>`;
    }).join('');
    const axl = `<text x="${m.l}" y="18" text-anchor="start" font-size="13" font-weight="700" fill="var(--text-secondary)">↑ ${esc(my.label)} · migliore</text><text x="${m.l + pw}" y="${H - 6}" text-anchor="end" font-size="13" font-weight="700" fill="var(--text-secondary)">${esc(mx.label)} · migliore →</text>`;
    return `<svg viewBox="0 0 ${W} ${H}" class="lc-svg" role="img" aria-label="${esc(mx.label)} contro ${esc(my.label)}">${xTicks}${yTicks}${guides}${dots}${axl}</svg>`;
}

/** Legenda della scala colore (rosso peggio → verde meglio) per la terza metrica. */
function _lcColorLegend(mc) {
    if (!mc) return '';
    const stops = [0, 25, 50, 75, 100].map(p => `hsl(${Math.round(p / 100 * 125)}, 60%, 47%) ${p}%`).join(', ');
    return `<div class="lc-legend"><span class="lc-legend-lbl">${esc(mc.label)}</span><i>worse</i><span class="lc-legend-bar" style="background:linear-gradient(90deg, ${stops})"></span><i>better</i></div>`;
}

// Colonne della tabella confronto (con rank per il colore fascia).
const LC_COLS = [
    { key: 'net', fmt: v => v == null ? '—' : (v >= 0 ? '+' : '') + _lcF1(v), rank: 'netRank', label: 'Diff' },
    { key: 'epa', fmt: _lcF2, rank: 'epaRank', label: 'EPA off' },
    { key: 'defEpa', fmt: _lcF2, rank: 'defEpaRank', label: 'EPA dif' },
    { key: 'succ', fmt: v => v == null ? '—' : Math.round(v * 100) + '%', rank: 'succRank', label: 'Succ%' },
    { key: 'ppg', fmt: _lcF1, rank: 'ppgRank', label: 'PF/g' },
    { key: 'papg', fmt: _lcF1, rank: 'papgRank', label: 'PS/g' },
    { key: 'take', fmt: _lcF0, rank: 'takeRank', label: 'Takeaway' },
    { key: 'fpi', fmt: v => v == null ? '—' : (v > 0 ? '+' : '') + _lcF1(v), rank: null, label: 'FPI' },
];

/** Tabella ordinabile: una riga per squadra, celle colorate per fascia di rank. */
function leagueTable(rows) {
    const sorted = [...rows].sort((a, b) => (b.net ?? -99) - (a.net ?? -99));
    const head = `<th>Team</th>` + LC_COLS.map((c, i) =>
        `<th data-sortable data-col="${i + 1}" style="cursor:pointer;text-align:center" title="Ordina per ${esc(c.label)}">${esc(c.label)}</th>`).join('');
    const body = sorted.map(r => {
        const cells = LC_COLS.map(c => {
            const v = r[c.key], rk = c.rank ? r[c.rank] : null;
            return `<td data-v="${v == null ? -1e9 : v}" style="text-align:center" class="${_lcTierT(rk)}">${c.fmt(v)}${rk != null ? ` <small>${rk}ª</small>` : ''}</td>`;
        }).join('');
        return `<tr><td><a class="ps-inline-team" href="#nfl-team/${r.abbr}"><img src="${teamLogoUrl(r.abbr)}" alt="" onerror="this.style.display='none'"> ${esc(r.abbr)}</a></td>${cells}</tr>`;
    }).join('');
    return `<div class="pm-table-wrap pp-scroll" style="margin-top:14px"><table class="pm-table pp-table lc-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

/** Modulo completo "Confronta le 32 squadre": hero A×D + scatter configurabile + tabella. */
/** Indice power ranking 0-100: media pesata dei percentili di 6 componenti già
 *  disponibili (differenziale, EPA off/dif, success off/dif, FPI). Difesa (EPA/
 *  success concessi) con percentile invertito. Ritorna righe ordinate + scomposizione. */
function _powerRanking(rows) {
    const COMP = [
        { key: 'net', w: 0.30, hi: true }, { key: 'epa', w: 0.20, hi: true },
        { key: 'defEpa', w: 0.20, hi: false }, { key: 'succ', w: 0.10, hi: true },
        { key: 'defSucc', w: 0.10, hi: false }, { key: 'fpi', w: 0.10, hi: true },
    ];
    const arrs = {};
    for (const c of COMP) arrs[c.key] = rows.map(r => r[c.key]).filter(v => v != null).sort((a, b) => a - b);
    const pct = (arr, x, hi) => {
        if (!arr.length || x == null) return null;
        const pr = arr.filter(v => v <= x).length / arr.length * 100;
        return hi ? pr : 100 - pr;
    };
    return rows.map(r => {
        let sum = 0, wsum = 0; const parts = {};
        for (const c of COMP) {
            const p = pct(arrs[c.key], r[c.key], c.hi);
            if (p != null) { sum += p * c.w; wsum += c.w; parts[c.key] = Math.round(p); }
        }
        return { abbr: r.abbr, name: r.name, power: wsum ? Math.round(sum / wsum) : null, parts };
    }).filter(r => r.power != null).sort((a, b) => b.power - a.power);
}

/** Lollipop della classifica composita: barra per squadra, top-5 verdi, bottom-5 rossi. */
function _powerLollipop(scored) {
    if (scored.length < 6) return '';
    const n = scored.length;
    return `<div class="lc-pr">${scored.map((r, i) => {
        const tier = i < 5 ? 'good' : i >= n - 5 ? 'bad' : 'mid';
        const tip = `${r.name} · ${r.power}/100 — Diff ${r.parts.net ?? '—'}° · EPA off ${r.parts.epa ?? '—'}° · EPA dif ${r.parts.defEpa ?? '—'}° · FPI ${r.parts.fpi ?? '—'}°`;
        return `<a class="lc-pr-row" href="#nfl-team/${r.abbr}" title="${esc(tip)}">
            <span class="lc-pr-rank">${i + 1}</span>
            <span class="lc-pr-team"><img src="${teamLogoUrl(r.abbr)}" alt="" onerror="this.style.display='none'"><b>${esc(r.abbr)}</b></span>
            <span class="lc-pr-track"><span class="lc-pr-fill lc-pr-${tier}" style="width:${r.power}%"></span></span>
            <span class="lc-pr-val">${r.power}</span>
        </a>`;
    }).join('')}</div>`;
}

/** Strip/beeswarm di una metrica: un punto per squadra, migliore a destra,
 *  colore = fascia percentile, quartili come guide. Mostra distacchi e gruppone. */
function _lcStrip(rows, metricKey, hiKey) {
    const m = _lcMetric(metricKey);
    const pts = rows.map(r => ({ abbr: r.abbr, name: r.name, v: r[metricKey] })).filter(p => p.v != null);
    if (pts.length < 6) return '<p class="pm-note">Not enough data for this metric.</p>';
    const W = 900, H = 160, mn = { l: 24, r: 24, t: 26, b: 28 };
    const pw = W - mn.l - mn.r;
    const vals = pts.map(p => p.v);
    let vmin = Math.min(...vals), vmax = Math.max(...vals);
    const pad = (vmax - vmin) * 0.06 || 1; vmin -= pad; vmax += pad;
    const xr = (vmax - vmin) || 1;
    const X = v => mn.l + (m.low ? (vmax - v) : (v - vmin)) / xr * pw; // low-good → migliore a destra
    const R = 8, midY = mn.t + (H - mn.t - mn.b) / 2;
    const sorted = [...vals].sort((a, b) => a - b);
    const pctOf = v => { const pr = sorted.filter(x => x <= v).length / sorted.length; return m.low ? 1 - pr : pr; };
    const qAt = f => sorted[Math.round((sorted.length - 1) * f)];
    const guides = [0.25, 0.5, 0.75].map(f => `<line x1="${X(qAt(f)).toFixed(1)}" y1="${mn.t}" x2="${X(qAt(f)).toFixed(1)}" y2="${(H - mn.b).toFixed(1)}" class="ts-guide"/>`).join('');
    const byX = pts.map(p => ({ ...p, x: X(p.v) })).sort((a, b) => a.x - b.x);
    const placed = [];
    for (const p of byX) {
        let y = midY, step = 0;
        while (placed.some(q => Math.abs(q.x - p.x) < R * 1.9 && Math.abs(q.y - y) < R * 1.9)) {
            step++; y = midY + (step % 2 ? 1 : -1) * Math.ceil(step / 2) * (R * 1.9);
        }
        placed.push({ ...p, y });
    }
    const dots = placed.map(p => {
        const isHi = hiKey && p.abbr === hiKey;
        const s = isHi ? 22 : 17;
        const band = `hsl(${Math.round(pctOf(p.v) * 125)}, 60%, 47%)`; // fascia = colore alone
        const aura = isHi
            ? `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${(s / 2 + 2.5).toFixed(1)}" fill="none" stroke="var(--accent-red)" stroke-width="2.5"/>`
            : `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${(s / 2 + 1.5).toFixed(1)}" fill="${band}" fill-opacity="0.9"/>`;
        return `<a href="#nfl-team/${p.abbr}">${aura}<image href="${teamLogoUrl(p.abbr)}" x="${(p.x - s / 2).toFixed(1)}" y="${(p.y - s / 2).toFixed(1)}" width="${s}" height="${s}"><title>${esc(p.name)} — ${esc(m.label)}: ${esc(m.fmt(p.v))}</title></image>${isHi ? `<text x="${p.x.toFixed(1)}" y="${(p.y - s / 2 - 4).toFixed(1)}" text-anchor="middle" font-size="11" font-weight="800" fill="var(--accent-red)">${esc(p.abbr)}</text>` : ''}</a>`;
    }).join('');
    const axl = `<text x="${mn.l}" y="16" text-anchor="start" font-size="12" fill="var(--text-muted)">← worse</text><text x="${W - mn.r}" y="16" text-anchor="end" font-size="12" fill="var(--text-muted)">better →</text>`;
    return `<svg viewBox="0 0 ${W} ${H}" class="lc-svg lc-strip-svg" role="img" aria-label="League distribution ${esc(m.label)}">${guides}${dots}${axl}</svg>`;
}

function leagueCompareModule({ year, stats, adv }, fpiByAbbr) {
    const rows = buildLeagueRows(stats, adv, fpiByAbbr);
    if (rows.length < 6) return '';
    _lcState = { rows };
    const scored = _powerRanking(rows);
    const teamOpts = ['<option value="">— no team —</option>'].concat(
        [...rows].sort((a, b) => a.name.localeCompare(b.name))
            .map(r => `<option value="${r.abbr}">${esc(r.name)} (${esc(r.abbr)})</option>`)).join('');
    const metricOpts = (sel) => LC_METRICS.map(m => `<option value="${m.key}"${m.key === sel ? ' selected' : ''}>${esc(m.label)}</option>`).join('');
    const colorOpts = (sel) => '<option value="">— none —</option>' + LC_METRICS.map(m => `<option value="${m.key}"${m.key === sel ? ' selected' : ''}>${esc(m.label)}</option>`).join('');
    const p0 = LC_PRESETS[0]; // preset iniziale (Points scored × allowed)
    const presetOpts = LC_PRESETS.map((p, i) => `<option value="${i}"${i === 0 ? ' selected' : ''}>${esc(p.label)}</option>`).join('') + '<option value="custom">Custom…</option>';
    return `
    <section class="pm-block pp-block lc-module">
        <span class="mc-kicker">Compare all 32 teams · ${year}</span>

        ${scored.length >= 6 ? `<div class="lc-prwrap">
            <h3 class="pp-cat-title">Power ranking · best and worst</h3>
            <p class="pm-note">Composite ranking 0-100: weighted average of percentiles for point differential (30%), offensive EPA (20%), defensive EPA (20%), off/def success rate (10%+10%) and FPI (10%). <b style="color:#22c55e">Green</b> = top-5, <b style="color:var(--accent-red)">red</b> = bottom-5. Hover for the breakdown, click for the team page.</p>
            ${_powerLollipop(scored)}
        </div>` : ''}

        <div class="lc-toolbar">
            <label class="lc-field"><span>Highlight team</span><select id="lc-team">${teamOpts}</select></label>
            <label class="lc-check"><input type="checkbox" id="lc-iso"> Isolate only this</label>
        </div>

        <div class="lc-strip-wrap">
            <div class="lc-toolbar">
                <label class="lc-field lc-field-wide"><span>League distribution · metric</span><select id="lc-strip-metric">${metricOpts('epa')}</select></label>
            </div>
            <div id="lc-strip"></div>
            <p class="pm-note">Each team is a dot on the chosen metric: gaps (who pulls away, who's in the pack) show up better than a list. Better to the right; color = tier (red→green); lines = quartiles. Hover for the value, click for the page.</p>
        </div>

        <div class="lc-hero-wrap">
            <h3 class="pp-cat-title">Offense × Defense · the entire NFL</h3>
            <div id="lc-hero" class="lc-chart-host"></div>
            <p class="pm-note">X = offensive efficiency (EPA/play), Y = defensive efficiency (EPA allowed). Top-right = complete teams, bottom-left = those struggling. Cross = NFL medians. Hover for details, click for the team page.</p>
        </div>

        <details class="pp-recap-ids lc-cfg-wrap" style="margin-top:14px">
            <summary>Explore · configurable scatter (free axes and color)</summary>
            <div class="lc-toolbar" style="margin-top:10px">
                <label class="lc-field lc-field-wide"><span>Suggested comparison</span><select id="lc-preset">${presetOpts}</select></label>
            </div>
            <div class="lc-toolbar">
                <label class="lc-field"><span>X axis</span><select id="lc-x">${metricOpts(p0.x)}</select></label>
                <label class="lc-field"><span>Y axis</span><select id="lc-y">${metricOpts(p0.y)}</select></label>
                <label class="lc-field"><span>Dot color</span><select id="lc-c">${colorOpts(p0.c)}</select></label>
            </div>
            <div id="lc-cfg-legend"></div>
            <div id="lc-cfg" class="lc-chart-host"></div>
            <p class="pm-note">Start from a <b>suggested comparison</b> (X↔Y pairs with a meaningful link) or freely pick the axis and color metrics: it switches to "Custom". Axes oriented so <b>top-right = better</b>; color from red (worse) to green (better).</p>
        </details>

        <details class="pp-recap-ids" style="margin-top:18px">
            <summary>Extended stats — all 32 teams × metrics</summary>
            <div style="margin-top:10px">
                <p class="pm-note" style="margin-bottom:8px">Sort by clicking the headers; click a row for the team page.</p>
                ${leagueTable(rows)}
                <p class="pm-note">Diff = points scored − allowed per game. Off/def EPA and success rate from nflverse play-by-play (def EPA = allowed, lower = better); FPI from ESPN. Cell color = rank tier out of 32 (green top-10, red bottom-10). Regular season.</p>
            </div>
        </details>
    </section>`;
}

/** Rende interattivi i due scatter (assi/colore/squadra/isola), il tooltip e la tabella. */
function bindLeagueCompare(container) {
    // Tabella ordinabile (nell'espandibile).
    const table = container.querySelector('.lc-table');
    if (table) {
        const tbody = table.querySelector('tbody');
        table.querySelectorAll('th[data-sortable]').forEach(th => {
            th.addEventListener('click', () => {
                const idx = +th.dataset.col;
                const asc = th.dataset.dir !== 'asc';
                table.querySelectorAll('th').forEach(h => { if (h !== th) h.removeAttribute('data-dir'); });
                th.dataset.dir = asc ? 'asc' : 'desc';
                [...tbody.querySelectorAll('tr')]
                    .sort((a, b) => { const va = +a.children[idx].dataset.v, vb = +b.children[idx].dataset.v; return asc ? va - vb : vb - va; })
                    .forEach(r => tbody.appendChild(r));
            });
        });
    }

    const rows = _lcState.rows || [];
    const heroHost = container.querySelector('#lc-hero');
    const cfgHost = container.querySelector('#lc-cfg');
    const legendHost = container.querySelector('#lc-cfg-legend');
    const teamSel = container.querySelector('#lc-team');
    const isoChk = container.querySelector('#lc-iso');
    const presetSel = container.querySelector('#lc-preset');
    const xSel = container.querySelector('#lc-x');
    const ySel = container.querySelector('#lc-y');
    const cSel = container.querySelector('#lc-c');
    if (!rows.length || !heroHost || !cfgHost) return;

    // Ogni host: uno slot per l'SVG (rigenerato) + un tooltip persistente (fratello
    // dello slot, così i redraw dell'SVG non lo distruggono).
    const mkChart = (host) => {
        host.innerHTML = '<div class="lc-slot"></div>';
        const slot = host.querySelector('.lc-slot');
        const tip = document.createElement('div');
        tip.className = 'lc-tip';
        tip.hidden = true;
        host.appendChild(tip);
        host.addEventListener('mousemove', (e) => {
            const a = e.target.closest('a[data-tip]');
            if (!a) { tip.hidden = true; return; }
            const lines = a.dataset.tip.split('\n');
            tip.innerHTML = `<b>${esc(lines[0])}</b>` + lines.slice(1).map(l => `<span>${esc(l)}</span>`).join('');
            tip.hidden = false;
            const rect = host.getBoundingClientRect();
            let x = e.clientX - rect.left + 14, y = e.clientY - rect.top + 14;
            if (x + tip.offsetWidth > rect.width) x = e.clientX - rect.left - tip.offsetWidth - 10;
            if (y + tip.offsetHeight > rect.height) y = e.clientY - rect.top - tip.offsetHeight - 10;
            tip.style.left = Math.max(0, x) + 'px';
            tip.style.top = Math.max(0, y) + 'px';
        });
        host.addEventListener('mouseleave', () => { tip.hidden = true; });
        return slot;
    };
    const heroSlot = mkChart(heroHost), cfgSlot = mkChart(cfgHost);

    const stripSel = container.querySelector('#lc-strip-metric');
    const stripHost = container.querySelector('#lc-strip');

    const common = () => ({ hi: teamSel.value || null, iso: isoChk.checked && !!teamSel.value });
    const drawHero = () => { heroSlot.innerHTML = _lcBigScatter(rows, { xKey: 'epa', yKey: 'defEpa', ...common() }); };
    const drawCfg = () => {
        legendHost.innerHTML = _lcColorLegend(cSel.value ? _lcMetric(cSel.value) : null);
        cfgSlot.innerHTML = _lcBigScatter(rows, { xKey: xSel.value, yKey: ySel.value, cKey: cSel.value || null, ...common() });
    };
    const drawStrip = () => { if (stripHost && stripSel) stripHost.innerHTML = _lcStrip(rows, stripSel.value, teamSel.value || null); };

    stripSel?.addEventListener('change', drawStrip);
    teamSel.addEventListener('change', () => { drawHero(); drawCfg(); drawStrip(); });
    isoChk.addEventListener('change', () => { drawHero(); drawCfg(); });
    // Preset: imposta i tre selettori (senza dispatch → non li marca "custom") e ridisegna.
    presetSel?.addEventListener('change', () => {
        const p = LC_PRESETS[+presetSel.value];
        if (!p) return; // "Personalizzato" scelto a mano: nessun cambio
        xSel.value = p.x; ySel.value = p.y; cSel.value = p.c || '';
        drawCfg();
    });
    // Modifica manuale di un asse/colore → passa a "Personalizzato".
    const markCustom = () => { if (presetSel) presetSel.value = 'custom'; drawCfg(); };
    xSel.addEventListener('change', markCustom);
    ySel.addEventListener('change', markCustom);
    cSel.addEventListener('change', markCustom);

    drawHero();
    drawCfg();
    drawStrip();
}

// ─── Dashboard giocatori · lega NFL (gemello del confronto squadre) ──────────
// Reale vs Proiettato (breakout/bust), scatter configurabile con preset, e
// classifiche-insight, tutto filtrato per ruolo. Riusa i totali di stagione già
// scaricati (getSeasonStats + getSeasonProjections, una fetch ciascuno) e gli
// stessi helper/estetica dello scatter squadre (.lc-*). "Insight first."
const LP_POS = ['RB', 'WR', 'QB', 'TE'];

/** Metriche selezionabili per assi/colore dello scatter giocatori. */
const LP_METRICS = [
    { key: 'ptsLeague', label: 'League points (season)', fmt: _lcF0, low: false },
    { key: 'ppg', label: 'League points / game', fmt: _lcF1, low: false },
    { key: 'projPts', label: 'Projected points', fmt: _lcF0, low: false },
    { key: 'vsProj', label: 'Gap vs projection', fmt: _lcSigned, low: false },
    { key: 'adp', label: 'ADP · draft cost', fmt: _lcF1, low: true },
    { key: 'tgt', label: 'Target', fmt: _lcF0, low: false },
    { key: 'tgtShare', label: 'Team target share', fmt: _lcPct, low: false },
    { key: 'rzTgt', label: 'Red zone targets', fmt: _lcF0, low: false },
    { key: 'snaps', label: 'Offensive snaps', fmt: _lcF0, low: false },
    { key: 'touches', label: 'Touches · carries + targets', fmt: _lcF0, low: false },
    { key: 'ptsPerTouch', label: 'Points per touch', fmt: _lcF2, low: false },
    { key: 'ptsPerTgt', label: 'Points per target', fmt: _lcF2, low: false },
    { key: 'catchRate', label: 'Catch rate', fmt: _lcPct, low: false },
    { key: 'ydsPerTouch', label: 'Yards per touch', fmt: _lcF1, low: false },
    { key: 'yearsExp', label: 'NFL years of experience', fmt: _lcF0, low: false },
];
const _lpMetric = k => LP_METRICS.find(m => m.key === k) || { key: k, label: k, fmt: _lcF1, low: false };

/** Confronti giocatore "consigliati": ognuno risponde a una domanda fantasy. */
const LP_PRESETS = [
    { label: 'Value vs draft cost (ADP)', x: 'adp', y: 'ptsLeague', c: 'vsProj' },
    { label: 'Usage → Production (targets × points)', x: 'tgt', y: 'ptsLeague', c: 'ptsPerTgt' },
    { label: 'Volume × Efficiency (touches × pts/touch)', x: 'touches', y: 'ptsPerTouch', c: 'ppg' },
    { label: 'Red zone × Production', x: 'rzTgt', y: 'ptsLeague', c: 'ppg' },
    { label: 'Snaps × Points per game', x: 'snaps', y: 'ppg', c: 'ppg' },
    { label: 'Experience × Output (rookies/veterans)', x: 'yearsExp', y: 'ppg', c: 'vsProj' },
    { label: 'Target share × Points per game', x: 'tgtShare', y: 'ppg', c: 'ptsPerTgt' },
];

const LP_MIN_GP = 4; // sotto le 4 gare i totali sono rumore

let _lpState = { rows: [], year: null };

/** Una riga per giocatore skill: totali reali + proiezione + metriche derivate (target share per squadra). */
function buildPlayerRows(stats, proj) {
    const skill = new Set(LP_POS);
    const teamTgt = {};
    for (const p of stats.values()) if (skill.has(p.pos) && p.tgt) teamTgt[p.team] = (teamTgt[p.team] || 0) + p.tgt;
    const rows = [];
    for (const [key, p] of stats.entries()) {
        if (!skill.has(p.pos)) continue;
        const gp = p.gp || 0, pts = p.ptsLeague;
        if (pts == null || gp < 1) continue;
        const pr = proj?.get(key) || null;
        const touches = (p.rushAtt || 0) + (p.tgt || 0);
        const yds = (p.rushYd || 0) + (p.recYd || 0);
        rows.push({
            key, name: p.name, pos: p.pos, team: canonAbbr(p.team || ''),
            gp, ptsLeague: pts, ppg: gp ? pts / gp : null, posRank: p.posRank ?? null,
            projPts: pr?.projPts ?? null,
            vsProj: (pr?.projPts != null) ? pts - pr.projPts : null,
            adp: pr?.adp ?? null,
            tgt: p.tgt ?? null, rzTgt: p.rzTgt ?? null,
            tgtShare: (p.tgt && teamTgt[p.team]) ? p.tgt / teamTgt[p.team] : null,
            snaps: p.snaps ?? null, touches: touches || null,
            ptsPerTouch: touches ? pts / touches : null,
            ptsPerTgt: p.tgt ? pts / p.tgt : null,
            catchRate: p.tgt ? (p.rec || 0) / p.tgt : null,
            ydsPerTouch: touches ? yds / touches : null,
            yearsExp: pr?.yearsExp ?? null,
        });
    }
    return rows;
}

/** Scatter giocatori: assi orientati "in alto a destra = meglio", colore = 3ª metrica
 *  a percentile (rosso→verde), diagonale y=x opzionale (breakout/bust). Punto = link scheda. */
function _lpScatter(rows, cfg) {
    const mx = _lpMetric(cfg.xKey), my = _lpMetric(cfg.yKey), mc = cfg.cKey ? _lpMetric(cfg.cKey) : null;
    const P = rows.map(r => ({ key: r.key, name: r.name, pos: r.pos, team: r.team, ppg: r.ppg, vsProj: r.vsProj, x: r[cfg.xKey], y: r[cfg.yKey], c: mc ? r[cfg.cKey] : null }))
        .filter(p => p.x != null && p.y != null);
    if (P.length < 5) return '<p class="pm-note">Not enough data for this combination (at least 5 players needed).</p>';
    const W = 900, H = 540, m = { l: 60, r: 24, t: 34, b: 56 };
    const pw = W - m.l - m.r, ph = H - m.t - m.b;
    const xs = P.map(p => p.x), ys = P.map(p => p.y);
    let xmin, xmax, ymin, ymax;
    if (cfg.diag) { // dominio condiviso: la diagonale y=x ha senso solo così
        const lo = Math.min(...xs, ...ys), hi = Math.max(...xs, ...ys);
        xmin = ymin = lo; xmax = ymax = hi;
    } else {
        xmin = Math.min(...xs); xmax = Math.max(...xs); ymin = Math.min(...ys); ymax = Math.max(...ys);
    }
    const padx = (xmax - xmin) * 0.08 || 1, pady = (ymax - ymin) * 0.08 || 1;
    xmin -= padx; xmax += padx; ymin -= pady; ymax += pady;
    const xr = (xmax - xmin) || 1, yr = (ymax - ymin) || 1;
    const X = v => m.l + (mx.low ? (xmax - v) : (v - xmin)) / xr * pw;
    const Y = v => m.t + (my.low ? (v - ymin) : (ymax - v)) / yr * ph;
    const yTicks = _lcTicks(ymin, ymax).map(v => `<line x1="${m.l}" y1="${Y(v).toFixed(1)}" x2="${m.l + pw}" y2="${Y(v).toFixed(1)}" stroke="var(--border-subtle)"/><text x="${m.l - 8}" y="${(Y(v) + 4).toFixed(1)}" text-anchor="end" font-size="12" fill="var(--text-muted)">${my.fmt(v)}</text>`).join('');
    const xTicks = _lcTicks(xmin, xmax).map(v => `<line x1="${X(v).toFixed(1)}" y1="${m.t}" x2="${X(v).toFixed(1)}" y2="${m.t + ph}" stroke="var(--border-subtle)" opacity="0.55"/><text x="${X(v).toFixed(1)}" y="${(m.t + ph + 20).toFixed(1)}" text-anchor="middle" font-size="12" fill="var(--text-muted)">${mx.fmt(v)}</text>`).join('');
    // Diagonale "ha reso = proiezione": sopra = breakout, sotto = bust.
    const diag = cfg.diag ? (() => {
        const lo = Math.max(xmin, ymin), hi = Math.min(xmax, ymax);
        return `<line x1="${X(lo).toFixed(1)}" y1="${Y(lo).toFixed(1)}" x2="${X(hi).toFixed(1)}" y2="${Y(hi).toFixed(1)}" class="ts-guide"/>
            <text x="${(X(hi) - 6).toFixed(1)}" y="${(Y(hi) + 16).toFixed(1)}" text-anchor="end" font-size="11" font-weight="700" fill="var(--accent-green, #3fb950)">above = breakout ↑</text>`;
    })() : '';
    let colOf = () => 'var(--text-muted)';
    if (mc) {
        const sorted = P.map(p => p.c).filter(v => v != null).sort((a, b) => a - b);
        colOf = (v) => { if (v == null) return 'var(--text-muted)'; let q = _lcPctile(v, sorted); if (mc.low) q = 1 - q; return `hsl(${Math.round(q * 125)}, 62%, 47%)`; };
    }
    // Etichette selettive: il giocatore evidenziato + i più "estremi" sull'asse Y
    // (e, in modalità diagonale, i top/flop per scarto), mai un nome su ogni punto.
    const labelKeys = new Set();
    if (cfg.hiKey) labelKeys.add(cfg.hiKey);
    [...P].sort((a, b) => b.y - a.y).slice(0, 6).forEach(p => labelKeys.add(p.key));
    if (cfg.diag) {
        const byV = P.filter(p => p.vsProj != null).sort((a, b) => b.vsProj - a.vsProj);
        byV.slice(0, 4).forEach(p => labelKeys.add(p.key));
        byV.slice(-4).forEach(p => labelKeys.add(p.key));
    }
    const dots = P.map(p => {
        const isHi = cfg.hiKey && p.key === cfg.hiKey;
        const dim = cfg.iso && cfg.hiKey && !isHi;
        const fill = isHi ? 'var(--accent-red)' : colOf(p.c);
        const r = isHi ? 9 : (mc ? 6 : 5.5);
        const op = dim ? 0.1 : (mc ? 0.92 : 0.82);
        const showLbl = !dim && (isHi || labelKeys.has(p.key));
        const lbl = showLbl ? `<text x="${(X(p.x) + r + 2).toFixed(1)}" y="${(Y(p.y) + 3).toFixed(1)}" font-size="${isHi ? 12 : 10.5}" font-weight="${isHi ? 800 : 600}" fill="${isHi ? 'var(--accent-red)' : 'var(--text-secondary)'}">${esc(p.name.split(' ').slice(-1)[0])}</text>` : '';
        const tip = `${p.name} · ${p.pos} ${p.team}\n${mx.label}: ${mx.fmt(p.x)}\n${my.label}: ${my.fmt(p.y)}${mc ? `\n${mc.label}: ${mc.fmt(p.c)}` : ''}\nPunti/gara: ${_lcF1(p.ppg)}`;
        return `<a href="#player/${_lpState.year}/${p.pos}/${encodeURIComponent(p.name)}" data-tip="${esc(tip)}"><circle cx="${X(p.x).toFixed(1)}" cy="${Y(p.y).toFixed(1)}" r="${r}" fill="${fill}" fill-opacity="${op}" stroke="#000" stroke-width="${isHi ? 2.5 : 0.7}"/>${lbl}</a>`;
    }).join('');
    const axl = `<text x="${m.l}" y="18" text-anchor="start" font-size="13" font-weight="700" fill="var(--text-secondary)">↑ ${esc(my.label)}${my.low ? ' · better' : ''}</text><text x="${m.l + pw}" y="${H - 6}" text-anchor="end" font-size="13" font-weight="700" fill="var(--text-secondary)">${esc(mx.label)} ${mx.low ? '· better ' : ''}→</text>`;
    return `<svg viewBox="0 0 ${W} ${H}" class="lc-svg" role="img" aria-label="${esc(mx.label)} contro ${esc(my.label)}">${xTicks}${yTicks}${diag}${dots}${axl}</svg>`;
}

/** Classifica-insight compatta (lollipop orizzontale): una domanda fantasy per lista. */
function _lpLeader(title, note, items, valFmt, accent) {
    if (!items.length) return '';
    const max = Math.max(...items.map(i => Math.abs(i.v)), 1);
    const rows = items.map((it, i) => `
        <a class="lp-lead-row" href="#player/${_lpState.year}/${it.pos}/${encodeURIComponent(it.name)}">
            <span class="lp-lead-rank">${i + 1}</span>
            <span class="lp-lead-name"><b>${esc(it.name)}</b><small>${esc(it.pos)} · ${esc(it.team || '—')}</small></span>
            <span class="lp-lead-bar"><span style="width:${Math.max(4, Math.abs(it.v) / max * 100)}%;background:${accent}"></span></span>
            <span class="lp-lead-val">${valFmt(it.v)}</span>
        </a>`).join('');
    return `<div class="lp-lead"><h4 class="pp-cat-title">${esc(title)}</h4><p class="pm-note lp-lead-note">${esc(note)}</p>${rows}</div>`;
}

/** Le tre classifiche del ruolo selezionato: breakout, bust, top punti/gara. */
function lpLeaderboards(rows) {
    const drafted = rows.filter(r => r.vsProj != null && (r.projPts ?? 0) >= 40);
    const breakout = [...drafted].sort((a, b) => b.vsProj - a.vsProj).slice(0, 7).map(r => ({ ...r, v: r.vsProj }));
    const bust = [...drafted].sort((a, b) => a.vsProj - b.vsProj).slice(0, 7).map(r => ({ ...r, v: r.vsProj }));
    const scorers = rows.filter(r => r.gp >= LP_MIN_GP && r.ppg != null).sort((a, b) => b.ppg - a.ppg).slice(0, 7).map(r => ({ ...r, v: r.ppg }));
    return `
    <div class="lp-leads-grid">
        ${_lpLeader('Breakout of the season', 'Who beat their preseason projection the most.', breakout, _lcSigned, 'var(--accent-green, #3fb950)')}
        ${_lpLeader('Bust of the season', 'Who underperformed draft expectations.', bust, _lcSigned, 'var(--accent-red)')}
        ${_lpLeader('Top points/game', `Best average production (min ${LP_MIN_GP} games).`, scorers, _lcF1, 'var(--accent-blue, #4493f8)')}
    </div>`;
}

/** Tabella completa del ruolo, ordinabile, dentro un espandibile. */
function lpTable(rows) {
    const cols = [
        { k: 'ppg', l: 'PTS/g', f: _lcF1 }, { k: 'ptsLeague', l: 'Tot PTS', f: _lcF0 },
        { k: 'projPts', l: 'Proj.', f: _lcF0 }, { k: 'vsProj', l: 'vs proj', f: _lcSigned },
        { k: 'adp', l: 'ADP', f: _lcF1 }, { k: 'tgt', l: 'Tgt', f: _lcF0 },
        { k: 'tgtShare', l: 'Tgt%', f: _lcPct }, { k: 'rzTgt', l: 'RZ tgt', f: _lcF0 },
        { k: 'ptsPerTgt', l: 'PTS/tgt', f: _lcF2 },
    ];
    const sorted = [...rows].sort((a, b) => (b.ppg ?? -99) - (a.ppg ?? -99));
    const head = `<th>Player</th><th>Tm</th><th>GP</th>` + cols.map((c, i) => `<th data-sortable data-col="${i + 3}" style="cursor:pointer;text-align:center">${esc(c.l)}</th>`).join('');
    const body = sorted.map(r => `<tr>
        <td><a href="#player/${_lpState.year}/${r.pos}/${encodeURIComponent(r.name)}">${esc(r.name)}</a></td>
        <td>${esc(r.team || '—')}</td><td data-v="${r.gp}" style="text-align:center">${r.gp}</td>
        ${cols.map(c => `<td data-v="${r[c.k] == null ? -1e9 : r[c.k]}" style="text-align:center">${c.f(r[c.k])}</td>`).join('')}
    </tr>`).join('');
    return `<div class="pm-table-wrap pp-scroll" style="margin-top:10px"><table class="pm-table pp-table lp-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

/** Modulo completo dashboard giocatori. */
function leaguePlayersModule({ year, rows }) {
    if (!rows.length) return '';
    _lpState = { rows, year };
    const posBtns = LP_POS.map((p, i) => `<button class="lp-pos-btn${i === 0 ? ' active' : ''}" data-pos="${p}">${p}</button>`).join('');
    const p0 = LP_PRESETS[0];
    const metricOpts = (sel) => LP_METRICS.map(m => `<option value="${m.key}"${m.key === sel ? ' selected' : ''}>${esc(m.label)}</option>`).join('');
    const colorOpts = (sel) => '<option value="">— none —</option>' + LP_METRICS.map(m => `<option value="${m.key}"${m.key === sel ? ' selected' : ''}>${esc(m.label)}</option>`).join('');
    const presetOpts = LP_PRESETS.map((p, i) => `<option value="${i}"${i === 0 ? ' selected' : ''}>${esc(p.label)}</option>`).join('') + '<option value="custom">Custom…</option>';
    return `
    <section class="pm-block pp-block lc-module lp-module">
        <span class="mc-kicker">Player radar · season ${year}</span>
        <div class="lp-toolbar-top">
            <div class="lp-pos-tabs" role="tablist" aria-label="Position">${posBtns}</div>
            <label class="lc-field"><span>Highlight player</span><select id="lp-player"></select></label>
            <label class="lc-check"><input type="checkbox" id="lp-iso"> Isolate</label>
        </div>

        <div class="lc-hero-wrap">
            <h3 class="pp-cat-title">Actual vs Projected — who overperformed</h3>
            <div id="lp-hero" class="lc-chart-host"></div>
            <p class="pm-note">X = preseason projected points, Y = actual season points. Above the diagonal = <b>breakout</b> (overperformed), below = <b>bust</b>. Color = size of the gap. Hover for details, click a dot for the player page.</p>
        </div>

        <div id="lp-leads">${lpLeaderboards(rows.filter(r => r.pos === LP_POS[0]))}</div>

        <details class="pp-recap-ids lc-cfg-wrap" style="margin-top:14px">
            <summary>Explore · configurable scatter (free axes and color)</summary>
            <div class="lc-toolbar" style="margin-top:10px"><label class="lc-field lc-field-wide"><span>Suggested comparison</span><select id="lp-preset">${presetOpts}</select></label></div>
            <div class="lc-toolbar">
                <label class="lc-field"><span>X axis</span><select id="lp-x">${metricOpts(p0.x)}</select></label>
                <label class="lc-field"><span>Y axis</span><select id="lp-y">${metricOpts(p0.y)}</select></label>
                <label class="lc-field"><span>Color</span><select id="lp-c">${colorOpts(p0.c)}</select></label>
            </div>
            <div id="lp-cfg-legend"></div>
            <div id="lp-cfg" class="lc-chart-host"></div>
            <p class="pm-note">Each <b>suggested comparison</b> answers a fantasy question (value vs ADP, usage→production, red zone…). Axes oriented so <b>top-right = better</b>; color from red (worse) to green (better).</p>
        </details>

        <details class="pp-recap-ids" style="margin-top:18px">
            <summary>Full position table — sort by clicking the headers</summary>
            <div id="lp-table" style="margin-top:10px"></div>
            <p class="pm-note">Season totals (Sleeper) in league scoring. Tgt% = team target share; vs proj = actual − projected points. Click a name for the full page.</p>
        </details>
    </section>`;
}

/** Interazioni: filtro ruolo (ridisegna tutto), evidenzia giocatore, preset/assi/colore, isola, ordina tabella. */
function bindLeaguePlayers(container) {
    const rows = _lpState.rows || [];
    if (!rows.length) return;
    const heroHost = container.querySelector('#lp-hero'), cfgHost = container.querySelector('#lp-cfg');
    const legendHost = container.querySelector('#lp-cfg-legend'), leadsHost = container.querySelector('#lp-leads');
    const tableHost = container.querySelector('#lp-table');
    const playerSel = container.querySelector('#lp-player'), isoChk = container.querySelector('#lp-iso');
    const presetSel = container.querySelector('#lp-preset');
    const xSel = container.querySelector('#lp-x'), ySel = container.querySelector('#lp-y'), cSel = container.querySelector('#lp-c');
    if (!heroHost || !cfgHost) return;
    let pos = LP_POS[0];

    // host con slot SVG rigenerabile + tooltip persistente (stesso pattern del modulo squadre)
    const mkChart = (host) => {
        host.innerHTML = '<div class="lc-slot"></div>';
        const slot = host.querySelector('.lc-slot');
        const tip = document.createElement('div'); tip.className = 'lc-tip'; tip.hidden = true;
        host.appendChild(tip);
        host.addEventListener('mousemove', (e) => {
            const a = e.target.closest('a[data-tip]');
            if (!a) { tip.hidden = true; return; }
            const lines = a.dataset.tip.split('\n');
            tip.innerHTML = `<b>${esc(lines[0])}</b>` + lines.slice(1).map(l => `<span>${esc(l)}</span>`).join('');
            tip.hidden = false;
            const rect = host.getBoundingClientRect();
            let x = e.clientX - rect.left + 14, y = e.clientY - rect.top + 14;
            if (x + tip.offsetWidth > rect.width) x = e.clientX - rect.left - tip.offsetWidth - 10;
            if (y + tip.offsetHeight > rect.height) y = e.clientY - rect.top - tip.offsetHeight - 10;
            tip.style.left = Math.max(0, x) + 'px'; tip.style.top = Math.max(0, y) + 'px';
        });
        host.addEventListener('mouseleave', () => { tip.hidden = true; });
        return slot;
    };
    const heroSlot = mkChart(heroHost), cfgSlot = mkChart(cfgHost);
    const posRows = () => rows.filter(r => r.pos === pos);

    const fillPlayers = () => {
        const opts = ['<option value="">— none —</option>'].concat(
            posRows().sort((a, b) => (b.ppg ?? 0) - (a.ppg ?? 0)).map(r => `<option value="${esc(r.key)}">${esc(r.name)}</option>`));
        playerSel.innerHTML = opts.join('');
    };
    const common = () => ({ hiKey: playerSel.value || null, iso: isoChk.checked && !!playerSel.value });
    const drawHero = () => { heroSlot.innerHTML = _lpScatter(posRows(), { xKey: 'projPts', yKey: 'ptsLeague', cKey: 'vsProj', diag: true, ...common() }); };
    const drawCfg = () => {
        legendHost.innerHTML = _lcColorLegend(cSel.value ? _lpMetric(cSel.value) : null);
        cfgSlot.innerHTML = _lpScatter(posRows(), { xKey: xSel.value, yKey: ySel.value, cKey: cSel.value || null, ...common() });
    };
    const drawLeads = () => { leadsHost.innerHTML = lpLeaderboards(posRows()); };
    const drawTable = () => { tableHost.innerHTML = lpTable(posRows()); bindLpSort(); };

    function bindLpSort() {
        const table = tableHost.querySelector('.lp-table'); if (!table) return;
        const tbody = table.querySelector('tbody');
        table.querySelectorAll('th[data-sortable]').forEach(th => th.addEventListener('click', () => {
            const idx = +th.dataset.col, asc = th.dataset.dir !== 'asc';
            table.querySelectorAll('th').forEach(h => { if (h !== th) h.removeAttribute('data-dir'); });
            th.dataset.dir = asc ? 'asc' : 'desc';
            [...tbody.querySelectorAll('tr')].sort((a, b) => { const va = +a.children[idx].dataset.v, vb = +b.children[idx].dataset.v; return asc ? va - vb : vb - va; }).forEach(r => tbody.appendChild(r));
        }));
    }

    const redrawAll = () => { drawHero(); drawCfg(); };
    container.querySelectorAll('.lp-pos-btn').forEach(btn => btn.addEventListener('click', () => {
        pos = btn.dataset.pos;
        container.querySelectorAll('.lp-pos-btn').forEach(b => b.classList.toggle('active', b === btn));
        fillPlayers(); redrawAll(); drawLeads(); drawTable();
    }));
    playerSel.addEventListener('change', redrawAll);
    isoChk.addEventListener('change', redrawAll);
    presetSel.addEventListener('change', () => { const p = LP_PRESETS[+presetSel.value]; if (!p) return; xSel.value = p.x; ySel.value = p.y; cSel.value = p.c || ''; drawCfg(); });
    const markCustom = () => { presetSel.value = 'custom'; drawCfg(); };
    xSel.addEventListener('change', markCustom); ySel.addEventListener('change', markCustom); cSel.addEventListener('change', markCustom);

    fillPlayers(); drawHero(); drawCfg(); drawTable();
}

/** Stagione più recente con statistiche reali dei giocatori (join stats+proiezioni). */
async function pickPlayerSeason() {
    for (const y of [CURRENT_SEASON, CURRENT_SEASON - 1]) {
        const [stats, proj] = await Promise.all([
            getSeasonStats(y).catch(() => null),
            getSeasonProjections(y).catch(() => null),
        ]);
        if (stats && [...stats.values()].some(p => p.gp)) {
            const rows = buildPlayerRows(stats, proj);
            if (rows.length >= 10) return { year: y, rows };
        }
    }
    return null;
}

function render(section) {
    section.innerHTML = `
    <div class="section-inner">
        <div class="section-header">
            <h1 class="section-title">Players</h1>
            <p class="section-subtitle">Search a player (full Topina history) or an NFL team</p>
        </div>
        <div class="ps-search-wrap">
            <input type="search" id="ps-input" class="ps-search-input" placeholder="Search player or team..." autocomplete="off">
        </div>
        <div id="ps-scoreboard" class="ps-sb-wrap"></div>
        <div id="ps-divisions" class="ps-div-block"></div>
        <div id="ps-results" class="ps-results"></div>
        <div id="ps-league" class="ps-league">
            <div class="loading-state"><div class="spinner"></div><p>Caricamento dati NFL...</p></div>
        </div>
    </div>`;
}

// ─── Tabellone NFL della settimana (subito sotto la ricerca) ─────────────
// Le partite della giornata su due file, come lo scoreboard in cima a nfl.com:
// selettore settimana (solo regular season, 1-18), punteggio/orario, record,
// rete TV e squadre in bye. Una gara già cominciata porta alla pagina della
// squadra di CASA, tab Schedule, con quella partita già aperta sul box score
// e sul play-by-play (route #nfl-team/{abbr}/{anno}/game/{eventId}).

const NFL_WEEKS = 18;

/** Orario di kickoff nel fuso dell'utente: "Sun 7:20 PM". */
function sbKickoff(iso) {
    const d = iso ? new Date(iso) : null;
    if (!d || isNaN(d.getTime())) return 'TBD';
    return d.toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' });
}

function sbTeamRow(t, { showScore, dim }) {
    return `
        <div class="ps-sb-team${dim ? ' ps-sb-team--loser' : ''}">
            <img src="${teamLogoUrl(t.abbr)}" alt="" onerror="this.style.display='none'">
            <span class="ps-sb-name"><b class="ps-sb-abbr">${esc(t.abbr)}</b>${t.record ? `<span class="ps-sb-rec">${esc(t.record)}</span>` : ''}</span>
            <span class="ps-sb-score">${showScore && t.score != null ? t.score : ''}</span>
        </div>`;
}

function sbGameCard(g, year) {
    const started = g.state !== 'pre';
    // A partita finita il perdente resta in secondo piano (come su nfl.com).
    const loser = g.completed && g.home.score != null && g.home.score !== g.away.score
        ? (g.home.score > g.away.score ? 'away' : 'home') : null;
    const body = `
        <div class="ps-sb-status">${esc(started ? (g.status || 'Live') : sbKickoff(g.date))}</div>
        ${sbTeamRow(g.away, { showScore: started, dim: loser === 'away' })}
        ${sbTeamRow(g.home, { showScore: started, dim: loser === 'home' })}
        <div class="ps-sb-tv">${esc(g.tv || (started ? '' : 'TBD'))}</div>`;

    // Solo le gare cominciate o concluse hanno qualcosa da aprire.
    if (!started || !g.eventId) return `<div class="ps-sb-game is-pre">${body}</div>`;
    const cls = g.state === 'in' ? ' ps-sb-game--live' : '';
    return `<a class="ps-sb-game${cls}" href="#nfl-team/${esc(g.home.abbr)}/${year}/game/${esc(g.eventId)}"
        title="${esc(g.away.name)} at ${esc(g.home.name)} — open ${esc(g.home.name)} · Schedule">${body}</a>`;
}

function sbWeeksHtml(week) {
    const pills = Array.from({ length: NFL_WEEKS }, (_, i) => i + 1).map(w =>
        `<button type="button" class="week-pill${w === week ? ' active' : ''}" data-sb-week="${w}">${w}</button>`).join('');
    return `
        <button type="button" class="ps-sb-arrow" data-sb-step="-1" aria-label="Previous week"${week <= 1 ? ' disabled' : ''}>‹</button>
        <div class="ps-sb-pills">${pills}</div>
        <button type="button" class="ps-sb-arrow" data-sb-step="1" aria-label="Next week"${week >= NFL_WEEKS ? ' disabled' : ''}>›</button>`;
}

function sbBodyHtml(data, year) {
    if (!data?.games?.length) return '<p class="pm-empty">Scoreboard not available for this week.</p>';
    const byeHtml = data.bye?.length ? `
        <div class="ps-sb-bye"><span class="ps-sb-bye-label">Bye</span>${data.bye.map(a => `
            <a class="ps-sb-bye-team" href="#nfl-team/${esc(a)}"><img src="${teamLogoUrl(a)}" alt="" onerror="this.style.display='none'">${esc(a)}</a>`).join('')}</div>` : '';
    return `<div class="ps-sb-grid">${data.games.map(g => sbGameCard(g, year)).join('')}</div>${byeHtml}`;
}

/** Monta il tabellone e lo tiene aggiornato al cambio settimana. */
async function initWeekScoreboard(container) {
    const now = await getCurrentNflWeek();
    const year = now?.year || CURRENT_SEASON;
    let week = now?.week || 1;

    container.innerHTML = `
    <section class="pm-block pp-block ps-sb">
        <span class="mc-kicker">NFL Scoreboard · <span id="ps-sb-title">Week ${week} · ${year}</span></span>
        <div class="ps-sb-weeks" id="ps-sb-weeks">${sbWeeksHtml(week)}</div>
        <div class="ps-sb-body" id="ps-sb-body"><div class="loading-state"><div class="spinner"></div></div></div>
        <p class="pm-note">All ${year} regular season games, week by week (live from ESPN). Click a played or in-progress game to open the home team's page on that box score and play-by-play.</p>
    </section>`;

    const title = container.querySelector('#ps-sb-title');
    const weeks = container.querySelector('#ps-sb-weeks');
    const body = container.querySelector('#ps-sb-body');
    let token = 0;

    const paint = async (w) => {
        week = Math.min(Math.max(w, 1), NFL_WEEKS);
        const mine = ++token;
        title.textContent = `Week ${week} · ${year}`;
        weeks.innerHTML = sbWeeksHtml(week);
        body.innerHTML = '<div class="loading-state"><div class="spinner"></div></div>';
        const data = await getWeekGames(year, week).catch(() => null);
        if (mine !== token) return;  // l'utente ha già cambiato settimana
        body.innerHTML = sbBodyHtml(data, year);
    };

    weeks.addEventListener('click', (e) => {
        const pill = e.target.closest('[data-sb-week]');
        if (pill) return paint(+pill.dataset.sbWeek);
        const arrow = e.target.closest('[data-sb-step]');
        if (arrow) paint(week + Number(arrow.dataset.sbStep));
    });

    paint(week);
}

// ─── Division standings e quadro playoff ─────────────────────────────────
// Le 8 division in blocchetti 2×2 (AFC a sinistra, NFC a destra, ognuna del
// colore della propria conference). Chi passerebbe ai playoff oggi lo dice il
// playoffSeed ESPN, che applica già i tiebreaker ufficiali: seed 1-4 sono le
// quattro vincitrici di division (qualificazione diretta), 5-7 le wild card,
// il seed 1 salta il primo turno. I codici x/y/z/* sono quelli di NFL.com e
// arrivano dallo stesso endpoint (campo `clincher`).

// Rosso AFC e blu NFC: il blu ufficiale (#013369) su fondo scuro non si legge,
// quindi si usa la variante chiara della stessa tinta.
const CONF_COLOR = { AFC: '#D50A0A', NFC: '#3D7DCA' };
const DIV_ORDER = ['East', 'North', 'South', 'West'];
const CLINCH_TITLE = {
    x: 'Clinched Playoff', y: 'Clinched Wild Card',
    z: 'Clinched Division', '*': 'Clinched Division and Homefield Advantage',
};

/** Percentuale vittorie (pareggio = mezza vittoria), per l'ordine quando manca il seed. */
const _winPct = (e) => {
    const g = (e.wins || 0) + (e.losses || 0) + (e.ties || 0);
    return g ? ((e.wins || 0) + (e.ties || 0) * 0.5) / g : 0;
};

function divisionRow(e) {
    const seed = e.seed;
    const winner = seed != null && seed <= 4;   // vincitrice di division: entra diretta
    const wc = seed != null && seed >= 5 && seed <= 7;
    const bye = seed === 1;                     // testa di serie: primo turno di riposo
    const cls = ['ps-div-row', winner ? 'ps-div-row--winner' : '', wc ? 'ps-div-row--wc' : ''].filter(Boolean).join(' ');
    const code = (e.clincher || '').trim();
    const clinch = CLINCH_TITLE[code] ? `<span class="ps-div-clinch" title="${esc(CLINCH_TITLE[code])}">${esc(code)}</span>` : '';
    return `
        <tr class="${cls}">
            <td class="ps-div-seed">${seed != null && seed <= 7 ? seed : ''}</td>
            <td class="ps-div-team">
                <a href="#nfl-team/${esc(e.abbr)}"><img src="${teamLogoUrl(e.abbr)}" alt="" onerror="this.style.display='none'"><b>${esc(e.abbr)}</b></a>
                ${clinch}${bye ? '<span class="ps-div-bye" title="First-round bye">BYE</span>' : ''}
            </td>
            <td class="ps-div-rec">${e.wins ?? 0}-${e.losses ?? 0}${e.ties ? `-${e.ties}` : ''}</td>
            <td class="ps-div-pct">${e.winPct != null ? String(e.winPct).replace(/^0/, '') : '—'}</td>
        </tr>`;
}

function divisionsBlock({ year, value }) {
    const confs = value.map(conf => {
        const key = /american/i.test(conf.name || '') || conf.abbr === 'AFC' ? 'AFC' : 'NFC';
        // Le division non arrivano dall'endpoint: si ricavano dall'anagrafica statica.
        const divs = DIV_ORDER.map(d => ({
            label: `${key} ${d}`,
            teams: conf.entries.filter(e => NFL_TEAMS[e.abbr]?.division === `${key} ${d}`)
                // il seed ESPN incorpora già i tiebreaker: dove c'è, comanda lui
                .sort((a, b) => (a.seed ?? 99) - (b.seed ?? 99) || _winPct(b) - _winPct(a)),
        })).filter(d => d.teams.length);
        return { key, divs };
    }).filter(c => c.divs.length).sort((a, b) => a.key.localeCompare(b.key));

    if (!confs.length) return '';

    const confHtml = ({ key, divs }) => `
        <div class="ps-div-conf" style="--conf:${CONF_COLOR[key]}">
            <h4 class="ps-div-conf-title">${key}</h4>
            <div class="ps-div-grid">${divs.map(d => `
                <div class="ps-div">
                    <div class="ps-div-name">${esc(d.label)}</div>
                    <table class="ps-div-table"><tbody>${d.teams.map(divisionRow).join('')}</tbody></table>
                </div>`).join('')}</div>
        </div>`;

    return `
    <section class="pm-block pp-block">
        <span class="mc-kicker">Divisions &amp; playoff picture · ${year}</span>
        <div class="ps-div-wrap">${confs.map(confHtml).join('')}</div>
        <div class="ps-div-legend">
            <span><i class="ps-div-key ps-div-key--winner"></i>Division leader — direct berth (seeds 1-4)</span>
            <span><i class="ps-div-key ps-div-key--wc"></i>Wild card — best teams without a division (seeds 5-7)</span>
            <span><i class="ps-div-bye">BYE</i>Top seed: first-round bye</span>
        </div>
        <p class="pm-note">Seeding as it stands today (ESPN, official tiebreakers). Clinch codes as on NFL.com: <b>x</b> clinched playoff · <b>y</b> clinched wild card · <b>z</b> clinched division · <b>*</b> clinched division and homefield advantage.</p>
    </section>`;
}

/** Classifica NFL reale + power ranking FPI, sotto la ricerca. Fonte ESPN dal vivo.
 *  Le division vivono in un contenitore a parte (`divisions`): stanno subito
 *  sotto il tabellone, sopra i risultati di ricerca. */
async function loadLeaguePanel(container, divisions) {
    // In offseason la stagione corrente può essere ancora a 0-0: ripiego sulla precedente.
    async function pick(fn, isEmpty) {
        for (const y of [CURRENT_SEASON, CURRENT_SEASON - 1]) {
            const v = await fn(y).catch(() => null);
            if (v && !isEmpty(v)) return { year: y, value: v };
        }
        return null;
    }
    const [standings, rankings, news, leaders, compare, players] = await Promise.all([
        pick(getLeagueStandings, (v) => !v.length || v.every(c => c.entries.every(e => !e.wins && !e.losses))),
        pick(getLeaguePowerRankings, (v) => !v.length),
        getNews(null, 10).catch(() => []),
        pick(getLeagueLeaders, (v) => !v.length),
        pickLeagueStats().catch(() => null),
        pickPlayerSeason().catch(() => null),
    ]);

    if (!standings && !rankings && !news?.length && !leaders && !compare && !players) { container.innerHTML = ''; return; }

    // FPI ESPN (dal power ranking già caricato) per la colonna FPI del confronto.
    const fpiByAbbr = {};
    for (const r of rankings?.value || []) if (r.abbr != null) fpiByAbbr[canonAbbr(r.abbr)] = r.fpi ?? null;
    const compareHtml = compare ? leagueCompareModule(compare, fpiByAbbr) : '';
    const playersHtml = players ? leaguePlayersModule(players) : '';

    const confTable = (conf) => `
        <div class="ps-standings-conf">
            <h4 class="pp-cat-title">${esc(conf.name)}</h4>
            <div class="pm-table-wrap pp-scroll">
                <table class="pm-table pp-table">
                    <thead><tr><th>#</th><th>Team</th><th>W-L${conf.entries.some(e => e.ties) ? '-T' : ''}</th><th>%</th><th>PF</th><th>PS</th><th>Diff</th><th>Streak</th></tr></thead>
                    <tbody>${conf.entries.map(e => `
                        <tr>
                            <td>${e.seed ?? '—'}</td>
                            <td><a class="ps-inline-team" href="#nfl-team/${e.abbr}"><img src="${teamLogoUrl(e.abbr)}" alt="" onerror="this.style.display='none'"> ${esc(e.abbr)}</a></td>
                            <td class="pm-td-strong">${e.wins ?? 0}-${e.losses ?? 0}${e.ties ? `-${e.ties}` : ''}</td>
                            <td>${e.winPct ?? '—'}</td>
                            <td>${e.pf ?? '—'}</td><td>${e.pa ?? '—'}</td>
                            <td>${e.diff ?? '—'}</td>
                            <td>${e.streak ?? '—'}</td>
                        </tr>`).join('')}</tbody>
                </table>
            </div>
        </div>`;

    if (divisions) divisions.innerHTML = standings ? divisionsBlock(standings) : '';
    const standingsHtml = standings ? `
        <section class="pm-block pp-block">
            <span class="mc-kicker">NFL Standings · ${standings.year}</span>
            <div class="ps-standings-grid">${standings.value.map(confTable).join('')}</div>
            <p class="pm-note">Playoff seed, record, points scored/allowed and streak — live from ESPN. Click an abbreviation for the team page.</p>
        </section>` : '';

    const rk = rankings?.value || [];
    const rankHtml = rankings ? `
        <section class="pm-block pp-block">
            <span class="mc-kicker">Power Ranking · FPI ${rankings.year}</span>
            <div class="ps-rank-grid">${rk.slice(0, 12).map(r => `
                <a class="ps-rank-row" href="#nfl-team/${r.abbr}">
                    <span class="ps-rank-n">${r.rank ?? '—'}</span>
                    <img class="ps-rank-logo" src="${teamLogoUrl(r.abbr)}" alt="" onerror="this.style.display='none'">
                    <span class="ps-rank-abbr">${esc(r.abbr)}</span>
                    <span class="ps-rank-fpi">${r.fpi != null ? (r.fpi > 0 ? '+' : '') + (+r.fpi).toFixed(1) : '—'}</span>
                </a>`).join('')}</div>
            ${rk.length > 12 ? `<details class="pp-recap-ids" style="margin-top:8px"><summary>Full ranking (32)</summary>
                <div class="ps-rank-grid" style="margin-top:8px">${rk.slice(12).map(r => `
                    <a class="ps-rank-row" href="#nfl-team/${r.abbr}"><span class="ps-rank-n">${r.rank ?? '—'}</span><img class="ps-rank-logo" src="${teamLogoUrl(r.abbr)}" alt="" onerror="this.style.display='none'"><span class="ps-rank-abbr">${esc(r.abbr)}</span><span class="ps-rank-fpi">${r.fpi != null ? (r.fpi > 0 ? '+' : '') + (+r.fpi).toFixed(1) : '—'}</span></a>`).join('')}</div></details>` : ''}
            <p class="pm-note">ESPN Football Power Index: net team strength (expected point margin vs an average opponent).</p>
        </section>` : '';

    const newsHtml = news?.length ? `
        <section class="pm-block pp-block">
            <span class="mc-kicker">Latest NFL news · ESPN</span>
            <ul class="pp-news-list">${news.slice(0, 10).map(n => `
                <li>${n.link ? `<a href="${esc(n.link)}" target="_blank" rel="noopener">${esc(n.headline)}</a>` : esc(n.headline)}${n.published ? ` <span class="pm-note">· ${new Date(n.published).toLocaleDateString('en-US')}</span>` : ''}</li>`).join('')}</ul>
        </section>` : '';

    const leadHtml = leaders ? `
        <section class="pm-block pp-block">
            <span class="mc-kicker">League leaders · ${leaders.year}</span>
            <div class="ps-leaders-grid">${leaders.value.map(c => `
                <div class="ps-leader-cat">
                    <h4 class="pp-cat-title">${esc(c.label)}</h4>
                    ${c.rows.map(r => `
                        <div class="ps-leader-row">
                            <span class="ps-leader-rank">${r.rank}</span>
                            <span class="ps-leader-name">${esc(r.name)}${r.team ? ` <a class="ps-leader-team" href="#nfl-team/${r.team}">${esc(r.team)}</a>` : ''}</span>
                            <span class="ps-leader-val">${esc(String(r.value ?? '—'))}</span>
                        </div>`).join('')}
                </div>`).join('')}</div>
            <p class="pm-note">Top 5 NFL by category (regular season) — ESPN.</p>
        </section>` : '';

    container.innerHTML = `<h3 class="pp-cat-title ps-league-title">NFL · League</h3>${playersHtml}${compareHtml}${standingsHtml}${rankHtml}${leadHtml}${newsHtml}`;
    bindLeaguePlayers(container);
    bindLeagueCompare(container);
}

export async function initPlayersSearch() {
    const section = document.getElementById('players');
    if (!section) return;
    render(section);

    const input = section.querySelector('#ps-input');
    const results = section.querySelector('#ps-results');
    const league = section.querySelector('#ps-league');
    const scoreboard = section.querySelector('#ps-scoreboard');
    const divisions = section.querySelector('#ps-divisions');
    if (scoreboard) initWeekScoreboard(scoreboard); // non blocca la ricerca
    if (league) loadLeaguePanel(league, divisions); // non blocca la ricerca

    const teamsGroup = (teams) => teams.length ? `<div class="ps-group"><h3 class="pp-cat-title">NFL Teams</h3>${teams.map(resultRow).join('')}</div>` : '';
    const playersGroup = (players) => players.length ? `<div class="ps-group"><h3 class="pp-cat-title">Players</h3>${players.map(resultRow).join('')}</div>` : '';

    input.addEventListener('input', async () => {
        const q = input.value.trim();
        // tabellone, division e pannello lega lasciano spazio ai risultati durante la ricerca
        if (scoreboard) scoreboard.hidden = q.length >= 2;
        if (divisions) divisions.hidden = q.length >= 2;
        if (league) league.hidden = q.length >= 2;
        if (q.length < 2) { results.innerHTML = q.length ? '<p class="pm-empty">Type at least 2 characters.</p>' : ''; return; }

        // Le squadre sono un lookup statico: si mostrano subito, senza aspettare
        // il fetch dell'indice giocatori (buildCareers legge tutte le stagioni da Firebase).
        const teams = teamResults(q);
        results.innerHTML = teamsGroup(teams) || '<p class="pm-empty">Searching players...</p>';

        const index = await buildPlayerIndex();
        if (input.value.trim() !== q) return; // l'utente ha già scritto altro
        const players = playerResults(q, index);

        if (!teams.length && !players.length) { results.innerHTML = '<p class="pm-empty">No results.</p>'; return; }
        results.innerHTML = `${teamsGroup(teams)}${playersGroup(players)}`;
    });
}
