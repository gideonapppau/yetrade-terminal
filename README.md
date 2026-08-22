# YetTrade Terminal: Executive Overview

## Introduction
The YetTrade Terminal is a modern, high-performance desktop application designed to bridge the gap between automated trading signals and live market execution. Built with reliability and speed in mind, it serves as a command center for both algorithmic and manual traders.

This system securely integrates with MetaTrader 5 (MT5) - the industry standard trading platform - and automatically parses trading signals from Telegram. It features a built-in risk management engine that enforces strict trading rules and calculates precise position sizes to protect capital.

## Core Features and Business Value

* **Automated Trade Execution (MT5 Integration)**
  The application establishes a direct, low-latency connection to the broker using a custom Python bridge. This allows the system to read live market data and execute trades instantaneously without manual intervention.

* **Real-time Signal Parsing**
  A built-in engine actively monitors designated Telegram channels. It extracts structured trade data (such as entry prices, stop losses, and take profits) from incoming messages and queues them for execution, eliminating the delay and human error associated with manual data entry.

* **Advanced Risk Management**
  Capital preservation is strictly enforced through a comprehensive Risk Engine. Before any trade is executed, the system calculates the exact position size based on the specific asset's contract specifications and the user's predefined risk tolerance.

* **Live Analytics and Dashboard**
  The user interface provides a real-time overview of active positions, historical performance, and overall account equity. It utilizes professional charting tools to track market movements and analyze trading history.

* **Secure Local Storage**
  All trading history, configuration settings, and signal data are stored securely on the user's local machine using an embedded database. This ensures privacy and fast data retrieval without relying on external cloud storage.

## Technical Architecture (Simplified)

To ensure maximum performance and security, the application is constructed using a multi-tiered architecture:

* **Presentation Layer (React & TypeScript):** The visual interface that the user interacts with. It is built to be highly responsive and fluid.
* **Application Framework (Tauri):** The core desktop shell. It provides a secure environment for the interface to run while consuming significantly less system memory compared to traditional desktop frameworks.
* **Execution Layer (Python):** A specialized background process that communicates directly with the MetaTrader 5 terminal, handling the complex financial routing required for trade execution.
* **Local Database (SQLite):** A lightweight, self-contained database system that securely logs all activity directly on the computer's hard drive.
* **State Management (Zustand):** The internal memory system that keeps the user interface perfectly synchronized with live market data and active trades.

## System Requirements

* **Operating System:** Windows (Required for MetaTrader 5 compatibility)
* **Trading Platform:** MetaTrader 5 Terminal installed and running
* **Background Dependencies:** Python 3.10 or higher
* **Application Dependencies:** Node.js (v18+) and Rust (for building the application from source)

## Deployment Instructions

1. **Install Dependencies:** Download the required software libraries for the interface.
2. **Initialize the Execution Layer:** Start the Python bridge to establish the connection to the MT5 platform.
3. **Launch the Terminal:** Start the desktop application to access the dashboard and configure trading parameters.

## License
MIT
