/**
 * Home — mosaico dinamico di card (stile Apple).
 *
 * La home è una griglia di card in stile "All Teams" che si rivelano allo
 * scroll (IntersectionObserver) con leggeri effetti parallax ([data-depth]).
 * Il CONTENUTO del mosaico dipende dal momento della lega, rilevato dai
 * dati Firebase — non da date hardcoded:
 *
 *   REGULAR_SEASON → sfide in corso, risultati week, rail top performance,
 *                    mercato (waiver wire), classifica
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

import { displayName, teamNameHTML, teamAbbr, fetchFantasyData, fetchDraftData, flattenDraft, getPlayoffMatchups, getSuperBowlMatchup, CURRENT_SEASON } from '../data.js?v=594';
import { getLeagueData, TEAM_KEY_LIST } from '../data/league-data.js?v=586';
import { getHonorsBundle } from '../data/honors.js?v=723';
import { electHallOfFame } from '../data/hall-of-fame.js?v=631';
import { TEAMS } from './team.js?v=820';
import { paniniCard, hydratePaniniBadges, initPlayerModal } from '../components/player-modal.js?v=771';
import { teamsCardsHTML } from './teams.js?v=732';
import { playerImageService } from '../services/player-image-service.js?v=532';
import { teamSeasonDetail, numberSets, seasonStarted } from '../data/season-story.js?v=44';
import { revealOnScroll, countUpWithin, recountWithin, parallax, spotlight } from '../utils/motion.js?v=1';
import { coriandoliAttorno, razziDaiLati, FESTA_PIENA } from '../ui/live-fx.js?v=35';
import { fieldMarker, fieldClipDefs, hydrateFieldPhotos, hydrateFieldJerseys } from '../ui/field-formation.js?v=3';
import { apFieldSvg, sbLineup, fitEndZones } from '../ui/field-allpro.js?v=8';
import { fetchLeagueWeek, fillMissingProjections } from '../data/espn-fantasy.js?v=57';
import { applyDraftLineups } from '../data/draft-lineups.js?v=48';
import { getWaiverMoves } from '../data/waiver-moves.js?v=3';
import { getWeekSchedule, getNextKickoffDate } from '../data/nfl-schedule.js?v=546';
import { currentScoreBugHTML } from '../ui/score-bug-current.js?v=3';
import { getSeasonProjections } from '../data/projections.js?v=611';
import { getHistoryIndex } from '../data/player-history.js?v=595';
import { predictSeason } from '../data/draft-predictions.js?v=694';
import { evaluateLeague } from '../data/team-eval.js?v=596';
import { computeDraftGrade, getDraftGradeCalib, getAdpDispersion } from '../data/draft-grade.js?v=65';
// Il motore di voto (computeGrades/makeEvaluator) vive in draftgrades.js, non
// in un modulo dati: si importa da lì invece di riscriverlo, per non avere
// due pipeline di voto che possono scollarsi. Unico caso nel file in cui una
// sezione ne legge un'altra — vedi loadPostDraftGrades().
import { computeGrades, makeEvaluator, gradeLetterHTML } from './draftgrades.js?v=812';

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
        const archivio = [...league.seasons].reverse().find(seasonStarted)
            || league.seasons[league.seasons.length - 1];

        // La stagione in corso su Firebase arriva solo il martedi', a giornata
        // chiusa: durante la week 1 l'archivio e' ancora fermo all'anno prima,
        // e la home diceva "Offseason" mentre il Live segnava punti veri.
        //
        // Il segnale e' lo stesso che usa il Live per smettere di mostrare le
        // proiezioni: un titolare che ha gia' cominciato la sua partita NFL.
        // Non una data, non il calendario: la lega e' viva quando si gioca.
        const corrente = league.seasons.find(s => String(s.year) === String(CURRENT_SEASON));
        const viva = (!preview && corrente && !seasonStarted(corrente))
            ? await liveWeekBugs(corrente) : null;

        const season = (preview?.year && league.seasons.find(s => s.year === preview.year))
            || (viva?.viva ? corrente : archivio);
        const bundle = await getHonorsBundle(season.year);
        // Solo quando conta davvero: a stagione chiusa (preseason/offseason) o
        // in preview di una di quelle due fasi. Nel resto dell'anno il
        // countdown non si vede, e interrogare ESPN per niente sarebbe una
        // richiesta di troppo a ogni apertura della home.
        const previewNeedsDays = preview && ['PRESEASON', 'OFFSEASON'].includes(preview.type) && preview.days == null;
        const kickoffDays = (season.complete || previewNeedsDays) ? await daysToKickoff(season.year) : null;
        const phase = detectPhase(season, bundle, preview, kickoffDays, viva);
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

function detectPhase(season, bundle, preview, kickoffDays, viva) {
    if (preview) {
        return {
            type: preview.type,
            week: preview.week ?? lastPlayedWeek(season),
            days: preview.days ?? Math.max(kickoffDays ?? 1, 1),
        };
    }
    // Si gioca adesso, ma Firebase non ha ancora scritto niente: la settimana
    // la dice ESPN, perche' `lastPlayedWeek` leggerebbe l'archivio e darebbe 0.
    if (viva?.viva) return { type: 'REGULAR_SEASON', week: viva.week };
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
        // Il tabellone in DUE blocchi appaiati, mezza pagina l'uno: le sfide
        // in corso e la giornata archiviata. Stesso banner del Live per
        // entrambi; a distinguerli è il titolo, non una sfumatura di tema.
        cardLiveMatchups(ctx, 'half'),
        cardLastResults(ctx),
        // Le prestazioni subito sotto il tabellone: sono la stessa giornata
        // vista da vicino — chi ha fatto quei punti — e a giornata in corso si
        // muovono insieme. La classifica e' la domanda dopo.
        railTopPerformances(ctx),
        // Il mercato subito dopo: è l'altra metà delle notizie della
        // settimana — i punti fatti e le mosse per farne di più la prossima.
        cardWaivers(ctx),
        // Con le due card fuse, la classifica resterebbe sola in riga fra due
        // elementi a tutta larghezza. I numeri salgono ad affiancarla, come
        // già in PRESEASON: due liste di quattro righe, la stessa forma.
        cardStandings(ctx),
        cardNumbers(ctx),
        cardTeams(ctx),
        // Il rail e non la card a meta': con una card in meno le tre a mezza
        // larghezza non si appaiano più e una resterebbe sola in riga, con
        // mezzo mosaico vuoto accanto. È la stessa scelta dei playoff, dove
        // la corsa all'MVP è già un rail.
        railMvpRace(ctx),
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

// Il campo orizzontale delle formazioni (geometria, end zone, segnaletica e
// i nove slot) sta in js/ui/field-allpro.js: da quando lo disegna anche la
// pagina squadra non può vivere dentro una sezione.

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

/* ── Il tabellone della home: lo STESSO banner che disegna il Live ──────
 *
 * `js/ui/score-bug-current.js` è il pezzo in produzione (il `.gc-banner` con
 * gli stemmi in filigrana, i due totali grandi e la quota appoggiata al bordo
 * basso). Qui si preparano solo i dati: nomi già in HTML per
 * `refitTeamNames()`, punteggio già composto, colori e stemmi dalla palette.
 *
 * Prima era la variante `broadcast2` di `js/ui/score-bug.js` — che però è la
 * PROPOSTA, non il tabellone in uso: la home mostrava un banner che in nessun
 * altro punto del sito esiste.
 */

