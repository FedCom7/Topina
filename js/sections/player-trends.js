/**
 * Trends (#trends, sotto Players) — chi sta salendo, chi sta calando, perche',
 * e cosa aspettarsi dalle prossime quattro giornate.
 *
 * I conti stanno in `js/data/player-trends.js`; qui la pagina. Le giornate
 * arrivano da Sleeper una per una (`getWeekStats`, le stesse del filtro
 * "Last N games" di Players), il calendario da Sleeper (`/schedule/nfl/regular`).
 *
 * Due cose da sapere:
 *  - sulla stagione in corso entrano solo le giornate CHIUSE (fino a quella
 *    prima della settimana corrente di Sleeper): una partita a meta' o la sola
 *    del giovedi' sporcherebbero proprio le "ultime partite", che qui sono il
 *    punto. La nota sotto la lista dice fino a dove si e' contato;
 *  - la previsione e' tarata (vedi MODELLO nel modulo dati), e la nota a fondo
 *    pagina riporta quello che la taratura ha detto. Se si cambiano i pesi, va
 *    cambiata anche la nota.
 */

import { SEASONS_DESC, CURRENT_SEASON } from '../data.js?v=597';
import { TEAMS } from './team.js?v=868';
import { pickDropdownHTML, bindPickDropdown } from '../ui/dropdown-pick.js?v=1';
import { getWeekStats } from '../data/projections.js?v=637';
import { fmt, headshotImg, posBadge, hydrateImages, limitedRows, toggleExtraRows } from './analysis.js?v=918';
import { roseDellaLega } from './leaders.js?v=153';
import { montaGhiera } from '../ui/ghiera.js?v=1';
import { costruisciTrend, calendarioPerSquadra, RUOLI_TREND } from '../data/player-trends.js?v=6';

let initialized = false;
let anno = CURRENT_SEASON;
let ruolo = 'all';          // 'all' | QB | RB | WR | TE
let soloLiberi = false;
let recenti = 4;            // quante partite fanno "adesso"
let vista = 'up';           // 'up' (in salita) | 'down' (in calo)
let stato = null;           // { anno, settimane, calendario, prossima, chiuseFino, rose }

const VISIBILI = 20;

export function initPlayerTrends() {
    if (initialized) return;
    initialized = true;
    renderPickRow();
    bindContent();
    load();
}

function renderPickRow() {
    const box = document.getElementById('tr-pick-row');
    if (!box) return;
    const items = SEASONS_DESC.map(y => ({ value: y, label: y }));
    box.innerHTML = pickDropdownHTML('year', items, SEASONS_DESC.indexOf(String(anno)));
    bindPickDropdown(box, (id, value) => {
        if (id !== 'year') return;
        anno = value;
        renderPickRow();
        load();
    });
}

/* ============================================================
   DATI
   ============================================================ */

/**
 * Fino a quale giornata contare, e da quale parte la previsione.
 * Stagione chiusa: tutte e diciotto, nessuna previsione. In corso: le
 * giornate prima della settimana di Sleeper — quella corrente si aggiunge
 * quando Sleeper passa alla successiva.
 */
async function finestraStagione(y) {
    if (String(y) !== String(CURRENT_SEASON)) return { fino: 18, prossima: null };
    try {
        const st = await (await fetch('https://api.sleeper.app/v1/state/nfl')).json();
        if (String(st?.season) === String(y) && st?.season_type === 'regular') {
            const w = Number(st.week) || 1;
            return { fino: Math.max(0, w - 1), prossima: w };
        }
        if (String(st?.season) === String(y) && st?.season_type === 'post') return { fino: 18, prossima: null };
    } catch { /* senza stato: si prova con quello che c'e' */ }
    return { fino: 18, prossima: null };
}

