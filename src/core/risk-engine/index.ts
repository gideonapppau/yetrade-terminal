import type { AccountState, RiskConfiguration, RiskEvaluationResult, RuleResult } from './types';
import type { ParsedSignal } from '../signal-engine/types';
import { logger } from '../logger';
import {
  MOCK_TICK_VALUE_PER_LOT,
  MIN_POSITION_SIZE_LOTS,
  POSITION_SIZE_DECIMALS,
} from '../constants';

export class RiskEngine {
  
  public evaluate(
    signal: ParsedSignal,
    account: AccountState,
    config: RiskConfiguration,
    tickValuePerLot: number = MOCK_TICK_VALUE_PER_LOT
  ): RiskEvaluationResult {
    
    logger.info({ symbol: signal.symbol }, 'Starting risk evaluation');
    
    const ruleResults: RuleResult[] = [];
    let isApproved = true;

    // 1. Max Open Groups Check
    const groupCheck = account.openGroupsCount < config.maxOpenTradeGroups;
    ruleResults.push({
      ruleName: 'Max Open Trade Groups',
      passed: groupCheck,
      message: groupCheck ? 'Within limits' : `Exceeded max open groups (${config.maxOpenTradeGroups})`
    });
    if (!groupCheck) isApproved = false;

    // 2. Drawdown Check
    const drawdownCheck = account.currentDrawdown < config.maxDrawdownPercent;
    ruleResults.push({
      ruleName: 'Maximum Drawdown',
      passed: drawdownCheck,
      message: drawdownCheck ? 'Within limits' : `Exceeded max drawdown (${config.maxDrawdownPercent}%)`
    });
    if (!drawdownCheck) isApproved = false;

    // 3. Daily Loss Check
    const dailyLossCheck = account.dailyLoss < config.maxDailyLossPercent;
    ruleResults.push({
      ruleName: 'Maximum Daily Loss',
      passed: dailyLossCheck,
      message: dailyLossCheck ? 'Within limits' : `Exceeded daily loss (${config.maxDailyLossPercent}%)`
    });
    if (!dailyLossCheck) isApproved = false;

    // 4. Per-Channel Max Trades Per Day (only enforced when a channel override exists)
    if (account.maxTradesPerDay != null) {
      const executed = account.tradesExecutedToday ?? 0;
      const channelCapCheck = executed < account.maxTradesPerDay;
      ruleResults.push({
        ruleName: 'Channel Max Trades Per Day',
        passed: channelCapCheck,
        message: channelCapCheck
          ? 'Within limits'
          : `Channel reached its daily limit (${executed}/${account.maxTradesPerDay})`
      });
      if (!channelCapCheck) isApproved = false;
    }

    // 5. RR Calculation and Check
    // If we have an entry, calculate precise RR, otherwise use current market price (not available here yet, assume entry is provided for now)
    let calculatedRR: number | null = null;
    if (signal.entry) {
      const riskPips = Math.abs(signal.entry - signal.stopLoss);
      // For RR, we use the furthest TP to calculate maximum potential RR
      const maxTp = signal.takeProfits.reduce((max, tp) => {
        const dist = Math.abs(tp.price - signal.entry!);
        return dist > max ? dist : max;
      }, 0);
      
      calculatedRR = riskPips > 0 ? maxTp / riskPips : 0;
      
      const rrCheck = calculatedRR >= config.minRR;
      ruleResults.push({
        ruleName: 'Minimum RR',
        passed: rrCheck,
        message: rrCheck ? `RR is ${calculatedRR.toFixed(2)}` : `RR ${calculatedRR.toFixed(2)} is below minimum ${config.minRR}`
      });
      if (!rrCheck) isApproved = false;
    } else {
      ruleResults.push({
        ruleName: 'Minimum RR',
        passed: false,
        message: 'Cannot calculate RR without Entry price'
      });
      isApproved = false;
    }

    // 6. Position Sizing
    let riskAmount = 0;
    let positionSize: number | null = null;
    
    if (isApproved && signal.entry) {
      riskAmount = account.balance * (config.riskPerTradePercent / 100);
      // Simple sizing formula: Position Size = Risk Amount / (StopLoss Distance * TickValue)
      // This varies drastically by broker/instrument, using a simplified version for Phase 1
      const stopDistance = Math.abs(signal.entry - signal.stopLoss);
      if (stopDistance > 0) {
        positionSize = riskAmount / (stopDistance * tickValuePerLot);
        const scale = Math.pow(10, POSITION_SIZE_DECIMALS);
        positionSize = Math.max(MIN_POSITION_SIZE_LOTS, Math.round(positionSize * scale) / scale);
      } else {
        isApproved = false;
        ruleResults.push({
          ruleName: 'Position Sizing',
          passed: false,
          message: 'Invalid Stop Loss distance'
        });
      }
    }

    return {
      decision: isApproved ? 'APPROVED' : 'REJECTED',
      riskPercent: config.riskPerTradePercent,
      riskAmount,
      positionSize,
      rr: calculatedRR,
      ruleResults
    };
  }
}
