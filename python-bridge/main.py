import MetaTrader5 as mt5
from flask import Flask, request, jsonify
from flask_cors import CORS
import logging
import atexit
import hashlib
import hmac
import os
import threading
import time

app = Flask(__name__)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# --- Access control ----------------------------------------------------------
# The bridge can place and close live trades, so it must never be reachable
# from arbitrary web pages the user happens to visit:
#  - CORS only admits the Tauri webview (and the Vite dev server),
#  - the Host header must be loopback, which defeats DNS-rebinding attacks,
#  - when launched by the app, every request must carry the per-launch token.
BRIDGE_PORT = int(os.environ.get("BRIDGE_PORT", "8000"))
BRIDGE_TOKEN = os.environ.get("BRIDGE_TOKEN") or None
ALLOWED_ORIGINS = [
    "tauri://localhost",
    "http://tauri.localhost",
    "https://tauri.localhost",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
]
ALLOWED_HOSTS = {f"127.0.0.1:{BRIDGE_PORT}", f"localhost:{BRIDGE_PORT}"}

CORS(app, origins=ALLOWED_ORIGINS)

if BRIDGE_TOKEN is None:
    logger.warning("BRIDGE_TOKEN not set - requests are not token-authenticated (dev mode)")


@app.before_request
def enforce_access_control():
    if request.host not in ALLOWED_HOSTS:
        return jsonify({"success": False, "message": "Forbidden host"}), 403
    # CORS preflights carry no custom headers; flask_cors answers them.
    if request.method == "OPTIONS":
        return None
    if BRIDGE_TOKEN is not None:
        supplied = request.headers.get("X-Bridge-Token", "")
        if not hmac.compare_digest(supplied, BRIDGE_TOKEN):
            return jsonify({"success": False, "message": "Unauthorized"}), 401
    return None

# --- Execution idempotency -------------------------------------------------
# Clients key each order leg (signalId#splitIndex). If a request times out and
# is retried, the original result is replayed instead of opening a duplicate
# position. Two layers:
#  - an in-memory cache (fast path while this process lives),
#  - the order comment carries a hash of the key, so after a bridge restart
#    the broker's own positions/deals still reveal an earlier fill.
# Requests are served one at a time (threaded=False below), so check-then-send
# cannot race with a concurrent retry.
_exec_lock = threading.Lock()
_exec_results = {}
EXEC_CACHE_MAX_ENTRIES = 500
# Deal history searched for a tagged fill after a restart
IDEMPOTENCY_LOOKBACK_SECONDS = 2 * 24 * 3600


def _order_tag(key):
    """MT5 comments hold ~31 chars, so the key is hashed into a short tag."""
    return "ACE:" + hashlib.sha1(key.encode("utf-8")).hexdigest()[:16]


def _find_tagged_fill(tag):
    """Result payload of an earlier fill carrying `tag`, or None."""
    for p in mt5.positions_get() or []:
        if getattr(p, "comment", "") == tag:
            return {"success": True, "ticket": p.ticket, "price": float(p.price_open),
                    "volume": float(p.volume), "message": "Order already executed (recovered)"}
    now = int(time.time())
    for d in mt5.history_deals_get(now - IDEMPOTENCY_LOOKBACK_SECONDS, now + 60) or []:
        if getattr(d, "comment", "") == tag and d.entry == mt5.DEAL_ENTRY_IN:
            return {"success": True, "ticket": d.position_id, "price": float(d.price),
                    "volume": float(d.volume), "message": "Order already executed (recovered)"}
    return None


def _exec_cache_get(key):
    with _exec_lock:
        return _exec_results.get(key)


def _exec_cache_put(key, payload):
    with _exec_lock:
        if len(_exec_results) >= EXEC_CACHE_MAX_ENTRIES:
            _exec_results.pop(next(iter(_exec_results)))
        _exec_results[key] = payload

# --- Lifecycle ---
def shutdown_event():
    mt5.shutdown()

# Register shutdown
atexit.register(shutdown_event)


