/**
 * Final Whistle — hai vinto o hai perso, la prima volta che si apre il sito
 * dopo che la giornata e' stata chiusa.
 *
 * E' il fratello del Night Recap (`sections/night-recap.js`) e ne segue
 * l'idea: una scena sopra tutto il sito, che racconta invece di comunicare.
 * Li' si rivede la notte giocata per giocata; qui si chiude la settimana: il
 * punteggio che sale, il verdetto, chi l'ha decisa, e cosa cambia in
 * classifica.
 *
 * Si apre la prima volta che si entra nel sito dopo che una giornata e'
 * stata chiusa su Firebase, e mai due volte la stessa giornata sullo stesso
 * dispositivo (`avviaEsitoSettimana`, chiamata da `boot()` in app.js subito
 * dopo il Night Recap). Se parte anche il Night Recap, questa aspetta SOTTO
 * di lui e comincia quando lui si chiude.
 *
 * Il banco di prova e' `preview-week-result.html` (locale, nel .gitignore),
 * che importa questo modulo e non una sua copia.
 */

import { TEAM_PALETTE, TEAM_LOGOS, TEAM_LOGO_SCALE } from '../data/team-config.js?v=535';
import { playerImageService } from '../services/player-image-service.js?v=533';
import { montaLivello, razziDaiLati, coriandoliAttorno, fermaEffetti } from '../ui/live-fx.js?v=38';
import { CURRENT_SEASON, fetchFantasyData, displayName } from '../data.js?v=595';
import { squadraPreferita } from '../utils/preferenze.js?v=1';
import {
    esitoSettimana, ultimaGiornataChiusa, segnalibroEsito, segnaEsitoVisto, segnaControllato,
    valeControllare, primaVoltaMostrabile, chiaveGiornata, piuNuova,
} from '../data/week-result.js?v=1';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const fmt = (n) => (+n).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const ridotto = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const logo = (nome) => encodeURI(TEAM_LOGOS[nome] || '');

/* I tempi della scena, in millisecondi dall'apertura. Il punteggio sale per
   primo e il verdetto arriva SOLO quando i numeri si sono fermati: la
   suspense e' tutta li', come allo scadere del cronometro. */
const T = { punteggio: 450, conta: 2600, verdetto: 3250, dettagli: 3900, trema: 4300, scatto: 5900 };

let overlay = null;
let timers = [];
let quandoChiude = null;
let fermaPioggia = null;

const VERDETTO = { win: 'Victory', loss: 'Defeat', tie: 'Tie' };

/**
 * Apre la scena per un esito (`esitoSettimana` in data/week-result.js).
 * @param e          l'esito
 * @param onChiudi   richiamata quando si esce (dal pulsante o da `chiudiEsito`)
 */
export function mostraEsito(e, { onChiudi = null } = {}) {
    if (!e) return false;
    chiudiEsito({ silenzioso: true });
    quandoChiude = onChiudi;

    const mia = TEAM_PALETTE[e.io.chiave] || {};
    const loro = TEAM_PALETTE[e.loro.chiave] || {};
    overlay = document.createElement('div');
    overlay.className = `wr-overlay wr--${e.esito}`;
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-label', `${e.etichetta} result`);
    overlay.style.cssText = `--wr-mia:${mia.bright || '#fff'};--wr-mia-ink:${mia.ink || '#222'};`
        + `--wr-loro:${loro.bright || '#888'};--wr-loro-ink:${loro.ink || '#222'}`;
    overlay.innerHTML = scenaHTML(e);
    document.body.appendChild(overlay);
    document.body.classList.add('wr-open');
    overlay.querySelector('.wr-go')?.addEventListener('click', () => chiudiEsito());
    document.addEventListener('keydown', tasti);
    idrataFoto(overlay, e.year);
    recita(e);
    return true;
}

