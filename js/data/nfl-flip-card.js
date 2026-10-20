/**
 * Flip card di giornata — la scheda che ogni squadra NFL pubblica il giorno
 * della partita: i due schieramenti riga per riga (titolare e riserve per
 * slot), gli specialisti, la rosa numerica con practice squad, gli arbitri.
 *
 * Due MODI, e la differenza non è cosmetica:
 *
 * - `projected` (partita non ancora giocata): i pannelli sono il depth chart
 *   ufficiale ESPN delle due squadre, cioè quello che la flip card cartacea
 *   stampa il venerdì. È un dato LIVE: esiste solo nella versione di oggi.
 * - `played` (partita finita): ESPN non conserva i depth chart storici, e
 *   ristampare quello di oggi sopra una partita di ottobre sarebbe una bugia.
 *   Quindi per le giornate passate la card si ricostruisce da CHI HA DAVVERO
 *   GIOCATO — il roster di gara (`competitors/{id}/roster`), che porta il
 *   flag `starter` per ciascuno dei 22 titolari e `didNotPlay` per gli
 *   inattivi — raggruppato per ruolo. Stessa scheda, fonte diversa, e la UI
 *   lo dichiara.
 *
 * Gli arbitri arrivano dal summary della gara e compaiono solo dal giorno
 * della partita: prima ESPN non li pubblica (verificato: `gameInfo.officials`
 * vuoto sulle gare future, pieno su quella in corso).
 */

import { canonAbbr } from './nfl-schedule.js?v=552';
import { ESPN_TEAM_IDS } from './player-map.js?v=513';

const SITE = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl';
const CORE = 'https://sports.core.api.espn.com/v2/sports/football/leagues/nfl';

async function fetchJson(url, timeoutMs = 10000) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try { const r = await fetch(url, { signal: ctrl.signal }); return r.ok ? await r.json() : null; }
    catch { return null; }
    finally { clearTimeout(t); }
}

const _cache = {}; // chiave → Promise (una sola chiamata di rete per risorsa)
const cached = (key, loader) => (_cache[key] ??= loader());

/**
 * Anagrafica posizioni ESPN: id → [sigla, reparto].
 *
 * Il roster di gara porta la posizione come `$ref` a `/positions/{id}` — 55
 * voci per squadra, cioè fino a 110 richieste in più per aprire una card. La
 * tabella è FISSA (74 voci, immutabili: sono gli slot del football, non dati
 * di stagione) e sta qui una volta per tutte, scaricata da quell'endpoint.
 * Il reparto si ricava risalendo i `parent` fino a Offense/Defense/Special
 * Teams; le poche voci senza genitore (G, T, ATH…) sono assegnate a mano.
 */
const ESPN_POS = {
    1: ['WR', 'offense'], 2: ['LT', 'offense'], 3: ['LG', 'offense'], 4: ['C', 'offense'],
    5: ['RG', 'offense'], 6: ['RT', 'offense'], 7: ['TE', 'offense'], 8: ['QB', 'offense'],
    9: ['RB', 'offense'], 10: ['FB', 'offense'], 11: ['LDE', 'defense'], 12: ['NT', 'defense'],
    13: ['RDE', 'defense'], 14: ['LOLB', 'defense'], 15: ['LILB', 'defense'], 16: ['RILB', 'defense'],
    17: ['ROLB', 'defense'], 18: ['LCB', 'defense'], 19: ['RCB', 'defense'], 20: ['SS', 'defense'],
    21: ['FS', 'defense'], 22: ['PK', 'special'], 23: ['P', 'special'], 24: ['LDT', 'defense'],
    25: ['RDT', 'defense'], 26: ['WLB', 'defense'], 27: ['MLB', 'defense'], 28: ['SLB', 'defense'],
    29: ['CB', 'defense'], 30: ['LB', 'defense'], 31: ['DE', 'defense'], 32: ['DT', 'defense'],
    33: ['UT', 'offense'], 34: ['NB', 'defense'], 35: ['DB', 'defense'], 36: ['S', 'defense'],
    37: ['DL', 'defense'], 39: ['LS', 'special'], 45: ['OL', 'offense'], 46: ['OT', 'offense'],
    47: ['OG', 'offense'], 50: ['ATH', 'offense'], 70: ['OFF', 'offense'], 71: ['DEF', 'defense'],
    72: ['ST', 'special'], 73: ['G', 'offense'], 74: ['T', 'offense'], 75: ['NG', 'defense'],
    76: ['PR', 'special'], 77: ['KR', 'special'], 78: ['LS', 'special'], 79: ['H', 'special'],
    80: ['PK', 'special'], 90: ['ILB', 'defense'], 91: ['C', 'offense'], 94: ['P', 'special'],
    96: ['LS', 'special'], 100: ['FL', 'offense'], 101: ['HB', 'offense'], 102: ['TB', 'offense'],
    103: ['LHB', 'offense'], 104: ['RHB', 'offense'], 105: ['LLB', 'defense'], 106: ['RLB', 'defense'],
    107: ['OLB', 'defense'], 108: ['LSF', 'defense'], 109: ['RSF', 'defense'], 110: ['MG', 'offense'],
    111: ['SE', 'offense'], 219: ['B', 'offense'], 264: ['EDGE', 'defense'],
};

