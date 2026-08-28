/**
 * Draft Strategy — VORP, drop-off e scarsità posizionale sul listone
 * proiettato, per decidere QUALE ruolo privilegiare prima del draft.
 *
 * Diverso da draft-grade.js: quello valuta pick già fatte contro un
 * contro-fattuale di mercato. Questo non guarda alle pick per niente — vive
 * sul listone proiettato e basta, quindi funziona anche PRIMA che il draft
 * esista, che è esattamente quando serve.
 *
 * Baseline: `replacementLevels` di team-eval.js, la stessa usata per il
 * talento nei Draft Grades — ultimo titolare utile per la lega (demandByPos:
 * numTeams × slot, FLEX diviso RB/WR). Niente "waiver level" qui (quello
 * dipende da chi è STATO draftato, non ha senso pre-draft).
 *
 * K/DEF esclusi da VORP/priorità/leaderboard di proposito: Sleeper non li
 * proietta a livello di dettaglio dove questo scoring si discosta (fasce FG,
 * punti subiti), e un VORP costruito su quella proiezione grezza direbbe
 * "prendi il kicker presto", un consiglio sbagliato. Restano nella tabella
 * Board con l'avviso, e rientrano in altri due punti dove la grossolanità
 * non falsa la risposta: `lineupShare` (quanti punti VERI portano a
 * referto, non quanto sono scarsi) e `kdefCompare` (quanto sono PIATTI
 * rispetto alla panchina degli altri ruoli — lì basta l'ordine di
 * grandezza, non la precisione).
 *
 * Il "cliff" (crollo più ripido fra due giocatori consecutivi) riusa
 * l'identica idea già a schermo in draftgrade-team.js:scarcityCard — stessa
 * soglia (12% della scala condivisa), stessa scala verticale su tutti i
 * pannelli, così le altezze si confrontano a occhio invece che a parole.
 *
 * ── Perché la priorità NON è "il crollo più grande in punti" ──────
 * Prima versione: ordinava i ruoli per cliffDrop assoluto, e con questo
 * listone portava fuori "anticipa il QB" — un consiglio che va contro la
 * teoria di lega (value-based drafting: FantasyPros, footballguys, e in
 * generale la letteratura su VORP/VONA/VOLS) e contro il buon senso di chi
 * gioca: il QB ha un pool profondissimo — 32 titolari NFL veri per 4 posti
 * di lega — quindi anche se il distacco IN PUNTI del QB1 è grande, il
 * mercato non lo tratta come scarso, perché chi aspetta trova comunque un
 * titolare più che decente molto più tardi. Il numero che manda fuori
 * strada è il VORP da solo: dice "quanto è forte il primo", non "quanto è
 * rischioso aspettare".
 *
 * La domanda giusta è quella di VONA (Value Over Next Available): quanto
 * perdo se aspetto un giro? Non è calcolabile in diretta senza un draft in
 * corso (dipende da chi prendono gli altri), ma PRIMA del draft si può
 * approssimare con l'ADP di mercato — quando, nei draft veri, quel crollo è
 * già successo. Un crollo enorme in punti che il mercato colloca al pick 60
 * non è mai urgente: ci arrivi comunque. Un crollo anche piccolo che il
 * mercato colloca al pick 10 lo è. Per questo `priority` ordina per
 * `cliffAdp`, non per `cliffDrop` — il secondo resta a spiegare QUANTO
 * costa il crollo, il primo dice QUANDO arriva davvero.
 *
 * Questo risponde anche al secondo pezzo del problema: la squadra va
 * completata tutta, e ogni pick speso su un ruolo profondo (che aspetta
 * bene) è un pick NON speso su uno scarso (che non aspetta) — il costo
 * opportunità è la vera posta in gioco, non il crollo isolato di un ruolo.
 * `needed` (titolari di lega) resta a schermo per la stessa ragione: RB e WR
 * ne servono di più a testa (2 + quota FLEX ciascuno) di QB e TE (1), quindi
 * pesano di più anche a parità di forma della curva.
 */

import { replacementLevels, demandByPos, NUM_TEAMS } from './team-eval.js?v=562';
import { NEED_TARGET, opponentPickProbs } from './draft-grade.js?v=33';

export const STRATEGY_POSITIONS = ['QB', 'RB', 'WR', 'TE'];

/**
 * Palette della vista Draft Strategy: tinte editoriali desaturate, non i
 * colori accesi del resto del sito. Sono i passi per fondo scuro della
 * tavolozza validata della skill dataviz, e passano tutti i controlli
 * (banda di luminosita, chroma, separazione CVD, contrasto sul fondo).
 *
 * Sono QUATTRO tinte, non sei: K e DEF non sono una quinta e una sesta
 * categoria di pari peso, sono la coda — la pagina stessa dice di prenderli
 * per ultimi. Trattarli come neutri e la struttura onesta, ed e anche
 * l'unico modo di far passare i controlli: un grigio caldo messo fra le
 * tinte falliva il chroma floor perche "legge grigio", che e esattamente
 * quello che vogliamo che faccia.
 * L'identita non e mai affidata al solo colore: la sigla del ruolo e
 * scritta dentro ogni casella.
 */
export const POSITION_COLORS = { QB: '#d95926', RB: '#3987e5', WR: '#199e70', TE: '#c98500' };
export const TAIL_COLORS = { K: '#8f8a7d', DEF: '#63676b' };

