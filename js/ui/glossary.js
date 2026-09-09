/**
 * Termini tecnici cliccabili — definizione ed esempio, dove il termine è usato.
 *
 * Le pagine del draft parlano una lingua fitta di sigle: VOR, ADP, TSI, SOS+,
 * replacement, cliff, capital. Le card ora spiegano di cosa parlano
 * (`dgt-explain`), ma una sigla in mezzo a una frase resta muta. Qui ogni sigla
 * diventa un bottoncino: un clic e compare cosa vuol dire, con UN ESEMPIO —
 * perché «valore sopra il replacement» non dice niente finché non leggi
 * «Jefferson vale 40 VOR: sono 40 punti in più, sulla stagione, di quello che
 * avresti preso gratis».
 *
 * ── Tre scelte, e i loro perché ──────────────────────────────────────
 * 1. **Si apre al CLIC**, non al passaggio del mouse. Il passaggio non esiste
 *    sul telefono, e tenere due comportamenti allineati significa tenerne uno
 *    rotto. Il termine si riconosce dal tratteggio sotto.
 * 2. **La marcatura è AUTOMATICA**, una volta per card. Marcare a mano ogni
 *    occorrenza significa che la sigla nuova, nel punto nuovo, resta muta —
 *    e succede sempre. Solo la prima per card, se no una pagina con quindici
 *    «VOR» diventa un campo di tratteggi.
 * 3. **C'è una lista di esclusioni** (`SKIP`), perché l'automatismo da solo
 *    marca anche dove dà fastidio: titoli, bottoni, chip stretti, intestazioni
 *    di tabella, e i pannelli `dgt-explain`, che quel termine lo stanno già
 *    spiegando.
 *
 * ── Come si usa ──────────────────────────────────────────────────────
 *     import { decorateTerms } from '../ui/glossary.js';
 *     decorateTerms(section);      // dopo aver scritto l'innerHTML
 *
 * Ogni chiamata rifà il lavoro sul contenitore che le passi: le sezioni che
 * ridisegnano (cambio anno, cambio squadra) la richiamano e basta.
 */

/* Il dizionario. `re` è il modo in cui il termine si riconosce nel testo:
   le sigle case-sensitive (VOR non è «vor» dentro «favor»), le espressioni
   no. `ex` è l'esempio, ed è la parte che fa capire — una definizione senza
   esempio è un'altra definizione da decifrare. */