/**
 * Ordine delle righe nei tre pannelli, quello della flip card stampata:
 * l'attacco parte dal ricevitore esterno e scende lungo la linea, la difesa
 * dal fronte al secondario. Le chiavi sono quelle di ESPN (`wr1`, `lde`…) e
 * valgono identiche per tutte e 32 le squadre (verificato su 3-4 e 4-3: il
 * fronte cambia le chiavi della linea, non il resto).
 */
const SLOT_ORDER = {
    offense: ['wr1', 'lt', 'lg', 'c', 'rg', 'rt', 'te', 'wr2', 'wr3', 'qb', 'rb', 'fb'],
    defense: ['lde', 'ldt', 'nt', 'rdt', 'rde', 'lolb', 'wlb', 'lilb', 'mlb', 'rilb', 'slb', 'rolb', 'olb',
        'lcb', 'nb', 'rcb', 'ss', 'fs'],
    special: ['pk', 'p', 'ls', 'h', 'kr', 'pr'],
};

/** Ordine dei gruppi-ruolo nel modo `played` (lì la riga è il ruolo, non lo slot). */
const PLAYED_ORDER = {
    offense: ['QB', 'RB', 'FB', 'WR', 'TE', 'T', 'OT', 'LT', 'RT', 'G', 'OG', 'LG', 'RG', 'C', 'OL'],
    defense: ['DE', 'EDGE', 'DL', 'DT', 'NT', 'LB', 'OLB', 'ILB', 'MLB', 'CB', 'NB', 'DB', 'S', 'SS', 'FS'],
    special: ['PK', 'P', 'LS', 'H', 'KR', 'PR'],
};

/** Gruppi del roster ESPN → etichetta e lista della flip card. */
const ROSTER_LISTS = {
    offense: 'active', defense: 'active', specialTeam: 'active',
    practiceSquad: 'practice', injuredReserveOrOut: 'reserve', suspended: 'reserve',
};

const ftIn = (inches) => (inches == null ? null : `${Math.floor(inches / 12)}-${Math.round(inches % 12)}`);

/** Maglia: ESPN la dà come stringa, a volte vuota o non numerica (visto sui
 *  roster di gara di preseason). Senza il controllo su Number.isFinite quelle
 *  voci finivano a schermo come "NaN". */
const numMaglia = (v) => { const n = Number(v); return Number.isFinite(n) && v !== '' && v != null ? n : null; };

/**
 * Rosa live della squadra, divisa nelle liste della flip card.
 *
 * `experience.years === 0` è l'UNICO uso che si fa dell'esperienza ESPN, ed è
 * l'unico affidabile: ESPN conta le stagioni attive e non gli anni dal
 * debutto, quindi diverge da nflverse su chi ha saltato un anno — ma sui
 * rookie le due fonti coincidono sempre. Serve per la sottolineatura, che è
 * esattamente la convenzione della card stampata.
 */
function teamRoster(abbr) {
    const teamId = ESPN_TEAM_IDS[abbr];
    if (!teamId) return Promise.resolve(null);
    return cached(`roster-${teamId}`, async () => {
        const d = await fetchJson(`${SITE}/teams/${teamId}/roster`);
        if (!d?.athletes) return null;
        const byId = {}, lists = { active: [], practice: [], reserve: [] };
        for (const g of d.athletes) {
            const lista = ROSTER_LISTS[g.position] || 'active';
            for (const a of (g.items || [])) {
                const inj = (a.injuries || [])[0];
                const p = {
                    id: String(a.id || ''),
                    name: a.displayName || a.fullName || '',
                    jersey: numMaglia(a.jersey),
                    pos: a.position?.abbreviation || null,
                    ht: ftIn(a.height),
                    wt: a.weight != null ? Math.round(a.weight) : null,
                    age: a.age ?? null,
                    exp: a.experience?.years ?? null,
                    college: a.college?.name || null,
                    rookie: a.experience?.years === 0,
                    practice: lista === 'practice',
                    injury: inj ? (inj.status || inj.type?.abbreviation || null) : null,
                    list: lista,
                };
                if (p.id) byId[p.id] = p;
                lists[lista].push(p);
            }
        }
        const byJersey = (a, b) => (a.jersey ?? 999) - (b.jersey ?? 999);
        for (const k of Object.keys(lists)) lists[k].sort(byJersey);
        const co = (d.coach || [])[0];
        return { byId, lists, coach: co ? `${co.firstName || ''} ${co.lastName || ''}`.trim() : null };
    });
}

/** Stagione NFL in corso: a gennaio e febbraio si giocano ancora i playoff
 *  della stagione dell'anno prima. */
const stagioneInCorso = () => { const d = new Date(); return d.getUTCMonth() < 2 ? d.getUTCFullYear() - 1 : d.getUTCFullYear(); };

