/**
 * Il campo del Game Center, disegnato invece che fotografato.
 *
 * IN USO nel Game Center dal 2026-09-08 e nel Magazine dal 2026-09-09 (la
 * foto di apertura degli articoli, `.mg-field`): ha sostituito i dodici
 * wallpaper PNG (`img.field-bg`). I file restano nel repo, ma nessuna sezione
 * li scarica più — l'unico che li apre ancora è preview-field.html, per il
 * confronto a fianco — e con loro se n'è andata la cache degli asset che
 * serviva a reggerli. Si continua a provarlo da preview-field.html.
 *
 * NON è js/ui/field-svg.js, che esiste già e disegna il campo del LIVE: quello
 * è verticale (end zone in cima, yard line orizzontali, viewBox 1000×640),
 * grafite e verde spento, con le righe tenui apposta perché ci vanno sopra le
 * figurine. Questo è orizzontale, ricalcato sul wallpaper del Game Center, e
 * vive a parte per non piegare l'uno alla forma dell'altro finché non si sa se
 * questo verrà adottato. Anche le classi CSS sono diverse (`gcf-*` contro
 * `fsv-*`): `.fsv-num` in main.css ha già un suo colore e una sua misura, e
 * riusarla qui faceva sparire i numeri delle iarde — le regole del foglio
 * vincono sugli attributi di presentazione dell'SVG.
 *
 * ── Perché esiste ────────────────────────────────────────────────────
 * Oggi il campo è un PNG per ogni accoppiamento: DODICI file da ~3,5 MB
 * l'uno, 44 MB nel repo, che `hydrateFieldImages` deve tenere in cache per
 * non riscaricarli a ogni visita. E non sono un template: confrontandone due
 * cambiano il numero di strisce d'erba, l'inclinazione e la posizione degli
 * hash. Le end zone poi sono ROSSE in tutti e dodici — cambia solo il nome
 * scritto sopra, quindi il campo non dice affatto di chi è.
 *
 * ── Le misure sono misurate ──────────────────────────────────────────
 * Non sono a occhio: vengono da un'analisi per colore di
 * `Wallpapers/GameCenterHorizontal_C.D.P_LASERS.png` (2432×1760), riga per
 * riga e colonna per colonna. In percentuale della tela:
 *
 *     end zone sinistra   8.18% – 15.95%      erba  16.12% – 83.96%
 *     end zone destra    84.13% – 91.61%      campo (alto)  15.7% – 82.3%
 *     erba chiara #90b070   erba scura #306040   end zone #cf3e38
 *
 * Il riquadro va tenuto: gli slot dei giocatori in Game Center sono
 * posizionati in PERCENTUALE su questa immagine (`.formations-area` sta fra
 * il 18.5% e l'83.5%, i DEF/K con dei left: 9%…), quindi spostare la linea
 * di meta o le end zone significa spostare i giocatori. Per questo la
 * `viewBox` è 2432×1760 come il PNG e non un numero tondo.
 *
 * Nota emersa misurando: il commento in main.css dice «endzones are ~10%
 * width each, goal lines are at 10% and 90%». Il PNG non è così — le linee di
 * meta stanno al 16% e all'84%. Le due cose non combaciano da prima di questo
 * file; qui si segue il PNG, che è quello che si vede.
 *
 * ── Cosa NON si ricalca ──────────────────────────────────────────────
 * Grana della carta, vignetta, l'inclinazione di un grado e le ombre storte
 * dei pali. Si potrebbero rifare (feTurbulence), ma il motivo per cui si
 * passa a SVG è avere un campo nitido, dritto e uguale a se stesso: rifarne
 * le imperfezioni sarebbe pagare i filtri per riottenere i difetti.
 */

/* La tela è quella del wallpaper: cambiarla sposta i giocatori. */
const W = 2432, H = 1760;

