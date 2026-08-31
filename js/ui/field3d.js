/**
 * Campo NFL in prospettiva — geometria e scena condivise.
 *
 * È il campo del play-by-play (pagina squadra NFL). Sta in un modulo a sé
 * perché per un periodo lo usava anche la home come fondale; oggi la home ha
 * il suo campo visto dall'alto (`apFieldSvg` in sections/home.js) e questo è
 * di nuovo del solo play-by-play — ma la geometria resta condivisibile, ed è
 * qui che va cercata se serve di nuovo a qualcun altro.
 *
 * La prospettiva non è una `rotateX` in CSS: è un'**omografia** vera, risolta
 * una volta sola all'avvio mappando i quattro angoli del campo (in yard) sui
 * quattro angoli voluti a schermo. Per questo le yard line convergono davvero,
 * i numeri stanno "stampati" sul piano e la parabola di un passaggio sale come
 * deve. È matematica sottile: esiste in un posto solo, e da lì la importano
 * tutti.
 *
 * Chi disegna qualcosa sul campo usa `fdProj` (punto a terra), `fdProjH`
 * (punto con altezza) e le `fdMatrix*` per posare testo e loghi sul piano.
 *
 * Le classi CSS sono le `pp-fd3-*` già globali in css/main.css.
 */

// ─── Omografia ───────────────────────────────────────────────────

/** Eliminazione di Gauss 8×8: risolve i coefficienti dell'omografia. */
function _solve8(A, b) {
    const n = 8, M = A.map((r, i) => [...r, b[i]]);
    for (let c = 0; c < n; c++) {
        let piv = c;
        for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
        [M[c], M[piv]] = [M[piv], M[c]];
        const dv = M[c][c] || 1e-9;
        for (let j = c; j <= n; j++) M[c][j] /= dv;
        for (let r = 0; r < n; r++) { if (r === c) continue; const f = M[r][c]; for (let j = c; j <= n; j++) M[r][j] -= f * M[c][j]; }
    }
    return M.map(r => r[n]);
}

export const FLD3 = (() => {
    const fxMin = -15, fxMax = 115, W = 53.3;                       // end zone lunghe (15 yd)
    const src = [[fxMin, 0], [fxMax, 0], [fxMax, W], [fxMin, W]];
    const dst = [[64, 224], [936, 224], [744, 76], [256, 76]];     // meno prospettiva + campo in alto (poco vuoto sopra)
    const A = [], b = [];
    for (let i = 0; i < 4; i++) {
        const [u, v] = src[i], [X, Y] = dst[i];
        A.push([u, v, 1, 0, 0, 0, -u * X, -v * X]); b.push(X);
        A.push([0, 0, 0, u, v, 1, -u * Y, -v * Y]); b.push(Y);
    }
    return { fxMin, fxMax, W, h: _solve8(A, b), farScale: 0.74, HK: 4.2, vbW: 1000, vbH: 262 };
})();

/** Punto a terra: (yard lungo il campo, yard in larghezza) → (x, y) schermo. */
export function fdProj(fx, fz) {
    const [a, c, d, e, f, g, p, q] = FLD3.h;
    const w = p * fx + q * fz + 1;
    return [(a * fx + c * fz + d) / w, (e * fx + f * fz + g) / w];
}

/** Scorcio: quanto "si accorcia" un oggetto man mano che va lontano. */
export function fdScale(fz) { return 1 - (fz / FLD3.W) * (1 - FLD3.farScale); }

/** Punto con altezza (la Y in yard): serve alle parabole dei passaggi. */
export function fdProjH(fx, fz, y) { const [x, sy] = fdProj(fx, fz); return [x, sy - (y || 0) * FLD3.HK * fdScale(fz)]; }

// Matrice affine locale (1 unità = 1 yard) per "posare" elementi sul piano del
// campo: local-x lungo la lunghezza, local-y (giù del testo) verso il basso.
export function fdMatrix(fx, fz) {
    const [ox, oy] = fdProj(fx, fz);
    const [ux, uy] = fdProj(fx + 1, fz);
    const [vx, vy] = fdProj(fx, fz + 1);
    return `matrix(${(ux - ox).toFixed(4)},${(uy - oy).toFixed(4)},${(ox - vx).toFixed(4)},${(oy - vy).toFixed(4)},${ox.toFixed(2)},${oy.toFixed(2)})`;
}

