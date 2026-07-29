/**
 * Carriere Topina — aggregazione per giocatore su TUTTE le stagioni della
 * lega (estratta da halloffame.js e arricchita per la scheda giocatore).
 *
 * Rispetto alla versione storica della Hall of Fame:
 *  - include anche le DEF (la HOF le esclude filtrando il ballottaggio);
 *  - aggiunge `bySeason` (punti, titolarità e squadre per ogni stagione)
 *    e `draftedBy` (chi lo ha scelto al draft, con pick e round);
 *  - espone `getPlayerAwards` che raccoglie tutti i premi di lega vinti
 *    (MVP, OPOY, premi di posizione, Steal, All-Pro) rispettando i gate
 *    `revealed`/`rsComplete` della stagione in corso (niente spoiler).
 */

import {
    fetchFantasyData, fetchDraftData, flattenDraft,
    SEASONS, getSeasonConfig, getSuperBowlMatchup, displayName,
} from '../data.js?v=32';
import { TEAM_KEYS } from './team-config.js?v=31';
import { getHonorsBundle } from './honors.js?v=14';
import { normName } from './projections.js?v=15';

let careersCache = null;

const toKey = (rawName) => TEAM_KEYS[displayName(rawName)] || null;

export async function buildCareers() {
    if (careersCache) return careersCache;

    const careers = new Map(); // name -> career

    // Le stagioni sono indipendenti: si scaricano tutte in parallelo (7 letture
    // Firebase in volo insieme invece che una dopo l'altra) e si processano in
    // sequenza — l'elaborazione è puro CPU e istantanea, il collo di bottiglia
    // è la rete. L'ordine di elaborazione non conta: `lastSeason`/`bySeason`
    // sono già calcolati per confronto/chiave, non per ordine di arrivo.
    const seasonResults = await Promise.all(SEASONS.map(async (season) => {
        try {
            return [season, await fetchFantasyData(season)];
        } catch (e) {
            console.warn(`careers: dati ${season} non disponibili`, e);
            return [season, null];
        }
    }));

    for (const [season, data] of seasonResults) {
        if (!data?.weeks) continue;

        const config = getSeasonConfig(season);
        const seasonTotals = new Map(); // name -> { position, pts } per il Top1 di ruolo

        // Campione della stagione (per gli anelli)
        let championName = null;
        const sbMatchup = getSuperBowlMatchup(data, season);
        if (sbMatchup?.team1 && sbMatchup?.team2) {
            const s1 = parseFloat(sbMatchup.team1.score);
            const s2 = parseFloat(sbMatchup.team2.score);
            if (s1 !== s2) championName = s1 > s2 ? sbMatchup.team1.name : sbMatchup.team2.name;
        }
        const championRing = new Set(); // giocatori nel roster del campione alla settimana del SB

        for (const [wkStr, wkData] of Object.entries(data.weeks)) {
            const wk = Number(wkStr);
            for (const m of wkData.matchups || []) {
                for (const side of [m.team1, m.team2]) {
                    if (!side?.name) continue;
                    const teamKey = toKey(side.name);
                    const isChampSbWeek = championName && side.name === championName && wk === config.superBowlWeek;

                    for (const [list, started] of [[side.starters, true], [side.bench, false]]) {
                        for (const p of list || []) {
                            if (!p?.name) continue;
                            const pos = p.position_in_team || p.position;

                            let c = careers.get(p.name);
                            if (!c) careers.set(p.name, c = {
                                name: p.name, position: pos, nflTeam: p.nfl_team || '',
                                seasons: new Set(), lastSeason: season,
                                totPts: 0, stats: {}, top1Count: 0, sbWins: 0, gamesStarted: 0,
                                firstTeam: 0, secondTeam: 0, mvp: 0,
                                bySeason: {}, draftedBy: [],
                            });
                            if (pos) c.position = pos;
                            if (p.nfl_team) c.nflTeam = p.nfl_team;
                            c.seasons.add(season);
                            if (season > c.lastSeason) c.lastSeason = season;
                            if (started) c.gamesStarted++;

                            const pts = parseFloat(p.fantasy_points || 0);
                            c.totPts += pts;
                            for (const [k, v] of Object.entries(p.stats || {})) {
                                c.stats[k] = (c.stats[k] || 0) + (Number(v) || 0);
                            }

                            // dettaglio per stagione (scheda giocatore)
                            let bs = c.bySeason[season];
                            if (!bs) bs = c.bySeason[season] = { pts: 0, gamesStarted: 0, teamKeys: {} };
                            bs.pts += pts;
                            if (started) bs.gamesStarted++;
                            if (teamKey) bs.teamKeys[teamKey] = (bs.teamKeys[teamKey] || 0) + 1;

                            // Totali stagionali per il Top1 di ruolo
                            let st = seasonTotals.get(p.name);
                            if (!st) seasonTotals.set(p.name, st = { position: pos, pts: 0 });
                            st.pts += pts;

                            if (isChampSbWeek) championRing.add(p.name);
                        }
                    }
                }
            }
        }

        // Top 1 di ruolo della stagione
        const bestByPos = {};
        for (const [name, st] of seasonTotals) {
            if (!bestByPos[st.position] || st.pts > bestByPos[st.position].pts) {
                bestByPos[st.position] = { name, pts: st.pts };
            }
        }
        for (const best of Object.values(bestByPos)) {
            const c = careers.get(best.name);
            if (c) c.top1Count++;
        }

        // Anelli
        for (const name of championRing) {
            const c = careers.get(name);
            if (c) c.sbWins++;
        }
    }

    // Chi lo ha draftato, anno per anno (incluso l'eventuale draft della
    // stagione successiva, se già fatto) — stesso discorso: fetch in parallelo.
    const nextYear = String(+SEASONS[SEASONS.length - 1] + 1);
    const draftResults = await Promise.all([...SEASONS, nextYear].map(async (year) => {
        try {
            return [year, await fetchDraftData(year)];
        } catch { return [year, null]; }
    }));

    for (const [year, draft] of draftResults) {
        if (!draft?.teams) continue;
        for (const pk of flattenDraft(draft)) {
            const c = careers.get(pk.player);
            const teamKey = TEAM_KEYS[displayName(pk.team)] || null;
            if (c && teamKey) c.draftedBy.push({ year, teamKey, pick: pk.pick, round: pk.round });
        }
    }

    // Premi di lega per carriera: MVP di stagione + All-Pro First/Second Team.
    // Stesso gate no-spoiler di getPlayerAwards (MVP a stagione svelata, AP a
    // regular season conclusa). Unica sorgente di verità: prima erano popolati
    // solo da hall-of-fame.js/attachAllPro, quindi assenti fuori dalla HOF.
    for (const season of SEASONS) {
        let bundle;
        try { bundle = await getHonorsBundle(season); } catch { continue; }
        if (!bundle) continue;
        if (bundle.revealed) {
            for (const a of bundle.awards) {
                if (a.id === 'mvp' && a.kind === 'player' && a.winner) {
                    const c = careers.get(a.winner.name);
                    if (c) c.mvp++;
                }
            }
        }
        if (bundle.rsComplete) {
            for (const { player } of bundle.allPro.first) {
                const c = player && careers.get(player.name);
                if (c) c.firstTeam++;
            }
            for (const { player } of bundle.allPro.second) {
                const c = player && careers.get(player.name);
                if (c) c.secondTeam++;
            }
        }
    }

    careersCache = careers;
    return careers;
}

