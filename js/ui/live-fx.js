/**
 * Effetti di festa del Live: coriandoli, fuochi, lampo, timbro e fumetto.
 *
 * Non conosce i dati della lega e non fa richieste: riceve un evento già
 * calcolato e una card, e disegna. Tutto quello che serve per innescarlo il
 * Live lo produce già a ogni polling — `detectEvents()` dà la chiave
 * dell'evento, i punti e la squadra, e `flashNewReceipts()` trova già la card
 * del giocatore.
 *
 * Particelle DOM animate con la Web Animations API: niente canvas, niente
 * libreria. Il progetto non ne ha nessuna e non è questo il motivo per
 * introdurne una. Ogni particella si rimuove da sola quando finisce.
 */

/** Quanto resta ferma a schermo la parola grossa. */
const STAMP_TENUTA_MS = 5000;

/** Quanto durano i fuochi attorno a chi ha segnato. */
const FUOCHI_MS = 10000;

/** Quanto resta il commento che esce dal giocatore. Uguale per tutti gli
 *  eventi, anche quelli con una festa corta: è una battuta, si legge con
 *  calma. */
const BOLLA_MS = 10000;

const ridotto = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const stretto = () => matchMedia('(max-width: 768px)').matches;

/**
 * Vibrazione del telefono, quando c'è. Va presa per quello che è:
 *
 *  - **iOS non la supporta**, punto. Safari non espone `navigator.vibrate` e
 *    non c'è modo di aggirarlo da una pagina web. Su iPhone questa riga non
 *    farà mai niente, ed è giusto saperlo invece di aspettarsi il contrario.
 *  - Su Android serve che l'utente abbia già toccato la pagina almeno una
 *    volta: senza quel gesto il browser ignora la chiamata in silenzio. Chi
 *    apre il Live e resta a guardare senza toccare nulla non sentirà nulla
 *    fino al primo tocco.
 *  - `prefers-reduced-motion` la esclude insieme a tutto il resto, perché chi
 *    chiede meno movimento non vuole nemmeno il telefono che balla in mano.
 *
 * Non si fa nessun tentativo di rilevare il fallimento: `vibrate` torna un
 * booleano che mente allegramente, e non c'è niente di utile da farne.
 */
function vibra(pattern) {
    if (!pattern || !navigator.vibrate) return;
    try { navigator.vibrate(pattern); } catch { /* non supportata: pazienza */ }
}
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (a) => a[Math.floor(Math.random() * a.length)];

/**
 * La tabella degli eventi: una riga per reazione. Sta tutta qui apposta —
 * aggiungere un evento dev'essere una riga, non una caccia al tesoro.
 *
 * Le chiavi sono quelle di BIG_EVENTS in live.js, cioè le stesse statistiche
 * che il Live già confronta fra due polling.
 */
/* Le due misure della festa. Stanno qui e non sparse nelle righe: touchdown e
   pick six devono vedersi identici, e i due field goal pure. */
const FESTA_PIENA = { coriandoli: 76, razzi: 3, ogni: 620, dura: FUOCHI_MS,
    // tre colpi e una coda lunga: si sente che e' successo qualcosa di grosso
    vibra: [70, 60, 70, 60, 220] };
const FESTA_CALCIO = { coriandoli: 34, razzi: 2, ogni: 1150, dura: 5000,
    vibra: [60, 50, 150] };

/* Quanto dura una brutta notizia: più di una festa breve, perché è il momento
   in cui uno guarda per capire cos'è andato storto. */
const ROTTURA = 6500;

