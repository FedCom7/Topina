/**
 * Draft Grades — pagelle del draft in stile analisi NFL post-draft.
 *
 * Il voto giudica la scelta COL SENNO DEL GIORNO DEL DRAFT: si basa sulle
 * proiezioni preseason Sleeper (fonte Rotowire) dell'anno del draft stesso —
 * Sleeper le conserva storicamente per ogni stagione dal 2018 in poi, non
 * solo per l'anno corrente — convertite nello scoring della lega, con l'ADP
 * reale a stimare chi sarebbe sopravvissuto al turno dopo (manca solo il 2019).
 *
 * ── UN SOLO VOTO ─────────────────────────────────────────────────
 * Il motore è js/data/draft-grade.js e la gerarchia a schermo è rigida:
 *   1. Draft Grade — una lettera e un numero. La risposta.
 *   2. Metriche di supporto — NUMERI, mai lettere: spiegano quella lettera.
 *   3. Why — una frase generata dai dati (in inglese, come tutto il sito).
 * Nessun indicatore di supporto è espresso in lettere: l'ambiguità "quale
 * voto guardo?" nasceva proprio dall'avere più cose della stessa forma.
 *
 * Qui prima convivevano QUATTRO voti (ratio v1, Draft Score v2, FS di fine
 * stagione, TSI) di cui i primi due erano scorrelati fra loro (ρ 0.147 sulle
 * pick, 86% di disaccordo sulla posizione di lega) e nessuno dei due
 * correlava con la stagione vera. Sono stati ritirati: i dettagli della
 * diagnosi stanno nell'intestazione di draft-grade.js. TSI, SOS+ e il voto di
 * fine stagione restano, ma nella pagina squadra e sotto il voto, come indici
 * separati — non come pagelle concorrenti.
 *
 * Per le stagioni già giocate, ogni pick mostra anche come è andata poi
 * (produzione reale da honors bundle) con badge "breakout"/"flop" quando si
 * discosta molto dal proiettato — un confronto in più, non un secondo voto.
 *
 * Per K e DEF il valore pesa anche la produzione reale recente (pesi
 * calibrati empiricamente, vedi player-history.js); per l'attacco lo storico
 * alimenta solo trend e segnali di rischio, non il numero.
 */

import { fetchDraftData, flattenDraft, displayName, SEASONS } from '../data.js?v=540';
import { TEAM_KEYS } from '../data/team-config.js?v=533';
import { TEAMS } from './team.js?v=635';
import { getHonorsBundle } from '../data/honors.js?v=591';
import { getSeasonProjections, matchProjection } from '../data/projections.js?v=594';
import { getHistoryIndex, blendValue, riskFlag, trendBadge, historyLine } from '../data/player-history.js?v=595';
import { initPlayerModal } from '../components/player-modal.js?v=640';
import { playerImageService } from '../services/player-image-service.js?v=520';
import { predictSeason } from '../data/draft-predictions.js?v=633';
import { getContextScore, getDraftModel } from '../data/context-score.js?v=622';
import { evaluateLeague, replacementLevels } from '../data/team-eval.js?v=572';
import { computeDraftGrade, gradeBand, getDraftGradeCalib, getAdpDispersion } from '../data/draft-grade.js?v=40';

let initialized = false;
let currentYear = null;
const _draftCache = {};

const fmt0 = (n) => Math.round(n).toLocaleString('it-IT');
const fmt1 = (n) => (+n).toLocaleString('it-IT', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const ordinal = (n) => `${n}${n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th'}`;
export const POS_ORDER = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];
export const POS_FALLBACK_PROJ = { K: 125, DEF: 110 }; // media storica di lega, usata solo senza dati

// ─── Init & navigazione ──────────────────────────────────────────

export async function initDraftGrades() {
    if (initialized) return;
    initialized = true;

    const container = document.getElementById('dg-year-selector');
    const content = document.getElementById('draftgrades-content');
    if (!container || !content) return;

    // anni con draft: tutte le stagioni note + l'eventuale draft già fatto
    // per la prossima (appare da solo quando draft_data_{next} esiste)
    const years = [];
    const nextYear = String(+SEASONS[SEASONS.length - 1] + 1);
    for (const y of [...SEASONS, nextYear]) {
        if (!_draftCache[y]) _draftCache[y] = await fetchDraftData(y).catch(() => null);
        if (_draftCache[y]?.teams) years.push(y);
    }
    if (!years.length) {
        content.innerHTML = `<div class="empty-state"><p class="empty-state-text">No draft available</p></div>`;
        return;
    }

    currentYear = years[years.length - 1];
    container.innerHTML = years.map(y =>
        `<button class="year-pill${y === currentYear ? ' active' : ''}" data-year="${y}">${y}</button>`).join('');
    container.addEventListener('click', (e) => {
        const btn = e.target.closest('.year-pill');
        if (!btn) return;
        container.querySelectorAll('.year-pill').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentYear = btn.dataset.year;
        loadYear();
    });

    // click su una card → pagina di analisi della squadra
    // (i giocatori con [data-player-modal] aprono la scheda, non navigano)
    content.addEventListener('click', (e) => {
        if (e.target.closest('details, a, button, [data-player-modal]')) return;
        const card = e.target.closest('.dg-card[data-team-key]');
        if (card) location.hash = `draftgrades/${card.dataset.year}/${card.dataset.teamKey}`;
    });

    initPlayerModal();
    loadYear();
}

