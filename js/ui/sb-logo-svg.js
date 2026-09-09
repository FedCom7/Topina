/**
 * Logo Topina Bowl in numero romano — un template, cinquanta edizioni.
 *
 * ⚠️ NON ANCORA COLLEGATO AL SITO: si guarda solo da preview-sb-logo.html.
 * Quello che il sito mostra oggi resta dov'è: lo sticker ovale di
 * `js/ui/badge-svg.js` nell'hero della pagina squadra, e il PNG
 * `Wallpapers/superbowl_vii_logo.png` sopra il tabellone playoff.
 *
 * ── L'impianto viene dai PNG fatti a mano ────────────────────────────
 * `Superbowl-logo/superbowl_{i,ii,vii}_logo.png` sono loghi veri, ricalcati su
 * quelli NFL. Da lì viene la forma, e si tiene:
 *
 *     - il numero romano è SPACCATO attorno al trofeo (VII → «V | II»);
 *     - il trofeo sta in mezzo, più alto delle lettere, e scende dietro la
 *       targa che chiude il logo in basso;
 *     - dentro le lettere ci sta una SCENA, con il bordo in metallo;
 *     - la targa dice TOPINA BOWL.
 *
 * ── Le tre regole di composizione ────────────────────────────────────
 * 1. **Il blocco è centrato, il trofeo no.** Con un numero dispari i due
 *    bracci sono diversi (III fa «I | II») e tenere il trofeo al centro
 *    spingeva tutto a destra lasciando un buco a sinistra. Ora si centra
 *    l'INSIEME e il trofeo scivola dove capita — fino a 80 unità fuori asse.
 *    Effetto secondario che vale da solo: il braccio corto non spreca più la
 *    sua metà di tela, quindi il numero può crescere (la III passa da corpo
 *    279 a 377, +35%).
 * 2. **Il numero non esce mai dalla targa.** Non si stringe il numero: si
 *    allarga la targa, che infatti non ha una larghezza sua ma la prende dal
 *    numero. Verificato per misura su tutte le edizioni, non a occhio.
 * 3. **Le lettere arrivano alla base del pallone.** Misurato sul PNG VII:
 *    l'altezza delle maiuscole è il 50% dell'altezza totale del logo. Quando
 *    la larghezza non permette di arrivarci — succede coi numeri larghi — le
 *    lettere si ALLUNGANO in verticale (`stretch`, massimo 1.45). È una
 *    licenza da lockup, non un difetto: il carattere del PNG è più stretto di
 *    Archivo Black e senza allungamento i numeri restano bassi.
 *
 * ── Cinquanta edizioni, otto caratteri, una città a testa ────────────
 * Ogni edizione è una LOCALITÀ americana, resa dal paesaggio dentro le lettere
 * e dai suoi colori: le palme di Miami, le montagne di Denver, il ponte di San
 * Francisco, l'arco di St. Louis. La città non è scritta da nessuna parte —
 * come nei loghi veri, il paesaggio la dice senza nominarla.
 *
 * Il carattere cambia a BLOCCHI DI SETTE: I-VII Archivo Black (quello dei
 * PNG), VIII-XIV Anton, XV-XXI Playfair, e così via. Serve a dare un'epoca a
 * ogni gruppo di edizioni invece che un vestito diverso a ognuna.
 * ⚠️ I caratteri dei blocchi 2-7 sono webfont: la riga `<link>` di
 * preview-sb-logo.html va portata in index.html se il logo entra nel sito, se
 * no il browser ripiega e le larghezze qui sotto non corrispondono più.
 *
 * ── Le larghezze sono MISURATE ───────────────────────────────────────
 * `FACES[…].em` e `.cap` vengono da `measureText()` sui caratteri veri, non da
 * una stima. La prima stesura le indovinava e sbagliava del 14% sulla I —
 * proprio la lettera di cui sono fatti II, III, VIII, XIII — e tre edizioni
 * uscivano dalla targa. Se si aggiunge un carattere si misura, non si tira.
 *
 * ── Perché tutto è inline e con id unici ─────────────────────────────
 * Il logo deve poter essere esportato (file .svg, `img`, stampa) e insieme
 * comparire cinquanta volte nella stessa pagina. Nessun colore arriva da
 * main.css, e ogni gradiente/clip prende un prefisso unico (`idPrefix`, se no
 * un contatore): due loghi con lo stesso id di gradiente si rubano il colore a
 * vicenda, vince l'ultimo, e il primo cambia pelle senza motivo apparente.
 */

/* Tela quadrata: il logo sta in un riquadro grande come in una fila di badge
   da 40px, e un quadrato non chiede scelte a chi lo usa. */
const W = 600, H = 600;
const CX = 300;

/* Il trofeo. Le quote della statuetta sono in unità di tela; la fotografia si
   posa sullo stesso riquadro (40 → la targa). */
const FIG = {
    top: 66, headCy: 100, headRx: 24, headRy: 30,
    shoulder: 152, waist: 240, hip: 282, hands: 258,
    hem: 398, pedY: 396, pedW: 66, pedBot: 470,
};

const NUM_BASE = 444;          // la base delle lettere
const NUM_CEIL = 150;          // il tetto: mezzo trofeo, come nel PNG dell'edizione II
/* Il vuoto lasciato al trofeo. Si stringe sui numeri lunghi: la fotografia
   del trofeo, all'altezza delle lettere, è larga circa ±43 in basso e meno in
   alto, quindi un vuoto di 26 le fa passare DIETRO al gambo — che è
   esattamente quello che fanno i PNG — invece di rimpicciolire il numero. */
const gapFor = (roman) => (String(roman).length >= 5 ? 26 : 34);
const GAP = 34;                // il valore di riferimento (numeri corti)

/* Mezza larghezza del trofeo, per forma. Serve a due cose che sembrano una:
   centrare il blocco e dimensionare la targa. Con un numero di UNA lettera
   sola (X, L) il braccio sinistro è vuoto, e se si conta solo l'inchiostro
   delle lettere il trofeo finisce fuori dalla targa — succedeva alla X e alla
   L, che sporgevano di una trentina di unità a sinistra. Il trofeo è parte del
   blocco: va misurato come le lettere.
     photo     la fotografia è larga (452-40)*256/628 ≈ 168
     statue    l'orlo dell'abito, che è il punto più largo (±84)
     monogram  la traversa della T (±96) */
const TROPHY_HALF = { photo: 84, statue: 84, monogram: 96 };
const trophyHalf = (figure) => TROPHY_HALF[figure] || 84;
const MARGIN = 30;             // aria ai lati della tela (serve alla targa per sporgere)
const FS_MAX = 460;
/* La spaziatura è una FRAZIONE del corpo, non 6 unità fisse: su un numero da
   sei lettere il corpo scende a 150 e sei unità fisse diventano il 6% della
   larghezza disponibile, rubata proprio dove non ce n'è. */
const LS_RATIO = .028;
const STRETCH_MAX = 1.45;      // oltre, le lettere diventano di gomma

/* L'altezza a cui puntano le maiuscole: il 50% dell'altezza del logo, misurato
   sul PNG VII (lettere da 0.357 a 0.858 dell'alfa totale). Da qui esce anche
   il fatto che le lettere sfiorano la base del pallone. */
const LOGO_TOP = 40, LOGO_BOT = 524;
const TARGET_CAP = Math.round((LOGO_BOT - LOGO_TOP) * 0.5);   // 242

/* L'avanzamento non è l'inchiostro: V e X sporgono con le diagonali oltre la
   loro cassa. Misurato sul rendering, il debordo sta sotto il 6%. */
const INK = 1.06;

const BAR = { y: 452, h: 72, r: 13 };   // la targa: rettangolo appena smussato,
const BAR_PAD = 15;                     // non una pillola — nei PNG è una targa
const BAR_MIN = 190;                    // avvitata sotto al logo
const SEASON_Y = 566;

let SEQ = 0;

/* ── I caratteri, uno per blocco di sette ────────────────────────────
   `em` sono le larghezze di avanzamento e `cap` l'altezza delle maiuscole,
   entrambe MISURATE con measureText() a corpo 100 sui caratteri veri. Servono
   perché il corpo del numero si decide senza un DOM: il logo si genera anche
   per un file da salvare. Aggiungendo un carattere si rimisura — e le `cap`
   sono molto diverse fra loro (0.688 di Archivo Black contro 0.859 di Anton),
   quindi una costante unica come nella prima stesura sbaglia di brutto. */
