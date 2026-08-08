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
import { topinaBlock, awardsBlock } from '../components/player-modal.js?v=28';
import { getSeasonProjections, getSeasonStats, matchProjection } from '../data/projections.js?v=15';
import { playerImageService } from '../services/player-image-service.js?v=15';
import { canonAbbr } from '../data/nfl-schedule.js?v=11';
import { CURRENT_SEASON } from '../data.js?v=33';
import { getAdvancedSeasons, getTeamAdvanced, getCombineDraft, getTeamDraftHistory, getDraftPeers } from '../data/context-score.js?v=4';
import { getTeamIdentity } from '../data/nfl-teams.js?v=1';
import { getTeamRoster, getTeamInjuries, getTeamStarters, getPlayerInjuries } from '../data/nfl-team-extras.js?v=7';
import { getTeamTrades, getTeamATS, getFranchiseHistory } from '../data/nfl-team-profile-extra.js?v=1';
import { resolvePlayerIds } from '../data/nfl-player-ids.js?v=1';
import { enrichBio, getPlayerAwardsEspn, getPlayerContractEspn, getPlayerOverview, getPlayerEspnExtra, getPlayerRecordsEspn, getPlayerSplits, getPlayerQBR } from '../data/player-bio-extra.js?v=5';
import { decomposeSeason, seasonVerdict, getPerfCauses, describeCauses } from '../data/perf-explain.js?v=8';

export const POS_LIST = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];
export const TEAM_HISTORY_YEARS = [2019, 2020, 2021, 2022, 2023, 2024, 2025];
export const fmt0 = (n) => n == null ? '—' : Math.round(n).toLocaleString('it-IT');
export const fmt1 = (n) => n == null ? '—' : (+n).toLocaleString('it-IT', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
export const fmt2 = (n) => n == null ? '—' : (+n).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const teamLogo = (abbr) => `https://a.espncdn.com/i/teamlogos/nfl/500/${(abbr || '').toLowerCase()}.png`;
export const ord = (n) => n == null ? '' : `${n}${n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th'}`;
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

    section.innerHTML = `<div class="section-inner"><div class="loading-state"><div class="spinner"></div><p>Loading all stats for ${esc(name)}...</p></div></div>`;

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
        else renderPlayerPage(section, { name, year, pos, abbr, full, career, awards, projEntry, nextSeasonProj, nextSeason, ctx, advSeasons, advTeam, teamRoster, teamInjuries, teamStarters, playerInjuries, causesByYear, combineDraft, awardsEspn, contract, draftPeers, projByYear, teamHistory, compare, overview, espnExtra, recordsEspn, splits, qbr });
    } catch (e) {
        console.error('[player-page]', e);
        if (location.hash !== myHash) return;
        section.innerHTML = `<div class="section-inner"><div class="empty-state"><p class="empty-state-text">Errore nel caricamento delle statistiche</p></div></div>`;
    }
}

// ─── Pagina giocatore ────────────────────────────────────────────

