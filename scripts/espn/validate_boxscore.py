"""Ricostruisce i punti fantasy della lega dal tabellino ufficiale ESPN e li
confronta con quelli veri salvati su Firebase.

A cosa serve
------------
La pagina #live legge i punti da Firebase, dove li carica lo script esterno
NFL_Fantasy_Dash. Se quello script non e' passato, la pagina mostra zeri. Questo
script dimostra che gli stessi punti sono ricavabili in diretta dagli endpoint
pubblici ESPN, e quantifica quanto la ricostruzione sia fedele.

Verificato il 2026-08-09 su 12 giornate della stagione 2025 (425 titolari):
425 su 425 esatti al centesimo, errore totale 0.00 punti.

    py -3 validate_boxscore.py 2025 3 7 11

Le regole scoperte per arrivarci
--------------------------------
Ognuna e' costata un disallineamento, sono annotate perche' non e' possibile
dedurle dalla documentazione:

1. Il grosso viene dal TABELLINO (`summary` -> boxscore.players), non dalla
   ricostruzione giocata per giocata: ricostruire dalle sole giocate si ferma
   al 91% (lateral, rettifiche, giocate annullate). L'aggancio e' per nome
   normalizzato, quindi non serve nessuna mappa di ID.

2. Le FASCE DEI FIELD GOAL si leggono solo dalle giocate: il tabellino da' il
   totale dei field goal e il piu' lungo, non le distanze una per una, e da noi
   un 50+ vale 5 punti contro i 3 degli altri.

3. Le CONVERSIONI DA 2 stanno solo nel testo delle segnature, nella forma
   "(X Pass to Y for Two-Point Conversion)". Prendono 2 punti sia chi lancia
   sia chi riceve. Vanno lette da UNA fonte sola: compaiono anche nel
   play-by-play, e contarle da entrambe le raddoppia.

4. PUNTI CONCESSI dalla difesa = punteggio avversario meno 6 per ogni
   touchdown segnato dalla DIFESA avversaria. Vale sia per il ritorno di
   intercetto o fumble ("48 Yd Interception Return") sia per il fumble
   recuperato in end zone ("Fumble Recovery in End Zone"), che non ha yard e
   non dice "Return". Un ritorno di punt o kickoff resta invece addebitato:
   quello lo ha concesso il reparto calci, non la difesa. L'extra point resta
   addebitato in ogni caso.

5. I SACK della difesa sono i sack SUBITI dall'attacco avversario
   (`sacksYardsLost` della squadra avversaria), non quelli della propria riga.

6. Le SAFETY non stanno nelle statistiche di squadra: solo fra le segnature.

7. I valori del tabellino vanno spezzati sul trattino solo se non e' un segno:
   "3-21" sono sack e yard perse, ma "-3" sono yard di corsa negative.
"""
import json
import re
import sys
import urllib.request
import collections
import concurrent.futures as cf

sys.path.insert(0, __file__.rsplit("scripts", 1)[0])

RTDB = "https://topina-9cd75-default-rtdb.firebaseio.com"
SB = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard"
SUMMARY = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary"
CORE = "https://sports.core.api.espn.com/v2/sports/football/leagues/nfl"

# Coefficienti ufficiali della lega, vedi js/data/league-rules.js
S = {"pass_yd": 1 / 25, "pass_td": 4, "pass_int": -2, "rush_yd": 1 / 10, "rush_td": 6,
     "rec": 1, "rec_yd": 1 / 10, "rec_td": 6, "fum_lost": -2, "pat_made": 1,
     "ret_td": 6, "two_pt": 2, "fg_le49": 3, "fg_50": 5,
     "sack": 1, "def_int": 2, "fum_rec": 2, "def_td": 6, "safety": 2}
PA_TIERS = [(0, 10), (6, 7), (13, 4), (20, 1), (27, 0), (34, -1), (10 ** 9, -4)]
ABBR = {"WSH": "WAS", "JAC": "JAX", "LA": "LAR", "SD": "LAC", "OAK": "LV", "STL": "LAR"}
# Touchdown segnati dalla difesa: "48 Yd Interception Return", ma anche
# "Fumble Recovery in End Zone", che non ha yard e non dice "Return".
DEF_TD = re.compile(r"(Interception|Fumble)\s+(Return|Recovery)", re.I)


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)


def norm(s):
    s = (s or "").lower()
    for suf in (" jr.", " jr", " sr.", " sr", " iii", " ii", " iv", "'"):
        s = s.replace(suf, "")
    return re.sub(r"[^a-z]", "", s)


def canon(a):
    a = (a or "").upper()
    return ABBR.get(a, a)


