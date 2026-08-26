"""Arricchisce il referto infortuni con l'esito REALE: il giocatore ha
davvero giocato quella settimana, o e' stato dichiarato inactive a ridosso
della partita?

Perche' serve
--------------
Il referto settimanale (data/nfl/injuries_<anno>.json, da nflverse) si ferma
al venerdi': porta solo la designazione Out/Doubtful/Questionable pre-partita,
mai l'esito reale della domenica. Un giocatore "Questionable" puo' finire
regolarmente titolare o essere dichiarato inactive 90 minuti prima del
kickoff — il referto non lo dice.

Fonte: il roster ufficiale ESPN della singola partita (core API,
".../events/{id}/competitions/{id}/competitors/{teamId}/roster"), che porta
un campo booleano `didNotPlay` per ogni giocatore in rosa. Verificato sia dal
vivo (stagione 2026) sia su una partita storica (2023): il dato c'e' ed e'
affidabile per tutte le stagioni.

Scope: SOLO i giocatori delle nostre 4 squadre fantasy che quella settimana
avevano gia' uno stato sul referto infortuni (Out/Doubtful/Questionable) —
e' l'unico caso ambiguo che interessa il sito. Tirare giu' gli inattivi di
TUTTE le partite NFL per 7 stagioni costerebbe migliaia di richieste per un
dato che altrove non si legge mai.

L'esito va in un file SEPARATO (data/nfl/inactives_<anno>.json), non dentro
injuries_<anno>.json: quel file viene rigenerato DA ZERO da
build-nfl-injuries.mjs a ogni refresh da nflverse, e cancellerebbe questo
arricchimento senza preavviso.

Matching: l'API ESPN porta solo il COGNOME per riga di rosa (niente nome
completo senza seguire un $ref per giocatore, troppo costoso su migliaia di
righe). Il match e' quindi per cognome normalizzato dentro la rosa della
squadra NFL giusta quella settimana; se due giocatori della stessa squadra
condividono il cognome ED hanno un esito diverso, la riga resta ambigua e si
scarta invece di indovinare.

Uso:  py -3 scripts/espn/build_inactives.py            # 2019..2025
      py -3 scripts/espn/build_inactives.py 2024 2025   # una o piu' stagioni
"""
import concurrent.futures as cf
import json
import re
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SB = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard"
CORE = "https://sports.core.api.espn.com/v2/sports/football/leagues/nfl"

# nflverse -> abbreviazione ESPN: unica differenza reale fra i due schemi
# (verificato confrontando lo scoreboard ESPN con l'elenco squadre nflverse).
NFLVERSE_TO_ESPN = {"WAS": "WSH"}


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def fetch_safe(url):
    try:
        return fetch(url)
    except (urllib.error.URLError, TimeoutError, ValueError):
        return None


def norm(s):
    """Solo lettere minuscole: assorbe spazi, punti, apostrofi, trattini e
    suffissi (Jr./Sr./III...) senza bisogno di un elenco a parte."""
    return re.sub(r"[^a-z]", "", (s or "").lower())


def surname(full_name):
    parts = (full_name or "").strip().split()
    return norm(parts[-1]) if parts else ""


