import type { ParsedSignal } from '../signal-engine/types';

export interface ExecutionRequest {
  signalId: string;
  signal: ParsedSignal;
  positionSize: number;
}

export interface ExecutionResult {
  success: boolean;
  tradeId?: string;
  entryPrice?: number;
  message?: string;
  executedAt: Date;
}

export interface BrokerAdapter {
  name: string;
  isConnected(): Promise<boolean>;
  loginBroker(params: any): Promise<{ success: boolean; message: string }>;
  executeTrade(request: ExecutionRequest): Promise<ExecutionResult>;
  getAccountInfo(): Promise<any>;
  getOpenPositions?(): Promise<any[]>;
  // Additional methods like closeTrade, modifyStopLoss, etc. will go here later
}
