/**
 * Sezione "Players" — ricerca di un giocatore Topina (storico completo di
 * chi ha mai giocato in lega, da careers.js::buildCareers) o di una delle
 * 32 squadre NFL, con link diretto alla scheda completa del giocatore
 * (#player/{year}/{pos}/{nome}) o alla pagina squadra NFL (#nfl-team/{abbr}).
 */

import { getLeagueStandings, getLeaguePowerRankings, getNews, getLeagueLeaders } from '../data/nfl-team-live.js?v=7';
import { CURRENT_SEASON } from '../data.js?v=32';
import { esc, teamLogoUrl, buildPlayerIndex, teamResults, playerResults, resultRow } from '../data/player-search-core.js?v=1';

function render(section) {
    section.innerHTML = `
    <div class="section-inner">
        <div class="section-header">
            <h1 class="section-title">Players</h1>
            <p class="section-subtitle">Cerca un giocatore (storico Topina) o una squadra NFL</p>
        </div>
        <div class="ps-search-wrap">
            <input type="search" id="ps-input" class="ps-search-input" placeholder="Cerca giocatore o squadra..." autocomplete="off">
        </div>
        <div id="ps-results" class="ps-results">
            <p class="pm-empty">Inizia a scrivere per cercare — es. un nome, o "Chiefs".</p>
        </div>
        <div id="ps-league" class="ps-league">
            <div class="loading-state"><div class="spinner"></div><p>Caricamento dati NFL...</p></div>
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
                    <thead><tr><th>#</th><th>Squadra</th><th>V-P${conf.entries.some(e => e.ties) ? '-Pa' : ''}</th><th>%</th><th>PF</th><th>PS</th><th>Diff</th><th>Streak</th></tr></thead>
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
            <span class="mc-kicker">Classifica NFL · ${standings.year}</span>
            <div class="ps-standings-grid">${standings.value.map(confTable).join('')}</div>
            <p class="pm-note">Seed playoff, record, punti fatti/subiti e striscia — ESPN dal vivo. Clicca una sigla per la pagina squadra.</p>
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
            ${rk.length > 12 ? `<details class="pp-recap-ids" style="margin-top:8px"><summary>Ranking completo (32)</summary>
                <div class="ps-rank-grid" style="margin-top:8px">${rk.slice(12).map(r => `
                    <a class="ps-rank-row" href="#nfl-team/${r.abbr}"><span class="ps-rank-n">${r.rank ?? '—'}</span><img class="ps-rank-logo" src="${teamLogoUrl(r.abbr)}" alt="" onerror="this.style.display='none'"><span class="ps-rank-abbr">${esc(r.abbr)}</span><span class="ps-rank-fpi">${r.fpi != null ? (r.fpi > 0 ? '+' : '') + (+r.fpi).toFixed(1) : '—'}</span></a>`).join('')}</div></details>` : ''}
            <p class="pm-note">Football Power Index ESPN: forza netta della squadra (margine punti atteso vs avversario medio).</p>
        </section>` : '';

    const newsHtml = news?.length ? `
        <section class="pm-block pp-block">
            <span class="mc-kicker">Ultime notizie NFL · ESPN</span>
            <ul class="pp-news-list">${news.slice(0, 10).map(n => `
                <li>${n.link ? `<a href="${esc(n.link)}" target="_blank" rel="noopener">${esc(n.headline)}</a>` : esc(n.headline)}${n.published ? ` <span class="pm-note">· ${new Date(n.published).toLocaleDateString('it-IT')}</span>` : ''}</li>`).join('')}</ul>
        </section>` : '';

    const leadHtml = leaders ? `
        <section class="pm-block pp-block">
            <span class="mc-kicker">Leader di lega · ${leaders.year}</span>
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
            <p class="pm-note">Top 5 NFL per categoria (regular season) — ESPN.</p>
        </section>` : '';

    container.innerHTML = `<h3 class="pp-cat-title ps-league-title">NFL · Lega</h3>${standingsHtml}${rankHtml}${leadHtml}${newsHtml}`;
}

export async function initPlayersSearch() {
    const section = document.getElementById('players');
    if (!section) return;
    render(section);

    const input = section.querySelector('#ps-input');
    const results = section.querySelector('#ps-results');
    const league = section.querySelector('#ps-league');
    if (league) loadLeaguePanel(league); // non blocca la ricerca

    const teamsGroup = (teams) => teams.length ? `<div class="ps-group"><h3 class="pp-cat-title">Squadre NFL</h3>${teams.map(resultRow).join('')}</div>` : '';
    const playersGroup = (players) => players.length ? `<div class="ps-group"><h3 class="pp-cat-title">Giocatori</h3>${players.map(resultRow).join('')}</div>` : '';

    input.addEventListener('input', async () => {
        const q = input.value.trim();
        if (league) league.hidden = q.length >= 2; // la lega lascia spazio ai risultati durante la ricerca
        if (q.length < 2) { results.innerHTML = q.length ? '<p class="pm-empty">Scrivi almeno 2 caratteri.</p>' : '<p class="pm-empty">Inizia a scrivere per cercare — es. un nome, o "Chiefs".</p>'; return; }

        // Le squadre sono un lookup statico: si mostrano subito, senza aspettare
        // il fetch dell'indice giocatori (buildCareers legge tutte le stagioni da Firebase).
        const teams = teamResults(q);
        results.innerHTML = teamsGroup(teams) || '<p class="pm-empty">Ricerca giocatori...</p>';

        const index = await buildPlayerIndex();
        if (input.value.trim() !== q) return; // l'utente ha già scritto altro
        const players = playerResults(q, index);

        if (!teams.length && !players.length) { results.innerHTML = '<p class="pm-empty">Nessun risultato.</p>'; return; }
        results.innerHTML = `${teamsGroup(teams)}${playersGroup(players)}`;
    });
}
