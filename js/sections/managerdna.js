/**
 * Manager DNA — vista di lega (#managerdna).
 *
 * Come drafta e come si muove sul mercato ciascun allenatore, e soprattutto
 * QUALI di quelle tendenze reggono a un test e quali no.
 *
 * Due regole che questa pagina non può violare:
 *
 *  - **Niente lettere.** Il voto resta una cosa sola sul sito, il verdetto
 *    delle Pagelle. Qui non arriva nemmeno il dato: il JSON non contiene
 *    `letter`/`score`/`grade` (vedi js/data/manager-dna.js), quindi la regola
 *    regge per costruzione e non per disciplina.
 *  - **Un tratto vale come "abitudine" solo se è `signature`.** Gli altri si
 *    mostrano — sono comunque la descrizione di cosa è successo — ma come
 *    numeri, mai come frasi. Chi aggiunge prosa a un tratto `differs` o
 *    `noise` sta dicendo al lettore una cosa che i dati non sostengono.
 *
 * "Nessuna firma" è un esito legittimo e va disegnato bene: con 105 pick a
 * testa è probabile, e infatti capita a uno dei quattro.
 */

import { getManagerDNA, CONFIDENCE_LABEL, CONFIDENCE_NOTE } from '../data/manager-dna.js?v=2';
import { stripPlot } from '../ui/strip-plot.js?v=1';
import { dumbbell, scatter, multiLine, inkFor } from '../ui/charts.js?v=7';
import { pickDropdownHTML, bindPickDropdown } from '../ui/dropdown-pick.js?v=1';
import { TEAMS } from './team.js?v=666';
import { TEAM_LOGO_SCALE } from '../data/team-config.js?v=1';

const KEYS = ['capi', 'lasers', 'oscurus', 'sommo'];
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const f1 = (v) => (v == null ? '—' : (Math.round(v * 10) / 10).toFixed(1));
const sig = (z) => (z == null ? '—' : `${z >= 0 ? '+' : ''}${z.toFixed(1)}σ`);

let loaded = false;
let DNA = null;
let trendTrait = 'moves';

export async function initManagerDna() {
    if (loaded) return;
    loaded = true;
    const host = document.getElementById('dna-content');
    if (!host) return;

    DNA = await getManagerDNA();
    if (!DNA) {
        host.innerHTML = `
        <div class="empty-state">
            <p class="empty-state-text">Manager DNA isn't built yet. Run
            <code>npm run build-manager-dna</code> to generate it.</p>
        </div>`;
        return;
    }
    render(host);
}

// ─── helper comuni ───────────────────────────────────────────────────────────

const traitById = (id) => DNA.traits.find((t) => t.id === id);
const rowsFor = (ids) => ids.map((id) => {
    const t = traitById(id);
    if (!t) return null;
    return {
        label: t.label,
        tier: t.tier,
        points: KEYS.map((k) => ({
            key: k, name: TEAMS[k].name, color: TEAMS[k].color,
            z: t.z[k], raw: DNA.managers[k].traits[id].raw,
        })),
    };
}).filter(Boolean);

/** Gli id dei tratti di un gruppo, dal più al meno significativo. */
const idsOfGroup = (group, tiers = null) => DNA.traits
    .filter((t) => t.group === group && (!tiers || tiers.includes(t.tier)))
    .sort((a, b) => a.q - b.q)
    .map((t) => t.id);

function card(kicker, title, sub, body, extra = '') {
    if (!body) return '';
    return `
    <div class="mosaic-card mc-wide dna-card mc-in ${extra}">
        <span class="mc-kicker">${esc(kicker)}</span>
        <h2 class="mc-title">${title}</h2>
        ${sub ? `<p class="dna-card-sub">${sub}</p>` : ''}
        ${body}
    </div>`;
}

// ─── 1. le quattro firme ─────────────────────────────────────────────────────

