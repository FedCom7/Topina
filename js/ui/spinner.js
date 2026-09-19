/**
 * Topina League — i loghi di caricamento.
 *
 * Due scene, stesso mestiere:
 *  - `run`  — un ricevitore corre sulla linea, la palla arriva da destra, lui
 *             la prende e riparte con la palla in mano.
 *  - `pass` — due omini uno di fronte all'altro: il quarterback carica, lancia,
 *             la palla vola in parabola e il ricevitore la prende e la stringe.
 *
 * Sono la scena disegnata dentro OGNI `<div class="spinner">` del sito: i punti
 * che lo stampano sono ~70, sparsi fra index.html e le sezioni che scrivono in
 * innerHTML, quindi invece di toccarli tutti riempiamo l'elemento da qui.
 *
 * Le sezioni creano gli spinner molto dopo il boot (ogni fetch ne stampa uno),
 * perciò serve un MutationObserver: senza, si vedrebbe la scena solo su quelli
 * già presenti nell'HTML statico.
 *
 * Il movimento sta tutto in main.css (`.tl-run-*`, `.tl-pass-*`): qui c'è solo
 * la geometria.
 */

const RUN = `
<!-- L'ORDINE DI DISEGNO E' LA PROFONDITA'. La palla, una volta presa, va SOTTO
     tutte e due le braccia: e' cosi' che si tiene un pallone contro il petto,
     con gli avambracci che gli passano davanti, ed e' cio' che la fa sembrare
     tenuta invece che appiccicata addosso.
     Per ottenerlo l'omino e' disegnato in DUE PEZZI con la palla in mezzo.
     I due pezzi ripetono lo stesso gruppo tl-run-guy, quindi prendono la
     stessa oscillazione della corsa e partono insieme: restano incollati.
     La palla invece sta FUORI da quel gruppo, e deve restarci: l'oscillazione
     e' di 1.4 unita' ogni 0.2s, e addosso a una palla in volo non sarebbe un
     passo di corsa, sarebbe uno svolazzo. -->
<svg class="tl-run" viewBox="0 0 76 46" role="img" aria-label="Loading" focusable="false">
  <!-- scie di velocità dietro le spalle, come nei pittogrammi del corridore -->
  <g class="tl-run-speed">
    <line class="tl-run-streak" x1="2" y1="12" x2="12" y2="12" />
    <line class="tl-run-streak tl-run-streak-2" x1="1" y1="20" x2="13" y2="20" />
    <line class="tl-run-streak tl-run-streak-3" x1="3" y1="28" x2="11" y2="28" />
  </g>
  <!-- la linea di corsa: i trattini scorrono all'indietro, così sembra che avanzi -->
  <line class="tl-run-line" x1="2" y1="38" x2="74" y2="38" />

  <!-- 1. gambe, busto e testa: sotto la palla -->
  <g class="tl-run-guy">
    <!-- Gambe e braccia sono snodate: coscia+stinco, braccio+avambraccio.
         Con le aste dritte la falcata si leggeva come una camminata — la corsa
         la fanno il ginocchio che si piega dietro e il gomito tenuto chiuso. -->
    <g class="tl-run-leg tl-run-leg-b">
      <line x1="20.5" y1="25" x2="20.5" y2="31.5" />
      <g class="tl-run-shin"><line x1="20.5" y1="31.5" x2="20.5" y2="38" /></g>
    </g>
    <g class="tl-run-leg tl-run-leg-a">
      <line x1="20.5" y1="25" x2="20.5" y2="31.5" />
      <g class="tl-run-shin"><line x1="20.5" y1="31.5" x2="20.5" y2="38" /></g>
    </g>
    <!-- Busto inclinato 20° in avanti: anca (20.5,25), spalla (24.5,14). È
         l'assetto del pittogramma; oltre i 25° la figura si legge come uno che
         cade in avanti, non come uno che corre. La testa sta SOPRA la spalla,
         appena avanti: spostandola più avanti va a finire sulla traiettoria
         della palla. -->
    <line class="tl-run-torso" x1="24.5" y1="14" x2="20.5" y2="25" />
    <circle class="tl-run-head" cx="25.8" cy="8.2" r="3.5" />
  </g>

  <!-- 2. la palla: sopra il corpo, sotto le braccia che la stringono.
       In volo entra da destra in parabola col muso sempre sulla tangente; una
       volta presa la sua posizione non si sceglie, si calcola dalle mani (il
       conto sta nel commento dei keyframe, in main.css).
       La spirale non è l'ovale che ruota (quello sarebbe una palla che gira su
       se stessa a campanile): l'asse lungo sta fermo sulla traiettoria e a
       girargli intorno sono le cuciture, che salgono sulla faccia, si
       appiattiscono sul bordo e ricompaiono dal basso. Per questo le cuciture
       stanno in un gruppo a parte: la loro animazione vive nel sistema di
       riferimento della palla già orientata. -->
  <g class="tl-run-ball">
    <ellipse class="tl-run-ball-body" cx="0" cy="0" rx="4.2" ry="2.7" />
    <g class="tl-run-laces">
      <line class="tl-run-lace" x1="-2" y1="0" x2="2" y2="0" />
      <line class="tl-run-lace" x1="-1.1" y1="-0.6" x2="-1.1" y2="0.6" />
      <line class="tl-run-lace" x1="0" y1="-0.6" x2="0" y2="0.6" />
      <line class="tl-run-lace" x1="1.1" y1="-0.6" x2="1.1" y2="0.6" />
    </g>
  </g>

  <!-- 3. le braccia: sopra la palla, sono loro a farla sembrare tenuta.
       Spalla (24.5,14), gomito a 6, mano a 11.5 da spalla a braccio steso. Il
       punto di presa nei keyframe deve stare dentro quel raggio e a più di 7
       dalla testa, se no la palla ci finisce sopra. -->
  <g class="tl-run-guy">
    <g class="tl-run-arm tl-run-arm-b">
      <line x1="24.5" y1="14" x2="24.5" y2="20" />
      <g class="tl-run-forearm"><line x1="24.5" y1="20" x2="24.5" y2="25.5" /></g>
    </g>
    <g class="tl-run-arm tl-run-arm-a">
      <line x1="24.5" y1="14" x2="24.5" y2="20" />
      <g class="tl-run-forearm"><line x1="24.5" y1="20" x2="24.5" y2="25.5" /></g>
    </g>
  </g>
</svg>`;

