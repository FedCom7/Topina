/**
 * Rosa completa e infortuni di squadra NFL, per il blocco "Compagni di
 * squadra" / "Infermeria squadra" della pagina giocatore/DEF.
 *
 * Union per campo: roster_{Y}.json (nflverse, tutte le posizioni + snap%)
 * arricchito con l'uso/pt-lega dei soli skill player da adv_players_{Y}.json
 * (già esposto da context-score.js::getTeamUsage). Se il JSON della stagione
 * manca (es. stagione corrente non ancora rilasciata da nflverse), fallback
 * live sul roster ESPN (stesso pattern di player-image-service.js).
 */

import { canonAbbr } from './nfl-schedule.js?v=20';
import { ESPN_TEAM_IDS } from './player-map.js?v=13';
import { getTeamUsage } from './context-score.js?v=51';

const _roster = {};   // year → roster json | null
const _injuries = {}; // year → injuries json | null
const _espnRoster = {}; // teamId → athletes[] live (cache in memoria, una sola chiamata per squadra)

async function fetchJson(url, timeoutMs = 10000) {
    // Timeout esplicito per non restare appesi su un endpoint lento/irraggiungibile.
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try { const r = await fetch(url, { signal: ctrl.signal }); return r.ok ? await r.json() : null; }
    catch { return null; }
    finally { clearTimeout(t); }
}

async function rosterJson(year) {
    if (year in _roster) return _roster[year];
    return (_roster[year] = await fetchJson(`data/nfl/roster_${year}.json`));
}
async function injuriesJson(year) {
    if (year in _injuries) return _injuries[year];
    return (_injuries[year] = await fetchJson(`data/nfl/injuries_${year}.json`));
}

