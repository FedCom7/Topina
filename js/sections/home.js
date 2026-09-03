/**
 * Home — mosaico dinamico di card (stile Apple).
 *
 * La home è una griglia di card in stile "All Teams" che si rivelano allo
 * scroll (IntersectionObserver) con leggeri effetti parallax ([data-depth]).
 * Il CONTENUTO del mosaico dipende dal momento della lega, rilevato dai
 * dati Firebase — non da date hardcoded:
 *
 *   REGULAR_SEASON → sfide in corso, risultati week, classifica, rail top performance
 *   PLAYOFFS       → sfide in corso, semifinali, honors sigillati, rail corsa MVP
 *   SB_WEEK        → sfide in corso, finale, rail premiati, all-pro
 *   OFFSEASON      → campione, premiati, all-pro
 *
 *   PRESEASON      → campione in carica, pagelle del draft, forza rose
 *
 * In FONDO, in tutte le fasi, l'albo d'oro (cardChampions): non sta in
 * nessuna delle liste di MOSAIC, si accoda da solo in initHome.
 *
 * Il countdown al prossimo kickoff non è più una card: è il timbro che
 * compare nell'hero (cardHero) quando la fase è PRESEASON o OFFSEASON.
 *
 * "Sfide in corso" (cardLiveMatchups) è live dall'API della lega, non da
 * Firebase — solo sulla stagione in corso, vedi il commento sulla funzione.
 *
 * Per aggiungere una fase (es. PRE_DRAFT, POST_DRAFT): aggiungere il caso
 * in detectPhase() e una entry nel registro MOSAIC qui sotto. Le card sono
 * funzioni riusabili: ogni fase compone la propria sequenza — l'albo d'oro
 * in coda arriva da sé.
 *
 * Tre card non si limitano a mostrare: si aprono. La classifica espande la
 * squadra scelta, i numeri commutano fra stagione e storia della lega, i rail
 * hanno le frecce. Tutta l'interattività passa da mountInteractions(), un solo
 * listener delegato: le card sono stringhe, non nodi, e non c'è niente a cui
 * agganciare handler uno per uno.
 */

import { displayName, teamNameHTML, teamAbbr, fetchFantasyData, fetchDraftData, flattenDraft, getPlayoffMatchups, getSuperBowlMatchup, CURRENT_SEASON } from '../data.js?v=580';
import { getLeagueData, TEAM_KEY_LIST } from '../data/league-data.js?v=584';
import { getHonorsBundle } from '../data/honors.js?v=631';
import { electHallOfFame } from '../data/hall-of-fame.js?v=631';
import { TEAMS } from './team.js?v=709';
import { paniniCard, hydratePaniniBadges, initPlayerModal } from '../components/player-modal.js?v=713';
import { teamsCardsHTML } from './teams.js?v=684';
import { playerImageService } from '../services/player-image-service.js?v=522';
import { teamSeasonDetail, numberSets, seasonStarted } from '../data/season-story.js?v=42';
import { revealOnScroll, countUpWithin, recountWithin, parallax, spotlight } from '../utils/motion.js?v=1';
import { fieldMarker, fieldClipDefs, hydrateFieldPhotos, hydrateFieldJerseys } from '../ui/field-formation.js?v=3';
import { fetchLeagueWeek, fillMissingProjections } from '../data/espn-fantasy.js?v=9';
import { applyDraftLineups } from '../data/draft-lineups.js?v=48';
import { getWeekSchedule, getNextKickoffDate } from '../data/nfl-schedule.js?v=546';
import { scoreBugHTML } from '../ui/score-bug.js?v=1';
import { getSeasonProjections } from '../data/projections.js?v=595';
import { getHistoryIndex } from '../data/player-history.js?v=595';
import { predictSeason } from '../data/draft-predictions.js?v=694';
import { evaluateLeague } from '../data/team-eval.js?v=593';
import { computeDraftGrade, getDraftGradeCalib, getAdpDispersion } from '../data/draft-grade.js?v=61';
// Il motore di voto (computeGrades/makeEvaluator) vive in draftgrades.js, non
// in un modulo dati: si importa da lì invece di riscriverlo, per non avere
// due pipeline di voto che possono scollarsi. Unico caso nel file in cui una
// sezione ne legge un'altra — vedi loadPostDraftGrades().
import { computeGrades, makeEvaluator, gradeLetterHTML } from './draftgrades.js?v=751';

let initialized = false;

