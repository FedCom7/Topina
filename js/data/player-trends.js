/**
 * Trends — chi sta salendo, chi sta calando, PERCHE', e cosa aspettarsi.
 *
 * Conti puri, niente DOM e niente rete: la pagina (`sections/player-trends.js`)
 * passa le giornate di Sleeper (`getWeekStats`) e il calendario della
 * stagione (`calendarioPerSquadra`), e riceve per ogni giocatore le due metà della stagione a confronto.
 *
 * Tre domande, tre blocchi:
 *
 * 1. QUANTO e' cambiato: punti a partita delle ultime N partite giocate contro
 *    quelli di prima. Partite del giocatore, non settimane: bye e assenze non
 *    contano.
 *
 * 2. PERCHE'. La differenza si divide in due pezzi che sommati la ridanno:
 *    - VOLUME: quanti punti valgono le sue occasioni (target, portate, lanci)
 *      al rendimento MEDIO del suo ruolo. Se sale, gli arrivano piu' palloni;
 *    - EFFICIENZA: quanto fa sopra o sotto quel valore medio — yard dopo la
 *      ricezione, giocate lunghe, e soprattutto touchdown.
 *    Accanto, le quote di squadra (target, portate, snap, air yards), che
 *    dicono da dove viene il volume, e il calendario AFFRONTATO: quanto
 *    concedevano al suo ruolo le difese incontrate nelle due metà.
 *
 * 3. COSA ASPETTARSI dalle prossime quattro giornate: un modello MISURATO, non
 *    scelto (vedi MODELLO).
 *
 * In piu', quanto e' "ballerino" il giocatore (vedi `assegnaFasce`): serve
 * soprattutto a dire se il cambio sta dentro le sue oscillazioni normali.
 */

import { LEAGUE_SCORING } from './scoring.js?v=592';
import { tassiLega, titolariDiLega, costanza } from './player-signals.js?v=4';

const S = LEAGUE_SCORING;
const n = (v) => (v == null || Number.isNaN(Number(v)) ? 0 : Number(v));

export const RUOLI_TREND = ['QB', 'RB', 'WR', 'TE'];

/**
 * La previsione delle prossime partite, tarata il 2026-11-20 su 10.036 casi:
 * stagioni 2022-2025, ogni giocatore con almeno 6 partite alla giornata t
 * (t = 5…13), confrontato con la media vera delle sue partite in t+1…t+4.
 *
 *   attesa = c + a·PPG stagione + b·PPG ultime 4 + d·xPPG stagione + e·xPPG ultime 4
 *
 * dove xPPG sono i punti che le sue occasioni valgono alla media del ruolo.
 * Quello che dicono i pesi, ed e' il motivo per cui la pagina e' fatta cosi':
 *  - i PUNTI delle ultime partite non contano quasi niente (b = 0,05): la
 *    media di stagione prevede meglio delle ultime quattro (errore 3,86 contro
 *    4,00 sul 2025, 4,16 contro 4,41 sul 2024);
 *  - il VOLUME delle ultime partite si' (e = 0,22): un cambio di ruolo dura,
 *    una striscia di efficienza o di TD no. Aggiungendo il volume l'errore
 *    scende a 3,77 (2025) e 4,11 (2024).
 * Validato fuori campione: stimato su tre stagioni, provato sulla quarta.
 *
 * `k` e' quanto pesa il calendario: attesa × (1 + k·(f − 1)), con f = quanto
 * concedono al ruolo le prossime avversarie rispetto alla media (1,2 = il 20%
 * in piu'). E' piccolo, e va detto: sui RB un calendario facile del 20% vale
 * +9%, sugli altri ruoli fra +2% e +4%. Sul 2024 aggiungere il calendario non
 * migliorava affatto la previsione, sul 2025 di poco. "Le partite sono piu'
 * facili" spiega molto meno di quanto si creda.
 *
 * Per rifare la taratura: il banco e' la stessa costruzione di `partite()` e
 * `concessioni()` su stagioni chiuse, a minimi quadrati. Se si toccano questi
 * numeri, si rilegge anche la nota a fondo pagina.
 */