function renderPlayerPage(section, ctx) {
    const { name, year, pos, abbr, full, career, awards, projEntry, advSeasons, nextSeasonProj, nextSeason } = ctx;
    const seasons = full.seasons; // dalla più recente

    section.innerHTML = `
    <div class="section-inner gb-page pp-page">
        <a class="gb-back" href="#" data-pp-back><span aria-hidden="true">←</span> Back</a>

        <h2 class="pp-section-title"><small>01</small> Player recap</h2>
        ${recapCard(ctx)}
        ${careerTeamsBlock(full, ctx.combineDraft)}
        ${topinaBoxBlock(career, awards)}
        ${outlookNewsBlock(ctx)}
        ${recordsBlock(ctx)}
        ${full.resolved && seasons.length ? '' : noStatsBlock(full, projEntry, year)}

        <h2 class="pp-section-title"><small>02</small> Performance &amp; metrics</h2>
        ${metricsBlock(seasons, pos, nextSeasonProj, nextSeason)}
        ${qbrBlock(ctx)}
        ${leagueComparisonBlock(ctx)}
        ${advancedNflverseBlock(advSeasons, pos)}
        ${splitsBlock(ctx)}
        ${playerInjuriesBlock(ctx)}

        <h2 class="pp-section-title"><small>03</small> Career stats</h2>
        ${categoryTables(seasons, pos)}
        ${careerTotalsPfrBlock(ctx.combineDraft)}
        ${gamelogBlock(seasons, pos)}

        <h2 class="pp-section-title"><small>04</small> Projections &amp; draft value</h2>
        ${projectionsTableBlock({ seasons, projByYear: ctx.projByYear, nextSeasonProj, nextSeason })}
        ${projectedStatsBlock({ projByYear: ctx.projByYear, nextSeasonProj, nextSeason })}
        ${projVsActualBlock({ seasons, projByYear: ctx.projByYear })}
        ${perfExplainBlock(ctx)}
        ${draftScatterBlock(ctx)}

        <h2 class="pp-section-title"><small>05</small> Team</h2>
        ${teamContextCompact(ctx)}

        ${footnote()}
    </div>`;

    bindBack(section);
    hydrateHero(section, name, abbr, pos, year);
    hydrateCharts(section);
    bindCategoryTabs(section);
    bindComparisonChart(section, ctx);
    bindViolinHover(section);
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
                ? `<b>${d.year}</b> · projection<br>avg ${d.mean} pt/game`
                : `<b>${d.year}</b> · ${d.n} games<br>avg <b>${d.media}</b> · median <b>${d.med}</b><br>25th–75th: ${d.q1}–${d.q3}<br>min ${d.min} · max ${d.max}`;
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
        info?.age ? `<span class="pm-chip">${info.age} years old</span>` : '',
        info?.college ? `<span class="pm-chip">${esc(info.college)}</span>` : '',
        career?.seasons.size ? `<span class="pm-chip">${career.seasons.size} Topina season${career.seasons.size === 1 ? '' : 's'}</span>` : '',
        info?.injury_status ? `<span class="pm-chip pp-chip-injury">${esc(info.injury_status)}</span>` : '',
    ].filter(Boolean).join('');

    return `
    <header class="mosaic-card mc-wide dgt-hero pp-hero mc-in">
        <img class="pp-headshot" src="images/fallback-player.svg" alt="${esc(name)}">
        <div class="dgt-hero-info">
            <span class="mc-kicker">Full card · ${year} Draft</span>
            <h1 class="mc-title">${esc(name)}</h1>
            <div class="pm-chips pp-hero-chips">${chips}</div>
        </div>
        ${career?.sbWins ? `<div class="pm-rings" title="Super Bowl rings">SB ×${career.sbWins}</div>` : ''}
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
    const born = info.birth_date ? new Date(info.birth_date).toLocaleDateString('it-IT') : null;

    // Vitali: età, altezza/peso, college, esperienza, status — tutto in una riga di chip
    // (età: Sleeper se presente, altrimenti dallo schema v3 ESPN già calcolato)
    const birthPlace = [info.birth_city, info.birth_state, info.birth_country].filter(Boolean).join(', ');
    const vitals = [
        factChip(info.age ?? espnExtra?.age, 'years old'),
        factChip(height, wLb ? `· ${Math.round(wLb)} lbs` : null),
        factChip(info.college ? esc(info.college) : null, null),
        factChip(born, null),
        birthPlace ? factChip(esc(birthPlace), null) : '',
        info.high_school ? factChip(esc(info.high_school), 'high school') : '',
        info.years_exp != null ? factChip(`${info.years_exp}${info.years_exp === 1 ? 'st' : info.years_exp === 2 ? 'nd' : info.years_exp === 3 ? 'rd' : 'th'}`, 'NFL season') : '',
        info.status ? factChip(esc(info.status), null) : '',
        info.number != null ? factChip(`#${info.number}`, null) : '',
        info.practice_description ? factChip(esc(info.practice_description), 'practice') : '',
    ].filter(Boolean).join('');

    // Combine NFL: solo se presente, come chip compatti (non 6 tile enormi)
    const combineChips = combine ? [
        combine.forty != null ? factChip(`${combine.forty}s`, '40yd') : '',
        combine.vertical != null ? factChip(`${combine.vertical}"`, 'vertical') : '',
        combine.bench != null ? factChip(`${combine.bench}`, 'bench') : '',
        combine.broadJump != null ? factChip(`${combine.broadJump}"`, 'broad jump') : '',
        combine.cone != null ? factChip(`${combine.cone}s`, '3-cone') : '',
        combine.shuttle != null ? factChip(`${combine.shuttle}s`, 'shuttle') : '',
    ].filter(Boolean).join('') : '';
    // Blocco infermeria del collega (mantenuto per compatibilità).
    const injury = info.injury_status ? `
        <div class="pp-injury">
            <span class="pp-injury-title">Injury report (current status)</span>
            <span>${esc(info.injury_status)}${info.injury_body_part ? ` — ${esc(info.injury_body_part)}` : ''}${info.injury_notes ? ` · ${esc(info.injury_notes)}` : ''}${info.injury_start_date ? ` · since ${new Date(info.injury_start_date).toLocaleDateString('it-IT')}` : ''}</span>
        </div>` : '';

    // Draft NFL reale + accolades di carriera, in una riga
    const draftChips = [
        d ? factChip(`${d.season}`, `Draft NFL · Rd${d.round} Pick${d.pick} (${d.team})`, 'pp-fact-chip--accent') : espnDraftChip,
        d?.hof ? factChip('HOF', 'Hall of Fame', 'pp-fact-chip--accent') : '',
        d?.allproCareer ? factChip(`×${d.allproCareer}`, 'All-Pro') : '',
        d?.probowlsCareer ? factChip(`×${d.probowlsCareer}`, 'Pro Bowl') : '',
        d?.careerAV ? factChip(d.careerAV, 'Approximate Value') : '',
        d?.posPercentile != null ? factChip(`${d.posPercentile}%`, `among ${pos}s in the ${d.season} draft (${ord(d.posRank)}/${d.posCount})`, 'pp-fact-chip--accent') : '',
    ].filter(Boolean).join('');
    const awardChips = tallyAwards(awardsEspn).map(([n, c]) => factChip(c > 1 ? `×${c}` : '🏆', n, 'pp-fact-chip--accent')).join('');

    // Contratto: OTC (build, un valore riassuntivo) o, in mancanza, storico
    // anno-per-anno ESPN live (un valore per stagione di carriera).
    const money = (v) => v == null ? null : `$${Math.round(v / 1e6)}M`;
    const isOtc = contract && !Array.isArray(contract);
    const contractArr = Array.isArray(contract) ? contract : null;
    const latestContractYear = contractArr ? (contractArr.find(c => c.active) || contractArr[contractArr.length - 1]) : null;
    const contractChip = isOtc
        ? factChip(money(contract.apy), `APY · ${contract.years} years · ${money(contract.guaranteed)} guaranteed`)
        : (latestContractYear ? factChip(money(latestContractYear.salary), `${latestContractYear.season} salary · through ${latestContractYear.signedThrough}`) : '');
    const contractHistory = contractArr && contractArr.length > 1 ? `
        <details class="pp-recap-ids" style="margin-top:6px">
            <summary>Contract history (${contractArr.length} years, ESPN)</summary>
            <div class="pm-table-wrap pp-scroll" style="margin-top:8px">
                <table class="pm-table pp-table">
                    <thead><tr><th>Year</th><th>Salary</th><th>Bonus</th><th>Through</th></tr></thead>
                    <tbody>${contractArr.map(c => `<tr><td>${c.season ?? '—'}</td><td>${money(c.salary) ?? '—'}</td><td>${money(c.bonus) ?? '—'}</td><td>${c.signedThrough ?? '—'}</td></tr>`).join('')}</tbody>
                </table>
            </div>
        </details>` : '';

    // Squadra e ruolo Topina/NFL
    const depth = info.depth_chart_position ? `${esc(info.depth_chart_position)}${info.depth_chart_order ?? ''}` : null;
    const roleChips = [
        info.position ? factChip(esc(info.position), null) : '',
        depth ? factChip(depth, 'depth chart') : '',
        career?.seasons.size ? factChip(career.seasons.size, `Topina season${career.seasons.size === 1 ? '' : 's'}`) : '',
    ].filter(Boolean).join('');

    // Prossima stagione (preseason) — sempre in evidenza se disponibile
    const nextProjChips = nextSeasonProj && (nextSeasonProj.projPts != null || nextSeasonProj.ptsStd != null || nextSeasonProj.adp != null) ? [
        factChip(fmt0(nextSeasonProj.projPts ?? nextSeasonProj.ptsStd), 'projected league pts', 'pp-fact-chip--next'),
        nextSeasonProj.adp != null ? factChip(fmt1(nextSeasonProj.adp), 'ADP', 'pp-fact-chip--next') : '',
    ].filter(Boolean).join('') : '';

    const injuryChip = info.injury_status
        ? factChip(esc(info.injury_status), info.injury_body_part ? esc(info.injury_body_part) : null,
            severityClass(info.injury_status) ? 'pp-fact-chip--out' : 'pp-fact-chip--warn')
        : '';

    const idsSummary = [
        info.espn_id ? `<a class="pp-id" href="https://www.espn.com/nfl/player/_/id/${info.espn_id}" target="_blank" rel="noopener">ESPN ${info.espn_id}</a>` : '',
        info.yahoo_id ? `<span class="pp-id">Yahoo ${info.yahoo_id}</span>` : '',
        info.sportradar_id ? `<span class="pp-id">Sportradar ${esc(info.sportradar_id)}</span>` : '',
        info.rotowire_id ? `<span class="pp-id">Rotowire ${info.rotowire_id}</span>` : '',
        info.fantasy_data_id ? `<span class="pp-id">FantasyData ${info.fantasy_data_id}</span>` : '',
        info.player_id ? `<span class="pp-id">Sleeper ${esc(info.player_id)}</span>` : '',
        info.gsis_id ? `<span class="pp-id">GSIS ${esc(info.gsis_id)}</span>` : '',
    ].filter(Boolean).join('');

    return `
    <header class="mosaic-card mc-wide pp-hero mc-in">
        <div class="pp-recap">
            <img class="pp-recap-photo" src="images/fallback-player.svg" alt="${esc(name)}">
            <div class="pp-recap-body">
                <div class="pp-recap-name">
                    <span class="mc-kicker">Topina Draft ${year}</span>
                    ${career?.sbWins ? `<span class="pm-rings" title="Super Bowl rings">🏆${career.sbWins > 1 ? `×${career.sbWins}` : ''}</span>` : ''}
                </div>
                <h1 class="mc-title">${esc(name)} ${pos ? `<span class="allpro-pos pos-${pos.toLowerCase()}">${pos}</span>` : ''}</h1>
                ${abbr ? `
                <a class="pp-recap-team pp-recap-team--link" href="#nfl-team/${abbr}" title="Go to the team page">
                    <img src="${teamLogo(abbr)}" alt="" onerror="this.style.display='none'">
                    <b>${identity ? esc(identity.name) : abbr}</b>
                    ${identity ? `<span class="pp-team-div" style="color:${identity.color}">${esc(identity.division)}</span>` : ''}
                    <span class="pp-recap-team-arrow" aria-hidden="true">→</span>
                </a>` : ''}

                ${factGroup('Vitals', vitals)}
                ${factGroup('NFL Combine', combineChips)}
                ${factGroup('Role', roleChips)}
                ${factGroup('Real NFL draft and career', draftChips + awardChips)}
                ${contractChip ? `
                <div class="pp-fact-group">
                    <span class="pp-fact-label">Contract${isOtc ? ' · Over The Cap' : ' · ESPN'}</span>
                    <div class="pp-fact-chips">${contractChip}</div>
                    ${contractHistory}
                </div>` : ''}
                ${nextProjChips ? factGroup(`${nextSeason} outlook (preseason)`, nextProjChips) : ''}
                ${injuryChip ? factGroup('Current status (live, Sleeper)', injuryChip) : ''}

                ${idsSummary ? `<details class="pp-recap-ids"><summary>External IDs</summary><div class="pp-ids">${idsSummary}</div></details>` : ''}
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
        <span class="mc-kicker">Career teams · ${draftYear ? `since the ${draftYear} draft · ` : ''}${distinct.length} franchise${distinct.length === 1 ? '' : 's'}</span>
        <div class="pp-tl pp-scroll">${html}</div>
        <p class="pm-note">Year-by-year timeline since the NFL draft season; per-season stats from ${FIRST_STATS_YEAR}.${hasInferred ? ' Dashed seasons (earlier or with no data) show the estimated team.' : ''} Multiple logos in the same year = mid-season trade.</p>
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
function outlookNewsBlock({ overview }) {
    if (!overview) return '';
    const { rotowire, nextGame, news } = overview;

    const nextHtml = nextGame?.date ? `
        <div class="pp-nextgame">
            <span class="mc-kicker">Next game</span>
            <b>${esc(nextGame.name || '—')}</b>
            <span class="pm-note" style="margin-top:2px">${[nextGame.week, new Date(nextGame.date).toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' })].filter(Boolean).join(' · ')}</span>
        </div>` : '';

    const rwHtml = rotowire?.story ? `
        <div class="pp-outlook">
            <span class="mc-kicker">Outlook · Rotowire</span>
            ${rotowire.headline ? `<b>${esc(rotowire.headline)}</b>` : ''}
            <p class="pp-outlook-story">${esc(rotowire.story)}</p>
            ${rotowire.published ? `<span class="pm-note">Updated ${new Date(rotowire.published).toLocaleDateString('it-IT')}</span>` : ''}
        </div>` : '';

    const newsHtml = news?.length ? `
        <span class="mc-kicker" style="margin-top:14px">Latest news</span>
        <ul class="pp-news-list">${news.map(n => `
            <li>${n.link ? `<a href="${esc(n.link)}" target="_blank" rel="noopener">${esc(n.headline)}</a>` : esc(n.headline)}${n.published ? ` <span class="pm-note">· ${new Date(n.published).toLocaleDateString('it-IT')}</span>` : ''}</li>`).join('')}</ul>` : '';

    if (!nextHtml && !rwHtml && !newsHtml) return '';
    return `
    <section class="pm-block pp-block">
        ${nextHtml}${rwHtml}${newsHtml}
        <p class="pm-note">Rotowire outlook, next game and news from live ESPN.</p>
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
            ${qbr.rank != null ? tile(ord(qbr.rank), 'Rank among QBs') : ''}
        </div>
        <p class="pm-note">ESPN Total QBR: a 0-100 summary of the QB's impact (passing, rushing, penalties), adjusted for play context.</p>
    </section>`;
}

/**
 * Split statistici ESPN (casa/trasferta, per avversario, per condizione).
 * Tabelle per gruppo con le colonne native ESPN.
 */
function splitsBlock({ splits }) {
    if (!splits?.groups?.length) return '';
    const cols = splits.labels || [];
    const groupHtml = (g) => `
        <div class="pp-statcat">
            <h3 class="pp-cat-title">${esc(g.name)}</h3>
            <div class="pm-table-wrap pp-scroll">
                <table class="pm-table pp-table">
                    <thead><tr><th>Split</th>${cols.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead>
                    <tbody>${g.rows.map(r => `<tr><td>${esc(r.label)}</td>${r.stats.map(v => `<td>${esc(v)}</td>`).join('')}</tr>`).join('')}</tbody>
                </table>
            </div>
        </div>`;
    const primary = splits.groups.slice(0, 2);
    const rest = splits.groups.slice(2);
    return `
    <section class="pm-block pp-block">
        <span class="mc-kicker">Statistical splits · ESPN</span>
        ${primary.map(groupHtml).join('')}
        ${rest.length ? `<details class="pp-recap-ids" style="margin-top:6px"><summary>Other splits (${rest.length})</summary>${rest.map(groupHtml).join('')}</details>` : ''}
        <p class="pm-note">Statistical breakdown by home/away, opponent and game conditions (ESPN, current season).</p>
    </section>`;
}

/** Record di carriera ESPN (spesso vuoto per la NFL: nascosto se assente). */
function recordsBlock({ recordsEspn }) {
    if (!recordsEspn?.length) return '';
    return `
    <section class="pm-block pp-block">
        <span class="mc-kicker">Career records · ESPN</span>
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
                ${p.fpgLeague != null ? `<span class="pp-starter-val">${fmt1(p.fpgLeague)} pt/game</span>` : ''}
            </div>`).join('');
        return `<div class="pp-starters-col"><h3 class="pp-cat-title">${label}</h3>${rows}</div>`;
    };
    const html = side(teamStarters.offense, 'Starting offense') + side(teamStarters.defense, 'Starting defense');
    if (!html) return '';
    return `
    <section class="pm-block pp-block">
        <span class="mc-kicker">Starting lineup · ${abbr}</span>
        <div class="pp-starters-grid">${html}</div>
        <p class="pm-note">${teamStarters.source === 'espn-live' ? 'Live depth chart (ESPN) — the requested season is not yet covered by the periodic nflverse build.' : 'Latest available regular-season depth chart (nflverse).'} League pt/game only where fantasy data exists (offensive positions).</p>
    </section>`;
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

    const heightDisplay = (h) => {
        const hIn = parseFloat(h);
        return hIn ? `${Math.floor(hIn / 12)}'${Math.round(hIn % 12)}"` : '—';
    };
    const allRows = teamRoster.players.map(p => `
        <tr>
            <td>${esc(p.name)}</td><td>${esc(p.pos || '—')}</td>
            <td>${p.jersey != null ? `#${p.jersey}` : '—'}</td>
            <td>${p.status ? esc(p.status) : '—'}</td>
            <td>${p.snapPct != null ? fmt1(p.snapPct) + '%' : '—'}</td>
            <td>${p.fpgLeague != null ? fmt1(p.fpgLeague) : '—'}</td>
            <td>${p.college ? esc(p.college) : '—'}</td>
            <td>${p.height ? heightDisplay(p.height) : '—'}${p.weight ? ` · ${p.weight}lbs` : ''}${p.age != null ? ` · ${p.age}a` : ''}</td>
            <td>${p.draftClub && p.draftNumber ? `${esc(p.draftClub)} #${p.draftNumber}` : (p.rookieYear ? `UDFA ${p.rookieYear}` : '—')}</td>
        </tr>`).join('');

    return `
    <section class="pm-block pp-block">
        <span class="mc-kicker">Teammates · ${abbr}</span>
        ${lbRows ? `<div class="dgt-sos-bars" style="grid-template-columns:1fr">${lbRows}</div>` : ''}
        <details class="pp-recap-ids" style="margin-top:14px">
            <summary>Full roster (${teamRoster.players.length} players)</summary>
            <div class="pm-table-wrap pp-scroll" style="margin-top:10px">
                <table class="pm-table pp-table">
                    <thead><tr><th>Name</th><th>Pos</th><th>Jersey</th><th>Status</th><th>Snap%</th><th>League pt/game</th><th>College</th><th>Build</th><th>Draft</th></tr></thead>
                    <tbody>${allRows}</tbody>
                </table>
            </div>
        </details>
        <p class="pm-note">${teamRoster.source === 'espn-live' ? 'Live roster (ESPN) — the requested season is not yet covered by the periodic nflverse build.' : 'League pt/game and snap% available only for offensive positions (QB/RB/WR/TE/K); the rest of the roster is in the full table.'}</p>
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
        const returned = i < groups.length - 1 ? ' <span style="color:var(--accent-green)">· returned</span>' : '';
        return `<div class="pp-inj-hist-row"><b>${range}</b> ${esc(g.injury)}${statuses.length ? ` · ${statuses.map(esc).join(' → ')}` : ' · managed, never in doubt for a game'}${returned}</div>`;
    }).join('');
    return `
    <details class="pp-recap-ids" style="margin-top:2px">
        <summary>Season history (${groups.length} injuries)</summary>
        ${rows}
    </details>`;
}

