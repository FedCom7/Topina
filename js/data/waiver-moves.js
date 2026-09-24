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

import { fetchTransactions, fetchPlayerNames, fantasyTeamName } from './espn-fantasy.js?v=175';
import { TEAM_KEYS } from './team-config.js?v=535';
import { buildSeasonModel } from '../sections/analysis.js?v=845';

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
};

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
    // Le richieste di waiver perse restano nello storico con lo stato del
    // fallimento: non sono mosse avvenute.
    if (tx.status && tx.status !== 'EXECUTED') return [];
    const quando = tx.proposedDate || tx.processDate || null;

    const voce = (it) => {
        const p = nomi.get(String(it.playerId)) || {};
        const squadraId = it.type === 'ADD' ? (it.toTeamId ?? tx.teamId) : (it.fromTeamId ?? tx.teamId);
        return {
            settimana: tx.scoringPeriodId ?? null,
            data: quando,
            verso: it.type === 'ADD' ? 'in' : 'out',
            tipo,
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
 * Tutte le mosse di una stagione, già ordinate (più recente in alto).
 * @returns {Promise<{mosse: Array, fonte: 'espn'|'rose'}>}
 */
export async function getWaiverMoves(year) {
    // ESPN prima: se ha le transazioni vere sono meglio di qualunque
    // ricostruzione, perché portano il giorno e il tipo dichiarato.
    try {
        const tx = await fetchTransactions(year);
        if (tx.length) {
            const nomi = await fetchPlayerNames(year).catch(() => new Map());
            const mosse = tx.flatMap(t => righeDaEspn(t, nomi));
            if (mosse.length) return { mosse: ordina(mosse), fonte: 'espn' };
        }
    } catch { /* stagione non su ESPN, o ESPN muta: si ripiega sulle rose */ }

    const model = await buildSeasonModel(year).catch(() => null);
    return { mosse: ordina(righeDaRose(model)), fonte: 'rose' };
}
