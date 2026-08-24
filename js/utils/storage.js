/**
 * localStorage con budget e sfratto — perché una cache piena non deve poter
 * spegnere il sito.
 *
 * Il guasto che questo modulo previene (visto il 2026-08-23): l'SDK Firebase
 * scrive un flag suo, `firebase:previous_websocket_failure`, dentro
 * `WebSocketConnection.open`, e quella setItem NON è protetta da try/catch.
 * Con lo storage pieno lancia QuotaExceededError, la open si interrompe, il
 * websocket non si apre, e OGNI lettura di lega va in timeout: home,
 * standings, storico, tutto vuoto. Le nostre cache invece la quota la
 * ignorano (setItem già in try/catch), quindi si prendono tutto lo spazio e
 * a pagarla è l'unico che non sa difendersi.
 *
 * Chi riempiva: la cache delle proiezioni Sleeper pesava 3,5 MB PER ANNO
 * (l'86% erano varianti di ADP che non leggiamo: dynasty, 2QB, IDP, rookie…)
 * su una quota totale di ~5 MB, e le pagine giocatore ne aggiungevano una
 * chiave per giocatore per stagione senza limite. Due anni di Draft Grade e
 * lo storage era pieno.
 *
 * Le due regole qui dentro:
 *  1. le nostre cache tengono sempre libero RESERVE_CHARS per l'SDK;
 *  2. quando serve spazio sfrattiamo NOI, dalla roba più facile da rifare.
 */

// Spazio che le nostre cache non toccano mai: ci scrivono i flag dell'SDK
// Firebase e di Analytics, che sono piccoli ma non tollerano un rifiuto.
const RESERVE_CHARS = 64 * 1024;
const PROBE_KEY = '__topina_probe__';

// Verificare la riserva costa una scrittura di sonda: su una cache che si
// aggiorna un giocatore alla volta (foto, atleti ESPN) sarebbe una sonda a
// ogni nome risolto. Basta ricontrollare ogni tanto — a fallire per davvero
// ci pensa il catch della setItem, che sfratta subito.
const RESERVE_CHECK_MS = 10 * 1000;
let _lastReserveCheck = 0;

// Nessuna singola voce vale lo svuotamento di tutte le altre. Senza questo
// tetto, una cache più grande della quota intera sfratta ogni cosa e poi
// fallisce lo stesso: si è buttato via tutto per niente.
const MAX_ENTRY_CHARS = 1024 * 1024;

// Tetto che ci diamo da soli, indipendente dalla quota del browser. Serve
// perché la quota NON è una costante: Chrome su localhost ne concede quasi 10
// MB, il vecchio limite standard è 5, e su GitHub Pages l'origine è condivisa
// con tutto il resto del sito. Aspettare il muro significa scoprire dov'è solo
// quando l'SDK Firebase ci sbatte contro. 2M caratteri (~4 MB) stanno sotto
// anche al limite più stretto e bastano per ~4 stagioni di cache.
const BUDGET_CHARS = 2 * 1024 * 1024;

/**
 * Le famiglie di chiavi che gestiamo. `tier` è l'ordine di sfratto: si parte
 * da 0, cioè da quello che si rifà con una sola richiesta, e si sale verso le
 * cache costruite un pezzo alla volta (una richiesta per giocatore).
 *
 * `stale` riconosce anche le VERSIONI VECCHIE della stessa famiglia: bumpare
 * `current` da _v4_ a _v5_ non cancellava niente, e i blob orfani restavano
 * lì per sempre a occupare megabyte per conto di codice che non esiste più.
 */
const FAMILIES = [
    { current: 'topina_proj_v5_',      stale: /^topina_proj_v\d+_/,       tier: 0 },
    { current: 'topina_stats_v4_',     stale: /^topina_stats_v\d+_/,      tier: 0 },
    { current: 'nfl-sched4-',          stale: /^nfl-sched\d*-/,           tier: 1 },
    { current: 'nfl-weekgames1-',      stale: /^nfl-weekgames\d*-/,       tier: 1 },
    { current: 'topina_pbp_v1_',       stale: /^topina_pbp_v\d+_/,        tier: 1 },
    { current: 'topina_pweek_v2_',     stale: /^topina_pweek_v\d+_/,      tier: 2 },
    { current: 'topina_pseason_v2_',   stale: /^topina_pseason_v\d+_/,    tier: 2 },
    { current: 'topina_pinfo_v1_',     stale: /^topina_pinfo_v\d+_/,      tier: 2 },
    { current: 'topina-espn-athletes', stale: /^topina-espn-athletes$/,   tier: 3 },
    { current: 'topina_player_ids_v4', stale: /^topina_player_ids_v\d+$/, tier: 3 },
];

/** Peso di una voce in caratteri (localStorage conta chiave + valore). */
const weigh = (k, v) => k.length + (v ? v.length : 0);

/** La famiglia di una chiave, o null se non è roba nostra. */
function familyOf(key) {
    return FAMILIES.find(f => f.stale.test(key)) || null;
}

/** Tutte le voci nostre presenti, con peso, età e se sono di una versione ritirata. */
function ourEntries() {
    const out = [];
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key) continue;
        const fam = familyOf(key);
        if (!fam) continue;
        const raw = localStorage.getItem(key);
        let at = 0;
        try { at = JSON.parse(raw)?.at || 0; } catch { /* forma vecchia o corrotta: vecchissima */ }
        out.push({ key, fam, at, size: weigh(key, raw), retired: !key.startsWith(fam.current) });
    }
    return out;
}