async function loadYear() {
    const year = currentYear;
    const content = document.getElementById('draftgrades-content');
    content.innerHTML = `<div class="loading-state"><div class="spinner"></div><p>Grading the ${year} homework...</p></div>`;

    try {
        const picks = flattenDraft(_draftCache[year]);
        const [proj, histIndex, bundle] = await Promise.all([
            getSeasonProjections(year), // proiezioni preseason DELL'ANNO DEL DRAFT
            getHistoryIndex(year).catch(() => null),
            getHonorsBundle(year).catch(() => null),
        ]);
        const actualPlayers = bundle?.players || {};
        const seasonPlayed = Object.keys(actualPlayers).length > 0;

        const evaluator = makeEvaluator(proj, histIndex, year);
        const meta = {
            mode: 'proj',
            label: `${year} preseason projections (Rotowire via Sleeper)`,
            proj, seasonPlayed, actualPlayers,
            detailOf: evaluator.detailOf,
        };
        const grades = computeGrades(picks, evaluator.valueOf, meta);
        const pred = await predictSeason(year, grades).catch(() => null);
        // Context Score (SOS+) da nflverse: layer aggiuntivo, NON tocca il voto.
        // Degradazione graceful: se i dati mancano, ctx resta null.
        const model = await attachContextScores(grades, year).catch(() => null);
        // Team Strength Index (TSI): indice di forza della ROSA. Non è una
        // pagella e non entra nel voto: vive nella pagina squadra.
        await evaluateLeague(grades, year).catch((e) => console.warn('[team-eval]', e));

        // Il Draft Grade: un voto solo, per la pick e per la squadra.
        const [adpDisp, calib] = await Promise.all([
            getAdpDispersion(year).catch(() => null),  // ADP di consenso + dispersione (FFC)
            getDraftGradeCalib().catch(() => null),    // soglie-lettera dai quantili storici
        ]);
        const dg = computeDraftGrade(grades, proj, { adpDisp, calib });
        if (currentYear !== year) return;

        content.innerHTML = renderGrades(year, grades, meta, pred, model, dg);
        loadHeadshots(content, year);
        setTimeout(() => console.log(`[draftgrades] pick matchate su proiezioni ${year}: ${evaluator.matched()}/${picks.length}`), 0);
    } catch (e) {
        console.error('[draftgrades]', e);
        content.innerHTML = `<div class="empty-state"><p class="empty-state-text">Error computing the grades</p></div>`;
    }
}

// ─── Motore di valutazione ───────────────────────────────────────

/**
 * Valutatore condiviso (lista + pagina team): proiezione pura per l'attacco,
 * blend calibrato per K/DEF, più il dettaglio storico per la UI.
 */
export function makeEvaluator(proj, histIndex, year) {
    const cache = new Map();
    let matched = 0;
    const parts = (p) => {
        const key = `${p.player}|${p.pos}`;
        if (cache.has(key)) return cache.get(key);
        const hit = matchProjection(proj, p.player, p.pos);
        if (hit) matched++;
        const projValue = hit?.projPts ?? hit?.ptsStd ?? POS_FALLBACK_PROJ[p.pos] ?? 0;
        const hist = histIndex ? histIndex.forPlayer(p.player, p.pos) : null;
        const blend = blendValue(projValue, hist, p.pos);
        const expAtDraft = hit?.rookieYear ? +year - hit.rookieYear : null;
        const out = { ...blend, hist, expAtDraft, risk: riskFlag(hist, expAtDraft) };
        cache.set(key, out);
        return out;
    };
    return {
        valueOf: (p) => parts(p).value,
        detailOf: (p) => parts(p),
        matched: () => matched,
    };
}

