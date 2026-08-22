import type { BrokerAdapter, ExecutionRequest, ExecutionResult } from './types';
import { logger } from '../logger';
import { MT5_BRIDGE_DEFAULT_URL, MIN_POSITION_SIZE_LOTS } from '../constants';

export class MT5Adapter implements BrokerAdapter {
  private baseUrl: string;

  name = 'MetaTrader 5 Bridge';

  constructor(baseUrl: string = MT5_BRIDGE_DEFAULT_URL) {
    this.baseUrl = baseUrl;
  }

  setBaseUrl(url: string) {
    this.baseUrl = url;
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  async isConnected(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/health`);
      if (!response.ok) return false;
      const data = await response.json();
      return data.status === 'ok' && data.connected;
    } catch (e) {
      logger.error({ err: e }, 'MT5 bridge health check failed');
      return false;
    }
  }

  async loginBroker(params: { login?: string; password?: string; server?: string; path?: string }): Promise<{ success: boolean; message: string }> {
    try {
      const response = await fetch(`${this.baseUrl}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      });
      const data = await response.json();
      return { success: data.success, message: data.message };
    } catch (e: any) {
      logger.error({ err: e }, 'MT5 broker login failed');
      return { success: false, message: e.message };
    }
  }

  async executeTrade(request: ExecutionRequest): Promise<ExecutionResult> {
    try {
      // Fallback until the risk engine always supplies a computed size
      const volume = request.positionSize > 0 ? request.positionSize : MIN_POSITION_SIZE_LOTS;
      
      const response = await fetch(`${this.baseUrl}/trade/execute`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          symbol: request.signal.symbol,
          action: request.signal.direction,
          volume: volume,
          sl: request.signal.stopLoss,
          tp: request.signal.takeProfits?.[0]?.price, // Use TP1
        }),
      });

      const data = await response.json();
      if (!response.ok || !data.success) {
        return { success: false, message: data.message || 'Execution failed', executedAt: new Date() };
      }

      return { success: true, tradeId: data.ticket?.toString(), executedAt: new Date() };
    } catch (e: any) {
      logger.error({ err: e }, 'MT5 trade execution failed');
      return { success: false, message: e.message, executedAt: new Date() };
    }
  }

  async getAccountInfo(): Promise<{ balance: number; equity: number; currency: string; tradeMode?: number; server?: string; company?: string } | null> {
    try {
      const response = await fetch(`${this.baseUrl}/account`);
      if (!response.ok) return null;
      const data = await response.json();
      return {
        balance: data.balance,
        equity: data.equity,
        currency: data.currency,
        tradeMode: data.trade_mode,
        server: data.server,
        company: data.company
      };
    } catch (e) {
      logger.error({ err: e }, 'MT5 account info fetch failed');
      return null;
    }
  }

  async getOpenPositions(): Promise<any[]> {
    try {
      const response = await fetch(`${this.baseUrl}/positions`);
      if (!response.ok) return [];
      const data = await response.json();
      return data.success ? data.positions : [];
    } catch (e) {
      logger.error({ err: e }, 'MT5 positions fetch failed');
      return [];
    }
  }

  async getSymbolPrice(symbol: string): Promise<{ ask: number; bid: number } | null> {
    try {
      const response = await fetch(`${this.baseUrl}/price?symbol=${encodeURIComponent(symbol)}`);
      if (!response.ok) return null;
      const data = await response.json();
      return data.success ? { ask: data.ask, bid: data.bid } : null;
    } catch (e) {
      logger.error({ err: e }, 'MT5 price fetch failed');
      return null;
    }
  }
}
