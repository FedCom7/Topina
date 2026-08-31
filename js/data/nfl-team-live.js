/**
 * Endpoint ESPN live "squadra" e "lega" non coperti dal build nflverse.
 * Tutti gli host usati qui (site.api.espn.com, sports.core.api.espn.com,
 * site.web.api.espn.com) espongono `Access-Control-Allow-Origin: *`, quindi
 * il fetch diretto dal browser funziona (stesso pattern di
 * player-bio-extra.js / nfl-team-extras.js).
 *
 * Profilo squadra (identità+stadio+coach+record+prossima partita), Football
 * Power Index, calendario live con risultati, transactions, statistiche
 * ufficiali di stagione, odds Super Bowl; più i due dataset di lega
 * (classifica NFL reale e power ranking FPI) mostrati sotto la ricerca in
 * "NFL Hub".
 */

import { canonAbbr } from './nfl-schedule.js?v=546';
import { ESPN_TEAM_IDS } from './player-map.js?v=513';

const SITE = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl';
const CORE = 'https://sports.core.api.espn.com/v2/sports/football/leagues/nfl';

// id ESPN → sigla canonica (per risolvere i $ref team.$ref .../teams/{id})
const ID_TO_ABBR = Object.fromEntries(Object.entries(ESPN_TEAM_IDS).map(([a, id]) => [id, a]));
const abbrFromRef = (ref) => {
    const m = /\/teams\/(\d+)/.exec(ref || '');
    return m ? ID_TO_ABBR[m[1]] || null : null;
};

async function fetchJson(url, timeoutMs = 10000) {
    // Timeout esplicito: senza, un endpoint ESPN appeso bloccherebbe per sempre il
    // Promise.all iniziale della pagina squadra (spinner infinito). Con AbortController
    // la richiesta viene annullata e cade su null (gestito dai .catch dei chiamanti).
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try { const r = await fetch(url, { signal: ctrl.signal }); return r.ok ? await r.json() : null; }
    catch { return null; }
    finally { clearTimeout(t); }
}

const _cache = {}; // chiave → Promise (una sola chiamata di rete per risorsa/stagione)
function cached(key, loader) {
    return (_cache[key] ??= loader());
}

// ─── Profilo squadra: identità, stadio, record, prossima partita, coach ──

/**
 * Anagrafica live della squadra dall'endpoint dettaglio (teams/{id}) unito al
 * capo-allenatore dal roster. Ritorna null se la sigla non è mappata.
 */
const _college = {}; // $ref → nome college (cache)
async function collegeName(ref) {
    if (!ref) return null;
    if (ref in _college) return _college[ref];
    const c = await fetchJson(ref);
    return (_college[ref] = c?.name || null);
}

/** Team (id) di un coach in una data stagione — l'unica direzione accurata. */
async function coachTeamId(coachId, year) {
    const c = await fetchJson(`${CORE}/seasons/${year}/coaches/${coachId}`);
    const m = /teams\/(\d+)/.exec(c?.team?.$ref || '');
    return m ? m[1] : null;
}

/** Anni consecutivi (dal più recente, fino a `season`) del coach con `teamId`. */
async function coachTeamTenure(global, coachId, teamId, season) {
    const yrs = (global?.coachSeasons || [])
        .map(r => { const m = /seasons\/(\d+)/.exec(r.$ref || ''); return m ? +m[1] : null; })
        .filter(y => y != null && y <= +season)
        .sort((a, b) => b - a);
    if (!yrs.length) return null;
    let lo = 0, hi = yrs.length; // ricerca binaria: permanenza contigua
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if ((await coachTeamId(coachId, yrs[mid])) === String(teamId)) lo = mid + 1;
        else hi = mid;
    }
    return lo || null;
}

/**
 * Head coach della squadra con tutte le info ESPN: anagrafica (età/luogo/
 * college), esperienza in carriera, anni con la squadra, record di carriera
 * (totale/regular/playoff). NB: ESPN non ha uno storico coach affidabile
 * (team→coach ritorna sempre l'ATTUALE, e la lista coach delle stagioni
 * passate è spesso vuota) → si mostra il coach attuale, con le statistiche
 * calcolate fino alla stagione selezionata (esperienza/anni/età).
 */
