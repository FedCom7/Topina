/**
 * Film Room — la giocata nella vista All-22 dei coach (camera alta in
 * tribuna stampa sulla linea laterale, o dietro la end zone), coi 22 in
 * campo, l'azione animata e, a richiesta, le zone di responsabilità della
 * copertura chiamata. Lo usa js/sections/nfl-film.js.
 *
 * Tre pezzi, in quest'ordine:
 *  1. `scenaGiocata(r)` — dalla riga nflverse (stringhe, come nel CSV) a una
 *     scena: chi è in campo, dove si allinea, come si muove nel tempo, dove
 *     va la palla. Niente DOM.
 *  2. `filmSVG(scena)` — il campo e i giocatori al momento dello snap.
 *  3. `montaFilm(root, scena)` — l'animazione: muove i gruppi già disegnati,
 *     non ridisegna niente.
 *
 * Cosa è VERO e cosa è RICOSTRUITO — la didascalia lo dice, e va tenuta:
 *  - veri: chi è in campo (participation: nome, numero, ruolo), formazione
 *    del QB, numero di uomini nel backfield, hash, copertura e uomo/zona,
 *    numero di rusher, tempo al lancio, tipo di rotta del ricevitore
 *    bersaglio, air yards, YAC, corsia e gap della corsa, punto finale, chi
 *    placca / intercetta / fa il sack;
 *  - ricostruiti: gli allineamenti esatti (regole da manuale sui ruoli) e i
 *    movimenti. Il tracking non è pubblico. Le rotte dei ricevitori NON
 *    bersaglio non esistono in nessuna fonte pubblica (deciso con l'utente
 *    il 2026-11-22): di base fanno solo il rilascio, e l'interruttore
 *    "Drawn routes" (`opz.disegnate`) le sostituisce con un concetto
 *    plausibile, tratteggiato e dichiarato.
 *
 * Coordinate: `d` = yard dalla PROPRIA end zone dell'attacco (0-100, oltre
 * 100 la end zone avversaria), `l` = yard dal centro del campo, positivo a
 * DESTRA dell'attacco. L'attacco va sempre verso d crescente.
 */

export const HALF = 26.67;
const HASH = 3.08;
export const SNAP = 0.8;          // secondi di pre-snap fermo, per guardare lo schieramento
const U = 10;                     // unità SVG per yard

const split = (s) => (s == null || s === '' ? [] : String(s).split(';'));
const num = (v) => (v == null || v === '' || Number.isNaN(+v) ? null : +v);
const latoDa = (v) => (v === 'left' ? -1 : v === 'right' ? 1 : 0);
const sgn = (x) => (x < 0 ? -1 : 1);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const esc = (v) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const cognome = (n) => { const p = String(n || '').replace(/ (Jr\.|Sr\.|II|III|IV)$/, '').split(' '); return p.length > 1 ? p.slice(1).join(' ') : p[0] || ''; };

const OL = new Set(['C', 'G', 'T', 'OL']);
const DL = new Set(['DE', 'DT', 'NT', 'DL']);
const LBI = new Set(['ILB', 'MLB', 'LB']);
const SAF = new Set(['SS', 'FS', 'S', 'DB']);

// ─── tempo: keyframe [t, d, l] ──────────────────────────────────────────

export function posA(kf, t) {
    if (t <= kf[0][0]) return [kf[0][1], kf[0][2]];
    for (let i = 1; i < kf.length; i++) {
        const [t1, d1, l1] = kf[i];
        if (t <= t1) {
            const [t0, d0, l0] = kf[i - 1];
            const f = t1 > t0 ? (t - t0) / (t1 - t0) : 1;
            return [d0 + (d1 - d0) * f, l0 + (l1 - l0) * f];
        }
    }
    const z = kf[kf.length - 1];
    return [z[1], z[2]];
}
const ultimo = (kf) => kf[kf.length - 1];
/** Ogni keyframe resta in campo: end zone sì, oltre la linea di fondo no. */
const K = (t, d, l) => [t, clamp(d, -9.4, 109.4), clamp(l, -HALF - 1.2, HALF + 1.2)];
/** Arriva in (d, l) al tempo t. I keyframe restano in ordine anche se chi
 *  chiama sbaglia di un soffio. */
function va(kf, t, d, l) {
    const z = ultimo(kf);
    kf.push(K(Math.max(t, z[0] + 0.01), d, l));
}
/** Resta fermo fino a t. */
function aspetta(kf, t) { const z = ultimo(kf); if (t > z[0]) kf.push([t, z[1], z[2]]); }
/** Percorre i punti a velocità v (yard/s) partendo da t0; torna il tempo d'arrivo. */
function percorri(kf, punti, v, t0) {
    if (t0 != null) aspetta(kf, t0);
    let [t, d, l] = ultimo(kf);
    for (const [pd, pl] of punti) {
        const [, cd, cl] = K(0, pd, pl);
        t += Math.max(0.05, Math.hypot(cd - d, cl - l) / v);
        kf.push([t, cd, cl]);
        d = cd; l = cl;
    }
    return t;
}
/** Campiona fn(t) ogni 0,1 s fra t0 e t1 (per chi insegue qualcuno). */
function campiona(kf, t0, t1, fn) {
    const s = Math.max(t0, ultimo(kf)[0] + 0.01);
    for (let t = s; t < t1; t += 0.1) kf.push(K(t, ...fn(t)));
    kf.push(K(Math.max(t1, ultimo(kf)[0] + 0.01), ...fn(t1)));
}
/** Taglia i movimenti già previsti dopo t e torna la posizione a t: chi
 *  cambia compito (il placcatore, l'intercettore) riparte da lì. */
function tronca(kf, t) {
    const p = posA(kf, t);
    let i = kf.length;
    while (i > 1 && kf[i - 1][0] > t) i--;
    kf.length = i;
    if (ultimo(kf)[0] < t) kf.push([t, ...p]);
    return p;
}
/** Da dove si trova a t0, si avvicina a fn(t) fino alla quota `a` (1 =
 *  ci arriva esattamente a t1). */
function converge(kf, t0, t1, fn, a = 1) {
    const [d0, l0] = tronca(kf, t0);
    campiona(kf, t0, t1, (t) => {
        const u = Math.min(1, (t - t0) / Math.max(0.1, t1 - t0));
        const e = a * u * u * (3 - 2 * u);
        const [qd, ql] = fn(t);
        return [d0 + (qd - d0) * e, l0 + (ql - l0) * e];
    });
}
const lung = (pts) => pts.slice(1).reduce((s, p, i) => s + Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]), 0);

// ─── chi è in campo ─────────────────────────────────────────────────────

function lato(r, chi) {
    const ids = split(r[`part_${chi}_players`]), N = split(r[`part_${chi}_names`]);
    const P = split(r[`part_${chi}_positions`]), J = split(r[`part_${chi}_numbers`]);
    return N.map((nome, i) => ({ id: ids[i] || `${chi}${i}`, nome, pos: P[i] || '', num: J[i] || '', lato: chi === 'offense' ? 'off' : 'def' }))
        .filter(p => p.nome);
}

/** "I.Yiadom" (play-by-play) → l'attore con quel cognome. */
function perNome(lista, abbr) {
    if (!abbr) return null;
    const [ini, ...resto] = String(abbr).split('.');
    const cog = resto.join('.').trim().toLowerCase();
    if (!cog) return null;
    const c = lista.filter(p => p.nome.toLowerCase().endsWith(cog));
    return c.find(p => p.nome[0]?.toLowerCase() === ini.toLowerCase()) || c[0] || null;
}

export function tipoDi(r) {
    const pt = r.play_type;
    if (pt === 'no_play') return 'nullo';
    if (['kickoff', 'punt', 'field_goal', 'extra_point'].includes(pt)) return pt;
    if (pt === 'qb_kneel') return 'kneel';
    if (pt === 'qb_spike') return 'spike';
    if (r.sack === '1') return 'sack';
    if (r.qb_scramble === '1') return 'scramble';
    if (r.pass === '1' && r.air_yards != null) return 'pass';
    if (r.rush === '1' || pt === 'run') return 'run';
    if (r.pass === '1') return 'passNoAir';
    return 'altro';
}

// ─── schieramento ───────────────────────────────────────────────────────

const ROTTE_BACKFIELD = /SWING|ANGLE|WHEEL|SCREEN/;

