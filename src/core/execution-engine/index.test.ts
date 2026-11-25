import { describe, it, expect, beforeEach } from 'vitest';
import { ExecutionEngine } from './index';
import type { ExecutionPersistence } from './index';
import type { BrokerAdapter, ExecutionRequest, ExecutionResult, SymbolInfo } from './types';
import { useSettingsStore, DEFAULT_SETTINGS } from '../../store/settings';

class MockAdapter implements BrokerAdapter {
  name = 'Mock Broker';
  calls: ExecutionRequest[] = [];
  /** Outcomes consumed in order; the last one repeats. */
  outcomes: Array<{ success: boolean; message?: string }> = [];
  private symbolInfo: SymbolInfo | null;

  constructor(
    symbolInfo: SymbolInfo | null = null,
    outcomes: Array<{ success: boolean; message?: string }> = [{ success: true }]
  ) {
    this.symbolInfo = symbolInfo;
    this.outcomes = outcomes;
  }

  async isConnected() {
    return true;
  }

  async loginBroker() {
    return { success: true, message: '' };
  }

  async getAccountInfo() {
    return { balance: 0, equity: 0, currency: 'USD' };
  }

  async getSymbolInfo(): Promise<SymbolInfo | null> {
    return this.symbolInfo;
  }

  async executeTrade(request: ExecutionRequest): Promise<ExecutionResult> {
    this.calls.push(request);
    const outcome = this.outcomes[Math.min(this.calls.length - 1, this.outcomes.length - 1)];
    if (!outcome.success) {
      return { success: false, message: outcome.message ?? 'rejected', executedAt: new Date() };
    }
    return { success: true, tradeId: `t-${this.calls.length}`, executedAt: new Date() };
  }
}

class FakeStore implements ExecutionPersistence {
  insertedTrades: Array<{ id: string; volume: number; signalId: string }> = [];
  statuses = new Map<string, string>();

  async insertTrade(trade: { id: string; signalId: string; volume: number }) {
    this.insertedTrades.push(trade);
  }

  async markSignalStatus(signalId: string, status: string) {
    this.statuses.set(signalId, status);
  }
}

const signal = {
  symbol: 'EURUSD',
  direction: 'BUY' as const,
  entry: 1.085,
  stopLoss: 1.08,
  takeProfits: [{ price: 1.09 }, { price: 1.095 }, { price: 1.10 }],
};

const request = (positionSize: number): ExecutionRequest => ({
  signalId: 'sig-1',
  signal,
  positionSize,
});

/** Default broker metadata: 0.01 min / step lots (typical FX). */
const FX_INFO: SymbolInfo = { trade_tick_value: 1, trade_tick_size: 0.00001, volume_min: 0.01, volume_step: 0.01 };

function configureExecution(twinTradingEnabled: boolean, maxTpsToSplit = '2') {
  useSettingsStore.setState({
    ...DEFAULT_SETTINGS,
    executionSettings: { ...DEFAULT_SETTINGS.executionSettings, twinTradingEnabled, maxTpsToSplit },
  });
}

beforeEach(() => {
  useSettingsStore.setState({ ...DEFAULT_SETTINGS });
});

describe('ExecutionEngine.split planning', () => {
  it('places a single TP1 order when twin trading is disabled', async () => {
    configureExecution(false);
    const adapter = new MockAdapter(FX_INFO);
    const store = new FakeStore();
    const engine = new ExecutionEngine(adapter, store);

    const ok = await engine.executeApprovedSignal(request(0.2));

    expect(ok).toBe(true);
    expect(adapter.calls).toHaveLength(1);
    expect(adapter.calls[0].positionSize).toBe(0.2);
    expect(adapter.calls[0].signal.takeProfits.map((tp) => tp.price)).toEqual([1.09]);
    // First leg carries splitIndex 0 for broker-side idempotency
    expect(adapter.calls[0].splitIndex).toBe(0);
    expect(store.statuses.get('sig-1')).toBe('EXECUTED');
    expect(store.insertedTrades).toHaveLength(1);
  });

  it('splits across the first N take-profits when twin trading is enabled', async () => {
    configureExecution(true, '2');
    const adapter = new MockAdapter(FX_INFO);
    const store = new FakeStore();
    const engine = new ExecutionEngine(adapter, store);

    await engine.executeApprovedSignal(request(0.2));

    expect(adapter.calls).toHaveLength(2);
    expect(adapter.calls.map((c) => c.positionSize)).toEqual([0.1, 0.1]);
    expect(adapter.calls.map((c) => c.signal.takeProfits[0]?.price)).toEqual([1.09, 1.095]);
    expect(adapter.calls.map((c) => c.splitIndex)).toEqual([0, 1]);
    // The third TP is never used
    expect(store.insertedTrades.map((t) => t.id)).toEqual(['t-1', 't-2']);
  });

  it('floors sizes to the broker volume step and honors 0.001 precision', async () => {
    configureExecution(false);
    const microInfo: SymbolInfo = { ...FX_INFO, volume_min: 0.001, volume_step: 0.001 };
    const adapter = new MockAdapter(microInfo);
    const store = new FakeStore();
    const engine = new ExecutionEngine(adapter, store);

    await engine.executeApprovedSignal(request(0.1234));

    expect(adapter.calls[0].positionSize).toBe(0.123);
    expect(store.statuses.get('sig-1')).toBe('EXECUTED');
  });

  it('clamps split count so every leg can carry the minimum lot size', async () => {
    configureExecution(true, '2');
    // $0.015 cannot fund two 0.01 legs
    const adapter = new MockAdapter(FX_INFO);
    const store = new FakeStore();
    const engine = new ExecutionEngine(adapter, store);

    await engine.executeApprovedSignal(request(0.015));

    expect(adapter.calls).toHaveLength(1);
    expect(adapter.calls[0].positionSize).toBeCloseTo(0.01, 6);
    expect(store.statuses.get('sig-1')).toBe('EXECUTED');
  });

  it('forces a single minimum-lot trade below one leg under the legacy round-up policy', async () => {
    configureExecution(false);
    useSettingsStore.getState().setRiskConfig({ rejectBelowMinVolume: false });
    const adapter = new MockAdapter(FX_INFO);
    const store = new FakeStore();
    const engine = new ExecutionEngine(adapter, store);

    await engine.executeApprovedSignal(request(0.004));

    expect(adapter.calls).toHaveLength(1);
    expect(adapter.calls[0].positionSize).toBe(0.01);
    expect(store.statuses.get('sig-1')).toBe('EXECUTED');
  });
});