async function teamHeadCoach(teamId, season) {
    const listedRef = (await fetchJson(`${CORE}/seasons/${season}/teams/${teamId}/coaches`))?.items?.[0]?.$ref;
    if (!listedRef) return null;
    const coachId = /coaches\/(\d+)/.exec(listedRef)?.[1] || null;
    const cy = await fetchJson(listedRef);
    if (!cy) return null;

    const bp = cy.birthPlace;
    const [global, recTotal, recReg, recPost, college] = await Promise.all([
        fetchJson(`${CORE}/coaches/${coachId}`),
        fetchJson(`${CORE}/coaches/${coachId}/record/0`),
        fetchJson(`${CORE}/coaches/${coachId}/record/2`),
        fetchJson(`${CORE}/coaches/${coachId}/record/3`),
        collegeName(cy.college?.$ref),
    ]);
    const teamTenure = await coachTeamTenure(global, coachId, teamId, season).catch(() => null);
    const birthYear = cy.dateOfBirth ? +cy.dateOfBirth.slice(0, 4) : null;

    return {
        name: `${cy.firstName || ''} ${cy.lastName || ''}`.trim() || null,
        experience: cy.experience ?? null,
        teamTenure,
        college,
        headshot: cy.headshot?.href || global?.headshot?.href || null,
        birthPlace: bp ? [bp.city, bp.state, bp.country].filter(Boolean).join(', ') : null,
        age: birthYear ? (+season - birthYear) : null, // età nella stagione mostrata
        recordTotal: recTotal?.summary || null,
        recordRegular: recReg?.summary || null,
        recordPost: recPost?.summary || null,
    };
}

export async function getTeamProfile(abbr, season) {
    const A = canonAbbr(abbr);
    const teamId = ESPN_TEAM_IDS[A];
    if (!teamId) return null;
    return cached(`profile-${teamId}-${season}`, async () => {
        const [detail, roster, recordData, coach] = await Promise.all([
            fetchJson(`${SITE}/teams/${teamId}?season=${season}`),
            fetchJson(`${SITE}/teams/${teamId}/roster`),
            fetchJson(`${CORE}/seasons/${season}/types/2/teams/${teamId}/record`), // canonico: con split
            teamHeadCoach(teamId, season),                                        // canonico: con college/headshot
        ]);
        const t = detail?.team;
        if (!t) return null;
        const rec = t.record?.items?.find(i => i.type === 'total') || t.record?.items?.[0] || null;
        const recStats = Object.fromEntries((rec?.stats || []).map(s => [s.name, s.value]));
        const venue = t.franchise?.venue || null;
        const next = t.nextEvent?.[0] || null;
        const nextComp = next?.competitions?.[0] || null;

        // Record con split (casa/trasferta/divisione/conference) dall'endpoint dedicato.
        const recByType = Object.fromEntries((recordData?.items || []).map(r => [r.type, r.summary]));
        const recordSplits = {
            overall: recByType.total || rec?.summary || null,
            home: recByType.home || null, road: recByType.road || null,
            div: recByType.vsdiv || null, conf: recByType.vsconf || null,
        };
        // Coach: canonico (core) con fallback sul coach del roster (solo nome/exp).
        const rosterCoach = roster?.coach?.[0] || null;
        const coachOut = coach || (rosterCoach ? {
            name: `${rosterCoach.firstName || ''} ${rosterCoach.lastName || ''}`.trim(),
            experience: rosterCoach.experience ?? null, college: null, headshot: null, birthPlace: null,
        } : null);

        return {
            recordSplits, coach: coachOut,
            abbr: A,
            displayName: t.displayName || null,
            location: t.location || null,
            nickname: t.nickname || null,
            color: t.color ? `#${t.color}` : null,
            altColor: t.alternateColor ? `#${t.alternateColor}` : null,
            logo: t.logos?.[0]?.href || null,
            standingSummary: t.standingSummary || null,
            record: rec ? { summary: rec.summary || null, ...recStats } : null,
            venue: venue ? {
                name: venue.fullName || null,
                city: venue.address?.city || null,
                state: venue.address?.state || null,
                capacity: venue.capacity || null,
                grass: venue.grass ?? null,
                indoor: venue.indoor ?? null,
                image: venue.images?.[0]?.href || null,
            } : null,
            nextEvent: next && nextComp ? {
                name: next.name || null,
                shortName: next.shortName || null,
                date: next.date || null,
                week: next.week?.text || null,
                venue: nextComp.venue?.fullName || null,
            } : null,
        };
    });
}

// ─── Football Power Index (season-level) ─────────────────────────────────