/** Carriera di un giocatore: match esatto sul nome, poi fuzzy su normName. */
export async function getCareer(name) {
    const careers = await buildCareers();
    if (careers.has(name)) return careers.get(name);
    const target = normName(name);
    for (const c of careers.values()) {
        const cand = normName(c.name);
        if (cand === target || cand.includes(target) || target.includes(cand)) return c;
    }
    return null;
}

/**
 * Tutti i premi di lega vinti in carriera dal giocatore.
 * → { awards: [{year, id, name}], allProFirst: [anni], allProSecond: [anni] }
 * I premi nominati escono solo a stagione `revealed` (cerimonia fatta),
 * gli All-Pro solo a regular season conclusa — stessa regola della HOF.
 */
export async function getPlayerAwards(name) {
    const out = { awards: [], allProFirst: [], allProSecond: [] };
    for (const year of SEASONS) {
        let bundle;
        try {
            bundle = await getHonorsBundle(year);
        } catch { continue; }
        if (!bundle) continue;

        if (bundle.revealed) {
            for (const a of bundle.awards) {
                if (a.kind === 'player' && a.winner?.name === name) {
                    out.awards.push({ year, id: a.id, name: a.name });
                }
            }
        }
        if (bundle.rsComplete) {
            if (bundle.allPro.first.some(x => x.player?.name === name)) out.allProFirst.push(year);
            if (bundle.allPro.second.some(x => x.player?.name === name)) out.allProSecond.push(year);
        }
    }
    return out;
}
