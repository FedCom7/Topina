/**
 * Le divise delle quattro squadre, disegnate in SVG.
 *
 * Prima erano quattro JPG in "Team Uniform/" (una tavola con quattro divise
 * per squadra): i colori stavano dentro i pixel, quindi cambiare una tinta in
 * TEAM_PALETTE non cambiava le maglie, e Oscurus aveva divise rosso/navy
 * mentre il resto del sito lo dipingeva bordeaux. Adesso ogni pezzo legge i
 * colori dalla palette (`js/data/team-config.js`): le sole tinte scritte qui
 * sono bianco, nero e il grigio dei profili, che non sono di nessuna squadra.
 *
 * Le FORME non sono disegnate qui: sono i tracciati estratti pixel per
 * pixel dalla tavola delle divise Eagles 2026 di Wikipedia
 * (`uniform-shapes.js`, generato da scripts/uniforms/trace-uniforms.py). Qui
 * si decide solo cosa va di che colore, più le cose che cambiano da squadra a
 * squadra (decalcomanie del casco, strisce, numero). La sagoma è la stessa per
 * tutte e quattro. I marchi NFL e Nike non ci sono: al posto dell'aquila sulle
 * maniche va il logo della squadra.
 *
 * Come sulla tavola, ogni pezzo ha il contorno nero, e grigio quando il pezzo
 * stesso è nero (o non si vedrebbe).
 *
 * Una divisa sono tre pezzi indipendenti — casco, maglia, pantaloni (con i
 * calzettoni) — perché la pagina squadra li lascia mescolare: casco della
 * Away con maglia della Home, come fanno le squadre vere. Per questo
 * `uniformSVG` prende i tre pezzi separati e non un preset.
 */
import { TEAM_PALETTE, TEAM_LOGO_SCALE } from '../data/team-config.js?v=538';
import { SHAPES as S } from './uniform-shapes.js?v=2';

const W = '#FFFFFF';
const K = '#000000';
const G = '#666666';   // profili, piping neutro, viti del casco

const LOGO = {
    capi: 'Team%20Logo/team_capi_transparent.png',
    lasers: 'Team%20Logo/team_lasers_transparent.png',
    oscurus: 'Team%20Logo/team_oscurus_transparent.png',
    sommo: 'Team%20Logo/team_sommo_transparent.png',
};

const c = TEAM_PALETTE.capi;
const l = TEAM_PALETTE.lasers;
const o = TEAM_PALETTE.oscurus;
const s = TEAM_PALETTE.sommo;

/* Ogni preset: { id, label, note, helmet, jersey, pants }.
   helmet: shell, mask (le barre), maskLine (il loro profilo),
     decal { type: 'logo' } — il casco è a tinta unita col logo della squadra
   jersey: body, collar, cuff (fascia in fondo alla manica, null = niente),
     stripes [larga, stretta] sulla manica, num, numLine (ombra e profilo del
     numero), word (scritta sul petto), patch (logo sulla manica)
   pants:  body, piping [esterno, interno] lungo il fianco,
     socks { body, top (metà alta di un altro colore), bands [strisce] }
   jersey.cut 'throwback' prende il taglio del Kelly Green (colletto senza
   fascia, numeri senz'ombra); wordColor sovrascrive il colore della scritta,
   che altrimenti è nero sul bianco e bianco su tutto il resto */
