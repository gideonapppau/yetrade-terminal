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

describe('RegexParser.parseIntent', () => {
  it('detects direction-first intents without levels', () => {
    expect(parser.parseIntent('SELL GOLD')).toEqual({ symbol: 'GOLD', direction: 'SELL' });
    expect(parser.parseIntent('Buy XAUUSD now')).toEqual({ symbol: 'XAUUSD', direction: 'BUY' });
  });

  it('detects symbol-first and structured intents', () => {
    expect(parser.parseIntent('XAUUSD SELL')).toEqual({ symbol: 'XAUUSD', direction: 'SELL' });
    expect(parser.parseIntent('PAIR: EURUSD\nORDER TYPE: BUY')).toEqual({ symbol: 'EURUSD', direction: 'BUY' });
  });

  it('rejects complete signals - they belong to the normal pipeline', () => {
    expect(parser.parseIntent('XAUUSD BUY\nENTRY: 3350\nSL: 3340\nTP: 3400')).toBeNull();
  });

  it('never mistakes target labels for symbols', () => {
    expect(parser.parseIntent('BUY TARGET 70000')).toBeNull();
  });

  it('rejects mid-sentence direction words - chatter is not an order', () => {
    expect(parser.parseIntent('we should buy gold here')).toBeNull();
    expect(parser.parseIntent('looking to sell eurusd later')).toBeNull();
  });

  it('returns null for chat noise', () => {
    expect(parser.parseIntent('what did you buy today?')).toBeNull();
    expect(parser.parseIntent('')).toBeNull();
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

  it('parses numbered TP labels separated by whitespace instead of a colon', () => {
    // Regression: "TP1 3360" used to parse the label digit as the price ([1, 2])
    const signal = parser.parse('XAUUSD BUY\nENTRY: 3350\nSL: 3340\nTP1 3360\nTP2 3380');
    expect(signal!.takeProfits.map((tp) => tp.price)).toEqual([3360, 3380]);
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

describe('RegexParser.parse - dot separators', () => {
  it('reads sub-100 prices after a bare TP label in full', () => {
    const signal = parser.parse('EURUSD BUY\nENTRY: 1.0800\nSL 1.0750\nTP 1.0850');
    expect(signal!.stopLoss).toBe(1.075);
    expect(signal!.takeProfits.map((tp) => tp.price)).toEqual([1.085]);

    const silver = parser.parse('XAGUSD SELL\nENTRY: 13.20\nSL 13.80\nTP 12.50');
    expect(silver!.takeProfits.map((tp) => tp.price)).toEqual([12.5]);
  });

  it('accepts a dot after a numbered TP label when whitespace follows', () => {
    const signal = parser.parse('XAUUSD BUY\nENTRY: 3350\nSL. 3340\nTP1. 3360\nTP2. 3380');
    expect(signal!.stopLoss).toBe(3340);
    expect(signal!.takeProfits.map((tp) => tp.price)).toEqual([3360, 3380]);
  });

  it('does not read a dot after SL as a decimal point', () => {
    const signal = parser.parse('XAUUSD BUY\nENTRY: 3350\nSL.3340\nTP: 3360');
    expect(signal!.stopLoss).toBe(3340);
  });
});

describe('RegexParser.parse - order-type words and symbols', () => {
  it('never takes an order-type word as the symbol', () => {
    const limit = parser.parse('XAUUSD\nBUY LIMIT 3350\nSL 3340\nTP 3370');
    expect(limit).toMatchObject({ symbol: 'XAUUSD', direction: 'BUY', entry: 3350, stopLoss: 3340 });

    const now = parser.parse('SELL NOW XAUUSD 3350 SL 3360 TP 3330');
    expect(now).toMatchObject({ symbol: 'XAUUSD', direction: 'SELL', entry: 3350 });

    const limitWithSymbol = parser.parse('BUY LIMIT GOLD 3350\nSL 3340\nTP 3370');
    expect(limitWithSymbol).toMatchObject({ symbol: 'GOLD', entry: 3350 });
  });

  it('never takes a level label as the symbol', () => {
    const signal = parser.parse('XAUUSD SELL\nSTOP LOSS 3360\nTP 3330');
    expect(signal).toMatchObject({ symbol: 'XAUUSD', direction: 'SELL', stopLoss: 3360 });
  });

  it('never takes a bare price as the symbol', () => {
    const signal = parser.parse('XAUUSD BUY 3350\nSL 3340\nTP 3370');
    expect(signal).toMatchObject({ symbol: 'XAUUSD', entry: 3350 });
  });

  it('reads entries without a colon', () => {
    expect(parser.parse('XAUUSD BUY\nENTRY 3350\nSL 3340\nTP 3370')!.entry).toBe(3350);
    expect(parser.parse('XAUUSD BUY\nENTRY @ 3350\nSL 3340\nTP 3370')!.entry).toBe(3350);
  });
});

describe('RegexParser.parseIntent - order-type words', () => {
  it('skips order-type words and digit-led tokens', () => {
    expect(parser.parseIntent('SELL NOW GOLD')).toEqual({ symbol: 'GOLD', direction: 'SELL' });
    expect(parser.parseIntent('SELL NOW')).toBeNull();
    expect(parser.parseIntent('BUY 3350')).toBeNull();
  });
});

describe('RegexParser - real channel formatting (emoji, stylised text)', () => {
  const parser = new RegexParser();

  // Verbatim TRADE PULSE post that parsed as null: the 🔴 between
  // "DIRECTION:" and "SELL" hid the direction from every pattern.
  const tradePulse =
    "🚨 TRADE PULSE | SIGNAL ALERT\n━━━━━━━━━━━━━━━━━━\n\nPAIR: XAUUSD (GOLD)\n\nDIRECTION: 🔴SELL\n\n" +
    "📍 ENTRY ZONE: 3568– 35672\n\n🛑 STOP LOSS: 3578\n\n🎯 TAKE PROFIT LEVELS \n\nTP1: 3555\nTP2: 3535\n" +
    "━━━━━━━━━━━━━━━━━━\n⚠️ RISK MANAGEMENT IS KEY\nFollow proper risk management and protect your capital.\nTRADE SMART. STAY DISCIPLINED.";

  it('parses a signal whose direction is prefixed by an emoji', () => {
    expect(parser.parse(tradePulse)).toEqual({
      symbol: 'XAUUSD',
      direction: 'SELL',
      entry: 3568,
      stopLoss: 3578,
      takeProfits: [{ price: 3555 }, { price: 3535 }],
    });
  });

  it('parses emoji-decorated header-style signals', () => {
    expect(parser.parse('🟢 XAUUSD BUY 🟢\n✅ ENTRY: 2650\n❌ SL: 2640\n🎯 TP1: 2665')).toEqual({
      symbol: 'XAUUSD',
      direction: 'BUY',
      entry: 2650,
      stopLoss: 2640,
      takeProfits: [{ price: 2665 }],
    });
  });

  it('folds stylised Unicode letters and digits to plain text', () => {
    const parsed = parser.parse('𝗫𝗔𝗨𝗨𝗦𝗗 𝗕𝗨𝗬\nENTRY: 𝟮𝟲𝟱𝟬\nSL: 𝟮𝟲𝟰𝟬\nTP: 𝟮𝟲𝟳𝟬');
    expect(parsed).toMatchObject({ symbol: 'XAUUSD', direction: 'BUY', entry: 2650, stopLoss: 2640 });
  });

  it('still detects emoji-prefixed intents', () => {
    expect(parser.parseIntent('🔴 XAUUSD SELL NOW')).toEqual({ symbol: 'XAUUSD', direction: 'SELL' });
  });
});
