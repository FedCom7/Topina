/**
 * Core condiviso per scaricare e leggere i dati aperti nflverse-data
 * (release GitHub, CSV/CSV.gz). Usato dalle pipeline offline
 * build-nflverse-features.mjs e build-draft-model.mjs.
 *
 * I dati grezzi vengono messi in cache su disco in .nflverse-cache/ (gitignored,
 * effimera): mai committati. Gli script committano solo i JSON derivati compatti.
 *
 * Fonte: https://github.com/nflverse/nflverse-data/releases/download/{tag}/{file}
 * Colonne verificate sull'API live (luglio 2026).
 */

import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import zlib from 'node:zlib';
import path from 'node:path';

export const ROOT = path.resolve(new URL('.', import.meta.url).pathname, '..', '..');
export const CACHE_DIR = path.join(ROOT, '.nflverse-cache');
const BASE = 'https://github.com/nflverse/nflverse-data/releases/download';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/** Canonicalizzazione abbreviazioni squadra (stessa di build-nfl-team-stats.mjs). */
const ALIAS = { WSH: 'WAS', JAC: 'JAX', LA: 'LAR', STL: 'LAR', SD: 'LAC', OAK: 'LV' };
export const canonAbbr = (a) => { const u = (a || '').toUpperCase().trim(); return ALIAS[u] || u; };

/**
 * Scarica (con cache su disco + retry) un asset di release e ritorna il testo.
 * `noCache: true` per file enormi (play-by-play): scarica ed elabora in RAM
 * senza scrivere su disco, così la cache resta piccola.
 */
export async function fetchAsset(tag, file, { tries = 3, ttlHours = 24 * 30, noCache = false } = {}) {
    const url = `${BASE}/${tag}/${file}`;
    const cacheFile = path.join(CACHE_DIR, tag, file.replace(/\.gz$/, ''));

    // cache hit se il file esiste ed è abbastanza fresco
    if (!noCache) {
        try {
            const st = await stat(cacheFile);
            if (Date.now() - st.mtimeMs < ttlHours * 3600 * 1000) {
                return await readFile(cacheFile, 'utf8');
            }
        } catch { /* miss */ }
    }

    for (let i = 0; i < tries; i++) {
        try {
            const res = await fetch(url, { headers: { 'User-Agent': 'topina-league-build/1.0' } });
            if (res.status === 404) return null;
            if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
            if (!res.ok) return null;
            const buf = Buffer.from(await res.arrayBuffer());
            const text = file.endsWith('.gz') ? zlib.gunzipSync(buf).toString('utf8') : buf.toString('utf8');
            if (!noCache) {
                await mkdir(path.dirname(cacheFile), { recursive: true });
                await writeFile(cacheFile, text);
            }
            return text;
        } catch (e) {
            if (i === tries - 1) throw e;
            await sleep(1200 * (i + 1));
        }
    }
    return null;
}

/**
 * Prova più nomi file per lo stesso dataset (preferendo .csv poi .csv.gz) e
 * ritorna le righe parse. `null` se nessun candidato esiste.
 */
export async function loadCsv(tag, candidates, opts) {
    const files = Array.isArray(candidates) ? candidates : [candidates];
    for (const f of files) {
        const text = await fetchAsset(tag, f, opts);
        if (text) return parseCsv(text);
    }
    return null;
}

/**
 * Parser CSV robusto (RFC4180: campi quotati, virgole e newline dentro le
 * virgolette, doppie virgolette come escape). Ritorna array di oggetti.
 * I valori numerici restano stringhe: la conversione la fa il chiamante.
 */
export function parseCsv(text) {
    const rows = [];
    let field = '', row = [], inQuotes = false;
    // normalizza CRLF
    const s = text.charCodeAt(text.length - 1) === 10 ? text : text + '\n';
    for (let i = 0; i < s.length; i++) {
        const c = s[i];
        if (inQuotes) {
            if (c === '"') {
                if (s[i + 1] === '"') { field += '"'; i++; }
                else inQuotes = false;
            } else field += c;
        } else if (c === '"') {
            inQuotes = true;
        } else if (c === ',') {
            row.push(field); field = '';
        } else if (c === '\n') {
            row.push(field); field = '';
            if (row.length > 1 || row[0] !== '') rows.push(row);
            row = [];
        } else if (c === '\r') {
            // ignora: gestito dal \n successivo
        } else field += c;
    }
    if (!rows.length) return [];
    const header = rows[0];
    const out = new Array(rows.length - 1);
    for (let r = 1; r < rows.length; r++) {
        const obj = {};
        const cur = rows[r];
        for (let c = 0; c < header.length; c++) obj[header[c]] = cur[c] ?? '';
        out[r - 1] = obj;
    }
    return out;
}