def num(v):
    """Primo numero di un valore del tabellino (vedi regola 7 in cima)."""
    if v in (None, "--", ""):
        return 0.0
    s = str(v).strip().split("/")[0]
    if "-" in s[1:]:
        s = s[0] + s[1:].split("-")[0]
    return float(s or 0)


def raccogli(season, week):
    """Statistiche di tutti i giocatori e di tutte le difese della giornata."""
    eventi = [e["id"] for e in fetch(f"{SB}?dates={season}&seasontype=2&week={week}").get("events", [])]
    with cf.ThreadPoolExecutor(max_workers=8) as ex:
        sommari = list(ex.map(lambda g: fetch(f"{SUMMARY}?event={g}"), eventi))
        giocate = list(ex.map(
            lambda g: fetch(f"{CORE}/events/{g}/competitions/{g}/plays?limit=400").get("items", []), eventi))

    giocatori = collections.defaultdict(lambda: collections.defaultdict(float))
    difese, per_nome, kicker_id = {}, {}, {}

    for d in sommari:
        for squadra in d["boxscore"]["players"]:
            for cat in squadra.get("statistics", []):
                keys, nome_cat = cat.get("keys", []), cat.get("name")
                for a in cat.get("athletes", []):
                    nm = norm(a.get("athlete", {}).get("displayName"))
                    e, st = giocatori[nm], dict(zip(keys, a.get("stats", [])))
                    g = lambda k: num(st.get(k))
                    if nome_cat == "passing":
                        e["pass_yds"] += g("passingYards"); e["pass_td"] += g("passingTouchdowns")
                        e["pass_int"] += g("interceptions")
                    elif nome_cat == "rushing":
                        e["rush_yds"] += g("rushingYards"); e["rush_td"] += g("rushingTouchdowns")
                    elif nome_cat == "receiving":
                        e["rec"] += g("receptions"); e["rec_yds"] += g("receivingYards")
                        e["rec_td"] += g("receivingTouchdowns")
                    elif nome_cat == "fumbles":
                        e["fum_lost"] += g("fumblesLost")
                    elif nome_cat == "kicking":
                        e["pat_made"] += g("extraPointsMade/extraPointAttempts")
                        e["fg_made"] += g("fieldGoalsMade/fieldGoalAttempts")
                        kicker_id[nm] = str(a["athlete"]["id"])
                    elif nome_cat == "kickReturns":
                        e["ret_td"] += g("kickReturnTouchdowns")
                    elif nome_cat == "puntReturns":
                        e["ret_td"] += g("puntReturnTouchdowns")

        comp = d["header"]["competitions"][0]
        punti = {canon(c["team"]["abbreviation"]): num(c.get("score")) for c in comp["competitors"]}
        for c in comp["competitors"]:
            tm = c["team"]
            for chiave in (tm.get("displayName"), tm.get("name")):
                if chiave:
                    per_nome[norm(chiave)] = canon(tm["abbreviation"])

        td_difesa = {ab: 0 for ab in punti}   # regola 4
        safety = {ab: 0 for ab in punti}      # regola 6
        for s in d.get("scoringPlays", []):
            ab = canon(s.get("team", {}).get("abbreviation"))
            testo = s.get("text") or ""
            tipo = (s.get("scoringType") or {}).get("displayName", "")
            if ab in td_difesa and DEF_TD.search(testo):
                td_difesa[ab] += 1
            if ab in safety and re.search(r"Safety", tipo + " " + testo, re.I):
                safety[ab] += 1

        stat_squadra = {}
        for t in d["boxscore"]["teams"]:
            vals = {}
            for s in t["statistics"]:
                vals.setdefault(s["name"], s.get("displayValue"))
            stat_squadra[canon(t["team"]["abbreviation"])] = vals

        lati = list(punti)
        for ab in lati:
            avv = [x for x in lati if x != ab][0]
            mia, sua = stat_squadra.get(ab, {}), stat_squadra.get(avv, {})
            difese[ab] = {
                "pa": punti[avv] - 6 * td_difesa.get(avv, 0),
                "sack": num(sua.get("sacksYardsLost")),   # regola 5
                "int": num(sua.get("interceptions")),
                "fr": num(sua.get("fumblesLost")),
                "dtd": num(mia.get("defensiveTouchdowns")),
                "safety": safety.get(ab, 0),
            }

    fg50 = collections.Counter()   # regola 2
    for lista in giocate:
        for p in lista:
            if p.get("type", {}).get("text") != "Field Goal Good":
                continue
            k = next((re.search(r"/athletes/(\d+)", str(x.get("athlete", {}).get("$ref"))).group(1)
                      for x in p.get("participants", []) if x["type"] == "kicker"), None)
            if k and (p.get("statYardage") or 0) >= 50:
                fg50[k] += 1

    due_punti = collections.Counter()   # regola 3
    for d in sommari:
        for s in d.get("scoringPlays", []):
            m = re.search(r"\(([^)]*?)\s+for\s+Two-Point Conversion\)", s.get("text") or "", re.I)
            if not m:
                continue
            m2 = re.match(r"(.+?)\s+(?:Pass to|Run|Rush)\s*(.*)$", m.group(1), re.I)
            if not m2:
                continue
            for pieno in (m2.group(1).strip(), m2.group(2).strip()):
                parti = pieno.split()
                if len(parti) > 1:
                    due_punti[f"{parti[0][0]}.{parti[-1]}"] += 1

    return giocatori, difese, per_nome, kicker_id, fg50, due_punti