/** Roster live ESPN (tutte le posizioni, con injuries embedded per atleta). */
async function espnRoster(abbr) {
    const teamId = ESPN_TEAM_IDS[abbr];
    if (!teamId) return null;
    if (_espnRoster[teamId]) return _espnRoster[teamId];
    const data = await fetchJson(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/${teamId}/roster`);
    if (!data?.athletes) return null;
    const athletes = data.athletes.flatMap(g => g.items || []);
    return (_espnRoster[teamId] = athletes);
}

/**
 * Rosa completa di una squadra/stagione, unita con uso fantasy per gli skill
 * player. Ritorna { source: 'build'|'espn-live', players: [...] }.
 */
export async function getTeamRoster(abbr, year) {
    const A = canonAbbr(abbr);
    const [roster, usage] = await Promise.all([rosterJson(year), getTeamUsage(A, year)]);
    const usageByGsis = Object.fromEntries(usage.map(p => [p.gsis, p]));

    const list = roster?.teams?.[A];
    if (list?.length) {
        // Unione con la rosa ESPN (dati che nflverse non ha: headshot, età, status
        // aggiornato). Match per nome normalizzato; ESPN riempie solo i vuoti.
        const espn = await espnRoster(A).catch(() => null);
        const espnByName = {};
        for (const a of espn || []) {
            espnByName[_normName(a.displayName || a.fullName || '')] = {
                headshot: a.headshot?.href || null,
                age: a.age ?? null,
                status: a.status?.name || null,
                jersey: a.jersey ? +a.jersey : null,
                yearsExp: a.experience?.years ?? null,                // anni di esperienza (0 = rookie)
                salary: a.contract?.salary ?? null,                   // stipendio base stagione corrente
            };
        }
        const players = list.map(p => {
            const u = usageByGsis[p.gsis];
            const e = espnByName[_normName(p.name)] || {};
            return {
                ...p,
                headshot: p.headshot || e.headshot || null,          // nuovo da ESPN
                age: p.age ?? e.age ?? null,                          // nuovo da ESPN
                status: p.status || e.status || null,                 // build → ESPN fallback
                jersey: p.jersey ?? e.jersey ?? null,
                yearsExp: e.yearsExp ?? p.yearsExp ?? null,           // esperienza da ESPN
                salary: e.salary ?? null,                             // stipendio da ESPN
                fpgLeague: u?.fpgLeague ?? null,
                targetShare: u?.targetShare ?? null,
                rushShare: u?.rushShare ?? null,
            };
        }).sort((a, b) => (b.fpgLeague || 0) - (a.fpgLeague || 0) || (a.pos || '').localeCompare(b.pos || ''));
        return { source: 'build', players };
    }

    // fallback live: nessun roster_{Y}.json per questa stagione
    const athletes = await espnRoster(A);
    if (!athletes?.length) return { source: null, players: [] };
    const players = athletes.map(a => ({
        gsis: null, name: a.displayName || a.fullName || '', pos: a.position?.abbreviation || null,
        jersey: a.jersey ? +a.jersey : null, status: a.status?.name || null, college: a.college?.name || null,
        yearsExp: a.experience?.years ?? null, salary: a.contract?.salary ?? null, depthPosition: null, snapPct: null,
        height: a.height ? String(a.height) : null, weight: a.weight || null,
        headshot: a.headshot?.href || null,
        draftClub: null, draftNumber: null, rookieYear: null,
        fpgLeague: null, targetShare: null, rushShare: null,
    }));
    return { source: 'espn-live', players };
}

/**
 * Depth chart live ESPN (stessa fonte scrapeta da nflverse per il suo nuovo
 * schema 2025+): un'unità per name ("Base 3-4 D"/"Base 4-3 D" = difesa,
 * "Special Teams" scartata, il resto = attacco), un atleta di testa (indice 0)
 * per slot = titolare.
 */
const _depth = {}; // teamId → { offense, defense, full } | null (cache in memoria)
async function espnDepthChart(abbr) {
    const teamId = ESPN_TEAM_IDS[abbr];
    if (!teamId) return null;
    if (teamId in _depth) return _depth[teamId];
    const data = await fetchJson(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/${teamId}/depthcharts`);
    const units = data?.depthchart;
    if (!units?.length) return (_depth[teamId] = null);
    // starters = athlete di testa per slot; full = intera profondità ordinata
    // (titolare, 2ª, 3ª scelta…) per un blocco "depth chart completo".
    const out = { offense: [], defense: [], special: [], full: { offense: [], defense: [], special: [] } };
    for (const unit of units) {
        // "Special Teams" → special; "Base N-N D" → difesa; il resto → attacco.
        const side = unit.name === 'Special Teams' ? 'special'
            : /^Base \d-\d D$/.test(unit.name || '') ? 'defense' : 'offense';
        for (const slot of Object.values(unit.positions || {})) {
            const list = slot.athletes || [];
            if (!list.length) continue;
            const pos = slot.position?.abbreviation || null;
            const head = list[0];
            const injOf = (a) => { const i = (a.injuries || [])[0]; return i ? { status: i.status || null, abbr: i.type?.abbreviation || null } : null; };
            out[side].push({ gsis: null, name: head.displayName || null, pos, jersey: null, injury: injOf(head) });
            out.full[side].push({
                pos,
                // ESPN depthcharts NON espone la maglia (a.jersey assente): resta null,
                // sarà riempita dal merge con nflverse. Espone invece gli infortuni.
                players: list.map(a => ({ name: a.displayName || null, jersey: null, injury: injOf(a) })),
            });
        }
    }
    return (_depth[teamId] = (out.offense.length || out.defense.length || out.special.length) ? out : null);
}

/**
 * Stagione NFL corrente calcolata dalla data: da MARZO (nuovo league year NFL)
 * la stagione è l'anno solare corrente; gennaio/febbraio (playoff/Super Bowl)
 * appartengono ancora alla stagione precedente. Avanza da sola ogni anno, così
 * l'etichetta e i dati della nuova stagione compaiono in preseason senza
 * interventi manuali. Es. ago 2026 → 2026, gen 2026 → 2025.
 */
export function currentNflSeason(d = new Date()) {
    return d.getMonth() + 1 >= 3 ? d.getFullYear() : d.getFullYear() - 1;
}

const DEPTH_ORDER = ['QB', 'RB', 'FB', 'WR', 'TE', 'LT', 'LG', 'C', 'RG', 'RT', 'T', 'G', 'OL', 'OT', 'OG',
    'DE', 'EDGE', 'DT', 'NT', 'DL', 'OLB', 'ILB', 'MLB', 'LB', 'CB', 'DB', 'S', 'FS', 'SS', 'SAF',
    'PK', 'K', 'P', 'H', 'LS', 'KR', 'PR'];
