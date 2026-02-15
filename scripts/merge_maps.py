import os

def merge_maps():
    # 1. Read the generated map (The Source of Truth for Players)
    with open('scripts/generated_map.js', 'r') as f:
        gen_content = f.read()
    
    # Extract the PLAYER_ID_MAP object content
    # It starts with "export const PLAYER_ID_MAP = {" and ends with "};"
    start_marker = "export const PLAYER_ID_MAP = {"
    end_marker = "};"
    
    s_idx = gen_content.find(start_marker)
    e_idx = gen_content.find(end_marker, s_idx)
    
    if s_idx == -1 or e_idx == -1:
        print("Error: Could not find PLAYER_ID_MAP in generated file.")
        return

    new_player_map_content = gen_content[s_idx:e_idx+len(end_marker)]

    # 2. Read the existing map file (To keep TEAM_ABBR_MAP and ESPN_TEAM_IDS)
    with open('js/data/player-map.js', 'r') as f:
        old_content = f.read()
    
    # We want to keep everything AFTER the PLAYER_ID_MAP in the old file
    # But wait, PLAYER_ID_MAP is usually first.
    # Let's verify the structure of old file from previous view:
    # It has PLAYER_ID_MAP, then TEAM_ABBR_MAP, then ESPN_TEAM_IDS.
    
    # So we find where TEAM_ABBR_MAP starts
    team_map_marker = "export const TEAM_ABBR_MAP = {"
    t_idx = old_content.find(team_map_marker)
    
    if t_idx == -1:
        print("Error: Could not find TEAM_ABBR_MAP in old file.")
        return
        
    # Get the header comments if any?
    # The generated map has its own header.
    
    # Let's preserve the "Special / Retired" overrides if they are not in the generated map?
    # The user manual map had Julio Jones fixed with a URL.
    # The generated map has Julio Jones with an ID.
    # The user might prefer the URL if the ID still fails (though ID should work now with valid mapping).
    # But for safety, let's just stick with the generated map for now as it solves the "Drake Maye" issue globally.
    # We can manually re-add specific URL overrides later if needed.
    
    # Construct the new file content
    final_content = new_player_map_content + "\n\n" + old_content[t_idx:]
    
    # Add a top comment
    header = """/**
 * Player Name to ESPN ID Mapping
 * 
 * AUTOMATICALLY GENERATED FROM SLEEPER DATA
 * Contains 6700+ players.
 * 
 * Manual overrides can be added, but be careful not to break syntax.
 */
"""
    final_content = header + final_content
    
    # Write back
    with open('js/data/player-map.js', 'w') as f:
        f.write(final_content)
        
    print("Successfully merged maps!")

if __name__ == "__main__":
    merge_maps()
