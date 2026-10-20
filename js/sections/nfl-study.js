/**
 * Study of the Game — il laboratorio (#nfl-tactics/{SIGLA}/{ANNO}/study/{AVV}).
 *
 * Un attacco e una difesa VERI (depth chart ESPN di oggi, via
 * getStudyDepth) messi uno contro l'altro su un campo, con le leve che usa
 * un coordinatore: personnel e formazione da una parte, fronte, pacchetto,
 * copertura e blitz dall'altra. Il motore decide chi entra in campo, dove si
 * allinea e chi prende chi, e lo scrive.
 *
 * Cosa è VERO e cosa è DISEGNATO — la nota sotto il campo lo dice:
 *  - veri: i giocatori di ogni slot e la loro profondità, il fronte base
 *    (3-4/4-3 da ESPN), altezza e peso, e le frequenze — quanto quella
 *    squadra usa davvero un personnel, un pacchetto, una copertura (dati
 *    Tactics, cioè participation e FTN di nflverse);
 *  - disegnati: gli allineamenti e le regole di assegnazione. Sono quelli da
 *    manuale (tecniche dei DL, leve dei CB, zone delle coperture classiche),
 *    non il playbook di quella squadra, che non è pubblico.
 *
 * Convenzioni di campo: x in yard dal centro del campo (−26,67 … +26,67), a
 * destra = destra dell'attacco; y in yard dalla linea di scrimmage, negativo
 * nel backfield, positivo verso la difesa. Il lato "L" degli slot difensivi
 * ESPN (LDE, LCB…) è la sinistra della DIFESA, cioè la destra dell'attacco.
 */

import { DIMS } from '../data/tactics-catalog.js?v=1';
import { getTeamIdentity, NFL_TEAMS } from '../data/nfl-teams.js?v=513';

const LOGO = (abbr) => `https://a.espncdn.com/i/teamlogos/nfl/500/${String(abbr || '').toLowerCase()}.png`;
const esc = (v) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const HALF = 26.67;
const _cache = {};
const carica = (url) => (_cache[url] ??= fetch(url).then(r => (r.ok ? r.json() : null)).catch(() => null));

// ─── catalogo: personnel e formazioni ────────────────────────────────────

/** Ruoli d'attacco → da quale slot del depth chart si prende il giocatore. */
const OL = { LT: [-2.8, -0.6], LG: [-1.4, -0.6], C: [0, -0.6], RG: [1.4, -0.6], RT: [2.8, -0.6] };
const PERSONNEL = {
    11: '1 RB · 1 TE · 3 WR', 12: '1 RB · 2 TE · 2 WR', 21: '2 RB · 1 TE · 2 WR', 13: '1 RB · 3 TE · 1 WR',
    22: '2 RB · 2 TE · 1 WR', 10: '1 RB · 0 TE · 4 WR', '01': '0 RB · 1 TE · 4 WR',
};
/**
 * Formazioni, scritte col lato forte a DESTRA (il pulsante "Flip" le
 * specchia). Sulla linea servono almeno 7 uomini: i 5 di linea più due
 * estremi — chi è a −0.8 è sulla linea, chi è a −1.5 o più indietro no.
 */
const FORMAZIONI = [
    { key: 'gun22', pers: '11', label: 'Shotgun Doubles (2x2)', qb: [0, -5], spots: { RB: [1.6, -5], X: [-17, -0.8], SL: [-9, -1.5], Y: [4.3, -0.8], Z: [16.5, -1.5] } },
    { key: 'gun31', pers: '11', label: 'Shotgun Trips Right (3x1)', qb: [0, -5], spots: { RB: [-1.6, -5], X: [-17, -0.8], Y: [4.3, -0.8], SL: [9.5, -1.5], Z: [16.5, -1.5] } },
    { key: 'bunch', pers: '11', label: 'Shotgun Bunch Right', qb: [0, -5], spots: { RB: [-1.6, -5], X: [-17, -0.8], Y: [7, -0.8], SL: [8.4, -2.4], Z: [5.8, -2.4] } },
    { key: 'pistol', pers: '11', label: 'Pistol Doubles', qb: [0, -4], spots: { RB: [0, -7], X: [-17, -0.8], SL: [-9, -1.5], Y: [4.3, -0.8], Z: [16.5, -1.5] } },
    { key: 'sb31', pers: '11', label: 'Singleback Trips (under center)', qb: [0, -2.6], spots: { RB: [0, -7], X: [-17, -0.8], Y: [4.3, -0.8], SL: [9.5, -1.5], Z: [16.5, -1.5] } },
    { key: 'ace', pers: '12', label: 'Singleback Ace (two tight ends)', qb: [0, -2.6], spots: { RB: [0, -7], X: [-17, -1.5], Y2: [-4.3, -0.8], Y: [4.3, -0.8], Z: [16.5, -1.5] } },
    { key: 'gun12', pers: '12', label: 'Shotgun 2x2, TE flexed', qb: [0, -5], spots: { RB: [1.6, -5], X: [-17, -0.8], Y2: [-8.5, -1.5], Y: [4.3, -0.8], Z: [16.5, -1.5] } },
    { key: 'wing12', pers: '12', label: 'Under center, TE wing', qb: [0, -2.6], spots: { RB: [0, -7], X: [-17, -0.8], Y: [4.3, -0.8], Y2: [5.6, -1.8], Z: [16.5, -1.5] } },
    { key: 'ipro', pers: '21', label: 'I-Formation Pro', qb: [0, -2.6], spots: { FB: [0, -4.5], RB: [0, -7], X: [-17, -0.8], Y: [4.3, -0.8], Z: [16.5, -1.5] } },
    { key: 'offi', pers: '21', label: 'Offset I (strong)', qb: [0, -2.6], spots: { FB: [1.4, -4.5], RB: [0, -7], X: [-17, -0.8], Y: [4.3, -0.8], Z: [16.5, -1.5] } },
    { key: 'heavy', pers: '13', label: 'Heavy (three tight ends)', qb: [0, -2.6], spots: { RB: [0, -7], X: [-15, -1.5], Y3: [-4.3, -0.8], Y: [4.3, -0.8], Y2: [5.6, -1.8] } },
    { key: 'goal', pers: '22', label: 'Goal line (22 jumbo)', qb: [0, -2.6], spots: { FB: [0, -4], RB: [0, -6.5], X: [-12, -1.5], Y2: [-4.3, -0.8], Y: [4.3, -0.8] } },
    { key: 'gun10', pers: '10', label: 'Shotgun 4-wide (2x2)', qb: [0, -5], spots: { RB: [1.6, -5], X: [-17, -0.8], SL: [-9, -1.5], W4: [9, -1.5], Z: [17, -0.8] } },
    { key: 'empty10', pers: '10', label: 'Empty 3x2 (back split out)', qb: [0, -5], spots: { X: [-17, -0.8], SL: [-9, -1.5], RB: [5.3, -1.5], W4: [11.5, -1.5], Z: [17, -0.8] } },
    { key: 'empty01', pers: '01', label: 'Empty 3x2 with TE', qb: [0, -5], spots: { X: [-17, -0.8], SL: [-9, -1.5], Y: [4.3, -0.8], W4: [10, -1.5], Z: [17, -1.5] } },
];
const RUOLO = { X: 'X · split end', Z: 'Z · flanker', SL: 'Slot', W4: '4th WR', Y: 'Y · TE1', Y2: 'TE2', Y3: 'TE3', RB: 'RB', FB: 'FB', QB: 'QB', LT: 'LT', LG: 'LG', C: 'C', RG: 'RG', RT: 'RT' };
const TIPO_RIC = { X: 'wide', Z: 'wide', SL: 'slot', W4: 'slot', Y: 'te', Y2: 'te', Y3: 'te', RB: 'rb', FB: 'rb' };

