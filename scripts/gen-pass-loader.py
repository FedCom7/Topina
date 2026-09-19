# -*- coding: utf-8 -*-
"""Genera il blocco CSS della scena del lancio.

Le due figure fanno LA STESSA COSA a mezzo ciclo di distanza: chi ha lanciato
riceve, chi ha ricevuto rilancia. Quindi la tabella delle pose si scrive UNA
volta, per la figura di sinistra, e quella di destra si ricava specchiandola
(x -> 154-x, rotazioni negate) e spostandola di +50%.
Scrivere a mano due serie di angoli con i segni girati e' il modo piu' rapido
per sbagliarne uno e non trovarlo piu'.
"""

MIRROR = 154.0          # asse di simmetria: 20+134 = 24+130 = 25.3+128.7 = 154
SHIFT = 50              # mezzo ciclo

# ── tabella delle pose, figura di SINISTRA ────────────────────────────────
# convenzione: rotazione positiva = arto verso -x (indietro, per chi guarda a
# destra). La figura di destra nega tutto.
POSES = {
    'shift':    {0:(-0.5,0.2), 8:(-1.2,0.3), 13:(-0.8,0.4), 15:(0.8,0.8),
                 18:(3,1.4), 22:(3.4,1.2), 30:(3.6,1.0), 42:(1.0,0.5),
                 50:(-0.5,0.2), 62:(-0.5,0.2), 75:(-0.5,0.2), 83:(-0.5,-2.0),
                 88:(-0.5,-0.4), 92:(-0.5,0.2), 100:(-0.5,0.2)},
    'turn':     {0:-4, 8:-6, 13:-7, 15:-2, 18:6, 22:8, 30:8, 42:2,
                 50:-4, 62:-4, 75:2, 83:5, 88:0, 92:-2, 100:-4},
    'arm-throw':    {0:19, 8:60, 13:81, 15:125, 18:251, 22:285, 30:349, 42:379,
                 50:379, 62:372, 75:340, 83:306, 88:330, 92:382, 100:379},
    'forearm-throw':{0:-116, 8:-200, 13:-256, 15:-275, 18:-387, 22:-380, 30:-307,
                 42:-476, 50:-476, 62:-472, 75:-466, 83:-451, 88:-465,
                 92:-489, 100:-476},
    'arm-off':    {0:12, 8:-20, 13:-60, 15:-75, 18:10, 22:35, 30:30, 42:14,
                 50:12, 62:6, 75:-34, 83:-45, 88:-14, 92:28, 100:12},
    'forearm-off':{0:-104, 8:-70, 13:-40, 15:-35, 18:-120, 22:-130, 30:-125,
                 42:-108, 50:-104, 62:-100, 75:-80, 83:-97, 88:-115,
                 92:-133, 100:-104},
    'thigh-a':  {0:-12, 8:-16, 13:-30, 15:-34, 18:-26, 22:-24, 30:-22, 42:-14,
                 50:-12, 62:-14, 75:-18, 83:-36, 88:-24, 92:-18, 100:-12},
    'shin-a':   {0:4, 8:14, 13:26, 15:20, 18:8, 22:5, 30:3, 42:4,
                 50:4, 62:6, 75:12, 83:46, 88:20, 92:12, 100:4},
    'thigh-b':  {0:12, 8:14, 13:16, 15:20, 18:26, 22:42, 30:55, 42:10,
                 50:12, 62:13, 75:14, 83:26, 88:18, 92:14, 100:12},
    'shin-b':   {0:6, 8:4, 13:6, 15:14, 18:22, 22:34, 30:44, 42:14,
                 50:6, 62:10, 75:16, 83:28, 88:20, 92:16, 100:6},
}

# La frustata ha la sua curva: accelera fino al rilascio, poi decelera.
EASE_IN  = 'cubic-bezier(.45, 0, .9, .35)'
EASE_OUT = 'cubic-bezier(.1, .7, .3, 1)'
EASING = {15: EASE_IN, 18: EASE_OUT}
WHIP = ('shift', 'turn', 'arm-throw', 'forearm-throw', 'thigh-a', 'thigh-b', 'shin-b')


def flip(val, mirror):
    if not mirror:
        return val
    return (-val[0], val[1]) if isinstance(val, tuple) else -val


