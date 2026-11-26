"""Signal watchdog: an independent second pair of eyes on the trading pipeline.

It logs into Telegram as its own device (separate from the app), listens to
the same channels the app monitors, and for every message checks what the
app did with it:

    received by the app?  ->  signal status / reason  ->  trade rows  ->  MT5 position

Each finding is printed as ONE JSON line on stdout, so a supervisor (e.g. a
Claude Code Monitor) can react to it. It is strictly read-only: it never
writes to the app database, never sends Telegram messages and never trades.

Usage (from the repo root):
    .venv\\Scripts\\python tools\\watchdog\\watchdog.py login   # once, interactive
    .venv\\Scripts\\python tools\\watchdog\\watchdog.py run     # stream findings
"""
import asyncio
import hashlib
import json
import os
import re
import sqlite3
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
SESSION = HERE / "watchdog.session"          # gitignored - grants account access
CONFIG = HERE / "watchdog.config.json"       # gitignored - api id/hash
APP_DB = Path(os.environ.get("APPDATA", "")) / "com.yetrade.app" / "trading-terminal.db"

# Give the app time to parse, risk-check and route the order before judging.
CHECK_DELAY_SECONDS = 25
CHANNEL_REFRESH_SECONDS = 60
TEXT_LIMIT = 600


def emit(kind, **data):
    print(json.dumps({"event": kind, "at": time.strftime("%H:%M:%S"), **data}, ensure_ascii=False), flush=True)


# --- Read-only views of the app's state ----------------------------------------
def db():
    return sqlite3.connect(f"file:{APP_DB}?mode=ro", uri=True, timeout=5)


def active_channels():
    with db() as c:
        return {str(r[0]): r[1] for r in c.execute(
            "select channel_id, name from telegram_channels where is_active = 1")}


def app_view(channel_id, message_id):
    """What the app recorded for one Telegram message."""
    row_id = f"{channel_id}:{message_id}"
    with db() as c:
        cols = {r[1] for r in c.execute("pragma table_info(signals)")}
        reason_col = "reject_reason" if "reject_reason" in cols else "null"
        msg = c.execute("select received_at from telegram_messages where id = ?", (row_id,)).fetchone()
        sig = c.execute(
            f"select symbol, direction, entry, stop_loss, status, {reason_col} from signals where id = ?",
            (row_id,)).fetchone()
        trades = c.execute(
            "select id, symbol, direction, volume, entry_price, status from trades where signal_id = ?",
            (row_id,)).fetchall()
    return {
        "app_received": msg is not None,
        "signal": None if sig is None else dict(zip(
            ("symbol", "direction", "entry", "stop_loss", "status", "reason"), sig)),
        "trades": [dict(zip(("ticket", "symbol", "direction", "volume", "entry", "status"), t)) for t in trades],
    }


def mt5_view(channel_id, message_id):
    """Broker-side truth: positions/deals carrying this signal's order tag."""
    try:
        import MetaTrader5 as mt5
    except ImportError:
        return {"mt5": "MetaTrader5 package not installed"}
    if not mt5.initialize():
        return {"mt5": f"not reachable: {mt5.last_error()}"}
    try:
        term = mt5.terminal_info()
        signal_id = f"{channel_id}:{message_id}"
        # Same tag the bridge writes into the order comment (python-bridge/main.py _order_tag)
        tags = {"ACE:" + hashlib.sha1(f"{signal_id}#{i}".encode()).hexdigest()[:16] for i in range(4)}
        positions = [
            {"ticket": p.ticket, "symbol": p.symbol, "volume": p.volume, "price": p.price_open}
            for p in (mt5.positions_get() or []) if p.comment in tags
        ]
        now = int(time.time())
        deals = [
            {"position": d.position_id, "symbol": d.symbol, "volume": d.volume, "price": d.price}
            for d in (mt5.history_deals_get(now - 3600, now + 60) or []) if d.comment in tags
        ]
        return {"mt5_autotrading": bool(term.trade_allowed) if term else None,
                "mt5_positions": positions, "mt5_deals": deals}
    finally:
        mt5.shutdown()


