/**
 * History Section
 * Per-year recap built entirely from Firebase data:
 *  - Regular season standings
 *  - Super Bowl final (last week matchup)
 *  - Champion
 *  - Dynamic season recap narratives
 */
import { fetchFantasyData, processStandings, getSuperBowlMatchup, displayName, SEASONS } from '../data.js?v=5';
import { TEAM_LOGOS } from '../data/team-config.js?v=5';

let loaded = false;

export async function initHistory() {
    if (loaded) return;
    loaded = true;

    const container = document.getElementById('history-timeline');
    container.innerHTML = `<div class="loading-state"><div class="spinner"></div><p>Caricamento storico...</p></div>`;

    // Load all seasons in parallel
    const results = await Promise.all(
        SEASONS.map(async (year) => {
            const data = await fetchFantasyData(year);
            if (!data) return null;
            const standings = processStandings(data, year);
            const sbMatchup = getSuperBowlMatchup(data, year);
            return { year, standings, sbMatchup };
        })
    );

    // Filter out empty results and render newest first
    const seasons = results.filter(Boolean).reverse();

    if (!seasons.length) {
        container.innerHTML = `<div class="empty-state"><p class="empty-state-text">Nessun dato storico disponibile</p></div>`;
        return;
    }

    container.innerHTML = seasons.map((s, i) => renderSeasonCard(s, i)).join('');
}

/**
 * Generate a dynamic season recap based on actual data with narrative flair
 */
