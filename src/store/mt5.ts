import { create } from 'zustand';
import { MT5Adapter } from '../core/execution-engine/mt5-adapter';
import { useSettingsStore } from './settings';
import { Command } from '@tauri-apps/plugin-shell';
import { logger } from '../core/logger';

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
  liveProfits: Record<string, number>;
  setLiveProfits: (profits: Record<string, number>) => void;
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
  liveProfits: {},

  setLiveProfits: (profits) => set({ liveProfits: profits }),

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
    const { adapter, syncAccountInfo, loginBroker } = get();

    let connected = await adapter.isConnected();

    if (!connected && useSettingsStore.getState().generalSettings.autoStartBridge) {
       connected = await tryStartBridge(adapter);
    }

    if (!connected) {
       // Attempt auto-login with saved credentials
       const settings = useSettingsStore.getState().executionSettings;
       if (settings.mt5Login && settings.mt5Password && settings.mt5Server) {
          try {
             const res = await loginBroker({
               login: settings.mt5Login,
               password: settings.mt5Password,
               server: settings.mt5Server,
               path: settings.mt5Path
             });
             connected = res.success;
          } catch (e) {
             logger.error({ err: e }, 'MT5 auto-login failed');
          }
       }
    }

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

  // Alias kept for existing callers; there is a single sync implementation.
  syncBalance: async () => {
    await get().syncAccountInfo();
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

/**
 * Spawns the local Python bridge and waits for it to bind. Tries both the
 * `python` and Windows `py` launchers since either may be missing on a given
 * machine. Returns true if the bridge becomes reachable afterwards.
 */
async function tryStartBridge(adapter: MT5Adapter): Promise<boolean> {
  const launchers = ['python', 'py'];
  for (const launcher of launchers) {
    try {
      logger.info({ launcher }, 'Attempting to auto-start Python Bridge...');
      const command = Command.create(launcher, ['python-bridge/main.py']);
      command.on('error', (error) => logger.error({ err: error, launcher }, 'Python bridge process error'));

      const child = await command.spawn();
      logger.info({ pid: child.pid, launcher }, 'Python bridge started');

      // Wait a moment for the server to bind
      await new Promise(resolve => setTimeout(resolve, 2000));
      if (await adapter.isConnected()) return true;
    } catch (err) {
      logger.warn({ err, launcher }, 'Failed to spawn Python bridge');
    }
  }
  return false;
}