def _exit_when_app_exits():
    """Terminate once the launching app process is gone.

    Without this the bridge outlives the app (PyInstaller's onefile child is
    not killed with the sidecar), keeps the port bound with a stale token,
    and the next launch's bridge cannot start."""
    raw = os.environ.get("APP_PID")
    if not raw:
        return  # started by hand (dev mode)
    try:
        app_pid = int(raw)
    except ValueError:
        return

    if os.name == "nt":
        import ctypes
        SYNCHRONIZE = 0x00100000
        INFINITE = 0xFFFFFFFF
        kernel32 = ctypes.windll.kernel32
        handle = kernel32.OpenProcess(SYNCHRONIZE, False, app_pid)
        if handle:
            kernel32.WaitForSingleObject(handle, INFINITE)
            kernel32.CloseHandle(handle)
    else:
        while True:
            try:
                os.kill(app_pid, 0)
            except OSError:
                break
            time.sleep(2)

    logger.info("App process exited - shutting down bridge")
    try:
        mt5.shutdown()
    finally:
        os._exit(0)


threading.Thread(target=_exit_when_app_exits, daemon=True).start()

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

    try:
        login_num = int(login_id) if login_id else None
    except (TypeError, ValueError):
        return jsonify({"success": False, "message": "Login must be a number"}), 400

    # Pass credentials directly to initialize to prevent UAC or IPC prompt blocks
    if login_num:
        init_kwargs["login"] = login_num
    if password:
        init_kwargs["password"] = password
    if server:
        init_kwargs["server"] = server

    logger.info(f"Calling mt5.initialize(keys={sorted(k for k in init_kwargs if k != 'password')})")
    
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
        authorized = mt5.login(login_num, password=password, server=server)
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
    return jsonify({
        "status": "ok",
        "connected": terminal_info.connected,
        # False while MT5's "Algo Trading" button is off: every order fails
        "trade_allowed": bool(terminal_info.trade_allowed),
    })

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
        # A failed query is not "no deals" - callers decide closures from this
        return jsonify({"success": False, "message": f"Failed to get deals: {mt5.last_error()}"}), 500

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


def _filling_modes(symbol_info):
    """The broker's supported filling policies, most preferred first."""
    supported = int(getattr(symbol_info, "filling_mode", 0) or 0)
    fillings = []
    if supported & 2:
        fillings.append(mt5.ORDER_FILLING_IOC)
    if supported & 1:
        fillings.append(mt5.ORDER_FILLING_FOK)
    fillings.append(mt5.ORDER_FILLING_RETURN)
    return fillings