const TABELLA = [
    {
        chiavi: ['def_td', 'ret_td', 'fum_td', 'def_ret_td'],
        tipo: 'festa', stampa: 'PICK SIX', dice: 'PICK SIX',
        ...FESTA_PIENA, lampo: 'forte',
    },
    {
        chiavi: ['pass_td', 'rush_td', 'rec_td'],
        tipo: 'festa', stampa: 'TOUCHDOWN', dice: 'TOUCHDOWN',
        ...FESTA_PIENA, lampo: 'forte',
    },
    {
        // Deve stare PRIMA del field goal generico: un calcio da 50+ porta
        // anche `fg_made`, e con l'ordine invertito si mangerebbe la riga giusta.
        chiavi: ['fg_50_plus'],
        tipo: 'festa', stampa: 'FROM DOWNTOWN', dice: 'from downtown',
        ...FESTA_CALCIO, lampo: 'medio',
    },
    {
        // Stessa festa del calcio da lontano, parole diverse: in questa lega
        // vale 3 punti contro 5, ma resta un calcio riuscito.
        chiavi: ['fg_made', 'fg_0_39', 'fg_40_49'],
        tipo: 'festa', stampa: 'FIELD GOAL', dice: 'it is good',
        ...FESTA_CALCIO, lampo: 'medio',
    },
    {
        // La safety la segna la NOSTRA difesa e vale due punti: e' un evento
        // BUONO, non una disgrazia. Era classificato al contrario.
        chiavi: ['safety'],
        tipo: 'festa', stampa: 'SAFETY', dice: 'SAFETY',
        ...FESTA_CALCIO, lampo: 'forte',
    },
    {
        chiavi: ['pass_int'],
        tipo: 'brutto', stampa: 'INTERCEPTED', dice: 'intercepted', cattivo: true,
        fulmine: true, rotto: true, trema: 1800, dura: ROTTURA, lampo: 'secco',
        vibra: [180, 90, 180],
    },
    {
        chiavi: ['fum_lost'],
        tipo: 'brutto', stampa: 'FUMBLE', dice: 'coughed it up', cattivo: true,
        fulmine: true, rotto: true, trema: 1800, dura: ROTTURA, lampo: 'secco',
        vibra: [180, 90, 180],
    },
    // Sack e intercetto difensivo sono due cose diverse e vanno dette con due
    // parole diverse. Stanno DOPO il pick six: un intercetto portato in meta'
    // ha sia `def_int` sia `def_td`, e deve vincere la festa grossa.
    // Niente timbro: valgono uno o due punti, la reazione resta discreta.
    {
        chiavi: ['def_int'],
        tipo: 'colpo', dice: 'INTERCEPTION', trema: 1100, vibra: [50],
        dura: 1400, lampo: 'secco',
    },
    {
        chiavi: ['sack'],
        tipo: 'colpo', dice: 'SACK', trema: 1100, vibra: [50],
        dura: 1400, lampo: 'secco',
    },
];

/**
 * Evento → reazione, o null se non merita un effetto. Si guarda l'intera lista
 * dei cambiamenti, non solo `headline`: in un poll da 30 secondi un giocatore
 * può aver fatto un TD *e* qualcos'altro, e il TD non deve perdersi.
 */
export function effettoPer(ev) {
    if (!ev?.changes?.length) return null;
    const presenti = new Set(ev.changes.filter(c => c.delta > 0).map(c => c.key));
    for (let i = 0; i < TABELLA.length; i++) {
        if (TABELLA[i].chiavi.some(k => presenti.has(k))) {
            // `rango` = posizione in TABELLA, che è ordinata per importanza.
            // Serve al chiamante per scegliere fra più eventi dello stesso
            // poll: in trenta secondi possono segnare in due, e a vincere
            // dev'essere il touchdown, non chi capita prima nell'elenco.
            return { ...TABELLA[i], rango: i };
        }
    }
    return null;
}

/**
 * Il livello su cui si disegna: dentro il campo, sopra le card. Ritagliato dai
 * bordi del campo (`.matchup-field-horizontal` ha `overflow: hidden`), che è
 * quello che si vuole — i coriandoli restano nello stadio invece di sbrodolare
 * sui widget sotto.
 *
 * Torna null se il campo non c'è: nel confronto gli effetti non partono.
 */
/**
 * Un livello effetti dentro un contenitore qualunque, per chi non e' il campo
 * della rosa. Il contenitore deve essere posizionato: il livello si stende
 * con `inset: 0` e ritaglia le particelle ai propri bordi.
 */
export function montaLivello(host, cls = 'live-fx') {
    if (!host) return null;
    let layer = [...host.children].find(c => c.classList?.contains('live-fx'));
    if (!layer) {
        layer = document.createElement('div');
        layer.className = cls;
        layer.setAttribute('aria-hidden', 'true');
        host.appendChild(layer);
    }
    return layer;
}

/**
 * SOLO fuochi, razzi e coriandoli, attorno a un elemento qualunque: niente
 * timbro, niente fumetto, niente faro sul palco, nessuna coda.
 *
 * Serve allo scorebug di "Inside the game", dove a festeggiare e' una squadra
 * NFL e non un giocatore di fantasy: li' un timbro "TOUCHDOWN" e la nuvoletta
 * non hanno nessuno a cui riferirsi, e `is-festa` abbasserebbe `.live-stage`,
 * cioe' la rosa, che sta tutt'altrove nella pagina.
 */
