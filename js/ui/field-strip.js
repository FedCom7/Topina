/**
 * La striscia della partita vera: scorebug, campo in prospettiva, ultima
 * giocata. Sta in cima al "dentro la partita" del Live.
 *
 * Il campo del Live (`field-svg.js`) e' un'altra cosa: e' visto dall'alto con
 * UNA end zone in cima, e ci stanno sopra le figurine della formazione
 * fantasy. Qui serve il contrario — il campo intero da bordo campo, con le due
 * end zone ai lati, su cui far correre la palla. Sono due disegni diversi con
 * due scopi diversi, e provare a farne uno solo li rovinerebbe entrambi.
 *
 * Nessun dato, nessuna fetch: riceve uno stato gia' pronto e restituisce
 * markup. Cosi' si prova da solo, senza una partita in corso.
 *
 * Lo stato:
 *   { home:{abbr,name,logo,color,score}, away:{...},
 *     periodo, orologio, down, distance, possesso: 'home'|'away'|null,
 *     toEZ,                         // yard alla end zone di chi attacca
 *     giocata: { testo, titolo, yards, tipo, toEZ, logo } | null,
 *     stato: 'pre'|'in'|'post' }
 */

/* ── Geometria ───────────────────────────────────────────────────────────
   Il campo e' un trapezio: il lato lontano piu' corto di quello vicino. Ogni
   punto si ottiene interpolando fra i due bordi, cosi' la palla e le linee
   stanno sempre sulla prospettiva senza trasformazioni CSS — che con un SVG
   avrebbero sfocato il testo e reso impossibile ancorarci sopra qualcosa. */
const VB_W = 1000;
// Il riquadro sta cucito addosso al campo: con margini larghi l'SVG si portava
// dietro una settantina di pixel vuoti fra il disegno e l'ultima giocata.
// Quello che esce (i pali, la cima della parabola) resta visibile: la classe
// `.fst-campo` non ritaglia.
// Alto quanto serve a porte e parabola: nel riferimento lo spazio sopra il
// campo non e' vuoto, e' il posto dove vive la giocata.
const VB_H = 327;

const LONTANO = { y: 164, x0: 97, x1: 900 };   // bordo in fondo
const VICINO = { y: 293, x0: 46, x1: 956 };    // bordo davanti
const EZ = 0.115;                             // quota di campo presa da una end zone
// Le linee bianche non toccano i bordi: sul campo vero si fermano prima della
// sideline, e disegnarle da sponda a sponda faceva sembrare il manto una
// griglia invece che un campo.
const LINEA_DA = 0.05;
const LINEA_A = 0.95;
const SPESSORE = 3;

/** Punto del campo: `u` da 0 (end zone sinistra) a 1 (destra), `v` da 0
 *  (fondo) a 1 (davanti). */
function P(u, v) {
    const y = LONTANO.y + (VICINO.y - LONTANO.y) * v;
    const x0 = LONTANO.x0 + (VICINO.x0 - LONTANO.x0) * v;
    const x1 = LONTANO.x1 + (VICINO.x1 - LONTANO.x1) * v;
    return [x0 + (x1 - x0) * u, y];
}

const punto = (u, v) => P(u, v).map(n => n.toFixed(1)).join(',');

/* Gli id di `defs` e `clipPath` vivono nel documento, non nell'SVG che li
   contiene: con due strisce a schermo la seconda ereditava le definizioni
   della prima. Ogni istanza si prende il suo suffisso. */
let nIstanza = 0;
let ID = '0';
const rifId = (nome) => `fst-${nome}-${ID}`;

/** Dalla yard di gioco (0-100, 0 = end zone sinistra) alla coordinata `u`,
 *  tenendo conto che le due end zone occupano una fetta del disegno. */
const uDaYard = (y) => EZ + (Math.max(0, Math.min(100, y)) / 100) * (1 - 2 * EZ);

/**
 * `toEZ` e' relativo a chi attacca ("quanto mi manca alla end zone
 * avversaria"). Qui si passa a una scala assoluta 0-100 con lo zero a
 * sinistra, dove sta sempre l'OSPITE — come sugli scorebug in TV.
 *
 * Di conseguenza: l'ospite difende a sinistra e attacca verso destra, quindi
 * la palla sta a 100 - toEZ; la squadra di casa fa il contrario e sta a toEZ.
 * Invertendo le due, il punt partiva dalla meta' campo sbagliata e volava
 * dalla parte opposta.
 */
