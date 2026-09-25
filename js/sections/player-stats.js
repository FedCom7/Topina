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

import { SEASONS_DESC, CURRENT_SEASON } from '../data.js?v=594';
import { getSeasonStats } from '../data/projections.js?v=629';
import { getAdvancedPlayers } from '../data/context-score.js?v=683';
import { getTeamStats } from '../data/nfl-team-stats.js?v=856';
import { teamLogoUrl } from '../data/player-search-core.js?v=623';
import { canonAbbr } from '../data/nfl-schedule.js?v=552';
import { pickDropdownHTML, bindPickDropdown } from '../ui/dropdown-pick.js?v=1';
import { sottoTitolo, apriInfo, registraInfo, headshotImg, hydrateImages } from './analysis.js?v=894';

const RUOLI = ['QB', 'RB', 'WR', 'TE'];

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
const FILTRI = [TUTTI, ...RUOLI, COMBO];
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
let ruolo = 'WR';
let ordine = { key: 'fp', dir: -1 };
let tutte = false;
let soloQualificati = true;
let ruoloSquadre = ruolo;
let stato = null;   // { righe, secPerSnap, snapsPg, maxGp }

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
        regola: 'Gold marks the best value in each column among the players shown; for turnovers, drops and sacks the best is the lowest. "Qualified only" hides whoever played less than a quarter of the snaps of the busiest player at the position.',
    },
    'ps-depth': {
        cosa: 'The number one at a position on every NFL team, lined up against each other.',
        base: 'The "1" is the role, not the result: the QB with the most pass attempts, the RB with the most carries plus targets, the WR and TE with the most targets.',
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
const div = (a, b) => (a != null && b ? a / b : null);
const somma = (...v) => (v.some(x => x != null) ? v.reduce((s, x) => s + (x || 0), 0) : null);

/** Una riga per giocatore: box score di Sleeper + avanzate nflverse + le derivate. */
function riga(e, adv) {
    const r = e.raw || {};
    const pos = e.pos;
    const snaps = num(e.snaps ?? r.off_snp);
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
    const fp = num(e.ptsLeague);

    // Quanto lo cerca l'attacco quando e' in campo: per i ricevitori i target,
    // per i RB portate + target. Per i QB e' ~1 per tutti (ogni snap passa da
    // lui) e non distinguerebbe nessuno: al suo posto la profondita' dei lanci.
    const coinvolto = pos === 'QB' ? div(passAirYd, passAtt)
        : pos === 'RB' ? div(somma(rushAtt, tgt), snaps)
            : div(tgt, snaps);

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
        brokenTk: num(pos === 'RB' ? adv?.rushBrokenTk : adv?.recBrokenTk),
        // derivate delle frequenze
        td, yds,
        snapsPerTd: td ? div(snaps, td) : null,
        ydsPerSnap: div(yds, snaps),
        fpPer60: fp != null && snaps ? (fp / snaps) * 60 : null,
        coinvolto,
        // portate + target per snap, per tutti: l'unica misura di coinvolgimento
        // che mette un RB e un WR sulla stessa scala
        tocchi: div(somma(rushAtt, tgt), snaps),
        // lo scrimmage (corse + ricezioni) anche per i QB: e' il terreno comune
        // quando nella stessa carta ci sono tutti i ruoli
        snapsPerTdScrim: somma(rushTd, recTd) ? div(snaps, somma(rushTd, recTd)) : null,
        ydsScrim: somma(rushYd, recYd),
        ydsScrimPerSnap: div(somma(rushYd, recYd), snaps),
    };
}

async function carica(y) {
    const [stats, adv, team] = await Promise.all([
        getSeasonStats(y).catch(() => null),
        getAdvancedPlayers(y).catch(() => []),
        getTeamStats(y).catch(() => null),
    ]);
    if (!stats) return null;

    const advPerId = new Map((adv || []).map(a => [String(a.sleeper), a]));
    const righe = [];
    for (const e of stats.values()) {
        if (!RUOLI.includes(e.pos)) continue;
        if (!(e.gp > 0)) continue;
        righe.push(riga(e, advPerId.get(String(e.playerId)) || null));
    }

    const snapsPg = Object.values(team?.teams || {})
        .map(t => t.offense?.snapsPg).filter(v => v > 0);
    const media = snapsPg.length
        ? snapsPg.reduce((a, b) => a + b, 0) / snapsPg.length
        : SNAP_PER_PARTITA_DEFAULT;

    return {
        righe,
        snapsPg: media,
        secPerSnap: 1800 / media,
        maxGp: Math.max(0, ...righe.map(r => r.gp)),
    };
}