// suffissi che NON sono un cognome: "Marvin Harrison Jr." -> "Harrison Jr."
const NAME_SUFFIX = /^(jr|sr|ii|iii|iv|v)\.?$/i;
// particelle che fanno PARTE del cognome: "Amon-Ra St. Brown" -> "St. Brown"
const NAME_PARTICLE = /^(st|van|von|de|del|della|di|da|la|le|mac|mc|o)\.?$/i;

/**
 * Solo il cognome, per le tabelle strette. Due casi da non sbagliare:
 * il suffisso resta attaccato (mai un "Jr." da solo al posto del nome) e
 * le particelle fanno parte del cognome.
 */
export function lastName(full) {
    const parts = String(full || '').trim().split(/\s+/).filter(Boolean);
    if (parts.length < 2) return parts[0] || '';
    let end = parts.length - 1;
    let out = [parts[end]];
    if (NAME_SUFFIX.test(parts[end]) && end > 0) { end -= 1; out.unshift(parts[end]); }
    if (end > 0 && NAME_PARTICLE.test(parts[end - 1])) out.unshift(parts[end - 1]);
    return out.join(' ');
}

const CLIFF_MIN_SHARE = 0.12;  // soglia "cliff significativo" sulla scala condivisa (come scarcityCard)
// round totali di una lega di questo tipo: stessa somma di NEED_TARGET (16),
// che è a sua volta ROSTER_SLOTS + BENCH_SIZE + RESERVE_SIZE — un roster pieno.
export const ROUND_MAX = Object.values(NEED_TARGET).reduce((a, b) => a + b, 0);
/**
 * ADP (12-team) riletto come round di QUESTA lega: round = ceil(pick / 4).
 *
 * Regge perché l'ADP è un ORDINE, non un numero di pick legato alla dimensione
 * della lega: il giocatore con ADP 13 è il 13° a uscire dal board in qualunque
 * lega dove tutti seguono il consenso. Quindi "al nostro pick N sono andati i
 * primi N per ADP" vale identico a 4 o a 12 squadre.
 */
export const roundOf = (adp) => adp == null ? null : Math.max(1, Math.min(ROUND_MAX, Math.ceil(adp / NUM_TEAMS)));

/**
 * Jenks natural breaks (k-means 1D esatto, via programmazione dinamica):
 * partiziona valori ORDINATI minimizzando la varianza dentro ogni gruppo.
 *
 * È il metodo standard per i tier di fantasy (Boris Chen usa un mixture model
 * sulla stessa idea): un tier è un insieme di giocatori che "valgono uguale",
 * e questo è esattamente ciò che minimizzare la varianza interna produce —
 * al posto di una soglia a occhio sul salto fra due giocatori consecutivi.
 *
 * Ritorna { starts, sse }: indici di inizio di ogni tier e varianza residua.
 */
function jenks(values, k) {
    const n = values.length;
    const pre = Array(n + 1).fill(0), pre2 = Array(n + 1).fill(0);
    for (let i = 0; i < n; i++) { pre[i + 1] = pre[i] + values[i]; pre2[i + 1] = pre2[i] + values[i] ** 2; }
    // somma degli scarti quadratici del segmento i..j (inclusi), in O(1)
    const sse = (i, j) => {
        const cnt = j - i + 1, s = pre[j + 1] - pre[i], s2 = pre2[j + 1] - pre2[i];
        return s2 - (s * s) / cnt;
    };
    const dp = Array.from({ length: k + 1 }, () => Array(n).fill(Infinity));
    const back = Array.from({ length: k + 1 }, () => Array(n).fill(0));
    for (let j = 0; j < n; j++) dp[1][j] = sse(0, j);
    for (let t = 2; t <= k; t++) {
        for (let j = t - 1; j < n; j++) {
            for (let i = t - 2; i < j; i++) {
                const c = dp[t - 1][i] + sse(i + 1, j);
                if (c < dp[t][j]) { dp[t][j] = c; back[t][j] = i; }
            }
        }
    }
    const starts = [];
    let j = n - 1;
    for (let t = k; t >= 1; t--) { const i = back[t][j]; starts.unshift(t === 1 ? 0 : i + 1); j = i; }
    return { starts, sse: dp[k][n - 1] };
}

/**
 * Confini dei tier: UNIONE di due criteri, e servono tutti e due.
 *
 * 1. Jenks — il più piccolo k che spiega ≥90% della varianza, con k ≤ n/3.
 *    Il tetto n/3 non è cosmetico: senza, con gli 8 QB del pool venivano
 *    fuori sei "tier" da un giocatore l'uno.
 * 2. Ogni salto MATERIALE fra due consecutivi è un confine, per definizione.
 *
 * Il punto 2 è arrivato dopo, per un difetto vero: Jenks minimizza la
 * varianza DENTRO i gruppi e non garantisce affatto che un salto grande
 * finisca su un confine. Sul board 2026 nascondeva −26 fra WR2 e WR3 dentro
 * il primo tier, e perfino −34 fra RB2 e RB3 — il salto più grande dell'intero
 * board dei RB, invisibile. La pagina si ritrovava a dichiarare un cliff che
 * la sua stessa tier map non mostrava.
 *
 * Solo il punto 2 però non basta: dove la discesa è graduale non produce
 * confini per niente, e nel 2022 dava un unico "tier" da RB3 a RB20 — 18
 * giocatori e 50 punti di spread, che tier non è. Da qui l'unione: Jenks
 * spezza le discese lente, i salti garantiscono che nessun cliff resti
 * nascosto. Max 6 tier per ruolo sulle stagioni 2022-2026.
 */
