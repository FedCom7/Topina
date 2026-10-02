/**
 * Il campo di una partita NFL — lo stato che `fieldStripHTML` disegna — dalle
 * sue giocate: dove sta la palla, il drive in corso, le pastiglie dei drive,
 * l'elenco delle giocate a partita finita.
 *
 * Viveva dentro sections/live.js, dove serve a "Inside the game". Sta qui da
 * quando lo usa anche la pagina delle partite dell'NFL Hub (#nfl-games): due
 * copie dello stesso disegno divergono alla prima correzione. Niente DOM,
 * niente rete: chi chiama passa squadre, stato e giocate.
 */

import { titoloGiocata, tipoGiocata, direzioneGiocata, yardStimate, yardCalcio, fgBuono, tagDrive, eDiServizio, volodelCalcio, testoAzione, azioneAnnullata, cartelloGiocata } from '../ui/field-strip.js?v=148';
import { headshotUrl } from './nfl-plays.js?v=572';
import { teamNameFromAbbr } from './espn-fantasy.js?v=177';
import { ESPN_TEAM_IDS } from './player-map.js?v=513';

/** Sigla NFL da id ESPN: la mappa esiste solo nel verso opposto. */
let _siglaDaId = null;
export function siglaDaId(id) {
    if (!_siglaDaId) {
        _siglaDaId = new Map(Object.entries(ESPN_TEAM_IDS).map(([ab, i]) => [String(i), ab]));
    }
    return _siglaDaId.get(String(id)) || '';
}

/**
 * Le giocate raggruppate in drive, nell'ordine in cui sono successe.
 * L'esito del drive lo dice la sua ultima giocata: e' quella che lo chiude,
 * col touchdown, il punt o la palla persa.
 */
export function drivesDi(tutte) {
    const out = [];
    for (const p of tutte) {
        const id = p.driveId || 'x';
        const ultimo = out[out.length - 1];
        if (ultimo && ultimo.id === id) ultimo.plays.push(p);
        else out.push({ id, plays: [p] });
    }
    return out;
}

/**
 * Lo stato della striscia per una partita.
 *
 * @param o.sigla   la squadra da cui si guarda (entra nella chiave `scena`)
 * @param o.home    { abbr, name, logo, color, color2, score, timeouts }
 * @param o.away    idem
 * @param o.stato   'pre' | 'in' | 'post'
 * @param o.detail  l'etichetta della partita quando non c'e' una giocata
 * @param o.tutte   le giocate, in ordine
 * @param o.scelta  indice scelto dalla timeline, null = si segue il vivo
 */