/* Erba + end zone, dal bordo interno del contorno chiaro. Misurato. */
const BOX = { x0: 199, y0: 276, x1: 2228, y1: 1448 };
const EZ = 189;                       // profondità dell'end zone
const APRON = 34;                     // il contorno chiaro fuori campo
const GOAL_L = BOX.x0 + EZ;           // linee di meta
const GOAL_R = BOX.x1 - EZ;
const YARD = (GOAL_R - GOAL_L) / 100; // 16.5 unità per iarda

/* I due verdi del taglio d'erba. Presi con un ISTOGRAMMA sulla fascia centrale
   del wallpaper, non con due campioni: campionando due punti a caso erano
   usciti #91a770 e #738e6d, che sono due sfumature dello stesso verde chiaro —
   uno dei due era finito su una transizione — e le strisce a schermo quasi non
   si distinguevano. Le due mode vere stanno molto piu' lontane. */
const GRASS_A = '#90b070';            // erba chiara
const GRASS_B = '#306040';            // erba scura
const PAINT = '#f2efe4';              // la vernice: righe, numeri, contorno
const RED = '#cf3e38';                // l'end zone dei wallpaper
const POST = '#e9b93a';               // i pali

const r1 = (n) => Math.round(n * 10) / 10;

/**
 * Il font va negli ATTRIBUTI STYLE dei testi, non in un blocco <style> dentro
 * l'SVG. Due motivi, tutti e due presi in faccia:
 *
 * 1. Dentro un SVG inline lo <style> NON e' raw text come in HTML: quello che
 *    ci sta dentro viene interpretato come markup. Bastava nominare un tag in
 *    un commento perche' il foglio non producesse NESSUNA regola (cssRules
 *    vuoto) e i testi cadessero sul font della pagina, senza un errore.
 * 2. Le regole del sito battono gli attributi di presentazione dell'SVG:
 *    `.fsv-num` in main.css dipinge i numeri a rgba(255,255,255,.07) e li
 *    rimpicciolisce a 30px. Uno style inline invece vince su tutto.
 *
 * Archivo Black e' la faccia del wallpaper: pesante, terminali piatti,
 * contro-forme larghe. Ha un peso solo (400), da qui `font-synthesis: none` —
 * se no il browser, vedendosi chiedere 900, la ingrassa da se' e le cifre si
 * chiudono. Se non c'e', si ricade su Inter Tight 900, che il sito ha gia'.
 *
 * ADOTTANDOLO: la famiglia va aggiunta al link dei font in index.html, oggi
 * sta solo nel banco di prova.
 */
const FONT = "font-family:'Archivo Black',var(--font-display,'Inter Tight'),system-ui,sans-serif;"
    + 'font-weight:900;font-synthesis:none;';

/**
 * Inchiostro leggibile su un fondo qualunque: cremino sui colori scuri, quasi
 * nero sui chiari. Serve perché le end zone possono prendere il colore della
 * squadra, e fra i quattro c'è l'oro dei Lasers (#D4AF37): su quello il
 * cremino sparisce. Stessa idea di `inkFor()` in js/ui/charts.js, tenuta qui
 * in tre righe per non tirarsi dietro un modulo intero.
 */
function inchiostro(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim());
    if (!m) return PAINT;
    const n = parseInt(m[1], 16);
    const l = (0.2126 * (n >> 16 & 255) + 0.7152 * (n >> 8 & 255) + 0.0722 * (n & 255)) / 255;
    return l > 0.55 ? '#1b1b18' : PAINT;
}

/* ── Le strisce del taglio d'erba ──────────────────────────────────────
   Una ogni 5 iarde, venti in tutto, come nel wallpaper. Non arrivano dentro
   le end zone: là il colore è pieno. */