/** Mappa abbr → FPI per l'intera lega in una stagione (una sola chiamata). */
async function powerIndexAll(season) {
    return cached(`fpi-${season}`, async () => {
        const data = await fetchJson(`${CORE}/seasons/${season}/powerindex?limit=40`);
        const out = {};
        for (const it of data?.items || []) {
            const A = abbrFromRef(it.team?.$ref);
            if (!A) continue;
            const p = Object.fromEntries((it.predictives || []).map(s => [s.name, s.value]));
            out[A] = {
                fpi: p.fpi ?? null, rank: p.fpirank ?? null,
                projW: p.projectedw ?? null, projL: p.projectedl ?? null, projT: p.projectedt ?? null,
            };
        }
        return out;
    });
}

/** FPI di una singola squadra in una stagione, o null. */
export async function getTeamPowerIndex(abbr, season) {
    const all = await powerIndexAll(season);
    return all[canonAbbr(abbr)] || null;
}

// ─── Calendario live con risultati ───────────────────────────────────────

/**
 * Calendario ESPN della stagione: una riga per gara con avversario, casa/fuori,
 * esito e punteggio (dove la gara si è giocata). Ritorna [] se non disponibile.
 */
export async function getTeamScheduleLive(abbr, season) {
    const A = canonAbbr(abbr);
    const teamId = ESPN_TEAM_IDS[A];
    if (!teamId) return [];
    return cached(`sched-${teamId}-${season}`, async () => {
        const data = await fetchJson(`${SITE}/teams/${teamId}/schedule?season=${season}`);
        return (data?.events || []).map(ev => {
            const comp = ev.competitions?.[0] || {};
            const cs = comp.competitors || [];
            const me = cs.find(c => c.team?.id === teamId) || cs.find(c => c.homeAway && c.team?.abbreviation);
            const opp = cs.find(c => c !== me) || null;
            const scoreOf = (c) => {
                const s = c?.score;
                if (s == null) return null;
                return typeof s === 'object' ? (s.displayValue ?? s.value ?? null) : s;
            };
            const status = comp.status?.type?.state || ev.competitions?.[0]?.status?.type?.name || null;
            return {
                eventId: ev.id || comp.id || null,
                week: ev.week?.text || (ev.week?.number != null ? `Week ${ev.week.number}` : null),
                date: ev.date || null,
                name: ev.shortName || ev.name || null,
                opp: opp?.team?.abbreviation ? canonAbbr(opp.team.abbreviation) : null,
                oppName: opp?.team?.displayName || null,
                homeAway: me?.homeAway || null,
                completed: !!comp.status?.type?.completed,
                winner: me?.winner ?? null,
                score: scoreOf(me), oppScore: scoreOf(opp),
                status,
            };
        });
    });
}

/**
 * Calendario COMPLETO stile ESPN: preseason (seasontype 1), regular (2) e
 * postseason (3) in un'unica lista, ognuno con tipo stagione, data e risultato.
 * ESPN separa le tre stagioni per parametro, quindi 3 fetch in parallelo.
 */
export async function getTeamScheduleFull(abbr, season) {
    const A = canonAbbr(abbr);
    const teamId = ESPN_TEAM_IDS[A];
    if (!teamId) return [];
    return cached(`schedfull-${teamId}-${season}`, async () => {
        const parts = await Promise.all([1, 2, 3].map(st =>
            fetchJson(`${SITE}/teams/${teamId}/schedule?season=${season}&seasontype=${st}`)));
        const out = [];
        parts.forEach((data, i) => {
            for (const ev of (data?.events || [])) {
                const comp = ev.competitions?.[0] || {};
                const cs = comp.competitors || [];
                const me = cs.find(c => c.team?.id === teamId) || null;
                const opp = cs.find(c => c !== me) || null;
                const scoreOf = (c) => {
                    const s = c?.score;
                    if (s == null) return null;
                    return typeof s === 'object' ? (s.displayValue ?? s.value ?? null) : s;
                };
                out.push({
                    eventId: ev.id || comp.id || null,
                    seasonType: ev.seasonType?.type || (i + 1),   // 1 pre · 2 reg · 3 post
                    weekText: ev.week?.text || null,
                    weekNum: ev.week?.number ?? null,
                    date: ev.date || null,
                    opp: opp?.team?.abbreviation ? canonAbbr(opp.team.abbreviation) : null,
                    oppName: opp?.team?.displayName || null,
                    homeAway: me?.homeAway || null,
                    completed: !!comp.status?.type?.completed,
                    state: comp.status?.type?.state || null,       // pre · in · post
                    timeValid: ev.timeValid !== false,             // false = orario TBD (flex)
                    tv: comp.broadcasts?.[0]?.media?.shortName || null,
                    winner: me?.winner ?? null,
                    score: scoreOf(me), oppScore: scoreOf(opp),
                });
            }
        });
        return out;
    });
}