def _retryable_retcodes():
    """Retcodes worth retrying with the next filling mode / a fresh price."""
    return {
        getattr(mt5, "TRADE_RETCODE_INVALID_FILL", 10030),
        getattr(mt5, "TRADE_RETCODE_REQUOTE", 10004),
        getattr(mt5, "TRADE_RETCODE_PRICE_OFF", 10021),
        getattr(mt5, "TRADE_RETCODE_TIMEOUT", 10012),
    }


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

    # Idempotent replay: a retried leg returns its original result untouched
    idempotency_key = trade.get("idempotencyKey")
    if idempotency_key:
        cached = _exec_cache_get(idempotency_key)
        if cached is not None:
            logger.info(f"Idempotent replay for {idempotency_key} - returning cached result")
            return jsonify(cached)

    order_tag = _order_tag(idempotency_key) if idempotency_key else "ACE Terminal"
    if idempotency_key:
        # Cache misses after a bridge restart: the broker still knows the fill
        recovered = _find_tagged_fill(order_tag)
        if recovered is not None:
            logger.info(f"Idempotent replay for {idempotency_key} - recovered fill #{recovered['ticket']} from broker")
            _exec_cache_put(idempotency_key, recovered)
            return jsonify(recovered)

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

    # MT5 rejects every API order (retcode 10027) while the terminal's
    # "Algo Trading" button is off - say so plainly instead of a bare retcode.
    term = mt5.terminal_info()
    if term is not None and not term.trade_allowed:
        msg = ("AutoTrading is disabled in MetaTrader 5 - click the 'Algo Trading' "
               "button in the MT5 toolbar so it turns green")
        logger.error(msg)
        return jsonify({"success": False, "message": msg}), 409

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

    # Slippage tolerance is the user's configured deviation, honored as-is.
    # (Crypto symbols with tiny points may need a larger setting.)

    # --- Re-anchor stops around the live market ---------------------------
    stops_points = getattr(symbol_info, "trade_stops_level", 0) or 0
    min_dist = (stops_points + 2) * point

    shift = 0.0
    try:
        entry_val = float(entry) if entry else 0.0
    except (TypeError, ValueError):
        entry_val = 0.0
    sl_val = float(sl) if sl else None
    # Distance the client sized the position for; re-anchoring preserves it
    sized_stop_dist = abs(entry_val - sl_val) if entry_val > 0 and sl_val else 0.0

    if entry_val > 0 and sl_val:
        if (is_buy and sl_val >= entry_val) or (not is_buy and sl_val <= entry_val):
            msg = f"Stop loss {sl_val} is on the wrong side of entry {entry_val} for a {action.upper()}"
            logger.error(msg)
            return jsonify({"success": False, "message": msg}), 400

    if entry_val > 0:
        shift = entry_val - ref
        # Re-anchoring keeps the provider's distances, but only while the
        # market is still near the posted entry: chasing a move that already
        # ran a large share of the stop is a different trade.
        max_drift_r = float(trade.get("maxEntryDriftR", 0.5))
        if sized_stop_dist > 0 and abs(shift) > max_drift_r * sized_stop_dist:
            msg = (f"Price moved too far from entry: live {ref} vs posted {entry_val} "
                   f"({abs(shift) / sized_stop_dist:.2f}R > {max_drift_r}R)")
            logger.error(msg)
            return jsonify({"success": False, "message": msg}), 409
        logger.info(f"Re-anchoring {symbol}: posted entry {entry_val} vs live {ref} (shift {-shift:.5f})")

    adj_sl = sl_val - shift if sl_val else None
    adj_tp = float(tp) - shift if tp else None

    if adj_sl is not None:
        # BUY SL must sit below the bid; SELL SL above the ask
        adj_sl = min(adj_sl, bid - min_dist) if is_buy else max(adj_sl, ask + min_dist)
        # The clamp may only tighten risk - never widen past what was sized
        if sized_stop_dist > 0 and abs(ref - adj_sl) > sized_stop_dist + point:
            msg = (f"Broker minimum stop distance forces a wider stop than sized "
                   f"({abs(ref - adj_sl):.5f} > {sized_stop_dist:.5f})")
            logger.error(msg)
            return jsonify({"success": False, "message": msg}), 400
    if adj_tp is not None:
        # BUY TP must sit above the ask; SELL TP below the bid
        adj_tp = max(adj_tp, ask + min_dist) if is_buy else min(adj_tp, bid - min_dist)

    retryable_retcode = _retryable_retcodes()

    last_msg = "Order failed"
    for mode in _filling_modes(symbol_info):
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
            "comment": order_tag,
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
            payload = {
                "success": True,
                "ticket": result.order,
                "price": filled,
                "volume": float(result.volume or volume),
                "message": "Order executed successfully"
            }
            if idempotency_key:
                _exec_cache_put(idempotency_key, payload)
            return jsonify(payload)
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

    try:
        ticket = int(data["ticket"])
    except (TypeError, ValueError):
        return jsonify({"success": False, "message": "Invalid ticket"}), 400
    position = mt5.positions_get(ticket=ticket)
    if not position or len(position) == 0:
        return jsonify({"success": False, "message": "Position not found"}), 404

    pos = position[0]
    symbol = pos.symbol
    lot = pos.volume
    info = mt5.symbol_info(symbol)
    if info is None:
        return jsonify({"success": False, "message": f"Failed to get info for {symbol}"}), 503

    # Optional partial close: snap DOWN to the broker's volume step. If the
    # remainder would fall below the minimum lot, close fully (less risk,
    # never more).
    requested_volume = data.get("volume")
    if requested_volume is not None:
        vol_min = float(getattr(info, "volume_min", 0.01) or 0.01)
        vol_step = float(getattr(info, "volume_step", 0.01) or 0.01)
        try:
            requested_volume = float(requested_volume)
        except (TypeError, ValueError):
            return jsonify({"success": False, "message": "Invalid volume"}), 400
        step_decimals = len(repr(vol_step).split(".")[1]) if "." in repr(vol_step) else 0
        stepped = round(int(requested_volume / vol_step + 1e-9) * vol_step, step_decimals)
        if stepped < vol_min:
            return jsonify({"success": False, "message": f"Partial volume below broker minimum ({vol_min})"}), 400
        if stepped >= pos.volume or pos.volume - stepped < vol_min - 1e-9:
            lot = pos.volume
        else:
            lot = stepped

    order_type = mt5.ORDER_TYPE_SELL if pos.type == mt5.ORDER_TYPE_BUY else mt5.ORDER_TYPE_BUY
    last_msg = "Close failed"
    for mode in _filling_modes(info):
        tick = _get_fresh_tick(symbol, retries=2, delay=0.2)
        if tick is None:
            return jsonify({"success": False, "message": f"No live price for {symbol}"}), 503
        req = {
            "action": mt5.TRADE_ACTION_DEAL,
            "symbol": symbol,
            "volume": lot,
            "type": order_type,
            "position": ticket,
            "price": tick.bid if order_type == mt5.ORDER_TYPE_SELL else tick.ask,
            "deviation": 20,
            "magic": pos.magic,
            "comment": "ACE Terminal Close",
            "type_time": mt5.ORDER_TIME_GTC,
            "type_filling": mode,
        }
        result = mt5.order_send(req)
        if result is None:
            last_msg = f"order_send returned None: {mt5.last_error()}"
            logger.error(last_msg)
            continue
        if result.retcode == mt5.TRADE_RETCODE_DONE:
            return jsonify({"success": True, "message": "Position closed successfully", "volume": lot})
        last_msg = f"Close failed, retcode={result.retcode} ({getattr(result, 'comment', '')})"
        logger.error(f"{last_msg} with filling={mode}")
        if result.retcode not in _retryable_retcodes():
            break

    return jsonify({"success": False, "message": last_msg})

