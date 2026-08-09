/**
 * Genera data/nfl/adp_ffc_{Y}.json — ADP di consenso CON DISPERSIONE dalla
 * Fantasy Football Calculator API (formato PPR, come la lega).
 *
 * A differenza dell'ADP secco di Sleeper (un solo numero), FFC dà per ogni
 * giocatore: adp medio, deviazione standard, high/low e numero di draft
 * (sample size) + finestra temporale. Serve al Draft Score v2 per misurare
 * reach/steal in DEVIAZIONI STANDARD invece che in "pick grezze" — molto più
 * solido statisticamente (FASE 10.7 del piano) — e per pesare la confidenza.
 *
 * Fonte: https://fantasyfootballcalculator.com/api/v1/adp/ppr?teams=12&year=Y
 * (API pubblica). NB: verificare i ToS FFC per l'uso; nessun secret richiesto.
 * Degradazione graceful: se il file manca, l'engine usa l'ADP Sleeper grezzo.
 *
 * Uso:  node scripts/build-adp-ffc.mjs            # 2019..2025
 *       node scripts/build-adp-ffc.mjs 2024 2025  # stagioni specifiche
 */

import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { ROOT } from './lib/nflverse.mjs';

const OUT_DIR = path.join(ROOT, 'data', 'nfl');
const DEFAULT_SEASONS = ['2019', '2020', '2021', '2022', '2023', '2024', '2025'];

const normName = (n) => (n || '').toLowerCase().replace(/[.,']/g, '').replace(/\s+/g, ' ').trim();
// FFC usa DEF/PK; li mappo sui codici della lega (DEF resta DEF, PK→K)
const normPos = (p) => { const u = (p || '').toUpperCase(); return u === 'PK' ? 'K' : (u === 'DST' || u === 'D/ST') ? 'DEF' : u; };

async function buildSeason(year) {
    const url = `https://fantasyfootballcalculator.com/api/v1/adp/ppr?teams=12&year=${year}`;
    let json;
    try {
        const res = await fetch(url, { headers: { 'User-Agent': 'topina-league-build/1.0' } });
        if (!res.ok) { console.warn(`  ${year}: HTTP ${res.status}`); return null; }
        json = await res.json();
    } catch (e) { console.warn(`  ${year}: ${e.message}`); return null; }
    if (json.status !== 'Success' || !Array.isArray(json.players)) { console.warn(`  ${year}: payload inatteso`); return null; }

    const players = {};
    for (const p of json.players) {
        const pos = normPos(p.position);
        if (!pos) continue;
        const key = `${normName(p.name)}|${pos}`;
        // in caso di collisione tieni chi ha più draft (dato più affidabile)
        if (players[key] && (players[key].timesDrafted || 0) >= (p.times_drafted || 0)) continue;
        players[key] = {
            name: p.name, pos, team: p.team || '',
            adp: p.adp ?? null,
            stdev: p.stdev ?? null,
            high: p.high ?? null,
            low: p.low ?? null,
            timesDrafted: p.times_drafted ?? null,
        };
    }

    const out = {
        season: +year,
        source: 'fantasyfootballcalculator',
        format: 'ppr',
        generatedAt: new Date().toISOString(),
        meta: {
            teams: json.meta?.teams ?? 12,
            rounds: json.meta?.rounds ?? null,
            totalDrafts: json.meta?.total_drafts ?? null,
            startDate: json.meta?.start_date ?? null,
            endDate: json.meta?.end_date ?? null,
        },
        count: Object.keys(players).length,
        players,
    };
    return out;
}

async function run() {
    const seasons = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_SEASONS;
    await mkdir(OUT_DIR, { recursive: true });
    for (const y of seasons) {
        const data = await buildSeason(y);
        if (!data) { console.log(`  ${y}: saltato (nessun dato)`); continue; }
        await writeFile(path.join(OUT_DIR, `adp_ffc_${y}.json`), JSON.stringify(data));
        console.log(`→ adp_ffc_${y}.json — ${data.count} giocatori, ${data.meta.totalDrafts ?? '?'} draft (${data.meta.startDate ?? '?'}→${data.meta.endDate ?? '?'})`);
    }
}

await run();
