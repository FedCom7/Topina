/**
 * Magazine — "Topina Weekly", prima pagina del settimanale della lega.
 * ATTENZIONE: la struttura DOM del giornale (template newspaper) è fragile
 * e va mantenuta IDENTICA — qui cambiano solo testi, immagini e, in modo
 * additivo, l'accento colore (edizione Super Bowl a tema campione).
 *
 * Ogni testo è generato dai dati, in prosa da quotidiano sportivo:
 * recap prolissi dei due matchup, rivalità (H2H stagionale/all-time e
 * strisce nello scontro diretto), interviste al veleno dei coach,
 * gossip sui flop, mercato raccontato waiver per waiver (con storia del
 * giocatore: da quanto era in rosa, chi l'aveva scaricato, punti fatti),
 * anteprima della giornata dopo, numeri della week, edizioni dedicate
 * per playoff e Super Bowl. Le "voci" vivono in data/magazine-voices.js.
 */

import {
    fetchFantasyData, displayName, SEASONS, SEASONS_DESC, CURRENT_SEASON,
    getSeasonConfig, getWeekCount, getSuperBowlMatchup,
} from '../data.js?v=580';
import { TEAM_KEYS } from '../data/team-config.js?v=533';
import { TEAMS } from './team.js?v=705';
import { getLeagueData } from '../data/league-data.js?v=579';
import { getHonorsBundle } from '../data/honors.js?v=631';
import { pickDropdownHTML, bindPickDropdown } from '../ui/dropdown-pick.js?v=1';
import { weekPosRanks, recapArticle, diffMakers, statLine, playerComment, seasonAvg, teamStatTotals } from '../data/matchup-analysis.js?v=555';
import {
    pickSeeded, TRASH_TALK, STREAK_JABS, GOSSIP_EXCUSES,
    LEDE_OPENERS, MARGIN_THRILLER, MARGIN_BLOWOUT, MARGIN_NORMAL,
    TOP_PLAYER_PHRASES, NOTE_LEADS, CLOSERS,
    PLAYER_QUOTES_WIN, PLAYER_QUOTES_LOSS, BENCH_RAGE,
    SB_MVP_QUOTES, DPOY_HONORS_QUOTES, COACH_HONORS_QUOTES,
    RIVALRY_OPENERS, SEASON_SERIES_LINES, STREAK_ALIVE_LINES, STREAK_BROKEN_LINES,
    STANDINGS_LEADER_LINES, NOTEBOOK_LEADER_LINES, GAP_TIED_LINES, GAP_AHEAD_LINES,
    NO_FLOP_LINES, FLOP_WRAP_MAIN, FLOP_WRAP_SECONDARY,
    WAIVER_WRAP_BOTH, WAIVER_WRAP_ADD_ONLY, WAIVER_WRAP_DROP_ONLY, WAIVER_NO_MOVES,
    SECONDARY_LEDE_OPENERS, SECONDARY_NO_FLOP_LINES,
    STAKES_SB_LINES, STAKES_PLAYOFF_LINES, SB_TITLE_COUNT_LINES,
    TEAMMATE_PRAISE,
} from '../data/magazine-voices.js?v=518';
import { playerImageService } from '../services/player-image-service.js?v=522';

let initialized = false;
let currentYear = CURRENT_SEASON;
let currentWeek = 1;
const _cache = {};
const _timelines = {};

const P = (v) => parseFloat(v) || 0;
const fmt = (n) => (+n).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmt1 = (n) => (+n).toLocaleString('it-IT', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const teamOf = (raw) => TEAMS[TEAM_KEYS[displayName(raw)]] || null;
const nameOf = (raw) => teamOf(raw)?.name || displayName(raw);
const keyOf = (raw) => TEAM_KEYS[displayName(raw)] || null;

// Mapping nomi → chiavi wallpaper campo (come in game-center)
const FIELD_KEYS = { 'Oscurus': 'OSCURUS', 'Lasers': 'LASERS', 'Sommo': 'SOMMO', 'Capi dei Pianeti': 'C.D.P' };
const FIELD_IMG_VERSION = 3; // bump quando si sostituiscono i wallpaper (vedi game-center.js)
function fieldImage(m) {
    const k1 = FIELD_KEYS[displayName(m.team1.name)];
    const k2 = FIELD_KEYS[displayName(m.team2.name)];
    const file = (k1 && k2) ? `Wallpapers/GameCenterHorizontal_${k1}_${k2}.png` : 'Wallpapers/GameCenterHorizontal.PNG';
    return `${file}?v=${FIELD_IMG_VERSION}`;
}

// ─── Testata: SVG inline (niente asset esterni) ──────────────────

/**
 * Testata del giornale: nome fisso "Topina Weekly", tranne nell'edizione
 * Super Bowl dove diventa "{Squadra Campione} Weekly". viewBox più alto e
 * testo spostato in basso (rispetto alla prima versione) perché il
 * margin-top negativo di .publisher_name — pensato per l'immagine del
 * vecchio template — spingeva le lettere a sovrapporsi alla riga
 * superiore del riquadro. textLength fissa mantiene la stessa larghezza
 * per nomi corti ("Topina") e lunghi ("Capi dei Pianeti Weekly").
 */
function mastheadSVG(name) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 80"><text x="320" y="64" text-anchor="middle" textLength="600" lengthAdjust="spacingAndGlyphs" font-family="Georgia, 'Times New Roman', serif" font-weight="bold" font-size="54" letter-spacing="2" fill="#000">${name}</text></svg>`;
    return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
}

// ─── Init & navigazione ──────────────────────────────────────────

export function initMagazine() {
    if (initialized) return;
    initialized = true;

    const container = document.getElementById('magazine-content');
    if (!container) return;

    // Anno e week in due tendine affiancate, come nel resto del sito: qui
    // erano rimaste due file di capsule, e con otto stagioni e diciassette
    // week occupavano piu' spazio della testata del giornale.
    // Week e anno in una riga sola, allineata a destra: e' la stessa `pick-row`
    // di Game Center, Draft e Analysis. L'anno sta per ultimo — piu' a destra —
    // ed e' quello rosso, perche' `[data-pick-id="year"]` e' l'aggancio con cui
    // il CSS lo distingue dall'altra scelta.
    container.innerHTML = `
        <div class="pick-row" id="mg-pick-row"></div>
        <div id="mg-paper"><div class="loading-state"><div class="spinner"></div><p>Printing...</p></div></div>`;

    montaPicks();
    loadYear(currentYear);
}

/* Le week dell'anno in corso, tenute qui perche' servono a ridisegnare la
   riga delle tendine anche quando cambia solo la week. */
let _played = [];
let _config = null;

/** Week e anno, ridisegnate insieme: sono una riga sola. */
function montaPicks() {
    const box = document.getElementById('mg-pick-row');
    if (!box) return;

    const anni = SEASONS_DESC;
    // Confronto per stringa: `SEASONS` sono stringhe, e cercare un numero
    // farebbe ripiegare la capsula sulla prima voce.
    const iAnno = anni.findIndex(y => String(y) === String(currentYear));
    const vociAnno = anni.map(y => ({ value: String(y), label: String(y) }));

    let settimane = '';
    if (_played.length && _config) {
        const ordine = [..._played].reverse();
        const voci = ordine.map(w => ({
            value: String(w),
            label: w === _config.superBowlWeek ? 'Super Bowl'
                : w === _config.playoffWeek ? 'Playoffs' : `Week ${w}`,
        }));
        const i = ordine.indexOf(currentWeek);
        settimane = pickDropdownHTML('week', voci, i < 0 ? 0 : i);
    }

    box.innerHTML = settimane + pickDropdownHTML('year', vociAnno, iAnno < 0 ? 0 : iAnno);
    bindPickDropdown(box, (id, valore) => {
        if (id === 'year') {
            if (String(valore) === String(currentYear)) return;
            loadYear(String(valore));
            return;
        }
        const w = parseInt(valore, 10);
        if (w === currentWeek) return;
        currentWeek = w;
        montaPicks();
        renderEdition();
    });
}