/* La scena del lancio: due omini che si passano la palla, avanti e indietro.
   Stesso rig snodato e stesse proporzioni del corridore (tratto 4.6, testa
   r 3.5, braccio 6+5.5, gamba 6.5+6.5).

   Le due figure sono IDENTICHE e ribaltate attorno a x=77: anche in 20 e 134,
   spalle in 24 e 130, teste in 25.3 e 128.7 — ogni coppia somma 154. Non e'
   una coincidenza da preservare per pignoleria: mezzo ciclo dopo, chi ha
   lanciato riceve, e tutti i keyframe della figura di destra sono quelli della
   sinistra specchiati. Spostare un'anca senza spostare l'altra scollega la
   palla dalle mani. Le rotazioni le genera scripts/gen-pass-loader.py; qui
   c'e' solo la geometria.

   Sono scritte con le coordinate per esteso invece che specchiate con uno
   `scale(-1,1)`, perche' dentro un gruppo ribaltato i `transform-origin` in
   coordinate view-box diventano una trappola.

   Ogni figura ha un gruppo `-upper` con busto, testa e braccia, che ruota
   attorno all'anca: e' la separazione anca-spalle del lancio. */
const PASS = `
<!-- Il viewBox parte da -6, non da 0: il campo e' sempre alto 46 (terra a
     y=38), ma sopra le teste serve aria per la parabola. Con il tetto a 0 la
     palla all'apice usciva dal riquadro e veniva tagliata dal contenitore.

     L'ORDINE DI DISEGNO QUI E' LA PROFONDITA', e non si tocca a caso.
     Tutti e due sono DESTRIMANI e si guardano: di quello a sinistra vediamo il
     fianco sinistro (il suo destro, quello che lancia, e' LONTANO e spento), di
     quello a destra il fianco destro (il braccio del lancio e' VICINO, a piena
     tinta). E' l'unica disposizione possibile per due destrimani girati al
     contrario, e decide da che parte passa la palla:
       - la palla sta SOTTO tutto l'omino di sinistra, perche' lui la tiene col
         braccio lontano: quando si sovrappone al busto sparisce dietro;
       - sta SOPRA il corpo di quello di destra ma SOTTO il suo braccio che
         lancia, perche' lui la tiene col braccio vicino.
     Per ottenerlo la figura di destra e' disegnata in DUE PEZZI, con la palla
     in mezzo: il corpo prima, il braccio del lancio dopo. I due pezzi ripetono
     gli stessi gruppi tl-pass-r e tl-pass-r-upper, quindi prendono la
     stessa identica animazione e partono insieme: restano incollati. -->
<svg class="tl-pass" viewBox="0 -6 154 52" role="img" aria-label="Loading" focusable="false">
  <line class="tl-pass-line" x1="2" y1="38" x2="152" y2="38" />

  <!-- 1. il corpo di destra, senza il braccio che lancia: va SOTTO la palla -->
  <g class="tl-pass-r">
    <g class="tl-pass-r-leg tl-pass-r-leg-b tl-pass-far">
      <line x1="134" y1="25" x2="134" y2="31.5" />
      <g class="tl-pass-r-shin"><line x1="134" y1="31.5" x2="134" y2="38" /></g>
    </g>
    <g class="tl-pass-r-leg tl-pass-r-leg-a">
      <line x1="134" y1="25" x2="134" y2="31.5" />
      <g class="tl-pass-r-shin"><line x1="134" y1="31.5" x2="134" y2="38" /></g>
    </g>
    <g class="tl-pass-r-upper">
      <line class="tl-pass-torso" x1="130" y1="14" x2="134" y2="25" />
      <circle class="tl-pass-head" cx="128.7" cy="8.2" r="3.5" />
      <!-- il suo braccio libero e' il SINISTRO, quindi quello lontano -->
      <g class="tl-pass-r-arm tl-pass-r-arm-off tl-pass-far">
        <line x1="130" y1="14" x2="130" y2="20" />
        <g class="tl-pass-r-forearm"><line x1="130" y1="20" x2="130" y2="25.5" /></g>
      </g>
    </g>
  </g>

  <!-- 2. la palla: sopra il corpo di destra, sotto tutto quello di sinistra -->
  <g class="tl-pass-ball">
    <ellipse class="tl-pass-ball-body" cx="0" cy="0" rx="4.2" ry="2.7" />
    <g class="tl-pass-laces">
      <line class="tl-pass-lace" x1="-2" y1="0" x2="2" y2="0" />
      <line class="tl-pass-lace" x1="-1.1" y1="-0.6" x2="-1.1" y2="0.6" />
      <line class="tl-pass-lace" x1="0" y1="-0.6" x2="0" y2="0.6" />
      <line class="tl-pass-lace" x1="1.1" y1="-0.6" x2="1.1" y2="0.6" />
    </g>
  </g>

  <!-- 3. l'omino di sinistra, intero: sta tutto SOPRA la palla -->
  <g class="tl-pass-l">
    <g class="tl-pass-l-leg tl-pass-l-leg-b tl-pass-far">
      <line x1="20" y1="25" x2="20" y2="31.5" />
      <g class="tl-pass-l-shin"><line x1="20" y1="31.5" x2="20" y2="38" /></g>
    </g>
    <g class="tl-pass-l-leg tl-pass-l-leg-a">
      <line x1="20" y1="25" x2="20" y2="31.5" />
      <g class="tl-pass-l-shin"><line x1="20" y1="31.5" x2="20" y2="38" /></g>
    </g>
    <g class="tl-pass-l-upper">
      <line class="tl-pass-torso" x1="24" y1="14" x2="20" y2="25" />
      <circle class="tl-pass-head" cx="25.3" cy="8.2" r="3.5" />
      <!-- il suo braccio del lancio e' il DESTRO, che da questo lato e' quello
           lontano: spento, e disegnato prima di quello libero -->
      <g class="tl-pass-l-arm tl-pass-l-arm-throw tl-pass-far">
        <line x1="24" y1="14" x2="24" y2="20" />
        <g class="tl-pass-l-forearm"><line x1="24" y1="20" x2="24" y2="25.5" /></g>
      </g>
      <g class="tl-pass-l-arm tl-pass-l-arm-off">
        <line x1="24" y1="14" x2="24" y2="20" />
        <g class="tl-pass-l-forearm"><line x1="24" y1="20" x2="24" y2="25.5" /></g>
      </g>
    </g>
  </g>

  <!-- 4. il braccio che lancia di quello a destra: e' il suo DESTRO, cioe' il
          vicino, quindi va per ultimo — sopra la palla che impugna -->
  <g class="tl-pass-r">
    <g class="tl-pass-r-upper">
      <g class="tl-pass-r-arm tl-pass-r-arm-throw">
        <line x1="130" y1="14" x2="130" y2="20" />
        <g class="tl-pass-r-forearm"><line x1="130" y1="20" x2="130" y2="25.5" /></g>
      </g>
    </g>
  </g>
</svg>`;

