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

import { fetchDraftData, flattenDraft, fetchFantasyData, getSeasonConfig, displayName } from '../data.js?v=540';
import { TEAM_KEYS } from '../data/team-config.js?v=533';
import { TEAMS } from './team.js?v=610';
import { getHonorsBundle } from '../data/honors.js?v=591';
import { getSeasonProjections, getSeasonStats, matchProjection } from '../data/projections.js?v=595';
import { getHistoryIndex, trendBadge, historyLine, peakNote } from '../data/player-history.js?v=595';
import { initPlayerModal } from '../components/player-modal.js?v=620';
import { playerImageService } from '../services/player-image-service.js?v=522';
import { pickSeeded } from '../data/magazine-voices.js?v=518';
import {
    computeGrades, makeEvaluator, gradeBand, strategyLine,
    outcomeBadge, computeSeasonDelivery,
} from './draftgrades.js?v=659';
import { getContextScore, getDraftModel } from '../data/context-score.js?v=622';
import { evaluateLeague, TSI_WEIGHTS, TSI_LABELS, pickStarters } from '../data/team-eval.js?v=572';
import { computeDraftGrade, getAdpDispersion, getDraftGradeCalib, pickWhy } from '../data/draft-grade.js?v=40';

const fmt0 = (n) => Math.round(n).toLocaleString('it-IT');
const fmt1 = (n) => (+n).toLocaleString('it-IT', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

// ─── Testi generati (varianti seeded, in inglese come tutto il sito) ──

const AGE_NOTES = {
    young: [
        (t) => `A draft built for later: ${t} leaned young, and the best of this group is still ahead.`,
        (t) => `${t} bet on the future — a core with room to grow rather than finished products.`,
    ],
    balanced: [
        (t) => `${t} kept the age curve honest: youth where it can develop, experience where it has to deliver now.`,
        (t) => `A balanced roster on age for ${t}, with no wing of the depth chart left exposed.`,
    ],
    veteran: [
        (t) => `A win-now roster for ${t}: proven production across the board, with the shelf life that comes with it.`,
        (t) => `${t} chose experience — immediate output, and an expiry date printed on the label.`,
    ],
};

// ─── Utility ─────────────────────────────────────────────────────

const ordinal = (n) => `${n}${n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th'}`;

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
        // Resa di fine stagione (VOR reale) — solo stagioni giocate. Non è un
        // voto: è "com'è finita", e sta nella sua sezione.
        const delivery = seasonPlayed ? computeSeasonDelivery(picks, meta) : null;

        // Il Draft Grade: un voto solo, squadra e pick per pick.
        const [adpDisp, calib] = await Promise.all([
            getAdpDispersion(year).catch(() => null),  // ADP di consenso + dispersione (FFC)
            getDraftGradeCalib().catch(() => null),    // soglie-lettera dai quantili storici
        ]);
        const dgAll = computeDraftGrade(grades, proj, { adpDisp, calib });
        const dg = dgAll?.byKey?.[teamKey] || null;
        const dgByPick = new Map((dg?.picks || []).map(r => [r.pick, r]));
        const boardByPos = dgAll?.boardByPos || null;

        const weekly = seasonPlayed
            ? await buildWeeklySeries(year, g.list).catch(() => null) : null;
        if (!location.hash.includes(`draftgrades/${year}/${teamKey}`)) return;

        render(section, { year, team, g, rank, grades, meta, prevStats, weekly, seasonPlayed, sos, delivery, dg, dgAll, dgByPick, boardByPos, teamKey });
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

// ─── Testi delle pick ────────────────────────────────────────────

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
    const { year, team, g, meta, prevStats, weekly, seasonPlayed, dg } = ctx;
    const prevYear = String(+year - 1);

    section.innerHTML = `
    <div class="section-inner gb-page dgt-page" style="--team-color:${team.color};--card-glow:${team.color}">
        <a class="gb-back" href="#draftgrades"><span aria-hidden="true">←</span> Draft Grades</a>

        <header class="mosaic-card mc-wide dgt-hero mc-in">
            <img class="dgt-hero-logo" src="${team.logo}" alt="${team.name}" onerror="this.style.display='none'">
            <div class="dgt-hero-info">
                <span class="mc-kicker">${year} Draft · Full analysis</span>
                <h1 class="mc-title">${team.name}</h1>
                <span class="dg-head-meta">${dg ? `${ordinal(dg.rank)} draft in the league · ` : ''}${fmt0(g.total)} projected pt collected</span>
                <p class="dgt-hero-strategy">${strategyLine(g.list)}</p>
                ${dg ? `<p class="dg-why">${dg.why}</p>` : ''}
            </div>
            ${dg ? `<div class="dg-grade-stack">
                <span class="dg-letter dg-letter--big dg-letter--${gradeBand(dg.letter)}">${dg.letter}</span>
                <span class="dg-grade-score">${dg.grade}<small>/100</small></span>
            </div>` : ''}
        </header>

        ${gradeBreakdownCard(ctx)}
        ${draftStoryCard(ctx)}
        ${curveCard(g, team)}
        ${teamStrengthCard(ctx)}
        ${sosCard(ctx)}
        ${rosterCard(ctx)}
        ${strategyCard(ctx)}
        ${rosterBoardCard(ctx)}
        ${leagueBoardCard(ctx)}
        ${swapAnalysisCard(ctx)}
        ${capitalFlowCard(ctx)}
        ${scarcityCard(ctx)}
        ${picksSection(ctx, prevYear)}
        ${seasonPlayed ? verdictSection(ctx) : ''}
        ${draftScatterCard(ctx)}

        <p class="dg-footnote">Analysis based on ${year} preseason projections and real career stats (up to 6 seasons, Rotowire/Sleeper) converted into the league's scoring${g.list.some(p => p.adp) ? ', full-PPR ADP for reach and steal' : ' (ADP not available for this year)'}. For kicker and defense the value also weighs recent real production (60% and 35%, weights calibrated on the 419 picks from 2019-2025); for offense the projections have proven more reliable than any historical metric, and history feeds trend and risk signals. Alternatives calculated only among players drafted after each pick.</p>
    </div>`;

    bindCurve(section.querySelector('#dgt-curve'));
    bindDraftScatterCard(section.querySelector('#dgt-scatter'), ctx);
    loadHeadshots(section, seasonPlayed ? year : prevYear);
}

// ─── Card: come si legge il voto ─────────────────────────────────

/**
 * Le metriche di supporto del voto squadra. Sono NUMERI, con il rango di lega
 * accanto: mai lettere, altrimenti tornerebbero a leggersi come una seconda
 * pagella in concorrenza col voto (il difetto che ha fatto ritirare v1 e v2).
 */
function gradeBreakdownCard(ctx) {
    const { dg, dgAll } = ctx;
    if (!dg) return '';
    const c = dg.components;
    const w = dgAll?.weights || { talent: 0.6, efficiency: 0.4 };
    const metric = (label, val, unit, rank, note) => `
        <div class="dgt-metric">
            <span class="dgt-metric-label">${label}</span>
            <span class="dgt-metric-val">${val}${unit ? `<small>${unit}</small>` : ''}</span>
            <span class="dgt-metric-note">${rank ? `${ordinal(rank)} in league · ` : ''}${note}</span>
        </div>`;

    return `
    <div class="mosaic-card mc-wide dgt-card mc-in">
        <span class="mc-kicker">Why this grade</span>
        <h2 class="mc-title">Draft Grade
            <small class="dgt-sos-big dgt-grade-big dg-letter--${gradeBand(dg.letter)}">${dg.letter} · ${dg.grade}/100 · ${ordinal(dg.rank)} in league</small>
        </h2>
        <p class="dgt-why">${dg.why}</p>
        <div class="dgt-metrics">
            ${metric('Talent collected', fmt0(c.starterVOR), ' VOR', c.talentRank, `how far the best lineup this draft could field sits above a replacement-level starting nine, against a league best of ${fmt0(c.leagueBestVOR)}`)}
            ${metric('Draft efficiency', c.efficiencyGrade, '/100', c.efficiencyRank, 'draft-capital-weighted average of the pick grades below')}
            ${metric('Value in the starters', Math.round(c.starterShare * 100), '%', null, `${fmt0(c.starterVOR)} of ${fmt0(c.totalVOR)} total value ends up in the starting lineup`)}
        </div>
        <p class="dgt-card-sub">The grade weighs talent ${Math.round(w.talent * 100)}% and efficiency ${Math.round(w.efficiency * 100)}%. Talent is what you walked away with; efficiency is how well you played the board to get it. A team can reach the same letter from either side — the two numbers above say which.</p>
    </div>`;
}

