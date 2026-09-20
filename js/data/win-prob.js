/**
 * Probabilità di vittoria di una sfida di lega.
 *
 * PERCHÉ. Nel banner del tabellone (home e Live) la percentuale era la QUOTA DI
 * PUNTI già a referto, `s1 / (s1 + s2)`. Il 19/09/2026, col solo Thursday Night
 * giocato, Sommo aveva 58,50 e Oscurus 0,00: la barra diceva 100% con 142 punti
 * proiettati ancora da giocare. Il numero era giusto, la domanda sbagliata.
 *
 * COME. Ogni titolare che deve ancora giocare è una variabile casuale centrata
 * sulla sua proiezione ESPN, con la dispersione MISURATA su tutti i titolari
 * schierati nella lega dal 2019 (scripts/build-winprob-calib.mjs →
 * data/model/winprob_calib.json: `sd = a + b·proiezione`, un paio di parametri
 * per ruolo). Chi ha finito porta punti certi e nessuna varianza. Il totale di
 * squadra è la somma, la differenza fra le due somme è normale, e la
 * probabilità è la coda di quella normale sopra lo zero.
 *
 * Quattro cose che il modello fa e che vale la pena sapere:
 *
 * 1. **Chi ha finito non ha più varianza.** È tutto il punto: a giornata
 *    conclusa la probabilità va da sé a 0 o 1, senza casi speciali.
 * 2. **Una partita in corso vale per la parte che resta.** Punti già fatti +
 *    proiezione scalata sul tempo rimasto, e varianza scalata con essa (moto
 *    browniano: metà partita, metà varianza). Il cronometro si legge da
 *    `status`, che è lo `shortDetail` del tabellone ESPN ("7:12 - 3rd"); se non
 *    è leggibile si ripiega sull'orologio da muro a partire dal kickoff.
 * 3. **I compagni di squadra NFL sbagliano insieme.** Il QB e il suo ricevitore
 *    nella stessa squadra fantasy sono correlati, e la correlazione misurata
 *    entra nella varianza: senza, le rose "stackate" risultavano più sicure di
 *    quanto sono.
 * 4. **Non si inventa niente.** Senza proiezione un titolare vale zero con la
 *    dispersione minima del suo ruolo. E se il tabellone NFL non risponde, di un
 *    giocatore che ha già punti non si sa quanta partita gli resti: `ready`
 *    diventa falso e il chiamante torna a mostrare la quota di punti, invece di
 *    sommare una proiezione intera sopra punti già fatti.
 *
 * La calibrazione è verificata: log-loss e Brier per stato della giornata, e la
 * tabella osservato-contro-previsto, stanno in `diagnostics` dentro il JSON e li
 * ristampa ogni esecuzione del builder.
 */

/**
 * Ripiego usato solo se `data/model/winprob_calib.json` non è raggiungibile:
 * sono gli stessi numeri dell'ultima calibrazione, copiati qui perché una
 * probabilità mancante è peggio di una probabilità con un decimale diverso.
 */
const FALLBACK = {
    sigma: {
        QB: { a: 8.507, b: -0.011, min: 7.09, bias: -0.35 },
        RB: { a: 6.736, b: 0.117, min: 6.83, bias: -0.69 },
        WR: { a: 5.856, b: 0.194, min: 7.50, bias: -0.65 },
        TE: { a: 5.355, b: 0.145, min: 5.29, bias: 0.11 },
        K: { a: 2.689, b: 0.171, min: 3.43, bias: 0.28 },
        DEF: { a: 1.462, b: 0.619, min: 4.34, bias: 0.62 },
    },
    scale: 1.13,
    teamCorr: 0.07,
};

let _calib = null;

/** La calibrazione, una volta per sessione. Mai `null`: al massimo il ripiego. */
export function getWinProbCalib() {
    if (_calib) return _calib;
    _calib = (async () => {
        try {
            const ctrl = new AbortController();
            const t = setTimeout(() => ctrl.abort(), 8000);
            const r = await fetch('data/model/winprob_calib.json', { signal: ctrl.signal });
            clearTimeout(t);
            if (!r.ok) return FALLBACK;
            const d = await r.json();
            return d?.sigma ? d : FALLBACK;
        } catch { return FALLBACK; }
    })();
    return _calib;
}

