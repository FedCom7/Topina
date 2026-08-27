/**
 * Draft Section
 * Year selector + Round filter → draft pick cards
 */
import { fetchDraftData, flattenDraft, displayName, SEASONS, CURRENT_SEASON } from '../data.js?v=540';
import { TEAM_KEYS } from '../data/team-config.js?v=533';
import { TEAMS } from './team.js?v=644';
import { playerImageService } from '../services/player-image-service.js?v=520';
import { initPlayerModal, paniniCard, hydratePaniniBadges } from '../components/player-modal.js?v=649';
import { db } from '../firebase-config.js?v=2';
import { fetchDraftStatus } from '../data/espn-fantasy.js?v=9';
import { pickDropdownHTML, bindPickDropdown } from '../ui/dropdown-pick.js?v=1';

let loaded = false;
let currentPicks = [];
let currentYear = null;
let currentRound = 'all';
let currentMode = 'order'; // 'order' | 'snake'

export async function initDraft() {
    if (loaded) return;
    loaded = true;
    initPlayerModal();
    currentYear = CURRENT_SEASON;
    renderPickRow();
    await loadYear(CURRENT_SEASON);
}

/**
 * Ordine di pesca vs vista a squadra: nel draft reale il giro pari va a
 * serpentina (l'ultimo che sceglie al giro 1 sceglie per primo al giro 2), e
 * quell'ordine grezzo è quello che mostra "order". "snake" lo riallinea per
 * colonna: i pick del giro pari vengono ribaltati così lo stesso team resta
 * sempre nella stessa colonna del grid, uno sotto l'altro giro dopo giro.
 */
function applySnakeOrder(picks) {
    const rounds = new Map();
    picks.forEach(p => {
        if (!rounds.has(p.round)) rounds.set(p.round, []);
        rounds.get(p.round).push(p);
    });
    const result = [];
    for (const [round, list] of rounds) {
        result.push(...(round % 2 === 0 ? list.slice().reverse() : list));
    }
    return result;
}

/** Riga con le capsule a scomparsa: round, modalità (order/team) e anno. */
function renderPickRow(maxRound) {
    const container = document.getElementById('dr-pick-row');
    if (!container) return;

    let roundHtml = '';
    if (maxRound) {
        const roundItems = [{ value: 'all', label: 'All' }];
        for (let r = 1; r <= maxRound; r++) roundItems.push({ value: String(r), label: `R${r}` });
        const roundIdx = roundItems.findIndex(it => it.value === String(currentRound));
        roundHtml = pickDropdownHTML('round', roundItems, roundIdx);
    }
    const modeItems = [{ value: 'order', label: 'Draft order' }, { value: 'snake', label: 'By team' }];
    const modeIdx = modeItems.findIndex(it => it.value === currentMode);
    const modeHtml = pickDropdownHTML('mode', modeItems, modeIdx);

    const yearItems = SEASONS.map(y => ({ value: y, label: y }));
    const yearIdx = SEASONS.indexOf(String(currentYear));

    container.innerHTML = roundHtml + modeHtml + pickDropdownHTML('year', yearItems, yearIdx);
    bindPickDropdown(container, (id, value) => {
        if (id === 'year') {
            loadYear(value);
        } else if (id === 'round') {
            currentRound = value;
            renderPickRow(maxRound);
            renderCards(currentRound);
        } else if (id === 'mode') {
            currentMode = value;
            renderCards(currentRound);
        }
    });
}

/**
 * Stato del draft quando i dati non ci sono ancora: in programma con il conto
 * alla rovescia, oppure non ancora fissato. ESPN espone la data solo quando il
 * commissioner la imposta, quindi il secondo caso è la norma per mesi.
 */
