# ESPN — come arrivano i dati di lega

## Dove sta cosa

La lega ESPN è **pubblica**: l'API risponde senza cookie e con gli header CORS
aperti verso il sito. Da lì discende tutto il resto.

| pezzo | dove | quando gira |
|---|---|---|
| `scraper/` (Python) | Action `espn-live.yml` | una volta a settimana, martedì 09:00 UTC — scrive su Firebase il risultato chiuso |
| `js/data/espn-fantasy.js` | browser | pagina Live ogni 10s, Game Center all'apertura |
| `js/data/nfl-plays.js` | browser | play-by-play delle card giocata |
| `js/data/espn-boxscore.js` | browser | rete di sicurezza, se i punti non arrivano |

Il modulo browser è il **porto in JS** di `scraper/espn/maps.py` e
`normalize.py`. Se si tocca una delle due implementazioni va allineata l'altra,
e va rilanciato il confronto qui sotto.

Non servono più: il Cloudflare Worker (esisteva solo per iniettare i cookie) e
il vecchio sync Node — entrambi rimossi, restano nella storia git.

## validate_boxscore.py — i punti di lega dagli endpoint pubblici

Ricostruisce i punti fantasy dal tabellino ufficiale ESPN e li confronta con
quelli veri salvati su Firebase, per misurare quanto la rete di sicurezza sia
fedele.

```bash
py -3 scripts/espn/validate_boxscore.py 2025 3 7 11
```

Verificato il 2026-08-09 sull'intera stagione 2025, tutte e 17 le giornate:
**605 titolari su 605 esatti al centesimo, errore complessivo 0.00 punti**,
difese comprese.

Il docstring in cima al file elenca le sette regole non documentate scoperte
per arrivarci — ognuna è costata un disallineamento e nessuna è deducibile
dalla documentazione ESPN. Vale la pena leggerle prima di toccare quel codice.

## Se la lega tornasse privata

Servirebbero di nuovo i cookie `espn_s2` e `SWID` di un account membro
(DevTools → Application → Cookies su `fantasy.espn.com`), da mettere nei
GitHub Secrets per l'Action. Il lato browser invece **smetterebbe di
funzionare**: sono cookie di terze parti, che Safari e Firefox bloccano di
default, e senza ESPN risponde 401. In quel caso il sito tornerebbe a dipendere
da Firebase per i punteggi.