function schiera(r, off, def, d0, b, tipo) {
    const target = r.receiver_player_id, portatore = r.rusher_player_id, passatore = r.passer_player_id;
    const rotta = r.part_route || '';
    const loc = latoDa(r.pass_location);
    const cross = /CROSS|DRAG/.test(rotta);
    // Lato forte: quello da cui parte il bersaglio (il cross parte dal lato
    // opposto a dove arriva), o quello della corsa.
    let S = 1;
    if (tipo === 'pass' || tipo === 'passNoAir') S = (cross ? -loc : loc) || 1;
    else if (tipo === 'run') S = latoDa(r.run_location) || 1;
    const metti = (p, dd, ll) => { p.d = clamp(d0 + dd, -9.4, 109.4); p.l = clamp(ll, -HALF + 0.6, HALF - 0.6); };

    // --- attacco
    const ol = off.filter(p => OL.has(p.pos)).sort((a, z) => ['C', 'G', 'OL', 'T'].indexOf(a.pos) - ['C', 'G', 'OL', 'T'].indexOf(z.pos));
    const qbs = off.filter(p => p.pos === 'QB');
    let qb = qbs.find(p => p.id === passatore) || qbs.find(p => p.id === portatore) || qbs[0] || null;
    const backs = off.filter(p => p.pos === 'RB' || p.pos === 'FB');
    if (!qb && backs.length) qb = backs.shift(); // wildcat
    if (!qb || ol.length < 4) return null;
    const tes = off.filter(p => p.pos === 'TE' || DL.has(p.pos) || LBI.has(p.pos) || p.pos === 'OLB');
    const ricev = off.filter(p => p !== qb && !ol.includes(p) && !backs.includes(p) && !tes.includes(p));

    const ql = r.ftn_qb_location, form = r.part_offense_formation;
    const qd = ql === 'U' || form === 'UNDER CENTER' ? -1.1 : ql === 'P' || form === 'PISTOL' ? -4 : (ql === 'S' || form === 'SHOTGUN' || r.shotgun === '1') ? -5 : -1.1;
    metti(qb, qd, b);
    const SLOT_OL = [0, -1.4, 1.4, -2.8, 2.8, S * 4.2, -S * 4.2, S * 5.6];
    ol.forEach((p, i) => metti(p, -0.6, b + (SLOT_OL[i] ?? 0)));
    const bordoOL = (s) => Math.max(2.8, ...ol.map(p => s * (p.l - b)));

    // Backfield: FTN conta gli uomini dietro la linea; quelli in più sono
    // allineati fuori (empty) e diventano ricevitori.
    let nb = num(r.ftn_n_offense_backfield);
    if (nb == null || ql === '0') nb = backs.length;
    nb = clamp(nb, 0, backs.length);
    const pri = (p) => (p.id === portatore ? 4 : 0) + (p.id === target && ROTTE_BACKFIELD.test(rotta) ? 4 : 0) + (p.pos === 'FB' ? 1 : 0);
    backs.sort((a, z) => pri(z) - pri(a));
    const dentro = backs.slice(0, nb);
    ricev.unshift(...backs.slice(nb));
    const fucile = qd <= -4.5, pistola = qd === -4;
    const spotBack = fucile ? [[-5, -S * 1.7], [-5, S * 1.7], [-7.5, 0]]
        : pistola ? [[-7, 0], [-4.5, S * 1.8], [-4.5, -S * 1.8]]
        : [[-7, 0], [-4.5, 0], [-4.5, S * 1.6]];
    // Sotto il centro con due back, il FB sta davanti (I-formation).
    if (!fucile && !pistola && dentro.length >= 2) {
        const fb = dentro.find(p => p.pos === 'FB' && p.id !== portatore) || dentro[1];
        const altri = dentro.filter(p => p !== fb);
        metti(fb, -4.5, b + (dentro.length > 2 ? S * 0 : 0));
        altri.forEach((p, i) => metti(p, i ? -4.5 : -7, b + (i ? S * 1.6 : 0)));
    } else dentro.forEach((p, i) => metti(p, spotBack[i][0], b + spotBack[i][1]));

    // TE: in linea sul lato forte, poi sul debole, poi wing.
    const teBordo = { 1: bordoOL(1), [-1]: bordoOL(-1) };
    tes.forEach((p, i) => {
        const s = i % 2 === 0 ? S : -S;
        const wing = i >= 2;
        const rel = bordoOL(s) + 1.4 + (wing ? 1.3 : 0);
        metti(p, wing ? -1.7 : -0.7, b + s * rel);
        teBordo[s] = Math.max(teBordo[s], rel);
    });

    // Ricevitori: il primo di ogni lato fuori (sui numeri), poi gli slot.
    const giro = [-S, S, S, -S, S, -S, S];
    const perLato = { 1: 0, [-1]: 0 };
    const spots = [];
    for (let i = 0; i < ricev.length; i++) {
        const s = giro[i % giro.length];
        const k = perLato[s]++;
        let l, dd;
        if (k === 0) { l = s * 16.5; if (s * (l - b) < 11) l = b + s * 11; dd = s === S ? -1.5 : -0.7; }
        else if (k === 1) { const fuori = Math.max(11, Math.abs(s * 16.5 - b)); l = b + s * ((fuori + teBordo[s]) / 2 + 0.6); dd = -1.5; }
        else { l = b + s * (teBordo[s] + 1.9 + (k - 2) * 1.6); dd = -1 - (k - 2) * 0.8; }
        spots.push({ s, k, l: clamp(l, -24, 24), dd });
    }
    // Il bersaglio prende lo spot coerente con dove è andata la palla.
    const tg = ricev.find(p => p.id === target);
    const ordine = [...ricev];
    if (tg) {
        // Il corner nasce quasi sempre dallo slot: dall'esterno, con la sua
        // rottura verso la sideline, finiva fuori dal campo.
        const vuoleSlot = (loc === 0 && !/GO|DEEP OUT/.test(rotta)) || cross || /CORNER|WHEEL/.test(rotta);
        let j = spots.findIndex(x => x.s === S && (vuoleSlot ? x.k >= 1 : x.k === 0));
        if (j < 0) j = spots.findIndex(x => x.s === S);
        if (j < 0) j = 0;
        ordine.splice(ordine.indexOf(tg), 1);
        ordine.splice(j, 0, tg);
    }
    ordine.forEach((p, i) => { const sp = spots[i]; metti(p, sp.dd, sp.l); p.slot = sp.k > 0; });

    // --- difesa
    const dl = def.filter(p => DL.has(p.pos)).sort((a, z) => ['NT', 'DT', 'DL', 'DE'].indexOf(a.pos) - ['NT', 'DT', 'DL', 'DE'].indexOf(z.pos));
    const olb = def.filter(p => p.pos === 'OLB');
    const lbs = def.filter(p => LBI.has(p.pos));
    const cbs = def.filter(p => p.pos === 'CB');
    const saf = def.filter(p => SAF.has(p.pos)).sort((a, z) => ['SS', 'FS', 'S', 'DB'].indexOf(a.pos) - ['SS', 'FS', 'S', 'DB'].indexOf(z.pos));
    saf.push(...def.filter(p => !dl.includes(p) && !olb.includes(p) && !lbs.includes(p) && !cbs.includes(p) && !saf.includes(p)));
    const FRONTE = { 1: [0], 2: [-1.8, 1.8], 3: [-3.4, 0, 3.4], 4: [-3.6, -1.1, 1.1, 3.6], 5: [-4.6, -2, 0, 2, 4.6], 6: [-5.6, -3.4, -1.1, 1.1, 3.4, 5.6], 7: [-6.6, -4.4, -2.2, 0, 2.2, 4.4, 6.6] };
    const fr = [...(FRONTE[Math.min(7, dl.length)] || [])].sort((a, z) => Math.abs(a) - Math.abs(z));
    dl.forEach((p, i) => metti(p, 0.9, b + (fr[i] ?? 0)));
    const largoDL = Math.max(0, ...fr.map(Math.abs));
    const nE = Math.min(olb.length, Math.max(0, 5 - dl.length));
    const bordi = olb.slice(0, nE);
    bordi.forEach((p, i) => { const s = i % 2 === 0 ? S : -S; metti(p, 1, b + s * Math.max(largoDL + 2, teBordo[s] + 1.2)); });
    const dentroLB = [...lbs, ...olb.slice(nE)];
    const LBX = { 1: [S * 0.6], 2: [-2.4, 2.4], 3: [-4.5, 0, 4.5], 4: [-6, -2, 2, 6] };
    dentroLB.forEach((p, i) => metti(p, p.pos === 'MLB' ? 5 : 4.6, b + ((LBX[Math.min(4, dentroLB.length)] || [])[i] ?? 0) + S * 0.3));

    const cov = r.part_defense_coverage_type || '';
    const uomo = r.part_defense_man_zone_type === 'MAN_COVERAGE' || ['COVER_0', 'COVER_1', '2_MAN'].includes(cov);
    const zona = r.part_defense_man_zone_type === 'ZONE_COVERAGE' || ['COVER_2', 'COVER_3', 'COVER_4', 'COVER_6', 'COVER_9'].includes(cov);
    // Bersagli di copertura: chi non è nel backfield, dal più largo.
    const fuori = [...ricev, ...tes];
    const perLargo = (s) => fuori.filter(p => sgn(p.l - b) === s).sort((a, z) => Math.abs(z.l - b) - Math.abs(a.l - b));
    const sx = perLargo(-1), dx = perLargo(1);
    const daCoprire = [];
    if (sx[0]) daCoprire.push(sx[0]);
    if (dx[0]) daCoprire.push(dx[0]);
    daCoprire.push(...[...sx.slice(1), ...dx.slice(1)].sort((a, z) => Math.abs(z.l - b) - Math.abs(a.l - b)));
    for (const p of [...ricev, ...tes]) p.tipoTE = tes.includes(p);
    // Chi fa la giocata sul bersaglio (placcaggio, deviazione, intercetto)
    // è con ogni probabilità chi lo copriva: va su di lui. Altrimenti il
    // placcatore poteva partire dall'altra parte del campo.
    const tgP = [...ricev, ...tes].find(p => p.id === target);
    const chiave = new Set([r.interception_player_id, r.solo_tackle_1_player_id, r.assist_tackle_1_player_id, r.tackle_with_assist_1_player_id].filter(Boolean));
    const difChiave = def.find(p => chiave.has(p.id) && (p.pos === 'CB' || SAF.has(p.pos))) || perNome(def, r.pass_defense_1_player_name);
    if (tgP && difChiave && cbs.includes(difChiave)) {
        const i = daCoprire.indexOf(tgP);
        if (i > 0) { daCoprire.splice(i, 1); daCoprire.unshift(tgP); }
        cbs.splice(cbs.indexOf(difChiave), 1); cbs.unshift(difChiave);
    }
    const presi = new Set();
    const cbDepth = uomo ? 1.5 : zona ? 6.5 : 5.5;
    cbs.forEach((p, i) => {
        const w = daCoprire.find(x => !presi.has(x));
        if (w) { presi.add(w); p.marca = w; metti(p, w.tipoTE ? 3 : cbDepth, w.l - sgn(w.l - b) * (uomo ? 0.8 : 0)); }
        else metti(p, 10, b + (i % 2 ? 9 : -9));
    });
    const SPOT_S = {
        COVER_0: [[6, S * 5], [6, -S * 5]], COVER_1: [[8, S * 6], [13, 0]], COVER_3: [[8, S * 6], [13, 0]],
        COVER_2: [[12, S * 9.5], [12, -S * 9.5]], '2_MAN': [[12, S * 9.5], [12, -S * 9.5]], COVER_9: [[12, S * 9.5], [12, -S * 9.5]],
        COVER_4: [[10.5, S * 7.5], [10.5, -S * 7.5]], COVER_6: [[10, S * 7.5], [12, -S * 9.5]],
    }[cov] || [[8, S * 5], [12, -S * 6]];
    // Una safety che fa la giocata sta dalla parte del bersaglio.
    if (tgP && difChiave && saf.indexOf(difChiave) === 1 && sgn(SPOT_S[0][1] || 1) === sgn(tgP.l - b)) [saf[0], saf[1]] = [saf[1], saf[0]];
    if (tgP && difChiave && saf.indexOf(difChiave) === 0 && SPOT_S[0][1] && sgn(SPOT_S[0][1]) !== sgn(tgP.l - b) && SPOT_S[1][1]) [saf[0], saf[1]] = [saf[1], saf[0]];
    saf.forEach((p, i) => {
        if (i < 2) { metti(p, SPOT_S[i][0], b + SPOT_S[i][1]); return; }
        const w = daCoprire.find(x => !presi.has(x));
        if (w) { presi.add(w); p.marca = w; metti(p, uomo ? 2.5 : 5, w.l - sgn(w.l - b) * 0.8); }
        else metti(p, 6, b + (i % 2 ? 4 : -4));
    });
    return { S, qb, ol, dentro, tes, ricev, dl, bordi, dentroLB, cbs, saf, uomo, zona, cov, daCoprire, presi, teBordo };
}

// ─── rotte ──────────────────────────────────────────────────────────────

/**
 * La rotta del bersaglio dal suo punto di partenza al punto di presa
 * (profondità = air yards). Il TIPO è vero (part_route), la forma è quella
 * da manuale.
 */
