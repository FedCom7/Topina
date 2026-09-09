/**
 * Manager DNA — lo strato metriche.
 *
 * Definisce UNA VOLTA i tratti che descrivono come drafta e come si muove sul
 * mercato ciascun allenatore. Lo importano in due: `scripts/build-manager-dna.mjs`
 * (che li calcola su tutte le stagioni e li sottopone ai due cancelli
 * statistici) e le sezioni `managerdna*.js` (che li mostrano). Stessa
 * definizione, due consumatori: è la garanzia che il JSON committato e
 * l'eventuale stagione calcolata al volo nel browser parlino la stessa lingua.
 *
 * REGOLE DEL MODULO — non violarle senza rifare i test:
 *
 * 1. **Puro.** Niente DOM, niente Firebase, niente import dall'area Draft
 *    esistente (draftgrades.js, draft-grade.js, data.js). Deve restare
 *    importabile da Node senza shim. Per questo `roundOf` è riscritto qui
 *    invece di importare `flattenDraft` da data.js, che tira dentro l'SDK
 *    Firebase e un top-level await.
 * 2. **Niente lettere, per costruzione.** Questa pagina non conosce il motore
 *    del voto, quindi non ha `letter`/`score`/`grade` da poter disegnare. La
 *    regola CLAUDE.md dell'unica cosa a forma di voto regge da sola. Il rimando
 *    alle Pagelle si fa con un link, mai ricopiando un numero loro.
 * 3. **Ogni `fn` di tratto dev'essere pura e deterministica**, perché i due
 *    cancelli la chiamano ~10^5 volte su etichette rimescolate. Niente cache
 *    interne, niente Date.now(), niente Math.random().
 * 4. **`fn(rows, ctx)` riceve TUTTE le righe dell'allenatore**, non solo quelle
 *    di una stagione: alcuni tratti (la fedeltà) hanno bisogno dello storico.
 *    Se `ctx.year` è valorizzato il tratto vale per quella stagione soltanto —
 *    ed è la modalità che usa il cancello 2 (persistenza) — ma resta libero di
 *    guardare indietro. Un tratto che non sa rispondere restituisce `null`.
 * 5. **Doppia unità di misura.** I tratti di tipo-giocatore esistono in due
 *    versioni, `perPick` e `perPlayer` (deduplicando chi ricompare in più
 *    stagioni). Non è pignoleria: a livello di pick Capi sembra il
 *    collezionista di veterani (34% contro 15%), ma sui giocatori unici il
 *    segnale sparisce (18% contro 11%) — non drafta veterani, ridrafta gli
 *    stessi che invecchiano con lui. Dove le due divergono, la divergenza È il
 *    risultato e si mostra.
 */

// ─── normalizzazione nomi ────────────────────────────────────────────────────
// Stessa forma usata dagli altri moduli: minuscole, senza accenti, senza
// punteggiatura. Serve a incrociare draft / roster / tabellini, che scrivono
// "Ja'Marr Chase", "JaMarr Chase" e "Ja'Marr Chase Jr." in modi diversi.
export function normName(s) {
    return String(s || '')
        .normalize('NFKD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[^a-z ]/g, '')
        .trim();
}

/** Il giro da cui viene una pick assoluta, in uno snake a 4 squadre. */
export function roundOf(pick, numTeams = 4) {
    return Math.floor((Number(pick) - 1) / numTeams) + 1;
}

// ─── statistica di base ──────────────────────────────────────────────────────
const num = (v) => (Number.isFinite(+v) ? +v : null);

export function mean(list) {
    const v = (list || []).map(num).filter((x) => x !== null);
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

export function median(list) {
    const v = (list || []).map(num).filter((x) => x !== null).sort((a, b) => a - b);
    if (!v.length) return null;
    const h = v.length >> 1;
    return v.length % 2 ? v[h] : (v[h - 1] + v[h]) / 2;
}

/**
 * Quantile per indice, NON interpolato: `sorted[floor(f * (n-1))]`.
 * Volutamente la stessa convenzione con cui sono stati misurati i valori di
 * riferimento nel piano — cambiando formula l'IQR si sposta di qualche unità e
 * i controlli di regressione non tornano più.
 */
export function quantile(sorted, f) {
    if (!sorted.length) return null;
    return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(f * (sorted.length - 1))))];
}

