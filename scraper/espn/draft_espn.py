"""Orchestrator: build the draft_data_<season>.json structure from ESPN."""

from datetime import datetime

from . import client, config, maps


def draft_is_done(season, cfg=None):
    """Has the league actually drafted?

    Before the draft ESPN still returns the 60 pick slots, but with
    playerId = -1 — empty boxes, not selections. It also fills every team with
    a placeholder roster (acquisitionType = null), which is why nothing should
    be published until this returns True: those players belong to nobody.

    `drafted` is the official flag; the real-pick count is the belt-and-braces
    in case ESPN is slow to raise it.
    """
    cfg = cfg or config.load_config()
    detail = client.fetch(season, ["mDraftDetail"], cfg=cfg).get("draftDetail", {}) or {}
    if detail.get("drafted"):
        return True
    return any((p.get("playerId") or -1) > 0 for p in (detail.get("picks") or []))


def _is_drafted(player_id):
    """A pick is made when it carries a player.

    ESPN marks an empty pick with playerId -1. Defenses, though, have NEGATIVE
    ids of their own (Rams D/ST = -16014): the old `> 0` test threw away every
    drafted D/ST, and the 2026 draft came out with 14 picks per team instead
    of 15 — the site then listed each team's defense as a waiver pickup.
    """
    return player_id is not None and player_id != -1 and player_id != 0


def build_draft(season, cfg=None, verbose=True):
    """Returns the draft_data dict for a season, keyed by canonical team name.

    Note: before the league's draft happens ESPN returns placeholder picks
    (playerId = -1); in that case teams get empty pick lists.
    """
    cfg = cfg or config.load_config()
    data = client.fetch(season, ["mDraftDetail"], cfg=cfg)
    detail = data.get("draftDetail", {}) or {}
    picks = detail.get("picks", []) or []

    result = {
        "season": str(season),
        "scraped_at": datetime.now().isoformat(),
        "teams": {},
    }
    # Pre-create the four teams so empty drafts still list them.
    for tid, name in (cfg.get("team_names") or {}).items():
        result["teams"].setdefault(name, [])

    real_picks = [p for p in picks if _is_drafted(p.get("playerId"))]
    players = client.fetch_players(season, cfg=cfg) if real_picks else {}

    for p in picks:
        player_id = p.get("playerId")
        if not _is_drafted(player_id):
            continue  # not yet drafted
        team_name = config.team_name(cfg, p.get("teamId")) or f"Team {p.get('teamId')}"
        info = players.get(player_id, {})
        position = maps.POSITION_ID_TO_LABEL.get(info.get("defaultPositionId"), "")
        name = info.get("fullName", f"#{player_id}")
        nfl_team = maps.PRO_TEAM_ABBREV.get(info.get("proTeamId"), "")
        if position == "DEF":
            # Same naming as the weekly rosters (normalize.normalize_player):
            # "Los Angeles Rams", not "Rams D/ST", and no nfl_team. The site
            # matches draft picks to roster players BY NAME — with two names
            # for the same defense, every drafted D/ST shows up as a pickup.
            name = maps.PRO_TEAM_FULL_NAME.get(info.get("proTeamId")) or name.replace("D/ST", "").strip()
            nfl_team = ""
        result["teams"].setdefault(team_name, []).append({
            "pick": p.get("overallPickNumber"),
            "name": name,
            "position": position,
            "nfl_team": nfl_team,
        })

    for team in result["teams"]:
        result["teams"][team].sort(key=lambda x: x["pick"] if isinstance(x["pick"], int) else 0)

    if verbose:
        total = sum(len(v) for v in result["teams"].values())
        print(f"Draft {season}: {total} picks across {len(result['teams'])} teams "
              f"({'not drafted yet' if not real_picks else 'ok'})")
    return result
