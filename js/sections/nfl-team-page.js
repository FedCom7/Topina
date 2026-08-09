/**
 * Pagina squadra NFL standalone — route #nfl-team/{abbr}/{year?}.
 *
 * Stessa identità concettuale della pagina DEF in player-page.js (una pick
 * DEF *è* la difesa di una squadra NFL) ma qui senza l'ancoraggio a una pick
 * di draft Topina: si arriva dalla ricerca in "Players" o direttamente via
 * URL. Riusa i blocchi/helper già costruiti in player-page.js (esportati
 * apposta) invece di duplicarli — stesso pattern dati, stesso selettore
 * stagione, stessi grafici — e in più monta i blocchi ESPN live esclusivi
 * della squadra (profilo/stadio/coach, Football Power Index, statistiche
 * ufficiali, calendario live, depth chart completo, transactions, odds SB).
 */

import { getTeamIdentity } from '../data/nfl-teams.js?v=1';
import { getTeamTrades, getTeamATS, getFranchiseHistory } from '../data/nfl-team-profile-extra.js?v=10';
import { getTeamDraftHistory, getTeamUsage, getLeagueReceivers, getLeagueTeamsAdvanced, getLeagueTeamFantasy } from '../data/context-score.js?v=51';
import { getTeamDepthChart, currentNflSeason } from '../data/nfl-team-extras.js?v=52';
import { getTeamStats } from '../data/nfl-team-stats.js?v=19';
import { canonAbbr } from '../data/nfl-schedule.js?v=20';
import {
    getTeamProfile, getTeamPowerIndex, getTeamScheduleLive, getTeamScheduleFull,
    getTeamTransactions, getTeamSeasonStats, getTeamFutures, getLeagueStandings,
    getGameSummary, getTeamGameBoxscore, getTeamLeaders, getNews,
} from '../data/nfl-team-live.js?v=38';
import {
    esc, teamLogo, factChip, tile, fmt0, fmt1, fmt2, ord, TEAM_HISTORY_YEARS,
    teamContextBlock, defStatsBlock, fpaBlock, fpaTableHtml, matchupBlock, teamInjuriesBlock, rosterStatusListsBlock,
    teamHistoryBlock, teamExtrasBlock, rosterTableDetails, rankBadge, meterBar,
    teamYearPicker, fetchTeamSeasonData, fetchTeamHistory, hydrateCharts,
} from './player-page.js?v=302';
import {
    calendarBlocksBlock, draftBlock,
    divisionStandingsBlock, formationFieldBlock, hydrateFormationPhotos,
} from './nfl-team-home.js?v=7';

export async function initNflTeamPage() {
    const section = document.getElementById('nfl-team-page');
    if (!section) return;

    const myHash = location.hash;
    const parts = myHash.slice(1).split('/'); // nfl-team/{abbr}/{year?}
    const abbr = canonAbbr(parts[1] || '');
    const requestedYear = /^\d{4}$/.test(parts[2] || '') ? +parts[2] : null;
    const identity = abbr ? getTeamIdentity(abbr) : null;

    if (!abbr || !identity) {
        section.innerHTML = `<div class="section-inner"><div class="empty-state"><div class="empty-state-icon">🏈</div><p class="empty-state-text">Team not found</p></div></div>`;
        return;
    }

    section.innerHTML = `<div class="section-inner"><div class="loading-state"><div class="spinner"></div><p>Caricamento ${esc(identity.name)}...</p></div></div>`;

    try {
        const year = requestedYear || TEAM_HISTORY_YEARS[TEAM_HISTORY_YEARS.length - 1];
        const [seasonData, teamHistory] = await Promise.all([
            fetchTeamSeasonData(abbr, year),
            fetchTeamHistory(abbr),
        ]);
        if (location.hash !== myHash) return;
        const season = seasonData.ctx?.season || year;

        const [trades, ats, history, draftHistory, live, usage] = await Promise.all([
            getTeamTrades(abbr).catch(() => []),
            getTeamATS(abbr, season).catch(() => null),
            getFranchiseHistory(abbr).catch(() => null),
            getTeamDraftHistory(abbr).catch(() => []),
            fetchTeamLive(abbr, season),
            getTeamUsage(abbr, season).catch(() => []), // uso avanzato per l'analisi target share (cache condivisa con la rosa)
        ]);
        // Dati di lega per i confronti (cache adv/team_stats già calde): percentili
        // ricevitori, advanced offensivo 32 squadre, stat reali 32 squadre, fantasy per squadra/ruolo.
        const [leaguePool, leagueAdv, leagueStats, leagueFantasy] = await Promise.all([
            getLeagueReceivers(season).catch(() => []),
            getLeagueTeamsAdvanced(season).catch(() => ({})),
            getTeamStats(season).catch(() => null),
            getLeagueTeamFantasy(season).catch(() => ({})),
        ]);
        const statTrend = await fetchStatTrend(abbr, teamHistory).catch(() => []); // stat per stagione (dati storici, cache)
        if (location.hash !== myHash) return;

        render(section, {
            abbr, identity, year: season,
            ...seasonData, teamHistory, statTrend, live, usage,
            leaguePool, leagueAdv, leagueStats, leagueFantasy,
            teamExtras: { trades, ats, history, draftHistory },
        });
    } catch (e) {
        console.error('[nfl-team-page]', e);
        if (location.hash !== myHash) return;
        section.innerHTML = `<div class="section-inner"><div class="empty-state"><div class="empty-state-icon">📡</div><p class="empty-state-text">Error loading team</p></div></div>`;
    }
}

/** Bundle ESPN live (dipende dalla stagione): profilo, FPI, calendario, txn, stat, odds, depth chart, classifica lega. */
async function fetchTeamLive(abbr, season) {
    const [profile, fpi, schedule, fullSchedule, transactions, seasonStats, futures, depthChart, leaders, news, standings] = await Promise.all([
        getTeamProfile(abbr, season).catch(() => null),
        getTeamPowerIndex(abbr, season).catch(() => null),
        getTeamScheduleLive(abbr, season).catch(() => []),
        getTeamScheduleFull(abbr, season).catch(() => []),
        getTeamTransactions(abbr, season).catch(() => []),
        getTeamSeasonStats(abbr, season).catch(() => []),
        getTeamFutures(abbr, season).catch(() => null),
        getTeamDepthChart(abbr, season).catch(() => null),
        getTeamLeaders(abbr, season).catch(() => []),
        getNews(profileAbbrToEspn(abbr)).catch(() => []),
        getLeagueStandings(season).catch(() => []),
    ]);
    // Il dettaglio di ogni partita si carica a richiesta cliccando la riga nel calendario.
    return { profile, fpi, schedule, fullSchedule, transactions, seasonStats, futures, depthChart, leaders, news, standings };
}

// La sigla canonica coincide con quella ESPN minuscola per il filtro news.
const profileAbbrToEspn = (abbr) => (abbr || '').toLowerCase();

// Percentile 0-1 di v nell'array (frazione di valori <= v).
function _pct01(v, arr) {
    if (v == null || !arr.length) return 0;
    const s = [...arr].sort((a, b) => a - b);
    let lo = 0, hi = s.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (s[m] <= v) lo = m + 1; else hi = m; }
    return lo / s.length;
}

/**
 * Andamento statistico per stagione: per ogni anno le stat reali di attacco e
 * difesa (team_stats) con i loro rank NFL, l'advanced offensivo (EPA/success/
 * PROE, con rank calcolato tra le 32 squadre) e due indici 0-100 (forza attacco
 * = percentile EPA, forza difesa = percentile inverso punti subiti) per lo
 * scatter del "viaggio" O×D. Tutto per heatmap, sparkline e scatter storici.
 */
async function fetchStatTrend(abbr, teamHistory) {
    const A = canonAbbr(abbr);
    const rankOf = (val, arr, hi = true) => {
        if (val == null) return null;
        return arr.filter(v => v != null && (hi ? v > val : v < val)).length + 1; // 1 = migliore
    };
    const out = await Promise.all((teamHistory || []).map(async (h) => {
        const y = h.year;
        const [stats, adv, usage] = await Promise.all([
            getTeamStats(y).catch(() => null),
            getLeagueTeamsAdvanced(y).catch(() => ({})),
            getTeamUsage(abbr, y).catch(() => []),
        ]);
        const teams = stats?.teams || {};
        const me = teams[A];
        if (!me?.offense || !me?.defense) return null;
        const advByAbbr = {};
        for (const [k, v] of Object.entries(adv)) advByAbbr[canonAbbr(k)] = v;
        const mine = advByAbbr[A] || {};
        const epaArr = Object.values(advByAbbr).map(t => t.offEpaPerPlay);
        const succArr = Object.values(advByAbbr).map(t => t.successRate);
        const ppgArr = Object.values(teams).map(t => t.offense?.ppg).filter(v => v != null);
        const papgArr = Object.values(teams).map(t => t.defense?.papg).filter(v => v != null);
        const defEpaArr = Object.values(advByAbbr).map(t => t.defEpaPerPlay).filter(v => v != null);
        const offR = Math.round(100 * (mine.offEpaPerPlay != null ? _pct01(mine.offEpaPerPlay, epaArr.filter(v => v != null)) : _pct01(me.offense.ppg, ppgArr)));
        const defR = (mine.defEpaPerPlay != null && defEpaArr.length >= 24)
            ? Math.round(100 * (1 - _pct01(mine.defEpaPerPlay, defEpaArr)))
            : Math.round(100 * (1 - _pct01(me.defense.papg, papgArr)));
        const qb = (usage || []).filter(p => p.pos === 'QB')
            .sort((a, b) => (b.passAtt || 0) - (a.passAtt || 0) || (b.gp || 0) - (a.gp || 0))[0]?.name || h.qbName || null;
        return {
            year: y, record: h.record, qb, offR, defR,
            offense: me.offense, defense: me.defense, ranks: me.ranks || { offense: {}, defense: {} },
            adv: { offEpaPerPlay: mine.offEpaPerPlay ?? null, successRate: mine.successRate ?? null, proe: mine.proe ?? null, passRate: mine.passRate ?? null },
            advRank: { epa: rankOf(mine.offEpaPerPlay, epaArr, true), succ: rankOf(mine.successRate, succArr, true) },
        };
    }));
    return out.filter(Boolean);
}

// Calendario ESPN della stagione corrente: fa da ponte tra le righe del
// calendario primario ("Schedule and matchups", sorgente nflverse, senza
// eventId) e il dettaglio partita ESPN (che richiede l'eventId). Aggiornato
// a ogni render e a ogni cambio anno.
let _teamSchedule = [];
const _weekNum = (str) => { const m = String(str ?? '').match(/\d+/); return m ? +m[0] : null; };
const _eventForWeek = (wk) => wk == null ? null
    : (_teamSchedule.find(g => g.completed && g.eventId && _weekNum(g.week) === wk) || null);

/**
 * Season ribbon: sintesi visiva del calendario, una cella per settimana con
 * logo avversario, casa/trasferta, risultato colorato (verde vinta, rosso persa)
 * e punteggio; le settimane di bye sono evidenziate. Sopra la tabella matchup
 * (che resta col dettaglio per ruolo e il click al box-score). Read-only.
 */
function seasonRibbonBlock({ ctx, abbr }) {
    const games = ctx?.opponents;
    if (!games?.length) return '';
    const byWeek = new Map(games.map(g => [g.week, g]));
    const minW = Math.min(...games.map(g => g.week)), maxW = Math.max(...games.map(g => g.week));
    const cells = [];
    for (let w = minW; w <= maxW; w++) {
        const g = byWeek.get(w);
        if (!g) { cells.push(`<div class="nfl-rib-cell nfl-rib-bye"><span class="nfl-rib-wk">W${w}</span><span class="nfl-rib-byelbl">BYE</span></div>`); continue; }
        const resCls = g.result === 'W' ? ' nfl-rib-w' : g.result === 'L' ? ' nfl-rib-l' : g.result ? ' nfl-rib-t' : '';
        const ha = g.home ? 'vs' : '@';
        const score = g.result ? `${g.pf}-${g.pa}` : '—';
        const games = g.record ? g.record.w + g.record.l + (g.record.t || 0) : 0;
        const oppWp = games ? (g.record.w + (g.record.t || 0) * 0.5) / games : null;
        const tip = `W${g.week} ${ha} ${g.opp}${g.record ? ` (${g.record.w}-${g.record.l})` : ''}${g.result ? ` · ${score} ${g.result}` : ''}${oppWp != null ? ` · avversario ${(oppWp * 100).toFixed(0)}% W` : ''}`;
        const diffBar = oppWp != null ? `<span class="nfl-rib-diff"><i style="width:${Math.round(oppWp * 100)}%"></i></span>` : '';
        cells.push(`<div class="nfl-rib-cell${resCls}" title="${esc(tip)}">
            <span class="nfl-rib-wk">W${g.week}</span>
            <span class="nfl-rib-opp"><i>${ha}</i><img src="${teamLogo(g.opp)}" alt="" onerror="this.style.display='none'"></span>
            <span class="nfl-rib-abbr">${esc(g.opp)}</span>
            <span class="nfl-rib-score">${score}</span>
            ${diffBar}
        </div>`);
    }
    return `
    <section class="pm-block pp-block">
        <span class="mc-kicker">Schedule · season ${ctx.season}</span>
        <div class="nfl-ribbon">${cells.join('')}</div>
        <p class="pm-note">One cell per week: <b style="color:#22c55e">green</b> border = win, <b style="color:var(--accent-red)">red</b> = loss, bye highlighted; score below. The <b style="color:var(--accent-amber)">amber bar</b> at the bottom is the opponent's strength (fuller = stronger team, from its record). Per-role detail (FPA, matchup) and the box score are in the table below.</p>
    </section>`;
}

/**
 * Calendario stile ESPN: colonne WK · DATE · OPPONENT · RESULT · W-L, con
 * Preseason / Regular Season / Postseason separate (dalla schedule ESPN
 * completa, live.fullSchedule). Nella regular season aggiunge le colonne extra
 * (FPA WR/gara, matchup, pt subiti/gara della difesa avversaria da nflverse,
 * ctx.opponents). Le righe con eventId sono cliccabili → box-score (gestito da
 * bindCalendarGameDetail; le tabelle sono marcate `nfl-cal-baked` perché
 * l'eventId è già nell'HTML, così annotateCalendar non le ri-processa).
 */
function teamScheduleBlock(live, { ctx }) {
    const all = live?.fullSchedule;
    if (!all?.length) return '';
    const season = ctx?.season;
    const oppByWeek = new Map((ctx?.opponents || []).map(o => [o.week, o]));

    const dateFmt = (iso) => {
        if (!iso) return '—';
        const d = new Date(iso);
        return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    };
    const resultCell = (g) => {
        if (!g.completed || g.score == null || g.oppScore == null) return '<span class="nfl-sched-sched">—</span>';
        const s = +g.score, o = +g.oppScore;
        const cls = s > o ? 'w' : s < o ? 'l' : 't';
        const letter = cls === 'w' ? 'W' : cls === 'l' ? 'L' : 'T';
        return `<span class="pp-res pp-res--${cls}">${letter} ${g.score}-${g.oppScore}</span>`;
    };
    // Matchup: quadratino con barra di riempimento colorata (stesso linguaggio
    // visivo delle celle del ribbon stagionale sopra), ma col numero di rank
    // in classifica sempre visibile. Riempimento = favorevolezza del matchup
    // (rank 1 = difesa che concede di più = matchup facile → barra piena verde).
    const matchupSquare = (rank) => {
        if (rank == null) return '—';
        const cls = rank <= 10 ? 'pp-mu2--easy' : rank >= 23 ? 'pp-mu2--hard' : 'pp-mu2--mid';
        const pct = Math.round((33 - rank) / 32 * 100);
        const label = rank <= 10 ? 'soft' : rank >= 23 ? 'tough' : 'average';
        return `<span class="pp-mu2 ${cls}" title="Matchup rank ${ord(rank)} (${label})">
            <b class="pp-mu2-rank">${ord(rank)}</b>
            <span class="pp-mu2-bar"><span class="pp-mu2-fill" style="width:${pct}%"></span></span>
        </span>`;
    };
    // Orario partite future: ET (come ESPN) + equivalente italiano.
    const timeCell = (g) => {
        const d = g.date ? new Date(g.date) : null;
        if (!d || isNaN(d.getTime())) return '<span class="nfl-sched-sched">—</span>';
        if (g.timeValid === false) return '<span class="nfl-sched-sched">TBD</span>';   // orario non ancora fissato (flex)
        const et = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' });
        const it = d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Rome' });
        return `<div class="nfl-sched-time"><b>${esc(et)} ET</b><span>${esc(it)} IT</span></div>`;
    };
    const tvCell = (g) => g.tv ? `<span class="nfl-sched-tv">${esc(g.tv)}</span>` : '<span class="nfl-sched-sched">—</span>';
    const oppCell = (g, withRec) => {
        const ha = g.homeAway === 'home' ? 'vs' : '@';
        const rec = withRec ? oppByWeek.get(g.weekNum)?.record : null;
        return `<td class="pp-opp"><span class="nfl-sched-ha">${ha}</span><img class="pp-opp-logo" src="${teamLogo(g.opp)}" alt="" onerror="this.style.display='none'">${esc(g.opp || g.oppName || '—')}${rec ? ` <span class="pp-opp-rec">(${rec.w}-${rec.l})</span>` : ''}</td>`;
    };
    const POST_SHORT = { 'Wild Card': 'Wild Card', 'Wild Card Round': 'Wild Card', 'Divisional Round': 'Divisional', 'Conference Championship': 'Conference', 'Super Bowl': 'Super Bowl' };
    const wkLabel = (g) => {
        if (g.seasonType === 1) return g.weekNum != null ? String(g.weekNum) : '';   // preseason: solo numero
        if (g.seasonType === 3) return POST_SHORT[g.weekText] || g.weekText || 'Post';
        return g.weekNum != null ? String(g.weekNum) : (g.weekText || '');
    };

    // Record progressivo (solo regular season, gare completate).
    const recByEvent = new Map();
    let w = 0, l = 0, t = 0;
    for (const g of all.filter(x => x.seasonType === 2).sort((a, b) => (a.weekNum || 0) - (b.weekNum || 0))) {
        if (g.completed && g.score != null && g.oppScore != null) {
            const s = +g.score, o = +g.oppScore;
            if (s > o) w++; else if (s < o) l++; else t++;
            recByEvent.set(g, `${w}-${l}${t ? '-' + t : ''}`);
        }
    }

    // Per riga: gara giocata → RESULT + W-L (+ extra); gara futura → TIME + TV.
    // Le colonne W-L/FPA/Matchup/Pt subiti hanno dati solo nella regular season:
    // in preseason/postseason (strutturate come la regular) restano VUOTE.
    const rowFor = (g, { type, showExtra }) => {
        const upcoming = !g.completed;
        const isReg = type === 2;
        const clickable = g.completed && g.eventId;   // box-score solo per gare concluse
        const attrs = clickable ? ` class="pp-game-row" data-event-id="${esc(g.eventId)}"` : '';
        let c4, c5;
        if (upcoming) {
            c4 = `<td>${timeCell(g)}</td>`;
            c5 = `<td>${tvCell(g)}</td>`;
        } else {
            c4 = `<td>${resultCell(g)}</td>`;
            c5 = isReg ? `<td class="nfl-sched-rec">${recByEvent.get(g) || ''}</td>` : '<td></td>';
        }
        let ex = '';
        if (showExtra) {
            if (isReg && !upcoming) {
                const o = oppByWeek.get(g.weekNum);
                const fpaWR = o?.fpa?.WR;
                ex = `<td>${fpaWR?.pgLeague != null ? fmt1(fpaWR.pgLeague) : fpaWR?.pgHalf != null ? fmt1(fpaWR.pgHalf) : ''}</td>
                    <td>${fpaWR?.rank != null ? matchupSquare(fpaWR.rank) : ''}</td>
                    <td>${o?.def ? fmt1(o.def.papg) + rankBadge(o.ranks?.defense?.papg) : ''}</td>`;
            } else {
                ex = '<td></td><td></td><td></td>';   // pre/post o gara futura: colonne vuote
            }
        }
        return `<tr${attrs}>
            <td class="nfl-sched-wk">${esc(wkLabel(g))}</td>
            <td class="nfl-sched-date">${esc(dateFmt(g.date))}</td>
            ${oppCell(g, isReg && g.completed)}
            ${c4}${c5}${ex}
        </tr>`;
    };

    // Ordine: Postseason · Regular Season · Preseason.
    const groups = [
        { type: 3, label: 'Postseason' },
        { type: 2, label: 'Regular Season' },
        { type: 1, label: 'Preseason' },
    ];
    const tables = groups.map(grp => {
        const gs = all.filter(g => g.seasonType === grp.type)
            .sort((a, b) => (a.weekNum || 0) - (b.weekNum || 0) || (new Date(a.date) - new Date(b.date)));
        if (!gs.length) return '';
        // Se TUTTE le gare del gruppo sono future → colonne TIME/TV; altrimenti RESULT/W-L.
        // Le colonne extra compaiono su TUTTI i gruppi giocati (pre/post le lasciano vuote).
        const upcomingOnly = gs.every(g => !g.completed);
        const showExtra = !upcomingOnly && oppByWeek.size > 0;
        const head = upcomingOnly
            ? '<th>WK</th><th>DATE</th><th>OPPONENT</th><th>TIME</th><th>TV</th>'
            : `<th>WK</th><th>DATE</th><th>OPPONENT</th><th>RESULT</th><th>W-L</th>${showExtra ? '<th>FPA WR/game</th><th>Matchup</th><th>Pts allowed/game</th>' : ''}`;
        return `
        <h3 class="nfl-sched-group">${grp.label}</h3>
        <div class="pm-table-wrap pp-scroll">
            <table class="pm-table pp-table nfl-sched nfl-cal-clickable nfl-cal-baked">
                <thead><tr>${head}</tr></thead>
                <tbody>${gs.map(g => rowFor(g, { type: grp.type, showExtra })).join('')}</tbody>
            </table>
        </div>`;
    }).join('');
    if (!tables.trim()) return '';

    return `
    <section class="pm-block pp-block">
        <span class="mc-kicker">Schedule and matchups · ${season}</span>
        ${tables}
        <p class="pm-note">Preseason, regular season and postseason separated (ESPN data). Upcoming games: kickoff time (ET) and TV network. Played games: result and running W-L (regular season); in the regular season, opponent defense FPA WR/game and points allowed/game (nflverse). Click a finished game for the box score.</p>
    </section>`;
}

/**
 * Ledger stagioni: bar-code della franchigia, una barra per stagione con altezza
 * = % vittorie e colore (verde vincente / rosso perdente / ambra .500), più una
 * KPI-strip (record complessivo, miglior stagione). Da ctx.statTrend (record per
 * anno, già caricato). Sopra le tabelle trade/draft/storia (teamExtrasBlock).
 */