export const UNIFORMS = {
    /* Le quattro divise seguono lo schema di Sommo: Home nel colore della
       squadra, Away bianca, Alternate scura coi dettagli nel colore, e la
       quarta storica col taglio del throwback. */
    capi: [
        {
            id: 'home', label: 'Home', note: 'Orange jersey, white pants',
            helmet: { shell: c.identity, mask: c.secondary, maskLine: G, decal: { type: 'logo' } },
            jersey: { body: c.identity, collar: c.secondary, cuff: null, stripes: [], num: W, numLine: c.secondary, word: 'CAPI', patch: true },
            pants: { body: W, piping: [c.secondary, c.identity], socks: { body: c.identity, top: null, bands: [] } },
        },
        {
            id: 'away', label: 'Away', note: 'White jersey, orange pants',
            helmet: { shell: c.identity, mask: c.secondary, maskLine: G, decal: { type: 'logo' } },
            jersey: { body: W, collar: c.secondary, cuff: null, stripes: [], num: c.identity, numLine: c.secondary, word: 'CAPI', patch: true },
            pants: { body: c.identity, piping: [c.secondary, W], socks: { body: W, top: null, bands: [] } },
        },
        {
            id: 'alt', label: 'Color Rush', note: 'All orange',
            helmet: { shell: c.identity, mask: c.secondary, maskLine: G, decal: { type: 'logo' } },
            jersey: { body: c.identity, collar: c.secondary, cuff: null, stripes: [], num: c.secondary, numLine: W, word: 'CAPI', wordColor: c.secondary, patch: true },
            pants: { body: c.identity, piping: [c.secondary, W], socks: { body: c.identity, top: null, bands: [] } },
        },
        {
            id: 'rush', label: 'Royal Throwback', note: 'The 2019 planet blue',
            helmet: { shell: c.throwback, mask: W, maskLine: G, decal: { type: 'logo' } },
            jersey: { cut: 'throwback', body: c.throwback, collar: c.throwback, collarLine: K, numShadow: 0, cuff: null, stripes: [], num: c.identity, numLine: W, word: null, patch: true },
            pants: { body: W, piping: [c.identity, c.throwback], socks: { body: W, top: null, bands: [c.identity] } },
        },
    ],
    /* Oro, bianco e nero alla maniera dei Saints: il nero è la maglia di
       casa, l'oro va su pantaloni e numeri. */
    lasers: [
        {
            id: 'home', label: 'Home', note: 'Black jersey, gold pants',
            helmet: { shell: l.identity, mask: l.tertiary, maskLine: G, decal: { type: 'logo' } },
            jersey: { body: l.tertiary, collar: l.identity, cuff: null, stripes: [], num: l.identity, numLine: W, word: 'LASERS', patch: true },
            pants: { body: l.identity, piping: [l.tertiary], socks: { body: l.tertiary, top: null, bands: [] } },
        },
        {
            id: 'away', label: 'Away', note: 'White jersey, gold pants',
            helmet: { shell: l.identity, mask: l.tertiary, maskLine: G, decal: { type: 'logo' } },
            jersey: { body: W, collar: l.tertiary, cuff: null, stripes: [], num: l.identity, numLine: l.tertiary, word: 'LASERS', patch: true },
            pants: { body: l.identity, piping: [l.tertiary], socks: { body: W, top: null, bands: [] } },
        },
        {
            id: 'alt', label: 'Color Rush', note: 'All gold',
            helmet: { shell: l.identity, mask: l.tertiary, maskLine: G, decal: { type: 'logo' } },
            jersey: { body: l.identity, collar: l.tertiary, cuff: null, stripes: [], num: l.tertiary, numLine: W, word: 'LASERS', wordColor: l.tertiary, patch: true },
            pants: { body: l.identity, piping: [l.tertiary, W], socks: { body: l.identity, top: null, bands: [] } },
        },
        {
            id: 'rush', label: 'Original 2019', note: 'Charcoal and gold, as it began',
            helmet: { shell: l.throwback, mask: l.tertiary, maskLine: G, decal: { type: 'logo' } },
            jersey: { cut: 'throwback', body: l.throwback, collar: l.throwback, collarLine: K, numShadow: 0, cuff: null, stripes: [], num: l.identity, numLine: l.tertiary, word: null, patch: true },
            pants: { body: l.tertiary, piping: [l.identity, l.throwback], socks: { body: l.throwback, top: null, bands: [l.identity] } },
        },
    ],
    /* Bordeaux e oro alla maniera dei Commanders, col nero a tenere il tema
       "oscuro". */
    oscurus: [
        {
            id: 'home', label: 'Home', note: 'Bordeaux jersey, white pants',
            helmet: { shell: o.identity, mask: o.secondary, maskLine: G, decal: { type: 'logo' } },
            jersey: { body: o.identity, collar: o.secondary, cuff: null, stripes: [], num: W, numLine: o.secondary, word: 'OSCURUS', patch: true },
            pants: { body: W, piping: [o.identity, o.secondary], socks: { body: o.identity, top: null, bands: [] } },
        },
        {
            id: 'away', label: 'Away', note: 'White jersey, bordeaux pants',
            helmet: { shell: o.identity, mask: o.secondary, maskLine: G, decal: { type: 'logo' } },
            jersey: { body: W, collar: o.identity, cuff: null, stripes: [], num: o.identity, numLine: o.secondary, word: 'OSCURUS', patch: true },
            pants: { body: o.identity, piping: [o.secondary], socks: { body: W, top: null, bands: [] } },
        },
        {
            id: 'alt', label: 'Color Rush', note: 'All bordeaux, gold trim',
            helmet: { shell: o.identity, mask: o.secondary, maskLine: G, decal: { type: 'logo' } },
            jersey: { body: o.identity, collar: o.secondary, cuff: null, stripes: [], num: o.secondary, numLine: o.tertiary, word: 'OSCURUS', wordColor: o.secondary, patch: true },
            pants: { body: o.identity, piping: [o.secondary, o.tertiary], socks: { body: o.identity, top: null, bands: [] } },
        },
        {
            id: 'rush', label: 'Red Throwback', note: 'The 2019 red',
            helmet: { shell: o.throwback, mask: W, maskLine: G, decal: { type: 'logo' } },
            jersey: { cut: 'throwback', body: o.throwback, collar: o.throwback, collarLine: K, numShadow: 0, cuff: null, stripes: [], num: W, numLine: o.tertiary, word: null, patch: true },
            pants: { body: W, piping: [o.throwback, o.tertiary], socks: { body: W, top: null, bands: [o.throwback] } },
        },
    ],
    /* Gli Eagles del 2026, uno a uno: midnight green, white, black e il kelly
       green dei throwback. Le ali sul casco sono le loro. */
    sommo: [
        {
            id: 'home', label: 'Home', note: 'Midnight green, white pants',
            helmet: { shell: s.identity, mask: K, maskLine: G, decal: { type: 'logo' } },
            jersey: { body: s.identity, collar: K, cuff: null, stripes: [], num: W, numLine: K, word: 'SOMMO', patch: true },
            pants: { body: W, piping: [G], socks: { body: W, top: null, bands: [] } },
        },
        {
            id: 'away', label: 'Away', note: 'White jersey, midnight pants',
            helmet: { shell: s.identity, mask: K, maskLine: G, decal: { type: 'logo' } },
            jersey: { body: W, collar: K, cuff: null, stripes: [], num: s.identity, numLine: K, word: 'SOMMO', patch: true },
            pants: { body: s.identity, piping: [G], socks: { body: W, top: null, bands: [] } },
        },
        {
            id: 'alt', label: 'Alternate', note: 'Black with midnight trim',
            helmet: { shell: K, mask: K, maskLine: G, decal: { type: 'logo' } },
            jersey: { body: K, collar: s.identity, cuff: s.identity, stripes: [], num: W, numLine: s.identity, word: 'SOMMO', patch: true },
            pants: { body: K, piping: [s.secondary], socks: { body: K, top: null, bands: [] } },
        },
        {
            id: 'rush', label: 'Kelly Green', note: 'The throwback',
            helmet: { shell: s.throwback, mask: s.secondary, maskLine: G, decal: { type: 'logo' } },
            jersey: { cut: 'throwback', body: s.throwback, collar: s.throwback, collarLine: K, numShadow: 0, cuff: null, stripes: [], num: W, numLine: K, word: null, patch: true },
            pants: { body: s.secondary, piping: [s.throwback, W], socks: { body: W, top: null, bands: [s.throwback, s.throwback] } },
        },
    ],
};

