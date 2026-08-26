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
- `fetchFantasyData(season)` / `fetchDraftData(season)` — fetch with 10s timeout,
  **con cache condivisa**: una stagione chiusa non cambia più e si tiene per
  sempre, quella in corso scade dopo 5 minuti. Senza, la stessa stagione veniva
  riscaricata 3 volte da Stats e 4 volte in una sessione fra le sezioni (8,7 MB
  dal websocket per dati identici). In cache va la *promessa*, così anche le
  richieste partite insieme si agganciano alla prima.
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
mentre punti e statistiche seguono il polling della pagina (30 s).

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
`scripts/espn/draft_demo.py` **non è versionato** (sta nel `.gitignore`): scrive
sul nodo vero del draft, e nel repo sarebbe un modo per sovrascrivere il draft
della lega per sbaglio. Vive solo sulla macchina di chi lo usa.
Con `carica` / `mostra` / `cancella` scrive sul nodo
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
  Fonte primaria di `#live` (polling ogni 30s, `POLL_MS` in `live.js`; stesso
  passo per il play-by-play) e del Game Center sulla stagione in corso.
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

### Area Draft — tre sezioni sorelle

Il dropdown "Draft" del nav ha tre voci, tutte con `NAV_PARENT → 'draft'`:
`#draft` (Draft Recap, `sections/draft.js`), `#draftgrades` (le pagelle,
`sections/draftgrades.js` + la pagina squadra `draftgrade-team.js`) e
`#projections` (`sections/projections.js`).

**Projections è il listone in chiaro**: le stesse proiezioni Sleeper/Rotowire
che alimentano `draft-grade.js`, per ruolo e in ordine di punti, con ADP e chi
ha preso chi. Esiste perché un voto si possa contestare guardando i numeri veri.
Se cambia il modo in cui il motore valorizza una pick, questa tabella va
allineata — altrimenti mostra numeri che non sono quelli usati per votare.
I kicker restano senza punti (Sleeper non li proietta a livello stagionale) e
si ordinano per ADP: il fallback storico da 125 pt vive solo dentro al motore,
a schermo sarebbe un numero inventato.

### Draft Grade — un voto solo, e deve restare uno

Il motore è `js/data/draft-grade.js`. Sostituisce due motori precedenti che
convivevano sulla stessa pagina (il "ratio vs slot atteso" e il Draft Score v2)
ed erano **scorrelati fra loro**: ρ 0.147 su 419 pick, 86% di disaccordo sulla
posizione di lega, con casi A+ contro F sullo stesso giocatore. Nessuno dei due
correlava con la stagione vera (ρ +0.03 e +0.11 contro i punti fatti).

Regole da non violare aggiungendo roba a questa pagina:

1. **Una sola cosa a schermo ha la forma "lettera".** Il voto. Tutto il resto —
   talento, efficienza, resa di fine stagione, TSI, SOS+, risk — sono NUMERI.
   L'ambiguità "quale voto guardo?" nasceva dall'avere più pagelle affiancate.
2. **La pick si giudica sul contro-fattuale, non sullo slot.** Il valore
   catturato rispetto a quello che ti aspettava comunque al turno successivo.
   Baseline diverse (es. "l'N-esimo miglior valore del pool") reintroducono la
   deriva di giro: il vecchio voto v1 correlava +0.39 col numero del giro, e
   nessuna pick di 1°/2° giro prendeva mai A+ mentre il 54% di quelle del 15° sì.
3. **Due livelli di replacement, distinti apposta.** `replacementLevels`
   (team-eval) = ultimo titolare di lega, per il TALENTO. `waiverLevels`
   (draft-grade) = miglior non draftato, per il voto delle singole pick. In una
   lega a 4 squadre il primo è così alto che dal 7° giro azzera il VOR di tutti.
4. **Le soglie-lettera sono quantili empirici**, generati da
   `node scripts/build-draft-grade-calib.mjs` → `data/model/draft_grade_calib.json`.
   Lo script deve valorizzare le pick **esattamente come il sito** (blend storico
   K/DEF compreso): calibrare su una distribuzione diversa da quella votata
   sbaglia le lettere ai bordi. Lo script stampa anche il backtest contro i punti
   veri — se `meanGradeRho` va sotto zero, il motore è rotto, non i pesi.
5. I pesi talento/efficienza (0.6/0.4) sono una **scelta di design dichiarata**,
   non una taratura: con 28 team-stagione non è tarabile, e la nota a fondo
   pagina lo dice.
6. **Il numero mostrato non è il punteggio interno.** Dentro si ragiona in
   percentili (media storica ≈ 47); a schermo passa da `displayScore()`, che
   rimappa la fascia della lettera sugli ancoraggi di una pagella (A+ = 97 …
   D = 65). È una trasformazione monotona: l'ordine non cambia mai. Serve
   perché "A- · 65/100" si leggeva come una sufficienza risicata. Ogni nuovo
   punto a schermo deve usare `.grade`, mai `.score`.
