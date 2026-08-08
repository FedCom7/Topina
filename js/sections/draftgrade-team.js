/**
 * Draft Grade — analisi approfondita del draft di UNA squadra.
 * Route: #draftgrades/{year}/{teamKey} (aperta cliccando una card in Draft Grades).
 *
 * Tutto col senno del giorno del draft: proiezioni preseason Sleeper/Rotowire
 * nello scoring della lega, ADP per reach/steal, statistiche REALI della
 * stagione precedente (endpoint stats Sleeper) per il pregresso di ogni pick,
 * anagrafica rookie/veterani da rookie_year. Le alternative "cosa si poteva
 * fare meglio" confrontano solo con giocatori draftati DOPO quella pick.
 * Se la stagione è già stata giocata, chiude "Il verdetto del campo":
 * proiettato vs reale e corsa settimanale dei top pick.
 *
 * Come game.js: nessun guard `initialized`, si ri-parsa l'hash a ogni chiamata.
 */

import { fetchDraftData, flattenDraft, fetchFantasyData, getSeasonConfig, displayName } from '../data.js?v=33';
import { TEAM_KEYS } from '../data/team-config.js?v=33';
import { TEAMS } from './team.js?v=44';
import { getHonorsBundle } from '../data/honors.js?v=29';
import { getSeasonProjections, getSeasonStats, matchProjection } from '../data/projections.js?v=31';
import { getHistoryIndex, trendBadge, historyLine, peakNote } from '../data/player-history.js?v=27';
import { initPlayerModal } from '../components/player-modal.js?v=45';
import { playerImageService } from '../services/player-image-service.js?v=15';
import { pickSeeded } from '../data/magazine-voices.js?v=17';
import {
    computeGrades, makeEvaluator, letterFor, gradeBand, strategyLine,
    GRADE_COMMENTS, outcomeBadge, computeVorGrades,
} from './draftgrades.js?v=46';
import { getContextScore, getDraftModel } from '../data/context-score.js?v=20';
import { evaluateLeague, TSI_WEIGHTS, TSI_LABELS } from '../data/team-eval.js?v=19';

