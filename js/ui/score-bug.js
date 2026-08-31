/**
 * Score bug — il tabellone del matchup fantasy.
 *
 * ⚠️ NON ANCORA IN USO NEL SITO. Vive qui e si guarda da
 * `preview-scorebug.html`. Quando la forma è quella giusta prende il posto del
 * banner attuale (`.gc-banner`) nei tre punti che lo disegnano oggi:
 *   js/sections/live.js:matchupCardHTML   — matchup in corso, con proiezioni
 *   js/sections/game-center.js            — le due sfide della settimana
 *   js/sections/history.js                — il banner del Super Bowl
 * Sono tre contesti diversi, ed è il motivo per cui qui ci sono tre VARIANTI
 * invece di un pezzo solo: la stessa griglia e la stessa tipografia, tre
 * densità.
 *
 * Contratto uguale a js/ui/charts.js: entra un oggetto piatto, esce una
 * STRINGA HTML. Nessuna idratazione da ricordarsi dopo l'inserimento.
 *
 * ── I due vincoli che NON si possono violare ──────────────────────────
 *
 * 1. Il punteggio vero sta in un `<span class="pts-val">` tutto suo.
 *    `countUp()` in live.js anima scrivendo dentro quello (via `numEl`), e la
 *    proiezione affiancata gli sta FUORI: messa dentro, il primo fotogramma
 *    dell'animazione se la mangerebbe. È la stessa regola scritta in CLAUDE.md
 *    per tutto il sito, non un dettaglio di questo file.
 *
 * 2. L'aggiornamento in place cerca gli elementi del punteggio e ci mette la
 *    classe `winner`. Oggi li trova con `.gc-banner-score`; qui il gancio è
 *    `[data-sb-score]`, che è un ATTRIBUTO e non una classe apposta: la classe
 *    serve anche a disegnare, e legare l'aggiornamento a una scelta grafica
 *    significa rompere il live la prima volta che si rinomina uno stile.
 *
 * ── Gli stati, e perché sono quattro ──────────────────────────────────
 *   undrafted  la lega non ha ancora draftato: non c'è punteggio, e uno zero
 *              direbbe "hanno giocato e non hanno fatto niente".
 *   projected  prima del kickoff la PROIEZIONE è il punteggio, e si vede che
 *              lo è (numero in corsivo tenue, etichetta "projected").
 *   live       punti veri per tutti, zeri compresi, con la proiezione accanto
 *              in piccolo come riferimento.
 *   final      settimana chiusa: vince chi ha di più, e si vede.
 */

const esc = (s) => String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Un punteggio con due decimali, come tutto il resto del sito. */
const fmt = (v) => (v == null ? '–' : Number(v).toFixed(2));

/**
 * Sigla di tre lettere per le viste strette. Non è archiviata da nessuna
 * parte: si ricava dal nome, tenendo TUTTE le iniziali quando le parole sono
 * più di una ("Capi dei Pianeti" → CDP, "dei" compreso — è la sigla che sta
 * scritta sul loro stesso stemma) e le prime tre lettere quando è una sola
 * ("Oscurus" → OSC).
 */
export function teamAbbr(name) {
    const words = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!words.length) return '???';
    if (words.length === 1) return words[0].slice(0, 3).toUpperCase();
    return words.map(w => w[0]).join('').slice(0, 4).toUpperCase();
}

/**
 * Il punteggio di un lato, con la sua proiezione quando serve.
 * Vedi il vincolo 1 in testa al file: `.pts-val` resta un elemento a sé.
 */
function scoreHTML(side, state) {
    if (state === 'undrafted') return '<span class="pts-val">–</span>';
    if (state === 'projected') {
        return `<span class="pts-val proj-pts">${fmt(side.projected ?? side.score)}</span>`;
    }
    const proj = side.projected == null ? ''
        : `<small class="pts-proj" title="projected">${fmt(side.projected)}</small>`;
    return `<span class="pts-val">${fmt(side.score)}</span>${proj}`;
}

