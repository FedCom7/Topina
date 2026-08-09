"""Orchestrator: build the fantasy_data_<season>.json structure from ESPN."""

from datetime import datetime

from . import client, config, nfl_games, normalize


def _load_scoring(season, cfg):
    """League scoring map {statId: points} from mSettings, used to reconstruct
    projected D/ST points (ESPN returns 0 for those in preseason)."""
    try:
        data = client.fetch(season, ["mSettings"], cfg=cfg)
        items = data["settings"]["scoringSettings"]["scoringItems"]
        return {it["statId"]: it.get("points", 0) for it in items}
    except (KeyError, TypeError):
        return {}


def _weeks_to_scrape(season, cfg, weeks):
    """Resolve the list of NFL weeks to fetch."""
    if weeks:
        return [int(w) for w in weeks]
    status = client.get_status(season, cfg=cfg)
    final = status.get("finalScoringPeriod") or 17
    current = status.get("scoringPeriodId") or status.get("currentMatchupPeriod") or 1
    # Include the upcoming week too, so next week's (projected) matchups are
    # refreshed ahead of kickoff. Capped at the season's final week.
    return list(range(1, min(final, current + 1) + 1))


def build_season(season, weeks=None, cfg=None, verbose=True):
    """Returns the full fantasy_data dict for a season (or just the given weeks)."""
    cfg = cfg or config.load_config()
    scoring = _load_scoring(season, cfg)
    result = {
        "league_id": cfg["league_id"],
        "season": str(season),
        "scraped_at": datetime.now().isoformat(),
        "weeks": {},
    }

    for week in _weeks_to_scrape(season, cfg, weeks):
        if verbose:
            print(f"--- Week {week} ---")
        data = client.fetch(season, ["mBoxscore", "mMatchup"], week=week, cfg=cfg)
        opponents = nfl_games.opponents_for_week(season, week)
        matchups = []
        for m in data.get("schedule", []):
            if m.get("matchupPeriodId") != week:
                continue
            # Skip matchups whose rosters aren't populated for this scoring period.
            if not (m.get("home", {}).get("rosterForCurrentScoringPeriod")
                    or m.get("away", {}).get("rosterForCurrentScoringPeriod")):
                continue
            matchup = normalize.normalize_matchup(m, week, opponents, cfg, scoring)
            matchups.append(matchup)
            if verbose:
                print(f"  {matchup['team1']['name']} {matchup['team1']['score']} "
                      f"vs {matchup['team2']['name']} {matchup['team2']['score']}")
        result["weeks"][str(week)] = {"matchups": matchups}

    return result
