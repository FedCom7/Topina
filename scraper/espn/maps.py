"""ESPN id → label maps: stat ids, lineup slots, positions, pro teams.

Offensive stat ids were confirmed empirically from real player projections
(Aug 2026). Kicker/defense ids are magnitude-checked against D/ST projections
and the league's scoringItems; they should be re-validated on the first real
game week (September) — but note that a player's fantasy_points always come
straight from ESPN's appliedStatTotal, so a mislabelled raw stat only affects
a display column, never a score.
"""

# --- ESPN statId -> our stats{} key (matches the historical NFL.com vocabulary) ---
# Offense (high confidence)
OFFENSE_STAT_IDS = {
    3: "pass_yds",
    4: "pass_td",
    20: "pass_int",
    24: "rush_yds",
    25: "rush_td",
    42: "rec_yds",
    43: "rec_td",
    53: "rec",
    72: "fum_lost",
    # additive extras (not shown by the viewer, handy for a richer live view)
    0: "pass_att",
    1: "pass_comp",
    23: "rush_att",
    58: "targets",
}
# Composite offense keys summed from several statIds
OFFENSE_COMPOSITE = {
    "two_pt": (19, 26, 44),      # passing / rushing / receiving 2pt conversions
    "ret_td": (101, 102),        # kickoff + punt return TD
    "fum_td": (103, 106),        # fumble return TD
}

# Kicker (ESPN only brackets under-40 / 40-49 / 50+)
KICKER_STAT_IDS = {
    86: "pat_made",
    80: "fg_0_39",
    77: "fg_40_49",
    74: "fg_50_plus",
    83: "fg_made",
    84: "fg_att",
}

# Defense / Special teams (magnitude-checked; re-validate on real games)
DEFENSE_STAT_IDS = {
    99: "sack",
    95: "def_int",
    96: "fum_rec",
    98: "safety",
    105: "def_td",
    120: "pts_allowed",
    127: "yds_allowed",
}
DEFENSE_COMPOSITE = {
    "def_ret_td": (101, 102, 103),
    "def_2pt_ret": (104,),
}

# --- ESPN lineupSlotId -> roster position label (historical NFL.com labels) ---
SLOT_TO_POSITION = {
    0: "QB",
    1: "QB",     # team QB (unused here)
    2: "RB",
    3: "W/R",    # RB/WR flex
    4: "WR",
    5: "W/T",
    6: "TE",
    7: "W/R/T",
    16: "DEF",
    17: "K",
    20: "BN",    # bench
    21: "RES",   # injured reserve (IR)
    23: "W/R/T", # flex (RB/WR/TE)
}
BENCH_SLOTS = {20, 21}

# --- ESPN defaultPositionId -> NFL position label (position_in_team) ---
POSITION_ID_TO_LABEL = {
    1: "QB",
    2: "RB",
    3: "WR",
    4: "TE",
    5: "K",
    16: "DEF",
}

# --- ESPN proTeamId -> NFL abbreviation ---
PRO_TEAM_ABBREV = {
    0: "FA", 1: "ATL", 2: "BUF", 3: "CHI", 4: "CIN", 5: "CLE", 6: "DAL",
    7: "DEN", 8: "DET", 9: "GB", 10: "TEN", 11: "IND", 12: "KC", 13: "LV",
    14: "LAR", 15: "MIA", 16: "MIN", 17: "NE", 18: "NO", 19: "NYG", 20: "NYJ",
    21: "PHI", 22: "ARI", 23: "PIT", 24: "LAC", 25: "SF", 26: "SEA", 27: "TB",
    28: "WSH", 29: "CAR", 30: "JAX", 33: "BAL", 34: "HOU",
}

# --- ESPN proTeamId -> full "City Nickname" (defense display name, matches the
# historical NFL.com schema so the site's logo/photo lookup keeps working) ---
PRO_TEAM_FULL_NAME = {
    1: "Atlanta Falcons", 2: "Buffalo Bills", 3: "Chicago Bears",
    4: "Cincinnati Bengals", 5: "Cleveland Browns", 6: "Dallas Cowboys",
    7: "Denver Broncos", 8: "Detroit Lions", 9: "Green Bay Packers",
    10: "Tennessee Titans", 11: "Indianapolis Colts", 12: "Kansas City Chiefs",
    13: "Las Vegas Raiders", 14: "Los Angeles Rams", 15: "Miami Dolphins",
    16: "Minnesota Vikings", 17: "New England Patriots", 18: "New Orleans Saints",
    19: "New York Giants", 20: "New York Jets", 21: "Philadelphia Eagles",
    22: "Arizona Cardinals", 23: "Pittsburgh Steelers", 24: "Los Angeles Chargers",
    25: "San Francisco 49ers", 26: "Seattle Seahawks", 27: "Tampa Bay Buccaneers",
    28: "Washington Commanders", 29: "Carolina Panthers", 30: "Jacksonville Jaguars",
    33: "Baltimore Ravens", 34: "Houston Texans",
}

# Sentinel keys the viewer uses to classify a row (must always be present)
SENTINELS = {"offense": "pass_yds", "kicker": "pat_made", "defense": "sack"}


def build_stats(raw_stats, position_label):
    """Turns ESPN's {statId: value} into our stats{} dict for a player type.

    Always includes the type's full key set (zeros when absent) so the viewer
    renders complete columns and can classify the row by its sentinel key.
    """
    def g(sid):
        return raw_stats.get(str(sid), raw_stats.get(sid, 0)) or 0

    stats = {}
    if position_label == "K":
        id_map, composite = KICKER_STAT_IDS, {}
    elif position_label == "DEF":
        id_map, composite = DEFENSE_STAT_IDS, DEFENSE_COMPOSITE
    else:
        id_map, composite = OFFENSE_STAT_IDS, OFFENSE_COMPOSITE

    for sid, key in id_map.items():
        stats[key] = _num(g(sid))
    for key, sids in composite.items():
        stats[key] = _num(sum(g(s) for s in sids))

    # Guarantee the sentinel key exists so the viewer classifies the row.
    if position_label == "K":
        stats.setdefault("pat_made", 0)
    elif position_label == "DEF":
        stats.setdefault("sack", 0)
    else:
        stats.setdefault("pass_yds", 0)
    return stats


def _num(v):
    """Integer when whole, else rounded float — mirrors the old parse_stat_value."""
    try:
        f = float(v)
    except (TypeError, ValueError):
        return 0
    if f == int(f):
        return int(f)
    return round(f, 2)
