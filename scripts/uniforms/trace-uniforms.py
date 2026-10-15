"""Genera js/ui/uniform-shapes.js: le sagome delle divise, estratte pixel per
pixel dalla tavola delle divise dei Philadelphia Eagles 2026 di Wikipedia.

    python3 scripts/uniforms/trace-uniforms.py <tavola.png> [js/ui/uniform-shapes.js]

La tavola è il PNG trasparente 3840×2628 della pagina "Philadelphia Eagles"
(quattro figurini: Home, Away, Alternate, Kelly Green). Non è nel repo: va
scaricata. Servono numpy, scipy e opencv-python-headless.

Come funziona, perché non è ovvio:
  - lo sfondo è TRASPARENTE e ogni pezzo ha un contorno nero vero (~5 px):
    la sagoma si prende dal canale alfa, il colore dal riempimento;
  - le coordinate sono quelle del PRIMO figurino; gli altri tre stanno a
    +946, +1893, +2851 px (DX) e servono dove il primo non basta: la fascia
    del polsino viene dall'Alternate, il piping a due colori dal Kelly;
  - le toppe sulle maniche sbordano dalla sagoma, e in un punto diverso fra
    Home e Kelly: in quella zona vale l'intersezione delle due;
  - la griglia del casco è nero opaco contornato di grigio, e le aperture
    sono trasparenti: barre e aperture si separano dall'alfa;
  - lo scudetto NFL copre la punta del colletto: la V si ricostruisce
    prolungando i due lati.
"""
import sys, json, numpy as np, cv2
from scipy import ndimage as ndi

raw = cv2.imread(sys.argv[1], cv2.IMREAD_UNCHANGED)
OUT = sys.argv[2] if len(sys.argv) > 2 else 'js/ui/uniform-shapes.js'
rgb_all = raw[:, :, 2::-1].astype(int)
alpha_all = raw[:, :, 3]
DX = {'home': 0, 'away': 946, 'alt': 1893, 'kelly': 2851}
H = raw.shape[0]

def fig(name):
    dx = DX[name]
    a = np.zeros((H, 980, 3), int); al = np.zeros((H, 980), np.uint8)
    w = min(980, raw.shape[1] - dx)
    a[:, :w] = rgb_all[:, dx:dx + w]; al[:, :w] = alpha_all[:, dx:dx + w]
    return a, al > 127

def col(a, hexes, tol=10):
    m = np.zeros(a.shape[:2], bool)
    for h in hexes:
        c = np.array([int(h[i:i + 2], 16) for i in (1, 3, 5)])
        m |= (np.abs(a - c).max(axis=2) <= tol)
    return m

def Z(m, x0, y0, x1, y1):
    z = np.zeros_like(m); z[y0:y1, x0:x1] = m[y0:y1, x0:x1]; return z
def K(r): return cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1, 2 * r + 1))
def fill(m): return ndi.binary_fill_holes(m)
def close(m, r): return cv2.morphologyEx(m.astype(np.uint8), cv2.MORPH_CLOSE, K(r)).astype(bool)
def opn(m, r): return cv2.morphologyEx(m.astype(np.uint8), cv2.MORPH_OPEN, K(r)).astype(bool)
def dil(m, r): return cv2.dilate(m.astype(np.uint8), K(r)).astype(bool)
def ero(m, r): return cv2.erode(m.astype(np.uint8), K(r)).astype(bool)
def big(m, n=1):
    lab, k = ndi.label(m)
    if not k: return m
    s = ndi.sum(m, lab, range(1, k + 1))
    return np.isin(lab, np.argsort(s)[::-1][:n] + 1)
def nosmall(m, area):
    lab, k = ndi.label(m)
    if not k: return m
    s = ndi.sum(m, lab, range(1, k + 1))
    return np.isin(lab, [i + 1 for i, v in enumerate(s) if v >= area])
def smooth(m, r=1.0): return ndi.gaussian_filter(m.astype(float), r) > 0.5
def hull(m):
    h = cv2.convexHull(np.argwhere(m)[:, ::-1].astype(np.int32))
    z = np.zeros(m.shape, np.uint8); cv2.fillPoly(z, [h], 1); return z.astype(bool)

def path(m, eps=0.8, min_area=20):
    cs, _ = cv2.findContours(m.astype(np.uint8), cv2.RETR_CCOMP, cv2.CHAIN_APPROX_NONE)
    out = []
    for c in cs:
        if abs(cv2.contourArea(c)) < min_area: continue
        a = cv2.approxPolyDP(c, eps, True).reshape(-1, 2)
        if len(a) >= 3: out.append('M' + ' '.join(f'{x} {y}' for x, y in a) + 'Z')
    return ''.join(out)
