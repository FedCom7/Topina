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

    explicit = bool(weeks)
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

    if not explicit:
        _drop_early_placeholders(result["weeks"], verbose)
    return result


def _is_closed(week_data):
    """A week is closed when every matchup has a decided winner."""
    matchups = week_data.get("matchups") or []
    return bool(matchups) and all(
        m.get("winner") and m.get("winner") != "UNDECIDED" for m in matchups)


def _drop_early_placeholders(weeks, verbose=True):
    """Keep the upcoming week only once the previous one is closed.

    _weeks_to_scrape asks for the current week plus the next, so the next
    week's matchups are on Firebase ahead of kickoff. But "current" comes from
    ESPN's status, and before week 1 is over that already yields week 2: the
    run of 2026-09-09 (draft done, week 1 not even kicked off) published an
    empty week 2 next to an empty week 1, and the site showed a W2 while
    week 1 was still being played.

    The placeholder for week N+1 belongs to the run that closes week N — the
    Tuesday after Monday Night. So every week past (last closed week + 1) is
    dropped: before kickoff only week 1 stays, after week 1 closes weeks 1
    and 2, and so on. Weeks are never dropped from the middle.
    """
    closed = [int(w) for w, d in weeks.items() if _is_closed(d)]
    limit = (max(closed) if closed else 0) + 1
    for w in sorted((int(k) for k in weeks), reverse=True):
        if w > limit:
            if verbose:
                print(f"  (week {w} not published: week {w - 1} is not closed yet)")
            del weeks[str(w)]
