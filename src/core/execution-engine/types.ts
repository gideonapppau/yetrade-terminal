import type { ParsedSignal } from '../signal-engine/types';

export interface ExecutionRequest {
  signalId: string;
  signal: ParsedSignal;
  positionSize: number;
  /**
   * Zero-based index of this leg when a signal is split across multiple
   * take-profits. Combined with signalId it forms the broker idempotency key
   * so a retried request can never double-open a position.
   */
  splitIndex?: number;
}

export interface ExecutionResult {
  success: boolean;
  tradeId?: string;
  entryPrice?: number;
  message?: string;
  executedAt: Date;
}

export interface SymbolInfo {
  trade_tick_value: number;
  trade_tick_size: number;
  trade_contract_size?: number;
  volume_min?: number;
  volume_step?: number;
  point?: number;
}

export interface OpenPosition {
  ticket: string | number;
  symbol: string;
  type: 'BUY' | 'SELL' | string;
  volume: number;
  price_open?: number;
  price_current?: number;
  sl?: number;
  tp?: number;
  profit?: number;
}

/** One closed deal belonging to a position (from the broker's history). */
export interface PositionDeal {
  ticket: string | number;
  order?: string | number;
  time?: number;
  entry: 'IN' | 'OUT' | 'INOUT';
  symbol?: string;
  volume?: number;
  price?: number;
  profit: number;
  commission?: number;
  swap?: number;
}

export interface BrokerAdapter {
  name: string;
  isConnected(): Promise<boolean>;
  loginBroker(params: any): Promise<{ success: boolean; message: string }>;
  executeTrade(request: ExecutionRequest): Promise<ExecutionResult>;
  getAccountInfo(): Promise<any>;
  /** null when the broker could not be queried - never confuse with "no positions". */
  getOpenPositions?(): Promise<OpenPosition[] | null>;
  getSymbolPrice?(symbol: string): Promise<{ ask: number; bid: number } | null>;
  getSymbolInfo?(symbol: string): Promise<SymbolInfo | null>;
  /** Closed-deal history for a position; null/[] when the broker has none yet. */
  getDeals?(positionTicket: string | number): Promise<PositionDeal[] | null>;
  /** volume closes only part of the position (partial close). */
  closeTrade?(ticket: string | number, volume?: number): Promise<{ success: boolean; message: string }>;
  modifyTrade?(ticket: string | number, sl?: number, tp?: number): Promise<{ success: boolean; message: string }>;
}
