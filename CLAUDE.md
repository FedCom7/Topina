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

**Chi scrive su Firebase: solo l'Action `espn-live.yml`**, il martedì dopo
il Monday Night Football, tre giri: alle 05:20, alle 06:00 e alle 08:30 ora
ITALIANA. Quello delle 05:20 è tarato sul RITARDO di GitHub, misurato sulle
esecuzioni del repo: i cron di notte partono in media 2,7 ore dopo (mediana
1,75), quelli di mattina e di giorno 4,5-5 ore dopo — le 05:20 fanno arrivare
il dato verso le 8, le altre due arrivano a metà giornata. Il
cron di GitHub è in UTC e l'Italia cambia ora, quindi nel file ci sono gli
orari di entrambe le stagioni e un primo passo lascia passare solo quelli
giusti per l'offset di Roma di quel giorno. Il secondo giro è la rete del
primo (GitHub parte in ritardo, e la giornata può non essere ancora chiusa):
ogni giro ricostruisce tutto, due giri riscrivono gli stessi dati. Esegue
`scraper/run_espn.py` e carica il risultato CHIUSO della giornata, più il
segnaposto della settimana dopo. Il segnaposto della week N+1 esce solo se la
week N è chiusa (`_drop_early_placeholders` in `scraper/espn/fantasy_espn.py`):
l'esecuzione del 9/09/2026, a draft fatto e prima del kickoff, aveva pubblicato
una week 2 vuota e il sito mostrava una W2 mentre si giocava la 1. È l'unico
produttore: non aggiungerne altri, perché scrivono sugli stessi nodi e l'ultimo
sovrascrive l'altro (successo il 2026-08-04). `deploy-data.yml` resta
disattivato sull'automatico, solo avvio manuale per ricaricare gli storici.

**Le statistiche di squadra NFL le fa `build-nflverse.yml`, nel giro
GIORNALIERO.** `scripts/build-nfl-team-stats.mjs` scrive
`data/nfl/team_stats_{Y}.json` — attacco, difesa, fantasy concessi per ruolo,
rank 1-32, calendario — ed è la fonte di tutta la tab Stats della pagina
squadra, del contesto squadra nella pagina giocatore e delle bye week. Per un
anno intero non l'ha eseguito NESSUNA Action: il file della stagione in corso
nasceva `scheduleOnly` (solo calendario) prima del via e restava tale finché
qualcuno non lo rifaceva a mano, quindi da settembre a febbraio quei blocchi
erano vuoti. Sta nel giro giornaliero e non in quello del martedì perché cambia
dopo ogni partita — giovedì, domenica, lunedì. La sua riga va tenuta
nell'elenco dei file committati in fondo al workflow, altrimenti gira a vuoto.

Aggrega **solo le settimane chiuse**, squadra per squadra: Sleeper pubblica le
statistiche appena la partita finisce, il risultato ufficiale (da cui si
contano le partite giocate) arriva dopo. Il 18/09/2026, a giornata 2 appena
cominciata, Buffalo aveva le stats di due partite e una sola partita contata:
871 yard e 121 giochi *a partita*. Numeratore e denominatore devono venire
dalle stesse partite. A stagione chiusa il filtro non cambia niente (verificato
rigenerando il 2025 con e senza).

A una giornata giocata un rank NFL è quasi rumore, e il sito lo dichiara invece
di nasconderlo: `sampleTag()` in `player-page.js` mette " · N games" accanto
all'anno finché la stagione non è completa, e sotto le 4 partite
`smallSampleNote()` lo scrive nelle note. Sempre sotto le 4 partite la stagione
in corso **non entra nei grafici storici** (`MIN_TREND_GAMES` in
`nfl-team-page.js`): senza quel cancello una settimana finiva accanto alle
stagioni intere e la pagina annunciava "miglior difesa 2026 (97/100)" dopo una
partita sola.

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

### La percentuale nel banner è una probabilità di vittoria, e va calcolata

Il numero in mezzo al tabellone (home e Live, `js/ui/score-bug-current.js`) era
la QUOTA DI PUNTI già a referto, `s1 / (s1 + s2)`. Il 19/09/2026, col solo
Thursday Night giocato, diceva **100% a Sommo** — 58,50 contro 0,00 — mentre
restavano 142 punti proiettati da giocare. Il conto era giusto, la domanda
sbagliata: nel posto dove l'app ESPN mette la probabilità di vittoria, un
numero senza etichetta si legge come probabilità di vittoria.

Ora la calcola `js/data/win-prob.js`: ogni titolare che deve ancora giocare è
una variabile centrata sulla sua proiezione, chi ha finito porta punti certi e
varianza zero, la differenza fra i due totali è normale e la probabilità è la
sua coda. Quattro cose da non disfare:

1. **La dispersione è MISURATA, non scelta.**
   `scripts/build-winprob-calib.mjs` → `data/model/winprob_calib.json`: 4360
   titolare-settimana dal 2019, proiezione ESPN contro punti veri, `sd = a +
   b·proiezione` per ruolo. Le proiezioni storiche vengono da
   `leaguedefaults/3` (la nostra lega su ESPN nasce nel 2026; quel pool
   pubblico risponde anche per le stagioni chiuse) e i punti si **ricalcolano
   col punteggio della nostra lega**, così proiezione e realtà stanno sulla
   stessa scala. Chi tocca i parametri rilancia il builder e rilegge il report.
2. **La scala (1,13) si misura sui totali di squadra, non si stima sugli
   esiti.** Nove giocatori indipendenti darebbero sd 24,3; i totali veri
   sbagliano di 27,5, perché nella stessa settimana c'è dell'altro che si muove
   insieme. Il rapporto si misura su 444 squadra-settimana. La controprova —
   la scala che minimizzerebbe la log-loss sui 222 esiti veri — dà 1,20, e il
   builder la stampa apposta: se le due divergono c'è qualcosa che non torna.
