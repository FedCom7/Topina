/**
 * Punti fantasy REALI di ogni giocatore NFL, settimana per settimana — non
 * solo i nostri rosterati. Firebase non li ha: lì c'è solo chi era in una
 * rosa fantasy quella settimana. Servono a due cose:
 *
 *  1. Riempire i buchi "Unrostered" nel drill-down di un giocatore nostro:
 *     una settimana in cui nessuna delle 4 squadre lo aveva, i suoi punti
 *     reali esistono comunque nel mondo NFL — vedi js/sections/analysis.js.
 *  2. "Best available" a fondo Analysis: chi era il miglior libero in
 *     circolazione per ruolo, quell'anno — mai passato su nessuna delle 4
 *     rose, nemmeno per una settimana.
 *
 * Fonte: stats_player_week_{anno}.csv (nflverse, tag "stats_player" — quello
 * vecchio "player_stats" è fermo a maggio 2025, abbandonato a metà, MAI usarlo:
 * gli altri tag della release (rosters, pbp, injuries) restano aggiornati,
 * solo quello è rimasto indietro). Solo stagione regolare (season_type REG —
 * i nostri playoff usano le week 16/17 REALI di regular season, non i playoff
 * NFL veri, che vivono in season_type POST a parte). Punteggio: lo stesso
 * motore del sito (js/data/scoring.js), zero coefficienti duplicati.
 *
 * Solo QB/RB/WR/TE: K e DEF vivono in dataset nflverse diversi (kicking a
 * parte, DEF è per-squadra non per-giocatore) e non sono lo scopo di questa
 * prima versione — "il miglior libero" interessa per gli skill player.
 *
 * Uso:  npm run build-nfl-player-scores            # 2019..2025
 *       npm run build-nfl-player-scores -- 2024     # una o più stagioni
 */
import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { ROOT, loadCsv, num } from './lib/nflverse.mjs';

const OUT_DIR = path.join(ROOT, 'data', 'nfl');
const DEFAULT_SEASONS = ['2019', '2020', '2021', '2022', '2023', '2024', '2025'];
const TOP_N_PER_POSITION = 10;
const POSITIONS = ['QB', 'RB', 'WR', 'TE'];

// Stesso motore di scoring del sito: niente coefficienti duplicati qui.
const { scoreWeeklyStats } = await import(pathToFileURL(path.join(ROOT, 'js', 'data', 'scoring.js')));

// Stesso suffisso tolto da `nameKey` in lib/nflverse.mjs: nflverse scrive "Chris
// Godwin Jr." nel referto, ma la nostra Firebase per lo stesso giocatore ha
// "Chris Godwin" senza suffisso (l'inverso capita anche, es. "Marvin Harrison
// Jr." è uguale su entrambe le fonti). Senza toglierlo qui, le due chiavi
// normalizzate divergono e il giocatore sparisce silenziosamente da
// unrostered/seasonAvg/best-available: verificato su 18 dei 592 skill player
// del 2024 (Godwin compreso) che portano un suffisso in nflverse.
const norm = (s) => (s || '').toLowerCase()
    .replace(/\s+(jr|sr|ii|iii|iv|v)\.?$/i, '')
    .replace(/[^a-z]/g, '');

/** stats_player_week_{anno}.csv (nflverse) -> stessa forma di stats{} del sito. */
function toOurStats(row) {
    return {
        pass_yds: num(row.passing_yards) || 0,
        pass_td: num(row.passing_tds) || 0,
        pass_int: num(row.passing_interceptions) || 0,
        rush_yds: num(row.rushing_yards) || 0,
        rush_td: num(row.rushing_tds) || 0,
        rec: num(row.receptions) || 0,
        rec_yds: num(row.receiving_yards) || 0,
        rec_td: num(row.receiving_tds) || 0,
        // nflverse spezza i fumble persi per fase di gioco; la lega li conta insieme
        fum_lost: (num(row.sack_fumbles_lost) || 0) + (num(row.rushing_fumbles_lost) || 0) + (num(row.receiving_fumbles_lost) || 0),
        two_pt: (num(row.passing_2pt_conversions) || 0) + (num(row.rushing_2pt_conversions) || 0) + (num(row.receiving_2pt_conversions) || 0),
        // TD su ritorno kickoff/punt: fum_td (fumble offensivo portato in end zone
        // da un compagno) non ha una colonna dedicata qui, resta un gap raro e noto.
        ret_td: num(row.special_teams_tds) || 0,
    };
}

function hasRealInvolvement(s) {
    return s.pass_yds || s.pass_td || s.pass_int || s.rush_yds || s.rush_td
        || s.rec || s.rec_yds || s.rec_td || s.fum_lost || s.two_pt || s.ret_td;
}

