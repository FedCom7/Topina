/**
 * Draft Score v2 — motore di valutazione del draft decomponibile.
 *
 * Si AFFIANCA al voto storico (letterFor/ratio in draftgrades.js), non lo
 * sostituisce: quello resta immutato per continuità 2019-2025. La v2 risponde
 * alla domanda "quanto bene hai draftato, e perché" scomponendo ogni scelta.
 *
 * Due assi (ortogonali per non contare due volte lo stesso segnale):
 *  1. TALENTO — valore marginale (VOR = Value Over Replacement) accumulato,
 *     pesato per utilizzo (titolari prima della panchina). Riusa il livello di
 *     replacement calibrato su QUESTA lega (team-eval.replacementLevels).
 *  2. EFFICIENZA — quanto bene hai pagato quel valore rispetto al draft-capital:
 *     vs ADP (consenso di mercato) e vs il MIGLIOR DISPONIBILE reale sul board
 *     (non solo tra i giocatori draftati: il board è l'intero universo Sleeper
 *     con ADP), corretto per il fabbisogno del roster (need-adjusted).
 *
 * Il voto di squadra = media dei voti-pick pesata per draft-capital + modificatori
 * di costruzione (quota di valore nei titolari, bilanciamento). Tutto è
 * decomponibile e ancorato a valori assoluti (niente z-score su n=4, troppo
 * rumoroso): il rank di lega è mostrato a parte.
 *
 * Nessun dato nuovo: proiezioni+ADP full-PPR (projections.js), VOR e lineup
 * ottimale (team-eval.js). Degradazione graceful: senza board/ADP (es. 2019)
 * l'efficienza vs ADP diventa neutra e resta l'analisi VOR/opportunity-cost.
 */

import { replacementLevels, pickStarters, balanceScore } from './team-eval.js?v=535';
import { matchProjection, normName } from './projections.js?v=589';

const OFF = new Set(['QB', 'RB', 'WR', 'TE']);
const POS_FALLBACK = { K: 125, DEF: 110 }; // come draftgrades.POS_FALLBACK_PROJ (evita import circolare)
const NEED_TARGET = { QB: 2, RB: 5, WR: 5, TE: 2, K: 1, DEF: 1 }; // profondità "sana" per il need model
const SCALE = 40; // punti-lega di VOR ≈ un'unità piena di grade

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/**
 * Dispersione ADP (FFC): Map `${normName}|${POS}` → { adp, stdev, timesDrafted }.
 * Precalcolata offline (scripts/build-adp-ffc.mjs → data/nfl/adp_ffc_{Y}.json).
 * Serve a misurare reach/steal in deviazioni standard. null se il file manca.
 */
export async function getAdpDispersion(year) {
    try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 8000);
        const r = await fetch(`data/nfl/adp_ffc_${year}.json`, { signal: ctrl.signal });
        clearTimeout(t);
        if (!r.ok) return null;
        const data = await r.json();
        const map = new Map();
        for (const [k, v] of Object.entries(data.players || {})) map.set(k, v);
        map.meta = data.meta || null;
        return map.size ? map : null;
    } catch { return null; }
}

/** Valore in punti-lega di una voce del board proiezioni (senza blend storico). */
function boardValue(e) {
    return e.projPts ?? e.ptsStd ?? POS_FALLBACK[e.pos] ?? 0;
}

/** Metrica di steal/reach (σ FFC): positivo = steal, negativo = reach. null senza σ. */
const stealMetric = (r) => r.adpZ;

/** Universo dei giocatori realmente disponibili al draft (tutte le proiezioni). */
function buildBoard(proj, repl) {
    const board = [];
    for (const e of proj.values()) {
        const value = boardValue(e);
        if (!value) continue;
        board.push({
            key: `${normName(e.name)}|${e.pos}`, name: e.name, pos: e.pos,
            team: e.team, adp: e.adp, value,
            vor: Math.max(0, value - (repl[e.pos] || 0)),
        });
    }
    return board;
}

/** Fabbisogno residuo 0-1 per una posizione dato il roster già costruito. */
function needFactor(rosterSoFar, pos) {
    const target = NEED_TARGET[pos] || 1;
    const have = rosterSoFar.filter(p => p.pos === pos).length;
    return clamp((target - have) / target, 0, 1);
}
/** VOR scontato dalla saturazione posizionale: un RB serve più di un 5° WR. */
const marginalValue = (vor, need) => vor * (0.5 + 0.5 * need);

