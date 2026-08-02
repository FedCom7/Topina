/**
 * Client HTTP di basso livello per le ESPN Fantasy API (v3, lega privata).
 *
 * Le API non sono documentate ufficialmente: sono le stesse che alimenta
 * l'app ESPN Fantasy, mappate dalla community (nntrn gist, stmorse,
 * librerie espn-api/ffscrapr). Da aprile 2024 le letture sono su un host
 * dedicato read-only: lm-api-reads.fantasy.espn.com (fantasy.espn.com/apis/v3
 * è il vecchio host, deprecato ma a volte ancora risponde/redirige — non va
 * più usato).
 *
 * Auth: lega privata → servono i cookie espn_s2 + SWID di un account membro
 * della lega (DevTools > Application > Cookies > espn.com). Senza, 401 o
 * risposta vuota. Vanno passati via env (GitHub Secrets in CI), mai committati.
 */

const READS_HOST = 'https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

function cookieHeader() {
    const espnS2 = process.env.ESPN_S2;
    const swid = process.env.ESPN_SWID;
    if (!espnS2 || !swid) {
        throw new Error('ESPN_S2 / ESPN_SWID mancanti nell\'ambiente (vedi scripts/espn/README o GitHub Secrets).');
    }
    // SWID nei cookie va tra graffe, es. {XXXXXXXX-XXXX-...}
    const swidBraced = swid.startsWith('{') ? swid : `{${swid}}`;
    return `espn_s2=${espnS2}; SWID=${swidBraced}`;
}

/**
 * GET su un endpoint lega (stagione corrente). `views` è un array di stringhe
 * (es. ['mMatchup','mTeam']) — ogni view diventa un ?view= ripetuto.
 * `extra` sono altri query param (es. scoringPeriodId).
 * `filter` è un oggetto opzionale serializzato nell'header X-Fantasy-Filter
 * (richiesto per endpoint players con più di 50 risultati).
 */
export async function espnGet(leagueId, seasonId, { views = [], extra = {}, filter = null, path = '', retries = 3 } = {}) {
    const url = new URL(`${READS_HOST}/seasons/${seasonId}/segments/0/leagues/${leagueId}${path}`);
    views.forEach(v => url.searchParams.append('view', v));
    Object.entries(extra).forEach(([k, v]) => { if (v != null) url.searchParams.set(k, String(v)); });

    const headers = {
        'Cookie': cookieHeader(),
        'User-Agent': USER_AGENT,
        'Accept': 'application/json',
    };
    if (filter) headers['X-Fantasy-Filter'] = JSON.stringify(filter);

    let lastError;
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            const res = await fetch(url, { headers });
            if (res.status === 401) {
                throw new Error('401 Unauthorized — cookie ESPN scaduti/invalidi (rotazione richiesta).');
            }
            if (!res.ok) {
                throw new Error(`ESPN ${res.status} ${res.statusText} su ${url}`);
            }
            return await res.json();
        } catch (err) {
            lastError = err;
            if (attempt < retries) {
                const backoffMs = 500 * 2 ** (attempt - 1);
                console.warn(`  [espn] tentativo ${attempt}/${retries} fallito (${err.message}), retry tra ${backoffMs}ms...`);
                await new Promise(r => setTimeout(r, backoffMs));
            }
        }
    }
    throw lastError;
}

/** mSettings + mTeam — config lega e squadre (owner, record, nome). */
export function fetchLeagueTeams(leagueId, seasonId) {
    return espnGet(leagueId, seasonId, { views: ['mSettings', 'mTeam'] });
}

/** mMatchup — schedule/punteggi di tutta la stagione (tutti i periodi). */
export function fetchMatchups(leagueId, seasonId) {
    return espnGet(leagueId, seasonId, { views: ['mMatchup', 'mMatchupScore'] });
}

/** mBoxscore per una singola settimana — roster + punti per giocatore. */
export function fetchBoxscore(leagueId, seasonId, scoringPeriodId) {
    return espnGet(leagueId, seasonId, { views: ['mBoxscore', 'mMatchup'], extra: { scoringPeriodId } });
}

/** mDraftDetail — ogni pick del draft (playerId, teamId, overall). */
export function fetchDraftDetail(leagueId, seasonId) {
    return espnGet(leagueId, seasonId, { views: ['mDraftDetail'] });
}

/** mScoreboard — punteggi live in-game (per la corsia live opzionale). */
export function fetchLiveScoreboard(leagueId, seasonId, scoringPeriodId) {
    return espnGet(leagueId, seasonId, { views: ['mScoreboard', 'mLiveScoring'], extra: { scoringPeriodId } });
}
