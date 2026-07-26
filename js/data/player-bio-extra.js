/**
 * Union per campo della bio giocatore: Sleeper (già in player-full.js) è la
 * fonte primaria; qui si riempiono SOLO i campi che Sleeper non ha
 * valorizzato, con ESPN core athlete (site.core.api espone
 * Access-Control-Allow-Origin: *, verificato). api.nfldata.org NON è
 * utilizzabile qui: non manda header CORS, quindi un fetch diretto dal
 * browser fallisce sempre (verificato) — a differenza di Node/CI dove
 * infatti alimenta gli script di build in scripts/. Espone anche
 * riconoscimenti NFL reali (ESPN awards) e contratto live (ESPN), entrambi
 * dati che Sleeper non ha affatto (non gap-fill ma categorie nuove).
 */

const BIO_FIELDS = ['college', 'height', 'weight', 'birth_date', 'birth_country', 'birth_city', 'birth_state', 'number', 'years_exp', 'status', 'position'];
const MAX_AWARDS = 20; // dopo il conteggio (tallyAwards) resta compatto anche prendendone tanti

async function fetchJson(url) {
    try { const r = await fetch(url); return r.ok ? await r.json() : null; }
    catch { return null; }
}

function isMissing(v) { return v == null || v === ''; }

function fillGaps(target, source, mapping) {
    for (const [destKey, srcKey] of Object.entries(mapping)) {
        if (!isMissing(target[destKey])) continue;
        const v = typeof srcKey === 'function' ? srcKey(source) : source?.[srcKey];
        if (!isMissing(v)) target[destKey] = v;
    }
}

/** Anagrafica Sleeper unita (per i soli campi mancanti) con ESPN core athlete. */
export async function enrichBio(info) {
    const merged = { ...(info || {}) };
    if (!BIO_FIELDS.some(f => isMissing(merged[f]))) return merged; // niente da riempire

    const espnId = merged.espn_id;
    if (espnId) {
        const espn = await fetchJson(`https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/athletes/${espnId}`);
        if (espn) fillGaps(merged, espn, {
            college: (e) => e.college?.name, height: 'height', weight: 'weight',
            birth_date: 'dateOfBirth', birth_country: (e) => e.birthPlace?.country,
            birth_city: (e) => e.birthPlace?.city, birth_state: (e) => e.birthPlace?.state,
            number: 'jersey', years_exp: (e) => e.experience?.years,
            status: (e) => e.status?.name, position: (e) => e.position?.abbreviation,
        });
    }
    return merged;
}