export function computeGrades(picks, valueOf, meta) {
    // valore di ogni pick + baseline "draft perfetto"
    const evaluated = picks.map(p => ({ ...p, value: valueOf(p) }));
    const sorted = [...evaluated.map(p => p.value)].sort((a, b) => b - a);
    evaluated.forEach(p => {
        p.expected = sorted[p.pick - 1] ?? 0;
        p.delta = p.value - p.expected;
        const hit = matchProjection(meta.proj, p.player, p.pos);
        p.adp = hit?.adp ?? null;
        p.actual = meta.seasonPlayed ? (meta.actualPlayers[p.player]?.total ?? null) : null;
    });

    const teams = {};
    evaluated.forEach(p => {
        const key = TEAM_KEYS[displayName(p.team)];
        if (!key) return;
        (teams[key] = teams[key] || []).push(p);
    });

    const leaguePosMedian = {};
    POS_ORDER.forEach(pos => {
        const vals = Object.values(teams)
            .map(list => list.filter(p => p.pos === pos).reduce((s, p) => s + p.value, 0))
            .sort((a, b) => a - b);
        leaguePosMedian[pos] = vals.length ? (vals[1] + vals[2]) / 2 : 0; // mediana su 4
    });

    return Object.entries(teams).map(([key, list]) => {
        const total = list.reduce((s, p) => s + p.value, 0);
        const expected = list.reduce((s, p) => s + p.expected, 0);
        const ratio = expected ? total / expected : 0;

        const byPos = POS_ORDER.map(pos => {
            const val = list.filter(p => p.pos === pos).reduce((s, p) => s + p.value, 0);
            const med = leaguePosMedian[pos] || 1;
            const deltaPct = med ? (val - med) / med * 100 : 0;
            return { pos, val, deltaPct, n: list.filter(p => p.pos === pos).length };
        });

        const withValue = list.filter(p => p.value > 0);
        const best = [...withValue].sort((a, b) => b.delta - a.delta)[0] || null;
        const worst = [...list].sort((a, b) => a.delta - b.delta)[0] || null;

        return { key, list: list.sort((a, b) => a.pick - b.pick), total, expected, ratio, byPos, best, worst };
    }).sort((a, b) => b.ratio - a.ratio);
}

/**
 * Valutatore di FINE STAGIONE basato su VOR (Value Over Replacement): il valore
 * di una pick è la produzione REALE sopra il livello di replacement della lega
 * per quel ruolo. Rende comparabili ruoli diversi (300 pt QB ≠ 300 pt WR) e,
 * dato in pasto a computeGrades, produce un voto retrospettivo con la stessa
 * scala del voto post-draft. Richiede la stagione già giocata (actualPlayers).
 */
export function makeVorEvaluator(picks, actualPlayers) {
    const actualOf = (p) => actualPlayers[p.player]?.total ?? null;
    const repl = replacementLevels(
        picks.map(p => ({ pos: p.pos, __v: actualOf(p) ?? 0 })), '__v');
    return {
        valueOf: (p) => { const a = actualOf(p); return a == null ? 0 : Math.max(0, a - (repl[p.pos] || 0)); },
        replacement: repl,
    };
}

/**
 * Resa di FINE STAGIONE: quanto ha prodotto davvero ogni rosa draftata,
 * misurata in VOR reale, e che quota rappresenta sul totale della lega.
 *
 * NON è un voto e non ha una lettera, di proposito. Il Draft Grade giudica le
 * DECISIONI col board di quel giorno; questo dice com'è finita. Dargli una
 * lettera lo trasformerebbe in una seconda pagella che contraddice la prima —
 * era esattamente il difetto del vecchio "FS". Qui resta un numero, in una
 * sezione a parte della pagina squadra.
 * Ritorna null se la stagione non è stata giocata.
 */
export function computeSeasonDelivery(picks, meta) {
    if (!meta.seasonPlayed) return null;
    const vor = makeVorEvaluator(picks, meta.actualPlayers);
    const grades = computeGrades(picks, vor.valueOf, { ...meta, mode: 'vor' });
    const league = grades.reduce((s, g) => s + g.total, 0) || 1;
    const byKey = {};
    grades
        .slice()
        .sort((a, b) => b.total - a.total)
        .forEach((g, i) => {
            byKey[g.key] = {
                vor: Math.round(g.total),
                share: +(g.total / league).toFixed(3),
                rank: i + 1,
            };
        });
    return { grades, byKey, replacement: vor.replacement };
}

export { gradeBand };

