import { describe, it, expect } from 'vitest';
import {
  computeDailyLossPercent,
  computeFloatingDrawdownPercent,
  planProvisionalAmendment,
} from './accounting';

const START_OF_DAY = 1000;

const trade = (pnl: number | null, closedAt: number | null = 2000) => ({
  status: pnl == null ? 'OPEN' : pnl >= 0 ? 'CLOSED_WIN' : 'CLOSED_LOSS',
  pnl,
  closedAt,
});

describe('computeDailyLossPercent', () => {
  it('nets winners against losers for the day', () => {
    const trades = [trade(50), trade(-200)];
    // net -150 of a 1000 balance = 15%
    expect(computeDailyLossPercent(trades, START_OF_DAY, 1000)).toBeCloseTo(15);
  });

  it('ignores trades closed before the start of day', () => {
    const trades = [trade(-500, 999), trade(-500, 2000)];
    expect(computeDailyLossPercent(trades, START_OF_DAY, 1000)).toBeCloseTo(50);
  });

  it('ignores open trades (no close time)', () => {
    const trades = [trade(null, null), trade(-300)];
    expect(computeDailyLossPercent(trades, START_OF_DAY, 1000)).toBeCloseTo(30);
  });

  it('treats unknown P&L as zero contribution', () => {
    const trades = [{ status: 'CLOSED_LOSS', pnl: null, closedAt: 2000 }, trade(-100)];
    expect(computeDailyLossPercent(trades, START_OF_DAY, 1000)).toBeCloseTo(10);
  });

  it('clamps profitable days to zero - profits never refund the budget', () => {
    const trades = [trade(250), trade(50)];
    expect(computeDailyLossPercent(trades, START_OF_DAY, 1000)).toBe(0);
  });

  it('returns zero for an unusable balance', () => {
    expect(computeDailyLossPercent([trade(-500)], START_OF_DAY, 0)).toBe(0);
  });
});

describe('computeFloatingDrawdownPercent', () => {
  it('measures equity below balance as a percentage', () => {
    expect(computeFloatingDrawdownPercent(10000, 9500)).toBeCloseTo(5);
  });

  it('returns zero when equity is at or above balance', () => {
    expect(computeFloatingDrawdownPercent(10000, 10000)).toBe(0);
    expect(computeFloatingDrawdownPercent(10000, 10500)).toBe(0);
  });

  it('returns zero for unusable inputs', () => {
    expect(computeFloatingDrawdownPercent(0, 9000)).toBe(0);
    expect(computeFloatingDrawdownPercent(-100, 50)).toBe(0);
    expect(computeFloatingDrawdownPercent(10000, Number.NaN)).toBe(0);
  });
});

describe('planProvisionalAmendment', () => {
  const base = {
    currentTotalVolume: 1,
    provisionalStopDistance: 10,
    newStopDistance: 10,
    allowedRiskAmount: 100,
    riskPerLotPerUnit: 10,
  };

  it('modifies only when the edited stop is tighter or equal', () => {
    expect(planProvisionalAmendment({ ...base, newStopDistance: 8 })).toEqual({ action: 'MODIFY_ONLY' });
    expect(planProvisionalAmendment(base)).toEqual({ action: 'MODIFY_ONLY' });
  });

  it('resizes down when the edited stop is wider, keeping risk constant', () => {
    // Wider stop (20 vs 10) doubles per-lot risk -> half the volume keeps $100 risk
    const plan = planProvisionalAmendment({ ...base, newStopDistance: 20 });
    expect(plan).toEqual({ action: 'RESIZE', scale: 0.5, desiredTotalVolume: 0.5 });
  });

  it('never scales up volume when the stop is wider but volume was oversized', () => {
    const plan = planProvisionalAmendment({ ...base, currentTotalVolume: 0.2, newStopDistance: 20 });
    expect(plan).toEqual({ action: 'RESIZE', scale: 1, desiredTotalVolume: 0.5 });
  });

  it('fails closed on impossible inputs', () => {
    expect(planProvisionalAmendment({ ...base, currentTotalVolume: 0 }).action).toBe('INVALID');
    expect(planProvisionalAmendment({ ...base, newStopDistance: 0 }).action).toBe('INVALID');
    expect(planProvisionalAmendment({ ...base, riskPerLotPerUnit: 0 }).action).toBe('INVALID');
    expect(planProvisionalAmendment({ ...base, allowedRiskAmount: 0 }).action).toBe('INVALID');
  });
});
