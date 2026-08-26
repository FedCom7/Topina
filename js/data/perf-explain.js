/**
 * "Perché ha reso così" v3 — decomposizione TRASPARENTE dell'errore di
 * projection a livello di STATISTICA, non di metrica astratta.
 *
 * Idea: l'errore in punti-lega è, per definizione dello scoring, la somma dei
 * contributi delle singole statistiche. Confrontando le stat PROIETTATE (Sleeper
 * preseason) con quelle REALI — entrambe già caricate sulla pagina giocatore —
 * si ottiene:
 *
 *   errore = disponibilità + Σ_stat [ gareReali × (reale/gara − proj/gara) × peso ]
 *
 * dove `disponibilità` = punti attesi persi/guadagnati per le gare giocate vs
 * proiettate, e ogni voce di stat è ESATTA (Δ per-gara × peso scoring × gare).
 * Le voci sommano all'errore per identità contabile (residuo ≈ 0). Così "ha reso
 * −46" diventa "−3 TD ricezione (−18), −15 ricezioni PPR (−15), ...".
 *
 * Le CAUSE (perché il target share è calato, chi è arrivato/partito, che difese
 * ha affrontato, infortuni propri/compagni) sono un layer separato (perf-causes).
 *
 * Fonti (nessun fetch nuovo): projByYear[y].raw (proiezione) + seasons[y].totals.stats
 * (reale) — stessi nomi-campo Sleeper. Scoring da league-rules via scoring.js.
 */

import { LEAGUE_SCORING } from './scoring.js?v=592';
import { normName } from './projections.js?v=594';

// ── CAUSE reali (fase 2): file per-anno precalcolato da build-perf-causes.mjs ──
const _causes = {}; // year → Map(normName|POS → causes) | null
async function fetchJson(url) { try { const r = await fetch(url); return r.ok ? await r.json() : null; } catch { return null; } }

/** Carica (una volta) le cause dell'anno; Map per giocatore. null se assente. */
export async function getPerfCauses(year) {
    if (year in _causes) return _causes[year];
    const d = await fetchJson(`data/model/perf_causes_${year}.json`);
    if (!d?.players) return (_causes[year] = null);
    const m = new Map();
    for (const p of d.players) m.set(`${normName(p.name)}|${(p.pos || '').toUpperCase()}`, p.causes);
    return (_causes[year] = m);
}

/**
 * Traduce le cause di una stagione in annotazioni leggibili (icona + testo).
 * Filtra per rilevanza: mostra solo ciò che ha davvero pesato.
 */
