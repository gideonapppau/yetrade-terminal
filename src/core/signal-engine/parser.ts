import type { ParsedSignal, SignalParser, TakeProfit, TradeDirection } from './types';
import { logger } from '../logger';

/**
 * Canonical form of a provider's message before any matching:
 *  - NFKC folds stylised Unicode letters/digits ("𝗕𝗨𝗬", "𝟯𝟱𝟲𝟴") to ASCII,
 *  - emoji and pictographs become spaces, so "DIRECTION: 🔴SELL" reads as
 *    "DIRECTION:  SELL" instead of hiding the direction from every pattern,
 *  - dash variants become "-".
 * Real channel posts are full of both; without this they parsed as nothing.
 */
export function normalizeSignalText(message: string): string {
  return message
    .normalize('NFKC')
    .replace(/[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}️‍⃣]/gu, ' ')
    .replace(/[‐-―−]/g, '-');
}

/**
 * A deterministic Regex Parser for a standard signal format.
 * Format expected:
 * XAUUSD BUY
 * ENTRY: 3350
 * SL: 3340
 * TP1: 3360
 * TP2: 3380
 */
export class RegexParser implements SignalParser {
  version(): string {
    return '1.4.0';
  }

  canParse(message: string): boolean {
    const upperMsg = normalizeSignalText(message).toUpperCase();
    return (upperMsg.includes('BUY') || upperMsg.includes('SELL')) &&
           (upperMsg.includes('SL') || upperMsg.includes('S/L') || upperMsg.includes('STOP') || upperMsg.includes('TP') || upperMsg.includes('T/P') || upperMsg.includes('TARGET'));
  }

  /**
   * Detects a trade *intent* - symbol plus direction but no levels yet.
   * Used by fast-entry channels ("SELL GOLD") that post coordinates later,
   * either as an edit or a follow-up message. Returns null unless the text
   * strictly looks like an order command; chat noise must not trigger it.
   */
  parseIntent(message: string): { symbol: string; direction: TradeDirection } | null {
    const trimmedMsg = normalizeSignalText(message).trim();
    if (!trimmedMsg) return null;

    // Command-shape guards: intents are short imperative posts. Questions,
    // exclamations and long sentences are conversation, not orders.
    if (/[?!]/.test(trimmedMsg)) return null;
    if (trimmedMsg.split(/\s+/).length > 8) return null;

    const upperMsg = trimmedMsg.toUpperCase();

    // A message carrying real levels is a complete signal, not an intent -
    // the normal pipeline handles it.
    if (/(?:STOP(?:[\s_]*LOSS)?|SL|S\/L)[\s:.-]*[\d.]/.test(upperMsg)) return null;

    // Format: PAIR: XAUUSD \n ORDER TYPE: BUY
    const pairMatch = upperMsg.match(/(?:PAIR|SYMBOL):\s*([A-Z0-9]+)[\s\S]*?(?:ORDER TYPE|DIRECTION|ACTION):\s*(BUY|SELL)/);
    if (pairMatch) {
      return { symbol: pairMatch[1], direction: pairMatch[2] as TradeDirection };
    }

    // Direction-first: "SELL GOLD", "BUY NOW BTCUSD", optionally with a price.
    // The keyword must START a line - "we should buy gold here" is chatter,
    // not an order. Order-type and label words are never symbols, and
    // symbols start with a letter ("BUY 3350" names no instrument).
    const dirFirst = upperMsg.match(/(?:^|\n)\s*(BUY|SELL)(?:\s+(?:LIMIT|STOP|NOW|MARKET)\b)?\s+(?!(?:TARGET|TGT|T\/P|TP|SL|S\/L|STOP|LOSS|LIMIT|NOW|MARKET|ENTRY|PRICE|ZONE|AT)\b)([A-Z][A-Z0-9]{1,9})\b/);
    if (dirFirst) {
      return { symbol: dirFirst[2], direction: dirFirst[1] as TradeDirection };
    }

    // Symbol-first, also anchored to a line start: "XAUUSD SELL"
    const symFirst = upperMsg.match(/(?:^|\n)\s*(?!(?:NOW|MARKET|LIMIT|STOP)\b)([A-Z][A-Z0-9]{1,9})\s+(BUY|SELL)\b/);
    if (symFirst) {
      return { symbol: symFirst[1], direction: symFirst[2] as TradeDirection };
    }

    return null;
  }

