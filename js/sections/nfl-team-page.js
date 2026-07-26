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
import { getTeamTrades, getTeamATS, getFranchiseHistory } from '../data/nfl-team-profile-extra.js?v=1';
import { getTeamDraftHistory } from '../data/context-score.js?v=4';
import { getTeamDepthChart } from '../data/nfl-team-extras.js?v=7';
import { canonAbbr } from '../data/nfl-schedule.js?v=1';
import {
    getTeamProfile, getTeamPowerIndex, getTeamScheduleLive,
    getTeamTransactions, getTeamSeasonStats, getTeamFutures,
    getGameSummary, getTeamGameBoxscore, getTeamLeaders, getNews,
} from '../data/nfl-team-live.js?v=6';
import {
    esc, teamLogo, factChip, tile, fmt1, ord, TEAM_HISTORY_YEARS,
    teamHistoryBlock, teamExtrasBlock,
    teamYearPicker, bindTeamYearSelector, fetchTeamSeasonData,
    teamPerfBlocksHtml, teamScheduleBlocksHtml,
    fetchTeamHistory, hydrateCharts,
} from './player-page.js?v=51';

export async function initNflTeamPage() {
    const section = document.getElementById('nfl-team-page');
    if (!section) return;

    const myHash = location.hash;
    const parts = myHash.slice(1).split('/'); // nfl-team/{abbr}/{year?}
    const abbr = canonAbbr(parts[1] || '');
    const requestedYear = /^\d{4}$/.test(parts[2] || '') ? +parts[2] : null;
    const identity = abbr ? getTeamIdentity(abbr) : null;

    if (!abbr || !identity) {
        section.innerHTML = `<div class="section-inner"><div class="empty-state"><div class="empty-state-icon">🏈</div><p class="empty-state-text">Squadra non trovata</p></div></div>`;
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

        const [trades, ats, history, draftHistory, live] = await Promise.all([
            getTeamTrades(abbr).catch(() => []),
            getTeamATS(abbr, season).catch(() => null),
            getFranchiseHistory(abbr).catch(() => null),
            getTeamDraftHistory(abbr).catch(() => []),
            fetchTeamLive(abbr, season),
        ]);
        if (location.hash !== myHash) return;

        render(section, {
            abbr, identity, year: season,
            ...seasonData, teamHistory, live,
            teamExtras: { trades, ats, history, draftHistory },
        });
    } catch (e) {
        console.error('[nfl-team-page]', e);
        if (location.hash !== myHash) return;
        section.innerHTML = `<div class="section-inner"><div class="empty-state"><div class="empty-state-icon">📡</div><p class="empty-state-text">Errore nel caricamento della squadra</p></div></div>`;
    }
}

/** Bundle ESPN live (dipende dalla stagione): profilo, FPI, calendario, txn, stat, odds, depth chart. */
async function fetchTeamLive(abbr, season) {
    const [profile, fpi, schedule, transactions, seasonStats, futures, depthChart, leaders, news] = await Promise.all([
        getTeamProfile(abbr, season).catch(() => null),
        getTeamPowerIndex(abbr, season).catch(() => null),
        getTeamScheduleLive(abbr, season).catch(() => []),
        getTeamTransactions(abbr).catch(() => []),
        getTeamSeasonStats(abbr, season).catch(() => []),
        getTeamFutures(abbr, season).catch(() => null),
        getTeamDepthChart(abbr, season).catch(() => null),
        getTeamLeaders(abbr, season).catch(() => []),
        getNews(profileAbbrToEspn(abbr)).catch(() => []),
    ]);
    // Dettaglio partita di default = ultima gara giocata (una sola fetch; le altre a richiesta).
    const played = schedule.filter(g => g.completed && g.eventId);
    const lastGame = played[played.length - 1] || null;
    const game = lastGame ? {
        eventId: lastGame.eventId,
        summary: await getGameSummary(lastGame.eventId).catch(() => null),
        boxCats: await getTeamGameBoxscore(abbr, lastGame.eventId).catch(() => []),
    } : null;
    return { profile, fpi, schedule, transactions, seasonStats, futures, depthChart, leaders, news, game };
}