const P = (v) => parseFloat(v) || 0;

/** Un punteggio come lo scrive il Live: un decimale, separatore inglese. */
const fmtBug = (n) => (+n).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/**
 * Il punteggio di un lato. La proiezione sta sempre dal lato ESTERNO e il
 * numero vero verso il centro, come in `live.js:bannerScoreHTML`: i due totali
 * che contano si leggono appaiati, le stime restano ai bordi.
 *
 * A giornata non cominciata la proiezione È il punteggio (`proiettato`), e si
 * vede che lo è: `.proj-pts`, corsivo e blu.
 */
function bannerScoreHTML(score, projected, lato, proiettato) {
    if (proiettato) return `<span class="pts-val proj-pts">${fmtBug(score)}</span>`;
    const previsto = projected == null ? ''
        : `<small class="pts-proj" title="projected">${fmtBug(P(projected))}</small>`;
    const vero = `<span class="pts-val">${fmtBug(score)}</span>`;
    return lato === 'l' ? `${previsto}${vero}` : `${vero}${previsto}`;
}

/** Un lato del banner: identità della squadra + il suo punteggio già in HTML. */
function bannerSide(rawName, scoreHTML, winner) {
    const team = TEAMS[keyOf(rawName)];
    return {
        nameHTML: teamNameHTML(team?.name || displayName(rawName)),
        logo: team?.logo, color: team?.color, scoreHTML, winner,
    };
}