// ─── Card: la storia del draft ───────────────────────────────────

/** Racconto data-driven: cosa è andato bene / cosa ha pesato. */
function draftStoryCard(ctx) {
    const { dg } = ctx;
    if (!dg || (!dg.narrative?.good.length && !dg.narrative?.bad.length)) return '';
    const n = dg.narrative;

    const goodList = n.good.length
        ? `<ul class="dgt-story-list dgt-story-good">${n.good.map(t => `<li>${t}</li>`).join('')}</ul>`
        : `<p class="dgt-card-sub">No standout strength emerged from the data.</p>`;
    const badList = n.bad.length
        ? `<ul class="dgt-story-list dgt-story-bad">${n.bad.map(t => `<li>${t}</li>`).join('')}</ul>`
        : `<p class="dgt-card-sub">No clear weakness: a draft without visible missteps.</p>`;

    return `
    <div class="mosaic-card mc-wide dgt-card mc-in">
        <span class="mc-kicker">The story of the draft · from the data</span>
        <h2 class="mc-title">What worked and what didn't</h2>
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
    </div>`;
}

// ─── Card: scarsità posizionale / tier ───────────────────────────

/**
 * Curva di scarsità per ruolo: i migliori disponibili per VOR con evidenziati
 * i giocatori presi da QUESTA squadra (colore team) e dagli altri (spenti), più
 * i "cliff" dei tier (crolli di VOR). Fa capire dove il valore si esaurisce.
 * Dati: boardByPos dal motore Draft Grade (nessuna fonte nuova).
 */
function scarcityCard(ctx) {
    const { boardByPos, teamKey, team } = ctx;
    if (!boardByPos) return '';
    const POS = ['RB', 'WR', 'TE', 'QB'];

    // geometria comune ai quattro pannelli: stessa scala verticale ovunque,
    // così i ruoli si confrontano a occhio (è il punto del grafico)
    const all = POS.flatMap(pos => (boardByPos[pos] || []).slice(0, 10).filter(p => p.vor > 0));
    if (all.length < 6) return '';
    const maxV = Math.max(...all.map(p => p.vor), 1);

    const W = 300, H = 210, L = 8, R = 8, T = 16, B = 30;
    const iw = W - L - R, ih = H - T - B;

    const panels = POS.map(pos => {
        const players = (boardByPos[pos] || []).slice(0, 10).filter(p => p.vor > 0);
        if (players.length < 3) return '';
        const step = iw / players.length;
        const y = (v) => T + ih - (v / maxV) * ih;

        // il CLIFF: il crollo di valore più grande fra due giocatori consecutivi.
        // È l'informazione che conta davvero — dice fin dove il ruolo "tiene".
        let cliffAt = -1, cliffDrop = 0;
        for (let i = 1; i < players.length; i++) {
            const d = players[i - 1].vor - players[i].vor;
            if (d > cliffDrop) { cliffDrop = d; cliffAt = i; }
        }
        const meaningful = cliffDrop >= maxV * 0.12;

        const bars = players.map((p, i) => {
            const mine = p.takenBy === teamKey;
            const other = p.takenBy && !mine;
            const cls = mine ? 'dgt-sc-mine' : other ? 'dgt-sc-other' : 'dgt-sc-free';
            const x = L + i * step, w = Math.max(2, step - 3);
            const yv = y(p.vor);
            return `<rect class="dgt-sc-bar ${cls}" x="${x.toFixed(1)}" y="${yv.toFixed(1)}" width="${w.toFixed(1)}" height="${(T + ih - yv).toFixed(1)}" rx="1.5"
                ${mine ? `style="fill:${team.color}"` : ''}><title>${p.name}${p.team ? ` (${p.team})` : ''} · VOR ${p.vor}${p.takenBy ? ` · taken #${p.pick} by ${TEAMS[p.takenBy]?.name || p.takenBy}` : ' · never drafted'}</title></rect>`;
        }).join('');

        // linea del crollo + callout: l'annotazione diretta al posto della legenda
        const cliffMark = meaningful ? (() => {
            const x = L + cliffAt * step - 1.5;
            return `
            <line class="dgt-sc-cliff" x1="${x.toFixed(1)}" y1="${T - 4}" x2="${x.toFixed(1)}" y2="${T + ih}"/>
            <text class="dgt-sc-callout" x="${Math.min(x + 5, W - R - 4).toFixed(1)}" y="${(T + 6).toFixed(1)}" text-anchor="${x > W * 0.55 ? 'end' : 'start'}"
                  ${x > W * 0.55 ? `transform="translate(-10,0)"` : ''}>−${Math.round(cliffDrop)} pt</text>`;
        })() : '';

        // il primo della fila e quello subito dopo il crollo: etichette dirette
        const label = (i, anchor) => {
            const p = players[i]; if (!p) return '';
            const x = L + i * step + (anchor === 'end' ? step - 3 : 0);
            return `<text class="dgt-sc-name" x="${x.toFixed(1)}" y="${(T + ih + 12).toFixed(1)}" text-anchor="${anchor}">${p.name.split(' ').slice(-1)[0]}</text>`;
        };

        const mine = players.filter(p => p.takenBy === teamKey).length;
        return `
        <figure class="dgt-sc-panel">
            <figcaption><b>${pos}</b> <span>${meaningful ? `cliff after ${pos}${cliffAt}` : 'no clear cliff'}</span></figcaption>
            <svg viewBox="0 0 ${W} ${H}" class="dgt-sc-svg" role="img"
                 aria-label="${pos} value above replacement for the top of the board${meaningful ? `, with the tier cliff after player ${cliffAt}` : ''}">
                <line class="dgt-sc-base" x1="${L}" y1="${T + ih}" x2="${L + iw}" y2="${T + ih}"/>
                ${bars}
                ${cliffMark}
                ${label(0, 'start')}
                ${meaningful && cliffAt < players.length && cliffAt * step >= 46 ? label(cliffAt, 'start') : ''}
            </svg>
            <p class="dgt-sc-note">${mine ? `You took ${mine}${meaningful && players.slice(0, cliffAt).filter(p => p.takenBy === teamKey).length ? `, ${players.slice(0, cliffAt).filter(p => p.takenBy === teamKey).length} before the cliff` : ''}.` : 'None of these were yours.'}</p>
        </figure>`;
    }).filter(Boolean).join('');
    if (!panels) return '';

    return `
    <div class="mosaic-card mc-wide dgt-card mc-in">
        <span class="mc-kicker">Where the value cliffs · positional scarcity</span>
        <h2 class="mc-title">Where each position runs out</h2>
        <p class="dgt-card-sub">The top of the board at each position, measured in value above a replacement-level starter. All four panels share one vertical scale, so the heights are directly comparable. The vertical line marks the <b>steepest drop</b> — past it, the position stops paying. Bars in team colour are yours, grey ones went elsewhere, faint ones were never drafted.</p>
        <div class="dgt-sc-grid">${panels}</div>
    </div>`;
}

/**
 * "Hai fatto bene ad anticipare il TE? Potevi aspettare sul QB?"
 * Il verdetto arriva da draft-grade.positionalStrategy: due piani a confronto
 * su due turni, non il VOR assoluto (vedi la nota lì).
 */
