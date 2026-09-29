/**
 * Night Recap — il replay accelerato delle partite di notte.
 *
 * Qui dentro non c'e' DOM e non ci sono richieste di rete: si ricevono il
 * calendario NFL, le formazioni e le giocate, e ne esce una SEQUENZA di passi
 * che la sezione riproduce uno dopo l'altro. Tenere i conti separati dal
 * disegno serve a poter cambiare il ritmo senza toccare l'animazione, e a
 * poter provare la sequenza senza un browser.
 *
 * ── Cos'e' "di notte" ───────────────────────────────────────────────────
 *
 * Il turno primetime, e lo si riconosce dall'ORA ITALIANA del kickoff: dopo la
 * mezzanotte. Non dal giorno della settimana, che non basta — di solito sono
 * giovedi', domenica e lunedi', ma a dicembre si gioca anche il sabato e il
 * giorno di Natale.
 *
 *   Thursday Night   20:15 ET → 02:15 italiane   ✓
 *   Sunday Night     20:20 ET → 02:20 italiane   ✓
 *   Monday Night     20:15 ET → 02:15 italiane   ✓
 *   tardo pomeriggio 16:25 ET → 22:25 italiane   ✗  (in diretta sul Live)
 *   Londra            9:30 ET → 15:30 italiane   ✗
 *
 * Il margine regge anche i cambi di ora legale, che sfasano ET e Roma di
 * un'ora per due settimane a fine ottobre: il primetime scivola all'01:15 e la
 * fascia del pomeriggio al 21:25, e restano dalle parti giuste della
 * mezzanotte. Nessuna partita NFL comincia mai fra le 03:00 e le 07:00
 * italiane, quindi la finestra si chiude la' senza tagliare niente.
 */

import { scorePlay } from './scoring.js?v=592';
import { direzioneGiocata } from '../ui/field-strip.js?v=146';

/** Kickoff in questa fascia di ore italiane = turno di notte. */
const NOTTE_DA = 0;
const NOTTE_A = 7;

/**
 * Il pavimento del cancello 2 di `valeTentare`, SOLO per quando non si sa
 * ancora quando finisce la partita in esame. Non e' `NOTTE_A`: quella
 * delimita quali KICKOFF contano come "di notte" (vedi `eDiNotte`), questa
 * stima quando una notte tipica FINISCE — due domande diverse che il valore
 * 7 rispondeva entrambe per coincidenza. Un Monday Night delle 20:15 ET
 * finisce verso le 5:30 italiane (kickoff + le 3h15 di `GAME_DURATION_MS`
 * in nfl-schedule.js): 6 lascia mezz'ora di margine senza tenere il sipario
 * chiuso fino alle 7 quando la partita e' finita da un pezzo.
 */
const CANCELLO_ORA_FLOOR = 6;

/**
 * Quanto resta "rivedibile" una partita dopo che e' finita.
 *
 * Serve perche' il segnalibro nasce vuoto: senza questa finestra, la prima
 * apertura da un browser nuovo troverebbe "mai viste" TUTTE le partite di
 * notte delle settimane in esame e le metterebbe in fila — provato, e infatti
 * il primo replay partiva dalla week 2 mentre era in corso la 3.
 *
 * Quarantotto ore, non di piu' e non di meno: il Thursday Night finisce verso
 * le 5 del mattino di venerdi', e chi apre il sito sabato lo vede ancora; il
 * Monday Night copre martedi' e mercoledi'. Piu' in la' non e' piu' "stanotte",
 * e' archivio — e per l'archivio c'e' il Game Center. Le partite scadute non
 * si buttano: si segnano come viste, cosi' non tornano a galla domani.
 */
export const FRESCHEZZA_MS = 48 * 60 * 60 * 1000;

/** Se una partita finita e' ancora abbastanza fresca da valere un replay. */
export function eFresca(fine, ora = Date.now()) {
    const t = fine instanceof Date ? fine.getTime() : Number(fine);
    return Number.isFinite(t) && ora - t <= FRESCHEZZA_MS;
}

/** L'ora italiana (0-23) di un istante. */
function oraRomana(d) {
    const q = d instanceof Date ? d : new Date(d);
    if (Number.isNaN(q.getTime())) return -1;
    return Number(new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Europe/Rome', hour: '2-digit', hour12: false,
    }).format(q));
}

/** Il giorno italiano di un istante, come 'YYYY-MM-DD'. Serve al segnalibro. */
export function giornoRomano(d = new Date()) {
    const f = (o) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome', ...o }).format(d);
    return f({ year: 'numeric', month: '2-digit', day: '2-digit' });
}

/** Se il kickoff cade nella fascia notturna italiana. */
export function eDiNotte(start) {
    const h = oraRomana(start);
    return h >= NOTTE_DA && h < NOTTE_A;
}