const FRONTI = {
    '4-3': [{ key: 'over', label: '4-3 Over' }, { key: 'under', label: '4-3 Under' }],
    '3-4': [{ key: 'okie', label: '3-4 Okie (5-0-5)' }, { key: 'tite', label: '3-4 Tite (4i-0-4i)' }],
};
const PACCHETTI = [
    { key: 'base', label: 'Base' }, { key: 'nickel', label: 'Nickel (5 DB)' }, { key: 'dime', label: 'Dime (6 DB)' }, { key: 'goal', label: 'Goal line' },
];
const COPERTURE = [
    { key: 'c0', label: 'Cover 0', code: 'COVER_0', man: true, deep: 0 },
    { key: 'c1', label: 'Cover 1', code: 'COVER_1', man: true, deep: 1 },
    { key: 'c2m', label: '2-Man', code: '2_MAN', man: true, deep: 2 },
    { key: 'c2', label: 'Cover 2', code: 'COVER_2', man: false, deep: 2 },
    { key: 'tampa', label: 'Tampa 2', code: null, man: false, deep: 3 },
    { key: 'c3', label: 'Cover 3', code: 'COVER_3', man: false, deep: 3 },
    { key: 'c4', label: 'Cover 4 (quarters)', code: 'COVER_4', man: false, deep: 4 },
    { key: 'c6', label: 'Cover 6', code: 'COVER_6', man: false, deep: 3 },
];
const SPIEGA = {
    c0: 'All-out man, no deep safety: everyone covers a receiver and the rest blitz. The ball must come out fast — the hot route beats it.',
    c1: 'Man across the board with one free safety deep in the middle; one defender left over plays the "robber" in the middle.',
    c2m: 'Two safeties split the deep field in halves; the five underneath play man, trailing their receiver.',
    c2: 'Two deep halves; the corners squat in the flats and the linebackers wall off the hooks. Soft spot: the hole between corner and safety on the sideline.',
    tampa: 'Cover 2 with the middle linebacker running to the deep middle — the hole between the safeties is closed.',
    c3: 'Three deep thirds (both corners and the free safety) and four underneath; the strong safety rotates down to the curl/flat on the strong side.',
    c4: 'Four deep quarters (corners and safeties); safeties read the No. 2 receiver and can fit the run. Soft spot: the flats.',
    c6: 'Quarter-quarter-half: quarters to the strong side, Cover 2 to the weak side.',
};

// ─── chi va in campo ─────────────────────────────────────────────────────

/** Prende il primo giocatore di uno slot non ancora in campo (lo stesso
 *  nome può comparire in due slot: Ben Brown sotto C e RG). */
function primo(dc, keys, usati, salto = 0) {
    const lista = [];
    for (const k of keys) for (const p of (dc[k] || [])) lista.push(p);
    let n = 0;
    for (const p of lista) { if (usati.has(p.id)) continue; if (n++ < salto) continue; usati.add(p.id); return p; }
    return null;
}

function attaccoInCampo(dep, form, flip) {
    const o = dep.offense, usati = new Set(), s = flip ? -1 : 1;
    const pl = [];
    const metti = (ruolo, p, xy) => { if (p) pl.push({ ruolo, p, x: xy[0] * s, y: xy[1], lato: 'off', tipo: TIPO_RIC[ruolo] || (ruolo === 'QB' ? 'qb' : 'ol') }); };
    metti('QB', primo(o, ['qb'], usati), form.qb);
    for (const [k, xy] of Object.entries(OL)) metti(k, primo(o, [k.toLowerCase()], usati), [xy[0], xy[1]]);
    const prendi = {
        X: () => primo(o, ['wr1', 'wr'], usati), Z: () => primo(o, ['wr2', 'wr'], usati), SL: () => primo(o, ['wr3', 'wr'], usati),
        W4: () => primo(o, ['wr1', 'wr2', 'wr3', 'wr'], usati), Y: () => primo(o, ['te'], usati), Y2: () => primo(o, ['te'], usati),
        Y3: () => primo(o, ['te'], usati), RB: () => primo(o, ['rb'], usati), FB: () => primo(o, ['fb'], usati) || primo(o, ['rb'], usati),
    };
    // Ordine di scelta: titolari degli slot fissi prima, poi i riempitivi.
    for (const ruolo of ['X', 'Z', 'SL', 'Y', 'RB', 'FB', 'Y2', 'Y3', 'W4']) {
        if (form.spots[ruolo]) metti(ruolo, prendi[ruolo](), form.spots[ruolo]);
    }
    // Le riserve di ogni giocatore in campo: il resto del suo slot.
    for (const g of pl) g.riserve = riserveDi(o, g, usati);
    return pl;
}
const SLOT_DI = { X: ['wr1'], Z: ['wr2'], SL: ['wr3'], W4: ['wr1', 'wr2', 'wr3'], Y: ['te'], Y2: ['te'], Y3: ['te'], RB: ['rb'], FB: ['fb', 'rb'], QB: ['qb'] };
function riserveDi(dc, g, usati) {
    const keys = SLOT_DI[g.ruolo] || [g.ruolo.toLowerCase()];
    const out = [];
    for (const k of keys) for (const p of (dc[k] || [])) if (p.id !== g.p.id && !usati.has(p.id) && !out.some(x => x.id === p.id)) out.push(p);
    return out.slice(0, 3);
}

/** Il lato forte: quello del TE titolare; senza TE, quello con più
 *  ricevitori; a parità, la destra. */
function latoForte(att) {
    const y = att.find(g => g.ruolo === 'Y');
    if (y) return Math.sign(y.x) || 1;
    const ric = att.filter(g => TIPO_RIC[g.ruolo] && g.ruolo !== 'RB' && g.ruolo !== 'FB');
    const d = ric.filter(g => g.x > 0).length - ric.filter(g => g.x < 0).length;
    return d >= 0 ? 1 : -1;
}

/**
 * Gli undici della difesa per fronte e pacchetto. Nickel nel 4-3: esce il
 * SAM. Nickel nel 3-4: esce il NT e i due DE stringono (2-4-5, è la nickel
 * più giocata della lega). Dime: entra il miglior CB di riserva al posto di
 * un linebacker. Goal line: un DL in più, fuori la FS e il nickel.
 */
function difesaInCampo(dep, schema, pacchetto) {
    const d = dep.defense, usati = new Set();
    const p = (keys, salto) => primo(d, keys, usati, salto);
    const g = [];
    const metti = (ruolo, giocatore, extra = {}) => { if (giocatore) g.push({ ruolo, p: giocatore, lato: 'def', ...extra }); };
    if (schema === '3-4') {
        metti('LDE', p(['lde', 'ldt'])); metti('RDE', p(['rde', 'rdt']));
        if (pacchetto !== 'nickel' && pacchetto !== 'dime') metti('NT', p(['nt', 'ldt', 'rdt']));
        if (pacchetto === 'goal') metti('DL', p(['nt', 'ldt', 'rdt', 'lde', 'rde']));
        metti('SLB', p(['slb', 'rolb', 'lolb', 'olb'])); metti('WLB', p(['wlb', 'lolb', 'rolb', 'olb']));
        metti('LILB', p(['lilb', 'mlb', 'ilb']));
        if (pacchetto !== 'dime') metti('RILB', p(['rilb', 'mlb', 'ilb']));
    } else {
        metti('LDE', p(['lde'])); metti('LDT', p(['ldt', 'nt'])); metti('RDT', p(['rdt', 'nt'])); metti('RDE', p(['rde']));
        if (pacchetto === 'goal') metti('NT', p(['nt', 'ldt', 'rdt']));
        metti('MLB', p(['mlb', 'lilb', 'rilb']));
        if (pacchetto !== 'dime') metti('WLB', p(['wlb']));
        if (pacchetto === 'base' || pacchetto === 'goal') metti('SLB', p(['slb']));
    }
    metti('LCB', p(['lcb', 'cb'])); metti('RCB', p(['rcb', 'cb']));
    if (pacchetto === 'nickel' || pacchetto === 'dime') metti('NB', p(['nb', 'lcb', 'rcb', 'cb']));
    if (pacchetto === 'dime') metti('DB', p(['lcb', 'rcb', 'nb', 'cb', 'ss', 'fs']));
    metti('SS', p(['ss', 's']));
    if (pacchetto !== 'goal') metti('FS', p(['fs', 's']));
    for (const x of g) x.riserve = (d[x.ruolo.toLowerCase()] || []).filter(q => q.id !== x.p.id && !usati.has(q.id)).slice(0, 3);
    return g;
}