function franchiseLedgerBlock(ctx) {
    const seasons = (ctx.statTrend || []).filter(s => s.record);
    if (seasons.length < 3) return '';
    const winPct = s => { const g = s.record.w + s.record.l + (s.record.t || 0); return g ? (s.record.w + (s.record.t || 0) * 0.5) / g : 0; };
    const totW = seasons.reduce((a, s) => a + s.record.w, 0);
    const totL = seasons.reduce((a, s) => a + s.record.l, 0);
    const totT = seasons.reduce((a, s) => a + (s.record.t || 0), 0);
    const best = [...seasons].sort((a, b) => winPct(b) - winPct(a))[0];
    const bars = seasons.map(s => {
        const wp = winPct(s), cls = wp > 0.55 ? 'good' : wp < 0.45 ? 'bad' : 'mid';
        return `<div class="nfl-led-cell" title="${s.year}: ${s.record.w}-${s.record.l}${s.record.t ? '-' + s.record.t : ''}${s.qb ? ` · QB ${esc(s.qb)}` : ''}">
            <span class="nfl-led-bar-wrap"><span class="nfl-led-bar nfl-led-${cls}" style="height:${Math.max(8, wp * 100).toFixed(0)}%"></span></span>
            <span class="nfl-led-rec">${s.record.w}-${s.record.l}</span>
            <span class="nfl-led-yr">${String(s.year).slice(2)}</span>
        </div>`;
    }).join('');
    const tiles = [
        tile(`${totW}-${totL}${totT ? '-' + totT : ''}`, `Record ${seasons[0].year}–${seasons[seasons.length - 1].year}`),
        tile(`${best.record.w}-${best.record.l}`, `Miglior stagione · ${best.year}`),
    ].join('');

    // Timeline verticale delle ERE per QB titolare: stagioni consecutive con lo
    // stesso QB raggruppate, dalla più recente in alto, con record e miglior anno.
    const chron = [...seasons].sort((a, b) => a.year - b.year);
    const eras = [];
    for (const s of chron) {
        const qb = s.qb || '—', last = eras[eras.length - 1];
        if (last && last.qb === qb) { last.to = s.year; last.w += s.record.w; last.l += s.record.l; last.t += (s.record.t || 0); }
        else eras.push({ qb, from: s.year, to: s.year, w: s.record.w, l: s.record.l, t: s.record.t || 0 });
    }
    const eraNodes = [...eras].reverse().map(e => {
        const span = e.from === e.to ? `${e.from}` : `${e.from}–${e.to}`;
        return `<div class="pp-tline-node"><span class="pp-tline-dot"></span><span class="pp-tline-yr">${span}</span><span class="pp-tline-txt"><b>${esc(e.qb)}</b> · ${e.w}-${e.l}${e.t ? '-' + e.t : ''}</span></div>`;
    }).join('');
    const eraHtml = eras.length >= 1 && eras.some(e => e.qb !== '—')
        ? `<h4 class="ts-sub" style="margin-top:16px">Eras by quarterback</h4><div class="pp-tline">${eraNodes}</div>` : '';

    return `
    <section class="pm-block pp-block">
        <span class="mc-kicker">Seasons ledger · ${esc(ctx.abbr)}</span>
        <div class="pm-tiles pp-tiles">${tiles}</div>
        <div class="nfl-ledger">${bars}</div>
        ${eraHtml}
        <p class="pm-note">One bar per season (height = win %): <b style="color:#22c55e">green</b> = winning, <b style="color:var(--accent-red)">red</b> = losing, amber ≈ .500. The timeline groups seasons by starting QB (franchise eras). Trades, historical draft and ESPN franchise history below.</p>
    </section>`;
}

/** Nav di sezione sticky a tab: mostra solo la sezione scelta (le altre nascoste),
 *  con l'hero identità sempre in cima. */
function bindSectionNav(section) {
    const nav = section.querySelector('.nfl-secnav');
    if (!nav) return;
    const panels = {};
    section.querySelectorAll('.nfl-sec[data-secid]').forEach(p => { panels[p.dataset.secid] = p; });
    const btns = [...nav.querySelectorAll('button[data-sec]')];
    const navH = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--nav-height')) || 64;

    // La home mostra solo la stagione corrente: il selettore anno (grande "2026")
    // è nascosto sulla home e compare solo sulle altre tab, dove serve per lo storico.
    const yearHeader = section.querySelector('.nfl-year-header');
    const yearMenu = section.querySelector('#nfl-year-menu');
    const show = (id) => {
        if (!panels[id]) return;
        btns.forEach(b => {
            const on = b.dataset.sec === id;
            b.classList.toggle('is-active', on);
            b.setAttribute('aria-current', on ? 'true' : 'false');
        });
        Object.entries(panels).forEach(([k, p]) => { p.hidden = k !== id; });
        if (yearHeader) yearHeader.style.display = id === 'home' ? 'none' : '';
        if (yearMenu && id === 'home') yearMenu.hidden = true;
    };

    nav.addEventListener('click', (e) => {
        const btn = e.target.closest('button[data-sec]');
        if (!btn) return;
        show(btn.dataset.sec);
        // Se la nav è già scrollata via, riportala in cima così la sezione parte dall'alto.
        const navTop = nav.getBoundingClientRect().top + window.scrollY - navH;
        if (window.scrollY > navTop) window.scrollTo({ top: navTop, behavior: 'smooth' });
    });

    show('home');
}

function render(section, ctx) {
    const { abbr, identity, year, live } = ctx;
    const rec = ctx.ctx?.team?.record;
    const wrap = { ...ctx, pos: 'TEAM' }; // per i blocchi condivisi (leggono ctx/advTeam/teamRoster/... da qui)
    _teamSchedule = live?.schedule || [];

    section.innerHTML = `
    <div class="section-inner gb-page pp-page nfl-team-inner">
        <header class="mosaic-card mc-wide pp-hero mc-in" style="--team-color:${identity.color}">
            <div class="pp-hero-inner">
                <a class="gb-back" href="#" data-pp-back><span aria-hidden="true">←</span> Back</a>
                <div class="pp-recap">
                    <img class="pp-recap-photo" style="border-radius:var(--radius-lg);object-fit:contain;background:transparent;border:none"
                        src="${teamLogo(abbr)}" alt="${esc(identity.name)}">
                    <div class="pp-recap-body">
                        <div class="pp-recap-name"><span class="mc-kicker">NFL Team</span></div>
                        <h1 class="mc-title">${esc(identity.name)}</h1>
                        <div class="pp-recap-team"><span class="pp-team-div" style="color:${identity.color}">${esc(identity.conf)} · ${esc(identity.division)}</span></div>
                        <div class="pp-fact-chips" id="nfl-hero-chips" style="margin-top:10px">${heroChipsHtml(live.profile, year, rec)}</div>
                    </div>
                </div>
            </div>
        </header>

        <div class="section-header nfl-year-header">
            <button type="button" class="section-title nfl-year-title" id="nfl-year-side"
                    aria-haspopup="listbox" aria-expanded="false" title="Change season">${year}</button>
        </div>
        <div class="nfl-year-menu" id="nfl-year-menu" role="listbox" aria-label="Season" hidden></div>
        ${teamYearPicker(year)}

        <nav class="nfl-secnav" aria-label="Team sections">
            <button type="button" data-sec="home" class="is-active" aria-current="true">Home</button>
            <button type="button" data-sec="stats">Stats</button>
            <button type="button" data-sec="schedule">Schedule</button>
            <button type="button" data-sec="roster">Roster</button>
            <button type="button" data-sec="depth">Depth Chart</button>
            <button type="button" data-sec="injuries">Injuries</button>
            <button type="button" data-sec="transactions">Transactions</button>
            <button type="button" data-sec="news">News</button>
            <button type="button" data-sec="franchigia">Franchise</button>
        </nav>

        <div class="nfl-sec" data-secid="home">
            <div id="nfl-home-grid">${homeGridBlock(ctx)}</div>
        </div>

        <div class="nfl-sec" data-secid="stats" hidden>
            <div id="nfl-dna">${teamDnaBlockOrNote(ctx, year)}</div>
            <div id="nfl-live-a">${fpiBlock(live)}${futuresBlock(live)}${teamLeadersBlock(live)}</div>
            <div id="nfl-live-b">${seasonStatsBlock(live)}</div>
            <div id="nfl-ctx-stats">${teamContextBlock(wrap)}${defStatsBlock(wrap)}</div>
            <div id="nfl-stattrend">${statTrendBlock(ctx.statTrend, abbr)}</div>
            <div id="nfl-tgtshare">${targetShareBlock(ctx.usage, ctx.teamRoster, ctx.leaguePool, abbr, year)}</div>
            <div id="nfl-off-analysis">${offenseAnalysisBlock(ctx)}</div>
            <div id="nfl-def-analysis">${defenseAnalysisBlock(ctx)}</div>
        </div>

        <div class="nfl-sec" data-secid="schedule" hidden>
            <div id="nfl-calendar">${seasonRibbonBlock(wrap)}${teamScheduleBlock(live, wrap)}</div>
        </div>

        <div class="nfl-sec" data-secid="roster" hidden>
            <div id="nfl-roster">${rosterBlock(ctx.teamRoster)}</div>
        </div>

        <div class="nfl-sec" data-secid="depth" hidden>
            <div id="nfl-depth">${depthChartTab(live)}</div>
        </div>

        <div class="nfl-sec" data-secid="injuries" hidden>
            <div id="nfl-injuries">${rosterStatusListsBlock({ teamRoster: ctx.teamRoster, transactions: live.transactions })}${teamInjuriesBlock(wrap)}</div>
        </div>

        <div class="nfl-sec" data-secid="transactions" hidden>
            <div id="nfl-transactions">${transactionsBlock(live)}</div>
        </div>

        <div class="nfl-sec" data-secid="news" hidden>
            <div id="nfl-news">${newsBlock(live)}</div>
        </div>

        <div class="nfl-sec" data-secid="franchigia" hidden>
            <div id="nfl-franchise">${franchiseLedgerBlock(ctx)}${teamExtrasBlock(wrap)}</div>
        </div>

        <p class="dg-footnote">Team data: nflverse (history, schedule, depth chart, draft, trades) with live ESPN integration (profile/stadium/coach, Football Power Index, official stats, schedule, transactions, odds).</p>
    </div>`;

    bindBack(section);
    bindYearRepaint(section, ctx);
    bindYearMenu(section);
    bindCalendarGameDetail(section, abbr);
    bindSectionNav(section);
    hydrateCharts(section);
    hydrateFormationPhotos(section);
    alignYearToContent(section);
}

/** Compone la griglia a 3 colonne della tab Home. Sinistra: calendario. Centro:
 *  campo formazione + riassunto. Destra: head coach, draft, stadio, classifica division. */
function homeGridBlock(ctx) {
    const { abbr, identity, year, live, teamExtras } = ctx;
    const cal = calendarBlocksBlock(live);
    const field = formationFieldBlock(live?.depthChart, abbr, year);
    const summary = homeSummaryChartsBlock(ctx);
    const coach = coachCardHtml(live?.profile);
    const draft = draftBlock(teamExtras?.draftHistory);
    const stadium = stadiumCardHtml(live?.profile);
    const stand = divisionStandingsBlock(live?.standings, identity, abbr);
    const left = cal, center = field + summary, right = coach + draft + stadium + stand;
    if (!left && !center && !right) return '';
    return `<div class="nfl-home-grid">
        <div class="nfl-home-col nfl-home-col-l">${left}</div>
        <div class="nfl-home-col nfl-home-col-c">${center}</div>
        <div class="nfl-home-col nfl-home-col-r">${right}</div>
    </div>`;
}

// Sottoinsieme compatto di SPARKS per il riassunto nella tab Home (il set completo resta in Stats).
const HOME_SPARKS = [
    { side: 'offense', m: { k: 'ppg', label: 'PPG', fmt: fmt1 } },
    { side: 'defense', m: { k: 'papg', label: 'Points allowed', fmt: fmt1 } },
    { side: 'offense', m: { k: 'epa', label: 'EPA/play', fmt: fmt2, adv: 'offEpaPerPlay', advRank: 'epa' } },
    { side: 'defense', m: { k: 'takeaways', label: 'Takeaways', fmt: fmt0 } },
];

/** Riassunto compatto per la tab Home: trend rank negli anni + poche metriche di rank attuale (versioni ridotte dei blocchi già in Stats). */
function homeSummaryChartsBlock(ctx) {
    const seasons = ctx.statTrend;
    const team = ctx.ctx?.team;
    const bump = seasons && seasons.length >= 3 ? _bumpChart(seasons) : '';
    const sparks = seasons && seasons.length >= 2 ? _sparkGrid(seasons, HOME_SPARKS) : '';
    let rankPanel = '';
    if (team?.offense && team?.defense) {
        const o = team.offense, d = team.defense, ro = team.ranks?.offense || {}, rd = team.ranks?.defense || {};
        const meters = [
            meterBar('Points/game', fmt1(o.ppg), ro.ppg),
            meterBar('Total yards/game', fmt1(o.totYdsPg), ro.totYdsPg),
            meterBar('Points allowed/game', fmt1(d.papg), rd.papg),
            meterBar('Yards allowed/game', fmt1(d.totYdsAllowedPg), rd.totYdsAllowedPg),
            meterBar('Sack', fmt0(d.sacks), rd.sacks),
            meterBar('Takeaways', fmt0(d.takeaways), rd.takeaways),
        ].join('');
        rankPanel = `<div class="ts-card"><h4 class="ts-sub">Current NFL rank</h4>${meters}</div>`;
    }
    if (!bump && !sparks && !rankPanel) return '';
    return `
    <section class="pm-block pp-block nfl-home-summary">
        <span class="mc-kicker">Team snapshot · ${esc(ctx.abbr)}</span>
        ${rankPanel}
        ${bump ? `<div class="ts-card"><h4 class="ts-sub">Offense vs defense rank · over the years</h4>${bump}</div>` : ''}
        ${sparks}
        <p class="pm-note">Compact summary of data available in full in the Stats tab (rank trend, official stats).</p>
    </section>`;
}

/**
 * L'anno verticale (fixed) parte allineato al top del primo riquadro della tab
 * (es. "Carta d'Identità" in Stats), non più in alto vicino alla barra. Il top
 * del primo blocco dipende dall'altezza della barra (che varia coi nomi lunghi),
 * quindi lo si misura e si passa al CSS via `--nfl-year-top` (usato solo su
 * desktop; su mobile l'anno è la pill in alto a destra). Tutti i pannelli tab
 * iniziano alla stessa Y, quindi una misura vale per tutte le tab.
 */
function alignYearToContent(section) {
    const inner = section.querySelector('.nfl-team-inner');
    const block = section.querySelector('.nfl-sec:not([hidden]) .pm-block');
    if (!inner || !block) return;
    const rect = block.getBoundingClientRect();
    if (!rect.height) return; // blocco non ancora visibile: mantieni il fallback CSS
    inner.style.setProperty('--nfl-year-top', `${Math.round(rect.top + window.scrollY)}px`);
}

/**
 * Il grande anno rosso (fisso durante lo scroll) diventa il selettore stagione:
 * un click apre un menu con tutte le stagioni. Il dropdown `#pp-team-year`
 * resta nel DOM (nascosto via CSS) come "motore": scegliere un anno nel menu
 * ne imposta il valore e ne emette il `change`, così i listener già montati
 * (contesto Topina + blocchi ESPN live, che aggiorna anche il numero) fanno
 * il resto senza duplicare la logica.
 */
function bindYearMenu(section) {
    const btn = section.querySelector('#nfl-year-side');
    const menu = section.querySelector('#nfl-year-menu');
    const select = section.querySelector('#pp-team-year');
    if (!btn || !menu || !select) return;

    const years = [...select.options].map(o => o.value);
    const current = () => select.value;

    const buildMenu = () => {
        const cur = current();
        menu.innerHTML = years.map(y =>
            `<button type="button" role="option" data-year="${y}" aria-selected="${y === cur}">${y}</button>`
        ).join('');
    };

    const position = () => {
        const r = btn.getBoundingClientRect();
        const isDesktop = window.innerWidth >= 768;
        menu.style.visibility = 'hidden';
        menu.hidden = false;
        const mw = menu.offsetWidth, mh = menu.offsetHeight;
        let left, top;
        if (isDesktop) {
            // anno verticale a sinistra: menu alla sua destra, allineato in alto
            left = r.right + 10;
            top = r.top;
        } else {
            // pill in alto a destra: menu sotto, allineato a destra
            left = r.right - mw;
            top = r.bottom + 8;
        }
        left = Math.max(8, Math.min(left, window.innerWidth - mw - 8));
        top = Math.max(8, Math.min(top, window.innerHeight - mh - 8));
        menu.style.left = left + 'px';
        menu.style.top = top + 'px';
        menu.style.visibility = '';
    };

    const open = () => {
        buildMenu();
        position();
        menu.hidden = false;
        btn.setAttribute('aria-expanded', 'true');
        menu.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
    };
    const close = () => {
        menu.hidden = true;
        btn.setAttribute('aria-expanded', 'false');
    };
    const toggle = () => (menu.hidden ? open() : close());

    btn.addEventListener('click', (e) => { e.stopPropagation(); toggle(); });
    menu.addEventListener('click', (e) => {
        const opt = e.target.closest('[data-year]');
        if (!opt) return;
        close();
        if (opt.dataset.year === current()) return;
        select.value = opt.dataset.year;
        select.dispatchEvent(new Event('change'));
    });
    document.addEventListener('click', (e) => {
        if (!menu.hidden && !menu.contains(e.target) && e.target !== btn) close();
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !menu.hidden) close();
    });
    window.addEventListener('resize', () => { if (!menu.hidden) close(); });
}

/**
 * Repaint unificato al cambio anno. L'ordine dei blocchi alterna sorgenti
 * (ESPN live + nflverse), quindi ogni blocco ha il suo slot e qui li ridipingo
 * tutti da una sola fetch combinata (live + season data). Storia squadra e
 * Franchigia non sono ridipinti: sono dati a livello di franchigia caricati una
 * volta, indipendenti dall'anno selezionato.
 */
function bindYearRepaint(section, ctx0) {
    const { abbr } = ctx0;
    const select = section.querySelector('#pp-team-year');
    if (!select) return;
    const set = (id, html) => { const el = section.querySelector(id); if (el) el.innerHTML = html; };
    const spinner = '<div class="loading-state"><div class="spinner"></div></div>';
    // La tab Home (#nfl-home-grid) NON è nel repaint: mostra
    // sempre la stagione corrente caricata all'apertura, indipendente dal selettore
    // anno (che è nascosto sulla home e serve solo alle altre tab).
    const YEAR_SLOTS = ['#nfl-dna', '#nfl-tgtshare', '#nfl-off-analysis', '#nfl-def-analysis',
        '#nfl-live-a', '#nfl-ctx-stats', '#nfl-live-b', '#nfl-calendar', '#nfl-roster', '#nfl-depth',
        '#nfl-injuries', '#nfl-transactions', '#nfl-news'];

    select.addEventListener('change', async () => {
        const year = +select.value;
        const myHash = location.hash;
        YEAR_SLOTS.forEach(id => set(id, spinner));
        const [live, seasonData, usage, leaguePool, leagueAdv, leagueStats, leagueFantasy] = await Promise.all([
            fetchTeamLive(abbr, year),
            fetchTeamSeasonData(abbr, year), // include teamRoster (cache in memoria)
            getTeamUsage(abbr, year).catch(() => []),
            getLeagueReceivers(year).catch(() => []),
            getLeagueTeamsAdvanced(year).catch(() => ({})),
            getTeamStats(year).catch(() => null),
            getLeagueTeamFantasy(year).catch(() => ({})),
        ]);
        if (location.hash !== myHash) return;
        _teamSchedule = live.schedule || [];
        const wrap = { ...seasonData, abbr, pos: 'TEAM' };
        const bctx = { ...seasonData, usage, leagueAdv, leagueStats, leagueFantasy, abbr, year };
        const yearSide = section.querySelector('#nfl-year-side');
        if (yearSide) yearSide.textContent = year; // anno grande a sinistra

        set('#nfl-hero-chips', heroChipsHtml(live.profile, year, seasonData.ctx?.team?.record));
        set('#nfl-dna', teamDnaBlockOrNote(bctx, year));
        set('#nfl-tgtshare', targetShareBlock(usage, seasonData.teamRoster, leaguePool, abbr, year));
        set('#nfl-off-analysis', offenseAnalysisBlock(bctx));
        set('#nfl-def-analysis', defenseAnalysisBlock(bctx));
        set('#nfl-live-a', fpiBlock(live) + futuresBlock(live) + teamLeadersBlock(live));
        set('#nfl-ctx-stats', teamContextBlock(wrap) + defStatsBlock(wrap));
        set('#nfl-live-b', seasonStatsBlock(live));
        set('#nfl-calendar', seasonRibbonBlock(wrap) + teamScheduleBlock(live, wrap));
        set('#nfl-roster', rosterBlock(seasonData.teamRoster));
        set('#nfl-depth', depthChartTab(live));
        set('#nfl-injuries', rosterStatusListsBlock({ teamRoster: seasonData.teamRoster, transactions: live.transactions }) + teamInjuriesBlock(wrap));
        set('#nfl-transactions', transactionsBlock(live));
        set('#nfl-news', newsBlock(live));
        annotateCalendar(section); // schedule ESPN aggiornato → ri-aggancia le righe del calendario
        alignYearToContent(section); // le chip della barra possono variare l'altezza → riallinea l'anno
    });
}

// ─── Blocchi ESPN live ───────────────────────────────────────────────────

/**
 * Chip identità della stagione, mostrate nel riquadro squadra (hero): record
 * complessivo (con l'anno selezionato), posizione in classifica e split
 * casa/trasferta/divisione/conference. Dipendono dal profilo ESPN, quindi si
 * rigenerano al cambio anno (vedi bindYearRepaint). Il record cade sul
 * dato nflverse (`fallbackRec`) se ESPN non lo espone.
 */
function heroChipsHtml(profile, year, fallbackRec) {
    const p = profile || {};
    const rs = p.recordSplits || {};
    const overall = rs.overall || p.record?.summary
        || (fallbackRec ? `${fallbackRec.w}-${fallbackRec.l}${fallbackRec.t ? '-' + fallbackRec.t : ''}` : null);
    return [
        overall ? factChip(esc(overall), `record ${year}`) : '',
        p.standingSummary ? factChip(esc(p.standingSummary), '') : '',
        rs.home ? factChip(esc(rs.home), 'home') : '',
        rs.road ? factChip(esc(rs.road), 'away') : '',
        rs.div ? factChip(esc(rs.div), 'in division') : '',
        rs.conf ? factChip(esc(rs.conf), 'in conference') : '',
    ].filter(Boolean).join('');
}

