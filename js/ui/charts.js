/**
 * Forme di grafico condivise.
 *
 * Il sito ha già un linguaggio grafico — SVG inline, griglia appena accennata,
 * etichette dirette a fine serie invece della legenda, callout che spiegano il
 * punto saliente — ma finora viveva come funzioni locali dentro le singole
 * sezioni, con `niceTicks` duplicata quattro volte. Questo modulo è la casa
 * condivisa di quelle forme, scritte una volta e parametriche.
 *
 * Contratto uguale per tutte: prendono dati piatti, restituiscono una STRINGA
 * HTML con l'SVG dentro, e i tooltip sono `<title>` nativi — nessun JS di
 * hydration da ricordarsi dopo l'inserimento nel DOM.
 *
 * Le classi sono quelle già globali in css/main.css: `an-svg`, `an-gridline`,
 * `an-tick`, `an-endlabel`, `an-leader`, più `pp-wf-*` per il waterfall e
 * `ts-rdot-*` per il dot plot, riusate invece di duplicarne l'aspetto.
 *
 * Le sezioni che avevano già la loro copia (draftgrade-team, player-page,
 * nfl-team-page) non sono state toccate: migrarle è un lavoro a sé.
 */

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const num = (v) => Number.parseFloat(v) || 0;

/** Tick "belli" (1, 2, 5 × 10^n) che coprono l'intervallo. */
export function niceTicks(min, max, count = 4) {
    const span = max - min || 1;
    const step = Math.pow(10, Math.floor(Math.log10(span / count)));
    const err = span / count / step;
    const mult = err >= 7.5 ? 10 : err >= 3.5 ? 5 : err >= 1.5 ? 2 : 1;
    const s = mult * step;
    const lo = Math.floor(min / s) * s;
    const hi = Math.ceil(max / s) * s;
    const out = [];
    for (let v = lo; v <= hi + 1e-9; v += s) out.push(v);
    return out;
}

/**
 * Colore di tratto leggibile sul fondo scuro.
 *
 * Due dei quattro colori squadra sono molto scuri (#800020, #1c4750): usati tali
 * e quali su fondo nero il tratto sparisce. Si schiariscono verso il bianco solo
 * per il disegno, lasciando intatta l'identità.
 */
export const inkFor = (colore) => `color-mix(in srgb, ${colore || 'var(--accent-red)'} 68%, white 32%)`;

/** Legenda a chiavi colorate: obbligatoria da due serie in su. */
export function legend(voci) {
    if (!voci?.length) return '';
    return `<div class="an-chart-legend">${voci.map(v => `
        <span class="an-legend-item"><i class="an-legend-key" style="background:${v.color}"></i>${esc(v.name)}</span>`).join('')}</div>`;
}

/**
 * Dumbbell: due valori sullo stesso asse, uniti da un segmento.
 *
 * `rows`: [{ label, a, b, tip, meta }] — `a` e `b` sono i due valori da
 * confrontare; `meta` è una scritta incolonnata a destra (i valori per esteso,
 * quando leggerli conta quanto vederli).
 * `opts`: { a: {name, color}, b: {name, color}, fmt, unit, width, labelW, rightW }
 *
 * Il segmento prende il colore di chi è avanti, così la direzione si legge
 * prima ancora dei numeri; a destra lo scarto con il segno.
 *
 * L'asse regge anche valori negativi (es. VORP sotto al replacement): parte
 * da 0 quando tutti i dati sono ≥0 come prima, si allarga verso il negativo
 * solo se serve davvero.
 */