describe('ExecutionEngine.strict minimum volume policy', () => {
  it('refuses to oversize below-minimum orders and marks the signal MISSED', async () => {
    configureExecution(false);
    useSettingsStore.setState({
      riskConfig: { ...DEFAULT_SETTINGS.riskConfig, rejectBelowMinVolume: true },
    });
    const adapter = new MockAdapter(FX_INFO);
    const store = new FakeStore();
    const engine = new ExecutionEngine(adapter, store);

    const ok = await engine.executeApprovedSignal(request(0.004));

    expect(ok).toBe(false);
    expect(adapter.calls).toHaveLength(0);
    expect(store.statuses.get('sig-1')).toBe('MISSED');
    expect(store.insertedTrades).toHaveLength(0);
  });
});

describe('ExecutionEngine.failure handling', () => {
  it('marks EXECUTED when at least one split fills', async () => {
    configureExecution(true, '2');
    const adapter = new MockAdapter(FX_INFO, [{ success: true }, { success: false }]);
    const store = new FakeStore();
    const engine = new ExecutionEngine(adapter, store);

    const ok = await engine.executeApprovedSignal(request(0.2));

    expect(ok).toBe(true);
    expect(store.insertedTrades).toHaveLength(1);
    expect(store.statuses.get('sig-1')).toBe('EXECUTED');
  });

  it('marks MISSED without inserting trades when every split fails', async () => {
    configureExecution(true, '2');
    const adapter = new MockAdapter(FX_INFO, [{ success: false }]);
    const store = new FakeStore();
    const engine = new ExecutionEngine(adapter, store);

    const ok = await engine.executeApprovedSignal(request(0.2));

    expect(ok).toBe(false);
    expect(adapter.calls).toHaveLength(2); // both legs attempted
    expect(store.insertedTrades).toHaveLength(0);
    expect(store.statuses.get('sig-1')).toBe('MISSED');
  });
});

describe('ExecutionEngine - invalid sizes', () => {
  it('refuses zero or NaN sizes without calling the broker', async () => {
    const adapter = new MockAdapter(FX_INFO);
    const store = new FakeStore();
    const engine = new ExecutionEngine(adapter, store);

    expect(await engine.executeApprovedSignal(request(0))).toBe(false);
    expect(await engine.executeApprovedSignal(request(Number.NaN))).toBe(false);
    expect(adapter.calls).toHaveLength(0);
    expect(store.statuses.get('sig-1')).toBe('MISSED');
  });

  it('refuses sub-minimum sizes under the default strict policy', async () => {
    const adapter = new MockAdapter(FX_INFO);
    const store = new FakeStore();
    const engine = new ExecutionEngine(adapter, store);

    expect(await engine.executeApprovedSignal(request(0.004))).toBe(false);
    expect(adapter.calls).toHaveLength(0);
  });
});

describe('ExecutionEngine - bookkeeping failures', () => {
  it('keeps executing remaining legs and reports EXECUTED when recording a fill fails', async () => {
    const adapter = new MockAdapter({ trade_tick_value: 1, trade_tick_size: 0.00001, volume_min: 0.01, volume_step: 0.01 });
    const store = new FakeStore();
    let failNext = true;
    store.insertTrade = async (trade) => {
      if (failNext) {
        failNext = false;
        throw new Error('database is locked');
      }
      store.insertedTrades.push(trade);
    };
    const engine = new ExecutionEngine(adapter, store);
    const untracked: string[] = [];
    engine.onUntrackedPositions = (tickets) => untracked.push(...tickets);

    const ok = await engine.executeApprovedSignal(request(0.2));

    expect(ok).toBe(true);
    expect(adapter.calls).toHaveLength(2);
    expect(store.insertedTrades.map((t) => t.id)).toEqual(['t-2']);
    expect(untracked).toEqual(['t-1']);
    expect(store.statuses.get('sig-1')).toBe('EXECUTED');
  });
});