function strategyCard(ctx) {
    const { dg } = ctx;
    const st = dg?.strategy;
    if (!st?.slots?.length) return '';

    const ICON = { right: '✓', early: '!', even: '=' };
    const LABEL = { right: 'Right call', early: 'Could have waited', even: 'A wash' };

    const rows = st.slots.map(s => `
        <div class="dgt-strat-row dgt-strat--${s.verdict}">
            <span class="allpro-pos pos-${s.pos.toLowerCase()}">${s.pos}</span>
            <div class="dgt-strat-main">
                <span class="dgt-strat-head">${s.player} <small>round ${s.round}</small></span>
                <span class="dgt-strat-note">${s.note}</span>
            </div>
            <div class="dgt-strat-verdict">
                <span class="dgt-strat-icon" aria-hidden="true">${ICON[s.verdict]}</span>
                <span class="dgt-strat-label">${LABEL[s.verdict]}</span>
                <span class="dgt-strat-edge">${s.edge >= 0 ? '+' : ''}${s.edge} pt</span>
            </div>
        </div>`).join('');

    return `
    <div class="mosaic-card mc-wide dgt-card mc-in">
        <span class="mc-kicker">Timing by position · was the reach worth it</span>
        <h2 class="mc-title">When you took each position</h2>
        <p class="dgt-card-sub">For the pick that landed your best player at each position, two plans are compared across <b>both</b> of your turns: taking that position now and letting the board come to you next, against taking the best other position now and getting the leftover at this one. Positive means moving early paid; negative means the position would have kept.</p>
        <div class="dgt-strat">${rows}</div>
        <p class="dgt-strat-bench">${st.bench.note} <span>${st.bench.live} of ${st.bench.live + st.bench.dead} bench picks beat the waiver wire.</span></p>
    </div>`;
}

// ─── Card: la board del draft, quadrato per round ────────────────

/**
 * Colori posizione: gli stessi hex/token già usati da .pos-qb/.pos-rb/... in
 * main.css, riletti qui perché l'SVG li scrive come attributo fill.
 */
const BOARD_POS_COLOR = {
    QB: '#ef4444', RB: 'var(--accent-blue)', WR: 'var(--accent-green)',
    TE: 'var(--accent-amber)', K: 'var(--accent-purple)', DEF: '#64748b',
};
const BOARD_POS_ORDER = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];
const BD = { sq: 74, gap: 12, padX: 10, cols: 8 };

/**
 * Un quadrato per pick di questa squadra, in ordine di round — stile
 * calendario NYT: numero grande = round, colore = ruolo, pieno se il
 * giocatore è finito titolare (lineup ottimale di team-eval.js), sbiadito se
 * è panchina. Poche callout con leader-line (mai più di 3, come l'esempio)
 * segnano i momenti che contano: quando i titolari si sono chiusi, se un
 * pick di panchina è arrivato PRIMA che i titolari fossero al completo, e il
 * verdetto di timing più marcato già calcolato da positionalStrategy.
 */
function rosterBoardCard(ctx) {
    const { g, dg } = ctx;
    const list = g.list;
    if (!list?.length || !g.starters?.length) return '';

    const starterPicks = new Set(g.starters.map(p => p.pick));
    const n = list.length;
    const cols = Math.min(BD.cols, n);
    const rows = Math.ceil(n / cols);
    const rowOf = (round) => Math.floor(list.findIndex(p => p.round === round) / cols);

    const lastStarterRound = Math.max(...g.starters.map(p => p.round));
    const benchList = list.filter(p => !starterPicks.has(p.pick));
    const firstBenchRound = benchList.length ? Math.min(...benchList.map(p => p.round)) : null;
    const outOfOrder = firstBenchRound != null && firstBenchRound < lastStarterRound;
    const earlyBenchPick = outOfOrder ? benchList.find(p => p.round === firstBenchRound) : null;

    // il verdetto di timing più netto già calcolato da draft-grade.positionalStrategy
    const stratRows = dg?.strategy?.slots || [];
    const stratPick = [...stratRows].sort((a, b) => Math.abs(b.edge) - Math.abs(a.edge))[0];

    const flagRounds = new Set([lastStarterRound, earlyBenchPick?.round, stratPick?.round].filter(v => v != null));

    // fino a 3 callout, ognuno ancorato sopra o sotto la griglia a seconda di
    // dove sta il suo quadrato — e impilati (tier) per non sovrapporsi quando
    // finiscono nella stessa metà, come nell'esempio NYT.
    const candidates = [
        { round: lastStarterRound, label: `Starting lineup locked by round ${lastStarterRound}`, cls: '' },
        outOfOrder && earlyBenchPick
            ? { round: firstBenchRound, label: `${earlyBenchPick.player} (R${firstBenchRound}) hit the bench before the lineup was set`, cls: 'dgt-board-callout--warn' }
            : null,
        stratPick
            ? {
                round: stratPick.round,
                label: stratPick.verdict === 'early' ? `Could have waited on the ${stratPick.pos} here` : `Right call moving on the ${stratPick.pos} here`,
                cls: stratPick.verdict === 'early' ? 'dgt-board-callout--warn' : 'dgt-board-callout--good',
            }
            : null,
    ].filter(Boolean).filter((c, i, arr) => arr.findIndex(x => x.round === c.round) === i).slice(0, 3);

    const topList = [], bottomList = [];
    candidates.forEach(c => (rowOf(c.round) < rows / 2 ? topList : bottomList).push(c));
    const tierGap = 24;
    const padTop = 40 + Math.max(0, topList.length - 1) * tierGap;
    const padBottom = 46 + Math.max(0, bottomList.length - 1) * tierGap;

    const W = BD.padX * 2 + cols * BD.sq + (cols - 1) * BD.gap;
    const H = padTop + rows * BD.sq + (rows - 1) * BD.gap + padBottom;
    const xAt = (i) => BD.padX + (i % cols) * (BD.sq + BD.gap);
    const yAt = (i) => padTop + Math.floor(i / cols) * (BD.sq + BD.gap);

    const squares = list.map((p, i) => {
        const isStarter = starterPicks.has(p.pick);
        const color = BOARD_POS_COLOR[p.pos] || BOARD_POS_COLOR.DEF;
        const flagged = flagRounds.has(p.round);
        return `
        <rect x="${xAt(i)}" y="${yAt(i)}" width="${BD.sq}" height="${BD.sq}" rx="12"
            fill="${color}" fill-opacity="${isStarter ? 0.85 : 0.22}"
            class="dgt-board-sq${flagged ? ' dgt-board-sq--flag' : ''}"/>
        <text x="${xAt(i) + BD.sq / 2}" y="${yAt(i) + BD.sq / 2 + 8}" text-anchor="middle"
            class="dgt-board-num" fill="${isStarter ? '#fff' : color}">${p.round}</text>`;
    }).join('');

    const renderCallout = (c, tier, top) => {
        const idx = list.findIndex(p => p.round === c.round);
        const cx = xAt(idx) + BD.sq / 2;
        const anchor = cx < W * 0.3 ? 'start' : cx > W * 0.7 ? 'end' : 'middle';
        const y1 = top ? yAt(idx) : yAt(idx) + BD.sq;
        const y2 = top ? padTop - 12 - tier * tierGap : H - padBottom + 12 + tier * tierGap;
        const ty = top ? y2 - 8 : y2 + 16;
        return `
        <line x1="${cx}" y1="${y1}" x2="${cx}" y2="${y2}" class="dgt-board-leader ${c.cls}"/>
        <text x="${cx}" y="${ty}" text-anchor="${anchor}" class="dgt-board-callout ${c.cls}">${c.label}</text>`;
    };

    const callouts = [
        ...topList.map((c, i) => renderCallout(c, topList.length - 1 - i, true)),
        ...bottomList.map((c, i) => renderCallout(c, bottomList.length - 1 - i, false)),
    ].join('');

    const legend = BOARD_POS_ORDER.map(p => `<span class="allpro-pos pos-${p.toLowerCase()}">${p}</span>`).join('');

    return `
    <div class="mosaic-card mc-wide dgt-card mc-in">
        <span class="mc-kicker">Round by round · how the roster came together</span>
        <h2 class="mc-title">The draft board</h2>
        <p class="dgt-card-sub">Every pick this team made, in the order it made them. Solid squares are this year's best lineup by projected value; faded squares are the bench.</p>
        <div class="dgt-chart-wrap">
            <svg viewBox="0 0 ${W} ${H}" class="an-svg dgt-board-svg">${squares}${callouts}</svg>
        </div>
        <div class="dgt-board-legend">
            ${legend}
            <span class="dgt-board-swatch dgt-board-swatch--starter">Starter</span>
            <span class="dgt-board-swatch dgt-board-swatch--bench">Bench</span>
        </div>
    </div>`;
}