/** Chi ha abbastanza snap perche' un suo rapporto voglia dire qualcosa. */
function qualificati(filtro) {
    // Ogni ruolo contro il SUO piu' usato: col filtro RB/WR un RB titolare fa
    // meno snap di un WR titolare, e una soglia unica taglierebbe fuori i RB.
    return posDi(filtro).flatMap(pos => {
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
            r => `<b>${due(r[chiaveYds])}</b><small>${intero(tutti ? r.ydsScrim : r.yds)} yds</small>`)}
        ${carta('ps-rate-fp', 'Points per full game on the field', fp, 'fpPer60', r => `<b>${uno(r.fpPer60)}</b><small>per 60 snaps</small>`)}
        ${carta('ps-rate-inv', titoloInv, inv, chiaveInv, r => `<b>${fmtInv(r[chiaveInv])}</b><small>${ruolo === 'QB' ? 'air yds / att' : `${intero(r.snaps)} snaps`}</small>`)}
    </div>
    ${tutti ? `<p class="an-footnote">All positions: touchdowns and yards here are from scrimmage — runs and catches —
       for everyone, QBs included. With passing in, every list would be eight quarterbacks. Fantasy points stay whole:
       they are the one currency every position shares.</p>` : ''}`;
}

/**
 * Una carta: otto righe, e una barra per riga che si legge contro la prima.
 * `inverso`: nella carta dei TD vince il numero PIU' BASSO, quindi la barra
 * piena va al primo e si accorcia scendendo — se no il migliore avrebbe la
 * barra piu' corta di tutte.
 */
function carta(id, titolo, righe, chiave, valore, vuoto = 'No qualified players yet.', inverso = false) {
    if (!righe.length) {
        return `<div class="ps-rate-card">${sottoTitolo(id, titolo)}<p class="an-footnote">${vuoto}</p></div>`;
    }
    const valori = righe.map(r => r[chiave]);
    const lung = (v) => {
        if (inverso) return (Math.min(...valori) / v) * 100;
        return (v / Math.max(...valori)) * 100;
    };
    return `
    <div class="ps-rate-card">
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
                <span class="ps-rate-bar" aria-hidden="true"><i style="width:${lung(r[chiave]).toFixed(1)}%"></i></span>
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
};

function ogniSquadra() {
    const pos = ruoloSquadre;
    const perSquadra = new Map();
    const totTgt = new Map(), totRush = new Map();
    for (const r of stato.righe) {
        if (!r.team) continue;
        totTgt.set(r.team, (totTgt.get(r.team) || 0) + (r.tgt || 0));
        totRush.set(r.team, (totRush.get(r.team) || 0) + (r.rushAtt || 0));
        if (r.pos !== pos) continue;
        const gia = perSquadra.get(r.team);
        if (!gia || VOLUME[pos](r) > VOLUME[pos](gia)) perSquadra.set(r.team, r);
    }

    const lista = [...perSquadra.values()]
        .filter(r => VOLUME[pos](r) > 0 && r.fpg != null)
        .sort((a, b) => b.fpg - a.fpg);
    if (!lista.length) return `${sottoTitolo('ps-depth', `Every team's ${pos}1`)}<p class="an-footnote">No data yet.</p>`;

    const max = lista[0].fpg;
    const media = lista.reduce((s, r) => s + r.fpg, 0) / lista.length;

    // Quanto del volume della squadra prende lui: e' la domanda che il ranking
    // per punti non dice — un WR1 con il 30% dei target e uno col 18% sono due
    // attacchi diversi.
    const quota = (r) => (pos === 'WR' || pos === 'TE') ? div(r.tgt, totTgt.get(r.team))
        : pos === 'RB' ? div(r.rushAtt, totRush.get(r.team)) : null;
    const riassunto = (r) => pos === 'QB'
        ? `${intero(r.passYd)} yds · ${intero(r.passTd)} TD · ${intero(r.passInt)} INT · ${uno(r.ypa)} Y/A`
        : pos === 'RB'
            ? `${intero(r.rushAtt)} car · ${intero(r.rushYd)} yds · ${intero(r.tgt)} tgt · ${intero(somma(r.rushTd, r.recTd))} TD`
            : `${intero(r.tgt)} tgt · ${intero(r.rec)} rec · ${intero(r.recYd)} yds · ${intero(r.recTd)} TD`;

    const pill = (p) => `<button class="an-avg-pill${ruoloSquadre === p ? ' active' : ''}" data-ps-depth="${p}">${p}1</button>`;
    return `
    ${sottoTitolo('ps-depth', `Every team's ${pos}1`)}
    <div class="an-avg-toggle">${RUOLI.map(pill).join('')}</div>
    <p class="an-footnote">${lista.length} teams, ranked by fantasy points per game. League average for a ${pos}1:
       <b>${uno(media)}</b> per game.</p>
    <ol class="ps-depth" style="--ps-media:${((media / max) * 100).toFixed(1)}%">
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
            <span class="ps-depth-bar" aria-hidden="true"><i style="width:${((r.fpg / max) * 100).toFixed(1)}%"></i></span>
            <span class="ps-depth-val">${uno(r.fpg)}</span>
        </li>`;
        }).join('')}
    </ol>`;
}

/* ============================================================
   PAGINA
   ============================================================ */

function renderPickRow() {
    const box = document.getElementById('ps-pick-row');
    if (!box) return;
    const anni = SEASONS_DESC.map(y => ({ value: y, label: y }));
    box.innerHTML = pickDropdownHTML('year', anni, SEASONS_DESC.indexOf(String(anno)));
    bindPickDropdown(box, (id, value) => {
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

    wrap.innerHTML = `
    <div class="an-avg-toggle ps-pos-bar">${FILTRI.map(pill).join('')}</div>
    ${poche ? `<p class="an-footnote ps-sample">${anno} · ${stato.maxGp} game${stato.maxGp === 1 ? '' : 's'} played so far:
        every rate on this page is built on a small sample, and will move a lot week to week.</p>` : ''}
    <section class="ps-block">${carteFrequenze()}</section>
    <section class="ps-block">${bigBoard()}</section>
    <section class="ps-block" id="ps-depth-wrap">${ogniSquadra()}</section>`;
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

        const dep = e.target.closest('[data-ps-depth]');
        if (dep) {
            ruoloSquadre = dep.dataset.psDepth;
            const box = document.getElementById('ps-depth-wrap');
            if (box) { box.innerHTML = ogniSquadra(); hydrateImages(box); }
        }
    });
}
