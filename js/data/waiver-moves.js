/**
 * Le mosse di mercato di una stagione — chi è entrato e chi è uscito.
 *
 * Due fonti, e non sono intercambiabili:
 *
 *  1. **ESPN** (`fetchTransactions`) — le transazioni vere della lega: data e
 *     ora esatta, tipo dichiarato (waiver, free agent, trade), chi prende e chi
 *     cede. Esiste solo da quando la lega vive su ESPN, cioè dal 2026.
 *  2. **Le rose di Firebase** — per tutte le stagioni precedenti le transazioni
 *     non le ha registrate nessuno, ma il loro EFFETTO sì: un giocatore che
 *     nella settimana 5 non era in nessuna rosa e nella 6 è in quella di Sommo
 *     è stato preso da Sommo fra le due. È una ricostruzione, e chi la mostra
 *     lo dice: la settimana c'è, il giorno no.
 *
 * Si usa ESPN quando risponde con qualcosa, altrimenti la ricostruzione. Mai
 * le due insieme: sarebbero le stesse mosse contate due volte.
 *
 * Cosa NON si può usare: il feed attività di ESPN
 * (`/communication/?view=kona_league_communication`), quello che sul sito
 * mostra la cronologia in chiaro, risponde 401 senza i cookie di login.
 *
 * Il calcolo stava dentro `sections/waivers.js`. Vive qui da quando lo usa
 * anche la pagina squadra: una sezione non può importarne un'altra senza
 * rischiare un anello (waivers.js legge TEAMS da team.js, cioè dalla pagina
 * squadra), e soprattutto la stessa ricostruzione fatta in due posti diverge.
 */

import { fetchTransactions, fetchPlayerNames, fantasyTeamName } from './espn-fantasy.js?v=178';
import { TEAM_KEYS } from './team-config.js?v=538';
import { fetchFantasyData, displayName } from '../data.js?v=595';
import { buildSeasonModel } from '../sections/analysis.js?v=906';

// I tipi che ESPN dichiara sulla transazione. Quelli che non muovono un
// giocatore fra le rose (i cambi di formazione) non sono mosse di mercato e
// restano fuori: riempirebbero la pagina di rumore settimanale.
// Stavano in sections/waivers.js e il trasloco li aveva lasciati la': senza,
// `righeDaEspn` lanciava a ogni transazione, il catch di getWaiverMoves
// ingoiava l'errore e si ripiegava sulle rose — pagina vuota in week 1.
const TIPI = {
    WAIVER: 'Waiver',
    FREEAGENT: 'Free agent',
    TRADE_ACCEPT: 'Trade',
    TRADE: 'Trade',
    DRAFT: 'Draft',
    // Un taglio SENZA presa: ESPN lo registra come ROSTER, lo stesso tipo dei
    // cambi di formazione (quelli hanno solo voci LINEUP e qui sotto si
    // perdono da soli). Waddle, tagliato da Capi il 28/09/2026 senza prendere
    // nessuno, dalla pagina mancava per questo.
    ROSTER: 'Drop',
};

/*
 * Perché una richiesta di waiver è fallita, dalla parola che ESPN mette nello
 * stato. `INVALIDPLAYERSOURCE` è il giocatore già preso da un'altra squadra
 * nella stessa corsa: il caso "un giocatore era già stato preso".
 */
const MOTIVI_FALLITA = {
    FAILED_INVALIDPLAYERSOURCE: 'Already taken',
    FAILED_PLAYERALREADYDROPPED: 'Already dropped',
    FAILED_ROSTERLIMIT: 'Roster full',
};

/*
 * Una richiesta di waiver è di UNA corsa del martedì: tutte quelle che ESPN
 * elabora insieme hanno lo stesso `proposedDate`, e la settimana le separa
 * dalle corse precedenti. Le richieste ritirate prima della corsa (CANCELED)
 * non sono mai avvenute né fallite: restano fuori.
 */