export function festaAttorno(layer, slot, colori, opts = {}) {
    if (!layer || !slot || !colori?.length) return false;
    if (ridotto()) return false;
    const dura = opts.dura || FUOCHI_MS;
    const p = punto(layer, slot);
    const meta = stretto() ? 0.5 : 1;
    const vivo = () => layer.isConnected;

    const ondate = Math.max(3, Math.round(dura / 2600));
    coriandoli(layer, p, colori, Math.round((opts.coriandoli || 76) * meta),
        ondate, dura / ondate, vivo);
    // I razzi salgono sotto al logo di chi ha segnato, non a caso per la
    // striscia: e' la stessa ragione per cui i coriandoli stanno da quella
    // parte — la festa deve dire anche di CHI e'.
    const nRazzi = Math.max(1, opts.razzi || 4);
    for (let i = 0; i < nRazzi; i++) {
        setTimeout(() => { if (vivo()) razzo(layer, colori, p.H, p.x); },
            i * (dura / nRazzi));
    }
    fuochiAttorno(layer, p, colori, dura, (opts.ogni || 900) / meta, vivo);
    return true;
}

export function mountFx(root) {
    const campo = root?.querySelector('.matchup-field-horizontal');
    if (!campo) return null;

    let layer = campo.querySelector('.live-fx');
    if (!layer) {
        layer = document.createElement('div');
        layer.className = 'live-fx';
        layer.setAttribute('aria-hidden', 'true');
        campo.appendChild(layer);
    }
    return layer;
}

// ─── Primitive ───────────────────────────────────────────────────

/** Centro della card rispetto al livello. Una lettura sola per raffica. */
function punto(layer, slot) {
    const a = slot.getBoundingClientRect(), b = layer.getBoundingClientRect();
    return {
        x: a.left - b.left + a.width / 2,
        y: a.top - b.top + a.height / 2,
        h: a.height,
        W: b.width, H: b.height,
    };
}

/** Anima e rimuove: nessuna particella sopravvive alla propria animazione. */
function via(el, keys, opts) {
    const an = el.animate(keys, opts);
    an.onfinish = () => el.remove();
    an.oncancel = () => el.remove();
    return an;
}

function crea(layer, cls, css) {
    const el = document.createElement('i');
    el.className = cls;
    el.style.cssText = css;
    layer.appendChild(el);
    return el;
}

// ─── Lampo ───────────────────────────────────────────────────────

/**
 * Il colpo d'apertura. Stesso elemento per tutti gli eventi, tempi diversi:
 * un lampo lento su un fumble sembrerebbe una festa.
 */
const LAMPI = {
    forte: { picco: 0.85, dur: 900, colpi: 3 },
    medio: { picco: 0.55, dur: 700, colpi: 3 },
    secco: { picco: 0.40, dur: 460, colpi: 2 },
};

/**
 * Due o tre colpi invece di uno, come il flash di una macchina fotografica a
 * ripetizione. Ogni colpo è più debole del precedente: tre lampi identici
 * sembrerebbero uno sfarfallio, tre che si smorzano sembrano uno scatto.
 */
function lampo(layer, forza) {
    const s = LAMPI[forza] || LAMPI.medio;
    const f = crea(layer, 'live-fx-flash', '');

    const keys = [{ opacity: 0, offset: 0 }];
    for (let i = 0; i < s.colpi; i++) {
        const q = (i + 1) / (s.colpi + 0.4);          // dove cade questo colpo
        const forza = s.picco * (1 - i * 0.3);        // e quanto è forte
        keys.push({ opacity: forza, offset: Math.min(q - 0.06, 0.97) });
        keys.push({ opacity: 0, offset: Math.min(q + 0.02, 0.99) });
    }
    keys.push({ opacity: 0, offset: 1 });

    via(f, keys, { duration: s.dur, easing: 'linear', fill: 'forwards' });
}

// ─── Coriandoli ──────────────────────────────────────────────────

function scoppioCoriandoli(layer, p, colori, n) {
    for (let i = 0; i < n; i++) {
        const w = rnd(5, 11), h = rnd(7, 14);
        const c = crea(layer, 'live-fx-confetto',
            `left:${p.x}px;top:${p.y}px;width:${w}px;height:${h}px;` +
            `background:${pick(colori)};border-radius:${Math.random() < 0.3 ? '50%' : '1px'}`);

        // parabola in tre fotogrammi: scoppio, apice, caduta
        const ang = rnd(-Math.PI * 0.94, -Math.PI * 0.06);
        const dist = rnd(70, 250);
        const px = Math.cos(ang) * dist, py = Math.sin(ang) * dist;
        const cadi = rnd(150, 340);
        const giri = rnd(2, 6) * 360;

        via(c, [
            { transform: 'translate(-50%,-50%) scale(0.5) rotate(0deg)', opacity: 1, offset: 0,
                easing: 'cubic-bezier(.12,.75,.35,1)' },
            { transform: `translate(calc(-50% + ${px}px), calc(-50% + ${py}px)) scale(1) rotate(${giri * 0.45}deg)`,
                opacity: 1, offset: 0.42, easing: 'cubic-bezier(.5,0,.75,.6)' },
            { transform: `translate(calc(-50% + ${px * 1.16}px), calc(-50% + ${py + cadi}px)) scale(0.9) rotate(${giri}deg)`,
                opacity: 0, offset: 1 },
        ], { duration: rnd(2600, 4400), fill: 'forwards' });
    }
}

