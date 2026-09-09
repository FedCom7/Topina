/**
 * Manager DNA — la pagina del singolo allenatore (#managerdna/{teamKey}).
 *
 * Come draftgrade-team.js: NESSUN guard `initialized`, si ri-parsa l'hash a
 * ogni chiamata, e dopo ogni `await` si ricontrolla che l'hash sia ancora
 * quello — altrimenti tornando indietro in fretta si finisce a disegnare la
 * pagina di un allenatore dentro quella di un altro.
 *
 * Le regole della vista di lega valgono qui uguali: niente lettere (il dato non
 * c'è nemmeno) e prosa solo sui tratti `signature`. Le card che non hanno dati
 * ritornano stringa vuota invece di disegnare un contenitore vuoto.
 */

import { getManagerDNA, CONFIDENCE_LABEL, CONFIDENCE_NOTE } from '../data/manager-dna.js?v=2';
import { dumbbell, multiLine, waterfall, inkFor } from '../ui/charts.js?v=7';
import { TEAMS } from './team.js?v=666';
import { TEAM_LOGO_SCALE } from '../data/team-config.js?v=1';

const KEYS = ['capi', 'lasers', 'oscurus', 'sommo'];
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const f1 = (v) => (v == null ? '—' : (Math.round(v * 10) / 10).toFixed(1));
const f0 = (v) => (v == null ? '—' : String(Math.round(v)));
const sig = (z) => (z == null ? '—' : `${z >= 0 ? '+' : ''}${z.toFixed(1)}σ`);

export async function initManagerDnaTeam() {
    const parts = location.hash.slice(1).split('/');
    const key = parts[1];
    const section = document.getElementById('managerdna-team');
    if (!section) return;
    if (!TEAMS[key]) { location.hash = '#managerdna'; return; }

    section.innerHTML = `<div class="section-inner gb-page">
        <div class="loading-state"><div class="spinner"></div><p>Reading the DNA...</p></div></div>`;

    const dna = await getManagerDNA();
    if (!location.hash.includes(`managerdna/${key}`)) return;   // l'utente è già altrove
    if (!dna || !dna.managers[key]) {
        section.innerHTML = `<div class="section-inner gb-page">
            <a class="gb-back" href="#managerdna"><span aria-hidden="true">←</span> Manager DNA</a>
            <div class="empty-state"><p class="empty-state-text">Manager DNA isn't built yet.</p></div>
        </div>`;
        return;
    }
    render(section, buildCtx(dna, key));
}

function buildCtx(dna, key) {
    const m = dna.managers[key];
    const picks = dna.picks.filter((p) => p.k === key);
    const moves = dna.moves.filter((x) => x.k === key);
    const trait = (id) => dna.traits.find((t) => t.id === id);
    const leagueMean = (id) => {
        const v = KEYS.map((k) => dna.managers[k].traits[id]?.raw).filter((x) => x != null);
        return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
    };
    return { dna, key, team: TEAMS[key], m, picks, moves, trait, leagueMean };
}

function card(kicker, title, sub, body) {
    if (!body) return '';
    return `
    <div class="mosaic-card mc-wide dna-card mc-in">
        <span class="mc-kicker">${esc(kicker)}</span>
        <h2 class="mc-title">${title}</h2>
        ${sub ? `<p class="dna-card-sub">${sub}</p>` : ''}
        ${body}
    </div>`;
}

/** dumbbell "lui contro la lega" per una lista di tratti */
function vsLeague(ctx, ids, opts = {}) {
    const rows = ids.map((id) => {
        const t = ctx.trait(id);
        const mine = ctx.m.traits[id]?.raw;
        const lg = ctx.leagueMean(id);
        if (!t || mine == null || lg == null) return null;
        return {
            label: t.label,
            a: mine,
            b: lg,
            tip: `${t.label} — ${t.tier === 'signature' ? 'firma' : t.tier === 'differs' ? 'differisce ma non si ripete' : 'dentro il caso'}`,
            meta: t.tier === 'signature' ? sig(t.z[ctx.key]) : '',
        };
    }).filter(Boolean);
    if (!rows.length) return '';
    return dumbbell(rows, {
        a: { name: ctx.team.name, color: ctx.team.color },
        b: { name: 'Media di lega', color: 'var(--text-muted)' },
        fmt: (v) => f1(v),
        min: Math.min(0, ...rows.flatMap((r) => [r.a, r.b])),
        labelW: opts.labelW || 230,
        rightW: 96,
    });
}

