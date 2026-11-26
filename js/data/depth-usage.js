/**
 * Depth Charts (#depth, sotto Players) — chi parte titolare in ogni squadra
 * NFL, chi e' infortunato e chi ne prende il posto, e come si dividono i
 * palloni partita per partita.
 *
 * Conti puri, niente DOM e niente rete. La pagina (`sections/depth-charts.js`)
 * passa quattro cose gia' scaricate:
 *
 *  - `depth`: i file `data/nfl/depth/{Y}_{TEAM}.json` (una foto del depth chart
 *    ESPN prima di ogni kickoff, da `build-nfl-depth.mjs`). La foto piu'
 *    recente e' "il depth chart di oggi"; quelle di regular season in fila
 *    sono la storia dei titolari;
 *  - `giocatori`: le partite di ogni giocatore con le somme di squadra di
 *    quella giornata, cioe' `partite()` di player-trends.js sui tabellini
 *    Sleeper. Le quote si contano da li', NON da team_stats: servono le
 *    stesse partite per numeratore e denominatore (vedi CLAUDE.md);
 *  - `infortuni`: `data/nfl/injuries_{Y}.json`. Per la stagione in corso
 *    vale il campo `espn` (il report di oggi); senza quello, lo stato della
 *    giornata piu' recente del file;
 *  - `calendario`: `calendarioPerSquadra()` di Sleeper, per prossima
 *    avversaria, bye, e per dare un numero di giornata alle foto del depth.
 *
 * Il depth chart e i tabellini parlano due lingue (id ESPN da una parte, nome
 * Sleeper dall'altra): si aggancia per NOME semplificato dentro la squadra, con
 * ripiego sul solo nome per chi ha cambiato maglia. I suffissi (Jr., III) si
 * tolgono: ESPN scrive "James Cook III", Sleeper "James Cook".
 */

/** Gli slot del depth chart che fanno la card, nell'ordine in cui si leggono. */
export const SLOT_CARD = [
    { id: 'QB', fonte: 'qb', idx: 0, pos: 'QB' },
    { id: 'RB1', fonte: 'rb', idx: 0, pos: 'RB' },
    { id: 'RB2', fonte: 'rb', idx: 1, pos: 'RB' },
    { id: 'WR1', fonte: 'wr1', idx: 0, pos: 'WR' },
    { id: 'WR2', fonte: 'wr2', idx: 0, pos: 'WR' },
    { id: 'WR3', fonte: 'wr3', idx: 0, pos: 'WR' },
    { id: 'TE', fonte: 'te', idx: 0, pos: 'TE' },
];

/** Gli stati che tolgono un giocatore dalla partita (Doubtful: quasi sempre). */
const FUORI = new Set(['OUT', 'IR', 'D', 'SUS', 'PUP']);

const n = (v) => (v == null || Number.isNaN(Number(v)) ? 0 : Number(v));