def shift_keys(table, mirror):
    """Sposta di mezzo ciclo e, se serve, specchia.

    Il braccio del lancio compie un giro INTERO per ogni lancio: alla fine del
    ciclo vale 379 gradi dove all'inizio ne valeva 19. Sono la stessa posa, e
    per la figura di sinistra la cosa non si vede — quel salto sta esattamente
    sul confine 100%%/0%%, dove l'animazione riparte e non interpola.
    Spostando di mezzo giro pero' quel confine finisce in MEZZO al ciclo
    dell'altra figura, e li' il browser interpola: 320 gradi di mulinello, con
    il braccio che fa il giro della morte prima di caricare.
    Si risolve sdoppiando il keyframe: a 49.99%% la fine del giro, a 50%% lo
    stesso identico gesto riscritto col numero di partenza. Il salto c'e' ma e'
    fra due pose uguali, quindi non si vede.
    """
    out = {}
    for pct, val in table.items():
        if pct in (0, 100):
            continue
        out[(pct + SHIFT) % 100] = flip(val, mirror)
    start, end = table[0], table[100]
    if start == end:
        out[SHIFT] = flip(start, mirror)
    else:
        out[SHIFT - 0.01] = flip(end, mirror)
        out[SHIFT] = flip(start, mirror)
    out[0] = flip(table[SHIFT], mirror)
    out[100] = out[0]
    return out


def fmt(val):
    if isinstance(val, tuple):
        return 'translate(%gpx, %gpx)' % val
    return 'rotate(%gdeg)' % val


def keyframes(name, table, easing):
    lines = ['@keyframes %s {' % name]
    for pct in sorted(table):
        tail = ''
        if pct in easing:
            tail = ' animation-timing-function: %s;' % easing[pct]
        lines.append('    %-5s { transform: %s;%s }' % ('%g%%' % pct, fmt(table[pct]), tail))
    lines.append('}')
    return '\n'.join(lines)


def build(side):
    mirror = side == 'r'
    out = []
    for prop, table in POSES.items():
        t = shift_keys(table, mirror) if mirror else dict(table)
        eas = {(k + SHIFT) % 100: v for k, v in EASING.items()} if mirror else dict(EASING)
        eas = eas if prop in WHIP else {}
        out.append(keyframes('tl-pass-%s-%s' % (side, prop), t, eas))
    return '\n\n'.join(out)


def base(side):
    """Posa dello 0% — quella che resta in piedi con prefers-reduced-motion."""
    mirror = side == 'r'
    vals = {}
    for prop, table in POSES.items():
        t = shift_keys(table, mirror) if mirror else dict(table)
        v = t[0]
        if not isinstance(v, tuple):
            v = (v + 180) % 360 - 180      # l'equivalente leggibile
        vals[prop] = fmt(v)
    return vals



# ── dove sta la palla quando e' in mano ───────────────────────────────────
# Prima queste erano sei coppie di numeri scritte a mano, con un commento che
# diceva "se cambiano gli angoli del braccio vanno ricalcolate". Adesso si
# calcolano: si parte dagli angoli, si trova la mano, e la palla si mette li'.
# Cambiare una posa non puo' piu' staccare la palla dal pugno.
from math import sin, cos, tan, radians, degrees, atan2, hypot

SPALLA = (24.0, 14.0)
ANCA = (20.0, 25.0)
BRACCIO, AVAMBRACCIO = 6.0, 5.5
# Quanto la mano e' spostata verso la punta VICINA al corpo. La palla e' lunga
# 8.4 (rx 4.2): con 2.3 la punta vicina resta a 1.9 dalle dita e quella lontana
# sporge di 6.5, che e' come la si tiene davvero — non al centro, come se fosse
# infilzata sul polso.
PRESA = 2.3
# Dove guarda chi lancia: la spalla dell'altro omino. E' lo stesso punto per
# tutti e due, perche' la figura di destra si ricava specchiando questa.
BERSAGLIO = (154.0 - 24.0, 14.0)


def _arto(theta, rho):
    """Gomito, mano e direzione dell'avambraccio, dagli angoli del rig."""
    t, tau = radians(theta), radians(theta + rho)
    gom = (SPALLA[0] - BRACCIO * sin(t), SPALLA[1] + BRACCIO * cos(t))
    d = (-sin(tau), cos(tau))
    return (gom[0] + AVAMBRACCIO * d[0], gom[1] + AVAMBRACCIO * d[1]), d