/** Miglior disponibile need-adjusted sul board a quella pick. */
function bestAvailable(available, rosterSoFar) {
    let best = null;
    for (const e of available) {
        const need = needFactor(rosterSoFar, e.pos);
        const mv = marginalValue(e.vor, need);
        if (!best || mv > best.mv) best = { e, mv, need };
    }
    return best;
}

/** Salto di valore rispetto al prossimo stesso-ruolo ancora sul board (tier cliff). */
function scarcityDropoff(available, picked) {
    let next = 0;
    for (const e of available) {
        if (e.pos !== picked.pos || e.key === picked.key) continue;
        if (e.vor > next) next = e.vor;
    }
    return Math.max(0, picked.vor - next);
}

/** Confidenza 0.5-1 nella pick: meno dati (no ADP, K/DEF, alto bust) → meno confidenza. */
function pickConfidence(p) {
    let c = 1;
    if (p.adp == null) c -= 0.25;
    if (!OFF.has(p.pos)) c -= 0.15;
    if (p.ctx?.bustProb != null) c -= p.ctx.bustProb * 0.2;
    return clamp(c, 0.5, 1);
}

/** Soglie voto v2 di default (media ≈ B-/C+), ancorate al punteggio assoluto 0-100. */
const DEFAULT_THRESHOLDS = [[80, 'A+'], [73, 'A'], [68, 'A-'], [63, 'B+'], [58, 'B'], [53, 'B-'], [47, 'C+'], [41, 'C'], [35, 'C-'], [28, 'D']];
/** Coefficienti di aggregazione del voto squadra (override-abili da calibrazione). */
const DEFAULT_AGG = { starterBase: 0.65, starterMult: 18, balanceMult: 0.06 };

export function letterFromScoreV2(s, thresholds = DEFAULT_THRESHOLDS) {
    for (const [t, l] of thresholds) if (s >= t) return l;
    return 'F';
}
export const gradeBandV2 = (letter) => letter[0];

/**
 * Carica la calibrazione LOSO (data/model/draft_score_v2_calib.json) se esiste
 * ed è adottata. Serve pesi/soglie tarati sui 419 pick storici. Graceful: null.
 */
export async function getDraftScoreV2Calib() {
    try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 8000);
        const r = await fetch('data/model/draft_score_v2_calib.json', { signal: ctrl.signal });
        clearTimeout(t);
        if (!r.ok) return null;
        const c = await r.json();
        return c?.adopted ? c : null; // usa i valori tarati solo se hanno superato il gate
    } catch { return null; }
}

/**
 * Analisi di una singola pick (decomponibile). Ritorna value/expected/oppCost/…
 * più il pickScore 0-100 e la sua scomposizione.
 */
