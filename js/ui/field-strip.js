/**
 * La striscia della partita vera: scorebug, campo in prospettiva, ultima
 * giocata. Sta in cima al "dentro la partita" del Live.
 *
 * Il campo del Live (`field-svg.js`) e' un'altra cosa: e' visto dall'alto con
 * UNA end zone in cima, e ci stanno sopra le figurine della formazione
 * fantasy. Qui serve il contrario — il campo intero da bordo campo, con le due
 * end zone ai lati, su cui far correre la palla. Sono due disegni diversi con
 * due scopi diversi, e provare a farne uno solo li rovinerebbe entrambi.
 *
 * Nessun dato, nessuna fetch: riceve uno stato gia' pronto e restituisce
 * markup. Cosi' si prova da solo, senza una partita in corso.
 *
 * Lo stato:
 *   { home:{abbr,name,logo,color,score}, away:{...},
 *     periodo, orologio, down, distance, possesso: 'home'|'away'|null,
 *     toEZ,                         // yard alla end zone di chi attacca
 *     giocata: { testo, titolo, yards, tipo, toEZ, logo } | null,
 *     stato: 'pre'|'in'|'post' }
 */

/* ── Geometria ───────────────────────────────────────────────────────────
   Il campo e' un trapezio: il lato lontano piu' corto di quello vicino. Ogni
   punto si ottiene interpolando fra i due bordi, cosi' la palla e le linee
   stanno sempre sulla prospettiva senza trasformazioni CSS — che con un SVG
   avrebbero sfocato il testo e reso impossibile ancorarci sopra qualcosa. */
const VB_W = 1000;
// Il riquadro sta cucito addosso al campo: con margini larghi l'SVG si portava
// dietro una settantina di pixel vuoti fra il disegno e l'ultima giocata.
// Quello che esce (i pali, la cima della parabola) resta visibile: la classe
// `.fst-campo` non ritaglia.
// Alto quanto serve a porte e parabola: nel riferimento lo spazio sopra il
// campo non e' vuoto, e' il posto dove vive la giocata.
const VB_H = 327;

const LONTANO = { y: 164, x0: 97, x1: 900 };   // bordo in fondo
const VICINO = { y: 293, x0: 46, x1: 956 };    // bordo davanti
const EZ = 0.115;                             // quota di campo presa da una end zone
// Le linee bianche non toccano i bordi: sul campo vero si fermano prima della
// sideline, e disegnarle da sponda a sponda faceva sembrare il manto una
// griglia invece che un campo.
const LINEA_DA = 0.05;
const LINEA_A = 0.95;
const SPESSORE = 3;

/** Punto del campo: `u` da 0 (end zone sinistra) a 1 (destra), `v` da 0
 *  (fondo) a 1 (davanti). */
function P(u, v) {
    const y = LONTANO.y + (VICINO.y - LONTANO.y) * v;
    const x0 = LONTANO.x0 + (VICINO.x0 - LONTANO.x0) * v;
    const x1 = LONTANO.x1 + (VICINO.x1 - LONTANO.x1) * v;
    return [x0 + (x1 - x0) * u, y];
}

const punto = (u, v) => P(u, v).map(n => n.toFixed(1)).join(',');

/* Gli id di `defs` e `clipPath` vivono nel documento, non nell'SVG che li
   contiene: con due strisce a schermo la seconda ereditava le definizioni
   della prima. Ogni istanza si prende il suo suffisso. */
let nIstanza = 0;
let ID = '0';
const rifId = (nome) => `fst-${nome}-${ID}`;

/** Dalla yard di gioco (0-100, 0 = end zone sinistra) alla coordinata `u`,
 *  tenendo conto che le due end zone occupano una fetta del disegno. */
const uDaYard = (y) => EZ + (Math.max(0, Math.min(100, y)) / 100) * (1 - 2 * EZ);

/**
 * `toEZ` e' relativo a chi attacca ("quanto mi manca alla end zone
 * avversaria"). Qui si passa a una scala assoluta 0-100 con lo zero a
 * sinistra, dove sta sempre l'OSPITE — come sugli scorebug in TV.
 *
 * Di conseguenza: l'ospite difende a sinistra e attacca verso destra, quindi
 * la palla sta a 100 - toEZ; la squadra di casa fa il contrario e sta a toEZ.
 * Invertendo le due, il punt partiva dalla meta' campo sbagliata e volava
 * dalla parte opposta.
 */
function yardAssoluta(toEZ, possesso) {
    if (toEZ == null) return null;
    return possesso === 'away' ? 100 - toEZ : toEZ;
}

/** Da che parte si guadagna terreno: l'ospite verso destra, la casa a sinistra. */
const versoDi = (possesso) => (possesso === 'away' ? 1 : -1);

/* ── Disegno ───────────────────────────────────────────────────────────
   La geometria e' MISURATA sul riferimento, non stimata a occhio: campo
   poco convergente (il bordo lontano e' l'88% del vicino, non il 69%) e
   molto schiacciato (alto il 14% della larghezza, non il 21%). Andare a
   sentimento dava un campo troppo "a imbuto" e troppo alto, che e' la prima
   cosa che si notava nel confronto. */

/** Angoli smussati su un quadrilatero in prospettiva: il campo e' un tappeto,
 *  non un foglio tagliato con la forbice. */
function tappeto(r = 14, mu = 0, mv = 0) {
    const A = P(mu, mv), B = P(1 - mu, mv), C = P(1 - mu, 1 - mv), D = P(mu, 1 - mv);
    const verso = (da, a, q) => [da[0] + (a[0] - da[0]) * q, da[1] + (a[1] - da[1]) * q];
    const q = (p1, p2) => {
        const d = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
        return Math.min(0.5, r / (d || 1));
    };
    const f = (n) => n.map(v => v.toFixed(1)).join(',');
    return `M${f(verso(A, B, q(A, B)))}
            L${f(verso(B, A, q(A, B)))} Q${f(B)} ${f(verso(B, C, q(B, C)))}
            L${f(verso(C, B, q(B, C)))} Q${f(C)} ${f(verso(C, D, q(C, D)))}
            L${f(verso(D, C, q(C, D)))} Q${f(D)} ${f(verso(D, A, q(D, A)))}
            L${f(verso(A, D, q(D, A)))} Q${f(A)} ${f(verso(A, B, q(A, B)))} Z`;
}

/** Il quadrilatero fra due yard: serve alle strisce d'erba e alle end zone. */
function fascia(u0, u1) {
    return `M${punto(u0, 0)} L${punto(u1, 0)} L${punto(u1, 1)} L${punto(u0, 1)} Z`;
}

/** L'inclinazione della yard line a quel punto, in gradi. */
function inclinazione(u) {
    const [xt] = P(u, 0);
    const [xb] = P(u, 1);
    return Math.atan2(xb - xt, VICINO.y - LONTANO.y) * 180 / Math.PI;
}

/** Erba tagliata a strisce larghe, alternate, ben visibili come allo stadio. */
function erba() {
    const out = [`<path d="${fascia(0, 1)}" fill="url(#${rifId('erba')})"/>`];
    for (let y = 0; y < 100; y += 20) {
        out.push(`<path d="${fascia(uDaYard(y), uDaYard(Math.min(100, y + 10)))}"
            fill="#ffffff" opacity="0.1"/>`);
    }
    return out.join('');
}