function tierSplit(values, minGap) {
    const n = values.length;
    const kMax = Math.max(2, Math.min(6, Math.floor(n / 3)));
    const base = jenks(values, 1).sse || 1;
    let chosen = null;
    for (let k = 2; k <= kMax; k++) {
        chosen = jenks(values, k);
        if (1 - chosen.sse / base >= 0.90) break;
    }
    const bounds = new Set(chosen ? chosen.starts : [0]);
    bounds.add(0);
    for (let i = 1; i < n; i++) if (values[i - 1] - values[i] >= minGap) bounds.add(i);
    return [...bounds].sort((a, b) => a - b);
}

export const ordinal = (n) => {
    const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
};

/**
 * `byPos`: la stessa struttura di projections.js ({ POS: [{name,team,pts,adp,pick,...}] }),
 * già ordinata per punti proiettati decrescenti. Ritorna null se non c'è
 * abbastanza materiale (proiezioni mancanti per l'anno).
 */
export function computeStrategy(byPos) {
    const demand = demandByPos();

    // il replacement si calcola sull'intero pool proiettato, non sulle pick:
    // è il punto di tutto, funziona anche a board vuoto. K e DEF ci entrano
    // anche loro (servono a computeKdefCompare più sotto): replacementLevels
    // calcola ogni ruolo per conto suo, quindi non cambia nulla per gli altri.
    const pool = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'].flatMap(pos =>
        (byPos[pos] || []).filter(p => p.pts != null).map(p => ({ pos, value: p.pts })));
    if (!pool.length) return null;
    const repl = replacementLevels(pool, 'value');

    // profondità = quanti se ne draftano DAVVERO in una lega di questo tipo,
    // non "quanti superano il replacement". NEED_TARGET è la profondità sana
    // di roster (titolare + panchina attesa, somma a 16 = tutti gli slot),
    // già usata dal motore dei Draft Grades per lo stesso scopo — moltiplicata
    // per le squadre dà il pool leaguewide. Include quindi anche panchinari
    // sotto al replacement (VORP negativo): è li che si vede il resto della
    // curva, non solo dove finiscono i titolari.
    const raw = STRATEGY_POSITIONS.map(pos => {
        const draftPool = Math.round((NEED_TARGET[pos] || 1) * NUM_TEAMS);
        const players = (byPos[pos] || []).filter(p => p.pts != null)
            .slice(0, draftPool)
            .map((p, i) => ({
                name: p.name, team: p.team, pts: p.pts, adp: p.adp, pick: p.pick || null,
                rank: i + 1, vorp: Math.round(p.pts - (repl[pos] || 0)),
            }));
        return { pos, players, draftPool, replacement: Math.round(repl[pos] || 0), needed: Math.round(demand[pos] || 0) };
    }).filter(p => p.players.length >= 3);
    if (!raw.length) return null;

    // stessa scala verticale su tutti i pannelli, come scarcityCard: è quello
    // che rende leggibile "il TE si esaurisce prima del WR" senza scriverlo.
    // Ora include il lato negativo (panchina sotto al replacement).
    const allVorp = raw.flatMap(p => p.players.map(pl => pl.vorp));
    const maxVorp = Math.max(...allVorp, 1);
    const minVorp = Math.min(...allVorp, 0);

    /**
     * Soglia "questo salto conta": una quota del valore SOPRA il replacement,
     * non dell'escursione totale.
     *
     * Prima era `(maxVorp − minVorp) × 0.12`, cioè includeva la coda negativa.
     * Difetto misurato: la profondità del disastro di UN ruolo alzava
     * l'asticella per TUTTI gli altri — nel 2025 i RB scendono a −46 e quel
     * −46 rendeva immateriali i salti di TE e WR, che non c'entrano nulla.
     * Un accoppiamento fra ruoli che non ha giustificazione.
     *
     * Il metro giusto è quanto valore è in palio: si sceglie sempre fra
     * giocatori schierabili, e il fondo del barile non è un posto in cui
     * scegli — è dove finisci se sbagli. Sulle 20 coppie ruolo-anno del
     * 2022-2026 cambia un solo verdetto (TE 2026, salto 14 contro soglia 15.6
     * vecchia e 10.6 nuova) e lo cambia in meglio: quel TE ha davvero tre
     * giocatori e poi il vuoto (T2 va da +5 a −25).
     */
    const materialDrop = maxVorp * CLIFF_MIN_SHARE;

    const positions = raw.map(p => {
        // ── i tier, e da lì TUTTO il resto ────────────────────────────────
        // Il cliff non si cerca più fra due giocatori consecutivi ma fra due
        // TIER. Non è un dettaglio: sul board 2026 il salto più ripido fra
        // consecutivi cadeva dopo RB2 (−34), mentre il crollo che decide la
        // strategia è quello fra il 2° e il 3° tier, dopo RB11 — da lì in poi
        // il miglior RB disponibile vale −31 VORP mentre un WR ne vale ancora
        // 0. Misurando i singoli scalini si vedeva il primo gradino e si
        // perdeva il precipizio.
        const starts = tierSplit(p.players.map(pl => pl.vorp), materialDrop);
        const tiers = starts.map((s, i) => {
            const end = (i + 1 < starts.length ? starts[i + 1] : p.players.length) - 1;
            const members = p.players.slice(s, end + 1);
            const adps = members.map(m => m.adp).filter(a => a != null);
            const top = members[0], bottom = members[members.length - 1];
            return {
                tier: i + 1,
                size: members.length,
                fromRank: top.rank, toRank: bottom.rank,
                topVorp: top.vorp, bottomVorp: bottom.vorp,
                spread: top.vorp - bottom.vorp,
                // punti proiettati grezzi agli estremi del tier: il VORP dice
                // quanto vale il tier, questi dicono di che numeri si parla.
                // Li legge la Tier Analysis del tab Pre-Draft.
                ptsFrom: Math.round(top.pts), ptsTo: Math.round(bottom.pts),
                adpFirst: adps.length ? Math.round(Math.min(...adps)) : null,
                adpLast: adps.length ? Math.round(Math.max(...adps)) : null,
                names: members.map(m => m.name),
            };
        });
        // salto verso il tier successivo, attaccato a chi lo subisce
        tiers.forEach((t, i) => {
            t.dropNext = tiers[i + 1] ? Math.round(t.bottomVorp - tiers[i + 1].topVorp) : null;
            t.material = t.dropNext != null && t.dropNext >= materialDrop;
        });

        /**
         * Il cliff "ufficiale" del ruolo è il PRIMO materiale, non il più
         * grande.
         *
         * Prima prendevo il più grande e per i RB 2026 usciva "dopo RB11"
         * (−31, ADP 26). Vero ma poco azionabile in una lega a 4 squadre: a
         * quel punto hai già avuto sei turni. Quello su cui si decide è il
         * primo, dopo RB3 a ADP 7 — e la letteratura di settore dice la
         * stessa cosa in altri termini: se in un tier restano ancora diversi
         * giocatori puoi aspettare, quindi il salto che conta è quello che
         * chiude il tier in cui stai scegliendo ADESSO.
         *
         * Il salto più profondo non si perde: resta in `deepest`, e a schermo
         * la tier map li disegna comunque tutti.
         *
         * `contested` è la lettura specifica di una lega piccola: un tier con
         * meno giocatori delle squadre non basta per tutti — lì il salto è una
         * corsa. Con 8 giocatori in un tier e 4 squadre, no.
         */
        const materialCliffs = tiers.filter(t => t.material);
        const first = materialCliffs[0] || null;
        // il secondo crollo di cui vale la pena parlare è il più profondo fra
        // quelli che vengono DOPO il primo — non "il più profondo in assoluto",
        // che spesso è il primo stesso e lascerebbe fuori il crollo tardivo.
        // Per i RB 2026 è la differenza fra dire solo "−34 dopo RB2" e dire
        // anche "e poi −31 dopo RB11", che è dove il ruolo si prosciuga.
        const deepest = materialCliffs.length > 1
            ? [...materialCliffs.slice(1)].sort((a, b) => b.dropNext - a.dropNext)[0] : null;
        const adpAfter = (t) => t && p.players[t.toRank]?.adp != null ? Math.round(p.players[t.toRank].adp) : null;

        const at = first ? first.toRank : -1;
        const cliffAdp = adpAfter(first);
        const perTeam = p.needed / NUM_TEAMS; // titolari di QUESTO ruolo per squadra (RB 2.5 con la quota FLEX)

        return {
            ...p,
            tiers,
            cliffAt: at,
            cliffDrop: first ? first.dropNext : 0,
            cliffAdp,
            perTeam,
            // meno giocatori sopra il salto che squadre al draft: è una corsa, non solo un calo
            contested: !!first && first.toRank < NUM_TEAMS,
            // il salto più profondo, quando NON è il primo: "e poi crolla ancora"
            deepest: deepest
                ? { at: deepest.toRank, drop: deepest.dropNext, adp: adpAfter(deepest) }
                : null,
            // il ruolo si esaurisce proprio dove finiscono i posti da titolare della lega
            dryAtDemand: !!deepest && Math.abs(deepest.toRank - p.needed) <= 1,
            // il crollo arriva prima che ogni squadra abbia anche solo la sua quota
            tight: at > 0 && at <= perTeam,
        };
    });

    // leaderboard cross-ruolo: chi vale di più sopra il SUO replacement,
    // ruoli mischiati — "il miglior valore assoluto sul board", non "il
    // migliore del suo ruolo". È la lettura giusta per una lega a 4 squadre:
    // un QB o un TE hanno solo 4 titolari di lega, quindi ci vuole poco perché
    // un RB o un WR di punta valgano di più sopra il proprio replacement.
    const leaderboard = positions
        .flatMap(p => p.players.filter(pl => pl.vorp > 0).map(pl => ({ ...pl, pos: p.pos })))
        .sort((a, b) => b.vorp - a.vorp)
        .slice(0, 20);

    // priorità di ruolo: QUANDO il crollo arriva nel draft vero (cliffAdp),
    // non quanto costa in punti — vedi la nota di testa del file. I ruoli
    // senza un cliff misurabile (cliffAdp null) sono i più sicuri per
    // costruzione: vanno in fondo. A parità di ADP, il crollo più grande in
    // punti (cliffDrop) decide.
    const priority = [...positions].sort((a, b) => {
        const aAdp = a.cliffAdp ?? Infinity, bAdp = b.cliffAdp ?? Infinity;
        return aAdp - bAdp || b.cliffDrop - a.cliffDrop;
    });

    const lineupShare = computeLineupShare(byPos, demand);
    const kdefCompare = computeKdefCompare(byPos, positions, repl);

    /**
     * Pool per la simulazione: TUTTI i ruoli, K e DEF compresi, tagliato a
     * quanti se ne draftano davvero. Somma a numTeams × round = il board
     * intero. Serve solo alla simulazione, che gira su richiesta (vedi
     * simulateDraft) e non a ogni render.
     */
    const simPool = [];
    for (const pos of ['QB', 'RB', 'WR', 'TE', 'K', 'DEF']) {
        const tiersOf = positions.find(p => p.pos === pos)?.tiers || null;
        (byPos[pos] || []).filter(p => p.pts != null)
            // margine sui ruoli skill: col pool esattamente pari ai pick (64
            // giocatori per 64 turni) qualunque deviazione dei rivali lasciava
            // l'ultimo a scegliere fra niente, e la simulazione gli infilava un
            // secondo kicker. K e DEF restano stretti: ne serve uno a testa.
            .slice(0, Math.round((NEED_TARGET[pos] || 1) * NUM_TEAMS * (pos === 'K' || pos === 'DEF' ? 1 : 1.6)))
            .forEach((p, i) => simPool.push({
                key: `${pos}|${i + 1}`, pos, rank: i + 1,
                name: p.name, team: p.team, adp: p.adp,
                pts: Math.round(p.pts),
                vorp: Math.round(p.pts - (repl[pos] || 0)),
                tier: tiersOf?.find(t => i + 1 >= t.fromRank && i + 1 <= t.toRank)?.tier ?? null,
            }));
    }

    return {
        positions, leaderboard, priority, maxVorp, minVorp, numTeams: NUM_TEAMS,
        roundMax: ROUND_MAX, lineupShare, kdefCompare, simPool,
    };
}