function analyzePick(p, repl, available, rosterSoFar, expVOR, adpDisp, thresholds, pickedKey) {
    const value = p.value || 0;
    const vor = Math.max(0, value - (repl[p.pos] || 0));
    const picked = { key: pickedKey, pos: p.pos, vor };

    const need = needFactor(rosterSoFar, p.pos);
    const pickedMV = marginalValue(vor, need);
    const ba = bestAvailable(available, rosterSoFar);
    const opportunityCost = ba ? pickedMV - ba.mv : 0; // ≤ 0
    const bestAlt = ba && ba.e.key !== picked.key ? ba.e : null;

    // Reach/steal in DEVIAZIONI STANDARD dall'ADP di consenso FFC (solo attacco;
    // K/DEF non hanno un ADP di mercato sensato). Convenzione: adpZ = (pick − adp)/σ,
    // POSITIVO = steal (il giocatore è caduto oltre il suo ADP), NEGATIVO = reach.
    // Solo σ: in una lega a 4 team le "pick grezze" (1-60) vs ADP (1-250) sono
    // fuori scala, la σ normalizza. Senza FFC il segnale di mercato è neutro.
    const disp = adpDisp && OFF.has(p.pos) ? adpDisp.get(picked.key) : null;
    let adpZ = null, adpStdev = null, adpN = null;
    if (disp && disp.adp != null && disp.stdev) {
        adpStdev = disp.stdev; adpN = disp.timesDrafted ?? null;
        adpZ = (p.pick - disp.adp) / Math.max(disp.stdev, 0.5);
    }

    const valueVsExpected = vor - expVOR;                        // vs par dello slot (draft-capital)
    const scarcity = scarcityDropoff(available, picked);

    // top alternative per la UI (need-adjusted, escluso il giocatore preso)
    const alts = available
        .filter(e => e.key !== picked.key)
        .map(e => ({ e, mv: marginalValue(e.vor, needFactor(rosterSoFar, e.pos)) }))
        .sort((a, b) => b.mv - a.mv).slice(0, 4)
        .map(x => ({ name: x.e.name, pos: x.e.pos, team: x.e.team, vor: Math.round(x.e.vor), adp: x.e.adp }));

    // segnali del voto-pick (efficienza + fit; il talento assoluto va nel voto squadra)
    const sMarket = adpZ != null ? clamp(adpZ / 2, -1.5, 2) * 9 : 0; // neutro senza σ FFC
    const sOpp = clamp(opportunityCost / SCALE, -2, 0) * 9;
    const sNeed = 5 * need * (vor > 0 ? 1 : 0.4);
    const sScar = clamp(scarcity / SCALE, 0, 1.5) * 4;
    // confidenza: più draft nel campione ADP → segnale di mercato più affidabile
    const confidence = clamp(pickConfidence(p) + (adpN ? Math.min(0.05, adpN / 40000) : 0), 0.5, 1);
    const signals = sMarket + sOpp + sNeed + sScar;
    const pickScore = clamp(50 + confidence * signals, 0, 100);
    const letter = letterFromScoreV2(pickScore, thresholds);

    return {
        pick: p.pick, round: p.round, player: p.player, pos: p.pos, nfl: p.nfl,
        value: Math.round(value), vor: Math.round(vor), adp: p.adp,
        expectedVOR: Math.round(expVOR), valueVsExpected: Math.round(valueVsExpected),
        adpZ: adpZ == null ? null : +adpZ.toFixed(1), adpStdev, adpN,
        opportunityCost: Math.round(opportunityCost), scarcity: Math.round(scarcity),
        need: +need.toFixed(2), confidence: +confidence.toFixed(2),
        bestAlt: bestAlt ? { name: bestAlt.name, pos: bestAlt.pos, team: bestAlt.team, vor: Math.round(bestAlt.vor), value: Math.round(bestAlt.value) } : null,
        alternatives: alts,
        pickScore: +pickScore.toFixed(1), letter,
        parts: {
            market: +sMarket.toFixed(1), opportunity: +sOpp.toFixed(1),
            need: +sNeed.toFixed(1), scarcity: +sScar.toFixed(1),
        },
    };
}

/**
 * Calcola il Draft Score v2 per tutte le squadre.
 * @param grades output di computeGrades (array team, ognuno con .key e .list; le
 *               pick hanno .value/.pick/.round/.pos/.adp e, se già attaccato, .ctx)
 * @param proj   Map proiezioni (getSeasonProjections) — il board completo
 * @param opts   { adpDisp } Map dispersione ADP (getAdpDispersion), opzionale
 * @returns { byKey: {teamKey: teamResult}, ranking: [teamKey…], boardByPos } oppure null
 */
