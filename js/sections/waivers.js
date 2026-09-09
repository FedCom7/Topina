/**
 * Waivers — tutte le mosse di mercato di una stagione.
 *
 * Due fonti, e non sono intercambiabili:
 *
 *  1. **ESPN** (`fetchTransactions`) — le transazioni vere della lega: data e
 *     ora esatta, tipo dichiarato (waiver, free agent, trade), chi prende e chi
 *     cede. Esiste solo da quando la lega vive su ESPN, cioè dal 2026.
 *  2. **Le rose di Firebase** — per tutte le stagioni precedenti le transazioni
 *     non le ha registrate nessuno, ma il loro EFFETTO sì: un giocatore che
 *     nella settimana 5 non era in nessuna rosa e nella 6 è in quella di Sommo
 *     è stato preso da Sommo fra le due. È una ricostruzione, e la pagina lo
 *     dice: la settimana c'è, il giorno no.
 *
 * Si usa ESPN quando risponde con qualcosa, altrimenti la ricostruzione. Mai
 * le due insieme: sarebbero le stesse mosse contate due volte.
 *
 * Cosa NON si può usare: il feed attività di ESPN
 * (`/communication/?view=kona_league_communication`), quello che sul sito
 * mostra la cronologia in chiaro, risponde 401 senza i cookie di login.
 */

import { SEASONS_DESC, CURRENT_SEASON } from '../data.js?v=580';
import { TEAMS } from './team.js?v=709';
import { pickDropdownHTML, bindPickDropdown } from '../ui/dropdown-pick.js?v=1';
import { fetchTransactions, fetchPlayerNames, fantasyTeamName } from '../data/espn-fantasy.js?v=146';
import { buildSeasonModel, posBadge, headshotImg, hydrateImages, limitedRows, toggleExtraRows } from './analysis.js?v=775';

let initialized = false;
let currentYear = CURRENT_SEASON;
let currentTeam = 'all';
const VISIBILI = 40;

export function initWaivers() {
    if (initialized) return;
    initialized = true;
    renderPickRow();
    bindContent();
    load();
}

function renderPickRow() {
    const box = document.getElementById('wv-pick-row');
    if (!box) return;
    const teamItems = [
        { value: 'all', label: 'League' },
        ...Object.values(TEAMS).map(t => ({
            value: t.key, label: `<img src="${t.logo}" alt="" class="an-team-pill-logo">${t.name}`,
        })),
    ];
    const yearItems = SEASONS_DESC.map(y => ({ value: y, label: y }));
    box.innerHTML = pickDropdownHTML('team', teamItems, teamItems.findIndex(t => t.value === currentTeam))
        + pickDropdownHTML('year', yearItems, SEASONS_DESC.indexOf(String(currentYear)));
    bindPickDropdown(box, (id, value) => {
        if (id === 'year') currentYear = value;
        else if (id === 'team') currentTeam = value;
        renderPickRow();
        load();
    });
}

/* ============================================================
   FONTE 1 — le transazioni vere di ESPN
   ============================================================ */

// I tipi che ESPN dichiara sulla transazione. Quelli che non muovono un
// giocatore fra le rose (i cambi di formazione) non sono mosse di mercato e
// restano fuori: riempirebbero la pagina di rumore settimanale.
const TIPI = {
    WAIVER: 'Waiver',
    FREEAGENT: 'Free agent',
    TRADE_ACCEPT: 'Trade',
    TRADE: 'Trade',
    DRAFT: 'Draft',
};

/** Dal nome che mostra il sito alla chiave della squadra. */
const chiaveDaNome = (nome) =>
    Object.values(TEAMS).find(t => t.name === nome)?.key || nome || null;

/** Da una transazione ESPN alle righe da mostrare: una per giocatore mosso. */
function righeDaEspn(tx, nomi) {
    const tipo = TIPI[tx.type] || null;
    if (!tipo || tipo === 'Draft') return [];
    const quando = tx.proposedDate || tx.processDate || null;
    return (tx.items || [])
        .filter(it => it.type === 'ADD' || it.type === 'DROP')
        .map(it => {
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
            };
        });
}

/* ============================================================
   FONTE 2 — ricostruzione dalle rose settimanali
   ============================================================ */

/**
 * Chi è entrato e chi è uscito, settimana per settimana.
 *
 * Il criterio è il cambio di proprietà fra due settimane consecutive in cui il
 * giocatore compare. La prima settimana della stagione non conta come mossa:
 * quella è la rosa del draft, e chiamarla "acquisto" avrebbe messo in lista
 * tutti i 60 giocatori draftati.
 */