// La sigla canonica coincide con quella ESPN minuscola per il filtro news.
const profileAbbrToEspn = (abbr) => (abbr || '').toLowerCase();

function render(section, ctx) {
    const { abbr, identity, year, live } = ctx;
    const rec = ctx.ctx?.team?.record;
    const recChip = rec ? factChip(`${rec.w}-${rec.l}${rec.t ? '-' + rec.t : ''}`, `record ${year}`) : '';

    section.innerHTML = `
    <div class="section-inner gb-page pp-page">
        <a class="gb-back" href="#" data-pp-back><span aria-hidden="true">←</span> Indietro</a>

        <h2 class="pp-section-title"><small>01</small> Identità squadra</h2>
        <header class="mosaic-card mc-wide pp-hero mc-in">
            <div class="pp-recap">
                <img class="pp-recap-photo" style="border-radius:var(--radius-lg);object-fit:contain;background:transparent;border:none"
                    src="${teamLogo(abbr)}" alt="${esc(identity.name)}">
                <div class="pp-recap-body">
                    <div class="pp-recap-name"><span class="mc-kicker">Squadra NFL</span></div>
                    <h1 class="mc-title">${esc(identity.name)}</h1>
                    <div class="pp-recap-team"><span class="pp-team-div" style="color:${identity.color}">${esc(identity.conf)} · ${esc(identity.division)}</span></div>
                    ${recChip ? `<div class="pp-fact-chips" style="margin-top:10px">${recChip}</div>` : ''}
                </div>
            </div>
        </header>
        <div id="nfl-identity-extra">${identityExtraBlock(live)}</div>

        <h2 class="pp-section-title"><small>02</small> Rendimento stagione</h2>
        ${teamYearPicker(year)}
        <div id="pp-team-perf">${teamPerfBlocksHtml(abbr, 'TEAM', ctx)}</div>
        <div id="nfl-live-perf">${fpiBlock(live)}${teamLeadersBlock(live)}${seasonStatsBlock(live)}</div>

        <h2 class="pp-section-title"><small>03</small> Rosa e calendario</h2>
        <div id="pp-team-roster">${teamScheduleBlocksHtml(abbr, 'TEAM', ctx)}</div>
        <div id="nfl-live-sched">${depthChartBlock(live)}${scheduleBlock(live)}${gameDetailBlock(live)}${transactionsBlock(live)}</div>

        <h2 class="pp-section-title"><small>04</small> Storia e franchigia</h2>
        ${teamHistoryBlock(ctx)}
        ${teamExtrasBlock(ctx)}
        <div id="nfl-live-extra">${futuresBlock(live)}${newsBlock(live)}</div>

        <p class="dg-footnote">Dati squadra: nflverse (storico, calendario, depth chart, draft, trade) con integrazione ESPN dal vivo (profilo/stadio/coach, Football Power Index, statistiche ufficiali, calendario, transactions, odds).</p>
    </div>`;

    bindBack(section);
    bindTeamYearSelector(section, abbr, 'TEAM');
    bindLiveYearSelector(section, abbr);
    bindGameDetail(section, abbr);
    hydrateCharts(section);
}

