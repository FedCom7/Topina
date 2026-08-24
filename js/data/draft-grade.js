/**
 * Draft Grade — il voto UNICO della pick e della squadra.
 *
 * Sostituisce ed elimina i due motori precedenti (il "ratio vs slot atteso" e
 * il Draft Score v2). L'analisi che ha portato qui, su 419 pick 2019-2025:
 *
 *  - il vecchio voto v1 misurava in gran parte IL GIRO in cui avevi draftato
 *    (Spearman giro→voto +0.39): nessuna pick di 1°/2° giro ha mai preso A+,
 *    il 54% delle pick di 15° giro sì. La colpa era della baseline
 *    `expected = N-esimo miglior valore del pool`, che crolla coi giri;
 *  - il v2 aveva un penale a senso unico (opportunityCost ≤ 0 per costruzione,
 *    media −8.9 su una base 50), quindi lo zero era irraggiungibile e tutto
 *    finiva in C; il suo stesso backtest dava ρ media −0.086 e `adopted:false`;
 *  - i due voti erano scorrelati (ρ 0.147 sulle pick, 86% di disaccordo sulla
 *    posizione di lega): due risposte diverse alla stessa domanda;
 *  - l'unica quantità che correla con i punti veri della stagione è il TALENTO
 *    raccolto nei titolari (ρ +0.54 contro +0.03 di v1 e +0.11 di v2), ed era
 *    l'unica esclusa da entrambe le formule.
 *
 * ── Il voto della pick ───────────────────────────────────────────
 * La domanda è "quanto del valore che potevi CATTURARE hai catturato?".
 * La baseline non è il miglior disponibile (in ogni giro può prenderlo una
 * squadra su quattro: le altre tre sarebbero condannate a priori), ma il
 * contro-fattuale vero dello snake draft, con un turno di lookahead:
 *
 *     piano(c) = valore di c ORA + miglior riserva che ti aspetta al turno dopo
 *     ceiling  = max piano(c) su tutto il board
 *     floor    = bruci la pick: ti resta solo la riserva
 *     PickValue = 100 × (piano(scelto) − floor) / (ceiling − floor)
 *
 * Il lookahead è il pezzo che mancava a entrambi i vecchi motori: se il
 * miglior giocatore del board ti aspetta comunque fino al prossimo turno,
 * prenderlo adesso non è un merito e lasciarlo non è una colpa. Conta solo
 * ciò che stava per sparire. A due code, si autonormalizza sul board di quel
 * momento (via la deriva di giro), e se il board era piatto il voto è neutro
 * per costruzione invece di premiare o condannare a caso.
 * L'ADP entra QUI, a stimare la sopravvivenza — non come termine additivo.
 *
 * ── Il voto della squadra ────────────────────────────────────────
 *     DraftGrade = 0.6 × talento + 0.4 × efficienza
 * Talento = quota di VOR nel lineup titolare rispetto alla lega (l'unica cosa
 * che predice). Efficienza = media dei PickValue pesata per draft-capital.
 * I pesi sono una SCELTA DI DESIGN dichiarata, ancorata a quel ρ: con 28
 * team-stagione non sono tarabili in modo robusto e non fingiamo di averlo
 * fatto. Le soglie-lettera invece sì: sono i quantili empirici dello storico
 * (data/model/draft_grade_calib.json), non cut point inventati.
 *
 * Tutto il testo generato è in INGLESE (convenzione del sito); i commenti
 * restano in italiano.
 */

import { replacementLevels, pickStarters } from './team-eval.js?v=53';
import { matchProjection, normName } from './projections.js?v=594';
import { ROSTER_SLOTS } from './league-rules.js?v=528';

const OFF = new Set(['QB', 'RB', 'WR', 'TE']);
const POS_FALLBACK = { K: 125, DEF: 110 }; // come draftgrades.POS_FALLBACK_PROJ (evita import circolare)
const NEED_TARGET = { QB: 2, RB: 5, WR: 5, TE: 2, K: 1, DEF: 1 }; // profondità "sana" di roster
// slot titolari obbligatori: se ne resta uno scoperto e le pick finiscono,
// la pick va giudicata DENTRO il suo ruolo ("dovendo prendere un K, era il K giusto?")
const { FLEX, ...MANDATORY_SLOTS } = ROSTER_SLOTS;
const SIGMA_MIN = 3;      // σ minima sull'ADP: sotto, il segnale saturava (v2 aveva il 21% di pick al clamp)
// Soglia "sarebbe ancora stato lì": 0.5, cioè più probabile che no.
// Una versione precedente ricalibrava le probabilità con un esponente per far
// combaciare la media col tasso base (86% dei candidati sopravvive davvero) e
// alzava la soglia a 0.88. Sbagliato: quell'esponente schiacciava tutto verso
// 1 e rendeva un testa-o-croce indistinguibile da una certezza — proprio sui
// giocatori di testa del board, che sono gli unici che contano. Meglio una
// stima un po' pessimista ma con la sua escursione intatta, e la percentuale
// MOSTRATA a schermo così si vede quando il modello è incerto.
const SURVIVE_P = 0.5;
const STAKES_HALF = 30;   // punti-lega in ballo a cui il voto vale metà escursione
// modello di scelta degli avversari (vedi opponentPickProbs)
const NEED_BONUS = 20;       // di quante posizioni ADP il fabbisogno sposta un giocatore (tarato: top-1 18.8%)
const NO_ADP_RANK = 250;     // dove finisce chi il mercato non quota affatto
const SOFTMAX_TAU = 4;       // temperatura: più bassa = avversario più deciso a seguire il listone
const OPP_CANDIDATES = 12;   // quanti nomi entrano davvero nel ventaglio di scelta
// Peso del fabbisogno avversario. Tarato a 0.25, non "a sentimento": sui 7350
// casi storici il need model NON discrimina (AUC 0.612 da solo, contro 0.759
// del solo ADP) — sposta le probabilità in blocco verso l'alto senza saper dire
// CHI sopravvive. A 0.25 aggiunge il poco che ha (AUC 0.763) senza sporcare il
// segnale di mercato; a 0.65, com'era prima, non aggiungeva nulla e gonfiava e
// basta le stime di sopravvivenza.
const NEED_WEIGHT = 0.25;
const NEUTRAL = 50;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/* ── Calibrazione ──────────────────────────────────────────────── */