/** Badge "com'è andata poi" — confronta produzione reale con la proiezione */
export function outcomeBadge(p) {
    if (p.actual == null || p.value < 15) return '';
    const ratio = p.value > 0 ? p.actual / p.value : (p.actual > 50 ? 99 : 0);
    if (ratio >= 1.35) return `<span class="dg-badge dg-badge--up">breakout</span>`;
    if (ratio <= 0.55) return `<span class="dg-badge dg-badge--down">flop</span>`;
    return '';
}

/** Lettura data-driven della strategia (prime scelte + tempistiche ruoli) */
export function strategyLine(list) {
    const early = list.filter(p => p.round <= 3).map(p => p.pos);
    const count = (pos) => early.filter(x => x === pos).length;
    const firstOf = (pos) => list.find(p => p.pos === pos)?.round ?? null;
    const parts = [];
    if (count('RB') >= 2) parts.push(`RB-heavy start (${count('RB')} RBs in the first 3 rounds)`);
    else if (count('WR') >= 2) parts.push(`receivers first (${count('WR')} WRs in the first 3 rounds)`);
    else parts.push(`balanced start (${early.join(', ') || '—'})`);
    const qbR = firstOf('QB');
    if (qbR) parts.push(qbR <= 3 ? `QB early, round ${qbR}` : qbR >= 8 ? `QB pushed back to round ${qbR}` : `QB in round ${qbR}`);
    const kR = firstOf('K'), dR = firstOf('DEF');
    const earliest = Math.min(kR ?? 99, dR ?? 99);
    if (earliest <= 10) parts.push(`K/DEF taken as early as round ${earliest} — a bold call, to put it kindly`);
    return parts.join(' · ');
}

// ─── Rendering ───────────────────────────────────────────────────

/**
 * Attacca a ogni pick d'attacco il Player Context Score (SOS+) da nflverse.
 * NON modifica value/expected/ratio: le pagelle restano identiche (il modello
 * di regressione non è adottato, vedi build-draft-model.mjs). Aggiunge solo il
 * layer informativo (sub-score, floor/ceiling, bust%). Ritorna il modello.
 */
async function attachContextScores(grades, year) {
    const model = await getDraftModel();
    const OFF = new Set(['QB', 'RB', 'WR', 'TE']);
    const tasks = [];
    for (const g of grades) for (const p of g.list) {
        if (!OFF.has(p.pos)) continue;
        tasks.push(getContextScore({ name: p.player, pos: p.pos, team: p.nfl, year: +year, projValue: p.value })
            .then(ctx => { p.ctx = ctx; }).catch(() => { p.ctx = null; }));
    }
    await Promise.all(tasks);
    for (const g of grades) {
        const cs = g.list.map(p => p.ctx?.contextScore).filter(v => v != null);
        g.sosAvg = cs.length ? Math.round(cs.reduce((a, b) => a + b, 0) / cs.length) : null;
    }
    return model;
}

/** Chip SOS+ (+ badge flop se il modello stima alto rischio). */
function sosChip(ctx) {
    if (!ctx || ctx.contextScore == null) return '';
    const bust = ctx.bustProb != null && ctx.bustProb >= 0.4
        ? ` <span class="dg-bust" title="Model-estimated flop probability (Brier score beats the base rate in 6 of 7 seasons)">flop ${Math.round(ctx.bustProb * 100)}%</span>` : '';
    return `<span class="dg-sos" title="Player Context Score (SOS+): attacco NFL, volume, efficienza, calendario, trend">SOS+ ${ctx.contextScore}</span>${bust}`;
}

function renderGrades(year, grades, meta, pred, model, dg) {
    // ordina le card come la classifica del voto (se il motore ha risposto)
    const ordered = dg
        ? dg.ranking.map(k => grades.find(g => g.key === k)).filter(Boolean)
        : grades;

    const summary = ordered.map((g, i) => {
        const t = TEAMS[g.key];
        const d = dg?.byKey?.[g.key];
        return `
        <div class="dg-sum" style="--team-color:${t.color};--dg-i:${i}">
            <img src="${t.logo}" alt="${t.name}" onerror="this.style.display='none'">
            <span class="dg-sum-name">${t.name}</span>
            ${d ? `<span class="dg-sum-score">${d.grade}<small>/100</small></span>
                   <span class="dg-letter dg-letter--${gradeBand(d.letter)}">${d.letter}</span>` : ''}
        </div>`;
    }).join('');

    const cards = ordered.map((g, i) => teamCard(g, i, year, meta, pred, dg?.byKey?.[g.key])).join('');

    return `
    <div class="dg-summary">${summary}</div>
    ${leagueScatter(dg)}
    ${powerRanking(grades)}
    ${cards}
    ${methodNote(year, meta, pred, model, dg)}`;
}