def _posa(t):
    """La posa a un istante qualsiasi, interpolando fra i keyframe vicini."""
    out = {}
    for prop, tab in POSES.items():
        if isinstance(next(iter(tab.values())), tuple):
            continue
        ks = sorted(tab)
        if t in tab:
            out[prop] = tab[t]; continue
        a = max(k for k in ks if k <= t); b = min(k for k in ks if k >= t)
        f = (t - a) / (b - a)
        out[prop] = tab[a] + (tab[b] - tab[a]) * f
    # lo spostamento del corpo e' una coppia: si interpola a parte
    tab = POSES['shift']; ks = sorted(tab)
    if t in tab:
        out['shift'] = tab[t]
    else:
        a = max(k for k in ks if k <= t); b = min(k for k in ks if k >= t)
        f = (t - a) / (b - a)
        out['shift'] = tuple(tab[a][i] + (tab[b][i] - tab[a][i]) * f for i in (0, 1))
    return out


def mano_media(t):
    """Il punto medio delle due mani, in coordinate del mondo. E' dove arriva
    la palla quando viene presa: al momento della presa sta FRA le dita, non
    ancora impugnata verso una punta."""
    q = _posa(t)
    mb, _ = _arto(q['arm-throw'], q['forearm-throw'])
    ma, _ = _arto(q['arm-off'], q['forearm-off'])
    G = ((ma[0] + mb[0]) / 2, (ma[1] + mb[1]) / 2)
    phi = radians(q['turn'])
    vx, vy = G[0] - ANCA[0], G[1] - ANCA[1]
    return (round(ANCA[0] + vx * cos(phi) - vy * sin(phi) + q['shift'][0], 2),
            round(ANCA[1] + vx * sin(phi) + vy * cos(phi) + q['shift'][1], 2))


def palla_in_mano(t, due_mani):
    """(x, y, rotazione) della palla tenuta dalla figura di SINISTRA a t.

    Tre regole, tutte chieste guardando come si tiene un pallone davvero:
      - sta FRA le due mani quando le mani sono due (G e' il loro punto medio);
      - il MUSO PUNTA IL BERSAGLIO, cioe' l'altro omino. Un quarterback pronto
        a lanciare tiene la palla col naso verso chi deve riceverla, e la tiene
        cosi' per tutto il caricamento: non e' una posa, e' mira. (Il
        corridore no: lui la stringe al petto, e li' la regola resta
        perpendicolare all'avambraccio.)
      - la si impugna verso la punta vicina al corpo, quindi il centro e'
        spostato di PRESA lungo l'asse, in avanti: la mano resta dietro e la
        palla sporge verso il bersaglio.

    Il conto si fa in coordinate del MONDO, non del disegno: il bersaglio e' un
    punto fisso della scena, e se si calcolasse la direzione prima di
    applicare la rotazione del busto la mira sbaglierebbe degli stessi gradi
    di cui il torso e' girato (fino a 8, che su un lancio si vedono).
    """
    q = _posa(t)
    mano_b, _ = _arto(q['arm-throw'], q['forearm-throw'])
    if due_mani:
        mano_a, _ = _arto(q['arm-off'], q['forearm-off'])
        G = ((mano_a[0] + mano_b[0]) / 2, (mano_a[1] + mano_b[1]) / 2)
    else:
        G = mano_b
    # prima nel mondo: rotazione attorno all'anca, poi traslazione del corpo
    phi = radians(q['turn'])
    vx, vy = G[0] - ANCA[0], G[1] - ANCA[1]
    G = (ANCA[0] + vx * cos(phi) - vy * sin(phi) + q['shift'][0],
         ANCA[1] + vx * sin(phi) + vy * cos(phi) + q['shift'][1])
    # poi la mira
    d = (BERSAGLIO[0] - G[0], BERSAGLIO[1] - G[1])
    n = hypot(*d) or 1.0
    d = (d[0] / n, d[1] / n)
    return (round(G[0] + PRESA * d[0], 2),
            round(G[1] + PRESA * d[1], 2),
            round(degrees(atan2(d[1], d[0])), 1))


