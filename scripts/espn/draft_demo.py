"""
DRAFT DI PROVA — TEMPORANEO, DA CANCELLARE A FINE PRESEASON.

    python scripts/espn/draft_demo.py cancella      <-- lanciare a preseason finita

Serve a collaudare Draft, Live e Game Center durante la preseason 2026, prima
che la lega abbia davvero draftato. Scrive sul nodo VERO
`draft/draft_data_<stagione>`, non su un nodo di prova: il sito deve comportarsi
esattamente come a draft fatto, quindi il dato dev'essere indistinguibile.
Proprio per questo va rimosso appena i test finiscono, altrimenti resta li' a
farsi passare per il draft della lega.

I giocatori sono le RISERVE, non i titolari: in preseason i titolari fanno una
serie o due e si siedono, mentre a giocare davvero sono i secondi e i terzi
della lista. Si prendono dalle depth chart ESPN — quarterback dal secondo in
giu', running back e tight end dal secondo, ricevitori dal quarto (tre partono
titolari) — e si scarta comunque chiunque stia nelle prime scelte fantasy, cosi'
nessuna prima scelta entra di straforo. Uniche eccezioni obbligate: i kicker
(uno per squadra, e in preseason calciano) e le difese di squadra.

    python scripts/espn/draft_demo.py carica   [--stagione 2026]
    python scripts/espn/draft_demo.py mostra   [--stagione 2026]
    python scripts/espn/draft_demo.py cancella [--stagione 2026]

`carica` scrive SOLO su Firebase, mai in `data/draft/`: quel file e' il segnale
che fa uscire subito la sentinella `espn-draft-watch.yml`, e scriverlo qui
significherebbe impedire il caricamento del draft vero quando arrivera'.
"""

import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from datetime import datetime

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, os.path.join(REPO, "scraper"))
os.environ.setdefault("ESPN_CONFIG", os.path.join(REPO, "scraper", "espn_config.json"))

from espn import config  # noqa: E402

RTDB_URL = "https://topina-9cd75-default-rtdb.firebaseio.com"
READ_HOST = "https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl"
SITE_API = "https://site.api.espn.com/apis/site/v2/sports/football/nfl"


def nodo(stagione):
    return f"draft/draft_data_{stagione}"