// ─── allineamenti difensivi ──────────────────────────────────────────────

/** Ascissa di una tecnica (0, 1, 2i, 3, 4i, 4, 5, 6, 7, 9) sul lato `s`
 *  (+1 destra dell'attacco). Si misura sugli uomini di linea veri. */
function tecnica(t, s, att) {
    const te = att.find(g => g.tipo === 'te' && Math.sign(g.x) === s && Math.abs(g.y) < 1 && Math.abs(g.x) < 6);
    const G = 1.4 * s, T = 2.8 * s, E = te ? te.x : (2.8 + 1.4) * s;
    return ({ 0: 0, 1: 0.7 * s, '2i': G - 0.35 * s, 3: G + 0.5 * s, '4i': T - 0.35 * s, 4: T, 5: T + 0.55 * s, 6: E - 0.3 * s, 7: E + 0.5 * s, 9: E + 1.6 * s, w9: E + 3 * s })[t];
}

function allinea(dif, att, schema, fronte, pacchetto, cop, S) {
    const pos = (g, x, y, tec) => { g.x = x; g.y = y; if (tec != null) g.tec = tec; };
    const by = (r) => dif.find(g => g.ruolo === r);
    // Lati fissi degli slot ESPN: "L" della difesa = destra dell'attacco.
    const latoSlot = (r) => (r.startsWith('L') ? 1 : r.startsWith('R') ? -1 : 0);
    const forteDE = latoSlot('LDE') === S ? by('LDE') : by('RDE');
    const deboleDE = forteDE === by('LDE') ? by('RDE') : by('LDE');
    const nick = pacchetto === 'nickel' || pacchetto === 'dime';
    if (schema === '3-4') {
        const t = nick ? '3' : fronte === 'tite' ? '4i' : '5';
        if (forteDE) pos(forteDE, tecnica(t, S, att), 1, t);
        if (deboleDE) pos(deboleDE, tecnica(t, -S, att), 1, t);
        const nt = by('NT'); if (nt) pos(nt, 0, 1, '0');
        const dl = by('DL'); if (dl) pos(dl, tecnica('2i', -S, att), 1, '2i');
        const sam = by('SLB'), will = by('WLB');
        if (sam) pos(sam, tecnica(nick ? '9' : '7', S, att), 1.2, nick ? '9' : '7');
        if (will) pos(will, tecnica(nick ? 'w9' : '9', -S, att), 1.2, nick ? 'w9' : '9');
        const li = by('LILB'), ri = by('RILB');
        if (li && ri) { pos(li, 2.2 * latoSlot('LILB'), 4.5); pos(ri, 2.2 * latoSlot('RILB'), 4.5); } else if (li) pos(li, 0.8 * S, 4.8);
    } else {
        const dtForte = latoSlot('LDT') === S ? by('LDT') : by('RDT');
        const dtDebole = dtForte === by('LDT') ? by('RDT') : by('LDT');
        if (fronte === 'under') {
            if (forteDE) pos(forteDE, tecnica('5', S, att), 1, '5');
            if (dtForte) pos(dtForte, tecnica('1', S, att), 1, '1');
            if (dtDebole) pos(dtDebole, tecnica('3', -S, att), 1, '3');
            if (deboleDE) pos(deboleDE, tecnica(nick ? 'w9' : '5', -S, att), 1, nick ? 'w9' : '5');
        } else {
            if (forteDE) pos(forteDE, tecnica(att.some(g => g.ruolo === 'Y') ? '6' : '5', S, att), 1, att.some(g => g.ruolo === 'Y') ? '6' : '5');
            if (dtForte) pos(dtForte, tecnica('3', S, att), 1, '3');
            if (dtDebole) pos(dtDebole, tecnica('1', -S, att), 1, '1');
            if (deboleDE) pos(deboleDE, tecnica(nick ? 'w9' : '5', -S, att), 1, nick ? 'w9' : '5');
        }
        const nt = by('NT'); if (nt) pos(nt, 0, 1, '0');
        const sam = by('SLB'), mike = by('MLB'), will = by('WLB');
        if (sam) pos(sam, fronte === 'under' ? tecnica('9', S, att) : tecnica('7', S, att) + 0.6 * S, fronte === 'under' ? 1.2 : 4.2, fronte === 'under' ? '9' : null);
        if (mike) pos(mike, (nick ? 1.2 : 0.4) * S, 4.8);
        if (will) pos(will, -(nick ? 2.6 : 3.4) * S, 4.5);
    }
    const lb = by('LB'); if (lb) pos(lb, -1.5 * S, 3.5);
    // Secondario: i CB sul ricevitore più esterno del loro lato, il nickel
    // sullo slot. Pressati nelle coperture a uomo, a 6-7 yard nelle altre.
    const ric = att.filter(g => TIPO_RIC[g.ruolo]);
    const esterno = (s) => ric.filter(g => Math.sign(g.x) === s).sort((a, b) => Math.abs(b.x) - Math.abs(a.x))[0];
    const press = cop.man;
    for (const r of ['LCB', 'RCB']) {
        const g = by(r); if (!g) continue;
        const s = latoSlot(r), w = esterno(s);
        pos(g, w ? w.x + 0.6 * s : 15 * s, press ? 1.5 : 6.5);
    }
    // Nickel e dime sugli slot interni, dal lato con più ricevitori.
    const interni = ric.filter(g => g.tipo === 'slot' || (g.tipo === 'te' && Math.abs(g.x) > 6) || (g.tipo === 'wide' && g !== esterno(Math.sign(g.x))))
        .sort((a, b) => Math.abs(a.x) - Math.abs(b.x));
    const nb = by('NB'), db2 = by('DB');
    // Senza un ricevitore nello slot il nickel si mette "overhang", fuori
    // dal TE e a 5 yard: sopra la linea finirebbe addosso al SAM.
    if (nb) { const t = interni.find(g => Math.sign(g.x) === S) || interni[0]; if (t) pos(nb, t.x - 0.4 * Math.sign(t.x), press ? 1.5 : 5); else pos(nb, 7 * S, 5); }
    if (db2) { const t = interni.find(g => !nb || Math.abs(g.x - nb.x) > 2) || interni[1]; if (t) pos(db2, t.x - 0.4 * Math.sign(t.x), press ? 1.5 : 5); else pos(db2, -7 * S, 5); }
    const ss = by('SS'), fs = by('FS');
    const scheme = {
        c0: [[4.5 * S, 6], [-4.5 * S, 6]], c1: [[6 * S, 8], [0, 13]], c2m: [[10 * S, 12], [-10 * S, 12]], c2: [[10 * S, 12], [-10 * S, 12]],
        tampa: [[10 * S, 12], [-10 * S, 12]], c3: [[6 * S, 8], [0, 13]], c4: [[7 * S, 10], [-7 * S, 10]], c6: [[7 * S, 10], [-10 * S, 12]],
    }[cop.key];
    if (ss) pos(ss, scheme[0][0], scheme[0][1]);
    if (fs) pos(fs, scheme[1][0], scheme[1][1]);
    for (const x of dif) if (x.x == null) pos(x, 0, 5);
}

