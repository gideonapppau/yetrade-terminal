import { describe, it, expect } from 'vitest';
import { RiskEngine } from './index';
import type { AccountState, RiskConfiguration } from './types';
import type { ParsedSignal } from '../signal-engine/types';

const engine = new RiskEngine();

const config: RiskConfiguration = {
  riskPerTradePercent: 1,
  maxDailyLossPercent: 5,
  maxDrawdownPercent: 10,
  maxOpenTradeGroups: 3,
  minRR: 1.5,
  maxOpenRiskPercent: 4,
  maxSlippagePoints: 20,
  newsFilterEnabled: false,
};

const account: AccountState = {
  balance: 10000,
  equity: 10000,
  openGroupsCount: 0,
  currentDrawdown: 0,
  dailyLoss: 0,
};

const signal: ParsedSignal = {
  symbol: 'EURUSD',
  direction: 'BUY',
  entry: 1.085,
  stopLoss: 1.08,
  takeProfits: [{ price: 1.095 }],
};

// tick value/size such that sizing math is easy to verify
const symbolInfo = { trade_tick_value: 1, trade_tick_size: 0.00001 };

describe('RiskEngine.evaluate - approvals', () => {
  it('approves a healthy signal and sizes the position from broker tick data', () => {
    const result = engine.evaluate(signal, account, config, symbolInfo);

    expect(result.decision).toBe('APPROVED');
    // risk = 1% of 10000 = $100; stop distance = 0.005 = 500 ticks = $500/lot
    expect(result.positionSize).toBeCloseTo(0.2, 6);
    // RR = (1.095-1.085) / (1.085-1.08) = 2.0
    expect(result.rr).toBeCloseTo(2.0, 6);
  });

  it('rejects instead of guessing a size when no broker info is provided', () => {
    const result = engine.evaluate(signal, account, config);

    expect(result.decision).toBe('REJECTED');
    expect(result.positionSize).toBeNull();
    expect(result.ruleResults.find((r) => r.ruleName === 'Position Sizing')?.passed).toBe(false);
  });

  it('sizes from contract size when the broker reports no tick value', () => {
    const result = engine.evaluate(signal, account, config, {
      trade_tick_value: 0,
      trade_tick_size: 0,
      trade_contract_size: 100000,
    });

    expect(result.decision).toBe('APPROVED');
    // $100 risk / (0.005 stop * 100000) = 0.2 lots
    expect(result.positionSize).toBeCloseTo(0.2, 6);
  });

  it('rejects a non-positive risk per trade', () => {
    const result = engine.evaluate(signal, account, { ...config, riskPerTradePercent: 0 }, symbolInfo);

    expect(result.decision).toBe('REJECTED');
    expect(result.ruleResults.find((r) => r.ruleName === 'Risk Configuration')?.passed).toBe(false);
  });

  it('never sizes below the minimum lot size', () => {
    const tinyAccount: AccountState = { ...account, balance: 10 };
    const result = engine.evaluate(signal, tinyAccount, config, symbolInfo);

    expect(result.positionSize).toBeGreaterThan(0);
  });
});