// ─── Transactions (firme/tagli/waiver) ───────────────────────────────────

/**
 * Movimenti roster per stagione (come la pagina transactions di ESPN, filtrabile
 * per anno). L'endpoint per-squadra ESPN (`/teams/{id}/transactions`) è rotto e
 * ritorna `{}`; quello di lega (`/transactions?season=YYYY`, ordinato per data
 * desc) funziona e ha su ogni voce `team.id` ma non filtra per squadra lato
 * server. Si paginano (100/pagina) le pagine dell'anno finché non si raccolgono
 * ~20 movimenti della squadra, con un tetto di pagine per limitare le richieste.
 */
export async function getTeamTransactions(abbr, year) {
    const A = canonAbbr(abbr);
    const teamId = String(ESPN_TEAM_IDS[A] || '');
    if (!teamId) return [];
    const seasonQ = year ? `&season=${year}` : '';
    return cached(`txn-${teamId}-${year || 'latest'}`, async () => {
        const MAX_PAGES = 12, WANT = 20, BATCH = 3;
        const out = [];
        const collect = (d) => {
            for (const t of (d?.transactions || [])) {
                if (String(t.team?.id) === teamId && (t.description || t.displayText))
                    out.push({ date: t.date || null, description: t.description || t.displayText });
            }
        };
        const first = await fetchJson(`${SITE}/transactions?limit=100&page=1${seasonQ}`);
        if (!first) return [];
        const pageCount = Math.min(first.pageCount || 1, MAX_PAGES);
        collect(first);
        let p = 2;
        while (out.length < WANT && p <= pageCount) {
            const batch = [];
            for (let i = 0; i < BATCH && p <= pageCount; i++, p++)
                batch.push(fetchJson(`${SITE}/transactions?limit=100&page=${p}${seasonQ}`));
            (await Promise.all(batch)).forEach(collect);
        }
        return out.slice(0, WANT);
    });
}

// ─── Statistiche ufficiali di stagione (ESPN, con rank) ──────────────────

const STAT_CAT_LABELS = {
    general: 'Generale', passing: 'Lancio', rushing: 'Corsa', receiving: 'Ricezione',
    defensive: 'Difesa', defensiveInterceptions: 'Intercetti', kicking: 'Kicking',
    returning: 'Ritorni', punting: 'Punting', scoring: 'Punti', miscellaneous: 'Varie',
};

/**
 * Stat sheet ufficiale ESPN della squadra: categorie (lancio/corsa/difesa/…)
 * con valore e rank 1-32 per ogni voce. È l'aggregato stagionale a cui le
 * competitors/{id}/statistics per-gara fanno capo. Ritorna [] se assente.
 */
export async function getTeamSeasonStats(abbr, season) {
    const A = canonAbbr(abbr);
    const teamId = ESPN_TEAM_IDS[A];
    if (!teamId) return [];
    return cached(`teamstats-${teamId}-${season}`, async () => {
        const data = await fetchJson(`${CORE}/seasons/${season}/types/2/teams/${teamId}/statistics`);
        const cats = data?.splits?.categories || [];
        return cats.map(c => ({
            key: c.name,
            label: STAT_CAT_LABELS[c.name] || c.displayName || c.name,
            stats: (c.stats || [])
                .filter(s => s.displayValue != null && s.rankDisplayValue)
                .map(s => ({
                    label: s.displayName || s.name,
                    value: s.displayValue,
                    rank: s.rankDisplayValue || null,
                })),
        })).filter(c => c.stats.length);
    });
}

/**
 * Tabellino (box score) della squadra in una singola partita, dall'endpoint
 * competitors/{teamId}/statistics. Ritorna categorie [{label, stats:[{label,value}]}]
 * (senza rank: è il dato per-gara, non stagionale). [] se non disponibile.
 */
