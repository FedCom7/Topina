/**
 * Sezione "Players" — ricerca di un giocatore Topina (storico completo di
 * chi ha mai giocato in lega, da careers.js::buildCareers) o di una delle
 * 32 squadre NFL, con link diretto alla scheda completa del giocatore
 * (#player/{year}/{pos}/{nome}) o alla pagina squadra NFL (#nfl-team/{abbr}).
 */

import { getLeagueStandings, getLeaguePowerRankings, getNews, getLeagueLeaders } from '../data/nfl-team-live.js?v=37';
import { CURRENT_SEASON } from '../data.js?v=33';
import { esc, teamLogoUrl, buildPlayerIndex, teamResults, playerResults, resultRow } from '../data/player-search-core.js?v=45';

function render(section) {
    section.innerHTML = `
    <div class="section-inner">
        <div class="section-header">
            <h1 class="section-title">Players</h1>
            <p class="section-subtitle">Search a player (Topina history) or an NFL team</p>
        </div>
        <div class="ps-search-wrap">
            <input type="search" id="ps-input" class="ps-search-input" placeholder="Search player or team..." autocomplete="off">
        </div>
        <div id="ps-results" class="ps-results">
            <p class="pm-empty">Start typing to search — e.g. a name, or "Chiefs".</p>
        </div>
        <div id="ps-league" class="ps-league">
            <div class="loading-state"><div class="spinner"></div><p>Loading NFL data...</p></div>
        </div>
    </div>`;
}

/** Classifica NFL reale + power ranking FPI, sotto la ricerca. Fonte ESPN dal vivo. */
async function loadLeaguePanel(container) {
    // In offseason la stagione corrente può essere ancora a 0-0: ripiego sulla precedente.
    async function pick(fn, isEmpty) {
        for (const y of [CURRENT_SEASON, CURRENT_SEASON - 1]) {
            const v = await fn(y).catch(() => null);
            if (v && !isEmpty(v)) return { year: y, value: v };
        }
        return null;
    }
    const [standings, rankings, news, leaders] = await Promise.all([
        pick(getLeagueStandings, (v) => !v.length || v.every(c => c.entries.every(e => !e.wins && !e.losses))),
        pick(getLeaguePowerRankings, (v) => !v.length),
        getNews(null, 10).catch(() => []),
        pick(getLeagueLeaders, (v) => !v.length),
    ]);

    if (!standings && !rankings && !news?.length && !leaders) { container.innerHTML = ''; return; }

    const confTable = (conf) => `
        <div class="ps-standings-conf">
            <h4 class="pp-cat-title">${esc(conf.name)}</h4>
            <div class="pm-table-wrap pp-scroll">
                <table class="pm-table pp-table">
                    <thead><tr><th>#</th><th>Team</th><th>W-L${conf.entries.some(e => e.ties) ? '-T' : ''}</th><th>%</th><th>PF</th><th>PA</th><th>Diff</th><th>Streak</th></tr></thead>
                    <tbody>${conf.entries.map(e => `
                        <tr>
                            <td>${e.seed ?? '—'}</td>
                            <td><a class="ps-inline-team" href="#nfl-team/${e.abbr}"><img src="${teamLogoUrl(e.abbr)}" alt="" onerror="this.style.display='none'"> ${esc(e.abbr)}</a></td>
                            <td class="pm-td-strong">${e.wins ?? 0}-${e.losses ?? 0}${e.ties ? `-${e.ties}` : ''}</td>
                            <td>${e.winPct ?? '—'}</td>
                            <td>${e.pf ?? '—'}</td><td>${e.pa ?? '—'}</td>
                            <td>${e.diff ?? '—'}</td>
                            <td>${e.streak ?? '—'}</td>
                        </tr>`).join('')}</tbody>
                </table>
            </div>
        </div>`;

    const standingsHtml = standings ? `
        <section class="pm-block pp-block">
            <span class="mc-kicker">NFL Standings · ${standings.year}</span>
            <div class="ps-standings-grid">${standings.value.map(confTable).join('')}</div>
            <p class="pm-note">Playoff seed, record, points for/against and streak — live from ESPN. Click an abbreviation for the team page.</p>
        </section>` : '';

    const rk = rankings?.value || [];
    const rankHtml = rankings ? `
        <section class="pm-block pp-block">
            <span class="mc-kicker">Power Ranking · FPI ${rankings.year}</span>
            <div class="ps-rank-grid">${rk.slice(0, 12).map(r => `
                <a class="ps-rank-row" href="#nfl-team/${r.abbr}">
                    <span class="ps-rank-n">${r.rank ?? '—'}</span>
                    <img class="ps-rank-logo" src="${teamLogoUrl(r.abbr)}" alt="" onerror="this.style.display='none'">
                    <span class="ps-rank-abbr">${esc(r.abbr)}</span>
                    <span class="ps-rank-fpi">${r.fpi != null ? (r.fpi > 0 ? '+' : '') + (+r.fpi).toFixed(1) : '—'}</span>
                </a>`).join('')}</div>
            ${rk.length > 12 ? `<details class="pp-recap-ids" style="margin-top:8px"><summary>Full ranking (32)</summary>
                <div class="ps-rank-grid" style="margin-top:8px">${rk.slice(12).map(r => `
                    <a class="ps-rank-row" href="#nfl-team/${r.abbr}"><span class="ps-rank-n">${r.rank ?? '—'}</span><img class="ps-rank-logo" src="${teamLogoUrl(r.abbr)}" alt="" onerror="this.style.display='none'"><span class="ps-rank-abbr">${esc(r.abbr)}</span><span class="ps-rank-fpi">${r.fpi != null ? (r.fpi > 0 ? '+' : '') + (+r.fpi).toFixed(1) : '—'}</span></a>`).join('')}</div></details>` : ''}
            <p class="pm-note">ESPN Football Power Index: the team's net strength (expected point margin vs an average opponent).</p>
        </section>` : '';

    const newsHtml = news?.length ? `
        <section class="pm-block pp-block">
            <span class="mc-kicker">Latest NFL news · ESPN</span>
            <ul class="pp-news-list">${news.slice(0, 10).map(n => `
                <li>${n.link ? `<a href="${esc(n.link)}" target="_blank" rel="noopener">${esc(n.headline)}</a>` : esc(n.headline)}${n.published ? ` <span class="pm-note">· ${new Date(n.published).toLocaleDateString('en-US')}</span>` : ''}</li>`).join('')}</ul>
        </section>` : '';

    const leadHtml = leaders ? `
        <section class="pm-block pp-block">
            <span class="mc-kicker">League leaders · ${leaders.year}</span>
            <div class="ps-leaders-grid">${leaders.value.map(c => `
                <div class="ps-leader-cat">
                    <h4 class="pp-cat-title">${esc(c.label)}</h4>
                    ${c.rows.map(r => `
                        <div class="ps-leader-row">
                            <span class="ps-leader-rank">${r.rank}</span>
                            <span class="ps-leader-name">${esc(r.name)}${r.team ? ` <a class="ps-leader-team" href="#nfl-team/${r.team}">${esc(r.team)}</a>` : ''}</span>
                            <span class="ps-leader-val">${esc(String(r.value ?? '—'))}</span>
                        </div>`).join('')}
                </div>`).join('')}</div>
            <p class="pm-note">Top 5 NFL per category (regular season) — ESPN.</p>
        </section>` : '';

    container.innerHTML = `<h3 class="pp-cat-title ps-league-title">NFL · League</h3>${standingsHtml}${rankHtml}${leadHtml}${newsHtml}`;
}