/** Soglie di default: usate finché la calibrazione empirica non è disponibile. */
const DEFAULT_PICK_THRESHOLDS = [[88, 'A+'], [78, 'A'], [70, 'A-'], [62, 'B+'], [55, 'B'], [48, 'B-'], [41, 'C+'], [34, 'C'], [26, 'C-'], [16, 'D']];
const DEFAULT_TEAM_THRESHOLDS = [[78, 'A+'], [70, 'A'], [64, 'A-'], [57, 'B+'], [51, 'B'], [45, 'B-'], [39, 'C+'], [33, 'C'], [26, 'C-'], [18, 'D']];
export const TALENT_WEIGHT = 0.6;
export const EFFICIENCY_WEIGHT = 0.4;

let _calibPromise = null;

/**
 * Soglie-lettera dai quantili empirici dello storico
 * (scripts/build-draft-grade-calib.mjs). Graceful: null → si usano i default.
 */
export function getDraftGradeCalib() {
    if (_calibPromise) return _calibPromise;
    _calibPromise = (async () => {
        try {
            const ctrl = new AbortController();
            const t = setTimeout(() => ctrl.abort(), 8000);
            const r = await fetch('data/model/draft_grade_calib.json', { signal: ctrl.signal });
            clearTimeout(t);
            if (!r.ok) return null;
            return await r.json();
        } catch { return null; }
    })();
    return _calibPromise;
}

/**
 * Dispersione ADP (FantasyFootballCalculator, 12 team, full PPR): Map
 * `${normName}|${POS}` → { adp, stdev, timesDrafted }. Precalcolata offline da
 * scripts/build-adp-ffc.mjs → data/nfl/adp_ffc_{Y}.json. Qui serve a stimare la
 * SOPRAVVIVENZA di un giocatore fino al turno dopo, non a produrre un punteggio.
 * null se il file manca (2019): il motore degrada sull'ADP Sleeper.
 */
export async function getAdpDispersion(year) {
    try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 8000);
        const r = await fetch(`data/nfl/adp_ffc_${year}.json`, { signal: ctrl.signal });
        clearTimeout(t);
        if (!r.ok) return null;
        const data = await r.json();
        const map = new Map(Object.entries(data.players || {}));
        return map.size ? map : null;
    } catch { return null; }
}

export function letterForScore(score, thresholds = DEFAULT_PICK_THRESHOLDS) {
    for (const [t, l] of thresholds) if (score >= t) return l;
    return 'F';
}
export const gradeBand = (letter) => letter[0]; // A/B/C/D/F

/**
 * Numero MOSTRATO accanto alla lettera.
 *
 * Il punteggio interno è un percentile: la media storica sta sul 47, quindi un
 * ottimo draft usciva "A- · 65/100" e il 65 si leggeva come una sufficienza
 * risicata. Lettera e numero dicevano due cose diverse — lo stesso difetto, in
 * piccolo, che aveva fatto ritirare i due voti concorrenti.
 *
 * Qui il percentile viene rimappato sugli ancoraggi convenzionali di una
 * pagella (A+ = 97, A = 93, … D = 65) interpolando DENTRO ogni fascia: l'ordine
 * non cambia mai — è una trasformazione monotona — cambia solo il modo in cui
 * il numero si legge. Le soglie restano i quantili empirici dello storico.
 */
const LETTER_ANCHOR = { 'A+': 97, A: 93, 'A-': 90, 'B+': 87, B: 83, 'B-': 80, 'C+': 77, C: 73, 'C-': 70, D: 65 };

export function displayScore(score, thresholds = DEFAULT_PICK_THRESHOLDS) {
    const th = [...thresholds].sort((a, b) => b[0] - a[0]);
    // sopra la soglia più alta: da A+ a 100, usando 100 come tetto del percentile
    const [topT, topL] = th[0];
    if (score >= topT) {
        const span = Math.max(1, 100 - topT);
        return clamp(LETTER_ANCHOR[topL] + (score - topT) / span * (100 - LETTER_ANCHOR[topL]), 0, 100);
    }
    for (let i = 0; i < th.length - 1; i++) {
        const [hiT] = th[i];
        const [loT, loL] = th[i + 1];
        if (score >= loT) {
            const hiA = LETTER_ANCHOR[th[i][1]], loA = LETTER_ANCHOR[loL];
            // il tetto della fascia si ferma UN PUNTO sotto l'ancora superiore:
            // altrimenti il B+ più alto mostrava 90, che si legge come A-
            const span = Math.max(0, hiA - loA - 1);
            return clamp(loA + (score - loT) / Math.max(1e-6, hiT - loT) * span, 0, 100);
        }
    }
    // sotto la soglia più bassa (F): da 0 al valore di D
    const [lastT, lastL] = th[th.length - 1];
    return clamp(score / Math.max(1e-6, lastT) * LETTER_ANCHOR[lastL], 0, 100);
}

/* ── Board e valore marginale ──────────────────────────────────── */

/** Valore in punti-lega di una voce del board proiezioni. */
const boardValue = (e) => e.projPts ?? e.ptsStd ?? POS_FALLBACK[e.pos] ?? 0;

/**
 * Universo dei giocatori realmente disponibili al draft.
 *
 * ATTENZIONE ai kicker: Sleeper non proietta i field goal a livello stagionale,
 * quindi `projPts` è null e scatterebbe POS_FALLBACK (125 punti, la media
 * storica di lega). Applicato a TUTTI i kicker del listone crea decine di voci
 * identiche che nessuno draftà mai — e siccome non hanno un ADP sensato
 * "sopravvivono" a ogni turno, diventavano il miglior disponibile fantasma
 * dell'intero board dal 7° giro in poi. Il fallback va bene per valutare la
 * pick di un kicker davvero fatta, NON per popolare le alternative: qui
 * teniamo solo le voci con una proiezione vera.
 */
function buildBoard(proj, waiver) {
    const board = [];
    for (const e of proj.values()) {
        const value = e.projPts ?? e.ptsStd ?? 0; // niente POS_FALLBACK: vedi sopra
        if (!value) continue;
        board.push({
            key: `${normName(e.name)}|${e.pos}`, name: e.name, pos: e.pos,
            team: e.team, adp: e.adp, value,
            vor: Math.max(0, value - (waiver[e.pos] || 0)),
        });
    }
    return board;
}

