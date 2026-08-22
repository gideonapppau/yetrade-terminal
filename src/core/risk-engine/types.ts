export interface RiskConfiguration {
  riskPerTradePercent: number;
  maxDailyLossPercent: number;
  maxDrawdownPercent: number;
  maxOpenTradeGroups: number;
  minRR: number;
  maxOpenRiskPercent: number;
  maxSlippagePoints: number;
  newsFilterEnabled: boolean;
}

export interface AccountState {
  balance: number;
  openGroupsCount: number;
  currentDrawdown: number;
  dailyLoss: number;
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
