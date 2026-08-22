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

import { fetchDraftData, flattenDraft, fetchFantasyData, getSeasonConfig, displayName } from '../data.js?v=534';
import { TEAM_KEYS } from '../data/team-config.js?v=533';
import { TEAMS } from './team.js?v=600';
import { getHonorsBundle } from '../data/honors.js?v=584';
import { getSeasonProjections, getSeasonStats, matchProjection } from '../data/projections.js?v=589';
import { getHistoryIndex, trendBadge, historyLine, peakNote } from '../data/player-history.js?v=588';
import { initPlayerModal } from '../components/player-modal.js?v=606';
import { playerImageService } from '../services/player-image-service.js?v=515';
import { pickSeeded } from '../data/magazine-voices.js?v=517';
import {
    computeGrades, makeEvaluator, letterFor, gradeBand, strategyLine,
    GRADE_COMMENTS, outcomeBadge, computeVorGrades,
} from './draftgrades.js?v=611';
import { getContextScore, getDraftModel } from '../data/context-score.js?v=582';
import { evaluateLeague, TSI_WEIGHTS, TSI_LABELS } from '../data/team-eval.js?v=534';
import { computeDraftScoreV2, gradeBandV2, getAdpDispersion, getDraftScoreV2Calib } from '../data/draft-score-v2.js?v=7';

