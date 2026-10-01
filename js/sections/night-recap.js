/**
 * Night Recap — il replay accelerato delle partite di notte.
 *
 * Le partite NFL del turno primetime finiscono alle cinque del mattino ora
 * italiana: chi apre il sito la mattina trova il risultato già fatto. Questo è
 * il pezzo che glielo racconta invece di comunicarglielo — i suoi titolari in
 * campo, il tabellone NFL che avanza, i punti che salgono giocata per giocata,
 * con gli stessi effetti del Live: l'anello arancione quando la sua squadra ha
 * la palla, rosso dentro la red zone, coriandoli sul touchdown.
 *
 * ── Il sipario ──────────────────────────────────────────────────────────
 *
 * Tutta la suspense dipende dal NON vedere il risultato prima. La home lo
 * mostra nel banner, quindi il sipario si alza SUBITO e in modo sincrono, al
 * primo tocco di `boot()`, prima che qualunque sezione disegni: `alzaSipario()`
 * non fa una sola richiesta di rete. I dati arrivano dietro al sipario, e se
 * non c'è niente da rivedere il sipario si abbassa da solo.
 *
 * Quando non parte nemmeno il sipario lo decide `valeTentare()` in
 * `data/night-recap.js`, che guarda solo localStorage — vedi là il perché dei
 * tre cancelli.
 *
 * ── Chi si vede ─────────────────────────────────────────────────────────
 *
 * I titolari della SQUADRA DEL CUORE (`squadraPreferita()`) che giocavano in
 * quelle partite, e nessun altro: una maglia spenta accanto a chi ha giocato
 * non racconta niente. Senza squadra del cuore scelta non si sa di chi sia il
 * replay, e non si apre niente.
 *
 * Più partite di notte nella stessa nottata (giovedì + domenica + lunedì, se
 * uno non apre il sito per tre giorni) diventano CAPITOLI in fila, uno per
 * partita, ognuno col suo tabellone e i suoi giocatori.
 */

import { CURRENT_SEASON, displayName } from '../data.js?v=595';
import { TEAM_KEYS, TEAM_PALETTE } from '../data/team-config.js?v=535';
import { squadraPreferita } from '../utils/preferenze.js?v=1';
import { getWeekSchedule, getCurrentNflWeek, canonAbbr } from '../data/nfl-schedule.js?v=552';
import { fetchLeagueWeek, teamAbbrFromName } from '../data/espn-fantasy.js?v=177';
import { fetchPlays } from '../data/nfl-plays.js?v=572';
import { getTeamIdentity } from '../data/nfl-teams.js?v=513';
import { ESPN_TEAM_IDS } from '../data/player-map.js?v=513';
import { statRingHTML } from '../ui/stat-ring.js?v=1';
import { playerImageService } from '../services/player-image-service.js?v=533';
import { montaLivello, effettoPer, sparaEffetto, fermaEffetti } from '../ui/live-fx.js?v=38';
import {
    partiteDiNotte, eDiNotte, eFresca, costruisciSequenza, intreccia, giocateDeiMiei,
    fattoreSupplementari, segnalibro, segnaViste, segnaTentativo, valeTentare,
} from '../data/night-recap.js?v=11';
import { ngsChartHTML, ngsLegendaHTML, ngsFasceHTML, bindNgsChart } from '../ui/ngs-chart.js?v=3';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const fmt = (n) => (+n).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const ridotto = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Quanto dura il replay: due minuti per i sessanta minuti regolamentari.
 *
 * È il tempo di TUTTO il replay, non di una partita: le gare della notte
 * scorrono insieme sullo stesso cronometro, quindi due partite non lo
 * raddoppiano — si dividono questo spazio. I supplementari lo allungano in
 * proporzione (`fattoreSupplementari`).
 */
const BUDGET_TOTALE = 120000;

let attivo = null;        // lo stato della riproduzione in corso
let overlay = null;

/* ============================================================
   1. IL SIPARIO — sincrono, prima che disegni qualunque cosa
   ============================================================ */

/**
 * Alza il sipario se vale la pena andare a vedere. Ritorna `true` se il
 * sipario è su: solo in quel caso ha senso chiamare `risolviNightRecap()`.
 *
 * Deve restare SINCRONA e senza rete: viene chiamata da `boot()` prima di
 * `navigate()`, e un solo `await` qui dentro basterebbe a far disegnare la
 * home col punteggio sotto il naso.
 */
export function alzaSipario() {
    if (overlay) return true;
    if (!squadraPreferita()) return false;
    if (!valeTentare()) return false;
    montaOverlay();
    return true;
}

/**
 * Monta il sipario, senza chiedersi se sia il caso.
 *
 * Niente "Last night": finché non si sa se c'è un replay, l'unico compito del
 * sipario è coprire la home e il suo punteggio, non annunciarne uno. Uno
 * "Last night" seguito da un rientro silenzioso nel sito si leggeva come un
 * replay promesso e non mantenuto — e infatti non lo era: era solo il tempo
 * di `raccogli()` per scoprire che stanotte non c'era nessun titolare in
 * campo. Restano solo lo spinner (un buco nero per uno o due secondi sembra
 * bloccato) e lo Skip, che qui non promette niente — è la via d'uscita se la
 * rete è lenta (`raccogli()` incatena più timeout da 8-12s). Appena i dati
 * arrivano, `riproduci()` sostituisce questo markup con la scena vera, oppure
 * `chiudi()` lo toglie senza che sia mai comparsa una parola.
 *
 * Staccato dai cancelli perché il banco di prova (`preview-night-recap.html`)
 * deve poter aprire la scena a comando: lì non c'è nessun risultato da
 * proteggere, e aspettare un martedì mattina per guardare un'animazione non è
 * un modo di lavorare.
 */
function montaOverlay() {
    overlay = document.createElement('div');
    overlay.className = 'nr-overlay nr-overlay--sipario';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-label', 'Loading');
    overlay.innerHTML = `
    <div class="nr-curtain">
        <div class="spinner"></div>
        <button type="button" class="nr-skip nr-skip--curtain">Skip</button>
    </div>`;
    document.body.appendChild(overlay);
    document.body.classList.add('nr-open');
    overlay.querySelector('.nr-skip')?.addEventListener('click', () => chiudi());
}

/** Abbassa il sipario e sgombra. `segna` = marca le partite come viste. */
function chiudi({ segna = [], prossimaFine = 0 } = {}) {
    removeEventListener('resize', adattaDensita);
    if (attivo) { attivo.spento = true; clearTimeout(attivo.timer); attivo = null; }
    fermaEffetti();
    if (segna.length) segnaViste(segna, prossimaFine);
    const el = overlay;
    overlay = null;
    document.body.classList.remove('nr-open');
    if (!el) return;
    el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 260, fill: 'forwards' })
        .onfinish = () => el.remove();
}

/* ============================================================
   2. I DATI — cosa c'è da rivedere
   ============================================================ */

/**
 * Le partite di notte non ancora riviste, coi miei titolari che ci giocavano.
 *
 * Si guardano DUE settimane, quella corrente e la precedente: aprendo il
 * martedì mattina dopo il Monday Night, ESPN può essere già passato alla week
 * dopo, e cercando solo in quella la partita di stanotte non esisterebbe.
 *
 * Ritorna anche `prossimaFine`: il momento in cui finisce la prossima partita
 * di notte ancora da giocare. È quello che il giorno dopo evita il sipario a
 * vuoto (vedi `valeTentare`).
 */