async function loadYear(year) {
    currentYear = year;
    _played = []; _config = null;   // le week sono quelle dell'anno vecchio
    montaPicks();                   // la capsula non si riscrive da sola
    const paper = document.getElementById('mg-paper');
    paper.innerHTML = `<div class="loading-state"><div class="spinner"></div><p>Printing the ${year} edition...</p></div>`;

    if (!_cache[year]) _cache[year] = await fetchFantasyData(year);
    const data = _cache[year];
    if (!data?.weeks) {
        paper.innerHTML = `<div class="empty-state"><p class="empty-state-text">No edition for ${year}</p></div>`;
        return;
    }

    // week giocate (con punteggi reali)
    const played = [];
    for (let w = 1; w <= getWeekCount(data); w++) {
        const wk = data.weeks[String(w)];
        if (wk?.matchups?.some(m => m.team1 && m.team2 && (P(m.team1.score) > 0 || P(m.team2.score) > 0))) played.push(w);
    }
    if (!played.length) {
        paper.innerHTML = `<div class="empty-state"><p class="empty-state-text">${year} season not started yet</p></div>`;
        return;
    }

    currentWeek = played[played.length - 1]; // ultima edizione = ultima week giocata
    _played = played;
    _config = getSeasonConfig(year);
    montaPicks();
    renderEdition();
}


// ─── L'edizione ──────────────────────────────────────────────────

async function renderEdition() {
    const paper = document.getElementById('mg-paper');
    const year = currentYear, week = currentWeek;
    const data = _cache[year];
    const weekData = data.weeks[String(week)];
    const config = getSeasonConfig(year);
    const isPlayoff = week === config.playoffWeek;
    const isSB = week === config.superBowlWeek;

    const [bundle, league] = await Promise.all([getHonorsBundle(year), getLeagueData()]);
    if (currentYear !== year || currentWeek !== week) return; // l'utente ha già cambiato edizione
    const ranks = weekPosRanks(weekData);
    const season = league.seasons.find(s => s.year === year);
    const standings = standingsAsOf(season, week, config);

    // scelta partite: principale = margine più tirato (in SB week: la finale)
    let matchups = (weekData.matchups || []).filter(m => m.team1 && m.team2);
    let main, second;
    if (isSB) {
        main = getSuperBowlMatchup(data, year) || matchups[0];
        second = matchups.find(m => m !== main && !sameMatchup(m, main)) || null;
    } else {
        const sorted = [...matchups].sort((a, b) => marginOf(a) - marginOf(b));
        main = sorted[0];
        second = sorted[1] || null;
    }
    if (!main) {
        paper.innerHTML = `<div class="empty-state"><p class="empty-state-text">No matchup this week</p></div>`;
        return;
    }

    const seed = (+year) * 37 + week;
    const moves = week >= 2 && !isSB ? waiverStories(data, year, week) : [];
    const champion = isSB ? teamOf(winnerOf(main).name) : null;

    paper.innerHTML = newspaperHTML({
        year, week, config, isPlayoff, isSB, seed,
        data, weekData, bundle, ranks, standings,
        main, second, moves, champion, season, league,
        h2hMain: h2hFor(league, main, year, week),
        h2hSecond: second ? h2hFor(league, second, year, week) : null,
    });

    loadHeadshots(paper, year);
}

/** Foto giocatori nel giornale (stesso servizio di draft/analisi) */
function loadHeadshots(paper, year) {
    paper.querySelectorAll('.mg-headshot[data-player-name]').forEach(async (img) => {
        if (!img.dataset.playerName) return;
        img.onerror = () => {
            if (!img.src.endsWith('fallback-player.svg')) img.src = 'images/fallback-player.svg';
        };
        try {
            const url = await playerImageService.getPlayerImageUrl(
                img.dataset.playerName, img.dataset.team, img.dataset.pos, year);
            if (url) img.src = url;
        } catch { /* resta il fallback */ }
    });
}

// ─── Helpers dati ────────────────────────────────────────────────

const marginOf = (m) => Math.abs(P(m.team1.score) - P(m.team2.score));
const winnerOf = (m) => P(m.team1.score) >= P(m.team2.score) ? m.team1 : m.team2;
const loserOf = (m) => P(m.team1.score) >= P(m.team2.score) ? m.team2 : m.team1;
const sameMatchup = (a, b) => displayName(a.team1.name) === displayName(b.team1.name) && displayName(a.team2.name) === displayName(b.team2.name);

/** Classifica "alla week W" (regular season) */
function standingsAsOf(season, week, config) {
    if (!season) return [];
    const upTo = Math.min(week, config.regularSeasonWeeks);
    return Object.entries(season.perTeam).map(([key, t]) => {
        const games = t.games.filter(g => g.week <= upTo);
        return {
            key, name: TEAMS[key]?.name || key,
            w: games.filter(g => g.won).length,
            l: games.filter(g => !g.won && g.pts !== g.oppPts).length,
            pf: games.reduce((s, g) => s + g.pts, 0),
        };
    }).sort((a, b) => b.w - a.w || b.pf - a.pf);
}

/**
 * Head-to-head tra le due squadre di un matchup, contando SOLO le partite
 * di regular season precedenti a quella raccontata (cronologicamente,
 * attraverso tutte le stagioni). Dal punto di vista del VINCITORE di oggi:
 * { allTime: {w,l,t}, season: {w,l}, streak: {holderKey, len} }
 */
function h2hFor(league, m, year, week) {
    const wKey = keyOf(winnerOf(m).name);
    const lKey = keyOf(loserOf(m).name);
    if (!wKey || !lKey) return null;

    const games = []; // in ordine cronologico, dal punto di vista del vincitore
    league.seasons.forEach(s => {
        if (+s.year > +year) return;
        (s.perTeam[wKey]?.games || [])
            .filter(g => g.opp === lKey && (+s.year < +year || g.week < week))
            .sort((a, b) => a.week - b.week)
            .forEach(g => games.push({ year: s.year, won: g.won, tie: g.pts === g.oppPts }));
    });

    const allTime = { w: 0, l: 0, t: 0 };
    games.forEach(g => g.tie ? allTime.t++ : g.won ? allTime.w++ : allTime.l++);
    const seasonGames = games.filter(g => g.year === year);
    const season = { w: seasonGames.filter(g => g.won).length, l: seasonGames.filter(g => !g.won && !g.tie).length };

    let streak = { holderKey: null, len: 0 };
    for (let i = games.length - 1; i >= 0; i--) {
        if (games[i].tie) break;
        const holder = games[i].won ? wKey : lKey;
        if (!streak.holderKey) { streak.holderKey = holder; streak.len = 1; }
        else if (streak.holderKey === holder) streak.len++;
        else break;
    }
    return { wKey, lKey, allTime, season, streak, played: games.length };
}