// ─── disegno ─────────────────────────────────────────────────────

const esc = (v) => String(v ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

/** Il contorno di un pezzo: nero, ma grigio sui pezzi neri (come la tavola). */
function edge(color) {
    const h = String(color).replace('#', '');
    const [r, g, b] = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16) / 255);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b < 0.06 ? G : K;
}
const P = (d, fill, extra = '') => d ? `<path d="${d}" fill="${fill}" ${extra}/>` : '';

/* ─── le cifre ───
   Il numero degli Eagles è un carattere a blocco: tratto di spessore
   costante, angoli arrotondati, il "flag" dell'1 in diagonale. Nessun font a
   disposizione gli somiglia (provati Oswald, Bebas, Teko, Anton, Big
   Shoulders…: hanno lo 0 ovale), quindi le dieci cifre sono tratti su una
   griglia 100×200, disegnati con lo spessore del numero vero. */
const T = 36;            // spessore del tratto, sulla griglia 100×200
const DIGITS = {
    0: { w: 100, d: 'M18 18 H82 V182 H18 Z' },
    1: { w: 76, d: 'M54 0 V200 M54 22 L14 62' },
    2: { w: 100, d: 'M18 56 V18 H82 V100 H18 V182 H82' },
    3: { w: 100, d: 'M18 18 H82 V182 H18 M36 100 H82' },
    4: { w: 100, d: 'M18 0 V112 H82 M82 0 V200' },
    5: { w: 100, d: 'M82 18 H18 V100 H82 V182 H18' },
    6: { w: 100, d: 'M82 18 H18 V182 H82 V100 H18' },
    7: { w: 100, d: 'M18 18 H82 V60 L48 200' },
    8: { w: 100, d: 'M18 18 H82 V182 H18 Z M18 100 H82' },
    9: { w: 100, d: 'M82 100 H18 V18 H82 V182 H18' },
};
const GAP = 10;

