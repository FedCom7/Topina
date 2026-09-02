/**
 * Pre-Draft — il motore che trasforma il listone in decisioni.
 *
 * Board e Draft Strategy dicono che FORMA ha il board: chi proietta di più,
 * dove crolla il valore di ogni ruolo. Non dicono la cosa che serve al tavolo:
 * quanto vale un giocatore RISPETTO A QUANTO COSTA, quanto è rischioso, e cosa
 * fare al mio turno del terzo giro. Questo file calcola quello.
 *
 * Zero DOM: entra il listone, esce un oggetto. Il rendering sta in
 * js/sections/predraft.js.
 *
 * ── Le tre baseline, che sono tre e non una ───────────────────────────
 *  1. REPLACEMENT (`replacementLevels` di team-eval) — l'ultimo titolare utile
 *     alla lega. È il metro del VALORE ASSOLUTO: quanto sei sopra a quello che
 *     comunque metteresti in campo. Stesso identico metro del talento nei
 *     Draft Grades e della Draft Strategy: un solo VOR in tutto il sito.
 *  2. MERCATO (`marketCurve`) — quanto rende, di solito, il pick che stai per
 *     spendere. È il metro del PREZZO. Il valore sopra il replacement da solo
 *     non dice se hai fatto un affare: il miglior RB del board vale tantissimo
 *     sopra il replacement e costa esattamente quanto vale.
 *  3. ATTESA (`waitCost`) — quanto perdi a rimandare un ruolo di un turno.
 *     È il metro dell'URGENZA, ed è l'unico che risponde a "lo prendo adesso
 *     o posso aspettare?". Stessa idea VONA già argomentata nella nota di
 *     testa di draft-strategy.js: un crollo enorme che il mercato colloca al
 *     pick 60 non è urgente, ci arrivi comunque.
 *
 * Tenerle separate è il punto. Fonderle in un unico "punteggio" rifarebbe
 * esattamente l'errore che draft-grade.js ha già dovuto disfare una volta:
 * più pagelle affiancate e nessuna che si sa quale guardare.
 *
 * ── Cosa è dato vero e cosa è calcolato ───────────────────────────────
 * Ogni riga della board porta con sé la provenienza di ciò che mostra, perché
 * a schermo si deve poter distinguere. In sintesi:
 *   REAL       ADP di consenso, squadra, bye, anni di esperienza, infortunio,
 *              e TUTTO ciò che riguarda la stagione scorsa (quota bersagli,
 *              snap, punti a partita, game-log settimana per settimana).
 *   PROJECTED  punti e statistiche proiettate (Rotowire via Sleeper).
 *   CALCULATED VOR, tier, VAA, floor/median/ceiling, scarsità, rischio.
 * Quello che non esiste NON si stima: l'età anagrafica non è in nessuna
 * fonte offline, quindi si mostra l'ESPERIENZA e la si chiama così; i
 * bersagli proiettati non esistono (Sleeper proietta le RICEZIONI), quindi il
 * volume proiettato parla di ricezioni e portate, e la quota bersagli resta
 * dichiarata come dato dell'anno scorso.
 */

import { getSeasonProjections, getSeasonStats, normName } from './projections.js?v=592';
import { replacementLevels, demandByPos, NUM_TEAMS, getByeWeeks } from './team-eval.js?v=562';
import { NEED_TARGET, marketSurvival, getAdpDispersion } from './draft-grade.js?v=33';
import { computeStrategy, pickNumber, roundOf, ROUND_MAX, STRATEGY_POSITIONS } from './draft-strategy.js?v=47';
import { ROSTER_SLOTS, FLEX_ELIGIBLE, BENCH_SIZE, RESERVE_SIZE, SCORING } from './league-rules.js?v=528';
import { getRosterChange } from './roster-change.js?v=29';
import { computeSeasonMetrics } from './player-metrics.js?v=530';
import { getContextScore } from './context-score.js?v=615';
import { cacheGet, cacheSet, cacheAgeMs } from '../utils/storage.js?v=4';

const OFF = ['QB', 'RB', 'WR', 'TE'];
const ALL = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];
/** Quanti giocatori per ruolo entrano nella board: il doppio di quanti se ne
 *  draftano davvero, così si vede anche chi resta appena fuori. */
const BOARD_DEPTH = { QB: 24, RB: 44, WR: 48, TE: 24, K: 12, DEF: 12 };
/** Fascia oltre la quale l'ADP non è più un prezzo di questa lega: 4 squadre
 *  × 16 giri = 64 pick, e l'ADP è un ORDINE (vedi roundOf in draft-strategy). */
const LAST_PICK = NUM_TEAMS * ROUND_MAX;
/** Larghezza della finestra della curva di mercato (mediana mobile ±W). */
const CURVE_W = 3;
/** Soglia delle fasce di valore, in deviazioni standard del VAA sul board. */
const VALUE_SD = 0.5;
/** Avversione al rischio del "certainty equivalent": scelta di design dichiarata. */
const RISK_LAMBDA = 0.5;
/** Quanti giocatori d'attacco idratare col Context Score nella seconda fase. */
const CTX_LIMIT = 200;
const CTX_CONCURRENCY = 8;
const CTX_TTL_MS = 24 * 60 * 60 * 1000;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const median = (a) => {
    if (!a.length) return null;
    const s = [...a].sort((x, y) => x - y);
    const n = s.length;
    return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
};
const sd = (a) => {
    const m = mean(a);
    return m == null || a.length < 2 ? null : Math.sqrt(mean(a.map(v => (v - m) ** 2)));
};
const key = (name, pos) => `${normName(name)}|${(pos || '').toUpperCase()}`;

/* ═══════════════════════════ Fase 1 — la board ═══════════════════════════ */

/**
 * @param byPos struttura di projections.js — { POS: [{name,team,pts,adp,pick}] },
 *   già ordinata per punti proiettati decrescenti.
 * @returns null se non c'è abbastanza materiale per dire qualcosa di sensato.
 */
