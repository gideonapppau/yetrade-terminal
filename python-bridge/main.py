import MetaTrader5 as mt5
from flask import Flask, request, jsonify
from flask_cors import CORS
import logging
import atexit
import time

app = Flask(__name__)
CORS(app)  # Allow requests from Tauri

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# --- Lifecycle ---
def shutdown_event():
    mt5.shutdown()

# Register shutdown
atexit.register(shutdown_event)

# --- Endpoints ---
@app.route("/login", methods=["POST"])
def login_broker():
    data = request.json
    if not data:
        return jsonify({"success": False, "message": "No data provided"}), 400
        
    login_id = data.get("login")
    password = data.get("password")
    server = data.get("server")
    path = data.get("path")
    
    logger.info(f"--- Login Broker Requested ---")
    logger.info(f"Login ID: {login_id}, Server: {server}")
    
    init_kwargs = {"timeout": 60000}
    if path:
        logger.info(f"Using custom MT5 path provided from UI: {path}")
        init_kwargs["path"] = path
    else:
        logger.info("No custom path provided. Using default MT5 installation path.")

    # Pass credentials directly to initialize to prevent UAC or IPC prompt blocks
    if login_id:
        init_kwargs["login"] = int(login_id)
    if password:
        init_kwargs["password"] = password
    if server:
        init_kwargs["server"] = server

    logger.info(f"Calling mt5.initialize(kwargs={init_kwargs})")
    
    # Attempt to initialize with specific path if provided
    init_result = mt5.initialize(**init_kwargs)
    
    if not init_result:
        err = mt5.last_error()
        logger.error(f"MT5 Init failed! mt5.initialize() returned False.")
        logger.error(f"MT5 last_error(): {err}")
        
        if err[0] == -10005:
            logger.error("DIAGNOSIS: IPC Timeout (-10005).")
            logger.error("  -> This almost always means MetaTrader 5 is running as Administrator but this python script is not.")
            logger.error("  -> OR the MT5 terminal is frozen/hanging in the background.")
            logger.error("  -> ACTION: Close MT5, do NOT run as admin, and try again. Or provide the exact path in settings.")
            
        return jsonify({
            "success": False, 
            "message": f"MT5 Initialization failed: {err[1]} (Code {err[0]}). Check terminal logs for diagnosis.",
            "mock": False
        })
        
    logger.info(f"MT5 Initialized successfully! Version: {mt5.version()}")
    
    if login_id and password and server:
        logger.info(f"Authenticating with broker: {server}")
        authorized = mt5.login(int(login_id), password=password, server=server)
        if not authorized:
            logger.error(f"mt5.login() failed. last_error: {mt5.last_error()}")
            return jsonify({"success": False, "message": f"Login failed: {mt5.last_error()}"}), 401
            
    logger.info("Successfully connected to broker!")
    return jsonify({"success": True, "message": "Successfully connected to broker!"})

@app.route("/health", methods=["GET"])
def health_check():
    terminal_info = mt5.terminal_info()
    if terminal_info is None:
        return jsonify({"status": "error", "connected": False, "detail": "MT5 terminal not connected"}), 200
    return jsonify({"status": "ok", "connected": terminal_info.connected})

@app.route("/account", methods=["GET"])
def get_account_info():
    account_info = mt5.account_info()
    if account_info is None:
        return jsonify({"detail": "Failed to get account info"}), 500
    return jsonify({
        "balance": account_info.balance,
        "equity": account_info.equity,
        "margin": account_info.margin,
        "free_margin": account_info.margin_free,
        "leverage": account_info.leverage,
        "currency": account_info.currency,
        "trade_mode": account_info.trade_mode,
        "server": account_info.server,
        "company": account_info.company
    })

@app.route("/positions", methods=["GET"])
def get_positions():
    positions = mt5.positions_get()
    if positions is None:
        return jsonify({"success": False, "detail": "Failed to get positions"}), 500
    
    pos_list = []
    for p in positions:
        pos_list.append({
            "ticket": p.ticket,
            "symbol": p.symbol,
            "volume": p.volume,
            "price_open": p.price_open,
            "price_current": p.price_current,
            "sl": p.sl,
            "tp": p.tp,
            "profit": p.profit,
            "type": "BUY" if p.type == mt5.ORDER_TYPE_BUY else "SELL"
        })
    return jsonify({"success": True, "positions": pos_list})