export function iqr(list) {
    const v = (list || []).map(num).filter((x) => x !== null).sort((a, b) => a - b);
    if (v.length < 6) return null;
    return quantile(v, 0.75) - quantile(v, 0.25);
}

/** Herfindahl ×100 su una lista di etichette: 100 = tutto uguale, ~0 = sparso. */
export function hhi(labels) {
    const v = (labels || []).filter(Boolean);
    if (!v.length) return null;
    const c = new Map();
    for (const x of v) c.set(x, (c.get(x) || 0) + 1);
    let s = 0;
    for (const n of c.values()) s += (n / v.length) ** 2;
    return s * 100;
}

const pct = (hit, tot) => (tot ? (100 * hit) / tot : null);

/** Prima occorrenza di ogni giocatore, in ordine cronologico. */
function uniquePlayers(rows) {
    const seen = new Map();
    for (const r of [...rows].sort((a, b) => a.y - b.y || a.pick - b.pick)) {
        if (!seen.has(r.nm)) seen.set(r.nm, r);
    }
    return [...seen.values()];
}

/** Le righe della stagione richiesta, o tutte se `year` è nullo. */
const inYear = (rows, year) => (year == null ? rows : rows.filter((r) => r.y === year));

// ─── movimenti di mercato ────────────────────────────────────────────────────

/**
 * Ricostruisce ogni entrata in rosa per differenza fra roster settimanali, e la
 * CLASSIFICA. La classificazione non è un dettaglio: senza, chi parcheggia
 * infortunati in IR sembra un iperattivo del mercato.
 *
 *   clean     — non lasciato da nessun altro in quella stessa settimana e mai
 *               avuto prima in stagione: una vera decisione di mercato (81%)
 *   boomerang — era già stato in rosa quella stagione, quindi è un rientro
 *               (IR, bye, parcheggio): non è una scelta nuova (15%)
 *   trade     — un'altra squadra l'ha lasciato nella stessa settimana: scambio
 *               o claim immediato su un taglio (4%)
 *
 * @param rosters  { [teamKey]: { [week]: Set<nm> } } per UNA stagione
 * @param meta     { [teamKey]: { [week]: Map<nm, {name,pos,pts,started}> } }
 * @returns array piatto di movimenti, uno per entrata
 */
export function classifyMoves(rosters, meta, year) {
    const keys = Object.keys(rosters);
    if (!keys.length) return [];
    const weeks = Object.keys(rosters[keys[0]]).map(Number).sort((a, b) => a - b);
    const out = [];

    for (let i = 0; i < weeks.length - 1; i++) {
        const a = weeks[i];
        const b = weeks[i + 1];
        // chi ha lasciato ciascuna squadra in questa transizione: serve per
        // riconoscere gli scambi, che altrimenti passerebbero per acquisti
        const dropped = {};
        for (const k of keys) dropped[k] = setDiff(rosters[k][a], rosters[k][b]);

        for (const k of keys) {
            for (const nm of setDiff(rosters[k][b], rosters[k][a])) {
                const fromOther = keys.some((o) => o !== k && dropped[o].has(nm));
                const hadBefore = weeks.some((w) => w < a && rosters[k][w]?.has(nm));
                const kind = fromOther ? 'trade' : hadBefore ? 'boomerang' : 'clean';

                // permanenza e resa: da questa settimana fino alla prima in cui
                // sparisce di nuovo
                let tenure = 0;
                let startedPts = 0;
                let started = false;
                for (const w of weeks) {
                    if (w < b) continue;
                    if (!rosters[k][w]?.has(nm)) break;
                    tenure++;
                    const m = meta[k]?.[w]?.get(nm);
                    if (m?.started) {
                        started = true;
                        startedPts += m.pts || 0;
                    }
                }
                const info = meta[k]?.[b]?.get(nm) || {};
                out.push({
                    y: year, k, week: b, nm,
                    name: info.name || nm,
                    pos: info.pos || null,
                    kind, tenure, started,
                    startedPts: Math.round(startedPts * 100) / 100,
                });
            }
        }
    }
    return out;
}

function setDiff(a, b) {
    const out = new Set();
    for (const x of a || []) if (!b?.has(x)) out.add(x);
    return out;
}

