# Archivio icone

Versioni dell'icona dell'app NON in uso: il sito non legge niente da qui
(index.html e il manifest puntano solo ai file in `icons/`). In uso c'e'
l'icona a pennellate (`scripts/build-app-icon.mjs`). Il marchio a barrette
resta solo in alto a sinistra nella navbar (`.brand-mark` in css/main.css).

- `barrette-generatore/` — l'icona a barrette (120x540) com'era pubblicata (commit
  9053537): versione scura e chiara, con il suo generatore. Per rimetterla:
  copiare `build-app-icon.mjs` su `scripts/`, lanciare `npm run build-app-icon`,
  spostare i `*-light.png` in `icons/` e rimettere nel `<head>` di index.html le
  righe con `media="(prefers-color-scheme: ...)"` e lo script che sceglie
  l'apple-touch-icon chiara (vedi lo stesso commit).
- `barrette-9x16/` — barrette con le proporzioni dell'icona di Election Desk.
- `barrette-7x20/` — barrette con le proporzioni del marchio di Election Desk
  (le stesse del marchio in navbar del sito).