export function teamInjuriesBlock({ teamInjuries, abbr }) {
    if (!teamInjuries?.players?.length) return '';
    const rows = teamInjuries.players.map(p => {
        // designazione in allenamento: si mostra solo se aggiunge informazione
        // (spesso coincide col report ufficiale — niente ripetizione inutile)
        const practiceInjury = [p.practicePrimaryInjury, p.practiceSecondaryInjury].filter(Boolean).join(', ');
        const showPracticeInjury = practiceInjury && practiceInjury !== [p.primaryInjury, p.secondaryInjury].filter(Boolean).join(', ');
        const updated = p.dateModified ? new Date(p.dateModified).toLocaleDateString('it-IT') : null;
        return `
        <div class="pp-inj-row">
            <span class="pp-inj-name"><span class="pp-lb-pos">${esc(p.pos || '')}</span> ${esc(p.name)}</span>
            <span class="pp-inj-detail">${p.primaryInjury ? esc(p.primaryInjury) : ''}${p.secondaryInjury ? `, ${esc(p.secondaryInjury)}` : ''}${p.practiceStatus ? ` · ${esc(p.practiceStatus)}` : ''}${showPracticeInjury ? ` (practice injury: ${esc(practiceInjury)})` : ''}${updated ? ` · upd. W${p.week ?? '?'}` : ''}</span>
            ${p.status ? `<span class="pp-inj-status${severityClass(p.status)}">${esc(p.status)}</span>` : ''}
        </div>
        ${injuryHistoryDetails(p.weeks)}`;
    }).join('');
    return `
    <section class="pm-block pp-block">
        <span class="mc-kicker">Team injury report · ${abbr}</span>
        ${rows}
        <p class="pm-note">${teamInjuries.source === 'espn-live'
            ? 'Live report (ESPN) — current status only, no season history available for this source.'
            : `Latest status for each player in the injury report across the entire regular season (through W${Math.max(...teamInjuries.players.map(p => p.week || 0))}); open "Season history" to see when they got hurt, what happened, and whether they returned.`}</p>
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
            <p class="pm-note">No injuries in the official reports ${Math.min(...yrs)}–${Math.max(...yrs)}: a very reliable profile so far.</p>
        </section>`;
    }

    const rows = seasons.map(s => {
        const summary = s.clean ? 'no injury reported'
            : s.injuries.join(', ') + (s.anyOut ? ' · missed games' : '');
        const head = `<div class="pp-inj-yr-head"><b>${s.year}</b> <span class="pp-lb-pos">${esc(s.team)}</span> · ${esc(summary)}</div>`;
        const gRows = s.groups.map((g, i) => {
            const worst = [...new Set(g.weeks.map(w => w.status).filter(Boolean))].sort((a, b) => injSeverity(b) - injSeverity(a))[0] || null;
            const range = g.from === g.to ? `W${g.from}` : `W${g.from}–W${g.to}`;
            const returned = i < s.groups.length - 1 ? ' <span class="pp-inj-back">· returned</span>' : '';
            return `<div class="pp-inj-hist-row"><b>${range}</b> ${esc(g.injury)}${worst ? ` <span class="pp-inj-status${severityClass(worst)}">${esc(worst)}</span>` : ''}${returned}</div>`;
        }).join('');
        return `<div class="pp-inj-yr">${head}${gRows}</div>`;
    }).join('');

    return `
    <section class="pm-block pp-block">
        <span class="mc-kicker">Injury history · season by season</span>
        ${rows}
        <p class="pm-note">From official weekly injury reports (nflverse, from 2019): when they showed up in the report and with what issue. Consecutive weeks with the same injury are merged. Note: long absences from <b>Injured Reserve</b> may not appear as "Out" in the report.</p>
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
export function buildTrendChart(points, color, chartId, unit = 'pt/game') {
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
            class="an-bar" fill="var(--text-muted)" data-label="Projected ${r.x}" data-val="${r.projected.toFixed(1)}" data-color="var(--text-muted)"/>` : '';
        const act = r.actual != null ? `<path d="${barPathRound(start + barW + 4, y(r.actual), barW, BC2.t + plotH - y(r.actual), 2)}"
            class="an-bar" fill="#B8433A" data-label="Real ${r.x}" data-val="${r.actual.toFixed(1)}" data-color="#B8433A"/>` : '';
        return proj + act;
    }).join('');

    return `
    <div class="an-chart-legend">
        <span class="an-legend-item"><span class="an-legend-key" style="background:var(--text-muted)"></span>Projected (preseason)</span>
        <span class="an-legend-item"><span class="an-legend-key" style="background:#B8433A"></span>Real</span>
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
            stroke="#000" stroke-width="2" class="an-dot" data-label="${esc(p.name)}${isSelf ? ' (this player)' : ''}" data-pick="${p.pick}" data-av="${p.careerAV}"/>`;
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
function trendWidget(trend) {
    if (!trend) return '';
    const dir = trend.label === 'up' ? 'up' : trend.label === 'down' ? 'down' : 'flat';
    const icon = dir === 'up' ? '↗' : dir === 'down' ? '↘' : '→';
    const word = dir === 'up' ? 'rising' : dir === 'down' ? 'declining' : 'stable';
    const rate = `${trend.slope > 0 ? '+' : ''}${fmt1(trend.slope)} pt/wk`;
    return `
    <div class="summary-stat pp-trend pp-trend--${dir}">
        <div class="pp-trend-arrow" aria-hidden="true">${icon}</div>
        <div class="summary-stat-value pp-trend-word">${rate}</div>
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

const BP_CHART = { w: 720, h: 250, l: 30, r: 14, t: 12, b: 28 };

/** Densità gaussiana (KDE) in un punto y su un campione di valori. */
const kdeAt = (vals, y, bw) => {
    let s = 0;
    for (const v of vals) { const u = (y - v) / bw; s += Math.exp(-0.5 * u * u); }
    return s / (vals.length * bw * Math.sqrt(2 * Math.PI));
};

/**
 * Violin plot della distribuzione dei punti per stagione: la forma (densità
 * KDE) mostra dove si concentrano i punteggi, con mediana e media, ed eventuale
 * media proiettata per la stagione in arrivo. Hover → tooltip coi valori.
 */
function seasonViolinChart(seasons, nextSeasonProj, nextSeason) {
    const cols = [...seasons]
        .filter(s => (s.weekly || []).filter(g => g.pts != null).length >= 3)
        .sort((a, b) => a.year - b.year)
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
    if (cols.length < 1) return '';

    const projMean = (() => {
        const v = nextSeasonProj?.projPts ?? nextSeasonProj?.ptsStd;
        return v != null ? v / 17 : null;
    })();
    const all = projMean != null ? [...cols, { year: nextSeason, mean: projMean, proj: true }] : cols;

    const C = BP_CHART, plotW = C.w - C.l - C.r, plotH = C.h - C.t - C.b;
    const yMax = Math.max(5, Math.ceil((Math.max(...cols.map(c => c.max + c.bw), projMean || 0)) / 5) * 5);
    const slotW = plotW / all.length;
    const xAt = i => C.l + (i + 0.5) * slotW;
    const yAt = v => C.t + (1 - v / yMax) * plotH;
    const halfW = Math.min(26, slotW * 0.42);

    const defs = `<defs>
        <linearGradient id="pp-bp-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#6aa4ff" stop-opacity="0.62"/>
            <stop offset="100%" stop-color="#5a9bff" stop-opacity="0.20"/>
        </linearGradient>
        <filter id="pp-bp-soft" x="-40%" y="-40%" width="180%" height="180%">
            <feDropShadow dx="0" dy="1.5" stdDeviation="2.5" flood-color="#000" flood-opacity="0.35"/>
        </filter>
    </defs>`;

    // sfondo uniforme dell'area del grafico (stesso colore per tutti gli anni)
    const bg = `<rect x="${C.l}" y="${C.t}" width="${plotW.toFixed(1)}" height="${plotH.toFixed(1)}" rx="8" class="pp-bp-bg"/>`;

    const grid = [0, 0.25, 0.5, 0.75, 1].map(f => {
        const v = Math.round(yMax * f), y = yAt(v);
        return `<line x1="${C.l}" y1="${y.toFixed(1)}" x2="${C.l + plotW}" y2="${y.toFixed(1)}" class="an-gridline"/>
        <text x="${C.l - 6}" y="${(y + 3).toFixed(1)}" class="an-tick" text-anchor="end">${v}</text>`;
    }).join('');

    const violins = all.map((c, i) => {
        const cx = xAt(i);
        if (c.proj) {
            const y = yAt(c.mean), s = 5.5;
            return `<g class="pp-bp-g" data-bpv data-proj="1" data-year="${c.year}" data-mean="${fmt1(c.mean)}">
                <path d="M${cx} ${(y - s).toFixed(1)} L${(cx + s).toFixed(1)} ${y.toFixed(1)} L${cx} ${(y + s).toFixed(1)} L${(cx - s).toFixed(1)} ${y.toFixed(1)} Z" class="pp-bp-proj"/></g>`;
        }
        const STEPS = 28;
        const y0 = Math.max(0, c.min - c.bw), y1 = c.max + c.bw;
        const ys = Array.from({ length: STEPS + 1 }, (_, k) => y0 + (y1 - y0) * k / STEPS);
        const dens = ys.map(y => kdeAt(c.pts, y, c.bw));
        const maxD = Math.max(...dens, 1e-9);
        const wpx = dens.map(d => (d / maxD) * halfW);
        const left = ys.map((y, k) => `${(cx - wpx[k]).toFixed(1)},${yAt(y).toFixed(1)}`);
        const right = ys.map((y, k) => `${(cx + wpx[k]).toFixed(1)},${yAt(y).toFixed(1)}`).reverse();
        const path = `M${left.join(' L')} L${right.join(' L')} Z`;
        const medW = Math.max(3, (dens[Math.round((c.med - y0) / (y1 - y0) * STEPS)] || maxD) / maxD * halfW);
        return `<g class="pp-bp-g pp-bp-violin" data-bpv data-year="${c.year}" data-media="${fmt1(c.mean)}" data-med="${fmt1(c.med)}" data-q1="${fmt1(c.q1)}" data-q3="${fmt1(c.q3)}" data-min="${fmt1(c.min)}" data-max="${fmt1(c.max)}" data-n="${c.n}">
            <path d="${path}" fill="url(#pp-bp-grad)" class="pp-bp-shape"/>
            <line x1="${(cx - medW).toFixed(1)}" y1="${yAt(c.med).toFixed(1)}" x2="${(cx + medW).toFixed(1)}" y2="${yAt(c.med).toFixed(1)}" class="pp-bp-median"/>
            <circle cx="${cx}" cy="${yAt(c.mean).toFixed(1)}" r="3.4" class="pp-bp-mean"/>
        </g>`;
    }).join('');

    const xLabels = all.map((c, i) => `<text x="${xAt(i).toFixed(1)}" y="${C.h - 8}" class="an-tick${c.proj ? ' pp-bp-projlbl' : ''}" text-anchor="middle">${c.year}</text>`).join('');

    const legend = `
    <div class="pp-cmp-legend">
        <span class="pp-cmp-leg"><i class="pp-bp-lg-box"></i>distribution</span>
        <span class="pp-cmp-leg"><i class="pp-bp-lg-med"></i>median</span>
        <span class="pp-cmp-leg"><i class="pp-bp-lg-mean"></i>average</span>
        ${projMean != null ? `<span class="pp-cmp-leg"><i class="pp-bp-lg-proj"></i>${nextSeason} proj.</span>` : ''}
    </div>`;

    return `
    <div class="pp-cmp-chart pp-bp-chart">
        <svg viewBox="0 0 ${C.w} ${C.h}" class="an-svg pp-bp-svg" preserveAspectRatio="xMidYMid meet">
            ${defs}${bg}${grid}${violins}${xLabels}
        </svg>
        <div class="pp-chart-tip" hidden></div>
    </div>`;
}

function metricsBlock(seasons, pos, nextSeasonProj, nextSeason) {
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

    const kpis = [
        kpi(fmt1(m.media), 'Avg pt/game', true), kpi(fmt1(m.mediana), 'Median'),
        kpi(fmt1(m.ceiling), 'Ceiling'), kpi(fmt1(m.floor), 'Floor'),
        kpi(m.consistency != null ? fmt0(m.consistency * 100) + '%' : null, 'Consistency'),
        trendWidget(m.trend),
        kpi(m.boomPct != null ? m.boomPct + '%' : null, 'Boom'),
        kpi(m.bustPct != null ? m.bustPct + '%' : null, 'Bust'),
    ].join('');

    // Seconda riga di widget, stessa estetica KPI della prima riga.
    const moreKpis = [
        kpi(fmt0(m.gp), 'Total games'),
        kpi(fmt1(m.devStd), 'Std. deviation'),
        kpi(m.cv != null ? fmt1(m.cv * 100) + '%' : null, 'Coeff. of variation'),
        kpi(fmt1(m.last5Avg), 'Last 5'),
        kpi(fmt1(m.homeAvg), 'Home average'), kpi(fmt1(m.awayAvg), 'Away average'),
        kpi(eff?.ydsPerTouch != null ? fmt1(eff.ydsPerTouch) : null, 'Yards per touch'),
        kpi(eff?.tdPerTouch != null ? fmt1(eff.tdPerTouch * 100) + '%' : null, 'TD per touch'),
        kpi(eff?.fpPerTouch != null ? fmt1(eff.fpPerTouch) : null, 'FP per touch'),
        kpi(eff?.fpPerTarget != null ? fmt1(eff.fpPerTarget) : null, 'FP per target'),
        kpi(eff?.catchPct != null ? eff.catchPct + '%' : null, 'Catch %'),
        kpi(eff?.ydsPerAtt != null ? fmt1(eff.ydsPerAtt) : null, 'Yards per attempt'),
    ].join('');

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
                    <thead><tr><th>Year</th><th>GP</th><th>Avg</th><th>Median</th><th>Floor</th><th>Ceiling</th><th>Std.dev</th><th>Boom</th><th>Bust</th><th>Consist.</th></tr></thead>
                    <tbody>${tableRows}</tbody>
                </table>
            </div>
        </details>` : '';

    return `
    <section class="pm-block pp-block">
        <span class="mc-kicker">Advanced metrics · career (${m.gp} games${nSeasons > 1 ? `, ${nSeasons} seasons` : ''})</span>
        <div class="pp-kpi">${kpis}</div>
        <div class="pp-kpi pp-kpi--sec">${moreKpis}</div>
        <h3 class="pp-cat-title" style="margin-top:20px">Points distribution by season</h3>
        ${seasonViolinChart(seasons, nextSeasonProj, nextSeason)}
        ${table}
        <p class="pm-note">Widgets refer to the entire NFL career (from ${FIRST_STATS_YEAR}). Violin plot: width is the density of scores (where they concentrate), line = median, dot = average.${nextSeasonProj ? ` The dashed diamond is the projected ${nextSeason} average (Rotowire via Sleeper).` : ''} Hover over a season for the values.</p>
    </section>`;
}