/** Head coach come card (colonna destra della home, sopra il draft). */
function coachCardHtml(profile) {
    const p = profile, co = p?.coach;
    if (!co?.name) return '';
    const rec = (co.recordTotal || co.recordRegular || co.recordPost) ? `<span class="pm-note" style="margin-top:2px">Head coach record: ${[
        co.recordTotal ? `${esc(co.recordTotal)} overall` : '',
        co.recordRegular ? `${esc(co.recordRegular)} regular` : '',
        co.recordPost ? `${esc(co.recordPost)} playoff` : '',
    ].filter(Boolean).join(' · ')}</span>` : '';
    return `
    <section class="pm-block pp-block nfl-home-coach">
        <span class="mc-kicker">Head coach</span>
        <div class="pp-coach" style="margin-top:8px">
            ${co.headshot ? `<img class="pp-coach-img" src="${esc(co.headshot)}" alt="" loading="lazy" onerror="this.style.display='none'">` : ''}
            <div class="pp-coach-body">
                <b>${esc(co.name)}</b>
                <span class="pm-note" style="margin-top:2px">${[
                    co.experience != null ? `career season ${co.experience}` : '',
                    co.teamTenure != null ? `${co.teamTenure} yrs with ${esc(p.abbr)}` : '',
                    co.age != null ? `${co.age} years old` : '',
                    co.college ? esc(co.college) : '',
                    co.birthPlace ? esc(co.birthPlace) : '',
                ].filter(Boolean).join(' · ')}</span>
                ${rec}
            </div>
        </div>
    </section>`;
}

/** Stadio come card (colonna destra della home, sotto il draft). */
function stadiumCardHtml(profile) {
    const v = profile?.venue;
    if (!v?.name) return '';
    return `
    <section class="pm-block pp-block nfl-home-stadium">
        <span class="mc-kicker">Stadium</span>
        <div class="pp-stadium" style="margin-top:8px">
            ${v.image ? `<img class="pp-stadium-img" src="${esc(v.image)}" alt="" loading="lazy" onerror="this.style.display='none'">` : ''}
            <div class="pp-stadium-body">
                <b>${esc(v.name)}</b>
                <span class="pm-note" style="margin-top:2px">${[v.city && v.state ? `${esc(v.city)}, ${esc(v.state)}` : '', v.capacity ? `${(+v.capacity).toLocaleString('en-US')} seats` : '', v.indoor ? 'indoor' : 'outdoor', v.grass ? 'natural grass' : 'turf'].filter(Boolean).join(' · ')}</span>
            </div>
        </div>
    </section>`;
}

// Formattatori per metrica
const _tsPct = (v) => v == null ? '—' : (v * 100).toFixed(1).replace('.', ',') + '%';
// Config delle metriche ricezione: label completa, sigla, formato, direzione (hi=alto è meglio)
const TS_METRICS = [
    { key: 'targetShare', label: 'Target share', short: 'Tgt%', fmt: _tsPct, hi: true },
    { key: 'airYardsShare', label: 'Air yards share', short: 'AY%', fmt: _tsPct, hi: true },
    { key: 'tgtPerGame', label: 'Targets/game', short: 'Tgt/g', fmt: fmt1, hi: true },
    { key: 'catchRate', label: 'Catch%', short: 'Catch%', fmt: _tsPct, hi: true },
    { key: 'ydsPerTgt', label: 'Yard/target', short: 'Yd/tgt', fmt: fmt1, hi: true },
    { key: 'racr', label: 'RACR', short: 'RACR', fmt: fmt2, hi: true },
    { key: 'yacPerRec', label: 'YAC/ricezione', short: 'YAC', fmt: fmt1, hi: true },
    { key: 'recDropPct', label: 'Drop%', short: 'Drop%', fmt: _tsPct, hi: false },
    { key: 'wopr', label: 'WOPR', short: 'WOPR', fmt: fmt2, hi: true },
    { key: 'fpgLeague', label: 'League pts/game', short: 'PtL/g', fmt: fmt1, hi: true },
    { key: 'epaPerGame', label: 'EPA/game', short: 'EPA/g', fmt: fmt2, hi: true },
];
const TS_POS_COLOR = { WR: '#4f8cff', TE: '#f0b429', RB: '#3fb950' };

// Fabbrica di funzioni percentile sul pool NFL (ricerca binaria su array ordinati)
function _tsPercentiles(pool) {
    const arrs = {};
    for (const m of TS_METRICS) arrs[m.key] = pool.map(p => p[m.key]).filter(v => v != null).sort((a, b) => a - b);
    const median = (key) => { const a = arrs[key]; return a.length ? a[Math.floor(a.length / 2)] : null; };
    const pctl = (key, v, hi = true) => {
        const a = arrs[key];
        if (v == null || !a.length) return null;
        let lo = 0, hiIdx = a.length;
        while (lo < hiIdx) { const mid = (lo + hiIdx) >> 1; if (a[mid] <= v) lo = mid + 1; else hiIdx = mid; }
        const pr = lo / a.length * 100;
        return hi ? pr : 100 - pr;
    };
    return { pctl, median };
}

// Colore heatmap dal percentile (0 rosso → 100 verde), translucido per il tema scuro
const _tsHeat = (pr) => pr == null ? 'transparent' : `hsla(${Math.round(pr * 1.2)}, 68%, 42%, 0.34)`;
const _tsOrd = (pr) => `${Math.round(pr)}ª`;

// Tick "tondi" per gli assi
function _tsTicks(min, max, n = 4) {
    const span = (max - min) || 1;
    const mag = Math.pow(10, Math.floor(Math.log10(span / n)));
    const norm = span / n / mag;
    const step = (norm >= 5 ? 5 : norm >= 2 ? 2 : 1) * mag;
    const out = [];
    for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) out.push(+v.toFixed(6));
    return out;
}

/** Scatter opportunità (WOPR) × efficienza (EPA/gara); bolla = target/gara, colore = ruolo. */
function _tsScatter(recs, median) {
    const pts = recs.filter(p => p.wopr != null && p.epaPerGame != null);
    if (pts.length < 3) return '';
    const W = 640, H = 360, m = { l: 48, r: 14, t: 14, b: 34 };
    const pw = W - m.l - m.r, ph = H - m.t - m.b;
    const xmax = Math.max(...pts.map(p => p.wopr), median('wopr') || 0) * 1.12 || 1;
    const ys = pts.map(p => p.epaPerGame);
    const ymin = Math.min(0, ...ys), ymax = Math.max(...ys) * 1.12;
    const X = v => m.l + (v / xmax) * pw;
    const Y = v => m.t + (1 - (v - ymin) / ((ymax - ymin) || 1)) * ph;
    const rad = t => Math.max(4, Math.min(15, 3 + (t || 0) * 1.3));

    const yGrid = _tsTicks(ymin, ymax).map(v => `
        <line x1="${m.l}" y1="${Y(v).toFixed(1)}" x2="${m.l + pw}" y2="${Y(v).toFixed(1)}" stroke="var(--border-subtle)" stroke-width="1"/>
        <text x="${m.l - 6}" y="${(Y(v) + 3).toFixed(1)}" class="ts-tick" text-anchor="end">${fmt1(v)}</text>`).join('');
    const xGrid = _tsTicks(0, xmax).map(v => `<text x="${X(v).toFixed(1)}" y="${H - 8}" class="ts-tick" text-anchor="middle">${fmt2(v)}</text>`).join('');

    const mx = median('wopr'), my = median('epaPerGame');
    const guides = `
        ${mx != null && mx < xmax ? `<line x1="${X(mx).toFixed(1)}" y1="${m.t}" x2="${X(mx).toFixed(1)}" y2="${m.t + ph}" class="ts-guide"/>` : ''}
        ${my != null && my > ymin && my < ymax ? `<line x1="${m.l}" y1="${Y(my).toFixed(1)}" x2="${m.l + pw}" y2="${Y(my).toFixed(1)}" class="ts-guide"/>` : ''}`;

    const dots = pts.map(p => {
        const c = TS_POS_COLOR[p.pos] || 'var(--text-muted)';
        return `<circle cx="${X(p.wopr).toFixed(1)}" cy="${Y(p.epaPerGame).toFixed(1)}" r="${rad(p.tgtPerGame).toFixed(1)}" fill="${c}" fill-opacity="0.72" stroke="#000" stroke-width="1.5"><title>${esc(p.name)} (${esc(p.pos)}) — WOPR ${fmt2(p.wopr)} · EPA/game ${fmt2(p.epaPerGame)} · ${fmt1(p.tgtPerGame)} tgt/game · target share ${_tsPct(p.targetShare)}</title></circle>`;
    }).join('');
    const labels = [...pts].sort((a, b) => (b.targetShare || 0) - (a.targetShare || 0)).slice(0, 5).map(p =>
        `<text x="${(X(p.wopr) + rad(p.tgtPerGame) + 3).toFixed(1)}" y="${(Y(p.epaPerGame) + 3).toFixed(1)}" class="ts-dotlbl">${esc(p.name.split(' ').slice(-1)[0])}</text>`).join('');

    return `<div class="ts-chart"><svg viewBox="0 0 ${W} ${H}" class="ts-svg" role="img" aria-label="Opportunity efficiency scatter">
        ${yGrid}${xGrid}${guides}${dots}${labels}
        <text x="${m.l + pw}" y="${m.t + ph + 24}" class="ts-axl" text-anchor="end">WOPR →</text>
        <text x="${m.l - 40}" y="${m.t + 8}" class="ts-axl" text-anchor="start">EPA/game ↑</text>
    </svg></div>`;
}

/** Radar (percentili NFL) dei ricevitori più cercati, sovrapposti. */
function _tsRadar(top, pctl) {
    if (top.length < 2) return '';
    const axes = [['targetShare', 'Tgt%'], ['airYardsShare', 'AY%'], ['catchRate', 'Catch%'], ['ydsPerTgt', 'Yd/tgt'], ['yacPerRec', 'YAC'], ['fpgLeague', 'PtL/g']];
    const W = 420, H = 360, cx = W / 2, cy = H / 2 + 4, R = 118, N = axes.length;
    const ang = i => -Math.PI / 2 + i * 2 * Math.PI / N;
    const pt = (i, r) => [cx + Math.cos(ang(i)) * R * r, cy + Math.sin(ang(i)) * R * r];
    const poly = (r) => axes.map((_, i) => pt(i, r).map(n => n.toFixed(1)).join(',')).join(' ');

    const rings = [0.25, 0.5, 0.75, 1].map(r => `<polygon points="${poly(r)}" fill="none" stroke="var(--border-subtle)" stroke-width="1"/>`).join('');
    const spokes = axes.map((a, i) => {
        const [x, y] = pt(i, 1), [lx, ly] = pt(i, 1.17);
        return `<line x1="${cx}" y1="${cy}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" stroke="var(--border-subtle)" stroke-width="1"/>
            <text x="${lx.toFixed(1)}" y="${(ly + 4).toFixed(1)}" class="ts-axl" text-anchor="middle">${a[1]}</text>`;
    }).join('');
    const colors = ['#4f8cff', '#f0b429', '#3fb950', '#e5679b'];
    const polys = top.map((p, pi) => {
        const pts = axes.map((a, i) => { const pr = (pctl(a[0], p[a[0]], true) ?? 0) / 100; return pt(i, Math.max(0.03, pr)).map(n => n.toFixed(1)).join(','); }).join(' ');
        const c = colors[pi % colors.length];
        return `<polygon points="${pts}" fill="${c}" fill-opacity="0.13" stroke="${c}" stroke-width="2"><title>${esc(p.name)}</title></polygon>`;
    }).join('');
    const legend = top.map((p, pi) => `<span class="ts-leg"><i style="background:${colors[pi % colors.length]}"></i>${esc(p.name)}</span>`).join('');
    return `<div class="ts-chart"><svg viewBox="0 0 ${W} ${H}" class="ts-svg" role="img" aria-label="Radar percentili">${rings}${spokes}${polys}</svg><div class="ts-legend">${legend}</div></div>`;
}

/** Heatmap percentili: righe = ricevitori, colonne = tutte le metriche, colore = percentile NFL. */
function _tsHeatmap(recs, pctl) {
    const head = TS_METRICS.map(m => `<th title="${esc(m.label)}">${m.short}</th>`).join('');
    const rows = recs.map(p => {
        const cells = TS_METRICS.map(m => {
            const v = p[m.key], pr = pctl(m.key, v, m.hi);
            const title = `${m.label}: ${v == null ? '—' : m.fmt(v)}${pr != null ? ` · ${_tsOrd(pr)} percentile NFL` : ''}`;
            return `<td style="background:${_tsHeat(pr)}" title="${esc(title)}">${v == null ? '—' : m.fmt(v)}</td>`;
        }).join('');
        return `<tr><td class="ts-hname"><span class="pp-lb-pos">${esc(p.pos)}</span>${esc(p.name)}</td>${cells}</tr>`;
    }).join('');
    return `<div class="pm-table-wrap pp-scroll"><table class="pm-table pp-table ts-heat"><thead><tr><th>Player</th>${head}</tr></thead><tbody>${rows}</tbody></table></div>`;
}

/**
 * ANALISI · Target share dell'attacco. Da nflverse (adv_players): per ogni
 * ricevitore (WR/TE/RB) opportunità (target/air yards share, WOPR, tgt/gara),
 * efficienza (catch%, yd/tgt, RACR, YAC, drop%) e valore (fp lega, EPA). Oltre
 * a lettura automatica e tile, tre viste: scatter opportunità×efficienza, radar
 * dei top 3 e heatmap a percentili NFL (tutti i ricevitori × tutte le metriche).
 */