function yardAssoluta(toEZ, possesso) {
    if (toEZ == null) return null;
    return possesso === 'away' ? 100 - toEZ : toEZ;
}

/** Da che parte si guadagna terreno: l'ospite verso destra, la casa a sinistra. */
const versoDi = (possesso) => (possesso === 'away' ? 1 : -1);

/* ── Disegno ───────────────────────────────────────────────────────────
   La geometria e' MISURATA sul riferimento, non stimata a occhio: campo
   poco convergente (il bordo lontano e' l'88% del vicino, non il 69%) e
   molto schiacciato (alto il 14% della larghezza, non il 21%). Andare a
   sentimento dava un campo troppo "a imbuto" e troppo alto, che e' la prima
   cosa che si notava nel confronto. */

/** Angoli smussati su un quadrilatero in prospettiva: il campo e' un tappeto,
 *  non un foglio tagliato con la forbice. */
function tappeto(r = 14, mu = 0, mv = 0) {
    const A = P(mu, mv), B = P(1 - mu, mv), C = P(1 - mu, 1 - mv), D = P(mu, 1 - mv);
    const verso = (da, a, q) => [da[0] + (a[0] - da[0]) * q, da[1] + (a[1] - da[1]) * q];
    const q = (p1, p2) => {
        const d = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
        return Math.min(0.5, r / (d || 1));
    };
    const f = (n) => n.map(v => v.toFixed(1)).join(',');
    return `M${f(verso(A, B, q(A, B)))}
            L${f(verso(B, A, q(A, B)))} Q${f(B)} ${f(verso(B, C, q(B, C)))}
            L${f(verso(C, B, q(B, C)))} Q${f(C)} ${f(verso(C, D, q(C, D)))}
            L${f(verso(D, C, q(C, D)))} Q${f(D)} ${f(verso(D, A, q(D, A)))}
            L${f(verso(A, D, q(D, A)))} Q${f(A)} ${f(verso(A, B, q(A, B)))} Z`;
}

/** Il quadrilatero fra due yard: serve alle strisce d'erba e alle end zone. */
function fascia(u0, u1) {
    return `M${punto(u0, 0)} L${punto(u1, 0)} L${punto(u1, 1)} L${punto(u0, 1)} Z`;
}

/** L'inclinazione della yard line a quel punto, in gradi. */
function inclinazione(u) {
    const [xt] = P(u, 0);
    const [xb] = P(u, 1);
    return Math.atan2(xb - xt, VICINO.y - LONTANO.y) * 180 / Math.PI;
}

/** Erba tagliata a strisce larghe, alternate, ben visibili come allo stadio. */
function erba() {
    const out = [`<path d="${fascia(0, 1)}" fill="url(#${rifId('erba')})"/>`];
    for (let y = 0; y < 100; y += 20) {
        out.push(`<path d="${fascia(uDaYard(y), uDaYard(Math.min(100, y + 10)))}"
            fill="#ffffff" opacity="0.1"/>`);
    }
    return out.join('');
}

/** Solo le linee da 10: nel riferimento non c'e' il pettine da 5 in 5. */
function yardLines() {
    const out = [];
    for (let y = 10; y <= 90; y += 10) {
        const u = uDaYard(y);
        const [x1, y1] = P(u, LINEA_DA), [x2, y2] = P(u, LINEA_A);
        out.push(`<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}"
            x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}"
            stroke="rgba(255,255,255,0.8)" stroke-width="${SPESSORE}"/>`);
    }
    return out.join('');
}

/**
 * I numeri sul manto: solo 20 / 50 / 20, grandi, con la freccia verso la end
 * zone piu' vicina. Schiacciati in verticale, perche' un numero dipinto per
 * terra e guardato di sbieco si accorcia — e la prospettiva la fa quella,
 * non la rotazione.
 */
function numeri() {
    const SCHIACCIA = 0.58;
    return [20, 50, 80].map(y => {
        const u = uDaYard(y);
        const [x, yy] = P(u, 0.66);
        const n = y === 50 ? 50 : 20;
        const freccia = y === 50 ? '' : (y < 50 ? -1 : 1);
        const fx = freccia ? x + freccia * 42 : 0;
        return `
        <g transform="translate(${x.toFixed(1)},${yy.toFixed(1)}) scale(1,${SCHIACCIA})">
            <text x="0" y="0" class="fst-num">${n}</text>
        </g>
        ${freccia ? `<path class="fst-freccia" transform="translate(${fx.toFixed(1)},${yy.toFixed(1)})"
            d="M${freccia * 9},0 L${-freccia * 2},-6 L${-freccia * 2},6 Z"/>` : ''}`;
    }).join('');
}