/** Solo le linee da 10: nel riferimento non c'e' il pettine da 5 in 5. */
function yardLines() {
    const out = [];
    for (let y = 10; y <= 90; y += 10) {
        const u = uDaYard(y);
        const [x1, y1] = P(u, LINEA_DA), [x2, y2] = P(u, LINEA_A);
        out.push(`<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}"
            x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}"
            stroke="rgba(255,255,255,0.8)" stroke-width="${SPESSORE}"/>`);
    }
    return out.join('');
}

/**
 * I numeri sul manto: solo 20 / 50 / 20, grandi, con la freccia verso la end
 * zone piu' vicina. Schiacciati in verticale, perche' un numero dipinto per
 * terra e guardato di sbieco si accorcia — e la prospettiva la fa quella,
 * non la rotazione.
 */
function numeri() {
    const SCHIACCIA = 0.58;
    return [20, 50, 80].map(y => {
        const u = uDaYard(y);
        const [x, yy] = P(u, 0.66);
        const n = y === 50 ? 50 : 20;
        const freccia = y === 50 ? '' : (y < 50 ? -1 : 1);
        const fx = freccia ? x + freccia * 42 : 0;
        return `
        <g transform="translate(${x.toFixed(1)},${yy.toFixed(1)}) scale(1,${SCHIACCIA})">
            <text x="0" y="0" class="fst-num">${n}</text>
        </g>
        ${freccia ? `<path class="fst-freccia" transform="translate(${fx.toFixed(1)},${yy.toFixed(1)})"
            d="M${freccia * 9},0 L${-freccia * 2},-6 L${-freccia * 2},6 Z"/>` : ''}`;
    }).join('');
}

function endZone(lato, colore, logo) {
    const [u0, u1] = lato === 'l' ? [0, EZ] : [1 - EZ, 1];
    const d = fascia(u0, u1);
    const um = (u0 + u1) / 2;
    // Solo il logo, al centro della end zone. La sigla accanto raddoppiava la
    // stessa informazione — sta gia' nello scorebug sopra — e in due lettere
    // larghe quanto la end zone finiva per coprire il logo.
    const [lx, ly] = P(um, 0.5);
    // Sotto va il nero: senza, una squadra dal colore scuro (il verde dei
    // Packers) finiva a filo dell'erba e la end zone spariva.
    const uG = lato === 'l' ? u1 : u0;
    const [gx0, gy0] = P(uG, LINEA_DA), [gx1, gy1] = P(uG, LINEA_A);
    const R = 26;
    return `
    <path d="${d}" fill="#0b0d0f"/>
    <path d="${d}" fill="${colore}"/>
    <path d="${d}" fill="none" stroke="rgba(255,255,255,0.85)" stroke-width="${SPESSORE}"
          stroke-linejoin="round"/>
    <line x1="${gx0.toFixed(1)}" y1="${gy0.toFixed(1)}" x2="${gx1.toFixed(1)}" y2="${gy1.toFixed(1)}"
          stroke="#fff" stroke-width="${SPESSORE}" opacity="0.92"/>
    ${logo ? `<g transform="translate(${lx.toFixed(1)},${ly.toFixed(1)}) scale(1,0.68)">
        <image href="${logo}" x="${-R}" y="${-R}" width="${R * 2}" height="${R * 2}"
               opacity="0.95" filter="url(#${rifId('bordo')})"/>
    </g>` : ''}`;
}

/**
 * Le porte, come quelle vere: un palo che sale dietro la linea di fondo,
 * si piega a collo d'oca verso il campo e regge la traversa a sbalzo, da cui
 * partono i due montanti alti. Sono la cosa piu' alta del disegno dopo
 * l'arco, e stanno FUORI dal verde.
 */
/**
 * Dove deve passare un field goal: il centro della traversa, appena sopra.
 * E' la stessa geometria di `pali()` — se cambia una, va cambiata l'altra, e
 * per questo i numeri stanno qui in un posto solo.
 */
const PORTA = { alt: 52, collo: 18, semi: 15, su: 76 };

function centroPorta(lato) {
    const u = lato === 'l' ? 0 : 1;
    const [px, py] = P(u, 0.5);
    const dentro = lato === 'l' ? 1 : -1;
    // A meta' altezza dei montanti, non sulla traversa: finendo sulla traversa
    // la palla sembrava fermarsi contro il palo invece di passarci sopra.
    return [px + dentro * PORTA.collo, py - PORTA.alt - PORTA.su * 0.5];
}

function pali(lato) {
    // Il piede sta SUL campo, sulla linea di fondo e a meta' della sua
    // larghezza: nel nostro punto di vista la larghezza del campo e' la
    // profondita', quindi v = 0.5. Prima lo mettevo a v = 0 e la porta
    // restava per aria dietro al disegno invece di poggiare sull'erba.
    const u = lato === 'l' ? 0 : 1;
    const [px, py] = P(u, 0.5);
    const dentro = lato === 'l' ? 1 : -1;   // da che parte sporge la traversa

    const trav = py - PORTA.alt;            // quota della traversa
    const collo = PORTA.collo;              // sbalzo in avanti
    const semi = PORTA.semi;                // mezza traversa
    const su = PORTA.su;                    // quanto salgono i montanti

    // La traversa e' parallela alla linea di meta, quindi in prospettiva e'
    // inclinata come lei: orizzontale sembrava incollata sopra al disegno.
    const [gx0, gy0] = P(u, 0), [gx1, gy1] = P(u, 1);
    const len = Math.hypot(gx1 - gx0, gy1 - gy0) || 1;
    const dx = (gx1 - gx0) / len, dy = (gy1 - gy0) / len;

    const cx = px + dentro * collo;   // centro della traversa, a sbalzo
    const ax = cx - semi * dx, ay = trav - semi * dy;   // estremo lontano
    const bx = cx + semi * dx, by = trav + semi * dy;   // estremo vicino
    const f = (n) => n.toFixed(1);

    // Il collo d'oca si piega IN ALTO, dove incontra la traversa: sale dritto
    // dall'erba e solo in cima si sporge in avanti. Curvarlo in basso, dove
    // tocca il campo, e' l'opposto di come sono fatte le porte vere.
    // Il palo non regge la traversa al centro: nel disegno di riferimento si
    // innesta sull'ESTREMO piu' lontano — e' quello dietro, e visto di sbieco
    // finisce li'. Sale dritto dall'erba e si piega solo in cima.
    return `
    <g class="fst-pali">
        <path d="M${f(px)},${f(py)} L${f(px)},${f(ay + 30)}
                 Q${f(px)},${f(ay)} ${f(ax)},${f(ay)}"/>
        <path d="M${f(ax)},${f(ay)} L${f(bx)},${f(by)}"/>
        <path d="M${f(ax)},${f(ay)} L${f(ax)},${f(ay - su)}"/>
        <path d="M${f(bx)},${f(by)} L${f(bx)},${f(by - su)}"/>
    </g>`;
}

