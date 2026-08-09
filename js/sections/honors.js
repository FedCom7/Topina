/**
 * Topina Honors — cerimonia premi di fine stagione.
 * Vincitori calcolati dai dati Firebase (js/data/honors.js).
 * Per la stagione in corso i vincitori restano nascosti fino alla
 * Super Bowl week: prima si mostrano solo i finalisti, come nella realtà.
 */

import { CURRENT_SEASON } from '../data.js?v=33';
import { getHonorsBundle, honorsSeasons } from '../data/honors.js?v=76';
import { TEAMS } from './team.js?v=92';

let initialized = false;
let currentYear = CURRENT_SEASON;

export function initHonors() {
    if (initialized) return;
    initialized = true;
    renderYearSelector();
    loadYear(currentYear);
}

function renderYearSelector() {
    const container = document.getElementById('hn-year-selector');
    if (!container) return;
    container.innerHTML = honorsSeasons().map(y =>
        `<button class="year-pill${y === currentYear ? ' active' : ''}" data-year="${y}">${y}</button>`
    ).join('');
    container.addEventListener('click', (e) => {
        const btn = e.target.closest('.year-pill');
        if (!btn) return;
        container.querySelectorAll('.year-pill').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        loadYear(btn.dataset.year);
    });
}

async function loadYear(year) {
    currentYear = year;
    const wrap = document.getElementById('honors-content');
    wrap.innerHTML = `<div class="loading-state"><div class="spinner"></div><p>Loading ${year} Honors...</p></div>`;

    const bundle = await getHonorsBundle(year);
    if (!bundle) {
        wrap.innerHTML = `<div class="empty-state"><p class="empty-state-text">No data for the ${year} season</p></div>`;
        return;
    }

    if (!bundle.rsComplete) {
        wrap.innerHTML = teaserHTML(year,
            'The race for the awards is still open',
            'Topina Honors are given out once the regular season ends, and are revealed on Super Bowl eve.');
        return;
    }

    wrap.innerHTML = `
        <div class="honors-stage">${bundle.awards.map((a, i) => awardCard(a, bundle.revealed, i)).join('')}</div>
        ${bundle.revealed ? '' : `<p class="honors-sealed-note">The envelopes open on the eve of the ${year} Super Bowl — for now, only the finalists.</p>`}
    `;
}

function teaserHTML(year, title, text) {
    return `
    <div class="honors-teaser">
        <h2 class="honors-teaser-title">${title}</h2>
        <p class="honors-teaser-text">${text}</p>
    </div>`;
}

// ─── Card premio ─────────────────────────────────────────────────

function entryName(award, entry) {
    if (!entry) return '—';
    return award.kind === 'coach' ? (TEAMS[entry.teamKey]?.name || entry.teamKey) : entry.name;
}

function entryTeam(award, entry) {
    if (!entry) return null;
    return TEAMS[entry.teamKey] || null;
}

function teamChip(team) {
    if (!team) return '';
    return `
        <span class="honors-team-chip" style="--team-color:${team.color}">
            <img src="${team.logo}" alt="" onerror="this.style.display='none'">
            ${team.name}
        </span>`;
}

function awardCard(award, revealed, i) {
    const isMvp = award.id === 'mvp';
    const winner = award.winner;
    const team = winner ? entryTeam(award, winner) : null;
    const color = team?.color || 'var(--accent-red)';

    // Finalisti: da svelati mostro 2° e 3°; da sigillati tutti in ordine alfabetico
    let finalists = award.finalists || [];
    if (revealed) {
        finalists = finalists.filter(f => f !== winner).slice(0, 2);
    } else {
        finalists = [...finalists].sort((a, b) =>
            entryName(award, a).localeCompare(entryName(award, b)));
    }

    const winnerBlock = revealed && winner ? `
        <div class="honors-winner">
            <span class="honors-winner-name">${entryName(award, winner)}</span>
            ${winner.pos && award.kind === 'player' ? `<span class="honors-winner-meta">${winner.pos}${winner.nfl ? ` · ${winner.nfl}` : ''}</span>` : ''}
            <span class="honors-winner-stat">${award.statLine(winner)}</span>
            ${teamChip(team)}
        </div>` : `
        <div class="honors-winner honors-winner--sealed">
            <span class="honors-winner-name">?</span>
            <span class="honors-winner-stat">Winner not yet revealed</span>
        </div>`;

    const finalistRows = finalists.map(f => `
        <li>
            <span class="honors-finalist-name">${entryName(award, f)}</span>
            <span class="honors-finalist-stat">${revealed ? award.statLine(f) : ''}</span>
        </li>`).join('');

    return `
    <article class="honors-card${isMvp ? ' honors-card--mvp' : ''}" style="--award-color:${revealed ? color : 'var(--accent-amber)'};--card-i:${i}">
        <header class="honors-card-head">
            <div>
                <h2 class="honors-card-title">${award.abbr ? `<span class="honors-card-abbr">${award.abbr}</span> ` : ''}${award.name}</h2>
                <p class="honors-card-desc">${award.desc}</p>
            </div>
        </header>
        ${winnerBlock}
        ${finalistRows ? `
        <div class="honors-finalists">
            <span class="honors-finalists-label">${revealed ? 'Finalists' : 'The candidates'}</span>
            <ul>${finalistRows}</ul>
        </div>` : ''}
    </article>`;
}
