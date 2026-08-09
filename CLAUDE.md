# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Topina League is an Italian-language fantasy football (NFL) statistics website for a 4-team league running since 2019. It's a static SPA hosted on GitHub Pages with Firebase Realtime Database as the backend.

**Teams:** Capi dei Pianeti, Lasers, Oscurus, Sommo
**Seasons:** 2019–2025

## Development

This is a **no-build static site** — open `html/index.html` directly in a browser or use any local HTTP server. There is no bundler, framework, or compilation step.

```bash
# Install dependencies (only needed for data upload scripts)
npm install

# Upload local JSON data to Firebase RTDB
npm run upload-data    # requires FIREBASE_SERVICE_ACCOUNT env var
```

There are no tests or linters configured.

## Architecture

### SPA Routing (`js/app.js`)
Hash-based router mapping `#section-name` to lazy-init functions. Each section initializes only once on first visit. Six sections: home, game-center, standings, draft, stats, history.

### Data Layer (`js/data.js`)
All Firebase RTDB reads go through this module. Key exports:
- `fetchFantasyData(season)` / `fetchDraftData(season)` / `fetchAllTimeStats()` — fetch with 10s timeout
- `processStandings(data, year)` — calculates W-L-PF-PA-streak from regular season only (excludes playoffs/SB)
- `getSeasonConfig(year)` — returns week boundaries; **2021 is a special case** (16 regular + week 17 playoffs + week 18 SB vs standard 15 + 16 + 17)
- `getSuperBowlMatchup(data, year)` — finds SB by first identifying playoff winners
- `displayName(raw)` — maps Firebase team keys to display names

### Data Flow
Firebase RTDB → `data.js` fetch/process → `sections/*.js` render to DOM

**Chi scrive su Firebase: solo l'Action `espn-live.yml`**, una volta a
settimana (martedì 09:00 UTC, dopo il Monday Night Football). Esegue
`scraper/run_espn.py` e carica il risultato CHIUSO della giornata. È l'unico
produttore: non aggiungerne altri, perché scrivono sugli stessi nodi e l'ultimo
sovrascrive l'altro (successo il 2026-08-04). `deploy-data.yml` resta
disattivato sull'automatico, solo avvio manuale per ricaricare gli storici.

**Prima del draft non si scrive niente.** Finché la lega non ha draftato, ESPN
riempie le squadre di rose segnaposto (`acquisitionType: null`): giocatori che
non sono di nessuno. `run_espn.py` se ne accorge da `draft_espn.draft_is_done()`
ed esce senza toccare né Firebase né `data/`; Live e Game Center le nascondono a
loro volta (vedi sotto). La seconda Action, `espn-draft-watch.yml`,
gira a mezzanotte nelle due settimane prima della week 1 con `WATCH_DRAFT=1`:
appena il draft esiste fa il sync completo e committa i JSON, e il file
committato è ciò che fa uscire subito le esecuzioni dei giorni dopo. Sta nello
stesso `concurrency: espn-sync` dell'altra.

**Le rose segnaposto di ESPN non si mostrano mai.** Finché la lega non ha
draftato, Live e Game Center buttano via quelle rose e compongono le formazioni
dalle scelte del draft su Firebase (`js/data/draft-lineups.js`). I numeri li
mettono poi i due riempitivi generici, che valgono per qualunque giocatore a
schermo: `fillFromEspn()` per i punti dal tabellino ufficiale e
`fillMissingProjections()` per le proiezioni. Quest'ultima non fa nulla quando
le formazioni vengono dalle rose ESPN, perché lì la proiezione arriva già nella
risposta della lega (27 KB); parte solo se un TITOLARE ne è privo, e legge il
listone di tutti i giocatori — 630 KB, quindi al massimo una volta al minuto,
mentre punti e statistiche restano sui dieci secondi.

**Proiezioni: fino al kickoff sono il punteggio, dopo sono un riferimento.**
Appena una partita dei nostri comincia (`giornataCominciata`, dal tabellone
NFL) il tabellone passa ai punti veri per TUTTI, zeri compresi. La previsione
non sparisce: resta in piccolo accanto al numero — sulle card, nel banner e
nella scheda del giocatore, dove ogni statistica porta accanto la sua. Il
numero vero sta sempre in un `<span class="pts-val">` a sé, perché le
animazioni di conteggio scrivono lì dentro e cancellerebbero la proiezione.