/** Timeline roster della stagione: nome → [{week, teamKey, pts}] */
function rosterTimeline(year, data) {
    if (_timelines[year]) return _timelines[year];
    const byPlayer = new Map();
    for (let w = 1; w <= getWeekCount(data); w++) {
        (data.weeks[String(w)]?.matchups || []).forEach(m => [m.team1, m.team2].forEach(t => {
            if (!t) return;
            const key = keyOf(t.name);
            [...(t.starters || []), ...(t.bench || [])].forEach(p => {
                if (!byPlayer.has(p.name)) byPlayer.set(p.name, []);
                byPlayer.get(p.name).push({ week: w, teamKey: key, pts: P(p.fantasy_points) });
            });
        }));
    }
    _timelines[year] = byPlayer;
    return byPlayer;
}

/**
 * Il mercato della week, raccontato: per ogni squadra le entrate (con
 * eventuale ex proprietario e punti stagionali) e le uscite (durata dello
 * stint e punti prodotti). → array di frasi complete.
 */
function waiverStories(data, year, week) {
    const timeline = rosterTimeline(year, data);
    const rosterMap = (wk) => {
        const map = {};
        (data.weeks[String(wk)]?.matchups || []).forEach(m => [m.team1, m.team2].forEach(t => {
            if (!t) return;
            const key = keyOf(t.name);
            if (key) map[key] = new Set([...(t.starters || []), ...(t.bench || [])].map(p => p.name));
        }));
        return map;
    };
    const prev = rosterMap(week - 1);
    const curr = rosterMap(week);
    const stories = [];

    Object.keys(curr).forEach(key => {
        if (!prev[key]) return;
        const team = TEAMS[key]?.name || key;
        const adds = [...curr[key]].filter(n => !prev[key].has(n));
        const drops = [...prev[key]].filter(n => !curr[key].has(n));
        if (!adds.length && !drops.length) return;

        const addTxt = adds.map(n => {
            const hist = (timeline.get(n) || []).filter(e => e.week < week);
            const seasonPts = hist.reduce((s, e) => s + e.pts, 0);
            const prevStint = hist[hist.length - 1];
            if (!prevStint) return `${n}, pescato dal mercato dei liberi`;
            const exTeam = TEAMS[prevStint.teamKey]?.name || 'un rivale';
            return `${n} — scaricato da ${exTeam} dopo la week ${prevStint.week}, riparte da qui con ${fmt1(seasonPts)} punti stagionali già a referto`;
        });

        const dropTxt = drops.map(n => {
            const hist = (timeline.get(n) || []).filter(e => e.week < week && e.teamKey === key);
            let start = week - 1;
            for (let w = week - 1; w >= 1; w--) {
                if (hist.some(e => e.week === w)) start = w; else break;
            }
            const stintWeeks = week - start;
            const stintPts = hist.filter(e => e.week >= start).reduce((s, e) => s + e.pts, 0);
            return `${n}, salutato dopo ${stintWeeks} settiman${stintWeeks === 1 ? 'a' : 'e'} in rosa e ${fmt1(stintPts)} punti prodotti`;
        });

        // seed per-squadra: stessa week, squadre diverse → varianti diverse
        const teamSeed = weekSeed(year, week) + key.length * 5 + Object.keys(curr).indexOf(key) * 13;
        let txt;
        if (addTxt.length && dropTxt.length) txt = pick(WAIVER_WRAP_BOTH, teamSeed)({ team, adds: addTxt.join('; '), drops: dropTxt.join('; ') });
        else if (addTxt.length) txt = pick(WAIVER_WRAP_ADD_ONLY, teamSeed)({ team, adds: addTxt.join('; ') });
        else txt = pick(WAIVER_WRAP_DROP_ONLY, teamSeed)({ team, drops: dropTxt.join('; ') });
        stories.push(txt);
    });
    return stories;
}

/** Seed stabile per week: usato per variare i testi senza serializzare l'intero ctx */
function weekSeed(year, week) {
    return (+year) * 37 + week;
}

/** Il flop di giornata: peggior scostamento dalla media stagionale */
function flopOf(m, bundle) {
    let worst = null;
    [m.team1, m.team2].forEach(t => (t.starters || []).forEach(p => {
        const avg = seasonAvg(bundle, p.name);
        if (!avg || avg < 6) return;
        const v = P(p.fantasy_points);
        const delta = (v - avg) / avg;
        if (delta <= -0.35 && (!worst || delta < worst.delta)) worst = { p, v, avg, delta, teamRaw: t.name };
    }));
    return worst;
}

/** Scelta deterministica tra varianti (stessa edizione → stessa frase) */
const pick = pickSeeded;

// ─── Generatori di testo ─────────────────────────────────────────

function mainHeadline({ main, isPlayoff, isSB, week }) {
    const w = nameOf(winnerOf(main).name), l = nameOf(loserOf(main).name);
    const margin = marginOf(main);
    const dm = diffMakers(main);
    const topP = winnerOf(main) === main.team1 ? dm.a : dm.b;
    if (isSB) return { vertical: 'finale', l1: `${w} Campione!`, l2: `Il Super Bowl è suo` };
    if (isPlayoff) return { vertical: 'playoff', l1: `${w} vola in finale,`, l2: `${l} eliminata` };
    if (margin < 5) return { vertical: `week ${week}`, l1: `Thriller ${nameOf(main.team1.name)}-${nameOf(main.team2.name)}:`, l2: `la spunta ${w}` };
    if (margin >= 20) return { vertical: `week ${week}`, l1: `${topP?.name || w} show,`, l2: `${w} travolge ${l}` };
    return { vertical: `week ${week}`, l1: `${w} fa la voce grossa,`, l2: `${l} resta al palo` };
}

/** Intervista al coach vincente — zizzania garantita, striscia rinfacciata */
function coachQuote(main, seed, h2h) {
    const w = nameOf(winnerOf(main).name), l = nameOf(loserOf(main).name);
    const dm = diffMakers(main);
    const top = winnerOf(main) === main.team1 ? dm.a : dm.b;
    const ctx = {
        winner: w, loser: l,
        topName: top?.name || 'la squadra',
        topPts: fmt(P(top?.fantasy_points)),
        margin: fmt(marginOf(main)),
    };
    let quote = pick(TRASH_TALK, seed)(ctx);
    // se il vincitore dominava già lo scontro diretto, il coach non se lo tiene
    if (h2h?.streak?.holderKey === h2h?.wKey && h2h.streak.len >= 2) {
        quote += pick(STREAK_JABS, seed + 3)(h2h.streak.len + 1, l);
    }
    const titles = [
        { sup: `Il coach di ${w}`, main: 'non fa prigionieri' },
        { sup: `Dallo spogliatoio di ${w}`, main: 'volano frecciate' },
        { sup: `Il coach di ${w}`, main: 'accende la rivalità' },
        { sup: `Microfoni aperti:`, main: `${w} ruggisce` },
    ];
    return { quote, title: pick(titles, seed) };
}