// ─── assegnazioni: rush, copertura, protezione ───────────────────────────

const ZONE = {
    flatL: [-HALF, -14, 0, 8, 'Flat'], curlL: [-14, -6, 5, 15, 'Curl'], hookL: [-6, 0, 4, 12, 'Hook'], hookM: [-4, 4, 4, 12, 'Hook'],
    hookR: [0, 6, 4, 12, 'Hook'], curlR: [6, 14, 5, 15, 'Curl'], flatR: [14, HALF, 0, 8, 'Flat'],
    cfL: [-HALF, -7, 0, 13, 'Curl / flat'], cfR: [7, HALF, 0, 13, 'Curl / flat'],
    d3L: [-HALF, -8.9, 13, 34, 'Deep third'], d3M: [-8.9, 8.9, 13, 34, 'Deep middle third'], d3R: [8.9, HALF, 13, 34, 'Deep third'],
    d2L: [-HALF, 0, 13, 34, 'Deep half'], d2R: [0, HALF, 13, 34, 'Deep half'],
    d4LL: [-HALF, -13.3, 11, 34, 'Deep quarter'], d4L: [-13.3, 0, 11, 34, 'Deep quarter'], d4R: [0, 13.3, 11, 34, 'Deep quarter'], d4RR: [13.3, HALF, 11, 34, 'Deep quarter'],
    tampaM: [-5, 5, 10, 22, 'Deep middle (Tampa)'], robber: [-5, 5, 6, 13, 'Robber / hole'],
};
const SOTTO = { 1: ['hookM'], 2: ['hookL', 'hookR'], 3: ['cfL', 'hookM', 'cfR'], 4: ['cfL', 'hookL', 'hookR', 'cfR'], 5: ['flatL', 'curlL', 'hookM', 'curlR', 'flatR'], 6: ['flatL', 'curlL', 'hookL', 'hookR', 'curlR', 'flatR'] };

const famiglia = (r) => (/CB|^DB$/.test(r) ? 'cb' : r === 'NB' ? 'nb' : /SS|FS/.test(r) ? 's' : /LB/.test(r) ? 'lb' : 'dl');

function assegna(dif, att, cop, schema, pacchetto, blitz, prot, S) {
    const by = (r) => dif.find(g => g.ruolo === r);
    for (const g of dif) { g.compito = null; g.zona = null; g.marca = null; g.rush = false; }
    // Rush: tutti i DL; nel 3-4 base anche l'OLB debole (il SAM scende).
    for (const g of dif) if (famiglia(g.ruolo) === 'dl' || g.ruolo === 'NT' || g.ruolo === 'DL') g.rush = true;
    if (schema === '3-4') {
        const will = by('WLB'), sam = by('SLB');
        if (will) will.rush = true;
        const nick = pacchetto === 'nickel' || pacchetto === 'dime';
        if (sam && nick) sam.rush = true;
    }
    // Blitz: prima i linebacker interni, poi il nickel.
    const extra = Math.max(blitz, cop.key === 'c0' ? 2 : 0);
    const candidati = ['MLB', 'LILB', 'RILB', 'SLB', 'WLB', 'NB', 'LB'].map(by).filter(g => g && !g.rush);
    candidati.slice(0, extra).forEach(g => { g.rush = true; g.blitz = true; });
    for (const g of dif) if (g.rush) g.compito = g.blitz ? 'Blitz' : 'Pass rush';

    const copertura = dif.filter(g => !g.rush);
    const ric = att.filter(g => TIPO_RIC[g.ruolo] && !(prot.rb && (g.ruolo === 'RB' || g.ruolo === 'FB') && g.y < -2) && !(prot.te && g.tipo === 'te' && Math.abs(g.y) < 1 && Math.abs(g.x) < 6));
    const deep = [];
    const prendi = (g, zona) => { if (!g) return; g.zona = zona; g.compito = ZONE[zona][4]; deep.push(g); };
    const cbL = by('LCB'), cbR = by('RCB'), ss = by('SS'), fs = by('FS');
    const cbDi = (s) => (s === 1 ? cbL : cbR); // LCB = destra dell'attacco
    // Le due safety per lato (in goal line la FS non c'è: resta una sola).
    const [sDx, sSx] = [ss, fs].filter(Boolean).sort((a, b) => b.x - a.x);
    if (cop.key === 'c1') prendi(fs, 'd3M');
    if (cop.key === 'c2m' || cop.key === 'c2' || cop.key === 'tampa') { prendi(sDx, 'd2R'); prendi(sSx, 'd2L'); }
    if (cop.key === 'tampa') { const m = by('MLB') || by('LILB') || by('RILB'); if (m && !m.rush) prendi(m, 'tampaM'); }
    if (cop.key === 'c3') { prendi(cbL, 'd3R'); prendi(cbR, 'd3L'); prendi(fs, 'd3M'); }
    if (cop.key === 'c4') { prendi(cbL, 'd4RR'); prendi(cbR, 'd4LL'); prendi(sDx, 'd4R'); prendi(sSx, 'd4L'); }
    if (cop.key === 'c6') {
        prendi(cbDi(S), S > 0 ? 'd4RR' : 'd4LL'); prendi(ss, S > 0 ? 'd4R' : 'd4L');
        prendi(fs, S > 0 ? 'd2L' : 'd2R');
    }
    const sotto = copertura.filter(g => !deep.includes(g));
    const scoperti = [];
    if (cop.man) {
        // Coppie difensore-ricevitore al costo più basso: tipo di ricevitore
        // contro famiglia del difensore, più la distanza laterale.
        const PEN = { wide: { cb: 0, nb: 1, s: 3, lb: 6, dl: 9 }, slot: { nb: 0, cb: 1, s: 1.5, lb: 4, dl: 9 }, te: { s: 0.5, lb: 1, nb: 1.5, cb: 2.5, dl: 9 }, rb: { lb: 0, s: 1.5, nb: 2, cb: 3, dl: 9 } };
        const coppie = [];
        for (const d of sotto) for (const r of ric) coppie.push([PEN[TIPO_RIC[r.ruolo]][famiglia(d.ruolo)] + Math.abs(d.x - r.x) * 0.08, d, r]);
        coppie.sort((a, b) => a[0] - b[0]);
        const dPresi = new Set(), rPresi = new Set();
        for (const [, d, r] of coppie) {
            if (dPresi.has(d) || rPresi.has(r)) continue;
            dPresi.add(d); rPresi.add(r);
            d.marca = r; d.compito = `Man on ${RUOLO[r.ruolo] || r.ruolo}`;
        }
        for (const r of ric) if (!rPresi.has(r)) scoperti.push(r);
        const avanzi = sotto.filter(d => !dPresi.has(d));
        if (avanzi.length) { avanzi[0].zona = cop.key === 'c1' ? 'robber' : 'hookM'; avanzi[0].compito = cop.key === 'c1' ? 'Robber / hole' : 'Hook (spy)'; }
        avanzi.slice(1).forEach(g => { g.zona = 'hookM'; g.compito = 'Hook / QB spy'; });
    } else {
        // Zona: le zone sotto in ordine da sinistra a destra, ai difensori
        // ordinati allo stesso modo. È la regola che fa scendere da sé la SS
        // del Cover 3 sul curl/flat del suo lato.
        const zone = SOTTO[Math.min(6, sotto.length)] || [];
        let lista = [...sotto].sort((a, b) => a.x - b.x);
        // Nel Cover 2 i CB restano nei flat: li si mette ai due estremi.
        if (cop.key === 'c2' || cop.key === 'tampa') lista = [cbR, ...lista.filter(g => g !== cbL && g !== cbR), cbL].filter(Boolean);
        lista.forEach((g, i) => { const z = zone[i] || 'hookM'; g.zona = z; g.compito = ZONE[z][4]; });
    }

    // Protezione: 5 di linea (+ RB e TE se restano a bloccare) sui rusher,
    // per vicinanza laterale. Chi resta libero è il "hot" del QB.
    const rusher = dif.filter(g => g.rush).sort((a, b) => a.x - b.x);
    const bloccanti = att.filter(g => g.tipo === 'ol'
        || (prot.te && g.tipo === 'te' && Math.abs(g.y) < 1 && Math.abs(g.x) < 6)
        || (prot.rb && (g.ruolo === 'RB' || g.ruolo === 'FB') && g.y < -2));
    for (const g of att) { g.blocca = null; g.compito = g.tipo === 'ol' ? 'Pass protection' : g.tipo === 'qb' ? 'Quarterback' : 'Route'; }
    const coppieB = [];
    for (const b of bloccanti) for (const r of rusher) coppieB.push([Math.abs(b.x - r.x) + (b.tipo === 'ol' ? 0 : 1.5), b, r]);
    coppieB.sort((a, b) => a[0] - b[0]);
    const bPresi = new Set(), rB = new Set();
    for (const [, b, r] of coppieB) { if (bPresi.has(b) || rB.has(r)) continue; bPresi.add(b); rB.add(r); b.blocca = r; b.compito = `Blocks ${r.ruolo}`; }
    for (const b of bloccanti) if (!bPresi.has(b)) b.compito = b.tipo === 'ol' ? 'Pass protection (double team)' : 'Check, then release';
    const liberi = rusher.filter(r => !rB.has(r));
    liberi.forEach(r => { r.libero = true; r.compito += ' · UNBLOCKED'; });
    return { scoperti, liberi, rusher: rusher.length, bloccanti: bloccanti.length, copertura: copertura.length };
}