export async function getTeamGameBoxscore(abbr, eventId) {
    const A = canonAbbr(abbr);
    const teamId = ESPN_TEAM_IDS[A];
    if (!teamId || !eventId) return [];
    return cached(`box-${eventId}-${teamId}`, async () => {
        const data = await fetchJson(`${CORE}/events/${eventId}/competitions/${eventId}/competitors/${teamId}/statistics`);
        const cats = data?.splits?.categories || [];
        return cats.map(c => ({
            key: c.name,
            label: STAT_CAT_LABELS[c.name] || c.displayName || c.name,
            stats: (c.stats || [])
                .filter(s => s.displayValue != null && s.displayValue !== '' && s.displayValue !== '0')
                .map(s => ({ label: s.displayName || s.name, value: s.displayValue })),
        })).filter(c => c.stats.length);
    });
}

// ─── Dettaglio partita (game summary) ────────────────────────────────────

/**
 * Riepilogo completo di una partita (endpoint `summary`): punteggio finale,
 * confronto statistico fra le due squadre (box score), sintesi delle
 * segnature, info gara (stadio/spettatori/arbitri) e win probability finale.
 * Un solo fetch che raccoglie ciò che altrimenti richiederebbe
 * competitors/statistics + scoringplays + probabilities + gameinfo separati.
 */
