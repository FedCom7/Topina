/**
 * Genera data/nfl/team_trades.json — storico trade per squadra NFL (blocco
 * "Transazioni/trade" della pagina DEF). Dato storico unico (non per
 * stagione), da trades.csv (nflverse). Tenute solo le ultime 25 righe per
 * squadra per contenere la dimensione del file.
 *
 * Uso:  npm run build-nfl-trades
 */

import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { ROOT, canonAbbr, loadCsv } from './lib/nflverse.mjs';

const OUT_DIR = path.join(ROOT, 'data', 'nfl');
const MAX_PER_TEAM = 25;
const isTrue = (v) => /^true$|^1$/i.test(String(v || '').trim());

async function build() {
    const rows = await loadCsv('trades', ['trades.csv']);
    if (!rows) return null;

    const byTeam = {};
    for (const r of rows) {
        const team = canonAbbr(r.gave);
        if (!team) continue;
        (byTeam[team] ??= []).push({
            date: r.trade_date || null,
            received: canonAbbr(r.received) || r.received || null,
            player: r.pfr_name || null,
            pick: r.pick_season ? `${r.pick_season} R${r.pick_round}` : null,
            conditional: isTrue(r.conditional),
        });
    }

    const teams = {};
    for (const [team, list] of Object.entries(byTeam)) {
        list.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
        teams[team] = list.slice(0, MAX_PER_TEAM);
    }
    return { generatedAt: new Date().toISOString(), teams };
}

await mkdir(OUT_DIR, { recursive: true });
console.log('Trade storiche per squadra…');
const out = await build();
if (!out) { console.log('  nessun dato trades nflverse, interrotto.'); process.exit(1); }
const file = path.join(OUT_DIR, 'team_trades.json');
await writeFile(file, JSON.stringify(out));
console.log(`  → ${path.relative(ROOT, file)} (${Object.keys(out.teams).length} squadre)`);
