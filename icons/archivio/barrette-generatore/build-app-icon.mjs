// Icona dell'app (home del telefono, tab del browser): quattro barrette, una
// per squadra, sul modello del marchio di Election Desk. Due versioni, scura e
// chiara, scelte dal tema del dispositivo (vedi <head> di index.html).
//
// L'ordine e' FISSO e di sola resa: dal bordeaux al petrolio passando per
// arancio e oro, caldo -> freddo. Non dice niente sulla classifica. Lo stesso
// ordine e gli stessi colori stanno nel marchio della navbar (.brand-mark in
// css/main.css): cambiandoli qui vanno cambiati anche la'.
//   npm run build-app-icon
// Scrive in icons/ e il sito le legge da <head> (index.html).
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';
import { TEAM_PALETTE } from '../js/data/team-config.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'icons');

const ORDER = ['oscurus', 'capi', 'lasers', 'sommo'];

// ---- barrette ----------------------------------------------------------------
// Quattro barrette verticali arrotondate. Stanno dentro il
// cerchio sicuro delle icone maskable (raggio 40%): gli angoli del blocco sono
// a 403 px dal centro su 410.
const THEMES = {
    // Su fondo scuro `bright`: bordeaux e petrolio pieni sul nero spariscono.
    dark: { bg: '#17181b', cols: ORDER.map((k) => TEAM_PALETTE[k].bright) },
    light: { bg: '#f4f4f6', cols: ORDER.map((k) => TEAM_PALETTE[k].identity) },
};
function barrette(cols) {
    const W = 120, GAP = 40, H = 540, R = 30;
    const x0 = 512 - (4 * W + 3 * GAP) / 2, y0 = 512 - H / 2;
    return cols.map((c, i) => `<rect x="${x0 + i * (W + GAP)}" y="${y0}" width="${W}" height="${H}" rx="${R}" fill="${c}"/>`).join('');
}
function tile(theme, rounded) {
    const t = THEMES[theme];
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">
<rect width="1024" height="1024" rx="${rounded ? 224 : 0}" fill="${t.bg}"/>${barrette(t.cols)}
</svg>`;
}
// L'SVG della tab si adatta da solo: le tinte chiare sono quelle di base, la
// media query del tema scuro le sostituisce.
function adaptive() {
    const L = THEMES.light, D = THEMES.dark;
    const css = [`@media (prefers-color-scheme: dark){.bg{fill:${D.bg}}`,
        ...D.cols.map((c, i) => `.b${i}{fill:${c}}`), '}'].join('');
    const bars = barrette(L.cols).split('/>').filter(Boolean)
        .map((r, i) => `${r} class="b${i}"/>`).join('');
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">
<style>${css}</style>
<rect class="bg" width="1024" height="1024" rx="224" fill="${L.bg}"/>${bars}
</svg>`;
}

const png = (s, size) => new Resvg(s, { fitTo: { mode: 'width', value: size } }).render().asPng();
mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, 'icon.svg'), adaptive());
for (const th of ['dark', 'light']) {
    const sfx = th === 'dark' ? '' : '-light';
    const full = tile(th, false), tab = tile(th, true);
    writeFileSync(join(OUT, `apple-touch-icon${sfx}.png`), png(full, 180));   // iOS arrotonda da solo
    // Il manifest (Android) non sa scegliere per tema: resta la scura.
    if (th === 'dark') {
        writeFileSync(join(OUT, 'icon-192.png'), png(full, 192));
        writeFileSync(join(OUT, 'icon-512.png'), png(full, 512));
    }
    writeFileSync(join(OUT, `favicon-32${sfx}.png`), png(tab, 32));
    writeFileSync(join(OUT, `preview${sfx}.png`), png(tab, 512));
}
console.log('Scritte le icone in icons/');