describe('RiskEngine.evaluate - rejections', () => {
  it('rejects when the max open trade groups cap is hit', () => {
    const result = engine.evaluate(
      signal,
      { ...account, openGroupsCount: config.maxOpenTradeGroups },
      config,
      symbolInfo
    );

    expect(result.decision).toBe('REJECTED');
    expect(result.ruleResults.find((r) => r.ruleName === 'Max Open Trade Groups')?.passed).toBe(false);
  });

  it('rejects when committed open risk exceeds the max open risk budget', () => {
    const result = engine.evaluate(
      signal,
      { ...account, openGroupsCount: 2, openRiskPercent: 4 },
      config,
      symbolInfo
    );

    expect(result.decision).toBe('REJECTED');
    expect(result.ruleResults.find((r) => r.ruleName === 'Max Open Risk')?.passed).toBe(false);
  });

  it('rejects when daily loss is over budget', () => {
    const result = engine.evaluate(
      signal,
      { ...account, dailyLoss: config.maxDailyLossPercent + 1 },
      config,
      symbolInfo
    );

    expect(result.decision).toBe('REJECTED');
    expect(result.ruleResults.find((r) => r.ruleName === 'Maximum Daily Loss')?.passed).toBe(false);
  });

  it('rejects when drawdown breaches the ceiling', () => {
    const result = engine.evaluate(
      signal,
      { ...account, currentDrawdown: config.maxDrawdownPercent },
      config,
      symbolInfo
    );

    expect(result.decision).toBe('REJECTED');
  });

  it('rejects when RR is below the configured minimum', () => {
    const weakSignal: ParsedSignal = {
      ...signal,
      takeProfits: [{ price: 1.087 }], // RR = 0.4
    };
    const result = engine.evaluate(weakSignal, account, config, symbolInfo);

    expect(result.decision).toBe('REJECTED');
    expect(result.ruleResults.find((r) => r.ruleName === 'Minimum RR')?.passed).toBe(false);
  });

  it('rejects signals without an entry price because RR cannot be computed', () => {
    const result = engine.evaluate(
      { ...signal, entry: undefined },
      account,
      config,
      symbolInfo
    );

    expect(result.decision).toBe('REJECTED');
    expect(result.ruleResults.find((r) => r.ruleName === 'Minimum RR')?.message).toContain('without Entry');
  });

  it('fails closed on the news filter when enabled without calendar integration', () => {
    const result = engine.evaluate(
      signal,
      account,
      { ...config, newsFilterEnabled: true },
      symbolInfo
    );

    expect(result.decision).toBe('REJECTED');
    expect(result.ruleResults.find((r) => r.ruleName === 'News Filter')?.passed).toBe(false);
  });

  it('enforces per-channel daily trade caps when an override exists', () => {
    const result = engine.evaluate(
      signal,
      { ...account, maxTradesPerDay: 2, tradesExecutedToday: 2 },
      config,
      symbolInfo
    );

    expect(result.decision).toBe('REJECTED');
    expect(result.ruleResults.find((r) => r.ruleName === 'Channel Max Trades Per Day')?.passed).toBe(false);
  });

  it('skips the channel cap rule when no override exists', () => {
    const result = engine.evaluate(signal, account, config, symbolInfo);

    expect(result.ruleResults.find((r) => r.ruleName === 'Channel Max Trades Per Day')).toBeUndefined();
  });

  it('rejects zero stop distance instead of dividing by it', () => {
    const result = engine.evaluate(
      { ...signal, stopLoss: signal.entry! },
      account,
      config,
      symbolInfo
    );

    expect(result.decision).toBe('REJECTED');
    expect(result.positionSize).toBeNull();
  });
});

describe('RiskEngine.evaluate - TP-less signals', () => {
  const noTpSignal: ParsedSignal = { ...signal, takeProfits: [] };

  it('rejects with an explicit reason when trailing stop is disabled', () => {
    const result = engine.evaluate(noTpSignal, account, config, symbolInfo);

    expect(result.decision).toBe('REJECTED');
    expect(result.ruleResults.find((r) => r.ruleName === 'Minimum RR')?.passed).toBe(false);
    expect(result.ruleResults.find((r) => r.ruleName === 'Minimum RR')?.message).toContain(
      'No take-profit targets'
    );
  });

  it('allows TP-less signals when a trailing stop manages the exit', () => {
    const result = engine.evaluate(
      noTpSignal,
      account,
      { ...config, trailingStopManagedTps: true },
      symbolInfo
    );

    expect(result.decision).toBe('APPROVED');
    expect(result.positionSize).not.toBeNull();
  });

  it('still rejects entryless signals even when trailing stop is armed', () => {
    const result = engine.evaluate(
      { ...noTpSignal, entry: undefined },
      account,
      { ...config, trailingStopManagedTps: true },
      symbolInfo
    );

    expect(result.decision).toBe('REJECTED');
  });
});