/** Etichetta di stato: quella che in TV sta accanto al cronometro. */
function statusHTML(m) {
    const { state } = m;
    const label = m.label || {
        undrafted: 'Not drafted', projected: 'Projected', live: 'Live', final: 'Final',
    }[state] || '';
    const dot = state === 'live' ? '<i class="sb-dot" aria-hidden="true"></i>' : '';
    return `
    <div class="sb-status sb-status--${state}">
        <span class="sb-status-label">${dot}${esc(label)}</span>
        ${m.note ? `<span class="sb-status-note">${esc(m.note)}</span>` : ''}
    </div>`;
}

/**
 * Barra di probabilità. È la quota di punti già a referto, non un pronostico:
 * l'etichetta lo dice, perché una barra al 62% senza contesto si legge come
 * "ha il 62% di vincere" ed è un'altra cosa.
 */
function probHTML(m) {
    if (m.winProb == null) return '';
    const p = Math.max(0, Math.min(100, Math.round(m.winProb)));
    return `
    <div class="sb-prob" title="Share of the points on the board so far">
        <span class="sb-prob-pct">${p}%</span>
        <span class="sb-prob-track"><i class="sb-prob-fill" style="width:${p}%"></i></span>
        <span class="sb-prob-pct sb-prob-pct--r">${100 - p}%</span>
    </div>`;
}

/**
 * Avanzamento sulla propria proiezione: quanta parte dei punti attesi è già a
 * referto. Serve a riempire il vuoto fra il nome e il punteggio nella riga
 * larga — ma riempirlo di INFORMAZIONE, non di spazio: allargare il nome o
 * centrare il numero avrebbe solo spostato il buco.
 *
 * Ed è la cosa che al punteggio manca davvero. "92.44 contro 78.06" non dice
 * chi sta vincendo per davvero: se il primo ha finito i suoi giocatori e il
 * secondo ne ha sette in campo, è il secondo a essere avanti. La barra lo
 * mostra senza che nessuno debba fare il conto.
 *
 * Solo quando ha senso: prima del kickoff sarebbero due barre a zero, e a
 * lega non draftata non esiste né la proiezione né il punteggio.
 */
function paceHTML(side, state) {
    if (state !== 'live' && state !== 'final') return '<span class="sb-pace"></span>';
    const proj = Number(side.projected);
    const score = Number(side.score);
    if (!proj || !Number.isFinite(score)) return '<span class="sb-pace"></span>';
    const pct = Math.max(0, Math.min(100, Math.round((score / proj) * 100)));
    return `
    <span class="sb-pace" title="${score.toFixed(2)} of a projected ${proj.toFixed(2)} — ${pct}% of the way there">
        <span class="sb-pace-track"><i class="sb-pace-fill" style="width:${pct}%"></i></span>
        <em class="sb-pace-pct">${pct}%</em>
    </span>`;
}

/** Riga di una squadra nella variante broadcast. */
function rowHTML(side, i, m, wins) {
    const abbr = side.abbr || teamAbbr(side.name);
    return `
    <div class="sb-row${wins ? ' sb-row--lead' : ''}${side.selected ? ' sb-row--mine' : ''}"
         style="--sb-c:${side.color || 'var(--accent-red)'}">
        <span class="sb-bar" aria-hidden="true"></span>
        ${side.logo ? `<img class="sb-logo" src="${esc(side.logo)}" alt="" aria-hidden="true">` : ''}
        <span class="sb-abbr">${esc(abbr)}</span>
        <span class="sb-name">${esc(side.name)}</span>
        ${paceHTML(side, m.state)}
        <span class="sb-score" data-sb-score="${i}">${scoreHTML(side, m.state)}</span>
    </div>`;
}

/**
 * @param m {
 *   left, right: { name, color, logo, score, projected, selected, abbr?,
 *                  starters?, done? },   // tacche: quanti titolari hanno finito
 *   state: 'undrafted' | 'projected' | 'live' | 'final',
 *   label?, note?, winProb?, href?, mid?  // mid = pannello centrale (broadcast)
 * }
 * @param opts { variant: 'broadcast' | 'broadcast2' | 'marquee' | 'ticker',
 *                theme?: 'dark' | 'light' }   // default per variante, vedi sotto
 */