const ART = { run: RUN, pass: PASS };
const NAMES = Object.keys(ART);

/* Quale scena si vede lo si decide UNA volta per caricamento pagina, non per
   elemento: su una pagina gli spinner accesi insieme sono anche dieci (la
   pagina squadra ne stampa otto in un colpo) e vederne metà correre e metà
   lanciare sembrerebbe un baco, non una variante. */
let current = NAMES[Math.floor(Math.random() * NAMES.length)];

/** Forza una delle due scene per il resto della sessione: 'run' | 'pass'. */
export function setLoadingArt(name) {
    if (ART[name]) current = name;
    return current;
}

/** Le scene disponibili — la usa preview-loaders.html per stamparle tutte. */
export function loadingArtNames() {
    return NAMES.slice();
}

function paint(el) {
    if (el.dataset.tlArt) return;
    /* `data-art` sul singolo spinner ha la precedenza: serve alla pagina di
       prova e a chi volesse fissare una scena in un punto solo del sito.
       Va riscritto comunque, perché è lui a dare la misura giusta al riquadro
       (le due scene hanno proporzioni diverse). */
    const name = ART[el.dataset.art] ? el.dataset.art : current;
    el.dataset.art = name;
    el.dataset.tlArt = '1';
    el.innerHTML = ART[name];
}

function paintAll(root) {
    if (root.classList?.contains('spinner')) paint(root);
    root.querySelectorAll?.('.spinner').forEach(paint);
}

let avviato = false;

/**
 * Riempie gli spinner gia' in pagina e sorveglia quelli che arriveranno.
 *
 * La chiamano in DUE punti: il modulo in testa a index.html, che parte subito,
 * e js/app.js. Il primo esiste perche' senza di lui ogni `.spinner` scritto
 * nell'HTML resta un riquadro VUOTO col suo testo accanto finche' non e'
 * arrivata tutta app.js — una quarantina di moduli — e si vedeva un
 * caricamento fermo per un secondo e mezzo, e solo dopo partiva l'animazione.
 * Misurato: vuoto da 70ms a 1540ms.
 * Chiamarla due volte non raddoppia l'osservatore: il secondo giro esce
 * subito, e i riquadri gia' dipinti li salta `paint()` da se'.
 */
export function startLoadingArt() {
    paintAll(document.body);
    if (avviato) return;
    avviato = true;
    new MutationObserver((muts) => {
        for (const m of muts) {
            for (const node of m.addedNodes) {
                if (node.nodeType === 1) paintAll(node);
            }
        }
    }).observe(document.body, { childList: true, subtree: true });
}
