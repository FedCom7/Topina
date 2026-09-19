/**
 * Topina League — i caricamenti a PAGINA PIENA.
 *
 * Sono un'altra cosa dallo spinner di js/ui/spinner.js, e la differenza non e'
 * la taglia: e' COSA sta aspettando.
 *   - `.spinner` (piccolo)  → un riquadro che si aggiorna mentre il resto
 *                             della pagina e' gia' a schermo.
 *   - questi (grandi)       → la sezione e' vuota, non c'e' ancora niente da
 *                             guardare, e lo spazio va riempito.
 * Chi mette un caricamento grosso dentro un riquadro fa sobbalzare la pagina
 * quando arriva il contenuto; chi ne mette uno piccolo in una sezione vuota
 * lascia un francobollo in mezzo al nulla. Sono due strumenti, non due misure.
 *
 * Due scene:
 *   `playLoader()`  — la lavagna tattica: una giocata vera che si disegna da
 *                     sola, O in attacco e X in difesa. Per tutte le sezioni.
 *   `teamLoader()`  — il logo della squadra che si riempie. Per le pagine
 *                     squadra, dove un'identita' precisa c'e' gia'.
 *
 * NON e' un campo, e non tocca i cinque moduli `field-*`: quelli disegnano il
 * campo VERO (Live, Game Center, formazioni) e hanno la regola di non
 * duplicarsi fra loro. Una lavagna e' un oggetto diverso — schematica, senza
 * proporzioni vere, con le route a gesso — e mescolarla a quelli vorrebbe dire
 * trascinarsi dietro una geometria che qui non serve.
 *
 * Il movimento sta tutto in main.css (`.tl-play-*`, `.tl-fill-*`): qui c'e'
 * solo la geometria.
 */

/* ── il playbook ──────────────────────────────────────────────────────────
   Campo schematico 400x240, linea di scrimmage a y=150, l'attacco va verso
   l'ALTO (y calanti). Sono giocate vere, non scarabocchi: ogni voce dichiara
   il personnel, la formazione e la copertura, e i tracciati sono quelli.

   Ogni giocatore e' {x, y} e, se si muove, `via` (il tracciato) e `t` (quanto
   ci mette: 'f' veloce, 'm' media, 's' lenta). `pre` e' il movimento PRE-SNAP
   — il motion dell'attacco, la finta di blitz della difesa — e vive nella
   prima parte del ciclo; `via` parte allo snap.
   Chi va in motion ha due marker, non uno: il primo percorre il motion e si
   spegne allo snap, il secondo si accende li' e corre la route. E' l'unico
   modo di avere due velocita' diverse su due tratti dello stesso percorso
   senza misurare la lunghezza del tracciato a runtime. */
const OL = [166, 183, 200, 217, 234];