@app.route("/deals", methods=["GET"])
def get_deals():
    """Closed-deal history for one position. Used for realized P&L once a
    position disappears from /positions."""
    position = request.args.get("position")
    if not position:
        return jsonify({"success": False, "message": "Missing position"}), 400

    deals = mt5.history_deals_get(position=int(position))
    if deals is None:
        return jsonify({"success": True, "deals": []})

    deal_list = []
    for d in deals:
        deal_list.append({
            "ticket": d.ticket,
            "order": d.order,
            "time": d.time,
            "entry": "IN" if d.entry == mt5.DEAL_ENTRY_IN else ("OUT" if d.entry == mt5.DEAL_ENTRY_OUT else "INOUT"),
            "symbol": d.symbol,
            "volume": float(d.volume),
            "price": float(d.price),
            "profit": float(d.profit),
            "commission": float(d.commission),
            "swap": float(d.swap),
        })
    return jsonify({"success": True, "deals": deal_list})

@app.route("/symbols", methods=["GET"])
def list_symbols():
    """Broker symbol names, optionally filtered by substring. Lets clients
    resolve case/suffix variants (e.g. BTCUSDM -> BTCUSDm on Exness feeds)
    since MT5 symbol matching is case-sensitive."""
    query = (request.args.get("query") or "").upper()
    symbols = mt5.symbols_get()
    if symbols is None:
        return jsonify({"success": False, "message": "Failed to get symbols"}), 500

    names = [s.name for s in symbols]
    if query:
        names = [n for n in names if query in n.upper()]
    return jsonify({"success": True, "count": len(names), "symbols": names[:500]})

@app.route("/price", methods=["GET"])
def get_price():
    symbol = request.args.get("symbol")
    if not symbol:
        return jsonify({"success": False, "message": "Missing symbol"}), 400
        
    if not mt5.symbol_select(symbol, True):
        return jsonify({"success": False, "message": f"Symbol {symbol} not found"}), 400
        
    tick = mt5.symbol_info_tick(symbol)
    if not tick:
        return jsonify({"success": False, "message": "Failed to get tick"}), 400
        
    return jsonify({
        "success": True,
        "ask": tick.ask,
        "bid": tick.bid,
        "last": tick.last
    })

@app.route("/symbol_info", methods=["GET"])
def get_symbol_info():
    symbol = request.args.get("symbol")
    if not symbol:
        return jsonify({"success": False, "message": "Missing symbol"}), 400
        
    if not mt5.symbol_select(symbol, True):
        return jsonify({"success": False, "message": f"Symbol {symbol} not found"}), 400
        
    info = mt5.symbol_info(symbol)
    if info is None:
        return jsonify({"success": False, "message": "Failed to get symbol info"}), 400
        
    return jsonify({
        "success": True,
        "trade_tick_value": info.trade_tick_value,
        "trade_tick_size": info.trade_tick_size,
        "trade_contract_size": info.trade_contract_size,
        "volume_min": info.volume_min,
        "volume_step": info.volume_step,
        "point": info.point
    })

def _get_fresh_tick(symbol, retries=4, delay=0.25):
    """Best-effort live tick. Freshly selected symbols often report no tick
    until the first quote streams in."""
    tick = mt5.symbol_info_tick(symbol)
    attempts = 0
    while attempts < retries and (tick is None or (tick.ask <= 0 and tick.bid <= 0)):
        time.sleep(delay)
        tick = mt5.symbol_info_tick(symbol)
        attempts += 1
    return tick