/**
 * Livello WAIVER per ruolo: il miglior giocatore di quel ruolo che la lega NON
 * ha draftato, cioè quello che avresti avuto GRATIS.
 *
 * Serve un secondo metro accanto a `replacementLevels` di team-eval, che misura
 * l'ultimo TITOLARE di lega (4 QB, 10 RB, 10 WR, 4 TE). Quello è il metro
 * giusto per la forza del lineup, ma in una lega a 4 squadre è altissimo: dal
 * 7°-8° giro in poi ogni giocatore ancora sul board ci finisce sotto e il VOR
 * si azzera per tutti insieme, cancellando ogni differenza tra le pick di
 * panchina (era il difetto 2.5 dell'analisi). Le pick tarde vanno giudicate
 * per quello che sono: un'alternativa alle waiver, non un titolare mancato.
 */
function waiverLevels(board, allPicks) {
    const drafted = {};
    for (const p of allPicks) drafted[p.pos] = (drafted[p.pos] || 0) + 1;
    const lv = {};
    for (const pos of new Set(board.map(e => e.pos))) {
        const vals = board.filter(e => e.pos === pos).map(e => e.value).sort((a, b) => b - a);
        const idx = Math.min(drafted[pos] || 0, vals.length - 1);
        lv[pos] = vals[idx] ?? 0;
    }
    return lv;
}

/** Fabbisogno residuo 0-1 per una posizione dato il roster già costruito. */
function needFactor(rosterSoFar, pos) {
    const target = NEED_TARGET[pos] || 1;
    const have = rosterSoFar.filter(p => p.pos === pos).length;
    return clamp((target - have) / target, 0, 1);
}

/** VOR scontato dalla saturazione posizionale: un RB serve più di un 5° WR. */
const marginalValue = (vor, need) => vor * (0.5 + 0.5 * need);

/**
 * Probabilità di MERCATO che un giocatore sia ancora disponibile alla pick
 * `target`. Modello normale sull'ADP di consenso: P(posizione di draft > target).
 * σ ha un pavimento (SIGMA_MIN) perché in cima al board FFC dà σ ≈ 0.8, e
 * senza pavimento due pick di scarto diventavano 6σ — è ciò che saturava il
 * vecchio segnale di mercato.
 * Senza ADP il giudizio è per ruolo: K e DEF si trovano fino all'ultimo giro.
 *
 * ATTENZIONE: da sola questa non basta in una lega a 4 squadre — vedi
 * survivalProb() qui sotto, che ci mette dentro il FABBISOGNO degli avversari.
 */
function marketSurvival(entry, target, adpDisp) {
    const disp = adpDisp?.get(entry.key) || null;
    const adp = disp?.adp ?? entry.adp;
    if (adp == null) return OFF.has(entry.pos) ? 0.5 : 0.95;
    const sigma = Math.max(disp?.stdev ?? 0, SIGMA_MIN);
    // Φ approssimata (Abramowitz-Stegun 7.1.26 via erf)
    const z = (target - adp) / sigma;
    return clamp(1 - normalCdf(z), 0, 1);
}

/**
 * Probabilità che un avversario prenda un certo giocatore al suo turno.
 *
 * L'utilità è l'ORDINE DI MERCATO (ADP), spostato dal fabbisogno di quella
 * squadra. Non il contrario: una versione precedente ordinava per VOR
 * need-adjusted e sbagliava sistematicamente, perché il VOR sottrae soglie
 * diverse a ruoli diversi e finiva per preferire un RB a un WR che proiettava
 * di più e aveva un ADP molto migliore. Sui 420 pick storici, prevedere la
 * scelta vera dell'avversario:
 *     VOR need-adjusted   log-loss 5.306, azzecca il 14.5%
 *     ADP puro            log-loss 4.760, azzecca il 16.0%
 *     ADP + spinta need   log-loss 4.632, azzecca il 16.9%   ← questa
 * I drafter veri seguono il listone e lo piegano ai buchi di rosa, non
 * calcolano il valore sopra il replacement.
 *
 * In una lega a 4 squadre tra una tua pick e la successiva ci sono due o tre
 * scelte, e sono di squadre PRECISE con rose che conosciamo. L'ADP di consenso
 * è un metro da lega a 12: dice cosa fa il mercato in generale, non cosa farà
 * quella squadra lì. Se chi picka in mezzo ha già due RB e nessun WR, il primo
 * WR del board sparisce comunque, anche se l'ADP lo dava tranquillo.
 *
 * Modello: utilità = valore marginale PER QUELLA SQUADRA (VOR scontato dal suo
 * fabbisogno), meno una penalità per quanto sarebbe un anticipo rispetto
 * all'ADP — i drafter reali non reachano di trenta posizioni. Poi softmax sui
 * primi candidati, così la scelta è probabilistica e non un greedy fragile.
 */
function opponentPickProbs(available, roster, pickNo, adpDisp, cache) {
    if (cache.has(pickNo)) return cache.get(pickNo);
    const cands = [];
    for (const e of available) {
        const disp = adpDisp?.get(e.key) || null;
        const adp = disp?.adp ?? e.adp;
        // ordine di mercato + spinta del fabbisogno. Chi non ha ADP finisce in
        // fondo: nessuno picka un nome che il mercato non conosce.
        cands.push({ key: e.key, u: (adp != null ? -adp : -NO_ADP_RANK) + NEED_BONUS * needFactor(roster, e.pos) });
    }
    cands.sort((a, b) => b.u - a.u);
    const top = cands.slice(0, OPP_CANDIDATES);
    const probs = new Map();
    if (top.length) {
        const max = top[0].u;
        let z = 0;
        for (const c of top) { c.w = Math.exp((c.u - max) / SOFTMAX_TAU); z += c.w; }
        for (const c of top) probs.set(c.key, c.w / z);
    }
    cache.set(pickNo, probs);
    return probs;
}

/**
 * Probabilità che il giocatore ti ASPETTI fino al tuo turno successivo,
 * combinando i due segnali: il mercato (ADP) e il fabbisogno reale delle
 * squadre che pickano in mezzo. Sopravvive solo se NESSUNA di quelle lo prende.
 */