function rottaBersaglio(nome, p, d0, air, b, side) {
    const P0 = [p.d, p.l];
    const D = air;
    const cd = d0 + D;
    const dentro = p.l === b ? (-side || -1) : sgn(b - p.l);     // verso il centro
    const fuori = -dentro;
    const nelBack = p.d < d0 - 2.5;
    const sg = side || sgn(p.l - b) || 1;
    if (nelBack) {
        if (/SWING/.test(nome)) return [P0, [d0 - 2.5, b + sg * 4.5], [cd, b + sg * 8.5]];
        if (/WHEEL/.test(nome)) return [P0, [d0 - 1, b + sg * 6], [d0 + 3, b + sg * 9.5], [cd, b + sg * 10.5]];
        if (/ANGLE/.test(nome)) return [P0, [d0 + 1.5, b + sg * 4], [cd, b + sg * 0.8]];
        if (/SCREEN/.test(nome)) return [P0, [d0 - 3, b + sg * 3], [cd, b + sg * 6]];
        // Rotte "da ricevitore" da un back: prima esce dal backfield.
        const fuoriBack = [d0 + 0.5, b + sg * 4];
        return [P0, fuoriBack, [cd, b + sg * Math.max(5, Math.abs(cd - d0) * 0.4 + 4)]];
    }
    switch (true) {
        case /^GO/.test(nome): return [P0, [cd, p.l + fuori * 1]];
        case /HITCH|CURL/.test(nome): return [P0, [cd + 2, p.l], [cd, p.l + dentro * 1]];
        case /QUICK OUT/.test(nome): return [P0, [cd, p.l], [cd, p.l + fuori * 3.5]];
        case /DEEP OUT/.test(nome): return [P0, [cd + 0.5, p.l], [cd, p.l + fuori * 5]];
        case /SLANT/.test(nome): return [P0, [d0 + 1.5, p.l], [cd, p.l + dentro * Math.min(8, Math.max(3, D * 0.9 + 2))]];
        case /IN|DIG/.test(nome): return [P0, [cd, p.l], [cd, p.l + dentro * 8]];
        case /CROSS|DRAG/.test(nome): return [P0, [d0 + Math.max(1, D * 0.6), p.l + dentro * 3], [cd, p.l + dentro * Math.min(20, Math.abs(p.l - b) + 7)]];
        case /POST/.test(nome): return [P0, [d0 + Math.min(11, Math.max(5, D * 0.55)), p.l], [cd, p.l + dentro * Math.min(11, Math.max(3, D * 0.45))]];
        case /CORNER/.test(nome): return [P0, [d0 + Math.min(10, Math.max(5, D * 0.55)), p.l], [cd, p.l + fuori * Math.min(9, Math.max(3, D * 0.45))]];
        case /SCREEN/.test(nome): return [P0, [cd, p.l + dentro * 1.5]];
        case /ANGLE/.test(nome): return [P0, [d0 + 2, p.l + fuori * 2], [cd, p.l + dentro * 3]];
        case /WHEEL/.test(nome): return [P0, [d0 + 1, p.l + fuori * 2], [cd, p.l + fuori * 3]];
        default: {
            // Tipo non pubblicato: si arriva al punto di presa dalla corsia vera.
            const fine = side === 0 ? b + dentro * 1 : p.l + (sgn(p.l - b) === side ? 0 : dentro * 6);
            return [P0, [cd - Math.min(3, Math.max(0, D * 0.3)), p.l], [cd, fine]];
        }
    }
}

/**
 * Rotte DISEGNATE per chi non è il bersaglio: un concetto plausibile, non
 * un dato. Se il bersaglio va corto gli altri liberano il campo in
 * profondità, se va lungo gli altri stanno sotto. Si usano solo con
 * l'interruttore acceso.
 */
function rottaDisegnata(p, i, d0, b, profBersaglio, tipoTE) {
    const P0 = [p.d, p.l];
    const dentro = sgn(b - p.l), fuori = -dentro;
    const lungo = profBersaglio >= 12;
    if (p.d < d0 - 2.5) return [P0, [d0 - 1.5, p.l + sgn(p.l - b || 1) * 4], [d0 + 2, b + sgn(p.l - b || 1) * 8]];
    if (tipoTE) return lungo ? [P0, [d0 + 5, p.l], [d0 + 5, p.l + dentro * 1.5]] : [P0, [d0 + 11, p.l], [d0 + 16, p.l + dentro * 4]];
    const cat = lungo
        ? [[[d0 + 12, p.l], [d0 + 10.5, p.l + dentro]], [[d0 + 6, p.l], [d0 + 6, p.l + fuori * 4]], [[d0 + 2, p.l + dentro * 3], [d0 + 3, p.l + dentro * 14]]]
        : [[[d0 + 22, p.l + fuori]], [[d0 + 10, p.l], [d0 + 20, p.l + dentro * 7]], [[d0 + 12, p.l], [d0 + 18, p.l + fuori * 6]]];
    return [P0, ...cat[(i + (p.slot ? 1 : 0)) % cat.length]];
}

// ─── la scena ───────────────────────────────────────────────────────────

/**
 * @param r     riga nflverse decodificata (valori stringa)
 * @param opz   { disegnate: bool } — rotte plausibili per i non bersagli
 */
export function scenaGiocata(r, opz = {}) {
    const yl = num(r.yardline_100);
    const tipo = tipoDi(r);
    const sc = {
        tipo, d0: yl == null ? null : 100 - yl, b: r.ftn_starting_hash === 'L' ? -HASH : r.ftn_starting_hash === 'R' ? HASH : 0,
        attori: [], palla: [], eventi: [], rotte: [], T: SNAP + 1, modo: 'vuoto', motivo: '',
        pos: r.posteam, def: r.defteam,
    };
    if (sc.d0 == null) return sc;
    const ydstogo = num(r.ydstogo);
    if (r.down && ydstogo && r.goal_to_go !== '1' && sc.d0 + ydstogo < 100) sc.fd = sc.d0 + ydstogo;

    const off = lato(r, 'offense'), def = lato(r, 'defense');
    const scrimmage = ['pass', 'passNoAir', 'sack', 'run', 'scramble', 'kneel', 'spike', 'nullo'].includes(tipo);
    const sch = scrimmage && off.length >= 9 && def.length >= 9 ? schiera(r, off, def, sc.d0, sc.b, tipo) : null;
    if (!sch) {
        sc.modo = 'palla';
        sc.motivo = !scrimmage ? 'special' : off.length ? 'schieramento' : 'participation';
        soloPalla(sc, r);
        return sc;
    }
    sc.modo = 'giocatori';
    const tutti = [...off, ...def];
    for (const p of tutti) { p.kf = [[0, p.d, p.l], [SNAP, p.d, p.l]]; p.ruoli = []; }
    sc.attori = tutti;
    sc.S = sch.S;
    const conId = (id) => (id ? tutti.find(p => p.id === id) : null);
    const ruolo = (p, k) => { if (p && !p.ruoli.includes(k)) p.ruoli.push(k); };
    ruolo(sch.qb, 'qb');

    const ctx = { r, sc, sch, off, def, tutti, conId, ruolo, opz };
    if (tipo === 'nullo') {
        sc.T = SNAP + 0.6;
        sc.palla.push({ t0: 0, t1: sc.T, fermo: [sc.d0, sc.b] });
        sc.eventi.push({ t: SNAP, txt: 'Flag — no play', sub: [r.penalty_type, r.penalty_team && `on ${r.penalty_team}`].filter(Boolean).join(' ') });
        return sc;
    }
    if (tipo === 'run' && conId(r.rusher_player_id) && conId(r.rusher_player_id) !== sch.qb) animaCorsa(ctx);
    else if (tipo === 'run' || tipo === 'scramble') animaCorsaQB(ctx);
    else if (tipo === 'kneel' || tipo === 'spike') animaKneel(ctx);
    else animaPassaggio(ctx);
    // Tutti fermi in fondo: la scena dura quanto il più lento.
    sc.T = Math.max(sc.T, ...sc.palla.map(s => s.t1)) + 1;
    for (const p of tutti) aspetta(p.kf, sc.T);
    return sc;
}

/** Il punto di arrivo della giocata (yard del referto). */
function puntoFinale(r, d0, l) {
    const yg = num(r.yards_gained) ?? 0;
    let d = d0 + yg;
    if (r.touchdown === '1' && r.td_team === r.posteam) d = Math.max(d, 101.5);
    let ll = clamp(l, -HALF + 0.5, HALF - 0.5);
    if (r.out_of_bounds === '1') ll = sgn(l) * (HALF + 0.6);
    return [d, ll];
}

/** I placcatori: id veri dal play-by-play. */
function placcatori(r, conId) {
    const ids = ['solo_tackle_1_player_id', 'solo_tackle_2_player_id', 'assist_tackle_1_player_id', 'assist_tackle_2_player_id',
        'assist_tackle_3_player_id', 'assist_tackle_4_player_id', 'tackle_with_assist_1_player_id', 'tackle_with_assist_2_player_id',
        'tackle_for_loss_1_player_id'].map(k => r[k]).filter(Boolean);
    return [...new Set(ids)].map(conId).filter(Boolean);
}

/** Pre-snap e snap: la palla al centro, poi al QB. */
function snap(sc, sch) {
    const qb = sch.qb;
    sc.palla.push({ t0: 0, t1: SNAP, fermo: [sc.d0, sc.b] });
    if (qb.d < sc.d0 - 2) { sc.palla.push({ t0: SNAP, t1: SNAP + 0.25, volo: [[sc.d0, sc.b], null], a: qb, h: 0.6 }); return SNAP + 0.25; }
    return SNAP;
}

/** Linea d'attacco in protezione: un passo e mezzo indietro. */
function protezione(sch, d0, b) {
    for (const p of sch.ol) va(p.kf, SNAP + 0.7, d0 - 1.8, p.l + (p.l - b) * 0.15);
}

/** I non bersagli: rilascio di tre yard, o la rotta disegnata. */
function altriRicevitori(ctx, esclusi, profBersaglio, tFine) {
    const { sch, sc, opz } = ctx;
    let i = 0;
    for (const p of [...sch.ricev, ...sch.tes]) {
        if (esclusi.includes(p)) continue;
        if (opz.disegnate) {
            const pts = rottaDisegnata(p, i++, sc.d0, sc.b, profBersaglio, p.tipoTE);
            percorri(p.kf, pts.slice(1), 6.8, SNAP);
            sc.rotte.push({ pts, vera: false, a: p });
            p.tenue = false;
        } else {
            percorri(p.kf, [[sc.d0 + (p.tipoTE ? 2 : 3), p.l]], 5.5, SNAP);
            p.tenue = true;
        }
        aspetta(p.kf, tFine);
    }
}

/** Chi va in pressione: tutti i DL, poi gli esterni, poi i LB più vicini, poi i DB. */
function rusher(r, sch) {
    const n = num(r.part_number_of_pass_rushers) || num(r.ftn_n_pass_rushers) || 4;
    const lb = [...sch.dentroLB].sort((a, z) => a.d - z.d);
    const db = [...sch.saf, ...sch.cbs].sort((a, z) => a.d - z.d);
    return [...sch.dl, ...sch.bordi, ...lb, ...db].slice(0, n);
}