/**
 * Depth chart ufficiale ESPN, per slot e in ordine di profondità.
 *
 * Dall'API CORE, non da `site.api…/teams/{id}/depthcharts`: quella risponde
 * ma SENZA `Access-Control-Allow-Origin` (verificato il 2026-10-19, mentre
 * roster e summary dello stesso host ce l'hanno), quindi il browser buttava
 * la risposta e ogni partita da giocare finiva sulla nota "no depth chart".
 * Le partite giocate non se ne accorgevano: usano il roster di gara.
 *
 * Il core dà gli atleti come `$ref` (l'id sta nell'URL) senza nome né
 * infortuni: quelli li mette la rosa (`teamRoster().byId`), che si scarica
 * comunque. E i tre ricevitori stanno sotto UNA chiave `wr`, distinti dal
 * campo `slot`: si ridividono in `wr1/wr2/wr3` nell'ordine degli slot, che è
 * come li espone il sito e come li legge `SLOT_ORDER`.
 */
function teamDepth(abbr) {
    const teamId = ESPN_TEAM_IDS[abbr];
    if (!teamId) return Promise.resolve(null);
    return cached(`depth-${teamId}`, async () => {
        const d = await fetchJson(`${CORE}/seasons/${stagioneInCorso()}/teams/${teamId}/depthcharts`);
        if (!d?.items?.length) return null;
        const out = { scheme: null, offense: {}, defense: {}, special: {} };
        const idDa = (a) => String(a.athlete?.$ref || '').match(/athletes\/(\d+)/)?.[1] || '';
        for (const unit of d.items) {
            const base = /^Base (\d-\d) D$/.exec(unit.name || '');
            const side = unit.name === 'Special Teams' ? 'special' : base ? 'defense' : 'offense';
            if (base) out.scheme = base[1];
            for (const [key, slot] of Object.entries(unit.positions || {})) {
                if (!slot.athletes?.length) continue;
                const pos = slot.position?.abbreviation || key.toUpperCase();
                const perSlot = {};
                for (const a of slot.athletes) (perSlot[a.slot ?? 0] ??= []).push(a);
                const slots = Object.keys(perSlot).map(Number).sort((x, y) => x - y);
                slots.forEach((s, i) => {
                    out[side][slots.length > 1 ? `${key}${i + 1}` : key] = {
                        pos: slots.length > 1 ? `${pos}${i + 1}` : pos,
                        athletes: perSlot[s]
                            .sort((x, y) => (x.rank ?? 99) - (y.rank ?? 99))
                            .map(a => ({ id: idDa(a), name: '', injury: null }))
                            .filter(a => a.id),
                    };
                });
            }
        }
        // Chi sta nel depth chart ma non nella rosa ESPN (visto: Jordan Davis,
        // NT titolare di PHI, il 2026-10-19) resterebbe "—": il nome si prende
        // dalla scheda atleta del core, una richiesta per assente.
        const rosa = await teamRoster(abbr).catch(() => null);
        const mancanti = [...new Set(['offense', 'defense', 'special']
            .flatMap(s => Object.values(out[s]).flatMap(sl => sl.athletes))
            .map(a => a.id).filter(id => !rosa?.byId?.[id]))].slice(0, 12);
        const nomi = Object.fromEntries(await Promise.all(mancanti.map(async id =>
            [id, (await fetchJson(`${CORE}/seasons/${stagioneInCorso()}/athletes/${id}`))?.displayName || ''])));
        for (const s of ['offense', 'defense', 'special'])
            for (const sl of Object.values(out[s]))
                for (const a of sl.athletes) a.name = nomi[a.id] || '';
        return out;
    });
}

/**
 * Rosa nflverse della stagione (file locale), indicizzata per maglia.
 *
 * Serve alle card STORICHE. La rosa ESPN esiste solo nella versione di oggi —
 * `?season=2019` risponde con liste vuote, verificato — quindi su una partita
 * di tre anni fa il roster di gara resterebbe con i soli cognomi che porta
 * ("20 Johnson"). Il file nflverse di quella stagione ha nome intero,
 * college, altezza e peso; si aggancia per NUMERO DI MAGLIA, che dentro una
 * squadra e una stagione è univoco, con il cognome a fare da controprova
 * (senza, un cambio di maglia a stagione in corso darebbe il giocatore
 * sbagliato). L'età non c'è in nflverse e resta vuota.
 */
const _nflv = {};
function nflverseRoster(year) {
    if (!Number.isFinite(+year)) return Promise.resolve(null);
    return (_nflv[year] ??= fetchJson(`data/nfl/roster_${year}.json`));
}

const cognome = (nome) => String(nome || '').trim().split(/\s+/).pop().replace(/[^a-z]/gi, '').toLowerCase();

