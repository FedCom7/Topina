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

import { getFullPlayer, FIRST_STATS_YEAR } from '../data/player-full.js?v=3';
import { computeSeasonMetrics, computeEfficiency, snapSharePct } from '../data/player-metrics.js?v=1';
import { getTeamContext } from '../data/nfl-team-stats.js?v=1';
import { getCareer, getPlayerAwards } from '../data/careers.js?v=3';
import { topinaBlock, awardsBlock } from '../components/player-modal.js?v=8';
import { getSeasonProjections, matchProjection } from '../data/projections.js?v=5';
import { playerImageService } from '../services/player-image-service.js?v=4';
import { canonAbbr } from '../data/nfl-schedule.js?v=1';
import { CURRENT_SEASON } from '../data.js?v=5';

const POS_LIST = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];
const fmt0 = (n) => n == null ? '—' : Math.round(n).toLocaleString('it-IT');
const fmt1 = (n) => n == null ? '—' : (+n).toLocaleString('it-IT', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const teamLogo = (abbr) => `https://a.espncdn.com/i/teamlogos/nfl/500/${(abbr || '').toLowerCase()}.png`;
const ord = (n) => n == null ? '' : `${n}ª`;

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
        section.innerHTML = `<div class="section-inner"><div class="empty-state"><div class="empty-state-icon">🔍</div><p class="empty-state-text">Giocatore non trovato</p></div></div>`;
        return;
    }

    section.innerHTML = `<div class="section-inner"><div class="loading-state"><div class="spinner"></div><p>Caricamento di tutte le statistiche di ${esc(name)}...</p></div></div>`;

    try {
        const [careerRes, awardsRes] = await Promise.allSettled([getCareer(name), getPlayerAwards(name)]);
        if (location.hash !== myHash) return;
        const career = careerRes.status === 'fulfilled' ? careerRes.value : null;
        const awards = awardsRes.status === 'fulfilled' ? awardsRes.value : { awards: [], allProFirst: [], allProSecond: [] };
        const topinaSeasons = career ? [...career.seasons] : [];

        const [fullRes, projRes] = await Promise.allSettled([
            getFullPlayer({ name, pos, year, topinaSeasons }),
            +year >= 2018 ? getSeasonProjections(year) : Promise.reject(new Error('no proj')),
        ]);
        if (location.hash !== myHash) return;
        const full = fullRes.status === 'fulfilled' ? fullRes.value : { playerId: null, info: null, seasons: [], resolved: false };
        const projEntry = projRes.status === 'fulfilled' ? matchProjection(projRes.value, name, pos) : null;

        const abbr = canonAbbr(full.info?.team || full.seasons[0]?.totals?.team || full.seasons[0]?.weekly?.at(-1)?.team || projEntry?.team || '');
        const ctx = abbr ? await getTeamContext(abbr, year).catch(() => null) : null;
        if (location.hash !== myHash) return;

        if (pos === 'DEF') renderDefPage(section, { name, year, pos, abbr, full, career, awards, ctx });
        else renderPlayerPage(section, { name, year, pos, abbr, full, career, awards, projEntry, ctx });
    } catch (e) {
        console.error('[player-page]', e);
        if (location.hash !== myHash) return;
        section.innerHTML = `<div class="section-inner"><div class="empty-state"><div class="empty-state-icon">📡</div><p class="empty-state-text">Errore nel caricamento delle statistiche</p></div></div>`;
    }
}

// ─── Pagina giocatore ────────────────────────────────────────────

function renderPlayerPage(section, ctx) {
    const { name, year, pos, abbr, full, career, awards, projEntry } = ctx;
    const info = full.info;
    const seasons = full.seasons; // dalla più recente

    section.innerHTML = `
    <div class="section-inner gb-page pp-page">
        <a class="gb-back" href="#" data-pp-back><span aria-hidden="true">←</span> Indietro</a>
        ${heroBlock(ctx)}
        ${full.resolved && seasons.length ? '' : noStatsBlock(full, projEntry, year)}
        ${projLine(projEntry, year)}
        ${infoBlocks(info, abbr)}
        ${metricsBlock(seasons, pos)}
        ${categoryTables(seasons, pos)}
        ${gamelogBlock(seasons, pos)}
        ${teamContextBlock(ctx)}
        ${matchupBlock(ctx)}
        ${topinaBlock(career)}
        ${awardsBlock(career, awards)}
        ${footnote()}
    </div>`;

    bindBack(section);
    hydrateHero(section, name, abbr, pos, year);
}