3. **Lo scarto per ruolo si applica.** ESPN è ottimista di due terzi di punto
   su ogni RB e WR. Nella differenza fra due squadre si annullerebbe — ma solo
   a parità di titolari ancora da giocare, che è esattamente il caso che qui
   non vale (una squadra ne ha nove, l'altra sette).
4. **Senza il tabellone NFL non si mostra nessuna probabilità.** Se `game_state`
   manca e un giocatore ha già punti, non si sa quanta partita gli resti:
   sommare la proiezione intera sopra i punti fatti li conta due volte (visto in
   locale, dove ESPN nega il CORS: Sommo proiettato a 199,7 invece di 157,8).
   `ready` diventa falso e il banner torna alla quota di punti.

La taratura è validata e il builder la ristampa a ogni giro: **prima del
kickoff la probabilità non sa niente** (Brier 0,251 contro 0,250 di un
testa-o-croce — con quattro rose così simili, la vigilia è davvero un lancio di
moneta), e diventa informativa man mano che la giornata avanza (0,190 a metà,
0,082 con un titolare per parte ancora in campo). Le percentuali si leggono
come si comportano.

Il file di calibrazione si rigenera **a mano**, come quello del Draft Grade, e
non da un'Action: le stagioni chiuse non cambiano più, e ogni esecuzione tira
giù un anno di proiezioni da ESPN. Vale la pena rilanciarlo a fine stagione,
quando ci sono diciassette settimane nuove da aggiungere al campione.

A giornata chiusa il numero torna a essere la **quota di punti**: lì la
probabilità sarebbe 0 o 100 — vera e inutile — mentre la quota dice quanto larga
è stata la vittoria. Il tooltip (`probTitle`) è l'unico posto dove il banner
dichiara quale dei due sta mostrando: se si aggiunge un terzo significato in
quel punto, va dichiarato lì.

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

### Night Recap — il replay della notte, e il sipario che lo protegge

Le partite del turno primetime finiscono alle cinque del mattino ora italiana:
chi apre il sito la mattina trova il risultato già fatto. Il Night Recap glielo
RACCONTA invece di comunicarglielo — i suoi titolari in campo, il tabellone NFL
che avanza, i punti che salgono giocata per giocata, con gli effetti del Live
(anello arancione quando la sua squadra ha la palla, rosso in red zone,
coriandoli sul touchdown). Due file: `js/data/night-recap.js` (i conti, niente
DOM e niente rete) e `js/sections/night-recap.js` (la scena).

**Non è una sezione del router.** Sta in `js/sections/` per il peso che ha —
orchestra fetch, tiene lo stato della riproduzione — ma non ha un hash, non è
in `SECTIONS` e non espone un `initXxx()`. È un livello sopra tutto il sito, e
`boot()` in `app.js` lo chiama PRIMA di `navigate()`.

1. **Il sipario si alza in modo SINCRONO, e l'ordine in `boot()` è la
   funzionalità.** Sotto, `navigate()` disegna la home, e la home mostra il
   punteggio nel banner: tutta la suspense sta nel non averlo ancora visto.
   `alzaSipario()` non fa una sola richiesta di rete e legge solo
   `localStorage`; i dati arrivano dietro al sipario e, se non c'è niente da
   rivedere, il sipario si abbassa da solo. Un `await` messo prima di quella
   riga brucia la funzionalità senza rompere niente — non se ne accorgerebbe
   nessun test.

2. **"Di notte" è il KICKOFF in ora italiana, non il giorno della settimana.**
   Dopo la mezzanotte: Thursday/Sunday/Monday Night sono alle 02:15 italiane, il
   tardo pomeriggio USA alle 22:25, Londra alle 15:30. Il giorno della settimana
   non basterebbe — a dicembre si gioca anche il sabato e a Natale. Verificato
   che la regola regge anche nelle due settimane di fine ottobre in cui ET e
   Roma sono sfasate di un'ora sola (il primetime scivola all'01:15, il
   pomeriggio al 21:25: restano dalle parti giuste della mezzanotte).

3. **Due cancelli prima del sipario** (`valeTentare()`): una volta al giorno;
   e — se `prossimaFine` lo sa già — niente sipario finché quel momento non è
   passato, qualunque sia l'ora. Solo se `prossimaFine` non si sa ANCORA
   (prima visita della settimana, o segnalibro azzerato) si ripiega su un'ora
   fissa, le 6 italiane: prima, una partita può essere ancora in corso, e per
   quello c'è il Live. Il conto vero (fine partita ≈ kickoff + 3h15) sta
   comunque in `prossimaFine`, non nell'ora fissa: è quello che tiene chiuso
   il sipario finché serve E lo riapre prima delle 7 quando il Monday Night è
   già finito. Prima c'era un terzo cancello, l'ora fissa a 7 SEMPRE
   applicata prima di guardare `prossimaFine`: bloccava un replay già pronto
   per un'ora buona (successo il 2026-09-29, aperto alle 6:xx dopo un Monday
   Night kickoff 02:15 finito verso le 5:30).
   `prossimaFine` si misura **solo sulle partite di notte**: prendendo la
   prossima partita qualunque, il venerdì mattina sarebbe la domenica
   pomeriggio, e il replay del Thursday Night non lo si vedrebbe mai. E si
   scrive **solo quando non c'era niente da rivedere**: scrivendolo anche
   quando un replay c'è, chi chiude la pagina a metà se lo perderebbe in
   silenzio.

4. **La finestra di freschezza è 48 ore, e non è un dettaglio.** Il segnalibro
   nasce vuoto: senza finestra, la prima apertura da un browser nuovo trova
   "mai viste" TUTTE le partite di notte delle settimane in esame e le mette in
   fila — provato, e il primo replay partiva dalla week 2 mentre era in corso
   la 3. Le partite scadute non si buttano: si segnano come viste, così non
   tornano a galla domani.