  parse(message: string): ParsedSignal | null {
    try {
      const upperMsg = normalizeSignalText(message).toUpperCase();

      let symbol = '';
      let direction: TradeDirection | undefined = undefined;
      let entry: number | undefined = undefined;

      // 1. Extract Symbol and Direction
      // Try format: PAIR: XAUUSD \n ORDER TYPE: BUY
      const pairMatch = upperMsg.match(/(?:PAIR|SYMBOL):\s*([A-Z0-9]+)[\s\S]*?(?:ORDER TYPE|DIRECTION|ACTION):\s*(BUY|SELL)/);
      if (pairMatch) {
        symbol = pairMatch[1];
        direction = pairMatch[2] as TradeDirection;
      } else {
        // Try format: BUY GOLD @ 4068 / BUY LIMIT GOLD 4068
        // Order-type and label words are excluded so "XAUUSD BUY TARGET 3400",
        // "BUY LIMIT 3350" or "SELL\nSTOP LOSS 3360" never parse those words
        // as the symbol; symbols start with a letter so "BUY 3350" can't
        // become symbol "335".
        const buySellMatch = upperMsg.match(/(BUY|SELL)(?:\s+(?:LIMIT|STOP|NOW|MARKET)\b)?\s+(?!(?:TARGET|TGT|T\/P|TP|SL|S\/L|STOP|LOSS|LIMIT|NOW|MARKET|ENTRY|PRICE|ZONE|AT)\b)([A-Z][A-Z0-9]*)\s*(?:@|AT)?\s*([\d.]+)/);
        if (buySellMatch) {
          direction = buySellMatch[1] as TradeDirection;
          symbol = buySellMatch[2];
          entry = parseFloat(buySellMatch[3]);
        } else {
          // Try format: XAUUSD BUY (the symbol must be a standalone word)
          const headerMatch = upperMsg.match(/(?:^|[^A-Z0-9])(?!(?:NOW|MARKET|LIMIT|STOP|TP|SL|HIT)\b)([A-Z][A-Z0-9]*)\s+(BUY|SELL)\b/);
          if (headerMatch) {
            symbol = headerMatch[1];
            direction = headerMatch[2] as TradeDirection;
          }
        }
      }

      if (!symbol || !direction) return null;

      // 2. Extract Entry (Optional but common)
      if (!entry) {
        // "ENTRY: 3350", "ENTRY 3350", "ENTRY @ 3350", "ENTRY PRICE/ZONE: 3350"
        const entryMatch = upperMsg.match(/ENTRY(?:\s*(?:PRICE|ZONE))?\s*[:@-]?\s*([\d.]+)/);
        if (entryMatch) {
          entry = parseFloat(entryMatch[1]);
        }
      }
      if (!entry) {
        // Price right after the direction: "BUY LIMIT 3350", "SELL @ 3350"
        const directPrice = upperMsg.match(/(?:BUY|SELL)(?:\s+(?:LIMIT|STOP|NOW|MARKET)\b)?\s*(?:@|AT\b)?\s*(\d[\d.]*)/);
        if (directPrice) {
          entry = parseFloat(directPrice[1]);
        }
      }

      // 3. Extract Stop Loss (Required)
      const slMatch = upperMsg.match(/(?:STOP(?:[\s_]*LOSS)?|SL|S\/L)[\s:.-]*([\d.]+)/);
      if (!slMatch) return null;
      const stopLoss = parseFloat(slMatch[1]);

      // 4. Extract Take Profits
      const takeProfits: TakeProfit[] = [];
      // After the label, exactly one separator alternative must match:
      //   - a numbered label ("TP1:") followed by : or -, or by a dot only
      //     when whitespace follows ("TP1. 3360")
      //   - a numbered label glued to the price ("TP1 3360")
      //   - a bare colon/minus/dot ("TP:3360") or whitespace ("TP 3360")
      // Without the explicit digit-consumption branch, "TP1 3360" would parse
      // the label digit itself as the take-profit price. The dot needs the
      // whitespace guard, otherwise "TP 1.0850" reads "1." as a label and
      // captures 850.
      const tpRegex = /(?:TAKE(?:[\s_]*PROFIT)?|TP|T\/P|TARGET|TGT)(?:\s*\d{1,2}(?:\s*[:-]|\.(?=\s))\s*|\s*\d{1,2}\s+|[:.-]\s*|\s+)([\d.]+)/g;
      let tpMatch;
      while ((tpMatch = tpRegex.exec(upperMsg)) !== null) {
        // Prevent matching entry or SL accidentally if formatting is weird
        const val = parseFloat(tpMatch[1]);
        if (val !== entry && val !== stopLoss) {
          takeProfits.push({ price: val });
        }
      }

      // If no TP found, we can still parse the signal, TP is optional in some systems
      // or managed by trailing stop.


      return {
        symbol,
        direction,
        entry,
        stopLoss,
        takeProfits,
      };
    } catch (err) {
      logger.error({ err, message }, 'RegexParser failed to parse message');
      return null;
    }
  }
}