async function load() {
    const wrap = document.getElementById('trends-content');
    if (!wrap) return;
    wrap.innerHTML = `<div class="loading-state"><div class="spinner"></div><p>Loading game logs...</p></div>`;
    const y = anno;
    const { fino, prossima } = await finestraStagione(y);
    const sett = Array.from({ length: fino }, (_, i) => i + 1);
    const [mappe, calendario, rose] = await Promise.all([
        Promise.all(sett.map(w => getWeekStats(y, w))),
        fetch(`https://api.sleeper.com/schedule/nfl/regular/${y}`)
            .then(r => (r.ok ? r.json() : [])).then(calendarioPerSquadra).catch(() => new Map()),
        roseDellaLega(y).catch(() => () => null),
    ]);
    if (String(anno) !== String(y)) return;   // l'utente ha gia' cambiato anno
    const settimane = sett.map((w, i) => [w, mappe[i]]).filter(([, m]) => m.size);
    stato = { anno: y, settimane, calendario, prossima, rose, chiuseFino: settimane.at(-1)?.[0] || 0, cache: new Map() };
    render();
}

/** Il risultato dei conti per la finestra scelta (si ricalcola solo se cambia). */
function trend() {
    if (!stato.cache.has(recenti)) {
        stato.cache.set(recenti, costruisciTrend({
            settimane: stato.settimane, calendario: stato.calendario,
            prossimaSettimana: stato.prossima, recenti,
        }));
    }
    return stato.cache.get(recenti);
}

/* ============================================================
   FORMATI
   ============================================================ */

// sotto la mezza unita' dell'ultima cifra e' zero: niente "−0,0"
const segno = (v, dec = 1) => {
    const z = Math.abs(v) < 0.5 * 10 ** -dec;
    return `${z ? '±' : v > 0 ? '+' : '−'}${fmt(z ? 0 : Math.abs(v), dec)}`;
};
const pct = (v) => (v == null ? '—' : `${fmt(v * 100, 0)}%`);
// differenza fra due quote, in punti percentuali: la colonna e' gia' in %
const pctDelta = (a, b) => (a == null || b == null ? '' : segno((b - a) * 100, 0));
/** Il calendario come scarto dalla media: 1,12 → "+12%". */
const calPct = (f) => `${segno((f - 1) * 100, 0)}%`;
/** Tre fasce per il calendario: il colore dice facile/duro, il numero quanto. */
const fascia = (f) => (f >= 1.08 ? 'easy' : f <= 0.92 ? 'hard' : 'even');

const NOMI_RUOLO = { QB: 'QBs', RB: 'RBs', WR: 'WRs', TE: 'TEs' };

/** Le tre fasce di costanza, come si leggono a schermo. */
const FASCE = {
    steady: { label: 'Steady', frase: 'one of the steadier' },
    normal: { label: 'Normal', frase: 'about as steady as most' },
    swingy: { label: 'Swingy', frase: 'one of the swingier' },
};

/* ============================================================
   PAGINA
   ============================================================ */

function controlli() {
    const ruoli = [{ value: 'all', label: 'All positions' }, ...RUOLI_TREND.map(r => ({ value: r, label: r }))];
    const mostra = [{ value: 'all', label: 'All players' }, { value: 'available', label: 'Available' }];
    const fin = [3, 4, 5].map(nn => ({ value: String(nn), label: `Last ${nn} vs before` }));
    const tab = (id, label) => `<button class="an-avg-pill${vista === id ? ' active' : ''}" type="button" data-tr-vista="${id}">${label}</button>`;
    return `
    <div class="tr-bar">
        <div class="ghiera"><div class="an-avg-toggle ghiera-riga tr-tabs">${tab('up', 'Heating up')}${tab('down', 'Cooling off')}</div></div>
        <div class="an-controls tr-controls">
            ${pickDropdownHTML('win', fin, [3, 4, 5].indexOf(recenti))}
            ${pickDropdownHTML('show', mostra, soloLiberi ? 1 : 0)}
            ${pickDropdownHTML('pos', ruoli, ruoli.findIndex(r => r.value === ruolo))}
        </div>
    </div>`;
}