async function nflverseByJersey(abbr, year) {
    const d = await nflverseRoster(year).catch(() => null);
    const list = d?.teams?.[abbr];
    if (!list?.length) return null;
    const out = {};
    for (const p of list) {
        if (p.jersey == null) continue;
        // A parità di maglia vince chi è in rosa attiva: i tagliati di agosto
        // condividono il numero con chi lo ha preso dopo.
        if (!out[p.jersey] || (p.list === 'ACT' && out[p.jersey].list !== 'ACT')) out[p.jersey] = p;
    }
    return out;
}

/**
 * Una voce del roster di gara completata con l'anagrafica: prima la rosa ESPN
 * di oggi (per id, esatta), poi il ripiego nflverse della stagione (per
 * maglia + cognome). Chi non si trova in nessuna delle due tiene il cognome
 * che il roster di gara porta con sé, e le colonne restano vuote.
 */
function completaVoce(e, roster, nv, season) {
    const n = e.jersey != null ? nv?.[e.jersey] : null;
    const combacia = !!n && cognome(n.name) === cognome(e.short);
    // Il rookie si decide sulla STAGIONE DELLA PARTITA (nflverse: `rookieYear`),
    // non su com'è messo oggi: su una card di due anni fa `experience.years`
    // di ESPN sottolineerebbe i rookie di quest'anno e non quelli di allora.
    // `practice` resta sempre falso: in questo modo chi è sceso in campo quel
    // giorno non si vede in corsivo solo perché oggi è in practice squad.
    const rookie = combacia && n.rookieYear != null ? n.rookieYear === Number(season) : null;
    const r = roster?.byId?.[e.id];
    if (r) {
        return {
            ...e, ...r, jersey: e.jersey ?? r.jersey, pos: e.pos || r.pos,
            rookie: rookie ?? !!r.rookie, practice: false,
            starter: e.starter, inactive: e.inactive,
        };
    }
    if (combacia) {
        return {
            ...e, name: n.name, pos: e.pos || n.depthPosition || n.pos || null,
            ht: ftIn(n.height != null ? +n.height : null), wt: n.weight ?? null, age: null,
            exp: n.yearsExp ?? null, college: n.college || null,
            rookie: !!rookie, practice: false,
        };
    }
    return { ...e, name: e.short, practice: false };
}

/** Roster di GARA: 53 attivi + inattivi, col flag `starter` di quella partita. */
function gameRoster(eventId, teamId) {
    return cached(`gr-${eventId}-${teamId}`, async () => {
        const d = await fetchJson(`${CORE}/events/${eventId}/competitions/${eventId}/competitors/${teamId}/roster?limit=200`);
        const entries = d?.entries;
        if (!entries?.length) return null;
        return entries.map(e => {
            const pid = /\/positions\/(\d+)/.exec(e.position?.$ref || '')?.[1];
            const [pos, side] = ESPN_POS[pid] || [null, null];
            return {
                id: String(e.playerId || ''),
                short: e.displayName || '',
                jersey: numMaglia(e.jersey),
                pos, side,
                starter: !!e.starter,
                inactive: !!e.didNotPlay,
            };
        });
    });
}

/** Arbitri, stadio, presenze e punteggio finale dal summary della gara. */
function gameSummary(eventId) {
    return cached(`sum-${eventId}`, async () => {
        const d = await fetchJson(`${SITE}/summary?event=${eventId}`);
        if (!d) return null;
        const gi = d.gameInfo || {};
        const comp = d.header?.competitions?.[0] || {};
        return {
            venue: gi.venue?.fullName || null,
            city: [gi.venue?.address?.city, gi.venue?.address?.state].filter(Boolean).join(', ') || null,
            attendance: gi.attendance || null,
            date: comp.date || null,
            broadcast: (comp.broadcasts || [])[0]?.media?.shortName || null,
            status: comp.status?.type?.description || null,
            officials: (gi.officials || [])
                .map(o => ({ name: o.displayName || o.fullName || '', role: o.position?.displayName || o.position?.name || '', order: o.order ?? 99 }))
                .filter(o => o.name)
                .sort((a, b) => a.order - b.order),
            scores: (comp.competitors || []).map(c => ({
                abbr: canonAbbr(c.team?.abbreviation || ''),
                score: c.score ?? null,
                record: (c.record || []).find(r => r.type === 'total')?.summary || null,
            })),
        };
    });
}

/** Righe di un pannello nel modo `projected`: una per slot del depth chart. */
function projectedUnits(depth, roster) {
    const riga = (side) => (SLOT_ORDER[side])
        .map(key => {
            const slot = depth?.[side]?.[key];
            if (!slot) return null;
            return {
                pos: slot.pos,
                players: slot.athletes.map(a => {
                    const r = roster?.byId?.[a.id];
                    return {
                        name: a.name || r?.name || '—',
                        jersey: r?.jersey ?? null,
                        rookie: !!r?.rookie,
                        practice: !!r?.practice,
                        injury: a.injury || r?.injury || null,
                    };
                }),
            };
        })
        .filter(Boolean);
    // Slot che ESPN espone ma che non stanno nell'ordine della card (raro:
    // un fronte nuovo) in coda, invece di sparire.
    const extra = (side) => Object.entries(depth?.[side] || {})
        .filter(([k]) => !SLOT_ORDER[side].includes(k))
        .map(([, slot]) => ({
            pos: slot.pos,
            players: slot.athletes.map(a => {
                const r = roster?.byId?.[a.id];
                return { name: a.name || r?.name || '—', jersey: r?.jersey ?? null, rookie: !!r?.rookie, practice: !!r?.practice, injury: a.injury || r?.injury || null };
            }),
        }));
    return {
        offense: [...riga('offense'), ...extra('offense')],
        defense: [...riga('defense'), ...extra('defense')],
        special: [...riga('special'), ...extra('special')],
    };
}

