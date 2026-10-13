// Icona dell'app (home del telefono, tab del browser): quattro cerchi sovrapposti.
//
// Un cerchio per squadra, in fila: a sinistra il campione del Super Bowl
// della stagione scorsa, poi le altre per classifica di regular season.
// Legge solo data/fantasy/, nessuna rete. Va rilanciato a fine stagione:
//   npm run build-app-icon [anno]
// Scrive in icons/ e il sito le legge da <head> (index.html).
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'icons');

// Colori `identity` di TEAM_PALETTE (js/data/team-config.js), cioe' quelli
// veri delle franchigie. Chiave Firebase -> colore.
const COLORS = {
    'Capi dei Pianeti': '#FF6600',
    lasers: '#D4AF37',
    riccardo97com: '#800020',
    FedCom: '#1c4750',
};

// Come getSeasonConfig() in js/data.js (che non si puo' importare da node:
// tira dentro Firebase da CDN).
const cfg = (y) => (y === 2021
    ? { reg: 16, po: 17, sb: 18 }
    : { reg: 15, po: 16, sb: 17 });

const load = (y) => JSON.parse(readFileSync(join(ROOT, `data/fantasy/fantasy_data_${y}.json`), 'utf8'));
const score = (t) => parseFloat(t.score) || 0;
const winner = (m) => (score(m.team1) > score(m.team2) ? m.team1.name : m.team2.name);
const played = (m) => score(m.team1) > 0 || score(m.team2) > 0;

/** { champion, order } oppure null se la stagione non e' chiusa. */
function season(y) {
    const c = cfg(y);
    const data = load(y);
    const wk = (n) => (data.weeks[String(n)]?.matchups || []);
    const po = wk(c.po);
    const sb = wk(c.sb);
    if (po.length < 2 || !po.every(played) || !sb.some(played)) return null;
    const finalists = new Set(po.map(winner));
    const final = sb.find((m) => finalists.has(m.team1.name) && finalists.has(m.team2.name));
    if (!final || !played(final)) return null;
    const champion = winner(final);

    const t = {};
    for (let w = 1; w <= c.reg; w++) {
        for (const m of wk(w)) {
            if (!played(m)) continue;
            for (const [a, b] of [[m.team1, m.team2], [m.team2, m.team1]]) {
                const r = (t[a.name] ||= { name: a.name, w: 0, pf: 0 });
                r.pf += score(a);
                if (score(a) > score(b)) r.w++;
            }
        }
    }
    const order = Object.values(t)
        .filter((r) => r.name !== champion)
        .sort((a, b) => b.w - a.w || b.pf - a.pf)
        .map((r) => r.name);
    return { champion, order };
}

const years = readdirSync(join(ROOT, 'data/fantasy'))
    .map((f) => +f.match(/fantasy_data_(\d+)\.json/)?.[1]).filter(Boolean).sort((a, b) => b - a);
const wanted = process.argv[2] ? [+process.argv[2]] : years;
let year, res;
for (const y of wanted) { res = season(y); if (res) { year = y; break; } }
if (!res) throw new Error('Nessuna stagione chiusa trovata');
const stack = [res.champion, ...res.order];
if (stack.some((n) => !COLORS[n]) || stack.length !== 4) throw new Error(`Squadre inattese: ${stack}`);
console.log(`Stagione ${year}: campione ${res.champion}, poi ${res.order.join(' > ')}`);

// ---- disegno -------------------------------------------------------------
// Una pennellata per squadra, nei colori veri. L'ordine (campione, poi
// classifica) e' l'indice. Sbordano dall'icona di proposito: iOS e Android
// la ritagliano comunque a modo loro.
const BG = '#17181b';