def bbox(m):
    ys, xs = np.where(m)
    return [int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())] if len(xs) else None

def grey(a, lo=55, hi=150):
    v = a.max(axis=2); return ((a.max(axis=2) - a.min(axis=2)) <= 6) & (v >= lo) & (v <= hi)

MID = ['#004851', '#004750', '#004952', '#00464F']
WHITE = ['#FFFFFF', '#FEFEFE']
out = {}
home, ah = fig('home'); away, aa = fig('away'); alt, at = fig('alt'); kel, ak = fig('kelly')
BLACK_H = (home.max(axis=2) <= 30) & ah

# ── casco ──────────────────────────────────────────────
HZ = (200, 0, 760, 470)
mid = Z(col(home, MID), *HZ)
wk = Z(col(home, ['#1A1A1A', '#191919', '#1B1B1B'], 6), *HZ)
ww = Z(col(home, WHITE, 14), *HZ)
wg = Z(col(home, ['#B9C9D2'], 16), *HZ)
screw = nosmall(Z(col(home, ['#4D4D4D'], 8), *HZ), 60)
wing_px = wk | ww | wg
mid_hull = hull(big(mid))
# il guscio sotto la griglia e sotto le ali: si chiude il midnight con un
# raggio pari alla barra (le barre lo attraversano), dentro il suo inviluppo
shell = fill(close(big(mid) | (wing_px & mid_hull) | screw, 12) & mid_hull)
shell = fill(big(opn(shell, 2)))
# il foro dell'orecchio è trasparente, con un anello nero attorno
ear_hole = big(opn(shell & ~ah, 3))
shell_line = dil(shell, 5) & ~ear_hole
shell_fill = shell & ~dil(ear_hole, 5)
out['SHELL_FILL'] = path(smooth(shell_fill))
out['SHELL_LINE'] = path(smooth(shell_line))
wing = fill(close(wing_px, 2))
wing = big(opn(wing, 1))
out['WING_LINE'] = path(smooth(dil(wing, 1) | Z(dil(wing, 6) & ah & ~dil(shell, 5) & BLACK_H, *HZ)))
out['WING_K'] = path(smooth(wing))
out['WING_W'] = path(smooth(opn(ww & wing, 1)))
out['WING_G'] = path(smooth(opn(wg & wing, 1)))
ear = ear_hole
out['EAR'] = ''
out['SCREWS'] = path(smooth(screw))

MZ = (200, 150, 490, 470)
helm = Z(ah, *HZ)
mask_all = Z(helm & ~dil(shell, 5) & ~dil(wing, 2), *MZ)
# le barre che passano sopra il guscio: nero opaco dentro il guscio, attaccato
# al resto della griglia
over = Z(BLACK_H & shell_fill & ~wing & ~dil(mid, 0) & ~screw, *MZ)
mask_all = big(mask_all | Z(grey(home) & ~dil(screw, 2), *MZ) | over)
mask_all = opn(mask_all, 1)
mline = mask_all & grey(home)
out['MASK_LINE'] = path(smooth(mask_all))
out['MASK_IN'] = path(smooth(nosmall(opn(mask_all & ~dil(mline, 0), 1), 30)))

# ── maglia ─────────────────────────────────────────────
JZ = (40, 465, 950, 1300)
def jsil(a, al, pants_hex, tol):
    """La maglia: tutto l'opaco della zona tranne i pantaloni (riconosciuti dal
    colore). Il contorno nero dei pantaloni resterebbe attaccato all'orlo
    come due fili: l'apertura li toglie."""
    pz = Z(col(a, pants_hex, tol), 100, 1200, 880, 2100)
    pz = fill(big(pz))
    m = Z(al, *JZ) & ~dil(pz, 0)
    return fill(big(opn(m, 4)))
j_home = jsil(home, ah, WHITE, 24)
j_kel = jsil(kel, ak, ['#CBCBCB'], 12)
# le toppe sbordano dalla manica: lì vale la sagoma del Kelly, la cui toppa
# sta in un altro punto
pzone = np.zeros_like(j_home); pzone[630:780, 40:215] = True; pzone[630:780, 765:950] = True
jersey = (j_home & ~pzone) | (j_home & j_kel & pzone)
jersey = fill(big(opn(close(jersey, 2), 2)))
# il rovescio della manica: il cuneo nero fra l'orlo e l'ascella
sleeve_in = Z(BLACK_H, 40, 740, 330, 880) | Z(BLACK_H, 650, 740, 950, 880)
sleeve_in = nosmall(opn(sleeve_in & ero(jersey, 3), 3), 200)
out['SLEEVE_IN'] = path(smooth(sleeve_in))
out['JERSEY_LINE'] = path(smooth(jersey, 1.5))
out['JERSEY_FILL'] = path(smooth(ero(jersey, 5), 1.5))

