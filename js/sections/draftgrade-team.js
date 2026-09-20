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

import { fetchDraftData, flattenDraft, fetchFantasyData, getSeasonConfig, displayName } from '../data.js?v=594';
import { TEAM_KEYS } from '../data/team-config.js?v=535';
import { TEAMS } from './team.js?v=822';
import { decorateTerms } from '../ui/glossary.js?v=4';
import { getHonorsBundle } from '../data/honors.js?v=724';
import { getSeasonProjections, getSeasonStats, matchProjection } from '../data/projections.js?v=611';
import { getHistoryIndex, trendBadge, historyLine, peakNote } from '../data/player-history.js?v=595';
import { initPlayerModal } from '../components/player-modal.js?v=771';
import { playerImageService } from '../services/player-image-service.js?v=532';
import { pickSeeded } from '../data/magazine-voices.js?v=519';
import {
    computeGrades, makeEvaluator, gradeBand, strategyLine,
    outcomeBadge, computeSeasonDelivery,
} from './draftgrades.js?v=813';
import { getContextScore, getDraftModel, FIXED_WEIGHTS } from '../data/context-score.js?v=683';
import { evaluateLeague, TSI_WEIGHTS, TSI_LABELS, pickStarters, replacementLevels } from '../data/team-eval.js?v=596';
import { computeDraftGrade, getAdpDispersion, getDraftGradeCalib, pickWhy } from '../data/draft-grade.js?v=65';

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
    const subAvg = {}, dimWho = {};
    for (const d of SOS_DIMS) {
        const rows = withCtx
            .map(p => ({ name: p.player, pos: p.pos, nfl: p.nfl, v: p.ctx.subScores?.[d] }))
            .filter(r => r.v != null)
            .sort((a, b) => b.v - a.v);
        subAvg[d] = rows.length ? Math.round(rows.reduce((a, r) => a + r.v, 0) / rows.length) : null;
        // il perché di una dimensione è sempre un giocatore: chi la tiene su e
        // chi la tira giù, con quanti la compongono (i rookie non hanno volume
        // né efficienza, e la media di 3 non è la media di 8)
        dimWho[d] = rows.length ? { best: rows[0], worst: rows[rows.length - 1], n: rows.length } : null;
    }
    /* Il numero grande è la somma pesata DELLE BARRE, non la media dei SOS+
       dei singoli. Prima erano due conti diversi — 67 in cima e 68,7 sommando
       le otto barre — perché nel punteggio del giocatore una dimensione
       mancante vale 50, mentre nella media per dimensione quel giocatore è
       escluso. Chi provava a rifare il conto non lo ritrovava. */
    let num = 0, den = 0;
    for (const [d, w] of Object.entries(FIXED_WEIGHTS)) {
        if (subAvg[d] == null) continue;
        num += w * subAvg[d]; den += w;
    }
    const sosAvg = den ? +(num / den).toFixed(1) : null;
    const playerAvg = withCtx.length ? +(withCtx.reduce((s, p) => s + p.ctx.contextScore, 0) / withCtx.length).toFixed(1) : null;
    return { model, sosAvg, playerAvg, subAvg, dimWho, n: withCtx.length };
}

/** Cosa significa una dimensione, e quale fatto la spiega. */
const SOS_MEANS = {
    teamOffense: 'how good the NFL offense around him is',
    volume: 'how much of his offense goes through him',
    efficiency: 'what he does with the touches he gets',
    schedule: 'how hard the defenses he faces are, for his position',
    playoff: 'the same, but only in the league’s playoff weeks',
    trend: 'which way his production has been going',
    ageCurve: 'where he sits on the age curve for his position',
    durability: 'games played over the last three seasons',
};