const FACES = {
    block: { css: "'Archivo Black',system-ui,sans-serif", weight: 400, cap: .688, em: { I: .389, V: .778, X: .778, L: .667, C: .778, D: .778, M: .944 } },
    anton: { css: "'Anton',system-ui,sans-serif", weight: 400, cap: .859, em: { I: .227, V: .469, X: .484, L: .397, C: .474, D: .493, M: .746 } },
    didone: { css: "'Playfair Display',Georgia,serif", weight: 900, cap: .708, em: { I: .401, V: .693, X: .729, L: .626, C: .717, D: .811, M: .965 } },
    bebas: { css: "'Bebas Neue',system-ui,sans-serif", weight: 400, cap: .700, em: { I: .192, V: .382, X: .406, L: .344, C: .383, D: .406, M: .538 } },
    slab: { css: "'Alfa Slab One',Georgia,serif", weight: 400, cap: .778, em: { I: .420, V: .786, X: .800, L: .653, C: .722, D: .804, M: 1.143 } },
    oswald: { css: "'Oswald',system-ui,sans-serif", weight: 700, cap: .810, em: { I: .301, V: .526, X: .515, L: .443, C: .563, D: .586, M: .704 } },
    bungee: { css: "'Bungee',system-ui,sans-serif", weight: 400, cap: .720, em: { I: .605, V: .730, X: .737, L: .695, C: .628, D: .746, M: .849 } },
    tight: { css: "'Inter Tight',system-ui,sans-serif", weight: 900, cap: .728, em: { I: .268, V: .771, X: .739, L: .548, C: .745, D: .709, M: .908 } },
};

/* L'ordine dei blocchi non è casuale. Il primo è Archivo Black perché è il
   carattere dei PNG fatti a mano, e le prime sette edizioni sono quelle che
   esistono già. Gli altri sono ordinati in base a QUANTO È LUNGO il numero
   romano di quel blocco: XXII-XXVIII e XLIII-XLIX arrivano a sette e sei
   lettere, e vogliono i caratteri stretti (Bebas, Inter Tight); la L da sola
   e le edizioni corte reggono i caratteri larghi (Bungee, Alfa Slab).
   Il numero romano più lungo di ogni blocco:
       1 (I-VII)      3 lettere      5 (XXIX-XXXV)    6
       2 (VIII-XIV)   4              6 (XXXVI-XLII)   7  ← XXXVIII
       3 (XV-XXI)     3              7 (XLIII-XLIX)   6
       4 (XXII-XXVIII) 6             8 (L)            1
   I blocchi da 6-7 lettere prendono i caratteri stretti (Bebas, Oswald,
   Anton, Inter Tight), quelli corti i larghi (Alfa Slab, Bungee). Con Bungee
   sulle sei lettere di XLVIII il numero veniva alto 111 unità invece di 242:
   leggibile sì, ma la metà di tutti gli altri. */
const FACE_BLOCKS = ['block', 'didone', 'slab', 'bebas', 'oswald', 'anton', 'tight', 'bungee'];
const BLOCK_SIZE = 7;

/* ── I caratteri sul SITO ────────────────────────────────────────────
   Il banco li carica tutti e otto in una riga di <link>. Il sito no, e non
   deve: sono famiglie da display che servono a un logo che compare una volta
   l'anno. Quindi si caricano su richiesta, uno alla volta, quando quel logo
   viene davvero disegnato.

   ⚠️ Archivo Black è l'eccezione e sta in index.html a monte: lo usa il campo
   del Game Center per i numeri delle iarde, cioè OGNI partita. Fino al
   2026-09-08 non era caricato affatto: il campo e i numeri romani ripiegavano
   su un carattere di sistema, più stretto e molto più leggero — la V misurava
   0.722 invece di 0.778. E siccome le larghezze in FACES sono MISURATE su
   quei caratteri, con un ripiego saltano anche i conti: larghezza della targa,
   centratura, «il numero non esce mai». Un carattere che non arriva qui non è
   un dettaglio estetico. */
const FACE_WEB = {
    anton: 'Anton', didone: 'Playfair+Display:wght@900', bebas: 'Bebas+Neue',
    slab: 'Alfa+Slab+One', oswald: 'Oswald:wght@700', bungee: 'Bungee',
};
const chiesti = new Set();

/** Carica il webfont di un carattere di blocco, una volta sola. */
export function ensureFaceFont(face) {
    const fam = FACE_WEB[face];
    if (!fam || chiesti.has(face) || typeof document === 'undefined') return;
    chiesti.add(face);
    const l = document.createElement('link');
    l.rel = 'stylesheet';
    l.href = `https://fonts.googleapis.com/css2?family=${fam}&display=swap`;
    document.head.appendChild(l);
}

/** Il carattere di un'edizione: cambia ogni sette. */
export function faceFor(edition) {
    const i = Math.floor((Math.max(1, Number(edition) || 1) - 1) / BLOCK_SIZE);
    return FACE_BLOCKS[i % FACE_BLOCKS.length];
}
/** Che blocco è: 1, 2, 3… Serve al banco per dirlo a schermo. */
export function blockFor(edition) {
    return Math.floor((Math.max(1, Number(edition) || 1) - 1) / BLOCK_SIZE) + 1;
}

export const SB_DEFAULT = {
    face: 'block',          // vedi FACES — di norma lo decide il blocco
    scene: 'metal',         // vedi SCENES — cosa riempie le lettere
    motif: 'none',          // vedi MOTIFS — il paesaggio della città
    accent: '#3f6fb5',      // il colore dell'anno (tinta alta della scena)
    accent2: '#dbe4ee',     // la tinta bassa: le scene sono sfumature verticali
    metal: '#dfe5ec',       // bordo delle lettere e targa
    statue: '#e3b23c',      // il metallo del trofeo, quando è disegnato
    barInk: '#1d4f86',      // la scritta sulla targa
    wordmark: 'TOPINA BOWL',
    figure: 'photo',        // vedi FIGURES — quale trofeo
    rim: 'single',          // vedi RIMS — il bordo delle lettere
    relief: false,          // luce SVG vera sulla figura disegnata
    emblem: false,          // l'emblema sul piedistallo
    season: false,          // la riga "TOPINA LEAGUE · anno" sotto la targa
    photoHref: 'Superbowl-logo/lombardi.webp',
    city: '',               // solo etichetta: non si scrive mai nel logo
};

/* ── Le cinquanta edizioni ───────────────────────────────────────────
   Una località americana a testa, resa dal paesaggio e dai suoi colori. Le
   edizioni II, IV e VII hanno lo sfondo che c'era già e non si toccano.

   Il formato è compatto apposta: [città, scena, motivo, alto, basso]. Una
   edizione che ridichiara tutto smette di essere una variante e diventa un
   secondo template travestito — il resto lo mette SB_DEFAULT. */
const CITIES = {
    1: ['Los Angeles', 'sunset', 'palms', '#c94f2c', '#f2c14e'],
    2: ['Denver', 'ice', 'peaks', '#5d7f9e', '#e8eef5'],
    3: ['New York', 'night', 'skyline', '#101a3a', '#4a5fa8'],
    4: ['Chicago', 'sunset', 'skyline', '#8e2b2b', '#e8a33d'],
    5: ['Green Bay', 'field', 'pines', '#1f5c33', '#7fb069'],
    6: ['Seattle', 'storm', 'needle', '#41566b', '#c8d6e0'],
    7: ['Miami', 'sunset', 'palms', '#c2372f', '#f0a836'],
    8: ['San Francisco', 'dusk', 'bridge', '#7a2f4a', '#efa06a'],
    9: ['St. Louis', 'metal', 'arch', '#4a5a72', '#dfe6ee'],
    10: ['Phoenix', 'desert', 'cactus', '#a4471f', '#f0c479'],
    11: ['San Diego', 'sea', 'waves', '#155e7a', '#8fd0d8'],
    12: ['Boston', 'storm', 'lighthouse', '#2f4560', '#b9c9d6'],
    13: ['Dallas', 'night', 'stars', '#10203f', '#4f6ea8'],
    14: ['Las Vegas', 'night', 'buttes', '#2a1440', '#b4569a'],
    15: ['Washington', 'metal', 'dome', '#3f5b86', '#e4ebf3'],
    16: ['Buffalo', 'ice', 'snow', '#4a6b86', '#f2f6fa'],
    17: ['Kansas City', 'autumn', 'silos', '#8a3b18', '#eab54a'],
    18: ['Baltimore', 'storm', 'harbor', '#33465c', '#a9bcc9'],
    19: ['New Orleans', 'dusk', 'dome', '#5a2a5e', '#e8a75f'],
    20: ['Minneapolis', 'ice', 'pines', '#3c6072', '#dfeaef'],
    21: ['Houston', 'sunset', 'skyline', '#a83b23', '#f0b45a'],
    22: ['Atlanta', 'forest', 'skyline', '#1d4b34', '#8fbf7a'],
    23: ['Detroit', 'metal', 'skyline', '#4c5666', '#dde3ea'],
    24: ['Pittsburgh', 'storm', 'bridge', '#38414f', '#c2c9d2'],
    25: ['Philadelphia', 'autumn', 'dome', '#7d3a1c', '#e6b459'],
    26: ['Nashville', 'dusk', 'skyline', '#5d2f63', '#e79a63'],
    27: ['Salt Lake City', 'ice', 'peaks', '#4f7391', '#eef3f8'],
    28: ['Portland', 'forest', 'pines', '#1b4a3a', '#82b98e'],
    29: ['Honolulu', 'sea', 'waves', '#0f6a80', '#93dbcf'],
    30: ['Tampa', 'sunset', 'palms', '#b8402c', '#f3bd57'],
    31: ['Cleveland', 'storm', 'harbor', '#3a4a58', '#b0c0cb'],
    32: ['Indianapolis', 'autumn', 'silos', '#8c4a17', '#efc063'],
    33: ['Charlotte', 'forest', 'skyline', '#215239', '#93c286'],
    34: ['Jacksonville', 'sea', 'lighthouse', '#166276', '#8fcfd6'],
    35: ['Cincinnati', 'autumn', 'bridge', '#93481b', '#eeb85a'],
    36: ['Tucson', 'desert', 'cactus', '#9c3f24', '#f0cb8a'],
    37: ['Anchorage', 'ice', 'peaks', '#41637f', '#f4f8fb'],
    38: ['Austin', 'sunset', 'stars', '#a53a3a', '#f2bb62'],
    39: ['Memphis', 'dusk', 'bridge', '#63305c', '#e9a06b'],
    40: ['Milwaukee', 'ice', 'harbor', '#41667e', '#e2edf2'],
    41: ['Sacramento', 'field', 'silos', '#2b6238', '#a9cf7d'],
    42: ['Albuquerque', 'desert', 'buttes', '#9a4423', '#f1c785'],
    43: ['Charleston', 'sea', 'lighthouse', '#14657c', '#96d3d6'],
    44: ['Boise', 'desert', 'peaks', '#8f5326', '#eecb92'],
    45: ['Louisville', 'autumn', 'skyline', '#87401b', '#e9bb5e'],
    46: ['Providence', 'storm', 'lighthouse', '#354a60', '#b6c6d3'],
    47: ['Omaha', 'field', 'silos', '#2f6535', '#b3d484'],
    48: ['Reno', 'night', 'buttes', '#1d2a4a', '#5f7ab4'],
    49: ['Norfolk', 'sea', 'harbor', '#125f74', '#8ecbd2'],
    50: ['Los Angeles', 'metal', 'palms', '#b08129', '#f6e2a6'],
};