// ─── Confronto con la lega Topina ────────────────────────────────

/** Metriche di confronto per ruolo (per-gara), dai campi di getSeasonStats. */
const CMP_METRICS = {
    QB: [['Lg pts/game', 'ptsLeague'], ['Pass yd/game', 'passYd'], ['Pass TD/game', 'passTd'], ['Rush yd/game', 'rushYd']],
    RB: [['Lg pts/game', 'ptsLeague'], ['Rush yd/game', 'rushYd'], ['Receptions/game', 'rec'], ['Rec yd/game', 'recYd']],
    WR: [['Lg pts/game', 'ptsLeague'], ['Rec yd/game', 'recYd'], ['Receptions/game', 'rec'], ['Targets/game', 'tgt']],
    TE: [['Lg pts/game', 'ptsLeague'], ['Rec yd/game', 'recYd'], ['Receptions/game', 'rec'], ['Targets/game', 'tgt']],
    K: [['Lg pts/game', 'ptsLeague'], ['Field goals/game', 'fgm'], ['Extra points/game', 'xpm']],
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
            <span class="pp-cmp-val"><b>${fmt1(m.mv)}</b> · ${ord(m.p)}</span>
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
            <span class="pp-cmp-dist-median" style="left:${at(d.median).toFixed(1)}%" title="league median ${fmt1(d.median)}"></span>
            <span class="pp-cmp-dist-me" style="left:${at(d.mv).toFixed(1)}%"><i></i><span class="pp-cmp-dist-me-val">${fmt1(d.mv)}</span></span>
        </div>
        <div class="pp-cmp-dist-scale"><span>min ${fmt1(d.min)}</span><span>median ${fmt1(d.median)}</span><span>max ${fmt1(d.max)}</span></div>
        <p class="pp-cmp-rank">Lg pts/game: <b>${ord(d.rank)} of ${d.n}</b> ${pos}s in the league · <b>${ord(d.p)}</b> percentile</p>`;
    }

    if (!bars && !dist) return '';
    return `
    ${dist}
    ${bars ? `<div class="pp-cmp-bars">${bars}</div>` : ''}
    <p class="pm-note">Comparison only among players ever fielded in the Topina league who played in ${year} (${c.poolSize} ${pos}s). Per-game values in the league's scoring; percentile = share of same-position Topina players the player beats.</p>`;
}