export function computeDraftScoreV2(grades, proj, opts = {}) {
    if (!grades?.length || !proj?.size) return null;
    const adpDisp = opts.adpDisp || null;
    const calib = opts.calib || null; // pesi/soglie tarati LOSO (adottati), o null
    const thr = calib?.thresholds || DEFAULT_THRESHOLDS;
    const agg = { ...DEFAULT_AGG, ...(calib?.weights || {}) };

    const allPicks = grades.flatMap(g => g.list).filter(p => p.value != null);
    if (!allPicks.length) return null;
    const repl = replacementLevels(allPicks, 'value');
    const board = buildBoard(proj, repl);
    if (!board.length) return null;

    // curva draft-capital: VOR "di mercato" alla pick K (per ADP; fallback per valore)
    const byAdp = board.filter(e => e.adp != null).sort((a, b) => a.adp - b.adp);
    const byVal = [...board].sort((a, b) => b.vor - a.vor);
    const capitalRef = byAdp.length >= allPicks.length ? byAdp : byVal;
    const expectedVORatPick = (k) => capitalRef[Math.min(k, capitalRef.length) - 1]?.vor ?? 0;

    // ordine globale delle pick per ricostruire il board disponibile
    const flat = grades.flatMap(g => g.list.map(p => ({ p, key: g.key })))
        .filter(x => x.p.value != null)
        .sort((a, b) => a.p.pick - b.p.pick);

    const taken = new Set();
    const takenBy = new Map();                 // key board → { teamKey, pick }
    const rosters = {};                       // teamKey → pick[] già draftate
    for (const g of grades) rosters[g.key] = [];
    const pickResults = {};                    // teamKey → analisi[]
    for (const g of grades) pickResults[g.key] = [];

    for (const { p, key } of flat) {
        // risolvi la pick alla voce del BOARD (nome Sleeper) via matching fuzzy:
        // così il giocatore preso viene tolto dal board disponibile ed è marcato
        // come "preso" anche se il nome del draft differisce da quello Sleeper.
        const hit = matchProjection(proj, p.player, p.pos);
        const pk = hit ? `${normName(hit.name)}|${p.pos}` : `${normName(p.player)}|${p.pos}`;
        const available = board.filter(e => !taken.has(e.key)); // include la pick corrente
        const res = analyzePick(p, repl, available, rosters[key], expectedVORatPick(p.pick), adpDisp, thr, pk);
        pickResults[key].push(res);
        taken.add(pk);
        takenBy.set(pk, { teamKey: key, pick: p.pick });
        rosters[key].push(p);
    }

    // board per posizione (top per VOR) con chi ha preso chi: alimenta la curva
    // di scarsità/tier nella pagina team. Solo l'attacco (K/DEF non hanno tier utili).
    const boardByPos = {};
    for (const pos of ['QB', 'RB', 'WR', 'TE']) {
        boardByPos[pos] = board.filter(e => e.pos === pos)
            .sort((a, b) => b.vor - a.vor).slice(0, 18)
            .map(e => {
                const tb = takenBy.get(e.key) || null;
                return {
                    name: e.name, team: e.team, adp: e.adp,
                    vor: Math.round(e.vor), value: Math.round(e.value),
                    takenBy: tb?.teamKey ?? null, pick: tb?.pick ?? null,
                };
            });
    }

    // aggregazione per squadra
    const byKey = {};
    for (const g of grades) {
        const list = g.list.filter(p => p.value != null);
        const results = pickResults[g.key].sort((a, b) => a.pick - b.pick);

        // media dei voti-pick pesata per draft-capital (le pick alte pesano di più)
        let num = 0, den = 0;
        for (const r of results) {
            const w = expectedVORatPick(r.pick) + 1;
            num += w * r.pickScore; den += w;
        }
        const avgPickGrade = den ? num / den : 50;

        // costruzione: quota di VOR nei titolari (anti bench-inflation) + bilanciamento
        const { starters } = pickStarters(list, 'value');
        const starterVOR = starters.reduce((s, p) => s + Math.max(0, (p.value || 0) - (repl[p.pos] || 0)), 0);
        const totalVOR = list.reduce((s, p) => s + Math.max(0, (p.value || 0) - (repl[p.pos] || 0)), 0);
        const starterShare = totalVOR ? starterVOR / totalVOR : 0;
        const starterAdj = (starterShare - agg.starterBase) * agg.starterMult;
        const balance = balanceScore(list);
        const balanceAdj = (balance - 50) * agg.balanceMult;

        const score = clamp(avgPickGrade + starterAdj + balanceAdj, 0, 100);

        // highlights (steal/reach: σ FFC quando c'è, altrimenti proxy Sleeper)
        const bestPick = [...results].sort((a, b) => b.pickScore - a.pickScore)[0] || null;
        const worstPick = [...results].sort((a, b) => a.pickScore - b.pickScore)[0] || null;
        const steals = results.filter(r => stealMetric(r) != null);
        const biggestSteal = steals.length ? [...steals].sort((a, b) => stealMetric(b) - stealMetric(a))[0] : null;
        const biggestReach = steals.length ? [...steals].sort((a, b) => stealMetric(a) - stealMetric(b))[0] : null;
        const leftOnBoard = results.reduce((s, r) => s + Math.max(0, -r.opportunityCost), 0);

        byKey[g.key] = {
            key: g.key,
            score: +score.toFixed(1),
            letter: letterFromScoreV2(score, thr),
            picks: results,
            components: {
                avgPickGrade: +avgPickGrade.toFixed(1),
                starterShare: +starterShare.toFixed(2),
                starterAdj: +starterAdj.toFixed(1),
                balance: +balance.toFixed(0),
                balanceAdj: +balanceAdj.toFixed(1),
                starterVOR: Math.round(starterVOR),
                totalVOR: Math.round(totalVOR),
            },
            bestPick, worstPick, biggestSteal, biggestReach,
            leftOnBoard: Math.round(leftOnBoard),
            whatIf: computeWhatIf(list, repl, results, starterVOR),
            narrative: buildNarrative(results, { starterShare, balance, biggestSteal, biggestReach }),
        };
    }

    const ranking = Object.values(byKey).sort((a, b) => b.score - a.score).map(t => t.key);
    ranking.forEach((k, i) => { byKey[k].rank = i + 1; });
    return { byKey, ranking, boardByPos };
}

