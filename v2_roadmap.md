# YetTrade V2 Roadmap

This document outlines the advanced features that were scoped out of the V1 MVP to keep the core execution engine (Telegram -> MT5) lean, reliable, and bug-free.

When development for V2 begins, this roadmap serves as the blueprint for reintroducing these capabilities.

## 1. Advanced Trade Execution & Management
In V1, the Python bridge fires a "fire-and-forget" order to MT5 with Entry, SL, and a single TP. MT5 natively handles the closing of these orders.

For V2, the execution engine should implement continuous position tracking via the MT5 bridge to support:

- **Twin Trading (Position Splitting):** Automatically splitting a single Telegram signal with multiple Take Profits (TP1, TP2, TP3) into distinct MT5 positions, dividing the total risk equally.
- **Auto Break-Even:** A continuous background loop that monitors open trades. When price reaches a certain threshold (e.g., hits TP1 or moves 20 pips in profit), the system automatically modifies the Stop Loss of the remaining positions to the original Entry Price.
- **Trailing Stops:** Dynamically trailing the stop loss behind the current market price by X pips to lock in profits, rather than relying on fixed Take Profits.

**Implementation Note:** This requires the Python bridge to maintain an active state map of open tickets, polling `mt5.positions_get()` continuously, and exposing a WebSocket or long-polling endpoint to the React frontend for real-time state synchronization.

## 2. Historical Simulation & Backtesting
A massive value-add for V2 is the ability to run backtests on the historical signals stored in the local SQLite database.

- **Deterministic Replay:** Simulating the historical execution of past signals based on past market data (or using fixed assumptions).
- **Performance Metrics:** Calculating Expected Value (Expectancy), Profit Factor (Gross Profit / Gross Loss), Win Rate, and Total Realized R-Multiples.
- **Equity Curve:** Plotting the simulated account growth and Maximum Drawdown over time.

**Implementation Note:** The `backtester.ts` logic needs to be completely decoupled from the live trading engine to prevent database locks or memory leaks.

## 3. Deep Analytics Dashboard
V1 relies on MT5's native account history for performance tracking. V2 should bring this data into the terminal.

- **R-Distribution:** A visual graph showing the frequency of different R-multiple outcomes (e.g., how many trades hit +2R vs -1R).
- **Channel Performance Scoring:** Ranking Telegram channels based on their historic profitability, Expectancy, and signal volume.

## 4. Built-in Charting
Instead of requiring users to switch to TradingView or MT5 for manual analysis, V2 can integrate real-time charts directly into the terminal workspace.

**Implementation Note:** Use `react-ts-tradingview-widgets` to embed the Advanced Real-Time Chart widget, allowing users to draw support/resistance lines on the same screen where signals arrive.

## 5. Command Palette (Power User UX)
A global `Ctrl+K` quick-search menu allowing power users to quickly jump between active trades, configuration tabs, and specific channels without using the mouse.
