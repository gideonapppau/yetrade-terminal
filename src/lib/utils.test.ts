import { describe, it, expect } from 'vitest';
import { pipsToPoints, formatMoney } from './utils';

describe('pipsToPoints', () => {
  it('multiplies by ten on 5-digit FX pricing (pip = 10 points)', () => {
    expect(pipsToPoints(100, 0.00001)).toBe(1000);
  });

  it('multiplies by ten on 3-digit JPY-style pricing', () => {
    expect(pipsToPoints(30, 0.001)).toBe(300);
  });

  it('treats a point as a pip on even-digit pricing', () => {
    expect(pipsToPoints(50, 0.01)).toBe(50);
    expect(pipsToPoints(10, 1)).toBe(10);
  });

  it('returns zero for invalid point sizes instead of NaN/Infinity', () => {
    expect(pipsToPoints(100, 0)).toBe(0);
    expect(pipsToPoints(100, -0.0001)).toBe(0);
  });
});

describe('formatMoney', () => {
  it('formats positive and negative amounts with a currency symbol', () => {
    expect(formatMoney(1234.5)).toMatch(/1[,.]234\.50/);
    expect(formatMoney(-12)).toContain('12.00');
  });

  it('falls back to a dollar prefix for unknown currency codes', () => {
    expect(formatMoney(5, 'NOPE')).toBe('$5.00');
  });
});
