/**
 * Il campo del Live, disegnato invece che fotografato.
 *
 * Prima era una foto: pesava, aveva la sua luce e i suoi verdi, e per rendere
 * leggibili le figurine sopra andava schiarita, scurita e velata. Qui il campo
 * nasce già del colore giusto — grafite con un verde spento — e le linee sono
 * tenui per scelta, non per correzione.
 *
 * Vista dall'alto con la end zone in cima, come la formazione che ci sta
 * sopra: le yard line corrono orizzontali e i giocatori stanno su righe
 * parallele a quelle. Le proporzioni non sono quelle vere di un campo (che
 * sarebbe lunghissimo e stretto): è la porzione attorno alla end zone, quella
 * che serve a far capire dove si sta guardando.
 *
 * `--tc-sel` tinge la end zone del colore della squadra selezionata; senza,
 * resta il rosso di lega.
 */

const VB_W = 1000;
// Il riquadro è più largo che alto e cambia con la formazione: il disegno si
// ancora IN ALTO (`xMidYMin`), così end zone e pali restano sempre in vista e
// a essere tagliate sono semmai le yard line in fondo.
const VB_H = 640;
const EZ_H = 168;          // altezza della end zone
const YARD_GAP = 54;       // distanza fra due yard line

/** Le yard line sotto la end zone, con il numero ogni due. */
function yardLines() {
    const out = [];
    for (let i = 0, y = EZ_H; y <= VB_H - 10; i++, y += YARD_GAP) {
        const grossa = i % 2 === 0;                 // ogni 10 yard
        out.push(`<line x1="0" y1="${y}" x2="${VB_W}" y2="${y}"
            stroke="rgba(255,255,255,${grossa ? 0.16 : 0.075})" stroke-width="${grossa ? 2.4 : 1.4}"/>`);
        if (grossa && i > 0) {
            // Le linee grosse sono una ogni due: il numero segue quelle, non
            // tutte. Si conta dall'ALTO — 10, 20, 30, 40 — come scendendo il
            // campo dalla propria end zone; oltre meta' campo si torna
            // indietro, che e' come sono dipinti i numeri veri.
            const k = i / 2;
            const n = k <= 5 ? k * 10 : (10 - k) * 10;
            if (n > 0) {
                // `y` e non `y + 30`: il numero sta A CAVALLO della riga. Le
                // due cifre, che la rotazione impila una sopra l'altra, la
                // lasciano passare in mezzo — con `dominant-baseline: central`
                // nel CSS il centro del testo cade esattamente sulla linea.
                out.push(`<text x="70" y="${y}" class="fsv-num">${n}</text>`);
                out.push(`<text x="${VB_W - 70}" y="${y}" class="fsv-num fsv-num--r">${n}</text>`);
            }
        }
    }
    return out.join('');
}

/** I trattini al centro del campo, due file, uno ogni yard. */
function hashMarks() {
    const out = [];
    for (let y = EZ_H + YARD_GAP / 5; y < VB_H - 6; y += YARD_GAP / 5) {
        for (const x of [VB_W * 0.36, VB_W * 0.64]) {
            out.push(`<line x1="${x - 9}" y1="${y}" x2="${x + 9}" y2="${y}"
                stroke="rgba(255,255,255,0.09)" stroke-width="1.6"/>`);
        }
    }
    return out.join('');
}

export function fieldSVG() {
    return `
    <svg class="field-bg field-svg" viewBox="0 0 ${VB_W} ${VB_H}"
         preserveAspectRatio="xMidYMin slice" aria-hidden="true" focusable="false">
        <defs>
            <linearGradient id="fsv-turf" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stop-color="#1b2422"/>
                <stop offset="0.55" stop-color="#141c1b"/>
                <stop offset="1" stop-color="#0d1413"/>
            </linearGradient>
            <linearGradient id="fsv-ez" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stop-color="var(--tc-sel, #b8433a)" stop-opacity="0.34"/>
                <stop offset="1" stop-color="var(--tc-sel, #b8433a)" stop-opacity="0.12"/>
            </linearGradient>
            <!-- riga d'erba: il taglio del prato, appena percettibile -->
            <pattern id="fsv-mow" width="1" height="${YARD_GAP * 2}" patternUnits="userSpaceOnUse">
                <rect width="${VB_W}" height="${YARD_GAP}" fill="rgba(255,255,255,0.014)"/>
            </pattern>
        </defs>

        <rect width="${VB_W}" height="${VB_H}" fill="url(#fsv-turf)"/>
        <rect width="${VB_W}" height="${VB_H}" fill="url(#fsv-mow)"/>

        <!-- end zone: da bordo a bordo, senza cornice -->
        <rect x="0" y="0" width="${VB_W}" height="${EZ_H}" fill="url(#fsv-ez)"/>
        <line x1="0" y1="${EZ_H}" x2="${VB_W}" y2="${EZ_H}"
              stroke="rgba(255,255,255,0.28)" stroke-width="3"/>

        ${yardLines()}
        ${hashMarks()}
    </svg>`;
}
