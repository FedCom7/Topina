/**
 * Proiezioni stagionali NFL via API Sleeper (gratuita, senza chiave,
 * CORS aperto — endpoint non documentato ma standard della community).
 * Fonte proiezioni: Rotowire (campo `company` nel payload).
 *
 * Le stat proiettate vengono convertite nei punti della lega tramite
 * scoring.js. Note:
 *  - K: Sleeper non proietta i field goal a livello stagionale → projPts
 *    resta null e il chiamante applica un fallback storico.
 *  - DEF: le stat proiettate non bastano per le fasce punti-subiti →
 *    si usa pts_std di Sleeper (scoring standard, molto vicino al nostro).
 */

import { scoreProjectedStats } from './scoring.js?v=592';
import { cacheGet, cacheSet } from '../utils/storage.js?v=1';

const TTL_MS = 24 * 60 * 60 * 1000; // le proiezioni cambiano di rado
const STATS_TTL_MS = 7 * 24 * 60 * 60 * 1000; // le stat storiche non cambiano
const _mem = {};
const _memStats = {};

/**
 * Le uniche statistiche che teniamo in `raw`. Sleeper ne manda 66 per voce e
 * l'86% del peso erano varianti di ADP che non guardiamo (dynasty, 2QB, IDP,
 * rookie, std, half-PPR): 3,5 MB di localStorage per anno, su una quota di 5.
 *
 * L'elenco è l'unione di chi legge `raw`: lo scoring di lega (SLEEPER_MAP in
 * scoring.js), la decomposizione proiezione-vs-reale (STAT_DEFS in
 * perf-explain.js) e le tabelle della pagina giocatore (CATEGORIES in
 * player-page.js). Aggiungendo una statistica a una di quelle tre va aggiunta
 * QUI, altrimenti dalla cache arriva un trattino.
 */
const KEPT_STATS = new Set([
    // scoring di lega
    'pass_yd', 'pass_td', 'pass_int', 'rush_yd', 'rush_td', 'rec', 'rec_yd', 'rec_td',
    'fum_lost', 'pass_2pt', 'rush_2pt', 'rec_2pt', 'fgm_0_19', 'fgm_20_29', 'fgm_30_39',
    'fgm_40_49', 'fgm_50p', 'xpm', 'sack', 'int', 'fum_rec', 'def_td', 'def_st_td',
    'safe', 'def_2pt', 'pts_allow',
    // riepiloghi e disponibilità
    'adp_ppr', 'pts_std', 'pts_ppr', 'pts_half_ppr', 'gp', 'gs', 'gms_active',
    'pos_rank_ppr', 'pos_rank_half_ppr', 'off_snp', 'tm_off_snp', 'yds_allow', 'penalty',
    // tabelle pagina giocatore
    'pass_att', 'pass_cmp', 'cmp_pct', 'pass_rtg', 'pass_sack', 'pass_air_yd', 'pass_fd', 'pass_rz_att',
    'rush_att', 'rush_ypa', 'rush_lng', 'rush_fd', 'rush_rz_att', 'rush_yac',
    'rec_tgt', 'rec_ypr', 'rec_ypt', 'rec_lng', 'rec_air_yd', 'rec_yar', 'rec_fd', 'rec_rz_tgt', 'rec_drop',
    'fgm', 'fga', 'fgm_lng', 'xpa',
    'idp_tkl', 'idp_tkl_solo', 'idp_sack', 'idp_int', 'idp_ff', 'idp_fum_rec',
    'idp_pass_def', 'idp_qb_hit', 'idp_tkl_loss', 'idp_def_td', 'idp_safe',
    'kr', 'kr_yd', 'kr_td', 'pr', 'pr_yd', 'pr_td', 'st_td',
]);

/** Copia di `stats` con le sole chiavi che qualcuno legge davvero. */
export function trimStats(stats) {
    if (!stats) return stats;
    const out = {};
    for (const k in stats) if (KEPT_STATS.has(k) && stats[k] != null) out[k] = stats[k];
    return out;
}

/** Voce senza i campi nulli: a 2900 giocatori i `null` da soli sono centinaia di KB. */
function compact(entry) {
    const out = {};
    for (const k in entry) if (entry[k] != null) out[k] = entry[k];
    return out;
}

function urlFor(kind, year) {
    const pos = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF']
        .map(p => `position%5B%5D=${p}`).join('&');
    // ADP/ranking full PPR: la lega è full PPR (rec=1, vedi league-rules.js),
    // quindi il metro di mercato deve essere PPR, non half-PPR.
    return `https://api.sleeper.com/${kind}/nfl/${year}?season_type=regular&${pos}&order_by=adp_ppr`;
}

