import { describe, it, expect } from 'vitest';
import { formatTradeOpened, formatSignalNotTraded, formatTradeClosed, tradeResultLabel } from './reports';

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