export const MODELLO = {
    recenti: 4,
    c: 0.635, season: 0.495, recent: 0.046, xSeason: 0.163, xRecent: 0.224,
    k: { QB: 0.086, RB: 0.43, WR: 0.074, TE: 0.183 },
};

/**
 * Le partite di ogni giocatore, con le quote di squadra di quella giornata.
 *
 * `settimane`: array [settimana, Map] da getWeekStats. Le somme di squadra si
 * fanno sui giocatori che Sleeper restituisce (QB, RB, WR, TE, K, DEF): i
 * fullback mancano, e le quote risultano un filo piu' alte del vero — lo
 * stesso per tutti, quindi il confronto fra le due meta' non ne risente.
 */
export function partite(settimane) {
    const squadra = new Map();   // `${team}|${w}` → somme
    for (const [w, mappa] of settimane) {
        for (const v of mappa.values()) {
            if (!v.team) continue;
            const r = v.raw || {};
            const k = `${v.team}|${w}`;
            const t = squadra.get(k) || squadra.set(k, { tgt: 0, car: 0, air: 0 }).get(k);
            t.tgt += n(r.rec_tgt); t.car += n(r.rush_att); t.air += n(r.rec_air_yd);
        }
    }
    const out = new Map();
    for (const [w, mappa] of settimane) {
        for (const [k, v] of mappa) {
            if (!RUOLI_TREND.includes(v.pos)) continue;
            const r = v.raw || {};
            const sq = squadra.get(`${v.team}|${w}`) || { tgt: 0, car: 0, air: 0 };
            const g = {
                w, opp: v.opp, team: v.team, pts: n(v.ptsLeague),
                tgt: n(r.rec_tgt), car: n(r.rush_att), pa: n(r.pass_att),
                rec: n(r.rec), recYd: n(r.rec_yd), recTd: n(r.rec_td),
                rushYd: n(r.rush_yd), rushTd: n(r.rush_td),
                passYd: n(r.pass_yd), passTd: n(r.pass_td), int: n(r.pass_int),
                rzTgt: n(r.rec_rz_tgt), rzCar: n(r.rush_rz_att), rzPass: n(r.pass_rz_att),
                snp: n(r.off_snp), tmSnp: n(r.tm_off_snp), air: n(r.rec_air_yd),
                teamTgt: sq.tgt, teamCar: sq.car, teamAir: sq.air,
            };
            const p = out.get(k) || out.set(k, {
                key: k, name: v.name, pos: v.pos, playerId: v.playerId, team: v.team, games: [],
            }).get(k);
            p.games.push(g);
            p.team = v.team;   // l'ultima giornata: la squadra di oggi
        }
    }
    for (const p of out.values()) p.games.sort((a, b) => a.w - b.w);
    return out;
}

/**
 * Quanto concede ogni difesa a ciascun ruolo: punti di lega a partita, e il
 * fattore rispetto alla media delle 32 (1,15 = il 15% in piu'). Si conta dai
 * tabellini stessi, solo sulle giornate passate — lo stesso conto usato per
 * tarare `MODELLO.k`, che con un dato diverso non varrebbe.
 */
function concessioni(giocatori) {
    const somma = {};   // opp → pos → w → punti
    for (const p of giocatori.values()) {
        for (const g of p.games) {
            if (!g.opp) continue;
            const w = ((somma[g.opp] ||= {})[p.pos] ||= {});
            w[g.w] = (w[g.w] || 0) + g.pts;
        }
    }
    const fattore = {};
    for (const pos of RUOLI_TREND) {
        const medie = {};
        for (const [opp, perPos] of Object.entries(somma)) {
            const v = Object.values(perPos[pos] || {});
            if (v.length) medie[opp] = v.reduce((a, b) => a + b, 0) / v.length;
        }
        const tutte = Object.values(medie);
        const media = tutte.length ? tutte.reduce((a, b) => a + b, 0) / tutte.length : 0;
        fattore[pos] = { media, perSquadra: Object.fromEntries(Object.entries(medie).map(([o, v]) => [o, media ? v / media : 1])) };
    }
    return fattore;
}