def load_json(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def targets_for_year(year):
    """(week, nfl_team_nflverse, full_name) per ogni titolare/panchinaro delle
    nostre 4 squadre che quella settimana aveva uno stato sul referto.

    La squadra NFL viene SEMPRE da injuries.json, mai dal campo `nfl_team` di
    fantasy_data: quel campo puo' essere stale (es. Cooper Kupp segnato "SEA"
    nell'archivio 2024, quando quell'anno giocava per LAR — probabilmente
    aggiornato a una ripassata successiva dei dati). injuries.json invece
    tiene la squadra ESATTA di quella stagione, perche' e' costruito da un
    report settimana per settimana.
    """
    fpath = ROOT / "data" / "fantasy" / f"fantasy_data_{year}.json"
    ipath = ROOT / "data" / "nfl" / f"injuries_{year}.json"
    if not fpath.exists() or not ipath.exists():
        return []

    fantasy = load_json(fpath)
    injuries = load_json(ipath)

    # chi era in rosa fantasy quella settimana (nome pieno normalizzato),
    # a prescindere da cosa dice il campo nfl_team.
    our_players_by_week = {}
    for wk, wkdata in (fantasy.get("weeks") or {}).items():
        week = int(wk)
        nomi = our_players_by_week.setdefault(week, set())
        for m in wkdata.get("matchups", []):
            for side in ("team1", "team2"):
                t = m.get(side)
                if not t:
                    continue
                for p in [*(t.get("starters") or []), *(t.get("bench") or [])]:
                    pos = (p.get("position_in_team") or p.get("position") or "").upper()
                    if pos in ("DEF", "D/ST"):
                        continue
                    if p.get("name"):
                        nomi.add(norm(p["name"]))

    out = set()
    for team, players in injuries.get("teams", {}).items():
        for p in players:
            name = p.get("name")
            if not name or norm(name) == "":
                continue
            for w in p.get("weeks", []):
                stato = w.get("status")
                week = w.get("week")
                if not stato:  # Out / Doubtful / Questionable (mai None/Probable)
                    continue
                if norm(name) in our_players_by_week.get(week, ()):
                    out.add((week, team, name))
    return sorted(out)


def event_ids_for_week(year, week):
    """abbreviazione ESPN -> (eventId, teamId) per una settimana. {} se offline."""
    data = fetch_safe(f"{SB}?dates={year}&seasontype=2&week={week}")
    out = {}
    if not data:
        return out
    for ev in data.get("events", []):
        for comp in ev.get("competitions", []):
            for c in comp.get("competitors", []):
                abbr = (c.get("team") or {}).get("abbreviation")
                if abbr:
                    out[abbr] = (ev["id"], c["id"])
    return out


def roster_didnotplay(event_id, team_id):
    """cognome normalizzato -> lista di didNotPlay (>1 elemento = omonimia)."""
    data = fetch_safe(f"{CORE}/events/{event_id}/competitions/{event_id}/competitors/{team_id}/roster")
    out = {}
    if not data:
        return out
    for e in data.get("entries", []):
        sn = norm(e.get("displayName"))
        if sn:
            out.setdefault(sn, []).append(bool(e.get("didNotPlay")))
    return out


def build_year(year):
    targets = targets_for_year(year)
    if not targets:
        print(f"  {year}: niente da arricchire (dati mancanti o nessun nostro giocatore sul referto)")
        return

    weeks_needed = sorted({w for w, _, _ in targets})
    print(f"  {year}: {len(targets)} giocatore-settimana da controllare su {len(weeks_needed)} giornate")

    with cf.ThreadPoolExecutor(max_workers=8) as ex:
        sched = dict(zip(weeks_needed, ex.map(lambda w: event_ids_for_week(year, w), weeks_needed)))

    # Solo le partite (settimana, squadra NFL) che ci servono davvero.
    needed = set()
    for week, nfl_team, _ in targets:
        espn_abbr = NFLVERSE_TO_ESPN.get(nfl_team, nfl_team)
        info = sched.get(week, {}).get(espn_abbr)
        if info:
            needed.add((week, espn_abbr, info[0], info[1]))
    needed = sorted(needed)

    with cf.ThreadPoolExecutor(max_workers=8) as ex:
        roster_maps = list(ex.map(lambda g: roster_didnotplay(g[2], g[3]), needed))
    rosters = {(w, a): rm for (w, a, _, _), rm in zip(needed, roster_maps)}

    result = {}
    resolved = ambiguous = missing = 0
    for week, nfl_team, full_name in targets:
        espn_abbr = NFLVERSE_TO_ESPN.get(nfl_team, nfl_team)
        roster = rosters.get((week, espn_abbr))
        candidates = roster.get(surname(full_name)) if roster else None
        if not candidates:
            missing += 1
            continue
        if len(set(candidates)) > 1:
            # stesso cognome in rosa, esiti diversi: non si puo' decidere senza indovinare
            ambiguous += 1
            continue
        result.setdefault(norm(full_name), {})[str(week)] = candidates[0]
        resolved += 1

    print(f"  {year}: risolti {resolved}, ambigui {ambiguous} (cognome doppio), non trovati {missing}")

    out_path = ROOT / "data" / "nfl" / f"inactives_{year}.json"
    payload = {
        "season": int(year),
        "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "players": result,
    }
    out_path.write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")
    print(f"  -> {out_path.relative_to(ROOT)}")


if __name__ == "__main__":
    years = sys.argv[1:] or ["2019", "2020", "2021", "2022", "2023", "2024", "2025"]
    for y in years:
        print(f"Stagione {y}")
        build_year(y)