export async function getGameSummary(eventId) {
    if (!eventId) return null;
    return cached(`summary-${eventId}`, async () => {
        const [d, pred, oddsData] = await Promise.all([
            fetchJson(`${SITE}/summary?event=${eventId}`),
            fetchJson(`${CORE}/events/${eventId}/competitions/${eventId}/predictor`),
            fetchJson(`${CORE}/events/${eventId}/competitions/${eventId}/odds`),
        ]);
        if (!d) return null;
        const comp = d.header?.competitions?.[0] || {};
        const competitors = (comp.competitors || []).map(c => ({
            abbr: canonAbbr(c.team?.abbreviation || ''),
            name: c.team?.nickname || c.team?.shortDisplayName || c.team?.displayName || null,
            home: c.homeAway === 'home',
            score: c.score ?? null,
            winner: c.winner ?? null,
            record: (c.record || []).find(r => r.type === 'total')?.summary || c.record?.[0]?.summary || null,
            line: (c.linescores || []).map(x => x.displayValue ?? x.value ?? ''),   // punti per quarto
        }));
        const homeAbbr = competitors.find(c => c.home)?.abbr || null;

        const teamStats = (d.boxscore?.teams || []).map(t => ({
            abbr: canonAbbr(t.team?.abbreviation || ''),
            home: canonAbbr(t.team?.abbreviation || '') === homeAbbr,
            stats: (t.statistics || []).map(s => ({ label: s.label || s.name, value: s.displayValue ?? '' })),
        }));

        // Down&distance + posizione in campo delle segnature: le scoringPlays non
        // li hanno, si recuperano dalle giocate dei drive (downDistanceText, es.
        // "4th & 7 at NE 14"), agganciando per punteggio progressivo (chiave univoca).
        const scPos = {};
        for (const dr of (d.drives?.previous || [])) for (const pl of (dr.plays || [])) {
            if (!pl.scoringPlay) continue;
            scPos[`${pl.awayScore}-${pl.homeScore}`] = pl.start?.downDistanceText || pl.start?.shortDownDistanceText || pl.start?.possessionText || null;
        }
        const scoring = (d.scoringPlays || []).map(p => ({
            q: p.period?.number ?? null,
            clock: p.clock?.displayValue || null,
            team: canonAbbr(p.team?.abbreviation || ''),
            type: p.scoringType?.displayName || null,
            text: p.text || null,
            pos: scPos[`${p.awayScore}-${p.homeScore}`] || null,   // down&distance + posizione ("4th & 7 at NE 14")
            home: p.homeScore ?? null, away: p.awayScore ?? null,
        }));

        const gi = d.gameInfo || {};
        const gameInfo = {
            venue: gi.venue?.fullName || null,
            city: gi.venue?.address?.city || null,
            attendance: gi.attendance || null,
            officials: (gi.officials || []).map(o => o.displayName || o.fullName).filter(Boolean),
        };
        const wp = d.winprobability || [];
        const lastWp = wp[wp.length - 1] || null;
        const firstWp = wp[0] || null;

        // Drive chart (#1): riassunto drive-per-drive + play-by-play (ogni snap).
        // playLoc mappa playId → {di, pi} (indice drive + indice giocata) per
        // sincronizzare lo scrubbing della win probability con campo e tabella.
        const playLoc = {};
        const drives = (d.drives?.previous || []).map((dr, di) => ({
            team: canonAbbr(dr.team?.abbreviation || ''),
            desc: dr.description || null,
            result: dr.displayResult || dr.result || null,
            yards: dr.yards ?? null,
            playCount: dr.plays?.length ?? dr.offensivePlays ?? null,
            start: dr.start?.text || null, end: dr.end?.text || null,
            plays: (dr.plays || []).map((p, pi) => {
                if (p.id) playLoc[p.id] = { di, pi };
                return {
                    q: p.period?.number ?? null,
                    clock: p.clock?.displayValue || null,
                    dd: p.start?.downDistanceText || null,
                    text: p.text || null,
                    scoring: !!p.scoringPlay,
                    penalty: !!p.isPenalty,
                    turnover: !!p.isTurnover,
                    away: p.awayScore ?? null, home: p.homeScore ?? null,
                    s2e: p.start?.yardsToEndzone ?? null, e2e: p.end?.yardsToEndzone ?? null, // posizione sul campo
                    gain: p.statYardage ?? null, type: p.type?.text || null,             // yard guadagnate + tipo giocata
                };
            }),
        }));

        // Proiezione ESPN + linea (#5): il predictor funziona anche a gara
        // conclusa (proiezione pre-gara); le quote spesso mancano sulle gare passate.
        const projStat = (side) => {
            const s = (pred?.[side]?.statistics || []).find(x => x.name === 'gameProjection');
            return s ? (s.value ?? parseFloat(s.displayValue)) : null;
        };
        const prediction = pred ? { homePct: projStat('homeTeam'), awayPct: projStat('awayTeam') } : null;
        const o = oddsData?.items?.find(i => i.spread != null || i.overUnder != null || i.details) || null;
        const odds = o ? {
            provider: o.provider?.name || null, details: o.details || null,
            spread: o.spread ?? null, overUnder: o.overUnder ?? null,
        } : null;

        // Game leaders (per squadra): lancio/corsa/ricezione + sack/tackle, in
        // stile ESPN: numero grande (value), linea di dettaglio (displayValue
        // senza le YDS), foto/ruolo dell'atleta.
        const LEADER_CATS = ['passingYards', 'rushingYards', 'receivingYards', 'sacks', 'totalTackles'];
        const leaders = (d.leaders || []).map(tl => ({
            abbr: canonAbbr(tl.team?.abbreviation || ''),
            home: canonAbbr(tl.team?.abbreviation || '') === homeAbbr,
            cats: (tl.leaders || []).filter(c => LEADER_CATS.includes(c.name)).map(c => {
                const ld = c.leaders?.[0] || {};
                const ath = ld.athlete || {};
                const big = ld.value != null ? String(ld.value).replace(/\.0$/, '') : (ld.displayValue || '');
                // Dettaglio = linea completa senza il segmento "N YDS"; scarto se
                // resta solo un numero (es. tackle "11" → nessun dettaglio).
                let detail = (ld.displayValue || '')
                    .replace(/\s*\d+(?:\.\d+)?\s*YDS,?/i, '')
                    .replace(/\s{2,}/g, ' ')
                    .replace(/^[,\s]+|[,\s]+$/g, '')
                    .trim();
                if (!/[a-z]/i.test(detail)) detail = '';
                return {
                    key: c.name, value: big, detail,
                    athlete: ath.shortName || ath.displayName || '',
                    pos: ath.position?.abbreviation || '',
                    headshot: ath.headshot?.href || '',
                };
            }).filter(c => c.athlete),
        })).filter(t => t.cats.length);

        // Box score giocatori per squadra e categoria (passing/rushing/receiving/…).
        const boxPlayers = (d.boxscore?.players || []).map(tp => ({
            abbr: canonAbbr(tp.team?.abbreviation || ''),
            home: canonAbbr(tp.team?.abbreviation || '') === homeAbbr,
            groups: (tp.statistics || []).map(g => ({
                name: g.name, label: g.text || g.name, labels: g.labels || [],
                athletes: (g.athletes || []).map(a => ({
                    name: a.athlete?.displayName || a.athlete?.shortName || '',
                    pos: a.athlete?.position?.abbreviation || '',
                    jersey: a.athlete?.jersey || '',
                    stats: a.stats || [],
                })).filter(a => a.name),
                totals: g.totals || null,
            })).filter(g => g.athletes.length),
        })).filter(t => t.groups.length);

        // Win probability arricchito con l'azione: ogni campione porta down&distance,
        // punteggio progressivo, quarto/orologio e gli indici drive/play (di, pi)
        // così lo scrubbing del grafico guida scorebug, campo e tabella.
        const playById = {};
        for (const dr of (d.drives?.previous || [])) for (const p of (dr.plays || [])) if (p.id) playById[p.id] = p;
        const winprob = wp.map(x => {
            const p = playById[x.playId];
            const loc = x.playId ? playLoc[x.playId] : null;
            return {
                homePct: x.homeWinPercentage != null ? x.homeWinPercentage : null,
                q: p?.period?.number ?? null, clock: p?.clock?.displayValue || null,
                dd: p?.start?.downDistanceText || p?.start?.shortDownDistanceText || null,
                away: p?.awayScore ?? null, home: p?.homeScore ?? null,
                text: p?.text || null, scoring: !!p?.scoringPlay,
                di: loc?.di ?? null, pi: loc?.pi ?? null,
            };
        }).filter(x => x.homePct != null);

        return {
            status: comp.status?.type?.description || null,
            week: d.header?.week ?? null,
            season: d.header?.season?.year ?? null,
            date: comp.date || null,
            competitors, homeAbbr, teamStats, scoring, gameInfo, drives, prediction, odds,
            leaders, boxPlayers, winprob,
            homeWinPct: lastWp?.homeWinPercentage ?? null,
            homeWinPctStart: firstWp?.homeWinPercentage ?? null,
        };
    });
}

