"""Toglie dallo stage i JSON che sono cambiati SOLO nel timestamp.

Perche' serve
-------------
Ogni script di build scrive dentro al JSON un campo `generatedAt` con l'ora
del momento. Risultato: il file differisce SEMPRE da quello committato, anche
quando i dati sono identici, e la guardia `git diff --staged --quiet` del
workflow non scatta mai. Con il giro settimanale era un commit a vuoto ogni
sette giorni; passando a quello giornaliero diventa un commit al giorno, un
paio di MB di roba identica e un redeploy di GitHub Pages per niente.

Questo script gira dopo il `git add` e prima del commit: per ogni file in
stage confronta il contenuto con quello di HEAD ignorando `generatedAt`, e se
il resto e' uguale rimette il file com'era. Cosi' la guardia torna a dire il
vero e si committa solo quando i dati cambiano davvero.

Un file nuovo (non ancora in HEAD) o non-JSON resta in stage, sempre.
"""
import json
import subprocess
import sys

IGNORATI = ("generatedAt", "builtAt", "timestamp")


def git(*args, binario=False):
    r = subprocess.run(["git", *args], capture_output=True)
    if r.returncode != 0:
        raise RuntimeError(r.stderr.decode("utf-8", "replace").strip())
    return r.stdout if binario else r.stdout.decode("utf-8", "replace")


def senza_timestamp(testo):
    """JSON normalizzato senza i campi d'ora. None se non e' un JSON oggetto."""
    dati = json.loads(testo)
    if not isinstance(dati, dict):
        return None
    for k in IGNORATI:
        dati.pop(k, None)
    return json.dumps(dati, sort_keys=True, separators=(",", ":"))


def main():
    in_stage = [f for f in git("diff", "--staged", "--name-only").split("\n") if f.strip()]
    tolti = []
    for f in in_stage:
        if not f.endswith(".json"):
            continue
        try:
            vecchio = senza_timestamp(git("show", f"HEAD:{f}", binario=True).decode("utf-8", "replace"))
            nuovo = senza_timestamp(open(f, encoding="utf-8").read())
        except Exception:
            continue  # file nuovo, illeggibile o non-JSON: si tiene com'e'
        if vecchio is None or nuovo is None or vecchio != nuovo:
            continue
        git("restore", "--staged", "--worktree", "--", f)
        tolti.append(f)

    if tolti:
        print(f"Solo il timestamp e' cambiato in {len(tolti)} file, rimessi com'erano:")
        for f in tolti:
            print(f"   {f}")
    else:
        print("Nessun file cambiato solo nel timestamp.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