export function dumbbell(rows, opts = {}) {
    const righe = (rows || []).filter(r => r && (r.a != null || r.b != null));
    if (!righe.length) return '';

    const fmt = opts.fmt || ((v) => (Math.round(v * 10) / 10).toFixed(1));
    const inkA = inkFor(opts.a?.color);
    const inkB = inkFor(opts.b?.color);
    const W = opts.width || 860;
    const L = opts.labelW || 74;
    const R = opts.rightW || 68;
    const T = 12;
    const rowH = opts.rowH || 30;
    const bottom = T + righe.length * rowH;
    const H = bottom + 30;

    // l'asse parte da 0 nel caso comune (tutti i valori ≥0, il min(0,…) non
    // sposta nulla), ma si apre verso il negativo quando serve — un valore
    // sotto lo zero altrimenti finiva fuori dal plot, addosso all'etichetta
    // di riga a sinistra.
    const minimo = Math.min(0, ...righe.flatMap(r => [num(r.a), num(r.b)]));
    const massimo = Math.max(...righe.flatMap(r => [num(r.a), num(r.b)]), 1);
    // `min`: il dumbbell codifica POSIZIONI, non lunghezze, quindi partire da un
    // valore diverso da zero non inganna — e a volte serve: con punti fatti e
    // subiti tutti intorno a 2000, un asse da zero schiaccia i quattro segmenti
    // in un pixel e non si vede più niente.
    const ticks = niceTicks(opts.min ?? 0, massimo);
    const xMin = ticks[0];
    const xMax = ticks[ticks.length - 1] || 1;
    const plotW = W - L - R;
    const xx = (v) => L + ((num(v) - xMin) / ((xMax - xMin) || 1)) * plotW;

    const grid = ticks.map(v => `
        <line x1="${xx(v).toFixed(1)}" y1="${T}" x2="${xx(v).toFixed(1)}" y2="${bottom}" class="an-gridline"/>
        <text x="${xx(v).toFixed(1)}" y="${H - 11}" class="an-tick" text-anchor="middle">${fmt(v)}</text>`).join('');

    const corpi = righe.map((r, i) => {
        const yc = T + i * rowH + rowH / 2;
        const va = num(r.a), vb = num(r.b);
        const avanti = va >= vb ? inkA : inkB;
        const d = va - vb;
        const segno = d > 0 ? '+' : '';
        const fine = Math.max(xx(va), xx(vb));
        return `
        <g class="an-dumb">
            <title>${esc(r.tip || r.label)} — ${esc(opts.a?.name || 'A')} ${fmt(va)}, ${esc(opts.b?.name || 'B')} ${fmt(vb)}</title>
            <line x1="${xx(va).toFixed(1)}" y1="${yc}" x2="${xx(vb).toFixed(1)}" y2="${yc}"
                  stroke="${avanti}" stroke-width="2.5" stroke-linecap="round" opacity="0.55"/>
            <circle cx="${xx(va).toFixed(1)}" cy="${yc}" r="5" fill="${inkA}" stroke="#000" stroke-width="1.5"/>
            <circle cx="${xx(vb).toFixed(1)}" cy="${yc}" r="5" fill="${inkB}" stroke="#000" stroke-width="1.5"/>
            <text x="${L - 12}" y="${yc + 4}" class="an-tick" text-anchor="end">${esc(r.label)}</text>
            <text x="${(fine + 10).toFixed(1)}" y="${yc + 4}" class="an-endlabel"
                  fill="${d === 0 ? 'var(--text-muted)' : avanti}">${d === 0 ? '=' : segno + fmt(d)}</text>
            ${r.meta ? `<text x="${W - 8}" y="${yc + 4}" class="an-tick" text-anchor="end">${esc(r.meta)}</text>` : ''}
        </g>`;
    }).join('');

    return `
    ${legend([opts.a, opts.b].filter(s => s?.name).map(s => ({ name: s.name, color: inkFor(s.color) })))}
    <div class="an-scroll"><svg viewBox="0 0 ${W} ${H}" class="an-svg${W > 640 ? ' an-svg--wide' : ''}">${grid}${corpi}</svg></div>`;
}

/**
 * Waterfall: da zero al totale, un passo per voce.
 *
 * `steps`: [{ label, d, tip }] — `d` è il contributo, con segno.
 * `opts`: { totalLabel, fmt, width }
 *
 * Serve a rispondere a "come si è formato questo numero": ogni colonna dice
 * quanto ha aggiunto o tolto quella voce, e l'ultima è il risultato.
 */
