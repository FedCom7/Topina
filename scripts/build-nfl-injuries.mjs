/**
 * Genera data/nfl/injuries_{Y}.json — cronologia settimanale COMPLETA degli
 * infortuni per giocatore e squadra NFL nella stagione (non solo l'ultimo
 * report), per il blocco "Infermeria squadra" della pagina giocatore/DEF:
 * serve a capire QUANDO un giocatore si è fatto male, che infortunio, e se
 * è poi rientrato (assenza dai report successivi = tornato a pieno regime).
 *
 * Fonte: injuries_{Y}.csv (nflverse), via scripts/lib/nflverse.mjs.
 * Se il file della stagione manca (es. corrente non ancora rilasciata),
 * il client fa fallback live su ESPN — vedi js/data/nfl-team-extras.js.
 *
 * Uso:  npm run build-nfl-injuries            # 2019..2025
 *       npm run build-nfl-injuries -- 2024    # una o più stagioni
 */

import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { ROOT, canonAbbr, loadCsv, num } from './lib/nflverse.mjs';

const OUT_DIR = path.join(ROOT, 'data', 'nfl');
const DEFAULT_SEASONS = ['2019', '2020', '2021', '2022', '2023', '2024', '2025'];

async function buildSeason(year) {
    const rows = await loadCsv('injuries', [`injuries_${year}.csv`]);
    if (!rows) return null;

    // Una entry per gsis per team, con TUTTE le settimane in cui è comparso
    // nel report (non solo l'ultima) — la progressione dell'infortunio.
    const byTeam = {};
    for (const r of rows) {
        const gsis = r.gsis_id || '';
        const team = canonAbbr(r.team);
        if (!gsis || !team) continue;
        const list = (byTeam[team] ??= {});
        const p = (list[gsis] ??= { gsis, name: r.full_name || '', pos: (r.position || '').toUpperCase(), weeks: [] });
        p.weeks.push({
            week: num(r.week),
            status: r.report_status || null,
            primaryInjury: r.report_primary_injury || null,
            secondaryInjury: r.report_secondary_injury || null,
            practiceStatus: r.practice_status || null,
            // designazione in allenamento: può differire dal report ufficiale
            // (es. problema cronico gestito a parte dall'infortunio da referto)
            practicePrimaryInjury: r.practice_primary_injury || null,
            practiceSecondaryInjury: r.practice_secondary_injury || null,
            dateModified: r.date_modified || null,
        });
    }

    const teams = {};
    for (const [team, byGsis] of Object.entries(byTeam)) {
        teams[team] = Object.values(byGsis).map(p => {
            p.weeks.sort((a, b) => (a.week || 0) - (b.week || 0));
            const last = p.weeks[p.weeks.length - 1];
            // campi "piatti" per compatibilità con chi legge solo l'ultimo stato
            return {
                ...p, week: last.week, status: last.status,
                primaryInjury: last.primaryInjury, secondaryInjury: last.secondaryInjury,
                practiceStatus: last.practiceStatus,
            };
        }).sort((a, b) => (b.week || 0) - (a.week || 0));
    }
    return { season: +year, generatedAt: new Date().toISOString(), teams };
}

const seasons = process.argv.slice(2).filter(a => /^\d{4}$/.test(a));
await mkdir(OUT_DIR, { recursive: true });
for (const season of (seasons.length ? seasons : DEFAULT_SEASONS)) {
    console.log(`Stagione ${season}…`);
    const out = await buildSeason(season);
    if (!out) { console.log(`  ${season}: nessun report infortuni nflverse, salto.`); continue; }
    const file = path.join(OUT_DIR, `injuries_${season}.json`);
    await writeFile(file, JSON.stringify(out));
    console.log(`  → ${path.relative(ROOT, file)} (${Object.keys(out.teams).length} squadre)`);
}