@app.route("/trade/modify", methods=["POST"])
def modify_trade():
    data = request.json
    if not data or "ticket" not in data:
        return jsonify({"success": False, "message": "Missing ticket"}), 400

    try:
        ticket = int(data["ticket"])
        new_sl = float(data["sl"]) if data.get("sl") is not None else None
        new_tp = float(data["tp"]) if data.get("tp") is not None else None
    except (TypeError, ValueError):
        return jsonify({"success": False, "message": "Invalid ticket or levels"}), 400
    position = mt5.positions_get(ticket=ticket)
    if not position or len(position) == 0:
        return jsonify({"success": False, "message": "Position not found"}), 404

    pos = position[0]
    req = {
        "action": mt5.TRADE_ACTION_SLTP,
        "symbol": pos.symbol,
        "position": ticket,
        "sl": new_sl if new_sl is not None else pos.sl,
        "tp": new_tp if new_tp is not None else pos.tp,
    }

    result = mt5.order_send(req)
    if result is None:
        logger.error(f"Modify failed: order_send returned None: {mt5.last_error()}")
        return jsonify({"success": False, "message": f"Modify failed: {mt5.last_error()}"})
    if result.retcode != mt5.TRADE_RETCODE_DONE:
        logger.error(f"Modify failed, retcode={result.retcode}")
        return jsonify({"success": False, "message": f"Modify failed, retcode={result.retcode}"})

    return jsonify({"success": True, "message": "Position modified successfully"})

from simulator import simulate_trade, OrderType

@app.route("/backtest", methods=["POST"])
def backtest():
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return jsonify({"success": False, "message": "Invalid request body"}), 400
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
    # threaded=False: the MetaTrader5 package is not thread-safe, and serial
    # handling also makes the idempotency check-then-send race-free.
    app.run(host="127.0.0.1", port=BRIDGE_PORT, debug=False, use_reloader=False, threaded=False)
