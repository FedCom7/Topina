/**
 * Sticker SVG — "helmet stickers" stile Michigan Wolverines.
 * Ovali adesivi nei colori del team, tutto vettoriale inline (nessun file).
 * Il colore arriva dal CSS via var(--team-color) (classi .stk-*),
 * così ogni parete di sticker si tinge automaticamente col colore del team.
 *
 * ── Due tinte, e basta ────────────────────────────────────────────
 * `paint` è il fondo dell'adesivo, `ink` è l'inchiostro. Nient'altro: niente
 * sfumature, niente bordi, niente terza tinta. I dettagli dentro un marchio si
 * ricavano per SOTTRAZIONE — buchi color fondo dentro la sagoma piena (classe
 * `stk-lace`) — che è come si stampa davvero un adesivo a due colori.
 *
 * ── L'impaginato dice già di che si tratta ────────────────────────
 * Sul casco di Michigan dentro lo stesso ovale ci vanno cose diverse a seconda
 * di cosa si celebra: la vittoria è ghiottone + numero progressivo, la rivalità
 * è «THE GAME» + conteggio, otto vittorie di fila sono «RAMPAGE 2023» e basta,
 * il capitano è una «C», il prefisso di casa è «(540)». Non è varietà per
 * bellezza: l'impaginato si riconosce prima di leggere le parole. Qui sotto
 * sono nove (`COMPOSITIONS`), e ogni badge dichiara il suo in js/data/badges.js.
 *
 * Il banco di prova è preview-stickers.html: importa QUESTO file, quindi ciò
 * che si vede là è ciò che si vede sull'hero. Le proposte non ancora adottate
 * (le famiglie, gli adesivi in palio) vivono solo là.
 */

/* ── I marchi ──────────────────────────────────────────────────────
   Non sono icone: sono marchi, e devono reggere a 20px dentro un ovale largo
   96. Sistema 64×64, disegno centrato su 32,32.
   Quelli dei Wolverines sono registrati e non si ricopiano: questi sono i
   nostri, disegnati con la stessa regola. */