export async function buildPreDraft(byPos, year) {
    const strategy = computeStrategy(byPos);
    if (!strategy) return null;

    // tutto quello che serve alla fase 1, in parallelo. Ognuna di queste può
    // fallire da sola: la pagina si spegne a pezzi, non tutta insieme.
    const [proj, byes, change, prevStats, adpDisp] = await Promise.all([
        getSeasonProjections(year).catch(() => null),
        getByeWeeks(year).catch(() => null),
        getRosterChange(year).catch(() => null),
        getSeasonStats(Number(year) - 1).catch(() => null),
        getAdpDispersion(year).catch(() => null),
    ]);

    // VOR sullo STESSO replacement di Draft Strategy e del talento nei Draft
    // Grades: il pool è l'intero listone proiettato, non le pick.
    const pool = ALL.flatMap(pos =>
        (byPos[pos] || []).filter(p => p.pts != null).map(p => ({ pos, value: p.pts })));
    const repl = replacementLevels(pool, 'value');
    const demand = demandByPos();

    // tier già calcolati da computeStrategy: si riusano invece di rifarli, così
    // il tier mostrato qui è LO STESSO che disegna la tier map dell'altro tab
    const tierOf = {};
    for (const p of strategy.positions) {
        tierOf[p.pos] = new Map();
        for (const t of p.tiers) for (let r = t.fromRank; r <= t.toRank; r++) tierOf[p.pos].set(r, t.tier);
    }

    const board = [];
    for (const pos of ALL) {
        const list = (byPos[pos] || []).filter(p => p.pts != null).slice(0, BOARD_DEPTH[pos]);
        list.forEach((p, i) => {
            const k = key(p.name, pos);
            const e = proj?.get(k) || null;
            const ch = change?.byPlayer?.get(k) || null;
            const st = prevStats?.get(k) || null;
            const raw = e?.raw || {};
            const projGp = raw.gp || null;
            const teamAbbr = p.team || e?.team || null;
            const team = teamAbbr && change?.byTeam?.[teamAbbr] || null;
            board.push({
                key: k, name: p.name, pos, team: teamAbbr,
                bye: teamAbbr && byes ? (byes[teamAbbr] ?? null) : null,
                // PROJECTED
                proj: Math.round(p.pts),
                ppg: projGp ? +(p.pts / projGp).toFixed(1) : null,
                projGp,
                opp: projectedOpportunity(pos, raw, projGp),
                tdShareProj: tdShare(pos, raw, p.pts),
                // REAL
                adp: p.adp,
                // `roundOf` satura a 16: un ADP 194 e un ADP 70 escono tutti e
                // due "round 16". Per un board va bene (il giro esiste), per le
                // liste no — "miglior valore al giro 16" su un giocatore che in
                // una lega a 4 squadre non viene chiamato da nessuno è rumore.
                // `draftable` separa i due casi.
                adpRound: roundOf(p.adp),
                draftable: p.adp != null && p.adp <= LAST_PICK,
                exp: e?.yearsExp ?? ch?.yearsExp ?? null,
                rookie: (e?.yearsExp ?? ch?.yearsExp) === 0,
                injuryStatus: e?.injuryStatus || null,
                isStarter: ch?.isStarter ?? null,
                movedTeam: ch?.movedTeam ?? false,
                prevTeam: ch?.prevTeam ?? null,
                prior: ch?.prior || null,
                priorPosRank: st?.posRank ?? null,
                priorPts: st?.ptsLeague ?? st?.ptsStd ?? null,
                tdSharePrior: priorTdShare(st),
                // chi gli è arrivato in casa quest'anno a contendergli i palloni:
                // un RB contende portate, un ricevitore bersagli — confrontarli
                // fra loro direbbe che un RB fa concorrenza a un WR, che è falso
                competition: (team?.incoming || []).filter(c =>
                    c.name !== p.name && (pos === 'RB' ? c.rush >= c.tgt : c.tgt >= c.rush)).slice(0, 2),
                qbChange: team?.qbChanged ? { from: team.qbPrev, to: team.qb } : null,
                vacated: team ? { tgt: team.vacTgtShare, rush: team.vacRushShare } : null,
                // CALCULATED
                posRank: i + 1,
                vor: Math.round(p.pts - (repl[pos] || 0)),
                tier: tierOf[pos]?.get(i + 1) ?? null,
                pick: p.pick || null,
                // riempiti sotto / in fase 2
                adpRank: null, vaa: null, adpEdge: null, valueBand: null,
                cv: null, floor: null, median: null, ceiling: null, ce: null,
                dist: null, riskProfile: null, ctx: null,
            });
        });
    }
    if (!board.length) return null;

    attachDistribution(board);
    const marketCurve = attachValue(board);
    const positions = buildPositions(strategy, board, repl, demand);
    const byKey = new Map(board.map(r => [r.key, r]));

    const ctx = {
        year: String(year), board, byKey, marketCurve, positions, strategy,
        change, adpDisp, hasAdpDispersion: !!adpDisp,
        meta: buildMeta(year, adpDisp, change, byes),
    };
    ctx.value = valueLists(board);
    ctx.signals = buildSignals(ctx);
    ctx.outlook = buildOutlook(ctx);
    return ctx;
}

/** Formazione, punteggio e dimensioni della lega — dalle regole ufficiali. */
function buildMeta(year, adpDisp, change, byes) {
    const slots = Object.entries(ROSTER_SLOTS).flatMap(([s, n]) =>
        Array.from({ length: n }, () => s));
    return {
        year: String(year),
        teams: NUM_TEAMS,
        rounds: ROUND_MAX,
        lastPick: LAST_PICK,
        scoring: SCORING.rec === 1 ? 'Full PPR' : SCORING.rec === 0.5 ? 'Half PPR' : 'Standard',
        ppr: SCORING.rec,
        slots,
        starters: slots.length,
        bench: BENCH_SIZE,
        reserve: RESERVE_SIZE,
        flex: 'RB/WR',
        priorYear: Number(year) - 1,
        // quali pezzi di contesto sono davvero arrivati: la pagina lo dichiara
        hasAdpDispersion: !!adpDisp,
        hasRosterChange: !!change,
        hasByes: !!byes,
        projAgeMs: cacheAgeMs(`topina_proj_v5_${year}`),
    };
}

/* ─────────────────────────── volume e touchdown ─────────────────────────── */

/**
 * Opportunità PROIETTATA. Attenzione: Sleeper non proietta i BERSAGLI —
 * verificato sull'endpoint 2026, i campi sono `rec` (ricezioni), `rush_att`,
 * `pass_att`. Quindi qui si parla di ricezioni e portate, e il target share
 * resta un dato dell'anno scorso, etichettato come tale.
 */