// ─── stato e caricamento ─────────────────────────────────────────────────

let S = null;
export async function renderStudy(corpo, { team, anno, avv }) {
    corpo.innerHTML = '<div class="loading-state"><div class="spinner"></div></div>';
    const fc = await import('../data/nfl-flip-card.js?v=9').catch(() => null);
    if (!fc?.getStudyDepth) { corpo.innerHTML = '<p class="pm-note">The lab could not be loaded.</p>'; return; }
    // Avversario: quello dell'indirizzo, o l'ultima partita giocata.
    let opp = avv && NFL_TEAMS[avv] ? avv : null;
    if (!opp) {
        const idx = await carica(`data/nfl/plays/${anno}/index.json`) || await carica(`data/nfl/plays/${anno - 1}/index.json`);
        const nv = team === 'LAR' ? 'LA' : team;
        const g = idx?.games?.filter(x => x.home === nv || x.away === nv).pop();
        opp = g ? ((g.home === nv ? g.away : g.home) === 'LA' ? 'LAR' : (g.home === nv ? g.away : g.home)) : (team === 'DAL' ? 'PHI' : 'DAL');
    }
    S = { team, anno, fc, attacco: team, difesa: opp, pers: '11', form: 'gun22', flip: false, pacchetto: null, fronte: null, cop: 'c1', blitz: 0,
        prot: { rb: true, te: false }, riserve: false, nomi: true, zone: true, sel: null, dep: {}, tac: {} };
    corpo.innerHTML = '<div class="st-wrap" id="st-root"></div>';
    leghe(corpo);
    await caricaSquadre(corpo);
}

async function caricaSquadre(corpo) {
    const root = corpo.querySelector('#st-root');
    root.innerHTML = '<div class="loading-state"><div class="spinner"></div></div>';
    const { attacco, difesa, anno } = S;
    const [da, dd, ta, td] = await Promise.all([
        S.fc.getStudyDepth(attacco), S.fc.getStudyDepth(difesa), tattiche(attacco, anno), tattiche(difesa, anno),
    ]);
    if (S.attacco !== attacco || S.difesa !== difesa) return;
    if (!da || !dd) { root.innerHTML = '<p class="pm-note">ESPN did not return the depth chart for one of the two teams. Try again in a moment.</p>'; return; }
    S.dep = { off: da, def: dd };
    S.tac = { off: ta, def: td };
    if (!S.fronte || !FRONTI[dd.scheme || '4-3']?.some(f => f.key === S.fronte)) S.fronte = FRONTI[dd.scheme || '4-3'][0].key;
    if (!S.pacchetto) {
        const p = piuProbabile();
        S.pacchetto = p?.pkg || 'nickel';
        if (p?.cov) S.cop = p.cov;
    }
    disegna(corpo);
}

/** Frequenze Tactics: la stagione scelta, o la precedente se la
 *  participation (personnel, pacchetti, coperture) non è ancora uscita. */
async function tattiche(team, anno) {
    let d = await carica(`data/nfl/tactics/${anno}/${team}.json`);
    let usato = anno;
    if (!d?.avail?.part) {
        const prima = await carica(`data/nfl/tactics/${anno - 1}/${team}.json`);
        if (prima?.avail?.part) { d = prima; usato = anno - 1; }
    }
    return d ? { d, anno: usato } : null;
}

const pacchettoDa = (label) => (/^Nickel/.test(label) ? 'nickel' : /^Dime|^Quarter/.test(label) ? 'dime' : /^Goal/.test(label) ? 'goal' : 'base');
/** La chiamata più probabile della difesa contro il personnel scelto. */
function piuProbabile() {
    const t = S.tac.def?.d?.side?.def?.mx;
    if (!t) return null;
    const pp = t.persPkg?.[S.pers], pc = t.persCov?.[S.pers];
    const top = (row) => Object.entries(row || {}).sort((a, b) => b[1][0] - a[1][0]);
    const tp = top(pp), tc = top(pc);
    const totP = tp.reduce((s, x) => s + x[1][0], 0), totC = tc.reduce((s, x) => s + x[1][0], 0);
    if (!tp.length) return null;
    const pkgTot = {};
    for (const [l, a] of tp) pkgTot[pacchettoDa(l)] = (pkgTot[pacchettoDa(l)] || 0) + a[0];
    const pkg = Object.entries(pkgTot).sort((a, b) => b[1] - a[1])[0];
    const cov = tc.find(([c]) => COPERTURE.some(x => x.code === c));
    return { pkg: pkg[0], pkgShare: pkg[1] / totP, cov: cov ? COPERTURE.find(x => x.code === cov[0]).key : null, covShare: cov ? cov[1][0] / totC : null, n: totP, rows: { tp, tc, totP, totC } };
}

// ─── disegno ─────────────────────────────────────────────────────────────

function disegna(corpo) {
    const root = corpo.querySelector('#st-root');
    const schema = S.dep.def.scheme || '4-3';
    const form = FORMAZIONI.find(f => f.key === S.form) || FORMAZIONI[0];
    const cop = COPERTURE.find(c => c.key === S.cop);
    const att = attaccoInCampo(S.dep.off, form, S.flip);
    const forte = latoForte(att);
    const dif = difesaInCampo(S.dep.def, schema, S.pacchetto);
    allinea(dif, att, schema, S.fronte, S.pacchetto, cop, forte);
    const esito = assegna(dif, att, cop, schema, S.pacchetto, S.blitz, S.prot, forte);
    S.ultimo = { att, dif, esito, forte, cop, form, schema };
    const scroll = root.querySelector('.st-side')?.scrollTop;
    root.innerHTML = `
        ${squadreHtml()}
        <div class="st-grid">
            <div class="st-main">
                ${controlliHtml(schema)}
                ${campoHtml(att, dif, esito, cop)}
                <p class="st-truth">Players, depth and the base front are ESPN's depth charts as of today; heights and weights from the ESPN roster. Frequencies are real (nflverse participation and FTN, ${S.tac.def?.anno ?? '—'} for ${esc(S.difesa)}, ${S.tac.off?.anno ?? '—'} for ${esc(S.attacco)}). Alignments, techniques, zones and assignments are <b>textbook rules</b>, not the team's playbook — which is not public.</p>
            </div>
            <aside class="st-side">
                ${probabileHtml()}
                ${statoHtml(esito, cop)}
                ${selezioneHtml(att, dif)}
                ${matchupHtml(att, dif, cop)}
                ${frequenzeHtml()}
            </aside>
        </div>`;
    if (scroll) root.querySelector('.st-side').scrollTop = scroll;
}