// ─── il catalogo dei tratti ──────────────────────────────────────────────────
//
// `scope` dice su quale famiglia di righe lavora il tratto — e quindi anche
// QUALE NULLO usa il cancello 1: 'draft' si permuta dentro il giro (lo snake
// vincola ogni allenatore a una pick per giro), 'market' si permuta dentro la
// stagione. Usare il nullo sbagliato invalida metà sezione.
//
// `unit` = 'perPick' | 'perPlayer' per i tratti di tipo-giocatore (vedi regola 5).
// `archetype: true` autorizza il tratto a comparire in un predicato di
// archetipo: passare i cancelli non basta, un tratto può essere reale e
// insignificante insieme (il college HHI).

export const TRAIT_GROUPS = {
    market: 'Il mercato al draft',
    loyalty: 'Fedeltà',
    age: 'Età e tipo di giocatore',
    structure: 'Struttura del draft',
    inseason: 'Il mercato durante l\'anno',
    luck: 'Fortuna',
};

const T = [];
const trait = (o) => { T.push({ testable: true, scope: 'draft', archetype: false, ...o }); };

// ── mercato al draft ────────────────────────────────────────────────────────
// `adpRank` è il RANGO del giocatore nella lista ADP, non il suo numero di pick
// su un board a 12 squadre: due ranghi sullo stesso pool sono confrontabili, un
// numero di pick a 12 squadre contro un draft 4×15 no. Positivo = anticipato.
const reachOf = (r) => (r.adpRank == null ? null : r.adpRank - r.pick);

trait({
    id: 'reach', label: 'Reach vs mercato', group: 'market', unit: 'perPick',
    higherIs: 'anticipa il mercato', archetype: true,
    fn: (rows, ctx) => {
        const d = inYear(rows, ctx.year).map(reachOf).filter((x) => x !== null);
        return d.length >= (ctx.year ? 5 : 10) ? median(d) : null;
    },
});
trait({
    id: 'reachEarly', label: 'Reach nei primi 5 giri', group: 'market', unit: 'perPick',
    higherIs: 'anticipa quando conta', archetype: true,
    fn: (rows, ctx) => {
        const d = inYear(rows, ctx.year).filter((r) => r.round <= 5).map(reachOf).filter((x) => x !== null);
        return d.length >= (ctx.year ? 3 : 8) ? median(d) : null;
    },
});
trait({
    id: 'erraticity', label: 'Erraticità vs mercato', group: 'market', unit: 'perPick',
    higherIs: 'più imprevedibile',
    fn: (rows, ctx) => iqr(inYear(rows, ctx.year).map(reachOf).filter((x) => x !== null)),
});
trait({
    id: 'offConsensus', label: 'Pick fuori dal consensus (%)', group: 'market', unit: 'perPick',
    higherIs: 'più fuori dal coro',
    fn: (rows, ctx) => {
        const v = inYear(rows, ctx.year).filter((r) => r.adpRank != null);
        return pct(v.filter((r) => r.adpRank > 75).length, v.length);
    },
});

// ── fedeltà ─────────────────────────────────────────────────────────────────
trait({
    id: 'repeatEver', label: 'Ridrafta un proprio giocatore (%)', group: 'loyalty', unit: 'perPick',
    higherIs: 'più fedele', testable: false, // guarda tutto lo storico: non vale per stagione
    fn: (rows) => {
        const ord = [...rows].sort((a, b) => a.y - b.y || a.pick - b.pick);
        const first = ord.length ? ord[0].y : null;
        const seen = new Set();
        let n = 0;
        let hit = 0;
        for (const r of ord) {
            if (r.y > first) { n++; if (seen.has(r.nm)) hit++; }
            seen.add(r.nm);
        }
        return pct(hit, n);
    },
});
trait({
    id: 'repeatConsec', label: 'Ridrafta quello dell\'anno prima (%)', group: 'loyalty', unit: 'perPick',
    higherIs: 'più fedele', archetype: true,
    fn: (rows, ctx) => {
        const years = ctx.year != null ? [ctx.year] : [...new Set(rows.map((r) => r.y))].sort();
        const first = Math.min(...rows.map((r) => r.y));
        let n = 0;
        let hit = 0;
        for (const y of years) {
            if (y <= first) continue;
            const prev = new Set(rows.filter((r) => r.y === y - 1).map((r) => r.nm));
            for (const r of rows.filter((r) => r.y === y)) { n++; if (prev.has(r.nm)) hit++; }
        }
        return pct(hit, n);
    },
});
trait({
    id: 'nflConcentration', label: 'Concentrazione squadre NFL', group: 'loyalty', unit: 'perPick',
    higherIs: 'più concentrato',
    fn: (rows, ctx) => hhi(inYear(rows, ctx.year).map((r) => r.nfl)),
});

