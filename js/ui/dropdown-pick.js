/**
 * Selettore a capsula con tendina: stessa interazione dello switch squadra
 * del Live (una capsula con la scelta corrente, il resto in una tendina che
 * si apre e chiude a clic), ma generico — qui serve per anno, week, round,
 * squadra in Game Center, Draft e Analysis.
 */
export function pickDropdownHTML(id, items, activeIdx) {
    const scelta = items[activeIdx] ?? items[0];
    if (!scelta) return '';
    return `
    <div class="pick-dd" data-pick-id="${id}">
        <button class="year-pill pick-dd-btn" type="button" data-pick-btn
                aria-haspopup="listbox" aria-expanded="false">
            ${scelta.label}
            <span class="pick-dd-caret" aria-hidden="true">▾</span>
        </button>
        <div class="pick-dd-menu" role="listbox" hidden>
            ${items.map((it, i) => `
            <button class="pick-dd-item${i === activeIdx ? ' is-on' : ''}" type="button"
                    role="option" aria-selected="${i === activeIdx}" data-value="${it.value}">
                ${it.label}
            </button>`).join('')}
        </div>
    </div>`;
}

/** `onPick(pickId, value)` viene chiamato scegliendo una voce dalla tendina. */
export function bindPickDropdown(container, onPick) {
    container.querySelectorAll('.pick-dd').forEach(box => {
        const capsula = box.querySelector('[data-pick-btn]');
        const menu = box.querySelector('.pick-dd-menu');
        const apri = (si) => {
            menu.hidden = !si;
            capsula.setAttribute('aria-expanded', String(si));
            box.classList.toggle('is-open', si);
        };
        capsula.addEventListener('click', (e) => {
            e.stopPropagation();
            const apre = menu.hidden;
            apri(apre);
            // un clic fuori chiude, come nel Live
            if (apre) {
                document.addEventListener('click', (ev) => {
                    if (!box.contains(ev.target)) apri(false);
                }, { once: true });
            }
        });
        menu.querySelectorAll('[data-value]').forEach(b =>
            b.addEventListener('click', () => { apri(false); onPick(box.dataset.pickId, b.dataset.value); }));
    });
}