function filtra(giocatori) {
    return giocatori.filter(p => p.rilevante
        && (ruolo === 'all' || p.pos === ruolo)
        && (!soloLiberi || !stato.rose(p.name)?.finale)
        && (vista === 'up' ? p.delta > 0 : p.delta < 0))
        .sort((a, b) => (vista === 'up' ? b.delta - a.delta : a.delta - b.delta));
}

function render() {
    const wrap = document.getElementById('trends-content');
    if (!wrap || !stato) return;
    if (!stato.settimane.length) {
        wrap.innerHTML = `<div class="empty-state"><p class="empty-state-text">No games played yet in ${stato.anno}.</p></div>`;
        return;
    }
    const { giocatori } = trend();
    const lista = filtra(giocatori);
    stato.lista = lista;
    const corrente = stato.prossima != null;
    wrap.innerHTML = `
    ${controlli()}
    <p class="tr-lede">${vista === 'up'
        ? `Players scoring more over their last ${recenti} games than before — and whether it's the kind of change that lasts.`
        : `Players scoring less over their last ${recenti} games than before — and whether it's the kind of change that lasts.`}
        ${corrente ? `Weeks 1–${stato.chiuseFino} counted; week ${stato.prossima} is added once it's complete.` : ''}</p>
    <div class="tr-list">${lista.length
        ? limitedRows(lista.map((p, i) => riga(p, i)), VISIBILI, 'trends')
        : `<p class="an-footnote">No player matches these filters.</p>`}</div>
    ${notaMetodo()}`;

    bindPickDropdown(wrap, (id, value) => {
        if (id === 'pos') ruolo = value;
        else if (id === 'show') soloLiberi = value === 'available';
        else if (id === 'win') recenti = Number(value) || 4;
        render();
    });
    montaGhiera(wrap.querySelector('.tr-tabs'));
    hydrateImages(wrap);
}

/** Le barre partita per partita, con la media delle due meta' sopra. */
function sparkline(p) {
    const games = p.games;
    const W = 7, GAP = 2, H = 34;
    const max = Math.max(10, ...games.map(g => g.pts));
    const y = (v) => H - Math.max(0, v) / max * (H - 2);
    const nPrima = games.length - recenti;
    const x0 = (i) => i * (W + GAP);
    const larg = games.length * (W + GAP) - GAP;
    const barre = games.map((g, i) => {
        const h = Math.max(1.5, H - y(g.pts));
        const cls = i >= nPrima ? 'tr-bar-r' : 'tr-bar-e';
        return `<rect class="${cls}" x="${x0(i)}" y="${H - h}" width="${W}" height="${h}" rx="1.5">
            <title>Week ${g.w}${g.opp ? ` vs ${g.opp}` : ''} · ${fmt(g.pts, 1)} pts</title></rect>`;
    }).join('');
    const linea = (da, a, v, cls) => `<line class="${cls}" x1="${x0(da)}" x2="${x0(a) - GAP}" y1="${y(v)}" y2="${y(v)}"/>`;
    return `<svg class="tr-spark" viewBox="0 0 ${larg} ${H}" width="${larg}" height="${H}" role="img"
        aria-label="Points per game: ${fmt(p.early.ppg, 1)} before, ${fmt(p.recent.ppg, 1)} in the last ${recenti}">
        ${barre}
        ${linea(0, nPrima, p.early.ppg, 'tr-avg-e')}
        ${linea(nPrima, games.length, p.recent.ppg, 'tr-avg-r')}
    </svg>`;
}

/** Il motore del cambiamento: volume o efficienza, quello che pesa di piu'. */
function motore(p) {
    return Math.abs(p.volume) >= Math.abs(p.efficienza) ? 'volume' : 'efficiency';
}

/**
 * Quanto balla: la fascia nel suo ruolo e lo scarto tipo. I tre trattini sono
 * la fascia anche senza leggere la parola (uno acceso = steady).
 */
function cellaCostanza(p) {
    const s = p.swing;
    const f = s.fascia ? FASCE[s.fascia] : null;
    const livello = { steady: 1, normal: 2, swingy: 3 }[s.fascia] || 0;
    const tacche = [1, 2, 3].map(i => `<i class="${i <= livello ? 'on' : ''}"></i>`).join('');
    return `
        <span class="tr-cons" title="How far a typical game lands from his level: ±${fmt(s.sd, 1)} points${f ? ` — ${f.frase} ${NOMI_RUOLO[p.pos]}` : ''}">
            <span class="tr-cons-k">${f ? f.label : '—'}<span class="tr-cons-meter" aria-hidden="true">${tacche}</span></span>
            <span class="tr-cons-n">±${fmt(s.sd, 1)} a game</span>
        </span>`;
}

function chipCalendario(x) {
    if (x.bye) return `<span class="tr-opp tr-opp--bye" title="Week ${x.w}: bye">BYE</span>`;
    return `<span class="tr-opp tr-opp--${fascia(x.f)}" title="Week ${x.w}: ${x.home ? 'vs' : '@'} ${x.opp} — allows ${calPct(x.f)} vs average">${x.home ? '' : '@'}${x.opp}</span>`;
}

function riga(p, i) {
    const info = stato.rose(p.name);
    const sq = info?.finale ? TEAMS[info.finale] : null;
    const badge = sq ? ` <span class="an-badge ld-team-badge" style="--team-color:${sq.color}">${sq.name}</span>` : '';
    const m = motore(p);
    const o = p.outlook;
    const su = p.delta > 0;
    const outlook = o ? `
        <div class="tr-out">
            <span class="tr-k">Next ${o.giornate.length}</span>
            <span class="tr-proj">${fmt(o.proj, 1)}<small> /g</small></span>
            <span class="tr-opps">${o.giornate.map(chipCalendario).join('')}</span>
        </div>` : `<div class="tr-out tr-out--none"><span class="tr-k">Season over</span></div>`;
    return `
    <div class="tr-row" data-tr-open="${i}" tabindex="0" role="button" aria-expanded="false">
        <span class="ld-rank">${i + 1}</span>
        ${headshotImg({ name: p.name, position: p.pos, nflTeam: p.team })}
        <span class="tr-who">
            <span class="tr-name">${p.name}</span>
            <span class="tr-meta">${posBadge(p.pos)} <span class="ld-nfl">${p.team || ''}</span>${badge}</span>
        </span>
        ${sparkline(p)}
        <span class="tr-ppg">
            <span class="tr-ppg-pair">${fmt(p.early.ppg, 1)} <span aria-hidden="true">→</span> <b>${fmt(p.recent.ppg, 1)}</b></span>
            <span class="tr-delta tr-delta--${su ? 'up' : 'down'}">${segno(p.delta)} /g</span>
        </span>
        ${cellaCostanza(p)}
        <span class="tr-why">
            <span class="tr-chip tr-chip--${m}" title="${m === 'volume'
                ? 'Most of the change comes from how many opportunities he gets'
                : 'Most of the change comes from what he does with them — big plays and TDs'}">${m === 'volume' ? 'Volume' : 'Efficiency'}</span>
            <span class="tr-why-nums">vol ${segno(p.volume)} · eff ${segno(p.efficienza)}</span>
        </span>
        ${outlook}
        <span class="an-chevron">›</span>
    </div>
    <div class="tr-detail" data-tr-detail="${i}" hidden></div>`;
}

/* ============================================================
   DETTAGLIO — il perche', riga per riga
   ============================================================ */

/** La quota di squadra che e' cambiata di piu', in parole. */
function quotaPrincipale(p) {
    const voci = [
        { nome: 'target share', a: p.early.tgtShare, b: p.recent.tgtShare, ok: p.pos !== 'QB' },
        { nome: 'carry share', a: p.early.carShare, b: p.recent.carShare, ok: p.pos === 'RB' || p.pos === 'QB' },
        { nome: 'snap share', a: p.early.snapShare, b: p.recent.snapShare, ok: p.pos !== 'QB' },
    // Solo le quote che vanno nello STESSO verso del volume: Coker 2026 perdeva
    // palloni mentre i suoi snap salivano, e la frase "volume −6,9 (snap share
    // 67% → 79%)" si contraddiceva da sola.
    ].filter(v => v.ok && v.a != null && v.b != null && Math.sign(v.b - v.a) === Math.sign(p.volume));
    if (!voci.length) return null;
    return voci.sort((x, y) => Math.abs(y.b - y.a) - Math.abs(x.b - x.a))[0];
}

function verdetto(p) {
    const frasi = [];
    const su = p.delta > 0;
    frasi.push(`<b>${segno(p.delta)} points per game</b> over his last ${recenti} games (${fmt(p.early.ppg, 1)} before, ${fmt(p.recent.ppg, 1)} now).`);

    const q = quotaPrincipale(p);
    const vol = p.pos === 'QB'
        ? `pass attempts ${fmt(p.early.paPg, 1)} → ${fmt(p.recent.paPg, 1)} a game`
        : q ? `${q.nome} ${pct(q.a)} → ${pct(q.b)}` : `${fmt(p.early.occ, 1)} → ${fmt(p.recent.occ, 1)} opportunities a game`;
    frasi.push(`Volume accounts for <b>${segno(p.volume)}</b> (${vol}); efficiency for <b>${segno(p.efficienza)}</b>${
        Math.abs(p.td) >= 0.5 ? ` — ${segno(p.td)} of it from touchdowns ${p.td > 0 ? 'beyond' : 'short of'} what his red-zone chances were worth` : ''}.`);

    frasi.push(motore(p) === 'volume'
        ? (su ? 'Mostly more opportunities — the kind of change that tends to stick.'
            : 'Mostly fewer opportunities — a role change, which tends to stick.')
        : (su ? 'Mostly efficiency — the kind of hot streak that usually fades.'
            : 'Mostly efficiency — the kind of cold streak that usually passes.'));

    frasi.push(fraseCostanza(p));

    const dSched = p.recent.sched - p.early.sched;
    if (Math.abs(dSched) >= 0.05) {
        frasi.push(`His recent opponents were ${dSched > 0 ? 'easier' : 'tougher'}: they allowed ${calPct(p.recent.sched)} vs average to ${NOMI_RUOLO[p.pos]}, against ${calPct(p.early.sched)} before.`);
    } else {
        frasi.push(`The schedule doesn't explain it: recent opponents (${calPct(p.recent.sched)}) were about as tough as the earlier ones (${calPct(p.early.sched)}).`);
    }

    const o = p.outlook;
    if (o) {
        const vsSeason = o.proj - p.all.ppg;
        const cal = Math.abs(o.fCal - 1) < 0.04 ? 'an average schedule' : `a ${o.fCal > 1 ? 'friendly' : 'tough'} schedule (${calPct(o.fCal)})`;
        frasi.push(`<b>Next ${o.giornate.length} weeks: ${fmt(o.proj, 1)} a game expected</b> — ${segno(vsSeason)} on his season average of ${fmt(p.all.ppg, 1)}, with ${cal}${
            o.giornate.some(x => x.bye) ? ' and a bye' : ''}.`);
    }
    return frasi.map(f => `<p>${f}</p>`).join('');
}

