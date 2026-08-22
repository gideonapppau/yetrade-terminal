import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ConnectionState, TelegramConfig } from '../core/telegram/types';
import type { TelegramAdapter } from '../core/telegram/client';
import type { TelegramService } from '../core/telegram/service';

export interface TelegramProfile {
  firstName?: string;
  lastName?: string;
  username?: string;
  photoUrl?: string;
}

interface TelegramState {
  connectionState: ConnectionState;
  config: TelegramConfig | null;
  profile: TelegramProfile | null;
  client: TelegramAdapter | null;
  service: TelegramService | null;
  setConnectionState: (state: ConnectionState) => void;
  setConfig: (config: TelegramConfig) => void;
  setProfile: (profile: TelegramProfile) => void;
  setClient: (client: TelegramAdapter) => void;
  clearClient: () => void;
  setService: (service: TelegramService) => void;
  logout: () => void;
}

export const useTelegramStore = create<TelegramState>()(
  persist(
    (set) => ({
      connectionState: 'DISCONNECTED',
      config: null,
      profile: null,
      client: null,
      service: null,
      setConnectionState: (state) => set({ connectionState: state }),
      setConfig: (config) => set({ config }),
      setProfile: (profile) => set({ profile }),
      setClient: (client) => set({ client }),
      // Drops the live adapter (and its service) while keeping config/session,
      // so the auto-reconnect flow rebuilds it with the current credentials.
      clearClient: () => set({ client: null, service: null }),
      setService: (service) => set({ service }),
      logout: () => set({ connectionState: 'DISCONNECTED', config: null, profile: null, client: null, service: null }),
    }),
    {
      name: 'telegram-storage',
      partialize: (state) => ({ 
        config: state.config,
        profile: state.profile
      }),
      onRehydrateStorage: () => (state) => {
        if (state) {
          // Force reset connection state on boot to prevent getting stuck in CONNECTING
          state.setConnectionState('DISCONNECTED');
        }
      }
    }
  )
);
