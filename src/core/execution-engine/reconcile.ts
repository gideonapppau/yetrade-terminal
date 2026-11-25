import type { PositionDeal } from './types';

/**
 * Consecutive successful position polls a ticket must be missing from before
 * it is presumed closed when the broker offers no deal history for it.
 */
export const CLOSE_CONFIRM_MISSES = 3;

export type ClosureDecision =
  | { action: 'CLOSE'; pnl: number | null }
  | { action: 'WAIT' };

/**
 * Decides whether a DB trade whose ticket vanished from the broker's open
 * positions really closed. A single missing poll proves nothing (bridge
 * hiccup, partial response), so:
 *  - an exit deal in the history confirms the close, with realized P&L,
 *  - an entry deal without an exit means the position still exists -> wait,
 *  - no history at all -> presume closed only after repeated misses.
 */
export function decideClosure(
  deals: PositionDeal[] | null,
  consecutiveMisses: number,
  lastKnownProfit: number | undefined
): ClosureDecision {
  if (deals && deals.some((d) => d.entry === 'OUT' || d.entry === 'INOUT')) {
    const pnl = deals.reduce(
      (sum, d) => sum + (d.profit ?? 0) + (d.commission ?? 0) + (d.swap ?? 0),
      0
    );
    return { action: 'CLOSE', pnl };
  }

  if (deals && deals.length > 0) return { action: 'WAIT' };

  if (consecutiveMisses >= CLOSE_CONFIRM_MISSES) {
    return { action: 'CLOSE', pnl: typeof lastKnownProfit === 'number' ? lastKnownProfit : null };
  }
  return { action: 'WAIT' };
}
