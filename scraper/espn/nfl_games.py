"""Cross-reference the public ESPN NFL scoreboard to recover opponent + result.

The fantasy payload has no opponent or game result, so we read the public NFL
scoreboard per week and index by team abbreviation. Returns, per NFL team:
  {"opponent": "@BUF" | "BUF", "status": "Win, 42-10" | "Loss, 16-20" | "",
   "state": "pre" | "in" | "post"}
`state` is the authoritative "has the game started" signal (pre = not started).
"""

import json
import time
import urllib.error
import urllib.request

from . import config, maps

SCOREBOARD = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard"


def opponents_for_week(season, week, seasontype=2):
    """Maps NFL abbrev -> {opponent, status, state} for a given season/week.

    The public scoreboard is the rich source (it has the result too), but from
    GitHub's runners it failed silently for the whole 2026 week 1: every
    player was published with an empty opponent. So: retry it, and if it still
    fails fall back to the fantasy API's pro-team schedule — same host as the
    league data, which works from the runners. That one has no score, so
    `status` stays empty, but the opponent is there. {} only if both fail.
    """
    url = f"{SCOREBOARD}?dates={season}&seasontype={seasontype}&week={week}"
    data = None
    for attempt in range(3):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=30) as resp:
                data = json.load(resp)
            break
        except (urllib.error.URLError, TimeoutError, ValueError) as e:
            print(f"  scoreboard W{week} attempt {attempt + 1} failed: {e}")
            time.sleep(3)
    if data is None or not data.get("events"):
        fallback = _opponents_from_fantasy(season, week) if seasontype == 2 else {}
        print(f"  scoreboard W{week} unavailable: {len(fallback)} opponents from the fantasy schedule")
        return fallback

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


def _opponents_from_fantasy(season, week):
    """Opponents from the fantasy API's pro-team schedule (no scores)."""
    url = f"{config.READ_HOST}/seasons/{season}?view=proTeamSchedules_wl"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.load(resp)
    except (urllib.error.URLError, TimeoutError, ValueError) as e:
        print(f"  fantasy pro-team schedule failed: {e}")
        return {}
    now_ms = time.time() * 1000
    result = {}
    for team in (data.get("settings") or {}).get("proTeams", []):
        for g in (team.get("proGamesByScoringPeriod") or {}).get(str(week), []):
            home, away = g.get("homeProTeamId"), g.get("awayProTeamId")
            tid = team.get("id")
            other = away if tid == home else home
            abbr, opp = maps.PRO_TEAM_ABBREV.get(tid), maps.PRO_TEAM_ABBREV.get(other)
            if not abbr or not opp:
                continue
            state = "post" if g.get("statsOfficial") else ("pre" if (g.get("date") or 0) > now_ms else "in")
            result[abbr] = {"opponent": opp if tid == home else f"@{opp}", "status": "", "state": state}
    return result
