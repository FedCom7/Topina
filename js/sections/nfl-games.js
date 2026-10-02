/**
 * Le partite NFL di una giornata, a pagina intera — #nfl-games/{anno}/{tipo}/{week}
 *
 * E' "Inside the game" del Live senza il filtro delle nostre rose: TUTTE le
 * partite della settimana, in corso e finite, ognuna col suo campo e le sue
 * giocate, l'uso dei palloni di ENTRAMBI gli attacchi e il confronto completo
 * delle statistiche di squadra. Ci si arriva dal tasto sul tabellone dell'NFL
 * Hub, che passa la giornata che si stava guardando.
 *
 * Il campo e le giocate vengono da `data/campo-partita.js`, lo stesso modulo
 * del Live: due copie dello stesso disegno divergerebbero alla prima
 * correzione. Le pillole delle partite si costruiscono UNA volta per giornata
 * e poi si ritoccano solo nei numeri: rifacendole a ogni aggiornamento la fila
 * tornava all'inizio, lontano dalla partita scelta (successo nel Live).
 */

import { getWeekGames, getCurrentNflWeek } from '../data/nfl-schedule.js?v=552';
import { fetchPlays, headshotUrl } from '../data/nfl-plays.js?v=572';
import { getStarters } from '../data/nfl-flip-card.js?v=6';
import { fetchBoxscoreTotals, normName } from '../data/espn-boxscore.js?v=574';
import { getTeamIdentity } from '../data/nfl-teams.js?v=513';
import { fieldStripHTML, bindFieldStrip } from '../ui/field-strip.js?v=148';
import { statoPartita, drivesDi } from '../data/campo-partita.js?v=2';
import { oraItaliana } from '../utils/ora-italiana.js?v=1';
import { CURRENT_SEASON } from '../data.js?v=595';