const PLAYBOOK = [
    {
        nome: '11 PERSONNEL · TRIPS RIGHT',
        vs: 'COVER 3',
        att: [
            { x: 200, y: 176, r: 'qb', via: 'M 200 176 L 200 198', t: 'f' },
            { x: 178, y: 176, via: 'M 178 176 C 150 172 110 168 84 164', t: 'm' },
            { x: 48, y: 150, via: 'M 48 150 L 48 28', t: 's' },
            { x: 252, y: 150, via: 'M 252 150 L 252 40', t: 's' },
            { x: 292, y: 150, via: 'M 292 150 L 292 96 L 218 96', t: 's' },
            { x: 336, y: 150, via: 'M 336 150 L 336 52 L 356 76', t: 's' },
        ],
        dif: [
            { x: 174, y: 138, r: 'dl' }, { x: 191, y: 138, r: 'dl' },
            { x: 209, y: 138, r: 'dl' }, { x: 226, y: 138, r: 'dl' },
            { x: 168, y: 114, via: 'M 168 114 L 150 100', t: 'm' },
            { x: 200, y: 114, via: 'M 200 114 L 200 88', t: 'm' },
            { x: 240, y: 114, via: 'M 240 114 L 268 100', t: 'm' },
            { x: 48, y: 128, via: 'M 48 128 L 48 44', t: 's' },
            { x: 336, y: 128, via: 'M 336 128 L 336 44', t: 's' },
            { x: 200, y: 58, via: 'M 200 58 L 200 36', t: 'm' },
            { x: 280, y: 92, via: 'M 280 92 L 300 74', t: 'm' },
        ],
    },
    {
        nome: '12 PERSONNEL · I-FORM · PA BOOT',
        vs: 'COVER 1 · LB BLITZ',
        att: [
            { x: 200, y: 160, r: 'qb', via: 'M 200 160 C 196 176 216 184 244 178', t: 'm' },
            { x: 200, y: 176, via: 'M 200 176 L 206 168', t: 'f' },
            { x: 200, y: 192, via: 'M 200 192 C 176 186 150 176 128 170', t: 'm' },
            { x: 252, y: 150, via: 'M 252 150 L 252 132 L 170 126', t: 'm' },
            { x: 340, y: 150, via: 'M 340 150 L 340 80 L 262 34', t: 's' },
            // il tight end a sinistra parte in motion e finisce nel flat
            { x: 148, y: 150, pre: 'M 148 150 C 180 158 230 158 268 152',
              via: 'M 268 152 L 300 146', t: 'm' },
        ],
        dif: [
            { x: 182, y: 138, r: 'dl' }, { x: 200, y: 138, r: 'dl' }, { x: 218, y: 138, r: 'dl' },
            { x: 156, y: 116, blitz: 1, pre: 'M 156 116 L 162 128', via: 'M 162 128 L 178 146', t: 'f' },
            { x: 186, y: 114, via: 'M 186 114 L 186 96', t: 'm' },
            { x: 214, y: 114, via: 'M 214 114 L 222 96', t: 'm' },
            { x: 244, y: 116, blitz: 1, pre: 'M 244 116 L 238 128', via: 'M 238 128 L 224 146', t: 'f' },
            { x: 340, y: 128, via: 'M 340 128 L 332 86', t: 's' },
            // il corner segue il motion: e' copertura a uomo
            { x: 148, y: 128, pre: 'M 148 128 C 180 136 230 136 266 130',
              via: 'M 266 130 L 296 124', t: 'm' },
            { x: 200, y: 52, via: 'M 200 52 L 200 34', t: 'm' },
            { x: 272, y: 100, via: 'M 272 100 L 190 118', t: 'm' },
        ],
    },
    {
        nome: '10 PERSONNEL · EMPTY · MESH',
        vs: 'NICKEL · COVER 2',
        att: [
            { x: 200, y: 176, r: 'qb', via: 'M 200 176 L 200 196', t: 'f' },
            { x: 44, y: 150, via: 'M 44 150 L 44 30', t: 's' },
            { x: 96, y: 150, via: 'M 96 150 L 96 130 L 300 124', t: 's' },
            { x: 252, y: 150, via: 'M 252 150 L 252 126 L 92 132', t: 's' },
            { x: 296, y: 150, via: 'M 296 150 L 296 90 L 356 50', t: 's' },
            { x: 340, y: 150, via: 'M 340 150 L 340 108 L 336 120', t: 'm' },
        ],
        dif: [
            { x: 174, y: 138, r: 'dl' }, { x: 191, y: 138, r: 'dl' },
            { x: 209, y: 138, r: 'dl' }, { x: 226, y: 138, r: 'dl' },
            { x: 186, y: 114, via: 'M 186 114 L 186 92', t: 'm' },
            { x: 218, y: 114, via: 'M 218 114 L 232 94', t: 'm' },
            { x: 44, y: 128, via: 'M 44 128 L 54 110', t: 'm' },
            { x: 340, y: 128, via: 'M 340 128 L 330 110', t: 'm' },
            { x: 296, y: 124, via: 'M 296 124 L 286 104', t: 'm' },
            { x: 132, y: 62, via: 'M 132 62 L 118 40', t: 's' },
            { x: 268, y: 62, via: 'M 268 62 L 282 40', t: 's' },
        ],
    },
    {
// Corsa, e non una power: in una power il portatore, il fullback, la
        // guardia che pulla e il tight end convergono tutti nello stesso metro
        // quadrato, e a questa scala diventa un groviglio. Lo sweep porta
        // l'azione LARGA, lontano dal grumo della linea, e si legge.
        nome: '21 PERSONNEL · TOSS SWEEP RIGHT',
        vs: 'COVER 0 · EDGE BLITZ',
        att: [
            { x: 200, y: 160, r: 'qb', via: 'M 200 160 C 190 172 176 178 160 180', t: 'm' },
            { x: 188, y: 178, via: 'M 188 178 C 222 182 258 172 284 156', t: 'm' },
            { x: 200, y: 192, via: 'M 200 192 C 232 196 272 186 302 164 L 318 112', t: 's' },
            { x: 252, y: 150, via: 'M 252 150 L 268 144', t: 'f' },
            { x: 44, y: 150, via: 'M 44 150 L 60 134', t: 's' },
            { x: 340, y: 150, via: 'M 340 150 L 330 130', t: 's' },
        ],
        pull: { da: 217, via: 'M 217 150 C 248 158 282 150 298 138', t: 'm' },
        dif: [
            { x: 174, y: 138, r: 'dl' }, { x: 191, y: 138, r: 'dl' },
            { x: 209, y: 138, r: 'dl' }, { x: 226, y: 138, r: 'dl' },
            { x: 162, y: 114, blitz: 1, pre: 'M 162 114 L 156 126', via: 'M 156 126 L 146 148', t: 'f' },
            { x: 196, y: 112, via: 'M 196 112 L 224 130', t: 'm' },
            { x: 246, y: 114, via: 'M 246 114 C 268 124 292 134 308 146', t: 'm' },
            { x: 44, y: 128, via: 'M 44 128 L 52 116', t: 'm' },
            { x: 340, y: 128, via: 'M 340 128 L 332 116', t: 'm' },
            { x: 148, y: 84, via: 'M 148 84 L 176 118', t: 'm' },
            { x: 272, y: 84, via: 'M 272 84 C 292 100 312 118 324 132', t: 's' },
        ],
    },
];