# Mirrors RegexParser.canParse in src/core/signal-engine/parser.ts (a hint only;
# the supervisor decides whether the message really was a tradeable signal).
def looks_like_signal(text):
    up = text.upper()
    has_dir = "BUY" in up or "SELL" in up
    has_levels = any(k in up for k in ("SL", "S/L", "STOP", "TP", "T/P", "TARGET"))
    return has_dir and has_levels


def strip_100(peer_id):
    return re.sub(r"^-100", "", str(peer_id)).lstrip("-")


# --- Telegram ------------------------------------------------------------------
def load_config():
    if not CONFIG.exists():
        sys.exit("No watchdog.config.json - run the 'login' command first.")
    return json.loads(CONFIG.read_text())


async def login():
    from telethon import TelegramClient
    print("One-time login for the signal watchdog (a separate Telegram device).")
    print("Get api_id / api_hash at https://my.telegram.org -> API development tools")
    print("(you can reuse the same ones the app uses).\n")
    api_id = int(input("api_id: ").strip())
    api_hash = input("api_hash: ").strip()
    CONFIG.write_text(json.dumps({"api_id": api_id, "api_hash": api_hash}))
    client = TelegramClient(str(SESSION.with_suffix("")), api_id, api_hash,
                            device_model="YeTrade Watchdog")
    await client.start()  # prompts for phone, code and 2FA password
    me = await client.get_me()
    print(f"\nLogged in as {me.first_name}. Session saved to {SESSION.name}.")
    await client.disconnect()


async def run():
    from telethon import TelegramClient, events
    if not APP_DB.exists():
        sys.exit(f"App database not found at {APP_DB}")
    cfg = load_config()
    client = TelegramClient(str(SESSION.with_suffix("")), cfg["api_id"], cfg["api_hash"],
                            device_model="YeTrade Watchdog")
    await client.connect()
    if not await client.is_user_authorized():
        sys.exit("Watchdog session is not logged in - run the 'login' command first.")
    await client.get_dialogs()  # warm the entity cache so channel updates resolve

    channels = active_channels()
    emit("ready", channels=list(channels.values()))
    seen = set()

    async def refresh_channels():
        nonlocal channels
        while True:
            await asyncio.sleep(CHANNEL_REFRESH_SECONDS)
            try:
                latest = active_channels()
                if latest.keys() != channels.keys():
                    emit("channels_changed", channels=list(latest.values()))
                channels = latest
            except Exception as e:  # app may hold a write lock briefly
                emit("watchdog_error", where="refresh_channels", error=str(e))

    async def inspect(channel_id, message_id, text, edited):
        await asyncio.sleep(CHECK_DELAY_SECONDS)
        try:
            report = {
                "channel": channels.get(channel_id, channel_id),
                "channel_id": channel_id,
                "message_id": message_id,
                "edited": edited,
                "looks_like_signal": looks_like_signal(text),
                "text": text[:TEXT_LIMIT],
                **app_view(channel_id, message_id),
            }
            if report["looks_like_signal"] or report["signal"]:
                report.update(mt5_view(channel_id, message_id))
            emit("message", **report)
        except Exception as e:
            emit("watchdog_error", where="inspect", message_id=message_id, error=str(e))

    async def on_message(event, edited=False):
        channel_id = strip_100(event.chat_id)
        if channel_id not in channels:
            return
        key = (channel_id, event.id, edited)
        if key in seen:
            return
        seen.add(key)
        asyncio.create_task(inspect(channel_id, str(event.id), event.raw_text or "", edited))

    client.add_event_handler(lambda e: on_message(e, False), events.NewMessage())
    client.add_event_handler(lambda e: on_message(e, True), events.MessageEdited())
    asyncio.create_task(refresh_channels())
    await client.run_until_disconnected()
    emit("watchdog_error", where="telegram", error="disconnected")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    cmd = sys.argv[1] if len(sys.argv) > 1 else "run"
    asyncio.run(login() if cmd == "login" else run())