const corsaDi = (tx) => `${tx.scoringPeriodId ?? ''}|${tx.proposedDate ?? ''}`;

/** Dal nome che mostra il sito alla chiave della squadra (da team-config: team.js sarebbe un anello). */
const chiaveDaNome = (nome) => TEAM_KEYS[nome] || nome || null;

/**
 * Da una transazione ESPN alle righe da mostrare: una per giocatore mosso.
 *
 * Chi ha preso il posto di chi non va indovinato: ESPN mette l'acquisto e il
 * taglio che lo paga nella STESSA transazione. Appiattendo gli `items` in
 * righe separate quel legame si perdeva, e una giornata con tre entrate e tre
 * uscite diventava sei mosse scollegate. Qui ogni riga si porta dietro il suo
 * compagno in `scambio`.
 *
 * Quando in una transazione ci sono piu' entrate e piu' uscite — capita di
 * rado, e mai nel nostro storico — si accoppiano nell'ordine in cui ESPN le
 * scrive; chi resta senza compagno non ne ha uno, e non se ne inventa.
 */
export function righeDaEspn(tx, nomi) {
    const tipo = TIPI[tx.type] || null;
    if (!tipo || tipo === 'Draft') return [];
    // Una richiesta di waiver persa resta, col motivo: nella corsa si vede che
    // un giocatore era già stato preso. Le altre richieste perse (ritirate,
    // ecc.) non sono mosse avvenute e restano fuori.
    const fallita = !!tx.status && tx.status !== 'EXECUTED';
    if (fallita && !(tx.type === 'WAIVER' && tx.status.startsWith('FAILED_'))) return [];
    // La data di una corsa di waiver è quella in cui ESPN la elabora: il
    // `proposedDate` è l'inizio della corsa, uguale per tutte le richieste.
    const quando = (tx.type === 'WAIVER' ? tx.processDate : null) || tx.proposedDate || tx.processDate || null;
    const esito = fallita ? 'fallita' : 'ok';
    const motivo = fallita ? (MOTIVI_FALLITA[tx.status] || 'Failed') : null;

    const voce = (it) => {
        const p = nomi.get(String(it.playerId)) || {};
        const squadraId = it.type === 'ADD' ? (it.toTeamId ?? tx.teamId) : (it.fromTeamId ?? tx.teamId);
        return {
            settimana: tx.scoringPeriodId ?? null,
            data: quando,
            verso: it.type === 'ADD' ? 'in' : 'out',
            tipo,
            esito,
            motivo,
            corsa: tx.type === 'WAIVER' ? corsaDi(tx) : null,
            // ESPN da' il suo teamId: qui dentro le squadre viaggiano
            // sempre con la CHIAVE Topina, o logo e filtro non
            // funzionerebbero sulle righe che arrivano da li'.
            squadra: chiaveDaNome(fantasyTeamName(squadraId)),
            nome: p.name || `#${it.playerId}`,
            pos: p.pos || '',
            nfl: p.nfl || '',
            bid: tx.bidAmount || null,
            // id della transazione: due righe con lo stesso id sono la stessa
            // mossa vista dai due lati, e la pagina le riunisce in una riga
            tx: tx.id != null ? String(tx.id) : null,
            scambio: null,
        };
    };

    const mosse = (tx.items || []).filter(it => it.type === 'ADD' || it.type === 'DROP');
    const entrati = mosse.filter(it => it.type === 'ADD').map(voce);
    const usciti = mosse.filter(it => it.type === 'DROP').map(voce);

    for (let i = 0; i < Math.min(entrati.length, usciti.length); i++) {
        const a = entrati[i], b = usciti[i];
        // solo il minimo per scriverlo accanto: nome e ruolo dell'altro
        a.scambio = { nome: b.nome, pos: b.pos, nfl: b.nfl, verso: 'out' };
        b.scambio = { nome: a.nome, pos: a.pos, nfl: a.nfl, verso: 'in' };
    }

    return [...entrati, ...usciti];
}

