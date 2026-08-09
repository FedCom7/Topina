"""Thin HTTP client for the ESPN fantasy read API."""

import json
import time
import urllib.error
import urllib.request

from . import config


class ESPNAuthError(RuntimeError):
    pass


def fetch(season, views, week=None, cfg=None, retries=3):
    """GET the league endpoint for a season with the given views.

    views: list of ESPN view names (e.g. ["mBoxscore", "mMatchup"]).
    week:  scoringPeriodId (NFL week). Omitted for season-wide views.
    Returns the parsed JSON dict. Raises ESPNAuthError on 401.
    """
    cfg = cfg or config.load_config()
    history = int(season) < config.FIRST_ESPN_SEASON
    if history:
        # Past seasons live under the leagueHistory endpoint (response is a list).
        base = f'{config.READ_HOST}/leagueHistory/{cfg["league_id"]}'
        query = "&".join(f"view={v}" for v in views) + f"&seasonId={season}"
    else:
        base = f'{config.READ_HOST}/seasons/{season}/segments/0/leagues/{cfg["league_id"]}'
        query = "&".join(f"view={v}" for v in views)
    if week is not None:
        query += f"&scoringPeriodId={week}"
    url = f"{base}?{query}"
    headers = {"User-Agent": "Mozilla/5.0", "Accept": "application/json"}
    cookie = config.cookie_header(cfg)
    if cookie:
        headers["Cookie"] = cookie

    last_err = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=30) as resp:
                data = json.load(resp)
            # leagueHistory wraps the payload in a single-element list.
            if history and isinstance(data, list):
                return data[0] if data else {}
            return data
        except urllib.error.HTTPError as e:
            if e.code == 401:
                raise ESPNAuthError(
                    "ESPN returned 401 (Unauthorized). Either the league was set back "
                    "to private (make it public again, or provide espn_s2/SWID cookies) "
                    "or the cookies in espn_config.json have expired."
                )
            last_err = e
            if e.code == 404:
                # Season/week simply doesn't exist; don't hammer.
                raise
        except (urllib.error.URLError, TimeoutError) as e:
            last_err = e
        if attempt < retries - 1:
            time.sleep(2 * (attempt + 1))
    raise RuntimeError(f"ESPN request failed after {retries} attempts: {url} ({last_err})")


def fetch_players(season, cfg=None):
    """Returns the season's player universe as {playerId: player dict}.

    Used to resolve draft picks (which only carry playerId) to names/positions.
    """
    cfg = cfg or config.load_config()
    url = f'{config.READ_HOST}/seasons/{season}/players?view=players_wl'
    headers = {
        "User-Agent": "Mozilla/5.0",
        "Accept": "application/json",
        "x-fantasy-filter": json.dumps({"filterActive": {"value": True}}),
    }
    cookie = config.cookie_header(cfg)
    if cookie:
        headers["Cookie"] = cookie
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=60) as resp:
        players = json.load(resp)
    return {p["id"]: p for p in players}


def get_status(season, cfg=None):
    """Returns the league status block (currentScoringPeriod, finalScoringPeriod...)."""
    data = fetch(season, ["mStatus"], cfg=cfg)
    status = data.get("status", {}) or {}
    status["scoringPeriodId"] = data.get("scoringPeriodId")
    return status


def current_week(season, cfg=None):
    """The NFL week ESPN currently considers active for this season."""
    status = get_status(season, cfg=cfg)
    return status.get("scoringPeriodId") or status.get("currentMatchupPeriod") or 1
