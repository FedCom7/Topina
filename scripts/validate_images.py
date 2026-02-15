import requests
import json
import re
import os
import time
import ast

# Configuration
FIREBASE_URL = "https://topina-9cd75-default-rtdb.firebaseio.com"
SEASONS = range(2019, 2026)
# Use absolute path based on user workspace if running from root, or relative
# We will assume running from project root
PLAYER_MAP_PATH = "js/data/player-map.js"

def load_player_map():
    """Parses js/data/player-map.js to get the current manual mappings."""
    if not os.path.exists(PLAYER_MAP_PATH):
        print(f"Error: {PLAYER_MAP_PATH} not found.")
        return {}
    
    with open(PLAYER_MAP_PATH, 'r') as f:
        content = f.read()
    
    # Regex to extract the dictionary content inside PLAYER_ID_MAP = { ... };
    match = re.search(r"export const PLAYER_ID_MAP = ({[\s\S]*?});", content)
    if not match:
        print("Error: Could not find PLAYER_ID_MAP in file.")
        return {}
    
    js_obj = match.group(1)
    
    # Remove lines that are just comments or empty
    lines = []
    for line in js_obj.split('\n'):
        # simple comment removal //...
        clean_line = re.sub(r"//.*", "", line).strip()
        if clean_line:
            lines.append(clean_line)
    
    clean_js = "\n".join(lines)
    # Remove trailing commas before closing braces (common in JS, invalid in Python/JSON)
    clean_js = re.sub(r",\s*}", "}", clean_js)
    
    # Python dict syntax is very close to this JS object syntax (quoted keys and values)
    # create a safe evaluation env
    try:
        data = ast.literal_eval(clean_js)
        return data
    except Exception as e:
        print(f"Parsing failed with ast, falling back to regex extraction: {e}")
        # manual extraction
        manual_map = {}
        for line in js_obj.split('\n'):
            # Look for 'Name': 'ID'
            m = re.search(r"['\"](.+?)['\"]\s*:\s*['\"](.+?)['\"]", line)
            if m:
                manual_map[m.group(1)] = m.group(2)
        return manual_map

def fetch_draft_data(year):
    url = f"{FIREBASE_URL}/draft/draft_data_{year}.json"
    try:
        resp = requests.get(url)
        if resp.status_code == 200:
            return resp.json()
    except Exception as e:
        print(f"Error fetching data for {year}: {e}")
    return None

def search_espn_player(name):
    """Searches ESPN API for a player."""
    url = f"https://site.api.espn.com/apis/common/v3/search?limit=5&type=player&sport=football&league=nfl&q={requests.utils.quote(name)}"
    try:
        resp = requests.get(url, timeout=5)
        if resp.status_code == 200:
            data = resp.json()
            if data.get('items'):
                return data['items'] # Return all items
    except:
        pass
    return []

def check_image_url(url):
    """Checks if an image URL is valid (HTTP 200)."""
    try:
        headers = {
            'User-Agent': 'Mozilla/5.0'
        }
        resp = requests.head(url, headers=headers, timeout=3)
        return resp.status_code == 200
    except:
        return False

def main():
    print("--- Starting Automated Player Image Validation ---")
    
    # 1. Load Map
    player_map = load_player_map()
    print(f"Loaded {len(player_map)} manual mappings.")
    
    all_players = set()
    
    # 2. Fetch all drafted players
    for year in SEASONS:
        data = fetch_draft_data(year)
        if not data or 'teams' not in data:
            continue
        
        count = 0
        teams_data = data['teams']
        # Handle array vs object structure if necessary, assume object from previous view
        if isinstance(teams_data, dict):
            for team_list in teams_data.values():
                for pick in team_list:
                    if 'name' in pick:
                        all_players.add(pick['name'])
                        count += 1
        elif isinstance(teams_data, list):
             for team_dict in teams_data:
                # Structure might vary, skipping complexity for now
                pass

        print(f"Season {year}: Found {count} picks.")
    
    print(f"Total unique players to check: {len(all_players)}")
    
    missing_images = []
    broken_images = []
    
    # 3. Validate
    print("Validating images... (this may take a moment)")
    
    # Sort for consistent output
    sorted_players = sorted(list(all_players))
    
    for i, player in enumerate(sorted_players):
        # Progress
        if i > 0 and i % 20 == 0:
            print(f"Processed {i}/{len(sorted_players)}...")
            
        time.sleep(0.05) # Rate limiting
        
        status = "OK"
        image_url = None
        
        # Check Map
        if player in player_map:
            val = player_map[player]
            if val.startswith('http'):
                image_url = val
            else:
                image_url = f"https://a.espncdn.com/combiner/i?img=/i/headshots/nfl/players/full/{val}.png&w=350&h=254&scale=crop"
            
            # For mapped players, we assume the URL is correct unless checked
            # We can enable strict checking if desired
            # if not check_image_url(image_url):
            #     broken_images.append({'name': player, 'source': 'map', 'url': image_url})
            #     print(f"  [!] Broken MAP image for {player}")
            
        else:
            # Check API
            items = search_espn_player(player)
            found_match = False
            best_img = None
            
            for result in items:
                 # Check name match
                 result_name = result.get('displayName', '') or result.get('fullName', '') or ''
                 
                 # Simple normalization
                 n_player = player.lower().replace('.', '').replace("'", "")
                 n_result = result_name.lower().replace('.', '').replace("'", "")
                 
                 # Loose check checking for inclusion
                 if n_player in n_result or n_result in n_player:
                      # We found a name match!
                      if result.get('headshot', {}).get('href'):
                           best_img = result['headshot']['href']
                      elif result.get('image', {}).get('href'):
                           best_img = result['image']['href']
                      
                      if best_img:
                          found_match = True
                          image_url = best_img
                          break
            
            if not found_match:
                 # If we have items but no match, log the first one's name as a mismatch example
                 if items:
                      first_name = items[0].get('displayName', 'Unknown')
                      missing_images.append(f"{player} -> Mismatch (Top: {first_name})")
                 else:
                      missing_images.append(f"{player} -> No API Results")
        
        # If we have a URL from API, verify it briefly?
        # Skipping for API results to save time unless requested, as 404s are rare if API returns it.
        # But we really care about "Missing", i.e. NO result found.

    # 4. Report
    print("\n--- Validation Complete ---")
    print(f"Total Checked: {len(sorted_players)}")
    print(f"Potential Issues (No API Result / No Image): {len(missing_images)}")
    
    if missing_images:
        print("\n--- Players needing Manual Map ---")
        print("Copy the following into your checklist or player-map.js:")
        for p in missing_images:
            print(f"- {p}")
            
    # Optional: Generate a JSON report file
    with open('validation_report.json', 'w') as f:
        json.dump({
            'missing': missing_images,
            'broken': broken_images,
            'total': len(sorted_players)
        }, f, indent=2)

if __name__ == "__main__":
    main()