function heroBlock({ name, pos, abbr, full, career, year }) {
    const info = full.info;
    const chips = [
        pos ? `<span class="allpro-pos pos-${pos.toLowerCase()}">${pos}</span>` : '',
        abbr ? `<span class="pm-chip"><img class="pp-chip-logo" src="${teamLogo(abbr)}" alt="" onerror="this.style.display='none'">${abbr}</span>` : '',
        info?.age ? `<span class="pm-chip">${info.age} anni</span>` : '',
        info?.college ? `<span class="pm-chip">${esc(info.college)}</span>` : '',
        career?.seasons.size ? `<span class="pm-chip">${career.seasons.size} stagion${career.seasons.size === 1 ? 'e' : 'i'} Topina</span>` : '',
        info?.injury_status ? `<span class="pm-chip pp-chip-injury">🩹 ${esc(info.injury_status)}</span>` : '',
    ].filter(Boolean).join('');

    return `
    <header class="mosaic-card mc-wide dgt-hero pp-hero mc-in">
        <img class="pp-headshot" src="images/fallback-player.svg" alt="${esc(name)}">
        <div class="dgt-hero-info">
            <span class="mc-kicker">Scheda completa · Draft ${year}</span>
            <h1 class="mc-title">${esc(name)}</h1>
            <div class="pm-chips pp-hero-chips">${chips}</div>
        </div>
        ${career?.sbWins ? `<div class="pm-rings" title="Anelli Super Bowl">🏆${career.sbWins > 1 ? `×${career.sbWins}` : ''}</div>` : ''}
    </header>`;
}

function noStatsBlock(full, projEntry, year) {
    const msg = !full.resolved
        ? 'Statistiche NFL dettagliate non disponibili per questo giocatore (nessuna corrispondenza su Sleeper).'
        : 'Nessuna partita NFL registrata: statistiche disponibili dal 2015 in poi.';
    return `<section class="pm-block pp-block"><p class="pm-empty">${msg}</p></section>`;
}

function projLine(projEntry, year) {
    if (!projEntry || (projEntry.projPts == null && projEntry.adp == null)) return '';
    const bits = [];
    if (projEntry.projPts != null) bits.push(`${fmt0(projEntry.projPts)} pt lega proiettati`);
    else if (projEntry.ptsStd != null) bits.push(`${fmt0(projEntry.ptsStd)} pt std proiettati`);
    if (projEntry.adp != null) bits.push(`ADP ${fmt1(projEntry.adp)}`);
    return `<p class="pp-projline">Proiezione preseason ${year}: ${bits.join(' · ')}</p>`;
}

// ─── Anagrafica, ruolo, ID esterni ───────────────────────────────

function infoBlocks(info, abbr) {
    if (!info) return '';
    return anagraficaBlock(info) + ruoloBlock(info, abbr) + idsBlock(info);
}

function tile(value, label) {
    return value == null || value === '' ? ''
        : `<div class="pm-tile pp-tile"><span class="pm-tile-value">${value}</span><span class="pm-tile-label">${label}</span></div>`;
}

