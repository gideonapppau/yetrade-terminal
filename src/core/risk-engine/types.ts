export interface RiskConfiguration {
  riskPerTradePercent: number;
  maxDailyLossPercent: number;
  maxDrawdownPercent: number;
  maxOpenTradeGroups: number;
  minRR: number;
  maxOpenRiskPercent: number;
  maxSlippagePoints: number;
  newsFilterEnabled: boolean;
  /**
   * Signals without take-profit targets are allowed when a trailing stop
   * manages the exit; otherwise they are rejected (RR is uncomputable).
   * Optional so persisted configs predating this flag stay valid.
   */
  trailingStopManagedTps?: boolean;
  /**
   * Reject trades whose computed lot size falls below the broker minimum.
   * When false (legacy behavior) the size is rounded up to the minimum,
   * which risks more than the configured percentage on small accounts.
   */
  rejectBelowMinVolume?: boolean;
}

export interface AccountState {
  balance: number;
  /** Live account equity; used for floating-drawdown checks when available. */
  equity?: number;
  freeMargin?: number;
  openGroupsCount: number;
  /** Floating drawdown as a percentage of balance (0 = none). */
  currentDrawdown: number;
  dailyLoss: number;
  /** Sum of risk still committed by open positions, as % of balance. */
  openRiskPercent?: number;
  maxTradesPerDay?: number | null;
  tradesExecutedToday?: number;
}

export interface RuleResult {
  ruleName: string;
  passed: boolean;
  message: string;
}

export interface RiskEvaluationResult {
  decision: 'APPROVED' | 'REJECTED';
  riskPercent: number;
  riskAmount: number;
  positionSize: number | null;
  rr: number | null;
  ruleResults: RuleResult[];
}
