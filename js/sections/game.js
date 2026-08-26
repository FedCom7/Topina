/**
 * Game Analysis — pagina analisi di un singolo matchup.
 * Route: #game/{year}/{week}/{indice matchup}
 *
 * Ordine: score bug → recap → testa a testa (formazioni) → come si è formato il
 * margine (dumbbell slot per slot) → punto a punto nel weekend → ogni giocatore
 * rispetto alla sua media → squadra contro squadra → punti lasciati in
 * panchina → forma delle due squadre.
 *
 * I grafici vengono da js/ui/charts.js, lo stesso linguaggio di Draft Grade,
 * Player NFL e Team NFL: SVG sobri, griglia appena accennata, etichette dirette
 * a fine serie invece della legenda. Nessuno di essi costa una chiamata di rete
 * in più: i dati erano già tutti in pagina.
 */

import { fetchFantasyData, displayName, teamNameHTML, getSeasonConfig } from '../data.js?v=534';
import { TEAM_KEYS } from '../data/team-config.js?v=533';
import { getLeagueData } from '../data/league-data.js?v=534';
import { getHonorsBundle } from '../data/honors.js?v=585';
import { buildCareers } from '../data/careers.js?v=596';
import { getWeekSchedule, canonAbbr } from '../data/nfl-schedule.js?v=523';
import {
    slotPairs, weekPosRanks, diffMakers, teamStatTotals, seasonAvg,
    playerComment, playerNotes, recapArticle,
} from '../data/matchup-analysis.js?v=527';
import { dumbbell, dotPlot, multiLine, inkFor } from '../ui/charts.js?v=7';
import { TEAMS } from './team.js?v=601';
import { playerImageService } from '../services/player-image-service.js?v=516';

const _fantasyCache = {};
const fmt = (n) => (+n).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const P = (p) => parseFloat(p?.fantasy_points) || 0;

function teamOf(rawName) {
    return TEAMS[TEAM_KEYS[displayName(rawName)]] || null;
}