export const SB_EDITIONS = Object.fromEntries(Object.entries(CITIES).map(
    ([n, [city, scene, motif, accent, accent2]]) => [n, {
        year: 2018 + Number(n), city, scene, motif, accent, accent2,
    }]));

export const SCENES = ['metal', 'sunset', 'ice', 'night', 'field', 'sea', 'desert', 'forest', 'dusk', 'autumn', 'storm', 'solid'];
export const MOTIFS = ['none', 'palms', 'peaks', 'skyline', 'stars', 'yardlines', 'bridge', 'arch',
    'cactus', 'waves', 'pines', 'needle', 'buttes', 'dome', 'lighthouse', 'snow', 'silos', 'harbor'];
export const FACE_LIST = Object.keys(FACES);
export const FIGURES = ['photo', 'statue', 'monogram'];
export const RIMS = ['single', 'none', 'double'];
export const LAST_EDITION = 50;

/* ── Numeri romani ───────────────────────────────────────────────────
   Si ferma a 3999 come la notazione classica; sopra non esiste una forma
   giusta, e una lega arrivata a quel Topina Bowl avrà altri problemi. */
export function toRoman(n) {
    const vals = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'],
    [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
    let out = '', v = Math.floor(Number(n) || 0);
    for (const [q, s] of vals) { while (v >= q) { out += s; v -= q; } }
    return out;
}

/** 2019 → 1. La prima stagione della lega è il Topina Bowl I. */
export function sbEdition(year) { return Number(year) - 2018; }
/** 1 → 2019. L'inversa, per le etichette. */
export function sbYear(edition) { return Number(edition) + 2018; }

/** Il tema: default + carattere del blocco + scarti dell'anno + di chi chiama. */
export function sbTheme(edition, override = {}) {
    return {
        ...SB_DEFAULT,
        face: faceFor(edition),
        ...(SB_EDITIONS[edition] || {}),
        ...override,
    };
}

const esc = (s) => String(s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
const r1 = (n) => Math.round(n * 10) / 10;

/* Schiarisce (k>0) o scurisce (k<0) un hex, senza portarsi dietro una libreria
   di colore. */
function shade(hex, k) {
    const m = /^#?([\da-f]{6})$/i.exec(String(hex));
    if (!m) return hex;
    const n = parseInt(m[1], 16);
    const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
        const v = k >= 0 ? c + (255 - c) * k : c * (1 + k);
        return Math.max(0, Math.min(255, Math.round(v)));
    });
    return '#' + ch.map((c) => c.toString(16).padStart(2, '0')).join('');
}

/* ── Spaccare il numero attorno al trofeo ────────────────────────────
   Metà lettere a sinistra, metà a destra, il trofeo nel mezzo. Con un numero
   dispari la parte lunga va a DESTRA (VII → «V | II», come il PNG).

   L'unico caso speciale è l'edizione I: una I sola È il gambo del trofeo, e
   infatti nel PNG del 2019 il numero non c'è affatto. Vale SOLO per la I —
   una V o una X da sole si scrivono, a destra del trofeo: sarebbero un logo
   senza edizione. */
export function splitRoman(roman) {
    const s = String(roman);
    if (s === 'I') return ['', ''];
    if (s.length === 1) return ['', s];
    const cut = Math.floor(s.length / 2);
    return [s.slice(0, cut), s.slice(cut)];
}

/* Larghezza in em di un pezzo di numero (senza spaziatura). INK perché
   l'avanzamento non è l'inchiostro: V e X sporgono con le diagonali. */
function emOf(s, faceKey) {
    const em = FACES[faceKey].em;
    let w = 0;
    for (const c of s) w += (em[c] || .8) * INK;
    return w;
}
const partWidth = (s, faceKey, fs, ls) => s ? emOf(s, faceKey) * fs + ls * Math.max(0, s.length - 1) : 0;

/* ── Quanto è grande il numero, e quanto si allunga ──────────────────
   Due vincoli e una licenza:
     - LARGHEZZA: il blocco intero (braccio + vuoto + trofeo + vuoto + braccio)
       deve stare nella tela meno i margini. È un vincolo sull'INSIEME, non su
       ciascuna metà — ed è quello che permette alla III un numero grande
       invece di sprecare la mezza tela del braccio corto (corpo 279 → 377).
     - TETTO: le lettere non salgono sopra mezzo trofeo.
     - STRETCH: se è stata la larghezza a fermarle sotto l'altezza voluta, le
       lettere si allungano in verticale fino a TARGET_CAP. Il carattere dei
       PNG è più stretto di Archivo Black: senza allungamento i numeri larghi
       restano bassi, ed è il difetto che si vedeva confrontando VII con II. */
function numeralMetrics(parts, faceKey, tHalf) {
    const cap = FACES[faceKey].cap;
    const gap = gapFor(parts[0] + parts[1]);
    const room = 2 * (CX - MARGIN) - 2 * gap;
    const em = emOf(parts[0], faceKey) + emOf(parts[1], faceKey);
    // gli spazi scalano col corpo, quindi entrano nella stessa incognita
    const gaps = Math.max(0, parts[0].length - 1) + Math.max(0, parts[1].length - 1);

    let fs = em > 0 ? room / (em + LS_RATIO * gaps) : FS_MAX;
    fs = Math.max(70, Math.floor(Math.min(FS_MAX, fs, (NUM_BASE - NUM_CEIL) / cap)));

    const natCap = fs * cap;
    const stretch = Math.max(1, Math.min(STRETCH_MAX, Math.min(TARGET_CAP, NUM_BASE - NUM_CEIL) / natCap));
    const capH = natCap * stretch;

    const ls = Math.max(3, r1(fs * LS_RATIO));
    const wL = partWidth(parts[0], faceKey, fs, ls), wR = partWidth(parts[1], faceKey, fs, ls);

    /* Quanto sporge il blocco da una parte e dall'altra del trofeo. Da ogni
       lato vince il più largo fra il braccio e il trofeo stesso: dove il
       braccio non c'è, il bordo del blocco è il trofeo. */
    const armL = Math.max(gap + wL, tHalf), armR = Math.max(gap + wR, tHalf);
    /* Il trofeo scivola di metà differenza, così il BLOCCO resta centrato
       sulla tela anche quando il trofeo non lo è. */
    return {
        fs, stretch, capH, top: NUM_BASE - capH, wL, wR, ls, gap,
        dx: r1(-(armR - armL) / 2), half: r1((armL + armR) / 2),
    };
}

/* ── Le scene ────────────────────────────────────────────────────────
   Sfumature verticali su due tinte dell'anno. Verticali e non oblique per lo
   stesso motivo dei PNG: le lettere sono colonne strette e alte, e una
   sfumatura obliqua dentro una colonna sembra una macchia. */
