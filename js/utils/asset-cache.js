/**
 * Cache persistente per gli asset pesanti — oggi gli sfondi del Game Center,
 * che pesano ~3,5 MB l'uno e sono tredici.
 *
 * Perché non `localStorage`: là il budget totale è ~4 MB e le voci sono
 * stringhe (vedi utils/storage.js). Un solo sfondo lo riempirebbe, e a pagarla
 * sarebbe l'SDK Firebase — il guasto del 2026-08-23.
 *
 * Perché non basta la cache HTTP del browser: GitHub Pages serve gli asset con
 * un `max-age` breve, e comunque tredici file da 3,5 MB sono ~47 MB, che la
 * cache disco sfratta appena le serve spazio. Qui invece restano finché non
 * siamo NOI a cambiare versione.
 *
 * La versione sta nel NOME della cache, non nelle chiavi: bumpare
 * `FIELD_IMG_VERSION` perché sono stati sostituiti i file butta in un colpo
 * solo tutta la cache vecchia, senza lasciare in giro blob orfani (lo stesso
 * problema che in storage.js risolve `FAMILIES.stale`).
 */

const PREFIX = 'topina-assets-v';

// Un blob URL per file, riusato per tutta la sessione: crearne uno nuovo a
// ogni render li accumulerebbe senza mai liberarli.
const urls = new Map();
let sweptFor = null;

/** La cache della versione corrente; al primo giro butta quelle vecchie. */
async function bucket(version) {
    const name = PREFIX + version;
    if (sweptFor !== name) {
        sweptFor = name;
        for (const k of await caches.keys()) {
            if (k.startsWith(PREFIX) && k !== name) await caches.delete(k);
        }
    }
    return caches.open(name);
}

/**
 * URL da cui mostrare `path`: quello della copia in cache se c'è, altrimenti
 * la si scarica una volta e la si tiene. Torna sempre qualcosa di usabile —
 * dove la Cache API non c'è (Safari in navigazione privata, contesti non
 * sicuri) o fallisce, si torna al file così com'è.
 */
export async function cachedAsset(path, version) {
    if (urls.has(path)) return urls.get(path);
    if (typeof caches === 'undefined') return path;
    try {
        const cache = await bucket(version);
        let res = await cache.match(path);
        if (!res) {
            await cache.add(path);
            res = await cache.match(path);
        }
        if (!res) return path;
        const url = URL.createObjectURL(await res.blob());
        urls.set(path, url);
        return url;
    } catch {
        return path;
    }
}

/** Quanto occupano le nostre cache di asset. Diagnostica da console. */
export async function assetCacheReport() {
    if (typeof caches === 'undefined') return null;
    const rows = {};
    for (const name of await caches.keys()) {
        if (!name.startsWith(PREFIX)) continue;
        const cache = await caches.open(name);
        let kb = 0;
        const keys = await cache.keys();
        for (const req of keys) {
            const res = await cache.match(req);
            kb += ((await res.blob()).size) / 1024;
        }
        rows[name] = { file: keys.length, MB: Math.round(kb / 1024 * 10) / 10 };
    }
    console.table(rows);
    return rows;
}