function survivalProb(entry, target, ctx) {
    const { adpDisp, interveningPicks, oppCache } = ctx;
    const market = marketSurvival(entry, target, adpDisp);
    if (!interveningPicks?.length) return market;

    let pSurvive = 1;
    for (const ip of interveningPicks) {
        const probs = opponentPickProbs(ip.available, ip.roster, ip.pick, adpDisp, oppCache);
        pSurvive *= 1 - (probs.get(entry.key) || 0);
    }
    // Il modello del fabbisogno guarda le squadre giuste ma è pur sempre un
    // modello; l'ADP è rumoroso qui ma incorpora tutto ciò che non modelliamo
    // (hype, infortuni, preferenze personali). Media geometrica dei due, con
    // più peso a chi conosce gli avversari.
    return clamp(Math.pow(pSurvive, NEED_WEIGHT) * Math.pow(market, 1 - NEED_WEIGHT), 0, 1);
}

/** CDF normale standard (erf con approssimazione a 5 termini, errore < 1.5e-7). */
function normalCdf(z) {
    const s = z < 0 ? -1 : 1;
    const x = Math.abs(z) / Math.SQRT2;
    const t = 1 / (1 + 0.3275911 * x);
    const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
    return 0.5 * (1 + s * y);
}

/**
 * Analisi di una singola pick.
 * `nextPick` è il turno successivo della stessa squadra (null se era l'ultimo).
 */
function analyzePick(p, ctx) {
    const { waiver, available, rosterSoFar, adpDisp, nextPick, pickedKey, picksLeft, thresholds,
        interveningPicks, oppCache } = ctx;
    // contesto di sopravvivenza: mercato (ADP) + fabbisogno di CHI picka in mezzo
    const survCtx = { adpDisp, interveningPicks, oppCache };
    const value = p.value || 0;
    const vor = Math.max(0, value - (waiver[p.pos] || 0));
    const need = needFactor(rosterSoFar, p.pos);
    const pickedMV = marginalValue(vor, need);

    // Slot obbligatori ancora scoperti: se le pick rimaste bastano appena a
    // coprirli, la scelta va giudicata DENTRO il ruolo, non contro tutto il
    // board (un kicker non deve battere un WR: deve battere gli altri kicker).
    const unfilled = Object.keys(MANDATORY_SLOTS)
        .filter(pos => rosterSoFar.filter(x => x.pos === pos).length < MANDATORY_SLOTS[pos]);
    const mustFill = unfilled.includes(p.pos) && picksLeft <= unfilled.length;

    const pool = mustFill ? available.filter(e => e.pos === p.pos) : available;
    const mvOf = (e) => marginalValue(e.vor, needFactor(rosterSoFar, e.pos));

    // I DUE MIGLIORI che ti avrebbero ASPETTATO al turno successivo. Servono
    // entrambi perché il piano di riserva cambia se il giocatore che aspetta
    // è proprio quello che stai per prendere.
    let w1 = null, w1mv = 0, w2mv = 0;
    if (nextPick != null) {
        for (const e of pool) {
            if (survivalProb(e, nextPick, survCtx) < SURVIVE_P) continue;
            const mv = mvOf(e);
            if (mv > w1mv) { w2mv = w1mv; w1mv = mv; w1 = e; }
            else if (mv > w2mv) { w2mv = mv; }
        }
    }
    /**
     * Valore totale della strategia "prendo c adesso": quello che porti a casa
     * ora PIÙ il miglior piano di riserva che ti resta al turno dopo. È il
     * pezzo che mancava a entrambi i vecchi motori: se il miglior giocatore
     * del board ti aspetta comunque fino al prossimo turno, prenderlo ADESSO
     * non è un merito — e non prenderlo non è una colpa. Conta solo ciò che
     * stava per sparire.
     */
    const totalOf = (c, mv) => mv + (w1 && c.key === w1.key ? w2mv : w1mv);

    /**
     * L'INSIEME DI SCELTA realistico, non tutto il listone. Nessuno, alla pick
     * 30, sta valutando il 400° nome del board: i candidati veri sono i primi
     * M per valore marginale, dove M cresce col numero di giocatori che
     * spariscono prima del tuo turno successivo.
     *
     * Giudicare la pick come PERCENTILE dentro questo insieme è ciò che toglie
     * di mezzo la deriva di giro: è un rango dentro le opzioni di QUEL momento,
     * quindi il primo e il quindicesimo giro sono sulla stessa scala per
     * costruzione. Con un floor assoluto invece i voti saturavano a 0 e 100.
     */
    const gap = nextPick != null ? nextPick - p.pick : 8;
    const M = clamp(gap + 4, 6, 20);
    const candidates = pool
        .map(e => ({ e, mv: mvOf(e) }))
        .sort((a, b) => b.mv - a.mv)
        .slice(0, M)
        .map(x => ({ ...x, plan: totalOf(x.e, x.mv) }));

    const ceilEntry = candidates[0]?.e ?? null;
    const ceiling = candidates.length ? Math.max(...candidates.map(c => c.plan)) : pickedMV + w1mv;
    const floor = candidates.length ? Math.min(...candidates.map(c => c.plan)) : w1mv;
    const pickedTotal = totalOf({ key: pickedKey }, pickedMV);

    // percentile del piano scelto dentro l'insieme di scelta
    const beaten = candidates.filter(c => c.plan <= pickedTotal + 1e-9).length;
    const raw = candidates.length ? 100 * beaten / candidates.length : NEUTRAL;

    /**
     * Quanto c'era davvero in ballo. Se tra la scelta migliore e la peggiore
     * dell'insieme ballano 3 punti, il voto non deve gridare: si restringe
     * verso il neutro. Le pick che spostano la stagione mantengono l'escursione
     * piena, quelle ininfluenti restano vicino a 50 — così un voto basso
     * significa sempre "hai perso valore vero", mai "il board era piatto".
     */
    const stakes = ceiling - floor;
    const shrink = stakes / (stakes + STAKES_HALF);
    const capturable = stakes > 1;
    const pickValue = clamp(NEUTRAL + (raw - NEUTRAL) * shrink, 0, 100);

    // il giocatore preso sarebbe sopravvissuto fino al tuo prossimo turno?
    const selfSurvival = nextPick != null
        ? survivalProb({ key: pickedKey, pos: p.pos, adp: p.adp }, nextPick, survCtx)
        : null;

    // chi, fra gli avversari che pickano in mezzo, avrebbe avuto più motivo di
    // prenderlo: serve a dire "sarebbe sparito, e per mano di chi"
    let takenBy = null;
    if (nextPick != null && interveningPicks?.length) {
        for (const ip of interveningPicks) {
            const probs = opponentPickProbs(ip.available, ip.roster, ip.pick, adpDisp, oppCache);
            const pr = probs.get(pickedKey) || 0;
            if (!takenBy || pr > takenBy.prob) takenBy = { teamKey: ip.teamKey, pick: ip.pick, prob: pr };
        }
        if (takenBy && takenBy.prob < 0.15) takenBy = null;
    }

    // salto di valore verso il prossimo dello stesso ruolo ancora sul board
    let nextSamePos = 0;
    for (const e of available) {
        if (e.pos !== p.pos || e.key === pickedKey) continue;
        if (e.vor > nextSamePos) nextSamePos = e.vor;
    }
    const scarcity = Math.max(0, vor - nextSamePos);

    const bestAlt = ceilEntry && ceilEntry.key !== pickedKey ? ceilEntry : null;
    const alternatives = pool
        .filter(e => e.key !== pickedKey)
        .map(e => ({ e, mv: mvOf(e) }))
        .sort((a, b) => b.mv - a.mv).slice(0, 4)
        .map(x => ({ name: x.e.name, pos: x.e.pos, team: x.e.team, vor: Math.round(x.e.vor), adp: x.e.adp }));

    return {
        pick: p.pick, round: p.round, player: p.player, pos: p.pos, nfl: p.nfl,
        value: Math.round(value), vor: Math.round(vor), adp: p.adp,
        score: +pickValue.toFixed(1),
        letter: letterForScore(pickValue, thresholds),
        grade: Math.round(displayScore(pickValue, thresholds)), // numero a schermo

        // metriche di supporto (quelle che finiscono a schermo)
        wouldHaveLasted: selfSurvival == null ? null : selfSurvival >= SURVIVE_P,
        survivalPct: selfSurvival == null ? null : Math.round(selfSurvival * 100),
        // Tre fasce, non due. Su un giocatore di testa del board la stima è
        // spesso un testa-o-croce vero: dirlo è più utile che scegliere un
        // sì/no che il modello non ha i numeri per sostenere.
        survivalBand: selfSurvival == null ? null
            : selfSurvival >= 0.72 ? 'lasted'
                : selfSurvival >= 0.45 ? 'tossup' : 'gone',
        nextPick,
        takenBy: takenBy ? { teamKey: takenBy.teamKey, pick: takenBy.pick, prob: +takenBy.prob.toFixed(2) } : null,
        bestAlt: bestAlt ? { name: bestAlt.name, pos: bestAlt.pos, team: bestAlt.team, vor: Math.round(bestAlt.vor) } : null,
        waitAlt: w1 && w1.key !== pickedKey
            ? { name: w1.name, pos: w1.pos, team: w1.team, vor: Math.round(w1.vor) } : null,
        scarcity: Math.round(scarcity),
        need: +need.toFixed(2),
        mustFill, capturable,
        alternatives,
        // interni, utili al debug e alla calibrazione (non a schermo)
        parts: {
            picked: +pickedMV.toFixed(1),
            pickedTotal: +pickedTotal.toFixed(1),
            ceiling: +ceiling.toFixed(1),
            floor: +floor.toFixed(1),
            stakes: +stakes.toFixed(1),
            raw: +raw.toFixed(1),
        },
    };
}