5. **L'agganciamento fra una nostra rosa e una giocata NFL passa da
   `espn_id`.** Il feed della lega e il play-by-play usano lo STESSO id atleta
   (verificato: 4430807 è Bijan Robinson in entrambe le API), quindi il campo
   è esposto da `normalizePlayer` in `espn-fantasy.js`. Non si usa
   `PLAYER_ID_MAP`: è generata da dati vecchi e i rookie non ci sono. Non c'è
   ripiego sul nome, e non è una dimenticanza — un contributo di `scorePlay`
   porta l'id, non il nome. Per questo `raccogli()` esce se la lega non ha
   draftato: le rose composte dalle scelte del draft non hanno l'id, e ne
   uscirebbe un replay di zeri.

6. **Il replay finisce ESATTAMENTE sul totale ufficiale.** Il ricalcolo per
   giocata non è il punteggio ufficiale (stessa ragione di `costruisciRace` in
   live-race.js), quindi in coda c'è un passo `assesta` che porta ogni titolare
   sul suo numero vero. Senza, il replay finirebbe su un numero diverso da
   quello che il sito mostra due secondi dopo.

7. **Il ritmo è a budget, e i momenti obbligati non si tagliano.** Novanta
   secondi in tutto, divisi fra i capitoli (una partita = un capitolo).
   Touchdown, calci e palle perse restano sempre passi pieni; le giocate minori
   si comprimono in blocchi `salta` che portano comunque i loro punti — il
   totale non deve MAI saltare un pezzo — mentre il tabellone NFL corre.
   Se anche così si sfora, `comprimi()` stringe i tempi con un pavimento per
   tipo: quello del touchdown è il più alto perché il timbro di `live-fx.js`
   resta cinque secondi, e comprimendolo si leggerebbe mezza parola.

   `comprimiGiocate: false` spegne i blocchi e fa di OGNI azione un passo —
   quelle senza i miei diventano passi `passa`, smorzati e rapidi. Si vede
   tutta la partita e i tocchi mostrati passano da 16 a 69, ma la durata
   triplica: su GB-DAL 2025 (221 giocate) sono 33 passi in 51s contro 222 in
   180s, e col budget da 75s il pavimento schiaccia i `passa` a 172ms, dove il
   testo non si legge più. Per ora vive solo nel banco di prova — il sito non
   passa l'opzione e resta compresso.

   Da lì è uscito un difetto che valeva per tutti: `contaSu` non si fermava
   quando un conteggio più nuovo partiva sullo stesso numero, e i due se lo
   riscrivevano a vicenda a ogni fotogramma. Con passi da 1,5 secondi non si
   vedeva; con quelli veloci il tabellone NFL ballava. Ora ogni conteggio
   marca l'elemento con un gettone e si ferma se viene superato, e la sua
   durata non eccede mai quella del passo che l'ha chiesto.

7-bis. **Il giocatore è un CERCHIO con le statistiche attorno, non una card.**
   L'anello è quello del campo del Live, e dal 2026-09-27 sta in
   `js/ui/stat-ring.js`, importato da tutti e due — `STATS_BY_ROLE`,
   `statValue`, `statVoci` e `statRingHTML` erano dentro `sections/live.js` e
   ora quel file li chiama da lì. La firma prende `(stats, role)` e non un
   giocatore apposta: la scelta fra statistiche vere e proiettate è roba del
   Live (prima del kickoff quelle vere sono tutte a zero) e resta là.

   Due differenze rispetto al campo, volute: nel Live l'anello è **nascosto
   sotto i 1000px** perché lì i giocatori sono nove e stretti, qui sono due o
   tre con la foto grande e si vede sempre, telefono compreso; e il
   riempimento del possesso **non è più un rettangolo** ma un alone attorno
   alla foto — tolta la card, quel rettangolo ambra era esattamente la cornice
   che si era appena tolta.

7-ter. **Più partite si vedono INSIEME, non una dopo l'altra.** Una notte può
   averne due (e a dicembre tre). Ogni gara ha il suo pannello — tabellone,
   campo, cronaca — impilati, e `intreccia()` fonde le sequenze in UNA linea
   del tempo ordinata sul cronometro di gara: si cammina da Q1 15:00 a Q4 0:00
   una volta sola e a ogni passo tocca alla partita che in quel momento aveva
   qualcosa da mostrare.

   Il cronometro si aggiorna su TUTTI i pannelli a ogni passo, non solo su
   quello che si è mosso: tenendolo per pannello, la partita ferma restava
   all'ora della sua ultima giocata — misurato, due orologi a schermo con
   quattro minuti di scarto, cioè esattamente la cosa che guardarle insieme
   dovrebbe evitare. Una gara che finisce prima passa a FINAL mentre l'altra
   continua. Il totale della squadra somma tutte le partite, perché i titolari
   stanno di qua e di là. Gli stacchi di fine quarto si fondono in uno solo:
   il quarto finisce per tutte nello stesso momento.