export const ICONS = {
    /* LA TOPINA. Il ghiottone di Michigan sta sull'adesivo delle vittorie: è il
       marchio che si ripete di più, quindi è quello che deve funzionare meglio
       in piccolo. Muso di tre quarti verso sinistra come il loro, orecchio
       tondo, occhio e baffi in negativo. */
    topina: '<circle class="stk-glyph" cx="45.5" cy="17" r="10"/>'
        + '<circle class="stk-lace" cx="45.5" cy="17.5" r="5" style="stroke:none;fill:var(--stk-paint)"/>'
        + '<path class="stk-glyph" d="M53 32.5 C53 43 44 50.5 32.5 50.5 C22 50.5 14 45.5 10.5 38.5'
        + ' L4.5 36.5 L10 32 C11.5 22 19 14 28 12.5 C42 10 53 19 53 32.5 Z"/>'
        + '<circle class="stk-lace" cx="30" cy="29.5" r="3.3" style="stroke:none;fill:var(--stk-paint)"/>'
        + '<path class="stk-lace" d="M12.5 41 C17.5 43.5 23.5 44 28.5 42.5" style="stroke-width:2.4"/>'
        + '<path class="stk-lace" d="M7.5 32 L0.5 28 M7 40.5 L0.5 45" style="stroke-width:1.8"/>',

    /* LO SCUDETTO DELLA LEGA: il nostro block M. Stessa forma di
       leagueShieldSVG() in js/ui/sb-logo-svg.js — spalle dritte, fianchi che
       rientrano, punta in basso, banda in alto con una stella per squadra e il
       pallone sotto. Ridotto all'osso perché qui è alto 25px, non 240. */
    shield: '<path class="stk-glyph" d="M14 12 h36 v22 c0 13 -9.5 20.5 -18 24.5 C23.5 54.5 14 47 14 34 Z"/>'
        + '<path class="stk-lace" style="stroke:none;fill:var(--stk-paint)" d="M15.5 13.5 h33 V24 h-33 Z"/>'
        + '<g class="stk-glyph"><circle cx="21.5" cy="18.8" r="2.2"/><circle cx="28.5" cy="18.8" r="2.2"/>'
        + '<circle cx="35.5" cy="18.8" r="2.2"/><circle cx="42.5" cy="18.8" r="2.2"/></g>'
        + '<path class="stk-lace" style="stroke:none;fill:var(--stk-paint)"'
        + ' d="M32 28.5 C38 28.5 43 32.5 43 37 C43 41.5 38 45.5 32 45.5 S21 41.5 21 37 C21 32.5 26 28.5 32 28.5 Z"/>'
        + '<path class="stk-line" d="M27 37 h10 M29.5 33.8 v6.4 M32 33 v8 M34.5 33.8 v6.4" style="stroke-width:1.8"/>',

    /* LA COPPA. Due anse, stelo e base — un trofeo, non un calice. La stella in
       negativo evita che la coppa sia una macchia scura. */
    trophy: '<path class="stk-glyph" d="M20 13 h24 v11 c0 8.5 -5.5 14 -12 14 s-12 -5.5 -12 -14 Z"/>'
        + '<path class="stk-line" d="M20 16.5 h-5.5 v4.5 c0 5 3 8 7 8.5 M44 16.5 h5.5 v4.5 c0 5 -3 8 -7 8.5"/>'
        + '<path class="stk-glyph" d="M29 38 h6 v7 h-6 Z M21 45 h22 v6 H21 Z"/>'
        + '<path class="stk-lace" style="stroke:none;fill:var(--stk-paint)"'
        + ' d="M32 17 l2.6 5.4 l5.9 .8 l-4.3 4.2 l1 5.9 l-5.2 -2.8 l-5.2 2.8 l1 -5.9 l-4.3 -4.2 l5.9 -.8 Z"/>',

    /* IL CASCO. Calotta, nuca che scende a destra e GRIGLIA che sporge in avanti
       a sinistra: senza la griglia un casco di profilo è una cupola qualsiasi.
       La gabbia è un anello chiuso e pieno, non due barre a tratto — attaccate
       alla calotta si fondevano con lei e sembravano un graffio. */
    helmet: '<path class="stk-glyph" d="M11.5 33 C11.5 20.5 20.5 11.5 32.5 11.5 C44 11.5 52.5 20.5 52.5 32.5'
        + ' C52.5 41 49 47 42.5 47 C36.5 47 33 43 32.5 38.5 H16 C13 37.5 11.5 35.5 11.5 33 Z"/>'
        + '<path class="stk-glyph" d="M13.5 39.5 C9.5 42.5 10 48.5 14.5 51 H31.5 C34 51 34.5 47.5 32 47 H17.5'
        + ' C15.5 46 15 43 17 41.5 Z"/>'
        + '<circle class="stk-lace" cx="33.5" cy="28.5" r="4.4" style="stroke:none;fill:var(--stk-paint)"/>',

    /* IL MAGLIONE. Michigan dà un adesivo col maglione da universitario a chi si
       guadagna la lettera. Sul petto una stella e non lo scudetto: a 20px lo
       scudetto dentro la maglia diventa un rettangolo scuro. */
    jersey: '<path class="stk-glyph" d="M25 13 L32 17 L39 13 L50 18 L46.5 29 L42 26.5 V51 H22 V26.5 L17.5 29 L14 18 Z"/>'
        + '<path class="stk-lace" d="M26.5 13.5 C28 18 36 18 37.5 13.5" style="stroke-width:2.8"/>'
        + '<path class="stk-lace" style="stroke:none;fill:var(--stk-paint)"'
        + ' d="M32 27 l2.7 5.5 l6.1 .9 l-4.4 4.3 l1 6 l-5.4 -2.9 l-5.4 2.9 l1 -6 l-4.4 -4.3 l6.1 -.9 Z"/>',

    /* IL PALLONE. Punte vere e pancia larga: è la sagoma a farlo leggere
       «football» e non «mandorla». I lacci sono l'unico dettaglio — le fasce
       chiare, che su un pallone vero ci sono, dentro la pancia a 26px
       facevano una pupilla e l'adesivo diventava un occhio. */
    /* Pancia 56×37, cioè 1,5:1 come un pallone vero (28×19 cm). Più stretta
       era una foglia. */
    football: '<path class="stk-glyph" d="M4 32 C9 22 19 13.5 32 13.5 C45 13.5 55 22 60 32'
        + ' C55 42 45 50.5 32 50.5 C19 50.5 9 42 4 32 Z"/>'
        + '<path class="stk-lace" d="M23 32 h18 M26.5 27.5 v9 M32 26.6 v10.8 M37.5 27.5 v9" style="stroke-width:3"/>',

    /* LA BROCCA. Il Little Brown Jug è il trofeo di rivalità più vecchio del
       college football, e sta fra due squadre e basta. Pancia larga e collo
       stretto, o a 20px si legge «tazza». Il pannello chiaro è per scriverci
       sopra chi la tiene, come sull'originale. */
    jug: '<path class="stk-glyph" d="M28 13 h8 v7 c8 3.5 13 10 13 17.5 C49 46 42 51 32 51 S15 46 15 37.5 C15 30 20 23.5 28 20 Z"/>'
        + '<path class="stk-line" d="M48 29 c7 2 7 13 0 15"/>'
        + '<path class="stk-lace" style="stroke:none;fill:var(--stk-paint)" d="M23 33 h18 v10 H23 Z"/>',

    /* LA CINTURA. Quello che si tiene finché non te lo portano via: fascia,
       piastra grande e i buchi sul capo libero. */
    belt: '<path class="stk-glyph" d="M6 26.5 h52 v11 H6 Z"/>'
        + '<path class="stk-glyph" d="M32 17.5 c8.5 0 15 6.2 15 14.5 S40.5 46.5 32 46.5 S17 40.3 17 32 S23.5 17.5 32 17.5 Z"/>'
        + '<circle class="stk-lace" cx="32" cy="32" r="8.4" style="stroke-width:2.4"/>'
        + '<path class="stk-lace" style="stroke:none;fill:var(--stk-paint)"'
        + ' d="M32 26 l1.9 3.9 l4.3 .6 l-3.1 3 l.7 4.3 l-3.8 -2 l-3.8 2 l.7 -4.3 l-3.1 -3 l4.3 -.6 Z"/>'
        + '<circle class="stk-lace" cx="52" cy="32" r="1.8" style="stroke:none;fill:var(--stk-paint)"/>'
        + '<circle class="stk-lace" cx="11" cy="32" r="1.8" style="stroke:none;fill:var(--stk-paint)"/>',

    /* L'ELMETTO DA OPERAIO. Il lavoro sporco, quello che non si vede: cupola,
       cresta e tesa larga. */
    hardhat: '<path class="stk-glyph" d="M17 37 C17 23 22.5 15 32 15 S47 23 47 37 Z"/>'
        + '<path class="stk-glyph" d="M9 37 h46 c1.6 0 2.5 1 2.5 2.6 v3.4 c0 1.6 -1 2.6 -2.6 2.6 H9 c-1.6 0 -2.6 -1 -2.6 -2.6 v-3.4 C6.4 38 7.4 37 9 37 Z"/>'
        + '<path class="stk-lace" d="M32 17 v19 M23.5 21 v16 M40.5 21 v16" style="stroke-width:2.6"/>',

    /* IL CUCCHIAIO DI LEGNO. Dritto e in piccolo si legge «fiammifero»: è
       inclinato perché è così che si disegna un cucchiaio, e la coppa è larga il
       doppio del manico per la stessa ragione. */
    spoon: '<g transform="rotate(-28 32 32)">'
        + '<ellipse class="stk-glyph" cx="32" cy="41" rx="12" ry="9.5"/>'
        + '<path class="stk-glyph" d="M28 11 h8 l-2 22 h-4 Z"/></g>',

    /* IL MARTELLO. Dritto, a 20px, un rettangolo su un'asta si legge «T» — era
       il difetto della versione precedente. Due cose lo salvano: l'inclinazione
       (un martello disegnato dritto non sembra un martello) e la testa
       asimmetrica, penna tonda da una parte e granchio dall'altra. */
    hammer: '<g transform="rotate(32 32 32)">'
        + '<path class="stk-glyph" d="M14 13 h27 c4.5 0 7 3 7 6.5 s-2.5 6.5 -7 6.5 H14 l5 -6.5 Z"/>'
        + '<path class="stk-glyph" d="M27.5 26 h8 v26 h-8 Z"/></g>',

    // ── I glifi geometrici, per le conquiste che un marchio non descrive ──
    crown: '<path class="stk-glyph" d="M18 42 V25 L25.5 32 L32 20 L38.5 32 L46 25 V42 Z"/>',
    rings: '<circle class="stk-line" cx="25.5" cy="32" r="8.5"/><circle class="stk-line" cx="38.5" cy="32" r="8.5"/>',
    laurel: '<path class="stk-line" d="M22 18 C15 26 15 38 22 46 M42 18 C49 26 49 38 42 46"/>'
        + '<circle class="stk-glyph" cx="32" cy="32" r="4.5"/>',
    bolt: '<path class="stk-glyph" d="M35.5 14 L21.5 36 h9 L26 50 L43 28 h-9 L38 14 Z"/>',
    flame: '<path class="stk-glyph" d="M32 13 C37.5 21 44 26.5 44 35.5 A12 12 0 0 1 20 35.5 C20 27.5 27 22 32 13 Z"/>',
    streak: '<path class="stk-line" d="M17 42 L27 32 L33 38 L46 23"/><path class="stk-glyph" d="M47 21 h-9 l9 9 Z"/>',
    couch: '<path class="stk-glyph" d="M21 24 h22 v8 H21 Z M15 33 h34 v8 H15 Z M17 42 h4 v4 h-4 Z M43 42 h4 v4 h-4 Z"/>',
    broom: '<path class="stk-line" d="M42 14 L31 34"/>'
        + '<path class="stk-glyph" d="M25 35 L35 35 L39 50 L19 50 Z"/>',
    target: '<circle class="stk-line" cx="32" cy="32" r="14"/><circle class="stk-line" cx="32" cy="32" r="7.5"/><circle class="stk-glyph" cx="32" cy="32" r="2.8"/>',
    rocket: '<path class="stk-glyph" d="M32 12 C38 18 40 26 40 32 L36 39 H28 L24 32 C24 26 26 18 32 12 Z M24 34 L18 42 L24 42 Z M40 34 L46 42 L40 42 Z M29 41 L32 50 L35 41 Z"/>',
    sun: '<circle class="stk-glyph" cx="32" cy="32" r="7.5"/>'
        + '<path class="stk-line" d="M32 15 v6 M32 43 v6 M15 32 h6 M43 32 h6 M20 20 l4.2 4.2 M39.8 39.8 L44 44 M44 20 l-4.2 4.2 M24.2 39.8 L20 44"/>',
    castle: '<path class="stk-glyph" d="M18 47 V24 h5 v-5 h5 v5 h8 v-5 h5 v5 h5 v23 Z"/>',
};

