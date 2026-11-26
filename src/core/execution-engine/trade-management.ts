/**
 * Break-even and trailing-stop rules, measured in R: multiples of the
 * trade's own initial stop distance.
 *
 * They used to be fixed pip counts applied to every symbol, which made
 * "100 pips" mean $1.00 on BTC and gold. A BTC buy with a $1,000 stop was
 * moved to break-even after a $1 rise and scratched seconds later. Measuring
 * in R behaves the same on every instrument.
 */
export interface StopManagementConfig {
  breakEven: { enabled: boolean; triggerR: number };
  trailing: { enabled: boolean; triggerR: number; distanceR: number };
}

export interface ManagedPosition {
  isBuy: boolean;
  entryPrice: number;
  currentPrice: number;
  /** Broker stop now in place; 0 when none. */
  currentSl: number;
  /** Price distance between entry and the original stop (1R). */
  riskDistance: number;
  /** Instrument point size, the smallest meaningful price step. */
  point: number;
}

/**
 * The stop the position should move to, or null to leave it alone. Stops
 * only ever move in the trade's favour.
 */
export function planStopAdjustment(pos: ManagedPosition, cfg: StopManagementConfig): number | null {
  const { isBuy, entryPrice, currentPrice, currentSl, riskDistance, point } = pos;
  if (!(riskDistance > 0) || !(point > 0) || !(entryPrice > 0) || !(currentPrice > 0)) return null;

  const profit = isBuy ? currentPrice - entryPrice : entryPrice - currentPrice;
  const profitR = profit / riskDistance;
  const improves = (candidate: number) =>
    isBuy ? candidate > currentSl + point : currentSl === 0 || candidate < currentSl - point;

  let target: number | null = null;

  if (cfg.trailing.enabled && cfg.trailing.triggerR > 0 && cfg.trailing.distanceR > 0 && profitR >= cfg.trailing.triggerR) {
    const trail = cfg.trailing.distanceR * riskDistance;
    const candidate = isBuy ? currentPrice - trail : currentPrice + trail;
    if (improves(candidate)) target = candidate;
  }

  if (target === null && cfg.breakEven.enabled && cfg.breakEven.triggerR > 0 && profitR >= cfg.breakEven.triggerR) {
    if (improves(entryPrice)) target = entryPrice;
  }

  return target;
}

/** 1R for a trade: posted entry (or fill) to the signal's stop loss. */
export function initialRiskDistance(
  signal: { entry: number | null; stopLoss: number | null } | undefined,
  fillPrice: number | null
): number {
  if (!signal || signal.stopLoss == null) return 0;
  const reference = signal.entry ?? fillPrice;
  return reference != null ? Math.abs(reference - signal.stopLoss) : 0;
}