def firebase(metodo, stagione, payload=None):
    req = urllib.request.Request(
        f"{RTDB_URL}/{nodo(stagione)}.json", data=payload, method=metodo,
        headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return resp.read().decode("utf-8")
    except urllib.error.HTTPError as e:
        sys.exit(f"Firebase ha risposto {e.code}: {e.read().decode('utf-8', 'replace')[:200]}")


def leggi(url, headers=None):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0", **(headers or {})})
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.load(resp)


CORE_API = "https://sports.core.api.espn.com/v2/sports/football/leagues/nfl"

# Quanti partono titolari in ogni reparto: tutto quello che sta sotto e' riserva,
# ed e' chi in preseason gioca davvero.
TITOLARI = {"QB": 1, "RB": 1, "WR": 3, "TE": 1}

# Composizione di ogni rosa (15 scelte a testa), nell'ordine in cui vengono
# chiamate: rispecchia gli slot della lega, 9 titolari + 6 di panchina.
TEMPLATE = ["RB", "WR", "QB", "RB", "WR", "TE", "RB", "WR",
            "DEF", "K", "RB", "WR", "QB", "RB", "WR"]


def squadre_in_preseason(stagione):
    """Sigle NFL che hanno una partita di preseason ancora da giocare."""
    sigle = set()
    for settimana in (1, 2, 3, 4):
        try:
            d = leggi(f"{SITE_API}/scoreboard?seasontype=1&week={settimana}&dates={stagione}")
        except Exception:
            continue
        for ev in d.get("events", []):
            comp = (ev.get("competitions") or [{}])[0]
            if (comp.get("status", {}).get("type", {}) or {}).get("completed"):
                continue
            for c in comp.get("competitors", []):
                sigle.add((c.get("team", {}).get("abbreviation") or "").upper())
    return sigle


def squadre_nfl():
    """Sigle e nomi delle 32 squadre NFL, per id ESPN."""
    d = leggi(f"{SITE_API}/teams?limit=32")
    out = {}
    for gruppo in d.get("sports", [{}])[0].get("leagues", [{}])[0].get("teams", []):
        t = gruppo.get("team", {})
        out[t["id"]] = (t.get("abbreviation", "").upper(), t.get("displayName", ""))
    return out


def riserve_di(team_id, stagione):
    """Le riserve di una squadra NFL: [(ruolo, rank, nome)] con rank >= 2.

    La depth chart da' l'ordine ma non i nomi (solo i riferimenti agli atleti),
    la rosa da' i nomi: si incrociano sull'id.
    """
    try:
        rosa = leggi(f"{SITE_API}/teams/{team_id}/roster")
        depth = leggi(f"{CORE_API}/seasons/{stagione}/teams/{team_id}/depthcharts")
    except Exception:
        return []
    nome = {a["id"]: a.get("displayName", "") for g in rosa.get("athletes", []) for a in g.get("items", [])}

    fuori = []
    for gruppo in depth.get("items", []):
        for voce in (gruppo.get("positions") or {}).values():
            ruolo = (voce.get("position", {}) or {}).get("abbreviation", "").upper()
            if ruolo not in TITOLARI and ruolo != "PK":
                continue
            for a in sorted(voce.get("athletes", []), key=lambda x: x.get("rank", 99)):
                rank = a.get("rank", 99)
                aid = a["athlete"]["$ref"].split("/athletes/")[1].split("?")[0]
                if not nome.get(aid):
                    continue
                # il kicker e' uno solo per squadra, e in preseason calcia: si
                # prende com'e', senza pretendere che esista un vice
                if ruolo == "PK":
                    if rank == 1:
                        fuori.append(("K", rank, nome[aid]))
                    continue
                if rank > TITOLARI[ruolo]:
                    fuori.append((ruolo, rank, nome[aid]))
    return fuori


def costruisci(stagione, cfg):
    # nomi delle prime scelte fantasy: da escludere comunque, anche se sulla
    # depth chart risultassero riserve
    prime_scelte = set()
    try:
        url = f"{READ_HOST}/seasons/{stagione}/segments/0/leagues/{cfg['league_id']}?view=kona_player_info"
        filtro = {"players": {"limit": 150,
                              "sortDraftRanks": {"sortPriority": 1, "sortAsc": True, "value": "STANDARD"}}}
        d = leggi(url, {"x-fantasy-filter": json.dumps(filtro), "Accept": "application/json"})
        prime_scelte = {e["player"]["fullName"] for e in d.get("players", [])}
    except Exception as e:
        print(f"listone prime scelte non disponibile ({e}): ci si fida della sola depth chart")

    preseason = squadre_in_preseason(stagione)
    squadre_nfl_info = squadre_nfl()

    pool = {r: [] for r in ("QB", "RB", "WR", "TE", "K")}
    difese = []
    for tid, (sigla, nome_completo) in sorted(squadre_nfl_info.items(), key=lambda x: x[1][0]):
        if sigla not in preseason:
            continue
        difese.append({"name": nome_completo, "position": "DEF", "nfl_team": ""})
        for ruolo, rank, nome in riserve_di(tid, stagione):
            if nome in prime_scelte:
                continue
            pool[ruolo].append({"name": nome, "position": ruolo, "nfl_team": sigla, "_rank": rank})

    # dentro ogni ruolo, prima chi sta piu' in alto nella depth chart: e' chi
    # prende piu' snap fra le riserve
    for r in pool:
        pool[r].sort(key=lambda g: (g["_rank"], g["name"]))
    mancanti = {r: len(v) for r, v in pool.items() if len(v) < TEMPLATE.count(r) * 4}
    if mancanti:
        sys.exit(f"riserve insufficienti per {mancanti}: ESPN non ha risposto per tutte le squadre")

    nomi = cfg.get("team_names") or {}
    ordine_tid = sorted(nomi, key=int)
    squadre = {nomi[t]: [] for t in ordine_tid}

    usate_sigle = set()
    def prendi(ruolo):
        """Prossima riserva libera, evitando due giocatori della stessa squadra
        NFL finche' ce ne sono altre: cosi' le partite seguite sono tante."""
        lista = pool[ruolo]
        for i, g in enumerate(lista):
            if g["nfl_team"] not in usate_sigle:
                usate_sigle.add(g["nfl_team"])
                return lista.pop(i)
        return lista.pop(0)

    scelta = 0
    for giro, ruolo in enumerate(TEMPLATE):
        sequenza = ordine_tid if giro % 2 == 0 else list(reversed(ordine_tid))
        for tid in sequenza:
            scelta += 1
            if ruolo == "DEF":
                g = difese.pop(0)
            else:
                g = prendi(ruolo)
                g.pop("_rank", None)
            g["pick"] = scelta
            squadre[nomi[tid]].append(g)

    return {
        "season": str(stagione),
        "scraped_at": datetime.now().isoformat(),
        "demo": True,          # marchio nel dato: e' il draft di prova, va cancellato
        "teams": squadre,
    }


def main():
    ap = argparse.ArgumentParser(description="Draft di prova sul nodo vero (temporaneo).")
    ap.add_argument("comando", choices=["carica", "mostra", "cancella"])
    ap.add_argument("--stagione", default="2026")
    args = ap.parse_args()

    if args.comando == "cancella":
        firebase("DELETE", args.stagione)
        print(f"Cancellato {nodo(args.stagione)} — il draft di prova non c'e' piu'.")
        return

    if args.comando == "mostra":
        d = json.loads(firebase("GET", args.stagione) or "null")
        if not d:
            print(f"{nodo(args.stagione)}: vuoto")
            return
        print(f"{nodo(args.stagione)} — demo: {d.get('demo', False)}")
        for squadra, scelte in (d.get("teams") or {}).items():
            print(f"  {squadra}: {len(scelte)} scelte — "
                  + ", ".join(s["name"] for s in scelte[:3]) + ("..." if len(scelte) > 3 else ""))
        return

    cfg = config.load_config()
    draft = costruisci(args.stagione, cfg)

    preseason = squadre_in_preseason(args.stagione)
    tutti = [g for s in draft["teams"].values() for g in s]
    sigle = {g["nfl_team"] for g in tutti if g["nfl_team"]}   # le difese non ne hanno
    fuori = sorted(s for s in sigle if s not in preseason)
    print(f"{len(tutti)} giocatori su {len(sigle)} squadre NFL")
    print("squadre senza preseason da giocare:", fuori or "nessuna")

    firebase("PUT", args.stagione, json.dumps(draft, ensure_ascii=False).encode("utf-8"))
    for squadra, scelte in draft["teams"].items():
        print(f"  {squadra}: {len(scelte)} scelte — {', '.join(s['name'] for s in scelte[:3])}...")
    print(f"Caricato su {nodo(args.stagione)} (solo Firebase, nessun file in data/).")
    print("RICORDA: a preseason finita  ->  python scripts/espn/draft_demo.py cancella")


if __name__ == "__main__":
    main()
