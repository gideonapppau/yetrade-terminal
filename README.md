# YetTrade 🚀

YetTrade is a lightweight, open-source automated trading terminal that bridges Telegram and MetaTrader 5 (MT5). It reads trading signals from specific Telegram channels in real-time, parses them into actionable trade parameters, applies customizable risk management, and executes them instantly on your MT5 broker account.

Built with **Tauri (Rust)** for a blazing fast desktop UI, **React + TypeScript** for the frontend, and a **Python Bridge** utilizing the official `MetaTrader5` library.

## ✨ Features

- **Live Signal Execution:** Instantly parse and execute incoming signals from selected Telegram channels.
- **Custom Risk Engine:** Automatically calculate optimal lot sizes based on a fixed risk percentage (e.g., Risk 1% of account balance per trade).
- **Channel Overrides:** Define custom risk parameters and daily limits on a per-channel basis.
- **Offline-First Storage:** All trade histories, configuration settings, and signal logs are stored entirely locally on an SQLite database.
- **V2 Ready:** Built on a robust foundation designed to support Advanced Trade Management (Trailing stops, Twin Trading) and Historical Replays in future updates.

## 🏗️ Architecture

YetTrade is split into three main components:
1. **The Desktop Frontend (Tauri + React):** Handles Telegram MTProto authentication, signal listening, parsing, and UI rendering.
2. **The Local Database (SQLite):** Maintains state across restarts, securely storing trade logs and configuration.
3. **The Python Bridge (FastAPI/MT5):** A local HTTP server that acts as a secure intermediary between the frontend and the MetaTrader 5 terminal process on your Windows machine.

## 🚀 Getting Started

### Prerequisites

Since this is a desktop application interacting directly with MetaTrader 5, it must be run on a **Windows** environment (MT5 restriction).

1. [Node.js](https://nodejs.org/en/) (v18+)
2. [Rust](https://rustup.rs/) (latest stable)
3. [Python](https://www.python.org/downloads/) (3.10+)
4. MetaTrader 5 Desktop Terminal installed and running.

### 1. Setup the Python Bridge

The Python bridge is required to execute trades via the MT5 terminal.

```bash
cd python-bridge
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
python main.py
```
*(The bridge will run on `http://127.0.0.1:8000`)*

### 2. Run the Tauri Desktop App

Open a new terminal window at the root of the project:

```bash
# Install dependencies
npm install

# Start the desktop application
npm run tauri dev
```

### 3. Connect the Dots

When the application launches:
1. Go to **Settings > Telegram Connection** and log in using your `api_id` and `api_hash` (obtainable from my.telegram.org).
2. Go to **Settings > MetaTrader 5** and configure your broker login details.
3. Select which Telegram channels you want the bot to actively monitor.

---

## 🔒 Security & Privacy

YetTrade is built with privacy at its core. 
- **No Cloud Servers:** There is no centralized backend. Your MT5 credentials, Telegram API keys, and trade history never leave your machine.
- **Local SQLite:** Everything is stored locally in the `trading-terminal.db`.
- **Open Source:** Verify the code yourself.

## 🤝 Contributing

Contributions are welcome! If you're looking to help, check out the `v2_roadmap.md` file in the repository root for a list of planned features like Twin Trading, Trailing Stops, and Backtesting engines.

## 📝 License

This project is licensed under the MIT License.
