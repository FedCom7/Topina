/**
 * Costanti di lega per gli script Node.
 *
 * Sono le stesse di js/data.js e js/data/team-config.js, DUPLICATE apposta:
 * `js/data.js` ha un top-level await contro Firebase RTDB e importa l'SDK da
 * gstatic.com, quindi da Node non si può importare. Duplicare qui — in un posto
 * solo, invece che dentro ogni builder — è il male minore.
 *
 * Se cambiano i nomi squadra su Firebase, vanno cambiati in tutti e due i posti.
 */

export const SEASONS = ['2019', '2020', '2021', '2022', '2023', '2024', '2025'];

export const NUM_TEAMS = 4;

/** chiave grezza Firebase → nome visualizzato */
export const TEAM_DISPLAY = {
    riccardo97com: 'Oscurus',
    lasers: 'Lasers',
    FedCom: 'Sommo',
    'Capi dei Pianeti': 'Capi dei Pianeti',
};

/** nome visualizzato → chiave breve (quella delle route e dei loghi) */
export const TEAM_KEYS = {
    'Capi dei Pianeti': 'capi',
    Lasers: 'lasers',
    Oscurus: 'oscurus',
    Sommo: 'sommo',
};

/** ordine stabile: i report e i test iterano sempre così */
export const TEAM_KEY_LIST = ['capi', 'lasers', 'oscurus', 'sommo'];

/** chiave grezza (o nome già visualizzato) → chiave breve; null se sconosciuta */
export function keyOf(raw) {
    return TEAM_KEYS[TEAM_DISPLAY[raw] || raw] || null;
}