// ── età e tipo di giocatore ─────────────────────────────────────────────────
// Ogni tratto qui esiste in due unità. Il gate guarda `perPlayer` per i tratti
// di GUSTO (che giocatore gli piace) e `perPick` per quelli di COMPORTAMENTO
// (come spende le scelte).
const ageTrait = (id, label, unit, pick, extra = {}) => trait({
    id, label, group: 'age', unit, higherIs: 'più alto', ...extra,
    fn: (rows, ctx) => {
        let v = inYear(rows, ctx.year);
        if (unit === 'perPlayer') v = uniquePlayers(v);
        return pick(v);
    },
});

// Solo la versione perPlayer è ammessa agli archetipi: quella per pick
// sopravvive ai cancelli ma è gonfiata da chi ridrafta gli stessi giocatori.
ageTrait('rookieRate', 'Quota rookie (%)', 'perPlayer', (v) => {
    const k = v.filter((r) => r.rookie !== null);
    return pct(k.filter((r) => r.rookie).length, k.length);
}, { archetype: true });
ageTrait('rookieRatePick', 'Quota rookie, per pick (%)', 'perPick', (v) => {
    const k = v.filter((r) => r.rookie !== null);
    return pct(k.filter((r) => r.rookie).length, k.length);
});
ageTrait('vetRate', 'Veterani 7+ anni, per giocatore (%)', 'perPlayer', (v) => {
    const k = v.filter((r) => r.exp !== null);
    return pct(k.filter((r) => r.exp >= 7).length, k.length);
});
ageTrait('vetRatePick', 'Veterani 7+ anni, per pick (%)', 'perPick', (v) => {
    const k = v.filter((r) => r.exp !== null);
    return pct(k.filter((r) => r.exp >= 7).length, k.length);
});
ageTrait('expMean', 'Esperienza media', 'perPick', (v) => mean(v.map((r) => r.exp)));
ageTrait('expEarly', 'Esperienza nei primi 5 giri', 'perPick',
    (v) => mean(v.filter((r) => r.round <= 5).map((r) => r.exp)));
ageTrait('pedigree', 'Slot medio al draft NFL', 'perPlayer', (v) => mean(v.map((r) => r.nflDraftNo)));
ageTrait('udfaRate', 'Non draftati NFL (%)', 'perPlayer', (v) => {
    const k = v.filter((r) => r.exp !== null);
    return pct(k.filter((r) => !r.nflDraftNo).length, k.length);
});
ageTrait('snapPrior', 'Snap% dell\'anno prima', 'perPick', (v) => mean(v.map((r) => r.snapPrior)));
ageTrait('changedTeam', 'Preso dopo un cambio squadra NFL (%)', 'perPick', (v) => {
    const k = v.filter((r) => r.changedTeam !== null);
    return pct(k.filter((r) => r.changedTeam).length, k.length);
});
ageTrait('injPrevRate', 'Presi dopo 3+ gare saltate (%)', 'perPick', (v) => {
    const k = v.filter((r) => r.injPrev !== null);
    return pct(k.filter((r) => r.injPrev >= 3).length, k.length);
});
ageTrait('collegeHHI', 'Concentrazione college', 'perPlayer', (v) => hhi(v.map((r) => r.college)));

for (const pos of ['QB', 'RB', 'WR', 'TE']) {
    trait({
        id: `expPos${pos}`, label: `Esperienza media dei ${pos}`, group: 'age', unit: 'perPick',
        higherIs: 'li prende più vecchi', archetype: pos === 'RB',
        fn: (rows, ctx) => {
            const v = inYear(rows, ctx.year).filter((r) => r.pos === pos && r.exp !== null);
            return v.length >= (ctx.year ? 2 : 8) ? mean(v.map((r) => r.exp)) : null;
        },
    });
}