const fmt0 = (n) => Math.round(n).toLocaleString('it-IT');
const fmt1 = (n) => (+n).toLocaleString('it-IT', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

// etichetta steal/reach in σ dall'ADP di consenso FFC (positivo = steal)
const v2StealTag = (r) => `${r.adpZ >= 0 ? '+' : ''}${r.adpZ}σ vs ADP`;
const v2IsSteal = (r) => r && r.adpZ != null && r.adpZ > 0.5;
const v2IsReach = (r) => r && r.adpZ != null && r.adpZ < -0.5;

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
        // Draft Score v2 (decomponibile, affianca il voto storico). Mappa pick→analisi.
        const [adpDisp, calib] = await Promise.all([
            getAdpDispersion(year).catch(() => null),   // dispersione ADP (FFC)
            getDraftScoreV2Calib().catch(() => null),   // pesi/soglie tarati LOSO (se adottati)
        ]);
        const scoreV2 = computeDraftScoreV2(grades, proj, { adpDisp, calib });
        const v2 = scoreV2?.byKey?.[teamKey] || null;
        const v2ByPick = new Map((v2?.picks || []).map(r => [r.pick, r]));
        const boardByPos = scoreV2?.boardByPos || null;

        const weekly = seasonPlayed
            ? await buildWeeklySeries(year, g.list).catch(() => null) : null;
        if (!location.hash.includes(`draftgrades/${year}/${teamKey}`)) return;

        render(section, { year, team, g, rank, grades, meta, prevStats, weekly, seasonPlayed, sos, vor, v2, v2ByPick, boardByPos, teamKey });
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
    const pts = s.ptsLeague ?? s.ptsPpr ?? s.ptsStd;
    const bits = [`${fmt0(pts)} pt`];
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

        ${draftScoreV2Card(ctx)}
        ${draftStoryCard(ctx)}
        ${curveCard(g, team)}
        ${teamStrengthCard(ctx)}
        ${sosCard(ctx)}
        ${rosterCard(ctx)}
        ${scarcityCard(ctx)}
        ${picksSection(ctx, prevYear)}
        ${seasonPlayed ? verdictSection(ctx) : ''}

        <p class="dg-footnote">Analysis based on ${year} preseason projections and real career stats (up to 6 seasons, Rotowire/Sleeper) converted into the league's scoring${g.list.some(p => p.adp) ? ', full-PPR ADP for reach and steal' : ' (ADP not available for this year)'}. For kicker and defense the value also weighs recent real production (60% and 35%, weights calibrated on the 419 picks from 2019-2025); for offense the projections have proven more reliable than any historical metric, and history feeds trend and risk signals. Alternatives calculated only among players drafted after each pick.</p>
    </div>`;

    bindCurve(section.querySelector('#dgt-curve'));
    loadHeadshots(section, seasonPlayed ? year : prevYear);
}

// ─── Card: Draft Score v2 (decomponibile) ────────────────────────

/**
 * Riepilogo del Draft Score v2: voto ancorato 0-100, scomposizione in
 * componenti (media pick-grade, quota valore titolari, bilanciamento) e
 * highlight steal/reach. Affianca il voto storico, non lo sostituisce.
 */
function draftScoreV2Card(ctx) {
    const { v2 } = ctx;
    if (!v2) return '';
    const c = v2.components;
    const ordinal = (n) => `${n}${n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th'}`;
    const comp = (label, val, title) =>
        `<div class="dgt-v2-comp" title="${title}"><span class="dgt-v2-comp-label">${label}</span><span class="dgt-v2-comp-val">${val}</span></div>`;

    return `
    <div class="mosaic-card mc-wide dgt-card mc-in">
        <span class="mc-kicker">How well you drafted · decomposable grade</span>
        <h2 class="mc-title">Draft Score v2
            <small class="dgt-sos-big dgt-v2-big dg-v2--${gradeBandV2(v2.letter)}">${v2.letter} · ${Math.round(v2.score)}/100 · ${ordinal(v2.rank)} in league</small>
        </h2>
        <p class="dgt-card-sub">Two orthogonal axes: <b>talent</b> (VOR — value above the league replacement level, so QB/RB/WR/TE/K/DEF are comparable) and <b>efficiency</b> (how well you paid for that value vs ADP and vs the best player actually still on the board, adjusted for roster need). The grade is the draft-capital-weighted average of the pick grades, plus roster-construction modifiers. It sits alongside the historic grade, which does not change.</p>
        <div class="dgt-v2-comps">
            ${comp('Pick grade avg', Math.round(c.avgPickGrade), 'Media dei voti-pick pesata per draft-capital (le pick alte pesano di più)')}
            ${comp('Value in starters', `${Math.round(c.starterShare * 100)}%`, 'Quota del valore-VOR che finisce nei titolari (anti bench-inflation)')}
            ${comp('Starter VOR', `${fmt0(c.starterVOR)}/${fmt0(c.totalVOR)}`, 'VOR dei titolari sul VOR totale della rosa')}
            ${comp('Balance', c.balance, 'Bilanciamento della costruzione roster (buchi/surplus per ruolo)')}
            ${comp('Left on board', `−${fmt0(v2.leftOnBoard)}`, 'Valore lasciato sul board rispetto al miglior disponibile need-adjusted, sommato su tutte le pick')}
        </div>
        <div class="dgt-v2-hl">
            ${v2IsSteal(v2.biggestSteal) ? `<span class="dgt-chip dgt-chip--up">Biggest steal: ${v2.biggestSteal.player} (${v2StealTag(v2.biggestSteal)})</span>` : ''}
            ${v2IsReach(v2.biggestReach) ? `<span class="dgt-chip dgt-chip--down">Biggest reach: ${v2.biggestReach.player} (${v2StealTag(v2.biggestReach)})</span>` : ''}
            ${v2.bestPick ? `<span class="dgt-chip dgt-chip--up">Best decision: ${v2.bestPick.player} (${v2.bestPick.letter})</span>` : ''}
            ${v2.worstPick ? `<span class="dgt-chip dgt-chip--down">Weakest decision: ${v2.worstPick.player} (${v2.worstPick.letter})</span>` : ''}
        </div>
    </div>`;
}

// ─── Card: la storia del draft (strategia + what-if) ─────────────

/**
 * Racconto data-driven: cosa è andato bene / cosa ha pesato (da v2.narrative)
 * e l'analisi "what if" (swap col miglior disponibile → Δ punti-titolare).
 */
function draftStoryCard(ctx) {
    const { v2 } = ctx;
    if (!v2 || (!v2.narrative?.good.length && !v2.narrative?.bad.length && !v2.whatIf?.length)) return '';
    const n = v2.narrative || { good: [], bad: [] };

    const goodList = n.good.length
        ? `<ul class="dgt-story-list dgt-story-good">${n.good.map(t => `<li>${t}</li>`).join('')}</ul>`
        : `<p class="dgt-card-sub">Nessun punto di forza marcato emerso dai dati.</p>`;
    const badList = n.bad.length
        ? `<ul class="dgt-story-list dgt-story-bad">${n.bad.map(t => `<li>${t}</li>`).join('')}</ul>`
        : `<p class="dgt-card-sub">Nessuna criticità marcata: draft senza passi falsi evidenti.</p>`;

    const whatIf = v2.whatIf?.length ? `
        <span class="mc-kicker" style="margin-top:16px">What if? · the swaps that would have helped most</span>
        <p class="dgt-card-sub">Sostituendo la scelta col miglior disponibile di allora e ricalcolando il <b>miglior lineup possibile</b>: ecco quanti punti-titolare in più (Δ StarterVOR) avresti messo insieme. Modello a swap singolo.</p>
        <div class="dgt-whatif">
            ${v2.whatIf.map(s => `
            <div class="dgt-whatif-row">
                <span class="dgt-whatif-delta">+${fmt0(s.deltaStarterVOR)}</span>
                <span class="dgt-whatif-text">al posto di <b>${s.from.player}</b> (${s.from.pos}) → <b>${s.to.player}</b> (${s.to.pos}${s.to.team ? ` · ${s.to.team}` : ''})</span>
            </div>`).join('')}
        </div>` : '';

    return `
    <div class="mosaic-card mc-wide dgt-card mc-in">
        <span class="mc-kicker">The story of the draft · from the data</span>
        <h2 class="mc-title">Strategy &amp; what could have been better</h2>
        <div class="dgt-story-cols">
            <div class="dgt-story-col">
                <span class="mc-kicker dgt-story-h dgt-story-h--good">What you did well</span>
                ${goodList}
            </div>
            <div class="dgt-story-col">
                <span class="mc-kicker dgt-story-h dgt-story-h--bad">What hurt the draft</span>
                ${badList}
            </div>
        </div>
        ${whatIf}
    </div>`;
}

// ─── Card: scarsità posizionale / tier ───────────────────────────

/**
 * Curva di scarsità per ruolo: i migliori disponibili per VOR con evidenziati
 * i giocatori presi da QUESTA squadra (colore team) e dagli altri (spenti), più
 * i "cliff" dei tier (crolli di VOR). Fa capire dove il valore si esaurisce.
 * Dati: boardByPos dall'engine v2 (nessuna fonte nuova).
 */
function scarcityCard(ctx) {
    const { boardByPos, teamKey, team } = ctx;
    if (!boardByPos) return '';
    const POS = ['RB', 'WR', 'TE', 'QB'];
    const blocks = POS.map(pos => {
        const players = (boardByPos[pos] || []).slice(0, 10).filter(p => p.vor > 0);
        if (players.length < 3) return '';
        const maxV = Math.max(...players.map(p => p.vor), 1);
        const rows = players.map((p, i) => {
            const mine = p.takenBy === teamKey;
            const other = p.takenBy && !mine;
            const cls = mine ? ' dgt-scar-mine' : other ? ' dgt-scar-other' : ' dgt-scar-free';
            // cliff: crollo >25% di VOR rispetto al precedente
            const prev = players[i - 1];
            const cliff = prev && p.vor < prev.vor * 0.75 ? ' dgt-scar-cliff' : '';
            const w = Math.max(3, Math.round(p.vor / maxV * 100));
            const tag = mine ? 'you' : other ? TEAMS[p.takenBy]?.name?.split(' ')[0] || '—' : 'free';
            return `
            <div class="dgt-scar-row${cls}${cliff}">
                <span class="dgt-scar-name">${p.name}</span>
                <span class="dgt-scar-bar"><span style="width:${w}%${mine ? `;background:${team.color}` : ''}"></span></span>
                <span class="dgt-scar-vor">${p.vor}</span>
                <span class="dgt-scar-tag">${tag}</span>
            </div>`;
        }).join('');
        return `
        <div class="dgt-scar-pos">
            <span class="mc-kicker">${pos}</span>
            <div class="dgt-scar-rows">${rows}</div>
        </div>`;
    }).filter(Boolean).join('');
    if (!blocks) return '';

    return `
    <div class="mosaic-card mc-wide dgt-card mc-in">
        <span class="mc-kicker">Where the value cliffs · positional scarcity</span>
        <h2 class="mc-title">Positional scarcity &amp; tiers</h2>
        <p class="dgt-card-sub">Top available by <b>VOR</b> per position (value above the league replacement level). Your picks in team color, others muted, still-available "free". A line marks a <b>tier cliff</b> (VOR drop &gt; 25%): grabbing the last player before a cliff is worth more than the raw projection suggests.</p>
        <div class="dgt-scar-grid">${blocks}</div>
    </div>`;
}

// ─── Card: la curva del draft ────────────────────────────────────

const CV = { w: 860, h: 320, l: 52, r: 96, t: 34, b: 34 };

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

    // NYT: etichette dirette a fine linea (niente legenda) + callout sul round
    // dove si è lasciato più valore sul tavolo.
    const lastI = rounds.length - 1;
    const last = rounds[lastI];
    const endLabels = `
        <text x="${x(lastI) + 9}" y="${y(last.taken.pts) + 3.5}" class="dgt-curve-endlabel" fill="${team.color}">Picked</text>
        ${last.alt ? `<text x="${x(lastI) + 9}" y="${y(last.alt.pts) + 3.5}" class="dgt-curve-endlabel dgt-curve-endlabel--alt">Best avail.</text>` : ''}`;
    let worstIdx = -1, worstGap = 0;
    rounds.forEach((r, i) => { const gp = Math.max(0, (r.alt?.pts ?? 0) - r.taken.pts); if (gp > worstGap) { worstGap = gp; worstIdx = i; } });
    const callout = (worstIdx >= 0 && worstGap >= 8) ? (() => {
        const cx = x(worstIdx);
        const yTop = Math.min(y(rounds[worstIdx].taken.pts), y(rounds[worstIdx].alt.pts));
        const yBot = Math.max(y(rounds[worstIdx].taken.pts), y(rounds[worstIdx].alt.pts));
        const anchor = cx > CV.l + (CV.w - CV.l - CV.r) * 0.7 ? 'end' : cx < CV.l + (CV.w - CV.l - CV.r) * 0.3 ? 'start' : 'middle';
        return `
        <line x1="${cx}" y1="${yTop}" x2="${cx}" y2="${yBot}" class="dgt-curve-gapmark"/>
        <text x="${cx}" y="${Math.max(CV.t - 14, yTop - 12)}" class="dgt-curve-callout" text-anchor="${anchor}">−${fmt0(worstGap)} pt left at R${rounds[worstIdx].round}</text>`;
    })() : '';

    const dataAttr = JSON.stringify(rounds).replace(/'/g, '&#39;');

    return `
    <div class="mosaic-card mc-wide dgt-card mc-in" id="dgt-curve">
        <span class="mc-kicker">Round by round</span>
        <h2 class="mc-title">The draft curve</h2>
        <p class="dgt-card-sub">The colored line is who was picked; the dashed one is the best player of the same position still on the board (later drafted by another team). The area is the value left on the table: <b>${fmt0(leftOnBoard)} projected pt</b>.</p>
        <div class="dgt-chart-wrap">
            <svg viewBox="0 0 ${CV.w} ${CV.h}" class="an-svg" data-rounds='${dataAttr}'>
                ${grid}${xTicks}${area}${altLine}${takenLine}${dots}${endLabels}${callout}
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
        const pickGrade = `<span class="dg-letter dgt-pick-grade dg-letter--${gradeBand(pickLetter)}" title="Historic pick grade v1: ${fmt0(p.value)} pt vs ${fmt0(p.expected)} expected at slot #${p.pick}">${pickLetter}</span>`;

        // Draft Score v2 della pick (decomponibile): grade + metriche + best-available
        const rp = ctx.v2ByPick?.get(p.pick);
        const v2Grade = rp
            ? `<span class="dgt-v2-pill dg-v2--${gradeBandV2(rp.letter)}" title="Draft Score v2 pick grade (${Math.round(rp.pickScore)}/100)">v2 ${rp.letter}</span>` : '';
        const marketChip = rp && rp.adpZ != null
            ? `<span class="dgt-v2-metric ${rp.adpZ >= 0 ? 'up' : 'down'}" title="Reach/steal in deviazioni standard dall'ADP di consenso FFC (${rp.adpN ?? '?'} draft, σ ${rp.adpStdev}) — positivo = caduto oltre l'ADP (steal)">${rp.adpZ >= 0 ? 'steal' : 'reach'} ${rp.adpZ >= 0 ? '+' : ''}${rp.adpZ}σ</span>`
            : '';
        const v2Line = rp ? `
                <p class="dgt-pick-v2">
                    ${marketChip}
                    <span class="dgt-v2-metric" title="Value Over Replacement: valore sopra il livello di replacement della lega per il ruolo">VOR ${rp.vor}</span>
                    <span class="dgt-v2-metric ${rp.opportunityCost < -5 ? 'down' : ''}" title="Costo opportunità: valore need-adjusted rispetto al miglior disponibile sul board (≤0)">opportunity cost ${rp.opportunityCost}</span>
                    ${rp.scarcity > 0 ? `<span class="dgt-v2-metric up" title="Salto di valore rispetto al prossimo giocatore dello stesso ruolo ancora sul board">scarcity +${rp.scarcity}</span>` : ''}
                    ${rp.bestAlt ? `<span class="dgt-v2-alt">best on the board: <b>${rp.bestAlt.name}</b> (${rp.bestAlt.pos}${rp.bestAlt.team ? ` · ${rp.bestAlt.team}` : ''}, VOR ${rp.bestAlt.vor})</span>` : ''}
                </p>` : '';

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
                ${v2Grade}
                ${pickGrade}
            </div>
            <div class="dgt-pick-body">
                <p class="dgt-pick-prior">${priorLine(p, prevStats, prevYear, expAtDraft)} ${badges}</p>
                ${olderLine}
                <p class="dgt-pick-alt">${altLine}</p>
                ${v2Line}
                <p class="dgt-pick-verdict">${verdict}</p>
            </div>
        </div>`;
    }).join('');

    // timeline v2: strip round → voto-pick (colpo d'occhio prima del dossier)
    const timeline = ctx.v2?.picks?.length ? `
        <div class="dgt-timeline">
            ${ctx.v2.picks.map(r => `
            <div class="dgt-tl-cell dg-v2--${gradeBandV2(r.letter)}" title="Pick #${r.pick} · ${r.player} (${r.pos}) · v2 ${r.letter} ${Math.round(r.pickScore)}/100">
                <span class="dgt-tl-round">R${r.round}</span>
                <span class="dgt-tl-letter">${r.letter}</span>
            </div>`).join('')}
        </div>` : '';

    return `
    <div class="mosaic-card mc-wide dgt-card mc-in">
        <span class="mc-kicker">The full dossier</span>
        <h2 class="mc-title">Pick by pick</h2>
        ${timeline}
        <div class="dgt-picks">${rows}</div>
    </div>`;
}

