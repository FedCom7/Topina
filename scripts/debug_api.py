import requests
import json

def test_query(name):
    # 1. Try common/v3 without type=player
    url1 = f"https://site.api.espn.com/apis/common/v3/search?limit=5&sport=football&league=nfl&q={requests.utils.quote(name)}"
    print(f"URL 1: {url1}")
    try:
        resp = requests.get(url1)
        items = resp.json().get('items', [])
        if items: print(f"URL 1 Result: {items[0].get('displayName')}")
        else: print("URL 1: No items")
    except: pass

    # 2. Try search/v2 from web
    url2 = f"https://site.web.api.espn.com/apis/search/v2?limit=5&q={requests.utils.quote(name)}"
    print(f"URL 2: {url2}")
    try:
        resp = requests.get(url2)
        items = resp.json().get('results', [])
        if items: 
             print(f"URL 2 Result: {items[0].get('displayName')} (Type: {items[0].get('type')})")
             # detail: items[0].get('contents', [{}])[0].get('displayName')
        else: print("URL 2: No items")
    except Exception as e: print(f"URL 2 Error: {e}")

    # 3. Try suggest/v1
    url3 = f"https://site.api.espn.com/apis/common/v3/suggest?limit=5&q={requests.utils.quote(name)}"
    print(f"URL 3: {url3}")
    try:
         resp = requests.get(url3)
         items = resp.json().get('items', [])
         if items: print(f"URL 3 Result: {items[0].get('displayName')}")
         else: print("URL 3: No items")
    except: pass

test_query("Tom Brady")
test_query("Julio Jones")