const fmtPts = (n) => n.toLocaleString('it-IT', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export async function initHome() {
    if (initialized) return;
    initialized = true;

    const wrap = document.getElementById('home-showcase');
    if (!wrap) return;

    initPlayerModal(); // click sulla figurina del draft → scheda giocatore

    try {
        const league = await getLeagueData();
        const preview = previewOverride();

        // La stagione da mostrare è l'ultima in cui si è GIOCATO davvero. Non
        // basta che esistano delle partite: prima del via ESPN pubblica la
        // week 1 con rose vuote e 0.00–0.00, e quelle righe facevano credere
        // alla home di essere a stagione iniziata — record 0–0–1, "Week 1",
        // tutti i numeri a zero.
        const season = (preview?.year && league.seasons.find(s => s.year === preview.year))
            || [...league.seasons].reverse().find(seasonStarted)
            || league.seasons[league.seasons.length - 1];
        const bundle = await getHonorsBundle(season.year);
        // Solo quando conta davvero: a stagione chiusa (preseason/offseason) o
        // in preview di una di quelle due fasi. Nel resto dell'anno il
        // countdown non si vede, e interrogare ESPN per niente sarebbe una
        // richiesta di troppo a ogni apertura della home.
        const previewNeedsDays = preview && ['PRESEASON', 'OFFSEASON'].includes(preview.type) && preview.days == null;
        const kickoffDays = (season.complete || previewNeedsDays) ? await daysToKickoff(season.year) : null;
        const phase = detectPhase(season, bundle, preview, kickoffDays);
        const ctx = { league, season, bundle, phase };

        const builder = MOSAIC[phase.type] || MOSAIC.OFFSEASON;
        // L'albo d'oro chiude SEMPRE il mosaico, in qualunque fase. Non sta
        // nelle liste di MOSAIC ma si accoda qui, così una fase nuova se lo
        // ritrova in fondo senza che nessuno debba ricordarsene.
        const cards = (await Promise.all([...builder(ctx), cardChampions(ctx)])).filter(Boolean);

        wrap.innerHTML = `${previewFlag(preview, season)}<div class="mosaic">${cards.join('')}</div>`;
        mountMotion(wrap);
        mountInteractions(wrap, ctx);
        hydrateHeadshots(wrap); // fire-and-forget: il mosaico dipinge subito coi fallback
        hydratePaniniBadges(wrap); // idem per i badge di carriera sulle figurine del draft
        hydrateDraftFigPhotos(wrap); // idem per le loro foto (.pm-headshot, non data-headshot)
        hydrateFieldPhotos(wrap, playerImageService); // idem per i marker SVG del campo All-Pro (<image>, non <img>)
        hydrateFieldJerseys(wrap, playerImageService); // idem per i numeri di maglia, sconosciuti finché non risponde il roster
        // Le scritte delle end zone si ricentrano sulle larghezze vere, e solo
        // a font caricato: misurate su quello di ripiego darebbero altri conti.
        (document.fonts?.ready || Promise.resolve()).then(() => fitEndZones(wrap));
    } catch (e) {
        console.error('Home load error:', e);
        wrap.innerHTML = `<div class="empty-state"><p class="empty-state-text">Could not load league data</p></div>`;
    }
}

// ─── Fase della lega (dai dati, non dal calendario) ──────────────

function detectPhase(season, bundle, preview, kickoffDays) {
    if (preview) {
        return {
            type: preview.type,
            week: preview.week ?? lastPlayedWeek(season),
            days: preview.days ?? Math.max(kickoffDays ?? 1, 1),
        };
    }
    if (season.complete) {
        // A stagione chiusa la storia resta quella appena finita, ma nelle
        // settimane prima del via il countdown diventa la card principale.
        const days = kickoffDays ?? 0;
        return (days > 0 && days <= 45) ? { type: 'PRESEASON', days } : { type: 'OFFSEASON', days };
    }
    if (bundle?.revealed) return { type: 'SB_WEEK' };
    if (bundle?.rsComplete) return { type: 'PLAYOFFS' };
    return { type: 'REGULAR_SEASON', week: lastPlayedWeek(season) };
}

function lastPlayedWeek(season) {
    return Math.max(0, ...Object.values(season.perTeam)
        .flatMap(t => t.games.map(g => g.week)));
}

/**
 * Anteprima delle fasi — `?phase=PLAYOFFS[&week=8][&days=12][&year=2021]`
 *
 * La home cambia faccia cinque volte l'anno e ogni fase si vede solo nella sua
 * settimana: senza questo, PLAYOFFS e SB_WEEK si collaudano una volta a
 * stagione, e non è quando si scrive il codice. `preview.html` (`npm run
 * preview`) le sfoglia tutte insieme a ogni altra schermata del sito.
 *
 * Forza SOLO la scelta della fase: i dati restano quelli VERI della stagione
 * chiesta, quindi quello che si vede è davvero renderizzabile e non un mockup.
 * Con un `phase` sconosciuto non fa niente — un refuso non deve dare una
 * pagina bianca.
 */
function previewOverride() {
    const q = new URLSearchParams(location.search);
    const type = (q.get('phase') || '').toUpperCase();
    if (!MOSAIC[type]) return null;
    const int = (k) => { const v = parseInt(q.get(k), 10); return Number.isFinite(v) ? v : null; };
    return { type, week: int('week'), days: int('days'), year: q.get('year') };
}

/** Bandierina fissa: forzando una fase si vedono dati fuori dal loro momento. */
function previewFlag(preview, season) {
    if (!preview) return '';
    return `
    <div class="mc-preview-flag">
        <span class="mc-preview-tag">Preview</span>
        <span>${preview.type} · season ${esc(season.year)}</span>
        <a href="${location.pathname}" title="Back to the real homepage">Exit</a>
    </div>`;
}

function phaseLabel({ phase, season }) {
    switch (phase.type) {
        case 'REGULAR_SEASON': return `Season ${season.year} · Week ${phase.week}`;
        case 'PLAYOFFS': return `Playoffs ${season.year}`;
        case 'SB_WEEK': return `Super Bowl Week ${season.year}`;
        case 'PRESEASON': return `Season ${+season.year + 1} · Kickoff in ${phase.days} days`;
        default:
            return phase.days > 0
                ? `⏳ Offseason · Kickoff ${+season.year + 1} in ${phase.days} days`
                : '⏳ Offseason';
    }
}

/**
 * Giorni al prossimo kickoff: calendario vero (week 1 su ESPN, via
 * `getNextKickoffDate`) quando è già pubblico, altrimenti la stima "primo
 * giovedì di settembre" — l'unica cosa nota mesi prima che l'NFL pubblichi
 * il calendario.
 */
async function daysToKickoff(latestYear) {
    const real = await getNextKickoffDate(+latestYear + 1).catch(() => null);
    const date = real || estimatedKickoffDate(latestYear);
    return Math.ceil((date - new Date()) / 86400000);
}

/** Stima quando il calendario vero non c'è ancora: primo giovedì di settembre. */
function estimatedKickoffDate(latestYear) {
    const d = new Date(+latestYear + 1, 8, 1);
    d.setDate(1 + ((4 - d.getDay() + 7) % 7));
    return d;
}

// ─── Registro del mosaico: una sequenza di card per fase ─────────

const MOSAIC = {
    // Prima del via non c'è niente da raccontare di questa stagione: si
    // guarda indietro, al campione in carica e all'albo d'oro. Le tre card
    // post-draft (grade, forza rosa, prime due giornate) si aggiungono da
    // sole appena il draft esiste — vedi loadPostDraftGrades — senza toccare
    // il resto: prima del draft il mosaico è esattamente quello di sempre.
    PRESEASON: (ctx) => [
        cardHero(ctx),
        // Anche loro a mezza larghezza appaiate, stesso motivo di classifica
        // e numeri qui sotto: due liste di 4 righe, la stessa forma.
        cardDraftGrade(ctx),
        cardTeamStrength(ctx),
        cardDraftFirstRounds(ctx),
        cardChampion(ctx),
        // Classifica e numeri sono entrambe a mezza larghezza: affiancarle
        // evita che una resti sola in riga con mezzo mosaico vuoto accanto.
        cardStandings(ctx),
        cardNumbers(ctx),
        cardTeams(ctx),
    ],
    OFFSEASON: (ctx) => [
        cardHero(ctx),
        cardChampion(ctx),
        cardHonors(ctx),
        cardHallOfFame(ctx),
        cardTeams(ctx),
        cardAllPro(ctx),
        cardNumbers(ctx),
    ],
    REGULAR_SEASON: (ctx) => [
        cardHero(ctx),
        cardLiveMatchups(ctx),
        cardLastWeek(ctx),
        cardStandings(ctx),
        railTopPerformances(ctx),
        cardTeams(ctx),
        cardMvpRace(ctx),
        cardNumbers(ctx),
    ],
    // A regular season finita la domanda cambia: non più "chi è in testa" ma
    // "come ci siamo arrivati".
    PLAYOFFS: (ctx) => [
        cardHero(ctx),
        cardLiveMatchups(ctx),
        cardPlayoffs(ctx),
        cardHonorsSealed(ctx),
        cardStandings(ctx),
        railMvpRace(ctx),
        cardTeams(ctx),
    ],
    SB_WEEK: (ctx) => [
        cardHero(ctx),
        cardLiveMatchups(ctx),
        cardSuperBowl(ctx),
        railHonors(ctx),
        cardAllProField(ctx),
        cardTeams(ctx),
        cardNumbers(ctx),
    ],
};

// ─── Scaffolding card ────────────────────────────────────────────

/**
 * Card standard del mosaico. span: 'hero' | 'wide' | 'half'
 * watermarkKey: logo team in filigrana dietro il contenuto.
 * bg: immagine di sfondo a piena card (con overlay scuro per leggibilità).
 */
function card({ span = 'half', glow, kicker, title, body, cta, href, cls = '', parallax = false, watermarkKey, bg, sideImg, data }) {
    const wm = watermarkKey && TEAMS[watermarkKey];
    const styles = [
        glow ? `--card-glow:${glow}` : '',
        wm ? `--team-color:${wm.color}` : '',
    ].filter(Boolean).join(';');
    const attrs = data
        ? Object.entries(data).map(([k, v]) => `data-${k}="${esc(v)}"`).join(' ')
        : '';
    return `
    <article class="mosaic-card mc-${span} ${cls}" ${parallax ? 'data-parallax' : ''} ${attrs}
             ${styles ? `style="${styles}"` : ''}>
        ${bg ? `<div class="mc-bg"><img src="${bg}" alt="" aria-hidden="true" onerror="this.parentElement.remove()"></div>` : ''}
        ${wm ? `<img class="mc-watermark" src="${wm.logo}" alt="" aria-hidden="true" onerror="this.remove()">` : ''}
        ${sideImg ? `<img class="mc-side-img" src="${sideImg}" alt="" aria-hidden="true" data-depth="0.1" onerror="this.remove()">` : ''}
        ${kicker ? `<span class="mc-kicker">${kicker}</span>` : ''}
        ${title ? `<h2 class="mc-title">${title}</h2>` : ''}
        <div class="mc-body">${body}</div>
        ${cta ? `<a class="mc-cta" href="${href}">${cta} <span aria-hidden="true">→</span></a>` : ''}
    </article>`;
}

/**
 * Rail a scorrimento orizzontale (stile Apple TV).
 * Le frecce compaiono solo se c'è davvero qualcosa oltre il bordo: le accende
 * e le spegne syncRail(), non un conteggio di card indovinato qui.
 */
function rail({ kicker, title, cards, cta, href }) {
    return `
    <div class="mc-rail">
        <header class="mc-rail-head">
            <div>
                <span class="mc-kicker">${kicker}</span>
                <h2 class="mc-title">${title}</h2>
            </div>
            <div class="mc-rail-tools">
                <button class="mc-rail-nav" type="button" data-rail="-1" aria-label="Scroll left" disabled>
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"></polyline></svg>
                </button>
                <button class="mc-rail-nav" type="button" data-rail="1" aria-label="Scroll right" disabled>
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"></polyline></svg>
                </button>
                ${cta ? `<a class="mc-cta" href="${href}">${cta} <span aria-hidden="true">→</span></a>` : ''}
            </div>
        </header>
        <div class="mc-rail-track">${cards.join('')}</div>
    </div>`;
}

function railCard({ glow, top, media, title, sub, href }) {
    const tag = href ? 'a' : 'div';
    return `
    <${tag} class="mc-rail-card${href ? ' mc-rail-card--link' : ''}" ${href ? `href="${href}"` : ''} ${glow ? `style="--card-glow:${glow}"` : ''}>
        ${top ? `<span class="mc-rail-top">${top}</span>` : ''}
        ${media || ''}
        <span class="mc-rail-title">${title}</span>
        ${sub ? `<span class="mc-rail-sub">${sub}</span>` : ''}
    </${tag}>`;
}

function teamChip(key) {
    const t = TEAMS[key];
    return t ? `<span class="mc-team" style="--team-color:${t.color}">
        <img src="${t.logo}" alt="" onerror="this.style.display='none'">${teamNameHTML(t.name)}</span>` : key;
}

function keyOf(rawName) {
    return TEAM_KEY_LIST.find(k => TEAMS[k].name === displayName(rawName)) || null;
}

const ordinal = (n) => (n % 100 >= 11 && n % 100 <= 13) ? 'th'
    : ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th');

/** Rotta della pagina giocatore: #player/{anno}/{ruolo}/{nome} */
function playerHref(name, pos, year) {
    if (!name || !year || !pos) return null;
    return `#player/${year}/${pos}/${encodeURIComponent(name)}`;
}

/**
 * Avatar tondo del giocatore. Rende subito il fallback SVG; la foto vera
 * arriva dopo, via hydrateHeadshots. ring: '' | 'mc-avatar--gold' | 'mc-avatar--rail'…
 */
function playerAvatar(name, nfl, pos, year, ring = '') {
    return `<span class="mc-avatar ${ring}">
        <img src="images/fallback-player.svg" alt="" loading="lazy"
             data-headshot data-player-name="${name}" data-team="${nfl || ''}"
             data-pos="${pos || ''}" data-year="${year || ''}"></span>`;
}

/** Sostituisce i fallback con gli headshot ESPN, senza mai bloccare il render. */
function hydrateHeadshots(wrap) {
    wrap.querySelectorAll('img[data-headshot]').forEach(img => {
        img.onerror = () => {
            if (!img.src.endsWith('fallback-player.svg')) img.src = 'images/fallback-player.svg';
        };
        playerImageService.getPlayerImageUrl(img.dataset.playerName, img.dataset.team, img.dataset.pos, img.dataset.year)
            .then(url => { if (url) img.src = url; })
            .catch(() => { /* resta il fallback */ });
    });
}

// ─── Card comuni ─────────────────────────────────────────────────

function cardHero(ctx) {
    return `
    <article class="mosaic-card mc-hero" data-parallax>
        <div class="mc-hero-grid"></div>
        ${heroStamp(ctx)}
        <div class="mc-hero-content" data-depth="0.06">
            <span class="mc-pill">${phaseLabel(ctx)}</span>
            <h1 class="mc-wordmark">
                <span class="mc-word mc-word--outline">Topina</span>
                <span class="mc-word mc-word--fill">League</span>
            </h1>
            <p class="mc-tagline">Four franchises. One crown. Since 2019.</p>
        </div>
    </article>`;
}

/**
 * Il conto alla rovescia al prossimo kickoff: prima era una card intera in
 * fondo al mosaico ("Next chapter"), ora è il timbro nell'angolo dell'hero —
 * si vede appena si entra nel sito, senza rubare spazio a tutto il resto.
 * Ha una sua animazione (mc-hero-stamp-in in main.css), indipendente dal
 * reveal della card che lo ospita. Solo nelle fasi in cui guardare avanti ha
 * senso: PRESEASON e OFFSEASON, le stesse in cui viveva la vecchia card.
 */
function heroStamp({ season, phase }) {
    if (!['PRESEASON', 'OFFSEASON'].includes(phase.type)) return '';
    const days = phase.days;
    if (!days || days <= 0) return '';
    return `
    <a class="mc-hero-stamp" href="#draft" title="Look back at past drafts">
        <span class="mc-hero-stamp-days" data-count="${days}" data-decimals="0">0</span>
        <span class="mc-hero-stamp-label">days to<br>Season ${+season.year + 1}</span>
    </a>`;
}

function cardTeams({ league }) {
    // Card identiche alla pagina All Teams (stessa funzione di render)
    return `
    <div class="mc-rail mc-teams-block">
        <header class="mc-rail-head">
            <div>
                <span class="mc-kicker">The franchises</span>
                <h2 class="mc-title">Four contenders</h2>
            </div>
            <a class="mc-cta" href="#teams">All franchises <span aria-hidden="true">→</span></a>
        </header>
        <div class="teams-index">${teamsCardsHTML(league)}</div>
    </div>`;
}

/** Le quattro caselle di numeri, in forma contabile (partono da 0 e salgono). */
function numTiles(tiles) {
    return tiles.map(t => {
        const dec = t.decimals || 0;
        const zero = (0).toLocaleString('it-IT', { minimumFractionDigits: dec, maximumFractionDigits: dec });
        const wm = t.teamKey && TEAMS[t.teamKey];
        return `
        <div class="mc-num"${wm ? ` style="--team-color:${wm.color}"` : ''}>
            <span class="mc-num-value" data-count="${t.value}" data-decimals="${dec}">${zero}</span>
            ${t.note ? `<small class="mc-num-note">${t.note}</small>` : ''}
            <span class="mc-num-label">${wm ? `${wm.name} · ` : ''}${t.label}</span>
        </div>`;
    }).join('');
}

/**
 * Card interattiva: due letture degli stessi numeri, questa stagione e tutta
 * la storia della lega. Il contenuto di entrambe sta nel `data-` della card e
 * il cambio è un ridisegno locale con nuovo conteggio — nessuna richiesta.
 */
function cardNumbers(ctx) {
    const sets = numberSets(ctx);
    const has = { season: !!sets.season, allTime: !!sets.allTime };
    if (!has.season && !has.allTime) return '';

    // A stagione in corso si apre sulla stagione; a stagione chiusa la lettura
    // interessante è quella storica.
    const live = ['REGULAR_SEASON', 'PLAYOFFS', 'SB_WEEK'].includes(ctx.phase.type);
    const start = (live && has.season) ? 'season' : (has.allTime ? 'allTime' : 'season');

    const seg = (has.season && has.allTime) ? `
        <div class="mc-seg" role="tablist" aria-label="Time range">
            <button class="mc-seg-btn${start === 'season' ? ' is-active' : ''}" type="button" role="tab"
                    aria-selected="${start === 'season'}" data-nums="season">Season ${ctx.season.year}</button>
            <button class="mc-seg-btn${start === 'allTime' ? ' is-active' : ''}" type="button" role="tab"
                    aria-selected="${start === 'allTime'}" data-nums="allTime">All-time</button>
        </div>` : '';

    return card({
        cls: 'mc-nums-card',
        kicker: 'Since 2019',
        title: 'The league by the numbers',
        body: `${seg}<div class="mc-nums" data-nums-slot>${numTiles(sets[start])}</div>`,
        cta: 'Records & stats', href: '#stats',
        data: { numsets: JSON.stringify(sets) },
    });
}

// ─── Post-draft: il draft appena fatto, prima che la stagione inizi ──

/**
 * Il draft della stagione in corso valutato con lo STESSO motore di Draft
 * Grades — non lo si riscrive qui, si importano le sue funzioni
 * (computeGrades/makeEvaluator da draftgrades.js, computeDraftGrade da
 * draft-grade.js, evaluateLeague per il TSI da team-eval.js, predictSeason —
 * il Monte Carlo — da draft-predictions.js). Tre card la leggono
 * (cardDraftGrade, cardDraftFirstRounds, cardTeamStrength): calcolata una
 * volta sola e tenuta in cache di modulo, non tre.
 *
 * null quando il draft della stagione in corso non c'è ancora (le tre card
 * spariscono, PRESEASON resta quella di prima — niente placeholder) o quando
 * manca un pezzo qualunque dei dati (proiezioni, ADP, soglie di calibrazione).
 */
let _postDraftCache = null;
async function loadPostDraftGrades() {
    if (_postDraftCache) return _postDraftCache;
    _postDraftCache = (async () => {
        try {
            const year = CURRENT_SEASON;
            const draftData = await fetchDraftData(year);
            const picks = flattenDraft(draftData);
            if (picks.length < 4) return null; // draft non fatto, o appena iniziato

            const [proj, histIndex, adpDisp, calib] = await Promise.all([
                getSeasonProjections(year),
                getHistoryIndex(year).catch(() => null),
                getAdpDispersion(year).catch(() => null),
                getDraftGradeCalib().catch(() => null),
            ]);
            const evaluator = makeEvaluator(proj, histIndex, year);
            const meta = {
                mode: 'proj', proj, seasonPlayed: false, actualPlayers: {},
                detailOf: evaluator.detailOf,
            };
            const grades = computeGrades(picks, evaluator.valueOf, meta);
            const dg = computeDraftGrade(grades, proj, { adpDisp, calib });
            if (!dg) return null;
            // Nessuna dipendenza fra le due: predictSeason legge value/pos/nfl
            // dalle pick, evaluateLeague attacca g.tsi allo stesso array
            // ma non lo legge nessuno dei due — via libera in parallelo.
            const [pred] = await Promise.all([
                predictSeason(year, grades).catch(() => null),
                evaluateLeague(grades, year).catch(() => null),
            ]);
            return { year, picks, grades, dg, pred };
        } catch (e) {
            console.warn('[home] pagelle del draft non disponibili:', e.message);
            return null;
        }
    })();
    return _postDraftCache;
}

/** Il voto e le probabilità di Super Bowl, appena il draft è fatto.
 * gradeLetterHTML (colonna voti allineata sulla lettera, non sulla stringa
 * intera) vive in draftgrades.js: la usa anche la lista di riepilogo di
 * quella pagina, stessa tecnica di allineamento. */

async function cardDraftGrade() {
    const data = await loadPostDraftGrades();
    if (!data) return '';
    const { year, dg, pred } = data;
    const rows = dg.ranking.map(key => {
        const t = dg.byKey[key];
        const team = TEAMS[key];
        const sb = pred?.byTeam?.[key]?.sbPct;
        return `
        <a class="mc-row mc-row--tinted mc-row--link" href="#draftgrades/${year}/${key}"
           style="--team-color:${team?.color || 'var(--accent-red)'}">
            <span class="mc-rank">${t.rank}</span>
            ${teamChip(key)}
            <span class="dg-row-stats">
                ${sb != null ? `<span class="mc-row-value">${sb}% SB</span>` : ''}
                ${gradeLetterHTML(t.letter)}
            </span>
        </a>`;
    }).join('');
    return card({
        kicker: `Draft Grade ${year}`,
        title: 'How the draft went',
        body: `<div class="mc-rows">${rows}</div>`,
        cta: 'Full draft grades', href: '#draftgrades',
    });
}

/** Il Team Strength Index — la ROSA, non il voto della pick per pick. */
async function cardTeamStrength() {
    const data = await loadPostDraftGrades();
    if (!data) return '';
    const { year, grades } = data;
    const ranked = [...grades].filter(g => g.tsi != null).sort((a, b) => b.tsi - a.tsi);
    if (ranked.length < 2) return '';
    const rows = ranked.map((g, i) => {
        const team = TEAMS[g.key];
        return `
        <a class="mc-row mc-row--tinted mc-row--link" href="#draftgrades/${year}/${g.key}"
           style="--team-color:${team?.color || 'var(--accent-red)'}">
            <span class="mc-rank">${i + 1}</span>
            ${teamChip(g.key)}
            <span class="mc-row-value">${g.tsi.toFixed(1)}</span>
        </a>`;
    }).join('');
    return card({
        kicker: `Team Strength Index · ${year}`,
        title: "Who's stacked",
        body: `<div class="mc-rows">${rows}</div>`,
        cta: 'Team-by-team breakdown', href: '#draftgrades',
    });
}

/**
 * La stessa figurina Panini di Draft Recap (js/sections/draft.js, classi
 * .draft-fig condivise) — non più un quadrato foto-e-basta: qui si vuole
 * mostrare la card giocatore vera, la stessa che si trova cliccando "Full
 * draft recap", non un'anteprima diversa. `data-player-modal` apre la
 * scheda completa al click, come nella pagina draft.
 *
 * `mc-draft-deck` aggiunge in CSS due bordi sfalsati dietro la figurina, per
 * dare l'idea di un mazzo di altre pick senza mostrarne davvero (niente dati
 * del secondo giro): solo qui, non sulla pagina Draft Recap che riusa lo
 * stesso `.draft-fig-card` per ogni pick vera e non deve avere lo stesso
 * effetto — da qui la classe in più invece di metterlo su `.draft-fig-card`.
 */
function draftFigHTML(p, year) {
    const key = keyOf(p.team);
    const team = key && TEAMS[key];
    return `
    <div class="draft-fig mc-draft-deck" data-player-modal
         data-player-name="${p.player}" data-pos="${p.pos}" data-nfl="${p.nfl || ''}" data-year="${year}"
         style="--team-color:${team?.color || 'var(--accent-red)'}">
        <div class="draft-fig-card">
            <span class="draft-fig-pick">#${p.pick}</span>
            ${paniniCard({ name: p.player, pos: p.pos, nfl: p.nfl, compact: true })}
        </div>
        <div class="draft-fig-cap">
            <span class="draft-fig-label">Drafted by</span>
            <span class="draft-fig-team">
                ${team ? `<img src="${team.logo}" alt="" onerror="this.style.display='none'">` : ''}
                ${team?.name || displayName(p.team)}
            </span>
        </div>
    </div>`;
}

/**
 * Le foto dentro le figurine (`.pm-headshot`, quelle di paniniCard) non
 * hanno l'attributo `data-headshot` che usa hydrateHeadshots — quella serve
 * solo gli avatar tondi. Qui si fa come updateDraftImages in
 * js/sections/draft.js: l'anno viene dal `.draft-fig` che le contiene.
 */
function hydrateDraftFigPhotos(wrap) {
    wrap.querySelectorAll('.draft-fig .pm-headshot').forEach(img => {
        img.onerror = () => {
            if (!img.src.endsWith('fallback-player.svg')) img.src = 'images/fallback-player.svg';
        };
        const { playerName, team, pos } = img.dataset;
        const year = img.closest('.draft-fig')?.dataset.year;
        if (!playerName) return;
        playerImageService.getPlayerImageUrl(playerName, team, pos, year)
            .then(url => { if (url) img.src = url; })
            .catch(() => { /* resta il fallback */ });
    });
}

/** Il primo giro, per chi vuole solo vedere che il draft è andato — con un
 *  mazzo (finto, via CSS) dietro ogni figurina invece del secondo giro vero. */
async function cardDraftFirstRounds() {
    const data = await loadPostDraftGrades();
    if (!data) return '';
    const { year, picks } = data;
    const firstRound = picks.filter(p => p.round === 1);
    if (!firstRound.length) return '';
    const body = `<div class="draft-grid">${firstRound.map(p => draftFigHTML(p, year)).join('')}</div>`;
    return card({
        span: 'wide',
        kicker: `Draft ${year}`,
        title: 'The first round',
        body,
        cta: 'Full draft recap', href: '#draft',
    });
}

// ─── Card di fase ────────────────────────────────────────────────

function cardChampion({ season, league }) {
    const key = season.sbWinnerKey;
    if (!key) return '';
    const t = TEAMS[key];
    const titles = league.allTime[key]?.sbWins.length || 1;
    // Il logo sta nello SFONDO, come nelle card Four contenders: filigrana
    // grande che sborda a destra, non un'immagine affiancata al testo.
    return card({
        span: 'wide', cls: 'mc-champion-card', glow: t.color, watermarkKey: key,
        kicker: `Super Bowl Champ · Season ${season.year}`,
        body: `
        <div class="mc-champion" style="--team-color:${t.color}">
            <span class="mc-champion-titles">${titles}${ordinal(titles)} franchise title</span>
            <span class="mc-champion-name">${esc(t.name)}</span>
        </div>`,
    });
}

function cardHonors({ bundle, season }) {
    if (!bundle?.revealed) return '';
    const wanted = { mvp: 'MVP', dpoy: 'DPOY', oroy: 'OROY', coach: 'COACH' };
    const rows = bundle.awards
        .filter(a => wanted[a.id] && a.winner)
        .map(a => {
            const isCoach = a.kind === 'coach';
            const team = TEAMS[a.winner.teamKey];
            const media = isCoach
                ? (team ? `<span class="mc-avatar mc-avatar--logo"><img src="${team.logo}" alt="" onerror="this.parentElement.remove()"></span>` : '')
                : playerAvatar(a.winner.name, a.winner.nfl, a.winner.pos, season.year);
            const name = isCoach ? (team?.name || '—') : a.winner.name;
            return `
        <div class="mc-row mc-row--tinted" style="--team-color:${team?.color || 'var(--accent-red)'}">
            <span class="mc-honor-tag">${wanted[a.id]}</span>
            ${media}
            <span class="mc-row-name">${name}</span>
        </div>`;
        }).join('');
    return card({
        kicker: `Topina Honors ${season.year}`,
        title: "This season's award winners",
        body: `<div class="mc-rows">${rows}</div>`,
        cta: 'All the awards', href: '#honors',
    });
}

async function cardHallOfFame({ season }) {
    const classes = await electHallOfFame();
    const latest = [...classes].reverse().find(c => c.inductee);
    if (!latest) return '';
    const p = latest.inductee;
    const teamKey = p.draftedBy?.length ? p.draftedBy[p.draftedBy.length - 1].teamKey : null;
    const team = teamKey ? TEAMS[teamKey] : null;
    return card({
        glow: team?.color,
        kicker: `Hall of Fame · Class of ${latest.year}`,
        title: 'The latest inductee',
        body: `
        <div class="mc-hof-feature" style="--team-color:${team?.color || 'var(--accent-amber)'}">
            ${playerAvatar(p.name, p.nflTeam, p.position, p.lastSeason, 'mc-avatar--gold mc-avatar--hof')}
            <span class="mc-hof-name">${p.name}</span>
            <span class="mc-hof-role">${p.position}</span>
        </div>`,
        cta: 'The Hall of Fame', href: '#halloffame',
    });
}

function cardHonorsSealed({ season }) {
    return card({
        glow: 'var(--accent-amber)',
        kicker: `Topina Honors ${season.year}`,
        title: 'The envelopes are sealed',
        body: `<p class="mc-text">Regular season in the books: the winners are set and will be revealed on Super Bowl eve.</p>`,
        cta: 'See the finalists', href: '#honors',
    });
}

function cardAllPro({ bundle, season }) {
    if (!bundle?.allPro) return '';
    const rows = bundle.allPro.first
        .filter(s => ['QB', 'RB', 'WR'].includes(s.slot) && s.player)
        .slice(0, 3)
        .map(({ slot, player }) => {
            const href = playerHref(player.name, player.pos, season.year);
            const inner = `
            <span class="allpro-pos pos-${slot.toLowerCase()}">${slot}</span>
            ${playerAvatar(player.name, player.nfl, player.pos, season.year)}
            <span class="mc-row-name">${esc(player.name)}</span>
            <span class="mc-row-value">${fmtPts(player.total)} pt</span>`;
            const style = `--team-color:${TEAMS[player.teamKey]?.color || 'var(--accent-red)'}`;
            return href
                ? `<a class="mc-row mc-row--tinted mc-row--link" href="${href}" style="${style}">${inner}</a>`
                : `<div class="mc-row mc-row--tinted" style="${style}">${inner}</div>`;
        }).join('');
    return card({
        kicker: `All-Pro Team ${season.year}`,
        title: 'The ideal lineup',
        body: `<div class="mc-rows">${rows}</div>`,
        cta: 'First and Second Team', href: '#allpro',
    });
}

// Geometria del campo orizzontale: stesse unità (yard) e stessa larghezza
// campo (53.3 yd) del campo formazione della pagina squadra NFL, solo
// sdraiato — le yard corrono lungo l'asse X invece che lungo Y. `spanX`
// sono due metà campo da 24 yard "di formazione" (lo stesso spanY di TDF
// in nfl-team-home.js) appaiate, che si incontrano al centro sulla linea
// delle 50. `losY` è la profondità della linea di scrimmage nella stessa
// scala (13.3, come `TDF.losY`) — il punto in cui, in ciascuna metà campo,
// finisce il proprio schieramento e comincia il campo dell'altro team.
// `ez` è la profondità delle due end zone, ricavata dallo spazio che c'era
// già: i giocatori più arretrati (K e DEF) stanno a ~6.7 unità dal proprio
// bordo, quindi le prime 6 sono da sempre prato vuoto. Diventano end zone
// senza spostare nessuno e senza allargare il disegno — che, allargato,
// avrebbe rimpicciolito nomi e ruoli di un quinto.
const AP_FD = { W: 53.3, spanX: 48, vbW: 1000, vbH: 560, losY: 13.3, ez: 6 };
const apX = (fx) => (fx / AP_FD.spanX) * AP_FD.vbW;
const apY = (fy) => (fy / AP_FD.W) * AP_FD.vbH;

/**
 * Pro Set (split backs), personnel 21 — la formazione più semplice con due
 * running back: linea a 5 (LT-LG-C-RG-RT), TE agganciato, due WR larghi, QB
 * sotto centro e i due RB divisi ai lati dietro di lui. Stesse coordinate
 * (fx = larghezza campo, fy = profondità, `losY` = linea di scrimmage) di
 * `OFFENSE_SLOTS` in nfl-team-home.js: FISICAMENTE la stessa formazione,
 * solo letta in orizzontale invece che in verticale. fy cresce allontanandosi
 * dalla linea (14.8 = sulla linea, 17.8 = il QB appena dietro, 19.8 = i due
 * RB, più indietro di lui — QB davanti ai RB, come nel Pro Set vero).
 *
 * In lega non esistono 5 offensive lineman: lo slot FLEX (RB o WR secondo
 * FLEX_ELIGIBLE, league-rules.js) prende il posto del tackle sinistro, il
 * 5° lineman — è questione di schieramento, non di ruolo: sotto al disco
 * resta scritto "FLEX", non "LT". Gli altri 4 posti della linea non hanno
 * un giocatore reale dietro: restano dischi vuoti, la sagoma di una linea
 * offensiva al completo senza inventare quattro giocatori che non esistono.
 */
// Larghezze (fx, yard dalla laterale) risolte per stare tutte sulla riga
// della linea senza toccarsi — vedi il commento sopra: sulla riga a `fy:
// 14.8` finiscono in fila WR-LT-LG-C-RG-RT-TE-WR, un giocatore vero (FLEX,
// foto+nome+ruolo) al posto di LT e quattro dischi vuoti (19 unità di
// raggio, un ingombro molto minore) negli altri quattro posti della linea.
// Non sono gli stessi numeri di OFFENSE_SLOTS: quel campo è alto 660 unità
// per un solo team, questo è alto 560 per DUE, in metà spazio — spaziatura
// ricalcolata per il minimo che non fa toccare due dischi vicini, con lo
// slack in eccesso redistribuito in parti uguali fra i sette varchi.
//
// Anche la profondità di QB e RB (`fy`) è il massimo avvicinamento alla
// linea che non fa toccare niente, cercato allo stesso modo. A fermare i RB
// non è la linea ma il QB: il suo cognome scende sotto il disco e arriva
// nella fila del RB destro. Si guadagnerebbero altre 9 yard allargando i due
// RB di ~40px, ma li vogliamo stretti.
const AP_OL_FX = { LT: 13.7, LG: 20.9, C: 25.4, RG: 29.8, RT: 34.3 };
const AP_WR_FX = { L: 5.8, R: 47.5 }; // non più i 5/48.6 "veri" di OFFENSE_SLOTS: qui a ridosso del bordo il nome del giocatore avrebbe sforato la card
const AP_PRO_SET = {
    // Ordine di ALLPRO_SLOTS in honors.js: QB, RB, RB, WR, WR, TE, FLEX, K, DEF.
    slots: [
        { fx: AP_OL_FX.C, fy: 16.2 },   // QB, sotto centro
        { fx: 17, fy: 18.1 },           // RB sinistro, split — vicino al lato dove ora gioca il FLEX
        { fx: 30, fy: 18.1 },           // RB destro, split — riavvicinato al centro (prima era simmetrico sul vecchio centro, più largo)
        { fx: AP_WR_FX.L, fy: 14.2 },   // WR largo
        { fx: AP_WR_FX.R, fy: 14.2 },   // WR largo
        { fx: 39.6, fy: 14.8 },         // TE agganciato
        { fx: AP_OL_FX.LT, fy: 14.8 },  // FLEX = tackle sinistro
        { fx: AP_WR_FX.R, fy: 21 },     // K, dietro e ai bordi — fuori dallo schieramento vero, ma davanti alla goal line
        { fx: AP_WR_FX.L, fy: 21 },     // DEF, idem sul lato opposto
    ],
    // I 4 posti della linea che restano senza giocatore (il quinto, LT, ce
    // l'ha: è il FLEX): la sagoma di una linea offensiva al completo, non
    // solo il tackle occupato.
    emptyOL: [AP_OL_FX.C, AP_OL_FX.LG, AP_OL_FX.RG, AP_OL_FX.RT].map(fx => ({ fx, fy: 14.8 })),
};
// (24 − fy) / (24 − losY): converte la profondità "vera" fy di OFFENSE_SLOTS
// nella frazione 0..1 di UNA metà campo usata da apX — 1 = sulla linea/al
// centro dei due campi, 0 = il proprio fondo.
const apDepthFrac = (fy) => (AP_FD.spanX / 2 - fy) / (AP_FD.spanX / 2 - AP_FD.losY);

/** Un marker di formazione (giocatore o disco vuoto della linea), sul lato `side` (1 sinistra, 2 destra specchiata). */
function apMarker({ fx, fy, label, player, side, abbr, year, clipId }) {
    const half = AP_FD.spanX / 2;
    const depth = apDepthFrac(fy) * half;
    const absFx = side === 1 ? depth : AP_FD.spanX - depth;
    return fieldMarker({
        x: apX(absFx), y: apY(fx), label, player, side: side === 1 ? 'first' : 'second',
        abbr, year, clipId,
    });
}

// Larghezza stimata di una scritta in em, per il font display in maiuscolo.
// In un SVG generato a stringa il testo non si può misurare: serve una stima
// per dimensionare e centrare il blocco logo+nome. Lo spazio è molto più
// stretto di una lettera, e va contato a parte o "CAPI DEI PIANETI" (due
// spazi) risulta più largo del vero e la scritta esce piccola.
const AP_EZ_TRACK = 0.06;   // letter-spacing, in em (vedi .mc-duel-ez-name)
const apTextEm = (s) => [...s].reduce((w, c) => w + (c === ' ' ? 0.3 : 0.66) + AP_EZ_TRACK, 0);

/**
 * Le misure dell'incastro logo+nome dentro l'end zone, tutte derivate dalla
 * profondità della fascia. Il logo NON dipende dalla lunghezza del nome: è
 * sempre grande uguale per tutte e quattro le squadre, perché un nome lungo
 * non è una buona ragione per avere un logo piccolo. A restringersi è solo
 * la scritta.
 */
const apEzBox = () => {
    const depth = apX(AP_FD.ez);
    return {
        depth,
        logo: depth * 0.82,          // il logo, sempre questo
        gap: depth * 0.82 * 0.24,    // lo stacco fra logo e scritta
        along: AP_FD.vbH * 0.89,     // lunghezza utile: il resto è margine dal bordo campo
        maxFs: depth * 0.66,         // oltre, la scritta sborda attraverso la fascia
    };
};

/**
 * Le due end zone, una per lato: fascia tinta del colore della squadra, goal
 * line a chiuderla e dentro logo e nome della squadra. Il contenuto corre
 * LUNGO la fascia (ruotato di 90°), come la scritta dipinta di una end zone
 * vera vista dall'alto — non in orizzontale, che sarebbe un'etichetta
 * appoggiata sopra al campo invece che dipinta dentro.
 *
 * Il corpo della scritta si adatta al nome, ma NON si calcola qui: quello
 * che esce da questa funzione è solo un primo posizionamento, rifatto sulle
 * misure vere da `fitEndZones()` appena il DOM esiste. Vedi lì il perché.
 *
 * Solo il campo del Super Bowl le disegna — l'All-Pro non ha due squadre a
 * cui intestarle.
 */
function apEndZones(left, right) {
    const zone = (team, side) => {
        if (!team?.color && !team?.logo) return '';
        const x0 = side === 1 ? 0 : apX(AP_FD.spanX - AP_FD.ez);
        const w = apX(AP_FD.ez);
        const goalX = side === 1 ? w : x0;
        const cx = x0 + w / 2, cy = AP_FD.vbH / 2;
        // Ruotate verso l'esterno da lati opposti, così le due scritte si
        // leggono entrambe girando la testa dallo stesso verso.
        const rot = side === 1 ? -90 : 90;
        const name = (team.name || '').toUpperCase();
        const { logo: LOGO, gap: GAP, along, maxFs } = apEzBox();
        const FS = Math.min(maxFs, (along - LOGO - GAP) / apTextEm(name));
        const x = -(LOGO + GAP + apTextEm(name) * FS) / 2;
        return `
        <g class="mc-duel-ez" style="--team-color:${team.color || 'var(--accent-red)'}">
            <rect x="${x0.toFixed(1)}" y="0" width="${w.toFixed(1)}" height="${AP_FD.vbH}" class="mc-duel-ez-fill"/>
            <line x1="${goalX.toFixed(1)}" y1="0" x2="${goalX.toFixed(1)}" y2="${AP_FD.vbH}" class="mc-duel-ez-goal"/>
            <g class="mc-duel-ez-mark" transform="translate(${cx.toFixed(1)},${cy.toFixed(1)}) rotate(${rot})">
                ${team.logo ? `<image href="${team.logo}" x="${x.toFixed(1)}" y="${(-LOGO / 2).toFixed(1)}"
                    width="${LOGO.toFixed(1)}" height="${LOGO.toFixed(1)}" class="mc-duel-ez-logo" preserveAspectRatio="xMidYMid meet"/>` : ''}
                <text x="${(x + LOGO + GAP).toFixed(1)}" y="0" dominant-baseline="central"
                      class="mc-duel-ez-name" style="font-size:${FS.toFixed(1)}px">${esc(name)}</text>
            </g>
        </g>`;
    };
    return zone(left, 1) + zone(right, 2);
}

/**
 * Rimisura e ricentra logo+nome nelle end zone, sulle larghezze VERE.
 *
 * Serve perché in un SVG costruito come stringa il testo non si può
 * misurare: `apEndZones` deve indovinare quanto sarà largo un nome, e la
 * stima sbaglia in modo diverso da nome a nome. Misurato: la stima azzeccava
 * "LASERS" e sbagliava tutti gli altri, con il risultato che il blocco
 * usciva scentrato — "SOMMO" a 12px dal bordo campo da un lato e 75
 * dall'altro, e "OSCURUS" addirittura fuori di un pixel dal campo. Non era
 * un problema di gusto: era la stima.
 *
 * Qui il testo esiste davvero, quindi `getBBox()` dice la sua larghezza
 * esatta: si ricava il corpo che riempie la fascia e si ricentra il blocco.
 * Va chiamata dopo `document.fonts.ready`, o si misurerebbe il font di
 * ripiego e i conti cambierebbero appena arriva quello vero.
 *
 * Se la misura non è disponibile (elemento non ancora a layout) non fa
 * nulla: resta il posizionamento stimato, che è approssimativo ma valido.
 */
function fitEndZones(root) {
    const { logo: LOGO, gap: GAP, along, maxFs } = apEzBox();
    root.querySelectorAll('.mc-duel-ez-mark').forEach((mark) => {
        const img = mark.querySelector('.mc-duel-ez-logo');
        const txt = mark.querySelector('.mc-duel-ez-name');
        if (!txt) return;
        // Larghezza per unità di corpo: si misura a un corpo noto e si scala.
        const PROBE = 100;
        txt.style.fontSize = `${PROBE}px`;
        const perEm = txt.getBBox().width / PROBE;
        if (!perEm) return;                                  // non a layout: si tiene la stima
        const fs = Math.min(maxFs, (along - LOGO - GAP) / perEm);
        txt.style.fontSize = `${fs.toFixed(1)}px`;

        const x = -(LOGO + GAP + perEm * fs) / 2;
        if (img) {
            img.setAttribute('x', x.toFixed(1));
            img.setAttribute('y', (-LOGO / 2).toFixed(1));
            img.setAttribute('width', LOGO.toFixed(1));
            img.setAttribute('height', LOGO.toFixed(1));
        }
        txt.setAttribute('x', (x + LOGO + GAP).toFixed(1));
    });
}

// Il campo di gioco vero: 100 yard fra le due goal line, distese fra la fine
// di una end zone e l'inizio dell'altra. Da qui in giù si ragiona in YARD
// (0 = goal line di sinistra, 100 = quella di destra), non nelle unità di
// schieramento usate dai giocatori.
const apYd = (y) => apX(AP_FD.ez + y * (AP_FD.spanX - 2 * AP_FD.ez) / 100);

/**
 * La segnaletica di un campo da football vero: erba a bande da 5 yard, le
 * yard line ogni 5 (grosse ogni 10), gli hash mark ogni singola yard su due
 * file interne e le tacche a bordo campo.
 *
 * Le due file di hash stanno a 70'9" da ciascuna linea laterale — cioè a
 * 23.58 e 29.72 yard su un campo largo 53.3, le stesse misure NFL usate dal
 * campo verticale della pagina squadra.
 */
function apFieldMarkings() {
    let s = '';
    for (let y = 0; y < 100; y += 10) {                    // bande di prato, una ogni 5 yd alternata
        s += `<rect x="${apYd(y + 5).toFixed(1)}" y="0" width="${(apYd(y + 10) - apYd(y + 5)).toFixed(1)}" height="${AP_FD.vbH}" class="nfl-fd2-band"/>`;
    }
    for (let y = 0; y <= 100; y += 5) {
        const x = apYd(y).toFixed(1);
        s += `<line x1="${x}" y1="0" x2="${x}" y2="${AP_FD.vbH}" class="nfl-fd2-yl"${y % 10 ? ' opacity="0.6"' : ''}/>`;
    }
    const tick = 9;
    for (let y = 1; y < 100; y++) {
        if (y % 5 === 0) continue;                          // dove c'è già la yard line intera
        const x = apYd(y).toFixed(1);
        for (const fy of [23.58, 29.72]) {                  // le due file interne
            const yy = apY(fy);
            s += `<line x1="${x}" y1="${(yy - tick / 2).toFixed(1)}" x2="${x}" y2="${(yy + tick / 2).toFixed(1)}" class="nfl-fd2-hash"/>`;
        }
        s += `<line x1="${x}" y1="0" x2="${x}" y2="${tick}" class="nfl-fd2-hash"/>`;
        s += `<line x1="${x}" y1="${AP_FD.vbH - tick}" x2="${x}" y2="${AP_FD.vbH}" class="nfl-fd2-hash"/>`;
    }
    return s;
}

/**
 * I numeri dipinti sul campo: 10-20-30-40-50-40-30-20-10, ogni dieci yard,
 * su due file a 9 yard da ciascuna linea laterale (la misura del
 * regolamento, presa al bordo del numero).
 *
 * Due dettagli che li fanno sembrare veri invece che etichette:
 *
 * 1. Le due cifre stanno A CAVALLO della yard line, che passa in mezzo —
 *    non accanto ad essa.
 * 2. Ogni numero si legge dalla PROPRIA linea laterale, quindi la fila in
 *    alto è girata di 180° rispetto a quella in basso. Su un campo vero è
 *    così, ed è la stessa scelta già fatta dal campo verticale della pagina
 *    squadra NFL (`_yardNumber` in nfl-team-home.js), dove però a essere
 *    specchiati sono i due lati lunghi.
 *
 * La freccia accanto al numero punta alla end zone più vicina; il 50, che
 * non ha un lato più vicino, non ce l'ha.
 */
function apYardNumbers() {
    const FS = 30, gap = FS * 0.42;
    let s = '';
    for (let y = 10; y <= 90; y += 10) {
        const num = String(y <= 50 ? y : 100 - y).padStart(2, '0');
        const x = apYd(y);
        for (const [fy, flip] of [[9, true], [AP_FD.W - 9, false]]) {
            const cy = apY(fy);
            // In basso si legge dritto; in alto il numero è capovolto, così
            // sta in piedi per chi guarda da quella laterale.
            const rot = flip ? 180 : 0;
            const [d1, d2] = flip ? [num[1], num[0]] : [num[0], num[1]];
            for (const [d, dx] of [[d1, -gap], [d2, gap]]) {
                const px = x + dx;
                s += `<text x="${px.toFixed(1)}" y="${cy.toFixed(1)}" text-anchor="middle" dominant-baseline="central"
                    transform="rotate(${rot} ${px.toFixed(1)} ${cy.toFixed(1)})" class="nfl-fd2-num" style="font-size:${FS}px">${d}</text>`;
            }
            if (y !== 50) {
                // Proporzioni da regolamento: lati lunghi il doppio della base.
                const dir = y < 50 ? -1 : 1;                  // verso la end zone più vicina
                const bx = x + dir * (gap + FS * 0.62), half = FS * 0.16, tip = bx + dir * FS * 0.3;
                s += `<path d="M ${bx.toFixed(1)} ${(cy - half).toFixed(1)} L ${bx.toFixed(1)} ${(cy + half).toFixed(1)} L ${tip.toFixed(1)} ${cy.toFixed(1)} Z" class="nfl-fd2-arrow"/>`;
            }
        }
    }
    return s;
}

/**
 * Il campo orizzontale a due formazioni: due Pro Set specchiati sulla linea
 * delle 50, uno per lato. Lo usano la card All-Pro (First contro Second
 * Team, senza end zone) e quella del Super Bowl (le due finaliste, con le
 * end zone tinte e i loghi dentro) — stesso disegno, stessa formazione,
 * cambia solo chi ci sta sopra.
 *
 * `left`/`right`: `{ lineup: [{slot, player}], label, color, logo }`, dove
 * `lineup` è nell'ordine di ALLPRO_SLOTS/AP_PRO_SET e `player` può essere
 * null — quel posto resta un disco vuoto col nome del ruolo.
 *
 * `clipId` è per campo: due campi nello stesso DOM (le sezioni della SPA
 * restano montate) non possono condividere l'id del clip-path.
 */
function apFieldSvg({ left, right, year, clipId, cls = '', label }) {
    const formation = (team, side) => {
        const players = (team.lineup || []).map(({ slot, player }, i) =>
            apMarker({ ...AP_PRO_SET.slots[i], label: slot, player, side, abbr: player?.nfl, year, clipId }));
        const ol = AP_PRO_SET.emptyOL.map(pos => apMarker({ ...pos, label: 'OL', player: null, side, clipId }));
        return players.join('') + ol.join('');
    };
    const midX = apX(AP_FD.spanX / 2);
    // Il campo è due volte più largo che alto: sotto agli ~700px lo SVG che si
    // stringe schiaccerebbe le scritte a illeggibili (a differenza del campo
    // verticale della pagina squadra, che sta già stretto di suo). Sotto
    // quella soglia si scrolla ORIZZONTALMENTE dentro la card — non la
    // pagina, che resta ferma — invece di rimpicciolire il testo a un punto.
    return `
    <div class="mc-apfield-scroll">
        <div class="nfl-fd2 ${cls}">
            <svg class="nfl-fd2-svg" viewBox="0 0 ${AP_FD.vbW} ${AP_FD.vbH}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="${esc(label)}">
                <defs>${fieldClipDefs(clipId)}</defs>
                <rect x="0" y="0" width="${AP_FD.vbW}" height="${AP_FD.vbH}" class="nfl-fd2-turf"/>
                ${apFieldMarkings()}
                ${apYardNumbers()}
                ${apEndZones(left, right)}
                <line x1="${midX.toFixed(1)}" y1="0" x2="${midX.toFixed(1)}" y2="${AP_FD.vbH}" class="nfl-fd2-los"/>
                ${/* Solo dove non c'è l'end zone a dire di chi è la metà campo:
                      sulla card Super Bowl il nome sta già dipinto lì dentro. */
        left.label ? `<text x="10" y="16" class="nfl-fd2-side-lbl">${esc(left.label)}</text>
                <text x="${AP_FD.vbW - 10}" y="16" text-anchor="end" class="nfl-fd2-side-lbl">${esc(right.label)}</text>` : ''}
                ${formation(left, 1)}${formation(right, 2)}
            </svg>
        </div>
    </div>`;
}

/**
 * Versione SB week della card ideal lineup: non più tre righe testuali, ma
 * un campo orizzontale intero — lo STESSO campo formazione della pagina
 * squadra NFL (`nfl-team-home.js`, `.nfl-fd2`/`.nfl-fd-*`, disegno condiviso
 * in `js/ui/field-formation.js`), solo sdraiato, con First Team schierato a
 * sinistra e Second Team a destra, specchiate sulla linea delle 50. Solo per
 * SB_WEEK: in OFFSEASON resta cardAllPro (rows), che sta meglio in coda a un
 * mosaico più affollato.
 */
function cardAllProField({ bundle, season }) {
    if (!bundle?.allPro) return '';
    return card({
        span: 'wide', cls: 'mc-apfield-card',
        kicker: `All-Pro Team ${season.year}`,
        title: 'The ideal lineup, lined up',
        body: apFieldSvg({
            left: { lineup: bundle.allPro.first, label: 'FIRST TEAM' },
            right: { lineup: bundle.allPro.second, label: 'SECOND TEAM' },
            year: season.year, clipId: 'ap-fd-clip',
            label: 'All-Pro Team, First and Second Team lined up in a Pro Set',
        }),
        cta: 'First and Second Team', href: '#allpro',
    });
}

/**
 * Le sfide della settimana aperta, dal vivo — non da Firebase, che sulla
 * stagione in corso lo scrive una volta a settimana e nel frattempo
 * mostrerebbe zeri (vedi CLAUDE.md, "Il sito non aspetta Firebase per il
 * live"). Stessa fonte e stessa logica di ripiego pre-draft di Game Center
 * (`fetchLeagueWeek` + `applyDraftLineups`), vestita con la variante
 * broadcast2 di js/ui/score-bug.js — il tabellone in stile TV.
 *
 * Solo sulla stagione in corso: interrogare l'API della lega per un anno
 * chiuso non avrebbe niente "in corso" da dire.
 */
async function cardLiveMatchups({ season }) {
    if (String(season.year) !== String(CURRENT_SEASON)) return '';

    let week, matchups, drafted;
    try {
        ({ week, matchups, drafted } = await fetchLeagueWeek(
            season.year, null, (wk) => getWeekSchedule(season.year, wk)));
    } catch (e) {
        console.warn('[home] ESPN non raggiungibile per le sfide della settimana:', e.message);
        return '';
    }
    if (!matchups.length) return '';

    // Le rose segnaposto di ESPN prima del draft non si mostrano mai: si passa
    // alle scelte vere caricate su Firebase, come in Game Center e Live.
    let leagueDrafted = drafted;
    if (!drafted) {
        const draft = await fetchDraftData(CURRENT_SEASON).catch(() => null);
        leagueDrafted = !!draft && applyDraftLineups(matchups, draft);
    }
    if (!leagueDrafted) return '';

    await fillMissingProjections(matchups, season.year, week).catch(() => { });

    const side = (t) => {
        const key = keyOf(t.name);
        const team = key && TEAMS[key];
        return {
            name: team?.name || displayName(t.name),
            color: team?.color, logo: team?.logo,
            score: t.score, projected: t.projected_score,
        };
    };
    const bugs = matchups.map(m => {
        // Come giornataCominciata in Live: se un titolare di una delle due
        // squadre ha già iniziato la sua partita NFL, la settimana è "live"
        // anche se il punteggio non ha ancora segnato nulla.
        const started = [...(m.team1.starters || []), ...(m.team2.starters || [])]
            .some(p => p.started);
        const state = (m.winner && m.winner !== 'UNDECIDED') ? 'final' : (started ? 'live' : 'projected');
        return scoreBugHTML({
            left: side(m.team1), right: side(m.team2), state, mid: `Week ${week}`,
        }, { variant: 'broadcast2' });
    }).join('');

    return card({
        span: 'wide', cls: 'mc-scorebug-card',
        kicker: `Week ${week}`,
        title: "This week's matchups",
        body: `<div class="mc-scorebug-list">${bugs}</div>`,
        cta: 'Game Center', href: '#game-center',
    });
}

/**
 * Gli ultimi risultati chiusi, con la variante marquee dello score-bug — la
 * forma principale del banco di prova (preview-scorebug.html), profilo con
 * la rientranza in alto e i nomi fuori dalla sagoma. Non broadcast2: quella
 * resta su "This week's matchups" (cardLiveMatchups), qui si voleva l'altra.
 *
 * Card a mezza larghezza normale, non più il riquadro piccolo di prima:
 * si stira come ogni altra card della riga (default `align-items: stretch`
 * della griglia) fino ad essere alta quanto la sua vicina — oggi "The
 * playoff race" (cardStandings). Le due sfide impilate si centrano nello
 * spazio verticale che avanza (.mc-scorebug-list, main.css), invece di
 * restare appiccicate in alto con un vuoto sotto.
 *
 * Stato sempre 'final': vince chi ha di più, lo decide scoreBugHTML da sé
 * confrontando i punteggi, pareggio compreso — prima lo decideva `g.won`,
 * che su un pareggio accendeva comunque un lato a caso.
 */
function cardLastWeek({ season, phase }) {
    const seen = new Set();
    const bugs = [];
    const side = (key, pts) => {
        const t = TEAMS[key];
        return { name: t?.name || key, color: t?.color, logo: t?.logo, score: pts };
    };
    TEAM_KEY_LIST.forEach(key => {
        if (seen.has(key)) return;
        const g = season.perTeam[key]?.games.find(x => x.week === phase.week);
        if (!g || !g.opp) return;
        seen.add(key); seen.add(g.opp);
        bugs.push(scoreBugHTML({
            left: side(key, g.pts), right: side(g.opp, g.oppPts),
            state: 'final',
        }, { variant: 'marquee' }));
    });
    if (!bugs.length) return '';
    return card({
        cls: 'mc-scorebug-card',
        kicker: `Week ${phase.week}`,
        title: 'Latest results',
        body: `<div class="mc-scorebug-list">${bugs.join('')}</div>`,
        cta: 'Game Center', href: '#game-center',
    });
}

/** Pallini della forma: le ultime cinque, dalla più vecchia. */
function formDots(form) {
    if (!form?.length) return '';
    return `<span class="mc-form" aria-label="Last ${form.length} results">${form
        .map(r => `<i class="mc-dot mc-dot--${r.toLowerCase()}" title="${r}"></i>`).join('')}</span>`;
}

/**
 * Card interattiva: ogni riga si apre sulla stagione della squadra e le altre
 * arretrano. L'altezza si anima con grid-template-rows 0fr→1fr, così non si
 * tocca `height: auto` e non serve misurare niente in JS.
 */
function cardStandings(ctx) {
    const { season } = ctx;
    const detail = teamSeasonDetail(ctx);

    const rows = season.standings.slice(0, 4).map((s, i) => {
        const key = keyOf(s.name);
        if (!key) return `
        <div class="mc-row"><span class="mc-seed">${i + 1}</span>${displayName(s.name)}
            <span class="mc-row-value">${s.w}–${s.l}</span></div>`;
        const d = detail[key];
        const stats = [
            { v: fmtPts(d.pf), l: 'Points for' },
            { v: fmtPts(d.pa), l: 'Points against' },
            { v: `${d.diff >= 0 ? '+' : ''}${fmtPts(d.diff)}`, l: 'Differential' },
            d.highGame ? { v: fmtPts(d.highGame.pts), l: `Best week (W${d.highGame.week})` } : null,
            d.bestStreak ? { v: d.bestStreak, l: 'Longest win run' } : null,
            d.benchPts ? { v: fmtPts(d.benchPts), l: 'Left on the bench' } : null,
        ].filter(Boolean).map(x => `
            <div class="mc-tstat"><span class="mc-tstat-v">${x.v}</span><span class="mc-tstat-l">${x.l}</span></div>`).join('');
        const h2h = d.h2h.map(v => `
            <div class="mc-h2h-row">${teamChip(v.key)}
                <span class="mc-h2h-rec">${v.w}–${v.l}${v.t ? `–${v.t}` : ''}</span></div>`).join('');

        return `
        <div class="mc-team-row" data-team="${key}" style="--team-color:${TEAMS[key].color}">
            <button class="mc-row mc-row--btn" type="button" aria-expanded="false" aria-controls="mc-tdet-${key}">
                <span class="mc-seed">${i + 1}</span>
                ${teamChip(key)}
                ${formDots(d.form)}
                <span class="mc-row-value">${s.w}–${s.l}${s.t ? `–${s.t}` : ''}</span>
                <span class="mc-row-toggle" aria-hidden="true"></span>
            </button>
            <div class="mc-tdet" id="mc-tdet-${key}">
                <div class="mc-tdet-inner">
                    <div class="mc-tstats">${stats}</div>
                    ${h2h ? `<div class="mc-h2h"><span class="mc-kicker">All-time head to head</span>${h2h}</div>` : ''}
                    <a class="mc-cta" href="#team-${key}">The ${esc(TEAMS[key].name)} page <span aria-hidden="true">→</span></a>
                </div>
            </div>
        </div>`;
    }).join('');

    const live = ['REGULAR_SEASON', 'PLAYOFFS'].includes(ctx.phase.type);
    return card({
        cls: 'mc-standings-card',
        kicker: `Season ${season.year}`,
        title: live ? 'The playoff race' : 'How it ended',
        body: `<div class="mc-rows mc-rows--teams">${rows}</div>`,
        cta: 'Full standings', href: '#standings',
    });
}

function cardMvpRace({ bundle, season }) {
    if (!bundle) return '';
    const race = Object.values(bundle.players)
        .filter(p => p.pos !== 'DEF')
        .sort((a, b) => b.total - a.total)
        .slice(0, 3);
    if (!race.length) return '';
    // La riga porta alla pagina del giocatore: è il posto dove uno vuole
    // andare dopo aver letto un nome in classifica MVP.
    const rows = race.map((p, i) => {
        const href = playerHref(p.name, p.pos, season.year);
        const inner = `
            <span class="mc-rank">${i + 1}</span>
            ${playerAvatar(p.name, p.nfl, p.pos, season.year, i === 0 ? 'mc-avatar--gold' : '')}
            <span class="mc-row-name">${esc(p.name)} <small>${esc(p.pos)}</small></span>
            <span class="mc-row-value">${fmtPts(p.total)} pt</span>`;
        const style = `--team-color:${TEAMS[p.teamKey]?.color || 'var(--accent-red)'}`;
        return href
            ? `<a class="mc-row mc-row--tinted mc-row--link" href="${href}" style="${style}">${inner}</a>`
            : `<div class="mc-row mc-row--tinted" style="${style}">${inner}</div>`;
    }).join('');
    return card({
        kicker: `Topina Honors ${season.year}`,
        title: 'The MVP race',
        body: `<div class="mc-rows">${rows}</div>`,
        cta: 'All the awards', href: '#honors',
    });
}

async function cardPlayoffs({ season }) {
    const data = await fetchFantasyData(season.year);
    const matchups = data ? getPlayoffMatchups(data, season.year) : null;
    const s = season.standings;
    const side = (t) => {
        const key = keyOf(t.name);
        return key ? teamChip(key) : displayName(t.name);
    };
    const pair = (a, b) => {
        const c1 = TEAMS[keyOf(a.name)]?.color || 'transparent';
        const c2 = TEAMS[keyOf(b.name)]?.color || 'transparent';
        return `
        <div class="mc-score-row mc-score-row--vs" style="--t1:${c1};--t2:${c2}">
            ${side(a)}<span class="mc-score">vs</span>${side(b)}
        </div>`;
    };
    const body = matchups?.length
        ? matchups.map(m => pair(m.team1, m.team2)).join('')
        : (s.length >= 4 ? pair(s[0], s[3]) + pair(s[1], s[2]) : '');
    return card({
        span: 'wide',
        kicker: `Playoffs ${season.year}`,
        title: 'Semifinals: win or go home',
        body: `<div class="mc-rows">${body}</div>`,
        cta: 'The playoff picture', href: '#standings',
    });
}

/**
 * I nove titolari di una squadra nell'ordine di AP_PRO_SET (QB, RB, RB, WR,
 * WR, TE, FLEX, K, DEF), presi dai `starters` di Firebase.
 *
 * Non si indicizza per posizione: nei dati l'ordine è QUASI sempre quello,
 * ma non sempre — ci sono formazioni storiche più corte (2023-2024) a cui
 * manca il TE, la DEF o un RB, e leggere per indice le sfalserebbe tutte
 * da lì in poi. Si pesca per ruolo, e il posto che resta scoperto tiene il
 * suo disco vuoto invece di ereditare il giocatore di un altro slot.
 */
const SB_LINEUP_SLOTS = ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'K', 'DEF'];