/* ─────────────────── Simulazione del draft (Monte Carlo) ───────────────────
 * Gli avversari NON seguono una regola inventata qui: usano
 * `opponentPickProbs` di draft-grade.js, cioè ordine di mercato (ADP) spinto
 * dal fabbisogno di rosa, con softmax. È il modello TARATO su 420 pick e 7350
 * coppie descritto in CLAUDE.md (ADP+need log-loss 4.632 contro 4.760 dell'ADP
 * puro e 5.306 del VOR need-adjusted). Riusarlo invece di riscriverlo è il
 * punto: un secondo modello di avversario che diverge dal primo sarebbe
 * esattamente l'errore dei due motori di voto già pagato una volta.
 *
 * RNG seedato per slot: due aperture della pagina danno lo stesso board.
 * Stesso schema di draft-predictions.js (mulberry32) — lì non è esportato.
 */
function makeRng(seed) {
    let a = seed >>> 0;
    return () => {
        a |= 0; a = a + 0x6D2B79F5 | 0;
        let t = Math.imul(a ^ a >>> 15, 1 | a);
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
}

const SIM_RUNS = 300;      // abbastanza per stabilizzare le percentuali a schermo
const SIM_KDEF_LAST = 2;   // K e DEF solo negli ultimi due giri: vedi sotto
const SIM_TOP_N = 4;       // fra quante opzioni quasi equivalenti si estrae
const SIM_TAU = 5;         // temperatura in punti VORP: bassa = quasi sempre la scelta migliore

// quanto conta un panchinaro rispetto a un titolare: non zero (infortuni,
// esplosioni) ma nemmeno lontanamente uguale. Scelta di design dichiarata.
const BENCH_WEIGHT = 0.15;

/**
 * Quanto questo giocatore migliora la FORMAZIONE, non la rosa.
 *
 * Prima usavo il fabbisogno di profondità (NEED_TARGET: QB 2, TE 2…) e la
 * simulazione prendeva un secondo QB al 5° giro e un secondo TE al 4°: un
 * backup di QB non scende mai in campo, quindi non vale niente, ma per quel
 * criterio il suo VORP alto lo rendeva appetibile. Il metro giusto è il
 * delta sui titolari — che gestisce da solo il FLEX e azzera da solo i
 * doppioni nei ruoli da uno slot.
 */
function myUtility(pl, roster, baseline, empty) {
    const delta = starterVorp([...roster, pl], empty) - baseline;
    if (delta > 0) return delta;
    // Non migliora la formazione: vale come panchina, ma solo fino alla
    // profondita sana del ruolo. Senza questo tetto la simulazione accumulava
    // CINQUE quarterback -- fra i giocatori rimasti il QB ha spesso il VORP
    // grezzo piu alto, e un quinto QB non lo schieri mai.
    const have = roster.filter(r => r.pos === pl.pos).length;
    // K e DEF hanno UNO slot e non si tengono in panchina: si streammano in
    // stagione. Un secondo kicker non serve mai a niente.
    if ((pl.pos === 'K' || pl.pos === 'DEF') && have >= 1) return -Infinity;
    // Tetto RIGIDO alla profondita del ruolo. Prima era un decadimento
    // morbido e la simulazione finiva con SEI quarterback: il VORP di un QB
    // di riserva sta intorno a zero mentre i RB/WR rimasti sono negativi,
    // quindi vinceva sempre lui. Ma confrontare il VORP fra ruoli per la
    // PANCHINA non vuol dire niente: un terzo QB non scende mai in campo,
    // un quinto ricevitore si. Quando il tetto blocca tutto, il fallback nel
    // simulatore prende comunque il migliore rimasto: non si passa il turno.
    if (have >= (NEED_TARGET[pl.pos] || 1)) return -Infinity;
    return pl.vorp * BENCH_WEIGHT;
}

/**
 * Simula il draft `SIM_RUNS` volte. `mode` decide COME giocano gli avversari:
 *
 *  - 'optimal'   — tutti massimizzano la propria formazione sulle proiezioni.
 *                  Risponde a "come si distribuirebbe il valore se giocassero
 *                  tutti bene": un riferimento teorico, non una previsione.
 *  - 'realistic' — gli avversari usano `opponentPickProbs` di draft-grade.js,
 *                  il modello TARATO su 420 pick (ADP spinto dal fabbisogno).
 *                  Risponde a "cosa succedera davvero".
 *
 * A schermo NON si mostra il board "modale" (per ogni casella il giocatore
 * piu frequente): scegliendo ogni casella per conto suo si ottiene un board
 * che nessuna simulazione ha mai prodotto — nel test lo stesso ricevitore
 * usciva sia al 5o sia al 6o giro, impossibile in un draft vero. Si mostra
 * un draft RAPPRESENTATIVO (quello dalla formazione di valore mediano),
 * coerente per costruzione, con le percentuali aggregate su tutte le run.
 */
export function simulateDraft(simPool, mySlot, mode = 'optimal') {
    if (!simPool?.length) return null;
    /**
     * Seme indipendente da `mySlot`: il draft e UN OGGETTO SOLO, proprieta del
     * board e delle regole, non di chi lo sta guardando. Prima il seme era
     * (mySlot+1)*7919 e bastava cambiare capsula per rigenerare tutta la
     * sequenza casuale: le caselle si muovevano come se i giocatori cambiassero
     * squadra. Il selettore ora sposta solo l'evidenziazione.
     */
    const rng = makeRng(mode === 'optimal' ? 7919 : 104729);
    const empty = emptyCosts(simPool);
    const slots = Array.from({ length: NUM_TEAMS }, (_, i) => i + 1);

    const tally = slots.map(() => Array.from({ length: ROUND_MAX }, () => ({ pos: new Map(), key: new Map() })));
    const runsOut = [];
    /**
     * A che pick e uscito ciascun giocatore, run per run. Serve per la
     * percentuale a schermo, che deve dire "quanto spesso e ANCORA LI a quel
     * turno" — non "quanto spesso viene preso esattamente li", che e un
     * numero quasi sempre minuscolo e non aiuta a decidere niente.
     */
    const takenAt = new Map(simPool.map(p => [p.key, []]));

    for (let run = 0; run < SIM_RUNS; run++) {
        const avail = new Map(simPool.map(p => [p.key, p]));
        const rosters = Object.fromEntries(slots.map(s => [s, []]));
        const picks = slots.map(() => Array(ROUND_MAX).fill(null));
        const oppCache = new Map();

        for (let r = 1; r <= ROUND_MAX; r++) {
            /**
             * ORDINE SNAKE. Prima il ciclo era sempre [1,2,3,4] a ogni giro:
             * lo slot 1 sceglieva per primo anche nei giri pari, quindi si
             * prendeva sempre il numero uno del board da qualunque posizione
             * si guardasse. Il numero di pick mostrato era giusto, l'ordine
             * reale no.
             */
            const order = r % 2 === 1 ? slots : [...slots].reverse();
            for (const s of order) {
                const pickNo = pickNumber(s, r);
                const mine = rosters[s];
                let pool = [...avail.values()];
                if (!pool.length) continue;

                /**
                 * Rosa VALIDA per tutti, non solo per chi guarda. K e DEF
                 * stanno oltre il pick 200 nell'ADP, quindi col modello di
                 * mercato nessun avversario li prendeva mai e finiva la
                 * simulazione con una formazione incompleta. Quando i giri
                 * rimasti bastano appena a coprire gli slot obbligatori, si
                 * pesca solo fra quelli — come in un draft vero.
                 */
                const missing = ['K', 'DEF'].filter(pos => !mine.some(x => x.pos === pos));
                if (missing.length >= ROUND_MAX - r + 1) {
                    const forced = pool.filter(p => missing.includes(p.pos));
                    if (forced.length) pool = forced;
                }

                let chosen = null;
                // Tutte e quattro le squadre giocano con lo stesso criterio:
                // in 'optimal' ottimizzano tutte, in 'realistic' seguono tutte
                // il mercato. Prima ottimizzava solo la squadra di chi guardava
                // e le altre no, quindi cambiando slot cambiava la stanza.
                const optimizes = mode === 'optimal';

                if (optimizes) {
                    // basta il migliore di ogni ruolo: dentro un ruolo il VORP
                    // piu alto domina sempre, quindi da ~90 candidati a sei.
                    const bestPer = new Map();
                    const late = r > ROUND_MAX - SIM_KDEF_LAST;
                    for (const p of pool) {
                        if (!late && (p.pos === 'K' || p.pos === 'DEF') && pool.some(q => q.pos !== 'K' && q.pos !== 'DEF')) continue;
                        const cur = bestPer.get(p.pos);
                        if (!cur || p.vorp > cur.vorp) bestPer.set(p.pos, p);
                    }
                    const cand = bestPer.size ? [...bestPer.values()] : pool;
                    const baseline = starterVorp(mine, empty);
                    const scored = cand
                        .map(p => ({ p, u: myUtility(p, mine, baseline, empty) }))
                        .filter(x => Number.isFinite(x.u))
                        .sort((a, b) => b.u - a.u);

                    if (scored.length) {
                        // Softmax sulle opzioni quasi equivalenti: il rumore
                        // serve a rendere leggibile la percentuale a schermo
                        // ("quanto e sicura questa pick"). Con la temperatura
                        // bassa una scelta nettamente migliore resta tale.
                        const top = scored.slice(0, SIM_TOP_N);
                        const max = top[0].u;
                        let z = 0;
                        for (const c of top) { c.w = Math.exp((c.u - max) / SIM_TAU); z += c.w; }
                        let x = rng() * z, acc = 0;
                        for (const c of top) { acc += c.w; if (x <= acc) { chosen = c.p; break; } }
                        if (!chosen) chosen = top[0].p;
                    }
                } else {
                    const probs = opponentPickProbs(pool, mine, pickNo, null, oppCache);
                    oppCache.delete(pickNo);
                    let x = rng(), acc = 0;
                    for (const [key, pr] of probs) { acc += pr; if (x <= acc) { chosen = avail.get(key); break; } }
                }

                if (!chosen) {
                    // Al draft non si passa il turno. Mai un secondo K o una
                    // seconda DEF: e l'unico vincolo non negoziabile.
                    const has = (pos) => mine.some(x => x.pos === pos);
                    const ok = pool.filter(p => !((p.pos === 'K' && has('K')) || (p.pos === 'DEF' && has('DEF'))));
                    const from = ok.length ? ok : pool;
                    chosen = from.reduce((a, b) => (b.vorp > a.vorp ? b : a), from[0]);
                }

                avail.delete(chosen.key);
                takenAt.get(chosen.key).push(pickNo);
                rosters[s].push(chosen);
                picks[s - 1][r - 1] = chosen;
                const t = tally[s - 1][r - 1];
                t.pos.set(chosen.pos, (t.pos.get(chosen.pos) || 0) + 1);
                t.key.set(chosen.key, (t.key.get(chosen.key) || 0) + 1);
            }
        }
        runsOut.push({ total: starterVorp(rosters[mySlot], empty), picks });
    }

    /**
     * Il draft rappresentativo e il piu TIPICO: quello le cui scelte
     * coincidono piu spesso con quelle che le 300 simulazioni fanno in
     * quella casella. Prima era "quello dal valore mediano della MIA
     * squadra", che dipendeva da chi guardava — seconda causa per cui il
     * board si muoveva al cambio di capsula.
     */
    /** quota di run in cui `key` e ancora sul board al pick `P`. */
    const availPct = (key, P) => {
        const list = takenAt.get(key) || [];
        if (!list.length) return 1;
        return list.filter(v => v >= P).length / SIM_RUNS;
    };

    const typicality = (run) => {
        let acc = 0;
        for (let si = 0; si < NUM_TEAMS; si++) {
            for (let r = 0; r < ROUND_MAX; r++) {
                const pl = run.picks[si][r];
                if (pl) acc += tally[si][r].key.get(pl.key) || 0;
            }
        }
        return acc;
    };
    const rep = runsOut.reduce((a, b) => (typicality(b) > typicality(a) ? b : a), runsOut[0]);
    // la forbice di valore resta invece riferita allo slot scelto: e una
    // lettura del board, non il board
    const sortedRuns = [...runsOut].sort((a, b) => a.total - b.total);

    // righe in ordine FISSO di slot: a schermo cambia solo l'evidenziazione
    const board = slots.map(s => ({
        slot: s,
        mine: s === mySlot,
        points: rosterPoints(rep.picks[s - 1].filter(Boolean)),
        rounds: Array.from({ length: ROUND_MAX }, (_, i) => {
            const pl = rep.picks[s - 1][i];
            const t = tally[s - 1][i];
            return {
                round: i + 1, pick: pickNumber(s, i + 1),
                pos: pl?.pos || null,
                // quanto spesso a quel turno esce QUEL ruolo, e quel giocatore
                posPct: pl ? Math.round((t.pos.get(pl.pos) || 0) / SIM_RUNS * 100) : 0,
                name: pl?.name || null, tier: pl?.tier ?? null, vorp: pl?.vorp ?? null,
                // ancora disponibile a quel turno = uscito a quel pick o dopo
                namePct: pl ? Math.round(availPct(pl.key, pickNumber(s, i + 1)) * 100) : 0,
            };
        }),
    }));

    return {
        runs: SIM_RUNS, slot: mySlot, mode, board,
        starterVorp: {
            median: Math.round(sortedRuns[Math.floor(sortedRuns.length / 2)].total),
            low: Math.round(sortedRuns[Math.floor(sortedRuns.length * 0.1)].total),
            high: Math.round(sortedRuns[Math.floor(sortedRuns.length * 0.9)].total),
        },
    };
}


/**
 * VORP dei soli titolari di una rosa simulata (QB, RB2, WR2, TE, FLEX RB/WR).
 *
 * `empty` è quanto costa uno slot SCOPERTO, per ruolo. Non è un dettaglio:
 * senza, uno slot vuoto valeva 0 e la simulazione preferiva lasciare l'RB2
 * scoperto piuttosto che riempirlo con un RB da −31 — salvo poi doverci
 * comunque schierare qualcuno la domenica. Uno slot vuoto vale il livello
 * WAIVER, cioè il miglior giocatore non draftato di quel ruolo, che in una
 * lega a 4 squadre sta anche sotto −40. È lo stesso errore, in un altro
 * punto, di azzerare il VORP negativo.
 */
function starterVorp(roster, empty) {
    const by = {};
    for (const p of roster) (by[p.pos] = by[p.pos] || []).push(p);
    for (const l of Object.values(by)) l.sort((a, b) => b.vorp - a.vorp);
    let tot = 0;
    const used = new Set();
    for (const [pos, n] of Object.entries(STARTER_NEED)) {
        for (let i = 0; i < n; i++) {
            const p = (by[pos] || [])[i];
            if (p) { tot += p.vorp; used.add(p); }
            else tot += empty?.[pos] ?? 0;
        }
    }
    const flex = FLEX_FROM.flatMap(pos => (by[pos] || []).filter(p => !used.has(p)))
        .sort((a, b) => b.vorp - a.vorp)[0];
    if (flex) tot += flex.vorp;
    else tot += Math.max(...FLEX_FROM.map(pos => empty?.[pos] ?? 0));
    return tot;
}

/**
 * Punti PROIETTATI (non VORP) divisi fra titolari e panchina, per la
 * colonna a sinistra del board. I titolari sono la formazione migliore
 * schierabile con quella rosa, il resto e panchina.
 */
function rosterPoints(roster) {
    const by = {};
    for (const p of roster) (by[p.pos] = by[p.pos] || []).push(p);
    for (const l of Object.values(by)) l.sort((a, b) => b.pts - a.pts);
    const used = new Set();
    let starters = 0;
    for (const [pos, n] of Object.entries({ ...STARTER_NEED, K: 1, DEF: 1 })) {
        for (let i = 0; i < n; i++) {
            const p = (by[pos] || [])[i];
            if (p) { starters += p.pts; used.add(p); }
        }
    }
    const flex = FLEX_FROM.flatMap(pos => (by[pos] || []).filter(p => !used.has(p)))
        .sort((a, b) => b.pts - a.pts)[0];
    if (flex) { starters += flex.pts; used.add(flex); }
    const bench = roster.filter(p => !used.has(p)).reduce((a, p) => a + p.pts, 0);
    return { starters: Math.round(starters), bench: Math.round(bench) };
}

/** Costo di uno slot scoperto per ruolo: il peggiore ancora draftabile ≈ il waiver. */
function emptyCosts(simPool) {
    const out = {};
    for (const p of simPool) out[p.pos] = Math.min(out[p.pos] ?? Infinity, p.vorp);
    return out;
}

/** Numero di pick assoluto per (slot, round) in uno snake a NUM_TEAMS squadre. */
export function pickNumber(slot, round) {
    const base = (round - 1) * NUM_TEAMS;
    return round % 2 === 1 ? base + slot : base + (NUM_TEAMS + 1 - slot);
}

// i titolari "skill" da coprire, in ordine di scarsità di slot. K e DEF non
// entrano nel piano: si prendono negli ultimi due giri e la card dedicata
// spiega perché (fra loro non c'è praticamente scelta).
const STARTER_NEED = { QB: 1, RB: 2, WR: 2, TE: 1 };
const FLEX_FROM = ['RB', 'WR']; // il FLEX di questa lega, da league-rules


/**
 * Quanta parte del punteggio di una squadra MEDIA viene da ciascun reparto —
 * il "valore assoluto" chiesto, ma riferito alla tua formazione intera
 * invece che al singolo miglior giocatore. Include K e DEF apposta: qui non
 * si giudica la scarsità (dove una proiezione grezza fuorvierebbe la
 * classifica), solo quanti punti veri portano a referto ogni settimana.
 *
 * Titolari SOLI, non tutto il roster: `demand[pos]` è già "quanti ne
 * servono in campo in tutta la lega" (FLEX diviso RB/WR compreso), diviso le
 * squadre dà i punti medi di UNA squadra da quel reparto.
 */
function computeLineupShare(byPos, demand) {
    const ALL_POS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];
    const rows = ALL_POS.map(pos => {
        const list = (byPos[pos] || []).filter(p => p.pts != null).slice(0, Math.round(demand[pos] || 0));
        const teamPts = list.reduce((s, p) => s + p.pts, 0) / NUM_TEAMS;
        return { pos, teamPts: Math.round(teamPts) };
    }).filter(r => r.teamPts > 0);
    const total = rows.reduce((s, r) => s + r.teamPts, 0) || 1;
    return rows
        .map(r => ({ ...r, pct: Math.round(r.teamPts / total * 100) }))
        .sort((a, b) => b.teamPts - a.teamPts);
}