function targetShareBlock(usage, teamRoster, leaguePool, abbr, year) {
    const recs = (usage || [])
        .filter(p => ['WR', 'TE', 'RB'].includes(p.pos) && p.targetShare != null && p.targetShare > 0.01 && (p.gp || 0) >= 1)
        .sort((a, b) => (b.targetShare || 0) - (a.targetShare || 0));
    if (recs.length < 2) return '';

    const pool = (leaguePool && leaguePool.length) ? leaguePool : recs; // fallback: percentili sul team
    const { pctl, median } = _tsPercentiles(pool);

    // Lettura automatica dei dati
    const alpha = recs[0];
    const top3 = recs.slice(0, 3).reduce((s, p) => s + (p.targetShare || 0), 0);
    const concentrated = top3 >= 0.58;
    const rbShare = recs.filter(p => p.pos === 'RB').reduce((s, p) => s + (p.targetShare || 0), 0);
    const woprLeader = [...recs].sort((a, b) => (b.wopr || 0) - (a.wopr || 0))[0];
    const vol = recs.filter(p => (p.targetShare || 0) >= 0.08 && p.airYardsShare != null);
    const deep = vol.length ? [...vol].sort((a, b) => (b.airYardsShare || 0) - (a.airYardsShare || 0))[0] : null;

    const tiles = [
        tile(_tsPct(alpha.targetShare), `Leader target share · ${esc(alpha.name)}`),
        tile(_tsPct(top3), 'Top-3 target share'),
        woprLeader?.wopr != null ? tile(fmt2(woprLeader.wopr), `WOPR leader · ${esc(woprLeader.name)}`) : '',
        rbShare > 0.001 ? tile(_tsPct(rbShare), 'Targets to RBs') : '',
    ].filter(Boolean).join('');

    const insight = `<b>${esc(alpha.name)}</b> is the primary target with <b>${_tsPct(alpha.targetShare)}</b> of the team's targets${alpha.tgtPerGame != null ? ` (${fmt1(alpha.tgtPerGame)}/game)` : ''}. The top three receivers absorb <b>${_tsPct(top3)}</b> of the targets: offense <b>${concentrated ? 'concentrated' : 'distributed'}</b>.${deep && deep !== alpha ? ` The deepest threat is <b>${esc(deep.name)}</b> (${_tsPct(deep.airYardsShare)} of the team's air yards).` : ''}${rbShare >= 0.15 ? ` Strong RB involvement in the passing game (<b>${_tsPct(rbShare)}</b> of the targets).` : ''}`;

    const scatter = _tsScatter(recs, median);
    const radar = _tsRadar(recs.slice(0, 3), pctl);
    const heatmap = _tsHeatmap(recs, pctl);

    return `
    <section class="pm-block pp-block">
        <span class="mc-kicker">Target share · offense ${esc(abbr)} ${year}</span>
        <p class="pp-sos">${insight}</p>
        ${tiles ? `<div class="pm-tiles pp-tiles">${tiles}</div>` : ''}
        <div class="ts-charts">
            ${scatter ? `<div class="ts-card">
                <h3 class="pp-cat-title">Opportunity × efficiency</h3>
                ${scatter}
                <p class="pm-note">X = WOPR (how much the offense targets him), Y = EPA/game (value per opportunity), size = targets/game, color = position (<span style="color:${TS_POS_COLOR.WR}">WR</span>/<span style="color:${TS_POS_COLOR.TE}">TE</span>/<span style="color:${TS_POS_COLOR.RB}">RB</span>). Dashed lines = NFL medians: top-right = elite profiles, bottom-right = high-volume but inefficient.</p>
            </div>` : ''}
            ${radar ? `<div class="ts-card">
                <h3 class="pp-cat-title">Top 3 footprint · NFL percentiles</h3>
                ${radar}
                <p class="pm-note">Multi-metric comparison of the three most-targeted receivers: each axis is the NFL percentile (farther from center = better).</p>
            </div>` : ''}
        </div>
        <details class="pp-recap-ids" style="margin-top:14px">
            <summary>Percentile heatmap — all receivers × metrics (${recs.length})</summary>
            <div style="margin-top:10px">
                ${heatmap}
                <p class="pm-note">Color = NFL percentile of the metric (green = high, red = low; for Drop% inverted: green = few drops). The number is the actual value. NFL pool: ${pool.length} receivers with ≥4 games${pool === recs ? ' (unavailable: percentiles computed on the team)' : ''}.</p>
            </div>
        </details>
        <p class="pm-note">Target share = team target share. Air yards share = depth of targets. WOPR = Weighted Opportunity Rating (>0.70 = primary option). RACR = yards produced per air yard. Source: nflverse, regular season.</p>
    </section>`;
}


// Metriche mostrate nelle heatmap storiche (rank 1 = migliore per tutte).
// adv = campo advanced (rank calcolato tra le 32 in fetchStatTrend).
const OFF_HEAT = [
    { k: 'ppg', label: 'PPG', fmt: fmt1 },
    { k: 'totYdsPg', label: 'Tot yds', fmt: fmt0 },
    { k: 'passYdsPg', label: 'Pass yds', fmt: fmt0 },
    { k: 'rushYdsPg', label: 'Rush yds', fmt: fmt0 },
    { k: 'ydsPerPlay', label: 'Yds/play', fmt: fmt1 },
    { k: 'rzPlaysPg', label: 'Red zone', fmt: fmt1 },
    { k: 'passTd', label: 'TD pass', fmt: fmt0 },
    { k: 'rushTd', label: 'Rush TD', fmt: fmt0 },
    { k: 'turnovers', label: 'Turnovers', fmt: fmt0 },
    { k: 'sacksAllowed', label: 'Sacks all.', fmt: fmt0 },
    { k: 'epa', label: 'EPA/g', fmt: fmt2, adv: 'offEpaPerPlay', advRank: 'epa' },
    { k: 'succ', label: 'Succ%', fmt: v => _tsPct(v), adv: 'successRate', advRank: 'succ' },
];
const DEF_HEAT = [
    { k: 'papg', label: 'Pts all.', fmt: fmt1 },
    { k: 'totYdsAllowedPg', label: 'Yds all.', fmt: fmt0 },
    { k: 'passYdsAllowedPg', label: 'Pass yds all.', fmt: fmt0 },
    { k: 'rushYdsAllowedPg', label: 'Rush yds all.', fmt: fmt0 },
    { k: 'sacks', label: 'Sack', fmt: fmt0 },
    { k: 'interceptions', label: 'Int', fmt: fmt0 },
    { k: 'takeaways', label: 'Takeaways', fmt: fmt0 },
    { k: 'tacklesForLoss', label: 'TFL', fmt: fmt0 },
    { k: 'qbHits', label: 'QB hit', fmt: fmt0 },
    { k: 'passDefended', label: 'Pass def.', fmt: fmt0 },
];
const SPARKS = [
    { side: 'offense', m: { k: 'ppg', label: 'PPG', fmt: fmt1 } },
    { side: 'offense', m: { k: 'ydsPerPlay', label: 'Yds/play', fmt: fmt1 } },
    { side: 'offense', m: { k: 'epa', label: 'EPA/play', fmt: fmt2, adv: 'offEpaPerPlay', advRank: 'epa' } },
    { side: 'offense', m: { k: 'passTd', label: 'Pass TD', fmt: fmt0 } },
    { side: 'defense', m: { k: 'papg', label: 'Points allowed', fmt: fmt1 } },
    { side: 'defense', m: { k: 'totYdsAllowedPg', label: 'Yds allowed', fmt: fmt0 } },
    { side: 'defense', m: { k: 'sacks', label: 'Sack', fmt: fmt0 } },
    { side: 'defense', m: { k: 'takeaways', label: 'Takeaways', fmt: fmt0 } },
];

// Valore + rank di una metrica per una stagione (team_stats o advanced).
function _statCell(season, m, side) {
    if (m.adv) return { v: season.adv?.[m.adv], rank: season.advRank?.[m.advRank] };
    return { v: season[side]?.[m.k], rank: season.ranks?.[side]?.[m.k] };
}
const _rankClass = (r) => r == null ? '' : r <= 10 ? 'ts-good-t' : r >= 23 ? 'ts-bad-t' : 'ts-mid-t';

/** Heatmap storica: righe = stagioni, colonne = metriche, colore = rank NFL. */
function _statHeatmap(seasons, metrics, side, title) {
    const rows = seasons.map(s => {
        const cells = metrics.map(m => {
            const { v, rank } = _statCell(s, m, side);
            const good = rank != null ? (33 - rank) / 32 * 100 : null;
            return `<td style="background:${_tsHeat(good)}" title="${esc(`${m.label} ${s.year}: ${v == null ? '—' : m.fmt(v)}${rank != null ? ` · ${rank}ª NFL` : ''}`)}">${v == null ? '—' : m.fmt(v)}</td>`;
        }).join('');
        return `<tr><td class="ts-hname">${s.year}</td>${cells}</tr>`;
    }).join('');
    return `<div class="ts-card">
        <h4 class="ts-sub">${esc(title)}</h4>
        <div class="pm-table-wrap pp-scroll"><table class="pm-table pp-table ts-heat">
            <thead><tr><th>Year</th>${metrics.map(m => `<th title="${esc(m.label)}">${esc(m.label)}</th>`).join('')}</tr></thead>
            <tbody>${rows}</tbody>
        </table></div>
    </div>`;
}

/** Mini trend (sparkline) normalizzata sul proprio min/max. */
function _sparkline(vals, color) {
    const pts = vals.map((v, i) => [i, v]).filter(p => p[1] != null);
    if (pts.length < 2) return '';
    const W = 132, H = 34, pad = 3;
    const idx = vals.map((_, i) => i), xmin = Math.min(...idx), xmax = Math.max(...idx);
    const ys = pts.map(p => p[1]);
    let ymin = Math.min(...ys), ymax = Math.max(...ys); if (ymin === ymax) { ymin -= 1; ymax += 1; }
    const X = i => pad + (xmax === xmin ? 0 : (i - xmin) / (xmax - xmin)) * (W - 2 * pad);
    const Y = v => pad + (1 - (v - ymin) / (ymax - ymin)) * (H - 2 * pad);
    const d = pts.map((p, i) => `${i ? 'L' : 'M'}${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join(' ');
    const last = pts[pts.length - 1];
    return `<svg viewBox="0 0 ${W} ${H}" class="ts-spark" preserveAspectRatio="none"><path d="${d}" fill="none" stroke="${color}" stroke-width="1.6" stroke-linejoin="round"/><circle cx="${X(last[0]).toFixed(1)}" cy="${Y(last[1]).toFixed(1)}" r="2.2" fill="${color}"/></svg>`;
}

/** Griglia di sparkline: una per metrica chiave, col valore e rank dell'ultima stagione. */
function _sparkGrid(seasons, items) {
    const last = seasons[seasons.length - 1];
    return `<div class="ts-spark-grid">${items.map(it => {
        const vals = seasons.map(s => _statCell(s, it.m, it.side).v);
        const { v, rank } = _statCell(last, it.m, it.side);
        return `<div class="ts-spark-cell">
            <div class="ts-spark-top"><span class="ts-spark-lbl">${esc(it.m.label)}</span><span class="ts-spark-val">${v == null ? '—' : it.m.fmt(v)}${rank != null ? ` <small class="${_rankClass(rank)}">${rank}ª</small>` : ''}</span></div>
            ${_sparkline(vals, '#4f8cff')}
        </div>`;
    }).join('')}</div>`;
}

/** Scatter con punti collegati in ordine cronologico (il "viaggio" della squadra). */
function _seasonPathScatter(points, cfg) {
    const pts = points.filter(p => p.x != null && p.y != null);
    if (pts.length < 3) return '';
    const W = 440, H = 300, m = { l: 40, r: 14, t: 12, b: 30 };
    const pw = W - m.l - m.r, ph = H - m.t - m.b;
    const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
    let xmin, xmax, ymin, ymax;
    if (cfg.fix) { xmin = 0; xmax = 100; ymin = 0; ymax = 100; }
    else {
        xmin = Math.min(...xs); xmax = Math.max(...xs); ymin = Math.min(...ys); ymax = Math.max(...ys);
        const px = (xmax - xmin) * 0.12 || 1, py = (ymax - ymin) * 0.12 || 1;
        xmin -= px; xmax += px; ymin -= py; ymax += py;
    }
    const X = v => m.l + (v - xmin) / ((xmax - xmin) || 1) * pw;
    const Y = v => m.t + (1 - (v - ymin) / ((ymax - ymin) || 1)) * ph;
    const yGrid = _tsTicks(ymin, ymax).map(v => `<line x1="${m.l}" y1="${Y(v).toFixed(1)}" x2="${m.l + pw}" y2="${Y(v).toFixed(1)}" stroke="var(--border-subtle)"/><text x="${m.l - 6}" y="${(Y(v) + 3).toFixed(1)}" class="ts-tick" text-anchor="end">${cfg.yFmt(v)}</text>`).join('');
    const xGrid = _tsTicks(xmin, xmax).map(v => `<text x="${X(v).toFixed(1)}" y="${H - 8}" class="ts-tick" text-anchor="middle">${cfg.xFmt(v)}</text>`).join('');
    const guides = cfg.guide ? `<line x1="${X(cfg.guide.x).toFixed(1)}" y1="${m.t}" x2="${X(cfg.guide.x).toFixed(1)}" y2="${m.t + ph}" class="ts-guide"/><line x1="${m.l}" y1="${Y(cfg.guide.y).toFixed(1)}" x2="${m.l + pw}" y2="${Y(cfg.guide.y).toFixed(1)}" class="ts-guide"/>` : '';
    const line = `<path d="${pts.map((p, i) => `${i ? 'L' : 'M'}${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`).join(' ')}" fill="none" stroke="var(--text-muted)" stroke-width="1.4" stroke-dasharray="3 3" opacity="0.75"/>`;
    const dots = pts.map((p, i) => {
        const recent = i === pts.length - 1;
        return `<circle cx="${X(p.x).toFixed(1)}" cy="${Y(p.y).toFixed(1)}" r="${recent ? 6 : 4.5}" fill="${recent ? 'var(--accent-red)' : '#4f8cff'}" fill-opacity="0.85" stroke="#000" stroke-width="1"><title>${esc(p.title)}</title></circle><text x="${(X(p.x) + (recent ? 7 : 5)).toFixed(1)}" y="${(Y(p.y) + 3).toFixed(1)}" class="ts-dotlbl">${esc(p.label)}</text>`;
    }).join('');
    return `<div class="ts-chart"><svg viewBox="0 0 ${W} ${H}" class="ts-svg" role="img" aria-label="${esc(cfg.xLabel)} vs ${esc(cfg.yLabel)}">${yGrid}${xGrid}${guides}${line}${dots}<text x="${m.l - 36}" y="${m.t + 6}" class="ts-axl" text-anchor="start">${esc(cfg.yLabel)} ↑</text></svg></div><div class="ts-xlab">${esc(cfg.xLabel)} →</div>`;
}

/**
 * ANALISI · Andamento negli anni. Heatmap storiche (attacco/difesa, colore =
 * rank NFL per stagione), sparkline delle metriche chiave e due scatter: il
 * "viaggio" Attacco×Difesa e stile×efficienza (pass rate × EPA), collegati in
 * ordine cronologico. Sostituisce Traiettoria e Fattori.
 */
/**
 * Bump chart: posizione NFL (1ª in alto = migliore) di attacco (rank punti
 * fatti) e difesa (rank punti subiti) stagione per stagione. Due linee che si
 * incrociano quando la squadra cambia pelle. Dati già in statTrend (ranks).
 */
function _bumpChart(seasons) {
    const rows = seasons.map(s => ({ year: s.year, off: s.ranks?.offense?.ppg ?? null, def: s.ranks?.defense?.papg ?? null }))
        .filter(r => r.off != null || r.def != null);
    if (rows.length < 3) return '';
    const W = 440, H = 300, m = { l: 34, r: 64, t: 20, b: 28 };
    const pw = W - m.l - m.r, ph = H - m.t - m.b, n = rows.length;
    const xAt = i => m.l + (n > 1 ? i / (n - 1) : 0.5) * pw;
    const yAt = rank => m.t + (rank - 1) / 31 * ph; // 1ª → alto, 32ª → basso
    const grid = [1, 8, 16, 24, 32].map(r => `
        <line x1="${m.l}" y1="${yAt(r).toFixed(1)}" x2="${(m.l + pw).toFixed(1)}" y2="${yAt(r).toFixed(1)}" class="an-gridline"/>
        <text x="${(m.l - 6).toFixed(1)}" y="${(yAt(r) + 3).toFixed(1)}" class="an-tick" text-anchor="end">${r}</text>`).join('');
    const xticks = rows.map((r, i) => `<text x="${xAt(i).toFixed(1)}" y="${H - 8}" class="an-tick" text-anchor="middle">${String(r.year).slice(2)}</text>`).join('');
    const lineFor = (key, color, label) => {
        const pts = rows.map((r, i) => r[key] != null ? { i, rank: r[key], year: r.year } : null).filter(Boolean);
        if (pts.length < 2) return '';
        const poly = pts.map(p => `${xAt(p.i).toFixed(1)},${yAt(p.rank).toFixed(1)}`).join(' ');
        const dots = pts.map(p => `<circle cx="${xAt(p.i).toFixed(1)}" cy="${yAt(p.rank).toFixed(1)}" r="3.4" fill="${color}" stroke="#000" stroke-width="1"><title>${p.year} · ${label} ${ord(p.rank)}</title></circle>`).join('');
        const last = pts[pts.length - 1];
        const endLbl = `<text x="${(xAt(last.i) + 7).toFixed(1)}" y="${(yAt(last.rank) + 3).toFixed(1)}" class="ts-bump-endlbl" fill="${color}">${label}</text>`;
        return `<polyline points="${poly}" fill="none" stroke="${color}" stroke-width="2.4" stroke-linejoin="round"/>${dots}${endLbl}`;
    };
    return `<div class="ts-chart"><svg viewBox="0 0 ${W} ${H}" class="ts-svg ts-bump-svg" role="img" aria-label="Offense vs defense rank over the years">
        ${grid}${xticks}
        <text x="${m.l}" y="12" class="an-tick" text-anchor="start">1st = best ↑</text>
        ${lineFor('off', '#4f8cff', 'Offense')}${lineFor('def', '#f0b429', 'Defense')}
    </svg></div>`;
}

function statTrendBlock(seasons, abbr) {
    if (!seasons || seasons.length < 3) return '';
    const first = seasons[0], last = seasons[seasons.length - 1];

    const odScatter = _seasonPathScatter(seasons.map(s => ({
        x: s.offR, y: s.defR, label: String(s.year).slice(2),
        title: `${s.year} — Offense ${s.offR} · Defense ${s.defR}${s.record ? ` · ${s.record.w}-${s.record.l}` : ''}${s.qb ? ` · QB ${s.qb}` : ''}`,
    })), { xLabel: 'Offense strength', yLabel: 'Defense strength', xFmt: fmt0, yFmt: fmt0, fix: true, guide: { x: 50, y: 50 } });

    const sv = seasons.filter(s => s.adv.passRate != null && s.adv.offEpaPerPlay != null).map(s => ({
        x: s.adv.passRate * 100, y: s.adv.offEpaPerPlay, label: String(s.year).slice(2),
        title: `${s.year} — pass rate ${_tsPct(s.adv.passRate)} · EPA/play ${fmt2(s.adv.offEpaPerPlay)}`,
    }));
    const svScatter = _seasonPathScatter(sv, { xLabel: 'Pass rate %', yLabel: 'EPA/play', xFmt: fmt0, yFmt: fmt2 });
    const bump = _bumpChart(seasons);

    const bestOff = [...seasons].sort((a, b) => b.offR - a.offR)[0];
    const bestDef = [...seasons].sort((a, b) => b.defR - a.defR)[0];
    const insight = `Best offense in <b>${bestOff.year}</b> (${bestOff.offR}/100), best defense in <b>${bestDef.year}</b> (${bestDef.defR}/100). The "journey" shows how the team moved between quadrants from ${first.year} to ${last.year} (red = most recent).`;

    return `
    <section class="pm-block pp-block">
        <span class="mc-kicker">Trend over the years · ${esc(abbr)}</span>
        <p class="pp-sos">${insight}</p>
        <div class="ts-charts">
            ${odScatter ? `<div class="ts-card"><h4 class="ts-sub">The Offense × Defense journey</h4>${odScatter}<p class="pm-note">One dot per season (0-100, NFL percentiles), connected chronologically. Top-right = complete team; bottom-left = a rebuilding year.</p></div>` : ''}
            ${bump ? `<div class="ts-card"><h4 class="ts-sub">Offense vs defense rank · over the years</h4>${bump}<p class="pm-note">NFL rank (1st at top = best) of offense (points scored) and defense (points allowed) season by season: the two lines cross when the team changes its identity.</p></div>` : ''}
            ${svScatter ? `<div class="ts-card"><h4 class="ts-sub">Style × efficiency</h4>${svScatter}<p class="pm-note">How much the team passes (pass rate) vs how much it produces per play (EPA), year by year: shows the evolution of the offensive identity.</p></div>` : ''}
        </div>
        <h4 class="ts-sub" style="margin-top:18px">Key metrics · trend</h4>
        ${_sparkGrid(seasons, SPARKS)}
        <div class="ts-heat-stack">
            ${_statHeatmap(seasons, OFF_HEAT, 'offense', 'Offense · NFL rank by season (green 1st → red 32nd)')}
            ${_statHeatmap(seasons, DEF_HEAT, 'defense', 'Defense · NFL rank by season')}
        </div>
        <p class="pm-note">Heatmap: rows = seasons, columns = metrics, color = that year's NFL rank (1st green → 32nd red), the number is the actual value. EPA/play and Success% from nflverse advanced (rank among the 32), the rest from team_stats. Sparklines normalized on their own min/max. ${first.year}-${last.year}.</p>
    </section>`;
}

/**
 * ANALISI · Carta d'identità squadra. Blocco di SINTESI in testa alla sezione:
 * non introduce dati nuovi, riorganizza i rank già calcolati per rispondere
 * subito a «chi è questa squadra?». Tre parti: (1) tile chiave (differenziale
 * punti/gara, record, margine turnover, rank EPA), (2) quadrante Attacco×Difesa
 * sulle 32 squadre (percentili lega), (3) fingerprint a rank (barre attacco +
 * difesa) e le 3 forze / 3 debolezze chiamate automaticamente dai rank.
 * Tutto additivo: i blocchi di dettaglio sotto restano invariati.
 */
/** Nota mostrata al posto delle statistiche avanzate quando la stagione è quella
 *  corrente/futura e i dati nflverse non sono ancora usciti (preseason). */
function preseasonStatsNote(year) {
    return `<section class="pm-block pp-block">
        <span class="mc-kicker">Season ${year} stats</span>
        <p class="pm-note">Advanced stats for the ${year} season are not available yet (preseason): they appear automatically as soon as nflverse data is published. In the meantime you already have Football Power Index, roster, depth chart (with injuries), schedule and transactions updated from ESPN.</p>
    </section>`;
}

/** DNA squadra (nflverse), o nota preseason se la stagione corrente non ha ancora dati. */
function teamDnaBlockOrNote(ctx, year) {
    const html = teamDnaBlock(ctx);
    if (html) return html;
    return year >= currentNflSeason() ? preseasonStatsNote(year) : '';
}

function teamDnaBlock(ctx) {
    const team = ctx.ctx?.team;
    const off = team?.offense, def = team?.defense;
    if (!off || !def) return '';
    const ro = team.ranks?.offense || {}, rd = team.ranks?.defense || {};
    const { abbr, year } = ctx;
    const A = canonAbbr(abbr);
    const rec = team.record;
    const a = ctx.advTeam || {};

    // Rank NFL di EPA/success (dall'advanced lega, non presenti nei team_stats).
    const advVals = Object.values(ctx.leagueAdv || {});
    const rankOf = (val, arr, hi = true) => val == null || !arr.length ? null
        : arr.filter(v => v != null && (hi ? v > val : v < val)).length + 1;
    const nTeams = advVals.length || 32;
    const epaRank = rankOf(a.offEpaPerPlay, advVals.map(t => t.offEpaPerPlay), true);
    const succRank = rankOf(a.successRate, advVals.map(t => t.successRate), true);

    // Differenziale punti e margine turnover — derivati da dati già in pagina.
    const games = rec ? (rec.w + rec.l + (rec.t || 0)) : null;
    const netPg = (off.ppg != null && def.papg != null) ? off.ppg - def.papg : null;
    const toMargin = (def.takeaways != null && off.turnovers != null) ? def.takeaways - off.turnovers : null;

    const tiles = [
        netPg != null ? tile((netPg >= 0 ? '+' : '') + fmt1(netPg), 'Point differential/game') : '',
        rec ? tile(`${rec.w}-${rec.l}${rec.t ? '-' + rec.t : ''}`, `Record ${year}`) : '',
        toMargin != null ? tile((toMargin >= 0 ? '+' : '') + toMargin, 'Margine turnover') : '',
        epaRank ? tile(ord(epaRank), 'Rank EPA offensiva') : '',
        off.playsPg != null ? tile(fmt1(off.playsPg), 'Pace · plays/game') : '',
        a.proe != null ? tile((a.proe >= 0 ? '+' : '') + fmt1(a.proe) + '%', 'PROE · pass aggressiveness') : '',
    ].filter(Boolean).join('');

    // Quadrante Attacco×Difesa: un punto per squadra (percentili lega), noi in rosso.
    const teamsStats = ctx.leagueStats?.teams || {};
    const advByAbbr = {};
    for (const [k, v] of Object.entries(ctx.leagueAdv || {})) advByAbbr[canonAbbr(k)] = v;
    const epaAll = Object.values(advByAbbr).map(t => t.offEpaPerPlay).filter(v => v != null);
    const defEpaAll = Object.values(advByAbbr).map(t => t.defEpaPerPlay).filter(v => v != null);
    const useDefEpa = defEpaAll.length >= 24; // EPA difensiva reale se disponibile, altrimenti proxy punti subiti
    const ppgAll = Object.values(teamsStats).map(t => t.offense?.ppg).filter(v => v != null);
    const papgAll = Object.values(teamsStats).map(t => t.defense?.papg).filter(v => v != null);
    const pts = [];
    for (const [ab, t] of Object.entries(teamsStats)) {
        const cab = canonAbbr(ab);
        const adv = advByAbbr[cab] || {};
        const offEpa = adv.offEpaPerPlay;
        const offScore = offEpa != null ? Math.round(100 * _pct01(offEpa, epaAll))
            : (t.offense?.ppg != null ? Math.round(100 * _pct01(t.offense.ppg, ppgAll)) : null);
        const defScore = (useDefEpa && adv.defEpaPerPlay != null)
            ? Math.round(100 * (1 - _pct01(adv.defEpaPerPlay, defEpaAll)))
            : (t.defense?.papg != null ? Math.round(100 * (1 - _pct01(t.defense.papg, papgAll))) : null);
        if (offScore == null || defScore == null) continue;
        pts.push({ abbr: ab, x: offScore, y: defScore, me: cab === A });
    }
    const scatter = _teamScatter(pts, { xLabel: 'Offense strength', yLabel: 'Defense strength', xFmt: fmt0, yFmt: fmt0 });
    const me = pts.find(p => p.me);

    // Insight identità dal quadrante (percentili 0-100, 50 = mediana NFL).
    let identity = '';
    if (me) {
        const o = me.x, d = me.y;
        if (o >= 60 && d >= 60) identity = '<b>Complete</b> team: offense and defense both above the NFL average.';
        else if (o >= 58 && d < 45) identity = '<b>Offense-driven</b> team: it has to score a lot to win, the defense cannot hold up.';
        else if (d >= 58 && o < 45) identity = '<b>Defense-built</b> team: wins low-scoring games, the offense struggles.';
        else if (o < 42 && d < 42) identity = '<b>Rebuilding</b> season: below the NFL average on both sides of the ball.';
        else identity = '<b>Balanced</b> profile, around the NFL average on both sides.';
    }

    // Fingerprint: barre di rank NFL (1 = migliore) — attacco e difesa.
    const offBars = _rankBars([
        { label: 'Points/game', value: fmt1(off.ppg), rank: ro.ppg },
        epaRank ? { label: 'EPA/play', value: fmt2(a.offEpaPerPlay), rank: epaRank, total: nTeams } : null,
        succRank ? { label: 'Success rate', value: fmt0(a.successRate * 100) + '%', rank: succRank, total: nTeams } : null,
        { label: 'Yards/play', value: fmt1(off.ydsPerPlay), rank: ro.ydsPerPlay },
        { label: 'Red zone plays/game', value: fmt1(off.rzPlaysPg), rank: ro.rzPlaysPg },
        { label: 'Ball security', value: fmt0(off.turnovers), rank: ro.turnovers },
    ].filter(Boolean));
    const defEpaRank = a.defEpaPerPlay != null ? rankOf(a.defEpaPerPlay, advVals.map(t => t.defEpaPerPlay), false) : null;
    const defSuccRank = a.defSuccessRate != null ? rankOf(a.defSuccessRate, advVals.map(t => t.defSuccessRate), false) : null;
    const defBars = _rankBars([
        defEpaRank ? { label: 'EPA allowed/play', value: fmt2(a.defEpaPerPlay), rank: defEpaRank, total: nTeams } : null,
        defSuccRank ? { label: 'Success allowed', value: fmt0(a.defSuccessRate * 100) + '%', rank: defSuccRank, total: nTeams } : null,
        { label: 'Points allowed/game', value: fmt1(def.papg), rank: rd.papg },
        { label: 'Yards allowed/game', value: fmt0(def.totYdsAllowedPg), rank: rd.totYdsAllowedPg },
        { label: 'Sack', value: fmt0(def.sacks), rank: rd.sacks },
        { label: 'Takeaways', value: fmt0(def.takeaways), rank: rd.takeaways },
    ].filter(Boolean));

    // Forze / debolezze: candidati con rank (1 = migliore), estremi automatici.
    const cand = [
        { rank: ro.ppg, label: 'prolific offense' }, { rank: epaRank, label: 'offensive efficiency (EPA)' },
        { rank: succRank, label: 'offensive consistency (success rate)' }, { rank: ro.ydsPerPlay, label: 'yards gained per play' },
        { rank: ro.rzPlaysPg, label: 'red zone presence' }, { rank: ro.turnovers, label: 'offensive ball security' },
        { rank: ro.sacksAllowed, label: 'quarterback protection' }, { rank: ro.passYdsPg, label: 'passing game' },
        { rank: ro.rushYdsPg, label: 'rushing game' }, { rank: defEpaRank, label: 'defensive efficiency (EPA allowed)' },
        { rank: rd.papg, label: 'points allowed by the defense' },
        { rank: rd.totYdsAllowedPg, label: 'yards allowed by the defense' }, { rank: rd.rushYdsAllowedPg, label: 'run defense' },
        { rank: rd.passYdsAllowedPg, label: 'pass defense' }, { rank: rd.sacks, label: 'pass rush (sacks)' },
        { rank: rd.takeaways, label: 'takeaways' }, { rank: rd.qbHits, label: 'quarterback pressure' },
    ].filter(c => c.rank != null);
    const strengths = cand.filter(c => c.rank <= 8).sort((x, y) => x.rank - y.rank).slice(0, 3);
    const weakBar = Math.max(23, nTeams - 7);
    const weaknesses = cand.filter(c => c.rank >= weakBar).sort((x, y) => y.rank - x.rank).slice(0, 3);
    const fdCol = (items, title, cls) => items.length ? `
        <div class="ts-card">
            <h4 class="ts-sub">${title}</h4>
            <div class="pp-fact-chips" style="margin-top:6px">
                ${items.map(c => factChip(ord(c.rank), esc(c.label))).join('')}
            </div>
        </div>` : '';
    const fd = (strengths.length || weaknesses.length) ? `
        <div class="ts-charts" style="margin-top:16px">
            ${fdCol(strengths, '💪 Strengths', 'good')}
            ${fdCol(weaknesses, '⚠️ Da migliorare', 'bad')}
        </div>` : '';

    if (!tiles && !scatter && !offBars && !defBars) return '';
    return `
    <section class="pm-block pp-block">
        <span class="mc-kicker">Identity card · ${esc(abbr)} ${year}</span>
        ${identity ? `<p class="pp-sos">${identity}</p>` : ''}
        ${tiles ? `<div class="pm-tiles pp-tiles">${tiles}</div>` : ''}
        <div class="ts-charts" style="margin-top:14px">
            ${scatter ? `<div class="ts-card">
                <h4 class="ts-sub">The NFL quadrant · Offense × Defense</h4>
                ${scatter}
                <p class="pm-note">One dot per team (0-100, NFL percentiles for the season), <b style="color:var(--accent-red)">${esc(abbr)}</b> in red. Lines = medians: top-right the complete teams, bottom-left those rebuilding. Offense = EPA/play percentile, defense = inverse percentile of ${useDefEpa ? "EPA allowed" : 'points allowed'}.</p>
            </div>` : ''}
            <div class="ts-card">
                <h4 class="ts-sub">Footprint · NFL rank (1st–${nTeams}th)</h4>
                ${offBars ? `<h5 class="ts-sub" style="font-size:12px;opacity:.75;margin:4px 0">Offense</h5>${offBars}` : ''}
                ${defBars ? `<h5 class="ts-sub" style="font-size:12px;opacity:.75;margin:10px 0 4px">Defense</h5>${defBars}` : ''}
            </div>
        </div>
        ${fd}
        <p class="pm-note">Summary from already-computed ranks (no new data): differential = points scored − allowed per game; turnover margin = takeaways − giveaways; strengths/weaknesses = the most extreme metrics in the NFL rank. The full detail is in the blocks below.</p>
    </section>`;
}

/** Scatter di confronto lega: un punto per squadra, la nostra evidenziata,
 *  linee = mediane NFL. points = [{abbr, x, y, me}]. */
function _teamScatter(points, cfg) {
    const pts = points.filter(p => p.x != null && p.y != null);
    if (pts.length < 6) return '';
    const W = 600, H = 320, m = { l: 48, r: 14, t: 12, b: 34 };
    const pw = W - m.l - m.r, ph = H - m.t - m.b;
    const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
    let xmin = Math.min(...xs), xmax = Math.max(...xs), ymin = Math.min(...ys), ymax = Math.max(...ys);
    const px = (xmax - xmin) * 0.08 || 1, py = (ymax - ymin) * 0.08 || 1;
    xmin -= px; xmax += px; ymin -= py; ymax += py;
    const X = v => m.l + (cfg.invertX ? (xmax - v) : (v - xmin)) / ((xmax - xmin) || 1) * pw;
    const Y = v => m.t + (1 - (v - ymin) / ((ymax - ymin) || 1)) * ph;
    const med = arr => { const a = [...arr].sort((p, q) => p - q); return a[Math.floor(a.length / 2)]; };
    const mx = med(xs), my = med(ys);

    const yGrid = _tsTicks(ymin, ymax).map(v => `
        <line x1="${m.l}" y1="${Y(v).toFixed(1)}" x2="${m.l + pw}" y2="${Y(v).toFixed(1)}" stroke="var(--border-subtle)"/>
        <text x="${m.l - 6}" y="${(Y(v) + 3).toFixed(1)}" class="ts-tick" text-anchor="end">${cfg.yFmt(v)}</text>`).join('');
    const xGrid = _tsTicks(xmin, xmax).map(v => `<text x="${X(v).toFixed(1)}" y="${H - 8}" class="ts-tick" text-anchor="middle">${cfg.xFmt(v)}</text>`).join('');
    const guides = `<line x1="${X(mx).toFixed(1)}" y1="${m.t}" x2="${X(mx).toFixed(1)}" y2="${m.t + ph}" class="ts-guide"/>
        <line x1="${m.l}" y1="${Y(my).toFixed(1)}" x2="${m.l + pw}" y2="${Y(my).toFixed(1)}" class="ts-guide"/>`;
    // Un logo (trasparente) per squadra al posto del punto; la nostra più grande con anello rosso.
    const ordered = [...pts].sort((a, b) => (a.me ? 1 : 0) - (b.me ? 1 : 0)); // la nostra disegnata per ultima → sopra
    const dots = ordered.map(p => {
        const s = p.me ? 30 : 20, cx = X(p.x), cy = Y(p.y);
        const ring = p.me ? `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${(s / 2 + 3).toFixed(1)}" fill="none" stroke="var(--accent-red)" stroke-width="2"/>` : '';
        return `<g${p.me ? '' : ' opacity="0.85"'}>${ring}<image href="${teamLogo(p.abbr)}" x="${(cx - s / 2).toFixed(1)}" y="${(cy - s / 2).toFixed(1)}" width="${s}" height="${s}"><title>${esc(p.abbr)} — ${esc(cfg.xLabel)}: ${cfg.xFmt(p.x)} · ${esc(cfg.yLabel)}: ${cfg.yFmt(p.y)}</title></image></g>`;
    }).join('');
    const me = pts.find(p => p.me);
    const meLbl = me ? `<text x="${(X(me.x) + 20).toFixed(1)}" y="${(Y(me.y) + 3).toFixed(1)}" class="ts-dotlbl" fill="var(--accent-red)">${esc(me.abbr)}</text>` : '';
    return `<div class="ts-chart"><svg viewBox="0 0 ${W} ${H}" class="ts-svg" role="img" aria-label="${esc(cfg.xLabel)} vs ${esc(cfg.yLabel)}">
        ${yGrid}${xGrid}${guides}${dots}${meLbl}
        <text x="${m.l + pw}" y="${m.t + ph + 24}" class="ts-axl" text-anchor="end">${esc(cfg.xLabel)}${cfg.invertX ? ' ←' : ' →'}</text>
        <text x="${m.l - 42}" y="${m.t + 8}" class="ts-axl" text-anchor="start">${esc(cfg.yLabel)} ↑</text>
    </svg></div>`;
}