async function raccogli() {
    const chiave = squadraPreferita();
    if (!chiave) return null;

    const cur = await getCurrentNflWeek();
    if (!cur) return null;
    /*
     * Tre settimane, e ognuna per un motivo suo:
     *
     *   w-1  aprendo il martedi' mattina dopo il Monday Night, ESPN puo' essere
     *        gia' passato alla week dopo: cercando solo in quella, la partita
     *        di stanotte non esisterebbe;
     *   w    il caso normale;
     *   w+1  non per il replay — una settimana futura non ha partite concluse —
     *        ma per sapere QUANDO finisce la prossima partita di notte. Il
     *        mercoledi' la prossima e' il giovedi' della settimana dopo, e
     *        senza guardare là il cancello 3 non saprebbe cosa aspettare.
     */
    const settimane = [cur.week - 1, cur.week, cur.week + 1].filter(w => w >= 1 && w <= 18);
    const visti = new Set(segnalibro().visti);

    let prossimaFine = 0;
    const capitoli = [];

    for (const w of settimane) {
        const schedule = await getWeekSchedule(CURRENT_SEASON, w);
        if (!schedule) continue;

        /*
         * La prossima partita DI NOTTE ancora da giocare.
         *
         * Solo di notte, ed e' il punto: prendendo la prossima partita
         * qualunque, il venerdi' mattina `prossimaFine` sarebbe la domenica
         * pomeriggio, il cancello 3 si chiuderebbe fino a lì, e il replay del
         * Thursday Night non lo si sarebbe visto mai.
         */
        for (const g of schedule.values()) {
            if (!g?.eventId || g.state === 'post' || !g.end || !eDiNotte(g.start)) continue;
            const fine = g.end.getTime();
            if (fine > Date.now() && (!prossimaFine || fine < prossimaFine)) prossimaFine = fine;
        }

        /*
         * Le partite di notte mai viste, e ancora fresche.
         *
         * Le scadute (`stantie`) non si mostrano ma si segnano come viste: e'
         * il caso di un browser nuovo, dove il segnalibro e' vuoto e quindi
         * TUTTO risulta mai visto. Senza questo ramo si accumulerebbero e
         * ogni giorno il replay ripartirebbe da una partita di due settimane
         * fa; segnandole si chiude il conto una volta sola e in silenzio.
         */
        const mai = partiteDiNotte(schedule).filter(p => !visti.has(p.eventId));
        const notturne = mai.filter(p => eFresca(p.end));
        const stantie = mai.filter(p => !eFresca(p.end));
        if (stantie.length) segnaViste(stantie.map(p => p.eventId));
        if (!notturne.length) continue;

        // Le formazioni di QUELLA settimana. Il tabellone già caricato le dice
        // anche se la partita è cominciata, quindi si passa quello.
        let lega;
        try {
            lega = await fetchLeagueWeek(CURRENT_SEASON, w, schedule);
        } catch (e) {
            console.warn('[night-recap] formazioni non disponibili:', e.message);
            continue;
        }
        if (!lega?.drafted) continue;   // rose segnaposto: non sono di nessuno

        const mia = squadraMia(lega.matchups, chiave);
        if (!mia) continue;

        for (const partita of notturne) {
            const titolari = (mia.team.starters || []).filter(p => {
                const ab = canonAbbr(p.nfl_team || '') || teamAbbrFromName(p.name) || '';
                return ab === partita.home || ab === partita.away;
            });
            if (!titolari.length) continue;
            capitoli.push({ partita, titolari, week: w, mia });
        }
    }

    if (!capitoli.length) return { capitoli: [], prossimaFine };

    // Le partite in ordine di gioco: la nottata si racconta come è andata.
    capitoli.sort((a, b) => a.partita.start - b.partita.start);

    // Le giocate prima di tutto: il budget dipende da quanto sono durate le
    // partite, e non si sa finché non si sono lette.
    for (const cap of capitoli) {
        cap.giocate = await fetchPlays(cap.partita.eventId, { all: true });
    }

    /*
     * Il budget.
     *
     * I 120 secondi sono il tempo per coprire i 60 minuti di gioco, non il
     * tempo di una partita: le gare della notte scorrono INSIEME sullo stesso
     * cronometro (vedi `intreccia`), quindi due partite non raddoppiano la
     * durata — si dividono lo stesso spazio, e ogni passo dura la metà.
     *
     * I supplementari invece allungano: sono tempo di gioco in più, e
     * schiacciarli nello stesso spazio vorrebbe dire correre di più proprio
     * nel finale che uno vuole vedere. Dieci minuti di overtime valgono
     * 4200/3600, cioè venti secondi sui centoventi.
     */
    const fattore = fattoreSupplementari(capitoli.map(c => c.giocate));
    const budget = Math.floor((BUDGET_TOTALE * fattore) / capitoli.length);

    for (const cap of capitoli) {
        const chiE = agganciatore(cap.titolari);
        cap.sequenza = costruisciSequenza({
            giocate: cap.giocate,
            titolari: cap.titolari,
            chiE,
            siglaDi: siglaDaTeamId,
            budget,
            // Ogni azione della partita è un passo: si vede tutta la gara
            // scorrere, non solo i momenti dei miei.
            comprimiGiocate: false,
        });
        // Le stesse giocate, nella forma che serve al campo del riassunto.
        cap.giocateGrafico = giocateDeiMiei(cap.giocate, chiE);
    }

    // Un capitolo senza nemmeno un passo non ha niente da mostrare: capita se
    // ESPN non dà il play-by-play di quella partita. Resta comunque "visto",
    // altrimenti il sipario si rialzerebbe domani per la stessa gara.
    const buoni = capitoli.filter(c => c.sequenza?.passi?.length);
    return { capitoli: buoni, vuoti: capitoli.filter(c => !buoni.includes(c)), prossimaFine };
}

/** La sfida in cui gioca la squadra del cuore, dal suo punto di vista. */
function squadraMia(matchups, chiave) {
    for (const m of matchups) {
        for (const [lato, altro] of [['team1', 'team2'], ['team2', 'team1']]) {
            const t = m[lato];
            if (t && TEAM_KEYS[displayName(t.name)] === chiave) {
                return { team: t, opp: m[altro] || null };
            }
        }
    }
    return null;
}

/** id squadra ESPN → sigla, per sapere chi ha la palla in una giocata. */
let _perId = null;
function siglaDaTeamId(id) {
    if (!id) return '';
    if (!_perId) _perId = new Map(Object.entries(ESPN_TEAM_IDS).map(([ab, i]) => [String(i), ab]));
    return _perId.get(String(id)) || '';
}

/**
 * Da un contributo di `scorePlay` al mio titolare, o null.
 *
 * L'id ESPN è l'UNICA strada, e basta: il feed della lega e il play-by-play
 * usano lo stesso id atleta (vedi `espn_id` in espn-fantasy.js), quindi
 * l'agganciamento è esatto e prende anche i rookie — cosa che `PLAYER_ID_MAP`,
 * generata da dati vecchi, non fa.
 *
 * Non c'è nessun ripiego sul nome, e non è una dimenticanza: un contributo di
 * `scorePlay` porta l'id, non il nome, quindi per confrontare i nomi bisognerebbe
 * prima risolvere ogni id con una richiesta a testa (`resolveAthlete`). Non
 * serve: si arriva qui solo con `drafted` vero, cioè con le rose vere di ESPN,
 * dove `espn_id` c'è sempre. Le rose composte dalle scelte del draft non hanno
 * l'id — ed è il motivo per cui `raccogli()` esce prima se la lega non ha
 * draftato, invece di mostrare un replay con dei totali a zero.
 *
 * Le difese non hanno un id atleta: si riconoscono dalla squadra NFL che stava
 * difendendo in quella giocata.
 */
