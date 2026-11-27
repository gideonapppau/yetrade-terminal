import { describe, it, expect } from 'vitest';
import { countOpenGroups, resolveRiskPercent, selectNewMessages, isRepostOf, REPOST_WINDOW_MS, TelegramService } from './service';
import { TELEGRAM_DEAD_AFTER_FAILED_POLLS } from '../constants';

describe('countOpenGroups', () => {
  it('counts TP legs of one signal as a single group', () => {
    expect(countOpenGroups([
      { id: 't1', signalId: 's1' },
      { id: 't2', signalId: 's1' },
      { id: 't3', signalId: 's2' },
      { id: 't4', signalId: null },
    ])).toBe(3);
  });
});

describe('resolveRiskPercent', () => {
  it('honors sub-1% values instead of flooring them', () => {
    expect(resolveRiskPercent(null, 0.5)).toBe(0.5);
    expect(resolveRiskPercent(0.25, 1)).toBe(0.25);
  });

  it('ignores non-positive overrides', () => {
    expect(resolveRiskPercent(0, 0.5)).toBe(0.5);
    expect(resolveRiskPercent(-1, 0.5)).toBe(0.5);
  });
});

describe('selectNewMessages (polling fallback)', () => {
  const now = Date.parse('2026-11-26T12:00:00Z');
  const msg = (id: number, secondsAgo: number) => ({
    channelId: '100',
    messageId: String(id),
    timestamp: new Date(now - secondsAgo * 1000),
    text: `m${id}`,
    edited: false,
  });

  it('on the first poll keeps only messages young enough to trade', () => {
    const picked = selectNewMessages([msg(12, 30), msg(11, 600), msg(10, 3600)], undefined, 120, now);
    expect(picked.map((m) => m.messageId)).toEqual(['12']);
  });

  it('afterwards returns everything newer than the last seen id, oldest first', () => {
    const picked = selectNewMessages([msg(15, 1), msg(13, 20), msg(14, 10), msg(12, 30)], 12, 120, now);
    expect(picked.map((m) => m.messageId)).toEqual(['13', '14', '15']);
  });

  it('returns nothing when no message is newer than the last seen id', () => {
    expect(selectNewMessages([msg(12, 30), msg(11, 60)], 12, 120, now)).toEqual([]);
  });
});

describe('isRepostOf', () => {
  const now = Date.parse('2026-11-26T11:23:18Z');
  const prior = { symbol: 'XAUUSD', direction: 'SELL', entry: 3568, stopLoss: 3578, receivedAt: now - 11_000 };
  const parsed = { symbol: 'XAUUSD', direction: 'SELL' as const, entry: 3568, stopLoss: 3578 };

  it('flags an identical signal re-posted moments later (TRADE PULSE 3589/3590)', () => {
    expect(isRepostOf(parsed, [prior], now)).toBe(true);
  });

  it('treats different levels or direction as a new signal', () => {
    expect(isRepostOf({ ...parsed, stopLoss: 3580 }, [prior], now)).toBe(false);
    expect(isRepostOf({ ...parsed, direction: 'BUY' }, [prior], now)).toBe(false);
  });

  it('ignores signals older than the re-post window', () => {
    expect(isRepostOf(parsed, [{ ...prior, receivedAt: now - REPOST_WINDOW_MS - 1 }], now)).toBe(false);
  });
});

describe('TelegramService - dead connection detection', () => {
  it('reports a lost connection once after every channel poll keeps failing', async () => {
    const failing = {
      subscribeToChannels: () => undefined,
      getRecentMessages: async () => { throw new Error('Not connected'); },
    };
    const svc = new TelegramService(failing as never);
    let lost = 0;
    svc.onConnectionLost = () => { lost += 1; };
    (svc as unknown as { pollChannelIds: string[] }).pollChannelIds = ['100', '200'];
    const poll = () => (svc as unknown as { pollOnce: () => Promise<void> }).pollOnce();

    for (let i = 0; i < TELEGRAM_DEAD_AFTER_FAILED_POLLS - 1; i++) await poll();
    expect(lost).toBe(0);
    await poll();
    expect(lost).toBe(1);
    await poll(); // keeps failing: no repeated callbacks
    expect(lost).toBe(1);
  });

  it('a single successful channel resets the failure streak', async () => {
    let calls = 0;
    const flaky = {
      subscribeToChannels: () => undefined,
      getRecentMessages: async () => {
        calls += 1;
        if (calls % 5 === 0) return []; // flaky but alive: never 8 failures in a row
        throw new Error('timeout');
      },
    };
    const svc = new TelegramService(flaky as never);
    let lost = 0;
    svc.onConnectionLost = () => { lost += 1; };
    (svc as unknown as { pollChannelIds: string[] }).pollChannelIds = ['100'];
    for (let i = 0; i < 30; i++) await (svc as unknown as { pollOnce: () => Promise<void> }).pollOnce();
    expect(lost).toBe(0);
  });
});

describe('TelegramService - hung polls (dead socket)', () => {
  it('treats polls that never answer as failures and reports the lost connection', async () => {
    const hanging = {
      subscribeToChannels: () => undefined,
      getRecentMessages: () => new Promise<never>(() => undefined), // never settles
    };
    const svc = new TelegramService(hanging as never);
    svc.pollTimeoutMs = 5;
    let lost = 0;
    svc.onConnectionLost = () => { lost += 1; };
    (svc as unknown as { pollChannelIds: string[] }).pollChannelIds = ['100'];
    for (let i = 0; i < TELEGRAM_DEAD_AFTER_FAILED_POLLS; i++) {
      await (svc as unknown as { pollOnce: () => Promise<void> }).pollOnce();
    }
    expect(lost).toBe(1);
  });
});