function projectedOpportunity(pos, raw, gp) {
    const per = (v) => (v != null && gp ? +(v / gp).toFixed(1) : null);
    if (pos === 'QB') {
        return { passAtt: raw.pass_att ?? null, rushAtt: raw.rush_att ?? null,
            attPerGame: per(raw.pass_att), touchPerGame: per((raw.pass_att || 0) + (raw.rush_att || 0)) };
    }
    if (pos === 'RB' || pos === 'WR' || pos === 'TE') {
        const touch = (raw.rush_att || 0) + (raw.rec || 0);
        return { rec: raw.rec ?? null, rushAtt: raw.rush_att ?? null,
            touch: touch || null, touchPerGame: per(touch) };
    }
    return null;
}

/** Quota di punti PROIETTATI che arriva dai touchdown (scoring della lega). */
function tdShare(pos, raw, pts) {
    if (!pts || pts <= 0) return null;
    const td = (raw.rush_td || 0) * SCORING.rush_td
        + (raw.rec_td || 0) * SCORING.rec_td
        + (raw.pass_td || 0) * SCORING.pass_td;
    return td > 0 ? +(td / pts).toFixed(3) : null;
}

/** Stessa quota, ma sulla stagione VERA appena chiusa (getSeasonStats v5). */
function priorTdShare(st) {
    if (!st) return null;
    const pts = st.ptsLeague ?? st.ptsStd ?? null;
    if (!pts || pts <= 0) return null;
    const td = (st.rushTd || 0) * SCORING.rush_td
        + (st.recTd || 0) * SCORING.rec_td
        + (st.passTd || 0) * SCORING.pass_td;
    return td > 0 ? +(td / pts).toFixed(3) : null;
}

/* ───────────────────── floor / median / ceiling / rischio ───────────────── */

/**
 * La banda di valore di ogni giocatore, dalla variabilità VERA settimana per
 * settimana della stagione scorsa (`adv_players_{Y-1}.weekly`).
 *
 * `proj × (1 ∓ 0.9·cv)` è la stessa formula già a schermo nei Draft Grades
 * (context-score.js): un solo metro in tutto il sito. Chi non ha un game-log —
 * i rookie, chi ha saltato l'anno — resta a `null`, e a schermo diventa N/A.
 * Un floor inventato per un rookie sarebbe il numero più pericoloso della
 * pagina: proprio dove l'incertezza è massima direbbe di essere sicuro.
 *
 * Il profilo di rischio si taglia sui QUARTILI DEL RUOLO, non su una soglia
 * assoluta: un TE con cv 0.6 è normale, un RB con cv 0.6 è un'altalena.
 */
function attachDistribution(board) {
    for (const r of board) {
        const weekly = r.prior?.weekly;
        const m = weekly?.length >= 3 ? computeSeasonMetrics(weekly.map(p => ({ pts: p }))) : null;
        if (!m || m.cv == null) continue;
        const cv = clamp(m.cv, 0.15, 1.2);
        r.cv = +cv.toFixed(2);
        r.dist = { boomPct: m.boomPct, bustPct: m.bustPct, gp: m.gp, fpg: m.media, trend: m.trend };
        r.median = r.proj;
        r.floor = Math.round(r.proj * (1 - 0.9 * cv));
        r.ceiling = Math.round(r.proj * (1 + 0.9 * cv));
        // valore equivalente certo: penalizza chi arriva in alto solo a volte
        r.ce = Math.round(r.median - RISK_LAMBDA * (r.median - r.floor));
    }
    // quartili del cv dentro ogni ruolo
    for (const pos of ALL) {
        const vals = board.filter(r => r.pos === pos && r.cv != null).map(r => r.cv).sort((a, b) => a - b);
        if (vals.length < 4) continue;
        const q = (f) => vals[Math.min(vals.length - 1, Math.floor(f * vals.length))];
        const q1 = q(0.25), q2 = q(0.5), q3 = q(0.75);
        for (const r of board) {
            if (r.pos !== pos || r.cv == null) continue;
            let p = r.cv <= q1 ? 'SAFE' : r.cv <= q2 ? 'MODERATE' : r.cv <= q3 ? 'VOLATILE' : 'HIGH RISK';
            // un infortunio in corso o una stagione monca spostano di una fascia:
            // la variabilità dei punti non sa niente delle partite non giocate
            const fragile = !!r.injuryStatus || (r.prior?.gp != null && r.prior.gp <= 12);
            if (fragile) p = { SAFE: 'MODERATE', MODERATE: 'VOLATILE', VOLATILE: 'HIGH RISK', 'HIGH RISK': 'HIGH RISK' }[p];
            r.riskProfile = p;
        }
    }
}

/* ──────────────────────── prezzo: la curva di mercato ───────────────────── */

/**
 * Quanto rende, di solito, il pick che stai per spendere.
 *
 * Si ordina il board per ADP — che è un ORDINE di uscita, non un numero di
 * pick legato alla dimensione della lega — e per ogni posizione si prende la
 * MEDIANA del VOR in una finestra di ±3. La mediana e non la media perché la
 * curva deve descrivere il pick TIPICO: un solo giocatore fuori scala (un TE
 * elite in mezzo a dei WR) sposterebbe la media e farebbe sembrare "sotto
 * prezzo" tutti i suoi vicini.
 *
 * Poi VAA = VOR del giocatore − curva alla sua posizione di mercato: quanto
 * prendi in più (o in meno) di quello che quel prezzo compra di solito.
 * Chi non ha ADP non ha un prezzo, quindi non ha un VAA: resta null.
 */