// Matrice per i NUMERI: reading lungo la lunghezza, con la parte alta rivolta
// verso il CENTRO del campo (su entrambi i lati) → come su un campo vero.
export function fdMatrixNum(fx, fz) {
    const [ox, oy] = fdProj(fx, fz);
    const [ux, uy] = fdProj(fx + 1, fz);
    const away = fz < FLD3.W / 2 ? -1 : 1;    // "giù" del testo = lontano dal centro
    const [vx, vy] = fdProj(fx, fz + away);
    return `matrix(${(ux - ox).toFixed(4)},${(uy - oy).toFixed(4)},${(vx - ox).toFixed(4)},${(vy - oy).toFixed(4)},${ox.toFixed(2)},${oy.toFixed(2)})`;
}

// Matrice per i LOGHI delle end zone: posati sul piano, "in piedi" rivolti verso
// il centro del campo (simmetrici, nessuno capovolto). local-x lungo la larghezza,
// "su" (top) verso il centro lungo la lunghezza.
export function fdMatrixLogo(fx) {
    const fz = FLD3.W / 2;
    const [ox, oy] = fdProj(fx, fz);
    const [ux, uy] = fdProj(fx, fz + 1);          // local-x lungo la larghezza
    const toC = fx < 50 ? -1 : 1;                 // "giù" = lontano dal centro lungo la lunghezza
    const [vx, vy] = fdProj(fx + toC, fz);
    return `matrix(${(ux - ox).toFixed(4)},${(uy - oy).toFixed(4)},${(vx - ox).toFixed(4)},${(vy - oy).toFixed(4)},${ox.toFixed(2)},${oy.toFixed(2)})`;
}

// ─── Scena ───────────────────────────────────────────────────────

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

/**
 * Il campo disegnato, senza niente sopra: erba, end zone colorate, yard line,
 * hash mark, numeri, loghi e pali.
 *
 * Ritorna `{ defs, body }` — due stringhe da infilare dentro un `<svg>` già
 * proprio, così chi ci deve mettere anche altro (le frecce delle giocate) può
 * aggiungere i suoi `<defs>` e i suoi livelli senza duplicare il campo.
 *
 * `idPrefix` è obbligatorio nei fatti: gli `<defs>` si riferiscono per id, e
 * nella SPA le sezioni convivono tutte nel DOM. Due campi con gli stessi id e
 * `url(#…)` prende sempre il primo — la home ruberebbe le end zone alla pagina
 * NFL. Ogni campo in pagina deve avere il suo prefisso.
 *
 * `detail: 'simple'` salta hash mark e numeri: sono ~180 elementi SVG che a
 * fondale sfumato non si vedono comunque.
 */