const fmt0 = (n) => Math.round(n).toLocaleString('it-IT');
const fmt1 = (n) => (+n).toLocaleString('it-IT', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

// ─── Verdetti pick (varianti seeded) ─────────────────────────────

const PICK_VERDICTS = {
    colpo: [
        (c) => `Colpo pieno: a questo slot ${c.player} era il massimo che il board potesse offrire.`,
        (c) => `Qui la war-room ha visto giusto: ${c.player} vale ogni centesimo della pick #${c.pick}.`,
        (c) => `Scelta chirurgica: ${c.player} preso esattamente dove andava preso.`,
    ],
    solido: [
        (c) => `Scelta solida, in linea col valore dello slot: nessun rimpianto per ${c.player}.`,
        (c) => `${c.player} è la pick da manuale: né reach né miracolo, compitino svolto.`,
        (c) => `Onesta amministrazione: ${c.player} rende lo slot quello che promette.`,
    ],
    rivedibile: [
        (c) => `Rivedibile: con ${c.alt} ancora sul board, ${c.player} è una scelta che fa discutere.`,
        (c) => `Il board offriva di più: ${c.alt} era lì e proiettava meglio di ${c.player}.`,
        (c) => `Pick sotto la pari: ${c.player} lascia punti sul tavolo rispetto a chi era ancora disponibile.`,
    ],
    reach: [
        (c) => `Reach dichiarato: il mercato prendeva ${c.player} circa ${c.adpGap} pick più tardi.`,
        (c) => `Anticipo azzardato su ${c.player}: l'ADP diceva di aspettare, la war-room no.`,
        (c) => `Scommessa di cuore: ${c.player} preso ben prima del suo prezzo di mercato.`,
    ],
};

const AGE_NOTES = {
    young: [
        (t) => `Draft di prospettiva per ${t}: tanta gioventù, il meglio deve ancora venire.`,
        (t) => `${t} ha puntato sul futuro: un nucleo giovane che può solo crescere.`,
    ],
    balanced: [
        (t) => `Mix equilibrato per ${t}: gioventù dove serve, esperienza dove conta.`,
        (t) => `${t} ha bilanciato bene il registro anagrafico del roster.`,
    ],
    veteran: [
        (t) => `Roster win-now per ${t}: si punta tutto sull'usato sicuro, ma l'età non perdona.`,
        (t) => `${t} ha scelto l'esperienza: rendimento immediato, con la scadenza sull'etichetta.`,
    ],
};

// ─── Init ────────────────────────────────────────────────────────

export async function initDraftGradeTeam() {
    const section = document.getElementById('draftgrade-team');
    if (!section) return;
    const [, year, teamKey] = location.hash.slice(1).split('/');
    const team = TEAMS[teamKey];
    if (!team || !year) {
        section.innerHTML = `<div class="section-inner"><div class="empty-state"><p class="empty-state-text">Team or year not found</p></div></div>`;
        return;
    }

    section.innerHTML = `<div class="section-inner"><div class="loading-state"><div class="spinner"></div><p>Opening the ${year} draft file...</p></div></div>`;

    initPlayerModal();

    try {
        const [draftData, proj, prevStats, histIndex, bundle] = await Promise.all([
            fetchDraftData(year),
            getSeasonProjections(year),
            getSeasonStats(String(+year - 1)).catch(() => new Map()),
            getHistoryIndex(year).catch(() => null), // riusa la cache di getSeasonStats(year-1)
            getHonorsBundle(year).catch(() => null),
        ]);
        if (!location.hash.includes(`draftgrades/${year}/${teamKey}`)) return; // anti-race

        const picks = flattenDraft(draftData);
        const actualPlayers = bundle?.players || {};
        const seasonPlayed = Object.keys(actualPlayers).length > 0;

        const evaluator = makeEvaluator(proj, histIndex, year);
        const meta = { mode: 'proj', proj, seasonPlayed, actualPlayers, detailOf: evaluator.detailOf };
        const grades = computeGrades(picks, evaluator.valueOf, meta);
        const rank = grades.findIndex(g => g.key === teamKey);
        const g = grades[rank];
        if (!g) throw new Error(`nessuna pick per ${teamKey} nel ${year}`);

        // pool completo valutato, per le alternative "draftate dopo"
        const evaluated = grades.flatMap(x => x.list);
        g.list.forEach(p => { p.alt = bestAlternative(p, evaluated); });

        // Player Context Score (SOS+) da nflverse: profilo roster + accuratezza.
        // Si attacca p.ctx a TUTTE le squadre (non solo questa) così il Team
        // Strength Index qui combacia con quello della lista Draft Grades.
        // Degradazione graceful: se i dati mancano, sos resta null e la card sparisce.
        const sosByTeam = await Promise.all(grades.map(x =>
            attachTeamContext(x, year).catch(() => ({ model: null, sosAvg: null, subAvg: {} }))));
        const sos = sosByTeam[rank];
        // Team Strength Index (motore di valutazione della rosa) — non tocca il voto.
        await evaluateLeague(grades, year).catch(e => console.warn('[team-eval]', e));
        // Voto di fine stagione (VOR) — solo stagioni giocate.
        const vor = seasonPlayed ? computeVorGrades(picks, meta) : null;

        const weekly = seasonPlayed
            ? await buildWeeklySeries(year, g.list).catch(() => null) : null;
        if (!location.hash.includes(`draftgrades/${year}/${teamKey}`)) return;

        render(section, { year, team, g, rank, grades, meta, prevStats, weekly, seasonPlayed, sos, vor });
    } catch (e) {
        console.error('[draftgrade-team]', e);
        section.innerHTML = `<div class="section-inner"><div class="empty-state"><p class="empty-state-text">Error loading the analysis</p></div></div>`;
    }
}

/**
 * Miglior giocatore di PARI RUOLO (per proiezione) draftato DOPO questa pick
 * da un'ALTRA squadra: chi hai comunque preso più tardi non è un rimpianto,
 * e il confronto nello stesso reparto evita che "c'era ancora il QB X" si
 * ripeta identico su ogni pick.
 */
function bestAlternative(p, evaluated) {
    let best = null;
    for (const q of evaluated) {
        if (q.pick <= p.pick || q.team === p.team || q.pos !== p.pos) continue;
        if (!best || q.value > best.value) best = q;
    }
    return best;
}

// ─── Serie settimanali (dai dati Firebase) ───────────────────────

async function buildWeeklySeries(year, teamPicks) {
    const data = await fetchFantasyData(year);
    const cfg = getSeasonConfig(year);
    const wanted = new Set(teamPicks.map(p => p.player));
    const series = {}; // name → [{wk, pts}]
    for (let w = 1; w <= cfg.regularSeasonWeeks; w++) {
        const wk = data?.weeks?.[w];
        (wk?.matchups || []).forEach(m => [m.team1, m.team2].forEach(t => {
            if (!t) return;
            [...(t.starters || []), ...(t.bench || [])].forEach(pl => {
                if (!wanted.has(pl.name)) return;
                (series[pl.name] = series[pl.name] || []).push({ wk: w, pts: parseFloat(pl.fantasy_points) || 0 });
            });
        }));
    }
    return series;
}

// ─── Player Context Score (SOS+) ─────────────────────────────────

const SOS_DIMS = ['teamOffense', 'volume', 'efficiency', 'schedule', 'playoff', 'trend', 'ageCurve', 'durability'];
const SOS_LABELS = {
    teamOffense: 'NFL Offense', volume: 'Volume', efficiency: 'Efficiency', schedule: 'Schedule',
    playoff: 'Playoff schedule', trend: 'Career trend', ageCurve: 'Age curve', durability: 'Durability',
};

/** Attacca p.ctx a ogni pick d'attacco e calcola gli aggregati del roster. */
async function attachTeamContext(g, year) {
    const model = await getDraftModel();
    const OFF = new Set(['QB', 'RB', 'WR', 'TE']);
    await Promise.all(g.list.map(async p => {
        if (!OFF.has(p.pos)) return;
        try { p.ctx = await getContextScore({ name: p.player, pos: p.pos, team: p.nfl, year: +year, projValue: p.value }); }
        catch { p.ctx = null; }
    }));
    const withCtx = g.list.filter(p => p.ctx?.contextScore != null);
    const sosAvg = withCtx.length ? Math.round(withCtx.reduce((s, p) => s + p.ctx.contextScore, 0) / withCtx.length) : null;
    const subAvg = {};
    for (const d of SOS_DIMS) {
        const vals = withCtx.map(p => p.ctx.subScores?.[d]).filter(v => v != null);
        subAvg[d] = vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
    }
    return { model, sosAvg, subAvg };
}

/** Card SOS+: profilo del roster (media sub-score attacco) + rischi flop. */
function sosCard(ctx) {
    const { sos, g } = ctx;
    if (!sos || sos.sosAvg == null) return '';
    const bars = SOS_DIMS.map(k => {
        const v = sos.subAvg[k];
        if (v == null) return `
        <div class="dgt-sos-bar dgt-sos-bar--na">
            <span class="dgt-sos-label">${SOS_LABELS[k]}</span>
            <span class="dgt-sos-track"></span><span class="dgt-sos-val">n/d</span>
        </div>`;
        const cls = v >= 66 ? ' up' : v <= 40 ? ' down' : '';
        return `
        <div class="dgt-sos-bar${cls}">
            <span class="dgt-sos-label">${SOS_LABELS[k]}</span>
            <span class="dgt-sos-track"><span style="width:${v}%"></span></span>
            <span class="dgt-sos-val">${v}</span>
        </div>`;
    }).join('');

    const off = g.list.filter(p => p.ctx?.contextScore != null);
    const top = [...off].sort((a, b) => b.ctx.contextScore - a.ctx.contextScore)[0];
    const flopRisk = off.filter(p => p.ctx.bustProb != null && p.ctx.bustProb >= 0.4)
        .sort((a, b) => b.ctx.bustProb - a.ctx.bustProb);
    const notes = `
        <div class="dgt-sos-notes">
            ${top ? `<span class="dgt-chip dgt-chip--up">Best profile: ${top.player} · SOS+ ${top.ctx.contextScore}</span>` : ''}
            ${flopRisk.map(p => `<span class="dgt-chip dgt-chip--down">Flop risk: ${p.player} · ${Math.round(p.ctx.bustProb * 100)}%</span>`).join('')}
        </div>`;

    return `
    <div class="mosaic-card mc-wide dgt-card mc-in">
        <span class="mc-kicker">Context beyond the projections · advanced NFL data (nflverse)</span>
        <h2 class="mc-title">Player Context Score <small class="dgt-sos-big">avg SOS+ ${sos.sosAvg}</small></h2>
        <p class="dgt-card-sub">Average offense profile across 8 dimensions (0-100, previous year's percentiles): players' NFL offense quality, expected volume, efficiency, schedule difficulty by position, playoff-week schedule, trend, age curve and durability. Fixed reference weights; the model confirms the value projections and adds flop probability.</p>
        <div class="dgt-sos-bars">${bars}</div>
        ${notes}
    </div>`;
}

// ─── Team Strength Index (valutazione della rosa) ────────────────

/**
 * Card Team Strength: il TSI (0-100) e le sue componenti. Valuta la ROSA
 * (titolari, profondità, bilanciamento, scarsità, rischio, bye, stack,
 * contesto), non la somma delle pick. Indice di lettura, pesi di design.
 */
function teamStrengthCard(ctx) {
    const { g } = ctx;
    if (g.tsi == null) return '';
    const order = Object.keys(TSI_WEIGHTS).sort((a, b) => TSI_WEIGHTS[b] - TSI_WEIGHTS[a]);
    const bars = order.map(k => {
        const v = g.tsiSub?.[k];
        if (v == null) return `
        <div class="dgt-sos-bar dgt-sos-bar--na">
            <span class="dgt-sos-label">${TSI_LABELS[k]} <em>${Math.round(TSI_WEIGHTS[k] * 100)}%</em></span>
            <span class="dgt-sos-track"></span><span class="dgt-sos-val">n/d</span>
        </div>`;
        const cls = v >= 60 ? ' up' : v <= 40 ? ' down' : '';
        return `
        <div class="dgt-sos-bar${cls}">
            <span class="dgt-sos-label">${TSI_LABELS[k]} <em>${Math.round(TSI_WEIGHTS[k] * 100)}%</em></span>
            <span class="dgt-sos-track"><span style="width:${v}%"></span></span>
            <span class="dgt-sos-val">${v}</span>
        </div>`;
    }).join('');

    const riskLevel = g.tsiRisk >= 60 ? 'high' : g.tsiRisk >= 40 ? 'medium' : 'low';
    const notes = `
        <div class="dgt-sos-notes">
            <span class="dgt-chip">Starters: ${fmt0(g.starterValue)} projected pt</span>
            <span class="dgt-chip dgt-chip--${g.tsiRisk >= 55 ? 'down' : 'up'}">Roster risk: ${riskLevel} (${g.tsiRisk}/100)</span>
            ${g.tsiSub?.balance != null && g.tsiSub.balance <= 45 ? `<span class="dgt-chip dgt-chip--down">Unbalanced construction</span>` : ''}
            ${g.tsiSub?.stack != null && g.tsiSub.stack >= 70 ? `<span class="dgt-chip dgt-chip--up">QB-receiver stack</span>` : ''}
            ${g.byesKnown === false ? `<span class="dgt-chip">Bye weeks not available</span>` : ''}
        </div>`;

    return `
    <div class="mosaic-card mc-wide dgt-card mc-in">
        <span class="mc-kicker">How strong is the roster · roster evaluation</span>
        <h2 class="mc-title">Team Strength Index <small class="dgt-sos-big dgt-tsi-big">TSI ${g.tsi}${g.tsiRank ? ` · ${g.tsiRank}${g.tsiRank === 1 ? 'st' : g.tsiRank === 2 ? 'nd' : g.tsiRank === 3 ? 'rd' : 'th'} in league` : ''}</small></h2>
        <p class="dgt-card-sub">A 0-100 index that evaluates the <b>roster</b>, not the sum of picks: starter strength, slot-by-slot positional advantage, scarcity (value above the 4-team league replacement level), bench depth, risk, balance, bye optimization, stacking and NFL offensive context. It's a read-only index (design weights, 50 ≈ league average) shown alongside the official grade, which <b>does not</b> change.</p>
        <div class="dgt-sos-bars">${bars}</div>
        ${notes}
    </div>`;
}

// ─── Classificazione pick e testi ────────────────────────────────

function classifyPick(p) {
    if (p.adp && (p.adp - p.pick) > 8) return 'reach';
    const ratio = p.expected ? p.value / p.expected : 1;
    if (!p.alt || p.value >= p.alt.value) return 'colpo';
    if (ratio >= 0.92 && p.alt.value <= p.value * 1.12) return 'solido';
    if (p.alt.value > p.value * 1.25) return 'rivedibile';
    return 'solido';
}

function priorLine(p, prevStats, prevYear, expAtDraft) {
    const s = matchProjection(prevStats, p.player, p.pos);
    if (!s) {
        return expAtDraft === 0
            ? `Rookie — no prior NFL season: pure projection`
            : `${prevYear}: no season data`;
    }
    const pts = s.ptsHalf ?? s.ptsStd;
    const bits = [`${fmt0(pts)} pt half-PPR`];
    if (s.posRank) bits.push(`${p.pos}${s.posRank}`);
    if (p.pos === 'QB' && s.passYd) bits.push(`${fmt0(s.passYd)} pass yd and ${fmt0(s.passTd || 0)} pass TD`);
    else if (p.pos === 'RB' && s.rushYd != null) bits.push(`${fmt0(s.rushYd)} rush yd${s.rec ? ` + ${fmt0(s.rec)} rec` : ''}`);
    else if ((p.pos === 'WR' || p.pos === 'TE') && s.rec != null) bits.push(`${fmt0(s.rec)} rec${s.tgt ? ` on ${fmt0(s.tgt)} targets` : ''}${s.recYd ? `, ${fmt0(s.recYd)} yd` : ''}`);
    else if (p.pos === 'K' && s.fgm != null) bits.push(`${fmt0(s.fgm)} FG + ${fmt0(s.xpm || 0)} XP`);
    else if (p.pos === 'DEF' && s.sacks != null) bits.push(`${fmt0(s.sacks)} sacks, ${fmt0(s.defInt || 0)} INT`);
    if (s.gp) bits.push(`${fmt0(s.gp)} games`);
    return `${prevYear}: ${bits.join(' · ')}`;
}

// ─── Rendering ───────────────────────────────────────────────────

function render(section, ctx) {
    const { year, team, g, rank, meta, prevStats, weekly, seasonPlayed } = ctx;
    const letter = letterFor(g.ratio, rank);
    const band = gradeBand(letter);
    const seed = (+year) * 13 + team.key.length;
    const prevYear = String(+year - 1);

    const comment = pickSeeded(GRADE_COMMENTS[band], seed + 3)({
        team: team.name,
        best: g.best ? g.best.player : 'nessuno',
        worst: g.worst ? g.worst.player : 'nessuno',
    });

    section.innerHTML = `
    <div class="section-inner gb-page dgt-page" style="--team-color:${team.color};--card-glow:${team.color}">
        <a class="gb-back" href="#draftgrades"><span aria-hidden="true">←</span> Draft Grades</a>

        <header class="mosaic-card mc-wide dgt-hero mc-in">
            <img class="dgt-hero-logo" src="${team.logo}" alt="${team.name}" onerror="this.style.display='none'">
            <div class="dgt-hero-info">
                <span class="mc-kicker">${year} Draft · Full analysis</span>
                <h1 class="mc-title">${team.name}</h1>
                <span class="dg-head-meta">${fmt0(g.total)} projected pt · expected ${fmt0(g.expected)} · yield ${(g.ratio * 100).toFixed(0)}% · ${rank + 1}${rank + 1 === 1 ? 'st' : rank + 1 === 2 ? 'nd' : rank + 1 === 3 ? 'rd' : 'th'} draft in the league</span>
                <p class="dgt-hero-strategy">${strategyLine(g.list)}</p>
                <p class="dg-comment">${comment}</p>
            </div>
            <span class="dg-letter dg-letter--big dg-letter--${band}">${letter}</span>
        </header>

        ${curveCard(g, team)}
        ${teamStrengthCard(ctx)}
        ${sosCard(ctx)}
        ${rosterCard(ctx)}
        ${picksSection(ctx, prevYear)}
        ${seasonPlayed ? verdictSection(ctx) : ''}

        <p class="dg-footnote">Analysis based on ${year} preseason projections and real career stats (up to 6 seasons, Rotowire/Sleeper) converted into the league's scoring${g.list.some(p => p.adp) ? ', half-PPR ADP for reach and steal' : ' (ADP not available for this year)'}. For kicker and defense the value also weighs recent real production (60% and 35%, weights calibrated on the 419 picks from 2019-2025); for offense the projections have proven more reliable than any historical metric, and history feeds trend and risk signals. Alternatives calculated only among players drafted after each pick.</p>
    </div>`;

    bindCurve(section.querySelector('#dgt-curve'));
    loadHeadshots(section, seasonPlayed ? year : prevYear);
}

// ─── Card: la curva del draft ────────────────────────────────────

const CV = { w: 860, h: 320, l: 52, r: 16, t: 18, b: 34 };

function niceTicks(min, max, count = 4) {
    const span = max - min || 1;
    const step = Math.pow(10, Math.floor(Math.log10(span / count)));
    const err = span / count / step;
    const mult = err >= 7.5 ? 10 : err >= 3.5 ? 5 : err >= 1.5 ? 2 : 1;
    const s = mult * step;
    const lo = Math.floor(min / s) * s;
    const hi = Math.ceil(max / s) * s;
    const ticks = [];
    for (let v = lo; v <= hi + 1e-9; v += s) ticks.push(v);
    return ticks;
}

function curveCard(g, team) {
    const rounds = g.list.map(p => ({
        round: p.round, pick: p.pick,
        taken: { name: p.player, pos: p.pos, pts: p.value },
        alt: p.alt ? { name: p.alt.player, pos: p.alt.pos, pts: p.alt.value } : null,
    }));
    const leftOnBoard = g.list.reduce((s, p) => s + Math.max(0, (p.alt?.value ?? 0) - p.value), 0);

    const allPts = rounds.flatMap(r => [r.taken.pts, r.alt?.pts ?? 0]);
    const ticks = niceTicks(0, Math.max(...allPts, 1));
    const yMax = ticks[ticks.length - 1];
    const plotW = CV.w - CV.l - CV.r;
    const plotH = CV.h - CV.t - CV.b;
    const x = (i) => CV.l + (rounds.length > 1 ? (i / (rounds.length - 1)) * plotW : plotW / 2);
    const y = (v) => CV.t + (1 - v / yMax) * plotH;

    const grid = ticks.map(v => `
        <line x1="${CV.l}" y1="${y(v)}" x2="${CV.l + plotW}" y2="${y(v)}" class="an-gridline"/>
        <text x="${CV.l - 8}" y="${y(v) + 3}" class="an-tick" text-anchor="end">${fmt0(v)}</text>`).join('');
    const xTicks = rounds.map((r, i) =>
        `<text x="${x(i)}" y="${CV.h - 8}" class="an-tick" text-anchor="middle">R${r.round}</text>`).join('');

    // area del valore lasciato sul tavolo (tra scelta e alternativa, dove alt > scelta)
    const areaTop = rounds.map((r, i) => `${x(i).toFixed(1)},${y(Math.max(r.alt?.pts ?? 0, r.taken.pts)).toFixed(1)}`);
    const areaBot = [...rounds].reverse().map((r, i) => `${x(rounds.length - 1 - i).toFixed(1)},${y(r.taken.pts).toFixed(1)}`);
    const area = `<polygon points="${[...areaTop, ...areaBot].join(' ')}" class="dgt-gap-area"/>`;

    const altLine = `<polyline points="${rounds.map((r, i) => `${x(i).toFixed(1)},${y(r.alt?.pts ?? 0).toFixed(1)}`).join(' ')}"
        fill="none" class="dgt-alt-line"/>`;
    const takenLine = `<polyline points="${rounds.map((r, i) => `${x(i).toFixed(1)},${y(r.taken.pts).toFixed(1)}`).join(' ')}"
        fill="none" stroke="${team.color}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>`;
    const dots = rounds.map((r, i) => {
        const steal = !r.alt || r.taken.pts >= r.alt.pts;
        return `<circle cx="${x(i)}" cy="${y(r.taken.pts)}" r="4.5" fill="${team.color}"
            stroke="${steal ? 'var(--accent-green, #30d158)' : '#000'}" stroke-width="2"/>`;
    }).join('');

    const dataAttr = JSON.stringify(rounds).replace(/'/g, '&#39;');

    return `
    <div class="mosaic-card mc-wide dgt-card mc-in" id="dgt-curve">
        <span class="mc-kicker">Round by round</span>
        <h2 class="mc-title">The draft curve</h2>
        <p class="dgt-card-sub">The colored line is who was picked; the dashed one is the best player of the same position still on the board (later drafted by another team). The area is the value left on the table: <b>${fmt0(leftOnBoard)} projected pt</b>.</p>
        <div class="dgt-chart-wrap">
            <svg viewBox="0 0 ${CV.w} ${CV.h}" class="an-svg" data-rounds='${dataAttr}'>
                ${grid}${xTicks}${area}${altLine}${takenLine}${dots}
                <line class="an-crosshair" x1="0" y1="${CV.t}" x2="0" y2="${CV.t + plotH}" visibility="hidden"/>
                <rect class="an-hit" x="${CV.l}" y="${CV.t}" width="${plotW}" height="${plotH}" fill="transparent"/>
            </svg>
            <div class="an-chart-tooltip" hidden></div>
        </div>
    </div>`;
}

function bindCurve(container) {
    if (!container) return;
    const svg = container.querySelector('svg');
    const tooltip = container.querySelector('.an-chart-tooltip');
    const crosshair = svg.querySelector('.an-crosshair');
    const hit = svg.querySelector('.an-hit');
    const rounds = JSON.parse(svg.dataset.rounds);
    const plotW = CV.w - CV.l - CV.r;
    const xFor = (i) => CV.l + (rounds.length > 1 ? (i / (rounds.length - 1)) * plotW : plotW / 2);

    hit.addEventListener('pointermove', (e) => {
        const rect = svg.getBoundingClientRect();
        const px = (e.clientX - rect.left) * (CV.w / rect.width);
        let idx = 0, best = Infinity;
        rounds.forEach((_, i) => {
            const d = Math.abs(xFor(i) - px);
            if (d < best) { best = d; idx = i; }
        });
        const r = rounds[idx];
        crosshair.setAttribute('x1', xFor(idx));
        crosshair.setAttribute('x2', xFor(idx));
        crosshair.setAttribute('visibility', 'visible');

        tooltip.replaceChildren();
        const title = document.createElement('div');
        title.className = 'an-tt-title';
        title.textContent = `Round ${r.round} · pick #${r.pick}`;
        tooltip.appendChild(title);
        const mk = (label, who) => {
            const row = document.createElement('div');
            row.className = 'an-tt-row';
            const val = document.createElement('b');
            val.textContent = fmt0(who.pts);
            const name = document.createElement('span');
            name.className = 'an-tt-name';
            name.textContent = `${label}: ${who.name} (${who.pos})`;
            row.append(val, name);
            tooltip.appendChild(row);
        };
        mk('Picked', r.taken);
        if (r.alt) mk('On the board', r.alt);
        tooltip.hidden = false;

        const crect = container.getBoundingClientRect();
        let tx = e.clientX - crect.left + 14;
        const tw = tooltip.offsetWidth || 160;
        if (tx + tw > crect.width - 4) tx = e.clientX - crect.left - tw - 14;
        tooltip.style.left = `${tx}px`;
        tooltip.style.top = `${e.clientY - crect.top - 10}px`;
    });
    hit.addEventListener('pointerleave', () => {
        crosshair.setAttribute('visibility', 'hidden');
        tooltip.hidden = true;
    });
}

// ─── Card: costruzione del roster ────────────────────────────────

function rosterCard(ctx) {
    const { year, team, g, meta, seasonPlayed } = ctx;

    const bars = g.byPos.map(({ pos, val, deltaPct, n }) => {
        const cls = deltaPct >= 15 ? ' dg-bar--strong' : deltaPct <= -15 ? ' dg-bar--weak' : '';
        const w = Math.max(4, Math.min(100, 50 + deltaPct / 2));
        return `
        <div class="dg-bar${cls}">
            <span class="dg-bar-pos">${pos}</span>
            <span class="dg-bar-track"><span style="width:${w}%"></span></span>
            <span class="dg-bar-val">${fmt0(val)} pt <small>(${n})</small></span>
            <span class="dg-bar-delta">${deltaPct >= 0 ? '+' : ''}${Math.round(deltaPct)}%</span>
        </div>`;
    }).join('');

    // profilo anagrafico da rookie_year (stabile nel tempo, a differenza di years_exp)
    let rookies = 0, young = 0, prime = 0, vets = 0, known = 0;
    g.list.forEach(p => {
        const hit = matchProjection(meta.proj, p.player, p.pos);
        if (p.pos === 'DEF' || hit?.rookieYear == null) return;
        const exp = +year - hit.rookieYear;
        known++;
        if (exp <= 0) rookies++;
        else if (exp <= 2) young++;
        else if (exp <= 6) prime++;
        else vets++;
    });
    const ageKind = rookies + young >= known * 0.5 ? 'young' : vets >= known * 0.4 ? 'veteran' : 'balanced';
    const ageNote = known ? pickSeeded(AGE_NOTES[ageKind], (+year) * 7 + g.key.length)(team.name) : '';
    const ageChips = known ? `
        <div class="dgt-age-chips">
            ${rookies ? `<span class="dgt-chip">${rookies} rookie${rookies === 1 ? '' : 's'}</span>` : ''}
            ${young ? `<span class="dgt-chip">${young} in year 1-2</span>` : ''}
            ${prime ? `<span class="dgt-chip">${prime} in their prime (3-6 years)</span>` : ''}
            ${vets ? `<span class="dgt-chip">${vets} veteran${vets === 1 ? '' : 's'} (7+ years)</span>` : ''}
        </div>` : '';

    // letture dallo storico: trend, breakout e profili a rischio del roster
    let histBlock = '';
    if (meta.detailOf) {
        const details = g.list.map(p => ({ p, d: meta.detailOf(p) })).filter(x => x.d?.hist);
        const rising = details.filter(x => x.d.hist.trend === 'up');
        const falling = details.filter(x => x.d.hist.trend === 'down');
        const breakouts = details.filter(x => {
            const y1 = x.d.hist.seasons.find(s => s.back === 1);
            return y1?.ptsPerGame != null && x.d.hist.histPts
                && y1.gp >= 6 && (y1.ptsPerGame * 17) >= x.d.hist.histPts * 1.4;
        });
        const risky = details.filter(x => x.d.risk?.level === 'alto');
        const chips = [
            rising.length ? `<span class="dgt-chip dgt-chip--up">${rising.length} on the rise</span>` : '',
            falling.length ? `<span class="dgt-chip dgt-chip--down">${falling.length} declining</span>` : '',
            breakouts.length ? `<span class="dgt-chip">breakout: ${breakouts.map(x => x.p.player).join(', ')}</span>` : '',
        ].filter(Boolean).join('');
        const riskNote = risky.length
            ? `<p class="dg-comment">Veteran${risky.length === 1 ? '' : 's'} on a downward curve: ${risky.map(x => x.p.player).join(', ')} — in the league's historical numbers this profile has flopped 36% of the time.</p>` : '';
        if (chips || riskNote) {
            histBlock = `
            <span class="mc-kicker">Reading the history</span>
            <div class="dgt-age-chips">${chips}</div>
            ${riskNote}`;
        }
    }

    // infortuni: lo status Sleeper è ATTUALE → sensato solo a stagione non giocata
    let injuryBlock = '';
    if (!seasonPlayed) {
        const injured = g.list.map(p => ({ p, hit: matchProjection(meta.proj, p.player, p.pos) }))
            .filter(x => x.hit?.injuryStatus);
        if (injured.length) {
            injuryBlock = `
            <span class="mc-kicker">Injury report</span>
            <div class="dgt-injuries">${injured.map(({ p, hit }) => `
                <div class="dgt-injury"><b>${p.player}</b> — ${hit.injuryStatus}${hit.injuryBodyPart ? ` (${hit.injuryBodyPart})` : ''}${hit.injuryNotes ? `: ${hit.injuryNotes}` : ''}</div>`).join('')}
            </div>`;
        }
    }

    return `
    <div class="mosaic-card mc-wide dgt-card mc-in">
        <span class="mc-kicker">Positions and age</span>
        <h2 class="mc-title">Roster construction</h2>
        <div class="dg-body">
            <div class="dg-col">
                <span class="mc-kicker">Projected points vs league median</span>
                <div class="dg-bars">${bars}</div>
            </div>
            <div class="dg-col">
                <span class="mc-kicker">Age profile</span>
                ${ageChips}
                ${ageNote ? `<p class="dg-comment">${ageNote}</p>` : ''}
                ${histBlock}
                ${injuryBlock}
            </div>
        </div>
    </div>`;
}

// ─── Sezione: pick per pick ──────────────────────────────────────

function picksSection(ctx, prevYear) {
    const { year, g, meta, prevStats, seasonPlayed } = ctx;
    const seed = (+year) * 13;

    const rows = g.list.map(p => {
        const hit = matchProjection(meta.proj, p.player, p.pos);
        const expAtDraft = hit?.rookieYear != null ? +year - hit.rookieYear : null;
        const kind = classifyPick(p);
        const verdict = pickSeeded(PICK_VERDICTS[kind], seed + p.pick)({
            player: p.player, pick: p.pick,
            alt: p.alt ? p.alt.player : 'nessuno',
            adpGap: p.adp ? Math.max(1, Math.round(p.adp - p.pick)) : 0,
        });

        let adpLabel = '';
        if (p.adp) {
            const diff = Math.round(p.adp - p.pick);
            adpLabel = diff > 6 ? `<span class="dg-badge dg-badge--down">reach · ADP ${Math.round(p.adp)}</span>`
                : diff < -6 ? `<span class="dg-badge dg-badge--up">steal · ADP ${Math.round(p.adp)}</span>`
                    : `<span class="dgt-chip">ADP ${Math.round(p.adp)}</span>`;
        }

        // voto della singola pick: valore raccolto vs atteso della slot,
        // stessa scala dei voti squadra
        const pickLetter = letterFor(p.expected ? p.value / p.expected : 0, 1);
        const pickGrade = `<span class="dg-letter dgt-pick-grade dg-letter--${gradeBand(pickLetter)}" title="Pick grade: ${fmt0(p.value)} pt vs ${fmt0(p.expected)} expected at slot #${p.pick}">${pickLetter}</span>`;

        const altTeamKey = p.alt ? TEAM_KEYS[displayName(p.alt.team)] : null;
        const altWho = p.alt ? `<b>${p.alt.player}</b> (proj ${fmt0(p.alt.value)} pt, later #${p.alt.pick}${altTeamKey ? ` to ${TEAMS[altTeamKey].name}` : ''})` : '';
        const altLine = !p.alt
            ? `No other ${p.pos} drafted afterward: this was the last chance at the position on the board`
            : p.alt.value > p.value * 1.1
                ? `${altWho} was still on the board: the position had more to offer`
                : p.alt.value > p.value
                    ? `Best ${p.pos} left: ${altWho} — minimal difference, a defensible pick`
                    : `Best ${p.pos} picked from that point on: no ${p.pos} taken afterward projected higher`;

        const actualLine = seasonPlayed && p.actual != null
            ? `<span class="dg-pick-actual">then: ${fmt0(p.actual)} real pt ${outcomeBadge(p)}</span>` : '';

        // carriera oltre l'anno precedente + picco («quando è stato ad alto livello»)
        const d = meta.detailOf?.(p);
        const older = d?.hist?.seasons?.filter(s => s.back >= 2) || [];
        const peak = d?.hist?.peak?.back >= 2 ? peakNote(d.hist, p.pos) : '';
        const olderLine = older.length
            ? `<p class="dgt-pick-hist">Even earlier — ${historyLine({ seasons: older }, p.pos, 5)}${peak ? ` · <b>${peak}</b>` : ''}</p>` : '';
        const riskChip = p.riskIndex != null
            ? `<span class="dgt-chip dgt-chip--${p.riskIndex >= 60 ? 'down' : p.riskIndex <= 35 ? 'up' : ''}" title="Composite Risk Index: bust, volatility, durability and age">Risk ${p.riskIndex}</span>` : '';
        const badges = [
            d?.hist ? trendBadge(d.hist) : '',
            d?.hist?.consistency >= 0.75 ? `<span class="dgt-chip">consistent</span>` : '',
            riskChip,
            d?.risk?.level === 'alto' ? `<span class="dg-badge dg-badge--down" title="${d.risk.label}">at-risk profile</span>` : '',
        ].filter(Boolean).join(' ');

        return `
        <div class="dgt-pick mc-in">
            <div class="dgt-pick-head" data-player-modal
                 data-player-name="${p.player}" data-pos="${p.pos}" data-nfl="${p.nfl || ''}" data-year="${year}">
                <span class="dg-row-pick">#${p.pick}</span>
                <img class="dg-headshot dgt-pick-img" src="images/fallback-player.svg" alt="${p.player}"
                     data-player-name="${p.player}" data-team="${p.nfl}" data-pos="${p.pos}">
                <div class="dg-pick-info">
                    <span class="dg-pick-name">${p.player} <small>${p.pos}${p.nfl ? ` · ${p.nfl}` : ''} · round ${p.round}</small></span>
                    <span class="dg-pick-val">${fmt0(p.value)} pt ${d?.wHist ? 'expected (projection + history)' : 'projected'} <small>vs ${fmt0(p.expected)} expected (${p.delta >= 0 ? '+' : ''}${fmt0(p.delta)})</small></span>
                    ${actualLine}
                </div>
                ${adpLabel}
                ${pickGrade}
            </div>
            <div class="dgt-pick-body">
                <p class="dgt-pick-prior">${priorLine(p, prevStats, prevYear, expAtDraft)} ${badges}</p>
                ${olderLine}
                <p class="dgt-pick-alt">${altLine}</p>
                <p class="dgt-pick-verdict">${verdict}</p>
            </div>
        </div>`;
    }).join('');

    return `
    <div class="mosaic-card mc-wide dgt-card mc-in">
        <span class="mc-kicker">The full dossier</span>
        <h2 class="mc-title">Pick by pick</h2>
        <div class="dgt-picks">${rows}</div>
    </div>`;
}

// ─── Sezione: il verdetto del campo (solo stagioni giocate) ──────

const PB = { w: 860, h: 300, l: 52, r: 16, t: 18, b: 46 };
const WK = { w: 860, h: 320, l: 52, r: 120, t: 18, b: 34 };

function verdictSection(ctx) {
    const { year, team, g, weekly, vor, rank } = ctx;

    // voto di fine stagione (VOR) vs voto post-draft
    const eos = vor?.byKey?.[g.key];
    const postLetter = letterFor(g.ratio, rank);
    const eosBlock = eos ? `
        <div class="dgt-eos-grades">
            <div class="dgt-eos-item">
                <span class="mc-kicker">Post-draft grade</span>
                <span class="dg-letter dg-letter--${gradeBand(postLetter)}">${postLetter}</span>
                <small>on draft-day projections</small>
            </div>
            <div class="dgt-eos-arrow" aria-hidden="true">→</div>
            <div class="dgt-eos-item">
                <span class="mc-kicker">End-of-season grade</span>
                <span class="dg-letter dg-letter--${gradeBand(eos.letter)}">${eos.letter}</span>
                <small>${eos.rank + 1}${eos.rank + 1 === 1 ? 'st' : eos.rank + 1 === 2 ? 'nd' : eos.rank + 1 === 3 ? 'rd' : 'th'} in league on VOR basis (real yield)</small>
            </div>
        </div>` : '';

    // (a) proiettato vs reale, barre accoppiate per pick
    const rows = g.list.filter(p => p.actual != null);
    const maxV = Math.max(...rows.flatMap(p => [p.value, p.actual]), 1);
    const ticks = niceTicks(0, maxV);
    const yMax = ticks[ticks.length - 1];
    const plotW = PB.w - PB.l - PB.r;
    const plotH = PB.h - PB.t - PB.b;
    const groupW = plotW / rows.length;
    const barW = Math.min(16, groupW / 2 - 3);
    const y = (v) => PB.t + (1 - v / yMax) * plotH;

    const grid = ticks.map(v => `
        <line x1="${PB.l}" y1="${y(v)}" x2="${PB.l + plotW}" y2="${y(v)}" class="an-gridline"/>
        <text x="${PB.l - 8}" y="${y(v) + 3}" class="an-tick" text-anchor="end">${fmt0(v)}</text>`).join('');

    const bars = rows.map((p, i) => {
        const gx = PB.l + i * groupW + (groupW - barW * 2 - 2) / 2;
        const lastName = p.player.split(' ').pop();
        return `
        <rect x="${gx}" y="${y(p.value)}" width="${barW}" height="${Math.max(0, PB.t + plotH - y(p.value))}" class="dgt-bar-proj" rx="2"><title>${p.player} — projected ${fmt0(p.value)}</title></rect>
        <rect x="${gx + barW + 2}" y="${y(p.actual)}" width="${barW}" height="${Math.max(0, PB.t + plotH - y(p.actual))}" fill="${team.color}" rx="2"><title>${p.player} — real ${fmt0(p.actual)}</title></rect>
        <text x="${gx + barW + 1}" y="${PB.h - 30}" class="an-tick dgt-bar-label" text-anchor="end" transform="rotate(-38 ${gx + barW + 1} ${PB.h - 30})">${lastName}</text>`;
    }).join('');

    // (b) corsa settimanale (cumulata) dei top-5 pick per proiezione
    let weeklyChart = '';
    if (weekly) {
        const PALETTE = [team.color, '#5ac8fa', '#ffd60a', '#ff9f0a', '#bf5af2'];
        const top = [...g.list].sort((a, b) => b.value - a.value).slice(0, 5)
            .filter(p => weekly[p.player]?.length);
        if (top.length) {
            const series = top.map((p, i) => {
                let cum = 0;
                return {
                    name: p.player, color: PALETTE[i % PALETTE.length],
                    values: weekly[p.player].map(({ wk, pts }) => ({ wk, score: +(cum += pts).toFixed(1) })),
                };
            });
            weeklyChart = buildWeeklyChart(series);
        }
    }

    // (c) recap rivelazioni e flop
    const revs = rows.filter(p => p.value >= 15 && p.actual / (p.value || 1) >= 1.35)
        .sort((a, b) => b.actual / b.value - a.actual / a.value);
    const flops = rows.filter(p => p.value >= 15 && p.actual / (p.value || 1) <= 0.55)
        .sort((a, b) => a.actual / a.value - b.actual / b.value);
    const chip = (p, up) => `<span class="dgt-chip dgt-chip--${up ? 'up' : 'down'}">${p.player}: ${fmt0(p.value)} → ${fmt0(p.actual)} pt</span>`;
    const recap = (revs.length || flops.length) ? `
        <div class="dgt-recap">
            ${revs.length ? `<div class="dgt-recap-row"><span class="mc-kicker">Breakouts</span>${revs.map(p => chip(p, true)).join('')}</div>` : ''}
            ${flops.length ? `<div class="dgt-recap-row"><span class="mc-kicker">Flops</span>${flops.map(p => chip(p, false)).join('')}</div>` : ''}
        </div>` : '';

    return `
    <div class="mosaic-card mc-wide dgt-card mc-in">
        <span class="mc-kicker">How it really went</span>
        <h2 class="mc-title">The verdict from the field</h2>
        <p class="dgt-card-sub">Grey bars: preseason projected points. Colored bars: real points from the ${year} season.</p>
        ${eosBlock}
        <div class="dgt-chart-wrap">
            <svg viewBox="0 0 ${PB.w} ${PB.h}" class="an-svg">${grid}${bars}</svg>
        </div>
        ${weeklyChart ? `
        <span class="mc-kicker" style="margin-top:18px">The top picks' race (cumulative points)</span>
        <div class="dgt-chart-wrap">${weeklyChart}</div>` : ''}
        ${recap}
        ${accuracyBlock(ctx)}
    </div>`;
}

/**
 * Accuratezza pre-vs-reale: lega i segnali pre-stagione (SOS+, probabilità
 * flop) agli scostamenti reali dell'attacco. Niente correlazione su n piccolo
 * (un roster ha ~8 pick d'attacco, statisticamente inaffidabile): si mostra
 * caso per caso se i flop/rivelazioni reali erano stati segnalati.
 */
function accuracyBlock(ctx) {
    const off = ctx.g.list.filter(p => p.ctx?.contextScore != null && p.actual != null);
    if (!off.length) return '';
    const ratio = (p) => (p.value ? p.actual / p.value : 1);

    // (1) le CHIAMATE flop del modello (rischio ≥ 40%) alla prova dei fatti
    const calls = off.filter(p => p.ctx.bustProb != null && p.ctx.bustProb >= 0.4)
        .sort((a, b) => b.ctx.bustProb - a.ctx.bustProb);
    const callChips = calls.map(p => {
        const flopped = ratio(p) <= 0.6;
        return `<span class="dgt-chip dgt-chip--${flopped ? 'up' : 'down'}">${p.player}: flop ${Math.round(p.ctx.bustProb * 100)}% → ${flopped ? 'confirmed ✓' : 'disproven ✗'}</span>`;
    });
    // (2) rivelazioni reali che avevano un profilo SOS+ alto
    const revChips = off.filter(p => p.value >= 15 && ratio(p) >= 1.35 && p.ctx.contextScore >= 62)
        .map(p => `<span class="dgt-chip dgt-chip--up">${p.player}: breakout with high SOS+ (${p.ctx.contextScore}) ✓</span>`);

    const rows = [...callChips, ...revChips];
    const lead = calls.length
        ? `The model's "flop" calls (risk ≥ 40%) put to the test${revChips.length ? ', plus the breakouts that already had a high SOS+ profile' : ''}.`
        : (revChips.length
            ? "No high flop-risk picks; this season's breakouts already had a high SOS+ profile."
            : "Cautious roster: the model hadn't flagged any high flop-risk picks.");

    return `
    <div class="dgt-accuracy">
        <span class="mc-kicker">Did the model call it right?</span>
        <p class="dgt-card-sub">${lead}</p>
        ${rows.length ? `<div class="dgt-recap-row">${rows.join('')}</div>` : ''}
    </div>`;
}

function buildWeeklyChart(series) {
    const weeks = [...new Set(series.flatMap(s => s.values.map(v => v.wk)))].sort((a, b) => a - b);
    const scores = series.flatMap(s => s.values.map(v => v.score));
    const ticks = niceTicks(0, Math.max(...scores, 1));
    const yMax = ticks[ticks.length - 1];
    const plotW = WK.w - WK.l - WK.r;
    const plotH = WK.h - WK.t - WK.b;
    const x = (wk) => WK.l + (weeks.length > 1 ? (weeks.indexOf(wk) / (weeks.length - 1)) * plotW : plotW / 2);
    const y = (v) => WK.t + (1 - v / yMax) * plotH;

    const grid = ticks.map(v => `
        <line x1="${WK.l}" y1="${y(v)}" x2="${WK.l + plotW}" y2="${y(v)}" class="an-gridline"/>
        <text x="${WK.l - 8}" y="${y(v) + 3}" class="an-tick" text-anchor="end">${fmt0(v)}</text>`).join('');
    const xTicks = weeks.filter((_, i) => weeks.length <= 10 || i % 2 === 0).map(wk =>
        `<text x="${x(wk)}" y="${WK.h - 8}" class="an-tick" text-anchor="middle">W${wk}</text>`).join('');

    const ends = series.map(s => {
        const last = s.values[s.values.length - 1];
        return { s, lx: x(last.wk), ly: y(last.score), labelY: y(last.score) };
    }).sort((a, b) => a.ly - b.ly);
    for (let i = 1; i < ends.length; i++) {
        if (ends[i].labelY - ends[i - 1].labelY < 15) ends[i].labelY = ends[i - 1].labelY + 15;
    }

    const lines = series.map(s => `<polyline points="${s.values.map(v => `${x(v.wk).toFixed(1)},${y(v.score).toFixed(1)}`).join(' ')}"
        fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`).join('');
    const endDots = ends.map(({ s, lx, ly, labelY }) => `
        ${Math.abs(labelY - ly) > 2 ? `<line x1="${lx + 5}" y1="${ly}" x2="${lx + 12}" y2="${labelY}" class="an-leader"/>` : ''}
        <circle cx="${lx}" cy="${ly}" r="4" fill="${s.color}" stroke="#000" stroke-width="2"/>
        <text x="${lx + 14}" y="${labelY + 3.5}" class="an-endlabel">${s.name.split(' ').pop()}</text>`).join('');

    return `<svg viewBox="0 0 ${WK.w} ${WK.h}" class="an-svg">${grid}${xTicks}${lines}${endDots}</svg>`;
}

// ─── Headshot async (stesso pattern delle altre sezioni) ─────────

function loadHeadshots(root, year) {
    root.querySelectorAll('.dg-headshot').forEach(async (img) => {
        img.onerror = () => {
            if (!img.src.endsWith('fallback-player.svg')) img.src = 'images/fallback-player.svg';
        };
        try {
            const url = await playerImageService.getPlayerImageUrl(
                img.dataset.playerName, img.dataset.team, img.dataset.pos, year);
            if (url) img.src = url;
        } catch { /* resta il fallback */ }
    });
}
