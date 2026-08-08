/**
 * Cloudflare Worker — punteggi live ESPN per la pagina #live.
 *
 * Perché serve: il sito è statico (GitHub Pages) e la lega è privata, quindi
 * (a) i cookie espn_s2/SWID non possono stare nel browser e (b) ESPN non
 * manda header CORS al client diretto. Questo worker gira all'edge, inietta
 * i cookie da un secret Cloudflare (mai esposti al client) e restituisce i
 * dati GIÀ NORMALIZZATI nello schema che il frontend usa da sempre:
 *
 *   { matchups: [ { team1: {name, score, starters[], bench[]}, team2: {...} } ] }
 *
 * Il file è volutamente autonomo (nessun import): si può incollare così com'è
 * nell'editor del dashboard Cloudflare, senza Node né wrangler. La logica di
 * normalizzazione è la stessa di scripts/espn/normalize.mjs — se cambia una
 * delle due, allineare anche l'altra.
 *
 * Deploy dal browser:
 *   dash.cloudflare.com → Workers & Pages → Create → Worker
 *   → incolla questo file → Deploy
 *   → Settings → Variables and Secrets → aggiungi ESPN_S2 e ESPN_SWID (tipo "Secret")
 *
 * Deploy da CLI (richiede Node):
 *   npm i -g wrangler && wrangler secret put ESPN_S2 && wrangler secret put ESPN_SWID && wrangler deploy
 *
 * Uso dal frontend (js/sections/live.js):
 *   window.TOPINA_LIVE_WORKER_URL = 'https://<worker>.workers.dev';
 */

const READS_HOST = 'https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl';
const ESPN_LEAGUE_ID = '1948241900';

// Dominio del sito che può chiamare questo worker. Restringere qui invece di '*'
// una volta noto l'URL GitHub Pages definitivo (es. https://<user>.github.io).
const ALLOWED_ORIGIN = '*';

/** teamId ESPN → nome squadra (confermato via mTeam sulla lega reale). */
const TEAM_ID_TO_NAME = {
    1: 'Oscurus',
    2: 'Lasers',
    3: 'Sommo',
    4: 'Capi dei Pianeti',
};

/** statId ESPN → chiave legacy in starters[].stats{}
 *  Copia di scripts/espn/league-config.mjs (il Worker è autoconsistente):
 *  se cambia lì, va cambiato anche qui. */
const STAT_ID_MAP = {
    3: 'pass_yds', 4: 'pass_td', 20: 'pass_int',
    24: 'rush_yds', 25: 'rush_td',
    53: 'rec', 42: 'rec_yds', 43: 'rec_td',
    72: 'fum_lost',
    19: 'two_pt', 26: 'two_pt', 44: 'two_pt',
    101: 'ret_td', 102: 'ret_td', 103: 'ret_td', 104: 'ret_td',
    74: 'fg_50_plus', 77: 'fg_40_49', 80: 'fg_0_39',
    83: 'fg_made', 84: 'fg_att', 86: 'pat_made',
    99: 'sack', 95: 'def_int', 96: 'fum_rec', 98: 'safety',
    105: 'def_td', 205: 'def_2pt_ret', 120: 'pts_allowed',
};

const SLOT_ID_MAP = {
    0: 'QB', 2: 'RB', 3: 'RB/WR', 4: 'WR', 6: 'TE',
    16: 'DEF', 17: 'K', 23: 'FLEX', 20: 'BN', 21: 'IR',
};

const BENCH_SLOT_IDS = new Set([20, 21]);

const PRO_TEAM_ABBR = {
    0: 'FA', 1: 'ATL', 2: 'BUF', 3: 'CHI', 4: 'CIN', 5: 'CLE', 6: 'DAL', 7: 'DEN',
    8: 'DET', 9: 'GB', 10: 'TEN', 11: 'IND', 12: 'KC', 13: 'LV', 14: 'LAR', 15: 'MIA',
    16: 'MIN', 17: 'NE', 18: 'NO', 19: 'NYG', 20: 'NYJ', 21: 'PHI', 22: 'ARI', 23: 'PIT',
    24: 'LAC', 25: 'SF', 26: 'SEA', 27: 'TB', 28: 'WSH', 29: 'CAR', 30: 'JAX', 33: 'BAL', 34: 'HOU',
};

function corsHeaders() {
    return {
        'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Cache-Control': 'no-store', // niente cache: i punteggi live devono essere sempre freschi
    };
}

function json(body, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
    });
}

/**
 * Statistiche reali della settimana: statSourceId 0 = giocato, 1 = proiezione.
 * A partita non ancora iniziata esistono solo proiezioni, quindi stats vuote.
 */
function actualStatLine(player, scoringPeriodId) {
    const line = (player?.stats || []).find(s =>
        s.scoringPeriodId === scoringPeriodId && s.statSourceId === 0 && s.statSplitTypeId === 1
    );
    return line?.stats || {};
}