// Ovale schiacciato come gli sticker Michigan reali, piatto senza bordo
const OVAL = '<ellipse class="stk-oval" cx="48" cy="28" rx="46.5" ry="26.5"/>';

let seq = 0;

const wrap = (inner, extraClass = '') =>
    `<svg class="stk-svg${extraClass}" viewBox="0 0 96 56" aria-hidden="true">${OVAL}${inner}</svg>`;

// Marchio di ICONS (sistema 64×64, centrato su 32,32) piazzato in x,y a scala s
const glyph = (icon, x, y, s) =>
    `<g transform="translate(${x} ${y}) scale(${s}) translate(-32 -32)">${ICONS[icon] || ICONS.laurel}</g>`;

/* Il testo dentro un ovale non ha un box che lo contenga: una parola lunga esce
   dall'adesivo o — sul tracciato curvo — viene TAGLIATA in silenzio dal
   textPath. 0.66em per carattere è la media delle maiuscole di Archivo Black:
   stima per eccesso, che è il verso giusto in cui sbagliare. La misura vera la
   fa `fitStickerTexts()` dopo il disegno. */
const CHAR_W = 0.66;
const fit = (str, maxW, maxSize) =>
    Math.min(maxSize, maxW / Math.max(1, String(str).length * CHAR_W));