/** I 3 paragrafi prolissi del pezzo principale */
function mainParagraphs({ main, bundle, seed, h2h, standings, isSB, isPlayoff, year, league }) {
    const wT = winnerOf(main), lT = loserOf(main);
    const w = nameOf(wT.name), l = nameOf(lT.name);
    const sW = fmt(Math.max(P(main.team1.score), P(main.team2.score)));
    const sL = fmt(Math.min(P(main.team1.score), P(main.team2.score)));
    const margin = marginOf(main);
    const dm = diffMakers(main);
    const top = wT === main.team1 ? dm.a : dm.b;

    // P1 — il lede scenografico
    const marginBank = margin < 5 ? MARGIN_THRILLER : margin >= 20 ? MARGIN_BLOWOUT : MARGIN_NORMAL;
    const marginTxt = pick(marginBank, seed).replaceAll('{margin}', fmt(margin)).replaceAll('{loser}', l);
    const topTxt = pick(TOP_PLAYER_PHRASES, seed + 1)
        .replaceAll('{top}', top?.name || w)
        .replaceAll('{pts}', fmt(P(top?.fantasy_points)))
        .replaceAll('{stat}', statLine(top) || 'una prova totale, di quelle che non hanno bisogno di note a margine');
    const stakes = isSB ? pick(STAKES_SB_LINES, seed + 18)({ year })
        : isPlayoff ? pick(STAKES_PLAYOFF_LINES, seed + 18) : '';
    const p1 = `${pick(LEDE_OPENERS, seed)}${w} ha piegato ${l} con il punteggio di ${sW} a ${sL}.${stakes} ${marginTxt} ${topTxt}`;

    // P2 — il flop e il gossip
    const flop = flopOf(main, bundle);
    let p2;
    if (flop) {
        const flopTeam = nameOf(flop.teamRaw);
        const excuse = pick(GOSSIP_EXCUSES, seed + flop.p.name.length);
        p2 = pick(FLOP_WRAP_MAIN, seed + 4 + flop.p.name.length)({ name: flop.p.name, pts: fmt(flop.v), avg: fmt1(flop.avg), team: flopTeam, excuse });
    } else {
        const secondBest = [...(wT.starters || [])].sort((a, b) => P(b.fantasy_points) - P(a.fantasy_points))[1];
        p2 = pick(NO_FLOP_LINES, seed + 4)({ l });
        if (secondBest) p2 += ` Sul fronte opposto, oltre al solito protagonista, anche ${secondBest.name} ha portato mattoni pesanti alla causa con ${fmt(P(secondBest.fantasy_points))} punti: quando i comprimari girano così, per gli avversari il conto si fa salato.`;
    }

    // P3 — rivalità, strisce e classifica
    const parts = [];
    if (h2h && h2h.played > 0) {
        const at = h2h.allTime;
        const record = `${at.w + 1}-${at.l}${at.t ? ` (più ${at.t} pareggi)` : ''}`;
        parts.push(pick(RIVALRY_OPENERS, seed + 5)({ record, w }));
        if (h2h.season.w + h2h.season.l > 0) {
            parts.push(pick(SEASON_SERIES_LINES, seed + 6)({ record: `${h2h.season.w + 1}-${h2h.season.l}`, w }));
        }
        if (h2h.streak.holderKey === h2h.wKey && h2h.streak.len >= 2) {
            parts.push(pick(STREAK_ALIVE_LINES, seed + 7)({ len: h2h.streak.len + 1, w, l }));
        } else if (h2h.streak.holderKey === h2h.lKey && h2h.streak.len >= 2) {
            parts.push(pick(STREAK_BROKEN_LINES, seed + 8)({ len: h2h.streak.len, l }));
        }
    }
    if (!isSB && !isPlayoff) {
        const lead = standings[0];
        if (lead) parts.push(pick(STANDINGS_LEADER_LINES, seed + 9)({ name: lead.name, wins: lead.w }));
    } else if (isSB) {
        const key = keyOf(wT.name);
        const titles = league.allTime[key]?.sbWins?.length || 1;
        parts.push(pick(SB_TITLE_COUNT_LINES, seed + 19)({ titles }));
    }
    parts.push(pick(CLOSERS, seed + 2));
    const p3 = parts.join(' ');

    return [p1, p2, p3];
}

/**
 * Interviste dagli spogliatoi: riempiono gli spazi vuoti del giornale.
 * I panchinari con tanti punti attaccano l'allenatore; poi un vincitore
 * che gongola e uno sconfitto che mastica amaro.
 */
function lockerRoomQuotes({ weekData, main, second, seed }) {
    const quotes = [];

    // panchinari d'oro di tutta la week: puntano il dito contro il coach
    const benched = [];
    (weekData.matchups || []).forEach(m => [m.team1, m.team2].forEach(t => {
        (t?.bench || []).forEach(p => {
            const v = P(p.fantasy_points);
            if (v >= 11) benched.push({ p, v, teamRaw: t.name });
        });
    }));
    benched.sort((a, b) => b.v - a.v).slice(0, 2).forEach(({ p, v, teamRaw }, i) => {
        const team = nameOf(teamRaw);
        const q = pick(BENCH_RAGE, seed + i * 5 + p.name.length)({ name: p.name, pts: fmt(v), team });
        quotes.push(`Il caso della settimana scoppia in casa ${team}: ${p.name}, autore di ${fmt(v)} punti rimasti a marcire in panchina, non usa giri di parole. ${q}`);
    });

    // il vincitore gongola (la seconda voce del match clou)
    const wT = winnerOf(main), lT = loserOf(main);
    const wStarters = [...(wT.starters || [])].sort((a, b) => P(b.fantasy_points) - P(a.fantasy_points));
    const speaker = wStarters[1] || wStarters[0];
    if (speaker) {
        const q = pick(PLAYER_QUOTES_WIN, seed + speaker.name.length)({
            name: speaker.name, pts: fmt(P(speaker.fantasy_points)),
            team: nameOf(wT.name), opp: nameOf(lT.name),
        });
        quotes.push(`Dagli spogliatoi di ${nameOf(wT.name)}, ${speaker.name} gongola davanti ai microfoni: ${q}`);
    }

    // lo sconfitto mastica amaro (il migliore dei suoi)
    const lBest = [...(lT.starters || [])].sort((a, b) => P(b.fantasy_points) - P(a.fantasy_points))[0];
    if (lBest) {
        const q = pick(PLAYER_QUOTES_LOSS, seed + 2 + lBest.name.length)({
            name: lBest.name, pts: fmt(P(lBest.fantasy_points)),
            team: nameOf(lT.name), opp: nameOf(wT.name),
        });
        quotes.push(`Di tutt'altro umore ${lBest.name}, che in zona mista mastica amarissimo: ${q}`);
    }

    // voci anche dall'altra partita (la spalla del vincitore e il migliore
    // degli sconfitti), diverse dal protagonista della colonna "Show"
    if (second) {
        const wS = winnerOf(second), lS = loserOf(second);
        const runner = [...(wS.starters || [])].sort((a, b) => P(b.fantasy_points) - P(a.fantasy_points))[1];
        if (runner) {
            const q = pick(PLAYER_QUOTES_WIN, seed + 23 + runner.name.length)({
                name: runner.name, pts: fmt(P(runner.fantasy_points)),
                team: nameOf(wS.name), opp: nameOf(lS.name),
            });
            quotes.push(`Sorrisi anche nell'altro spogliatoio vincente: ${runner.name} (${nameOf(wS.name)}) si gode la serata: ${q}`);
        }
        const lBestS = [...(lS.starters || [])].sort((a, b) => P(b.fantasy_points) - P(a.fantasy_points))[0];
        if (lBestS) {
            const q = pick(PLAYER_QUOTES_LOSS, seed + 24 + lBestS.name.length)({
                name: lBestS.name, pts: fmt(P(lBestS.fantasy_points)),
                team: nameOf(lS.name), opp: nameOf(wS.name),
            });
            quotes.push(`Dall'altra sfida arriva invece lo sfogo di ${lBestS.name} (${nameOf(lS.name)}): ${q}`);
        }
    }
    return quotes;
}