export async function initGame() {
    const section = document.getElementById('game');
    if (!section) return;

    // #game/2025/17/0
    const [, year, weekStr, idxStr] = location.hash.slice(1).split('/');
    const week = parseInt(weekStr), idx = parseInt(idxStr);
    section.innerHTML = `<div class="section-inner"><div class="loading-state"><div class="spinner"></div><p>Loading analysis...</p></div></div>`;

    try {
        if (!_fantasyCache[year]) _fantasyCache[year] = await fetchFantasyData(year);
        const data = _fantasyCache[year];
        const weekData = data?.weeks?.[String(week)];
        const m = weekData?.matchups?.[idx];
        if (!m?.team1 || !m?.team2) {
            section.innerHTML = `<div class="section-inner"><div class="empty-state"><p class="empty-state-text">Matchup not found</p></div></div>`;
            return;
        }

        const [bundle, league, sched, careers] = await Promise.all([
            getHonorsBundle(year), getLeagueData(),
            getWeekSchedule(year, week).catch(() => null),
            buildCareers().catch(() => null),
        ]);
        const ranks = weekPosRanks(weekData);
        const config = getSeasonConfig(year);

        // Live: la partita NFL di un giocatore è in corso ORA (kickoff reale
        // ESPN + durata stimata ~3h15). Per le stagioni passate è sempre false.
        const now = Date.now();
        const liveNow = (p) => {
            const w = p?.nfl_team ? sched?.get(canonAbbr(p.nfl_team)) : null;
            return !!w && now >= w.start.getTime() && now <= w.end.getTime();
        };
        const anyLive = [m.team1, m.team2].some(team =>
            [...(team.starters || []), ...(team.bench || [])].some(liveNow));

        // La sfida è andata in archivio? `winner` lo dice per i dati nuovi; i
        // più vecchi non hanno il campo e sono per forza finiti. Senza questo
        // controllo il recap veniva scritto anche su una partita mai giocata —
        // punteggi a zero e nemmeno una formazione da raccontare.
        const conclusa = !('winner' in m)
            ? true
            : m.winner !== 'UNDECIDED'
            || P({ fantasy_points: m.team1.score }) > 0 || P({ fantasy_points: m.team2.score }) > 0;
        const daGiocare = !conclusa && !anyLive;
        // i blocchi "a bocce ferme" escono solo a partita archiviata
        const finita = conclusa && !anyLive;
        const isPlayoff = week === config.playoffWeek;
        const isSB = week === config.superBowlWeek;
        const weekLabel = isSB ? 'Super Bowl' : isPlayoff ? 'Playoffs' : `Week ${week}`;

        // precedenti stagionali dal punto di vista del vincitore
        const winnerRaw = P({ fantasy_points: m.team1.score }) >= P({ fantasy_points: m.team2.score }) ? m.team1 : m.team2;
        const loserRaw = winnerRaw === m.team1 ? m.team2 : m.team1;
        const wKey = TEAM_KEYS[displayName(winnerRaw.name)];
        const lKey = TEAM_KEYS[displayName(loserRaw.name)];
        const seriesGames = (league.seasons.find(s => s.year === year)?.perTeam?.[wKey]?.games || [])
            .filter(g => g.opp === lKey && g.week < week);

        const article = recapArticle(m, bundle, ranks, {
            year, weekNum: week, weekLabel, isPlayoff, isSB, seriesGames,
            teamName: (raw) => teamOf(raw)?.name || displayName(raw),
        });
        const dm = diffMakers(m);
        const notes = playerNotes(m, bundle, ranks);

        // Con almeno una partita live, niente sezioni "a bocce ferme":
        // recap, difference maker e protagonisti arrivano a partite finite.
        section.innerHTML = `
        <div class="section-inner gb-page">
            <a class="gb-back" href="#game-center"><span aria-hidden="true">←</span> Game Center</a>
            ${scoreBugHTML(m, weekLabel, year, anyLive, daGiocare)}
            ${anyLive || daGiocare ? '' : articleHTML(article, weekLabel)}
            ${daGiocare ? `
            <div class="mosaic-card mc-wide gb-card mc-in">
                <span class="mc-kicker">${weekLabel} · ${year}</span>
                <h2 class="mc-title">Not played yet</h2>
                <p class="mc-body">The recap, the difference makers and the player notes
                   show up once the matchup is over.</p>
            </div>` : ''}
            ${outcomeHTML(m, liveNow)}
            ${finita ? marginCardHTML(m, dm, bundle, ranks) : ''}
            <div class="mosaic-card mc-wide gb-card mc-in" id="gb-chart-card">
                <span class="mc-kicker">Weekend trend</span>
                <h2 class="mc-title">Point by point</h2>
                <p class="gb-card-sub">Points accumulate while the starters' real NFL games are played.</p>
                <div class="mc-body" id="gb-chart">
                    <div class="loading-state"><div class="spinner"></div><p>Loading NFL schedule...</p></div>
                </div>
            </div>
            ${finita ? notesHTML(notes, m, bundle, careers, year) : ''}
            <div class="gb-halves">
                ${statBarsHTML(m)}
                ${finita ? benchCardHTML(m, bundle) : ''}
            </div>
            ${finita ? formCardHTML(m, league, year, week) : ''}
        </div>`;

        loadHeadshots(section, year);
        bindAvgSwitch(section);
        renderChart(m, year, week);
    } catch (e) {
        console.error('[Game] errore analisi:', e);
        section.innerHTML = `<div class="section-inner"><div class="empty-state"><p class="empty-state-text">Error loading the analysis</p></div></div>`;
    }
}

// ─── Score bug ───────────────────────────────────────────────────