function sceneFill(t, id, top) {
    const a = t.accent, b = t.accent2;
    const stops = {
        sunset: [[0, shade(a, -.12)], [.52, a], [1, b]],
        ice: [[0, shade(a, -.15)], [.6, b], [1, '#ffffff']],
        night: [[0, shade(a, -.35)], [.7, a], [1, b]],
        field: [[0, shade(a, -.2)], [.5, a], [1, b]],
        sea: [[0, shade(a, -.3)], [.45, a], [1, b]],
        desert: [[0, shade(a, -.1)], [.5, a], [1, b]],
        forest: [[0, shade(a, -.3)], [.55, a], [1, b]],
        dusk: [[0, shade(a, -.25)], [.45, a], [.8, shade(b, -.1)], [1, b]],
        autumn: [[0, shade(a, -.15)], [.5, a], [1, b]],
        storm: [[0, shade(a, -.3)], [.5, a], [1, b]],
        metal: [[0, shade(b, .5)], [.32, b], [.5, shade(a, -.1)], [.68, b], [1, shade(b, .4)]],
        solid: [[0, a], [1, a]],
    }[t.scene] || [[0, a], [1, b]];
    return `<linearGradient id="${id}-scene" x1="0" y1="${r1(top)}" x2="0" y2="${NUM_BASE}"`
        + ` gradientUnits="userSpaceOnUse">`
        + stops.map(([o, c]) => `<stop offset="${o}" stop-color="${c}"/>`).join('')
        + `</linearGradient>`;
}

/* ── I paesaggi ──────────────────────────────────────────────────────
   Vivono DENTRO il ritaglio delle lettere, come le palme del PNG VII e le
   montagne del II: fuori dalle lettere non si vede niente. Perciò si disegnano
   larghi su tutta la fascia — è il ritaglio a farli comparire solo dove
   servono, ed è anche il motivo per cui lo stesso paesaggio cambia aspetto se
   cambia il numero romano dell'anno.

   Sono silhouette, mai disegni: a 32px sopravvive la massa, non il dettaglio.
   Ognuno è deterministico — niente Math.random, se no il logo cambierebbe a
   ogni ridisegno della pagina. */
