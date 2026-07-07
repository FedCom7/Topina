/**
 * Sticker SVG — "helmet stickers" stile Michigan Wolverines.
 * Ovali adesivi nei colori del team, tutto vettoriale inline (nessun file).
 * Il colore arriva dal CSS via var(--team-color) (classi .stk-*),
 * così ogni parete di sticker si tinge automaticamente col colore del team.
 */

// Glifi (disegnati centrati su 32,32 dentro un'area ~26×26, sistema 64×64)
const ICONS = {
    trophy: '<path class="stk-glyph" d="M22 19 h20 v5 c0 7.5 -4.2 11.5 -10 11.5 s-10 -4 -10 -11.5 Z M29.5 36 h5 v5 h-5 Z M25 41.5 h14 v3.5 H25 Z"/>'
        + '<path class="stk-line" d="M22 22 h-4.5 v3 c0 4 2.5 6.5 6 7 M42 22 h4.5 v3 c0 4 -2.5 6.5 -6 7"/>',
    crown: '<path class="stk-glyph" d="M18 42 V25 L25.5 32 L32 20 L38.5 32 L46 25 V42 Z"/>',
    rings: '<circle class="stk-line" cx="25.5" cy="32" r="8.5"/><circle class="stk-line" cx="38.5" cy="32" r="8.5"/>',
    laurel: '<path class="stk-line" d="M22 18 C15 26 15 38 22 46 M42 18 C49 26 49 38 42 46"/>'
        + '<circle class="stk-glyph" cx="32" cy="32" r="4.5"/>',
    bolt: '<path class="stk-glyph" d="M35.5 14 L21.5 36 h9 L26 50 L43 28 h-9 L38 14 Z"/>',
    flame: '<path class="stk-glyph" d="M32 13 C37.5 21 44 26.5 44 35.5 A12 12 0 0 1 20 35.5 C20 27.5 27 22 32 13 Z"/>',
    streak: '<path class="stk-line" d="M17 42 L27 32 L33 38 L46 23"/><path class="stk-glyph" d="M47 21 h-9 l9 9 Z"/>',
    couch: '<path class="stk-glyph" d="M21 24 h22 v8 H21 Z M15 33 h34 v8 H15 Z M17 42 h4 v4 h-4 Z M43 42 h4 v4 h-4 Z"/>',
    hammer: '<path class="stk-glyph" d="M20 16 h24 v9 H20 Z M29 25 h6 v23 h-6 Z"/>',
    broom: '<path class="stk-line" d="M42 14 L31 34"/>'
        + '<path class="stk-glyph" d="M25 35 L35 35 L39 50 L19 50 Z"/>',
    target: '<circle class="stk-line" cx="32" cy="32" r="14"/><circle class="stk-line" cx="32" cy="32" r="7.5"/><circle class="stk-glyph" cx="32" cy="32" r="2.8"/>',
    rocket: '<path class="stk-glyph" d="M32 12 C38 18 40 26 40 32 L36 39 H28 L24 32 C24 26 26 18 32 12 Z M24 34 L18 42 L24 42 Z M40 34 L46 42 L40 42 Z M29 41 L32 50 L35 41 Z"/>',
    sun: '<circle class="stk-glyph" cx="32" cy="32" r="7.5"/>'
        + '<path class="stk-line" d="M32 15 v6 M32 43 v6 M15 32 h6 M43 32 h6 M20 20 l4.2 4.2 M39.8 39.8 L44 44 M44 20 l-4.2 4.2 M24.2 39.8 L20 44"/>',
    castle: '<path class="stk-glyph" d="M18 47 V24 h5 v-5 h5 v5 h8 v-5 h5 v5 h5 v23 Z"/>',
    football: '<path class="stk-glyph" d="M15 49 C15 32 32 15 49 15 C49 32 32 49 15 49 Z"/>'
        + '<path class="stk-lace" d="M26 38 L38 26 M28.5 35.5 l3 3 M32 32 l3 3 M35.5 28.5 l3 3"/>',
    numeral: '', // testo, gestito da stickerSVG
};

// Ovale schiacciato come gli sticker Michigan reali (~1.7:1), piatto senza bordo
const OVAL = '<ellipse class="stk-oval" cx="48" cy="28" rx="46.5" ry="26.5"/>';

/**
 * Sticker ovale di un badge.
 * @param {Object} o
 * @param {string} o.icon      - glifo (vedi ICONS)
 * @param {string} [o.text]    - testo a destra del glifo (es. '×3', '2021', '50')
 * Senza testo il glifo è centrato; con testo il glifo slitta a sinistra.
 */
export function stickerSVG({ icon, text }) {
    const glyph = ICONS[icon] || ICONS.laurel;
    let inner;
    if (text) {
        const long = String(text).length > 2;
        inner = `<g transform="translate(${long ? 29 : 33} 28) scale(0.62) translate(-32 -32)">${glyph}</g>`
            + `<text class="stk-num${long ? ' stk-num--long' : ''}" x="${long ? 63 : 66}" y="${long ? 33 : 35}" text-anchor="middle">${text}</text>`;
    } else {
        inner = `<g transform="translate(48 28) scale(0.7) translate(-32 -32)">${glyph}</g>`;
    }
    return `<svg class="stk-svg" viewBox="0 0 96 56" aria-hidden="true">${OVAL}${inner}</svg>`;
}

/**
 * Sticker Super Bowl: numero romano grande + anno piccolo.
 * Va nella fila in alto a destra dell'hero, uno per titolo vinto.
 */
export function sbStickerSVG(roman, year) {
    return `<svg class="stk-svg stk-svg--sb" viewBox="0 0 96 56" aria-hidden="true">
        ${OVAL}
        <text class="stk-sb-label" x="48" y="15" text-anchor="middle">SUPER BOWL</text>
        <text class="stk-sb-roman" x="48" y="38" text-anchor="middle">${roman}</text>
        <text class="stk-sb-year" x="48" y="49" text-anchor="middle">${year}</text>
    </svg>`;
}

/**
 * Sticker "campione in carica": versione die-cut del logo SB-Champ —
 * sagoma bianca che segue il contorno del pallone CFP con margine
 * uniforme (asset generato: Logos/SB-Champ-sticker.png).
 * Unico per tutta la lega.
 */
export function champStickerSVG() {
    return `<img class="stk-svg stk-champ-img" src="Logos/SB-Champ-sticker.png" alt="" aria-hidden="true"
                 onerror="this.style.display='none'">`;
}