/**
 * Le sfide della settimana aperta, dal vivo — non da Firebase, che sulla
 * stagione in corso lo scrive una volta a settimana e nel frattempo
 * mostrerebbe zeri (vedi CLAUDE.md, "Il sito non aspetta Firebase per il
 * live"). Stessa fonte e stessa logica di ripiego pre-draft di Game Center
 * (`fetchLeagueWeek` + `applyDraftLineups`), vestita con lo stesso banner
 * del Live (js/ui/score-bug-current.js).
 *
 * Solo sulla stagione in corso: interrogare l'API della lega per un anno
 * chiuso non avrebbe niente "in corso" da dire.
 */
let cacheSettimanaViva = null;   // { anno, promessa }

/**
 * Una richiesta sola, tre lettori: la chiamano `cardLiveMatchups` (per
 * disegnare le sfide), `cardLastResults` (per sapere se sta gia' mostrando
 * quella settimana) e `initHome` (per sapere se la stagione e' partita).
 * Senza memoria sarebbero due letture identiche della lega a ogni apertura.
 * In cache va la PROMESSA, cosi' anche due chiamate partite insieme si
 * agganciano alla prima.
 */
function liveWeekBugs(season) {
    if (String(season.year) !== String(CURRENT_SEASON)) return Promise.resolve(null);
    if (cacheSettimanaViva?.anno !== String(season.year)) {
        cacheSettimanaViva = { anno: String(season.year), promessa: leggiSettimanaViva(season) };
    }
    return cacheSettimanaViva.promessa;
}

async function leggiSettimanaViva(season) {
    let week, matchups, drafted;
    try {
        ({ week, matchups, drafted } = await fetchLeagueWeek(
            season.year, null, (wk) => getWeekSchedule(season.year, wk)));
    } catch (e) {
        console.warn('[home] ESPN non raggiungibile per le sfide della settimana:', e.message);
        return null;
    }
    if (!matchups.length) return null;

    // Le rose segnaposto di ESPN prima del draft non si mostrano mai: si passa
    // alle scelte vere caricate su Firebase, come in Game Center e Live.
    let leagueDrafted = drafted;
    if (!drafted) {
        const draft = await fetchDraftData(CURRENT_SEASON).catch(() => null);
        leagueDrafted = !!draft && applyDraftLineups(matchups, draft);
    }
    if (!leagueDrafted) return null;

    await fillMissingProjections(matchups, season.year, week).catch(() => { });

    const bugs = matchups.map(m => {
        // Come giornataCominciata in Live: se un titolare di una delle due
        // squadre ha già iniziato la sua partita NFL, la settimana è "live"
        // anche se il punteggio non ha ancora segnato nulla.
        const started = [...(m.team1.starters || []), ...(m.team2.starters || [])]
            .some(p => p.started);
        const chiusa = !!(m.winner && m.winner !== 'UNDECIDED');
        // Stesse due righe di Live (`teamIsProjected`/`teamEffScore`): finché
        // nessuno ha giocato la proiezione È il punteggio; al primo snap
        // valgono i punti veri per tutti, zeri compresi.
        const proiettata = (t) => !started && P(t.score) === 0 && t.projected_score != null;
        const punti = (t) => (proiettata(t) ? P(t.projected_score) : P(t.score));
        const s1 = punti(m.team1), s2 = punti(m.team2);
        const total = s1 + s2;
        return currentScoreBugHTML({
            left: bannerSide(m.team1.name,
                bannerScoreHTML(s1, m.team1.projected_score, 'l', proiettata(m.team1)), s1 >= s2),
            right: bannerSide(m.team2.name,
                bannerScoreHTML(s2, m.team2.projected_score, 'r', proiettata(m.team2)), s2 >= s1),
            mid: chiusa ? 'final' : (started ? 'live' : 'vs'),
            probPct: total > 0 ? (s1 / total) * 100 : 50,
        });
    }).join('');

    // `viva` e' la stessa domanda che si fa il Live: qualcuno dei nostri ha
    // gia' cominciato a giocare? Da qui la home capisce che la stagione e'
    // partita anche se Firebase non lo sa ancora.
    //
    // La seconda mezza riga copre il buco fra la fine del Monday Night e la
    // scrittura su Firebase del martedi': li' ESPN e' gia' passata alla
    // settimana dopo, dove non ha ancora giocato nessuno, e senza questa la
    // home tornerebbe "Offseason" per qualche ora. Se la settimana corrente
    // non e' la prima, la lega ha giocato: prima del via ESPN resta sulla 1.
    const viva = week > 1
        || matchups.some(m => [...(m.team1.starters || []), ...(m.team2.starters || [])]
            .some(p => p.started));

    // `matchups` esce di qui perche' se lo rilegge anche la card delle
    // prestazioni: e' la stessa giornata, tanto vale scaricarla una volta.
    return { week, bugs, viva, matchups };
}

