/**
 * Il campo in prospettiva con ogni giocata dei titolari, nello stile delle
 * mappe di NFL Next Gen Stats: si parte tutti dalla linea di scrimmage e si
 * guarda dove è andata l'azione.
 *
 * ── Cosa è vero e cosa è disegnato ──────────────────────────────────────
 *
 * VERI: la LUNGHEZZA di ogni linea (le yard del referto) e il VERSO (sinistra,
 * centro, destra), ricavato dalla frase di ESPN — "pass short left", "right
 * tackle", "up the middle" — nel 96% delle giocate.
 *
 * DISEGNATA: la FORMA. Il tracking dei giocatori con cui NGS disegna le sue
 * mappe non esiste in nessuna API pubblica, quindi la curva fra partenza e
 * arrivo è una route plausibile scelta da un catalogo in base a ruolo,
 * profondità e direzione — non il percorso vero. Il grafico lo dichiara sotto,
 * e quella nota non va tolta: senza, una curva inventata si legge come un
 * dato.
 *
 * Due linguaggi diversi, come i due grafici di NGS: i ricevitori SALGONO e
 * tagliano (`route`), i corridori SERPEGGIANO attorno alla linea prima di
 * trovare il varco (`corsa`). Disegnare una corsa da due yard come una route
 * corta racconterebbe una cosa che non è successa.
 *
 * Niente canvas e niente librerie: SVG, come il resto dei disegni del sito.
 */

/** La prospettiva: in fondo il campo è più stretto, come in una ripresa da dietro. */
const LARG_SOTTO = 0.97;
const LARG_SOPRA = 0.62;

/** Un colore per giocatore, finché non se ne seleziona uno. */
const COLORI = ['#4cc2ff', '#7ee787', '#ffb84d', '#ff7a9c', '#c792ea', '#f5c518'];

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/** Le tre fasce del Carry Chart: perdita, guadagno corto, guadagno vero. */
function fascia(g) {
    if (g.tipo === 'inc') return 'vuota';
    if (g.td) return 'lunga';
    if (g.yards < 0) return 'persa';
    return g.yards >= 5 ? 'lunga' : 'corta';
}

/* ============================================================
   LE FORME — un catalogo di route, e il serpeggiare delle corse
   ============================================================ */

/**
 * Una route plausibile, in coordinate di campo: [[corsia, yard], ...].
 *
 * Si sceglie dal ruolo e da quanto è andata lontana, come farebbe un
 * coordinatore: corto verso l'interno è uno slant, corto verso la linea
 * laterale è un out, profondo sulla banda è un go o un corner, profondo in
 * mezzo è un post. `i` fa variare il punto di rottura dentro ogni famiglia,
 * così venti route dello stesso tipo non sono venti copie sovrapposte.
 */
function route(g, i) {
    const y = Math.max(1.5, g.yards);
    const lato = (g.corsia ?? 0) >= 0 ? 1 : -1;
    const partenza = (g.corsia ?? 0) * 0.86;
    // il punto di rottura scivola fra il 35% e il 65% della profondità
    const k = 0.35 + ((i * 0.13) % 0.3);
    const rottura = y * k;
    const largo = Math.abs(g.corsia ?? 0) > 0.5;   // partito largo, vicino alla banda

    if (y <= 4) {
        // Poco più di uno scarico: il taglio è subito, quasi parallelo.
        return [[partenza, 0], [partenza + lato * 0.1, y * 0.4], [partenza + lato * 0.34, y]];
    }
    if (y <= 9) {
        return largo
            // OUT: sale dritto, poi rompe verso la banda
            ? [[partenza, 0], [partenza, rottura], [partenza + lato * 0.22, y]]
            // SLANT: taglia dentro subito
            : [[partenza, 0], [partenza - lato * 0.06, y * 0.25], [partenza - lato * 0.3, y]];
    }
    if (y <= 18) {
        return largo
            // COMEBACK: sale, rompe verso fuori e rientra appena
            ? [[partenza, 0], [partenza + lato * 0.05, rottura], [partenza + lato * 0.28, y * 0.86], [partenza + lato * 0.2, y]]
            // DIG: sale e taglia in mezzo
            : [[partenza, 0], [partenza, rottura], [partenza - lato * 0.36, y]];
    }
    // Profonde
    return largo
        // CORNER / GO: sale sulla banda e si apre verso l'angolo
        ? [[partenza, 0], [partenza + lato * 0.04, y * 0.5], [partenza + lato * 0.16, y * 0.8], [partenza + lato * 0.22, y]]
        // POST / SEAM: sale in mezzo e punta i pali
        : [[partenza, 0], [partenza, y * 0.55], [partenza - lato * 0.2, y * 0.85], [partenza - lato * 0.3, y]];
}