/* ── Frasi in inglese ──────────────────────────────────────────── */

/** Il "why" della singola pick: una frase, dai dati. */
function pickWhy(r) {
    if (!r.capturable) {
        return r.mustFill
            ? `A mandatory slot with nothing left to choose between — this pick could not swing the draft either way.`
            : `The board was flat here: every realistic option carried the same value, so the pick could not swing the draft either way.`;
    }
    const bits = [];
    if (r.score >= 70) {
        bits.push(r.survivalBand === 'gone'
            ? `${r.player} would have been gone by pick #${r.nextPick}`
            : `${r.player} was the best value the board could offer at this slot`);
        if (r.scarcity >= 20) bits.push(`and the ${r.pos} position dropped ${r.scarcity} points right after him`);
    } else if (r.score >= 45) {
        bits.push(`Fair value for the slot`);
        if (r.bestAlt) bits.push(`though ${r.bestAlt.name} (${r.bestAlt.pos}) was the stronger name still on the board`);
    } else {
        if (r.survivalBand === 'lasted') bits.push(`${r.player} would most likely still have been there at pick #${r.nextPick}`);
        else if (r.survivalBand === 'tossup') bits.push(`${r.player} was close to a coin flip to last until pick #${r.nextPick}`);
        else if (r.bestAlt) bits.push(`${r.bestAlt.name} (${r.bestAlt.pos}) was still on the board and projected higher`);
        else bits.push(`The board offered more at this slot`);
        if (r.waitAlt && r.survivalBand !== 'gone') bits.push(`so the pick could have gone to ${r.waitAlt.name} instead`);
    }
    if (r.mustFill) bits.push(`graded against the other ${r.pos}s, since the slot had to be filled`);
    return bits.join(', ').replace(/^./, c => c.toUpperCase()) + '.';
}

/**
 * Il "why" della squadra: una frase che spiega la lettera.
 * La clausola d'apertura deve essere COERENTE col conteggio che segue — con
 * soglie troppo strette si finiva a dire "draft nella media" e poi "15 pick
 * che hanno buttato valore" nella stessa riga.
 */
