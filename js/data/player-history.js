/**
 * Storico di carriera dei giocatori (stagioni NFL reali via Sleeper) al
 * servizio dei Draft Grades: blend del voto per K/DEF, segnali di
 * rischio/trend e picco carriera per l'analisi.
 *
 * ⚠️ PESI CALIBRATI su un'analisi empirica delle 419 pick 2019-2025
 * (correlazione di Spearman col punteggio reale poi ottenuto):
 *  - QB/RB/WR/TE: le proiezioni preseason (ρ=0.64) battono qualunque blend
 *    con lo storico, in ogni fascia di esperienza → peso storico ZERO.
 *    Testato anche il residuo proiezione-vs-reale di carriera (chi batteva
 *    le proiezioni NON continua a farlo: persistenza ρ=0.07) e il picco
 *    carriera (ρ=0.27): entrambi peggiorano il voto se aggiunti.
 *  - K: 0.4·proiezione + 0.6·totale anno prima porta ρ da 0.41 a 0.70
 *    (Sleeper non proietta i field goal, quindi la proiezione K è cieca).
 *  - DEF: tutto quasi rumore (n=29); 0.65·proiezione + 0.35·storico
 *    per-game è la combinazione migliore trovata (ρ 0.07 → 0.29).
 *  - Il vero valore dello storico è come segnale di rischio: i veterani
 *    6+ anni con trend in calo hanno floppato il 36% delle volte (vs 10%
 *    di media lega); trend in calo generico: 17%.
 * Non ritoccare i pesi senza rifare l'analisi.
 *
 * La CARRIERA (fino a CAREER_DEPTH stagioni, stats Sleeper dal 2015) serve
 * all'analisi: righe multi-stagione robuste agli infortuni, picco carriera
 * («quando è stato ad alto livello»), trend. Il blend del voto usa solo le
 * ultime 3 stagioni (finestra su cui è stato calibrato).
 */

import { getSeasonStats, matchProjection } from './projections.js?v=15';

const BLEND_DEPTH = 3;              // finestra del blend/trend (calibrata)
const CAREER_DEPTH = 6;             // stagioni mostrate/analizzate
const FIRST_STATS_YEAR = 2015;      // Sleeper non ha stats stagionali prima
const RECENCY_W = [0.5, 0.3, 0.2];  // peso anno-1, anno-2, anno-3 (rinormalizzati)
const MIN_GP = 6;                   // sotto: stagione-infortunio, esclusa dalla media
const SEASON_LEN = 17;              // normalizzazione per-game → stagione

export const HIST_WEIGHT = { K: 0.6, DEF: 0.35 }; // offense assente = 0

/**
 * Indice storico per un anno di draft: fetch parallelo delle stats reali
 * delle stagioni precedenti (gli anni che falliscono vengono saltati).
 */
export async function getHistoryIndex(draftYear) {
    const years = [];
    for (let k = 1; k <= CAREER_DEPTH; k++) {
        const y = +draftYear - k;
        if (y >= FIRST_STATS_YEAR) years.push(y);
    }
    const settled = await Promise.allSettled(years.map(y => getSeasonStats(y)));
    const maps = settled.map((r, i) => r.status === 'fulfilled'
        ? { year: years[i], back: i + 1, map: r.value } : null).filter(Boolean);

    const _cache = new Map();
    return {
        forPlayer(name, pos) {
            const key = `${(name || '').toLowerCase()}|${pos}`;
            if (_cache.has(key)) return _cache.get(key);

            const seasons = [];
            for (const { year, back, map } of maps) {
                const hit = matchProjection(map, name, pos);
                const pts = hit ? (hit.ptsLeague ?? hit.ptsStd) : null;
                if (pts == null) continue;
                seasons.push({
                    year, back, ptsLeague: pts, gp: hit.gp ?? 0,
                    ptsPerGame: hit.gp ? pts / hit.gp : null,
                    posRank: hit.posRank ?? null,
                });
            }
            const hist = seasons.length ? buildHist(seasons) : null;
            _cache.set(key, hist);
            return hist;
        },
    };
}

