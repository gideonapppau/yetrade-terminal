import urllib.request
import json

req = urllib.request.Request(
    'http://127.0.0.1:8000/trade/execute',
    data=json.dumps({"symbol": "BTCUSDM", "action": "BUY", "volume": 0.01, "sl": 76001.83, "tp": 80000}).encode('utf-8'),
    headers={'Content-Type': 'application/json'}
)
try:
    response = urllib.request.urlopen(req)
    print("Success:", response.read().decode())
except urllib.error.HTTPError as e:
    print("Error:", e.code, e.read().decode())