function teamWhy(t) {
    const c = t.components;
    const n = t.picks.length || 1;
    const strong = t.picks.filter(r => r.score >= 65).length;
    const weak = t.picks.filter(r => r.score < 35).length;
    const bits = [];

    const goodTalent = c.talent >= 58, badTalent = c.talent <= 38;
    const goodEff = c.efficiency >= 56, badEff = c.efficiency <= 40;

    if (goodTalent && goodEff) bits.push(`The best of both: top talent collected, and a board played well enough to deserve it`);
    else if (goodTalent && badEff) bits.push(`Plenty of talent on the roster, but very little of it came from outplaying the board`);
    else if (goodTalent) bits.push(`Top-end talent collected, with a draft played straight down the middle`);
    else if (badTalent && badEff) bits.push(`Wrong on both counts: the thinnest roster in the league, and the board was rarely read right`);
    else if (badTalent && goodEff) bits.push(`The picks were sharp one by one, but the roster they add up to is the thinnest in the league`);
    else if (badTalent) bits.push(`Solid process, thin result: the roster this draft produced is the weakest around`);
    else if (badEff) bits.push(`A draft that kept leaving value behind, slot after slot`);
    else if (goodEff) bits.push(`A well-played draft that squeezed value out of most slots`);
    else bits.push(`A middling draft: nothing broken, nothing decisive`);

    if (strong) bits.push(`${strong} pick${strong > 1 ? 's' : ''} above the league's usual standard`);
    if (weak >= n * 0.6) bits.push(`but most of the board went the other way`);
    else if (weak) bits.push(`${weak} that gave value away`);
    if (t.bestPick && t.bestPick.score >= 55) bits.push(`with ${t.bestPick.player} the best decision of the night`);
    return bits.join(', ') + '.';
}

/* ── Strategia di ruolo ────────────────────────────────────────── */

/**
 * "Hai fatto bene ad anticipare il TE? Potevi aspettare sul QB?"
 *
 * Per ogni slot titolare guarda la pick che l'ha riempito e mette a confronto
 * DUE dislivelli, entrambi misurati al momento di quella scelta:
 *
 *   guadagno   = quanto vale il giocatore preso MENO il miglior giocatore dello
 *                stesso ruolo che ti sarebbe rimasto al turno successivo.
 *                È il motivo per cui anticipare può essere giusto: se dopo di
 *                lui il ruolo crolla, hai comprato quel dislivello.
 *   sacrificio = quanto valeva il miglior giocatore di UN ALTRO ruolo che hai
 *                lasciato andare e che non ti sarebbe tornato.
 *
 * Anticipare è corretto solo quando il guadagno supera il sacrificio. È la
 * regola che tutti applicano a naso su TE e QB — qui è misurata sul board vero
 * di quella sera invece che sulle sensazioni.
 */
function positionalStrategy(teamKey, results, timeline, ctx) {
    const { adpDisp, oppCache, nextPickOf } = ctx;
    const rows = [];

    // la pick che ha portato a casa il MIGLIOR giocatore di ogni ruolo titolare
    const bestByPos = {};
    for (const r of results) {
        if (!OFF.has(r.pos)) continue;
        if (!bestByPos[r.pos] || r.vor > bestByPos[r.pos].vor) bestByPos[r.pos] = r;
    }

    for (const pos of ['QB', 'RB', 'WR', 'TE']) {
        const r = bestByPos[pos];
        if (!r) continue;
        const snap = timeline.find(t => t.pick === r.pick);
        const nextPick = nextPickOf.get(r.pick);
        if (!snap || nextPick == null) continue;

        const intervening = timeline.filter(t => t.pick > r.pick && t.pick < nextPick && t.teamKey !== teamKey);
        const survCtx = { adpDisp, interveningPicks: intervening, oppCache };

        // chi ti aspettava al turno dopo: il migliore in assoluto e il migliore
        // dello STESSO ruolo (senza contare chi hai appena preso)
        let waitAny = null, waitSame = null, bestOther = null;
        for (const e of snap.available) {
            if (e.key === snap.pickedKey) continue;
            if (OFF.has(e.pos) && e.pos !== pos && (!bestOther || e.vor > bestOther.vor)) bestOther = e;
            if (survivalProb(e, nextPick, survCtx) < SURVIVE_P) continue;
            if (!waitAny || e.vor > waitAny.vor) waitAny = e;
            if (e.pos === pos && (!waitSame || e.vor > waitSame.vor)) waitSame = e;
        }

        /**
         * I due piani a confronto, entrambi su DUE turni — è l'unico modo
         * onesto di rispondere "potevi aspettare?". Confrontare il VOR assoluto
         * del giocatore preso con quello del miglior altro-ruolo che spariva
         * dava "troppo presto" su ogni singola pick, prima compresa: al primo
         * giro sparisce sempre qualcuno di enorme, qualunque cosa tu faccia.
         *
         *   prendo ORA il ruolo   = lui + il meglio che mi aspetta (qualunque ruolo)
         *   aspetto sul ruolo     = il miglior altro-ruolo ora + il miglior
         *                           PARI-RUOLO che mi aspetta
         *
         * La differenza è il vero guadagno dell'anticipo.
         */
        const takeNow = r.vor + (waitAny?.vor ?? 0);
        const waitPlan = (bestOther?.vor ?? 0) + (waitSame?.vor ?? 0);
        const edge = Math.round(takeNow - waitPlan);
        const cliff = Math.round(r.vor - (waitSame?.vor ?? 0)); // dislivello del ruolo

        const verdict = edge >= 8 ? 'right' : edge <= -8 ? 'early' : 'even';
        rows.push({
            pos, player: r.player, round: r.round, pick: r.pick,
            vor: r.vor, edge, cliff, verdict,
            waitAlt: waitSame ? { name: waitSame.name, vor: Math.round(waitSame.vor) } : null,
            otherAlt: bestOther ? { name: bestOther.name, pos: bestOther.pos, vor: Math.round(bestOther.vor) } : null,
            note: strategyNote(pos, r, edge, cliff, verdict, waitSame, bestOther),
        });
    }

    return { slots: rows, bench: benchAudit(results) };
}

function strategyNote(pos, r, edge, cliff, verdict, waitSame, bestOther) {
    // il "dislivello" può essere NEGATIVO: capita quando chi ti aspettava era
    // messo meglio di chi hai preso. Va detto, non stampato come "-1 points behind".
    const nextSame = !waitSame
        ? `no other ${pos} would have reached your next turn at all`
        : cliff >= 0
            ? `${waitSame.name} was the best ${pos} who would have reached your next turn, ${cliff} point${cliff === 1 ? '' : 's'} behind`
            : `${waitSame.name} would have reached your next turn and was worth ${Math.abs(cliff)} point${Math.abs(cliff) === 1 ? '' : 's'} more`;
    if (verdict === 'right') {
        return `Right to take the ${pos} here — ${nextSame}, so waiting a round would have cost ${Math.abs(edge)} points across the two picks.`;
    }
    if (verdict === 'early') {
        return bestOther
            ? `Could have waited — ${nextSame}, while ${bestOther.name} (${bestOther.pos}) was there for the taking. Going the other way first was worth ${Math.abs(edge)} points.`
            : `Could have waited — ${nextSame}.`;
    }
    return `A wash — ${nextSame}, and taking the ${pos} first or second made almost no difference (${edge >= 0 ? '+' : ''}${edge}).`;
}