/** Colonna di destra: il Taccuino — mercato raccontato + classifica */
function notebookParas({ standings, moves, isPlayoff, isSB, main, bundle, season, league, week, config, year }, fillers = []) {
    const seed = weekSeed(year, week);
    const paras = [];
    if (isSB) {
        const champ = teamOf(winnerOf(main).name);
        const key = keyOf(winnerOf(main).name);
        const titles = league.allTime[key]?.sbWins?.length || 1;
        const rec = season?.perTeam?.[key];
        paras.push(`Il trionfo di ${champ?.name} è il capitolo finale di una stagione da ${rec ? `${rec.w} vittorie e ${Math.round(rec.pf)} punti totali` : 'assoluta protagonista'}: per il franchise è il titolo numero ${titles}, e in bacheca lo spazio non manca mai.`);
        const mvp = bundle?.awards?.find(a => a.id === 'mvp')?.winner;
        if (mvp) paras.push(`Ai Topina Honors, intanto, la corona di MVP è andata a ${mvp.name}: ${fmt(mvp.total)} punti in regular season, un dominio che questo giornale ha raccontato edizione dopo edizione, senza mai stancarsi.`);
        paras.push(`E ora? Il mercato si ferma, i rancori no: le altre tre contendenti hanno già acceso le lavagne tattiche in vista del draft, con una sola parola d'ordine — detronizzare il campione.`);
        paras.push(`L'appuntamento con il Topina Weekly è alla prossima stagione: si riparte dal via, ma i conti in sospeso restano tutti aperti.`);
    } else {
        const lead = standings[0];
        if (lead) {
            const chaser = standings[1];
            const gap = chaser ? lead.w - chaser.w : 0;
            let leadTxt = pick(NOTEBOOK_LEADER_LINES, seed + 10)({ name: lead.name, wins: lead.w, pf: Math.round(lead.pf) });
            if (chaser) {
                leadTxt += ' ' + (gap === 0
                    ? pick(GAP_TIED_LINES, seed + 11)({ chaser: chaser.name })
                    : pick(GAP_AHEAD_LINES, seed + 11)({ chaser: chaser.name, gapTxt: `${gap} lunghezz${gap === 1 ? 'a' : 'e'}` }));
            }
            paras.push(leadTxt);
        }
        if (moves.length) {
            // massimo 3 paragrafi di mercato: se le mosse sono di più, si accorpano
            const packed = moves.length <= 3 ? moves : [moves[0], moves[1], moves.slice(2).join(' ')];
            packed.forEach(txt => paras.push(txt));
        } else {
            paras.push(pick(WAIVER_NO_MOVES, seed + 12));
        }
        if (isPlayoff) {
            paras.push(`Domenica notte sapremo tutto: chi festeggia il pass per la finale e chi passerà l'inverno a rimuginare su un lineup sbagliato. Il Taccuino, come sempre, sarà in prima fila.`);
        } else {
            const left = config.regularSeasonWeeks - week;
            paras.push(left > 0
                ? `Il calendario intanto scorre: al termine della regular season mancano ${left} giornat${left === 1 ? 'a' : 'e'}, e la matematica comincia a bussare alla porta di tutti. Ogni punto fatto oggi è un mattone sulla casa dei playoff.`
                : `Regular season in archivio: da qui in poi si fa sul serio, benvenuti ai playoff. Il Taccuino consiglia: niente esperimenti, dentro i titolarissimi.`);
        }
    }
    // gli spazi rimasti si riempiono con le interviste dagli spogliatoi
    while (paras.length < 5 && fillers.length) paras.push(fillers.shift());
    while (paras.length < 5) paras.push('');
    return paras.slice(0, 5);
}

/** Striscia "exclusive": anteprima / annuncio SB / celebrazione */
function exclusiveStrip({ data, week, config, isPlayoff, isSB, main, weekData, standings, bundle }) {
    if (isSB) {
        const w = nameOf(winnerOf(main).name);
        const mvp = bundle?.awards?.find(a => a.id === 'mvp')?.winner;
        return {
            marker: 'campioni',
            t1: 'il trono è di', t2: w.toUpperCase(),
            left: `La corsa è finita: ${w} mette le mani sul titolo della Topina League e si prende la copertina, i cori e il diritto — sancito dal regolamento non scritto — di sfottere chiunque fino a settembre.`,
            right: `Nella notte dei campioni brillano anche i Topina Honors${mvp ? `: l'MVP ${mvp.name} chiude una stagione irripetibile` : ''}. L'albo d'oro ha un nuovo nome inciso, e c'è già chi giura vendetta.`,
            link: 'Rivivi la finale nel Game Center.',
        };
    }
    if (isPlayoff) {
        const winners = (weekData.matchups || []).filter(m => m.team1 && m.team2).map(m => nameOf(winnerOf(m).name));
        return {
            marker: 'super bowl',
            t1: winners[0] ? `sarà ${winners[0]}` : 'la finale', t2: winners[1] ? `contro ${winners[1]}` : 'è servita',
            left: `Le semifinali hanno emesso il loro verdetto: il Super Bowl è apparecchiato e le due contendenti hanno già iniziato a studiarsi. Sette giorni di sfottò, dichiarazioni al vetriolo e formazioni segretissime: poi, finalmente, parlerà il campo.`,
            right: `Chi alzerà il trofeo? Le quote della redazione si spaccano a metà, e forse è giusto così: servirà la partita perfetta, il lineup perfetto e — diciamolo — anche quel pizzico di follia che le finali pretendono sempre.`,
            link: 'La playoff picture completa in Standings.',
        };
    }
    const next = data.weeks[String(week + 1)];
    const nextMatchups = (next?.matchups || []).filter(m => m.team1 && m.team2);
    if (nextMatchups.length && week + 1 <= config.regularSeasonWeeks) {
        const recOf = (raw) => {
            const s = standings.find(x => x.key === keyOf(raw));
            return s ? `${s.w}-${s.l}` : '';
        };
        const [a, b] = nextMatchups;
        return {
            marker: 'anteprima',
            t1: `la week ${week + 1}`, t2: 'è dietro l\'angolo',
            left: a ? `${nameOf(a.team1.name)} (${recOf(a.team1.name)}) sfida ${nameOf(a.team2.name)} (${recOf(a.team2.name)}): i precedenti promettono scintille e nessuna delle due può permettersi di guardare altrove.` : '',
            right: b ? `Nell'altra sfida ${nameOf(b.team1.name)} (${recOf(b.team1.name)}) incrocia ${nameOf(b.team2.name)} (${recOf(b.team2.name)}). Occhio alle scelte di lineup e al mercato di martedì: la classifica non perdona i distratti.` : '',
            link: 'Tutti i matchup nel Game Center.',
        };
    }
    // ultima week di RS → annuncio playoff
    const seeds = standings.slice(0, 4);
    return {
        marker: 'playoffs',
        t1: 'si fa sul serio:', t2: 'ecco i playoff',
        left: seeds.length >= 4 ? `La regular season va in archivio: ${seeds[0].name} (testa di serie) pesca ${seeds[3].name}, mentre ${seeds[1].name} incrocia ${seeds[2].name}. Due semifinali, quattro destini, zero margine d'errore.` : 'La regular season va in archivio: le semifinali sono pronte e nessuno vuole fare da comparsa.',
        right: `Da qui in avanti si azzera tutto: un weekend storto e la stagione finisce nel cassetto dei rimpianti. La redazione consiglia: niente esperimenti, dentro i titolarissimi, e che vinca il migliore.`,
        link: 'La playoff picture in Standings.',
    };
}

// ─── Il giornale (STRUTTURA INVARIATA — cambiano solo i contenuti) ──

