# Loghi e icone fuori dal sito

Il sito non legge niente da qui (index.html e il manifest puntano solo ai file
in `icons/`).

Chi e' cosa:
- **Icona dell'app** = le pennellate (`scripts/build-app-icon.mjs` → `icons/`).
- **Logo della lega** = le barrette nei colori dei team, ordine fisso Oscurus,
  Capi, Lasers, Sommo, sul modello di Election Desk:
  - 7:20 e' il logo normale, ed e' quello in alto a sinistra nella navbar
    (`.brand-mark` in css/main.css, barrette 7x20, spazio e raggio 2);
  - 9:16 e' la versione compatta, per quando non c'e' spazio.

Cartelle:
- `barrette-7x20/` — logo della lega su riquadro, scuro e chiaro.
- `barrette-9x16/` — logo compatto su riquadro, scuro e chiaro.
- `barrette-generatore/` — l'icona dell'app a barrette (120x540) com'era
  pubblicata nel commit 9053537, scura e chiara, col suo generatore. Per
  rimetterla come icona: copiare `build-app-icon.mjs` su `scripts/`, lanciare
  `npm run build-app-icon`, spostare i `*-light.png` in `icons/` e rimettere nel
  `<head>` di index.html le righe con `media="(prefers-color-scheme: ...)"` e lo
  script che sceglie l'apple-touch-icon chiara (vedi quel commit).
