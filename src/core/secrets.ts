import { invoke } from '@tauri-apps/api/core';
import { logger } from './logger';

/** Secrets the Tauri backend allows into the OS credential store. */
export type SecretKey = 'telegram_session' | 'telegram_api_hash';

const inTauri = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/**
 * Reads a secret from the OS credential store. Outside Tauri (browser dev
 * mode) there is no store and secrets live only in memory for the session.
 */
export async function getSecret(key: SecretKey): Promise<string | null> {
  if (!inTauri()) return null;
  try {
    return (await invoke<string | null>('secret_get', { key })) ?? null;
  } catch (err) {
    logger.error({ err, key }, 'Failed to read secret');
    return null;
  }
}

/** Writes (or, for null/empty values, deletes) a secret. */
export async function setSecret(key: SecretKey, value: string | null | undefined): Promise<void> {
  if (!inTauri()) return;
  try {
    if (value) {
      await invoke('secret_set', { key, value });
    } else {
      await invoke('secret_delete', { key });
    }
  } catch (err) {
    logger.error({ err, key }, 'Failed to write secret');
  }
}