export function describeCauses(causes, dec) {
    if (!causes) return [];
    const { teammateInjuries, departures, arrivals, team, share } = causes;
    const out = [];
    // ── Opportunità nel reparto — DIMOSTRATA COI NUMERI. Le mosse di mercato
    // (partenze/arrivi/infortuni compagni) sono cause POTENZIALI: si mostrano solo
    // se il target/rush share REALE prova che hanno inciso, e attribuite solo se
    // coerenti col segno (partenze/infortuni → più quota; arrivi → meno quota). ──
    if (share && share.pctPrev != null) {
        const d = share.pct - share.pctPrev;
        const lbl = share.key === 'rushShare' ? 'quota di corse' : 'target share';
        if (d >= 3) {
            const who = [];
            if (departures?.length) who.push(`via ${departures.map(x => x.name).join(', ')}`);
            if (teammateInjuries?.length) who.push(teammateInjuries.map(t => `${t.name} out ${t.missed} gare`).join(', '));
            out.push({ icon: '🎯', text: `Più palloni: ${lbl} ${share.pctPrev}%→${share.pct}% (+${d}pt)${who.length ? ` — ${who.join('; ')}` : ''}` });
        } else if (d <= -3) {
            const who = arrivals?.length ? ` — arrivo di ${arrivals.map(x => x.name).join(', ')}` : '';
            out.push({ icon: '🎯', text: `Meno palloni: ${lbl} ${share.pctPrev}%→${share.pct}% (${d}pt)${who}` });
        }
        // |d| < 3 → nessuna riga: la mossa non ha inciso sulla quota (non dimostrato)
    } else if (teammateInjuries?.length && share && share.pct >= 18) {
        // niente anno-prima (es. rookie): prova = compagni out + quota realizzata
        const lbl = share.key === 'rushShare' ? 'quota di corse' : 'target share';
        out.push({ icon: '🎯', text: `${teammateInjuries.map(t => `${t.name} out ${t.missed} gare`).join(', ')} → ${lbl} ${share.pct}% assorbito` });
    }
    // ── Punti squadra — PROVATO legando i TD della squadra ai TD REALI del
    // giocatore (WR/TE→TD aerei, RB→TD di corsa). Si mostra solo se l'attacco ha
    // cambiato marcia sui TD E i TD del giocatore sono andati nella STESSA direzione
    // (se lui ha preso più quota di TD nonostante l'attacco, non è colpa/merito del
    // contesto). QB escluso: i punti squadra SONO in gran parte la sua produzione. ──
    if (team && dec && /WR|TE|RB/.test(dec.pos)) {
        const isRec = dec.pos !== 'RB';
        const teamTd = isRec ? team.passTd : team.rushTd;
        const teamTdPrev = isRec ? team.passTdPrev : team.rushTdPrev;
        const tdRow = dec.rows.find(r => r.key === (isRec ? 'rec_td' : 'rush_td'));
        if (teamTd != null && teamTdPrev != null && tdRow && Math.abs(tdRow.pts) >= 6) {
            const dTeam = teamTd - teamTdPrev;
            if (Math.abs(dTeam) >= 4 && Math.sign(dTeam) === Math.sign(tdRow.delta)) {
                const less = dTeam < 0;
                out.push({ icon: less ? '📉' : '📈', text: `Attacco che segna ${less ? 'meno' : 'più'}: TD ${isRec ? 'aerei' : 'di corsa'} squadra ${teamTdPrev}→${teamTd}, in linea coi tuoi TD ${isRec ? 'ricezione' : 'corsa'} ${fmtStat(tdRow.proj)}→${fmtStat(tdRow.actual)}` });
            }
        }
    }
    if (causes.oline) {
        const o = causes.oline;
        out.push(o.kind === 'pass'
            ? { icon: '🧱', text: `Protezione ${o.worse ? 'peggiorata' : 'migliorata'}: pressione subita ${o.pressurePrev}%→${o.pressure}%` }
            : { icon: '🧱', text: `Blocchi di corsa ${o.worse ? 'peggiorati' : 'migliorati'}: ${o.ybc} yard prima del contatto a corsa (erano ${o.ybcPrev})` });
    }
    return out;
}

/** Statistiche che pesano nello scoring, con label e gruppo. Chiavi = campi Sleeper. */
const STAT_DEFS = [
    { key: 'rec', label: 'Ricezioni', unit: '', w: LEAGUE_SCORING.rec, group: 'rec' },
    { key: 'rec_yd', label: 'Yard su ricezione', unit: 'yd', w: LEAGUE_SCORING.rec_yd, group: 'rec' },
    { key: 'rec_td', label: 'TD su ricezione', unit: 'TD', w: LEAGUE_SCORING.rec_td, group: 'rec' },
    { key: 'rush_yd', label: 'Yard su corsa', unit: 'yd', w: LEAGUE_SCORING.rush_yd, group: 'rush' },
    { key: 'rush_td', label: 'TD su corsa', unit: 'TD', w: LEAGUE_SCORING.rush_td, group: 'rush' },
    { key: 'pass_yd', label: 'Yard su passaggio', unit: 'yd', w: LEAGUE_SCORING.pass_yd, group: 'pass' },
    { key: 'pass_td', label: 'TD su passaggio', unit: 'TD', w: LEAGUE_SCORING.pass_td, group: 'pass' },
    { key: 'pass_int', label: 'Intercetti subiti', unit: '', w: LEAGUE_SCORING.pass_int, group: 'pass' },
    { key: 'fum_lost', label: 'Fumble persi', unit: '', w: LEAGUE_SCORING.fum_lost, group: 'misc' },
];