export function waterfall(steps, opts = {}) {
    const passi = (steps || []).filter(s => s && Number.isFinite(num(s.d)));
    if (!passi.length) return '';

    const fmt = opts.fmt || ((v) => (Math.round(v * 10) / 10).toFixed(1));
    const cats = [...passi.map(s => s.label), opts.totalLabel || 'Total'];
    const n = cats.length;
    const W = opts.width || Math.max(360, 60 + n * 62);
    const H = 236;
    const M = { l: 42, r: 16, t: 26, b: 58 };
    const plotW = W - M.l - M.r, plotH = H - M.t - M.b;

    // il cammino tocca valori sopra e sotto lo zero: l'asse deve contenerli
    let cum = 0;
    const cammino = passi.map(s => { cum += num(s.d); return cum; });
    const totale = cum;
    const lo = Math.min(0, ...cammino);
    const hi = Math.max(0, ...cammino);
    const ticks = niceTicks(lo, hi);
    const yLo = ticks[0], yHi = ticks[ticks.length - 1];
    const span = (yHi - yLo) || 1;
    const y = (v) => M.t + (1 - (v - yLo) / span) * plotH;
    const bw = Math.min(42, (plotW / n) * 0.62);
    const cx = (i) => M.l + (i + 0.5) * (plotW / n);

    const grid = ticks.map(v => `
        <line x1="${M.l}" y1="${y(v).toFixed(1)}" x2="${M.l + plotW}" y2="${y(v).toFixed(1)}" class="an-gridline"/>
        <text x="${M.l - 6}" y="${(y(v) + 3).toFixed(1)}" class="an-tick" text-anchor="end">${fmt(v)}</text>`).join('');
    const zero = `<line x1="${M.l}" y1="${y(0).toFixed(1)}" x2="${M.l + plotW}" y2="${y(0).toFixed(1)}"
                        stroke="var(--text-muted)" stroke-width="1" opacity="0.5"/>`;

    const parti = [];
    let corrente = 0;
    passi.forEach((s, i) => {
        const d = num(s.d);
        const da = corrente, a = corrente + d;
        const su = d >= 0;
        const yTop = Math.min(y(da), y(a));
        const h = Math.max(1.5, Math.abs(y(da) - y(a)));
        const xi = cx(i);
        if (i > 0) {
            parti.push(`<line x1="${(cx(i - 1) + bw / 2).toFixed(1)}" y1="${y(da).toFixed(1)}"
                              x2="${(xi - bw / 2).toFixed(1)}" y2="${y(da).toFixed(1)}" class="pp-wf-conn"/>`);
        }
        parti.push(`<rect x="${(xi - bw / 2).toFixed(1)}" y="${yTop.toFixed(1)}" width="${bw.toFixed(1)}"
                          height="${h.toFixed(1)}" rx="2" class="pp-wf-step pp-wf-step--${su ? 'up' : 'down'}">
            <title>${esc(s.tip || s.label)} — ${su ? '+' : ''}${fmt(d)}</title></rect>`);
        if (Math.abs(d) > 0.05) {
            parti.push(`<text x="${xi.toFixed(1)}" y="${(yTop - 6).toFixed(1)}"
                              class="pp-wf-lbl pp-wf-lbl--${su ? 'up' : 'down'}" text-anchor="middle">${su ? '+' : ''}${fmt(d)}</text>`);
        }
        corrente = a;
    });

    const xt = cx(n - 1);
    const yTot = Math.min(y(0), y(totale));
    parti.push(`<line x1="${(cx(n - 2) + bw / 2).toFixed(1)}" y1="${y(totale).toFixed(1)}"
                      x2="${(xt - bw / 2).toFixed(1)}" y2="${y(totale).toFixed(1)}" class="pp-wf-conn"/>`);
    parti.push(`<rect x="${(xt - bw / 2).toFixed(1)}" y="${yTot.toFixed(1)}" width="${bw.toFixed(1)}"
                      height="${Math.max(1.5, Math.abs(y(0) - y(totale))).toFixed(1)}" rx="2" class="pp-wf-actual">
        <title>${esc(opts.totalLabel || 'Total')} ${fmt(totale)}</title></rect>`);
    parti.push(`<text x="${xt.toFixed(1)}" y="${(yTot - 6).toFixed(1)}" class="pp-wf-lbl pp-wf-lbl--actual"
                      text-anchor="middle">${totale >= 0 ? '+' : ''}${fmt(totale)}</text>`);

    const xlabels = cats.map((c, i) => `<text x="${cx(i).toFixed(1)}" y="${H - M.b + 16}" class="pp-wf-xlbl"
        text-anchor="end" transform="rotate(-32 ${cx(i).toFixed(1)} ${H - M.b + 16})">${esc(c)}</text>`).join('');

    return `<div class="an-scroll"><svg viewBox="0 0 ${W} ${H}" class="an-svg an-svg--wide">${grid}${zero}${parti.join('')}${xlabels}</svg></div>`;
}

