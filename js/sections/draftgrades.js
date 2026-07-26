/**
 * Draft Grades — pagelle del draft in stile analisi NFL post-draft.
 *
 * Il voto giudica la scelta COL SENNO DEL GIORNO DEL DRAFT: si basa sulle
 * proiezioni preseason Sleeper (fonte Rotowire) dell'anno del draft stesso —
 * Sleeper le conserva storicamente per ogni stagione dal 2018 in poi, non
 * solo per l'anno corrente — convertite nello scoring della lega, con
 * reach/steal misurati sull'ADP reale (mancante solo per il 2019).
 *
 * Per le stagioni già giocate, ogni pick mostra anche come è andata poi
 * (produzione reale da honors bundle) con badge "rivelazione"/"flop" quando
 * si discosta molto dal proiettato — un confronto in più, non un secondo voto.
 *
 * Baseline dei voti: "draft perfetto" — l'atteso della pick n° N è l'N-esimo
 * miglior valore proiettato dell'intero pool draftato quell'anno. Il voto
 * della squadra è il rapporto tra valore raccolto e valore atteso delle sue slot.
 *
 * Per K e DEF il valore pesa anche la produzione reale recente (pesi
 * calibrati empiricamente, vedi player-history.js); per l'attacco lo storico
 * alimenta solo trend e segnali di rischio, non il numero.
 */

import { fetchDraftData, flattenDraft, displayName, SEASONS } from '../data.js?v=32';
import { TEAM_KEYS } from '../data/team-config.js?v=31';
import { TEAMS } from './team.js?v=23';
import { getHonorsBundle } from '../data/honors.js?v=13';
import { getSeasonProjections, matchProjection } from '../data/projections.js?v=15';
import { getHistoryIndex, blendValue, riskFlag, trendBadge, historyLine } from '../data/player-history.js?v=13';
import { initPlayerModal } from '../components/player-modal.js?v=24';
import { playerImageService } from '../services/player-image-service.js?v=15';
import { pickSeeded } from '../data/magazine-voices.js?v=17';
import { predictSeason } from '../data/draft-predictions.js?v=12';
import { getContextScore, getDraftModel } from '../data/context-score.js?v=4';
import { evaluateLeague, replacementLevels, TSI_LABELS } from '../data/team-eval.js?v=1';

let initialized = false;
let currentYear = null;
const _draftCache = {};

const fmt0 = (n) => Math.round(n).toLocaleString('it-IT');
const fmt1 = (n) => (+n).toLocaleString('it-IT', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
export const POS_ORDER = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];
export const POS_FALLBACK_PROJ = { K: 125, DEF: 110 }; // media storica di lega, usata solo senza dati

// ─── Commenti da pagellone (varianti seeded) ─────────────────────

