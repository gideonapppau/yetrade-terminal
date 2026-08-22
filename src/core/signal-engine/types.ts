export type TradeDirection = 'BUY' | 'SELL';

export interface TakeProfit {
  price: number;
}

export interface ParsedSignal {
  symbol: string;
  direction: TradeDirection;
  entry?: number;
  stopLoss: number;
  takeProfits: TakeProfit[];
  confidence?: number;
}

export interface SignalParser {
  canParse(message: string): boolean;
  parse(message: string): ParsedSignal | null;
  version(): string;
}