// ─── Sezione: il verdetto del campo (solo stagioni giocate) ──────

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

    // (a) proiettato → reale: dumbbell ordinato per scarto (surplus/deficit).
    // Un punto per la proiezione, uno per il reso reale; il segmento che li unisce
    // è verde se ha battuto la proiezione, rosso se è calato. Si legge d'un colpo.
    const rows = [...g.list.filter(p => p.actual != null)]
        .sort((a, b) => (b.actual - b.value) - (a.actual - a.value));
    const maxV = Math.max(...rows.flatMap(p => [p.value, p.actual]), 1);
    const ticks = niceTicks(0, maxV);
    const xMax = ticks[ticks.length - 1];
    const DB = { w: 860, l: 168, r: 66, t: 14, b: 30, row: 26 };
    const dbPlotW = DB.w - DB.l - DB.r;
    const dbBottom = DB.t + rows.length * DB.row;
    const dbH = dbBottom + DB.b;
    const xx = (v) => DB.l + (v / xMax) * dbPlotW;

    const grid = ticks.map(v => `
        <line x1="${xx(v).toFixed(1)}" y1="${DB.t}" x2="${xx(v).toFixed(1)}" y2="${dbBottom}" class="an-gridline"/>
        <text x="${xx(v).toFixed(1)}" y="${dbH - 11}" class="an-tick" text-anchor="middle">${fmt0(v)}</text>`).join('');

    const bars = rows.map((p, i) => {
        const yc = DB.t + i * DB.row + DB.row / 2;
        const up = p.actual >= p.value;
        const cls = up ? 'dgt-dumb--up' : 'dgt-dumb--down';
        const dv = `${up ? '+' : ''}${fmt0(p.actual - p.value)}`;
        const endX = Math.max(xx(p.value), xx(p.actual));
        return `
        <g class="dgt-dumb ${cls}">
            <title>${p.player} — projected ${fmt0(p.value)}, real ${fmt0(p.actual)} (${dv})</title>
            <line x1="${xx(p.value).toFixed(1)}" y1="${yc}" x2="${xx(p.actual).toFixed(1)}" y2="${yc}" class="dgt-dumb-link"/>
            <circle cx="${xx(p.value).toFixed(1)}" cy="${yc}" r="4.5" class="dgt-dumb-proj"/>
            <circle cx="${xx(p.actual).toFixed(1)}" cy="${yc}" r="5.5" class="dgt-dumb-real"/>
            <text x="${DB.l - 12}" y="${yc + 3.5}" class="dgt-dumb-name" text-anchor="end">${p.player} <tspan class="dgt-dumb-pos">${p.pos}</tspan></text>
            <text x="${(endX + 10).toFixed(1)}" y="${yc + 3.5}" class="dgt-dumb-delta" text-anchor="start">${dv}</text>
        </g>`;
    }).join('');

    // (b) corsa settimanale (cumulata) dei top-5 pick per proiezione
    let weeklyChart = '';
    if (weekly) {
        const top = [...g.list].sort((a, b) => b.value - a.value).slice(0, 5)
            .filter(p => weekly[p.player]?.length);
        if (top.length) {
            const series = top.map((p) => {
                let cum = 0;
                return {
                    name: p.player, color: '#6f6d69',
                    values: weekly[p.player].map(({ wk, pts }) => ({ wk, score: +(cum += pts).toFixed(1) })),
                };
            });
            // NYT: un solo protagonista (chi ha accumulato di più) in team color, il resto è contesto grigio
            let li = 0, lmax = -1;
            series.forEach((s, i) => { const f = s.values[s.values.length - 1]?.score || 0; if (f > lmax) { lmax = f; li = i; } });
            series[li].color = team.color;
            series[li].lead = true;
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
        <p class="dgt-card-sub">Grey dot: preseason projection. Colored dot: real points from the ${year} season — <b class="dgt-legend-up">green</b> if the pick beat its projection, <b class="dgt-legend-down">red</b> if it fell short. Sorted by surplus.</p>
        ${eosBlock}
        <div class="dgt-chart-wrap">
            <svg viewBox="0 0 ${DB.w} ${dbH}" class="an-svg dgt-dumb-svg">${grid}${bars}</svg>
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

    // il contesto va disegnato prima, il protagonista sopra a tutto
    const ordered = [...series].sort((a, b) => (a.lead ? 1 : 0) - (b.lead ? 1 : 0));
    const lines = ordered.map(s => `<polyline points="${s.values.map(v => `${x(v.wk).toFixed(1)},${y(v.score).toFixed(1)}`).join(' ')}"
        fill="none" stroke="${s.color}" stroke-width="${s.lead ? 2.8 : 1.6}" stroke-linejoin="round" stroke-linecap="round"${s.lead ? '' : ' opacity="0.85"'}/>`).join('');
    const endDots = ends.map(({ s, lx, ly, labelY }) => `
        ${Math.abs(labelY - ly) > 2 ? `<line x1="${lx + 5}" y1="${ly}" x2="${lx + 12}" y2="${labelY}" class="an-leader"/>` : ''}
        <circle cx="${lx}" cy="${ly}" r="${s.lead ? 4.5 : 3.5}" fill="${s.color}" stroke="#000" stroke-width="2"/>
        <text x="${lx + 14}" y="${labelY + 3.5}" class="an-endlabel${s.lead ? ' an-endlabel--lead' : ''}" fill="${s.lead ? s.color : '#8a8681'}">${s.name.split(' ').pop()}</text>`).join('');

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