/** Barre di rank NFL (1–32): verde alto rank, rosso basso. items = [{label, value, rank, total}]. */
function _rankBars(items) {
    const rows = items.filter(i => i.rank != null).map(i => {
        const total = i.total || 32;
        const fill = ((total - i.rank + 1) / total * 100).toFixed(0);
        const cls = i.rank <= 10 ? 'ts-good' : i.rank >= (total - 9) ? 'ts-bad' : 'ts-mid';
        return `<div class="ts-rankrow">
            <span class="ts-rankl">${esc(i.label)}</span>
            <span class="ts-ranktrack"><span class="ts-rankfill ${cls}" style="width:${fill}%"></span></span>
            <span class="ts-rankv">${esc(String(i.value))} <small>${i.rank}ª</small></span>
        </div>`;
    }).join('');
    return rows ? `<div class="ts-ranks">${rows}</div>` : '';
}

/**
 * ANALISI ATTACCO. Parte A: confronto con le altre 32 squadre (scatter EPA/gioco
 * × success rate da adv_team + rank sulle metriche chiave). Parte B: come si
 * traduce in fantasy — pt lega/gara prodotti per ruolo (QB/RB/WR/TE) e rank NFL.
 */
function offenseAnalysisBlock(ctx) {
    const team = ctx.ctx?.team, off = team?.offense, ranks = team?.ranks?.offense;
    if (!off) return '';
    const { abbr, year } = ctx;

    const pts = Object.entries(ctx.leagueAdv || {})
        .map(([ab, v]) => ({ abbr: ab, x: v.offEpaPerPlay, y: v.successRate, me: canonAbbr(ab) === canonAbbr(abbr) }));
    const scatter = _teamScatter(pts, { xLabel: 'EPA/gioco', yLabel: 'Success rate', xFmt: fmt2, yFmt: _tsPct });

    // Play-calling identity: PROE (aggressività lancio) × ritmo (giochi/gara), 32 squadre.
    const tendPts = Object.entries(ctx.leagueAdv || {})
        .map(([ab, v]) => ({ abbr: ab, x: v.proe, y: v.playsPg, me: canonAbbr(ab) === canonAbbr(abbr) }));
    const tendScatter = _teamScatter(tendPts, { xLabel: 'PROE · pass aggressiveness', yLabel: 'Pace · plays/game', xFmt: v => (v >= 0 ? '+' : '') + fmt1(v), yFmt: fmt1 });

    const rankBars = _rankBars([
        { label: 'Points/game', value: fmt1(off.ppg), rank: ranks?.ppg },
        { label: 'Yards/play', value: fmt1(off.ydsPerPlay), rank: ranks?.ydsPerPlay },
        { label: 'Total yds/game', value: fmt0(off.totYdsPg), rank: ranks?.totYdsPg },
        { label: 'Red zone plays/game', value: fmt1(off.rzPlaysPg), rank: ranks?.rzPlaysPg },
        { label: 'Turnovers', value: fmt0(off.turnovers), rank: ranks?.turnovers },
    ]);

    // Resa fantasy per ruolo dell'attacco + rank NFL — produzione TOTALE in
    // stagione (pt/gara × partite), non la somma dei pt/gara (che premierebbe la
    // rotazione di tanti part-time invece delle room concentrate).
    const teamFp = { QB: 0, RB: 0, WR: 0, TE: 0 };
    for (const p of ctx.usage || []) if (teamFp[p.pos] != null && p.fpgLeague != null) teamFp[p.pos] += p.fpgLeague * (p.gp || 0);
    const lf = ctx.leagueFantasy || {};
    const fpItems = ['QB', 'RB', 'WR', 'TE'].map(pos => {
        const mine = teamFp[pos];
        const vals = Object.values(lf).map(t => t[pos] || 0);
        const rank = vals.length ? vals.filter(v => v > mine + 1e-9).length + 1 : null;
        return { label: pos, value: `${fmt0(mine)} pt`, rank, total: vals.length || 32 };
    });
    const fpBars = _rankBars(fpItems);
    const best = [...fpItems].filter(i => i.rank != null).sort((a, b) => a.rank - b.rank)[0];
    const fantasyInsight = best ? `The strongest unit for fantasy is the <b>${best.label}</b> group: <b>${best.rank}th</b> NFL production for the position (${best.value.replace(' pt', '')} total league pts for the season).` : '';

    if (!scatter && !rankBars && !fpBars) return '';
    return `
    <section class="pm-block pp-block">
        <span class="mc-kicker">Offense analysis · ${esc(abbr)} ${year}</span>
        <h3 class="pp-cat-title">The offense in the NFL</h3>
        <div class="ts-charts">
            ${scatter ? `<div class="ts-card">${scatter}<p class="pm-note">EPA/play (X) × success rate (Y) for all 32 teams; <b style="color:var(--accent-red)">${esc(abbr)}</b> highlighted, lines = NFL medians. Top-right the explosive and consistent offenses.</p></div>` : ''}
            ${tendScatter ? `<div class="ts-card"><h4 class="ts-sub">Play-calling identity</h4>${tendScatter}<p class="pm-note">PROE (X, how much it passes over expected) × pace (Y, plays/game) for all 32 teams; <b style="color:var(--accent-red)">${esc(abbr)}</b> highlighted. Top-right = aggressive and fast; bottom-left = conservative and slow. Puts the available fantasy volume in context.</p></div>` : ''}
            ${rankBars ? `<div class="ts-card"><h4 class="ts-sub">Rank NFL · 1–32</h4>${rankBars}</div>` : ''}
        </div>
        ${fpBars ? `<h3 class="pp-cat-title" style="margin-top:18px">How it translates to fantasy</h3>
        ${fantasyInsight ? `<p class="pp-sos">${fantasyInsight}</p>` : ''}
        ${fpBars}
        <p class="pm-note">TOTAL league fantasy points for the season produced by offensive players per position, with rank across the 32 teams (league scoring). The total does not penalize concentrated rooms. Source: nflverse.</p>` : ''}
    </section>`;
}

/**
 * Profilo difensivo per ruolo: una barra per QB/RB/WR/TE dai fantasy points
 * concessi (FPA). Tier INVERTITO rispetto ai rank normali — qui rank 1 = concede
 * di più = difesa morbida = rosso; rank alto = stingy = verde. Barra lunga =
 * concede molto. Riusa le classi ts-rank* di _rankBars.
 */
function _fpaBars(fpa) {
    const rows = ['QB', 'RB', 'WR', 'TE'].map(p => {
        const f = fpa?.[p];
        if (!f || (f.pgLeague == null && f.pgHalf == null)) return null;
        return { pos: p, val: f.pgLeague ?? f.pgHalf, rank: f.rank };
    }).filter(Boolean);
    if (!rows.length) return '';
    const bars = rows.map(r => {
        const fill = r.rank != null ? Math.max(4, (33 - r.rank) / 32 * 100) : 50;
        const cls = r.rank == null ? '' : r.rank <= 10 ? 'ts-bad' : r.rank >= 23 ? 'ts-good' : 'ts-mid';
        return `<div class="ts-rankrow">
            <span class="ts-rankl">vs ${r.pos}</span>
            <span class="ts-ranktrack"><span class="ts-rankfill ${cls}" style="width:${fill.toFixed(0)}%"></span></span>
            <span class="ts-rankv">${fmt1(r.val)}${r.rank != null ? ` <small>${ord(r.rank)}</small>` : ''}</span>
        </div>`;
    }).join('');
    return `<div class="ts-ranks">${bars}</div>`;
}

/**
 * ANALISI DIFESA. Parte A: confronto lega (scatter punti subiti × takeaway +
 * rank; niente EPA difensiva, non nei dati). Parte B: profilo difensivo per
 * ruolo (barre FPA + tabella completa riusata da player-page).
 */
function defenseAnalysisBlock(ctx) {
    const team = ctx.ctx?.team, def = team?.defense, ranks = team?.ranks?.defense;
    if (!def) return '';
    const { abbr, year } = ctx;
    const teams = ctx.leagueStats?.teams || {};

    // EPA/success CONCESSI dall'advanced nflverse (più basso = meglio) — reali dal 2019.
    const a = ctx.advTeam || {};
    const advVals = Object.values(ctx.leagueAdv || {});
    const rankLow = (val, arr) => val == null || !arr.length ? null : arr.filter(v => v != null && v < val).length + 1;
    const defEpaRank = rankLow(a.defEpaPerPlay, advVals.map(t => t.defEpaPerPlay));
    const defSuccRank = rankLow(a.defSuccessRate, advVals.map(t => t.defSuccessRate));
    const nT = advVals.length || 32;
    const hasDefEpa = defEpaRank != null;

    const pts = Object.entries(teams)
        .map(([ab, t]) => ({ abbr: ab, x: t.defense?.papg, y: t.defense?.takeaways, me: canonAbbr(ab) === canonAbbr(abbr) }));
    const scatter = _teamScatter(pts, { xLabel: 'Points allowed/game', yLabel: 'Takeaways', xFmt: fmt1, yFmt: fmt0, invertX: true });

    const rankBars = _rankBars([
        hasDefEpa ? { label: 'EPA allowed/play', value: fmt2(a.defEpaPerPlay), rank: defEpaRank, total: nT } : null,
        defSuccRank ? { label: 'Success allowed', value: fmt0(a.defSuccessRate * 100) + '%', rank: defSuccRank, total: nT } : null,
        { label: 'Points allowed/game', value: fmt1(def.papg), rank: ranks?.papg },
        { label: 'Yards allowed/game', value: fmt0(def.totYdsAllowedPg), rank: ranks?.totYdsAllowedPg },
        { label: 'Sack', value: fmt0(def.sacks), rank: ranks?.sacks },
        { label: 'Takeaways', value: fmt0(def.takeaways), rank: ranks?.takeaways },
    ].filter(Boolean));

    const fpaBars = _fpaBars(ctx.ctx?.team?.fpa);
    const fpa = fpaTableHtml(ctx.ctx);

    if (!scatter && !rankBars && !fpa) return '';
    return `
    <section class="pm-block pp-block">
        <span class="mc-kicker">Defense analysis · ${esc(abbr)} ${year}</span>
        <h3 class="pp-cat-title">The defense in the NFL</h3>
        <div class="ts-charts">
            ${scatter ? `<div class="ts-card">${scatter}<p class="pm-note">Points allowed/game (X, right = fewer = better) × takeaways (Y) for all 32 teams; <b style="color:var(--accent-red)">${esc(abbr)}</b> highlighted. Top-right the defenses that allow little and force turnovers.${hasDefEpa ? ' EPA and success allowed (from nflverse play-by-play) in the ranks alongside.' : ''}</p></div>` : ''}
            ${rankBars ? `<div class="ts-card"><h4 class="ts-sub">Rank NFL · 1–32</h4>${rankBars}</div>` : ''}
        </div>
        ${fpaBars ? `<h3 class="pp-cat-title" style="margin-top:18px">Defensive profile · fantasy allowed per position</h3>${fpaBars}
        <p class="pm-note">A long <b style="color:var(--accent-red)">red</b> bar = allows a lot of fantasy points to that position (soft defense there for opponents); <b style="color:#22c55e">green</b> = allows little. Rank 1st = allows the most among the 32 teams.</p>` : ''}
        ${fpa ? `<details class="pp-recap-ids" style="margin-top:8px"><summary>Full FPA table (league · half · rank)</summary><div style="margin-top:8px">${fpa}</div></details>` : ''}
    </section>`;
}

/** Football Power Index (rating, rank, record proiettato). */
function fpiBlock({ fpi }) {
    if (!fpi || fpi.fpi == null) return '';
    const tiles = [
        tile(fmt1(fpi.fpi), 'FPI (net points)'),
        fpi.rank != null ? tile(ord(fpi.rank), 'Rank FPI (su 32)') : '',
        fpi.projW != null && fpi.projL != null ? tile(`${Math.round(fpi.projW)}-${Math.round(fpi.projL)}${fpi.projT ? `-${Math.round(fpi.projT)}` : ''}`, 'Projected record') : '',
    ].filter(Boolean).join('');
    if (!tiles) return '';
    return `
    <section class="pm-block pp-block">
        <span class="mc-kicker">Football Power Index · ESPN</span>
        <div class="pm-tiles pp-tiles">${tiles}</div>
        <p class="pm-note">FPI measures the team's net strength (expected point margin against an average opponent); rank and projected record from the same ESPN run.</p>
    </section>`;
}

/** Stat sheet ufficiale ESPN per categoria, con rank 1-32. */
// Numero di rank da una stringa ESPN ("5th", "T-3rd", "12th") → intero 1-32.
const _rankNum = (s) => { const m = String(s ?? '').match(/\d+/); return m ? +m[0] : null; };

/**
 * Impronta rank dello stat-sheet: una traccia per categoria da 1° (sx) a 32°
 * (dx), un punto per statistica al suo rank NFL, colore = fascia (verde top-10,
 * ambra media, rosso bottom-10). Tutto il foglio a colpo d'occhio; i valori
 * esatti in hover e nelle tabelle complete sotto.
 */
function _statFingerprint(categories) {
    const rows = categories.map(c => ({
        label: c.label,
        dots: (c.stats || []).map(s => ({ label: s.label, value: s.value, rank: _rankNum(s.rank) }))
            .filter(d => d.rank != null && d.rank >= 1 && d.rank <= 32),
    })).filter(c => c.dots.length);
    if (!rows.length) return '';
    const W = 680, rowH = 34, m = { l: 124, r: 18, t: 26, b: 10 };
    const pw = W - m.l - m.r, H = m.t + rows.length * rowH + m.b;
    const xAt = r => m.l + (r - 1) / 31 * pw;
    const tier = r => r <= 10 ? '#22c55e' : r >= 23 ? '#e0574c' : '#f59e0b';
    const zones = `<rect x="${xAt(1).toFixed(1)}" y="${m.t}" width="${(xAt(10.5) - xAt(1)).toFixed(1)}" height="${(rows.length * rowH).toFixed(1)}" class="ts-fp-zone-good"/>
        <rect x="${xAt(22.5).toFixed(1)}" y="${m.t}" width="${(xAt(32) - xAt(22.5)).toFixed(1)}" height="${(rows.length * rowH).toFixed(1)}" class="ts-fp-zone-bad"/>`;
    const scale = `<text x="${xAt(1).toFixed(1)}" y="16" class="an-tick" text-anchor="start">1st best</text>
        <text x="${xAt(32).toFixed(1)}" y="16" class="an-tick" text-anchor="end">32°</text>`;
    const body = rows.map((row, i) => {
        const y = m.t + i * rowH + rowH / 2;
        const track = `<line x1="${m.l}" y1="${y.toFixed(1)}" x2="${(m.l + pw).toFixed(1)}" y2="${y.toFixed(1)}" class="ts-fp-track"/>`;
        const lbl = `<text x="${(m.l - 10).toFixed(1)}" y="${(y + 4).toFixed(1)}" class="ts-fp-lbl" text-anchor="end">${esc(row.label)}</text>`;
        const dots = row.dots.map(d => `<circle cx="${xAt(d.rank).toFixed(1)}" cy="${y.toFixed(1)}" r="4.5" fill="${tier(d.rank)}" fill-opacity="0.85" stroke="#000" stroke-width="0.8"><title>${esc(d.label)}: ${esc(String(d.value))} · ${d.rank}ª NFL</title></circle>`).join('');
        return `${track}${lbl}${dots}`;
    }).join('');
    return `<div class="ts-chart"><svg viewBox="0 0 ${W} ${H}" class="ts-svg ts-fp-svg" role="img" aria-label="Impronta rank statistiche ufficiali ESPN">${zones}${scale}${body}</svg></div>`;
}

function seasonStatsBlock({ seasonStats }) {
    if (!seasonStats?.length) return '';
    const catTable = (c) => `
        <div class="pp-statcat">
            <h3 class="pp-cat-title">${esc(c.label)}</h3>
            <div class="pm-table-wrap pp-scroll">
                <table class="pm-table pp-table">
                    <thead><tr><th>Stat</th><th>Value</th><th>NFL rank</th></tr></thead>
                    <tbody>${c.stats.map(s => `<tr><td>${esc(s.label)}</td><td class="pm-td-strong">${esc(s.value)}</td><td>${esc(s.rank)}</td></tr>`).join('')}</tbody>
                </table>
            </div>
        </div>`;
    const fingerprint = _statFingerprint(seasonStats);
    if (!fingerprint) return `
    <section class="pm-block pp-block">
        <span class="mc-kicker">Official stats · ESPN</span>
        ${seasonStats.map(catTable).join('')}
        <p class="pm-note">Official ESPN stat sheet with 1-32 rank across all 32 teams (regular season).</p>
    </section>`;
    return `
    <section class="pm-block pp-block">
        <span class="mc-kicker">Official stats · ESPN</span>
        ${fingerprint}
        <p class="pm-note">Each dot is an official stat at its position in the NFL rank 1–32 (green = top-10, amber = average, red = bottom-10). Hover for value and rank; the full tables are below.</p>
        <details class="pp-recap-ids" style="margin-top:8px">
            <summary>Full tables by category (${seasonStats.length})</summary>
            <div style="margin-top:8px">${seasonStats.map(catTable).join('')}</div>
        </details>
    </section>`;
}

/**
 * Depth chart completo (profondità ordinata per slot) + rosa completa: la
 * tabella con TUTTI i giocatori e le statistiche è un <details> in fondo allo
 * stesso blocco, così un click allarga il blocco alla rosa intera. Il depth
 * chart viene da ESPN/nflverse (live), la tabella rosa da nflverse (teamRoster).
 */