/**
 * "Panchinari prima delle difese?" — confronta quanto è ampio lo scarto fra
 * il migliore e il peggiore rimasto nell'ultima fascia di CIASCUN reparto.
 * Se K/DEF hanno uno scarto minuscolo (si equivalgono, si streaming in
 * stagione) e la panchina di RB/WR/QB/TE no, conviene riempire quella prima:
 * scegliere fra loro conta, fra i K no. Riusa `repl` già calcolato — qui
 * esteso a K/DEF con lo stesso metodo, avviso incluso nel testo a schermo.
 */
function computeKdefCompare(byPos, positions, repl) {
    // coda di panchina di ogni ruolo skill: dal primo NON titolare di lega in poi
    const benchRows = positions
        .filter(p => p.players.length > p.needed)
        .map(p => {
            const tail = p.players.slice(p.needed);
            if (tail.length < 2) return null;
            return { pos: p.pos, label: p.pos, a: tail[0].vorp, b: tail[tail.length - 1].vorp };
        }).filter(Boolean);

    const kdefRows = ['K', 'DEF'].map(pos => {
        const list = (byPos[pos] || []).filter(p => p.pts != null)
            .map(p => Math.round(p.pts - (repl[pos] || 0)));
        if (list.length < 2) return null;
        return { pos, label: pos, a: list[0], b: list[Math.min(list.length, NUM_TEAMS) - 1] };
    }).filter(Boolean);

    return [...benchRows, ...kdefRows]
        .map(r => ({ ...r, span: Math.round(r.a - r.b) }))
        .sort((a, b) => b.span - a.span);
}
