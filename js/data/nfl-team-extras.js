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

import { canonAbbr } from './nfl-schedule.js?v=546';
import { ESPN_TEAM_IDS } from './player-map.js?v=513';
import { getTeamUsage } from './context-score.js?v=643';

const _roster = {};   // year → roster json | null
const _injuries = {}; // year → injuries json | null
const _inactives = {}; // year → inactives json | null
const _unrosteredScores = {}; // year → unrostered_scores json | null
const _bestAvailable = {}; // year → best_available json | null
const _playerStatus = {}; // year → player_status json (settimane in IR) | null
const _espnRoster = {}; // teamId → athletes[] live (cache in memoria, una sola chiamata per squadra)

async function fetchJson(url, timeoutMs = 10000) {
    // Timeout esplicito per non restare appesi su un endpoint lento/irraggiungibile.
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try { const r = await fetch(url, { signal: ctrl.signal }); return r.ok ? await r.json() : null; }
    catch { return null; }
    finally { clearTimeout(t); }
}

/**
 * In cache va la PROMESSA, non il risultato: questi file li chiedono decine di
 * chiamate in parallelo (un getPlayerInjuries per giocatore), e con l'`await`
 * prima dell'assegnazione nessuna di quelle trovava la cache già piena —
 * partivano tutte. Misurato: 107 download dello stesso injuries_2025.json
 * (1,7 MB l'uno) per una singola apertura di Analysis. Restituendo la promessa
 * la prima chiamata scarica e le altre si agganciano a quella.
 * Un fallimento resta in cache come promessa-di-null, esattamente come prima:
 * un file che non esiste (es. la stagione non ancora pubblicata) non va
 * richiesto altre cinquanta volte.
 */
function rosterJson(year) {
    if (year in _roster) return _roster[year];
    return (_roster[year] = fetchJson(`data/nfl/roster_${year}.json`));
}
function injuriesJson(year) {
    if (year in _injuries) return _injuries[year];
    return (_injuries[year] = fetchJson(`data/nfl/injuries_${year}.json`));
}
function inactivesJson(year) {
    if (year in _inactives) return _inactives[year];
    return (_inactives[year] = fetchJson(`data/nfl/inactives_${year}.json`));
}
function unrosteredScoresJson(year) {
    if (year in _unrosteredScores) return _unrosteredScores[year];
    return (_unrosteredScores[year] = fetchJson(`data/nfl/unrostered_scores_${year}.json`));
}
function bestAvailableJson(year) {
    if (year in _bestAvailable) return _bestAvailable[year];
    return (_bestAvailable[year] = fetchJson(`data/nfl/best_available_${year}.json`));
}
function playerStatusJson(year) {
    if (year in _playerStatus) return _playerStatus[year];
    return (_playerStatus[year] = fetchJson(`data/nfl/player_status_${year}.json`));
}

/**
 * Roster live ESPN (tutte le posizioni, con injuries embedded per atleta).
 * In cache la promessa, come sopra: qui le chiamate concorrenti per la stessa
 * squadra arrivano da giocatori diversi della stessa rosa. A differenza dei
 * file locali, un fallimento NON resta in cache (l'endpoint è di rete e può
 * tornare su): la voce si toglie e il tentativo dopo riprova.
 */