// ─── Leader statistici di squadra ────────────────────────────────────────

const _athleteName = {}; // $ref → nome (cache: i leader condividono gli stessi atleti)
async function athleteNameFromRef(ref) {
    if (!ref) return null;
    if (ref in _athleteName) return _athleteName[ref];
    const d = await fetchJson(ref);
    return (_athleteName[ref] = d?.displayName || d?.fullName || null);
}

const LEADER_CATS = [
    ['passingYards', 'Yard su lancio'], ['rushingYards', 'Yard su corsa'],
    ['receivingYards', 'Yard in ricezione'], ['totalTackles', 'Tackle'],
    ['sacks', 'Sack'], ['interceptions', 'Intercetti'],
];

/**
 * Leader statistici della squadra nella stagione (core team/leaders): per ogni
 * categoria chiave, giocatore in testa e valore. Risolve i nomi via $ref.
 */
export async function getTeamLeaders(abbr, season) {
    const A = canonAbbr(abbr);
    const teamId = ESPN_TEAM_IDS[A];
    if (!teamId) return [];
    return cached(`leaders-${teamId}-${season}`, async () => {
        const data = await fetchJson(`${CORE}/seasons/${season}/types/2/teams/${teamId}/leaders`);
        const byName = Object.fromEntries((data?.categories || []).map(c => [c.name, c]));
        const out = await Promise.all(LEADER_CATS.map(async ([key, label]) => {
            const cat = byName[key];
            const lead = cat?.leaders?.[0];
            if (!lead) return null;
            const name = await athleteNameFromRef(lead.athlete?.$ref);
            if (!name) return null;
            return { label, name, value: lead.displayValue ?? lead.value ?? null };
        }));
        return out.filter(Boolean);
    });
}

// ─── Leaderboard di lega per categoria (#7) ──────────────────────────────
// L'endpoint site.web `statistics/byathlete` è morto (400 interno): si usa il
// core `seasons/{y}/types/2/leaders`, che espone i leader NFL per categoria.

const LEAGUE_LEADER_CATS = [
    ['passingYards', 'Yard su lancio'], ['passingTouchdowns', 'TD su lancio'],
    ['rushingYards', 'Yard su corsa'], ['rushingTouchdowns', 'TD su corsa'],
    ['receivingYards', 'Yard in ricezione'], ['receptions', 'Ricezioni'],
    ['sacks', 'Sack'], ['interceptions', 'Intercetti'], ['totalTackles', 'Tackle'],
];

/**
 * Leaderboard NFL per categoria (top 5), con nome giocatore e squadra risolti
 * dai $ref. Per la sezione "NFL Hub". Ritorna [{key, label, rows:[{rank,name,team,value}]}].
 */
