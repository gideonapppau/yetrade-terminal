// Central location for every tunable value used across the terminal.
// Nothing trading- or connection-related should be hard-coded at call sites.

/** Default HTTP endpoint of the local MetaTrader 5 Python bridge. */
export const MT5_BRIDGE_DEFAULT_URL = 'http://127.0.0.1:8000';

/** Maximum number of dialogs fetched when listing the user's Telegram chats. */
export const TELEGRAM_DIALOGS_LIMIT = 200;

/** Connection retry attempts for the Telegram MTProto client. */
export const TELEGRAM_CONNECTION_RETRIES = 1;

/** Smallest position size (in lots) any broker adapter may open. */
export const MIN_POSITION_SIZE_LOTS = 0.01;

/** Decimal precision used when rounding computed lot sizes. */
export const POSITION_SIZE_DECIMALS = 2;

/**
 * Placeholder per-lot tick value used by the risk engine's sizing formula
 * until real instrument metadata is supplied by the broker bridge.
 */
export const MOCK_TICK_VALUE_PER_LOT = 10;

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