function buildHist(seasons) {
    // blend/trend/consistenza SOLO sulla finestra calibrata (ultime 3 stagioni)
    const recent = seasons.filter(s => s.back <= BLEND_DEPTH);
    const valid = recent.filter(s => s.gp >= MIN_GP && s.ptsPerGame != null);
    let histPts = null;
    if (valid.length) {
        let num = 0, den = 0;
        for (const s of valid) {
            const w = RECENCY_W[s.back - 1] ?? 0.2;
            num += w * s.ptsPerGame * SEASON_LEN;
            den += w;
        }
        histPts = num / den;
    }

    const prior = seasons.find(s => s.back === 1) || null;

    // trend: per-game dell'anno-1 vs media storica (soglie ±8%)
    let trend = null;
    const prior1Pg = prior && prior.gp >= MIN_GP ? prior.ptsPerGame * SEASON_LEN : null;
    if (prior1Pg != null && histPts != null && valid.length >= 2) {
        trend = prior1Pg >= histPts * 1.08 ? 'up'
            : prior1Pg <= histPts * 0.92 ? 'down' : 'flat';
    }

    // consistenza: 1 - coefficiente di variazione del per-game
    let consistency = null;
    if (valid.length >= 2) {
        const pgs = valid.map(s => s.ptsPerGame);
        const mean = pgs.reduce((a, b) => a + b, 0) / pgs.length;
        const sd = Math.sqrt(pgs.reduce((s, x) => s + (x - mean) ** 2, 0) / pgs.length);
        consistency = mean > 0 ? Math.max(0, 1 - sd / mean) : null;
    }

    // picco carriera: la miglior stagione piena su tutta la profondità
    const full = seasons.filter(s => s.gp >= MIN_GP);
    const peak = full.length
        ? [...full].sort((a, b) => b.ptsLeague - a.ptsLeague)[0] : null;
    // «lontano dai massimi»: picco vecchio (4+ anni) e livello attuale < 60% del picco
    const offPeak = !!(peak && peak.back >= 4 && histPts != null && histPts < peak.ptsLeague * 0.6);

    return {
        seasons: seasons.sort((a, b) => a.back - b.back),
        histPts,
        prior1Tot: prior ? prior.ptsLeague : null,
        trend, consistency,
        peak, offPeak,
    };
}

/**
 * Valore di una pick: proiezione pura per l'attacco, blend calibrato per
 * K (totale anno prima) e DEF (storico per-game). Ritorna il dettaglio
 * per la UI, non solo il numero.
 */
export function blendValue(projValue, hist, pos) {
    const base = { value: projValue, wHist: 0, projValue, histRef: null };
    if (pos === 'K' && hist?.prior1Tot != null) {
        const w = HIST_WEIGHT.K;
        return { value: (1 - w) * projValue + w * hist.prior1Tot, wHist: w, projValue, histRef: hist.prior1Tot };
    }
    if (pos === 'DEF' && hist?.histPts != null) {
        const w = HIST_WEIGHT.DEF;
        return { value: (1 - w) * projValue + w * hist.histPts, wHist: w, projValue, histRef: hist.histPts };
    }
    return base;
}

/** Segnale di rischio dai numeri storici della lega (vedi nota in testa). */
export function riskFlag(hist, yearsExp) {
    if (hist?.trend !== 'down') return null;
    if (yearsExp != null && yearsExp >= 6) {
        return { level: 'alto', label: 'veterano in calo — flop nel 36% dei casi storici' };
    }
    return { level: 'medio', label: 'trend in calo — flop nel 17% dei casi storici' };
}

export function trendBadge(hist) {
    if (!hist?.trend) return '';
    const map = {
        up: ['dg-trend--up', '↗ in crescita'],
        flat: ['dg-trend--flat', '→ stabile'],
        down: ['dg-trend--down', '↘ in calo'],
    };
    const [cls, txt] = map[hist.trend];
    return `<span class="dg-trend ${cls}" title="Per-game ultima stagione vs media ultime ${BLEND_DEPTH}">${txt}</span>`;
}

const fmt0 = (n) => Math.round(n).toLocaleString('it-IT');

/** Riga riassuntiva delle stagioni, es. «2023: 245 pt (WR8) · 2021: 4 gare (infortunio)» */
export function historyLine(hist, pos, max = 3) {
    if (!hist?.seasons?.length) return '';
    return hist.seasons.slice(0, max).map(s => {
        if (s.gp < MIN_GP) return `${s.year}: ${s.gp} gar${s.gp === 1 ? 'a' : 'e'} (infortunio)`;
        const rank = s.posRank ? ` (${pos}${s.posRank})` : '';
        return `${s.year}: ${fmt0(s.ptsLeague)} pt${rank}`;
    }).join(' · ');
}

/** Nota sul picco carriera, es. «ai suoi massimi nel 2021 (RB3, 280 pt)» */
export function peakNote(hist, pos) {
    if (!hist?.peak) return '';
    const p = hist.peak;
    const rank = p.posRank ? `${pos}${p.posRank}, ` : '';
    const base = `ai suoi massimi nel ${p.year} (${rank}${fmt0(p.ptsLeague)} pt)`;
    return hist.offPeak ? `${base} — oggi lontano da quel livello` : base;
}
