import requests
import json

def search_variant(name, label, params):
    base_url = "https://site.api.espn.com/apis/common/v3/search"
    default_params = {
        "limit": 5,
        "type": "player",
        "sport": "football",
        "league": "nfl",
        "q": name
    }
    # update defaults
    default_params.update(params)
    
    print(f"Searching {name} [{label}]...")
    try:
        res = requests.get(base_url, params=default_params)
        data = res.json()
        return data
    except Exception as e:
        return {"error": str(e)}

players_to_test = ["Andrew Luck", "Tom Brady"]
variations = [
    ("Standard", {}),
    ("No League", {"league": None}),
    ("Type Athlete", {"type": "athlete"}),
    ("Active False", {"active": "false"}), # Guessing
]

results = {}

for p in players_to_test:
    results[p] = {}
    for label, params in variations:
        results[p][label] = search_variant(p, label, params)

with open("search_results.json", "w") as f:
    json.dump(results, f, indent=2)

print("Results written to search_results.json")