function signatureCards() {
    const cards = KEYS.map((k) => {
        const m = DNA.managers[k];
        const t = TEAMS[k];
        const a = m.archetype;
        const chips = a
            ? a.evidence.map((e) => {
                const def = traitById(e.trait);
                const raw = m.traits[e.trait].raw;
                return `<span class="dna-chip"><b>${sig(e.z)}</b> ${esc(def.label)}
                        <i>${f1(raw)}</i></span>`;
            }).join('')
            : '';
        return `
        <a class="mosaic-card dna-mgr mc-in" href="#managerdna/${k}"
           style="--team-color:${t.color};--card-glow:${t.color};--logo-scale:${TEAM_LOGO_SCALE[k] || 1}">
            <img class="mc-watermark" src="${t.logo}" alt="" aria-hidden="true">
            <span class="mc-kicker">${esc(t.name)}</span>
            <h3 class="mc-title dna-mgr-title">${a ? esc(a.label) : '—'}</h3>
            ${a ? `<span class="dna-conf dna-conf--${a.confidence}"
                     title="${esc(CONFIDENCE_NOTE[a.confidence])}">${esc(CONFIDENCE_LABEL[a.confidence])}</span>` : ''}
            <p class="dna-mgr-blurb">${a ? esc(a.blurb) : ''}</p>
            ${chips ? `<div class="dna-chips">${chips}</div>` : ''}
            <div class="dna-mgr-foot">
                <span><b>${m.nPicks}</b> pick</span>
                <span><b>${m.nMoves}</b> movimenti</span>
                <span><b>${m.nSeasons}</b> stagioni</span>
            </div>
        </a>`;
    }).join('');
    return `<div class="dna-mgr-grid">${cards}</div>`;
}

// ─── 2. dove differiscono, e se è vero ───────────────────────────────────────

function stripCard(kicker, title, sub, ids) {
    const rows = rowsFor(ids);
    if (!rows.length) return '';
    return card(kicker, title, sub, stripPlot(rows, {
        band: DNA.test.zCritFWER,
        fmtRaw: (v) => f1(v),
    }) + legendaTier());
}

function legendaTier() {
    return `
    <div class="dna-legend">
        <span class="dna-tier-signature">firma</span> — differisce e si ripete ·
        <span class="dna-tier-differs">differisce</span> — ma in sette anni non si ripete ·
        <span class="dna-tier-noise">rumore</span> — dentro il caso
        <span class="dna-legend-dots">${KEYS.map((k) => `
            <i style="background:${inkFor(TEAMS[k].color)}"></i>${esc(TEAMS[k].name)}`).join('')}</span>
    </div>`;
}

// ─── 3. evoluzione ───────────────────────────────────────────────────────────

function trendCard() {
    const candidates = DNA.traits
        .filter((t) => t.testable && t.tier === 'signature')
        .sort((a, b) => a.q - b.q);
    if (!candidates.length) return '';
    if (!candidates.some((t) => t.id === trendTrait)) trendTrait = candidates[0].id;
    const idx = candidates.findIndex((t) => t.id === trendTrait);
    const dd = pickDropdownHTML('dnaTrait', candidates.map((t) => ({ label: t.label, value: t.id })), idx);

    return card(
        'Come sono cambiati',
        'Stagione per stagione',
        'Le firme non sono fotografie: qui si vede se una tendenza è sempre stata lì o è arrivata a un certo punto.',
        `<div class="pick-row dna-pickrow" id="dna-trend-pick">${dd}</div>
         <div id="dna-trend-chart">${trendChart()}</div>`,
    );
}

function trendChart() {
    const t = traitById(trendTrait);
    if (!t) return '';
    const series = KEYS.map((k) => ({
        name: TEAMS[k].name,
        color: inkFor(TEAMS[k].color),
        values: DNA.managers[k].traits[trendTrait].byYear
            .filter((p) => p.raw != null)
            .map((p) => ({ x: p.year, y: p.raw, tip: `${TEAMS[k].name} ${p.year}: ${f1(p.raw)}` })),
    })).filter((s) => s.values.length > 1);
    if (!series.length) return '<p class="dna-note">Non ci sono abbastanza stagioni per questo tratto.</p>';
    return multiLine(series, {
        points: true,
        xTicks: DNA.seasons.map((y) => ({ x: +y, label: y })),
        yFmt: (v) => f1(v),
    }) + `<p class="dna-note">${esc(t.label)} — valore grezzo, non normalizzato.</p>`;
}

// ─── 4. il mercato durante l'anno ────────────────────────────────────────────