export function statoPartita({ sigla, home, away, stato, detail, tutte = [], scelta = null }) {
    const g = { state: stato, detail };
    const giocataScelta = scelta;
    // A partita finita si puo' riguardare: `giocataScelta` e' l'indice
    // scelto dalla timeline, null vuol dire "segui il vivo".
    const idx = giocataScelta != null && giocataScelta < tutte.length
        ? giocataScelta : tutte.length - 1;
    const p = tutte[idx] || null;

    // Il drive e' SEMPRE quello della giocata corrente, mai uno stato a parte:
    // due indici da tenere d'accordo si sarebbero sfasati al primo polling.
    // Toccare una pastiglia sposta la giocata, e il drive la segue.
    const gruppi = drivesDi(tutte);
    const dIdx = Math.max(0, gruppi.findIndex(gr => gr.plays.includes(p)));
    const drive = gruppi[dIdx];

    const cartello = cartelloGiocata(p);

    let possesso = null;
    if (p?.offenseTeamId) {
        const idCasa = ESPN_TEAM_IDS[home.abbr];
        possesso = String(p.offenseTeamId) === String(idCasa) ? 'home' : 'away';
    }

    return {
        home, away,
        periodo: p?.period ?? null,
        orologio: p?.clock || g.detail || '',
        down: p?.down || null,
        distance: p?.distance ?? null,
        possesso,
        toEZ: p?.toEZ ?? null,
        stato: g.state || 'pre',
        // La timeline solo a partita conclusa: durante il vivo il campo deve
        // restare sul presente, e una barra che si allunga sotto le dita
        // mentre si guarda sarebbe da combattere invece che da usare.
        timeline: (g.state === 'post' && tutte.length > 1)
            ? { n: tutte.length, i: idx } : null,
        // Dal vivo si guarda quello che sta succedendo, non l'archivio: il
        // recap compare a partita chiusa, insieme alla timeline.
        recap: g.state !== 'post' ? [] : tutte.map((x, k) => ({
            i: k,
            titolo: titoloGiocata(x),
            testo: x.text || '',
            periodo: x.period,
            clock: x.clock,
            // Il down e la distanza dicono il PESO della giocata: un passaggio
            // da otto yard al terzo e sette e uno al primo e dieci sono due
            // cose diverse, e scorrendo l'elenco non si distinguevano.
            dd: x.down ? `${x.down}${['st', 'nd', 'rd', 'th'][Math.min(x.down, 4) - 1]} & ${x.distance ?? 10}` : '',
            segna: !!x.scoring,
            persa: !!x.turnover,
        })).reverse(),
        // Coin toss, fine quarto, timeout: hanno una posizione di comodo
        // (`toEZ 0` con una fine a meta' campo) e tracciavano una riga lunga
        // che non corrisponde a nessuna azione. Non si disegnano.
        // Su un timeout il campo resta vuoto. La giocata e' fuori dalla lista
        // (e' filtrata), quindi `indexOf` dava -1 e l'indice ripiegava su
        // zero: restava acceso il calcio d'inizio del drive.
        giocate: (eUnTimeout(p) || cartello) ? [] :
            (drive?.plays || []).filter(disegnabile).map(x => giocataDisegnabile(x, home, away)),
        giocataIdx: Math.max(0, (drive?.plays || []).filter(disegnabile).indexOf(p)),
        // Le pastiglie della striscia: una per drive, con la sigla dell'esito.
        // L'esito si cerca A RITROSO fra le azioni del drive, non sull'ultima:
        // in coda ci finiscono timeout e trasformazioni, e un drive chiuso col
        // touchdown si leggeva dall'extra point che viene dopo.
        drives: gruppi.map((gr, k) => {
            const utili = gr.plays.filter(x => !eDiServizio(x));
            const fine = utili[utili.length - 1];
            for (let j = utili.length - 1; j >= 0; j--) {
                const t = tagDrive(utili[j].text || '');
                if (t.l !== '—') {
                    return { i: k, tag: t.l, cls: t.c,
                        team: siglaDaId(utili[j].offenseTeamId), res: utili[j].text || '' };
                }
            }
            // Nessuna parola chiave nel testo, ma il DOWN lo sappiamo: un drive
            // che si chiude al quarto senza punt ne' field goal e' finito sui
            // downs. E' il dato che salva la meta' dei drive che restavano
            // senza sigla, e non e' una parola indovinata — c'e' nei fatti.
            // (ESPN ha anche l'esito ufficiale in /drives, ma quella risposta
            // pesa 836 KB per partita perche' ci annida dentro tutte le
            // giocate: troppo per un telefono, e le giocate ce le abbiamo gia'.)
            // ESPN mette il calcio che CHIUDE un drive in testa a quello
            // dopo, come fa col kickoff: un drive finito col punt si leggeva
            // "DWN" perche' l'ultima sua azione era un terzo down fallito.
            const dopo = (gruppi[k + 1]?.plays || []).find(x => !/timeout/i.test(x.text || ''));
            if (/punts?/i.test(dopo?.text || '')) {
                return { i: k, tag: 'PNT', cls: 'punt',
                    team: siglaDaId(fine?.offenseTeamId), res: dopo.text || '' };
            }
            if (fine?.down === 4) {
                return { i: k, tag: 'DWN', cls: 'to',
                    team: siglaDaId(fine.offenseTeamId), res: fine.text || '' };
            }
            return { i: k, tag: '—', cls: 'end', team: '', res: '' };
        // Una pastiglia senza esito non dice niente: si toglie, e il drive
        // resta comunque raggiungibile scorrendo le giocate.
        }).filter(d => d.tag !== '—'),
        driveIdx: dIdx,
        // Identifica CIO' CHE E' DISEGNATO, non lo stato intero: l'orologio
        // e i punteggi cambiano a ogni giro di polling, e ridisegnare l'SVG
        // per quelli faceva ripartire l'animazione della giocata ogni trenta
        // secondi, all'infinito.
        scena: `${sigla}|${dIdx}|${p?.id || ''}|${gruppi.length}`,
        // L'animazione racconta una giocata che ARRIVA. Riguardando l'azione
        // a partita finita non arriva niente — si sta sfogliando — e un
        // secondo e mezzo di attesa a ogni passo, per centosettantotto
        // giocate, e' un impaccio invece di un racconto.
        statico: giocataScelta != null,
        // Un timeout non e' un'azione: sul campo non va disegnato niente, e al
        // posto della giocata si dice chi l'ha chiamato. Prima restava acceso
        // il calcio d'inizio del drive, che non c'entrava nulla.
        timeout: eUnTimeout(p) ? etichettaTimeout(p, home, away) : null,
        // Sorteggio, fine quarto, intervallo, fine partita: una parola sul
        // manto al posto di un'azione che non c'e' stata.
        cartello,
        // `giocata` resta anche col cartello: e' quella che riempie il
        // pannello sotto il campo ("End of Game — END GAME"), e azzerandola
        // spariva la riga insieme al disegno. A non far disegnare niente ci
        // pensa gia' `giocate: []` qui sopra.
        giocata: (p && p.toEZ != null && !eUnTimeout(p))
            ? giocataDisegnabile(p, home, away) : null,
    };
}