function sbLineup(team) {
    const pool = [...(team?.starters || [])];
    const posOf = (p) => (p.position_in_team || p.position || '').toUpperCase();
    const take = (ok) => {
        const i = pool.findIndex(p => ok(posOf(p)));
        if (i < 0) return null;
        const p = pool.splice(i, 1)[0];
        return { name: p.name, nfl: p.nfl_team, pos: posOf(p) };
    };
    const matcher = (slot) => slot === 'DEF'
        ? (x => ['DEF', 'D/ST', 'DST'].includes(x))
        : (x => x === slot);
    // I ruoli fissi per primi, il FLEX su ciò che avanza: assegnandolo nel
    // suo turno si porterebbe via un RB o un WR che serve a uno degli slot
    // dopo di lui, e la formazione uscirebbe con un buco al posto sbagliato.
    const out = SB_LINEUP_SLOTS.map(slot =>
        ({ slot, player: slot === 'FLEX' ? null : take(matcher(slot)) }));
    const flex = out.find(e => e.slot === 'FLEX');
    if (flex) flex.player = take(x => ['RB', 'WR', 'TE', 'RB/WR', 'W/R', 'FLEX'].includes(x));
    return out;
}

/**
 * La finale, disegnata: il campo visto dall'alto con le due end zone tinte,
 * i loghi delle finaliste dentro e le due formazioni titolari schierate una
 * di fronte all'altra sulla linea delle 50 — lo stesso campo della card
 * All-Pro (`apFieldSvg`), qui vestito di scuro come quello del Live.
 *
 * Prima era il campo in prospettiva come fondale sfocato dietro due loghi e
 * un "VS": bello ma muto, non diceva CHI scende in campo.
 */