function endZone(lato, colore, logo) {
    const [u0, u1] = lato === 'l' ? [0, EZ] : [1 - EZ, 1];
    const d = fascia(u0, u1);
    const um = (u0 + u1) / 2;
    // Solo il logo, al centro della end zone. La sigla accanto raddoppiava la
    // stessa informazione — sta gia' nello scorebug sopra — e in due lettere
    // larghe quanto la end zone finiva per coprire il logo.
    const [lx, ly] = P(um, 0.5);
    // Sotto va il nero: senza, una squadra dal colore scuro (il verde dei
    // Packers) finiva a filo dell'erba e la end zone spariva.
    const uG = lato === 'l' ? u1 : u0;
    const [gx0, gy0] = P(uG, LINEA_DA), [gx1, gy1] = P(uG, LINEA_A);
    const R = 26;
    return `
    <path d="${d}" fill="#0b0d0f"/>
    <path d="${d}" fill="${colore}"/>
    <path d="${d}" fill="none" stroke="rgba(255,255,255,0.85)" stroke-width="${SPESSORE}"
          stroke-linejoin="round"/>
    <line x1="${gx0.toFixed(1)}" y1="${gy0.toFixed(1)}" x2="${gx1.toFixed(1)}" y2="${gy1.toFixed(1)}"
          stroke="#fff" stroke-width="${SPESSORE}" opacity="0.92"/>
    ${logo ? `<g transform="translate(${lx.toFixed(1)},${ly.toFixed(1)}) scale(1,0.68)">
        <image href="${logo}" x="${-R}" y="${-R}" width="${R * 2}" height="${R * 2}" opacity="0.95"/>
    </g>` : ''}`;
}

/**
 * Le porte, come quelle vere: un palo che sale dietro la linea di fondo,
 * si piega a collo d'oca verso il campo e regge la traversa a sbalzo, da cui
 * partono i due montanti alti. Sono la cosa piu' alta del disegno dopo
 * l'arco, e stanno FUORI dal verde.
 */
function pali(lato) {
    // Il piede sta SUL campo, sulla linea di fondo e a meta' della sua
    // larghezza: nel nostro punto di vista la larghezza del campo e' la
    // profondita', quindi v = 0.5. Prima lo mettevo a v = 0 e la porta
    // restava per aria dietro al disegno invece di poggiare sull'erba.
    const u = lato === 'l' ? 0 : 1;
    const [px, py] = P(u, 0.5);
    const dentro = lato === 'l' ? 1 : -1;   // da che parte sporge la traversa

    const trav = py - 52;                   // quota della traversa
    const collo = 18;                       // sbalzo in avanti
    const semi = 15;                        // mezza traversa
    const su = 76;                          // quanto salgono i montanti

    // La traversa e' parallela alla linea di meta, quindi in prospettiva e'
    // inclinata come lei: orizzontale sembrava incollata sopra al disegno.
    const [gx0, gy0] = P(u, 0), [gx1, gy1] = P(u, 1);
    const len = Math.hypot(gx1 - gx0, gy1 - gy0) || 1;
    const dx = (gx1 - gx0) / len, dy = (gy1 - gy0) / len;

    const cx = px + dentro * collo;   // centro della traversa, a sbalzo
    const ax = cx - semi * dx, ay = trav - semi * dy;   // estremo lontano
    const bx = cx + semi * dx, by = trav + semi * dy;   // estremo vicino
    const f = (n) => n.toFixed(1);

    // Il collo d'oca si piega IN ALTO, dove incontra la traversa: sale dritto
    // dall'erba e solo in cima si sporge in avanti. Curvarlo in basso, dove
    // tocca il campo, e' l'opposto di come sono fatte le porte vere.
    // Il palo non regge la traversa al centro: nel disegno di riferimento si
    // innesta sull'ESTREMO piu' lontano — e' quello dietro, e visto di sbieco
    // finisce li'. Sale dritto dall'erba e si piega solo in cima.
    return `
    <g class="fst-pali">
        <path d="M${f(px)},${f(py)} L${f(px)},${f(ay + 30)}
                 Q${f(px)},${f(ay)} ${f(ax)},${f(ay)}"/>
        <path d="M${f(ax)},${f(ay)} L${f(bx)},${f(by)}"/>
        <path d="M${f(ax)},${f(ay)} L${f(ax)},${f(ay - su)}"/>
        <path d="M${f(bx)},${f(by)} L${f(bx)},${f(by - su)}"/>
    </g>`;
}