describe('RiskEngine.evaluate - minimum volume policy', () => {
  // $100 risk / ($500 risk per lot) = 0.2 lots - comfortably above any minimum
  const minVolInfo = { ...symbolInfo, volume_min: 0.01 };

  it('rounds sub-minimum sizes up to the broker minimum by default', () => {
    const tinyAccount: AccountState = { ...account, balance: 10 };
    const result = engine.evaluate(signal, tinyAccount, config, minVolInfo);

    expect(result.decision).toBe('APPROVED');
    expect(result.positionSize).toBe(0.01);
  });

  it('rejects sub-minimum sizes when the strict policy is enabled', () => {
    const tinyAccount: AccountState = { ...account, balance: 10 };
    const result = engine.evaluate(
      signal,
      tinyAccount,
      { ...config, rejectBelowMinVolume: true },
      minVolInfo
    );

    expect(result.decision).toBe('REJECTED');
    expect(result.positionSize).toBeNull();
    expect(result.ruleResults.find((r) => r.ruleName === 'Position Sizing')?.message).toContain(
      'below the broker minimum'
    );
  });

  it('approves sizes above the broker minimum under the strict policy', () => {
    const result = engine.evaluate(
      signal,
      account,
      { ...config, rejectBelowMinVolume: true },
      minVolInfo
    );

    expect(result.decision).toBe('APPROVED');
    expect(result.positionSize).toBeCloseTo(0.2, 6);
  });
});

describe('RiskEngine.evaluate - level sanity and size ceiling', () => {
  it('rejects a BUY whose stop sits above entry', () => {
    const result = engine.evaluate({ ...signal, stopLoss: 1.09 }, account, config, symbolInfo);
    expect(result.decision).toBe('REJECTED');
    expect(result.ruleResults.find((r) => r.ruleName === 'Stop Loss Side')?.passed).toBe(false);
  });

  it('rejects a SELL whose target sits above entry', () => {
    const sell = { ...signal, direction: 'SELL' as const, stopLoss: 1.09, takeProfits: [{ price: 1.095 }] };
    const result = engine.evaluate(sell, account, config, symbolInfo);
    expect(result.decision).toBe('REJECTED');
    expect(result.ruleResults.find((r) => r.ruleName === 'Take Profit Side')?.passed).toBe(false);
  });

  it('rejects sizes above the lot ceiling instead of trading them', () => {
    // 2-point stop -> $100 / (0.00002 / 0.00001 * $1) = 50 lots
    const tight = { ...signal, stopLoss: 1.08498, takeProfits: [{ price: 1.0851 }] };
    const result = engine.evaluate(tight, account, { ...config, maxPositionSizeLots: 5 }, symbolInfo);
    expect(result.decision).toBe('REJECTED');
    expect(result.positionSize).toBeNull();
    expect(result.ruleResults.find((r) => r.ruleName === 'Position Sizing')?.message).toMatch(/ceiling/);
  });
});

describe('RiskEngine.evaluate - projected open risk', () => {
  it('counts the new trade toward the open-risk cap', () => {
    // 3.5% open + 1% new = 4.5% > 4% max
    const result = engine.evaluate(signal, { ...account, openGroupsCount: 1, openRiskPercent: 3.5 }, config, symbolInfo);
    expect(result.ruleResults.find((r) => r.ruleName === 'Max Open Risk')?.passed).toBe(false);
  });

  it('allows a trade that lands exactly on the cap', () => {
    const result = engine.evaluate(signal, { ...account, openGroupsCount: 1, openRiskPercent: 3 }, config, symbolInfo);
    expect(result.ruleResults.find((r) => r.ruleName === 'Max Open Risk')?.passed).toBe(true);
  });
});