/**
 * Dot plot rispetto a un riferimento: una riga per voce, la linea tratteggiata
 * al centro è il valore atteso, il punto dice di quanto ci si è discostati.
 *
 * `rows`: [{ label, value, ref, tip, meta }]
 * `opts`: { axisLabel, fmt, maxRatio } — `maxRatio` è lo scarto che tocca il
 * bordo (default 1 = il doppio o lo zero della media).
 *
 * È HTML/CSS, non SVG, come gli altri dot plot del sito: riusa `ts-rdot-*`.
 */
export function dotPlot(rows, opts = {}) {
    const righe = (rows || []).filter(r => r && Number.isFinite(num(r.value)));
    if (!righe.length) return '';
    const fmt = opts.fmt || ((v) => (Math.round(v * 10) / 10).toFixed(1));
    const maxRatio = opts.maxRatio || 1;

    const corpo = righe.map(r => {
        const rif = num(r.ref);
        // scarto relativo, tagliato ai bordi: 0.5 = sul riferimento
        const scarto = rif > 0 ? (num(r.value) - rif) / rif : (num(r.value) > 0 ? maxRatio : 0);
        const g = Math.max(0, Math.min(1, 0.5 + (scarto / maxRatio) / 2));
        const su = num(r.value) >= rif;
        const pos = (g * 100).toFixed(1);
        const left = su ? 50 : g * 100;
        const larg = Math.abs(g * 100 - 50);
        return `
        <div class="ts-rankrow ts-rdot ${su ? 'ts-rdot--up' : 'ts-rdot--down'}" title="${esc(r.tip || '')}">
            <span class="ts-rankl">${esc(r.label)}</span>
            <span class="ts-ranktrack ts-rdot-track">
                <span class="ts-rdot-avg"></span>
                <span class="ts-rdot-fill" style="left:${left.toFixed(1)}%;width:${larg.toFixed(1)}%"></span>
                <span class="ts-rdot-pt" style="left:${pos}%"></span>
            </span>
            <span class="ts-rankv">${fmt(num(r.value))}${r.meta ? ` <small>${esc(r.meta)}</small>` : ''}</span>
        </div>`;
    }).join('');

    return `<div class="ts-ranks ts-rdots">
        <div class="ts-rdot-axis"><span></span><span class="ts-rdot-axislbl">${esc(opts.axisLabel || 'average')}</span><span></span></div>
        ${corpo}
    </div>`;
}

/**
 * Linee con etichetta diretta a fine serie — niente legenda, il nome sta dove
 * finisce la linea, spostato in verticale quando due si accavallerebbero.
 *
 * `series`: [{ name, color, lead, values: [{ x, y, tip }] }] — `x` numerico.
 * `opts`: { width, height, xTick(v), yFmt(v), points, callout: { x, y, text, sub } }
 *
 * Con `lead: true` la serie è la protagonista: tratto pieno e nome acceso, le
 * altre restano contesto grigio.
 *
 * Con `opts.points: true` ogni voce di ogni serie prende un pallino (più il
 * `tip` come tooltip nativo, se c'è) — per quando l'asse X non è un tempo
 * continuo ma un elenco di voci reali (un giocatore per rank, per esempio):
 * lì la linea da sola dice la forma ma nasconde le singole voci.
 */