/**
 * A ondate lungo la festa, non tutto al primo fotogramma: con dieci secondi di
 * durata un unico scoppio iniziale lascerebbe il campo vuoto per gli ultimi otto.
 */
function coriandoli(layer, p, colori, n, ondate, passo, vivo) {
    for (let o = 0; o < ondate; o++) {
        setTimeout(() => {
            if (vivo()) scoppioCoriandoli(layer, p, colori, Math.round(n / ondate));
        }, o * passo);
    }
}

// ─── Fuochi ──────────────────────────────────────────────────────

/** Uno scoppio: lampo al centro, poi scintille che ricadono. */
function scoppio(layer, x, y, col, scala = 1) {
    const lam = crea(layer, 'live-fx-spark',
        `left:${x}px;top:${y}px;width:14px;height:14px;background:#fff;box-shadow:0 0 26px 10px ${col}`);
    via(lam, [
        { transform: 'translate(-50%,-50%) scale(0.3)', opacity: 1 },
        { transform: `translate(-50%,-50%) scale(${2.6 * scala})`, opacity: 0 },
    ], { duration: 380, easing: 'ease-out', fill: 'forwards' });

    const n = Math.round(26 * scala);
    for (let k = 0; k < n; k++) {
        const size = rnd(3, 7);
        const sp = crea(layer, 'live-fx-spark',
            `left:${x}px;top:${y}px;width:${size}px;height:${size}px;background:${col};box-shadow:0 0 10px ${col}`);
        const a = (k / n) * Math.PI * 2 + rnd(-0.14, 0.14);
        const d = rnd(48, 130) * scala;
        via(sp, [
            { transform: 'translate(-50%,-50%) scale(1)', opacity: 1,
                easing: 'cubic-bezier(.08,.85,.3,1)' },
            { transform: `translate(calc(-50% + ${Math.cos(a) * d * 0.82}px), calc(-50% + ${Math.sin(a) * d * 0.82}px)) scale(0.75)`,
                opacity: 0.9, offset: 0.45, easing: 'cubic-bezier(.5,0,.8,.7)' },
            { transform: `translate(calc(-50% + ${Math.cos(a) * d}px), calc(-50% + ${Math.sin(a) * d + 70}px)) scale(0.15)`,
                opacity: 0 },
        ], { duration: rnd(1100, 1900), fill: 'forwards' });
    }
}

/** Un razzo che sale da sotto e scoppia in alto: serve al field goal da 50+. */
function razzo(layer, colori, H, xFisso) {
    const x = xFisso != null ? xFisso
        : rnd(layer.clientWidth * 0.25, layer.clientWidth * 0.75);
    const apice = rnd(H * 0.07, H * 0.18);
    const col = pick(colori);

    const r = crea(layer, 'live-fx-rocket',
        `left:${x}px;top:${H}px;background:linear-gradient(180deg,${col},transparent)`);
    via(r, [
        { transform: 'translate(-50%,0) scaleY(1)', opacity: 1 },
        { transform: `translate(-50%, ${apice - H}px) scaleY(1.8)`, opacity: 0.9, offset: 0.86 },
        { transform: `translate(-50%, ${apice - H}px) scaleY(0.2)`, opacity: 0 },
    ], { duration: 640, easing: 'cubic-bezier(.2,.7,.4,1)', fill: 'forwards' });

    setTimeout(() => { if (layer.isConnected) scoppio(layer, x, apice, col, 1.1); }, 620);
}

/**
 * Dieci secondi di fuochi ATTORNO a chi ha segnato, non sopra l'end zone: la
 * festa resta addosso al giocatore. Le posizioni si pescano in un anello
 * intorno alla card, sbilanciato verso l'alto, ritagliato ai bordi del campo
 * perché nessuno scoppio finisca mezzo fuori.
 */