function selSquadra(id, val) {
    const perDiv = {};
    for (const [a, t] of Object.entries(NFL_TEAMS)) (perDiv[t.division] ??= []).push([a, t.name]);
    return `<select class="tx-select" id="${id}">${Object.keys(perDiv).sort().map(d => `<optgroup label="${esc(d)}">${perDiv[d].sort((a, b) => a[1].localeCompare(b[1])).map(([a, n]) => `<option value="${a}"${a === val ? ' selected' : ''}>${esc(n)}</option>`).join('')}</optgroup>`).join('')}</select>`;
}

function squadreHtml() {
    return `<div class="st-teams">
        <div class="st-team"><img src="${LOGO(S.attacco)}" alt=""><span><small>Offense</small>${selSquadra('st-off', S.attacco)}</span></div>
        <button type="button" class="st-swap" data-st-swap title="Swap offense and defense">⇄</button>
        <div class="st-team"><img src="${LOGO(S.difesa)}" alt=""><span><small>Defense · ${esc(S.dep.def.scheme ? `Base ${S.dep.def.scheme}` : 'front n/a')} (ESPN)</small>${selSquadra('st-def', S.difesa)}</span></div>
    </div>`;
}

const pill = (attr, val, cur, label, extra = '') => `<button type="button" class="st-pill${val === cur ? ' is-on' : ''}" data-${attr}="${val}"${extra}>${label}</button>`;
function usoPers(p) {
    const v = S.tac.off?.d?.side?.off?.dims?.personnel?.[p];
    const tot = Object.values(S.tac.off?.d?.side?.off?.dims?.personnel || {}).reduce((s, a) => s + a[0], 0);
    return v && tot ? ` <small>${Math.round(100 * v[0] / tot)}%</small>` : '';
}
function usoCop(code) {
    const v = S.tac.def?.d?.side?.def?.dims?.coverage;
    if (!v || !code || !v[code]) return '';
    const tot = Object.values(v).reduce((s, a) => s + a[0], 0);
    return ` <small>${Math.round(100 * v[code][0] / tot)}%</small>`;
}
function usoPkg(k) {
    const v = S.tac.def?.d?.side?.def?.dims?.defPackage;
    if (!v) return '';
    const tot = Object.values(v).reduce((s, a) => s + a[0], 0);
    const n = Object.entries(v).filter(([l]) => pacchettoDa(l) === k).reduce((s, [, a]) => s + a[0], 0);
    return tot ? ` <small>${Math.round(100 * n / tot)}%</small>` : '';
}

function controlliHtml(schema) {
    const forms = FORMAZIONI.filter(f => f.pers === S.pers);
    return `<div class="st-controls">
        <div class="st-row"><span class="st-lab">Personnel</span>${Object.keys(PERSONNEL).map(p => pill('st-pers', p, S.pers, `${p}${usoPers(p)}`, ` title="${PERSONNEL[p]}"`)).join('')}</div>
        <div class="st-row"><span class="st-lab">Formation</span>${forms.map(f => pill('st-form', f.key, S.form, esc(f.label))).join('')}${pill('st-flip', '1', S.flip ? '1' : '', 'Flip ⇆')}</div>
        <div class="st-row"><span class="st-lab">Front</span>${FRONTI[schema].map(f => pill('st-front', f.key, S.fronte, esc(f.label))).join('')}</div>
        <div class="st-row"><span class="st-lab">Package</span>${PACCHETTI.map(p => pill('st-pkg', p.key, S.pacchetto, `${esc(p.label)}${usoPkg(p.key)}`)).join('')}</div>
        <div class="st-row"><span class="st-lab">Coverage</span>${COPERTURE.map(c => pill('st-cov', c.key, S.cop, `${esc(c.label)}${usoCop(c.code)}`)).join('')}</div>
        <div class="st-row"><span class="st-lab">Pressure</span>${[0, 1, 2].map(b => pill('st-blitz', String(b), String(S.blitz), b === 0 ? 'No blitz' : `+${b} blitzer${b > 1 ? 's' : ''}`)).join('')}
            <span class="st-lab st-lab--in">Protection</span>
            ${pill('st-prot', 'rb', S.prot.rb ? 'rb' : '', 'RB stays in')}${pill('st-prot', 'te', S.prot.te ? 'te' : '', 'TE stays in')}</div>
        <div class="st-row"><span class="st-lab">Show</span>
            ${pill('st-show', 'riserve', S.riserve ? 'riserve' : '', 'Backups')}${pill('st-show', 'nomi', S.nomi ? 'nomi' : '', 'Names')}${pill('st-show', 'zone', S.zone ? 'zone' : '', 'Zones & assignments')}</div>
    </div>`;
}

