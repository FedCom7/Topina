/**
 * Totali di giornata dal tabellino ufficiale ESPN, senza cookie né scraping.
 *
 * Serve alla pagina #live come rete di sicurezza: se i punti su Firebase sono
 * tutti a zero perché lo script esterno non è ancora passato, gli stessi numeri
 * si compongono da qui. Host pubblici, chiamabili dal browser.
 *
 * Fedeltà verificata sull'intera stagione 2025 (17 giornate, 605 titolari):
 * 605 su 605 esatti al centesimo, difese comprese. Il banco di prova è
 * scripts/espn/validate_boxscore.py, che confronta questi numeri con quelli
 * veri salvati su Firebase — da rilanciare se si tocca questo file.
 *
 * Le regole non ovvie sono annotate sul punto in cui servono: ognuna è costata
 * un disallineamento, e nessuna è deducibile dalla documentazione.
 */

import { canonAbbr } from './nfl-schedule.js?v=546';
import { fetchPlays } from './nfl-plays.js?v=571';

const SUMMARY = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary';

/** TD segnati dalla DIFESA avversaria: non vanno addebitati a chi li subisce.
 *  Coprono sia "48 Yd Interception Return" sia "Fumble Recovery in End Zone",
 *  che non ha yard e non dice "Return". Un ritorno di punt o kickoff invece
 *  resta addebitato: quello lo ha concesso il reparto calci, non la difesa. */
const DEF_TD = /(Interception|Fumble)\s+(Return|Recovery)/i;

/** Nome confrontabile fra tabellino e rose (suffissi e apostrofi via). */
export function normName(s) {
    return String(s || '').toLowerCase()
        .replace(/\b(jr|sr|iii|ii|iv)\b\.?/g, '')
        .replace(/[^a-z]/g, '');
}

/**
 * Primo numero di un valore del tabellino. I campi composti sono "5/7"
 * (fatti/tentati) e "3-21" (sack e yard perse), ma esistono anche valori
 * negativi come "-3" yard di corsa: si spezza sul trattino solo quando non è
 * il segno, altrimenti quelle yard si azzerano.
 */
function num(v) {
    if (v == null || v === '--' || v === '') return 0;
    let s = String(v).trim().split('/')[0];
    if (s.slice(1).includes('-')) s = s[0] + s.slice(1).split('-')[0];
    const n = parseFloat(s);
    return Number.isFinite(n) ? n : 0;
}

const add = (map, key) => {
    if (!map.has(key)) map.set(key, {});
    return map.get(key);
};
const bump = (o, k, v) => { if (v) o[k] = (o[k] || 0) + v; };

/**
 * Totali di tutti i giocatori e di tutte le difese delle partite indicate.
 * Ritorna chiavi nello schema legacy (le stesse di Firebase), così i punti si
 * calcolano con scoreWeeklyStats come per qualsiasi altro dato.
 */
/**
 * Ultimo tabellino buono di ogni partita.
 *
 * Serve a due cose. La prima: se una richiesta fallisce — ESPN strozza le
 * chiamate quando se ne fanno sedici ogni dieci secondi — si riusa quello di
 * prima invece di far sparire i punti di tutti i giocatori di quella partita
 * per un giro. La seconda: il tabellino di una partita FINITA non cambia più,
 * quindi non si riscarica affatto.
 */
const ultimoTabellino = new Map();

