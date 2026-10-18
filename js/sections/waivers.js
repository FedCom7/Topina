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

import { SEASONS_DESC, CURRENT_SEASON } from '../data.js?v=596';
import { TEAMS } from './team.js?v=865';
import { pickDropdownHTML, bindPickDropdown } from '../ui/dropdown-pick.js?v=1';
import { getWaiverMoves, ordina, accorpa } from '../data/waiver-moves.js?v=29';
import { posBadge, headshotImg, hydrateImages, limitedRows, toggleExtraRows } from './analysis.js?v=915';


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
 * Le righe come si guardano: una transazione e' UN riquadro, non N righe
 * sparse. Il raggruppamento (`accorpa`, in `data/waiver-moves.js`) lo usa
 * anche la home: perche' non si appaia uno a uno nelle stagioni ricostruite,
 * e perche' un `Move` fra allenatori resta separato da un giro di mercato
 * libero, e' spiegato li'.
 *
 * Il riquadro percio' non dice "Tizio ha preso il posto di Caio": dice "questa
 * squadra, questo momento, dentro questi e fuori questi". E' vero per
 * tutt'e due le fonti, e nel caso 1-1 si legge esattamente come una
 * sostituzione.
 */

/**
 * Le tre caselle di un giocatore: etichetta, foto, nome.
 *
 * `n` e' la riga interna del riquadro. Le caselle si incolonnano perche' ognuna
 * ha la sua colonna fissa nel CSS e la riga gliela scrive il markup: quante
 * righe servano lo sa solo lui, e cambia da una transazione all'altra.
 */
function chi(m, n, etichetta, classe, spento) {
    const g = `style="grid-row:${n}"`;
    const s = spento ? ' wv-l-out' : '';
    return `
        <span class="wv-dir ${classe}${s}" ${g}>${etichetta}</span>
        ${headshotImg({ name: m.nome, position: m.pos, nflTeam: m.nfl },
        `an-headshot wv-photo${s}`, g)}
        <span class="an-player-name${s}${spento ? ' wv-nome-out' : ''}" ${g}>${nomeLink(m)} ${
        m.pos ? posBadge(m.pos) : ''}${m.nfl ? ` <span class="ld-nfl">${m.nfl}</span>` : ''}</span>`;
}

const ordinale = (n) => {
    const r = n % 100;
    if (r >= 11 && r <= 13) return `${n}th`;
    return `${n}${{ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th'}`;
};

/** Il motivo di una richiesta fallita, e quando è un "già preso" anche da chi. */
function motivoFallita(t) {
    if (!t.presoDa) return t.motivo;
    return `${t.motivo} by ${nomeSquadra(t.presoDa.squadra)} (${ordinale(t.presoDa.ordine)})`;
}

/**
 * Una corsa di waiver è UNA card: tutte le richieste che ESPN ha elaborato
 * insieme il martedì, nell'ordine di elaborazione, staccate dalle altre mosse
 * della settimana (free agent, tagli) che le stavano accanto e si
 * confondevano. L'ordine si legge come sul Waiver Report di ESPN
 * ("Priority: 1st"). Le fallite restano, col motivo — un giocatore già preso
 * da un'altra squadra è la cosa che si vuole vedere.
 */
function corsaHTML(c) {
    const fallite = c.transazioni.filter(t => t.esito === 'fallita').length;
    const righe = c.transazioni.map(t => {
        const logo = logoSquadra(t.squadra);
        const ok = t.esito !== 'fallita';
        // Le caselle stanno nelle STESSE colonne di `.wv-row` (la lista fuori
        // dalla card): così etichetta, foto e nome cadono sulla stessa verticale
        // e la pagina non sembra fatta da due layout. Come lì, quante righe
        // servano lo sa il markup.
        const linee = ok
            ? t.righe.map(m => ({ m, etichetta: m.verso === 'in' ? 'Added' : 'Dropped',
                classe: m.verso === 'in' ? 'wv-in' : 'wv-out', spento: m.verso !== 'in' }))
            : t.righe.filter(m => m.verso === 'in')
                .map(m => ({ m, etichetta: 'Claimed', classe: 'wv-fail', spento: false }));
        const n = linee.length + (ok ? 0 : 1);
        const giocatori = linee.map((l, i) => chi(l.m, i + 1, l.etichetta, l.classe, l.spento)).join('');
        const motivo = ok ? ''
            : `<span class="wv-tx-esito wv-tx-esito--fallita" style="grid-row:${n}">${motivoFallita(t)}</span>`;
        return `
        <li class="wv-tx${ok ? '' : ' wv-tx--fallita'}" style="grid-template-rows: repeat(${n}, auto)">
            <span class="wv-tx-ord" title="Order in which the league processed this claim">${ordinale(t.ordine)}</span>
            <span class="wv-team">${logo
                ? `<img src="${logo}" alt="${escAttr(nomeSquadra(t.squadra))}" class="an-team-pill-logo">` : ''}<span
                class="wv-team-nome">${nomeSquadra(t.squadra)}</span></span>
            ${giocatori}
            ${motivo}
        </li>`;
    }).join('');
    return `
    <section class="wv-run">
        <header class="wv-run-head">
            <span class="wv-run-title">Waiver run</span>
            <span class="wv-when wv-when--run">${c.settimana != null ? `W${c.settimana}` : ''}${c.quando ? `<i>${dataBreve(c.quando)}</i>` : ''}</span>
            <span class="wv-run-count">${c.transazioni.length} claims${fallite ? ` · ${fallite} failed` : ''}</span>
        </header>
        <ol class="wv-run-list">${righe}</ol>
    </section>`;
}