export async function initPlayersSearch() {
    const section = document.getElementById('players');
    if (!section) return;
    render(section);

    const input = section.querySelector('#ps-input');
    const results = section.querySelector('#ps-results');
    const league = section.querySelector('#ps-league');
    if (league) loadLeaguePanel(league); // non blocca la ricerca

    const teamsGroup = (teams) => teams.length ? `<div class="ps-group"><h3 class="pp-cat-title">NFL Teams</h3>${teams.map(resultRow).join('')}</div>` : '';
    const playersGroup = (players) => players.length ? `<div class="ps-group"><h3 class="pp-cat-title">Players</h3>${players.map(resultRow).join('')}</div>` : '';

    input.addEventListener('input', async () => {
        const q = input.value.trim();
        if (league) league.hidden = q.length >= 2; // la lega lascia spazio ai risultati durante la ricerca
        if (q.length < 2) { results.innerHTML = q.length ? '<p class="pm-empty">Type at least 2 characters.</p>' : '<p class="pm-empty">Start typing to search — e.g. a name, or "Chiefs".</p>'; return; }

        // Le squadre sono un lookup statico: si mostrano subito, senza aspettare
        // il fetch dell'indice giocatori (buildCareers legge tutte le stagioni da Firebase).
        const teams = teamResults(q);
        results.innerHTML = teamsGroup(teams) || '<p class="pm-empty">Searching players...</p>';

        const index = await buildPlayerIndex();
        if (input.value.trim() !== q) return; // l'utente ha già scritto altro
        const players = playerResults(q, index);

        if (!teams.length && !players.length) { results.innerHTML = '<p class="pm-empty">No results.</p>'; return; }
        results.innerHTML = `${teamsGroup(teams)}${playersGroup(players)}`;
    });
}