# ── palla: mezzo ciclo costruito, l'altro specchiato ──────────────────────
# Niente numeri a mano. Quando e' in mano la posizione viene dalle mani
# (palla_in_mano); quando vola viene dalla parabola; e il punto di rilascio e'
# esattamente dove la palla era un istante prima, cioe' in pugno.
RILASCIO_T, PRESA_T = 18, 33          # gli istanti, in percentuale di ciclo
ALFA = 25.0                            # angolo di lancio, gradi sopra l'orizzonte
PASSI = 5                              # keyframe del volo (uno ogni 3%)


def _parabola(p0, p1):
    """Tiro balistico da p0 a p1 con partenza ad ALFA gradi.
    Orizzontale a velocita' costante, verticale quadratico: il muso della palla
    sta sulla tangente, quindi gli angoli NON sono scelti a occhio."""
    R = p1[0] - p0[0]
    b = -R * tan(radians(ALFA))
    c = (p1[1] - p0[1]) - b
    out = []
    for k in range(PASSI + 1):
        u = k / PASSI
        x = p0[0] + R * u
        y = p0[1] + b * u + c * u * u
        rot = degrees(atan2(b + 2 * c * u, R))
        out.append((RILASCIO_T + (PRESA_T - RILASCIO_T) * u, round(x, 2), round(y, 2), round(rot, 1)))
    return out


def _continua(seq):
    """La palla e' simmetrica: ruotarla di 180 gradi da la stessa immagine.
    Si sfrutta per tenere la rotazione CONTINUA — senza, fra due keyframe la
    scelta della perpendicolare si ribalta e la palla fa un mezzo giro in un
    fotogramma (succedeva fra la presa e la stretta al petto: 48 gradi e poi
    -108, cioe' 156 gradi di rotazione in 4 centesimi di ciclo)."""
    out = []
    prec = None
    for t, x, y, r in seq:
        if prec is not None:
            while r - prec > 90: r -= 180
            while prec - r > 90: r += 180
        out.append((t, x, y, round(r, 1)))
        prec = r
    return out


def _tabella_palla():
    seq = [(t, *palla_in_mano(t, t == 0)) for t in (0, 8, 13, 15, 16.5)]
    rilascio = palla_in_mano(RILASCIO_T, False)
    presa = mano_media(PRESA_T + SHIFT)          # le mani di CHI riceve
    presa = (MIRROR - presa[0], presa[1])        # ...che sta specchiato
    seq += _parabola((rilascio[0], rilascio[1]), presa)
    # dopo la presa la palla e' del ricevitore: le sue pose sono quelle della
    # figura di sinistra mezzo ciclo dopo, ribaltate
    for t in (38, 42):
        x, y, r = palla_in_mano(t + SHIFT, True)
        seq.append((t, MIRROR - x, y, -r))
    # il 50% (la palla in mano all'altro) NON si scrive: lo genera lo specchio
    # in ball_keyframes(). Scriverlo qui vuol dire che il SUO specchio riscrive
    # lo 0% con la rotazione girata di 360 gradi, e fra 0% e 8% la palla fa un
    # giro della morte.
    return {t: (x, y, r) for t, x, y, r in _continua(sorted(seq))}


BALL = _tabella_palla()

BALL_EASE = {0: 'ease-in-out', 8: 'ease-in-out', 13: 'ease-in-out',
             15: EASE_IN, 33: 'ease-out', 38: 'ease-out', 42: 'ease-out'}

FLIGHTS = ((18, 33), (68, 83))   # i due voli, 15% l'uno
TURNS = 5                         # giri di spirale per volo: 625 rpm