/** Ordine di rilevanza delle voci per ruolo (le altre restano ma dopo). */
const POS_ORDER = {
    WR: ['rec_td', 'rec', 'rec_yd', 'rush_td', 'rush_yd', 'fum_lost'],
    TE: ['rec_td', 'rec', 'rec_yd', 'fum_lost'],
    RB: ['rush_td', 'rush_yd', 'rec', 'rec_td', 'rec_yd', 'fum_lost'],
    QB: ['pass_td', 'pass_yd', 'rush_td', 'pass_int', 'rush_yd', 'fum_lost'],
};

const num = (v) => (v == null || Number.isNaN(+v) ? 0 : +v);
const round1 = (v) => Math.round(v * 10) / 10;

/**
 * Punti-lega di un set di stat grezze (stessa logica di scoring.js ma sui campi
 * che ci interessano, così proiettato e reale usano ESATTAMENTE la stessa base).
 */
function statPoints(raw) {
    let p = 0;
    for (const d of STAT_DEFS) p += num(raw[d.key]) * d.w;
    // due-punti e altri bonus minori: raccolti a parte per il residuo
    return p;
}

/**
 * Decomposizione di una stagione. Ritorna null se manca proiezione o stagione reale.
 * @param pos  ruolo (QB/RB/WR/TE)
 * @param proj raw stat proiettate (con gp)
 * @param actual raw stat reali (con gp)
 * @param projPtsLeague/actualPtsLeague opzionali: punti-lega ufficiali (per chiudere il residuo)
 */
export function decomposeSeason({ pos, proj, actual }) {
    if (!proj || !actual) return null;
    const gpP = Math.min(num(proj.gp) || 17, 17) || 17;
    const gpA = num(actual.gp);
    if (!gpA) return null;

    const projPts = statPoints(proj);
    const actPts = statPoints(actual);
    const error = actPts - projPts;

    // Scorecard: contributo di ogni stat all'errore = (reale − proiettato) × peso.
    // Voci in TOTALI stagionali (intuitivo: "5 TD in meno = −30 pt"); sommano
    // ESATTAMENTE all'errore. La disponibilità NON è una riga (per non contare due
    // volte le gare): è un DIAGNOSTICO a parte + spiegazione nel verdetto.
    const order = POS_ORDER[pos] || STAT_DEFS.map(d => d.key);
    const rows = [];
    for (const d of STAT_DEFS) {
        const pv = num(proj[d.key]), av = num(actual[d.key]);
        if (pv === 0 && av === 0) continue;
        rows.push({
            key: d.key, label: d.label, unit: d.unit, group: d.group,
            proj: pv, actual: av, projPerG: pv / gpP, actPerG: av / gpA,
            delta: av - pv, pts: round1((av - pv) * d.w),
        });
    }
    rows.sort((a, b) => {
        const ia = order.indexOf(a.key), ib = order.indexOf(b.key);
        if (ia !== ib) return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
        return Math.abs(b.pts) - Math.abs(a.pts);
    });
    const residual = round1(error - rows.reduce((s, r) => s + r.pts, 0)); // 2pt/bonus/arrotondamenti

    // diagnostici disponibilità: quanto dell'errore è "solo" gare saltate (a pace
    // proiettato) vs cambio di rendimento per-gara.
    const availability = round1((projPts / gpP) * (gpA - gpP));
    const perGameError = round1(error - availability);

    return {
        pos, gpP, gpA,
        projPts: round1(projPts), actPts: round1(actPts), error: round1(error),
        availability, perGameError, rows, residual,
        readouts: readouts(pos, proj, actual, gpP, gpA),
    };
}

/**
 * Voci di CONTESTO non-scoring (info, non contributi in punti): quota di gioco,
 * red zone, snap. Proiettato dove disponibile, altrimenti solo reale.
 */