function fuochiAttorno(layer, p, colori, durata, ogni, vivo) {
    const raggio = Math.min(p.W, p.H) * 0.46;
    const fine = performance.now() + durata;
    const uno = () => {
        if (!vivo() || performance.now() > fine) return;
        const a = rnd(-Math.PI * 0.98, -Math.PI * 0.02);
        const d = rnd(raggio * 0.3, raggio);
        const x = Math.max(30, Math.min(p.W - 30, p.x + Math.cos(a) * d));
        const y = Math.max(30, Math.min(p.H - 50, p.y + Math.sin(a) * d));
        scoppio(layer, x, y, pick(colori), rnd(0.65, 1.15));
        setTimeout(uno, rnd(ogni * 0.55, ogni * 1.45));
    };
    scoppio(layer, p.x, Math.max(30, p.y - 70), pick(colori), 1.2);
    setTimeout(uno, 220);
}

// ─── Cenere, bagliore, timbro, fumetto ───────────────────────────

/**
 * Il fulmine: una saetta che cala dall'alto del campo e colpisce la card.
 * Al posto della crepa, che raccontava un vetro rotto invece di una botta.
 */
function fulmine(layer, p, durata) {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('class', 'live-fx-fulmine');
    svg.setAttribute('viewBox', `0 0 ${Math.round(p.W)} ${Math.round(p.H)}`);
    svg.setAttribute('preserveAspectRatio', 'none');

    // Zigzag dal bordo alto del campo fin SOTTO la card: prima si fermava
    // sopra la testa e sembrava una saetta spenta a mezz'aria. Ora la attraversa.
    const fine = Math.min(p.H - 8, p.y + p.h * 0.62);
    let x = p.x + rnd(-40, 40);
    let d = `M ${x.toFixed(1)} 0`;
    const passi = 7;
    for (let i = 1; i <= passi; i++) {
        const k = i / passi;
        const y = fine * k;
        x += rnd(-34, 34) * (1 - k) + (p.x - x) * 0.35;
        d += ` L ${x.toFixed(1)} ${y.toFixed(1)}`;
    }
    for (const cls of ['live-fx-fulmine-alone', 'live-fx-fulmine-linea']) {
        const path = document.createElementNS(NS, 'path');
        path.setAttribute('d', d);
        path.setAttribute('class', cls);
        svg.appendChild(path);
    }
    layer.appendChild(svg);

    for (const path of svg.querySelectorAll('path')) {
        const len = path.getTotalLength();
        path.style.strokeDasharray = len;
        path.style.strokeDashoffset = len;
        path.animate([{ strokeDashoffset: len }, { strokeDashoffset: 0 }],
            { duration: 150, easing: 'cubic-bezier(.2,1,.3,1)', fill: 'forwards' });
    }
    // due guizzi come un lampo vero, poi si spegne
    via(svg, [
        { opacity: 0 }, { opacity: 1, offset: 0.04 },
        { opacity: 0.3, offset: 0.12 }, { opacity: 1, offset: 0.18 },
        { opacity: 0.9, offset: 0.5 }, { opacity: 0 },
    ], { duration: Math.min(durata, 2600), easing: 'ease-out', fill: 'forwards' });
    return svg;
}

/** Durata lunga = il campo resta acceso per tutta la festa, pulsando. */
function bagliore(layer, p, colore, durata) {
    const g = crea(layer, 'live-fx-glow',
        `left:${p.x}px;top:${p.y}px;background:radial-gradient(circle, ${colore} 0%, transparent 68%)`);
    const keys = durata > 2000
        ? [{ opacity: 0, transform: 'scale(0.35)' },
            { opacity: 0.6, transform: 'scale(1)', offset: 0.06 },
            { opacity: 0.3, transform: 'scale(1.1)', offset: 0.3 },
            { opacity: 0.55, transform: 'scale(1)', offset: 0.55 },
            { opacity: 0.28, transform: 'scale(1.12)', offset: 0.8 },
            { opacity: 0, transform: 'scale(1.4)' }]
        : [{ opacity: 0, transform: 'scale(0.35)' },
            { opacity: 0.55, transform: 'scale(1)', offset: 0.22 },
            { opacity: 0, transform: 'scale(1.35)' }];
    via(g, keys, { duration: durata, easing: 'ease-in-out', fill: 'forwards' });
}

/**
 * La parola grossa, ferma cinque secondi. Entrata e uscita hanno durata fissa e
 * la tenuta si ricava dal resto: cambiare STAMP_TENUTA_MS non richiede di
 * rifare i conti sugli offset. Respira appena, perché immobile per cinque
 * secondi sembra un fermo immagine.
 */