/**
 * Una corsa: parte dalla linea, cerca il varco muovendosi di lato nelle prime
 * yard, e solo dopo va. È il movimento del Carry Chart — le linee che si
 * incrociano attorno alla scrimmage — e non una route accorciata.
 */
function corsa(g, i) {
    const y = g.yards;
    const lato = (g.corsia ?? 0) >= 0 ? 1 : -1;
    const partenza = (g.corsia ?? 0) * 0.5;      // parte più vicino al centro: è dietro al QB
    const zig = 0.1 + ((i * 0.07) % 0.14);        // di quanto serpeggia, variabile

    if (y < 0) {
        // Placcato dietro la linea: rientra e si ferma sotto.
        return [[partenza, 0], [partenza - lato * zig, y * 0.5], [partenza - lato * zig * 1.5, y]];
    }
    if (y <= 2) {
        // Sbatte dentro: quasi nessuna corsia guadagnata.
        return [[partenza, 0], [partenza + lato * zig * 0.6, Math.max(0.6, y)]];
    }
    // Taglia, trova il varco e prosegue: tre tratti, il primo controcorrente.
    const varco = Math.min(y * 0.45, 3.5);
    return [
        [partenza, 0],
        [partenza - lato * zig, varco * 0.6],
        [partenza + lato * zig * 1.2, varco],
        [partenza + lato * (zig * 1.2 + 0.12), y],
    ];
}

/** Una spezzata smussata: `Q` fra i punti, così la traiettoria non è spigolosa. */
function curva(punti) {
    if (punti.length < 2) return '';
    let d = `M${punti[0][0].toFixed(1)} ${punti[0][1].toFixed(1)}`;
    for (let i = 1; i < punti.length - 1; i++) {
        const [cx, cy] = punti[i];
        const [nx, ny] = punti[i + 1];
        d += ` Q${cx.toFixed(1)} ${cy.toFixed(1)} ${((cx + nx) / 2).toFixed(1)} ${((cy + ny) / 2).toFixed(1)}`;
    }
    const u = punti[punti.length - 1];
    d += ` T${u[0].toFixed(1)} ${u[1].toFixed(1)}`;
    return d;
}

/* ============================================================
   IL DISEGNO
   ============================================================ */