/** Quando e chi: valgono per tutta la transazione, quindi stanno al centro. */
function intestazione(m) {
    const logo = logoSquadra(m.squadra);
    return `
        <span class="wv-when">${m.settimana != null ? `W${m.settimana}` : ''}${m.data ? `<i>${dataBreve(m.data)}</i>` : ''}</span>
        <span class="wv-team">${logo
            ? `<img src="${logo}" alt="${escAttr(nomeSquadra(m.squadra))}" class="an-team-pill-logo">` : ''}<span
            class="wv-team-nome">${nomeSquadra(m.squadra)}</span></span>`;
}

function riga(r) {
    const linee = [
        ...r.entrate.map(m => ({ m, etichetta: 'Added', classe: 'wv-in', spento: false })),
        ...r.uscite.map(m => ({ m, etichetta: 'Dropped', classe: 'wv-out', spento: true })),
    ];
    // Il tipo vale per il riquadro: lo dichiara la mossa in entrata, che e'
    // quella con un nome (waiver, free agent, trade); il taglio che la paga non
    // ne ha uno suo.
    const capo = r.entrate[0] || r.uscite[0];
    return `
    <div class="wv-row${linee.length > 1 ? ' wv-row--multi' : ''}"
        style="grid-template-rows: repeat(${linee.length}, auto)">
        ${intestazione(capo)}
        ${linee.map((l, i) => chi(l.m, i + 1, l.etichetta, l.classe, l.spento)).join('')}
        <span class="wv-kind">${capo.tipo}${capo.bid ? ` · $${capo.bid}` : ''}</span>
    </div>`;
}

let stato = null;   // { mosse, corse, fonte }

async function load() {
    const wrap = document.getElementById('waivers-content');
    if (!wrap) return;
    wrap.innerHTML = `<div class="loading-state"><div class="spinner"></div><p>Loading moves...</p></div>`;
    const anno = currentYear;

    // La scelta della fonte e la ricostruzione stanno in data/waiver-moves.js:
    // le usa anche la pagina squadra.
    const { mosse, corse, fonte } = await getWaiverMoves(anno);
    if (String(currentYear) !== String(anno)) return;   // anno cambiato nel frattempo

    stato = { mosse, corse, fonte };
    render();
}

function render() {
    const wrap = document.getElementById('waivers-content');
    if (!wrap || !stato) return;

    const chiaveTeam = currentTeam === 'all' ? null : currentTeam;
    const lista = ordina(stato.mosse.filter(m => !chiaveTeam || m.squadra === chiaveTeam));
    // Le corse restano solo con le richieste della squadra scelta; una corsa
    // senza nessuna sua richiesta non compare.
    const corse = stato.corse
        .map(c => ({ ...c, transazioni: c.transazioni.filter(t => !chiaveTeam || t.squadra === chiaveTeam) }))
        .filter(c => c.transazioni.length);
    const fallite = corse.reduce((n, c) => n + c.transazioni.filter(t => t.esito === 'fallita').length, 0);

    if (!lista.length && !corse.length) {
        wrap.innerHTML = `
        <div class="empty-state">
            <p class="empty-state-text">No moves${chiaveTeam ? ` for ${nomeSquadra(chiaveTeam)}` : ''} in ${currentYear}</p>
            <p class="empty-state-sub">Rosters are still the ones from the draft.</p>
        </div>`;
        return;
    }

    const nota = stato.fonte === 'espn'
        ? `Every transaction of the season, straight from the league: date, type and the team that made it.
           Waiver claims are shown one block per waiver run, in the order the league processed them. A claim
           that failed says why: "Already taken" means another team got the player earlier in the same run.`
        : `Reconstructed from the weekly rosters: for these seasons nobody recorded the transactions, but a player
           who is on a roster in one week and was not in the previous one was picked up in between. The week is
           exact, the day is not available — and a move that happened and was undone inside the same week leaves
           no trace. Free agent moves made by the same team in the same week are shown together, in one block:
           the rosters are weekly snapshots, so two separate trips to the wire inside one week cannot be told
           apart — and who took whose spot was never recorded, so it is not guessed here. Players traded between
           two teams keep a block of their own: that much the rosters do say.`;

    // Le richieste di waiver stanno nelle corse; il resto si raggruppa come prima.
    const fuoriCorsa = lista.filter(m => !m.corsa);
    const blocchi = [
        ...corse.map(c => ({ quando: c.quando, settimana: c.settimana ?? -1, html: corsaHTML(c) })),
        ...accorpa(fuoriCorsa).map(g => {
            const m = g.entrate[0] || g.uscite[0];
            return { quando: Number(m.data) || 0, settimana: m.settimana ?? -1, html: riga(g) };
        }),
    ].sort((a, b) => b.quando - a.quando || b.settimana - a.settimana);

    const inn = lista.filter(m => m.verso === 'in').length;
    wrap.innerHTML = `
    <div class="wv-kpis">
        <div class="pm-tile"><b>${lista.length}</b><span>moves</span></div>
        <div class="pm-tile"><b>${inn}</b><span>players added</span></div>
        <div class="pm-tile"><b>${lista.length - inn}</b><span>players dropped</span></div>
        <div class="pm-tile"><b>${fallite}</b><span>failed claims</span></div>
    </div>
    <div class="wv-list">${limitedRows(blocchi.map(b => b.html), VISIBILI, 'waivers')}</div>
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