/** Chiude la scena. `silenzioso`: senza richiamare chi l'aveva aperta. */
export function chiudiEsito({ silenzioso = false } = {}) {
    timers.forEach(clearTimeout);
    timers = [];
    document.removeEventListener('keydown', tasti);
    fermaEffetti();
    if (fermaPioggia) { fermaPioggia(); fermaPioggia = null; }
    const el = overlay;
    overlay = null;
    document.body.classList.remove('wr-open');
    const cb = quandoChiude;
    quandoChiude = null;
    if (el) {
        el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 260, fill: 'forwards' })
            .onfinish = () => el.remove();
    }
    if (!silenzioso && cb) cb();
}

function tasti(ev) {
    if (ev.key === 'Escape' || ev.key === 'Enter') chiudiEsito();
}

/* ─── Il markup ─────────────────────────────────────────────────────── */

function latoHTML(t, cls) {
    const scala = TEAM_LOGO_SCALE[t.chiave] ?? 1;
    return `
    <div class="wr-side ${cls}">
        <span class="wr-logo"><img src="${logo(t.nome)}" alt="" style="scale:${scala}"></span>
        <span class="wr-name">${esc(t.nome)}</span>
        <b class="wr-pts" data-to="${t.punti}">0.0</b>
    </div>`;
}

function eroeHTML(p, etichetta, cls) {
    if (!p) return '';
    return `
    <div class="wr-hero ${cls}">
        <span class="wr-hero-foto"><img src="images/fallback-player.svg" alt=""
            data-wr-foto data-name="${esc(p.name)}" data-nfl="${esc(p.nfl)}" data-pos="${esc(p.pos)}"></span>
        <span class="wr-hero-txt">
            <span class="wr-hero-k">${etichetta}</span>
            <b>${esc(p.name)}</b>
            <span class="wr-hero-sub">${esc(p.pos)}${p.nfl ? ` · ${esc(p.nfl)}` : ''}</span>
        </span>
        <b class="wr-hero-pts">${fmt(p.pts)}</b>
    </div>`;
}

function rigaHTML(p, max) {
    const pct = max > 0 ? Math.max(0, Math.round((p.pts / max) * 100)) : 0;
    return `
    <li class="wr-row">
        <span class="wr-row-pos">${esc(p.slot === 'W/R' ? 'FLEX' : (p.slot || p.pos))}</span>
        <span class="wr-row-name">${esc(p.name)}</span>
        <span class="wr-row-bar"><i style="width:${pct}%"></i></span>
        <b class="wr-row-pts">${fmt(p.pts)}</b>
    </li>`;
}

/**
 * Un numero che SCATTA dal valore di prima a quello di dopo, come il
 * tabellone di una classifica: il vecchio esce verso l'alto, il nuovo entra
 * dal basso. Niente card: e' la stessa riga che cambia sotto gli occhi.
 */
function scattoHTML(etichetta, prima, dopo, coda) {
    const uguale = prima === dopo;
    return `
    <div class="wr-move${uguale ? ' is-same' : ''}">
        <span class="wr-move-k">${etichetta}</span>
        <span class="wr-move-val">
            <span class="wr-flip">
                <b class="wr-flip-old">${prima}</b>
                <b class="wr-flip-new">${dopo}</b>
            </span>
            ${coda ? `<span class="wr-move-arrow">${coda}</span>` : ''}
        </span>
    </div>`;
}

