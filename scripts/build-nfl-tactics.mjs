/**
 * Genera data/nfl/tactics/{Y}/{TEAM}.json e data/nfl/tactics/{Y}/league.json:
 * come gioca ogni squadra NFL, in attacco e in difesa, con TUTTI i dati di
 * schema e stile che nflverse pubblica. Alimenta la sezione #nfl-tactics.
 *
 * Fonti, agganciate giocata per giocata (partita + id della giocata):
 *   play-by-play   pbp/play_by_play_{Y}.csv.gz            1999–oggi
 *   participation  pbp_participation/pbp_participation_{Y}.csv   2016–2025
 *   FTN charting   ftn_charting/ftn_charting_{Y}.csv      2022–oggi
 * e per giocatore (la parte "chi esegue"):
 *   Next Gen Stats nextgen_stats/ngs_{passing,rushing,receiving}.csv.gz
 *   PFR advanced   pfr_advstats/advstats_season_{pass,rush,rec,def}.csv
 *   snap count     snap_counts/snap_counts_{Y}.csv
 *
 * Le dimensioni (cosa si conta e come si raggruppa) NON stanno qui: stanno in
 * js/data/tactics-catalog.js, letto anche dalla pagina. Per ogni dimensione e
 * valore si salvano le somme grezze — giocate, EPA, successi, yard, primi
 * down, TD, palle perse, giocate esplosive — e i rank fra le 32: la pagina
 * calcola quote e medie, così nessun arrotondamento si somma due volte.
 *
 * "Attacco" = la squadra ha la palla (posteam), "difesa" = la subisce
 * (defteam). Le giocate sono quelle da scrimmage (passaggio o corsa, EPA
 * presente, niente conversioni da due); falli e decisioni sul 4° down hanno
 * contatori loro, perché lì la giocata da scrimmage spesso non c'è.
 *
 * Uso:  node scripts/build-nfl-tactics.mjs            # stagione in corso
 *       node scripts/build-nfl-tactics.mjs 2016 2017 … # stagioni a scelta
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { ROOT, canonAbbr as canon0, fetchAsset, parseCsvSelect, parseCsv } from './lib/nflverse.mjs';

const { DIMS } = await import(pathToFileURL(path.join(ROOT, 'js', 'data', 'tactics-catalog.js')));

const OUT = path.join(ROOT, 'data', 'nfl', 'tactics');
const PRIMA = 2016;
const currentNflSeason = (d = new Date()) => (d.getMonth() + 1 >= 3 ? d.getFullYear() : d.getFullYear() - 1);
// PFR scrive alcune sigle a modo suo (LVR); il resto lo sistema canonAbbr.
const canon = (a) => canon0(({ LVR: 'LV', GNB: 'GB', KAN: 'KC', NWE: 'NE', NOR: 'NO', SFO: 'SF', TAM: 'TB', SDG: 'LAC', STL: 'LAR' })[a] || a);

const r2 = (v) => Math.round(v * 100) / 100;
const r3 = (v) => Math.round(v * 1000) / 1000;
const num = (v) => (v === '' || v == null || v === 'NA' ? null : Number(v));

const PBP_COLS = ['game_id', 'play_id', 'posteam', 'defteam', 'season_type', 'week', 'play_type', 'pass', 'rush',
    'play_deleted', 'two_point_attempt', 'epa', 'success', 'yards_gained', 'first_down', 'touchdown', 'interception',
    'fumble_lost', 'sack', 'shotgun', 'no_huddle', 'qb_dropback', 'qb_scramble', 'pass_length', 'pass_location',
    'air_yards', 'yards_after_catch', 'run_location', 'run_gap', 'down', 'ydstogo', 'yardline_100', 'qtr',
    'score_differential', 'half_seconds_remaining', 'game_seconds_remaining', 'cpoe', 'xpass', 'pass_oe',
    'xyac_mean_yardage', 'complete_pass', 'pass_attempt', 'qb_hit', 'penalty', 'penalty_team', 'penalty_type',
    'penalty_yards', 'fixed_drive', 'fixed_drive_result', 'drive_play_count', 'drive_time_of_possession', 'wp',
    'punt_attempt', 'field_goal_attempt', 'qb_kneel', 'qb_spike', 'receiver_player_id', 'rush_attempt'];
const PART_COLS = ['nflverse_game_id', 'play_id', 'offense_formation', 'offense_personnel', 'defenders_in_box',
    'defense_personnel', 'number_of_pass_rushers', 'ngs_air_yards', 'time_to_throw', 'was_pressure', 'route',
    'defense_man_zone_type', 'defense_coverage_type'];

// Somme per valore: giocate, EPA, successi, yard, primi down, TD, palle perse, esplosive.
const N = 0, EPA = 1, SUC = 2, YDS = 3, FD = 4, TD = 5, TO = 6, EXP = 7;
const vuoto = () => [0, 0, 0, 0, 0, 0, 0, 0];

function aggiungi(acc, r) {
    const y = num(r.yards_gained) || 0;
    acc[N]++;
    acc[EPA] += num(r.epa) || 0;
    acc[SUC] += r.success === '1' ? 1 : 0;
    acc[YDS] += y;
    acc[FD] += r.first_down === '1' ? 1 : 0;
    acc[TD] += r.touchdown === '1' ? 1 : 0;
    acc[TO] += (r.interception === '1' ? 1 : 0) + (r.fumble_lost === '1' ? 1 : 0);
    acc[EXP] += esplosiva(r) ? 1 : 0;
}
/** Esplosiva: passaggio da 20+ yard o corsa da 10+ (la convenzione più usata). */
const esplosiva = (r) => (r.pass === '1' ? (num(r.yards_gained) || 0) >= 20 : (num(r.yards_gained) || 0) >= 10);
const mmss = (s) => { const m = /^(\d+):(\d+)$/.exec(s || ''); return m ? +m[1] * 60 + +m[2] : null; };