/**
 * Depth chart della MATTINA della partita, precalcolato da
 * scripts/build-nfl-depth.mjs sulle foto che nflverse fa del depth chart ESPN.
 * Esiste dal 2025: prima la card resta per ruolo (`playedUnits`).
 */
const PRIMA_STAGIONE_DEPTH = 2025;
function depthDelGiorno(abbr, season, eventId) {
    if (!(+season >= PRIMA_STAGIONE_DEPTH)) return Promise.resolve(null);
    return cached(`dday-${season}-${abbr}`, () => fetchJson(`data/nfl/depth/${season}_${abbr}.json`))
        .then(f => (f?.games?.[eventId] ? { ...f.games[eventId], names: f.names || {} } : null));
}

/** Famiglia di ruolo, per mettere un titolare che il depth chart non aveva
 *  nella riga giusta (LT/RT/T → T, LCB/NB/CB → CB…). */
const famiglia = (pos) => {
    const p = String(pos || '').toUpperCase().replace(/\d+$/, '');
    if (/^(L|R)?(OT|T)$/.test(p)) return 'T';
    if (/^(L|R)?(OG|G)$/.test(p)) return 'G';
    if (/^(L|R)?DE$|^EDGE$/.test(p)) return 'DE';
    if (/^(L|R)?DT$|^NT$|^DL$/.test(p)) return 'DT';
    if (/LB$/.test(p)) return 'LB';
    if (/^(L|R)?CB$|^NB$|^DB$/.test(p)) return 'CB';
    if (/^(SS|FS|S)$/.test(p)) return 'S';
    if (/^(RB|HB|FB|TB)$/.test(p)) return 'RB';
    return p;
};

/**
 * Righe nel modo `played` quando c'è il depth chart del giorno: le stesse
 * della card in arrivo (slot per slot, in ordine di profondità), con sopra
 * quello che il roster di gara dice davvero — `starter` per chi è partito
 * titolare, `inactive` per chi non era a disposizione (inattivo o del tutto
 * assente dal roster di gara: IR, tagliato in settimana).
 *
 * Un titolare che il depth chart della mattina non aveva (un rientro
 * dell'ultima ora, un promosso dalla practice squad) non deve sparire: va in
 * coda alla prima riga della sua famiglia di ruolo, o in una riga sua.
 */
function playedDepthUnits(dg, entries) {
    const perId = Object.fromEntries(entries.map(e => [e.id, e]));
    const visti = new Set();
    // `starter` (il grassetto) vale una volta sola e solo in attacco/difesa:
    // il flag di ESPN dice "in campo al primo snap", non in quale slot — chi
    // il depth chart mette sotto C e RG sarebbe in grassetto due volte, e un
    // titolare della difesa lo sarebbe anche sulla riga dei ritornatori.
    // Si accende sulla riga della sua famiglia di ruolo (dal roster di gara),
    // o sulla prima in cui compare se nessuna combacia.
    const evidenziati = new Set();
    const voce = (id, pos, side) => {
        const e = perId[id];
        visti.add(id);
        return {
            id,
            name: e?.name || dg.names[id] || '—',
            jersey: e?.jersey ?? null,
            rookie: !!e?.rookie,
            practice: false,
            injury: null,
            starter: false,
            titolareGara: side !== 'special' && !!e?.starter,
            famigliaGara: famiglia(e?.pos),
            famigliaRiga: famiglia(pos),
            inactive: !e || !!e.inactive,
        };
    };
    const out = {};
    for (const side of ['offense', 'defense', 'special']) {
        const slots = dg[side] || {};
        const chiavi = [...SLOT_ORDER[side].filter(k => slots[k]), ...Object.keys(slots).filter(k => !SLOT_ORDER[side].includes(k))];
        out[side] = chiavi.map(k => {
            const pos = k.toUpperCase();
            return { pos, players: slots[k].map(id => voce(id, pos, side)) };
        });
    }
    for (const e of entries) {
        if (!e.starter || visti.has(e.id) || !e.side || !out[e.side]) continue;
        const riga = out[e.side].find(r => famiglia(r.pos) === famiglia(e.pos));
        if (riga) riga.players.push(voce(e.id, riga.pos, e.side));
        else out[e.side].push({ pos: e.pos, players: [voce(e.id, e.pos, e.side)] });
    }
    const tutte = (side) => out[side].flatMap(r => r.players);
    for (const side of ['offense', 'defense']) {
        for (const p of tutte(side)) {
            if (p.titolareGara && !evidenziati.has(p.id) && p.famigliaRiga === p.famigliaGara) { p.starter = true; evidenziati.add(p.id); }
        }
        for (const p of tutte(side)) {
            if (p.titolareGara && !evidenziati.has(p.id)) { p.starter = true; evidenziati.add(p.id); }
        }
    }
    for (const side of Object.keys(out)) {
        for (const p of tutte(side)) { delete p.id; delete p.titolareGara; delete p.famigliaGara; delete p.famigliaRiga; }
    }
    return out;
}