Se non c'è nemmeno il draft — o se nessuna fonte risponde — il campo si vede lo
stesso: nove maglie titolari e sei posti in panchina con la sagoma grigia,
trattini al posto di nome, punti e statistiche. Vale sia sul percorso ESPN sia
sul ripiego da Firebase.

**Draft di prova, TEMPORANEO — da cancellare a fine preseason 2026.**
`scripts/espn/draft_demo.py` (`carica` / `mostra` / `cancella`) scrive sul nodo
VERO `draft/draft_data_<anno>`, non su un nodo separato: il sito deve
comportarsi esattamente come a draft fatto. I giocatori sono le RISERVE prese
dalle depth chart ESPN — in preseason i titolari fanno una serie e si siedono —
scartando comunque le prime 150 scelte fantasy. Va
solo su Firebase, mai in `data/draft/`, altrimenti la sentinella salterebbe il
draft vero. Rimuoverlo con `cancella` appena finiscono i test.

**Il sito non aspetta Firebase per il live.** Da quando la lega ESPN è pubblica
(agosto 2026) l'API risponde senza cookie e con CORS aperto, quindi il browser
la legge da solo:

- `js/data/espn-fantasy.js` — lega, formazioni, proiezioni e punti ufficiali.
  Fonte primaria di `#live` (ogni 10s) e del Game Center sulla stagione in corso.
  È il porto in JS di `scraper/espn/{maps,normalize}.py`: se cambia una delle
  due, allineare l'altra.
- `js/data/nfl-plays.js` — play-by-play per le card delle giocate.
- `js/data/espn-boxscore.js` — rete di sicurezza: ricompone i totali dal
  tabellino ufficiale se una partita è iniziata ma i punti non arrivano.
  Validato sull'intera stagione 2025 con `scripts/espn/validate_boxscore.py`.
  Dalla stessa risposta ricava anche `usage`: bersagli, ricezioni e portate di
  ogni giocatore squadra per squadra, che alimentano il "dentro la partita" del
  Live — per ogni squadra NFL in cui ho qualcuno, chi sta prendendo i palloni e
  quanti punti sta facendo, col mio in evidenza (e in coda, spento, se nel
  tabellino non compare affatto). Dalla stessa risposta arrivano `teamStats` e
  `oppStats`, il confronto di squadra sotto ogni partita. Nessuna richiesta in
  più.

Firebase resta l'archivio: settimane chiuse e stagioni 2019-2025.

### Team Name Mapping
Firebase stores team names differently from display names (e.g., `riccardo97com` → `Oscurus`, `FedCom` → `Sommo`). Mapping lives in `data.js:TEAM_DISPLAY_NAMES`. Team keys, logos, and stadium images are in `js/data/team-config.js`.

### Cache Busting
ES module imports use query string versioning (`?v=28`). Bump the version number when changing a module to bust browser cache.

### Key Directories
- `js/sections/` — one file per SPA section, each exports an `initXxx()` function
- `js/data/` — team config, player mappings, Firebase data helpers
- `js/services/` — player image resolution (ESPN/Sleeper API with localStorage cache)
- `data/fantasy/` — season JSON files (`fantasy_data_YYYY.json`), uploaded to Firebase via CI
- `data/draft/` — draft JSON files
- `scripts/` — Node.js and Python utilities for data upload, API inspection, image validation
- `Wallpapers/` — Game Center field backgrounds named `GameCenterHorizontal_{TEAM1}_{TEAM2}.png`
- `Team Logo/` — team logos named `team_{key}_transparent.png`

### CI/CD
GitHub Actions workflow (`.github/workflows/deploy-data.yml`) auto-uploads data to Firebase RTDB when files in `data/` change on main. Uses `FIREBASE_SERVICE_ACCOUNT` secret.

## Conventions

- **Everything the site shows is in English** — titoli, etichette, messaggi.
  I commenti nel codice restano in italiano. Restano in italiano anche alcune
  sezioni scritte prima di questa regola (`magazine.js`, parti di `game.js`,
  `player-page.js`, `nfl-team-page.js`): vanno tradotte quando ci si mette mano.
- All CSS is in a single `css/main.css` file (no preprocessor)
- Firebase SDK loaded via CDN ESM imports, not npm
- Sections use a `loaded` flag to prevent re-initialization
- Image paths with spaces (e.g., `Team Logo/`) must be URL-encoded when used in CSS/HTML