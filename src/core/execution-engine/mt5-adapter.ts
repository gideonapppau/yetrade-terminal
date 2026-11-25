import type { BrokerAdapter, ExecutionRequest, ExecutionResult, SymbolInfo, OpenPosition, PositionDeal } from './types';
import { logger } from '../logger';
import { MT5_BRIDGE_DEFAULT_URL, BRIDGE_REQUEST_TIMEOUT_MS, MAX_ENTRY_DRIFT_R } from '../constants';
import { useSettingsStore } from '../../store/settings';
import { getBridgeToken, BRIDGE_TOKEN_HEADER } from '../bridge-auth';

export class MT5Adapter implements BrokerAdapter {
  private baseUrl: string;
  /** Broker-exact symbol names keyed by the requested (uppercased) symbol. */
  private symbolCache = new Map<string, string>();

  name = 'MetaTrader 5 Bridge';

  /**
   * MT5's "Algo Trading" switch as of the last health probe (null = unknown,
   * e.g. an older bridge). While false, the terminal refuses every order.
   */
  autoTradingEnabled: boolean | null = null;

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
   * Every bridge call goes through here: attaches the per-launch auth token
   * and bounds the wait so a hung bridge can never stall the signal pipeline.
   */
  private async request(path: string, init: RequestInit = {}): Promise<Response> {
    const token = await getBridgeToken();
    const headers = new Headers(init.headers);
    if (token) headers.set(BRIDGE_TOKEN_HEADER, token);
    return fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers,
      signal: init.signal ?? AbortSignal.timeout(BRIDGE_REQUEST_TIMEOUT_MS),
    });
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
      const response = await this.request(
        `/symbols?query=${encodeURIComponent(key.slice(0, 6))}`
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
        // Prefer the shortest match - closest to the base instrument - but
        // only when it is unique: "BTC" matching both BTCUSD and BTCEUR names
        // no single instrument, and guessing would trade the wrong market.
        const shortest = candidates.filter((n) => n.length === candidates[0].length);
        if (shortest.length > 1) {
          logger.warn({ requested: symbol, candidates: shortest }, 'Ambiguous broker symbol - not resolving');
          return symbol;
        }
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
      const response = await this.request(`/health`);
      if (!response.ok) return false;
      const data = await response.json();
      this.autoTradingEnabled = typeof data.trade_allowed === 'boolean' ? data.trade_allowed : null;
      return data.status === 'ok' && data.connected;
    } catch (e) {
      logger.error({ err: e }, 'MT5 bridge health check failed');
      return false;
    }
  }

  async loginBroker(params: { login?: string; password?: string; server?: string; path?: string }): Promise<{ success: boolean; message: string }> {
    try {
      const response = await this.request(`/login`, {
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
      // Never substitute a size: a missing/zero/NaN volume is a caller bug
      if (!(request.positionSize > 0) || !Number.isFinite(request.positionSize)) {
        return { success: false, message: `Invalid position size: ${request.positionSize}`, executedAt: new Date() };
      }
      const volume = request.positionSize;

      // Slippage tolerance (max deviation in points) comes from risk config;
      // floored at 1 since MT5 treats 0 as "no slippage allowed".
      const maxSlippagePoints = Math.max(
        1,
        Math.round(useSettingsStore.getState().riskConfig.maxSlippagePoints)
      );

      // Route to the broker's exact instrument name (case/suffix tolerant)
      const symbol = await this.resolveSymbol(request.signal.symbol);

      const response = await this.request(`/trade/execute`, {
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
          // Provider's posted entry lets the bridge re-anchor SL/TP to the
          // live market price at execution time (prevents invalid-stop rejections)
          entry: request.signal.entry ?? null,
          deviation: maxSlippagePoints,
          // Bridge refuses to re-anchor when price already ran this share of the stop
          maxEntryDriftR: MAX_ENTRY_DRIFT_R,
          // Lets the bridge dedupe retries (e.g. after a network timeout) so
          // the same signal leg can never open a second position.
          idempotencyKey: `${request.signalId}#${request.splitIndex ?? 0}`,
        }),
      });

      const data = await response.json();
      if (!response.ok || !data.success) {
        return { success: false, message: data.message || 'Execution failed', executedAt: new Date() };
      }

      return {
        success: true,
        tradeId: data.ticket?.toString(),
        entryPrice: typeof data.price === 'number' ? data.price : undefined,
        executedAt: new Date()
      };
    } catch (e: any) {
      logger.error({ err: e }, 'MT5 trade execution failed');
      return { success: false, message: e.message, executedAt: new Date() };
    }
  }

  async getAccountInfo(): Promise<{ balance: number; equity: number; currency: string; tradeMode?: number; server?: string; company?: string } | null> {
    try {
      const response = await this.request(`/account`);
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

  async getOpenPositions(): Promise<OpenPosition[] | null> {
    try {
      const response = await this.request(`/positions`);
      if (!response.ok) return null;
      const data = await response.json();
      return data.success && Array.isArray(data.positions) ? data.positions : null;
    } catch (e) {
      logger.error({ err: e }, 'MT5 positions fetch failed');
      return null;
    }
  }

  async getSymbolPrice(symbol: string): Promise<{ ask: number; bid: number } | null> {
    try {
      const resolved = await this.resolveSymbol(symbol);
      const response = await this.request(`/price?symbol=${encodeURIComponent(resolved)}`);
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
      const response = await this.request(`/symbol_info?symbol=${encodeURIComponent(resolved)}`);
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
      const response = await this.request(`/deals?position=${encodeURIComponent(String(positionTicket))}`);
      if (!response.ok) return null;
      const data = await response.json();
      return data.success ? data.deals : null;
    } catch (e) {
      logger.error({ err: e, positionTicket }, 'MT5 deals fetch failed');
      return null;
    }
  }

  async closeTrade(ticket: string | number, volume?: number): Promise<{ success: boolean; message: string }> {
    try {
      const response = await this.request(`/trade/close`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticket: Number(ticket), ...(volume != null ? { volume } : {}) }),
      });
      return await response.json();
    } catch (e) {
      logger.error({ err: e, ticket }, 'MT5 trade close failed');
      return { success: false, message: 'Bridge disconnected' };
    }
  }

  async modifyTrade(ticket: string | number, sl?: number, tp?: number): Promise<{ success: boolean; message: string }> {
    try {
      const response = await this.request(`/trade/modify`, {
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
