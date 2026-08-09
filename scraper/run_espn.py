"""
GitHub Actions entrypoint: pull the current ESPN fantasy season and publish it.

Full-rebuild, self-healing: every run regenerates the whole season file (all
played weeks + the upcoming one, with projections), so a failed run is simply
fixed by the next and nothing is ever lost. Writes:
  - data/fantasy/fantasy_data_<season>.json   (committed by the workflow)
  - Firebase RTDB node  fantasy/fantasy_data_<season>   (what the site reads)

The league is public, so no ESPN cookies are needed. league_id + team_names
live in scraper/espn_config.json (committed). If the league is ever made
private again, set ESPN_S2 / ESPN_SWID env vars (from GitHub secrets).

The `espn` package here mirrors NFL_Fantasy_Dash/scripts/espn — re-copy those
.py files when the local scraper changes.
"""

import json
import os
import sys
import urllib.request
from datetime import datetime

HERE = os.path.dirname(os.path.abspath(__file__))
# Point the config loader at the committed public config (league_id + team_names);
# cookies are overlaid from ESPN_S2 / ESPN_SWID env vars.
os.environ.setdefault("ESPN_CONFIG", os.path.join(HERE, "espn_config.json"))
sys.path.insert(0, HERE)

from espn import config, draft_espn, fantasy_espn  # noqa: E402

RTDB_URL = "https://topina-9cd75-default-rtdb.firebaseio.com"
REPO_ROOT = os.path.dirname(HERE)


def current_season():
    """NFL season year: rolls over to the new year in September."""
    now = datetime.now()
    return str(now.year if now.month >= 9 else now.year - 1)


def put(node, payload):
    req = urllib.request.Request(f"{RTDB_URL}/{node}.json", data=payload,
                                 method="PUT", headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        return 200 <= resp.status < 300


def write_and_publish(subdir, node_prefix, name, data):
    out_dir = os.path.join(REPO_ROOT, "data", subdir)
    os.makedirs(out_dir, exist_ok=True)
    payload = json.dumps(data, ensure_ascii=False).encode("utf-8")
    with open(os.path.join(out_dir, f"{name}.json"), "w", encoding="utf-8") as f:
        f.write(payload.decode("utf-8"))
    ok = put(f"{node_prefix}/{name}", payload)
    print(f"{'OK ' if ok else 'FAIL'}  {node_prefix}/{name}")
    return ok


def draft_file(season):
    return os.path.join(REPO_ROOT, "data", "draft", f"draft_data_{season}.json")


def main():
    season = os.environ.get("SEASON") or current_season()
    cfg = config.load_config()
    watch = os.environ.get("WATCH_DRAFT") == "1"
    print(f"ESPN sync — season {season}{' (sentinella draft)' if watch else ''}")

    # In modalità sentinella il draft già scaricato è il segnale di "fatto":
    # il file lo committa l'Action stessa, quindi il giorno dopo si esce
    # subito senza nemmeno chiamare ESPN.
    if watch and os.path.exists(draft_file(season)):
        print(f"Draft {season} già presente in data/draft: niente da fare.")
        sys.exit(0)

    # Finché il draft non è stato fatto ESPN riempie le squadre di rose
    # segnaposto (acquisitionType null): giocatori che non sono di nessuno.
    # Pubblicarli metterebbe su Firebase una lega inventata, quindi non si
    # scrive niente — né su Firebase né in data/ — e si esce senza fallire.
    if not draft_espn.draft_is_done(season, cfg):
        print(f"Il draft {season} non è ancora stato fatto: nessun dato scritto.")
        sys.exit(0)

    # Il draft si costruisce PRIMA di pubblicare qualsiasi cosa: se ESPN dice
    # "fatto" ma le scelte non ci sono ancora, non si scrive niente di niente,
    # invece di caricare una stagione con le rose e un draft vuoto.
    draft = None
    if watch or os.environ.get("DRAFT") == "1":
        draft = draft_espn.build_draft(season, cfg=cfg)
        if not sum(len(v) for v in (draft.get("teams") or {}).values()):
            print(f"Nessuna scelta nel draft {season}: nessun dato scritto.")
            sys.exit(0)

    data = fantasy_espn.build_season(season, cfg=cfg, verbose=True)
    ok = write_and_publish("fantasy", "fantasy", f"fantasy_data_{season}", data)

    if draft is not None:
        # PUT sostituisce l'intero nodo: rilanciare cancella e riscrive il
        # draft dell'anno, gli altri anni sono nodi separati e non si toccano.
        ok = write_and_publish("draft", "draft", f"draft_data_{season}", draft) and ok

    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
