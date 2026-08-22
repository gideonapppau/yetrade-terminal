import type { BrokerAdapter, ExecutionRequest, ExecutionResult, SymbolInfo, OpenPosition, PositionDeal } from './types';
import { logger } from '../logger';
import { MT5_BRIDGE_DEFAULT_URL, MIN_POSITION_SIZE_LOTS } from '../constants';
import { useSettingsStore } from '../../store/settings';

export class MT5Adapter implements BrokerAdapter {
  private baseUrl: string;
  /** Broker-exact symbol names keyed by the requested (uppercased) symbol. */
  private symbolCache = new Map<string, string>();

  name = 'MetaTrader 5 Bridge';

  constructor(baseUrl: string = MT5_BRIDGE_DEFAULT_URL) {
    this.baseUrl = baseUrl;
  }

  setBaseUrl(url: string) {
    if (url !== this.baseUrl) {
      // A different bridge means a different broker feed - drop stale mappings
      this.symbolCache.clear();
    }
    this.baseUrl = url;
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  /**
   * Resolve a signal symbol to the broker's exact instrument name.
   * Signal providers post e.g. "BTCUSD"/"BTCUSDM" while brokers expose
   * "BTCUSDm" / "XAUUSD.a"-style names, and MT5 matching is case-sensitive -
   * an unresolved symbol makes every order fail with "Symbol not found".
   */
  async resolveSymbol(symbol: string): Promise<string> {
    const key = symbol.trim().toUpperCase();
    if (!key) return symbol;

    const cached = this.symbolCache.get(key);
    if (cached) return cached;

    try {
      const response = await fetch(
        `${this.baseUrl}/symbols?query=${encodeURIComponent(key.slice(0, 6))}`
      );
      if (!response.ok) return symbol;
      const data = await response.json();
      const names: string[] = data.success ? data.symbols : [];
      if (!names.length) return symbol;

      const commit = (resolved: string) => {
        logger.info({ requested: symbol, resolved }, 'Resolved broker symbol');
        this.symbolCache.set(key, resolved);
        return resolved;
      };

      const exact = names.find((n) => n === symbol.trim() || n.toUpperCase() === key);
      if (exact) return commit(exact);

      const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');
      const target = norm(key);
      const candidates = names
        .filter((n) => norm(n).startsWith(target))
        .sort((a, b) => a.length - b.length);
      if (candidates.length > 0) {
        // Prefer the shortest match - closest to the base instrument
        return commit(candidates[0]);
      }

      return symbol;
    } catch (e) {
      logger.error({ err: e, symbol }, 'Broker symbol resolution failed');
      return symbol;
    }
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

      // Slippage tolerance (max deviation in points) comes from risk config;
      // floored at 1 since MT5 treats 0 as "no slippage allowed".
      const maxSlippagePoints = Math.max(
        1,
        Math.round(useSettingsStore.getState().riskConfig.maxSlippagePoints)
      );

      // Route to the broker's exact instrument name (case/suffix tolerant)
      const symbol = await this.resolveSymbol(request.signal.symbol);

      const response = await fetch(`${this.baseUrl}/trade/execute`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          symbol,
          action: request.signal.direction,
          volume: volume,
          sl: request.signal.stopLoss,
          tp: request.signal.takeProfits?.[0]?.price, // Use TP1
          deviation: maxSlippagePoints,
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

  async getOpenPositions(): Promise<OpenPosition[]> {
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
      const resolved = await this.resolveSymbol(symbol);
      const response = await fetch(`${this.baseUrl}/price?symbol=${encodeURIComponent(resolved)}`);
      if (!response.ok) return null;
      const data = await response.json();
      return data.success ? { ask: data.ask, bid: data.bid } : null;
    } catch (e) {
      logger.error({ err: e }, 'MT5 price fetch failed');
      return null;
    }
  }

  async getSymbolInfo(symbol: string): Promise<SymbolInfo | null> {
    try {
      const resolved = await this.resolveSymbol(symbol);
      const response = await fetch(`${this.baseUrl}/symbol_info?symbol=${encodeURIComponent(resolved)}`);
      if (!response.ok) return null;
      const data = await response.json();
      return data.success ? {
        trade_tick_value: data.trade_tick_value,
        trade_tick_size: data.trade_tick_size,
        trade_contract_size: data.trade_contract_size,
        volume_min: data.volume_min,
        volume_step: data.volume_step,
        point: data.point
      } : null;
    } catch (e) {
      logger.error({ err: e }, 'MT5 symbol info fetch failed');
      return null;
    }
  }

  async getDeals(positionTicket: string | number): Promise<PositionDeal[] | null> {
    try {
      const response = await fetch(`${this.baseUrl}/deals?position=${encodeURIComponent(String(positionTicket))}`);
      if (!response.ok) return null;
      const data = await response.json();
      return data.success ? data.deals : null;
    } catch (e) {
      logger.error({ err: e, positionTicket }, 'MT5 deals fetch failed');
      return null;
    }
  }

  async closeTrade(ticket: string | number): Promise<{ success: boolean; message: string }> {
    try {
      const response = await fetch(`${this.baseUrl}/trade/close`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticket: Number(ticket) }),
      });
      return await response.json();
    } catch (e) {
      logger.error({ err: e, ticket }, 'MT5 trade close failed');
      return { success: false, message: 'Bridge disconnected' };
    }
  }

  async modifyTrade(ticket: string | number, sl?: number, tp?: number): Promise<{ success: boolean; message: string }> {
    try {
      const response = await fetch(`${this.baseUrl}/trade/modify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticket: Number(ticket), sl, tp }),
      });
      return await response.json();
    } catch (e) {
      logger.error({ err: e, ticket }, 'MT5 trade modify failed');
      return { success: false, message: 'Bridge disconnected' };
    }
  }
}
