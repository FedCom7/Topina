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

- UI language is **Italian**
- All CSS is in a single `css/main.css` file (no preprocessor)
- Firebase SDK loaded via CDN ESM imports, not npm
- Sections use a `loaded` flag to prevent re-initialization
- Image paths with spaces (e.g., `Team Logo/`) must be URL-encoded when used in CSS/HTML