/**
 * Come si legge il voto: nota metodologica in fondo alla pagina. Dichiara i
 * pesi (che sono una scelta di design, non una taratura) e cosa NON è un voto.
 */
function methodNote(year, meta, pred, model, dg) {
    const w = dg?.weights;
    return `<p class="dg-footnote">
    <b>Draft Grade</b> answers one question: how much of the value you could have captured did each pick actually lock in? A pick is measured against the players realistically in contention at that moment, and against the best of them who would still have been on the board at your next turn — so taking a player who was going to wait for you anyway earns nothing, and passing on one who was about to disappear costs. That baseline is what removes the round effect: the first and the fifteenth round sit on the same scale.
    ${w ? `The team grade combines <b>talent</b> (${Math.round(w.talent * 100)}%) — value above replacement in the best possible lineup — with <b>draft efficiency</b> (${Math.round(w.efficiency * 100)}%), the draft-capital-weighted average of the pick grades. Those weights are a stated design choice: across 2019-2025 talent tracks real scoring far better than efficiency does, so it leads.` : ''}
    Letter thresholds are the empirical quantiles of every pick and every team draft since 2019, not invented cut-offs${dg && !dg.calibrated ? ' (defaults in use: the calibration file is missing)' : ''}.
    Values come from ${meta.label}${year === '2019' ? ', with no ADP available for 2019: survival is estimated from projected value alone' : ', with real consensus ADP and its dispersion behind every survival estimate'}. For kicker and defense the value also weighs recent real production (60% and 35%): across the 419 picks from 2019-2025 this markedly improves the forecast, while for offense projections beat every historical metric. History remains the best risk signal though: declining veterans with 6+ years have flopped 36% of the time (league average 10%).
    ${meta.seasonPlayed ? 'The "breakout"/"flop" badges compare the projection with the production actually delivered — a comparison, not a second grade.' : ''}
    ${pred ? `Forecasts and Super Bowl odds: Monte Carlo across ${fmt0(pred.iterations)} seasons simulated from the draft values — optimal lineup week by week${pred.byesKnown ? ' with real NFL bye weeks' : ' (bye weeks not available for this season)'}, league schedule, playoffs 1st-4th and 2nd-3rd, weekly per-player variability.` : ''}
    ${model ? '<b>SOS+</b> (Player Context Score) and <b>TSI</b> (Team Strength Index) are context indices, not grades: they live on the team page, below the grade, and never change it.' : ''}
    </p>`;
}

/**
 * Talento × efficienza: dove nasce il voto (stile NYT).
 *
 * Uno scatter con le mediane come assi e i quadranti etichettati, così si legge
 * a colpo d'occhio SE sei in alto per talento raccolto o per come hai giocato
 * il board. È il modo di mostrare i due assi senza farne due pagelle: il voto
 * resta uno, questo spiega da dove viene.
 */
