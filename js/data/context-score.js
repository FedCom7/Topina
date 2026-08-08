/**
 * Player Context Score (SOS+) — indice composito 0-100 che pesa contesto
 * attacco NFL, volume, efficienza, calendario per ruolo, calendario playoff,
 * trend, età/esperienza e durabilità, oltre alla produzione storica.
 *
 * INVARIANTE: per l'anno di draft Y usa SOLO dati fino a Y-1 (feature nflverse
 * delle stagioni precedenti) + il calendario Y (fisso) con la difficoltà difese
 * dell'anno Y-1 mappata sugli avversari Y. Nessun dato reale dell'anno Y.
 *
 * Fonte dati: data/nfl/adv_players_{Y}.json + adv_team_{Y}.json (generati da
 * scripts/build-nflverse-features.mjs) + team_stats_{Y}.json per il calendario.
 * Questi dati alimentano SOLO il modello e le pagine full-stats — non il resto
 * dell'app. Se i JSON mancano getContextScore ritorna null → il chiamante usa
 * il baseline Sleeper (degradazione graceful, pagina mai vuota).
 *
 * I pesi del composito qui sono i PESI FISSI di riferimento/fallback; quando
 * esiste data/model/draft_model_v1.json (pesi appresi) il chiamante li usa.
 */

import { normName } from './projections.js?v=76';
import { getTeamStats } from './nfl-team-stats.js?v=19';
import { canonAbbr } from './nfl-schedule.js?v=20';
import { getSeasonConfig } from '../data.js?v=33';

const _players = {};   // year → adv_players json (o null)
const _team = {};      // year → adv_team json (o null)
const _pool = {};      // year → indice derivato per i percentili
let _model;            // draft_model_v1.json (undefined = non ancora caricato, null = assente)

/** Ordine feature del modello (deve combaciare con build-draft-model.mjs). */
const OFF_POS = new Set(['QB', 'RB', 'WR', 'TE']);

/** Pesi fissi di riferimento del composito (mostrati in UI, sommano 1). */
export const FIXED_WEIGHTS = {
    teamOffense: 0.18, volume: 0.22, efficiency: 0.15, schedule: 0.12,
    playoff: 0.08, trend: 0.10, ageCurve: 0.08, durability: 0.07,
};

async function fetchJson(url) {
    try { const r = await fetch(url); return r.ok ? await r.json() : null; }
    catch { return null; }
}
async function advPlayers(year) {
    if (year in _players) return _players[year];
    return (_players[year] = await fetchJson(`data/nfl/adv_players_${year}.json`));
}
async function advTeam(year) {
    if (year in _team) return _team[year];
    return (_team[year] = await fetchJson(`data/nfl/adv_team_${year}.json`));
}
/** Modello draft allenato (pesi congelati). null se non ancora generato. */
export async function getDraftModel() {
    if (_model !== undefined) return _model;
    return (_model = await fetchJson('data/model/draft_model_v1.json'));
}

/**
 * Vettore feature nell'ordine del modello (deve combaciare con build-draft-model.mjs).
 * Le feature pre-draft leak-safe (draftCap, durab) sono APPESE in fondo: un modello
 * vecchio (11 coef) le ignora — applyLinear itera sui coef del modello, non su f.
 */
function modelFeatures(p, projValue, teamOffEpa, trend, extra = {}) {
    return [
        projValue, p.fpgLeague || 0, p.gp || 0, rawVolume(p), rawEff(p),
        teamOffEpa || 0, trend || 0, p.yearsExp || 0,
        p.pos === 'RB' ? 1 : 0, p.pos === 'WR' ? 1 : 0, p.pos === 'TE' ? 1 : 0,
        extra.draftCap ?? 0, extra.durab ?? 0,
    ];
}
/** Draft capital NFL 0-1 (identica al trainer). Statica → leak-safe. */
function draftCapFromPick(pick) {
    return pick ? (263 - Math.min(pick, 263)) / 262 : 0;
}
/** Durabilità 0-1: media gare (Y-1, Y-2) su 17 (identica al trainer). */
function durabFrom(p, p2) {
    const gps = [p?.gp, p2?.gp].filter(v => v != null);
    return gps.length ? (gps.reduce((a, b) => a + b, 0) / gps.length) / 17 : 0;
}
function applyLinear(f, model, w) {
    const { mu, sd } = model.standardize;
    let v = w.intercept;
    // itera sui coef DEL MODELLO: se il modello ha meno feature di f (versione
    // vecchia deployata) usa solo quelle che conosce (le prime, base, invariate).
    const n = Math.min(w.coef.length, f.length);
    for (let j = 0; j < n; j++) v += w.coef[j] * ((f[j] - mu[j]) / (sd[j] || 1));
    return v;
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const key = (name, pos) => `${normName(name)}|${(pos || '').toUpperCase()}`;

/** percentile 0-100 di v in un array ordinato crescente (interpolato). */
function pctRank(v, sorted) {
    if (v == null || !sorted.length) return null;
    let lo = 0, hi = sorted.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (sorted[m] < v) lo = m + 1; else hi = m; }
    return clamp((lo / sorted.length) * 100, 0, 100);
}