/**
 * Chi è entrato e chi è uscito, settimana per settimana.
 *
 * Il criterio è il cambio di proprietà fra due settimane consecutive in cui il
 * giocatore compare. La prima settimana della stagione non conta come mossa:
 * quella è la rosa del draft, e chiamarla "acquisto" avrebbe messo in lista
 * tutti i 60 giocatori draftati.
 */
export function righeDaRose(model) {
    if (!model) return [];
    const prima = Math.min(...Object.values(model.teamWeeks)
        .flatMap(w => Object.keys(w).map(Number)).filter(Number.isFinite));
    const fuori = [];

    for (const rec of model.players.values()) {
        const settimane = Object.keys(rec.weeks).map(Number).sort((a, b) => a - b);
        let precedente = null, ultimaVista = null;
        for (const w of settimane) {
            const squadra = rec.weeks[w].teamKey;
            const base = { nome: rec.name, pos: rec.position, nfl: rec.nflTeam, data: null, bid: null };
            // Sparito per una o più giornate e ricomparso altrove: in mezzo è
            // stato tagliato, e il taglio va segnato dove è successo.
            if (precedente && ultimaVista != null && w > ultimaVista + 1) {
                fuori.push({ ...base, settimana: ultimaVista + 1, verso: 'out', tipo: 'Drop', squadra: precedente });
                precedente = null;
            }
            if (squadra !== precedente) {
                if (precedente) {
                    fuori.push({ ...base, settimana: w, verso: 'out', tipo: 'Move', squadra: precedente });
                }
                if (!(precedente === null && w === prima)) {
                    fuori.push({ ...base, settimana: w, verso: 'in', tipo: precedente ? 'Move' : 'Pickup', squadra });
                }
                precedente = squadra;
            }
            ultimaVista = w;
        }
        // Uscito e mai più rientrato prima della fine: è un taglio anche questo.
        if (precedente && ultimaVista != null && ultimaVista < model.lastWeek) {
            fuori.push({ nome: rec.name, pos: rec.position, nfl: rec.nflTeam, data: null, bid: null,
                settimana: ultimaVista + 1, verso: 'out', tipo: 'Drop', squadra: precedente });
        }
    }
    return fuori;
}

/** Più recente in alto: la settimana scende, e a parità l'ingresso prima dell'uscita. */
export function ordina(lista) {
    return [...lista].sort((a, b) => {
        if (a.data && b.data && a.data !== b.data) return (Number(b.data) || 0) - (Number(a.data) || 0);
        const sa = a.settimana ?? -1, sb = b.settimana ?? -1;
        if (sa !== sb) return sb - sa;
        if (a.verso !== b.verso) return a.verso === 'in' ? -1 : 1;
        return String(a.nome).localeCompare(String(b.nome));
    });
}

/**
 * Le righe raggruppate come le guarda chi legge: una transazione è UN
 * riquadro, non N righe sparse. Cosa tiene insieme le righe dipende dalla
 * fonte — vedi la spiegazione lunga in `sections/waivers.js`, che di questo
 * raggruppamento è la prima cliente:
 *
 *  - **ESPN** dà l'id della transazione (`m.tx`): l'acquisto e il taglio che
 *    lo paga sono la stessa mossa.
 *  - **La ricostruzione dalle rose** non ha un id: l'unità è la SETTIMANA
 *    della squadra, tenendo separati i cambi di formazione fra allenatori
 *    (`Move`) dal giro di mercato libero (`famiglia`).
 *
 * Vive qui, non in sections/waivers.js, perché la usa anche la home
 * (`sections/home.js`): una sezione non può importarne un'altra senza
 * rischiare un anello, e la stessa mossa raggruppata in due modi diversi in
 * due posti mostrerebbe due riquadri diversi per la stessa transazione.
 */
const famiglia = (m) => (m.tipo === 'Move' ? 'mv' : 'wire');