const cognome = (n) => String(n || '').split(' ').slice(1).join(' ') || n;
function campoHtml(att, dif, esito, cop) {
    // Scala NON lineare, come nei diagrammi dei coach: in scala vera i
    // lineman stanno a 1,4 yard l'uno dall'altro e si coprirebbero. Vicino
    // alla palla (6 yard per lato, 6 di profondità) si allarga, oltre si
    // comprime; le linee delle yard restano dove sono davvero, quindi le
    // distanze si leggono ancora. La didascalia lo dichiara.
    const sc = 12, Y0 = -13, Y1 = 26;
    const fx = (x) => { const a = Math.abs(x); return Math.sign(x) * (a <= 6 ? a * 2.2 : 13.2 + (a - 6) * ((HALF - 13.2) / (HALF - 6))); };
    const fy = (y) => { const a = Math.abs(y); return Math.sign(y) * (a <= 6 ? a * 1.8 : 10.8 + (a - 6) * 0.75); };
    const W = HALF * 2 * sc, H = (fy(Y1) - fy(Y0)) * sc;
    const X = (x) => (fx(x) + HALF) * sc, Yp = (y) => (fy(Y1) - fy(y)) * sc;
    const colA = getTeamIdentity(S.attacco)?.color || '#4f8cff', colD = getTeamIdentity(S.difesa)?.color || '#b8433a';
    const righe = [];
    for (let y = -10; y <= 30; y += 5) righe.push(`<line x1="0" y1="${Yp(y)}" x2="${W}" y2="${Yp(y)}" class="st-yl"/>`);
    for (let y = -12; y <= 30; y++) for (const hx of [-3.08, 3.08]) righe.push(`<line x1="${X(hx) - 4}" y1="${Yp(y)}" x2="${X(hx) + 4}" y2="${Yp(y)}" class="st-hash"/>`);
    let zone = '', linee = '';
    if (S.zone) {
        const usate = new Set();
        for (const g of dif) {
            if (!g.zona || usate.has(g.zona)) continue;
            usate.add(g.zona);
            const [x0, x1, y0, y1, nome] = ZONE[g.zona];
            const deep = /^d|tampa/.test(g.zona);
            const yy1 = Math.min(y1, Y1);
            // Etichetta in cima alla zona: in basso finirebbe sotto i giocatori.
            zone += `<rect x="${X(x0)}" y="${Yp(yy1)}" width="${X(x1) - X(x0)}" height="${Yp(y0) - Yp(yy1)}" class="st-zone ${deep ? 'is-deep' : 'is-under'}"/><text x="${X((x0 + x1) / 2)}" y="${Yp(yy1) + 14}" class="st-zname">${esc(nome)}</text>`;
        }
        for (const g of dif) {
            if (g.zona) { const [x0, x1, y0, y1] = ZONE[g.zona]; linee += `<line x1="${X(g.x)}" y1="${Yp(g.y)}" x2="${X((x0 + x1) / 2)}" y2="${Yp(Math.min((y0 + Math.min(y1, Y1)) / 2, y0 + 5))}" class="st-drop"/>`; }
            if (g.marca) linee += `<line x1="${X(g.x)}" y1="${Yp(g.y)}" x2="${X(g.marca.x)}" y2="${Yp(g.marca.y)}" class="st-man"/>`;
            if (g.rush) linee += `<line x1="${X(g.x)}" y1="${Yp(g.y)}" x2="${X(g.x * 0.35)}" y2="${Yp(-3.2)}" class="st-rush${g.libero ? ' is-free' : ''}" marker-end="url(#st-arrow${g.libero ? '-free' : ''})"/>`;
        }
        for (const g of att) if (g.blocca) linee += `<line x1="${X(g.x)}" y1="${Yp(g.y)}" x2="${X((g.x + g.blocca.x) / 2)}" y2="${Yp((g.y + g.blocca.y) / 2)}" class="st-block"/>`;
    }
    const nomeTesto = (g, sotto) => {
        if (!S.nomi) return '';
        // I cinque di linea sono fitti: nomi sfalsati su due righe.
        const sfalsa = g.tipo === 'ol' && ['LG', 'RG'].includes(g.ruolo) ? 11 : 0;
        const y = Yp(g.y) + (sotto ? 26 + sfalsa : -18);
        let t = `<text x="${X(g.x)}" y="${y}" class="st-name">${esc(cognome(g.p.name))}</text>`;
        if (S.riserve && g.riserve?.length && g.tipo !== 'ol') t += g.riserve.map((r, i) => `<text x="${X(g.x)}" y="${y + (sotto ? 1 : -1) * (11 + i * 10)}" class="st-res">${i + 2}. ${esc(cognome(r.name))}</text>`).join('');
        return t;
    };
    const offHtml = att.map(g => `<g class="st-p st-p--off${S.sel === g.p.id ? ' is-sel' : ''}" data-st-pl="${esc(g.p.id)}" transform="translate(${X(g.x)},${Yp(g.y)})">
        <circle r="12" style="fill:${colA}"/><text class="st-num" y="4">${g.p.jersey ?? ''}</text>${g.p.injury ? '<circle r="3.5" cx="10" cy="-10" class="st-inj"/>' : ''}</g>${nomeTesto(g, true)}`).join('');
    const defHtml = dif.map(g => `<g class="st-p st-p--def${g.libero ? ' is-free' : ''}${S.sel === g.p.id ? ' is-sel' : ''}" data-st-pl="${esc(g.p.id)}" transform="translate(${X(g.x)},${Yp(g.y)})">
        <rect x="-12" y="-12" width="24" height="24" rx="5" style="fill:${colD}"/><text class="st-num" y="4">${esc(g.ruolo.replace(/^(L|R)(?=DE|DT|CB|ILB|OLB)/, ''))}</text>${g.tec != null ? `<text class="st-tec" x="${g.x >= 0 ? 15 : -15}" y="4" text-anchor="${g.x >= 0 ? 'start' : 'end'}">${esc(g.tec)}</text>` : ''}</g>${nomeTesto(g, false)}`).join('');
    return `<figure class="st-field"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Formation on the field">
        <defs><marker id="st-arrow" viewBox="0 0 8 8" refX="6" refY="4" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,0 L8,4 L0,8 z" class="st-arrowhead"/></marker>
        <marker id="st-arrow-free" viewBox="0 0 8 8" refX="6" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L8,4 L0,8 z" class="st-arrowhead is-free"/></marker></defs>
        <rect width="${W}" height="${H}" class="st-grass"/>${righe.join('')}
        <line x1="0" y1="${Yp(0)}" x2="${W}" y2="${Yp(0)}" class="st-los"/><line x1="0" y1="${Yp(10)}" x2="${W}" y2="${Yp(10)}" class="st-fd"/>
        ${zone}${linee}${defHtml}${offHtml}
    </svg>
    <figcaption>${esc(S.attacco)} (circles, number) attacking up · ${esc(S.difesa)} (squares, position; small figure = DL technique) · blue = line of scrimmage, yellow = 10 yards. Spacing near the ball is enlarged so the line can be read (as in a coach's diagram); yard lines are at their true depth. ${esito.liberi.length ? `<b class="st-warn">${esito.liberi.length} rusher${esito.liberi.length > 1 ? 's' : ''} unblocked — the QB has to throw hot or sight-adjust.</b>` : ''} ${esito.scoperti.length ? `<b class="st-warn">${esito.scoperti.length} receiver${esito.scoperti.length > 1 ? 's' : ''} uncovered in man — the defense is outnumbered.</b>` : ''}</figcaption></figure>`;
}

function probabileHtml() {
    const p = piuProbabile();
    if (!p) return `<section class="st-box"><h4>Most likely call</h4><p class="st-note">No participation data to say what ${esc(S.difesa)} plays against ${esc(S.pers)} personnel.</p></section>`;
    const covL = p.cov ? COPERTURE.find(c => c.key === p.cov).label : null;
    return `<section class="st-box st-box--hi"><h4>Most likely call · ${esc(S.difesa)} vs ${esc(S.pers)} personnel</h4>
        <p class="st-likely"><b>${esc(PACCHETTI.find(x => x.key === p.pkg).label)}</b> ${Math.round(p.pkgShare * 100)}%${covL ? ` · <b>${esc(covL)}</b> ${Math.round(p.covShare * 100)}% of dropbacks` : ''}</p>
        <p class="st-note">${p.n} snaps in ${S.tac.def.anno}. ${PERSONNEL[S.pers]}.${p.n < 30 ? ' <b class="st-warn">Small sample: read it as a hint, not a tendency.</b>' : ''}</p>
        <button type="button" class="tx-more" data-st-likely>Apply this call</button></section>`;
}

function statoHtml(e, cop) {
    return `<section class="st-box"><h4>${esc(cop.label)}</h4><p class="st-note">${esc(SPIEGA[cop.key])}</p>
        <p class="st-count">${e.rusher} rushing vs ${e.bloccanti} blocking · ${e.copertura} in coverage${e.liberi.length ? ` · <b class="st-warn">${e.liberi.length} free rusher${e.liberi.length > 1 ? 's' : ''}</b>` : ''}${e.scoperti.length ? ` · <b class="st-warn">${e.scoperti.length} uncovered</b>` : ''}</p></section>`;
}

