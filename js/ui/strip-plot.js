/**
 * Strip plot con banda del caso.
 *
 * Una riga per tratto, i quattro allenatori come punti su un asse in σ, e
 * dietro una fascia ombreggiata: dentro quella fascia c'è il caso.
 *
 * Perché non basta `dotPlot` o `dumbbell` di js/ui/charts.js: il primo confronta
 * un valore con un riferimento, il secondo esattamente due serie. Qui servono
 * quattro punti sulla stessa riga E la banda dietro, che è il pezzo che rende
 * onesto il grafico — senza, quattro pallini sparsi sembrano sempre dire
 * qualcosa. La banda viene dal test maxT del builder (95° percentile del massimo
 * |z| su tutti i tratti sotto ipotesi nulla), quindi non è decorazione: è la
 * soglia oltre la quale una differenza non si spiega col caso.
 *
 * Sta in un file suo invece che dentro charts.js per non toccare quel modulo:
 * modificarlo obbligherebbe a bumpare `?v=` nei suoi quattro importatori
 * (game.js, predraft.js, analysis.js, projections.js) per una funzione che usa
 * solo questa sezione. Importa da lì le primitive condivise, non le duplica.
 *
 * Stesso contratto delle altre forme: dati piatti dentro, STRINGA HTML fuori,
 * tooltip `<title>` nativi, nessuna idratazione da ricordarsi dopo.
 */

import { niceTicks, inkFor } from './charts.js?v=7';

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

/**
 * `rows`: [{ label, tier, note, points: [{ key, name, color, z, raw }] }]
 * `opts`: { band, width, rowH, labelW, fmtRaw(v, row) }
 *
 * `tier` colora l'etichetta di riga: solo `signature` ha diritto a essere
 * raccontata a parole, il resto sono numeri e basta.
 */
export function stripPlot(rows, opts = {}) {
    const righe = (rows || []).filter((r) => r?.points?.some((p) => p && p.z != null));
    if (!righe.length) return '';

    const W = opts.width || 880;
    const L = opts.labelW || 250;
    const R = opts.rightW || 54;
    const rowH = opts.rowH || 30;
    const T = 22;
    const bottom = T + righe.length * rowH;
    const H = bottom + 28;
    const plotW = W - L - R;

    const zs = righe.flatMap((r) => r.points.map((p) => p.z).filter((z) => z != null));
    const lim = Math.max(2, Math.ceil(Math.max(...zs.map(Math.abs)) * 2) / 2);
    const ticks = niceTicks(-lim, lim, 4);
    const lo = ticks[0];
    const hi = ticks[ticks.length - 1];
    const xx = (z) => L + ((z - lo) / ((hi - lo) || 1)) * plotW;

    const band = opts.band || 0;
    const banda = band
        ? `<rect x="${xx(-band).toFixed(1)}" y="${T - 6}" width="${(xx(band) - xx(-band)).toFixed(1)}"
                 height="${bottom - T + 6}" class="dna-strip-band"/>
           <text x="${xx(0).toFixed(1)}" y="${T - 10}" class="an-tick" text-anchor="middle">← il caso →</text>`
        : '';

    const grid = ticks.map((v) => `
        <line x1="${xx(v).toFixed(1)}" y1="${T - 6}" x2="${xx(v).toFixed(1)}" y2="${bottom}"
              class="an-gridline"${v === 0 ? ' opacity="0.55"' : ''}/>
        <text x="${xx(v).toFixed(1)}" y="${H - 9}" class="an-tick" text-anchor="middle">${v > 0 ? '+' : ''}${v}σ</text>`).join('');

    const corpi = righe.map((r, i) => {
        const yc = T + i * rowH + rowH / 2;
        const pts = r.points.filter((p) => p && p.z != null).sort((a, b) => a.z - b.z);
        const dots = pts.map((p) => {
            const raw = opts.fmtRaw ? opts.fmtRaw(p.raw, r) : (p.raw == null ? '—' : Math.round(p.raw * 10) / 10);
            return `
            <circle cx="${xx(p.z).toFixed(1)}" cy="${yc}" r="5" fill="${inkFor(p.color)}"
                    stroke="#000" stroke-width="1.5" class="dna-dot">
                <title>${esc(p.name)} — ${esc(r.label)}: ${raw} (${p.z >= 0 ? '+' : ''}${p.z.toFixed(2)}σ)</title>
            </circle>`;
        }).join('');
        // la lineetta che unisce gli estremi dà l'ampiezza della differenza a
        // colpo d'occhio, prima ancora di leggere dove sta ciascuno
        const est = pts.length > 1
            ? `<line x1="${xx(pts[0].z).toFixed(1)}" y1="${yc}" x2="${xx(pts[pts.length - 1].z).toFixed(1)}" y2="${yc}"
                     stroke="var(--text-muted)" stroke-width="1.5" opacity="0.35" stroke-linecap="round"/>`
            : '';
        return `
        <g>
            <text x="${L - 12}" y="${yc + 4}" class="an-tick dna-strip-label dna-tier-${esc(r.tier || 'noise')}"
                  text-anchor="end">${esc(r.label)}</text>
            ${est}${dots}
        </g>`;
    }).join('');

    return `<div class="an-scroll"><svg viewBox="0 0 ${W} ${H}" class="an-svg an-svg--wide">${banda}${grid}${corpi}</svg></div>`;
}
