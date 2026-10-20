/**
 * Flip card a tutto schermo, nella struttura "classica" del programma di gara
 * cartaceo (due facciate): a sinistra e destra le rose numeriche complete
 * delle due squadre, in mezzo i sei pannelli attacco/difesa/specialisti sulla
 * prima facciata e le due rose complete con misure sulla seconda. Si apre
 * cliccando la barra con le info della partita (`data-fc-open` in
 * `nfl-team-page.js`, che passa lo stesso oggetto `card` già scaricato da
 * `nfl-flip-card.js` — nessuna richiesta di rete in più).
 *
 * Modulo di sole RESE (nessun accesso a `nfl-team-page.js`, nemmeno per le
 * piccole funzioni di riga): un giro d'import a due direzioni fra i due file
 * è esattamente la fragilità già presa in giro il 2026-09-27 (vedi il
 * commento su `flipLoad`), quindi qui le righe si ridisegnano in proprio
 * invece di importarle da lì. Le classi CSS (`fc-row`, `fc-p`, `fc-p--rk`…)
 * restano le stesse della vista in pagina apposta: rookie sottolineato e
 * practice squad in corsivo sono LA convenzione della card stampata, non va
 * duplicata due volte con nomi diversi.
 */

import { esc, teamLogo } from '../sections/player-page.js?v=1088';
import { getTeamIdentity } from '../data/nfl-teams.js?v=513';

/** Filetto di squadra: uguale a `flipTeamColor` di nfl-team-page.js, duplicato
 *  di proposito (vedi commento in testa al file). */