const txt = (s, { x = 48, y, size, ls = 0, maxw, cls = '' }) =>
    `<text class="stk-txt ${cls}" data-maxw="${maxw}" x="${x}" y="${y}" text-anchor="middle"`
    + ` style="font-size:${(+size).toFixed(2)}px;letter-spacing:${ls}em">${s}</text>`;

// Spezza un'etichetta in al massimo due righe il più pari possibile
function twoLines(label) {
    const words = String(label).trim().split(/\s+/);
    if (words.length < 2) return [label];
    let best = null;
    for (let i = 1; i < words.length; i++) {
        const a = words.slice(0, i).join(' '), b = words.slice(i).join(' ');
        const score = Math.abs(a.length - b.length);
        if (!best || score < best.score) best = { a, b, score };
    }
    return [best.a, best.b];
}

/**
 * I nove impaginati. Ognuno riceve lo stesso oggetto
 * `{ icon, text, label, word, year }` e ne usa quello che gli serve.
 */
export const COMPOSITIONS = {
    /** logo + numero — il conta-vittorie dei Wolverines (ghiottone + 1000). */
    glyphNum: (d) => {
        if (d.text == null || d.text === '') return COMPOSITIONS.glyphOnly(d);
        const n = String(d.text);
        const long = n.length > 3;
        return wrap(glyph(d.icon, long ? 27 : 31, 28, 0.6)
            + txt(n, { x: long ? 64 : 67, y: 35, size: long ? 17 : 21, maxw: long ? 52 : 46 }));
    },
    /** solo numero — il prefisso telefonico, «(540)». Le parentesi non sono un
     *  vezzo: fanno leggere il numero come un'etichetta e non come un punteggio. */
    numOnly: (d) => wrap(txt(d.word ?? d.text, { y: 38, size: 30, ls: -0.03, maxw: 78 })),
    /** solo testo — «MVP», «RECORD»: una parola che si legge da lontano. */
    textOnly: (d) => {
        const lines = twoLines(d.word ?? d.label ?? '');
        const size = Math.min(22, ...lines.map(l => fit(l, 76, 22)));
        const y0 = lines.length > 1 ? 27 : 36;
        return wrap(lines.map((l, i) => txt(l, { y: y0 + i * (size + 1), size, maxw: 76 })).join(''));
    },
    /** parola + anno — «RAMPAGE 2023»: la conquista e quando. */
    textYear: (d) => wrap(txt(d.word ?? d.label, { y: d.text ? 29 : 36, size: fit(d.word ?? d.label, 76, 19), maxw: 76 })
        + (d.text ? txt(d.text, { y: 44, size: 10, ls: 0.1, maxw: 60, cls: 'stk-txt--sm' }) : '')),
    /** testo curvo + marchio — «GUARDIANS OF VICTORY»: l'impaginato più ricco,
     *  per le cose che contano davvero. L'arco è lungo ~89 unità e quello che
     *  non ci sta viene tagliato senza avvisare, perciò corpo e spaziatura
     *  scendono con la lunghezza invece di restare fissi. */
    arcGlyph: (d) => {
        const id = `stkarc${++seq}`;
        const label = (d.label || '').toUpperCase();
        const ls = label.length <= 10 ? 0.16 : label.length <= 13 ? 0.1 : 0.05;
        const size = Math.min(8, 84 / Math.max(1, label.length * (CHAR_W + ls)));
        return wrap(`<path id="${id}" fill="none" d="M 13 31 A 35 21 0 0 1 83 31"/>`
            + `<text class="stk-txt stk-txt--arc" data-maxw="84" style="font-size:${size.toFixed(2)}px;letter-spacing:${ls}em">`
            + `<textPath href="#${id}" startOffset="50%" text-anchor="middle">${label}</textPath></text>`
            + glyph(d.icon, 48, d.text ? 31 : 33, d.text ? 0.5 : 0.56)
            + (d.text ? txt(d.text, { y: 51, size: 9, ls: 0.1, maxw: 60, cls: 'stk-txt--sm' }) : ''));
    },
    /** etichetta piccola + numerone — «THE GAME / 1001»: il numero è il
     *  protagonista, la riga sopra dice solo di cosa. */
    labelNum: (d) => {
        const label = (d.label || '').toUpperCase();
        return wrap(txt(label, { y: 19, size: Math.min(9, fit(label, 74, 9)), ls: 0.1, maxw: 74, cls: 'stk-txt--sm' })
            + txt(d.text, { y: 45, size: 23, ls: -0.02, maxw: 74 }));
    },
    /** solo marchio — il maglione, il pallone: nessun numero, nessuna parola.
     *  Si riconosce o non si riconosce. */
    glyphOnly: (d) => wrap(glyph(d.icon, 48, 28, 0.78)),
    /** una lettera sola — la «C» del capitano. Per i ruoli, non per i risultati. */
    letter: (d) => wrap(txt(d.word ?? d.text, { y: 43, size: 34, ls: -0.04, maxw: 70 })),
    /** etichetta + marchio + numero — i trofei da scontro diretto (Little Brown
     *  Jug): contro chi, quale trofeo, da quanto. */
    labelGlyphNum: (d) => {
        const label = (d.label || '').toUpperCase();
        return wrap(txt(label, { y: 18, size: Math.min(9, fit(label, 74, 9)), ls: 0.1, maxw: 74, cls: 'stk-txt--sm' })
            + glyph(d.icon, 26, 37, 0.52)
            + txt(d.text, { x: 64, y: 43, size: fit(d.text, 46, 18), maxw: 46 }));
    },
};