// ─── Card: il board di tutta la lega, questa squadra in evidenza ─

const LB = { labelW: 140, sq: 46, gap: 8, padX: 12, headerH: 30, tierGap: 40 };

/**
 * Orizzontale: SQUADRA in riga, round in colonna, celle quadrate — stesso
 * linguaggio visivo di "The draft board" ma su tutta la lega in un colpo
 * d'occhio. La riga della squadra è sempre l'ULTIMA (in basso), incorniciata,
 * così le callout possono scendere sotto la griglia senza attraversare le
 * righe altrui.
 *
 * Le callout riusano SOLO draft-grade.positionalStrategy — niente nuovo
 * motore: è il verdetto già calibrato sul comportamento atteso dei rivali
 * (ADP + bisogno di rosa), qui semplicemente mostrato nel contesto di cosa
 * hanno scelto per davvero. Quando il piano B (waitAlt) è stato preso
 * per davvero da un rivale, la callout dice anche da chi e quando: è un
 * confronto con le pick vere della lega, non solo con un modello.
 */
function leagueBoardCard(ctx) {
    const { grades, dg, team, teamKey } = ctx;
    if (!grades?.length) return '';
    const others = Object.keys(TEAMS).filter(k => k !== teamKey && grades.some(gr => gr.key === k));
    if (!others.length) return '';
    const teamOrder = [...others, teamKey]; // la propria squadra sempre ultima riga
    const byKey = new Map(grades.map(gr => [gr.key, gr]));
    const maxRound = Math.max(...grades.flatMap(gr => gr.list.map(p => p.round)));
    const rowsN = teamOrder.length;
    const mineRow = rowsN - 1;

    const stratRows = (dg?.strategy?.slots || []).filter(s => s.verdict !== 'even').slice(0, 4);
    const allPicks = grades.flatMap(gr => gr.list.map(p => ({ ...p, teamKeyOf: gr.key })));
    const findDest = (name) => name ? allPicks.find(p => p.player === name && p.teamKeyOf !== teamKey) : null;

    const gridLeft = LB.padX + LB.labelW;
    const plotW = maxRound * LB.sq + (maxRound - 1) * LB.gap;
    const gridTop = LB.headerH + 10;
    const plotH = rowsN * LB.sq + (rowsN - 1) * LB.gap;
    const padBottom = stratRows.length ? 30 + stratRows.length * LB.tierGap : 16;

    const W = gridLeft + plotW + LB.padX;
    const H = gridTop + plotH + padBottom;

    const colX = (round) => gridLeft + (round - 1) * (LB.sq + LB.gap);
    const rowY = (i) => gridTop + i * (LB.sq + LB.gap);

    const roundHeader = Array.from({ length: maxRound }, (_, i) => `
        <text x="${(colX(i + 1) + LB.sq / 2).toFixed(1)}" y="${LB.headerH - 10}"
            text-anchor="middle" class="dgt-lb-round">${i + 1}</text>`).join('');

    const rowLabels = teamOrder.map((k, i) => {
        const t = TEAMS[k];
        const mine = i === mineRow;
        return `
        <text x="${(LB.padX + LB.labelW - 12).toFixed(1)}" y="${(rowY(i) + LB.sq / 2 + 4).toFixed(1)}"
            text-anchor="end" class="dgt-lb-team${mine ? ' dgt-lb-team--mine' : ''}" fill="${mine ? t.color : 'var(--text-muted)'}">${t.name}</text>`;
    }).join('');

    const mineBand = `
        <rect x="${(gridLeft - 4).toFixed(1)}" y="${(rowY(mineRow) - 4).toFixed(1)}" width="${(plotW + 8).toFixed(1)}" height="${LB.sq + 8}" rx="10"
            fill="${team.color}" fill-opacity="0.07"/>`;

    const cells = teamOrder.map((k, ri) => {
        const gr = byKey.get(k);
        const mine = ri === mineRow;
        return gr.list.map(p => {
            const x = colX(p.round);
            const y = rowY(ri);
            const color = BOARD_POS_COLOR[p.pos] || BOARD_POS_COLOR.DEF;
            return `
            <rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${LB.sq}" height="${LB.sq}" rx="8"
                fill="${color}" fill-opacity="${mine ? 0.92 : 0.48}"
                stroke="${mine ? 'var(--text-primary)' : 'none'}" stroke-width="${mine ? 1.4 : 0}">
                <title>Round ${p.round} · ${TEAMS[k].name} · ${p.player} (${p.pos})</title>
            </rect>
            <text x="${(x + LB.sq / 2).toFixed(1)}" y="${(y + LB.sq / 2 + 4).toFixed(1)}"
                text-anchor="middle" class="dgt-lb-pos">${p.pos}</text>`;
        }).join('');
    }).join('');

    const lastTok = (name) => name.split(' ').slice(-1)[0];
    const stratLabel = (s) => {
        const line1 = `${s.pos} — ${s.verdict === 'right' ? 'right call' : "could've waited"} (${s.edge >= 0 ? '+' : ''}${s.edge} pt)`;
        const dest = findDest(s.waitAlt?.name);
        const line2 = dest ? `${lastTok(s.waitAlt.name)} → ${TEAMS[dest.teamKeyOf]?.name || dest.teamKeyOf} R${dest.round}` : null;
        return { line1, line2 };
    };
    // ancorate tutte sotto la riga della squadra (che è l'ultima): una sotto
    // l'altra per tier, così non si accavallano se due round sono vicini.
    const calloutSvg = stratRows.map((s, tier) => {
        const cx = colX(s.round) + LB.sq / 2;
        const y1 = rowY(mineRow) + LB.sq;
        const y2 = y1 + 14 + tier * LB.tierGap;
        const anchor = cx < gridLeft + plotW * 0.25 ? 'start' : cx > gridLeft + plotW * 0.75 ? 'end' : 'middle';
        const cls = s.verdict === 'right' ? 'dgt-board-callout--good' : 'dgt-board-callout--warn';
        const { line1, line2 } = stratLabel(s);
        const text = line2
            ? `<text x="${cx.toFixed(1)}" y="${(y2 + 14).toFixed(1)}" text-anchor="${anchor}" class="dgt-board-callout ${cls}">${line1}</text>
               <text x="${cx.toFixed(1)}" y="${(y2 + 28).toFixed(1)}" text-anchor="${anchor}" class="dgt-lb-callout-sub ${cls}">${line2}</text>`
            : `<text x="${cx.toFixed(1)}" y="${(y2 + 14).toFixed(1)}" text-anchor="${anchor}" class="dgt-board-callout ${cls}">${line1}</text>`;
        return `
        <line x1="${cx.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${cx.toFixed(1)}" y2="${y2.toFixed(1)}" class="dgt-board-leader ${cls}"/>
        ${text}`;
    }).join('');

    const legend = BOARD_POS_ORDER.map(p => `<span class="allpro-pos pos-${p.toLowerCase()}">${p}</span>`).join('');

    return `
    <div class="mosaic-card mc-wide dgt-card mc-in">
        <span class="mc-kicker">All 4 teams, same rounds · ${team.name} highlighted</span>
        <h2 class="mc-title">The whole board</h2>
        <p class="dgt-card-sub">Every pick in the ${ctx.year} draft, round by round, one row per team — ${team.name}'s row always at the bottom, framed. The callouts reuse the same timing verdict already computed for "When you took each position", now read against what rivals actually did with their own turns.</p>
        <div class="dgt-chart-wrap">
            <svg viewBox="0 0 ${W} ${H}" class="an-svg dgt-lb-svg">${mineBand}${roundHeader}${rowLabels}${cells}${calloutSvg}</svg>
        </div>
        <div class="dgt-board-legend">${legend}</div>
    </div>`;
}