/** I numeri di un gruppo di partite. */
function riassunto(games, pos, t, fattore) {
    const G = games.length;
    if (!G) return null;
    const sum = (f) => games.reduce((a, g) => a + f(g), 0);
    const quota = (a, b) => { const den = sum(b); return den > 0 ? sum(a) / den : null; };
    const qb = pos === 'QB';
    const xp = (g) => g.tgt * t.ptsPerTarget + g.car * t.ptsPerCarry + (qb ? g.pa * t.ptsPerPass : 0);
    const tdPts = (g) => (g.recTd + g.rushTd) * S.rec_td + (qb ? g.passTd * S.pass_td : 0);
    const xTdPts = (g) => g.rzTgt * t.tdPerRzTgt * S.rec_td + g.rzCar * t.tdPerRzCarry * S.rush_td
        + (qb ? g.rzPass * t.tdPerRzPass * S.pass_td : 0);
    const conSnap = games.filter(g => g.tmSnp > 0);
    const f = fattore?.perSquadra || {};
    return {
        g: G,
        ppg: sum(g => g.pts) / G,
        xppg: sum(xp) / G,
        occ: sum(g => g.tgt + g.car + (qb ? g.pa : 0)) / G,
        tgtPg: sum(g => g.tgt) / G,
        carPg: sum(g => g.car) / G,
        paPg: sum(g => g.pa) / G,
        rzPg: sum(g => g.rzTgt + g.rzCar + (qb ? g.rzPass : 0)) / G,
        tdPts: sum(tdPts) / G,
        xTdPts: sum(xTdPts) / G,
        tgtShare: quota(g => g.tgt, g => g.teamTgt),
        carShare: quota(g => g.car, g => g.teamCar),
        airShare: quota(g => Math.max(0, g.air), g => Math.max(0, g.teamAir)),
        snapShare: conSnap.length ? conSnap.reduce((a, g) => a + g.snp, 0) / conSnap.reduce((a, g) => a + g.tmSnp, 0) : null,
        // il calendario affrontato: media dei fattori delle difese incontrate
        sched: sum(g => f[g.opp] ?? 1) / G,
    };
}

/**
 * Il calendario di Sleeper (`/schedule/nfl/regular/{anno}`: una riga per
 * partita, { week, home, away, status }) girato per squadra:
 * Map(squadra → Map(settimana → { opp, home, giocata })).
 *
 * Non il file team_stats: quello porta solo le partite GIOCATE, e la
 * previsione e' proprio sulle altre. Le sigle sono quelle dei tabellini di
 * Sleeper, quindi combaciano con `team` e `opp` delle giornate senza alias.
 */
export function calendarioPerSquadra(partiteSleeper) {
    const out = new Map();
    const metti = (t, w, x) => (out.get(t) || out.set(t, new Map()).get(t)).set(w, x);
    for (const g of partiteSleeper || []) {
        if (!g?.home || !g?.away || !g.week) continue;
        const giocata = g.status === 'complete';
        metti(g.home, g.week, { opp: g.away, home: true, giocata });
        metti(g.away, g.week, { opp: g.home, home: false, giocata });
    }
    return out;
}

/**
 * Le prossime giornate della squadra, bye comprese: [{ w, opp, home, f }] o
 * [{ w, bye: true }].
 */
function prossime(calendario, team, daSettimana, fattore, quante = 4) {
    const cal = calendario?.get(team);
    if (!cal?.size || !daSettimana) return [];
    const ultima = Math.max(...cal.keys());
    const out = [];
    for (let w = daSettimana; w <= ultima && out.length < quante; w++) {
        const x = cal.get(w);
        if (!x) { out.push({ w, bye: true }); continue; }
        if (x.giocata) continue;   // gia' giocata (il Thursday Night): non e' "prossima"
        out.push({ w, opp: x.opp, home: x.home, f: fattore?.perSquadra?.[x.opp] ?? 1 });
    }
    return out;
}