// ── struttura del draft ─────────────────────────────────────────────────────
// Tutto misurato rumore (q ≥ 0.40): si mostra, non si racconta.
for (const pos of ['QB', 'RB', 'WR', 'TE', 'K', 'DEF']) {
    trait({
        id: `first${pos}`, label: `Giro del primo ${pos}`, group: 'structure', unit: 'perPick',
        higherIs: 'lo prende più tardi',
        fn: (rows, ctx) => {
            const years = ctx.year != null ? [ctx.year] : [...new Set(rows.map((r) => r.y))];
            const v = [];
            for (const y of years) {
                const c = rows.filter((r) => r.y === y && r.pos === pos).map((r) => r.round);
                if (c.length) v.push(Math.min(...c));
            }
            return mean(v);
        },
    });
}
trait({
    id: 'burst', label: 'Due pick di fila stesso ruolo (%)', group: 'structure', unit: 'perPick',
    higherIs: 'più a raffiche',
    fn: (rows, ctx) => {
        const years = ctx.year != null ? [ctx.year] : [...new Set(rows.map((r) => r.y))];
        let n = 0;
        let hit = 0;
        for (const y of years) {
            const ps = rows.filter((r) => r.y === y).sort((a, b) => a.pick - b.pick);
            for (let i = 1; i < ps.length; i++) { n++; if (ps[i].pos === ps[i - 1].pos) hit++; }
        }
        return pct(hit, n);
    },
});
trait({
    id: 'posHHI', label: 'Concentrazione ruoli', group: 'structure', unit: 'perPick',
    higherIs: 'più sbilanciato',
    fn: (rows, ctx) => hhi(inYear(rows, ctx.year).map((r) => r.pos)),
});

// ── mercato durante l'anno ──────────────────────────────────────────────────
// Scope 'market': le righe sono MOVIMENTI, non pick, e il nullo del cancello 1
// è la permutazione delle etichette dentro la stagione.
// Salvo dove indicato si contano i soli `clean` (vedi classifyMoves).
const clean = (rows, year) => inYear(rows, year).filter((m) => m.kind === 'clean');
const nSeasons = (ctx) => (ctx.year != null ? 1 : ctx.seasons.length);

const mkt = (o) => trait({ ...o, scope: 'market', group: o.group || 'inseason' });

mkt({
    id: 'moves', label: 'Movimenti per stagione', higherIs: 'più attivo', archetype: true,
    fn: (rows, ctx) => clean(rows, ctx.year).length / nSeasons(ctx),
});
mkt({
    id: 'movesEarly', label: 'Movimenti nelle prime 6 settimane', higherIs: 'più attivo a inizio anno',
    archetype: true,
    fn: (rows, ctx) => clean(rows, ctx.year).filter((m) => m.week <= 6).length / nSeasons(ctx),
});
mkt({
    id: 'movesLate', label: 'Movimenti dalla settimana 11', higherIs: 'più attivo a fine anno',
    fn: (rows, ctx) => clean(rows, ctx.year).filter((m) => m.week >= 11).length / nSeasons(ctx),
});
mkt({
    id: 'firstMoveWeek', label: 'Settimana del primo movimento', higherIs: 'aspetta di più',
    archetype: true,
    fn: (rows, ctx) => {
        const years = ctx.year != null ? [ctx.year] : ctx.seasons;
        const v = [];
        for (const y of years) {
            const w = clean(rows, y).map((m) => m.week);
            if (w.length) v.push(Math.min(...w));
        }
        return mean(v);
    },
});
mkt({
    id: 'tenure', label: 'Permanenza media di un acquisto', higherIs: 'se li tiene', archetype: true,
    fn: (rows, ctx) => mean(clean(rows, ctx.year).map((m) => m.tenure)),
});
mkt({
    id: 'streamRate', label: 'Presi e mollati entro una settimana (%)', higherIs: 'più usa e getta',
    archetype: true,
    fn: (rows, ctx) => {
        const v = clean(rows, ctx.year);
        return pct(v.filter((m) => m.tenure <= 1).length, v.length);
    },
});
mkt({
    id: 'startedRate', label: 'Acquisti poi schierati (%)', higherIs: 'più mirato',
    fn: (rows, ctx) => {
        const v = clean(rows, ctx.year);
        return pct(v.filter((m) => m.started).length, v.length);
    },
});
mkt({
    id: 'ptsPerAdd', label: 'Punti per acquisto', higherIs: 'sceglie meglio',
    archetype: true,
    fn: (rows, ctx) => mean(clean(rows, ctx.year).map((m) => m.startedPts)),
});
mkt({
    id: 'ptsFromAdds', label: 'Punti totali dagli acquisti', higherIs: 'raccoglie di più',
    fn: (rows, ctx) => {
        const v = clean(rows, ctx.year);
        return v.reduce((a, m) => a + (m.startedPts || 0), 0) / nSeasons(ctx);
    },
});
mkt({
    id: 'kdefChurn', label: 'Movimenti su K/DEF (%)', higherIs: 'più streaming',
    fn: (rows, ctx) => {
        const v = clean(rows, ctx.year);
        return pct(v.filter((m) => m.pos === 'K' || m.pos === 'DEF' || m.pos === 'D/ST').length, v.length);
    },
});
mkt({
    id: 'boomerangShare', label: 'Rientri di giocatori già avuti (%)', higherIs: 'usa la rosa da parcheggio',
    fn: (rows, ctx) => {
        const v = inYear(rows, ctx.year);
        return pct(v.filter((m) => m.kind === 'boomerang').length, v.length);
    },
});