function teamColor(identity) {
    const hex = identity?.color || '';
    const m = /^#?([0-9a-f]{6})$/i.exec(hex);
    if (!m) return identity?.color2 || '#888';
    const n = parseInt(m[1], 16);
    const lum = (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
    return lum < 0.12 ? (identity.color2 || '#888') : hex;
}

const teamNick = (abbr) => (getTeamIdentity(abbr)?.name || abbr || '').split(' ').pop();

const SUFFIXES = new Set(['Jr.', 'Jr', 'Sr.', 'Sr', 'II', 'III', 'IV', 'V']);

/** Cognome (con suffisso) e nome per il formato "Cognome, Nome" della seconda
 *  facciata — il suffisso resta ATTACCATO al cognome prima della virgola
 *  ("Byard III, Kevin"), com'è stampato davvero. */
function splitName(full) {
    const parts = String(full || '').trim().split(/\s+/);
    if (parts.length < 2) return { first: '', last: full || '', key: (full || '').toLowerCase() };
    let cut = parts.length - 1;
    if (SUFFIXES.has(parts[cut]) && parts.length > 2) cut -= 1;
    return { first: parts.slice(0, cut).join(' '), last: parts.slice(cut).join(' '), key: parts[cut].toLowerCase() };
}

const byJersey = (a, b) => (a.jersey ?? 999) - (b.jersey ?? 999);
const byAlpha = (a, b) => splitName(a.name).key.localeCompare(splitName(b.name).key) || byJersey(a, b);

/** Una riga di rosa nella colonna esterna: numero, nome, posizione — nient'altro. */
function outerLine(p, alpha) {
    const cls = ['fcp-oline', p.rookie ? 'fc-p--rk' : '', p.practice ? 'fc-p--ps' : ''].filter(Boolean).join(' ');
    const nome = alpha ? (() => { const { first, last } = splitName(p.name); return first ? `${last}, ${first}` : last; })() : (p.name || '—');
    return `<div class="${cls}"><b>${p.jersey ?? '—'}</b><span>${esc(nome)}</span><i>${esc(p.pos || '')}</i></div>`;
}

/** Colonna esterna completa di una squadra: rosa principale + gruppo isolato
 *  in fondo (practice squad a partita da giocare, inattivi a partita fatta —
 *  la card `played` non ha una practice squad separata, per costruzione). */
function outerColumn(lato, mode, alpha) {
    const id = getTeamIdentity(lato.abbr);
    const secondo = mode === 'played'
        ? { list: lato.inactives, label: 'Inactives' }
        : { list: lato.practice, label: 'Practice Squad' };
    const ord = alpha ? byAlpha : byJersey;
    const main = [...(lato.roster || [])].sort(ord);
    const sec = [...(secondo.list || [])].sort(ord);
    return `
    <aside class="fcp-outer">
        <h2 class="fcp-col-team" style="--fcp-team:${teamColor(id)}">${esc(teamNick(lato.abbr))}</h2>
        <div class="fcp-col-hd"><span>#</span><span>Name</span><span>Pos</span></div>
        <div class="fcp-col-list">${main.map(p => outerLine(p, alpha)).join('')}</div>
        ${sec.length ? `
        <div class="fcp-col-sec">${esc(secondo.label)}</div>
        <div class="fcp-col-list">${sec.map(p => outerLine(p, alpha)).join('')}</div>` : ''}
    </aside>`;
}

/** Riga di uno slot nei sei pannelli centrali — stessa forma di `flipRow` in
 *  nfl-team-page.js (stessa scelta di classi, vedi commento in testa). */
function panelRow(row, mode) {
    const players = row.players.map((p, i) => {
        const titolare = mode === 'played' ? !!p.starter : i === 0;
        const cls = ['fc-p', titolare ? 'fc-p--s' : '', p.rookie ? 'fc-p--rk' : '', p.practice ? 'fc-p--ps' : '', p.inactive ? 'fc-p--out' : ''].filter(Boolean).join(' ');
        return `<span class="${cls}">${p.jersey != null ? `<b>${p.jersey}</b> ` : ''}${esc(p.name)}</span>`;
    }).join('');
    return `<div class="fc-row"><span class="fc-pos">${esc(row.pos || '')}</span><span class="fc-names">${players}</span></div>`;
}

/** Uno dei sei pannelli (attacco/difesa/specialisti di una squadra). */
function depthPanel(lato, key, label, mode, chi) {
    const rows = lato.units?.[key] || [];
    if (!rows.length) return '<div class="fcp-depth fcp-depth--empty"></div>';
    return `
    <div class="fcp-depth" data-zoom="${chi}:${key}" role="button" tabindex="0" aria-label="${esc(teamNick(lato.abbr))} ${label}: open full screen">
        <h4 class="fcp-depth-title" style="--fcp-team:${teamColor(getTeamIdentity(lato.abbr))}">${esc(teamNick(lato.abbr))} ${label}</h4>
        <div class="fc-rows">${rows.map(r => panelRow(r, mode)).join('')}</div>
    </div>`;
}

/** Intestazione centrale: le due squadre, l'orario, lo stadio — versione
 *  grande per la facciata stampata (la barra cliccabile resta quella piccola
 *  in pagina, questa è solo per la vista a tutto schermo). */
function gameInfoBlock(card) {
    const squadra = (lato) => {
        const id = getTeamIdentity(lato.abbr);
        return `<div class="fcp-team">
            <img src="${teamLogo(lato.abbr)}" alt="">
            <div>
                <b style="--fcp-team:${teamColor(id)}">${esc(id?.name || lato.abbr)}</b>
                <small>${[lato.record, lato.coach].filter(Boolean).map(esc).join(' · ')}</small>
            </div>
            ${lato.score != null ? `<span class="fcp-score">${esc(String(lato.score))}</span>` : ''}
        </div>`;
    };
    const d = card.date ? new Date(card.date) : null;
    const quando = d
        ? `${d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })} · ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`
        : '';
    const dove = [card.venue, card.city].filter(Boolean).join(' · ');
    return `
    <header class="fcp-gameinfo">
        ${squadra(card.away)}
        <div class="fcp-gameinfo-mid">
            <span class="fcp-at">@</span>
            <b>${esc(card.week || '')}</b>
            ${quando ? `<span>${esc(quando)}</span>` : ''}
            ${dove ? `<span>${esc(dove)}</span>` : ''}
            <span>${[card.status, card.broadcast, card.attendance ? `${card.attendance.toLocaleString('en-US')} att.` : ''].filter(Boolean).map(esc).join(' · ')}</span>
        </div>
        ${squadra(card.home)}
    </header>`;
}

/** Arbitri al centro, pronunce ai lati — le pronunce non hanno nessuna fonte
 *  gratuita affidabile (ESPN e nflverse non le pubblicano): lo spazio resta,
 *  dichiarato vuoto invece di sparire o di inventare una trascrizione. */
function officialsRow(card, mia, sua) {
    const pron = (lato) => `
        <div class="fcp-pron">
            <h5>${esc(teamNick(lato.abbr))} pronunciations</h5>
            <p class="fcp-note">Not available — no free data source publishes name pronunciations.</p>
        </div>`;
    const officials = card.officials?.length
        ? `<ul class="fcp-officials-list">${card.officials.map(o => `<li><span>${esc(o.role || '')}</span><b>${esc(o.name)}</b></li>`).join('')}</ul>`
        : `<p class="fcp-note">Officials are published by the league only from game day.</p>`;
    return `
    <div class="fcp-foot3">
        ${pron(mia)}
        <div class="fcp-officials"><h5>Today's officials</h5>${officials}</div>
        ${pron(sua)}
    </div>`;
}

/** Facciata 1: rose per numero fuori, sei pannelli attacco/difesa/specialisti
 *  in mezzo, arbitri e pronunce in fondo. */
function page1Html(card, mia, sua) {
    return `
    <div class="fcp-cols3">
        ${outerColumn(mia, card.mode, false)}
        <div class="fcp-mid">
            ${gameInfoBlock(card)}
            <div class="fcp-depthgrid">
                ${depthPanel(mia, 'offense', 'Offense', card.mode, 'mia')}
                ${depthPanel(mia, 'defense', 'Defense', card.mode, 'mia')}
                ${depthPanel(sua, 'offense', 'Offense', card.mode, 'sua')}
                ${depthPanel(sua, 'defense', 'Defense', card.mode, 'sua')}
                ${depthPanel(mia, 'special', 'Specialists', card.mode, 'mia')}
                ${depthPanel(sua, 'special', 'Specialists', card.mode, 'sua')}
            </div>
            <p class="fcp-legend">NOTE: Rookies are <u>underlined</u>, ${card.depthDay
                ? 'game-day depth chart: starters in <b>bold</b>, players who did not dress are <s>struck through</s>.'
                : 'Practice Squad players are <i>italicized</i>.'}</p>
            ${officialsRow(card, mia, sua)}
        </div>
        ${outerColumn(sua, card.mode, false)}
    </div>`;
}

/** Tabella numerica completa (misure comprese) — stessa forma di
 *  `flipRosterTable` in nfl-team-page.js, duplicata per lo stesso motivo delle
 *  altre righe: qui non si importa da un modulo che a sua volta importerebbe
 *  questo. */
function fullRosterTable(list, mode) {
    if (!list?.length) return '';
    const yr = (p) => (p.exp == null ? '—' : p.exp === 0 ? 'R' : String(p.exp));
    const rows = list.map(p => {
        const cls = ['', p.rookie ? 'fc-p--rk' : '', p.practice ? 'fc-p--ps' : ''].filter(Boolean).join(' ');
        const mark = mode === 'played' && p.starter ? '<i class="fc-star" title="Started this game">●</i>' : '';
        return `<tr>
            <td class="pm-td-strong">${p.jersey ?? '—'}</td>
            <td><span class="${cls}">${esc(p.name || '—')}</span>${mark}</td>
            <td>${esc(p.pos || '—')}</td>
            <td>${esc(p.ht || '—')}</td>
            <td>${p.wt ?? '—'}</td>
            <td>${p.age ?? '—'}</td>
            <td>${yr(p)}</td>
            <td>${esc(p.college || '—')}</td>
        </tr>`;
    }).join('');
    return `
        <div class="pm-table-wrap pp-scroll">
            <table class="pm-table pp-table pp-table--compact">
                <thead><tr><th>#</th><th>Name</th><th>Pos</th><th>Ht</th><th>Wt</th><th>Age</th><th>Yr</th><th>College</th></tr></thead>
                <tbody>${rows}</tbody>
            </table>
        </div>`;
}

/** Rosa completa di una squadra al centro della seconda facciata: nome intero
 *  della franchigia, le tabelle con le misure, l'head coach sotto — è l'unico
 *  dato di staff che l'API ha (nessun assistente: verificato sull'endpoint
 *  roster ESPN, che porta un solo allenatore). */
function teamRosterBlock(lato, mode) {
    const id = getTeamIdentity(lato.abbr);
    const gruppi = mode === 'played'
        ? [{ list: lato.roster, label: 'Active for this game' }, { list: lato.inactives, label: 'Inactives' }]
        : [{ list: lato.roster, label: 'Active roster' }, { list: lato.practice, label: 'Practice squad' }];
    const blocchi = gruppi.filter(g => g.list?.length).map(g => `
        <h5 class="fcp-roster-sub">${esc(g.label)} (${g.list.length})</h5>
        ${fullRosterTable([...g.list].sort(byJersey), mode)}`).join('');
    return `
    <div class="fcp-teamroster">
        <h3 class="fcp-teamname" style="--fcp-team:${teamColor(id)}">${esc(id?.name || lato.abbr)}</h3>
        ${blocchi}
        <p class="fcp-coach">Head coach: <b>${esc(lato.coach || '—')}</b></p>
    </div>`;
}

/** Facciata 2: rose in ordine alfabetico fuori, le due rose intere con misure
 *  in mezzo. */
function page2Html(card, mia, sua) {
    return `
    <div class="fcp-cols3 fcp-cols3--wide">
        ${outerColumn(mia, card.mode, true)}
        <div class="fcp-mid fcp-mid--rosters">
            ${teamRosterBlock(mia, card.mode)}
            ${teamRosterBlock(sua, card.mode)}
        </div>
        ${outerColumn(sua, card.mode, true)}
    </div>`;
}

// ─── Zoom su un pannello ────────────────────────────────────────────────
//
// Cliccando uno dei sei pannelli della facciata 1 quel pannello si apre a
// tutto schermo, per leggere nomi e numeri di UNA squadra e UN reparto. I
// pannelli della facciata non cambiano: lo zoom è un livello sopra, e
// ridisegna le STESSE righe (`lato.units[key]`, nessun ricalcolo) in forma di
// tabella — una riga per slot, una colonna per livello di profondità — con
// le convenzioni della card (titolare in grassetto, rookie sottolineato,
// practice squad in corsivo, barrato chi non era a referto). Le righe si
// dividono l'altezza della finestra, così un reparto intero sta a schermo
// senza scorrere; sotto i 700px diventano righe che vanno a capo, e scorre.

/** Ordine in cui ‹ › passano da un pannello all'altro. */
const ZOOM_ORDINE = [['mia', 'offense'], ['mia', 'defense'], ['mia', 'special'], ['sua', 'offense'], ['sua', 'defense'], ['sua', 'special']];
const ZOOM_LABEL = { offense: 'Offense', defense: 'Defense', special: 'Specialists' };
const LIVELLI = ['Starter', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th'];

/** Sigla dell'infortunio — uguale a `flipInjTag` di nfl-team-page.js,
 *  duplicata di proposito (vedi commento in testa al file). */
const injTag = (s) => {
    const t = String(s || '');
    if (/injur|^ir$|reserve/i.test(t)) return 'IR';
    if (/^out/i.test(t)) return 'O';
    if (/doubt/i.test(t)) return 'D';
    if (/question/i.test(t)) return 'Q';
    if (/pup|non.?football/i.test(t)) return 'P';
    return '!';
};

function zoomCell(p, i, mode) {
    const titolare = mode === 'played' ? !!p.starter : i === 0;
    const cls = ['fcz-p', titolare ? 'fc-p--s' : '', p.rookie ? 'fc-p--rk' : '', p.practice ? 'fc-p--ps' : '', p.inactive ? 'fc-p--out' : ''].filter(Boolean).join(' ');
    const inj = p.injury ? `<i class="fc-inj" title="${esc(p.injury)}">${esc(injTag(p.injury))}</i>` : '';
    return `<div class="${cls}"${p.inactive ? ' title="Did not dress for this game"' : ''}>
        <b class="fcz-num">${p.jersey ?? '—'}</b><span class="fcz-name">${esc(p.name || '—')}</span>${inj}</div>`;
}

/** Il laboratorio Study of the Game con queste due squadre: chi ha il
 *  reparto aperto in attacco attacca, se no difende. Le depth chart del
 *  laboratorio sono quelle di oggi, quindi la stagione è quella in corso. */
function laboratorio(card, lato, key) {
    const altro = lato === card.home ? card.away : card.home;
    const d = new Date();
    const anno = d.getMonth() + 1 >= 3 ? d.getFullYear() : d.getFullYear() - 1;
    const [att, dif] = key === 'offense' ? [lato.abbr, altro.abbr] : [altro.abbr, lato.abbr];
    return `#nfl-tactics/${att}/${anno}/study/${dif}`;
}

function zoomHtml(card, lato, key) {
    const id = getTeamIdentity(lato.abbr);
    const rows = lato.units?.[key] || [];
    const cols = Math.min(LIVELLI.length, Math.max(1, ...rows.map(r => r.players.length)));
    const altro = lato === card.home ? card.away : card.home;
    const sotto = [card.week, `${lato === card.home ? 'vs' : '@'} ${altro.abbr}`].filter(Boolean).join(' · ');
    const giocata = card.mode === 'played';
    const legenda = [
        `<span class="fc-p fc-p--s">${giocata ? 'started this game' : 'starter'}</span>`,
        '<span class="fc-p fc-p--rk">rookie</span>',
        giocata ? (card.depthDay ? '<span class="fc-p fc-p--out">did not dress</span>' : '') : '<span class="fc-p fc-p--ps">practice squad</span><span class="fc-p"><i class="fc-inj">O</i> injury status</span>',
    ].join('');
    return `
    <div class="fcz-head" style="--fcz-team:${teamColor(id)}">
        <img src="${teamLogo(lato.abbr)}" alt="">
        <div class="fcz-title"><b>${esc(id?.name || lato.abbr)}</b><span>${ZOOM_LABEL[key]}</span></div>
        <small>${esc(sotto)}</small>
        ${key !== 'special' ? `<a class="fcz-field" data-fcz-campo href="${laboratorio(card, lato, key)}">On the field ›</a>` : ''}
    </div>
    <div class="fcz-grid" style="--fcz-cols:${cols};--fcz-rows:${rows.length};--fcz-team:${teamColor(id)}">
        <div class="fcz-hrow"><span></span>${LIVELLI.slice(0, cols).map(l => `<span>${l}</span>`).join('')}</div>
        ${rows.map(r => {
            // Celle vuote fino al numero di colonne: le righe sono `display:
            // contents`, e senza riempitivo la riga dopo risalirebbe a
            // occupare i buchi di quella corta.
            const celle = r.players.slice(0, cols).map((p, i) => zoomCell(p, i, card.mode));
            while (celle.length < cols) celle.push('<span class="fcz-vuoto"></span>');
            return `<div class="fcz-row"><span class="fcz-pos">${esc(r.pos || '')}</span>${celle.join('')}</div>`;
        }).join('')}
    </div>
    <div class="fcz-legend">${legenda}</div>`;
}

function disegnaZoom() {
    const box = document.querySelector('.fcp-overlay .fcz');
    if (!box || !_st?.zoom) return;
    const { mia, sua } = laFaccia(_st.card, _st.abbr);
    const [chi, key] = _st.zoom;
    box.querySelector('.fcz-body').innerHTML = zoomHtml(_st.card, chi === 'mia' ? mia : sua, key);
    const i = ZOOM_ORDINE.findIndex(([c, k]) => c === chi && k === key);
    box.querySelector('.fcz-ind').textContent = `${i + 1} / ${ZOOM_ORDINE.length}`;
    box.querySelector('.fcz-body').scrollTo(0, 0);
}

function apriZoom(chi, key) {
    const overlay = document.querySelector('.fcp-overlay');
    if (!overlay || !_st) return;
    _st.zoom = [chi, key];
    let box = overlay.querySelector('.fcz');
    if (!box) {
        box = document.createElement('div');
        box.className = 'fcz';
        box.innerHTML = `
            <button type="button" class="fcz-close" aria-label="Back to the flip card">✕</button>
            <button type="button" class="fcp-arrow fcz-arrow fcp-arrow--left" aria-label="Previous panel">‹</button>
            <div class="fcz-body"></div>
            <button type="button" class="fcp-arrow fcz-arrow fcp-arrow--right" aria-label="Next panel">›</button>
            <div class="fcp-pageind fcz-ind"></div>`;
        overlay.appendChild(box);
        box.querySelector('.fcz-close').addEventListener('click', chiudiZoom);
        // Il link cambia pagina: la flip card a tutto schermo va chiusa,
        // se no resterebbe sopra al laboratorio.
        box.addEventListener('click', (e) => { if (e.target.closest('[data-fcz-campo]')) closeFlipPrint(); });
        box.querySelector('.fcp-arrow--left').addEventListener('click', () => scorriZoom(-1));
        box.querySelector('.fcp-arrow--right').addEventListener('click', () => scorriZoom(1));
    }
    overlay.classList.add('fcp-zooming');
    disegnaZoom();
}

function chiudiZoom() {
    const overlay = document.querySelector('.fcp-overlay');
    overlay?.querySelector('.fcz')?.remove();
    overlay?.classList.remove('fcp-zooming');
    if (_st) _st.zoom = null;
}

/** Al pannello dopo/prima, saltando quelli vuoti (una squadra senza depth chart). */
function scorriZoom(dir) {
    if (!_st?.zoom) return;
    const { mia, sua } = laFaccia(_st.card, _st.abbr);
    let i = ZOOM_ORDINE.findIndex(([c, k]) => c === _st.zoom[0] && k === _st.zoom[1]);
    for (let n = 0; n < ZOOM_ORDINE.length; n++) {
        i = (i + dir + ZOOM_ORDINE.length) % ZOOM_ORDINE.length;
        const [c, k] = ZOOM_ORDINE[i];
        if ((c === 'mia' ? mia : sua).units?.[k]?.length) { _st.zoom = [c, k]; disegnaZoom(); return; }
    }
}

// ─── Controller del overlay ─────────────────────────────────────────────

let _st = null; // { card, abbr, page, zoom: [chi, key] | null }

function laFaccia(card, abbr) {
    const mia = card.home.abbr === abbr ? card.home : card.away;
    const sua = mia === card.home ? card.away : card.home;
    return { mia, sua };
}

/** Sotto questa scala il testo (già piccolo, com'è la card stampata vera)
 *  diventerebbe illeggibile: qui ci si ferma e torna lo scorrimento, invece
 *  di continuare a rimpicciolire. */
const SCALA_MIN = 0.58;
/** Margine dal bordo della finestra, per non toccare i pulsanti fissi. */
const MARGINE_FIT = 22;

/**
 * La pagina si disegna alla sua taglia NATURALE (quella con cui sono scritte
 * le regole CSS, pensata sulle proporzioni del programma di gara stampato) e
 * poi si scala con un `transform` per stare tutta nella finestra, come un PDF
 * in "adatta alla pagina" — è la richiesta esplicita: vedere tutto insieme,
 * senza scorrere, con le stesse proporzioni fra le scritte del documento
 * originale.
 *
 * Il wrapper (`fcp-stage-wrap`) prende la dimensione GIÀ SCALATA: `overflow`
 * su `.fcp-book` guarda la scatola di questo elemento, non l'effetto visivo
 * del transform (misurato: uno scale(0.3) su un box 600×600 dentro un
 * contenitore overflow:auto continua a riportare 600 di scrollWidth, non
 * 180) — senza il wrapper della taglia giusta comparirebbe uno scroll che
 * non serve anche quando il contenuto sta già tutto a schermo scalato.
 */
function adattaAllaFinestra() {
    const book = document.querySelector('.fcp-overlay .fcp-book');
    const wrap = document.querySelector('.fcp-overlay .fcp-stage-wrap');
    const stage = document.querySelector('.fcp-overlay .fcp-stage');
    if (!book || !wrap || !stage) return;
    // `disegna()` sostituisce solo i FIGLI di `.fcp-stage` (innerHTML): la sua
    // taglia inline, scritta qui sotto dal giro precedente (pagina diversa,
    // altezza diversa), resterebbe appiccicata e falserebbe la misura
    // "naturale" della pagina nuova se non si azzera prima.
    stage.style.transform = 'none';
    stage.style.width = 'auto';
    stage.style.height = 'auto';
    wrap.style.width = 'auto';
    wrap.style.height = 'auto';
    const w = stage.offsetWidth, h = stage.offsetHeight;
    if (!w || !h) return;
    const availW = book.clientWidth - MARGINE_FIT * 2;
    const availH = book.clientHeight - MARGINE_FIT * 2;
    const adatta = Math.min(availW / w, availH / h);
    const scala = Math.max(adatta, SCALA_MIN);
    stage.style.width = `${w}px`;
    stage.style.height = `${h}px`;
    stage.style.transform = `scale(${scala})`;
    wrap.style.width = `${Math.round(w * scala)}px`;
    wrap.style.height = `${Math.round(h * scala)}px`;
    // Sotto la scala minima il contenuto scalato resta più grande della
    // finestra: `.fcp-book` centra con flexbox, e su un overflow centrato lo
    // zero dello scroll NON è l'angolo in alto a sinistra ma il centro (si
    // parte già a metà pagina, verificato). Da lì in giù si allinea in alto a
    // sinistra invece: `scrollTo(0, 0)`, chiamato subito dopo da `disegna()`,
    // torna a mostrare davvero l'inizio della pagina.
    book.classList.toggle('fcp-book--scroll', adatta < SCALA_MIN);
}

function disegna() {
    const stage = document.querySelector('.fcp-overlay .fcp-stage');
    const ind = document.querySelector('.fcp-overlay .fcp-pageind');
    if (!stage || !_st) return;
    const { mia, sua } = laFaccia(_st.card, _st.abbr);
    stage.innerHTML = _st.page === 1 ? page1Html(_st.card, mia, sua) : page2Html(_st.card, mia, sua);
    if (ind) ind.textContent = `${_st.page} / 2`;
    adattaAllaFinestra();
    document.querySelector('.fcp-overlay .fcp-book').scrollTo(0, 0);
}

function giraPagina() {
    if (!_st) return;
    _st.page = _st.page === 1 ? 2 : 1;
    disegna();
}

function onKey(e) {
    if (!_st) return;
    // Con un pannello aperto le frecce scorrono i pannelli ed Esc torna alla card.
    if (_st.zoom) {
        if (e.key === 'Escape') chiudiZoom();
        else if (e.key === 'ArrowLeft') scorriZoom(-1);
        else if (e.key === 'ArrowRight') scorriZoom(1);
        return;
    }
    if ((e.key === 'Enter' || e.key === ' ') && e.target?.closest?.('.fcp-depth[data-zoom]')) {
        e.preventDefault();
        const [chi, key] = e.target.closest('.fcp-depth[data-zoom]').dataset.zoom.split(':');
        apriZoom(chi, key);
        return;
    }
    if (e.key === 'Escape') closeFlipPrint();
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') giraPagina();
}

let _onResize = null;

/** Chiude la vista a tutto schermo, se aperta. */
export function closeFlipPrint() {
    document.querySelector('.fcp-overlay')?.remove();
    document.removeEventListener('keydown', onKey);
    if (_onResize) { window.removeEventListener('resize', _onResize); _onResize = null; }
    document.body.classList.remove('fcp-locked');
    _st = null;
}

/**
 * Apre la vista a tutto schermo sulla `card` già scaricata (stesso oggetto
 * che disegna la vista in pagina — nessuna nuova richiesta di rete).
 */
export function openFlipPrint(card, abbr) {
    if (!card?.home || !card?.away) return;
    closeFlipPrint();
    _st = { card, abbr, page: 1, zoom: null };
    const overlay = document.createElement('div');
    overlay.className = 'fcp-overlay';
    overlay.innerHTML = `
        <button type="button" class="fcp-close" aria-label="Close full screen">✕</button>
        <button type="button" class="fcp-arrow fcp-arrow--left" aria-label="Flip to the other side">‹</button>
        <div class="fcp-book"><div class="fcp-stage-wrap"><div class="fcp-stage"></div></div></div>
        <button type="button" class="fcp-arrow fcp-arrow--right" aria-label="Flip to the other side">›</button>
        <div class="fcp-pageind">1 / 2</div>`;
    document.body.appendChild(overlay);
    document.body.classList.add('fcp-locked');
    overlay.querySelector('.fcp-close').addEventListener('click', closeFlipPrint);
    overlay.querySelector('.fcp-arrow--left').addEventListener('click', giraPagina);
    overlay.querySelector('.fcp-arrow--right').addEventListener('click', giraPagina);
    // Il tocco/click sullo sfondo (non sulla card) chiude, come un lightbox.
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeFlipPrint(); });
    // Clic su uno dei sei pannelli della facciata 1: quel pannello a tutto schermo.
    overlay.querySelector('.fcp-stage').addEventListener('click', (e) => {
        const pan = e.target.closest('.fcp-depth[data-zoom]');
        if (!pan) return;
        const [chi, key] = pan.dataset.zoom.split(':');
        apriZoom(chi, key);
    });
    document.addEventListener('keydown', onKey);
    // La finestra può cambiare taglia (resize, rotazione del telefono) a
    // overlay aperto: si riadatta invece di restare tarata sulla misura di
    // quando si è aperto.
    let resizeT;
    _onResize = () => { clearTimeout(resizeT); resizeT = setTimeout(adattaAllaFinestra, 120); };
    window.addEventListener('resize', _onResize);
    // La X si spegne dopo un po' di inattività e torna al primo movimento:
    // è l'unica cosa che deve "scomparire", non le frecce di navigazione.
    let idleT;
    const sveglia = () => {
        overlay.classList.remove('fcp-idle');
        clearTimeout(idleT);
        idleT = setTimeout(() => overlay.classList.add('fcp-idle'), 2500);
    };
    overlay.addEventListener('mousemove', sveglia);
    overlay.addEventListener('touchstart', sveglia, { passive: true });
    sveglia();
    disegna();
}