// ─── Card: VOR di rosa e reparti — il contro-fattuale round per round ──

/**
 * "Avrei alzato il valore della rosa prendendo un altro giocatore, e su
 * quale reparto?" L'alternativa per ogni pick è quella GIÀ calibrata da
 * draft-grade.computeDraftGrade (bestAlt: stesso pool di M candidati
 * realistici, stesso modello di sopravvivenza di "When you took each
 * position") — nessuna nuova simulazione del board.
 *
 * Il VOR qui è quello di team-eval.js (`g.replacement`, l'ultimo titolare
 * di lega): lo stesso livello che alimenta il Team Strength Index, apposta
 * DIVERSO dalle waiverLevels di draft-grade (quelle valutano la singola
 * pick, non la rosa — vedi la nota in draft-grade.js). Mischiarli avrebbe
 * dato un numero senza un significato solo.
 */
function swapAnalysisCard(ctx) {
    const { g, dgByPick } = ctx;
    const repl = g.replacement;
    if (!repl || !dgByPick || !g.list?.length) return '';

    const vorOf = (value, pos) => Math.max(0, (value || 0) - (repl[pos] || 0));
    const rows = g.list.map(p => {
        const alt = dgByPick.get(p.pick)?.bestAlt;
        const pickVOR = vorOf(p.value, p.pos);
        const altVOR = alt ? vorOf(alt.value, alt.pos) : pickVOR;
        return { p, alt, pickVOR: Math.round(pickVOR), altVOR: Math.round(altVOR), delta: Math.round(altVOR - pickVOR) };
    });

    // Lo stesso rivale può risultare "il migliore ancora libero" a più di una
    // pick (semplicemente perché non l'ha preso nessuno nel frattempo): ogni
    // riga da sola è vera, ma sommare tutte le pick conterebbe lo stesso
    // giocatore più volte, come se lo si potesse prendere due volte. Nel
    // totale e nei reparti conta solo la SUA occorrenza migliore.
    const totalVOR = rows.reduce((s, r) => s + r.pickVOR, 0);
    const byDelta = [...rows].filter(r => r.alt && r.delta > 0).sort((a, b) => b.delta - a.delta);
    const seenAlt = new Set();
    let upside = 0;
    const byPos = {};
    const flagSet = new Set();
    for (const r of byDelta) {
        if (seenAlt.has(r.alt.name)) continue;
        seenAlt.add(r.alt.name);
        upside += r.delta;
        byPos[r.alt.pos] = (byPos[r.alt.pos] || 0) + r.delta;
        if (flagSet.size < 3) flagSet.add(r.p.pick);
    }
    const posOrder = Object.keys(byPos).sort((a, b) => byPos[b] - byPos[a]);
    const maxPos = posOrder.length ? byPos[posOrder[0]] : 1;

    const posBars = posOrder.length ? posOrder.map(pos => `
        <div class="dg-bar">
            <span class="dg-bar-pos">${pos}</span>
            <span class="dg-bar-track"><span style="width:${Math.max(4, byPos[pos] / maxPos * 100)}%"></span></span>
            <span class="dg-bar-val">+${fmt0(byPos[pos])} pt</span>
        </div>`).join('')
        : `<p class="dg-comment">No position had a meaningfully better option sitting on the board — the picks made were close to the ceiling round by round.</p>`;

    const rowsHtml = rows.map(r => `
        <div class="dgt-swap-row${flagSet.has(r.p.pick) ? ' dgt-swap-row--flag' : ''}">
            <span class="dgt-swap-round">R${r.p.round}</span>
            <div class="dgt-swap-pick">
                <span class="allpro-pos pos-${r.p.pos.toLowerCase()}">${r.p.pos}</span>
                <span class="dgt-swap-name">${r.p.player}</span>
                <span class="dgt-swap-vor">${r.pickVOR} VOR</span>
            </div>
            <span class="dgt-swap-arrow" aria-hidden="true">→</span>
            <div class="dgt-swap-pick">${r.alt ? `
                <span class="allpro-pos pos-${r.alt.pos.toLowerCase()}">${r.alt.pos}</span>
                <span class="dgt-swap-name">${r.alt.name}</span>
                <span class="dgt-swap-vor">${r.altVOR} VOR</span>` : `
                <span class="dgt-swap-name dgt-swap-name--muted">Already the top choice on the board</span>`}
            </div>
            <span class="dgt-swap-delta${r.delta >= 8 ? ' dgt-swap-delta--warn' : r.delta <= -8 ? ' dgt-swap-delta--good' : ''}">${r.delta > 0 ? '+' : ''}${r.delta}</span>
        </div>`).join('');

    return `
    <div class="mosaic-card mc-wide dgt-card mc-in">
        <span class="mc-kicker">Roster VOR · position by position</span>
        <h2 class="mc-title">Could a different pick have helped?</h2>
        <p class="dgt-card-sub">Every pick against the best player realistically still on the board at that moment — same model as "When you took each position" — scored in VOR above this league's last starter, the same bar the Team Strength Index uses for roster value. This team collected <b>${fmt0(totalVOR)} VOR</b>; up to <b>+${fmt0(upside)}</b> more was on the board, counting each available player once even where he was the best option at more than one turn. The three biggest single gaps are marked below.</p>
        <div class="dg-bars">${posBars}</div>
        <div class="dgt-swap-list">${rowsHtml}</div>
    </div>`;
}

// ─── Card: dove è finito il capitale del draft ───────────────────

const FLOW = { w: 640, padY: 20, nodeW: 92, leftX: 20, rightX: 520 };

function sankeyPath(xL, y0L, y1L, xR, y0R, y1R) {
    const mid = (xL + xR) / 2;
    return `M${xL},${y0L} C${mid},${y0L} ${mid},${y0R} ${xR},${y0R} L${xR},${y1R} C${mid},${y1R} ${mid},${y1L} ${xL},${y1L} Z`;
}

function flowNode(x, y0, y1, w, label, sub, bold) {
    return `
    <rect x="${x}" y="${y0.toFixed(1)}" width="${w}" height="${(y1 - y0).toFixed(1)}" rx="10"
        fill="var(--bg-glass)" stroke="${bold ? 'var(--text-primary)' : 'var(--border-card)'}" stroke-width="${bold ? 2.5 : 1.5}"/>
    <text x="${x + w / 2}" y="${((y0 + y1) / 2 - 3).toFixed(1)}" text-anchor="middle" class="dgt-flow-label">${label}</text>
    <text x="${x + w / 2}" y="${((y0 + y1) / 2 + 14).toFixed(1)}" text-anchor="middle" class="dgt-flow-sub">${sub}</text>`;
}

// ordine di slot da mostrare a destra — lo stesso di team-eval.js:SLOT_KEYS,
// generato dalle regole di lega vere (league-rules.js:ROSTER_SLOTS)
const SLOT_ORDER = ['QB', 'RB1', 'RB2', 'WR1', 'WR2', 'TE', 'FLEX', 'K', 'DEF'];

