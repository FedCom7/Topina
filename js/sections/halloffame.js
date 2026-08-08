/**
 * Hall of Fame — le leggende della Topina League.
 * Un giocatore è eleggibile 2 anni pieni dopo l'ultima apparizione nei dati
 * (classe X → ritirati entro X-3), con almeno 3 stagioni in lega, DEF escluse.
 * Ballottaggio cumulativo: chi non viene eletto resta candidato negli anni
 * successivi. Criterio: punti fantasy totali carriera come voce principale,
 * più bonus per anelli SB, stagioni da Top 1 di ruolo e selezioni All-Pro
 * (1° e 2° team). Un eletto all'anno.
 */

import { CURRENT_SEASON } from '../data.js?v=33';
import { electHallOfFame, FIRST_CLASS_YEAR, MIN_SEASONS } from '../data/hall-of-fame.js?v=65';
import { playerImageService } from '../services/player-image-service.js?v=15';
import { paniniCard, initPlayerModal } from '../components/player-modal.js?v=87';
import { resolveSleeperId, getPlayerInfo } from '../data/player-full.js?v=74';

let initialized = false;

export function initHallOfFame() {
    if (initialized) return;
    initialized = true;
    initPlayerModal(); // il click su una carta apre la scheda giocatore
    load();
}

async function load() {
    const wrap = document.getElementById('hof-content');
    if (!wrap) return;
    wrap.innerHTML = `<div class="loading-state"><div class="spinner"></div><p>Counting the ballots...</p></div>`;

    try {
        const classes = await electHallOfFame();
        const inductees = classes.filter(cl => cl.inductee).map(cl => ({ career: cl.inductee, year: cl.year }));

        // anagrafica Sleeper (data/altezza/peso) per la bolla — pochi eletti,
        // fetch in parallelo; se non risolve la bolla mostra solo le stagioni
        await Promise.all(inductees.map(async (it) => {
            try {
                const seasons = [...it.career.seasons].sort().reverse();
                const id = await resolveSleeperId(it.career.name, it.career.position, seasons);
                it.info = id ? await getPlayerInfo(id).catch(() => null) : null;
            } catch { it.info = null; }
        }));

        render(wrap, inductees);
    } catch (e) {
        console.error('Hall of Fame error:', e);
        wrap.innerHTML = `<div class="empty-state"><p class="empty-state-text">Error loading: ${e.message}</p></div>`;
    }
}

/* ============================================================
   RENDER — figurine Panini (stesso stile della scheda giocatore)
   ============================================================ */

function render(wrap, inductees) {
    if (!inductees.length) {
        wrap.innerHTML = `<div class="empty-state"><p class="empty-state-text">No player inducted yet</p></div>`;
        return;
    }

    wrap.innerHTML = `
    <div class="hof-grid">
        ${inductees.map(({ career: c, year, info }, i) => `
        <div class="hof-card-wrap" style="--card-i:${i}">
            <div class="hof-card-click" role="button" tabindex="0" aria-label="${c.name} — open the card"
                 data-player-modal data-player-name="${c.name}" data-pos="${c.position || ''}"
                 data-nfl="${c.nflTeam || ''}" data-year="${c.lastSeason || CURRENT_SEASON}">
                ${paniniCard({ name: c.name, pos: c.position, nfl: c.nflTeam, info, career: c, hofYear: year })}
            </div>
            <div class="hof-caption">
                <span class="hof-caption-name">${c.name}</span>
                <span class="hof-caption-class">Class of ${year}</span>
            </div>
        </div>`).join('')}
    </div>
    <p class="hof-footnote">Eligibility: 2 years after retirement, minimum ${MIN_SEASONS} seasons in the league. One inductee per year since ${FIRST_CLASS_YEAR}; candidates not elected stay on the ballot. Click a card to open the profile.</p>`;

    hydrateImages(wrap);
}

function hydrateImages(wrap) {
    wrap.querySelectorAll('.pm-headshot').forEach(async (img) => {
        const name = img.dataset.playerName;
        if (!name) return;
        img.onerror = () => {
            if (!img.src.endsWith('images/fallback-player.svg')) img.src = 'images/fallback-player.svg';
        };
        try {
            const url = await playerImageService.getPlayerImageUrl(name, img.dataset.team, img.dataset.pos, CURRENT_SEASON);
            if (url) img.src = url;
        } catch (e) {
            /* fallback già impostato */
        }
    });
}