// ─── 1. hero ─────────────────────────────────────────────────────────────────

function hero(ctx) {
    const a = ctx.m.archetype;
    const chips = a ? a.evidence.map((e) => {
        const def = ctx.trait(e.trait);
        return `<span class="dna-chip"><b>${sig(e.z)}</b> ${esc(def.label)}
                <i>soglia ${e.thr > 0 ? '+' : ''}${e.thr}σ</i></span>`;
    }).join('') : '';
    return `
    <header class="mosaic-card mc-wide dna-hero mc-in" style="--logo-scale:${TEAM_LOGO_SCALE[ctx.key] || 1}">
        <img class="mc-watermark" src="${ctx.team.logo}" alt="" aria-hidden="true">
        <span class="mc-kicker">${esc(ctx.team.name)}</span>
        <h1 class="mc-title dna-hero-title">${a ? esc(a.label) : '—'}</h1>
        ${a ? `<span class="dna-conf dna-conf--${a.confidence}"
                 title="${esc(CONFIDENCE_NOTE[a.confidence])}">${esc(CONFIDENCE_LABEL[a.confidence])}</span>` : ''}
        <p class="dna-hero-blurb">${a ? esc(a.blurb) : ''}</p>
        ${a ? `<p class="dna-conf-note">${esc(CONFIDENCE_NOTE[a.confidence])}</p>` : ''}
        ${chips ? `<div class="dna-chips">${chips}</div>` : ''}
        <div class="dna-kpis">
            <div class="dna-kpi"><b>${ctx.m.nPicks}</b><span>pick</span></div>
            <div class="dna-kpi"><b>${ctx.m.nMoves}</b><span>acquisti dal mercato</span></div>
            <div class="dna-kpi"><b>${ctx.m.nSeasons}</b><span>stagioni</span></div>
        </div>
    </header>`;
}

// ─── 2. tratti per gruppo ────────────────────────────────────────────────────

function groupCards(ctx) {
    const gruppi = [
        ['market', 'Il mercato al draft', 'Quanto anticipa il listone, e quanto è prevedibile nel farlo.'],
        ['loyalty', 'Fedeltà', 'Quanto si tiene i suoi giocatori, al draft e durante l\'anno.'],
        ['age', 'Età e tipo di giocatore', 'Che giocatore gli piace comprare.'],
        ['inseason', 'Il mercato durante l\'anno', 'Come usa i movimenti in stagione.'],
        ['structure', 'Struttura del draft', 'Come distribuisce le pick fra i ruoli. Tutto dentro il caso: numeri, non abitudini.'],
    ];
    return gruppi.map(([g, titolo, sub]) => {
        const ids = ctx.dna.traits.filter((t) => t.group === g)
            .sort((a, b) => a.q - b.q).slice(0, 8).map((t) => t.id);
        return card('Tratti', titolo, sub, vsLeague(ctx, ids));
    }).join('');
}

// ─── 3. per pick contro per giocatore ────────────────────────────────────────

