import json

def check_sleeper_data():
    try:
        with open('scripts/sleeper_players.json', 'r') as f:
            data = json.load(f)
        
        print(f"Loaded {len(data)} players from Sleeper.")
        
        # Check a few famous players to see fields
        samples = ['Tom Brady', 'Julio Jones', 'Patrick Mahomes']
        found = 0
        
        for player_id, p_data in data.items():
            name = f"{p_data.get('first_name')} {p_data.get('last_name')}"
            if name in samples:
                print(f"--- {name} ---")
                print(f"Sleeper ID: {player_id}")
                print(f"ESPN ID: {p_data.get('espn_id')}")
                print(f"Yahoo ID: {p_data.get('yahoo_id')}")
                found += 1
                if found >= len(samples): break
                
    except Exception as e:
        print(f"Error: {e}")

check_sleeper_data()