function generateRecap({ year, standings, sbMatchup }) {
    if (!standings.length) return '';

    const first = standings[0];
    const last = standings[standings.length - 1];
    const firstName = displayName(first.name);
    const lastName = displayName(last.name);

    let champion = null, loserName = null, margin = 0;
    if (sbMatchup) {
        const s1 = parseFloat(sbMatchup.team1.score);
        const s2 = parseFloat(sbMatchup.team2.score);
        const winner = s1 >= s2 ? sbMatchup.team1 : sbMatchup.team2;
        const loser = s1 >= s2 ? sbMatchup.team2 : sbMatchup.team1;
        champion = displayName(winner.name);
        loserName = displayName(loser.name);
        margin = Math.abs(s1 - s2).toFixed(2);
    }

    const parts = [];

    // --- ANNO 2019: L'ORIGINE ---
    if (year === '2019') {
        parts.push(`2019, L'Anno Zero. Dove tutto ebbe inizio. Il primo storico campionato della Topina League prende il via tra l'entusiasmo generale e l'inesperienza di alcuni GM.`);
        if (champion) {
            parts.push(`Alla fine è ${champion} a scrivere il proprio nome per primo nell'albo d'oro, lasciando a ${loserName} l'amaro calice della sconfitta inaugurale.`);
        }
        return parts.join(' ');
    }

    // --- ALTRI ANNI: NARRATIVA DINAMICA E SBEFFEGGIAMENTI ---

    // 1. REGULAR SEASON NARRATIVE
    const topRecord = first.w;
    const secondRecord = standings[1]?.w || 0;
    const gap = topRecord - secondRecord;
    const yInt = parseInt(year) || 0;

    if (first.w >= 12) {
        const phrases = [
            `${firstName} ha bullizzato la lega in regular season (${first.w}-${first.l}), guardando tutti dall'alto in basso con arroganza.`,
            `Dominio imperiale di ${firstName}: record di ${first.w}-${first.l} e avversari ridotti a comparse.`,
            `Una marcia trionfale per ${firstName}, che con un ${first.w}-${first.l} ha fatto capire subito chi comandava.`,
        ];
        parts.push(phrases[yInt % phrases.length]);
    } else if (gap >= 3) {
        const phrases = [
            `${firstName} ha fatto il vuoto dietro di sé, lasciando solo le briciole agli avversari.`,
            `${firstName} ha scavato un solco incolmabile tra sé e il resto della lega, chiudendo in vetta solitaria.`,
            `Non c'è stata storia: ${firstName} ha preso il comando e non si è più voltato indietro.`,
        ];
        parts.push(phrases[(yInt + 1) % phrases.length]);
    } else if (gap <= 1) {
        const phrases = [
            `Una stagione tiratissima, decisa sul filo di lana: ${firstName} la spunta per un soffio su ${displayName(standings[1].name)}.`,
            `Testa a testa vibrante in vetta: ${firstName} e ${displayName(standings[1].name)} si sono dati battaglia fino all'ultimo respiro.`,
            `Regna l'equilibrio: ${firstName} conquista la vetta con il minimo scarto su un agguerrito ${displayName(standings[1].name)}.`,
        ];
        parts.push(phrases[(yInt + 2) % phrases.length]);
    } else {
        const phrases = [
            `${firstName} detta legge in regular season, chiudendo con un solido record di ${first.w}-${first.l}.`,
            `Leadership solida per ${firstName}, che si prende la testa della classifica con merito.`,
            `${firstName} si dimostra la squadra più costante, vincendo la regular season.`,
        ];
        parts.push(phrases[yInt % phrases.length]);
    }

    // 2. THE FLOP (Last Place) - Sbeffeggiamento
    if (last.w <= 2) {
        const phrases = [
            `Disastro totale per ${lastName}, che chiude come zimbello della lega con un imbarazzante ${last.w}-${last.l}.`,
            `${lastName} riesce nell'impresa di perdere quasi tutto, una stagione horror da ${last.w}-${last.l}.`,
            `Nulla da salvare per ${lastName}, protagonista di un campionato da incubo.`,
        ];
        parts.push(phrases[yInt % phrases.length]);
    } else if (last.w <= 4) {
        const phrases = [
            `Stagione da dimenticare per ${lastName}, mai davvero in partita e meritatamente fanalino di coda.`,
            `${lastName} si deve accontentare dell'ultimo posto dopo un'annata piena di rimpianti e sconfitte.`,
            `Cucchiaio di legno per ${lastName}, che spera di cancellare presto questa stagione mediocre.`,
            `${lastName} chiude la fila, guardando tutti dal basso verso l'alto.`,
        ];
        parts.push(phrases[(yInt + 3) % phrases.length]);
    }

    // 3. SUPER BOWL NARRATIVE
    if (champion) {
        const isUnderdog = standings.findIndex(t => displayName(t.name) === champion) >= 2;
        const isFirst = standings.findIndex(t => displayName(t.name) === champion) === 0;

        if (parseFloat(margin) < 5) {
            const phrases = [
                `Il Super Bowl? Un thriller! ${champion} beffa ${loserName} per soli ${margin} punti. Una sconfitta che brucerà per anni.`,
                `Finale al cardiopalma: ${champion} piega ${loserName} con uno scarto minimo di ${margin} punti. Che spettacolo!`,
                `Incredibile epilogo! ${champion} sopravvive a una battaglia punto a punto contro ${loserName}.`,
            ];
            parts.push(phrases[yInt % phrases.length]);
        } else if (parseFloat(margin) > 35) {
            const phrases = [
                `Massacro al Super Bowl: ${champion} annienta ${loserName} con un distacco umiliante di ${margin} punti.`,
                `Non c'è mai stata partita: ${champion} demolisce ${loserName} in una finale a senso unico.`,
                `Una lezione di football: ${champion} spazza via ${loserName} con un margine di ${margin} punti.`,
            ];
            parts.push(phrases[(yInt + 1) % phrases.length]);
        } else if (isUnderdog) {
            const phrases = [
                `Clamoroso al Super Bowl! ${champion} ribalta ogni pronostico e zittisce i critici battendo il favorito ${loserName}.`,
                `La favola si compie: partiti come underdog, i ${champion} salgono sul tetto del mondo superando ${loserName}.`,
                `Contro ogni previsione, ${champion} si prende l'anello beffando la favorita ${loserName}.`,
            ];
            parts.push(phrases[(yInt + 2) % phrases.length]);
        } else if (isFirst) {
            const phrases = [
                `${champion} completa l'opera: dominio in regular season e anello al dito. Una stagione perfetta.`,
                `Doppietta leggendaria per ${champion}, che dopo la regular season si prende anche il Super Bowl.`,
                `Non ce n'è per nessuno: ${champion} conferma la sua superiorità battendo anche ${loserName} in finale.`,
            ];
            parts.push(phrases[(yInt + 3) % phrases.length]);
        } else {
            const phrases = [
                `Nella finalissima, ${champion} piega la resistenza di ${loserName} e si prende la gloria eterna.`,
                `L'anello va a ${champion}, che supera ${loserName} nell'atto conclusivo della stagione.`,
                `${champion} scrive il suo nome nell'albo d'oro battendo ${loserName} al Super Bowl.`,
            ];
            parts.push(phrases[yInt % phrases.length]);
        }
    }

    return parts.join(' ');
}

