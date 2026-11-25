import { describe, it, expect } from 'vitest';
import { decideClosure, CLOSE_CONFIRM_MISSES } from './reconcile';
import type { PositionDeal } from './types';

const inDeal: PositionDeal = { ticket: 1, entry: 'IN', profit: 0, commission: -1 };
const outDeal: PositionDeal = { ticket: 2, entry: 'OUT', profit: 50, commission: -1, swap: -0.5 };

describe('decideClosure', () => {
  it('closes with realized P&L when the history has an exit deal', () => {
    expect(decideClosure([inDeal, outDeal], 1, 10)).toEqual({ action: 'CLOSE', pnl: 47.5 });
  });

  it('waits while the history shows only the entry deal', () => {
    expect(decideClosure([inDeal], CLOSE_CONFIRM_MISSES + 5, 10)).toEqual({ action: 'WAIT' });
  });

  it('waits on a single miss when no history is available', () => {
    expect(decideClosure(null, 1, 10)).toEqual({ action: 'WAIT' });
    expect(decideClosure([], 1, 10)).toEqual({ action: 'WAIT' });
  });

  it('presumes closed after repeated misses without history', () => {
    expect(decideClosure(null, CLOSE_CONFIRM_MISSES, 12.5)).toEqual({ action: 'CLOSE', pnl: 12.5 });
    expect(decideClosure([], CLOSE_CONFIRM_MISSES, undefined)).toEqual({ action: 'CLOSE', pnl: null });
  });
});