async function pendingDraftHTML(year) {
    let stato = null;
    try { stato = await fetchDraftStatus(year); } catch { /* si mostra il generico */ }

    if (stato?.date) {
        const mancano = stato.date - Date.now();
        const giorni = Math.floor(mancano / 86400000);
        const ore = Math.floor((mancano % 86400000) / 3600000);
        const quando = stato.date.toLocaleString('en-GB',
            { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
        return `
        <div class="live-nodraft">
            <p class="mc-kicker">Draft ${year}</p>
            <p class="live-nodraft-title">${mancano > 0
                ? `${giorni} days and ${ore} hours to go`
                : 'The draft is under way'}</p>
            <p class="live-nodraft-text">${quando}</p>
        </div>`;
    }
    return `
    <div class="live-nodraft">
        <p class="mc-kicker">Draft ${year}</p>
        <p class="live-nodraft-title">The draft has not been scheduled yet</p>
        <p class="live-nodraft-text">As soon as the commissioner sets a date the countdown
           will show up here. Once the draft is done the picks load on their own.</p>
    </div>`;
}

async function loadYear(year) {
    currentYear = year; // Update global
    currentRound = 'all';
    const grid = document.getElementById('draft-grid');
    grid.innerHTML = `<div class="loading-state"><div class="spinner"></div><p>Loading ${year} draft...</p></div>`;

    try {
        const data = await fetchDraftData(year);
        if (!data) {
            // Sulla stagione in corso si può dire qualcosa di più utile di "non
            // c'è": si chiede alla lega se il draft sia stato fatto e quando è
            // in programma. Sugli anni passati non ha senso e non si chiede.
            grid.innerHTML = String(year) === String(CURRENT_SEASON)
                ? await pendingDraftHTML(year)
                : `<div class="empty-state"><p class="empty-state-text">No draft for ${year}</p></div>`;
            renderPickRow();
            return;
        }

        currentPicks = flattenDraft(data);

        if (!currentPicks.length) {
            grid.innerHTML = `<div class="empty-state"><p class="empty-state-text">Draft data not available</p></div>`;
            renderPickRow();
            return;
        }

        const maxRound = Math.max(...currentPicks.map(p => p.round));
        renderPickRow(maxRound);
        renderCards('all');
    } catch (e) {
        console.error(`[Draft] Error loading year ${year}:`, e);
        grid.innerHTML = `<div class="error-state"><p>Error loading: ${e.message}</p></div>`;
    }
}

function renderCards(round) {
    const grid = document.getElementById('draft-grid');
    let picks = round === 'all' ? currentPicks : currentPicks.filter(p => p.round === parseInt(round));
    if (currentMode === 'snake') picks = applySnakeOrder(picks);

    grid.innerHTML = picks.map((p, i) => {
        const teamKey = TEAM_KEYS[displayName(p.team)] || null;
        const team = TEAMS[teamKey] || null;

        return `
        <div class="draft-fig" data-player-modal
             data-player-name="${p.player}" data-pos="${p.pos}" data-nfl="${p.nfl || ''}" data-year="${currentYear}"
             style="--team-color:${team?.color || 'var(--accent-red)'};animation-delay:${(i % 12) * 40}ms">
            <div class="draft-fig-card">
                <span class="draft-fig-pick">#${p.pick}</span>
                ${paniniCard({ name: p.player, pos: p.pos, nfl: p.nfl, compact: true })}
            </div>
            <div class="draft-fig-cap">
                <span class="draft-fig-label">Drafted by</span>
                <span class="draft-fig-team">
                    ${team ? `<img src="${team.logo}" alt="" onerror="this.style.display='none'">` : ''}
                    ${team?.name || displayName(p.team)}
                </span>
            </div>
        </div>`;
    }).join('');

    // Load images asynchronously
    updateDraftImages(currentYear);
    hydratePaniniBadges(grid);
}

/** Update src for all player headshots */
function updateDraftImages(year) {
    const images = document.querySelectorAll('.pm-headshot'); images.forEach(async (img) => {
        const name = img.dataset.playerName;
        const team = img.dataset.team;
        const pos = img.dataset.pos;

        // Setup error handler for 404s
        img.onerror = () => {
            if (img.src !== 'images/fallback-player.svg') {
                img.src = 'images/fallback-player.svg';
            }
        };

        if (name) {
            try {
                // Pass Team and Position to the service!
                // Pass YEAR to avoid searching current rosters for old players
                const url = await playerImageService.getPlayerImageUrl(name, team, pos, year);
                img.src = url;
            } catch (e) {
                console.warn('Failed to load image for', name);
                img.src = 'images/fallback-player.svg';
            }
        }
    });
}