const OFF_SLOT = new Set(['QB', 'RB', 'FB', 'WR', 'TE', 'LT', 'LG', 'C', 'RG', 'RT', 'T', 'G', 'OL', 'OT', 'OG']);
const DEF_SLOT = new Set(['DE', 'EDGE', 'DT', 'NT', 'DL', 'OLB', 'ILB', 'MLB', 'LB', 'CB', 'DB', 'S', 'FS', 'SS', 'SAF']);
const SPECIAL_SLOT = new Set(['PK', 'K', 'P', 'H', 'LS', 'KR', 'PR']);

/**
 * Depth chart completo (profondità ordinata per slot). Costruito dal roster
 * nflverse della stagione (slot = depthPosition, ordine per snap% decrescente)
 * — così è accurato anche sulle stagioni PASSATE, che ESPN non copre. Fallback
 * al depth chart live ESPN quando il build manca (stagione corrente).
 * Ritorna { source, offense, defense } dove ogni voce è { pos, players:[{name, jersey}] }.
 */
export async function getTeamDepthChart(abbr, year) {
    const A = canonAbbr(abbr);

    // Depth chart nflverse (build): raggruppa per depthPosition, ordina per snap%.
    const nflBuild = async () => {
        const roster = year ? await rosterJson(year) : null;
        const list = roster?.teams?.[A];
        if (!list?.length) return null;
        const bySlot = { offense: {}, defense: {}, special: {} };
        for (const p of list) {
            const slot = p.depthPosition || p.pos;
            const side = OFF_SLOT.has(slot) ? 'offense' : DEF_SLOT.has(slot) ? 'defense' : SPECIAL_SLOT.has(slot) ? 'special' : null;
            if (!side) continue;
            (bySlot[side][slot] ??= []).push({ name: p.name, jersey: p.jersey ?? null, snapPct: p.snapPct ?? 0 });
        }
        const rank = (pos) => { const i = DEPTH_ORDER.indexOf(pos); return i === -1 ? 999 : i; };
        const build = (obj) => Object.entries(obj)
            .sort((a, b) => rank(a[0]) - rank(b[0]))
            .map(([pos, players]) => ({ pos, players: players.sort((a, b) => (b.snapPct || 0) - (a.snapPct || 0)).map(x => ({ name: x.name, jersey: x.jersey })) }));
        const offense = build(bySlot.offense), defense = build(bySlot.defense), special = build(bySlot.special);
        return (offense.length || defense.length || special.length) ? { source: 'build', offense, defense, special } : null;
    };

    // Depth chart ESPN (ufficiale) arricchito con la MAGLIA (ESPN /depthcharts non
    // la espone). La prendo dalla STESSA sorgente del roster — l'endpoint ESPN
    // /roster, che ha jersey ed è aggiornato alla stagione corrente — con fallback
    // sul roster nflverse per gli anni in cui il file esiste. Uniti per nome.
    const espnMerged = async () => {
        const dc = await espnDepthChart(A);
        if (!dc?.full || !(dc.full.offense.length || dc.full.defense.length)) return null;
        const [espnAth, roster] = await Promise.all([
            espnRoster(A).catch(() => null),
            year ? rosterJson(year) : Promise.resolve(null),
        ]);
        const jerseyByName = {};
        for (const a of (espnAth || [])) {
            const nm = _normName(a.displayName || a.fullName || '');
            if (nm && a.jersey) jerseyByName[nm] = +a.jersey;   // ESPN /roster: primaria
        }
        for (const p of (roster?.teams?.[A] || [])) {
            const nm = _normName(p.name);
            if (nm && jerseyByName[nm] == null && p.jersey != null) jerseyByName[nm] = p.jersey; // nflverse: fallback
        }
        const enrich = (side) => side.map(slot => ({
            pos: slot.pos,
            players: slot.players.map(pl => ({
                name: pl.name,
                jersey: pl.jersey ?? jerseyByName[_normName(pl.name || '')] ?? null,
                injury: pl.injury || null,
            })),
        }));
        return { source: 'espn-live', offense: enrich(dc.full.offense), defense: enrich(dc.full.defense), special: enrich(dc.full.special || []) };
    };

    // Stagione corrente → ESPN (ufficiale) con maglia nflverse; passate → nflverse.
    // In entrambi i casi l'altra fonte fa da fallback se la primaria manca.
    return Number(year) >= currentNflSeason()
        ? (await espnMerged()) || (await nflBuild())
        : (await nflBuild()) || (await espnMerged());
}