async function loadJson(p) {
    try { return JSON.parse(await readFile(p, 'utf8')); } catch { return null; }
}

/**
 * Settimane in RISERVA INFORTUNATI, giocatore per giocatore.
 *
 * È il pezzo che mancava: il referto infortuni settimanale (injuries_*.json)
 * smette di nominare chi finisce in IR — un infortunio che chiude la stagione
 * sparisce dai dati invece di essere l'evento più grave. Malik Nabers 2025 ne
 * è l'esempio: crociato alla week 4, e nel referto restavano tre settimane
 * senza nemmeno uno stato.
 *
 * roster_weekly_{anno}.csv porta invece lo stato di rosa NFL settimana per
 * settimana. Codici verificati sui dati veri, non dedotti:
 *   R01 = Reserve/Injured           (Nabers: ACT fino a W4, R01 dalla W5)
 *   R48 = Reserve/Injured, designato al rientro
 *         (sequenza R01 → R48 → A01 su Mike Evans e Denzel Perryman)
 *
 * Due livelli, perché la fonte non è uniforme: dal 2020 in poi il codice
 * dettagliato c'è, nel 2019 la colonna è quasi tutta vuota (23.018 righe
 * senza codice) mentre `status` = RES esiste comunque. Quindi:
 *   - codice R01/R48            → "IR", sappiamo che è infortunio
 *   - qualunque altro RES       → "Reserve", sappiamo solo che non era
 *                                 disponibile, non perché (può essere PUP,
 *                                 sospensione, ritiro, o il Reserve/COVID
 *                                 del 2020)
 * Chiamare "IR" un RES generico sarebbe inventare una diagnosi.
 */
const IR_CODES = new Set(['R01', 'R48']);

function reserveLabel(row) {
    if (IR_CODES.has(row.status_description_abbr)) return 'IR';
    return row.status === 'RES' ? 'Reserve' : null;
}

async function reserveWeeksByPlayer(year, onlyThese, lastWeek) {
    const rows = await loadCsv('weekly_rosters', [`roster_weekly_${year}.csv`, `roster_weekly_${year}.csv.gz`]);
    if (!rows) return null;
    const out = {};
    for (const r of rows) {
        const label = reserveLabel(r);
        if (!label) continue;
        const week = num(r.week);
        if (!week || week > lastWeek) continue;
        const key = norm(r.full_name);
        // solo i giocatori passati dalle nostre rose: degli altri non mostriamo
        // mai lo stato, e il file resterebbe grosso per niente
        if (!key || !onlyThese.has(key)) continue;
        (out[key] ??= {})[week] = label;
    }
    return out;
}