function volumeVsQualityCard() {
    const mv = traitById('moves');
    const pa = traitById('ptsPerAdd');
    if (!mv || !pa) return '';
    const pts = KEYS.map((k) => ({
        x: DNA.managers[k].traits.moves.raw,
        y: DNA.managers[k].traits.ptsPerAdd.raw,
        color: inkFor(TEAMS[k].color),
        label: TEAMS[k].name,
        tip: `${TEAMS[k].name}: ${f1(DNA.managers[k].traits.moves.raw)} movimenti/stagione, `
            + `${f1(DNA.managers[k].traits.ptsPerAdd.raw)} punti per acquisto`,
    }));
    // iso-raccolto: le combinazioni (movimenti × punti per acquisto) che danno
    // lo stesso totale di punti. Serve a mostrare che due strade opposte
    // arrivano quasi allo stesso posto — senza, il grafico sembra dire che
    // muoversi poco è meglio.
    const totale = pts.reduce((a, p) => a + p.x * p.y, 0) / pts.length;
    const xs = pts.map((p) => p.x);
    const curve = [];
    for (let x = Math.min(...xs) * 0.85; x <= Math.max(...xs) * 1.1; x += 0.5) {
        curve.push({ x, y: totale / x });
    }
    return card(
        'Il compromesso',
        'Volume contro qualità',
        'Chi si muove poco sceglie meglio, chi si muove tanto raccoglie di più. La linea è il '
        + 'raccolto medio di lega: chi le sta sopra ha fatto meglio della media, comunque si sia mosso.',
        scatter(pts, {
            curve, curveLabel: 'stesso raccolto',
            xLabel: 'Movimenti per stagione', yLabel: 'Punti per acquisto',
            xFmt: (v) => f1(v), yFmt: (v) => String(Math.round(v)),
        }),
    );
}

function bridgeCard() {
    const ids = ['repeatConsec', 'holdDraftW8', 'moves'];
    if (!ids.every((id) => traitById(id)?.tier === 'signature')) return '';
    const rows = rowsFor(ids);
    const lead = KEYS.map((k) => ({
        k, z: (DNA.managers[k].traits.repeatConsec.z || 0) + (DNA.managers[k].traits.holdDraftW8.z || 0)
            - (DNA.managers[k].traits.moves.z || 0),
    })).sort((a, b) => b.z - a.z);
    const top = TEAMS[lead[0].k].name;
    const bottom = TEAMS[lead[lead.length - 1].k].name;

    return card(
        'Il ponte fra le due metà',
        'Attaccarsi ai propri giocatori è una cosa sola',
        `Il tratto più forte del draft e quello più forte del mercato descrivono lo stesso
         comportamento. <b>${esc(top)}</b> ridrafta i suoi, se li tiene in rosa e quasi non si muove;
         <b>${esc(bottom)}</b> fa l'opposto su tutti e tre. Non sono tre tendenze: è una disposizione
         sola che si vede da due parti, su dati indipendenti — ed è l'unica frase di questa pagina
         sostenuta da due fonti diverse.`,
        stripPlot(rows, { band: DNA.test.zCritFWER, fmtRaw: (v) => f1(v) }),
    );
}

// ─── 5. fortuna ──────────────────────────────────────────────────────────────

function luckCard() {
    const ids = idsOfGroup('luck');
    if (!ids.length) return '';
    const blocchi = ['lateHit', 'injWeeks'].map((id) => {
        const t = traitById(id);
        if (!t) return '';
        const rows = KEYS.map((k) => ({
            label: TEAMS[k].name,
            a: DNA.managers[k].traits[id].raw,
            b: 0,
            tip: TEAMS[k].name,
        }));
        const media = rows.reduce((a, r) => a + (r.a || 0), 0) / rows.length;
        for (const r of rows) r.b = media;
        const verdetto = t.tier === 'signature'
            ? 'Questo si ripete di anno in anno: è una qualità, non un caso.'
            : `L'anno dopo non si ripete (r ${t.persistR == null ? '—' : t.persistR.toFixed(2)}). È fortuna.`;
        return `
        <h3 class="dna-sub">${esc(t.label)}</h3>
        ${dumbbell(rows, {
            a: { name: 'Allenatore', color: 'var(--accent-amber)' },
            b: { name: 'Media di lega', color: 'var(--text-muted)' },
            fmt: (v) => f1(v),
        })}
        <p class="dna-verdict ${t.tier === 'signature' ? 'is-skill' : 'is-luck'}">${esc(verdetto)}</p>`;
    }).join('');

    return card(
        'Fortuna',
        'Pescare tardi e non rompersi',
        'Le due cose di cui in lega ci si vanta e ci si lamenta di più: il colpo al dodicesimo giro '
        + 'e gli infortuni. Le differenze ci sono, e sono grandi. Ma nessuna delle due <b>si ripete</b> '
        + 'da un anno all\'altro — e una qualità che non si ripete non è una qualità.',
        blocchi + stripPlot(rowsFor(ids), { band: DNA.test.zCritFWER, fmtRaw: (v) => f1(v) }),
    );
}

// ─── 6. metodo ───────────────────────────────────────────────────────────────