export const GRADE_COMMENTS = {
    A: [
        (c) => `Draft da manuale: ${c.team} ha trasformato quasi ogni slot in valore, e la sala war-room merita gli straordinari pagati. ${c.best} è la mossa che gli altri rimpiangeranno a lungo.`,
        (c) => `Poco da dire: quando esci dal draft con ${c.best} e un board così equilibrato, hai fatto il compito meglio di tutti. Le rivali sono avvisate.`,
        (c) => `${c.team} ha letto il board come un libro aperto: valore ad ogni giro e il colpo ${c.best} a fare da ciliegina. Applausi.`,
    ],
    B: [
        (c) => `Compito solido per ${c.team}: nessun disastro, buon valore complessivo e il guizzo ${c.best}. Manca il colpo che sposta gli equilibri, ma le basi ci sono.`,
        (c) => `${c.team} porta a casa un draft ordinato: qualche occasione lasciata sul tavolo, ma la spina dorsale c'è e ${c.best} può diventare la sorpresa.`,
        (c) => `Sufficienza piena e qualcosa in più: ${c.team} ha evitato le trappole del board e con ${c.best} ha messo fieno in cascina.`,
    ],
    C: [
        (c) => `Draft in chiaroscuro per ${c.team}: il valore raccolto è sotto le attese delle sue slot, e ${c.worst} è il tipo di scelta che a dicembre pesa. ${c.best} tiene a galla la pagella.`,
        (c) => `${c.team} esce dal draft con più dubbi che certezze: troppe pick sotto la pari, anche se ${c.best} salva l'onore. Servirà un mercato molto attento.`,
        (c) => `Qualcosa non ha girato nella war-room di ${c.team}: ${c.worst} è difficile da spiegare, e il board offriva di meglio in più occasioni.`,
    ],
    D: [
        (c) => `Serata da dimenticare per ${c.team}: valore lasciato sul tavolo a ogni giro e ${c.worst} come simbolo di un board letto al contrario. Il mercato è l'ultima spiaggia.`,
        (c) => `Il draft di ${c.team} è la lezione su cosa non fare: reach in serie, reparti scoperti e ${c.worst} che grida vendetta. Si riparte dalle waiver.`,
        (c) => `${c.team} ha pescato controcorrente, e non in senso buono: la pagella piange e solo ${c.best} evita il fondo. Annata in salita già dal via.`,
    ],
};

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
        content.innerHTML = `<div class="empty-state"><p class="empty-state-text">Nessun draft disponibile</p></div>`;
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
    content.innerHTML = `<div class="loading-state"><div class="spinner"></div><p>Correzione dei compiti ${year}...</p></div>`;

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
            label: `proiezioni preseason ${year} (Rotowire via Sleeper)`,
            proj, seasonPlayed, actualPlayers,
            detailOf: evaluator.detailOf,
        };
        const grades = computeGrades(picks, evaluator.valueOf, meta);
        const pred = await predictSeason(year, grades).catch(() => null);
        // Context Score (SOS+) da nflverse: layer aggiuntivo, NON tocca i voti.
        // Degradazione graceful: se i dati mancano, ctx resta null e si mostra
        // solo la pagella classica.
        const model = await attachContextScores(grades, year).catch(() => null);
        // Team Strength Index (TSI): motore di valutazione della ROSA (non tocca
        // il voto ufficiale). Usa p.ctx già attaccato sopra. Graceful se assente.
        await evaluateLeague(grades, year).catch((e) => console.warn('[team-eval]', e));
        // Voto di fine stagione (VOR) — solo stagioni giocate; non tocca il post-draft.
        const vor = seasonPlayed ? computeVorGrades(picks, meta) : null;
        if (currentYear !== year) return;

        content.innerHTML = renderGrades(year, grades, meta, pred, model, vor);
        loadHeadshots(content, year);
        setTimeout(() => console.log(`[draftgrades] pick matchate su proiezioni ${year}: ${evaluator.matched()}/${picks.length}`), 0);
    } catch (e) {
        console.error('[draftgrades]', e);
        content.innerHTML = `<div class="empty-state"><p class="empty-state-text">Errore nel calcolo delle pagelle</p></div>`;
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
 * Voti di fine stagione (VOR) per tutte le squadre + mappa key→{letter,rank,ratio}.
 * Ritorna null se la stagione non è stata giocata.
 */
export function computeVorGrades(picks, meta) {
    if (!meta.seasonPlayed) return null;
    const vor = makeVorEvaluator(picks, meta.actualPlayers);
    const grades = computeGrades(picks, vor.valueOf, { ...meta, mode: 'vor' });
    const byKey = {};
    grades.forEach((g, i) => { byKey[g.key] = { letter: letterFor(g.ratio, i), rank: i, ratio: g.ratio }; });
    return { grades, byKey, replacement: vor.replacement };
}

export function letterFor(ratio, rank) {
    let letter;
    if (ratio >= 1.08) letter = 'A+';
    else if (ratio >= 1.02) letter = 'A';
    else if (ratio >= 0.97) letter = rank === 0 ? 'A-' : 'B+';
    else if (ratio >= 0.92) letter = 'B';
    else if (ratio >= 0.87) letter = 'B-';
    else if (ratio >= 0.82) letter = 'C';
    else if (ratio >= 0.75) letter = 'C-';
    else letter = 'D';
    return letter;
}

export const gradeBand = (letter) => letter[0]; // A/B/C/D

/** Badge "com'è andata poi" — confronta produzione reale con la proiezione */
export function outcomeBadge(p) {
    if (p.actual == null || p.value < 15) return '';
    const ratio = p.value > 0 ? p.actual / p.value : (p.actual > 50 ? 99 : 0);
    if (ratio >= 1.35) return `<span class="dg-badge dg-badge--up">rivelazione</span>`;
    if (ratio <= 0.55) return `<span class="dg-badge dg-badge--down">flop</span>`;
    return '';
}

/** Lettura data-driven della strategia (prime scelte + tempistiche ruoli) */
export function strategyLine(list) {
    const early = list.filter(p => p.round <= 3).map(p => p.pos);
    const count = (pos) => early.filter(x => x === pos).length;
    const firstOf = (pos) => list.find(p => p.pos === pos)?.round ?? null;
    const parts = [];
    if (count('RB') >= 2) parts.push(`avvio RB-heavy (${count('RB')} RB nei primi 3 giri)`);
    else if (count('WR') >= 2) parts.push(`ricevitori prima di tutto (${count('WR')} WR nei primi 3 giri)`);
    else parts.push(`avvio bilanciato (${early.join(', ') || '—'})`);
    const qbR = firstOf('QB');
    if (qbR) parts.push(qbR <= 3 ? `QB in anticipo al giro ${qbR}` : qbR >= 8 ? `QB rimandato al giro ${qbR}` : `QB al giro ${qbR}`);
    const kR = firstOf('K'), dR = firstOf('DEF');
    const earliest = Math.min(kR ?? 99, dR ?? 99);
    if (earliest <= 10) parts.push(`K/DEF anticipati al giro ${earliest} — scelta coraggiosa, per usare un eufemismo`);
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
        ? ` <span class="dg-bust" title="Probabilità flop stimata dal modello (Brier < base-rate 6/7 stagioni)">flop ${Math.round(ctx.bustProb * 100)}%</span>` : '';
    return `<span class="dg-sos" title="Player Context Score (SOS+): attacco NFL, volume, efficienza, calendario, trend">SOS+ ${ctx.contextScore}</span>${bust}`;
}

/** Mini-barre TSI in testa alla card: le componenti chiave della forza rosa. */
function tsiMiniBars(g) {
    const keys = ['starter', 'posAdv', 'vor', 'risk', 'balance'];
    const bars = keys.filter(k => g.tsiSub?.[k] != null).map(k => {
        const v = g.tsiSub[k];
        const cls = v >= 60 ? ' dg-tsibar--good' : v <= 40 ? ' dg-tsibar--bad' : '';
        return `<span class="dg-tsibar${cls}" title="${TSI_LABELS[k]}: ${v}/100">
            <small>${TSI_LABELS[k]}</small>
            <span class="dg-tsibar-track"><span style="width:${v}%"></span></span>
        </span>`;
    }).join('');
    return `<div class="dg-tsibars">${bars}</div>`;
}

function renderGrades(year, grades, meta, pred, model, vor) {
    const seed = (+year) * 41;

    const summary = grades.map((g, i) => {
        const t = TEAMS[g.key];
        const letter = letterFor(g.ratio, i);
        const eos = vor?.byKey?.[g.key];
        return `
        <div class="dg-sum" style="--team-color:${t.color};--dg-i:${i}">
            <img src="${t.logo}" alt="${t.name}" onerror="this.style.display='none'">
            <span class="dg-sum-name">${t.name}</span>
            ${eos ? `<span class="dg-eos" title="Voto di fine stagione (VOR): quanto ha reso la rosa davvero">FS ${eos.letter}</span>` : ''}
            <span class="dg-letter dg-letter--${gradeBand(letter)}" title="Voto post-draft (proiezioni)">${letter}</span>
            ${g.tsi != null ? `<span class="dg-tsi" title="Team Strength Index — forza complessiva della rosa (0-100)">TSI ${Math.round(g.tsi)}</span>` : ''}
        </div>`;
    }).join('');

    const cards = grades.map((g, i) => teamCard(g, i, year, meta, seed, pred)).join('');

    return `
    <div class="dg-summary">${summary}</div>
    ${powerRanking(grades)}
    ${cards}
    <p class="dg-footnote">Voti basati su ${meta.label}, con l'ADP reale per reach e steal${year === '2019' ? ' (ADP non disponibile per il 2019: solo il valore proiettato)' : ''}.${meta.seasonPlayed ? ' I badge "rivelazione"/"flop" confrontano la proiezione con la produzione poi ottenuta in stagione.' : ''} Baseline: "draft perfetto" — l'atteso della pick n° N è l'N-esimo miglior valore proiettato del pool draftato. Per kicker e difese il valore pesa anche la produzione reale recente (60% e 35%): sulle 419 pick 2019-2025 migliora nettamente la previsione, mentre per l'attacco le proiezioni battono ogni metrica storica. Lo storico resta però il miglior segnale di rischio: i veterani 6+ anni in calo hanno floppato il 36% delle volte (media lega 10%).${pred ? ` Pronostici e chance Super Bowl: Monte Carlo su ${fmt0(pred.iterations)} stagioni simulate dai valori del draft — lineup ottimale settimana per settimana${pred.byesKnown ? ' con le bye week NFL reali' : ' (bye week non disponibili per questa stagione)'}, calendario di lega (rotazione fissa verificata 2019-2025), playoff 1ª-4ª e 2ª-3ª con tiebreak sui punti fatti, variabilità settimanale per giocatore.` : ''}${model ? ` <b>SOS+</b> (Player Context Score): indice 0-100 da dati NFL avanzati nflverse dell'anno precedente — qualità dell'attacco, volume, efficienza, calendario per ruolo, trend — mostrato accanto al voto. Il modello di valore, validato leave-one-season-out (2019-2024), conferma le proiezioni senza batterle, quindi <b>non</b> cambia le pagelle; il modello di flop probability invece batte il base-rate in 6 stagioni su 7 e alimenta i badge "flop".` : ''}${grades.some(g => g.tsi != null) ? ` <b>TSI</b> (Team Strength Index): indice 0-100 che valuta la ROSA, non la somma delle pick — forza dei titolari, vantaggio posizionale, scarsità (VOR), profondità, rischio, bilanciamento, bye, stack e contesto NFL. È un indice di lettura (pesi di design, 50 ≈ media lega), affiancato al voto ufficiale che NON cambia.` : ''}${vor ? ` <b>FS</b> (voto di Fine Stagione): pagella retrospettiva su base <b>VOR</b> (Value Over Replacement) — la produzione reale di ogni pick sopra il livello di replacement della lega per quel ruolo, così ruoli diversi diventano comparabili. È un secondo voto, non sostituisce quello post-draft.` : ''}</p>`;
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

    const chip = (rank) => `<span class="dg-rank dg-rank--${rank}">${rank}ª</span>`;
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
        <span class="mc-kicker">Classifica forza roster · dai valori del draft</span>
        <div class="dg-rk-wrap">
            <table class="dg-rk-table">
                <thead><tr><th>Squadra</th><th>Totale</th>${POS_ORDER.map(p => `<th>${p}</th>`).join('')}</tr></thead>
                <tbody>${rows}</tbody>
            </table>
        </div>
        <p class="pm-note">Punti proiettati raccolti al draft, totali e per reparto (1ª = reparto più forte della lega).</p>
    </section>`;
}

function teamCard(g, rank, year, meta, seed, pred) {
    const t = TEAMS[g.key];
    const letter = letterFor(g.ratio, rank);
    const band = gradeBand(letter);

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

    const pickBox = (p, kind) => {
        if (!p) return '';
        const title = kind === 'best' ? 'La pick giusta' : 'La pick sbagliata';
        let label;
        if (meta.mode === 'proj' && p.adp) {
            const diff = Math.round(p.adp - p.pick);
            label = diff > 6 ? `reach: preso #${p.pick}, ADP ${Math.round(p.adp)}`
                : diff < -6 ? `steal di mercato: preso #${p.pick}, ADP ${Math.round(p.adp)}`
                    : `pick #${p.pick} · ADP ${Math.round(p.adp)}`;
        } else {
            label = `pick #${p.pick} · round ${p.round}`;
        }
        const d = meta.detailOf?.(p);
        const histRow = d?.hist?.seasons?.length
            ? `<span class="dg-pick-hist">${historyLine(d.hist, p.pos)} ${trendBadge(d.hist)}</span>` : '';
        return `
        <div class="dg-pick dg-pick--${kind}" data-player-modal
             data-player-name="${p.player}" data-pos="${p.pos}" data-nfl="${p.nfl || ''}" data-year="${year}">
            <img class="dg-headshot" src="images/fallback-player.svg" alt="${p.player}"
                 data-player-name="${p.player}" data-team="${p.nfl}" data-pos="${p.pos}">
            <div class="dg-pick-info">
                <span class="dg-pick-kind">${title}</span>
                <span class="dg-pick-name">${p.player} <small>${p.pos}${p.nfl ? ` · ${p.nfl}` : ''}</small></span>
                <span class="dg-pick-meta">${label}</span>
                <span class="dg-pick-val">${fmt0(p.value)} pt ${d?.wHist ? 'attesi (proiezione + storico)' : 'proiettati'} <small>vs ${fmt0(p.expected)} attesi (${p.delta >= 0 ? '+' : ''}${fmt0(p.delta)})</small></span>
                ${p.ctx ? `<span class="dg-pick-sos">${sosChip(p.ctx)}${p.ctx.floor != null ? ` <small>range ${fmt0(p.ctx.floor)}–${fmt0(p.ctx.ceiling)}</small>` : ''}</span>` : ''}
                ${histRow}
                ${p.actual != null ? `<span class="dg-pick-actual">poi: ${fmt0(p.actual)} pt reali ${outcomeBadge(p)}</span>` : ''}
            </div>
        </div>`;
    };

    const comment = pickSeeded(GRADE_COMMENTS[band], seed + g.key.length)({
        team: t.name,
        best: g.best ? g.best.player : 'nessuno',
        worst: g.worst ? g.worst.player : 'nessuno',
    });

    const rows = g.list.map(p => {
        const d = meta.detailOf?.(p);
        const risk = d?.risk?.level === 'alto'
            ? `<span class="dg-risk" title="${d.risk.label}">!</span>` : '';
        return `
        <div class="dg-row" data-player-modal
             data-player-name="${p.player}" data-pos="${p.pos}" data-nfl="${p.nfl || ''}" data-year="${year}">
            <span class="dg-row-pick">#${p.pick}</span>
            <span class="allpro-pos pos-${p.pos.toLowerCase().replace('/', '')}">${p.pos}</span>
            <span class="dg-row-name">${p.player}${risk}</span>
            <span class="dg-row-val">${fmt0(p.value)}</span>
            <span class="dg-row-delta ${p.delta >= 0 ? 'up' : 'down'}">${p.delta >= 0 ? '▲' : '▼'} ${fmt0(Math.abs(p.delta))}</span>
            ${p.ctx?.contextScore != null ? `<span class="dg-row-sos" title="Player Context Score (SOS+)">SOS+ ${p.ctx.contextScore}</span>` : ''}
            ${d?.hist ? trendBadge(d.hist) : ''}
            ${outcomeBadge(p)}
        </div>`;
    }).join('');

    return `
    <article class="mosaic-card mc-wide dg-card mc-in" data-team-key="${g.key}" data-year="${year}" style="--team-color:${t.color};--card-glow:${t.color}">
        <header class="dg-head">
            <img class="dg-head-logo" src="${t.logo}" alt="${t.name}" onerror="this.style.display='none'">
            <div class="dg-head-info">
                <h2 class="mc-title">${t.name}</h2>
                <span class="dg-head-meta">${fmt0(g.total)} punti attesi al draft · baseline ${fmt0(g.expected)} · resa ${(g.ratio * 100).toFixed(0)}%${g.sosAvg != null ? ` · <span class="dg-sos" title="Media Player Context Score (SOS+) dell'attacco">SOS+ medio ${g.sosAvg}</span>` : ''}${g.tsi != null ? ` · <span class="dg-tsi" title="Team Strength Index — forza della rosa (0-100)">TSI ${g.tsi}${g.tsiRank ? ` · ${g.tsiRank}ª lega` : ''}</span>` : ''}</span>
                ${g.tsi != null ? tsiMiniBars(g) : ''}
                <span class="dg-cta">Analisi completa del draft →</span>
            </div>
            <span class="dg-letter dg-letter--big dg-letter--${band}">${letter}</span>
        </header>
        <div class="dg-body">
            <div class="dg-col">
                <span class="mc-kicker">Reparti vs mediana lega</span>
                <div class="dg-bars">${bars}</div>
                <span class="mc-kicker">Strategia</span>
                <p class="dg-strategy">${strategyLine(g.list)}</p>
                <p class="dg-comment">${comment}</p>
            </div>
            <div class="dg-col">
                ${pickBox(g.best, 'best')}
                ${pickBox(g.worst, 'worst')}
                <details class="dg-details">
                    <summary>Tutte le ${g.list.length} pick</summary>
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
            <span class="dg-pred-label">Pronostico stagione</span>
            <span class="dg-pred-value">${p.record}</span>
            <small>${fmt1(p.expW)} vittorie attese su ${pred.weeks}</small>
        </div>
        <div class="dg-pred-item">
            <span class="dg-pred-label">Media prevista</span>
            <span class="dg-pred-value">${fmt1(p.muAvg)} pt</span>
            <small>a settimana, bye incluse</small>
        </div>
        <div class="dg-pred-item dg-pred-item--sb">
            <span class="dg-pred-label">Chance Super Bowl</span>
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
