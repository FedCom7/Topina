# ESPN Fantasy sync — setup

Sostituisce la sorgente dati "lega" (matchup + draft) da NFL.com/scraper Python
a ESPN Fantasy API, senza toccare il frontend. Vedi il blueprint di
migrazione per il contesto completo; questo file copre solo il setup pratico.

**Non tocca**: i dati NFL reali (roster/injuries/news via ESPN pubblico +
Sleeper) già usati dal frontend — quelli restano come sono.

## 1. Credenziali (una tantum, poi in GitHub Secrets)

1. `ESPN_LEAGUE_ID` — già noto: `1948241900` (in `league-config.mjs`, non è
   un segreto).
2. `ESPN_S2` e `ESPN_SWID` — da un browser loggato su un account membro
   della lega:
   - Vai su `fantasy.espn.com`, apri DevTools → Application → Cookies →
     `https://fantasy.espn.com`.
   - Copia il valore di `espn_s2` (stringa lunga ~300 caratteri) e `SWID`
     (formato `{XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX}`, con o senza graffe).
3. In GitHub: repo → Settings → Secrets and variables → Actions → New
   repository secret → `ESPN_S2` e `ESPN_SWID`.
4. Per testare in locale, esporta le stesse variabili nella shell (mai in un
   file committato):
   ```powershell
   $env:ESPN_S2 = "..."
   $env:ESPN_SWID = "{...}"
   ```

I cookie scadono/si invalidano se fai logout da ESPN — vanno rigenerati
~1 volta a stagione (il job fallisce con errore esplicito "401 Unauthorized"
se sono scaduti, senza sovrascrivere i dati buoni).

## 2. Smoke test (Step 2-3 del blueprint)

Prima di fidarsi del normalizer, verificare a mano la forma reale delle
risposte ESPN sulla lega 2026:

```powershell
node -e "
import('./scripts/espn/client.mjs').then(async ({ fetchLeagueTeams }) => {
  const data = await fetchLeagueTeams('1948241900', 2026);
  console.log(JSON.stringify(data.teams?.map(t => ({ id: t.id, name: `${t.location} ${t.nickname}` })), null, 2));
});
"
```

Da questo output si compila `TEAM_ID_TO_NAME` in `league-config.mjs` (oggi
vuoto — il normalizer usa un fallback `Team {id}` finché non è popolato).

Poi verificare un boxscore reale (`fetchBoxscore`) e confrontare i
`statId` effettivi contro `STAT_ID_MAP`: quelli marcati "da confermare" nel
blueprint (fumble, 2-pt, return TD, kicker, IDP) sono i più a rischio di
essere sbagliati finché non si vede una risposta vera.

## 3. Run manuale

```bash
node scripts/espn/sync.mjs 2026 --draft
```

Scrive `data/fantasy/fantasy_data_2026.json` e `data/draft/draft_data_2026.json`
con lo stesso schema dei JSON storici (`source: "espn"` e `synced_at` al
posto di `scraped_at` per distinguerli). Poi:

```bash
npm run upload-data
```

per pubblicarli su Firebase (o lascia fare al workflow `sync-espn.yml`).

## 4. Golden test (Step 4.2 del blueprint)

Prima di attivare il cron, rigenerare una settimana e confrontarne la
struttura (chiavi, non valori — i valori saranno ovviamente diversi) contro
un `fantasy_data_2025.json` storico: zero divergenze di schema ⇒ il
frontend è garantito compatibile senza modifiche.

## 5. Cosa NON è ancora collegato

- `worker/espn-live-proxy.js` — proxy edge per i punteggi live, da
  deployare separatamente su Cloudflare Workers (`wrangler deploy` dentro
  `worker/`). Il frontend (`game-center.js`) non lo chiama ancora: va
  aggiunto un polling opzionale una volta verificato che il proxy risponde
  con dati reali.
- La risoluzione `opponent`/`status` testuale (es. "Loss, 40-41") nei
  boxscore: ESPN non la fornisce nello stesso payload di mBoxscore. Oggi
  lasciata vuota nel normalizer; se serve, va derivata dallo scoreboard NFL
  pubblico (stessa fonte già usata per i dati NFL reali).