/** Riconoscimenti NFL reali (Pro Bowl/All-Pro/premi ESPN), più recenti prima. Solo live, nessuna fonte build. */
export async function getPlayerAwardsEspn(espnId) {
    if (!espnId) return [];
    const list = await fetchJson(`https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/athletes/${espnId}/awards`);
    const refs = (list?.items || []).slice(0, MAX_AWARDS);
    const details = await Promise.all(refs.map(r => fetchJson(r.$ref)));
    return details
        .map((d, i) => {
            if (!d?.name) return null;
            const seasonMatch = refs[i].$ref.match(/seasons\/(\d{4})\//);
            return { name: d.name, season: seasonMatch ? +seasonMatch[1] : null };
        })
        .filter(Boolean);
}

/**
 * Contratto anno-per-anno (ESPN), usato solo se OTC (build) non copre il
 * giocatore. ESPN espone uno storico completo (una entry per anno di
 * carriera, non solo l'ultimo) — lo teniamo tutto invece di prendere solo
 * l'ultima stagione.
 */
export async function getPlayerContractEspn(espnId) {
    if (!espnId) return null;
    const list = await fetchJson(`https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/athletes/${espnId}/contracts`);
    const refs = list?.items;
    if (!refs?.length) return null;
    const years = await Promise.all(refs.map(r => fetchJson(r.$ref)));
    const rows = years
        .map((y, i) => {
            if (!y) return null;
            const seasonMatch = refs[i].$ref.match(/contracts\/(\d+)/);
            return {
                season: seasonMatch ? +seasonMatch[1] : null,
                salary: y.salary ?? null, bonus: y.bonus ?? null,
                salaryRemaining: y.salaryRemaining ?? null, yearsRemaining: y.yearsRemaining ?? null,
                signedThrough: y.signedThrough ?? null, active: !!y.active,
            };
        })
        .filter(Boolean);
    return rows.length ? rows : null;
}

// ─── Overview, campi anagrafici extra e record (ESPN) ────────────────────

const WEB = 'https://site.web.api.espn.com/apis/common/v3/sports/football/nfl';

/**
 * Overview ESPN (endpoint web comune, CORS aperto): news recenti, outlook
 * Rotowire e prossima partita. Nessuna di queste è coperta da Sleeper/build.
 * Ritorna { news:[...], rotowire, nextGame } — campi null/[] se assenti.
 */
export async function getPlayerOverview(espnId) {
    if (!espnId) return null;
    const d = await fetchJson(`${WEB}/athletes/${espnId}/overview`);
    if (!d) return null;
    const news = (d.news || []).slice(0, 8).map(n => ({
        headline: n.headline || null,
        published: n.published || null,
        link: n.links?.web?.href || n.links?.[0]?.href || null,
    })).filter(n => n.headline);
    const rw = d.rotowire || null;
    const rotowire = rw?.story ? {
        headline: rw.headline || null, story: rw.story, published: rw.published || null,
    } : null;
    const ng = d.nextGame || null;
    const nextGame = ng?.date ? { name: ng.name || null, date: ng.date, week: ng.week?.text || null } : null;
    return { news, rotowire, nextGame };
}

/**
 * Campi anagrafici/di draft aggiuntivi ESPN che Sleeper non espone. Combina
 * DUE schemi (come richiesto): l'atleta core **v2** (draft esatto, headshot,
 * stato, posizione) e l'atleta core **v3** (schema più ricco: età già
 * calcolata, altezza/peso già formattati) — union per campo, con v2 come base
 * e v3 a colmare ciò che v2 non ha risolto.
 */
export async function getPlayerEspnExtra(espnId) {
    if (!espnId) return null;
    const [v2, v3] = await Promise.all([
        fetchJson(`https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/athletes/${espnId}`),
        fetchJson(`https://sports.core.api.espn.com/v3/sports/football/nfl/athletes/${espnId}`),
    ]);
    if (!v2 && !v3) return null;
    return {
        debutYear: v2?.debutYear ?? null,
        draft: v2?.draft ? {
            year: v2.draft.year ?? null, round: v2.draft.round ?? null,
            pick: v2.draft.selection ?? null, text: v2.draft.displayText ?? null,
        } : null,
        headshot: v2?.headshot?.href || null,
        status: v2?.status?.name || v3?.status?.name || null,
        experience: v2?.experience?.years ?? v3?.experience?.years ?? null,
        // solo da v3 (schema ricco): valori già risolti non presenti in v2
        age: v3?.age ?? null,
        displayHeight: v3?.displayHeight ?? null,
        displayWeight: v3?.displayWeight ?? null,
    };
}

/**
 * Split statistici del giocatore (common/v3): casa/trasferta, per avversario,
 * per condizioni, ecc. Ritorna { labels:[colonne], groups:[{name, rows}] }.
 */
export async function getPlayerSplits(espnId) {
    if (!espnId) return null;
    const d = await fetchJson(`${WEB}/athletes/${espnId}/splits`);
    const cats = d?.splitCategories;
    if (!cats?.length) return null;
    const groups = cats.map(c => ({
        name: c.displayName || c.name,
        rows: (c.splits || []).map(s => ({ label: s.displayName || s.abbreviation, stats: s.stats || [] })),
    })).filter(g => g.rows.length);
    return groups.length ? { labels: d.labels || [], names: d.names || [], groups } : null;
}

/**
 * Total QBR stagionale del giocatore (solo QB): fetch della classifica QBR
 * ESPN e ricerca dell'atleta. Ritorna { qbr, rank } o null.
 */
export async function getPlayerQBR(espnId, season) {
    if (!espnId || !season) return null;
    const CORE = 'https://sports.core.api.espn.com/v2/sports/football/leagues/nfl';
    // Totali stagione, split 0. Il gruppo NFL con TUTTI i QB qualificati è il 9
    // (verificato: group 1/3 elencano solo pochi leader); si ripiega sull'1.
    const urls = [
        `${CORE}/seasons/${season}/types/2/groups/9/qbr/0?limit=80`,
        `${CORE}/seasons/${season}/types/2/groups/1/qbr/0?limit=80`,
    ];
    for (const url of urls) {
        const d = await fetchJson(url);
        const item = (d?.items || []).find(it => new RegExp(`athletes/${espnId}\\b`).test(it.athlete?.$ref || ''));
        if (item) {
            const stats = (item.splits?.categories || []).flatMap(c => c.stats || []);
            const get = (n) => stats.find(s => s.name === n)?.value ?? null;
            const qbr = get('qbr') ?? get('totalQBR');
            if (qbr != null) return { qbr, rank: get('rank') ?? get('qbrRank') ?? get('unqualifiedRank') ?? null };
        }
    }
    return null;
}

/**
 * Record di carriera ESPN (athletes/{id}/records). Endpoint spesso vuoto per
 * la NFL: wired comunque, così se ESPN lo popola compare da solo (stesso
 * principio della storia franchigia). Ritorna [] se assente.
 */
export async function getPlayerRecordsEspn(espnId) {
    if (!espnId) return [];
    const list = await fetchJson(`https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/athletes/${espnId}/records`);
    const refs = (list?.items || []).slice(0, 12);
    const details = await Promise.all(refs.map(r => fetchJson(r.$ref)));
    return details
        .map(d => d?.stats?.length ? {
            name: d.displayName || d.name || null,
            value: d.stats[0]?.displayValue ?? null,
        } : null)
        .filter(x => x && x.name);
}