/**
 * La giocata. L'arco esce SOPRA il campo — nel riferimento e' la cosa che
 * salta all'occhio, e tenerlo dentro al verde lo faceva sembrare un graffio.
 * Il ritratto sta appeso a un'asta verticale piantata dove la palla e'
 * arrivata, non sospeso a mezz'aria.
 */
/** Un solo nastro: dalla partenza all'arrivo, con la punta nella forma. */
function nastro(g, possesso, corrente) {
    const da = yardAssoluta(g.toEZ, possesso);
    if (da == null) return { svg: '', x1: 0, y1: 0, x2: 0, y2: 0 };
    const yards = Number(g.yards) || 0;
    const a = Math.max(0, Math.min(100, da + yards * versoDi(possesso)));
    const verso = versoDi(possesso);
    const vDa = 0.55;
    const vA = g.lato === 'middle' || !g.lato
        ? 0.55
        : ((g.lato === 'left') === (verso > 0) ? 0.26 : 0.84);

    const incompleto = g.tipo === 'incomplete';
    const calcio = g.tipo === 'fg';
    const aereo = g.tipo === 'pass' || incompleto || calcio;
    const f = (n) => n.toFixed(1);
    const PA = (yard, v, alt) => {
        const [x, y] = P(uDaYard(yard), v);
        return [x, y - alt];
    };

    // Un field goal non finisce sul prato: sale e passa FRA I PALI, che stanno
    // oltre la end zone. L'arrivo e' li', non sulla yard line.
    const fine = calcio ? (verso > 0 ? 100 : 0) : a;
    const vFine = calcio ? 0.5 : vA;

    const HW = 0.055;
    const salto = Math.abs(fine - da);
    const picco = calcio ? Math.max(46, Math.min(96, salto * 1.1))
        : aereo ? Math.max(9, Math.min(36, salto * 0.95)) : 0;
    const N = aereo ? 18 : 2;
    const top = [], bot = [];
    for (let k = 0; k <= N; k++) {
        const t = k / N;
        const yard = da + (fine - da) * t;
        const v = vDa + (vFine - vDa) * t;
        // Il pallone calciato non ricade: passa alto sopra la traversa, quindi
        // la curva sale e resta su invece di chiudersi a parabola.
        const alt = calcio ? picco * Math.sin(t * Math.PI * 0.5) : picco * 4 * t * (1 - t);
        top.push(PA(yard, v + HW, alt));
        bot.push(PA(yard, v - HW, alt));
    }
    const dir = fine === da ? verso : Math.sign(fine - da);
    // Su un incompleto e su un FG sbagliato la palla non e' arrivata: il
    // nastro finisce tronco e a chiudere e' il segno, non una freccia.
    const senzaPunta = incompleto || (calcio && !g.buono);
    const altFine = calcio ? picco : 0;
    const coda = senzaPunta ? [] : [
        PA(fine, vFine + HW * 2.1, altFine),
        PA(fine + dir * 3.4, vFine, altFine),
        PA(fine, vFine - HW * 2.1, altFine),
    ];
    const poly = [...top, ...coda, ...bot.reverse()]
        .map(pt => `${f(pt[0])},${f(pt[1])}`).join(' ');

    const cat = g.segna ? 'sc' : (g.persa || incompleto || (calcio && !g.buono)) ? 'to'
        : yards > 0 ? 'gain' : yards < 0 ? 'loss' : 'none';

    const [x1, y1] = P(uDaYard(da), vDa);
    const [fx, fy] = PA(fine, vFine, altFine);
    // Il nastro cresce DALLA linea di scrimmage: senza un'origine esplicita
    // partiva dal bordo sinistro del suo riquadro e sembrava entrare da fuori.
    const org = `transform-origin:${f(x1)}px ${f(y1)}px;transform-box:view-box`;
    const stato = corrente === null ? '' : corrente ? ' is-cur' : ' is-dim';
    return {
        x1, y1, x2: fx, y2: fy, senzaPunta, calcio, buono: !!g.buono,
        svg: `<g class="fst-nastro" style="${org}">
            <polygon points="${poly}" class="pp-fd-rib pp-fd-${cat}${stato}"/>
            <circle cx="${f(x1)}" cy="${f(y1)}" r="3.2" class="pp-fd-dot pp-fd-${cat}${stato}"/>
        </g>`,
    };
}

