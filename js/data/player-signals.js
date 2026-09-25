/**
 * I segnali sui giocatori NFL: quanto vale un'occasione, quanti TD e quanti
 * punti "avrebbe dovuto" fare un giocatore, quanto e' costante, che calendario
 * lo aspetta, come si dividono i target nella sua squadra.
 *
 * Conti puri — niente DOM, niente rete: li usa `sections/player-stats.js`, che
 * gli passa le righe gia' costruite. Stanno qui per restare leggibili e per
 * poterli controllare da soli.
 *
 * Un principio vale per tutto il file: i coefficienti si MISURANO sulla lega,
 * non si scelgono. Quanti punti vale un target, quanti TD rende un'occasione in
 * red zone, quanto concede una difesa — tutto viene dai dati della stagione
 * (piu' quella prima, quando la stagione e' appena cominciata). Un numero
 * scelto a mano sarebbe un'opinione travestita da calcolo.
 */

import { LEAGUE_SCORING } from './scoring.js?v=592';
import { ROSTER_SLOTS, FLEX_ELIGIBLE } from './league-rules.js?v=528';
import { TEAM_KEYS } from './team-config.js?v=535';

const S = LEAGUE_SCORING;
const n = (v) => (v == null || Number.isNaN(Number(v)) ? 0 : Number(v));

/* ============================================================
   1. QUANTO VALE UN'OCCASIONE — i tassi di lega
   ============================================================ */

/**
 * Tassi di lega per ruolo, da una o piu' stagioni di statistiche Sleeper.
 *
 * `stagioni`: array di Map (quelle di `getSeasonStats`). Con piu' stagioni i
 * tassi si sommano insieme: a settembre, con due giornate, un tasso misurato
 * sulla sola stagione in corso balla troppo — il TD per target in red zone di
 * un ruolo puo' fare 0,50 o 0,20 per caso.
 *
 * Nei TD per occasione in red zone il numeratore sono TUTTI i TD, anche quelli
 * da 60 yard. E' voluto: cosi' il tasso "prezza" in media anche i TD lunghi, e
 * un giocatore con piu' TD dell'atteso e' davvero sopra la media del ruolo, non
 * solo fortunato fuori dalla red zone.
 */
export function tassiLega(stagioni) {
    const somma = {};
    for (const mappa of stagioni) {
        if (!mappa) continue;
        for (const e of mappa.values()) {
            const r = e.raw || {};
            const s = (somma[e.pos] ||= {
                rzTgt: 0, recTd: 0, rushRz: 0, rushTd: 0, passRz: 0, passTd: 0,
                tgt: 0, rec: 0, recYd: 0, rushAtt: 0, rushYd: 0, passAtt: 0, passYd: 0, passInt: 0,
            });
            s.rzTgt += n(r.rec_rz_tgt); s.recTd += n(r.rec_td);
            s.rushRz += n(r.rush_rz_att); s.rushTd += n(r.rush_td);
            s.passRz += n(r.pass_rz_att); s.passTd += n(r.pass_td);
            s.tgt += n(r.rec_tgt); s.rec += n(r.rec); s.recYd += n(r.rec_yd);
            s.rushAtt += n(r.rush_att); s.rushYd += n(r.rush_yd);
            s.passAtt += n(r.pass_att); s.passYd += n(r.pass_yd); s.passInt += n(r.pass_int);
        }
    }
    const div = (a, b) => (b ? a / b : 0);
    const out = {};
    for (const [pos, s] of Object.entries(somma)) {
        out[pos] = {
            tdPerRzTgt: div(s.recTd, s.rzTgt),
            tdPerRzCarry: div(s.rushTd, s.rushRz),
            tdPerRzPass: div(s.passTd, s.passRz),
            // quanti punti di lega vale in media un'occasione di quel tipo
            ptsPerTarget: div(s.rec * S.rec + s.recYd * S.rec_yd + s.recTd * S.rec_td, s.tgt),
            ptsPerCarry: div(s.rushYd * S.rush_yd + s.rushTd * S.rush_td, s.rushAtt),
            ptsPerPass: div(s.passYd * S.pass_yd + s.passTd * S.pass_td + s.passInt * S.pass_int, s.passAtt),
        };
    }
    return out;
}

/* ============================================================
   2. TD ATTESI — chi ha segnato troppo, chi troppo poco
   ============================================================ */

/**
 * TD attesi dalle occasioni in red zone, con i tassi del SUO ruolo.
 *
 * `conPassaggi`: per un QB da solo i TD lanciati contano; nel filtro All no,
 * perche' li' tutti si confrontano sullo scrimmage (corse e ricezioni).
 * Ritorna null se il giocatore non ha avuto nemmeno un'occasione: "zero TD su
 * zero occasioni" non e' ne' fortuna ne' sfortuna.
 */
