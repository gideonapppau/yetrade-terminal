import urllib.request

try:
    # Flask doesn't have a built in route lister, but we can check if it 404s
    req = urllib.request.Request('http://127.0.0.1:8000/symbols')
    response = urllib.request.urlopen(req)
    print("Success:", response.read().decode())
except Exception as e:
    print("Error:", getattr(e, 'code', e), getattr(e, 'read', lambda: b'')().decode())