/**
 * Quanto balla, e se il cambio sta dentro le sue oscillazioni normali. La
 * seconda parte e' la piu' utile: con un giocatore che va da 4 a 25, quattro
 * partite buone possono essere solo il caso.
 */
function fraseCostanza(p) {
    const s = p.swing;
    const f = s.fascia ? FASCE[s.fascia] : null;
    const chi = f ? `${f.frase} ${NOMI_RUOLO[p.pos]}` : 'his scores';
    const base = `<b>${f ? f.label : 'Swing'}: a typical game lands ±${fmt(s.sd, 1)} from his level</b>${f ? ` — ${chi}` : ''}. Over the season his floor is ${fmt(s.floor, 1)} and his ceiling ${fmt(s.ceiling, 1)}; ${s.starts} of his ${p.games.length} games reached the starter line (${fmt(s.linea, 1)}).`;
    const t = Math.abs(s.t ?? 0);
    const rumore = s.t == null ? ''
        : t >= 2 ? ` A change this size is well beyond his normal game-to-game swings.`
        : t >= 1 ? ` The change is bigger than his normal swings, but not by much.`
        : ` The change sits inside his normal swings: on scores this jumpy, ${recenti} games can look like this by chance.`;
    return base + rumore;
}

function tabellaDettaglio(p) {
    const e = p.early, r = p.recent;
    const qb = p.pos === 'QB';
    const righe = [
        ['Fantasy points per game', fmt(e.ppg, 1), fmt(r.ppg, 1), segno(r.ppg - e.ppg)],
        ['Opportunities per game', fmt(e.occ, 1), fmt(r.occ, 1), segno(r.occ - e.occ)],
        ...(qb ? [['Pass attempts per game', fmt(e.paPg, 1), fmt(r.paPg, 1), segno(r.paPg - e.paPg)]] : []),
        ...(p.pos !== 'QB' ? [['Targets per game', fmt(e.tgtPg, 1), fmt(r.tgtPg, 1), segno(r.tgtPg - e.tgtPg)]] : []),
        ...(p.pos === 'RB' || qb ? [['Carries per game', fmt(e.carPg, 1), fmt(r.carPg, 1), segno(r.carPg - e.carPg)]] : []),
        ...(!qb ? [['Target share', pct(e.tgtShare), pct(r.tgtShare), pctDelta(e.tgtShare, r.tgtShare)]] : []),
        ...(p.pos === 'RB' || qb ? [['Carry share', pct(e.carShare), pct(r.carShare), pctDelta(e.carShare, r.carShare)]] : []),
        ...(p.pos === 'WR' || p.pos === 'TE' ? [['Air yards share', pct(e.airShare), pct(r.airShare), pctDelta(e.airShare, r.airShare)]] : []),
        ...(!qb ? [['Snap share', pct(e.snapShare), pct(r.snapShare), pctDelta(e.snapShare, r.snapShare)]] : []),
        ['Red-zone opportunities per game', fmt(e.rzPg, 1), fmt(r.rzPg, 1), segno(r.rzPg - e.rzPg)],
        ['Points his volume is worth', fmt(e.xppg, 1), fmt(r.xppg, 1), segno(r.xppg - e.xppg)],
        ['Points above that (efficiency)', segno(e.ppg - e.xppg), segno(r.ppg - r.xppg), segno(p.efficienza)],
        ['TD points vs red-zone expectation', segno(e.tdPts - e.xTdPts), segno(r.tdPts - r.xTdPts), segno(p.td)],
        [`Opponents vs average (to ${NOMI_RUOLO[p.pos]})`, calPct(e.sched), calPct(r.sched), segno((r.sched - e.sched) * 100, 0)],
        ['Game-to-game swing (±)', fmt(p.swing.sdEarly, 1), fmt(p.swing.sdRecent, 1), segno(p.swing.sdRecent - p.swing.sdEarly)],
    ];
    return `
    <div class="tr-table-wrap">
    <table class="tr-table">
        <thead><tr><th></th><th>Before <small>${e.g} G</small></th><th>Last ${recenti}</th><th>Change</th></tr></thead>
        <tbody>${righe.map(([k, a, b, d]) => `<tr><th scope="row">${k}</th><td>${a}</td><td>${b}</td><td>${d}</td></tr>`).join('')}</tbody>
    </table>
    </div>`;
}