def ball_keyframes():
    table, eas = {}, {}
    for pct, (x, y, rot) in BALL.items():
        table[pct] = (x, y, rot)
        # lo specchio NEGA la rotazione: e' il motivo per cui la continuita' va
        # rifatta sul ciclo INTERO e non basta quella della meta' scritta
        table[(pct + SHIFT) % 100] = (MIRROR - x, y, -rot)
        if pct in BALL_EASE:
            eas[pct] = eas[(pct + SHIFT) % 100] = BALL_EASE[pct]

    # continuita' su tutto il giro, sfruttando che la palla e' simmetrica:
    # ruotarla di 180 gradi da' la stessa immagine, quindi si sceglie sempre
    # l'equivalente piu' vicino al keyframe precedente
    ordine = sorted(table)
    prec = None
    for t in ordine:
        x, y, r = table[t]
        if prec is not None:
            while r - prec > 90: r -= 180
            while prec - r > 90: r += 180
        table[t] = (x, y, round(r, 1))
        prec = r

    # Il 100% deve rendere IDENTICO allo 0%, quindi non basta "a meno di 180":
    # ci vuole lo stesso angolo a meno di un giro intero. Si prende
    # l'equivalente piu' vicino all'ultimo keyframe, cosi' l'ultimo tratto non
    # fa una mezza piroetta e il salto del ciclo cade fra due immagini uguali.
    x0, y0, r0 = table[ordine[0]]
    ultimo = table[ordine[-1]][2]
    r100 = r0
    while r100 - ultimo > 180: r100 -= 360
    while ultimo - r100 > 180: r100 += 360
    table[100] = (x0, y0, round(r100, 1))

    lines = ['@keyframes tl-pass-ball {']
    for pct in sorted(table):
        x, y, rot = table[pct]
        tail = ' animation-timing-function: %s;' % eas[pct] if pct in eas else ''
        lines.append('    %-6s { transform: translate(%gpx, %gpx) rotate(%gdeg);%s }'
                     % ('%g%%' % pct, x, y, rot, tail))
    lines.append('}')
    return '\n'.join(lines)


def spiral_keyframes():
    face, top, bot = [0, 100], [], []
    for start, end in FLIGHTS:
        step = (end - start) / TURNS
        for k in range(TURNS):
            t = start + k * step
            face.append(t)
            top.append(round(t + step * 0.25, 2))
            bot.append(round(t + step * 0.75, 2))
        face.append(end)
    f = lambda xs: ', '.join('%g%%' % x for x in sorted(set(xs)))
    return ('@keyframes tl-pass-spiral {\n'
            '    %s { transform: translateY(0) scaleY(1); opacity: 1; }\n'
            '    %s { transform: translateY(-2.1px) scaleY(0.08); opacity: 0; }\n'
            '    %s { transform: translateY(2.1px) scaleY(0.08); opacity: 0; }\n}'
            % (f(face), f(top), f(bot)))


HEAD = '''
/* ─────────────────────────────────────────────────────────────────────────
   Il secondo logo di caricamento: due omini che si passano la palla, avanti e
   indietro, senza mai fermarsi. Convive con la corsa: quale delle due si vede
   lo decide js/ui/spinner.js, una volta per caricamento pagina.

   IL CICLO E' SIMMETRICO, e questa e' la cosa da sapere prima di toccarlo.
   Chi ha lanciato riceve, chi ha ricevuto rilancia: la seconda meta' del ciclo
   e' la prima RIBALTATA (x -> 154-x, rotazioni negate) e spostata di mezzo
   giro. Per questo tutti i keyframe delle due figure li scrive un generatore
   — scripts/gen-pass-loader.py — da una tabella di pose sola, quella di
   sinistra. A mano sarebbero due serie di angoli con i segni girati: basta
   sbagliarne uno e non lo si trova piu'.
   **Non si modificano questi keyframe a mano: si cambia la tabella e si
   rigenera.** L'asse di simmetria e' x=77, ed e' per questo che le ancHe
   stanno a 20 e 134, le spalle a 24 e 130, le teste a 25.3 e 128.7.

   La palla NON sparisce mai: non c'e' nessuna animazione di opacita'. Nella
   prima versione la scena finiva con la palla in mano al ricevitore e il giro
   dopo ricompariva dall'altra parte — un taglio che si vedeva. Qui il possesso
   cambia davvero, quindi il ciclo si chiude da solo.

   Ciclo da 3.2s, mezzo giro a testa. Le tappe della meta' di sinistra (a
   destra tutto +50%) sono le quattro fasi vere del lancio:
       0%     la palla sta al petto con DUE mani, peso indietro
       0-13%  wind-up: la palla sale, il gomito si alza
       13%    cocking: la "L" — gomito all'altezza della spalla, avambraccio
              verticale, palla dietro l'orecchio
       15%    massima rotazione esterna: il gomito parte AVANTI e la mano resta
              indietro (il ritardo dell'avambraccio e' la frustata)
       18%    rilascio, braccio in estensione completa, alto e avanti
       18-33% volo: 0.48 s per 83 unita'
       30%    la mano finisce all'ANCA OPPOSTA, gamba dietro sollevata
       33%    l'altro prende, e da li' il mezzo giro ricomincia da lui */
.spinner[data-art="pass"] {
    /* La scena e' larga il triplo (viewBox 154x52): col riquadro da 84 la
       figura verrebbe rimpicciolita dal `meet` e sparirebbe. Le misure tengono
       il rapporto esatto del viewBox, cosi' gli omini vengono alti quanto il
       corridore dell'altra scena (~1.08 px per unita'). */
    width: 166px;
    height: 56px;
}

.tl-pass {
    width: 100%;
    height: 100%;
    overflow: visible;
    fill: none;
    stroke-linecap: round;
    stroke-linejoin: round;
}

/* Qui nessuno avanza: la linea e' ferma, il movimento lo fa la palla. */
.tl-pass-line {
    stroke: var(--border-card);
    stroke-width: 1.5;
    stroke-dasharray: 6 8;
}

.tl-pass-torso,
.tl-pass-l-arm, .tl-pass-l-leg,
.tl-pass-r-arm, .tl-pass-r-leg {
    stroke: currentColor;
    stroke-width: 4.6;
}

.tl-pass-head {
    fill: currentColor;
    stroke: none;
}

.tl-pass-l-upper, .tl-pass-l-arm, .tl-pass-l-forearm, .tl-pass-l-leg, .tl-pass-l-shin,
.tl-pass-r-upper, .tl-pass-r-arm, .tl-pass-r-forearm, .tl-pass-r-leg, .tl-pass-r-shin {
    transform-box: view-box;
}

/* Gli arti LONTANI sono appena spenti, come nella corsa: a 166px un arto dello
   stesso colore sparisce dentro il busto.
   Quale sia quello lontano lo dice la figura, non il ruolo: tutti e due sono
   DESTRIMANI e si guardano, quindi di uno vediamo il fianco destro e
   dell'altro il sinistro. Chi sta a sinistra lancia col braccio lontano
   (spento), chi sta a destra col braccio vicino (a piena tinta). E' l'unica
   disposizione possibile per due destrimani girati al contrario, e si porta
   dietro tutto il resto: da che parte passa la palla rispetto al busto. */
.tl-pass-far {
    opacity: 0.55;
}
'''