function motifArt(t, top) {
    const ink = shade(t.accent, -.45);
    const y1 = NUM_BASE, span = y1 - top;
    const star = (x, y, r) => {
        const pts = Array.from({ length: 10 }, (_, i) => {
            const rr = i % 2 ? r * .44 : r;
            const a = (-90 + i * 36) * Math.PI / 180;
            return `${r1(x + Math.cos(a) * rr)},${r1(y + Math.sin(a) * rr)}`;
        }).join(' ');
        return `<polygon points="${pts}"/>`;
    };
    const ridge = (n, hi, lo) => {
        const step = W / n;
        let d = `M-10 ${r1(y1)}`;
        for (let i = 0; i <= n; i++) {
            const k = (i * 7 % 5) / 4;                 // alternanza fissa, non casuale
            const h = lo + (hi - lo) * k;
            d += ` L${r1(i * step - step / 2)} ${r1(y1 - h * .45)} L${r1(i * step)} ${r1(y1 - h)}`;
        }
        return d + ` L${W + 10} ${r1(y1)} Z`;
    };

    switch (t.motif) {
        case 'palms': {
            const palm = (x, h, k) => {
                const ty = y1 - h;
                const leaf = (dx, dy) =>
                    `<path d="M${x} ${r1(ty)} Q${r1(x + dx * .5)} ${r1(ty - 30 * k)} ${r1(x + dx)} ${r1(ty + dy)}"/>`;
                return `<g opacity=".85">`
                    + `<path d="M${r1(x - 7 * k)} ${y1} Q${r1(x - 3 * k)} ${r1(ty + h * .4)} ${r1(x - 2.5 * k)} ${r1(ty)}`
                    + ` L${r1(x + 2.5 * k)} ${r1(ty)} Q${r1(x + 5 * k)} ${r1(ty + h * .4)} ${r1(x + 7 * k)} ${y1} Z" fill="${ink}"/>`
                    + `<g fill="none" stroke="${ink}" stroke-width="${r1(7 * k)}" stroke-linecap="round">`
                    + leaf(-42 * k, 22) + leaf(42 * k, 22) + leaf(-30 * k, 46) + leaf(30 * k, 46)
                    + leaf(-10 * k, 54) + leaf(10 * k, 54) + `</g></g>`;
            };
            return palm(92, span * .62, 1) + palm(198, span * .48, .82)
                + palm(402, span * .48, .82) + palm(508, span * .62, 1);
        }
        case 'peaks':
            return `<path d="${ridge(9, span * .92, span * .5)}" fill="${shade(t.accent, -.15)}" opacity=".75"/>`
                + `<path d="${ridge(7, span * .72, span * .34)}" fill="${ink}" opacity=".85"/>`;
        case 'skyline': {
            const towers = [[10, .62], [52, .42], [92, .82], [138, .52], [180, .70], [228, .38],
            [352, .50], [396, .76], [444, .46], [486, .68], [534, .36]];
            return `<g fill="${ink}" opacity=".82">`
                + towers.map(([x, k]) => `<rect x="${x}" y="${r1(y1 - span * k)}" width="34" height="${r1(span * k)}"/>`).join('')
                + `</g>`;
        }
        case 'stars':
            return `<g fill="#ffffff" opacity=".9">`
                + [[70, .38, 13], [130, .62, 8], [90, .82, 10], [190, .46, 9],
                [410, .55, 9], [470, .34, 13], [512, .68, 8], [440, .86, 10]]
                    .map(([x, k, r]) => star(x, r1(top + span * k), r)).join('') + `</g>`;
        case 'yardlines': {
            const rows = [];
            for (let i = 0; i < 7; i++) {
                const y = y1 - span * .08 - i * span / 7.5;
                rows.push(`<path d="M0 ${r1(y)} H600" stroke="#ffffff" stroke-width="${r1(4 - i * .4)}" opacity="${r1(.5 - i * .05)}"/>`);
            }
            return `<g fill="none">${rows.join('')}</g>`;
        }
        case 'bridge': {
            /* Due torri e i cavi che scendono a catenaria: la sagoma del ponte
               sospeso, che è la stessa a San Francisco come a New York. */
            const ty = top + span * .1, deck = y1 - span * .22;
            const tower = (x) => `<path d="M${x - 13} ${y1} V${r1(ty)} h26 V${y1} Z"/>`
                + `<rect x="${x - 24}" y="${r1(ty + span * .16)}" width="48" height="${r1(span * .07)}"/>`
                + `<rect x="${x - 24}" y="${r1(ty + span * .36)}" width="48" height="${r1(span * .07)}"/>`;
            const cable = `<path d="M-20 ${r1(deck - span * .1)} Q${r1(150)} ${r1(y1 - span * .12)} 150 ${r1(ty)}`
                + ` M150 ${r1(ty)} Q300 ${r1(deck + span * .06)} 450 ${r1(ty)}`
                + ` M450 ${r1(ty)} Q${r1(560)} ${r1(y1 - span * .12)} 620 ${r1(deck - span * .1)}"`
                + ` fill="none" stroke="${ink}" stroke-width="7" opacity=".8"/>`;
            return `<g fill="${ink}" opacity=".85">${tower(150)}${tower(450)}`
                + `<rect x="-10" y="${r1(deck)}" width="620" height="${r1(span * .06)}"/></g>` + cable;
        }
        case 'arch': {
            /* L'arco di St. Louis: due gambe e una curva sola, molto alta. */
            const th = span * .12;
            return `<path d="M110 ${y1} C110 ${r1(top + span * .05)} ${r1(490)} ${r1(top + span * .05)} 490 ${y1}`
                + ` h-${r1(th)} C${r1(490 - th)} ${r1(top + span * .2)} ${r1(110 + th)} ${r1(top + span * .2)} ${r1(110 + th)} ${y1} Z"`
                + ` fill="${ink}" opacity=".85"/>`;
        }
        case 'cactus': {
            const saguaro = (x, h, k) => {
                const ty = y1 - h, w = 15 * k;
                return `<g fill="${ink}" opacity=".85">`
                    + `<rect x="${r1(x - w)}" y="${r1(ty)}" width="${r1(w * 2)}" height="${r1(h)}" rx="${r1(w)}"/>`
                    + `<path d="M${r1(x - w)} ${r1(ty + h * .42)} h-${r1(26 * k)} a${r1(9 * k)} ${r1(9 * k)} 0 0 0 -${r1(9 * k)} ${r1(9 * k)}`
                    + ` v${r1(h * .3)} h${r1(13 * k)} v-${r1(h * .26)} h${r1(22 * k)} Z"/>`
                    + `<path d="M${r1(x + w)} ${r1(ty + h * .55)} h${r1(24 * k)} a${r1(9 * k)} ${r1(9 * k)} 0 0 1 ${r1(9 * k)} ${r1(9 * k)}`
                    + ` v${r1(h * .24)} h-${r1(13 * k)} v-${r1(h * .2)} h-${r1(20 * k)} Z"/></g>`;
            };
            return `<path d="${ridge(5, span * .34, span * .16)}" fill="${ink}" opacity=".45"/>`
                + saguaro(96, span * .7, 1) + saguaro(300, span * .82, 1.1) + saguaro(504, span * .66, .95);
        }
        case 'waves': {
            const rows = [];
            for (let i = 0; i < 5; i++) {
                const y = y1 - span * .1 - i * span * .17, a = 14 - i * 2;
                rows.push(`<path d="M-20 ${r1(y)} q40 ${-a} 80 0 t80 0 t80 0 t80 0 t80 0 t80 0 t80 0 t80 0"`
                    + ` fill="none" stroke="${i % 2 ? '#ffffff' : ink}" stroke-width="${r1(9 - i)}"`
                    + ` opacity="${r1(.75 - i * .1)}" stroke-linecap="round"/>`);
            }
            return rows.join('');
        }
        case 'pines': {
            const pine = (x, h, k) => {
                const ty = y1 - h;
                const tier = (i) => {
                    const yy = ty + h * (.18 + i * .26), w = (16 + i * 13) * k;
                    return `<path d="M${x} ${r1(yy - h * .22)} L${r1(x + w)} ${r1(yy + h * .1)} L${r1(x - w)} ${r1(yy + h * .1)} Z"/>`;
                };
                return `<g fill="${ink}" opacity=".85">${tier(0)}${tier(1)}${tier(2)}`
                    + `<rect x="${r1(x - 4 * k)}" y="${r1(y1 - h * .12)}" width="${r1(8 * k)}" height="${r1(h * .12)}"/></g>`;
            };
            return pine(60, span * .7, 1) + pine(150, span * .9, 1.1) + pine(240, span * .62, .9)
                + pine(360, span * .84, 1.05) + pine(450, span * .66, .95) + pine(540, span * .78, 1);
        }
        case 'needle': {
            /* Lo Space Needle: gambo che si stringe, disco, guglia. */
            const ty = top + span * .08, dy = ty + span * .18;
            return `<g fill="${ink}" opacity=".85">`
                + `<path d="M${CX - 46} ${y1} L${CX - 11} ${r1(dy)} h22 L${CX + 46} ${y1} Z"/>`
                + `<path d="M${CX - 62} ${r1(dy)} q62 ${r1(span * .1)} 124 0 q-30 -${r1(span * .07)} -62 -${r1(span * .07)} q-32 0 -62 ${r1(span * .07)} Z"/>`
                + `<rect x="${CX - 3}" y="${r1(ty)}" width="6" height="${r1(dy - ty)}"/></g>`
                + `<path d="${ridge(6, span * .3, span * .12)}" fill="${ink}" opacity=".35"/>`;
        }
        case 'buttes': {
            /* Mesa: cime PIATTE, ed è quello a distinguerle dalle montagne. */
            const mesa = (x, w, h) => `<path d="M${r1(x - w)} ${y1} L${r1(x - w * .8)} ${r1(y1 - h)}`
                + ` L${r1(x + w * .8)} ${r1(y1 - h)} L${r1(x + w)} ${y1} Z"/>`;
            return `<g fill="${ink}" opacity=".8">${mesa(80, 78, span * .58)}${mesa(300, 96, span * .8)}`
                + `${mesa(520, 84, span * .5)}</g>`
                + `<g fill="${shade(t.accent, -.25)}" opacity=".6">${mesa(190, 60, span * .36)}${mesa(420, 66, span * .42)}</g>`;
        }
        case 'dome': {
            const cy = y1 - span * .28, r = span * .3;
            return `<g fill="${ink}" opacity=".85">`
                + `<rect x="${r1(CX - r * 1.9)}" y="${r1(cy)}" width="${r1(r * 3.8)}" height="${r1(y1 - cy)}"/>`
                + `<path d="M${r1(CX - r)} ${r1(cy)} a${r1(r)} ${r1(r * 1.05)} 0 0 1 ${r1(r * 2)} 0 Z"/>`
                + `<rect x="${CX - 4}" y="${r1(cy - r * 1.42)}" width="8" height="${r1(r * .4)}"/>`
                + `<g opacity=".7">`
                + [-160, -110, 110, 160].map((d) => `<rect x="${r1(CX + d)}" y="${r1(cy + span * .1)}" width="16" height="${r1(y1 - cy - span * .1)}"/>`).join('')
                + `</g></g>`;
        }
        case 'lighthouse': {
            const ty = top + span * .12, base = y1;
            return `<g fill="${ink}" opacity=".85">`
                + `<path d="M${CX - 34} ${base} L${CX - 15} ${r1(ty + span * .16)} h30 L${CX + 34} ${base} Z"/>`
                + `<rect x="${CX - 20}" y="${r1(ty + span * .06)}" width="40" height="${r1(span * .1)}"/>`
                + `<path d="M${CX - 22} ${r1(ty + span * .06)} L${CX} ${r1(ty)} L${CX + 22} ${r1(ty + span * .06)} Z"/></g>`
                + `<g stroke="#ffffff" stroke-width="6" opacity=".45" stroke-linecap="round">`
                + `<path d="M${CX - 30} ${r1(ty + span * .11)} L60 ${r1(ty - span * .02)}"/>`
                + `<path d="M${CX + 30} ${r1(ty + span * .11)} L540 ${r1(ty - span * .02)}"/></g>`
                + `<path d="M-20 ${r1(base - span * .1)} q40 -10 80 0 t80 0 t80 0 t80 0 t80 0 t80 0 t80 0 t80 0"`
                + ` fill="none" stroke="#ffffff" stroke-width="7" opacity=".5"/>`;
        }
        case 'snow': {
            const flake = (x, y, r) => `<g stroke="#ffffff" stroke-width="${r1(r * .22)}" stroke-linecap="round" opacity=".85">`
                + [0, 60, 120].map((a) => `<path d="M${r1(x - Math.cos(a * Math.PI / 180) * r)} ${r1(y - Math.sin(a * Math.PI / 180) * r)}`
                    + ` L${r1(x + Math.cos(a * Math.PI / 180) * r)} ${r1(y + Math.sin(a * Math.PI / 180) * r)}"/>`).join('') + `</g>`;
            return `<path d="M-10 ${y1} q80 -${r1(span * .16)} 160 0 t160 0 t160 0 t160 0 L610 ${y1} Z" fill="#ffffff" opacity=".65"/>`
                + [[70, .28, 17], [180, .5, 12], [300, .22, 14], [420, .48, 11], [520, .3, 16]]
                    .map(([x, k, r]) => flake(x, r1(top + span * k), r)).join('');
        }
        case 'silos': {
            const silo = (x, w, h) => `<g fill="${ink}" opacity=".85">`
                + `<rect x="${r1(x - w)}" y="${r1(y1 - h)}" width="${r1(w * 2)}" height="${r1(h)}"/>`
                + `<path d="M${r1(x - w)} ${r1(y1 - h)} a${r1(w)} ${r1(w * .9)} 0 0 1 ${r1(w * 2)} 0 Z"/></g>`;
            const field = [];
            for (let i = 0; i < 5; i++) {
                const y = y1 - span * .06 - i * span * .07;
                field.push(`<path d="M0 ${r1(y)} H600" stroke="${ink}" stroke-width="3" opacity="${r1(.4 - i * .06)}"/>`);
            }
            return field.join('') + silo(90, 26, span * .62) + silo(150, 26, span * .5)
                + silo(440, 30, span * .7) + silo(505, 26, span * .54);
        }
        case 'harbor': {
            /* Gru portuali: piede, braccio a sbalzo e tirante. */
            const crane = (x, k) => {
                const ty = y1 - span * .72 * k, arm = 96 * k;
                return `<g stroke="${ink}" stroke-width="${r1(9 * k)}" fill="none" opacity=".85" stroke-linecap="round">`
                    + `<path d="M${r1(x - 26 * k)} ${y1} L${r1(x)} ${r1(ty)} L${r1(x + 26 * k)} ${y1}"/>`
                    + `<path d="M${r1(x - arm * .45)} ${r1(ty)} H${r1(x + arm)}"/>`
                    + `<path d="M${r1(x)} ${r1(ty - 40 * k)} L${r1(x + arm)} ${r1(ty)}"/>`
                    + `<path d="M${r1(x)} ${r1(ty)} V${r1(ty - 40 * k)}"/>`
                    + `<path d="M${r1(x + arm * .7)} ${r1(ty)} v${r1(span * .18)}"/></g>`;
            };
            return `<path d="M-10 ${r1(y1 - span * .08)} H610" stroke="#ffffff" stroke-width="6" opacity=".4"/>`
                + crane(70, 1) + crane(250, .82) + crane(430, .95);
        }
        default:
            return '';
    }
}

/* ── Il numero ───────────────────────────────────────────────────────
   Bordo, poi la scena ritagliata dentro le lettere. È così che il PNG ottiene
   le lettere con la fotografia dentro, ed è la ragione per cui la scena si
   disegna larga e poi si taglia: le lettere sono la finestra, non il
   contenitore.

   `rim` decide il bordo. `single` è il default e fa quello che chiede
   l'occhio: UNA fascia di metallo, e il blocco finisce di netto. `double` era
   com'era prima — fascia scura da 18, fascia chiara da 11 e una riga scura in
   cima: tre passate concentriche che a schermo si leggevano come due contorni
   uno dentro l'altro, e il blocco non finiva mai, sfumava. `none` toglie
   tutto: la scena e basta, bordo vivo. */
