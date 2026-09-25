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
import { cacheGet, cacheSet } from '../utils/storage.js?v=16';

const TTL_MS = 24 * 60 * 60 * 1000; // le proiezioni cambiano di rado
const STATS_TTL_MS = 7 * 24 * 60 * 60 * 1000; // le stat storiche non cambiano
/*
 * ...ma quelle della stagione IN CORSO si': una settimana di cache voleva dire
 * fotografare la classifica al primo accesso e tenerla ferma sette giorni.
 * Successo nella week 1 del 2026: aperta la pagina Players dopo il Thursday
 * Night, Smith-Njigba e' rimasto "il migliore" per tutta la domenica mentre
 * Caleb Williams, Josh Allen e Derrick Henry lo superavano — nella lista non
 * c'erano proprio, perche' al momento della foto non avevano ancora giocato.
 *
 * Un'ora e' il compromesso: i punti di Sleeper si aggiornano a fine partita,
 * e la risposta e' pesante abbastanza da non volerla a ogni apertura.
 * Il TTL si valuta alla LETTURA sulla data di scrittura, quindi una cache
 * vecchia gia' salvata scade subito, senza bisogno di cambiare la chiave.
 */
const STATS_TTL_LIVE_MS = 60 * 60 * 1000;

/** La stagione NFL in corso: da settembre a febbraio compreso. */
function stagioneInCorso(year) {
    const d = new Date();
    const anno = d.getMonth() < 2 ? d.getFullYear() - 1 : d.getFullYear();
    return Number(year) >= anno;
}
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
    // difese (Player Stats). Le FASCE dei punti concessi sono il pezzo che
    // mancava per dare a una difesa i punti della lega: Sleeper non manda i
    // punti concessi partita per partita, ma quante partite sono finite in
    // ogni fascia — che sono proprio le fasce del nostro regolamento.
    'pts_allow_0', 'pts_allow_1_6', 'pts_allow_7_13', 'pts_allow_14_20',
    'pts_allow_21_27', 'pts_allow_28_34', 'pts_allow_35p',
    'def_3_and_out', 'tkl_loss', 'qb_hit', 'ff', 'def_pass_def', 'blk_kick',
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

    // v6: aggiunto `raw` (stat grezze trimmate) — serve a decomposeSeason in
    // perf-explain.js per il pannello "Why" di Projections, stessi nomi-campo
    // di getSeasonProjections così i due lati (proiettato/reale) si confrontano
    // stat per stat senza rimappare nulla. Bumpare qui NON basta — la versione
    // va cambiata anche in FAMILIES.current dentro utils/storage.js, altrimenti
    // i blob v5 restano lì per sempre.
    // v7: le fasce dei punti concessi delle difese (KEPT_STATS). Senza cambiare
    // chiave, i blob v6 gia' salvati restavano senza per tutta la loro durata.
    const cacheKey = `topina_stats_v7_${year}`;
    const hit = cacheGet(cacheKey, stagioneInCorso(year) ? STATS_TTL_LIVE_MS : STATS_TTL_MS);
    if (hit) return (_memStats[year] = new Map(hit));

    const res = await fetch(urlFor('stats', year));
    if (!res.ok) throw new Error(`Sleeper stats ${res.status}`);
    const list = await res.json();

    const map = new Map();
    list.forEach(e => {
        const entry = voceStat(e);
        if (!entry) return;
        const key = `${normName(entry.name)}|${entry.pos}`;
        // omonimi: tieni chi ha giocato di più
        if (!map.has(key) || (entry.gp || 0) > (map.get(key).gp || 0)) map.set(key, entry);
    });

    await aggiungiGiornateInCorso(map, year, list);

    cacheSet(cacheKey, [...map.entries()].map(([k, e]) => [k, compact(e)]));
    return (_memStats[year] = map);
}

