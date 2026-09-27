/**
 * "Next up": chi della tua squadra deve ancora giocare, in ordine di kickoff,
 * e cosa va sistemato prima che la sua partita cominci.
 *
 * Il problema che risolve e' uno solo: una formazione si blocca giocatore per
 * giocatore, al kickoff della SUA partita. Un titolare OUT che gioca il
 * venerdi' notte va tolto entro il venerdi' notte; un panchinaro che proietta
 * piu' del titolare si puo' mettere dentro solo finche' nessuno dei due ha
 * cominciato. Scoprirlo alle 19:05 della domenica e' troppo tardi.
 *
 * Conti puri: niente DOM, niente rete. Il Live passa la squadra e una funzione
 * che dice di ogni giocatore quando gioca (dal tabellone NFL che ha gia').
 */

/** Stato fisico ESPN → quanto e' grave per chi e' in formazione. */
const GRAVITA = {
    OUT: { livello: 'fix', testo: 'is OUT' },
    INJURY_RESERVE: { livello: 'fix', testo: 'is on IR' },
    SUSPENSION: { livello: 'fix', testo: 'is suspended' },
    DOUBTFUL: { livello: 'fix', testo: 'is doubtful' },
    QUESTIONABLE: { livello: 'check', testo: 'is questionable' },
};

/**
 * Chi puo' occupare un posto. `W/R` e' il flex di questa lega (solo RB e WR);
 * `W/R/T` e `W/T` ci sono per completezza, se un giorno la lega cambiasse.
 */
const IDONEI = {
    QB: ['QB'], RB: ['RB'], WR: ['WR'], TE: ['TE'], K: ['K'], DEF: ['DEF', 'D/ST'],
    'W/R': ['RB', 'WR'], 'W/T': ['WR', 'TE'], 'W/R/T': ['RB', 'WR', 'TE'],
};
const puoGiocare = (slot, pos) => (IDONEI[slot] || [slot]).includes(pos);

/** Sotto questo scarto di proiezione non si suggerisce uno scambio: e' rumore. */
const SOGLIA_SCAMBIO = 2;

const proj = (p) => {
    const v = parseFloat(p?.projected_points);
    return Number.isFinite(v) ? v : null;
};
const statoDi = (p) => String(p?.injury_status || p?.injuryStatus || '').toUpperCase();

/**
 * @param squadra   { name, starters, bench }
 * @param partitaDi (giocatore) → { start: Date, state: 'pre'|'in'|'post' } | null
 * @returns {{
 *   gruppi: [{ kickoff, giocatori: [voce] }],   // solo chi deve ancora giocare
 *   inCorso: [voce],                             // in campo adesso
 *   giocati: [{ kickoff, giocatori: [voce] }],   // partita finita
 *   bye: [voce],                                 // senza partita questa settimana
 *   bloccati: number,                            // la cui partita e' cominciata
 *   avvisi: [{ livello, scadenza, testo, chi: [nomi] }],
 *   calendarioNoto: boolean,
 * }}
 *   voce = { p, titolare, slot, pos, proj, stato, kickoff }
 */
export function prossimiDi(squadra, partitaDi) {
    const voci = [];
    for (const [lista, titolare] of [[squadra?.starters || [], true], [squadra?.bench || [], false]]) {
        for (const p of lista) {
            if (!p?.name || p.placeholder) continue;
            const g = partitaDi(p);
            voci.push({
                p, titolare,
                slot: String(p.position || '').toUpperCase(),
                pos: String(p.position_in_team || p.position || '').toUpperCase(),
                proj: proj(p),
                stato: statoDi(p),
                kickoff: g?.start ? new Date(g.start).getTime() : null,
                gioca: g ? g.state : null,     // 'pre' | 'in' | 'post' | null (niente partita)
            });
        }
    }
    const calendarioNoto = voci.some(v => v.gioca);
    const daGiocare = voci.filter(v => v.gioca === 'pre' && v.kickoff);
    const bloccati = voci.filter(v => v.gioca === 'in' || v.gioca === 'post').length;
    // senza partita in calendario = bye; ma solo se il calendario c'e' davvero,
    // se no chiunque risulterebbe in bye
    const bye = calendarioNoto ? voci.filter(v => !v.gioca && v.pos !== '') : [];

    // chi e' in campo adesso, e chi ha gia' finito: restano in lista, ma dopo
    // chi deve ancora giocare — gli avvisi e i prossimi kickoff vengono prima
    const inCorso = perKickoff(voci.filter(v => v.gioca === 'in')).flatMap(g => g.giocatori);
    const giocati = perKickoff(voci.filter(v => v.gioca === 'post' && v.kickoff));

    return { gruppi: perKickoff(daGiocare), inCorso, giocati, bye, bloccati, avvisi: avvisi(voci), calendarioNoto };
}