/** Secondo listener sul selettore stagione: aggiorna i blocchi ESPN live. */
function bindLiveYearSelector(section, abbr) {
    const select = section.querySelector('#pp-team-year');
    if (!select) return;
    select.addEventListener('change', async () => {
        const year = +select.value;
        const myHash = location.hash;
        const perf = section.querySelector('#nfl-live-perf');
        const sched = section.querySelector('#nfl-live-sched');
        const extra = section.querySelector('#nfl-live-extra');
        const idExtra = section.querySelector('#nfl-identity-extra');
        const spinner = '<div class="loading-state"><div class="spinner"></div></div>';
        if (perf) perf.innerHTML = spinner;
        if (sched) sched.innerHTML = '';
        const live = await fetchTeamLive(abbr, year);
        if (location.hash !== myHash) return;
        if (idExtra) idExtra.innerHTML = identityExtraBlock(live);
        if (perf) perf.innerHTML = fpiBlock(live) + teamLeadersBlock(live) + seasonStatsBlock(live);
        if (sched) sched.innerHTML = depthChartBlock(live) + scheduleBlock(live) + gameDetailBlock(live) + transactionsBlock(live);
        if (extra) extra.innerHTML = futuresBlock(live) + newsBlock(live);
        bindGameDetail(section, abbr); // il <select> è stato ricreato
    });
}

// ─── Blocchi ESPN live ───────────────────────────────────────────────────

/** Coach, posizione in classifica, prossima partita e stadio. */
function identityExtraBlock({ profile }) {
    if (!profile) return '';
    const p = profile;
    const rs = p.recordSplits || {};
    const chips = [
        p.standingSummary ? factChip(esc(p.standingSummary), '') : '',
        rs.home ? factChip(esc(rs.home), 'in casa') : '',
        rs.road ? factChip(esc(rs.road), 'in trasferta') : '',
        rs.div ? factChip(esc(rs.div), 'in divisione') : '',
        rs.conf ? factChip(esc(rs.conf), 'in conference') : '',
    ].filter(Boolean).join('');

    const co = p.coach;
    const coachHtml = co?.name ? `
        <div class="pp-coach">
            ${co.headshot ? `<img class="pp-coach-img" src="${esc(co.headshot)}" alt="" loading="lazy" onerror="this.style.display='none'">` : ''}
            <div class="pp-coach-body">
                <span class="mc-kicker">Head coach</span>
                <b>${esc(co.name)}</b>
                <span class="pm-note" style="margin-top:2px">${[co.experience != null ? `${co.experience}ª stagione` : '', co.college ? `${esc(co.college)}` : '', co.birthPlace ? esc(co.birthPlace) : ''].filter(Boolean).join(' · ')}</span>
            </div>
        </div>` : '';

    const v = p.venue;
    const venueHtml = v?.name ? `
        <div class="pp-stadium">
            ${v.image ? `<img class="pp-stadium-img" src="${esc(v.image)}" alt="" loading="lazy" onerror="this.style.display='none'">` : ''}
            <div class="pp-stadium-body">
                <span class="mc-kicker">Stadio</span>
                <b>${esc(v.name)}</b>
                <span class="pm-note" style="margin-top:2px">${[v.city && v.state ? `${esc(v.city)}, ${esc(v.state)}` : '', v.capacity ? `${(+v.capacity).toLocaleString('it-IT')} posti` : '', v.indoor ? 'coperto' : 'all\'aperto', v.grass ? 'erba naturale' : 'sintetico'].filter(Boolean).join(' · ')}</span>
            </div>
        </div>` : '';

    const ne = p.nextEvent;
    const nextHtml = ne?.name ? `
        <div class="pp-nextgame">
            <span class="mc-kicker">Prossima partita</span>
            <b>${esc(ne.shortName || ne.name)}</b>
            <span class="pm-note" style="margin-top:2px">${[ne.week, ne.date ? new Date(ne.date).toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' }) : '', ne.venue].filter(Boolean).join(' · ')}</span>
        </div>` : '';

    if (!chips && !venueHtml && !nextHtml && !coachHtml) return '';
    return `
    <section class="pm-block pp-block">
        ${chips ? `<div class="pp-fact-chips" style="margin-bottom:12px">${chips}</div>` : ''}
        <div class="pp-identity-grid">${coachHtml}${venueHtml}${nextHtml}</div>
        <p class="pm-note">Record con split (casa/trasferta/divisione/conference), head coach, stadio e prossima partita — fonti ESPN canoniche.</p>
    </section>`;
}

