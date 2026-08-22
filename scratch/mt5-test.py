import MetaTrader5 as mt5

if not mt5.initialize():
    print("initialize() failed")
    mt5.shutdown()
    exit()

print("MT5 Version:", mt5.version())
symbols = mt5.symbols_get()
if symbols:
    names = [s.name for s in symbols]
    btc_symbols = [n for n in names if 'BTC' in n.upper()]
    print("BTC Symbols found:", btc_symbols)
else:
    print("No symbols found.")

mt5.shutdown()