// ── il ponte fra le due metà ────────────────────────────────────────────────
// `holdDraftW8` è un tratto di DRAFT (le sue pick) misurato con dati di
// MERCATO (chi c'era ancora in rosa). Sta nello scope 'draft' perché l'unità è
// la pick, e le sue righe portano il flag già calcolato dal builder.
trait({
    id: 'holdDraftW8', label: 'Pick ancora in rosa alla settimana 8 (%)', group: 'loyalty',
    unit: 'perPick', higherIs: 'più fedele', archetype: true,
    fn: (rows, ctx) => {
        const v = inYear(rows, ctx.year).filter((r) => r.heldW8 !== null);
        return pct(v.filter((r) => r.heldW8).length, v.length);
    },
});
trait({
    id: 'holdDraftEnd', label: 'Pick ancora in rosa a fine anno (%)', group: 'loyalty',
    unit: 'perPick', higherIs: 'più fedele',
    fn: (rows, ctx) => {
        const v = inYear(rows, ctx.year).filter((r) => r.heldEnd !== null);
        return pct(v.filter((r) => r.heldEnd).length, v.length);
    },
});

// ── fortuna ─────────────────────────────────────────────────────────────────
// Gruppo a sé: sui dati misurati nessuno di questi passa il cancello 2, e la
// pagina lo dice invece di nasconderlo. Nessuno può entrare in un archetipo.
//
// La soglia dei "colpi tardivi" è INTERNA alla stagione — la mediana annuale
// dei punti delle pick dei primi 4 giri, che sta fra 228 e 308 a seconda
// dell'anno — così i sette anni sono confrontabili senza un'aspettativa
// esterna (niente proiezioni, niente motore del voto).
const lateHitFn = (fromRound) => (rows, ctx) => {
    const v = inYear(rows, ctx.year).filter(
        (r) => r.round >= fromRound && r.pts !== null && ctx.bars[r.y] != null,
    );
    return pct(v.filter((r) => r.pts >= ctx.bars[r.y]).length, v.length);
};
trait({ id: 'lateHit', label: 'Colpi dall\'8° giro (%)', group: 'luck', unit: 'perPick', higherIs: 'più fortunato', fn: lateHitFn(8) });
trait({ id: 'lateHitDeep', label: 'Colpi dall\'11° giro (%)', group: 'luck', unit: 'perPick', higherIs: 'più fortunato', fn: lateHitFn(11) });
trait({
    id: 'injWeeks', label: 'Settimane Out/IR per pick', group: 'luck', unit: 'perPick',
    higherIs: 'più sfortunato',
    fn: (rows, ctx) => mean(inYear(rows, ctx.year).map((r) => r.injWeeks)),
});
trait({
    id: 'injEarly', label: 'Out/IR sulle pick dei primi 4 giri', group: 'luck', unit: 'perPick',
    higherIs: 'più sfortunato',
    fn: (rows, ctx) => mean(inYear(rows, ctx.year).filter((r) => r.round <= 4).map((r) => r.injWeeks)),
});
trait({
    id: 'injBustEarly', label: 'Pick alte con 4+ gare saltate (%)', group: 'luck', unit: 'perPick',
    higherIs: 'più sfortunato',
    fn: (rows, ctx) => {
        const v = inYear(rows, ctx.year).filter((r) => r.round <= 4);
        return pct(v.filter((r) => (r.injWeeks || 0) >= 4).length, v.length);
    },
});

