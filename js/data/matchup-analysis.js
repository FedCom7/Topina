/**
 * Matchup Analysis — calcoli e testi per la pagina analisi partita.
 * Tutto derivato dai dati Firebase del matchup (starters con stats/opponent)
 * più il contesto stagionale (medie da honors bundle, precedenti dal league data).
 * I testi (recap, difference maker, player notes) sono generati in italiano
 * da template guidati dai numeri: zero contenuto inventato.
 */

import {
    pickSeeded, MARGIN_THRILLER, MARGIN_BLOWOUT, MARGIN_NORMAL, TOP_PLAYER_PHRASES,
    AN_STAKES_PLAYOFF, AN_STAKES_SB, AN_SERIES_LINES, AN_FLOP_WRAP, AN_HOT_STREAK_LINES,
    AN_COMMENT_WRAP, AN_NOTE_BAD,
} from './magazine-voices.js?v=9';

const fmt = (n) => (+n).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmt1 = (n) => (+n).toLocaleString('it-IT', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const pick = pickSeeded;

/** Seed deterministico per-partita: stessa partita → stesse frasi ad ogni visita */
function matchupSeed(ctx, nW, nL) {
    let h = (+ctx.year) * 37 + (ctx.weekNum || 0);
    const s = nW + nL;
    for (let i = 0; i < s.length; i++) h += s.charCodeAt(i);
    return h;
}

export const SLOT_ORDER = ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'W/R', 'K', 'DEF'];

const pts = (p) => parseFloat(p?.fantasy_points) || 0;
const natPos = (p) => (p?.position_in_team || p?.position || '').toUpperCase();

/** Starters allineati a SLOT_ORDER (n-esimo giocatore di ogni slot) */
export function startersBySlot(team) {
    const starters = team.starters || [];
    const used = new Set();
    return SLOT_ORDER.map(slot => {
        const found = starters.find((p, i) =>
            !used.has(i) && (p.position || '').toUpperCase() === slot);
        if (!found) return null;
        used.add(starters.indexOf(found));
        return found;
    });
}

/** Coppie per slot: [{slot, a, b}] */
export function slotPairs(m) {
    const A = startersBySlot(m.team1);
    const B = startersBySlot(m.team2);
    return SLOT_ORDER.map((slot, i) => ({ slot, a: A[i], b: B[i] }));
}

/** Rank di ogni titolare tra i pari-ruolo della settimana (tutti i matchup) */
export function weekPosRanks(weekData) {
    const byPos = {};
    (weekData?.matchups || []).forEach(m => [m.team1, m.team2].forEach(t =>
        (t?.starters || []).forEach(p => {
            const pos = natPos(p);
            (byPos[pos] = byPos[pos] || []).push({ name: p.name, pts: pts(p) });
        })));
    const ranks = new Map();
    Object.entries(byPos).forEach(([pos, list]) => {
        list.sort((a, b) => b.pts - a.pts);
        list.forEach((e, i) => ranks.set(e.name, { rank: i + 1, ofN: list.length, pos }));
    });
    return ranks;
}

/** Media punti a partita (da titolare) nella stagione, dal bundle honors */
export function seasonAvg(bundle, name) {
    const p = bundle?.players?.[name];
    if (!p || !p.gamesStarted) return null;
    return p.started / p.gamesStarted;
}

/** Riga statistiche leggibile: "256 yd lancio e 5 TD · 27 yd corsa" */
export function statLine(p) {
    const s = p?.stats;
    if (!s) return '';
    const parts = [];
    if (s.pass_yds) {
        let t = `${s.pass_yds} yd lancio`;
        if (s.pass_td) t += ` e ${s.pass_td} TD`;
        if (s.pass_int) t += `, ${s.pass_int} INT`;
        parts.push(t);
    }
    if (s.rush_yds || s.rush_td) {
        let t = `${s.rush_yds || 0} yd corsa`;
        if (s.rush_td) t += ` e ${s.rush_td} TD`;
        parts.push(t);
    }
    if (s.rec || s.rec_yds) {
        let t = `${s.rec || 0} ricezioni per ${s.rec_yds || 0} yd`;
        if (s.rec_td) t += ` e ${s.rec_td} TD`;
        parts.push(t);
    }
    if (s.fum_lost) parts.push(`${s.fum_lost} fumble perso${s.fum_lost > 1 ? 'i' : ''}`);
    return parts.slice(0, 3).join(' · ');
}