async function csv(tag, file, opts) {
    const t = await fetchAsset(tag, file, opts).catch(() => null);
    return t || null;
}

/** Media e conteggio in un colpo: m.add(x) ignora i null. */
const media = () => ({ s: 0, n: 0, add(x) { if (x != null && !Number.isNaN(x)) { this.s += x; this.n++; } }, get v() { return this.n ? this.s / this.n : null; } });
const quota = () => ({ si: 0, n: 0, add(cond, valido = true) { if (!valido) return; this.n++; if (cond) this.si++; }, get v() { return this.n ? this.si / this.n : null; } });

function nuovoLato() {
    return {
        dims: {}, // key → valore → acc
        mx: { persPkg: {}, persCov: {} },
        pen: {}, // tipo → [n, yds]
        driveRes: {},
        m: {
            epa: media(), success: media(), passRate: quota(), proe: media(), xpass: media(), neutralPassRate: quota(),
            secPerPlay: media(), adot: media(), cpoe: media(), yac: media(), yacOE: media(), sackRate: quota(),
            hitRate: quota(), explosive: quota(), stuffed: quota(), turnoverRate: quota(), timeToThrow: media(),
            pressureRate: quota(), ngsAirYards: media(), drivePoints: media(), driveTdRate: quota(), driveScoreRate: quota(),
            drivePlays: media(), driveTop: media(), driveStart: media(), fourthGoRate: quota(), fourthConv: quota(),
            redZoneTd: quota(), penaltiesPg: { s: 0, get v() { return null; } }, penaltyYdsPg: { s: 0, get v() { return null; } },
        },
        games: new Set(),
    };
}

