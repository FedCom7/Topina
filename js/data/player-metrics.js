/**
 * Metriche avanzate derivate dal game log di un giocatore.
 * Funzioni pure, nessun fetch: riusabili dai Draft Grades.
 *
 * `games` è un array di gare (ordinate per settimana) nel formato prodotto
 * da player-full.js: { week, pts, isAway, stats }. `pts` è il punteggio di
 * riferimento (punti lega quando calcolabili, altrimenti half-PPR).
 */

const r1 = (v) => (v == null || Number.isNaN(v) ? null : +v.toFixed(1));
const r2 = (v) => (v == null || Number.isNaN(v) ? null : +v.toFixed(2));

/** Statistiche di distribuzione e forma su una stagione. */
export function computeSeasonMetrics(games) {
    const pts = (games || []).map(g => g.pts).filter(p => p != null);
    if (!pts.length) return null;

    const n = pts.length;
    const media = pts.reduce((a, b) => a + b, 0) / n;
    const sorted = [...pts].sort((a, b) => a - b);
    const mediana = n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
    const devStd = Math.sqrt(pts.reduce((a, p) => a + (p - media) ** 2, 0) / n);
    const cv = media > 0 ? devStd / media : null;

    // boom/bust relative alla propria media: robuste tra ruoli diversi
    const boomPct = media > 0 ? pts.filter(p => p >= media * 1.5).length / n : null;
    const bustPct = media > 0 ? pts.filter(p => p <= media * 0.5).length / n : null;

    // trend: regressione lineare punti ~ indice gara (pt/settimana)
    let slope = null;
    if (n >= 3) {
        const xm = (n - 1) / 2;
        let num = 0, den = 0;
        pts.forEach((p, i) => { num += (i - xm) * (p - media); den += (i - xm) ** 2; });
        slope = den ? num / den : 0;
    }
    const trendLabel = slope == null ? null : slope > 0.35 ? 'up' : slope < -0.35 ? 'down' : 'flat';

    const avgOf = (arr) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;
    const home = (games || []).filter(g => g.pts != null && g.isAway === false).map(g => g.pts);
    const away = (games || []).filter(g => g.pts != null && g.isAway === true).map(g => g.pts);

    return {
        gp: n,
        media: r1(media), mediana: r1(mediana),
        devStd: r1(devStd), cv: r2(cv),
        consistency: cv == null ? null : r2(Math.max(0, 1 - cv)), // come player-history.js
        boomPct: boomPct == null ? null : Math.round(boomPct * 100),
        bustPct: bustPct == null ? null : Math.round(bustPct * 100),
        ceiling: r1(sorted[n - 1]), floor: r1(sorted[0]),
        last3Avg: n >= 3 ? r1(avgOf(pts.slice(-3))) : null,
        last5Avg: n >= 5 ? r1(avgOf(pts.slice(-5))) : null,
        trend: slope == null ? null : { slope: r2(slope), label: trendLabel },
        homeAvg: r1(avgOf(home)), awayAvg: r1(avgOf(away)),
    };
}

/**
 * Efficienza dai totali stagionali raw di Sleeper (nomi singolari).
 * `fp` = punti fantasy di riferimento della stagione (per FP/tocco e FP/target).
 */
export function computeEfficiency(totals, pos, fp) {
    if (!totals) return null;
    const g = (k) => parseFloat(totals[k]) || 0;
    const P = (pos || '').toUpperCase();
    if (P === 'K' || P === 'DEF') return null;

    const touches = g('rush_att') + g('rec');
    const scrimYd = g('rush_yd') + g('rec_yd');
    const scrimTd = g('rush_td') + g('rec_td');
    const tgt = g('rec_tgt');

    const out = {
        ydsPerTouch: touches ? r1(scrimYd / touches) : null,
        tdPerTouch: touches ? r2(scrimTd / touches) : null,
        fpPerTouch: touches && fp != null ? r1(fp / touches) : null,
        fpPerTarget: tgt && fp != null ? r1(fp / tgt) : null,
        catchPct: tgt ? Math.round((g('rec') / tgt) * 100) : null,
    };
    if (P === 'QB') {
        out.ydsPerAtt = g('pass_att') ? r1(g('pass_yd') / g('pass_att')) : null;
        out.tdPerTouch = null; out.ydsPerTouch = null; // per i QB contano gli att, non i touch
    }
    return out;
}

/** Quota snap di una gara (percentuale, null se dati mancanti). */
export function snapSharePct(game) {
    const s = game?.stats || {};
    const snp = parseFloat(s.off_snp), tm = parseFloat(s.tm_off_snp);
    if (!snp || !tm) return null;
    return Math.round((snp / tm) * 100);
}