export function scoreBugHTML(m, opts = {}) {
    if (!m?.left || !m?.right) return '';
    const variant = opts.variant || 'broadcast';
    /**
     * Tema di COLORE del componente — un asse indipendente dal tema della
     * pagina che lo ospita. Di default ogni variante tiene l'aspetto già
     * approvato: scuro per broadcast/marquee/ticker (si sposano col sito),
     * chiaro per broadcast2 (è un ricalco di un tabellone di carta, la sua
     * identità stessa). `opts.theme` lo forza per tutte e quattro allo stesso
     * modo — è quello che usa il banco per il selettore "Colore".
     */
    const theme = opts.theme || (variant === 'broadcast2' ? 'light' : 'dark');
    const scored = m.state !== 'undrafted';
    const s1 = Number(m.state === 'projected' ? (m.left.projected ?? m.left.score) : m.left.score) || 0;
    const s2 = Number(m.state === 'projected' ? (m.right.projected ?? m.right.score) : m.right.score) || 0;
    // "in vantaggio" solo quando un punteggio esiste: a board vuoto sarebbero
    // due pareggi a zero e la card evidenzierebbe tutti e due
    /**
     * Vantaggio in senso STRETTO, e il pareggio come stato a sé.
     *
     * Con `>=` da tutte e due le parti, a parità risultavano entrambe in
     * vantaggio: due righe accese insieme, e a schermo non si capiva quale
     * fosse quella spenta — sembrava un difetto invece che un pareggio. In
     * parità non è che vincono tutti e due: è che non vince nessuno, e il
     * tabellone lo dice con una terza faccia invece di accenderne due.
     */
    const tie = scored && s1 === s2;
    const w1 = scored && !tie && s1 > s2, w2 = scored && !tie && s2 > s1;

    const body = variant === 'ticker' ? tickerBody(m, s1, s2, w1, w2)
        : variant === 'marquee' ? marqueeBody(m, w1, w2)
            : variant === 'broadcast2' ? broadcast2Body(m, w1, w2)
                : broadcastBody(m, w1, w2);

    /**
     * I nomi della marquee stanno FUORI dalla card, non dentro.
     *
     * Non è una scelta di struttura, è l'unico modo che funziona: la card ha un
     * `clip-path`, e clip-path ritaglia TUTTI i discendenti. La rientranza in
     * alto è un buco nella forma — qualunque cosa ci finisca dentro viene
     * cancellata, e i nomi sparivano senza lasciare traccia. Messi come
     * fratelli della card dentro al wrapper, cadono nella rientranza senza
     * essere toccati dal ritaglio.
     */
    const notch = variant === 'marquee' ? notchHTML(m) : '';

    const tag = m.href ? 'a' : 'div';
    const attrs = m.href ? ` href="${esc(m.href)}"` : '';
    // Il wrapper non è decorativo: è l'elemento che DICHIARA il contenitore di
    // misura. Una container query si applica ai discendenti del contenitore,
    // mai al contenitore stesso — con `container-type` sulla card, la regola
    // che manda il modulo di stato sotto le due righe non scattava mai e a
    // schermo stretto l'etichetta finiva sopra i numeri ("141.62INAL").
    return `
    <div class="sb-wrap${variant === 'marquee' ? ' sb-wrap--notched' : ''}" data-sb-theme="${theme}">
        ${notch}
        <${tag} class="sb sb--${variant} sb--${m.state}${tie ? ' sb--tie' : ''}"${attrs}
            style="--sb-c1:${m.left.color || 'var(--accent-red)'};--sb-c2:${m.right.color || 'var(--accent-blue)'}">
            ${body}
        </${tag}>
    </div>`;
}

/* ── v1 · broadcast ─────────────────────────────────────────────────
   Due righe impilate, una per squadra, e un modulo di stato a destra. Si legge
   dall'alto in basso in un colpo d'occhio e regge bene lo stretto, perché non
   ha niente al centro da comprimere.

   Resta la forma scura, quella che si sposa col resto del sito. La v2 qui
   sotto è l'esperimento sul tabellone televisivo: vivono affiancate apposta,
   perché la differenza fra le due non si decide a parole. */
function broadcastBody(m, w1, w2) {
    return `
    <div class="sb-rows">
        ${rowHTML(m.left, 1, m, w1)}
        ${rowHTML(m.right, 2, m, w2)}
    </div>
    <div class="sb-aside">
        ${statusHTML(m)}
        ${probHTML(m)}
    </div>`;
}