function leagueScatter(dg) {
    if (!dg?.ranking?.length) return '';
    const teams = dg.ranking.map(k => dg.byKey[k]);
    const W = 660, H = 380, L = 62, R = 128, T = 40, B = 52;
    const iw = W - L - R, ih = H - T - B;

    // dominio guidato dai dati, con margine, ma sempre comprensivo della media
    // di lega (50): le due linee tratteggiate sono il riferimento, devono stare
    // dentro il grafico anche quando la lega è tutta sbilanciata da una parte.
    const domain = (vals) => {
        const lo = Math.min(...vals, 50), hi = Math.max(...vals, 50);
        const pad = Math.max(8, (hi - lo) * 0.22);
        return [Math.max(0, lo - pad), Math.min(100, hi + pad)];
    };
    const [ex0, ex1] = domain(teams.map(t => t.components.efficiency));
    const [ty0, ty1] = domain(teams.map(t => t.components.talent));
    const sx = (v) => L + (v - ex0) / (ex1 - ex0) * iw;
    const sy = (v) => T + ih - (v - ty0) / (ty1 - ty0) * ih;

    // etichette dirette, scostate quando si sovrappongono (stessa tecnica delle
    // fine-linea nel grafico settimanale): il testo si allontana in verticale e
    // una linea guida lo ricollega al punto.
    const pts = teams.map(t => ({
        t, tm: TEAMS[t.key],
        x: sx(t.components.efficiency),
        y: sy(t.components.talent),
    })).sort((a, b) => a.y - b.y);
    pts.forEach(p => { p.ly = p.y; });
    for (let i = 1; i < pts.length; i++) {
        if (pts[i].ly - pts[i - 1].ly < 42) pts[i].ly = pts[i - 1].ly + 42;
    }

    const dots = pts.map(p => {
        const flip = p.x > L + iw * 0.72;           // vicino al bordo: etichetta a sinistra
        const tx = flip ? p.x - 15 : p.x + 15;
        const anchor = flip ? 'end' : 'start';
        const lead = Math.abs(p.ly - p.y) > 3
            ? `<line class="dg-scat-lead" x1="${p.x.toFixed(1)}" y1="${p.y.toFixed(1)}" x2="${tx.toFixed(1)}" y2="${(p.ly - 4).toFixed(1)}"/>` : '';
        return `
        <g class="dg-scat-pt">
            ${lead}
            <circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="8.5" fill="${p.tm.color}" stroke="var(--bg-primary,#000)" stroke-width="2"/>
            <text class="dg-scat-name" x="${tx.toFixed(1)}" y="${(p.ly - 3).toFixed(1)}" text-anchor="${anchor}" fill="${p.tm.color}">${p.tm.name}</text>
            <text class="dg-scat-sub" x="${tx.toFixed(1)}" y="${(p.ly + 11).toFixed(1)}" text-anchor="${anchor}">${p.t.letter} · ${p.t.grade}/100</text>
        </g>`;
    }).join('');

    // le etichette di quadrante compaiono solo se quel quadrante è visibile
    const q = [];
    if (ty1 > 50) {
        q.push(`<text class="dg-scat-quad dg-scat-quad--good" x="${L + iw - 6}" y="${T - 20}" text-anchor="end">EARNED IT</text>
                <text class="dg-scat-quadsub" x="${L + iw - 6}" y="${T - 8}" text-anchor="end">strong roster, well drafted</text>`);
        q.push(`<text class="dg-scat-quad" x="${L + 6}" y="${T - 20}">LUCKED INTO IT</text>
                <text class="dg-scat-quadsub" x="${L + 6}" y="${T - 8}">strong roster, loose draft</text>`);
    }
    if (ty0 < 50) {
        q.push(`<text class="dg-scat-quad" x="${L + iw - 6}" y="${T + ih + 18}" text-anchor="end">WELL PLAYED, THIN</text>`);
        q.push(`<text class="dg-scat-quad dg-scat-quad--bad" x="${L + 6}" y="${T + ih + 18}">MISSED ON BOTH</text>`);
    }

    return `
    <section class="mosaic-card mc-wide dg-ranking mc-in">
        <span class="mc-kicker">Where the grade comes from</span>
        <h2 class="mc-title">Talent collected vs draft efficiency</h2>
        <div class="dg-rk-wrap">
        <svg class="dg-scat-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Talent against draft efficiency, one dot per team">
            <rect class="dg-scat-plot" x="${L}" y="${T}" width="${iw}" height="${ih}"/>
            <line class="dg-scat-guide" x1="${sx(50).toFixed(1)}" y1="${T}" x2="${sx(50).toFixed(1)}" y2="${T + ih}"/>
            <line class="dg-scat-guide" x1="${L}" y1="${sy(50).toFixed(1)}" x2="${L + iw}" y2="${sy(50).toFixed(1)}"/>
            <text class="dg-scat-avg" x="${(sx(50) + 5).toFixed(1)}" y="${T + 12}">league average</text>
            ${q.join('')}
            ${dots}
            <text class="dg-scat-axis" x="${L + iw / 2}" y="${H - 12}" text-anchor="middle">Draft efficiency →</text>
            <text class="dg-scat-axis" x="${-(T + ih / 2)}" y="16" text-anchor="middle" transform="rotate(-90)">Talent collected →</text>
        </svg>
        </div>
        <p class="an-footnote">Talent: how far the best lineup each draft could field sits above a replacement-level starting nine, as a share of the league. Efficiency: the draft-capital-weighted average of the pick grades. The grade weighs talent ${Math.round((dg.weights?.talent ?? 0.6) * 100)}% and efficiency ${Math.round((dg.weights?.efficiency ?? 0.4) * 100)}%, so two teams can land on the same letter from opposite corners.</p>
    </section>`;
}

/**
 * Classifica di forza (totale e per reparto) dai valori del draft.
 * Rank 1ª-4ª per colonna; righe ordinate per valore totale.
 */
