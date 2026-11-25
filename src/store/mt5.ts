import { create } from 'zustand';
import { MT5Adapter } from '../core/execution-engine/mt5-adapter';
import { useSettingsStore } from './settings';
import { Command } from '@tauri-apps/plugin-shell';
import { logger } from '../core/logger';
import { toast } from 'sonner';
import { getBridgeToken } from '../core/bridge-auth';

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
  startHealthMonitor: () => void;
  stopHealthMonitor: () => void;
}

/** How often the bridge is probed for liveness. */
const HEALTH_POLL_INTERVAL_MS = 15_000;

/** Module-scoped so repeated calls cannot stack duplicate timers. */
let healthTimer: ReturnType<typeof setInterval> | null = null;
/** Timestamp of the last connect/disconnect transition we acted on. */
let lastHealthFlipAt = 0;
/** Ignore transitions within this window - unstable bridges would otherwise flip-flop toasts forever. */
const HEALTH_FLIP_COOLDOWN_MS = 30_000;

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

  /**
   * Probes the bridge on an interval so disconnects are surfaced the moment
   * they happen (not on the next failed trade) and recoveries re-sync state.
   * Fires only on transitions - never spams while a side stays down.
   */
  startHealthMonitor: () => {
    if (healthTimer) return;
    healthTimer = setInterval(async () => {
      const { adapter, isConnected, syncAccountInfo } = get();
      let alive: boolean;
      try {
        alive = await adapter.isConnected();
      } catch {
        alive = false;
      }
      if (alive === isConnected) return;

      // Flap protection: a bridge that flickers between reachable and not
      // must not fire connect/disconnect toasts on every poll.
      const now = Date.now();
      if (now - lastHealthFlipAt < HEALTH_FLIP_COOLDOWN_MS) {
        logger.debug({ alive }, 'Bridge state flip suppressed by cooldown');
        return;
      }
      lastHealthFlipAt = now;

      if (alive) {
        set({ isConnected: true, isConnecting: false });
        await syncAccountInfo();
        // Stable id: repeats replace the previous toast instead of stacking
        toast.success('MT5 bridge connected', { id: 'mt5-health' });
        logger.info('MT5 bridge recovered');
      } else {
        set({ isConnected: false });
        toast.error('MT5 bridge disconnected', {
          id: 'mt5-health',
          description: 'Open trades keep their broker-side SL/TP. Reconnect in Settings.',
        });
        logger.warn('MT5 bridge health check failed while connected');
      }
    }, HEALTH_POLL_INTERVAL_MS);
  },

  stopHealthMonitor: () => {
    if (healthTimer) {
      clearInterval(healthTimer);
      healthTimer = null;
    }
  },
}));

/**
 * Spawns the local Python bridge and waits for it to bind. Tries both the
 * `python` and Windows `py` launchers since either may be missing on a given
 * machine. The launcher is only advanced when spawning itself failed - once a
 * process is up we poll for readiness instead of spawning a duplicate that
 * would fight over the port.
 */
async function tryStartBridge(adapter: MT5Adapter): Promise<boolean> {
  const launchers = ['python', 'py'];
  const POLL_INTERVAL_MS = 500;
  const READY_TIMEOUT_MS = 10000;
  for (const launcher of launchers) {
    let spawned = false;
    try {
      logger.info({ launcher }, 'Attempting to auto-start Python Bridge...');
      // Hand the bridge the same per-launch secret the adapter sends
      const token = await getBridgeToken();
      const command = Command.create(launcher, ['python-bridge/main.py'], {
        env: token ? { BRIDGE_TOKEN: token } : {},
      });
      command.on('error', (error) => logger.error({ err: error, launcher }, 'Python bridge process error'));

      const child = await command.spawn();
      spawned = true;
      logger.info({ pid: child.pid, launcher }, 'Python bridge started');

      // Poll until the HTTP server binds (Flask startup can take a while)
      const deadline = Date.now() + READY_TIMEOUT_MS;
      while (Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
        if (await adapter.isConnected()) return true;
      }
      logger.warn({ launcher }, 'Python bridge did not become ready in time');
      return false;
    } catch (err) {
      logger.warn({ err, launcher }, 'Failed to spawn Python bridge');
      // Only fall through to the next launcher if we never got a process
      if (spawned) return false;
    }
  }
  return false;
}