function newspaperHTML(ctx) {
    const { year, week, isSB, main, second, standings, bundle, ranks, champion, league, seed, h2hMain, h2hSecond } = ctx;
    const head = mainHeadline(ctx);
    const cq = coachQuote(main, seed, h2hMain);
    const paras = mainParagraphs({ ...ctx, h2h: h2hMain });
    const locker = lockerRoomQuotes(ctx);
    const notebook = notebookParas(ctx, locker);
    const strip = exclusiveStrip(ctx);

    // player notes del match clou → trafiletti colonne (con attacchi variati)
    const notesTexts = [main.team1, main.team2].flatMap(t =>
        (t.starters || []).map(p => ({ p, v: P(p.fantasy_points) })))
        .sort((a, b) => b.v - a.v).slice(1, 5)
        .map(({ p }, i) => `${pick(NOTE_LEADS, seed + i)} ${p.name} — ${playerComment(p, bundle, ranks)}`);
    // eventuali trafiletti rimasti vuoti → altre voci dagli spogliatoi
    while (notesTexts.length < 4 && locker.length) notesTexts.push(locker.shift());

    // numeri della week (al posto del meteo)
    const weather = weatherSlots(ctx);

    // storia secondaria: seconda partita, o Honors nell'edizione SB
    const recap2 = second ? recapArticle(second, bundle, ranks, {
        year, weekNum: week, weekLabel: `Week ${week}`, isPlayoff: ctx.isPlayoff, isSB,
        seriesGames: [], teamName: nameOf,
    }) : null;
    const secondary = second && !isSB
        ? secondaryGame(second, recap2, week, bundle, seed, h2hSecond, standings, [main, second])
        : secondaryHonors(bundle, champion, main, seed) || (second ? secondaryGame(second, recap2, week, bundle, seed, h2hSecond, standings, [main, second]) : null);

    const foot = footerStory(ctx);
    const topics = topicsRow(ctx);

    const paperClass = champion ? 'news-page mag-accented' : 'news-page';
    const paperStyle = champion ? ` style="--mag-accent:${champion.color}"` : '';

    return `
<div class="mag-wrapper">
<div class="${paperClass}"${paperStyle}>
  <div class="news-page__section publisher">
    <div class="publisher_name">
      <img src="${mastheadSVG(champion ? `${champion.name} Weekly` : 'Topina Weekly')}" alt="${champion ? champion.name : 'Topina'} Weekly">
      <div class="tagline">IL SETTIMANALE UFFICIALE DELLA TOPINA LEAGUE · DAL 2019</div>
    </div>
  </div>
  <div class="news-page__section exclusive-story">
    <div class="exclusive-story__marker">${strip.marker}</div>
    <div class="exclusive-story__preview">
      <div class="preview-title">
        <span class="text--uppercase display--block">${strip.t1}</span>
        <span>${strip.t2}</span>
      </div>
      <div class="preview-content-wrapper">
        <div class="preview-content">
          <div class="preview-content--left">
            ${strip.left}
          </div>
          <div class="preview-content--right">
            ${strip.right}
          </div>
        </div>
        <div class="preview-content--link">
            ${strip.link}
          </div>
      </div>
    </div>
  </div>
  <div class="news-page__section stories">
    <div class="story story--main">
      <div class="column column--left">
        <div class="story-title">
          <div class="story-title--first-line">
            <div class="title-text text--vertical">${head.vertical}</div>
            <div class="title-text text--normal">${head.l1}</div>
          </div>
          <div class="story-title--second-line">
            <div class="title-text text--normal">${head.l2}</div>
          </div>
        </div>
        <div class="story-content">
          <div class="story-column column--first">
            <div class="paragraph first">
              <p>${paras[0]}</p>
            </div>
            <div class="paragraph">
              <p class="text--capitalize-first">${paras[1]}</p>
            </div>
            <div class="paragraph">
              <p>${paras[2]}</p>
            </div>
          </div>
          <div class="story-column column--second-third">
            <p class="story-featured-photo"><img src="${fieldImage(main)}" onerror="this.src='Wallpapers/GameCenterHorizontal.PNG?v=${FIELD_IMG_VERSION}'" alt=""></p>
            <div class="blockquote-wrapper">
              <div class="blockquote-title">
                <div class="text--superscript">${cq.title.sup}</div>
                <div class="text--normal">${cq.title.main}</div>
              </div>
              <div class="blockquote-content">
                ${cq.quote}
              </div>
            </div>
            <div class="columns-wrapper">
              <div class="column first">
                <div class="paragraph">
                  <p>${notesTexts[0] || ''}</p>
                </div>
                <div class="paragraph">
                  <p>${notesTexts[1] || ''}</p>
                </div>
              </div>
              <div class="column">
                <div class="paragraph">
                  <p>${notesTexts[2] || ''}</p>
                </div>
                <div class="paragraph">
                  <p>${notesTexts[3] || ''}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div class="column column--right">
        <div class="author">
          <div class="name">Il Taccuino Topino</div>
          <div class="footnote">mercato &amp; classifica</div>
        </div>
        <div class="paragraph">
          <p class="text--capitalize-first">${notebook[0] || ''}</p>
        </div>
        <div class="paragraph">
          <p>${notebook[1] || ''}</p>
        </div>
        <div class="paragraph">
          <p>${notebook[2] || ''}</p>
        </div>
        <div class="paragraph">
          <p>${notebook[3] || ''}</p>
        </div>
        <div class="paragraph">
          <p>${notebook[4] || ''}</p>
        </div>
      </div>
    </div>
    <div class="story-divider"></div>
    <div class="story story--secondary">
      <div class="columns-wrapper">
        <div class="column first">
          <p class="story-title--secondary">
            ${secondary.title}
          </p>
          <div class="story-featured-photo">
            <img src="${secondary.photo}"
                 ${secondary.bigImgPlayer ? `class="mg-headshot" data-player-name="${secondary.bigImgPlayer}" data-team="${secondary.bigImgTeam || ''}" data-pos="${secondary.bigImgPos || ''}"` : ''}
                 onerror="this.src='${secondary.bigImgPlayer ? 'images/fallback-player.svg' : `Wallpapers/GameCenterHorizontal.PNG?v=${FIELD_IMG_VERSION}`}'" alt="">
          </div>
          <div class="caption${secondary.captionWrap ? ' mag-wrap' : ''}">
            <div class="caption_content${secondary.captionClass ? ` ${secondary.captionClass}` : ''}">${secondary.caption}</div>
            <div class="page-number">${secondary.page}</div>
          </div>
        </div>
        <div class="column second">
          <div class="story-title--third">
            <div class="first-part">
              <small>${secondary.smallName}</small> ${secondary.bigWord}
            </div>
            <div class="second-part">
              ${secondary.subTitle}
              <small>${secondary.subText}</small>
            </div>
          </div>
          <div class="story-content--third">
            <img class="${secondary.sideBanner ? 'mg-banner-side' : 'mg-headshot'}" src="${secondary.sideImg}"
                 ${secondary.sideBanner ? '' : `data-player-name="${secondary.imgPlayer || ''}" data-team="${secondary.imgTeam || ''}" data-pos="${secondary.imgPos || ''}"`}
                 onerror="this.src='images/fallback-player.svg'" alt="">
            <div class="paragraph">
              <p class="text--capitalize-first">${secondary.p1}</p>
            </div>
            <div class="paragraph">
              <p>${secondary.p2}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>

  <div class="news-page_section weather">
    <div class="section-divider" title="I numeri della week"></div>
    <div class="columns-wrapper column--weathers">
      ${weather.map(w => `
      <div class="column column--weather">
        <div class="weather_value${w.mod}">${w.value} <span class="weater_value_measurement">${w.unit}</span></div>
        <div class="weather_city">${w.label}</div>
      </div>`).join('')}
    </div>
  </div>

  <div class="news-page_section story--footer">
    <div class="story-title--footer">${foot.title}</div>
    <div class="story_excerpt_and_number">
      <div class="story_page_number">
        <div>week</div>
        <div class="number">${week}</div>
      </div>
      <div class="story_excerpt">
        <div>${foot.line1}</div>
        <div class="text--lowercase">${foot.line2}</div>
      </div>
    </div>
  </div>

  <div class="news-page_section news-topics">
    <div class="columns-wrapper">
      ${topics.map(t => `
      <div class="column column_topic">
        <div class="topic">${t.label}</div>
        <div class="badge_number">${t.n}</div>
      </div>`).join('')}
    </div>
  </div>
</div>
</div>`;
}

