/**
 * Cos'è cambiato nelle rose NFL fra la stagione scorsa e quella che si sta per
 * draftare — la parte di contesto che una proiezione non racconta.
 *
 * Perché esiste questo file invece di leggere data/model/perf_causes_*.json:
 * quei file HANNO i campi giusti (`departures`, `arrivals`, `share`) ma sono
 * VUOTI in ogni copia committata — li ho contati, 100% dei giocatori dal 2019
 * al 2024. Il generatore li calcola da una cache nflverse locale che non è
 * versionata, quindi in produzione quel dato non è mai esistito. Qui si
 * ricostruisce dai due file che invece ci sono per davvero:
 *
 *   data/nfl/roster_{Y}.json      — chi sta su quale squadra ORA (32 squadre,
 *                                   ~91 giocatori l'una, più `starters`)
 *   data/nfl/adv_players_{Y-1}.json — quota di bersagli e portate di ognuno
 *                                   nella stagione appena chiusa
 *
 * Il join è su `gsis`, che c'è in tutti e due (verificato: 531 dei 915
 * giocatori skill del 2026 hanno una riga 2025, e 130 hanno cambiato squadra).
 *
 * ── Una nota su cosa significa davvero "vacated share" ────────────────
 * È la quota di bersagli/portate del 2025 che appartiene a giocatori che
 * quella squadra NON ha più. È un indizio di opportunità, non una promessa:
 * quei palloni possono finire a un rookie, a un acquisto, o semplicemente non
 * esistere più se cambia il modo di attaccare. La pagina la presenta così.
 *
 * Si normalizza sulla quota TOTALE coperta dal file per quella squadra, non
 * su 1: `adv_players` contiene ~650 giocatori, non tutta la NFL, quindi le
 * quote di una squadra non sommano a 1 e un rapporto sul totale nominale
 * gonfierebbe ogni numero. Diviso per quello che il file copre davvero, il
 * numero è "di ciò che sappiamo, quanto se n'è andato".
 */

import { normName } from './projections.js?v=592';
import { getAdvancedPlayers } from './context-score.js?v=587';
import { canonAbbr } from './nfl-schedule.js?v=523';

const _cache = {};   // year → Promise<risultato | null>

/** Quota minima per dire che un arrivo è concorrenza vera e non un panchinaro. */
const COMPETITION_MIN = 0.10;
/** Ruoli che consumano bersagli/portate: il resto della rosa non c'entra. */
const SKILL = new Set(['QB', 'RB', 'WR', 'TE']);

async function fetchJson(url, timeoutMs = 10000) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try { const r = await fetch(url, { signal: ctrl.signal }); return r.ok ? await r.json() : null; }
    catch { return null; }
    finally { clearTimeout(t); }
}

const key = (name, pos) => `${normName(name)}|${(pos || '').toUpperCase()}`;

/** Primo QB dell'attacco titolare di una squadra, o null. */
function starterQb(roster, abbr) {
    const off = roster?.starters?.[abbr]?.offense || [];
    return off.find(p => (p.pos || '').toUpperCase() === 'QB')?.name || null;
}

/**
 * @returns null se manca uno dei due file (anni troppo vecchi o build non
 *   ancora passata): il chiamante spegne le sezioni che ne dipendono invece di
 *   mostrare zeri, che si leggerebbero come "nessuno se n'è andato".
 */
export function getRosterChange(year) {
    const y = Number(year);
    if (y in _cache) return _cache[y];
    return (_cache[y] = build(y));
}