/**
 * Alluvial (stile NYT "old districts → new districts"): a sinistra un blocco
 * per OGNI pick di questa squadra, col cognome; a destra un blocco per ogni
 * SLOT titolare — il codice di ruolo da league-rules.js, non "Starters" — più
 * un blocco Bench aggregato. Seguendo il nastro si vede subito quale pick
 * gioca in quale posizione. Evidenziati (bordo + nastro colorato) solo i
 * blocchi toccati dal primo quarto del draft: il capitale più pregiato.
 */
function capitalFlowCard(ctx) {
    const { g } = ctx;
    const list = g.list;
    if (!list?.length || !g.starters?.length) return '';

    const filtered = list.filter(p => p.value != null);
    const { bySlot } = pickStarters(filtered, 'value');
    const starterPicks = new Set(g.starters.map(p => p.pick));
    const slotOf = new Map();
    for (const slotKey of SLOT_ORDER) { const p = bySlot[slotKey]; if (p) slotOf.set(p.pick, slotKey); }

    const n = list.length;
    const totalBench = n - starterPicks.size;

    // sinistra: un blocco per pick. destra: un blocco per slot titolare + Bench.
    const BH = 20, BGAP = 4, SGAP = 3, RGAP = 14;
    const leftH = n * BH + (n - 1) * BGAP;
    const rightH = SLOT_ORDER.length * BH + (SLOT_ORDER.length - 1) * SGAP + RGAP + totalBench * BH;
    const H = FLOW.padY * 2 + Math.max(leftH, rightH);

    // capitale pregiato = il primo quarto dei pick
    const earlyCount = Math.max(1, Math.ceil(n / 4));
    const earlyPicks = new Set(list.slice(0, earlyCount).map(p => p.pick));
    const earlyLabel = earlyCount > 1 ? `R${list[0].round}-${list[earlyCount - 1].round}` : `R${list[0].round}`;

    const leftNodes = list.map((p, i) => ({ p, y0: FLOW.padY + i * (BH + BGAP), y1: FLOW.padY + i * (BH + BGAP) + BH }));

    let cursorR = FLOW.padY;
    const slotNodes = SLOT_ORDER.map(slotKey => {
        const node = { slotKey, y0: cursorR, y1: cursorR + BH };
        cursorR += BH + SGAP;
        return node;
    });
    const benchNode = { y0: cursorR - SGAP + RGAP, y1: cursorR - SGAP + RGAP + totalBench * BH };

    let curBenchR = benchNode.y0, earlyBenchCount = 0;
    const highlightSlots = new Set();
    let highlightBench = false;
    const ribbons = leftNodes.map((ln) => {
        const early = earlyPicks.has(ln.p.pick);
        const slotKey = slotOf.get(ln.p.pick);
        let y0R, y1R;
        if (slotKey) {
            const node = slotNodes.find(s => s.slotKey === slotKey);
            y0R = node.y0; y1R = node.y1;
            if (early) highlightSlots.add(slotKey);
        } else {
            y0R = curBenchR; y1R = curBenchR + BH; curBenchR = y1R;
            if (early) { earlyBenchCount++; highlightBench = true; }
        }
        const path = sankeyPath(FLOW.leftX + FLOW.nodeW, ln.y0, ln.y1, FLOW.rightX, y0R, y1R);
        const cls = !early ? 'dgt-flow-ribbon' : `dgt-flow-ribbon dgt-flow-ribbon--${slotKey ? 'good' : 'warn'}`;
        return `<path d="${path}" class="${cls}"/>`;
    }).join('');

    const caption = earlyBenchCount > 0
        ? `${earlyBenchCount} of your first ${earlyCount} picks (${earlyLabel}) ended up on the bench.`
        : `Every one of your first ${earlyCount} picks (${earlyLabel}) is starting this year.`;

    const shortName = (name) => {
        const last = name.split(' ').slice(-1)[0];
        return last.length > 11 ? `${last.slice(0, 10)}…` : last;
    };

    const leftSvg = leftNodes.map(ln => {
        const isStarter = starterPicks.has(ln.p.pick);
        const color = BOARD_POS_COLOR[ln.p.pos] || BOARD_POS_COLOR.DEF;
        const bold = earlyPicks.has(ln.p.pick);
        return `
        <rect x="${FLOW.leftX}" y="${ln.y0.toFixed(1)}" width="${FLOW.nodeW}" height="${BH}" rx="4"
            fill="${color}" fill-opacity="0.8"
            stroke="${bold ? 'var(--text-primary)' : 'none'}" stroke-width="${bold ? 1.6 : 0}">
            <title>Round ${ln.p.round} · ${ln.p.player} (${ln.p.pos}) → ${isStarter ? (slotOf.get(ln.p.pick) || 'starter') : 'bench'}</title>
        </rect>
        <text x="${(FLOW.leftX + 7).toFixed(1)}" y="${(ln.y0 + BH / 2 + 3.5).toFixed(1)}" class="dgt-flow-name">${shortName(ln.p.player)}</text>`;
    }).join('');

    const slotSvg = slotNodes.map(s => `
        <rect x="${FLOW.rightX}" y="${s.y0.toFixed(1)}" width="${FLOW.nodeW}" height="${BH}" rx="4"
            fill="var(--bg-glass)" stroke="${highlightSlots.has(s.slotKey) ? 'var(--text-primary)' : 'var(--border-card)'}"
            stroke-width="${highlightSlots.has(s.slotKey) ? 2 : 1.2}"/>
        <text x="${(FLOW.rightX + FLOW.nodeW / 2).toFixed(1)}" y="${(s.y0 + BH / 2 + 3.5).toFixed(1)}" text-anchor="middle" class="dgt-flow-slot">${s.slotKey}</text>`).join('');

    const benchSvg = flowNode(FLOW.rightX, benchNode.y0, benchNode.y1, FLOW.nodeW, 'Bench', `${totalBench} pick${totalBench === 1 ? '' : 's'}`, highlightBench);

    const legend = BOARD_POS_ORDER.map(p => `<span class="allpro-pos pos-${p.toLowerCase()}">${p}</span>`).join('');

    return `
    <div class="mosaic-card mc-wide dgt-card mc-in">
        <span class="mc-kicker">Draft capital · who plays where</span>
        <h2 class="mc-title">Where the picks ended up</h2>
        <p class="dgt-card-sub">Every pick this team made, one block each in draft order; on the right, the starting slot it fills this year (league roster rules) or the bench. Bold blocks and ribbon are the first quarter of the draft.</p>
        <div class="dgt-chart-wrap">
            <svg viewBox="0 0 ${FLOW.w} ${H}" class="an-svg dgt-flow-svg">${ribbons}${leftSvg}${slotSvg}${benchSvg}</svg>
        </div>
        <div class="dgt-board-legend">${legend}</div>
        <p class="dgt-card-sub dgt-flow-caption">${caption}</p>
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

    // Il tooltip esce dalla card e diventa figlio diretto di <body>: la card
    // ha overflow-x:auto (che per spec CSS impone anche overflow-y:auto,
    // tagliando il popup vicino al bordo inferiore) e i suoi antenati hanno un
    // transform per l'animazione di reveal allo scroll — che avrebbe reso
    // "position:fixed" relativo A LORO invece che alla finestra, nascondendo
    // il popup dietro la card successiva. Da figlio di body niente di tutto
    // questo si applica: resta sempre in coordinate di viewport, libero.
    document.getElementById('dgt-curve-tooltip')?.remove();
    tooltip.id = 'dgt-curve-tooltip';
    tooltip.style.position = 'fixed';
    document.body.appendChild(tooltip);

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

        // Il tooltip è position:fixed (vedi CSS #dgt-curve): coordinate di
        // VIEWPORT, non più relative al contenitore, così può uscire dalla
        // card invece di finire tagliato dallo scroll orizzontale del grafico.
        let tx = e.clientX + 14;
        const tw = tooltip.offsetWidth || 160;
        if (tx + tw > window.innerWidth - 4) tx = e.clientX - tw - 14;
        let ty = e.clientY - 10;
        const th = tooltip.offsetHeight || 60;
        if (ty + th > window.innerHeight - 4) ty = e.clientY - th - 10;
        if (ty < 4) ty = 4;
        tooltip.style.left = `${tx}px`;
        tooltip.style.top = `${ty}px`;
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

        // Il voto della pick e le sue tre metriche di supporto. Le metriche
        // sono in inglese piano: "sarebbe durato fino al tuo turno?" al posto
        // dei σ dall'ADP, "punti sopra un titolare da waiver" al posto di VOR
        // secco, e il nome vero del miglior giocatore rimasto sul board — che
        // era già calcolato ma finiva in fondo, ed è la cosa più leggibile
        // dell'intera pagina.
        const rp = ctx.dgByPick?.get(p.pick);
        const pickGrade = rp
            ? `<div class="dgt-pick-grade">
                   <span class="dg-letter dg-letter--${gradeBand(rp.letter)}">${rp.letter}</span>
                   <span class="dgt-pick-score">${rp.grade}<small>/100</small></span>
               </div>` : '';

        // la percentuale si mostra sempre: su un nome di testa del board la
        // stima è spesso un testa-o-croce, e un sì/no secco lo nasconderebbe
        const BAND = {
            gone: ['up', (r) => `No — ${r.survivalPct}% chance of lasting to #${r.nextPick}`],
            tossup: ['', (r) => `Toss-up — ${r.survivalPct}% chance of lasting to #${r.nextPick}`],
            lasted: ['down', (r) => `Yes — ${r.survivalPct}% chance of lasting to #${r.nextPick}`],
        };
        const lastedRow = rp && rp.survivalBand
            ? (() => {
                const [cls, txt] = BAND[rp.survivalBand];
                return `<div class="dgt-sup">
                   <span class="dgt-sup-q">Would he have lasted to your next pick?</span>
                   <span class="dgt-sup-a ${cls}">${txt(rp)}</span>
               </div>`;
            })() : '';
        const boardRow = rp && rp.bestAlt
            ? `<div class="dgt-sup">
                   <span class="dgt-sup-q">Best player still on the board</span>
                   <span class="dgt-sup-a">${rp.bestAlt.name} <small>${rp.bestAlt.pos}${rp.bestAlt.team ? ` · ${rp.bestAlt.team}` : ''}</small></span>
               </div>`
            : rp ? `<div class="dgt-sup">
                   <span class="dgt-sup-q">Best player still on the board</span>
                   <span class="dgt-sup-a up">${p.player} — nobody better was left</span>
               </div>` : '';
        const vorRow = rp
            ? `<div class="dgt-sup">
                   <span class="dgt-sup-q">Points above the best free agent at his position</span>
                   <span class="dgt-sup-a ${rp.vor > 0 ? 'up' : ''}">${rp.vor > 0 ? '+' : ''}${rp.vor}${rp.scarcity >= 15 ? ` <small>· position dropped ${rp.scarcity} right after him</small>` : ''}</span>
               </div>` : '';
        const supportBlock = rp
            ? `<div class="dgt-sups">${lastedRow}${boardRow}${vorRow}</div>
               <p class="dgt-pick-why">${pickWhy(rp)}</p>` : '';

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
                    <span class="dg-pick-val">${fmt0(p.value)} pt ${d?.wHist ? 'expected (projection + history)' : 'projected'}${p.adp ? ` <small>· consensus ADP ${Math.round(p.adp)}</small>` : ''}</span>
                    ${actualLine}
                </div>
                ${pickGrade}
            </div>
            <div class="dgt-pick-body">
                ${supportBlock}
                <p class="dgt-pick-prior">${priorLine(p, prevStats, prevYear, expAtDraft)} ${badges}</p>
                ${olderLine}
                <p class="dgt-pick-alt">${altLine}</p>
            </div>
        </div>`;
    }).join('');

    // striscia giro → voto (colpo d'occhio prima del dossier)
    const timeline = ctx.dg?.picks?.length ? `
        <div class="dgt-timeline">
            ${ctx.dg.picks.map(r => `
            <div class="dgt-tl-cell dg-letter--${gradeBand(r.letter)}" title="Pick #${r.pick} · ${r.player} (${r.pos}) · ${r.letter} ${r.grade}/100">
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
    const { year, team, g, weekly, delivery, dg } = ctx;

    // Il voto del draft (decisioni) accanto alla resa vera (risultato). Il
    // secondo NON è una lettera di proposito: sarebbe una pagella concorrente,
    // ed era il difetto del vecchio "FS". Qui è un numero e un rango.
    const eos = delivery?.byKey?.[g.key];
    const eosBlock = eos && dg ? `
        <div class="dgt-eos-grades">
            <div class="dgt-eos-item">
                <span class="mc-kicker">Draft Grade</span>
                <span class="dg-letter dg-letter--${gradeBand(dg.letter)}">${dg.letter}</span>
                <small>the decisions, judged on draft day</small>
            </div>
            <div class="dgt-eos-arrow" aria-hidden="true">→</div>
            <div class="dgt-eos-item">
                <span class="mc-kicker">What it actually delivered</span>
                <span class="dgt-eos-num">${fmt0(eos.vor)}<small> VOR</small></span>
                <small>${ordinal(eos.rank)} in league · ${Math.round(eos.share * 100)}% of all the value the league's draft produced</small>
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

// ─── Card: Draft Value per Pick (stesso grafico di Analysis) ─────

const DVP = { w: 800, h: 320, l: 48, r: 12, t: 16, b: 34 };
const DVP_GREYS = ['#9a9a9a', '#6e6e6e', '#484848'];

/**
 * Punti dello scatter per QUESTA lega/anno. A differenza di Analysis l'asse Y
 * non è il reale di stagione (quello lo copre già "The verdict from the
 * field" qui sopra): è un segnale PRE-draft, selezionabile —
 *  - proj: la proiezione di lega usata in tutta la pagina (`p.value`, stesse
 *    impostazioni di scoring — vedi league-rules.js);
 *  - prev: il reale dell'anno PRIMA del draft, da `prevStats` (già in cache
 *    per questa pagina, un lookup in più su un Map già pronto, non un fetch).
 */
function scatterPointsFor(ctx, mode) {
    const { grades, prevStats } = ctx;
    const points = [];
    for (const gr of grades) {
        for (const p of gr.list) {
            let pts;
            if (mode === 'prev') {
                const hit = prevStats ? matchProjection(prevStats, p.player, p.pos) : null;
                pts = hit ? (hit.ptsLeague ?? hit.ptsPpr ?? hit.ptsStd ?? 0) : 0;
            } else {
                pts = p.value || 0;
            }
            points.push({ pick: p.pick, name: p.player, position: p.pos, teamKey: gr.key, teamName: TEAMS[gr.key]?.name || gr.key, pts });
        }
    }
    return points.sort((a, b) => a.pick - b.pick);
}

/**
 * Il focus è su QUESTA squadra: i suoi giocatori nel colore squadra, gli
 * altri tre team in tre grigi distinti e fissi (sempre lo stesso per la
 * stessa squadra, per restare riconoscibili) invece dei quattro colori pieni
 * di Analysis.
 */
function scatterChartBody(ctx, mode) {
    const { team, teamKey, year } = ctx;
    const raw = scatterPointsFor(ctx, mode);
    if (!raw.length) return `<div class="empty-state"><p class="empty-state-text">No data available</p></div>`;

    const others = Object.keys(TEAMS).filter(k => k !== teamKey);
    const greyOf = new Map(others.map((k, i) => [k, DVP_GREYS[i % DVP_GREYS.length]]));
    const points = raw.map(p => ({
        ...p, mine: p.teamKey === teamKey,
        color: p.teamKey === teamKey ? team.color : (greyOf.get(p.teamKey) || '#666'),
    }));

    const maxPick = Math.max(...points.map(p => p.pick), 1);
    const maxPts = Math.max(...points.map(p => p.pts), 1);
    const yTicks = niceTicks(0, maxPts);
    const yMax = yTicks[yTicks.length - 1] || 1;
    const plotW = DVP.w - DVP.l - DVP.r;
    const plotH = DVP.h - DVP.t - DVP.b;
    const x = (pick) => DVP.l + ((pick - 1) / Math.max(maxPick - 1, 1)) * plotW;
    const y = (pts) => DVP.t + (1 - pts / yMax) * plotH;

    const grid = yTicks.map(v => `
        <line x1="${DVP.l}" y1="${y(v)}" x2="${DVP.l + plotW}" y2="${y(v)}" class="an-gridline"/>
        <text x="${DVP.l - 8}" y="${(y(v) + 3).toFixed(1)}" class="an-tick" text-anchor="end">${fmt0(v)}</text>`).join('');
    const xTickStep = maxPick > 20 ? 4 : 2;
    const xTicks = [];
    for (let p = 1; p <= maxPick; p += xTickStep) {
        xTicks.push(`<text x="${x(p).toFixed(1)}" y="${DVP.h - 10}" class="an-tick" text-anchor="middle">${p}</text>`);
    }

    // Callout solo sui giocatori di QUESTA squadra — il miglior affare tardivo
    // e il buco prematuro peggiore che riguardano lei, non un rivale: il focus
    // resta sulla squadra in analisi, non sull'intera lega come in Analysis.
    const mine = points.filter(p => p.mine);
    const lateHalf = mine.filter(p => p.pick > maxPick / 2);
    const earlyHalf = mine.filter(p => p.pick <= maxPick / 2);
    const bestSteal = lateHalf.length ? lateHalf.reduce((a, b) => (b.pts > a.pts ? b : a)) : null;
    const worstBust = earlyHalf.length ? earlyHalf.reduce((a, b) => (b.pts < a.pts ? b : a)) : null;
    const labeled = new Set([bestSteal, worstBust].filter(Boolean).map(p => p.pick));

    // i punti della squadra si disegnano per ultimi, così restano in primo piano
    const ordered = [...points.filter(p => !p.mine), ...points.filter(p => p.mine)];
    const dots = ordered.map(p => {
        const cx = x(p.pick), cy = y(p.pts);
        const anchor = cx < DVP.l + plotW * 0.1 ? 'start' : cx > DVP.l + plotW * 0.9 ? 'end' : 'middle';
        const label = labeled.has(p.pick)
            ? `<text x="${cx.toFixed(1)}" y="${(cy - 10).toFixed(1)}" class="an-endlabel" text-anchor="${anchor}">${p.name}</text>` : '';
        return `${label}<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${p.mine ? 6 : 5}" fill="${p.color}"
            stroke="#000" stroke-width="1.6"
            class="an-dot" data-name="${p.name}" data-pick="${p.pick}" data-team="${p.teamName}" data-pos="${p.position || ''}" data-pts="${p.pts.toFixed(1)}"/>`;
    }).join('');

    const legend = `
    <div class="an-chart-legend">
        <span class="an-legend-item"><span class="an-legend-key" style="background:${team.color}"></span>${team.name}</span>
        ${others.map(k => `<span class="an-legend-item"><span class="an-legend-key" style="background:${greyOf.get(k)}"></span>${TEAMS[k].name}</span>`).join('')}
    </div>`;

    const sub = mode === 'prev'
        ? `Every pick in the ${year} draft: real points from ${year - 1} (Y) against the pick number (X) — later and higher means a proven producer fell in the draft. Rookies and first-year players show 0, they had no season before this draft.`
        : `Every pick in the ${year} draft: this year's preseason projection (Y, this league's scoring) against the pick number (X) — later and higher means the board still liked someone the room let fall.`;

    return `
    <p class="dgt-card-sub">${sub} ${team.name}'s picks stay in team color; the other three teams are grey, each its own shade, so they're still identifiable without pulling focus.</p>
    ${legend}
    <div class="dgt-chart-wrap">
        <svg viewBox="0 0 ${DVP.w} ${DVP.h}" class="an-svg dgt-scatter-svg">${grid}${xTicks.join('')}${dots}</svg>
        <div class="an-chart-tooltip" hidden></div>
    </div>`;
}

function draftScatterCard(ctx) {
    if (!ctx.grades?.length) return '';
    return `
    <div class="mosaic-card mc-wide dgt-card mc-in" id="dgt-scatter">
        <span class="mc-kicker">All 4 teams, ${ctx.team.name} in color</span>
        <h2 class="mc-title">Draft: Value per Pick</h2>
        <div class="an-avg-toggle">
            <span class="an-avg-label">Y axis:</span>
            <button class="an-avg-pill active" type="button" data-scatter-mode="proj">Projected</button>
            <button class="an-avg-pill" type="button" data-scatter-mode="prev">Previous year</button>
        </div>
        <div id="dgt-scatter-body">${scatterChartBody(ctx, 'proj')}</div>
    </div>`;
}

function bindDraftScatterCard(card, ctx) {
    if (!card) return;
    const body = card.querySelector('#dgt-scatter-body');
    if (!body) return;

    const bindTooltip = () => {
        const svg = body.querySelector('svg');
        const tooltip = body.querySelector('.an-chart-tooltip');
        if (!svg || !tooltip) return;

        // Stessa storia di "The draft curve": la card ha overflow-x:auto (che
        // per spec CSS impone anche overflow-y:auto, popup tagliato vicino al
        // bordo) e un antenato con transform per il reveal allo scroll (che
        // avrebbe reso "fixed" relativo a lui, non alla finestra). Il tooltip
        // esce dal DOM della card, figlio diretto di <body>, in coordinate di
        // viewport — si ripete a ogni redraw (cambio Projected/Previous year),
        // che rifà da zero il markup del grafico.
        document.getElementById('dgt-scatter-tooltip')?.remove();
        tooltip.id = 'dgt-scatter-tooltip';
        tooltip.style.position = 'fixed';
        document.body.appendChild(tooltip);

        svg.addEventListener('pointermove', (e) => {
            const dot = e.target.closest('.an-dot');
            if (!dot) { tooltip.hidden = true; return; }
            tooltip.replaceChildren();
            const title = document.createElement('div');
            title.className = 'an-tt-title';
            title.textContent = `Pick #${dot.dataset.pick}`;
            const row = document.createElement('div');
            row.className = 'an-tt-row';
            const key = document.createElement('span');
            key.className = 'an-tt-key';
            key.style.background = dot.getAttribute('fill');
            const val = document.createElement('b');
            val.textContent = fmt0(Number(dot.dataset.pts));
            const name = document.createElement('span');
            name.className = 'an-tt-name';
            name.textContent = `${dot.dataset.name} (${dot.dataset.pos}) — ${dot.dataset.team}`;
            row.append(key, val, name);
            tooltip.append(title, row);
            tooltip.hidden = false;

            let tx = e.clientX + 14;
            const tw = tooltip.offsetWidth || 160;
            if (tx + tw > window.innerWidth - 4) tx = e.clientX - tw - 14;
            let ty = e.clientY - 10;
            const th = tooltip.offsetHeight || 60;
            if (ty + th > window.innerHeight - 4) ty = e.clientY - th - 10;
            if (ty < 4) ty = 4;
            tooltip.style.left = `${tx}px`;
            tooltip.style.top = `${ty}px`;
        });
        svg.addEventListener('pointerleave', () => { tooltip.hidden = true; });
    };
    bindTooltip();

    card.querySelectorAll('[data-scatter-mode]').forEach(btn => {
        btn.addEventListener('click', () => {
            if (btn.classList.contains('active')) return;
            card.querySelectorAll('[data-scatter-mode]').forEach(b => b.classList.toggle('active', b === btn));
            body.innerHTML = scatterChartBody(ctx, btn.dataset.scatterMode);
            bindTooltip();
        });
    });
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