FIG = '''
/* ── figura di %(lato)s ─────────────────────────────────────────────────────
   Snodi: anca (%(hip)g,25), ginocchio (%(hip)g,31.5), spalla (%(sh)g,14),
   gomito (%(sh)g,20). Il `transform` fuori dai keyframe e' la posa dello 0%%:
   serve a prefers-reduced-motion, che spegne le animazioni e lascia in piedi
   quella.
   Il gruppo `-upper` tiene busto, testa e braccia e ruota attorno all'ANCA: e'
   la separazione anca-spalle. Le gambe partono in avanti e il torso resta
   indietro caricato, poi ruota e arriva. Senza quel gruppo il busto e'
   inchiodato al bacino e il lancio diventa un gesto di solo braccio. */
.tl-pass-%(s)s {
    transform-box: view-box;
    transform: %(shift)s;
    animation: tl-pass-%(s)s-shift %(dur)s ease-in-out infinite;
}

.tl-pass-%(s)s-upper {
    transform-origin: %(hip)gpx 25px;
    transform: %(turn)s;
    animation: tl-pass-%(s)s-turn %(dur)s ease-in-out infinite;
}

.tl-pass-%(s)s-leg { transform-origin: %(hip)gpx 25px; }
.tl-pass-%(s)s-shin { transform-origin: %(hip)gpx 31.5px; }
.tl-pass-%(s)s-arm { transform-origin: %(sh)gpx 14px; }
.tl-pass-%(s)s-forearm { transform-origin: %(sh)gpx 20px; }

.tl-pass-%(s)s-leg-a {
    transform: %(thigh-a)s;
    animation: tl-pass-%(s)s-thigh-a %(dur)s ease-in-out infinite;
}

.tl-pass-%(s)s-leg-a .tl-pass-%(s)s-shin {
    transform: %(shin-a)s;
    animation: tl-pass-%(s)s-shin-a %(dur)s ease-in-out infinite;
}

.tl-pass-%(s)s-leg-b {
    transform: %(thigh-b)s;
    animation: tl-pass-%(s)s-thigh-b %(dur)s ease-in-out infinite;
}

.tl-pass-%(s)s-leg-b .tl-pass-%(s)s-shin {
    transform: %(shin-b)s;
    animation: tl-pass-%(s)s-shin-b %(dur)s ease-in-out infinite;
}

.tl-pass-%(s)s-arm-throw {
    transform: %(arm-throw)s;
    animation: tl-pass-%(s)s-arm-throw %(dur)s ease-in-out infinite;
}

.tl-pass-%(s)s-arm-throw .tl-pass-%(s)s-forearm {
    transform: %(forearm-throw)s;
    animation: tl-pass-%(s)s-forearm-throw %(dur)s ease-in-out infinite;
}

.tl-pass-%(s)s-arm-off {
    transform: %(arm-off)s;
    animation: tl-pass-%(s)s-arm-off %(dur)s ease-in-out infinite;
}

.tl-pass-%(s)s-arm-off .tl-pass-%(s)s-forearm {
    transform: %(forearm-off)s;
    animation: tl-pass-%(s)s-forearm-off %(dur)s ease-in-out infinite;
}
'''