/** Il numero dentro un rettangolo [x0,y0,x1,y1], alto quanto il rettangolo.
 *  Tre passate: ombra spostata in basso a destra, contorno, pieno. */
function numberSVG(num, j, box, { rotate = 0, shadow = 9, line = 5 } = {}) {
    const digits = String(num).split('').filter(ch => DIGITS[ch]);
    if (!digits.length) return '';
    const [x0, y0, x1, y1] = box;
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    const h = rotate ? Math.max(x1 - x0, y1 - y0) : y1 - y0;
    const k = h / 200;
    const total = digits.reduce((a, ch) => a + DIGITS[ch].w, 0) + GAP * (digits.length - 1);
    let x = -total / 2;
    const d = digits.map(ch => {
        const g = DIGITS[ch];
        const part = g.d.replace(/([MLHV])\s*([-\d.]+)(?:\s+([-\d.]+))?/g, (m, c, a, b) => {
            if (c === 'H') return `H${+a + x}`;
            if (c === 'V') return `V${+a - 100}`;
            return `${c}${+a + x} ${+b - 100}`;
        });
        x += g.w + GAP;
        return part;
    }).join(' ');
    const tf = `transform="translate(${cx} ${cy}) rotate(${rotate}) scale(${k})"`;
    const sw = (extra) => T + extra / k;
    const stroke = (color, width, dx = 0, dy = 0) => `<path d="${d}" fill="none" stroke="${color}" stroke-width="${width}"
        stroke-linejoin="round" stroke-linecap="butt" ${dx || dy ? `transform="translate(${dx / k} ${dy / k})"` : ''}/>`;
    return `<g ${tf}>
        ${shadow ? stroke(j.numLine, sw(2 * line), shadow, shadow) : ''}
        ${stroke(j.numLine, sw(2 * line))}
        ${stroke(j.num, T)}
    </g>`;
}

/* Il casco: tinta unita, griglia, viti, e il logo della squadra sul fianco.
   I quattro PNG dei loghi occupano porzioni diverse della tela (vedi
   TEAM_LOGO_SCALE): la casella si scala con quel fattore, così i loghi
   risultano della stessa altezza disegnata su tutti i caschi. */
const LOGO_BOX = 330;
const LOGO_CENTER = [528, 128];
function helmetSVG(team, h, id) {
    const size = LOGO_BOX * (TEAM_LOGO_SCALE[team] || 1);
    const logo = h.decal?.type === 'logo'
        ? `<image href="${LOGO[team]}" x="${LOGO_CENTER[0] - size / 2}" y="${LOGO_CENTER[1] - size / 2}" width="${size}" height="${size}"
                  clip-path="url(#${id}-shell)" preserveAspectRatio="xMidYMid meet"/>`
        : '';
    return `
    <g class="uni-helmet">
        ${P(S.SHELL_LINE, edge(h.shell))}
        ${P(S.SHELL_FILL, h.shell)}
        ${P(S.SCREWS, '#4D4D4D')}
        ${logo}
        ${P(S.MASK_LINE, h.maskLine)}
        ${P(S.MASK_IN, h.mask)}
    </g>`;
}