async function cardSuperBowl({ season }) {
    const data = await fetchFantasyData(season.year);
    const sb = data ? getSuperBowlMatchup(data, season.year) : null;
    const playoffs = data ? getPlayoffMatchups(data, season.year) : null;
    let t1 = sb?.team1, t2 = sb?.team2;
    if ((!t1 || !t2) && playoffs?.length >= 2) {
        const winnerOf = (m) => parseFloat(m.team1.score) >= parseFloat(m.team2.score) ? m.team1 : m.team2;
        t1 = winnerOf(playoffs[0]); t2 = winnerOf(playoffs[1]);
    }
    if (!t1 || !t2) return '';
    const side = (t) => {
        const team = TEAMS[keyOf(t.name)];
        return {
            lineup: sbLineup(t),
            // Niente `label`: il nome non va all'angolo del campo ma dipinto
            // per esteso dentro l'end zone, che se lo dimensiona da sé.
            name: team?.name || displayName(t.name),
            color: team?.color, logo: team?.logo,
        };
    };
    return card({
        span: 'wide', cls: 'mc-sb-card',
        kicker: `Super Bowl · Season ${season.year}`,
        title: 'It all comes down to one night',
        body: apFieldSvg({
            left: side(t1), right: side(t2),
            year: season.year, clipId: 'sb-fd-clip', cls: 'mc-duel--night',
            label: `Super Bowl ${season.year}: ${displayName(t1.name)} against ${displayName(t2.name)}, both lineups on the field`,
        }),
        cta: 'Follow it in the Game Center', href: '#game-center',
    });
}

