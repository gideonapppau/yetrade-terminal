# Running YeTrade on a VPS

YeTrade runs 24/7 on a Windows VPS. You check on it from your phone through
the Telegram messages it sends to your **Saved Messages**.

## 1. Choose the VPS

MetaTrader 5 only runs on Windows, so it **must be a Windows VPS**.

| | Minimum |
|---|---|
| OS | Windows Server 2019/2022, or Windows 10/11 |
| CPU / RAM | 2 vCPU, 4 GB RAM |
| Disk | 40 GB |
| Location | Close to your broker's servers (lower slippage) |

Many brokers, Exness included, offer a free or discounted VPS to clients who
qualify. Check your broker's client area before paying for one.

## 2. Install everything (over Remote Desktop)

1. Connect to the VPS with **Remote Desktop**.
2. Install **MetaTrader 5** from your broker and log in to your **demo**
   account once. Then turn on **Algo Trading** (green), and under
   **Tools → Options → Expert Advisors** tick *Allow algorithmic trading*
   and untick both *Disable algorithmic trading when…* boxes.
3. Download and install YeTrade:
   https://github.com/gideonapppau/yetrade-terminal/releases/latest
4. Open YeTrade:
   - **Telegram:** log in. The code arrives in Telegram on your phone or PC.
   - **Settings → MetaTrader 5:** connect your demo account with
     **Remember password** ticked.
   - **Settings → Monitored Channels:** add your channels.
   - **Settings → General:** keep **Telegram Trade Reports** on.
5. Copy the `tools\vps` folder from this repository to the VPS (for example
   to `C:\YeTrade\vps`).
6. Open **PowerShell as Administrator** and run:
   ```powershell
   Set-ExecutionPolicy -Scope Process Bypass
   C:\YeTrade\vps\setup-vps.ps1
   ```
   This stops the VPS from sleeping, stops Windows Update from rebooting it
   while you're signed in, and adds a task that restarts YeTrade within
   5 minutes if it ever stops.
7. **Automatic sign-in after reboots:** download Microsoft's **Autologon**
   (https://learn.microsoft.com/sysinternals/downloads/autologon), run it,
   enter your Windows password and click **Enable**. It stores the password
   encrypted. Without this, YeTrade won't start again after a VPS reboot until
   you sign in over Remote Desktop.

**When you leave Remote Desktop, just close the window (Disconnect). Never
choose Sign out:** signing out closes YeTrade and MetaTrader.

## 3. What keeps it running

| Problem | What happens |
|---|---|
| YeTrade closes or crashes | Restarted within 5 minutes (keep-alive task) |
| VPS reboots | Autologon signs in, YeTrade starts at sign-in |
| MetaTrader 5 closes or disconnects | YeTrade reconnects every minute with the saved password |
| Telegram connection drops | Retried every minute; a dead connection is rebuilt within ~2 minutes |
| Channel posts not pushed by Telegram | YeTrade checks every channel every 15 seconds |

Messages you get in Telegram **Saved Messages**:

- 🟢 **YeTrade started** - after every start or restart.
- ✅ / ⚠️ / 🏁 - trade opened, signal not traded (with the reason), trade closed.
- 🔴 **MT5 disconnected** or ⚠️ **AutoTrading is OFF** - when it lasts more than 2 minutes.
- 📊 **Daily summary** at 21:00 VPS time - signals, trades, P/L and why signals were not traded.

If you get none of these for a whole day, including no daily summary,
connect to the VPS and check it.

## 4. One-week demo test

Run on the **demo** account for 7 days without changing settings. Every day,
read the 📊 summary and write down:

- signals executed vs. rejected vs. missed, and the reasons given,
- any posted signal that got **no** report at all (that means a parsing problem),
- P/L, and whether break-even or stops behaved as you expected.

Missed or rejected trades with a reason you don't agree with are things to fix
before going live. Bring the reasons to a Claude Code session.

## 5. Going live with real money (after the week)

Only when the week has been clean:

1. **Start small.** On the Risk page, set **Risk Per Trade** to **0.5%** or
   lower for the first live weeks.
2. Check **Max Daily Loss**, **Max Drawdown** and **Max Open Trades** are
   values you're willing to lose in a bad day or week.
3. Log in to the real account in MetaTrader 5, then in YeTrade
   **Settings → MetaTrader 5** add the real account (Remember password on)
   and **Switch** to it. The dashboard badge shows **REAL**.
4. Leave the demo account saved, so you can switch back to test changes.
5. Watch the first live trades closely. You can stop all trading instantly
   with **Pause Trading** on the dashboard.

Only trade money you can afford to lose. Signals from Telegram channels have
no performance guarantee, and automation copies bad signals as faithfully as
good ones.