function attachValue(board) {
    /**
     * Solo l'ATTACCO entra nella curva di mercato — stessa esclusione, e per la
     * stessa ragione, che draft-strategy.js applica a VORP e leaderboard.
     * Sleeper non proietta kicker e difese al livello di dettaglio dove questo
     * scoring si discosta (fasce di field goal, punti subiti), quindi il loro
     * VOR è costruito su un numero grossolano. Mescolarlo con quello degli altri
     * dava, letteralmente a schermo, "Los Angeles Rams DEF, +43 sul prezzo" più
     * in alto di metà dei ricevitori titolari: il consiglio implicito era
     * "prendi la difesa presto", che è il singolo errore più caro di un draft.
     * Restano sulla board e restano nel piano (ultimi due giri), ma senza un
     * prezzo da confrontare con quello dell'attacco.
     */
    const priced = board.filter(r => OFF.includes(r.pos) && r.adp != null && r.adp <= LAST_PICK * 1.6)
        .sort((a, b) => a.adp - b.adp);
    priced.forEach((r, i) => { r.adpRank = i + 1; });
    if (priced.length < 8) return [];

    const vors = priced.map(r => r.vor);
    const curve = priced.map((_, i) => {
        const from = Math.max(0, i - CURVE_W), to = Math.min(vors.length, i + CURVE_W + 1);
        return median(vors.slice(from, to));
    });
    priced.forEach((r, i) => {
        r.vaa = Math.round(r.vor - curve[i]);
    });

    // lo stesso scarto detto in PICK invece che in punti: "il listone dice che
    // dovrebbe uscire N scelte prima". Più concreto di un delta in punti quando
    // devi decidere se aspettare un giro.
    const byValue = [...priced].sort((a, b) => b.vor - a.vor);
    const valueRank = new Map(byValue.map((r, i) => [r.key, i + 1]));
    for (const r of priced) r.adpEdge = r.adpRank - valueRank.get(r.key);

    /**
     * Le fasce sono GLOBALI, non per ruolo — ed è una correzione, non una
     * semplificazione. Il VOR è già normalizzato per ruolo: è esattamente il
     * suo mestiere togliere di mezzo il fatto che un QB segni più punti di un
     * WR. Bandare di nuovo dentro il ruolo lo faceva due volte, e produceva
     * l'assurdo visibile a schermo: un quarterback con "+21 vs ADP" elencato
     * sotto "costa più di quanto proietta", perché +21 stava comunque sotto la
     * media dei QB. Un numero positivo in una lista di giocatori cari è un
     * errore, non una sfumatura.
     */
    const vals = priced.map(r => r.vaa);
    const m = mean(vals), s = sd(vals);
    if (m != null && s) {
        for (const r of priced) {
            r.valueBand = r.vaa >= m + VALUE_SD * s ? 'value'
                : r.vaa <= m - VALUE_SD * s ? 'over' : 'fair';
        }
    }
    return priced.map((r, i) => ({ x: r.adp, y: curve[i] }));
}

function valueLists(board) {
    const priced = board.filter(r => r.vaa != null && r.draftable);
    const by = (b) => priced.filter(r => r.valueBand === b);
    return {
        best: by('value').sort((a, b) => b.vaa - a.vaa).slice(0, 12),
        over: by('over').sort((a, b) => a.vaa - b.vaa).slice(0, 12),
        neutral: by('fair').sort((a, b) => (a.adp ?? 999) - (b.adp ?? 999)).slice(0, 8),
    };
}

/* ─────────────────────────── scarsità posizionale ───────────────────────── */

/**
 * Profondità e scarsità di ogni ruolo.
 *
 * La scarsità NON è "quanto è forte il primo" (quello è il VOR, e da solo
 * manda fuori strada: il QB1 stacca tantissimo il QB4 ma di QB titolari ce ne
 * sono 32 per 4 posti). È il COSTO DELL'ATTESA: se rimando questo ruolo al mio
 * prossimo turno, quanto valore perdo? Si misura sull'ordine di mercato,
 * l'unica cosa osservabile prima che il draft esista.
 *
 * Si media su TUTTI E QUATTRO gli slot dello snake, non sul tuo: la scarsità
 * di un ruolo è una proprietà del board, non della tua posizione. Quello che
 * dipende dallo slot è il PIANO, che infatti si calcola a parte.
 *
 * Le fasce sono relative alla stagione — il ruolo che costa di più aspettare
 * fa 1.0 e gli altri si misurano su di lui — e la pagina lo dice. Soglie
 * assolute sarebbero numeri inventati: il costo dell'attesa dipende dalla
 * forma del board di quell'anno, che cambia ogni anno.
 */
function buildPositions(strategy, board, repl, demand) {
    const waits = {};
    for (const pos of STRATEGY_POSITIONS) waits[pos] = waitCost(board, pos);
    const maxWait = Math.max(...Object.values(waits), 1);

    return strategy.positions.map(p => {
        const rows = board.filter(r => r.pos === p.pos);
        const pts = rows.map(r => r.proj);
        const topN = (n) => mean(pts.slice(0, n));
        const needed = Math.round(demand[p.pos] || 0);
        const rel = waits[p.pos] / maxWait;
        return {
            ...p,
            depth: {
                top5: topN(5), top10: topN(10), top12: topN(12), top24: topN(24), top36: topN(36),
                median: median(pts),
                aboveReplacement: rows.filter(r => r.vor > 0).length,
                elite: rows[0] ? rows[0].proj - (repl[p.pos] || 0) : null,
                starter: rows[needed - 1] ? rows[needed - 1].proj - (repl[p.pos] || 0) : null,
                total: rows.length,
            },
            waitCost: Math.round(waits[p.pos]),
            waitRel: +rel.toFixed(2),
            scarcity: rel >= 0.75 ? 'Extreme' : rel >= 0.45 ? 'High' : rel >= 0.20 ? 'Medium' : 'Low',
            cliffRound: p.cliffAdp != null ? roundOf(p.cliffAdp) : null,
            // fino a che giro il ruolo regge: l'ultimo turno in cui il migliore
            // ancora atteso disponibile sta sopra il replacement
            holdsUntil: holdsUntilRound(board, p.pos),
        };
    });
}

/** Il miglior VOR fra chi il mercato non ha ancora tolto dal board alla pick `p`. */
function bestAt(rows, p) {
    let best = -Infinity;
    for (const r of rows) {
        const rank = r.adpRank ?? Infinity;
        if (rank > p && r.vor > best) best = r.vor;
    }
    return best === -Infinity ? null : best;
}

function waitCost(board, pos) {
    const rows = board.filter(r => r.pos === pos && r.adpRank != null);
    if (rows.length < 3) return 0;
    let total = 0, n = 0;
    for (let slot = 1; slot <= NUM_TEAMS; slot++) {
        // i primi otto giri: dopo, le scelte non le decide più la scarsità
        for (let round = 1; round < 8; round++) {
            const now = bestAt(rows, pickNumber(slot, round));
            const next = bestAt(rows, pickNumber(slot, round + 1));
            if (now == null || next == null) continue;
            total += Math.max(0, now - next);
            n++;
        }
    }
    return n ? total / n * (ROUND_MAX / 8) : 0;
}