/** @returns {Array<{entrate: Array, uscite: Array}>} più recente in alto. */
export function accorpa(lista) {
    const gruppi = new Map();
    for (const m of lista) {
        const chiave = m.tx ? `tx:${m.tx}` : `wk:${m.squadra}|${m.settimana}|${famiglia(m)}`;
        const g = gruppi.get(chiave) || { entrate: [], uscite: [] };
        g[m.verso === 'in' ? 'entrate' : 'uscite'].push(m);
        gruppi.set(chiave, g);
    }
    // l'ordine resta quello di `ordina`: si usa la riga piu' recente del gruppo
    const quando = (r) => {
        const m = r.entrate[0] || r.uscite[0];
        return [Number(m.data) || 0, m.settimana ?? -1];
    };
    return [...gruppi.values()]
        .sort((a, b) => quando(b)[0] - quando(a)[0] || quando(b)[1] - quando(a)[1]);
}

/**
 * La priorità di waiver di ogni squadra a una certa settimana: la classifica
 * ROVESCIATA (l'ultimo ha la prima scelta), con la classifica che c'era prima
 * di quella giornata. Il Map dà a ogni chiave squadra la sua posizione, 0 = per
 * prima.
 *
 * Gli spareggi non sono quelli del sito. `processStandings` ordina a pari
 * vittorie per punti fatti; ESPN guarda prima lo scontro diretto. Il 30/09/2026
 * Oscurus, Sommo e Capi erano tutte 2-1: per punti Capi sarebbe l'ultima, ma
 * ESPN ha dato la prima scelta a Sommo, cioè ha messo Capi sopra. Qui si prova
 * lo scontro diretto fra le due squadre e poi i punti fatti: nei giri che si
 * conoscono torna, ma in un pareggio a tre con scontri incrociati è una stima.
 */
export function prioritaDaRisultati(fantasyData, settimana) {
    const sq = new Map();
    const scheda = (n) => {
        if (!sq.has(n)) sq.set(n, { n, w: 0, pf: 0, h2h: new Map() });
        return sq.get(n);
    };
    for (let w = 1; w < settimana; w++) {
        for (const m of fantasyData?.weeks?.[String(w)]?.matchups || []) {
            if (!m.team1 || !m.team2) continue;
            const s1 = parseFloat(m.team1.score) || 0, s2 = parseFloat(m.team2.score) || 0;
            const a = scheda(displayName(m.team1.name)), b = scheda(displayName(m.team2.name));
            if (s1 <= 0 && s2 <= 0) continue;   // partita senza dati: non c'è
            a.pf += s1; b.pf += s2;
            if (s1 > s2) { a.w++; a.h2h.set(b.n, (a.h2h.get(b.n) || 0) + 1); }
            else if (s2 > s1) { b.w++; b.h2h.set(a.n, (b.h2h.get(a.n) || 0) + 1); }
        }
    }
    const tutte = [...sq.values()];
    // Migliore per primo, come ESPN: vittorie, poi lo scontro diretto fra le due
    // squadre, poi i punti fatti. Il confronto a coppie non è un ordine
    // coerente quando tre squadre si battono in cerchio, e lì il risultato
    // dipende da come si parte: si parte dall'ordine dei team id di ESPN.
    tutte.sort((x, y) => y.w - x.w
        || (y.h2h.get(x.n) || 0) - (x.h2h.get(y.n) || 0)
        || y.pf - x.pf);
    // poi si rovescia: l'ultimo in classifica ha la prima scelta
    tutte.reverse();
    return new Map(tutte.map((t, i) => [chiaveDaNome(t.n), i]));
}