function scenaHTML(e) {
    const c = e.classifica;
    const scarto = Math.abs(e.margine);
    const frase = e.esito === 'win' ? `${esc(e.io.nome)} beat ${esc(e.loro.nome)} by <b>${fmt(scarto)}</b>`
        : e.esito === 'loss' ? `${esc(e.io.nome)} fell to ${esc(e.loro.nome)} by <b>${fmt(scarto)}</b>`
            : `${esc(e.io.nome)} and ${esc(e.loro.nome)} finished level`;
    const max = Math.max(...e.io.titolari.map(p => p.pts), 1);
    const posto = (n) => (n ? `#${n}` : '—');
    const freccia = c && c.postoPrima && c.postoDopo !== c.postoPrima
        ? (c.postoDopo < c.postoPrima ? '<i class="wr-su">▲</i>' : '<i class="wr-giu">▼</i>') : '';
    return `
    <div class="wr-glow" aria-hidden="true"></div>
    <div class="wr-fx" aria-hidden="true"></div>
    <div class="wr-stage">
        <span class="wr-kick">${esc(e.etichetta)} · Final</span>
        <div class="wr-score">
            ${latoHTML(e.io, 'wr-side--mia')}
            <span class="wr-dash" aria-hidden="true">–</span>
            ${latoHTML(e.loro, 'wr-side--loro')}
        </div>
        <div class="wr-verdict"><span>${VERDETTO[e.esito]}</span></div>
        <p class="wr-line">${frase}</p>
        ${e.note.length ? `<ul class="wr-notes">${e.note.map(n => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
        <div class="wr-details">
            ${c ? `
            <div class="wr-moves">
                ${scattoHTML('Record', c.recordPrima, c.recordDopo, '')}
                ${scattoHTML('Standings', posto(c.postoPrima), posto(c.postoDopo), freccia)}
            </div>` : ''}
            <div class="wr-heroes">
                ${eroeHTML(e.io.mvp, 'Your MVP', 'wr-hero--mia')}
                ${eroeHTML(e.loro.mvp, 'Their best', 'wr-hero--loro')}
            </div>
            <section class="wr-lineup">
                <h3>Your starters</h3>
                <ol>${e.io.titolari.map(p => rigaHTML(p, max)).join('')}</ol>
                <p class="wr-bench">Bench <b>${fmt(e.io.puntiPanchina)}</b> pts</p>
            </section>
        </div>
        <button type="button" class="wr-go">Go to the site</button>
    </div>`;
}

/* ─── Il racconto ───────────────────────────────────────────────────── */

function dopo(ms, fn) { timers.push(setTimeout(() => { if (overlay) fn(); }, ms)); }

function recita(e) {
    const el = overlay;
    const pts = [...el.querySelectorAll('.wr-pts')];
    if (ridotto()) {
        pts.forEach(b => { b.textContent = fmt(b.dataset.to); });
        el.classList.add('is-score', 'is-verdict', 'is-details', 'is-flip');
        return;
    }
    el.classList.add('is-in');
    dopo(T.punteggio, () => {
        el.classList.add('is-score');
        // I due punteggi salgono INSIEME e alla stessa velocita' in punti:
        // chi ne ha di meno si ferma prima, e da li' si capisce come va a
        // finire un attimo prima del verdetto.
        const massimo = Math.max(...pts.map(b => +b.dataset.to), 1);
        pts.forEach(b => conta(b, +b.dataset.to, T.conta * (+b.dataset.to / massimo)));
    });
    dopo(T.verdetto, () => {
        el.classList.add('is-verdict');
        const vinto = [...pts].reduce((a, b) => (+b.dataset.to > +a.dataset.to ? b : a));
        vinto.closest('.wr-side')?.classList.add('is-winner');
        if (e.esito === 'win') festa(el, e);
        if (e.esito === 'loss') fermaPioggia = pioggia(el.querySelector('.wr-fx'));
    });
    dopo(T.dettagli, () => el.classList.add('is-details'));
    // Prima dello scatto record e classifica TREMANO, sempre piu' forte: il
    // numero vecchio sta per cedere. Solo quelli che cambiano davvero.
    dopo(T.trema, () => el.classList.add('is-shake'));
    dopo(T.scatto, () => { el.classList.remove('is-shake'); el.classList.add('is-flip'); });
}

/** Il numero che sale, rallentando verso la fine come un tabellone vero. */
function conta(b, a, ms) {
    const t0 = performance.now();
    const passo = (t) => {
        if (!b.isConnected) return;
        const k = Math.min(1, (t - t0) / Math.max(ms, 1));
        const v = a * (1 - Math.pow(1 - k, 3));
        b.textContent = fmt(v);
        if (k < 1) requestAnimationFrame(passo);
        else b.textContent = fmt(a);
    };
    requestAnimationFrame(passo);
}

/** Solo per chi vince: fuochi dai lati e coriandoli attorno al verdetto. */
function festa(el, e) {
    const p = TEAM_PALETTE[e.io.chiave] || {};
    const colori = [p.bright || '#f5c518', p.identity || '#f5c518', '#ffffff', '#f5c518'];
    const livello = montaLivello(el.querySelector('.wr-fx'), 'live-fx');
    razziDaiLati(livello, colori, { dura: 5200, ogni: 700 });
    coriandoliAttorno(livello, el.querySelector('.wr-verdict'), colori, { dura: 4200, coriandoli: 90 });
}

/**
 * Per chi perde: gocce d'acqua sul vetro dello schermo.
 *
 * Disegnate su un canvas, non con decine di elementi: ogni goccia e' una
 * piccola lente — ombra sotto, bordo che prende luce, riflesso in alto a
 * sinistra, la luce che si raccoglie sul fondo — ed e' quello che la fa
 * sembrare acqua invece di un pallino. Piove finche' la schermata resta
 * aperta, e ogni goccia scivola giu' appena tocca il vetro, serpeggiando e lasciando
 * dietro di se' goccioline piu' piccole, come sul finestrino. Le gocce stanno SOPRA tutto: e' il vetro, non il palco.
 *
 * Ritorna la funzione che la ferma (chiamata da `chiudiEsito`).
 */
function pioggia(host) {
    if (!host || ridotto()) return null;
    const cv = document.createElement('canvas');
    cv.className = 'wr-rain';
    host.appendChild(cv);
    const ctx = cv.getContext('2d');
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const chiaro = document.documentElement.dataset.theme === 'light';
    let W = 0, H = 0;
    const misura = () => {
        W = host.clientWidth; H = host.clientHeight;
        cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
        cv.style.width = `${W}px`; cv.style.height = `${H}px`;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    misura();
    addEventListener('resize', misura);

    const gocce = [];
    const rnd = (a, b) => a + Math.random() * (b - a);
    const piccolo = W < 600;
    const MAX = piccolo ? 70 : 140;
    const nuova = (x = rnd(0, W), y = rnd(0, H), r = rnd(1.6, piccolo ? 7 : 9)) => {
        if (gocce.length >= MAX) return;
        // Ogni goccia scivola DA SUBITO, senza fermarsi prima: lente le
        // piccole, svelte le grosse. Restano ferme solo le goccioline che le
        // altre si lasciano dietro.
        gocce.push({
            x, y, r, nasce: performance.now(),
            cede: performance.now(),
            vy: 0.06 + r * 0.018, fase: rnd(0, 6.28), scia: 0,
        });
    };

    const disegna = (g, t) => {
        const k = Math.min(1, (t - g.nasce) / 180);          // la goccia "atterra" e si allarga
        const r = g.r * (0.55 + 0.45 * k);
        const ry = r * (g.vy > 0 ? 1.18 : 1);                // scivolando si allunga un poco
        ctx.save();
        // una gocciolina che evapora si spegne nell'ultimo secondo
        if (g.muore) ctx.globalAlpha = Math.max(0, Math.min(1, (g.muore - t) / 1000));
        ctx.translate(g.x, g.y);
        // ombra della lente, spostata in basso
        ctx.fillStyle = chiaro ? 'rgba(40, 50, 60, 0.16)' : 'rgba(0, 0, 0, 0.45)';
        ctx.beginPath(); ctx.ellipse(0, r * 0.28, r * 0.98, ry * 0.98, 0, 0, 6.283); ctx.fill();
        // il corpo: trasparente al centro, piu' denso sul bordo
        const corpo = ctx.createRadialGradient(-r * 0.25, -r * 0.3, r * 0.1, 0, 0, r);
        if (chiaro) {
            corpo.addColorStop(0, 'rgba(255, 255, 255, 0.55)');
            corpo.addColorStop(0.7, 'rgba(170, 190, 205, 0.28)');
            corpo.addColorStop(1, 'rgba(90, 110, 130, 0.5)');
        } else {
            corpo.addColorStop(0, 'rgba(255, 255, 255, 0.04)');
            corpo.addColorStop(0.72, 'rgba(190, 210, 230, 0.10)');
            corpo.addColorStop(1, 'rgba(220, 235, 250, 0.34)');
        }
        ctx.fillStyle = corpo;
        ctx.beginPath(); ctx.ellipse(0, 0, r, ry, 0, 0, 6.283); ctx.fill();
        // la luce raccolta sul fondo
        ctx.strokeStyle = chiaro ? 'rgba(255, 255, 255, 0.85)' : 'rgba(255, 255, 255, 0.32)';
        ctx.lineWidth = Math.max(0.6, r * 0.14);
        ctx.beginPath(); ctx.ellipse(0, 0, r * 0.78, ry * 0.78, 0, 0.35, 2.8); ctx.stroke();
        // il riflesso in alto a sinistra
        ctx.fillStyle = chiaro ? 'rgba(255, 255, 255, 0.95)' : 'rgba(255, 255, 255, 0.75)';
        ctx.beginPath(); ctx.ellipse(-r * 0.36, -ry * 0.42, r * 0.22, r * 0.13, -0.6, 0, 6.283); ctx.fill();
        ctx.restore();
    };

    const t0 = performance.now();
    // Piove finche' la schermata resta aperta: un ritmo costante dopo il
    // primo scroscio, piu' fitto sullo schermo largo.
    const RITMO = piccolo ? 0.16 : 0.3;      // probabilita' di una goccia nuova a fotogramma
    let ultimo = t0, raf = 0, vivo = true;
    // primo scroscio, subito
    for (let i = 0; i < (piccolo ? 22 : 40); i++) nuova();

    const giro = (t) => {
        if (!vivo || !cv.isConnected) return;
        const dt = Math.min(50, t - ultimo);
        ultimo = t;
        if (Math.random() < RITMO) nuova();
        ctx.clearRect(0, 0, W, H);
        for (let i = gocce.length - 1; i >= 0; i--) {
            const g = gocce[i];
            if (g.muore && t > g.muore) { gocce.splice(i, 1); continue; }
            if (t > g.cede) {
                // scivola: accelera fino a una velocita' di crociera e serpeggia
                g.vy = Math.min(g.vy + 0.0009 * dt, 0.18 + g.r * 0.03);
                g.y += g.vy * dt;
                g.fase += dt * 0.004;
                g.x += Math.sin(g.fase) * 0.12;
                g.scia += g.vy * dt;
                // si lascia dietro una gocciolina ogni tanto, e si consuma
                if (g.scia > rnd(14, 30)) {
                    g.scia = 0;
                    // le goccioline della scia evaporano dopo qualche
                    // secondo: restando tutte, riempirebbero il vetro e la
                    // pioggia nuova non avrebbe piu' posto
                    if (gocce.length < MAX) gocce.push({ x: g.x + rnd(-1, 1), y: g.y - g.r * 1.4, r: rnd(0.8, 1.8), nasce: t - 200, cede: Infinity, vy: 0, fase: 0, scia: 0, muore: t + rnd(2500, 5000) });
                    g.r = Math.max(2.2, g.r * 0.97);
                }
                if (g.y - g.r > H) { gocce.splice(i, 1); continue; }
            }
            disegna(g, t);
        }
        raf = requestAnimationFrame(giro);
    };
    raf = requestAnimationFrame(giro);

    return () => {
        vivo = false;
        cancelAnimationFrame(raf);
        removeEventListener('resize', misura);
        cv.remove();
    };
}

/** Le foto dei due migliori, dalla stessa fonte del resto del sito. */
function idrataFoto(root, year) {
    root.querySelectorAll('img[data-wr-foto]').forEach(img => {
        img.onerror = () => { img.onerror = null; img.src = 'images/fallback-player.svg'; };
        playerImageService.getPlayerImageUrl(img.dataset.name, img.dataset.nfl, img.dataset.pos, year)
            .then(url => { if (url) img.src = url; }).catch(() => {});
    });
}


/* ============================================================
   L'AVVIO — il sipario sincrono, poi i dati, poi la scena
   ============================================================ */

let sipario = null;

/**
 * Il punto d'ingresso, chiamato da `boot()` in app.js SUBITO DOPO
 * `avviaNightRecap()`.
 *
 * Come per il Night Recap, la suspense e' tutta nel non vedere il risultato
 * prima: la home lo mostra nel banner. Quindi il sipario (lo stesso
 * "Loading..." del sito) si alza SUBITO e senza rete, se `valeControllare()`
 * dice che una giornata nuova potrebbe essere stata chiusa; i dati arrivano
 * dietro e, se non c'e' niente da mostrare, il sipario si abbassa da solo.
 *
 * Il sipario sta SOTTO quello del Night Recap (z-index piu' basso): se partono
 * tutti e due, il replay della notte va in onda sopra, e quando si chiude
 * sotto c'e' gia' questo — mai la home col risultato in vista.
 */
export function avviaEsitoSettimana() {
    if (!squadraPreferita()) return;
    if (!valeControllare()) return;
    sipario = document.createElement('div');
    sipario.className = 'wr-overlay wr-overlay--sipario';
    sipario.setAttribute('role', 'dialog');
    sipario.setAttribute('aria-label', 'Loading');
    sipario.innerHTML = `<div class="loading-state"><div class="spinner"></div><p>Loading...</p></div>`;
    document.body.appendChild(sipario);
    document.body.classList.add('wr-open');
    risolvi().catch(err => {
        console.warn('[final-whistle] interrotto:', err?.message || err);
        abbassaSipario();
    });
}

function abbassaSipario() {
    const el = sipario;
    sipario = null;
    if (!overlay) document.body.classList.remove('wr-open');
    if (!el) return;
    el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 260, fill: 'forwards' }).onfinish = () => el.remove();
}

async function risolvi() {
    const chiave = squadraPreferita();
    const anno = CURRENT_SEASON;
    const data = await fetchFantasyData(anno);
    const week = ultimaGiornataChiusa(data);
    segnaControllato();
    if (!week) return abbassaSipario();

    const s = segnalibroEsito();
    const questa = chiaveGiornata(anno, week);
    if (s.visto && !piuNuova(questa, s.visto)) return abbassaSipario();     // gia' vista
    // Prima volta su questo dispositivo: solo se e' la giornata appena chiusa.
    if (!s.visto && !primaVoltaMostrabile()) {
        segnaEsitoVisto(anno, week);
        return abbassaSipario();
    }
    const e = esitoSettimana(data, anno, week, chiave, displayName);
    if (!e) {                       // quella giornata la mia squadra non giocava (bye dei playoff)
        segnaEsitoVisto(anno, week);
        return abbassaSipario();
    }
    await finitoNightRecap();
    mostraEsito(e, { onChiudi: () => segnaEsitoVisto(anno, week) });
    abbassaSipario();
}

/**
 * Aspetta che il Night Recap non sia piu' a schermo (il suo sipario o la sua
 * scena: tutti e due sono `.nr-overlay`). Se non e' mai partito, risolve
 * subito. Si guarda il DOM e non un evento suo: cosi' il Night Recap non
 * deve sapere che questa schermata esiste.
 */
function finitoNightRecap() {
    if (!document.querySelector('.nr-overlay')) return Promise.resolve();
    return new Promise(ok => {
        const oss = new MutationObserver(() => {
            if (document.querySelector('.nr-overlay')) return;
            oss.disconnect();
            ok();
        });
        oss.observe(document.body, { childList: true });
    });
}