/**
 * Primo blocco del tabellone: le sfide della settimana APERTA, dal vivo.
 *
 * In regular season sta ACCANTO a `cardLastResults` — due mezze card appaiate,
 * "come sta andando" e "com'è finita" — e per questo lo `span` è un parametro:
 * nei playoff e nella settimana di SB è sola (l'ultima giornata chiusa la
 * racconta già il tabellone del bracket), e una mezza card senza compagna si
 * porterebbe dietro mezza riga vuota.
 *
 * Se ESPN non risponde — o la lega non ha ancora draftato — torna stringa
 * vuota e il mosaico si chiude su se stesso: resta il solo blocco dei
 * risultati, che a quel punto È il tabellone.
 */
async function cardLiveMatchups({ season }, span = 'wide') {
    const live = await liveWeekBugs(season);
    if (!live) return '';
    return card({
        span, cls: 'mc-scorebug-card',
        kicker: `Week ${live.week}`,
        title: "This week's matchups",
        body: `<div class="mc-scorebug-list">${live.bugs}</div>`,
        cta: 'Game Center', href: '#game-center',
    });
}

/**
 * Le sfide dell'ultima giornata CHIUSA, lette da Firebase: stesso banner di
 * quelle in corso, senza proiezioni e senza "live" — i punti sono definitivi.
 *
 * La barra in basso non è una previsione: è la quota di punti finita da una
 * parte e dall'altra, cioè quanto larga è stata la vittoria. A giornata chiusa
 * è l'unica cosa che il banner può ancora aggiungere ai due numeri.
 *
 * Vince chi ha di più, pareggio compreso (`>=` da tutt'e due i lati): prima lo
 * decideva `g.won`, che su un pareggio accendeva comunque un lato a caso.
 */
function lastWeekBugs({ season, phase }) {
    const seen = new Set();
    const bugs = [];
    const side = (key, pts, lato, winner) => bannerSide(
        TEAMS[key]?.name || key, bannerScoreHTML(P(pts), null, lato, false), winner);
    TEAM_KEY_LIST.forEach(key => {
        if (seen.has(key)) return;
        const g = season.perTeam[key]?.games.find(x => x.week === phase.week);
        if (!g || !g.opp) return;
        seen.add(key); seen.add(g.opp);
        const total = P(g.pts) + P(g.oppPts);
        bugs.push(currentScoreBugHTML({
            left: side(key, g.pts, 'l', P(g.pts) >= P(g.oppPts)),
            right: side(g.opp, g.oppPts, 'r', P(g.oppPts) >= P(g.pts)),
            mid: 'final',
            probPct: total > 0 ? (P(g.pts) / total) * 100 : 50,
        }));
    });
    if (!bugs.length) return null;
    return { week: phase.week, bugs: bugs.join('') };
}

