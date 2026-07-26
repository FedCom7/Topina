/**
 * Risolve lo sleeper_id (usato in tutta l'app) verso gsis_id/pfr_id
 * (usati dalle fonti nflverse/api.nfldata.org), da data/nfl/playerids.json
 * (generato da scripts/build-nflverse-features.mjs).
 */

let _map; // Promise<{ [sleeperId]: {gsis,pfr,name,pos} }> | undefined = non ancora caricata

async function load() {
    if (_map !== undefined) return _map;
    return (_map = (async () => {
        try {
            const res = await fetch('data/nfl/playerids.json');
            if (!res.ok) return {};
            const data = await res.json();
            return data.bySleeper || {};
        } catch { return {}; }
    })());
}

/** { gsis, pfr, name, pos } per uno sleeper_id, o null se non mappato. */
export async function resolvePlayerIds(sleeperId) {
    if (!sleeperId) return null;
    const map = await load();
    return map[sleeperId] || null;
}
