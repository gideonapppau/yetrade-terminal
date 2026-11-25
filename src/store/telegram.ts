import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ConnectionState, TelegramConfig } from '../core/telegram/types';
import type { TelegramAdapter } from '../core/telegram/client';
import type { TelegramService } from '../core/telegram/service';
import { getSecret, setSecret } from '../core/secrets';

/**
 * The MTProto session string grants full access to the Telegram account and
 * the api_hash is an app credential, so both live in the OS credential store.
 * Only non-secret fields reach localStorage.
 */
function persistSecrets(config: TelegramConfig | null) {
  void setSecret('telegram_session', config?.sessionString);
  void setSecret('telegram_api_hash', config?.apiHash);
}

/**
 * Restores secrets into the in-memory config after rehydration and migrates
 * any plaintext secrets left in localStorage by older versions.
 */
async function restoreSecrets(rehydrated: TelegramConfig | null) {
  if (!rehydrated) return;
  const hadPlaintext = !!(rehydrated.sessionString || rehydrated.apiHash);
  const [session, apiHash] = await Promise.all([
    getSecret('telegram_session'),
    getSecret('telegram_api_hash'),
  ]);
  const config: TelegramConfig = {
    ...rehydrated,
    apiHash: apiHash ?? rehydrated.apiHash ?? '',
    sessionString: session ?? rehydrated.sessionString,
  };
  if (hadPlaintext) persistSecrets(config);
  // Re-persisting through partialize also strips any legacy plaintext copy
  useTelegramStore.setState({ config });
}

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
      setConfig: (config) => {
        persistSecrets(config);
        set({ config });
      },
      setProfile: (profile) => set({ profile }),
      setClient: (client) => set({ client }),
      // Drops the live adapter (and its service) while keeping config/session,
      // so the auto-reconnect flow rebuilds it with the current credentials.
      clearClient: () => set({ client: null, service: null }),
      setService: (service) => set({ service }),
      logout: () => {
        persistSecrets(null);
        set({ connectionState: 'DISCONNECTED', config: null, profile: null, client: null, service: null });
      },
    }),
    {
      name: 'telegram-storage',
      partialize: (state) => ({
        // Secrets are deliberately omitted - see persistSecrets
        config: state.config ? { apiId: state.config.apiId } : null,
        profile: state.profile
      }),
      onRehydrateStorage: () => (state) => {
        if (state) {
          // Force reset connection state on boot to prevent getting stuck in CONNECTING
          state.setConnectionState('DISCONNECTED');
          void restoreSecrets(state.config);
        }
      }
    }
  )
);