function animaPassaggio(ctx) {
    const { r, sc, sch, conId, ruolo } = ctx;
    const { d0, b } = sc;
    const qb = sch.qb, tipo = sc.tipo;
    const rotta = r.part_route || '';
    const air = num(r.air_yards) ?? 0;
    const screen = /SCREEN/.test(rotta) || r.ftn_is_screen_pass === 'TRUE';
    const tt = num(r.part_time_to_throw);
    const sacco = tipo === 'sack';
    const tThrow = SNAP + clamp(tt ?? (sacco ? 2.9 : screen ? 0.9 : air > 15 ? 2.9 : 2.3), 0.6, 6);
    const tPresa = snap(sc, sch);

    // QB: drop proporzionato al tempo che ha.
    const sottoCentro = qb.d > d0 - 2;
    const tempo = tThrow - SNAP;
    if (sottoCentro) {
        if (r.ftn_is_play_action === 'TRUE') percorri(qb.kf, [[d0 - 3, b + sch.S * -0.8]], 5, SNAP);
        percorri(qb.kf, [[d0 - Math.min(7, 1.5 + tempo * 3), b]], 5.5);
    } else percorri(qb.kf, [[qb.d - Math.min(1.5, tempo * 1.2), b]], 3.5, SNAP);
    if (r.ftn_is_qb_out_of_pocket === 'TRUE') {
        const s = latoDa(r.pass_location) || sch.S;
        const [qd, ql] = ultimo(qb.kf).slice(1);
        va(qb.kf, tThrow, qd + 1, ql + s * 6);
    } else { const [, qd, ql] = ultimo(qb.kf); va(qb.kf, tThrow, qd + 0.7, ql); }
    protezione(sch, d0, b);
    sc.eventi.push({ t: SNAP, txt: 'Snap' });

    // Pass rush
    const rus = rusher(r, sch);
    const sackP = sacco ? (conId(r.sack_player_id) || perNome(ctx.def, r.half_sack_1_player_name) || perNome(ctx.def, r.qb_hit_1_player_name) || rus[0]) : null;
    if (sackP && !rus.includes(sackP)) rus.push(sackP);
    const tasca = posA(qb.kf, tThrow);
    const pressione = r.part_was_pressure === 'TRUE' || r.qb_hit === '1';
    rus.forEach((p, i) => {
        ruolo(p, 'rush');
        if (p === sackP) return;
        const vicino = pressione && i === 0;
        va(p.kf, tThrow, tasca[0] + (vicino ? 1 : 2.4 + (i % 2) * 0.5), b + (p.l - b) * (vicino ? 0.25 : 0.6));
    });
    // Back in protezione (o in uscita, con le rotte disegnate e pochi rusher).
    const tg = conId(r.receiver_player_id);
    for (const p of sch.dentro) {
        if (p === tg) continue;
        if (ctx.opz.disegnate && rus.length <= 4) {
            const pts = rottaDisegnata(p, 0, d0, b, air, false);
            percorri(p.kf, pts.slice(1), 6, SNAP + 0.6);
            sc.rotte.push({ pts, vera: false, a: p });
        } else va(p.kf, SNAP + 0.7, tasca[0] + 1.2, b + sgn(p.l - b || sch.S) * 1.6);
    }

    if (sacco) {
        const tSack = tThrow;
        const [qd, ql] = posA(qb.kf, tSack - 0.05);
        // Il QB resta fermo fino al sack, poi finisce sul punto del referto.
        qb.kf = qb.kf.filter(k => k[0] < tSack - 0.05);
        va(qb.kf, tSack - 0.05, qd, ql);
        ruolo(sackP, 'sack');
        converge(sackP.kf, SNAP, tSack, (t) => posA(qb.kf, Math.min(t, tSack - 0.05)), 1);
        const [ed, el] = puntoFinale(r, d0, ql);
        va(qb.kf, tSack + 0.45, Math.min(ed, qd), el);
        va(sackP.kf, tSack + 0.45, Math.min(ed, qd) + 0.6, el);
        sc.palla.push({ t0: tPresa, t1: tSack + 0.45, con: qb });
        sc.eventi.push({ t: tSack, txt: 'Sack', sub: sackP ? `${cognome(sackP.nome)} #${sackP.num}` : '' });
        altriRicevitori(ctx, [], 10, tSack + 0.45);
        const lib = coperturaPrima(ctx, rus, tSack);
        coperturaDopo(lib, { tLancio: tSack, tPresa: tSack, tEnd: tSack + 0.45, palla: () => posA(qb.kf, tSack) });
        for (const p of rus) if (p !== sackP) converge(p.kf, tSack, tSack + 0.45, () => posA(qb.kf, tSack + 0.45), 0.5);
        sc.T = tSack + 0.45;
        return;
    }

    if (!tg || tipo === 'passNoAir') {
        // Lancio senza bersaglio (throwaway, spike): la palla esce dal campo
        // dal lato vero.
        const s = latoDa(r.pass_location) || sch.S;
        const C = [d0 + (air || 5), s * (HALF + 1)];
        sc.palla.push({ t0: tPresa, t1: tThrow, con: qb });
        const f = 0.4 + Math.hypot(C[0] - tasca[0], C[1] - tasca[1]) / 24;
        sc.palla.push({ t0: tThrow, t1: tThrow + f, volo: [tasca, C], h: 3 });
        sc.palla.push({ t0: tThrow + f, t1: tThrow + f + 0.6, fermo: C });
        sc.eventi.push({ t: tThrow, txt: 'Throw', sub: tt ? `${tt.toFixed(2)}s` : '' }, { t: tThrow + f, txt: r.ftn_is_throw_away === 'TRUE' ? 'Thrown away' : 'Incomplete' });
        altriRicevitori(ctx, [], air, tThrow + f);
        const lib = coperturaPrima(ctx, rus, tThrow);
        coperturaDopo(lib, { tLancio: tThrow, tPresa: tThrow + f, tEnd: tThrow + f, C, palla: () => C });
        sc.T = tThrow + f + 0.6;
        return;
    }

    // Il bersaglio e la sua rotta VERA (tipo e profondità).
    ruolo(tg, 'target');
    const side = latoDa(r.pass_location);
    const pts = rottaBersaglio(rotta, tg, d0, air, b, side);
    const C = pts[pts.length - 1];
    // La presa è in campo: la palla del referto è stata presa, non lanciata
    // in tribuna. Una rottura che porterebbe oltre la sideline si accorcia.
    C[1] = clamp(C[1], -HALF + 2, HALF - 2);
    sc.rotte.push({ pts, vera: true, a: tg, nome: rotta });
    const L = lung(pts);
    const f = 0.3 + Math.hypot(C[0] - tasca[0], C[1] - tasca[1]) / 25;
    let tCatch = tThrow + f;
    const v = clamp(L / Math.max(0.3, tCatch - SNAP), 3, 9.5);
    const arrivo = percorri(tg.kf, pts.slice(1), v, SNAP);
    if (arrivo > tCatch) tCatch = arrivo;
    aspetta(tg.kf, tCatch);
    sc.palla.push({ t0: tPresa, t1: tThrow, con: qb });
    sc.palla.push({ t0: tThrow, t1: tCatch, volo: [tasca, C], h: Math.min(14, 1.5 + Math.hypot(C[0] - tasca[0], C[1] - tasca[1]) * 0.28) });
    sc.eventi.push({ t: tThrow, txt: 'Throw', sub: `${tt ? `${tt.toFixed(2)}s · ` : ''}${air} air yds` });
    sc.tThrow = tThrow;

    const intP = r.interception === '1' ? (conId(r.interception_player_id) || perNome(ctx.def, r.interception_player_name)) : null;
    const difesoDa = perNome(ctx.def, r.pass_defense_1_player_name);
    altriRicevitori(ctx, [tg], air, tCatch);
    const liberi = coperturaPrima(ctx, rus, tThrow);
    let tEnd, portatore, E;
    if (intP) {
        ruolo(intP, 'int');
        converge(intP.kf, tThrow - 0.3, tCatch, () => C, 1);
        const ret = num(r.return_yards) || 0;
        E = [C[0] - ret, clamp(C[1] + sgn(C[1] || 1) * Math.min(4, ret * 0.2), -HALF + 0.5, HALF - 0.5)];
        if (r.touchdown === '1' && r.td_team === r.defteam) E[0] = -1.5;
        tEnd = percorri(intP.kf, [E], 7, tCatch);
        portatore = intP;
        sc.palla.push({ t0: tCatch, t1: tEnd, con: intP });
        sc.eventi.push({ t: tCatch, txt: 'Intercepted', sub: `${cognome(intP.nome)} #${intP.num}` });
        va(tg.kf, tCatch + 0.5, C[0] + 0.5, C[1]);
    } else if (r.complete_pass === '1') {
        const [ed, el] = puntoFinale(r, d0, C[1] + sgn(C[1] - b || 1) * Math.min(4, (num(r.yards_after_catch) || 0) * 0.2));
        E = [ed, el];
        tEnd = percorri(tg.kf, [E], (num(r.yards_after_catch) || 0) > 8 ? 7.5 : 5.5, tCatch);
        tEnd = Math.max(tEnd, tCatch + 0.35);
        portatore = tg;
        sc.palla.push({ t0: tCatch, t1: tEnd, con: tg });
        sc.eventi.push({ t: tCatch, txt: 'Catch', sub: `${cognome(tg.nome)} #${tg.num}${r.yards_after_catch ? ` · ${r.yards_after_catch} YAC` : ''}` });
    } else {
        const oltre = [C[0] + 1.6, C[1]];
        sc.palla.push({ t0: tCatch, t1: tCatch + 0.35, volo: [C, oltre], h: 0.8 });
        tEnd = tCatch + 0.35;
        sc.palla.push({ t0: tEnd, t1: tEnd + 0.4, fermo: oltre });
        sc.eventi.push({ t: tCatch, txt: r.ftn_is_drop === 'TRUE' ? 'Dropped' : 'Incomplete', sub: difesoDa ? `Broken up by ${cognome(difesoDa.nome)}` : '' });
        va(tg.kf, tCatch + 0.6, C[0] + 1, C[1]);
    }
    if (difesoDa && difesoDa !== intP) { ruolo(difesoDa, 'pd'); converge(difesoDa.kf, tThrow - 0.2, tCatch, () => C, 0.95); }
    coperturaDopo(liberi, { tLancio: tThrow, tPresa: tCatch, tEnd, C, palla: portatore ? (t) => posA(portatore.kf, t) : () => C, esclusi: [intP, difesoDa].filter(Boolean) });
    for (const p of rus) converge(p.kf, tThrow, tEnd, portatore ? (t) => posA(portatore.kf, t) : () => C, 0.35);
    if (portatore) chiudi(ctx, portatore, tCatch, tEnd, E);
    sc.T = tEnd;
}

/** Copertura, fino al lancio: a uomo si segue il proprio ricevitore (le
 *  sue keyframe devono già esistere), a zona si scende nella zona. Torna
 *  chi copre, per la seconda fase. */
function coperturaPrima(ctx, rus, tLancio) {
    const { sch, sc } = ctx;
    const { d0, b } = sc;
    const cov = sch.cov;
    const profonde = ['COVER_3', 'COVER_4', 'COVER_6', 'COVER_9'].includes(cov);
    const liberi = [...sch.cbs, ...sch.saf, ...sch.dentroLB, ...sch.bordi, ...sch.dl].filter(p => !rus.includes(p));
    // A uomo: chi resta scoperto (TE, back usciti) lo prende il LB più vicino.
    if (sch.uomo) {
        const marcati = new Set(liberi.map(p => p.marca).filter(Boolean));
        for (const w of sch.daCoprire) {
            if (marcati.has(w)) continue;
            const lb = liberi.filter(p => !p.marca && (sch.dentroLB.includes(p) || sch.saf.includes(p))).sort((x, y) => Math.hypot(x.d - w.d, x.l - w.l) - Math.hypot(y.d - w.d, y.l - w.l))[0];
            if (lb) { lb.marca = w; marcati.add(w); }
        }
    }
    // Le zone di responsabilità dello schema chiamato (participation):
    // servono al pulsante "Coverage zones" E a dove scende ogni difensore,
    // così quello che si vede muoversi e quello che si disegna coincidono.
    const zone = zoneCopertura(sch, sc, liberi);
    sc.copertura = zone;
    sc.rusher = rus;
    const zonaDi = new Map((zone || []).filter(z => z.k).map(z => [z.p, z]));
    for (const p of liberi) {
        const z = zonaDi.get(p);
        if (z) {
            const deep = z.tipo === 'deep';
            const meta = [deep ? Math.max(p.d + 3, z.d0 + 2) : (z.d0 + Math.min(z.d1, z.d0 + 10)) / 2, clamp((z.l0 + z.l1) / 2, -HALF + 2, HALF - 2)];
            percorri(p.kf, [meta], deep ? 6 : 5, SNAP + 0.1);
            aspetta(p.kf, tLancio);
        } else if (sch.uomo && p.marca) {
            const w = p.marca, verso = sgn(b - w.l);
            campiona(p.kf, SNAP, tLancio, (t) => { const [wd, wl] = posA(w.kf, Math.max(0, t - 0.2)); return [Math.max(wd + 0.7, d0 + 0.5), wl + verso * 0.6]; });
        } else {
            const cb = sch.cbs.includes(p), s = sch.saf.includes(p);
            const z = cb ? (profonde ? [d0 + Math.max(13, p.d - d0 + 7), p.l] : cov === 'COVER_2' ? [d0 + 5, p.l + sgn(p.l - b) * 2] : [p.d + 3, p.l])
                : s ? [p.d + 3.5, p.l]
                : [d0 + 8, b + (p.l - b) * 1.3];
            percorri(p.kf, [z], 5.5, SNAP + 0.1);
            aspetta(p.kf, tLancio);
        }
    }
    return liberi;
}

