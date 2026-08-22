# YetTrade: Automated Trading Terminal

**YetTrade** is a powerful, open-source automated trading solution designed to bridge the gap between market signals and execution. It seamlessly connects Telegram signal channels directly to your MetaTrader 5 (MT5) broker account, ensuring you never miss a trading opportunity while maintaining complete control over your risk and strategy.

## Why YetTrade? (For Managers & Traders)

In the fast-paced world of trading, speed and reliability are everything. YetTrade automates the manual process of reading a signal from Telegram and typing it into a trading platform. 

*   **Lightning Fast Execution:** By removing human delay, trades are entered the second a signal is broadcast.
*   **Total Data Privacy:** There are no third-party cloud servers. Your account credentials, trading history, and API keys stay exclusively on your local computer.
*   **Automated Risk Management:** Set your comfort level once (e.g., risk 1% of total capital per trade), and the system automatically calculates the exact position size for every trade.
*   **Custom Control:** Fine-tune risk settings on a per-channel basis. Some signal providers are riskier than others; YetTrade lets you adjust accordingly.

## How It Works (The Architecture)

YetTrade is built on modern, secure technologies, split into three synchronized parts:

1.  **The Command Center (Frontend Desktop App):** Built with React and Tauri (Rust), this is the beautiful desktop interface where you manage settings, view active trades, and monitor performance. It's incredibly fast and uses minimal system resources.
2.  **The Secure Vault (Local Database):** Powered by SQLite, this locally stores your configuration and trade logs. Nothing is sent to the cloud, ensuring maximum security and compliance.
3.  **The Execution Engine (Python Bridge):** A dedicated background service that acts as a secure translator between the Command Center and your MetaTrader 5 terminal, instantly executing the parsed trades.

---

## Technical Setup (For Engineers)

### Prerequisites

Since YetTrade communicates directly with MetaTrader 5, it must be run on a **Windows** operating system.

Please ensure the following are installed:
1.  [Node.js](https://nodejs.org/en/) (v18 or higher)
2.  [Rust](https://rustup.rs/) (latest stable release)
3.  [Python](https://www.python.org/downloads/) (3.10 or higher)
4.  **MetaTrader 5 Desktop Terminal** (installed and currently running)

### Step 1: Initialize the Execution Engine (Python Bridge)

The Python Bridge is the critical link to MT5. Open your terminal and run:

```bash
cd python-bridge
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
python main.py
```
*(The engine will start running locally at `http://127.0.0.1:8000`)*

### Step 2: Launch the Command Center (Desktop App)

Open a new, separate terminal window at the root of the project:

```bash
# Install the required interface dependencies
npm install

# Build and start the desktop application
npm run tauri dev
```

### Step 3: Configure and Connect

Once the application window appears:
1.  Navigate to **Settings > Telegram Connection** and authenticate using your `api_id` and `api_hash` (obtainable from my.telegram.org).
2.  Navigate to **Settings > MetaTrader 5** and securely input your broker login credentials.
3.  Select the specific Telegram channels you wish the terminal to monitor for trade signals.

---

## Future Roadmap (V2)

We are actively building the foundation for advanced trade management, including:
*   **Twin Trading:** Splitting positions to secure partial profits.
*   **Trailing Stops:** Automatically locking in gains as the market moves favorably.
*   **Historical Replays:** Backtesting signal providers against historical data to verify profitability before risking real capital.

## Contributing

We welcome contributions from developers and traders alike! If you're interested in helping us build the future of automated retail trading, check out the `v2_roadmap.md` file in the repository root.

## License

This project is open-source and licensed under the MIT License.