/**
 * La panchina serve a qualcosa? Conta le pick oltre i titolari e quanto valore
 * aggiungono davvero sopra il livello waiver: un 5° WR che vale zero è una pick
 * bruciata, e in una lega a 4 squadre succede spesso perché il pescaggio libero
 * è profondissimo.
 */
function benchAudit(results) {
    const STARTER_CAP = { QB: 1, RB: 3, WR: 3, TE: 1, K: 1, DEF: 1 }; // titolari + FLEX
    const seen = {};
    let dead = 0, live = 0;
    const deadByPos = {};
    for (const r of [...results].sort((a, b) => b.vor - a.vor)) {
        seen[r.pos] = (seen[r.pos] || 0) + 1;
        if (seen[r.pos] <= (STARTER_CAP[r.pos] || 1)) continue;   // è un titolare
        if (r.vor > 0) live++;
        else { dead++; deadByPos[r.pos] = (deadByPos[r.pos] || 0) + 1; }
    }
    const worst = Object.entries(deadByPos).sort((a, b) => b[1] - a[1])[0] || null;
    return {
        dead, live,
        worstPos: worst ? worst[0] : null,
        worstCount: worst ? worst[1] : 0,
        note: dead === 0
            ? `Every bench pick projects above what the waiver wire offered.`
            : `${dead} bench pick${dead > 1 ? 's' : ''} project${dead > 1 ? '' : 's'} no better than a free agent${worst && worst[1] > 1 ? `, ${worst[1]} of them at ${worst[0]}` : ''}.`,
    };
}

/** Cosa è andato bene / cosa ha pesato — bullet in inglese. */
function buildNarrative(t) {
    const good = [], bad = [];
    const c = t.components;
    const gone = t.picks.filter(r => r.survivalBand === 'gone' && r.score >= 60);
    const waited = t.picks.filter(r => r.survivalBand === 'lasted' && r.score < 40);
    const cliffs = t.picks.filter(r => r.scarcity >= 25 && r.score >= 55);
    const top = t.picks.filter(r => gradeBand(r.letter) === 'A');
    const missed = t.picks.filter(r => r.bestAlt && r.score < 30).sort((a, b) => a.score - b.score);

    if (top.length >= 2) good.push(`${top.length} picks graded A: the decisions held up round after round.`);
    if (gone.length >= 2) good.push(`${gone.length} players taken just before they would have been off the board — the timing was right.`);
    if (cliffs.length) good.push(`Read the value cliffs: ${cliffs.slice(0, 2).map(r => r.player).join(' and ')} came off the board right before ${cliffs.length > 1 ? 'their positions' : 'the position'} dropped.`);
    if (c.talent >= 60) good.push(`Most talent collected in the league: ${Math.round(c.starterVOR)} points of value above replacement in the best lineup.`);
    if (c.starterShare >= 0.8) good.push(`${Math.round(c.starterShare * 100)}% of that value sits in the starting lineup, not on the bench.`);

    if (waited.length >= 2) bad.push(`${waited.length} players who would most likely still have been available one round later.`);
    if (missed.length) bad.push(`Value left on the board: ${missed[0].bestAlt.name} was still there when ${missed[0].player} came off at #${missed[0].pick}.`);
    if (c.talent <= 35) bad.push(`Least talent collected in the league: ${Math.round(c.starterVOR)} points above replacement against a league best of ${Math.round(c.leagueBestVOR)}.`);
    if (c.efficiency <= 40) bad.push(`Slot after slot the board offered more than what was taken.`);
    if (c.starterShare < 0.65) bad.push(`Only ${Math.round(c.starterShare * 100)}% of the value collected ends up in the starting lineup.`);

    return { good: good.slice(0, 4), bad: bad.slice(0, 4) };
}

/* ── Motore ────────────────────────────────────────────────────── */

/**
 * Calcola il Draft Grade per tutte le squadre.
 * @param grades output di computeGrades (array team con .key e .list valorizzate)
 * @param proj   Map proiezioni (getSeasonProjections) — il board completo
 * @param opts   { adpDisp, calib }
 * @returns { byKey, ranking, boardByPos, weights } oppure null
 */
