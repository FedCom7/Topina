import os

# Manual entries recovered from previous file version (Step 463)
MANUAL_RECOVERY = {
    'Julio Jones': 'https://a.espncdn.com/combiner/i?img=/i/headshots/nfl/players/full/13982.png',
    'Patrick Mahomes': '3139477',
    'Josh Allen': '3918298',
    'Jalen Hurts': '4040715',
    'Lamar Jackson': '3916387',
    'Joe Burrow': '3915511',
    'Kyler Murray': '3917315',
    'Jayden Daniels': '4426348',
    'C.J. Stroud': '4432577',
    'Anthony Richardson': '4429084',
    'Christian McCaffrey': '3117251',
    'Breece Hall': '4427366',
    'Bijan Robinson': '4430807',
    'Jahmyr Gibbs': '4429795',
    'Jonathan Taylor': '4242335',
    'Saquon Barkley': '3929630',
    'Kyren Williams': '4430737',
    'Travis Etienne Jr.': '4429016',
    'De\'Von Achane': '4429160',
    'Derrick Henry': '3043078',
    'Josh Jacobs': '4047365',
    'Isiah Pacheco': '4361408',
    'James Cook': '4379399',
    'Kenneth Walker III': '4567048',
    'Kenneth Walker': '4567048',
    'Alvin Kamara': '3054850',
    'James Conner': '3045147',
    'Rachaad White': '4362145',
    'Ashton Jeanty': '4890973',
    'Chase Brown': '4362238',
    'Chuba Hubbard': '4241416',
    'Bucky Irving': '4596448',
    'Omarion Hampton': '4431584',
    'TreVeyon Henderson': '4430155',
    'CeeDee Lamb': '4241389',
    'Tyreek Hill': '3116406',
    'Justin Jefferson': '4262921',
    'Ja\'Marr Chase': '4362628',
    'Amon-Ra St. Brown': '4374302',
    'A.J. Brown': '4047646',
    'AJ Brown': '4047646',
    'Puka Nacua': '4426515',
    'Marvin Harrison Jr.': '4432708',
    'Drake London': '4430736',
    'Chris Olave': '4430730',
    'Davante Adams': '16800',
    'Brandon Aiyuk': '4242407',
    'Nico Collins': '4258173',
    'Mike Evans': '16737',
    'DeVonta Smith': '4241478',
    'DK Metcalf': '4047650',
    'D.K. Metcalf': '4047650',
    'DJ Moore': '3915416',
    'Jaylen Waddle': '4372016',
    'Malik Nabers': '4595348',
    'Tee Higgins': '4239993',
    'Zay Flowers': '4427042',
    'Tank Dell': '4241464',
    'George Pickens': '4427453',
    'Terry McLaurin': '3121422',
    'Amari Cooper': '2976517',
    'Keenan Allen': '15818',
    'Calvin Ridley': '3925357',
    'Stefon Diggs': '2976212',
    'Jameson Williams': '4426388',
    'Brian Thomas Jr.': '4432773',
    'Rome Odunze': '4426338',
    'Ladd McConkey': '4612826',
    'Tetairoa McMillan': '4685472',
    'Jordan Addison': '4430833',
    'Jaxon Smith-Njigba': '4430878',
    'Sam LaPorta': '4430027',
    'Travis Kelce': '15847',
    'Trey McBride': '4361307',
    'Mark Andrews': '3116164',
    'Dalton Kincaid': '4429037',
    'George Kittle': '3040151',
    'Kyle Pitts': '4426500',
    'Brock Bowers': '4432665',
    'Evan Engram': '3930164',
    'Jake Ferguson': '4242200',
    'David Njoku': '3932782',
    'Brandon Aubrey': '3953687',
    'Cameron Dicker': '4362081',
    'Jake Bates': '4689936',
    'Ka\'imi Fairbairn': '2971573'
}

def restore_entries():
    file_path = 'js/data/player-map.js'
    
    with open(file_path, 'r') as f:
        content = f.read()
        
    # We want to insert these entries into the existing PLAYER_ID_MAP object.
    # The map starts at "export const PLAYER_ID_MAP = {"
    # We can just inject them right after the opening brace.
    
    start_marker = "export const PLAYER_ID_MAP = {"
    idx = content.find(start_marker)
    
    if idx == -1:
        print("Error: Could not find map start.")
        return
        
    insert_point = idx + len(start_marker)
    
    # Construct injection string
    injection = "\n    // --- Manual Restorations (Recent Rookies / Overrides) ---"
    for name, val in MANUAL_RECOVERY.items():
        # Avoid duplicate keys if they already exist in the generated map?
        # Actually, in JS, if we have duplicate keys in an object literal, the later one wins.
        # But we are inserting at the TOP. So the later (generated) ones would win.
        # Wait, if I insert at the TOP, the GENERATED ones (which follow) will overwrite these if they exist.
        # IF generated map has Puka Nacua, it will overwrite my restored value.
        # IF generated map DOES NOT have Puka Nacua, my restored value stays (but is not overwritten).
        
        # However, checking the verify output: Puka Nacua was MISSING from the generated map.
        # So inserting him anywhere is fine.
        
        # But for 'Julio Jones', generated map has ID '13982'. 
        # Manual map has URL. 
        # If I insert manual URL at TOP, and generated ID follows, generated ID wins.
        # I need to insert at the BOTTOM of the map to ensure manual overrides win.
        pass
        
    # Find the END of the map object
    # It ends with "};" before "export const TEAM_ABBR_MAP"
    
    team_marker = "export const TEAM_ABBR_MAP"
    end_idx = content.find(team_marker)
    
    # Search backwards from team_marker for the closing brace of the previous object
    # content[...end_idx] is the text before.
    # The last "};" is what we want.
    
    pre_text = content[:end_idx]
    close_brace_idx = pre_text.rfind("};")
    
    if close_brace_idx == -1:
         print("Error: Could not find map end.")
         return
         
    # Insert BEFORE the closing brace "};"
    # This ensures these keys come LAST and override anything previous.
    
    injection = "\n\n    // --- Manual Restorations (Recent Rookies / Overrides) ---\n"
    for name, val in MANUAL_RECOVERY.items():
        safe_name = name.replace("'", "\\'")
        injection += f"    '{safe_name}': '{val}',\n"
        
    new_content = content[:close_brace_idx] + injection + content[close_brace_idx:]
    
    with open(file_path, 'w') as f:
        f.write(new_content)
        
    print(f"Restored {len(MANUAL_RECOVERY)} manual entries.")

if __name__ == "__main__":
    restore_entries()