/**
 * Il secondo blocco del tabellone: l'ultima giornata archiviata.
 *
 * Sta in una card SUA, accanto a quella delle sfide in corso, invece che
 * sotto un righello dentro la stessa striscia. Erano un blocco solo perché
 * puntano allo stesso posto (Game Center), ma sono due domande diverse — "come
 * sta andando" e "com'è finita" — e dentro una card sola si distinguevano
 * soltanto per il tema del banner, un segnale che si legge come un difetto di
 * stampa più che come "questa è archiviata". Due blocchi, due titoli.
 *
 * Il controllo sulla settimana resta: Firebase scrive la giornata chiusa il
 * martedì e per qualche ora ESPN mostra ancora la stessa: sono le stesse
 * sfide, e in due card affiancate si vedrebbero due volte. Vince quella viva.
 */
async function cardLastResults(ctx) {
    const last = lastWeekBugs(ctx);
    if (!last) return '';
    const live = await liveWeekBugs(ctx.season);
    if (live && live.week === last.week) return '';

    return card({
        span: 'half', cls: 'mc-scorebug-card',
        kicker: `Week ${last.week}`,
        title: 'Latest results',
        body: `<div class="mc-scorebug-list">${last.bugs}</div>`,
        cta: 'Game Center', href: '#game-center',
    });
}

/* ─── Il mercato ──────────────────────────────────────────────────
   Le stesse mosse della sezione Waivers (`data/waiver-moves.js`, che sceglie
   da sé la fonte: transazioni ESPN quando ci sono, ricostruzione dalle rose
   per le stagioni vecchie), ma RAGGRUPPATE. ESPN registra ogni transazione
   come righe separate — un ADD e un DROP — e due righe staccate raccontano
   uno scambio peggio di una riga sola: qui la domanda è «cosa ha fatto quella
   squadra», non «quanti giocatori si sono mossi». La chiave del gruppo è
   squadra + momento, e sulle stagioni ricostruite il momento è la settimana,
   l'unica cosa che si sappia.

   Card ASSENTE, non vuota, finché nessuno ha mosso niente: a inizio stagione
   un riquadro "no moves" sarebbe un buco in mezzo al mosaico. */
const WV_GROUPS = 6;

async function cardWaivers({ season }) {
    const { mosse } = await getWaiverMoves(season.year).catch(() => ({ mosse: [] }));
    if (!mosse?.length) return '';

    // `mosse` arriva già ordinata (più recente in alto): i gruppi ereditano
    // quell'ordine così come si formano, senza riordinarli una seconda volta.
    const gruppi = [];
    const perChiave = new Map();
    for (const m of mosse) {
        const chiave = `${m.squadra}|${m.data || `w${m.settimana}`}`;
        let g = perChiave.get(chiave);
        if (!g) {
            g = { squadra: m.squadra, data: m.data, settimana: m.settimana, tipo: m.tipo, bid: null, in: [], out: [] };
            perChiave.set(chiave, g);
            gruppi.push(g);
        }
        if (m.bid && !g.bid) g.bid = m.bid;
        (m.verso === 'in' ? g.in : g.out).push(m);
    }

    const tiles = gruppi.slice(0, WV_GROUPS).map(g => wvMoveHTML(g, season.year)).join('');
    return card({
        span: 'wide', cls: 'mc-wv-card',
        kicker: 'The market',
        title: 'Waiver wire',
        body: `<div class="mc-wv-grid">${tiles}</div>`,
        cta: 'All moves', href: '#waivers',
    });
}

