"""Cross-reference the public ESPN NFL scoreboard to recover opponent + result.

The fantasy payload has no opponent or game result, so we read the public NFL
scoreboard per week and index by team abbreviation. Returns, per NFL team:
  {"opponent": "@BUF" | "BUF", "status": "Win, 42-10" | "Loss, 16-20" | "",
   "state": "pre" | "in" | "post"}
`state` is the authoritative "has the game started" signal (pre = not started).
"""

import json
import urllib.error
import urllib.request

SCOREBOARD = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard"


def opponents_for_week(season, week, seasontype=2):
    """Maps NFL abbrev -> {opponent, status} for a given season/week. {} on failure."""
    url = f"{SCOREBOARD}?dates={season}&seasontype={seasontype}&week={week}"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.load(resp)
    except (urllib.error.URLError, TimeoutError, ValueError):
        return {}

    result = {}
    for event in data.get("events", []):
        for comp in event.get("competitions", []):
            competitors = comp.get("competitors", [])
            if len(competitors) != 2:
                continue
            status = (comp.get("status") or {}).get("type") or {}
            completed = bool(status.get("completed"))
            by_home = {c.get("homeAway"): c for c in competitors}
            home, away = by_home.get("home"), by_home.get("away")
            if not home or not away:
                continue
            for team, other, is_home in ((home, away, True), (away, home, False)):
                abbr = (team.get("team") or {}).get("abbreviation")
                opp_abbr = (other.get("team") or {}).get("abbreviation")
                if not abbr or not opp_abbr:
                    continue
                opponent = opp_abbr if is_home else f"@{opp_abbr}"
                result[abbr] = {
                    "opponent": opponent,
                    "status": _status_string(team, other, status, completed),
                    "state": status.get("state"),  # "pre" | "in" | "post"
                }
    return result


def _status_string(team, other, status, completed):
    """'Win, 42-10' from this team's perspective; live/scheduled -> short label."""
    try:
        my = int(float(team.get("score", 0)))
        opp = int(float(other.get("score", 0)))
    except (TypeError, ValueError):
        my = opp = 0
    if not completed:
        # In-progress or scheduled game: expose the state name (e.g. "In Progress").
        desc = status.get("shortDetail") or status.get("description") or ""
        return desc
    if my > opp:
        outcome = "Win"
    elif my < opp:
        outcome = "Loss"
    else:
        outcome = "Tie"
    return f"{outcome}, {my}-{opp}"