function timbro(layer, testo, cattivo, punti) {
    const t = document.createElement('i');
    t.className = 'live-fx-stamp' + (cattivo ? ' live-fx-stamp--bad' : '');
    t.textContent = testo;
    layer.appendChild(t);

    const entra = 350, esce = 700;
    const tot = entra + STAMP_TENUTA_MS + esce;
    const o = (ms) => ms / tot;

    // I punti si schiantano poco dopo la parola, in basso a destra rispetto a
    // lei, e se ne vanno insieme.
    if (punti) puntiSchianto(layer, punti, t, entra + 260, tot);

    via(t, [
        { transform: 'translate(-50%,-50%) scale(2.6) rotate(-9deg)', opacity: 0, offset: 0 },
        { transform: 'translate(-50%,-50%) scale(0.94) rotate(-3deg)', opacity: 1, offset: o(entra * 0.7),
            easing: 'cubic-bezier(.2,1.5,.4,1)' },
        { transform: 'translate(-50%,-50%) scale(1) rotate(-3deg)', opacity: 1, offset: o(entra) },
        { transform: 'translate(-50%,-51%) scale(1.02) rotate(-3deg)', opacity: 1, offset: o(entra + STAMP_TENUTA_MS * 0.5) },
        { transform: 'translate(-50%,-50%) scale(1) rotate(-3deg)', opacity: 1, offset: o(entra + STAMP_TENUTA_MS) },
        { transform: 'translate(-50%,-60%) scale(1.08) rotate(-3deg)', opacity: 0, offset: 1 },
    ], { duration: tot, fill: 'forwards' });
    return t;
}

/**
 * I punti guadagnati, che si schiantano in basso a destra della parola grossa.
 *
 * La posizione si calcola dalla misura NON trasformata del timbro
 * (`offsetWidth`, non `getBoundingClientRect`): il timbro entra scalato 2,6 e
 * il rettangolo trasformato darebbe un angolo che si sposta mentre l'animazione
 * scorre. Il timbro sta a `left:50% top:46%` del livello e si centra su quel
 * punto, quindi il suo angolo in basso a destra è ricavabile a mano.
 */
function puntiSchianto(layer, delta, timbroEl, ritardo, finoA) {
    const el = document.createElement('i');
    const su = delta > 0;
    el.className = 'live-fx-punti' + (su ? '' : ' live-fx-punti--giu');
    el.textContent = `${su ? '+' : ''}${delta.toFixed(2)}`;
    layer.appendChild(el);

    const posiziona = () => {
        const cx = layer.clientWidth * 0.5;
        const cy = layer.clientHeight * 0.46;
        el.style.left = `${cx + timbroEl.offsetWidth / 2}px`;
        el.style.top = `${cy + timbroEl.offsetHeight / 2}px`;
    };
    posiziona();

    const dur = Math.max(600, finoA - ritardo);
    const o = (ms) => ms / dur;
    const base = 'translate(-38%,-24%)';   // sporge oltre l'angolo, come un adesivo

    via(el, [
        { transform: `${base} scale(3) rotate(-3deg)`, opacity: 0, offset: 0 },
        { transform: `${base} scale(0.92) rotate(-3deg)`, opacity: 1, offset: o(190),
            easing: 'cubic-bezier(.2,1.7,.35,1)' },
        { transform: `${base} scale(1) rotate(-3deg)`, opacity: 1, offset: o(340) },
        { transform: `${base} scale(1) rotate(-3deg)`, opacity: 1, offset: o(dur - 700) },
        { transform: `translate(-38%,-34%) scale(1.08) rotate(-3deg)`, opacity: 0, offset: 1 },
    ], { duration: dur, delay: ritardo, fill: 'both' });
    return el;
}

/**
 * La nuvoletta sta sopra la testa, ma i giocatori della prima riga sono a
 * ridosso del bordo alto e il campo ritaglia (`overflow: hidden`): lì la
 * nuvoletta usciva mezza tagliata. Quando sopra non c'è spazio si ribalta
 * sotto la card, con la coda che punta all'insù.
 */
const BOLLA_ALTEZZA = 46;   // nuvoletta + coda, quanto basta per decidere

