import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { RiskConfiguration } from '../core/risk-engine/types';
import { MT5_BRIDGE_DEFAULT_URL, DEFAULT_MAX_SIGNAL_AGE_SECONDS, DEFAULT_MAX_POSITION_SIZE_LOTS } from '../core/constants';

export interface GeneralSettings {
  displayLanguage: string;
  timezone: string;
  enableDesktopNotifications: boolean;
  soundAlerts: boolean;
  autoStartBridge: boolean;
  /**
   * Send trade reports (opened / not traded / closed) to the user's own
   * Telegram "Saved Messages". Optional so older persisted settings default on.
   */
  telegramTradeReports?: boolean;
}

/** A broker account the user has connected before. Its password lives in the OS credential store. */
export interface SavedMt5Account {
  login: string;
  server: string;
  path?: string;
  /** Broker company / account name from MT5, for display. */
  label?: string;
  /** User-chosen name, e.g. "Exness demo". */
  nickname?: string;
}

export interface ExecutionSettings {
  bridgeUrl: string;
  mt5Login?: string;
  /**
   * In-memory only - never persisted to localStorage. Saved passwords live in
   * the OS credential store (see core/secrets.ts, key mt5_password:<login>).
   */
  mt5Password?: string;
  mt5Server?: string;
  mt5Path?: string;
  twinTradingEnabled: boolean;
  maxTpsToSplit: string;
  riskDistribution: string;
  autoBreakEvenEnabled: boolean;
  /** Profit in pips required before SL is moved to entry. */
  autoBreakEvenTriggerPips: number;
  trailingStopEnabled: boolean;
  trailingStopTriggerPips: number;
  trailingStopDistancePips: number;
  /**
   * Instant-entry defaults for fast channels that post direction first and
   * levels later (see the per-channel instant_entry flag).
   */
  /** Provisional stop distance used to size and place the blind entry. */
  instantEntryStopPips: number;
  /** Provisional take-profit distance expressed as a multiple of risk (R). */
  instantTargetRR: number;
  /** How long after posting an edit/completion may arrive and be honored. */
  instantEditWindowSeconds: number;
  /** What happens to a provisional trade when no valid edit arrives in time. */
  instantExpiryAction: 'CLOSE' | 'KEEP';
  /**
   * Maximum age of a signal at evaluation time. Optional so persisted
   * settings predating it fall back to DEFAULT_MAX_SIGNAL_AGE_SECONDS.
   */
  maxSignalAgeSeconds?: number;
}

export interface TradingSettings {
  accountBalance: number;
  riskConfig: RiskConfiguration;
  generalSettings: GeneralSettings;
  executionSettings: ExecutionSettings;
}

interface SettingsState extends TradingSettings {
  /** Accounts connected before, for one-click switching. */
  savedMt5Accounts: SavedMt5Account[];
  upsertSavedMt5Account: (account: SavedMt5Account) => void;
  removeSavedMt5Account: (login: string) => void;
  /** Global kill-switch: when true, incoming signals are never executed. */
  tradingPaused: boolean;
  setAccountBalance: (balance: number) => void;
  setTradingPaused: (paused: boolean) => void;
  setRiskConfig: (config: Partial<RiskConfiguration>) => void;
  setGeneralSettings: (settings: Partial<GeneralSettings>) => void;
  setExecutionSettings: (settings: Partial<ExecutionSettings>) => void;
  resetSettings: () => void;
}

export const DEFAULT_SETTINGS: TradingSettings = {
  accountBalance: 10000,
  riskConfig: {
    riskPerTradePercent: 1.0,
    maxDailyLossPercent: 3.0,
    maxDrawdownPercent: 10.0,
    maxOpenTradeGroups: 5,
    minRR: 1.5,
    maxOpenRiskPercent: 5.0,
    maxSlippagePoints: 30,
    newsFilterEnabled: false,
    // Never round sub-minimum sizes UP (that risks more than configured).
    // Users on tiny accounts can opt into the legacy round-up on the Risk page.
    rejectBelowMinVolume: true,
    maxPositionSizeLots: DEFAULT_MAX_POSITION_SIZE_LOTS,
  },
  generalSettings: {
    displayLanguage: 'English (US)',
    timezone: 'UTC (Default)',
    enableDesktopNotifications: true,
    soundAlerts: true,
    autoStartBridge: false,
    telegramTradeReports: true,
  },
  executionSettings: {
    bridgeUrl: MT5_BRIDGE_DEFAULT_URL,
    twinTradingEnabled: true,
    maxTpsToSplit: '2',
    riskDistribution: 'Equal (50/50)',
    autoBreakEvenEnabled: true,
    autoBreakEvenTriggerPips: 100,
    trailingStopEnabled: false,
    trailingStopTriggerPips: 30,
    trailingStopDistancePips: 15,
    instantEntryStopPips: 200,
    instantTargetRR: 2,
    instantEditWindowSeconds: 60,
    instantExpiryAction: 'CLOSE',
    maxSignalAgeSeconds: DEFAULT_MAX_SIGNAL_AGE_SECONDS,
  }
};

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      ...DEFAULT_SETTINGS,
      tradingPaused: false,
      savedMt5Accounts: [],
      upsertSavedMt5Account: (account) =>
        set((state) => ({
          savedMt5Accounts: [
            account,
            ...state.savedMt5Accounts.filter((a) => a.login !== account.login),
          ],
        })),
      removeSavedMt5Account: (login) =>
        set((state) => ({ savedMt5Accounts: state.savedMt5Accounts.filter((a) => a.login !== login) })),
      setAccountBalance: (balance) => set({ accountBalance: balance }),
      setTradingPaused: (paused) => set({ tradingPaused: paused }),
      setRiskConfig: (config) =>
        set((state) => ({ riskConfig: { ...state.riskConfig, ...config } })),
      setGeneralSettings: (settings) => 
        set((state) => ({ generalSettings: { ...state.generalSettings, ...settings } })),
      setExecutionSettings: (settings) => 
        set((state) => ({ executionSettings: { ...state.executionSettings, ...settings } })),
      resetSettings: () => set({ ...DEFAULT_SETTINGS }),
    }),
    {
      name: 'trading-settings',
      // Never persist the broker password to disk.
      partialize: (state) => {
        // Session-only secret: dropped from the persisted snapshot.
        const { mt5Password: _mt5Password, ...executionSettings } = state.executionSettings;
        return {
          // A paused terminal must stay paused across crashes and autostart
          tradingPaused: state.tradingPaused,
          savedMt5Accounts: state.savedMt5Accounts,
          accountBalance: state.accountBalance,
          riskConfig: state.riskConfig,
          generalSettings: state.generalSettings,
          executionSettings,
        };
      },
    }
  )
);