function erba() {
    let out = `<rect x="${GOAL_L}" y="${BOX.y0}" width="${r1(GOAL_R - GOAL_L)}" height="${BOX.y1 - BOX.y0}" fill="${GRASS_A}"/>`;
    for (let i = 1; i < 20; i += 2) {
        out += `<rect x="${r1(GOAL_L + i * 5 * YARD)}" y="${BOX.y0}" width="${r1(5 * YARD)}" height="${BOX.y1 - BOX.y0}" fill="${GRASS_B}"/>`;
    }
    return `<g>${out}</g>`;
}

/* ── Righe, tacche e hash ─────────────────────────────────────────────
   Le tacche a bordo campo sono UNA PER IARDA: sono quelle che fanno leggere
   la distanza: senza, venti strisce uguali non dicono quanto sono larghe.
   Gli hash stanno al 40% e al 56% dell'altezza, come nel wallpaper — che non
   è dove stanno in NFL, ma questo campo è più stretto del vero e portarli
   alla misura regolamentare li appiccicherebbe alle righe dei numeri. */
function righe() {
    const h = BOX.y1 - BOX.y0;
    let out = '';

    // righe ogni 5 iarde, linee di meta piene
    for (let y = 0; y <= 100; y += 5) {
        const x = r1(GOAL_L + y * YARD);
        const meta = (y === 0 || y === 100);
        out += `<line x1="${x}" y1="${BOX.y0}" x2="${x}" y2="${BOX.y1}" stroke="${PAINT}" `
            + `stroke-width="${meta ? 7 : 4}" opacity="${meta ? 0.95 : 0.5}"/>`;
    }

    // tacche a bordo campo, una per iarda
    const tacca = 26;
    for (let y = 1; y < 100; y++) {
        if (y % 5 === 0) continue;
        const x = r1(GOAL_L + y * YARD);
        out += `<line x1="${x}" y1="${BOX.y0}" x2="${x}" y2="${BOX.y0 + tacca}" stroke="${PAINT}" stroke-width="3.4" opacity="0.72"/>`
            + `<line x1="${x}" y1="${BOX.y1 - tacca}" x2="${x}" y2="${BOX.y1}" stroke="${PAINT}" stroke-width="3.4" opacity="0.72"/>`;
    }

    // le due file di hash
    for (const f of [0.40, 0.56]) {
        const y = r1(BOX.y0 + h * f);
        for (let i = 1; i < 100; i++) {
            if (i % 5 === 0) continue;
            const x = r1(GOAL_L + i * YARD);
            out += `<line x1="${x}" y1="${y - 9}" x2="${x}" y2="${y + 9}" stroke="${PAINT}" stroke-width="3.4" opacity="0.62"/>`;
        }
    }
    return `<g>${out}</g>`;
}

