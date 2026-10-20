/**
 * Genera la sala video: data/nfl/plays/{Y}/index.json + {Y}/{game_id}.json,
 * una partita per file, OGNI giocata con OGNI campo delle tre fonti nflverse
 * che lavorano giocata per giocata:
 *   play-by-play   tutte le 372 colonne, coi loro nomi
 *   participation  tutte le colonne, prefissate `part_` (2016–2025; dal 2023
 *                  coi 22 in campo per nome, ruolo e numero)
 *   FTN charting   tutte le colonne, prefissate `ftn_` (dal 2022)
 * Gli stessi nomi che legge js/data/tactics-catalog.js: i filtri della sala
 * video sono le dimensioni di Tactics, applicate alle singole giocate.
 *
 * Stagioni: dal 2023 (deciso con l'utente il 2026-10-19 — prima la
 * participation non ha i nomi dei 22, e il peso raddoppierebbe).
 *
 * Formato compatto, senza togliere niente: i nomi di colonna stanno una volta
 * sola in index.json, e ogni partita salva le colonne così —
 *   {k: v}        stesso valore su tutte le giocate (stadio, meteo, coach…)
 *   {s: {i: v}}   valore solo su poche giocate (laterali, falli, ritorni…)
 *   {a: [...]}    valore su quasi tutte
 * Una colonna sempre vuota in quella partita non si scrive. I numeri escono
 * come numeri, con al massimo 4 decimali (EPA e probabilità ne hanno 15).
 *
 * Uso:  node scripts/build-nfl-plays.mjs            # stagione in corso
 *       node scripts/build-nfl-plays.mjs 2023 2024 2025 2026
 */