function prossimeDettaglio(p) {
    const o = p.outlook;
    if (!o) return '';
    return `
    <div class="tr-next">
        <span class="tr-k">Next ${o.giornate.length} weeks</span>
        <div class="tr-next-list">${o.giornate.map(x => x.bye
            ? `<span class="tr-next-g tr-opp--bye"><b>W${x.w}</b> Bye</span>`
            : `<span class="tr-next-g tr-opp--${fascia(x.f)}"><b>W${x.w}</b> ${x.home ? 'vs' : '@'} ${x.opp} <small>${calPct(x.f)}</small></span>`).join('')}</div>
        <p class="tr-next-note">Percentages: fantasy points each defense has allowed to ${NOMI_RUOLO[p.pos]} this season, vs the league average.
           Expected ${fmt(o.base, 1)} a game before the schedule, ${fmt(o.proj, 1)} after it.</p>
    </div>`;
}

function apriDettaglio(row) {
    const i = Number(row.dataset.trOpen);
    const p = stato?.lista?.[i];
    const box = document.querySelector(`.tr-detail[data-tr-detail="${i}"]`);
    if (!p || !box) return;
    const aperto = row.classList.toggle('expanded');
    row.setAttribute('aria-expanded', String(aperto));
    box.hidden = !aperto;
    if (!aperto || box.dataset.loaded) return;
    box.dataset.loaded = '1';
    const link = `#player/${stato.anno}/${encodeURIComponent(p.pos)}/${encodeURIComponent(p.name)}`;
    box.innerHTML = `
        <div class="tr-verdict">${verdetto(p)}</div>
        ${tabellaDettaglio(p)}
        ${prossimeDettaglio(p)}
        <div class="ld-drill-foot"><a href="${link}">Full player page →</a></div>`;
}