const pollici = (ht) => { const m = /^(\d+)-(\d+)$/.exec(ht || ''); return m ? +m[1] * 12 + +m[2] : null; };
function selezioneHtml(att, dif) {
    const g = [...att, ...dif].find(x => x.p.id === S.sel);
    if (!g) return '<section class="st-box"><p class="st-note">Tap a player on the field for his card, his assignment and the backups behind him.</p></section>';
    const p = g.p;
    return `<section class="st-box st-card">
        <div class="st-card-head"><img src="https://a.espncdn.com/i/headshots/nfl/players/full/${esc(p.id)}.png" alt="" onerror="this.style.visibility='hidden'">
            <div><b>${p.jersey != null ? `#${p.jersey} ` : ''}${esc(p.name)}</b><small>${esc(RUOLO[g.ruolo] || g.ruolo)} · ${esc(p.pos || '')}${p.ht ? ` · ${esc(p.ht)}` : ''}${p.wt ? `, ${p.wt} lb` : ''}${p.age ? ` · age ${p.age}` : ''}${p.exp != null ? ` · ${p.exp === 0 ? 'rookie' : `${p.exp} yrs`}` : ''}</small></div></div>
        <p class="st-assign">${esc(g.compito || '')}${g.tec != null ? ` · ${esc(g.tec)}-technique` : ''}</p>
        ${p.injury ? `<p class="st-note st-warn">Injury: ${esc(p.injury)}</p>` : ''}
        ${g.riserve?.length ? `<p class="st-note">Behind him: ${g.riserve.map((r, i) => `${i + 2}. ${esc(r.name)}${r.jersey != null ? ` #${r.jersey}` : ''}`).join(' · ')}</p>` : ''}
    </section>`;
}

function matchupHtml(att, dif, cop) {
    const riga = (a, b, nota) => {
        const ha = pollici(a?.p.ht), hb = pollici(b?.p.ht);
        const dh = ha != null && hb != null ? ha - hb : null, dw = a?.p.wt && b?.p.wt ? a.p.wt - b.p.wt : null;
        const delta = [dh != null ? `${dh > 0 ? '+' : ''}${dh}"` : '', dw != null ? `${dw > 0 ? '+' : ''}${dw} lb` : ''].filter(Boolean).join(' · ');
        return `<tr><td>${a ? `<b>${esc(RUOLO[a.ruolo] || a.ruolo)}</b> ${a.p.jersey ?? ''} ${esc(cognome(a.p.name))}` : '—'}</td><td>${b ? `<b>${esc(b.ruolo)}</b> ${b.p.jersey ?? ''} ${esc(cognome(b.p.name))}` : `<span class="st-warn">${esc(nota || 'Uncovered')}</span>`}</td><td class="st-delta">${delta}</td></tr>`;
    };
    const ric = att.filter(g => TIPO_RIC[g.ruolo]);
    let corpo = '';
    if (cop.man) {
        corpo = ric.map(r => riga(r, dif.find(d => d.marca === r), r.compito === 'Route' ? 'Uncovered' : 'Blocking')).join('');
    } else {
        // A zona "chi prende chi" dipende dalla route: si mostra di chi è la
        // zona in cui il ricevitore parte, che è la prima lettura del QB.
        corpo = ric.map(r => {
            const z = dif.find(d => d.zona && (() => { const [x0, x1] = ZONE[d.zona]; return r.x >= x0 && r.x <= x1 && !/^d/.test(d.zona); })());
            return riga(r, z, 'Between zones');
        }).join('');
    }
    const prot = att.filter(g => g.blocca).map(g => `<tr><td><b>${esc(g.ruolo)}</b> ${esc(cognome(g.p.name))}</td><td><b>${esc(g.blocca.ruolo)}</b> ${esc(cognome(g.blocca.p.name))}</td><td class="st-delta">${g.p.wt && g.blocca.p.wt ? `${g.p.wt - g.blocca.p.wt > 0 ? '+' : ''}${g.p.wt - g.blocca.p.wt} lb` : ''}</td></tr>`).join('')
        + dif.filter(d => d.libero).map(d => `<tr><td><span class="st-warn">Nobody</span></td><td><b>${esc(d.ruolo)}</b> ${esc(cognome(d.p.name))}</td><td class="st-warn">hot</td></tr>`).join('');
    return `<section class="st-box"><h4>Who's on whom${cop.man ? ' (man)' : ' (zone: who owns the receiver\'s starting area)'}</h4>
        <table class="st-table"><thead><tr><th>${esc(S.attacco)}</th><th>${esc(S.difesa)}</th><th>Size</th></tr></thead><tbody>${corpo}</tbody></table>
        <h4>Protection</h4><table class="st-table"><thead><tr><th>Blocker</th><th>Rusher</th><th>Weight</th></tr></thead><tbody>${prot}</tbody></table></section>`;
}

function frequenzeHtml() {
    const blocco = (titolo, side, tac, keys) => {
        if (!tac) return '';
        const dims = tac.d.side[side].dims;
        const righe = keys.map(k => {
            const v = dims[k]; if (!v) return '';
            const tot = Object.values(v).reduce((s, a) => s + a[0], 0);
            const top = Object.entries(v).sort((a, b) => b[1][0] - a[1][0]).slice(0, 4);
            const lab = DIMS.find(d => d.key === k)?.label || k;
            return `<div class="st-freq"><span>${esc(lab)}</span>${top.map(([l, a]) => `<i>${esc(l.replace(/^COVER_/, 'Cover ').replace('2_MAN', '2-Man'))} <b>${Math.round(100 * a[0] / tot)}%</b></i>`).join('')}</div>`;
        }).join('');
        return `<h4>${esc(titolo)} · ${tac.anno}</h4>${righe}`;
    };
    return `<section class="st-box">
        ${blocco(`${S.attacco} offense`, 'off', S.tac.off, ['personnel', 'formation', 'motion', 'playAction', 'playType'])}
        ${blocco(`${S.difesa} defense`, 'def', S.tac.def, ['defPackage', 'coverage', 'manZone', 'blitzers', 'box'])}
        <p class="st-note"><a href="#nfl-tactics/${esc(S.difesa)}/${S.tac.def?.anno ?? S.anno}">Full ${esc(S.difesa)} tactics ›</a></p>
    </section>`;
}

// ─── eventi ──────────────────────────────────────────────────────────────

function leghe(corpo) {
    if (corpo.dataset.stBound) return;
    corpo.dataset.stBound = '1';
    corpo.addEventListener('click', (e) => {
        if (!S || !S.dep.off) return;
        const t = e.target.closest('[data-st-pers],[data-st-form],[data-st-flip],[data-st-front],[data-st-pkg],[data-st-cov],[data-st-blitz],[data-st-prot],[data-st-show],[data-st-pl],[data-st-likely],[data-st-swap]');
        if (!t) return;
        const d = t.dataset;
        if (d.stPers) { S.pers = d.stPers; S.form = FORMAZIONI.find(f => f.pers === S.pers).key; }
        else if (d.stForm) S.form = d.stForm;
        else if (d.stFlip) S.flip = !S.flip;
        else if (d.stFront) S.fronte = d.stFront;
        else if (d.stPkg) S.pacchetto = d.stPkg;
        else if (d.stCov) S.cop = d.stCov;
        else if (d.stBlitz != null) S.blitz = +d.stBlitz;
        else if (d.stProt) S.prot[d.stProt] = !S.prot[d.stProt];
        else if (d.stShow) S[d.stShow] = !S[d.stShow];
        else if (d.stPl) S.sel = S.sel === d.stPl ? null : d.stPl;
        else if (d.stLikely != null) { const p = piuProbabile(); if (p) { S.pacchetto = p.pkg; if (p.cov) S.cop = p.cov; } }
        else if (d.stSwap != null) { [S.attacco, S.difesa] = [S.difesa, S.attacco]; S.pacchetto = null; aggiornaIndirizzo(); caricaSquadre(corpo); return; }
        disegna(corpo);
    });
    corpo.addEventListener('change', (e) => {
        if (!S) return;
        if (e.target.id === 'st-off') { S.attacco = e.target.value; S.pacchetto = null; aggiornaIndirizzo(); caricaSquadre(corpo); }
        if (e.target.id === 'st-def') { S.difesa = e.target.value; S.pacchetto = null; aggiornaIndirizzo(); caricaSquadre(corpo); }
    });
}
function aggiornaIndirizzo() {
    history.replaceState(null, '', `#nfl-tactics/${S.attacco}/${S.anno}/study/${S.difesa}`);
}