function holdsUntilRound(board, pos) {
    const rows = board.filter(r => r.pos === pos && r.adpRank != null);
    for (let round = ROUND_MAX; round >= 1; round--) {
        // il turno peggiore del giro (slot 1 in un giro pari, slot 4 in uno dispari)
        const worst = Math.max(...Array.from({ length: NUM_TEAMS }, (_, i) => pickNumber(i + 1, round)));
        const best = bestAt(rows, worst);
        if (best != null && best >= 0) return round;
    }
    return null;
}

/* ───────────────────────── breakout e segnali di rischio ────────────────── */

/**
 * I segnali, e da dove vengono. Nessuno è un'opinione: ognuno è un numero che
 * si può andare a controllare. Quelli che il repo non ha — snap share della
 * stagione che deve cominciare, cambi di coordinatore, valutazioni della linea
 * offensiva — semplicemente non compaiono, invece di essere approssimati.
 */
function buildSignals(ctx) {
    const { board, change } = ctx;
    for (const r of board) {
        if (!OFF.includes(r.pos)) continue;
        r.breakout = breakoutSignals(r, change);
        r.risk = riskSignals(r);
    }
    const draftable = board.filter(r => OFF.includes(r.pos) && r.draftable);
    return {
        // un breakout si cerca dove il prezzo lascia margine (dal 3° giro in
        // poi) ma dentro la fascia che questa lega chiama davvero: oltre le 64
        // pick il "colpo" è un giocatore che sarebbe rimasto lì comunque
        breakout: draftable
            .filter(r => r.breakout?.reasons.length >= 2 && r.adpRound >= 3
                // se il prezzo lo sta gia strapagando non e un'occasione: la
                // stessa pagina lo elencava fra i buoni affari e fra i cari
                && r.valueBand !== 'over')
            .sort((a, b) => b.breakout.score - a.breakout.score).slice(0, 8),
        risk: draftable
            .filter(r => r.risk?.reasons.length >= 2 && r.adpRound <= 10)
            .sort((a, b) => b.risk.score - a.risk.score).slice(0, 8),
    };
}

function breakoutSignals(r, change) {
    const reasons = [];
    let score = 0;
    const team = r.team && change?.byTeam?.[r.team] || null;

    // 1. palloni liberati dalla squadra (REAL, ricalcolato da roster-change.js).
    // Solo per chi quei palloni li riceve: un quarterback non eredita i bersagli
    // di un ricevitore andato via, e attribuirglielo era semplicemente falso.
    if (team && r.pos !== 'QB') {
        const isRush = r.pos === 'RB';
        const share = isRush ? team.vacRushShare : team.vacTgtShare;
        const what = isRush ? 'carries' : 'targets';
        if (share != null && share >= 0.25) {
            const gone = (isRush ? team.departed.filter(d => d.rush >= 0.1) : team.departed.filter(d => d.tgt >= 0.1))
                .slice(0, 2).map(d => d.name);
            reasons.push({
                kind: 'vacated', weight: share,
                text: `${r.team} lost ${Math.round(share * 100)}% of last season's ${what}${gone.length ? ` — ${gone.join(' and ')} ${gone.length === 1 ? 'is' : 'are'} gone` : ''}`,
            });
            score += share * 40;
        }
    }
    // 2. cambio squadra (REAL)
    if (r.movedTeam && r.prevTeam) {
        reasons.push({ kind: 'move', weight: 0.4, text: `New team: ${r.prevTeam} → ${r.team}` });
        score += 8;
    }
    // 3. volume proiettato sopra quello vero dell'anno scorso (PROJECTED vs REAL)
    const prevTouch = r.pos === 'QB'
        ? null
        : (r.prior?.tgtPerGame != null || r.prior?.carriesPerGame != null)
            ? (r.prior.tgtPerGame || 0) + (r.prior.carriesPerGame || 0) : null;
    if (prevTouch != null && prevTouch > 0 && r.opp?.touchPerGame != null) {
        const lift = r.opp.touchPerGame / prevTouch - 1;
        if (lift >= 0.20) {
            reasons.push({
                kind: 'volume', weight: lift,
                text: `Projected for ${r.opp.touchPerGame} touches a game, up from ${prevTouch.toFixed(1)} last season`,
            });
            score += clamp(lift, 0, 1) * 25;
        }
    }
    // 4. giovane con la curva ancora davanti (REAL: esperienza, non età)
    if (r.exp != null && r.exp <= 2 && r.priorPts != null) {
        reasons.push({ kind: 'young', weight: 0.3, text: `${r.exp === 0 ? 'Rookie' : `${r.exp} ${r.exp === 1 ? 'season' : 'seasons'} in`} — still on the rising side of the curve` });
        score += 6;
    }
    // 5. il prezzo è indietro rispetto alla proiezione (CALCULATED)
    if (r.valueBand === 'value' && r.adpEdge > 0) {
        reasons.push({ kind: 'value', weight: 0.5, text: `Projects ${r.adpEdge} picks earlier than the market takes him (ADP ${Math.round(r.adp)})` });
        score += clamp(r.adpEdge / 2, 0, 14);
    }
    // 6. tendenza dei punti a partita in salita nel game-log dell'anno scorso
    // (REAL). Almeno sei gare: su tre partite la pendenza è un caso, e infatti
    // dava "+8,97 punti a settimana" su un quarterback di riserva.
    if (r.dist?.trend?.label === 'up' && (r.dist.gp || 0) >= 6) {
        reasons.push({ kind: 'trend', weight: 0.3, text: `Scoring trended up through last season (+${r.dist.trend.slope} pts a week)` });
        score += 6;
    }
    // 7. contesto: attacco forte e calendario propizio (arriva in fase 2)
    if (r.ctx?.teamOffense != null && r.ctx.teamOffense >= 70) {
        reasons.push({ kind: 'offense', weight: 0.4, text: `${r.team}'s offence ranked in the top ${Math.round(100 - r.ctx.teamOffense)}% by EPA per play last season` });
        score += 7;
    }
    if (r.ctx?.schedule != null && r.ctx.schedule >= 70) {
        reasons.push({ kind: 'schedule', weight: 0.3, text: `One of the easier schedules for a ${r.pos} this season (SOS+ ${r.ctx.schedule}/100)` });
        score += 5;
    }
    // il ranking dei breakout resta stabile: si tagliano comunque a 4 le
    // motivazioni mostrate, ma il punteggio le pesa tutte
    return { score: Math.round(score), reasons: reasons.slice(0, 4) };
}