import { writeFile, mkdir, readdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import { ROOT, fetchAsset } from './lib/nflverse.mjs';

const OUT = path.join(ROOT, 'data', 'nfl', 'plays');
const PRIMA = 2023;
const currentNflSeason = (d = new Date()) => (d.getMonth() + 1 >= 3 ? d.getFullYear() : d.getFullYear() - 1);

/** CSV → { header, rows } con le righe come ARRAY: con 372 colonne per
 *  50 mila giocate, un oggetto per riga non starebbe in memoria. */
function righe(text) {
    const rows = [];
    let field = '', row = [], q = false;
    const s = text.endsWith('\n') ? text : text + '\n';
    for (let i = 0; i < s.length; i++) {
        const c = s[i];
        if (q) {
            if (c === '"') { if (s[i + 1] === '"') { field += '"'; i++; } else q = false; }
            else field += c;
        } else if (c === '"') q = true;
        else if (c === ',') { row.push(field); field = ''; }
        else if (c === '\n') { row.push(field); field = ''; if (row.length > 1 || row[0] !== '') rows.push(row); row = []; }
        else if (c !== '\r') field += c;
    }
    return { header: rows[0] || [], rows: rows.slice(1) };
}

const NUM = /^-?(0|[1-9]\d*)(\.\d+)?([eE]-?\d+)?$/;
/** Valore pulito: vuoto/NA → null, numeri → numeri (4 decimali al massimo). */
function pulisci(v) {
    if (v === '' || v === 'NA' || v == null) return null;
    if (NUM.test(v)) {
        const x = Number(v);
        if (!Number.isFinite(x)) return v;
        return Number.isInteger(x) ? x : Math.round(x * 1e4) / 1e4;
    }
    return v;
}

function codifica(valori) {
    const n = valori.length;
    let pieni = 0, primo, uguali = true;
    for (const v of valori) {
        if (v == null) { uguali = false; continue; }
        if (pieni === 0) primo = v; else if (v !== primo) uguali = false;
        pieni++;
    }
    if (!pieni) return null;
    if (uguali && pieni === n) return { k: primo };
    if (pieni < n / 3) {
        const s = {};
        valori.forEach((v, i) => { if (v != null) s[i] = v; });
        return { s };
    }
    return { a: valori };
}

async function buildSeason(Y) {
    if (+Y < PRIMA) { console.log(`  ${Y}: la sala video parte dal ${PRIMA}.`); return; }
    const corrente = +Y === currentNflSeason();
    const fresco = corrente ? { ttlHours: 6 } : {};
    const tPbp = await fetchAsset('pbp', `play_by_play_${Y}.csv.gz`, fresco).catch(() => null);
    if (!tPbp) { console.log(`  ${Y}: play-by-play assente.`); return; }
    const pbp = righe(tPbp);
    const tPart = await fetchAsset('pbp_participation', `pbp_participation_${Y}.csv`, fresco).catch(() => null);
    const part = tPart ? righe(tPart) : { header: [], rows: [] };
    const tFtn = await fetchAsset('ftn_charting', `ftn_charting_${Y}.csv`, fresco).catch(() => null);
    const ftn = tFtn ? righe(tFtn) : { header: [], rows: [] };

    // Colonne finali: pbp, poi part_*, poi ftn_* (senza le chiavi di aggancio,
    // che ripeterebbero game_id e play_id).
    const partSkip = new Set(['nflverse_game_id', 'old_game_id', 'play_id']);
    const ftnSkip = new Set(['nflverse_game_id', 'nflverse_play_id', 'season', 'week']);
    const partCols = part.header.map((c, i) => [c, i]).filter(([c]) => !partSkip.has(c));
    const ftnCols = ftn.header.map((c, i) => [c, i]).filter(([c]) => !ftnSkip.has(c));
    const cols = [...pbp.header, ...partCols.map(([c]) => `part_${c}`), ...ftnCols.map(([c]) => `ftn_${c}`)];
    const fonti = { pbp: [0, pbp.header.length], part: [pbp.header.length, pbp.header.length + partCols.length], ftn: [pbp.header.length + partCols.length, cols.length] };

    const H = Object.fromEntries(pbp.header.map((c, i) => [c, i]));
    const pk = (h, gameCol, playCol) => { const g = h.header.indexOf(gameCol), p = h.header.indexOf(playCol); return (r) => `${r[g]}_${r[p]}`; };
    const partByKey = new Map(); if (part.rows.length) { const k = pk(part, 'nflverse_game_id', 'play_id'); for (const r of part.rows) partByKey.set(k(r), r); }
    const ftnByKey = new Map(); if (ftn.rows.length) { const k = pk(ftn, 'nflverse_game_id', 'nflverse_play_id'); for (const r of ftn.rows) ftnByKey.set(k(r), r); }

    // Giocate per partita, nell'ordine del pbp.
    const perPartita = new Map();
    for (const r of pbp.rows) {
        const g = r[H.game_id];
        if (!perPartita.has(g)) perPartita.set(g, []);
        perPartita.get(g).push(r);
    }

    const dir = path.join(OUT, String(Y));
    await mkdir(dir, { recursive: true });
    // File di partite che non esistono più (rinvii, id cambiati) via.
    const vecchi = new Set((await readdir(dir).catch(() => [])).filter(f => f !== 'index.json'));
    const indice = [];
    let byte = 0;
    for (const [g, plays] of perPartita) {
        const n = plays.length;
        const colonne = cols.map(() => new Array(n));
        plays.forEach((r, i) => {
            for (let c = 0; c < pbp.header.length; c++) colonne[c][i] = pulisci(r[c]);
            const key = `${g}_${r[H.play_id]}`;
            const p = partByKey.get(key), f = ftnByKey.get(key);
            let c = pbp.header.length;
            for (const [, j] of partCols) colonne[c++][i] = p ? pulisci(p[j]) : null;
            for (const [, j] of ftnCols) colonne[c++][i] = f ? pulisci(f[j]) : null;
        });
        const c = {};
        colonne.forEach((vals, idx) => { const e = codifica(vals); if (e) c[idx] = e; });
        const testo = JSON.stringify({ g, n, c });
        byte += testo.length;
        const file = `${g}.json`;
        vecchi.delete(file);
        await writeFile(path.join(dir, file), testo);
        const r0 = plays[0], rN = plays[n - 1];
        indice.push({
            id: g, week: +r0[H.week], type: r0[H.season_type], date: r0[H.game_date],
            home: r0[H.home_team], away: r0[H.away_team],
            hs: pulisci(rN[H.total_home_score]), as: pulisci(rN[H.total_away_score]),
            plays: n, part: plays.some(r => partByKey.has(`${g}_${r[H.play_id]}`)), ftn: plays.some(r => ftnByKey.has(`${g}_${r[H.play_id]}`)),
        });
    }
    for (const f of vecchi) await unlink(path.join(dir, f));
    indice.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id.localeCompare(b.id)));
    await writeFile(path.join(dir, 'index.json'), JSON.stringify({ generatedAt: new Date().toISOString(), season: +Y, cols, fonti, games: indice }));
    console.log(`  ${Y}: ${indice.length} partite, ${(byte / 1e6).toFixed(1)} MB (media ${(byte / indice.length / 1e3).toFixed(0)} KB)`);
}

const args = process.argv.slice(2);
const seasons = args.length ? args : [String(currentNflSeason())];
console.log('Sala video:', seasons.join(', '));
for (const y of seasons) await buildSeason(y);