/**
 * Chi copre cosa, secondo lo schema (`part_defense_coverage_type`). È lo
 * schema da manuale applicato ai giocatori veri: le zone profonde ai DB per
 * lato e profondità, le zone sotto per ordine da sinistra a destra (così
 * nel Cover 3 la safety forte scende da sé sul curl/flat), a uomo chi ha
 * già un ricevitore lo tiene. Senza schema (corse, COMBO, BLOWN, stagioni
 * senza participation) torna null e il pulsante non c'è.
 * Torna [{ p, k, nome, tipo, d0, d1, l0, l1 } | { p, uomo }].
 */
const SOTTO = { 1: ['hookM'], 2: ['hookL', 'hookR'], 3: ['cfL', 'hookM', 'cfR'], 4: ['cfL', 'hookL', 'hookR', 'cfR'], 5: ['flatL', 'curlL', 'hookM', 'curlR', 'flatR'], 6: ['flatL', 'curlL', 'hookL', 'hookR', 'curlR', 'flatR'] };
export const NOMI_COPERTURA = {
    COVER_0: 'Cover 0 · man, no deep safety', COVER_1: 'Cover 1 · man, one deep safety', '2_MAN': '2-Man · man under, two deep halves',
    COVER_2: 'Cover 2 · zone, two deep halves', COVER_3: 'Cover 3 · zone, three deep thirds', COVER_4: 'Cover 4 · quarters',
    COVER_6: 'Cover 6 · quarter-quarter-half', COVER_9: 'Cover 9 · three-deep match',
};
function zoneCopertura(sch, sc, liberi) {
    const cov = sch.cov;
    if (!NOMI_COPERTURA[cov]) return null;
    const D = sc.d0, b = sc.b, S = sch.S;
    const fondo = Math.min(110, D + 38);
    const Z = {
        d3L: ['Deep third', 'deep', D + 12, fondo, -HALF, -8.9], d3M: ['Deep middle third', 'deep', D + 12, fondo, -8.9, 8.9], d3R: ['Deep third', 'deep', D + 12, fondo, 8.9, HALF],
        d2L: ['Deep half', 'deep', D + 12, fondo, -HALF, 0], d2R: ['Deep half', 'deep', D + 12, fondo, 0, HALF],
        d4LL: ['Deep quarter', 'deep', D + 10, fondo, -HALF, -13.3], d4L: ['Deep quarter', 'deep', D + 10, fondo, -13.3, 0],
        d4R: ['Deep quarter', 'deep', D + 10, fondo, 0, 13.3], d4RR: ['Deep quarter', 'deep', D + 10, fondo, 13.3, HALF],
        dM: ['Deep middle', 'deep', D + 12, fondo, -11, 11],
        robber: ['Robber / hole', 'under', D + 6, D + 13, -5, 5], spy: ['Hook / QB spy', 'under', D + 3, D + 9, -4, 4],
        flatL: ['Flat', 'under', D, D + 7, -HALF, -14], curlL: ['Curl', 'under', D + 5, D + 14, -14, -6], hookL: ['Hook', 'under', D + 4, D + 12, -6, 0],
        hookM: ['Hook / middle', 'under', D + 4, D + 12, -4, 4], hookR: ['Hook', 'under', D + 4, D + 12, 0, 6], curlR: ['Curl', 'under', D + 5, D + 14, 6, 14],
        flatR: ['Flat', 'under', D, D + 7, 14, HALF], cfL: ['Curl / flat', 'under', D, D + 12, -HALF, -7], cfR: ['Curl / flat', 'under', D, D + 12, 7, HALF],
    };
    const out = [];
    const preso = (p) => out.some(o => o.p === p);
    const prendi = (p, k) => { if (p && !preso(p)) out.push({ p, k }); };
    const cb = liberi.filter(p => sch.cbs.includes(p)), sf = liberi.filter(p => sch.saf.includes(p));
    const esterno = (lista, s) => lista.filter(p => sgn(p.l - b) === s).sort((x, y) => Math.abs(y.l - b) - Math.abs(x.l - b))[0];
    const profondi = (lista, n) => lista.filter(p => !preso(p)).sort((x, y) => y.d - x.d).slice(0, n).sort((x, y) => x.l - y.l);
    const cbL = esterno(cb, -1), cbR = esterno(cb, 1);
    switch (cov) {
        case 'COVER_1': prendi(profondi(sf, 1)[0], 'dM'); break;
        case 'COVER_2': case '2_MAN': { const [x, y] = profondi(sf.length >= 2 ? sf : [...sf, ...cb], 2); prendi(x, 'd2L'); prendi(y, 'd2R'); break; }
        case 'COVER_3': case 'COVER_9': prendi(cbL, 'd3L'); prendi(cbR, 'd3R'); prendi(profondi(sf, 1)[0], 'd3M'); break;
        case 'COVER_4': { prendi(cbL, 'd4LL'); prendi(cbR, 'd4RR'); const [x, y] = profondi(sf, 2); prendi(x, 'd4L'); prendi(y, 'd4R'); break; }
        case 'COVER_6': {
            if (S > 0) { prendi(cbR, 'd4RR'); const sR = profondi(sf, 2).pop(); prendi(sR, 'd4R'); prendi(profondi(sf, 1)[0], 'd2L'); }
            else { prendi(cbL, 'd4LL'); const sL = profondi(sf, 2)[0]; prendi(sL, 'd4L'); prendi(profondi(sf, 1)[0], 'd2R'); }
            break;
        }
        default: break;
    }
    const resto = liberi.filter(p => !preso(p));
    if (sch.uomo) {
        const avanzi = [];
        for (const p of resto) if (p.marca) out.push({ p, uomo: p.marca }); else avanzi.push(p);
        avanzi.sort((x, y) => y.d - x.d).forEach((p, i) => prendi(p, i === 0 && cov === 'COVER_1' ? 'robber' : 'spy'));
    } else {
        let lista = [...resto].sort((x, y) => x.l - y.l);
        // Nel Cover 2 i corner restano nei flat: ai due estremi della fila.
        if (cov === 'COVER_2') { const c = lista.filter(p => sch.cbs.includes(p)); lista = [c[0], ...lista.filter(p => !c.includes(p)), c[1]].filter(Boolean); }
        const nomi = SOTTO[Math.min(6, lista.length)] || [];
        lista.forEach((p, i) => prendi(p, nomi[i] || 'spy'));
    }
    return out.map(o => (o.uomo ? o : { ...o, nome: Z[o.k][0], tipo: Z[o.k][1], d0: Z[o.k][2], d1: Z[o.k][3], l0: Z[o.k][4], l1: Z[o.k][5] }));
}

/** Copertura, dal lancio: si chiude sul punto di presa, poi sul portatore. */
function coperturaDopo(liberi, { tLancio, tPresa, tEnd, C, palla, esclusi = [] }) {
    for (const p of liberi) {
        if (esclusi.includes(p)) continue;
        if (C && tPresa > tLancio) converge(p.kf, tLancio, tPresa, () => C, 0.45);
        converge(p.kf, tPresa, tEnd, palla, 0.7);
    }
}

/** I placcatori arrivano sul portatore esattamente alla fine. */
function chiudi(ctx, portatore, t0, tEnd, E) {
    const { r, conId, ruolo, sc } = ctx;
    const pl = placcatori(r, conId).filter(p => p !== portatore);
    pl.forEach((p, i) => { ruolo(p, 'tackle'); converge(p.kf, t0, tEnd, (t) => { const [d, l] = posA(portatore.kf, t); return [d + (i ? -0.8 : 0.9), l + (i ? 0.7 : 0)]; }, 1); });
    const yg = num(r.yards_gained) ?? 0;
    const txt = r.touchdown === '1' ? 'Touchdown' : r.safety === '1' ? 'Safety' : r.fumble_lost === '1' ? 'Fumble lost' : r.out_of_bounds === '1' ? 'Out of bounds' : pl.length ? 'Tackle' : 'Down';
    const sub = r.touchdown === '1' ? `${cognome(portatore.nome)} #${portatore.num}` : pl.length ? pl.map(p => `${cognome(p.nome)} #${p.num}`).join(' · ') : '';
    sc.eventi.push({ t: tEnd, txt, sub: [sub, r.interception === '1' ? '' : `${yg > 0 ? '+' : ''}${yg} yds`].filter(Boolean).join(' · ') });
    sc.finale = E;
}

function animaCorsa(ctx) {
    const { r, sc, sch, conId, ruolo } = ctx;
    const { d0, b } = sc;
    const qb = sch.qb, rb = conId(r.rusher_player_id);
    ruolo(rb, 'carrier');
    const side = latoDa(r.run_location) || 0;
    const tPresa = snap(sc, sch);
    sc.eventi.push({ t: SNAP, txt: 'Snap' });
    const sottoCentro = qb.d > d0 - 2;
    // Punto dello scambio
    const mesh = sottoCentro ? [d0 - 3.5, b + (side || sgn(rb.l - b || 1)) * 0.8] : [qb.d, qb.l + sgn(rb.l - qb.l || side || 1) * 0.9];
    const tMesh = SNAP + (sottoCentro ? 0.65 : 0.45);
    va(qb.kf, tMesh, ...mesh);
    if (Math.hypot(rb.d - mesh[0], rb.l - mesh[1]) > 0.5) va(rb.kf, tMesh, mesh[0] - 0.3, mesh[1]);
    else aspetta(rb.kf, tMesh);
    // Dopo lo scambio il QB finge l'altra direzione.
    va(qb.kf, tMesh + 0.9, mesh[0] - 1, b - (side || 1) * 3);
    sc.palla.push({ t0: tPresa, t1: tMesh, con: qb });
    // Il gap
    const gap = r.run_gap;
    const rel = side === 0 ? 0 : gap === 'guard' ? 2.1 : gap === 'tackle' ? 3.6 : gap === 'end' ? sch.teBordo[side] + 2.5 : 3;
    const G = [d0 + 0.5, b + side * rel];
    const [ed, el] = puntoFinale(r, d0, G[1] + side * Math.min(6, Math.max(0, (num(r.yards_gained) || 0) * 0.15)));
    const E = [ed, el];
    const tG = percorri(rb.kf, [G], 6.2, tMesh);
    const yg = num(r.yards_gained) || 0;
    const tEnd = Math.max(percorri(rb.kf, [E], yg > 8 ? 8 : 5, tG), tG + 0.35);
    sc.palla.push({ t0: tMesh, t1: tEnd, con: rb });
    sc.eventi.push({ t: tG, txt: 'Run', sub: [r.run_location, r.run_gap].filter(Boolean).join(' ') || 'middle' });
    bloccoCorsa(ctx, side, tEnd, rb, G);
    chiudi(ctx, rb, tMesh, tEnd, E);
    sc.T = tEnd;
}