function powerRanking(grades) {
    if (grades.length < 2) return '';
    const byTotal = [...grades].sort((a, b) => b.total - a.total);
    const rankOf = {}; // colonna → { teamKey → rank }
    rankOf.total = Object.fromEntries(byTotal.map((g, i) => [g.key, i + 1]));
    POS_ORDER.forEach(pos => {
        const sorted = [...grades].sort((a, b) =>
            (b.byPos.find(x => x.pos === pos)?.val || 0) - (a.byPos.find(x => x.pos === pos)?.val || 0));
        rankOf[pos] = Object.fromEntries(sorted.map((g, i) => [g.key, i + 1]));
    });

    const chip = (rank) => `<span class="dg-rank dg-rank--${rank}">${rank}${rank === 1 ? 'st' : rank === 2 ? 'nd' : rank === 3 ? 'rd' : 'th'}</span>`;
    const rows = byTotal.map(g => {
        const t = TEAMS[g.key];
        const cells = POS_ORDER.map(pos => {
            const val = g.byPos.find(x => x.pos === pos)?.val || 0;
            return `<td>${chip(rankOf[pos][g.key])} <small>${fmt0(val)}</small></td>`;
        }).join('');
        return `
        <tr style="--team-color:${t.color}">
            <td class="dg-rk-team"><img src="${t.logo}" alt="" onerror="this.style.display='none'">${t.name}</td>
            <td class="dg-rk-total">${chip(rankOf.total[g.key])} <b>${fmt0(g.total)} pt</b></td>
            ${cells}
        </tr>`;
    }).join('');

    return `
    <section class="mosaic-card mc-wide dg-ranking mc-in">
        <span class="mc-kicker">Roster strength ranking · from draft values</span>
        <div class="dg-rk-wrap">
            <table class="dg-rk-table">
                <thead><tr><th>Team</th><th>Total</th>${POS_ORDER.map(p => `<th>${p}</th>`).join('')}</tr></thead>
                <tbody>${rows}</tbody>
            </table>
        </div>
        <p class="an-footnote">Projected points collected at the draft, total and by position (1st = strongest position in the league).</p>
    </section>`;
}

/**
 * Card di una squadra. Gerarchia: il voto, poi i NUMERI che lo spiegano, poi
 * la frase. Nessun indicatore di supporto porta una lettera.
 */