function methodCard() {
    const c = DNA.coverage;
    const k = c.movesByKind;
    const sigs = DNA.traits.filter((t) => t.tier === 'signature').length;
    return `
    <div class="mosaic-card mc-wide dna-card dna-method mc-in">
        <span class="mc-kicker">Come è testato</span>
        <h2 class="mc-title">Due cancelli, non uno</h2>
        <p class="dna-card-sub">
            Un tratto diventa "abitudine" solo se supera <b>entrambi</b>. Su ${DNA.traits.length}
            tratti testati ne passano ${sigs}.
        </p>
        <ol class="dna-method-list">
            <li><b>Differenza</b> — gli allenatori differiscono più di quanto farebbe il caso?
                ${DNA.test.B} rimescolamenti delle etichette, poi correzione Benjamini-Hochberg
                a q ≤ ${DNA.test.fdrQ} su tutta la famiglia insieme. Due nulli diversi: i tratti di
                draft si permutano <i>dentro il giro</i> (in uno snake a quattro ogni allenatore ha
                esattamente una pick per giro, e rimescolare liberamente gonfierebbe ogni tratto
                legato al timing), quelli di mercato <i>dentro la stagione</i>.</li>
            <li><b>Persistenza</b> — quel valore si ripete l'anno dopo? Autocorrelazione fra stagioni
                consecutive. È il cancello che separa un'identità dalla fortuna: i colpi tardivi e gli
                infortuni passano il primo e falliscono il secondo.</li>
        </ol>
        <p class="dna-note">
            Copertura: ${c.picks} pick (${c.adpMatched} con ADP, ${c.rosterMatched} con anagrafica,
            ${c.ptsMatched} con punti stagionali) e ${c.moves} movimenti, di cui ${k.clean} veri
            acquisti dal mercato, ${k.boomerang} rientri di giocatori già avuti (IR, bye) e
            ${k.trade} scambi. I tratti di mercato contano i soli acquisti veri: senza distinguerli,
            chi parcheggia infortunati sembrerebbe un iperattivo.
        </p>
        <p class="dna-note">
            I punti stagionali sono ricostruiti dai tabellini di lega (titolari <i>e</i> panchina)
            più le settimane da svincolato. La soglia "ha reso come una pick di primo giro" è interna
            a ogni stagione — la mediana dei punti delle pick dei primi quattro giri — così i sette
            anni sono confrontabili senza dover credere a una proiezione.
        </p>
        <p class="dna-note">
            Limite noto: la permutazione dentro il giro non conserva l'ordine <i>dentro</i> il giro.
            E con ${DNA.seasons.length} stagioni il test vede solo differenze larghe: sotto la banda
            del caso (±${DNA.test.zCritFWER.toFixed(2)}σ) non si può dire niente, né in un senso né
            nell'altro.
        </p>
        <p class="dna-note">
            Questa pagina misura <b>comportamenti</b>, non la qualità delle singole scelte: quel
            giudizio sta nelle <a href="#draftgrades">Draft Grades</a>, e lì resta.
        </p>
    </div>`;
}

// ─── render ──────────────────────────────────────────────────────────────────

function render(host) {
    host.innerHTML = `
    <div class="mosaic dna-mosaic">
        ${signatureCards()}
        ${stripCard('Dove differiscono, e se è vero', 'Il draft',
        'Ogni riga è un tratto, ogni pallino un allenatore. Dentro la banda grigia c\'è il caso: '
        + 'quello che ci finisce dentro non distingue nessuno da nessuno.',
        [...idsOfGroup('market'), ...idsOfGroup('loyalty'), ...idsOfGroup('age'), ...idsOfGroup('structure')])}
        ${stripCard('Dove differiscono, e se è vero', 'Il mercato durante l\'anno',
        'Qui il segnale è molto più forte che al draft, ed è ragionevole: muoversi sul mercato è un '
        + 'gesto ripetuto venti volte l\'anno, draftare è un pomeriggio solo.',
        idsOfGroup('inseason'))}
        ${volumeVsQualityCard()}
        ${bridgeCard()}
        ${trendCard()}
        ${luckCard()}
        ${methodCard()}
    </div>`;

    const pick = host.querySelector('#dna-trend-pick');
    if (pick) {
        bindPickDropdown(pick, (_id, value) => {
            trendTrait = value;
            const box = host.querySelector('#dna-trend-chart');
            if (box) box.innerHTML = trendChart();
            const btn = pick.querySelector('[data-pick-btn]');
            const t = traitById(value);
            if (btn && t) btn.innerHTML = `${esc(t.label)}<span class="pick-dd-caret" aria-hidden="true">▾</span>`;
        });
    }
}
