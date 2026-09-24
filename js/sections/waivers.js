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
 * Le due fonti (transazioni ESPN dal 2026, ricostruzione dalle rose Firebase
 * per prima) e la scelta fra loro stanno in `js/data/waiver-moves.js`: da lì
 * le legge anche la pagina squadra. Qui resta il disegno.
 *
 * Cosa NON si può usare: il feed attività di ESPN
 * (`/communication/?view=kona_league_communication`), quello che sul sito
 * mostra la cronologia in chiaro, risponde 401 senza i cookie di login.
 */

import { SEASONS_DESC, CURRENT_SEASON } from '../data.js?v=594';
import { TEAMS } from './team.js?v=838';
import { pickDropdownHTML, bindPickDropdown } from '../ui/dropdown-pick.js?v=1';
import { getWaiverMoves, ordina } from '../data/waiver-moves.js?v=18';
import { posBadge, headshotImg, hydrateImages, limitedRows, toggleExtraRows } from './analysis.js?v=872';

/** I nomi arrivano da ESPN: si scrivono nel markup, quindi si ripuliscono. */
const escAttr = (v) => String(v ?? '').replace(/[&<>"]/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

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

// Tipi di transazione e lettura delle fonti: in data/waiver-moves.js.

/* ============================================================
   FONTE 2 — ricostruzione dalle rose settimanali
   ============================================================ */

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

/**
 * Il nome porta alla scheda del giocatore, dove si vedono i punti che ha
 * fatto giornata per giornata: e' la domanda che viene subito dopo "chi ha
 * preso chi" — ne valeva la pena?
 *
 * Serve il ruolo per la rotta (`#player/anno/ruolo/nome`). Un giocatore che
 * ESPN non ha saputo risolvere arriva come "#12345" senza ruolo: quello resta
 * testo, un link lo porterebbe a una scheda vuota.
 */
function nomeLink(m) {
    const testo = `<span class="wv-n-full">${m.nome}</span><span class="wv-n-corto">${nomeCorto(m.nome)}</span>`;
    if (!m.pos || String(m.nome).startsWith('#')) return testo;
    const href = `#player/${currentYear}/${encodeURIComponent(m.pos)}/${encodeURIComponent(m.nome)}`;
    return `<a class="wv-player-link" href="${href}">${testo}</a>`;
}

/**
 * Il nome come si scrive sul telefono: iniziale e cognome.
 *
 * Li' la colonna del nome e' larga meno della meta', e un nome intero andava a
 * capo su due righe — con lo scambio, le due meta' della transazione non erano
 * piu' incolonnate. Chi ha un nome solo (le difese) resta com'e', e il suffisso
 * se lo tiene: "Travis Etienne Jr." diventa "T. Etienne Jr.".
 */
function nomeCorto(nome) {
    const parti = String(nome ?? '').trim().split(/\s+/);
    if (parti.length < 2 || !parti[0]) return nome;
    return `${parti[0][0]}. ${parti.slice(1).join(' ')}`;
}

/**
 * Le righe come si guardano: uno scambio e' UNA mossa, non due.
 *
 * ESPN scrive l'acquisto e il taglio che lo paga nella stessa transazione
 * (stesso `tx`): qui le due righe si riuniscono, prima chi esce e poi chi
 * entra, che e' l'ordine in cui la mossa e' stata pensata. Chi non ha un
 * compagno — un acquisto a rosa libera, un taglio secco — resta una riga da
 * solo.
 */
function accorpa(lista) {
    const perTx = new Map();
    const fuori = [];
    for (const m of lista) {
        if (!m.tx || !m.scambio) { fuori.push({ singola: m }); continue; }
        const g = perTx.get(m.tx) || {};
        g[m.verso] = m;
        perTx.set(m.tx, g);
    }
    for (const g of perTx.values()) {
        if (g.in && g.out) fuori.push({ esce: g.out, entra: g.in });
        else fuori.push({ singola: g.in || g.out });
    }
    // l'ordine resta quello di `ordina`: si usa la riga piu' recente del gruppo
    const quando = (r) => {
        const m = r.singola || r.entra || r.esce;
        return [Number(m.data) || 0, m.settimana ?? -1];
    };
    return fuori.sort((a, b) => quando(b)[0] - quando(a)[0] || quando(b)[1] - quando(a)[1]);
}

/**
 * Le tre caselle di un giocatore nella riga: etichetta, foto, nome.
 *
 * `riga` dice in quale delle due righe interne vanno (`r1` chi entra, `r2` chi
 * esce): le caselle si incolonnano da sole perche' sono nelle stesse colonne
 * della griglia, una sopra l'altra.
 */
function chi(m, riga, etichetta, classe, spento = false) {
    return `
        <span class="wv-dir ${classe} ${riga}">${etichetta}</span>
        ${headshotImg({ name: m.nome, position: m.pos, nflTeam: m.nfl }, `an-headshot wv-photo ${riga}`)}
        <span class="an-player-name ${riga}${spento ? ' wv-nome-out' : ''}">${nomeLink(m)} ${
        m.pos ? posBadge(m.pos) : ''}${m.nfl ? ` <span class="ld-nfl">${m.nfl}</span>` : ''}</span>`;
}

/** Quando e chi: valgono per tutta la transazione, quindi stanno al centro. */
function intestazione(m) {
    const logo = logoSquadra(m.squadra);
    return `
        <span class="wv-when">${m.settimana != null ? `W${m.settimana}` : ''}${m.data ? `<i>${dataBreve(m.data)}</i>` : ''}</span>
        <span class="wv-team">${logo ? `<img src="${logo}" alt="" class="an-team-pill-logo">` : ''}${nomeSquadra(m.squadra)}</span>`;
}

function riga(r) {
    if (r.singola) {
        const m = r.singola;
        const dentro = m.verso === 'in';
        return `
        <div class="wv-row">
            ${intestazione(m)}
            ${chi(m, 'wv-r1', dentro ? 'Added' : 'Dropped', dentro ? 'wv-in' : 'wv-out', !dentro)}
            <span class="wv-kind">${m.tipo}${m.bid ? ` · $${m.bid}` : ''}</span>
        </div>`;
    }

    // Una transazione sola, due righe dentro lo stesso riquadro: sopra chi
    // arriva, sotto chi lascia. Data, squadra e tipo valgono per tutt'e due e
    // stanno in mezzo alle due righe.
    const { esce, entra } = r;
    return `
    <div class="wv-row wv-row--swap">
        ${intestazione(entra)}
        ${chi(entra, 'wv-r1', 'Added', 'wv-in')}
        ${chi(esce, 'wv-r2', 'Dropped', 'wv-out', true)}
        <span class="wv-kind">${entra.tipo}${entra.bid ? ` · $${entra.bid}` : ''}</span>
    </div>`;
}

let stato = null;   // { mosse, fonte }

async function load() {
    const wrap = document.getElementById('waivers-content');
    if (!wrap) return;
    wrap.innerHTML = `<div class="loading-state"><div class="spinner"></div><p>Loading moves...</p></div>`;
    const anno = currentYear;

    // La scelta della fonte e la ricostruzione stanno in data/waiver-moves.js:
    // le usa anche la pagina squadra.
    const { mosse, fonte } = await getWaiverMoves(anno);
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
    <div class="wv-list">${limitedRows(accorpa(lista).map(riga), VISIBILI, 'waivers')}</div>
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