// ─── Card per fase ───────────────────────────────────────────────

/**
 * Non più una rail di card-logo (una per campione, a scorrimento): una sola
 * card che imita le honours board di Wimbledon, le tavole verde scuro con
 * i campioni in oro appese nel corridoio del Centre Court — un rigo per
 * anno, tutti allo stesso peso, senza mettere in risalto l'ultimo. --ri è
 * l'indice di riga: main.css lo usa per accendere i nomi in cascata quando
 * la card entra in vista (vedi .mc-trophy-row in main.css).
 *
 * Chiude il mosaico in TUTTE le fasi: la accoda initHome, non le liste di
 * MOSAIC. Aggiungerla anche là la farebbe uscire due volte.
 */
function cardChampions({ league }) {
    const rows = [...league.seasons]
        .filter(s => s.sbWinnerKey)
        .reverse()
        .map((s, i) => {
            const t = TEAMS[s.sbWinnerKey];
            return `
        <div class="mc-trophy-row" style="--ri:${i}">
            <span class="mc-trophy-year">${s.year}</span>
            <span class="mc-trophy-team">${esc(t.name)}</span>
        </div>`;
        }).join('');
    return card({
        span: 'wide', cls: 'mc-trophy-card', glow: '#d4af37',
        kicker: 'Hall of champions',
        title: 'Every champion',
        body: `<div class="mc-trophy-plate">${rows}</div>`,
        cta: 'The full history', href: '#history',
    });
}