/** Valore grezzo di volume/efficienza per ruolo (0 se dati assenti). */
function rawVolume(p) {
    if (p.pos === 'RB') return (p.rushShare || 0) + 0.5 * (p.targetShare || 0) + 0.3 * (p.snapPct || 0);
    if (p.pos === 'WR' || p.pos === 'TE') return (p.wopr ?? ((p.targetShare || 0) + 0.4 * (p.airYardsShare || 0))) + 0.3 * (p.snapPct || 0);
    if (p.pos === 'QB') return (p.snapPct || 0) + (p.passAtt || 0) / 600;
    return 0;
}
function rawEff(p) {
    if (p.pos === 'RB') return (p.ryoePerAtt || 0) + 0.2 * ((p.ydsPerCarry || 0) - 4);
    if (p.pos === 'WR' || p.pos === 'TE') return 0.4 * (p.sep || 0) + 0.1 * (p.yacOE || 0) + 2 * ((p.catchRate || 0) - 0.62);
    if (p.pos === 'QB') return 0.4 * (p.cpoe || 0) + (p.epaPerGame || 0);
    return 0;
}

/** Costruisce (una volta) gli array ordinati per i percentili di un anno. */
async function poolFor(year) {
    if (year in _pool) return _pool[year];
    const data = await advPlayers(year);
    if (!data) return (_pool[year] = null);
    const byKey = {};
    const ranks = {};
    for (const p of Object.values(data.players)) {
        byKey[key(p.name, p.pos)] = p;
        const R = ranks[p.pos] ??= { volume: [], efficiency: [], production: [] };
        if (p.gp >= 4) { // solo chi ha un campione minimo alimenta i percentili
            R.volume.push(rawVolume(p));
            R.efficiency.push(rawEff(p));
            R.production.push(p.fpgLeague || 0);
        }
    }
    for (const R of Object.values(ranks)) for (const k of Object.keys(R)) R[k].sort((a, b) => a - b);
    return (_pool[year] = { byKey, ranks, players: data.players });
}

/** Team offense score 0-100 (percentile EPA/play fra le 32 squadre). */
function teamOffenseScore(team, teamData) {
    if (!teamData || !team || !teamData.teams[team]) return null;
    const vals = Object.values(teamData.teams).map(t => t.offEpaPerPlay).filter(v => v != null).sort((a, b) => a - b);
    return pctRank(teamData.teams[team].offEpaPerPlay, vals);
}

/**
 * Difficoltà calendario per ruolo, leak-safe: avversari dell'anno Y (da
 * team_stats_Y.schedule) con la FPA concessa dell'anno Y-1 (team_stats_{Y-1}).
 * Score alto = avversari che concedono TANTI punti al ruolo = facile.
 * `weeks` opzionale: sottoinsieme di settimane (per il calendario playoff).
 */
async function scheduleScore(team, pos, year, weeks) {
    if (!team) return null;
    const [cur, prev] = await Promise.all([
        getTeamStats(year).catch(() => null),
        getTeamStats(year - 1).catch(() => null),
    ]);
    const sched = cur?.teams?.[team]?.schedule;
    if (!sched) return null;
    const fpaSource = prev?.teams || cur?.teams; // fallback all'anno stesso se manca Y-1
    const ranks = [];
    for (const g of sched) {
        if (weeks && !weeks.includes(g.week)) continue;
        const opp = fpaSource?.[g.opp];
        const rank = opp?.fpa?.[pos]?.rank; // 1 = concede di più = facile
        if (rank != null) ranks.push(rank);
    }
    if (!ranks.length) return null;
    const avg = ranks.reduce((a, b) => a + b, 0) / ranks.length; // 1..32
    return clamp((32 - avg) / 31 * 100, 0, 100); // rank basso (facile) → score alto
}