function scoreBugHTML(m, weekLabel, year, isLive = false, daGiocare = false) {
    const s1 = P({ fantasy_points: m.team1.score });
    const s2 = P({ fantasy_points: m.team2.score });
    const t1 = teamOf(m.team1.name), t2 = teamOf(m.team2.name);
    const side = (t, raw) => `
        <div class="gb-bug-side">
            <span class="gb-bug-name">${teamNameHTML(t?.name || displayName(raw.name))}</span>
        </div>`;
    return `
    <div class="gb-scorebug" style="--tc1:${t1?.color || 'var(--accent-red)'};--tc2:${t2?.color || 'var(--accent-blue)'}">
        ${isLive ? '<span class="gb-live-badge"><i class="gb-live-dot"></i>LIVE</span>' : ''}
        ${t1 ? `<img class="gb-bug-wm gb-bug-wm-l" src="${t1.logo}" alt="" aria-hidden="true">` : ''}
        ${t2 ? `<img class="gb-bug-wm gb-bug-wm-r" src="${t2.logo}" alt="" aria-hidden="true">` : ''}
        <div class="gb-bug-inner">
            ${side(t1, m.team1)}
            <span class="gb-bug-score${s1 >= s2 ? ' winner' : ''}">${fmt(s1)}</span>
            <div class="gb-bug-mid">
                ${isLive
                    ? '<span class="gb-bug-final gb-bug-final--live"><i class="gb-live-dot"></i> Live</span>'
                    : daGiocare
                        // "Final" su una sfida mai giocata diceva il falso
                        ? '<span class="gb-bug-final">Scheduled</span>'
                        : '<span class="gb-bug-final">Final</span>'}
                <span class="gb-bug-week">${weekLabel} · ${year}</span>
            </div>
            <span class="gb-bug-score${s2 >= s1 ? ' winner' : ''}">${fmt(s2)}</span>
            ${side(t2, m.team2)}
        </div>
    </div>`;
}

// ─── Confronto punti per ruolo ───────────────────────────────────

async function renderChart(m, year, week) {
    const el = document.getElementById('gb-chart');
    if (!el) return;
    const sched = await getWeekSchedule(year, week);
    if (!sched) {
        document.getElementById('gb-chart-card')?.remove();
        return;
    }
    el.innerHTML = buildChartSVG(m, sched);
}

function buildChartSVG(m, sched) {
    const t1 = teamOf(m.team1.name), t2 = teamOf(m.team2.name);
    const nomi = [t1?.name || displayName(m.team1.name), t2?.name || displayName(m.team2.name)];
    const inchiostri = [inkFor(t1?.color), inkFor(t2?.color)];

    const mkSeries = (team) => (team.starters || []).map(p => ({
        pts: P(p), name: p.name, win: sched.get(canonAbbr(p.nfl_team)) || null,
    }));
    const rose = [mkSeries(m.team1), mkSeries(m.team2)];

    const conPartita = rose.flat().filter(x => x.win);
    if (!conPartita.length) return '<p class="mc-text">Schedule not available for this week.</p>';
    const t0 = Math.min(...conPartita.map(x => x.win.start.getTime()));
    const tEnd = Math.max(...conPartita.map(x => x.win.end.getTime()));
    rose.forEach(list => list.forEach(x => {
        if (!x.win) x.win = { start: new Date(t0), end: new Date(tEnd) };
    }));
    const pad = 25 * 60 * 1000;
    const T0 = t0 - pad, T1 = tEnd + pad;

    // I punti di un giocatore maturano dentro la finestra della sua partita:
    // interpolazione lineare, come prima. È la parte di valore del grafico.
    const valueAt = (list, t) => list.reduce((s, x) => {
        const a = x.win.start.getTime(), b = x.win.end.getTime();
        const f = t <= a ? 0 : t >= b ? 1 : (t - a) / (b - a);
        return s + x.pts * f;
    }, 0);

    const istanti = [...new Set([T0, T1, ...rose.flat().flatMap(x => [x.win.start.getTime(), x.win.end.getTime()])])]
        .sort((a, b) => a - b);
    const serie = rose.map((list, i) => ({
        name: nomi[i],
        color: inchiostri[i],
        values: istanti.map(ms => ({ x: ms, y: valueAt(list, ms) })),
    }));

    // Tick sull'asse dei tempi: i kickoff distinti, accorpati entro 40 minuti.
    const oraFmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Rome', hour: '2-digit', minute: '2-digit' });
    const giornoFmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Rome', weekday: 'short' });
    const kick = [...new Set(conPartita.map(x => x.win.start.getTime()))].sort((a, b) => a - b);
    const xTicks = [];
    let ultimo = -Infinity;
    kick.forEach(k => {
        if (k - ultimo < 40 * 60 * 1000) return;
        ultimo = k;
        xTicks.push({ x: k, label: `${giornoFmt.format(new Date(k))} ${oraFmt.format(new Date(k))}`.replace('.', '') });
    });

    // Callout sull'ultimo sorpasso: è il momento che decide la partita, e a
    // parole si capisce meglio che da un incrocio di linee.
    let sorpasso = null;
    for (let i = 1; i < istanti.length; i++) {
        const primaA = valueAt(rose[0], istanti[i - 1]), primaB = valueAt(rose[1], istanti[i - 1]);
        const dopoA = valueAt(rose[0], istanti[i]), dopoB = valueAt(rose[1], istanti[i]);
        if (Math.sign(primaA - primaB) !== Math.sign(dopoA - dopoB) && Math.abs(dopoA - dopoB) > 0.5) {
            sorpasso = { x: istanti[i], y: dopoA, chi: dopoA > dopoB ? nomi[0] : nomi[1] };
        }
    }
    const callout = sorpasso
        ? { x: sorpasso.x, y: sorpasso.y, text: `${sorpasso.chi} takes the lead · ${oraFmt.format(new Date(sorpasso.x))}` }
        : null;

    return multiLine(serie, { height: 320, xTicks, callout, yFmt: (v) => String(Math.round(v)) });
}