// ---- pennellate ------------------------------------------------------------
// Una pennellata e' una striscia lungo una linea di centro, con i bordi
// mossi, la fine che si assottiglia e, in coda, le setole che lasciano il
// fondo scoperto (pennello a secco). Il caso e' un PRNG a seme fisso: due
// esecuzioni danno lo stesso disegno.
function prng(seed) {
    let a = seed >>> 0;
    return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const lighten = (hex, f) => { const n = parseInt(hex.slice(1), 16);
    const ch = (sh) => Math.round(((n >> sh) & 255) + (255 - ((n >> sh) & 255)) * f);
    return `#${[16, 8, 0].map((sh) => ch(sh).toString(16).padStart(2, '0')).join('')}`; };

/** centro(t) -> [x, y, nx, ny] con t in 0..1 (n = normale unitaria). */
function brush(centro, W, seed, color, rough = 1) {
    const R = prng(seed), N = 110, k = W / 168;
    const ph = [R() * 6.28, R() * 6.28, R() * 6.28];
    const wob = (t) => rough * (0.05 * Math.sin(t * 7 + ph[0]) + 0.04 * Math.sin(t * 17 + ph[1]) + 0.02 * Math.sin(t * 41 + ph[2]));
    const half = (t, side) => {
        const taper = t > 0.78 ? 1 - 0.4 * ((t - 0.78) / 0.22) ** 1.5 : 1;
        const edge = wob(t + side * 0.31) + (R() - 0.5) * 0.035 * rough;
        return (W / 2) * (taper + edge);
    };
    const P = (t, u) => { const [x, y, nx, ny] = centro(t); return [x + nx * u, y + ny * u]; };
    const f = (q) => `${q[0].toFixed(1)} ${q[1].toFixed(1)}`;
    const up = [], dn = [];
    for (let k = 0; k <= N; k++) { const t = k / N; up.push(P(t, -half(t, 1))); dn.push(P(t, half(t, -1))); }
    // Teste ragged: l'attacco e' squadrato ma morso, la fine e' piu' sfilacciata.
    const cap = (t, sgn, ragged) => { const out = [];
        for (let k = 1; k < 6; k++) { const u = -sgn * (W / 2) * (1 - (k / 3)) ;
            const dt = (R() - 0.3) * ragged; out.push(P(Math.min(1.02, Math.max(-0.02, t + dt)), u * 0.95)); }
        return out; };
    const end = cap(1, 1, 0.05), start = cap(0, -1, 0.025);
    const d = `M${f(up[0])}L${up.slice(1).map(f).join('L')}L${end.map(f).join('L')}L${[...dn].reverse().map(f).join('L')}L${start.map(f).join('L')}Z`;
    const line = (t0, t1, u, w, col, op) => { const pts = [];
        for (let k = 0; k <= 24; k++) { const t = t0 + (t1 - t0) * k / 24; pts.push(f(P(t, u * half(t, 1)))); }
        return `<polyline points="${pts.join(' ')}" fill="none" stroke="${col}" stroke-width="${w}" stroke-linecap="round" opacity="${op}"/>`; };
    const out = [`<path d="${d}" fill="${color}" stroke="${color}" stroke-width="3" stroke-linejoin="round"/>`];
    // Venature: setole piu' chiare e piu' scure dentro la stesura.
    for (let j = 0; j < 9 + Math.round(k * 3); j++) {
        const u = (R() - 0.5) * 1.7, t0 = R() * 0.2, t1 = 0.45 + R() * 0.5;
        out.push(line(t0, t1, u, (3 + R() * 5) * k, R() < 0.6 ? lighten(color, 0.4) : '#000', (0.14 + R() * 0.16).toFixed(2)));
    }
    // Secco: righe di fondo che tagliano la coda in setole.
    for (let j = 0; j < 7 + Math.round(k * 3); j++) {
        const u = (R() - 0.5) * 1.8, t0 = 0.66 + R() * 0.2;
        out.push(line(t0, 1.06, u, (4 + R() * 8) * k, BG, 1));
    }
    return out.join('');
}

const LAYOUTS = {
    // Quattro pennellate a 45\u00b0 che escono dal bordo: partono da fuori in basso
    // a sinistra, ognuna finisce dove vuole (due sbordano, due si seccano
    // dentro). Si disegnano in orizzontale e poi si ruota il gruppo. Il campione
    // e' l'angolo in alto a sinistra, la classifica scende verso il basso a destra.
    pennellate: (cols) => {
        const PITCH = 330, W = 350, end = [1130, 1010, 1290, 1060], A = [20, -26, 22, -18];
        const body = cols.map((c, i) => {
            const y = 512 + (i - 1.5) * PITCH, x0 = -300, x1 = end[i], a = A[i];
            const len = x1 - x0, ph = i * 1.7;
            return brush((t) => { const x = x0 + len * t, dyd = a * 2.6 * Math.cos(t * 2.6 + ph) / len,
                m = Math.hypot(1, dyd);
                return [x, y + a * Math.sin(t * 2.6 + ph), -dyd / m, 1 / m]; }, W, 11 + i * 7, c, 1.5);
        }).join('');
        return `<g transform="rotate(-45 512 512)">${body}</g>`;
    },
};

function svg({ rounded, layout = 'pennellate' }) {
    const cols = stack.map((n) => COLORS[n]);
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">
<defs><clipPath id="tile"><rect width="1024" height="1024" rx="${rounded ? 224 : 0}"/></clipPath></defs>
<g clip-path="url(#tile)">
<rect width="1024" height="1024" fill="${BG}"/>
${LAYOUTS[layout](cols)}
</g>
</svg>`;
}

const png = (s, size) => new Resvg(s, { fitTo: { mode: 'width', value: size } }).render().asPng();
mkdirSync(OUT, { recursive: true });
const LAYOUT = 'pennellate';
const full = svg({ rounded: false, layout: LAYOUT });
const tab = svg({ rounded: true, layout: LAYOUT });
writeFileSync(join(OUT, 'icon.svg'), tab);
writeFileSync(join(OUT, 'apple-touch-icon.png'), png(full, 180));   // iOS arrotonda da solo
writeFileSync(join(OUT, 'icon-192.png'), png(full, 192));
writeFileSync(join(OUT, 'icon-512.png'), png(full, 512));
writeFileSync(join(OUT, 'favicon-32.png'), png(tab, 32));
writeFileSync(join(OUT, 'preview.png'), png(tab, 512));
console.log('Scritte le icone in icons/');