/** Trend 0-100 dallo storico fpgLeague (Y-1..Y-3). 50 = stabile. */
async function trendScore(name, pos, year) {
    const vals = [];
    for (let y = year - 1; y >= year - 3; y--) {
        const pool = await poolFor(y);
        const p = pool?.byKey[key(name, pos)];
        vals.push(p && p.gp >= 4 ? (p.fpgLeague || 0) : null);
    }
    const pts = vals.filter(v => v != null);
    if (pts.length < 2) return null;
    // pendenza semplice (recente − vecchia) normalizzata sulla media
    const recent = vals[0] ?? pts[0];
    const old = pts[pts.length - 1];
    const base = (recent + old) / 2 || 1;
    const slope = (recent - old) / base; // ~ variazione relativa
    return clamp(50 + slope * 120, 0, 100);
}

/** Età/curva di rendimento per ruolo, da anni di esperienza. */
function ageCurveScore(pos, yearsExp) {
    if (yearsExp == null) return 50;
    const peak = { RB: 3, WR: 5, TE: 6, QB: 8, K: 8 }[pos] ?? 5;
    const width = { RB: 3, WR: 4, TE: 5, QB: 6, K: 8 }[pos] ?? 4;
    const d = (yearsExp - peak) / width;
    return clamp(100 * Math.exp(-0.5 * d * d), 15, 100);
}

/** Durabilità 0-100 dalle gare giocate nelle ultime stagioni. */
async function durabilityScore(name, pos, year) {
    const gps = [];
    for (let y = year - 1; y >= year - 3; y--) {
        const pool = await poolFor(y);
        const p = pool?.byKey[key(name, pos)];
        if (p) gps.push(p.gp);
    }
    if (!gps.length) return 50;
    return clamp(mean(gps) / 17 * 100, 0, 100);
}

const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);

/** Media/deviazione dei punti settimanali → cv per floor/ceiling e σ MC. */
function weeklyVariance(weekly) {
    const w = (weekly || []).filter(v => v != null);
    if (w.length < 3) return null;
    const m = mean(w);
    if (m <= 0) return null;
    const sd = Math.sqrt(mean(w.map(x => (x - m) ** 2)));
    return clamp(sd / m, 0.15, 1.2); // coefficiente di variazione
}

/**
 * Context Score completo di un giocatore per l'anno di draft.
 * @returns null se non ci sono dati nflverse (il chiamante usa il baseline).
 *   { contextScore, subScores{...}, expPts?, floor?, ceiling?, cv?, partial[], rookie }
 */