export function tdAttesi(riga, tassi, conPassaggi = riga.pos === 'QB') {
    const t = tassi[riga.pos];
    if (!t) return null;
    const occ = n(riga.rzTgt) + n(riga.rushRzAtt) + (conPassaggi ? n(riga.passRzAtt) : 0);
    if (!occ) return null;
    const attesi = n(riga.rzTgt) * t.tdPerRzTgt + n(riga.rushRzAtt) * t.tdPerRzCarry
        + (conPassaggi ? n(riga.passRzAtt) * t.tdPerRzPass : 0);
    const veri = n(riga.recTd) + n(riga.rushTd) + (conPassaggi ? n(riga.passTd) : 0);
    return { attesi, veri, scarto: veri - attesi, occasioni: occ };
}

/* ============================================================
   3. PUNTI ATTESI — uso contro produzione
   ============================================================ */

/**
 * Quanti punti avrebbe fatto un giocatore medio del suo ruolo con le SUE
 * occasioni: portate × valore medio di una portata + target × valore medio di
 * un target (+ lanci, per i QB). E' il suo "uso" espresso in punti, cosi' RB e
 * WR stanno sulla stessa scala.
 *
 * Il confronto e' con i punti che quelle stesse voci gli hanno dato davvero
 * (yard, ricezioni, TD, intercetti) — non col totale di lega, che contiene
 * anche fumble e conversioni da due e sporcherebbe lo scarto con cose che
 * l'uso non c'entra.
 */
export function puntiAttesi(riga, tassi) {
    const t = tassi[riga.pos];
    if (!t) return null;
    const attesi = n(riga.rushAtt) * t.ptsPerCarry + n(riga.tgt) * t.ptsPerTarget
        + (riga.pos === 'QB' ? n(riga.passAtt) * t.ptsPerPass : 0);
    if (!attesi) return null;
    const veri = n(riga.rushYd) * S.rush_yd + n(riga.rushTd) * S.rush_td
        + n(riga.rec) * S.rec + n(riga.recYd) * S.rec_yd + n(riga.recTd) * S.rec_td
        + (riga.pos === 'QB'
            ? n(riga.passYd) * S.pass_yd + n(riga.passTd) * S.pass_td + n(riga.passInt) * S.pass_int
            : 0);
    return { attesi, veri, scarto: veri - attesi };
}

/* ============================================================
   4. COSTANZA — pavimento, tetto, settimane da titolare
   ============================================================ */

/** Percentile con interpolazione lineare, su un array GIA' ordinato. */
function percentile(ord, p) {
    if (!ord.length) return null;
    const i = (ord.length - 1) * p;
    const lo = Math.floor(i), hi = Math.ceil(i);
    return ord[lo] + (ord[hi] - ord[lo]) * (i - lo);
}

/**
 * I numeri della costanza da una serie di punti partita per partita.
 *
 * Pavimento e tetto sono il 25° e il 75° percentile, non la peggiore e la
 * migliore: una partita lasciata al primo quarto per un infortunio non dice
 * niente del giocatore, e sul minimo peserebbe da sola.
 */
export function costanza(punti) {
    const v = (punti || []).map(Number).filter(Number.isFinite);
    if (!v.length) return null;
    const ord = [...v].sort((a, b) => a - b);
    const media = v.reduce((a, b) => a + b, 0) / v.length;
    const sd = Math.sqrt(v.reduce((a, b) => a + (b - media) ** 2, 0) / v.length);
    return {
        n: v.length, media, sd,
        cv: media > 0 ? sd / media : null,
        min: ord[0], max: ord[ord.length - 1],
        p25: percentile(ord, 0.25), mediana: percentile(ord, 0.5), p75: percentile(ord, 0.75),
    };
}

/**
 * Quanti titolari di quel ruolo schiera la lega in una giornata: squadre ×
 * posti in formazione, piu' la meta' dei FLEX per ciascuno dei due ruoli che
 * possono occuparlo (qui solo RB e WR).
 */
export function titolariDiLega(pos) {
    const squadre = Object.keys(TEAM_KEYS).length || 4;
    let posti = (ROSTER_SLOTS[pos] || 0) * squadre;
    if (FLEX_ELIGIBLE.includes(pos)) posti += (ROSTER_SLOTS.FLEX || 0) * squadre / FLEX_ELIGIBLE.length;
    return Math.round(posti);
}

/**
 * La "linea da titolare" di un ruolo: la media a partita dell'ultimo titolare
 * della lega — il 10° WR se la lega ne schiera 10. Una partita sopra quella
 * linea e' una partita in cui avresti voluto averlo in formazione.
 *
 * E' una linea di STAGIONE, non di settimana: i punti partita per partita di
 * nflverse non dicono in che giornata NFL sono stati fatti (le bye li
 * sfasano), quindi il rango settimana per settimana non si ricostruisce.
 */
export function lineaTitolare(serie, pos) {
    const quanti = titolariDiLega(pos);
    const del = serie.filter(x => x.pos === pos && x.c).sort((a, b) => b.c.media - a.c.media);
    if (!quanti || !del.length) return null;
    return del[Math.min(quanti, del.length) - 1].c.media;
}

/* ============================================================
   5. CALENDARIO — quanto concedono le prossime avversarie
   ============================================================ */