async function build(year) {
    const [roster, prevRoster, prevAdv] = await Promise.all([
        fetchJson(`data/nfl/roster_${year}.json`),
        fetchJson(`data/nfl/roster_${year - 1}.json`),
        getAdvancedPlayers(year - 1),
    ]);
    if (!roster?.teams || !prevAdv?.length) return null;

    // dove sta OGGI ciascun giocatore (per gsis), e la sua riga di rosa
    const nowByGsis = new Map();
    for (const [abbr, list] of Object.entries(roster.teams)) {
        const A = canonAbbr(abbr);
        for (const p of list) if (p.gsis) nowByGsis.set(p.gsis, { team: A, row: p });
    }

    const byTeam = {};
    const teamOf = (A) => (byTeam[A] ||= {
        team: A,
        tgtTotal: 0, rushTotal: 0, vacTgt: 0, vacRush: 0,
        departed: [], incoming: [],
    });

    // ── passata unica sulle righe della stagione scorsa ────────────────
    for (const p of prevAdv) {
        if (!SKILL.has((p.pos || '').toUpperCase())) continue;
        const from = canonAbbr(p.team);
        if (!from) continue;
        const tgt = p.targetShare || 0;
        const rush = p.rushShare || 0;
        const T = teamOf(from);
        T.tgtTotal += tgt;
        T.rushTotal += rush;

        const now = nowByGsis.get(p.gsis);
        const to = now?.team || null;
        if (to === from) continue; // rimasto: non libera niente e non è un arrivo

        // ha lasciato quella squadra (o non è più in nessuna rosa)
        T.vacTgt += tgt;
        T.vacRush += rush;
        if (tgt >= COMPETITION_MIN || rush >= COMPETITION_MIN) {
            T.departed.push({ name: p.name, pos: p.pos, tgt, rush, to });
        }
        // ed è concorrenza in arrivo per la nuova squadra, se porta volume
        if (to && (tgt >= COMPETITION_MIN || rush >= COMPETITION_MIN)) {
            teamOf(to).incoming.push({ name: p.name, pos: p.pos, tgt, rush, from });
        }
    }

    for (const T of Object.values(byTeam)) {
        // "di quello che il file copre, quanto se n'è andato" — vedi nota di testa
        T.vacTgtShare = T.tgtTotal > 0 ? +(T.vacTgt / T.tgtTotal).toFixed(3) : null;
        T.vacRushShare = T.rushTotal > 0 ? +(T.vacRush / T.rushTotal).toFixed(3) : null;
        T.departed.sort((a, b) => (b.tgt + b.rush) - (a.tgt + a.rush));
        T.incoming.sort((a, b) => (b.tgt + b.rush) - (a.tgt + a.rush));
        const qbNow = starterQb(roster, T.team);
        const qbPrev = prevRoster ? starterQb(prevRoster, T.team) : null;
        T.qb = qbNow;
        T.qbPrev = qbPrev;
        // solo quando SAPPIAMO tutti e due i nomi: un null non è un cambio
        T.qbChanged = !!(qbNow && qbPrev && normName(qbNow) !== normName(qbPrev));
    }

    // ── indice per giocatore, sulla chiave nome|ruolo usata dalle proiezioni ──
    const byPlayer = new Map();
    const prevByGsis = new Map(prevAdv.map(p => [p.gsis, p]));
    for (const [abbr, list] of Object.entries(roster.teams)) {
        const A = canonAbbr(abbr);
        const starters = new Set((roster.starters?.[A]?.offense || []).map(s => normName(s.name)));
        for (const p of list) {
            const pos = (p.pos || '').toUpperCase();
            if (!SKILL.has(pos)) continue;
            const prev = p.gsis ? prevByGsis.get(p.gsis) : null;
            const prevTeam = prev ? canonAbbr(prev.team) : null;
            byPlayer.set(key(p.name, pos), {
                team: A,
                prevTeam,
                movedTeam: !!(prevTeam && prevTeam !== A),
                // NB: `starters` dice CHE è titolare, non che è il WR1 — la
                // depth chart ordinata per il 2026 non esiste (vedi CLAUDE.md)
                isStarter: starters.has(normName(p.name)),
                yearsExp: p.yearsExp ?? null,
                rookieYear: p.rookieYear ?? null,
                draftNumber: p.draftNumber ?? null,
                prior: prev ? {
                    gp: prev.gp ?? null,
                    fpgLeague: prev.fpgLeague ?? null,
                    targetShare: prev.targetShare ?? null,
                    rushShare: prev.rushShare ?? null,
                    snapPct: prev.snapPct ?? null,
                    tgtPerGame: prev.tgtPerGame ?? null,
                    carriesPerGame: prev.carriesPerGame ?? null,
                    weekly: prev.weekly || null,
                } : null,
            });
        }
    }

    return { year, byTeam, byPlayer, hasPrevRoster: !!prevRoster };
}