function unitSplitCard(ctx) {
    // Solo dove le due unità DIVERGONO davvero: è la card che spiega l'unico
    // artefatto serio di questa analisi, e se non c'è non si disegna.
    const coppie = [['vetRatePick', 'vetRate'], ['rookieRatePick', 'rookieRate']];
    const rows = [];
    for (const [perPick, perPlayer] of coppie) {
        const a = ctx.m.traits[perPick]?.raw;
        const b = ctx.m.traits[perPlayer]?.raw;
        const ta = ctx.trait(perPick);
        const tb = ctx.trait(perPlayer);
        if (a == null || b == null || !ta || !tb) continue;
        if (Math.abs(a - b) < 5) continue;
        rows.push({
            label: ta.label.replace(', per pick', ''),
            a, b,
            tip: `${ta.label}: ${f1(a)} — contando i giocatori una volta sola: ${f1(b)}`,
            meta: `${f1(a)} → ${f1(b)}`,
        });
    }
    if (!rows.length) return '';
    return card(
        'Una trappola, e come si scopre',
        'Contare le pick o contare i giocatori',
        'Chi ridrafta gli stessi giocatori li conta più volte, e quei giocatori nel frattempo '
        + 'invecchiano. Contando <b>ogni giocatore una volta sola</b> il quadro cambia: dove le due '
        + 'colonne si allontanano, la differenza non è un gusto ma un effetto del ridraftare.',
        dumbbell(rows, {
            a: { name: 'Per pick', color: ctx.team.color },
            b: { name: 'Per giocatore', color: 'var(--accent-blue)' },
            fmt: (v) => f1(v),
            labelW: 230, rightW: 96,
        }),
    );
}

// ─── 4. l'orologio posizionale ───────────────────────────────────────────────

function clockCard(ctx) {
    const ids = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'].map((p) => `first${p}`);
    const body = vsLeague(ctx, ids, { labelW: 150 });
    if (!body) return '';
    return card(
        'Quando prende cosa',
        'L\'orologio posizionale',
        'Il giro in cui prende il suo primo di ogni ruolo, contro il resto della lega. '
        + 'Nessuna di queste differenze supera il test: sono numeri, non abitudini.',
        body,
    );
}

// ─── 5. evoluzione ───────────────────────────────────────────────────────────

function evolutionCard(ctx) {
    const sigs = ctx.dna.traits.filter((t) => t.tier === 'signature' && t.testable)
        .sort((a, b) => a.q - b.q).slice(0, 3);
    if (!sigs.length) return '';
    const blocchi = sigs.map((t) => {
        const series = KEYS.map((k) => ({
            name: TEAMS[k].name,
            color: k === ctx.key ? inkFor(ctx.team.color) : 'var(--text-muted)',
            lead: k === ctx.key ? true : false,
            values: ctx.dna.managers[k].traits[t.id].byYear
                .filter((p) => p.raw != null)
                .map((p) => ({ x: p.year, y: p.raw, tip: `${TEAMS[k].name} ${p.year}: ${f1(p.raw)}` })),
        })).filter((s) => s.values.length > 1);
        if (!series.length) return '';
        return `<h3 class="dna-sub">${esc(t.label)}</h3>
        ${multiLine(series, {
            points: true, height: 240,
            xTicks: ctx.dna.seasons.map((y) => ({ x: +y, label: y })),
            yFmt: (v) => f1(v),
        })}`;
    }).join('');
    return card(
        'Come è cambiato',
        'L\'evoluzione delle sue firme',
        'Le tre tendenze più forti, stagione per stagione. Lui in evidenza, gli altri tre come contesto.',
        blocchi,
    );
}

// ─── 6. le prove ─────────────────────────────────────────────────────────────