/** Normale standard cumulata (Abramowitz-Stegun 7.1.26 su erf). */
function phi(z) {
    const s = z < 0 ? -1 : 1;
    const x = Math.abs(z) / Math.SQRT2;
    const t = 1 / (1 + 0.3275911 * x);
    const erf = 1 - t * (0.254829592 + t * (-0.284496736 + t * (1.421413741
        + t * (-1.453152027 + t * 1.061405429)))) * Math.exp(-x * x);
    return 0.5 * (1 + s * erf);
}

const P = (v) => Number.parseFloat(v) || 0;
const POS_OF = (p) => (p?.position_in_team || p?.position || '').toUpperCase();

const modelOf = (calib, pos) => calib.sigma[pos] || calib.sigma.WR || FALLBACK.sigma.WR;

function sigmaOf(calib, pos, proj) {
    const m = modelOf(calib, pos);
    return Math.max(m.min, m.a + m.b * Math.max(0, proj)) * (calib.scale || 1);
}

/**
 * Punti attesi da una proiezione: la proiezione più lo scarto medio misurato
 * per quel ruolo. ESPN è ottimista su RB e WR di due terzi di punto a testa, e
 * nella differenza fra due squadre si annullerebbe — ma solo se hanno lo stesso
 * numero di titolari ancora da giocare, che è proprio il caso che qui non vale.
 */
function attesiDa(calib, pos, proj) {
    return Math.max(0, proj + (modelOf(calib, pos).bias || 0));
}

/** Uno di questi stati e il giocatore non scende in campo: la proiezione ESPN
 *  a volte resta quella di prima della notizia, e conterebbe punti che non
 *  arriveranno. `DOUBTFUL` non c'è: in dubbio significa che può giocare. */
const FUORI = new Set(['OUT', 'INJURY_RESERVE', 'SUSPENSION', 'NOT_ACTIVE']);

const REGULATION_MIN = 60;
const GAME_MIN = 195;   // 3h15m, la stessa durata stimata di nfl-schedule.js

/**
 * Quanta partita resta, da 1 (non è cominciata) a 0 (finita).
 *
 * Prima si prova a leggere il cronometro dal tabellone: `status` è lo
 * `shortDetail` di ESPN, che durante la gara è "7:12 - 3rd" (o "Halftime", o
 * "End of 3rd"). Se non dice niente di utile si guarda l'orologio da muro dal
 * kickoff, che è grossolano ma monotono — l'importante è che la quota scenda.
 */
export function fractionLeft(p) {
    const testo = String(p?.status || '');
    const quarto = testo.match(/(\d+):(\d{2})\s*-\s*(?:Q\s*)?(\d)(?:st|nd|rd|th)?/i)
        || testo.match(/Q(\d)\s+(\d+):(\d{2})/i);
    if (quarto) {
        const [min, sec, q] = quarto[0].startsWith('Q')
            ? [Number(quarto[2]), Number(quarto[3]), Number(quarto[1])]
            : [Number(quarto[1]), Number(quarto[2]), Number(quarto[3])];
        if (q >= 5) return 0.03;                       // supplementari: quasi finita
        const restaNelQuarto = min + sec / 60;
        return Math.max(0, ((4 - q) * 15 + restaNelQuarto) / REGULATION_MIN);
    }
    if (/halftime/i.test(testo)) return 0.5;
    const fineQuarto = testo.match(/end of (\d)(?:st|nd|rd|th)/i);
    if (fineQuarto) return Math.max(0, (4 - Number(fineQuarto[1])) * 15 / REGULATION_MIN);

    const kick = p?.kickoff ? Date.parse(p.kickoff) : NaN;
    if (Number.isFinite(kick)) {
        const passati = (Date.now() - kick) / 60000;
        return Math.min(1, Math.max(0.02, 1 - passati / GAME_MIN));
    }
    return 0.5;
}

/**
 * Il contributo di un titolare al totale di squadra: punti già in cassa,
 * punti ancora attesi e dispersione di questi ultimi.
 */