/**
 * Una giocata che ha senso disegnare sul campo.
 *
 * NON usa `eDiServizio`: quella esclude anche i calci, perche' serve a un'altra
 * domanda — "com'e' finito il drive?", dove un kickoff non e' l'esito ma cio'
 * che viene dopo. Usarla anche qui buttava via kickoff e punt dal campo, e il
 * pannello raccontava una giocata mentre il disegno ne mostrava un'altra.
 * Qui si tolgono solo le righe che una posizione non ce l'hanno davvero.
 */
export const eUnTimeout = (x) => /timeout/i.test(String(x?.text || ''));

/** "Timeout — Buffalo Bills", o "Official timeout" se non e' di nessuno. */
export function etichettaTimeout(p, home, away) {
    const m = String(p?.text || '').match(/timeout #?[0-9]*\s*by\s+([A-Za-z]{2,3})/i);
    if (!m) return { titolo: 'Official timeout', squadra: '' };
    const sig = m[1].toUpperCase();
    const q = [home, away].find(x => (x.abbr || '').toUpperCase() === sig);
    // Il nome per esteso quando si riesce: nella scheda c'e' spazio, e
    // "Pittsburgh Steelers" si legge meglio di una sigla di tre lettere.
    // La tabella viene PRIMA di `q.name`: li' il nome ripiega sulla sigla
    // quando il tabellone non lo manda, e si finiva per scrivere "Timeout —
    // PIT" pur avendo il nome esteso a disposizione.
    const esteso = teamNameFromAbbr(sig);
    return {
        titolo: 'Timeout',
        squadra: esteso !== sig ? esteso : (q?.name || sig),
    };
}

export const disegnabile = (x) => x.toEZ != null
    && !/^(GAME|END GAME|END QUARTER|END OF|Timeout|Official Timeout|Two-Minute)/i
        .test(String(x.text || '').trim());

/**
 * Da giocata grezza a giocata disegnabile. Sta fuori da `statoCampo` perche'
 * ora serve per OGNI azione del drive, non solo per l'ultima.
 */
export function giocataDisegnabile(p, home, away) {
    const dir = direzioneGiocata(p);
    let tipo = tipoGiocata(p);
    const calcio = yardCalcio(p);
    // Sulla sola azione, come tipoGiocata: la coda della trasformazione
    // parla di un'altra giocata.
    if (/field goal/i.test(testoAzione(p.text))) tipo = 'fg';   // dopo: sovrascrive 'kick'

    // Le yard: quelle ufficiali quando ci sono, quelle del testo per i calci
    // (un punt risulta da zero yard), una stima per gli incompleti.
    let yards = p.yards || 0;
    if (calcio != null) yards = calcio;
    else if (tipo === 'incomplete' && !yards) yards = yardStimate(dir.profondita);

    const idCasa = ESPN_TEAM_IDS[home.abbr];
    const poss = p.offenseTeamId
        ? (String(p.offenseTeamId) === String(idCasa) ? 'home' : 'away') : null;
    const foto = (...ruoli) => {
        const a = p.actors || {};
        for (const r of ruoli) if (a[r]) return headshotUrl(a[r]);
        return '';
    };
    return {
        titolo: titoloGiocata(p),
        testo: p.text || '',
        yards,
        tipo,
        lato: dir.lato,
        buono: fgBuono(p),
        segna: !!p.scoring,
        persa: !!p.turnover,
        penalita: !!p.penalita,
        // Cosa era successo prima del fazzoletto, quando la penalita' annulla
        // la giocata ("- No Play"): serve a disegnarla cancellata.
        annullata: azioneAnnullata(p.text),
        toEZ: p.toEZ,
        // DOVE E' FINITA la palla, non quanto ha percorso: e' il dato che
        // ESPN registra, e sulle giocate dove le due cose non coincidono —
        // i calci prima di tutto — sommare le yard sbagliava di netto.
        toEZFine: p.toEZEnd,
        // Il volo del calcio, letto dal testo: da dove parte e dove atterra.
        // Il tabellino da' solo la raccolta e la fine del ritorno.
        ...(tipo === 'kick' ? volodelCalcio(p.text, home.abbr) : {}),
        possesso: poss,
        logo: poss ? (poss === 'home' ? home.logo : away.logo) : '',
        // Due facce: chi la manda e chi la riceve. Su una corsa e' la stessa
        // persona, quindi la seconda resta vuota.
        // `punter` e non `kicker`: sui punt ESPN usa l'altro nome, e senza
        // questo la faccia di chi calcia non compariva mai.
        fotoDa: foto('passer', 'rusher', 'kicker', 'punter', 'scorer'),
        fotoA: (p.actors?.passer || p.actors?.kicker || p.actors?.punter)
            ? foto('receiver', 'returner') : '',
    };
}
