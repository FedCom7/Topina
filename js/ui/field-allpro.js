/**
 * Il campo orizzontale delle formazioni — quello della card All-Pro e della
 * finale in home, e la rosa della pagina squadra.
 *
 * Stava dentro `sections/home.js`, che era l'unico posto a disegnarlo. Da
 * quando lo usa anche la pagina squadra vive qui: due copie di una geometria
 * fatta di numeri tarati a mano (la profondità delle end zone, la larghezza
 * stimata dei nomi, lo scarto delle due metà campo) divergono alla prima
 * correzione fatta da una parte sola.
 *
 * Il disegno del singolo giocatore è in `field-formation.js` ed è lo stesso
 * del campo VERTICALE della pagina squadra NFL: qui c'è solo il campo
 * sdraiato, le due metà e le end zone.
 */
import { fieldMarker, fieldClipDefs } from './field-formation.js?v=3';
import { esc } from '../data/player-search-core.js?v=13';

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
export const AP_FD = { W: 53.3, spanX: 48, vbW: 1000, vbH: 560, losY: 13.3, ez: 6 };
export const apX = (fx) => (fx / AP_FD.spanX) * AP_FD.vbW;
export const apY = (fy) => (fy / AP_FD.W) * AP_FD.vbH;

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
export const AP_PRO_SET = {
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

/* ── La panchina ───────────────────────────────────────────────────
   Non è uno schieramento e non sta in campo: sta A BORDO CAMPO, sulla fascia
   di fuoricampo dietro la linea laterale, com'è su un campo vero. Il disegno
   si allunga verso il basso di `AP_BENCH_H` unità — il terreno di gioco resta
   alto esattamente quanto prima, così i titolari non si spostano di un pixel
   rispetto al campo della home. */
const AP_BENCH_H = 132;
const AP_BENCH_PAD = 74;   // margine laterale della fascia: la panchina non arriva ai bordi
// (24 − fy) / (24 − losY): converte la profondità "vera" fy di OFFENSE_SLOTS
// nella frazione 0..1 di UNA metà campo usata da apX — 1 = sulla linea/al
// centro dei due campi, 0 = il proprio fondo.
const apDepthFrac = (fy) => (AP_FD.spanX / 2 - fy) / (AP_FD.spanX / 2 - AP_FD.losY);

/** Un marker di formazione (giocatore o disco vuoto della linea), sul lato `side` (1 sinistra, 2 destra specchiata). */
export function apMarker({ fx, fy, label, player, side, abbr, year, clipId }) {
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
export function apEndZones(left, right) {
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
export function fitEndZones(root) {
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
export function apFieldMarkings() {
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
export function apYardNumbers() {
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
/**
 * @param {Object} o
 * @param {Object} o.left   - { lineup, name, color, logo, label?, set? }
 * @param {Object} o.right  - idem. `set` è lo schema dei posti: senza, il Pro
 *                            Set dei titolari.
 * @param {Array}  [o.bench] - i riservisti, che NON vanno in campo: si disegnano
 *                            sulla fascia di fuoricampo sotto la linea laterale.
 * @param {string} [o.benchName] - l'etichetta della fascia (default «BENCH»).
 */
export function apFieldSvg({ left, right, year, clipId, cls = '', label, bench = null, benchName }) {
    const benchList = bench?.length ? bench : null;
    const vbH = AP_FD.vbH + (benchList ? AP_BENCH_H : 0);
    const formation = (team, side) => {
        // Un lato senza formazione non si disegna affatto: la linea offensiva
        // vuota è la SAGOMA di uno schieramento, e senza nessuno schierato
        // restavano cinque dischi grigi in mezzo al prato dell'avversaria.
        if (!team?.lineup?.length) return '';
        const set = team.set || AP_PRO_SET;
        const players = (team.lineup || []).map(({ slot, player }, i) =>
            set.slots[i] ? apMarker({ ...set.slots[i], label: slot, player, side, abbr: player?.nfl, year, clipId }) : '');
        const ol = set.emptyOL.map(pos => apMarker({ ...pos, label: 'OL', player: null, side, clipId }));
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
            <svg class="nfl-fd2-svg" viewBox="0 0 ${AP_FD.vbW} ${vbH}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="${esc(label)}">
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
                ${benchList ? apBench(benchList, { year, clipId, name: benchName }) : ''}
            </svg>
        </div>
    </div>`;
}
/* ── Mezzo campo, in piedi ─────────────────────────────────────────
   Il campo qui sopra è due mezzi campi appaiati, e serve quando le squadre
   sono due. Con UNA squadra sola metà disegno è prato vuoto: questo è lo
   STESSO campo — stesse unità, stessa scala, stessi posti dei giocatori —
   preso per la sua metà e messo in piedi, così la card è alta invece che larga
   e i giocatori vengono grandi il doppio.

   Gli assi si scambiano: la larghezza del campo (53.3 yd), che là correva
   lungo Y, qui corre lungo X.

   L'END ZONE STA IN ALTO ed è quella in cui si SEGNA, non la propria: la
   squadra la guarda, e i numeri di campo scendono da lì (10, 20, 30, 40) fino
   alla linea di metà campo in fondo. Col verso opposto — la propria end zone
   in cima — si vedeva una squadra che scappa dal fondo campo: la stessa
   formazione, raccontata al contrario.

   `u` sono le unità di schieramento del campo disteso, contate dalla propria
   end line: u = spanX/2 è la linea delle 50, u più piccolo vuol dire più
   arretrato. Qui si traduce in "quanto lontano dalla end zone da attaccare". */
const HF_U = AP_FD.vbW / AP_FD.spanX;          // pixel per unità di schieramento
const HF_EZ = AP_FD.ez * HF_U;                 // profondità della end zone
const HF_HALF = AP_FD.spanX / 2;               // la linea delle 50, in unità

const hfU = (u) => HF_EZ + (HF_HALF - u) * HF_U;     // unità di schieramento → Y
const hfYd = (yd) => HF_EZ + yd * 0.36 * HF_U;       // yard dalla goal line → Y

/* Il campo finisce dove finisce la formazione, non alle 50: i giocatori più
   arretrati sono K e DEF, e sotto di loro restavano centoquaranta unità di
   prato vuoto. È una vista di formazione, non una mappa — il campo disteso fa
   lo stesso, comprimendo cento yard in trentasei unità. */
const HF_DEEP_U = Math.min(...AP_PRO_SET.slots.map(sl => apDepthFrac(sl.fy) * HF_HALF));
const AP_HF = { vbW: AP_FD.vbH, vbH: hfU(HF_DEEP_U) + 46 };
const hfX = (fx) => (fx / AP_FD.W) * AP_HF.vbW;       // laterale: identico ad apY

/** Un giocatore sul mezzo campo verticale, con le coordinate del Pro Set. */
function hfMarker({ fx, fy, label, player, abbr, year, clipId }) {
    return fieldMarker({
        x: hfX(fx), y: hfU(apDepthFrac(fy) * (AP_FD.spanX / 2)),
        label, player, side: 'first', abbr, year, clipId,
    });
}

/** Bande, yard line, numeri e hash — le stesse del campo disteso, in verticale. */
function hfMarkings() {
    let s = '';
    const lastYd = Math.floor((AP_HF.vbH - HF_EZ) / (0.36 * HF_U));
    for (let y = 0; y < lastYd; y += 10) {                   // bande di prato alternate
        const y1 = hfYd(y + 5), y2 = Math.min(hfYd(y + 10), AP_HF.vbH);
        if (y2 <= y1) break;
        s += `<rect x="0" y="${y1.toFixed(1)}" width="${AP_HF.vbW}" height="${(y2 - y1).toFixed(1)}" class="nfl-fd2-band"/>`;
    }
    for (let y = 0; y <= lastYd; y += 5) {
        const yy = hfYd(y).toFixed(1);
        s += `<line x1="0" y1="${yy}" x2="${AP_HF.vbW}" y2="${yy}" class="nfl-fd2-yl"${y % 10 ? ' opacity="0.6"' : ''}/>`;
    }
    const tick = 9;
    for (let y = 1; y < lastYd; y++) {
        if (y % 5 === 0) continue;                           // dove c'è già la yard line
        const yy = hfYd(y).toFixed(1);
        for (const fx of [23.58, 29.72]) {                   // le due file interne, misure NFL
            const x = hfX(fx);
            s += `<line x1="${(x - tick / 2).toFixed(1)}" y1="${yy}" x2="${(x + tick / 2).toFixed(1)}" y2="${yy}" class="nfl-fd2-hash"/>`;
        }
        s += `<line x1="0" y1="${yy}" x2="${tick}" y2="${yy}" class="nfl-fd2-hash"/>`;
        s += `<line x1="${(AP_HF.vbW - tick).toFixed(1)}" y1="${yy}" x2="${AP_HF.vbW}" y2="${yy}" class="nfl-fd2-hash"/>`;
    }
    return s;
}

/** I numeri di campo, girati verso la propria linea laterale come su un campo vero. */
function hfYardNumbers() {
    const FS = 26, gap = FS * 0.42;
    let s = '';
    for (let y = 10; y <= 40; y += 10) {
        const num = String(y).padStart(2, '0');
        const cy = hfYd(y);
        for (const [fx, rot] of [[9, 90], [AP_FD.W - 9, -90]]) {
            const cx = hfX(fx);
            /* Ruotati verso la propria laterale: le cifre restano in piedi per
               chi guarda la partita da quel lato, come sul campo vero. L'ordine
               si ribalta con la rotazione — a +90° si legge dall'alto in basso,
               a -90° dal basso in alto — e sbagliarlo dà «05» al posto di «50». */
            const [d1, d2] = rot === 90 ? [num[0], num[1]] : [num[1], num[0]];
            for (const [d, dy] of [[d1, -gap], [d2, gap]]) {
                const py = cy + dy;
                s += `<text x="${cx.toFixed(1)}" y="${py.toFixed(1)}" text-anchor="middle" dominant-baseline="central"
                    transform="rotate(${rot} ${cx.toFixed(1)} ${py.toFixed(1)})" class="nfl-fd2-num" style="font-size:${FS}px">${d}</text>`;
            }
            // La freccia punta alla end zone da attaccare, cioè verso l'alto
            const by = cy - gap - FS * 0.62, half = FS * 0.16, tip = by - FS * 0.3;
            s += `<path d="M ${(cx - half).toFixed(1)} ${by.toFixed(1)} L ${(cx + half).toFixed(1)} ${by.toFixed(1)} L ${cx.toFixed(1)} ${tip.toFixed(1)} Z" class="nfl-fd2-arrow"/>`;
        }
    }
    return s;
}

/**
 * Mezzo campo in piedi con UNA formazione e, sotto, la panchina.
 *
 * @param {Object} o
 * @param {Object} o.team       - { lineup, name, color, logo }
 * @param {Array}  [o.bench]    - i riservisti, sulla fascia di fuoricampo
 * @param {string} [o.benchName]
 */
export function apHalfFieldSvg({ team, bench = null, year, clipId, cls = '', label, benchName }) {
    const benchList = bench?.length ? bench : null;
    const vbH = AP_HF.vbH + (benchList ? AP_BENCH_H : 0);
    const set = team.set || AP_PRO_SET;
    const men = (team.lineup || []).map(({ slot, player }, i) =>
        set.slots[i] ? hfMarker({ ...set.slots[i], label: slot, player, abbr: player?.nfl, year, clipId }) : '').join('');
    const ol = set.emptyOL.map(pos => hfMarker({ ...pos, label: 'OL', player: null, clipId })).join('');
    const ezH = hfYd(0), ezY = 0;   // la end zone è la fascia in cima
    /* La linea delle 50 è il fondo del proprio mezzo campo, cioè `spanX/2`
       unità dalla propria end line. `AP_FD.losY` è invece una PROFONDITÀ di
       schieramento, e passata qui piazzava la riga tratteggiata in mezzo alla
       formazione. */
    const losY = hfU(AP_FD.spanX / 2);
    return `
    <div class="nfl-fd2 nfl-fd2--half ${cls}">
        <svg class="nfl-fd2-svg" viewBox="0 0 ${AP_HF.vbW} ${vbH.toFixed(1)}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="${esc(label)}">
            <defs>${fieldClipDefs(clipId)}</defs>
            <rect x="0" y="0" width="${AP_HF.vbW}" height="${AP_HF.vbH.toFixed(1)}" class="nfl-fd2-turf"/>
            ${hfMarkings()}
            ${hfYardNumbers()}
            <g class="mc-duel-ez" style="--team-color:${team.color || 'var(--accent-red)'}">
                <rect x="0" y="0" width="${AP_HF.vbW}" height="${HF_EZ.toFixed(1)}" class="mc-duel-ez-fill"/>
                <line x1="0" y1="${HF_EZ.toFixed(1)}" x2="${AP_HF.vbW}" y2="${HF_EZ.toFixed(1)}" class="mc-duel-ez-goal"/>
                ${/* In piedi la scritta si legge dritta: niente rotazione, e
                      niente fitEndZones — il nome si dimensiona qui una volta
                      sola, sulla larghezza del campo. */''}
                ${hfEzMark(team, HF_EZ / 2)}
            </g>
            ${ol}${men}
            ${benchList ? apBench(benchList, { year, clipId, name: benchName, y0: AP_HF.vbH, w: AP_HF.vbW }) : ''}
        </svg>
    </div>`;
}

/** Logo e nome dentro la propria end zone, in orizzontale. */
function hfEzMark(team, cy) {
    const name = (team.name || '').toUpperCase();
    const depth = HF_EZ;
    const LOGO = depth * 0.72, GAP = LOGO * 0.24;
    const FS = Math.min(depth * 0.5, (AP_HF.vbW * 0.9 - LOGO - GAP) / apTextEm(name));
    const x = (AP_HF.vbW - (LOGO + GAP + apTextEm(name) * FS)) / 2;
    return `${team.logo ? `<image href="${team.logo}" x="${x.toFixed(1)}" y="${(cy - LOGO / 2).toFixed(1)}"
            width="${LOGO.toFixed(1)}" height="${LOGO.toFixed(1)}" class="mc-duel-ez-logo" preserveAspectRatio="xMidYMid meet"/>` : ''}
        <text x="${(x + LOGO + GAP).toFixed(1)}" y="${cy.toFixed(1)}" dominant-baseline="central"
              class="mc-duel-ez-name" style="font-size:${FS.toFixed(1)}px">${esc(name)}</text>`;
}

/**
 * La panchina a bordo campo: la fascia di fuoricampo sotto la linea laterale,
 * con i sei di riserva in fila come stanno davvero, spalle al campo.
 *
 * La riga di dischi è una sola: su due file i nomi della fila dietro finivano
 * sotto ai dischi davanti. Sei dischi su mille unità ci stanno larghi.
 */
function apBench(list, { year, clipId, name, y0 = AP_FD.vbH, w = AP_FD.vbW }) {
    name = name || 'BENCH';
    const cy = y0 + AP_BENCH_H * 0.46;   // non a metà: sotto al disco ci vanno nome e ruolo
    const pad = Math.min(AP_BENCH_PAD, w * 0.07);
    const usable = w - pad * 2;
    const step = usable / list.length;
    const men = list.map(({ slot, player }, i) => fieldMarker({
        x: pad + step * (i + 0.5), y: cy,
        label: slot, player, side: 'first', abbr: player?.nfl, year, clipId,
    })).join('');
    return `
    <g class="nfl-fd2-bench">
        <rect x="0" y="${y0}" width="${w}" height="${AP_BENCH_H}" class="nfl-fd2-bench-area"/>
        <line x1="0" y1="${y0}" x2="${w}" y2="${y0}" class="nfl-fd2-bench-line"/>
        <text x="18" y="${y0 + 24}" class="nfl-fd2-bench-lbl">${esc(name)}</text>
        ${men}
    </g>`;
}

/**
 * Da una lista di titolari alla formazione dei nove slot fantasy.
 *
 * I ruoli fissi si assegnano per primi e il FLEX su ciò che avanza:
 * assegnandolo nel suo turno si porterebbe via un RB o un WR che serve a uno
 * degli slot dopo di lui, e la formazione uscirebbe con un buco al posto
 * sbagliato.
 */
export const SB_LINEUP_SLOTS = ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'K', 'DEF'];

export function sbLineup(team) {
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
    const out = SB_LINEUP_SLOTS.map(slot =>
        ({ slot, player: slot === 'FLEX' ? null : take(matcher(slot)) }));
    const flex = out.find(e => e.slot === 'FLEX');
    if (flex) flex.player = take(x => ['RB', 'WR', 'TE', 'RB/WR', 'W/R', 'FLEX'].includes(x));
    return out;
}
