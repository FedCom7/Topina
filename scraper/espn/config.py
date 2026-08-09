"""Loads ESPN credentials + league config from espn_config.json (local, untracked)."""

import json
import os

BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
CONFIG_FILE = os.path.join(BASE_DIR, "espn_config.json")

READ_HOST = "https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl"
# ESPN league went live on ESPN from the 2026 season; earlier years lived on NFL.com.
FIRST_ESPN_SEASON = 2026


class ConfigError(RuntimeError):
    pass


def load_config():
    """Returns the league config dict.

    Loads from a JSON file (local dev: espn_config.json, or the path in the
    ESPN_CONFIG env var) and overlays environment variables on top, so CI can
    keep the secrets (cookies) out of the repo: the committed file carries the
    non-secret league_id + team_names, while ESPN_S2/ESPN_SWID come from GitHub
    secrets. Any of league_id/espn_s2/swid may come from either source.
    """
    path = os.environ.get("ESPN_CONFIG", CONFIG_FILE)
    cfg = {}
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            cfg = json.load(f)

    # Environment overrides (used by CI; ignored locally when unset).
    cfg["espn_s2"] = os.environ.get("ESPN_S2") or cfg.get("espn_s2")
    cfg["swid"] = os.environ.get("ESPN_SWID") or cfg.get("swid")
    cfg["league_id"] = os.environ.get("ESPN_LEAGUE_ID") or cfg.get("league_id")
    if os.environ.get("ESPN_TEAM_NAMES"):
        try:
            cfg["team_names"] = json.loads(os.environ["ESPN_TEAM_NAMES"])
        except ValueError:
            pass

    # Only league_id is mandatory. Cookies are needed *only* for a private
    # league; a public league answers without them, so espn_s2/swid are optional.
    if not cfg.get("league_id"):
        raise ConfigError(
            f"Missing 'league_id': set it in {path} or the ESPN_LEAGUE_ID env var."
        )
    return cfg


def cookie_header(cfg=None):
    """Cookie header for a private league, or None when no cookies are set
    (public league — the API answers without authentication)."""
    cfg = cfg or load_config()
    if not (cfg.get("espn_s2") and cfg.get("swid")):
        return None
    return f'espn_s2={cfg["espn_s2"]}; SWID={cfg["swid"]}'


def team_name(cfg, team_id):
    """Maps an ESPN teamId to the league's canonical display name.

    Falls back to whatever ESPN reports if the id is not in the config map."""
    return (cfg.get("team_names") or {}).get(str(team_id))
