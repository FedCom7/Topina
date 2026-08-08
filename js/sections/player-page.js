/**
 * Pagina giocatore completa — route #player/{year}/{pos}/{nome URI-encoded}.
 *
 * Tutte le statistiche disponibili: anagrafica e ID esterni (Sleeper),
 * carriera NFL per categoria (tutte le stagioni dal 2015, senza selettore),
 * game log settimanali, metriche avanzate derivate, contesto della squadra
 * NFL (attacco + rank) e calendario con la difficoltà dei matchup (FPA per
 * ruolo). Per le DEF: statistiche difensive, FPA concessi e gli ATTACCHI
 * che la difesa affronta.
 *
 * Stesso pattern di draftgrade-team.js: niente guard `initialized`,
 * re-parse dell'hash a ogni chiamata, guard anti-race dopo ogni await.
 */

import { getFullPlayer, FIRST_STATS_YEAR } from '../data/player-full.js?v=13';
import { computeSeasonMetrics, computeEfficiency, snapSharePct, computeProvisionalAdv } from '../data/player-metrics.js?v=12';
import { getTeamContext, getTeamStats } from '../data/nfl-team-stats.js?v=11';
import { getCareer, getPlayerAwards, buildCareers } from '../data/careers.js?v=14';
import { topinaBlock, awardsBlock } from '../components/player-modal.js?v=25';
import { getSeasonProjections, getSeasonStats, matchProjection } from '../data/projections.js?v=15';
import { playerImageService } from '../services/player-image-service.js?v=15';
import { canonAbbr } from '../data/nfl-schedule.js?v=11';
import { CURRENT_SEASON } from '../data.js?v=32';
import { getAdvancedSeasons, getTeamAdvanced, getCombineDraft, getTeamDraftHistory, getDraftPeers, getAdvancedPool } from '../data/context-score.js?v=8';
import { getTeamIdentity } from '../data/nfl-teams.js?v=1';
import { getTeamRoster, getTeamInjuries, getTeamStarters, getPlayerInjuries, currentNflSeason } from '../data/nfl-team-extras.js?v=12';
import { getTeamTrades, getTeamATS, getFranchiseHistory } from '../data/nfl-team-profile-extra.js?v=1';
import { resolvePlayerIds } from '../data/nfl-player-ids.js?v=1';
import { enrichBio, getPlayerAwardsEspn, getPlayerContractEspn, getPlayerOverview, getPlayerEspnExtra, getPlayerRecordsEspn, getPlayerSplits, getPlayerQBR } from '../data/player-bio-extra.js?v=5';
import { decomposeSeason, seasonVerdict, getPerfCauses, describeCauses } from '../data/perf-explain.js?v=8';