/**
 * La giocata. L'arco esce SOPRA il campo — nel riferimento e' la cosa che
 * salta all'occhio, e tenerlo dentro al verde lo faceva sembrare un graffio.
 * Il ritratto sta appeso a un'asta verticale piantata dove la palla e'
 * arrivata, non sospeso a mezz'aria.
 */
/**
 * Il tratto di una giocata: una RIGA che disegna un arco, non un nastro
 * pieno. Le linee si sovrappongono senza coprirsi, e su un drive intero si
 * legge dove passa ognuna — i nastri affiancati diventavano una macchia.
 */
function tratto(g, possesso, corrente, lato) {
    // Su un calcio il ritorno comincia dove la palla ATTERRA, non dalla
    // `start` del tabellino: quella e' un punto di comodo che non combacia
    // col referto, e faceva partire la corsa da meta' campo.
    const da = yardAssoluta(g.toEZ, possesso);
    if (da == null) return { svg: '', x1: 0, y1: 0, x2: 0, y2: 0 };
    // Che tipo di giocata e', prima di ogni calcolo: l'arrivo e la partenza
    // dipendono da questo, e dichiararlo dopo mandava tutto in errore.
    const incompleto = g.tipo === 'incomplete';
    const calcio = g.tipo === 'fg';
    const allontana = g.tipo === 'kick';        // punt e kickoff
    const aereo = g.tipo === 'pass' || incompleto || calcio || allontana;

    const yards = Number(g.yards) || 0;
    const verso = versoDi(possesso);
    /*
     * Dove finisce la palla lo dice il tabellino, non l'aritmetica. Su un
     * kickoff "kicks 63 yards from CIN 35 to PHI 2" le yard del testo sono
     * quelle VOLATE dal pallone, ma per chi riceve la palla ARRETRA — e
     * ESPN mette come attacco proprio il ricevente. Sommando le yard il
     * calcio partiva dalla parte sbagliata e finiva fuori campo.
     * `toEZFine` e' `end.yardsToEndzone`: sui touchdown vale 0, cioe' la end
     * zone, e su tutto il resto e' il punto vero d'arrivo.
     */
    /*
     * Un calcio sono DUE momenti della stessa giocata: il pallone che vola
     * dal piede a dove cade, e la corsa di chi lo raccoglie. Le tre posizioni
     * vengono da tre posti diversi, ed e' per questo che mescolarle era cosi'
     * facile: il PIEDE dal referto ("from PIT 35"), l'ATTERRAGGIO dal referto
     * ("to BUF 3"), la FINE DEL RITORNO dal tabellino (`end`). La `start` del
     * tabellino, su un calcio, non e' nessuna delle tre.
     */
    const a = (allontana && g.atterra != null)
        ? g.atterra
        : g.toEZFine != null
            ? yardAssoluta(g.toEZFine, possesso)
            : Math.max(0, Math.min(100, da + yards * verso));
    const vDa = 0.55;
    // Un calcio parte e arriva in mezzo al campo: non ha un lato, e mandarne
    // l'arrivo di traverso lasciava il ritorno a partire dal centro mentre la
    // palla era caduta di lato. Il lato vale per passaggi e corse.
    const vLato = (allontana || calcio || g.lato === 'middle' || !g.lato)
        ? 0.55
        : ((g.lato === 'left') === (verso > 0) ? 0.26 : 0.84);
    /*
     * Una penalita' "No Play" cancella quello che era successo. La riga gialla
     * allora non e' un'azione ma la MISURA del fazzoletto: torna indietro
     * dritta, senza lato e senza campanile, perche' nessuno ha corso quelle
     * dieci yard all'indietro. Il lato e la parabola restano all'azione
     * annullata, che si disegna a parte.
     */
    const annulla = !!(g.penalita && g.annullata);
    const vA = annulla ? vDa : vLato;

    const f = (n) => n.toFixed(1);

    /*
     * Da dove parte il calcio, e qui i due casi si comportano al contrario.
     *
     * PUNT: chi calcia e' ancora l'attacco (e' un quarto down), quindi la
     * posizione del tabellino E' il piede del calciatore — misurato: PIT
     * punta con `toEZ 62`, cioe' la propria 38, che e' esattamente da dove
     * parte. Va bene `da`.
     *
     * KICKOFF: l'attacco per ESPN e' gia' chi RICEVE, e la posizione e' il
     * punto di raccolta. Li' il piede lo dice solo il referto ("from PIT 35"),
     * e per fortuna i kickoff quel pezzo di testo ce l'hanno sempre.
     */
    /*
     * Da dove parte il calcio.
     *
     * KICKOFF: il piede lo dice il referto ("from PIT 35"), e i kickoff quel
     * pezzo di testo ce l'hanno sempre.
     *
     * PUNT: il referto non dice "from", e sulla posizione ESPN cambia
     * convenzione — `yardsToEndzone` li' si misura dalla PROPRIA end zone,
     * non da quella attaccata come in tutte le altre giocate. Verificato su
     * 18 punt di due partite: `100 - toEZ` azzecca 18 volte, la formula
     * normale 6. Sulle giocate ordinarie invece la formula normale resta
     * quella giusta (74 su 75), quindi la deroga vale solo qui.
     */
    const inizio = !allontana ? da
        : g.parte != null ? g.parte
        : Math.max(0, Math.min(100, 100 - g.toEZ));
    const [x1, y1] = P(uDaYard(inizio), vDa);
    // Un field goal finisce FRA I PALI, non su una yard line: l'arrivo e' il
    // centro della traversa della porta che si sta attaccando.
    const [x2, y2] = calcio
        ? centroPorta(verso > 0 ? 'r' : 'l')
        : P(uDaYard(a), vA);

    // L'arco: un solo punto di controllo, alzato sopra la corda. Sul calcio
    // la palla parte da terra e arriva alta, quindi la gobba sta piu' avanti.
    // Tre voli diversi: il punt e il kickoff vanno altissimi a campanile, il
    // field goal e' teso perche' deve solo scavalcare la traversa, e la corsa
    // non vola affatto — li' la linea e' dritta, non una curva schiacciata.
    // 145 e' il massimo che ci sta: il vertice di una quadratica sale di
    // `picco` sopra la corda, e piu' in su il calcio finirebbe sopra lo
    // scorebug invece che in cielo.
    // Il campanile va commisurato allo spostamento DISEGNATO: su un kickoff
    // ricevuto sulla propria 3 e riportato alla 26 il tratto e' corto, e un
    // picco fisso ci disegnava sopra un arco altissimo e sottile come un ago.

    // Il tratto principale di un calcio col volo gia' disegnato e' il RITORNO,
    // e un ritorno e' una corsa: piatta.
    const picco = annulla ? 0
        : allontana ? Math.max(60, Math.min(145, Math.abs(a - inizio) * 2.2))
        : calcio ? 70
        : aereo ? Math.max(14, Math.min(56, Math.abs(a - da) * 0.9))
        : 0;
    const cx = calcio ? x1 + (x2 - x1) * 0.5 : (x1 + x2) / 2;
    const cy = Math.min(y1, y2) - picco * 2;
    const d = picco === 0
        ? `M${f(x1)},${f(y1)} L${f(x2)},${f(y2)}`
        : `M${f(x1)},${f(y1)} Q${f(cx)},${f(cy)} ${f(x2)},${f(y2)}`;

    // La punta guarda dove arriva la palla: su una quadratica la tangente
    // finale e' il lato che va dal controllo all'arrivo.
    const ang = picco === 0
        ? Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI
        : Math.atan2(y2 - cy, x2 - cx) * 180 / Math.PI;
    const senzaPunta = incompleto || (calcio && !g.buono);

    // Il calcio non e' terreno guadagnato: grigio se entra, rosso se no.
    // Il calcio non e' terreno guadagnato ma nemmeno un fondale: prende un
    // colore suo, cosi' si distingue dal ritorno che gli sta accanto.
    // Il giallo del fazzoletto: una giocata con penalita' si riconosce prima
    // di leggere il testo, e sovrascrive l'esito perche' spesso lo annulla.
    const cat = g.penalita ? 'pen'
        : allontana ? 'kick'
        : calcio ? (g.buono ? 'kick' : 'to')
        : g.segna ? 'sc' : (g.persa || incompleto) ? 'to'
        : yards > 0 ? 'gain' : yards < 0 ? 'loss' : 'none';
    const stato = corrente === null ? '' : corrente ? ' is-cur' : ' is-dim';

    // Il pallone per aria lascia una scia di PALLINI — e' un volo, non un
    // solco; la corsa e' una barra piena appoggiata sul prato, perche' li' il
    // terreno lo si guadagna passo per passo. Due gesti diversi per due cose
    // diverse, che con lo stesso tratto si confondevano.
    // La riga della penalita' e' una barra piena anche se la giocata
    // annullata era un passaggio: la scia di pallini racconta un volo, e li'
    // non vola niente.
    const classe = (aereo && !annulla) ? 'fst-volo' : 'fst-corsa';

    // Il RITORNO: dalla caduta a dove il ricevitore viene fermato. Fa parte
    // della stessa giocata del calcio, quindi si accende insieme a lui invece
    // di restare grigio come lo sfondo.
    let ritorno = '';
    /*
     * Un ritorno finito in touchdown non dice mai dove finisce: il referto si
     * ferma alle yard — "K.Wetjen for 45 yards, TOUCHDOWN" — e non c'e' il
     * "to XXX N" che `volodelCalcio` cerca. Senza fine il ritorno non veniva
     * proprio disegnato, e la festa finiva nella end zone del calcio invece
     * che in quella in cui si era segnato. La end zone giusta e' quella alle
     * spalle di chi ha calciato: il ritorno corre all'indietro rispetto al volo.
     */
    // Il verso lo da' `inizio`, non `g.parte`: su "T.Doman punts 44 yards to
    // BUF 45" il referto non scrive da dove si calcia, e col solo `parte` il
    // ripiego non si accendeva mai — proprio sul caso che doveva risolvere.
    const fineRit = g.fineRitorno != null ? g.fineRitorno
        : (allontana && g.segna && g.atterra != null)
            ? (a > inizio ? 0 : 100)
            : null;
    let xFine = x2;
    if (allontana && g.atterra != null && fineRit != null) {
        const fine = fineRit;
        if (Math.abs(fine - a) > 0.5) {
            const [rx1, ry1] = P(uDaYard(a), vDa);
            const [rx2, ry2] = P(uDaYard(fine), vA);
            const rd = `M${f(rx1)},${f(ry1)} L${f(rx2)},${f(ry2)}`;
            const rang = Math.atan2(ry2 - ry1, rx2 - rx1) * 180 / Math.PI;
            ritorno = `
                <path class="fst-linea fst-corsa pp-fd-gain" d="${rd}"/>
                <path class="fst-punta pp-fd-gain"
                      transform="translate(${f(rx2)},${f(ry2)}) rotate(${rang.toFixed(1)})"
                      d="M3,0 L-12,-6.5 L-8,0 L-12,6.5 Z"/>
                <ellipse class="fst-fine" cx="${f(rx2)}" cy="${f(ry2)}" rx="6.5" ry="3"/>`;
            xFine = rx2;
        }
    }

    /*
     * L'azione cancellata: bianca e spenta, perche' e' successa davvero ma non
     * conta. Tiene il LATO suo (una corsa "left end" resta sulla sinistra):
     * a raddrizzarla anche lei si sarebbero visti due tratti sovrapposti sulla
     * stessa riga, e non si capiva piu' quale fosse quale.
     */
    let cancellata = '';
    let annX = null, annY = null;
    if (annulla && g.annullata.yards != null) {
        const yAnn = Number(g.annullata.yards) || 0;
        const aAnn = Math.max(0, Math.min(100, da + yAnn * verso));
        const [ax1, ay1] = P(uDaYard(da), vDa);
        const [ax2, ay2] = P(uDaYard(aAnn), vLato);
        annX = ax2; annY = ay2;
        cancellata = `
            <path class="fst-linea fst-corsa fst-cancellata"
                  d="M${f(ax1)},${f(ay1)} L${f(ax2)},${f(ay2)}"/>
            <g class="fst-x" transform="translate(${f((ax1 + ax2) / 2)},${f((ay1 + ay2) / 2)})">
                <path d="M-9,-9 L9,9"/><path d="M9,-9 L-9,9"/></g>`;
    }

    // Dove arriva la palla lo dice gia' l'asta col ritratto: la freccia sotto
    // ci finiva in mezzo e non si leggeva ne' l'una ne' l'altra. Resta solo
    // quando il ritratto non c'e'.
    // Niente punta sulle corse: il tratto giace sul prato e la freccia,
    // disegnata di piatto sopra, sembrava appartenere a un altro piano.
    const puntaServe = !senzaPunta && !g.fotoA && picco > 0;
    return {
        // `x2` e' dove arriva il PALLONE; su un calcio col ritorno la giocata
        // finisce piu' in la', dove il ricevitore viene fermato. Chi deve
        // sapere "dov'e' finita" — la festa — guarda `xFine`.
        x1, y1, x2, y2, xFine, calcio, buono: !!g.buono, senzaPunta,
        // Fine dell'azione annullata: e' li' che il ricevitore era arrivato,
        // e li' va il suo ritratto. Appeso alla fine della riga gialla — che
        // e' la misura del fallo, non una corsa — i due volti finivano
        // appiccicati sulla stessa yard.
        annX, annY,
        svg: `<g class="fst-tratto${stato}">
            <path class="fst-linea-ombra ${classe}-ombra" d="${d}"/>
            ${cancellata}
            <path class="fst-linea ${classe} pp-fd-${cat}" d="${d}"/>
            ${ritorno}
            ${((!aereo || annulla) && !ritorno) ? `<ellipse class="fst-fine"
                cx="${f(x2)}" cy="${f(y2)}" rx="6.5" ry="3"/>` : ''}
            ${!puntaServe ? '' : `<path class="fst-punta pp-fd-${cat}"
                transform="translate(${f(x2)},${f(y2)}) rotate(${ang.toFixed(1)})"
                d="M3,0 L-12,-6.5 L-8,0 L-12,6.5 Z"/>`}
            ${g.fotoDa ? '' : `<ellipse class="fst-base pp-fd-${cat}"
                cx="${f(x1)}" cy="${f(y1)}" rx="6.5" ry="3"/>`}
        </g>`,
    };
}