/**
 * Peso della stagione precedente, in partite. A inizio stagione i punti
 * concessi di una difesa si basano su due partite e dicono poco: si mescolano
 * con quelli dell'anno prima, che valgono come QUATTRO partite. Man mano che
 * si gioca la stagione in corso pesa sempre di piu' — alla 12ª giornata e' gia'
 * tre quarti del totale.
 */
const PARTITE_PRIOR = 4;

/**
 * La difficolta' del calendario, squadra per squadra, per un ruolo.
 *
 * `cur`, `prec`: i file team_stats della stagione e di quella prima (`prec` puo'
 * mancare). `finestra`: 'rest' tutte le partite che restano, 'next4' le
 * prossime quattro. A stagione chiusa non ne resta nessuna: si misura il
 * calendario AFFRONTATO, e `chiusa` lo dice a chi disegna.
 */
export function calendario(cur, prec, pos, finestra = 'rest') {
    const squadre = cur?.teams || {};
    const stima = {};
    for (const [abbr, t] of Object.entries(squadre)) {
        const g = n(t.games);
        const c = t.fpa?.[pos]?.pgLeague;
        const p = prec?.teams?.[abbr]?.fpa?.[pos]?.pgLeague;
        if (c == null && p == null) continue;
        stima[abbr] = c == null ? p
            : p == null ? c
                : (g * c + PARTITE_PRIOR * p) / (g + PARTITE_PRIOR);
    }
    const valori = Object.values(stima);
    if (!valori.length) return null;
    const media = valori.reduce((a, b) => a + b, 0) / valori.length;

    const future = Object.values(squadre).some(t => (t.schedule || []).some(x => x.result == null));
    const righe = [];
    for (const [abbr, t] of Object.entries(squadre)) {
        let partite = (t.schedule || []).filter(x => x.opp && (future ? x.result == null : true));
        if (finestra === 'next4' && future) partite = partite.slice(0, 4);
        const avv = partite.map(x => ({ ...x, stima: stima[x.opp] ?? media }));
        if (!avv.length) continue;
        const valore = avv.reduce((a, x) => a + x.stima, 0) / avv.length;
        righe.push({ team: abbr, avversari: avv, valore, indice: valore - media });
    }
    righe.sort((a, b) => b.indice - a.indice);
    return { righe, media, chiusa: !future };
}

/* ============================================================
   6. ALBERI — come si dividono i palloni
   ============================================================ */

/**
 * Tre modi di contare "i palloni" di una squadra.
 *
 * - `target`: i passaggi lanciati verso un giocatore — WR, TE, RB.
 * - `corse`: le portate. Ci sono anche i QB: una corsa del quarterback e' una
 *   portata che al running back non arriva, e senza di loro la quota dei RB di
 *   una squadra con un QB che corre (Hurts, Allen, Jackson) risultava gonfiata.
 * - `tocchi`: target + portate, le occasioni di un giocatore in tutto. E' la
 *   misura che mette RB e ricevitori sullo stesso piano.
 */
export const MISURE_ALBERO = {
    target: { valore: (r) => r.tgt || 0, ruoli: ['WR', 'TE', 'RB'] },
    corse: { valore: (r) => r.rushAtt || 0, ruoli: ['RB', 'QB', 'WR', 'TE'] },
    tocchi: { valore: (r) => (r.tgt || 0) + (r.rushAtt || 0), ruoli: ['RB', 'WR', 'TE', 'QB'] },
};

/**
 * Per ogni squadra, come si dividono i palloni fra i suoi giocatori.
 *
 * Chi ha meno del 6% finisce in "altri": una squadra NFL fa girare la palla fra
 * una decina di giocatori, e dieci spicchi da due pixel non si leggono. La
 * squadra e' quella ATTUALE del giocatore: chi e' stato scambiato porta i suoi
 * palloni nella squadra nuova.
 */
export function alberi(righe, misura = 'target', soglia = 0.06) {
    const m = MISURE_ALBERO[misura] || MISURE_ALBERO.target;
    const per = new Map();
    for (const r of righe) {
        if (!r.team || !m.ruoli.includes(r.pos) || !m.valore(r)) continue;
        (per.get(r.team) || per.set(r.team, []).get(r.team)).push(r);
    }
    const out = [];
    for (const [team, lista] of per) {
        const tot = lista.reduce((a, r) => a + m.valore(r), 0);
        if (!tot) continue;
        const ord = [...lista].sort((a, b) => m.valore(b) - m.valore(a));
        const fette = [], altri = { n: 0, valore: 0 };
        for (const r of ord) {
            const v = m.valore(r), quota = v / tot;
            if (quota >= soglia) fette.push({ name: r.name, pos: r.pos, valore: v, quota, r });
            else { altri.valore += v; altri.n += 1; }
        }
        out.push({ team, tot, fette, altri: { ...altri, quota: altri.valore / tot }, primo: fette[0]?.quota || 0 });
    }
    return out.sort((a, b) => b.primo - a.primo);
}
