import { create } from 'zustand';
import { MT5Adapter } from '../core/execution-engine/mt5-adapter';
import { useSettingsStore } from './settings';

interface MT5State {
  isConnected: boolean;
  isConnecting: boolean;
  balance: number;
  equity: number;
  currency: string;
  /** MetaTrader ACCOUNT_TRADE_MODE: 0 = demo, 1 = contest, 2 = real */
  tradeMode: number | null;
  server: string | null;
  company: string | null;
  adapter: MT5Adapter;
  lastSync: Date | null;
  isInitializing: boolean;
  init: () => Promise<void>;
  syncAccountInfo: () => Promise<void>;
  syncBalance: () => Promise<void>;
  updateBridgeUrl: (url: string) => void;
  loginBroker: (params: { login?: string; password?: string; server?: string; path?: string }) => Promise<{ success: boolean; message: string }>;
}

const createAdapter = () =>
  new MT5Adapter(useSettingsStore.getState().executionSettings.bridgeUrl);

export const useMT5Store = create<MT5State>((set, get) => ({
  isConnected: false,
  isConnecting: false,
  balance: 0,
  equity: 0,
  currency: 'USD',
  tradeMode: null,
  server: null,
  company: null,
  adapter: createAdapter(),
  lastSync: null,
  isInitializing: false,

  updateBridgeUrl: (url) => {
    const trimmed = url.trim();
    if (!trimmed || trimmed === get().adapter.getBaseUrl()) return;
    useSettingsStore.getState().setExecutionSettings({ bridgeUrl: trimmed });
    get().adapter.setBaseUrl(trimmed);
    // Re-probe the new endpoint immediately
    get().init();
  },

  init: async () => {
    set({ isConnecting: true });
    const { adapter, syncAccountInfo } = get();
    
    const connected = await adapter.isConnected();
    if (connected) {
      set({ isConnected: true, isConnecting: false });
      await syncAccountInfo();
    } else {
      set({ isConnected: false, isConnecting: false });
    }
  },

  syncAccountInfo: async () => {
    const { adapter, isConnected } = get();
    if (!isConnected) return;

    const info = await adapter.getAccountInfo();
    if (info) {
      set({ 
        balance: info.balance, 
        equity: info.equity, 
        currency: info.currency,
        tradeMode: info.tradeMode ?? null,
        server: info.server ?? null,
        company: info.company ?? null,
        lastSync: new Date()
      });
    } else {
      // Failed to fetch info, might be disconnected
      const stillConnected = await adapter.isConnected();
      if (!stillConnected) {
        set({ isConnected: false });
      }
    }
  },

  syncBalance: async () => {
    try {
      const { adapter, isConnected } = get();
      if (!isConnected) return;

      const info = await adapter.getAccountInfo();
      if (info) {
        set({ 
          balance: info.balance, 
          equity: info.equity, 
          currency: info.currency,
          tradeMode: info.tradeMode ?? null,
          server: info.server ?? null,
          company: info.company ?? null,
          lastSync: new Date()
        });
      } else {
        // Failed to fetch info, might be disconnected
        const stillConnected = await adapter.isConnected();
        if (!stillConnected) {
          set({ isConnected: false });
        }
      }
    } catch (error) {
      console.error('Failed to sync MT5 balance:', error);
    }
  },

  loginBroker: async (params) => {
    const { adapter, syncBalance } = get();
    const result = await adapter.loginBroker(params);
    if (result.success) {
      set({ isConnected: true });
      await syncBalance();
    }
    return result;
  },
}));