function riskSignals(r) {
    const reasons = [];
    let score = 0;

    // 1. prezzo sopra la proiezione (CALCULATED)
    if (r.valueBand === 'over' && r.vaa != null) {
        reasons.push({ kind: 'price', weight: 0.6, text: `Costs a pick that usually returns ${Math.abs(r.vaa)} more points than he projects` });
        score += clamp(Math.abs(r.vaa) / 3, 0, 18);
    }
    // 2. dipendenza dai touchdown (PROJECTED, e REAL quando c'è)
    if (r.tdShareProj != null && r.tdShareProj >= 0.35) {
        const prior = r.tdSharePrior != null ? ` (${Math.round(r.tdSharePrior * 100)}% of his real points last season came the same way)` : '';
        reasons.push({ kind: 'td', weight: r.tdShareProj, text: `${Math.round(r.tdShareProj * 100)}% of the projection is touchdowns${prior} — the most regression-prone way to score` });
        score += (r.tdShareProj - 0.3) * 45;
    }
    // 3. infortunio dichiarato (REAL)
    if (r.injuryStatus) {
        reasons.push({ kind: 'injury', weight: 0.7, text: `Listed ${String(r.injuryStatus).toLowerCase()} on the official report` });
        score += 14;
    }
    // 4. stagione monca alle spalle (REAL)
    if (r.prior?.gp != null && r.prior.gp <= 12) {
        reasons.push({ kind: 'games', weight: 0.5, text: `Played ${r.prior.gp} of 17 games last season` });
        score += (17 - r.prior.gp) * 1.2;
    }
    // 5. curva esperienza oltre il picco del ruolo (REAL: esperienza, non età)
    const cliff = { RB: 6, WR: 9, TE: 9, QB: 13 }[r.pos];
    if (r.exp != null && cliff && r.exp >= cliff) {
        reasons.push({ kind: 'age', weight: 0.4, text: `${r.exp} seasons in — past where ${r.pos}s usually hold their level` });
        score += (r.exp - cliff + 1) * 3;
    }
    // 6. volatilità settimana per settimana (CALCULATED da dato REAL)
    if (r.riskProfile === 'HIGH RISK' && r.dist?.bustPct != null) {
        reasons.push({ kind: 'volatile', weight: 0.4, text: `Scored under half his own average in ${r.dist.bustPct}% of last season's games` });
        score += r.dist.bustPct / 4;
    }
    // 7. volume proiettato in calo (PROJECTED vs REAL)
    const prevTouch = (r.prior?.tgtPerGame || 0) + (r.prior?.carriesPerGame || 0);
    if (prevTouch > 4 && r.opp?.touchPerGame != null && r.opp.touchPerGame / prevTouch - 1 <= -0.15) {
        reasons.push({ kind: 'volume', weight: 0.5, text: `Projected for fewer touches than last season (${r.opp.touchPerGame} vs ${prevTouch.toFixed(1)} a game)` });
        score += 9;
    }
    // 8. concorrenza arrivata nella sua room quest'anno (REAL, da roster-change)
    if (r.competition?.length) {
        const c = r.competition[0];
        reasons.push({
            kind: 'competition', weight: 0.5,
            text: `${c.name} arrives from ${c.from} carrying ${Math.round(Math.max(c.tgt, c.rush) * 100)}% of his old team's ${c.rush > c.tgt ? 'carries' : 'targets'}`,
        });
        score += 8;
    }
    // 9. cambio di quarterback per un ricevitore (REAL, da roster.starters)
    if (r.qbChange && ['WR', 'TE', 'RB'].includes(r.pos)) {
        reasons.push({ kind: 'qb', weight: 0.4, text: `New quarterback in ${r.team}: ${r.qbChange.from} → ${r.qbChange.to}` });
        score += 6;
    }
    // 10. i due segnali che arrivano in fase 2 (modello e calendario)
    if (r.ctx?.bustProb != null && r.ctx.bustProb >= 0.4) {
        reasons.push({ kind: 'model', weight: r.ctx.bustProb, text: `The trained flop model puts him at ${Math.round(r.ctx.bustProb * 100)}% — it beats the base rate in 6 of 7 backtested seasons` });
        score += (r.ctx.bustProb - 0.35) * 40;
    }
    if (r.ctx?.schedule != null && r.ctx.schedule <= 30) {
        reasons.push({ kind: 'schedule', weight: 0.3, text: `One of the harder schedules for a ${r.pos} this season (SOS+ ${r.ctx.schedule}/100)` });
        score += 5;
    }
    return { score: Math.round(score), reasons: reasons.slice(0, 4) };
}

/* ─────────────────────────────── Draft Outlook ──────────────────────────── */

/**
 * Le frasi in cima alla pagina. Nessuna è scritta a mano: ognuna esiste solo
 * se il numero che la genera supera la sua soglia, e il numero è dentro la
 * frase così si può contestare.
 */