function teamCard(g, rank, year, meta, pred, d) {
    const t = TEAMS[g.key];

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

    // metriche di supporto: numeri, con il rango di lega accanto
    const support = d ? `
        <div class="dg-support">
            <div class="dg-support-item">
                <span class="dg-support-label">Talent collected</span>
                <span class="dg-support-val">${fmt0(d.components.starterVOR)}<small> VOR</small></span>
                <span class="dg-support-rank">${ordinal(d.components.talentRank)} in league · in the best lineup</span>
            </div>
            <div class="dg-support-item">
                <span class="dg-support-label">Draft efficiency</span>
                <span class="dg-support-val">${d.components.efficiencyGrade}<small>/100</small></span>
                <span class="dg-support-rank">${ordinal(d.components.efficiencyRank)} in league</span>
            </div>
            <div class="dg-support-item">
                <span class="dg-support-label">Value in the starters</span>
                <span class="dg-support-val">${Math.round(d.components.starterShare * 100)}<small>%</small></span>
                <span class="dg-support-rank">of everything drafted</span>
            </div>
        </div>` : '';

    const pickBox = (p, kind) => {
        if (!p) return '';
        const r = d?.picks?.find(x => x.pick === p.pick) || null;
        const title = kind === 'best' ? 'Best decision' : 'Weakest decision';
        const det = meta.detailOf?.(p);
        const histRow = det?.hist?.seasons?.length
            ? `<span class="dg-pick-hist">${historyLine(det.hist, p.pos)} ${trendBadge(det.hist)}</span>` : '';
        return `
        <div class="dg-pick dg-pick--${kind}" data-player-modal
             data-player-name="${p.player}" data-pos="${p.pos}" data-nfl="${p.nfl || ''}" data-year="${year}">
            <img class="dg-headshot" src="images/fallback-player.svg" alt="${p.player}"
                 data-player-name="${p.player}" data-team="${p.nfl}" data-pos="${p.pos}">
            <div class="dg-pick-info">
                <span class="dg-pick-kind">${title}</span>
                <span class="dg-pick-name">${p.player} <small>${p.pos}${p.nfl ? ` · ${p.nfl}` : ''}</small></span>
                <span class="dg-pick-meta">pick #${p.pick} · round ${p.round}${r ? ` · ${r.grade}/100` : ''}</span>
                <span class="dg-pick-val">${fmt0(p.value)} pt ${det?.wHist ? 'expected (projection + history)' : 'projected'}${r ? ` <small>${r.survivalBand === 'gone' ? 'would have been gone next turn' : r.survivalBand === 'lasted' ? 'would have lasted to your next turn' : r.survivalBand === 'tossup' ? 'a coin flip to last' : ''}</small>` : ''}</span>
                ${p.ctx ? `<span class="dg-pick-sos">${sosChip(p.ctx)}${p.ctx.floor != null ? ` <small>range ${fmt0(p.ctx.floor)}–${fmt0(p.ctx.ceiling)}</small>` : ''}</span>` : ''}
                ${histRow}
                ${p.actual != null ? `<span class="dg-pick-actual">then: ${fmt0(p.actual)} real pt ${outcomeBadge(p)}</span>` : ''}
            </div>
        </div>`;
    };

    const rows = g.list.map(p => {
        const det = meta.detailOf?.(p);
        const risk = det?.risk?.level === 'alto'
            ? `<span class="dg-risk" title="${det.risk.label}">!</span>` : '';
        const r = d?.picks?.find(x => x.pick === p.pick) || null;
        return `
        <div class="dg-row" data-player-modal
             data-player-name="${p.player}" data-pos="${p.pos}" data-nfl="${p.nfl || ''}" data-year="${year}">
            <span class="dg-row-pick">#${p.pick}</span>
            <span class="allpro-pos pos-${p.pos.toLowerCase().replace('/', '')}">${p.pos}</span>
            <span class="dg-row-name">${p.player}${risk}</span>
            <span class="dg-row-val">${fmt0(p.value)}</span>
            ${r ? `<span class="dg-row-grade dg-letter--${gradeBand(r.letter)}">${r.letter}</span>` : ''}
            ${p.ctx?.contextScore != null ? `<span class="dg-row-sos" title="Player Context Score (SOS+)">SOS+ ${p.ctx.contextScore}</span>` : ''}
            ${det?.hist ? trendBadge(det.hist) : ''}
            ${outcomeBadge(p)}
        </div>`;
    }).join('');

    return `
    <article class="mosaic-card mc-wide dg-card mc-in" data-team-key="${g.key}" data-year="${year}" style="--team-color:${t.color};--card-glow:${t.color}">
        <header class="dg-head">
            <img class="dg-head-logo" src="${t.logo}" alt="${t.name}" onerror="this.style.display='none'">
            <div class="dg-head-info">
                <h2 class="mc-title">${t.name}</h2>
                <span class="dg-head-meta">${d ? `${ordinal(d.rank)} draft in the league · ` : ''}${fmt0(g.total)} points projected at the draft</span>
                ${d ? `<p class="dg-why">${d.why}</p>` : ''}
                <span class="dg-cta">Full draft analysis →</span>
            </div>
            ${d ? `<div class="dg-grade-stack">
                <span class="dg-letter dg-letter--big dg-letter--${gradeBand(d.letter)}">${d.letter}</span>
                <span class="dg-grade-score">${d.grade}<small>/100</small></span>
            </div>` : ''}
        </header>
        ${support}
        <div class="dg-body">
            <div class="dg-col">
                <span class="mc-kicker">Positions vs league median</span>
                <div class="dg-bars">${bars}</div>
                <span class="mc-kicker">Strategy</span>
                <p class="dg-strategy">${strategyLine(g.list)}</p>
            </div>
            <div class="dg-col">
                ${pickBox(d?.bestPick ? g.list.find(p => p.pick === d.bestPick.pick) : g.best, 'best')}
                ${pickBox(d?.worstPick ? g.list.find(p => p.pick === d.worstPick.pick) : g.worst, 'worst')}
                <details class="dg-details">
                    <summary>All ${g.list.length} picks</summary>
                    <div class="dg-rows">${rows}</div>
                </details>
            </div>
        </div>
        ${predStrip(pred, g.key)}
    </article>`;
}

/** Striscia pronostico in fondo alla card: record previsto e chance Super Bowl. */
function predStrip(pred, teamKey) {
    const p = pred?.byTeam?.[teamKey];
    if (!p) return '';
    return `
    <div class="dg-pred">
        <div class="dg-pred-item">
            <span class="dg-pred-label">Season forecast</span>
            <span class="dg-pred-value">${p.record}</span>
            <small>${fmt1(p.expW)} expected wins out of ${pred.weeks}</small>
        </div>
        <div class="dg-pred-item">
            <span class="dg-pred-label">Projected average</span>
            <span class="dg-pred-value">${fmt1(p.muAvg)} pt</span>
            <small>per week, byes included</small>
        </div>
        <div class="dg-pred-item dg-pred-item--sb">
            <span class="dg-pred-label">Super Bowl odds</span>
            <span class="dg-pred-value">${p.sbPct}%</span>
            <span class="dg-pred-bar"><span style="width:${Math.min(100, p.sbPct)}%"></span></span>
        </div>
    </div>`;
}

/** Headshot async (stesso pattern di draft/analisi) */
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