// ─── Articolo + tabella outcome ──────────────────────────────────

function articleHTML(article, weekLabel) {
    return `
    <article class="mosaic-card gb-card gb-article mc-in">
        <span class="mc-kicker">${article.dateline}</span>
        <h2 class="gb-article-headline">${article.headline}</h2>
        ${article.paras.map(p => `<p class="gb-article-p">${p}</p>`).join('')}
    </article>`;
}

function outcomeHTML(m, liveNow = () => false) {
    const pairs = slotPairs(m);
    // "Marvin Guiu" → "M. Guiu" (mobile); le DEF restano col nome squadra intero
    const shortName = (p) => {
        const role = (p.position_in_team || p.position || '').toUpperCase();
        if (role === 'DEF') return p.name;
        const parts = String(p.name).trim().split(/\s+/);
        return parts.length < 2 ? p.name : `${parts[0][0]}. ${parts.slice(1).join(' ')}`;
    };
    // Foto tonda del giocatore, come nel confronto del Live. Il `src` parte dal
    // segnaposto e lo sostituisce loadHeadshots(), che gira già su .gb-headshot.
    const foto = (p) => p
        ? `<img class="gb-headshot gb-headshot-xs" src="images/fallback-player.svg" alt=""
               data-player-name="${p.name}" data-team="${p.nfl_team || ''}"
               data-pos="${p.position_in_team || p.position || ''}">`
        : '<span class="gb-headshot gb-headshot-xs gb-headshot--empty"></span>';

    const cell = (p) => {
        if (!p) return '<div class="gb-out-player"><span class="gb-out-name">—</span></div>';
        return `
        <div class="gb-out-player">
            <span class="gb-out-name">${liveNow(p) ? '<i class="gb-live-dot"></i>' : ''}<span class="gb-out-name-full">${p.name}</span><span class="gb-out-name-short">${shortName(p)}</span></span>
            <span class="gb-out-meta">${(p.position_in_team || p.position || '')} - ${p.nfl_team || ''}${p.opponent ? ` | vs ${p.opponent.replace('@', '')}` : ''}</span>
        </div>`;
    };
    // Mini-stat a valori (2-3 per ruolo): numero sopra, etichetta micro sotto.
    // I primi due candidati escono sempre, il resto solo se > 0.
    const miniStats = (p) => {
        const s = p?.stats || {};
        const n = (v) => Number(v) || 0;
        const role = (p?.position_in_team || p?.position || '').toUpperCase();
        const CANDIDATES = {
            QB: [[n(s.pass_yds), 'pass yd'], [n(s.pass_td), 'td'], [n(s.pass_int), 'int'], [n(s.rush_yds), 'rush yd']],
            RB: [[n(s.rush_yds), 'rush yd'], [n(s.rush_td), 'td'], [n(s.rec_yds), 'rec yd'], [n(s.rec_td), 'rec td']],
            WR: [[n(s.rec), 'rec'], [n(s.rec_yds), 'rec yd'], [n(s.rec_td), 'td']],
            TE: [[n(s.rec), 'rec'], [n(s.rec_yds), 'rec yd'], [n(s.rec_td), 'td']],
            K: [[n(s.fg_0_19) + n(s.fg_20_29) + n(s.fg_30_39) + n(s.fg_40_49) + n(s.fg_50_plus), 'fg'], [n(s.pat_made), 'xp']],
            DEF: [[n(s.sack), 'sack'], [n(s.def_int) + n(s.fum_rec), 'to'], [n(s.def_td), 'td']],
        };
        const list = CANDIDATES[role] || CANDIDATES[role === 'W/R' ? 'WR' : role] || [];
        return list.filter(([v], i) => i < 2 || v > 0).slice(0, 3);
    };
    const stat = (p, sideCls) => {
        const tiles = p ? miniStats(p) : [];
        return `<span class="gb-out-stat ${sideCls}">${tiles.map(([v, l]) => `
            <span class="gb-out-mini"><b>${v}</b><i>${l}</i></span>`).join('')}</span>`;
    };
    const rowFor = (slot, a, b, extraCls = '') => {
        const pa = P(a), pb = P(b);
        const posBadge = `<span class="allpro-pos pos-${slot.toLowerCase().replace('/', '')}">${slot}</span>`;
        return `
        <div class="gb-out-row${extraCls}">
            ${posBadge}
            ${foto(a)}
            ${cell(a)}
            ${stat(a, 'gb-out-stat--l')}
            <span class="gb-out-pts${pa > pb ? ' win' : ''}">${pa.toFixed(2)}</span>
            <span class="gb-out-pts${pb > pa ? ' win' : ''}">${pb.toFixed(2)}</span>
            ${stat(b, 'gb-out-stat--r')}
            ${cell(b)}
            ${foto(b)}
            ${posBadge}
        </div>`;
    };
    const rows = pairs.map(({ slot, a, b }) => rowFor(slot, a, b)).join('');

    // Panchinari: sotto i titolari, stesse righe appaiate (slot BN)
    const bench1 = m.team1.bench || [];
    const bench2 = m.team2.bench || [];
    const maxBench = Math.max(bench1.length, bench2.length);
    let benchRows = '';
    for (let i = 0; i < maxBench; i++) {
        benchRows += rowFor('BN', bench1[i] || null, bench2[i] || null, ' gb-out-row--bn');
    }
    if (benchRows) benchRows = `<div class="gb-out-sep">Bench</div>${benchRows}`;

    return `
    <aside class="mosaic-card mc-wide gb-card gb-outcome mc-in">
        <span class="mc-kicker">Head to head</span>
        <div class="gb-out-rows">${rows}${benchRows}</div>
    </aside>`;
}