async function railTopPerformances({ season, phase }) {
    const data = await fetchFantasyData(season.year);
    const week = data?.weeks?.[String(phase.week)];
    if (!week?.matchups) return '';
    const perf = [];
    week.matchups.forEach(m => [m.team1, m.team2].forEach(team => {
        if (!team) return;
        const key = keyOf(team.name);
        (team.starters || []).forEach(p => perf.push({
            name: p.name,
            pos: (p.position_in_team || p.position || '').toUpperCase(),
            pts: parseFloat(p.fantasy_points) || 0,
            nfl: p.nfl_team || '',
            key,
        }));
    }));
    const cards = perf.sort((a, b) => b.pts - a.pts).slice(0, 8).map(p => railCard({
        glow: TEAMS[p.key]?.color,
        href: playerHref(p.name, p.pos, season.year),
        top: `${p.pos}${TEAMS[p.key] ? ` · ${TEAMS[p.key].name}` : ''}`,
        media: playerAvatar(p.name, p.nfl, p.pos, season.year, 'mc-avatar--rail')
            + `<span class="mc-rail-big mc-rail-big--sm">${fmtPts(p.pts)}</span>`,
        title: esc(p.name),
        sub: 'fantasy points',
    }));
    return rail({
        kicker: `Week ${phase.week}`,
        title: 'Top performances',
        cards,
        cta: 'Game Center', href: '#game-center',
    });
}