CZ = (330, 465, 650, 720)
cg = Z(grey(home), *CZ) & ero(jersey, 2) | Z(grey(home), 330, 465, 650, 520)
cg = nosmall(cg, 40)
collar = hull(big(cg))
def sharpen_v(m):
    """Lo scudetto copre la punta della V: si prolungano i due lati bassi
    dell'inviluppo fino a incontrarsi."""
    h = cv2.convexHull(np.argwhere(m)[:, ::-1].astype(np.int32))
    h = cv2.approxPolyDP(h, 4, True).reshape(-1, 2).astype(float)
    n = len(h)
    lo = np.argsort(h[:, 1])[::-1][:2]           # i due vertici più bassi
    i0, i1 = sorted(lo)
    if not ((i1 - i0) == 1 or (i0 == 0 and i1 == n - 1)): return m
    if i0 == 0 and i1 == n - 1: i0, i1 = i1, i0
    a0, a1 = h[(i0 - 1) % n], h[i0]
    b0, b1 = h[(i1 + 1) % n], h[i1]
    d1, d2 = a1 - a0, b1 - b0
    den = d1[0] * d2[1] - d1[1] * d2[0]
    if abs(den) < 1e-6: return m
    t = ((b0[0] - a0[0]) * d2[1] - (b0[1] - a0[1]) * d2[0]) / den
    tip = a0 + t * d1
    poly = np.vstack([h[:i0 + 1], [tip], h[i1:]]) if i1 > i0 else np.vstack([h[:i1 + 1], h[i1 + 1:i0 + 1], [tip]])
    z = np.zeros(m.shape, np.uint8); cv2.fillPoly(z, [poly.astype(np.int32)], 1)
    return z.astype(bool) | m
collar = sharpen_v(collar)
out['COLLAR_TIP'] = [int(v) for v in np.argwhere(collar)[np.argmax(np.argwhere(collar)[:, 0])][::-1]]
neck = big(opn(collar & Z(col(home, MID), *CZ), 2))
out['COLLAR'] = path(smooth(collar))
out['NECK'] = path(smooth(neck))
out['COLLAR_LINES'] = path(smooth(cg & collar, 0.7), eps=0.6)
cuff_px = col(alt, MID)
cuff = nosmall(opn(Z(cuff_px, 40, 680, 330, 880) | Z(cuff_px, 650, 680, 950, 880), 1), 200)
out['CUFF'] = path(smooth(cuff))

w_home = col(home, WHITE, 20)
out['NUM_BOX'] = bbox(Z(w_home, 300, 780, 690, 1120))
out['TV_L_BOX'] = bbox(Z(w_home, 150, 500, 340, 640))
out['TV_R_BOX'] = bbox(Z(w_home, 640, 500, 840, 612))
out['WORD_BOX'] = bbox(Z(w_home, 380, 735, 600, 800))
pl = nosmall(Z(ah & ~col(home, MID) & ~BLACK_H & ~grey(home), 40, 645, 230, 770), 30)
pr = nosmall(Z(ah & ~col(home, MID) & ~BLACK_H & ~grey(home), 750, 645, 950, 770), 30)
out['PATCH_L_BOX'] = bbox(pl); out['PATCH_R_BOX'] = bbox(pr)


# ── il Kelly Green ha un taglio suo ────────────────────
BLACK_K = (kel.max(axis=2) <= 30) & ak
kj = fill(big(opn(close(j_kel | (j_home & j_kel & pzone), 2), 2)))
# toppa del Kelly: lì vale la sagoma della Home
kj = (kj & ~pzone) | (kj & j_home & pzone)
kj = fill(big(opn(kj, 2)))
out['KJERSEY_LINE'] = path(smooth(kj, 1.5))
out['KJERSEY_FILL'] = path(smooth(ero(kj, 5), 1.5))
out['KCOLLAR_LINES'] = path(smooth(nosmall(Z(BLACK_K, *CZ) & ero(kj, 3), 40), 0.7), eps=0.6)
KG = ['#2A8B4E', '#298A4D', '#2A8C4E']
kmid = Z(col(kel, KG, 8), *HZ)
kws = Z(col(kel, ['#D2D2D2', '#D1D1D1', '#D3D3D3'], 6), *HZ)
kww = Z(col(kel, WHITE, 14), *HZ)
# griglia e ala hanno quasi la stessa tinta: la griglia (nota dalla Home) si
# toglie prima, o il pezzo più grande sarebbe la sua barra alta
kwing = big(opn(fill(close((kws | kww) & ~dil(mask_all, 4), 2)), 1))
out['KWING_S'] = path(smooth(kwing))
out['KWING_W'] = path(smooth(opn(kww & kwing, 1)))
kw_home = col(kel, WHITE, 20)
out['KNUM_BOX'] = bbox(Z(kw_home, 300, 780, 690, 1120))
out['KTV_L_BOX'] = bbox(nosmall(Z(kw_home, 150, 500, 340, 640), 40))
out['KTV_R_BOX'] = bbox(nosmall(Z(kw_home, 640, 500, 840, 612), 40))