/**
 * Le partite di notte GIA' CONCLUSE di una settimana.
 *
 * `schedule` e' la mappa di `getWeekSchedule`, che ha una riga per SQUADRA:
 * due righe per partita, ognuna col punto di vista suo. Qui si torna alla
 * partita, e casa/trasferta si leggono dalla forma dell'avversario — "BUF" in
 * casa, "@BUF" fuori (vedi `getWeekSchedule`).
 *
 * Solo `state === 'post'`: di una partita in corso c'e' il Live, e il replay
 * di mezza partita mostrerebbe un totale che non e' quello vero.
 */
export function partiteDiNotte(schedule) {
    if (!schedule) return [];
    const per = new Map();
    for (const [abbr, g] of schedule) {
        if (!g?.eventId || g.state !== 'post' || !eDiNotte(g.start)) continue;
        const casa = !String(g.opponent || '').startsWith('@');
        const chiave = String(g.eventId);
        const riga = per.get(chiave) || { eventId: chiave, start: g.start, end: g.end };
        if (casa) { riga.home = abbr; riga.homeScore = g.score; riga.awayScore = g.oppScore; }
        else { riga.away = abbr; riga.awayScore = g.score; riga.homeScore = g.oppScore; }
        per.set(chiave, riga);
    }
    return [...per.values()]
        .filter(p => p.home && p.away)
        .sort((a, b) => a.start - b.start);
}

/* ============================================================
   SEGNALIBRO — cosa e' gia' stato visto
   ============================================================ */

/**
 * NON passa da `utils/storage.js` di proposito, come `topina-live-preseason`
 * nel Live: non e' una cache, e' lo stato di chi guarda. Una cache si puo'
 * buttare via perche' si riscarica; questo se sparisce fa rivedere un replay
 * gia' visto, che e' esattamente la cosa che deve impedire. Sono un centinaio
 * di byte: `visti` tiene le ultime venti partite e basta.
 */
const CHIAVE = 'topina-recap-v1';
const MAX_VISTI = 20;

export function segnalibro() {
    try {
        const raw = localStorage.getItem(CHIAVE);
        const s = raw ? JSON.parse(raw) : null;
        return {
            visti: Array.isArray(s?.visti) ? s.visti.map(String) : [],
            tentato: s?.tentato || '',
            prossimaFine: Number(s?.prossimaFine) || 0,
        };
    } catch {
        return { visti: [], tentato: '', prossimaFine: 0 };
    }
}

function scriviSegnalibro(s) {
    try {
        localStorage.setItem(CHIAVE, JSON.stringify({
            visti: s.visti.slice(0, MAX_VISTI),
            tentato: s.tentato || '',
            prossimaFine: s.prossimaFine || 0,
        }));
    } catch { /* storage pieno o bloccato: si rivedra' il replay, pazienza */ }
}

/**
 * Segna delle partite come riviste, e con loro il momento in cui finisce la
 * prossima partita di notte: e' proprio qui che si sa che tutto il noto e'
 * stato visto, e quindi che fino a quel momento non puo' nascere niente di
 * nuovo da rivedere.
 */
export function segnaViste(eventIds, prossimaFine = 0) {
    const s = segnalibro();
    s.visti = [...new Set([...eventIds.map(String), ...s.visti])];
    if (prossimaFine) s.prossimaFine = prossimaFine;
    scriviSegnalibro(s);
}

/**
 * Segna che oggi si e' gia' guardato (cancello 1).
 *
 * `prossimaFine` si scrive SOLO quando non c'era niente da rivedere. Se invece
 * un replay c'era, lo segnera' `segnaViste` a replay concluso: scrivendolo
 * anche qui, chi chiude la pagina a metà si ritroverebbe il cancello 3 chiuso
 * fino alla partita di notte successiva, e quel replay non l'avrebbe piu'
 * rivisto — perso in silenzio, che e' il modo peggiore di perdere qualcosa.
 */
export function segnaTentativo(prossimaFine = 0) {
    const s = segnalibro();
    s.tentato = giornoRomano();
    if (prossimaFine) s.prossimaFine = prossimaFine;
    scriviSegnalibro(s);
}

/**
 * Se vale la pena andare a vedere se c'e' un replay da fare — deciso SENZA
 * rete, perche' la risposta serve prima che la home disegni.
 *
 * Due cancelli, non tre: il vero controllo "e' ancora in corso?" non si puo'
 * fare qui (ci vorrebbe il tabellone, cioe' una richiesta di rete, e questa
 * funzione deve restare sincrona), ma se `prossimaFine` lo sa gia' — imparato
 * durante una visita precedente, guardando quando finisce la prossima
 * partita di notte ancora da giocare — ci si fida di quello ANCHE PRIMA
 * dell'ora fissa:
 *
 *  1. una volta al giorno. Chi apre il sito sei volte in una mattina vede il
 *     replay la prima e poi piu';
 *  2. se `prossimaFine` e' noto, decide lui e basta: partita ancora da
 *     finire → non si apre nulla, qualunque ora sia; partita che per stima
 *     dovrebbe essere gia' finita → si apre, anche alle 6:05. E' il cancello
 *     che tiene il mercoledi' pulito (senza, ogni giorno ci sarebbe un lampo
 *     di sipario prima di scoprire che non c'era niente da rivedere) ed e'
 *     anche quello che smette di bloccare un Monday Night finito da un pezzo
 *     solo perche' non sono ancora le 7.
 *     Solo se `prossimaFine` non si sa ancora (prima volta, o segnalibro
 *     azzerato) si ripiega sull'ora fissa (`CANCELLO_ORA_FLOOR`): prima di
 *     quella, una partita puo' essere ancora in corso, e li' c'e' il Live.
 */
