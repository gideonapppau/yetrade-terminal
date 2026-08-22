# Contributing to YetTrade 🚀

First off, thank you for considering contributing to YetTrade! It's people like you that make open-source software such a great community.

## 🗺️ Where to Start

If you're looking for something to work on, the best place to start is the **[`v2_roadmap.md`](./v2_roadmap.md)** file located in the root directory. It contains a detailed list of complex features (like Advanced Trade Management, Backtesting, and Charting) that we pruned from V1 to keep it lightweight, but which are highly desired for V2.

You can also check the GitHub Issues page for bugs or feature requests.

## 🛠️ Development Setup

To get a development environment running:

1. **Prerequisites:**
   - Windows OS (Required for MetaTrader 5)
   - Node.js (v18+)
   - Rust (latest stable)
   - Python 3.10+
   - MetaTrader 5 Desktop Terminal

2. **Clone the repo:**
   ```bash
   git clone https://github.com/yourusername/trading-terminal.git
   cd trading-terminal
   ```

3. **Setup Python Bridge:**
   ```bash
   cd python-bridge
   python -m venv .venv
   .venv\Scripts\activate
   pip install -r requirements.txt
   python main.py
   ```

4. **Run the Tauri Frontend:**
   In a new terminal window:
   ```bash
   npm install
   npm run tauri dev
   ```

## 🔄 Pull Request Process

1. **Fork the repo** and create your branch from `main`.
2. **Make your changes**. Ensure your code is clean, well-commented, and follows the existing architecture.
3. **Test your changes**. Please ensure the Python bridge and the Tauri frontend still communicate properly, and that risk management calculations remain accurate.
4. **Update documentation**. If you're adding a new feature, update the `README.md` or `v2_roadmap.md` accordingly.
5. **Submit a Pull Request**. Provide a clear description of the problem you've solved or the feature you've added.

## 📝 Coding Standards

- **Frontend:** React + TypeScript. Use functional components and hooks. State is managed via Zustand. Tailwind CSS is used for styling.
- **Backend Bridge:** Python (FastAPI). Keep the MetaTrader 5 integration layer clean and asynchronous where possible.
- **General:** Prioritize security and privacy. Remember that this app handles people's live trading accounts. Never expose credentials, and ensure all data remains strictly local in the SQLite database.

## 🐛 Reporting Bugs

If you find a bug, please create an issue detailing:
- The expected behavior
- The actual behavior
- Steps to reproduce
- Any relevant logs (please **sanitize** logs before posting to remove API keys, account numbers, or passwords).

Thanks again for contributing!