function agganciatore(titolari) {
    const perId = new Map();
    const perDifesa = new Map();
    for (const p of titolari) {
        const pos = (p.position_in_team || p.position || '').toUpperCase();
        if (pos === 'DEF' || pos === 'D/ST') {
            const ab = canonAbbr(p.nfl_team || '') || teamAbbrFromName(p.name) || '';
            const id = ESPN_TEAM_IDS[ab];
            if (id) perDifesa.set(String(id), p);
            continue;
        }
        if (p.espn_id) perId.set(String(p.espn_id), p);
    }
    return (c) => {
        if (c.defTeamId) return perDifesa.get(String(c.defTeamId)) || null;
        return perId.get(String(c.espnId)) || null;
    };
}

/* ============================================================
   3. LA SCENA
   ============================================================ */

/** Risolve i dati dietro al sipario e, se c'è qualcosa, riproduce. */
export async function risolviNightRecap() {
    if (!overlay) return;
    let esito = null;
    try {
        esito = await raccogli();
    } catch (e) {
        console.warn('[night-recap] niente replay:', e.message);
    }
    /*
     * Il tentativo di oggi è speso comunque, anche se la risoluzione è andata
     * storta: senza questo, un'API che non risponde farebbe rialzare il
     * sipario a ogni ricarica della pagina per tutta la giornata.
     *
     * `prossimaFine` invece si registra SOLO se non c'è niente da rivedere. Se
     * un replay c'è, lo registrerà `segnaViste` quando il replay sarà finito:
     * scrivendolo adesso, chi chiude la pagina a metà troverebbe il cancello 3
     * chiuso fino alla prossima partita di notte, e quel replay se lo sarebbe
     * perso in silenzio.
     */
    const niente = !esito?.capitoli?.length;
    segnaTentativo(niente ? (esito?.prossimaFine || 0) : 0);

    if (!overlay) return;                        // già chiuso a mano nel frattempo
    if (niente) {
        chiudi({ segna: (esito?.vuoti || []).map(c => c.partita.eventId) });
        return;
    }
    riproduci(esito.capitoli,
        [...esito.capitoli, ...(esito.vuoti || [])].map(c => c.partita.eventId),
        esito.prossimaFine || 0);
}

/** Il replay dall'inizio: un capitolo per partita. */
function riproduci(capitoli, daSegnare, prossimaFine = 0, opz = {}) {
    /*
     * Le partite della notte si vedono INSIEME, non una dopo l'altra: un
     * pannello per gara, impilati, e una linea del tempo sola che le fa
     * camminare allo stesso passo (`intreccia` in data/night-recap.js).
     */
    const linea = intreccia(capitoli.map(c => c.sequenza));
    attivo = {
        capitoli, daSegnare, prossimaFine, linea,
        passo: 0, trascorso: 0, durata: linea.durata,
        spento: false, timer: null,
        manuale: !!opz.manuale, onPasso: opz.onPasso || null,
    };

    overlay.classList.remove('nr-overlay--sipario');
    overlay.innerHTML = scenaHTML(capitoli);
    overlay.querySelector('.nr-skip')?.addEventListener('click', () => fine());
    overlay.querySelector('.nr-palco')?.addEventListener('click', () => pausa());
    document.addEventListener('keydown', tasti);

    /* L'ultimo passo di ciascuna partita nella linea intrecciata: serve a
       sapere quando quel pannello ha finito e va messo su FINAL mentre
       l'altro sta ancora giocando. */
    capitoli.forEach((c, i) => {
        c.ultimoPasso = linea.passi.reduce((u, p, k) => (p.gioco === i ? k : u), -1);
    });
    capitoli.forEach((c, i) => preparaPannello(c, i));
    /*
     * La densità si misura più volte, non una.
     *
     * Al montaggio i pannelli sono ancora vuoti: le foto non sono arrivate e
     * gli anelli non hanno testo, quindi il palco non sborda e la misura dice
     * "ci stanno". Poi il contenuto cresce e la terza partita finisce sotto il
     * bordo — visto: 34px di troppo con tre gare, e nessuna riga compatta
     * perché al momento del controllo non servivano ancora.
     */
    rimisuraDensita();
    addEventListener('resize', adattaDensita);
    avanza();
}

function tasti(e) {
    if (!attivo) return;
    if (e.key === 'Escape') fine();
    if (e.key === ' ') { e.preventDefault(); pausa(); }
}

/** A replay finito (o saltato) si va alla home, col risultato ormai noto. */
function fine() {
    const segna = attivo?.daSegnare || [];
    const prossimaFine = attivo?.prossimaFine || 0;
    document.removeEventListener('keydown', tasti);
    chiudi({ segna, prossimaFine });
}

function pausa() {
    if (!attivo) return;
    attivo.inPausa = !attivo.inPausa;
    overlay?.classList.toggle('nr-pausa', attivo.inPausa);
    if (!attivo.inPausa) avanza();
    else clearTimeout(attivo.timer);
}

function scenaHTML(capitoli) {
    return `
    <div class="nr-show nr-show--${capitoli.length}">
        <header class="nr-head">
            <span class="nr-chapter" data-nr-chapter></span>
            <button type="button" class="nr-skip">Skip</button>
        </header>
        <div class="nr-palco">
            ${capitoli.map((_, i) => `
            <section class="nr-game" data-nr-game="${i}">
                <div class="nr-board" data-nr-board></div>
                <div class="nr-stage live-stage" data-nr-stage>
                    <div class="nr-players" data-nr-players></div>
                </div>
                <p class="nr-play" data-nr-play></p>
            </section>`).join('')}
        </div>
        <footer class="nr-foot">
            <div class="nr-total" data-nr-total></div>
            ${lineaHTML()}
        </footer>
    </div>`;
}

/**
 * La linea del TEMPO DI GARA, con le tacche dei quarti.
 *
 * Prima era una barra di avanzamento e basta: un rettangolo che si riempiva
 * sotto il nome della squadra, senza dire di cosa. Adesso dice a che punto
 * della partita si è — che è l'informazione che uno cerca guardando lì — e i
 * quattro quarti la rendono leggibile senza etichetta.
 */
function lineaHTML() {
    return `
    <div class="nr-linea" aria-hidden="true">
        ${[1, 2, 3, 4].map(q => `<span class="nr-q"><i>Q${q}</i></span>`).join('')}
        <span class="nr-linea-fatta" data-nr-linea></span>
        <span class="nr-linea-ora" data-nr-ora></span>
    </div>`;
}

/**
 * Prepara il pannello di UNA partita: intestazione, tabellone, giocatori.
 *
 * Non fa partire niente — con più partite in contemporanea il motore è uno
 * solo e vive fuori di qui (`avanza`). Questo disegna e basta.
 */