function depthChartTab(live) {
    const depthChart = live?.depthChart;
    const col = (list, label) => {
        if (!list?.length) return '';
        const rows = list.map(slot => `
            <div class="pp-depth-row">
                <span class="pp-lb-pos">${esc(slot.pos || '')}</span>
                <span class="pp-depth-players">${slot.players.map((pl, i) => {
                    const inj = pl.injury ? `<span class="pp-depth-inj${/out|IR|PUP/i.test(`${pl.injury.abbr || ''} ${pl.injury.status || ''}`) ? ' pp-depth-inj-out' : ''}" title="${esc(pl.injury.status || 'Injured')}">${esc(pl.injury.abbr || '!')}</span>` : '';
                    return `<span class="pp-depth-player${i === 0 ? ' pp-depth-starter' : ''}">${esc(pl.name || '—')}${pl.jersey != null ? ` <small>#${pl.jersey}</small>` : ''}${inj}</span>`;
                }).join('<span class="pp-depth-sep">›</span>')}</span>
            </div>`).join('');
        return `<div class="pp-starters-col"><h3 class="pp-cat-title">${label}</h3>${rows}</div>`;
    };
    // Attacco e Difesa affiancati; Special Teams a tutta larghezza sotto.
    const mainHtml = depthChart ? (col(depthChart.offense, 'Attacco') + col(depthChart.defense, 'Difesa')) : '';
    const specialHtml = depthChart ? col(depthChart.special, 'Special Teams') : '';
    if (!mainHtml && !specialHtml) return '';
    const build = depthChart?.source === 'build';
    return `
    <section class="pm-block pp-block">
        <span class="mc-kicker">Depth chart · ${build ? 'nflverse' : 'ESPN + nflverse'}</span>
        <div class="pp-starters-grid">${mainHtml}</div>
        ${specialHtml ? `<div class="pp-depth-special">${specialHtml}</div>` : ''}
        <p class="pm-note">Depth ordered by slot (starter in bold, then backups). ${build ? 'Rebuilt from the nflverse roster of that season (ordered by snap%): accurate for past seasons too.' : 'Official order and injuries from ESPN, jersey numbers from nflverse: current snapshot, not historical.'}</p>
    </section>`;
}

/** Rosa completa (tutti i giocatori con statistiche) da nflverse (teamRoster).
 *  Nel tab dedicato Roster la tabella è aperta di default. */
function rosterBlock(teamRoster) {
    if (!teamRoster?.players?.length) return '';
    const table = rosterTableDetails(teamRoster, `All players (${teamRoster.players.length}) with stats`)
        .replace('<details ', '<details open ');
    return `
    <section class="pm-block pp-block">
        <span class="mc-kicker">Full roster</span>
        ${table}
    </section>`;
}

/** Calendario ESPN della stagione con risultati e punteggi.
 *  NON più renderizzato (duplicava "Schedule and matchups", sorgente primaria
 *  nflverse). Conservato per l'eventuale fallback: popolare il calendario
 *  primario da ESPN quando la sorgente nflverse non ha dati per la stagione. */
function scheduleBlock({ schedule }) {
    if (!schedule?.length) return '';
    const rows = schedule.map(g => {
        const at = g.homeAway === 'away' ? '@' : 'vs';
        const opp = g.opp ? `${at} ${esc(g.opp)}` : esc(g.oppName || '—');
        let result = '—';
        if (g.completed && g.score != null && g.oppScore != null) {
            const wl = g.winner === true ? 'W' : g.winner === false ? 'L' : '';
            const cls = g.winner === true ? ' style="color:var(--accent-green)"' : g.winner === false ? ' style="color:var(--accent-red)"' : '';
            result = `<b${cls}>${wl} ${esc(String(g.score))}-${esc(String(g.oppScore))}</b>`;
        } else if (g.date) {
            result = `<span class="pm-note">${new Date(g.date).toLocaleDateString('it-IT', { day: 'numeric', month: 'short' })}</span>`;
        }
        return `<tr><td>${esc(g.week || '—')}</td><td>${opp}</td><td>${result}</td></tr>`;
    }).join('');
    return `
    <section class="pm-block pp-block">
        <span class="mc-kicker">Schedule · ESPN</span>
        <div class="pm-table-wrap pp-scroll">
            <table class="pm-table pp-table">
                <thead><tr><th>Settimana</th><th>Avversario</th><th>Esito</th></tr></thead>
                <tbody>${rows}</tbody>
            </table>
        </div>
    </section>`;
}

/** Leader statistici di squadra (stagione): un giocatore per categoria chiave. */
function teamLeadersBlock({ leaders }) {
    if (!leaders?.length) return '';
    const tiles = leaders.map(l => `
        <div class="pm-tile pp-tile">
            <span class="pm-tile-value">${esc(String(l.value ?? '—'))}</span>
            <span class="pm-tile-label">${esc(l.label)} · ${esc(l.name)}</span>
        </div>`).join('');
    return `
    <section class="pm-block pp-block">
        <span class="mc-kicker">Team leaders · ESPN</span>
        <div class="pm-tiles pp-tiles">${tiles}</div>
        <p class="pm-note">Team leader by category for the season (regular season).</p>
    </section>`;
}

/** Feed notizie della squadra (now.core.api). Nascosto se vuoto. */
function newsBlock({ news }) {
    if (!news?.length) return '';
    return `
    <section class="pm-block pp-block">
        <span class="mc-kicker">Latest news · ESPN</span>
        <ul class="pp-news-list">${news.slice(0, 8).map(n => `
            <li>${n.link ? `<a href="${esc(n.link)}" target="_blank" rel="noopener">${esc(n.headline)}</a>` : esc(n.headline)}${n.published ? ` <span class="pm-note">· ${new Date(n.published).toLocaleDateString('it-IT')}</span>` : ''}</li>`).join('')}</ul>
    </section>`;
}

/** Dettaglio partita (game summary): punteggio, confronto squadre, segnature, info gara, win prob. */
/** Header stile ESPN: logo · nome+record · punteggio ai lati, linescore al centro. */
function gameHeaderHtml(s) {
    const away = s.competitors.find(c => !c.home), home = s.competitors.find(c => c.home);
    if (!away || !home) return '';
    const nQ = Math.max(away.line?.length || 0, home.line?.length || 0);
    const cols = [];
    for (let i = 0; i < nQ; i++) cols.push(i < 4 ? String(i + 1) : (nQ - 4 > 1 ? 'OT' + (i - 3) : 'OT'));
    const teamSide = (t, side) => `
        <div class="pp-gh-team pp-gh-${side}${t.winner ? ' pp-gh-win' : ''}">
            <img class="pp-gh-logo" src="${teamLogo(t.abbr)}" alt="" onerror="this.style.display='none'">
            <div class="pp-gh-meta">
                <b class="pp-gh-name">${esc(t.name || t.abbr)}</b>
                ${t.record ? `<span class="pp-gh-rec">${esc(t.record)}</span>` : ''}
            </div>
            <div class="pp-gh-score">${esc(String(t.score ?? ''))}</div>
        </div>`;
    const lineRow = (t) => `<tr>
        <td class="pp-gh-lt">${esc(t.abbr)}</td>
        ${cols.map((_, i) => `<td>${esc(String(t.line?.[i] ?? ''))}</td>`).join('')}
        <td class="pp-gh-lt-tot">${esc(String(t.score ?? ''))}</td>
    </tr>`;
    const lineTable = nQ ? `
        <table class="pp-gh-line">
            <thead><tr><th></th>${cols.map(c => `<th>${esc(c)}</th>`).join('')}<th>T</th></tr></thead>
            <tbody>${lineRow(away)}${lineRow(home)}</tbody>
        </table>` : '';
    // Info gara (stadio · spettatori · arbitri) sotto il punteggio finale.
    const gi = s.gameInfo || {};
    const info = [
        gi.venue ? `${esc(gi.venue)}${gi.city ? `, ${esc(gi.city)}` : ''}` : '',
        gi.attendance ? `${(+gi.attendance).toLocaleString('en-US')} attendance` : '',
        gi.officials?.length ? `${gi.officials.length} arbitri` : '',
    ].filter(Boolean).join(' · ');
    return `<div class="pp-gh">
        ${teamSide(away, 'away')}
        <div class="pp-gh-center">${lineTable}${s.status ? `<span class="pp-gh-status">${esc(s.status)}</span>` : ''}</div>
        ${teamSide(home, 'home')}
    </div>${info ? `<p class="pp-gh-info">${info}</p>` : ''}`;
}

/** Etichetta quarto in stile broadcast (1°/2°/3°/4°/OT). */
function ordQ(n) {
    if (n == null) return '—';
    return n <= 4 ? `${n}°` : (n === 5 ? 'OT' : `${n - 4}OT`);
}

/**
 * Grafico win probability = timeline UNIFICATA della partita e scrubber unico.
 * - Linea BICOLORE: il colore è quello della squadra favorita in quel punto
 *   (spezzata al 50%), area tenue sopra=casa / sotto=ospiti.
 * - Tacche dei quarti + label Q, marker delle segnature, tacche d'inizio drive.
 * - Ogni campione porta di/pi (drive/play) per guidare scorebug, campo e tabella
 *   durante lo scrubbing (idratato in bindGameCenter).
 */
function winProbHtml(s) {
    const wp = s.winprob;
    if (!wp || wp.length < 3) return '';
    const away = s.competitors.find(c => !c.home), home = s.competitors.find(c => c.home);
    const homeAbbr = home?.abbr || '', awayAbbr = away?.abbr || '';
    const homeCol = getTeamIdentity(homeAbbr)?.color || '#2563eb';
    const awayCol = getTeamIdentity(awayAbbr)?.color || '#dc2626';
    const W = 660, H = 132, padL = 2, padR = 2, padT = 10, padB = 10, n = wp.length;
    const X = i => padL + (i / (n - 1)) * (W - padL - padR);
    const Y = p => padT + (1 - p) * (H - padT - padB);
    const mid = Y(0.5);

    // Linea bicolore: segmenti spezzati esattamente all'attraversamento del 50%.
    const homeSeg = [], awaySeg = [];
    for (let i = 0; i < n - 1; i++) {
        const a = wp[i].homePct, b = wp[i + 1].homePct;
        const x0 = X(i), y0 = Y(a), x1 = X(i + 1), y1 = Y(b);
        if ((a >= 0.5) === (b >= 0.5)) {
            (a >= 0.5 ? homeSeg : awaySeg).push(`M${x0.toFixed(1)},${y0.toFixed(1)}L${x1.toFixed(1)},${y1.toFixed(1)}`);
        } else {
            const t = (0.5 - a) / (b - a), xc = x0 + (x1 - x0) * t;
            (a >= 0.5 ? homeSeg : awaySeg).push(`M${x0.toFixed(1)},${y0.toFixed(1)}L${xc.toFixed(1)},${mid.toFixed(1)}`);
            (b >= 0.5 ? homeSeg : awaySeg).push(`M${xc.toFixed(1)},${mid.toFixed(1)}L${x1.toFixed(1)},${y1.toFixed(1)}`);
        }
    }
    // Area tenue verso la midline, sdoppiata via clip (sopra=casa, sotto=ospiti).
    const areaPath = `M${X(0).toFixed(1)},${mid.toFixed(1)} ${wp.map((w, i) => `L${X(i).toFixed(1)},${Y(w.homePct).toFixed(1)}`).join(' ')} L${X(n - 1).toFixed(1)},${mid.toFixed(1)}Z`;

    // Quarti: primo indice di ogni quarto → divisori + label (overlay HTML).
    const qFirst = {};
    wp.forEach((w, i) => { if (w.q != null && qFirst[w.q] == null) qFirst[w.q] = i; });
    const qs = Object.keys(qFirst).map(Number).sort((x, y) => x - y);
    let dividers = '', qLabels = '';
    qs.forEach((qn, k) => {
        const i0 = qFirst[qn];
        if (k > 0) { const x = X(i0); dividers += `<line x1="${x.toFixed(1)}" y1="${padT}" x2="${x.toFixed(1)}" y2="${(H - padB).toFixed(1)}" class="pp-wp-qdiv"/>`; }
        const i1 = k < qs.length - 1 ? qFirst[qs[k + 1]] : n - 1;
        const lab = qn <= 4 ? `Q${qn}` : 'OT';
        qLabels += `<span class="pp-wp-qlab" style="left:${((i0 + i1) / 2 / (n - 1) * 100).toFixed(2)}%">${lab}</span>`;
    });
    // Tacche d'inizio drive (in alto, tenui).
    let dTicks = '';
    for (let i = 1; i < n; i++) if (wp[i].di != null && wp[i].di !== wp[i - 1].di) { const x = X(i); dTicks += `<line x1="${x.toFixed(1)}" y1="${padT}" x2="${x.toFixed(1)}" y2="${(padT + 5).toFixed(1)}" class="pp-wp-dtick"/>`; }
    // Segnature: marker HTML (cerchietti oro) sulla linea.
    let sMarks = '';
    wp.forEach((w, i) => { if (w.scoring) sMarks += `<span class="pp-wp-score" style="left:${(i / (n - 1) * 100).toFixed(2)}%;top:${(Y(w.homePct) / H * 100).toFixed(2)}%"></span>`; });

    const wpData = wp.map(w => ({ p: w.homePct, q: w.q, c: w.clock, dd: w.dd, a: w.away, h: w.home, s: w.scoring ? 1 : 0, di: w.di, pi: w.pi }));
    const dataJson = JSON.stringify(wpData).replace(/</g, '\\u003c');
    // Solo il blocco grafico (senza sezione): è incorporato nel Game Center,
    // tra la striscia dei drive (sopra) e la tabella (sotto).
    return `
        <div class="pp-wp" data-home="${esc(homeAbbr)}" data-homecol="${esc(homeCol)}" data-awaycol="${esc(awayCol)}">
            <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" class="pp-wp-svg">
                <defs>
                    <clipPath id="wp-up"><rect x="0" y="0" width="${W}" height="${mid.toFixed(1)}"/></clipPath>
                    <clipPath id="wp-dn"><rect x="0" y="${mid.toFixed(1)}" width="${W}" height="${(H - mid).toFixed(1)}"/></clipPath>
                </defs>
                <path d="${areaPath}" class="pp-wp-area" style="fill:${homeCol}" clip-path="url(#wp-up)"/>
                <path d="${areaPath}" class="pp-wp-area" style="fill:${awayCol}" clip-path="url(#wp-dn)"/>
                <line x1="${padL}" y1="${mid.toFixed(1)}" x2="${W - padR}" y2="${mid.toFixed(1)}" class="pp-wp-mid"/>
                ${dividers}${dTicks}
                <path d="${homeSeg.join('')}" class="pp-wp-line" style="stroke:${homeCol}"/>
                <path d="${awaySeg.join('')}" class="pp-wp-line" style="stroke:${awayCol}"/>
                <line class="pp-wp-cursor" x1="0" y1="${padT}" x2="0" y2="${(H - padB).toFixed(1)}" style="display:none"/>
                <circle class="pp-wp-dot" r="3.6" style="display:none"/>
            </svg>
            <div class="pp-wp-overlay">${qLabels}${sMarks}</div>
            <script type="application/json" class="pp-wp-data">${dataJson}</script>
        </div>`;
}

/** Striscia dei drive allineata alle x del grafico win probability: un marker
 *  (pastiglia con sigla dell'esito) per ogni drive che compare nella win
 *  probability, centrato sul suo intervallo di campioni. Cliccabile per
 *  selezionare l'intero drive. */
function driveStripHtml(s) {
    const wp = s.winprob;
    if (!wp || wp.length < 3) return '';
    const n = wp.length, range = {};
    wp.forEach((w, i) => {
        if (w.di == null) return;
        if (!range[w.di]) range[w.di] = [i, i];
        else { range[w.di][1] = i; if (i < range[w.di][0]) range[w.di][0] = i; }
    });
    const marks = Object.keys(range).map(Number).sort((a, b) => a - b).map(di => {
        const [i0, i1] = range[di];
        const cx = (i0 + i1) / 2 / (n - 1) * 100;
        const d = s.drives?.[di];
        const tag = driveResultTag(d?.result);
        return `<button type="button" class="pp-ds-ev pp-fdseg-${tag.c}" data-drive="${di}" style="left:${cx.toFixed(2)}%" title="${esc(d?.team || '')} · ${esc(d?.desc || '')} · ${esc(d?.result || '')}">${esc(tag.l)}</button>`;
    }).join('');
    return `<div class="pp-ds">${marks}</div>`;
}

/** Scorebug stile broadcast NFL: loghi/sigle, punteggio, quarto+orologio, D&D e
 *  win% per squadra. Scheletro statico; i valori li aggiorna lo scrubbing. */
function scorebugHtml(s) {
    if (!s.winprob || s.winprob.length < 3) return '';
    const away = s.competitors.find(c => !c.home), home = s.competitors.find(c => c.home);
    const team = (t, side) => {
        const logo = `<img class="pp-sb-logo" src="${teamLogo(t?.abbr)}" alt="" onerror="this.style.display='none'">`;
        const meta = `<div class="pp-sb-meta"><span class="pp-sb-abbr">${esc(t?.abbr || '')}</span><span class="pp-sb-wp" data-wp>—</span></div>`;
        const score = `<b class="pp-sb-score" data-score>—</b>`;
        const poss = `<span class="pp-sb-poss" aria-hidden="true"></span>`;
        return `<div class="pp-sb-team pp-sb-${side}" data-abbr="${esc(t?.abbr || '')}">${side === 'away' ? logo + meta + score + poss : poss + score + meta + logo}</div>`;
    };
    return `
    <div class="pp-sb" data-scorebug>
        ${team(away, 'away')}
        <div class="pp-sb-center">
            <div class="pp-sb-time"><span class="pp-sb-q" data-q>—</span><span class="pp-sb-clock" data-clock>—</span></div>
            <div class="pp-sb-dd" data-dd>—</div>
        </div>
        ${team(home, 'home')}
    </div>`;
}

/** Frecce delle azioni di un drive sul campo (data-pi = indice giocata nel drive). */
function buildFieldArrows(d) {
    const W = FLD3.W, hw = 1.35;
    const arr = d.plays.map((p, idx) => ({ p, idx })).filter(x => x.p.k && x.p.s != null);
    return arr.map((x, k) => {
        const p = x.p;
        const startFx = d.hm ? p.s : 100 - p.s;
        const endFx = Math.max(-8, Math.min(108, d.hm ? p.s - (p.g || 0) : (100 - p.s) + (p.g || 0)));
        const fz = W * (0.30 + 0.40 * (k + 0.5) / arr.length);
        const cat = p.sc ? 'sc' : p.to ? 'to' : (p.g > 0 ? 'gain' : (p.g < 0 ? 'loss' : 'none'));
        const dir = endFx >= startFx ? 1 : -1;
        const peak = p.pa ? Math.max(3, Math.min(14, Math.abs(endFx - startFx) * 0.35)) : 0;
        const N = p.pa ? 16 : 2;
        const top = [], bot = [];
        for (let j = 0; j <= N; j++) {
            const t = j / N, fx = startFx + (endFx - startFx) * t, y = peak * 4 * t * (1 - t);
            top.push(fdProjH(fx, fz + hw, y)); bot.push(fdProjH(fx, fz - hw, y));
        }
        const bT = fdProjH(endFx, fz + hw * 2.1, 0), tip = fdProjH(endFx + dir * 3.8, fz, 0), bB = fdProjH(endFx, fz - hw * 2.1, 0);
        const poly = [...top, bT, tip, bB, ...bot.reverse()].map(pt => `${pt[0].toFixed(1)},${pt[1].toFixed(1)}`).join(' ');
        const [sx, sy] = fdProj(startFx, fz);
        return `<polygon points="${poly}" class="pp-fd-rib pp-fd-${cat}" data-pi="${x.idx}"/>`
            + `<circle cx="${sx.toFixed(1)}" cy="${sy.toFixed(1)}" r="2.4" class="pp-fd-dot pp-fd-${cat}" data-pi="${x.idx}"/>`;
    }).join('');
}

/** Lista giocate di un drive (stile play-by-play, data-pi per l'evidenziazione). */
function buildFieldPlays(d) {
    return `<div class="pp-pbp">${d.plays.map((p, idx) => {
        const cls = p.sc ? ' pp-pbp-score' : p.to ? ' pp-pbp-to' : '';
        return `<div class="pp-pbp-play${cls}" data-pi="${idx}"><span class="pp-pbp-dd">${esc(p.dd || '')}</span><span class="pp-pbp-text">${esc(p.t || '')}</span>${p.sc ? `<span class="pp-gs-sc">${p.a ?? ''}-${p.h ?? ''}</span>` : ''}</div>`;
    }).join('')}</div>`;
}

/** Riga informativa del drive (logo squadra + descrizione + esito). */
function buildFieldInfo(d) {
    return `<img class="pp-fd-clogo" src="${teamLogo(d.team)}" onerror="this.style.display='none'"> <b>${esc(d.team || '')}</b>${d.desc ? ` · ${esc(d.desc)}` : ''}${d.result ? ` <span class="pp-fd-ires">${esc(d.result)}</span>` : ''}`;
}

/** Game leaders (stile ESPN, tab dedicato): intestazione con le due squadre e,
 *  per ogni categoria (lancio/corsa/ricezione/sack/tackle), foto+ruolo, numero
 *  grande e linea di dettaglio; away a sinistra, categoria al centro, home a destra. */
function gameLeadersHtml(s) {
    if (!s.leaders?.length) return '';
    const away = s.leaders.find(t => !t.home), home = s.leaders.find(t => t.home);
    const aC = s.competitors.find(c => !c.home), hC = s.competitors.find(c => c.home);
    const CATS = ['passingYards', 'rushingYards', 'receivingYards', 'sacks', 'totalTackles'];
    const LBL = {
        passingYards: ['Passing', 'Yards'],
        rushingYards: ['Rushing', 'Yards'],
        receivingYards: ['Receiving', 'Yards'],
        sacks: ['Sacks', ''],
        totalTackles: ['Tackles', ''],
    };
    const map = (t) => Object.fromEntries((t?.cats || []).map(c => [c.key, c]));
    const a = map(away), h = map(home);
    const side = (c, isHome) => {
        if (!c) return `<div class="pp-gl2-side pp-gl2-empty">—</div>`;
        const ph = c.headshot
            ? `<img class="pp-gl2-ph" src="${esc(c.headshot)}" alt="" loading="lazy" onerror="this.classList.add('is-off');this.removeAttribute('src')">`
            : `<span class="pp-gl2-ph is-off"></span>`;
        return `<div class="pp-gl2-side pp-gl2-${isHome ? 'h' : 'a'}">
            <div class="pp-gl2-top">${ph}<b class="pp-gl2-val">${esc(c.value)}</b></div>
            <div class="pp-gl2-name">${esc(c.athlete)}${c.pos ? ` <span class="pp-gl2-pos">${esc(c.pos)}</span>` : ''}</div>
            ${c.detail ? `<div class="pp-gl2-detail">${esc(c.detail)}</div>` : ''}
        </div>`;
    };
    const rows = CATS.filter(k => a[k] || h[k]).map(k => {
        const [l1, l2] = LBL[k];
        return `<div class="pp-gl2-row">
            ${side(a[k], false)}
            <div class="pp-gl2-cat">${esc(l1)}${l2 ? `<br>${esc(l2)}` : ''}</div>
            ${side(h[k], true)}
        </div>`;
    }).join('');
    if (!rows) return '';
    const teamHead = (abbr, isHome) => {
        if (!abbr) return `<div class="pp-gl2-team"></div>`;
        const lg = `<img class="pp-gl2-hlogo" src="${teamLogo(abbr)}" alt="" onerror="this.style.display='none'">`;
        const ab = `<span class="pp-gl2-habbr">${esc(abbr)}</span>`;
        return `<div class="pp-gl2-team pp-gl2-team-${isHome ? 'h' : 'a'}">${isHome ? ab + lg : lg + ab}</div>`;
    };
    const aAbbr = aC?.abbr || away?.abbr || '', hAbbr = hC?.abbr || home?.abbr || '';
    return `
    <section class="pm-block pp-block">
        <span class="mc-kicker">Game leaders</span>
        <div class="pp-gl2-head">
            ${teamHead(aAbbr, false)}
            <div class="pp-gl2-cat"></div>
            ${teamHead(hAbbr, true)}
        </div>
        <div class="pp-gl2">${rows}</div>
    </section>`;
}