/* ── I numeri e le frecce ────────────────────────────────────────────
   Ogni dieci iarde, due file. Quella in alto è CAPOVOLTA: su un campo vero i
   numeri si leggono dalla propria tribuna, ed è anche quello che fa il
   wallpaper.

   Tre cose che nella prima stesura erano sbagliate:

   1. **La freccia ruotava col numero.** Il gruppo veniva girato di 180° tutto
      insieme, quindi nella fila in alto la freccia finiva dall'altra parte e
      puntava LONTANO dalla meta più vicina. La freccia però indica una
      direzione del campo, non una direzione della scritta: la meta più vicina
      è la stessa per tutte e due le file. Ora ruota solo il numero, la freccia
      si posiziona in coordinate del campo.

   2. **La freccia era grande quanto il numero.** Il regolamento la dà a
      36 pollici di lunghezza e 18 di larghezza: una iarda per mezza iarda,
      contro i due iarde e mezzo di altezza della cifra. Prima era 21×42 —
      più alta che lunga, cioè girata di 90° rispetto alla vera.

   3. **Le due cifre stanno A CAVALLO della linea delle decine**, una per
      parte, e la linea si vede nel mezzo. Prima erano un testo solo centrato
      sulla linea: cadeva nel posto giusto per caso, ma il bianco fra le cifre
      dipendeva dalla spaziatura del carattere invece che dalla linea.

   Il corpo non è a occhio, e non viene più dal wallpaper: viene dal campo
   vero. I numeri NFL sono alti 6 piedi, cioè DUE IARDE — e su questo campo
   una iarda in altezza vale (BOX.y1-BOX.y0)/53.3 = 22 unità, quindi la cifra
   è alta 44. Archivo Black a corpo 100 ha la cifra alta 71.6, da cui il corpo:
   44 / 0.716 ≈ 61.

   Prima erano 84, cioè 60 unità di altezza = 2.7 iarde: era la misura presa
   dal wallpaper, che però non è in scala. La differenza si vedeva — i numeri
   sembravano il pezzo più grosso del campo, e sul campo vero non lo sono.
   La fila sta al 22% dell'erba dall'alto e dal basso: sul campo vero il numero
   sta fra le 12 e le 14 iarde dalla linea laterale, cioè col centro al 24%.
   Resta uno scarto che il font non può colmare: Archivo Black ha le cifre a
   passo fisso e più larghe (ink 52 contro 40), quindi l'1 non si stringe come
   nel wallpaper. Schiacciarle con uno scaleX le farebbe combaciare, ma sarebbe
   deformare una faccia per farla somigliare a un'altra. */
function numeri() {
    const cifre = 61;   // 2 iarde di altezza, come il regolamento
    const avanz = r1(66.7 * cifre / 100);   // larghezza di una cifra, dal font
    const varco = 7;                        // mezzo vuoto sulla linea, fra le due cifre
    /* La freccia, in unità di tela. Il campo è più alto del vero (16.5 unità
       per iarda in larghezza, 22 in altezza), quindi la lunghezza si converte
       con YARD e la larghezza con il passo verticale. */
    const frecciaL = r1(YARD), frecciaH = r1((BOX.y1 - BOX.y0) / 53.3 * 0.5);
    const stacco = 14;                      // aria fra la cifra e la freccia

    let out = '';
    for (let y = 10; y <= 90; y += 10) {
        const x = r1(GOAL_L + y * YARD);
        const n = String(y > 50 ? 100 - y : y);
        const verso = y === 50 ? 0 : (y < 50 ? -1 : 1);   // dove sta la meta più vicina
        for (const [cy, giu] of [[BOX.y0 + (BOX.y1 - BOX.y0) * 0.22, true], [BOX.y1 - (BOX.y1 - BOX.y0) * 0.22, false]]) {
            const rot = giu ? ` transform="rotate(180 ${x} ${r1(cy)})"` : '';
            const stile = `style="${FONT}font-size:${cifre}px;fill:${PAINT}"`
                + ` dominant-baseline="central" opacity="0.92" class="gcf-num"`;
            // le due cifre, una per lato della linea
            out += `<g${rot}>`
                + `<text x="${r1(x - varco)}" y="${r1(cy)}" text-anchor="end" ${stile}>${n[0]}</text>`
                + `<text x="${r1(x + varco)}" y="${r1(cy)}" text-anchor="start" ${stile}>${n[1]}</text>`
                + `</g>`;
            if (verso) {
                // in coordinate del campo: stessa direzione per tutte e due le file
                const base = x + verso * (varco + avanz + stacco);
                const punta = base + verso * frecciaL;
                out += `<path d="M ${r1(base)} ${r1(cy - frecciaH / 2)} L ${r1(punta)} ${r1(cy)}`
                    + ` L ${r1(base)} ${r1(cy + frecciaH / 2)} Z" fill="${PAINT}" opacity="0.9"/>`;
            }
        }
    }
    return `<g>${out}</g>`;
}