function fumetto(layer, p, testo, cattivo, durata = 4200) {
    const sopra = p.y - p.h / 2 - 8;
    const sotto = sopra - BOLLA_ALTEZZA < 0;

    const b = document.createElement('i');
    b.className = 'live-fx-bubble'
        + (cattivo ? ' live-fx-bubble--bad' : '')
        + (sotto ? ' live-fx-bubble--sotto' : '');
    b.textContent = testo;
    b.style.cssText = `left:${p.x}px;top:${sotto ? p.y + p.h / 2 + 8 : sopra}px`;
    layer.appendChild(b);

    // ribaltata, la nuvoletta parte dal bordo alto invece che dal basso
    const base = sotto ? 'translate(-50%,0)' : 'translate(-50%,-100%)';
    const via1 = sotto ? 'translate(-50%,4%)' : 'translate(-50%,-104%)';
    const fine = sotto ? 'translate(-50%,40%)' : 'translate(-50%,-140%)';

    // Entrata e uscita restano brevi qualunque sia la durata: se si allungassero
    // in proporzione, su dieci secondi la nuvoletta passerebbe un secondo intero
    // a comparire. Il tempo in più va tutto sulla tenuta.
    const entra = 0.08 * 4200 / durata;
    const esce = 0.14 * 4200 / durata;

    via(b, [
        { transform: `${base} scale(0.6)`, opacity: 0, easing: 'cubic-bezier(.2,1.6,.4,1)' },
        { transform: `${base} scale(1)`, opacity: 1, offset: Math.min(entra, 0.2) },
        { transform: `${via1} scale(1)`, opacity: 1, offset: 0.5 },
        { transform: `${base} scale(1)`, opacity: 1, offset: Math.max(1 - esce, 0.8) },
        { transform: `${fine} scale(0.95)`, opacity: 0 },
    ], { duration: durata, fill: 'forwards' });
    return b;
}

// ─── Regia ───────────────────────────────────────────────────────

/**
 * Una festa per volta, IN CODA. Se ne arriva una mentre un'altra è in corso non
 * la interrompe e non ci si sovrappone: aspetta il suo turno. Due raffiche da
 * dieci secondi insieme sono illeggibili, e sotto ai coriandoli ci sono i numeri
 * che uno sta cercando di leggere.
 *
 * Questo NON riguarda le reazioni piccole — anello della foto, etichetta dei
 * punti, totale che sale: quelle stanno in `flashNewReceipts` e continuano a
 * scorrere tutte insieme, come deve essere quando in campo succedono più cose.
 */
let festaInCorso = null;
let coda = [];

/**
 * Quanto dura il TURNO di una festa: particelle e timbro, non il commento.
 *
 * Il commento vive dieci secondi anche quando la festa è corta — un field goal
 * dura poco più di due — e legare il turno a lui vorrebbe dire tenere il campo
 * spento e la coda ferma per dieci secondi a ogni calcio. Il commento
 * sopravvive per conto suo, e se ne arriva un altro glielo si toglie di mezzo
 * (vedi `avvia`).
 */
function durataTotale(spec) {
    const conTimbro = spec.stampa ? 350 + STAMP_TENUTA_MS + 700 : 0;
    return Math.max(spec.dura || 0, conTimbro) + 250;   // un respiro fra una e l'altra
}

const ritardoBolla = (spec) => (spec.tipo === 'festa' ? 420 : 140);

/**
 * Spegne la festa in corso e svuota la coda. Le particelle già in volo finiscono
 * il loro arco — toglierle a metà si vedrebbe — ma timbro e fumetto vanno via
 * subito: stanno fermi al centro per cinque secondi, e due sovrapposti sono
 * illeggibili.
 */
export function fermaEffetti() {
    coda = [];
    if (!festaInCorso) return;
    festaInCorso.spenta = true;
    clearTimeout(festaInCorso.timer);
    for (const el of festaInCorso.fissi) {
        el.getAnimations().forEach(a => a.cancel());   // oncancel rimuove
        el.remove();                                   // se non era animato
    }
    spegniFesta(festaInCorso);                         // via il faro, sempre
    festaInCorso = null;
}

function prossima() {
    const n = coda.shift();
    if (!n) return;
    // fra l'accodamento e adesso la pagina può essere stata ridisegnata
    if (!n.layer.isConnected || !n.slot.isConnected) return prossima();
    avvia(n.layer, n.slot, n.spec, n.colori, n.punti);
}

/**
 * `colori` sono quelli della squadra guardata; `layer` il livello del campo.
 * Torna false se non ha disegnato niente (moto ridotto, o evento senza
 * reazione): il chiamante non deve cambiare comportamento, serve solo ai test.
 */
export function sparaEffetto(layer, slot, spec, colori, punti = 0) {
    if (!layer || !slot || !spec) return false;
    if (ridotto()) return false;                 // stessa guardia di popPoints

    if (festaInCorso) {
        // In coda, non sovrapposta. Al massimo due in attesa e ordinate per
        // importanza: se ne arrivano troppe, a restare è il touchdown, non il
        // sack che gli è capitato dietro.
        coda.push({ layer, slot, spec, colori, punti });
        coda.sort((a, b) => a.spec.rango - b.spec.rango);
        coda = coda.slice(0, 2);
        return 'coda';
    }
    return avvia(layer, slot, spec, colori, punti);
}

