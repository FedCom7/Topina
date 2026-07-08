/**
 * Matchup Analysis — calcoli e testi per la pagina analisi partita.
 * Tutto derivato dai dati Firebase del matchup (starters con stats/opponent)
 * più il contesto stagionale (medie da honors bundle, precedenti dal league data).
 * I testi (recap, difference maker, player notes) sono generati in italiano
 * da template guidati dai numeri: zero contenuto inventato.
 */

const fmt = (n) => (+n).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmt1 = (n) => (+n).toLocaleString('it-IT', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

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

    let text = `${fmt(v)} punti`;
    if (stat) text += ` (${stat})`;
    if (bits.length) text += ` — ${bits.join(', ')}`;
    return text + '.';
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
            text = `Giornata da dimenticare: solo ${fmt(v)} punti contro una media stagionale di ${fmt1(avg)}.`;
            const s = statLine(p);
            if (s) text += ` ${s.charAt(0).toUpperCase() + s.slice(1)}.`;
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

    // Titolo
    let headline;
    if (margin < 5) headline = `${nW} la spunta in volata su ${nL}`;
    else if (margin >= 20) headline = `${top?.name} show: ${nW} travolge ${nL}`;
    else headline = `Trascinati da ${top?.name}, ${nW} superano ${nL}`;

    const paras = [];

    // P1 — la partita
    let p1 = `Con ${fmt(topPts)} punti di ${top?.name} a fare da traino, ${nW} batte ${nL} ${fmt(sW)} a ${fmt(sL)}.`;
    if (margin < 5) p1 += ` Un successo di misura, deciso da ${fmt(margin)} punti: partita in bilico fino all'ultimo snap.`;
    else if (margin >= 20) p1 += ` Vittoria senza appello, con ${fmt(margin)} punti di scarto.`;
    else p1 += ` Margine finale di ${fmt(margin)} punti.`;
    const topStat = statLine(top);
    if (topStat) p1 += ` La copertina è tutta per ${top?.name}: ${topStat}.`;
    const best = bundle?.players?.[top?.name]?.best;
    if (best && topPts >= best.pts && topPts > 12) p1 += ` È il suo massimo stagionale.`;
    paras.push(p1);

    // P2 — posta in palio / precedenti stagionali
    if (ctx.isSB) {
        paras.push(`Una notte che vale tutto: con questo successo ${nW} si prende il titolo della Topina League ${ctx.year}.`);
    } else if (ctx.isPlayoff) {
        paras.push(`In palio c'era un posto nel Super Bowl: ${nW} stacca il biglietto per la finale, per ${nL} la stagione si chiude qui.`);
    } else if (ctx.seriesGames?.length) {
        const w = ctx.seriesGames.filter(g => g.won).length;
        const l = ctx.seriesGames.length - w;
        paras.push(`Contando i precedenti stagionali, il bilancio tra le due squadre ora dice ${w + 1}-${l} in favore di ${nW}.`);
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
        let p3 = `In casa ${nL} pesa la giornata no di ${flop.p.name}: ${fmt(flop.v)} punti contro una media stagionale di ${fmt1(flop.avg)}`;
        p3 += touches ? `, con appena ${touches} yard totali prodotte.` : '.';
        paras.push(p3);
    }

    // P4 — chi è in fiducia e chi no
    const hot = (W.starters || [])
        .map(p => ({ p, v: pts(p), avg: seasonAvg(bundle, p.name) }))
        .filter(x => x.avg && x.avg >= 5 && (x.v - x.avg) / x.avg >= 0.3 && x.p.name !== top?.name)
        .sort((a, b) => (b.v - b.avg) / b.avg - (a.v - a.avg) / a.avg)
        .slice(0, 2);
    if (hot.length) {
        const names = hot.map(x => `${x.p.name} (+${Math.round((x.v - x.avg) / x.avg * 100)}% sulla media)`).join(' e ');
        paras.push(`Tra i vincitori c'è chi viaggia a pieni giri: ${names} ${hot.length > 1 ? 'hanno' : 'ha'} dato profondità al punteggio di ${nW}.`);
    }

    return {
        headline,
        dateline: `Stagione ${ctx.year} · ${ctx.weekLabel} · Recap`,
        paras,
    };
}