/** Play-by-play UNIFICATO: drive + giocate, segnature evidenziate, filtro Tutte/Solo segnature. */
function playByPlayHtml(s) {
    if (!s.drives?.length) return '';
    const playRow = (p) => {
        const cls = p.scoring ? ' pp-pbp-score' : p.turnover ? ' pp-pbp-to' : p.penalty ? ' pp-pbp-pen' : '';
        return `<div class="pp-pbp-play${cls}"${p.scoring ? ' data-score="1"' : ''}>
            <span class="pp-pbp-dd">${esc(p.dd || (p.q ? `Q${p.q}` : ''))}</span>
            <span class="pp-pbp-text">${esc(p.text || '')}</span>
            ${p.scoring ? `<span class="pp-gs-sc">${p.away ?? ''}-${p.home ?? ''}</span>` : ''}
        </div>`;
    };
    const driveGroup = (dr) => {
        const hasScore = (dr.plays || []).some(p => p.scoring);
        return `<div class="pp-pbp-drive${hasScore ? ' pp-has-score' : ''}">
            <div class="pp-pbp-dhead">
                <span class="pp-lb-pos">${esc(dr.team || '')}</span>
                <span class="pp-pbp-ddesc">${esc(dr.desc || '')}${dr.start && dr.end ? ` · ${esc(dr.start)}→${esc(dr.end)}` : ''}</span>
                <span class="pp-gs-sc">${esc(dr.result || '')}</span>
            </div>
            ${dr.plays?.length ? `<div class="pp-pbp-plays">${dr.plays.map(playRow).join('')}</div>` : ''}
        </div>`;
    };
    const totalPlays = s.drives.reduce((n, d) => n + (d.plays?.length || 0), 0);
    return `
    <section class="pm-block pp-block">
        <span class="mc-kicker">Scoring & play-by-play · ${s.drives.length} drive · ${totalPlays} giocate</span>
        <div class="pp-pbp-toolbar">
            <button type="button" class="pp-pbp-filter is-active" data-pbpf="all">All plays</button>
            <button type="button" class="pp-pbp-filter" data-pbpf="scoring">Scoring only</button>
        </div>
        <div class="pp-pbp pp-pbp-scroll">${s.drives.map(driveGroup).join('')}</div>
    </section>`;
}