/**
 * La soglia oltre cui un giocatore interessa alla lega: la media a partita del
 * giocatore numero 2×(titolari di quel ruolo). Titolari e panchina insieme,
 * cioe' chi puo' stare in una rosa. Sotto, un "+5 a partita" va da 2 a 7 punti
 * e non cambia la vita a nessuno.
 */
function soglie(giocatori, quanti = 2) {
    const out = {};
    for (const pos of RUOLI_TREND) {
        const medie = [...giocatori.values()].filter(p => p.pos === pos && p.games.length >= 3)
            .map(p => p.games.reduce((a, g) => a + g.pts, 0) / p.games.length)
            .sort((a, b) => b - a);
        const i = Math.min(medie.length, quanti * titolariDiLega(pos)) - 1;
        out[pos] = i >= 0 ? medie[i] : 0;
    }
    return out;
}

/**
 * Quanto balla il punteggio: lo scarto tipo delle partite attorno al LIVELLO
 * del giocatore, misurato dentro ciascuna delle due meta' (prima / ultime N) e
 * messo insieme. Sull'intera stagione un giocatore passato da 9 a 24 a partita
 * risulterebbe "ballerino" solo perche' ha cambiato livello: Pollard 2026 fa
 * ±10,8 sulla stagione, ±3,9 prima e ±10,6 adesso.
 *
 * La fascia (steady / normal / swingy) e' per terzi DENTRO il ruolo, su quello
 * scarto diviso la media di stagione, fra i giocatori da rosa (media di
 * stagione sopra la soglia): un QB da ±7 e' normale, un TE da ±7 no.
 *
 * Misurato il 2026-11-20 su 2022-2025 (giocatori da rosa, 12+ partite): la
 * costanza di META' stagione quasi non prevede quella dell'altra meta'
 * (partite pari contro dispari, scarto/media: correlazione −0,13 QB, 0,37 RB,
 * 0,06 WR, 0,10 TE; da una stagione alla successiva 0,00 / 0,11 / 0,24 / 0,20).
 * Quindi DESCRIVE la stagione, non promette niente: la pagina la usa
 * soprattutto per dire se un cambio di rendimento sta dentro le oscillazioni
 * normali del giocatore. Se si rifa' la misura, va riletta la nota a fondo pagina.
 */
function assegnaFasce(out, soglia) {
    for (const pos of RUOLI_TREND) {
        const del = out.filter(p => p.pos === pos && p.swing.cv != null && p.all.ppg >= soglia[pos]);
        const cv = del.map(p => p.swing.cv).sort((a, b) => a - b);
        if (cv.length < 3) continue;
        const basso = cv[Math.floor(cv.length / 3)], alto = cv[Math.floor(2 * cv.length / 3)];
        for (const p of out) {
            if (p.pos !== pos || p.swing.cv == null) continue;
            p.swing.fascia = p.swing.cv <= basso ? 'steady' : p.swing.cv >= alto ? 'swingy' : 'normal';
        }
    }
}

/** Scarto tipo campionario (n−1) e somma dei quadrati, per il confronto fra le due meta'. */
function dispersione(games) {
    const v = games.map(g => g.pts);
    const m = v.reduce((a, b) => a + b, 0) / v.length;
    return v.reduce((a, b) => a + (b - m) ** 2, 0);
}

/**
 * Lo scarto tipo DENTRO le due meta' messe insieme (varianza comune, n−2 gradi
 * di liberta'), e il cambio delle ultime N partite misurato in quelle
 * oscillazioni: la differenza delle medie diviso il suo errore, un t di
 * Student. Sotto 1, un salto cosi' capita per caso a un giocatore che balla
 * cosi'; sopra 2, no.
 */
