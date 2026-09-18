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
 * Alla STAGIONE IN CORSO si attacca anche il dettaglio ESPN (`espn`): parte
 * del corpo, tipo di infortunio, lato e data di rientro stimata — roba che il
 * referto nflverse non ha. Si prende QUI e non dal browser perché ESPN manda
 * gli header CORS solo alle richieste senza Origin: dal browser, sito
 * pubblicato compreso, `site.api.espn.com` è chiuso. Una chiamata sola per
 * tutta la lega, e copre solo chi ha notizie recenti (una quarantina di casi):
 * è un di più sulla card, mai la fonte di chi è infortunato.
 *
 * Uso:  npm run build-nfl-injuries            # 2019..2025
 *       npm run build-nfl-injuries -- 2024    # una o più stagioni
 */

import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { ROOT, canonAbbr, loadCsv, num } from './lib/nflverse.mjs';

const OUT_DIR = path.join(ROOT, 'data', 'nfl');
const DEFAULT_SEASONS = ['2019', '2020', '2021', '2022', '2023', '2024', '2025'];

/** Stagione NFL in corso — stessa regola di js/data/nfl-team-extras.js. */
const currentNflSeason = (d = new Date()) => (d.getMonth() + 1 >= 3 ? d.getFullYear() : d.getFullYear() - 1);

const normName = (n) => (n || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim();

/**
 * Dettaglio infortuni ESPN per squadra e nome normalizzato.
 * La sigla della squadra NON sta sul gruppo (che ha solo id e nome esteso) ma
 * dentro ogni voce, in `athlete.team.abbreviation`.
 */
async function loadEspnDetails() {
    try {
        const res = await fetch('https://site.api.espn.com/apis/site/v2/sports/football/nfl/injuries',
            { headers: { 'User-Agent': 'topina-league-build/1.0' } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const d = await res.json();
        const byTeam = {};
        let n = 0;
        for (const t of d?.injuries || []) {
            for (const i of t.injuries || []) {
                const A = canonAbbr(i.athlete?.team?.abbreviation || '');
                const nome = i.athlete?.displayName || i.athlete?.fullName;
                if (!A || !nome) continue;
                const det = i.details || {};
                (byTeam[A] ??= {})[normName(nome)] = {
                    status: i.status || null,
                    type: det.type || null,
                    location: det.location || null,
                    detail: det.detail && det.detail !== 'Not Specified' ? det.detail : null,
                    side: det.side && det.side !== 'Not Specified' ? det.side : null,
                    returnDate: det.returnDate || null,
                    comment: i.shortComment || null,
                };
                n++;
            }
        }
        console.log(`  dettaglio ESPN: ${n} voci su ${Object.keys(byTeam).length} squadre`);
        return byTeam;
    } catch (e) {
        console.log(`  dettaglio ESPN non disponibile (${e.message}): il report resta quello nflverse.`);
        return {};
    }
}

async function buildSeason(year) {
    const rows = await loadCsv('injuries', [`injuries_${year}.csv`]);
    if (!rows) return null;
    // Il feed ESPN descrive ADESSO: su una stagione passata direbbe bugie.
    const espn = +year === currentNflSeason() ? await loadEspnDetails() : {};

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
                espn: espn[team]?.[normName(p.name)] || null,
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