7-quater. **Quando non ci stanno, i cerchi diventano righe** — foto piccola,
   nome, statistiche, punti, come il confronto del Live — e le partite restano
   tutte a schermo, che è la priorità. La soglia la misura `adattaDensita()`,
   non una regola sul numero di partite: guarda la larghezza per giocatore
   (sotto 104px l'anello è illeggibile) E l'altezza del palco (tre gare da tre
   titolari sbordavano, e la terza finiva sotto il totale). Se non basta,
   un secondo livello (`nr-show--fitto`) toglie il testo dell'azione.

   La misura si ripete mentre il contenuto si assesta: al montaggio le foto
   non sono arrivate e gli anelli sono vuoti, quindi il palco non sborda
   ancora e una misura sola concludeva "ci stanno" — poi il contenuto cresceva
   e la terza partita usciva dal bordo.

   In riga il possesso illumina **tutta la riga** — ambra in campo, rossa in
   red zone — non un filetto sul bordo: lì la riga È il giocatore, e un alone
   attorno a una foto da 30px non si vede. Due trappole, tutt'e due già
   pestate:

   - il selettore porta `.nr-players` NON per decorazione ma per specificità:
     la regola dei cerchi (`.nr-players .formation-slot.live-slot--onball`,
     che spegne sfondo e bordo) sta più in basso nel file e a pari specificità
     vinceva lei — la riga non si accendeva mai;
   - il faro della festa (`is-festa`) abbassa gli altri al 30%, e una riga
     sottile a quel livello sparisce insieme al suo colore. In riga è più
     tenue (0.5): il protagonista si stacca lo stesso, restando l'unico a
     piena luce.

   Le statistiche non allargano la riga (`min-width: 0` + `overflow`):
   `nowrap` da solo spingeva il pannello oltre il bordo dello schermo.

7-quinquies. **Niente deve spostare le sezioni.** Con tre pannelli impilati
   qualunque elemento che cambia altezza fa ballare tutta la scena, e succede
   a ogni giocata. Due cose lo facevano:

   - il testo dell'azione andava a tre righe quando la cronaca era lunga.
     Ora `.nr-play` ha altezza FISSA (non `min-height`) e tronca coi puntini;
   - `.nr-dd` (down & distance) misurava 13px da vuoto e 18.9px col testo,
     perché `min-height: 1.1em` non corrispondeva all'interlinea ereditata
     (1.6). Il tabellone della partita che non aveva ancora down & distance
     era sei pixel più basso degli altri. Interlinea e altezza ora sono
     dichiarate e uguali, su `.nr-dd` e `.nr-clock`.

   Misurato: l'altezza della scena resta fissa a 817px per tutto il replay.
   L'unica misura che ancora varia è quella della card del protagonista di una
   festa (38 → 40.7px), ed è il `transform: scale(1.07)` del faro: non tocca
   il layout, infatti il palco non si muove.

7-sexies. **Stretti, la cronaca si RIASSUME invece di sparire.**
   `riassunto()` ricostruisce la giocata dalle statistiche che il passo porta
   già con sé — "Robinson · 17 yd catch", "Watson · 4 yd TD catch" — invece di
   tagliare la frase di ESPN, che anche tagliata resta lunga. Entra insieme
   alle righe compatte, cioè sulla stessa misura, e sta sempre in una riga
   sola.

8. **Il tabellone è quello della diretta, e il cronometro SCORRE.** Down,
   distanza, punto del campo e freccia del possesso: sono tutti nel
   play-by-play, e la posizione si scrive alla maniera TV ("GB 34") partendo da
   `toEZ` — sotto le 50 yard la palla è nella metà di chi difende, sopra in
   quella di chi attacca. Il cronometro non mostra l'ora della giocata ma ci
   ARRIVA scendendo dentro il tempo del passo: mostrandola e basta stava fermo
   e poi saltava. A quarto nuovo riparte da 15:00 (10:00 nei supplementari) e
   scende fino alla prima azione, invece di comparire già a 13:43 perché è lì
   che capita la prima giocata non compressa.

   **Il tempo deve scorrere anche quando non succede niente**, ed è il motivo
   per cui un blocco compresso NON ha una durata fissa (`durataSalto`). Ne
   aveva una — 700 ms, che coprisse tre giocate o trentasei — e l'ultimo
   blocco prima dell'intervallo inghiottiva dieci minuti di partita in mezzo
   secondo: il cronometro sembrava saltare da 5:00 a HALFTIME. Ora il tempo a
   schermo è proporzionale ai minuti coperti (`RITMO_SALTO`, con pavimento e
   tetto), e il ritmo va da 40× a 147× invece che fino a 880×. Misurato a
   schermo: 821 valori di cronometro distinti contro 63, e il salto massimo
   fra due letture consecutive è di 12 secondi di partita. Costa una quindicina
   di secondi sul totale, ed è il prezzo del cronometro che scorre.

   **Durante una festa il cronometro si FERMA**, come in diretta: dopo un
   touchdown, un fumble o un intercetto l'orologio è spento. Nel passo con la
   festa il tempo corre solo per il tratto dell'azione (un quarto del passo,
   al massimo 600 ms) e poi resta immobile finché l'animazione non è finita —
   misurato: riparte 330 ms dopo che il timbro è sparito. Senza, il tempo
   scorreva sotto i coriandoli e la festa sembrava succedere mentre si
   giocava. Il cronometro fermo si dichiara col colore spento
   (`.nr-clock.is-fermo`), o sembrerebbe un'animazione inceppata.

   Da questo discende un vincolo: `DWELL.td/calcio/colpo` e i loro
   `PAVIMENTO` **non scendono sotto la durata dell'animazione** (2250 ms: 350
   di entrata + 1200 di tenuta + 700 di uscita del timbro). Se il passo
   finisse prima, il tempo ripartirebbe coi coriandoli ancora per aria.
   Toccando `FESTA_CORTA` vanno rifatti quei conti.

   Il ritmo **non** è uniforme, ed è voluto: sui momenti dei tuoi giocatori
   rallenta a 2-25×, sui vuoti corre. Renderlo davvero costante vorrebbe dire
   un fast-forward di tre minuti senza momenti.

   Un blocco non attraversa mai un cambio di quarto: `forseQuarto` lo chiude
   prima di mettere in scena il cartello, o si vedeva "HALFTIME" e subito dopo
   ancora azioni del secondo quarto.

   Sotto, al posto della vecchia barra di avanzamento — un rettangolo che si
   riempiva senza dire di cosa fosse la misura — c'è la **linea del tempo di
   gara** con le tacche dei quattro quarti e il puntino che cammina: dice a
   che punto della partita si è, che è quello che uno cerca guardando lì.

   La fine di ogni quarto è uno stacco a schermo pieno (`END OF 1ST`,
   `HALFTIME`, `END OF 3RD`). Non è decorazione: senza, il cronometro tocca
   0:00 e riparte da 15:00 nello stesso respiro, e quindici minuti di partita
   passano inosservati. La fine del quarto periodo non si segna — lì finisce la
   partita, e a dirlo c'è già l'assestamento.

