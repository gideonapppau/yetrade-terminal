/**
 * Pure risk-accounting math shared by the Telegram service and tests.
 * No I/O, no stores - everything is derived from the inputs.
 */

export interface ClosedTradeLike {
  status: string;
  pnl: number | null;
  closedAt: number | null;
}

/**
 * Daily loss budget consumption as % of balance, from the NET realized P&L
 * of trades closed today (winners offset losers). Negative results (net
 * profit days) clamp to zero - profits never "refund" the loss budget of a
 * previous breach.
 */
export function computeDailyLossPercent(
  closedTrades: ClosedTradeLike[],
  startOfDayMs: number,
  balance: number
): number {
  if (!(balance > 0)) return 0;
  const realizedNetToday = closedTrades.reduce((sum, t) => {
    if (t.closedAt == null || t.closedAt < startOfDayMs) return sum;
    return sum + (t.pnl ?? 0);
  }, 0);
  return Math.max(0, -realizedNetToday / balance) * 100;
}

/**
 * Floating drawdown as % of balance when live equity sits below balance.
 * Returns 0 when equity is at or above balance (or inputs are unusable).
 */
export function computeFloatingDrawdownPercent(
  balance: number,
  equity: number
): number {
  if (!(balance > 0) || !Number.isFinite(equity)) return 0;
  return Math.max(0, (balance - equity) / balance) * 100;
}

export interface AmendPlanInput {
  /** Total volume currently open across all legs of the provisional trade. */
  currentTotalVolume: number;
  /** |fill - provisional SL| in price units. */
  provisionalStopDistance: number;
  /** |fill - provider SL| in price units (from the edited message). */
  newStopDistance: number;
  /** Money the user allows this trade group to risk. */
  allowedRiskAmount: number;
  /** Money one lot loses when price moves one unit against it. */
  riskPerLotPerUnit: number;
}

export type AmendPlan =
  | { action: 'MODIFY_ONLY' }
  | { action: 'RESIZE'; scale: number; desiredTotalVolume: number }
  | { action: 'INVALID'; reason: string };

/**
 * Decides how to apply a provider's real stop to an already-open
 * provisional trade without breaking the risk budget.
 *
 * - Tighter stop -> risk only shrinks: keep volume, just move levels.
 * - Wider stop  -> shrink volume so distance x volume keeps risking exactly
 *   the allowed amount.
 * - Impossible inputs (zero distances/volumes) fail closed.
 */
export function planProvisionalAmendment(input: AmendPlanInput): AmendPlan {
  const {
    currentTotalVolume,
    provisionalStopDistance,
    newStopDistance,
    allowedRiskAmount,
    riskPerLotPerUnit,
  } = input;

  if (!(currentTotalVolume > 0)) return { action: 'INVALID', reason: 'No open volume to amend' };
  if (!(provisionalStopDistance > 0)) return { action: 'INVALID', reason: 'Invalid provisional stop distance' };
  if (!(newStopDistance > 0)) return { action: 'INVALID', reason: 'Edited stop has no usable distance' };
  if (!(riskPerLotPerUnit > 0)) return { action: 'INVALID', reason: 'Unknown instrument risk per lot' };
  if (!(allowedRiskAmount > 0)) return { action: 'INVALID', reason: 'No risk budget available' };

  // Provider stop at or inside our provisional stop: risk can only decrease.
  if (newStopDistance <= provisionalStopDistance) {
    return { action: 'MODIFY_ONLY' };
  }

  const desiredTotalVolume = allowedRiskAmount / (newStopDistance * riskPerLotPerUnit);
  if (!Number.isFinite(desiredTotalVolume) || desiredTotalVolume <= 0) {
    return { action: 'INVALID', reason: 'Could not compute a safe resized volume' };
  }

  const scale = Math.min(1, desiredTotalVolume / currentTotalVolume);
  return { action: 'RESIZE', scale, desiredTotalVolume };
}