const comparisonEmpty = (year) => `<p class="pm-empty">Comparison not available for the ${year} season (insufficient data or pool).</p>`;

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
        <text x="${C.l - 6}" y="${(yAt(v) + 3).toFixed(1)}" class="an-tick" text-anchor="end">${ord(v)}</text>`).join('');

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
            <rect class="pp-cmp-colhit" x="${x.toFixed(1)}" y="${C.t}" width="${w.toFixed(1)}" height="${plotH}" fill="transparent"><title>Season ${y}</title></rect>
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
        <span class="mc-kicker">League comparison · ${pos} · percentiles by season</span>
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
        ['Yd/rush', s => n1(s.ydsPerCarry)], ['YBC/att', s => n2(s.ybcPerAtt)], ['YAC/att', s => n2(s.yacPerAtt)],
        ['RYOE/att', s => n2(s.ryoePerAtt)], ['Broken tk', s => fmt0(s.rushBrokenTk)], ['Catch%', s => pct(s.catchRate)],
        ['Yd/target', s => n1(s.ydsPerTgt)], ['YAC/rec', s => n1(s.yacPerRec)],
        ['% box 8+', s => pp(s.pctAtt8Def)], ['Time to LOS', s => n2(s.timeToLos)], ['EPA/game', s => n2(s.epaPerGame)],
    ];
    if (pos === 'QB') return [
        ['Snap%', s => pct(s.snapPct)], ['CPOE', s => n1(s.cpoe)], ['Exp. compl.%', s => pp(s.expComplPct)],
        ['EPA/game', s => n2(s.epaPerGame)], ['Time to throw', s => n2(s.timeToThrow)], ['Aggress.%', s => pp(s.aggressiveness)],
        ['Air→sticks', s => n2(s.airYdToSticks)], ['Bad throw%', s => pct(s.qbBadThrowPct)], ['Pressed%', s => pct(s.qbPressuredPct)],
        ['Sacks taken', s => fmt0(s.qbSacked)], ['Blitz', s => fmt0(s.qbBlitzed)], ['Hurried', s => fmt0(s.qbHurried)],
        ['QB hit', s => fmt0(s.qbHit)], ['Pass yd', s => fmt0(s.passYd)], ['Pass TD', s => fmt0(s.passTd)],
        ['Carries/game', s => n1(s.carriesPerGame)], ['Yd/rush', s => n1(s.ydsPerCarry)],
    ];
    if (pos === 'K') return [
        ['FG made', s => fmt0(s.fgMade)], ['FG att.', s => fmt0(s.fgAtt)], ['Lg pts/game', s => n1(s.fpgLeague)],
    ];
    return [ // WR / TE
        ['Snap%', s => pct(s.snapPct)], ['Target%', s => pct(s.targetShare)], ['Air yd%', s => pct(s.airYardsShare)],
        ['WOPR', s => n2(s.wopr)], ['RACR', s => n2(s.racr)], ['Catch%', s => pct(s.catchRate)],
        ['Yd/target', s => n1(s.ydsPerTgt)], ['YAC/rec', s => n1(s.yacPerRec)], ['Separation (yd)', s => n1(s.sep)],
        ['Cushion (yd)', s => n1(s.cushion)], ['YAC±exp', s => n1(s.yacOE)], ['Air yd int.', s => n1(s.intendedAirYd)],
        ['Drops', s => fmt0(s.recDrops)], ['Drop%', s => pct(s.recDropPct)], ['Broken tk', s => fmt0(s.recBrokenTk)],
        ['EPA/game', s => n2(s.epaPerGame)],
    ];
}

function advancedNflverseBlock(advSeasons, pos) {
    if (!advSeasons?.length) return '';
    const cols = advCols(pos);
    const rows = [...advSeasons].sort((a, b) => b.year - a.year).map(s => `
        <tr${s.provisional ? ' class="pp-adv-prov"' : ''}><td>${s.year}${s.provisional ? '<span class="pp-adv-star" title="Provisional (Sleeper)">*</span>' : ''}</td><td>${fmt0(s.gp)}</td>${cols.map(([, f]) => `<td>${f(s)}</td>`).join('')}</tr>`).join('');
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
        <p class="pm-note">Advanced NFL data not on Sleeper — target/snap share, WOPR, EPA, separation and cushion (Next Gen Stats), YBC/YAC and broken tackles, drops, QB pressures (PFR). Some tracking/PFR fields start in 2016-2018 and may be missing for more recent seasons if nflverse hasn't published them yet. Same data that feeds the Player Context Score (SOS+) in Draft Grades.${hasProv ? ' <b>Seasons marked with *</b> are provisional: calculated from the Sleeper box score pending nflverse data (snap%, catch%, target/rush yield only); tracking/EPA/share metrics appear on their own once nflverse publishes.' : ''}</p>
    </section>`;
}

// ─── Carriera per categoria ──────────────────────────────────────

const g0 = (s, k) => s?.[k] != null ? fmt0(s[k]) : '—';
const g1 = (s, k) => s?.[k] != null ? fmt1(s[k]) : '—';

