/**
 * Score bug ATTUALE — il banner che il sito disegna oggi.
 *
 * È il `.gc-banner` che si vede in cima a `#live`: nomi ai lati, i due totali
 * grandi, "live/vs" in mezzo, gli stemmi in filigrana e la barra della quota
 * appoggiata al bordo basso. Stava dentro `live.js:matchupCardHTML`; è uscito
 * di lì per una ragione sola: poterlo guardare e modificare nel banco di prova
 * (`preview-scorebug.html`) senza doverne tenere una copia. Una copia sarebbe
 * andata alla deriva al primo ritocco, e il banco avrebbe mostrato un
 * tabellone che il sito non ha.
 *
 * Non va confuso con `js/ui/score-bug.js`: quello è la PROPOSTA (broadcast,
 * marquee, ticker) e non è ancora collegato a niente. Questo è il tabellone in
 * produzione — chi lo tocca cambia quello che si vede la domenica sera.
 *
 * Contratto come gli altri pezzi di `js/ui/`: entra un oggetto piatto, esce
 * una STRINGA HTML, niente da idratare dopo l'inserimento. Il modulo NON
 * importa `data.js`: i nomi arrivano già in HTML (`teamNameHTML()` li prepara
 * per `refitTeamNames()`), così il banco di prova può importarlo senza tirarsi
 * dietro la connessione a Firebase.
 *
 * Due ganci che l'aggiornamento in place cerca e che quindi non si rinominano
 * a cuor leggero:
 *   `.gc-banner-score`  — live.js ci rimette la classe `winner` a ogni giro
 *   `.pts-val`          — `countUp()` anima scrivendo QUI dentro, e la
 *                         proiezione (`.pts-proj`) gli resta fuori: dentro, il
 *                         primo fotogramma dell'animazione se la mangerebbe.
 */

/**
 * @param {object} m
 * @param {{nameHTML:string, logo?:string, color?:string, scoreHTML:string,
 *          winner?:boolean, selected?:boolean}} m.left   squadra di sinistra
 * @param {object} m.right                                idem, a destra
 * @param {string} [m.mid='vs']    la scritta piccola in mezzo ('live' o 'vs')
 * @param {number|null} [m.probPct] quota del lato sinistro, 0-100; null o
 *                                  assente = niente barra
 * @param {string} [m.selColor]    colore del contorno sul nome selezionato
 * @returns {string} HTML
 */
export function currentScoreBugHTML(m) {
    const { left, right, mid = 'vs', probPct = null } = m;
    const c1 = left.color || 'var(--accent-red)';
    const c2 = right.color || 'var(--accent-blue)';
    const sel = m.selColor || (right.selected ? c2 : c1);
    const pct = probPct == null ? null : Math.max(0, Math.min(100, Math.round(probPct)));

    return `
    <div class="live-scorebar" style="--tc1:${c1};--tc2:${c2};--tc-sel:${sel}">
        <div class="gc-banner">
            ${left.logo ? `<img class="gc-banner-wm gc-banner-wm-l" src="${left.logo}" alt="" aria-hidden="true">` : ''}
            ${right.logo ? `<img class="gc-banner-wm gc-banner-wm-r" src="${right.logo}" alt="" aria-hidden="true">` : ''}
            <div class="gc-banner-inner">
                <div class="gc-banner-side">
                    <span class="gc-banner-name${left.selected ? ' live-name-selected' : ''}">${left.nameHTML}</span>
                </div>
                <span class="gc-banner-score${left.winner ? ' winner' : ''}">${left.scoreHTML}</span>
                <div class="gc-banner-mid">
                    <span class="gc-banner-vs">${mid}</span>
                </div>
                <span class="gc-banner-score${right.winner ? ' winner' : ''}">${right.scoreHTML}</span>
                <div class="gc-banner-side gc-banner-side-r">
                    <span class="gc-banner-name${right.selected ? ' live-name-selected' : ''}">${right.nameHTML}</span>
                </div>
            </div>
            ${pct == null ? '' : `
            <div class="live-mc-prob">
                <span class="live-mc-probpct">${pct}%</span>
                <span class="live-mc-probbar"><i class="live-mc-probfill" style="width:${pct}%"></i></span>
                <span class="live-mc-probpct live-mc-probpct--r">${100 - pct}%</span>
            </div>`}
        </div>
    </div>`;
}