BALL_CSS = '''
/* ── palla ───────────────────────────────────────────────────────────────
   Niente `opacity`: la palla c'e' sempre, cambia solo padrone.
   Finche' e' in mano i suoi keyframe NON sono la posizione della mano nel
   disegno: sono quella posizione dopo averci applicato sopra lo spostamento
   del corpo e la rotazione del busto. La palla sta fuori dai gruppi delle due
   figure (deve volare via), quindi quelle due trasformazioni se le deve fare a
   mano. Al rilascio la differenza vale 4.7 unita': ignorarla stacca la palla
   dal pugno.
   Il punto al 16.5%% (e al 66.5%%) e' il passaggio SOPRA la testa: senza, la
   palla va in linea retta dall'orecchio alla mano tesa e attraversa la faccia,
   mentre la mano ci passa sopra.

   In volo e' balistica. Numeri veri: un lancio NFL parte fra i 20 e i 30 gradi
   sopra l'orizzonte, e il muso della palla sta sulla tangente — gli angoli NON
   sono scelti a occhio.
       x(u) = 38.19 + 83.31u          (orizzontale a velocita' costante → `linear`)
       y(u) = 11 − 38.85u + 39.94u²   (angolo di lancio 25°, apice 9.5 unita'
                                       sopra il rilascio, presa a (121.5, 12.09))
       angolo = atan(y'(u)/x'(u)) = atan((79.88u − 38.85) / 83.31)
   → -25°, -15.3°, -4.7°, 6.2°, 16.7°, 26.2°, un keyframe ogni 3%% (u di 1/5).
   La prima versione lanciava a 45°: era un pallonetto, non un passaggio.
   Il volo dura 0.48 s per 83 unita'. In scala stretta (un omino alto 33 unita'
   e' alto 6 piedi, quindi una iarda sta in 16.5 unita') sarebbe un lancio di 5
   iarde a 21 mph: un quarto della velocita' vera. Quella vera — 50 mph — vuole
   0.2 s, cioe' cinque fotogrammi: una striscia rossa che non si vede. 0.48 s e'
   il punto in cui la palla e' ancora un oggetto che si segue con l'occhio. */
.tl-pass-ball {
    transform-box: fill-box;
    transform-origin: center;
    transform: translate(%(bx)gpx, %(by)gpx) rotate(%(br)gdeg);
    animation: tl-pass-ball %(dur)s linear infinite;
}

.tl-pass-ball-body {
    fill: var(--accent-red);
    stroke: none;
}

.tl-pass-lace {
    /* bianche SEMPRE, anche in tema chiaro: il pallone e' --accent-red
       (#B8433A) in tutti e due i temi, mentre --text-primary in chiaro
       diventa quasi nero e le cuciture sparivano dentro il rosso. Il fondo
       non cambia, quindi non deve cambiare nemmeno l'inchiostro. */
    stroke: #fff;
    stroke-width: 0.7;
}

.tl-pass-laces {
    transform-box: fill-box;
    transform-origin: center;
    animation: tl-pass-spiral %(dur)s linear infinite;
}
'''