/**
 * Le corse di waiver, con dentro tutte le richieste nell'ordine in cui ESPN le
 * ha elaborate — anche quelle fallite, che è il punto di tenerle.
 *
 * L'ordine NON si legge dai dati: `processDate` è in millisecondi ma fra
 * squadre diverse non è affidabile (il 30/09/2026 la fallita di Capi ha un
 * millisecondo più alto della sua richiesta riuscita, ma ESPN la mostra prima).
 * Si ricostruisce con la regola delle waiver a turni, confrontata col Waiver
 * Report di ESPN su due corse (23/09 e 30/09):
 *
 *  - ogni squadra ha una lista di preferenze; si va in ordine di priorità, e a
 *    ogni giro la squadra applica la prima che riesce;
 *  - una richiesta fallita non consuma il turno: la squadra la prova subito
 *    prima della prossima riuscita. Compare quindi nel primo turno utile dopo
 *    la richiesta che l'ha fatta fallire (il giocatore preso, o tagliato, da
 *    un'altra richiesta);
 *  - dentro una squadra l'ordine delle riuscite è quello del `processDate`,
 *    che lì invece regge; a pari millisecondo vale l'ordine di arrivo.
 *
 * L'ordine di preferenza di una fallita non è nei dati, e questa è l'ipotesi
 * più semplice che spiega i due Waiver Report visti: se in una corsa futura
 * ESPN mostra un ordine diverso, è qui che si corregge.
 *
 * Le squadre vanno nell'ordine del loro primo `processDate`; a pari millisecondo
 * decide `priorita(settimana)`, la mappa squadra → posizione
 * (`prioritaDaRisultati`). Senza, vale l'ordine di arrivo.
 *
 * @returns {Array<{chiave: string, settimana: number|null, quando: number,
 *   transazioni: Array<{id, ordine, quando, esito, motivo, squadra, righe, presoDa?}>}>}
 *   più recente in alto.
 */
export function corseDaEspn(perTx, priorita = () => null) {
    const corse = new Map();
    for (const { tx, righe } of perTx) {
        if (tx.type !== 'WAIVER' || !righe.length) continue;
        const chiave = corsaDi(tx);
        const c = corse.get(chiave) || { chiave, settimana: tx.scoringPeriodId ?? null, transazioni: [] };
        const capo = righe[0];
        c.transazioni.push({
            id: String(tx.id),
            quando: Number(tx.processDate) || Number(tx.proposedDate) || 0,
            esito: capo.esito,
            motivo: capo.motivo,
            squadra: capo.squadra,
            bid: capo.bid,
            righe,
            arrivo: c.transazioni.length,
        });
        corse.set(chiave, c);
    }

    for (const c of corse.values()) {
        const tutte = c.transazioni;
        const riuscite = tutte.filter(t => t.esito === 'ok');
        const nomeIn = (t) => t.righe.find(r => r.verso === 'in')?.nome;

        // Chi ha fatto fallire ogni fallita: la richiesta riuscita che ha preso
        // (o tagliato) il giocatore. Per "rosa piena" non c'è un colpevole
        // preciso: arriva dopo le riuscite della sua squadra.
        for (const f of tutte) {
            if (f.esito !== 'fallita') continue;
            if (f.motivo === MOTIVI_FALLITA.FAILED_INVALIDPLAYERSOURCE) {
                f.blocca = riuscite.find(t => nomeIn(t) === nomeIn(f)) || null;
            } else if (f.motivo === MOTIVI_FALLITA.FAILED_PLAYERALREADYDROPPED) {
                const tagliato = f.righe.find(r => r.verso === 'out')?.nome;
                f.blocca = riuscite.find(t => t.righe.some(r => r.verso === 'out' && r.nome === tagliato)) || null;
            } else {
                f.blocca = [...riuscite].reverse().find(t => t.squadra === f.squadra) || null;
            }
        }

        // L'ordine delle squadre: dal primo millisecondo di ciascuna, che nelle due
        // corse confrontate con ESPN coincide con la sua priorità. La classifica
        // (`priorita`) decide solo a pari millisecondo: da sola non basta, perché
        // con tre squadre pari e scontri incrociati il suo ordine è una stima.
        const pri = priorita(c.settimana);
        const primoMs = (s) => Math.min(...riuscite.filter(t => t.squadra === s).map(t => t.quando), Infinity);
        const squadre = [...new Set(tutte.map(t => t.squadra))]
            .sort((x, y) => primoMs(x) - primoMs(y)
                || (pri?.get?.(x) ?? 99) - (pri?.get?.(y) ?? 99)
                || tutte.findIndex(t => t.squadra === x) - tutte.findIndex(t => t.squadra === y));
        const coda = new Map(squadre.map(s => [s, riuscite.filter(t => t.squadra === s)
            .sort((a, b) => a.quando - b.quando || a.arrivo - b.arrivo)]));
        const attese = new Map(squadre.map(s => [s, tutte.filter(t => t.squadra === s && t.esito === 'fallita')]));

        const fatte = new Set();
        const ordine = [];
        const emetti = (t) => { fatte.add(t); ordine.push(t); };
        let resta = tutte.length;
        while (resta > 0) {
            const prima = ordine.length;
            for (const s of squadre) {
                // le fallite pronte si provano prima della prossima riuscita
                for (const f of [...attese.get(s)]) {
                    if (!f.blocca || fatte.has(f.blocca)) {
                        attese.get(s).splice(attese.get(s).indexOf(f), 1);
                        emetti(f);
                    }
                }
                const prossima = coda.get(s).shift();
                if (prossima) emetti(prossima);
            }
            resta = tutte.length - ordine.length;
            if (ordine.length === prima) {   // non succede: se un legame è circolare, chiude per arrivo
                tutte.filter(t => !fatte.has(t)).sort((a, b) => a.arrivo - b.arrivo).forEach(emetti);
                break;
            }
        }
        ordine.forEach((t, i) => { t.ordine = i + 1; });
        c.transazioni = ordine;

        // "già preso": da chi, e con quale richiesta
        for (const f of ordine) {
            if (f.esito === 'fallita' && f.motivo === MOTIVI_FALLITA.FAILED_INVALIDPLAYERSOURCE && f.blocca) {
                f.presoDa = { squadra: f.blocca.squadra, ordine: f.blocca.ordine };
            }
        }
        c.quando = Math.min(...ordine.map(t => t.quando));
    }
    return [...corse.values()].sort((a, b) => (b.settimana ?? -1) - (a.settimana ?? -1));
}