const esc0 = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* I glifi. L'attacco sono O, la difesa X: e' la convenzione della lavagna, e
   il colore (caldo contro freddo) la rende leggibile in un colpo. Il
   quarterback ha la sbarra, cosi' si capisce da dove parte tutto. */
const glifo = (r, side) => {
    if (side === 'dif') return '<line x1="-5.5" y1="-5.5" x2="5.5" y2="5.5" /><line x1="5.5" y1="-5.5" x2="-5.5" y2="5.5" />';
    return '<circle r="7" />' + (r === 'qb' ? '<line x1="-4.5" y1="0" x2="4.5" y2="0" />' : '');
};

/* Un marker che sta fermo. Il glifo sta in un gruppo DENTRO quello che lo
   posiziona, e non e' pignoleria: la posizione e' un attributo `transform`, e
   una regola CSS che animi `transform` sullo stesso elemento lo sovrascrive —
   l'uomo di linea non si muoverebbe di due unita', schizzerebbe nell'origine
   del campo. Due gruppi, due trasformazioni che si compongono. */
const fermo = (p, side, extra = '') =>
    `<g transform="translate(${p.x} ${p.y})"><g class="tl-play-man tl-play-${side} ${extra}">${glifo(p.r, side)}</g></g>`;

/* Un marker che si muove: il glifo e' disegnato NELL'ORIGINE e portato sul
   percorso da `offset-path`. Se avesse coordinate proprie si sommerebbero a
   quelle del tracciato e partirebbe spostato. */
const corre = (d, p, side, cls) =>
    `<g class="tl-play-man tl-play-${side} ${cls} tl-t-${p.t || 'm'}" style="offset-path: path('${d}')">${glifo(p.r, side)}</g>`;

/* La traccia. `pathLength="100"` normalizza ogni tracciato a 100 unita': cosi'
   `stroke-dashoffset` (la linea che si disegna) e `offset-distance` (il
   giocatore che corre) parlano la stessa lingua e restano agganciati senza
   sapere nulla della lunghezza vera. Senza, un go da 120 unita' e un blocco da
   12 si sfasano e il marker corre staccato dalla sua traccia. */
const traccia = (d, side, p) =>
    `<path class="tl-play-linea tl-play-${side} tl-t-${p.t || 'm'}" pathLength="100" d="${d}" />`;