function preparaPannello(cap, i) {
    if (!overlay) return;
    const { partita, titolari, week } = cap;

    // Il pannello riparte da zero: i punti li rimette il replay, giocata per
    // giocata. Il totale ufficiale non si scrive mai a schermo prima del tempo.
    cap.correnti = new Map(titolari.map(p => [p.name, 0]));
    cap.statistiche = new Map(titolari.map(p => [p.name, {}]));

    const pan = pannello(i);
    const via = getTeamIdentity(partita.away), casa = getTeamIdentity(partita.home);
    const q = (sel) => pan.querySelector(sel);

    q('[data-nr-board]').innerHTML = `
        <div class="nr-side" style="--nfl:${via?.color || '#555'}" data-nr-lato="${esc(partita.away)}">
            <span class="nr-poss" aria-hidden="true">▶</span>
            <span class="nr-abbr">${esc(partita.away)}</span>
            <span class="nr-nfl" data-nr-away>0</span>
        </div>
        <div class="nr-mid">
            <span class="nr-clock" data-nr-clock></span>
            <span class="nr-dd" data-nr-dd></span>
        </div>
        <div class="nr-side nr-side--home" style="--nfl:${casa?.color || '#555'}" data-nr-lato="${esc(partita.home)}">
            <span class="nr-nfl" data-nr-home>0</span>
            <span class="nr-abbr">${esc(partita.home)}</span>
            <span class="nr-poss" aria-hidden="true">◀</span>
        </div>`;

    q('[data-nr-players]').innerHTML = titolari.map(cardHTML).join('');

    // L'intestazione è una sola per tutto il replay: con più partite dice la
    // settimana, non i nomi delle squadre — quelli stanno già nei tabelloni.
    const testa = overlay.querySelector('[data-nr-chapter]');
    if (testa && i === 0) {
        testa.textContent = attivo.capitoli.length > 1
            ? `Week ${week} · ${attivo.capitoli.length} night games`
            : `Week ${week} · ${via?.name || partita.away} at ${casa?.name || partita.home}`;
    }
    if (i === 0) {
        const tinta = TEAM_PALETTE[squadraPreferita()]?.bright || '#fff';
        overlay.querySelector('[data-nr-total]').innerHTML =
            `<span class="nr-team">${esc(displayName(cap.mia.team.name))}</span>`
            + `<b class="nr-pts" style="color:${tinta}"><span class="pts-val">0.0</span></b>`;
        attivo.clockSec = null;
        attivo.clockPeriodo = null;
    }

    idrataFoto(pan);
}

/* ============================================================
   LA SCHERMATA FINALE
   ============================================================ */

/**
 * A partite finite: il punteggio della sfida, ogni giocata dei titolari su un
 * campo solo, e la porta per entrare nel sito.
 *
 * Il replay finora ha raccontato la serata; qui si tirano le somme. Non si
 * chiude da solo: da qui si esce col pulsante, perché è l'ultima cosa che si
 * guarda e nessuno vuole vedersela sparire sotto gli occhi.
 */
function mostraRiassunto() {
    if (!attivo || !overlay || attivo.riassuntoAperto) return;
    attivo.riassuntoAperto = true;
    fermaEffetti();
    removeEventListener('resize', adattaDensita);

    const capitoli = attivo.capitoli;
    const mia = capitoli[0]?.mia;
    const nomi = [];
    const punti = new Map();
    const giocate = [];
    for (const cap of capitoli) {
        giocate.push(...(cap.giocateGrafico || []));
        for (const p of cap.titolari) {
            if (!nomi.includes(p.name)) nomi.push(p.name);
            punti.set(p.name, (punti.get(p.name) || 0) + (cap.correnti?.get(p.name) || 0));
        }
    }
    const mioTot = [...punti.values()].reduce((s, v) => s + v, 0);

    const tinta = TEAM_PALETTE[squadraPreferita()]?.bright || '#fff';
    const grafico = ngsChartHTML(giocate, nomi);

    overlay.querySelector('.nr-show')?.remove();
    const el = document.createElement('div');
    el.className = 'nr-fine';
    el.innerHTML = `
        <header class="nr-fine-testa">
            <span class="nr-fine-kick">Last night · your starters</span>
        </header>
        ${sfidaHTML(mia, mioTot, tinta)}
        ${grafico ? `
        <div class="nr-fine-campo">
            ${grafico}
            <div class="nr-legenda">${ngsLegendaHTML(giocate, nomi, punti)}</div>
            ${ngsFasceHTML()}
            <p class="nr-fine-nota">
                Tap a player to see only his plays, coloured by yards gained.
                <b>Length and direction are real.</b> Route shapes are illustrative —
                ESPN publishes no tracking data.
            </p>
        </div>` : '<p class="nr-fine-nota">No plays to chart.</p>'}
        <button type="button" class="nr-home">Go to the site</button>`;
    overlay.appendChild(el);
    el.querySelector('.nr-home')?.addEventListener('click', vaiAlSito);
    bindNgsChart(el);
}

/**
 * Il punteggio della sfida.
 *
 * L'avversario si mostra col suo totale VERO di giornata e con quanti
 * titolari deve ancora scendere in campo: dopo il Thursday Night è quasi
 * sempre a zero con nove da giocare, e quello zero senza avviso sembrerebbe
 * una vittoria schiacciante invece di una giornata appena cominciata.
 */
function sfidaHTML(mia, mioTot, tinta) {
    const opp = mia?.opp;
    const daGiocare = (opp?.starters || []).filter(p => p.game_state !== 'post').length;
    const oppTot = Number.parseFloat(opp?.score) || 0;
    return `
    <div class="nr-sfida">
        <div class="nr-sfida-lato">
            <span class="nr-sfida-nome">${esc(displayName(mia?.team?.name || ''))}</span>
            <b class="nr-sfida-pts" style="color:${tinta}">${mioTot.toFixed(1)}</b>
            <span class="nr-sfida-sotto">tonight</span>
        </div>
        <span class="nr-sfida-vs">vs</span>
        <div class="nr-sfida-lato nr-sfida-lato--opp">
            <span class="nr-sfida-nome">${esc(opp ? displayName(opp.name) : '—')}</span>
            <b class="nr-sfida-pts">${opp ? oppTot.toFixed(1) : '—'}</b>
            <span class="nr-sfida-sotto">${opp
        ? (daGiocare ? `${daGiocare} still to play` : 'week done')
        : ''}</span>
        </div>
    </div>`;
}

/** Dal riassunto al sito, col replay segnato come visto. */
function vaiAlSito() {
    const segna = attivo?.daSegnare || [];
    const prossimaFine = attivo?.prossimaFine || 0;
    document.removeEventListener('keydown', tasti);
    chiudi({ segna, prossimaFine });
    if (typeof location !== 'undefined' && !location.hash) location.hash = '#home';
}

/** Il pannello di una partita. */
const pannello = (i) => overlay?.querySelector(`[data-nr-game="${i}"]`);

/**
 * Cerchi o righe?
 *
 * Non si conta il numero di partite ma quanto spazio resta a testa: tre gare
 * con un giocatore ciascuna stanno benissimo a cerchi, due gare da cinque
 * titolari no. Se la fetta che tocca a un giocatore scende sotto il minimo
 * leggibile — sotto cui l'anello delle statistiche diventa illeggibile — il
 * pannello passa alle righe, come il confronto del Live: foto piccola, nome,
 * statistiche in colonna, punti.
 *
 * Si misura a schermo e si rifà al ridimensionamento: dipende dalla larghezza
 * vera, non dal dispositivo.
 */
const LARG_MIN_CERCHIO = 104;

/** Rimisura la densità mentre il contenuto si assesta (foto, anelli, punti). */
function rimisuraDensita() {
    adattaDensita();
    for (const ms of [0, 250, 900, 2000]) setTimeout(() => { if (attivo) adattaDensita(); }, ms);
}