function notaMetodo() {
    return `
    <p class="an-footnote">How to read it. The change in points per game splits into two parts that add up to it:
       <b>volume</b> — what his targets, carries and pass attempts are worth at the league-average rate for his
       position — and <b>efficiency</b>, everything he scores above or below that: yards after the catch, long plays,
       and above all touchdowns. Shares are of his team's targets, carries, air yards and offensive snaps in the same games.
       Only players who could be on a roster are listed: in at least one of the two halves they averaged as much as the
       player ranked at twice the number of league starters at his position (starters plus bench).</p>
    <p class="an-footnote">Swing is how far a typical game lands from his level (the standard deviation), measured inside the
       two halves separately — a player who moved up or down a level isn't swingy for it. Steady, normal and swingy split the
       rostered players at each position into thirds by swing relative to their season average. Floor and ceiling are the 25th
       and 75th percentile of his games, as in Player Stats; the starter line is the average of the last player the league starts
       at that position. It describes his season, it doesn't predict the rest of it: measured on
       2022–2025, how steady a player is in half of his games says almost nothing about the other half (a correlation near zero
       for QBs, WRs and TEs, about 0.4 for RBs). Its real use is the line in the detail: whether the change is bigger than his
       normal swings, or the kind of gap a few games produce by chance.</p>
    <p class="an-footnote">The forecast for the next weeks was measured on 10,036 cases from 2022–2025, each tested on a season left
       out of the fit. Recent <i>points</i> barely predict the next games — the season average does better than the last four —
       but recent <i>volume</i> does: a role change lasts, a hot or cold streak doesn't. The schedule matters less than it seems:
       a set of opponents allowing 20% more than average is worth about +9% for a running back and +2–4% for the other positions.</p>`;
}

function bindContent() {
    const wrap = document.getElementById('trends-content');
    if (!wrap) return;
    wrap.addEventListener('click', (e) => {
        const more = e.target.closest('[data-trends-more]');
        if (more) {
            toggleExtraRows(more);
            const box = more.previousElementSibling;
            if (box && !box.hidden) hydrateImages(box);
            return;
        }
        const tab = e.target.closest('[data-tr-vista]');
        if (tab) {
            if (vista !== tab.dataset.trVista) { vista = tab.dataset.trVista; render(); }
            return;
        }
        if (e.target.closest('.tr-detail a')) return;
        const row = e.target.closest('[data-tr-open]');
        if (row) apriDettaglio(row);
    });
    wrap.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        const row = e.target.closest('[data-tr-open]');
        if (row) { e.preventDefault(); apriDettaglio(row); }
    });
}