/**
 * Il drive intero sul campo: tutte le sue giocate, con quella scelta accesa e
 * le altre smorzate — la stessa lettura del campo di NFL Hub. Cambiando drive
 * si azzera e si riparte, perche' il disegno e' costruito da capo ogni volta.
 */
function tracciaGiocate(lista, corrente, possesso, g) {
    if (!lista?.length) return '';
    const f = (n) => n.toFixed(1);
    // Solo le giocate FINO a quella scelta: quelle successive raccontano un
    // futuro che, mentre si riguarda l'azione, non e' ancora successo — e
    // riempivano il campo di tratti che confondevano la lettura.
    const pezzi = lista.map((x, k) => k > corrente ? null
        : tratto(x, x.possesso || possesso, lista.length === 1 ? null : k === corrente))
        .filter(Boolean);
    const cur = pezzi[corrente] || pezzi[pezzi.length - 1];
    const gCur = lista[corrente] || lista[lista.length - 1];


    let segno = '';
    if (gCur.tipo === 'incomplete') {
        segno = `<g class="fst-x" transform="translate(${f(cur.x2)},${f(cur.y2)})">
            <path d="M-10,-10 L10,10"/><path d="M10,-10 L-10,10"/></g>`;
    } else if (cur.calcio && !cur.buono) {
        segno = `<g class="fst-x" transform="translate(${f(cur.x2)},${f(cur.y2)})">
            <path d="M-11,-9 L11,-9 L-11,9 L11,9"/></g>`;
    }

    // Su un calcio la scrimmage sta dove parte il PALLONE, non dove viene
    // raccolto: la posizione del tabellino li' e' il punto di ricezione.
    // La scrimmage di un calcio sta dove parte il pallone, e li' vale la
    // regola dei calci — non quella normale, che sui punt e' specchiata.
    const da = gCur.tipo !== 'kick'
        ? yardAssoluta(gCur.toEZ, gCur.possesso || possesso)
        : gCur.parte != null
            ? gCur.parte
            : Math.max(0, Math.min(100, 100 - gCur.toEZ));
    const [lx1, ly1] = P(uDaYard(da), LINEA_DA), [lx2, ly2] = P(uDaYard(da), LINEA_A);

    // Il ritratto sta FUORI dal campo, non a cavallo del bordo: partendo da
    // meta' profondita' (y ~235) e col cerchio da 19, ottantacinque unita' lo
    // portano a ~133, sopra il bordo del manto che sta a 164.
    const astaSu = 85;
    /*
     * Il contorno prende il colore della squadra del giocatore. Su un CALCIO
     * le due facce non sono della stessa squadra — chi calcia e chi ritorna
     * stanno di fronte — quindi la seconda si specchia: colorarle uguali
     * avrebbe detto una cosa falsa proprio dove le squadre sono due.
     *
     * Sotto resta un cerchietto chiaro appena piu' largo: stacca il ritratto
     * dallo sfondo senza toccare il colore, che resta quello vero della
     * squadra — il nero di Pittsburgh compreso.
     */
    const colore = (poss) => poss === 'home' ? 'var(--fst-casa)'
        : poss === 'away' ? 'var(--fst-osp)' : '#fff';
    const possDa = gCur.possesso || possesso;
    const altro = possDa === 'home' ? 'away' : possDa === 'away' ? 'home' : null;
    const cDa = colore(possDa);
    const cA = colore(gCur.tipo === 'kick' ? altro : possDa);
    const faccia = (x, y, url, n, col) => !url ? '' : `
        <ellipse class="fst-piede" cx="${f(x)}" cy="${f(y)}" rx="7" ry="3.2"/>
        <line class="fst-filo" x1="${f(x)}" y1="${f(y)}" x2="${f(x)}" y2="${f(y - astaSu)}"/>
        <g class="fst-ritratto">
            <circle cx="${f(x)}" cy="${f(y - astaSu - 17)}" r="19" fill="#0e1116"/>
            <clipPath id="${rifId('clip' + n)}"><circle cx="${f(x)}" cy="${f(y - astaSu - 17)}" r="17"/></clipPath>
            <image href="${url}" x="${f(x - 17)}" y="${f(y - astaSu - 34)}"
                   width="34" height="34" clip-path="url(#${rifId('clip' + n)})"
                   preserveAspectRatio="xMidYMid slice"/>
            <circle cx="${f(x)}" cy="${f(y - astaSu - 17)}" r="19.4" fill="none"
                    stroke="rgba(255,255,255,0.45)" stroke-width="1"/>
            <circle cx="${f(x)}" cy="${f(y - astaSu - 17)}" r="18" fill="none"
                    stroke="${col}" stroke-width="2.6"/>
        </g>`;
    // I ritratti stanno in alto fuori dal campo: si toccano solo se le due
    // estremita' sono quasi sovrapposte, quindi la soglia scende e il
    // ricevitore compare anche sui passaggi corti, dove prima spariva.
    const fx2 = cur.annX != null ? cur.annX : cur.x2;
    const fy2 = cur.annY != null ? cur.annY : cur.y2;
    const distanti = Math.hypot(fx2 - cur.x1, fy2 - cur.y1) > 26;
    const foto = faccia(cur.x1, cur.y1, gCur.fotoDa, 'a', cDa)
        + (distanti ? faccia(fx2, fy2, gCur.fotoA, 'b', cA) : '');

    // Su un calcio la linea di scrimmage non vuol dire niente: il gioco non
    // riparte da li', e disegnata in mezzo al campo sembrava indicare un
    // punto che nell'azione non esiste.
    const los = `
        <line class="fst-los-ombra" x1="${f(lx1)}" y1="${f(ly1)}" x2="${f(lx2)}" y2="${f(ly2)}"/>
        <line class="fst-los" x1="${f(lx1)}" y1="${f(ly1)}" x2="${f(lx2)}" y2="${f(ly2)}"/>`;
    return `
    ${los}
    ${pezzi.map(x => x.svg).join('')}
    ${segno}
    ${foto}`;
}