async function buildSeason(Y) {
    if (+Y < PRIMA) { console.log(`  ${Y}: il sito parte dal ${PRIMA}.`); return; }
    const corrente = +Y === currentNflSeason();
    const fresco = corrente ? { ttlHours: 6 } : {};

    const tPbp = await csv('pbp', `play_by_play_${Y}.csv.gz`, fresco);
    if (!tPbp) { console.log(`  ${Y}: play-by-play assente.`); return; }
    const pbp = parseCsvSelect(tPbp, PBP_COLS);
    const tPart = await csv('pbp_participation', `pbp_participation_${Y}.csv`, fresco);
    const part = {};
    if (tPart) for (const r of parseCsvSelect(tPart, PART_COLS)) part[`${r.nflverse_game_id}_${r.play_id}`] = r;
    const tFtn = await csv('ftn_charting', `ftn_charting_${Y}.csv`, fresco);
    const ftn = {};
    if (tFtn) for (const r of parseCsv(tFtn)) ftn[`${r.nflverse_game_id}_${r.nflverse_play_id}`] = r;
    const avail = { pbp: true, part: Object.keys(part).length > 0, ftn: Object.keys(ftn).length > 0 };
    console.log(`  ${Y}: pbp ${pbp.length}, participation ${Object.keys(part).length}, FTN ${Object.keys(ftn).length}`);

    // Riga unica per giocata: pbp + part_* + ftn_*.
    const unisci = (r) => {
        const k = `${r.game_id}_${r.play_id}`;
        const p = part[k], f = ftn[k];
        const o = { ...r };
        if (p) for (const c of PART_COLS) o[`part_${c}`] = p[c];
        if (f) for (const [c, v] of Object.entries(f)) o[`ftn_${c}`] = v;
        return o;
    };

    const team = {}; // sigla → { off, def }
    const lato = (t, s) => ((team[t] ??= { off: nuovoLato(), def: nuovoLato() })[s]);
    let maxWeek = 0;
    const drives = {}; // game|drive → info
    let prec = null; // giocata precedente, per il ritmo

    for (const raw of pbp) {
        // Solo regular season: i playoff li gioca metà lega, e mescolati
        // falserebbero confronti e rank. Nella sala video ci sono anche loro.
        if (raw.play_deleted === '1' || raw.season_type !== 'REG') continue;
        const pos = canon(raw.posteam), dif = canon(raw.defteam);
        if (!pos || !dif) continue;
        maxWeek = Math.max(maxWeek, +raw.week || 0);
        const r = unisci(raw);
        const O = lato(pos, 'off'), D = lato(dif, 'def');
        O.games.add(r.game_id); D.games.add(r.game_id);

        // Falli: contano per chi li commette, giocata da scrimmage o no.
        if (r.penalty === '1' && r.penalty_team) {
            const chi = canon(r.penalty_team);
            const L = chi === pos ? O : chi === dif ? D : null;
            if (L) {
                const tipo = r.penalty_type || 'Unknown';
                const a = (L.pen[tipo] ??= [0, 0]); a[0]++; a[1] += num(r.penalty_yards) || 0;
                L.m.penaltiesPg.s++; L.m.penaltyYdsPg.s += num(r.penalty_yards) || 0;
            }
        }

        // 4° down: andare o calciare.
        if (r.down === '4' && r.qb_kneel !== '1') {
            const va = r.pass === '1' || r.rush === '1';
            const calcia = r.punt_attempt === '1' || r.field_goal_attempt === '1';
            if (va || calcia) {
                for (const L of [O, D]) {
                    L.m.fourthGoRate.add(va);
                    if (va) L.m.fourthConv.add(r.first_down === '1' || r.touchdown === '1');
                }
            }
        }

        // Drive (una voce per drive, aggiornata a ogni giocata).
        if (r.fixed_drive) {
            const k = `${r.game_id}|${r.fixed_drive}|${pos}`;
            const d = (drives[k] ??= { pos, dif, start: num(r.yardline_100), res: r.fixed_drive_result, plays: num(r.drive_play_count), top: mmss(r.drive_time_of_possession), rz: false });
            if (num(r.yardline_100) != null && num(r.yardline_100) <= 20) d.rz = true;
            d.res = r.fixed_drive_result || d.res;
        }

        const scrimmage = (r.pass === '1' || r.rush === '1') && num(r.epa) != null && r.two_point_attempt !== '1' && r.qb_kneel !== '1' && r.qb_spike !== '1';
        if (!scrimmage) { prec = null; continue; }

        // Ritmo: secondi fra due snap consecutivi dello stesso drive, in
        // situazione neutra (punteggio entro 7, primi tre quarti).
        if (prec && prec.game_id === r.game_id && prec.fixed_drive === r.fixed_drive && Math.abs(num(r.score_differential) || 0) <= 7 && +r.qtr <= 3) {
            const dt = num(prec.game_seconds_remaining) - num(r.game_seconds_remaining);
            if (dt > 0 && dt <= 60) { O.m.secPerPlay.add(dt); D.m.secPerPlay.add(dt); }
        }
        prec = r;

        for (const L of [O, D]) {
            for (const dim of DIMS) {
                if (!dim.filtro(r)) continue;
                const v = dim.valore(r);
                if (v == null) continue;
                aggiungi(((L.dims[dim.key] ??= {})[v] ??= vuoto()), r);
            }
            const pers = DIMS.find(d => d.key === 'personnel').valore(r);
            const pkg = DIMS.find(d => d.key === 'defPackage').valore(r);
            const cov = r.qb_dropback === '1' ? r.part_defense_coverage_type : null;
            if (pers && pkg) { const a = ((L.mx.persPkg[pers] ??= {})[pkg] ??= [0, 0, 0]); a[0]++; a[1] += num(r.epa) || 0; a[2] += r.success === '1' ? 1 : 0; }
            if (pers && cov) { const a = ((L.mx.persCov[pers] ??= {})[cov] ??= [0, 0, 0]); a[0]++; a[1] += num(r.epa) || 0; a[2] += r.success === '1' ? 1 : 0; }

            const m = L.m, isPass = r.pass === '1', db = r.qb_dropback === '1';
            m.epa.add(num(r.epa)); m.success.add(r.success === '1' ? 1 : 0);
            m.passRate.add(isPass);
            m.proe.add(num(r.pass_oe)); m.xpass.add(num(r.xpass));
            const wp = num(r.wp);
            if ((r.down === '1' || r.down === '2') && wp != null && wp >= 0.2 && wp <= 0.8 && num(r.half_seconds_remaining) > 120) m.neutralPassRate.add(isPass);
            if (r.pass_attempt === '1' && r.sack !== '1' && num(r.air_yards) != null) m.adot.add(num(r.air_yards));
            m.cpoe.add(num(r.cpoe));
            if (r.complete_pass === '1') {
                m.yac.add(num(r.yards_after_catch));
                if (num(r.yards_after_catch) != null && num(r.xyac_mean_yardage) != null) m.yacOE.add(num(r.yards_after_catch) - num(r.xyac_mean_yardage));
            }
            if (db) { m.sackRate.add(r.sack === '1'); m.hitRate.add(r.qb_hit === '1'); }
            m.explosive.add(esplosiva(r));
            if (r.rush === '1' && r.pass !== '1') m.stuffed.add((num(r.yards_gained) || 0) <= 0);
            m.turnoverRate.add(r.interception === '1' || r.fumble_lost === '1');
            if (num(r.part_time_to_throw) > 0) m.timeToThrow.add(num(r.part_time_to_throw));
            if (db && (r.part_was_pressure === 'TRUE' || r.part_was_pressure === 'FALSE')) m.pressureRate.add(r.part_was_pressure === 'TRUE');
            if (num(r.part_ngs_air_yards) != null && r.pass_attempt === '1') m.ngsAirYards.add(num(r.part_ngs_air_yards));
        }
    }

    // Drive → metriche e distribuzione degli esiti.
    const PUNTI = { Touchdown: 7, 'Field goal': 3 };
    for (const d of Object.values(drives)) {
        for (const L of [lato(d.pos, 'off'), lato(d.dif, 'def')]) {
            const res = d.res || 'Unknown';
            L.driveRes[res] = (L.driveRes[res] || 0) + 1;
            L.m.drivePoints.add(PUNTI[res] || 0);
            L.m.driveTdRate.add(res === 'Touchdown');
            L.m.driveScoreRate.add(res === 'Touchdown' || res === 'Field goal');
            L.m.drivePlays.add(d.plays);
            L.m.driveTop.add(d.top);
            if (d.start != null) L.m.driveStart.add(100 - d.start);
            if (d.rz) L.m.redZoneTd.add(res === 'Touchdown');
        }
    }

    // ── chi esegue: NGS, PFR, snap count ──────────────────────────────────
    const giocatori = await caricaGiocatori(Y);

    // ── somme di lega, quote, rank ────────────────────────────────────────
    const sigle = Object.keys(team).filter(t => team[t].off.games.size).sort();
    const lega = { dims: {}, mx: { persPkg: {}, persCov: {} }, driveRes: {}, pen: {} };
    for (const t of sigle) {
        const O = team[t].off;
        for (const [k, vals] of Object.entries(O.dims)) for (const [v, a] of Object.entries(vals)) {
            const b = ((lega.dims[k] ??= {})[v] ??= vuoto()); a.forEach((x, i) => { b[i] += x; });
        }
        for (const mk of ['persPkg', 'persCov']) for (const [p, row] of Object.entries(O.mx[mk])) for (const [c, a] of Object.entries(row)) {
            const b = ((lega.mx[mk][p] ??= {})[c] ??= [0, 0, 0]); a.forEach((x, i) => { b[i] += x; });
        }
        for (const [k, v] of Object.entries(O.driveRes)) lega.driveRes[k] = (lega.driveRes[k] || 0) + v;
        for (const [k, a] of Object.entries(O.pen)) { const b = (lega.pen[k] ??= [0, 0]); b[0] += a[0]; b[1] += a[1]; }
    }

    // Metriche in valore finale (per partita dove serve).
    const valori = {};
    for (const t of sigle) for (const s of ['off', 'def']) {
        const L = team[t][s], g = L.games.size || 1;
        const v = {};
        for (const [k, m] of Object.entries(L.m)) v[k] = m.v;
        v.penaltiesPg = L.m.penaltiesPg.s / g;
        v.penaltyYdsPg = L.m.penaltyYdsPg.s / g;
        (valori[t] ??= {})[s] = v;
    }
    // Più alto = rank 1, per tutte; la pagina sa da METRICHE se "alto" è buono.
    const rankMetriche = {};
    for (const s of ['off', 'def']) {
        const chiavi = Object.keys(valori[sigle[0]][s]);
        for (const k of chiavi) {
            const ord = sigle.filter(t => valori[t][s][k] != null).sort((a, b) => valori[b][s][k] - valori[a][s][k]);
            ord.forEach((t, i) => { ((rankMetriche[t] ??= {})[s] ??= {})[k] = i + 1; });
        }
    }
    // Rank per valore di dimensione: quota d'uso (1 = la usa di più) ed EPA
    // per giocata (1 = la più alta; in difesa la pagina lo legge al contrario).
    const rankDim = {};
    for (const s of ['off', 'def']) for (const dim of DIMS) {
        const valoriDim = new Set(sigle.flatMap(t => Object.keys(team[t][s].dims[dim.key] || {})));
        for (const v of valoriDim) {
            const righe = sigle.map(t => {
                const tot = Object.values(team[t][s].dims[dim.key] || {}).reduce((x, a) => x + a[N], 0);
                const a = team[t][s].dims[dim.key]?.[v];
                return { t, share: tot && a ? a[N] / tot : 0, epa: a && a[N] ? a[EPA] / a[N] : null };
            });
            [...righe].sort((a, b) => b.share - a.share).forEach((x, i) => { (((rankDim[x.t] ??= {})[s] ??= {})[dim.key] ??= {})[v] = [i + 1, null]; });
            righe.filter(x => x.epa != null).sort((a, b) => b.epa - a.epa).forEach((x, i) => { rankDim[x.t][s][dim.key][v][1] = i + 1; });
        }
    }

    const dir = path.join(OUT, String(Y));
    await mkdir(dir, { recursive: true });
    const generatedAt = new Date().toISOString();
    const tondo = (a) => a.map((x, i) => (i === EPA ? r2(x) : x));
    const leagueMetric = {};
    for (const s of ['off']) {
        const chiavi = Object.keys(valori[sigle[0]][s]);
        for (const k of chiavi) {
            const xs = sigle.map(t => valori[t][s][k]).filter(x => x != null);
            leagueMetric[k] = xs.length ? r3(xs.reduce((a, b) => a + b, 0) / xs.length) : null;
        }
    }
    await writeFile(path.join(dir, 'league.json'), JSON.stringify({
        generatedAt, season: +Y, throughWeek: maxWeek, avail, teams: sigle,
        dims: Object.fromEntries(Object.entries(lega.dims).map(([k, vals]) => [k, Object.fromEntries(Object.entries(vals).map(([v, a]) => [v, tondo(a)]))])),
        mx: lega.mx, driveRes: lega.driveRes, pen: lega.pen, metrics: leagueMetric,
    }));
    for (const t of sigle) {
        const out = { generatedAt, season: +Y, team: t, throughWeek: maxWeek, avail: { ...avail, ...giocatori.avail }, games: team[t].off.games.size, side: {} };
        for (const s of ['off', 'def']) {
            const L = team[t][s];
            out.side[s] = {
                dims: Object.fromEntries(Object.entries(L.dims).map(([k, vals]) => [k, Object.fromEntries(Object.entries(vals).map(([v, a]) => [v, [...tondo(a), ...(rankDim[t][s][k][v] || [null, null])]]))])),
                metrics: Object.fromEntries(Object.entries(valori[t][s]).map(([k, v]) => [k, [v == null ? null : r3(v), rankMetriche[t][s][k] ?? null]])),
                mx: Object.fromEntries(Object.entries(L.mx).map(([k, m]) => [k, Object.fromEntries(Object.entries(m).map(([p, row]) => [p, Object.fromEntries(Object.entries(row).map(([c, a]) => [c, [a[0], r2(a[1]), a[2]]]))]))])),
                driveRes: L.driveRes,
                pen: L.pen,
            };
        }
        out.players = giocatori.perSquadra(t);
        await writeFile(path.join(dir, `${t}.json`), JSON.stringify(out));
    }
    console.log(`  ${Y}: ${sigle.length} squadre fino alla week ${maxWeek}`);
}