/**
 * Il drive intero sul campo: tutte le sue giocate, con quella scelta accesa e
 * le altre smorzate — la stessa lettura del campo di NFL Hub. Cambiando drive
 * si azzera e si riparte, perche' il disegno e' costruito da capo ogni volta.
 */
function tracciaGiocate(lista, corrente, possesso, g) {
    if (!lista?.length) return '';
    const f = (n) => n.toFixed(1);
    const pezzi = lista.map((x, k) => nastro(x, x.possesso || possesso,
        lista.length === 1 ? null : k === corrente));
    const cur = pezzi[corrente] || pezzi[pezzi.length - 1];
    const gCur = lista[corrente] || lista[lista.length - 1];

    // Il segno di chiusura sta solo sulla giocata scelta: su tutte sarebbe un
    // campo pieno di croci.
    let segno = '';
    if (gCur.tipo === 'incomplete') {
        segno = `<g class="fst-x" transform="translate(${f(cur.x2)},${f(cur.y2)})">
            <path d="M-10,-10 L10,10"/><path d="M10,-10 L-10,10"/></g>`;
    } else if (cur.calcio && !cur.buono) {
        // Il calcio sbagliato: una zeta fra i pali, dove sarebbe dovuto passare.
        segno = `<g class="fst-x" transform="translate(${f(cur.x2)},${f(cur.y2)})">
            <path d="M-11,-9 L11,-9 L-11,9 L11,9"/></g>`;
    }

    const da = yardAssoluta(gCur.toEZ, gCur.possesso || possesso);
    const [lx1, ly1] = P(uDaYard(da), LINEA_DA), [lx2, ly2] = P(uDaYard(da), LINEA_A);

    const astaSu = 26;
    const faccia = (x, y, url, n) => !url ? '' : `
        <line class="fst-filo" x1="${f(x)}" y1="${f(y)}" x2="${f(x)}" y2="${f(y - astaSu)}"/>
        <g class="fst-ritratto">
            <circle cx="${f(x)}" cy="${f(y - astaSu - 17)}" r="19" fill="#0e1116"/>
            <clipPath id="${rifId('clip' + n)}"><circle cx="${f(x)}" cy="${f(y - astaSu - 17)}" r="17"/></clipPath>
            <image href="${url}" x="${f(x - 17)}" y="${f(y - astaSu - 34)}"
                   width="34" height="34" clip-path="url(#${rifId('clip' + n)})"
                   preserveAspectRatio="xMidYMid slice"/>
            <circle cx="${f(x)}" cy="${f(y - astaSu - 17)}" r="18" fill="none"
                    stroke="#fff" stroke-width="2.2"/>
        </g>`;
    const distanti = Math.hypot(cur.x2 - cur.x1, cur.y2 - cur.y1) > 46;
    const foto = faccia(cur.x1, cur.y1, gCur.fotoDa, 'a')
        + (distanti ? faccia(cur.x2, cur.y2, gCur.fotoA, 'b') : '');

    return `
    <line class="fst-los-ombra" x1="${f(lx1)}" y1="${f(ly1)}" x2="${f(lx2)}" y2="${f(ly2)}"/>
    <line class="fst-los" x1="${f(lx1)}" y1="${f(ly1)}" x2="${f(lx2)}" y2="${f(ly2)}"/>
    ${pezzi.map(x => x.svg).join('')}
    ${segno}
    ${foto}`;
}

/* ── Markup ──────────────────────────────────────────────────────────── */

