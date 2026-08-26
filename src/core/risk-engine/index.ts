import type { AccountState, RiskConfiguration, RiskEvaluationResult, RuleResult } from './types';
import type { ParsedSignal } from '../signal-engine/types';
import { logger } from '../logger';
import {
  MIN_POSITION_SIZE_LOTS,
  POSITION_SIZE_DECIMALS,
  MOCK_TICK_VALUE_PER_LOT,
} from '../constants';

export class RiskEngine {
  
  public evaluate(
    signal: ParsedSignal,
    account: AccountState,
    config: RiskConfiguration,
    symbolInfo?: {
      trade_tick_value: number;
      trade_tick_size: number;
      trade_contract_size?: number;
      volume_min?: number;
      volume_step?: number;
    }
  ): RiskEvaluationResult {
    
    logger.info({ symbol: signal.symbol }, 'Starting risk evaluation');
    
    const ruleResults: RuleResult[] = [];
    let isApproved = true;

    // 0. News filter (fail-closed): there is no economic-calendar integration
    // yet, so an enabled news filter blocks trading instead of pretending to
    // know the calendar.
    if (config.newsFilterEnabled) {
      ruleResults.push({
        ruleName: 'News Filter',
        passed: false,
        message: 'News filter is enabled but no economic calendar is connected'
      });
      isApproved = false;
    }

    // 1. Max Open Groups Check
    const groupCheck = account.openGroupsCount < config.maxOpenTradeGroups;
    ruleResults.push({
      ruleName: 'Max Open Trade Groups',
      passed: groupCheck,
      message: groupCheck ? 'Within limits' : `Exceeded max open groups (${config.maxOpenTradeGroups})`
    });
    if (!groupCheck) isApproved = false;

    // 1b. Max open risk (approximated: each open group commits riskPerTradePercent)
    const openRisk = account.openRiskPercent ?? account.openGroupsCount * config.riskPerTradePercent;
    const openRiskCheck = openRisk < config.maxOpenRiskPercent;
    ruleResults.push({
      ruleName: 'Max Open Risk',
      passed: openRiskCheck,
      message: openRiskCheck
        ? 'Within limits'
        : `Open risk ${openRisk.toFixed(1)}% would exceed max ${config.maxOpenRiskPercent}%`
    });
    if (!openRiskCheck) isApproved = false;

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
    let calculatedRR: number | null = null;
    if (!signal.entry) {
      ruleResults.push({
        ruleName: 'Minimum RR',
        passed: false,
        message: 'Cannot calculate RR without Entry price'
      });
      isApproved = false;
    } else if (signal.takeProfits.length === 0) {
      // TP-less signals have no computable RR. They are only tradeable when a
      // trailing stop manages the exit; otherwise reject with an explicit
      // reason instead of a misleading "RR 0.00".
      if (config.trailingStopManagedTps) {
        ruleResults.push({
          ruleName: 'Minimum RR',
          passed: true,
          message: 'No take-profit targets - exit managed by trailing stop'
        });
      } else {
        ruleResults.push({
          ruleName: 'Minimum RR',
          passed: false,
          message: 'No take-profit targets and trailing stop is disabled'
        });
        isApproved = false;
      }
    } else {
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
        const volMin = symbolInfo?.volume_min && symbolInfo.volume_min > 0
          ? symbolInfo.volume_min
          : MIN_POSITION_SIZE_LOTS;
        
        if (symbolInfo && symbolInfo.trade_tick_size > 0 && symbolInfo.trade_tick_value > 0) {
          const ticksAtRisk = stopDistance / symbolInfo.trade_tick_size;
          const monetaryRiskPerLot = ticksAtRisk * symbolInfo.trade_tick_value;
          positionSize = riskAmount / monetaryRiskPerLot;
        } else if (symbolInfo && symbolInfo.trade_contract_size && symbolInfo.trade_contract_size > 0) {
          // Fallback for crypto brokers where trade_tick_value is 0
          // Risk = Price Distance * Contract Size * Lot Size
          const monetaryRiskPerLot = stopDistance * symbolInfo.trade_contract_size!;
          positionSize = riskAmount / monetaryRiskPerLot;
        } else {
          // Fallback if symbol info is completely missing (e.g. testing)
          positionSize = riskAmount / (stopDistance * MOCK_TICK_VALUE_PER_LOT);
        }
        
        const scale = Math.pow(10, POSITION_SIZE_DECIMALS);
        positionSize = Math.round(positionSize * scale) / scale;

        if (positionSize < volMin) {
          if (config.rejectBelowMinVolume) {
            // Strict policy: never exceed the configured risk percentage.
            ruleResults.push({
              ruleName: 'Position Sizing',
              passed: false,
              message: `Computed size ${positionSize.toFixed(2)} lots is below the broker minimum of ${volMin} lots`
            });
            positionSize = null;
            isApproved = false;
          } else {
            // Legacy policy: round up to the broker minimum (risks more than
            // configured on small accounts) so tiny accounts can still trade.
            logger.warn(
              { computed: positionSize, volMin },
              'Computed size below broker minimum - rounding up to the minimum lot size'
            );
            positionSize = volMin;
          }
        }
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
