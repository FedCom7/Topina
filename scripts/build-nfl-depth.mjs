/**
 * Genera data/nfl/depth/{Y}_{TEAM}.json — il depth chart ESPN di ogni squadra
 * com'era LA MATTINA DI OGNI PARTITA, per la flip card delle gare giocate.
 *
 * ESPN espone solo il depth chart di oggi. nflverse però lo fotografa due
 * volte al giorno dal 2025 (`depth_charts_{Y}.csv`, con l'id ESPN, lo slot e
 * la profondità): per ogni partita si prende l'ultima foto prima del kickoff.
 * Così la card di una gara passata ha le stesse righe di quella in arrivo —
 * WR1/WR2/WR3, TE1, TE2… in ordine di profondità — invece di un gruppo per
 * ruolo ordinato per maglia, che è tutto ciò che dice il roster di gara.
 * Chi è davvero partito titolare e chi era inattivo lo aggiunge il client dal
 * roster di gara: qui c'è solo il piano della squadra.
 *
 * Prima del 2025 nflverse ha un formato settimanale diverso (niente slot,
 * niente id ESPN): quelle stagioni non si generano e la card resta per ruolo.
 *
 * Formato, per stare piccolo: gli slot portano solo gli id ESPN in ordine di
 * profondità, i nomi stanno una volta sola in `names`. Le chiavi degli slot
 * sono quelle dell'API (`wr1`, `lt`, `lde`, `pk`…), con i ricevitori divisi
 * per `pos_slot` esattamente come fa `teamDepth` in js/data/nfl-flip-card.js.
 *
 * Il calendario (id evento + kickoff) viene dallo scoreboard ESPN: l'id evento
 * è la chiave con cui il client chiede la card.
 *
 * Uso:  node scripts/build-nfl-depth.mjs            # solo la stagione in corso
 *       node scripts/build-nfl-depth.mjs 2025 2026
 */

import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { ROOT, canonAbbr, fetchAsset, parseCsvSelect } from './lib/nflverse.mjs';

const OUT_DIR = path.join(ROOT, 'data', 'nfl', 'depth');
const PRIMA_STAGIONE = 2025;
const SB = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard';
// Settimane per tipo di stagione: preseason, regular, playoff.
const SETTIMANE = { 1: 4, 2: 18, 3: 5 };
// Una foto più vecchia di così non è "la mattina della partita".
const MAX_ETA_MS = 8 * 24 * 3600 * 1000;

const currentNflSeason = (d = new Date()) => (d.getMonth() + 1 >= 3 ? d.getFullYear() : d.getFullYear() - 1);

async function getJson(url) {
    for (let i = 0; i < 3; i++) {
        try {
            const r = await fetch(url, { headers: { 'User-Agent': 'topina-league-build/1.0' } });
            if (r.ok) return await r.json();
            if (r.status < 500 && r.status !== 429) return null;
        } catch { /* riprova */ }
        await new Promise(res => setTimeout(res, 1000 * (i + 1)));
    }
    return null;
}

/** Partite già cominciate della stagione: id evento, kickoff, le due sigle. */
async function calendario(year) {
    const out = [];
    const ora = Date.now();
    for (const [tipo, n] of Object.entries(SETTIMANE)) {
        for (let w = 1; w <= n; w++) {
            const d = await getJson(`${SB}?dates=${year}&seasontype=${tipo}&week=${w}&limit=50`);
            for (const e of d?.events || []) {
                const kick = Date.parse(e.date);
                if (!Number.isFinite(kick) || kick > ora) continue;
                const squadre = (e.competitions?.[0]?.competitors || []).map(c => canonAbbr(c.team?.abbreviation));
                if (squadre.length === 2) out.push({ id: String(e.id), kick, squadre });
            }
        }
    }
    return out;
}