function adattaDensita() {
    if (!overlay || !attivo) return;
    const palco = overlay.querySelector('.nr-palco');
    if (!palco) return;
    const tutti = attivo.capitoli.map((_, i) => pannello(i)).filter(Boolean);

    // Si riparte sempre dai cerchi: la densità si decide sulla misura di
    // adesso, non su quella dell'ultima volta.
    for (const pan of tutti) pan.classList.remove('nr-game--righe');

    /*
     * Due vincoli, e il secondo è quello che morde davvero.
     *
     * In LARGHEZZA: la fetta che tocca a un giocatore non può scendere sotto
     * il minimo leggibile, o l'anello delle statistiche diventa illeggibile.
     *
     * In ALTEZZA: impilando i pannelli, tre partite da tre titolari non ci
     * stanno più nello schermo — visto, la terza finiva sotto il totale. Si
     * misura se il palco sborda e in quel caso si passa alle righe, che sono
     * il modo di tenere TUTTE le partite a schermo invece di perderne una.
     */
    const stretto = attivo.capitoli.some((cap, i) => {
        const zona = tutti[i]?.querySelector('[data-nr-players]');
        if (!zona) return false;
        return zona.clientWidth / Math.min(Math.max(1, cap.titolari.length), 3) < LARG_MIN_CERCHIO;
    });
    const sborda = () => palco.scrollHeight > palco.clientHeight + 4;

    const show = overlay.querySelector('.nr-show');
    show?.classList.remove('nr-show--fitto');
    if (stretto || sborda()) for (const pan of tutti) pan.classList.add('nr-game--righe');

    /*
     * Secondo livello, se anche a righe non ci sta.
     *
     * Non si indovinano i pixel: si guarda se sborda ANCORA e in quel caso si
     * toglie il testo dell'azione dai pannelli. È la cosa più giusta da
     * sacrificare: con tre partite ci sono tre righe di cronaca sovrapposte,
     * mentre le statistiche accanto a ogni nome dicono già cosa è successo. La
     * priorità è tenere tutte le partite a schermo.
     */
    if (sborda()) show?.classList.add('nr-show--fitto');
}

/**
 * Un giocatore: il CERCHIO con le statistiche attorno, come sul campo del Live.
 *
 * Non è più un riquadro. L'anello (`ui/stat-ring.js`, lo stesso modulo che
 * disegna il campo) scrive le sei voci del ruolo lungo il bordo della foto, e
 * sotto restano nome e punti — che è quello che si guarda al volo. Le
 * statistiche però sono QUELLE DEL REPLAY: si riempiono giocata per giocata,
 * non arrivano dal feed della lega.
 *
 * Le classi `formation-slot live-slot` restano: da lì vengono l'anello
 * arancione del possesso, il rosso della red zone e il faro della festa, che
 * non vanno riscritti. Il numero dei punti sta nel suo `.pts-val` perché il
 * conteggio che sale scrive lì dentro.
 */
function cardHTML(p) {
    const role = (p.position_in_team || p.position || '').toUpperCase();
    return `
    <div class="formation-slot live-slot nr-card" data-nr-player="${esc(p.name)}">
        <span class="slot-photo"><img src="images/fallback-player.svg" alt=""
            data-nr-photo data-player-name="${esc(p.name)}" data-team="${esc(p.nfl_team || '')}" data-pos="${esc(role)}"></span>
        <span class="live-slot-stats live-slot-stats--ring" data-nr-stats>${statRingHTML({}, role)}</span>
        <span class="slot-name"><span class="nr-pos">${esc(role)}</span>${esc(shortName(p.name))}</span>
        <span class="slot-pts nr-slot-pts"><span class="pts-val">0.0</span></span>
    </div>`;
}

const shortName = (n) => {
    const parti = String(n || '').split(' ');
    return parti.length < 2 ? n : `${parti[0][0]}. ${parti.slice(1).join(' ')}`;
};

function idrataFoto(root) {
    root.querySelectorAll('img[data-nr-photo]').forEach(img => {
        img.onerror = () => { if (!img.src.endsWith('fallback-player.svg')) img.src = 'images/fallback-player.svg'; };
        playerImageService
            .getPlayerImageUrl(img.dataset.playerName, img.dataset.team, img.dataset.pos, CURRENT_SEASON)
            .then(url => { if (url) img.src = url; })
            .catch(() => { });
    });
}

/* ============================================================
   4. IL MOTORE — un passo alla volta
   ============================================================ */

/**
 * Manda in scena il passo corrente e si riprogramma per il prossimo.
 *
 * Un `setTimeout` per passo invece di un ciclo su `requestAnimationFrame`: il
 * tempo di ogni passo lo decide la sequenza (`dwell`), non il disegno, e la
 * pausa deve poter fermare tutto senza tenere conto di dove fosse arrivato un
 * fotogramma. Finito l'ultimo passo del capitolo si passa al successivo, e
 * finiti i capitoli si chiude.
 */
function avanza() {
    if (!attivo || attivo.spento || attivo.inPausa || !overlay) return;
    const passo = attivo.linea.passi[attivo.passo];

    if (!passo) {
        // Finita la partita non si chiude: si apre il riassunto, e da lì si
        // entra nel sito col pulsante.
        if (!attivo.riassuntoAperto) attivo.timer = setTimeout(mostraRiassunto, 1200);
        return;
    }

    // `gioco` è null solo per lo stacco di fine quarto, che vale per tutte.
    const cap = passo.gioco == null ? null : attivo.capitoli[passo.gioco];
    mostra(cap, passo);
    orologiGlobali(passo);
    attivo.onPasso?.({
        cap: passo.gioco ?? 0, i: attivo.passo, tot: attivo.linea.passi.length, passo,
    });
    attivo.passo++;
    attivo.trascorso += passo.dwell;
    linea(passo);
    if (!attivo.manuale) attivo.timer = setTimeout(avanza, passo.dwell);
}

/**
 * La linea del tempo di gara: l'indicatore cammina sui quarti.
 *
 * Non è l'avanzamento del replay ma il TEMPO DI GIOCO, che è quello che uno
 * cerca guardando lì. Coi quarti segnati si legge senza etichetta.
 */
function linea(passo) {
    const fatta = overlay?.querySelector('[data-nr-linea]');
    const ora = overlay?.querySelector('[data-nr-ora]');
    if (!fatta) return;
    // Quota di partita giocata: quattro quarti da 900 secondi.
    const q = Math.min(4, Math.max(1, passo.periodo || 1));
    const sec = secondiDa(passo.clock);
    const giocato = passo.kind === 'assesta'
        ? 3600
        : (q - 1) * 900 + (sec == null ? 0 : 900 - sec);
    const pct = Math.min(100, Math.max(0, (giocato / 3600) * 100));
    fatta.style.width = `${pct.toFixed(1)}%`;
    if (ora) ora.style.left = `${pct.toFixed(1)}%`;
}

/**
 * Un passo a schermo: tabellone, bagliori, punti, statistiche, festa.
 *
 * Tutte le ricerche nel DOM sono ristrette al PANNELLO della sua partita: con
 * due gare in contemporanea ci sono due tabelloni e due campi, e un
 * `querySelector` sull'intero overlay aggiornerebbe sempre il primo.
 */