function animaCorsaQB(ctx) {
    const { r, sc, sch, ruolo } = ctx;
    const { d0, b } = sc;
    const qb = sch.qb;
    ruolo(qb, 'carrier');
    const tPresa = snap(sc, sch);
    sc.eventi.push({ t: SNAP, txt: 'Snap' });
    const side = latoDa(r.run_location) || 0;
    const scramble = sc.tipo === 'scramble';
    let tVia = SNAP + 0.3;
    if (scramble) {
        const tt = num(r.part_time_to_throw) ?? 2.4;
        tVia = SNAP + clamp(tt, 1, 5);
        percorri(qb.kf, [[qb.d - 1.5, qb.l]], 3.5, SNAP);
        aspetta(qb.kf, tVia - 0.6);
        protezione(sch, d0, b);
        altriRicevitori(ctx, [], 10, tVia + 1.5);
        const rus = rusher(r, sch);
        for (const p of rus) { ruolo(p, 'rush'); va(p.kf, tVia, qb.d + 1.5, b + (p.l - b) * 0.5); }
    }
    const G = [d0 + 0.5, b + side * (scramble ? 6 : 1.4)];
    const [ed, el] = puntoFinale(r, d0, G[1] + side * 2);
    const E = [ed, el];
    const tG = percorri(qb.kf, [G], scramble ? 6.5 : 4, tVia);
    const tEnd = Math.max(percorri(qb.kf, [E], (num(r.yards_gained) || 0) > 8 ? 7.5 : 4.5, tG), tG + 0.3);
    sc.palla.push({ t0: tPresa, t1: tEnd, con: qb });
    sc.eventi.push({ t: tVia, txt: scramble ? 'Scramble' : r.ftn_is_qb_sneak === 'TRUE' ? 'QB sneak' : 'QB run' });
    if (scramble) coperturaDopo(coperturaPrima(ctx, rusher(r, sch), tVia), { tLancio: tVia, tPresa: tVia, tEnd, palla: (t) => posA(qb.kf, t) });
    else bloccoCorsa(ctx, side, tEnd, qb, G);
    chiudi(ctx, qb, tVia, tEnd, E);
    sc.T = tEnd;
}

/** Corsa: la linea spinge, i ricevitori bloccano, la difesa chiude. */
function bloccoCorsa(ctx, side, tEnd, rb, G) {
    const { sc, sch } = ctx;
    const { d0, b } = sc;
    // Linea contro linea: si incontrano sulla scrimmage e spingono di poco.
    // Spostandole entrambe di un yard finivano una sopra l'altra.
    for (const p of sch.ol) { va(p.kf, SNAP + 0.7, d0 - 0.2, p.l + side * 0.6); va(p.kf, tEnd, d0 + 0.5, p.l + side * 1.1); }
    for (const p of [...sch.tes, ...sch.ricev]) { va(p.kf, SNAP + 1.2, d0 + (p.tipoTE ? 1 : 3.5), p.l - sgn(p.l - b) * (p.tipoTE ? 0 : 1)); aspetta(p.kf, tEnd); }
    for (const p of sch.dentro) if (p !== rb) { percorri(p.kf, [[G[0] - 0.5, G[1] - side * 0.6], [G[0] + 1.5, G[1]]], 6, SNAP + 0.2); }
    const segui = (t) => posA(rb.kf, t);
    for (const p of [...sch.dl, ...sch.bordi]) { va(p.kf, SNAP + 0.6, d0 + 1.2, p.l + side * 0.6); converge(p.kf, SNAP + 0.6, tEnd, segui, 0.3); }
    for (const p of sch.dentroLB) converge(p.kf, SNAP + 0.25, tEnd, segui, 0.75);
    for (const p of [...sch.cbs, ...sch.saf]) converge(p.kf, SNAP + 0.5, tEnd, segui, 0.55);
}

function animaKneel(ctx) {
    const { sc, sch } = ctx;
    const qb = sch.qb;
    const tPresa = snap(sc, sch);
    if (sc.tipo === 'kneel') {
        va(qb.kf, SNAP + 0.7, qb.d - 1.2, qb.l);
        sc.palla.push({ t0: tPresa, t1: SNAP + 0.9, con: qb });
        sc.eventi.push({ t: SNAP + 0.7, txt: 'Kneel' });
        sc.T = SNAP + 0.9;
    } else {
        sc.palla.push({ t0: tPresa, t1: SNAP + 0.4, con: qb });
        const giu = [qb.d + 1.5, qb.l];
        sc.palla.push({ t0: SNAP + 0.4, t1: SNAP + 0.6, volo: [[qb.d, qb.l], giu], h: 0.3 });
        sc.palla.push({ t0: SNAP + 0.6, t1: SNAP + 1, fermo: giu });
        sc.eventi.push({ t: SNAP + 0.5, txt: 'Spike' });
        sc.T = SNAP + 1;
    }
}

/**
 * Solo la palla: special teams (gli schieramenti dei calci non sono nel
 * motore) e giocate senza participation (la stagione in corso, finché
 * nflverse non la pubblica). Lunghezze e corsie restano quelle vere.
 */
function soloPalla(sc, r) {
    const { d0, b, tipo } = sc;
    const yg = num(r.yards_gained) || 0;
    const tt = SNAP;
    sc.palla.push({ t0: 0, t1: tt, fermo: [d0, b] });
    const loc = latoDa(r.pass_location), side = latoDa(r.run_location);
    if (tipo === 'kickoff' || tipo === 'punt' || tipo === 'field_goal' || tipo === 'extra_point') {
        const kd = num(r.kick_distance) || 0, ret = num(r.return_yards) || 0;
        if (tipo === 'kickoff') {
            const da = [d0, 0], a = [d0 - kd, 0];
            const f = 0.8 + kd / 25;
            sc.palla.push({ t0: tt, t1: tt + f, volo: [da, a], h: 18 });
            sc.eventi.push({ t: tt, txt: 'Kickoff', sub: `${kd} yds` });
            let fine = tt + f;
            if (ret) { const e = [a[0] + ret, 0]; sc.palla.push({ t0: fine, t1: fine + ret / 7, volo: [a, e], h: 0 }); fine += ret / 7; sc.eventi.push({ t: tt + f, txt: 'Return', sub: `${ret} yds` }); }
            else if (r.touchback === '1') sc.eventi.push({ t: fine, txt: 'Touchback' });
            sc.T = fine;
            return;
        }
        if (tipo === 'punt') {
            const da = [d0 - 14, b], a = [d0 + kd, b * 0.5];
            sc.palla.push({ t0: tt, t1: tt + 0.9, volo: [[d0, b], da], h: 0.6 });
            const f = 0.9 + kd / 22;
            sc.palla.push({ t0: tt + 0.9, t1: tt + 0.9 + f, volo: [da, a], h: 20 });
            sc.eventi.push({ t: tt + 0.9, txt: 'Punt', sub: `${kd} yds` });
            let fine = tt + 0.9 + f;
            if (ret) { const e = [a[0] - ret, a[1]]; sc.palla.push({ t0: fine, t1: fine + ret / 7, volo: [a, e], h: 0 }); sc.eventi.push({ t: fine, txt: 'Return', sub: `${ret} yds` }); fine += ret / 7; }
            else sc.eventi.push({ t: fine, txt: r.punt_fair_catch === '1' ? 'Fair catch' : r.touchback === '1' ? 'Touchback' : 'Downed' });
            sc.T = fine;
            return;
        }
        const tenuta = [d0 - 7, b], porta = [110, 0];
        sc.palla.push({ t0: tt, t1: tt + 0.4, volo: [[d0, b], tenuta], h: 0.5 });
        const f = 0.8 + (110 - tenuta[0]) / 30;
        sc.palla.push({ t0: tt + 0.4, t1: tt + 0.4 + f, volo: [tenuta, porta], h: 16 });
        const esito = tipo === 'field_goal' ? r.field_goal_result : r.extra_point_result;
        sc.eventi.push({ t: tt + 0.4, txt: tipo === 'field_goal' ? 'Field goal' : 'Extra point', sub: tipo === 'field_goal' && kd ? `${kd} yds` : '' }, { t: tt + 0.4 + f, txt: esito === 'made' || esito === 'good' ? 'Good' : esito === 'blocked' ? 'Blocked' : 'No good' });
        sc.T = tt + 0.4 + f;
        return;
    }
    const qbp = [d0 - 5, b];
    sc.palla.push({ t0: tt, t1: tt + 0.3, volo: [[d0, b], qbp], h: 0.5 });
    if (r.pass === '1' && r.air_yards != null && r.sack !== '1') {
        const air = +r.air_yards;
        const C = [d0 + air, clamp(b + loc * 9, -HALF + 1, HALF - 1)];
        const t1 = tt + 2.2, f = 0.3 + Math.hypot(C[0] - qbp[0], C[1] - qbp[1]) / 25;
        sc.palla.push({ t0: tt + 0.3, t1, fermo: qbp });
        sc.palla.push({ t0: t1, t1: t1 + f, volo: [qbp, C], h: Math.min(14, 2 + air * 0.3) });
        sc.eventi.push({ t: t1, txt: 'Throw', sub: `${air} air yds` });
        if (r.complete_pass === '1') {
            const E = [d0 + yg + (r.touchdown === '1' ? 1.5 : 0), C[1]];
            const t2 = t1 + f + Math.max(0.3, Math.abs(E[0] - C[0]) / 7);
            sc.palla.push({ t0: t1 + f, t1: t2, volo: [C, E], h: 0 });
            sc.eventi.push({ t: t1 + f, txt: 'Catch' }, { t: t2, txt: r.touchdown === '1' ? 'Touchdown' : 'Down', sub: `${yg > 0 ? '+' : ''}${yg} yds` });
            sc.T = t2;
        } else { sc.eventi.push({ t: t1 + f, txt: r.interception === '1' ? 'Intercepted' : 'Incomplete' }); sc.T = t1 + f; }
        return;
    }
    if (r.rush === '1' || r.sack === '1') {
        const G = [d0 + 0.5, b + side * 3];
        const E = [d0 + yg + (r.touchdown === '1' ? 1.5 : 0), G[1] + side * 2];
        const t1 = tt + 0.9, t2 = t1 + Math.max(0.4, Math.abs(E[0] - G[0]) / 6);
        if (r.sack === '1') { sc.palla.push({ t0: tt + 0.3, t1: tt + 2.5, fermo: qbp }); sc.palla.push({ t0: tt + 2.5, t1: tt + 3, volo: [qbp, [d0 + yg, b]], h: 0 }); sc.eventi.push({ t: tt + 2.5, txt: 'Sack' }); sc.T = tt + 3; return; }
        sc.palla.push({ t0: tt + 0.3, t1, volo: [qbp, G], h: 0 });
        sc.palla.push({ t0: t1, t1: t2, volo: [G, E], h: 0 });
        sc.eventi.push({ t: t1, txt: 'Run' }, { t: t2, txt: r.touchdown === '1' ? 'Touchdown' : 'Down', sub: `${yg > 0 ? '+' : ''}${yg} yds` });
        sc.T = t2;
        return;
    }
    sc.T = tt + 0.5;
}

// ─── palla ──────────────────────────────────────────────────────────────