/** Il giocatore che ha contribuito di più per ciascuna squadra */
export function diffMakers(m) {
    const top = (team) => [...(team.starters || [])].sort((x, y) => pts(y) - pts(x))[0] || null;
    return { a: top(m.team1), b: top(m.team2) };
}

/** Totali di squadra per il confronto a barre */
export function teamStatTotals(team) {
    const tot = { passYds: 0, rushYds: 0, recYds: 0, td: 0, to: 0 };
    (team.starters || []).forEach(p => {
        const s = p.stats;
        if (!s) return;
        tot.passYds += s.pass_yds || 0;
        tot.rushYds += s.rush_yds || 0;
        tot.recYds += s.rec_yds || 0;
        tot.td += (s.pass_td || 0) + (s.rush_td || 0) + (s.rec_td || 0) + (s.ret_td || 0) + (s.fum_td || 0);
        tot.to += (s.pass_int || 0) + (s.fum_lost || 0);
    });
    return tot;
}

const ordinal = (n) => `${n}º`;

/** Seed deterministico per giocatore+prestazione: stesse frasi ad ogni visita */
function playerSeed(p) {
    let h = Math.round(pts(p) * 100);
    const s = p?.name || '';
    for (let i = 0; i < s.length; i++) h += s.charCodeAt(i) * (i + 1);
    return h;
}

/** Commento breve per un giocatore (difference maker / note) */
export function playerComment(p, bundle, ranks) {
    const v = pts(p);
    const pos = natPos(p);
    const avg = seasonAvg(bundle, p.name);
    const rk = ranks?.get(p.name);
    const stat = statLine(p);
    const bits = [];

    if (rk) {
        bits.push(rk.rank === 1
            ? `miglior ${pos} della settimana`
            : `${ordinal(rk.rank)} tra i ${pos} della week`);
    }
    if (avg && avg >= 3) {
        const delta = (v - avg) / avg;
        if (delta >= 0.25) bits.push(`ben sopra la sua media stagionale (${fmt1(avg)})`);
        else if (delta <= -0.25) bits.push(`lontano dalla sua media stagionale (${fmt1(avg)})`);
    }
    const best = bundle?.players?.[p.name]?.best;
    if (best && v >= best.pts && v > 12) bits.push('suo massimo stagionale');

    const facts = `${fmt(v)} punti${stat ? ` (${stat})` : ''}`;
    return pick(AN_COMMENT_WRAP, playerSeed(p))({ facts, bits: bits.join(', ') });
}

/** Player notes: i giocatori che hanno segnato la partita (esclusi i diff maker) */
export function playerNotes(m, bundle, ranks) {
    const dm = diffMakers(m);
    const exclude = new Set([dm.a?.name, dm.b?.name]);
    const candidates = [];

    [[m.team1, m.team1.name], [m.team2, m.team2.name]].forEach(([team, rawName]) => {
        (team.starters || []).forEach(p => {
            if (exclude.has(p.name)) return;
            const v = pts(p);
            const avg = seasonAvg(bundle, p.name);
            const delta = avg && avg >= 4 ? (v - avg) / avg : 0;
            // rilevanza: punti alti O scostamento forte dalla media
            const score = v + Math.abs(delta) * 12;
            candidates.push({ p, rawName, v, avg, delta, score });
        });
    });

    candidates.sort((x, y) => y.score - x.score);
    return candidates.slice(0, 6).map(({ p, rawName, v, avg, delta }) => {
        let text;
        if (delta <= -0.35 && avg) {
            const s = statLine(p);
            const statTail = s ? ` ${s.charAt(0).toUpperCase() + s.slice(1)}.` : '';
            text = pick(AN_NOTE_BAD, playerSeed(p))({ pts: fmt(v), avg: fmt1(avg), statTail });
        } else {
            text = playerComment(p, bundle, ranks);
        }
        return { player: p, teamRaw: rawName, text };
    });
}

/**
 * Articolo di recap della partita (unico, per entrambe le squadre).
 * ctx: { year, weekNum, weekLabel, isPlayoff, isSB, seriesGames, teamName }
 *   seriesGames: partite stagionali precedenti tra le due squadre viste dal
 *   punto di vista del VINCITORE → [{won}] ; teamName(raw) → nome display.
 */
