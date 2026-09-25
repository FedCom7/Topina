/**
 * Player Stats — il deep dive sui numeri dei giocatori NFL.
 *
 * Tre blocchi, dal piu' leggibile al piu' fitto:
 *
 *  1. **Rate board** — le frequenze: ogni quanto segna, quante yard fa per
 *     snap, quanti punti farebbe in una partita intera in campo, quanto lo
 *     cercano quando c'e'. Sono le domande che un totale non sa fare: 900 yard
 *     in 1000 snap e 900 yard in 500 snap sono due giocatori diversi.
 *  2. **Big Board** — la tabella completa, ordinabile, con le colonne del
 *     ruolo. Un QB con le colonne dei ricevitori e' rumore, quindi ogni ruolo
 *     ha le sue.
 *  3. **Every team's…** — il QB1, RB1, WR1 e TE1 di tutte le 32 squadre, in
 *     fila: chi ha il miglior WR1 della lega, e quanto la squadra dipende da lui.
 *
 * Due fonti, agganciate per id Sleeper:
 *
 *  - **Sleeper** (`getSeasonStats`) — il box score: snap, tentativi, portate,
 *    target, red zone, TD, drop. E' LIVE: si aggiorna appena una partita finisce.
 *  - **nflverse** (`adv_players_{anno}.json`) — le metriche avanzate: EPA,
 *    CPOE, separazione, target share, WOPR, placcaggi rotti. Si rigenera nel
 *    giro completo del MARTEDI' (`build-nflverse.yml`), quindi a giornata in
 *    corso resta indietro di una settimana rispetto al box score. Le colonne
 *    che vengono da li' portano il segno † e la nota lo dice.
 *
 * I minuti. Il tempo di possesso non sta in nessuno dei nostri dati, quindi
 * "un TD ogni quanti minuti" non si puo' MISURARE. Si puo' ricavare: la media
 * di lega del tempo di possesso e' 30:00 per squadra per costruzione (i due
 * possessi di una partita sommano 60 minuti), e gli snap offensivi per partita
 * li abbiamo (`team_stats.offense.snapsPg`). Da li' i secondi di cronometro per
 * snap, e dagli snap per TD i minuti. E' una STIMA a media di lega — un attacco
 * lento consuma piu' cronometro per snap di uno veloce — quindi accanto c'e'
 * sempre il numero esatto, gli snap per TD, e la "i" spiega il conto.
 */

import { SEASONS_DESC, CURRENT_SEASON } from '../data.js?v=595';
import { getSeasonStats } from '../data/projections.js?v=631';
import { getAdvancedPlayers } from '../data/context-score.js?v=683';
import { getTeamStats } from '../data/nfl-team-stats.js?v=856';
import { teamLogoUrl } from '../data/player-search-core.js?v=623';
import { canonAbbr } from '../data/nfl-schedule.js?v=552';
import { pickDropdownHTML, bindPickDropdown } from '../ui/dropdown-pick.js?v=1';
import { sottoTitolo, apriInfo, registraInfo, headshotImg, hydrateImages } from './analysis.js?v=896';
import { LEAGUE_SCORING, scoreProjectedStats } from '../data/scoring.js?v=592';
import {
    tassiLega, tdAttesi, puntiAttesi, costanza, lineaTitolare, calendario, alberi, MISURE_ALBERO,
} from '../data/player-signals.js?v=3';

const RUOLI = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];

/** Kicker e difese non hanno snap offensivi: le misure per snap per loro non esistono. */
const SENZA_SNAP = new Set(['K', 'DEF']);

/*
 * RB e WR insieme: i due ruoli che si contendono il flex. Metterli nella stessa
 * classifica ha senso solo sulle misure che valgono per tutti e due — yard da
 * scrimmage, TD totali, tocchi — e non su quelle di un ruolo solo: "target per
 * snap" darebbe la vittoria ai WR per costruzione, "portate" ai RB.
 */
const COMBO = 'RB/WR';

/*
 * Tutti i ruoli insieme. La tabella regge — ogni riga porta il suo ruolo — ma
 * nelle carte delle frequenze un QB non si confronta con un ricevitore sui
 * TD e sulle yard: con i passaggi dentro, "un TD ogni…" e "yard per snap"
 * sarebbero otto quarterback su otto. Li' con All si conta solo lo SCRIMMAGE
 * (corse e ricezioni) per tutti, QB compresi; i punti fantasy invece restano
 * interi, perche' sono la moneta comune della lega.
 */
const TUTTI = 'ALL';
// RB/WR subito dopo i due ruoli che unisce, come nella tendina di Players
const FILTRI = [TUTTI, 'QB', 'RB', 'WR', COMBO, 'TE', 'K', 'DEF'];
const posDi = (f) => (f === TUTTI ? RUOLI : f === COMBO ? ['RB', 'WR'] : [f]);
const misto = (f) => f === TUTTI || f === COMBO;
const etichettaFiltro = (f) => (f === TUTTI ? 'All' : f);

/** Righe della Big Board prima del "Show all": una schermata abbondante. */
const RIGHE_VISIBILI = 40;

/**
 * Chi entra nelle classifiche. Un rapporto su pochi snap non e' un'abitudine,
 * e' un caso: il riserva che entra per tre azioni e segna fa "un TD ogni tre
 * snap" e scavalca tutta la lega. La soglia e' relativa — un quarto degli snap
 * del piu' usato del ruolo — cosi' vale uguale alla week 2 e a fine stagione.
 */
const QUOTA_QUALIFICA = 0.25;

/** Se `team_stats` manca: gli snap offensivi di una squadra NFL in una partita tipo. */
const SNAP_PER_PARTITA_DEFAULT = 63;

let initialized = false;
let anno = CURRENT_SEASON;
let ruolo = TUTTI;   // si apre su tutti i ruoli insieme
let ordine = { key: 'fp', dir: -1 };
let tutte = false;
let soloQualificati = true;
// Il blocco delle squadre vuole un ruolo solo (un "All1" di squadra non
// esiste): parte dal WR finche' in cima non se ne sceglie uno.
let ruoloSquadre = 'WR';
let stato = null;   // { righe, secPerSnap, snapsPg, maxGp, tassi, team, teamPrec }

// La pagina e' a schede: con sei analisi in piu' una colonna sola non si
// finiva piu' di scorrere. Il filtro del ruolo vale per tutte.
let vista = 'overview';        // 'overview' | 'signals' | 'consistency' | 'teams'
let ordineCostanza = 'media';  // 'media' | 'floor' | 'ceiling' | 'starts'
let finestra = 'rest';         // calendario: 'rest' | 'next4'

registraInfo({
    'ps-rate-td': {
        cosa: 'How often a player finds the end zone, measured on the time he actually spends on the field.',
        base: 'Qualified players only: at least a quarter of the snaps of the most-used player at the position. QBs count passing and rushing touchdowns.',
        regola: 'The exact number is snaps per touchdown. The minutes are an estimate: across the league a team holds the ball 30:00 per game by definition, so the game clock per offensive snap is 30 minutes divided by the league’s offensive snaps per game — about half a minute. A fast offense burns less clock per snap than a slow one, which is why the snaps are always shown next to the minutes.',
    },
    'ps-rate-yds': {
        cosa: 'Yards produced for every snap on the field — the purest efficiency number there is.',
        base: 'Scrimmage yards (rushing + receiving; for QBs passing + rushing), qualified players only.',
        regola: 'A player who runs 900 yards in 500 snaps and one who needs 1,000 snaps for the same 900 are not the same player: the totals hide it, this does not.',
    },
    'ps-rate-fp': {
        cosa: 'The fantasy points a player would score in a full game on the field.',
        base: 'League scoring, qualified players only.',
        regola: 'Points per snap, scaled to 60 snaps — roughly one whole game of offense. It separates the talent from the playing time: a backup with a big number here is a player waiting for a bigger role.',
    },
    'ps-rate-inv': {
        cosa: 'How much the offense runs through him when he is out there.',
        base: 'Qualified players only.',
        regola: 'RBs: carries plus targets for every 100 snaps. WRs and TEs: targets for every 100 snaps — how often he is the answer on the play. QBs: air yards per attempt, how far downfield he throws (aDOT).',
    },
    'ps-board': {
        cosa: 'Every number we have for every player at the position. Click a column to sort; click again to flip.',
        base: 'Box score from Sleeper, live — it updates as soon as a game ends. Columns marked † come from nflverse and update every Tuesday, so during a week they lag one game behind.',
        regola: 'Gold marks the best value in each column among the players shown; for turnovers, drops, sacks taken and points allowed the best is the lowest. "Qualified only" hides whoever played less than a quarter of the snaps of the busiest player at the position; kickers and defenses have no offensive snaps, so for them it is half the games of the most present.',
    },
    'ps-k-acc': {
        cosa: 'Field goals made out of field goals tried.',
        base: 'Kickers who played at least half the games of the busiest one, with at least half his attempts.',
        regola: 'Without a minimum of attempts two kicks out of two would be 100% and top the list.',
    },
    'ps-k-50': {
        cosa: 'Field goals made from 50 yards or more — the ones worth 5 points in this league instead of 3.',
        base: 'Qualified kickers.',
        regola: 'Range is a kicker\u2019s real edge in our scoring: every make from 50+ is two free points.',
    },
    'ps-k-fp': {
        cosa: 'League fantasy points per game played.',
        base: 'Qualified kickers.',
        regola: 'Field goals (3, or 5 from 50+) and extra points (1), per the league rules. Checked against the league\u2019s own numbers on the 2025 season: 57 kicker-weeks out of 57 identical.',
    },
    'ps-k-vol': {
        cosa: 'Field goals attempted per game: how many chances the offense gives him.',
        base: 'Qualified kickers.',
        regola: 'Kickers score on opportunity more than on talent: an offense that stalls in range sends him out often, one that scores touchdowns leaves him the extra points. The longest make is not on this page on purpose — Sleeper\u2019s season line adds up each week\u2019s longest kick instead of keeping the best one.',
    },
    'ps-def-pa': {
        cosa: 'Points the defense gave up, per game.',
        base: 'All 32 defenses that played at least half the games of the others.',
        regola: 'Per game, not in total: teams on a bye have played one game fewer. Every point allowed here counts, special teams and turnovers returned by the offense included — it is the number the league\u2019s points-allowed tiers are built on.',
    },
    'ps-def-to': {
        cosa: 'Interceptions plus fumbles recovered, per game.',
        base: 'Qualified defenses.',
        regola: 'Takeaways are worth 2 points each in the league, and they are the swingiest part of a defense\u2019s score.',
    },
    'ps-def-sk': {
        cosa: 'Sacks per game — the steadiest source of defensive points, one each.',
        base: 'Qualified defenses.',
        regola: 'Pressure travels from week to week much better than takeaways do: a defense high here is a safer start.',
    },
    'ps-def-fp': {
        cosa: 'League fantasy points per game.',
        base: 'Qualified defenses.',
        regola: 'Computed with the league rules: sacks, takeaways, touchdowns and safeties, plus the points-allowed tiers. Sleeper does not give points allowed game by game, but it does count how many games ended in each tier — and its tiers are exactly ours. Checked on the 2025 season against the league\u2019s own numbers: 55 defense-weeks out of 58 identical; the other 3 are 2 points short, a play the league counts and Sleeper does not record.',
    },
    'ps-depth': {
        cosa: 'The number one at a position on every NFL team, lined up against each other.',
        base: 'The "1" is the role, not the result: the QB with the most pass attempts, the RB with the most carries plus targets, the WR and TE with the most targets, the kicker with the most kicks. The defense is one per team.',
        regola: 'Ranked by fantasy points per game. The share next to the name is how much of the team’s volume he takes — targets for WRs and TEs, carries for RBs: a high share means the offense leans on him, for better or worse. The thin line on each bar is the average of the 32.',
    },
});