export function valeTentare(ora = new Date()) {
    const s = segnalibro();
    if (s.tentato === giornoRomano(ora)) return false;
    if (s.prossimaFine) return ora.getTime() >= s.prossimaFine;
    if (oraRomana(ora) < CANCELLO_ORA_FLOOR) return false;
    return true;
}

/* ============================================================
   LA SEQUENZA — le giocate diventano passi da riprodurre
   ============================================================ */

/**
 * Quanto sta a schermo ogni tipo di passo. Sono i numeri del RITMO, e stanno
 * qui tutti insieme apposta: cambiare la sensazione del replay dev'essere
 * cambiare una riga, non rincorrere dei `setTimeout` dentro l'animazione.
 *
 * Il passo di un touchdown e' il piu' lungo perche' il timbro di `live-fx.js`
 * resta cinque secondi: uscendo prima si leggerebbe "TOUCHDO" e via. I
 * coriandoli invece durano dieci secondi e possono sbordare sui passi dopo —
 * e' voluto, tiene la festa addosso mentre la giornata riprende a correre.
 */
const DWELL = {
    /*
     * Il touchdown dura meno di prima (era 4,2s).
     *
     * La festa di `live-fx.js` è tarata sul Live, che è in diretta: dieci
     * secondi di fuochi e cinque di timbro là non coprono niente, qui si
     * mangiavano le tre giocate successive — che intanto scorrevano sotto
     * senza che si vedessero. Il recap passa le sue misure corte
     * (`FESTA_CORTA` in sections/night-recap.js) e il passo si accorcia con
     * loro: la festa finisce dentro il suo passo, non addosso ai prossimi.
     */
    /*
     * I tre passi con la festa durano quanto la festa, non meno.
     *
     * Il cronometro si FERMA mentre l'animazione va (come in diretta, dove
     * dopo un touchdown l'orologio è spento) e riparte al passo dopo: se il
     * passo finisse prima dell'animazione, il tempo ripartirebbe con i
     * coriandoli ancora per aria. La festa più lunga è quella col timbro —
     * 350 ms di entrata + 1200 di tenuta + 700 di uscita = 2250 — e questi
     * numeri le stanno sopra. Cambiando `FESTA_CORTA` in sections/
     * night-recap.js vanno rifatti i conti qui.
     */
    td: 2600,
    calcio: 2350,
    colpo: 2350,
    normale: 1500,
    // Lo stacco di fine quarto: il campo si abbassa e resta il cartello.
    quarto: 2000,
    // Il blocco compresso NON ha una durata fissa: vedi `durataSalto`.
    salto: 700,
    assesta: 1700,
    // Solo senza compressione: una giocata in cui non c'e' nessuno dei miei.
    // Si vede scorrere il testo, il tabellone e il possesso, e via.
    passa: 420,
};

/**
 * Quanto tempo di partita passa in un secondo di schermo, dentro un blocco
 * compresso.
 *
 * Nasce da un difetto vero: il blocco durava 700 ms FISSI, che coprisse tre
 * giocate o trentasei. L'ultimo blocco prima dell'intervallo si mangiava
 * cinque minuti di partita in mezzo secondo, e il cronometro sembrava saltare
 * da 5:00 a HALFTIME invece di scorrere.
 *
 * Legandolo ai minuti coperti il tempo scorre anche quando non succede niente,
 * che è il punto. Il pavimento serve a un blocco da dieci secondi (se no non
 * si vedrebbe affatto), il tetto a una pausa lunghissima — senza, una
 * traversata di sei minuti si prenderebbe da sola un decimo del replay.
 */
const RITMO_SALTO = 110;
const SALTO_MIN = 520;
const SALTO_MAX = 4200;

/** Secondi di partita ancora da giocare a quella giocata (per misurare le distanze). */
function restante(g) {
    const m = String(g.clock || '').match(/^(\d+):(\d{2})$/);
    if (!m || g.period == null) return null;
    return Math.max(0, 4 - g.period) * 900 + Number(m[1]) * 60 + Number(m[2]);
}

/** Quanto sta a schermo un blocco, dati i secondi di partita che copre. */
function durataSalto(coperto) {
    if (!Number.isFinite(coperto) || coperto <= 0) return SALTO_MIN;
    return Math.round(Math.min(SALTO_MAX, Math.max(SALTO_MIN, (coperto / RITMO_SALTO) * 1000)));
}