/** Box score giocatori stile ESPN: per squadra e categoria, tabella con le stat. */
function boxScoreHtml(s) {
    if (!s.boxPlayers?.length) return '';
    const teamBlock = (t) => {
        const name = s.competitors.find(c => c.abbr === t.abbr)?.name || t.abbr;
        const groups = t.groups.map(g => {
            const head = ['Player', ...g.labels].map(l => `<th>${esc(l)}</th>`).join('');
            const rows = g.athletes.map(a => `<tr>
                <td class="pp-bs-name">${esc(a.name)}${a.jersey ? ` <span class="pp-bs-num">#${esc(a.jersey)}</span>` : ''}${a.pos ? ` <span class="pp-bs-pos">${esc(a.pos)}</span>` : ''}</td>
                ${a.stats.map(v => `<td>${esc(String(v ?? ''))}</td>`).join('')}
            </tr>`).join('');
            const totals = g.totals?.length ? `<tr class="pp-bs-tot"><td>Total</td>${g.totals.map(v => `<td>${esc(String(v ?? ''))}</td>`).join('')}</tr>` : '';
            return `<div class="pp-bs-group">
                <h4 class="pp-bs-gtitle">${esc(g.label)}</h4>
                <div class="pm-table-wrap pp-scroll"><table class="pm-table pp-table pp-bs-table"><thead><tr>${head}</tr></thead><tbody>${rows}${totals}</tbody></table></div>
            </div>`;
        }).join('');
        return `<div class="pp-bs-team"><h3 class="pp-cat-title pp-bs-teamtitle"><img class="pp-bs-teamlogo" src="${teamLogo(t.abbr)}" alt="" onerror="this.style.display='none'">${esc(name)}</h3>${groups}</div>`;
    };
    const away = s.boxPlayers.find(t => !t.home), home = s.boxPlayers.find(t => t.home);
    return `<div class="pp-bs">${[away, home].filter(Boolean).map(teamBlock).join('')}</div>`;
}

/** Valore numerico per la barra proporzionale: primo numero della stringa, con
 *  gestione del tempo di possesso (mm:ss → secondi). "4-25", "4/16", "1/4" → 4. */
function parseStatNum(v) {
    const str = String(v ?? '').trim();
    const t = /^(\d+):(\d{2})$/.exec(str);
    if (t) return +t[1] * 60 + +t[2];
    const m = /-?\d+(?:\.\d+)?/.exec(str);
    return m ? parseFloat(m[0]) : 0;
}

/** Team Stats stile ESPN: header loghi + legenda (ospite tratteggiata / casa
 *  piena col suo colore) e, per ogni voce, valori away|etichetta|home con barra
 *  proporzionale sotto. Sotto restano chip proiezioni/quote e dettaglio squadra. */
function teamStatsPanelHtml(s, boxCats) {
    const away = s.competitors.find(c => !c.home), home = s.competitors.find(c => c.home);
    const awayStats = s.teamStats.find(t => !t.home), homeStats = s.teamStats.find(t => t.home);
    let cmp = '';
    if (awayStats && homeStats) {
        const awayAbbr = awayStats.abbr, homeAbbr = homeStats.abbr;
        const homeCol = getTeamIdentity(homeAbbr)?.color || '#334155';
        const homeByLabel = Object.fromEntries(homeStats.stats.map(x => [x.label, x.value]));
        const legend = `
            <div class="pp-ts-head">
                <div class="pp-ts-lg pp-ts-lg-a">
                    <img class="pp-ts-lglogo" src="${teamLogo(awayAbbr)}" alt="" onerror="this.style.display='none'">
                    <span class="pp-ts-sw pp-ts-sw-hatch"></span>
                    <span class="pp-ts-lgab">${esc(awayAbbr)}</span>
                </div>
                <div class="pp-ts-lg pp-ts-lg-h">
                    <span class="pp-ts-lgab">${esc(homeAbbr)}</span>
                    <span class="pp-ts-sw pp-ts-sw-solid" style="background:${homeCol}"></span>
                    <img class="pp-ts-lglogo" src="${teamLogo(homeAbbr)}" alt="" onerror="this.style.display='none'">
                </div>
            </div>`;
        const rows = awayStats.stats.map(a => {
            const hv = homeByLabel[a.label];
            const an = parseStatNum(a.value), hn = parseStatNum(hv);
            const tot = an + hn;
            const ap = tot > 0 ? (an / tot) * 100 : 50;
            return `
            <div class="pp-ts-row">
                <div class="pp-ts-vals">
                    <b class="pp-ts-a">${esc(a.value)}</b>
                    <span class="pp-ts-lbl">${esc(a.label)}</span>
                    <b class="pp-ts-h">${esc(hv ?? '—')}</b>
                </div>
                <div class="pp-ts-bar">
                    <span class="pp-ts-bar-a" style="width:${ap.toFixed(1)}%"></span>
                    <span class="pp-ts-bar-h" style="width:${(100 - ap).toFixed(1)}%;background:${homeCol}"></span>
                </div>
            </div>`;
        }).join('');
        cmp = `<div class="pp-ts">${legend}${rows}</div>`;
    }
    // Quote/proiezioni ESPN.
    let chipsHtml = '';
    const chips = [];
    if (s.prediction?.homePct != null && away && home) {
        chips.push(factChip(`${Math.round(s.prediction.awayPct)}%`, `proiez. ${away.abbr}`));
        chips.push(factChip(`${Math.round(s.prediction.homePct)}%`, `proiez. ${home.abbr}`));
    }
    if (s.odds?.details) chips.push(factChip(esc(s.odds.details), s.odds.provider ? esc(s.odds.provider) : 'line'));
    if (s.odds?.overUnder != null) chips.push(factChip(`O/U ${esc(String(s.odds.overUnder))}`, ''));
    const c = chips.filter(Boolean).join('');
    if (c) chipsHtml = `<div class="pp-fact-chips" style="margin:2px 0 16px">${c}</div>`;

    return `${chipsHtml}${cmp}${detailedBoxHtml(boxCats)}`;
}

/** Statistiche dettagliate per-gara della squadra della pagina (per categoria). */
function detailedBoxHtml(cats) {
    if (!cats?.length) return '';
    const nVoci = cats.reduce((n, c) => n + c.stats.length, 0);
    return `
    <details class="pp-recap-ids" style="margin-top:12px">
        <summary>Detailed team game stats (${nVoci} items)</summary>
        <div style="margin-top:8px">${cats.map(c => `
            <div class="pp-statcat">
                <h3 class="pp-cat-title">${esc(c.label)}</h3>
                <div class="pm-table-wrap pp-scroll">
                    <table class="pm-table pp-table"><tbody>${c.stats.map(st => `<tr><td>${esc(st.label)}</td><td class="pm-td-strong">${esc(st.value)}</td></tr>`).join('')}</tbody></table>
                </div>
            </div>`).join('')}</div>
    </details>`;
}

/** Elenco delle segnature (scoring plays) della gara, con tutte le info ESPN:
 *  quarto/orologio, squadra (logo+sigla), tipo (TD/FG/…), descrizione e
 *  punteggio progressivo con le sigle delle due squadre. */
function signaturesHtml(s) {
    if (!s.scoring?.length) return '<p class="pm-note">No scoring plays in this game.</p>';
    const away = s.competitors.find(c => !c.home), home = s.competitors.find(c => c.home);
    return `<div class="pp-sig">${s.scoring.map(p => `
        <div class="pp-sig-row">
            <span class="pp-sig-when">Q${p.q ?? ''}<small>${esc(p.clock || '')}</small></span>
            <img class="pp-sig-logo" src="${teamLogo(p.team)}" alt="" onerror="this.style.display='none'">
            <div class="pp-sig-main">
                <div class="pp-sig-head"><b class="pp-sig-team">${esc(p.team || '')}</b>${p.type ? `<span class="pp-sig-type">${esc(p.type)}</span>` : ''}${p.pos ? `<span class="pp-sig-pos">${esc(p.pos)}</span>` : ''}</div>
                <div class="pp-sig-text">${esc(p.text || '')}</div>
            </div>
            <span class="pp-sig-score">${away ? esc(away.abbr) + ' ' : ''}<b>${p.away ?? ''}</b>–<b>${p.home ?? ''}</b>${home ? ' ' + esc(home.abbr) : ''}</span>
        </div>`).join('')}</div>`;
}

// ── Campo NFL in prospettiva broadcast: omografia campo(yard)→schermo ──────
// Il campo (yard −10..110 in lunghezza, 0..W in larghezza) è mappato su un
// trapezoide (near = basso e largo, far = alto e stretto) via omografia a 4
// punti. fdProj proietta un punto a terra; fdProjH aggiunge l'altezza (Y) con
// foreshortening per far "salire" la parabola dei passaggi.
function _solve8(A, b) {
    const n = 8, M = A.map((r, i) => [...r, b[i]]);
    for (let c = 0; c < n; c++) {
        let piv = c;
        for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
        [M[c], M[piv]] = [M[piv], M[c]];
        const dv = M[c][c] || 1e-9;
        for (let j = c; j <= n; j++) M[c][j] /= dv;
        for (let r = 0; r < n; r++) { if (r === c) continue; const f = M[r][c]; for (let j = c; j <= n; j++) M[r][j] -= f * M[c][j]; }
    }
    return M.map(r => r[n]);
}
const FLD3 = (() => {
    const fxMin = -15, fxMax = 115, W = 53.3;                       // end zone lunghe (15 yd)
    const src = [[fxMin, 0], [fxMax, 0], [fxMax, W], [fxMin, W]];
    const dst = [[64, 224], [936, 224], [744, 76], [256, 76]];     // meno prospettiva + campo in alto (poco vuoto sopra)
    const A = [], b = [];
    for (let i = 0; i < 4; i++) {
        const [u, v] = src[i], [X, Y] = dst[i];
        A.push([u, v, 1, 0, 0, 0, -u * X, -v * X]); b.push(X);
        A.push([0, 0, 0, u, v, 1, -u * Y, -v * Y]); b.push(Y);
    }
    return { fxMin, fxMax, W, h: _solve8(A, b), farScale: 0.74, HK: 4.2, vbW: 1000, vbH: 262 };
})();
function fdProj(fx, fz) {
    const [a, c, d, e, f, g, p, q] = FLD3.h;
    const w = p * fx + q * fz + 1;
    return [(a * fx + c * fz + d) / w, (e * fx + f * fz + g) / w];
}
function fdScale(fz) { return 1 - (fz / FLD3.W) * (1 - FLD3.farScale); }
function fdProjH(fx, fz, y) { const [x, sy] = fdProj(fx, fz); return [x, sy - (y || 0) * FLD3.HK * fdScale(fz)]; }
// Matrice affine locale (1 unità = 1 yard) per "posare" elementi sul piano del
// campo: local-x lungo la lunghezza, local-y (giù del testo) verso il basso.
function fdMatrix(fx, fz) {
    const [ox, oy] = fdProj(fx, fz);
    const [ux, uy] = fdProj(fx + 1, fz);
    const [vx, vy] = fdProj(fx, fz + 1);
    return `matrix(${(ux - ox).toFixed(4)},${(uy - oy).toFixed(4)},${(ox - vx).toFixed(4)},${(oy - vy).toFixed(4)},${ox.toFixed(2)},${oy.toFixed(2)})`;
}
// Matrice per i NUMERI: reading lungo la lunghezza, con la parte alta rivolta
// verso il CENTRO del campo (su entrambi i lati) → come su un campo vero.
function fdMatrixNum(fx, fz) {
    const [ox, oy] = fdProj(fx, fz);
    const [ux, uy] = fdProj(fx + 1, fz);
    const away = fz < FLD3.W / 2 ? -1 : 1;    // "giù" del testo = lontano dal centro
    const [vx, vy] = fdProj(fx, fz + away);
    return `matrix(${(ux - ox).toFixed(4)},${(uy - oy).toFixed(4)},${(vx - ox).toFixed(4)},${(vy - oy).toFixed(4)},${ox.toFixed(2)},${oy.toFixed(2)})`;
}
// Matrice per i LOGHI delle end zone: posati sul piano, "in piedi" rivolti verso
// il centro del campo (simmetrici, nessuno capovolto). local-x lungo la larghezza,
// "su" (top) verso il centro lungo la lunghezza.
function fdMatrixLogo(fx) {
    const fz = FLD3.W / 2;
    const [ox, oy] = fdProj(fx, fz);
    const [ux, uy] = fdProj(fx, fz + 1);          // local-x lungo la larghezza
    const toC = fx < 50 ? -1 : 1;                 // "giù" = lontano dal centro lungo la lunghezza
    const [vx, vy] = fdProj(fx + toC, fz);
    return `matrix(${(ux - ox).toFixed(4)},${(uy - oy).toFixed(4)},${(vx - ox).toFixed(4)},${(vy - oy).toFixed(4)},${ox.toFixed(2)},${oy.toFixed(2)})`;
}

/** Etichetta breve + categoria colore per l'esito di un drive (timeline). */
function driveResultTag(res) {
    const r = (res || '').toLowerCase();
    if (r.includes('touchdown')) return { l: 'TD', c: 'td' };
    if (r.includes('field goal') && (r.includes('miss') || r.includes('block') || r.includes('no good'))) return { l: 'MFG', c: 'to' };
    if (r.includes('field goal')) return { l: 'FG', c: 'fg' };
    if (r.includes('punt')) return { l: 'PNT', c: 'punt' };
    if (r.includes('downs')) return { l: 'DWN', c: 'to' };
    if (r.includes('interception')) return { l: 'INT', c: 'to' };
    if (r.includes('fumble')) return { l: 'FUM', c: 'to' };
    if (r.includes('safety')) return { l: 'SAF', c: 'td' };
    if (r.includes('half') || r.includes('end of game') || r.includes('end of')) return { l: 'END', c: 'end' };
    return { l: (res || '—').slice(0, 4).toUpperCase(), c: 'end' };
}

/**
 * Blocco "Field · drives & plays" con selettore Play by play / Signature.
 * - Play by play: campo NFL in prospettiva (end zone con logo+colore delle 2
 *   squadre) + timeline; clic su un drive → azioni proiettate sul campo
 *   (passaggi = parabola, corse = piatte) e lista giocate del drive sotto.
 * - Signature: elenco delle segnature della gara.
 * Away a sinistra, home a destra: chi ha il possesso attacca l'end zone
 * avversaria. Dati in <script json>, idratati da bindGameDetail → bindField.
 */
function fieldSceneHtml(s) {
    // Le giocate NON da scrimmage (kickoff/punt/timeout/…) restano nella lista ma
    // non disegnano frecce (il cambio di possesso ribalterebbe la prospettiva).
    const SKIP = /kickoff|punt|timeout|two-minute|end (of )?(period|quarter|game|half)|kneel/i;
    const clockMin = (c) => { const m = /(\d+):(\d+)/.exec(c || ''); return m ? +m[1] + (+m[2]) / 60 : 0; };
    const drives = (s.drives || [])
        .map(d => {
            const raw = d.plays || [];
            const last = raw[raw.length - 1];
            const tEnd = last && last.q != null ? (last.q - 1) * 15 + (15 - clockMin(last.clock)) : null;  // minuto di fine drive
            return {
                team: d.team, result: d.result, desc: d.desc, tEnd,
                hm: d.team === s.homeAbbr ? 1 : 0,
                plays: raw.map(p => {
                    const scrim = p.s2e != null && !SKIP.test(p.type || '');
                    const g = p.gain != null ? p.gain : (p.e2e != null && p.s2e != null ? p.s2e - p.e2e : 0);
                    return { s: p.s2e, g, sc: p.scoring ? 1 : 0, to: p.turnover ? 1 : 0, dd: p.dd || '', t: p.text || '', a: p.away, h: p.home, k: scrim ? 1 : 0, pa: /pass|sack/i.test(p.type || '') ? 1 : 0 };
                }),
            };
        })
        .filter(d => d.plays.length);
    if (!drives.length) return { empty: true, drives, scene: '' };
    const json = JSON.stringify(drives).replace(/</g, '\\u003c');

    const away = s.competitors.find(c => !c.home), home = s.competitors.find(c => c.home);
    const awayAbbr = away?.abbr || '', homeAbbr = home?.abbr || '';
    const awayCol = getTeamIdentity(awayAbbr)?.color || '#334155';
    const homeCol = getTeamIdentity(homeAbbr)?.color || '#334155';

    const { fxMin, fxMax, W } = FLD3;
    const P = (fx, fz) => { const [x, y] = fdProj(fx, fz); return `${x.toFixed(1)},${y.toFixed(1)}`; };
    const poly = (corners, cls, style = '') => `<polygon points="${corners.map(c => P(c[0], c[1])).join(' ')}" class="${cls}"${style ? ` style="${style}"` : ''}/>`;

    let stripes = '';
    for (let sx = 0; sx < 100; sx += 10) stripes += poly([[sx, 0], [sx + 10, 0], [sx + 10, W], [sx, W]], (sx / 10) % 2 ? 'pp-fd3-grass-a' : 'pp-fd3-grass-b');
    const ezL = poly([[fxMin, 0], [0, 0], [0, W], [fxMin, W]], 'pp-fd3-ez', `fill:${awayCol}`);
    const ezR = poly([[100, 0], [fxMax, 0], [fxMax, W], [100, W]], 'pp-fd3-ez', `fill:${homeCol}`);
    let yl = '';
    for (let v = 0; v <= 100; v += 5) { const [x1, y1] = fdProj(v, 0), [x2, y2] = fdProj(v, W); yl += `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" class="pp-fd3-yl${v % 10 === 0 ? ' pp-fd3-yl10' : ''}"/>`; }
    let hash = '';
    for (let v = 1; v < 100; v++) { if (v % 5 === 0) continue; for (const hz of [23.58, W - 23.58]) { const [x1, y1] = fdProj(v - 0.35, hz), [x2, y2] = fdProj(v + 0.35, hz); hash += `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" class="pp-fd3-hash"/>`; } }
    // Numeri "stampati" sul campo: posati sul piano, distanziati (le due cifre
    // staccate) e con la parte alta verso il centro del campo su entrambi i lati.
    let nums = '';
    for (let v = 10; v <= 90; v += 10) {
        const n = String(v <= 50 ? v : 100 - v).split('').join('  ');   // cifre staccate
        for (const fz of [11, W - 11]) nums += `<text transform="${fdMatrixNum(v, fz)}" font-size="4" letter-spacing="0.5" class="pp-fd3-num" text-anchor="middle" dominant-baseline="central">${n}</text>`;
    }
    // Loghi ruotati e posati in prospettiva sull'end zone, RITAGLIATI all'end
    // zone (clip-path) così non escono mai dai suoi bordi.
    const clipL = `<clipPath id="fd-ezl" clipPathUnits="userSpaceOnUse"><polygon points="${[[fxMin, 0], [0, 0], [0, W], [fxMin, W]].map(c => P(c[0], c[1])).join(' ')}"/></clipPath>`;
    const clipR = `<clipPath id="fd-ezr" clipPathUnits="userSpaceOnUse"><polygon points="${[[100, 0], [fxMax, 0], [fxMax, W], [100, W]].map(c => P(c[0], c[1])).join(' ')}"/></clipPath>`;
    const ezLogo = (abbr, cx, clip) => { const sz = 14; return `<g clip-path="url(#${clip})"><g transform="${fdMatrixLogo(cx)} rotate(180)"><image href="${teamLogo(abbr)}" x="${(-sz / 2)}" y="${(-sz / 2)}" width="${sz}" height="${sz}" class="pp-fd3-logo" preserveAspectRatio="xMidYMid meet"/></g></g>`; };
    const logos = ezLogo(awayAbbr, fxMin / 2, 'fd-ezl') + ezLogo(homeAbbr, (100 + fxMax) / 2, 'fd-ezr');

    // Goalpost NFL (giallo) sulla linea di fondo di ogni end zone: palo base +
    // traversa + due montanti, proiettati in altezza (prospettiva coerente).
    const goalpost = (fxEnd) => {
        // Misure reali NFL (in yard): traversa a 10 ft, montanti +35 ft, larghezza 18.5 ft.
        const hc = 3.08, Hc = 3.33, Hu = 11.67;
        const pt = (fz, y) => fdProjH(fxEnd, fz, y);
        const L = (a, b, cls) => `<line x1="${a[0].toFixed(1)}" y1="${a[1].toFixed(1)}" x2="${b[0].toFixed(1)}" y2="${b[1].toFixed(1)}" class="${cls}"/>`;
        const bBot = pt(W / 2, 0), bTop = pt(W / 2, Hc), cl = pt(W / 2 - hc, Hc), cr = pt(W / 2 + hc, Hc), ul = pt(W / 2 - hc, Hc + Hu), ur = pt(W / 2 + hc, Hc + Hu);
        return `<g class="pp-fd-gp">${L(bBot, bTop, 'pp-fd-gp-pole')}${L(cl, cr, 'pp-fd-gp-bar')}${L(cl, ul, 'pp-fd-gp-up')}${L(cr, ur, 'pp-fd-gp-up')}</g>`;
    };
    const goalposts = goalpost(fxMin) + goalpost(fxMax);

    const scene = `
            <div class="pp-fd" data-fd>
                <svg class="pp-fd-svg pp-fd3" viewBox="0 0 ${FLD3.vbW} ${FLD3.vbH}" preserveAspectRatio="xMidYMid meet">
                    <defs>
                        ${['gain', 'loss', 'sc', 'to', 'none'].map(k => `<marker id="fdh-${k}" markerUnits="userSpaceOnUse" markerWidth="20" markerHeight="18" refX="13" refY="9" orient="auto"><path d="M0,1 L16,9 L0,17 Z" class="pp-fd-mk pp-fd-${k}"/></marker>`).join('')}
                        <linearGradient id="fd3depth" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity="0.34"/><stop offset="0.55" stop-color="#000" stop-opacity="0"/></linearGradient>
                        ${clipL}${clipR}
                    </defs>
                    ${ezL}${ezR}${stripes}
                    <polygon points="${P(fxMin, 0)} ${P(fxMax, 0)} ${P(fxMax, W)} ${P(fxMin, W)}" fill="url(#fd3depth)"/>
                    ${hash}${yl}${nums}${logos}${goalposts}
                    <g class="pp-fd-arrows"></g>
                </svg>
                <div class="pp-fd-info"></div>
            </div>
            <script type="application/json" class="pp-fd-data">${json}</script>`;
    return { empty: false, drives, scene };
}

/** Fallback (gare senza win probability): campo + timeline a pastiglie dei drive. */
function fieldHtml(s) {
    const sc = fieldSceneHtml(s);
    if (sc.empty) return signaturesHtml(s) === '' ? '' : `
        <section class="pm-block pp-block"><span class="mc-kicker">Scoring</span>${signaturesHtml(s)}</section>`;
    const drives = sc.drives;
    const tMax = Math.max(60, Math.ceil(Math.max(0, ...drives.map(d => d.tEnd || 0))));
    const qTicks = [15, 30, 45, 60].filter(m => m < tMax + 0.5).map(m => `<span class="pp-fd-tl-tick" style="left:${(m / tMax * 100).toFixed(2)}%"></span>`).join('');
    const qLabels = [1, 2, 3, 4].map(q => `<span class="pp-fd-tl-ql" style="left:${((q * 15 - 7.5) / tMax * 100).toFixed(2)}%">Q${q}</span>`).join('')
        + (tMax > 60 ? `<span class="pp-fd-tl-ql" style="left:${((60 + tMax) / 2 / tMax * 100).toFixed(2)}%">OT</span>` : '');
    const marks = drives.map((d, i) => {
        if (d.tEnd == null) return '';
        const tag = driveResultTag(d.result);
        const pos = Math.max(0, Math.min(100, d.tEnd / tMax * 100));
        return `<button type="button" class="pp-fd-ev pp-fdseg-${tag.c} pp-fd-ev-${i % 2 ? 'down' : 'up'}${i === 0 ? ' is-active' : ''}" data-drive="${i}" style="left:${pos.toFixed(2)}%" title="${esc(d.team || '')} · ${esc(d.desc || '')} · ${esc(d.result || '')}">${esc(tag.l)}</button>`;
    }).join('');
    const timelineBlock = `<div class="pp-fd-timeline"><div class="pp-fd-tl"><div class="pp-fd-tl-axis"></div>${qTicks}${qLabels}${marks}</div></div>`;
    return `
    <section class="pm-block pp-block">
        <span class="mc-kicker">Field · drives & plays</span>
        <div class="pp-fd-modes">
            <button type="button" class="pp-fd-mode is-active" data-fdmode="pbp">Play by play</button>
            <button type="button" class="pp-fd-mode" data-fdmode="sig">Signature</button>
        </div>
        <div class="pp-fd-mp" data-fdp="pbp">
            ${sc.scene}
            ${timelineBlock}
            <div class="pp-fd-plays"></div>
            <p class="pm-note">Click a drive in the timeline: the plays appear on the field (pass = arc, run = flat) and the play list below. Green = gain, red = loss/turnover, gold = scoring.</p>
        </div>
        <div class="pp-fd-mp" data-fdp="sig" hidden>
            ${signaturesHtml(s)}
        </div>
    </section>`;
}

/**
 * Game Center UNIFICATO (gare con win probability). Ordine verticale:
 * selettore Play-by-play/Signature → scorebug → campo → striscia drive →
 * grafico win probability (timeline/scrubber) → tabella giocate.
 */
function gameCenterHtml(s) {
    const sc = fieldSceneHtml(s);
    if (sc.empty) return signaturesHtml(s) === '' ? '' : `
        <section class="pm-block pp-block"><span class="mc-kicker">Scoring</span>${signaturesHtml(s)}</section>`;
    return `
    <section class="pm-block pp-block">
        <span class="mc-kicker">Game Center</span>
        <div class="pp-fd-modes">
            <button type="button" class="pp-fd-mode is-active" data-fdmode="pbp">Play by play</button>
            <button type="button" class="pp-fd-mode" data-fdmode="sig">Signature</button>
        </div>
        <div class="pp-fd-mp" data-fdp="pbp">
            ${scorebugHtml(s)}
            ${sc.scene}
            <div class="pp-gc-wp">
                <span class="mc-kicker pp-gc-wplabel">Win probability · timeline</span>
                ${driveStripHtml(s)}
                ${winProbHtml(s)}
            </div>
            <div class="pp-fd-plays"></div>
            <p class="pm-note">Scrub the chart: the field shows the current play (the others fade), scorebug and table follow. Off the chart you see the whole drive; click a pill to select a drive. Green = gain, red = loss/turnover, gold = scoring.</p>
        </div>
        <div class="pp-fd-mp" data-fdp="sig" hidden>
            ${signaturesHtml(s)}
        </div>
    </section>`;
}

/** Corpo del dettaglio partita: header + menu (Game Center / Box Score / Team Stats). */
function gameBodyHtml(summary, boxCats) {
    if (!summary) return '<p class="pm-note">Detail not available for this game.</p>';
    const unified = (summary.winprob?.length ?? 0) >= 3;
    const gl = gameLeadersHtml(summary);
    const gc = unified ? gameCenterHtml(summary) : fieldHtml(summary);
    const box = boxScoreHtml(summary);
    const team = teamStatsPanelHtml(summary, boxCats);
    const tab = (id, label, on) => `<button type="button" class="pp-gd-tab${on ? ' is-active' : ''}" data-gd="${id}">${label}</button>`;
    return `${gameHeaderHtml(summary)}
        <nav class="pp-gd-tabs" role="tablist">
            ${tab('gc', 'Game Center', true)}${gl ? tab('gl', 'Game Leaders', false) : ''}${box ? tab('box', 'Box Score', false) : ''}${team.trim() ? tab('team', 'Team Stats', false) : ''}
        </nav>
        <div class="pp-gd-panel" data-gdp="gc">${gc || '<p class="pm-note">No Game Center data.</p>'}</div>
        ${gl ? `<div class="pp-gd-panel" data-gdp="gl" hidden>${gl}</div>` : ''}
        ${box ? `<div class="pp-gd-panel" data-gdp="box" hidden>${box}</div>` : ''}
        ${team.trim() ? `<div class="pp-gd-panel" data-gdp="team" hidden>${team}</div>` : ''}`;
}

/** Binding del dettaglio partita: tab, hover sul grafico win probability, filtro play-by-play. */
function bindGameDetail(root) {
    if (!root) return;
    // Tab menu
    const tabs = [...root.querySelectorAll('.pp-gd-tab')];
    const panels = [...root.querySelectorAll('.pp-gd-panel')];
    tabs.forEach(t => t.addEventListener('click', () => {
        tabs.forEach(x => x.classList.toggle('is-active', x === t));
        panels.forEach(p => { p.hidden = p.dataset.gdp !== t.dataset.gd; });
    }));

    // Filtro play-by-play (Tutte / Solo segnature)
    root.querySelectorAll('.pp-pbp-toolbar').forEach(bar => {
        const pbp = bar.parentElement.querySelector('.pp-pbp');
        bar.querySelectorAll('.pp-pbp-filter').forEach(btn => btn.addEventListener('click', () => {
            bar.querySelectorAll('.pp-pbp-filter').forEach(b => b.classList.toggle('is-active', b === btn));
            pbp?.classList.toggle('pp-pbp--scoring', btn.dataset.pbpf === 'scoring');
        }));
    });

    // Selettore Play by play / Signature
    const modeBtns = [...root.querySelectorAll('.pp-fd-mode')];
    const modePanels = [...root.querySelectorAll('.pp-fd-mp')];
    modeBtns.forEach(btn => btn.addEventListener('click', () => {
        modeBtns.forEach(b => b.classList.toggle('is-active', b === btn));
        modePanels.forEach(mp => { mp.hidden = mp.dataset.fdp !== btn.dataset.fdmode; });
    }));

    // Modalità unificata: il grafico win probability è lo scrubber che guida
    // scorebug + campo + tabella. Se non c'è winprob → fallback classico a clic-drive.
    if (bindGameCenter(root)) return;
    bindFieldStandalone(root);
}

/**
 * Modalità unificata (Game Center): scrubbing sul grafico win probability →
 * aggiorna scorebug (tempo/quarto/D&D/punteggio/win%), disegna il drive in corso
 * sul campo evidenziando l'azione del momento (le altre si spengono) ed evidenzia
 * la riga corrispondente nella tabella. Fuori dal grafico mostra l'intero drive
 * selezionato (frecce tutte accese); la striscia di pastiglie sopra il grafico
 * seleziona il drive. Ritorna false se non è una gara unificata.
 */
function bindGameCenter(root) {
    const wpEl = root.querySelector('.pp-wp');
    const sb = root.querySelector('[data-scorebug]');
    const fd = root.querySelector('[data-fd]');
    if (!wpEl || !sb || !fd) return false;
    let wp = [], drives = [];
    try { wp = JSON.parse(wpEl.querySelector('.pp-wp-data')?.textContent || '[]'); } catch { wp = []; }
    try { drives = JSON.parse(root.querySelector('.pp-fd-data')?.textContent || '[]'); } catch { drives = []; }
    const n = wp.length;
    if (!n) return false;
    const homeCol = wpEl.dataset.homecol || '#2563eb', awayCol = wpEl.dataset.awaycol || '#dc2626';
    const svg = wpEl.querySelector('.pp-wp-svg'), vb = svg?.viewBox?.baseVal;
    const cursor = wpEl.querySelector('.pp-wp-cursor'), dot = wpEl.querySelector('.pp-wp-dot');
    const arrows = fd.querySelector('.pp-fd-arrows'), info = fd.querySelector('.pp-fd-info');
    const playsEl = root.querySelector('.pp-fd-plays');
    const qEl = sb.querySelector('[data-q]'), clockEl = sb.querySelector('[data-clock]'), ddEl = sb.querySelector('[data-dd]');
    const awayT = sb.querySelector('.pp-sb-away'), homeT = sb.querySelector('.pp-sb-home');
    const awayScore = awayT?.querySelector('[data-score]'), homeScore = homeT?.querySelector('[data-score]');
    const awayWp = awayT?.querySelector('[data-wp]'), homeWp = homeT?.querySelector('[data-wp]');
    const padT = 10, padB = 10;
    let curDi = -1;

    const renderDrive = (di, pi) => {
        const d = drives[di];
        if (d && di !== curDi) {
            curDi = di;
            if (arrows) arrows.innerHTML = buildFieldArrows(d);
            if (info) info.innerHTML = buildFieldInfo(d);
            if (playsEl) playsEl.innerHTML = buildFieldPlays(d);
        }
        if (arrows) arrows.querySelectorAll('[data-pi]').forEach(el => {
            const on = +el.dataset.pi === pi;
            el.classList.toggle('is-cur', on);
            el.classList.toggle('is-dim', pi != null && !on);
        });
        if (playsEl) {
            let cur = null;
            playsEl.querySelectorAll('.pp-pbp-play').forEach(el => {
                const on = +el.dataset.pi === pi;
                el.classList.toggle('is-cur', on);
                if (on) cur = el;
            });
            if (cur) cur.scrollIntoView({ block: 'nearest' });
        }
    };
    const updateSb = (w, di) => {
        if (qEl) qEl.textContent = ordQ(w.q);
        if (clockEl) clockEl.textContent = w.c || '';
        if (ddEl) ddEl.textContent = w.dd || '—';
        if (awayScore) awayScore.textContent = w.a ?? '—';
        if (homeScore) homeScore.textContent = w.h ?? '—';
        const hp = Math.round(w.p * 100);
        if (homeWp) homeWp.textContent = `${hp}%`;
        if (awayWp) awayWp.textContent = `${100 - hp}%`;
        const poss = drives[di]?.team;
        awayT?.classList.toggle('pp-sb-has-ball', !!poss && poss === awayT.dataset.abbr);
        homeT?.classList.toggle('pp-sb-has-ball', !!poss && poss === homeT.dataset.abbr);
        homeT?.classList.toggle('pp-sb-lead', w.p >= 0.5);
        awayT?.classList.toggle('pp-sb-lead', w.p < 0.5);
    };
    // Intervallo di campioni win-prob per drive (per la vista "intero drive"
    // fuori hover e per l'evidenziazione della pastiglia nella striscia).
    const range = {};
    wp.forEach((w, i) => {
        if (w.di == null) return;
        if (!range[w.di]) range[w.di] = [i, i];
        else { range[w.di][1] = i; if (i < range[w.di][0]) range[w.di][0] = i; }
    });
    const firstDi = Math.min(...Object.keys(range).map(Number));
    const ds = root.querySelector('.pp-ds');
    const dsBtns = ds ? [...ds.querySelectorAll('.pp-ds-ev')] : [];
    const setActiveDrive = (di) => dsBtns.forEach(b => b.classList.toggle('is-active', +b.dataset.drive === di));

    // Intero drive (nessuna azione evidenziata): tutte le frecce accese, tabella
    // completa; scorebug allo stato di fine drive (ultimo campione del drive).
    const showWholeDrive = (di) => {
        if (di == null || !drives[di]) return;
        if (cursor) cursor.style.display = 'none';
        if (dot) dot.style.display = 'none';
        const r = range[di];
        if (r) updateSb(wp[r[1]], di);
        renderDrive(di, null);
        setActiveDrive(di);
    };
    // Singola azione (hover sul grafico): cursore + freccia accesa, riga evidenziata.
    const showPlay = (i) => {
        const w = wp[i]; if (!w) return;
        if (vb && cursor && dot) {
            const x = (i / (n - 1)) * (vb.width - 4) + 2;
            const y = padT + (1 - w.p) * (vb.height - padT - padB);
            cursor.setAttribute('x1', x); cursor.setAttribute('x2', x); cursor.style.display = '';
            dot.setAttribute('cx', x); dot.setAttribute('cy', y); dot.style.display = '';
            dot.style.fill = w.p >= 0.5 ? homeCol : awayCol;
        }
        updateSb(w, w.di);
        if (w.di != null) { renderDrive(w.di, w.pi); setActiveDrive(w.di); }
    };
    const move = (e) => {
        const r = wpEl.getBoundingClientRect();
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const frac = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
        showPlay(Math.round(frac * (n - 1)));
    };
    wpEl.addEventListener('mousemove', move);
    wpEl.addEventListener('touchmove', move, { passive: true });
    // Fuori dal grafico → intero drive attualmente mostrato.
    wpEl.addEventListener('mouseleave', () => showWholeDrive(curDi >= 0 ? curDi : firstDi));
    // Click sulla striscia → seleziona l'intero drive.
    dsBtns.forEach(b => b.addEventListener('click', () => showWholeDrive(+b.dataset.drive)));

    showWholeDrive(Number.isFinite(firstDi) ? firstDi : 0);   // stato iniziale: primo drive intero
    return true;
}

/** Fallback (gare senza win probability): timeline a pastiglie → disegna il drive. */
function bindFieldStandalone(root) {
    const fd = root.querySelector('[data-fd]');
    if (!fd) return;
    let drives = [];
    try { drives = JSON.parse(root.querySelector('.pp-fd-data')?.textContent || '[]'); } catch { drives = []; }
    const arrows = fd.querySelector('.pp-fd-arrows'), info = fd.querySelector('.pp-fd-info');
    const timeline = root.querySelector('.pp-fd-timeline'), playsEl = root.querySelector('.pp-fd-plays');
    const draw = (i) => {
        const d = drives[i]; if (!d) return;
        timeline?.querySelectorAll('.pp-fd-ev').forEach(c => c.classList.toggle('is-active', +c.dataset.drive === i));
        if (arrows) arrows.innerHTML = buildFieldArrows(d);
        if (info) info.innerHTML = buildFieldInfo(d);
        if (playsEl) playsEl.innerHTML = buildFieldPlays(d);
    };
    timeline?.querySelectorAll('.pp-fd-ev').forEach(c => c.addEventListener('click', () => draw(+c.dataset.drive)));
    draw(0);
}

/**
 * Aggancia le righe del calendario primario ("Schedule and matchups") al
 * dettaglio partita ESPN: ogni riga con un evento ESPN corrispondente (match
 * per numero di settimana) diventa cliccabile e apre il dettaglio sotto.
 * Il calendario è rigenerato a ogni cambio anno, quindi (1) la delega di click
 * sta sul contenitore stabile #nfl-calendar e (2) un MutationObserver ri-annota
 * le righe a ogni ricostruzione.
 */
function bindCalendarGameDetail(section, abbr) {
    const cal = section.querySelector('#nfl-calendar');
    if (!cal) return;

    annotateCalendar(section);
    new MutationObserver(() => annotateCalendar(section)).observe(cal, { childList: true });

    cal.addEventListener('click', (e) => {
        const tr = e.target.closest('tr.pp-game-row');
        if (!tr?.dataset.eventId) return;
        openGameDetail(section, abbr, tr.dataset.eventId, tr);
    });
}

/** Marca le righe del calendario che hanno un evento ESPN, rendendole cliccabili. */
function annotateCalendar(section) {
    const cal = section?.querySelector('#nfl-calendar');
    if (!cal) return;
    const block = [...cal.querySelectorAll('.pm-block')].find(b =>
        b.querySelector('.mc-kicker')?.textContent.includes('Schedule and matchups'));
    // Il nuovo calendario ESPN ha l'eventId già nell'HTML (tabelle .nfl-cal-baked):
    // niente da annotare per settimana, si ignora.
    const table = block?.querySelector('.pp-table:not(.nfl-cal-baked)');
    if (!table) return;
    table.classList.add('nfl-cal-clickable');
    table.querySelectorAll('tbody tr').forEach(tr => {
        const g = _eventForWeek(_weekNum(tr.querySelector('td')?.textContent));
        if (g) { tr.dataset.eventId = g.eventId; tr.classList.add('pp-game-row'); }
        else { delete tr.dataset.eventId; tr.classList.remove('pp-game-row'); }
    });
}

/**
 * Apre il dettaglio della partita cliccata INLINE nel calendario: inserisce una
 * riga espandibile subito sotto quella cliccata (accordion). Ri-cliccare la
 * stessa riga chiude; cliccarne un'altra sposta il dettaglio. Fetch a richiesta.
 */
async function openGameDetail(section, abbr, eventId, rowEl) {
    const table = rowEl.closest('table');
    if (!table) return;
    const wasOpenHere = rowEl.nextElementSibling?.classList.contains('pp-game-detail-row');

    // Chiudi qualsiasi dettaglio aperto e deseleziona (un solo dettaglio per volta).
    table.querySelectorAll('tr.pp-game-detail-row').forEach(r => r.remove());
    table.querySelectorAll('tr.pp-game-row--active').forEach(r => r.classList.remove('pp-game-row--active'));
    if (wasOpenHere) return; // toggle: era già aperto qui → lascia chiuso

    rowEl.classList.add('pp-game-row--active');
    const detailTr = document.createElement('tr');
    detailTr.className = 'pp-game-detail-row';
    detailTr.innerHTML = `<td colspan="${rowEl.children.length}"><div class="pp-game-detail-inner"><div class="loading-state"><div class="spinner"></div></div></div></td>`;
    rowEl.after(detailTr);

    const myHash = location.hash;
    const [summary, boxCats] = await Promise.all([
        getGameSummary(eventId).catch(() => null),
        getTeamGameBoxscore(abbr, eventId).catch(() => []),
    ]);
    // La riga può essere stata rimossa nel frattempo (cambio anno, altro click).
    if (location.hash !== myHash || !detailTr.isConnected) return;
    const inner = detailTr.querySelector('.pp-game-detail-inner');
    inner.innerHTML = gameBodyHtml(summary, boxCats);
    // Vincola la larghezza del dettaglio all'area visibile (il <td> è largo
    // quanto la tabella calendario, che scrolla orizzontalmente).
    const wrap = rowEl.closest('.pm-table-wrap');
    if (wrap) inner.style.width = `${wrap.clientWidth}px`;
    bindGameDetail(inner);
}

/** Movimenti roster (transactions). Nascosto se ESPN non ne restituisce. */
function transactionsBlock({ transactions }) {
    if (!transactions?.length) return '';
    const rows = transactions.slice(0, 20).map(t => `
        <div class="pp-inj-row">
            <span class="pp-inj-detail">${esc(t.description)}</span>
            ${t.date ? `<span class="pp-inj-status">${new Date(t.date).toLocaleDateString('it-IT')}</span>` : ''}
        </div>`).join('');
    return `
    <section class="pm-block pp-block">
        <span class="mc-kicker">Roster moves · ESPN</span>
        ${rows}
        <p class="pm-note">Signings, cuts and waivers for the selected season (most recent) per ESPN. Change the year from the selector above.</p>
    </section>`;
}

/** Odds Super Bowl (futures). */
function futuresBlock({ futures }) {
    if (!futures || futures.odds == null) return '';
    return `
    <section class="pm-block pp-block">
        <span class="mc-kicker">Super Bowl odds · ESPN</span>
        <div class="pm-tiles pp-tiles">${tile(esc(String(futures.odds)), `Vittoria Super Bowl${futures.provider ? ` · ${esc(futures.provider)}` : ''}`)}</div>
        <p class="pm-note">Odds (American moneyline) to win the title per the listed ESPN book.</p>
    </section>`;
}

function bindBack(section) {
    section.querySelector('[data-pp-back]')?.addEventListener('click', (e) => {
        e.preventDefault();
        if (history.length > 1) history.back();
        else location.hash = 'players';
    });
}
