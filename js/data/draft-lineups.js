/**
 * Formazioni ricavate dal draft, per il periodo in cui ESPN non ne ha ancora.
 *
 * Prima che la lega drafti, l'API fantasy riempie le quattro squadre di rose
 * segnaposto: 62 giocatori con `acquisitionType: null`, scelti da ESPN e non
 * da nessun GM, che verranno spazzati via appena il draft si fa. Mostrarli
 * significa raccontare una lega che non esiste.
 *
 * Se però il draft dell'anno è già su Firebase — durante il collaudo è quello
 * di prova — allora le rose vere le abbiamo: sono le scelte. Questo modulo le
 * trasforma nella stessa forma che produce `espn-fantasy.js`, così tutto il
 * resto della pagina (tabellino, punti dal box score, card, confronto) continua
 * a funzionare senza sapere da dove arrivano i giocatori.
 *
 * Qui non si calcolano né punti né proiezioni: i giocatori escono a zero e
 * senza stime. Ci pensano i due riempitivi generici del Live, gli stessi che
 * valgono per qualunque giocatore a schermo — `fillFromEspn()` per i punti dal
 * tabellino, `fillMissingProjections()` per le proiezioni mancanti.
 */

import { displayName } from '../data.js?v=540';

/**
 * Titolari: nove maglie, nell'ordine in cui il campo se le aspetta.
 *
 * Il flex si chiama `W/R`, non `RB/WR` né `FLEX`: è l'etichetta che ESPN dà
 * allo slot 3 e che `espn-fantasy.js` riporta nei dati. Chiamandolo in un
 * altro modo il campo lo trovava lo stesso (accetta più forme) ma il confronto
 * e la lista sotto no, e la riga del flex restava vuota ovunque.
 */
const SLOT_TITOLARI = ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'W/R', 'K', 'DEF'];

const norm = (s) => String(s || '').trim().toLowerCase();

/** Le scelte di ogni squadra, sotto il nome con cui la pagina la conosce. */
function pickPerSquadra(draft) {
    const out = new Map();
    for (const [chiave, scelte] of Object.entries(draft?.teams || {})) {
        if (!Array.isArray(scelte) || !scelte.length) continue;
        out.set(norm(displayName(chiave)), [...scelte].sort((a, b) => (a.pick || 0) - (b.pick || 0)));
    }
    return out;
}

/**
 * Dalle quindici scelte alla formazione: i primi di ogni ruolo in campo, il
 * resto in panchina. L'ordine di chiamata fa da gerarchia — chi è stato preso
 * prima parte titolare, che è come ragiona chi ha draftato.
 */
function formazione(scelte) {
    const liberi = scelte.map(s => ({
        name: s.name,
        position: (s.position || '').toUpperCase(),
        nfl_team: s.nfl_team || '',
        pick: s.pick,
    }));

    const starters = [];
    for (const slot of SLOT_TITOLARI) {
        const i = liberi.findIndex(p => slot === 'W/R'
            ? (p.position === 'RB' || p.position === 'WR')
            : p.position === slot);
        if (i < 0) continue;
        const p = liberi.splice(i, 1)[0];
        // `position` è lo slot occupato, `position_in_team` il ruolo vero: è la
        // stessa distinzione che fa espn-fantasy.js, e le statistiche mostrate
        // seguono il secondo.
        starters.push({ ...p, position: slot, position_in_team: p.position });
    }

    const vestiti = (p) => ({
        position: p.position,
        position_in_team: p.position_in_team || p.position,
        name: p.name,
        nfl_team: p.nfl_team,
        opponent: '',
        status: '',
        fantasy_points: '0.00',
        stats: {},
        injury_status: 'NORMAL',
        locked: false,
        started: false,
    });

    return { starters: starters.map(vestiti), bench: liberi.map(vestiti) };
}

/**
 * Sostituisce le rose segnaposto con quelle del draft, in posto.
 * Ritorna true se ha davvero rimpiazzato qualcosa.
 */
export function applyDraftLineups(matchups, draft) {
    const perSquadra = pickPerSquadra(draft);
    if (!perSquadra.size) return false;

    let fatto = false;
    for (const m of matchups || []) {
        for (const lato of ['team1', 'team2']) {
            const t = m[lato];
            const scelte = t && perSquadra.get(norm(displayName(t.name)));
            if (!scelte) continue;
            const { starters, bench } = formazione(scelte);
            if (!starters.length) continue;
            t.starters = starters;
            t.bench = bench;
            t.score = '0.00';
            t.projected_score = null;   // le riempie fillMissingProjections
            fatto = true;
        }
    }
    return fatto;
}