export function initPlayerStats() {
    if (initialized) return;
    initialized = true;
    renderPickRow();
    bindContent();
    load();
}

/* ============================================================
   DATI
   ============================================================ */

const num = (v) => (v == null || Number.isNaN(Number(v)) ? null : Number(v));

/*
 * Sleeper NON manda le statistiche a zero: chi non ha lanciato intercetti non
 * ha `pass_int: 0`, non ha proprio la chiave. Leggerla come "dato mancante"
 * sbagliava due cose — l'oro degli intercetti andava a chi ne aveva UNO mentre
 * Josh Allen, con zero, restava una casella vuota fuori dalla gara; e le righe
 * delle squadre dicevano "11 tgt · TD" senza il numero. Per chi ha giocato, un
 * conteggio assente e' 0. Le metriche avanzate no: li' un buco e' un buco.
 */
const conta = (v) => num(v) ?? 0;

/*
 * I punti di lega di una difesa.
 *
 * Il pezzo difficile sono i punti concessi, che il regolamento paga a fasce
 * PARTITA PER PARTITA: il totale di stagione non basta a ricostruirli. Sleeper
 * pero' nella riga stagionale dice quante partite sono finite in ogni fascia
 * (`pts_allow_1_6`, `pts_allow_21_27`…), e le sue fasce sono esattamente le
 * nostre. Quindi: partite nella fascia × punti della fascia, piu' sack,
 * intercetti, fumble recuperati, TD, safety.
 *
 * Validato settimana per settimana sulle difese in rosa nel 2025: 55 su 58
 * uguali al centesimo ai punti ufficiali della lega. Le altre tre sono tutte
 * 2 punti SOTTO — un'azione che la lega conta e Sleeper non registra — quindi
 * il numero puo' solo sottostimare, e di poco.
 */
const FASCE_SLEEPER = ['pts_allow_0', 'pts_allow_1_6', 'pts_allow_7_13', 'pts_allow_14_20',
    'pts_allow_21_27', 'pts_allow_28_34', 'pts_allow_35p'];

function puntiDifesa(r) {
    const S = LEAGUE_SCORING;
    // Le fasce del regolamento, nello stesso ordine di quelle di Sleeper. Se un
    // giorno il regolamento ne cambiasse il numero, l'abbinamento salterebbe:
    // meglio nessun numero che uno sbagliato.
    const fasce = S.def_pts_allowed_tiers || [];
    if (fasce.length !== FASCE_SLEEPER.length) return null;
    let p = FASCE_SLEEPER.reduce((acc, k, i) => acc + conta(r[k]) * fasce[i][1], 0);
    p += conta(r.sack) * S.sack + conta(r.int) * S.def_int + conta(r.fum_rec) * S.fum_rec
        + conta(r.def_td) * S.def_td + conta(r.def_st_td) * S.def_ret_td
        + conta(r.safe) * S.safety + conta(r.def_2pt) * S.def_two_pt_ret;
    return +p.toFixed(1);
}
const div = (a, b) => (a != null && b ? a / b : null);
const somma = (...v) => (v.some(x => x != null) ? v.reduce((s, x) => s + (x || 0), 0) : null);

/** Una riga per giocatore: box score di Sleeper + avanzate nflverse + le derivate. */
function riga(e, adv, togli = null) {
    const r = e.raw || {};
    const pos = e.pos;
    // Kicker e difese: nessuna misura per snap. Un kicker puo' avere uno snap
    // offensivo (una finta di field goal), e con quello solo "punti per 60
    // snap" diventava 1020 — Ryan Fitzgerald 2026, 17 punti su 1 snap — e nel
    // filtro All finiva in cima a tutte le carte delle frequenze.
    const snaps = SENZA_SNAP.has(pos) ? null : num(e.snaps ?? r.off_snp);
    const tmSnaps = num(r.tm_off_snp);
    const gp = num(e.gp) || 0;

    const passAtt = conta(e.passAtt ?? r.pass_att), passCmp = conta(r.pass_cmp);
    const passYd = conta(e.passYd ?? r.pass_yd), passTd = conta(e.passTd ?? r.pass_td);
    const passInt = conta(r.pass_int), passSack = conta(r.pass_sack);
    const rushAtt = conta(e.rushAtt ?? r.rush_att), rushYd = conta(e.rushYd ?? r.rush_yd);
    const rushTd = conta(e.rushTd ?? r.rush_td);
    const tgt = conta(e.tgt ?? r.rec_tgt), rec = conta(e.rec ?? r.rec);
    const recYd = conta(e.recYd ?? r.rec_yd), recTd = conta(e.recTd ?? r.rec_td);
    const recAirYd = conta(r.rec_air_yd), passAirYd = conta(r.pass_air_yd);

    const td = pos === 'QB' ? somma(passTd, rushTd) : somma(rushTd, recTd);
    const yds = pos === 'QB' ? somma(passYd, rushYd) : somma(rushYd, recYd);
    const fp = pos === 'DEF' ? puntiDifesa(r) : num(e.ptsLeague);

    // Numeratore e denominatore dalle STESSE partite. Gli snap di una partita
    // escono il giorno dopo, le statistiche subito: il venerdi' mattina la riga
    // stagionale di chi ha giocato il giovedi' ha la produzione di tre partite
    // e gli snap di due. Bijan Robinson 2026 faceva cosi' 101 tocchi ogni 100
    // snap. `togli` e' la produzione di quelle partite (partiteSenzaSnap): le
    // misure PER SNAP la lasciano fuori finche' gli snap non arrivano; i
    // conteggi della tabella restano interi.
    const t = togli || {};
    const q = (v, k) => v - conta(t[k]);
    const sRushAtt = q(rushAtt, 'rush_att'), sTgt = q(tgt, 'rec_tgt');
    const sRushTd = q(rushTd, 'rush_td'), sRecTd = q(recTd, 'rec_td'), sPassTd = q(passTd, 'pass_td');
    const sRushYd = q(rushYd, 'rush_yd'), sRecYd = q(recYd, 'rec_yd'), sPassYd = q(passYd, 'pass_yd');
    const sTd = pos === 'QB' ? sPassTd + sRushTd : sRushTd + sRecTd;
    const sYds = pos === 'QB' ? sPassYd + sRushYd : sRushYd + sRecYd;
    const sFp = fp == null ? null : fp - (togli ? (scoreProjectedStats(togli) || 0) : 0);

    // kicker e difese: i loro conteggi, e le medie a partita
    const fgm = conta(r.fgm ?? e.fgm), fga = conta(r.fga), xpm = conta(r.xpm ?? e.xpm), xpa = conta(r.xpa);
    const sacks = conta(r.sack), defInt = conta(r.int), fumRec = conta(r.fum_rec);

    // Quanto lo cerca l'attacco quando e' in campo: per i ricevitori i target,
    // per i RB portate + target. Per i QB e' ~1 per tutti (ogni snap passa da
    // lui) e non distinguerebbe nessuno: al suo posto la profondita' dei lanci.
    const coinvolto = pos === 'QB' ? div(passAirYd, passAtt)
        : pos === 'RB' ? div(sRushAtt + sTgt, snaps)
            : div(sTgt, snaps);

    return {
        name: e.name, pos, team: canonAbbr(e.team || ''), playerId: e.playerId,
        gp, snaps, snapPct: div(snaps, tmSnaps) ?? num(adv?.snapPct),
        fp, fpg: div(fp, gp),
        passCmp, passAtt, cmpPct: div(passCmp, passAtt), passYd, ypa: div(passYd, passAtt),
        passTd, passInt, passSack, passRzAtt: conta(r.pass_rz_att), adotPass: div(passAirYd, passAtt),
        rushAtt, rushYd, ypc: div(rushYd, rushAtt), rushTd, rushRzAtt: conta(r.rush_rz_att),
        rushYac: conta(r.rush_yac),
        tgt, rec, catchPct: div(rec, tgt), recYd, ypt: div(recYd, tgt), recTd,
        rzTgt: conta(e.rzTgt ?? r.rec_rz_tgt), recAirYd, adot: div(recAirYd, tgt),
        recYac: conta(r.rec_yar), drops: conta(e.drops ?? r.rec_drop), fumLost: conta(r.fum_lost),
        // avanzate (†)
        epaPg: num(adv?.epaPerGame), cpoe: num(adv?.cpoe), ttt: num(adv?.timeToThrow),
        aggr: num(adv?.aggressiveness), pressPct: num(adv?.qbPressuredPct),
        tgtShare: num(adv?.targetShare), ayShare: num(adv?.airYardsShare), wopr: num(adv?.wopr),
        sep: num(adv?.sep), rushShare: num(adv?.rushShare),
        // oltre l'atteso (NextGen, via nflverse) e i punti partita per partita
        yacOE: num(adv?.yacOE), ryoe: num(adv?.ryoePerAtt),
        rushBrokenTk: num(adv?.rushBrokenTk),
        settimane: Array.isArray(adv?.weekly) ? adv.weekly : null,
        brokenTk: num(pos === 'RB' ? adv?.rushBrokenTk : adv?.recBrokenTk),
        // derivate delle frequenze
        td, yds,
        snapsPerTd: sTd ? div(snaps, sTd) : null,
        ydsPerSnap: div(sYds, snaps),
        ydsBase: sYds,
        fpPer60: sFp != null && snaps ? (sFp / snaps) * 60 : null,
        coinvolto,
        snapInRitardo: !!togli,
        // portate + target per snap, per tutti: l'unica misura di coinvolgimento
        // che mette un RB e un WR sulla stessa scala
        tocchi: div(sRushAtt + sTgt, snaps),
        // kicker
        // Niente calcio piu' lungo: nella riga STAGIONALE di Sleeper `fgm_lng`
        // e' la somma dei piu' lunghi di ogni settimana (Reichard 2025: 755
        // yard), e il massimo vero da li' non si ricava.
        fgm, fga, fgPct: div(fgm, fga), fgaPg: div(fga, gp), fg50: conta(r.fgm_50p),
        xpm, xpa, xpPct: div(xpm, xpa),
        // difesa
        ptsAllowPg: pos === 'DEF' ? div(num(r.pts_allow) ?? 0, gp) : null,
        ydsAllowPg: pos === 'DEF' ? div(num(r.yds_allow) ?? 0, gp) : null,
        sacks, defInt, fumRec, takeaways: defInt + fumRec,
        sacksPg: div(sacks, gp), takeawaysPg: div(defInt + fumRec, gp),
        defTd: conta(r.def_td) + conta(r.def_st_td), safeties: conta(r.safe),
        threeOut: conta(r.def_3_and_out), tfl: conta(r.tkl_loss), qbHit: conta(r.qb_hit),
        passDef: conta(r.def_pass_def),
        // lo scrimmage (corse + ricezioni) anche per i QB: e' il terreno comune
        // quando nella stessa carta ci sono tutti i ruoli
        snapsPerTdScrim: (sRushTd + sRecTd) ? div(snaps, sRushTd + sRecTd) : null,
        ydsScrim: somma(rushYd, recYd),
        ydsScrimBase: sRushYd + sRecYd,
        ydsScrimPerSnap: div(sRushYd + sRecYd, snaps),
    };
}

