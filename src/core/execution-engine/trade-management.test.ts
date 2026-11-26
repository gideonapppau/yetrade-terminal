import { describe, it, expect } from 'vitest';
import { planStopAdjustment, initialRiskDistance, type StopManagementConfig } from './trade-management';

const BE_ONLY: StopManagementConfig = {
  breakEven: { enabled: true, triggerR: 1 },
  trailing: { enabled: false, triggerR: 1.5, distanceR: 1 },
};

// The BTC buy that was scratched: fill 60797.28, posted stop 59798.60 (~$1,000 = 1R)
const btc = { isBuy: true, entryPrice: 60797.28, currentSl: 59798.6, riskDistance: 1000, point: 0.01 };

describe('planStopAdjustment - break-even in R', () => {
  it('does NOT move the stop after a $1 move on a $1,000-risk BTC trade', () => {
    expect(planStopAdjustment({ ...btc, currentPrice: 60798.28 }, BE_ONLY)).toBeNull();
  });

  it('moves the stop to entry once the trade is 1R in profit', () => {
    expect(planStopAdjustment({ ...btc, currentPrice: 61797.28 }, BE_ONLY)).toBe(60797.28);
  });

  it('works the same way for sells', () => {
    const sell = { isBuy: false, entryPrice: 3568, currentSl: 3578, riskDistance: 10, point: 0.001 };
    expect(planStopAdjustment({ ...sell, currentPrice: 3563 }, BE_ONLY)).toBeNull(); // 0.5R
    expect(planStopAdjustment({ ...sell, currentPrice: 3558 }, BE_ONLY)).toBe(3568); // 1R
  });

  it('never moves a stop that is already at or past entry', () => {
    expect(planStopAdjustment({ ...btc, currentSl: 60797.28, currentPrice: 62000 }, BE_ONLY)).toBeNull();
  });

  it('does nothing when switched off or 1R is unknown', () => {
    const off = { ...BE_ONLY, breakEven: { enabled: false, triggerR: 1 } };
    expect(planStopAdjustment({ ...btc, currentPrice: 62000 }, off)).toBeNull();
    expect(planStopAdjustment({ ...btc, riskDistance: 0, currentPrice: 62000 }, BE_ONLY)).toBeNull();
  });
});

describe('planStopAdjustment - trailing stop in R', () => {
  const TRAIL: StopManagementConfig = {
    breakEven: { enabled: true, triggerR: 1 },
    trailing: { enabled: true, triggerR: 1.5, distanceR: 1 },
  };

  it('trails 1R behind price once 1.5R in profit, and only tightens', () => {
    expect(planStopAdjustment({ ...btc, currentPrice: 62297.28 }, TRAIL)).toBeCloseTo(61297.28, 2);
    expect(planStopAdjustment({ ...btc, currentSl: 61297.28, currentPrice: 62000 }, TRAIL)).toBeNull();
  });

  it('falls back to break-even between 1R and the trailing trigger', () => {
    expect(planStopAdjustment({ ...btc, currentPrice: 61997.28 }, TRAIL)).toBe(60797.28);
  });
});

describe('initialRiskDistance', () => {
  it('uses the posted entry when there is one, else the fill', () => {
    expect(initialRiskDistance({ entry: 60798.6, stopLoss: 59798.6 }, 60797.28)).toBeCloseTo(1000, 6);
    expect(initialRiskDistance({ entry: null, stopLoss: 3578 }, 3565)).toBe(13);
    expect(initialRiskDistance(undefined, 3565)).toBe(0);
  });
});