function evidenceCard(ctx) {
    // La fedeltà non si racconta con una lista di pick ma con le CATENE: lo
    // stesso giocatore ripreso anno dopo anno.
    const t = ctx.trait('repeatConsec');
    if (!t || t.tier !== 'signature') return '';
    const byPlayer = new Map();
    for (const p of ctx.picks) {
        if (!byPlayer.has(p.player)) byPlayer.set(p.player, []);
        byPlayer.get(p.player).push(p.y);
    }
    const catene = [...byPlayer.entries()]
        .map(([player, anni]) => ({ player, anni: anni.sort() }))
        .filter((c) => c.anni.length > 1)
        .sort((a, b) => b.anni.length - a.anni.length || a.player.localeCompare(b.player))
        .slice(0, 12);
    if (!catene.length) return '';

    const righe = catene.map((c) => `
        <div class="dna-chain">
            <span class="dna-chain-name">${esc(c.player)}</span>
            <span class="dna-chain-dots">${ctx.dna.seasons.map((y) => `
                <i class="${c.anni.includes(+y) ? 'is-on' : ''}" title="${y}"></i>`).join('')}</span>
            <span class="dna-chain-n">${c.anni.length}×</span>
        </div>`).join('');

    return card(
        'Le prove',
        'I giocatori che ha ripreso',
        `Un pallino per stagione, acceso quando quel giocatore era suo. È il tratto più forte del suo
         profilo (${sig(t.z[ctx.key])}) e questi sono i casi che lo generano.`,
        `<div class="dna-chains">
            <div class="dna-chain dna-chain-head">
                <span></span><span class="dna-chain-dots">${ctx.dna.seasons.map((y) => `
                    <i class="is-label">${String(y).slice(2)}</i>`).join('')}</span><span></span>
            </div>
            ${righe}
        </div>`,
    );
}

// ─── 7. la stagione di mercato ───────────────────────────────────────────────

function marketCard(ctx) {
    const clean = ctx.moves.filter((m) => m.kind === 'clean');
    if (!clean.length) return '';

    const weeks = [...new Set(ctx.moves.map((m) => m.week))].sort((a, b) => a - b);
    const series = KEYS.map((k) => {
        const mine = ctx.dna.moves.filter((m) => m.k === k && m.kind === 'clean');
        return {
            name: TEAMS[k].name,
            color: k === ctx.key ? inkFor(ctx.team.color) : 'var(--text-muted)',
            lead: k === ctx.key ? true : false,
            values: weeks.map((w) => ({
                x: w,
                y: mine.filter((m) => m.week === w).length / ctx.dna.seasons.length,
                tip: `${TEAMS[k].name} — settimana ${w}: ${f1(mine.filter((m) => m.week === w).length / ctx.dna.seasons.length)} movimenti/stagione`,
            })),
        };
    });

    const best = [...clean].sort((a, b) => b.startedPts - a.startedPts).slice(0, 10);
    const righe = best.map((m) => `
        <div class="an-player-row dna-add-row">
            <span class="an-cell an-player-name">${esc(m.player)}</span>
            <span class="an-cell dna-add-meta">${m.y} · settimana ${m.week}</span>
            <span class="an-cell dna-add-meta">${m.tenure} sett. in rosa</span>
            <span class="an-cell an-pts">${f0(m.startedPts)}</span>
        </div>`).join('');

    return card(
        'Il mercato, per me',
        'Quando si muove, e cosa ne ha ricavato',
        'Movimenti per settimana mediati sulle sette stagioni, poi i dieci acquisti che gli hanno '
        + 'reso di più da titolare.',
        `${multiLine(series, {
            height: 250, xTicks: weeks.filter((w) => w % 2 === 1).map((w) => ({ x: w, label: `W${w}` })),
            yFmt: (v) => f1(v),
        })}
        <h3 class="dna-sub">I dieci acquisti migliori</h3>
        <div class="dna-adds">${righe}</div>`,
    );
}

// ─── 8. ha pagato ────────────────────────────────────────────────────────────