/**
 * Tutte le mosse di una stagione, già ordinate (più recente in alto).
 *
 * `mosse` sono solo le mosse avvenute: chi ne ha bisogno per contare o per
 * elencare (pagina squadra, conteggi) non vede le fallite. `corse` contiene
 * le corse di waiver con anche le richieste fallite, per la vista a blocco.
 * @returns {Promise<{mosse: Array, corse: Array, fonte: 'espn'|'rose'}>}
 */
export async function getWaiverMoves(year) {
    // ESPN prima: se ha le transazioni vere sono meglio di qualunque
    // ricostruzione, perché portano il giorno e il tipo dichiarato.
    try {
        const tx = await fetchTransactions(year);
        if (tx.length) {
            const nomi = await fetchPlayerNames(year).catch(() => new Map());
            const perTx = tx.map(t => ({ tx: t, righe: righeDaEspn(t, nomi) })).filter(x => x.righe.length);
            const mosse = perTx.flatMap(x => x.righe).filter(r => r.esito === 'ok');
            if (mosse.length) {
                // la priorità serve solo a spezzare le parità: se i risultati non
                // arrivano, la corsa si ordina comunque (per ordine di arrivo)
                const fd = await fetchFantasyData(year).catch(() => null);
                const cache = new Map();
                const priorita = (w) => {
                    if (!cache.has(w)) cache.set(w, fd ? prioritaDaRisultati(fd, w) : null);
                    return cache.get(w);
                };
                return { mosse: ordina(mosse), corse: corseDaEspn(perTx, priorita), fonte: 'espn' };
            }
        }
    } catch { /* stagione non su ESPN, o ESPN muta: si ripiega sulle rose */ }

    const model = await buildSeasonModel(year).catch(() => null);
    return { mosse: ordina(righeDaRose(model)), corse: [], fonte: 'rose' };
}
