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

  it('falls back to the mock tick value when no broker info is provided', () => {
    const result = engine.evaluate(signal, account, config);

    expect(result.decision).toBe('APPROVED');
    expect(result.positionSize).not.toBeNull();
    expect(result.positionSize).toBeGreaterThan(0);
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