/**
 * Sticker ovale di un badge.
 * @param {Object} o
 * @param {string} [o.comp]  - impaginato (vedi COMPOSITIONS); default glyphNum
 * @param {string} [o.icon]  - marchio (vedi ICONS)
 * @param {string} [o.text]  - il numero o l'anno dell'istanza
 * @param {string} [o.label] - etichetta, per arcGlyph / labelNum
 * @param {string} [o.word]  - la parola, per textOnly / textYear / numOnly
 */
export function stickerSVG(o = {}) {
    return (COMPOSITIONS[o.comp] || COMPOSITIONS.glyphNum)(o);
}

/**
 * Stringe le scritte che non ci stanno, misurandole COME STANNO A SCHERMO.
 * Da chiamare dopo aver messo gli sticker nel documento.
 *
 * Serve perché la stima a monte non sa quanto è larga davvero una parola: cambia
 * col carattere e coi caratteri. E un font si scarica quando serve, non quando
 * la pagina apre — se si misura prima che Archivo Black sia arrivato, si misura
 * il ripiego (più stretto) e appena arriva quello vero il testo sfora.
 *
 * @param {Element} root
 */
export function fitStickerTexts(root) {
    if (!root) return;
    const run = () => root.querySelectorAll('text[data-maxw]').forEach(t => {
        const inner = t.querySelector('textPath') || t;
        // sul tracciato il limite è l'arco stesso (che precede il <text>),
        // altrove è la larghezza dichiarata
        const max = inner === t ? +t.dataset.maxw : t.previousElementSibling?.getTotalLength?.() * 0.94;
        if (!max) return;
        // si riparte SEMPRE dal corpo di partenza: senza, un secondo giro
        // lascerebbe il testo rimpicciolito dal primo
        if (!t.dataset.size0) t.dataset.size0 = String(parseFloat(t.style.fontSize) || 8);
        let size = +t.dataset.size0;
        t.style.fontSize = size + 'px';
        for (let i = 0; i < 40 && size > 3.5; i++) {
            const w = inner.getComputedTextLength?.() || 0;
            if (!w || w <= max) break;
            size -= size > 14 ? 0.5 : 0.2;
            t.style.fontSize = size.toFixed(2) + 'px';
        }
    });
    run();
    if (document.fonts?.load) document.fonts.load('400 20px "Archivo Black"').then(run).catch(() => {});
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
 * Unico per tutta la lega, ed è l'unico pezzo che rompe la forma dell'ovale:
 * è giusto che a romperla sia il campione in carica.
 */
export function champStickerSVG() {
    return `<img class="stk-svg stk-champ-img" src="Logos/SB-Champ-sticker.png" alt="" aria-hidden="true"
                 onerror="this.style.display='none'">`;
}