export async function getContextScore({ name, pos, team, year, projValue = null }) {
    pos = (pos || '').toUpperCase();
    team = team ? canonAbbr(team) : null;
    const py = year - 1;
    const pool = await poolFor(py);
    const teamData = await advTeam(py);
    if (!pool && !teamData) return null; // nessun dato: baseline

    const p = pool?.byKey[key(name, pos)];
    const partial = [];
    const rookie = !p;

    // --- sub-score 0-100 ---
    const R = pool?.ranks[pos];
    const sub = {};
    sub.teamOffense = teamOffenseScore(team, teamData);
    sub.volume = p && R ? pctRank(rawVolume(p), R.volume) : (rookie ? null : 50);
    sub.efficiency = p && R ? pctRank(rawEff(p), R.efficiency) : (rookie ? null : 50);
    const cfg = getSeasonConfig(year);
    const playoffWeeks = [cfg.playoffWeek, cfg.superBowlWeek];
    sub.schedule = await scheduleScore(team, pos, year, null);
    sub.playoff = await scheduleScore(team, pos, year, playoffWeeks);
    sub.trend = await trendScore(name, pos, year);
    sub.ageCurve = ageCurveScore(pos, p?.yearsExp ?? null);
    sub.durability = await durabilityScore(name, pos, year);

    // segna le dimensioni mancanti (rookie o dati assenti)
    for (const [k, v] of Object.entries(sub)) if (v == null) partial.push(k);

    // composito con pesi fissi: rinormalizza sui presenti (i mancanti → neutri 50)
    let num = 0, den = 0;
    for (const [k, w] of Object.entries(FIXED_WEIGHTS)) {
        const v = sub[k] ?? 50;
        num += w * v; den += w;
    }
    const contextScore = den ? +(num / den).toFixed(1) : null;

    // incertezza dal game-log dell'anno precedente
    const cv = weeklyVariance(p?.weekly);
    let floor = null, ceiling = null;
    if (projValue != null && cv != null) {
        floor = +(projValue * (1 - 0.9 * cv)).toFixed(1);
        ceiling = +(projValue * (1 + 0.9 * cv)).toFixed(1);
    }

    // --- modello allenato: bust probability (se adottato) e residuo (idem) ---
    let expPts = projValue, bustProb = null, usedModel = false;
    const model = await getDraftModel();
    if (model && p && OFF_POS.has(pos) && projValue != null) {
        const teamEpa = (team && teamData?.teams?.[team]?.offEpaPerPlay) || 0;
        // trend grezzo = fpg anno-1 − fpg anno-2 (come nel trainer)
        const pool2 = await poolFor(py - 1);
        const p2 = pool2?.byKey[key(name, pos)];
        const rawTrend = (p2 && p2.gp >= 4) ? ((p.fpgLeague || 0) - (p2.fpgLeague || 0)) : 0;
        // feature pre-draft leak-safe (usate solo se il modello le ha)
        const cd = await getCombineDraft(p.gsis).catch(() => null);
        const extra = { draftCap: draftCapFromPick(cd?.draft?.pick), durab: durabFrom(p, p2) };
        const f = modelFeatures(p, projValue, teamEpa, rawTrend, extra);
        if (model.bust?.adopted) {
            const z = applyLinear(f, model, model.bust);
            bustProb = +(1 / (1 + Math.exp(-z))).toFixed(3);
        }
        if (model.reg?.adopted && model.reg.mode === 'residual') {
            expPts = +(projValue + applyLinear(f, model, model.reg)).toFixed(1);
            usedModel = true;
        }
    }

    return {
        contextScore,
        subScores: Object.fromEntries(Object.entries(sub).map(([k, v]) => [k, v == null ? null : +v.toFixed(0)])),
        expPts, usedModel, bustProb,
        floor, ceiling, cv,
        prior: p ? { gp: p.gp, fpgLeague: p.fpgLeague, team: p.team } : null,
        partial, rookie,
    };
}

/**
 * Fattore σ per-partita (relativo) per il Monte Carlo: cv del giocatore
 * dall'anno precedente, con fallback al σ globale del simulatore quando manca.
 */
export async function perGameCv({ name, pos, year }) {
    const pool = await poolFor(year - 1);
    const p = pool?.byKey[key(name, (pos || '').toUpperCase())];
    return weeklyVariance(p?.weekly);
}

/**
 * Righe avanzate nflverse di un giocatore per le stagioni richieste (per la
 * pagina "tutte le statistiche"). Ritorna array {year, ...campi avanzati} solo
 * per le stagioni con dati. Questi campi NON esistono su Sleeper (volume-share,
 * EPA, CPOE, separazione, RYOE): union senza duplicati.
 */
/** Contesto attacco avanzato (EPA/play, success, PROE) di una squadra NFL. */
export async function getTeamAdvanced(team, year) {
    const data = await advTeam(year);
    return data?.teams?.[canonAbbr(team)] || null;
}

export async function getAdvancedSeasons(name, pos, years) {
    const k = key(name, (pos || '').toUpperCase());
    const out = [];
    for (const y of years) {
        const pool = await poolFor(y);
        const p = pool?.byKey[k];
        if (p) out.push({ year: y, ...p });
    }
    return out;
}

/**
 * Rosa "skill" (QB/RB/WR/TE/K) di una squadra in una stagione, con uso e
 * pt-lega — da adv_players_{Y}.json (già in cache per il Context Score).
 * Usata per unire produzione/uso ai compagni di squadra non-skill (roster_{Y}).
 */
export async function getTeamUsage(team, year) {
    const data = await advPlayers(year);
    if (!data) return [];
    const A = canonAbbr(team);
    return Object.values(data.players)
        .filter(p => canonAbbr(p.team) === A)
        .sort((a, b) => (b.fpgLeague || 0) - (a.fpgLeague || 0));
}

/**
 * Pool NFL dei ricevitori (WR/TE/RB con volume) di una stagione — riferimento
 * per i percentili dell'analisi target share. Usa la stessa cache adv_players.
 */