@app.route("/trade/execute", methods=["POST"])
def execute_trade():
    """Market execution anchored to the CURRENT broker price.

    Signal levels are what the provider posted and are often stale by
    execution time: we fill at the live market price, shift sl/tp by the same
    drift so distances (and therefore risk/reward) are preserved, and clamp
    them to the broker's minimum stop distance so orders aren't rejected."""
    trade = request.json
    if not trade:
        return jsonify({"detail": "Invalid request body"}), 400

    symbol = trade.get("symbol")
    action = trade.get("action")
    volume = float(trade.get("volume", 0.01))
    sl = trade.get("sl")
    tp = trade.get("tp")
    entry = trade.get("entry")  # provider's posted entry price, may be stale
    magic = int(trade.get("magic", 234000))
    deviation = int(trade.get("deviation", 20))

    if not symbol or not action:
        return jsonify({"success": False, "message": "Missing symbol or action"}), 400

    if not mt5.symbol_select(symbol, True):
        return jsonify({"success": False, "message": f"Symbol {symbol} not found"}), 400

    symbol_info = mt5.symbol_info(symbol)
    if symbol_info is None:
        return jsonify({"success": False, "message": f"Failed to get info for {symbol}"}), 400

    is_buy = action.upper() == "BUY"
    order_type = mt5.ORDER_TYPE_BUY if is_buy else mt5.ORDER_TYPE_SELL

    tick = _get_fresh_tick(symbol)
    if tick is None:
        msg = f"No live price available for {symbol} (market closed or feed idle)"
        logger.error(msg)
        return jsonify({"success": False, "message": msg}), 503

    ask = tick.ask or tick.bid
    bid = tick.bid or tick.ask
    ref = ask if is_buy else bid

    point = symbol_info.point or 0.0
    digits = int(getattr(symbol_info, "digits", 5) or 5)

    # Slippage tolerance must scale with the instrument: a fixed point count
    # that suits FX is mere cents on crypto and gets rejected as requotes.
    if point > 0:
        deviation = max(deviation, int((ref * 0.001) / point))

    # --- Re-anchor stops around the live market ---------------------------
    stops_points = getattr(symbol_info, "trade_stops_level", 0) or 0
    min_dist = (stops_points + 2) * point

    shift = 0.0
    try:
        entry_val = float(entry) if entry else 0.0
    except (TypeError, ValueError):
        entry_val = 0.0
    if entry_val > 0:
        shift = entry_val - ref
        logger.info(f"Re-anchoring {symbol}: posted entry {entry_val} vs live {ref} (shift {-shift:.5f})")

    adj_sl = float(sl) - shift if sl else None
    adj_tp = float(tp) - shift if tp else None

    if adj_sl is not None:
        # BUY SL must sit below the bid; SELL SL above the ask
        adj_sl = min(adj_sl, bid - min_dist) if is_buy else max(adj_sl, ask + min_dist)
    if adj_tp is not None:
        # BUY TP must sit above the ask; SELL TP below the bid
        adj_tp = max(adj_tp, ask + min_dist) if is_buy else min(adj_tp, bid - min_dist)

    # Respect the broker's supported filling policies instead of hardcoding IOC
    supported = int(getattr(symbol_info, "filling_mode", 0) or 0)
    fillings = []
    if supported & 2:
        fillings.append(mt5.ORDER_FILLING_IOC)
    if supported & 1:
        fillings.append(mt5.ORDER_FILLING_FOK)
    fillings.append(mt5.ORDER_FILLING_RETURN)

    retryable_retcode = {
        getattr(mt5, "TRADE_RETCODE_INVALID_FILL", 10030),
        getattr(mt5, "TRADE_RETCODE_REQUOTE", 10004),
        getattr(mt5, "TRADE_RETCODE_PRICE_OFF", 10021),
        getattr(mt5, "TRADE_RETCODE_TIMEOUT", 10012),
    }

    last_msg = "Order failed"
    for mode in fillings:
        fresh = _get_fresh_tick(symbol, retries=2, delay=0.2)
        if fresh is None:
            break
        f_ask = fresh.ask or fresh.bid
        f_bid = fresh.bid or fresh.ask
        exec_price = f_ask if is_buy else f_bid

        req = {
            "action": mt5.TRADE_ACTION_DEAL,
            "symbol": symbol,
            "volume": volume,
            "type": order_type,
            "price": round(exec_price, digits),
            "deviation": deviation,
            "magic": magic,
            "comment": "ACE Terminal",
            "type_time": mt5.ORDER_TIME_GTC,
            "type_filling": mode,
        }
        if adj_sl is not None:
            req["sl"] = round(adj_sl, digits)
        if adj_tp is not None:
            req["tp"] = round(adj_tp, digits)

        result = mt5.order_send(req)
        if result is None:
            last_msg = f"order_send returned None: {mt5.last_error()}"
            logger.error(last_msg)
            continue
        if result.retcode == mt5.TRADE_RETCODE_DONE:
            filled = float(result.price) if result.price else exec_price
            logger.info(f"Order placed successfully. Ticket: {result.order} @ {filled}")
            return jsonify({
                "success": True,
                "ticket": result.order,
                "price": filled,
                "volume": float(result.volume or volume),
                "message": "Order executed successfully"
            })
        last_msg = f"retcode={result.retcode} ({getattr(result, 'comment', '')})"
        logger.error(f"Order attempt failed with filling={mode}: {last_msg}")
        if result.retcode not in retryable_retcode:
            break

    return jsonify({"success": False, "message": f"Order failed: {last_msg}"})