/* ── Le end zone ─────────────────────────────────────────────────────
   ⚠️ RICOSTRUITA. La versione precedente è stata cancellata per sbaglio da una
   sostituzione troppo larga; questa è riscritta sulle stesse misure (fondo
   pieno fra il bordo e la linea di meta, nome in verticale) e confrontata coi
   rendering di prima. Se salta fuori l'originale, vince quello.

   Il nome si legge dal basso verso l'alto a sinistra e dall'alto verso il
   basso a destra: è come stanno le scritte nelle end zone vere, girate verso
   la propria tribuna. L'inchiostro non è deciso a mano — `inchiostro()`
   guarda la luminanza del fondo e sceglie bianco o quasi-nero, se no il nome
   dei Lasers (oro) sparirebbe in bianco su bianco.

   Il corpo si calcola: deve stare nell'altezza del campo per la lunghezza del
   nome, e nella profondità dell'end zone per l'altezza delle maiuscole. Un
   corpo fisso spezzerebbe "Capi dei Pianeti" e lascerebbe mezza end zone vuota
   con "Sommo". */
function endZone(side, team, colore) {
    const sinistra = side === 'left';
    const x0 = sinistra ? BOX.x0 : GOAL_R;
    const cx = x0 + EZ / 2, cy = (BOX.y0 + BOX.y1) / 2;
    const alt = BOX.y1 - BOX.y0;
    const nome = (team && team.name ? String(team.name) : '').toUpperCase();

    let out = `<rect x="${x0}" y="${BOX.y0}" width="${EZ}" height="${alt}" fill="${colore}"/>`;
    if (nome) {
        const ink = inchiostro(colore);
        /* Larghezza: avanzamento 0.667em per lettera (Archivo Black) più la
           spaziatura. Altezza: le maiuscole sono 0.716em e devono stare in
           EZ meno un po' d'aria. */
        const perLettera = 0.667 + 0.08;
        const fs = Math.floor(Math.min(alt * 0.86 / (nome.length * perLettera), EZ * 0.66 / 0.716));
        const rot = sinistra ? -90 : 90;
        out += `<text x="${r1(cx)}" y="${r1(cy)}" transform="rotate(${rot} ${r1(cx)} ${r1(cy)})"`
            + ` style="${FONT}font-size:${fs}px;letter-spacing:0.08em;fill:${ink}"`
            + ` text-anchor="middle" dominant-baseline="central">${esc(nome)}</text>`;
    }
    return out;
}

function pali(side) {
    const fuori = side === 'left' ? -1 : 1;          // dove sta il "dietro"
    const linea = side === 'left' ? BOX.x0 : BOX.x1; // la linea di fondo
    const cy = (BOX.y0 + BOX.y1) / 2;
    const traversa = 276, montante = 52, collo = 34, tampone = 17;
    const px = r1(linea + fuori * (collo + tampone));   // centro del tampone
    const y1 = r1(cy - traversa / 2), y2 = r1(cy + traversa / 2);
    return `<g stroke="${POST}" stroke-width="18" fill="none"
               stroke-linecap="round" stroke-linejoin="round">
        <path d="M ${px} ${r1(cy)} H ${linea} M ${linea} ${y1} V ${y2}"/>
        <path d="M ${linea} ${y1} H ${r1(linea + fuori * montante)}"/>
        <path d="M ${linea} ${y2} H ${r1(linea + fuori * montante)}"/>
        <circle cx="${px}" cy="${r1(cy)}" r="${tampone}" fill="${RED}" stroke="none"/>
    </g>`;
}

/* ── La linea di limite, con la zona panchine ────────────────────────
   Il rettangolo tratteggiato attorno al campo: nel wallpaper è quello che dice
   «questa è un'inquadratura», e senza, il campo sembra un'illustrazione
   appoggiata sul nero. Ma non è un vezzo grafico — sul campo vero è la LINEA
   DI LIMITE, quella che tiene tutti a distanza dalla linea laterale.

   E davanti alle panchine si allarga: la linea si sposta VERSO L'ESTERNO per
   fare posto a squadre e staff, non verso l'interno. La prima stesura la
   piegava dentro, cioè restringeva il campo proprio dove serve più spazio —
   il contrario di quello che fa un campo vero.

   Quanto è larga la zona: sul campo NFL le panchine stanno fra le due linee
   delle 32, cioè 36 iarde su 120 di cornice — il 30% della larghezza. Il 14%
   di prima era una tacca, non una zona.

   Il taglio è un path solo, così il tratteggio gira attorno allo scalino
   invece di ricominciare da capo a ogni segmento. */