export const TRAITS = T;
export const TRAIT_BY_ID = Object.fromEntries(T.map((t) => [t.id, t]));

// ─── archetipi ───────────────────────────────────────────────────────────────
//
// Due filtri, non uno: un predicato può citare solo tratti (a) usciti
// `signature` dai due cancelli PER QUELL'ALLENATORE e (b) marcati
// `archetype: true` nel catalogo. Passare i cancelli dice che una differenza è
// reale, non che valga la pena raccontarla — il college HHI passa (q 0.057) su
// valori praticamente identici fra i quattro.
//
// Le soglie sono in σ, letterali, e vengono stampate a schermo accanto al
// valore che le ha superate: un'etichetta dev'essere contestabile guardando il
// numero che l'ha generata.
//
// PERCHÉ 0.75 E NON 1.0. La soglia non è "quanto è grande l'effetto" — a quella
// domanda hanno già risposto i due cancelli, che lavorano su tutti e quattro
// insieme. Qui resta solo da dire CHI guida un tratto già dichiarato reale, e
// con quattro valori la geometria è vincolata: se fossero equispaziati gli z
// sarebbero ±1.34 e ±0.45, quindi 0.75 separa esattamente l'estremo dagli altri
// tre. Con 1.0 servivano due tratti oltre il massimo praticamente raggiungibile
// da una z su n=4 mediata su sette stagioni, e nessun archetipo scattava mai —
// il che non è rigore, è una soglia scelta male.
export const Z_APART = 0.75;

export const ARCHETYPES = [
    {
        id: 'keeper',
        label: 'Il Conservatore',
        blurb: 'Si affeziona. Ridrafta i suoi, se li tiene in rosa, e sul mercato quasi non si muove.',
        needs: [
            { trait: 'repeatConsec', dir: +1 },
            { trait: 'moves', dir: -1 },
        ],
    },
    {
        id: 'churner',
        label: 'Il Rimescolatore',
        blurb: 'La rosa di dicembre non somiglia a quella di settembre: tanti movimenti, tenuti poco.',
        needs: [
            { trait: 'moves', dir: +1 },
            { trait: 'streamRate', dir: +1 },
        ],
    },
    {
        id: 'frontrunner',
        label: 'L\'Anticipatore',
        blurb: 'Non aspetta il mercato: prende chi vuole prima di quanto direbbe il listone.',
        needs: [
            { trait: 'reach', dir: +1 },
            { trait: 'reachEarly', dir: +1 },
        ],
    },
    {
        id: 'earlybird',
        label: 'L\'Impaziente',
        blurb: 'Non aspetta di capire: alle prime giornate è già sul mercato, e si muove più di tutti '
            + 'quando la stagione è ancora da leggere.',
        needs: [
            { trait: 'movesEarly', dir: +1 },
            { trait: 'firstMoveWeek', dir: -1 },
        ],
    },
    {
        id: 'sniper',
        label: 'Il Cecchino',
        blurb: 'Si muove poco e quasi mai a vuoto: ogni acquisto rende più di quanto renda agli altri.',
        needs: [
            { trait: 'ptsPerAdd', dir: +1 },
            { trait: 'moves', dir: -1 },
        ],
    },
    {
        id: 'patient',
        label: 'Il Paziente',
        blurb: 'Lascia che la stagione parli: entra tardi sul mercato e con poche mosse.',
        needs: [
            { trait: 'firstMoveWeek', dir: +1 },
            { trait: 'moves', dir: -1 },
        ],
    },
    {
        id: 'veteranist',
        label: 'Il Veteranista',
        blurb: 'Non compra futuro: vuole gente che ha già dimostrato, e i rookie non li guarda.',
        needs: [
            { trait: 'rookieRate', dir: -1 },
            { trait: 'expPosRB', dir: +1 },
        ],
    },
    {
        id: 'youthist',
        label: 'Il Giovanilista',
        blurb: 'Compra la curva: rookie e secondi anni, dove il prezzo non ha ancora recuperato.',
        needs: [
            { trait: 'rookieRate', dir: +1 },
            { trait: 'expPosRB', dir: -1 },
        ],
    },
];