// ─── Barre stats di squadra ──────────────────────────────────────

/**
 * Confronto fra due squadre su più misure con ordini di grandezza diversi
 * (yard contro touchdown): una riga per voce, ognuna normalizzata sul proprio
 * massimo, valore a sinistra e a destra. Un asse condiviso qui mentirebbe.
 * Stessa forma del confronto di squadra del Live.
 */
function confrontoRighe(voci, t1, t2) {
    const righe = voci.map(({ label, a, b, fmt: f, giuMeglio }) => {
        const fv = f || ((v) => String(Math.round(v)));
        const tot = a + b;
        const pct = tot > 0 ? Math.round((a / tot) * 100) : 50;
        const vinceA = a === b ? null : giuMeglio ? a < b : a > b;
        return `
        <div class="live-cmpteam-row">
            <span class="live-cmpteam-val${vinceA === true ? ' is-top' : ''}">${fv(a)}</span>
            <span class="live-cmpteam-mid">
                <span class="live-cmpteam-label">${label}${giuMeglio ? '<i class="live-cmpteam-giu" title="lower is better">↓</i>' : ''}</span>
                <span class="live-cmpteam-bar"><i class="live-cmpteam-fill${giuMeglio ? ' is-inverse' : ''}" style="width:${pct}%"></i></span>
            </span>
            <span class="live-cmpteam-val live-cmpteam-val--r${vinceA === false ? ' is-top' : ''}">${fv(b)}</span>
        </div>`;
    }).join('');

    return `
    <div class="live-cmpteam gb-cmpteam" style="--tc1:${inkFor(t1?.color)};--tc2:${inkFor(t2?.color)}">
        <div class="live-cmpteam-head">
            <span>${t1?.name || 'A'}</span><span class="live-cmpteam-title">head to head</span><span>${t2?.name || 'B'}</span>
        </div>
        ${righe}
    </div>`;
}