const TERMS = [
    {
        id: 'vor', label: 'VOR — Value Over Replacement',
        re: /\bVOR\b/,
        def: `How many fantasy points a player is worth <b>above the best player you could have had for free</b> at his position, over a full season.`,
        ex: `A WR projected for 240 points when the best undrafted WR projects for 200 has a VOR of 40: he wins you 40 points across the season, not 240 — the other 200 were available to anyone.`,
    },
    {
        id: 'replacement', label: 'Replacement level',
        re: /\breplacement(?:-level)?\b/i,
        def: `The line a player has to clear to be worth anything. This site uses <b>two</b>: the last starter in the league (for team talent) and the best undrafted player (for single picks).`,
        ex: `In a 4-team league the last starting RB is already very good, so against that line almost every late-round pick is worth zero — which is why the picks are judged against the waiver line instead.`,
    },
    {
        id: 'adp', label: 'ADP — Average Draft Position',
        re: /\bADP\b/,
        def: `Where the market — thousands of real drafts — takes a player on average. It's the expectation your pick is measured against, in full-PPR scoring.`,
        ex: `Taking a player with ADP 34 at pick 12 is a <i>reach</i> of 22 spots: you paid a second-round price for a third-round expectation. That's not automatically wrong — it's a conviction, and the season says whether it was right.`,
    },
    {
        id: 'reach', label: 'Reach & steal',
        re: /\breach(?:es|ed)?\b/i,
        def: `A <b>reach</b> is a player taken earlier than his ADP, a <b>steal</b> later. On its own neither says anything about quality.`,
        ex: `Kelce at pick 50 with ADP 62 is a 12-spot reach. If he then finishes as the best TE in the league, the reach was the point.`,
    },
    {
        id: 'capital', label: 'Draft capital',
        re: /\bdraft capital\b/i,
        def: `What a pick cost you. An early pick is worth several late ones, so a mistake in round 1 weighs far more than one in round 14.`,
        ex: `In the efficiency average a first-round pick weighs about 57, the last pick of the draft weighs 1: getting round 1 wrong is roughly fifty times more expensive.`,
    },
    {
        id: 'tsi', label: 'TSI — Team Strength Index',
        re: /\bTSI\b/,
        def: `A 0-100 read of the <b>roster</b> you own — starters, depth, balance, scarcity, risk, bye weeks — where 50 is the league average. It sits next to the grade and never changes it.`,
        ex: `A team can draft efficiently (good grade) and still own a fragile roster: TSI 41 with a B grade means the process was fine and the result is thin.`,
    },
    {
        id: 'sos', label: 'SOS+ — Player Context Score',
        re: /\bSOS\+?\b/,
        def: `0-100 on everything around the player that a point projection doesn't see: his NFL offense, expected volume, efficiency, schedule difficulty <i>for his position</i>, the playoff weeks, trend, age and durability.`,
        ex: `Two RBs projected for the same points can sit 30 points apart in SOS+: one runs behind a top offense with an easy December, the other doesn't.`,
    },
    {
        id: 'ppr', label: 'PPR — Point Per Reception',
        re: /\b(?:full-)?PPR\b/,
        def: `Scoring where every catch is worth a point. This league is <b>full PPR</b>: one point per reception.`,
        ex: `A WR with 90 catches starts the season 90 points ahead of one with 30, before a single yard is counted. It's why ADP from a non-PPR league would rank the wrong players.`,
    },
    {
        id: 'cliff', label: 'Tier & cliff',
        re: /\b(?:cliffs?|tiers?)\b/i,
        def: `Positional value doesn't fall evenly, it drops in steps. A <b>cliff</b> is the step: the point where the next player available is clearly worse than the last one.`,
        ex: `If TE4 is worth 60 VOR and TE5 is worth 20, everything changes at that gap: taking the TE one pick earlier is worth 40 points, taking him one pick later costs them.`,
    },
    {
        id: 'survival', label: 'Survival',
        re: /\bsurviv(?:al|e|ed)\b/i,
        def: `The odds that the player you took would still have been on the board at your <b>next</b> turn. It's the question that decides whether a pick was early or just right.`,
        ex: `Survival 20% means he'd have been gone four times out of five: taking him now was almost forced. Survival 80% means you could have waited and used the pick elsewhere.`,
    },
    {
        id: 'percentile', label: 'Percentile',
        re: /\bpercentiles?\b/i,
        def: `A position in a ranking, not a score out of a hundred: it says how many comparable cases you're above.`,
        ex: `A draft in the 29th percentile is better than 29 drafts out of 100 since 2019. It reads low because the average sits near 47, not because it's a "29 out of 100".`,
    },
    {
        id: 'flop', label: 'Flop probability',
        re: /\bflop(?: probability| risk)?\b/i,
        def: `The share of similar profiles that, in this league's own history, finished well below what they were projected.`,
        ex: `A 36% flop probability doesn't mean he will fail: it means one profile like his in three did. It's a reason to have a backup, not to avoid the pick.`,
    },
];

/* Dove NON marcare: titoli, bottoni, campi, chip stretti, intestazioni di
   tabella — e i pannelli che quel termine lo stanno già spiegando, dove un
   fumetto sarebbe una spiegazione dentro una spiegazione. */
const SKIP = 'h1,h2,h3,h4,summary,button,a,input,textarea,select,th,code,'
    + '.mc-kicker,.mc-title,.dgt-explain,.gl-term,.dgt-move,.dg-letter,'
    + '.dgt-metric-label,.dgt-metric-val,.dgt-step-label,.dgt-chip,.dg-pill,.an-badge';
/* `.dgt-metric-val` è nella lista per un motivo che si vede solo a schermo: là
   dentro «VOR» è l'unità di un numero grande («153 VOR»), e marcarla spezza il
   numero con un tratteggio rosso. Il termine si prende nella prosa sotto, dove
   è una parola e non un'unità di misura. */