function mostra(cap, passo) {
    const pan = passo.gioco == null ? overlay : pannello(passo.gioco);
    const q = (s) => pan?.querySelector(s) || null;
    if (passo.kind === 'quarto') { cartelloQuarto(passo); return; }
    if (!cap || !pan) return;

    // ── Il tabellone NFL vero, che sale col replay ──────────────────────
    // Il conteggio non dura mai piu' del passo: su una giocata veloce un
    // numero che sale per 700ms finirebbe dopo che la scena e' gia' cambiata.
    const salita = Math.min(700, Math.max(120, passo.dwell * 0.6));
    contaSu(q('[data-nr-away]'), passo.away, 0, salita);
    contaSu(q('[data-nr-home]'), passo.home, 0, salita);
    /*
     * La festa si decide per prima: serve a tre cose in questo stesso passo —
     * fermare il cronometro, scegliere chi NON riceve l'etichetta piccola, e
     * far partire gli effetti.
     */
    const festa = passo.cambi.length ? accorcia(effettoPer({ changes: passo.cambi })) : null;
    const protagonista = festa
        ? [...passo.tocchi].sort((a, b) => Math.abs(b.pts) - Math.abs(a.pts))[0]?.nome
        : null;

    dirigiTabellone(pan, passo);

    // ── Il testo dell'azione ────────────────────────────────────────────
    /*
     * ── Il testo dell'azione ────────────────────────────────────────────
     *
     * Si scrive SOLO quando c'e' dentro un mio giocatore. Il resto della
     * partita si legge dal tabellone — punteggio, down, posizione — e una
     * riga su un'azione che non mi riguarda toglie l'occhio proprio da li'.
     * I blocchi compressi continuano a dire quante giocate stanno passando:
     * e' un conteggio, non il racconto di un'azione.
     */
    const play = q('[data-nr-play]');
    const mia = passo.tocchi.length > 0;
    // Stretti (tre partite, o due con tante maglie) la cronaca si riassume:
    // il testo di ESPN sarebbe due o tre righe per pannello.
    const stretti = overlay.querySelector('.nr-show')?.classList.contains('nr-show--fitto');
    play.classList.toggle('nr-play--salto', passo.kind === 'salta');
    play.textContent = passo.kind === 'salta'
        ? `${passo.saltate} play${passo.saltate > 1 ? 's' : ''}`
        : (mia ? (stretti ? riassunto(passo.tocchi) : passo.testo) : '');

    // ── Chi ha la palla: arancione, e rosso in red zone ─────────────────
    // Stessa lettura del Live (`inCampoOra`/`inRedZoneOra`): si accende tutta
    // la squadra che attacca, e una difesa al contrario — scende in campo
    // quando la palla ce l'hanno gli altri.
    for (const p of cap.titolari) {
        const card = q(`[data-nr-player="${CSS.escape(p.name)}"]`);
        if (!card) continue;
        const ab = canonAbbr(p.nfl_team || '') || teamAbbrFromName(p.name) || '';
        const role = (p.position_in_team || p.position || '').toUpperCase();
        const suaPalla = !!passo.attacco && passo.attacco === ab;
        const inCampo = passo.kind === 'assesta' ? false
            : (role === 'DEF' || role === 'D/ST') ? (!!passo.attacco && !suaPalla) : suaPalla;
        card.classList.toggle('live-slot--redzone', inCampo && passo.redZone);
        card.classList.toggle('live-slot--onball', inCampo && !passo.redZone);
    }

    // ── I punti e le statistiche dei miei ───────────────────────────────
    for (const t of passo.tocchi) {
        const card = q(`[data-nr-player="${CSS.escape(t.nome)}"]`);
        if (!card) continue;

        const stat = cap.statistiche.get(t.nome) || {};
        for (const [k, v] of Object.entries(t.stats || {})) if (v) stat[k] = (stat[k] || 0) + v;
        cap.statistiche.set(t.nome, stat);
        const anello = card.querySelector('[data-nr-stats]');
        if (anello) anello.innerHTML = statRingHTML(stat, ruoloDi(cap, t.nome));

        const da = cap.correnti.get(t.nome) || 0;
        const a = +(da + t.pts).toFixed(2);
        cap.correnti.set(t.nome, a);
        if (t.pts) {
            // I punti escono prima accanto al giocatore, poi il totale li
            // assorbe salendo: è la coreografia del Live (`popPoints` →
            // `countUp`), stretta nel tempo di un passo invece dei dieci
            // secondi di là. Su un blocco compresso l'etichetta non c'è — sono
            // più giocate insieme, e non c'è una singola azione da annunciare.
            const breve = Math.min(900, passo.dwell * 0.55);
            // L'etichetta la prendono TUTTI, protagonista compreso: è lo
            // stesso numero grosso e luminoso del touchdown, sempre accanto
            // alla sua card. Prima il protagonista riceveva invece quello di
            // `live-fx`, che vive nel livello degli effetti e finiva a mezzo
            // schermo di distanza da chi l'aveva segnato.
            if (passo.kind !== 'salta') etichetta(card, t.pts, passo.dwell, t.nome === protagonista);
            contaSu(card.querySelector('.nr-slot-pts'), a, 1, breve);
        }
    }
    if (passo.tocchi.length) totale(cap, Math.min(1100, passo.dwell * 0.7));

    // ── La festa, con gli effetti del Live ──────────────────────────────
    if (festa && protagonista) festeggia(pan, festa, protagonista, passo.dwell);
}

/**
 * Il cronometro è UNO e vale per tutte le partite a schermo.
 *
 * Le gare camminano sullo stesso tempo di gioco (vedi `intreccia`), quindi il
 * cronometro va aggiornato su OGNI pannello a ogni passo — non solo su quello
 * che si è appena mosso. Tenendolo per pannello, la partita ferma restava
 * all'orario della sua ultima giocata: misurato, due cronometri a schermo con
 * quattro minuti di scarto fra loro, che è esattamente la cosa che guardarle
 * insieme dovrebbe evitare.
 *
 * Una partita che ha esaurito i suoi passi passa a FINAL mentre l'altra
 * continua: è quello che succede davvero quando una finisce prima.
 */
function orologiGlobali(passo) {
    if (!attivo || !overlay) return;
    const festa = passo.cambi?.length && passo.kind !== 'salta';
    for (const [i, cap] of attivo.capitoli.entries()) {
        const pan = pannello(i);
        if (!pan) continue;
        if (attivo.passo > cap.ultimoPasso) {
            const el = pan.querySelector('[data-nr-clock]');
            if (el) { el.textContent = 'FINAL'; el.classList.remove('is-fermo'); }
            continue;
        }
        // Si congela solo il pannello dove sta succedendo la festa: le altre
        // partite continuano a scorrere, perché lì il gioco non si è fermato.
        orologio(pan, passo, !!festa && passo.gioco === i);
    }
}

/**
 * Il cronometro che SCORRE, invece di saltare da una giocata all'altra.
 *
 * Il play-by-play dà l'ora d'inizio di ogni azione: mostrandola e basta, il
 * cronometro sta fermo per tutto il passo e poi fa un salto. Qui il numero di
 * partenza è quello dove eravamo rimasti e ci si arriva scendendo, dentro il
 * tempo del passo — che è come si comporta un cronometro vero.
 *
 * Tre casi in cui NON si scende e si scrive e basta: il primo passo (non c'è
 * un "prima"), il cambio di quarto (l'orologio risale a 15:00, e animarlo
 * all'indietro sarebbe assurdo) e l'assestamento, che è fuori dalla partita.
 */