/**
 * Le partite gia' giocate di cui gli snap non sono ancora pubblicati.
 *
 * Solo sulla stagione in corso, e solo nell'ultima settimana e in quella prima:
 * gli snap arrivano con un giorno di ritardo, quindi il buco sta sempre li'.
 * Si riconoscono cosi': la partita ha produzione (portate, target, lanci) ma
 * nessuno snap offensivo — un ricevitore con dei target in campo c'era per
 * forza. Ritorna Map(id Sleeper → somma delle statistiche di quelle partite).
 */
async function partiteSenzaSnap(anno) {
    const out = new Map();
    if (String(anno) !== String(CURRENT_SEASON)) return out;
    let settimana;
    try {
        const st = await (await fetch('https://api.sleeper.app/v1/state/nfl')).json();
        if (String(st?.season) !== String(anno)) return out;
        settimana = Number(st.week) || 0;
    } catch { return out; }

    const ruoli = ['QB', 'RB', 'WR', 'TE'].map(p => `position%5B%5D=${p}`).join('&');
    const liste = await Promise.all([settimana - 1, settimana].filter(w => w >= 1).map(w =>
        fetch(`https://api.sleeper.com/stats/nfl/${anno}/${w}?season_type=regular&${ruoli}`)
            .then(res => (res.ok ? res.json() : []))
            .catch(() => [])));
    for (const lista of liste) {
        for (const e of lista || []) {
            const st = e.stats || {};
            const produzione = (st.rush_att || 0) + (st.rec_tgt || 0) + (st.pass_att || 0);
            if (!(st.gp > 0) || !produzione || st.off_snp != null) continue;
            const id = String(e.player_id ?? e.player?.player_id ?? '');
            if (!id) continue;
            const somma = out.get(id) || {};
            for (const [k, v] of Object.entries(st)) if (typeof v === 'number') somma[k] = (somma[k] || 0) + v;
            out.set(id, somma);
        }
    }
    return out;
}

async function carica(y) {
    // La stagione prima serve a due cose: i tassi di lega (a settembre quelli
    // della sola stagione in corso ballano) e i punti concessi delle difese,
    // che con due partite giocate dicono ancora poco.
    const prec = String(Number(y) - 1);
    const cePrec = SEASONS_DESC.map(String).includes(prec);
    const [stats, adv, team, statsPrec, teamPrec, senzaSnap] = await Promise.all([
        getSeasonStats(y).catch(() => null),
        getAdvancedPlayers(y).catch(() => []),
        getTeamStats(y).catch(() => null),
        cePrec ? getSeasonStats(prec).catch(() => null) : null,
        cePrec ? getTeamStats(prec).catch(() => null) : null,
        partiteSenzaSnap(y).catch(() => new Map()),
    ]);
    if (!stats) return null;

    const advPerId = new Map((adv || []).map(a => [String(a.sleeper), a]));
    const righe = [];
    for (const e of stats.values()) {
        if (!RUOLI.includes(e.pos)) continue;
        if (!(e.gp > 0)) continue;
        righe.push(riga(e, advPerId.get(String(e.playerId)) || null, senzaSnap.get(String(e.playerId)) || null));
    }

    const snapsPg = Object.values(team?.teams || {})
        .map(t => t.offense?.snapsPg).filter(v => v > 0);
    const media = snapsPg.length
        ? snapsPg.reduce((a, b) => a + b, 0) / snapsPg.length
        : SNAP_PER_PARTITA_DEFAULT;

    // I segnali di ogni riga, calcolati una volta sola: cambiare scheda o
    // filtro ridisegna e basta.
    const tassi = tassiLega([stats, statsPrec]);
    for (const r of righe) {
        r.tdR = tdAttesi(r, tassi);                // col ruolo: il QB con i passaggi
        r.tdScrim = tdAttesi(r, tassi, false);     // per All: solo corse e ricezioni
        r.xfp = puntiAttesi(r, tassi);
        r.c = costanza(r.settimane);
    }

    return {
        righe,
        snapsPg: media,
        secPerSnap: 1800 / media,
        maxGp: Math.max(0, ...righe.map(r => r.gp)),
        tassi, team, teamPrec,
        conPrec: !!statsPrec,
        snapInRitardo: righe.filter(r => r.snapInRitardo).length,
    };
}

/** Chi ha abbastanza snap perche' un suo rapporto voglia dire qualcosa. */
function qualificati(filtro) {
    // Ogni ruolo contro il SUO piu' usato: col filtro RB/WR un RB titolare fa
    // meno snap di un WR titolare, e una soglia unica taglierebbe fuori i RB.
    return posDi(filtro).flatMap(pos => {
        // Kicker e difese non hanno snap offensivi: per loro conta aver giocato
        // almeno meta' delle partite del piu' presente. Fuori il kicker di una
        // settimana sola, preso per coprire un infortunio.
        if (SENZA_SNAP.has(pos)) {
            const del = stato.righe.filter(r => r.pos === pos);
            const max = Math.max(0, ...del.map(r => r.gp));
            return del.filter(r => r.gp >= max * 0.5);
        }
        const del = stato.righe.filter(r => r.pos === pos && r.snaps);
        const max = Math.max(0, ...del.map(r => r.snaps));
        return del.filter(r => r.snaps >= max * QUOTA_QUALIFICA);
    });
}

/* ============================================================
   FORMATI
   ============================================================ */