/**
 * Da che parte del CAMPO e' finita la giocata che segna, o null se non segna.
 * Passa da `tratto` come il disegno, cosi' non ci sono due modi di dire dov'e'
 * finita l'azione: se il tratto e' giusto, e' giusta anche la festa.
 */
function latoSegnato(lista, corrente, possesso, g) {
    const gCur = lista?.[corrente] || lista?.[lista.length - 1] || g;
    if (!gCur?.segna || gCur.toEZ == null) return null;
    const t = tratto(gCur, gCur.possesso || possesso, null);
    return t.xFine > VB_W / 2 ? 'r' : 'l';
}

/* ── Markup ──────────────────────────────────────────────────────────── */

const esc = (s) => String(s ?? '').replace(/[&<>"]/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const logoImg = (t) => t.logo
    ? `<img class="fst-logo" src="${esc(t.logo)}" alt="" loading="lazy">`
    : `<span class="fst-logo fst-logo--vuoto">${esc(t.abbr || '')}</span>`;

/** Riga di mezzo dello scorebug: quarto e orologio sopra, situazione sotto. */
function situazione(s) {
    if (s.stato === 'pre') return `<span class="fst-quando">${esc(s.orologio || 'Kickoff')}</span>`;
    if (s.stato === 'post') return '<span class="fst-quando">Final</span>';
    const q = s.periodo ? `${s.periodo}${['st', 'nd', 'rd', 'th'][Math.min(s.periodo, 4) - 1]}` : '';
    const dd = s.down
        ? `${s.down}${['st', 'nd', 'rd', 'th'][Math.min(s.down, 4) - 1]} & ${s.distance ?? 10}`
        : '';
    const dove = s.toEZ != null && s.possesso
        ? ` at ${s.toEZ <= 50 ? esc(s[s.possesso === 'home' ? 'away' : 'home'].abbr) : esc(s[s.possesso].abbr)} ${s.toEZ <= 50 ? s.toEZ : 100 - s.toEZ}`
        : '';
    // Il down & distance sta SOPRA: e' il dato che cambia a ogni giocata ed
    // e' quello che si guarda per primo; l'orologio fa da contorno.
    return `
        ${dd ? `<span class="fst-dd">${esc(dd)}${dove}</span>` : ''}
        <span class="fst-quando">${esc(q)} ${esc(s.orologio || '')}</span>`;
}

/**
 * Punteggio e, sotto, i timeout rimasti: tre trattini, spenti quelli spesi.
 * ESPN li da' solo a partita in corso — senza il dato non si disegnano, che
 * e' meglio che mostrarne tre pieni per finta.
 */
const punteggio = (t, attivo) => `
    <div class="fst-col">
        <span class="fst-score${attivo ? ' is-pos' : ''}">${t.score ?? 0}</span>
        ${Number.isFinite(t.timeouts) ? `<span class="fst-to" aria-label="${t.timeouts} timeouts left">
            ${[0, 1, 2].map(i => `<i${i < t.timeouts ? '' : ' class="is-off"'}></i>`).join('')}
        </span>` : ''}
    </div>`;

export function fieldStripHTML(s) {
    ID = String(++nIstanza);
    /*
     * Come le maglie: in casa il primo colore, in trasferta l'alternativo.
     * Vale per le end zone e per il contorno dei ritratti, che leggono le
     * stesse due variabili — cosi' le due squadre non finiscono mai sullo
     * stesso colore e si distinguono a colpo d'occhio.
     */
    const cCasa = s.home.color || 'var(--accent-red)';
    const cOsp = s.away.color2 || s.away.color || 'var(--accent-blue)';
    const g = s.giocata;
    /*
     * Da che parte dello SCOREBUG va la festa. La conversione e' INVERTITA e
     * non e' un errore: chi segna nella end zone di destra e' l'ospite, e
     * l'ospite nello scorebug sta a sinistra ("l'ospite va sempre a sinistra",
     * come in TV). Prendere il lato del campo cosi' com'e' avrebbe messo i
     * fuochi accanto al logo di chi ha SUBITO il touchdown.
     *
     * Qui si dice solo DOVE: la festa la spara `live.js` col motore degli
     * effetti. Messa nel markup ripartiva da capo a ogni polling, perche'
     * `aggiornaCampo` rimpiazza lo scorebug appena l'orologio scorre.
     */
    const latoCampo = latoSegnato(s.giocate || (g ? [g] : []), s.giocataIdx ?? 0, s.possesso, g);
    const latoBug = latoCampo === 'r' ? 'l' : latoCampo === 'l' ? 'r' : null;

    return `
    <div class="fst${s.statico ? ' fst--statico' : ''}" data-scena="${esc(s.scena || '')}"
         data-festa="${latoBug || ''}"
         style="--fst-casa:${cCasa};--fst-osp:${cOsp}">
        <div class="fst-bug">
            <div class="fst-lato">
                ${logoImg(s.away)}
                <span class="fst-abbr">${esc(s.away.abbr)}</span>
            </div>
            ${punteggio(s.away, s.possesso === 'away')}
            <div class="fst-mid">${situazione(s)}</div>
            ${punteggio(s.home, s.possesso === 'home')}
            <div class="fst-lato fst-lato--r">
                ${logoImg(s.home)}
                <span class="fst-abbr">${esc(s.home.abbr)}</span>
            </div>
        </div>

        <svg class="fst-campo" viewBox="0 0 ${VB_W} ${VB_H}" preserveAspectRatio="xMidYMid meet"
             role="img" aria-label="Field position">
            <defs>
                <linearGradient id="${rifId('erba')}" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0" stop-color="#285c33"/>
                    <stop offset="0.55" stop-color="#347541"/>
                    <stop offset="1" stop-color="#3c884a"/>
                </linearGradient>
                <!-- La luce dello stadio: batte dal fondo e si spegne verso di
                     noi. Senza, il manto e' una campitura piatta. -->
                <linearGradient id="${rifId('luce')}" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0" stop-color="#ffffff" stop-opacity="0.16"/>
                    <stop offset="0.5" stop-color="#ffffff" stop-opacity="0.02"/>
                    <stop offset="1" stop-color="#000000" stop-opacity="0.22"/>
                </linearGradient>
                <clipPath id="${rifId('taglio')}"><path d="${tappeto()}"/></clipPath>
                <!-- Contorno che segue la SAGOMA del logo: si dilata il suo
                     canale alfa, lo si riempie di bianco e ci si rimette
                     sopra l'originale. Un cerchio avrebbe bordato il
                     riquadro dell'immagine, non lo stemma. -->
                <filter id="${rifId('bordo')}" x="-25%" y="-25%" width="150%" height="150%">
                    <feMorphology in="SourceAlpha" operator="dilate" radius="1.6" result="grosso"/>
                    <feFlood flood-color="#ffffff" flood-opacity="0.95" result="bianco"/>
                    <feComposite in="bianco" in2="grosso" operator="in" result="contorno"/>
                    <feMerge>
                        <feMergeNode in="contorno"/>
                        <feMergeNode in="SourceGraphic"/>
                    </feMerge>
                </filter>
            </defs>
            <!-- Lo spessore del tappeto: due copie sfalsate sotto, non un
                 rettangolo — cosi' anche il bordo e' arrotondato. -->
            <g transform="translate(0,10)"><path d="${tappeto()}" fill="#122e19"/></g>
            <g transform="translate(0,5)"><path d="${tappeto()}" fill="#193d22"/></g>
            <g clip-path="url(#${rifId('taglio')})">
                ${erba()}
            ${yardLines()}
            ${numeri()}
            ${endZone('l', 'var(--fst-osp)', s.away.logo)}
            ${endZone('r', 'var(--fst-casa)', s.home.logo)}
                <path d="${fascia(EZ, 1 - EZ)}" fill="url(#${rifId('luce')})"/>
            </g>
            <!-- La sideline: una riga dipinta, rientrata come le altre. -->
            <path d="${tappeto(11, 0.012, LINEA_DA)}" fill="none"
                  stroke="rgba(255,255,255,0.8)" stroke-width="${SPESSORE}"/>
            ${pali('l')}
            ${pali('r')}
            ${tracciaGiocate(s.giocate || (g ? [g] : []), s.giocataIdx ?? 0, s.possesso, g)}
        </svg>

        ${s.drives?.length ? `
        <div class="fst-ds">
            ${s.drives.map(d => `<button type="button"
                class="pp-ds-ev pp-fdseg-${d.cls}${d.i === s.driveIdx ? ' is-active' : ''}"
                data-fst-drive="${d.i}" title="${esc(d.team)} · ${esc(d.res)}">${esc(d.tag)}</button>`).join('')}
        </div>` : ''}

        ${s.timeline ? `
        <div class="fst-tl">
            <button class="fst-tl-btn" type="button" data-fst-step="-1" aria-label="Previous play">‹</button>
            <input class="fst-tl-range" type="range" min="0" max="${s.timeline.n - 1}"
                   value="${s.timeline.i}" step="1" data-fst-range
                   aria-label="Play ${s.timeline.i + 1} of ${s.timeline.n}">
            <button class="fst-tl-btn" type="button" data-fst-step="1" aria-label="Next play">›</button>
            <span class="fst-tl-num">${s.timeline.i + 1}/${s.timeline.n}</span>
        </div>` : ''}

        ${s.timeout ? `
        <div class="fst-last fst-last--timeout">
            <div class="fst-last-txt">
                <span class="fst-last-head"><b>${esc(s.timeout.titolo)}</b></span>
                ${s.timeout.squadra ? `<span class="fst-last-desc">${esc(s.timeout.squadra)}</span>` : ''}
            </div>
        </div>` : ''}

        ${g ? `
        <div class="fst-last">
            ${g.logo ? `<img class="fst-last-logo" src="${esc(g.logo)}" alt="" loading="lazy">` : ''}
            <div class="fst-last-txt">
                <span class="fst-last-head">
                    <b>${esc(g.titolo || '')}</b><i>${s.timeline ? 'Selected play' : 'Last play'}</i>
                </span>
                <span class="fst-last-desc">${esc(g.testo || '')}</span>
            </div>
        </div>` : ''}

        ${s.recap?.length ? `
        <details class="fst-recap">
            <summary>All plays <b>${s.recap.length}</b></summary>
            <ol class="fst-recap-list">
                ${s.recap.map(r => `
                <li class="fst-recap-row${r.segna ? ' is-score' : ''}${r.persa ? ' is-turn' : ''}"
                    data-fst-go="${r.i}">
                    <span class="fst-recap-when">
                        <b>${r.periodo ? `Q${r.periodo}` : ''} ${esc(r.clock || '')}</b>
                        ${r.dd ? `<i>${esc(r.dd)}</i>` : ''}
                    </span>
                    <span class="fst-recap-txt"><b>${esc(r.titolo)}</b>${esc(r.testo)}</span>
                </li>`).join('')}
            </ol>
        </details>` : ''}
    </div>`;
}

/**
 * Aggancia timeline e recap. `onScegli(i)` riceve l'indice della giocata
 * scelta; il modulo non sa cosa farne — ridisegnare e' compito di chi lo usa.
 */
/**
 * `onScegli(indiceGiocata, indiceDrive)`: la giocata quando si scorre la
 * timeline o si clicca il recap, il drive quando si tocca una pastiglia.
 */
export function bindFieldStrip(root, onScegli) {
    const fst = root?.querySelector?.('.fst') || root;
    if (!fst) return;
    const range = fst.querySelector('[data-fst-range]');
    if (range) {
        // `input` e non `change`: si vuole vedere il campo muoversi mentre si
        // trascina, non solo quando si lascia.
        range.addEventListener('input', () => onScegli(Number(range.value)));
    }
    fst.querySelectorAll('[data-fst-step]').forEach(b =>
        b.addEventListener('click', () => {
            if (!range) return;
            const v = Number(range.value) + Number(b.dataset.fstStep);
            const max = Number(range.max);
            onScegli(Math.max(0, Math.min(max, v)));
        }));
    fst.querySelectorAll('[data-fst-go]').forEach(li =>
        li.addEventListener('click', () => onScegli(Number(li.dataset.fstGo))));
    fst.querySelectorAll('[data-fst-drive]').forEach(b =>
        b.addEventListener('click', () => onScegli(null, Number(b.dataset.fstDrive))));
}

/**
 * Titolo corto della giocata, quello grande accanto a "Last play":
 * "47-yd Punt", "12-yd Pass", "Touchdown".
 */
export function titoloGiocata(p) {
    if (!p) return '';
    if (p.scoring) return /field goal/i.test(p.type || p.text || '') ? 'Field Goal' : 'Touchdown';
    const y = Number(p.yards) || 0;
    const t = String(p.type || '');
    if (/punt/i.test(t)) return `${Math.abs(y) || ''}-yd Punt`.trim();
    if (/kickoff/i.test(t)) return 'Kickoff';
    if (/field goal/i.test(t)) return /miss/i.test(t) ? 'FG Missed' : 'Field Goal';
    if (/sack/i.test(t)) return 'Sack';
    if (/interception/i.test(t)) return 'Interception';
    if (/fumble/i.test(t)) return 'Fumble';
    if (/incompletion|incomplete/i.test(t)) return 'Incomplete';
    if (/pass/i.test(t)) return `${y}-yd Pass`;
    if (/rush|run/i.test(t)) return `${y}-yd Run`;
    return t || 'Play';
}

/**
 * Dove e' andato il pallone, letto dal referto: "pass short left", "deep
 * right", "up the middle". Il lato serve a metterlo sulla meta' giusta del
 * campo, la profondita' a dare una lunghezza agli incompleti — che di yard
 * ufficiali ne hanno zero, ma un "short" e un "deep" non si somigliano.
 */
export function direzioneGiocata(p) {
    const t = String(p?.text || '');
    return {
        lato: /left/i.test(t) ? 'left' : /right/i.test(t) ? 'right' : 'middle',
        profondita: /deep/i.test(t) ? 'deep' : /short/i.test(t) ? 'short' : 'media',
    };
}

/**
 * Le yard di un calcio stanno nel testo, non nelle statistiche: "punts 50
 * yards", "33 yard field goal". Un punt registrato come giocata da zero yard
 * veniva disegnato come un puntino in mezzo al campo.
 */
export function yardCalcio(p) {
    const t = String(p?.text || '');
    if (!/punts|field goal|kicks/i.test(t)) return null;
    const m = t.match(/(\d+)\s*yards?/i);
    return m ? Number(m[1]) : null;
}

/**
 * Dove atterra il pallone e da dove parte, letti dal referto: "kicks 62 yards
 * from PIT 35 to BUF 3". Sono le due cose che il tabellino NON dice: la
 * `start` di un calcio e' gia' il punto di raccolta e la `end` quello dove
 * finisce il ritorno, quindi senza il testo del volo non resta traccia.
 * Il punto d'atterraggio c'e' su tutti i calci, la partenza solo sui kickoff.
 *
 * `posDaSigla` porta "BUF 3" nella scala assoluta del disegno: zero a
 * sinistra, dove sta l'ospite.
 */
export function posDaSigla(sigla, yard, homeAbbr) {
    const n = Math.max(0, Math.min(100, Number(yard)));
    return String(sigla).toUpperCase() === String(homeAbbr).toUpperCase() ? 100 - n : n;
}

export function volodelCalcio(text, homeAbbr) {
    const t = testoAzione(text);
    const arr = t.match(/to (?:the )?([A-Z]{2,3}) (\d+)/);
    const par = t.match(/from (?:the )?([A-Z]{2,3}) (\d+)/);
    // La fine del RITORNO sta pure nel testo, con le yard accanto: "Cha.Jones
    // to CIN 29 for 8 yards". Il tabellino qui non aiuta — provate le due
    // convenzioni sui nove ritorni delle partite, ne azzeccavano 5 e 0. Letta
    // dal testo torna 22 volte su 22.
    const rit = t.match(/to (?:the )?([A-Z]{2,3}) (\d+) for (-?\d+) yards?/);
    return {
        atterra: arr ? posDaSigla(arr[1], arr[2], homeAbbr) : null,
        parte: par ? posDaSigla(par[1], par[2], homeAbbr) : null,
        fineRitorno: rit ? posDaSigla(rit[1], rit[2], homeAbbr) : null,
    };
}

/** Un field goal e' entrato o no: cambia il disegno, non solo il colore. */
export const fgBuono = (p) => /is GOOD/i.test(String(p?.text || ''));

/**
 * L'esito del drive, per la pastiglia: le stesse sigle di NFL Hub. Qui pero'
 * non arriva un campo "result" gia' pronto — va letto dal testo dell'ultima
 * azione vera del drive, e a ordinarle per prime devono essere le cose che
 * chiudono un drive, non le parole che compaiono ovunque.
 */
export function tagDrive(res) {
    const r = (res || '').toLowerCase();
    if (/touchdown/.test(r)) return { l: 'TD', c: 'td' };
    if (/safety/.test(r)) return { l: 'SAF', c: 'td' };
    if (/field goal is good/.test(r)) return { l: 'FG', c: 'fg' };
    if (/field goal is no good|field goal is blocked|missed field goal/.test(r))
        return { l: 'MFG', c: 'to' };
    if (/intercepted/.test(r)) return { l: 'INT', c: 'to' };
    if (/fumble/.test(r) && /recovered by/.test(r)) return { l: 'FUM', c: 'to' };
    if (/punts?/.test(r)) return { l: 'PNT', c: 'punt' };
    if (/on downs/.test(r)) return { l: 'DWN', c: 'to' };
    if (/end game/.test(r)) return { l: 'END', c: 'end' };
    if (/end quarter|two-minute|end of half/.test(r)) return { l: '—', c: 'end' };
    return { l: '—', c: 'end' };
}

/**
 * Le azioni di servizio non dicono com'e' finito un drive: un timeout in coda
 * faceva leggere "OFFI" al posto di "PNT".
 */
export const eDiServizio = (p) => {
    const t = String(p?.text || '').trim();
    // ESPN infila touchdown e trasformazione nella STESSA riga ("...for 1
    // yard, TOUCHDOWN. T.Bass extra point is GOOD"): cercare "extra point"
    // buttava via tutti e sette i touchdown della partita insieme al PAT.
    if (/touchdown|safety/i.test(t)) return false;
    return /timeout|end quarter|two-minute|^game$|extra point|two-point|kicks \d+ yard/i.test(t);
};

/** Quanto lungo disegnare un passaggio che non ha fatto yard. */
export const yardStimate = (prof) => (prof === 'deep' ? 18 : prof === 'short' ? 6 : 11);

/*
 * Il testo della sola AZIONE, senza la trasformazione che ESPN accoda sulla
 * stessa riga. Quella coda descrive un'altra giocata e ne rubava la
 * classificazione: "T.Doman punts 44 yards to BUF 45. K.Wetjen for 45 yards,
 * TOUCHDOWN. TWO-POINT CONVERSION ATTEMPT. D.Allar pass to M.Hurleman is
 * incomplete" veniva letto come un passaggio sbagliato — l'`incomplete` della
 * conversione vince sul `punts` perche' arriva prima nei controlli — e il
 * punt ritornato in touchdown finiva disegnato come un lancio a vuoto in
 * mezzo al campo, con la festa nella end zone sbagliata. Vale uguale per
 * "extra point is No Good", che pesca nello stesso ramo.
 */
export const testoAzione = (t) => String(t || '')
    .split(/TWO[- ]POINT CONVERSION|extra point/i)[0];

/**
 * L'azione ANNULLATA da una penalita' "No Play": quello che era successo sul
 * campo prima che il fazzoletto lo cancellasse. ESPN la scrive per intero
 * PRIMA della parola PENALTY — "(Shotgun) J.Haynes left end to CIN 42 for 12
 * yards" — e poi dichiara "- No Play". Senza disegnarla, quella giocata si
 * legge come una perdita secca di dieci yard, mentre erano dodici guadagnate
 * e poi cancellate: due fatti diversi che meritano due tratti diversi.
 */
export function azioneAnnullata(text) {
    const t = String(text || '');
    if (!/no play/i.test(t)) return null;
    // Il "No Play" da solo basta a raddrizzare la riga gialla: anche un falso
    // movimento, dove sul campo non e' successo niente, e' una misura e non
    // un'azione. Le yard invece ci sono solo quando qualcosa era successo, e
    // senza quelle il tratto bianco non si disegna.
    const prima = t.split(/PENALTY/i)[0];
    const m = prima.match(/for (-?\d+) yards?/i);
    const yards = m ? Number(m[1]) : (/for no gain/i.test(prima) ? 0 : null);
    return { noPlay: true, yards };
}

/** Che disegno fa la giocata: per aria, per terra, o a vuoto. */
export function tipoGiocata(p) {
    const t = `${p?.type || ''} ${testoAzione(p?.text)}`;
    // L'incompleto si riconosce prima di tutto il resto: e' pur sempre un
    // passaggio, e cadendo nel ramo 'pass' avrebbe preso la freccia di arrivo
    // su una palla che a terra non e' mai arrivata.
    if (/incomplet|no good|missed/i.test(t)) return 'incomplete';
    /*
     * Un calcio con RITORNO va disegnato come una corsa, non come un
     * campanile. Il tratto che finisce sul campo non e' il volo del pallone:
     * ESPN registra come partenza il punto dove la palla viene raccolta e
     * come arrivo dove il ritornatore viene placcato — cioe' esattamente la
     * corsa che segue il calcio ("E.Ezukanma to PHI 24 for 22 yards").
     * Il campanile resta per i calci che non vengono riportati: touchback,
     * fair catch, palla fuori, e i field goal.
     */
    if (/punts|kicks \d+ yard|kickoff/i.test(t)) return 'kick';
    if (/field goal|pass|interception/i.test(t)) return 'pass';
    return 'run';
}