8-bis. **Il testo dell'azione si scrive SOLO quando c'è dentro un mio
   giocatore.** Il resto della partita si legge dal tabellone, e una riga su
   un'azione che non mi riguarda toglie l'occhio proprio da lì.

8-ter. **Il replay finisce su una SCHERMATA RIASSUNTIVA, e non si chiude da
   solo.** Il punteggio della sfida, ogni giocata dei titolari su un campo
   solo, e il pulsante per entrare nel sito. È l'ultima cosa che si guarda:
   sparire da sé sarebbe la cosa sbagliata.

   L'avversario di lega si mostra col suo totale VERO di giornata **più quanti
   titolari deve ancora scendere in campo**. Dopo il Thursday Night è quasi
   sempre a zero con nove da giocare, e quello zero senza avviso sembrerebbe
   una vittoria schiacciante invece di una giornata appena cominciata.

   Il campo è `js/ui/ngs-chart.js`, nello stile delle mappe di NFL Next Gen
   Stats: tutte le giocate partono dalla linea di scrimmage, un colore per
   giocatore.

   **Cosa è vero e cosa è disegnato**, e la distinzione va tenuta:
   - VERI la LUNGHEZZA (le yard del referto — verificate: 29 corse e 194 yard
     di Bijan Robinson combaciano col tabellino ufficiale) e il VERSO, dalla
     frase di ESPN, nel 96% delle giocate;
   - DISEGNATA la FORMA. Il tracking con cui NGS fa le sue mappe non esiste in
     nessuna API pubblica, quindi la curva è una route plausibile scelta da un
     catalogo (slant, out, dig, comeback, corner, post) in base a ruolo,
     profondità e direzione. **La nota sotto il grafico lo dichiara e non va
     tolta**: senza, una curva inventata si legge come un dato.

   Due linguaggi diversi, come i due grafici di NGS: i ricevitori SALGONO e
   tagliano, i corridori SERPEGGIANO attorno alla linea prima di trovare il
   varco. Una corsa da due yard disegnata come una route corta racconterebbe
   una cosa che non è successa.

   Le tracce non si sovrappongono mai, ed è misurato: 51 tracce, zero
   duplicati esatti, zero coppie a distanza media sotto i 3px su 1275
   confronti. Il punto di rottura di ogni route scivola con l'indice dentro la
   sua famiglia, o venti route dello stesso tipo sarebbero venti copie.

   **Selezionando un giocatore** gli altri si spengono e il colore cambia
   significato: non più "di chi è la linea" — ce n'è una sola — ma quanto ha
   reso, nelle tre fasce del Carry Chart (rosso perdita, giallo 0-5, verde 5+
   o TD; le incomplete restano tratteggiate). Lo scambio lo fa il CSS leggendo
   `data-f`, senza ridisegnare niente. La legenda delle fasce compare solo a
   giocatore scelto: prima non significherebbe nulla.

   Il parser della direzione sta in `direzioneGiocata` (field-strip.js), dove
   già viveva: `corsia` è un campo in più accanto a `lato` e `profondita`, non
   un secondo lettore dello stesso testo. Attenzione al ramo `incomplete`:
   ESPN scrive "pass incomplete deep left", e senza quello tutti i passaggi
   sbagliati restavano senza corsia — cioè proprio quelli che sul grafico si
   vogliono vedere andare a vuoto.

   Le perdite nel totale yard si **sottraggono**, non si azzerano: clampandole
   a zero la serata risultava di 218 yard invece delle 213 vere.

9. **Gli effetti sono quelli del Live, non una copia — ma accorciati.**
   `live-slot--onball`,
   `live-slot--redzone`, `is-festa`, `.live-fx`: a quelle liste di selettori è
   stato aggiunto `.nr-players`, e la scena porta la classe `.live-stage`
   apposta per ereditare il faro. Tre cose sono però tarate sul campo del Live,
   che è largo quanto la pagina e alto il doppio, e nel recap vanno
   riproporzionate (lo fa il CSS, scoped a `.nr-stage`): il bagliore è un
   cerchio di 460px fissi e su un telefono diventava un rettangolo grigio su
   tutta la scena; il lampo è bianco pieno e trasformava il touchdown in uno
   schermo bianco; il timbro a `7.5vw` usciva da entrambi i lati.

   `FESTA_CORTA` taglia le misure: il Live è in diretta e sotto non scorre
   niente, qui il passo dopo arriva in due secondi e una festa da dieci
   restava addosso alle giocate seguenti — che passavano senza vedersi. Una
   sola ondata di coriandoli, un lampo solo (misurato: 206 ms, picco ~20% di
   bianco a schermo), timbro 1,2 s, niente fumetto. Le tre misure sono
   diventate campi della riga in `live-fx.js` (`tenuta`, `bolla`, `ondate`, e
   `lampo` che accetta anche un oggetto) con i valori del Live come
   predefiniti: chi non li passa vede esattamente quello che vedeva prima.

   Il livello degli effetti sta a `z-index: 9`, davanti alle card. `is-festa`
   porta il protagonista a 6 e il livello stava a 5: timbro e fumetto finivano
   dietro proprio alla card di chi aveva segnato, cioè sparivano nel momento
   in cui servivano.

