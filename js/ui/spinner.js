/**
 * Topina League — il logo di caricamento.
 *
 * Un ricevitore che corre sulla linea, la palla arriva da destra, lui la
 * prende e riparte con la palla in mano. È la scena disegnata dentro OGNI
 * `<div class="spinner">` del sito: i punti che lo stampano sono ~70, sparsi
 * fra index.html e le sezioni che scrivono in innerHTML, quindi invece di
 * toccarli tutti riempiamo l'elemento da qui.
 *
 * Le sezioni creano gli spinner molto dopo il boot (ogni fetch ne stampa uno),
 * perciò serve un MutationObserver: senza, si vedrebbe la scena solo su quelli
 * già presenti nell'HTML statico.
 *
 * Il movimento sta tutto in main.css (`.tl-run-*`): qui c'è solo la geometria.
 */

const ART = `
<svg class="tl-run" viewBox="0 0 76 46" role="img" aria-label="Loading" focusable="false">
  <!-- scie di velocità dietro le spalle, come nei pittogrammi del corridore -->
  <g class="tl-run-speed">
    <line class="tl-run-streak" x1="2" y1="12" x2="12" y2="12" />
    <line class="tl-run-streak tl-run-streak-2" x1="1" y1="20" x2="13" y2="20" />
    <line class="tl-run-streak tl-run-streak-3" x1="3" y1="28" x2="11" y2="28" />
  </g>
  <!-- la linea di corsa: i trattini scorrono all'indietro, così sembra che avanzi -->
  <line class="tl-run-line" x1="2" y1="38" x2="74" y2="38" />
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
    <!-- Braccia: spalla (24.5,14), gomito a 6, mano a 11.5 da spalla a braccio
         steso. Il punto di presa nei keyframe deve stare dentro quel raggio e
         a più di 7 dalla testa, se no la palla ci finisce sopra: la presa è a
         (32.5,10), cioè 8.9 dalla spalla e 6.9 dalla testa. -->
    <g class="tl-run-arm tl-run-arm-b">
      <line x1="24.5" y1="14" x2="24.5" y2="20" />
      <g class="tl-run-forearm"><line x1="24.5" y1="20" x2="24.5" y2="25.5" /></g>
    </g>
    <g class="tl-run-arm tl-run-arm-a">
      <line x1="24.5" y1="14" x2="24.5" y2="20" />
      <g class="tl-run-forearm"><line x1="24.5" y1="20" x2="24.5" y2="25.5" /></g>
    </g>
  </g>
  <!-- palla: entra da destra in parabola, poi resta agganciata al fianco -->
  <g class="tl-run-ball">
    <ellipse class="tl-run-ball-body" cx="0" cy="0" rx="4.2" ry="2.7" />
    <line class="tl-run-lace" x1="-2" y1="0" x2="2" y2="0" />
    <line class="tl-run-lace" x1="-1.1" y1="-0.6" x2="-1.1" y2="0.6" />
    <line class="tl-run-lace" x1="0" y1="-0.6" x2="0" y2="0.6" />
    <line class="tl-run-lace" x1="1.1" y1="-0.6" x2="1.1" y2="0.6" />
  </g>
</svg>`;

function paint(el) {
    if (el.dataset.tlArt) return;
    el.dataset.tlArt = '1';
    el.innerHTML = ART;
}

function paintAll(root) {
    if (root.classList?.contains('spinner')) paint(root);
    root.querySelectorAll?.('.spinner').forEach(paint);
}

export function startLoadingArt() {
    paintAll(document.body);
    new MutationObserver((muts) => {
        for (const m of muts) {
            for (const node of m.addedNodes) {
                if (node.nodeType === 1) paintAll(node);
            }
        }
    }).observe(document.body, { childList: true, subtree: true });
}
