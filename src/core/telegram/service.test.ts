import { describe, it, expect } from 'vitest';
import { countOpenGroups, resolveRiskPercent, selectNewMessages } from './service';

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