# ── pantaloni e calzettoni ─────────────────────────────
rows = ah[:, 0:980]
gap = 2060 + int(np.argmin(rows[2060:2130, 150:830].sum(axis=1)))
out['GAP_Y'] = gap
PZ = (100, 1200, 880, gap)
pants = fill(big(Z(ah, *PZ) & ~ero(jersey, 3)))
pants = fill(big(opn(pants, 2)))
out['PANTS_LINE'] = path(smooth(pants, 1.5))
out['PANTS_FILL'] = path(smooth(ero(pants, 5), 1.5))
inner = ero(pants, 8)
# le cuciture sono righe di 3 px: niente lisciatura, o si spezzano
out['SEAMS'] = path(nosmall(dil(Z(BLACK_H, *PZ) & inner, 1), 40), eps=0.5, min_area=5)
out['PIPE_GREY'] = path(smooth(nosmall(Z(grey(home), *PZ) & pants, 1500), 0.8), eps=0.5)
out['PIPE_SILVER'] = path(smooth(nosmall(Z(col(alt, ['#A2AAAD'], 12), *PZ), 1500), 0.8), eps=0.5)
out['PIPE_THICK'] = path(smooth(nosmall(Z(col(kel, ['#2A8B4E', '#298A4D', '#288A4C'], 10), *PZ), 1500), 0.8), eps=0.5)
out['PIPE_THIN'] = path(smooth(nosmall(Z(col(kel, WHITE, 24), *PZ), 1500), 0.8), eps=0.5)

SZ = (150, gap, 830, 2470)
socks = nosmall(fill(Z(ah, *SZ)), 500)
socks = opn(socks, 2)
out['SOCKS_LINE'] = path(smooth(socks, 1.5))
out['SOCKS_FILL'] = path(smooth(ero(socks, 5), 1.5))
out['SOCK_BANDS'] = path(smooth(nosmall(Z(col(kel, ['#2A8B4E', '#298A4D'], 10), *SZ), 100)), eps=0.6)

BOXES = [k for k, v in out.items() if k.endswith('_BOX')]
# le ali degli Eagles si estraggono ancora (servono a separare il guscio), ma
# il sito non le disegna: dal 2026-10-14 tutti i caschi portano il logo
SKIP = {'EAR', 'GAP_Y', 'COLLAR_TIP', 'PIPE_SILVER',
        'WING_LINE', 'WING_K', 'WING_W', 'WING_G', 'KWING_S', 'KWING_W'}
lines = ["/**",
         " * Sagome delle divise — FILE GENERATO, non modificarlo a mano.",
         " *",
         " * Tracciati estratti pixel per pixel dalla tavola delle divise dei",
         " * Philadelphia Eagles 2026 di Wikipedia (PNG trasparente, 3840×2628) da",
         " * scripts/uniforms/trace-uniforms.py. Le coordinate sono i pixel del primo",
         " * figurino di quella tavola. Per correggere una forma si rilancia lo script,",
         " * non si ritocca qui: un tracciato modificato a mano si perde al giro dopo.",
         " *",
         " * *_LINE è la sagoma intera col contorno, *_FILL l'interno dove va il colore.",
         " * I K* sono i pezzi del Kelly Green, che ha un taglio suo (colletto, ala).",
         " * I *_BOX sono i rettangoli [x0, y0, x1, y1] di numeri, scritta e toppe.",
         " */",
         "export const SHAPES = {"]
for k, v in out.items():
    if k in SKIP or k in BOXES: continue
    lines.append(f"    {k}: '{v}',")
for k in BOXES:
    lines.append(f"    {k}: {json.dumps(out[k])},")
lines.append("};\n")
open(OUT, 'w').write('\n'.join(lines))
for k, v in out.items():
    print(k, len(v) if isinstance(v, str) else v)
