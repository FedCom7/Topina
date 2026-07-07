---
name: verify
description: Come buildare, lanciare e verificare la Topina League app (SPA statica vanilla JS + Firebase RTDB) osservandola a runtime nel browser.
---

# Verifica Topina League

Nessuna build: è una SPA statica ES-modules. Serve solo un server http
(i moduli non funzionano da `file://`).

## Lancio

```bash
python3 -m http.server 8123   # dalla root del repo
# pagina: http://localhost:8123/index.html#<sezione>
```

Hash utili: `#standings`, `#team-capi|-lasers|-oscurus|-sommo`, `#stats`,
`#history`, `#draft`, `#game-center`.

## Drive nel browser (headless)

Playwright non è installato nel repo. Ricetta che funziona:

```bash
cd <scratchpad> && npm init -y && npm i playwright-core
# poi in uno script .mjs:
#   import { chromium } from 'playwright-core';
#   await chromium.launch({ channel: 'chrome' })   // usa Chrome di sistema
```

- I dati arrivano da Firebase RTDB (rete reale): dopo `goto` aspettare
  `networkidle` + ~2.5s prima di leggere il DOM.
- La navigazione reale tra sezioni è il **cambio hash**
  (`location.hash = '#team-x'`), non `page.goto` — un goto ricarica la
  pagina e azzera le cache dei moduli.

## Cosa controllare

- Console: zero errori JS. I 404 su `Superbowl-logo/superbowl_{iii..vi}_logo.png`
  sono noti (loghi mai creati, nascosti via `onerror`).
- Pagine team: cross-check numeri (titoli, W-L, H2H) con la pagina `#stats` —
  derivano dagli stessi dati e devono coincidere.
- Mobile 390×844: `document.documentElement.scrollWidth <= clientWidth`
  (niente scroll orizzontale).
- Cache-busting: ogni modifica a css/js richiede bump `?v=` in `index.html`
  (main.css, app.js) e negli import interni toccati.

## Gotcha

- Le unità `cqi` si risolvono contro il *container antenato*: non usarle
  nelle proprietà dell'elemento che dichiara `container-type`.
- Google Analytics fallisce in locale (`ERR_BLOCKED_BY_CLIENT`/404): rumore, ignorare.
