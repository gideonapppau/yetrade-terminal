import { describe, it, expect } from 'vitest';
import { RegexParser } from './parser';

const parser = new RegexParser();

describe('RegexParser.canParse', () => {
  it('accepts messages with direction and SL/TP keywords', () => {
    expect(parser.canParse('XAUUSD BUY\nSL: 3340')).toBe(true);
    expect(parser.canParse('SELL EURUSD, STOP 1.0850')).toBe(true);
    expect(parser.canParse('BTCUSD BUY TARGET 70000')).toBe(true);
  });

  it('rejects messages without a direction', () => {
    expect(parser.canParse('XAUUSD is looking bullish today')).toBe(false);
  });

  it('rejects messages without any stop/target keyword', () => {
    expect(parser.canParse('BUY EURUSD now')).toBe(false);
  });
});

describe('RegexParser.parse', () => {
  it('parses the standard multi-line format with multiple TPs', () => {
    const signal = parser.parse(
      'XAUUSD BUY\nENTRY: 3350\nSL: 3340\nTP1: 3360\nTP2: 3380'
    );

    expect(signal).not.toBeNull();
    expect(signal!.symbol).toBe('XAUUSD');
    expect(signal!.direction).toBe('BUY');
    expect(signal!.entry).toBe(3350);
    expect(signal!.stopLoss).toBe(3340);
    expect(signal!.takeProfits.map((tp) => tp.price)).toEqual([3360, 3380]);
  });

  it('parses the inline "BUY GOLD @ price" format', () => {
    const signal = parser.parse('BUY GOLD @ 4068\nSL: 4050\nTP: 4100');

    expect(signal).not.toBeNull();
    expect(signal!.direction).toBe('BUY');
    expect(signal!.symbol).toBe('GOLD');
    expect(signal!.entry).toBe(4068);
    expect(signal!.stopLoss).toBe(4050);
  });

  it('parses the PAIR / ORDER TYPE format', () => {
    const signal = parser.parse(
      'PAIR: EURUSD\nORDER TYPE: SELL\nENTRY: 1.0850\nSL: 1.0900\nTP: 1.0750'
    );

    expect(signal).not.toBeNull();
    expect(signal!.symbol).toBe('EURUSD');
    expect(signal!.direction).toBe('SELL');
    expect(signal!.entry).toBe(1.085);
  });

  it('returns null when the stop loss is missing', () => {
    expect(parser.parse('XAUUSD BUY\nENTRY: 3350\nTP: 3400')).toBeNull();
  });

  it('returns null for unstructured text that happens to contain BUY and TP words', () => {
    // No symbol/direction pair extractable
    expect(parser.parse('we should TP our bags and buy pizza\nSTOP reading this')).toBeNull();
  });

  it('allows signals without take profits (trailing-stop managed)', () => {
    const signal = parser.parse('XAUUSD BUY\nENTRY: 3350\nSL: 3340');

    expect(signal).not.toBeNull();
    expect(signal!.takeProfits).toHaveLength(0);
  });

  it('parses numbered TP labels without swallowing the price', () => {
    const signal = parser.parse('XAUUSD BUY\nENTRY: 3350\nSL: 3340\nTP1: 3360\nTP2: 3380');
    expect(signal!.takeProfits.map((tp) => tp.price)).toEqual([3360, 3380]);

    const spaced = parser.parse('EURUSD SELL\nENTRY: 1.085\nSL: 1.09\nTARGET 2: 1.075');
    expect(spaced!.takeProfits.map((tp) => tp.price)).toEqual([1.075]);
  });

  it('parses unnumbered TP labels with a bare space separator', () => {
    const signal = parser.parse('BTCUSD BUY TARGET 70000\nSL: 68000\nENTRY: 69000');
    expect(signal!.symbol).toBe('BTCUSD');
    expect(signal!.entry).toBe(69000);
    expect(signal!.takeProfits.map((tp) => tp.price)).toEqual([70000]);
  });

  it('parses the emoji-heavy PAIR/ORDER TYPE format with an entry range', () => {
    const signal = parser.parse(
      '‼️SIGNAL ALERT‼️\n' +
      'PAIR: BTCUSD\n' +
      'ORDER TYPE: BUY\n' +
      'ENTRY PRICE: 77000 - 76000\n\n' +
      '❌STOP LOSS: 75000\n\n' +
      '✅TAKE PROFIT 1:80000\n' +
      '✅TAKE PROFIT 2:83000\n\n' +
      '‼️Follow Risk Management rules‼️'
    );

    expect(signal).not.toBeNull();
    expect(signal!.symbol).toBe('BTCUSD');
    expect(signal!.direction).toBe('BUY');
    expect(signal!.entry).toBe(77000);
    expect(signal!.stopLoss).toBe(75000);
    expect(signal!.takeProfits.map((tp) => tp.price)).toEqual([80000, 83000]);
  });
});