function cornice() {
    const m = 96;
    const x0 = BOX.x0 - APRON - m, x1 = BOX.x1 + APRON + m;
    const y0 = BOX.y0 - APRON - m, y1 = BOX.y1 + APRON + m;
    const w = (x1 - x0), zona = w * 0.30, sp = 40;   // larghezza della zona panchine e sporgenza
    const cx = (x0 + x1) / 2;
    /* In alto «fuori» è verso l'alto (y che cala), in basso è verso il basso:
       da qui i segni opposti nei due scalini. */
    const d = `M ${x0} ${y0} H ${r1(cx - zona / 2)} l ${r1(sp)} ${r1(-sp)} H ${r1(cx + zona / 2 - sp)} l ${r1(sp)} ${r1(sp)} H ${x1}`
        + ` V ${y1} H ${r1(cx + zona / 2)} l ${r1(-sp)} ${r1(sp)} H ${r1(cx - zona / 2 + sp)} l ${r1(-sp)} ${r1(-sp)} H ${x0} Z`;
    return `<path d="${d}" fill="none" stroke="${PAINT}" stroke-width="4" stroke-dasharray="18 16" opacity="0.55"/>`;
}

function esc(s) {
    return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

/* ── La verniciatura da Super Bowl ───────────────────────────────────
   Lo schema è quello vero, e NON è il logo dell'evento a centrocampo:

       centrocampo (50 yd)   il marchio della lega, ~10 iarde
       le due linee delle 25 il logo dell'edizione, ~26 iarde, uno per lato

   Il logo dell'edizione a centrocampo era la mia prima versione ed era
   sbagliata: lì ci va lo scudetto, e i due loghi grandi stanno sui 25.

   Il campo NON conosce il modulo del logo: gli si passano due funzioni che
   ricevono il riquadro e restituiscono il markup. Così i due file restano
   indipendenti — il campo sa dove sono le linee, il logo sa disegnarsi, e
   nessuno dei due importa l'altro.

   ⚠️ Il campo è verticalmente più alto del vero (1 iarda = 16.5 unità in
   larghezza ma 22 in altezza: il wallpaper non è in scala). I riquadri sono
   QUADRATI in unità di tela, quindi una misura in iarde vale per la larghezza;
   in altezza il quadrato risulta un po' più corto del suo equivalente reale.
   È voluto: un riquadro schiacciato per compensare deformerebbe il logo. */
/* `ratio` è larghezza/altezza del MARCHIO, non della sua tela: passandolo, il
   riquadro gli sta addosso e le iarde chieste sono davvero quelle dipinte.
   Con un riquadro quadrato su un marchio che quadrato non è, il logo entra
   rimpicciolito (ci sta in altezza, non in larghezza) e si posa scentrato. */
function rectAt(cx, yards, ratio = 1) {
    const w = YARD * yards, h = w / ratio, cy = (BOX.y0 + BOX.y1) / 2;
    const rect = { x: r1(cx - w / 2), y: r1(cy - h / 2), w: r1(w), h: r1(h) };
    rect.pct = {
        left: r1(cx / W * 100), top: r1(cy / H * 100),
        width: r1(w / W * 100), height: r1(h / H * 100),
    };
    return rect;
}

/** I due riquadri sulle linee delle 25, uno per metà campo. */
export function gcLogoRects(yards = 34, ratio = 1) {
    return [rectAt(GOAL_L + 25 * YARD, yards, ratio), rectAt(GOAL_R - 25 * YARD, yards, ratio)];
}

/** Il riquadro del marchio di lega, a cavallo della linea delle 50. */
export function gcMidRect(yards = 10, ratio = 200 / 240) {
    return rectAt((GOAL_L + GOAL_R) / 2, yards, ratio);
}

/**
 * @param opts {
 *   left, right: { name, color },     // le due squadre, sinistra e destra
 *   endzone: 'team' | 'red',          // colore delle end zone
 *   show: { erba, righe, numeri, nomi, pali, cornice, logo, mid }  // strati, accesi di default
 *   logo: (rect) => markup,           // il logo dell'edizione, sulle due linee delle 25
 *   logoYards: 34,
 *   logoRatio: 1.24,                 // larghezza/altezza del marchio, non della sua tela
 *   mid: (rect) => markup,            // il marchio della lega, sulla linea delle 50
 *   midYards: 10,
 *   logoOpacity: 0.9,                 // è vernice su erba, non un adesivo
 *   className: 'field-bg',            // le classi del sito, che portano proporzione e filtro
 * }
 */
export function gameCenterFieldSVG(opts = {}) {
    const on = { erba: true, righe: true, numeri: true, nomi: true, pali: true, cornice: true, logo: true, mid: true, ...(opts.show || {}) };
    /* La vernice sta SOPRA righe e numeri e SOTTO i pali: sul campo vero il
       logo copre le linee, non il contrario. */
    const paint = [];
    if (on.logo && typeof opts.logo === 'function') {
        gcLogoRects(opts.logoYards, opts.logoRatio).forEach((r, i) => paint.push(opts.logo(r, i)));
    }
    if (on.mid && typeof opts.mid === 'function') paint.push(opts.mid(gcMidRect(opts.midYards)));
    const logo = paint.length ? `<g opacity="${opts.logoOpacity ?? 0.9}">${paint.join('')}</g>` : '';
    const left = opts.left || { name: 'Home', color: RED };
    const right = opts.right || { name: 'Away', color: RED };
    const cL = opts.endzone === 'team' ? (left.color || RED) : RED;
    const cR = opts.endzone === 'team' ? (right.color || RED) : RED;

    return `
<svg class="gcf${opts.className ? ' ' + esc(opts.className) : ''}" viewBox="0 0 ${W} ${H}" width="100%" role="img"
     aria-label="${esc(left.name)} vs ${esc(right.name)}" preserveAspectRatio="xMidYMid meet">
  ${on.cornice ? cornice() : ''}
  <rect x="${BOX.x0 - APRON}" y="${BOX.y0 - APRON}" width="${BOX.x1 - BOX.x0 + APRON * 2}"
        height="${BOX.y1 - BOX.y0 + APRON * 2}" fill="${PAINT}"/>
  ${on.erba ? erba() : `<rect x="${GOAL_L}" y="${BOX.y0}" width="${r1(GOAL_R - GOAL_L)}" height="${BOX.y1 - BOX.y0}" fill="${GRASS_A}"/>`}
  ${endZone('left', on.nomi ? left : {}, cL)}
  ${endZone('right', on.nomi ? right : {}, cR)}
  ${on.righe ? righe() : ''}
  ${on.numeri ? numeri() : ''}
  ${logo}
  ${on.pali ? pali('left') + pali('right') : ''}
</svg>`;
}

/** Le coordinate, per chi deve posizionarci sopra qualcosa (in % della tela). */
export const GC_FIELD_GEO = {
    viewBox: [W, H],
    goalLinePct: [GOAL_L / W * 100, GOAL_R / W * 100],
    endZonePct: [BOX.x0 / W * 100, GOAL_L / W * 100],
    grassPct: { top: BOX.y0 / H * 100, bottom: BOX.y1 / H * 100 },
};