/* ── v1b · broadcast 2 ──────────────────────────────────────────────
   Ricalcata sul tabellone NFL/YouTube: barra CHIARA, stemma a ogni capo, sigla
   nel colore della squadra, punteggi quasi neri, un pannello neutro al centro
   e sotto una striscia più stretta e scura col dettaglio.

   La barra chiara è l'unica cosa di tutto il sito che non è nera, ed è il
   motivo per cui la forma funziona: su fondo chiaro i colori squadra si usano
   PIENI — Oscurus #800020 e Sommo #1c4750, che su nero sparivano e andavano
   schiariti per forza, qui finalmente leggono per quello che sono. È lo stesso
   principio dei tabelloni veri: il colore sta nella sigla e nello stemma, non
   in un velo dietro ai numeri.

   Le tacche sotto ogni squadra: nel bug NFL sono i timeout rimasti. Qui sono i
   TITOLARI CHE HANNO FINITO — una per slot della formazione, accesa quando
   quel giocatore ha chiuso la sua partita. È l'informazione che sul tabellone
   vero occupa quel posto (quanto ti resta in mano) tradotta in quello che
   conta qui. Se il dato non c'è, le tacche non si disegnano: nessuna fila di
   trattini finti per riempire il disegno. */
function crestHTML(side) {
    return `<span class="sb-bc-crest" style="--sb-c:${side.color || 'var(--accent-red)'}">
        ${side.logo ? `<img src="${esc(side.logo)}" alt="" aria-hidden="true">` : ''}
    </span>`;
}

/** Le tacche dei titolari che hanno finito. Niente dato, niente tacche. */
function ticksHTML(side) {
    const total = Number(side.starters);
    if (!total) return '<span class="sb-bc-ticks"></span>';
    const done = Math.max(0, Math.min(total, Number(side.done) || 0));
    return `<span class="sb-bc-ticks" title="${done} of ${total} starters have finished their game">
        ${Array.from({ length: total }, (_, i) =>
        `<i class="sb-bc-tick${i < done ? ' is-done' : ''}"></i>`).join('')}
    </span>`;
}

function broadcast2Body(m, w1, w2) {
    // NB: niente probHTML() qui. Sul tabellone vero quella barra non c'è, e
    // aggiungerla è la prima cosa che fa capire che è una copia.
    //
    // Stessa ragione per la proiezione AFFIANCATA al punteggio: il riferimento
    // ha UN numero per squadra e basta. Affiancargliene un secondo in piccolo
    // rompe la cosa che tiene su quel disegno — un numero enorme e nient'altro
    // — e in più, con "92.44" al posto di "0", non ci starebbe comunque.
    //
    // MA prima del kickoff la proiezione NON è un numero affiancato: è il
    // punteggio. Toglierla anche lì faceva comparire uno 0.00 al posto di
    // "131.88", cioè esattamente la bugia che tutto il resto del componente
    // sta attento a non dire.
    const bare = (side) => (m.state === 'projected' ? side : { ...side, projected: null });
    const team = (side, i, wins, right) => `
        <span class="sb-bc-team${right ? ' sb-bc-team--r' : ''}${wins ? ' is-lead' : ''}${side.selected ? ' is-mine' : ''}"
              style="--sb-c:${side.color || 'var(--accent-red)'}">
            <b class="sb-bc-abbr">${esc(side.abbr || teamAbbr(side.name))}</b>
            <span class="sb-score" data-sb-score="${i}">${scoreHTML(bare(side), m.state)}</span>
        </span>`;
    return `
    <div class="sb-bc">
        <div class="sb-bc-bar">
            ${crestHTML(m.left)}
            ${team(m.left, 1, w1, false)}
            <span class="sb-bc-mid">${esc(m.mid || 'Topina')}</span>
            ${team(m.right, 2, w2, true)}
            ${crestHTML(m.right)}
        </div>
        <div class="sb-bc-ticksbar">
            ${ticksHTML(m.left)}
            ${ticksHTML(m.right)}
        </div>
        <div class="sb-bc-strip">${statusHTML(m)}</div>
    </div>`;
}