/* Il contenitore entro cui «prima occorrenza» ha senso: la card. Fuori dalle
   card (le note a piè di pagina) vale il contenitore che si è passato. */
const SCOPE = '.mosaic-card,.dgt-card,.mc-wide';

let pop = null;

function popover() {
    if (pop) return pop;
    pop = document.createElement('div');
    pop.className = 'gl-pop';
    pop.setAttribute('role', 'dialog');
    pop.hidden = true;
    document.body.appendChild(pop);
    // chiudere è più importante che aprire: da tastiera, cliccando fuori, e
    // quando la pagina si muove sotto al fumetto
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hide(); });
    document.addEventListener('click', (e) => {
        if (!pop.hidden && !pop.contains(e.target) && !e.target.closest('.gl-term')) hide();
    });
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
    return pop;
}

function hide() {
    if (!pop || pop.hidden) return;
    pop.hidden = true;
    document.querySelectorAll('.gl-term[aria-expanded="true"]')
        .forEach(b => b.setAttribute('aria-expanded', 'false'));
}

function show(btn, t) {
    const el = popover();
    el.innerHTML = `<span class="gl-pop-label">${t.label}</span>`
        + `<p class="gl-pop-def">${t.def}</p>`
        + `<p class="gl-pop-ex"><span>Example</span>${t.ex}</p>`;
    el.hidden = false;
    btn.setAttribute('aria-expanded', 'true');

    // posizione: sotto al termine, ma dentro la finestra — su un termine a
    // fondo pagina il fumetto va sopra, se no si aprirebbe fuori schermo
    const r = btn.getBoundingClientRect();
    const w = Math.min(340, window.innerWidth - 24);
    el.style.width = w + 'px';
    const h = el.offsetHeight;
    const sotto = r.bottom + 8 + h <= window.innerHeight - 8;
    el.style.top = (sotto ? r.bottom + 8 : Math.max(8, r.top - 8 - h)) + 'px';
    el.style.left = Math.max(12, Math.min(r.left, window.innerWidth - w - 12)) + 'px';
}

/**
 * Marca i termini conosciuti dentro `root`.
 * @param {Element} root
 * @param {Object} [opts]
 * @param {string} [opts.skip] selettori da saltare, in aggiunta ai soliti
 */
export function decorateTerms(root, opts = {}) {
    if (!root) return;
    const skip = opts.skip ? `${SKIP},${opts.skip}` : SKIP;
    const visti = new Map();   // scope → Set di id già marcati lì dentro

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode(n) {
            if (!n.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
            if (n.parentElement.closest(skip)) return NodeFilter.FILTER_REJECT;
            return NodeFilter.FILTER_ACCEPT;
        },
    });
    const coda = [];
    for (let n = walker.nextNode(); n; n = walker.nextNode()) coda.push(n);

    /* Coda e non ciclo semplice: un nodo di testo può contenere PIÙ termini
       («…ADP is full-PPR… where a tier ends»), e marcando solo il primo gli
       altri restavano muti in quella frase. Dopo ogni marcatura il pezzo che
       resta torna in coda e viene riesaminato. */
    while (coda.length) {
        const nodo = coda.shift();
        const scope = nodo.parentElement.closest(SCOPE) || root;
        if (!visti.has(scope)) visti.set(scope, new Set());
        const fatti = visti.get(scope);

        const t = TERMS.find(x => !fatti.has(x.id) && x.re.test(nodo.nodeValue));
        if (!t) continue;
        const m = t.re.exec(nodo.nodeValue);
        fatti.add(t.id);

        const dopo = nodo.splitText(m.index);
        dopo.nodeValue = dopo.nodeValue.slice(m[0].length);
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'gl-term';
        btn.dataset.term = t.id;
        btn.setAttribute('aria-expanded', 'false');
        btn.textContent = m[0];
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const aperto = btn.getAttribute('aria-expanded') === 'true';
            hide();
            if (!aperto) show(btn, t);
        });
        dopo.parentNode.insertBefore(btn, dopo);
        coda.unshift(dopo);
    }
}

/** Il dizionario, per chi volesse stamparlo altrove (o contarlo in un test). */
export const GLOSSARY_TERMS = TERMS.map(t => ({ id: t.id, label: t.label }));