function mapStats(rawStats) {
    const out = {};
    for (const [statId, value] of Object.entries(rawStats || {})) {
        const key = STAT_ID_MAP[Number(statId)];
        if (!key) continue;
        out[key] = (out[key] || 0) + value; // somma per chiavi accorpate (es. two_pt)
    }
    return out;
}

function normalizeEntry(entry, scoringPeriodId) {
    const player = entry?.playerPoolEntry?.player;
    if (!player) return null;
    const slotId = entry.lineupSlotId;
    const points = entry.playerPoolEntry.appliedStatTotal ?? 0;
    const injury = entry.injuryStatus && entry.injuryStatus !== 'NORMAL' ? entry.injuryStatus : '';

    return {
        _slotId: slotId,
        position: SLOT_ID_MAP[slotId] || `SLOT_${slotId}`,
        position_in_team: SLOT_ID_MAP[player.defaultPositionId === 16 ? 16 : slotId] || '',
        name: player.fullName || '',
        nfl_team: PRO_TEAM_ABBR[player.proTeamId] || '',
        opponent: '',
        status: '',
        injuryStatus: injury,
        fantasy_points: (Math.round(points * 100) / 100).toFixed(2),
        stats: mapStats(actualStatLine(player, scoringPeriodId)),
    };
}

function normalizeSide(side, scoringPeriodId) {
    if (!side) return null;
    const starters = [];
    const bench = [];
    for (const raw of side.rosterForCurrentScoringPeriod?.entries || []) {
        const p = normalizeEntry(raw, scoringPeriodId);
        if (!p) continue;
        const { _slotId, ...clean } = p;
        (BENCH_SLOT_IDS.has(_slotId) ? bench : starters).push(clean);
    }
    const total = side.totalPoints ?? 0;
    return {
        name: TEAM_ID_TO_NAME[side.teamId] || `Team ${side.teamId}`,
        score: (Math.round(total * 100) / 100).toFixed(2),
        starters,
        bench,
    };
}

/** Risposta ESPN → { matchups: [...] } della settimana richiesta. */
function normalizeWeek(data, week) {
    const schedule = data?.schedule;
    if (!Array.isArray(schedule)) {
        throw new Error('risposta ESPN inattesa: schedule mancante');
    }
    const matchups = schedule
        .filter(m => m.matchupPeriodId === week)
        .map(m => {
            const team1 = normalizeSide(m.home, week);
            const team2 = normalizeSide(m.away, week);
            return team1 && team2 ? { team1, team2 } : null;
        })
        .filter(Boolean);
    return { week, matchups };
}

export default {
    async fetch(request, env) {
        if (request.method === 'OPTIONS') {
            return new Response(null, { headers: corsHeaders() });
        }

        const url = new URL(request.url);
        if (url.pathname !== '/live') {
            return new Response('Not found', { status: 404, headers: corsHeaders() });
        }

        if (!env.ESPN_S2 || !env.ESPN_SWID) {
            return json({ error: 'ESPN_S2 / ESPN_SWID non configurati nei secret del worker' }, 500);
        }

        const season = url.searchParams.get('season') || String(new Date().getFullYear());
        const swid = env.ESPN_SWID.startsWith('{') ? env.ESPN_SWID : `{${env.ESPN_SWID}}`;
        const headers = {
            'Cookie': `espn_s2=${env.ESPN_S2}; SWID=${swid}`,
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'application/json',
        };

        const askEspn = async (week) => {
            const u = new URL(`${READS_HOST}/seasons/${season}/segments/0/leagues/${ESPN_LEAGUE_ID}`);
            u.searchParams.append('view', 'mBoxscore');
            u.searchParams.append('view', 'mMatchup');
            u.searchParams.set('scoringPeriodId', String(week));
            const res = await fetch(u, { headers });
            if (res.status === 401) throw new Error('401 — cookie ESPN scaduti, vanno rigenerati');
            if (!res.ok) throw new Error(`ESPN ${res.status}`);
            return res.json();
        };

        try {
            // Senza `week` si usa la settimana corrente della lega: la prima
            // risposta la porta sempre con sé (status.currentMatchupPeriod),
            // quindi si rifà la chiamata solo se necessario.
            const asked = Number(url.searchParams.get('week')) || 1;
            let data = await askEspn(asked);
            const current = data?.status?.currentMatchupPeriod;
            const week = url.searchParams.get('week') ? asked : (current || asked);
            if (week !== asked) data = await askEspn(week);

            return json(normalizeWeek(data, week));
        } catch (err) {
            // Fail-safe: mai propagare dati parziali/grezzi al frontend.
            return json({ error: String(err.message || err) }, 502);
        }
    },
};