function buildOutlook(ctx) {
    const out = [];
    const pos = ctx.positions;
    const byWait = [...pos].sort((a, b) => b.waitRel - a.waitRel);

    const scarcest = byWait[0];
    if (scarcest && scarcest.cliffRound) {
        out.push({
            tone: 'warn',
            text: `${scarcest.pos} is the position you cannot wait on: its first real drop lands around round ${scarcest.cliffRound}, and passing on it for one turn costs ${scarcest.waitCost} points of value on average.`,
        });
    }
    const deepest = byWait[byWait.length - 1];
    if (deepest && deepest !== scarcest) {
        out.push({
            tone: 'good',
            text: `${deepest.pos} is the deep one — ${deepest.depth.aboveReplacement} of them project above replacement and the best available still clears it through round ${deepest.holdsUntil ?? ROUND_MAX}. Waiting costs almost nothing.`,
        });
    }
    // Un tier che si stacca nettamente — ma MAI sul ruolo appena definito
    // profondo: "il QB si aspetta" seguito da "il primo tier di QB è uno solo"
    // sono due frasi vere che, una sotto l'altra, si leggono come una
    // contraddizione. Quella che conta è la prima: se aspettare non costa,
    // che il primo sia irraggiungibile non cambia il piano.
    for (const p of pos) {
        if (p === deepest) continue;
        const t1 = p.tiers?.[0];
        if (t1?.material && t1.size <= NUM_TEAMS && t1.dropNext != null) {
            out.push({
                tone: 'warn',
                text: `The top ${p.pos} tier is ${t1.size} player${t1.size === 1 ? '' : 's'} for ${NUM_TEAMS} teams, and the drop to the next one is ${t1.dropNext} points. Someone is going home without it.`,
            });
            break;
        }
    }
    // valori tardivi
    const late = ctx.value.best.filter(r => r.adpRound != null && r.adpRound >= 8);
    if (late.length >= 2) {
        const posCount = {};
        for (const r of late) posCount[r.pos] = (posCount[r.pos] || 0) + 1;
        const top = Object.entries(posCount).sort((a, b) => b[1] - a[1])[0];
        out.push({
            tone: 'good',
            text: `${late.length} of the best values on the board go after round 8${top ? `, ${top[1]} of them at ${top[0]}` : ''} — there is no need to reach early for them.`,
        });
    }
    // quanto è affollato il prezzo in cima
    const over = ctx.value.over.filter(r => r.adpRound != null && r.adpRound <= 3);
    if (over.length) {
        out.push({
            tone: 'warn',
            text: `${over.length} player${over.length === 1 ? '' : 's'} inside the first three rounds ${over.length === 1 ? 'costs' : 'cost'} more than the projection supports — the early rounds are where the market is most confident and most exposed.`,
        });
    }
    return out.slice(0, 5);
}

/* ═════════════════════ Fase 1b — il piano, che dipende dallo slot ════════ */

/**
 * Giro per giro, dal tuo posto nello snake.
 *
 * Non sono sedici liste indipendenti: a ogni giro il piano assume che tu abbia
 * preso il tuo primo obiettivo, e il fabbisogno che ne risulta cambia i
 * consigli dei giri dopo. Un piano che a ogni giro ti dicesse "prendi il
 * miglior giocatore disponibile" ignorando quello che hai già in rosa non
 * sarebbe un piano — sarebbe la board ordinata sedici volte.
 *
 * "Chi è ancora lì" viene da `marketSurvival`, la stessa funzione con cui i
 * Draft Grades giudicano se una pick poteva aspettare: un solo metro.
 * Quando manca la dispersione ADP (nessun adp_ffc_{Y}.json — è il caso del
 * 2026) la funzione usa il suo σ minimo e la stima resta più grezza: la
 * pagina lo dichiara invece di far finta di niente.
 */
export function buildRoundPlan(ctx, slot) {
    if (!ctx?.board?.length) return [];
    const pool = ctx.board.filter(r => r.adpRank != null || r.vor > 0);
    const roster = [];
    const plan = [];

    for (let round = 1; round <= ROUND_MAX; round++) {
        const p = pickNumber(slot, round);
        const next = round < ROUND_MAX ? pickNumber(slot, round + 1) : null;
        const taken = new Set(roster.map(r => r.key));
        // K e DEF solo negli ultimi due giri, come già fa la simulazione
        // dell'altro tab: fra loro non c'è quasi scelta, e spenderci un pick
        // prima è il singolo errore più costoso che si possa fare qui.
        const kdefTime = round > ROUND_MAX - 2;

        const cand = pool
            .filter(r => !taken.has(r.key) && (kdefTime || OFF.includes(r.pos)))
            .map(r => {
                const entry = { key: r.key, adp: r.adp, pos: r.pos };
                const here = survivesTo(entry, p, ctx.adpDisp);
                const later = next ? survivesTo(entry, next, ctx.adpDisp) : 0;
                const need = rosterNeed(roster, r.pos);
                // valore atteso: quanto vale × quanto è probabile che ci sia,
                // scontato da quanto quel ruolo ti serve ancora. Il pavimento
                // è basso apposta: un giocatore il cui slot titolare è già
                // coperto entra in panchina, e in panchina si segna zero.
                const ev = r.vor * here * (0.15 + 0.85 * need);
                return { row: r, here, later, need, ev, urgency: here - later };
            })
            // fuori chi non ha più un posto (need 0) e chi non arriva al turno
            .filter(c => c.need > 0 && c.here >= 0.08)
            .sort((a, b) => b.ev - a.ev);

        if (!cand.length) break;

        const targets = cand.slice(0, 4);
        const best = targets[0];
        // da evitare: costa questo giro e il prezzo non regge la proiezione
        const avoid = cand
            .filter(c => c.row.valueBand === 'over' && c.row.adpRound === round && c.here >= 0.3)
            .sort((a, b) => a.row.vaa - b.row.vaa).slice(0, 2);
        /**
         * Su cosa puoi aspettare: ruoli che al prossimo turno perdono poco.
         * MAI il ruolo che il piano ti sta consigliando adesso — "prendi
         * Bowers" con sotto "sul TE puoi aspettare, Bowers c'è anche dopo" sono
         * due consigli opposti nella stessa riga. Se il piano sceglie quel
         * ruolo è perché aspettare non conviene, e il posto giusto per il
         * dubbio è la lista delle alternative, non questa.
         */
        const wait = STRATEGY_POSITIONS.filter(pos => pos !== best.row.pos).map(pos => {
            const now = cand.find(c => c.row.pos === pos);
            const then = next ? cand.find(c => c.row.pos === pos && c.later >= 0.5) : null;
            if (!now || !then) return null;
            return { pos, loss: Math.round(now.row.vor - then.row.vor), name: then.row.name };
        }).filter(w => w && w.loss <= 3);

        plan.push({
            round, pick: p, nextPick: next,
            best, targets, avoid, wait,
            fallback: cand.slice(4, 7),
            roster: roster.map(r => r.pos),
            needs: STRATEGY_POSITIONS.filter(pos => rosterNeed(roster, pos) > 0.5),
        });
        roster.push(best.row);
    }
    return plan;
}

