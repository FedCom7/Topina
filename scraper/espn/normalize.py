"""ESPN payload -> historical fantasy_data schema (+ additive live fields)."""

from . import config, maps


def _player_stats_row(player, week):
    """Picks the real (statSourceId=0) single-week row for the week; falls back
    to the projection (statSourceId=1) when the game hasn't been played yet."""
    real = proj = None
    for row in player.get("stats", []) or []:
        if row.get("statSplitTypeId") not in (1, None):
            continue
        if row.get("scoringPeriodId") not in (week, None):
            continue
        if row.get("statSourceId") == 0:
            real = row
        elif row.get("statSourceId") == 1:
            proj = row
    return real, proj


def _num_str(value):
    """Formats a fantasy total the way the old schema did: a string like '31.18'."""
    try:
        f = float(value or 0)
    except (TypeError, ValueError):
        f = 0.0
    return f"{f:.2f}"


def _projected_total(proj, scoring):
    """Projected fantasy points for a stats row.

    ESPN's own projected `appliedTotal` is exact for offense/kickers, but for
    D/ST it comes back as 0 in preseason even though the projected raw stats
    exist. When that happens, reconstruct the total from the league's scoring
    rules (statId -> points), which reproduces ESPN's number exactly for the
    positions where ESPN does provide it.
    """
    total = proj.get("appliedTotal", 0) or 0
    if total or not scoring:
        return total
    raw = proj.get("stats", {}) or {}
    out = 0.0
    for k, v in raw.items():
        try:
            out += float(v) * scoring.get(int(k), 0)
        except (TypeError, ValueError):
            continue
    return out


def _stat_type(pos_label):
    """Player type used to pick the stats{} vocabulary."""
    return "K" if pos_label == "K" else "DEF" if pos_label == "DEF" else "OFF"


def normalize_player(entry, week, opponents, scoring=None):
    """One ESPN roster entry -> historical player dict + additive live fields."""
    ppe = entry.get("playerPoolEntry", {}) or {}
    player = ppe.get("player", {}) or {}

    slot = entry.get("lineupSlotId")
    position = maps.SLOT_TO_POSITION.get(slot, str(slot))
    pos_label = maps.POSITION_ID_TO_LABEL.get(player.get("defaultPositionId"), "")
    nfl_team = maps.PRO_TEAM_ABBREV.get(player.get("proTeamId"), "")
    name = player.get("fullName", "") or ""
    if pos_label == "DEF":
        nfl_team = ""  # historical schema left DEF nfl_team empty
        # ESPN names a defense "Patriots D/ST"; use the full "City Nickname" the
        # historical schema used ("New England Patriots") so the site's logo/photo
        # lookup keeps matching. Fall back to stripping the suffix if unmapped.
        full = maps.PRO_TEAM_FULL_NAME.get(player.get("proTeamId"))
        if full:
            name = full
        elif name.endswith("D/ST"):
            name = name[:-4].strip()

    real, proj = _player_stats_row(player, week)
    stat_type = _stat_type(pos_label)
    # Canonical stats are REAL only (all zeros before kickoff); the projection is
    # kept in a separate field so consumers can tell them apart.
    stats = maps.build_stats((real or {}).get("stats", {}) or {}, stat_type)

    applied_total = ppe.get("appliedStatTotal", 0)

    # opponent/status come from the public NFL scoreboard, keyed by NFL abbrev.
    game = opponents.get(maps.PRO_TEAM_ABBREV.get(player.get("proTeamId"), ""), {})

    # Has the player's NFL game kicked off? The scoreboard state is authoritative
    # ("pre" = not started); the lineup lock is unreliable pre-season (it can read
    # locked before kickoff). If the scoreboard is unavailable, fall back to real
    # stat production, then to the lock.
    state = game.get("state")
    if state in ("in", "post"):
        started = True
    elif state == "pre":
        started = False
    else:
        started = bool(applied_total) or (real is not None and bool(real.get("appliedTotal"))) \
            or bool(ppe.get("lineupLocked") or ppe.get("rosterLocked"))

    out = {
        "position": position,
        "name": name,
        "position_in_team": pos_label,
        "nfl_team": nfl_team,
        "opponent": game.get("opponent", ""),
        "status": game.get("status", ""),
        "fantasy_points": _num_str(applied_total),
        "stats": stats,
    }

    # --- additive live fields (ignored by existing consumers) ---
    out["injury_status"] = entry.get("injuryStatus") or ("INJURED" if player.get("injured") else "NORMAL")
    out["locked"] = started
    out["started"] = started
    if player.get("lastNewsDate"):
        out["last_news_date"] = player.get("lastNewsDate")
    # Projection (statSourceId=1): always surfaced when present, so a game that
    # hasn't started yet can display projected points/stats instead of zeros.
    if proj is not None:
        out["projected_points"] = _num_str(_projected_total(proj, scoring))
        out["projected_stats"] = maps.build_stats(proj.get("stats", {}) or {}, stat_type)
    # applied_stats: how many points each statId produced (exact scoring receipts)
    applied = (real or {}).get("appliedStats")
    if applied:
        out["applied_stats"] = {str(k): round(float(v), 2) for k, v in applied.items() if v}
    return out


def normalize_team(side, week, opponents, cfg, scoring=None):
    """One matchup side (home/away) -> historical team dict + additive fields."""
    team_id = side.get("teamId")
    entries = (side.get("rosterForCurrentScoringPeriod") or {}).get("entries", []) or []

    starters, bench = [], []
    for entry in entries:
        player = normalize_player(entry, week, opponents, scoring)
        if not player["name"]:
            continue
        if entry.get("lineupSlotId") in maps.BENCH_SLOTS:
            bench.append(player)
        else:
            starters.append(player)

    # Live projected total: real points where the game has started, projection
    # otherwise. Converges on the real score as games finish; equals `score`
    # once every starter is locked.
    def _eff(p):
        if not p.get("started"):
            try:
                return float(p.get("projected_points", p["fantasy_points"]))
            except (TypeError, ValueError):
                pass
        try:
            return float(p["fantasy_points"])
        except (TypeError, ValueError):
            return 0.0

    projected_total = sum(_eff(p) for p in starters)

    return {
        "name": config.team_name(cfg, team_id) or f"Team {team_id}",
        "score": _num_str(side.get("totalPoints", 0)),
        "starters": starters,
        "bench": bench,
        # additive live fields
        "projected_score": _num_str(projected_total),
        "games_played": side.get("gamesPlayed"),
        "tiebreak": side.get("tiebreak"),
        "team_id": team_id,
    }


def normalize_matchup(matchup, week, opponents, cfg, scoring=None):
    """ESPN schedule entry -> {team1, team2, winner}."""
    home = normalize_team(matchup.get("home", {}), week, opponents, cfg, scoring)
    away = normalize_team(matchup.get("away", {}), week, opponents, cfg, scoring)
    result = {"team1": home, "team2": away}
    winner = matchup.get("winner")
    if winner and winner != "UNDECIDED":
        # ESPN winner is HOME/AWAY -> map to the team name
        result["winner"] = home["name"] if winner == "HOME" else away["name"]
    else:
        result["winner"] = "UNDECIDED"
    return result