/** Righe nel modo `played`: una per RUOLO, titolari di quella partita in testa. */
function playedUnits(entries) {
    const gruppi = { offense: {}, defense: {}, special: {} };
    for (const e of entries) {
        if (e.inactive || !e.side || !e.pos) continue;
        (gruppi[e.side][e.pos] ??= []).push(e);
    }
    const build = (side) => {
        const chiavi = Object.keys(gruppi[side]).sort((a, b) => {
            const ia = PLAYED_ORDER[side].indexOf(a), ib = PLAYED_ORDER[side].indexOf(b);
            return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
        });
        return chiavi.map(pos => ({
            pos,
            players: gruppi[side][pos]
                .sort((a, b) => (b.starter - a.starter) || ((a.jersey ?? 999) - (b.jersey ?? 999)))
                .map(e => ({
                    name: e.name || e.short,
                    jersey: e.jersey ?? null,
                    rookie: !!e.rookie,
                    practice: !!e.practice,
                    injury: null,
                    starter: e.starter,
                })),
        }));
    };
    return { offense: build('offense'), defense: build('defense'), special: build('special') };
}

/**
 * La flip card di una partita.
 *
 * `game` è una voce del calendario ESPN (vedi getTeamScheduleFull): servono
 * `eventId`, le due sigle e se la gara è finita. Ritorna null se manca
 * l'essenziale — la UI mostra allora la nota, non una card mezza vuota.
 */
export async function getFlipCard(game) {
    const home = canonAbbr(game?.homeAbbr || '');
    const away = canonAbbr(game?.awayAbbr || '');
    const eventId = game?.eventId;
    if (!home || !away || !eventId) return null;

    const [rHome, rAway, summary] = await Promise.all([
        teamRoster(home).catch(() => null),
        teamRoster(away).catch(() => null),
        gameSummary(eventId).catch(() => null),
    ]);

    // Il modo si decide sul DATO, non sul calendario: una gara finita di cui
    // ESPN non espone il roster di gara ricade sul depth chart dichiarandolo.
    let mode = 'projected', unitsHome = null, unitsAway = null;
    let gameHome = null, gameAway = null, depthDay = null;
    if (game.completed) {
        [gameHome, gameAway] = await Promise.all([
            gameRoster(eventId, ESPN_TEAM_IDS[home]).catch(() => null),
            gameRoster(eventId, ESPN_TEAM_IDS[away]).catch(() => null),
        ]);
        if (gameHome?.length && gameAway?.length) {
            const season = game.season || (game.date ? new Date(game.date).getUTCFullYear() : null);
            const [nvHome, nvAway, ddHome, ddAway] = await Promise.all([
                nflverseByJersey(home, season).catch(() => null),
                nflverseByJersey(away, season).catch(() => null),
                depthDelGiorno(home, season, eventId).catch(() => null),
                depthDelGiorno(away, season, eventId).catch(() => null),
            ]);
            gameHome = gameHome.map(e => completaVoce(e, rHome, nvHome, season));
            gameAway = gameAway.map(e => completaVoce(e, rAway, nvAway, season));
            mode = 'played';
            // Depth chart del giorno solo se c'è per TUTTE E DUE: una card con
            // un lato per slot e l'altro per ruolo non si confronterebbe.
            if (ddHome && ddAway) {
                depthDay = ddHome.dt;
                unitsHome = playedDepthUnits(ddHome, gameHome);
                unitsAway = playedDepthUnits(ddAway, gameAway);
            } else {
                unitsHome = playedUnits(gameHome);
                unitsAway = playedUnits(gameAway);
            }
        }
    }
    if (mode === 'projected') {
        const [dHome, dAway] = await Promise.all([
            teamDepth(home).catch(() => null),
            teamDepth(away).catch(() => null),
        ]);
        if (!dHome && !dAway) return null;
        unitsHome = projectedUnits(dHome, rHome);
        unitsAway = projectedUnits(dAway, rAway);
    }

    const lato = (abbr, roster, units, entries) => {
        const scored = (summary?.scores || []).find(s => s.abbr === abbr);
        // Modo `played`: la rosa mostrata è quella DI GARA (attivi + inattivi
        // di quel giorno), non la rosa di oggi — è il dato che la card di
        // quella giornata avrebbe stampato. I dati anagrafici (altezza, peso,
        // college) si agganciano per id alla rosa attuale: chi nel frattempo
        // è stato tagliato resta senza, e la tabella lo mostra vuoto.
        const daGara = (lista) => [...lista].sort((a, b) => (a.jersey ?? 999) - (b.jersey ?? 999));
        return {
            abbr,
            coach: roster?.coach || null,
            score: scored?.score ?? null,
            record: scored?.record || null,
            units,
            roster: entries ? daGara(entries.filter(e => !e.inactive)) : (roster?.lists?.active || []),
            practice: entries ? [] : (roster?.lists?.practice || []),
            reserve: entries ? [] : (roster?.lists?.reserve || []),
            inactives: entries ? daGara(entries.filter(e => e.inactive)) : [],
        };
    };

    return {
        mode,
        depthDay,
        eventId,
        week: game.weekText || (game.weekNum != null ? `Week ${game.weekNum}` : null),
        seasonType: game.seasonType ?? 2,
        date: summary?.date || game.date || null,
        venue: summary?.venue || null,
        city: summary?.city || null,
        attendance: summary?.attendance || null,
        broadcast: summary?.broadcast || null,
        status: summary?.status || null,
        officials: summary?.officials || [],
        home: lato(home, rHome, unitsHome, mode === 'played' ? gameHome : null),
        away: lato(away, rAway, unitsAway, mode === 'played' ? gameAway : null),
    };
}