export function fieldScene({
    leftColor = '#334155', rightColor = '#334155',
    leftLogo = '', rightLogo = '',
    idPrefix = 'f3', detail = 'full',
} = {}) {
    const { fxMin, fxMax, W } = FLD3;
    const P = (fx, fz) => { const [x, y] = fdProj(fx, fz); return `${x.toFixed(1)},${y.toFixed(1)}`; };
    const poly = (corners, cls, style = '') => `<polygon points="${corners.map(c => P(c[0], c[1])).join(' ')}" class="${cls}"${style ? ` style="${style}"` : ''}/>`;

    let stripes = '';
    for (let sx = 0; sx < 100; sx += 10) stripes += poly([[sx, 0], [sx + 10, 0], [sx + 10, W], [sx, W]], (sx / 10) % 2 ? 'pp-fd3-grass-a' : 'pp-fd3-grass-b');
    const ezL = poly([[fxMin, 0], [0, 0], [0, W], [fxMin, W]], 'pp-fd3-ez', `fill:${leftColor}`);
    const ezR = poly([[100, 0], [fxMax, 0], [fxMax, W], [100, W]], 'pp-fd3-ez', `fill:${rightColor}`);

    let yl = '';
    for (let v = 0; v <= 100; v += 5) { const [x1, y1] = fdProj(v, 0), [x2, y2] = fdProj(v, W); yl += `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" class="pp-fd3-yl${v % 10 === 0 ? ' pp-fd3-yl10' : ''}"/>`; }

    let hash = '', nums = '';
    if (detail !== 'simple') {
        for (let v = 1; v < 100; v++) { if (v % 5 === 0) continue; for (const hz of [23.58, W - 23.58]) { const [x1, y1] = fdProj(v - 0.35, hz), [x2, y2] = fdProj(v + 0.35, hz); hash += `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" class="pp-fd3-hash"/>`; } }
        // Numeri "stampati" sul campo: posati sul piano, distanziati (le due cifre
        // staccate) e con la parte alta verso il centro del campo su entrambi i lati.
        for (let v = 10; v <= 90; v += 10) {
            const n = String(v <= 50 ? v : 100 - v).split('').join('  ');   // cifre staccate
            for (const fz of [11, W - 11]) nums += `<text transform="${fdMatrixNum(v, fz)}" font-size="4" letter-spacing="0.5" class="pp-fd3-num" text-anchor="middle" dominant-baseline="central">${n}</text>`;
        }
    }

    // Loghi ruotati e posati in prospettiva sull'end zone, RITAGLIATI all'end
    // zone (clip-path) così non escono mai dai suoi bordi.
    const idL = `${idPrefix}-ezl`, idR = `${idPrefix}-ezr`, idD = `${idPrefix}-depth`;
    const clipL = `<clipPath id="${idL}" clipPathUnits="userSpaceOnUse"><polygon points="${[[fxMin, 0], [0, 0], [0, W], [fxMin, W]].map(c => P(c[0], c[1])).join(' ')}"/></clipPath>`;
    const clipR = `<clipPath id="${idR}" clipPathUnits="userSpaceOnUse"><polygon points="${[[100, 0], [fxMax, 0], [fxMax, W], [100, W]].map(c => P(c[0], c[1])).join(' ')}"/></clipPath>`;
    const ezLogo = (href, cx, clip) => { const sz = 14; return href ? `<g clip-path="url(#${clip})"><g transform="${fdMatrixLogo(cx)} rotate(180)"><image href="${esc(href)}" x="${(-sz / 2)}" y="${(-sz / 2)}" width="${sz}" height="${sz}" class="pp-fd3-logo" preserveAspectRatio="xMidYMid meet"/></g></g>` : ''; };
    const logos = ezLogo(leftLogo, fxMin / 2, idL) + ezLogo(rightLogo, (100 + fxMax) / 2, idR);

    // Goalpost NFL (giallo) sulla linea di fondo di ogni end zone: palo base +
    // traversa + due montanti, proiettati in altezza (prospettiva coerente).
    const goalpost = (fxEnd) => {
        // Misure reali NFL (in yard): traversa a 10 ft, montanti +35 ft, larghezza 18.5 ft.
        const hc = 3.08, Hc = 3.33, Hu = 11.67;
        const pt = (fz, y) => fdProjH(fxEnd, fz, y);
        const L = (a, b, cls) => `<line x1="${a[0].toFixed(1)}" y1="${a[1].toFixed(1)}" x2="${b[0].toFixed(1)}" y2="${b[1].toFixed(1)}" class="${cls}"/>`;
        const bBot = pt(W / 2, 0), bTop = pt(W / 2, Hc), cl = pt(W / 2 - hc, Hc), cr = pt(W / 2 + hc, Hc), ul = pt(W / 2 - hc, Hc + Hu), ur = pt(W / 2 + hc, Hc + Hu);
        return `<g class="pp-fd-gp">${L(bBot, bTop, 'pp-fd-gp-pole')}${L(cl, cr, 'pp-fd-gp-bar')}${L(cl, ul, 'pp-fd-gp-up')}${L(cr, ur, 'pp-fd-gp-up')}</g>`;
    };

    const defs = `<linearGradient id="${idD}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity="0.34"/><stop offset="0.55" stop-color="#000" stop-opacity="0"/></linearGradient>${clipL}${clipR}`;
    const body = `${ezL}${ezR}${stripes}`
        + `<polygon points="${P(fxMin, 0)} ${P(fxMax, 0)} ${P(fxMax, W)} ${P(fxMin, W)}" fill="url(#${idD})"/>`
        + `${hash}${yl}${nums}${logos}${goalpost(fxMin)}${goalpost(fxMax)}`;

    return { defs, body };
}

/**
 * Il campo come `<svg>` completo, pronto da usare come fondale.
 * Per disegnarci sopra (frecce, giocatori) usare `fieldScene()` e comporre.
 */
export function emptyField(opts = {}) {
    const { defs, body } = fieldScene(opts);
    return `<svg class="pp-fd-svg pp-fd3 ${opts.cls || ''}" viewBox="0 0 ${FLD3.vbW} ${FLD3.vbH}"
                 preserveAspectRatio="${opts.preserve || 'xMidYMid meet'}" aria-hidden="true" focusable="false">
        <defs>${defs}</defs>${body}
    </svg>`;
}
