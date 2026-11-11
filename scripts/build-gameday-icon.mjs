// Icona di Game Day (collegamento sulla Home da #nfl-games, vedi
// js/utils/identita-app.js e manifest-gameday.webmanifest): il tabellone TV
// "NE 3 - ATL 28, 3rd 2:17", il momento piu' famoso del Super Bowl LI.
//
// Disegnata in SVG e non presa da uno screenshot: lo screenshot e' 902x662, e
// ritagliarlo a quadrato tagliava i timeout ai lati. Il font e' Avenir Next di
// macOS (il piu' vicino a quello del tabellone): su un'altra macchina va
// indicato a mano in FONT.
//   node scripts/build-gameday-icon.mjs
// Scrive icons/gameday-{180,192,512}.png; quella di prima e' in icons/archivio/.
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'icons');
const FONT = '/System/Library/Fonts/Avenir Next.ttc';

const NAVY = '#13295a', RED = '#a91b2e', GOLD = '#f0bd1a', GREY = '#757575';
const S = 1024, SPLIT = 760;          // altezza della parte coi punteggi
const TO = 64;                         // colonna dei timeout ai lati

// Timeout: tre tacche per lato, quelle usate sono grigie (come nella foto:
// ATL ne ha usato uno).
function timeouts(x, usati) {
    const h = (SPLIT - 4 * 22) / 3;
    return [0, 1, 2].map((i) => `<rect x="${x}" y="${22 + i * (h + 22)}" width="${TO}" height="${h}" fill="${i < usati ? GREY : GOLD}"/>`).join('');
}

const txt = (x, y, size, weight, s, fill = '#fff', extra = '') =>
    `<text x="${x}" y="${y}" font-family="Avenir Next" font-weight="${weight}" font-size="${size}" fill="${fill}" text-anchor="middle" ${extra}>${s}</text>`;

const L = TO + (S / 2 - TO) / 2, R = S / 2 + (S / 2 - TO) / 2;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${S} ${S}" width="${S}" height="${S}">
<defs><linearGradient id="fondo" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0" stop-color="#14305a"/><stop offset="1" stop-color="#0a1a33"/>
</linearGradient></defs>
<rect width="${S}" height="${S}" fill="#0c1f3d"/>
<rect x="0" y="0" width="${S / 2}" height="${SPLIT}" fill="${NAVY}"/>
<rect x="${S / 2}" y="0" width="${S / 2}" height="${SPLIT}" fill="${RED}"/>
${timeouts(0, 0)}${timeouts(S - TO, 1)}
${txt(L, 230, 170, 500, 'NE')}${txt(R, 230, 170, 500, 'ATL')}
${txt(L, 620, 330, 700, '3')}${txt(R, 620, 330, 700, '28')}
<rect x="0" y="${SPLIT}" width="${S}" height="${S - SPLIT}" fill="url(#fondo)"/>
<text x="${L}" y="${SPLIT + 175}" font-family="Avenir Next" font-weight="500" fill="#b9c0cc" text-anchor="middle"><tspan font-size="150">3</tspan><tspan font-size="112">RD</tspan></text>
${txt(R, SPLIT + 175, 150, 500, '2:17')}
</svg>`;

const png = (size) => new Resvg(svg, {
    fitTo: { mode: 'width', value: size },
    font: { fontFiles: [FONT], loadSystemFonts: false, defaultFontFamily: 'Avenir Next' },
}).render().asPng();
for (const n of [180, 192, 512]) writeFileSync(join(OUT, `gameday-${n}.png`), png(n));
console.log('Scritte icons/gameday-{180,192,512}.png');