/**
 * Tabelle "chi esegue", con TUTTE le colonne delle fonti (meno gli id e i
 * doppioni di nome). Chi ha cambiato squadra in PFR ha le righe per squadra
 * e una riga 2TM/3TM col totale: si usano le prime. Solo se mancano, il
 * totale si attacca a ogni squadra in cui ha giocato (dagli snap count) con
 * `multiTeam` a dirlo.
 */
async function caricaGiocatori(Y) {
    const tabelle = {}; // nome → { cols, perTeam: {T: [righe]} }
    const avail = { ngs: false, pfr: false, snaps: false };
    const metti = (nome, cols, T, riga) => {
        const tb = (tabelle[nome] ??= { cols, perTeam: {} });
        (tb.perTeam[T] ??= []).push(riga);
    };

    for (const kind of ['passing', 'rushing', 'receiving']) {
        const t = await csv('nextgen_stats', `ngs_${kind}.csv.gz`, { ttlHours: 12 });
        if (!t) continue;
        const rows = parseCsv(t).filter(r => +r.season === +Y && +r.week === 0 && r.season_type === 'REG');
        if (!rows.length) continue;
        avail.ngs = true;
        const cols = Object.keys(rows[0]).filter(c => !['season', 'season_type', 'week', 'player_gsis_id', 'player_first_name', 'player_last_name', 'player_short_name', 'team_abbr'].includes(c));
        for (const r of rows) metti(`ngs_${kind}`, cols, canon(r.team_abbr), cols.map(c => r[c]));
    }

    // Snap count: totali per giocatore e squadra, e la mappa pfr → squadre.
    const squadreDi = {};
    const ts = await csv('snap_counts', `snap_counts_${Y}.csv`, { ttlHours: 12 });
    if (ts) {
        const acc = {};
        for (const r of parseCsv(ts)) {
            if (r.game_type && r.game_type !== 'REG') continue;
            const T = canon(r.team);
            (squadreDi[r.pfr_player_id] ??= new Set()).add(T);
            const a = (acc[`${T}|${r.pfr_player_id}`] ??= { T, player: r.player, position: r.position, games: 0, offense_snaps: 0, defense_snaps: 0, st_snaps: 0, _op: 0, _dp: 0, _sp: 0 });
            a.games++;
            a.offense_snaps += num(r.offense_snaps) || 0; a.defense_snaps += num(r.defense_snaps) || 0; a.st_snaps += num(r.st_snaps) || 0;
            a._op += num(r.offense_pct) || 0; a._dp += num(r.defense_pct) || 0; a._sp += num(r.st_pct) || 0;
        }
        const cols = ['player', 'position', 'games', 'offense_snaps', 'offense_pct', 'defense_snaps', 'defense_pct', 'st_snaps', 'st_pct'];
        for (const a of Object.values(acc)) {
            avail.snaps = true;
            metti('snaps', cols, a.T, [a.player, a.position, a.games, a.offense_snaps, r3(a._op / a.games), a.defense_snaps, r3(a._dp / a.games), a.st_snaps, r3(a._sp / a.games)]);
        }
    }

    for (const kind of ['pass', 'rush', 'rec', 'def']) {
        const t = await csv('pfr_advstats', `advstats_season_${kind}.csv`, { ttlHours: 12 });
        if (!t) continue;
        const rows = parseCsv(t).filter(r => +r.season === +Y);
        if (!rows.length) continue;
        avail.pfr = true;
        const teamCol = 'team' in rows[0] ? 'team' : 'tm';
        const cols = Object.keys(rows[0]).filter(c => !['season', 'pfr_id', teamCol, 'loaded'].includes(c));
        // Chi ha cambiato squadra ha di solito una riga per squadra PIÙ una
        // riga 2TM/3TM col totale: quella si tiene solo se le righe per
        // squadra mancano (se no il giocatore comparirebbe due volte).
        const conSquadra = new Set(rows.filter(r => !/^\dTM$/.test(r[teamCol])).map(r => r.pfr_id));
        for (const r of rows) {
            const multi = /^\dTM$/.test(r[teamCol]);
            if (multi && conSquadra.has(r.pfr_id)) continue;
            const squadre = multi ? [...(squadreDi[r.pfr_id] || [])] : [canon(r[teamCol])];
            for (const T of squadre) metti(`pfr_${kind}`, [...cols, 'multiTeam'], T, [...cols.map(c => r[c]), multi ? r[teamCol] : '']);
        }
    }

    return {
        avail,
        perSquadra: (T) => Object.fromEntries(Object.entries(tabelle).map(([nome, tb]) => [nome, { cols: tb.cols, rows: tb.perTeam[T] || [] }])),
    };
}

const args = process.argv.slice(2);
const seasons = args.length ? args : [String(currentNflSeason())];
console.log('Tactics:', seasons.join(', '));
for (const y of seasons) await buildSeason(y);