7. **La sopravvivenza è TARATA, non a sentimento.** Validata su 420 pick e
   7350 coppie (per ogni pick, ogni candidato serio: è davvero arrivato al
   turno dopo?). Cosa dicono i numeri:
   - l'avversario si modella sull'**ordine di mercato (ADP) spinto dal
     fabbisogno**, mai sul VOR. Prevedere la scelta vera dell'avversario:
     VOR need-adjusted log-loss 5.306 / azzecca 14.5%; ADP puro 4.760 / 16.0%;
     **ADP + spinta need 4.632 / 16.9%** ← quella in uso. I drafter seguono il
     listone e lo piegano ai buchi di rosa, non calcolano il valore sopra il
     replacement — col VOR il motore preferiva un RB a un WR che proiettava di
     più e aveva un ADP migliore.
   - l'ADP porta quasi tutta la capacità di distinguere chi resta; il need ne
     aggiunge poca. Perciò `NEED_WEIGHT` sta a **0.25**.
   - **niente ricalibrazione a esponente.** Una versione precedente alzava le
     probabilità per far combaciare la media col tasso base (86% dei candidati
     sopravvive) e spostava la soglia a 0.88. Schiacciava tutto verso 1 e
     rendeva un testa-o-croce indistinguibile da una certezza, proprio sui
     giocatori di testa del board che sono gli unici che contano. Ora la soglia
     è 0.5, la stima resta un po' pessimista, e la **percentuale si mostra a
     schermo** in tre fasce (`survivalBand`: gone / tossup / lasted) invece di
     un sì/no che il modello non ha i numeri per sostenere.
   Se tocchi questi parametri rifai il test: qui l'intuito ha sbagliato più
   volte, la mia compresa.
8. Il verdetto "potevi aspettare sul TE/QB?" (`positionalStrategy`) confronta
   **due piani su due turni**, mai VOR assoluti. Confrontare il giocatore preso
   col miglior altro-ruolo che spariva dava "troppo presto" su ogni singola
   pick, prima compresa: al primo giro sparisce sempre qualcuno di enorme.

### localStorage: tutto passa da `js/utils/storage.js`

Le cache del browser hanno spento il sito una volta (2026-08-23) e possono
rifarlo. L'SDK Firebase scrive `firebase:previous_websocket_failure` dentro
`WebSocketConnection.open` **senza try/catch**: a storage pieno quella setItem
lancia, la open si interrompe, il websocket non si apre e *ogni*
`fetchFantasyData` va in timeout — home, standings, storico, tutto vuoto. Le
nostre cache invece la quota la ignoravano (setItem già protette), quindi si
prendevano tutto lo spazio e a pagarla era l'unico che non sa difendersi.

Chi riempiva: la cache delle proiezioni Sleeper pesava **3,5 MB per anno**, di
cui l'86% varianti di ADP che non leggiamo (dynasty, 2QB, IDP, rookie, std,
half-PPR); le pagine giocatore aggiungevano una chiave per giocatore per
stagione, senza limite. Misurato su una pagina QB: 10,2 MB occupati.

Regole:

1. **Niente `localStorage` diretto per le cache.** Si usano `cacheGet(key, ttl)`
   e `cacheSet(key, data)`: tengono sempre libera una riserva per l'SDK e
   sfrattano da soli. Fa eccezione solo `topina-live-preseason` in `live.js`,
   che è un flag da pochi byte e non una cache.
2. **Chiave nuova = famiglia nuova in `FAMILIES`.** Fuori da quel registro una
   cache è invisibile allo sfratto: cresce e basta. Il `tier` dice cosa si
   butta per primo — 0 è quello che si rifà con una richiesta sola, 3 le mappe
   costruite un pezzo alla volta (foto, atleti ESPN).
3. **Bumpare la versione in una chiave (`_v4_` → `_v5_`) non basta**: i blob
   vecchi restavano per sempre. `FAMILIES.stale` li riconosce e `sweepStorage()`
   li cancella all'avvio — perciò la versione va cambiata **in tutti e due i
   posti**, nella chiave e in `FAMILIES.current`.
4. **`sweepStorage()` gira in `firebase-config.js` prima di `initializeApp`**,
   e deve restarci: è l'unico punto garantito prima che si apra il websocket.
5. **Si salva solo ciò che qualcuno legge.** `trimStats()` in `projections.js`
   tiene le sole statistiche usate da `SLEEPER_MAP` (scoring), `STAT_DEFS`
   (perf-explain) e `CATEGORIES` (player-page). Aggiungendo una statistica a
   una di quelle tre va aggiunta **anche a `KEPT_STATS`**, altrimenti dal vivo
   si vede e dalla cache no.
6. Il tetto `BUDGET_CHARS` (~4 MB) ce lo diamo noi, non lo impone il browser: la
   quota vera non è una costante — Chrome su localhost concede quasi 10 MB, il
   limite classico è 5, e su GitHub Pages l'origine è condivisa. Aspettare il
   muro vuol dire scoprire dov'è quando ci sbatte Firebase.

`storageReport()` da console stampa quanto occupa ogni famiglia.

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