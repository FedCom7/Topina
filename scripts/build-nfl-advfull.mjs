/**
 * Genera data/nfl/advfull/{Y}.json (stagione) e data/nfl/advweek/{Y}.json
 * (settimana per settimana): TUTTE le colonne di Next Gen Stats e di PFR
 * advanced per ogni giocatore, per la pagina giocatore.
 *
 * Perché un file a parte: `adv_players_{Y}.json` (build-nflverse-features)
 * alimenta il modello — Player Context Score, SOS+, Draft Grades — e tiene
 * poche colonne scelte, già derivate. Allargarlo cambierebbe il modello e il
 * peso di ogni pagina che lo scarica. Qui invece le colonne restano quelle
 * delle fonti, con i loro nomi, e la pagina le carica solo quando si apre il
 * blocco.
 *
 * Fonti:
 *   Next Gen Stats  nextgen_stats/ngs_{passing,rushing,receiving}.csv.gz   2016–oggi
 *                   (uno storico unico; week 0 = totale di stagione)
 *   PFR advanced    pfr_advstats/advstats_season_{pass,rush,rec,def}.csv   2018–oggi
 *                   pfr_advstats/advstats_week_{pass,rush,rec,def}_{Y}.csv per partita
 *
 * Formato: `cols` una volta per tabella, righe come array, chiavi = id del
 * giocatore (gsis per NGS, pfr_id per PFR). Un giocatore può avere più righe
 * (PFR scrive una riga per squadra e una 2TM/3TM col totale).
 *
 * Uso:  node scripts/build-nfl-advfull.mjs            # stagione in corso e precedente
 *       node scripts/build-nfl-advfull.mjs 2016 … 2026
 */

import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { ROOT, fetchAsset, parseCsv } from './lib/nflverse.mjs';

const currentNflSeason = (d = new Date()) => (d.getMonth() + 1 >= 3 ? d.getFullYear() : d.getFullYear() - 1);
const PRIMA_NGS = 2016, PRIMA_PFR = 2018;
const KINDS_NGS = ['passing', 'rushing', 'receiving'];
const KINDS_PFR = ['pass', 'rush', 'rec', 'def'];

/** Numeri come numeri (4 decimali), il resto stringa, vuoto → null. */
function pulisci(v) {
    if (v === '' || v == null || v === 'NA') return null;
    if (/^-?\d+(\.\d+)?$/.test(v)) { const x = Number(v); return Number.isInteger(x) ? x : Math.round(x * 1e4) / 1e4; }
    return v;
}

const NGS_ID = new Set(['season', 'season_type', 'week', 'player_gsis_id', 'player_first_name', 'player_last_name', 'player_short_name']);
const PFR_WEEK_ID = new Set(['game_id', 'pfr_game_id', 'season', 'pfr_player_id', 'pfr_player_name']);

let _ngs = null;
/** Lo storico NGS è un file solo per tipo: si legge una volta per esecuzione. */
async function ngsTutto() {
    if (_ngs) return _ngs;
    _ngs = {};
    for (const k of KINDS_NGS) {
        const t = await fetchAsset('nextgen_stats', `ngs_${k}.csv.gz`, { ttlHours: 12 }).catch(() => null);
        _ngs[k] = t ? parseCsv(t) : [];
    }
    return _ngs;
}

async function buildSeason(Y) {
    const stagione = { generatedAt: new Date().toISOString(), season: +Y, ngs: {}, pfr: {} };
    const settimane = { generatedAt: stagione.generatedAt, season: +Y, ngs: {}, pfr: {} };
    let nStag = 0, nSett = 0;

    if (+Y >= PRIMA_NGS) {
        const ngs = await ngsTutto();
        for (const k of KINDS_NGS) {
            const rows = ngs[k].filter(r => +r.season === +Y);
            if (!rows.length) continue;
            const cols = Object.keys(rows[0]).filter(c => !NGS_ID.has(c));
            const tab = { cols: ['season_type', 'week', ...cols], rows: {} };
            const sett = { cols: ['season_type', 'week', ...cols], rows: {} };
            for (const r of rows) {
                const riga = [r.season_type, +r.week, ...cols.map(c => pulisci(r[c]))];
                const dest = +r.week === 0 ? tab : sett;
                (dest.rows[r.player_gsis_id] ??= []).push(riga);
                if (+r.week === 0) nStag++; else nSett++;
            }
            if (Object.keys(tab.rows).length) stagione.ngs[k] = tab;
            if (Object.keys(sett.rows).length) settimane.ngs[k] = sett;
        }
    }

    if (+Y >= PRIMA_PFR) {
        for (const k of KINDS_PFR) {
            // Stagione: un file con tutti gli anni (storico unico).
            const ts = await fetchAsset('pfr_advstats', `advstats_season_${k}.csv`, { ttlHours: 12 }).catch(() => null);
            if (ts) {
                const rows = parseCsv(ts).filter(r => +r.season === +Y);
                if (rows.length) {
                    const cols = Object.keys(rows[0]).filter(c => !['season', 'pfr_id', 'loaded'].includes(c));
                    const tab = { cols, rows: {} };
                    for (const r of rows) { (tab.rows[r.pfr_id] ??= []).push(cols.map(c => pulisci(r[c]))); nStag++; }
                    stagione.pfr[k] = tab;
                }
            }
            // Partita per partita: un file per anno.
            const tw = await fetchAsset('pfr_advstats', `advstats_week_${k}_${Y}.csv`, +Y === currentNflSeason() ? { ttlHours: 6 } : {}).catch(() => null);
            if (tw) {
                const rows = parseCsv(tw);
                if (rows.length) {
                    const cols = Object.keys(rows[0]).filter(c => !PFR_WEEK_ID.has(c) && c !== 'loaded');
                    const tab = { cols, rows: {} };
                    for (const r of rows) { (tab.rows[r.pfr_player_id] ??= []).push(cols.map(c => pulisci(r[c]))); nSett++; }
                    settimane.pfr[k] = tab;
                }
            }
        }
    }

    for (const [dir, dati] of [['advfull', stagione], ['advweek', settimane]]) {
        const d = path.join(ROOT, 'data', 'nfl', dir);
        await mkdir(d, { recursive: true });
        await writeFile(path.join(d, `${Y}.json`), JSON.stringify(dati));
    }
    console.log(`  ${Y}: ${nStag} righe di stagione, ${nSett} di partita`);
}

const args = process.argv.slice(2);
const cur = currentNflSeason();
const seasons = args.length ? args : [String(cur), String(cur - 1)];
console.log('NGS + PFR completi:', seasons.join(', '));
for (const y of seasons) await buildSeason(y);