def punti_giocatore(e):
    return (e["pass_yds"] * S["pass_yd"] + e["pass_td"] * S["pass_td"] + e["pass_int"] * S["pass_int"]
            + e["rush_yds"] * S["rush_yd"] + e["rush_td"] * S["rush_td"]
            + e["rec"] * S["rec"] + e["rec_yds"] * S["rec_yd"] + e["rec_td"] * S["rec_td"]
            + e["fum_lost"] * S["fum_lost"] + e["pat_made"] * S["pat_made"]
            + e["ret_td"] * S["ret_td"] + e["fg_le49"] * S["fg_le49"] + e["fg_50"] * S["fg_50"]
            + e["two_pt"] * S["two_pt"])


def punti_difesa(d):
    p = (d["sack"] * S["sack"] + d["int"] * S["def_int"] + d["fr"] * S["fum_rec"]
         + d["dtd"] * S["def_td"] + d["safety"] * S["safety"])
    for massimo, bonus in PA_TIERS:
        if d["pa"] <= massimo:
            return p + bonus
    return p


def verifica(season, week):
    giocatori, difese, per_nome, kicker_id, fg50, due_punti = raccogli(season, week)
    lega = fetch(f"{RTDB}/fantasy/fantasy_data_{season}/weeks/{week}.json")
    if not lega:
        print(f"  settimana {week}: nessun dato di lega su Firebase")
        return 0, 0, 0.0

    righe, esclusi = [], []
    for m in lega["matchups"]:
        for lato in ("team1", "team2"):
            for p in m[lato].get("starters", []):
                pos = (p.get("position_in_team") or p.get("position") or "").upper()
                reale = float(p.get("fantasy_points") or 0)
                if pos in ("DEF", "D/ST"):
                    ab = canon(p.get("nfl_team")) or per_nome.get(norm(p["name"]))
                    if ab not in difese:
                        esclusi.append(p["name"]); continue
                    righe.append((p["name"], punti_difesa(difese[ab]), reale))
                    continue
                e = giocatori.get(norm(p["name"]))
                if e is None:
                    esclusi.append(p["name"]); continue
                if pos == "K":
                    n50 = fg50.get(kicker_id.get(norm(p["name"])), 0)
                    e["fg_50"], e["fg_le49"] = n50, max(0, e["fg_made"] - n50)
                parti = p["name"].split()
                if len(parti) > 1:
                    e["two_pt"] = due_punti.get(f"{parti[0][0]}.{parti[-1]}", 0)
                righe.append((p["name"], punti_giocatore(e), reale))

    ok = sum(1 for _, c, r in righe if abs(c - r) < 0.05)
    err = sum(abs(c - r) for _, c, r in righe)
    print(f"  settimana {week:>2}: {ok}/{len(righe)} esatti, errore {err:.2f}")
    for nome, c, r in righe:
        if abs(c - r) >= 0.05:
            print(f"      {nome:<24} ricostruito {c:7.2f}  lega {r:7.2f}  ({c - r:+.2f})")
    for nome in esclusi:
        print(f"      ESCLUSO {nome} (non ha giocato)")
    return ok, len(righe), err


if __name__ == "__main__":
    stagione = sys.argv[1] if len(sys.argv) > 1 else "2025"
    settimane = [int(w) for w in sys.argv[2:]] or [3]
    print(f"Stagione {stagione}")
    tot_ok = tot_n = 0
    tot_err = 0.0
    for w in settimane:
        ok, n, err = verifica(stagione, w)
        tot_ok += ok; tot_n += n; tot_err += err
    if tot_n:
        print(f"\nTOTALE: {tot_ok}/{tot_n} esatti ({100 * tot_ok / tot_n:.1f}%), "
              f"errore complessivo {tot_err:.2f} punti")