/* ── v2 · marquee ───────────────────────────────────────────────────
   La forma principale. Il profilo NON è un rettangolo: il bordo alto scende
   in mezzo, e in quella rientranza — sopra la sagoma piena, non dentro un
   riquadro — stanno i due nomi. Sotto, i punteggi.

   La differenza rispetto a una targa incassata non è di gusto. Una targa è
   un pezzo appoggiato DENTRO: aggiunge un bordo, un fondo e un livello, e a
   guardarla sembra un pulsante. Qui invece la sagoma stessa si ritira per
   fare spazio ai nomi, che restano testo nudo sul fondo della pagina: un
   elemento in meno e il gradino che si legge sul profilo, che è esattamente
   come sono fatti i tabelloni veri.

   Perché i nomi stanno al centro e non ai due estremi: prima erano ai capi
   della riga, e con "Capi dei Pianeti" da una parte e un punteggio a tre cifre
   dall'altra la riga era un elastico — a ogni larghezza cambiava tutto di
   posto. Raccolti in mezzo, la loro campata non dipende più dalla lunghezza
   dei numeri, e i loghi si prendono i due capi senza contendere spazio. */
/**
 * I due nomi che stanno nella rientranza — fuori dalla card, vedi sopra.
 *
 * Solo i nomi, in bianco: niente pastiglia colorata, niente sottolineatura,
 * nessuna differenza fra chi è in vantaggio e chi insegue. Quassù è
 * un'INTESTAZIONE — dice chi si sta affrontando, e basta. Il vantaggio lo
 * dicono i punteggi qui sotto, che è il posto dove uno lo va a cercare.
 *
 * NB: così sparisce anche il segno di "questa è la mia squadra", che prima
 * era la sottolineatura. In Live serve, e va rimesso da qualche altra parte.
 */
function notchHTML(m) {
    const name = (t) => `<span class="sb-notch-name">${esc(t.name)}</span>`;
    return `
    <div class="sb-notch">
        ${name(m.left)}
        <span class="sb-notch-sep" aria-hidden="true">vs</span>
        ${name(m.right)}
    </div>`;
}

function marqueeBody(m, w1, w2) {
    return `
    ${m.left.logo ? `<img class="sb-wm sb-wm--l" src="${esc(m.left.logo)}" alt="" aria-hidden="true">` : ''}
    ${m.right.logo ? `<img class="sb-wm sb-wm--r" src="${esc(m.right.logo)}" alt="" aria-hidden="true">` : ''}
    <div class="sb-mq">
        <div class="sb-mq-scores">
            <span class="sb-score${w1 ? ' sb-score--lead' : ''}" data-sb-score="1">${scoreHTML(m.left, m.state)}</span>
            <div class="sb-mq-mid">${statusHTML(m)}</div>
            <span class="sb-score${w2 ? ' sb-score--lead' : ''}" data-sb-score="2">${scoreHTML(m.right, m.state)}</span>
        </div>
    </div>
    ${probHTML(m)}`;
}

/* ── v3 · ticker ────────────────────────────────────────────────────
   Una riga sola, per quando il tabellone deve stare appiccicato in cima
   mentre si scorre il resto della pagina. Sigle al posto dei nomi: a questa
   altezza "Capi dei Pianeti" non ci sta, e troncato non si riconosce. */
function tickerBody(m, s1, s2, w1, w2) {
    const side = (t, i, wins) => `
        <span class="sb-tk-side${wins ? ' is-lead' : ''}${t.selected ? ' is-mine' : ''}"
              style="--sb-c:${t.color || 'var(--accent-red)'}">
            <i class="sb-tk-chip" aria-hidden="true"></i>
            <b class="sb-tk-abbr">${esc(t.abbr || teamAbbr(t.name))}</b>
            <span class="sb-score" data-sb-score="${i}">${scoreHTML(t, m.state)}</span>
        </span>`;
    return `
    <div class="sb-tk">
        ${side(m.left, 1, w1)}
        <span class="sb-tk-sep" aria-hidden="true">–</span>
        ${side(m.right, 2, w2)}
        ${statusHTML(m)}
    </div>`;
}