export function multiLine(series, opts = {}) {
    const serie = (series || []).filter(s => s?.values?.length);
    if (!serie.length) return '';

    const W = opts.width || 880;
    const H = opts.height || 300;
    // Il margine destro ospita le etichette a fine linea: con nomi lunghi
    // ("Capi dei Pianeti") 96px non bastano e il testo viene tagliato via.
    const M = { l: 44, r: opts.marginRight || 96, t: 16, b: 34 };
    const plotW = W - M.l - M.r, plotH = H - M.t - M.b;
    const yFmt = opts.yFmt || ((v) => String(Math.round(v)));

    const xs = serie.flatMap(s => s.values.map(v => num(v.x)));
    const ys = serie.flatMap(s => s.values.map(v => num(v.y)));
    const xMin = Math.min(...xs), xMax = Math.max(...xs);
    const ticks = niceTicks(Math.min(0, ...ys), Math.max(...ys, 1));
    const yLo = ticks[0], yHi = ticks[ticks.length - 1];
    const x = (v) => M.l + (xMax > xMin ? (num(v) - xMin) / (xMax - xMin) : 0.5) * plotW;
    const y = (v) => M.t + (1 - (num(v) - yLo) / ((yHi - yLo) || 1)) * plotH;

    const grid = ticks.map(v => `
        <line x1="${M.l}" y1="${y(v).toFixed(1)}" x2="${M.l + plotW}" y2="${y(v).toFixed(1)}" class="an-gridline"/>
        <text x="${M.l - 8}" y="${(y(v) + 3).toFixed(1)}" class="an-tick" text-anchor="end">${yFmt(v)}</text>`).join('');

    // Le etichette dell'asse x si accavallano appena i punti sono vicini: si
    // tengono solo quelle che stanno a una distanza leggibile dalla precedente,
    // stimando la larghezza dal numero di caratteri.
    const minGap = opts.xMinGap || 58;
    let ultimaX = -Infinity;
    const xTicks = (opts.xTicks || [])
        .filter(t => {
            const px = x(t.x);
            const largh = Math.max(minGap, String(t.label).length * 6.2);
            if (px - ultimaX < largh) return false;
            ultimaX = px;
            return true;
        })
        .map(t => `<text x="${x(t.x).toFixed(1)}" y="${H - 10}" class="an-tick" text-anchor="middle">${esc(t.label)}</text>`)
        .join('');

    // etichette a fine linea, scostate in verticale se troppo vicine
    const fini = serie.map(s => {
        const ultimo = s.values[s.values.length - 1];
        return { s, lx: x(ultimo.x), ly: y(ultimo.y), labelY: y(ultimo.y) };
    }).sort((a, b) => a.ly - b.ly);
    for (let i = 1; i < fini.length; i++) {
        if (fini[i].labelY - fini[i - 1].labelY < 15) fini[i].labelY = fini[i - 1].labelY + 15;
    }

    // il contesto prima, il protagonista sopra a tutto
    const ordinate = [...serie].sort((a, b) => (a.lead ? 1 : 0) - (b.lead ? 1 : 0));
    const linee = ordinate.map(s => `
        <polyline points="${s.values.map(v => `${x(v.x).toFixed(1)},${y(v.y).toFixed(1)}`).join(' ')}"
                  fill="none" stroke="${s.color}" stroke-width="${s.lead === false ? 1.6 : 2.4}"
                  stroke-linejoin="round" stroke-linecap="round"${s.lead === false ? ' opacity="0.75"' : ''}/>`).join('');

    const punti = fini.map(({ s, lx, ly, labelY }) => `
        ${Math.abs(labelY - ly) > 2 ? `<line x1="${lx + 5}" y1="${ly}" x2="${lx + 12}" y2="${labelY}" class="an-leader"/>` : ''}
        <circle cx="${lx.toFixed(1)}" cy="${ly.toFixed(1)}" r="4.5" fill="${s.color}" stroke="#000" stroke-width="2"/>
        <text x="${(lx + 14).toFixed(1)}" y="${(labelY + 4).toFixed(1)}" class="an-endlabel${s.lead === false ? '' : ' an-endlabel--lead'}"
              fill="${s.color}">${esc(s.name)}</text>`).join('');

    // pallini intermedi opzionali: quando ogni punto è una VOCE REALE (un
    // giocatore, non un istante di tempo continuo), serve poterla vedere e
    // passarci sopra col mouse — non solo intuire la linea. Additivo e
    // spento di default: non cambia nessuno degli usi esistenti.
    const midPoints = opts.points ? serie.flatMap(s => s.values.map(v => `
        <circle cx="${x(v.x).toFixed(1)}" cy="${y(v.y).toFixed(1)}" r="2.6" fill="${s.color}" stroke="#000" stroke-width="1">
            ${v.tip ? `<title>${esc(v.tip)}</title>` : ''}</circle>`)).join('') : '';

    const c = opts.callout;
    const callout = !c ? '' : `
        <line x1="${x(c.x).toFixed(1)}" y1="${y(c.y).toFixed(1)}" x2="${x(c.x).toFixed(1)}" y2="${M.t + 6}" class="an-leader"/>
        <circle cx="${x(c.x).toFixed(1)}" cy="${y(c.y).toFixed(1)}" r="4" fill="none" stroke="var(--text-secondary)" stroke-width="1.6"/>
        <text x="${Math.min(x(c.x) + 8, M.l + plotW - 4).toFixed(1)}" y="${M.t + 4}" class="an-callout"
              text-anchor="${x(c.x) > M.l + plotW * 0.62 ? 'end' : 'start'}">${esc(c.text)}</text>`;

    return `<div class="an-scroll"><svg viewBox="0 0 ${W} ${H}" class="an-svg an-svg--wide">${grid}${xTicks}${linee}${midPoints}${punti}${callout}</svg></div>`;
}

