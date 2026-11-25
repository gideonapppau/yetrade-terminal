import { describe, it, expect } from 'vitest';
import { countOpenGroups, resolveRiskPercent } from './service';

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