/**
 * "What if?" — per le pick a maggior costo opportunità, sostituisce il giocatore
 * preso col miglior disponibile di allora e ricalcola il MIGLIOR lineup possibile.
 * Il segnale è Δ StarterVOR: quanti punti-titolare in più avrebbe reso la rosa.
 * Modello a swap singolo (approssimato ma coerente, come da piano FASE 14).
 */
function computeWhatIf(list, repl, results, baseStarterVOR) {
    const starterVORof = (l) => pickStarters(l, 'value').starters
        .reduce((s, p) => s + Math.max(0, (p.value || 0) - (repl[p.pos] || 0)), 0);

    const swaps = [];
    for (const r of results) {
        if (!r.bestAlt || r.opportunityCost >= -3) continue; // solo scelte con rimpianto reale
        const newList = list.map(p => p.pick === r.pick
            ? { ...p, pos: r.bestAlt.pos, value: r.bestAlt.value, player: r.bestAlt.name, nfl: r.bestAlt.team }
            : p);
        const delta = starterVORof(newList) - baseStarterVOR;
        if (delta < 3) continue; // solo swap che spostano davvero il miglior lineup
        swaps.push({
            pick: r.pick,
            from: { player: r.player, pos: r.pos },
            to: { player: r.bestAlt.name, pos: r.bestAlt.pos, team: r.bestAlt.team },
            deltaStarterVOR: Math.round(delta),
        });
    }
    return swaps.sort((a, b) => b.deltaStarterVOR - a.deltaStarterVOR).slice(0, 3);
}

/**
 * Racconto data-driven del draft: cosa è andato bene / cosa ha pesato.
 * Generato dai risultati v2, non hardcoded.
 */
function buildNarrative(results, { starterShare, balance, biggestSteal, biggestReach }) {
    const good = [], bad = [];
    // steal/reach in σ dall'ADP di consenso FFC (positivo = steal); null senza σ
    const isSteal = (r) => r.adpZ != null && r.adpZ >= 1;
    const isReach = (r) => r.adpZ != null && r.adpZ <= -1;
    const stealTxt = (r) => `${r.adpZ.toFixed(1)}σ sotto l'ADP`;
    const reachTxt = (r) => `${Math.abs(r.adpZ).toFixed(1)}σ sopra l'ADP`;
    const steals = results.filter(isSteal);
    const reaches = results.filter(isReach);
    const bigOpp = [...results].filter(r => r.opportunityCost <= -20)
        .sort((a, b) => a.opportunityCost - b.opportunityCost);
    const seized = results.filter(r => r.scarcity >= 25);
    const topGrades = results.filter(r => r.letter[0] === 'A');

    if (biggestSteal && isSteal(biggestSteal))
        good.push(`Colpo di mercato: ${biggestSteal.player} preso ${stealTxt(biggestSteal)}.`);
    if (steals.length >= 2)
        good.push(`${steals.length} scelte sotto l'ADP di consenso: draft efficiente sul valore.`);
    if (seized.length)
        good.push(`Tempismo sulla scarsità: ${seized.map(r => r.player).slice(0, 2).join(', ')} presi prima del crollo di valore al loro ruolo.`);
    if (starterShare >= 0.75)
        good.push(`Valore concentrato dove serve: il ${Math.round(starterShare * 100)}% del VOR è nei titolari, poca zavorra in panchina.`);
    if (topGrades.length >= 2)
        good.push(`${topGrades.length} pick da voto A: costanza nelle decisioni giro dopo giro.`);

    if (biggestReach && isReach(biggestReach))
        bad.push(`Reach più netto: ${biggestReach.player}, ${reachTxt(biggestReach)}.`);
    if (bigOpp.length)
        bad.push(`Valore lasciato sul board: a ${bigOpp[0].player} era ancora disponibile ${bigOpp[0].bestAlt?.name || 'un profilo migliore'} (−${Math.abs(bigOpp[0].opportunityCost)} need-adjusted).`);
    if (starterShare < 0.6)
        bad.push(`Troppo valore in panchina: solo il ${Math.round(starterShare * 100)}% del VOR finisce nei titolari.`);
    if (balance <= 45)
        bad.push(`Costruzione sbilanciata: buchi o surplus rispetto agli slot della lega.`);
    if (reaches.length >= 2)
        bad.push(`${reaches.length} anticipi marcati sull'ADP: draft-capital speso in fretta.`);

    return { good: good.slice(0, 4), bad: bad.slice(0, 4) };
}