/* ─── I titolari di una partita, con l'id ESPN per la foto ─────────────────
 *
 * Serve alla pagina delle partite dell'NFL Hub (#nfl-games), che mostra gli
 * undici d'attacco e gli undici di difesa di tutt'e due le squadre. Usa le
 * stesse due fonti della card, nello stesso ordine e con lo stesso criterio:
 *  - `game`: il roster di GARA, coi 22 `starter` di quel giorno. ESPN lo
 *    pubblica dal giorno della partita (verificato: 404 sulle gare future);
 *  - `depth`: prima della partita, il primo nome di ogni slot del depth chart
 *    ufficiale — chi DOVREBBE partire titolare, e la pagina lo dichiara.
 */
const ORDINE_TITOLARI = {
    offense: ['QB', 'RB', 'HB', 'FB', 'WR', 'TE', 'LT', 'LG', 'C', 'RG', 'RT', 'T', 'OT', 'G', 'OG', 'OL'],
    defense: ['LDE', 'DE', 'EDGE', 'LDT', 'DT', 'NT', 'RDT', 'RDE', 'DL', 'LOLB', 'OLB', 'WLB', 'LILB', 'MLB',
        'ILB', 'LB', 'RILB', 'SLB', 'ROLB', 'LCB', 'CB', 'NB', 'RCB', 'DB', 'SS', 'S', 'FS'],
};
const perRuolo = (side) => (a, b) => {
    const i = (p) => { const k = ORDINE_TITOLARI[side].indexOf(p.pos); return k === -1 ? 99 : k; };
    return i(a) - i(b);
};

/* La panchina si legge per REPARTO, non per slot: "chi c'e' dietro ai
   ricevitori", non "chi e' il terzo wr2". Questi sono i reparti, nell'ordine
   in cui si mostrano. */
const REPARTI = [
    ['QB', ['QB']],
    ['RB', ['RB', 'HB', 'FB', 'TB', 'LHB', 'RHB']],
    ['WR', ['WR', 'FL', 'SE']],
    ['TE', ['TE']],
    ['OL', ['LT', 'LG', 'C', 'RG', 'RT', 'T', 'OT', 'G', 'OG', 'OL']],
    ['DL', ['LDE', 'RDE', 'DE', 'EDGE', 'LDT', 'RDT', 'DT', 'NT', 'NG', 'DL']],
    ['LB', ['LB', 'OLB', 'ILB', 'MLB', 'WLB', 'SLB', 'LOLB', 'ROLB', 'LILB', 'RILB', 'LLB', 'RLB']],
    ['DB', ['CB', 'LCB', 'RCB', 'NB', 'DB', 'S', 'SS', 'FS']],
    ['ST', ['PK', 'P', 'LS', 'H', 'KR', 'PR']],
];
const repartoDi = (pos) => REPARTI.find(([, l]) => l.includes(String(pos || '').toUpperCase()))?.[0] || null;
function perReparto(lista) {
    return REPARTI.map(([ruolo]) => ({
        ruolo,
        players: lista.filter(p => repartoDi(p.pos) === ruolo)
            .sort((a, b) => (a.jersey ?? 999) - (b.jersey ?? 999)),
    })).filter(g => g.players.length);
}

/**
 * Titolari e panchina insieme, reparto per reparto: per ogni ruolo prima chi
 * parte titolare (nell'ordine del campo: LT, LG, C, RG, RT…) e poi chi
 * aspetta. Un reparto senza nessuno non c'e'.
 */
function perRuoloInsieme(titolari, panchina) {
    return REPARTI.map(([ruolo]) => ({
        ruolo,
        titolari: titolari.filter(p => repartoDi(p.pos) === ruolo),
        panchina: (panchina.find(g => g.ruolo === ruolo)?.players) || [],
    })).filter(g => g.titolari.length || g.panchina.length);
}

