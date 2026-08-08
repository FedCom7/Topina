/**
 * Elezioni Hall of Fame — logica di ballottaggio condivisa tra la sezione
 * dedicata (js/sections/halloffame.js) e chiunque altro debba sapere se un
 * giocatore è stato eletto (es. player-modal.js per la card dorata).
 *
 * Un giocatore è eleggibile 2 anni pieni dopo l'ultima apparizione nei dati
 * (classe X → ritirati entro X-3), con almeno MIN_SEASONS stagioni in lega,
 * DEF escluse. Ballottaggio cumulativo: chi non viene eletto resta candidato
 * negli anni successivi. Un eletto all'anno dal FIRST_CLASS_YEAR.
 */

import { SEASONS, CURRENT_SEASON } from '../data.js?v=33';
import { getHonorsBundle } from './honors.js?v=57';
import { buildCareers } from './careers.js?v=58';

export const FIRST_CLASS_YEAR = 2025;
export const MIN_SEASONS = 3;
const SB_BONUS = 120;
const TOP1_BONUS = 80;
const ALLPRO1_BONUS = 120;
const ALLPRO2_BONUS = 60;

let _classes = null;

function electClasses(careers) {
    const classes = [];
    const inducted = new Set();

    for (let year = FIRST_CLASS_YEAR; year <= Number(CURRENT_SEASON); year++) {
        const cutoff = String(year - 3);

        const ballot = [...careers.values()].filter(c =>
            c.position !== 'DEF' &&
            c.lastSeason <= cutoff &&
            c.seasons.size >= MIN_SEASONS &&
            !inducted.has(c.name)
        );

        if (!ballot.length) {
            classes.push({ year, inductee: null });
            continue;
        }

        const scored = ballot.map(c => {
            const score = c.totPts
                + SB_BONUS * c.sbWins
                + TOP1_BONUS * c.top1Count
                + ALLPRO1_BONUS * c.firstTeam
                + ALLPRO2_BONUS * c.secondTeam;
            return { career: c, score };
        }).sort((a, b) => b.score - a.score);

        const winner = scored[0];
        inducted.add(winner.career.name);
        classes.push({ year, inductee: winner.career });
    }

    return classes;
}

/** Classi di elezione (FIRST_CLASS_YEAR → oggi): [{year, inductee|null}]. Cache in memoria. */
export async function electHallOfFame() {
    if (_classes) return _classes;
    // buildCareers popola già firstTeam/secondTeam (oltre a mvp, sbWins, top1)
    const careers = await buildCareers();
    return (_classes = electClasses(careers));
}

/** Anno di elezione del giocatore (nome esatto), o null se non eletto. */
export async function getHallOfFameYear(name) {
    const classes = await electHallOfFame();
    return classes.find(cl => cl.inductee?.name === name)?.year ?? null;
}