function railMvpRace({ bundle, season }) {
    if (!bundle) return '';
    const cards = Object.values(bundle.players)
        .filter(p => p.pos !== 'DEF')
        .sort((a, b) => b.total - a.total)
        .slice(0, 8)
        .map((p, i) => railCard({
            glow: TEAMS[p.teamKey]?.color,
            href: playerHref(p.name, p.pos, season?.year),
            top: `#${i + 1} · ${p.pos}`,
            media: playerAvatar(p.name, p.nfl, p.pos, season?.year, `mc-avatar--rail${i === 0 ? ' mc-avatar--gold' : ''}`)
                + `<span class="mc-rail-big mc-rail-big--sm">${fmtPts(p.total)}</span>`,
            title: esc(p.name),
            sub: 'season points',
        }));
    return rail({
        kicker: 'Topina Honors',
        title: 'The MVP race',
        cards,
        cta: 'The finalists', href: '#honors',
    });
}

function railHonors({ bundle, season }) {
    if (!bundle?.revealed) return '';
    const cards = bundle.awards
        .filter(a => a.winner)
        .map(a => {
            const isCoach = a.kind === 'coach';
            const team = TEAMS[a.winner.teamKey];
            const media = isCoach
                ? (team ? `<img class="mc-rail-logo" src="${team.logo}" alt="" onerror="this.style.display='none'">` : '')
                : playerAvatar(a.winner.name, a.winner.nfl, a.winner.pos, season?.year, 'mc-avatar--rail mc-avatar--gold');
            return railCard({
                glow: team?.color,
                // Il premio di un allenatore porta alla squadra, quello di un
                // giocatore alla sua pagina.
                href: isCoach
                    ? (a.winner.teamKey ? `#team-${a.winner.teamKey}` : null)
                    : playerHref(a.winner.name, a.winner.pos, season?.year),
                top: a.abbr ? `${a.abbr} · ${a.name}` : a.name,
                media,
                title: isCoach ? esc(team?.name || '—') : esc(a.winner.name),
                sub: a.kind === 'player' && a.winner.pos ? `${a.winner.pos} · ${fmtPts(a.winner.total)} pt` : '',
            });
        });
    return rail({
        kicker: 'Topina Honors',
        title: 'The award winners',
        cards,
        cta: 'The full ceremony', href: '#honors',
    });
}