SPIRAL_DOC = '''
/* La spirale. Una palla lanciata bene gira a circa 600 giri al minuto, cioe'
   10 giri al secondo: dentro i 15%% di volo (0.48 s) ce ne stanno CINQUE, uno
   ogni 3%%. Sono 625 rpm — il numero vero, non un compromesso grafico.
   Girando attorno all'asse lungo la SAGOMA della palla non cambia mai (un
   ellissoide che ruota sul proprio asse resta identico): a girare sono solo le
   cuciture. Quindi le muoviamo lungo l'asse corto — su per la faccia,
   schiacciate sul bordo, via dietro, e di nuovo su dal basso — che e' la
   proiezione di un punto che gira. Fuori dai due voli la palla e' in una mano
   e le cuciture stanno ferme in faccia.
   Lo spostamento massimo (2.1) resta dentro il semiasse corto dell'ovale
   (2.7): oltre, le cuciture escono dalla palla e allargano il bounding box che
   fa da origine alla rotazione del padre. */'''

REDUCED = '''
@media (prefers-reduced-motion: reduce) {
    .tl-pass-l, .tl-pass-l-upper, .tl-pass-l-leg, .tl-pass-l-shin,
    .tl-pass-l-arm, .tl-pass-l-forearm,
    .tl-pass-r, .tl-pass-r-upper, .tl-pass-r-leg, .tl-pass-r-shin,
    .tl-pass-r-arm, .tl-pass-r-forearm,
    .tl-pass-ball, .tl-pass-laces {
        animation: none;
    }
}'''

DUR = '3.2s'

# I confini del blocco generato, scritti nel file. Servono perche' write()
# sappia ESATTAMENTE cosa sostituire.
# Prima li deduceva: "dall'intestazione fino a .empty-state". Ha funzionato
# finche' fra le due cose non c'e' stato altro — poi e' arrivato il CSS dei
# caricamenti a pagina piena, che stava proprio li' in mezzo, e ogni
# rigenerazione se lo e' portato via. Un generatore deve sapere dove finisce
# la roba SUA, non dove comincia quella di qualcun altro.
INIZIO = '/* >>> INIZIO blocco generato da scripts/gen-pass-loader.py - non modificare a mano <<< */'
FINE = '/* >>> FINE blocco generato <<< */' 


def css():
    out = [INIZIO, HEAD]
    for side, lato, hip, sh in (('l', 'SINISTRA', 20, 24), ('r', 'DESTRA', 134, 130)):
        d = dict(base(side), s=side, lato=lato, hip=hip, sh=sh, dur=DUR)
        out.append(FIG % d)
    bx, by, br = BALL[0]
    out.append(BALL_CSS % {'dur': DUR, 'bx': bx, 'by': by, 'br': br})
    out.append(build('l'))
    out.append(build('r'))
    out.append(ball_keyframes())
    out.append(SPIRAL_DOC.lstrip('\n'))
    out.append(spiral_keyframes())
    out.append(REDUCED)
    out.append(FINE)
    return '\n'.join(out) + '\n'


def write():
    """Riscrive il blocco della scena del lancio dentro css/main.css.

    Sostituisce SOLO cio' che sta fra i due marcatori. Alla primissima
    esecuzione i marcatori non ci sono ancora e vanno dedotti, ma il confine di
    fine si riconosce dal contenuto generato (l'ultimo pezzo, REDUCED) e non da
    quello che viene dopo: se non lo si trova si esce senza scrivere, invece di
    tirare a indovinare e cancellare il CSS di qualcun altro.

    Deve poter girare due volte di fila e lasciare il file IDENTICO: un
    generatore che non si puo' rilanciare non lo rilancia nessuno.
    """
    import os
    path = os.path.join(os.path.dirname(__file__), '..', 'css', 'main.css')
    src = open(path, encoding='utf-8').read()

    if INIZIO in src and FINE in src:
        i, j = src.index(INIZIO), src.index(FINE) + len(FINE)
    else:
        mark = src.index('Il secondo logo di caricamento')
        i = src.rindex('/*', 0, mark)
        coda = REDUCED.strip('\n')
        if coda not in src:
            raise SystemExit('gen-pass-loader: non riconosco la fine del blocco '
                             'generato. Metti i marcatori a mano e rilancia.')
        j = src.index(coda, i) + len(coda)

    out = src[:i].rstrip('\n') + '\n\n' + css().strip('\n') + '\n\n' + src[j:].lstrip('\n')
    open(path, 'w', encoding='utf-8').write(out)
    print('css/main.css aggiornato')


if __name__ == '__main__':
    write()
