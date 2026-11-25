// Central location for every tunable value used across the terminal.
// Nothing trading- or connection-related should be hard-coded at call sites.

/** Default HTTP endpoint of the local MetaTrader 5 Python bridge. */
export const MT5_BRIDGE_DEFAULT_URL = 'http://127.0.0.1:8000';

/**
 * Upper bound on any single bridge HTTP call. Generous because order
 * execution waits for fresh ticks and retries filling modes server-side.
 */
export const BRIDGE_REQUEST_TIMEOUT_MS = 30_000;

/**
 * Largest gap between the provider's posted entry and the live price, as a
 * fraction of the stop distance, at which the bridge still executes.
 */
export const MAX_ENTRY_DRIFT_R = 0.5;

/** Maximum number of dialogs fetched when listing the user's Telegram chats. */
export const TELEGRAM_DIALOGS_LIMIT = 200;

/**
 * Connection retry attempts for the Telegram MTProto client. GramJS also uses
 * this for reconnects after a drop - at 1, a single network blip silently
 * kills the listener for the rest of the session.
 */
export const TELEGRAM_CONNECTION_RETRIES = 10;

/**
 * Signals older than this (by Telegram post/edit time) are never executed -
 * protects against stale messages redelivered after a reconnect.
 */
export const DEFAULT_MAX_SIGNAL_AGE_SECONDS = 120;

/** Smallest position size (in lots) any broker adapter may open. */
export const MIN_POSITION_SIZE_LOTS = 0.01;

/** Default sanity ceiling on any single computed position size (lots). */
export const DEFAULT_MAX_POSITION_SIZE_LOTS = 5;

/** Decimal precision used when rounding computed lot sizes. */
export const POSITION_SIZE_DECIMALS = 2;

/** Initial TradingView symbol shown on the charting page. */
export const DEFAULT_CHART_SYMBOL = 'OANDA:XAUUSD';

/**
 * Analytics currently has no R-multiple history per trade, so expectancy and
 * profit factor are approximated assuming these average outcomes.
 */
export const ASSUMED_AVG_WIN_R = 2;
export const ASSUMED_AVG_LOSS_R = 1;

/** SQLite database handle passed to the Tauri SQL plugin. */
export const SQLITE_DB_HANDLE = 'sqlite:trading-terminal.db';

/**
 * Fixed execution assumptions of the deterministic backtester. Both the
 * simulator payload and the Replay page's "Assumptions" panel read from here
 * so they can never drift apart.
 */
export const BACKTEST_ASSUMPTIONS = {
  orderType: 'LIMIT',
  orderTypeLabel: 'Limit Exact',
  slippageLabel: '0',
  spreadLabel: 'Ignored',
  ambiguityPolicy: 'CONSERVATIVE',
  ambiguityLabel: 'Conservative',
} as const;

/** How long an unfilled backtest limit order remains live before expiring. */
export const BACKTEST_MAX_DURATION_DAYS = 14;

/** Risk profiles selectable on the Replay page; multiplier scales each trade's R. */
export const RISK_PROFILES = [
  { id: 'Standard', multiplier: 1, label: 'Standard', description: 'Baseline 1R sizing' },
  { id: 'Aggressive', multiplier: 2, label: 'Aggressive', description: 'Doubled 2R sizing' },
] as const;