function oscillazione(prima, ora, delta) {
    const gl = prima.length + ora.length - 2;
    if (gl < 1) return { sd: null, t: null };
    const sd = Math.sqrt((dispersione(prima) + dispersione(ora)) / gl);
    const err = sd * Math.sqrt(1 / prima.length + 1 / ora.length);
    return { sd, t: err > 0 ? delta / err : null };
}

/**
 * Il punto d'ingresso.
 *
 * `settimane`: [settimana, Map] delle giornate CHIUSE da considerare.
 * `calendario`: da `calendarioPerSquadra`.
 * `prossimaSettimana`: la prima giornata non ancora considerata, null a
 * stagione chiusa (niente previsione).
 * `recenti`: quante partite fanno "adesso".
 */
export function costruisciTrend({ settimane, calendario, prossimaSettimana = null, recenti = 4 }) {
    const giocatori = partite(settimane);
    const tassi = tassiLega(settimane.map(([, m]) => m));
    const fattore = concessioni(giocatori);
    const soglia = soglie(giocatori);
    const lineaTit = soglie(giocatori, 1);
    const out = [];
    for (const p of giocatori.values()) {
        const t = tassi[p.pos];
        // almeno due partite "prima": con una sola il confronto e' una partita contro un'altra
        if (!t || p.games.length < recenti + 2) continue;
        const prima = p.games.slice(0, -recenti), ora = p.games.slice(-recenti);
        const early = riassunto(prima, p.pos, t, fattore[p.pos]);
        const recent = riassunto(ora, p.pos, t, fattore[p.pos]);
        const all = riassunto(p.games, p.pos, t, fattore[p.pos]);
        const delta = recent.ppg - early.ppg;
        const volume = recent.xppg - early.xppg;
        const efficienza = delta - volume;
        const td = (recent.tdPts - early.tdPts) - (recent.xTdPts - early.xTdPts);

        // La previsione usa SEMPRE le ultime quattro, come la taratura, anche
        // quando a schermo la finestra e' un'altra.
        let outlook = null;
        if (prossimaSettimana) {
            const ult4 = riassunto(p.games.slice(-MODELLO.recenti), p.pos, t, fattore[p.pos]);
            const base = MODELLO.c + MODELLO.season * all.ppg + MODELLO.recent * ult4.ppg
                + MODELLO.xSeason * all.xppg + MODELLO.xRecent * ult4.xppg;
            const giornate = prossime(calendario, p.team, prossimaSettimana, fattore[p.pos]);
            const giocate = giornate.filter(x => !x.bye);
            const k = MODELLO.k[p.pos] ?? 0;
            const fCal = giocate.length ? giocate.reduce((a, x) => a + x.f, 0) / giocate.length : 1;
            const proj = base * (1 + k * (fCal - 1));
            outlook = { base, proj, fCal, k, giornate, calendarioPunti: proj - base };
        }
        // pavimento e tetto restano di stagione: sono "le sue partite", non un livello
        const c = costanza(p.games.map(g => g.pts));
        const osc = oscillazione(prima, ora, delta);
        const swing = {
            sd: osc.sd, t: osc.t, cv: osc.sd != null && all.ppg > 0 ? osc.sd / all.ppg : null, fascia: null,
            floor: c.p25, ceiling: c.p75,
            linea: lineaTit[p.pos],
            starts: p.games.filter(g => g.pts >= lineaTit[p.pos]).length,
            sdEarly: Math.sqrt(dispersione(prima) / Math.max(1, prima.length - 1)),
            sdRecent: Math.sqrt(dispersione(ora) / Math.max(1, ora.length - 1)),
        };
        out.push({
            ...p, early, recent, all, delta, volume, efficienza, td, outlook, swing,
            rilevante: Math.max(early.ppg, recent.ppg) >= soglia[p.pos],
        });
    }
    assegnaFasce(out, soglia);
    return { giocatori: out, soglia, fattore, lineaTit };
}
