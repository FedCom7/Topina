# Archivio icone

Versioni dell'icona dell'app NON in uso: il sito non legge niente da qui
(index.html e il manifest puntano solo ai file in `icons/`). Restano per poterle
recuperare.

- `pennellate/` — la prima icona (commit 3d18c5a): quattro pennellate a 45°,
  ordinate per campione e classifica. C'è anche il generatore di allora
  (`build-app-icon.mjs`): per rimetterla, copiarlo su `scripts/build-app-icon.mjs`
  e rilanciare `npm run build-app-icon`, poi ripristinare il `<head>` di index.html.
- `barrette-9x16/` — barrette con le proporzioni dell'icona di Election Desk.
- `barrette-7x20/` — barrette con le proporzioni del marchio nella barra di
  Election Desk (le stesse del marchio in navbar del sito).

Per usare una variante a barrette basta cambiare `W`, `GAP`, `H`, `R` in
`barrette()` dentro `scripts/build-app-icon.mjs` e rilanciarlo.