10. **Un solo stile di punteggio, e lo mette sempre la card.** Cifre luminose
   senza riquadro — quello che prima si vedeva solo sul touchdown — accanto al
   giocatore che li ha fatti, con la sola misura a cambiare fra un TD e una
   ricezione da otto yard. Prima ce n'erano due: la pillola scura di
   `.live-pop` per i punti normali e il numero di `live-fx` per chi segnava,
   che per giunta vive nel livello degli effetti e finiva a mezzo schermo di
   distanza dal suo giocatore. Per questo `sparaEffetto` viene chiamata con
   `punti = 0`: il numero lo disegna `etichetta()`, non lei.

Senza squadra del cuore scelta non si apre niente: non si saprebbe di chi è il
replay.

**Il banco di prova è `preview-night-recap.html`**, e serve perché il Night
Recap va in onda solo quando si allineano tre cose — una partita di notte
finita, un tuo titolare dentro, la prima apertura del sito quella mattina —
cioè qualche martedì l'anno. Là lo si guarda a comando, su otto partite di
notte VERE (scelte per coprire la sparatoria, il pareggio, la gara difensiva,
quella di dicembre), scegliendo quanti giocatori mettere in campo e andando
avanti un passo per volta. Tre cose da sapere:

- **importa il modulo vero**, come `preview-stickers.html`: gli agganci
  `anteprimaRecap` / `anteprimaPasso` / `anteprimaAuto` / `anteprimaChiudi`
  mandano in onda la stessa scena del sito, e non toccano MAI il segnalibro —
  provare non deve consumare il replay vero;
- **non chiama `site.api.espn.com`**, che da localhost nega il CORS. Gli bastano
  le giocate (`sports.core.api.espn.com`, che risponde anche in locale): i
  "titolari" li pesca fra i protagonisti della partita invece che da una rosa
  di lega, ed è l'unico pezzo finto della pagina;
- **la scena vive dentro un iframe**, e il file ha due ruoli: senza parametri è
  la pulsantiera, con `?embed=1` è il replay e basta. Non è un vezzo —
  `@media (max-width: 560px)` e tutti i `clamp(…vw…)` di main.css guardano la
  FINESTRA, non il riquadro che li contiene, quindi rimpicciolire un div
  mostrerebbe una bugia: il layout da desktop, solo stretto. Dentro un iframe
  largo 390px il viewport è davvero 390px e le media query scattano come sul
  telefono (verificato: `matchMedia('(max-width:560px)')` è vero solo lì).
  Stessa ragione per cui `preview.html` incornicia `index.html`. I comandi
  passano per `postMessage`, e il telaio si scala per stare nella finestra
  dichiarando la percentuale — se no si crederebbe di guardare un 1600px;
- **"In contemporanea" prova la notte con più partite** (capita: giovedì e
  sabato di dicembre, o il lunedì doppio). Diventano capitoli in fila, e il
  budget si divide fra loro come fa il sito;
- i punti ufficiali che passa al motore sono il ricostruito **più 0,4**, così il
  passo `assesta` si vede invece di restare un ramo mai percorso.

### Flip card — due modi, e non si mescolano

La tab "Flip Card" della pagina squadra NFL (`js/data/nfl-flip-card.js` +
i blocchi `flip*` in `sections/nfl-team-page.js`) rifà la scheda che le squadre
stampano il giorno della partita: schieramenti riga per riga di ENTRAMBE le
squadre, specialisti, rosa numerica con practice squad, arbitri. Una per
giornata, dalla barra delle settimane in testa al blocco.

1. **La card della settimana in arrivo e quella di una già giocata hanno
   fonti diverse, e la nota lo dichiara.** ESPN non conserva i depth chart
   storici (`/depthcharts` è solo la versione di oggi, e `/roster?season=2019`
   risponde con liste vuote): ristampare quello di oggi sopra una partita di
   ottobre sarebbe una bugia. Quindi il modo `projected` usa il depth chart
   live, il modo `played` ricostruisce la card dal ROSTER DI GARA
   (`competitors/{id}/roster`, che porta `starter` per i 22 titolari di quel
   giorno e `didNotPlay` per gli inattivi) raggruppato per ruolo. Il modo si
   decide sul dato, non sul calendario: se il roster di gara manca si ricade
   sul depth chart dichiarandolo.
2. **La tabella delle posizioni ESPN è incorporata, e deve restarci.** Il
   roster di gara dà la posizione come `$ref` a `/positions/{id}`: risolverle
   costerebbe fino a 110 richieste per aprire una card. `ESPN_POS` è quella
   tabella (74 voci, immutabili — sono gli slot del football) con il reparto
   già ricavato risalendo i `parent`.
3. **Sulle stagioni passate i nomi arrivano da nflverse.** Il roster di gara
   porta solo il cognome ("20 Johnson"), e la rosa ESPN esiste solo per oggi.
   `roster_{Y}.json` riempie nome intero, college, altezza e peso agganciando
   per NUMERO DI MAGLIA con il cognome a fare da controprova. Misurato su una
   card 2024: 107 nomi interi su 110. L'età non c'è in nflverse e quella
   colonna resta vuota.
4. **`experience.years === 0` di ESPN è l'unico uso lecito di quel campo**
   (rookie sottolineato, la convenzione della card stampata): conta le stagioni
   attive e diverge da nflverse su chi ha saltato un anno, ma sui rookie le due
   fonti coincidono sempre. Nel modo `played` il rookie si decide comunque su
   `rookieYear` della STAGIONE DELLA PARTITA, o una card di due anni fa
   sottolineerebbe i rookie di quest'anno.
5. **Gli arbitri esistono solo dal giorno della partita.** `gameInfo.officials`
   è vuoto sulle gare future e pieno da quella in corso: il blocco compare da
   solo, non va inventato un ripiego.
6. **La giornata aperta per prima è la prima non ancora giocata.** È questo, e
   nient'altro, che fa avanzare la sezione ogni settimana.
