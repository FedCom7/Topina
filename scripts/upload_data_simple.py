import json
import os
import urllib.request
import sys

# Configuration from your snippet
DATABASE_URL = "https://topina-9cd75-default-rtdb.firebaseio.com"

def upload_to_firebase(path, data):
    """Uploads data to a specific path in RTDB using REST API."""
    url = f"{DATABASE_URL}/{path}.json"
    try:
        req = urllib.request.Request(url, data=json.dumps(data).encode('utf-8'), method='PUT')
        with urllib.request.urlopen(req) as context:
            if 200 <= context.status < 300:
                print(f"[OK] Uploaded: {path}")
            else:
                print(f"[ERROR] Failed to upload {path}: Status {context.status}")
    except urllib.error.HTTPError as e:
        print(f"[ERROR] Error uploading {path}: {e}")
        if e.code == 401 or e.code == 403:
            print("  ! Permission Denied. creating 'serviceAccountKey.json' and using upload_data.py is required if rules are locked.")
    except Exception as e:
        print(f"[ERROR] Error: {e}")

def main():
    print("Starting simpler upload to Realtime Database...")
    print(f"Target: {DATABASE_URL}")
    
    # 1. Upload Draft Data
    draft_dir = os.path.join('data', 'draft')
    if os.path.exists(draft_dir):
        for filename in os.listdir(draft_dir):
            if filename.endswith('.json'):
                key = os.path.splitext(filename)[0] # e.g. draft_data_2023
                with open(os.path.join(draft_dir, filename), 'r') as f:
                    data = json.load(f)
                upload_to_firebase(f"draft/{key}", data)

    # 2. Upload Fantasy Data & Calculate Stats
    fantasy_dir = os.path.join('data', 'fantasy')
    stats = {
        'seasons_count': 0,
        'total_games': 0,
        'total_points': 0,
        'highest_score': {'value': 0, 'team': '', 'week': '', 'season': ''},
        'lowest_score': {'value': 1000, 'team': '', 'week': '', 'season': ''},
        'largest_margin': {'value': 0, 'winner': '', 'loser': '', 'week': '', 'season': ''},
        'most_points_season': {'value': 0, 'team': '', 'season': ''}
    }

    if os.path.exists(fantasy_dir):
        files = [f for f in os.listdir(fantasy_dir) if f.endswith('.json')]
        stats['seasons_count'] = len(files)

        for filename in files:
            # Upload File
            key = os.path.splitext(filename)[0]
            with open(os.path.join(fantasy_dir, filename), 'r') as f:
                content = json.load(f)
            upload_to_firebase(f"fantasy/{key}", content)

            # --- Stats Calculation ---
            season = key.split('_')[2] # fantasy_data_2024 -> 2024
            season_points = {}
            
            if 'weeks' in content:
                for week_num, week_data in content['weeks'].items():
                    if 'matchups' in week_data:
                        for matchup in week_data['matchups']:
                            stats['total_games'] += 1
                            
                            # Helper
                            def process_team(t_obj):
                                if not t_obj: return
                                score = float(t_obj.get('score', 0))
                                stats['total_points'] += score
                                
                                if score > stats['highest_score']['value']:
                                    stats['highest_score'] = {'value': score, 'team': t_obj['name'], 'week': week_num, 'season': season}
                                if score > 0 and score < stats['lowest_score']['value']:
                                    stats['lowest_score'] = {'value': score, 'team': t_obj['name'], 'week': week_num, 'season': season}
                                
                                name = t_obj['name']
                                season_points[name] = season_points.get(name, 0) + score

                            process_team(matchup.get('team1'))
                            process_team(matchup.get('team2'))
                            
                            # Margin
                            if matchup.get('team1') and matchup.get('team2'):
                                s1 = float(matchup['team1'].get('score', 0))
                                s2 = float(matchup['team2'].get('score', 0))
                                margin = abs(s1 - s2)
                                if margin > stats['largest_margin']['value']:
                                    winner = matchup['team1']['name'] if s1 > s2 else matchup['team2']['name']
                                    loser = matchup['team2']['name'] if s1 > s2 else matchup['team1']['name']
                                    stats['largest_margin'] = {'value': round(margin, 2), 'winner': winner, 'loser': loser, 'week': week_num, 'season': season}

            # Most Points in Season
            for team, points in season_points.items():
                if points > stats['most_points_season']['value']:
                    stats['most_points_season'] = {'value': round(points, 2), 'team': team, 'season': season}

    stats['total_points'] = round(stats['total_points'], 2)
    
    # 3. Upload Stats
    upload_to_firebase("stats/all_time", stats)
    print("Done!")

if __name__ == "__main__":
    main()