export function ngsChartHTML(giocate, nomi, { w = 620, h = 400 } = {}) {
    const righe = (giocate || []).filter(g => Number.isFinite(g.yards));
    if (!righe.length) return '';

    /* La scala si adatta alla serata: con una corsa da 55 yard il campo arriva
       a 60, con una serata di rimbalzi corti si sta sulle 20 — se no le
       giocate vere diventano trattini in fondo. */
    const maxY = Math.max(15, Math.ceil(Math.max(...righe.map(g => Math.abs(g.yards))) / 5) * 5);
    const minY = Math.min(0, Math.min(...righe.map(g => g.yards)));
    const perNome = new Map(nomi.map((n, i) => [n, COLORI[i % COLORI.length]]));

    const cx = w / 2;
    const bordoBasso = h - 30;
    const losY = bordoBasso - 26;         // spazio sotto la linea per le perdite
    const fondoY = 14;
    const proj = (corsia, yard) => {
        const t = Math.max(-0.18, Math.min(1, yard / maxY));
        const larg = w * (LARG_SOTTO + (LARG_SOPRA - LARG_SOTTO) * Math.max(0, t));
        return { x: cx + (corsia ?? 0) * larg / 2, y: losY - t * (losY - fondoY) };
    };

    // ── Il campo ─────────────────────────────────────────────────────────
    const ang = [proj(-1, minY), proj(1, minY), proj(1, maxY), proj(-1, maxY)];
    const erba = `<polygon points="${ang.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')}" class="ngs-erba"/>`;

    // Le fasce laterali grigie, come le sponde della grafica NGS.
    const sponda = (lato) => {
        const a = proj(lato, minY), b = proj(lato, maxY);
        const fuori = lato * 1.13;
        const c = proj(fuori, maxY), d = proj(fuori, minY);
        return `<polygon points="${a.x.toFixed(1)},${a.y.toFixed(1)} ${b.x.toFixed(1)},${b.y.toFixed(1)} ${c.x.toFixed(1)},${c.y.toFixed(1)} ${d.x.toFixed(1)},${d.y.toFixed(1)}" class="ngs-sponda"/>`;
    };

    const passo = maxY <= 20 ? 5 : maxY <= 40 ? 10 : 10;
    const linee = [];
    for (let y = passo; y <= maxY; y += passo) {
        const a = proj(-1, y), b = proj(1, y);
        linee.push(`<line x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}" class="ngs-yard"/>`);
        linee.push(`<text x="${(a.x - 7).toFixed(1)}" y="${(a.y + 3).toFixed(1)}" class="ngs-num" text-anchor="end">+${y}</text>`);
        linee.push(`<text x="${(b.x + 7).toFixed(1)}" y="${(b.y + 3).toFixed(1)}" class="ngs-num">+${y}</text>`);
    }

    /* Gli hash mark: due colonne di trattini a un terzo e due terzi del campo,
       come sull'erba vera. Sono quelli che danno la profondità al disegno —
       senza, il trapezio sembra un triangolo vuoto. */
    const hash = [];
    for (let y = 1; y <= maxY; y++) {
        if (y % passo === 0) continue;
        for (const lato of [-0.34, 0.34]) {
            const p = proj(lato, y);
            const q = proj(lato + 0.035, y);
            hash.push(`<line x1="${p.x.toFixed(1)}" y1="${p.y.toFixed(1)}" x2="${q.x.toFixed(1)}" y2="${q.y.toFixed(1)}" class="ngs-hash"/>`);
        }
        // e i trattini corti lungo le sponde
        for (const lato of [-1, 1]) {
            const p = proj(lato, y);
            const q = proj(lato - lato * 0.04, y);
            hash.push(`<line x1="${p.x.toFixed(1)}" y1="${p.y.toFixed(1)}" x2="${q.x.toFixed(1)}" y2="${q.y.toFixed(1)}" class="ngs-hash"/>`);
        }
    }

    // ── Le giocate ───────────────────────────────────────────────────────
    // Chi finisce nello stesso punto si scosta: venti corse "up the middle"
    // sarebbero una linea sola.
    const conta = new Map();
    const tracce = righe.map((g) => {
        const k = `${g.nome}|${(g.corsia ?? 0).toFixed(2)}|${g.tipo}`;
        const n = conta.get(k) || 0;
        conta.set(k, n + 1);
        const scosto = ((n % 2 ? 1 : -1) * Math.ceil(n / 2)) * 0.045;

        const base = { ...g, corsia: Math.max(-1, Math.min(1, (g.corsia ?? 0) + scosto)) };
        const punti = (g.tipo === 'rush' ? corsa(base, n) : route(base, n))
            .map(([c, y]) => {
                const p = proj(Math.max(-1.02, Math.min(1.02, c)), y);
                return [p.x, p.y];
            });

        const col = perNome.get(g.nome) || COLORI[0];
        const f = fascia(g);
        const fine = punti[punti.length - 1];
        return `<path d="${curva(punti)}" class="ngs-linea" data-nr-chi="${esc(g.nome)}" data-f="${f}" style="--c:${col}"/>`
            + (g.td ? `<circle cx="${fine[0].toFixed(1)}" cy="${fine[1].toFixed(1)}" r="4.5" class="ngs-td" data-nr-chi="${esc(g.nome)}" style="--c:${col}"/>` : '');
    }).join('');

    const losA = proj(-1, 0), losB = proj(1, 0);
    return `
    <svg class="ngs" viewBox="0 0 ${w} ${h}" role="img"
         aria-label="Every play by your starters, from the line of scrimmage">
        ${erba}${sponda(-1)}${sponda(1)}
        <g class="ngs-griglia">${linee.join('')}${hash.join('')}</g>
        <line x1="${losA.x.toFixed(1)}" y1="${losA.y.toFixed(1)}" x2="${losB.x.toFixed(1)}" y2="${losB.y.toFixed(1)}" class="ngs-los"/>
        <text x="${(losA.x - 7).toFixed(1)}" y="${(losA.y + 4).toFixed(1)}" class="ngs-num ngs-num--los" text-anchor="end">LOS</text>
        <text x="${(losB.x + 7).toFixed(1)}" y="${(losB.y + 4).toFixed(1)}" class="ngs-num ngs-num--los">LOS</text>
        <g class="ngs-tracce">${tracce}</g>
    </svg>`;
}