/** normalizzazione nome per il matching (come player-image-service) */
export function normName(name) {
    return (name || '').toLowerCase().replace(/[.,']/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * Map proiezioni per l'anno: chiave `${normName}|${POS}` →
 * { name, pos, team, adp, projPts, ptsStd, gp, raw }
 * `raw` è l'oggetto stat grezzo di Sleeper (rush_yd, pass_td, rec, ecc.):
 * stessi nomi di campo delle stat REALI di getSeasonStats/player-full.js,
 * quindi riusabile dagli stessi renderer (es. CATEGORIES in player-page.js).
 */
export async function getSeasonProjections(year) {
    if (_mem[year]) return _mem[year];

    const cacheKey = `topina_proj_v5_${year}`;
    const hit = cacheGet(cacheKey, TTL_MS);
    if (hit) return (_mem[year] = new Map(hit));

    const res = await fetch(urlFor('projections', year));
    if (!res.ok) throw new Error(`Sleeper projections ${res.status}`);
    const list = await res.json();

    const map = new Map();
    list.forEach(e => {
        const pl = e.player;
        if (!pl) return;
        const pos = (pl.position || '').toUpperCase();
        const name = `${pl.first_name} ${pl.last_name}`; // DEF: es. "Seattle Seahawks"
        const stats = e.stats || {};
        const entry = {
            name, pos,
            playerId: e.player_id ?? pl.player_id ?? null,
            team: e.team || pl.team || '',
            adp: stats.adp_ppr && stats.adp_ppr < 999 ? stats.adp_ppr : null,
            projPts: scoreProjectedStats(stats),
            ptsStd: stats.pts_std ?? null,
            gp: stats.gp ?? null,
            // metadati anagrafici/stato (lo status infortuni è quello ATTUALE,
            // sensato solo per l'anno di draft più recente)
            yearsExp: pl.years_exp ?? null,
            rookieYear: pl.metadata?.rookie_year ? +pl.metadata.rookie_year : null,
            injuryStatus: pl.injury_status || null,
            injuryBodyPart: pl.injury_body_part || null,
            injuryNotes: pl.injury_notes || null,
            raw: stats,
        };
        // niente proiezioni né adp → voce inutile
        if (entry.projPts == null && entry.ptsStd == null && entry.adp == null) return;
        const key = `${normName(name)}|${pos}`;
        // in caso di omonimi tieni quello col team (attivo)
        if (!map.has(key) || (entry.team && !map.get(key).team)) map.set(key, entry);
    });

    // In memoria la mappa resta intera; su disco va la versione magra —
    // `raw` solo per chi una proiezione ce l'ha davvero (637 voci su 2896:
    // le altre sono coda di ADP, e le loro stat sono vuote comunque).
    cacheSet(cacheKey, [...map.entries()].map(([k, e]) => [k, compact({
        ...e, raw: e.projPts == null && e.ptsStd == null ? null : trimStats(e.raw),
    })]));
    return (_mem[year] = map);
}

/**
 * Statistiche REALI di una stagione (endpoint gemello delle proiezioni).
 * Map `${normName}|${POS}` → riepilogo stagionale del giocatore: punti,
 * partite, rank di ruolo, volume (target, snap, carries). Usata per la riga
 * "com'era andato l'anno prima" nell'analisi del draft.
 */
export async function getSeasonStats(year) {
    if (_memStats[year]) return _memStats[year];

    const cacheKey = `topina_stats_v4_${year}`;
    const hit = cacheGet(cacheKey, STATS_TTL_MS);
    if (hit) return (_memStats[year] = new Map(hit));

    const res = await fetch(urlFor('stats', year));
    if (!res.ok) throw new Error(`Sleeper stats ${res.status}`);
    const list = await res.json();

    const map = new Map();
    list.forEach(e => {
        const pl = e.player;
        const s = e.stats || {};
        if (!pl || (s.pts_half_ppr == null && s.pts_std == null)) return;
        const pos = (pl.position || '').toUpperCase();
        const name = `${pl.first_name} ${pl.last_name}`;
        const entry = {
            name, pos,
            playerId: e.player_id ?? pl.player_id ?? null,
            team: e.team || pl.team || '',
            ptsLeague: scoreProjectedStats(s), // punti nello scoring della lega (null per DEF: mancano le fasce)
            ptsHalf: s.pts_half_ppr, ptsPpr: s.pts_ppr ?? null, ptsStd: s.pts_std ?? null,
            gp: s.gp ?? null, gs: s.gs ?? null,
            posRank: s.pos_rank_ppr ?? s.pos_rank_half_ppr ?? null,
            rec: s.rec ?? null, tgt: s.rec_tgt ?? null, recYd: s.rec_yd ?? null,
            rzTgt: s.rec_rz_tgt ?? null, drops: s.rec_drop ?? null,
            rushAtt: s.rush_att ?? null, rushYd: s.rush_yd ?? null,
            passAtt: s.pass_att ?? null, passYd: s.pass_yd ?? null, passTd: s.pass_td ?? null,
            snaps: s.off_snp ?? null,
            fgm: s.fgm ?? null, xpm: s.xpm ?? null,
            sacks: s.sack ?? null, defInt: s.int ?? null,
        };
        const key = `${normName(name)}|${pos}`;
        // omonimi: tieni chi ha giocato di più
        if (!map.has(key) || (entry.gp || 0) > (map.get(key).gp || 0)) map.set(key, entry);
    });

    cacheSet(cacheKey, [...map.entries()].map(([k, e]) => [k, compact(e)]));
    return (_memStats[year] = map);
}

/** Match di una pick del draft contro le proiezioni: esatto poi fuzzy. */
export function matchProjection(projMap, playerName, pos) {
    const P = (pos || '').toUpperCase().replace('W/R', 'WR');
    const key = `${normName(playerName)}|${P}`;
    if (projMap.has(key)) return projMap.get(key);

    // fuzzy: stesso ruolo, un nome contiene l'altro (es. suffissi Jr./III)
    const target = normName(playerName);
    let best = null, bestScore = 0;
    for (const e of projMap.values()) {
        if (e.pos !== P) continue;
        const cand = normName(e.name);
        let score = 0;
        if (cand === target) score = 100;
        else if (cand.includes(target)) score = 80;
        else if (target.includes(cand)) score = 70;
        else {
            // stesso cognome + stessa iniziale (gestisce nomi abbreviati)
            const [tf, ...tr] = target.split(' ');
            const [cf, ...cr] = cand.split(' ');
            if (tr.join(' ') === cr.join(' ') && tf[0] === cf[0]) score = 60;
        }
        if (score > bestScore) { bestScore = score; best = e; }
    }
    return bestScore >= 60 ? best : null;
}