function payoffCard(ctx) {
    // Riferimento interno: quanto ha reso una pick rispetto alla MEDIANA DI
    // LEGA delle pick dello stesso giro, quell'anno. Niente proiezioni, niente
    // motore del voto: la linea di paragone è dentro la stagione.
    const fasce = [[1, 3], [4, 7], [8, 11], [12, 15]];
    const refs = new Map();
    for (const y of ctx.dna.seasons.map(Number)) {
        for (const [lo, hi] of fasce) {
            const v = ctx.dna.picks
                .filter((p) => p.y === y && p.round >= lo && p.round <= hi && p.pts != null)
                .map((p) => p.pts).sort((a, b) => a - b);
            if (v.length) refs.set(`${y}|${lo}`, v[Math.floor(v.length / 2)]);
        }
    }
    const steps = fasce.map(([lo, hi]) => {
        const mie = ctx.picks.filter((p) => p.round >= lo && p.round <= hi && p.pts != null);
        if (!mie.length) return null;
        const d = mie.reduce((a, p) => a + (p.pts - (refs.get(`${p.y}|${lo}`) ?? p.pts)), 0) / ctx.dna.seasons.length;
        return { label: `giri ${lo}-${hi}`, d, tip: `${mie.length} pick` };
    }).filter(Boolean);
    if (!steps.length) return '';

    return card(
        'Ha pagato?',
        'Punti sopra o sotto il riferimento del giro',
        'Per ogni fascia di giri, quanti punti a stagione hanno reso le sue pick rispetto alla '
        + 'mediana di lega delle pick dello stesso giro. È un riferimento interno alla stagione: '
        + 'nessuna proiezione, nessun voto. Il giudizio sulla singola scelta sta nelle '
        + '<a href="#draftgrades">Draft Grades</a>.',
        waterfall(steps, { totalLabel: 'Totale', fmt: (v) => f0(v) }),
    );
}

// ─── 9. fortuna ──────────────────────────────────────────────────────────────

function luckCard(ctx) {
    const ids = ['lateHit', 'injWeeks'];
    const blocchi = ids.map((id) => {
        const t = ctx.trait(id);
        if (!t) return '';
        const series = KEYS.map((k) => ({
            name: TEAMS[k].name,
            color: k === ctx.key ? inkFor(ctx.team.color) : 'var(--text-muted)',
            lead: k === ctx.key ? true : false,
            values: ctx.dna.managers[k].traits[id].byYear
                .filter((p) => p.raw != null)
                .map((p) => ({ x: p.year, y: p.raw, tip: `${TEAMS[k].name} ${p.year}: ${f1(p.raw)}` })),
        })).filter((s) => s.values.length > 1);
        if (!series.length) return '';
        return `<h3 class="dna-sub">${esc(t.label)}</h3>
        ${multiLine(series, {
            points: true, height: 230,
            xTicks: ctx.dna.seasons.map((y) => ({ x: +y, label: y })),
            yFmt: (v) => f1(v),
        })}`;
    }).join('');
    if (!blocchi) return '';

    return card(
        'Fortuna, per me',
        'I colpi tardivi e gli infortuni',
        'Le due cose per cui in lega ci si vanta e ci si lamenta. Sui sette anni <b>non si ripetono</b>: '
        + 'un\'annata buona al dodicesimo giro non predice quella dopo, e le settimane perse per '
        + 'infortunio sono le stesse per tutti e quattro. Non è una qualità e non è una maledizione.',
        blocchi,
    );
}

// ─── render ──────────────────────────────────────────────────────────────────

function render(section, ctx) {
    section.innerHTML = `
    <div class="section-inner gb-page dna-page" style="--team-color:${ctx.team.color};--card-glow:${ctx.team.color}">
        <a class="gb-back" href="#managerdna"><span aria-hidden="true">←</span> Manager DNA</a>
        <div class="mosaic dna-mosaic">
            ${hero(ctx)}
            ${groupCards(ctx)}
            ${unitSplitCard(ctx)}
            ${clockCard(ctx)}
            ${evolutionCard(ctx)}
            ${evidenceCard(ctx)}
            ${marketCard(ctx)}
            ${payoffCard(ctx)}
            ${luckCard(ctx)}
            <p class="dna-footnote">
                Un tratto diventa "abitudine" solo se supera due test indipendenti: che i quattro
                allenatori differiscano più del caso, e che il valore si ripeta di anno in anno.
                Il metodo per esteso è in fondo a <a href="#managerdna">Manager DNA</a>.
            </p>
        </div>
    </div>`;
}