/**
 * "Ce l'ho già lì o mi manca?" — e la risposta non è lineare.
 *
 * `needFactor` di draft-grade.js divide per NEED_TARGET, che è la profondità di
 * ROSTER (TE 2, RB 5…): dopo un tight end il fabbisogno scendeva a 0.5 e il
 * secondo TE restava competitivo. Nel piano si vedeva — quattro giri, due tight
 * end, in una lega che ne schiera uno. Il salto vero non è a metà del roster: è
 * quando lo SLOT TITOLARE è coperto, perché da lì in poi quel giocatore non
 * gioca, sta in panchina.
 *
 * Tre gradini, quindi: slot titolare scoperto = pieno; FLEX ancora libero =
 * quasi pieno (il FLEX di questa lega è solo RB/WR, da league-rules); panchina
 * = meno della metà, perché un panchinaro vale davvero solo se qualcuno si fa
 * male.
 *
 * E poi uno ZERO SECCO, che è la parte che conta di più. Raggiunta la
 * profondità sana del ruolo (NEED_TARGET: 2 QB, 2 TE, 5 RB, 5 WR) il ruolo è
 * chiuso e il giocatore esce proprio dai candidati. Senza, il piano diventava
 * indifendibile: sei quarterback e cinque tight end in sedici giri, in una lega
 * che ne schiera uno per parte. Il motivo è che il VOR di un QB resta alto
 * anche in fondo al pool mentre quello di un RB crolla dopo il secondo giro, e
 * uno sconto morbido non basta a battere quella differenza. Ma il VOR del
 * QUINTO quarterback non è "poco valore": è valore che non scenderà mai in
 * campo, cioè zero. Il modello deve dire zero.
 */
function rosterNeed(roster, pos) {
    const have = roster.filter(r => r.pos === pos).length;
    const starters = ROSTER_SLOTS[pos] || 0;
    if (have >= (NEED_TARGET[pos] || 1)) return 0;
    if (have < starters) return 1;
    if (FLEX_ELIGIBLE.includes(pos)) {
        const overflow = FLEX_ELIGIBLE.reduce((n, q) =>
            n + Math.max(0, roster.filter(r => r.pos === q).length - (ROSTER_SLOTS[q] || 0)), 0);
        if (overflow < (ROSTER_SLOTS.FLEX || 0)) return 0.9;
    }
    const target = NEED_TARGET[pos] || 1;
    return clamp((target - have) / target, 0, 1) * 0.45;
}

/**
 * Probabilità che un giocatore arrivi alla pick `p`.
 *
 * `marketSurvival` risponde a "è ancora lì DOPO `target` scelte": prima della
 * mia pick numero `p` ne sono state fatte `p − 1`, quindi il bersaglio è `p−1`,
 * non `p`. Con `p` la prima scelta assoluta del draft dava l'86% sul giocatore
 * con l'ADP migliore — cioè il modello si chiedeva se il mercato lo portasse
 * via prima del primo pick del draft. Alla pick 1 non è ancora successo niente
 * e la risposta è 1, senza modelli di mezzo.
 */
function survivesTo(entry, p, adpDisp) {
    return p <= 1 ? 1 : marketSurvival(entry, p - 1, adpDisp);
}

/* ════════════════ Fase 2 — Context Score, idratato dopo ═════════════════ */

/**
 * SOS+, calendario, trend, durabilità e probabilità di flop. Gira DOPO che la
 * pagina si vede già: `getContextScore` tira giù data/nfl/combine_draft.json,
 * che pesa 7,8 MB, e aspettarlo per disegnare il primo pixel vorrebbe dire una
 * pagina bianca per qualche secondo su una connessione lenta.
 *
 * Si idratano solo i primi CTX_LIMIT giocatori d'attacco della board: sotto a
 * quella soglia siamo fuori dai 64 pick che questa lega spende davvero, e ogni
 * riga in più è lavoro per un nome che nessuno chiamerà.
 *
 * @param onDone chiamata quando ha finito, per ridisegnare le sole card che
 *   dipendono dal contesto.
 */
export async function hydrateContext(ctx, year) {
    const targets = ctx.board
        .filter(r => OFF.includes(r.pos))
        .sort((a, b) => b.vor - a.vor)
        .slice(0, CTX_LIMIT);
    if (!targets.length) return ctx;

    const cacheKey = `topina_predraft_v1_${year}`;
    const hit = cacheGet(cacheKey, CTX_TTL_MS);
    if (hit) {
        const map = new Map(hit);
        let found = 0;
        for (const r of targets) {
            const c = map.get(r.key);
            if (c) { applyContext(r, c); found++; }
        }
        // cache di un board diverso (proiezioni aggiornate): si rifà
        if (found >= targets.length * 0.8) { ctx.contextReady = true; return ctx; }
    }

    const out = [];
    let i = 0;
    const worker = async () => {
        while (i < targets.length) {
            const r = targets[i++];
            try {
                const c = await getContextScore({ name: r.name, pos: r.pos, team: r.team, year: Number(year), projValue: r.proj });
                if (c) {
                    const slim = {
                        contextScore: c.contextScore, bustProb: c.bustProb,
                        schedule: c.subScores?.schedule ?? null,
                        playoff: c.subScores?.playoff ?? null,
                        volume: c.subScores?.volume ?? null,
                        efficiency: c.subScores?.efficiency ?? null,
                        teamOffense: c.subScores?.teamOffense ?? null,
                        trend: c.subScores?.trend ?? null,
                        durability: c.subScores?.durability ?? null,
                    };
                    applyContext(r, slim);
                    out.push([r.key, slim]);
                }
            } catch { /* un giocatore senza contesto non ferma gli altri */ }
        }
    };
    await Promise.all(Array.from({ length: CTX_CONCURRENCY }, worker));
    if (out.length) cacheSet(cacheKey, out);

    // i segnali che ora hanno un dato in più vanno rifatti
    ctx.signals = buildSignals(ctx);
    ctx.contextReady = true;
    return ctx;
}

/** Attacca il contesto alla riga e aggiunge i segnali che solo lui può dare. */
function applyContext(r, c) {
    r.ctx = c;
    r.sos = c.contextScore;
    r.bustProb = c.bustProb;
    r.schedule = c.schedule;
}