async function buildYear(year) {
    const rows = await loadCsv('stats_player', [`stats_player_week_${year}.csv`, `stats_player_week_${year}.csv.gz`]);
    if (!rows) { console.log(`  ${year}: nessun stats_player_week nflverse, salto.`); return; }

    const fantasy = await loadJson(path.join(ROOT, 'data', 'fantasy', `fantasy_data_${year}.json`));
    if (!fantasy?.weeks) { console.log(`  ${year}: nessun fantasy_data_${year}.json, salto.`); return; }

    // Chi era in QUALCHE rosa fantasy nostra, e in quali settimane — a
    // prescindere da quale delle 4 squadre. Serve sia a sapere quali buchi
    // riempire sia a escludere chi non è affatto "libero".
    const rosteredWeeks = new Map(); // norm(nome) -> Set(settimana)
    let lastWeek = 0;
    for (const [wk, wkData] of Object.entries(fantasy.weeks)) {
        const week = Number(wk);
        for (const m of wkData.matchups || []) {
            for (const side of [m.team1, m.team2]) {
                if (!side?.name) continue;
                for (const p of [...(side.starters || []), ...(side.bench || [])]) {
                    if (!p?.name) continue;
                    const key = norm(p.name);
                    if (!rosteredWeeks.has(key)) rosteredWeeks.set(key, new Set());
                    rosteredWeeks.get(key).add(week);
                }
                if (week > lastWeek) lastWeek = week;
            }
        }
    }

    // Punti reali per giocatore/settimana, solo stagione regolare ed entro la
    // stagione fantasy (i playoff NFL veri non riguardano la nostra lega).
    const byPlayer = new Map(); // norm(nome) -> { name, pos, weeks: [...] }
    for (const r of rows) {
        if (r.season_type !== 'REG') continue;
        const week = num(r.week);
        if (!week || week > lastWeek) continue;
        const pos = (r.position || '').toUpperCase();
        if (!POSITIONS.includes(pos)) continue;
        const stats = toOurStats(r);
        if (!hasRealInvolvement(stats)) continue; // bye/inattivo quella settimana: niente riga
        const pts = scoreWeeklyStats(stats, pos) || 0;
        const key = norm(r.player_display_name || r.player_name);
        if (!key) continue;
        if (!byPlayer.has(key)) byPlayer.set(key, { name: r.player_display_name || r.player_name, pos, team: '', weeks: [] });
        const dati = byPlayer.get(key);
        if (r.team) dati.team = r.team; // l'ultima settimana vince
        dati.weeks.push({ week, opponent: r.opponent_team || '', pts: +pts.toFixed(2), stats });
    }

    // Output 1: buchi "Unrostered" dei NOSTRI giocatori — solo le settimane in
    // cui non li aveva nessuna delle 4 squadre.
    //
    // Insieme ai buchi si salva anche la MEDIA DI STAGIONE di ogni nostro
    // giocatore, [punti, partite], calcolata sulle stesse identiche regole dei
    // free agent (partite davvero giocate, bye e inattivi fuori). Serve al
    // blocco "dove cercare un rinforzo": lì un nostro titolare va confrontato
    // con un libero, e le due medie devono venire dallo stesso metro. Prima si
    // usava la media da titolare presa da Firebase, su 3-4 presenze: prendendo
    // il minimo fra campioni così piccoli usciva sempre il più sfortunato, non
    // il più debole — su Egbuka 2025 dava 5,7 contro gli 11,5 veri, e il
    // guadagno del rinforzo risultava il doppio di quello reale.
    const unrostered = {};
    const seasonAvg = {};
    for (const [key, weeksSet] of rosteredWeeks) {
        const dati = byPlayer.get(key);
        if (!dati) continue;
        const buchi = dati.weeks.filter(w => !weeksSet.has(w.week));
        if (buchi.length) unrostered[key] = buchi;
        const tot = dati.weeks.reduce((s, w) => s + w.pts, 0);
        if (dati.weeks.length) seasonAvg[key] = [+tot.toFixed(2), dati.weeks.length];
    }

    // Output 2: i migliori LIBERI ADESSO, per ruolo — chi nell'ultima giornata
    // disputata non era in nessuna delle 4 rose. Non "mai passato da nessuno":
    // la domanda utile è chi si può prendere oggi, e un giocatore forte
    // svincolato a metà stagione è esattamente il caso che interessa.
    // Solo la top N: il resto non ci interessa e appesantirebbe il repo.
    const liberiOra = new Set();
    for (const [key, settimane] of rosteredWeeks) {
        if (settimane.has(lastWeek)) liberiOra.add(key);
    }
    const candidatiPerRuolo = { QB: [], RB: [], WR: [], TE: [] };
    for (const [key, dati] of byPlayer) {
        if (liberiOra.has(key)) continue; // in rosa nell'ultima giornata: non è libero
        const totPts = dati.weeks.reduce((s, w) => s + w.pts, 0);
        candidatiPerRuolo[dati.pos].push({ name: dati.name, team: dati.team, totPts: +totPts.toFixed(2), weeks: dati.weeks });
    }
    const bestAvailable = {};
    let totCandidati = 0;
    for (const pos of POSITIONS) {
        candidatiPerRuolo[pos].sort((a, b) => b.totPts - a.totPts);
        totCandidati += candidatiPerRuolo[pos].length;
        bestAvailable[pos] = candidatiPerRuolo[pos].slice(0, TOP_N_PER_POSITION);
    }

    // Output 3: settimane in riserva (IR o generica) dei nostri giocatori.
    const irWeeks = await reserveWeeksByPlayer(year, new Set(rosteredWeeks.keys()), lastWeek);

    await mkdir(OUT_DIR, { recursive: true });
    await writeFile(path.join(OUT_DIR, `unrostered_scores_${year}.json`),
        JSON.stringify({ season: +year, generatedAt: new Date().toISOString(), players: unrostered, seasonAvg }));
    await writeFile(path.join(OUT_DIR, `best_available_${year}.json`),
        JSON.stringify({ season: +year, generatedAt: new Date().toISOString(), byPosition: bestAvailable }));
    if (irWeeks) {
        await writeFile(path.join(OUT_DIR, `player_status_${year}.json`),
            JSON.stringify({ season: +year, generatedAt: new Date().toISOString(), players: irWeeks }));
    }

    console.log(`  ${year}: ${Object.keys(unrostered).length} nostri giocatori con buchi riempiti — `
        + `top ${TOP_N_PER_POSITION}/ruolo su ${totCandidati} liberi candidati — `
        + (irWeeks ? `${Object.keys(irWeeks).length} con settimane in riserva` : 'roster settimanali non disponibili'));
}

const seasons = process.argv.slice(2).filter(a => /^\d{4}$/.test(a));
for (const season of (seasons.length ? seasons : DEFAULT_SEASONS)) {
    console.log(`Stagione ${season}…`);
    await buildYear(season);
}