/**
 * Nuvola di punti — due grandezze per la stessa entità, una per asse.
 *
 * Mancava, ed era già stata riscritta a mano due volte con geometrie diverse
 * (draftgrades.js:leagueScatter, draftgrade-team.js:scatterChartBody). Questa
 * è la forma parametrica: stesso contratto delle altre (dati piatti dentro,
 * stringa HTML fuori, tooltip `<title>` nativi).
 *
 * `points`: [{ x, y, color, label, tip, dim }] — `label` presente = etichetta
 *   scritta accanto al punto; gli altri restano punti muti col solo tooltip.
 *   `dim: true` per il contesto di sfondo (raggio e opacità ridotti).
 * `opts`: { width, height, xLabel, yLabel, xFmt, yFmt, curve, curveLabel,
 *           xInvert, callout: { x, y, text } }
 *
 * Due scelte non ovvie:
 *  - `xInvert` serve perché l'asse naturale di questa pagina è l'ADP, dove il
 *    numero PICCOLO è il giocatore importante: senza invertire, i primi della
 *    classe finiscono schiacciati a sinistra e si legge al contrario di come
 *    si legge un board.
 *  - si etichettano SOLO i punti che il chiamante marca. Con 200 giocatori
 *    etichettarli tutti è illeggibile, e sceglierli qui dentro vorrebbe dire
 *    decidere al posto del chiamante quali sono gli outlier che contano.
 */