const CATEGORIES = [
    {
        title: 'Passing', has: s => (s.pass_att || 0) > 0,
        head: ['Cmp/Att', '%', 'Yards', 'TD', 'INT', 'Rating', 'Sack', 'Air yd', '1st down', 'RZ att', '2pt'],
        cells: s => [
            s.pass_att != null ? `${fmt0(s.pass_cmp)}/${fmt0(s.pass_att)}` : '—',
            g1(s, 'cmp_pct'), g0(s, 'pass_yd'), g0(s, 'pass_td'), g0(s, 'pass_int'),
            g1(s, 'pass_rtg'), g0(s, 'pass_sack'), g0(s, 'pass_air_yd'), g0(s, 'pass_fd'),
            g0(s, 'pass_rz_att'), g0(s, 'pass_2pt')],
        chartLabel: 'Passing yards', chartValue: s => s.pass_yd, chartUnit: 'yards',
    },
    {
        title: 'Rushing', has: s => (s.rush_att || 0) > 0,
        head: ['Att', 'Yards', 'Avg', 'TD', 'Long', '1st down', 'RZ att', 'YAC'],
        cells: s => [
            g0(s, 'rush_att'), g0(s, 'rush_yd'), g1(s, 'rush_ypa'), g0(s, 'rush_td'),
            g0(s, 'rush_lng'), g0(s, 'rush_fd'), g0(s, 'rush_rz_att'), g0(s, 'rush_yac')],
        chartLabel: 'Rushing yards', chartValue: s => s.rush_yd, chartUnit: 'yards',
    },
    {
        title: 'Receiving', has: s => (s.rec_tgt || 0) > 0 || (s.rec || 0) > 0,
        head: ['Targets', 'Rec', 'Yards', 'Avg', 'TD', 'Long', 'Air yd', 'YAC', '1st down', 'RZ tgt', 'Drop'],
        cells: s => [
            g0(s, 'rec_tgt'), g0(s, 'rec'), g0(s, 'rec_yd'), g1(s, 'rec_ypr'), g0(s, 'rec_td'),
            g0(s, 'rec_lng'), g0(s, 'rec_air_yd'), g0(s, 'rec_yar'), g0(s, 'rec_fd'),
            g0(s, 'rec_rz_tgt'), g0(s, 'rec_drop')],
        chartLabel: 'Receiving yards', chartValue: s => s.rec_yd, chartUnit: 'yards',
    },
    {
        title: 'Kicking', has: s => (s.fga || 0) > 0 || (s.fgm || 0) > 0 || (s.xpa || 0) > 0,
        head: ['FG', '%', '0-19', '20-29', '30-39', '40-49', '50+', 'Long', 'XP'],
        cells: s => [
            `${fmt0(s.fgm ?? 0)}/${fmt0(s.fga ?? 0)}`,
            s.fga ? fmt1((s.fgm || 0) / s.fga * 100) : '—',
            g0(s, 'fgm_0_19'), g0(s, 'fgm_20_29'), g0(s, 'fgm_30_39'), g0(s, 'fgm_40_49'),
            g0(s, 'fgm_50p'), g0(s, 'fgm_lng'),
            `${fmt0(s.xpm ?? 0)}/${fmt0(s.xpa ?? 0)}`],
        chartLabel: 'Field goals made', chartValue: s => s.fgm, chartUnit: 'FG',
    },
    {
        title: 'Individual defense (IDP)', has: s => (s.idp_tkl || 0) > 0 || (s.idp_sack || 0) > 0,
        head: ['Tackles', 'Solo', 'Sack', 'INT', 'FF', 'Fum rec', 'Pass def.', 'QB hit', 'TFL', 'TD', 'Safety'],
        cells: s => [
            g0(s, 'idp_tkl'), g0(s, 'idp_tkl_solo'), g1(s, 'idp_sack'), g0(s, 'idp_int'),
            g0(s, 'idp_ff'), g0(s, 'idp_fum_rec'), g0(s, 'idp_pass_def'), g0(s, 'idp_qb_hit'),
            g0(s, 'idp_tkl_loss'), g0(s, 'idp_def_td'), g0(s, 'idp_safe')],
        chartLabel: 'Tackles', chartValue: s => s.idp_tkl, chartUnit: 'tackles',
    },
    {
        title: 'Returns', has: s => (s.kr || 0) > 0 || (s.pr || 0) > 0,
        head: ['Kick ret', 'KR yards', 'Punt ret', 'PR yards', 'Return TD'],
        cells: s => [g0(s, 'kr'), g0(s, 'kr_yd'), g0(s, 'pr'), g0(s, 'pr_yd'),
            fmt0((s.kr_td || 0) + (s.pr_td || 0) || (s.st_td ?? null))],
        chartLabel: 'Return yards (kick + punt)', chartValue: s => (s.kr_yd || 0) + (s.pr_yd || 0), chartUnit: 'yards',
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
                    <thead><tr><th>Year</th><th>GP</th><th>Lg pts</th><th>Std</th><th>Half</th><th>PPR</th><th>Rank</th><th>Snap %</th></tr></thead>
                    <tbody>${body}</tbody>
                </table>
            </div>`;
        const points = [...fRows].sort((a, b) => a.year - b.year)
            .map(s => ({ x: s.year, y: s.totals.pts })).filter(p => p.y != null);
        const chart = points.length >= 2 ? buildTrendChart(points, '#B8433A', 'pp-cat-chart-fantasy') : '';
        panels.push({ key: 'fantasy', label: 'Fantasy', html: `${table}${chart ? `<h3 class="pp-cat-title" style="margin-top:18px">Lg pts by season</h3>${chart}` : ''}` });
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
        panels.push({ key, label: cat.title, html: `${table}${chart ? `<h3 class="pp-cat-title" style="margin-top:18px">${esc(cat.chartLabel)} by season</h3>${chart}` : ''}` });
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
        combineDraft.draft?.careerAV != null ? factChip(combineDraft.draft.careerAV, 'career AV') : '',
        combineDraft.draft?.weightedAV != null ? factChip(combineDraft.draft.weightedAV, 'weighted AV') : '',
        combineDraft.draft?.lastSeason != null ? factChip(combineDraft.draft.lastSeason, 'last season') : '',
    ].filter(Boolean).join('');
    return `
    <section class="pm-block pp-block">
        <span class="mc-kicker">Career total · Pro Football Reference</span>
        ${blocks}
        ${av ? `<div class="pp-fact-chips" style="margin-top:10px">${av}</div>` : ''}
        <p class="pm-note">Totals for the entire NFL career (including seasons before ${FIRST_STATS_YEAR}, not covered by Sleeper above).</p>
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
        <span class="mc-kicker">${d.season} Draft · ${d.team}${d.round ? ` — all ${draftPeers.length} ${combineDraft.pos || ''}s picked that year` : ''}</span>
        ${chart}
        <p class="pm-note">Overall pick (x-axis) vs career Approximate Value — PFR (y-axis). Bigger red dot = this player.</p>
    </section>`;
}

/** Confronto proiezione preseason vs statistiche reali, anno per anno. */
/**
 * Tabella completa delle proiezioni preseason anno per anno: punti proiettati
 * (scoring lega e standard), ADP, partite proiettate, punti reali e delta.
 * Include la stagione in arrivo (solo proiezione). Dati Rotowire via Sleeper.
 */
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
                <thead><tr><th>Year</th><th>Lg pts proj.</th><th>Std pts proj.</th><th>ADP</th><th>GP proj.</th><th>Real pts</th><th>Δ</th></tr></thead>
                <tbody>${body}</tbody>
            </table>
        </div>
        <p class="pm-note">Rotowire preseason projections (via Sleeper) and half-PPR ADP (from 2018). Δ = real points − projected (green = above projection, red = below).</p>
    </section>`;
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
    if (rows.length < 2) return '';
    const chart = buildGroupedBarChart(rows, 'pp-proj-actual-chart');
    if (!chart) return '';
    const withBoth = rows.filter(r => r.projected != null && r.actual != null);
    const avgDelta = withBoth.length ? withBoth.reduce((s, r) => s + (r.actual - r.projected), 0) / withBoth.length : null;
    return `
    <section class="pm-block pp-block">
        <span class="mc-kicker">Projected vs real · year by year</span>
        ${chart}
        <p class="pm-note">Rotowire preseason projections (via Sleeper) against league points actually scored.${avgDelta != null ? ` On average ${avgDelta >= 0 ? 'beat' : 'missed'} the projection by ${fmt1(Math.abs(avgDelta))} pt/season.` : ''}</p>
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
            (Math.abs(dec.residual) >= 2 ? `<div class="pp-pe-row pp-pe-row--muted"><span class="pp-pe-stat">Other (2pt/bonus)</span><span class="pp-pe-cmp"></span><span class="pp-pe-track"></span><span class="pp-pe-val">${dec.residual >= 0 ? '+' : ''}${fmt0(dec.residual)}</span></div>` : '');

        const readoutHtml = dec.readouts.length
            ? `<div class="pp-pe-readouts">${dec.readouts.map(r => `${r.label}: ${r.proj != null ? `${r.proj}<span class="pp-pe-arr">→</span>` : ''}<b>${r.actual}</b>`).join(' · ')}</div>`
            : '';
        const causesHtml = causeItems.length
            ? `<div class="pp-pe-causes"><span class="pp-pe-causes-lbl">Why</span>${causeItems.map(c => `<div class="pp-pe-cause"><span class="pp-pe-cause-ic">${c.icon}</span> ${c.text}</div>`).join('')}</div>`
            : '';

        const missed = dec.gpP - dec.gpA;
        return `
        <div class="pp-pe-season">
            <div class="pp-pe-head">${s.year}: real <b>${fmt0(dec.actPts)}</b> − projected ${fmt0(dec.projPts)} = <span class="pp-res pp-res--${dec.error >= 0 ? 'w' : 'l'}">${dec.error >= 0 ? '+' : ''}${fmt0(dec.error)}</span> · ${dec.gpA}/${dec.gpP} games${missed >= 2 ? ` <span class="pp-pe-miss">(${missed} missed)</span>` : ''}</div>
            ${verdict?.headline ? `<div class="pp-perr-verdict pp-perr-verdict--${dec.error >= 0 ? 'w' : 'l'}">${verdict.headline}</div>` : ''}
            <div class="pp-pe-rows">${rowsHtml}</div>
            ${readoutHtml}
            ${causesHtml}
        </div>`;
    }).join('');
    if (!seasons.trim()) return '';

    return `
    <section class="pm-block pp-block">
        <span class="mc-kicker">Why they performed this way · projected vs real, stat by stat</span>
        ${seasons}
        <p class="pm-note">Each row is a stat: <b>projected → real</b> (season totals) and the impact in league points (difference × scoring value). Entries sum EXACTLY to the error (real − projected). Missed games aren't a row on their own — they reduce the volume totals — but are flagged separately. The <b>Why</b> section links the changes to real-world context: teammate injuries, market moves, offensive performance and schedule difficulty.</p>
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
        <p class="pm-note">Rotowire preseason projections (via Sleeper) — yards, TDs, receptions etc. projected per season; last row (highlighted) = upcoming ${nextSeason} season, not yet played.</p>
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
        head: ['Att', 'Rush yd', 'TD', 'Rec', 'Rec yd'],
        cells: s => [g0(s, 'rush_att'), g0(s, 'rush_yd'),
            fmt0((s.rush_td || 0) + (s.rec_td || 0)), g0(s, 'rec'), g0(s, 'rec_yd')],
    };
    if (pos === 'K') return {
        head: ['FG', 'Long', 'XP'],
        cells: s => [`${fmt0(s.fgm ?? 0)}/${fmt0(s.fga ?? 0)}`, g0(s, 'fgm_lng'), `${fmt0(s.xpm ?? 0)}/${fmt0(s.xpa ?? 0)}`],
    };
    if (pos === 'DEF') return {
        head: ['Sack', 'INT', 'Fum rec', 'TD', 'Pts allow', 'Yds allow'],
        cells: s => [g0(s, 'sack'), g0(s, 'int'), g0(s, 'fum_rec'), g0(s, 'def_td'), g0(s, 'pts_allow'), g0(s, 'yds_allow')],
    };
    return { // WR / TE
        head: ['Targets', 'Rec', 'Yards', 'TD'],
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
            <summary>${s.year} Season <span class="pp-gamelog-meta">${s.weekly.length} games${s.totals?.pts != null ? ` · ${fmt1(s.totals.pts)} pt lega` : ''}</span></summary>
            <div class="pm-table-wrap pp-scroll">
                <table class="pm-table pp-table pp-table--compact">
                    <thead><tr><th>Wk</th><th>Opp</th>${cols.head.map(h => `<th>${h}</th>`).join('')}<th>Snap</th><th>Lg pts</th><th>Half</th></tr></thead>
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
        <p class="pm-note">Team points/game from each season's real schedule; the tooltip also shows record, PPG rank and starting QB for that year (depth chart).</p>
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

/** Solo i blocchi rosa/calendario (titolari, compagni, infermeria, matchup) — pagina squadra, sezione 03. */
export function teamScheduleBlocksHtml(abbr, pos, data) {
    const wrap = { ...data, abbr, pos };
    return `${startersBlock(wrap)}${teammatesBlock(wrap)}${teamInjuriesBlock(wrap)}${matchupBlock(wrap)}`;
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
        a.offEpaPerPlay != null ? factChip(fmt2(a.offEpaPerPlay), 'EPA/play') : '',
        a.successRate != null ? factChip(fmt0(a.successRate * 100) + '%', 'success rate') : '',
        a.proe != null ? factChip((a.proe >= 0 ? '+' : '') + fmt1(a.proe) + '%', 'PROE') : '',
        o.passRate != null ? factChip(fmt0(o.passRate * 100) + '%', 'pass plays') : '',
    ].filter(Boolean).join('');

    const offMeters = [
        meterBar('Points/game', fmt1(o.ppg), r.ppg),
        meterBar('Total yards/game', fmt1(o.totYdsPg), r.totYdsPg),
        meterBar('Pass yards/game', fmt1(o.passYdsPg), r.passYdsPg),
        meterBar('Rush yards/game', fmt1(o.rushYdsPg), r.rushYdsPg),
        meterBar('Yards/play', fmt1(o.ydsPerPlay), r.ydsPerPlay),
        meterBar('Plays/game (pace)', fmt1(o.playsPg), r.playsPg),
        meterBar('Red zone plays/game', fmt1(o.rzPlaysPg), r.rzPlaysPg),
        meterBar('Turnovers', fmt0(o.turnovers), r.turnovers),
        meterBar('Sacks allowed', fmt0(o.sacksAllowed), r.sacksAllowed),
        meterBar('Passing TDs', fmt0(o.passTd), r.passTd),
        meterBar('Rushing TDs', fmt0(o.rushTd), r.rushTd),
    ].join('');

    // difesa della squadra (stessi dati team_stats, prima non mostrati)
    const d = ctx.team.defense, rd = ctx.team.ranks?.defense || {};
    const defMeters = d ? [
        meterBar('Points allowed/game', fmt1(d.papg), rd.papg),
        meterBar('Yards allowed/game', fmt1(d.totYdsAllowedPg), rd.totYdsAllowedPg),
        meterBar('Pass yards allowed', fmt1(d.passYdsAllowedPg), rd.passYdsAllowedPg),
        meterBar('Rush yards allowed', fmt1(d.rushYdsAllowedPg), rd.rushYdsAllowedPg),
        meterBar('Sacks', fmt0(d.sacks), rd.sacks),
        meterBar('Interceptions', fmt0(d.interceptions), rd.interceptions),
        meterBar('Takeaways', fmt0(d.takeaways), rd.takeaways),
        meterBar('Defensive TDs', fmt0(d.defTds), rd.defTds),
    ].join('') : '';

    return `
    <section class="pm-block pp-block">
        <span class="mc-kicker">Team strength · ${abbr} offense ${ctx.season}${ctx.fallback ? ' (latest available season)' : ''}</span>
        ${factChips ? `<div class="pp-fact-chips" style="margin:8px 0 12px">${factChips}</div>` : ''}
        <div class="dgt-sos-bars">${offMeters}</div>
        ${defMeters ? `
        <span class="mc-kicker" style="margin-top:18px">${abbr} Defense</span>
        <div class="dgt-sos-bars">${defMeters}</div>` : ''}
        <p class="pm-note">Meter = percentile across 32 teams (full = 1st, empty = 32nd); green = top 10, red = bottom 10.${advTeam ? ' EPA/success/PROE from nflverse play-by-play.' : ''}</p>
    </section>`;
}

export function matchupChip(rank) {
    if (rank == null) return '—';
    const cls = rank <= 10 ? 'pp-mu--easy' : rank >= 23 ? 'pp-mu--hard' : 'pp-mu--mid';
    const label = rank <= 10 ? 'soft' : rank >= 23 ? 'hard' : 'average';
    return `<span class="pp-mu ${cls}">${ord(rank)} · ${label}</span>`;
}

export function matchupBlock({ ctx, pos, abbr }) {
    if (!ctx?.opponents?.length) return '';
    const P = POS_LIST.includes(pos) ? pos : 'WR';
    const vsOffense = pos === 'DEF';

    const rows = ctx.opponents.map(g => {
        const fpaP = g.fpa?.[P];
        const res = g.result ? `<span class="pp-res pp-res--${g.result.toLowerCase()}">${g.pf}-${g.pa} ${g.result === 'W' ? 'W' : g.result === 'L' ? 'L' : 'T'}</span>` : '—';
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
        ? '<th>Offense PPG</th><th>Yards/game</th><th>Turnovers</th>'
        : `<th>FPA ${P}/game</th><th>Matchup</th><th>Pts allowed/game</th>`;

    const sosVal = ctx.sos?.[P];
    const sosLine = sosVal != null
        ? `<p class="pp-sos">Strength of schedule vs ${P}: opponents' average FPA rank <b>${fmt1(sosVal)}</b> — ${sosVal <= 13 ? 'favorable schedule' : sosVal >= 20 ? 'tough schedule' : 'average schedule'} (low rank = defenses that allow more).</p>`
        : '';

    return `
    <section class="pm-block pp-block">
        <span class="mc-kicker">Schedule and matchups · ${ctx.season}${ctx.fallback ? ' (latest available season)' : ''}</span>
        ${sosLine}
        <div class="pm-table-wrap pp-scroll">
            <table class="pm-table pp-table">
                <thead><tr><th>Wk</th><th>Opponent</th><th>Result</th>${head}</tr></thead>
                <tbody>${rows}</tbody>
            </table>
        </div>
        <p class="pm-note">${vsOffense
            ? "For a defense the matchup depends on the opposing offense: PPG and yards with the offensive rank (1st = best offense)."
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
        <a class="pp-tcc-head" href="#nfl-team/${abbr}" title="Go to the full team page">
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
            <span class="pp-tcc-lbl">Next game</span>
            <span class="pp-tcc-opp">W${next.week} ${next.home ? '' : '@ '}<img class="pp-opp-logo" src="${teamLogo(next.opp)}" alt="" onerror="this.style.display='none'">${next.opp}${next.record ? ` <span class="pp-opp-rec">(${next.record.w}-${next.record.l})</span>` : ''}</span>
            ${fpaP && fpaP.rank != null ? `<span class="pp-tcc-mu">FPA ${P} ${fmt1(fpaP.pgLeague ?? fpaP.pgHalf)} ${matchupChip(fpaP.rank)}</span>` : ''}
        </div>` : '';

    // Forza calendario (SOS) del ruolo
    const sosVal = ctx.sos?.[P];
    const sosHtml = sosVal != null ? `
        <div class="pp-tcc-item">
            <span class="pp-tcc-lbl">Schedule strength · ${P}</span>
            <span class="pp-tcc-sosval">opponents' average FPA rank <b>${fmt1(sosVal)}</b> · ${sosVal <= 13 ? 'favorable' : sosVal >= 20 ? 'tough' : 'average'}</span>
        </div>` : '';

    // Forza squadra sintetica per ruolo (2-4 chip col rank)
    const rankChip = (val, label, rank) => val == null ? '' : factChip(`${val}${rankBadge(rank)}`, label);
    let chips;
    if (pos === 'QB' || pos === 'WR' || pos === 'TE') {
        chips = [
            rankChip(fmt1(o.passYdsPg), 'pass yd/game', r.passYdsPg),
            o.passRate != null ? factChip(fmt0(o.passRate * 100) + '%', 'pass plays') : '',
            rankChip(fmt1(o.playsPg), 'plays/game', r.playsPg),
            a.proe != null ? factChip((a.proe >= 0 ? '+' : '') + fmt1(a.proe) + '%', 'PROE') : '',
        ];
    } else if (pos === 'RB') {
        chips = [
            rankChip(fmt1(o.rushYdsPg), 'rush yd/game', r.rushYdsPg),
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
            rankChip(fmt1(o.totYdsPg), 'total yards/game', r.totYdsPg),
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
        <p class="pm-note">Summary of the team context for a ${P}. Full roster, defense, schedule and history in the <a href="#nfl-team/${abbr}">team page</a>.</p>
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
                    <div class="pp-recap-name"><span class="mc-kicker">Defense · Topina Draft ${year}</span></div>
                    <h1 class="mc-title">${esc(name)} <span class="allpro-pos pos-def">DEF</span></h1>
                    ${identity ? `<div class="pp-recap-team"><span class="pp-team-div" style="color:${identity.color}">${esc(identity.conf)} · ${esc(identity.division)}</span></div>` : ''}
                    ${factGroup('Topina', [
                        career?.seasons.size ? factChip(career.seasons.size, `season${career.seasons.size === 1 ? '' : 's'} drafted`) : '',
                        career?.sbWins ? factChip(`🏆×${career.sbWins}`, 'Super Bowl (Topina)', 'pp-fact-chip--accent') : '',
                    ].filter(Boolean).join(''))}
                </div>
            </div>
        </header>

        <h2 class="pp-section-title"><small>02</small> Metrics</h2>
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
        meterBar('Pass yards allowed', fmt1(d.passYdsAllowedPg), r.passYdsAllowedPg),
        meterBar('Rush yards allowed', fmt1(d.rushYdsAllowedPg), r.rushYdsAllowedPg),
        meterBar('Sacks', fmt0(d.sacks), r.sacks),
        meterBar('Interceptions', fmt0(d.interceptions), r.interceptions),
        meterBar('Forced fumbles', fmt0(d.fumblesForced), r.fumblesForced),
        meterBar('Forced turnovers', fmt0(d.takeaways), r.takeaways),
        meterBar('Defensive TDs', fmt0(d.defTds), r.defTds),
        meterBar('Passes defended', fmt0(d.passDefended), r.passDefended),
        meterBar('Tackles for loss', fmt0(d.tacklesForLoss), r.tacklesForLoss),
        meterBar('QB hits', fmt0(d.qbHits), r.qbHits),
    ].join('');
    const extraChips = [
        factChip(fmt0(d.fumbleRecoveries), 'fumble recoveries'),
        factChip(fmt0(d.safeties), 'safeties'),
        factChip(fmt0(d.blockedKicks), 'blocked kicks'),
    ].join('');
    return `
    <section class="pm-block pp-block">
        <span class="mc-kicker">The defense · ${abbr} ${ctx.season}${ctx.fallback ? ' (latest available season)' : ''}</span>
        <div class="dgt-sos-bars">${meters}</div>
        <div class="pp-fact-chips" style="margin-top:12px">${extraChips}</div>
        <p class="pm-note">Meter = percentile across 32 teams; green = top 10, red = bottom 10.</p>
    </section>`;
}

export function fpaBlock({ ctx }) {
    if (!ctx?.team?.fpa) return '';
    const rows = POS_LIST.filter(p => p !== 'DEF').map(p => {
        const f = ctx.team.fpa[p];
        if (!f || (f.pgLeague == null && f.pgHalf == null)) return '';
        return `<tr><td>${p}</td><td class="pm-td-strong">${fmt1(f.pgLeague ?? f.pgHalf)}</td><td>${fmt1(f.pgHalf)}</td><td>${matchupChip(f.rank)}</td></tr>`;
    }).filter(Boolean).join('');
    if (!rows) return '';
    return `
    <section class="pm-block pp-block">
        <span class="mc-kicker">Fantasy points allowed by position</span>
        <div class="pm-table-wrap pp-scroll">
            <table class="pm-table pp-table">
                <thead><tr><th>Position</th><th>Lg FPA/game</th><th>Half FPA/game</th><th>Rank</th></tr></thead>
                <tbody>${rows}</tbody>
            </table>
        </div>
        <p class="pm-note">Rank 1st = the defense that allows the most fantasy points to that position (soft matchup for opponents).</p>
    </section>`;
}

/** Blocchi esclusivi squadra (solo pagina DEF): trade storiche, ATS, storia franchigia, draft NFL storico. */
export function teamExtrasBlock({ teamExtras, abbr }) {
    if (!teamExtras) return '';
    const { trades, ats, history, draftHistory } = teamExtras;

    // Anteprima visibile + il resto in un dettaglio espandibile (mai troncato senza modo di vedere tutto)
    const tradeRow = t => `<tr><td>${t.date ? new Date(t.date).toLocaleDateString('it-IT') : '—'}</td><td>${t.received ? esc(t.received) : '—'}</td><td>${t.player ? esc(t.player) : (t.pick ? esc(t.pick) : '—')}${t.conditional ? ' <small style="color:var(--text-muted)">(conditional)</small>' : ''}</td></tr>`;
    const tradesHtml = trades?.length ? `
        <span class="mc-kicker">Recent trades</span>
        <div class="pm-table-wrap pp-scroll">
            <table class="pm-table pp-table">
                <thead><tr><th>Date</th><th>Counterparty</th><th>Asset</th></tr></thead>
                <tbody>${trades.slice(0, 5).map(tradeRow).join('')}</tbody>
            </table>
        </div>
        ${trades.length > 5 ? `
        <details class="pp-recap-ids">
            <summary>${trades.length - 5} more trades</summary>
            <div class="pm-table-wrap pp-scroll" style="margin-top:8px">
                <table class="pm-table pp-table"><tbody>${trades.slice(5).map(tradeRow).join('')}</tbody></table>
            </div>
        </details>` : ''}` : '';

    const atsTiles = ats ? [
        tile(`${ats.wins}-${ats.losses}${ats.pushes ? `-${ats.pushes}` : ''}`, 'Overall ATS record'),
        ats.home ? tile(`${ats.home.wins}-${ats.home.losses}`, 'Home ATS') : '',
        ats.away ? tile(`${ats.away.wins}-${ats.away.losses}`, 'Away ATS') : '',
        ats.favorite ? tile(`${ats.favorite.wins}-${ats.favorite.losses}`, 'ATS as favorite') : '',
        ats.underdog ? tile(`${ats.underdog.wins}-${ats.underdog.losses}`, 'ATS as underdog') : '',
    ].filter(Boolean).join('') : '';
    const atsHtml = atsTiles ? `<span class="mc-kicker" style="margin-top:16px">Against the spread record (ESPN)</span><div class="pm-tiles pp-tiles">${atsTiles}</div>` : '';

    const draftRow = p => `<tr><td>${p.season ?? '—'}</td><td>${p.round ?? '—'}</td><td>${p.pick ?? '—'}</td><td>${esc(p.name)}</td><td>${esc(p.pos || '—')}</td><td>${p.college ? esc(p.college) : '—'}</td><td>${p.careerAV ?? '—'}</td></tr>`;
    const draftHtml = draftHistory?.length ? `
        <span class="mc-kicker" style="margin-top:16px">Team's historical NFL draft</span>
        <div class="pm-table-wrap pp-scroll">
            <table class="pm-table pp-table">
                <thead><tr><th>Year</th><th>Round</th><th>Pick</th><th>Name</th><th>Pos</th><th>College</th><th>Career AV</th></tr></thead>
                <tbody>${draftHistory.slice(0, 8).map(draftRow).join('')}</tbody>
            </table>
        </div>
        ${draftHistory.length > 8 ? `
        <details class="pp-recap-ids">
            <summary>${draftHistory.length - 8} more historical picks</summary>
            <div class="pm-table-wrap pp-scroll" style="margin-top:8px">
                <table class="pm-table pp-table"><tbody>${draftHistory.slice(8).map(draftRow).join('')}</tbody></table>
            </div>
        </details>` : ''}` : '';

    const historyHtml = history?.length ? `
        <span class="mc-kicker" style="margin-top:16px">Franchise history (ESPN)</span>
        <ul class="pp-awards-list">${history.slice(0, 10).map(h => `<li>${esc(h.displayName || h.name || JSON.stringify(h))}</li>`).join('')}</ul>` : '';

    if (!tradesHtml && !atsHtml && !draftHtml && !historyHtml) return '';
    return `
    <section class="pm-block pp-block">
        <span class="mc-kicker">Franchise · ${abbr}</span>
        ${tradesHtml}${atsHtml}${draftHtml}${historyHtml}
        <p class="pm-note">Trades and historical draft from nflverse (Pro Football Reference); ATS and franchise history from live ESPN.</p>
    </section>`;
}

// ─── Comuni ──────────────────────────────────────────────────────

function footnote() {
    return `<p class="dg-footnote">Sources: Sleeper (player stats from ${FIRST_STATS_YEAR}, bio, Rotowire projections) and nfldata.org (schedules and scores). Team stats derived from regular-season-only weekly data; fantasy points in Topina League scoring where indicated.</p>`;
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