function numeralArt(roman, t, id) {
    const parts = splitRoman(roman);
    if (!parts[0] && !parts[1]) return { defs: '', node: '', half: trophyHalf(t.figure), dx: 0 };

    const faceKey = FACES[t.face] ? t.face : 'block';
    const f = FACES[faceKey];
    const m = numeralMetrics(parts, faceKey, trophyHalf(t.figure));
    const cx = CX + m.dx;

    /* L'allungamento si applica al singolo <text>, non a un gruppo: lo stesso
       testo va anche dentro la clipPath, e un gruppo là dentro non scalerebbe
       il ritaglio insieme al disegno. */
    const scaleAttr = m.stretch > 1.001
        ? ` transform="translate(0 ${NUM_BASE}) scale(1 ${r1(m.stretch)}) translate(0 ${-NUM_BASE})"` : '';
    const common = `y="${NUM_BASE}" font-family="${f.css}" font-size="${m.fs}"`
        + ` font-weight="${f.weight}" letter-spacing="${m.ls}"${scaleAttr}`;
    const texts = (extra) => [
        parts[0] ? `<text x="${r1(cx - m.gap)}" text-anchor="end" ${common} ${extra}>${esc(parts[0])}</text>` : '',
        parts[1] ? `<text x="${r1(cx + m.gap)}" text-anchor="start" ${common} ${extra}>${esc(parts[1])}</text>` : '',
    ].join('');

    const defs = sceneFill(t, id, m.top) + `<clipPath id="${id}-clip">${texts('')}</clipPath>`;

    const rimW = t.rim === 'double' ? 18 : t.rim === 'none' ? 0 : 13;
    let rim = '';
    if (t.rim === 'double') {
        rim = texts(`fill="none" stroke="${shade(t.metal, -.55)}" stroke-width="18" stroke-linejoin="round"`)
            + texts(`fill="none" stroke="${shade(t.metal, .35)}" stroke-width="11" stroke-linejoin="round"`);
    } else if (t.rim !== 'none') {
        rim = texts(`fill="none" stroke="${t.metal}" stroke-width="13" stroke-linejoin="round"`);
    }

    const node = rim
        + `<g clip-path="url(#${id}-clip)">`
        + `<rect x="0" y="${r1(m.top - 30)}" width="${W}" height="${r1(NUM_BASE - m.top + 50)}" fill="url(#${id}-scene)"/>`
        + motifArt(t, m.top)
        + `</g>`
        + (t.rim === 'double' ? texts(`fill="none" stroke="${shade(t.metal, -.55)}" stroke-width="2.5" stroke-linejoin="round"`) : '');

    /* Quanto sporge il blocco dal centro della TELA: è la misura da cui la
       targa prende la sua larghezza. Comprende il trofeo, non solo le
       lettere. */
    return { defs, node, half: r1(m.half + rimW / 2), dx: m.dx };
}

/* ── Il trofeo ───────────────────────────────────────────────────────
   Tre forme, scelte da `figure`. Sta DAVANTI alle lettere, come nei PNG: si
   disegna dopo il numero, e le lettere che salgono fin lassù gli finiscono
   dietro. `dx` è lo scostamento che tiene centrato il blocco. */

function metalDefs(id, c) {
    return `<linearGradient id="${id}" x1="0" y1="0" x2="1" y2="0">`
        + `<stop offset="0" stop-color="${shade(c, -.45)}"/>`
        + `<stop offset=".16" stop-color="${shade(c, .12)}"/>`
        + `<stop offset=".38" stop-color="${shade(c, .6)}"/>`
        + `<stop offset=".56" stop-color="${c}"/>`
        + `<stop offset=".72" stop-color="${shade(c, -.38)}"/>`
        + `<stop offset=".88" stop-color="${shade(c, -.1)}"/>`
        + `<stop offset="1" stop-color="${shade(c, -.5)}"/></linearGradient>`;
}

/* Luce SVG vera: prende l'alfa della sagoma, la sfoca per ricavarne un rilievo
   (una sagoma sfocata sale al centro e scende ai bordi — la forma di un
   oggetto tornito) e poi calcola diffusa e riflesso con una luce posta nello
   spazio. È ciò che il PNG ha e un vettoriale piatto non ha, ed è l'unica
   strada che funziona anche sul trofeo NOSTRO, di cui una foto non esiste.
   Costa due filtri ricalcolati a ogni ridisegno: knob, non default. */
function reliefDefs(id) {
    return `<filter id="${id}-relief" x="-25%" y="-15%" width="150%" height="130%">`
        + `<feGaussianBlur in="SourceAlpha" stdDeviation="7" result="bump"/>`
        + `<feDiffuseLighting in="bump" surfaceScale="7" diffuseConstant="1.05" lighting-color="#ffffff" result="diff">`
        + `<feDistantLight azimuth="238" elevation="58"/></feDiffuseLighting>`
        + `<feComposite in="diff" in2="SourceAlpha" operator="in" result="diffClip"/>`
        + `<feBlend in="diffClip" in2="SourceGraphic" mode="multiply" result="shaded"/>`
        + `<feSpecularLighting in="bump" surfaceScale="7" specularConstant="1.25" specularExponent="26" lighting-color="#ffffff" result="spec">`
        + `<fePointLight x="196" y="40" z="230"/></feSpecularLighting>`
        + `<feComposite in="spec" in2="SourceAlpha" operator="in" result="specClip"/>`
        + `<feComposite in="specClip" in2="shaded" operator="arithmetic" k1="0" k2="1" k3="1" k4="0"/>`
        + `</filter>`;
}

/* La fotografia: il Lombardi vero, ritagliato da `superbowl_i_logo.png` (dove
   è isolato) e ricompresso — 36 KB contro i 394 del logo intero. È l'unica
   strada che raggiunge il PNG esattamente, per la ragione ovvia che È il PNG.
   Non è parametrica: il colore dell'anno non la tocca, e un .svg salvato su
   disco non se la porta dietro senza base64 inline (+48 KB). */
function photoArt(t) {
    const h = BAR.y - LOGO_TOP, w = r1(h * 256 / 628);
    return `<image href="${esc(t.photoHref)}" x="${r1(CX - w / 2)}" y="${LOGO_TOP}"`
        + ` width="${w}" height="${h}" preserveAspectRatio="xMidYMax meet"/>`;
}

function pedestalArt(t, id) {
    const c = t.statue, dark = shade(c, -.55), w = FIG.pedW, y = FIG.pedY;
    return `<path d="M${CX - w} ${y} L${CX - w - 6} ${FIG.pedBot} L${CX + w + 6} ${FIG.pedBot} L${CX + w} ${y} Z"`
        + ` fill="url(#${id}-fig)" stroke="${dark}" stroke-width="2.5" stroke-linejoin="round"/>`
        + `<ellipse cx="${CX}" cy="${y}" rx="${w}" ry="11" fill="${shade(c, .35)}" stroke="${dark}" stroke-width="2"/>`;
}

/* La statuetta. Nessun volto: i premi non ne hanno, e a questa scala un volto
   diventa una faccina. Tre stesure sono venute un birillo da bowling, e la
   regola che le raddrizza è una sola —

       capelli (40) < spalle (50) < braccia (68) < orlo dell'abito (84)

   Se i capelli sono larghi quanto le spalle, testa e busto diventano un pezzo
   unico; se le braccia stanno dentro il busto, spariscono; se l'abito non si
   apre oltre il piedistallo, resta un cono. Va a pezzi separati, ognuno col
   suo contorno: è il contorno fra l'uno e l'altro a tenerli distinti a
   trenta pixel. */