const POLL_MS = 30000;
const LOGO = (abbr) => `https://a.espncdn.com/i/teamlogos/nfl/500/${String(abbr || '').toLowerCase()}.png`;
const esc = (v) => String(v ?? '').replace(/[&<>"]/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* I turni di post-season dell'endpoint ESPN: gli stessi del tabellone dell'Hub. */
const POST_ROUNDS = { 1: 'Wild Card', 2: 'Divisional', 3: 'Conference', 5: 'Super Bowl' };
const etichettaGiornata = (t, w) => (t === 3 ? POST_ROUNDS[w] || 'Playoffs' : `Week ${w}`);

let stato = null;      // { anno, tipo, week, games, sel, box, plays, scelta, timer }
let gettone = 0;       // scarta le risposte di una giornata che non si guarda piu'

/** Da hash a { anno, tipo, week, ev }: ogni pezzo e' facoltativo. */
function leggiHash() {
    const p = (location.hash || '').replace(/^#nfl-games\/?/, '').split('/').filter(Boolean);
    return { anno: +p[0] || null, tipo: +p[1] || null, week: +p[2] || null, ev: p[3] || null };
}

/**
 * `#nfl-games` senza altro e' SEMPRE la giornata in corso: un link salvato
 * cosi' si aggiorna da solo ogni settimana. La giornata finisce nell'indirizzo
 * solo quando se ne sceglie un'altra (`corrente: false`).
 */
let corrente = null;    // { anno, week } della giornata NFL in corso

export async function initNflGames() {
    const sez = document.getElementById('nfl-games');
    if (!sez) return;
    const h = leggiHash();
    if (!corrente) {
        const ora = await getCurrentNflWeek().catch(() => null);
        corrente = { anno: ora?.year || Number(CURRENT_SEASON), week: ora?.week || 1 };
    }
    const anno = h.anno || corrente.anno;
    const tipo = h.tipo || 2;
    const week = h.week || corrente.week;
    // Stessa giornata gia' a schermo (si torna dalla scheda di una squadra):
    // non si rifa' niente, si riprende da dov'era.
    if (stato && stato.anno === anno && stato.tipo === tipo && stato.week === week && sez.querySelector('.ng-game')) {
        if (h.ev && h.ev !== stato.sel) scegliPartita(h.ev);
        avviaPolling();
        return;
    }
    caricaGiornata(sez, anno, tipo, week, h.ev);
}

async function caricaGiornata(sez, anno, tipo, week, ev = null) {
    fermaPolling();
    const mio = ++gettone;
    stato = { anno, tipo, week, games: [], sel: null, box: null, plays: new Map(), scelta: null, titolari: new Map() };
    sez.innerHTML = `
    <div class="section-inner ng">
        <header class="ng-head">
            <div>
                <span class="mc-kicker">NFL Hub · <span class="ng-week-label">${esc(etichettaGiornata(tipo, week))} · ${anno}</span></span>
                <h1 class="ng-title">Game day</h1>
            </div>
        </header>
        <nav class="ng-games" aria-label="Games"></nav>
        <div class="ng-body"><div class="loading-state"><div class="spinner"></div><p>Loading games…</p></div></div>
    </div>`;
    // Niente selettore della giornata: la pagina e' quella della settimana in
    // corso. Un'altra giornata ci arriva solo dal tabellone dell'NFL Hub.

    const dati = await getWeekGames(anno, week, tipo).catch(() => null);
    if (mio !== gettone) return;
    const corpo = sez.querySelector('.ng-body');
    if (!dati?.games?.length) {
        corpo.innerHTML = '<p class="pm-empty">No games for this week.</p>';
        return;
    }
    stato.games = dati.games;
    sez.querySelector('.ng-games').innerHTML = dati.games.map(pilloraHTML).join('');
    sez.querySelector('.ng-games').addEventListener('click', (e) => {
        const b = e.target.closest('[data-ng-ev]');
        if (b) scegliPartita(b.dataset.ngEv);
    });
    // All'apertura: quella chiesta, se no la prima in corso, se no l'ultima
    // finita, se no la prima da giocare.
    const scelta = (ev && dati.games.find(g => String(g.eventId) === String(ev)))
        || dati.games.find(g => g.state === 'in')
        || [...dati.games].reverse().find(g => g.state === 'post')
        || dati.games[0];
    scegliPartita(String(scelta.eventId));
    avviaPolling();
}

/** La pillola di una partita: i due loghi con le sigle, il punteggio o l'ora. */
function pilloraHTML(g) {
    return `
    <button type="button" class="ng-pill ng-pill--${g.state}" data-ng-ev="${esc(g.eventId)}"
            title="${esc(g.away.name)} at ${esc(g.home.name)}">
        ${squadraPillola(g.away, g, 'away')}
        <span class="ng-pill-at">@</span>
        ${squadraPillola(g.home, g, 'home')}
        <span class="ng-pill-st">${esc(statoBreve(g))}</span>
    </button>`;
}
function squadraPillola(t, g, lato) {
    const perde = g.state === 'post' && g.home.score != null && g.home.score !== g.away.score
        && (lato === 'home' ? g.home.score < g.away.score : g.away.score < g.home.score);
    return `<span class="ng-pill-team${perde ? ' is-loser' : ''}">
        <img src="${LOGO(t.abbr)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">
        <b>${esc(t.abbr)}</b>${g.state !== 'pre' && t.score != null ? `<i data-ng-score="${lato}">${t.score}</i>` : ''}
    </span>`;
}
const statoBreve = (g) => (g.state === 'pre' ? (oraItaliana(g.date) || '') : g.state === 'post' ? 'Final' : (g.status || 'Live'));

/** Accende una partita: scarica tabellino e giocate e la disegna. */
async function scegliPartita(ev) {
    if (!stato) return;
    stato.sel = String(ev);
    stato.scelta = null;
    const sez = document.getElementById('nfl-games');
    sez.querySelectorAll('.ng-pill').forEach(b => b.classList.toggle('active', b.dataset.ngEv === stato.sel));
    tieniInVista(sez.querySelector('.ng-pill.active'));
    // Sulla giornata in corso l'indirizzo resta `#nfl-games`, senza partita:
    // e' il link che si salva, e deve portare sempre alla settimana di adesso.
    // Su un'altra giornata dice giornata e partita, cosi' un link porta li'.
    // replaceState: non fa partire un'altra navigazione.
    const eCorrente = stato.tipo === 2 && stato.week === corrente?.week && stato.anno === corrente?.anno;
    history.replaceState(null, '', eCorrente ? '#nfl-games'
        : `#nfl-games/${stato.anno}/${stato.tipo}/${stato.week}/${stato.sel}`);
    const corpo = sez.querySelector('.ng-body');
    corpo.innerHTML = '<div class="loading-state"><div class="spinner"></div></div>';
    await aggiornaPartita(true);
}

/** La pillola scelta resta nella fila visibile, senza muovere la pagina. */
function tieniInVista(b) {
    const fila = b?.parentElement;
    if (!fila) return;
    const da = b.getBoundingClientRect().left - fila.getBoundingClientRect().left + fila.scrollLeft;
    if (da < fila.scrollLeft) fila.scrollLeft = Math.max(0, da - 16);
    else if (da + b.offsetWidth > fila.scrollLeft + fila.clientWidth) fila.scrollLeft = da + b.offsetWidth - fila.clientWidth + 16;
}

async function aggiornaPartita(daCapo = false) {
    const st = stato;
    const ev = st?.sel;
    const g = st?.games.find(x => String(x.eventId) === ev);
    if (!g) return;
    const mio = gettone;
    const [box, plays] = await Promise.all([
        g.state === 'pre' ? null : fetchBoxscoreTotals([ev], new Set(g.state === 'post' ? [ev] : [])).catch(() => null),
        g.state === 'pre' ? [] : fetchPlays(ev, { all: true }).catch(() => []),
    ]);
    if (mio !== gettone || st.sel !== ev) return;
    st.box = box;
    st.plays.set(ev, plays || []);
    disegna(daCapo);
}

function squadre(g) {
    const lato = (t) => ({
        abbr: t.abbr, name: t.name || t.abbr, logo: LOGO(t.abbr),
        color: getTeamIdentity(t.abbr)?.color || 'var(--accent-red)',
        color2: getTeamIdentity(t.abbr)?.color2 || '',
        score: t.score ?? 0, timeouts: null,
    });
    return { home: lato(g.home), away: lato(g.away) };
}

function statoCampo(g) {
    const { home, away } = squadre(g);
    return statoPartita({
        sigla: g.home.abbr, home, away,
        stato: g.state, detail: g.state === 'pre' ? (oraItaliana(g.date) || '') : (g.status || ''),
        tutte: stato.plays.get(String(g.eventId)) || [],
        scelta: stato.scelta,
    });
}

function disegna(daCapo) {
    const sez = document.getElementById('nfl-games');
    const corpo = sez?.querySelector('.ng-body');
    const g = stato.games.find(x => String(x.eventId) === stato.sel);
    if (!corpo || !g) return;
    const campo = fieldStripHTML(statoCampo(g)).trim();

    if (!daCapo && corpo.querySelector('.ng-game')) {
        // Aggiornamento: il campo si ritocca solo se e' cambiato, e se la
        // scena e' la stessa si cambia il solo scorebug (rifare l'SVG fa
        // ripartire l'animazione della giocata); il resto si riscrive.
        aggiornaCampo(corpo, campo);
        corpo.querySelector('.ng-stats').innerHTML = statsHTML(g);
        return;
    }
    corpo.innerHTML = `
    <article class="ng-game">
        <div class="ng-field">${campo}</div>
        <div class="ng-stats">${statsHTML(g)}</div>
        <div class="ng-lineups"></div>
    </article>`;
    bindFieldStrip(corpo.querySelector('.fst'), scegliGiocata);
    caricaTitolari(g);
}

/* ─── I titolari in campo, con la foto ─────────────────────────────────── */

/**
 * Una volta per partita: i titolari non cambiano durante la gara, e la
 * richiesta e' a parte (roster di gara o depth chart), quindi non frena il
 * resto della pagina.
 */
async function caricaTitolari(g) {
    const ev = String(g.eventId);
    if (!stato.titolari.has(ev)) {
        stato.titolari.set(ev, Promise.all([
            getStarters(ev, g.away.abbr).catch(() => null),
            getStarters(ev, g.home.abbr).catch(() => null),
        ]));
    }
    const [away, home] = await stato.titolari.get(ev);
    const box = document.querySelector('#nfl-games .ng-lineups');
    if (!box || stato.sel !== ev) return;
    if (!away && !home) { box.innerHTML = ''; return; }
    const progetto = [away, home].some(x => x?.fonte === 'depth');
    box.innerHTML = `
    <section class="ng-xi">
        <h3 class="ng-xi-title">${progetto ? 'Projected starters' : 'Starting lineups'}</h3>
        ${progetto ? '<p class="ng-xi-note">From the official ESPN depth chart: the game-day starters appear at kickoff.</p>' : ''}
        <div class="ng-teams">${titolariHTML(g.away, away)}${titolariHTML(g.home, home)}</div>
    </section>`;
}

function titolariHTML(t, dati) {
    const testa = `<h3 class="ng-team-h"><img src="${LOGO(t.abbr)}" alt="">${esc(t.name || t.abbr)}</h3>`;
    if (!dati) return `<section class="ng-team">${testa}<p class="pm-empty">Lineup not available.</p></section>`;
    const giocatore = (p) => `
            <div class="ng-xi-p" title="${esc(p.name)}">
                <span class="ng-xi-foto"><img src="${headshotUrl(p.id)}" alt="" loading="lazy"
                    onerror="this.onerror=null;this.src='images/fallback-player.svg'"></span>
                <span class="ng-xi-pos">${p.jersey != null ? `#${esc(p.jersey)} · ` : ''}${esc(p.pos || '')}</span>
                <span class="ng-xi-nome">${esc(p.name)}</span>
            </div>`;
    // Una riga per ruolo: prima i titolari, poi una riga verticale e la
    // panchina dello stesso ruolo. La riga scorre di lato se non ci sta.
    const righe = (dati.ruoli || []).map(g => `
        <div class="ng-bench-row">
            <span class="ng-bench-ruolo">${esc(g.ruolo)}</span>
            <div class="ng-bench-fila">
                ${g.titolari.map(giocatore).join('')}
                ${g.titolari.length && g.panchina.length ? '<span class="ng-xi-sep" aria-hidden="true"></span>' : ''}
                ${g.panchina.map(p => giocatore(p).replace('class="ng-xi-p"', 'class="ng-xi-p is-bench"')).join('')}
            </div>
        </div>`).join('');
    return `<section class="ng-team">${testa}
        <div class="ng-xi-legend"><span>Starters</span><i aria-hidden="true"></i><span>Bench</span></div>
        <div class="ng-bench">${righe}</div>
    </section>`;
}

function aggiornaCampo(corpo, nuova) {
    const vecchia = corpo.querySelector('.fst');
    if (!vecchia || vecchia.outerHTML === nuova) return;
    const tmp = document.createElement('div');
    tmp.innerHTML = nuova;
    const fresca = tmp.firstElementChild;
    if (vecchia.dataset.scena && vecchia.dataset.scena === fresca?.dataset.scena) {
        const bn = fresca.querySelector('.fst-bug'), bv = vecchia.querySelector('.fst-bug');
        if (bn && bv && bn.outerHTML !== bv.outerHTML) bv.replaceWith(bn);
        return;
    }
    const aperto = vecchia.querySelector('.fst-recap')?.open;
    vecchia.replaceWith(fresca);
    const det = fresca.querySelector('.fst-recap');
    if (det && aperto) det.open = true;
    bindFieldStrip(fresca, scegliGiocata);
}

/** Dalla timeline o da una pastiglia di drive: come nel Live. */
function scegliGiocata(i, drive) {
    const tutte = stato.plays.get(stato.sel) || [];
    if (drive != null) {
        const primo = drivesDi(tutte)[drive]?.plays?.find(x => x.toEZ != null);
        if (primo) stato.scelta = tutte.indexOf(primo);
    } else {
        stato.scelta = i;
    }
    const corpo = document.querySelector('#nfl-games .ng-body');
    const g = stato.games.find(x => String(x.eventId) === stato.sel);
    if (corpo && g) aggiornaCampo(corpo, fieldStripHTML(statoCampo(g)).trim());
}

/* ─── Statistiche: i due attacchi e il confronto di squadra ─────────────── */

const voci = (arr) => arr.map(([v, e]) =>
    `<span class="live-uso-stat${v ? '' : ' is-zero'}"><b>${v || 0}</b> <i>${e}</i></span>`).join('');
const testata = (col, cls = 'live-uso-row') => `
    <div class="${cls} live-uso-head" aria-hidden="true">
        <span class="live-uso-nome"></span>
        ${cls === 'live-uso-row' ? '<span class="live-uso-bar"></span>' : ''}
        <span class="live-uso-val">${col.map(c => `<span class="live-uso-stat">${c}</span>`).join('')}</span>
    </div>`;
function riga(nome, valore, max, dettaglio, pieno = 0) {
    const pct = max > 0 ? Math.round((valore / max) * 100) : 0;
    const dentro = valore > 0 ? Math.round((pieno / valore) * 100) : 0;
    return `
    <div class="live-uso-row">
        <span class="live-uso-nome">${esc(nome)}</span>
        <span class="live-uso-bar" style="--w:${pct}%">
            <span class="live-uso-fill" style="width:${pct}%">${pieno ? `<i class="live-uso-done" style="width:${dentro}%"></i>` : ''}</span>
        </span>
        <span class="live-uso-val">${dettaglio}</span>
    </div>`;
}

/** L'attacco di una squadra: chi riceve, chi corre, chi lancia. */
function attaccoHTML(t) {
    const q = stato.box?.usage?.get(t.abbr);
    const giocatori = Array.isArray(q?.players) ? q.players : [...(q?.players?.values?.() || [])];
    const testa = `<h3 class="ng-team-h"><img src="${LOGO(t.abbr)}" alt="">${esc(t.name || t.abbr)}</h3>`;
    if (!giocatori.length) return `<section class="ng-team">${testa}<p class="pm-empty">No stats yet.</p></section>`;

    const ric = giocatori.filter(p => p.targets > 0).sort((a, b) => b.targets - a.targets).slice(0, 8);
    const cor = giocatori.filter(p => p.rush_att > 0).sort((a, b) => b.rush_att - a.rush_att).slice(0, 5);
    const lan = giocatori.filter(p => p.pass_yds || p.pass_td).sort((a, b) => (b.pass_yds || 0) - (a.pass_yds || 0)).slice(0, 2);
    const maxT = Math.max(0, ...ric.map(p => p.targets));
    const maxC = Math.max(0, ...cor.map(p => p.rush_att));
    const blocco = (titolo, col, righe) => (righe ? `<div class="live-uso-blocco"><span class="live-uso-titolo">${titolo}</span>${testata(col)}${righe}</div>` : '');
    const lancio = (p) => {
        const s = stato.box?.players?.get(normName(p.name)) || {};
        return `
        <div class="live-uso-qb">
            <span class="live-uso-nome">${esc(p.name)}</span>
            <span class="live-uso-val">${voci([[`${s.pass_comp || 0}/${s.pass_att || 0}`, 'c/a'], [p.pass_yds, 'yd'], [p.pass_td, 'TD'], [s.pass_int, 'INT']])}</span>
        </div>`;
    };
    return `
    <section class="ng-team">
        ${testa}
        ${lan.length ? `<div class="live-uso-blocco"><span class="live-uso-titolo">Passing</span>${testata(['c/a', 'yd', 'TD', 'INT'], 'live-uso-qb')}${lan.map(lancio).join('')}</div>` : ''}
        ${blocco('Targets and catches', ['tgt', 'rec', 'yd', 'TD'], ric.map(p => riga(p.name, p.targets, maxT,
            voci([[p.targets, 'tgt'], [p.rec, 'rec'], [p.rec_yds, 'yd'], [p.rec_td, 'TD']]), p.rec || 0)).join(''))}
        ${blocco('Carries', ['car', 'yd', 'TD'], cor.map(p => riga(p.name, p.rush_att, maxC,
            voci([[p.rush_att, 'car'], [p.rush_yds, 'yd'], [p.rush_td, 'TD']]))).join(''))}
    </section>`;
}

/* Le statistiche di squadra di ESPN, tutte, in un ordine che si legge:
   volume, poi passaggi, corse, efficienza e pulizia. `basso`: meglio meno. */
const STATS_SQUADRA = [
    ['totalYards', 'Total yards'], ['totalOffensivePlays', 'Total plays'], ['yardsPerPlay', 'Yards per play'],
    ['firstDowns', 'First downs'], ['firstDownsPassing', 'Passing first downs'], ['firstDownsRushing', 'Rushing first downs'],
    ['firstDownsPenalty', 'First downs by penalty'],
    ['netPassingYards', 'Passing yards'], ['completionAttempts', 'Comp / Att', 'testo'], ['yardsPerPass', 'Yards per pass'],
    ['interceptions', 'Interceptions thrown', 'basso'], ['sacksYardsLost', 'Sacks – yards lost', 'basso'],
    ['rushingYards', 'Rushing yards'], ['rushingAttempts', 'Rushing attempts'], ['yardsPerRushAttempt', 'Yards per rush'],
    ['thirdDownEff', '3rd down', 'testo'], ['fourthDownEff', '4th down', 'testo'], ['redZoneAttempts', 'Red zone (made – att)', 'testo'],
    ['totalDrives', 'Drives'], ['turnovers', 'Turnovers', 'basso'], ['fumblesLost', 'Fumbles lost', 'basso'],
    ['totalPenaltiesYards', 'Penalties – yards', 'basso'], ['defensiveTouchdowns', 'Defensive / ST touchdowns'],
    ['possessionTime', 'Possession', 'testo'],
];
const primo = (v) => { const m = String(v ?? '').match(/-?\d+(\.\d+)?/); return m ? parseFloat(m[0]) : 0; };
/* "4-13" e "22/40" si confrontano sulla percentuale, il possesso sui minuti. */
function valore(k, v) {
    const s = String(v ?? '');
    if (k === 'possessionTime') { const [m, sec] = s.split(':').map(Number); return (m || 0) + (sec || 0) / 60; }
    const m = s.match(/^(\d+)[-/](\d+)$/);
    if (m && ['thirdDownEff', 'fourthDownEff', 'redZoneAttempts', 'completionAttempts'].includes(k)) return +m[2] ? +m[1] / +m[2] : 0;
    return primo(s);
}

function confrontoHTML(g) {
    const a = stato.box?.usage?.get(g.away.abbr)?.teamStats;
    const h = stato.box?.usage?.get(g.home.abbr)?.teamStats;
    if (!a || !h) return '';
    const righe = STATS_SQUADRA.map(([k, label, tipo]) => {
        if (a[k] == null && h[k] == null) return '';
        const va = valore(k, a[k]), vh = valore(k, h[k]);
        const tot = va + vh;
        const pct = tot > 0 ? Math.round((va / tot) * 100) : 50;
        const basso = tipo === 'basso';
        const vinceA = va === vh ? null : basso ? va < vh : va > vh;
        return `
        <div class="live-cmpteam-row">
            <span class="live-cmpteam-val${vinceA === true ? ' is-top' : ''}">${esc(a[k] ?? '–')}</span>
            <span class="live-cmpteam-mid">
                <span class="live-cmpteam-label">${label}${basso ? '<i class="live-cmpteam-giu" title="lower is better">↓</i>' : ''}</span>
                <span class="live-cmpteam-bar"><i class="live-cmpteam-fill${basso ? ' is-inverse' : ''}" style="width:${pct}%"></i></span>
            </span>
            <span class="live-cmpteam-val live-cmpteam-val--r${vinceA === false ? ' is-top' : ''}">${esc(h[k] ?? '–')}</span>
        </div>`;
    }).join('');
    return `
    <section class="live-cmpteam ng-cmp">
        <div class="live-cmpteam-head">
            <span><img src="${LOGO(g.away.abbr)}" alt="">${esc(g.away.abbr)}</span>
            <span class="live-cmpteam-title">Team stats</span>
            <span>${esc(g.home.abbr)}<img src="${LOGO(g.home.abbr)}" alt=""></span>
        </div>
        ${righe}
    </section>`;
}

function statsHTML(g) {
    if (g.state === 'pre') {
        return `<p class="pm-empty">Kicks off ${esc(oraItaliana(g.date) || 'soon')}. Plays and stats appear when the game starts.</p>`;
    }
    if (!stato.box) return '<p class="pm-empty">Box score not available right now.</p>';
    return `
    <div class="ng-teams">${attaccoHTML(g.away)}${attaccoHTML(g.home)}</div>
    ${confrontoHTML(g)}`;
}

/* ─── Aggiornamento dal vivo ───────────────────────────────────────────── */

function avviaPolling() {
    fermaPolling();
    if (!stato?.games.some(g => g.state === 'in')) return;
    stato.timer = setInterval(async () => {
        if (!(location.hash || '').startsWith('#nfl-games')) { fermaPolling(); return; }
        if (document.hidden) return;
        const mio = gettone;
        const dati = await getWeekGames(stato.anno, stato.week, stato.tipo).catch(() => null);
        if (mio !== gettone || !dati?.games?.length) return;
        stato.games = dati.games;
        aggiornaPillole();
        await aggiornaPartita(false);
        if (!stato.games.some(g => g.state === 'in')) fermaPolling();
    }, POLL_MS);
}
function fermaPolling() {
    if (stato?.timer) clearInterval(stato.timer);
    if (stato) stato.timer = null;
}

/** Solo numeri e stato nelle pillole: la fila non si rifa', resta dov'era. */
function aggiornaPillole() {
    const fila = document.querySelector('#nfl-games .ng-games');
    if (!fila) return;
    for (const g of stato.games) {
        const b = fila.querySelector(`[data-ng-ev="${CSS.escape(String(g.eventId))}"]`);
        if (!b) continue;
        const nuovo = document.createElement('div');
        nuovo.innerHTML = pilloraHTML(g).trim();
        const n = nuovo.firstElementChild;
        if (b.className.replace(' active', '') !== n.className || b.innerHTML !== n.innerHTML) {
            const attiva = b.classList.contains('active');
            b.className = n.className + (attiva ? ' active' : '');
            b.innerHTML = n.innerHTML;
        }
    }
}