/** Il nome come chiave d'aggancio: minuscolo, senza punteggiatura ne' suffissi. */
export function chiaveNome(nome) {
    return String(nome || '').toLowerCase()
        .replace(/[.,'’]/g, '')
        .replace(/\s+(jr|sr|ii|iii|iv|v)$/, '')
        .replace(/\s+/g, ' ').trim();
}

/** Lo stato del report infortuni come sigla corta. */
export function siglaStato(s) {
    const t = String(s || '').toLowerCase();
    if (!t || t === 'active') return null;
    if (t.includes('injured reserve') || t === 'ir') return 'IR';
    if (t.startsWith('out')) return 'OUT';
    if (t.startsWith('doubt')) return 'D';
    if (t.startsWith('quest')) return 'Q';
    if (t.includes('suspend')) return 'SUS';
    if (t.includes('pup') || t.includes('physically')) return 'PUP';
    return null;
}

export const fuoriGioco = (sigla) => FUORI.has(sigla);

/**
 * Il report infortuni per squadra: Map(team → Map(chiaveNome → { sigla, cosa,
 * nota, rientro })). Stagione in corso: il campo `espn` (report di oggi), e
 * dove manca lo stato dell'ultima giornata del file. Stagione chiusa: niente —
 * "infortunato adesso" non ha senso su un campionato finito.
 */
export function indiceInfortuni(json, inCorso) {
    const out = new Map();
    if (!json?.teams || !inCorso) return out;
    let ultima = 0;
    for (const lista of Object.values(json.teams)) for (const p of lista) ultima = Math.max(ultima, n(p.week));
    for (const [team, lista] of Object.entries(json.teams)) {
        const m = new Map();
        for (const p of lista) {
            const e = p.espn;
            const sigla = e ? siglaStato(e.status) : (n(p.week) === ultima ? siglaStato(p.status) : null);
            if (!sigla) continue;
            m.set(chiaveNome(p.name), {
                sigla,
                cosa: e?.type || p.primaryInjury || null,
                nota: e?.comment && e.comment.length > 12 ? e.comment : null,
                rientro: e?.returnDate || null,
            });
        }
        out.set(team, m);
    }
    return out;
}

/**
 * Le foto del depth chart di una squadra in ordine di tempo: { id, dt, pre,
 * offense }. `pre` = preseason (le foto di agosto: servono solo se la stagione
 * non e' ancora cominciata).
 */
function foto(depthJson) {
    return Object.entries(depthJson?.games || {})
        .map(([id, g]) => {
            const d = new Date(g.dt);
            return { id, dt: g.dt, pre: d.getUTCMonth() < 8, offense: g.offense || {} };
        })
        .sort((a, b) => a.dt.localeCompare(b.dt));
}

/**
 * Tutto quello che serve per UNA squadra.
 *
 * @param {string} team   sigla canonica
 * @param {object} depthJson
 * @param {Map}    giocatori  da partite(): key → { name, pos, team, games[] }
 * @param {Map}    infortuni  Map(chiaveNome → info) della squadra
 * @param {Map}    cal        Map(settimana → { opp, home, giocata }) della squadra
 */
export function costruisciSquadra({ team, depthJson, giocatori, infortuni, cal, nomeSleeper }) {
    const nomi = depthJson?.names || {};
    const tutte = foto(depthJson);
    const regolari = tutte.filter(f => !f.pre);
    const oggi = (regolari.length ? regolari : tutte).at(-1) || null;

    // ---- partite della squadra, giocatore per giocatore (solo con QUESTA maglia)
    const perNome = new Map();       // chiaveNome → giocatore (con le sole partite qui)
    const settimane = new Map();     // w → { tgt, car, air, pa, snp, giocatori: [{key, ...g}] }
    for (const p of giocatori.values()) {
        const qui = p.games.filter(g => g.team === team);
        if (!qui.length) continue;
        const voce = { key: p.key, name: p.name, pos: p.pos, games: qui, partito: p.team !== team };
        perNome.set(chiaveNome(p.name), voce);
        for (const g of qui) {
            const s = settimane.get(g.w) || settimane.set(g.w, {
                w: g.w, opp: g.opp, tgt: g.teamTgt, car: g.teamCar, air: g.teamAir, tmSnp: 0, righe: [],
            }).get(g.w);
            s.tmSnp = Math.max(s.tmSnp, g.tmSnp || 0);
            s.righe.push({ key: p.key, name: p.name, pos: p.pos, g });
        }
    }
    const giornate = [...settimane.values()].sort((a, b) => a.w - b.w);

    // ---- le cifre di un giocatore: stagione, ultime 3, partita per partita
    const cifre = (v) => riepilogo(v, giornate);

    // ---- il nome a schermo: quello di Sleeper se c'e' (combacia con la pagina
    //      giocatore), se no quello del depth chart
    const voceDa = (espnId) => {
        const nome = nomi[espnId] || '';
        const k = chiaveNome(nome);
        const v = perNome.get(k) || null;
        const inf = infortuni?.get(k) || null;
        return {
            espnId, nome: v?.name || nomeSleeper?.(nome) || nome, nomeDepth: nome,
            pos: v?.pos || null, stat: v ? cifre(v) : null, inf,
            fuori: inf ? fuoriGioco(inf.sigla) : false,
        };
    };

    // ---- titolari di oggi, con chi prende il posto di chi e' fuori
    const off = oggi?.offense || {};
    const usati = new Set();
    for (const s of SLOT_CARD) { const id = (off[s.fonte] || [])[s.idx]; if (id) usati.add(id); }
    const titolari = SLOT_CARD.map(s => {
        const lista = off[s.fonte] || [];
        const id = lista[s.idx];
        if (!id) return { slot: s, p: null, sost: null, lista: [] };
        const p = voceDa(id);
        let sost = null;
        if (p.fuori) {
            // prima chi sta dietro nello stesso slot, poi negli slot fratelli
            // (un WR1 fuori lo rimpiazza spesso il WR2 del depth del WR1)
            const fratelli = s.pos === 'WR' ? ['wr1', 'wr2', 'wr3'] : [s.fonte];
            const candidati = [...lista.slice(s.idx + 1), ...fratelli.flatMap(f => (off[f] || []).slice(1))];
            for (const c of candidati) {
                if (usati.has(c)) continue;
                const v = voceDa(c);
                if (v.fuori) continue;
                sost = v; usati.add(c); break;
            }
        }
        return { slot: s, p, sost, lista: lista.map(voceDa) };
    });

    // ---- la storia dei titolari: una colonna per foto di regular season,
    //      col numero di giornata preso dal calendario (le partite giocate in
    //      ordine). Se il conto non torna, si ripiega sulla data.
    const giocate = cal ? [...cal.entries()].filter(([, x]) => x.giocata).map(([w]) => w).sort((a, b) => a - b) : [];
    const storia = regolari.map((f, i) => {
        const w = giocate.length === regolari.length ? giocate[i] : null;
        const slot = Object.fromEntries(SLOT_CARD.map(s => {
            const id = (f.offense[s.fonte] || [])[s.idx];
            return [s.id, id ? (nomi[id] || '') : ''];
        }));
        return { w, dt: f.dt, slot };
    });

    // ---- tutti i giocatori che hanno toccato palla qui, per la tabella
    const roster = [...perNome.values()]
        .map(v => ({ ...v, stat: cifre(v), inf: infortuni?.get(chiaveNome(v.name)) || null }))
        .filter(v => v.stat.tgt + v.stat.car + v.stat.pa > 0)
        .sort((a, b) => (b.stat.tgt + b.stat.car + b.stat.pa / 3) - (a.stat.tgt + a.stat.car + a.stat.pa / 3));

    // ---- prossima partita e bye
    let prossima = null;
    if (cal) {
        const future = [...cal.entries()].filter(([, x]) => !x.giocata).sort((a, b) => a[0] - b[0]);
        if (future.length) prossima = { w: future[0][0], ...future[0][1] };
    }
    const giocateW = new Set(giocate);
    const byeW = cal ? (() => {
        const tutteW = [...cal.keys()];
        const max = Math.max(0, ...tutteW);
        for (let w = 1; w <= max; w++) if (!cal.has(w)) return w;
        return null;
    })() : null;

    return {
        team, oggi: oggi ? { dt: oggi.dt, pre: oggi.pre } : null,
        titolari, storia, roster, giornate, prossima, bye: byeW,
        giocateN: giocateW.size || giornate.length,
    };
}

/**
 * Le cifre di un giocatore nelle partite giocate con la squadra: totali,
 * quote (sulle stesse partite), ultime 3 e la riga per ogni giornata.
 */
function riepilogo(v, giornate) {
    const G = v.games.length;
    const sum = (f, games = v.games) => games.reduce((a, g) => a + f(g), 0);
    const quota = (games, a, b) => { const den = sum(b, games); return den > 0 ? sum(a, games) / den : null; };
    const snapQ = (games) => {
        const c = games.filter(g => g.tmSnp > 0);
        return c.length ? sum(g => g.snp, c) / sum(g => g.tmSnp, c) : null;
    };
    const ult = v.games.slice(-3);
    const settimana = new Map(v.games.map(g => [g.w, g]));
    return {
        g: G,
        pts: sum(g => g.pts), ppg: G ? sum(g => g.pts) / G : 0,
        tgt: sum(g => g.tgt), rec: sum(g => g.rec), recYd: sum(g => g.recYd), recTd: sum(g => g.recTd),
        car: sum(g => g.car), rushYd: sum(g => g.rushYd), rushTd: sum(g => g.rushTd),
        pa: sum(g => g.pa), passYd: sum(g => g.passYd), passTd: sum(g => g.passTd), int: sum(g => g.int),
        rz: sum(g => g.rzTgt + g.rzCar), air: sum(g => g.air),
        tgtShare: quota(v.games, g => g.tgt, g => g.teamTgt),
        carShare: quota(v.games, g => g.car, g => g.teamCar),
        airShare: quota(v.games, g => Math.max(0, g.air), g => Math.max(0, g.teamAir)),
        snapShare: snapQ(v.games),
        recent: ult.length >= 2 && G > ult.length ? {
            g: ult.length,
            tgtShare: quota(ult, g => g.tgt, g => g.teamTgt),
            carShare: quota(ult, g => g.car, g => g.teamCar),
            snapShare: snapQ(ult),
            ppg: sum(g => g.pts, ult) / ult.length,
        } : null,
        // una riga per OGNI giornata della squadra: null dove lui non ha giocato
        perGiornata: giornate.map(s => {
            const g = settimana.get(s.w);
            if (!g) return { w: s.w, opp: s.opp, assente: true };
            return {
                w: g.w, opp: g.opp, pts: g.pts, tgt: g.tgt, rec: g.rec, recYd: g.recYd, recTd: g.recTd,
                car: g.car, rushYd: g.rushYd, rushTd: g.rushTd, pa: g.pa, passYd: g.passYd, passTd: g.passTd, int: g.int,
                tgtShare: g.teamTgt > 0 ? g.tgt / g.teamTgt : null,
                carShare: g.teamCar > 0 ? g.car / g.teamCar : null,
                snapShare: g.tmSnp > 0 ? g.snp / g.tmSnp : null,
            };
        }),
    };
}

/**
 * Le quote di squadra giornata per giornata, per il grafico a barre impilate:
 * i primi `k` giocatori per totale della stagione restano se stessi, il resto
 * va in "Other". L'ordine (e quindi il colore) e' quello della stagione, non
 * della singola giornata: il colore segue il giocatore, mai il suo rango.
 *
 * @param {'tgt'|'car'} campo
 */
export function quotePerGiornata(squadra, campo, k = 5) {
    const tot = new Map();
    for (const s of squadra.giornate) for (const r of s.righe) {
        const v = n(r.g[campo]);
        if (v) tot.set(r.key, { key: r.key, name: r.name, pos: r.pos, v: (tot.get(r.key)?.v || 0) + v });
    }
    const serie = [...tot.values()].sort((a, b) => b.v - a.v).slice(0, k);
    const chiavi = new Set(serie.map(s => s.key));
    const colonne = squadra.giornate.map(s => {
        const den = campo === 'tgt' ? s.tgt : s.car;
        const parti = serie.map(x => {
            const r = s.righe.find(rr => rr.key === x.key);
            const v = r ? n(r.g[campo]) : 0;
            return { key: x.key, v, q: den > 0 ? v / den : 0 };
        });
        const altro = s.righe.filter(r => !chiavi.has(r.key)).reduce((a, r) => a + n(r.g[campo]), 0);
        return { w: s.w, opp: s.opp, den, parti, altro: { v: altro, q: den > 0 ? altro / den : 0 } };
    });
    return { serie, colonne };
}