/**
 * L'archetipo di un allenatore. **Ne restituisce sempre uno**: ogni allenatore
 * ha un nome, e la sincerità si sposta dal dare/non dare l'etichetta al dire
 * QUANTO È SOLIDA.
 *
 * Prima si prova la regola stretta, poi si allenta in due passi. Il livello
 * raggiunto finisce in `confidence` e va mostrato accanto al nome:
 *
 *   netta    — due tratti `signature`, entrambi oltre Z_APART. È una firma.
 *   sfumata  — si accettano anche i tratti `differs` (differiscono ma su sette
 *              anni non si ripetono) e basta mezzo σ. La direzione è quella,
 *              la certezza no.
 *   debole   — solo la direzione, senza soglia. Il nome descrive dove pende,
 *              non un'abitudine dimostrata.
 *
 * Il gruppo `luck` resta fuori a ogni livello: la fortuna non è un carattere.
 *
 * Fra più archetipi che combaciano vince quello con le PROVE PIÙ FORTI (|z|
 * medio), non quello dichiarato per primo: l'ordine di un array non è un
 * criterio, e con due etichette entrambe vere si deve poter dire perché è
 * stata scelta quella.
 *
 * @param profile  { [traitId]: { z, tier } }
 * @returns { id, label, blurb, evidence, strength, confidence }
 */
const LIVELLI = [
    { confidence: 'netta', tiers: ['signature'], soglia: Z_APART },
    { confidence: 'sfumata', tiers: ['signature', 'differs'], soglia: 0.5 },
    { confidence: 'debole', tiers: ['signature', 'differs', 'noise'], soglia: 0 },
];

function matchAt(profile, { tiers, soglia }) {
    let best = null;
    for (const a of ARCHETYPES) {
        const evidence = [];
        let ok = true;
        for (const need of a.needs) {
            const t = profile[need.trait];
            const def = TRAIT_BY_ID[need.trait];
            if (!t || t.z == null || !def?.archetype || def.group === 'luck'
                || !tiers.includes(t.tier)) { ok = false; break; }
            if (need.dir > 0 ? !(t.z >= soglia) : !(t.z <= -soglia)) { ok = false; break; }
            evidence.push({ trait: need.trait, z: t.z, thr: need.dir > 0 ? soglia : -soglia });
        }
        if (!ok || evidence.length < 2) continue;
        const strength = mean(evidence.map((e) => Math.abs(e.z)));
        if (!best || strength > best.strength) {
            best = { id: a.id, label: a.label, blurb: a.blurb, evidence, strength };
        }
    }
    return best;
}

export function archetypeFor(profile) {
    for (const liv of LIVELLI) {
        const m = matchAt(profile, liv);
        if (m) return { ...m, confidence: liv.confidence };
    }
    return null;   // non dovrebbe accadere: gli archetipi coprono direzioni opposte
}

/** Etichetta leggibile della solidità, per la UI. */
export const CONFIDENCE_LABEL = {
    netta: 'firma netta',
    sfumata: 'firma sfumata',
    debole: 'tendenza debole',
};

/** Cosa vuol dire, per esteso: va messo come tooltip accanto all'etichetta. */
export const CONFIDENCE_NOTE = {
    netta: 'Due tratti che differiscono dal caso E si ripetono di anno in anno.',
    sfumata: 'La direzione è chiara, ma almeno uno dei due tratti su sette anni non si ripete: '
        + 'potrebbe non essere un\'abitudine stabile.',
    debole: 'Nessun tratto supera i test: il nome dice dove pende, non un\'abitudine dimostrata.',
};

// ─── accesso al JSON dal browser ─────────────────────────────────────────────

/**
 * Il file è immutabile e committato: la cache giusta è quella HTTP, non
 * localStorage. NIENTE cacheGet/cacheSet e NIENTE famiglia nuova in
 * js/utils/storage.js — il modo di rispettare la regola "chiave nuova =
 * famiglia nuova" è non creare la chiave. Non "sistemare" questa funzione
 * aggiungendoci una cache.
 */
let dnaPromise = null;
export function getManagerDNA() {
    if (dnaPromise) return dnaPromise;
    dnaPromise = (async () => {
        try {
            const ctrl = new AbortController();
            const t = setTimeout(() => ctrl.abort(), 8000);
            const r = await fetch('data/model/manager_dna.json', { signal: ctrl.signal });
            clearTimeout(t);
            return r.ok ? await r.json() : null;
        } catch {
            return null;
        }
    })();
    return dnaPromise;
}