const esc = (s) => String(s ?? '').replace(/[&<>"]/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const logoImg = (t) => t.logo
    ? `<img class="fst-logo" src="${esc(t.logo)}" alt="" loading="lazy">`
    : `<span class="fst-logo fst-logo--vuoto">${esc(t.abbr || '')}</span>`;

/** Riga di mezzo dello scorebug: quarto e orologio sopra, situazione sotto. */
function situazione(s) {
    if (s.stato === 'pre') return `<span class="fst-quando">${esc(s.orologio || 'Kickoff')}</span>`;
    if (s.stato === 'post') return '<span class="fst-quando">Final</span>';
    const q = s.periodo ? `${s.periodo}${['st', 'nd', 'rd', 'th'][Math.min(s.periodo, 4) - 1]}` : '';
    const dd = s.down
        ? `${s.down}${['st', 'nd', 'rd', 'th'][Math.min(s.down, 4) - 1]} & ${s.distance ?? 10}`
        : '';
    const dove = s.toEZ != null && s.possesso
        ? ` at ${s.toEZ <= 50 ? esc(s[s.possesso === 'home' ? 'away' : 'home'].abbr) : esc(s[s.possesso].abbr)} ${s.toEZ <= 50 ? s.toEZ : 100 - s.toEZ}`
        : '';
    // Il down & distance sta SOPRA: e' il dato che cambia a ogni giocata ed
    // e' quello che si guarda per primo; l'orologio fa da contorno.
    return `
        ${dd ? `<span class="fst-dd">${esc(dd)}${dove}</span>` : ''}
        <span class="fst-quando">${esc(q)} ${esc(s.orologio || '')}</span>`;
}

/**
 * Punteggio e, sotto, i timeout rimasti: tre trattini, spenti quelli spesi.
 * ESPN li da' solo a partita in corso — senza il dato non si disegnano, che
 * e' meglio che mostrarne tre pieni per finta.
 */
const punteggio = (t, attivo) => `
    <div class="fst-col">
        <span class="fst-score${attivo ? ' is-pos' : ''}">${t.score ?? 0}</span>
        ${Number.isFinite(t.timeouts) ? `<span class="fst-to" aria-label="${t.timeouts} timeouts left">
            ${[0, 1, 2].map(i => `<i${i < t.timeouts ? '' : ' class="is-off"'}></i>`).join('')}
        </span>` : ''}
    </div>`;

export function fieldStripHTML(s) {
    ID = String(++nIstanza);
    const cCasa = s.home.color || 'var(--accent-red)';
    const cOsp = s.away.color || 'var(--accent-blue)';
    const g = s.giocata;
    return `
    <div class="fst" style="--fst-casa:${cCasa};--fst-osp:${cOsp}">
        <div class="fst-bug">
            <div class="fst-lato">
                ${logoImg(s.away)}
                <span class="fst-abbr">${esc(s.away.abbr)}</span>
            </div>
            ${punteggio(s.away, s.possesso === 'away')}
            <div class="fst-mid">${situazione(s)}</div>
            ${punteggio(s.home, s.possesso === 'home')}
            <div class="fst-lato fst-lato--r">
                ${logoImg(s.home)}
                <span class="fst-abbr">${esc(s.home.abbr)}</span>
            </div>
        </div>

        <svg class="fst-campo" viewBox="0 0 ${VB_W} ${VB_H}" preserveAspectRatio="xMidYMid meet"
             role="img" aria-label="Field position">
            <defs>
                <linearGradient id="${rifId('erba')}" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0" stop-color="#285c33"/>
                    <stop offset="0.55" stop-color="#347541"/>
                    <stop offset="1" stop-color="#3c884a"/>
                </linearGradient>
                <!-- La luce dello stadio: batte dal fondo e si spegne verso di
                     noi. Senza, il manto e' una campitura piatta. -->
                <linearGradient id="${rifId('luce')}" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0" stop-color="#ffffff" stop-opacity="0.16"/>
                    <stop offset="0.5" stop-color="#ffffff" stop-opacity="0.02"/>
                    <stop offset="1" stop-color="#000000" stop-opacity="0.22"/>
                </linearGradient>
                <clipPath id="${rifId('taglio')}"><path d="${tappeto()}"/></clipPath>
            </defs>
            <!-- Lo spessore del tappeto: due copie sfalsate sotto, non un
                 rettangolo — cosi' anche il bordo e' arrotondato. -->
            <g transform="translate(0,10)"><path d="${tappeto()}" fill="#122e19"/></g>
            <g transform="translate(0,5)"><path d="${tappeto()}" fill="#193d22"/></g>
            <g clip-path="url(#${rifId('taglio')})">
                ${erba()}
            ${yardLines()}
            ${numeri()}
            ${endZone('l', 'var(--fst-osp)', s.away.logo)}
            ${endZone('r', 'var(--fst-casa)', s.home.logo)}
                <path d="${fascia(EZ, 1 - EZ)}" fill="url(#${rifId('luce')})"/>
            </g>
            <!-- La sideline: una riga dipinta, rientrata come le altre. -->
            <path d="${tappeto(11, 0.012, LINEA_DA)}" fill="none"
                  stroke="rgba(255,255,255,0.8)" stroke-width="${SPESSORE}"/>
            ${pali('l')}
            ${pali('r')}
            ${tracciaGiocate(s.giocate || (g ? [g] : []), s.giocataIdx ?? 0, s.possesso, g)}
        </svg>

        ${s.drives?.length ? `
        <div class="fst-ds">
            ${s.drives.map(d => `<button type="button"
                class="pp-ds-ev pp-fdseg-${d.cls}${d.i === s.driveIdx ? ' is-active' : ''}"
                data-fst-drive="${d.i}" title="${esc(d.team)} · ${esc(d.res)}">${esc(d.tag)}</button>`).join('')}
        </div>` : ''}

        ${s.timeline ? `
        <div class="fst-tl">
            <button class="fst-tl-btn" type="button" data-fst-step="-1" aria-label="Previous play">‹</button>
            <input class="fst-tl-range" type="range" min="0" max="${s.timeline.n - 1}"
                   value="${s.timeline.i}" step="1" data-fst-range
                   aria-label="Play ${s.timeline.i + 1} of ${s.timeline.n}">
            <button class="fst-tl-btn" type="button" data-fst-step="1" aria-label="Next play">›</button>
            <span class="fst-tl-num">${s.timeline.i + 1}/${s.timeline.n}</span>
        </div>` : ''}

        ${g ? `
        <div class="fst-last">
            ${g.logo ? `<img class="fst-last-logo" src="${esc(g.logo)}" alt="" loading="lazy">` : ''}
            <div class="fst-last-txt">
                <span class="fst-last-head">
                    <b>${esc(g.titolo || '')}</b><i>${s.timeline ? 'Selected play' : 'Last play'}</i>
                </span>
                <span class="fst-last-desc">${esc(g.testo || '')}</span>
            </div>
        </div>` : ''}

        ${s.recap?.length ? `
        <details class="fst-recap">
            <summary>All plays <b>${s.recap.length}</b></summary>
            <ol class="fst-recap-list">
                ${s.recap.map(r => `
                <li class="fst-recap-row${r.segna ? ' is-score' : ''}${r.persa ? ' is-turn' : ''}"
                    data-fst-go="${r.i}">
                    <span class="fst-recap-when">${r.periodo ? `Q${r.periodo}` : ''} ${esc(r.clock || '')}</span>
                    <span class="fst-recap-txt"><b>${esc(r.titolo)}</b>${esc(r.testo)}</span>
                </li>`).join('')}
            </ol>
        </details>` : ''}
    </div>`;
}

/**
 * Aggancia timeline e recap. `onScegli(i)` riceve l'indice della giocata
 * scelta; il modulo non sa cosa farne — ridisegnare e' compito di chi lo usa.
 */
/**
 * `onScegli(indiceGiocata, indiceDrive)`: la giocata quando si scorre la
 * timeline o si clicca il recap, il drive quando si tocca una pastiglia.
 */
export function bindFieldStrip(root, onScegli) {
    const fst = root?.querySelector?.('.fst') || root;
    if (!fst) return;
    const range = fst.querySelector('[data-fst-range]');
    if (range) {
        // `input` e non `change`: si vuole vedere il campo muoversi mentre si
        // trascina, non solo quando si lascia.
        range.addEventListener('input', () => onScegli(Number(range.value)));
    }
    fst.querySelectorAll('[data-fst-step]').forEach(b =>
        b.addEventListener('click', () => {
            if (!range) return;
            const v = Number(range.value) + Number(b.dataset.fstStep);
            const max = Number(range.max);
            onScegli(Math.max(0, Math.min(max, v)));
        }));
    fst.querySelectorAll('[data-fst-go]').forEach(li =>
        li.addEventListener('click', () => onScegli(Number(li.dataset.fstGo))));
    fst.querySelectorAll('[data-fst-drive]').forEach(b =>
        b.addEventListener('click', () => onScegli(null, Number(b.dataset.fstDrive))));
}

/**
 * Titolo corto della giocata, quello grande accanto a "Last play":
 * "47-yd Punt", "12-yd Pass", "Touchdown".
 */
export function titoloGiocata(p) {
    if (!p) return '';
    if (p.scoring) return /field goal/i.test(p.type || p.text || '') ? 'Field Goal' : 'Touchdown';
    const y = Number(p.yards) || 0;
    const t = String(p.type || '');
    if (/punt/i.test(t)) return `${Math.abs(y) || ''}-yd Punt`.trim();
    if (/kickoff/i.test(t)) return 'Kickoff';
    if (/field goal/i.test(t)) return /miss/i.test(t) ? 'FG Missed' : 'Field Goal';
    if (/sack/i.test(t)) return 'Sack';
    if (/interception/i.test(t)) return 'Interception';
    if (/fumble/i.test(t)) return 'Fumble';
    if (/incompletion|incomplete/i.test(t)) return 'Incomplete';
    if (/pass/i.test(t)) return `${y}-yd Pass`;
    if (/rush|run/i.test(t)) return `${y}-yd Run`;
    return t || 'Play';
}

/**
 * Dove e' andato il pallone, letto dal referto: "pass short left", "deep
 * right", "up the middle". Il lato serve a metterlo sulla meta' giusta del
 * campo, la profondita' a dare una lunghezza agli incompleti — che di yard
 * ufficiali ne hanno zero, ma un "short" e un "deep" non si somigliano.
 */
export function direzioneGiocata(p) {
    const t = String(p?.text || '');
    return {
        lato: /left/i.test(t) ? 'left' : /right/i.test(t) ? 'right' : 'middle',
        profondita: /deep/i.test(t) ? 'deep' : /short/i.test(t) ? 'short' : 'media',
    };
}

/**
 * Le yard di un calcio stanno nel testo, non nelle statistiche: "punts 50
 * yards", "33 yard field goal". Un punt registrato come giocata da zero yard
 * veniva disegnato come un puntino in mezzo al campo.
 */
export function yardCalcio(p) {
    const t = String(p?.text || '');
    if (!/punts|field goal|kicks/i.test(t)) return null;
    const m = t.match(/(\d+)\s*yards?/i);
    return m ? Number(m[1]) : null;
}

/** Un field goal e' entrato o no: cambia il disegno, non solo il colore. */
export const fgBuono = (p) => /is GOOD/i.test(String(p?.text || ''));

/**
 * L'esito del drive, per la pastiglia: le stesse sigle di NFL Hub. Qui pero'
 * non arriva un campo "result" gia' pronto — va letto dal testo dell'ultima
 * azione vera del drive, e a ordinarle per prime devono essere le cose che
 * chiudono un drive, non le parole che compaiono ovunque.
 */
export function tagDrive(res) {
    const r = (res || '').toLowerCase();
    if (/touchdown/.test(r)) return { l: 'TD', c: 'td' };
    if (/safety/.test(r)) return { l: 'SAF', c: 'td' };
    if (/field goal is good/.test(r)) return { l: 'FG', c: 'fg' };
    if (/field goal is no good|field goal is blocked|missed field goal/.test(r))
        return { l: 'MFG', c: 'to' };
    if (/intercepted/.test(r)) return { l: 'INT', c: 'to' };
    if (/fumble/.test(r) && /recovered by/.test(r)) return { l: 'FUM', c: 'to' };
    if (/punts?/.test(r)) return { l: 'PNT', c: 'punt' };
    if (/on downs/.test(r)) return { l: 'DWN', c: 'to' };
    if (/end game/.test(r)) return { l: 'END', c: 'end' };
    if (/end quarter|two-minute|end of half/.test(r)) return { l: '—', c: 'end' };
    return { l: '—', c: 'end' };
}

/**
 * Le azioni di servizio non dicono com'e' finito un drive: un timeout in coda
 * faceva leggere "OFFI" al posto di "PNT".
 */
export const eDiServizio = (p) => {
    const t = String(p?.text || '').trim();
    // ESPN infila touchdown e trasformazione nella STESSA riga ("...for 1
    // yard, TOUCHDOWN. T.Bass extra point is GOOD"): cercare "extra point"
    // buttava via tutti e sette i touchdown della partita insieme al PAT.
    if (/touchdown|safety/i.test(t)) return false;
    return /timeout|end quarter|two-minute|^game$|extra point|two-point|kicks \d+ yard/i.test(t);
};

/** Quanto lungo disegnare un passaggio che non ha fatto yard. */
export const yardStimate = (prof) => (prof === 'deep' ? 18 : prof === 'short' ? 6 : 11);

/** Che disegno fa la giocata: per aria, per terra, o a vuoto. */
export function tipoGiocata(p) {
    const t = `${p?.type || ''} ${p?.text || ''}`;
    // L'incompleto si riconosce prima di tutto il resto: e' pur sempre un
    // passaggio, e cadendo nel ramo 'pass' avrebbe preso la freccia di arrivo
    // su una palla che a terra non e' mai arrivata.
    if (/incomplet|no good|missed/i.test(t)) return 'incomplete';
    if (/punt|kickoff|field goal|pass|interception/i.test(t)) return 'pass';
    return 'run';
}