/** Righe di una foto → { scheme, offense, defense, special } con gli id per slot. */
function costruisci(righe) {
    const out = { scheme: null, offense: {}, defense: {}, special: {} };
    const perChiave = {};
    for (const r of righe) {
        const base = /^Base (\d-\d) D$/.exec(r.pos_grp || '');
        const side = r.pos_grp === 'Special Teams' ? 'special' : base ? 'defense' : 'offense';
        if (base) out.scheme = base[1];
        const key = String(r.pos_abb || '').toLowerCase();
        if (!key || !r.espn_id) continue;
        ((perChiave[side] ??= {})[key] ??= []).push(r);
    }
    for (const [side, chiavi] of Object.entries(perChiave)) {
        for (const [key, lista] of Object.entries(chiavi)) {
            const slots = [...new Set(lista.map(r => +r.pos_slot || 0))].sort((a, b) => a - b);
            slots.forEach((s, i) => {
                const ids = lista.filter(r => (+r.pos_slot || 0) === s)
                    .sort((a, b) => (+a.pos_rank || 99) - (+b.pos_rank || 99))
                    .map(r => r.espn_id);
                out[side][slots.length > 1 ? `${key}${i + 1}` : key] = [...new Set(ids)];
            });
        }
    }
    return out;
}

async function buildSeason(year) {
    if (+year < PRIMA_STAGIONE) { console.log(`  ${year}: prima del ${PRIMA_STAGIONE} il formato nflverse è un altro, salto.`); return; }
    const corrente = +year === currentNflSeason();
    const testo = await fetchAsset('depth_charts', `depth_charts_${year}.csv`, corrente ? { ttlHours: 6 } : {});
    if (!testo) { console.log(`  ${year}: depth_charts_${year}.csv non c'è.`); return; }
    const righe = parseCsvSelect(testo, ['dt', 'team', 'player_name', 'espn_id', 'pos_grp', 'pos_abb', 'pos_slot', 'pos_rank']);

    // squadra → dt → righe; e le dt di ogni squadra in ordine.
    const foto = {};
    for (const r of righe) {
        const t = canonAbbr(r.team);
        ((foto[t] ??= {})[r.dt] ??= []).push(r);
    }
    const tempi = Object.fromEntries(Object.entries(foto).map(([t, m]) =>
        [t, Object.keys(m).map(dt => [dt, Date.parse(dt)]).sort((a, b) => a[1] - b[1])]));

    const partite = await calendario(year);
    console.log(`  ${year}: ${righe.length} righe, ${Object.keys(foto).length} squadre, ${partite.length} partite cominciate`);

    const file = {};
    let mancanti = 0;
    for (const g of partite) {
        for (const t of g.squadre) {
            const lista = tempi[t] || [];
            let scelta = null;
            for (const [dt, ms] of lista) { if (ms < g.kick) scelta = [dt, ms]; else break; }
            if (!scelta || g.kick - scelta[1] > MAX_ETA_MS) { mancanti++; continue; }
            const f = (file[t] ??= { season: +year, team: t, names: {}, games: {} });
            const rr = foto[t][scelta[0]];
            for (const r of rr) if (r.espn_id) f.names[r.espn_id] = r.player_name;
            f.games[g.id] = { dt: scelta[0], ...costruisci(rr) };
        }
    }

    await mkdir(OUT_DIR, { recursive: true });
    const generatedAt = new Date().toISOString();
    for (const [t, f] of Object.entries(file)) {
        await writeFile(path.join(OUT_DIR, `${year}_${t}.json`), JSON.stringify({ generatedAt, ...f }));
    }
    console.log(`  ${year}: ${Object.keys(file).length} file, ${mancanti} squadra-partite senza foto prima del kickoff`);
}

const args = process.argv.slice(2);
// Di default solo la stagione in corso: è l'unica che cambia, e il CSV di una
// stagione intera pesa 50-60 MB.
const seasons = args.length ? args : [String(currentNflSeason())];
console.log('Depth chart del giorno della partita:', seasons.join(', '));
for (const y of seasons) await buildSeason(y);