function jerseySVG(team, j, number, id) {
    const num = String(number);
    // il Kelly Green ha un taglio suo: colletto a V senza fascia dietro,
    // maniche senza rovescio nero, numeri sulle spalle in un altro punto
    const tb = j.cut === 'throwback';
    const shadow = j.numShadow ?? 9;
    const [s1, s2] = j.stripes || [];
    // strisce sulla manica: la fascia del polsino, spostata verso la spalla
    const band = (color, dy) => `<path d="${S.CUFF}" fill="${color}" transform="translate(0 ${dy})" clip-path="url(#${id}-jersey)"/>`;
    const patch = (b) => `<image href="${LOGO[team]}" x="${b[0] - 14}" y="${b[1] - 4}" width="${b[2] - b[0] + 28}"
        height="${b[3] - b[1] + 8}" preserveAspectRatio="xMidYMid meet"/>`;
    const wb = S.WORD_BOX;
    return `
    <g class="uni-jersey">
        ${P(tb ? S.KJERSEY_LINE : S.JERSEY_LINE, edge(j.body))}
        ${P(tb ? S.KJERSEY_FILL : S.JERSEY_FILL, j.body)}
        ${s2 ? band(s2, -62) : ''}${s1 ? band(s1, -34) : ''}
        ${j.cuff && !tb ? P(S.CUFF, j.cuff) : ''}
        ${tb ? P(S.KCOLLAR_LINES, j.collarLine || K) : `
        ${P(S.SLEEVE_IN, K)}
        ${P(S.COLLAR, j.collar)}
        ${P(S.NECK, j.body)}
        ${P(S.COLLAR_LINES, j.collarLine || G)}`}
        ${numberSVG(num.slice(-1), j, tb ? S.KTV_L_BOX : S.TV_L_BOX, { rotate: 78, shadow: shadow ? 5 : 0, line: 4 })}
        ${numberSVG(num[0], j, tb ? S.KTV_R_BOX : S.TV_R_BOX, { rotate: -78, shadow: shadow ? 5 : 0, line: 4 })}
        ${j.patch ? patch(S.PATCH_L_BOX) + patch(S.PATCH_R_BOX) : ''}
        ${j.word ? `<g transform="translate(${(wb[0] + wb[2]) / 2} ${wb[3]}) skewX(-14)">
            <text x="3" y="3" text-anchor="middle" class="uni-word" fill="${j.numLine}" textLength="${wb[2] - wb[0]}" lengthAdjust="spacingAndGlyphs">${esc(j.word)}</text>
            <text text-anchor="middle" class="uni-word" fill="${j.wordColor || (j.body === W ? K : W)}" textLength="${wb[2] - wb[0]}" lengthAdjust="spacingAndGlyphs">${esc(j.word)}</text>
        </g>` : ''}
        ${numberSVG(num, j, tb ? S.KNUM_BOX : S.NUM_BOX, { shadow, line: tb ? 7 : 5 })}
    </g>`;
}

function pantsSVG(p, id) {
    const [p1, p2] = p.piping || [];
    const sk = p.socks || { body: W };
    return `
    <g class="uni-socks">
        ${P(S.SOCKS_LINE, edge(sk.body))}
        ${P(S.SOCKS_FILL, sk.body)}
        <g clip-path="url(#${id}-socks)">
            ${sk.top ? `<rect x="150" y="2090" width="700" height="180" fill="${sk.top}"/>` : ''}
            ${(sk.bands || []).length ? P(S.SOCK_BANDS, sk.bands[0]) : ''}
        </g>
    </g>
    <g class="uni-pants">
        ${P(S.PANTS_LINE, edge(p.body))}
        ${P(S.PANTS_FILL, p.body)}
        ${p2 ? P(S.PIPE_THICK, p1) + P(S.PIPE_THIN, p2) : p1 ? P(S.PIPE_GREY, p1) : ''}
        ${P(S.SEAMS, edge(p.body) === G ? '#333' : K)}
    </g>`;
}

/**
 * Una divisa intera. `helmet`, `jersey`, `pants` sono i pezzi di un preset
 * (anche di preset diversi). `idPrefix` dev'essere unico nella pagina: i
 * clipPath sono per-id, e due SVG con lo stesso id si rubano il ritaglio.
 */
export function uniformSVG({ team, helmet, jersey, pants, number = '10', idPrefix = 'uni', label = '' }) {
    const id = idPrefix;
    return `
    <svg class="uni-svg" viewBox="70 0 840 2460" role="img" aria-label="${esc(label)}" fill-rule="evenodd">
        <defs>
            <clipPath id="${id}-shell"><path d="${S.SHELL_FILL}" clip-rule="evenodd"/></clipPath>
            <clipPath id="${id}-jersey"><path d="${S.JERSEY_FILL}" clip-rule="evenodd"/></clipPath>
            <clipPath id="${id}-socks"><path d="${S.SOCKS_FILL}" clip-rule="evenodd"/></clipPath>
        </defs>
        ${pantsSVG(pants, id)}
        ${jerseySVG(team, jersey, number, id)}
        ${helmetSVG(team, helmet, id)}
    </svg>`;
}

/** Le quattro divise di una squadra, in ordine. */
export function uniformsFor(team) {
    return UNIFORMS[team] || [];
}
