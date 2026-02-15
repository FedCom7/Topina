import json

# List of missing players from our previous report
# (I'll add more from the full list if I can, or just do ALL players in Sleeper?)
# Strategy: Let's create a map for EVERYONE in Sleeper who has an ESPN ID.
# This makes the map huge but comprehensive.
# Or better: Let's filter to just the players we know we need, 
# plus anyone with a high search rank / active status to be safe.

# For now, let's generate a map of ALL players with ESPN IDs from Sleeper.
# The client-side map might be big, but 5000 lines is fine for modern JS.

def generate_map():
    with open('scripts/sleeper_players.json', 'r') as f:
        data = json.load(f)
    
    # Sort by name
    players = []
    for pid, p in data.items():
        if not p.get('espn_id'): continue
        
        first = p.get('first_name', '')
        last = p.get('last_name', '')
        full_name = f"{first} {last}".strip()
        
        # Skip if no name
        if not full_name: continue
        
        # Store
        players.append((full_name, p['espn_id']))
    
    # Sort
    players.sort(key=lambda x: x[0])
    
    print(f"Found {len(players)} players with ESPN IDs.")
    
    # Generate JS content
    js_content = "/**\n * Player Name to ESPN ID Mapping\n * Generated from Sleeper Data\n */\n"
    js_content += "export const PLAYER_ID_MAP = {\n"
    
    for name, espn_id in players:
        # Escape quotes in names
        safe_name = name.replace("'", "\\'")
        js_content += f"    '{safe_name}': '{espn_id}',\n"
        
    js_content += "};\n"
    
    # We also need the other exports usually in that file (TEAM_ABBR_MAP, ESPN_TEAM_IDS)
    # I should read the existing file and append/replace the map.
    # But for now let's just output the map to a file so I can copy-paste or merge it.
    
    with open('scripts/generated_map.js', 'w') as f:
        f.write(js_content)
        
    print("Generated map saved to scripts/generated_map.js")

if __name__ == "__main__":
    generate_map()