export function recapArticle(m, bundle, ranks, ctx) {
    const s1 = pts({ fantasy_points: m.team1.score });
    const s2 = pts({ fantasy_points: m.team2.score });
    const [W, L] = s1 >= s2 ? [m.team1, m.team2] : [m.team2, m.team1];
    const sW = Math.max(s1, s2), sL = Math.min(s1, s2);
    const margin = sW - sL;
    const nW = ctx.teamName(W.name), nL = ctx.teamName(L.name);
    const top = [...(W.starters || [])].sort((x, y) => pts(y) - pts(x))[0];
    const topPts = pts(top);
    const seed = matchupSeed(ctx, nW, nL);

    // Titolo
    let headline;
    if (margin < 5) headline = `${nW} la spunta in volata su ${nL}`;
    else if (margin >= 20) headline = `${top?.name} show: ${nW} travolge ${nL}`;
    else headline = `Trascinati da ${top?.name}, ${nW} superano ${nL}`;

    const paras = [];

    // P1 — la partita
    const marginBank = margin < 5 ? MARGIN_THRILLER : margin >= 20 ? MARGIN_BLOWOUT : MARGIN_NORMAL;
    let p1 = `Con ${fmt(topPts)} punti di ${top?.name} a fare da traino, ${nW} batte ${nL} ${fmt(sW)} a ${fmt(sL)}.`;
    p1 += ' ' + pick(marginBank, seed).replaceAll('{margin}', fmt(margin)).replaceAll('{loser}', nL);
    const topStat = statLine(top);
    const best = bundle?.players?.[top?.name]?.best;
    const isPersonalBest = !!(best && topPts >= best.pts && topPts > 12);
    p1 += ' ' + pick(TOP_PLAYER_PHRASES, seed + 1)
        .replaceAll('{top}', top?.name || nW)
        .replaceAll('{pts}', fmt(topPts))
        .replaceAll('{stat}', topStat || 'una prova totale, di quelle che non hanno bisogno di note a margine');
    if (isPersonalBest) p1 += ` È il suo massimo stagionale.`;
    paras.push(p1);

    // P2 — posta in palio / precedenti stagionali
    if (ctx.isSB) {
        paras.push(pick(AN_STAKES_SB, seed + 2)({ nW, year: ctx.year }));
    } else if (ctx.isPlayoff) {
        paras.push(pick(AN_STAKES_PLAYOFF, seed + 2)({ nW, nL }));
    } else if (ctx.seriesGames?.length) {
        const w = ctx.seriesGames.filter(g => g.won).length;
        const l = ctx.seriesGames.length - w;
        paras.push(pick(AN_SERIES_LINES, seed + 2)({ nW, w: w + 1, l }));
    }

    // P3 — il flop della sconfitta
    const flop = (L.starters || [])
        .map(p => ({ p, v: pts(p), avg: seasonAvg(bundle, p.name) }))
        .filter(x => x.avg && x.avg >= 7)
        .map(x => ({ ...x, delta: (x.v - x.avg) / x.avg }))
        .sort((a, b) => a.delta - b.delta)[0];
    if (flop && flop.delta <= -0.35) {
        const s = flop.p.stats;
        const touches = s ? (s.rush_yds || 0) + (s.rec_yds || 0) : 0;
        const extra = touches ? `, con appena ${touches} yard totali prodotte.` : '.';
        paras.push(pick(AN_FLOP_WRAP, seed + 3)({ loser: nL, name: flop.p.name, pts: fmt(flop.v), avg: fmt1(flop.avg), extra }));
    }

    // P4 — chi è in fiducia e chi no
    const hot = (W.starters || [])
        .map(p => ({ p, v: pts(p), avg: seasonAvg(bundle, p.name) }))
        .filter(x => x.avg && x.avg >= 5 && (x.v - x.avg) / x.avg >= 0.3 && x.p.name !== top?.name)
        .sort((a, b) => (b.v - b.avg) / b.avg - (a.v - a.avg) / a.avg)
        .slice(0, 2);
    if (hot.length) {
        const names = hot.map(x => `${x.p.name} (+${Math.round((x.v - x.avg) / x.avg * 100)}% sulla media)`).join(' e ');
        paras.push(pick(AN_HOT_STREAK_LINES, seed + 4)({ names, verb: hot.length > 1 ? 'hanno' : 'ha', nW }));
    }

    return {
        headline,
        dateline: `Stagione ${ctx.year} · ${ctx.weekLabel} · Recap`,
        paras,
    };
}