const escAttr = (v) => String(v ?? '').replace(/[&<>"]/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const intero = (v) => (v == null ? '' : Math.round(v).toLocaleString('en-US'));
const uno = (v) => (v == null ? '' : v.toFixed(1));
const due = (v) => (v == null ? '' : v.toFixed(2));
const perc = (v) => (v == null ? '' : `${Math.round(v * 100)}%`);

const linkGiocatore = (r) =>
    `#player/${anno}/${encodeURIComponent(r.pos)}/${encodeURIComponent(r.name)}`;

const logo = (abbr) => (abbr
    ? `<img class="ps-logo" src="${teamLogoUrl(abbr)}" alt="" loading="lazy" onerror="this.style.display='none'">`
    : '');

/* ============================================================
   1. RATE BOARD
   ============================================================ */

const minuti = (snaps) => (snaps == null ? null : (snaps * stato.secPerSnap) / 60);

function carteFrequenze() {
    const q = qualificati(ruolo);
    if (ruolo === 'K') return carteKicker(q);
    if (ruolo === 'DEF') return carteDifesa(q);
    const top = (lista, chiave, verso = -1) => [...lista]
        .filter(r => r[chiave] != null)
        .sort((a, b) => verso * (a[chiave] - b[chiave]) || (b.snaps - a.snaps))
        .slice(0, 8);

    const tutti = ruolo === TUTTI;
    const chiaveTd = tutti ? 'snapsPerTdScrim' : 'snapsPerTd';
    const chiaveYds = tutti ? 'ydsScrimPerSnap' : 'ydsPerSnap';
    const td = top(q.filter(r => r[chiaveTd] != null), chiaveTd, 1);
    const yds = top(q, chiaveYds);
    const fp = top(q, 'fpPer60');
    const chiaveInv = misto(ruolo) ? 'tocchi' : 'coinvolto';
    const inv = top(q, chiaveInv);

    // Per 100 snap e non per snap: a due decimali i ricevitori leggevano tutti
    // "0.17" e la classifica sembrava un pareggio a otto.
    const titoloInv = ruolo === 'QB' ? 'How deep he throws'
        : (ruolo === 'RB' || misto(ruolo)) ? 'Touches per 100 snaps' : 'Targets per 100 snaps';
    const fmtInv = ruolo === 'QB' ? (v) => `${uno(v)} yds` : (v) => uno(v * 100);

    return `
    <div class="ps-rate-grid">
        ${carta('ps-rate-td', 'A touchdown every…', td, chiaveTd, r => {
            const m = minuti(r[chiaveTd]);
            return `<b>≈ ${Math.round(m)} min</b><small>every ${Math.round(r[chiaveTd])} snaps</small>`;
        }, 'Nobody at this position has scored yet.', true)}
        ${carta('ps-rate-yds', tutti ? 'Scrimmage yards per snap' : 'Yards per snap', yds, chiaveYds,
            r => `<b>${due(r[chiaveYds])}</b><small>${intero(tutti ? r.ydsScrimBase : r.ydsBase)} yds</small>`)}
        ${carta('ps-rate-fp', 'Points per full game on the field', fp, 'fpPer60', r => `<b>${uno(r.fpPer60)}</b><small>per 60 snaps</small>`)}
        ${carta('ps-rate-inv', titoloInv, inv, chiaveInv, r => `<b>${fmtInv(r[chiaveInv])}</b><small>${ruolo === 'QB' ? 'air yds / att' : `${intero(r.snaps)} snaps`}</small>`)}
    </div>
    ${tutti ? `<p class="an-footnote">All positions: touchdowns and yards here are from scrimmage — runs and catches —
       for everyone, QBs included. With passing in, every list would be eight quarterbacks. Fantasy points stay whole:
       they are the one currency every position shares.</p>` : ''}`;
}

/** In ordine, tolti i nulli: le prime otto. `verso` +1 = vince il piu' basso. */
function primi(lista, chiave, verso = -1) {
    return [...lista]
        .filter(r => r[chiave] != null)
        .sort((a, b) => verso * (a[chiave] - b[chiave]) || (b.gp - a.gp))
        .slice(0, 8);
}

/**
 * Kicker: precisione, gittata, punti. La precisione vuole un minimo di
 * tentativi — con due calci su due si e' al 100% e non vuol dire niente — e
 * il minimo e' meta' dei tentativi del piu' usato, come per gli snap.
 */
function carteKicker(q) {
    const maxFga = Math.max(0, ...q.map(r => r.fga));
    const precisi = primi(q.filter(r => r.fga >= Math.max(2, maxFga * 0.5)), 'fgPct');
    return `
    <div class="ps-rate-grid">
        ${carta('ps-k-acc', 'Most accurate', precisi, 'fgPct', r => `<b>${perc(r.fgPct)}</b><small>${r.fgm}/${r.fga} FG</small>`)}
        ${carta('ps-k-50', 'From 50+', primi(q.filter(r => r.fg50 > 0), 'fg50'), 'fg50',
            r => `<b>${r.fg50}</b><small>${r.fgm}/${r.fga} FG</small>`, 'Nobody has made one from 50+ yet.')}
        ${carta('ps-k-fp', 'Points per game', primi(q, 'fpg'), 'fpg', r => `<b>${uno(r.fpg)}</b><small>${uno(r.fp)} pts</small>`)}
        ${carta('ps-k-vol', 'Chances per game', primi(q, 'fgaPg'), 'fgaPg', r => `<b>${uno(r.fgaPg)}</b><small>${r.fga} FG tried</small>`)}
    </div>`;
}

/**
 * Difese: quanto concedono, quanto rubano, quanto arrivano sul QB, e i punti.
 * Tutto a partita — le squadre hanno giocato un numero diverso di partite
 * (bye), e i totali premierebbero chi ne ha giocata una in piu'.
 */
function carteDifesa(q) {
    return `
    <div class="ps-rate-grid">
        ${carta('ps-def-pa', 'Fewest points allowed', primi(q, 'ptsAllowPg', 1), 'ptsAllowPg',
            r => `<b>${uno(r.ptsAllowPg)}</b><small>per game</small>`, 'No games yet.', true)}
        ${carta('ps-def-to', 'Takeaways per game', primi(q, 'takeawaysPg'), 'takeawaysPg',
            r => `<b>${uno(r.takeawaysPg)}</b><small>${r.defInt} INT · ${r.fumRec} fum</small>`)}
        ${carta('ps-def-sk', 'Sacks per game', primi(q, 'sacksPg'), 'sacksPg', r => `<b>${uno(r.sacksPg)}</b><small>${r.sacks} sacks</small>`)}
        ${carta('ps-def-fp', 'Fantasy points per game', primi(q, 'fpg'), 'fpg', r => `<b>${uno(r.fpg)}</b><small>${uno(r.fp)} pts</small>`)}
    </div>`;
}

/**
 * Una carta: otto righe, e una barra per riga che si legge contro la prima.
 * `inverso`: nella carta dei TD vince il numero PIU' BASSO, quindi la barra
 * piena va al primo e si accorcia scendendo — se no il migliore avrebbe la
 * barra piu' corta di tutte.
 */
function carta(id, titolo, righe, chiave, valore, vuoto = 'No qualified players yet.', inverso = false, tono = '') {
    // `chiave` puo' essere il nome di un campo o una funzione (per i segnali,
    // dove il numero sta dentro un oggetto); `tono`: 'buy' fa le barre verdi.
    const misura = typeof chiave === 'function' ? chiave : (r) => r[chiave];
    const classe = `ps-rate-card${tono ? ` ps-rate-card--${tono}` : ''}`;
    if (!righe.length) {
        return `<div class="${classe}">${sottoTitolo(id, titolo)}<p class="an-footnote">${vuoto}</p></div>`;
    }
    const valori = righe.map(misura);
    const lung = (v) => {
        const l = inverso ? (Math.min(...valori) / v) * 100 : (v / Math.max(...valori)) * 100;
        return Number.isFinite(l) ? Math.max(0, Math.min(100, l)) : 0;
    };
    return `
    <div class="${classe}">
        ${sottoTitolo(id, titolo)}
        <ol class="ps-rate-list">
            ${righe.map((r, i) => `
            <li class="ps-rate-row">
                <span class="ps-rate-n">${i + 1}</span>
                <span class="ps-rate-who">
                    <a href="${linkGiocatore(r)}">${escAttr(r.name)}</a>
                    <span class="ps-rate-team">${logo(r.team)}${escAttr(r.team)}${misto(ruolo) ? ` · ${r.pos}` : ''}</span>
                </span>
                <span class="ps-rate-val">${valore(r)}</span>
                <span class="ps-rate-bar" aria-hidden="true"><i style="width:${lung(misura(r)).toFixed(1)}%"></i></span>
            </li>`).join('')}
        </ol>
    </div>`;
}

/* ============================================================
   2. BIG BOARD
   ============================================================ */

/*
 * Le colonne di ogni ruolo. `meglio`: +1 vince il piu' alto, -1 il piu' basso
 * (palle perse, drop, sack), 0 nessun oro — il tempo per lanciare, per dire,
 * non e' ne' buono ne' cattivo. `adv`: viene da nflverse, porta la †.
 */
const C = (key, label, fmt, meglio = 1, extra = {}) => ({ key, label, fmt, meglio, ...extra });

const COMUNI = [
    C('gp', 'G', intero, 0),
    C('snaps', 'Snaps', intero),
    C('snapPct', 'Snap%', perc),
    C('fp', 'FPts', uno),
    C('fpg', 'FPts/G', uno),
];

const COLONNE = {
    QB: [
        ...COMUNI,
        C('passCmp', 'Cmp', intero), C('passAtt', 'Att', intero), C('cmpPct', 'Cmp%', perc),
        C('passYd', 'Pass Yds', intero), C('ypa', 'Y/A', uno), C('passTd', 'Pass TD', intero),
        C('passInt', 'INT', intero, -1), C('passSack', 'Sacked', intero, -1),
        C('passRzAtt', 'RZ Att', intero), C('adotPass', 'aDOT', uno, 0),
        C('rushAtt', 'Rush Att', intero), C('rushYd', 'Rush Yds', intero), C('rushTd', 'Rush TD', intero),
        C('fumLost', 'Fum', intero, -1),
        C('cpoe', 'CPOE', uno, 1, { adv: true }), C('ttt', 'Time to throw', due, 0, { adv: true }),
        C('aggr', 'Aggressive%', uno, 0, { adv: true }), C('pressPct', 'Pressured%', perc, -1, { adv: true }),
        C('epaPg', 'EPA/G', uno, 1, { adv: true }),
    ],
    RB: [
        ...COMUNI,
        C('rushAtt', 'Carries', intero), C('rushYd', 'Rush Yds', intero), C('ypc', 'YPC', uno),
        C('rushTd', 'Rush TD', intero), C('rushRzAtt', 'RZ Carries', intero), C('rushYac', 'Yds after contact', intero),
        C('tgt', 'Tgt', intero), C('rec', 'Rec', intero), C('recYd', 'Rec Yds', intero), C('recTd', 'Rec TD', intero),
        C('fumLost', 'Fum', intero, -1),
        C('rushShare', 'Rush share', perc, 1, { adv: true }), C('tgtShare', 'Tgt share', perc, 1, { adv: true }),
        C('brokenTk', 'Broken tkl', intero, 1, { adv: true }), C('epaPg', 'EPA/G', uno, 1, { adv: true }),
    ],
    WR: null,   // uguale al TE, sotto
    TE: null,
};
COLONNE.WR = COLONNE.TE = [
    ...COMUNI,
    C('tgt', 'Tgt', intero), C('rec', 'Rec', intero), C('catchPct', 'Catch%', perc),
    C('recYd', 'Rec Yds', intero), C('ypt', 'Y/Tgt', uno), C('recTd', 'Rec TD', intero),
    C('rzTgt', 'RZ Tgt', intero), C('recAirYd', 'Air Yds', intero), C('adot', 'aDOT', uno, 0),
    C('recYac', 'YAC', intero), C('drops', 'Drops', intero, -1),
    C('tgtShare', 'Tgt share', perc, 1, { adv: true }), C('ayShare', 'Air yds share', perc, 1, { adv: true }),
    C('wopr', 'WOPR', due, 1, { adv: true }), C('sep', 'Separation', uno, 1, { adv: true }),
    C('epaPg', 'EPA/G', uno, 1, { adv: true }),
];

/*
 * RB/WR: solo le colonne che hanno senso per tutti e due. Le yard da scrimmage
 * e i TD totali vengono prima, perche' sono il terreno comune; poi corsa e
 * ricezione per chi vuole vedere DA DOVE arrivano.
 */
COLONNE[COMBO] = [
    ...COMUNI,
    C('yds', 'Scrim Yds', intero), C('td', 'Total TD', intero), C('tocchi', 'Touch/snap', due),
    C('rushAtt', 'Carries', intero), C('rushYd', 'Rush Yds', intero), C('ypc', 'YPC', uno), C('rushTd', 'Rush TD', intero),
    C('tgt', 'Tgt', intero), C('rec', 'Rec', intero), C('recYd', 'Rec Yds', intero), C('recTd', 'Rec TD', intero),
    C('catchPct', 'Catch%', perc), C('rzTgt', 'RZ Tgt', intero), C('fumLost', 'Fum', intero, -1),
    C('tgtShare', 'Tgt share', perc, 1, { adv: true }), C('epaPg', 'EPA/G', uno, 1, { adv: true }),
];

/*
 * All: le colonne dei tre mestieri — lancio, corsa, ricezione — una volta sola,
 * senza le rifiniture di un ruolo (CPOE, separazione, aDOT) che per gli altri
 * sarebbero caselle vuote. I TD restano separati per tipo: sommare quelli
 * lanciati a quelli segnati mischierebbe due cose diverse.
 */
COLONNE[TUTTI] = [
    ...COMUNI,
    C('passYd', 'Pass Yds', intero), C('passTd', 'Pass TD', intero), C('passInt', 'INT', intero, -1),
    C('rushAtt', 'Carries', intero), C('rushYd', 'Rush Yds', intero), C('rushTd', 'Rush TD', intero),
    C('tgt', 'Tgt', intero), C('rec', 'Rec', intero), C('recYd', 'Rec Yds', intero), C('recTd', 'Rec TD', intero),
    C('ydsScrim', 'Scrim Yds', intero), C('fumLost', 'Fum', intero, -1),
    C('epaPg', 'EPA/G', uno, 1, { adv: true }),
];

/* Kicker e difese: niente snap, quindi la base e' solo partite e punti. */
const BASE_SENZA_SNAP = [
    C('gp', 'G', intero, 0),
    C('fp', 'FPts', uno),
    C('fpg', 'FPts/G', uno),
];

COLONNE.K = [
    ...BASE_SENZA_SNAP,
    C('fgm', 'FGM', intero), C('fga', 'FGA', intero), C('fgPct', 'FG%', perc),
    C('fgaPg', 'FGA/G', uno), C('fg50', '50+', intero),
    C('xpm', 'XPM', intero), C('xpa', 'XPA', intero), C('xpPct', 'XP%', perc),
];

COLONNE.DEF = [
    ...BASE_SENZA_SNAP,
    C('ptsAllowPg', 'Pts allowed/G', uno, -1), C('ydsAllowPg', 'Yds allowed/G', uno, -1),
    C('sacks', 'Sacks', intero), C('defInt', 'INT', intero), C('fumRec', 'Fum rec', intero),
    C('takeaways', 'Takeaways', intero), C('defTd', 'TD', intero), C('safeties', 'Safeties', intero),
    C('threeOut', '3 & outs', intero), C('tfl', 'TFL', intero), C('qbHit', 'QB hits', intero),
    C('passDef', 'Pass def', intero),
];

function bigBoard() {
    const colonne = COLONNE[ruolo];
    const base = soloQualificati ? qualificati(ruolo) : stato.righe.filter(r => posDi(ruolo).includes(r.pos));

    // Il valore nullo va sempre in fondo, in qualunque verso si ordini: chi non
    // ha tentato un passaggio non e' "il peggiore in Y/A", semplicemente non c'e'.
    const k = ordine.key;
    const righe = [...base].sort((a, b) => {
        const va = a[k], vb = b[k];
        if (va == null && vb == null) return (b.fp || 0) - (a.fp || 0);
        if (va == null) return 1;
        if (vb == null) return -1;
        return ordine.dir * (va - vb) || (b.fp || 0) - (a.fp || 0);
    });

    // Il migliore di ogni colonna fra quelli mostrati (tutti, non solo le prime
    // righe). Mai su uno zero: nelle tabelle del sito lo zero e' una casella
    // vuota, e l'oro su una casella vuota non si vede — negli intercetti il
    // "migliore" sarebbero dieci QB a zero, cioe' nessuno da indicare.
    const migliore = {};
    for (const c of colonne) {
        if (!c.meglio) continue;
        const v = righe.map(r => r[c.key]).filter(x => x != null);
        if (!v.length) continue;
        const m = c.meglio > 0 ? Math.max(...v) : Math.min(...v);
        if (m !== 0) migliore[c.key] = m;
    }

    const visibili = tutte ? righe : righe.slice(0, RIGHE_VISIBILI);
    const freccia = (c) => (ordine.key === c.key ? (ordine.dir < 0 ? ' ↓' : ' ↑') : '');

    const testa = `
        <th class="ps-th-name">Player</th>
        ${colonne.map(c => `<th class="ps-th${ordine.key === c.key ? ' is-sorted' : ''}" data-ps-sort="${c.key}"
            title="Sort by ${escAttr(c.label)}">${escAttr(c.label)}${c.adv ? '<sup>†</sup>' : ''}${freccia(c)}</th>`).join('')}`;

    const corpo = visibili.map(r => `
        <tr>
            <td class="ps-td-name"><a href="${linkGiocatore(r)}">${escAttr(r.name)}</a>
                <span class="ps-td-team">${escAttr(r.team)}${misto(ruolo) ? ` · ${r.pos}` : ''}</span></td>
            ${colonne.map(c => {
                const v = r[c.key];
                const oro = migliore[c.key] != null && v != null && v === migliore[c.key] && righe.length > 1;
                return `<td class="${oro ? 'pp-best' : ''}">${v === 0 ? '' : c.fmt(v)}</td>`;
            }).join('')}
        </tr>`).join('');

    const altre = righe.length - visibili.length;
    return `
    ${sottoTitolo('ps-board', `Big Board · ${etichettaFiltro(ruolo)}`)}
    <div class="an-avg-toggle ps-board-bar">
        <button class="an-avg-pill${soloQualificati ? ' active' : ''}" data-ps-qual="1">Qualified only</button>
        <button class="an-avg-pill${soloQualificati ? '' : ' active'}" data-ps-qual="0">Everyone</button>
        <span class="ps-board-count">${righe.length} players</span>
    </div>
    <div class="pm-table-wrap pp-scroll ps-board">
        <table class="pm-table pp-table ps-table">
            <thead><tr>${testa}</tr></thead>
            <tbody>${corpo}</tbody>
        </table>
    </div>
    ${altre > 0 || tutte ? `
    <button class="ps-more" data-ps-all="1">${tutte ? 'Show fewer' : `Show all ${righe.length}`}</button>` : ''}
    <p class="an-footnote">† nflverse advanced metrics, updated every Tuesday — during a week they lag one game
       behind the box score. EPA/G: expected points added per game. CPOE: completion % above what the throws
       predicted. WOPR: target share and air-yards share combined, the best single number for a receiver's role.</p>`;
}

/* ============================================================
   3. EVERY TEAM'S…
   ============================================================ */

/** Il "1" di un ruolo e' il ruolo, non il risultato: chi ha il volume, non chi ha segnato. */
const VOLUME = {
    QB: (r) => r.passAtt || 0,
    RB: (r) => (r.rushAtt || 0) + (r.tgt || 0),
    WR: (r) => r.tgt || 0,
    TE: (r) => r.tgt || 0,
    // il kicker e' chi ha calciato di piu' (un sostituto per infortunio resta
    // dietro); la difesa e' una sola per squadra
    K: (r) => (r.fga || 0) + (r.xpa || 0),
    DEF: (r) => r.gp || 0,
};

/** Come si chiama il "1" di un ruolo a parole: "WR1", ma "kicker" e "defense". */
const nomeUno = (pos) => (pos === 'K' ? 'kicker' : pos === 'DEF' ? 'defense' : `${pos}1`);
const pillolaUno = (pos) => (SENZA_SNAP.has(pos) ? pos : `${pos}1`);

/** Il "1" di un ruolo in ogni squadra: squadra → riga. */
function primiDiSquadra(pos) {
    const perSquadra = new Map();
    for (const r of stato.righe) {
        if (!r.team || r.pos !== pos) continue;
        const gia = perSquadra.get(r.team);
        if (!gia || VOLUME[pos](r) > VOLUME[pos](gia)) perSquadra.set(r.team, r);
    }
    return perSquadra;
}

function ogniSquadra() {
    const pos = ruoloSquadre;
    const perSquadra = primiDiSquadra(pos);
    const totTgt = new Map(), totRush = new Map();
    for (const r of stato.righe) {
        if (!r.team) continue;
        totTgt.set(r.team, (totTgt.get(r.team) || 0) + (r.tgt || 0));
        totRush.set(r.team, (totRush.get(r.team) || 0) + (r.rushAtt || 0));
    }

    const lista = [...perSquadra.values()]
        .filter(r => VOLUME[pos](r) > 0 && r.fpg != null)
        .sort((a, b) => b.fpg - a.fpg);
    if (!lista.length) return `${sottoTitolo('ps-depth', `Every team's ${nomeUno(pos)}`)}<p class="an-footnote">No data yet.</p>`;

    // Una difesa puo' avere punti negativi: la barra parte da zero e si
    // ferma li', invece di sparire o riempirsi tutta per un valore sotto zero.
    const max = Math.max(lista[0].fpg, 0.1);
    const media = lista.reduce((s, r) => s + r.fpg, 0) / lista.length;
    const larg = (v) => Math.max(0, Math.min(100, (v / max) * 100));

    // Quanto del volume della squadra prende lui: e' la domanda che il ranking
    // per punti non dice — un WR1 con il 30% dei target e uno col 18% sono due
    // attacchi diversi.
    const quota = (r) => (pos === 'WR' || pos === 'TE') ? div(r.tgt, totTgt.get(r.team))
        : pos === 'RB' ? div(r.rushAtt, totRush.get(r.team)) : null;
    const riassunto = (r) => pos === 'K'
        ? `${r.fgm}/${r.fga} FG · ${r.fg50} from 50+ · ${r.xpm}/${r.xpa} XP`
        : pos === 'DEF'
            ? `${uno(r.ptsAllowPg)} pts allowed/g · ${r.sacks} sacks · ${r.takeaways} takeaways · ${r.defTd} TD`
        : pos === 'QB'
        ? `${intero(r.passYd)} yds · ${intero(r.passTd)} TD · ${intero(r.passInt)} INT · ${uno(r.ypa)} Y/A`
        : pos === 'RB'
            ? `${intero(r.rushAtt)} car · ${intero(r.rushYd)} yds · ${intero(r.tgt)} tgt · ${intero(somma(r.rushTd, r.recTd))} TD`
            : `${intero(r.tgt)} tgt · ${intero(r.rec)} rec · ${intero(r.recYd)} yds · ${intero(r.recTd)} TD`;

    return `
    ${sottoTitolo('ps-depth', `Every team's ${nomeUno(pos)}`)}
    <p class="an-footnote">${lista.length} teams, ranked by fantasy points per game. League average for a ${nomeUno(pos)}:
       <b>${uno(media)}</b> per game.</p>
    <ol class="ps-depth" style="--ps-media:${larg(media).toFixed(1)}%">
        ${lista.map((r, i) => {
            const q = quota(r);
            return `
        <li class="ps-depth-row${r.fpg >= media ? ' is-up' : ''}">
            <span class="ps-depth-n">${i + 1}</span>
            <span class="ps-depth-team">${logo(r.team)}<b>${escAttr(r.team)}</b></span>
            ${headshotImg({ name: r.name, position: r.pos, nflTeam: r.team }, 'an-headshot ps-depth-photo')}
            <span class="ps-depth-who">
                <a href="${linkGiocatore(r)}">${escAttr(r.name)}</a>
                <small>${riassunto(r)}${q != null ? ` · <b>${perc(q)}</b> of team ${pos === 'RB' ? 'carries' : 'targets'}` : ''}</small>
            </span>
            <span class="ps-depth-bar" aria-hidden="true"><i style="width:${larg(r.fpg).toFixed(1)}%"></i></span>
            <span class="ps-depth-val">${uno(r.fpg)}</span>
        </li>`;
        }).join('')}
    </ol>`;
}

/* ============================================================
   SCHEDE
   ============================================================ */

const SCHEDE = [
    { id: 'overview', label: 'Overview' },
    { id: 'signals', label: 'Signals' },
    { id: 'consistency', label: 'Consistency' },
    { id: 'teams', label: 'Teams' },
];

/** Le pillole della scheda Teams: un ruolo per il "1" di squadra e per il calendario. */
function pilloleSquadre() {
    const pill = (p) => `<button class="an-avg-pill${ruoloSquadre === p ? ' active' : ''}" data-ps-depth="${p}">${pillolaUno(p)}</button>`;
    return `<div class="an-avg-toggle ps-pos-bar">${RUOLI.map(pill).join('')}</div>`;
}

/** Il segnale non esiste per kicker e difese: meglio dirlo che mostrare una scheda vuota. */
function nonPer(cosa, perche) {
    return `<div class="empty-state ps-empty"><p class="empty-state-text">${cosa} is not available for kickers and defenses</p>
        <p class="empty-state-sub">${perche}</p></div>`;
}

const soloAttacco = (f) => posDi(f).some(p => !SENZA_SNAP.has(p));
const segno = (v, f) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${f(Math.abs(v))}`;

/** Tacche "tonde" da 0 a oltre `max`. */
function tacche(max, quante = 5) {
    const grezzo = (max || 1) / quante;
    const pot = 10 ** Math.floor(Math.log10(grezzo));
    const passo = [1, 2, 2.5, 5, 10].map(m => m * pot).find(p => p >= grezzo) || pot * 10;
    const out = [];
    for (let v = 0; v <= max + 1e-9; v += passo) out.push(+v.toFixed(6));
    if (out[out.length - 1] < max) out.push(+(out[out.length - 1] + passo).toFixed(6));
    return out;
}

registraInfo({
    'ps-td-sell': {
        cosa: 'Who has scored more touchdowns than his red-zone chances would give an average player at his position.',
        base: 'Qualified players. Red-zone targets and carries (for a QB alone, red-zone throws too), from Sleeper.',
        regola: 'Expected touchdowns = each red-zone chance × how often that kind of chance ends in a touchdown across the league, measured on this season and the one before. The rate counts every touchdown, long ones included, so "above expected" really means above the position. Touchdowns swing from year to year more than anything else in fantasy: a big surplus tends to shrink, a big deficit tends to fill.',
    },
    'ps-td-buy': {
        cosa: 'Who has scored fewer touchdowns than his red-zone chances say he should have.',
        base: 'Qualified players with at least one red-zone chance.',
        regola: 'Same model as the card next to it. A player here keeps getting the chances; the touchdowns are the part that has not arrived yet.',
    },
    'ps-uso': {
        cosa: 'Usage against production: the points a player’s touches were worth, next to the points he actually made of them.',
        base: 'Qualified players, per game. Expected points = carries × what an average carry at his position is worth in this league, plus targets × the same for a target, plus pass attempts for QBs — measured on this season and the one before.',
        regola: 'On the diagonal a player does exactly what his role gives. Above it he makes more of it: talent, or a hot streak — the second fades. Below it the usage is there and the points are not yet: the usual buy-low. Actual points here are the ones those same plays made (yards, catches, touchdowns, interceptions), so fumbles and two-point tries do not blur the comparison.',
    },
    'ps-uso-sopra': {
        cosa: 'Points per game above what his usage is worth.',
        base: 'Qualified players.',
        regola: 'The gap between the dot and the diagonal in the chart above, per game.',
    },
    'ps-uso-sotto': {
        cosa: 'Points per game below what his usage is worth.',
        base: 'Qualified players.',
        regola: 'Usage is the stickier half: a player the offense keeps feeding tends to catch up with it.',
    },
    'ps-oltre': {
        cosa: 'What a player does beyond what the play gave him — the closest thing to pure talent in the numbers.',
        base: 'NFL Next Gen Stats via nflverse: only players with enough plays for the league to publish them. Updated every Tuesday.',
        regola: 'QBs: completion % over expected (CPOE), how many more passes he completes than the difficulty of his throws predicts. RBs: rush yards over expected per carry — the model knows the blockers and the defenders in front of him. WRs and TEs: yards after the catch over expected, per catch.',
    },
    'ps-cost': {
        cosa: 'How a player’s weeks spread out — the same average can hide a rock and a lottery ticket.',
        base: 'League points game by game, from nflverse (updated every Tuesday). Players who played at least half the games of the most present.',
        regola: 'Each dot is one game. The band runs from the floor to the ceiling — the 25th and 75th percentile, so one game cut short by an injury does not decide the floor — and the tick inside is the median. The dashed tick is the starter line: the average of the last player a league of four would start at that position (the 4th QB, the 10th RB and WR once the flex is split, the 4th TE). "Starts" is the share of his games above that line.',
    },
    'ps-sos': {
        cosa: 'How much the defenses left on a team’s schedule give up to that position.',
        base: 'Fantasy points allowed per game to the position, in league scoring, from the NFL team stats.',
        regola: 'Early in the season two games say little about a defense, so this season is blended with the last one, which counts as four games: by week 12 the current season is already three quarters of the number. Positive means the remaining opponents allow more than average — a friendlier road. Once the season is over it measures the schedule the team faced instead.',
    },
    'ps-alberi-corse': {
        cosa: 'How each offense splits its carries.',
        base: 'Rushing attempts from Sleeper, live — quarterbacks included: a QB run is a carry the running back does not get.',
        regola: 'Sorted by how much one player carries the load. A back with 70% of the carries is a workhorse; two at 40% each is a committee, and neither is a safe start. Anyone under 6% is grouped in "others".',
    },
    'ps-alberi-tocchi': {
        cosa: 'Targets and carries together: every chance a player gets to touch the ball.',
        base: 'Targets plus rushing attempts from Sleeper, live.',
        regola: 'The measure that puts backs and receivers on the same scale. Read it next to the other two trees: a back who owns the carry tree but disappears in the target one is a one-dimensional player, and loses snaps whenever his team falls behind.',
    },
    'ps-alberi': {
        cosa: 'How each offense splits its targets among its receivers, backs and tight ends.',
        base: 'Targets from Sleeper, live. Players are counted on their current team: a traded player brings his targets with him.',
        regola: 'Teams are sorted by how much they lean on one player. At the top, one receiver takes the lion’s share — reliable volume, and a big hole if he misses a game. At the bottom the ball is spread around. Anyone under 6% is grouped in "others".',
    },
});

/* ============================================================
   SIGNALS — TD luck
   ============================================================ */

function bloccoTd() {
    if (!soloAttacco(ruolo)) {
        return nonPer('TD luck', 'Kickers and defenses do not get red-zone targets or carries: there is no chance to measure the touchdowns against.');
    }
    // con All tutti si confrontano sullo scrimmage: coi passaggi dentro i
    // primi sarebbero tutti quarterback
    const chiave = ruolo === TUTTI ? 'tdScrim' : 'tdR';
    const q = qualificati(ruolo).filter(r => !SENZA_SNAP.has(r.pos) && r[chiave]);
    const sopra = [...q].filter(r => r[chiave].scarto > 0.05)
        .sort((a, b) => b[chiave].scarto - a[chiave].scarto).slice(0, 8);
    const sotto = [...q].filter(r => r[chiave].scarto < -0.05)
        .sort((a, b) => a[chiave].scarto - b[chiave].scarto).slice(0, 8);
    // ogni TD vale 6 punti di lega (4 se lanciato): il segnale in punti si legge meglio
    const puntiTd = (r) => (ruolo === 'QB' ? 4 : 6);
    const riga = (r) => {
        const t = r[chiave];
        return `<b>${segno(t.scarto, uno)} TD</b><small>${t.veri} scored · ${uno(t.attesi)} expected · ≈ ${segno(t.scarto * puntiTd(r), (v) => Math.round(v))} pts</small>`;
    };
    return `
    <div class="ps-rate-grid">
        ${carta('ps-td-sell', 'Scored above their chances', sopra, (r) => Math.abs(r[chiave].scarto), riga,
            'Nobody is meaningfully above expectation yet.')}
        ${carta('ps-td-buy', 'Due for more touchdowns', sotto, (r) => Math.abs(r[chiave].scarto), riga,
            'Nobody is meaningfully below expectation yet.', false, 'buy')}
    </div>
    ${stato.conPrec ? '' : `<p class="an-footnote">The rates come from ${anno} alone: there is no season before it in the data.</p>`}`;
}

/* ============================================================
   SIGNALS — uso contro produzione
   ============================================================ */

function bloccoUso() {
    if (!soloAttacco(ruolo)) {
        return nonPer('Usage vs production', 'A kicker’s or a defense’s points do not come from touches, so there is no usage to weigh them against.');
    }
    const punti = qualificati(ruolo)
        .filter(r => !SENZA_SNAP.has(r.pos) && r.xfp && r.gp)
        .map(r => ({ r, x: r.xfp.attesi / r.gp, y: r.xfp.veri / r.gp, d: r.xfp.scarto / r.gp }));
    if (punti.length < 5) return `${sottoTitolo('ps-uso', 'Usage vs production')}<p class="an-footnote">Not enough qualified players yet.</p>`;

    const sopra = [...punti].sort((a, b) => b.d - a.d).slice(0, 8);
    const sotto = [...punti].sort((a, b) => a.d - b.d).slice(0, 8);
    const etichettati = new Set([...sopra.slice(0, 5), ...sotto.slice(0, 5)].map(p => p.r));

    // Stessa scala sui due assi: la diagonale deve stare a 45°, se no "sopra la
    // linea" non vorrebbe dire "piu' punti di quanti ne valga l'uso".
    const W = 820, H = 440, L = 52, R = 18, T = 14, B = 44;
    const max = Math.max(...punti.map(p => Math.max(p.x, p.y)), 1);
    const tk = tacche(max);
    const top = tk[tk.length - 1];
    const x = (v) => L + (v / top) * (W - L - R);
    const y = (v) => H - B - (v / top) * (H - T - B);

    const griglia = tk.map(v => `
        <line x1="${x(v)}" y1="${T}" x2="${x(v)}" y2="${H - B}" class="an-gridline"/>
        <line x1="${L}" y1="${y(v)}" x2="${W - R}" y2="${y(v)}" class="an-gridline"/>
        <text x="${x(v)}" y="${H - B + 16}" class="an-tick" text-anchor="middle">${Math.round(v)}</text>
        <text x="${L - 8}" y="${y(v) + 4}" class="an-tick" text-anchor="end">${Math.round(v)}</text>`).join('');

    const punto = (p) => `
        <circle cx="${x(p.x).toFixed(1)}" cy="${y(p.y).toFixed(1)}" r="${etichettati.has(p.r) ? 4.5 : 3.5}"
            class="ps-dot pos-${p.r.pos.toLowerCase()}${etichettati.has(p.r) ? ' is-marked' : ''}">
            <title>${escAttr(p.r.name)} (${p.r.pos}, ${p.r.team}) — usage worth ${uno(p.x)} per game, made ${uno(p.y)} (${segno(p.d, uno)})</title>
        </circle>`;
    const nome = (p) => {
        const cognome = p.r.name.split(' ').slice(1).join(' ') || p.r.name;
        const aDestra = x(p.x) < W - 150;
        return `<text x="${(x(p.x) + (aDestra ? 8 : -8)).toFixed(1)}" y="${(y(p.y) + 4).toFixed(1)}"
            class="ps-dot-lbl" text-anchor="${aDestra ? 'start' : 'end'}">${escAttr(cognome)}</text>`;
    };

    const ruoliPresenti = [...new Set(punti.map(p => p.r.pos))];
    const legenda = ruoliPresenti.length > 1 ? `
        <div class="ps-legend">${ruoliPresenti.map(p => `<span><i class="pos-${p.toLowerCase()}"></i>${p}</span>`).join('')}</div>` : '';

    return `
    ${sottoTitolo('ps-uso', 'Usage vs production')}
    ${legenda}
    <div class="an-chart ps-scatter">
        <svg viewBox="0 0 ${W} ${H}" class="an-svg" role="img" aria-label="Expected points from usage against actual points, per game">
            ${griglia}
            <line x1="${x(0)}" y1="${y(0)}" x2="${x(top)}" y2="${y(top)}" class="ps-diag"/>
            <text x="${x(top) - 6}" y="${y(top) + 16}" class="ps-diag-lbl" text-anchor="end">as expected</text>
            ${punti.map(punto).join('')}
            ${punti.filter(p => etichettati.has(p.r)).map(nome).join('')}
            <text x="${(L + W - R) / 2}" y="${H - 8}" class="ps-axis" text-anchor="middle">Points his usage is worth, per game</text>
            <text x="14" y="${(T + H - B) / 2}" class="ps-axis" text-anchor="middle" transform="rotate(-90 14 ${(T + H - B) / 2})">Points he made, per game</text>
        </svg>
    </div>
    <div class="ps-rate-grid ps-grid-after">
        ${carta('ps-uso-sopra', 'Beating their usage', sopra.map(p => p.r), (r) => Math.abs(r.xfp.scarto / r.gp),
            (r) => `<b>${segno(r.xfp.scarto / r.gp, uno)}</b><small>${uno(r.xfp.veri / r.gp)} made · ${uno(r.xfp.attesi / r.gp)} expected</small>`)}
        ${carta('ps-uso-sotto', 'Usage says more is coming', sotto.map(p => p.r), (r) => Math.abs(r.xfp.scarto / r.gp),
            (r) => `<b>${segno(r.xfp.scarto / r.gp, uno)}</b><small>${uno(r.xfp.veri / r.gp)} made · ${uno(r.xfp.attesi / r.gp)} expected</small>`,
            'No qualified players yet.', false, 'buy')}
    </div>`;
}

/* ============================================================
   SIGNALS — oltre l'atteso
   ============================================================ */

const OLTRE = {
    QB: { chiave: 'cpoe', titolo: 'Completion % over expected', fmt: (v) => `${segno(v, uno)}%`, sotto: 'CPOE' },
    RB: { chiave: 'ryoe', titolo: 'Rush yards over expected, per carry', fmt: (v) => segno(v, due), sotto: 'RYOE / carry' },
    WR: { chiave: 'yacOE', titolo: 'YAC over expected, per catch', fmt: (v) => segno(v, due), sotto: 'YAC OE / catch' },
    TE: { chiave: 'yacOE', titolo: 'YAC over expected, per catch', fmt: (v) => segno(v, due), sotto: 'YAC OE / catch' },
};

function bloccoOltre() {
    if (!soloAttacco(ruolo)) {
        return nonPer('Over expected', 'The Next Gen models behind these numbers measure passers, runners and receivers only.');
    }
    const q = qualificati(ruolo).filter(r => !SENZA_SNAP.has(r.pos));
    const conMisura = (pos) => q.filter(r => r.pos === pos && r[OLTRE[pos].chiave] != null);
    const valore = (m) => (r) => `<b>${m.fmt(r[m.chiave])}</b><small>${m.sotto}</small>`;

    // Un ruolo solo: chi sta sopra e chi sta sotto, piu' una misura di contorno.
    if (!misto(ruolo)) {
        const m = OLTRE[ruolo];
        const lista = conMisura(ruolo);
        const sopra = [...lista].sort((a, b) => b[m.chiave] - a[m.chiave]).filter(r => r[m.chiave] > 0).slice(0, 8);
        const sotto = [...lista].sort((a, b) => a[m.chiave] - b[m.chiave]).filter(r => r[m.chiave] < 0).slice(0, 8);
        const extra = ruolo === 'RB'
            ? carta('ps-oltre', 'Broken tackles per 100 carries',
                [...q].filter(r => r.pos === 'RB' && r.rushBrokenTk != null && r.rushAtt >= 10)
                    .sort((a, b) => b.rushBrokenTk / b.rushAtt - a.rushBrokenTk / a.rushAtt).slice(0, 8),
                (r) => r.rushBrokenTk / r.rushAtt, (r) => `<b>${uno(r.rushBrokenTk / r.rushAtt * 100)}</b><small>${r.rushBrokenTk} broken</small>`)
            : (ruolo === 'WR' || ruolo === 'TE')
                ? carta('ps-oltre', 'Separation at the catch point',
                    [...q].filter(r => r.pos === ruolo && r.sep != null).sort((a, b) => b.sep - a.sep).slice(0, 8),
                    'sep', (r) => `<b>${uno(r.sep)} yds</b><small>average separation</small>`)
                : '';
        return `
        ${sottoTitolo('ps-oltre', `Over expected · ${m.titolo}`)}
        <div class="ps-rate-grid">
            ${carta('ps-oltre', 'Most above expected', sopra, (r) => Math.abs(r[m.chiave]), valore(m), 'Nobody above expectation yet.', false, 'buy')}
            ${carta('ps-oltre', 'Most below expected', sotto, (r) => Math.abs(r[m.chiave]), valore(m), 'Nobody below expectation yet.')}
            ${extra}
        </div>`;
    }

    // Filtri misti: una carta per ruolo, i migliori di ciascuno. Le misure sono
    // diverse (CPOE, RYOE, YAC) e non stanno in una classifica sola.
    const carte = posDi(ruolo).filter(p => OLTRE[p]).map(pos => {
        const m = OLTRE[pos];
        const top = conMisura(pos).sort((a, b) => b[m.chiave] - a[m.chiave]).slice(0, 8);
        return carta('ps-oltre', `${pos} · ${m.titolo}`, top, (r) => Math.max(0, r[m.chiave]), valore(m), 'No data yet.', false, 'buy');
    });
    return `
    ${sottoTitolo('ps-oltre', 'Over expected')}
    <div class="ps-rate-grid">${carte.join('')}</div>`;
}

/* ============================================================
   CONSISTENCY
   ============================================================ */

const ORDINI_COSTANZA = [
    { id: 'media', label: 'Average', chiave: (r) => r.c.media },
    { id: 'floor', label: 'Floor', chiave: (r) => r.c.p25 },
    { id: 'ceiling', label: 'Ceiling', chiave: (r) => r.c.p75 },
    { id: 'starts', label: 'Starts %', chiave: (r) => r.starts },
];

function bloccoCostanza() {
    if (!soloAttacco(ruolo)) {
        return nonPer('Consistency', 'The game-by-game points come from nflverse, which tracks passers, runners and receivers only.');
    }
    const pos = posDi(ruolo).filter(p => !SENZA_SNAP.has(p));
    const conSerie = stato.righe.filter(r => pos.includes(r.pos) && r.c);
    if (!conSerie.length) return `${sottoTitolo('ps-cost', 'Consistency')}<p class="an-footnote">No game-by-game data for ${anno} yet.</p>`;

    // Chi ha giocato almeno meta' delle partite del piu' presente: una media su
    // una partita e' un caso, non una costanza.
    const maxN = Math.max(...conSerie.map(r => r.c.n));
    const minN = Math.max(2, Math.ceil(maxN * 0.5));
    const validi = conSerie.filter(r => r.c.n >= minN);
    const linea = Object.fromEntries(pos.map(p => [p, lineaTitolare(validi, p)]));
    for (const r of validi) {
        const l = linea[r.pos];
        r.starts = l == null ? null : r.settimane.filter(v => v >= l).length / r.settimane.length;
    }

    const ord = ORDINI_COSTANZA.find(o => o.id === ordineCostanza) || ORDINI_COSTANZA[0];
    const lista = [...validi].filter(r => ord.chiave(r) != null)
        .sort((a, b) => ord.chiave(b) - ord.chiave(a) || b.c.media - a.c.media).slice(0, 20);

    // Una corsia per giocatore: i punti partita per partita, la banda fra
    // pavimento e tetto, la mediana, e la tacca tratteggiata della linea da
    // titolare del suo ruolo.
    const W = 820, L = 170, R = 96, T = 10, B = 30, CORSIA = 30;
    const H = T + B + lista.length * CORSIA;
    const max = Math.max(...lista.flatMap(r => r.settimane), 1);
    const tk = tacche(max, 6);
    const top = tk[tk.length - 1];
    const x = (v) => L + (Math.max(0, v) / top) * (W - L - R);

    const griglia = tk.map(v => `
        <line x1="${x(v)}" y1="${T}" x2="${x(v)}" y2="${H - B}" class="an-gridline"/>
        <text x="${x(v)}" y="${H - B + 16}" class="an-tick" text-anchor="middle">${Math.round(v)}</text>`).join('');

    let seme = 3;
    const caso = () => { seme = (seme * 9301 + 49297) % 233280; return seme / 233280; };

    const corsie = lista.map((r, i) => {
        const cy = T + i * CORSIA + CORSIA / 2;
        const c = r.c, l = linea[r.pos];
        const dots = r.settimane.map(v => `<circle cx="${x(v).toFixed(1)}" cy="${(cy + (caso() - 0.5) * 12).toFixed(1)}" r="2.6"
            class="ps-dot pos-${r.pos.toLowerCase()}"><title>${escAttr(r.name)}: ${uno(v)} pts</title></circle>`).join('');
        return `
        <g class="ps-lane">
            <rect x="${x(c.p25).toFixed(1)}" y="${(cy - 9).toFixed(1)}" width="${Math.max(1, x(c.p75) - x(c.p25)).toFixed(1)}" height="18" rx="4" class="ps-lane-band"/>
            ${l != null ? `<line x1="${x(l).toFixed(1)}" y1="${(cy - 12).toFixed(1)}" x2="${x(l).toFixed(1)}" y2="${(cy + 12).toFixed(1)}" class="ps-lane-line"/>` : ''}
            ${dots}
            <line x1="${x(c.mediana).toFixed(1)}" y1="${(cy - 10).toFixed(1)}" x2="${x(c.mediana).toFixed(1)}" y2="${(cy + 10).toFixed(1)}" class="ps-lane-med"/>
            <text x="${L - 10}" y="${(cy + 4).toFixed(1)}" class="ps-lane-name" text-anchor="end">${escAttr(r.name)}<title>${escAttr(r.name)} — ${c.n} games · average ${uno(c.media)} · floor ${uno(c.p25)} · median ${uno(c.mediana)} · ceiling ${uno(c.p75)}</title></text>
            <text x="${W - R + 10}" y="${(cy + 4).toFixed(1)}" class="ps-lane-val">${r.starts == null ? '' : `${Math.round(r.starts * 100)}%`}<tspan class="ps-lane-sub"> · ${uno(c.media)}</tspan></text>
        </g>`;
    }).join('');

    const pill = (o) => `<button class="an-avg-pill${ord.id === o.id ? ' active' : ''}" data-ps-cost="${o.id}">${o.label}</button>`;
    const linee = pos.filter(p => linea[p] != null).map(p => `${p} ${uno(linea[p])}`).join(' · ');
    return `
    ${sottoTitolo('ps-cost', 'Consistency')}
    <div class="an-avg-toggle ps-board-bar"><span class="an-avg-label">Sort:</span>${ORDINI_COSTANZA.map(pill).join('')}</div>
    <div class="an-chart ps-lanes">
        <svg viewBox="0 0 ${W} ${H}" class="an-svg" role="img" aria-label="Fantasy points game by game">
            ${griglia}
            <text x="${W - R + 10}" y="${T + 2}" class="ps-lane-head">starts · avg</text>
            ${corsie}
        </svg>
    </div>
    <p class="an-footnote">Each dot is a game. The band is floor to ceiling (25th to 75th percentile), the solid tick the
       median, the dashed tick the starter line${linee ? ` — ${linee} points per game` : ''}. On the right: share of games above
       that line, and the average. Players with at least ${minN} games.${maxN < 4 ? ` Only ${maxN} games played so far: this is a preview more than a verdict.` : ''}</p>`;
}

/* ============================================================
   TEAMS — calendario
   ============================================================ */

function bloccoCalendario() {
    const pos = ruoloSquadre;
    const dati = calendario(stato.team, stato.teamPrec, pos, finestra);
    if (!dati || !dati.righe.length) {
        return `${sottoTitolo('ps-sos', 'Schedule')}<p class="an-footnote">No schedule data for ${anno}.</p>`;
    }
    const primi = primiDiSquadra(pos);
    const maxAbs = Math.max(...dati.righe.map(r => Math.abs(r.indice)), 0.1);
    const titolo = dati.chiusa ? `Schedule faced · ${nomeUno(pos)}` : `Schedule ahead · ${nomeUno(pos)}`;
    const pill = (id, label) => `<button class="an-avg-pill${finestra === id ? ' active' : ''}" data-ps-fin="${id}">${label}</button>`;
    const mostra = (avv) => (finestra === 'next4' ? avv : avv.slice(0, 6));

    return `
    ${sottoTitolo('ps-sos', titolo)}
    ${dati.chiusa ? '' : `<div class="an-avg-toggle ps-board-bar">${pill('rest', 'Rest of season')}${pill('next4', 'Next 4 games')}</div>`}
    <p class="an-footnote">Fantasy points the opponents allow to a ${nomeUno(pos)} per game, against the league average of
       <b>${uno(dati.media)}</b>. Right of the line: a friendlier road.</p>
    <ol class="ps-sos">
        ${dati.righe.map((r, i) => {
            const chi = primi.get(r.team);
            const larg = (Math.abs(r.indice) / maxAbs) * 50;
            const avv = mostra(r.avversari);
            const resto = r.avversari.length - avv.length;
            return `
        <li class="ps-sos-row">
            <span class="ps-depth-n">${i + 1}</span>
            <span class="ps-sos-team">${logo(r.team)}<b>${escAttr(r.team)}</b>${chi && pos !== 'DEF'
                ? `<small><a href="${linkGiocatore(chi)}">${escAttr(chi.name)}</a></small>` : ''}</span>
            <span class="ps-sos-bar" aria-hidden="true"><i class="${r.indice >= 0 ? 'is-easy' : 'is-hard'}"
                style="${r.indice >= 0 ? 'left:50%' : `left:${(50 - larg).toFixed(1)}%`};width:${larg.toFixed(1)}%"></i></span>
            <span class="ps-sos-val ${r.indice >= 0 ? 'is-easy' : 'is-hard'}">${segno(r.indice, uno)}</span>
            <span class="ps-sos-opp">${avv.map(a => `<img src="${teamLogoUrl(a.opp)}" alt="${escAttr(a.opp)}" loading="lazy"
                title="W${a.week} ${a.home ? 'vs' : '@'} ${escAttr(a.opp)} — allows ${uno(a.stima)} per game"
                onerror="this.style.display='none'">`).join('')}${resto > 0 ? `<small>+${resto}</small>` : ''}</span>
        </li>`;
        }).join('')}
    </ol>`;
}

/* ============================================================
   TEAMS — alberi dei target
   ============================================================ */

/** Come si chiama ogni albero, e come si dice la sua unita' in una frase. */
const ALBERI = {
    target: { id: 'ps-alberi', titolo: 'Target trees', unita: 'targets', primo: 'busiest target' },
    corse: { id: 'ps-alberi-corse', titolo: 'Carry trees', unita: 'carries', primo: 'busiest ball carrier' },
    tocchi: { id: 'ps-alberi-tocchi', titolo: 'Touch trees', unita: 'touches (targets + carries)', primo: 'busiest player' },
};

/**
 * Un albero: una riga per squadra, uno spicchio per giocatore largo quanto la
 * sua quota. Tre alberi con lo stesso disegno — target, portate, tocchi — cosi'
 * si confrontano a colpo d'occhio: un RB che domina l'albero delle corse ma
 * sparisce in quello dei target e' un giocatore da una sola dimensione.
 */
function bloccoAlberi(misura = 'target') {
    const a = ALBERI[misura];
    const lista = alberi(stato.righe, misura);
    if (!lista.length) return `${sottoTitolo(a.id, a.titolo)}<p class="an-footnote">No ${a.unita} yet.</p>`;
    const cognome = (nome) => nome.split(' ').slice(1).join(' ') || nome;
    const ruoli = MISURE_ALBERO[misura].ruoli.filter(p => lista.some(x => x.fette.some(f => f.pos === p)));
    return `
    ${sottoTitolo(a.id, a.titolo)}
    <div class="ps-legend">${ruoli.map(p => `<span><i class="pos-${p.toLowerCase()}"></i>${p}</span>`).join('')}<span><i class="ps-altri-key"></i>others</span></div>
    <ol class="ps-trees">
        ${lista.map(x => `
        <li class="ps-tree-row">
            <span class="ps-sos-team">${logo(x.team)}<b>${escAttr(x.team)}</b></span>
            <span class="ps-tree-bar">
                ${x.fette.map(f => `<a class="ps-tree-seg pos-${f.pos.toLowerCase()}" href="${linkGiocatore(f.r)}"
                    style="flex:${f.quota.toFixed(4)}" title="${escAttr(f.name)} · ${f.pos} · ${perc(f.quota)} of ${a.unita} (${f.valore})">
                    ${f.quota >= 0.14 ? `<em>${escAttr(cognome(f.name))} ${perc(f.quota)}</em>` : ''}</a>`).join('')}
                ${x.altri.valore ? `<span class="ps-tree-seg ps-tree-altri" style="flex:${x.altri.quota.toFixed(4)}"
                    title="${x.altri.n} others · ${perc(x.altri.quota)} of ${a.unita}"></span>` : ''}
            </span>
            <span class="ps-tree-top">${perc(x.primo)}</span>
        </li>`).join('')}
    </ol>
    <p class="an-footnote">Sorted by the share of the ${a.primo}: at the top, offenses that lean on one player.
       Players under 6% are grouped in grey.</p>`;
}

/* ============================================================
   PAGINA
   ============================================================ */

function renderPickRow() {
    const box = document.getElementById('ps-pick-row');
    if (!box) return;
    const anni = SEASONS_DESC.map(y => ({ value: y, label: y }));
    // Anno e pagina nella stessa riga, come le altre tendine del sito: la pagina
    // subito a destra dell'anno. Erano quattro pillole sotto i ruoli, e due
    // file di pillole una sopra l'altra si confondevano.
    const pagine = SCHEDE.map(t => ({ value: t.id, label: t.label }));
    box.innerHTML = pickDropdownHTML('year', anni, SEASONS_DESC.indexOf(String(anno)))
        + pickDropdownHTML('vista', pagine, Math.max(0, pagine.findIndex(p => p.value === vista)));
    bindPickDropdown(box, (id, value) => {
        if (id === 'vista') {
            vista = value;
            renderPickRow();
            render();
            return;
        }
        if (id !== 'year') return;
        anno = value;
        renderPickRow();
        load();
    });
}

async function load() {
    const wrap = document.getElementById('playerstats-content');
    if (!wrap) return;
    wrap.innerHTML = `<div class="loading-state"><div class="spinner"></div><p>Loading ${anno} stats…</p></div>`;
    const richiesto = anno;
    const dati = await carica(richiesto);
    if (String(richiesto) !== String(anno)) return;   // anno cambiato nel frattempo
    if (!dati || !dati.righe.length) {
        wrap.innerHTML = `<div class="empty-state"><p class="empty-state-text">No player stats for ${anno}</p></div>`;
        return;
    }
    stato = dati;
    render();
}

function render() {
    const wrap = document.getElementById('playerstats-content');
    if (!wrap || !stato) return;

    // Stagione appena cominciata: ogni rapporto e' fatto su una o due partite,
    // e la pagina lo dice invece di nasconderlo (come `sampleTag` nella scheda
    // giocatore).
    const poche = stato.maxGp > 0 && stato.maxGp < 4;
    const pill = (p) => `<button class="an-avg-pill${ruolo === p ? ' active' : ''}" data-ps-pos="${p}">${etichettaFiltro(p)}</button>`;

    const corpo = vista === 'signals' ? `
        <section class="ps-block">${bloccoTd()}</section>
        <section class="ps-block">${bloccoUso()}</section>
        <section class="ps-block">${bloccoOltre()}</section>`
        : vista === 'consistency' ? `
        <section class="ps-block">${bloccoCostanza()}</section>`
            : vista === 'teams' ? `
        <section class="ps-block" id="ps-depth-wrap">${ogniSquadra()}</section>
        <section class="ps-block">${bloccoCalendario()}</section>
        <section class="ps-block">${bloccoAlberi('target')}</section>
        <section class="ps-block">${bloccoAlberi('corse')}</section>
        <section class="ps-block">${bloccoAlberi('tocchi')}</section>`
                : `
        <section class="ps-block">${carteFrequenze()}</section>
        <section class="ps-block">${bigBoard()}</section>`;

    // In Teams i filtri del ruolo lasciano il posto alle pillole delle squadre:
    // li' conta un ruolo solo (un "All1" o un "RB/WR1" di squadra non esistono),
    // e due file di ruoli una sopra l'altra non si capiva quale comandasse.
    wrap.innerHTML = `
    ${vista === 'teams' ? pilloleSquadre() : `<div class="an-avg-toggle ps-pos-bar">${FILTRI.map(pill).join('')}</div>`}
    ${poche ? `<p class="an-footnote ps-sample">${anno} · ${stato.maxGp} game${stato.maxGp === 1 ? '' : 's'} played so far:
        every rate on this page is built on a small sample, and will move a lot week to week.</p>` : ''}
    ${stato.snapInRitardo ? `<p class="an-footnote ps-sample">Snap counts come out the day after a game, the stats right away:
        for ${stato.snapInRitardo} player${stato.snapInRitardo === 1 ? '' : 's'} the latest game has no snaps yet, so every
        per-snap rate leaves that game out until they arrive. Totals in the tables include it.</p>` : ''}
    ${corpo}`;
    hydrateImages(wrap);
}

function bindContent() {
    const wrap = document.getElementById('playerstats-content');
    if (!wrap) return;
    wrap.addEventListener('click', (e) => {
        const info = e.target.closest('.an-info');
        if (info) { apriInfo(info); return; }

        const pos = e.target.closest('[data-ps-pos]');
        if (pos) {
            ruolo = pos.dataset.psPos;
            // anche il blocco delle 32 squadre segue il ruolo scelto: chi guarda
            // i QB vuole i QB1. Le sue pillole restano, per cambiarlo da solo.
            // Col filtro misto resta dov'era: un "RB/WR1" di squadra non esiste.
            if (RUOLI.includes(ruolo)) ruoloSquadre = ruolo;
            ordine = { key: 'fp', dir: -1 };
            tutte = false;
            render();
            return;
        }
        const sort = e.target.closest('[data-ps-sort]');
        if (sort) {
            const k = sort.dataset.psSort;
            const col = COLONNE[ruolo].find(c => c.key === k);
            // primo clic: il verso "buono" della colonna (i drop dal meno al piu')
            ordine = ordine.key === k
                ? { key: k, dir: -ordine.dir }
                : { key: k, dir: col && col.meglio < 0 ? 1 : -1 };
            render();
            return;
        }
        if (e.target.closest('[data-ps-all]')) { tutte = !tutte; render(); return; }
        const qual = e.target.closest('[data-ps-qual]');
        if (qual) { soloQualificati = qual.dataset.psQual === '1'; render(); return; }

        // le pillole della scheda Teams comandano il "1" di squadra E il calendario
        const dep = e.target.closest('[data-ps-depth]');
        if (dep) { ruoloSquadre = dep.dataset.psDepth; render(); return; }

        const cost = e.target.closest('[data-ps-cost]');
        if (cost) { ordineCostanza = cost.dataset.psCost; render(); return; }
        const fin = e.target.closest('[data-ps-fin]');
        if (fin) { finestra = fin.dataset.psFin; render(); }
    });
}