function avvia(layer, slot, spec, colori, punti) {
    // Via i resti della festa precedente. Il commento dura dieci secondi e può
    // sopravvivere al proprio turno: due nuvolette sovrapposte, o due timbri
    // sullo stesso punto del campo, non si leggono.
    for (const el of layer.querySelectorAll('.live-fx-bubble, .live-fx-stamp')) {
        el.getAnimations().forEach(a => a.cancel());   // oncancel rimuove
        el.remove();
    }

    // `fissi` = gli elementi che restano fermi a schermo (timbro, fumetto):
    // sono quelli che una festa nuova deve togliere di mezzo.
    // `spegni` = quello che va disfatto alla fine, comunque finisca.
    const mio = { spenta: false, fissi: [], timer: null, spegni: [] };
    festaInCorso = mio;

    // Il faro: il campo si abbassa e resta in evidenza solo il giocatore che
    // ha fatto succedere qualcosa. Vale anche per le palle perse — lì il
    // colpevole non si illumina né si ingrandisce (ci pensa il CSS), resta
    // solo l'unico a cui guardare mentre il resto sparisce.
    if (spec.tipo === 'festa' || spec.tipo === 'razzo' || spec.tipo === 'brutto') {
        // Sul palco, non sul campo: la panchina gli sta accanto ed è fatta di
        // card identiche. Abbassando solo il campo la panchina restava accesa
        // e si prendeva l'occhio proprio mentre si voleva guardare altrove.
        const palco = layer.closest('.live-stage') || layer.parentElement;
        palco?.classList.add('is-festa');
        slot.classList.add('live-slot--protagonista');
        mio.spegni.push(() => {
            palco?.classList.remove('is-festa');
            slot.classList.remove('live-slot--protagonista');
        });
    }
    const vivo = () => !mio.spenta && layer.isConnected;

    const p = punto(layer, slot);
    const meta = stretto() ? 0.5 : 1;            // su telefono le particelle si dimezzano

    if (spec.lampo) lampo(layer, spec.lampo);
    vibra(spec.vibra);

    // Cosa disegnare lo dicono i DATI, non il tipo: così dare coriandoli, razzi
    // e fuochi anche al field goal è cambiare un numero nella tabella, non
    // aggiungere un ramo qui.
    if (spec.coriandoli) {
        coriandoli(layer, p, colori, Math.round(spec.coriandoli * meta), 4, spec.dura / 5, vivo);
    }
    if (spec.razzi) {
        for (let i = 0; i < spec.razzi; i++) {
            setTimeout(() => { if (vivo()) razzo(layer, colori, p.H); }, i * 700);
        }
    }
    if (spec.ogni) {
        fuochiAttorno(layer, p, colori, spec.dura, spec.ogni / meta, vivo);
        bagliore(layer, p, 'rgba(255,255,255,0.20)', spec.dura);
    }
    if (spec.fulmine) mio.fissi.push(fulmine(layer, p, spec.dura));
    if (spec.rotto) {
        slot.classList.add('live-slot--rotto');
        mio.spegni.push(() => slot.classList.remove('live-slot--rotto'));
    }
    if (spec.trema) {
        // La durata la decide la riga: un sack e' una botta secca, un
        // intercetto lascia la card a vibrare piu' a lungo.
        slot.style.setProperty('--scossa-dur', `${spec.trema}ms`);
        slot.classList.add('live-slot--scossa');
        setTimeout(() => {
            slot.classList.remove('live-slot--scossa');
            slot.style.removeProperty('--scossa-dur');
        }, spec.trema + 80);
    }

    if (spec.stampa) mio.fissi.push(timbro(layer, spec.stampa, !!spec.cattivo, punti));
    if (spec.dice) {
        // Il commento resta dieci secondi per tutti gli eventi, anche quelli con
        // una festa corta: è una battuta, si legge con calma. Il turno della
        // festa è già lungo abbastanza da coprirlo (vedi `durataTotale`).
        setTimeout(() => {
            if (vivo()) mio.fissi.push(fumetto(layer, p, spec.dice, !!spec.cattivo, BOLLA_MS));
        }, ritardoBolla(spec));
    }

    // Finita questa, tocca a quella in coda.
    mio.timer = setTimeout(() => {
        if (festaInCorso === mio) { festaInCorso = null; spegniFesta(mio); prossima(); }
    }, durataTotale(spec));
    return true;
}

function spegniFesta(mio) {
    for (const f of mio.spegni) f();
    mio.spegni = [];
}