function renderSeasonCard({ year, standings, sbMatchup }, index) {
    // Determine champion from SB matchup
    let champion = null;
    let sbHtml = '';

    if (sbMatchup) {
        const s1 = parseFloat(sbMatchup.team1.score);
        const s2 = parseFloat(sbMatchup.team2.score);
        const winner = s1 >= s2 ? sbMatchup.team1 : sbMatchup.team2;
        const loser = s1 >= s2 ? sbMatchup.team2 : sbMatchup.team1;
        const ws = s1 >= s2 ? s1 : s2;
        const ls = s1 >= s2 ? s2 : s1;
        champion = winner.name;

        const logo1 = TEAM_LOGOS[displayName(winner.name)] || 'images/nfl_logo.png';
        const logo2 = TEAM_LOGOS[displayName(loser.name)] || 'images/nfl_logo.png';

        sbHtml = `
        <div class="history-sub-title">Super Bowl Final</div>
        <div class="history-sb-scoreboard">
            <div class="history-sb-team">
                <img src="${logo1}" alt="${displayName(winner.name)}" class="history-sb-logo">
                <span class="history-sb-name">${displayName(winner.name)}</span>
            </div>
            <div class="history-sb-scores">
                <span class="history-sb-score winner">${ws.toFixed(2)}</span>
                <span class="history-sb-vs">vs</span>
                <span class="history-sb-score loser">${ls.toFixed(2)}</span>
            </div>
            <div class="history-sb-team">
                <span class="history-sb-name">${displayName(loser.name)}</span>
                <img src="${logo2}" alt="${displayName(loser.name)}" class="history-sb-logo">
            </div>
        </div>`;
    }

    // Season recap narrative
    const recap = generateRecap({ year, standings, sbMatchup });
    const recapHtml = recap ? `<div class="history-recap">${recap}</div>` : '';

    // Regular season mini-standings
    const standingsHtml = standings.length ? `
        <div class="history-sub-title">Regular Season</div>
        <div class="history-mini-standings">
            ${standings.map((t, i) => {
        const logo = TEAM_LOGOS[displayName(t.name)] || 'images/nfl_logo.png';
        const winPct = ((t.w / (t.w + t.l)) * 100).toFixed(0);
        return `
                <div class="history-mini-row${t.name === champion ? ' champion' : ''}" data-rank="${i + 1}">
                    <span class="mini-rank rank-${i + 1}">${i + 1}</span>
                    <img src="${logo}" alt="${displayName(t.name)}" class="mini-logo">
                    <span class="mini-team">${displayName(t.name)}</span>
                    <span class="mini-record">${t.w}-${t.l}</span>
                    <span class="mini-pct">${winPct}%</span>
                    <span class="mini-pts">${t.pf.toLocaleString()} PF</span>
                </div>`;
    }).join('')}
        </div>
    ` : '';

    return `
    <div class="history-season-card" style="animation-delay:${index * 100}ms">
        <div class="history-year-header">
            <span class="history-year-badge">${year}</span>
            ${champion ? `<span class="history-champion"><span class="champion-label">SB Champion:</span> <span class="champion-name">${displayName(champion)}</span></span>` : ''}
        </div>
        <div class="history-body">
            ${recapHtml}
            ${standingsHtml}
            ${sbHtml}
        </div>
    </div>`;
}