function statBarsHTML(m) {
    const a = teamStatTotals(m.team1);
    const b = teamStatTotals(m.team2);
    const t1 = teamOf(m.team1.name), t2 = teamOf(m.team2.name);
    return `
    <div class="mosaic-card gb-card mc-in">
        <span class="mc-kicker">Team comparison</span>
        <h2 class="mc-title">Team against team</h2>
        <p class="gb-card-sub">What the starters produced, line by line.</p>
        <div class="mc-body">${confrontoRighe([
            { label: 'Passing yards', a: a.passYds, b: b.passYds },
            { label: 'Rushing yards', a: a.rushYds, b: b.rushYds },
            { label: 'Receiving yards', a: a.recYds, b: b.recYds },
            { label: 'Touchdowns', a: a.td, b: b.td },
            { label: 'Turnovers', a: a.to, b: b.to, giuMeglio: true },
        ], t1 || { name: displayName(m.team1.name) }, t2 || { name: displayName(m.team2.name) })}</div>
    </div>`;
}

/**
 * Come si è formato il margine: un duello per slot, i due titolari sullo stesso
 * asse. Sotto, i due migliori della giornata con una riga di commento.
 */
function marginCardHTML(m, dm, bundle, ranks) {
    const t1 = teamOf(m.team1.name), t2 = teamOf(m.team2.name);
    const grafico = dumbbell(slotPairs(m).map(({ slot, a, b }) => ({
        label: slot,
        a: P(a), b: P(b),
        tip: `${slot}: ${a?.name || '—'} vs ${b?.name || '—'}`,
    })), {
        a: { name: t1?.name || displayName(m.team1.name), color: t1?.color },
        b: { name: t2?.name || displayName(m.team2.name), color: t2?.color },
        labelW: 62, rowH: 28,
    });
    if (!grafico) return '';

    const protagonista = (p, raw) => {
        if (!p) return '';
        const t = teamOf(raw);
        return `
        <div class="gb-top" style="--tc:${inkFor(t?.color)}">
            <img class="gb-headshot gb-headshot-sm" src="images/fallback-player.svg" alt=""
                 data-player-name="${p.name}" data-team="${p.nfl_team}" data-pos="${p.position_in_team || p.position}">
            <div class="gb-top-body">
                <span class="gb-top-name">${p.name} <small>${fmt(P(p))} pt</small></span>
                <p class="gb-top-text">${playerComment(p, bundle, ranks)}</p>
            </div>
        </div>`;
    };

    return `
    <div class="mosaic-card mc-wide gb-card mc-in">
        <span class="mc-kicker">Difference maker</span>
        <h2 class="mc-title">How the margin was built</h2>
        <p class="gb-card-sub">One row per slot: the two starters on the same axis, the segment
           pointing at whoever is ahead, the gap on the right.</p>
        <div class="mc-body">${grafico}</div>
        <div class="gb-tops">${protagonista(dm.a, m.team1.name)}${protagonista(dm.b, m.team2.name)}</div>
    </div>`;
}

/** Punti lasciati in panchina: reso reale contro formazione ottimale. */
function benchCardHTML(m, bundle) {
    const key = (raw) => TEAM_KEYS[displayName(raw)];
    const a = bundle?.managers?.[key(m.team1.name)];
    const b = bundle?.managers?.[key(m.team2.name)];
    if (!a?.optimal || !b?.optimal) return '';
    const t1 = teamOf(m.team1.name), t2 = teamOf(m.team2.name);
    const persi = (mg) => Math.max(0, mg.optimal - mg.actual);
    const eff = (mg) => (mg.actual / mg.optimal) * 100;

    return `
    <div class="mosaic-card gb-card mc-in">
        <span class="mc-kicker">Lineup efficiency</span>
        <h2 class="mc-title">Points left on the bench</h2>
        <p class="gb-card-sub">Across the whole season: what the two managers actually started, and
           what they would have started by picking the best lineup every week.</p>
        <div class="mc-body">${confrontoRighe([
            { label: 'Points started', a: a.actual, b: b.actual },
            { label: 'Best possible', a: a.optimal, b: b.optimal },
            { label: 'Left on the bench', a: persi(a), b: persi(b), giuMeglio: true },
            { label: 'Efficiency', a: eff(a), b: eff(b), fmt: (v) => `${v.toFixed(1)}%` },
        ], t1 || { name: displayName(m.team1.name) }, t2 || { name: displayName(m.team2.name) })}</div>
    </div>`;
}

