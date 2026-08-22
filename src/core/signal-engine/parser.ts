import type { ParsedSignal, SignalParser, TakeProfit, TradeDirection } from './types';
import { logger } from '../logger';

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
    return '1.2.0';
  }

  canParse(message: string): boolean {
    const upperMsg = message.toUpperCase();
    return (upperMsg.includes('BUY') || upperMsg.includes('SELL')) && 
           (upperMsg.includes('SL') || upperMsg.includes('S/L') || upperMsg.includes('STOP') || upperMsg.includes('TP') || upperMsg.includes('T/P') || upperMsg.includes('TARGET'));
  }

  parse(message: string): ParsedSignal | null {
    try {
      const upperMsg = message.toUpperCase();
      
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
        // Try format: BUY GOLD @ 4068
        // Label words (TARGET/TP/...) are excluded so messages like
        // "XAUUSD BUY TARGET 3400" don't parse TARGET as the symbol.
        const buySellMatch = upperMsg.match(/(BUY|SELL)\s+(?!TARGET\b|TGT\b|T\/P\b|TP\b)([A-Z0-9]+)\s*(?:@|AT)?\s*([\d.]+)/);
        if (buySellMatch) {
          direction = buySellMatch[1] as TradeDirection;
          symbol = buySellMatch[2];
          entry = parseFloat(buySellMatch[3]);
        } else {
          // Try format: XAUUSD BUY
          const headerMatch = upperMsg.match(/([A-Z0-9]+)\s+(BUY|SELL)/);
          if (headerMatch) {
            symbol = headerMatch[1];
            direction = headerMatch[2] as TradeDirection;
          }
        }
      }

      if (!symbol || !direction) return null;

      // 2. Extract Entry (Optional but common)
      if (!entry) {
        const entryMatch = upperMsg.match(/ENTRY(?: PRICE)?:\s*([\d.]+)/);
        if (entryMatch) {
          entry = parseFloat(entryMatch[1]);
        }
      }

      // 3. Extract Stop Loss (Required)
      const slMatch = upperMsg.match(/(?:STOP(?:[\s_]*LOSS)?|SL|S\/L)[\s:-]*([\d.]+)/);
      if (!slMatch) return null;
      const stopLoss = parseFloat(slMatch[1]);

      // 4. Extract Take Profits
      const takeProfits: TakeProfit[] = [];
      // A numbered label ("TP1:", "TARGET 2:") is only consumed when directly
      // followed by a : or - separator; otherwise "TP 3400" would grab the
      // label digits as part of the price.
      const tpRegex = /(?:TAKE(?:[\s_]*PROFIT)?|TP|T\/P|TARGET|TGT)(?:\s*\d{1,2}\s*[:\-]\s*|\s*[:\-]?\s*)([\d.]+)/g;
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