7. **Caricamento pigro, e due guardie diverse sugli ascoltatori.** La card
   costa cinque-sette chiamate ESPN e parte solo all'apertura della tab
   (evento `nfl-sec`, emesso da `bindSectionNav`). Il click sulle pillole è
   agganciato a `#nfl-flip`, che sopravvive al cambio stagione; quello sul
   cambio tab a `#nfl-team-page`, che sopravvive anche al passaggio da una
   squadra all'altra — senza la sua guardia se ne accumulava uno per visita,
   tutti su contenitori ormai staccati, e dalla seconda squadra in poi la card
   non compariva più.

In locale `site.api.espn.com` nega il CORS (vedi il banco del Night Recap):
la tab si verifica intercettando quelle richieste e rifacendole da node.

### Area Draft — quattro sezioni sorelle

Il dropdown "Draft" del nav ha quattro voci, tutte con `NAV_PARENT → 'draft'`:
`#draft` (Draft Recap, `sections/draft.js`), `#draftgrades` (le pagelle,
`sections/draftgrades.js` + la pagina squadra `draftgrade-team.js`),
`#projections` (`sections/projections.js`) e `#managerdna` (Manager DNA,
`sections/managerdna.js` + la pagina allenatore `managerdna-team.js`).

**Projections è il listone in chiaro**: le stesse proiezioni Sleeper/Rotowire
che alimentano `draft-grade.js`, per ruolo e in ordine di punti, con ADP e chi
ha preso chi. Esiste perché un voto si possa contestare guardando i numeri veri.
Se cambia il modo in cui il motore valorizza una pick, questa tabella va
allineata — altrimenti mostra numeri che non sono quelli usati per votare.
I kicker restano senza punti (Sleeper non li proietta a livello stagionale) e
si ordinano per ADP: il fallback storico da 125 pt vive solo dentro al motore,
a schermo sarebbe un numero inventato.

### Manager DNA — due cancelli, e non si tocca il voto

`#managerdna` descrive **come** drafta e come si muove sul mercato ciascun
allenatore, su tutte le stagioni. Non giudica le scelte: quello resta alle
Pagelle. Motore in `js/data/manager-dna.js`, builder offline in
`scripts/build-manager-dna.mjs` → `data/model/manager_dna.json` (committato,
rigenerato dal giro completo di `build-nflverse.yml`).

1. **È isolata dal motore del voto, di proposito.** Non importa `draftgrades.js`,
   `draft-grade.js` né `data.js`, e non c'è nessun tratto derivato da
   `score`/`survivalPct`/`need`. Tutto quello che mostra si calcola da file su
   disco (`data/draft/`, `adp_ffc_*`, `roster_*`, `injuries_*`, `fantasy_data_*`,
   `unrostered_scores_*`). Conseguenza voluta: **niente lettere, per
   costruzione** — il JSON non contiene `letter`/`score`/`grade`, quindi la
   regola dell'unico voto a schermo regge da sé. Se un domani servono tratti
   derivati dal motore, si aggiungono; non si rifattorizza Draft Grades.
2. **Due cancelli, non uno.** Un tratto diventa `signature` — e solo allora può
   diventare un'etichetta o una frase — se passa entrambi:
   *differenza* (permutazione delle etichette + Benjamini-Hochberg a q ≤ 0.10 su
   TUTTA la famiglia insieme) e *persistenza* (autocorrelazione lag-1 fra
   stagioni consecutive). Il secondo è quello che separa un'identità dalla
   fortuna: i colpi tardivi e gli infortuni passano il primo e falliscono il
   secondo, e infatti sono fortuna (r −0.18 e −0.02). Un tratto che passa solo
   il primo è `differs` e si mostra come numero, mai come abitudine.
3. **Due nulli diversi, uno per famiglia.** I tratti di draft si permutano
   **dentro il giro** (in uno snake a 4 ogni allenatore ha esattamente una pick
   per giro: rimescolare liberamente gonfia ogni tratto legato al timing); quelli
   di mercato **dentro la stagione**. Usare il nullo sbagliato invalida metà
   sezione.
4. **Ogni tratto di tipo-giocatore esiste in due unità**, `perPick` e
   `perPlayer` (deduplicando chi ricompare in più stagioni), e il gate guarda
   `perPlayer` per i gusti. Non è pignoleria: a livello di pick un allenatore
   sembrava il collezionista di veterani (34% contro 15%, q 0.04), ma sui
   giocatori unici il segnale sparisce (18% contro 11%, q 0.88) — non drafta
   veterani, **ridrafta gli stessi che invecchiano con lui**. Dove le due unità
   divergono, la divergenza si mostra.
5. **I movimenti di mercato si classificano.** Ricostruiti per differenza fra
   roster settimanali: 81% `clean` (vera decisione), 15% `boomerang` (rientro di
   uno già avuto: IR, bye), 4% `trade`. I tratti contano i soli `clean`, altrimenti
   chi parcheggia infortunati sembra un iperattivo del mercato.
6. **Passare i cancelli non basta per un archetipo.** Serve anche
   `archetype: true` nel catalogo: la concentrazione per college passa (q 0.057)
   su valori praticamente identici fra i quattro. Il gate dice se una differenza
   è reale, non se vale la pena raccontarla. La soglia `Z_APART` è 0.75 perché
   con quattro valori equispaziati gli z sono ±1.34 e ±0.45 — 0.75 separa
   l'estremo dagli altri tre.
7. **Ogni allenatore ha SEMPRE un nome, ma con la solidità dichiarata.**
   `archetypeFor` prova tre livelli sempre più larghi e restituisce il primo che
   combacia, marcandolo in `confidence`: `netta` (due tratti `signature` oltre
   `Z_APART`), `sfumata` (si accettano anche i `differs`, soglia 0.5σ), `debole`
   (solo la direzione). La UI mostra il badge accanto al nome: l'onestà sta lì,
   non nel negare l'etichetta. Il gruppo `luck` resta escluso a ogni livello —
   la fortuna non è un carattere.