function espnRoster(abbr) {
    const teamId = ESPN_TEAM_IDS[abbr];
    if (!teamId) return Promise.resolve(null);
    if (_espnRoster[teamId]) return _espnRoster[teamId];
    const p = fetchJson(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/${teamId}/roster`)
        .then(data => {
            if (!data?.athletes) { delete _espnRoster[teamId]; return null; }
            return data.athletes.flatMap(g => g.items || []);
        })
        .catch(() => { delete _espnRoster[teamId]; return null; });
    return (_espnRoster[teamId] = p);
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
    const out = { scheme: null, offense: [], defense: [], special: [], full: { offense: [], defense: [], special: [] } };
    for (const unit of units) {
        // "Special Teams" → special; "Base N-N D" → difesa; il resto → attacco.
        const base = /^Base (\d-\d) D$/.exec(unit.name || '');
        const side = unit.name === 'Special Teams' ? 'special' : base ? 'defense' : 'offense';
        // Fronte base dichiarato da ESPN (3-4 su 20 squadre, 4-3 sulle altre 12):
        // serve a schierare il campo nel modulo giusto, perché le etichette dei
        // ruoli cambiano di conseguenza (NT/LILB/RILB vs LDT/RDT/MLB).
        if (base) out.scheme = base[1];
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

/**
 * Anni in lega di un giocatore nella stagione `season`, 0 = rookie.
 *
 * Si calcola da `rookieYear` (nflverse), non da `yearsExp`: è deterministico e
 * vale identico su stagioni passate e corrente. `yearsExp` resta come ripiego,
 * ma SOLO quello nflverse — che ha la stessa convenzione (verificato su
 * roster_2024/2025/2026 contro rookieYear).
 *
 * L'`experience.years` di ESPN NON è utilizzabile qui: conta le stagioni
 * ATTIVE, non gli anni dal debutto, e sulla stessa rosa 2026 dà 3 a Drake Maye
 * (rookie 2024, terza stagione: nflverse 2) ma 2 a Cory Durden (rookie 2023,
 * quarta stagione: nflverse 3). Le due fonti coincidono solo sui rookie.
 */
/**
 * Non draftato (UDFA): servono ASSENTI entrambi i campi del draft. Su 2924
 * giocatori del roster 2026 un solo caso ha `draftClub` senza `draftNumber`
 * (Jonah Williams, 11ª scelta 2019: numero mancante nel dato) — col doppio
 * controllo resta correttamente tra i draftati.
 */
function _isUndrafted(p) {
    return !p?.draftNumber && !p?.draftClub;
}

function _yearsInLeague(p, season) {
    const y = Number(season);
    if (p?.rookieYear && Number.isFinite(y)) return Math.max(0, y - p.rookieYear);
    return p?.yearsExp ?? null;
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
/**
 * Chi è ARRIVATO nella stagione `year`: mappa nome → sigla della squadra in cui
 * giocava l'anno prima.
 *
 * Si ricava confrontando i roster nflverse di due stagioni consecutive, uniti
 * per `gsis` (stabile, a differenza del nome): dato strutturato, nessuna frase
 * da interpretare e nessuna richiesta di rete in più — i due file sono locali e
 * già in cache. Dice QUANDO uno è arrivato e DA DOVE, non come (scambio, waiver
 * o free agent): quello vive solo nelle transactions ESPN, che sono prosa.
 *
 * Limiti: i file partono dal 2019, quindi per la stagione più vecchia non c'è
 * un "anno prima" e la mappa esce vuota; e la granularità è la stagione, quindi
 * uno scambio a stagione in corso si vede nell'anno dopo.
 */
async function arrivalsForTeam(A, year) {
    const y = Number(year);
    if (!Number.isFinite(y)) return {};
    const [cur, prev] = await Promise.all([rosterJson(y), rosterJson(y - 1)]);
    const list = cur?.teams?.[A];
    if (!list?.length || !prev?.teams) return {};
    const prevByGsis = {};
    for (const [t, pl] of Object.entries(prev.teams)) {
        for (const p of pl) if (p.gsis) prevByGsis[p.gsis] = t;
    }
    const out = {};
    for (const p of list) {
        const was = p.gsis ? prevByGsis[p.gsis] : null;
        if (was && was !== A) out[_normName(p.name)] = was;
    }
    return out;
}

export async function getTeamDepthChart(abbr, year) {
    const A = canonAbbr(abbr);
    const arrivals = await arrivalsForTeam(A, year).catch(() => ({}));
    const arrivedFrom = (name) => arrivals[_normName(name || '')] || null;

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
            (bySlot[side][slot] ??= []).push({ name: p.name, jersey: p.jersey ?? null, yearsExp: _yearsInLeague(p, year), rookieYear: p.rookieYear ?? null, undrafted: _isUndrafted(p), arrivedFrom: arrivedFrom(p.name), snapPct: p.snapPct ?? 0 });
        }
        const rank = (pos) => { const i = DEPTH_ORDER.indexOf(pos); return i === -1 ? 999 : i; };
        const build = (obj) => Object.entries(obj)
            .sort((a, b) => rank(a[0]) - rank(b[0]))
            .map(([pos, players]) => ({ pos, players: players.sort((a, b) => (b.snapPct || 0) - (a.snapPct || 0)).map(x => ({ name: x.name, jersey: x.jersey, yearsExp: x.yearsExp, rookieYear: x.rookieYear, undrafted: x.undrafted, arrivedFrom: x.arrivedFrom })) }));
        const offense = build(bySlot.offense), defense = build(bySlot.defense), special = build(bySlot.special);
        // scheme: null → nflverse non dichiara il fronte base (le etichette sono
        // già generiche: DE, DT, OLB, ILB…), il campo usa il template 4-3.
        return (offense.length || defense.length || special.length) ? { source: 'build', scheme: null, offense, defense, special } : null;
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
        // Maglia: ESPN /roster primaria, nflverse ripiego. Anni in lega: SOLO
        // nflverse (vedi _yearsInLeague — l'esperienza ESPN conta altro). Chi non
        // è nel build resta senza: meglio nessun dato che uno sbagliato.
        const jerseyByName = {}, expByName = {}, rookieByName = {}, udfaByName = {};
        for (const a of (espnAth || [])) {
            const nm = _normName(a.displayName || a.fullName || '');
            if (nm && a.jersey) jerseyByName[nm] = +a.jersey;
        }
        for (const p of (roster?.teams?.[A] || [])) {
            const nm = _normName(p.name);
            if (!nm) continue;
            if (jerseyByName[nm] == null && p.jersey != null) jerseyByName[nm] = p.jersey;
            const exp = _yearsInLeague(p, year);
            if (exp != null) expByName[nm] = exp;
            if (p.rookieYear) rookieByName[nm] = p.rookieYear;
            udfaByName[nm] = _isUndrafted(p);
        }
        const enrich = (side) => side.map(slot => ({
            pos: slot.pos,
            players: slot.players.map(pl => ({
                name: pl.name,
                jersey: pl.jersey ?? jerseyByName[_normName(pl.name || '')] ?? null,
                yearsExp: expByName[_normName(pl.name || '')] ?? null,
                rookieYear: rookieByName[_normName(pl.name || '')] ?? null,
                undrafted: udfaByName[_normName(pl.name || '')] ?? null,
                arrivedFrom: arrivedFrom(pl.name),
                injury: pl.injury || null,
            })),
        }));
        return { source: 'espn-live', scheme: dc.scheme || null, offense: enrich(dc.full.offense), defense: enrich(dc.full.defense), special: enrich(dc.full.special || []) };
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

// Deve restare allineata a `norm()` in scripts/build-nfl-player-scores.mjs e
// scripts/espn/build_inactives.py: le chiavi delle mappe che questo file legge
// sono scritte da quei due script. Senza togliere il suffisso, "Chris Godwin"
// (qui) e "Chris Godwin Jr." (nflverse) normalizzano diverso e la chiave non
// si trova mai — silenziosamente, perché una entry mancante sembra solo un
// giocatore senza dati.
const _normLettersOnly = (n) => (n || '').toLowerCase()
    .replace(/\s+(jr|sr|ii|iii|iv|v)\.?$/i, '')
    .replace(/[^a-z]/g, '');

// Chiave con la vecchia normalizzazione (nessun suffisso tolto): i JSON già
// committati sono stati scritti prima di questo fix e la pipeline notturna
// (build-nflverse.yml, tutti i giorni alle 9 UTC) li rigenera con le chiavi
// nuove solo al prossimo giro. Finché non è passata, un giocatore con
// "Jr./Sr./III..." nel nome andrebbe cercato con la chiave vecchia — provare
// solo quella nuova lo farebbe sparire per una finestra di ore da tutto ciò
// che questo file legge (Injury Report, Best Available, Where to look for an
// upgrade), invece di restare quello di sempre finché i dati non si aggiornano.
const _normLettersOnlyLegacy = (n) => (n || '').toLowerCase().replace(/[^a-z]/g, '');

/** Cerca `name` in una mappa a chiave-nome, provando prima la normalizzazione
 * corrente e poi quella legacy — vedi nota sopra su `_normLettersOnlyLegacy`. */
function lookupByName(players, name) {
    if (!players) return undefined;
    const k = _normLettersOnly(name);
    return players[k] !== undefined ? players[k] : players[_normLettersOnlyLegacy(name)];
}

/**
 * Esito REALE (ha giocato o no) di un giocatore, settimana per settimana, in
 * una stagione — Map(week → didNotPlay). Il referto infortuni si ferma al
 * venerdì; questo viene dal roster ufficiale ESPN della singola partita
 * (campo `didNotPlay`), l'unico dato che dice cosa è successo davvero la
 * domenica. Arricchimento MIRATO, non universale: copre solo i giocatori
 * delle nostre 4 squadre che avevano già uno stato sul referto quella
 * settimana — vedi scripts/espn/build_inactives.py. Assente dalla mappa =
 * nessun dato disponibile, non "ha giocato": non va riempito con un default.
 */
export async function getPlayerInactive(name, year) {
    const data = await inactivesJson(year);
    const entry = lookupByName(data?.players, name);
    if (!entry) return new Map();
    return new Map(Object.entries(entry).map(([wk, dnp]) => [Number(wk), dnp]));
}

/**
 * Punti REALI di un nostro giocatore per le settimane in cui non lo aveva
 * NESSUNA delle 4 squadre — Map(week → {week, opponent, pts, stats}).
 * Ricostruiti da statistiche NFL vere (nflverse), mai registrati da nessuna
 * lega: vedi scripts/build-nfl-player-scores.mjs. Solo QB/RB/WR/TE.
 */
export async function getUnrosteredScores(name, year) {
    const data = await unrosteredScoresJson(year);
    const entry = lookupByName(data?.players, name);
    if (!entry) return new Map();
    return new Map(entry.map(w => [w.week, w]));
}

/**
 * Media di stagione REALE dei nostri giocatori — Map(nome → {pts, games, avg}).
 *
 * Stesse regole con cui è calcolata quella dei free agent (solo partite
 * davvero giocate, bye e inattivi fuori), così le due si possono confrontare.
 * Serve al blocco "dove cercare un rinforzo": la media da titolare presa da
 * Firebase è su pochissime presenze, e prendendo il minimo fra campioni così
 * piccoli usciva sempre il più sfortunato invece del più debole.
 */
export async function getSeasonAverages(year) {
    const data = await unrosteredScoresJson(year);
    const out = new Map();
    for (const [k, v] of Object.entries(data?.seasonAvg || {})) {
        if (Array.isArray(v) && v[1]) out.set(k, { pts: v[0], games: v[1], avg: v[0] / v[1] });
    }
    return out;
}

/** Come `lookupByName`, ma sulla Map già costruita da `getSeasonAverages`
 * (che è indicizzata per nome, non per `Object.players`): stessa ragione, la
 * chiave del JSON committato può ancora essere quella legacy finché la
 * pipeline notturna non rigenera. */
export function seasonAverageOf(map, name) {
    if (!map) return undefined;
    return map.get(_normLettersOnly(name)) ?? map.get(_normLettersOnlyLegacy(name));
}

/**
 * I migliori QB/RB/WR/TE MAI passati su nessuna delle 4 rose, quell'anno —
 * { QB: [...], RB: [...], ... }, ognuno con `weeks` per il drill-down. Solo
 * la top 10 per ruolo (vedi build-nfl-player-scores.mjs): il resto del pool
 * libero non è salvato, appesantirebbe il repo senza motivo.
 */
export async function getBestAvailable(year) {
    const data = await bestAvailableJson(year);
    return data?.byPosition || null;
}

/**
 * Settimane passate in RISERVA INFORTUNATI — Map(week → 'IR').
 *
 * È il buco che il referto settimanale non copre: chi finisce in IR smette di
 * comparirci, quindi l'infortunio più grave della stagione era anche l'unico
 * invisibile (Malik Nabers 2025: crociato alla week 4 e poi il nulla).
 * Fonte: roster_weekly nflverse, stato di rosa NFL settimana per settimana —
 * vedi scripts/build-nfl-player-scores.mjs.
 * Nota: la fonte ogni tanto salta la riga di un singolo giocatore in una
 * settimana; quel buco resta vuoto invece di essere colmato per inferenza.
 */
export async function getPlayerStatus(name, year) {
    const data = await playerStatusJson(year);
    const entry = lookupByName(data?.players, name);
    if (!entry) return new Map();
    return new Map(Object.entries(entry).map(([wk, st]) => [Number(wk), st]));
}