export function computeDraftGrade(grades, proj, opts = {}) {
    if (!grades?.length || !proj?.size) return null;
    const adpDisp = opts.adpDisp || null;
    const calib = opts.calib || null;
    const pickThr = calib?.pickThresholds || DEFAULT_PICK_THRESHOLDS;
    const teamThr = calib?.teamThresholds || DEFAULT_TEAM_THRESHOLDS;

    const allPicks = grades.flatMap(g => g.list).filter(p => p.value != null);
    if (!allPicks.length) return null;
    // due metri distinti: `repl` = ultimo titolare di lega (per il TALENTO),
    // `waiver` = miglior non draftato (per il voto delle singole pick)
    const repl = replacementLevels(allPicks, 'value');
    const rawBoard = buildBoard(proj, {});
    if (!rawBoard.length) return null;
    const waiver = waiverLevels(rawBoard, allPicks);
    const board = buildBoard(proj, waiver);

    // curva draft-capital: quanto "pesa" la slot k (per la media pesata)
    const byAdp = board.filter(e => e.adp != null).sort((a, b) => a.adp - b.adp);
    const byVal = [...board].sort((a, b) => b.vor - a.vor);
    const capitalRef = byAdp.length >= allPicks.length ? byAdp : byVal;
    const capitalAt = (k) => capitalRef[Math.min(k, capitalRef.length) - 1]?.vor ?? 0;

    // ordine globale delle pick + turno successivo di ogni squadra
    const flat = grades.flatMap(g => g.list.map(p => ({ p, key: g.key })))
        .filter(x => x.p.value != null)
        .sort((a, b) => a.p.pick - b.p.pick);
    const nextPickOf = new Map();   // pick → prossima pick della stessa squadra
    const remainingOf = new Map();  // pick → quante pick restano a quella squadra
    for (const g of grades) {
        const ordered = g.list.filter(p => p.value != null).sort((a, b) => a.pick - b.pick);
        ordered.forEach((p, i) => {
            nextPickOf.set(p.pick, ordered[i + 1]?.pick ?? null);
            remainingOf.set(p.pick, ordered.length - i);
        });
    }

    /**
     * PASSATA 1 — la linea del tempo del draft.
     *
     * Per ogni pick registra CHI pickava, con quale rosa e con quale board
     * davanti. Serve alla passata 2 per rispondere "sarebbe arrivato al mio
     * turno successivo?" guardando il fabbisogno delle squadre che pickano in
     * mezzo, non solo l'ADP: in una lega a 4 fra due tuoi turni ci sono due o
     * tre scelte, e sono di squadre di cui conosciamo la rosa esatta.
     */
    const timeline = [];
    {
        const taken = new Set();
        const rosters = Object.fromEntries(grades.map(g => [g.key, []]));
        for (const { p, key } of flat) {
            const hit = matchProjection(proj, p.player, p.pos);
            const pk = hit ? `${normName(hit.name)}|${p.pos}` : `${normName(p.player)}|${p.pos}`;
            timeline.push({
                pick: p.pick, teamKey: key, pickedKey: pk,
                roster: [...rosters[key]],
                available: board.filter(e => !taken.has(e.key)),
            });
            taken.add(pk);
            rosters[key].push(p);
        }
    }
    const byPickNo = new Map(timeline.map(t => [t.pick, t]));

    // PASSATA 2 — il voto vero e proprio
    const taken = new Set();
    const takenBy = new Map();
    const rosters = Object.fromEntries(grades.map(g => [g.key, []]));
    const pickResults = Object.fromEntries(grades.map(g => [g.key, []]));
    const oppCache = new Map(); // probabilità di scelta avversaria, per numero di pick

    for (const { p, key } of flat) {
        const pk = byPickNo.get(p.pick).pickedKey;
        const available = board.filter(e => !taken.has(e.key)); // include la pick corrente
        const nextPick = nextPickOf.get(p.pick);
        // le scelte ALTRUI che cadono fra questo turno e il tuo successivo
        const interveningPicks = nextPick == null ? [] :
            timeline.filter(t => t.pick > p.pick && t.pick < nextPick && t.teamKey !== key);
        const res = analyzePick(p, {
            waiver, available, rosterSoFar: rosters[key], adpDisp,
            nextPick, pickedKey: pk,
            picksLeft: remainingOf.get(p.pick), thresholds: pickThr,
            interveningPicks, oppCache,
        });
        pickResults[key].push(res);
        taken.add(pk);
        takenBy.set(pk, { teamKey: key, pick: p.pick });
        rosters[key].push(p);
    }

    // talento: VOR del lineup titolare, e quota sul totale di lega
    const starterVORof = {};
    for (const g of grades) {
        const list = g.list.filter(p => p.value != null);
        const { starters } = pickStarters(list, 'value');
        starterVORof[g.key] = starters.reduce((s, p) => s + Math.max(0, (p.value || 0) - (repl[p.pos] || 0)), 0);
    }
    const leagueVOR = Object.values(starterVORof).reduce((a, b) => a + b, 0) || 1;
    const leagueBestVOR = Math.max(...Object.values(starterVORof));

    const byKey = {};
    for (const g of grades) {
        const list = g.list.filter(p => p.value != null);
        const results = pickResults[g.key].sort((a, b) => a.pick - b.pick);

        // efficienza: media dei PickValue pesata per draft-capital
        let num = 0, den = 0;
        for (const r of results) { const w = capitalAt(r.pick) + 1; num += w * r.score; den += w; }
        const efficiency = den ? num / den : NEUTRAL;

        // talento: quota di VOR titolari sul totale di lega (0.25 = media)
        const share = starterVORof[g.key] / leagueVOR;
        const talent = clamp(50 + (share - 1 / grades.length) * 400, 0, 100);

        const totalVOR = list.reduce((s, p) => s + Math.max(0, (p.value || 0) - (repl[p.pos] || 0)), 0);
        const starterShare = totalVOR ? starterVORof[g.key] / totalVOR : 0;
        const score = clamp(TALENT_WEIGHT * talent + EFFICIENCY_WEIGHT * efficiency, 0, 100);

        const ranked = [...results].sort((a, b) => b.score - a.score);
        const t = {
            key: g.key,
            score: +score.toFixed(1),
            letter: letterForScore(score, teamThr),
            grade: Math.round(displayScore(score, teamThr)), // numero a schermo
            picks: results,
            components: {
                talent: +talent.toFixed(1),
                efficiency: +efficiency.toFixed(1),
                efficiencyGrade: Math.round(displayScore(efficiency, pickThr)),
                starterVOR: Math.round(starterVORof[g.key]),
                totalVOR: Math.round(totalVOR),
                starterShare: +starterShare.toFixed(2),
                leagueBestVOR: Math.round(leagueBestVOR),
            },
            bestPick: ranked[0] || null,
            worstPick: ranked[ranked.length - 1] || null,
        };
        t.narrative = buildNarrative(t);
        t.strategy = positionalStrategy(g.key, results, timeline, { adpDisp, oppCache, nextPickOf });
        byKey[g.key] = t;
    }

    // rank per voto e per i due assi
    const ranking = Object.values(byKey).sort((a, b) => b.score - a.score).map(t => t.key);
    ranking.forEach((k, i) => { byKey[k].rank = i + 1; });
    const rankBy = (field) => {
        const o = Object.values(byKey).sort((a, b) => b.components[field] - a.components[field]);
        o.forEach((t, i) => { byKey[t.key].components[`${field}Rank`] = i + 1; });
    };
    rankBy('talent'); rankBy('efficiency');
    for (const k of ranking) byKey[k].why = teamWhy(byKey[k]);

    // board per posizione (top per VOR) con chi ha preso chi — alimenta la
    // curva di scarsità nella pagina team. Solo l'attacco: K/DEF non hanno tier utili.
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

    return {
        byKey, ranking, boardByPos,
        weights: { talent: TALENT_WEIGHT, efficiency: EFFICIENCY_WEIGHT },
        calibrated: !!calib,
    };
}

export { pickWhy };