// ─── Sezioni derivate ────────────────────────────────────────────

/**
 * Score bug in stile broadcast NFL (SVG inline): barra scura arrotondata,
 * linguette coi colori delle due squadre, punteggi grandi, tag FINALE.
 * Resta un semplice <img>, quindi la struttura del template non cambia.
 */
function scoreBugSVG(matchups) {
    const W = 640, H = 78, GAP = 14;
    const rows = matchups.slice(0, 2).map((m, i) => {
        const y = i * (H + GAP);
        const w1 = P(m.team1.score) >= P(m.team2.score);
        const c1 = teamOf(m.team1.name)?.color || '#B8433A';
        const c2 = teamOf(m.team2.name)?.color || '#4f8cff';
        const side = (raw, score, won, nameX, scoreX, anchor) => {
            const nm = nameOf(raw).toUpperCase();
            // i nomi lunghi (es. CAPI DEI PIANETI) si comprimono per non
            // invadere lo spazio del punteggio
            const tl = nm.length > 12 ? ' textLength="168" lengthAdjust="spacingAndGlyphs"' : '';
            return `
            <text x="${nameX}" y="${y + 48}" text-anchor="${anchor}"${tl} font-size="21" font-weight="bold"
                  font-family="Helvetica, Arial, sans-serif" letter-spacing="1"
                  fill="#fff" opacity="${won ? 1 : 0.55}">${nm}</text>
            <text x="${scoreX}" y="${y + 50}" text-anchor="middle" font-size="30" font-weight="bold"
                  font-family="Helvetica, Arial, sans-serif" fill="${won ? '#ffd24d' : '#fff'}"
                  opacity="${won ? 1 : 0.7}">${fmt(P(score))}</text>`;
        };
        return `
        <rect x="0" y="${y + 6}" width="${W}" height="${H - 12}" rx="10" fill="#101318"/>
        <rect x="0" y="${y + 6}" width="14" height="${H - 12}" rx="6" fill="${c1}"/>
        <rect x="${W - 14}" y="${y + 6}" width="14" height="${H - 12}" rx="6" fill="${c2}"/>
        <rect x="${W / 2 - 34}" y="${y + 6}" width="68" height="18" rx="4" fill="#B8433A"/>
        <text x="${W / 2}" y="${y + 19.5}" text-anchor="middle" font-size="11" font-weight="bold"
              font-family="Helvetica, Arial, sans-serif" letter-spacing="2" fill="#fff">FINALE</text>
        ${side(m.team1.name, m.team1.score, w1, 30, W / 2 - 60, 'start')}
        ${side(m.team2.name, m.team2.score, !w1, W - 30, W / 2 + 60, 'end')}`;
    }).join('');
    const total = matchups.length > 1 ? 2 * H + GAP : H;
    return 'data:image/svg+xml;utf8,' + encodeURIComponent(
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${total}">${rows}</svg>`);
}

/** Statistiche del weekend di una partita, squadra per squadra (testo) */
function weekendStatsPara(m) {
    const line = (team) => {
        const t = teamStatTotals(team);
        return `${nameOf(team.name)}: ${t.passYds} yd lancio, ${t.rushYds} yd corsa, ${t.recYds} yd ricezione, ${t.td} TD${t.to ? `, ${t.to} pall${t.to === 1 ? 'a persa' : 'e perse'}` : ''}`;
    };
    return `${line(m.team1)}. ${line(m.team2)}.`;
}

function secondaryGame(m, recap, week, bundle, seed, h2h, standings, allMatchups) {
    const w = winnerOf(m), l = loserOf(m);
    const dm = diffMakers(m);
    const top = w === m.team1 ? dm.a : dm.b;
    const sW = fmt(Math.max(P(m.team1.score), P(m.team2.score)));
    const sL = fmt(Math.min(P(m.team1.score), P(m.team2.score)));

    // Colonna SINISTRA: titolo unito, foto tonda del protagonista,
    // sottotitolo "X show da N punti" e un trafiletto BREVE (stessa
    // lunghezza che il pezzo aveva quando stava nella colonna di destra):
    // lede asciutto + una sola nota (gossip sul flop, o rivalità, o record).
    const opener = pick(SECONDARY_LEDE_OPENERS, seed + 15);
    const lede = `${opener} ${nameOf(w.name)} ha avuto ragione di ${nameOf(l.name)} per ${sW} a ${sL}. ${marginOf(m) < 5 ? 'Un epilogo al fotofinish, di quelli che lasciano strascichi.' : 'Un verdetto più netto di quanto la vigilia lasciasse immaginare.'}`;

    const flop = flopOf(m, bundle);
    let extra;
    if (flop) {
        const excuse = pick(GOSSIP_EXCUSES, seed + 7 + flop.p.name.length);
        extra = pick(FLOP_WRAP_SECONDARY, seed + 16 + flop.p.name.length)({ name: flop.p.name, pts: fmt(flop.v), avg: fmt1(flop.avg), excuse });
    } else if (h2h && h2h.played > 0) {
        extra = `Il confronto diretto all-time si aggiorna sul ${h2h.allTime.w + 1}-${h2h.allTime.l} per ${nameOf(w.name)}${h2h.streak.holderKey === h2h.wKey && h2h.streak.len >= 2 ? `, la ${h2h.streak.len + 1}ª di fila in questo incrocio` : ''}.`;
    } else {
        const lRec = standings?.find(s => s.key === keyOf(l.name));
        extra = pick(SECONDARY_NO_FLOP_LINES, seed + 17)({ l: nameOf(l.name), rec: lRec ? `${lRec.w}-${lRec.l}` : null });
    }

    const subtitle = top
        ? `${top.name} show da ${fmt(P(top.fantasy_points))} punti: ${statLine(top) || 'prestazione da copertina'} — il migliore in campo della seconda sfida di giornata.`
        : '';
    const story = `${lede} ${extra}`;

    // Colonna DESTRA: score bug broadcast dei due risultati + statistiche
    // del weekend squadra per squadra.
    const games = allMatchups?.length ? allMatchups : [m];

    return {
        // sottotitolo dentro il titolo (span stilizzato): resta un solo <p>
        title: `${recap?.headline || `${nameOf(w.name)} batte ${nameOf(l.name)}`}${subtitle ? `<span class="mag-subtitle">${subtitle}</span>` : ''}`,
        photo: 'images/fallback-player.svg',
        bigImgPlayer: top?.name || '',
        bigImgTeam: top?.nfl_team || '',
        bigImgPos: top?.position_in_team || top?.position || '',
        caption: story,
        captionClass: 'mag-body',
        captionWrap: true,
        page: `week ${week}`,
        smallName: 'IL QUADRO DELLA WEEK',
        bigWord: 'Scores',
        subTitle: 'Numeri alla mano',
        subText: 'risultati e statistiche complete dei titolari, squadra per squadra.',
        sideImg: scoreBugSVG(games),
        sideBanner: true,
        p1: games[0] ? weekendStatsPara(games[0]) : '',
        p2: games[1] ? weekendStatsPara(games[1]) : '',
    };
}

/**
 * Storia secondaria dell'edizione Super Bowl: la notte dei premi.
 * La FOTO GRANDE + citazione sono del Super Bowl MVP (il migliore della
 * finale appena giocata, come nell'NFL vera — concetto diverso dal
 * Topina Honors MVP di stagione, che resta nel titolo/foto piccola).
 */
function secondaryHonors(bundle, champion, main, seed) {
    if (!bundle?.revealed) return null;
    const get = (id) => bundle.awards.find(a => a.id === id)?.winner;
    const mvp = get('mvp'), dpoy = get('dpoy'), opoy = get('opoy');
    const coach = bundle.awards.find(a => a.id === 'coach')?.winner;
    if (!mvp) return null;
    const mvpTeam = TEAMS[mvp.teamKey]?.name;

    // Super Bowl MVP: il migliore della finale (non necessariamente l'Honors MVP di stagione)
    const dm = main ? diffMakers(main) : null;
    const winnerSide = main ? winnerOf(main) : null;
    const sbMvp = dm ? (winnerSide === main.team1 ? dm.a : dm.b) : null;
    const sbMvpQuote = pick(SB_MVP_QUOTES, seed + 20 + (sbMvp?.name.length || 0));
    // il compagno che lo elogia: secondo miglior titolare della squadra campione
    const mate = winnerSide
        ? [...(winnerSide.starters || [])].sort((a, b) => P(b.fantasy_points) - P(a.fantasy_points))[1]
        : null;
    const mateQuote = (sbMvp && mate) ? pick(TEAMMATE_PRAISE, seed + 25)({ name: sbMvp.name }) : '';

    const p1Parts = [];
    if (dpoy) {
        p1Parts.push(`Sul fronte difensivo il premio va a ${dpoy.name}: ${fmt(dpoy.total)} punti che valgono il titolo di Defensive Player of the Year, in una stagione in cui ogni stop pesava come un macigno.`);
        p1Parts.push(pick(DPOY_HONORS_QUOTES, seed + 21));
    }
    if (opoy && opoy.name !== mvp.name) {
        p1Parts.push(`Offensive Player of the Year è invece ${opoy.name} (${fmt(opoy.total)} punti), premiato per la costanza con cui ha spostato gli equilibri domenica dopo domenica.`);
    }

    const p2Parts = [];
    if (coach) {
        p2Parts.push(`Coach of the Year è ${TEAMS[coach.teamKey]?.name}: ${coach.efficiency.toFixed(1)}% di lineup efficiency, il manager che ha sbagliato meno di tutti quando c'era da scegliere chi mandare in campo.`);
        p2Parts.push(pick(COACH_HONORS_QUOTES, seed + 22));
    }
    p2Parts.push('Il resto dei premi — dal miglior QB al re delle waiver — è in bella mostra nella pagina Topina Honors, che vale una visita e più di un rosicamento.');

    return {
        // Colonna sinistra: il Super Bowl MVP — foto nel cerchio,
        // dichiarazioni sue e di un compagno sulla prestazione
        title: sbMvp ? `Super Bowl MVP: ${sbMvp.name}` : 'Super Bowl MVP',
        photo: 'images/fallback-player.svg',
        bigImgPlayer: sbMvp?.name || '',
        bigImgTeam: sbMvp?.nfl_team || '',
        bigImgPos: sbMvp?.position_in_team || sbMvp?.position || '',
        caption: sbMvp
            ? `${sbMvp.name}: «${sbMvpQuote}»${mateQuote ? ` ${mate.name}: «${mateQuote}»` : ''}`
            : '"I PREMI DELLA STAGIONE"',
        captionClass: sbMvp ? 'mag-quotes' : '',
        captionWrap: !!sbMvp,
        page: 'SB MVP',
        // Colonna destra: la sezione Topina Honors (invariata, ma etichettata)
        smallName: 'TOPINA HONORS',
        bigWord: 'MVP',
        subTitle: mvp.name,
        subText: `Re della stagione: ${fmt(mvp.total)} punti in regular season${mvpTeam ? ` con la maglia di ${mvpTeam}` : ''}. Nessuno come lui.`,
        sideImg: 'images/fallback-player.svg',
        imgPlayer: mvp.name,
        imgTeam: mvp.nfl || '',
        imgPos: mvp.pos || '',
        p1: p1Parts.join(' '),
        p2: p2Parts.join(' '),
    };
}

function weatherSlots({ weekData, main, second, isSB }) {
    const slots = [];
    const played = [main, second].filter(Boolean);
    let minScore = Infinity, minName = '';
    played.forEach(m => [m.team1, m.team2].forEach(t => {
        const s = P(t.score);
        if (s < minScore) { minScore = s; minName = displayName(t.name); }
    }));
    played.forEach(m => [m.team1, m.team2].forEach(t => {
        const won = winnerOf(m) === t;
        slots.push({
            value: Math.round(P(t.score)),
            unit: 'pt',
            label: nameOf(t.name),
            mod: won ? ' text_shadow--hot' : (displayName(t.name) === minName ? ' text_shadow--cold' : ''),
        });
    }));
    // top scorer della week
    let top = null;
    (weekData.matchups || []).forEach(m => [m.team1, m.team2].forEach(t =>
        (t?.starters || []).forEach(p => {
            if (!top || P(p.fantasy_points) > P(top.fantasy_points)) top = p;
        })));
    if (top) slots.push({ value: Math.round(P(top.fantasy_points)), unit: 'pt', label: top.name.split(' ').pop(), mod: ' text_shadow--hot' });
    const totalPts = slots.slice(0, 4).reduce((s, x) => s + x.value, 0);
    slots.push({ value: totalPts, unit: 'pt', label: isSB ? 'Finale totale' : 'Totale week', mod: '' });
    return slots.slice(0, 6);
}

function footerStory({ standings, isPlayoff, isSB, main, config, week, league }) {
    if (isSB) {
        const key = keyOf(winnerOf(main).name);
        const titles = league.allTime[key]?.sbWins?.length || 1;
        return { title: `DINASTIA ${nameOf(winnerOf(main).name).toUpperCase()}?`, line1: `TITOLO NUMERO ${titles}`, line2: 'l\'albo d\'oro si aggiorna' };
    }
    if (isPlayoff) return { title: 'CHI ALZERÀ IL TROFEO?', line1: 'IL SUPER BOWL', line2: 'è a una sola partita di distanza' };
    const left = config.regularSeasonWeeks - week;
    if (left <= 3) {
        const bubble = standings[2];
        return { title: 'CORSA PLAYOFF INFUOCATA', line1: 'OGNI PUNTO PESA', line2: bubble ? `${bubble.name.toLowerCase()} in bilico sul filo dei playoff` : 'volata finale in vista' };
    }
    const lead = standings[0];
    return { title: 'OCCHIO ALLA CLASSIFICA', line1: lead ? lead.name.toUpperCase() : 'LA CAPOLISTA', line2: 'detta il passo, le altre inseguono' };
}

function topicsRow({ standings, league }) {
    const topics = standings.map(s => ({ label: s.name.split(' ')[0], n: s.w }));
    while (topics.length < 4) topics.push({ label: '—', n: 0 });
    topics.push(
        { label: 'Honors', n: 10 },
        { label: 'All-Pro', n: 18 },
        { label: 'Draft', n: 60 },
        { label: 'Stagioni', n: league.seasons.length },
    );
    return topics.slice(0, 8);
}