export const POS_LIST = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];
// Da 2019 alla stagione NFL corrente (calcolata dalla data): così l'anno nuovo
// (es. 2026 in preseason) compare da solo nei selettori appena inizia.
const _FIRST_HISTORY_YEAR = 2019;
export const TEAM_HISTORY_YEARS = Array.from(
    { length: Math.max(1, currentNflSeason() - _FIRST_HISTORY_YEAR + 1) },
    (_, i) => _FIRST_HISTORY_YEAR + i,
);
export const fmt0 = (n) => n == null ? '—' : Math.round(n).toLocaleString('en-US');
export const fmt1 = (n) => n == null ? '—' : (+n).toLocaleString('it-IT', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
export const fmt2 = (n) => n == null ? '—' : (+n).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const teamLogo = (abbr) => `https://a.espncdn.com/i/teamlogos/nfl/500/${(abbr || '').toLowerCase()}.png`;
export const ord = (n) => n == null ? '' : `${n}ª`;
/** Classe CSS extra per gravità infortunio: rosso per Out/IR/Doubtful/PUP, ambra (default) per il resto. */
export const severityClass = (status) => /^(out|ir|injured reserve|doubtful|pup|physically unable)/i.test(status || '') ? ' pp-inj-status--out' : '';

// ─── Init ────────────────────────────────────────────────────────

export async function initPlayerPage() {
    const section = document.getElementById('player-page');
    if (!section) return;

    const myHash = location.hash;
    const parts = myHash.slice(1).split('/');
    let name = null;
    try { name = decodeURIComponent(parts.slice(3).join('/') || ''); } catch { /* hash corrotto */ }
    const year = parts[1], pos = (parts[2] || '').toUpperCase().replace('W/R', 'WR');

    if (!name || !year) {
        section.innerHTML = `<div class="section-inner"><div class="empty-state"><p class="empty-state-text">Player not found</p></div></div>`;
        return;
    }

    section.innerHTML = `<div class="section-inner"><div class="loading-state"><div class="spinner"></div><p>Caricamento di tutte le statistiche di ${esc(name)}...</p></div></div>`;

    try {
        const [careerRes, awardsRes] = await Promise.allSettled([getCareer(name), getPlayerAwards(name)]);
        if (location.hash !== myHash) return;
        const career = careerRes.status === 'fulfilled' ? careerRes.value : null;
        const awards = awardsRes.status === 'fulfilled' ? awardsRes.value : { awards: [], allProFirst: [], allProSecond: [] };
        const topinaSeasons = career ? [...career.seasons] : [];

        // Stagione successiva a quella corrente (es. 2026 se CURRENT_SEASON è 2025,
        // l'ultima completata): proiezioni preseason già pubblicate da Sleeper anche
        // mesi prima del kickoff, indipendenti dall'anno di draft della scheda.
        const nextSeason = +CURRENT_SEASON + 1;
        const [fullRes, projRes, nextProjRes] = await Promise.allSettled([
            getFullPlayer({ name, pos, year, topinaSeasons }),
            +year >= 2018 ? getSeasonProjections(year) : Promise.reject(new Error('no proj')),
            getSeasonProjections(nextSeason),
        ]);
        if (location.hash !== myHash) return;
        const full = fullRes.status === 'fulfilled' ? fullRes.value : { playerId: null, info: null, seasons: [], resolved: false };
        const projEntry = projRes.status === 'fulfilled' ? matchProjection(projRes.value, name, pos) : null;
        const nextSeasonProj = nextProjRes.status === 'fulfilled' ? matchProjection(nextProjRes.value, name, pos) : null;

        // ID incrociati (gsis/pfr) per le fonti nflverse/api.nfldata.org, e
        // union della bio Sleeper con i campi che ESPN/nfldata.org hanno e
        // Sleeper no (solo gap-fill, mai sovrascrive un campo già presente).
        const ids = pos !== 'DEF' && full.playerId ? await resolvePlayerIds(full.playerId).catch(() => null) : null;
        if (full.info) full.info = await enrichBio(full.info).catch(() => full.info);
        if (location.hash !== myHash) return;

        const abbr = canonAbbr(full.info?.team || full.seasons[0]?.totals?.team || full.seasons[0]?.weekly?.at(-1)?.team || projEntry?.team || '');
        const ctx = abbr ? await getTeamContext(abbr, year).catch(() => null) : null;
        if (location.hash !== myHash) return;

        // Metriche avanzate nflverse (volume-share, EPA, CPOE, separazione…) —
        // union coi dati Sleeper, solo per i giocatori skill. Degrada a []
        // se i JSON mancano (pagina comunque completa).
        let advSeasons = pos === 'DEF' ? [] : await getAdvancedSeasons(
            name, pos, (full.seasons || []).map(s => +s.year),
        ).catch(() => []);
        // Fallback provvisorio: per gli anni con dati Sleeper ma senza riga
        // nflverse (stagione non ancora pubblicata da nflverse), calcolo il
        // sottoinsieme di metriche derivabile dal box score. Appena nflverse
        // pubblica, getAdvancedSeasons trova la riga reale e questa sparisce.
        if (pos !== 'DEF') {
            const haveYears = new Set(advSeasons.map(a => +a.year));
            const provisional = (full.seasons || [])
                .filter(s => !haveYears.has(+s.year) && s.totals?.stats)
                .map(s => { const p = computeProvisionalAdv(pos, s.totals.stats); return p ? { year: +s.year, ...p } : null; })
                .filter(Boolean);
            if (provisional.length) advSeasons = [...advSeasons, ...provisional];
        }
        const advTeam = abbr ? await getTeamAdvanced(abbr, ctx?.season || +year).catch(() => null) : null;
        if (location.hash !== myHash) return;

        // Pool NFL pari-ruolo delle DUE ultime stagioni avanzate REALI (non
        // provvisorie): la più recente per il radar, entrambe per lo slope
        // chart (variazione percentile anno→anno). Cache adv_players già calda.
        const realAdvYears = [...new Set((advSeasons || []).filter(a => !a.provisional).map(a => +a.year))].sort((a, b) => b - a);
        const advYear = realAdvYears[0] ?? null;
        const advYear2 = realAdvYears[1] ?? null;
        const [advPool, advPool2] = await Promise.all([
            advYear != null ? getAdvancedPool(pos, advYear).catch(() => []) : Promise.resolve([]),
            advYear2 != null ? getAdvancedPool(pos, advYear2).catch(() => []) : Promise.resolve([]),
        ]);
        if (location.hash !== myHash) return;

        // Cronologia infortuni personale (anno per anno, anche cambi squadra) —
        // solo skill player, dai report settimanali nflverse (dal 2019).
        const playerInjuries = pos !== 'DEF'
            ? await getPlayerInjuries(ids?.gsis, name, pos, (full.seasons || []).map(s => +s.year)).catch(() => [])
            : [];
        if (location.hash !== myHash) return;

        // Cause reali per stagione (infortuni compagni, mercato, contesto squadra,
        // calendario) — precalcolate, per la scorecard "perché ha reso così".
        const causesByYear = {};
        if (pos !== 'DEF') {
            const pkey = `${name.toLowerCase().replace(/[.,']/g, '').replace(/\s+/g, ' ').trim()}|${pos}`;
            for (const s of (full.seasons || [])) {
                const m = await getPerfCauses(s.year).catch(() => null);
                const c = m?.get(pkey);
                if (c) causesByYear[s.year] = c;
            }
        }
        if (location.hash !== myHash) return;

        // Rosa/infermeria/titolari e storia squadra: dettaglio squadra completo
        // che serve solo alla pagina DEF (una pick DEF È la squadra). Per un
        // giocatore skill la pagina mostra solo il blocco squadra compatto, che
        // usa `ctx`/`advTeam` (già caricati) — quindi qui evitiamo le fetch.
        const teamYear = ctx?.season || +year;
        const needTeamDetail = pos === 'DEF';
        const [teamRoster, teamInjuries, teamStarters] = (abbr && needTeamDetail) ? await Promise.all([
            getTeamRoster(abbr, teamYear).catch(() => null),
            getTeamInjuries(abbr, teamYear).catch(() => null),
            getTeamStarters(abbr, teamYear).catch(() => null),
        ]) : [null, null, null];
        if (location.hash !== myHash) return;

        const teamHistory = (abbr && needTeamDetail) ? await fetchTeamHistory(abbr) : [];
        if (location.hash !== myHash) return;

        // Combine, draft NFL reale, contratto, riconoscimenti ESPN — solo giocatori.
        const combineDraft = ids?.gsis ? await getCombineDraft(ids.gsis).catch(() => null) : null;
        const [awardsEspn, contractEspn, overview, espnExtra, recordsEspn, splits, qbr] = full.info?.espn_id ? await Promise.all([
            getPlayerAwardsEspn(full.info.espn_id).catch(() => []),
            combineDraft?.contract ? Promise.resolve(null) : getPlayerContractEspn(full.info.espn_id).catch(() => null),
            getPlayerOverview(full.info.espn_id).catch(() => null),
            getPlayerEspnExtra(full.info.espn_id).catch(() => null),
            getPlayerRecordsEspn(full.info.espn_id).catch(() => []),
            getPlayerSplits(full.info.espn_id).catch(() => null),
            pos === 'QB' ? getPlayerQBR(full.info.espn_id, ctx?.season || +year).catch(() => null) : Promise.resolve(null),
        ]) : [[], null, null, null, [], null, null];
        const contract = combineDraft?.contract || contractEspn;
        if (location.hash !== myHash) return;

        // Peer della stessa posizione nello stesso draft NFL reale (per il
        // grafico pick vs AV di carriera) — solo giocatori, serve un draft noto.
        const draftPeers = combineDraft?.draft?.season != null
            ? await getDraftPeers(pos, combineDraft.draft.season).catch(() => []) : [];
        if (location.hash !== myHash) return;

        // Proiezione preseason vs statistiche reali, anno per anno (dal 2018,
        // prima annata con proiezioni Sleeper affidabili) — stessa fonte di
        // projEntry/nextSeasonProj, una fetch per stagione (cache localStorage).
        const projYears = pos !== 'DEF' ? (full.seasons || []).map(s => +s.year).filter(y => y >= 2018) : [];
        const projByYearRes = await Promise.allSettled(projYears.map(y => getSeasonProjections(y)));
        if (location.hash !== myHash) return;
        const projByYear = {};
        projYears.forEach((y, i) => {
            const r = projByYearRes[i];
            projByYear[y] = r.status === 'fulfilled' ? matchProjection(r.value, name, pos) : null;
        });

        // Confronto con la lega Topina (solo giocatori skill): pool pari-ruolo
        // tra i giocatori mai schierati in Topina. Precarichiamo le statistiche
        // league-scoring di TUTTE le stagioni con game log del giocatore (grafico
        // globale percentili + dettaglio per anno, senza refetch alla selezione).
        const cmpYears = pos !== 'DEF'
            ? [...new Set((full.seasons || []).filter(s => (s.weekly?.length || 0) >= 2).map(s => s.year))].sort((a, b) => b - a)
            : [];
        const [cmpStatsList, cmpCareers] = cmpYears.length ? await Promise.all([
            Promise.all(cmpYears.map(y => getSeasonStats(y).catch(() => null))),
            buildCareers().catch(() => null),
        ]) : [[], null];
        if (location.hash !== myHash) return;
        const statsByYear = {};
        cmpYears.forEach((y, i) => { statsByYear[y] = cmpStatsList[i]; });
        const compare = { years: cmpYears, statsByYear, careersAll: cmpCareers };

        // Blocchi esclusivi squadra (solo per la pagina DEF): trade, ATS,
        // storia franchigia, storico draft NFL reale della squadra.
        let teamExtras = null;
        if (pos === 'DEF' && abbr) {
            const [trades, ats, history] = await Promise.all([
                getTeamTrades(abbr).catch(() => []),
                getTeamATS(abbr, teamYear).catch(() => null),
                getFranchiseHistory(abbr).catch(() => null),
            ]);
            teamExtras = { trades, ats, history, draftHistory: await getTeamDraftHistory(abbr).catch(() => []) };
            if (location.hash !== myHash) return;
        }

        if (pos === 'DEF') renderDefPage(section, { name, year, pos, abbr, full, career, awards, ctx, advTeam, teamRoster, teamInjuries, teamStarters, teamExtras, teamHistory });
        else renderPlayerPage(section, { name, year, pos, abbr, full, career, awards, projEntry, nextSeasonProj, nextSeason, ctx, advSeasons, advPool, advYear, advPool2, advYear2, advTeam, teamRoster, teamInjuries, teamStarters, playerInjuries, causesByYear, combineDraft, awardsEspn, contract, draftPeers, projByYear, teamHistory, compare, overview, espnExtra, recordsEspn, splits, qbr });
    } catch (e) {
        console.error('[player-page]', e);
        if (location.hash !== myHash) return;
        section.innerHTML = `<div class="section-inner"><div class="empty-state"><p class="empty-state-text">Error loading stats</p></div></div>`;
    }
}

// ─── Pagina giocatore ────────────────────────────────────────────

function renderPlayerPage(section, ctx) {
    const { name, year, pos, abbr, full, career, awards, projEntry, advSeasons, nextSeasonProj, nextSeason } = ctx;
    const seasons = full.seasons; // dalla più recente

    // Identità persistente (recapCard) + barra tab sticky: i blocchi restano gli
    // stessi, raggruppati in pannelli. Nessun cambio di dati/routing — solo UI.
    section.innerHTML = `
    <div class="section-inner gb-page pp-page">
        <a class="gb-back" href="#" data-pp-back><span aria-hidden="true">←</span> Back</a>

        ${recapCard(ctx)}

        <nav class="pp-tabsbar" role="tablist" aria-label="Player card sections">
            <button class="pp-tab is-active" role="tab" aria-selected="true" data-tab="stats">Stats</button>
            <button class="pp-tab" role="tab" aria-selected="false" data-tab="analysis">Analysis</button>
            <button class="pp-tab" role="tab" aria-selected="false" data-tab="news">News</button>
            <button class="pp-tab" role="tab" aria-selected="false" data-tab="bio">Bio</button>
            <button class="pp-tab" role="tab" aria-selected="false" data-tab="splits">Splits</button>
            <button class="pp-tab" role="tab" aria-selected="false" data-tab="gamelog">Game Log</button>
        </nav>

        <div class="pp-tab-panel" role="tabpanel" data-panel="stats">
            ${metricsBlock(seasons, pos, nextSeasonProj, nextSeason, ctx.projByYear)}
            ${categoryTables(seasons, pos)}
            ${careerTotalsPfrBlock(ctx.combineDraft)}
            ${qbrBlock(ctx)}
            ${full.resolved && seasons.length ? '' : noStatsBlock(full, projEntry, year)}
        </div>

        <div class="pp-tab-panel" role="tabpanel" data-panel="analysis" hidden>
            ${advancedRadarBlock(ctx)}
            ${advancedNflverseBlock(advSeasons, pos)}
            ${advancedSlopeBlock(ctx)}
            ${perfExplainBlock(ctx)}
            ${draftScatterBlock(ctx)}
            ${similarPlayersBlock(ctx)}
            ${teamContextCompact(ctx)}
            ${outlookBlock(ctx)}
            ${leagueComparisonBlock(ctx)}
            ${projVsActualBlock({ seasons, projByYear: ctx.projByYear })}
            ${projectionTablesBlock(ctx)}
            ${topinaBoxBlock(career, awards)}
        </div>

        <div class="pp-tab-panel" role="tabpanel" data-panel="news" hidden>
            ${playerNewsBlock(ctx)}
        </div>

        <div class="pp-tab-panel" role="tabpanel" data-panel="bio" hidden>
            ${profiloDetailBlock(ctx)}
            ${careerTeamsBlock(full, ctx.combineDraft)}
            ${recordsBlock(ctx)}
            ${playerInjuriesBlock(ctx)}
        </div>

        <div class="pp-tab-panel" role="tabpanel" data-panel="splits" hidden>
            ${splitsBlock(ctx)}
        </div>

        <div class="pp-tab-panel" role="tabpanel" data-panel="gamelog" hidden>
            ${gamelogBlock(seasons, pos)}
        </div>

        ${footnote()}
    </div>`;

    bindBack(section);
    hydrateHero(section, name, abbr, pos, year);
    hydrateCharts(section);
    bindCategoryTabs(section);
    bindComparisonChart(section, ctx);
    bindViolinHover(section);
    bindFormHover(section);
    bindSimilarPlayers(section);
    bindTabs(section);
}

/**
 * Barra tab della scheda: mostra un pannello per volta (show/hide puro, nessun
 * cambio di hash o di dati). I tab con pannello vuoto — blocchi che rendono ''
 * per mancanza di dati — vengono nascosti così non si aprono su una vista bianca.
 */
function bindTabs(section) {
    const tabs = [...section.querySelectorAll('.pp-tab')];
    const panels = [...section.querySelectorAll('.pp-tab-panel')];
    tabs.forEach(tab => {
        const panel = panels.find(p => p.dataset.panel === tab.dataset.tab);
        if (panel && !panel.textContent.trim()) { tab.hidden = true; panel.hidden = true; }
    });
    const activate = (id) => {
        tabs.forEach(t => {
            const on = t.dataset.tab === id;
            t.classList.toggle('is-active', on);
            t.setAttribute('aria-selected', on ? 'true' : 'false');
        });
        panels.forEach(p => { p.hidden = p.dataset.panel !== id; });
    };
    // Se il primo tab è vuoto, attiva il primo tab davvero disponibile.
    const firstVisible = tabs.find(t => !t.hidden);
    if (firstVisible && !firstVisible.classList.contains('is-active')) activate(firstVisible.dataset.tab);
    tabs.forEach(tab => tab.addEventListener('click', () => {
        activate(tab.dataset.tab);
        // Risali sotto la barra sticky solo se si è già scrollati oltre — così
        // cambiare tab dall'alto non provoca salti.
        const bar = section.querySelector('.pp-tabsbar');
        if (!bar) return;
        const top = bar.getBoundingClientRect().top + window.scrollY - 72;
        if (window.scrollY > top) window.scrollTo({ top, behavior: 'smooth' });
    }));
}

/** Tooltip sul violin plot: mostra i valori della stagione sotto il cursore. */
function bindViolinHover(section) {
    section.querySelectorAll('.pp-bp-chart').forEach(chart => {
        const tip = chart.querySelector('.pp-chart-tip');
        const svg = chart.querySelector('svg');
        if (!tip || !svg) return;
        const move = (e) => {
            const g = e.target.closest('[data-bpv]');
            if (!g) { tip.hidden = true; return; }
            const d = g.dataset;
            tip.innerHTML = d.proj
                ? `<b>${d.year}</b> · projection<br>avg ${d.mean} pts/game`
                : `<b>${d.year}</b> · ${d.n} games<br>avg <b>${d.media}</b> · median <b>${d.med}</b><br>25°–75°: ${d.q1}–${d.q3}<br>min ${d.min} · max ${d.max}`;
            tip.hidden = false;
            const r = chart.getBoundingClientRect();
            const x = e.clientX - r.left, y = e.clientY - r.top;
            tip.style.left = Math.max(4, Math.min(x + 14, r.width - tip.offsetWidth - 6)) + 'px';
            tip.style.top = Math.max(4, y - tip.offsetHeight - 10) + 'px';
        };
        svg.addEventListener('pointermove', move);
        svg.addEventListener('pointerleave', () => { tip.hidden = true; });
    });
}

// Hero alternativo del collega (panini): mantenuto per compatibilità, non
// usato dalla renderPlayerPage corrente che usa recapCard.
function heroBlock({ name, pos, abbr, full, career, year }) {
    const info = full.info;
    const chips = [
        pos ? `<span class="allpro-pos pos-${pos.toLowerCase()}">${pos}</span>` : '',
        abbr ? `<span class="pm-chip"><img class="pp-chip-logo" src="${teamLogo(abbr)}" alt="" onerror="this.style.display='none'">${abbr}</span>` : '',
        info?.age ? `<span class="pm-chip">${info.age} anni</span>` : '',
        info?.college ? `<span class="pm-chip">${esc(info.college)}</span>` : '',
        career?.seasons.size ? `<span class="pm-chip">${career.seasons.size} stagion${career.seasons.size === 1 ? 'e' : 'i'} Topina</span>` : '',
        info?.injury_status ? `<span class="pm-chip pp-chip-injury">${esc(info.injury_status)}</span>` : '',
    ].filter(Boolean).join('');

    return `
    <header class="mosaic-card mc-wide dgt-hero pp-hero mc-in">
        <img class="pp-headshot" src="images/fallback-player.svg" alt="${esc(name)}">
        <div class="dgt-hero-info">
            <span class="mc-kicker">Full card · Draft ${year}</span>
            <h1 class="mc-title">${esc(name)}</h1>
            <div class="pm-chips pp-hero-chips">${chips}</div>
        </div>
        ${career?.sbWins ? `<div class="pm-rings" title="Anelli Super Bowl">SB ×${career.sbWins}</div>` : ''}
    </header>`;
}

function noStatsBlock(full, projEntry, year) {
    const msg = !full.resolved
        ? 'Detailed NFL stats not available for this player (no match on Sleeper).'
        : 'No NFL games recorded: stats available from 2015 onward.';
    return `<section class="pm-block pp-block"><p class="pm-empty">${msg}</p></section>`;
}

export function tile(value, label) {
    return value == null || value === '' ? ''
        : `<div class="pm-tile pp-tile"><span class="pm-tile-value">${value}</span><span class="pm-tile-label">${label}</span></div>`;
}

/** Chip compatto valore+etichetta per la Recap Card (mai una tile grande). */
export function factChip(value, label, cls = '') {
    return value == null || value === '' ? ''
        : `<span class="pp-fact-chip ${cls}"><b>${value}</b>${label ? ` ${esc(label)}` : ''}</span>`;
}

export function factGroup(label, chipsHtml) {
    return chipsHtml ? `
    <div class="pp-fact-group">
        <span class="pp-fact-label">${esc(label)}</span>
        <div class="pp-fact-chips">${chipsHtml}</div>
    </div>` : '';
}

// ─── Recap Card: foto + tutte le info anagrafica/squadra/draft/riconoscimenti ────

/** Conta le occorrenze di un riconoscimento ESPN per nome (es. "Super Bowl MVP" ×2). */
function tallyAwards(awardsEspn) {
    const counts = new Map();
    for (const a of awardsEspn || []) counts.set(a.name, (counts.get(a.name) || 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

function recapCard(ctx) {
    const { name, pos, abbr, full, career, year, combineDraft, awardsEspn, contract, nextSeasonProj, nextSeason, espnExtra } = ctx;
    const info = full.info || {};
    const identity = abbr ? getTeamIdentity(abbr) : null;
    const d = combineDraft?.draft;
    const combine = combineDraft?.combine;
    // Fallback ESPN quando il draft build (PFR) non copre il giocatore.
    const espnDraftChip = !d && espnExtra?.draft?.year
        ? factChip(`${espnExtra.draft.year}`, `Draft NFL · Rd${espnExtra.draft.round ?? '?'} Pick${espnExtra.draft.pick ?? '?'}`, 'pp-fact-chip--accent')
        : '';

    const hIn = parseFloat(info.height);
    const wLb = parseFloat(info.weight);
    const height = hIn ? `${Math.floor(hIn / 12)}'${Math.round(hIn % 12)}"` : (espnExtra?.displayHeight || null);
    // Vitali essenziali: età, altezza/peso, college, esperienza, status, numero.
    // Nascita, high school, combine, contratto e ID sono nel tab Profilo (profiloDetailBlock).
    const vitals = [
        factChip(info.age ?? espnExtra?.age, 'anni'),
        factChip(height, wLb ? `· ${Math.round(wLb)} lbs` : null),
        factChip(info.college ? esc(info.college) : null, null),
        info.years_exp != null ? factChip(`${info.years_exp}`, 'NFL seasons') : '',
        info.status ? factChip(esc(info.status), null) : '',
        info.number != null ? factChip(`#${info.number}`, null) : '',
    ].filter(Boolean).join('');

    // Draft NFL reale + accolades di carriera, in una riga
    const draftChips = [
        d ? factChip(`${d.season}`, `Draft NFL · Rd${d.round} Pick${d.pick} (${d.team})`, 'pp-fact-chip--accent') : espnDraftChip,
        d?.hof ? factChip('HOF', 'Hall of Fame', 'pp-fact-chip--accent') : '',
        d?.allproCareer ? factChip(`×${d.allproCareer}`, 'All-Pro') : '',
        d?.probowlsCareer ? factChip(`×${d.probowlsCareer}`, 'Pro Bowl') : '',
        d?.careerAV ? factChip(d.careerAV, 'Approximate Value') : '',
        d?.posPercentile != null ? factChip(`${d.posPercentile}%`, `tra i ${pos} del draft ${d.season} (${ord(d.posRank)}/${d.posCount})`, 'pp-fact-chip--accent') : '',
    ].filter(Boolean).join('');
    const awardChips = tallyAwards(awardsEspn).map(([n, c]) => factChip(c > 1 ? `×${c}` : '🏆', n, 'pp-fact-chip--accent')).join('');

    // Squadra e ruolo Topina/NFL
    const depth = info.depth_chart_position ? `${esc(info.depth_chart_position)}${info.depth_chart_order ?? ''}` : null;
    const roleChips = [
        info.position ? factChip(esc(info.position), null) : '',
        depth ? factChip(depth, 'depth chart') : '',
        career?.seasons.size ? factChip(career.seasons.size, `stagion${career.seasons.size === 1 ? 'e' : 'i'} Topina`) : '',
    ].filter(Boolean).join('');

    // Prossima stagione (preseason) — sempre in evidenza se disponibile
    const nextProjChips = nextSeasonProj && (nextSeasonProj.projPts != null || nextSeasonProj.ptsStd != null || nextSeasonProj.adp != null) ? [
        factChip(fmt0(nextSeasonProj.projPts ?? nextSeasonProj.ptsStd), 'pt lega proiettati', 'pp-fact-chip--next'),
        nextSeasonProj.adp != null ? factChip(fmt1(nextSeasonProj.adp), 'ADP', 'pp-fact-chip--next') : '',
    ].filter(Boolean).join('') : '';

    const injuryChip = info.injury_status
        ? factChip(esc(info.injury_status), info.injury_body_part ? esc(info.injury_body_part) : null,
            severityClass(info.injury_status) ? 'pp-fact-chip--out' : 'pp-fact-chip--warn')
        : '';

    return `
    <header class="mosaic-card mc-wide pp-hero mc-in">
        <div class="pp-recap">
            <img class="pp-recap-photo" src="images/fallback-player.svg" alt="${esc(name)}">
            <div class="pp-recap-body">
                <div class="pp-recap-name">
                    <span class="mc-kicker">Draft Topina ${year}</span>
                    ${career?.sbWins ? `<span class="pm-rings" title="Anelli Super Bowl">🏆${career.sbWins > 1 ? `×${career.sbWins}` : ''}</span>` : ''}
                </div>
                <h1 class="mc-title">${esc(name)} ${pos ? `<span class="allpro-pos pos-${pos.toLowerCase()}">${pos}</span>` : ''}</h1>
                ${abbr ? `
                <a class="pp-recap-team pp-recap-team--link" href="#nfl-team/${abbr}" title="Go to team page">
                    <img src="${teamLogo(abbr)}" alt="" onerror="this.style.display='none'">
                    <b>${identity ? esc(identity.name) : abbr}</b>
                    ${identity ? `<span class="pp-team-div" style="color:${identity.color}">${esc(identity.division)}</span>` : ''}
                    <span class="pp-recap-team-arrow" aria-hidden="true">→</span>
                </a>` : ''}

                ${factGroup('Bio', vitals)}
                ${factGroup('Position', roleChips)}
                ${factGroup('Real NFL draft and career', draftChips + awardChips)}
                ${nextProjChips ? factGroup(`Prospettive ${nextSeason} (preseason)`, nextProjChips) : ''}
                ${injuryChip ? factGroup('Stato attuale (live, Sleeper)', injuryChip) : ''}
            </div>
        </div>
    </header>`;
}

// ─── Storia squadre di carriera ──────────────────────────────────

/** Squadre per cui il giocatore ha giocato in una stagione (in ordine; più di una = scambio a metà anno). */
function seasonTeams(s) {
    const seen = [];
    for (const g of s.weekly || []) if (g.team && !seen.includes(g.team)) seen.push(g.team);
    if (!seen.length && s.totals?.team) seen.push(s.totals.team);
    return seen;
}

/**
 * Box "Squadre di carriera": timeline anno per anno dalla stagione del draft
 * NFL fino all'ultima con dati. Le stagioni con dati (dal 2015) mostrano la
 * squadra reale gestendo gli scambi a metà anno; le stagioni precedenti o
 * senza dati mostrano la squadra stimata (draft o carry-forward, tratteggiata).
 * Riusa `full.seasons` già caricate — nessuna fetch.
 */
/**
 * Full bio e profilo (tab Profilo): nascita, high school, pratica,
 * combine NFL, contratto (+ storico) e ID esterni — tutto ciò che è stato tolto
 * dall'hero per tenerlo snello. Nessun dato perso, solo spostato.
 */
function profiloDetailBlock(ctx) {
    const { full, combineDraft, contract } = ctx;
    const info = full.info || {};
    const combine = combineDraft?.combine;

    const born = info.birth_date ? new Date(info.birth_date).toLocaleDateString('en-US') : null;
    const birthPlace = [info.birth_city, info.birth_state, info.birth_country].filter(Boolean).join(', ');
    const bioChips = [
        born ? factChip(born, 'nascita') : '',
        birthPlace ? factChip(esc(birthPlace), null) : '',
        info.high_school ? factChip(esc(info.high_school), 'high school') : '',
        info.practice_description ? factChip(esc(info.practice_description), 'practice') : '',
    ].filter(Boolean).join('');

    const combineChips = combine ? [
        combine.forty != null ? factChip(`${combine.forty}s`, '40yd') : '',
        combine.vertical != null ? factChip(`${combine.vertical}"`, 'vertical') : '',
        combine.bench != null ? factChip(`${combine.bench}`, 'bench') : '',
        combine.broadJump != null ? factChip(`${combine.broadJump}"`, 'broad jump') : '',
        combine.cone != null ? factChip(`${combine.cone}s`, '3-cone') : '',
        combine.shuttle != null ? factChip(`${combine.shuttle}s`, 'shuttle') : '',
    ].filter(Boolean).join('') : '';

    const money = (v) => v == null ? null : `$${Math.round(v / 1e6)}M`;
    const isOtc = contract && !Array.isArray(contract);
    const contractArr = Array.isArray(contract) ? contract : null;
    const latestContractYear = contractArr ? (contractArr.find(c => c.active) || contractArr[contractArr.length - 1]) : null;
    const contractChip = isOtc
        ? factChip(money(contract.apy), `APY · ${contract.years} anni · ${money(contract.guaranteed)} garantiti`)
        : (latestContractYear ? factChip(money(latestContractYear.salary), `stipendio ${latestContractYear.season} · scad. ${latestContractYear.signedThrough}`) : '');
    const contractHistory = contractArr && contractArr.length > 1 ? `
        <details class="pp-recap-ids" style="margin-top:6px">
            <summary>Contract history (${contractArr.length} yrs, ESPN)</summary>
            <div class="pm-table-wrap pp-scroll" style="margin-top:8px">
                <table class="pm-table pp-table">
                    <thead><tr><th>Year</th><th>Salary</th><th>Bonus</th><th>Through</th></tr></thead>
                    <tbody>${contractArr.map(c => `<tr><td>${c.season ?? '—'}</td><td>${money(c.salary) ?? '—'}</td><td>${money(c.bonus) ?? '—'}</td><td>${c.signedThrough ?? '—'}</td></tr>`).join('')}</tbody>
                </table>
            </div>
        </details>` : '';

    const idsSummary = [
        info.espn_id ? `<a class="pp-id" href="https://www.espn.com/nfl/player/_/id/${info.espn_id}" target="_blank" rel="noopener">ESPN ${info.espn_id}</a>` : '',
        info.yahoo_id ? `<span class="pp-id">Yahoo ${info.yahoo_id}</span>` : '',
        info.sportradar_id ? `<span class="pp-id">Sportradar ${esc(info.sportradar_id)}</span>` : '',
        info.rotowire_id ? `<span class="pp-id">Rotowire ${info.rotowire_id}</span>` : '',
        info.fantasy_data_id ? `<span class="pp-id">FantasyData ${info.fantasy_data_id}</span>` : '',
        info.player_id ? `<span class="pp-id">Sleeper ${esc(info.player_id)}</span>` : '',
        info.gsis_id ? `<span class="pp-id">GSIS ${esc(info.gsis_id)}</span>` : '',
    ].filter(Boolean).join('');

    const groups = [
        factGroup('Full bio', bioChips),
        factGroup('Combine NFL', combineChips),
        contractChip ? `
        <div class="pp-fact-group">
            <span class="pp-fact-label">Contratto${isOtc ? ' · Over The Cap' : ' · ESPN'}</span>
            <div class="pp-fact-chips">${contractChip}</div>
            ${contractHistory}
        </div>` : '',
        idsSummary ? `
        <div class="pp-fact-group">
            <span class="pp-fact-label">ID esterni</span>
            <div class="pp-ids">${idsSummary}</div>
        </div>` : '',
    ].filter(Boolean).join('');
    if (!groups.trim()) return '';
    return `
    <section class="pm-block pp-block">
        <span class="mc-kicker">Bio and profile</span>
        <div class="pp-recap-body" style="margin-top:10px">${groups}</div>
    </section>`;
}

function careerTeamsBlock(full, combineDraft) {
    if (!full?.seasons?.length) return '';
    const dataByYear = new Map();
    for (const s of full.seasons) { const t = seasonTeams(s); if (t.length) dataByYear.set(s.year, t); }
    if (!dataByYear.size) return '';

    const dataYears = [...dataByYear.keys()].sort((a, b) => a - b);
    const d = combineDraft?.draft;
    const draftYear = d?.season || null;
    const draftTeam = d?.team || null;
    const startYear = Math.min(dataYears[0], draftYear || dataYears[0]);
    const endYear = dataYears[dataYears.length - 1];

    // Un nodo per ogni anno da startYear a endYear (carry-forward per i buchi).
    const nodes = [];
    let lastTeam = draftTeam;
    for (let y = startYear; y <= endYear; y++) {
        if (dataByYear.has(y)) {
            const teams = dataByYear.get(y);
            nodes.push({ year: y, teams, inferred: false });
            lastTeam = teams[teams.length - 1];
        } else {
            const t = y < dataYears[0] ? draftTeam : lastTeam;
            nodes.push({ year: y, teams: t ? [t] : [], inferred: true });
        }
    }

    const distinct = [];
    for (const n of nodes) if (!n.inferred) for (const t of n.teams) if (!distinct.includes(t)) distinct.push(t);

    let prevPrimary = null;
    const html = nodes.map(n => {
        if (!n.teams.length) return '';
        const primary = n.teams[0];
        const color = getTeamIdentity(primary)?.color || 'var(--border-card)';
        const same = primary === prevPrimary;
        prevPrimary = n.teams[n.teams.length - 1];
        const logos = n.teams.map(t => `<img src="${teamLogo(t)}" alt="" onerror="this.style.display='none'">`).join('');
        return `
        <div class="pp-tl-node${n.inferred ? ' pp-tl-node--inferred' : ''}${n.teams.length > 1 ? ' pp-tl-node--multi' : ''}" style="--team:${color};--conn:${same ? color : 'var(--border-subtle)'}"${n.inferred ? ' title="Season with no data: estimated team"' : ''}>
            <span class="pp-tl-logo">${logos}</span>
            <span class="pp-tl-abbr">${esc(n.teams.join('→'))}</span>
            <span class="pp-tl-year">${n.year}</span>
        </div>`;
    }).join('');

    const hasInferred = nodes.some(n => n.inferred && n.teams.length);
    return `
    <section class="pm-block pp-block pp-cth">
        <span class="mc-kicker">Career teams · ${draftYear ? `since the ${draftYear} draft · ` : ''}${distinct.length} ${distinct.length === 1 ? 'franchise' : 'franchises'}</span>
        <div class="pp-tl pp-scroll">${html}</div>
        <p class="pm-note">Year-by-year timeline from the NFL draft season; per-season stats from ${FIRST_STATS_YEAR}.${hasInferred ? ' Dashed seasons (earlier or without data) show the estimated team.' : ''} Multiple logos in the same year = in-season trade.</p>
    </section>`;
}

/** Riquadro "In Topina": carriera nella lega + bacheca premi in un unico box, sotto le squadre di carriera. */
function topinaBoxBlock(career, awards) {
    return `
    <section class="pm-block pp-block pp-topina-box">
        <span class="mc-kicker pp-topina-title">In Topina</span>
        ${topinaBlock(career)}
        ${awardsBlock(career, awards)}
    </section>`;
}

/**
 * Outlook Rotowire, prossima partita e ultime notizie (ESPN overview).
 * Categorie che né Sleeper né il build espongono.
 */
/** Outlook Rotowire + prossima partita (senza notizie: quelle vanno nel tab News). */
function outlookBlock({ overview }) {
    if (!overview) return '';
    const { rotowire, nextGame } = overview;

    const nextHtml = nextGame?.date ? `
        <div class="pp-nextgame">
            <span class="mc-kicker">Next game</span>
            <b>${esc(nextGame.name || '—')}</b>
            <span class="pm-note" style="margin-top:2px">${[nextGame.week, new Date(nextGame.date).toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' })].filter(Boolean).join(' · ')}</span>
        </div>` : '';

    const rwHtml = rotowire?.story ? `
        <div class="pp-outlook">
            <span class="mc-kicker">Outlook · Rotowire</span>
            ${rotowire.headline ? `<b>${esc(rotowire.headline)}</b>` : ''}
            <p class="pp-outlook-story">${esc(rotowire.story)}</p>
            ${rotowire.published ? `<span class="pm-note">Aggiornato ${new Date(rotowire.published).toLocaleDateString('en-US')}</span>` : ''}
        </div>` : '';

    if (!nextHtml && !rwHtml) return '';
    return `
    <section class="pm-block pp-block">
        ${nextHtml}${rwHtml}
        <p class="pm-note">Rotowire outlook and next game from live ESPN.</p>
    </section>`;
}

/** Ultime notizie ESPN sul giocatore (tab News). Auto-nascosto se ESPN non ne restituisce. */
function playerNewsBlock({ overview }) {
    const news = overview?.news;
    if (!news?.length) return '';
    return `
    <section class="pm-block pp-block">
        <span class="mc-kicker">Latest news · ESPN</span>
        <ul class="pp-news-list">${news.map(n => `
            <li>${n.link ? `<a href="${esc(n.link)}" target="_blank" rel="noopener">${esc(n.headline)}</a>` : esc(n.headline)}${n.published ? ` <span class="pm-note">· ${new Date(n.published).toLocaleDateString('en-US')}</span>` : ''}</li>`).join('')}</ul>
    </section>`;
}

/** Total QBR stagionale ESPN (solo QB): rating 0-100 + rank. */
function qbrBlock({ qbr, ctx }) {
    if (!qbr || qbr.qbr == null) return '';
    const season = ctx?.season || '';
    return `
    <section class="pm-block pp-block">
        <span class="mc-kicker">Total QBR · ESPN ${season}</span>
        <div class="pm-tiles pp-tiles">
            ${tile(fmt1(qbr.qbr), 'Total QBR (0-100)')}
            ${qbr.rank != null ? tile(ord(qbr.rank), 'Rank tra i QB') : ''}
        </div>
        <p class="pm-note">ESPN Total QBR: 0-100 summary of the QB's impact (passing, rushing, penalties), adjusted for play context.</p>
    </section>`;
}

/**
 * Split statistici ESPN (casa/trasferta, per avversario, per condizione).
 * Tabelle per gruppo con le colonne native ESPN.
 */
/** Small multiple di un gruppo di split: mini-barre orizzontali sulla prima
 *  colonna numerica confrontabile. `null` se nessuna colonna è numerica pura. */
function _splitMini(g, labels) {
    const numCol = labels.findIndex((_, ci) =>
        g.rows.length && g.rows.every(r => {
            const v = r.stats[ci];
            return v != null && /^-?\d+([.,]\d+)?$/.test(String(v).trim());
        }));
    if (numCol < 0) return null;
    const vals = g.rows.map(r => parseFloat(String(r.stats[numCol]).replace(',', '.')));
    const max = Math.max(...vals.map(v => Math.abs(v)), 1);
    const bars = g.rows.map((r, i) => `
        <div class="pp-split-row">
            <span class="pp-split-lbl">${esc(r.label)}</span>
            <span class="pp-split-track"><span class="pp-split-fill" style="width:${Math.max(3, Math.abs(vals[i]) / max * 100).toFixed(0)}%"></span></span>
            <span class="pp-split-val">${esc(String(r.stats[numCol]))}</span>
        </div>`).join('');
    return `<div class="pp-split-mini"><span class="pp-split-metric">${esc(labels[numCol])}</span>${bars}</div>`;
}

function splitsBlock({ splits }) {
    if (!splits?.groups?.length) return '';
    const cols = splits.labels || [];
    const tableOf = (g) => `
        <div class="pm-table-wrap pp-scroll">
            <table class="pm-table pp-table">
                <thead><tr><th>Split</th>${cols.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead>
                <tbody>${g.rows.map(r => `<tr><td>${esc(r.label)}</td>${r.stats.map(v => `<td>${esc(v)}</td>`).join('')}</tr>`).join('')}</tbody>
            </table>
        </div>`;
    const groupHtml = (g) => {
        const mini = _splitMini(g, cols);
        return `
        <div class="pp-statcat">
            <h3 class="pp-cat-title">${esc(g.name)}</h3>
            ${mini ? `${mini}<details class="pp-recap-ids" style="margin-top:8px"><summary>All columns</summary><div style="margin-top:8px">${tableOf(g)}</div></details>` : tableOf(g)}
        </div>`;
    };
    const primary = splits.groups.slice(0, 2);
    const rest = splits.groups.slice(2);
    return `
    <section class="pm-block pp-block">
        <span class="mc-kicker">Stat splits · ESPN</span>
        ${primary.map(groupHtml).join('')}
        ${rest.length ? `<details class="pp-recap-ids" style="margin-top:6px"><summary>Other splits (${rest.length})</summary>${rest.map(groupHtml).join('')}</details>` : ''}
        <p class="pm-note">Stat breakdown by home/away, opponent and conditions (ESPN, current season). The mini-bars compare splits on the first numeric metric; the full detail is in "All columns".</p>
    </section>`;
}

/** Record di carriera ESPN (spesso vuoto per la NFL: nascosto se assente). */
function recordsBlock({ recordsEspn }) {
    if (!recordsEspn?.length) return '';
    return `
    <section class="pm-block pp-block">
        <span class="mc-kicker">Career record · ESPN</span>
        <ul class="pp-awards-list">${recordsEspn.map(r => `<li><b>${esc(r.value ?? '')}</b> ${esc(r.name)}</li>`).join('')}</ul>
    </section>`;
}

// ─── Compagni di squadra e infortuni squadra ─────────────────────

/** Formazione titolare (attacco/difesa) dall'ultimo depth chart della stagione. */
export function startersBlock({ teamStarters, abbr }) {
    if (!teamStarters) return '';
    const side = (list, label) => {
        if (!list?.length) return '';
        const rows = list.map(p => `
            <div class="pp-starter-row">
                <span class="pp-lb-pos">${esc(p.pos || '')}</span>
                <span class="pp-starter-name">${esc(p.name || '—')}</span>
                ${p.fpgLeague != null ? `<span class="pp-starter-val">${fmt1(p.fpgLeague)} pt/gara</span>` : ''}
            </div>`).join('');
        return `<div class="pp-starters-col"><h3 class="pp-cat-title">${label}</h3>${rows}</div>`;
    };
    const html = side(teamStarters.offense, 'Starting offense') + side(teamStarters.defense, 'Starting defense');
    if (!html) return '';
    return `
    <section class="pm-block pp-block">
        <span class="mc-kicker">Starting lineup · ${abbr}</span>
        <div class="pp-starters-grid">${html}</div>
        <p class="pm-note">${teamStarters.source === 'espn-live' ? 'Live depth chart (ESPN) — the requested season is not covered yet by the periodic nflverse build.' : 'Latest available regular-season depth chart (nflverse).'} Pt lega/gara solo dove il dato fantasy esiste (ruoli offensivi).</p>
    </section>`;
}

/** Tabella "rosa completa con statistiche" dentro un <details> — condivisa dai
 *  Compagni di squadra (pagina giocatore) e dal blocco depth chart della pagina
 *  squadra (dove il click allarga il blocco alla rosa intera). */
export function rosterTableDetails(teamRoster, summaryLabel) {
    const heightDisplay = (h) => {
        const hIn = parseFloat(h);
        return hIn ? `${Math.floor(hIn / 12)}'${Math.round(hIn % 12)}"` : '—';
    };
    // Esperienza: 0 = rookie ("R"), altrimenti anni. Stipendio: base ESPN, compatto.
    const expDisplay = (y) => y == null ? '—' : (y === 0 ? 'R' : String(y));
    const salaryDisplay = (v) => {
        if (v == null) return '—';
        if (v >= 1e6) return `$${(v / 1e6).toFixed(2).replace(/\.?0+$/, '')}M`;
        if (v >= 1e3) return `$${Math.round(v / 1e3)}k`;
        return `$${v}`;
    };
    const allRows = teamRoster.players.map(p => `
        <tr>
            <td>${esc(p.name)}</td><td>${esc(p.pos || '—')}</td>
            <td>${p.jersey != null ? `#${p.jersey}` : '—'}</td>
            <td>${p.status ? esc(p.status) : '—'}</td>
            <td>${expDisplay(p.yearsExp)}</td>
            <td>${salaryDisplay(p.salary)}</td>
            <td>${p.snapPct != null ? fmt1(p.snapPct) + '%' : '—'}</td>
            <td>${p.fpgLeague != null ? fmt1(p.fpgLeague) : '—'}</td>
            <td>${p.college ? esc(p.college) : '—'}</td>
            <td>${p.height ? heightDisplay(p.height) : '—'}${p.weight ? ` · ${p.weight}lbs` : ''}${p.age != null ? ` · ${p.age}a` : ''}</td>
            <td>${p.draftClub && p.draftNumber ? `${esc(p.draftClub)} #${p.draftNumber}` : (p.rookieYear ? `UDFA ${p.rookieYear}` : '—')}</td>
        </tr>`).join('');
    return `
        <details class="pp-recap-ids" style="margin-top:14px">
            <summary>${summaryLabel || `Full roster (${teamRoster.players.length} players)`}</summary>
            <div class="pm-table-wrap pp-scroll" style="margin-top:10px">
                <table class="pm-table pp-table">
                    <thead><tr><th>Name</th><th>Pos</th><th>Jersey</th><th>Status</th><th>Exp</th><th>Salary</th><th>Snap%</th><th>League pts/game</th><th>College</th><th>Measurables</th><th>Draft</th></tr></thead>
                    <tbody>${allRows}</tbody>
                </table>
            </div>
        </details>`;
}

/** Leaderboard skill player per uso/pt-lega (meter), + rosa completa in un dettaglio. */
export function teammatesBlock({ teamRoster, abbr }) {
    if (!teamRoster?.players?.length) return '';
    const withUsage = teamRoster.players.filter(p => p.fpgLeague != null).sort((a, b) => b.fpgLeague - a.fpgLeague);
    const maxFpg = Math.max(...withUsage.map(p => p.fpgLeague), 1);
    const lbRows = withUsage.slice(0, 12).map(p => `
        <div class="dgt-sos-bar pp-lb-row">
            <span class="pp-lb-name">${p.headshot ? `<img class="pp-lb-face" src="${esc(p.headshot)}" alt="" loading="lazy" onerror="this.style.display='none'">` : ''}<span class="pp-lb-pos">${esc(p.pos)}</span><b>${esc(p.name)}</b></span>
            <span class="dgt-sos-track"><span style="width:${Math.max(4, p.fpgLeague / maxFpg * 100)}%"></span></span>
            <span class="dgt-sos-val">${fmt1(p.fpgLeague)}</span>
        </div>`).join('');

    return `
    <section class="pm-block pp-block">
        <span class="mc-kicker">Teammates · ${abbr}</span>
        ${lbRows ? `<div class="dgt-sos-bars" style="grid-template-columns:1fr">${lbRows}</div>` : ''}
        ${rosterTableDetails(teamRoster)}
        <p class="pm-note">${teamRoster.source === 'espn-live' ? 'Live roster (ESPN) — the requested season is not covered yet by the periodic nflverse build.' : 'League pts/game and snap% available only for offensive positions (QB/RB/WR/TE/K); the rest of the roster is in the full table.'}</p>
    </section>`;
}

/** Ultimo report infortuni della squadra nella stagione, righe compatte. */
/**
 * Raggruppa le settimane consecutive con lo stesso infortuno (report o
 * allenamento) in un'unica voce di cronologia — così "toe W3-W7, hip
 * W12-W19" invece di 15 righe quasi identiche.
 */
export function groupInjuryWeeks(weeks) {
    const groups = [];
    for (const w of weeks || []) {
        const injury = w.primaryInjury || w.practicePrimaryInjury;
        if (!injury) continue; // settimana senza infortunio noto: salto (non un "gruppo")
        const last = groups[groups.length - 1];
        if (last && last.injury === injury && w.week - last.to <= 2) {
            last.to = w.week;
            last.weeks.push(w);
        } else {
            groups.push({ injury, from: w.week, to: w.week, weeks: [w] });
        }
    }
    return groups;
}

/** Cronologia infortuni di un giocatore: quando, cosa, se poi è rientrato. */
export function injuryHistoryDetails(weeks) {
    const groups = groupInjuryWeeks(weeks);
    if (groups.length <= 1) return '';
    const rows = groups.map((g, i) => {
        const statuses = [...new Set(g.weeks.map(w => w.status).filter(Boolean))];
        const range = g.from === g.to ? `W${g.from}` : `W${g.from}–W${g.to}`;
        const returned = i < groups.length - 1 ? ' <span style="color:var(--accent-green)">· rientrato</span>' : '';
        return `<div class="pp-inj-hist-row"><b>${range}</b> ${esc(g.injury)}${statuses.length ? ` · ${statuses.map(esc).join(' → ')}` : ' · managed, never in doubt for a game'}${returned}</div>`;
    }).join('');
    return `
    <details class="pp-recap-ids" style="margin-top:2px">
        <summary>Season history (${groups.length} injuries)</summary>
        ${rows}
    </details>`;
}

/**
 * Timeline disponibilità: una striscia W1→Wfine per i giocatori che hanno avuto
 * una designazione (Out/Doubtful/Questionable) nella stagione — un segmento per
 * settimana colorato per stato, vuoto = non nel report (disponibile). Richiede i
 * report settimanali (fonte nflverse); '' con la sola fonte ESPN dal vivo.
 */
function _availabilityTimeline(players) {
    const sev = s => /out|injured reserve|reserve|\bpup\b/i.test(s || '') ? 3 : /doubtful/i.test(s || '') ? 2 : /questionable/i.test(s || '') ? 1 : (s ? 0.5 : 0);
    const withWeeks = (players || []).filter(p => (p.weeks?.length || 0) >= 1);
    if (!withWeeks.length) return '';
    const maxWeek = Math.max(1, ...withWeeks.flatMap(p => p.weeks.map(w => +w.week || 0)));
    const rows = withWeeks.map(p => ({
        p, byWeek: new Map(p.weeks.map(w => [+w.week, w])),
        maxSev: Math.max(0, ...p.weeks.map(w => sev(w.status))),
    })).filter(r => r.maxSev >= 1).sort((a, b) => b.maxSev - a.maxSev).slice(0, 14);
    if (!rows.length) return '';
    const weeks = Array.from({ length: maxWeek }, (_, i) => i + 1);
    const cls = w => { if (!w) return 'av-none'; const s = sev(w.status); return s >= 3 ? 'av-out' : s >= 2 ? 'av-doubt' : s >= 1 ? 'av-quest' : 'av-none'; };
    const head = `<div class="pp-av-row pp-av-head"><span class="pp-av-name"></span><span class="pp-av-track">${weeks.map(w => `<i class="pp-av-wk">${w % 2 === 1 ? w : ''}</i>`).join('')}</span></div>`;
    const body = rows.map(({ p, byWeek }) => {
        const cells = weeks.map(w => {
            const e = byWeek.get(w);
            return `<i class="pp-av-cell ${cls(e)}" title="${esc(`W${w}${e ? ' · ' + (e.status || e.primaryInjury || 'in report') : ' · available'}`)}"></i>`;
        }).join('');
        return `<div class="pp-av-row"><span class="pp-av-name"><span class="pp-lb-pos">${esc(p.pos || '')}</span>${esc(p.name)}</span><span class="pp-av-track">${cells}</span></div>`;
    }).join('');
    const legend = `<div class="pp-av-legend"><span><i class="pp-av-cell av-out"></i>Out/IR</span><span><i class="pp-av-cell av-doubt"></i>Doubtful</span><span><i class="pp-av-cell av-quest"></i>Questionable</span><span><i class="pp-av-cell av-none"></i>available</span></div>`;
    return `<div class="pp-av-wrap"><h3 class="pp-cat-title">Season availability</h3>${legend}<div class="pm-table-wrap pp-scroll"><div class="pp-av">${head}${body}</div></div><p class="pm-note">Who had an injury designation, week by week. Empty = not on the report (available). Hover a cell for details.</p></div>`;
}

export function teamInjuriesBlock({ teamInjuries, abbr }) {
    if (!teamInjuries?.players?.length) return '';
    // card ordinate per gravità (Out/IR prima), con stripe di severità a colore.
    const sevRank = (s) => /out|injured reserve|reserve|\bpup\b/i.test(s || '') ? 3 : /doubtful/i.test(s || '') ? 2 : /questionable/i.test(s || '') ? 1 : 0;
    const sorted = [...teamInjuries.players].sort((a, b) => sevRank(b.status) - sevRank(a.status));
    const cardOf = (p) => {
        // designazione in allenamento: si mostra solo se aggiunge informazione
        // (spesso coincide col report ufficiale — niente ripetizione inutile)
        const practiceInjury = [p.practicePrimaryInjury, p.practiceSecondaryInjury].filter(Boolean).join(', ');
        const showPracticeInjury = practiceInjury && practiceInjury !== [p.primaryInjury, p.secondaryInjury].filter(Boolean).join(', ');
        const updated = p.dateModified ? new Date(p.dateModified).toLocaleDateString('en-US') : null;
        const injury = [p.primaryInjury, p.secondaryInjury].filter(Boolean).join(', ');
        const sv = sevRank(p.status);
        const sevKey = sv >= 3 ? 'out' : sv === 2 ? 'doubt' : sv === 1 ? 'quest' : 'ok';
        const detail = `${injury ? esc(injury) : ''}${p.practiceStatus ? `${injury ? ' · ' : ''}${esc(p.practiceStatus)}` : ''}${showPracticeInjury ? ` <small>(all.: ${esc(practiceInjury)})</small>` : ''}${updated ? ` <small>· agg. W${p.week ?? '?'}</small>` : ''}`;
        return `
        <div class="pp-injc pp-injc--${sevKey}">
            <div class="pp-injc-top">
                <span class="pp-injc-name"><span class="pp-lb-pos">${esc(p.pos || '')}</span> ${esc(p.name)}</span>
                ${p.status ? `<span class="pp-inj-status${severityClass(p.status)}">${esc(p.status)}</span>` : ''}
            </div>
            ${detail.trim() ? `<div class="pp-injc-det">${detail}</div>` : ''}
            ${injuryHistoryDetails(p.weeks)}
        </div>`;
    };
    const concerns = sorted.filter(p => sevRank(p.status) >= 1);
    const rest = sorted.filter(p => sevRank(p.status) < 1);
    const mainGrid = concerns.length
        ? `<div class="pp-injc-grid">${concerns.map(cardOf).join('')}</div>`
        : '<p class="pm-note">No player with an Out/Doubtful/Questionable designation in the latest report.</p>';
    const restGrid = rest.length
        ? `<details class="pp-recap-ids" style="margin-top:10px"><summary>Altri ${rest.length} · partecipazione piena / rientrati</summary><div class="pp-injc-grid" style="margin-top:10px">${rest.map(cardOf).join('')}</div></details>`
        : '';
    return `
    <section class="pm-block pp-block">
        <span class="mc-kicker">Team injury report · ${abbr}</span>
        ${_availabilityTimeline(teamInjuries.players)}
        ${mainGrid}${restGrid}
        <p class="pm-note">${teamInjuries.source === 'espn-live'
            ? 'Live report (ESPN) — current status only, no season history available for this source.'
            : `Latest status of each player in the injury report for the whole regular season (through W${Math.max(...teamInjuries.players.map(p => p.week || 0))}); open "Season history" to see when he got hurt, with what, and whether he returned.`}</p>
    </section>`;
}

/** Severità testuale → peso (per scegliere lo stato peggiore di un gruppo). */
const injSeverity = (s) => /out|injured reserve|reserve|\bpup\b/i.test(s || '') ? 3 : /doubtful/i.test(s || '') ? 2 : /questionable/i.test(s || '') ? 1 : 0;

/**
 * Storico infortuni personale del giocatore, stagione per stagione (report
 * settimanali ufficiali nflverse, dal 2019). Raggruppa le settimane consecutive
 * con lo stesso problema e stima le gare saltate dalle settimane Out / IR.
 */
function playerInjuriesBlock({ playerInjuries }) {
    if (!playerInjuries?.length) return '';
    // designazioni che NON sono infortuni (riposo veterani, motivi personali…)
    const NOT_INJURY = /not injury related|resting|personal|coach|load management|rest\b/i;
    const seasons = playerInjuries.map(({ year, team, weeks }) => {
        const groups = groupInjuryWeeks(weeks).filter(g => !NOT_INJURY.test(g.injury));
        const injuries = [...new Set(groups.map(g => g.injury))]; // problemi distinti della stagione
        const anyOut = groups.some(g => g.weeks.some(w => injSeverity(w.status) >= 3));
        return { year, team, groups, injuries, anyOut, clean: groups.length === 0 };
    });

    // Nessun infortunio in nessuna stagione nota → profilo affidabile.
    if (seasons.every(s => s.clean)) {
        const yrs = seasons.map(s => s.year);
        return `
        <section class="pm-block pp-block">
            <span class="mc-kicker">Injury history</span>
            <p class="pm-note">Nessun infortunio nei report ufficiali ${Math.min(...yrs)}–${Math.max(...yrs)}: profilo finora molto affidabile.</p>
        </section>`;
    }

    const rows = seasons.map(s => {
        const summary = s.clean ? 'no injuries reported'
            : s.injuries.join(', ') + (s.anyOut ? ' · ha saltato gare' : '');
        const head = `<div class="pp-inj-yr-head"><b>${s.year}</b> <span class="pp-lb-pos">${esc(s.team)}</span> · ${esc(summary)}</div>`;
        const gRows = s.groups.map((g, i) => {
            const worst = [...new Set(g.weeks.map(w => w.status).filter(Boolean))].sort((a, b) => injSeverity(b) - injSeverity(a))[0] || null;
            const range = g.from === g.to ? `W${g.from}` : `W${g.from}–W${g.to}`;
            const returned = i < s.groups.length - 1 ? ' <span class="pp-inj-back">· rientrato</span>' : '';
            return `<div class="pp-inj-hist-row"><b>${range}</b> ${esc(g.injury)}${worst ? ` <span class="pp-inj-status${severityClass(worst)}">${esc(worst)}</span>` : ''}${returned}</div>`;
        }).join('');
        return `<div class="pp-inj-yr">${head}${gRows}</div>`;
    }).join('');

    return `
    <section class="pm-block pp-block">
        <span class="mc-kicker">Injury history · season by season</span>
        ${rows}
        <p class="pm-note">From official weekly injury reports (nflverse, since 2019): when he appeared on the report and with what issue. Consecutive weeks with the same injury are merged. Note: long absences from <b>Injured Reserve</b> possono non comparire come "Out" nel report.</p>
    </section>`;
}

// ─── Mini grafico a linee (SVG, stesse classi an-* del resto del sito) ────

const TC = { w: 700, h: 220, l: 40, r: 16, t: 14, b: 26 };

function niceTicks(min, max, count = 4) {
    const span = max - min || 1;
    const step = Math.pow(10, Math.floor(Math.log10(span / count)));
    const err = span / count / step;
    const mult = err >= 7.5 ? 10 : err >= 3.5 ? 5 : err >= 1.5 ? 2 : 1;
    const s = mult * step;
    const lo = Math.floor(min / s) * s;
    const hi = Math.ceil(max / s) * s;
    const ticks = [];
    for (let v = lo; v <= hi + 1e-9; v += s) ticks.push(v);
    return ticks;
}

/**
 * Linea singola su asse x categoriale (una label per punto: anni o settimane).
 * points: [{ x, y, gp?, projected? }]. Il tratto verso un punto `projected`
 * è tratteggiato — stesso linguaggio delle proiezioni già usato altrove nel
 * sito (dgt-alt-line in draftgrade-team.js).
 */
export function buildTrendChart(points, color, chartId, unit = 'pt/gara') {
    const vals = points.map(p => p.y).filter(v => v != null);
    if (vals.length < 2) return '';
    const ticks = niceTicks(Math.min(...vals), Math.max(...vals));
    const yMin = ticks[0], yMax = ticks[ticks.length - 1];
    const plotW = TC.w - TC.l - TC.r, plotH = TC.h - TC.t - TC.b;
    const x = i => TC.l + (points.length > 1 ? (i / (points.length - 1)) * plotW : plotW / 2);
    const y = v => TC.t + (1 - (v - yMin) / (yMax - yMin || 1)) * plotH;

    const grid = ticks.map(v => `
        <line x1="${TC.l}" y1="${y(v)}" x2="${TC.l + plotW}" y2="${y(v)}" class="an-gridline"/>
        <text x="${TC.l - 8}" y="${y(v) + 3}" class="an-tick" text-anchor="end">${fmt1(v)}</text>`).join('');
    const xTicks = points.map((p, i) => `<text x="${x(i)}" y="${TC.h - 8}" class="an-tick" text-anchor="middle">${esc(String(p.x))}</text>`).join('');

    // Stile "analysis" (Distacco cumulativo): polyline pulita continua, niente
    // pallini intermedi, solo un pallino a fine linea. Il tratto proiettato
    // (preseason) resta tratteggiato con pallino vuoto.
    const P = points.map((p, i) => ({ i, y: p.y, projected: !!p.projected })).filter(p => p.y != null);
    const solidP = P.filter(p => !p.projected);
    const projP = P.filter(p => p.projected);
    const poly = solidP.length >= 2
        ? `<polyline points="${solidP.map(p => `${x(p.i).toFixed(1)},${y(p.y).toFixed(1)}`).join(' ')}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`
        : '';
    const lastSolid = solidP[solidP.length - 1];
    const dashed = projP.map((p, k) => {
        const from = k === 0 ? lastSolid : projP[k - 1];
        return from ? `<line x1="${x(from.i).toFixed(1)}" y1="${y(from.y).toFixed(1)}" x2="${x(p.i).toFixed(1)}" y2="${y(p.y).toFixed(1)}" stroke="${color}" stroke-width="2" stroke-dasharray="5 4" stroke-linecap="round"/>` : '';
    }).join('');
    const endDots = [
        lastSolid ? `<circle cx="${x(lastSolid.i).toFixed(1)}" cy="${y(lastSolid.y).toFixed(1)}" r="4" fill="${color}" stroke="#000" stroke-width="2"/>` : '',
        ...projP.map(p => `<circle cx="${x(p.i).toFixed(1)}" cy="${y(p.y).toFixed(1)}" r="4.5" fill="transparent" stroke="${color}" stroke-width="2"/>`),
    ].join('');

    const dataAttr = JSON.stringify(points).replace(/'/g, '&#39;');
    return `
    <div class="an-chart" id="${chartId}" data-points='${dataAttr}' data-color="${color}" data-unit="${esc(unit)}">
        <svg viewBox="0 0 ${TC.w} ${TC.h}" class="an-svg">
            ${grid}${xTicks}${poly}${dashed}${endDots}
            <line class="an-crosshair" x1="0" y1="${TC.t}" x2="0" y2="${TC.t + plotH}" visibility="hidden"/>
            <rect class="an-hit" x="${TC.l}" y="${TC.t}" width="${plotW}" height="${plotH}" fill="transparent"/>
        </svg>
        <div class="an-chart-tooltip" hidden></div>
    </div>`;
}

function positionTooltip(container, tooltip, e) {
    const rect = container.getBoundingClientRect();
    let tx = e.clientX - rect.left + 14;
    const ty = e.clientY - rect.top - 10;
    const tw = tooltip.offsetWidth || 140;
    if (tx + tw > rect.width - 4) tx = e.clientX - rect.left - tw - 14;
    tooltip.style.left = `${tx}px`;
    tooltip.style.top = `${ty}px`;
}

function bindTrendChart(container, unit = container.dataset.unit) {
    const svg = container.querySelector('svg');
    const tooltip = container.querySelector('.an-chart-tooltip');
    const crosshair = svg?.querySelector('.an-crosshair');
    const hit = svg?.querySelector('.an-hit');
    if (!hit) return;
    const points = JSON.parse(container.dataset.points);
    const color = container.dataset.color;
    const plotW = TC.w - TC.l - TC.r;
    const xFor = i => TC.l + (points.length > 1 ? (i / (points.length - 1)) * plotW : plotW / 2);

    hit.addEventListener('pointermove', (e) => {
        const rect = svg.getBoundingClientRect();
        const scale = TC.w / rect.width;
        const px = (e.clientX - rect.left) * scale;
        let nearest = 0, best = Infinity;
        points.forEach((p, i) => { const dist = Math.abs(xFor(i) - px); if (dist < best) { best = dist; nearest = i; } });
        const p = points[nearest];
        if (p.y == null) { tooltip.hidden = true; return; }
        const cx = xFor(nearest);
        crosshair.setAttribute('x1', cx); crosshair.setAttribute('x2', cx);
        crosshair.setAttribute('visibility', 'visible');

        tooltip.replaceChildren();
        const title = document.createElement('div');
        title.className = 'an-tt-title';
        title.textContent = p.x;
        const row = document.createElement('div');
        row.className = 'an-tt-row';
        const key = document.createElement('span');
        key.className = 'an-tt-key';
        key.style.background = color;
        const val = document.createElement('b');
        val.textContent = `${fmt1(p.y)}${unit ? ` ${unit}` : ''}`;
        const name = document.createElement('span');
        name.className = 'an-tt-name';
        name.textContent = p.extra || (p.projected ? 'preseason projection' : (p.gp != null ? `${p.gp} games` : ''));
        row.append(key, val, name);
        tooltip.appendChild(row);
        tooltip.hidden = false;
        positionTooltip(container, tooltip, e);
    });
    hit.addEventListener('pointerleave', () => {
        crosshair.setAttribute('visibility', 'hidden');
        tooltip.hidden = true;
    });
}

// ─── Grafico a barre raggruppate (proiettato vs reale per anno) ─────────

const BC2 = { w: 700, h: 220, l: 40, r: 16, t: 14, b: 26 };

function barPathRound(x, y, w, h, r) {
    if (h <= 0) return '';
    const rr = Math.min(r, w / 2, h);
    return `M${x},${y + h} V${y + rr} Q${x},${y} ${x + rr},${y} H${x + w - rr} Q${x + w},${y} ${x + w},${y + rr} V${y + h} Z`;
}

/** rows: [{ x, projected, actual }]. Due barre per gruppo, stesso stile di .an-bar. */
function buildGroupedBarChart(rows, chartId) {
    const vals = rows.flatMap(r => [r.projected, r.actual]).filter(v => v != null);
    if (!vals.length) return '';
    const ticks = niceTicks(0, Math.max(...vals));
    const yMax = ticks[ticks.length - 1] || 1;
    const plotW = BC2.w - BC2.l - BC2.r, plotH = BC2.h - BC2.t - BC2.b;
    const groupW = plotW / rows.length;
    const barW = Math.min(20, (groupW - 16) / 2);
    const y = v => BC2.t + (1 - v / yMax) * plotH;

    const grid = ticks.map(v => `
        <line x1="${BC2.l}" y1="${y(v)}" x2="${BC2.l + plotW}" y2="${y(v)}" class="an-gridline"/>
        <text x="${BC2.l - 8}" y="${y(v) + 3}" class="an-tick" text-anchor="end">${fmt0(v)}</text>`).join('');
    const xLabels = rows.map((r, i) => `<text x="${BC2.l + i * groupW + groupW / 2}" y="${BC2.h - 8}" class="an-tick" text-anchor="middle">${r.x}</text>`).join('');

    const bars = rows.map((r, i) => {
        const groupX = BC2.l + i * groupW;
        const start = groupX + (groupW - (barW * 2 + 4)) / 2;
        const proj = r.projected != null ? `<path d="${barPathRound(start, y(r.projected), barW, BC2.t + plotH - y(r.projected), 2)}"
            class="an-bar" fill="var(--text-muted)" data-label="Proiettati ${r.x}" data-val="${r.projected.toFixed(1)}" data-color="var(--text-muted)"/>` : '';
        const act = r.actual != null ? `<path d="${barPathRound(start + barW + 4, y(r.actual), barW, BC2.t + plotH - y(r.actual), 2)}"
            class="an-bar" fill="#B8433A" data-label="Reali ${r.x}" data-val="${r.actual.toFixed(1)}" data-color="#B8433A"/>` : '';
        return proj + act;
    }).join('');

    return `
    <div class="an-chart-legend">
        <span class="an-legend-item"><span class="an-legend-key" style="background:var(--text-muted)"></span>Projected (preseason)</span>
        <span class="an-legend-item"><span class="an-legend-key" style="background:#B8433A"></span>Reali</span>
    </div>
    <div class="an-chart" id="${chartId}" data-chart="bars">
        <svg viewBox="0 0 ${BC2.w} ${BC2.h}" class="an-svg">${grid}${xLabels}${bars}</svg>
        <div class="an-chart-tooltip" hidden></div>
    </div>`;
}

function bindBarTooltip(container) {
    const svg = container.querySelector('svg');
    const tooltip = container.querySelector('.an-chart-tooltip');
    svg.addEventListener('pointermove', (e) => {
        const bar = e.target.closest('.an-bar');
        if (!bar) { tooltip.hidden = true; return; }
        tooltip.replaceChildren();
        const row = document.createElement('div');
        row.className = 'an-tt-row';
        const key = document.createElement('span');
        key.className = 'an-tt-key';
        key.style.background = bar.dataset.color;
        const val = document.createElement('b');
        val.textContent = fmt1(+bar.dataset.val);
        const name = document.createElement('span');
        name.className = 'an-tt-name';
        name.textContent = bar.dataset.label;
        row.append(key, val, name);
        tooltip.appendChild(row);
        tooltip.hidden = false;
        positionTooltip(container, tooltip, e);
    });
    svg.addEventListener('pointerleave', () => { tooltip.hidden = true; });
}

// ─── Scatter (pick draft vs AV carriera, evidenziato il giocatore) ───────

const SC2 = { w: 700, h: 260, l: 44, r: 16, t: 16, b: 30 };

function buildDraftScatterChart(peers, highlightName, chartId) {
    const withAV = peers.filter(p => p.careerAV != null);
    if (withAV.length < 3) return '';
    const maxPick = Math.max(...peers.map(p => p.pick), 1);
    const maxAV = Math.max(...withAV.map(p => p.careerAV), 1);
    const plotW = SC2.w - SC2.l - SC2.r, plotH = SC2.h - SC2.t - SC2.b;
    const x = pick => SC2.l + ((pick - 1) / Math.max(maxPick - 1, 1)) * plotW;
    const y = av => SC2.t + (1 - av / maxAV) * plotH;

    const yTicks = niceTicks(0, maxAV);
    const grid = yTicks.map(v => `
        <line x1="${SC2.l}" y1="${y(v)}" x2="${SC2.l + plotW}" y2="${y(v)}" class="an-gridline"/>
        <text x="${SC2.l - 8}" y="${y(v) + 3}" class="an-tick" text-anchor="end">${fmt0(v)}</text>`).join('');
    const xStep = maxPick > 150 ? 50 : maxPick > 60 ? 20 : 10;
    const xTicks = [];
    for (let p = 1; p <= maxPick; p += xStep) xTicks.push(`<text x="${x(p)}" y="${SC2.h - 10}" class="an-tick" text-anchor="middle">${p}</text>`);

    const dots = peers.filter(p => p.careerAV != null).map(p => {
        const isSelf = p.name === highlightName;
        const cx = x(p.pick).toFixed(1), cy = y(p.careerAV).toFixed(1);
        return `<circle cx="${cx}" cy="${cy}" r="${isSelf ? 7 : 4.5}" fill="${isSelf ? '#B8433A' : 'var(--text-muted)'}"
            stroke="#000" stroke-width="2" class="an-dot" data-label="${esc(p.name)}${isSelf ? ' (lui)' : ''}" data-pick="${p.pick}" data-av="${p.careerAV}"/>`;
    }).join('');

    return `
    <div class="an-chart" id="${chartId}" data-chart="scatter">
        <svg viewBox="0 0 ${SC2.w} ${SC2.h}" class="an-svg">${grid}${xTicks.join('')}${dots}</svg>
        <div class="an-chart-tooltip" hidden></div>
    </div>`;
}

function bindScatterTooltip(container) {
    const svg = container.querySelector('svg');
    const tooltip = container.querySelector('.an-chart-tooltip');
    svg.addEventListener('pointermove', (e) => {
        const dot = e.target.closest('.an-dot');
        if (!dot) { tooltip.hidden = true; return; }
        tooltip.replaceChildren();
        const title = document.createElement('div');
        title.className = 'an-tt-title';
        title.textContent = `Pick #${dot.dataset.pick}`;
        const row = document.createElement('div');
        row.className = 'an-tt-row';
        const val = document.createElement('b');
        val.textContent = `${fmt0(+dot.dataset.av)} AV`;
        const name = document.createElement('span');
        name.className = 'an-tt-name';
        name.textContent = dot.dataset.label;
        row.append(val, name);
        tooltip.append(title, row);
        tooltip.hidden = false;
        positionTooltip(container, tooltip, e);
    });
    svg.addEventListener('pointerleave', () => { tooltip.hidden = true; });
}

/** Attiva l'interattività (crosshair+tooltip) di tutti i grafici della pagina. */
export function hydrateCharts(section) {
    section.querySelectorAll('.an-chart[data-points]').forEach(c => bindTrendChart(c));
    section.querySelectorAll('.an-chart[data-chart="bars"]').forEach(bindBarTooltip);
    section.querySelectorAll('.an-chart[data-chart="scatter"]').forEach(bindScatterTooltip);
}

// ─── Metriche avanzate ───────────────────────────────────────────

/** Widget trend: freccia direzionale grande sopra, variazione pt/settimana sotto. */
/** Mini sparkline degli ultimi punteggi, colore per direzione del trend. */
function _miniSpark(vals, dir) {
    if (!vals || vals.length < 3) return '';
    const W = 78, H = 20, pad = 2, n = vals.length;
    const min = Math.min(...vals), max = Math.max(...vals), r = (max - min) || 1;
    const x = i => pad + (n > 1 ? i / (n - 1) : 0.5) * (W - 2 * pad);
    const y = v => pad + (1 - (v - min) / r) * (H - 2 * pad);
    const pts = vals.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
    const col = dir === 'up' ? '#22c55e' : dir === 'down' ? 'var(--accent-red)' : 'var(--text-muted)';
    return `<svg viewBox="0 0 ${W} ${H}" class="pp-trend-spark" preserveAspectRatio="none" aria-hidden="true"><polyline points="${pts}" fill="none" stroke="${col}" stroke-width="1.6" stroke-linejoin="round"/><circle cx="${x(n - 1).toFixed(1)}" cy="${y(vals[n - 1]).toFixed(1)}" r="1.8" fill="${col}"/></svg>`;
}

function trendWidget(trend, spark) {
    if (!trend) return '';
    const dir = trend.label === 'up' ? 'up' : trend.label === 'down' ? 'down' : 'flat';
    const icon = dir === 'up' ? '↗' : dir === 'down' ? '↘' : '→';
    const word = dir === 'up' ? 'in crescita' : dir === 'down' ? 'in calo' : 'stabile';
    const rate = `${trend.slope > 0 ? '+' : ''}${fmt1(trend.slope)} pt/sett.`;
    const sparkSvg = _miniSpark(spark, dir);
    return `
    <div class="summary-stat pp-trend pp-trend--${dir}">
        <div class="pp-trend-arrow" aria-hidden="true">${icon}</div>
        <div class="summary-stat-value pp-trend-word">${rate}</div>
        ${sparkSvg}
        <div class="summary-stat-label">${word}</div>
    </div>`;
}

function kpi(value, label, accent = false) {
    return value == null || value === '' ? '' : `
    <div class="summary-stat${accent ? ' summary-stat--accent' : ''}">
        <div class="summary-stat-value">${value}</div>
        <div class="summary-stat-label">${label}</div>
    </div>`;
}

const quantile = (sorted, q) => {
    if (!sorted.length) return null;
    const pos = (sorted.length - 1) * q, base = Math.floor(pos), rest = pos - base;
    return sorted[base + 1] != null ? sorted[base] + rest * (sorted[base + 1] - sorted[base]) : sorted[base];
};

/** Densità gaussiana (KDE) in un punto y su un campione di valori. */
const kdeAt = (vals, y, bw) => {
    let s = 0;
    for (const v of vals) { const u = (y - v) / bw; s += Math.exp(-0.5 * u * u); }
    return s / (vals.length * bw * Math.sqrt(2 * Math.PI));
};

const RIDGE = { w: 720, l: 52, r: 16, t: 16, b: 30, rowStep: 44, amp: 60 };

/**
 * Ridgeline (joyplot) della distribuzione dei punti per stagione: una cresta di
 * densità (KDE) per anno, impilate con la più recente in alto — mostra la forma
 * della distribuzione e, a colpo d'occhio, l'arco di carriera. Tacca = mediana,
 * punto = media; per la stagione in arrivo un rombo alla media proiettata. Hover
 * → valori (riusa bindViolinHover via classe .pp-bp-chart e attributi data-bpv).
 */
function seasonRidgeline(seasons, nextSeasonProj, nextSeason) {
    const cols = [...seasons]
        .filter(s => (s.weekly || []).filter(g => g.pts != null).length >= 3)
        .sort((a, b) => b.year - a.year) // più recente in alto
        .map(s => {
            const pts = s.weekly.map(g => g.pts).filter(v => v != null).sort((a, b) => a - b);
            const n = pts.length;
            const mean = pts.reduce((a, b) => a + b, 0) / n;
            const std = Math.sqrt(pts.reduce((a, p) => a + (p - mean) ** 2, 0) / n);
            return {
                year: s.year, pts, n, mean, std,
                min: pts[0], max: pts[n - 1],
                q1: quantile(pts, 0.25), med: quantile(pts, 0.5), q3: quantile(pts, 0.75),
                bw: Math.max(1.3, 1.06 * std * Math.pow(n, -0.2)),
            };
        });
    if (!cols.length) return '';

    const projMean = (() => {
        const v = nextSeasonProj?.projPts ?? nextSeasonProj?.ptsStd;
        return v != null ? v / 17 : null;
    })();
    const hasProj = projMean != null;

    const C = RIDGE, plotW = C.w - C.l - C.r;
    const N = cols.length + (hasProj ? 1 : 0);
    const H = C.t + C.amp + (N - 1) * C.rowStep + C.b + 4;
    const xMax = Math.max(5, Math.ceil((Math.max(...cols.map(c => c.max), projMean || 0)) / 5) * 5);
    const xAt = v => C.l + (v / xMax) * plotW;
    const baseY = i => C.t + C.amp + i * C.rowStep; // i=0 = riga in alto

    const defs = `<defs>
        <linearGradient id="pp-ridge-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#6aa4ff" stop-opacity="0.55"/>
            <stop offset="100%" stop-color="#5a9bff" stop-opacity="0.10"/>
        </linearGradient>
    </defs>`;

    const axisY = baseY(N - 1) + 14;
    const grid = [0, 0.25, 0.5, 0.75, 1].map(f => {
        const v = Math.round(xMax * f);
        return `<line x1="${xAt(v).toFixed(1)}" y1="${C.t}" x2="${xAt(v).toFixed(1)}" y2="${axisY.toFixed(1)}" class="an-gridline"/>
        <text x="${xAt(v).toFixed(1)}" y="${(axisY + 14).toFixed(1)}" class="an-tick" text-anchor="middle">${v}</text>`;
    }).join('');
    const axLabel = `<text x="${(C.l + plotW).toFixed(1)}" y="${(axisY + 14).toFixed(1)}" class="an-tick" text-anchor="end">pt/gara</text>`;

    // creste stagionali (dalla più recente); disegnate prima, la proiezione sopra
    let seasonRows = '';
    cols.forEach((c, k) => {
        const by = baseY(hasProj ? k + 1 : k);
        const STEPS = 48;
        const xs = Array.from({ length: STEPS + 1 }, (_, j) => xMax * j / STEPS);
        const dens = xs.map(x => kdeAt(c.pts, x, c.bw));
        const maxD = Math.max(...dens, 1e-9);
        const top = xs.map((x, j) => `${xAt(x).toFixed(1)},${(by - dens[j] / maxD * C.amp).toFixed(1)}`);
        const path = `M${xAt(0).toFixed(1)},${by.toFixed(1)} L${top.join(' L')} L${xAt(xMax).toFixed(1)},${by.toFixed(1)} Z`;
        const medY = by - kdeAt(c.pts, c.med, c.bw) / maxD * C.amp;
        seasonRows += `<g class="pp-bp-g pp-ridge-g" data-bpv data-year="${c.year}" data-media="${fmt1(c.mean)}" data-med="${fmt1(c.med)}" data-q1="${fmt1(c.q1)}" data-q3="${fmt1(c.q3)}" data-min="${fmt1(c.min)}" data-max="${fmt1(c.max)}" data-n="${c.n}">
            <path d="${path}" fill="url(#pp-ridge-grad)" class="pp-ridge-shape"/>
            <polyline points="${top.join(' ')}" class="pp-ridge-line"/>
            <line x1="${xAt(c.med).toFixed(1)}" y1="${by.toFixed(1)}" x2="${xAt(c.med).toFixed(1)}" y2="${medY.toFixed(1)}" class="pp-ridge-median"/>
            <circle cx="${xAt(c.mean).toFixed(1)}" cy="${by.toFixed(1)}" r="3" class="pp-bp-mean"/>
            <text x="${(C.l - 8)}" y="${(by + 4).toFixed(1)}" class="an-tick pp-ridge-ylbl" text-anchor="end">${c.year}</text>
        </g>`;
    });

    let projRow = '';
    if (hasProj) {
        const by = baseY(0), x = xAt(projMean), s = 5.5;
        projRow = `<g class="pp-bp-g" data-bpv data-proj="1" data-year="${nextSeason}" data-mean="${fmt1(projMean)}">
            <line x1="${C.l}" y1="${by.toFixed(1)}" x2="${(C.l + plotW).toFixed(1)}" y2="${by.toFixed(1)}" class="pp-ridge-base"/>
            <path d="M${x.toFixed(1)} ${(by - s).toFixed(1)} L${(x + s).toFixed(1)} ${by.toFixed(1)} L${x.toFixed(1)} ${(by + s).toFixed(1)} L${(x - s).toFixed(1)} ${by.toFixed(1)} Z" class="pp-bp-proj"/>
            <text x="${(C.l - 8)}" y="${(by + 4).toFixed(1)}" class="an-tick pp-bp-projlbl" text-anchor="end">${nextSeason}</text>
        </g>`;
    }

    const legend = `
    <div class="pp-cmp-legend">
        <span class="pp-cmp-leg"><i class="pp-bp-lg-box"></i>density (per season)</span>
        <span class="pp-cmp-leg"><i class="pp-bp-lg-med"></i>median</span>
        <span class="pp-cmp-leg"><i class="pp-bp-lg-mean"></i>media</span>
        ${hasProj ? `<span class="pp-cmp-leg"><i class="pp-bp-lg-proj"></i>proiez. ${nextSeason}</span>` : ''}
    </div>`;

    return `
    <div class="pp-cmp-chart pp-bp-chart pp-ridge-chart">
        <svg viewBox="0 0 ${C.w} ${H.toFixed(0)}" class="an-svg pp-ridge-svg" preserveAspectRatio="xMidYMid meet">
            ${defs}${grid}${axLabel}${seasonRows}${projRow}
        </svg>
        <div class="pp-chart-tip" hidden></div>
    </div>
    ${legend}`;
}

const FORM_CHART = { w: 720, h: 250, l: 34, r: 16, t: 16, b: 30 };

/**
 * Forma game-by-game della stagione più recente con game log: punti-lega per
 * gara (area sfumata), media mobile a 4 gare (linea accento) e — se disponibile
 * — la media proiettata preseason come riferimento tratteggiato. Hover su una
 * gara → settimana, avversario e snap%. Fonte: weekly (stessi dati del game log).
 */
function seasonFormChart(seasons, projByYear) {
    const season = [...(seasons || [])]
        .filter(s => (s.weekly || []).filter(g => g.pts != null).length >= 4)
        .sort((a, b) => b.year - a.year)[0];
    if (!season) return '';
    const games = [...season.weekly].filter(g => g.pts != null).sort((a, b) => a.week - b.week);
    const vals = games.map(g => g.pts);
    const n = vals.length;

    // media mobile a 4 gare (trailing)
    const WIN = 4;
    const roll = vals.map((_, i) => {
        const slice = vals.slice(Math.max(0, i - WIN + 1), i + 1);
        return slice.reduce((a, b) => a + b, 0) / slice.length;
    });

    // riferimento: media proiettata preseason di quella stagione (pt/gara)
    const proj = projByYear?.[season.year];
    const projMean = (() => {
        const v = proj?.projPts ?? proj?.ptsStd;
        return v != null ? v / (proj?.gp || 17) : null;
    })();

    const C = FORM_CHART, plotW = C.w - C.l - C.r, plotH = C.h - C.t - C.b;
    const yMax = Math.max(5, Math.ceil(Math.max(...vals, projMean || 0) / 5) * 5);
    const xAt = i => C.l + (n > 1 ? i / (n - 1) : 0.5) * plotW;
    const yAt = v => C.t + (1 - v / yMax) * plotH;

    const grid = [0, 0.25, 0.5, 0.75, 1].map(f => {
        const v = Math.round(yMax * f), y = yAt(v);
        return `<line x1="${C.l}" y1="${y.toFixed(1)}" x2="${C.l + plotW}" y2="${y.toFixed(1)}" class="an-gridline"/>
        <text x="${C.l - 6}" y="${(y + 3).toFixed(1)}" class="an-tick" text-anchor="end">${v}</text>`;
    }).join('');
    const step = n > 12 ? 2 : 1;
    const xLabels = games.map((g, i) => i % step === 0
        ? `<text x="${xAt(i).toFixed(1)}" y="${C.h - 8}" class="an-tick" text-anchor="middle">${g.week}</text>` : '').join('');

    const areaPath = `M${xAt(0).toFixed(1)},${yAt(0).toFixed(1)} `
        + games.map((g, i) => `L${xAt(i).toFixed(1)},${yAt(g.pts).toFixed(1)}`).join(' ')
        + ` L${xAt(n - 1).toFixed(1)},${yAt(0).toFixed(1)} Z`;
    const linePts = games.map((g, i) => `${xAt(i).toFixed(1)},${yAt(g.pts).toFixed(1)}`).join(' ');
    const rollPts = roll.map((v, i) => `${xAt(i).toFixed(1)},${yAt(v).toFixed(1)}`).join(' ');

    const projLine = projMean != null
        ? `<line x1="${C.l}" y1="${yAt(projMean).toFixed(1)}" x2="${C.l + plotW}" y2="${yAt(projMean).toFixed(1)}" class="pp-form-proj"/>
           <text x="${(C.l + plotW).toFixed(1)}" y="${(yAt(projMean) - 5).toFixed(1)}" class="an-tick pp-form-projlbl" text-anchor="end">attesa ${fmt1(projMean)}</text>` : '';

    const dots = games.map((g, i) => {
        const snap = snapSharePct(g);
        const tip = `${g.week}|${g.opponent || ''}|${g.isAway ? '@' : 'v'}|${fmt1(g.pts)}|${snap != null ? snap : ''}`;
        return `<g class="pp-form-g" data-fg="${esc(tip)}">
            <circle cx="${xAt(i).toFixed(1)}" cy="${yAt(g.pts).toFixed(1)}" r="3.2" class="pp-form-dot"/>
            <circle cx="${xAt(i).toFixed(1)}" cy="${yAt(g.pts).toFixed(1)}" r="12" fill="transparent"/>
        </g>`;
    }).join('');

    const defs = `<defs>
        <linearGradient id="pp-form-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#6aa4ff" stop-opacity="0.42"/>
            <stop offset="100%" stop-color="#5a9bff" stop-opacity="0.04"/>
        </linearGradient>
    </defs>`;
    const bg = `<rect x="${C.l}" y="${C.t}" width="${plotW.toFixed(1)}" height="${plotH.toFixed(1)}" rx="8" class="pp-bp-bg"/>`;
    const legend = `
    <div class="pp-cmp-legend">
        <span class="pp-cmp-leg"><i class="pp-form-lg-area"></i>pt/gara</span>
        <span class="pp-cmp-leg"><i class="pp-form-lg-roll"></i>4-game moving avg</span>
        ${projMean != null ? `<span class="pp-cmp-leg"><i class="pp-form-lg-proj"></i>preseason expectation</span>` : ''}
    </div>`;

    return `
    <div class="pp-cmp-chart pp-form-chart" data-form-year="${season.year}">
        <svg viewBox="0 0 ${C.w} ${C.h}" class="an-svg pp-form-svg" preserveAspectRatio="xMidYMid meet">
            ${defs}${bg}${grid}
            <path d="${areaPath}" fill="url(#pp-form-grad)" class="pp-form-area"/>
            <polyline points="${linePts}" class="pp-form-line"/>
            <polyline points="${rollPts}" class="pp-form-roll"/>
            ${projLine}${dots}${xLabels}
        </svg>
        <div class="pp-chart-tip" hidden></div>
    </div>
    ${legend}`;
}

/** Hover sul grafico forma: settimana, avversario, punti e snap% della gara. */
function bindFormHover(section) {
    section.querySelectorAll('.pp-form-chart').forEach(chart => {
        const tip = chart.querySelector('.pp-chart-tip');
        const svg = chart.querySelector('svg');
        if (!tip || !svg) return;
        const move = (e) => {
            const g = e.target.closest('[data-fg]');
            if (!g) { tip.hidden = true; return; }
            const [wk, opp, ha, pts, snap] = g.dataset.fg.split('|');
            tip.innerHTML = `<b>Settimana ${esc(wk)}</b>${opp ? ` · ${ha === '@' ? '@' : 'vs'} ${esc(opp)}` : ''}<br><b>${esc(pts)}</b> pt lega${snap ? ` · snap ${esc(snap)}%` : ''}`;
            tip.hidden = false;
            const r = chart.getBoundingClientRect();
            const x = e.clientX - r.left, y = e.clientY - r.top;
            tip.style.left = Math.max(4, Math.min(x + 14, r.width - tip.offsetWidth - 6)) + 'px';
            tip.style.top = Math.max(4, y - tip.offsetHeight - 10) + 'px';
        };
        svg.addEventListener('pointermove', move);
        svg.addEventListener('pointerleave', () => { tip.hidden = true; });
    });
}

function metricsBlock(seasons, pos, nextSeasonProj, nextSeason, projByYear) {
    // Metriche di CARRIERA: distribuzione su tutte le gare (in ordine cronologico).
    const careerGames = [...seasons].sort((a, b) => a.year - b.year).flatMap(s => s.weekly || []);
    const m = computeSeasonMetrics(careerGames);
    if (!m) return '';

    // Efficienza di carriera: somma dei totali stagionali Sleeper.
    const careerTotals = {};
    let careerPts = 0;
    for (const s of seasons) {
        careerPts += s.totals?.pts || 0;
        const st = s.totals?.stats;
        if (st) for (const k in st) if (typeof st[k] === 'number') careerTotals[k] = (careerTotals[k] || 0) + st[k];
    }
    const eff = computeEfficiency(careerTotals, pos, careerPts);
    const nSeasons = new Set(seasons.filter(s => (s.weekly?.length || 0) >= 1).map(s => s.year)).size;

    // KPI primari: le metriche di forma su cui si decide (media, range, affidabilità).
    // 6 KPI in evidenza (le più decisive); il resto nell'espandibile "Più metriche".
    const heroKpis = [
        kpi(fmt1(m.media), 'Avg pts/game', true),
        kpi(fmt1(m.ceiling), 'Ceiling'),
        kpi(fmt1(m.floor), 'Floor'),
        kpi(m.consistency != null ? fmt0(m.consistency * 100) + '%' : null, 'Consistenza'),
        kpi(m.boomPct != null ? m.boomPct + '%' : null, 'Boom'),
        trendWidget(m.trend, careerGames.slice(-10).map(g => g.pts).filter(v => v != null)),
    ].join('');
    const moreKpis = [
        kpi(fmt1(m.mediana), 'Median'),
        kpi(m.bustPct != null ? m.bustPct + '%' : null, 'Bust'),
        kpi(fmt0(m.gp), 'Partite totali'),
        kpi(fmt1(m.devStd), 'Dev. standard'),
        kpi(m.cv != null ? fmt1(m.cv * 100) + '%' : null, 'Coeff. variazione'),
        kpi(fmt1(m.last5Avg), 'Last 5'),
        kpi(fmt1(m.homeAvg), 'Avg at home'), kpi(fmt1(m.awayAvg), 'Avg away'),
    ].join('');

    // Efficienza filtrata per ruolo: un QB non ha target/ricezioni, quindi Catch%
    // e FP-per-target sono rumore (divisioni per ~0). Ogni ruolo mostra solo le
    // metriche di efficienza che lo descrivono davvero.
    const effRender = {
        ydsPerAtt: () => kpi(eff?.ydsPerAtt != null ? fmt1(eff.ydsPerAtt) : null, 'Yds/pass att'),
        ydsPerTouch: () => kpi(eff?.ydsPerTouch != null ? fmt1(eff.ydsPerTouch) : null, 'Yard per tocco'),
        tdPerTouch: () => kpi(eff?.tdPerTouch != null ? fmt1(eff.tdPerTouch * 100) + '%' : null, 'TD per tocco'),
        fpPerTouch: () => kpi(eff?.fpPerTouch != null ? fmt1(eff.fpPerTouch) : null, 'FP per tocco'),
        fpPerTarget: () => kpi(eff?.fpPerTarget != null ? fmt1(eff.fpPerTarget) : null, 'FP per target'),
        catchPct: () => kpi(eff?.catchPct != null ? eff.catchPct + '%' : null, 'Catch %'),
    };
    const EFF_BY_POS = {
        QB: ['ydsPerAtt'],
        RB: ['ydsPerTouch', 'tdPerTouch', 'fpPerTouch'],
        WR: ['catchPct', 'fpPerTarget', 'ydsPerTouch', 'fpPerTouch'],
        TE: ['catchPct', 'fpPerTarget', 'ydsPerTouch', 'fpPerTouch'],
    };
    const effKpis = (EFF_BY_POS[pos] || []).map(k => effRender[k]()).filter(Boolean).join('');

    // Tabella completa per stagione, espandibile (come negli altri blocchi).
    const tableRows = [...seasons].filter(s => (s.weekly?.length || 0) >= 2).sort((a, b) => b.year - a.year).map(s => {
        const sm = computeSeasonMetrics(s.weekly);
        if (!sm) return '';
        return `<tr><td>${s.year}</td><td>${fmt0(sm.gp)}</td><td class="pm-td-strong">${fmt1(sm.media)}</td><td>${fmt1(sm.mediana)}</td><td>${fmt1(sm.floor)}</td><td>${fmt1(sm.ceiling)}</td><td>${fmt1(sm.devStd)}</td><td>${sm.boomPct ?? '—'}%</td><td>${sm.bustPct ?? '—'}%</td><td>${sm.consistency != null ? fmt0(sm.consistency * 100) + '%' : '—'}</td></tr>`;
    }).filter(Boolean).join('');
    const table = tableRows ? `
        <details class="pp-recap-ids pp-metrics-table">
            <summary>Full table by season</summary>
            <div class="pm-table-wrap pp-scroll" style="margin-top:8px">
                <table class="pm-table pp-table">
                    <thead><tr><th>Year</th><th>GP</th><th>Avg</th><th>Median</th><th>Floor</th><th>Ceiling</th><th>Std dev</th><th>Boom</th><th>Bust</th><th>Consist.</th></tr></thead>
                    <tbody>${tableRows}</tbody>
                </table>
            </div>
        </details>` : '';

    const formChart = seasonFormChart(seasons, projByYear);
    return `
    <section class="pm-block pp-block">
        <span class="mc-kicker">Advanced metrics · career (${m.gp} games${nSeasons > 1 ? `, ${nSeasons} seasons` : ''})</span>
        <div class="pp-kpi pp-kpi--primary">${heroKpis}</div>
        <details class="pp-recap-ids pp-kpi-more" style="margin-top:12px">
            <summary>More metrics · form, context${effKpis ? ', efficiency' : ''}</summary>
            <div class="pp-kpi-group" style="margin-top:10px">
                <span class="pp-kpi-grouplabel">Forma &amp; contesto</span>
                <div class="pp-kpi pp-kpi--sec">${moreKpis}</div>
            </div>
            ${effKpis ? `
            <div class="pp-kpi-group">
                <span class="pp-kpi-grouplabel">Efficienza · ${esc(pos)}</span>
                <div class="pp-kpi pp-kpi--sec">${effKpis}</div>
            </div>` : ''}
        </details>
        ${formChart ? `<h3 class="pp-cat-title" style="margin-top:20px">Form · game by game (last season)</h3>${formChart}` : ''}
        <h3 class="pp-cat-title" style="margin-top:20px">Points distribution by season</h3>
        ${seasonRidgeline(seasons, nextSeasonProj, nextSeason)}
        ${table}
        <p class="pm-note">Widgets refer to the whole NFL career (since ${FIRST_STATS_YEAR}). Ridgeline: each ridge is the density of a season's scores (where they cluster), tick = median, dot = mean.${nextSeasonProj ? ` The dashed diamond is the projected average ${nextSeason} (Rotowire via Sleeper).` : ''} Hover a season for the values.</p>
    </section>`;
}

// ─── Confronto con la lega Topina ────────────────────────────────

/** Metriche di confronto per ruolo (per-gara), dai campi di getSeasonStats. */
const CMP_METRICS = {
    QB: [['Pt lega/gara', 'ptsLeague'], ['Pass yds/game', 'passYd'], ['Pass TD/game', 'passTd'], ['Rush yds/game', 'rushYd']],
    RB: [['Pt lega/gara', 'ptsLeague'], ['Rush yds/game', 'rushYd'], ['Receptions/game', 'rec'], ['Rec yds/game', 'recYd']],
    WR: [['Pt lega/gara', 'ptsLeague'], ['Rec yds/game', 'recYd'], ['Receptions/game', 'rec'], ['Targets/game', 'tgt']],
    TE: [['Pt lega/gara', 'ptsLeague'], ['Rec yds/game', 'recYd'], ['Receptions/game', 'rec'], ['Targets/game', 'tgt']],
    K: [['Pt lega/gara', 'ptsLeague'], ['Field goals/game', 'fgm'], ['Extra points/game', 'xpm']],
};

/**
 * Confronto del giocatore coi pari-ruolo Topina in una stagione: pool +
 * percentile per metrica + distribuzione pt lega/gara. `null` se dati
 * insufficienti. Riusa `matchProjection` per il match nome/ruolo.
 */
function computeComparison(name, pos, seasonStats, careersAll) {
    const metrics = CMP_METRICS[pos];
    if (!seasonStats || !careersAll || !metrics) return null;
    const me = matchProjection(seasonStats, name, pos);
    if (!me || !me.gp) return null;

    const seen = new Set();
    const pool = [];
    const add = e => { const id = e.playerId || e.name; if (e?.gp && !seen.has(id)) { seen.add(id); pool.push(e); } };
    for (const c of careersAll.values()) {
        const cp = (c.position || '').toUpperCase().replace('W/R', 'WR');
        if (cp !== pos) continue;
        const e = matchProjection(seasonStats, c.name, cp);
        if (e) add(e);
    }
    add(me); // il giocatore fa parte del confronto
    if (pool.length < 4) return null;

    const rate = (e, field) => { const v = e[field]; return v == null || !e.gp ? null : v / e.gp; };
    const pct = (vals, mv) => Math.round(vals.filter(v => v <= mv).length / vals.length * 100);

    const perMetric = metrics.map(([label, field]) => {
        const mv = rate(me, field);
        if (mv == null) return { label, field, mv: null, p: null };
        const vals = pool.map(e => rate(e, field)).filter(v => v != null);
        return { label, field, mv, p: vals.length >= 4 ? pct(vals, mv) : null };
    });

    let dist = null;
    const ptVals = pool.map(e => rate(e, 'ptsLeague')).filter(v => v != null).sort((a, b) => a - b);
    if (ptVals.length >= 4) {
        const mv = rate(me, 'ptsLeague');
        dist = { min: ptVals[0], max: ptVals[ptVals.length - 1], median: ptVals[Math.floor(ptVals.length / 2)], mv, rank: ptVals.filter(v => v > mv).length + 1, n: ptVals.length, p: pct(ptVals, mv) };
    }
    return { poolSize: pool.length, perMetric, dist };
}

/** Corpo del confronto per una stagione: distribuzione pt + barre percentile. */
function leagueComparisonBody(name, pos, year, seasonStats, careersAll) {
    const c = computeComparison(name, pos, seasonStats, careersAll);
    if (!c) return '';

    const bars = c.perMetric.map(m => {
        if (m.p == null) return '';
        const cls = m.p >= 70 ? ' hi' : m.p <= 30 ? ' lo' : '';
        return `
        <div class="pp-cmp-row">
            <span class="pp-cmp-label">${esc(m.label)}</span>
            <span class="pp-cmp-track"><span class="pp-cmp-fill${cls}" style="width:${m.p}%"></span></span>
            <span class="pp-cmp-val"><b>${fmt1(m.mv)}</b> · ${m.p}°</span>
        </div>`;
    }).filter(Boolean).join('');

    let dist = '';
    if (c.dist) {
        const d = c.dist;
        const span = d.max - d.min || 1;
        const at = v => Math.max(0, Math.min(100, (v - d.min) / span * 100));
        dist = `
        <div class="pp-cmp-dist">
            <span class="pp-cmp-dist-rail"></span>
            <span class="pp-cmp-dist-median" style="left:${at(d.median).toFixed(1)}%" title="mediana lega ${fmt1(d.median)}"></span>
            <span class="pp-cmp-dist-me" style="left:${at(d.mv).toFixed(1)}%"><i></i><span class="pp-cmp-dist-me-val">${fmt1(d.mv)}</span></span>
        </div>
        <div class="pp-cmp-dist-scale"><span>min ${fmt1(d.min)}</span><span>mediana ${fmt1(d.median)}</span><span>max ${fmt1(d.max)}</span></div>
        <p class="pp-cmp-rank">League pts/game: <b>${d.rank}º su ${d.n}</b> ${pos} della lega · <b>${d.p}°</b> percentile</p>`;
    }

    if (!bars && !dist) return '';
    return `
    ${dist}
    ${bars ? `<div class="pp-cmp-bars">${bars}</div>` : ''}
    <p class="pm-note">Confronto sui soli giocatori mai schierati nella lega Topina che hanno giocato nel ${year} (${c.poolSize} ${pos}). Valori per gara nello scoring della lega; percentile = quota di pari-ruolo Topina che il giocatore supera.</p>`;
}

const comparisonEmpty = (year) => `<p class="pm-empty">Confronto non disponibile per la stagione ${year} (dati o pool insufficienti).</p>`;

// r ampio: spazio per le etichette a fine linea (stile analysis).
const CMP_CHART = { w: 760, h: 230, l: 30, r: 120, t: 14, b: 30 };
const CMP_COLORS = ['#e0a63a', '#4f8cff', '#3fb950', '#a371f7'];

/**
 * Grafico globale multi-anno: una linea per metrica del ruolo, in scala
 * percentile vs lega Topina (0-100°), per capire come era messo il giocatore
 * stagione per stagione. Le colonne-anno sono cliccabili: la selezione guida
 * il dettaglio sotto (vedi `bindComparisonChart`). '' se meno di 2 stagioni.
 */
function comparisonTrendChart(name, pos, compare, selYear) {
    const years = [...compare.years].sort((a, b) => a - b);
    if (years.length < 2) return '';
    const metrics = CMP_METRICS[pos];

    const byYear = years.map(y => computeComparison(name, pos, compare.statsByYear[y], compare.careersAll));
    const series = metrics.map(([label, field], mi) => ({
        label, color: CMP_COLORS[mi % CMP_COLORS.length],
        pts: years.map((y, i) => ({ x: y, p: byYear[i]?.perMetric.find(m => m.field === field)?.p ?? null })),
    })).filter(s => s.pts.some(pt => pt.p != null));
    if (!series.length) return '';

    const C = CMP_CHART, plotW = C.w - C.l - C.r, plotH = C.h - C.t - C.b;
    const xAt = i => years.length > 1 ? C.l + i / (years.length - 1) * plotW : C.l + plotW / 2;
    const yAt = p => C.t + (1 - p / 100) * plotH;

    const grid = [0, 25, 50, 75, 100].map(v => `
        <line x1="${C.l}" y1="${yAt(v).toFixed(1)}" x2="${C.l + plotW}" y2="${yAt(v).toFixed(1)}" class="an-gridline"/>
        <text x="${C.l - 6}" y="${(yAt(v) + 3).toFixed(1)}" class="an-tick" text-anchor="end">${v}°</text>`).join('');

    // Linee pulite, senza pallini intermedi (stile analysis).
    const lines = series.map(s => {
        const seg = s.pts.map((pt, i) => pt.p == null ? null : `${xAt(i).toFixed(1)},${yAt(pt.p).toFixed(1)}`).filter(Boolean).join(' ');
        return `<polyline points="${seg}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
    }).join('');

    // Etichette a fine linea (nome serie + pallino + leader) con anti-collisione verticale.
    const ends = series.map(s => {
        let last = null;
        for (let i = s.pts.length - 1; i >= 0; i--) { if (s.pts[i].p != null) { last = { i, p: s.pts[i].p }; break; } }
        return last ? { s, lx: xAt(last.i), ly: yAt(last.p), labelY: yAt(last.p) } : null;
    }).filter(Boolean).sort((a, b) => a.ly - b.ly);
    const MIN_GAP = 14;
    for (let i = 1; i < ends.length; i++) {
        if (ends[i].labelY - ends[i - 1].labelY < MIN_GAP) ends[i].labelY = ends[i - 1].labelY + MIN_GAP;
    }
    const endEls = ends.map(({ s, lx, ly, labelY }) => `
        ${Math.abs(labelY - ly) > 2 ? `<line x1="${(lx + 5).toFixed(1)}" y1="${ly.toFixed(1)}" x2="${(lx + 12).toFixed(1)}" y2="${labelY.toFixed(1)}" class="an-leader"/>` : ''}
        <circle cx="${lx.toFixed(1)}" cy="${ly.toFixed(1)}" r="4" fill="${s.color}" stroke="#000" stroke-width="2"/>
        <text x="${(lx + 14).toFixed(1)}" y="${(labelY + 3.5).toFixed(1)}" class="an-endlabel">${esc(s.label)}</text>`).join('');

    // colonne cliccabili per anno (hit rect trasparente sopra le linee) + guida di selezione
    const cols = years.map((y, i) => {
        const cx = xAt(i);
        const half = years.length > 1 ? plotW / (years.length - 1) / 2 : plotW / 2;
        const x = Math.max(C.l, cx - half), w = Math.min(C.l + plotW, cx + half) - x;
        return `<g class="pp-cmp-col${y === selYear ? ' is-sel' : ''}" data-year="${y}">
            <rect class="pp-cmp-colsel" x="${(cx - 1).toFixed(1)}" y="${C.t}" width="2" height="${plotH}"/>
            <rect class="pp-cmp-colhit" x="${x.toFixed(1)}" y="${C.t}" width="${w.toFixed(1)}" height="${plotH}" fill="transparent"><title>Stagione ${y}</title></rect>
        </g>`;
    }).join('');

    const xLabels = years.map((y, i) => `<text x="${xAt(i).toFixed(1)}" y="${C.h - 8}" class="an-tick pp-cmp-xlabel" text-anchor="middle" data-year="${y}">${y}</text>`).join('');

    return `
    <div class="pp-cmp-chart">
        <svg viewBox="0 0 ${C.w} ${C.h}" class="an-svg pp-cmp-svg" preserveAspectRatio="xMidYMid meet">
            ${grid}${lines}${endEls}${cols}${xLabels}
        </svg>
    </div>`;
}

/**
 * Blocco confronto con la lega. Il grafico globale (percentili per anno) fa da
 * selettore: cliccando una stagione compare il dettaglio (distribuzione +
 * percentili) di quell'anno. Default: stagione più recente.
 */
function leagueComparisonBlock(ctx) {
    const { pos, compare } = ctx;
    if (!compare?.careersAll || !CMP_METRICS[pos] || !compare.years?.length) return '';
    const selYear = compare.years[0]; // desc → più recente
    const chart = comparisonTrendChart(ctx.name, pos, compare, selYear);
    const body = leagueComparisonBody(ctx.name, pos, selYear, compare.statsByYear[selYear], compare.careersAll) || comparisonEmpty(selYear);

    return `
    <section class="pm-block pp-block">
        <span class="mc-kicker">Comparison with the league · ${pos} · percentiles by season</span>
        ${chart}
        <div class="pp-cmp-selhint">${chart ? 'Click a season on the chart. ' : ''}Detail: <b id="pp-cmp-selyear">${selYear}</b></div>
        <div id="pp-cmp-body">${body}</div>
    </section>`;
}

/** Il grafico globale fa da selettore: click su una stagione → dettaglio sotto. */
function bindComparisonChart(section, ctx) {
    // La classe .pp-cmp-chart è riusata anche dal grafico distribuzione in
    // "Metriche · carriera": scopo la ricerca al blocco del confronto (quello
    // che contiene #pp-cmp-body), altrimenti il listener finirebbe sul grafico
    // sbagliato e il click sull'anno non aggiornerebbe nulla.
    const body = section.querySelector('#pp-cmp-body');
    const chart = body?.closest('.pm-block')?.querySelector('.pp-cmp-chart');
    if (!chart || !body || !ctx.compare?.careersAll) return;
    const yearLbl = section.querySelector('#pp-cmp-selyear');
    chart.addEventListener('click', (e) => {
        const hit = e.target.closest('[data-year]');
        if (!hit) return;
        const year = +hit.dataset.year;
        chart.querySelectorAll('.pp-cmp-col.is-sel').forEach(el => el.classList.remove('is-sel'));
        chart.querySelector(`.pp-cmp-col[data-year="${year}"]`)?.classList.add('is-sel');
        if (yearLbl) yearLbl.textContent = year;
        body.innerHTML = leagueComparisonBody(ctx.name, ctx.pos, year, ctx.compare.statsByYear[year], ctx.compare.careersAll) || comparisonEmpty(year);
    });
}

// ─── Metriche avanzate nflverse (union coi dati Sleeper) ─────────

/** Colonne avanzate per ruolo: TUTTI i campi nflverse (player_stats + snap
 *  counts + Next Gen Stats + PFR advanced) non presenti su Sleeper. */
function advCols(pos) {
    const pct = (v) => v == null ? '—' : `${Math.round(v * 100)}%`;   // frazione 0-1 → %
    const pp = (v) => v == null ? '—' : `${fmt1(v)}%`;                // già in percentuale
    const n1 = (v) => v == null ? '—' : (+v).toFixed(1);
    const n2 = (v) => v == null ? '—' : (+v).toFixed(2);
    if (pos === 'RB') return [
        ['Snap%', s => pct(s.snapPct)], ['Rush share', s => pct(s.rushShare)], ['Target%', s => pct(s.targetShare)],
        ['Yds/carry', s => n1(s.ydsPerCarry)], ['YBC/att', s => n2(s.ybcPerAtt)], ['YAC/att', s => n2(s.yacPerAtt)],
        ['RYOE/att', s => n2(s.ryoePerAtt)], ['Broken tk', s => fmt0(s.rushBrokenTk)], ['Catch%', s => pct(s.catchRate)],
        ['Yd/target', s => n1(s.ydsPerTgt)], ['YAC/ric', s => n1(s.yacPerRec)],
        ['% box 8+', s => pp(s.pctAtt8Def)], ['Time to LOS', s => n2(s.timeToLos)], ['EPA/game', s => n2(s.epaPerGame)],
    ];
    if (pos === 'QB') return [
        ['Snap%', s => pct(s.snapPct)], ['CPOE', s => n1(s.cpoe)], ['Compl. attesa%', s => pp(s.expComplPct)],
        ['EPA/game', s => n2(s.epaPerGame)], ['Time to throw', s => n2(s.timeToThrow)], ['Aggress.%', s => pp(s.aggressiveness)],
        ['Air→sticks', s => n2(s.airYdToSticks)], ['Bad throw%', s => pct(s.qbBadThrowPct)], ['Pressed%', s => pct(s.qbPressuredPct)],
        ['Sack subiti', s => fmt0(s.qbSacked)], ['Blitz', s => fmt0(s.qbBlitzed)], ['Hurried', s => fmt0(s.qbHurried)],
        ['QB hit', s => fmt0(s.qbHit)], ['Pass yd', s => fmt0(s.passYd)], ['Pass TD', s => fmt0(s.passTd)],
        ['Carries/game', s => n1(s.carriesPerGame)], ['Yds/carry', s => n1(s.ydsPerCarry)],
    ];
    if (pos === 'K') return [
        ['FG fatti', s => fmt0(s.fgMade)], ['FG tentati', s => fmt0(s.fgAtt)], ['Pt lega/gara', s => n1(s.fpgLeague)],
    ];
    return [ // WR / TE
        ['Snap%', s => pct(s.snapPct)], ['Target%', s => pct(s.targetShare)], ['Air yd%', s => pct(s.airYardsShare)],
        ['WOPR', s => n2(s.wopr)], ['RACR', s => n2(s.racr)], ['Catch%', s => pct(s.catchRate)],
        ['Yd/target', s => n1(s.ydsPerTgt)], ['YAC/ric', s => n1(s.yacPerRec)], ['Separaz. (yd)', s => n1(s.sep)],
        ['Cushion (yd)', s => n1(s.cushion)], ['YAC±att', s => n1(s.yacOE)], ['Air yd int.', s => n1(s.intendedAirYd)],
        ['Drop', s => fmt0(s.recDrops)], ['Drop%', s => pct(s.recDropPct)], ['Broken tk', s => fmt0(s.recBrokenTk)],
        ['EPA/game', s => n2(s.epaPerGame)],
    ];
}

// ─── Radar avanzato · percentili di ruolo NFL ────────────────────
const _advP = v => v == null ? '—' : Math.round(v * 100) + '%'; // frazione 0-1 → %
const _advPP = v => v == null ? '—' : fmt1(v) + '%';            // già in percentuale

/** Assi del radar avanzato per ruolo (dir −1 = più basso è meglio → invertito). */
const ADV_RADAR = {
    QB: [
        { key: 'cpoe', label: 'CPOE', dir: 1, fmt: fmt1 },
        { key: 'epaPerGame', label: 'EPA/g', dir: 1, fmt: fmt2 },
        { key: 'aggressiveness', label: 'Aggress.', dir: 1, fmt: _advPP },
        { key: 'airYdToSticks', label: 'Air→sticks', dir: 1, fmt: fmt2 },
        { key: 'qbBadThrowPct', label: 'Bad throw', dir: -1, fmt: _advP },
        { key: 'qbPressuredPct', label: 'Pressed', dir: -1, fmt: _advP },
        { key: 'snapPct', label: 'Snap%', dir: 1, fmt: _advP },
    ],
    RB: [
        { key: 'snapPct', label: 'Snap%', dir: 1, fmt: _advP },
        { key: 'rushShare', label: 'Rush%', dir: 1, fmt: _advP },
        { key: 'targetShare', label: 'Tgt%', dir: 1, fmt: _advP },
        { key: 'ryoePerAtt', label: 'RYOE/att', dir: 1, fmt: fmt2 },
        { key: 'yacPerAtt', label: 'YAC/att', dir: 1, fmt: fmt2 },
        { key: 'rushBrokenTk', label: 'Broken tk', dir: 1, fmt: fmt0 },
        { key: 'ydsPerCarry', label: 'Yds/carry', dir: 1, fmt: fmt1 },
        { key: 'epaPerGame', label: 'EPA/g', dir: 1, fmt: fmt2 },
    ],
    WR: [
        { key: 'targetShare', label: 'Tgt%', dir: 1, fmt: _advP },
        { key: 'airYardsShare', label: 'Air yd%', dir: 1, fmt: _advP },
        { key: 'wopr', label: 'WOPR', dir: 1, fmt: fmt2 },
        { key: 'racr', label: 'RACR', dir: 1, fmt: fmt2 },
        { key: 'catchRate', label: 'Catch%', dir: 1, fmt: _advP },
        { key: 'ydsPerTgt', label: 'Yd/tgt', dir: 1, fmt: fmt1 },
        { key: 'sep', label: 'Separaz.', dir: 1, fmt: fmt1 },
        { key: 'recDropPct', label: 'Drop%', dir: -1, fmt: _advP },
    ],
};
ADV_RADAR.TE = ADV_RADAR.WR;

/** Radar a serie singola: un vertice per asse, raggio = percentile 0-100. */
function advancedRadarChart(items) {
    const N = items.length;
    const W = 400, H = 360, cx = W / 2, cy = H / 2 + 6, R = 116;
    const ang = i => -Math.PI / 2 + i * 2 * Math.PI / N;
    const pt = (i, r) => [cx + Math.cos(ang(i)) * R * r, cy + Math.sin(ang(i)) * R * r];
    const rings = [0.25, 0.5, 0.75, 1].map(r =>
        `<polygon points="${items.map((_, i) => pt(i, r).map(n => n.toFixed(1)).join(',')).join(' ')}" class="pp-radar-ring"/>`).join('');
    const spokes = items.map((it, i) => {
        const [x, y] = pt(i, 1), [lx, ly] = pt(i, 1.17);
        return `<line x1="${cx}" y1="${cy}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" class="pp-radar-spoke"/>
            <text x="${lx.toFixed(1)}" y="${(ly + 4).toFixed(1)}" class="pp-radar-axl" text-anchor="middle">${esc(it.label)}</text>`;
    }).join('');
    const poly = items.map((it, i) => pt(i, Math.max(0.02, (it.pct ?? 0) / 100)).map(n => n.toFixed(1)).join(',')).join(' ');
    const dots = items.map((it, i) => {
        const [x, y] = pt(i, Math.max(0.02, (it.pct ?? 0) / 100));
        return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.4" class="pp-radar-dot"><title>${esc(it.label)}: ${esc(it.val)}${it.pct == null ? '' : ` · ${ord(it.pct)} percentile`}</title></circle>`;
    }).join('');
    return `<div class="pp-radar"><svg viewBox="0 0 ${W} ${H}" class="an-svg pp-radar-svg" role="img" aria-label="Player advanced radar">${rings}${spokes}<polygon points="${poly}" class="pp-radar-area"/>${dots}</svg></div>`;
}

/**
 * Profilo avanzato di ruolo: radar dei percentili NFL del giocatore nell'ultima
 * stagione avanzata reale, contro il pool pari-ruolo (adv_players). Solo gli assi
 * con dato del giocatore e copertura di pool sufficiente; sotto resta la tabella.
 */
function advancedRadarBlock({ advSeasons, pos, advPool, advYear }) {
    const def = ADV_RADAR[pos];
    if (!def || !advSeasons?.length || !advPool?.length || advYear == null) return '';
    const row = advSeasons.find(a => +a.year === +advYear);
    if (!row) return '';
    const pctile = (vals, x, hb) => {
        const a = vals.filter(v => v != null).sort((p, q) => p - q);
        if (!a.length || x == null) return null;
        const pr = a.filter(v => v <= x).length / a.length * 100;
        return Math.round(hb ? pr : 100 - pr);
    };
    const items = def.map(ax => {
        const x = row[ax.key];
        const vals = advPool.map(p => p[ax.key]).filter(v => v != null);
        if (x == null || vals.length < 8) return null;
        return { label: ax.label, pct: pctile(vals, x, ax.dir > 0), val: ax.fmt(x) };
    }).filter(Boolean);
    if (items.length < 4) return '';
    return `
    <section class="pm-block pp-block">
        <span class="mc-kicker">Advanced profile · ${esc(pos)} ${advYear} · NFL percentiles</span>
        ${advancedRadarChart(items)}
        <p class="pm-note">Each axis is the player's NFL percentile in that advanced metric (${advPool.length} ${esc(pos)} with ≥4 games, ${advYear}); farther from center = better. "Negative" metrics (bad throw%, pressures, drop%) are inverted, so outward = better. Exact values on hover and in the table below.</p>
    </section>`;
}

// ─── Confronto con giocatori simili ──────────────────────────────
const SERIES_COLORS = ['#B8433A', '#4f8cff', '#f59e0b', '#22c55e']; // me + 3 comparabili

/** Radar multi-serie: un poligono per giocatore, raggio = percentile 0-100. */
function overlaidRadarChart(series, labels) {
    const N = labels.length;
    const W = 420, H = 384, cx = W / 2, cy = H / 2 + 8, R = 116;
    const ang = i => -Math.PI / 2 + i * 2 * Math.PI / N;
    const pt = (i, r) => [cx + Math.cos(ang(i)) * R * r, cy + Math.sin(ang(i)) * R * r];
    const rings = [0.25, 0.5, 0.75, 1].map(r =>
        `<polygon points="${labels.map((_, i) => pt(i, r).map(n => n.toFixed(1)).join(',')).join(' ')}" class="pp-radar-ring"/>`).join('');
    const spokes = labels.map((lab, i) => {
        const [x, y] = pt(i, 1), [lx, ly] = pt(i, 1.18);
        return `<line x1="${cx}" y1="${cy}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" class="pp-radar-spoke"/>
            <text x="${lx.toFixed(1)}" y="${(ly + 4).toFixed(1)}" class="pp-radar-axl" text-anchor="middle">${esc(lab)}</text>`;
    }).join('');
    const polys = series.map((s, si) => {
        const poly = s.items.map((it, i) => pt(i, Math.max(0.02, (it.pct ?? 0) / 100)).map(n => n.toFixed(1)).join(',')).join(' ');
        const dots = s.items.map((it, i) => {
            const [x, y] = pt(i, Math.max(0.02, (it.pct ?? 0) / 100));
            return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.8" fill="${s.color}"><title>${esc(s.name)} · ${esc(it.label)}: ${esc(it.val)}${it.pct == null ? '' : ` · ${ord(it.pct)} pct`}</title></circle>`;
        }).join('');
        return `<g class="pp-cmp-series" data-s="${si}"><polygon points="${poly}" fill="${s.color}" fill-opacity="0.10" stroke="${s.color}" stroke-width="2" stroke-linejoin="round"/>${dots}</g>`;
    }).join('');
    return `<div class="pp-radar"><svg viewBox="0 0 ${W} ${H}" class="an-svg pp-radar-svg" role="img" aria-label="Radar di confronto">${rings}${spokes}${polys}</svg></div>`;
}

/** Coordinate parallele: un asse verticale per metrica (percentile 0-100), una spezzata per giocatore. */
function parallelCoordsChart(series, axes) {
    const N = axes.length;
    const W = 680, H = 300, m = { l: 24, r: 24, t: 42, b: 22 };
    const pw = W - m.l - m.r, ph = H - m.t - m.b;
    const xAt = i => m.l + (N > 1 ? i / (N - 1) : 0.5) * pw;
    const yAt = pct => m.t + (1 - (pct ?? 0) / 100) * ph;
    const grid = [0, 50, 100].map(p =>
        `<line x1="${m.l}" y1="${yAt(p).toFixed(1)}" x2="${(m.l + pw).toFixed(1)}" y2="${yAt(p).toFixed(1)}" class="an-gridline"/>
        <text x="${(m.l - 4).toFixed(1)}" y="${(yAt(p) + 3).toFixed(1)}" class="an-tick" text-anchor="end">${p}</text>`).join('');
    const axesSvg = axes.map((ax, i) => {
        const x = xAt(i);
        return `<line x1="${x.toFixed(1)}" y1="${m.t}" x2="${x.toFixed(1)}" y2="${(m.t + ph).toFixed(1)}" class="pp-radar-spoke"/>
            <text x="${x.toFixed(1)}" y="${(m.t - 11).toFixed(1)}" class="pp-radar-axl" text-anchor="middle">${esc(ax.label)}</text>`;
    }).join('');
    const lines = series.map((s, si) => {
        const poly = s.items.map((it, i) => `${xAt(i).toFixed(1)},${yAt(it.pct).toFixed(1)}`).join(' ');
        const dots = s.items.map((it, i) =>
            `<circle cx="${xAt(i).toFixed(1)}" cy="${yAt(it.pct).toFixed(1)}" r="3" fill="${s.color}"><title>${esc(s.name)} · ${esc(it.label)}: ${esc(it.val)}${it.pct == null ? '' : ` · ${ord(it.pct)} pct`}</title></circle>`).join('');
        return `<g class="pp-cmp-series" data-s="${si}"><polyline points="${poly}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round" opacity="0.9"/>${dots}</g>`;
    }).join('');
    return `<div class="pp-cmp-chart"><svg viewBox="0 0 ${W} ${H}" class="an-svg pp-pc-svg" role="img" aria-label="Coordinate parallele di confronto">${grid}${axesSvg}${lines}</svg></div>`;
}

let _simState = null;

/** Ricostruisce le serie (me + selezionati) in percentile NFL dallo stato stashato. */
function _simSeries(names) {
    const st = _simState;
    if (!st) return [];
    const pctile = (vals, x, hb) => { const a = vals.filter(v => v != null).sort((p, q) => p - q); if (!a.length || x == null) return null; const pr = a.filter(v => v <= x).length / a.length * 100; return Math.round(hb ? pr : 100 - pr); };
    const rows = [{ name: st.meDisplay, row: st.me }, ...names.map(n => st.byName.get(n)).filter(Boolean).map(p => ({ name: p.name, row: p }))];
    return rows.map((s, i) => ({
        name: s.name, color: SERIES_COLORS[i % SERIES_COLORS.length],
        items: st.axes.map(ax => { const x = s.row[ax.key]; return { label: ax.label, pct: x == null ? null : pctile(ax.poolVals, x, ax.dir > 0), val: x == null ? '—' : ax.fmt(x) }; }),
    }));
}

/** Legenda + radar sovrapposto + coordinate parallele + tabella per un set di serie. */
function _simRender(series, axes) {
    const legend = `<div class="pp-cmp-legend">${series.map((s, i) =>
        `<span class="pp-cmp-leg" data-series="${i}"><i style="background:${s.color};width:12px;height:12px;border-radius:3px"></i>${esc(s.name)}</span>`).join('')}</div>`;
    const tbl = `
        <details class="pp-recap-ids" style="margin-top:12px">
            <summary>Valori a confronto (${axes.length} metriche)</summary>
            <div class="pm-table-wrap pp-scroll" style="margin-top:10px">
                <table class="pm-table pp-table">
                    <thead><tr><th>Metrica</th>${series.map(s => `<th>${esc(s.name.split(' ').slice(-1)[0])}</th>`).join('')}</tr></thead>
                    <tbody>${axes.map((ax, ai) => `<tr><td>${esc(ax.label)}</td>${series.map(s => `<td>${esc(s.items[ai].val)}${s.items[ai].pct == null ? '' : ` <small>${ord(s.items[ai].pct)}</small>`}</td>`).join('')}</tr>`).join('')}</tbody>
                </table>
            </div>
        </details>`;
    return `${legend}
        <div class="ts-charts">
            <div class="ts-card"><h4 class="ts-sub">Radar sovrapposto</h4>${overlaidRadarChart(series, axes.map(a => a.label))}</div>
            <div class="ts-card"><h4 class="ts-sub">Coordinate parallele</h4>${parallelCoordsChart(series, axes)}</div>
        </div>
        ${tbl}`;
}

/**
 * Confronto con simili: seleziona fino a 3 pari-ruolo (default: produzione più
 * vicina) e sovrappone radar + coordinate parallele in percentili NFL. La
 * selezione è modificabile a runtime (bindSimilarPlayers) e l'hover su una serie
 * la evidenzia. Tabella dei valori come Livello 2. Riusa ADV_RADAR.
 */
function similarPlayersBlock(ctx) {
    const { advSeasons, pos, advPool, advYear, name } = ctx;
    const def = ADV_RADAR[pos];
    if (!def || !advSeasons?.length || !advPool?.length || advYear == null) return '';
    const me = advSeasons.find(a => +a.year === +advYear);
    if (!me || me.fpgLeague == null) return '';
    const norm = s => (s || '').toLowerCase().replace(/[.'`]/g, '').replace(/\s+/g, ' ').trim();
    const meName = norm(name);
    const pool = advPool.filter(p => p.fpgLeague != null && norm(p.name) !== meName)
        .sort((a, b) => Math.abs(a.fpgLeague - me.fpgLeague) - Math.abs(b.fpgLeague - me.fpgLeague));
    if (!pool.length) return '';
    const axes = def.filter(ax => {
        const vals = advPool.map(p => p[ax.key]).filter(v => v != null);
        return vals.length >= 8 && me[ax.key] != null;
    }).map(ax => ({ ...ax, poolVals: advPool.map(p => p[ax.key]).filter(v => v != null) }));
    if (axes.length < 4) return '';

    const defaults = pool.slice(0, 3).map(p => p.name);
    _simState = { me, meDisplay: name, axes, byName: new Map(pool.map(p => [p.name, p])) };

    const optionsFor = (sel) => ['<option value="">— none —</option>'].concat(
        pool.map(p => `<option value="${esc(p.name)}"${p.name === sel ? ' selected' : ''}>${esc(p.name)} · ${fmt1(p.fpgLeague)} pt/g</option>`)).join('');
    const selectors = `<div class="pp-cmp-selectors">${[0, 1, 2].map(i =>
        `<label class="lc-field"><span>Comparabile ${i + 1}</span><select class="pp-cmp-sel" data-slot="${i}">${optionsFor(defaults[i])}</select></label>`).join('')}</div>`;

    return `
    <section class="pm-block pp-block">
        <span class="mc-kicker">Comparison with peers · ${esc(pos)} ${advYear}</span>
        <p class="pm-note">Pick up to 3 position peers (default: closest production, ${advYear}). Each axis is the position's NFL percentile: farther from center (radar) or higher (parallel) = better. "Negative" metrics already inverted. Hover a series (legend or line) to highlight it.</p>
        ${selectors}
        <div id="pp-cmp-host"></div>
    </section>`;
}

/** Interazioni del Confronto: selezione comparabili (re-render) + hover-highlight. */
function bindSimilarPlayers(section) {
    const host = section.querySelector('#pp-cmp-host');
    if (!host || !_simState) return;
    const sels = [...section.querySelectorAll('.pp-cmp-sel')];
    const draw = () => {
        host.innerHTML = _simRender(_simSeries(sels.map(s => s.value).filter(Boolean)), _simState.axes);
        bindCmpHover(host);
    };
    sels.forEach(s => s.addEventListener('change', draw));
    draw();
}

/** Hover su legenda o linea → evidenzia quella serie, attenua le altre. */
function bindCmpHover(host) {
    const all = [...host.querySelectorAll('.pp-cmp-series')];
    const set = (idx) => all.forEach(el => { el.style.opacity = (idx == null || el.dataset.s === String(idx)) ? '' : '0.12'; });
    host.querySelectorAll('.pp-cmp-leg[data-series]').forEach(l => {
        l.addEventListener('mouseenter', () => set(+l.dataset.series));
        l.addEventListener('mouseleave', () => set(null));
    });
    all.forEach(el => {
        el.addEventListener('mouseenter', () => set(+el.dataset.s));
        el.addEventListener('mouseleave', () => set(null));
    });
}

// ─── Slope chart · evoluzione avanzate anno→anno ─────────────────
/** Slope: una linea per metrica in percentile NFL, dallo scorso anno a quest'anno. */
function advancedSlopeChart(items, yearA, yearB) {
    const W = 560, H = Math.max(170, 44 + items.length * 26), m = { l: 210, r: 30, t: 30, b: 14 };
    const ph = H - m.t - m.b, xA = m.l, xB = W - m.r;
    const yAt = pct => m.t + (1 - pct / 100) * ph;
    const headers = `
        <text x="${xA}" y="16" text-anchor="middle" class="pp-slope-yr">${yearA}</text>
        <text x="${xB}" y="16" text-anchor="middle" class="pp-slope-yr">${yearB}</text>
        <text x="6" y="${(m.t + 4).toFixed(0)}" class="pp-slope-ax">100th elite</text>
        <text x="6" y="${(m.t + ph).toFixed(0)}" class="pp-slope-ax">0°</text>`;
    const lines = items.map(it => {
        const yA = yAt(it.pA), yB = yAt(it.pB), cls = it.up ? 'up' : 'down';
        return `<g class="pp-slope-g pp-slope-${cls}">
            <line x1="${xA}" y1="${yA.toFixed(1)}" x2="${xB}" y2="${yB.toFixed(1)}" class="pp-slope-line"/>
            <circle cx="${xA}" cy="${yA.toFixed(1)}" r="3.4" class="pp-slope-dot"/><circle cx="${xB}" cy="${yB.toFixed(1)}" r="3.4" class="pp-slope-dot"/>
            <text x="${(xA - 9).toFixed(0)}" y="${(yA + 3.5).toFixed(1)}" text-anchor="end" class="pp-slope-lbl">${esc(it.label)} · <tspan class="pp-slope-v">${esc(it.vA)} → ${esc(it.vB)}</tspan></text>
        </g>`;
    }).join('');
    return `<div class="pp-cmp-chart"><svg viewBox="0 0 ${W} ${H}" class="an-svg pp-slope-svg" role="img" aria-label="Evoluzione metriche avanzate ${yearA} vs ${yearB}">${headers}${lines}</svg></div>`;
}

/** Confronta le metriche avanzate di ruolo tra le due ultime stagioni (percentile NFL). */
function advancedSlopeBlock(ctx) {
    const { advSeasons, pos, advPool, advYear, advPool2, advYear2 } = ctx;
    const def = ADV_RADAR[pos];
    if (!def || advYear == null || advYear2 == null || !advPool?.length || !advPool2?.length) return '';
    const rowA = advSeasons.find(a => +a.year === +advYear2), rowB = advSeasons.find(a => +a.year === +advYear);
    if (!rowA || !rowB) return '';
    const pctile = (vals, x, hb) => { const a = vals.filter(v => v != null).sort((p, q) => p - q); if (!a.length || x == null) return null; const pr = a.filter(v => v <= x).length / a.length * 100; return Math.round(hb ? pr : 100 - pr); };
    const items = def.map(ax => {
        const vA = rowA[ax.key], vB = rowB[ax.key];
        if (vA == null || vB == null) return null;
        const poolA = advPool2.map(p => p[ax.key]).filter(v => v != null), poolB = advPool.map(p => p[ax.key]).filter(v => v != null);
        if (poolA.length < 8 || poolB.length < 8) return null;
        const pA = pctile(poolA, vA, ax.dir > 0), pB = pctile(poolB, vB, ax.dir > 0);
        if (pA == null || pB == null) return null;
        return { label: ax.label, pA, pB, vA: ax.fmt(vA), vB: ax.fmt(vB), up: pB >= pA };
    }).filter(Boolean);
    if (items.length < 3) return '';
    const improved = items.filter(i => i.up).length;
    return `
    <section class="pm-block pp-block">
        <span class="mc-kicker">Advanced evolution · ${advYear2} → ${advYear}</span>
        ${advancedSlopeChart(items, advYear2, advYear)}
        <p class="pm-note">Each line is an advanced position metric in <b>NFL percentile</b>: rises (<b style="color:#22c55e">green</b>) if improved vs the prior year, falls (<b style="color:var(--accent-red)">red</b>) if worsened. <b>${improved}/${items.length}</b> metrics improving between ${advYear2} and ${advYear}.</p>
    </section>`;
}

function advancedNflverseBlock(advSeasons, pos) {
    if (!advSeasons?.length) return '';
    const cols = advCols(pos);
    const rows = [...advSeasons].sort((a, b) => b.year - a.year).map(s => `
        <tr${s.provisional ? ' class="pp-adv-prov"' : ''}><td>${s.year}${s.provisional ? '<span class="pp-adv-star" title="Provvisorio (Sleeper)">*</span>' : ''}</td><td>${fmt0(s.gp)}</td>${cols.map(([, f]) => `<td>${f(s)}</td>`).join('')}</tr>`).join('');
    const hasProv = advSeasons.some(s => s.provisional);
    return `
    <section class="pm-block pp-block">
        <span class="mc-kicker">Advanced metrics · nflverse (snap counts, Next Gen Stats, PFR advanced)</span>
        <div class="pm-table-wrap pp-scroll">
            <table class="pm-table pp-table">
                <thead><tr><th>Year</th><th>GP</th>${cols.map(([h]) => `<th>${h}</th>`).join('')}</tr></thead>
                <tbody>${rows}</tbody>
            </table>
        </div>
        <p class="pm-note">Advanced NFL data missing on Sleeper — target/snap share, WOPR, EPA, separation and cushion (Next Gen Stats), YBC/YAC and broken tackles, drops, QB pressures (PFR). Some tracking/PFR fields start from 2016-2018 and may be missing for the most recent seasons if nflverse has not published them yet. Same data that powers the Player Context Score (SOS+) in Draft Grades.${hasProv ? ' <b>Seasons marked *</b> are provisional: computed from the Sleeper box score while awaiting nflverse data (only snap%, catch%, per-target/carry production); tracking/EPA/share metrics appear on their own once nflverse publishes.' : ''}</p>
    </section>`;
}

// ─── Carriera per categoria ──────────────────────────────────────

const g0 = (s, k) => s?.[k] != null ? fmt0(s[k]) : '—';
const g1 = (s, k) => s?.[k] != null ? fmt1(s[k]) : '—';

const CATEGORIES = [
    {
        title: 'Passaggio', has: s => (s.pass_att || 0) > 0,
        head: ['Cmp/Att', '%', 'Yard', 'TD', 'INT', 'Rating', 'Sack', 'Air yd', '1st down', 'RZ att', '2pt'],
        cells: s => [
            s.pass_att != null ? `${fmt0(s.pass_cmp)}/${fmt0(s.pass_att)}` : '—',
            g1(s, 'cmp_pct'), g0(s, 'pass_yd'), g0(s, 'pass_td'), g0(s, 'pass_int'),
            g1(s, 'pass_rtg'), g0(s, 'pass_sack'), g0(s, 'pass_air_yd'), g0(s, 'pass_fd'),
            g0(s, 'pass_rz_att'), g0(s, 'pass_2pt')],
        chartLabel: 'Yard di passaggio', chartValue: s => s.pass_yd, chartUnit: 'yard',
    },
    {
        title: 'Corsa', has: s => (s.rush_att || 0) > 0,
        head: ['Att', 'Yds', 'Avg', 'TD', 'Long', '1st down', 'RZ att', 'YAC'],
        cells: s => [
            g0(s, 'rush_att'), g0(s, 'rush_yd'), g1(s, 'rush_ypa'), g0(s, 'rush_td'),
            g0(s, 'rush_lng'), g0(s, 'rush_fd'), g0(s, 'rush_rz_att'), g0(s, 'rush_yac')],
        chartLabel: 'Rushing yards', chartValue: s => s.rush_yd, chartUnit: 'yard',
    },
    {
        title: 'Ricezione', has: s => (s.rec_tgt || 0) > 0 || (s.rec || 0) > 0,
        head: ['Target', 'Rec', 'Yds', 'Avg', 'TD', 'Long', 'Air yd', 'YAC', '1st down', 'RZ tgt', 'Drop'],
        cells: s => [
            g0(s, 'rec_tgt'), g0(s, 'rec'), g0(s, 'rec_yd'), g1(s, 'rec_ypr'), g0(s, 'rec_td'),
            g0(s, 'rec_lng'), g0(s, 'rec_air_yd'), g0(s, 'rec_yar'), g0(s, 'rec_fd'),
            g0(s, 'rec_rz_tgt'), g0(s, 'rec_drop')],
        chartLabel: 'Yard di ricezione', chartValue: s => s.rec_yd, chartUnit: 'yard',
    },
    {
        title: 'Kicking', has: s => (s.fga || 0) > 0 || (s.fgm || 0) > 0 || (s.xpa || 0) > 0,
        head: ['FG', '%', '0-19', '20-29', '30-39', '40-49', '50+', 'Lungo', 'XP'],
        cells: s => [
            `${fmt0(s.fgm ?? 0)}/${fmt0(s.fga ?? 0)}`,
            s.fga ? fmt1((s.fgm || 0) / s.fga * 100) : '—',
            g0(s, 'fgm_0_19'), g0(s, 'fgm_20_29'), g0(s, 'fgm_30_39'), g0(s, 'fgm_40_49'),
            g0(s, 'fgm_50p'), g0(s, 'fgm_lng'),
            `${fmt0(s.xpm ?? 0)}/${fmt0(s.xpa ?? 0)}`],
        chartLabel: 'Field goal realizzati', chartValue: s => s.fgm, chartUnit: 'FG',
    },
    {
        title: 'Individual defense (IDP)', has: s => (s.idp_tkl || 0) > 0 || (s.idp_sack || 0) > 0,
        head: ['Tackle', 'Solo', 'Sack', 'INT', 'FF', 'Fum rec', 'Pass dif.', 'QB hit', 'TFL', 'TD', 'Safety'],
        cells: s => [
            g0(s, 'idp_tkl'), g0(s, 'idp_tkl_solo'), g1(s, 'idp_sack'), g0(s, 'idp_int'),
            g0(s, 'idp_ff'), g0(s, 'idp_fum_rec'), g0(s, 'idp_pass_def'), g0(s, 'idp_qb_hit'),
            g0(s, 'idp_tkl_loss'), g0(s, 'idp_def_td'), g0(s, 'idp_safe')],
        chartLabel: 'Tackle', chartValue: s => s.idp_tkl, chartUnit: 'tackle',
    },
    {
        title: 'Ritorni', has: s => (s.kr || 0) > 0 || (s.pr || 0) > 0,
        head: ['Kick ret', 'Yard KR', 'Punt ret', 'Yard PR', 'TD ritorno'],
        cells: s => [g0(s, 'kr'), g0(s, 'kr_yd'), g0(s, 'pr'), g0(s, 'pr_yd'),
            fmt0((s.kr_td || 0) + (s.pr_td || 0) || (s.st_td ?? null))],
        chartLabel: 'Yard di ritorno (kick + punt)', chartValue: s => (s.kr_yd || 0) + (s.pr_yd || 0), chartUnit: 'yard',
    },
];

function categoryTables(seasons, pos) {
    if (!seasons.length) return '';
    const panels = [];

    // Fantasy sempre per primo se ci sono totali
    const fRows = seasons.filter(s => s.totals?.stats);
    if (fRows.length) {
        const body = fRows.map(s => {
            const st = s.totals.stats;
            const snaps = st.off_snp && st.tm_off_snp ? fmt0(st.off_snp / st.tm_off_snp * 100) + '%' : '—';
            return `<tr><td>${s.year}</td><td>${g0(st, 'gp')}</td><td class="pm-td-strong">${s.totals.pts != null ? fmt1(s.totals.pts) : '—'}</td><td>${g1(st, 'pts_std')}</td><td>${g1(st, 'pts_half_ppr')}</td><td>${g1(st, 'pts_ppr')}</td><td>${s.totals.posRank ? `${pos}${s.totals.posRank}` : '—'}</td><td>${snaps}</td></tr>`;
        }).join('');
        const table = `
            <div class="pm-table-wrap pp-scroll">
                <table class="pm-table pp-table">
                    <thead><tr><th>Year</th><th>GP</th><th>League pts</th><th>Std</th><th>Half</th><th>PPR</th><th>Rank</th><th>Snap %</th></tr></thead>
                    <tbody>${body}</tbody>
                </table>
            </div>`;
        const points = [...fRows].sort((a, b) => a.year - b.year)
            .map(s => ({ x: s.year, y: s.totals.pts })).filter(p => p.y != null);
        const chart = points.length >= 2 ? buildTrendChart(points, '#B8433A', 'pp-cat-chart-fantasy') : '';
        panels.push({ key: 'fantasy', label: 'Fantasy', html: `${table}${chart ? `<h3 class="pp-cat-title" style="margin-top:18px">League pts per season</h3>${chart}` : ''}` });
    }

    for (const cat of CATEGORIES) {
        const rows = seasons.filter(s => s.totals?.stats && cat.has(s.totals.stats));
        if (!rows.length) continue;
        const body = rows.map(s => `<tr><td>${s.year}</td>${cat.cells(s.totals.stats).map(c => `<td>${c}</td>`).join('')}</tr>`).join('');
        const table = `
            <div class="pm-table-wrap pp-scroll">
                <table class="pm-table pp-table">
                    <thead><tr><th>Year</th>${cat.head.map(h => `<th>${h}</th>`).join('')}</tr></thead>
                    <tbody>${body}</tbody>
                </table>
            </div>`;
        const key = cat.title.toLowerCase().replace(/[^a-z]+/g, '-');
        const points = [...rows].sort((a, b) => a.year - b.year)
            .map(s => ({ x: s.year, y: cat.chartValue(s.totals.stats) })).filter(p => p.y != null);
        const chart = points.length >= 2 ? buildTrendChart(points, '#4f8cff', `pp-cat-chart-${key}`, cat.chartUnit) : '';
        panels.push({ key, label: cat.title, html: `${table}${chart ? `<h3 class="pp-cat-title" style="margin-top:18px">${esc(cat.chartLabel)} per stagione</h3>${chart}` : ''}` });
    }

    if (!panels.length) return '';
    const buttons = panels.map((p, i) => `<button class="an-ptbl-mode-pill pp-cat-btn${i === 0 ? ' active' : ''}" data-cat="${p.key}">${esc(p.label)}</button>`).join('');
    const bodies = panels.map((p, i) => `<div class="pp-cat" data-cat-panel="${p.key}"${i === 0 ? '' : ' hidden'}>${p.html}</div>`).join('');
    return `
    <section class="pm-block pp-block">
        <span class="mc-kicker">NFL career by category</span>
        <div class="an-ptbl-mode-toggle pp-cat-toggle">${buttons}</div>
        ${bodies}
    </section>`;
}

/** Selettore categoria: mostra un solo pannello (tabella+grafico) alla volta. */
function bindCategoryTabs(section) {
    section.querySelectorAll('.pp-cat-toggle').forEach(toggle => {
        toggle.addEventListener('click', (e) => {
            const btn = e.target.closest('.pp-cat-btn');
            if (!btn) return;
            const block = toggle.closest('.pm-block');
            toggle.querySelectorAll('.pp-cat-btn').forEach(b => b.classList.toggle('active', b === btn));
            block.querySelectorAll('[data-cat-panel]').forEach(p => { p.hidden = p.dataset.catPanel !== btn.dataset.cat; });
        });
    });
}

/**
 * Totali di carriera da Pro Football Reference (draft_picks.csv, la stessa
 * riga usata per il draft NFL reale) — copre anche le stagioni precedenti al
 * 2015 che Sleeper (player-full.js, FIRST_STATS_YEAR) non ha: gap-fill per i
 * veterani con carriera iniziata prima. Riusa le CATEGORIES di categoryTables.
 */
function careerTotalsPfrBlock(combineDraft) {
    const t = combineDraft?.careerTotals;
    if (!t) return '';
    const s = {
        pass_att: t.passAtt, pass_cmp: t.passCmp, pass_yd: t.passYd, pass_td: t.passTd, pass_int: t.passInt,
        rush_att: t.rushAtt, rush_yd: t.rushYd, rush_td: t.rushTd,
        rec: t.rec, rec_yd: t.recYd, rec_td: t.recTd,
        idp_tkl: t.defSoloTkl, idp_tkl_solo: t.defSoloTkl, idp_sack: t.defSack, idp_int: t.defInt,
    };
    const blocks = CATEGORIES.map(cat => {
        if (!cat.has(s)) return '';
        return `
        <div class="pp-cat">
            <h3 class="pp-cat-title">${cat.title}</h3>
            <div class="pm-table-wrap pp-scroll">
                <table class="pm-table pp-table">
                    <thead><tr><th></th>${cat.head.map(h => `<th>${h}</th>`).join('')}</tr></thead>
                    <tbody><tr><td>Career total</td>${cat.cells(s).map(c => `<td>${c}</td>`).join('')}</tr></tbody>
                </table>
            </div>
        </div>`;
    }).filter(Boolean).join('');
    if (!blocks) return '';
    const av = [
        combineDraft.draft?.careerAV != null ? factChip(combineDraft.draft.careerAV, 'Career AV') : '',
        combineDraft.draft?.weightedAV != null ? factChip(combineDraft.draft.weightedAV, 'AV pesato') : '',
        combineDraft.draft?.lastSeason != null ? factChip(combineDraft.draft.lastSeason, 'last season') : '',
    ].filter(Boolean).join('');
    return `
    <section class="pm-block pp-block">
        <span class="mc-kicker">Career total · Pro Football Reference</span>
        ${blocks}
        ${av ? `<div class="pp-fact-chips" style="margin-top:10px">${av}</div>` : ''}
        <p class="pm-note">Totali dell'intera carriera NFL (anche le stagioni precedenti al ${FIRST_STATS_YEAR}, non coperte da Sleeper qui sopra).</p>
    </section>`;
}

/** Dove si piazza il pick di questo giocatore tra tutti quelli della stessa posizione nello stesso draft NFL. */
function draftScatterBlock({ combineDraft, draftPeers, name }) {
    const d = combineDraft?.draft;
    if (!d || !draftPeers?.length) return '';
    const chart = buildDraftScatterChart(draftPeers, name, 'pp-draft-scatter');
    if (!chart) return '';
    return `
    <section class="pm-block pp-block">
        <span class="mc-kicker">Draft ${d.season} · ${d.team}${d.round ? ` — all ${draftPeers.length} ${combineDraft.pos || ''} picked that year` : ''}</span>
        ${chart}
        <p class="pm-note">Overall pick (x axis) vs career Approximate Value — PFR (y axis). Larger red dot = this player.</p>
    </section>`;
}

/** Confronto proiezione preseason vs statistiche reali, anno per anno. */
/**
 * Tabella completa delle proiezioni preseason anno per anno: punti proiettati
 * (scoring lega e standard), ADP, partite proiettate, punti reali e delta.
 * Include la stagione in arrivo (solo proiezione). Dati Rotowire via Sleeper.
 */
/** Proiezioni · tabelle unite (punti + statistiche per anno) in un solo <details> L2. */
function projectionTablesBlock(ctx) {
    const args = { seasons: ctx.full.seasons, projByYear: ctx.projByYear, nextSeasonProj: ctx.nextSeasonProj, nextSeason: ctx.nextSeason };
    const t = projectionsTableBlock(args);
    const s = projectedStatsBlock({ projByYear: ctx.projByYear, nextSeasonProj: ctx.nextSeasonProj, nextSeason: ctx.nextSeason });
    if (!t && !s) return '';
    return `
    <details class="pp-recap-ids" style="margin-top:14px">
        <summary>Projections · full tables (points and stats by year)</summary>
        <div style="margin-top:8px">${t}${s}</div>
    </details>`;
}

function projectionsTableBlock({ seasons, projByYear, nextSeasonProj, nextSeason }) {
    if (!projByYear) return '';
    const actualByYear = {};
    for (const s of seasons || []) actualByYear[s.year] = s.totals?.pts ?? null;

    const rows = Object.keys(projByYear).map(Number).sort((a, b) => a - b)
        .filter(y => projByYear[y])
        .map(y => ({ year: y, p: projByYear[y], actual: actualByYear[y] ?? null, upcoming: false }));

    if (nextSeasonProj && (nextSeasonProj.projPts != null || nextSeasonProj.adp != null)) {
        rows.push({ year: nextSeason, p: nextSeasonProj, actual: null, upcoming: true });
    }
    if (!rows.length) return '';

    const body = rows.map(({ year, p, actual, upcoming }) => {
        const delta = (p.projPts != null && actual != null) ? actual - p.projPts : null;
        const deltaCell = delta == null ? '—'
            : `<span class="pp-res pp-res--${delta >= 0 ? 'w' : 'l'}">${delta >= 0 ? '+' : ''}${fmt0(delta)}</span>`;
        return `<tr${upcoming ? ' class="pp-proj-upcoming"' : ''}>
            <td>${year}${upcoming ? ' <small>preseason</small>' : ''}</td>
            <td class="pm-td-strong">${fmt0(p.projPts)}</td>
            <td>${fmt0(p.ptsStd)}</td>
            <td>${p.adp != null ? fmt1(p.adp) : '—'}</td>
            <td>${fmt0(p.gp)}</td>
            <td>${actual != null ? fmt0(actual) : '—'}</td>
            <td>${deltaCell}</td>
        </tr>`;
    }).join('');

    return `
    <section class="pm-block pp-block">
        <span class="mc-kicker">Preseason projections · year by year</span>
        <div class="pm-table-wrap pp-scroll">
            <table class="pm-table pp-table">
                <thead><tr><th>Year</th><th>Proj league pts</th><th>Proj std pts</th><th>ADP</th><th>Proj GP</th><th>Actual pts</th><th>Δ</th></tr></thead>
                <tbody>${body}</tbody>
            </table>
        </div>
        <p class="pm-note">Rotowire preseason projections (via Sleeper) and half-PPR ADP (since 2018). Δ = actual − projected points (green = above projection, red = below).</p>
    </section>`;
}

const PROJPATH = { w: 560, h: 380, l: 46, r: 20, t: 20, b: 40 };

/**
 * Traiettoria proiettato→reale: uno scatter con X = punti proiettati, Y = punti
 * reali, un punto per stagione connesso in ordine cronologico. La diagonale y=x
 * è l'attesa: sopra = ha reso oltre, sotto = sotto. Verde/rosso per lato, la
 * stagione più recente evidenziata. `rows` = [{x:year, projected, actual}].
 */
function projActualPathChart(rows) {
    const pts = rows.filter(r => r.projected != null && r.actual != null).sort((a, b) => a.x - b.x);
    if (pts.length < 2) return '';
    const C = PROJPATH, pw = C.w - C.l - C.r, ph = C.h - C.t - C.b;
    const vals = pts.flatMap(p => [p.projected, p.actual]);
    let lo = Math.min(...vals), hi = Math.max(...vals);
    const pad = (hi - lo) * 0.1 || 10; lo = Math.max(0, lo - pad); hi += pad;
    const X = v => C.l + (v - lo) / (hi - lo) * pw;
    const Y = v => C.t + (1 - (v - lo) / (hi - lo)) * ph;
    const ticks = niceTicks(lo, hi);
    const grid = ticks.map(v => `
        <line x1="${C.l}" y1="${Y(v).toFixed(1)}" x2="${(C.l + pw).toFixed(1)}" y2="${Y(v).toFixed(1)}" class="an-gridline"/>
        <text x="${C.l - 6}" y="${(Y(v) + 3).toFixed(1)}" class="an-tick" text-anchor="end">${v}</text>
        <text x="${X(v).toFixed(1)}" y="${(C.t + ph + 18).toFixed(1)}" class="an-tick" text-anchor="middle">${v}</text>`).join('');
    const diag = `<line x1="${X(lo).toFixed(1)}" y1="${Y(lo).toFixed(1)}" x2="${X(hi).toFixed(1)}" y2="${Y(hi).toFixed(1)}" class="pp-pp-diag"/>
        <text x="${(X(hi) - 4).toFixed(1)}" y="${(Y(hi) + 15).toFixed(1)}" class="pp-pp-diaglbl" text-anchor="end">above = beat expectations</text>`;
    const line = `<polyline points="${pts.map(p => `${X(p.projected).toFixed(1)},${Y(p.actual).toFixed(1)}`).join(' ')}" class="pp-pp-line"/>`;
    const dots = pts.map((p, i) => {
        const beat = p.actual >= p.projected, recent = i === pts.length - 1, r = recent ? 6 : 4.5;
        const d = p.actual - p.projected;
        return `<g class="pp-pp-g"><circle cx="${X(p.projected).toFixed(1)}" cy="${Y(p.actual).toFixed(1)}" r="${r}" class="pp-pp-dot pp-pp-dot--${beat ? 'up' : 'down'}${recent ? ' pp-pp-dot--recent' : ''}"><title>${p.x}: reale ${fmt0(p.actual)} vs proiettato ${fmt0(p.projected)} (${d >= 0 ? '+' : ''}${fmt0(d)})</title></circle>
            <text x="${(X(p.projected) + r + 3).toFixed(1)}" y="${(Y(p.actual) + 3).toFixed(1)}" class="pp-pp-lbl">${p.x}</text></g>`;
    }).join('');
    const axl = `<text x="${(C.l + pw).toFixed(1)}" y="${C.h - 6}" class="an-tick pp-pp-axl" text-anchor="end">proiettato →</text>
        <text x="${(C.l - 40).toFixed(1)}" y="${(C.t + 8).toFixed(1)}" class="an-tick pp-pp-axl" text-anchor="start">actual ↑</text>`;
    return `<div class="pp-cmp-chart"><svg viewBox="0 0 ${C.w} ${C.h}" class="an-svg pp-pp-svg" role="img" aria-label="Projected vs actual by season">${grid}${diag}${line}${dots}${axl}</svg></div>`;
}

function projVsActualBlock({ seasons, projByYear }) {
    if (!projByYear) return '';
    const rows = [...seasons].filter(s => s.weekly.length >= 2 || s.totals?.pts != null)
        .sort((a, b) => a.year - b.year)
        .map(s => {
            const p = projByYear[s.year];
            const projected = p ? (p.projPts ?? p.ptsStd) : null;
            const actual = s.totals?.pts ?? null;
            return { x: s.year, projected, actual };
        })
        .filter(r => r.projected != null || r.actual != null);
    const withBoth = rows.filter(r => r.projected != null && r.actual != null);
    if (withBoth.length < 2) return '';
    const chart = projActualPathChart(rows);
    if (!chart) return '';
    const avgDelta = withBoth.reduce((s, r) => s + (r.actual - r.projected), 0) / withBoth.length;
    const beats = withBoth.filter(r => r.actual >= r.projected).length;
    return `
    <section class="pm-block pp-block">
        <span class="mc-kicker">Projected vs actual · trajectory by season</span>
        ${chart}
        <p class="pm-note">Each dot is a season: X = preseason projected points (Rotowire via Sleeper), Y = actual league points; the line connects seasons chronologically. Above the diagonal = overperformed expectations (green), below = underperformed (red). Beat the projection in <b>${beats}/${withBoth.length}</b> seasons${avgDelta != null ? `, on average ${avgDelta >= 0 ? '+' : ''}${fmt1(avgDelta)} pts/season` : ''}. Exact numbers in the projections table below.</p>
    </section>`;
}

/** Etichetta infortunio dominante di una stagione (dal record playerInjuries). */
function injuryLabelForSeason(pi) {
    if (!pi?.weeks) return null;
    const NOT_INJURY = /not injury related|resting|personal|coach|load management/i;
    const groups = groupInjuryWeeks(pi.weeks).filter(g => !NOT_INJURY.test(g.injury));
    if (!groups.length) return null;
    return groups.slice().sort((a, b) => (b.to - b.from) - (a.to - a.from))[0].injury;
}

/**
 * Perché il giocatore ha reso così — scorecard STATISTICA proiettato→reale.
 * Per ogni stagione confronta le stat proiettate (Sleeper preseason) con quelle
 * reali e traduce ogni differenza in punti-lega (Δstat × peso scoring): le voci
 * sommano ESATTAMENTE all'errore. Le assenze sono un indicatore a parte (per non
 * contarle due volte nelle stat di volume). Vedi js/data/perf-explain.js.
 */
function perfExplainBlock(ctx) {
    const { pos, full, projByYear, playerInjuries, causesByYear } = ctx;
    const injByYear = {};
    for (const pi of (playerInjuries || [])) injByYear[pi.year] = pi;

    const eligible = (full?.seasons || []).filter(s => projByYear?.[s.year]?.raw && s.totals?.stats);
    if (!eligible.length) return '';

    const seasons = eligible.sort((a, b) => b.year - a.year).map(s => {
        const dec = decomposeSeason({ pos, proj: projByYear[s.year].raw, actual: s.totals.stats });
        if (!dec) return '';
        const injLabel = injuryLabelForSeason(injByYear[s.year]);
        const verdict = seasonVerdict(dec, injLabel);
        const causeItems = describeCauses(causesByYear?.[s.year], dec);
        const shown = dec.rows.filter(r => Math.abs(r.pts) >= 1);
        const maxAbs = Math.max(1, ...shown.map(r => Math.abs(r.pts)));

        // totali stagionali: interi senza decimali, frazionari (proiezioni) con 1
        const fmtN = (v) => (Math.abs(v - Math.round(v)) < 0.05 ? fmt0(v) : fmt1(v));
        const statRow = (r) => {
            const w = Math.abs(r.pts) / maxAbs * 50;
            const up = r.pts >= 0;
            return `
            <div class="pp-pe-row">
                <span class="pp-pe-stat">${r.label}</span>
                <span class="pp-pe-cmp">${fmtN(r.proj)} <span class="pp-pe-arr">→</span> <b>${fmtN(r.actual)}</b>${r.unit ? ` <small>${r.unit}</small>` : ''}</span>
                <span class="pp-pe-track"><span class="pp-pe-zero"></span><span class="pp-pe-fill pp-pe-fill--${up ? 'up' : 'down'}" style="left:${up ? 50 : 50 - w}%;width:${w}%"></span></span>
                <span class="pp-pe-val pp-pe-val--${up ? 'up' : 'down'}">${up ? '+' : ''}${fmt0(r.pts)}</span>
            </div>`;
        };
        const rowsHtml = shown.map(statRow).join('') +
            (Math.abs(dec.residual) >= 2 ? `<div class="pp-pe-row pp-pe-row--muted"><span class="pp-pe-stat">Altro (2pt/bonus)</span><span class="pp-pe-cmp"></span><span class="pp-pe-track"></span><span class="pp-pe-val">${dec.residual >= 0 ? '+' : ''}${fmt0(dec.residual)}</span></div>` : '');

        const readoutHtml = dec.readouts.length
            ? `<div class="pp-pe-readouts">${dec.readouts.map(r => `${r.label}: ${r.proj != null ? `${r.proj}<span class="pp-pe-arr">→</span>` : ''}<b>${r.actual}</b>`).join(' · ')}</div>`
            : '';
        const causesHtml = causeItems.length
            ? `<div class="pp-pe-causes"><span class="pp-pe-causes-lbl">Why</span>${causeItems.map(c => `<div class="pp-pe-cause"><span class="pp-pe-cause-ic">${c.icon}</span> ${c.text}</div>`).join('')}</div>`
            : '';

        const missed = dec.gpP - dec.gpA;
        return `
        <div class="pp-pe-season">
            <div class="pp-pe-head">${s.year}: reale <b>${fmt0(dec.actPts)}</b> − proiettato ${fmt0(dec.projPts)} = <span class="pp-res pp-res--${dec.error >= 0 ? 'w' : 'l'}">${dec.error >= 0 ? '+' : ''}${fmt0(dec.error)}</span> · ${dec.gpA}/${dec.gpP} gare${missed >= 2 ? ` <span class="pp-pe-miss">(${missed} saltate)</span>` : ''}</div>
            ${verdict?.headline ? `<div class="pp-perr-verdict pp-perr-verdict--${dec.error >= 0 ? 'w' : 'l'}">${verdict.headline}</div>` : ''}
            <div class="pp-pe-rows">${rowsHtml}</div>
            ${readoutHtml}
            ${causesHtml}
        </div>`;
    }).join('');
    if (!seasons.trim()) return '';

    return `
    <section class="pm-block pp-block">
        <span class="mc-kicker">Why he performed this way · projected vs actual, stat by stat</span>
        ${seasons}
        <p class="pm-note">Each row is a stat: <b>projected → actual</b> (season totals) and the league-points impact (difference × scoring value). The items add up EXACTLY to the error (actual − projected). Missed games are not a separate row — they reduce volume totals — but are flagged separately. The <b>Why</b> section ties the changes to the real context: teammates' injuries, roster moves, offensive performance and schedule difficulty.</p>
    </section>`;
}

/**
 * Statistiche proiettate (non solo i punti) anno per anno, dai campi grezzi di
 * Sleeper (rush_yd, pass_td, rec, ecc.) — una riga per stagione proiettata più
 * la stagione in arrivo (preseason). Riusa le stesse CATEGORIES/celle della
 * carriera reale qui sopra.
 */
function projectedStatsBlock({ projByYear, nextSeasonProj, nextSeason }) {
    const entries = [];
    Object.keys(projByYear || {}).map(Number).sort((a, b) => a - b).forEach(y => {
        if (projByYear[y]?.raw) entries.push({ year: y, stats: projByYear[y].raw, upcoming: false });
    });
    if (nextSeasonProj?.raw) entries.push({ year: nextSeason, stats: nextSeasonProj.raw, upcoming: true });
    if (!entries.length) return '';

    const blocks = CATEGORIES.map(cat => {
        const rows = entries.filter(e => cat.has(e.stats));
        if (!rows.length) return '';
        // Le proiezioni Rotowire non riempiono tutti i campi: tieni solo le
        // colonne con almeno un valore (niente colonne di soli "—").
        const cellsByRow = rows.map(e => cat.cells(e.stats));
        const keep = cat.head.map((_, i) => cellsByRow.some(cells => cells[i] != null && cells[i] !== '—' && cells[i] !== ''));
        const head = cat.head.filter((_, i) => keep[i]);
        const body = rows.map((e, ri) => {
            const cells = cellsByRow[ri].filter((_, i) => keep[i]);
            return `<tr${e.upcoming ? ' class="pp-proj-upcoming"' : ''}><td>${e.year}${e.upcoming ? ' <small>preseason</small>' : ''}</td>${cells.map(c => `<td>${c}</td>`).join('')}</tr>`;
        }).join('');
        return `
        <div class="pp-cat">
            <h3 class="pp-cat-title">${cat.title}</h3>
            <div class="pm-table-wrap pp-scroll">
                <table class="pm-table pp-table">
                    <thead><tr><th>Year</th>${head.map(h => `<th>${h}</th>`).join('')}</tr></thead>
                    <tbody>${body}</tbody>
                </table>
            </div>
        </div>`;
    }).filter(Boolean).join('');
    if (!blocks) return '';
    return `
    <section class="pm-block pp-block">
        <span class="mc-kicker">Projected stats · year by year</span>
        ${blocks}
        <p class="pm-note">Proiezioni preseason Rotowire (via Sleeper) — yard, TD, ricezioni ecc. proiettati per stagione; ultima riga (evidenziata) = stagione in arrivo ${nextSeason}, non ancora giocata.</p>
    </section>`;
}

// ─── Game log ────────────────────────────────────────────────────

function logCols(pos) {
    if (pos === 'QB') return {
        head: ['Cmp/Att', 'Yard', 'TD', 'INT', 'Rating'],
        cells: s => [s.pass_att != null ? `${fmt0(s.pass_cmp)}/${fmt0(s.pass_att)}` : '—',
            g0(s, 'pass_yd'), g0(s, 'pass_td'), g0(s, 'pass_int'), g1(s, 'pass_rtg')],
    };
    if (pos === 'RB') return {
        head: ['Att', 'Rush yds', 'TD', 'Rec', 'Rec yds'],
        cells: s => [g0(s, 'rush_att'), g0(s, 'rush_yd'),
            fmt0((s.rush_td || 0) + (s.rec_td || 0)), g0(s, 'rec'), g0(s, 'rec_yd')],
    };
    if (pos === 'K') return {
        head: ['FG', 'Lungo', 'XP'],
        cells: s => [`${fmt0(s.fgm ?? 0)}/${fmt0(s.fga ?? 0)}`, g0(s, 'fgm_lng'), `${fmt0(s.xpm ?? 0)}/${fmt0(s.xpa ?? 0)}`],
    };
    if (pos === 'DEF') return {
        head: ['Sack', 'INT', 'Fum rec', 'TD', 'Pt subiti', 'Yd concesse'],
        cells: s => [g0(s, 'sack'), g0(s, 'int'), g0(s, 'fum_rec'), g0(s, 'def_td'), g0(s, 'pts_allow'), g0(s, 'yds_allow')],
    };
    return { // WR / TE
        head: ['Target', 'Rec', 'Yard', 'TD'],
        cells: s => [g0(s, 'rec_tgt'), g0(s, 'rec'), g0(s, 'rec_yd'), g0(s, 'rec_td')],
    };
}

function gamelogBlock(seasons, pos) {
    const withLog = seasons.filter(s => s.weekly.length);
    if (!withLog.length) return '';
    const cols = logCols(pos);

    const details = withLog.map((s, i) => {
        const rows = s.weekly.map(g => {
            const snap = snapSharePct(g);
            return `<tr>
                <td>W${g.week}</td>
                <td class="pp-opp">${g.opponent ? `${g.isAway ? '@' : 'v'}<img class="pp-opp-logo" src="${teamLogo(g.opponent)}" alt="${esc(g.opponent)}" title="${g.isAway ? '@ ' : 'vs '}${esc(g.opponent)}" onerror="this.style.display='none'">` : '—'}</td>
                ${cols.cells(g.stats).map(c => `<td>${c}</td>`).join('')}
                <td>${snap != null ? snap + '%' : '—'}</td>
                <td class="pm-td-strong">${g.pts != null ? fmt1(g.pts) : '—'}</td>
                <td>${g.stats.pts_half_ppr != null ? fmt1(g.stats.pts_half_ppr) : '—'}</td>
            </tr>`;
        }).join('');
        return `
        <details class="pp-gamelog"${i === 0 ? ' open' : ''}>
            <summary>Season ${s.year} <span class="pp-gamelog-meta">${s.weekly.length} games${s.totals?.pts != null ? ` · ${fmt1(s.totals.pts)} league pts` : ''}</span></summary>
            <div class="pm-table-wrap pp-scroll">
                <table class="pm-table pp-table pp-table--compact">
                    <thead><tr><th>Sett.</th><th>Avv.</th>${cols.head.map(h => `<th>${h}</th>`).join('')}<th>Snap</th><th>League pts</th><th>Half</th></tr></thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>
        </details>`;
    }).join('');

    return `
    <section class="pm-block pp-block">
        <span class="mc-kicker">Game log · all seasons</span>
        ${details}
    </section>`;
}

// ─── Contesto squadra e matchup ──────────────────────────────────

export function rankBadge(rank) {
    if (rank == null) return '';
    const cls = rank <= 10 ? 'pp-rank--good' : rank >= 23 ? 'pp-rank--bad' : '';
    return ` <span class="pp-rank ${cls}">${ord(rank)}</span>`;
}

/** Meter lineare 0-100% (percentile su 32 squadre dal rank) — riusa dgt-sos-bar. */
export function meterBar(label, valueDisplay, rank) {
    if (valueDisplay == null) return '';
    const pct = rank != null ? Math.max(3, Math.min(100, (33 - rank) / 32 * 100)) : 50;
    const cls = rank != null ? (rank <= 10 ? ' up' : rank >= 23 ? ' down' : '') : '';
    return `
    <div class="dgt-sos-bar${cls}">
        <span class="dgt-sos-label">${esc(label)}</span>
        <span class="dgt-sos-track"><span style="width:${pct}%"></span></span>
        <span class="dgt-sos-val">${valueDisplay}${rank != null ? ` ${ord(rank)}` : ''}</span>
    </div>`;
}

/**
 * Storia della squadra: punti/gara e record per ogni stagione disponibile
 * (dal calendario, team_stats_{Y}.json) col QB titolare dell'anno (depth
 * chart) in tooltip — l'evoluzione di rendimento/contesto oltre il solo anno
 * di questa scheda.
 */
export function teamHistoryBlock({ teamHistory, abbr }) {
    if (!teamHistory?.length || teamHistory.length < 2) return '';
    const points = teamHistory.map(t => ({
        x: t.year, y: t.ppg,
        extra: `${t.record.w}-${t.record.l}${t.record.t ? `-${t.record.t}` : ''}${t.rankPpg != null ? ` · ${ord(t.rankPpg)} PPG` : ''}${t.qbName ? ` · QB ${t.qbName}` : ''}`,
    }));
    const chart = buildTrendChart(points, '#4f8cff', 'pp-team-history-chart');
    if (!chart) return '';
    return `
    <section class="pm-block pp-block">
        <span class="mc-kicker">Team history · points/game by season · ${abbr}</span>
        ${chart}
        <p class="pm-note">Team points/game from each season's real schedule; the tooltip also shows record, PPG rank and that year's starting QB (depth chart).</p>
    </section>`;
}

/**
 * Storia della squadra su tutte le stagioni disponibili: punti/gara e
 * record (dal calendario, team_stats_{Y}.json) col QB titolare dell'anno
 * (depth chart). Usata sia dalla pagina giocatore/DEF sia dalla pagina
 * squadra NFL standalone (nfl-team-page.js).
 */
export async function fetchTeamHistory(abbr) {
    return (await Promise.all(TEAM_HISTORY_YEARS.map(async (y) => {
        const [statsRes, startersRes] = await Promise.allSettled([getTeamStats(y), getTeamStarters(abbr, y)]);
        const t = statsRes.status === 'fulfilled' ? statsRes.value?.teams?.[abbr] : null;
        if (!t?.offense) return null;
        const qb = startersRes.status === 'fulfilled' ? startersRes.value?.offense?.find(p => p.pos === 'QB') : null;
        return { year: y, ppg: t.offense.ppg, rankPpg: t.ranks?.offense?.ppg, record: t.record, qbName: qb?.name || null };
    }))).filter(Boolean);
}

// ─── Selettore stagione per Contesto squadra ─────────────────────
// Forza squadra, titolari, compagni, infermeria e calendario sono ancorati
// alla stagione di draft di default, ma sono ricaricabili per qualunque
// anno 2019-2025 senza ricaricare la pagina.

/** Fetch di tutti i dati di contesto squadra per un anno specifico. */
export async function fetchTeamSeasonData(abbr, year) {
    const ctxData = await getTeamContext(abbr, year).catch(() => null);
    const season = ctxData?.season || year;
    const [advTeam, teamRoster, teamInjuries, teamStarters] = await Promise.all([
        getTeamAdvanced(abbr, season).catch(() => null),
        getTeamRoster(abbr, season).catch(() => null),
        getTeamInjuries(abbr, season).catch(() => null),
        getTeamStarters(abbr, season).catch(() => null),
    ]);
    return { ctx: ctxData, advTeam, teamRoster, teamInjuries, teamStarters };
}

/** HTML dei blocchi che dipendono dalla stagione selezionata (non teamHistoryBlock, che le copre tutte). */
export function teamSeasonBlocksHtml(abbr, pos, data) {
    const wrap = { ...data, abbr, pos };
    // DEF (pick fantasy) → solo difesa; TEAM (pagina squadra standalone) →
    // profilo completo attacco+difesa; giocatore → solo contesto offensivo.
    const contextHtml = pos === 'DEF' ? (defStatsBlock(wrap) + fpaBlock(wrap))
        : pos === 'TEAM' ? (teamContextBlock(wrap) + defStatsBlock(wrap) + fpaBlock(wrap))
        : teamContextBlock(wrap);
    return `${contextHtml}${startersBlock(wrap)}${teammatesBlock(wrap)}${teamInjuriesBlock(wrap)}${matchupBlock(wrap)}`;
}

/** Solo i blocchi di rendimento stagione (forza attacco+difesa + FPA) — pagina squadra, sezione 02. */
export function teamPerfBlocksHtml(abbr, pos, data) {
    const wrap = { ...data, abbr, pos };
    return pos === 'DEF'
        ? (defStatsBlock(wrap) + fpaBlock(wrap))
        : (teamContextBlock(wrap) + defStatsBlock(wrap) + fpaBlock(wrap));
}

/** Solo i blocchi infermeria + calendario — pagina squadra, sezione 03. Il depth
 *  chart e la rosa completa (con il click che allarga alla rosa intera) sono un
 *  unico blocco montato da nfl-team-page sopra questi. La formazione titolare è
 *  stata rimossa (duplicava il depth chart) e la classifica compagni non c'è. */
export function teamScheduleBlocksHtml(abbr, pos, data) {
    const wrap = { ...data, abbr, pos };
    return `${teamInjuriesBlock(wrap)}${matchupBlock(wrap)}`;
}

export function teamYearPicker(selectedYear) {
    return `
    <div class="pp-year-picker">
        <label for="pp-team-year">Team season</label>
        <select id="pp-team-year">
            ${TEAM_HISTORY_YEARS.map(y => `<option value="${y}"${y === selectedYear ? ' selected' : ''}>${y}</option>`).join('')}
        </select>
    </div>`;
}

/**
 * Ricarica i blocchi di contesto squadra per l'anno scelto, senza ricaricare
 * la pagina. Copre due layout: container unico `#pp-team-season-blocks`
 * (pagina DEF) e layout diviso in due sezioni `#pp-team-perf` + `#pp-team-roster`
 * (pagina squadra, sezioni 02 e 03).
 */
export function bindTeamYearSelector(section, abbr, pos) {
    const select = section.querySelector('#pp-team-year');
    if (!select) return;
    const single = section.querySelector('#pp-team-season-blocks');
    const perf = section.querySelector('#pp-team-perf');
    const roster = section.querySelector('#pp-team-roster');
    if (!single && !perf && !roster) return;
    const spinner = '<div class="loading-state"><div class="spinner"></div></div>';
    select.addEventListener('change', async () => {
        const year = +select.value;
        const myHash = location.hash;
        if (single) single.innerHTML = spinner;
        if (perf) perf.innerHTML = spinner;
        if (roster) roster.innerHTML = '';
        const data = await fetchTeamSeasonData(abbr, year);
        if (location.hash !== myHash) return; // l'utente è già andato altrove
        if (single) single.innerHTML = teamSeasonBlocksHtml(abbr, pos, data);
        if (perf) perf.innerHTML = teamPerfBlocksHtml(abbr, pos, data);
        if (roster) roster.innerHTML = teamScheduleBlocksHtml(abbr, pos, data);
    });
}

export function teamContextBlock({ ctx, abbr, pos, advTeam }) {
    if (!ctx?.team?.offense) return '';
    const o = ctx.team.offense, r = ctx.team.ranks?.offense || {};
    const rec = ctx.team.record;
    const a = advTeam || {};

    const factChips = [
        factChip(`${rec.w}-${rec.l}${rec.t ? '-' + rec.t : ''}`, 'record'),
        a.offEpaPerPlay != null ? factChip(fmt2(a.offEpaPerPlay), 'EPA/gioco') : '',
        a.successRate != null ? factChip(fmt0(a.successRate * 100) + '%', 'success rate') : '',
        a.proe != null ? factChip((a.proe >= 0 ? '+' : '') + fmt1(a.proe) + '%', 'PROE') : '',
        o.passRate != null ? factChip(fmt0(o.passRate * 100) + '%', 'pass plays') : '',
    ].filter(Boolean).join('');

    const offMeters = [
        meterBar('Points/game', fmt1(o.ppg), r.ppg),
        meterBar('Total yards/game', fmt1(o.totYdsPg), r.totYdsPg),
        meterBar('Pass yds/game', fmt1(o.passYdsPg), r.passYdsPg),
        meterBar('Rush yds/game', fmt1(o.rushYdsPg), r.rushYdsPg),
        meterBar('Yard/gioco', fmt1(o.ydsPerPlay), r.ydsPerPlay),
        meterBar('Plays/game (pace)', fmt1(o.playsPg), r.playsPg),
        meterBar('Red zone plays/game', fmt1(o.rzPlaysPg), r.rzPlaysPg),
        meterBar('Palloni persi', fmt0(o.turnovers), r.turnovers),
        meterBar('Sack concessi', fmt0(o.sacksAllowed), r.sacksAllowed),
        meterBar('Passing TD', fmt0(o.passTd), r.passTd),
        meterBar('Rushing TD', fmt0(o.rushTd), r.rushTd),
    ].join('');

    // difesa della squadra (stessi dati team_stats, prima non mostrati)
    const d = ctx.team.defense, rd = ctx.team.ranks?.defense || {};
    const defMeters = d ? [
        meterBar('Points allowed/game', fmt1(d.papg), rd.papg),
        meterBar('Yards allowed/game', fmt1(d.totYdsAllowedPg), rd.totYdsAllowedPg),
        meterBar('Passing yds allowed', fmt1(d.passYdsAllowedPg), rd.passYdsAllowedPg),
        meterBar('Rushing yds allowed', fmt1(d.rushYdsAllowedPg), rd.rushYdsAllowedPg),
        meterBar('Sack', fmt0(d.sacks), rd.sacks),
        meterBar('Intercetti', fmt0(d.interceptions), rd.interceptions),
        meterBar('Palloni recuperati', fmt0(d.takeaways), rd.takeaways),
        meterBar('TD difensivi', fmt0(d.defTds), rd.defTds),
    ].join('') : '';

    return `
    <section class="pm-block pp-block">
        <span class="mc-kicker">Team strength · offense ${abbr} ${ctx.season}${ctx.fallback ? ' (most recent available season)' : ''}</span>
        ${factChips ? `<div class="pp-fact-chips" style="margin:8px 0 12px">${factChips}</div>` : ''}
        <div class="dgt-sos-bars">${offMeters}</div>
        ${defMeters ? `
        <span class="mc-kicker" style="margin-top:18px">Defense ${abbr}</span>
        <div class="dgt-sos-bars">${defMeters}</div>` : ''}
        <p class="pm-note">Meter = percentile su 32 squadre (pieno = 1ª, vuoto = 32ª); verde = tra le prime 10, rosso = tra le ultime 10.${advTeam ? ' EPA/success/PROE dal play-by-play nflverse.' : ''}</p>
    </section>`;
}

export function matchupChip(rank) {
    if (rank == null) return '—';
    const cls = rank <= 10 ? 'pp-mu--easy' : rank >= 23 ? 'pp-mu--hard' : 'pp-mu--mid';
    const label = rank <= 10 ? 'morbida' : rank >= 23 ? 'dura' : 'media';
    return `<span class="pp-mu ${cls}">${ord(rank)} · ${label}</span>`;
}

export function matchupBlock({ ctx, pos, abbr }) {
    if (!ctx?.opponents?.length) return '';
    const P = POS_LIST.includes(pos) ? pos : 'WR';
    const vsOffense = pos === 'DEF';

    const rows = ctx.opponents.map(g => {
        const fpaP = g.fpa?.[P];
        const res = g.result ? `<span class="pp-res pp-res--${g.result.toLowerCase()}">${g.pf}-${g.pa} ${g.result === 'W' ? 'V' : g.result === 'L' ? 'S' : 'P'}</span>` : '—';
        const main = vsOffense
            ? `<td>${g.off ? fmt1(g.off.ppg) + rankBadge(g.ranks?.offense?.ppg) : '—'}</td>
               <td>${g.off ? fmt1(g.off.totYdsPg) + rankBadge(g.ranks?.offense?.totYdsPg) : '—'}</td>
               <td>${g.off ? fmt0(g.off.turnovers) : '—'}</td>`
            : `<td>${fpaP?.pgLeague != null ? fmt1(fpaP.pgLeague) : fpaP?.pgHalf != null ? fmt1(fpaP.pgHalf) : '—'}</td>
               <td>${matchupChip(fpaP?.rank)}</td>
               <td>${g.def ? fmt1(g.def.papg) + rankBadge(g.ranks?.defense?.papg) : '—'}</td>`;
        return `<tr>
            <td>W${g.week}</td>
            <td class="pp-opp">${g.home ? '' : '@ '}<img class="pp-opp-logo" src="${teamLogo(g.opp)}" alt="" onerror="this.style.display='none'">${g.opp}${g.record ? ` <span class="pp-opp-rec">(${g.record.w}-${g.record.l})</span>` : ''}</td>
            <td>${res}</td>
            ${main}
        </tr>`;
    }).join('');

    const head = vsOffense
        ? '<th>Off PPG</th><th>Yards/game</th><th>Turnovers</th>'
        : `<th>FPA ${P}/gara</th><th>Matchup</th><th>Pts allowed/game</th>`;

    const sosVal = ctx.sos?.[P];
    const sosLine = sosVal != null
        ? `<p class="pp-sos">Strength of schedule vs ${P}: avg opponent FPA rank <b>${fmt1(sosVal)}</b> — ${sosVal <= 13 ? 'favorable schedule' : sosVal >= 20 ? 'hard schedule' : 'average schedule'} (low rank = defenses that allow more).</p>`
        : '';

    return `
    <section class="pm-block pp-block">
        <span class="mc-kicker">Schedule and matchups · ${ctx.season}${ctx.fallback ? ' (most recent available season)' : ''}</span>
        ${sosLine}
        <div class="pm-table-wrap pp-scroll">
            <table class="pm-table pp-table">
                <thead><tr><th>Sett.</th><th>Avversario</th><th>Result</th>${head}</tr></thead>
                <tbody>${rows}</tbody>
            </table>
        </div>
        <p class="pm-note">${vsOffense
            ? 'For a defense the matchup depends on the opposing offense: PPG and yards with the offensive rank (1st = best offense).'
            : `FPA = fantasy points allowed by the opposing defense to ${P}s (league scoring, per game). Rank 1st = allows the most = soft matchup.`}</p>
    </section>`;
}

/**
 * Blocco squadra COMPATTO e role-aware per la pagina giocatore (sezione 06):
 * header cliccabile verso la scheda squadra completa, prossimo impegno con la
 * difficoltà del matchup per il ruolo, forza calendario (SOS) e una sintesi di
 * forza squadra pertinente al ruolo. Il dettaglio completo (rosa, difesa,
 * calendario, storia) vive nella pagina squadra `#nfl-team/{abbr}`.
 * Riusa i dati già caricati per la scheda: `data.ctx` (contesto stagione) e
 * `data.advTeam`. Nessuna fetch aggiuntiva.
 */
function teamContextCompact(data) {
    const { ctx, abbr, pos, advTeam } = data;
    if (!abbr || !ctx?.team?.offense) return '';
    const identity = getTeamIdentity(abbr);
    const P = POS_LIST.includes(pos) && pos !== 'DEF' ? pos : 'WR';
    const o = ctx.team.offense, r = ctx.team.ranks?.offense || {};
    const rec = ctx.team.record;
    const a = advTeam || {};

    const header = `
        <a class="pp-tcc-head" href="#nfl-team/${abbr}" title="Go to full team page">
            <img class="pp-tcc-logo" src="${teamLogo(abbr)}" alt="" onerror="this.style.display='none'">
            <span class="pp-tcc-id">
                <b>${identity ? esc(identity.name) : abbr}</b>
                <span class="pp-tcc-sub">${rec ? `${rec.w}-${rec.l}${rec.t ? '-' + rec.t : ''} · ` : ''}${ctx.season}${ctx.fallback ? ' (latest avail.)' : ''}</span>
            </span>
            <span class="pp-tcc-cta">Full team page →</span>
        </a>`;

    // Prossimo impegno: primo game ancora da giocare (senza risultato); fallback al primo del calendario.
    const next = ctx.opponents?.find(g => !g.result) || ctx.opponents?.[0];
    const fpaP = next?.fpa?.[P];
    const nextHtml = next ? `
        <div class="pp-tcc-item">
            <span class="pp-tcc-lbl">Prossimo impegno</span>
            <span class="pp-tcc-opp">W${next.week} ${next.home ? '' : '@ '}<img class="pp-opp-logo" src="${teamLogo(next.opp)}" alt="" onerror="this.style.display='none'">${next.opp}${next.record ? ` <span class="pp-opp-rec">(${next.record.w}-${next.record.l})</span>` : ''}</span>
            ${fpaP && fpaP.rank != null ? `<span class="pp-tcc-mu">FPA ${P} ${fmt1(fpaP.pgLeague ?? fpaP.pgHalf)} ${matchupChip(fpaP.rank)}</span>` : ''}
        </div>` : '';

    // Forza calendario (SOS) del ruolo
    const sosVal = ctx.sos?.[P];
    const sosHtml = sosVal != null ? `
        <div class="pp-tcc-item">
            <span class="pp-tcc-lbl">Schedule strength · ${P}</span>
            <span class="pp-tcc-sosval">avg opponent FPA rank <b>${fmt1(sosVal)}</b> · ${sosVal <= 13 ? 'favorable' : sosVal >= 20 ? 'hard' : 'average'}</span>
        </div>` : '';

    // Forza squadra sintetica per ruolo (2-4 chip col rank)
    const rankChip = (val, label, rank) => val == null ? '' : factChip(`${val}${rankBadge(rank)}`, label);
    let chips;
    if (pos === 'QB' || pos === 'WR' || pos === 'TE') {
        chips = [
            rankChip(fmt1(o.passYdsPg), 'passing yds/game', r.passYdsPg),
            o.passRate != null ? factChip(fmt0(o.passRate * 100) + '%', 'pass plays') : '',
            rankChip(fmt1(o.playsPg), 'plays/game', r.playsPg),
            a.proe != null ? factChip((a.proe >= 0 ? '+' : '') + fmt1(a.proe) + '%', 'PROE') : '',
        ];
    } else if (pos === 'RB') {
        chips = [
            rankChip(fmt1(o.rushYdsPg), 'rushing yds/game', r.rushYdsPg),
            rankChip(fmt0(o.rushTd), 'rush TD', r.rushTd),
            rankChip(fmt1(o.rzPlaysPg), 'RZ plays/game', r.rzPlaysPg),
        ];
    } else if (pos === 'K') {
        chips = [
            rankChip(fmt1(o.ppg), 'points/game', r.ppg),
            rankChip(fmt1(o.rzPlaysPg), 'RZ plays/game', r.rzPlaysPg),
        ];
    } else {
        chips = [
            rankChip(fmt1(o.ppg), 'points/game', r.ppg),
            rankChip(fmt1(o.totYdsPg), 'total yds/game', r.totYdsPg),
        ];
    }
    const chipsHtml = chips.filter(Boolean).join('');
    const strengthHtml = chipsHtml ? `
        <div class="pp-tcc-item">
            <span class="pp-tcc-lbl">Team strength · offense</span>
            <div class="pp-fact-chips">${chipsHtml}</div>
        </div>` : '';

    if (!nextHtml && !sosHtml && !strengthHtml) return '';
    return `
    <section class="pm-block pp-block pp-tcc">
        ${header}
        <div class="pp-tcc-body">${nextHtml}${sosHtml}${strengthHtml}</div>
        <p class="pm-note">Sintesi del contesto squadra per un ${P}. Rosa completa, difesa, calendario e storia nella <a href="#nfl-team/${abbr}">team page</a>.</p>
    </section>`;
}

// ─── Pagina DEF ──────────────────────────────────────────────────

function renderDefPage(section, ctx) {
    const { name, year, abbr, full, career, awards } = ctx;
    const identity = abbr ? getTeamIdentity(abbr) : null;

    section.innerHTML = `
    <div class="section-inner gb-page pp-page">
        <a class="gb-back" href="#" data-pp-back><span aria-hidden="true">←</span> Back</a>

        <h2 class="pp-section-title"><small>01</small> Team recap</h2>
        <header class="mosaic-card mc-wide pp-hero mc-in">
            <div class="pp-recap">
                <img class="pp-recap-photo" style="border-radius:var(--radius-lg);object-fit:contain;background:transparent;border:none"
                    src="${abbr ? teamLogo(abbr) : 'images/fallback-player.svg'}" alt="${esc(name)}">
                <div class="pp-recap-body">
                    <div class="pp-recap-name"><span class="mc-kicker">Defense · Draft Topina ${year}</span></div>
                    <h1 class="mc-title">${esc(name)} <span class="allpro-pos pos-def">DEF</span></h1>
                    ${identity ? `<div class="pp-recap-team"><span class="pp-team-div" style="color:${identity.color}">${esc(identity.conf)} · ${esc(identity.division)}</span></div>` : ''}
                    ${factGroup('Topina', [
                        career?.seasons.size ? factChip(career.seasons.size, `stagion${career.seasons.size === 1 ? 'e' : 'i'} draftata`) : '',
                        career?.sbWins ? factChip(`🏆×${career.sbWins}`, 'Super Bowl (Topina)', 'pp-fact-chip--accent') : '',
                    ].filter(Boolean).join(''))}
                </div>
            </div>
        </header>

        <h2 class="pp-section-title"><small>02</small> Metriche</h2>
        ${teamHistoryBlock(ctx)}
        ${gamelogBlock(full.seasons, 'DEF')}

        <h2 class="pp-section-title"><small>03</small> Team context</h2>
        ${abbr ? teamYearPicker(ctx.ctx?.season || +year) : ''}
        <div id="pp-team-season-blocks">${teamSeasonBlocksHtml(abbr, 'DEF', ctx)}</div>
        ${teamExtrasBlock(ctx)}

        ${topinaBlock(career)}
        ${awardsBlock(career, awards)}
        ${footnote()}
    </div>`;

    bindBack(section);
    bindTeamYearSelector(section, abbr, 'DEF');
}

export function defStatsBlock({ ctx, abbr }) {
    if (!ctx?.team?.defense) return '';
    const d = ctx.team.defense, r = ctx.team.ranks?.defense || {};
    const meters = [
        meterBar('Points allowed/game', fmt1(d.papg), r.papg),
        meterBar('Yards allowed/game', fmt1(d.totYdsAllowedPg), r.totYdsAllowedPg),
        meterBar('Passing yds allowed', fmt1(d.passYdsAllowedPg), r.passYdsAllowedPg),
        meterBar('Rushing yds allowed', fmt1(d.rushYdsAllowedPg), r.rushYdsAllowedPg),
        meterBar('Sack', fmt0(d.sacks), r.sacks),
        meterBar('Intercetti', fmt0(d.interceptions), r.interceptions),
        meterBar('Forced fumbles', fmt0(d.fumblesForced), r.fumblesForced),
        meterBar('Forced turnovers', fmt0(d.takeaways), r.takeaways),
        meterBar('TD difensivi', fmt0(d.defTds), r.defTds),
        meterBar('Passaggi difesi', fmt0(d.passDefended), r.passDefended),
        meterBar('Tackle for loss', fmt0(d.tacklesForLoss), r.tacklesForLoss),
        meterBar('QB hit', fmt0(d.qbHits), r.qbHits),
    ].join('');
    const extraChips = [
        factChip(fmt0(d.fumbleRecoveries), 'fumble recuperati'),
        factChip(fmt0(d.safeties), 'safety'),
        factChip(fmt0(d.blockedKicks), 'kick bloccati'),
    ].join('');
    return `
    <section class="pm-block pp-block">
        <span class="mc-kicker">The defense · ${abbr} ${ctx.season}${ctx.fallback ? ' (most recent available season)' : ''}</span>
        <div class="dgt-sos-bars">${meters}</div>
        <div class="pp-fact-chips" style="margin-top:12px">${extraChips}</div>
        <p class="pm-note">Meter = percentile out of 32 teams; green = top 10, red = bottom 10.</p>
    </section>`;
}

/** Solo la tabella FPA (senza wrapper): riusata dal blocco fpaBlock e dal blocco
 *  Analisi difesa della pagina squadra (dove è la parte "fantasy concessi"). */
export function fpaTableHtml(ctx) {
    if (!ctx?.team?.fpa) return '';
    const rows = POS_LIST.filter(p => p !== 'DEF').map(p => {
        const f = ctx.team.fpa[p];
        if (!f || (f.pgLeague == null && f.pgHalf == null)) return '';
        return `<tr><td>${p}</td><td class="pm-td-strong">${fmt1(f.pgLeague ?? f.pgHalf)}</td><td>${fmt1(f.pgHalf)}</td><td>${matchupChip(f.rank)}</td></tr>`;
    }).filter(Boolean).join('');
    if (!rows) return '';
    return `
        <div class="pm-table-wrap pp-scroll">
            <table class="pm-table pp-table">
                <thead><tr><th>Position</th><th>FPA league/game</th><th>FPA half/game</th><th>Rank</th></tr></thead>
                <tbody>${rows}</tbody>
            </table>
        </div>
        <p class="pm-note">Rank 1st = the defense that allows the most fantasy points to that position (soft matchup for opponents).</p>`;
}

export function fpaBlock({ ctx }) {
    const table = fpaTableHtml(ctx);
    if (!table) return '';
    return `
    <section class="pm-block pp-block">
        <span class="mc-kicker">Fantasy points allowed per position</span>
        ${table}
    </section>`;
}

/** Blocchi esclusivi squadra (solo pagina DEF): trade storiche, ATS, storia franchigia, draft NFL storico. */
export function teamExtrasBlock({ teamExtras, abbr }) {
    if (!teamExtras) return '';
    const { trades, ats, history, draftHistory } = teamExtras;

    // Anteprima visibile + il resto in un dettaglio espandibile (mai troncato senza modo di vedere tutto)
    const tradeRow = t => `<tr><td>${t.date ? new Date(t.date).toLocaleDateString('en-US') : '—'}</td><td>${t.received ? esc(t.received) : '—'}</td><td>${t.player ? esc(t.player) : (t.pick ? esc(t.pick) : '—')}${t.conditional ? ' <small style="color:var(--text-muted)">(condizionale)</small>' : ''}</td></tr>`;
    const tradesHtml = trades?.length ? `
        <span class="mc-kicker">Trade recenti</span>
        <div class="pm-table-wrap pp-scroll">
            <table class="pm-table pp-table">
                <thead><tr><th>Data</th><th>Controparte</th><th>Oggetto</th></tr></thead>
                <tbody>${trades.slice(0, 5).map(tradeRow).join('')}</tbody>
            </table>
        </div>
        ${trades.length > 5 ? `
        <details class="pp-recap-ids">
            <summary>Altre ${trades.length - 5} trade</summary>
            <div class="pm-table-wrap pp-scroll" style="margin-top:8px">
                <table class="pm-table pp-table"><tbody>${trades.slice(5).map(tradeRow).join('')}</tbody></table>
            </div>
        </details>` : ''}` : '';

    const atsTiles = ats ? [
        tile(`${ats.wins}-${ats.losses}${ats.pushes ? `-${ats.pushes}` : ''}`, 'Overall ATS record'),
        ats.home ? tile(`${ats.home.wins}-${ats.home.losses}`, 'ATS at home') : '',
        ats.away ? tile(`${ats.away.wins}-${ats.away.losses}`, 'ATS away') : '',
        ats.favorite ? tile(`${ats.favorite.wins}-${ats.favorite.losses}`, 'ATS da favorita') : '',
        ats.underdog ? tile(`${ats.underdog.wins}-${ats.underdog.losses}`, 'ATS da underdog') : '',
    ].filter(Boolean).join('') : '';
    const atsHtml = atsTiles ? `<span class="mc-kicker" style="margin-top:16px">Record against the spread (ESPN)</span><div class="pm-tiles pp-tiles">${atsTiles}</div>` : '';

    const draftRow = p => `<tr><td>${p.season ?? '—'}</td><td>${p.round ?? '—'}</td><td>${p.pick ?? '—'}</td><td>${esc(p.name)}</td><td>${esc(p.pos || '—')}</td><td>${p.college ? esc(p.college) : '—'}</td><td>${p.careerAV ?? '—'}</td></tr>`;
    const draftHtml = draftHistory?.length ? `
        <span class="mc-kicker" style="margin-top:16px">Team historical NFL draft</span>
        <div class="pm-table-wrap pp-scroll">
            <table class="pm-table pp-table">
                <thead><tr><th>Year</th><th>Round</th><th>Pick</th><th>Name</th><th>Pos</th><th>College</th><th>Career AV</th></tr></thead>
                <tbody>${draftHistory.slice(0, 8).map(draftRow).join('')}</tbody>
            </table>
        </div>
        ${draftHistory.length > 8 ? `
        <details class="pp-recap-ids">
            <summary>Altri ${draftHistory.length - 8} pick storici</summary>
            <div class="pm-table-wrap pp-scroll" style="margin-top:8px">
                <table class="pm-table pp-table"><tbody>${draftHistory.slice(8).map(draftRow).join('')}</tbody></table>
            </div>
        </details>` : ''}` : '';

    const histNode = (h) => {
        const yr = h.season?.year ?? h.year ?? (typeof h.season === 'number' ? h.season : null);
        const label = h.displayName || h.name || h.season?.displayName || '';
        if (!label && yr == null) return '';
        return `<div class="pp-tline-node"><span class="pp-tline-dot"></span>${yr != null ? `<span class="pp-tline-yr">${esc(String(yr))}</span>` : ''}<span class="pp-tline-txt">${esc(String(label))}</span></div>`;
    };
    const historyHtml = history?.length ? `
        <span class="mc-kicker" style="margin-top:16px">Franchise history (ESPN)</span>
        <div class="pp-tline">${history.slice(0, 12).map(histNode).filter(Boolean).join('')}</div>` : '';

    if (!tradesHtml && !atsHtml && !draftHtml && !historyHtml) return '';
    return `
    <section class="pm-block pp-block">
        <span class="mc-kicker">Franchigia · ${abbr}</span>
        ${tradesHtml}${atsHtml}${draftHtml}${historyHtml}
        <p class="pm-note">Trades and historical draft from nflverse (Pro Football Reference); ATS and franchise history from live ESPN.</p>
    </section>`;
}

// ─── Comuni ──────────────────────────────────────────────────────

function footnote() {
    return `<p class="dg-footnote">Fonti: Sleeper (statistiche giocatore dal ${FIRST_STATS_YEAR}, anagrafica, proiezioni Rotowire) e nfldata.org (calendari e punteggi). Statistiche di squadra derivate dai dati settimanali della sola regular season; punti fantasy nello scoring della Topina League dove indicato.</p>`;
}

function bindBack(section) {
    section.querySelector('[data-pp-back]')?.addEventListener('click', (e) => {
        e.preventDefault();
        if (history.length > 1) history.back();
        else location.hash = 'draft';
    });
}

function hydrateHero(section, name, abbr, pos, year) {
    const img = section.querySelector('.pp-recap-photo');
    if (!img) return;
    img.onerror = () => {
        if (!img.src.endsWith('fallback-player.svg')) img.src = 'images/fallback-player.svg';
    };
    playerImageService.getPlayerImageUrl(name, abbr, pos, year)
        .then(url => { if (url) img.src = url; })
        .catch(() => { /* resta il fallback */ });
}