/** Posizione della palla a t: [d, l, altezza in yard]. */
export function pallaA(sc, t) {
    const segs = sc.palla;
    if (!segs.length) return null;
    let s = segs.find(x => t >= x.t0 && t <= x.t1);
    if (!s) s = t < segs[0].t0 ? segs[0] : segs[segs.length - 1];
    const f = s.t1 > s.t0 ? clamp((t - s.t0) / (s.t1 - s.t0), 0, 1) : 1;
    if (s.fermo) return [s.fermo[0], s.fermo[1], 0];
    if (s.con) { const [d, l] = posA(s.con.kf, t); return [d, l, 0.6]; }
    if (s.volo) {
        const p0 = s.volo[0];
        const p1 = s.volo[1] || (s.a ? posA(s.a.kf, s.t1) : p0);
        return [p0[0] + (p1[0] - p0[0]) * f, p0[1] + (p1[1] - p0[1]) * f, 0.6 + 4 * (s.h || 0) * f * (1 - f)];
    }
    return null;
}

// ─── camera: la vista All-22 dei coach ──────────────────────────────────

/*
 * Il "coach film" è ripreso da due camere fisse e alte, che inquadrano tutti
 * i 22: quella in tribuna stampa sulla linea laterale (Sideline) e quella
 * dietro la end zone (End zone). Qui sono due camere vere, con una
 * proiezione prospettica: le linee convergono, i giocatori lontani sono più
 * piccoli e la palla in volo sale davvero. La camera laterale sta dalla
 * parte della SINISTRA dell'attacco, così l'attacco va verso destra.
 */
const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm3 = (a) => { const n = Math.hypot(...a) || 1; return a.map(x => x / n); };

function camera(C, T, vista) {
    const f = norm3(sub3(T, C));
    let r = norm3(cross3(f, [0, 0, 1]));
    if (vista === 'end' ? r[1] < 0 : r[0] < 0) r = r.map(x => -x);
    let u = cross3(r, f);
    if (u[2] < 0) u = u.map(x => -x);
    const zt = dot3(sub3(T, C), f);
    const fz = U * zt; // 10 unità per yard nel punto inquadrato
    // [x, y, k]: k = scala locale (1 nel punto inquadrato, <1 più lontano)
    return (d, l, h = 0) => {
        const v = sub3([d, l, h], C);
        const z = Math.max(0.5, dot3(v, f));
        return [fz * dot3(v, r) / z, -fz * dot3(v, u) / z, zt / z];
    };
}

/**
 * Camera e inquadratura. La camera è ferma per tutta la giocata: la
 * finestra contiene ogni punto che giocatori e palla toccheranno, e tutta
 * la larghezza del campo, come nel film vero. `aspetto` = larghezza/altezza
 * del riquadro a schermo.
 */
function inquadra(sc, vista, aspetto, conZone) {
    const pts = [[sc.d0, 0, 0]];
    for (const p of sc.attori) for (const k of p.kf) pts.push([k[1], k[2], 0]);
    for (const s of sc.palla) for (const q of [s.fermo, ...(s.volo || [])]) if (q) pts.push([q[0], q[1], 0]);
    for (let t = 0; t <= sc.T; t += 0.25) { const b = pallaA(sc, t); if (b) pts.push(b); }
    if (sc.fd != null) pts.push([sc.fd, 0, 0]);
    if (conZone) for (const z of sc.copertura || []) if (z.k) pts.push([Math.min(z.d1, sc.d0 + 22), 0, 0], [z.d0, 0, 0]);
    const ds = pts.map(p => p[0]), lsA = pts.map(p => p[1]);
    const dMin = Math.max(-10, Math.min(...ds) - 3), dMax = Math.min(110, Math.max(...ds) + 3);
    const lMin = Math.max(-HALF - 1, Math.min(...lsA) - 3), lMax = Math.min(HALF + 1, Math.max(...lsA) + 3);
    const dc = (dMin + dMax) / 2, lc = (lMin + lMax) / 2;
    // Camera lontana e alta, come quella vera in tribuna stampa: teleobiettivo,
    // prospettiva dolce. Vicina e bassa, il campo davanti diventava enorme e i
    // 22 finivano schiacciati in fondo.
    const DIST = 120, ELEV = 0.72; // ~40°
    let C, T;
    if (vista === 'end') { T = [dc, lc, 0]; C = [dc - DIST * Math.cos(ELEV), lc, DIST * Math.sin(ELEV)]; }
    else { T = [dc, lc, 0]; C = [dc, lc - DIST * Math.cos(ELEV), DIST * Math.sin(ELEV)]; }
    const P = camera(C, T, vista);
    // Riquadro: tutto quello che giocatori e palla toccano, non il campo intero.
    const box = [];
    for (const [d, l, h] of pts) box.push(P(d, l, h));
    for (const d of [dMin, dMax]) for (const l of [lMin, lMax]) box.push(P(d, l, 0));
    let x0 = Math.min(...box.map(q => q[0])), x1 = Math.max(...box.map(q => q[0]));
    let y0 = Math.min(...box.map(q => q[1])), y1 = Math.max(...box.map(q => q[1]));
    const m = Math.max(x1 - x0, y1 - y0) * 0.04;
    x0 -= m; x1 += m; y0 -= m; y1 += m;
    const asp = clamp(aspetto || 1.8, 0.6, 2.8);
    if ((x1 - x0) / (y1 - y0) < asp) { const w = (y1 - y0) * asp, c = (x0 + x1) / 2; x0 = c - w / 2; x1 = c + w / 2; }
    else { const h = (x1 - x0) / asp, c = (y0 + y1) / 2; y0 = c - h / 2; y1 = c + h / 2; }
    // Nella vista dalla end zone il campo dietro la camera non si disegna.
    const dVis = vista === 'end' ? C[0] + 3 : -10;
    return { P, x0, y0, W: x1 - x0, H: y1 - y0, vista, dVis };
}

const f1 = (n) => n.toFixed(1);
const pt = (G, d, l, h = 0) => G.P(d, l, h).slice(0, 2).map(f1).join(',');
function quad(G, d0, d1, l0, l1, attr) {
    d0 = Math.max(d0, G.dVis);
    if (d1 <= d0) return '';
    return `<polygon points="${pt(G, d0, l0)} ${pt(G, d1, l0)} ${pt(G, d1, l1)} ${pt(G, d0, l1)}" ${attr}/>`;
}
function linea(G, d0, l0, d1, l1, attr) {
    if (Math.max(d0, d1) < G.dVis) return '';
    d0 = Math.max(d0, G.dVis); d1 = Math.max(d1, G.dVis);
    const [ax, ay] = G.P(d0, l0), [bx, by] = G.P(d1, l1);
    return `<line x1="${f1(ax)}" y1="${f1(ay)}" x2="${f1(bx)}" y2="${f1(by)}" ${attr}/>`;
}
const tracciato = (G, pts) => pts.map((p, i) => `${i ? 'L' : 'M'}${f1(G.P(p[0], p[1], p[2] || 0)[0])},${f1(G.P(p[0], p[1], p[2] || 0)[1])}`).join(' ');

/**
 * Testo "stampato" sull'erba: una matrice affine presa dalla prospettiva in
 * quel punto, così numeri e sigle si piegano col campo invece di galleggiare.
 * Il testo si legge sempre da sinistra a destra, dritto verso la camera.
 */
function timbro(G, d, l, testo, cls, yard) {
    if (d < G.dVis + 1) return '';
    const [x, y] = G.P(d, l), [ax, ay] = G.P(d + 1, l), [bx, by] = G.P(d, l + 1);
    const Jd = [ax - x, ay - y], Jl = [bx - x, by - y];
    const cand = [Jd, Jl, [-Jd[0], -Jd[1]], [-Jl[0], -Jl[1]]];
    const asseX = cand.reduce((m, v) => (v[0] > m[0] ? v : m));
    const altro = asseX === cand[0] || asseX === cand[2] ? Jl : Jd;
    const asseY = altro[1] >= 0 ? altro : [-altro[0], -altro[1]];
    const s = yard / 10;
    return `<text class="${cls}" transform="matrix(${[asseX[0] * s, asseX[1] * s, asseY[0] * s, asseY[1] * s, x, y].map(v => v.toFixed(3)).join(' ')})">${esc(testo)}</text>`;
}

function campo(G, sc, col) {
    const out = [];
    out.push(quad(G, -40, 150, -HALF - 40, HALF + 40, 'class="ff-out"'));
    out.push(quad(G, 0, 100, -HALF, HALF, 'class="ff-grass"'));
    for (let y = 0; y < 100; y += 10) out.push(quad(G, y, y + 5, -HALF, HALF, 'class="ff-stripe"'));
    out.push(quad(G, -10, 0, -HALF, HALF, `class="ff-ez" style="fill:${col.off}"`));
    out.push(quad(G, 100, 110, -HALF, HALF, `class="ff-ez" style="fill:${col.def}"`));
    // Sigle nelle end zone, lungo la larghezza del campo.
    out.push(timbroEZ(G, -5, sc.posSito), timbroEZ(G, 105, sc.defSito));
    for (let y = 0; y <= 100; y += 5) out.push(linea(G, y, -HALF, y, HALF, `class="ff-yl${y % 50 === 0 ? ' is-goal' : ''}"`));
    for (let y = 1; y < 100; y++) {
        if (y % 5 === 0) continue;
        for (const h of [-HASH, HASH]) out.push(linea(G, y, h - 0.35, y, h + 0.35, 'class="ff-hash"'));
        for (const h of [-HALF + 0.3, HALF - 0.3]) out.push(linea(G, y, h - 0.3, y, h + 0.3, 'class="ff-hash"'));
    }
    for (let y = 10; y <= 90; y += 10) for (const s of [-1, 1]) out.push(timbro(G, y, s * (HALF - 12), y <= 50 ? y : 100 - y, 'ff-num-campo', 2));
    out.push(linea(G, -10, -HALF, 110, -HALF, 'class="ff-side"'), linea(G, -10, HALF, 110, HALF, 'class="ff-side"'));
    out.push(linea(G, -10, -HALF, -10, HALF, 'class="ff-side"'), linea(G, 110, -HALF, 110, HALF, 'class="ff-side"'));
    out.push(linea(G, sc.d0, -HALF, sc.d0, HALF, 'class="ff-los"'));
    if (sc.fd != null) out.push(linea(G, sc.fd, -HALF, sc.fd, HALF, 'class="ff-fd"'));
    return out.join('');
}
/** La sigla della end zone corre lungo la larghezza del campo. */
function timbroEZ(G, d, sigla) {
    if (d < G.dVis + 1 || !sigla) return '';
    const [x, y] = G.P(d, 0), [bx, by] = G.P(d, 1), [ax, ay] = G.P(d + 1, 0);
    let Jl = [bx - x, by - y], Jd = [ax - x, ay - y];
    if (Jl[0] < 0) Jl = [-Jl[0], -Jl[1]];
    if (Jd[1] < 0) Jd = [-Jd[0], -Jd[1]];
    // Testo lungo l'asse più "orizzontale" a schermo fra i due.
    const [ax1, ay1] = Math.abs(Jl[0]) >= Math.abs(Jd[0]) ? [Jl, Jd] : [Jd, Jl];
    const s = 0.55;
    return `<text class="ff-ez-txt" transform="matrix(${[ax1[0] * s, ax1[1] * s, ay1[0] * s, ay1[1] * s, x, y].map(v => v.toFixed(3)).join(' ')})">${esc(sigla)}</text>`;
}