8. Il builder **non usa la rete** e ha seed fisso: due esecuzioni di fila devono
   dare un file identico a meno di `generatedAt`. Aggiungere tratti al catalogo
   **peggiora le q di quelli già dentro** (BH su tutta la famiglia): dopo ogni
   aggiunta si rilegge il report per vedere se qualcosa è scivolato da
   `signature` a `differs`.

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
4. **Due righelli diversi, e la differenza è voluta.** Le **pick** hanno soglie
   a quantili empirici, generate da `node scripts/build-draft-grade-calib.mjs`
   → `data/model/draft_grade_calib.json`: "questa scelta rispetto a tutte le
   scelte mai fatte" è una domanda relativa per natura. Lo script deve
   valorizzare le pick **esattamente come il sito** (blend storico K/DEF
   compreso): calibrare su una distribuzione diversa da quella votata sbaglia le
   lettere ai bordi. Stampa anche il backtest contro i punti veri — se
   `meanGradeRho` va sotto zero, il motore è rotto, non i pesi.
   Le **squadre** no: `DEFAULT_TEAM_THRESHOLDS` è un righello **fisso a fasce
   uguali** da 5 punti (D sotto 36 … A+ da 76), e `calib.teamThresholds` viene
   ignorato di proposito — su una scala assoluta (punto 4-bis) tagliare per
   quantili rimetterebbe il voto in balìa di com'erano gli altri tre quell'anno.
4-bis. **Il talento è ASSOLUTO: quota del raggiungibile catturata.**
   `starterVOR / ceilingVOR`, dove il tetto è la miglior formazione titolare
   costruibile dai TUOI turni col board vero (`ceilingVOR` in `draft-grade.js`:
   condizione di Hall sui prefissi, avidità + scambi, partendo sia da zero sia
   dalla rosa vera così il tetto non può stare sotto il reale).
   **Non tornare alla quota di lega** (`50 + (share − 25%) × 400`): era a somma
   zero — le quattro quote fanno sempre 100%, quindi se draftavano bene tutti e
   quattro restavano tutti a 50, e "un draft da 10" non era esprimibile.
   Misurato su 28 draft con `scripts/analyze-absolute-scale.mjs`: capture si
   spande fra 41.8% e 91.9%, è quasi scorrelata dal turno di prima scelta
   (−0.14 contro −0.35 della vecchia quota, quindi più equa), e il backtest non
   peggiora in modo distinguibile (0.343 contro 0.429, t = −1.4 su 7 stagioni).
   I punti/settimana **non** possono essere la scala: il tetto medio di lega è
   passato da 43.8 pt/sett nel 2019 a 17.8 nel 2025, solo il rapporto è
   confrontabile fra stagioni.
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

### I colori di una squadra stanno in UN posto

`TEAM_PALETTE` in `js/data/team-config.js` dà tre ruoli per squadra:
`identity` (la franchigia: hero, sticker, bordi), `bright` (lo stesso colore
reso leggibile su fondo nero — per Oscurus e Sommo è diverso, perché un
bordeaux #800020 e un petrolio #1c4750 su un grafico nero spariscono) e `ink`
(la versione cupa, per le campiture larghe).

Prima ce n'era uno solo in `TEAMS[].color` più un secondo set **copiato
identico in due file** (`CHART_COLORS` in analysis.js e `CHART_COLORS_BY_KEY`
in stats.js). Ora quei due derivano dalla palette e `TEAMS[].color` è
`TEAM_PALETTE[key].identity`. **Non si reintroduce una tinta di squadra scritta
a mano da nessuna parte**: si aggiunge un ruolo alla palette. La pagina squadra
mostra i tre colori col loro codice esadecimale proprio per poterli correggere
lì e vederli cambiare ovunque.

### Sticker dell'hero squadra — due tinte, e l'impaginato dice il tipo

Gli adesivi della pagina squadra (`js/ui/badge-svg.js`) sono ricalcati sugli
helmet sticker dei Michigan Wolverines. Tre regole:

1. **Due tinte e basta.** `--stk-paint` è il fondo, `--stk-ink` l'inchiostro:
   niente sfumature, niente bordi, niente terza tinta. I dettagli dentro un
   marchio si ricavano per SOTTRAZIONE — buchi color fondo dentro la sagoma
   piena (classe `stk-lace`) — che è come si stampa un adesivo a due colori.
   Per questo le due tinte sono variabili CSS e non valori: i buchi devono
   sapere qual è il fondo.
2. **L'impaginato dice già di che si tratta**, prima che si leggano le parole.
   Sono nove (`COMPOSITIONS`) e ognuno ha il suo antenato sul casco: logo +
   numero è il conta-vittorie, «(540)» è il prefisso telefonico, «RAMPAGE 2023»
   è parola + anno, l'arco è «GUARDIANS OF VICTORY». Ogni badge dichiara il suo
   in `js/data/badges.js` (campo `comp`), e il numero che ci finisce dentro
   arriva da `iconText` sull'istanza — **non** dalla soglia del badge: sette
   stagioni di Club 150 con la soglia davano sette «(150)» identici, col
   punteggio vero danno sette adesivi diversi.
3. **Il testo si misura a schermo, non si stima.** Una parola lunga esce
   dall'ovale, e sul tracciato curvo viene TAGLIATA in silenzio dal `textPath`.
   `fitStickerTexts(root)` va chiamata dopo aver messo gli sticker nel
   documento, e riparte sempre dal corpo iniziale; aspetta anche il
   caricamento di Archivo Black, che si scarica quando serve — misurare prima
   significa misurare il ripiego, più stretto, e vedere il testo sforare appena
   arriva il font vero.

Il banco di prova è `preview-stickers.html`, che **importa il modulo vero**: non
tiene una copia dei marchi, perché due copie divergono. Quello che vive solo là
sono le proposte non adottate — le tre famiglie (a vita / stagionali che si
azzerano / in palio che cambiano mano) e gli adesivi segnati ✦.

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