function anagraficaBlock(info) {
    const hIn = parseFloat(info.height);
    const wLb = parseFloat(info.weight);
    const height = hIn ? `${Math.floor(hIn / 12)}'${Math.round(hIn % 12)}" · ${Math.round(hIn * 2.54)} cm` : null;
    const weight = wLb ? `${Math.round(wLb)} lbs · ${Math.round(wLb * 0.4536)} kg` : null;
    const born = info.birth_date ? new Date(info.birth_date).toLocaleDateString('it-IT') : null;
    const rookie = info.metadata?.rookie_year || null;

    const tiles = [
        tile(info.age, 'Età'), tile(born, 'Data di nascita'),
        tile(info.birth_country ? esc(info.birth_country) : null, 'Paese'),
        tile(info.college ? esc(info.college) : null, 'College'),
        tile(height, 'Altezza'), tile(weight, 'Peso'),
        tile(info.number != null ? `#${info.number}` : null, 'Maglia'),
        tile(info.years_exp != null ? `${info.years_exp}` : null, 'Anni esperienza'),
        tile(rookie, 'Anno rookie'),
        tile(info.status ? esc(info.status) : null, 'Status'),
    ].join('');
    if (!tiles) return '';

    const injury = info.injury_status ? `
        <div class="pp-injury">
            <span class="pp-injury-title">🩹 Infermeria (stato attuale)</span>
            <span>${esc(info.injury_status)}${info.injury_body_part ? ` — ${esc(info.injury_body_part)}` : ''}${info.injury_notes ? ` · ${esc(info.injury_notes)}` : ''}${info.injury_start_date ? ` · dal ${new Date(info.injury_start_date).toLocaleDateString('it-IT')}` : ''}</span>
        </div>` : '';

    return `
    <section class="pm-block pp-block">
        <span class="mc-kicker">Anagrafica</span>
        <div class="pm-tiles pp-tiles">${tiles}</div>
        ${injury}
    </section>`;
}

function ruoloBlock(info, abbr) {
    const depth = info.depth_chart_position
        ? `${esc(info.depth_chart_position)}${info.depth_chart_order ?? ''}` : null;
    const tiles = [
        tile(abbr || null, 'Team NFL'),
        tile(info.position ? esc(info.position) : null, 'Posizione'),
        tile(info.fantasy_positions?.length ? info.fantasy_positions.map(esc).join(' · ') : null, 'Posizioni fantasy'),
        tile(depth, 'Depth chart'),
        tile(info.practice_participation ? esc(info.practice_participation) : null, 'Practice'),
    ].join('');
    if (!tiles) return '';
    return `
    <section class="pm-block pp-block">
        <span class="mc-kicker">Squadra e ruolo</span>
        <div class="pm-tiles pp-tiles">${tiles}</div>
    </section>`;
}

function idsBlock(info) {
    const ids = [
        info.espn_id ? `<a class="pp-id" href="https://www.espn.com/nfl/player/_/id/${info.espn_id}" target="_blank" rel="noopener">ESPN ${info.espn_id}</a>` : '',
        info.yahoo_id ? `<span class="pp-id">Yahoo ${info.yahoo_id}</span>` : '',
        info.sportradar_id ? `<span class="pp-id">Sportradar ${esc(info.sportradar_id)}</span>` : '',
        info.rotowire_id ? `<span class="pp-id">Rotowire ${info.rotowire_id}</span>` : '',
        info.rotoworld_id ? `<span class="pp-id">Rotoworld ${info.rotoworld_id}</span>` : '',
        info.fantasy_data_id ? `<span class="pp-id">FantasyData ${info.fantasy_data_id}</span>` : '',
        info.stats_id ? `<span class="pp-id">Stats ${info.stats_id}</span>` : '',
        info.player_id ? `<span class="pp-id">Sleeper ${esc(info.player_id)}</span>` : '',
    ].filter(Boolean).join('');
    if (!ids) return '';
    return `
    <section class="pm-block pp-block">
        <span class="mc-kicker">ID esterni</span>
        <div class="pp-ids">${ids}</div>
    </section>`;
}

// ─── Metriche avanzate ───────────────────────────────────────────

function trendChip(trend) {
    if (!trend) return null;
    const icon = trend.label === 'up' ? '↗' : trend.label === 'down' ? '↘' : '→';
    const word = trend.label === 'up' ? 'in crescita' : trend.label === 'down' ? 'in calo' : 'stabile';
    return `${icon} ${word} (${trend.slope > 0 ? '+' : ''}${fmt1(trend.slope)} pt/sett.)`;
}