function contributo(p, calib) {
    const pos = POS_OF(p);
    const fatti = P(p?.fantasy_points);
    const proj = p?.projected_points == null ? null : P(p.projected_points);
    const stato = p?.game_state || '';

    // Stato della partita sconosciuto (tabellone NFL non raggiungibile) e il
    // giocatore ha già cominciato: non si sa quanta partita resti, e una
    // proiezione intera sopra i punti già fatti li conterebbe due volte. Con il
    // tabellone giù, in locale, Sommo risultava proiettato a 199,7 invece di
    // 157,8 — i 58,5 già a referto sommati alle proiezioni piene. Meglio
    // dichiarare il conto non affidabile e lasciare il ripiego al chiamante.
    if (!stato && (p?.started === true || fatti > 0)) {
        return { fatti, attesi: 0, sd: 0, pos, sconosciuto: true };
    }

    if (stato === 'post') return { fatti, attesi: 0, sd: 0, pos };

    if (stato === 'in') {
        const quota = fractionLeft(p);
        // La proiezione è per l'INTERA partita: quel che resta è la sua quota
        // sul tempo rimasto. Varianza proporzionale al tempo, non alla media.
        const resto = proj == null ? 0 : attesiDa(calib, pos, proj) * quota;
        const sd = sigmaOf(calib, pos, proj == null ? 0 : proj) * Math.sqrt(quota);
        return { fatti, attesi: resto, sd, pos };
    }

    // Deve ancora cominciare (o non si sa: `game_state` vuoto fuori dal Live).
    if (FUORI.has(String(p?.injury_status || '').toUpperCase())) {
        return { fatti, attesi: 0, sd: 0, pos, fuori: true };
    }
    if (proj == null) {
        // Nessuna proiezione: zero atteso, dispersione minima. Non si inventa
        // un numero, ma non si finge nemmeno che sia una certezza.
        return { fatti, attesi: 0, sd: sigmaOf(calib, pos, 0), pos, senzaProiezione: true };
    }
    return { fatti, attesi: attesiDa(calib, pos, proj), sd: sigmaOf(calib, pos, proj), pos };
}

/** Totale atteso e varianza di una squadra, dai suoi titolari. */
function latoSquadra(team, calib) {
    const starters = (team?.starters || []).filter(p => p && !p.placeholder);
    let fatti = 0, attesi = 0, varianza = 0, aperti = 0, senzaProiezione = 0, sconosciuti = 0;
    const perNfl = new Map();   // sigla NFL → [sd] dei soli giocatori aperti

    for (const p of starters) {
        const c = contributo(p, calib);
        fatti += c.fatti;
        attesi += c.attesi;
        if (c.sd > 0) {
            varianza += c.sd ** 2;
            aperti++;
            const sigla = (p.nfl_team || '').toUpperCase();
            if (sigla) (perNfl.get(sigla) || perNfl.set(sigla, []).get(sigla)).push(c.sd);
        }
        if (c.senzaProiezione) senzaProiezione++;
        if (c.sconosciuto) sconosciuti++;
    }

    // Compagni di squadra NFL: correlazione positiva misurata, che alza la
    // varianza (2·ρ·sd_i·sd_j per ogni coppia).
    const rho = calib.teamCorr || 0;
    if (rho) {
        for (const list of perNfl.values()) {
            for (let i = 0; i < list.length; i++) {
                for (let j = i + 1; j < list.length; j++) varianza += 2 * rho * list[i] * list[j];
            }
        }
    }
    return { fatti, attesi, totale: fatti + attesi, varianza, aperti, senzaProiezione,
        sconosciuti, starters: starters.length };
}

/**
 * Probabilità che `team1` batta `team2`.
 *
 * @param {object} team1 squadra nello schema di lega (`starters` con
 *        `fantasy_points`, `projected_points`, `game_state`, `status`)
 * @param {object} team2 idem
 * @param {object} calib da `getWinProbCalib()`
 * @returns {{p1:number, p2:number, exp1:number, exp2:number, sd:number,
 *            margin:number, openStarters:number, ready:boolean, settled:boolean}}
 *          `settled` = non resta nulla da giocare; `ready` = il conto ha tutte
 *          le proiezioni che gli servono (falso → il chiamante può scegliere di
 *          non mostrare il numero).
 */
export function matchupWinProb(team1, team2, calib = FALLBACK) {
    const A = latoSquadra(team1, calib);
    const B = latoSquadra(team2, calib);
    const sd = Math.sqrt(A.varianza + B.varianza);
    const margin = A.totale - B.totale;
    const settled = !(sd > 0);
    const p1 = settled
        ? (margin > 0 ? 1 : margin < 0 ? 0 : 0.5)
        : phi(margin / sd);
    return {
        p1, p2: 1 - p1,
        exp1: A.totale, exp2: B.totale,
        sd, margin, settled,
        openStarters: A.aperti + B.aperti,
        ready: A.starters > 0 && B.starters > 0
            && A.senzaProiezione === 0 && B.senzaProiezione === 0
            && A.sconosciuti === 0 && B.sconosciuti === 0,
    };
}
