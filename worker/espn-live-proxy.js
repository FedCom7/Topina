/**
 * Cloudflare Worker — proxy CORS per i punteggi live ESPN (mScoreboard).
 *
 * Perché serve: il sito è statico (GitHub Pages) e la lega è privata, quindi
 * (a) i cookie espn_s2/SWID non possono stare nel browser e (b) ESPN non
 * manda header CORS al client diretto. Questo worker gira all'edge, inietta
 * i cookie da un secret Cloudflare (mai esposti al client) e restituisce
 * solo i punteggi con CORS aperta verso il dominio del sito.
 *
 * Deploy:
 *   npm i -g wrangler
 *   wrangler secret put ESPN_S2
 *   wrangler secret put ESPN_SWID
 *   wrangler deploy
 *
 * Uso dal frontend (es. js/sections/game-center.js), solo durante le partite:
 *   fetch(`https://<worker>.workers.dev/live?season=2026&week=3`)
 */

const READS_HOST = 'https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl';
const ESPN_LEAGUE_ID = '1948241900';

// Dominio del sito che può chiamare questo worker. Restringere qui invece di '*'
// una volta noto l'URL GitHub Pages definitivo (es. https://<user>.github.io).
const ALLOWED_ORIGIN = '*';

function corsHeaders() {
    return {
        'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Cache-Control': 'no-store', // niente cache: i punteggi live devono essere sempre freschi
    };
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

        const season = url.searchParams.get('season');
        const week = url.searchParams.get('week');
        if (!season || !week) {
            return new Response(JSON.stringify({ error: 'season e week sono richiesti' }), {
                status: 400,
                headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
            });
        }

        const espnUrl = new URL(`${READS_HOST}/seasons/${season}/segments/0/leagues/${ESPN_LEAGUE_ID}`);
        espnUrl.searchParams.append('view', 'mScoreboard');
        espnUrl.searchParams.append('view', 'mLiveScoring');
        espnUrl.searchParams.set('scoringPeriodId', week);

        const swid = env.ESPN_SWID.startsWith('{') ? env.ESPN_SWID : `{${env.ESPN_SWID}}`;

        try {
            const espnRes = await fetch(espnUrl, {
                headers: {
                    'Cookie': `espn_s2=${env.ESPN_S2}; SWID=${swid}`,
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    'Accept': 'application/json',
                },
            });

            if (!espnRes.ok) {
                return new Response(JSON.stringify({ error: `ESPN ${espnRes.status}` }), {
                    status: 502,
                    headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
                });
            }

            const data = await espnRes.json();
            return new Response(JSON.stringify(data), {
                headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
            });
        } catch (err) {
            return new Response(JSON.stringify({ error: String(err) }), {
                status: 502,
                headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
            });
        }
    },
};