function disegnaGiocata(g) {
    const linee = [], pre = [], uomini = [];
    const olPull = g.pull ? g.pull.da : null;

    // linea offensiva: cinque O sulla scrimmage. Quella che pulla non sta
    // ferma, quindi diventa un corridore come gli altri.
    for (const x of OL) {
        if (x === olPull) {
            linee.push(traccia(g.pull.via, 'att', g.pull));
            uomini.push(corre(g.pull.via, { x, y: 150, t: g.pull.t }, 'att', 'tl-play-run'));
        } else {
            uomini.push(fermo({ x, y: 150 }, 'att', 'tl-play-ol'));
        }
    }

    for (const [side, gruppo] of [['att', g.att], ['dif', g.dif]]) {
        for (const p of gruppo) {
            if (p.pre) {
                // due marker: uno fa il pre-snap e si spegne, l'altro si
                // accende allo snap e corre la giocata
                pre.push(`<path class="tl-play-pre tl-play-${side}" d="${p.pre}" />`);
                uomini.push(corre(p.pre, p, side, 'tl-play-pre-run'));
                if (p.via) {
                    linee.push(traccia(p.via, side, p));
                    uomini.push(corre(p.via, p, side, 'tl-play-run tl-play-tardi'));
                }
            } else if (p.via) {
                linee.push(traccia(p.via, side, p));
                uomini.push(corre(p.via, p, side, 'tl-play-run'));
            } else {
                uomini.push(fermo(p, side, p.r === 'dl' ? 'tl-play-dl' : ''));
            }
        }
    }

    return `
<svg class="tl-play" viewBox="0 0 400 240" role="img" aria-label="Loading" focusable="false">
  <!-- la lavagna: hash mark e linea di scrimmage, nient'altro. Un campo intero
       qui sarebbe rumore: uno schema si legge per quello che NON disegna. -->
  <g class="tl-play-board">
    <line class="tl-play-hash" x1="16" y1="104" x2="384" y2="104" />
    <line class="tl-play-hash" x1="16" y1="58" x2="384" y2="58" />
    <line class="tl-play-los" x1="16" y1="150" x2="384" y2="150" />
  </g>
  <!-- in basso a sinistra: in alto ci passano le route verticali e ci
       stanno i difensori profondi, e il testo ci finiva sotto -->
  <text class="tl-play-nome" x="16" y="222">${esc0(g.nome)}</text>
  <text class="tl-play-vs" x="16" y="234">vs ${esc0(g.vs)}</text>
  <g class="tl-play-pre-g">${pre.join('')}</g>
  <g class="tl-play-linee">${linee.join('')}</g>
  <g class="tl-play-uomini">${uomini.join('')}</g>
</svg>`;
}

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/**
 * La lavagna tattica. `label` e' la riga sotto, gia' in inglese.
 * `quale` sceglie la giocata; senza, ne esce una a caso — cosi' due
 * caricamenti di fila non sono lo stesso disegno. Il banco di prova le chiede
 * per indice per mostrarle tutte.
 */
export function playLoader(label = '', quale) {
    const g = PLAYBOOK[Number.isInteger(quale) ? quale % PLAYBOOK.length
        : Math.floor(Math.random() * PLAYBOOK.length)];
    return `<div class="tl-page">${disegnaGiocata(g)}${label ? `<p class="tl-page-label">${esc(label)}</p>` : ''}</div>`;
}

/**
 * Mette la lavagna dentro `el`, MA SOLO SE non ce n'e' gia' una.
 *
 * Serve perche' i contenitori marcati `data-page-loader` in index.html la
 * ricevono prima ancora che app.js sia arrivato. Quando poi la sezione parte e
 * scrive il suo caricamento, senza questo controllo ne disegnerebbe una nuova:
 * e siccome ne esce una a caso, l'utente vedrebbe la giocata CAMBIARE da sola
 * dopo mezzo secondo.
 * Al cambio d'anno invece il contenitore ha dentro una tabella, non un
 * caricamento, e allora si ridisegna: e' proprio quello che deve succedere.
 */
export function pageLoadingInto(el, label = '') {
    if (!el) return;
    if (el.querySelector('.tl-page')) return;
    el.innerHTML = playLoader(label);
}

/** Quante giocate ci sono — la usa preview-loaders.html per stamparle tutte. */
export function playCount() {
    return PLAYBOOK.length;
}

/**
 * Il logo della squadra che si riempie.
 *
 * Due strati dello STESSO file: sotto il logo spento, sopra lo stesso logo a
 * colori pieni, ritagliato da una linea che sale. Il logo resta quello vero —
 * una sagoma piena avrebbe perso i dettagli interni.
 * Il riempimento e' a ciclo continuo e non si ferma mai a una percentuale: la
 * pagina squadra fa UNA fetch sola, non sappiamo a che punto e', e una barra
 * che si pianta all'80%% direbbe una cosa che non sa.
 */
export function teamLoader(logo, color, label = '') {
    return `<div class="tl-page">
  <div class="tl-fill" style="--team-color: ${esc(color)}">
    <img class="tl-fill-dim" src="${esc(logo)}" alt="" aria-hidden="true">
    <img class="tl-fill-lit" src="${esc(logo)}" alt="" aria-hidden="true">
    <span class="tl-fill-line" aria-hidden="true"></span>
  </div>
  ${label ? `<p class="tl-page-label">${esc(label)}</p>` : ''}
</div>`;
}