/** Le zone di responsabilità: rettangoli a terra col nome e il numero di
 *  chi le copre; a uomo una linea dal difensore al suo ricevitore (mossa a
 *  ogni fotogramma), per chi va in pressione una freccia verso il QB. */
function strato_zone(G, sc) {
    if (!sc.copertura) return '';
    const D = sc.d0;
    const out = [];
    for (const z of sc.copertura) {
        if (!z.k) continue;
        const d1 = Math.min(z.d1, D + 22);
        const l0 = Math.max(z.l0, -HALF), l1 = Math.min(z.l1, HALF);
        out.push(quad(G, z.d0, d1, l0, l1, `class="ff-zone is-${z.tipo}"`));
        const etichetta = `${z.nome} · #${z.p.num}`;
        // L'etichetta sul bordo verso la camera: al centro, zone sovrapposte
        // (robber dentro il deep middle) le mettevano una sopra l'altra.
        const [ld, ll] = G.vista === 'end' ? [z.d0 + 1.3, (l0 + l1) / 2] : [(z.d0 + d1) / 2, l0 + 1.3];
        out.push(timbro(G, ld, ll, etichetta, `ff-zlabel is-${z.tipo}`, 1.1));
    }
    const qb = sc.attori.find(p => p.ruoli.includes('qb'));
    for (const p of sc.rusher || []) {
        if (!qb) break;
        const [, d, l] = p.kf[0];
        out.push(`<path class="ff-rusharrow" d="${tracciato(G, [[d, l], [qb.kf[0][1] + 1.5, qb.kf[0][2] + (l - qb.kf[0][2]) * 0.3]])}" marker-end="url(#ff-arrow-rush)"/>`);
    }
    const uomo = sc.copertura.filter(z => z.uomo).map(z => `<line class="ff-manline" data-man="${sc.attori.indexOf(z.p)},${sc.attori.indexOf(z.uomo)}"/>`).join('');
    return `<g class="ff-zones">${out.join('')}${uomo}</g>`;
}

const RUOLI_CHIAVE = ['target', 'carrier', 'int', 'sack', 'tackle', 'pd', 'qb'];

/**
 * Il campo coi giocatori al loro posto allo snap. `opz`: vista ('side' |
 * 'end'), aspetto, colori { off, def }, sigle { off, def }, zone (bool).
 */
export function filmSVG(sc, opz = {}) {
    const vista = opz.vista === 'end' ? 'end' : 'side';
    const G = inquadra(sc, vista, opz.aspetto, !!opz.zone);
    sc._G = G;
    sc.posSito = opz.sigle?.off || sc.pos || '';
    sc.defSito = opz.sigle?.def || sc.def || '';
    const col = { off: opz.colori?.off || '#4f8cff', def: opz.colori?.def || '#b8433a' };
    const rotte = sc.rotte.map((x) => `<path d="${tracciato(G, x.pts)}" class="ff-route ${x.vera ? 'is-real' : 'is-drawn'}" marker-end="url(#ff-arrow-${x.vera ? 'r' : 'd'})"/>`).join('');
    const scie = sc.attori.map((p, i) => (p.ruoli.some(r => ['target', 'carrier', 'int'].includes(r)) ? `<path class="ff-trail" data-trail="${i}" d=""/>` : '')).join('');
    const giocatori = sc.attori.map((p, i) => {
        const [x, y, k] = G.P(p.kf[0][1], p.kf[0][2]);
        const chiave = p.ruoli.find(r => RUOLI_CHIAVE.includes(r) && r !== 'qb');
        const cls = `ff-p ff-p--${p.lato}${chiave ? ` is-key is-${chiave}` : ''}${p.tenue ? ' is-faint' : ''}`;
        const forma = p.lato === 'off'
            ? `<circle r="6.2" class="ff-dot" style="fill:${col.off}"/>`
            : `<rect x="-5.7" y="-5.7" width="11.4" height="11.4" rx="2.6" class="ff-dot" style="fill:${col.def}"/>`;
        return `<g class="${cls}" data-a="${i}" transform="translate(${f1(x)},${f1(y)}) scale(${k.toFixed(3)})"><title>${esc(`#${p.num} ${p.nome} · ${p.pos}`)}</title>
            <ellipse class="ff-pshadow" cx="0" cy="5.4" rx="6.2" ry="2"/>${chiave ? '<circle r="9.2" class="ff-halo"/>' : ''}${forma}<text class="ff-pnum" y="2.5">${esc(p.num)}</text>
            <text class="ff-pname${chiave || p.ruoli.includes('qb') ? '' : ' is-extra'}" y="16">${esc(cognome(p.nome))}</text></g>`;
    }).join('');
    const b0 = pallaA(sc, 0);
    const [bx, by] = b0 ? G.P(b0[0], b0[1]) : [0, 0];
    return `<svg class="ff ff--${vista}${opz.zone ? ' ff--zone' : ''}" viewBox="${f1(G.x0)} ${f1(G.y0)} ${f1(G.W)} ${f1(G.H)}" role="img" aria-label="All-22 view of the play">
        <defs>
            <marker id="ff-arrow-r" viewBox="0 0 8 8" refX="6" refY="4" markerWidth="5" markerHeight="5" orient="auto"><path d="M0,0 L8,4 L0,8 z" class="ff-arrowhead is-real"/></marker>
            <marker id="ff-arrow-d" viewBox="0 0 8 8" refX="6" refY="4" markerWidth="5" markerHeight="5" orient="auto"><path d="M0,0 L8,4 L0,8 z" class="ff-arrowhead is-drawn"/></marker>
            <marker id="ff-arrow-rush" viewBox="0 0 8 8" refX="6" refY="4" markerWidth="5" markerHeight="5" orient="auto"><path d="M0,0 L8,4 L0,8 z" class="ff-arrowhead is-rush"/></marker>
        </defs>
        ${campo(G, sc, col)}
        ${opz.zone ? strato_zone(G, sc) : ''}
        <g class="ff-routes">${rotte}</g>
        <g class="ff-trails">${scie}</g>
        <path class="ff-flight" d=""/>
        <ellipse class="ff-ball-shadow" cx="${f1(bx)}" cy="${f1(by)}" rx="2.6" ry="1.1"/>
        <g class="ff-players">${giocatori}</g>
        <g class="ff-ball" transform="translate(${f1(bx)},${f1(by)})"><ellipse rx="3" ry="1.9" class="ff-ball-body"/><line x1="-1.2" y1="0" x2="1.2" y2="0" class="ff-ball-lace"/></g>
    </svg>`;
}

// ─── animazione ─────────────────────────────────────────────────────────

/**
 * Muove i gruppi già disegnati da `filmSVG`: a ogni fotogramma cambiano
 * solo `transform`, qualche `d` e l'ordine dei giocatori (i più vicini
 * alla camera davanti, come nel film).
 * @returns { play, pausa, vai(t), velocita(x), distruggi, t, T, inCorso }
 */
export function montaFilm(root, sc, { onTick, onFine, onEvento } = {}) {
    const svg = root.querySelector('svg.ff');
    const G = sc._G;
    if (!svg || !G) return null;
    const strato = svg.querySelector('.ff-players');
    const gruppi = [...svg.querySelectorAll('[data-a]')].map(g => ({ g, p: sc.attori[+g.dataset.a], y: 0 }));
    const scie = [...svg.querySelectorAll('[data-trail]')].map(p => [p, sc.attori[+p.dataset.trail]]);
    const uomo = [...svg.querySelectorAll('[data-man]')].map(l => { const [a, b] = l.dataset.man.split(',').map(Number); return [l, sc.attori[a], sc.attori[b]]; });
    const palla = svg.querySelector('.ff-ball'), ombra = svg.querySelector('.ff-ball-shadow'), volo = svg.querySelector('.ff-flight');
    const segVolo = sc.palla.find(s => s.volo && s.h > 1.5);
    let t = 0, rate = 1, raf = null, ultimoTs = null, evCorr = -1, ordine = '';

    function disegna() {
        for (const o of gruppi) {
            const [d, l] = posA(o.p.kf, t);
            const [x, y, k] = G.P(d, l);
            o.y = y;
            o.g.setAttribute('transform', `translate(${f1(x)},${f1(y)}) scale(${k.toFixed(3)})`);
        }
        // Chi è più vicino alla camera copre chi è dietro.
        const nuovo = [...gruppi].sort((a, z) => a.y - z.y);
        const firma = nuovo.map(o => o.g.dataset.a).join(',');
        if (firma !== ordine) { ordine = firma; for (const o of nuovo) strato.appendChild(o.g); }
        for (const [path, p] of scie) {
            if (t <= SNAP) { path.setAttribute('d', ''); continue; }
            const pts = p.kf.filter(q => q[0] >= SNAP && q[0] <= t).map(q => [q[1], q[2]]);
            pts.push(posA(p.kf, t));
            path.setAttribute('d', tracciato(G, pts));
        }
        for (const [ln, a, b] of uomo) {
            const [ax, ay] = G.P(...posA(a.kf, t)), [bx, by] = G.P(...posA(b.kf, t));
            ln.setAttribute('x1', f1(ax)); ln.setAttribute('y1', f1(ay)); ln.setAttribute('x2', f1(bx)); ln.setAttribute('y2', f1(by));
        }
        const b = pallaA(sc, t);
        if (b) {
            const [x, y, k] = G.P(b[0], b[1], b[2]);
            const [sx, sy] = G.P(b[0], b[1], 0);
            ombra.setAttribute('cx', f1(sx)); ombra.setAttribute('cy', f1(sy));
            palla.setAttribute('transform', `translate(${f1(x)},${f1(y)}) scale(${k.toFixed(3)})`);
        }
        // La traiettoria del lancio, in aria: la parabola vera, campionata.
        if (segVolo && t >= segVolo.t0) {
            const fine = Math.min(t, segVolo.t1);
            const pts = [];
            for (let q = segVolo.t0; q < fine; q += 0.05) pts.push(pallaA(sc, q));
            pts.push(pallaA(sc, fine));
            volo.setAttribute('d', tracciato(G, pts));
        } else volo.setAttribute('d', '');
        let e = -1;
        sc.eventi.forEach((ev, i) => { if (t >= ev.t) e = i; });
        if (e !== evCorr) { evCorr = e; onEvento?.(e >= 0 ? sc.eventi[e] : null); }
        onTick?.(t, sc.T);
    }
    function passo(ts) {
        if (ultimoTs == null) ultimoTs = ts;
        t = Math.min(sc.T, t + ((ts - ultimoTs) / 1000) * rate);
        ultimoTs = ts;
        disegna();
        if (t >= sc.T) { raf = null; ultimoTs = null; onTick?.(t, sc.T, false); onFine?.(); return; }
        raf = requestAnimationFrame(passo);
    }
    const ctl = {
        play() { if (raf) return; if (t >= sc.T) t = 0; ultimoTs = null; raf = requestAnimationFrame(passo); onTick?.(t, sc.T, true); },
        pausa() { if (raf) cancelAnimationFrame(raf); raf = null; ultimoTs = null; onTick?.(t, sc.T, false); },
        vai(x) { t = clamp(x, 0, sc.T); disegna(); },
        velocita(x) { rate = x; },
        distruggi() { if (raf) cancelAnimationFrame(raf); raf = null; },
        get t() { return t; }, get T() { return sc.T; }, get inCorso() { return !!raf; },
    };
    disegna();
    return ctl;
}
