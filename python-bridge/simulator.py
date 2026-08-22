import math

class OrderType:
    MARKET = "MARKET"
    LIMIT = "LIMIT"

class Outcome:
    WIN = "WIN"
    LOSS = "LOSS"
    EXPIRED = "EXPIRED"
    NOT_FILLED = "NOT_FILLED"
    INVALID = "INVALID"
    PENDING = "PENDING"

class AmbiguityPolicy:
    CONSERVATIVE = "CONSERVATIVE"
    OPTIMISTIC = "OPTIMISTIC"

def validate_signal(direction, entry, sl, tp):
    if entry <= 0 or sl <= 0 or tp <= 0:
        return False, "Prices must be greater than 0"
    
    if direction == "BUY":
        if not (sl < entry < tp):
            return False, f"Invalid BUY arrangement: SL({sl}) < Entry({entry}) < TP({tp}) is False"
    elif direction == "SELL":
        if not (tp < entry < sl):
            return False, f"Invalid SELL arrangement: TP({tp}) < Entry({entry}) < SL({sl}) is False"
    else:
        return False, "Invalid direction"
    
    return True, ""

def calculate_rmultiple(direction, actual_entry, sl, exit_price):
    if direction == "BUY":
        risk = actual_entry - sl
        reward = exit_price - actual_entry
        return reward / risk if risk != 0 else 0.0
    else:
        risk = sl - actual_entry
        reward = actual_entry - exit_price
        return reward / risk if risk != 0 else 0.0

def simulate_trade(signal, rates, config):
    """
    signal: dict with id, symbol, direction, orderType, requestedEntry, sl, tp, signalTime
    rates: list of dicts [{'time': ts, 'open': o, 'high': h, 'low': l, 'close': c}]
    config: dict
    """
    trade_id = signal.get("id")
    direction = signal.get("direction")
    requested_entry = float(signal.get("requestedEntry", 0))
    sl = float(signal.get("sl", 0))
    tp = float(signal.get("tp", 0))
    order_type = signal.get("orderType", OrderType.LIMIT) # Default to exact reach matching
    signal_time = int(signal.get("signalTime", 0)) # Seconds UTC
    
    valid, reason = validate_signal(direction, requested_entry, sl, tp)
    
    res = {
        "tradeId": trade_id,
        "signalId": trade_id,
        "symbol": signal.get("symbol"),
        "direction": direction,
        "orderType": order_type,
        "requestedEntry": requested_entry,
        "actualEntry": None,
        "sl": sl,
        "tp": tp,
        "signalTime": signal_time * 1000, # return as MS for js
        "entryTime": None,
        "exitTime": None,
        "exitPrice": None,
        "outcome": Outcome.INVALID if not valid else Outcome.PENDING,
        "rMultiple": 0.0,
        "durationSeconds": 0,
        "candlesEvaluated": 0,
        "entryFillStatus": "NOT_FILLED",
        "ambiguityFlag": False,
        "dataQuality": "OK",
        "invalidReason": reason if not valid else None,
        "executionReason": None
    }
    
    if not valid:
        res["executionReason"] = "INVALID_SIGNAL"
        return res
        
    actual_entry = None
    entry_time = None
    
    # Strictly after signal Time (no look-ahead)
    eval_rates = [r for r in rates if r['time'] > signal_time]
    
    if not eval_rates:
        res["outcome"] = Outcome.NOT_FILLED
        res["dataQuality"] = "NO_DATA"
        res["executionReason"] = "NO_HISTORICAL_DATA"
        return res
        
    # 1. Entry Resolution
    entry_index = -1
    for i, rate in enumerate(eval_rates):
        high = rate['high']
        low = rate['low']
        open_price = rate['open']
        
        if order_type == OrderType.MARKET:
            actual_entry = open_price
            entry_time = rate['time']
            entry_index = i
            break
        elif order_type == OrderType.LIMIT:
            if direction == "BUY" and low <= requested_entry:
                actual_entry = requested_entry
                entry_time = rate['time']
                entry_index = i
                break
            elif direction == "SELL" and high >= requested_entry:
                actual_entry = requested_entry
                entry_time = rate['time']
                entry_index = i
                break
                
    if entry_index == -1:
        res["outcome"] = Outcome.NOT_FILLED
        res["candlesEvaluated"] = len(eval_rates)
        res["executionReason"] = "LIMIT_PRICE_NEVER_REACHED"
        return res
        
    res["actualEntry"] = actual_entry
    res["entryTime"] = entry_time * 1000
    res["entryFillStatus"] = "FILLED"
    
    # 2. Trade Resolution
    max_duration = config.get("maxDurationSeconds", 14 * 24 * 3600)
    ambiguity_policy = config.get("ambiguousCandlePolicy", AmbiguityPolicy.CONSERVATIVE)
    
    exit_time = None
    exit_price = None
    outcome = Outcome.EXPIRED
    execution_reason = "MAX_DURATION_REACHED"
    candles_evaluated = entry_index + 1
    ambiguity_flag = False
    
    for i in range(entry_index, len(eval_rates)):
        rate = eval_rates[i]
        time = rate['time']
        high = rate['high']
        low = rate['low']
        
        candles_evaluated += 1
        
        if time - entry_time > max_duration:
            break
            
        hit_sl = False
        hit_tp = False
        
        if direction == "BUY":
            if low <= sl:
                hit_sl = True
            if high >= tp:
                hit_tp = True
        else: # SELL
            if high >= sl:
                hit_sl = True
            if low <= tp:
                hit_tp = True
                
        if hit_sl and hit_tp:
            ambiguity_flag = True
            if ambiguity_policy == AmbiguityPolicy.CONSERVATIVE:
                outcome = Outcome.LOSS
                exit_price = sl
                exit_time = time
                execution_reason = "SAME_CANDLE_AMBIGUITY_SL"
                break
            else:
                outcome = Outcome.WIN
                exit_price = tp
                exit_time = time
                execution_reason = "SAME_CANDLE_AMBIGUITY_TP"
                break
        elif hit_sl:
            outcome = Outcome.LOSS
            exit_price = sl
            exit_time = time
            execution_reason = "STOP_LOSS_TOUCHED"
            break
        elif hit_tp:
            outcome = Outcome.WIN
            exit_price = tp
            exit_time = time
            execution_reason = "TAKE_PROFIT_TOUCHED"
            break

    res["outcome"] = outcome
    res["executionReason"] = execution_reason
    
    if outcome == Outcome.EXPIRED:
        # For expired trades, the exit time is exactly max_duration after entry_time
        exit_time = entry_time + max_duration
        exit_price = rate['close'] # Approximate exit price at expiry
    
    res["exitTime"] = exit_time * 1000 if exit_time else None
    res["exitPrice"] = exit_price
    res["candlesEvaluated"] = candles_evaluated
    res["ambiguityFlag"] = ambiguity_flag
    
    if exit_time:
        res["durationSeconds"] = exit_time - entry_time
        res["rMultiple"] = round(calculate_rmultiple(direction, actual_entry, sl, exit_price), 2) if outcome != Outcome.EXPIRED else 0.0
        
    return res