/** Raggruppa per orario di kickoff; dentro, prima i titolari e poi per proiezione. */
function perKickoff(lista) {
    const perOrario = new Map();
    for (const v of lista) {
        (perOrario.get(v.kickoff) || perOrario.set(v.kickoff, []).get(v.kickoff)).push(v);
    }
    return [...perOrario.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([kickoff, giocatori]) => ({
            kickoff,
            giocatori: giocatori.sort((a, b) => (b.titolare - a.titolare) || ((b.proj ?? -1) - (a.proj ?? -1))),
        }));
}

/**
 * Le cose da sistemare, in ordine di scadenza: prima quello che si blocca per
 * primo. Due tipi:
 *  - `fix`: un titolare che non giochera' (OUT, IR, sospeso, in dubbio grave,
 *    in bye). Lasciarlo li' vale zero punti sicuri.
 *  - `check`: un titolare in dubbio, o un panchinaro che proietta almeno 2
 *    punti piu' di un titolare che potrebbe sostituire.
 * Si suggerisce uno scambio solo se NESSUNO dei due ha gia' cominciato: dopo il
 * kickoff di uno dei due, lo scambio non si puo' piu' fare.
 */
function avvisi(voci) {
    const out = [];
    const libero = (v) => v.gioca === 'pre';
    const titolari = voci.filter(v => v.titolare);
    const panchina = voci.filter(v => !v.titolare && libero(v));
    const sano = (v) => !GRAVITA[v.stato] || GRAVITA[v.stato].livello !== 'fix';

    // il miglior sostituto in panchina per un posto, fra chi gioca ancora
    const sostituto = (slot, escludi) => panchina
        .filter(b => puoGiocare(slot, b.pos) && sano(b) && !escludi.has(b.p.name) && b.proj != null)
        .sort((a, b) => b.proj - a.proj)[0] || null;

    const usati = new Set();
    for (const t of titolari) {
        const g = GRAVITA[t.stato];
        const inBye = !t.gioca && voci.some(v => v.gioca);
        if (!(libero(t) || inBye)) continue;          // gia' in campo: non si tocca piu'
        if (inBye || g?.livello === 'fix') {
            const sost = sostituto(t.slot, usati);
            if (sost) usati.add(sost.p.name);
            out.push({
                livello: 'fix',
                scadenza: [t.kickoff, sost?.kickoff].filter(Boolean).sort((a, b) => a - b)[0] ?? null,
                testo: `${t.p.name} ${inBye ? 'is on bye' : g.testo} — he starts at ${t.slot}.`
                    + (sost ? ` Best bench option: ${sost.p.name} (${sost.proj.toFixed(1)} proj).` : ' No healthy bench option for that slot.'),
                chi: [t.p.name, sost?.p.name].filter(Boolean),
            });
            continue;
        }
        if (g?.livello === 'check') {
            out.push({
                livello: 'check', scadenza: t.kickoff,
                testo: `${t.p.name} ${g.testo} — keep an eye on the inactives before kickoff.`,
                chi: [t.p.name],
            });
        }
    }

    // panchinari che proiettano piu' di un titolare sostituibile
    for (const b of panchina) {
        if (usati.has(b.p.name) || !sano(b) || b.proj == null) continue;
        const peggiore = titolari
            .filter(t => libero(t) && puoGiocare(t.slot, b.pos) && t.proj != null && !GRAVITA[t.stato])
            .map(t => ({ t, guadagno: b.proj - t.proj }))
            .filter(x => x.guadagno >= SOGLIA_SCAMBIO)
            .sort((a, c) => c.guadagno - a.guadagno)[0];
        if (!peggiore) continue;
        usati.add(b.p.name);
        out.push({
            livello: 'check',
            scadenza: Math.min(b.kickoff, peggiore.t.kickoff),
            testo: `Consider starting ${b.p.name} (${b.proj.toFixed(1)} proj) over ${peggiore.t.p.name}`
                + ` (${peggiore.t.proj.toFixed(1)}) at ${peggiore.t.slot}: +${peggiore.guadagno.toFixed(1)}.`,
            chi: [b.p.name, peggiore.t.p.name],
        });
    }

    const pesoLivello = { fix: 0, check: 1 };
    return out.sort((a, b) => ((a.scadenza ?? Infinity) - (b.scadenza ?? Infinity))
        || (pesoLivello[a.livello] - pesoLivello[b.livello]));
}