/**
 * Titolari attacco/difesa dall'ultimo depth chart disponibile: build
 * (nflverse, storico per stagione) con fallback live su ESPN (stessa fonte
 * che nflverse stesso scrapa dal 2025 — utile per stagioni/squadre non
 * ancora coperte dal prossimo cron). Uniti con l'uso fantasy per gli skill
 * player quando i gsis sono noti (solo lato build: ESPN non li espone).
 */
export async function getTeamStarters(abbr, year) {
    const A = canonAbbr(abbr);
    const [roster, usage] = await Promise.all([rosterJson(year), getTeamUsage(A, year)]);
    const usageByGsis = Object.fromEntries(usage.map(p => [p.gsis, p]));
    const withUsage = (list) => (list || []).map(p => ({ ...p, fpgLeague: usageByGsis[p.gsis]?.fpgLeague ?? null }));

    const starters = roster?.starters?.[A];
    if (starters?.offense?.length || starters?.defense?.length) {
        return { source: 'build', offense: withUsage(starters.offense), defense: withUsage(starters.defense) };
    }
    const live = await espnDepthChart(A);
    if (!live) return null;
    return { source: 'espn-live', offense: withUsage(live.offense), defense: withUsage(live.defense) };
}

/**
 * Ultimo report infortuni della squadra/stagione. Ritorna
 * { source: 'build'|'espn-live', players: [...] }.
 */
/** Righe infortunio ESPN dalla rosa live (stato attuale), forma comune. */
function espnInjuryRows(athletes) {
    return (athletes || [])
        .filter(a => a.injuries?.length)
        .map(a => {
            const inj = a.injuries[0];
            return {
                gsis: null, name: a.displayName || a.fullName || '', pos: a.position?.abbreviation || null,
                week: null, status: inj?.status || null,
                primaryInjury: inj?.details?.type || inj?.type || null,
                secondaryInjury: null, practiceStatus: null,
            };
        });
}

export async function getTeamInjuries(abbr, year) {
    const A = canonAbbr(abbr);
    const data = await injuriesJson(year);
    const list = data?.teams?.[A];
    // Unione build + ESPN: al report storico nflverse aggiungo gli infortunati
    // ATTUALI ESPN che il build (spesso fermo all'ultima settimana rilasciata)
    // non contiene ancora. ESPN riempie solo i buchi, nessun duplicato.
    if (list?.length) {
        const known = new Set(list.map(p => _normName(p.name)));
        const athletes = await espnRoster(A).catch(() => null);
        const extra = espnInjuryRows(athletes).filter(p => !known.has(_normName(p.name)));
        return { source: extra.length ? 'build+espn' : 'build', players: [...list, ...extra] };
    }

    // fallback live: injuries embedded nel roster ESPN (stagione corrente)
    const players = espnInjuryRows(await espnRoster(A));
    return { source: players.length ? 'espn-live' : null, players };
}

const _normName = (n) => (n || '').toLowerCase().replace(/[.,']/g, '').replace(/\s+/g, ' ').trim();

/**
 * Cronologia infortuni di un SINGOLO giocatore anno per anno. Cerca il suo
 * record (per gsis, fallback nome+ruolo) in ogni stagione richiesta, anche se
 * ha cambiato squadra. I dati infortuni nflverse partono dal 2019.
 * @returns [{ year, team, weeks }] dalla stagione più recente, solo anni con dati.
 */
export async function getPlayerInjuries(gsis, name, pos, years) {
    const list = [...new Set((years || []).map(Number).filter(y => y >= 2019))].sort((a, b) => b - a);
    const key = _normName(name);
    // fetch degli anni in parallelo (i JSON sono grossi: la sequenza sarebbe lenta)
    const datas = await Promise.all(list.map(y => injuriesJson(y)));
    const out = [];
    list.forEach((y, i) => {
        const data = datas[i];
        if (!data?.teams) return;
        for (const [team, players] of Object.entries(data.teams)) {
            const rec = players.find(p => (gsis && p.gsis === gsis) || (_normName(p.name) === key && (!pos || p.pos === pos)));
            if (rec) { out.push({ year: y, team, weeks: rec.weeks || [] }); break; }
        }
    });
    return out;
}