export async function getLeagueLeaders(season, topN = 5) {
    return cached(`leagueleaders-${season}-${topN}`, async () => {
        const data = await fetchJson(`${CORE}/seasons/${season}/types/2/leaders`);
        const byName = Object.fromEntries((data?.categories || []).map(c => [c.name, c]));
        const out = await Promise.all(LEAGUE_LEADER_CATS.map(async ([key, label]) => {
            const cat = byName[key];
            const top = (cat?.leaders || []).slice(0, topN);
            if (!top.length) return null;
            const rows = await Promise.all(top.map(async (l, i) => ({
                rank: i + 1,
                name: await athleteNameFromRef(l.athlete?.$ref),
                team: abbrFromRef(l.team?.$ref),
                value: l.displayValue ?? l.value ?? null,
            })));
            return { key, label, rows: rows.filter(r => r.name) };
        }));
        return out.filter(c => c && c.rows.length);
    });
}

// ─── Feed notizie (now.core.api) ─────────────────────────────────────────

/**
 * Ultime notizie NFL (now.core.api). `team` opzionale (sigla ESPN minuscola)
 * per filtrare sulla squadra. Ritorna [{headline, published, link, type}].
 */
export async function getNews(team, limit = 10) {
    const q = team ? `&team=${team.toLowerCase()}` : '';
    return cached(`news-${team || 'league'}-${limit}`, async () => {
        const d = await fetchJson(`https://now.core.api.espn.com/v1/sports/news?sport=football&leagues=nfl${q}&limit=${limit}`);
        return (d?.headlines || []).map(h => ({
            headline: h.headline || h.description || null,
            published: h.published || null,
            link: h.links?.web?.href || h.links?.[0]?.href || null,
            type: h.type || null,
        })).filter(n => n.headline);
    });
}

// ─── Odds Super Bowl (futures) ───────────────────────────────────────────

/**
 * Quota Super Bowl della squadra dal mercato futures ESPN (primo book
 * disponibile). Ritorna { odds, provider } o null.
 */
export async function getTeamFutures(abbr, season) {
    const A = canonAbbr(abbr);
    const teamId = ESPN_TEAM_IDS[A];
    if (!teamId) return null;
    const data = await cached(`futures-${season}`, () => fetchJson(`${CORE}/seasons/${season}/futures?limit=50`));
    const market = (data?.items || []).find(i => /super bowl/i.test(i.name || ''));
    const provider = market?.futures?.[0];
    const book = (provider?.books || []).find(b => abbrFromRef(b.team?.$ref) === A);
    if (!book) return null;
    return { odds: book.value ?? book.displayValue ?? null, provider: provider.provider?.name || null };
}

// ─── Lega: classifica NFL reale ──────────────────────────────────────────

/**
 * Classifica NFL per conference (AFC/NFC) con record, %, seed playoff, streak,
 * punti fatti/subiti. Per la sezione "NFL Hub" sotto la barra di ricerca.
 */
export async function getLeagueStandings(season) {
    return cached(`standings-${season}`, async () => {
        const data = await fetchJson(`https://site.api.espn.com/apis/v2/sports/football/nfl/standings?season=${season}`);
        const conferences = (data?.children || []).map(conf => {
            const entries = (conf.standings?.entries || []).map(e => {
                const st = Object.fromEntries((e.stats || []).map(s => [s.name, s]));
                const num = (n) => st[n]?.value ?? null;
                const disp = (n) => st[n]?.displayValue ?? null;
                return {
                    abbr: canonAbbr(e.team?.abbreviation || ''),
                    name: e.team?.displayName || null,
                    wins: num('wins'), losses: num('losses'), ties: num('ties'),
                    winPct: disp('winPercent'), seed: num('playoffSeed'),
                    pf: num('pointsFor'), pa: num('pointsAgainst'),
                    diff: disp('pointDifferential') || disp('differential'),
                    streak: disp('streak'), clincher: disp('clincher'),
                };
            }).sort((a, b) => (a.seed ?? 99) - (b.seed ?? 99));
            return { name: conf.name || conf.shortName || '', abbr: conf.abbreviation || '', entries };
        });
        return conferences.filter(c => c.entries.length);
    });
}

/**
 * Power ranking di lega = squadre ordinate per FPI (l'endpoint /rankings
 * dedicato ESPN è vuoto; il Power Index è la fonte "forza squadra"
 * ufficiale). Ritorna [{ rank, abbr, fpi, projW, projL }].
 */
export async function getLeaguePowerRankings(season) {
    const all = await powerIndexAll(season);
    return Object.entries(all)
        .filter(([, v]) => v.fpi != null)
        .map(([abbr, v]) => ({ abbr, ...v }))
        .sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99));
}
