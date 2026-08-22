import pytest
from simulator import simulate_trade, OrderType, Outcome, AmbiguityPolicy

@pytest.fixture
def base_config():
    return {
        "maxDurationSeconds": 14 * 24 * 3600,
        "ambiguousCandlePolicy": AmbiguityPolicy.CONSERVATIVE
    }

def test_invalid_signal(base_config):
    # BUY but SL is above Entry
    signal = {
        "id": "1",
        "symbol": "EURUSD",
        "direction": "BUY",
        "requestedEntry": 1.1000,
        "sl": 1.1050,
        "tp": 1.1100,
        "signalTime": 1000
    }
    res = simulate_trade(signal, [], base_config)
    assert res["outcome"] == Outcome.INVALID
    assert res["executionReason"] == "INVALID_SIGNAL"

def test_limit_not_filled(base_config):
    signal = {
        "id": "1",
        "symbol": "EURUSD",
        "direction": "BUY",
        "orderType": OrderType.LIMIT,
        "requestedEntry": 1.1000,
        "sl": 1.0900,
        "tp": 1.1100,
        "signalTime": 1000
    }
    
    # Prices stay above 1.1000, limit never triggers
    rates = [
        {'time': 1060, 'open': 1.1020, 'high': 1.1050, 'low': 1.1010, 'close': 1.1030},
        {'time': 1120, 'open': 1.1030, 'high': 1.1040, 'low': 1.1020, 'close': 1.1035},
    ]
    
    res = simulate_trade(signal, rates, base_config)
    assert res["outcome"] == Outcome.NOT_FILLED
    assert res["executionReason"] == "LIMIT_PRICE_NEVER_REACHED"

def test_market_filled_then_win(base_config):
    signal = {
        "id": "2",
        "symbol": "EURUSD",
        "direction": "BUY",
        "orderType": OrderType.MARKET,
        "requestedEntry": 1.1000,
        "sl": 1.0900,
        "tp": 1.1100,
        "signalTime": 1000
    }
    
    rates = [
        # Candle 1: Market execution fills at OPEN (1.1020)
        {'time': 1060, 'open': 1.1020, 'high': 1.1030, 'low': 1.1010, 'close': 1.1030},
        # Candle 2: Hits TP (1.1100)
        {'time': 1120, 'open': 1.1030, 'high': 1.1150, 'low': 1.1020, 'close': 1.1100},
    ]
    
    res = simulate_trade(signal, rates, base_config)
    assert res["outcome"] == Outcome.WIN
    assert res["actualEntry"] == 1.1020
    assert res["entryFillStatus"] == "FILLED"
    assert res["executionReason"] == "TAKE_PROFIT_TOUCHED"
    # R = (TP - Entry) / (Entry - SL) = (1.1100 - 1.1020) / (1.1020 - 1.0900) = 0.0080 / 0.0120 = 0.67
    assert abs(res["rMultiple"] - 0.67) < 0.01

def test_conservative_ambiguity(base_config):
    signal = {
        "id": "3",
        "symbol": "EURUSD",
        "direction": "SELL",
        "orderType": OrderType.LIMIT,
        "requestedEntry": 1.1000,
        "sl": 1.1050,
        "tp": 1.0900,
        "signalTime": 1000
    }
    
    rates = [
        # Entry triggered
        {'time': 1060, 'open': 1.0950, 'high': 1.1020, 'low': 1.0950, 'close': 1.1010},
        # Next candle hits BOTH SL and TP
        {'time': 1120, 'open': 1.1000, 'high': 1.1100, 'low': 1.0800, 'close': 1.0950},
    ]
    
    res = simulate_trade(signal, rates, base_config)
    assert res["actualEntry"] == 1.1000
    assert res["ambiguityFlag"] is True
    assert res["outcome"] == Outcome.LOSS # Conservative policy
    assert res["executionReason"] == "SAME_CANDLE_AMBIGUITY_SL"
    assert res["rMultiple"] == -1.0

def test_expired_trade(base_config):
    signal = {
        "id": "4",
        "symbol": "EURUSD",
        "direction": "BUY",
        "orderType": OrderType.LIMIT,
        "requestedEntry": 1.1000,
        "sl": 1.0900,
        "tp": 1.1100,
        "signalTime": 1000
    }
    
    # 2 day duration config
    config = {
        "maxDurationSeconds": 2 * 24 * 3600,
        "ambiguousCandlePolicy": AmbiguityPolicy.CONSERVATIVE
    }
    
    rates = [
        # Entry filled
        {'time': 1060, 'open': 1.1050, 'high': 1.1050, 'low': 1.0950, 'close': 1.1000},
        # One day later
        {'time': 1060 + 86400, 'open': 1.1000, 'high': 1.1050, 'low': 1.0950, 'close': 1.1000},
        # Three days later (expired)
        {'time': 1060 + 3 * 86400, 'open': 1.1000, 'high': 1.1050, 'low': 1.0950, 'close': 1.1000},
    ]
    
    res = simulate_trade(signal, rates, config)
    assert res["outcome"] == Outcome.EXPIRED
    assert res["executionReason"] == "MAX_DURATION_REACHED"
    assert res["durationSeconds"] >= 2 * 24 * 3600
    assert res["rMultiple"] == 0.0