/** Football Power Index (rating, rank, record proiettato). */
function fpiBlock({ fpi }) {
    if (!fpi || fpi.fpi == null) return '';
    const tiles = [
        tile(fmt1(fpi.fpi), 'FPI (net points)'),
        fpi.rank != null ? tile(ord(fpi.rank), 'Rank FPI (su 32)') : '',
        fpi.projW != null && fpi.projL != null ? tile(`${Math.round(fpi.projW)}-${Math.round(fpi.projL)}${fpi.projT ? `-${Math.round(fpi.projT)}` : ''}`, 'Record proiettato') : '',
    ].filter(Boolean).join('');
    if (!tiles) return '';
    return `
    <section class="pm-block pp-block">
        <span class="mc-kicker">Football Power Index · ESPN</span>
        <div class="pm-tiles pp-tiles">${tiles}</div>
        <p class="pm-note">Il FPI misura la forza netta della squadra (margine punti atteso contro un avversario medio); rank e record proiettato dalla stessa run ESPN.</p>
    </section>`;
}

/** Stat sheet ufficiale ESPN per categoria, con rank 1-32. */
function seasonStatsBlock({ seasonStats }) {
    if (!seasonStats?.length) return '';
    const PRIMARY = new Set(['passing', 'rushing', 'defensive', 'scoring']);
    const catTable = (c) => `
        <div class="pp-statcat">
            <h3 class="pp-cat-title">${esc(c.label)}</h3>
            <div class="pm-table-wrap pp-scroll">
                <table class="pm-table pp-table">
                    <thead><tr><th>Statistica</th><th>Valore</th><th>Rank NFL</th></tr></thead>
                    <tbody>${c.stats.map(s => `<tr><td>${esc(s.label)}</td><td class="pm-td-strong">${esc(s.value)}</td><td>${esc(s.rank)}</td></tr>`).join('')}</tbody>
                </table>
            </div>
        </div>`;
    const primary = seasonStats.filter(c => PRIMARY.has(c.key));
    const rest = seasonStats.filter(c => !PRIMARY.has(c.key));
    return `
    <section class="pm-block pp-block">
        <span class="mc-kicker">Statistiche ufficiali · ESPN ${''}</span>
        ${(primary.length ? primary : seasonStats).map(catTable).join('')}
        ${primary.length && rest.length ? `
        <details class="pp-recap-ids" style="margin-top:6px">
            <summary>Altre categorie (${rest.length})</summary>
            ${rest.map(catTable).join('')}
        </details>` : ''}
        <p class="pm-note">Stat sheet ufficiale ESPN con rank 1-32 su tutte le 32 squadre (regular season).</p>
    </section>`;
}

/** Depth chart completo (profondità ordinata per slot). */
function depthChartBlock({ depthChart }) {
    if (!depthChart) return '';
    const col = (list, label) => {
        if (!list?.length) return '';
        const rows = list.map(slot => `
            <div class="pp-depth-row">
                <span class="pp-lb-pos">${esc(slot.pos || '')}</span>
                <span class="pp-depth-players">${slot.players.map((pl, i) => `<span class="pp-depth-player${i === 0 ? ' pp-depth-starter' : ''}">${esc(pl.name || '—')}${pl.jersey != null ? ` <small>#${pl.jersey}</small>` : ''}</span>`).join('<span class="pp-depth-sep">›</span>')}</span>
            </div>`).join('');
        return `<div class="pp-starters-col"><h3 class="pp-cat-title">${label}</h3>${rows}</div>`;
    };
    const html = col(depthChart.offense, 'Attacco') + col(depthChart.defense, 'Difesa');
    if (!html) return '';
    const build = depthChart.source === 'build';
    return `
    <section class="pm-block pp-block">
        <span class="mc-kicker">Depth chart completo · ${build ? 'nflverse' : 'ESPN dal vivo'}</span>
        <div class="pp-starters-grid">${html}</div>
        <p class="pm-note">Profondità ordinata per slot (titolare in grassetto, poi le riserve). ${build ? 'Ricostruito dal roster nflverse della stagione (ordine per snap%): accurato anche sulle stagioni passate.' : 'Fonte ESPN dal vivo: fotografia attuale, non storica.'}</p>
    </section>`;
}