export async function fetchBoxscoreTotals(eventIds = [], finite = new Set()) {
    const players = new Map();   // nome normalizzato → stats
    const defenses = new Map();  // sigla squadra → stats
    const teamByName = new Map();// nome completo squadra → sigla (le DEF non hanno nfl_team)
    const kickerIds = new Map(); // nome normalizzato → id atleta ESPN
    // Uso dei giocatori squadra per squadra, per il "dentro la partita": chi
    // riceve, chi corre, quanti palloni gli arrivano. Sono gli stessi tabellini
    // già scaricati qui, quindi non costa una richiesta in più.
    const usage = new Map();     // sigla squadra → { info, players[] }
    if (!eventIds.length) return { players, defenses, teamByName, usage };

    const summaries = await Promise.all(eventIds.map(async id => {
        const chiave = String(id);
        // partita finita e già letta: il tabellino è definitivo
        if (finite.has(chiave) && ultimoTabellino.has(chiave)) return ultimoTabellino.get(chiave);
        // con scadenza: una risposta che non arriva mai bloccherebbe la pagina
        const stop = new AbortController();
        const timer = setTimeout(() => stop.abort(), 8000);
        try {
            const res = await fetch(`${SUMMARY}?event=${id}`, { signal: stop.signal });
            if (!res.ok) throw new Error(`ESPN ${res.status}`);
            const dati = await res.json();
            if (dati?.boxscore) ultimoTabellino.set(chiave, dati);
            return dati;
        } catch {
            // meglio i numeri del giro precedente che nessun numero
            return ultimoTabellino.get(chiave) || null;
        } finally { clearTimeout(timer); }
    }));

    for (const d of summaries) {
        if (!d?.boxscore) continue;

        for (const team of d.boxscore.players || []) {
            const sigla = canonAbbr(team.team?.abbreviation);
            const quadro = usage.get(sigla) || { players: new Map() };
            usage.set(sigla, quadro);
            for (const cat of team.statistics || []) {
                const keys = cat.keys || [];
                for (const a of cat.athletes || []) {
                    const nm = normName(a.athlete?.displayName);
                    if (!nm) continue;
                    const e = add(players, nm);
                    const u = quadro.players.get(nm)
                        || { name: a.athlete?.displayName || '', pos: a.athlete?.position?.abbreviation || '' };
                    quadro.players.set(nm, u);
                    const st = {};
                    keys.forEach((k, i) => { st[k] = (a.stats || [])[i]; });
                    const g = (k) => num(st[k]);
                    switch (cat.name) {
                        case 'passing':
                            u.pass_yds = g('passingYards');
                            u.pass_td = g('passingTouchdowns');
                            bump(e, 'pass_yds', g('passingYards'));
                            bump(e, 'pass_td', g('passingTouchdowns'));
                            bump(e, 'pass_int', g('interceptions'));
                            bump(e, 'pass_comp', num(String(st['completions/passingAttempts'] || '').split('/')[0]));
                            bump(e, 'pass_att', num(String(st['completions/passingAttempts'] || '').split('/')[1]));
                            break;
                        case 'rushing':
                            u.rush_att = g('rushingAttempts');
                            u.rush_yds = g('rushingYards');
                            u.rush_td = g('rushingTouchdowns');
                            bump(e, 'rush_yds', g('rushingYards'));
                            bump(e, 'rush_td', g('rushingTouchdowns'));
                            bump(e, 'rush_att', g('rushingAttempts'));
                            break;
                        case 'receiving':
                            u.targets = g('receivingTargets');
                            u.rec = g('receptions');
                            u.rec_yds = g('receivingYards');
                            u.rec_td = g('receivingTouchdowns');
                            bump(e, 'rec', g('receptions'));
                            bump(e, 'rec_yds', g('receivingYards'));
                            bump(e, 'rec_td', g('receivingTouchdowns'));
                            bump(e, 'targets', g('receivingTargets'));
                            break;
                        case 'fumbles':
                            bump(e, 'fum_lost', g('fumblesLost'));
                            break;
                        case 'kicking':
                            bump(e, 'pat_made', num(String(st['extraPointsMade/extraPointAttempts'] || '').split('/')[0]));
                            bump(e, 'fg_made', num(String(st['fieldGoalsMade/fieldGoalAttempts'] || '').split('/')[0]));
                            bump(e, 'fg_att', num(String(st['fieldGoalsMade/fieldGoalAttempts'] || '').split('/')[1]));
                            kickerIds.set(nm, String(a.athlete?.id || ''));
                            break;
                        case 'kickReturns':
                            bump(e, 'ret_td', g('kickReturnTouchdowns'));
                            break;
                        case 'puntReturns':
                            bump(e, 'ret_td', g('puntReturnTouchdowns'));
                            break;
                        default:
                            break;
                    }
                }
            }
        }

        const comp = d.header?.competitions?.[0];
        if (!comp) continue;
        const score = {};
        for (const c of comp.competitors || []) {
            const ab = canonAbbr(c.team?.abbreviation);
            score[ab] = num(c.score);
            for (const key of [c.team?.displayName, c.team?.name]) {
                if (key) teamByName.set(normName(key), ab);
            }
        }

        const stato = d.header?.competitions?.[0]?.status?.type || {};
        for (const c of comp.competitors || []) {
            const ab = canonAbbr(c.team?.abbreviation);
            const altro = (comp.competitors || []).find(x => x !== c);
            const quadro = usage.get(ab);
            if (!quadro) continue;
            quadro.info = {
                team: ab,
                teamName: c.team?.displayName || ab,
                logo: c.team?.logos?.[0]?.href || c.team?.logo || '',
                opponent: canonAbbr(altro?.team?.abbreviation),
                opponentName: altro?.team?.displayName || '',
                home: c.homeAway === 'home',
                score: num(c.score),
                oppScore: num(altro?.score),
                detail: stato.shortDetail || stato.description || '',
                state: stato.state || 'pre',
            };
        }

        const defTd = {}, safety = {};
        for (const ab of Object.keys(score)) { defTd[ab] = 0; safety[ab] = 0; }
        for (const s of d.scoringPlays || []) {
            const ab = canonAbbr(s.team?.abbreviation);
            const text = s.text || '';
            const kind = s.scoringType?.displayName || '';
            if (ab in defTd && DEF_TD.test(text)) defTd[ab]++;
            // Le safety non compaiono fra le statistiche di squadra: solo qui.
            if (ab in safety && /Safety/i.test(`${kind} ${text}`)) safety[ab]++;
        }

        const teamStats = {};
        for (const t of d.boxscore.teams || []) {
            const ab = canonAbbr(t.team?.abbreviation);
            const vals = {};
            for (const s of t.statistics || []) {
                if (!(s.name in vals)) vals[s.name] = s.displayValue;
            }
            teamStats[ab] = vals;
        }

        // Il quadro di squadra completo va anche nell'uso: è quello che serve
        // al confronto fra le due squadre sotto il "dentro la partita".
        for (const ab of Object.keys(teamStats)) {
            const quadro = usage.get(ab);
            if (!quadro) continue;
            quadro.teamStats = teamStats[ab];
            const altro = Object.keys(teamStats).find(x => x !== ab);
            quadro.oppStats = teamStats[altro] || {};
        }

        const sides = Object.keys(score);
        for (const ab of sides) {
            const opp = sides.find(x => x !== ab);
            const mine = teamStats[ab] || {}, theirs = teamStats[opp] || {};
            defenses.set(ab, {
                // I TD della difesa avversaria non li ha concessi questa difesa
                pts_allowed: score[opp] - 6 * (defTd[opp] || 0),
                yds_allowed: num(theirs.totalYards),
                // I sack di una difesa sono quelli SUBITI dall'attacco avversario
                sack: num(theirs.sacksYardsLost),
                def_int: num(theirs.interceptions),
                fum_rec: num(theirs.fumblesLost),
                def_td: num(mine.defensiveTouchdowns),
                safety: safety[ab] || 0,
                def_ret_td: 0,
                def_2pt_ret: 0,
            });
        }

        // Conversioni da 2: stanno solo nel testo delle segnature, con i nomi
        // per esteso. Prendono 2 punti sia chi lancia sia chi riceve. Vanno
        // lette da qui e basta: compaiono anche nel play-by-play, e contarle da
        // entrambe le fonti le raddoppia.
        for (const s of d.scoringPlays || []) {
            const m = (s.text || '').match(/\(([^)]*?)\s+for\s+Two-Point Conversion\)/i);
            if (!m) continue;
            const parts = m[1].match(/^(.+?)\s+(?:Pass to|Run|Rush)\s*(.*)$/i);
            if (!parts) continue;
            for (const full of [parts[1], parts[2]]) {
                const nm = normName(full);
                if (nm) bump(add(players, nm), 'two_pt', 1);
            }
        }
    }

    // Le fasce dei field goal si trovano solo nelle giocate: il tabellino dà il
    // totale e il più lungo, ma da noi un 50+ vale 5 punti contro 3.
    const kickers = [...kickerIds.values()].filter(Boolean);
    if (kickers.length) {
        const lists = await Promise.all(eventIds.map(id => fetchPlays(id, { all: true })));
        const over50 = new Map();
        for (const plays of lists) {
            for (const p of plays) {
                if (p.type !== 'Field Goal Good' || !p.actors?.kicker) continue;
                if (p.yards >= 50) over50.set(p.actors.kicker, (over50.get(p.actors.kicker) || 0) + 1);
            }
        }
        for (const [nm, id] of kickerIds) {
            const e = players.get(nm);
            if (!e) continue;
            const n50 = over50.get(id) || 0;
            e.fg_50_plus = n50;
            e.fg_0_39 = Math.max(0, (e.fg_made || 0) - n50);
        }
    }

    // le mappe interne diventano liste, più comode da disegnare
    for (const quadro of usage.values()) {
        quadro.players = [...quadro.players.values()];
    }
    return { players, defenses, teamByName, usage };
}