/** Forma delle due squadre: punti settimana per settimana, questa in evidenza. */
function formCardHTML(m, league, year, week) {
    const stagione = league?.seasons?.find(s => s.year === year);
    if (!stagione) return '';
    const t1 = teamOf(m.team1.name), t2 = teamOf(m.team2.name);
    const serie = [[m.team1, t1], [m.team2, t2]].map(([team, t]) => {
        // Tutta la stagione, non solo fino a qui: alla week 1 ci sarebbe un
        // punto solo e il grafico non direbbe niente. La giornata in esame è
        // segnata dal callout.
        const partite = stagione.perTeam?.[TEAM_KEYS[displayName(team.name)]]?.games || [];
        return {
            name: t?.name || displayName(team.name),
            color: inkFor(t?.color),
            values: partite.map(g => ({ x: g.week, y: g.pts })),
        };
    }).filter(s => s.values.length > 1);
    if (serie.length < 2) return '';

    const quiA = serie[0].values.find(v => v.x === week);
    const grafico = multiLine(serie, {
        height: 250,
        xTicks: serie[0].values.filter((_, i) => serie[0].values.length <= 10 || i % 2 === 0)
            .map(v => ({ x: v.x, label: `W${v.x}` })),
        callout: quiA ? { x: week, y: quiA.y, text: 'this week' } : null,
        yFmt: (v) => String(Math.round(v)),
    });

    return `
    <div class="mosaic-card mc-wide gb-card mc-in">
        <span class="mc-kicker">Season form</span>
        <h2 class="mc-title">How the two teams have been going</h2>
        <p class="gb-card-sub">Points week by week across the season: it says whether this game,
           marked on the line, is in character or an outlier.</p>
        <div class="mc-body">${grafico}</div>
    </div>`;
}

// ─── Player notes ────────────────────────────────────────────────

/**
 * Riferimenti disponibili per il confronto: la media di questa stagione, quella
 * dell'anno prima, quella di sempre. Sono punti per presenza DA TITOLARE in
 * tutti e tre i casi, altrimenti i numeri non sarebbero confrontabili.
 */
function riferimenti(bundle, careers, year) {
    const annoPrec = String(Number(year) - 1);
    const modi = [{
        id: 'season', label: 'This season', asse: 'season average',
        avg: (nome) => seasonAvg(bundle, nome),
    }];
    if (careers) {
        modi.push({
            id: 'prev', label: annoPrec, asse: `${annoPrec} average`,
            avg: (nome) => {
                const bs = careers.get(nome)?.bySeason?.[annoPrec];
                return bs?.gamesStarted ? bs.startedPts / bs.gamesStarted : 0;
            },
        });
        modi.push({
            id: 'career', label: 'All time', asse: 'all-time average',
            avg: (nome) => {
                const c = careers.get(nome);
                return c?.gamesStarted ? c.startedPts / c.gamesStarted : 0;
            },
        });
    }
    return modi;
}