@app.route("/trade/close", methods=["POST"])
def close_trade():
    data = request.json
    if not data or "ticket" not in data:
        return jsonify({"success": False, "message": "Missing ticket"}), 400

    ticket = int(data["ticket"])
    position = mt5.positions_get(ticket=ticket)
    if not position or len(position) == 0:
        return jsonify({"success": False, "message": "Position not found"}), 404
        
    pos = position[0]
    symbol = pos.symbol
    lot = pos.volume
    order_type = mt5.ORDER_TYPE_SELL if pos.type == mt5.ORDER_TYPE_BUY else mt5.ORDER_TYPE_BUY
    price = mt5.symbol_info_tick(symbol).bid if order_type == mt5.ORDER_TYPE_SELL else mt5.symbol_info_tick(symbol).ask

    req = {
        "action": mt5.TRADE_ACTION_DEAL,
        "symbol": symbol,
        "volume": lot,
        "type": order_type,
        "position": ticket,
        "price": price,
        "deviation": 20,
        "magic": pos.magic,
        "comment": "ACE Terminal Close",
        "type_time": mt5.ORDER_TIME_GTC,
        "type_filling": mt5.ORDER_FILLING_IOC,
    }

    result = mt5.order_send(req)
    if result.retcode != mt5.TRADE_RETCODE_DONE:
        logger.error(f"Close failed, retcode={result.retcode}")
        return jsonify({"success": False, "message": f"Close failed, retcode={result.retcode}"})

    return jsonify({"success": True, "message": "Position closed successfully"})

@app.route("/trade/modify", methods=["POST"])
def modify_trade():
    data = request.json
    if not data or "ticket" not in data:
        return jsonify({"success": False, "message": "Missing ticket"}), 400

    ticket = int(data["ticket"])
    position = mt5.positions_get(ticket=ticket)
    if not position or len(position) == 0:
        return jsonify({"success": False, "message": "Position not found"}), 404

    pos = position[0]
    req = {
        "action": mt5.TRADE_ACTION_SLTP,
        "symbol": pos.symbol,
        "position": ticket,
        "sl": float(data["sl"]) if "sl" in data else pos.sl,
        "tp": float(data["tp"]) if "tp" in data else pos.tp,
    }

    result = mt5.order_send(req)
    if result.retcode != mt5.TRADE_RETCODE_DONE:
        logger.error(f"Modify failed, retcode={result.retcode}")
        return jsonify({"success": False, "message": f"Modify failed, retcode={result.retcode}"})

    return jsonify({"success": True, "message": "Position modified successfully"})

from simulator import simulate_trade, OrderType

@app.route("/backtest", methods=["POST"])
def backtest():
    data = request.json
    signals = data.get("signals", [])
    config = data.get("config", {
        "maxDurationSeconds": 14 * 24 * 3600,
        "ambiguousCandlePolicy": "CONSERVATIVE"
    })
    
    if not signals:
        return jsonify({"success": True, "results": []})
        
    # Group signals by symbol to minimize MT5 historical calls
    grouped_signals = {}
    for sig in signals:
        sym = sig.get("symbol")
        if not sym:
            continue
        if sym not in grouped_signals:
            grouped_signals[sym] = []
        grouped_signals[sym].append(sig)
        
    results = []
    
    for symbol, sym_signals in grouped_signals.items():
        if not mt5.symbol_select(symbol, True):
            for sig in sym_signals:
                results.append({
                    "tradeId": sig.get("id"),
                    "outcome": "INVALID",
                    "invalidReason": f"Symbol {symbol} not available in MT5"
                })
            continue
            
        # Determine the overall time range needed for this symbol
        min_time = float('inf')
        max_time = 0
        for sig in sym_signals:
            t = int(sig.get("signalTime", 0) / 1000) if sig.get("signalTime", 0) > 10000000000 else int(sig.get("signalTime", 0))
            sig["signalTime"] = t # normalize to seconds
            if t < min_time: min_time = t
            if t > max_time: max_time = t
            
        # Max time needs to account for the maxDurationSeconds
        max_time += config.get("maxDurationSeconds", 14 * 24 * 3600) + 3600 # add 1 hour buffer
        
        rates_data = mt5.copy_rates_range(symbol, mt5.TIMEFRAME_M1, min_time, max_time)
        rates_list = []
        if rates_data is not None and len(rates_data) > 0:
            # Convert to list of dicts
            for r in rates_data:
                rates_list.append({
                    'time': int(r['time']),
                    'open': float(r['open']),
                    'high': float(r['high']),
                    'low': float(r['low']),
                    'close': float(r['close'])
                })
                
        # Run simulation for each signal using the cached rates
        for sig in sym_signals:
            res = simulate_trade(sig, rates_list, config)
            results.append(res)
            
    return jsonify({"success": True, "results": results})

if __name__ == "__main__":
    app.run(host="127.0.0.1", port=8000, debug=True, use_reloader=False)