function orologio(pan, passo, congela = false) {
    const el = pan?.querySelector('[data-nr-clock]');
    if (!el) return;
    el.classList.toggle('is-fermo', congela);
    if (passo.kind === 'assesta') { el.textContent = 'FINAL'; return; }

    const a = secondiDa(passo.clock);
    const q = passo.periodo;
    const scrivi = (sec) => {
        el.textContent = [q ? `Q${q}` : '', sec == null ? passo.clock : mmss(sec)]
            .filter(Boolean).join(' · ');
    };

    /*
     * Un quarto nuovo comincia da 15:00 e SCENDE fino alla prima azione, non
     * compare gia' a 13:43 perche' li' capita la prima giocata non compressa.
     * L'orologio non si ferma all'intervallo: riparte da capo, e vederlo
     * ripartire da capo e' mezzo il senso del cartello che lo precede.
     * (I supplementari partono da 10:00.)
     */
    /* Lo stato dell'orologio sta sul PANNELLO, non sul replay: due partite in
       contemporanea hanno due cronometri, e tenendone uno solo il secondo
       ripartiva sempre da dove era arrivato il primo. */
    const nuovoQuarto = pan.dataset.clockQ !== String(q);
    const da = nuovoQuarto ? (q >= 5 ? 600 : 900) : Number(pan.dataset.clockSec);
    pan.dataset.clockQ = String(q);
    pan.dataset.clockSec = String(a);

    if (a == null || da == null || a > da || ridotto()) { scrivi(a); return; }

    /*
     * Col congelamento l'orologio corre solo per il tratto dell'AZIONE — un
     * quarto del passo — e poi resta fermo per tutta la festa, come in
     * diretta: dopo un touchdown, un fumble o un intercetto il cronometro è
     * spento. Riparte al passo dopo, che comincia da dove l'aveva lasciato.
     * Senza, il tempo scorreva sotto i coriandoli e la festa sembrava
     * succedere mentre si giocava.
     */
    const ms = congela
        ? Math.max(200, Math.min(600, passo.dwell * 0.25))
        : Math.max(200, passo.dwell * 0.9);
    const t0 = performance.now();
    /* Il gettone sta sul PANNELLO e non è globale: con due partite in
       contemporanea un gettone solo faceva fermare il cronometro della prima
       ogni volta che partiva quello della seconda. */
    const mio = String(++_genClock);
    pan.dataset.clockGen = mio;
    const step = (ora) => {
        if (!attivo || attivo.spento || pan.dataset.clockGen !== mio) return;
        const k = Math.min(1, (ora - t0) / ms);
        scrivi(Math.round(da + (a - da) * k));   // lineare: un orologio non decelera
        if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
}
let _genClock = 0;

const secondiDa = (c) => {
    const m = String(c || '').match(/^(\d+):(\d{2})$/);
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};
const mmss = (s) => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.max(0, s) % 60).padStart(2, '0')}`;

/**
 * Down, distanza, punto del campo e la freccia del possesso — la riga che in
 * TV sta sotto al punteggio. Vuota quando non si sa di chi è la palla (lo
 * stacco di fine quarto, l'assestamento): meglio niente che un "1st & 10"
 * rimasto lì dal passo prima.
 */
function dirigiTabellone(pan, passo) {
    const dd = pan?.querySelector('[data-nr-dd]');
    if (dd) {
        const conta = passo.down != null && passo.distanza != null;
        const ord = { 1: '1st', 2: '2nd', 3: '3rd', 4: '4th' }[passo.down] || '';
        const quanto = passo.goal ? 'Goal' : passo.distanza;
        dd.textContent = conta && ord
            ? [`${ord} & ${quanto}`, passo.campo].filter(Boolean).join('  ·  ')
            : '';
    }
    for (const lato of pan?.querySelectorAll('[data-nr-lato]') || []) {
        lato.classList.toggle('ha-palla', !!passo.attacco && lato.dataset.nrLato === passo.attacco);
    }
}

/** Lo stacco di fine quarto: il campo si abbassa e resta il cartello. */
function cartelloQuarto(passo) {
    const show = overlay?.querySelector('.nr-palco');
    if (!show) return;
    show.querySelector('.nr-quarto')?.remove();
    const el = document.createElement('div');
    el.className = 'nr-quarto';
    el.innerHTML = `<b>${esc(passo.testo)}</b>`;
    show.appendChild(el);
    setTimeout(() => {
        el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 320, fill: 'forwards' })
            .onfinish = () => el.remove();
    }, Math.max(400, passo.dwell - 320));
}

/**
 * La giocata in due parole: chi, e cosa ha fatto.
 *
 * Serve quando lo spazio si stringe (tre partite, o due con tante maglie): là
 * il testo integrale di ESPN sono due o tre righe per pannello, e tre pannelli
 * di cronaca non si leggono comunque. Non si taglia la frase di ESPN — anche
 * tagliata resta lunga — si ricostruisce dalle STATISTICHE che il passo porta
 * già con sé, che è l'unico modo di stare in una riga sempre.
 *
 * Il protagonista è chi ha mosso più punti: su un passaggio da touchdown sono
 * in due, e quello che conta è chi l'ha segnato.
 */
function riassunto(tocchi) {
    const t = [...tocchi].sort((a, b) => Math.abs(b.pts) - Math.abs(a.pts))[0];
    if (!t) return '';
    const s = t.stats || {};
    const n = (k) => Math.round(s[k] || 0);
    const cognome = String(t.nome).split(' ').slice(1).join(' ') || t.nome;
    const td = (k) => (s[k] || 0) > 0 ? 'TD ' : '';

    let cosa = '';
    if (s.rec) cosa = `${n('rec_yds')} yd ${td('rec_td')}catch`;
    else if (s.rush_att) cosa = `${n('rush_yds')} yd ${td('rush_td')}run`;
    else if (s.fg_made) cosa = `${n('fg_att') ? '' : ''}field goal`;
    else if (s.pat_made) cosa = 'extra point';
    else if (s.pass_int) cosa = 'intercepted';
    else if (s.fum_lost) cosa = 'fumble lost';
    else if (s.def_int) cosa = 'interception';
    else if (s.sack) cosa = 'sack';
    else if (s.ret_td || s.def_td) cosa = 'TD';
    else if (s.pass_att) cosa = `${n('pass_yds')} yd ${td('pass_td')}pass`;
    else if (s.targets) cosa = 'target';
    return cosa ? `${cognome} · ${cosa}` : cognome;
}

/** Il ruolo di un titolare, per sapere quali sei voci mettere sull'anello. */
function ruoloDi(cap, nome) {
    const p = cap.titolari.find(x => x.name === nome);
    return (p?.position_in_team || p?.position || '').toUpperCase();
}

/** Il totale di squadra: la somma dei titolari mostrati, non un numero a parte. */
function totale(cap, ms) {
    const el = overlay?.querySelector('[data-nr-total] .nr-pts');
    if (!el) return;
    /* La somma è su TUTTE le partite: il punteggio della squadra fantasy è uno
       solo, e con due gare in contemporanea i suoi titolari stanno di qua e di
       là. Sommando il solo pannello che si è appena mosso, il totale
       ballerebbe fra i due parziali. */
    const somma = attivo.capitoli.reduce(
        (s, c) => s + [...(c.correnti?.values() || [])].reduce((a, v) => a + v, 0), 0);
    contaSu(el, somma, 1, ms);
}

/**
 * Il numero sale invece di cambiare di colpo.
 *
 * Scrive sempre dentro `.pts-val` quando c'è, come nel Live: quel figlio esiste
 * proprio perché il conteggio non cancelli quello che gli sta accanto.
 */
let _gen = 0;
function contaSu(el, a, decimali = 1, ms = 700) {
    if (!el) return;
    const num = el.querySelector('.pts-val') || el;
    const scrivi = (v) => { num.textContent = decimali ? fmt(v) : String(Math.round(v)); };
    const da = parseFloat(num.textContent) || 0;
    /*
     * Ogni conteggio marca l'elemento con un gettone, e si ferma se nel
     * frattempo qualcun altro l'ha marcato.
     *
     * Senza, due conteggi sullo stesso numero vanno avanti INSIEME e se lo
     * scrivono a vicenda a ogni fotogramma: il numero balla fra due valori
     * invece di salire. Con i passi lunghi non si vedeva — 700ms di
     * animazione dentro 1,5s di passo — ma basta una giocata veloce
     * (`DWELL.passa`, e i blocchi compressi al pavimento) e i due si
     * accavallano.
     */
    const mio = ++_gen;
    num.dataset.gen = String(mio);
    if (da === a || ridotto() || !ms) { scrivi(a); return; }
    const t0 = performance.now();
    const step = (ora) => {
        if (!attivo || attivo.spento) return;
        if (num.dataset.gen !== String(mio)) return;   // superato da un conteggio piu' nuovo
        const k = Math.min(1, (ora - t0) / ms);
        scrivi(da + (a - da) * (1 - Math.pow(1 - k, 3)));
        if (k < 1) requestAnimationFrame(step); else scrivi(a);
    };
    requestAnimationFrame(step);
}

/**
 * I punti guadagnati, accanto alla card di chi li ha fatti.
 *
 * Un solo stile per tutti — niente riquadro, cifre luminose — che è quello che
 * si vedeva solo sul touchdown. Prima ce n'erano due: la pillola scura sulla
 * card per i punti normali e il numero grande di `live-fx` per chi segnava,
 * e sullo stesso schermo si leggevano come due cose diverse. `grosso` cambia
 * solo la misura: un touchdown resta più grande di una ricezione da otto yard.
 */
function etichetta(card, delta, dwell, grosso = false) {
    if (ridotto()) return;
    const tag = document.createElement('span');
    tag.className = `nr-pop ${delta > 0 ? 'pos' : 'neg'}${grosso ? ' nr-pop--grosso' : ''}`;
    tag.textContent = `${delta > 0 ? '+' : ''}${delta.toFixed(2)}`;
    card.appendChild(tag);
    tag.animate([
        { transform: 'translateY(10px) scale(0.7)', opacity: 0 },
        { transform: 'translateY(-4px) scale(1.12)', opacity: 1, offset: 0.18 },
        { transform: 'translateY(-6px) scale(1)', opacity: 1, offset: 0.6 },
        { transform: 'translateY(-20px) scale(0.92)', opacity: 0 },
    ], { duration: Math.max(650, dwell * 0.8), easing: 'ease-out' })
        .onfinish = () => tag.remove();
}

/**
 * Quanto può durare la festa: il passo che l'ha chiesta.
 *
 * Timbro e fumetto li accorcia `sparaEffetto` stessa (`opzioni.durata`), che è
 * il meccanismo del Live — passandogli quanto tempo ha, si ridimensiona da
 * sola. Qui si aggiunge solo quello che non sa fare: una sola ondata di
 * coriandoli e un lampo solo.
 */

/**
 * Le misure della festa, tagliate per un replay che corre.
 *
 * `live-fx.js` è tarato sul Live, dove si guarda in diretta: dieci secondi di
 * fuochi e cinque di timbro non coprono niente perché sotto non scorre nulla.
 * Qui invece il passo dopo arriva in due secondi, e una festa lunga restava
 * addosso alle giocate seguenti — che passavano senza che si vedessero.
 *
 * Quindi: UNA sola ondata di coriandoli invece di quattro (la "flashata"), il
 * timbro che se ne va con il passo e nessun fumetto — la battuta non fa in
 * tempo a leggersi e ruba il posto al timbro. I campi che non si toccano
 * restano quelli del Live.
 */
const FESTA_CORTA = {
    dura: 1500, ondate: 1, razzi: 0, ogni: 0,
    // Una flashata sola. Il `forte` del Live sono tre colpi su 900ms: dentro
    // una festa da un secondo e mezzo lo schermo resta acceso più della metà
    // del tempo, e sotto la scena non si vede più niente.
    lampo: { picco: 0.5, dur: 300, colpi: 1 },
};

function accorcia(spec) {
    if (!spec) return null;
    return { ...spec, ...FESTA_CORTA, dice: null };
}

/**
 * Coriandoli, fuochi, timbro: gli stessi di `live-fx.js`, non una copia.
 *
 * La spec arriva già calcolata da `mostra` (`effettoPer` vuole un evento nella
 * forma degli scontrini del Live, `changes: [{key, delta}]`, che è esattamente
 * ciò che la sequenza prepara in `cambi`). Il protagonista è chi ha mosso più
 * punti nella giocata: su un touchdown su passaggio sono in due, e la festa va
 * a chi l'ha segnato.
 *
 * Il livello si monta sul palco e non sul campo, perché
 * `sparaEffetto` cerca `.live-stage` per abbassare tutto il resto attorno al
 * protagonista — ed è il motivo per cui la scena porta quella classe.
 */
function festeggia(pan, spec, protagonista, dwell) {
    const stage = pan?.querySelector('[data-nr-stage]');
    const layer = montaLivello(stage);
    if (!layer) return;
    const card = pan.querySelector(`[data-nr-player="${CSS.escape(protagonista)}"]`);
    if (!card) return;
    /*
     * Zero punti di proposito: il numero lo mette già `etichetta()` accanto
     * alla card, e `live-fx` ne disegnerebbe un secondo dentro il suo livello,
     * lontano da chi l'ha segnato.
     *
     * `durata` è quanto tempo ha la festa prima che il passo cambi: timbro e
     * fumetto si accorciano da soli per starci dentro. Senza, resterebbero
     * addosso alle giocate seguenti — che intanto scorrono senza vedersi.
     */
    sparaEffetto(layer, card, spec, colori(), 0, { durata: dwell });
}

/** I colori della festa: quelli della squadra del cuore più il giallo del Live. */
function colori() {
    const p = TEAM_PALETTE[squadraPreferita()];
    return [p?.bright || '#f5c518', '#f5c518', '#ffffff', '#ff7a45', '#7ee787'];
}

/* ============================================================
   5. L'ATTACCO ALL'AVVIO
   ============================================================ */

/**
 * Il punto d'ingresso: lo chiama `boot()` in app.js.
 *
 * Due tempi, e l'ordine conta: il sipario si alza subito e in modo sincrono,
 * la risoluzione va dietro. Chi non ha una squadra del cuore, o ha già
 * guardato oggi, non si accorge che questo modulo esista.
 */
export function avviaNightRecap() {
    if (!alzaSipario()) return;
    // Il `catch` c'è perché nessun errore qui dentro deve lasciare il sipario
    // alzato: sotto c'è tutto il sito.
    risolviNightRecap().catch(e => {
        console.warn('[night-recap] interrotto:', e?.message || e);
        chiudi();
    });
}

/* ============================================================
   6. GLI AGGANCI DEL BANCO DI PROVA

   Servono a `preview-night-recap.html`, che importa QUESTO modulo e non una
   sua copia: il replay che si guarda là è lo stesso che va in onda il martedì
   mattina, effetti compresi. Se questi agganci si rompono se ne accorge il
   banco, che è il punto.

   Non toccano MAI il segnalibro: provare la scena non deve consumare il
   replay vero, né marcare come viste partite che uno non ha visto.
   ============================================================ */

/**
 * Manda in onda dei capitoli già pronti, a comando.
 *
 * @param {Array}    capitoli  [{ partita, titolari, week, mia, sequenza }]
 * @param {boolean}  manuale   true = un passo per volta (`anteprimaPasso`)
 * @param {Function} onPasso   richiamata a ogni passo mandato in scena
 */
export function anteprimaRecap(capitoli, { manuale = false, onPasso = null } = {}) {
    if (!capitoli?.length) return false;
    if (overlay) chiudi();
    montaOverlay();
    overlay.classList.remove('nr-overlay--sipario');
    riproduci(capitoli, [], 0, { manuale, onPasso });
    return true;
}

/** Un passo avanti, in modalità manuale. Torna false quando è finita. */
export function anteprimaPasso() {
    if (!attivo?.manuale) return false;
    const finita = attivo.passo >= attivo.linea.passi.length;
    avanza();
    return !finita;
}

/** Da manuale a corsa libera, e viceversa. */
export function anteprimaAuto(auto) {
    if (!attivo) return;
    attivo.manuale = !auto;
    clearTimeout(attivo.timer);
    if (auto) avanza();
}

/** Chiude la scena del banco di prova. */
export function anteprimaChiudi() {
    document.removeEventListener('keydown', tasti);
    chiudi();
}