function righeDaRose(model) {
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

/* ============================================================
   DISEGNO
   ============================================================ */

const nomeSquadra = (chiave) => TEAMS[chiave]?.name || chiave || '—';
const logoSquadra = (chiave) => TEAMS[chiave]?.logo || null;

function dataBreve(iso) {
    if (!iso) return '';
    const d = new Date(Number(iso) || iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function riga(m) {
    const logo = logoSquadra(m.squadra);
    const dentro = m.verso === 'in';
    return `
    <div class="wv-row">
        <span class="wv-when">${m.settimana != null ? `W${m.settimana}` : ''}${m.data ? `<i>${dataBreve(m.data)}</i>` : ''}</span>
        <span class="wv-team">${logo ? `<img src="${logo}" alt="" class="an-team-pill-logo">` : ''}${nomeSquadra(m.squadra)}</span>
        <span class="wv-dir ${dentro ? 'wv-in' : 'wv-out'}">${dentro ? 'Added' : 'Dropped'}</span>
        ${headshotImg({ name: m.nome, position: m.pos, nflTeam: m.nfl }, 'an-headshot wv-photo')}
        <span class="an-player-name">${m.nome} ${m.pos ? posBadge(m.pos) : ''}${m.nfl ? ` <span class="ld-nfl">${m.nfl}</span>` : ''}</span>
        <span class="wv-kind">${m.tipo}${m.bid ? ` · $${m.bid}` : ''}</span>
    </div>`;
}

/** Più recente in alto: la settimana scende, e a parità l'ingresso prima dell'uscita. */
function ordina(lista) {
    return [...lista].sort((a, b) => {
        if (a.data && b.data && a.data !== b.data) return (Number(b.data) || 0) - (Number(a.data) || 0);
        const sa = a.settimana ?? -1, sb = b.settimana ?? -1;
        if (sa !== sb) return sb - sa;
        if (a.verso !== b.verso) return a.verso === 'in' ? -1 : 1;
        return String(a.nome).localeCompare(String(b.nome));
    });
}

let stato = null;   // { mosse, fonte }

async function load() {
    const wrap = document.getElementById('waivers-content');
    if (!wrap) return;
    wrap.innerHTML = `<div class="loading-state"><div class="spinner"></div><p>Loading moves...</p></div>`;
    const anno = currentYear;

    // ESPN prima: se ha le transazioni vere sono meglio di qualunque
    // ricostruzione, perché portano il giorno e il tipo dichiarato.
    let mosse = [], fonte = 'rose';
    try {
        const tx = await fetchTransactions(anno);
        if (tx.length) {
            const nomi = await fetchPlayerNames(anno).catch(() => new Map());
            mosse = tx.flatMap(t => righeDaEspn(t, nomi));
            if (mosse.length) fonte = 'espn';
        }
    } catch { /* stagione non su ESPN, o ESPN muta: si ripiega sulle rose */ }

    if (fonte !== 'espn') {
        const model = await buildSeasonModel(anno).catch(() => null);
        mosse = righeDaRose(model);
    }
    if (String(currentYear) !== String(anno)) return;   // anno cambiato nel frattempo

    stato = { mosse, fonte };
    render();
}

function render() {
    const wrap = document.getElementById('waivers-content');
    if (!wrap || !stato) return;

    const chiaveTeam = currentTeam === 'all' ? null : currentTeam;
    const lista = ordina(stato.mosse.filter(m => !chiaveTeam || m.squadra === chiaveTeam));

    if (!lista.length) {
        wrap.innerHTML = `
        <div class="empty-state">
            <p class="empty-state-text">No moves${chiaveTeam ? ` for ${nomeSquadra(chiaveTeam)}` : ''} in ${currentYear}</p>
            <p class="empty-state-sub">Rosters are still the ones from the draft.</p>
        </div>`;
        return;
    }

    const nota = stato.fonte === 'espn'
        ? `Every transaction of the season, straight from the league: date, type and the team that made it.`
        : `Reconstructed from the weekly rosters: for these seasons nobody recorded the transactions, but a player
           who is on a roster in one week and was not in the previous one was picked up in between. The week is
           exact, the day is not available — and a move that happened and was undone inside the same week leaves
           no trace.`;

    const inn = lista.filter(m => m.verso === 'in').length;
    wrap.innerHTML = `
    <div class="wv-kpis">
        <div class="pm-tile"><b>${lista.length}</b><span>moves</span></div>
        <div class="pm-tile"><b>${inn}</b><span>players added</span></div>
        <div class="pm-tile"><b>${lista.length - inn}</b><span>players dropped</span></div>
    </div>
    <div class="wv-list">${limitedRows(lista.map(riga), VISIBILI, 'waivers')}</div>
    <p class="an-footnote">${nota}</p>`;
    hydrateImages(wrap);
}

function bindContent() {
    const wrap = document.getElementById('waivers-content');
    if (!wrap) return;
    wrap.addEventListener('click', (e) => {
        const more = e.target.closest('[data-waivers-more]');
        if (!more) return;
        toggleExtraRows(more);
        const box = more.previousElementSibling;
        if (box && !box.hidden) hydrateImages(box);
    });
}