// ─── Movimento: reveal, contatori, parallax, luce ────────────────

function mountMotion(wrap) {
    // I contatori partono quando la loro card si vede davvero: contare in un
    // pezzo di pagina fuori schermo è animazione buttata.
    revealOnScroll(wrap, { onReveal: countUpWithin });

    const home = document.getElementById('home');
    parallax(wrap, { isActive: () => !home || home.classList.contains('active') });
    spotlight(wrap);
}

// ─── Interazioni ─────────────────────────────────────────────────

/**
 * Un solo listener per tutta la griglia: le card sono stringhe generate in
 * blocco, non ci sono nodi a cui agganciare handler uno per uno.
 */
function mountInteractions(wrap) {
    wrap.addEventListener('click', (e) => {
        const row = e.target.closest('.mc-row--btn');
        if (row) return toggleTeamRow(row);

        const seg = e.target.closest('.mc-seg-btn');
        if (seg) return switchNumbers(seg);

        const nav = e.target.closest('.mc-rail-nav');
        if (nav) return scrollRail(nav);
    });

    // Le frecce dei rail si accendono solo se c'è davvero dove andare
    wrap.querySelectorAll('.mc-rail').forEach(r => {
        const track = r.querySelector('.mc-rail-track');
        if (!track) return;
        syncRail(r);
        track.addEventListener('scroll', () => syncRail(r), { passive: true });
    });
    window.addEventListener('resize', () => {
        wrap.querySelectorAll('.mc-rail').forEach(syncRail);
    }, { passive: true });
}

/** Espande la squadra scelta e attenua le altre. Un secondo click richiude. */
function toggleTeamRow(btn) {
    const row = btn.closest('.mc-team-row');
    const list = row?.closest('.mc-rows--teams');
    if (!row || !list) return;

    const wasOpen = row.classList.contains('is-open');
    list.querySelectorAll('.mc-team-row.is-open').forEach(r => {
        r.classList.remove('is-open');
        r.querySelector('.mc-row--btn')?.setAttribute('aria-expanded', 'false');
    });
    list.classList.toggle('has-open', !wasOpen);
    if (wasOpen) return;

    row.classList.add('is-open');
    btn.setAttribute('aria-expanded', 'true');
}

/** Commuta i numeri fra stagione e storia della lega, e li riconta. */
function switchNumbers(btn) {
    const card = btn.closest('.mc-nums-card');
    const slot = card?.querySelector('[data-nums-slot]');
    if (!slot || btn.classList.contains('is-active')) return;

    let sets;
    try { sets = JSON.parse(card.dataset.numsets); } catch { return; }
    const tiles = sets[btn.dataset.nums];
    if (!tiles) return;

    card.querySelectorAll('.mc-seg-btn').forEach(b => {
        const on = b === btn;
        b.classList.toggle('is-active', on);
        b.setAttribute('aria-selected', String(on));
    });

    // Dissolvenza in uscita, ridisegno, conteggio da capo: il cambio si legge
    // come una transizione di stato, non come uno scatto.
    slot.classList.add('is-swapping');
    setTimeout(() => {
        slot.innerHTML = numTiles(tiles);
        slot.classList.remove('is-swapping');
        recountWithin(slot, 800);
    }, 180);
}

function scrollRail(btn) {
    const track = btn.closest('.mc-rail')?.querySelector('.mc-rail-track');
    if (!track) return;
    const card = track.querySelector('.mc-rail-card');
    const step = card ? card.getBoundingClientRect().width + 14 : track.clientWidth * 0.8;
    track.scrollBy({ left: step * 2 * Number(btn.dataset.rail), behavior: 'smooth' });
}

function syncRail(r) {
    const track = r.querySelector('.mc-rail-track');
    const [prev, next] = r.querySelectorAll('.mc-rail-nav');
    if (!track || !prev || !next) return;
    const max = track.scrollWidth - track.clientWidth;
    prev.disabled = track.scrollLeft <= 2;
    next.disabled = track.scrollLeft >= max - 2;
    r.classList.toggle('mc-rail--static', max <= 2);
}