export async function getStarters(eventId, abbr) {
    const sigla = canonAbbr(abbr || '');
    const teamId = ESPN_TEAM_IDS[sigla];
    if (!eventId || !teamId) return null;
    const [gara, rosa] = await Promise.all([
        gameRoster(eventId, teamId).catch(() => null),
        teamRoster(sigla).catch(() => null),
    ]);
    const nome = (id, ripiego) => rosa?.byId?.[id]?.name || ripiego || '';

    const titolari = (gara || []).filter(e => e.starter && !e.inactive && e.side);
    if (titolari.length >= 18) {
        const lato = (side) => titolari.filter(e => e.side === side)
            .map(e => ({ id: e.id, name: nome(e.id, e.short), jersey: e.jersey, pos: e.pos }))
            .sort(perRuolo(side));
        // In panchina: gli attivi di quel giorno che non sono partiti titolari
        // (gli inattivi non erano a disposizione, e non stanno qui).
        const panchina = (gara || []).filter(e => !e.starter && !e.inactive && e.pos)
            .map(e => ({ id: e.id, name: nome(e.id, e.short), jersey: e.jersey, pos: e.pos }));
        const offense = lato('offense'), defense = lato('defense'), bench = perReparto(panchina);
        return { fonte: 'game', offense, defense, bench, ruoli: perRuoloInsieme([...offense, ...defense], bench) };
    }

    const depth = await teamDepth(sigla).catch(() => null);
    if (!depth) return null;
    const lato = (side) => {
        const visti = new Set();
        const out = [];
        for (const key of SLOT_ORDER[side]) {
            const a = depth[side]?.[key]?.athletes?.[0];
            if (!a?.id || visti.has(a.id)) continue;
            visti.add(a.id);
            out.push({ key, id: a.id, name: a.name || nome(a.id), jersey: rosa?.byId?.[a.id]?.jersey ?? null,
                pos: depth[side][key].pos.replace(/\d+$/, '') }); // WR1 → WR: l'ordine dei ruoli non ha gli slot
        }
        // Il depth chart ha slot in piu' degli undici (nickel, fullback, terzo
        // ricevitore): si tolgono in quest'ordine, che e' quello dei giocatori
        // che entrano solo in certe formazioni.
        for (const via of ['nb', 'fb', 'wr3']) {
            if (out.length <= 11) break;
            const i = out.findIndex(p => p.key === via);
            if (i >= 0) out.splice(i, 1);
        }
        return out.slice(0, 11).map(({ key, ...p }) => p).sort(perRuolo(side));
    };
    const offense = lato('offense'), defense = lato('defense');
    // Prima della partita la panchina e' il resto del depth chart: ogni nome
    // che non e' fra gli undici, una volta sola, specialisti compresi.
    const titolariId = new Set([...offense, ...defense].map(p => p.id));
    const visti = new Set();
    const panchina = [];
    for (const side of ['offense', 'defense', 'special']) {
        for (const slot of Object.values(depth[side] || {})) {
            for (const a of slot.athletes || []) {
                if (!a.id || titolariId.has(a.id) || visti.has(a.id)) continue;
                visti.add(a.id);
                panchina.push({ id: a.id, name: a.name || nome(a.id), jersey: rosa?.byId?.[a.id]?.jersey ?? null,
                    pos: rosa?.byId?.[a.id]?.pos || slot.pos.replace(/\d+$/, '') });
            }
        }
    }
    const bench = perReparto(panchina);
    return { fonte: 'depth', offense, defense, bench, ruoli: perRuoloInsieme([...offense, ...defense], bench) };
}

/* ─── Depth chart di oggi, per il laboratorio Study of the Game ───────────
 *
 * Stesse due fonti della card in arrivo (depth chart del core ESPN + rosa
 * del sito per nome, numero, misure e infortunio), restituite per slot con
 * tutto quello che serve a mettere i giocatori in campo e a confrontarli.
 * Nessuna richiesta in più se la flip card le ha già scaricate (cache).
 */
export async function getStudyDepth(abbr) {
    const a = canonAbbr(abbr || '');
    const [d, r] = await Promise.all([teamDepth(a).catch(() => null), teamRoster(a).catch(() => null)]);
    if (!d) return null;
    const voce = (x, pos) => {
        const p = r?.byId?.[x.id] || {};
        return { id: x.id, name: x.name || p.name || '—', jersey: p.jersey ?? null, pos: p.pos || pos,
            ht: p.ht || null, wt: p.wt ?? null, age: p.age ?? null, exp: p.exp ?? null, college: p.college || null,
            rookie: !!p.rookie, injury: x.injury || p.injury || null };
    };
    const out = { abbr: a, scheme: d.scheme, offense: {}, defense: {}, special: {} };
    for (const side of ['offense', 'defense', 'special']) {
        for (const [k, slot] of Object.entries(d[side] || {})) out[side][k] = slot.athletes.map(x => voce(x, slot.pos.replace(/\d+$/, '')));
    }
    return out;
}