/** C'è ancora posto per `chars` caratteri? Lo si chiede alla quota vera, non a stime. */
function hasRoomFor(chars) {
    try {
        localStorage.setItem(PROBE_KEY, 'x'.repeat(Math.max(0, chars)));
        localStorage.removeItem(PROBE_KEY);
        return true;
    } catch {
        try { localStorage.removeItem(PROBE_KEY); } catch { /* niente */ }
        return false;
    }
}

/**
 * Libera spazio finché non c'è posto per `chars` più la riserva.
 * Ordine di sfratto: prima le versioni ritirate (non le legge nessuno), poi
 * per tier crescente e, a parità, le più vecchie. `keep` è la chiave appena
 * scritta, che non deve sfrattare se stessa. Ritorna i caratteri liberati.
 */
function evictFor(chars, keep) {
    const needed = chars + RESERVE_CHARS;
    const entries = ourEntries();
    let occupato = entries.reduce((n, e) => n + e.size, 0);
    // Due motivi per sfrattare: il browser dice di no, oppure abbiamo passato
    // il tetto che ci siamo dati. Il secondo arriva prima, ed è il punto.
    const oltreBudget = () => occupato + chars > BUDGET_CHARS;
    if (!oltreBudget() && hasRoomFor(needed)) return 0;

    const queue = entries
        .filter(e => e.key !== keep)
        .sort((a, b) => (b.retired - a.retired) || (a.fam.tier - b.fam.tier) || (a.at - b.at));

    let freed = 0, n = 0;
    for (const e of queue) {
        try { localStorage.removeItem(e.key); } catch { continue; }
        freed += e.size;
        occupato -= e.size;
        if (oltreBudget()) continue;
        // La sonda è una scrittura, quindi non la si fa a ogni voce; ma non ci
        // si fida nemmeno del solo conteggio (`freed` ignora l'overhead per
        // voce del browser): si ricontrolla quando i conti tornano, e comunque
        // ogni cinque sfratti, così si smette appena c'è posto davvero.
        if ((freed >= needed || ++n % 5 === 0) && hasRoomFor(needed)) break;
    }
    if (freed) console.info(`[storage] liberati ${Math.round(freed / 1024)} KB di cache`);
    return freed;
}

/**
 * Pulizia all'avvio: butta le versioni ritirate e assicura la riserva.
 * Va eseguita PRIMA che l'SDK Firebase apra il websocket — vedi firebase-config.js.
 */
export function sweepStorage() {
    let dropped = 0;
    try {
        for (const e of ourEntries()) {
            if (!e.retired) continue;
            localStorage.removeItem(e.key);
            dropped += e.size;
        }
        if (dropped) console.info(`[storage] rimosse cache di versioni ritirate: ${Math.round(dropped / 1024)} KB`);
        // Anche senza orfani lo spazio può essere finito: si sfratta comunque.
        evictFor(0);
    } catch (e) {
        console.warn('[storage] pulizia non riuscita:', e?.message || e);
    }
    return dropped;
}

/**
 * Scrive una voce di cache. Se non ci sta, sfratta e riprova una volta sola:
 * la rinuncia è innocua (si rifà la richiesta), ma lo storage non deve mai
 * restare senza riserva — ed è per quello che l'ultimo `evictFor` gira
 * SEMPRE, anche quando la scrittura è andata bene.
 */
export function cacheSet(key, data) {
    let payload;
    try { payload = JSON.stringify({ at: Date.now(), data }); }
    catch { return false; }

    const need = weigh(key, payload);
    if (need > MAX_ENTRY_CHARS) {
        console.warn(`[storage] ${key} pesa ${Math.round(need / 1024)} KB: troppo per la cache, non salvata`);
        return false;
    }
    let ok = false;
    try {
        localStorage.setItem(key, payload);
        ok = true;
    } catch {
        try {
            evictFor(need, key);
            localStorage.setItem(key, payload);
            ok = true;
        } catch { /* più grande della quota intera: si rinuncia */ }
        _lastReserveCheck = 0; // si è appena sfrattato: ricontrolla
    }
    if (ok && need > RESERVE_CHARS) {
        // Scrittura grossa (un anno di proiezioni): il budget va ricontrollato
        // subito, altrimenti si accumulano stagioni finché non si trova il muro.
        _lastReserveCheck = Date.now();
        evictFor(0, key);
    } else if (Date.now() - _lastReserveCheck > RESERVE_CHECK_MS) {
        _lastReserveCheck = Date.now();
        evictFor(0, key);
    }
    return ok;
}

/**
 * Legge una voce di cache non scaduta, altrimenti null.
 * `ttlMs` a Infinity per i dati che non cambiano più (una week conclusa).
 */
export function cacheGet(key, ttlMs) {
    try {
        const raw = localStorage.getItem(key);
        if (!raw) return null;
        const c = JSON.parse(raw);
        if (!c || typeof c !== 'object' || !('data' in c)) return null;
        if (ttlMs !== Infinity && Date.now() - (c.at || 0) >= ttlMs) return null;
        return c.data;
    } catch {
        return null; // corrotta: si rifà la richiesta
    }
}

/** Quanto occupano le nostre cache, per famiglia. Diagnostica da console. */
export function storageReport() {
    const rows = {};
    let total = 0;
    for (const e of ourEntries()) {
        const name = e.fam.current;
        rows[name] = rows[name] || { kb: 0, n: 0 };
        rows[name].kb += e.size / 1024;
        rows[name].n++;
        total += e.size;
    }
    Object.values(rows).forEach(r => { r.kb = Math.round(r.kb); });
    console.table(rows);
    console.info(`[storage] totale cache Topina ${Math.round(total / 1024)} KB`);
    return { total, rows };
}