/** La legenda: un colore per giocatore, coi suoi numeri. È anche il selettore. */
export function ngsLegendaHTML(giocate, nomi, statistiche) {
    return nomi.map((n, i) => {
        const mie = (giocate || []).filter(g => g.nome === n);
        const rec = mie.filter(g => g.tipo === 'rec').length;
        const tgt = mie.filter(g => g.tipo === 'rec' || g.tipo === 'inc').length;
        const car = mie.filter(g => g.tipo === 'rush').length;
        /* Le perdite si SOTTRAGGONO, non si azzerano: clampandole a zero la
           serata risultava più lunga del tabellino vero. */
        const yd = mie.reduce((s, g) => s + g.yards, 0);
        const td = mie.filter(g => g.td).length;
        const pezzi = [
            tgt ? `${rec}/${tgt} rec` : '',
            car ? `${car} car` : '',
            `${Math.round(yd)} yd`,
            td ? `${td} TD` : '',
        ].filter(Boolean);
        return `
        <button type="button" class="ngs-voce" data-nr-sel="${esc(n)}" style="--c:${COLORI[i % COLORI.length]}">
            <i class="ngs-pallino"></i>
            <b>${esc(n)}</b>
            <span class="ngs-mini">${esc(pezzi.join(' · '))}</span>
            <span class="ngs-pt">${(Number(statistiche?.get(n)) || 0).toFixed(1)}</span>
        </button>`;
    }).join('');
}

/** La legenda delle tre fasce, che compare solo a giocatore selezionato. */
export function ngsFasceHTML() {
    return `
    <div class="ngs-fasce" hidden data-nr-fasce>
        <span data-f="persa"><i></i>lost yards</span>
        <span data-f="corta"><i></i>0-5 yds</span>
        <span data-f="lunga"><i></i>5+ yds / TD</span>
        <span data-f="vuota"><i></i>incomplete</span>
    </div>`;
}

/**
 * Selezionare un giocatore spegne gli altri.
 *
 * Con uno solo in scena il colore cambia significato: non più "di chi è la
 * linea" — è ovvio, ce n'è uno — ma "quanto ha reso", nelle tre fasce del
 * Carry Chart. Lo scambio lo fa il CSS leggendo `data-f`; qui si gestisce solo
 * chi è acceso. Ricliccando lo stesso si torna a tutti.
 */
export function bindNgsChart(root) {
    const campo = root?.querySelector('.nr-fine-campo');
    if (!campo) return;
    const fasce = campo.querySelector('[data-nr-fasce]');

    const scegli = (nome) => {
        const gia = campo.dataset.sel === nome;
        const attivo = gia ? '' : (nome || '');
        campo.dataset.sel = attivo;
        campo.classList.toggle('is-sel', !!attivo);
        if (fasce) fasce.hidden = !attivo;
        for (const b of campo.querySelectorAll('[data-nr-sel]')) {
            b.classList.toggle('is-on', !!attivo && b.dataset.nrSel === attivo);
            b.setAttribute('aria-pressed', String(!!attivo && b.dataset.nrSel === attivo));
        }
        for (const el of campo.querySelectorAll('[data-nr-chi]')) {
            el.classList.toggle('is-mio', !attivo || el.dataset.nrChi === attivo);
            el.classList.toggle('is-spento', !!attivo && el.dataset.nrChi !== attivo);
        }
    };

    campo.addEventListener('click', (e) => {
        const b = e.target.closest('[data-nr-sel]');
        if (b) { scegli(b.dataset.nrSel); return; }
        // Un clic sul campo vuoto rimette tutti: è il modo più ovvio di uscire.
        if (e.target.closest('.ngs') && campo.dataset.sel) scegli(campo.dataset.sel);
    });
}