/** Data breve della mossa. Senza (stagioni ricostruite) resta la settimana. */
function wvWhen(g) {
    const parti = [];
    if (g.settimana != null) parti.push(`W${g.settimana}`);
    if (g.data) {
        const d = new Date(Number(g.data) || g.data);
        if (!Number.isNaN(d.getTime())) parti.push(d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
    }
    return parti.join(' · ');
}

function wvMoveHTML(g, year) {
    const t = TEAMS[g.squadra];
    // Un giocatore che ESPN non ha saputo risolvere arriva come "#12345":
    // resta testo, un link lo porterebbe a una scheda vuota.
    const riga = (m, verso) => {
        const href = String(m.nome).startsWith('#') ? null : playerHref(m.nome, m.pos, year);
        const tag = href ? 'a' : 'span';
        return `
        <${tag} class="mc-wv-p mc-wv-p--${verso}"${href ? ` href="${href}"` : ''}>
            ${playerAvatar(m.nome, m.nfl, m.pos, year, 'mc-avatar--wv')}
            <span class="mc-wv-name">${esc(m.nome)}</span>
            ${m.pos ? `<i class="mc-rail-pos pos-${esc(m.pos).toLowerCase()}">${esc(m.pos)}</i>` : ''}
            <span class="mc-wv-dir">${verso === 'in' ? 'IN' : 'OUT'}</span>
        </${tag}>`;
    };
    return `
    <article class="mc-wv-move"${t ? ` style="--team-color:${t.color}"` : ''}>
        <header class="mc-wv-head">
            ${t ? `<img class="mc-wv-logo" src="${t.logo}" alt="" onerror="this.remove()">` : ''}
            <span class="mc-wv-team">${t ? teamNameHTML(t.name) : esc(g.squadra || '')}</span>
            <span class="mc-wv-when">${esc(wvWhen(g))}</span>
        </header>
        <div class="mc-wv-players">
            ${g.in.map(m => riga(m, 'in')).join('')}
            ${g.out.map(m => riga(m, 'out')).join('')}
        </div>
        <footer class="mc-wv-foot">${esc(g.tipo || '')}${g.bid ? ` · $${esc(g.bid)}` : ''}</footer>
    </article>`;
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

/** I titolari di una giornata, con i punti, appiattiti in una lista sola. */
function titolariConPunti(matchups) {
    const out = [];
    (matchups || []).forEach(m => [m.team1, m.team2].forEach(team => {
        if (!team) return;
        const key = keyOf(team.name);
        (team.starters || []).forEach(p => out.push({
            name: p.name,
            pos: (p.position_in_team || p.position || '').toUpperCase(),
            pts: parseFloat(p.fantasy_points) || 0,
            nfl: p.nfl_team || '',
            key,
        }));
    }));
    return out;
}

/**
 * Le prestazioni della giornata, da due fonti in ordine di preferenza.
 *
 * L'archivio per primo, che a giornata chiusa e' la verita' definitiva. Ma
 * Firebase la scrive solo il martedi': durante la settimana il nodo della week
 * ESISTE gia' — le rose le mette ESPN in anticipo — con tutti i punti a zero, e
 * la card si riempiva di "migliori" a 0,0 proprio mentre il tabellone sopra
 * segnava 39,20. Allora si passa alle stesse formazioni che alimentano il
 * tabellone live: sono gia' scaricate e in cache, non costano una richiesta.
 *
 * Dal vivo restano solo quelli che hanno gia' fatto punti: a meta' domenica
 * meta' dei titolari non e' ancora scesa in campo, e un "top performer" a 0,0
 * e' solo uno che deve ancora giocare. `live` lo dice a chi guarda, perche'
 * questi numeri si muovono ancora.
 */
async function prestazioniSettimana(season, week) {
    const data = await fetchFantasyData(season.year).catch(() => null);
    const archivio = titolariConPunti(data?.weeks?.[String(week)]?.matchups);
    if (archivio.some(p => p.pts > 0)) return { perf: archivio, live: false };

    const viva = await liveWeekBugs(season);
    const perf = titolariConPunti(viva?.matchups).filter(p => p.pts > 0);
    return { perf, live: perf.length > 0 };
}

async function railTopPerformances({ season, phase }) {
    const { perf, live } = await prestazioniSettimana(season, phase.week);
    if (!perf.length) return '';
    // Foto in cima, poi il numero, poi "nome + ruolo" e sotto la squadra.
    // Prima l'occhiello sopra la foto diceva "WR · OSCURUS" e la riga sotto
    // "fantasy points": la stessa cosa scritta due volte (il numero grande e'
    // gia' evidentemente dei punti), e chi l'ha fatto finiva sopra la foto
    // invece che accanto al nome, dove lo si cerca.
    const cards = perf.sort((a, b) => b.pts - a.pts).slice(0, 8).map(p => railCard({
        glow: TEAMS[p.key]?.color,
        href: playerHref(p.name, p.pos, season.year),
        media: playerAvatar(p.name, p.nfl, p.pos, season.year, 'mc-avatar--rail')
            + `<span class="mc-rail-big mc-rail-big--sm">${fmtPts(p.pts)}</span>`,
        title: `${esc(p.name)}${p.pos ? ` <i class="mc-rail-pos pos-${p.pos.toLowerCase()}">${esc(p.pos)}</i>` : ''}`,
        sub: TEAMS[p.key] ? teamNameHTML(TEAMS[p.key].name) : '',
    }));
    return rail({
        kicker: `Week ${phase.week}${live ? ' · live' : ''}`,
        title: 'Top performances',
        cards,
        cta: 'Game Center', href: '#game-center',
    });
}

function railMvpRace({ bundle, season }) {
    if (!bundle) return '';
    // Stessa ragione di railTopPerformances: prima che una giornata sia chiusa
    // i totali di stagione sono tutti zero, e una corsa all'MVP con otto
    // giocatori a 0,0 e' peggio che non averla.
    if (!Object.values(bundle.players).some(p => p.total > 0)) return '';
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

/**
 * La festa del campione quando la card dell'ultimo vincitore entra in vista:
 * coriandoli che scoppiano sulla card e fuochi d'artificio che salgono dai due
 * lati. Le primitive sono quelle del Live (`coriandoliAttorno`,
 * `razziDaiLati`), con le misure del touchdown (FESTA_PIENA) — non una seconda
 * festa scritta a parte.
 *
 * NON si usa `festaAttorno` intera: quella spara i razzi tutti da sotto il
 * centro e aggiunge un anello di scoppi ATTORNO al soggetto. Va bene per un
 * giocatore dentro il campo, ma qui il soggetto è una card larga quanto la
 * pagina: l'anello le scoppia addosso e i razzi in colonna si leggono come uno
 * sbuffo solo. Ai lati invece i colpi salgono ai suoi fianchi e scoppiano
 * sopra, dove non c'è niente da coprire.
 *
 * Il livello NON sta dentro la card. La card ha `overflow: hidden` e ci
 * terrebbe dentro tutto: sarebbero coriandoli in una scatola, mentre quello
 * che si vuole è che sparino nella pagina. Sta quindi dentro `.mosaic` (che è
 * `position: relative`, quindi è l'offsetParent della card) e la sborda: sopra
 * ci vanno i fuochi, sotto lo spazio da cui salgono i razzi, e i coriandoli
 * ricadono sulle card vicine.
 *
 * Il riquadro si misura invece di prendersi tutta la home perché le primitive
 * leggono le proporzioni del livello: i razzi partono dal suo bordo inferiore
 * e le bande laterali sono frazioni della sua larghezza. Su un livello alto
 * quanto la pagina i razzi sarebbero partiti tremila pixel più giù.
 *
 * In ORIZZONTALE invece il livello È il mosaico, esattamente: `.mosaic` ha
 * `overflow-x: clip` e taglia al proprio bordo, quindi si prende quella misura
 * e nemmeno un pixel di più. Un margine laterale a occhio faceva partire i
 * razzi oltre il taglio e i loro scoppi arrivavano dimezzati — misurato: della
 * banda sinistra sopravviveva un quinto. E la misura si LEGGE (`clientWidth`),
 * non si scrive: il padding del mosaico è 24 sul desktop ma 16 sul telefono, e
 * col numero fisso sbordava di dieci pixel per lato proprio dove lo schermo è
 * più stretto. In verticale il taglio non c'è (`overflow-y` resta `visible`),
 * ed è infatti di là che la festa esce dalla card.
 *
 * Un colpo solo: `revealOnScroll` smette di osservare la card dopo il primo
 * scatto, e il flag sull'elemento regge anche se un domani la si riaggancia.
 * Con `prefers-reduced-motion` non parte niente — lo decide `festaAttorno`,
 * che torna false e a quel punto il livello si smonta subito.
 *
 * Perché non basta il reveal: in offseason la card del campione è la SECONDA
 * del mosaico e l'hero sopra è basso, quindi a pagina caricata è già tutta a
 * schermo (misurata: 100% visibile a 1440×900, a 1728×1000 e a 390×844). Il
 * reveal scatta lì, cioè al caricamento, e la festa diventa un'animazione di
 * ingresso che parte da sola — non «scorro e la trovo». Quando la card nasce
 * già in vista si aspetta quindi il primo scorrimento vero; se quello
 * scorrimento se la porta via, si riarma e si riprova. In preseason la stessa
 * card sta più in basso e il reveal arriva già a scorrimento fatto: lì il
 * ramo d'attesa non si usa nemmeno.
 */
const FESTA_SU = 170;     // aria sopra la card, dove scoppiano i fuochi
const FESTA_GIU = 320;    // la rampa dei razzi, sotto

/** In vista per davvero: mezza card dentro la finestra, non un bordo. */
function inVista(el) {
    const r = el.getBoundingClientRect();
    const dentro = Math.min(innerHeight, r.bottom) - Math.max(0, r.top);
    return dentro > r.height * 0.5;
}

function festaCampione(cardEl) {
    if (cardEl.dataset.festa) return;
    // `scrollY < 40`: la pagina è ancora ferma in cima, nessuno ha scorso.
    if (scrollY < 40 || !inVista(cardEl)) {
        addEventListener('scroll', () => festaCampione(cardEl), { once: true, passive: true });
        return;
    }
    cardEl.dataset.festa = '1';
    const host = cardEl.offsetParent;
    if (!host) return;

    const layer = document.createElement('div');
    layer.className = 'live-fx mc-fx';
    layer.setAttribute('aria-hidden', 'true');
    layer.style.left = '0px';
    layer.style.top = `${cardEl.offsetTop - FESTA_SU}px`;
    layer.style.width = `${host.clientWidth}px`;
    layer.style.height = `${cardEl.offsetHeight + FESTA_SU + FESTA_GIU}px`;
    host.appendChild(layer);

    // I fuochi sono nei colori del campione e basta — è il suo momento. Ma il
    // colore squadra puro non può essere l'unico: due dei quattro sono scuri
    // (Oscurus #800020, Sommo #1c4750) e su fondo nero uno scoppio in quel
    // colore non si vede. Si schiarisce verso il bianco senza uscire dalla
    // famiglia, la stessa ricetta con cui lo score-bug tratta i colori scuri.
    const team = cardEl.style.getPropertyValue('--team-color').trim() || 'var(--accent-red)';
    const fuochi = [
        team,
        `color-mix(in srgb, ${team} 72%, #fff)`,
        `color-mix(in srgb, ${team} 42%, #fff)`,
    ];
    // I coriandoli tengono anche oro e bianco: sono quelli di una premiazione,
    // e il nastro dorato è il trofeo, non la squadra.
    const coriandoli = [team, '#d4af37', '#ffffff', '#ffe9a8'];

    // Dopo il fade della card (0.7s), non insieme: sparare mentre sta ancora
    // comparendo fa sembrare i coriandoli parte del suo ingresso.
    setTimeout(() => {
        if (!layer.isConnected) return;
        const ok = coriandoliAttorno(layer, cardEl, coriandoli, FESTA_PIENA);
        // `tetto`: i colpi scoppiano nella fascia sopra la card, non davanti al
        // nome del campione. È la stessa aria che il livello si prende in alto.
        razziDaiLati(layer, fuochi, { dura: FESTA_PIENA.dura, tetto: FESTA_SU });
        if (!ok) { layer.remove(); return; }
        // Le ultime particelle partono a fine festa e volano ancora qualche
        // secondo: il livello se ne va quando è vuoto davvero.
        setTimeout(() => layer.remove(), FESTA_PIENA.dura + 5000);
    }, 320);
}

// ─── Movimento: reveal, contatori, parallax, luce ────────────────

function mountMotion(wrap) {
    // I contatori partono quando la loro card si vede davvero: contare in un
    // pezzo di pagina fuori schermo è animazione buttata. Stesso aggancio per
    // la festa del campione: si scopre scorrendo, e chi non ci arriva non se
    // la merita.
    revealOnScroll(wrap, {
        onReveal: (el) => {
            countUpWithin(el);
            if (el.classList.contains('mc-champion-card')) festaCampione(el);
        },
    });

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