function metricsBlock(seasons, pos) {
    const latest = seasons.find(s => s.weekly.length >= 2);
    if (!latest) return '';
    const m = computeSeasonMetrics(latest.weekly);
    if (!m) return '';
    const eff = computeEfficiency(latest.totals?.stats, pos, latest.totals?.pts);

    const tiles = [
        tile(fmt1(m.media), 'Media pt/gara'), tile(fmt1(m.mediana), 'Mediana'),
        tile(fmt1(m.devStd), 'Dev. standard'), tile(m.cv != null ? fmt1(m.cv * 100) + '%' : null, 'Coeff. variazione'),
        tile(m.consistency != null ? fmt0(m.consistency * 100) + '%' : null, 'Consistenza'),
        tile(m.boomPct != null ? m.boomPct + '%' : null, 'Boom (≥150% media)'),
        tile(m.bustPct != null ? m.bustPct + '%' : null, 'Bust (≤50% media)'),
        tile(fmt1(m.ceiling), 'Ceiling'), tile(fmt1(m.floor), 'Floor'),
        tile(fmt1(m.last3Avg), 'Ultime 3'), tile(fmt1(m.last5Avg), 'Ultime 5'),
        tile(trendChip(m.trend), 'Trend stagionale'),
        tile(fmt1(m.homeAvg), 'Media in casa'), tile(fmt1(m.awayAvg), 'Media in trasferta'),
        tile(eff?.ydsPerTouch != null ? fmt1(eff.ydsPerTouch) : null, 'Yard per tocco'),
        tile(eff?.tdPerTouch != null ? fmt1(eff.tdPerTouch * 100) + '%' : null, 'TD per tocco'),
        tile(eff?.fpPerTouch != null ? fmt1(eff.fpPerTouch) : null, 'FP per tocco'),
        tile(eff?.fpPerTarget != null ? fmt1(eff.fpPerTarget) : null, 'FP per target'),
        tile(eff?.catchPct != null ? eff.catchPct + '%' : null, 'Catch %'),
        tile(eff?.ydsPerAtt != null ? fmt1(eff.ydsPerAtt) : null, 'Yard per lancio'),
    ].join('');

    // tabellina carriera: una riga di metriche per ogni stagione con game log
    const rows = seasons.filter(s => s.weekly.length >= 2).map(s => {
        const sm = computeSeasonMetrics(s.weekly);
        if (!sm) return '';
        return `<tr><td>${s.year}</td><td>${fmt0(sm.gp)}</td><td class="pm-td-strong">${fmt1(sm.media)}</td><td>${fmt1(sm.mediana)}</td><td>${sm.boomPct ?? '—'}%</td><td>${sm.bustPct ?? '—'}%</td><td>${sm.consistency != null ? fmt0(sm.consistency * 100) + '%' : '—'}</td><td>${fmt1(sm.ceiling)}</td><td>${fmt1(sm.floor)}</td></tr>`;
    }).filter(Boolean).join('');

    return `
    <section class="pm-block pp-block">
        <span class="mc-kicker">Metriche avanzate · stagione ${latest.year}</span>
        <div class="pm-tiles pp-tiles">${tiles}</div>
        ${rows ? `
        <div class="pm-table-wrap pp-scroll">
            <table class="pm-table pp-table">
                <thead><tr><th>Anno</th><th>GP</th><th>Media</th><th>Mediana</th><th>Boom</th><th>Bust</th><th>Consist.</th><th>Ceiling</th><th>Floor</th></tr></thead>
                <tbody>${rows}</tbody>
            </table>
        </div>` : ''}
        <p class="pm-note">Punti nello scoring della lega. Boom/bust relativi alla media personale della stagione.</p>
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
    },
    {
        title: 'Corsa', has: s => (s.rush_att || 0) > 0,
        head: ['Att', 'Yard', 'Media', 'TD', 'Lunga', '1st down', 'RZ att', 'YAC'],
        cells: s => [
            g0(s, 'rush_att'), g0(s, 'rush_yd'), g1(s, 'rush_ypa'), g0(s, 'rush_td'),
            g0(s, 'rush_lng'), g0(s, 'rush_fd'), g0(s, 'rush_rz_att'), g0(s, 'rush_yac')],
    },
    {
        title: 'Ricezione', has: s => (s.rec_tgt || 0) > 0 || (s.rec || 0) > 0,
        head: ['Target', 'Rec', 'Yard', 'Media', 'TD', 'Lunga', 'Air yd', 'YAC', '1st down', 'RZ tgt', 'Drop'],
        cells: s => [
            g0(s, 'rec_tgt'), g0(s, 'rec'), g0(s, 'rec_yd'), g1(s, 'rec_ypr'), g0(s, 'rec_td'),
            g0(s, 'rec_lng'), g0(s, 'rec_air_yd'), g0(s, 'rec_yar'), g0(s, 'rec_fd'),
            g0(s, 'rec_rz_tgt'), g0(s, 'rec_drop')],
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
    },
    {
        title: 'Difesa individuale (IDP)', has: s => (s.idp_tkl || 0) > 0 || (s.idp_sack || 0) > 0,
        head: ['Tackle', 'Solo', 'Sack', 'INT', 'FF', 'Fum rec', 'Pass dif.', 'QB hit', 'TFL', 'TD', 'Safety'],
        cells: s => [
            g0(s, 'idp_tkl'), g0(s, 'idp_tkl_solo'), g1(s, 'idp_sack'), g0(s, 'idp_int'),
            g0(s, 'idp_ff'), g0(s, 'idp_fum_rec'), g0(s, 'idp_pass_def'), g0(s, 'idp_qb_hit'),
            g0(s, 'idp_tkl_loss'), g0(s, 'idp_def_td'), g0(s, 'idp_safe')],
    },
    {
        title: 'Ritorni', has: s => (s.kr || 0) > 0 || (s.pr || 0) > 0,
        head: ['Kick ret', 'Yard KR', 'Punt ret', 'Yard PR', 'TD ritorno'],
        cells: s => [g0(s, 'kr'), g0(s, 'kr_yd'), g0(s, 'pr'), g0(s, 'pr_yd'),
            fmt0((s.kr_td || 0) + (s.pr_td || 0) || (s.st_td ?? null))],
    },
];

function categoryTables(seasons, pos) {
    if (!seasons.length) return '';
    const blocks = CATEGORIES.map(cat => {
        const rows = seasons.filter(s => s.totals?.stats && cat.has(s.totals.stats));
        if (!rows.length) return '';
        const body = rows.map(s => `<tr><td>${s.year}</td>${cat.cells(s.totals.stats).map(c => `<td>${c}</td>`).join('')}</tr>`).join('');
        return `
        <div class="pp-cat">
            <h3 class="pp-cat-title">${cat.title}</h3>
            <div class="pm-table-wrap pp-scroll">
                <table class="pm-table pp-table">
                    <thead><tr><th>Anno</th>${cat.head.map(h => `<th>${h}</th>`).join('')}</tr></thead>
                    <tbody>${body}</tbody>
                </table>
            </div>
        </div>`;
    }).filter(Boolean).join('');

    // tabella fantasy sempre presente se ci sono totali
    const fRows = seasons.filter(s => s.totals?.stats).map(s => {
        const st = s.totals.stats;
        const snaps = st.off_snp && st.tm_off_snp ? fmt0(st.off_snp / st.tm_off_snp * 100) + '%' : '—';
        return `<tr><td>${s.year}</td><td>${g0(st, 'gp')}</td><td class="pm-td-strong">${s.totals.pts != null ? fmt1(s.totals.pts) : '—'}</td><td>${g1(st, 'pts_std')}</td><td>${g1(st, 'pts_half_ppr')}</td><td>${g1(st, 'pts_ppr')}</td><td>${s.totals.posRank ? `${pos}${s.totals.posRank}` : '—'}</td><td>${snaps}</td></tr>`;
    }).join('');
    const fantasy = fRows ? `
        <div class="pp-cat">
            <h3 class="pp-cat-title">Fantasy</h3>
            <div class="pm-table-wrap pp-scroll">
                <table class="pm-table pp-table">
                    <thead><tr><th>Anno</th><th>GP</th><th>Pt lega</th><th>Std</th><th>Half</th><th>PPR</th><th>Rank</th><th>Snap %</th></tr></thead>
                    <tbody>${fRows}</tbody>
                </table>
            </div>
        </div>` : '';

    if (!blocks && !fantasy) return '';
    return `
    <section class="pm-block pp-block">
        <span class="mc-kicker">Carriera NFL per categoria</span>
        ${fantasy}${blocks}
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
        head: ['Att', 'Yd corsa', 'TD', 'Rec', 'Yd rec'],
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
                <td class="pp-opp">${g.opponent ? `${g.isAway ? '@ ' : ''}<img class="pp-opp-logo" src="${teamLogo(g.opponent)}" alt="" onerror="this.style.display='none'">${g.opponent}` : '—'}</td>
                ${cols.cells(g.stats).map(c => `<td>${c}</td>`).join('')}
                <td>${snap != null ? snap + '%' : '—'}</td>
                <td class="pm-td-strong">${g.pts != null ? fmt1(g.pts) : '—'}</td>
                <td>${g.stats.pts_half_ppr != null ? fmt1(g.stats.pts_half_ppr) : '—'}</td>
            </tr>`;
        }).join('');
        return `
        <details class="pp-gamelog"${i === 0 ? ' open' : ''}>
            <summary>Stagione ${s.year} <span class="pp-gamelog-meta">${s.weekly.length} partite${s.totals?.pts != null ? ` · ${fmt1(s.totals.pts)} pt lega` : ''}</span></summary>
            <div class="pm-table-wrap pp-scroll">
                <table class="pm-table pp-table">
                    <thead><tr><th>Sett.</th><th>Avv.</th>${cols.head.map(h => `<th>${h}</th>`).join('')}<th>Snap</th><th>Pt lega</th><th>Half</th></tr></thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>
        </details>`;
    }).join('');

    return `
    <section class="pm-block pp-block">
        <span class="mc-kicker">Game log · tutte le stagioni</span>
        ${details}
    </section>`;
}

// ─── Contesto squadra e matchup ──────────────────────────────────

function rankBadge(rank) {
    if (rank == null) return '';
    const cls = rank <= 10 ? 'pp-rank--good' : rank >= 23 ? 'pp-rank--bad' : '';
    return ` <span class="pp-rank ${cls}">${ord(rank)}</span>`;
}

function teamContextBlock({ ctx, abbr, pos }) {
    if (!ctx?.team?.offense) return '';
    const o = ctx.team.offense, r = ctx.team.ranks?.offense || {};
    const rec = ctx.team.record;
    const tiles = [
        tile(`${rec.w}-${rec.l}${rec.t ? '-' + rec.t : ''}`, 'Record'),
        tile(fmt1(o.ppg) + rankBadge(r.ppg), 'Punti/gara'),
        tile(fmt1(o.totYdsPg) + rankBadge(r.totYdsPg), 'Yard totali/gara'),
        tile(fmt1(o.passYdsPg) + rankBadge(r.passYdsPg), 'Yard lancio/gara'),
        tile(fmt1(o.rushYdsPg) + rankBadge(r.rushYdsPg), 'Yard corsa/gara'),
        tile(fmt1(o.ydsPerPlay) + rankBadge(r.ydsPerPlay), 'Yard/gioco'),
        tile(fmt1(o.playsPg) + rankBadge(r.playsPg), 'Giocate/gara (pace)'),
        tile(o.passRate != null ? fmt0(o.passRate * 100) + '%' : null, '% giochi su lancio'),
        tile(fmt1(o.rzPlaysPg) + rankBadge(r.rzPlaysPg), 'Giocate red zone/gara'),
        tile(fmt0(o.turnovers) + rankBadge(r.turnovers), 'Palloni persi'),
        tile(fmt0(o.sacksAllowed) + rankBadge(r.sacksAllowed), 'Sack concessi'),
        tile(fmt0(o.passTd) + rankBadge(r.passTd), 'TD su lancio'),
        tile(fmt0(o.rushTd) + rankBadge(r.rushTd), 'TD su corsa'),
    ].join('');

    return `
    <section class="pm-block pp-block">
        <span class="mc-kicker">Contesto squadra · ${abbr} ${ctx.season}${ctx.fallback ? ' (stagione più recente disponibile)' : ''}</span>
        <div class="pm-tiles pp-tiles">${tiles}</div>
        <p class="pm-note">Rank su 32 squadre: verde = tra le prime 10, rosso = tra le ultime 10.</p>
    </section>`;
}

function matchupChip(rank) {
    if (rank == null) return '—';
    const cls = rank <= 10 ? 'pp-mu--easy' : rank >= 23 ? 'pp-mu--hard' : 'pp-mu--mid';
    const label = rank <= 10 ? 'morbida' : rank >= 23 ? 'dura' : 'media';
    return `<span class="pp-mu ${cls}">${ord(rank)} · ${label}</span>`;
}

function matchupBlock({ ctx, pos, abbr }) {
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
        ? '<th>PPG attacco</th><th>Yard/gara</th><th>Palloni persi</th>'
        : `<th>FPA ${P}/gara</th><th>Matchup</th><th>Pt subiti/gara</th>`;

    const sosVal = ctx.sos?.[P];
    const sosLine = sosVal != null
        ? `<p class="pp-sos">Strength of schedule vs ${P}: rank FPA medio degli avversari <b>${fmt1(sosVal)}</b> — ${sosVal <= 13 ? 'calendario favorevole' : sosVal >= 20 ? 'calendario difficile' : 'calendario nella media'} (rank basso = difese che concedono di più).</p>`
        : '';

    return `
    <section class="pm-block pp-block">
        <span class="mc-kicker">Calendario e matchup · ${ctx.season}${ctx.fallback ? ' (stagione più recente disponibile)' : ''}</span>
        ${sosLine}
        <div class="pm-table-wrap pp-scroll">
            <table class="pm-table pp-table">
                <thead><tr><th>Sett.</th><th>Avversario</th><th>Risultato</th>${head}</tr></thead>
                <tbody>${rows}</tbody>
            </table>
        </div>
        <p class="pm-note">${vsOffense
            ? 'Per una difesa il matchup dipende dall\'attacco avversario: PPG e yard con il rank offensivo (1ª = attacco migliore).'
            : `FPA = fantasy points concessi dalla difesa avversaria ai ${P} (scoring lega, per gara). Rank 1ª = concede di più = matchup morbido.`}</p>
    </section>`;
}

// ─── Pagina DEF ──────────────────────────────────────────────────

function renderDefPage(section, ctx) {
    const { name, year, abbr, full, career, awards } = ctx;

    section.innerHTML = `
    <div class="section-inner gb-page pp-page">
        <a class="gb-back" href="#" data-pp-back><span aria-hidden="true">←</span> Indietro</a>
        <header class="mosaic-card mc-wide dgt-hero pp-hero mc-in">
            <img class="pp-headshot pp-headshot--logo" src="${abbr ? teamLogo(abbr) : 'images/fallback-player.svg'}" alt="${esc(name)}">
            <div class="dgt-hero-info">
                <span class="mc-kicker">Difesa · Draft ${year}</span>
                <h1 class="mc-title">${esc(name)}</h1>
                <div class="pm-chips pp-hero-chips">
                    <span class="allpro-pos pos-def">DEF</span>
                    ${abbr ? `<span class="pm-chip">${abbr}</span>` : ''}
                    ${career?.seasons.size ? `<span class="pm-chip">${career.seasons.size} stagion${career.seasons.size === 1 ? 'e' : 'i'} Topina</span>` : ''}
                </div>
            </div>
            ${career?.sbWins ? `<div class="pm-rings" title="Anelli Super Bowl">🏆${career.sbWins > 1 ? `×${career.sbWins}` : ''}</div>` : ''}
        </header>
        ${defStatsBlock(ctx)}
        ${fpaBlock(ctx)}
        ${gamelogBlock(full.seasons, 'DEF')}
        ${matchupBlock(ctx)}
        ${topinaBlock(career)}
        ${awardsBlock(career, awards)}
        ${footnote()}
    </div>`;

    bindBack(section);
}

function defStatsBlock({ ctx, abbr }) {
    if (!ctx?.team?.defense) return '';
    const d = ctx.team.defense, r = ctx.team.ranks?.defense || {};
    const tiles = [
        tile(fmt1(d.papg) + rankBadge(r.papg), 'Punti subiti/gara'),
        tile(fmt1(d.totYdsAllowedPg) + rankBadge(r.totYdsAllowedPg), 'Yard concesse/gara'),
        tile(fmt1(d.passYdsAllowedPg) + rankBadge(r.passYdsAllowedPg), 'Yard lancio concesse'),
        tile(fmt1(d.rushYdsAllowedPg) + rankBadge(r.rushYdsAllowedPg), 'Yard corsa concesse'),
        tile(fmt0(d.sacks) + rankBadge(r.sacks), 'Sack'),
        tile(fmt0(d.interceptions) + rankBadge(r.interceptions), 'Intercetti'),
        tile(fmt0(d.fumblesForced) + rankBadge(r.fumblesForced), 'Fumble forzati'),
        tile(fmt0(d.fumbleRecoveries), 'Fumble recuperati'),
        tile(fmt0(d.takeaways) + rankBadge(r.takeaways), 'Turnover forzati'),
        tile(fmt0(d.defTds) + rankBadge(r.defTds), 'TD difensivi'),
        tile(fmt0(d.safeties), 'Safety'),
        tile(fmt0(d.passDefended) + rankBadge(r.passDefended), 'Passaggi difesi'),
        tile(fmt0(d.tacklesForLoss) + rankBadge(r.tacklesForLoss), 'Tackle for loss'),
        tile(fmt0(d.qbHits) + rankBadge(r.qbHits), 'QB hit'),
        tile(fmt0(d.blockedKicks), 'Kick bloccati'),
    ].join('');
    return `
    <section class="pm-block pp-block">
        <span class="mc-kicker">La difesa · ${abbr} ${ctx.season}${ctx.fallback ? ' (stagione più recente disponibile)' : ''}</span>
        <div class="pm-tiles pp-tiles">${tiles}</div>
        <p class="pm-note">Rank su 32 squadre: verde = tra le prime 10, rosso = tra le ultime 10.</p>
    </section>`;
}

function fpaBlock({ ctx }) {
    if (!ctx?.team?.fpa) return '';
    const rows = POS_LIST.filter(p => p !== 'DEF').map(p => {
        const f = ctx.team.fpa[p];
        if (!f || (f.pgLeague == null && f.pgHalf == null)) return '';
        return `<tr><td>${p}</td><td class="pm-td-strong">${fmt1(f.pgLeague ?? f.pgHalf)}</td><td>${fmt1(f.pgHalf)}</td><td>${matchupChip(f.rank)}</td></tr>`;
    }).filter(Boolean).join('');
    if (!rows) return '';
    return `
    <section class="pm-block pp-block">
        <span class="mc-kicker">Fantasy points concessi per ruolo</span>
        <div class="pm-table-wrap pp-scroll">
            <table class="pm-table pp-table">
                <thead><tr><th>Ruolo</th><th>FPA lega/gara</th><th>FPA half/gara</th><th>Rank</th></tr></thead>
                <tbody>${rows}</tbody>
            </table>
        </div>
        <p class="pm-note">Rank 1ª = la difesa che concede più punti fantasy a quel ruolo (matchup morbido per gli avversari).</p>
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
    const img = section.querySelector('.pp-headshot');
    if (!img) return;
    img.onerror = () => {
        if (!img.src.endsWith('fallback-player.svg')) img.src = 'images/fallback-player.svg';
    };
    playerImageService.getPlayerImageUrl(name, abbr, pos, year)
        .then(url => { if (url) img.src = url; })
        .catch(() => { /* resta il fallback */ });
}