/** Una voce della mappa da una riga Sleeper (stagionale o di settimana). */
function voceStat(e) {
    const pl = e.player;
    const s = e.stats || {};
    // Fuori chi non ha statistiche, non chi ha fatto ZERO punti: Sleeper non
    // manda i campi che valgono zero, quindi una difesa a 0,0 (Miami 2026, week
    // 2: +4 dagli intercetti, -4 dai 35 punti concessi) arrivava senza
    // `pts_half_ppr` ne' `pts_std` e spariva, pur avendo giocato due partite.
    if (!pl || (s.pts_half_ppr == null && s.pts_std == null && !(s.gp > 0))) return null;
    const pos = (pl.position || '').toUpperCase();
    const name = `${pl.first_name} ${pl.last_name}`;
    return {
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
            // i TD a segno: servono alla "dipendenza dai TD", il segnale di
            // regressione più classico (i punti da touchdown rimbalzano verso
            // la media molto più di yard e ricezioni)
            rushTd: s.rush_td ?? null, recTd: s.rec_td ?? null,
            snaps: s.off_snp ?? null,
            fgm: s.fgm ?? null, xpm: s.xpm ?? null,
            sacks: s.sack ?? null, defInt: s.int ?? null,
        raw: trimStats(s),
    };
}

/**
 * La giornata che si sta giocando, sommata a mano al totale di stagione.
 *
 * Sleeper tiene DUE endpoint: il totale di stagione (`/stats/nfl/2026`) e il
 * tabellino di ogni giornata (`/stats/nfl/2026/2`). Il primo lo ricalcola solo
 * a giornata chiusa — il martedì — quindi dal giovedì al lunedì i punti del
 * fine settimana in corso non ci sono: Josh Allen aveva giocato da sei ore e
 * su Players si leggeva ancora la sola week 1. Il secondo invece è aggiornato
 * mentre si gioca.
 *
 * Quali giornate aggiungere: quelle OLTRE la copertura del totale, cioè oltre
 * il massimo di `gp` visto (chi le gioca tutte le ha giocate tutte). Si va
 * avanti finché una giornata ha tabellini, al massimo tre — se ne mancassero
 * di più il totale sarebbe rotto, e un ciclo lungo su un endpoint da 700 KB
 * non è il modo di scoprirlo. In più un controllo sulla data: se il totale è
 * stato toccato DOPO l'ultimo tabellino della giornata, quella giornata è già
 * dentro e non si somma (se no si conterebbe due volte il martedì).
 */
async function aggiungiGiornateInCorso(map, year, listaStagione) {
    if (!stagioneInCorso(year)) return;
    const copertura = Math.max(0, ...listaStagione.map(e => +(e.stats?.gp || 0)));
    const totaleAl = Math.max(0, ...listaStagione.map(e => +(e.last_modified || 0)));

    for (let w = copertura + 1; w <= copertura + 3; w++) {
        let lista;
        try {
            const res = await fetch(urlFor('stats', `${year}/${w}`));
            if (!res.ok) return;
            lista = await res.json();
        } catch { return; }

        const conStat = (lista || []).filter(e => (e.stats?.gp || 0) > 0);
        if (!conStat.length) return;                                   // giornata non ancora cominciata
        const giornataAl = Math.max(...conStat.map(e => +(e.last_modified || 0)));
        if (totaleAl >= giornataAl) return;                            // già dentro al totale

        for (const e of conStat) {
            const voce = voceStat(e);
            if (!voce) continue;
            const key = `${normName(voce.name)}|${voce.pos}`;
            const base = map.get(key);
            map.set(key, base ? sommaVoci(base, voce, w) : { ...voce, liveWeeks: [w] });
        }
    }
}

/** Campi che NON si sommano: sono classifiche, primati o medie. */
const NON_SOMMABILI = /(rank|lng|pct|rtg|adp|shard|_id)/;

/** Totale + giornata in corso: i conteggi si sommano, il resto resta com'era. */
function sommaVoci(base, add, week) {
    const out = { ...base, liveWeeks: [...(base.liveWeeks || []), week] };
    for (const k of ['ptsLeague', 'ptsHalf', 'ptsPpr', 'ptsStd', 'gp', 'gs', 'rec', 'tgt', 'recYd',
        'rzTgt', 'drops', 'rushAtt', 'rushYd', 'passAtt', 'passYd', 'passTd', 'rushTd', 'recTd',
        'snaps', 'fgm', 'xpm', 'sacks', 'defInt']) {
        if (base[k] == null && add[k] == null) continue;
        out[k] = (+base[k] || 0) + (+add[k] || 0);
    }
    out.raw = { ...(base.raw || {}) };
    for (const k in (add.raw || {})) {
        if (NON_SOMMABILI.test(k)) continue;
        const v = add.raw[k];
        if (typeof v !== 'number') continue;
        out.raw[k] = (+out.raw[k] || 0) + v;
    }
    out.team = add.team || base.team;   // se è stato scambiato, vale la squadra di oggi
    return out;
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