function statueArt(t, id) {
    const c = t.statue, dark = shade(c, -.55);
    const { headCy: hy, headRx: hr, headRy: hR, shoulder: sh, waist: wa, hip, hands, hem } = FIG;
    const line = (fill) => `fill="${fill}" stroke="${dark}" stroke-width="2.5" stroke-linejoin="round"`;
    const hair = `<ellipse cx="${CX}" cy="${hy + 20}" rx="38" ry="50" ${line(shade(c, -.32))}/>`;
    const neck = `<path d="M${CX - 11} ${hy + hR - 10} h22 v30 h-22 Z" fill="${shade(c, -.2)}"/>`;
    const head = `<ellipse cx="${CX}" cy="${hy}" rx="${hr}" ry="${hR}" ${line(`url(#${id}-fig)`)}/>`;
    const arm = (k) => `<path d="M${CX + k * 47} ${sh + 6}`
        + ` C${CX + k * 62} ${sh + 36} ${CX + k * 60} ${wa - 6} ${CX + k * 34} ${hands + 4}`
        + ` L${CX + k * 22} ${hands - 6}`
        + ` C${CX + k * 42} ${wa - 12} ${CX + k * 45} ${sh + 38} ${CX + k * 31} ${sh + 8} Z" ${line(shade(c, -.12))}/>`;
    const body = `<path d="M${CX - 50} ${sh}`
        + ` C${CX - 52} ${sh + 34} ${CX - 30} ${wa - 22} ${CX - 24} ${wa}`
        + ` C${CX - 21} ${wa + 20} ${CX - 40} ${hip - 12} ${CX - 42} ${hip}`
        + ` C${CX - 44} ${hip + 34} ${CX - 62} ${hem - 44} ${CX - 84} ${hem}`
        + ` L${CX + 84} ${hem}`
        + ` C${CX + 62} ${hem - 44} ${CX + 44} ${hip + 34} ${CX + 42} ${hip}`
        + ` C${CX + 40} ${hip - 12} ${CX + 21} ${wa + 20} ${CX + 24} ${wa}`
        + ` C${CX + 30} ${wa - 22} ${CX + 52} ${sh + 34} ${CX + 50} ${sh} Z" ${line(`url(#${id}-fig)`)}/>`;
    const waistLine = `<path d="M${CX - 24} ${wa + 2} C${CX - 10} ${wa + 12} ${CX + 10} ${wa + 12} ${CX + 24} ${wa + 2}"`
        + ` fill="none" stroke="${dark}" stroke-width="2" opacity=".45"/>`;
    const sheen = `<path d="M${CX - 15} ${sh + 14} C${CX - 19} ${wa} ${CX - 28} ${hip + 50} ${CX - 38} ${hem - 6}`
        + ` L${CX - 10} ${hem - 6} C${CX - 5} ${hip + 50} ${CX - 3} ${wa} ${CX - 2} ${sh + 14} Z"`
        + ` fill="${shade(c, .8)}" opacity=".3"/>`;
    const ball = `<g transform="translate(${CX} ${hands}) rotate(-14)">`
        + `<path d="M-27 0 C-13 -19 13 -19 27 0 C13 19 -13 19 -27 0 Z" ${line(shade(c, .5))}/>`
        + `<path d="M-12 0 h24 M-7 -5 v10 M0 -6 v12 M7 -5 v10" fill="none" stroke="${dark}" stroke-width="2" opacity=".6"/></g>`;
    return hair + neck + head + arm(-1) + arm(1) + body + sheen + waistLine + ball;
}

/* La T: stessa altezza e stesso piedistallo, zero racconto. Sagoma e non
   testo, così prende il gradiente del metallo e resta identica anche dove il
   carattere non c'è (un .svg salvato su disco, per esempio). */
function monogramArt(t, id) {
    const c = t.statue, dark = shade(c, -.55);
    const top = FIG.top + 26, bot = FIG.hem, arm = 96, thick = 40, bar = 46;
    const d = `M${CX - arm} ${top} H${CX + arm} V${top + bar} H${CX + thick}`
        + ` L${CX + thick - 8} ${bot} H${CX - thick + 8} L${CX - thick} ${top + bar} H${CX - arm} Z`;
    return `<path d="${d}" fill="url(#${id}-fig)" stroke="${dark}" stroke-width="2.5" stroke-linejoin="round"/>`
        + `<path d="M${CX - 16} ${top + bar} L${CX - 14} ${bot} L${CX - 2} ${bot} L${CX - 2} ${top + bar} Z"`
        + ` fill="${shade(c, .8)}" opacity=".35"/>`;
}

function trophyArt(t, id, dx) {
    const shift = (n) => dx ? `<g transform="translate(${r1(dx)} 0)">${n}</g>` : n;
    if (t.figure === 'photo') return { defs: '', node: shift(photoArt(t)) };

    const defs = metalDefs(`${id}-fig`, t.statue) + (t.relief ? reliefDefs(id) : '');
    const figure = t.figure === 'monogram' ? monogramArt(t, id) : statueArt(t, id);
    const ey = FIG.pedY + 30;
    const emblem = t.emblem
        ? `<path d="M${CX - 22} ${ey} C${CX - 11} ${ey - 16} ${CX + 11} ${ey - 16} ${CX + 22} ${ey}`
        + ` C${CX + 11} ${ey + 16} ${CX - 11} ${ey + 16} ${CX - 22} ${ey} Z" fill="${t.barInk}" opacity=".85"/>`
        : '';
    const body = pedestalArt(t, id) + figure;
    // Il filtro va sul GRUPPO: illuminati uno per uno, i pezzi diventerebbero
    // ognuno un oggetto a sé, col suo riflesso e il suo bordo.
    return { defs, node: shift((t.relief ? `<g filter="url(#${id}-relief)">${body}</g>` : body) + emblem) };
}

/* ── La targa ────────────────────────────────────────────────────────
   Non ha una larghezza sua: la prende dal numero, così il numero non ne esce
   mai e non ha bisogno di rimpicciolirsi. Resta centrata sulla TELA anche
   quando il trofeo è fuori asse — è lei a dire dov'è il centro. */
function barArt(t, id, halfNum) {
    const m = t.metal;
    const half = Math.min(W / 2 - 12, Math.max(BAR_MIN, halfNum + BAR_PAD));
    const x = r1(CX - half), w = r1(half * 2);
    const defs = `<linearGradient id="${id}-bar" x1="0" y1="0" x2="0" y2="1">`
        + `<stop offset="0" stop-color="${shade(m, .55)}"/>`
        + `<stop offset=".42" stop-color="${m}"/>`
        + `<stop offset=".52" stop-color="${shade(m, -.28)}"/>`
        + `<stop offset="1" stop-color="${shade(m, .3)}"/></linearGradient>`;
    /* Inter Tight a 700: una via di mezzo. A 800 la scritta è un blocco nero e
       sembra un'etichetta di avvertimento; a 600 è troppo esile per una targa
       di metallo. La spaziatura larga fa il resto. */
    const fsz = Math.min(46, r1(w / (String(t.wordmark).length * .66)));
    return {
        defs,
        node: `<rect x="${x}" y="${BAR.y}" width="${w}" height="${BAR.h}" rx="${BAR.r}"`
            + ` fill="url(#${id}-bar)" stroke="${shade(m, -.5)}" stroke-width="2.5"/>`
            + `<text x="${CX}" y="${BAR.y + BAR.h * .7}" text-anchor="middle"`
            + ` font-family="'Inter Tight',system-ui,sans-serif" font-size="${fsz}" font-weight="700"`
            + ` letter-spacing="5" fill="${t.barInk}">${esc(t.wordmark)}</text>`,
    };
}

/**
 * Il logo di un'edizione.
 *
 * @param {Object} o
 * @param {number} [o.edition]     - numero dell'edizione (1 = 2019). Se manca si ricava da `year`.
 * @param {number} [o.year]        - stagione; se manca si ricava dall'edizione.
 * @param {Object} [o.theme]       - scarti sopra il tema dell'anno.
 * @param {Object} [o.show]        - strati accesi: numeral, trophy, bar, season.
 * @param {string} [o.idPrefix]    - prefisso degli id interni; se manca ne genera uno unico.
 * @param {boolean} [o.standalone] - aggiunge xmlns, per il file .svg salvato su disco.
 * @param {boolean} [o.crop] - la viewBox stringe sull'INCHIOSTRO invece che sulla tela.
 *        La tela è quadrata (600×600) ma il logo occupa solo 600×484, e non è nemmeno
 *        centrato (sta fra 40 e 524). Incastonando la tela intera in un riquadro
 *        quadrato restano due fasce vuote e il marchio si posa 18 unità più in alto
 *        del centro del riquadro: su un campo, dove il riquadro è invisibile, sembra
 *        semplicemente un logo piccolo e messo storto.
 * @param {{x:number,y:number,w:number,h:number}} [o.embed] - riquadro in cui incastonarlo
 *        dentro un ALTRO svg (per esempio dipinto a centrocampo). Un <svg> annidato
 *        senza x/y/width/height prende tutto il viewport del padre: senza questi
 *        quattro numeri il logo coprirebbe l'intero campo.
 * @param {string} [o.className]
 * @returns {string} markup SVG
 */
export function superBowlLogoSVG(o = {}) {
    const edition = o.edition != null ? Number(o.edition) : sbEdition(o.year);
    const year = o.year != null ? Number(o.year) : sbYear(edition);
    const t = sbTheme(edition, o.theme || {});
    const show = { numeral: true, trophy: true, bar: true, season: true, ...(o.show || {}) };
    const id = o.idPrefix || `sbl${++SEQ}`;
    const roman = toRoman(edition);

    const parts = [], defs = [];
    let halfNum = 0, dx = 0;
    if (show.numeral) {
        const a = numeralArt(roman, t, id);
        defs.push(a.defs); parts.push(a.node); halfNum = a.half; dx = a.dx;
    }
    if (show.trophy) { const a = trophyArt(t, id, dx); defs.push(a.defs); parts.push(a.node); }
    if (show.bar) { const a = barArt(t, id, halfNum); defs.push(a.defs); parts.push(a.node); }
    if (show.season && t.season) {
        parts.push(`<text x="${CX}" y="${SEASON_Y}" text-anchor="middle"`
            + ` font-family="'Inter Tight',system-ui,sans-serif" font-size="24" font-weight="700"`
            + ` letter-spacing="5" fill="${shade(t.metal, -.45)}">TOPINA LEAGUE · ${year}</text>`);
    }

    const ns = o.standalone ? ' xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"' : '';
    const cls = o.className ? ` class="${esc(o.className)}"` : '';
    const e = o.embed;
    const box = e ? ` x="${r1(e.x)}" y="${r1(e.y)}" width="${r1(e.w)}" height="${r1(e.h)}"` : '';
    const vb = o.crop ? `0 ${SB_LOGO_INK.y} ${SB_LOGO_INK.w} ${SB_LOGO_INK.h}` : `0 0 ${W} ${H}`;
    return `<svg${ns}${cls}${box} viewBox="${vb}" role="img"`
        + ` aria-label="Topina Bowl ${roman} — ${year}${t.city ? ' · ' + esc(t.city) : ''}">`
        + (defs.filter(Boolean).length ? `<defs>${defs.filter(Boolean).join('')}</defs>` : '')
        + parts.filter(Boolean).join('')
        + `</svg>`;
}

/** Le misure del numero di un'edizione: corpo, allungamento, altezza delle
 *  maiuscole, tetto, scostamento del trofeo. Il banco le mostra a schermo e i
 *  controlli le confrontano col disegnato — se il logo e questa funzione
 *  divergono, uno dei due è sbagliato ed è bene accorgersene. */
export function sbMetrics(edition, override = {}) {
    const t = sbTheme(edition, override);
    const parts = splitRoman(toRoman(edition));
    if (!parts[0] && !parts[1]) return { fs: 0, stretch: 1, capH: 0, top: NUM_BASE, dx: 0 };
    const m = numeralMetrics(parts, FACES[t.face] ? t.face : 'block', trophyHalf(t.figure));
    return { fs: m.fs, stretch: r1(m.stretch), capH: Math.round(m.capH), top: Math.round(m.top), dx: m.dx };
}

/* ── I marchi che stanno su un FILE ──────────────────────────────────
   Lo scudetto della lega e il logo dei playoff non li disegniamo: sono marchi
   NFL e li mettiamo come immagine. `markSVG` li incastona come fa `photoArt`
   col trofeo — stesso meccanismo, stesso motivo: una fotografia o un logo
   ufficiale non si riproducono con dei gradienti.

   Se il file non c'e' ancora, `leagueShieldSVG()` qui sotto resta come
   ripiego disegnato: il campo non rimane mai vuoto per un file mancante. */
export const LEAGUE_MARK = 'Logos/nfl-shield.png';
export const PLAYOFF_MARK = 'Logos/nfl-playoffs.png';

/**
 * Un marchio da file, incastonato in un riquadro.
 *
 * `fallback` e' quello che si vede se il file NON c'e'. Serve davvero: i due
 * marchi NFL arrivano come file esterni, e fra il momento in cui il codice li
 * chiede e quello in cui qualcuno li copia nel repo passa del tempo. Senza
 * ripiego, in mezzo, il campo mostrerebbe l'icona di un'immagine rotta.
 *
 * Il meccanismo e' `onerror`: il ripiego sta gia' nel disegno, nascosto, e
 * l'immagine lo scopre solo fallendo. Cosi' il giorno che il file arriva non
 * c'e' niente da cambiare — smette semplicemente di fallire.
 *
 * @param {Object} o
 * @param {string} o.href        - il file
 * @param {{x,y,w,h}} [o.embed]  - il riquadro; senza, esce a dimensione naturale
 * @param {string} [o.fallback]  - markup SVG da mostrare se il file manca
 * @param {string} [o.className]
 */
export function markSVG(o = {}) {
    const e = o.embed;
    const box = e ? ` x="${r1(e.x)}" y="${r1(e.y)}" width="${r1(e.w)}" height="${r1(e.h)}"` : '';
    const cls = o.className ? ` class="${esc(o.className)}"` : '';
    /* preserveAspectRatio: il riquadro sul campo e' quadrato ma il marchio no.
       `meet` lo fa entrare intero e centrato invece di stirarlo. */
    if (!o.fallback) {
        return `<image${cls}${box} href="${esc(o.href)}" preserveAspectRatio="xMidYMid meet"/>`;
    }
    /* Il ripiego si trova per POSIZIONE, non per id: `getElementById` cerca nel
       documento, e qui i due campi della stessa giornata avrebbero id uguali —
       oltre a fallire del tutto se la card e' gia' stata sostituita quando
       l'errore arriva. Il fratello precedente invece c'e' sempre, anche a
       pezzo staccato dal documento. */
    return `<g><g style="display:none">${o.fallback}</g>`
        + `<image${cls}${box} href="${esc(o.href)}" preserveAspectRatio="xMidYMid meet"`
        + ` onerror="var f=this.previousElementSibling;if(f)f.style.display='';this.remove()"/></g>`;
}

/* ── Lo scudetto della lega, disegnato (ripiego) ─────────────────────
   Sul campo del Super Bowl, a centrocampo, non c'è il logo dell'evento: c'è lo
   SCUDETTO della lega, e i due loghi grandi stanno sulle linee delle 25.
   Questo è il nostro: la forma è quella classica di uno scudetto sportivo —
   spalle dritte, fianchi che rientrano, punta in basso — con la banda in alto,
   quattro stelle (una per squadra) e un pallone al centro.

   Sta in questo file, e non in uno suo, perché è l'altro marchio della lega e
   i due si usano quasi sempre insieme. Se un giorno la lega avrà un logo vero
   come file, questa funzione diventa il ripiego.

   `embed` funziona come nel logo grande: senza x/y/width/height un <svg>
   annidato prende tutto il viewport del padre. */
export function leagueShieldSVG(o = {}) {
    const ink = o.ink || '#1d4f86';         // il blu della targa
    const paint = o.paint || '#f2efe4';     // il bianco della vernice di campo
    const id = o.idPrefix || `tls${++SEQ}`;
    const e = o.embed;
    const box = e ? ` x="${r1(e.x)}" y="${r1(e.y)}" width="${r1(e.w)}" height="${r1(e.h)}"` : '';
    const ns = o.standalone ? ' xmlns="http://www.w3.org/2000/svg"' : '';
    const cls = o.className ? ` class="${esc(o.className)}"` : '';

    /* Lo scudetto: 200×240, disegnato attorno al centro (100,120). */
    const shield = 'M18 22 H182 V118 C182 178 140 212 100 228 C60 212 18 178 18 118 Z';
    const star = (x, y, r) => {
        const pts = Array.from({ length: 10 }, (_, i) => {
            const rr = i % 2 ? r * .44 : r;
            const a = (-90 + i * 36) * Math.PI / 180;
            return `${r1(x + Math.cos(a) * rr)},${r1(y + Math.sin(a) * rr)}`;
        }).join(' ');
        return `<polygon points="${pts}"/>`;
    };
    return `<svg${ns}${cls}${box} viewBox="0 0 200 240" role="img" aria-label="Topina League">`
        + `<path d="${shield}" fill="${ink}" stroke="${paint}" stroke-width="9" stroke-linejoin="round"/>`
        + `<path d="M18 22 H182 V74 H18 Z" fill="${paint}" opacity=".92"/>`
        + `<g fill="${ink}">${star(52, 48, 15)}${star(84, 48, 15)}${star(116, 48, 15)}${star(148, 48, 15)}</g>`
        /* il pallone: la stessa mandorla del trofeo, così i due marchi si
           somigliano invece di sembrare di due leghe diverse */
        + `<g transform="translate(100 140) rotate(-16)">`
        + `<path d="M-46 0 C-23 -32 23 -32 46 0 C23 32 -23 32 -46 0 Z" fill="${paint}"/>`
        + `<path d="M-20 0 h40 M-11 -8 v16 M0 -10 v20 M11 -8 v16" fill="none" stroke="${ink}" stroke-width="5"/></g>`
        + `</svg>`;
}

/* Dove sta davvero l'inchiostro dentro la tela: dalla cima del trofeo al fondo
   della targa. Serve a chi deve incastonare il logo in un riquadro (il campo,
   per esempio) senza portarsi dietro due fasce vuote — e il RAPPORTO qui sotto
   è quello che il riquadro deve avere, se no il logo si posa storto o sembra
   più piccolo di quanto gli si è chiesto. */
export const SB_LOGO_INK = { x: 0, y: LOGO_TOP, w: W, h: LOGO_BOT - LOGO_TOP, ratio: W / (LOGO_BOT - LOGO_TOP) };

/* Le misure, per chi deve mettere qualcosa accanto al logo senza rimisurarlo. */
export const SB_LOGO_GEO = { W, H, CX, NUM_BASE, NUM_CEIL, GAP, BAR, TARGET_CAP, LOGO_TOP, LOGO_BOT };
