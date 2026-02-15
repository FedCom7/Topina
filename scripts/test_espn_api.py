import requests
import json

players = ["Garrett Wilson", "A.J. Brown", "Marvin Harrison Jr.", "Tetairoa McMillan", "Caleb Williams"]

url = "https://site.api.espn.com/apis/common/v3/search"

for p in players:
    params = {
        "limit": 5,
        "type": "player",
        "sport": "football",
        "league": "nfl",
        "q": p
    }
    try:
        res = requests.get(url, params=params)
        data = res.json()
        print(f"Searching for: {p}")
        if data.get('items'):
            for item in data['items']:
                print(f"  Result: {item.get('displayName')} (ID: {item.get('id')})")
                if item.get('headshot'):
                    print(f"    Headshot: {item.get('headshot').get('href')}")
                # Check for image property directly
                if item.get('image'):
                     print(f"    Image: {item.get('image').get('href')}")
                
                # Check UID
                if item.get('uid'):
                    print(f"    UID: {item.get('uid')}")

        else:
             print(f"Name: {p} - NO RESULTS")
    except Exception as e:
        print(f"Error for {p}: {e}")
    print("-" * 20)
