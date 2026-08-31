/**
 * Marker "giocatore su un campo NFL" — disco bianco, foto ritagliata,
 * jersey/nome/posizione in verde scuro sotto. Nato per il campo formazione
 * della pagina squadra NFL (`nfl-team-home.js`, verticale, depth chart) e
 * riusato dal campo All-Pro orizzontale della home (SB week,
 * `sections/home.js`): qui c'è solo il disegno del singolo giocatore a
 * coordinate SVG già proiettate — la geometria del campo (dove sta ogni
 * disco) la decide chi chiama. Le classi CSS sono le `nfl-fd-*` / `nfl-fd2-*`
 * già globali in css/main.css: stesso disegno, stesso posto, per non finire
 * con due campi che si assomigliano ma non sono identici.
 */

const _SUFFIX = new Set(['JR', 'JR.', 'SR', 'SR.', 'II', 'III', 'IV', 'V']);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** Cognome del giocatore per l'etichetta sotto il disco (nome completo troppo largo lì sotto). */
export function lastName(full) {
    const parts = (full || '').trim().split(/\s+/).filter(Boolean);
    while (parts.length > 1 && _SUFFIX.has(parts[parts.length - 1].toUpperCase())) parts.pop();
    return parts.length ? parts[parts.length - 1] : (full || '');
}

/**
 * `<defs>` col clip-path circolare per le foto. `clipId` è un id per
 * campo: se due campi finiscono nello stesso DOM (le sezioni della SPA
 * restano montate, solo nascoste — vedi app.js) un id fisso duplicherebbe
 * l'id e il secondo campo perderebbe il ritaglio.
 */
export function fieldClipDefs(clipId, r = 19) {
    return `<clipPath id="${clipId}" clipPathUnits="userSpaceOnUse"><circle r="${r}" cx="0" cy="0"/></clipPath>`;
}

/** Un giocatore (o slot vuoto) a coordinate SVG già proiettate (x,y). */
export function fieldMarker({ x, y, label, player, side, abbr, year, clipId, r = 19 }) {
    const name = player?.name || '';
    const jersey = player?.jersey;
    const hasPlayer = !!name;
    return `
    <g class="nfl-fd-slot nfl-fd-slot--${side}${hasPlayer ? '' : ' is-empty'}" transform="translate(${x.toFixed(1)},${y.toFixed(1)})" ${hasPlayer ? `data-player-name="${esc(name)}" data-team="${esc(abbr)}"` : ''}>
        <circle r="${r}" class="nfl-fd-disc"/>
        ${hasPlayer ? `<image class="nfl-fd-photo" data-headshot data-player-name="${esc(name)}" data-team="${esc(abbr)}" data-pos="${esc(label)}" data-year="${year}"
            href="images/fallback-player.svg" x="${-r}" y="${-r}" width="${r * 2}" height="${r * 2}"
            clip-path="url(#${clipId})" preserveAspectRatio="xMidYMid slice"><title>${esc(name)}${jersey != null ? ` · #${esc(String(jersey))}` : ''}</title></image>` : ''}
        ${hasPlayer ? `<text class="nfl-fd-jersey" y="${-(r + 4)}" text-anchor="middle">${jersey != null ? esc(String(jersey)) : ''}</text>` : ''}
        ${hasPlayer ? `<text class="nfl-fd-name" y="${r + 13}" text-anchor="middle">${esc(lastName(name))}</text>` : ''}
        <text class="nfl-fd-pos" y="${hasPlayer ? r + 24 : 5}" text-anchor="middle">${esc(label)}</text>
    </g>`;
}

/** Idrata le foto (elementi SVG &lt;image&gt;: si aggiorna l'attributo href, non .src). */
export function hydrateFieldPhotos(section, playerImageService) {
    section.querySelectorAll('.nfl-fd-photo[data-headshot]').forEach((img) => {
        img.addEventListener('error', () => {
            if (!img.getAttribute('href')?.endsWith('fallback-player.svg')) img.setAttribute('href', 'images/fallback-player.svg');
        });
        playerImageService.getPlayerImageUrl(img.dataset.playerName, img.dataset.team, img.dataset.pos, img.dataset.year)
            .then((url) => { if (url) img.setAttribute('href', url); })
            .catch(() => { });
    });
}

/**
 * Idrata i numeri di maglia rimasti vuoti (il chiamante non li conosceva al
 * momento di disegnare il marker — caso della home, che pesca da un giocatore
 * qualsiasi di lega senza depth chart già in mano). Il campo squadra NFL li
 * passa già pieni in `fieldMarker` e qui non trova niente da fare.
 */
export function hydrateFieldJerseys(section, playerImageService) {
    section.querySelectorAll('.nfl-fd-slot[data-player-name]').forEach((g) => {
        const t = g.querySelector('.nfl-fd-jersey');
        if (!t || t.textContent) return;
        const name = g.dataset.playerName, abbr = g.dataset.team;
        if (!name || !abbr) return;
        const year = g.querySelector('.nfl-fd-photo')?.dataset.year;
        playerImageService.getPlayerJersey(name, abbr, year)
            .then((jersey) => { if (jersey != null) t.textContent = String(jersey); })
            .catch(() => { });
    });
}
