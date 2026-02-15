import sys
import os
sys.path.append(os.getcwd())
from scripts.validate_images import load_player_map

def verify_fix():
    print("--- Verifying Map Installation ---")
    player_map = load_player_map()
    print(f"Total Mapped Players: {len(player_map)}")
    
    targets = [
        "Tom Brady", "Julio Jones", "Rob Gronkowski", 
        "Todd Gurley", "Drake Maye", "Caleb Williams",
        "Puka Nacua", "A.J. Brown"
    ]
    
    print("\nChecking specific targets in Map:")
    for t in targets:
        if t in player_map:
            print(f"[OK] {t} -> {player_map[t]}")
        else:
            print(f"[MISSING] {t} (Will trigger API call)")

if __name__ == "__main__":
    verify_fix()