function notesHTML(notes, m, bundle, careers, year) {
    const modi = riferimenti(bundle, careers, year);

    // Quattro gruppi per modo: le due squadre, e dentro ognuna titolari e
    // panchina separati. Mescolarli non direbbe di chi è chi.
    const righeDi = (lista, avgDi) => (lista || []).map(p => {
        const avg = avgDi(p.name);
        if (!avg || avg < 4) return null;
        const v = P(p);
        return {
            label: p.name,
            value: v,
            ref: avg,
            meta: `${v >= avg ? '+' : ''}${Math.round(((v - avg) / avg) * 100)}%`,
            tip: `${p.name} — ${fmt(v)} pt, reference ${fmt(avg)}`,
            gap: (v - avg) / avg,
        };
    }).filter(Boolean).sort((x, y) => y.gap - x.gap);

    const gruppo = (titolo, righe, etichettaAsse) => righe.length ? `
        <div class="gb-avg-group">
            <span class="gb-avg-sub">${titolo}</span>
            ${dotPlot(righe, { axisLabel: etichettaAsse, fmt: (v) => fmt(v) })}
        </div>` : '';

    const colonna = (team, modo) => {
        const t = teamOf(team.name);
        const blocchi = gruppo('Starters', righeDi(team.starters, modo.avg), modo.asse)
            + gruppo('Bench', righeDi(team.bench, modo.avg), modo.asse);
        if (!blocchi) return '';
        return `
        <div class="gb-avg-col" style="--tc:${inkFor(t?.color)}">
            <span class="gb-avg-team">${t?.name || displayName(team.name)}</span>
            ${blocchi}
        </div>`;
    };

    // Un modo senza dati (l'anno prima non esiste per la prima stagione) non
    // merita una pillola: si scarta prima di disegnare il selettore.
    const pannelli = modi.map(modo => ({ modo, html: colonna(m.team1, modo) + colonna(m.team2, modo) }))
        .filter(x => x.html);
    if (!pannelli.length) return '';

    const pillole = pannelli.length < 2 ? '' : `
        <div class="year-selector gb-avg-switch">
            ${pannelli.map(({ modo }, i) => `
            <button class="year-pill${i === 0 ? ' active' : ''}" type="button" data-avg-mode="${modo.id}">${modo.label}</button>`).join('')}
        </div>`;

    const righe = notes.map(({ player, teamRaw, text }) => {
        const t = teamOf(teamRaw);
        return `
        <div class="gb-note">
            <img class="gb-headshot gb-headshot-sm" src="images/fallback-player.svg" alt="${player.name}"
                 data-player-name="${player.name}" data-team="${player.nfl_team}" data-pos="${player.position_in_team || player.position}">
            <div class="gb-note-body">
                <div class="gb-note-head">
                    <span class="gb-note-name">${player.name}</span>
                    <span class="gb-note-meta">${(player.position_in_team || player.position || '')} · ${player.nfl_team || ''}</span>
                    ${t ? `<span class="gb-note-team" style="--tc:${t.color}">${t.name}</span>` : ''}
                </div>
                <p class="gb-note-text">${text}</p>
            </div>
        </div>`;
    }).join('');

    return `
    <div class="mosaic-card mc-wide gb-card mc-in">
        <span class="mc-kicker">Player notes</span>
        <h2 class="mc-title">Every player against his own average</h2>
        <p class="gb-card-sub">Dot to the right of the line: above the reference. To the left:
           below. Split by team, starters and bench apart.</p>
        ${pillole}
        <div class="mc-body">
            ${pannelli.map(({ modo, html }, i) => `
            <div class="gb-avg-grid gb-avg-mode${i === 0 ? ' is-on' : ''}" data-avg-panel="${modo.id}">${html}</div>`).join('')}
        </div>
        <div class="gb-notes">${righe}</div>
    </div>`;
}

/** Il selettore del riferimento: mostra il pannello scelto, nasconde gli altri. */
function bindAvgSwitch(section) {
    const sw = section.querySelector('.gb-avg-switch');
    if (!sw) return;
    sw.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-avg-mode]');
        if (!btn) return;
        sw.querySelectorAll('.year-pill').forEach(b => b.classList.toggle('active', b === btn));
        section.querySelectorAll('[data-avg-panel]').forEach(pan =>
            pan.classList.toggle('is-on', pan.dataset.avgPanel === btn.dataset.avgMode));
    });
}

function loadHeadshots(section, year) {
    section.querySelectorAll('.gb-headshot').forEach(async (img) => {
        img.onerror = () => {
            if (!img.src.endsWith('fallback-player.svg')) img.src = 'images/fallback-player.svg';
        };
        try {
            const url = await playerImageService.getPlayerImageUrl(
                img.dataset.playerName, img.dataset.team, img.dataset.pos, year);
            if (url) img.src = url;
        } catch { /* resta il fallback */ }
    });
}
