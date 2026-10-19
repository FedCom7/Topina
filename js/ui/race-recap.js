/**
 * La race del Night Recap: i totali di giornata delle due squadre che salgono
 * mentre il replay avanza. È la "Score race" del Live (`raceSVG` in
 * sections/live.js) ridotta a quello che si legge su un telefono: due linee a
 * gradini, i quarti segnati, il numero in fondo a ogni linea.
 *
 * Due differenze rispetto al Live, volute:
 *
 *  - l'asse è il TEMPO DI GIOCO (Q1 15:00 → fine partita), non l'orologio:
 *    è lo stesso tempo della linea in fondo al recap, e più partite della
 *    notte camminano già sullo stesso cronometro;
 *  - la scala è FISSA dal primo passo. I totali finali si conoscono già (sono
 *    quelli ufficiali), e una scala che si ricalcola mentre la linea sale
 *    farebbe ballare tutto il disegno a ogni gradino.
 *
 * Niente DOM e niente rete: riceve lo stato e restituisce l'SVG.
 */

const W = 360, H = 150, L = 6, R = 72, T = 16, B = 18;

/** Secondi di gioco trascorsi a un passo: 0 al kickoff, 3600 a fine Q4. */
export function secondiGiocati(periodo, clock) {
    const m = String(clock || '').match(/^(\d+):(\d{2})$/);
    if (!m || periodo == null) return null;
    const sec = Number(m[1]) * 60 + Number(m[2]);
    if (periodo <= 4) return (periodo - 1) * 900 + (900 - sec);
    // Supplementari da dieci minuti: in stagione regolare sono così.
    return 3600 + (periodo - 5) * 600 + Math.max(0, 600 - sec);
}

const fmt = (n) => (+n).toFixed(1);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/**
 * @param o.lati   [{ nome, tinta, base, finale, punti: [{ t, v, td }] }] — `punti`
 *                 sono i gradini già avvenuti, `base` il totale prima di
 *                 stanotte, `finale` quello ufficiale (fissa la scala)
 * @param o.ora    secondi di gioco del passo corrente
 * @param o.durata secondi di gioco della partita più lunga (3600 + OT)
 */
export function raceRecapSVG({ lati, ora, durata = 3600 }) {
    const tMax = Math.max(3600, durata);
    const x = (t) => L + (Math.max(0, Math.min(tMax, t)) / tMax) * (W - L - R);

    const tutti = lati.flatMap(l => [l.base, l.finale, ...l.punti.map(p => p.v)]);
    let lo = Math.min(...tutti), hi = Math.max(...tutti);
    const pad = Math.max(2, (hi - lo) * 0.08);
    lo -= pad; hi += pad;
    const y = (v) => T + (1 - (v - lo) / (hi - lo || 1)) * (H - T - B);

    // I quarti: la stessa scansione della linea del tempo in fondo.
    const tacche = [900, 1800, 2700, ...(tMax > 3600 ? [3600] : [])];
    const nomiQ = ['Q1', 'Q2', 'Q3', 'Q4', 'OT'];
    const griglia = tacche.map(t => `<line class="nr-race-q" x1="${fmt(x(t))}" y1="${T}" x2="${fmt(x(t))}" y2="${H - B}"/>`).join('')
        + [0, 900, 1800, 2700, ...(tMax > 3600 ? [3600] : [])].map((t, i) => {
            const fine = i < tacche.length ? tacche[i] : tMax;
            return `<text class="nr-race-et" x="${fmt((x(t) + x(fine)) / 2)}" y="${H - 4}">${nomiQ[i]}</text>`;
        }).join('');

    const tOra = Math.max(0, Math.min(tMax, ora ?? 0));
    const linee = lati.map(l => {
        let d = `M${fmt(x(0))},${fmt(y(l.base))}`;
        for (const p of l.punti) d += ` H${fmt(x(p.t))} V${fmt(y(p.v))}`;
        d += ` H${fmt(x(tOra))}`;
        return `<path class="nr-race-linea" d="${d}" style="stroke:${l.tinta}"/>`;
    }).join('');

    // I touchdown: il tondo pieno col TD del Live, sopra la linea, dove il
    // gradino arriva.
    const touchdown = lati.map(l => l.punti.filter(p => p.td).map(p => `
        <g class="nr-race-td" style="--c:${l.tinta}">
            <circle cx="${fmt(x(p.t))}" cy="${fmt(y(p.v))}" r="7.5"/>
            <text x="${fmt(x(p.t))}" y="${fmt(y(p.v) + 2.6)}">TD</text>
        </g>`).join('')).join('');

    // Il numero in fondo a ogni linea, scostato se le due finiscono vicine.
    const ultimo = (l) => (l.punti.length ? l.punti[l.punti.length - 1].v : l.base);
    const ye = lati.map(l => y(ultimo(l)));
    if (ye.length === 2 && Math.abs(ye[0] - ye[1]) < 26) {
        const mezzo = (ye[0] + ye[1]) / 2, alto = ye[0] <= ye[1] ? 0 : 1;
        ye[alto] = mezzo - 13; ye[1 - alto] = mezzo + 13;
    }
    const capi = lati.map((l, i) => `
        <circle class="nr-race-capo" cx="${fmt(x(tOra))}" cy="${fmt(y(ultimo(l)))}" r="3.2" style="fill:${l.tinta}"/>
        <text class="nr-race-nome" x="${fmt(x(tOra) + 8)}" y="${fmt(ye[i] - 6)}" style="fill:${l.tinta}">${esc(l.nome)}</text>
        <text class="nr-race-val" x="${fmt(x(tOra) + 8)}" y="${fmt(ye[i] + 7)}" style="fill:${l.tinta}">${fmt(ultimo(l))}</text>`).join('');

    return `
    <svg class="nr-race-svg" viewBox="0 0 ${W} ${H}" role="img"
         aria-label="${esc(lati.map(l => `${l.nome} ${fmt(ultimo(l))}`).join(' vs '))}">
        ${griglia}${linee}${touchdown}${capi}
    </svg>`;
}
