import { describe, it, expect } from 'vitest';
import { formatTradeOpened, formatSignalNotTraded, formatTradeClosed, tradeResultLabel, formatDailySummary } from './reports';

const signal = { symbol: 'XAUUSD', direction: 'SELL', entry: 3568, stopLoss: 3578, takeProfit: 3555, source: 'TRADE PULSE' };

describe('trade report formatting', () => {
  it('describes an opened trade with size, levels and source', () => {
    expect(formatTradeOpened({ ...signal, volume: 0.01 })).toBe(
      '✅ Trade opened: SELL XAUUSD\n0.01 lots · Entry 3568 · SL 3578 · TP 3555\nFrom: TRADE PULSE'
    );
  });

  it('explains why a signal was not traded', () => {
    const text = formatSignalNotTraded({ ...signal, status: 'MISSED', reason: 'AutoTrading is disabled in MetaTrader 5' });
    expect(text).toContain('⚠️ Signal not traded (MISSED): SELL XAUUSD');
    expect(text).toContain('Reason: AutoTrading is disabled in MetaTrader 5');
  });

  it('handles market entries without a posted price', () => {
    expect(formatTradeOpened({ ...signal, entry: null, volume: 0.02 })).toContain('Entry: market · SL 3578');
  });

  it('reports closed trades with signed P/L', () => {
    expect(formatTradeClosed({ symbol: 'BTCUSDM', direction: 'BUY', volume: 0.01, pnl: 12.4, ticket: '604378795' })).toBe(
      '🏁 Trade closed: BUY BTCUSDM · 0.01 lots\nP/L +12.40 (win) · #604378795'
    );
    expect(formatTradeClosed({ symbol: 'XAUUSD', direction: 'SELL', volume: 0.03, pnl: -24.1, ticket: '1' })).toContain(
      '🔻 Trade closed'
    );
  });
});

describe('breakeven closes', () => {
  it('labels a 0.00 close as Breakeven, not Win', () => {
    expect(tradeResultLabel({ status: 'CLOSED_WIN', pnl: 0 })).toBe('Breakeven');
    expect(tradeResultLabel({ status: 'CLOSED_WIN', pnl: 12.4 })).toBe('Win');
    expect(tradeResultLabel({ status: 'CLOSED_LOSS', pnl: -3 })).toBe('Loss');
    expect(formatTradeClosed({ symbol: 'BTCUSDM', direction: 'BUY', volume: 0.01, pnl: 0, ticket: '608422411' })).toContain('P/L +0.00 (breakeven)');
  });
});

describe('formatDailySummary', () => {
  it('summarises the day including why signals were not traded', () => {
    const text = formatDailySummary({
      date: '2026-11-26',
      signalsByStatus: { EXECUTED: 2, REJECTED: 1, MISSED: 1 },
      notTradedReasons: [
        { reason: 'RR 0.80 is below minimum 1.5', count: 1 },
        { reason: 'AutoTrading is disabled in MetaTrader 5', count: 1 },
      ],
      closed: { count: 2, wins: 1, losses: 0, breakeven: 1, pnl: 12.4 },
      openTrades: 1,
      balance: 1494.94,
      equity: 1501.2,
      currency: 'USD',
    });
    expect(text).toContain('Signals: 4 (executed 2, rejected 1, missed 1)');
    expect(text).toContain('Closed trades: 2 (1W / 0L / 1BE) · P/L +12.40 USD');
    expect(text).toContain('• 1× RR 0.80 is below minimum 1.5');
  });
});
