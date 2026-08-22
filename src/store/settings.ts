import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { RiskConfiguration } from '../core/risk-engine/types';
import { MT5_BRIDGE_DEFAULT_URL } from '../core/constants';

export interface GeneralSettings {
  displayLanguage: string;
  timezone: string;
  enableDesktopNotifications: boolean;
  soundAlerts: boolean;
  autoStartBridge: boolean;
}

export interface ExecutionSettings {
  bridgeUrl: string;
  mt5Login?: string;
  mt5Password?: string;
  mt5Server?: string;
  mt5Path?: string;
  twinTradingEnabled: boolean;
  maxTpsToSplit: string;
  riskDistribution: string;
  autoBreakEvenEnabled: boolean;
  autoBreakEvenTrigger: string;
  trailingStopEnabled: boolean;
  trailingStopTriggerPips: number;
  trailingStopDistancePips: number;
}

export interface TradingSettings {
  accountBalance: number;
  riskConfig: RiskConfiguration;
  generalSettings: GeneralSettings;
  executionSettings: ExecutionSettings;
}

interface SettingsState extends TradingSettings {
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
  },
  generalSettings: {
    displayLanguage: 'English (US)',
    timezone: 'UTC (Default)',
    enableDesktopNotifications: true,
    soundAlerts: true,
    autoStartBridge: false,
  },
  executionSettings: {
    bridgeUrl: MT5_BRIDGE_DEFAULT_URL,
    twinTradingEnabled: true,
    maxTpsToSplit: '2',
    riskDistribution: 'Equal (50/50)',
    autoBreakEvenEnabled: true,
    autoBreakEvenTrigger: 'When TP1 is hit',
    trailingStopEnabled: false,
    trailingStopTriggerPips: 30,
    trailingStopDistancePips: 15,
  }
};

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      ...DEFAULT_SETTINGS,
      tradingPaused: false,
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
    }
  )
);