/** Il tetto di durata di tutto il replay. Oltre, si comprime. */
export const BUDGET_MS = 75000;

/** Secondi di gioco di una partita regolamentare: quattro quarti da quindici. */
const REGOLAMENTARE = 3600;

const secondiClock = (c) => {
    const m = String(c || '').match(/^(\d+):(\d{2})$/);
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

/**
 * Quanto è durata davvero una partita, in secondi di gioco.
 *
 * Serve al budget: il replay copre i 60 minuti regolamentari in un tempo
 * fisso, e un SUPPLEMENTARE è tempo in più che va raccontato in proporzione —
 * non schiacciato dentro lo stesso spazio, che vorrebbe dire correre di più
 * proprio nel finale che uno vuole vedere.
 *
 * La durata del periodo supplementare non si dà per scontata: si legge dal
 * cronometro più alto osservato lì dentro (10 minuti in stagione regolare,
 * 15 ai playoff), col minimo dei 600 secondi se le giocate iniziali mancano.
 */
export function tempoDiGioco(giocate) {
    const per = new Map();
    for (const g of giocate || []) {
        const s = secondiClock(g.clock);
        if (s == null || g.period == null) continue;
        const v = per.get(g.period) || { max: 0, min: Infinity };
        v.max = Math.max(v.max, s);
        v.min = Math.min(v.min, s);
        per.set(g.period, v);
    }
    let extra = 0;
    for (const [p, v] of per) {
        if (p < 5) continue;                       // 1-4 sono i quarti regolamentari
        const durata = Math.max(v.max, 600);
        extra += Math.max(0, durata - v.min);
    }
    return REGOLAMENTARE + extra;
}

/**
 * Di quanto allungare il budget per i supplementari.
 *
 * Proporzione secca sul tempo di gioco: una partita finita al 4° quarto vale
 * 1, una con dieci minuti di overtime vale 4200/3600 = 1,167 — cioè venti
 * secondi in più sui centoventi. Con più partite comanda la più lunga: le
 * gare scorrono INSIEME sullo stesso cronometro, e il replay finisce quando
 * finisce l'ultima.
 */
export function fattoreSupplementari(perPartita) {
    const q = (perPartita || []).map(g => tempoDiGioco(g) / REGOLAMENTARE);
    return q.length ? Math.max(1, ...q) : 1;
}

/** Quanti momenti "pieni" al massimo, prima di comprimere. */
const MAX_MOMENTI = 16;

/** Sotto questo scarto l'assestamento e' arrotondamento, non una giocata mancante. */
const SOGLIA_SCARTO = 0.05;

/**
 * Di che tipo e' una giocata per i miei, e quanto vale la pena fermarsi.
 *
 * Il `peso` non e' i punti: un intercetto costa due punti e un touchdown ne
 * vale sei, ma sono entrambi momenti da vedere, mentre una ricezione da otto
 * yard vale piu' punti di un sack e conta molto meno. I momenti "obbligati"
 * (peso ≥ 100) non vengono MAI compressi, nemmeno se la giornata e' lunga:
 * sono esattamente le giocate per cui uno guarda un replay.
 */
function classifica(tocchi) {
    let peso = 0, tipo = 'normale';
    for (const t of tocchi) {
        const s = t.stats || {};
        const ha = (...k) => k.some(x => (s[x] || 0) > 0);
        if (ha('pass_td', 'rush_td', 'rec_td', 'def_td', 'ret_td', 'fum_td', 'def_ret_td')) {
            return { peso: 1000, tipo: 'td' };
        }
        if (ha('fg_made', 'fg_50_plus', 'safety')) { peso = Math.max(peso, 400); tipo = 'calcio'; }
        else if (ha('pass_int', 'fum_lost', 'def_int', 'sack')) { peso = Math.max(peso, 300); tipo = 'colpo'; }
        else peso = Math.max(peso, Math.abs(t.pts));
    }
    return { peso, tipo };
}

/**
 * Il contesto da tabellone NFL di una giocata: down, distanza e punto del
 * campo, come li scrive la grafica della diretta.
 *
 * La posizione si ricava da `toEZ` (quanto manca alla end zone avversaria),
 * che è l'unico campo su cui si può ragionare senza indovinare l'orientamento
 * — vedi la nota in `normalizePlay` di nfl-plays.js. Da lì al modo in cui la
 * si scrive in TV ("GB 34") servono due passaggi:
 *
 *   toEZ ≤ 50  →  la palla è nella METÀ avversaria, alla yard line `toEZ`,
 *                 e la metà porta il nome di chi difende;
 *   toEZ > 50  →  è nella propria metà, alla yard line `100 - toEZ`.
 *
 * A 50 esatti le due scritture coincidono e la TV scrive "50": il ramo ≤ 50
 * ci arriva da solo.
 */
function contesto(g, siglaDi) {
    const difesa = siglaDi(g.defenseTeamId) || '';
    const attacco = siglaDi(g.offenseTeamId) || '';
    let campo = '';
    if (g.toEZ != null) {
        const dentro = g.toEZ <= 50;
        const yard = dentro ? g.toEZ : 100 - g.toEZ;
        const lato = dentro ? difesa : attacco;
        campo = yard === 50 ? '50' : `${lato} ${yard}`.trim();
    }
    return {
        down: g.down ?? null,
        distanza: g.distance ?? null,
        // "1st & Goal" quando la distanza da fare supera quello che manca alla
        // meta: scriverlo "1st & 15" da dentro le 8 yard sarebbe sbagliato.
        goal: g.toEZ != null && g.distance != null && g.distance >= g.toEZ,
        campo,
        difesa,
    };
}

/** I cambiamenti nella forma che `effettoPer` di live-fx sa leggere. */
function cambiamenti(tocchi) {
    const out = [];
    for (const t of tocchi) {
        for (const [k, v] of Object.entries(t.stats || {})) {
            if ((v || 0) > 0) out.push({ key: k, delta: v });
        }
    }
    return out;
}

/**
 * Le giocate di UNA partita diventano una sequenza di passi.
 *
 * Due tipi di passo, e la differenza e' tutto il ritmo:
 *
 *  - `gioca` — un momento. Si vede il testo dell'azione, i punti che escono
 *    dal giocatore, e la festa se la merita.
 *  - `salta` — un blocco di giocate compresso in un passo solo. I punti ci
 *    sono comunque (il totale del giocatore non deve MAI saltare un pezzo),
 *    ma arrivano tutti insieme e senza effetti, mentre il tabellone NFL
 *    avanza. E' il "tempo accelerato": si corre dove non succede niente di mio.
 *
 * In coda, `assesta`: lo scarto fra il totale UFFICIALE del giocatore e la
 * somma delle giocate ricostruite. Stessa scelta di `costruisciRace` in
 * live-race.js, per la stessa ragione — il ricalcolo per giocata non e' il
 * punteggio ufficiale (i punti concessi da una difesa si assegnano a fine
 * partita, qualche tipo di giocata raro manca, ESPN a volte rettifica). Senza
 * questo passo il replay finirebbe su un numero diverso da quello che il sito
 * mostra due secondi dopo, ed e' il genere di incoerenza che fa perdere
 * fiducia in tutto il resto.
 *
 * @param {Array}    giocate  le giocate della partita (da fetchPlays, all: true)
 * @param {Array}    titolari i MIEI titolari che giocavano in questa partita
 * @param {Function} chiE     (contributo di scorePlay) → titolare | null
 * @param {Function} siglaDi  (id squadra ESPN) → sigla, per sapere chi attacca
 * @param {number}   budget   millisecondi a disposizione
 */
export function costruisciSequenza({ giocate, titolari, chiE, siglaDi, budget = BUDGET_MS, comprimiGiocate = true }) {
    const ordinate = [...(giocate || [])].sort((a, b) => (a.seq || 0) - (b.seq || 0));

    // Primo giro: ogni giocata con dentro i MIEI diventa un candidato.
    const grezzi = [];
    let away = 0, home = 0;
    for (const g of ordinate) {
        const tocchi = [];
        for (const c of scorePlay(g)) {
            const chi = chiE(c);
            if (!chi) continue;
            const gia = tocchi.find(t => t.nome === chi.name);
            if (gia) {
                gia.pts = +(gia.pts + c.pts).toFixed(2);
                for (const [k, v] of Object.entries(c.stats || {})) gia.stats[k] = (gia.stats[k] || 0) + v;
            } else {
                tocchi.push({ nome: chi.name, pts: c.pts, riga: c.line || '', stats: { ...(c.stats || {}) } });
            }
        }
        away = g.awayScore || away;
        home = g.homeScore || home;
        const { peso, tipo } = classifica(tocchi);
        grezzi.push({
            g, tocchi, peso, tipo, away, home,
            // Una giocata senza i miei non e' mai un momento, per quanto bella
            // sia stata: questo replay racconta la MIA giornata, non la partita.
            candidato: tocchi.length > 0 && (peso >= 100 || tocchi.some(t => t.pts !== 0)),
        });
    }

    // Secondo giro: quanti momenti ci stanno nel budget. Gli obbligati
    // (touchdown, calci, palle perse) restano sempre; dei normali si tiene la
    // testa della classifica, e si stringe finche' non entra.
    const obbligati = grezzi.filter(r => r.candidato && r.peso >= 100);
    const normali = grezzi.filter(r => r.candidato && r.peso < 100)
        .sort((a, b) => b.peso - a.peso);
    const costoFisso = obbligati.reduce((s, r) => s + DWELL[r.tipo], 0) + DWELL.assesta;

    let quanti = comprimiGiocate ? Math.min(MAX_MOMENTI - obbligati.length, normali.length) : 0;
    while (quanti > 0) {
        const scelti = new Set([...obbligati, ...normali.slice(0, quanti)]);
        if (costoFisso + quanti * DWELL.normale + stimaSalti(grezzi, scelti) <= budget) break;
        quanti--;
    }
    const momenti = new Set([...obbligati, ...normali.slice(0, Math.max(0, quanti))]);

    // Terzo giro: si scrive la sequenza in ordine di gioco, accumulando nei
    // blocchi saltati tutto quello che non e' diventato un momento.
    const passi = [];
    const ricostruiti = new Map();
    let blocco = null;
    const conta = (tocchi) => {
        for (const t of tocchi) ricostruiti.set(t.nome, +((ricostruiti.get(t.nome) || 0) + t.pts).toFixed(2));
    };
    const chiudi = () => {
        if (!blocco) return;
        // La durata si sa solo adesso: dipende da quanta partita ha inghiottito.
        const a = blocco.restanteFine;
        blocco.dwell = durataSalto(blocco.daRestante != null && a != null ? blocco.daRestante - a : null);
        delete blocco.daRestante;
        delete blocco.restanteFine;
        passi.push(blocco);
        blocco = null;
    };

    /*
     * Lo stacco di fine quarto.
     *
     * Non è decorazione: senza, il cronometro arriva a 0:00 e riparte da 15:00
     * dentro lo stesso respiro, e il salto di quindici minuti passa
     * inosservato. Il cartello dà il tempo di registrarlo.
     *
     * Si inserisce quando il periodo CAMBIA, quindi racconta la fine di quello
     * appena concluso. La fine del quarto periodo non si segna: lì finisce la
     * partita, e a dirlo c'è già l'assestamento.
     */
    let periodoPrima = null;
    const forseQuarto = (g) => {
        const p = g.period;
        if (p == null) return;
        if (periodoPrima != null && p !== periodoPrima && periodoPrima < 4) {
            // Il blocco aperto si chiude QUI: se no il cartello finiva in
            // mezzo alla sequenza prima del blocco che lo precede, e si
            // vedeva "HALFTIME" e poi ancora azioni del secondo quarto.
            chiudi();
            const ultimo = passi[passi.length - 1];
            passi.push({
                kind: 'quarto', tipo: 'quarto',
                testo: etichettaQuarto(periodoPrima),
                periodo: periodoPrima, clock: '0:00',
                away: ultimo?.away ?? 0, home: ultimo?.home ?? 0,
                attacco: '', redZone: false, down: null, distanza: null, goal: false,
                campo: '', difesa: '',
                tocchi: [], cambi: [], td: false, dwell: DWELL.quarto,
            });
        }
        periodoPrima = p;
    };

    for (const r of grezzi) {
        const attacco = siglaDi(r.g.offenseTeamId) || '';
        const redZone = r.g.toEZ != null && r.g.toEZ <= 20;
        // Prima del passo, così il cartello cade FRA i due quarti e non dopo
        // che la prima azione del nuovo quarto è già andata in scena.
        if (momenti.has(r) || !comprimiGiocate) chiudi();
        forseQuarto(r.g);

        /*
         * Senza compressione non esistono blocchi: ogni giocata e' un passo.
         * Quelle senza nessuno dei miei diventano passi `passa` — si legge il
         * testo, il tabellone avanza, il possesso si accende — ma durano un
         * quarto di un momento, se no una partita da 185 giocate non finisce
         * piu'. I momenti restano momenti: un touchdown non diventa un lampo
         * solo perche' si e' scelto di vedere tutto.
         */
        if (!comprimiGiocate && !momenti.has(r)) {
            conta(r.tocchi);
            const suo = r.tocchi.length > 0;
            passi.push({
                kind: suo ? 'gioca' : 'passa', tipo: suo ? 'normale' : 'passa',
                testo: r.g.text || r.g.type || '', periodo: r.g.period, clock: r.g.clock,
                away: r.away, home: r.home, attacco, redZone,
                ...contesto(r.g, siglaDi),
                tocchi: r.tocchi, cambi: suo ? cambiamenti(r.tocchi) : [],
                td: false, dwell: suo ? DWELL.normale : DWELL.passa,
            });
            continue;
        }

        if (momenti.has(r)) {
            conta(r.tocchi);
            passi.push({
                kind: 'gioca', tipo: r.tipo,
                testo: r.g.text || r.g.type || '', periodo: r.g.period, clock: r.g.clock,
                away: r.away, home: r.home, attacco, redZone,
                ...contesto(r.g, siglaDi),
                tocchi: r.tocchi, cambi: cambiamenti(r.tocchi),
                td: r.tipo === 'td', dwell: DWELL[r.tipo],
            });
            continue;
        }
        // Non e' un momento: entra nel blocco compresso corrente.
        conta(r.tocchi);
        if (!blocco) {
            blocco = {
                kind: 'salta', tipo: 'salto', testo: '', periodo: r.g.period, clock: r.g.clock,
                away: r.away, home: r.home, attacco, redZone,
                ...contesto(r.g, siglaDi),
                tocchi: [], cambi: [], td: false, dwell: DWELL.salto, saltate: 0,
                // Da dove parte l'orologio: serve a misurare quanta partita
                // si sta per comprimere, e quindi quanto tenerla a schermo.
                daRestante: restanteDelPassoPrima(passi, r.g),
            };
        }
        blocco.saltate++;
        blocco.away = r.away; blocco.home = r.home;
        blocco.periodo = r.g.period; blocco.clock = r.g.clock;
        blocco.attacco = attacco; blocco.redZone = redZone;
        blocco.restanteFine = restante(r.g);
        Object.assign(blocco, contesto(r.g, siglaDi));
        for (const t of r.tocchi) {
            const gia = blocco.tocchi.find(x => x.nome === t.nome);
            if (gia) gia.pts = +(gia.pts + t.pts).toFixed(2);
            else blocco.tocchi.push({ nome: t.nome, pts: t.pts, riga: '', stats: { ...t.stats } });
        }
    }
    chiudi();

    // La coda: ogni titolare arriva esattamente al suo totale ufficiale.
    const assesta = [];
    for (const p of titolari) {
        const ufficiale = parseFloat(p.fantasy_points) || 0;
        const scarto = +(ufficiale - (ricostruiti.get(p.name) || 0)).toFixed(2);
        if (Math.abs(scarto) < SOGLIA_SCARTO) continue;
        assesta.push({ nome: p.name, pts: scarto, riga: 'official total', stats: {} });
    }
    if (assesta.length) {
        const ultimo = passi[passi.length - 1];
        passi.push({
            kind: 'assesta', tipo: 'assesta', testo: 'Settled with the official box score',
            periodo: ultimo?.periodo ?? null, clock: null,
            away: ultimo?.away ?? 0, home: ultimo?.home ?? 0, attacco: '', redZone: false,
            tocchi: assesta, cambi: [], td: false, dwell: DWELL.assesta,
        });
    }

    return comprimi(passi, budget);
}

/**
 * L'ultima rete sulla durata.
 *
 * I momenti obbligati non si tagliano — sono il replay — quindi una partita in
 * cui i miei fanno nove touchdown li tiene tutti e puo' sfondare il budget da
 * sola. Invece di rinunciare a un touchdown si stringono i tempi: prima i
 * blocchi saltati (li' non si legge niente, si guarda solo il numero correre),
 * poi tutto il resto in proporzione, con un pavimento sotto cui un passo non
 * si leggerebbe piu'.
 *
 * Il passo del touchdown ha il pavimento piu' alto di tutti perche' il timbro
 * di `live-fx.js` resta cinque secondi: comprimendolo come gli altri si
 * leggerebbe mezza parola.
 */
/* I pavimenti della compressione. Quelli dei tre passi con la festa NON
   scendono sotto la durata dell'animazione: una festa tagliata a metà è
   peggio di un replay un po' più lungo, e col cronometro fermo sarebbe anche
   il tempo a ripartire troppo presto. */
const PAVIMENTO = { td: 2350, calcio: 2350, colpo: 2350, normale: 700, salto: 320, assesta: 900, passa: 150, quarto: 1200 };

function comprimi(passi, budget) {
    const somma = () => passi.reduce((s, p) => s + p.dwell, 0);
    if (somma() <= budget) return { passi, durata: somma() };

    // Primo taglio: i blocchi saltati al minimo. Spesso basta questo.
    for (const p of passi) if (p.kind === 'salta') p.dwell = PAVIMENTO.salto;
    if (somma() <= budget) return { passi, durata: somma() };

    // Secondo taglio: tutti in proporzione, nessuno sotto il suo pavimento.
    const k = budget / somma();
    for (const p of passi) p.dwell = Math.max(PAVIMENTO[p.tipo] || PAVIMENTO.normale, Math.round(p.dwell * k));
    return { passi, durata: somma() };
}

/**
 * Da dove parte l'orologio di un blocco: dall'ultimo passo gia' in scena, non
 * dalla prima giocata del blocco. La prima giocata compressa e' gia' DENTRO il
 * blocco, e partire da li' perderebbe il tratto fra il momento precedente e
 * lei — proprio quello in cui "non succede niente" e il tempo deve scorrere.
 */
function restanteDelPassoPrima(passi, primaDelBlocco) {
    const ultimo = passi[passi.length - 1];
    const da = ultimo ? restante({ period: ultimo.periodo, clock: ultimo.clock }) : null;
    return da != null ? da : restante(primaDelBlocco);
}

/** Come la TV chiama la fine di un periodo. */
function etichettaQuarto(p) {
    if (p === 2) return 'HALFTIME';
    return `END OF ${({ 1: '1ST', 3: '3RD', 4: '4TH' })[p] || `Q${p}`}`;
}

/* ============================================================
   IL GRAFICO DI FINE PARTITA — ogni giocata dei miei dalla LOS
   ============================================================ */

/**
 * Ogni azione dei miei titolari, pronta da disegnare: dove è andata e quanto
 * ha reso.
 *
 * ── Cosa è esatto e cosa no ─────────────────────────────────────────────
 *
 * La LUNGHEZZA è un dato vero: le yard della giocata, prese dal referto.
 * La CORSIA no. Il tracking dei giocatori — quello con cui NFL Next Gen Stats
 * disegna le sue mappe — non esiste in nessuna API pubblica di ESPN: l'unica
 * traccia della direzione è la frase del referto ("pass short left", "right
 * tackle", "up the middle"), e da lì si ricava su quale delle corsie è andata
 * l'azione (96% delle giocate; le restanti sono inginocchiamenti e righe di
 * riepilogo). Quindi il disegno dice il VERSO giusto e la lunghezza giusta, ma
 * la posizione esatta è stilizzata — e il grafico lo scrive sotto, perché
 * nessuno lo scambi per tracking vero.
 */
export function giocateDeiMiei(giocate, chiE) {
    const out = [];
    for (const g of [...(giocate || [])].sort((a, b) => (a.seq || 0) - (b.seq || 0))) {
        for (const c of scorePlay(g)) {
            const chi = chiE(c);
            if (!chi) continue;
            const st = c.stats || {};
            let tipo = null, yards = 0;
            if (c.role === 'receiver') {
                tipo = st.rec ? 'rec' : 'inc';         // ricezione o bersaglio a vuoto
                yards = st.rec_yds || 0;
            } else if (c.role === 'rusher') {
                tipo = 'rush'; yards = st.rush_yds || 0;
            } else if (c.role === 'passer' && st.pass_comp) {
                tipo = 'pass'; yards = st.pass_yds || 0;
            } else if (c.role === 'kicker' && st.fg_made) {
                tipo = 'fg'; yards = g.yards || 0;
            }
            if (!tipo) continue;
            out.push({
                nome: chi.name,
                tipo,
                yards,
                corsia: direzioneGiocata(g).corsia,
                td: Object.entries(st).some(([k, v]) => /_td$/.test(k) && v > 0),
                periodo: g.period ?? null,
                clock: g.clock || '',
            });
        }
    }
    return out;
}

/* ============================================================
   PIU' PARTITE INSIEME — una linea del tempo sola
   ============================================================ */

/**
 * Intreccia le sequenze di più partite in UNA, ordinata sul cronometro di
 * gara.
 *
 * Quando la notte ha due partite si vogliono vedere INSIEME — una sopra e una
 * sotto — non una dopo l'altra. Perché abbia senso guardarle insieme devono
 * però camminare insieme: si percorre il tempo di gioco da Q1 15:00 a Q4 0:00
 * una volta sola, e a ogni passo tocca alla partita che in quel momento aveva
 * qualcosa da mostrare. Due cronometri diversi sullo stesso schermo — uno a
 * Q4 e uno a Q2 — non si leggono, e non si capisce perché.
 *
 * Ogni passo si porta dietro `gioco`, l'indice della sua partita: è l'unica
 * cosa che serve a chi disegna per sapere quale pannello aggiornare.
 *
 * Gli stacchi di fine quarto si fondono: ogni partita ne produce uno suo, ma
 * il quarto finisce per tutte nello stesso momento e il cartello è uno solo.
 * Gli assestamenti vanno in coda, dove stavano.
 */
export function intreccia(sequenze) {
    const tutti = [];
    sequenze.forEach((seq, gioco) => {
        for (const p of seq.passi || []) tutti.push({ ...p, gioco });
    });

    // Chiave d'ordine: quanto manca alla fine della partita. Più alto = prima.
    // L'assestamento non sta nel tempo di gioco: va in fondo a tutto.
    const chiave = (p) => (p.kind === 'assesta'
        ? -1
        : (restante({ period: p.periodo, clock: p.clock }) ?? 0));

    tutti.sort((a, b) => {
        const d = chiave(b) - chiave(a);
        if (d) return d;
        // A parità di momento: prima gli stacchi di quarto (chiudono il
        // periodo), poi le partite in ordine.
        if ((a.kind === 'quarto') !== (b.kind === 'quarto')) return a.kind === 'quarto' ? -1 : 1;
        return a.gioco - b.gioco;
    });

    const passi = [];
    const quartiVisti = new Set();
    for (const p of tutti) {
        if (p.kind === 'quarto') {
            if (quartiVisti.has(p.periodo)) continue;   // uno solo per periodo
            quartiVisti.add(p.periodo);
            p.gioco = null;                              // vale per tutte
        }
        passi.push(p);
    }
    return { passi, durata: passi.reduce((s, p) => s + p.dwell, 0) };
}

/** Quanti blocchi saltati verrebbero fuori con questi momenti, e quanto costano. */
function stimaSalti(grezzi, scelti) {
    let blocchi = 0, dentro = false;
    for (const r of grezzi) {
        if (scelti.has(r)) { dentro = false; continue; }
        if (!dentro) { blocchi++; dentro = true; }
    }
    return blocchi * DWELL.salto;
}
