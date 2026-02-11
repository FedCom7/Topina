import firebase_admin
from firebase_admin import credentials
from firebase_admin import db
import json
import os
import sys

# Configuration
# 1. Download your service account key from Project Settings > Service Accounts
# 2. Rename it to 'serviceAccountKey.json' and place it in the project root
KEY_FILE = 'serviceAccountKey.json'
DATABASE_URL = "https://topina-9cd75-default-rtdb.firebaseio.com/"

def init_firebase():
    if not os.path.exists(KEY_FILE):
        print(f"Error: {KEY_FILE} not found.")
        print("Please download your Service Account Key from Firebase Console:")
        print("Project Settings -> Service Accounts -> Generate New Private Key")
        print(f"Save it as '{KEY_FILE}' in this directory.")
        return False

    cred = credentials.Certificate(KEY_FILE)
    firebase_admin.initialize_app(cred, {
        'databaseURL': DATABASE_URL
    })
    return True

def upload_collection(directory, node_name):
    dir_path = os.path.join(os.getcwd(), directory)
    
    if not os.path.exists(dir_path):
        print(f"Directory {dir_path} does not exist. Skipping.")
        return

    files = [f for f in os.listdir(dir_path) if f.endswith('.json')]
    print(f"Uploading {len(files)} files from {directory} to node '{node_name}'...")

    ref = db.reference(node_name)

    for filename in files:
        file_path = os.path.join(dir_path, filename)
        with open(file_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        
        # Use filename without extension as child key
        child_key = os.path.splitext(filename)[0]
        
        try:
            ref.child(child_key).set(data)
            print(f"✓ Uploaded {child_key}")
        except Exception as e:
            print(f"✗ Error uploading {child_key}: {e}")

def calculate_and_upload_stats():
    print("Calculating all-time stats...")
    fantasy_dir = os.path.join(os.getcwd(), 'data', 'fantasy')
    if not os.path.exists(fantasy_dir):
        return

    files = [f for f in os.listdir(fantasy_dir) if f.endswith('.json')]

    stats = {
        'seasons_count': len(files),
        'total_games': 0,
        'total_points': 0,
        'highest_score': {'value': 0, 'team': '', 'week': '', 'season': ''},
        'lowest_score': {'value': 1000, 'team': '', 'week': '', 'season': ''},
        'largest_margin': {'value': 0, 'winner': '', 'loser': '', 'week': '', 'season': ''},
        'most_points_season': {'value': 0, 'team': '', 'season': ''}
    }

    for filename in files:
        season = filename.split('_')[2].split('.')[0] # fantasy_data_2024.json -> 2024
        with open(os.path.join(fantasy_dir, filename), 'r', encoding='utf-8') as f:
            content = json.load(f)

        season_points = {}

        if 'weeks' in content:
            for week_num, week_data in content['weeks'].items():
                if 'matchups' in week_data:
                    for matchup in week_data['matchups']:
                        stats['total_games'] += 1
                        
                        # Helper to process team
                        def process_team(team_obj, opponent_obj=None):
                            if not team_obj: return
                            
                            score = float(team_obj.get('score', 0))
                            stats['total_points'] += score
                            
                            # High Score
                            if score > stats['highest_score']['value']:
                                stats['highest_score'] = {'value': score, 'team': team_obj['name'], 'week': week_num, 'season': season}
                            
                            # Low Score (ignore 0)
                            if score > 0 and score < stats['lowest_score']['value']:
                                stats['lowest_score'] = {'value': score, 'team': team_obj['name'], 'week': week_num, 'season': season}
                                
                            # Season Points
                            name = team_obj['name']
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
                                stats['largest_margin'] = {
                                    'value': round(margin, 2),
                                    'winner': winner,
                                    'loser': loser,
                                    'week': week_num,
                                    'season': season
                                }

        # Most Points in Season
        for team, points in season_points.items():
            if points > stats['most_points_season']['value']:
                stats['most_points_season'] = {'value': round(points, 2), 'team': team, 'season': season}

    stats['total_points'] = round(stats['total_points'], 2)

    try:
        db.reference('stats/all_time').set(stats)
        print("✓ Uploaded all-time stats")
    except Exception as e:
        print(f"✗ Error uploading stats: {e}")

def main():
    if not init_firebase():
        sys.exit(1)
        
    upload_collection('data/draft', 'draft')
    upload_collection('data/fantasy', 'fantasy')
    calculate_and_upload_stats()
    print("Done!")

if __name__ == "__main__":
    main()