/**
 * Come parseCsv ma tiene solo le colonne richieste, restituendo array di
 * oggetti con quei soli campi. Pensato per file enormi (play-by-play): evita
 * di costruire oggetti da centinaia di colonne. `wanted` = array di nomi.
 */
export function parseCsvSelect(text, wanted) {
    const want = new Set(wanted);
    const rows = [];
    const s = text.charCodeAt(text.length - 1) === 10 ? text : text + '\n';
    let field = '', inQuotes = false, col = 0, seen = false;
    let header = null, headerBuf = [], keepIdx = null, obj = {};

    const commitField = () => {
        if (header === null) headerBuf.push(field);
        else if (keepIdx.has(col)) obj[header[col]] = field;
        field = ''; col++;
    };
    const commitRow = () => {
        commitField();
        if (header === null) {
            header = headerBuf;
            keepIdx = new Set();
            header.forEach((h, i) => { if (want.has(h)) keepIdx.add(i); });
        } else if (seen) {
            rows.push(obj); obj = {};
        }
        col = 0; seen = false;
    };

    for (let i = 0; i < s.length; i++) {
        const c = s[i];
        if (inQuotes) {
            if (c === '"') { if (s[i + 1] === '"') { field += '"'; i++; } else inQuotes = false; }
            else field += c;
        } else if (c === '"') { inQuotes = true; seen = true; }
        else if (c === ',') { seen = true; commitField(); }
        else if (c === '\n') commitRow();
        else if (c !== '\r') { field += c; seen = true; }
    }
    return rows;
}

/** Numero o null (stringa vuota / NA → null). */
export const num = (v) => {
    if (v == null || v === '' || v === 'NA' || v === 'NaN') return null;
    const n = +v;
    return Number.isNaN(n) ? null : n;
};

/**
 * Mappa identità per stagione da roster_{Y}.csv: contiene insieme
 * gsis_id + sleeper_id + pfr_id + nome + ruolo + squadra + years_exp.
 * È il ponte fra i vari dataset (snap/pfr usano pfr_id o nome; l'app usa
 * lo sleeper_id; le stat/NGS usano il gsis_id).
 *
 * Ritorna { byGsis, bySleeper, byPfr, byNameKey } con record:
 *   { gsis, sleeper, pfr, name, pos, team, yearsExp, rookieYear, birth }
 */
export async function loadIdMap(year) {
    const rows = await loadCsv('rosters', [`roster_${year}.csv`, `roster_${year}.csv.gz`]);
    if (!rows) return null;
    const rec = {};
    const byGsis = {}, bySleeper = {}, byPfr = {}, byNameKey = {};
    for (const r of rows) {
        const gsis = r.gsis_id || '';
        if (!gsis) continue;
        // una entry per gsis (l'ultima settimana vince: team più recente)
        const e = rec[gsis] ??= {
            gsis,
            sleeper: r.sleeper_id || null,
            pfr: r.pfr_id || null,
            name: r.full_name || r.football_name || '',
            pos: (r.position || '').toUpperCase(),
            team: canonAbbr(r.team),
            yearsExp: num(r.years_exp),
            rookieYear: num(r.rookie_year) ?? num(r.entry_year),
            birth: r.birth_date || null,
        };
        if (!e.sleeper && r.sleeper_id) e.sleeper = r.sleeper_id;
        if (!e.pfr && r.pfr_id) e.pfr = r.pfr_id;
    }
    for (const e of Object.values(rec)) {
        byGsis[e.gsis] = e;
        if (e.sleeper) bySleeper[e.sleeper] = e;
        if (e.pfr) byPfr[e.pfr] = e;
        byNameKey[nameKey(e.name, e.pos)] = e;
    }
    return { byGsis, bySleeper, byPfr, byNameKey, all: Object.values(rec) };
}

/** Chiave nome normalizzata (stessa logica di projections.js normName). */
export function nameKey(name, pos) {
    const n = (name || '')
        .toLowerCase()
        .replace(/[.'`]/g, '')
        .replace(/\s+(jr|sr|ii|iii|iv|v)$/i, '')
        .replace(/[^a-z\s-]/g, '')
        .trim();
    return `${n}|${(pos || '').toUpperCase()}`;
}