function readouts(pos, proj, actual, gpP, gpA) {
    const out = [];
    const perG = (raw, k, gp) => raw[k] != null ? round1(num(raw[k]) / gp) : null;
    if (pos === 'WR' || pos === 'TE' || pos === 'RB') {
        // target/gara: proiettato NON dà i target diretti (solo ricezioni) → stimo
        // i target proiettati dalle ricezioni con un catch-rate di lega 0.64.
        const projTgtPg = proj.rec != null ? round1((num(proj.rec) / 0.64) / gpP) : null;
        const actTgtPg = actual.rec_tgt != null ? perG(actual, 'rec_tgt', gpA) : null;
        if (actTgtPg != null) out.push({ key: 'tgt', label: 'Target / gara', proj: projTgtPg, actual: actTgtPg });
        if (actual.rec_rz_tgt != null) out.push({ key: 'rzTgt', label: 'Target in red zone', proj: null, actual: num(actual.rec_rz_tgt) });
    }
    if (pos === 'RB') {
        const projCarPg = proj.rush_att != null ? round1(num(proj.rush_att) / gpP) : null;
        const actCarPg = actual.rush_att != null ? perG(actual, 'rush_att', gpA) : null;
        if (actCarPg != null) out.push({ key: 'carries', label: 'Corse / gara', proj: projCarPg, actual: actCarPg });
        if (actual.rush_rz_att != null) out.push({ key: 'rzAtt', label: 'Corse in red zone', proj: null, actual: num(actual.rush_rz_att) });
    }
    if (pos === 'QB') {
        const projAttPg = proj.pass_att != null ? round1(num(proj.pass_att) / gpP) : null;
        const actAttPg = actual.pass_att != null ? perG(actual, 'pass_att', gpA) : null;
        if (actAttPg != null) out.push({ key: 'patt', label: 'Tentativi pass / gara', proj: projAttPg, actual: actAttPg });
    }
    // snap share (solo reale): off_snp / tm_off_snp
    if (actual.off_snp != null && actual.tm_off_snp) {
        out.push({ key: 'snap', label: 'Snap share', proj: null, actual: Math.round(100 * num(actual.off_snp) / num(actual.tm_off_snp)) + '%' });
    }
    return out;
}

/** Etichetta breve del gruppo per il verdetto. */
const GROUP_LABEL = { rec: 'ricezione', rush: 'corsa', pass: 'passaggio', misc: '' };

/**
 * Verdetto narrativo di una stagione dalla decomposizione: gare + le 1-2 voci di
 * stat più pesanti, con la differenza concreta (proiettato→reale).
 */
export function seasonVerdict(dec, injuryLabel) {
    if (!dec) return null;
    const p1 = (x) => `${x >= 0 ? '+' : '−'}${Math.abs(Math.round(x))}`;
    const bits = [];
    const missed = dec.gpP - dec.gpA;
    // se ha saltato gare in modo rilevante, apri con le assenze e distingui il
    // rendimento per-gara (era comunque bravo/scarso quando giocava?).
    if (missed >= 2 && dec.availability <= -8) {
        const lbl = injuryLabel ? ` (${injuryLabel.toLowerCase()})` : '';
        const perG = dec.perGameError >= 6 ? ' — ma quando ha giocato ha reso sopra le attese'
            : dec.perGameError <= -6 ? ' — e anche per gara è rimasto sotto le attese' : '';
        bits.push(`Ha saltato ${missed} ${missed === 1 ? 'gara' : 'gare'}${lbl}: gran parte del calo è per le assenze${perG}`);
    }
    // le voci di stat più pesanti in valore assoluto
    const rel = dec.rows.filter(r => Math.abs(r.pts) >= 4)
        .sort((a, b) => Math.abs(b.pts) - Math.abs(a.pts)).slice(0, 2);
    for (const r of rel) {
        const dir = r.delta >= 0 ? 'sopra' : 'sotto';
        bits.push(`${r.label.toLowerCase()} ${dir} le attese (${fmtStat(r.proj)}→${fmtStat(r.actual)}${r.unit ? ' ' + r.unit : ''}, ${p1(r.pts)} pt)`);
    }
    if (!bits.length) return { headline: 'Stagione in linea con le proiezioni.' };
    const h = bits.join(' · ') + '.';
    return { headline: h.charAt(0).toUpperCase() + h.slice(1) };
}

const fmtStat = (v) => (Math.abs(v) >= 100 ? Math.round(v) : Math.round(v * 10) / 10);