/** Card SOS+: profilo del roster (media sub-score attacco) + rischi flop. */
function sosCard(ctx) {
    const { sos, g } = ctx;
    if (!sos || sos.sosAvg == null) return '';

    const live = SOS_DIMS.filter(d => sos.subAvg[d] != null);
    const den = live.reduce((s, d) => s + FIXED_WEIGHTS[d], 0) || 1;
    const rows = live.map(d => ({
        d, v: sos.subAvg[d], w: FIXED_WEIGHTS[d] / den,
        contrib: (FIXED_WEIGHTS[d] / den) * (sos.subAvg[d] - 50),
    })).sort((a, b) => b.contrib - a.contrib);

    // stessa griglia del TSI: barra divergente dal 50, contributo, e sotto il
    // giocatore che quella dimensione la porta e quello che la affossa
    const bars = rows.map(({ d, v, contrib }) => {
        const cls = contrib >= 0.5 ? ' up' : contrib <= -0.5 ? ' down' : '';
        const who = sos.dimWho?.[d];
        const why = who
            ? `${SOS_MEANS[d]} · best <b>${who.best.name}</b> (${who.best.v})${who.worst && who.worst.name !== who.best.name ? ` · worst <b>${who.worst.name}</b> (${who.worst.v})` : ''}${who.n < sos.n ? ` · ${who.n} of ${sos.n} players have this` : ''}`
            : SOS_MEANS[d];
        const half = Math.min(Math.abs(v - 50), 50);
        return `
        <div class="dgt-comp${cls}">
            <span class="dgt-comp-label">${SOS_LABELS[d]}<em>${Math.round(FIXED_WEIGHTS[d] * 100)}%</em></span>
            <span class="dgt-comp-track">
                <i class="dgt-comp-fill ${v >= 50 ? 'up' : 'down'}" style="${v >= 50 ? 'left:50%' : 'right:50%'};width:${half.toFixed(1)}%"></i>
                <u class="dgt-comp-mid"></u>
            </span>
            <span class="dgt-comp-score">${v}</span>
            <span class="dgt-comp-contrib">${contrib > 0 ? '+' : contrib < 0 ? '−' : ''}${Math.abs(contrib).toFixed(1)}</span>
            <div class="dgt-comp-why">${why}</div>
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

    const delta = sos.sosAvg - 50;
    const best = rows[0], worst = rows[rows.length - 1];

    return `
    <div class="mosaic-card mc-wide dgt-card mc-in">
        <span class="mc-kicker">Context beyond the projections · advanced NFL data (nflverse)</span>
        <h2 class="mc-title">Player Context Score <small class="dgt-sos-big">roster profile ${sos.sosAvg}</small></h2>
        ${explain(`Everything around the player that a point projection doesn't see, on a 0-100 scale built from the
            previous season's percentiles: the quality of his NFL offense, expected volume, efficiency, how hard his
            schedule is <i>for his position</i>, the playoff weeks, trend, age curve and durability. It doesn't touch
            the grade — it explains it, and it produces the flop probability.`)}
        <p class="dgt-tsi-eq">The average offensive player scores <b>50</b> on each dimension. This roster's profile is
            <b>${sos.sosAvg}</b>: <span class="${delta >= 0 ? 'up' : 'down'}">${delta >= 0 ? '+' : '−'}${Math.abs(delta).toFixed(1)}</span>,
            the weighted sum of the ${rows.length} dimensions below over ${sos.n} offensive player${sos.n === 1 ? '' : 's'}.
            ${best && worst && best !== worst ? `<b>${SOS_LABELS[best.d]}</b> carries it, <b>${SOS_LABELS[worst.d]}</b> ${worst.contrib < 0 ? 'drags it down' : 'adds the least'}.` : ''}
            ${sos.playerAvg != null ? `Averaging the players' own SOS+ instead gives ${sos.playerAvg} — the two differ when a rookie has no history on some dimension.` : ''}</p>
        <div class="dgt-comps">${bars}</div>
        ${notes}
        <p class="dgt-card-sub">Percentiles against every NFL player at the same position in the previous season, so 50 is that league-wide median, not this fantasy league's. Reference weights are fixed; the model confirms the value projections and adds the flop probability. It never touches the grade.</p>
    </div>`;
}

// ─── Team Strength Index (valutazione della rosa) ────────────────

const ofFour = (rank) => `<b>${ordinal(rank)}</b> of 4`;

/**
 * Il PERCHÉ di una componente del TSI, in una riga.
 *
 * È il pezzo che mancava: un sotto-punteggio è verificabile solo se accanto
 * c'è il fatto che lo produce. "Positional advantage 42" non dice niente;
 * "RB2 e TE ultimi di quattro" dice tutto, e chiunque può controllarlo
 * guardando le altre tre squadre. I fatti arrivano già pronti da
 * team-eval.js (g.tsiWhy): qui si scrivono solo le frasi.
 */
function tsiDriver(k, why, sub) {
    const w = why?.[k];
    if (!w) return '';
    switch (k) {
        case 'projection':
            return `${fmt0(w.total)} projected pt across the whole roster · ${ofFour(w.rank)}${w.rank > 1 ? `, ${fmt0(w.leagueBest - w.total)} behind the best` : ' in the league'}`;
        case 'starter':
            return `${fmt0(w.total)} pt in the best starting nine · ${ofFour(w.rank)}${w.rank > 1 ? `, ${fmt0(w.leagueBest - w.total)} behind the best` : ' in the league'}`;
        case 'posAdv': {
            // qui il perché è slot per slot: la striscia dice dove sei forte e
            // dove perdi, e i due slot peggiori si nominano per esteso
            const strip = w.slots.map(s => `
                <span class="dgt-slot dgt-slot--r${s.rank}" title="${s.player ? `${s.player} · ` : ''}${fmt0(s.value)} pt · ${ordinal(s.rank)} of 4">
                    <i>${s.slot}</i><b>${s.rank}</b></span>`).join('');
            const bad = w.slots.filter(s => s.rank >= 3).sort((a, b) => b.gapToBest - a.gapToBest).slice(0, 2);
            const good = w.slots.filter(s => s.rank === 1);
            const parts = [];
            if (bad.length) parts.push(`losing at ${bad.map(s => `<b>${s.slot}</b> (${ordinal(s.rank)}, −${fmt0(s.gapToBest)} pt vs the best)`).join(' and ')}`);
            if (good.length) parts.push(`best in the league at ${good.map(s => `<b>${s.slot}</b>`).join(', ')}`);
            return `<span class="dgt-slots">${strip}</span>${parts.length ? `<span class="dgt-why-line">${parts.join(' · ')}</span>` : ''}`;
        }
        case 'vor':
            return `${fmt0(w.total)} pt above the league replacement line · ${ofFour(w.rank)}`;
        case 'bench':
            return w.top.length
                ? `best bench piece ${w.top.map(t => `<b>${t.name}</b> (${t.pos}, ${fmt0(t.value)} pt)`).join(', ')} · ${w.count} on the bench, each one counted 45% less than the one before`
                : `nothing on the bench`;
        case 'risk':
            return `average bust risk of the starters <b>${w.teamRisk}/100</b>${w.worst?.length ? ` · riskiest ${w.worst.map(x => `<b>${x.name}</b> (${x.risk}${x.bust != null ? `, ${Math.round(x.bust * 100)}% flop` : ''})`).join(', ')}` : ''}`;
        case 'balance': {
            const POS_ORDER = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];
            const counts = POS_ORDER.filter(pos => w.counts[pos])
                .map(pos => `${w.counts[pos]} ${pos}`).join(' · ');
            const issues = w.issues.map(i => `<b>−${i.cost.toFixed(1)}</b> ${i.kind === 'short' ? `only ${i.n} ${i.pos} against a target of ${i.target}` : `${i.n} ${i.pos}, ${i.n - i.target} more than needed`}`);
            if (w.sameTeam) issues.push(`<b>−${w.sameTeam.cost.toFixed(1)}</b> ${w.sameTeam.n} players from ${w.sameTeam.abbr}`);
            return `${counts}${issues.length ? ` · ${issues.join(' · ')}` : ' · every position on target, no penalty'}`;
        }
        case 'context':
            return w.best
                ? `best NFL offense around him: <b>${w.best.name}</b> (${w.best.nfl || w.best.pos} ${w.best.score})${w.worst ? ` · worst: <b>${w.worst.name}</b> (${w.worst.nfl || w.worst.pos} ${w.worst.score})` : ''}`
                : `no NFL context data for these starters`;
        case 'bye':
            if (!w.known) return `the NFL schedule for this season isn't available`;
            return w.clashes.length
                ? w.clashes.map(c => `<b>week ${c.week}</b>: ${c.names.join(' and ')} both out (<b>−${fmt0(c.cost)}</b>)`).join(' · ')
                : `no two starters at the same position share a bye week`;
        case 'stack':
            return w.pairs.length
                ? w.pairs.map(p => `<b>${p.qb}</b> throwing to ${p.mates.join(' and ')} (${p.nfl})`).join(' · ')
                : `${w.qbs.length ? `<b>${w.qbs.map(q => q.name).join(', ')}</b> has no receiver of his own on the roster` : 'no starting QB'} — no stack, the neutral 50`;
        case 'consistency':
            return w.best
                ? `steadiest <b>${w.best.name}</b> (${w.best.score})${w.worst ? ` · shakiest <b>${w.worst.name}</b> (${w.worst.score})` : ''} — games played and week-to-week swing`
                : `no game logs for these starters`;
        case 'ceiling':
            return `${fmt0(w.total)} pt of ceiling for the same nine starters that project ${fmt0(w.starterValue)} · ${ofFour(w.rank)}`;
        default:
            return '';
    }
}

/**
 * Card Team Strength: il TSI (0-100) e le sue componenti. Valuta la ROSA
 * (titolari, profondità, bilanciamento, scarsità, rischio, bye, stack,
 * contesto), non la somma delle pick. Indice di lettura, pesi di design.
 *
 * Tre scelte di lettura, tutte contro lo stesso difetto — «da dove esce
 * questo numero?»:
 *  1. la barra è DIVERGENTE dal 50 (roster medio), non piena da sinistra:
 *     così "52" si vede che è nulla e "92" si vede che è tanto;
 *  2. accanto c'è il CONTRIBUTO (peso × scarto dal 50), e la somma dei
 *     dodici contributi è esattamente TSI − 50: il conto si chiude a schermo;
 *  3. sotto ogni riga c'è il FATTO che l'ha prodotta (tsiDriver).
 * L'ordine è per contributo: in cima cosa ti tiene su, in fondo cosa ti tira giù.
 */
function teamStrengthCard(ctx) {
    const { g } = ctx;
    if (g.tsi == null) return '';

    // peso effettivo: le componenti mancanti (es. bye senza calendario) sono
    // escluse e i pesi rimanenti rinormalizzati — come fa il motore, se no i
    // contributi non sommerebbero a TSI − 50
    const live = Object.keys(TSI_WEIGHTS).filter(k => g.tsiSub?.[k] != null);
    const den = live.reduce((s, k) => s + TSI_WEIGHTS[k], 0) || 1;
    const rows = live.map(k => {
        const v = g.tsiSub[k];
        // il contributo si calcola sul valore NON arrotondato (tsiSubRaw), se
        // no dodici arrotondamenti a intero spostano la somma di mezzo punto
        const raw = g.tsiSubRaw?.[k] ?? v;
        return { k, v, w: TSI_WEIGHTS[k] / den, contrib: (TSI_WEIGHTS[k] / den) * (raw - 50) };
    }).sort((a, b) => b.contrib - a.contrib);

    const missing = Object.keys(TSI_WEIGHTS).filter(k => g.tsiSub?.[k] == null);
    const delta = g.tsi - 50;

    const bar = (v) => {
        // divergente: metà track a sinistra del 50, metà a destra
        const half = Math.min(Math.abs(v - 50), 50) / 100 * 100;
        return `<span class="dgt-comp-track">
            <i class="dgt-comp-fill ${v >= 50 ? 'up' : 'down'}" style="${v >= 50 ? 'left:50%' : `right:50%`};width:${half.toFixed(1)}%"></i>
            <u class="dgt-comp-mid"></u>
        </span>`;
    };

    const comps = rows.map(({ k, v, contrib }) => {
        const cls = contrib >= 0.4 ? ' up' : contrib <= -0.4 ? ' down' : '';
        const why = tsiDriver(k, g.tsiWhy, v);
        return `
        <div class="dgt-comp${cls}">
            <span class="dgt-comp-label">${TSI_LABELS[k]}<em>${Math.round(TSI_WEIGHTS[k] * 100)}%</em></span>
            ${bar(v)}
            <span class="dgt-comp-score">${v}</span>
            <span class="dgt-comp-contrib">${contrib > 0 ? '+' : contrib < 0 ? '−' : ''}${Math.abs(contrib).toFixed(1)}</span>
            ${why ? `<div class="dgt-comp-why">${why}</div>` : ''}
        </div>`;
    }).join('');

    const top = rows[0], bottom = rows[rows.length - 1];

    return `
    <div class="mosaic-card mc-wide dgt-card mc-in">
        <span class="mc-kicker">How strong is the roster · roster evaluation</span>
        <h2 class="mc-title">Team Strength Index <small class="dgt-sos-big dgt-tsi-big">TSI ${g.tsi}${g.tsiRank ? ` · ${ordinal(g.tsiRank)} in league` : ''}</small></h2>
        ${explain(`A 0-100 read of the <b>roster</b>, not of the picks: 50 is an average roster in this league. It
            answers a different question from the grade — not "did you draft well" but "how strong is what you now
            own" — and for that reason it <b>never changes the grade</b>. Its weights are declared design choices.`)}
        <p class="dgt-tsi-eq">An average roster scores <b>50</b>. This one is <b>${g.tsi}</b>:
            <span class="${delta >= 0 ? 'up' : 'down'}">${delta >= 0 ? '+' : '−'}${Math.abs(delta).toFixed(1)}</span>,
            and the ${rows.length} numbers below are where that comes from — each is its weight times its distance
            from 50, and, rounding aside, they add up to that ${delta >= 0 ? '+' : '−'}${Math.abs(delta).toFixed(1)}.
            ${top && bottom && top !== bottom ? `<b>${TSI_LABELS[top.k]}</b> lifts it most, <b>${TSI_LABELS[bottom.k]}</b> ${bottom.contrib < 0 ? 'costs it most' : 'adds the least'}.` : ''}</p>
        <div class="dgt-comps">${comps}</div>
        ${missing.length ? `<p class="dgt-card-sub">Not measurable this season, and left out of the weighting: ${missing.map(k => TSI_LABELS[k]).join(', ')}.</p>` : ''}
        <p class="dgt-card-sub">Scores are 0-100 with 50 = average: the relative ones (projection, starters, scarcity, bench, upside, positional advantage) compare the four teams of this league, the others (risk, construction, bye, stack, consistency, NFL context) are absolute. The index is read-only — design weights, and the official grade <b>does not</b> change.</p>
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

    // i termini si marcano DOPO il disegno: lavorano sul testo, non sulle stringhe
    bindMetrics(section);
    bindLadder(section);
    bindSlices(section);
    decorateTerms(section);
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
/* ─── La scala del voto ──────────────────────────────────────────────
   Il voto è una somma pesata di due cose, e finora quella somma era una
   frase dentro un <details> chiuso. Qui è una figura sempre a schermo:

     · la barra piena è il voto mentre si costruisce — primo segmento
       talento × 0,6, secondo efficienza × 0,4, quindi la LUNGHEZZA di ogni
       segmento È la moltiplicazione;
     · sopra, le fasce delle lettere alle loro soglie vere (quantili di tutti
       i draft dal 2019): dove finisce la barra si legge la lettera, e si vede
       quanto manca a quella dopo — "perché B+ e non A−" smette di essere una
       cosa da prendere per buona;
     · sotto, le altre tre squadre: il "2° in lega" diventa una distanza.

   Nessun numero da sommare a mente e nessun punteggio interno stampato: il
   solo numero grande resta il voto (.grade), come da regola. */
const LAD = { w: 860, h: 146, l: 14, r: 14 };

/** Scudo per i `<title>` SVG: i nomi contengono apostrofi (Ja'Marr) e "&". */
const esc = (t) => String(t).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

/** I nove titolari con il loro VOR sopra il replacement, dal più pesante. */
function starterRows(ctx) {
    const { g, grades } = ctx;
    if (!g.starters?.length) return [];
    const repl = teamReplacement(grades);
    return g.starters
        .map(p => ({ p, vor: Math.max(0, (p.value || 0) - (repl[p.pos] || 0)) }))
        .sort((a, b) => b.vor - a.vor);
}

function scoreLadder(ctx) {
    const { dg, dgAll, team, teamKey } = ctx;
    const thr = dgAll?.thresholds?.team;
    if (!thr?.length) return '';
    const c = dg.components;
    const w = dgAll.weights || { talent: 0.6, efficiency: 0.4 };

    /* Il dominio parte SEMPRE da zero, e non si discute: i due blocchi sono
       lunghi «punteggio × peso», quindi la loro lunghezza ha senso solo se
       l'origine è lo zero. Tagliando il fondo (com'era prima) un talento
       basso finiva sotto il bordo sinistro e spariva — Capi dei Pianeti 2026,
       talento 24/100 = 14.4 unità contro un dominio che partiva da 23:
       blocco largo zero, e l'efficienza sembrava partire da sola.
       A destra invece si taglia, che lì non c'è niente da misurare. */
    const edges = thr.map(t => t[0]);
    const others = Object.entries(dgAll.byKey || {}).filter(([k]) => k !== teamKey);
    const allScores = [dg.score, ...others.map(([, t]) => t.score)];
    const lo = 0;
    const hi = Math.min(100, Math.max(...edges, ...allScores) + 8);
    const plotW = LAD.w - LAD.l - LAD.r;
    const X = (v) => LAD.l + ((v - lo) / (hi - lo)) * plotW;

    // fasce: dal basso verso l'alto, ognuna dal suo bordo a quello successivo
    const asc = [...thr].sort((a, b) => a[0] - b[0]);   // [[29.3,'D'], … [70.9,'A+']]
    const bands = asc.map(([edge, letter], i) => {
        const next = i + 1 < asc.length ? asc[i + 1][0] : hi;
        return { letter, from: i === 0 ? lo : edge, to: Math.min(next, hi), mine: letter === dg.letter };
    }).filter(b => b.to > lo);

    const bandsSvg = bands.map((b, i) => {
        const x0 = X(Math.max(b.from, lo)), x1 = X(b.to);
        const wide = x1 - x0 >= 26;
        return `
        <rect x="${x0.toFixed(1)}" y="28" width="${Math.max(0, x1 - x0).toFixed(1)}" height="15"
              class="dgt-lad-band${b.mine ? ' is-mine' : i === 0 ? ' open' : i % 2 ? ' alt' : ''}"/>
        ${wide || b.mine ? `<text x="${(i === 0 ? x1 - 6 : (x0 + x1) / 2).toFixed(1)}" y="39"
              class="dgt-lad-bandlab${b.mine ? ' is-mine' : ''}" text-anchor="${i === 0 ? 'end' : 'middle'}">${b.letter}</text>` : ''}`;
    }).join('');

    // la barra: due segmenti, e la lunghezza di ognuno è peso × punteggio
    const tEnd = w.talent * c.talent, eEnd = tEnd + w.efficiency * c.efficiency;
    const x0 = X(lo), xT = X(Math.max(tEnd, lo)), xE = X(Math.max(eEnd, lo));

    /* Dentro ogni blocco, una fetta per giocatore.
       L'efficienza è una media pesata di termini non negativi, quindi le fette
       sono ESATTE: ognuna è (capitale × voto della pick) sul totale, e insieme
       fanno il blocco. Il talento è una quota di lega, e la sua formula ha una
       costante che non appartiene a nessun giocatore: lì le fette dividono il
       blocco in proporzione al VOR di ciascun titolare — la composizione della
       grandezza, non dei punti di voto. La didascalia lo dice. */
    const slicesOf = (items, xa, xb) => {
        const tot = items.reduce((t, i) => t + i.v, 0) || 1;
        const width = Math.max(0, xb - xa);
        let cur = xa;
        return items.map((it, i) => {
            const wpx = (it.v / tot) * width;
            const x = cur; cur += wpx;
            const gap = i === items.length - 1 ? 0 : wpx > 7 ? 2 : 0.6;  // stacco fra le fette, ridotto su quelle sottili
            return `<rect x="${x.toFixed(1)}" y="52" width="${Math.max(0, wpx - gap).toFixed(1)}" height="26"
                class="${it.cls} dgt-lad-slice" data-who="${esc(it.who)}" data-sub="${esc(it.sub)}"/>`;
        }).join('');
    };

    const sRows = starterRows(ctx);
    const sTot = sRows.reduce((t, r) => t + r.vor, 0) || 1;
    const talentSlices = sRows.filter(r => r.vor > 0).map((r, i) => ({
        v: r.vor, cls: `dgt-lad-talent${i % 2 ? ' alt' : ''}`,
        who: r.p.player,
        sub: `${r.p.pos} · ${fmt0(r.vor)} pt above replacement · ${Math.round(r.vor / sTot * 100)}% of the talent block`,
    }));

    const effPicks = (dg.picks || []).filter(r => r.capital != null);
    const effDen = effPicks.reduce((t, r) => t + (r.capital + 1) * r.score, 0) || 1;
    const effSlices = effPicks
        .map((r, i) => ({
            v: (r.capital + 1) * r.score, cls: `dgt-lad-eff${i % 2 ? ' alt' : ''}`, r,
            who: r.player,
            sub: `round ${r.round}, graded ${r.letter} · ${((r.capital + 1) * r.score / effDen * 100).toFixed(1)}% of the efficiency block`,
        }))
        .filter(x => x.v > 0);

    const seg = (xa, xb, cls, label, slices) => {
        const width = Math.max(0, xb - xa);
        return `
        <rect x="${xa.toFixed(1)}" y="52" width="${width.toFixed(1)}" height="26" class="${cls}"/>
        ${slices?.length ? slicesOf(slices, xa, xb) : ''}
        ${width >= 62 ? `<text x="${(xa + width / 2).toFixed(1)}" y="69" class="dgt-lad-seglab" text-anchor="middle">${label}</text>` : ''}`;
    };

    const clipId = `lad-clip-${ctx.year || ''}-${teamKey || ''}`;
    const gradeCls = `dg-letter--${gradeBand(dg.letter)}`;
    const anchor = xE > LAD.l + plotW * 0.72 ? 'end' : xE < LAD.l + plotW * 0.12 ? 'start' : 'middle';
    const marker = `
        <line x1="${xE.toFixed(1)}" y1="24" x2="${xE.toFixed(1)}" y2="90" class="dgt-lad-mark"/>
        <text x="${xE.toFixed(1)}" y="15" class="dgt-lad-grade ${gradeCls}"
              text-anchor="${anchor}">${team.name} · ${dg.letter} · ${dg.grade}/100</text>`;

    // le altre tre squadre: il rank diventa una distanza
    /* Due squadre con lo stesso voto finivano una sopra l'altra. Chi sta a
       meno di 40px si raggruppa: una tacca sola, e i nomi incolonnati sotto —
       che è anche la lettura giusta, "questi due hanno fatto lo stesso draft". */
    const sorted = others.map(([k, t]) => ({ k, t, x: X(t.score) })).sort((a, b) => a.x - b.x);
    const clusters = [];
    for (const r of sorted) {
        const last = clusters[clusters.length - 1];
        // 84 unità di viewBox ≈ la larghezza di "Capi dei Pianeti" a 10px: con
        // la soglia vecchia (40) due nomi vicini si toccavano lo stesso
        if (last && r.x - last.x < 84) { last.items.push(r); last.x = (last.x + r.x) / 2; }
        else clusters.push({ x: r.x, items: [r] });
    }
    const maxStack = Math.max(1, ...clusters.map(c => c.items.length));
    const rivals = clusters.map(c => `
        <line x1="${c.x.toFixed(1)}" y1="82" x2="${c.x.toFixed(1)}" y2="94" class="dgt-lad-rival"/>
        ${c.items.map((r, i) => `
        <text x="${c.x.toFixed(1)}" y="${110 + i * 17}" class="dgt-lad-rivallab" text-anchor="middle">${TEAMS[r.k]?.name || r.k}
            <tspan class="dgt-lad-rivalgr">${r.t.letter}</tspan></text>`).join('')}`).join('');
    const ladH = LAD.h + (maxStack - 1) * 17;

    /* Chi compone i due blocchi, a parole: le fette nella barra si vedono ma
       non si leggono, e passare il dito su ognuna per scoprire i nomi non è
       «a colpo d'occhio». Qui i primi tre di ciascun blocco con la loro quota. */
    const topOf = (items, label, cls, name) => {
        const tot = items.reduce((t, i) => t + i.v, 0) || 1;
        const top = [...items].sort((a, b) => b.v - a.v).slice(0, 3);
        if (!top.length) return '';
        const rest = items.length - top.length;
        return `
        <span class="dgt-lad-who-row">
            <i class="dgt-lad-sw ${cls}"></i><b>${label}</b>
            ${top.map(t => `<span>${name(t)} <em>${Math.round(t.v / tot * 100)}%</em></span>`).join('')}
            ${rest > 0 ? `<small>+${rest} more</small>` : ''}
        </span>`;
    };
    const who = `
    <div class="dgt-lad-who">
        ${topOf(talentSlices.map((x, i) => ({ ...x, row: sRows.filter(r => r.vor > 0)[i] })), 'Talent', 'dgt-lad-talent',
        (t) => t.row.p.player)}
        ${topOf(effSlices, 'Efficiency', 'dgt-lad-eff', (t) => `${t.r.player} <small>R${t.r.round}</small>`)}
    </div>`;

    // quanto manca alla lettera sopra (e quanto si è sopra quella sotto)
    const up = asc.find(([e]) => e > dg.score);
    const down = [...asc].reverse().find(([e]) => e <= dg.score);
    const art = (l) => (/^[AEF]/.test(l) ? 'an' : 'a');
    const gapUp = up ? `<b>${(up[0] - dg.score).toFixed(1)}</b> more would have made it ${art(up[1])} ${up[1]}`
        : `there is nothing above ${art(dg.letter)} ${dg.letter}`;
    const margin = down ? dg.score - down[0] : null;
    const gapDown = margin == null ? ''
        : margin < 0.05 ? `It sits right on the ${down[1]} line`
            : `It cleared the ${down[1]} line by <b>${margin.toFixed(1)}</b>`;

    return `
    <div class="dgt-ladder">
        <div class="dgt-chart-wrap">
        <svg viewBox="0 0 ${LAD.w} ${ladH}" class="an-svg dgt-lad-svg" role="img"
             aria-label="How the grade is built: talent times its weight, plus efficiency times its weight, landing in the ${dg.letter} band">
            ${bandsSvg}
            <defs><clipPath id="${clipId}"><rect x="${x0.toFixed(1)}" y="52" width="${(LAD.w - LAD.r - x0).toFixed(1)}" height="26" rx="4"/></clipPath></defs>
            <rect x="${x0.toFixed(1)}" y="52" width="${(LAD.w - LAD.r - x0).toFixed(1)}" height="26" rx="4" class="dgt-lad-track"/>
            <g clip-path="url(#${clipId})">
                ${seg(x0, xT, 'dgt-lad-talent', `Talent × ${Math.round(w.talent * 100)}%`, talentSlices)}
                ${seg(xT, xE, 'dgt-lad-eff', `Efficiency × ${Math.round(w.efficiency * 100)}%`, effSlices)}
            </g>
            ${marker}${rivals}
        </svg>
        </div>
        ${who}
        <p class="dgt-lad-note">The bar is the grade being built: the first block is <b>talent</b> counted at
            ${Math.round(w.talent * 100)}%, the second is <b>efficiency</b> at ${Math.round(w.efficiency * 100)}% — each block is
            exactly that long because that's its score times its weight. <b>Inside each block, one slice per
            player</b>, and both are exact: in talent, each starter's value above replacement over what was
            reachable; in efficiency, a pick's grade times what the pick cost. Hover a slice for the name. Where the bar ends is the letter: the
            bands above are <b>fixed and all the same width</b>, five points each, because the scale is absolute:
            0 would be a starting nine off the waiver wire with every pick wasted, 100 the best nine the board
            allowed with every turn played to the hilt. Real drafts live between 40 and 78.
            ${gapDown}${gapDown && gapUp ? ', and ' : ''}${gapUp}.</p>
    </div>`;
}

/* ─── La card del voto ───────────────────────────────────────────────
   Prima erano tre tessere identiche, ma solo due fanno il voto: la terza
   (quanto valore finisce in formazione) è contesto e sembrava un terzo
   ingrediente. Ora le due che contano stanno sotto la scala che le somma,
   con accanto il fatto che le produce; il contesto è una riga a parte, detta
   per quello che è. */
function gradeBreakdownCard(ctx) {
    const { dg, dgAll, team, grades, teamKey } = ctx;
    if (!dg) return '';
    const c = dg.components;
    const w = dgAll?.weights || { talent: 0.6, efficiency: 0.4 };

    // quota di lega del talento: è la definizione stessa del punteggio
    // la quota di lega non fa più il voto (il talento è assoluto): resta come
    // contesto in coda alla nota, che è l'unica cosa per cui serve ancora
    const leagueVOR = Object.values(dgAll?.byKey || {}).reduce((s, t) => s + (t.components?.starterVOR || 0), 0);
    const share = leagueVOR ? c.starterVOR / leagueVOR : 0;
    const weeks = 17;

    const picks = (dg.picks || []).filter(r => r.capital != null);
    // il peso grezzo (capital+1) è in punti di VOR: da solo non dice niente,
    // il rapporto fra la prima e l'ultima pick sì
    const firstW = picks.length ? picks[0].capital + 1 : null;
    const lastW = picks.length ? picks[picks.length - 1].capital + 1 : null;
    const ratio = firstW && lastW ? firstW / lastW : null;

    const ing = (id, label, weight, score, note, detail) => `
        <div class="dgt-metric dgt-ing" data-m="${id}">
            <button class="dgt-metric-head" type="button" aria-expanded="false" aria-controls="dgm-${id}">
                <span class="dgt-metric-label">${label} <em>${Math.round(weight * 100)}% of the grade</em></span>
                <span class="dgt-metric-val">${Math.round(score)}<small>/100</small></span>
                <span class="dgt-metric-note">${note}</span>
            </button>
            <div class="dgt-metric-detail" id="dgm-${id}" hidden>${detail}</div>
        </div>`;

    const talentNote = `<b>${fmt0(c.starterVOR)} pt</b> above replacement in the best starting nine — about
        <b>${(c.starterVOR / weeks).toFixed(1)} pt a week</b> more than a lineup of last-in-league starters.
        ${c.ceilingVOR ? `That is <b>${Math.round(c.capture * 100)}%</b> of the <b>${fmt0(c.ceilingVOR)} pt</b> that were within reach from these 15 turns —
        the best nine the board would have let this team build. ` : ''}${ordinal(c.talentRank)} of 4${leagueVOR ? `, with ${(share * 100).toFixed(0)}% of all the value the four teams drafted` : ''}.`;

    const bestP = dg.bestPick, worstP = dg.worstPick;
    const effNote = `the ${picks.length} pick grades averaged, each weighted by what its slot cost${ratio
        ? ` — the first-round pick weighs <b>${ratio.toFixed(1)}×</b> the last one, which is what makes an early miss expensive` : ''}.
        ${bestP ? `Best: <b>${bestP.player}</b> (${bestP.letter}, R${bestP.round})` : ''}${worstP && worstP !== bestP ? ` · worst: <b>${worstP.player}</b> (${worstP.letter}, R${worstP.round})` : ''}. ${ordinal(c.efficiencyRank)} of 4.`;

    return `
    <div class="mosaic-card mc-wide dgt-card mc-in" id="dgt-grade-card">
        <span class="mc-kicker">Why this grade</span>
        <h2 class="mc-title">Draft Grade
            <small class="dgt-sos-big dgt-grade-big dg-letter--${gradeBand(dg.letter)}">${dg.letter} · ${dg.grade}/100 · ${ordinal(dg.rank)} in league</small>
        </h2>
        ${explain(`The grade weighs two things: <b>talent</b> — what share of the value that was <i>within reach
            from your own turns</i> the best starting nine actually captured — and <b>efficiency</b>, how well the
            board was played pick by pick. Replacement level here is the last starter in the league. The scale is
            absolute: it does not depend on how the other three drafted, so the same draft gets the same grade in a
            strong year and in a weak one. The letter bands are fixed and equally wide; the number beside the letter
            is that band remapped onto report-card anchors, a monotone remap, so higher is always better.`)}
        <p class="dgt-why">${dg.why}</p>
        ${scoreLadder(ctx)}
        <div class="dgt-metrics dgt-metrics--stack" id="dgt-metrics">
            ${ing('talent', 'Talent collected', w.talent, c.talent, talentNote, talentDetail(ctx))}
            ${ing('eff', 'Draft efficiency', w.efficiency, c.efficiency, effNote + efficiencyMovers(dg), efficiencyDetail(ctx))}
            <div class="dgt-metric dgt-ing dgt-ing--ctx" data-m="starters">
                <button class="dgt-metric-head" type="button" aria-expanded="false" aria-controls="dgm-starters">
                    <span class="dgt-metric-label">Not part of the grade <em>context</em></span>
                    <span class="dgt-metric-note"><b>${Math.round(c.starterShare * 100)}%</b> of the value this draft collected
                        (${fmt0(c.starterVOR)} of ${fmt0(c.totalVOR)} pt) ends up in the starting nine rather than on the bench.
                        It says nothing about the grade — the grade already counts only the nine.</span>
                </button>
                <div class="dgt-metric-detail" id="dgm-starters" hidden>${startersDetail(ctx)}</div>
            </div>
        </div>
    </div>`;
}

/* ── I tre dettagli ──────────────────────────────────────────────────
   Ognuno risponde alla stessa domanda — «da dove esce questo numero, per
   QUESTA squadra» — mostrando le righe che lo compongono. Il totale in fondo
   deve combaciare col numero grande: è il controllo che il dettaglio non stia
   raccontando un'altra cosa. */

/** Il replacement di team-eval: la stessa linea con cui il motore ha calcolato
 *  il talento. Ricalcolarla qui è l'unico modo per scomporre i 153 VOR nei
 *  nove titolari che li fanno — il motore restituisce solo il totale. */
function teamReplacement(grades) {
    const all = grades.flatMap(x => x.list).filter(p => p.value != null);
    return replacementLevels(all, 'value');
}

function talentDetail(ctx) {
    const { g, dg, team } = ctx;
    if (!g.starters?.length) return '';
    const rows = starterRows(ctx);
    const tot = rows.reduce((s, r) => s + r.vor, 0);
    const max = rows[0]?.vor || 1;
    return `
        <p class="dgt-md-lead">The nine starters this draft could field, and what each is worth
            <b>above the replacement line for his position</b> — the sum is the number above.</p>
        <ul class="dgt-md-list">
            ${rows.map(r => `
            <li>
                <span class="dgt-md-pos">${r.p.pos}</span>
                <span class="dgt-md-name">${r.p.player}</span>
                <span class="dgt-md-bar"><i style="width:${Math.round(r.vor / max * 100)}%"></i></span>
                <span class="dgt-md-num">${fmt0(r.vor)}</span>
            </li>`).join('')}
        </ul>
        <p class="dgt-md-foot">Total <b>${fmt0(tot)} VOR</b> · league best ${fmt0(dg.components.leagueBestVOR)}
            · ${team.name} is ${ordinal(dg.components.talentRank)}.</p>`;
}

function efficiencyDetail(ctx) {
    const { dg } = ctx;
    const picks = (dg.picks || []).filter(r => r.capital != null);
    if (!picks.length) return '';
    const eff = dg.components.efficiency;
    const den = picks.reduce((s, r) => s + r.capital + 1, 0) || 1;
    const rows = picks.map(r => ({ r, w: r.capital + 1, d: (r.capital + 1) * (r.score - eff) / den }))
        .sort((a, b) => b.d - a.d);
    return `
        <p class="dgt-md-lead">Every pick, its grade, and how much it moved the average. The weight is the
            draft capital that pick cost — that's what makes an early miss expensive.</p>
        <ul class="dgt-md-list dgt-md-list--eff">
            ${rows.map(x => `
            <li>
                <span class="dgt-md-pos">R${x.r.round}</span>
                <span class="dgt-md-name">${x.r.player}</span>
                <span class="dgt-md-grade dg-letter--${gradeBand(x.r.letter)}">${x.r.letter}</span>
                <span class="dgt-md-w">×${x.w}</span>
                <span class="dgt-md-num ${Math.abs(x.d) < 0.05 ? '' : x.d > 0 ? 'up' : 'down'}">${
            Math.abs(x.d) < 0.05 ? '0.0' : `${x.d > 0 ? '+' : ''}${x.d.toFixed(1)}`}</span>
            </li>`).join('')}
        </ul>
        <p class="dgt-md-foot">They sum to zero by construction: that balance <b>is</b> the ${eff.toFixed(1)}
            shown as ${dg.components.efficiencyGrade}/100.</p>`;
}

function startersDetail(ctx) {
    const { g, grades, dg } = ctx;
    const repl = teamReplacement(grades);
    const starterPicks = new Set((g.starters || []).map(p => p.pick));
    const bench = g.list.filter(p => p.value != null && !starterPicks.has(p.pick))
        .map(p => ({ p, vor: Math.max(0, (p.value || 0) - (repl[p.pos] || 0)) }))
        .filter(x => x.vor > 0)
        .sort((a, b) => b.vor - a.vor);
    const perso = bench.reduce((s, x) => s + x.vor, 0);
    const c = dg.components;
    return `
        <p class="dgt-md-lead">${perso > 0
            ? `The value that <b>didn't</b> make the lineup: real points, sitting on the bench. It counts for
               depth and for trades, not for the weekly score.`
            : `Nothing is left on the bench: every point of value this draft produced is in the starting nine.`}</p>
        ${bench.length ? `
        <ul class="dgt-md-list">
            ${bench.map(x => `
            <li>
                <span class="dgt-md-pos">${x.p.pos}</span>
                <span class="dgt-md-name">${x.p.player}</span>
                <span class="dgt-md-bar"><i style="width:${Math.round(x.vor / (bench[0].vor || 1) * 100)}%"></i></span>
                <span class="dgt-md-num">${fmt0(x.vor)}</span>
            </li>`).join('')}
        </ul>` : ''}
        <p class="dgt-md-foot">${fmt0(c.starterVOR)} in the starters + ${fmt0(perso)} on the bench =
            <b>${fmt0(c.totalVOR)}</b> total · ${Math.round(c.starterShare * 100)}% where it scores.</p>`;
}

/* Hover sulle fette della barra: chi è quel pezzo di voto.
   Il tooltip è figlio di <body> e position:fixed per la stessa ragione della
   curva del draft — la card ha overflow-x:auto e antenati con transform, che
   ritaglierebbero o sposterebbero un popup interno. La fetta sotto il dito si
   accende e le altre si spengono: con quindici fette, evidenziare è l'unico
   modo per sapere QUALE stai leggendo. */
function bindSlices(root) {
    const svg = root?.querySelector('.dgt-lad-svg');
    if (!svg) return;
    const slices = [...svg.querySelectorAll('.dgt-lad-slice')];
    if (!slices.length) return;

    document.getElementById('dgt-lad-tooltip')?.remove();
    const tip = document.createElement('div');
    tip.className = 'an-chart-tooltip';
    tip.id = 'dgt-lad-tooltip';
    tip.style.position = 'fixed';
    tip.hidden = true;
    document.body.appendChild(tip);

    const place = (e) => {
        let x = e.clientX + 14;
        const w = tip.offsetWidth || 180;
        if (x + w > window.innerWidth - 4) x = e.clientX - w - 14;
        let y = e.clientY - 12;
        const h = tip.offsetHeight || 50;
        if (y + h > window.innerHeight - 4) y = e.clientY - h - 12;
        tip.style.left = `${x}px`;
        tip.style.top = `${Math.max(4, y)}px`;
    };

    const show = (el, e) => {
        svg.classList.add('has-hover');
        slices.forEach(s => s.classList.toggle('is-on', s === el));
        tip.replaceChildren();
        const t = document.createElement('div');
        t.className = 'an-tt-title';
        t.textContent = el.dataset.who;
        const sub = document.createElement('div');
        sub.className = 'an-tt-row';
        sub.textContent = el.dataset.sub;
        tip.append(t, sub);
        tip.hidden = false;
        place(e);
    };
    const hide = () => {
        svg.classList.remove('has-hover');
        slices.forEach(s => s.classList.remove('is-on'));
        tip.hidden = true;
    };

    for (const el of slices) {
        el.addEventListener('pointerenter', (e) => show(el, e));
        el.addEventListener('pointermove', place);
    }
    svg.addEventListener('pointerleave', hide);
}

/* Su schermo stretto la scala scorre, e la parte che conta — dove finisce la
   barra, cioè il voto — sta a destra: senza questo, al primo sguardo si vede
   solo la partenza. Si porta il marcatore al centro della finestrella. */
function bindLadder(root) {
    const wrap = root?.querySelector('.dgt-ladder .dgt-chart-wrap');
    const svg = wrap?.querySelector('svg');
    const mark = svg?.querySelector('.dgt-lad-mark');
    if (!wrap || !mark) return;
    requestAnimationFrame(() => {
        if (wrap.scrollWidth <= wrap.clientWidth + 4) return;
        const vbW = svg.viewBox?.baseVal?.width || 860;
        const px = (+mark.getAttribute('x1') / vbW) * svg.getBoundingClientRect().width;
        wrap.scrollLeft = Math.max(0, px - wrap.clientWidth / 2);
    });
}

/** Apre una metrica e stringe le altre. Una alla volta: due dettagli aperti
 *  insieme rimettono la riga a tre colonne strette, che è il problema che
 *  l'apertura doveva risolvere. */
function bindMetrics(root) {
    const row = root?.querySelector('#dgt-metrics');
    if (!row) return;
    row.addEventListener('click', (e) => {
        const head = e.target.closest('.dgt-metric-head');
        if (!head) return;
        const cella = head.closest('.dgt-metric');
        const gia = cella.classList.contains('open');
        row.querySelectorAll('.dgt-metric').forEach(x => {
            x.classList.remove('open');
            x.querySelector('.dgt-metric-head').setAttribute('aria-expanded', 'false');
            x.querySelector('.dgt-metric-detail').hidden = true;
        });
        row.classList.toggle('has-open', !gia);
        if (!gia) {
            cella.classList.add('open');
            head.setAttribute('aria-expanded', 'true');
            cella.querySelector('.dgt-metric-detail').hidden = false;
        }
    });
}

/* ─── «Cosa vuol dire» dentro le card ────────────────────────────────
   La prima stesura era un glossario solo, in cima: sedici voci in un posto
   dove nessuna di loro era usata. Leggendo la pagina toccava tornare su,
   cercare la voce, tornare giù. Adesso ogni definizione sta nella card che usa
   quel termine, chiusa, sotto il titolo: si apre dove serve e non allunga
   niente finché non la chiedi.

   `explain()` è la stessa forma per tutte — se un domani cambia, cambia in un
   punto solo. */
function explain(html) {
    return `<details class="dgt-explain"><summary>What this means</summary><p>${html}</p></details>`;
}

/* ─── Chi ha spinto e chi ha frenato l'efficienza ────────────────────
   Il pezzo superstite della vecchia derivazione: l'efficienza è una media
   pesata, e la cosa utile non è la media ma CHI la muove. Ogni numero è
   quanto quella singola pick ha spostato il punteggio — il suo scarto dalla
   media per il draft capital che è costata. Su tutte le pick sommano a zero
   per costruzione: quel pareggio È l'efficienza. Si mostrano i tre estremi
   per lato, il resto sta nel dettaglio. */
function efficiencyMovers(dg) {
    const c = dg.components;
    const picks = (dg.picks || []).filter(r => r.capital != null);
    if (!picks.length) return '';
    const den = picks.reduce((s, r) => s + r.capital + 1, 0) || 1;
    const moved = picks.map(r => ({ r, d: (r.capital + 1) * (r.score - c.efficiency) / den }))
        .sort((a, b) => b.d - a.d);
    const chip = (x, up) => `<span class="dgt-move ${up ? 'up' : 'down'}">
        <b>${x.r.player}</b> <small>R${x.r.round} · ${x.r.letter}</small>
        <i>${x.d > 0 ? '+' : ''}${x.d.toFixed(1)}</i></span>`;
    const su = moved.filter(x => x.d > 0).slice(0, 3).map(x => chip(x, true)).join('');
    const giu = moved.filter(x => x.d < 0).slice(-3).reverse().map(x => chip(x, false)).join('');
    if (!su && !giu) return '';
    return `
        <div class="dgt-moved-row">${su}${giu}</div>`;
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
        ${explain(`Written from the picks, not by hand: the engine looks for the patterns it can measure — picks
            graded A, players who would have been gone at the next turn, value handed to the waiver line, positions
            taken just before their cliff — and states the ones this draft actually shows.`)}
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
        ${explain(`A position's value doesn't fall evenly, it drops in steps. A <b>cliff</b> is where the next
            player available is clearly worse than the last one: taking a position just before its cliff is worth far
            more than taking it just after, and this is where you see whether that happened.`)}
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
        ${explain(`A <b>reach</b> is a player taken earlier than the market expected. On its own that says nothing:
            what matters is the two-turn plan — whether waiting would still have got you someone at that position, or
            whether the position would have run dry. That comparison is what this card makes.`)}
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
        ${explain(`The alternatives are computed <b>only among players actually drafted after that pick</b>. Anyone
            still on the board when the draft ended was available to everybody all along and proves nothing about the
            choice.`)}
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
        ${explain(`<b>Draft capital</b> is what a pick cost you: an early pick is worth several late ones, which is
            why efficiency weighs them differently. This card follows that capital — how much went into each position,
            and how much of it ended up in the starting lineup instead of on the bench.`)}
        <p class="dgt-card-sub">Every pick this team made, one block each in draft order; on the right, the starting slot it fills this year (league roster rules) or the bench. Bold blocks and ribbon are the first quarter of the draft.</p>
        <div class="dgt-chart-wrap">
            <svg viewBox="0 0 ${FLOW.w} ${H}" class="an-svg dgt-flow-svg">${ribbons}${leftSvg}${slotSvg}${benchSvg}</svg>
        </div>
        <div class="dgt-board-legend">${legend}</div>
        <p class="dgt-card-sub dgt-flow-caption">${caption}</p>
    </div>`;
}

// ─── Card: la curva del draft ────────────────────────────────────

const CV = { w: 860, h: 340, l: 52, r: 122, t: 42, b: 36 };
const DC_TICK = 26;   // larghezza della lineetta "best available"

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

    const allPts = rounds.flatMap(r => r.alt ? [r.taken.pts, r.alt.pts] : [r.taken.pts]);
    // Lo zero qui non è obbligatorio: sono punti, non barre da confrontare in
    // area. Con tutte le pick sopra i 100 pt tenerlo schiacciava i marchi in un
    // terzo del riquadro; torna da solo se qualche pick ci si avvicina davvero.
    const lo = Math.min(...allPts), hi = Math.max(...allPts, 1);
    const ticks = niceTicks(lo < hi * 0.3 ? 0 : lo - (hi - lo) * 0.12, hi);
    const yMin = ticks[0], yMax = ticks[ticks.length - 1];
    const plotW = CV.w - CV.l - CV.r;
    const plotH = CV.h - CV.t - CV.b;
    const x = (i) => CV.l + (rounds.length > 1 ? (i / (rounds.length - 1)) * plotW : plotW / 2);
    const y = (v) => CV.t + (1 - (v - yMin) / ((yMax - yMin) || 1)) * plotH;

    const grid = ticks.map(v => `
        <line x1="${CV.l}" y1="${y(v)}" x2="${CV.l + plotW}" y2="${y(v)}" class="an-gridline"/>
        <text x="${CV.l - 8}" y="${y(v) + 3}" class="an-tick" text-anchor="end">${fmt0(v)}</text>`).join('');
    const xTicks = rounds.map((r, i) =>
        `<text x="${x(i)}" y="${CV.h - 8}" class="an-tick" text-anchor="middle">R${r.round}</text>`).join('');

    // Una pick = un punto (chi hai preso) + una lineetta (il miglior giocatore
    // dello stesso ruolo ancora sul tavolo) + il tratto che le unisce. La
    // lineetta è sempre dello stesso grigio: è il board, una serie sola. A
    // portare il segno è il collegamento — rosso se sul tavolo è rimasto
    // valore, verde se la pick ha battuto il board.
    const marks = rounds.map((r, i) => {
        const cx = x(i), yT = y(r.taken.pts);
        if (!r.alt) return `<g class="dgt-dc" data-i="${i}"><circle class="dgt-dc-dot" cx="${cx.toFixed(1)}" cy="${yT.toFixed(1)}" r="5" fill="${team.color}"/></g>`;
        const yA = y(r.alt.pts);
        const gap = r.alt.pts - r.taken.pts;
        return `
        <g class="dgt-dc ${gap > 1 ? 'dgt-dc--left' : 'dgt-dc--steal'}" data-i="${i}">
            <line class="dgt-dc-link" x1="${cx.toFixed(1)}" y1="${yT.toFixed(1)}" x2="${cx.toFixed(1)}" y2="${yA.toFixed(1)}"/>
            <line class="dgt-dc-tick" x1="${(cx - DC_TICK / 2).toFixed(1)}" y1="${yA.toFixed(1)}" x2="${(cx + DC_TICK / 2).toFixed(1)}" y2="${yA.toFixed(1)}"/>
            <circle class="dgt-dc-dot" cx="${cx.toFixed(1)}" cy="${yT.toFixed(1)}" r="5" fill="${team.color}"/>
        </g>`;
    }).join('');

    // NYT: etichette dirette sull'ultima pick (niente legenda), scostate in
    // verticale se punto e lineetta sono troppo vicini per due righe di testo.
    const lastI = rounds.length - 1;
    const last = rounds[lastI];
    const lx = x(lastI) + 11;
    let yPick = y(last.taken.pts) + 3.5;
    let yAlt = last.alt ? y(last.alt.pts) + 3.5 : 0;
    if (last.alt && Math.abs(yPick - yAlt) < 14) {
        const su = yPick <= yAlt ? -1 : 1;
        yPick += su * 7; yAlt -= su * 7;
    }
    const endLabels = `
        <text x="${lx.toFixed(1)}" y="${yPick.toFixed(1)}" class="dgt-curve-endlabel" fill="${team.color}">Picked</text>
        ${last.alt ? `<text x="${lx.toFixed(1)}" y="${yAlt.toFixed(1)}" class="dgt-curve-endlabel dgt-curve-endlabel--alt">Best available</text>` : ''}`;

    let worstIdx = -1, worstGap = 0;
    rounds.forEach((r, i) => { const gp = Math.max(0, (r.alt?.pts ?? 0) - r.taken.pts); if (gp > worstGap) { worstGap = gp; worstIdx = i; } });
    // Il callout va nella striscia libera SOPRA il riquadro, con la lineetta di
    // richiamo: appoggiato al gap finiva addosso ai marchi dei round vicini.
    const callout = (worstIdx >= 0 && worstGap >= 8) ? (() => {
        const cx = x(worstIdx);
        const yTop = Math.min(y(rounds[worstIdx].taken.pts), y(rounds[worstIdx].alt.pts));
        const anchor = cx > CV.l + plotW * 0.7 ? 'end' : cx < CV.l + plotW * 0.3 ? 'start' : 'middle';
        const leader = yTop - 7 > CV.t + 2
            ? `<line class="an-leader" x1="${cx.toFixed(1)}" y1="${CV.t - 6}" x2="${cx.toFixed(1)}" y2="${(yTop - 7).toFixed(1)}"/>` : '';
        return `${leader}
        <text x="${cx.toFixed(1)}" y="${CV.t - 15}" class="dgt-curve-callout" text-anchor="${anchor}">−${fmt0(worstGap)} pt left at R${rounds[worstIdx].round}</text>`;
    })() : '';

    const dataAttr = JSON.stringify(rounds).replace(/'/g, '&#39;');

    return `
    <div class="mosaic-card mc-wide dgt-card mc-in" id="dgt-curve">
        <span class="mc-kicker">Round by round</span>
        <h2 class="mc-title">The draft curve</h2>
        ${explain(`Value pick after pick. Dots that fall away quickly say the capital was spent at the top; dots that
            stay high late say the late rounds paid. Neither shape is right by itself — the grade already accounts
            for where the value came from.`)}
        <p class="dgt-card-sub">One dot per pick, at its projected value; the dash on the same round is the best player of the same position still on the board (later drafted by another team). The stroke between them is the distance: <b class="dgt-legend-down">red</b> when value was left on the table, <b class="dgt-legend-up">green</b> when the pick beat the board. Left on the table over the whole draft: <b>${fmt0(leftOnBoard)} projected pt</b>.</p>
        <div class="dgt-chart-wrap">
            <svg viewBox="0 0 ${CV.w} ${CV.h}" class="an-svg" data-rounds='${dataAttr}'>
                ${grid}${xTicks}${marks}${endLabels}${callout}
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
    const groups = [...svg.querySelectorAll('.dgt-dc')];
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
        // il crosshair dice DOVE sei, il gruppo acceso dice QUALE pick: con i
        // punti sparsi la sola riga verticale non basta a capire quale coppia
        // punto/lineetta stai leggendo
        groups.forEach((gr, i) => gr.classList.toggle('is-on', i === idx));

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
        groups.forEach(gr => gr.classList.remove('is-on'));
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
        ${explain(`Every pick is judged on the <b>counterfactual</b>: the value captured against what would still
            have been waiting at the next turn — not against the slot, which made early rounds impossible to ace.
            <b>Survival</b> is the chance that player would have lasted until then, read off the market order pushed
            by roster need and shown in three bands, because a yes/no is more certainty than the model has.`)}
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