export async function getLeagueReceivers(year) {
    const data = await advPlayers(year);
    if (!data) return [];
    return Object.values(data.players).filter(p =>
        ['WR', 'TE', 'RB'].includes(p.pos) && (p.gp || 0) >= 4 && (p.tgtPerGame || 0) >= 1.5);
}

/**
 * Pool NFL dei giocatori di un ruolo (≥4 gare) in una stagione — riferimento per
 * i percentili del radar avanzato nella scheda giocatore. Stessa cache adv_players.
 */
export async function getAdvancedPool(pos, year) {
    const data = await advPlayers(year);
    if (!data) return [];
    const P = (pos || '').toUpperCase();
    return Object.values(data.players).filter(p => (p.pos || '').toUpperCase() === P && (p.gp || 0) >= 4);
}

/** Advanced offensivo (EPA/gioco, success rate, PROE…) di TUTTE le squadre — per
 *  lo scatter di confronto lega. Mappa { ABBR: {...} }. */
export async function getLeagueTeamsAdvanced(year) {
    const data = await advTeam(year);
    return data?.teams || {};
}

/** Punti fantasy lega TOTALI in stagione per squadra e ruolo (QB/RB/WR/TE) su
 *  tutta la NFL — per il rank della resa fantasy dell'attacco. Si usa il totale
 *  (pt/gara × partite), non la somma dei pt/gara, così le room concentrate non
 *  vengono penalizzate dalle squadre che ruotano tanti part-time. { ABBR: {...} }. */
export async function getLeagueTeamFantasy(year) {
    const data = await advPlayers(year);
    if (!data) return {};
    const out = {};
    for (const p of Object.values(data.players)) {
        if (!['QB', 'RB', 'WR', 'TE'].includes(p.pos) || p.fpgLeague == null) continue;
        const A = canonAbbr(p.team);
        (out[A] ||= { QB: 0, RB: 0, WR: 0, TE: 0 })[p.pos] += p.fpgLeague * (p.gp || 0);
    }
    return out;
}

// --- Combine, draft NFL reale, contratti (data/nfl/combine_draft.json) ----

let _combineDraft; // Promise<{players,teamDraftHistory}> | undefined

async function combineDraft() {
    if (_combineDraft !== undefined) return _combineDraft;
    return (_combineDraft = fetchJson('data/nfl/combine_draft.json'));
}

/** { combine, draft, contract } per gsis, o null se il giocatore non è nello storico draft NFL. */
export async function getCombineDraft(gsis) {
    if (!gsis) return null;
    const data = await combineDraft();
    return data?.players?.[gsis] || null;
}

/** Storico pick reali (non Topina) di una squadra NFL, più recenti prima. */
export async function getTeamDraftHistory(abbr) {
    const data = await combineDraft();
    return data?.teamDraftHistory?.[canonAbbr(abbr)] || [];
}

/**
 * Tutti i giocatori drafted nello stesso anno e ruolo (per il grafico
 * "pick vs carriera" nella pagina giocatore) — filtra dal file già in cache,
 * nessuna chiamata di rete aggiuntiva.
 */
export async function getDraftPeers(pos, season) {
    const data = await combineDraft();
    if (!data?.players) return [];
    const P = (pos || '').toUpperCase();
    return Object.values(data.players)
        .filter(p => p.pos === P && p.draft?.season === +season && p.draft?.pick != null)
        .map(p => ({ name: p.name, pick: p.draft.pick, careerAV: p.draft.careerAV ?? p.draft.weightedAV }))
        .sort((a, b) => a.pick - b.pick);
}

// NOTA: api.nfldata.org non manda header Access-Control-Allow-Origin
// (verificato in produzione: qualunque fetch browser verso quel dominio è
// bloccato da CORS, anche se funziona benissimo da Node/CI). Per questo il
// riempimento live dei buchi nelle metriche avanzate NON può passare da lì
// lato client — a differenza di ESPN (site.api/sports.core.api), che espone
// Access-Control-Allow-Origin: * e infatti alimenta dal vivo rosa/infortuni/
// contratti/riconoscimenti/ATS/storia franchigia altrove in questo modulo e
// in nfl-team-extras.js / nfl-team-profile-extra.js / player-bio-extra.js.
// La stagione corrente resta scoperta finché non passa il prossimo cron di
// build-nflverse-features.mjs (stesso degrado grazioso già usato ovunque).
