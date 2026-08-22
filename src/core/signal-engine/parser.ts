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
    return '1.1.0';
  }

  canParse(message: string): boolean {
    const upperMsg = message.toUpperCase();
    return (upperMsg.includes('BUY') || upperMsg.includes('SELL')) && 
           (upperMsg.includes('SL') || upperMsg.includes('STOP LOSS'));
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
        const buySellMatch = upperMsg.match(/(BUY|SELL)\s+([A-Z0-9]+)\s*(?:@|AT)?\s*([\d.]+)/);
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
      const slMatch = upperMsg.match(/(?:STOP\s*LOSS|SL)[\s:]*([\d.]+)/);
      if (!slMatch) return null;
      const stopLoss = parseFloat(slMatch[1]);

      // 4. Extract Take Profits
      const takeProfits: TakeProfit[] = [];
      const tpRegex = /(?:TAKE\s*PROFIT|TP)[\s\d]*:\s*([\d.]+)/g;
      let tpMatch;
      while ((tpMatch = tpRegex.exec(upperMsg)) !== null) {
        takeProfits.push({ price: parseFloat(tpMatch[1]) });
      }

      if (takeProfits.length === 0) return null;

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