/** Calendario ESPN della stagione con risultati e punteggi. */
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
        <span class="mc-kicker">Calendario · ESPN</span>
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
        <span class="mc-kicker">Leader di squadra · ESPN</span>
        <div class="pm-tiles pp-tiles">${tiles}</div>
        <p class="pm-note">Giocatore in testa alla squadra per categoria nella stagione (regular season).</p>
    </section>`;
}

/** Feed notizie della squadra (now.core.api). Nascosto se vuoto. */
function newsBlock({ news }) {
    if (!news?.length) return '';
    return `
    <section class="pm-block pp-block">
        <span class="mc-kicker">Ultime notizie · ESPN</span>
        <ul class="pp-news-list">${news.slice(0, 8).map(n => `
            <li>${n.link ? `<a href="${esc(n.link)}" target="_blank" rel="noopener">${esc(n.headline)}</a>` : esc(n.headline)}${n.published ? ` <span class="pm-note">· ${new Date(n.published).toLocaleDateString('it-IT')}</span>` : ''}</li>`).join('')}</ul>
    </section>`;
}

/** Dettaglio partita (game summary): punteggio, confronto squadre, segnature, info gara, win prob. */
function renderGameSummary(s) {
    if (!s) return '<p class="pm-note">Dettaglio non disponibile per questa gara.</p>';
    const away = s.competitors.find(c => !c.home), home = s.competitors.find(c => c.home);
    const scoreLine = (away && home) ? `
        <div class="pp-gs-score">
            <span class="pp-gs-team${away.winner ? ' pp-gs-win' : ''}">${esc(away.abbr)} <b>${esc(String(away.score ?? ''))}</b></span>
            <span class="pp-gs-at">@</span>
            <span class="pp-gs-team${home.winner ? ' pp-gs-win' : ''}"><b>${esc(String(home.score ?? ''))}</b> ${esc(home.abbr)}</span>
            <span class="pp-gs-status">${esc(s.status || '')}</span>
        </div>` : '';

    // confronto statistico squadra a squadra (away | stat | home)
    const awayStats = s.teamStats.find(t => !t.home), homeStats = s.teamStats.find(t => t.home);
    let cmp = '';
    if (awayStats && homeStats) {
        const homeByLabel = Object.fromEntries(homeStats.stats.map(x => [x.label, x.value]));
        const rows = awayStats.stats.map(a => `<tr><td class="pp-gs-a">${esc(a.value)}</td><td class="pp-gs-lbl">${esc(a.label)}</td><td class="pp-gs-h">${esc(homeByLabel[a.label] ?? '—')}</td></tr>`).join('');
        cmp = `<div class="pm-table-wrap pp-scroll"><table class="pm-table pp-table pp-gs-table">
            <thead><tr><th>${esc(awayStats.abbr)}</th><th>Statistica</th><th>${esc(homeStats.abbr)}</th></tr></thead>
            <tbody>${rows}</tbody></table></div>`;
    }

    const scoring = s.scoring?.length ? `
        <h3 class="pp-cat-title" style="margin-top:16px">Segnature</h3>
        <div class="pp-gs-scoring">${s.scoring.map(p => `
            <div class="pp-gs-play"><span class="pp-lb-pos">Q${p.q ?? ''}</span><span class="pp-gs-clock">${esc(p.clock || '')}</span><span class="pp-gs-text">${esc(p.team || '')} · ${esc(p.text || p.type || '')}</span><span class="pp-gs-sc">${p.away ?? ''}-${p.home ?? ''}</span></div>`).join('')}</div>` : '';

    // Proiezione ESPN pre-gara + linea + win prob (#5)
    let predHtml = '';
    if ((s.prediction && s.prediction.homePct != null) || s.odds || s.homeWinPctStart != null) {
        const chips = [];
        if (s.prediction?.homePct != null && away && home) {
            chips.push(factChip(`${Math.round(s.prediction.awayPct)}%`, `proiez. ${away.abbr}`));
            chips.push(factChip(`${Math.round(s.prediction.homePct)}%`, `proiez. ${home.abbr}`));
        }
        if (s.homeWinPctStart != null && home) chips.push(factChip(`${Math.round(s.homeWinPctStart * 100)}%`, `win prob iniziale ${home.abbr}`));
        if (s.homeWinPct != null && home) chips.push(factChip(`${Math.round(s.homeWinPct * 100)}%`, `win prob finale ${home.abbr}`));
        if (s.odds?.details) chips.push(factChip(esc(s.odds.details), s.odds.provider ? esc(s.odds.provider) : 'linea'));
        if (s.odds?.overUnder != null) chips.push(factChip(`O/U ${esc(String(s.odds.overUnder))}`, ''));
        const c = chips.filter(Boolean).join('');
        if (c) predHtml = `<div class="pp-fact-chips" style="margin:10px 0">${c}</div>`;
    }

    // Drive chart + play-by-play (#1): ogni drive con l'intestazione e le sue giocate
    const playRow = (p) => {
        const cls = p.scoring ? ' pp-pbp-score' : p.turnover ? ' pp-pbp-to' : p.penalty ? ' pp-pbp-pen' : '';
        return `<div class="pp-pbp-play${cls}">
            <span class="pp-pbp-dd">${esc(p.dd || (p.q ? `Q${p.q}` : ''))}</span>
            <span class="pp-pbp-text">${esc(p.text || '')}</span>
            ${p.scoring ? `<span class="pp-gs-sc">${p.away ?? ''}-${p.home ?? ''}</span>` : ''}
        </div>`;
    };
    const driveGroup = (dr) => `
        <div class="pp-pbp-drive">
            <div class="pp-pbp-dhead">
                <span class="pp-lb-pos">${esc(dr.team || '')}</span>
                <span class="pp-pbp-ddesc">${esc(dr.desc || '')}${dr.start && dr.end ? ` · ${esc(dr.start)}→${esc(dr.end)}` : ''}</span>
                <span class="pp-gs-sc">${esc(dr.result || '')}</span>
            </div>
            ${dr.plays?.length ? `<div class="pp-pbp-plays">${dr.plays.map(playRow).join('')}</div>` : ''}
        </div>`;
    const totalPlays = s.drives?.reduce((n, d) => n + (d.plays?.length || 0), 0) || 0;
    const drivesHtml = s.drives?.length ? `
        <details class="pp-recap-ids" style="margin-top:12px">
            <summary>Play-by-play — ${s.drives.length} drive, ${totalPlays} giocate</summary>
            <div class="pp-pbp" style="margin-top:8px">${s.drives.map(driveGroup).join('')}</div>
        </details>` : '';

    const gi = s.gameInfo || {};
    const info = [gi.venue ? `${esc(gi.venue)}${gi.city ? `, ${esc(gi.city)}` : ''}` : '', gi.attendance ? `${(+gi.attendance).toLocaleString('it-IT')} spettatori` : '', gi.officials?.length ? `${gi.officials.length} arbitri` : ''].filter(Boolean).join(' · ');

    return `${scoreLine}${predHtml}${cmp}${scoring}${drivesHtml}${info ? `<p class="pm-note">${info}</p>` : ''}`;
}

/** Statistiche dettagliate per-gara della squadra (competitors/{id}/statistics), per categoria. */
function detailedBoxHtml(cats) {
    if (!cats?.length) return '';
    const nVoci = cats.reduce((n, c) => n + c.stats.length, 0);
    return `
    <details class="pp-recap-ids" style="margin-top:12px">
        <summary>Statistiche dettagliate della squadra (${nVoci} voci)</summary>
        <div style="margin-top:8px">${cats.map(c => `
            <div class="pp-statcat">
                <h3 class="pp-cat-title">${esc(c.label)}</h3>
                <div class="pm-table-wrap pp-scroll">
                    <table class="pm-table pp-table"><tbody>${c.stats.map(st => `<tr><td>${esc(st.label)}</td><td class="pm-td-strong">${esc(st.value)}</td></tr>`).join('')}</tbody></table>
                </div>
            </div>`).join('')}</div>
    </details>`;
}

/** Corpo completo del dettaglio partita: riepilogo summary + statistiche dettagliate. */
function gameBodyHtml(summary, boxCats) {
    return renderGameSummary(summary) + detailedBoxHtml(boxCats);
}

function gameDetailBlock({ schedule, game }) {
    const played = (schedule || []).filter(g => g.completed && g.eventId);
    if (!played.length) return '';
    const opt = (g) => {
        const at = g.homeAway === 'away' ? '@' : 'vs';
        const wl = g.winner === true ? 'V' : g.winner === false ? 'S' : '';
        const score = (g.score != null && g.oppScore != null) ? ` (${wl} ${g.score}-${g.oppScore})` : '';
        const sel = game && g.eventId === game.eventId ? ' selected' : '';
        return `<option value="${esc(g.eventId)}"${sel}>${esc(g.week || '')} ${at} ${esc(g.opp || g.oppName || '')}${score}</option>`;
    };
    return `
    <section class="pm-block pp-block">
        <span class="mc-kicker">Dettaglio partita · ESPN</span>
        <div class="pp-year-picker" style="margin:8px 0 4px">
            <label for="nfl-game-sel">Partita</label>
            <select id="nfl-game-sel">${played.map(opt).join('')}</select>
        </div>
        <div id="nfl-game-body">${gameBodyHtml(game?.summary, game?.boxCats)}</div>
        <p class="pm-note">Punteggio, confronto statistico squadra vs squadra, segnature, info gara, win probability e statistiche dettagliate della squadra. Scegli un'altra partita per aggiornare.</p>
    </section>`;
}

/** Carica il dettaglio della partita scelta nel <select> (fetch a richiesta). */
function bindGameDetail(section, abbr) {
    const select = section.querySelector('#nfl-game-sel');
    const body = section.querySelector('#nfl-game-body');
    if (!select || !body) return;
    select.addEventListener('change', async () => {
        const eventId = select.value;
        const myHash = location.hash;
        body.innerHTML = '<div class="loading-state"><div class="spinner"></div></div>';
        const [summary, boxCats] = await Promise.all([
            getGameSummary(eventId).catch(() => null),
            getTeamGameBoxscore(abbr, eventId).catch(() => []),
        ]);
        if (location.hash !== myHash) return;
        body.innerHTML = gameBodyHtml(summary, boxCats);
    });
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
        <span class="mc-kicker">Movimenti roster · ESPN</span>
        ${rows}
        <p class="pm-note">Firme, tagli e waiver più recenti secondo ESPN.</p>
    </section>`;
}

/** Odds Super Bowl (futures). */
function futuresBlock({ futures }) {
    if (!futures || futures.odds == null) return '';
    return `
    <section class="pm-block pp-block">
        <span class="mc-kicker">Odds Super Bowl · ESPN</span>
        <div class="pm-tiles pp-tiles">${tile(esc(String(futures.odds)), `Vittoria Super Bowl${futures.provider ? ` · ${esc(futures.provider)}` : ''}`)}</div>
        <p class="pm-note">Quota (moneyline americana) per la vittoria del titolo secondo il book ESPN indicato.</p>
    </section>`;
}

function bindBack(section) {
    section.querySelector('[data-pp-back]')?.addEventListener('click', (e) => {
        e.preventDefault();
        if (history.length > 1) history.back();
        else location.hash = 'players';
    });
}