export function scatter(points, opts = {}) {
    const pts = (points || []).filter(p => p && p.x != null && p.y != null);
    if (!pts.length) return '';

    const W = opts.width || 880;
    const H = opts.height || 380;
    // b generoso: i tick dell'asse x e il suo titolo stanno su DUE righe. Con
    // una riga sola il titolo ("ADP — earlier to the right") finiva sopra
    // l'ultimo tick e si leggevano due testi sovrapposti.
    const M = { l: 46, r: 116, t: 18, b: 54 };
    const plotW = W - M.l - M.r, plotH = H - M.t - M.b;
    const xFmt = opts.xFmt || ((v) => String(Math.round(v)));
    const yFmt = opts.yFmt || ((v) => String(Math.round(v)));

    const allX = pts.map(p => num(p.x)).concat((opts.curve || []).map(c => num(c.x)));
    const allY = pts.map(p => num(p.y)).concat((opts.curve || []).map(c => num(c.y)));
    const xt = niceTicks(Math.min(...allX), Math.max(...allX));
    const yt = niceTicks(Math.min(0, ...allY), Math.max(...allY, 1));
    const xLo = xt[0], xHi = xt[xt.length - 1], yLo = yt[0], yHi = yt[yt.length - 1];
    const fx = (v) => {
        const t = (num(v) - xLo) / ((xHi - xLo) || 1);
        return M.l + (opts.xInvert ? 1 - t : t) * plotW;
    };
    const fy = (v) => M.t + (1 - (num(v) - yLo) / ((yHi - yLo) || 1)) * plotH;

    const grid = yt.map(v => `
        <line x1="${M.l}" y1="${fy(v).toFixed(1)}" x2="${M.l + plotW}" y2="${fy(v).toFixed(1)}" class="an-gridline"/>
        <text x="${M.l - 8}" y="${(fy(v) + 3).toFixed(1)}" class="an-tick" text-anchor="end">${yFmt(v)}</text>`).join('');
    const xTicks = xt.map(v => `
        <text x="${fx(v).toFixed(1)}" y="${H - 26}" class="an-tick" text-anchor="middle">${xFmt(v)}</text>`).join('');

    // curva di riferimento (es. il valore che il mercato compra a ogni prezzo):
    // tratteggiata, perché non è un dato osservato ma un andamento lisciato
    const curva = !opts.curve?.length ? '' : `
        <polyline points="${opts.curve.map(c => `${fx(c.x).toFixed(1)},${fy(c.y).toFixed(1)}`).join(' ')}"
                  fill="none" class="dgt-alt-line"/>`;
    // etichetta della curva: al capo che sta verso il bordo, staccata in
    // verticale — appoggiata sulla linea il tratteggio le passava dentro
    const last = opts.curve?.length ? opts.curve[opts.curve.length - 1] : null;
    const curvaLab = !last || !opts.curveLabel ? '' : `
        <text x="${(fx(last.x) + (opts.xInvert ? 8 : -8)).toFixed(1)}" y="${(fy(last.y) - 9).toFixed(1)}"
              class="an-endlabel" text-anchor="${opts.xInvert ? 'start' : 'end'}">${esc(opts.curveLabel)}</text>`;

    // il contesto sotto, i punti pieni sopra, le etichette in cima a tutto
    const ordinati = [...pts].sort((a, b) => (a.dim ? 0 : 1) - (b.dim ? 0 : 1));
    const dots = ordinati.map(p => `
        <circle cx="${fx(p.x).toFixed(1)}" cy="${fy(p.y).toFixed(1)}" r="${p.dim ? 2.6 : 4.2}"
                fill="${p.color || 'var(--accent-blue)'}" ${p.dim ? 'opacity="0.45"' : 'stroke="#000" stroke-width="1.2"'}>
            ${p.tip ? `<title>${esc(p.tip)}</title>` : ''}</circle>`).join('');

    // etichette dirette: scostate in verticale quando si accavallerebbero,
    // con la lineetta di richiamo quando si sono spostate abbastanza
    const etichettati = pts.filter(p => p.label)
        .map(p => ({ p, px: fx(p.x), py: fy(p.y), ly: fy(p.y) }))
        .sort((a, b) => a.py - b.py);
    for (let i = 1; i < etichettati.length; i++) {
        if (etichettati[i].ly - etichettati[i - 1].ly < 13) etichettati[i].ly = etichettati[i - 1].ly + 13;
    }
    const labels = etichettati.map(({ p, px, py, ly }) => {
        // a destra se c'è spazio, altrimenti a sinistra: sul bordo destro le
        // etichette uscivano dal viewBox e venivano tagliate
        const destra = px < M.l + plotW * 0.74;
        const lx = destra ? px + 8 : px - 8;
        return `
        ${Math.abs(ly - py) > 2 ? `<line x1="${px.toFixed(1)}" y1="${py.toFixed(1)}" x2="${lx.toFixed(1)}" y2="${ly.toFixed(1)}" class="an-leader"/>` : ''}
        <text x="${lx.toFixed(1)}" y="${(ly + 3.5).toFixed(1)}" class="an-endlabel" text-anchor="${destra ? 'start' : 'end'}"
              fill="${p.color || 'var(--text-secondary)'}">${esc(p.label)}</text>`;
    }).join('');

    const assi = `
        ${opts.yLabel ? `<text x="${M.l}" y="${M.t - 4}" class="an-tick" text-anchor="start">${esc(opts.yLabel)}</text>` : ''}
        ${opts.xLabel ? `<text x="${(M.l + plotW / 2).toFixed(1)}" y="${H - 6}" class="an-tick" text-anchor="middle">${esc(opts.xLabel)}</text>` : ''}`;

    const c = opts.callout;
    const callout = !c ? '' : `
        <text x="${Math.min(fx(c.x) + 8, M.l + plotW - 4).toFixed(1)}" y="${(fy(c.y) - 8).toFixed(1)}" class="an-callout"
              text-anchor="${fx(c.x) > M.l + plotW * 0.62 ? 'end' : 'start'}">${esc(c.text)}</text>`;

    return `<div class="an-scroll"><svg viewBox="0 0 ${W} ${H}" class="an-svg an-svg--wide">${grid}${xTicks}${assi}${curva}${curvaLab}${dots}${labels}${callout}</svg></div>`;
}
