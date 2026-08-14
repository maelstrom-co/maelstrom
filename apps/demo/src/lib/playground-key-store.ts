import { Store } from '@tanstack/store';

const LEGACY_STORAGE_KEY = 'maelstrom-playground-key';

export interface PlaygroundKeyState {
  readonly apiKey: string | null;
}

/**
 * Removes keys persisted by earlier demo versions. New keys live only in the
 * module-scoped store, but leaving an old plaintext key behind would preserve
 * the risk that removing persistence is meant to eliminate.
 */
function removeLegacyPersistedKey(): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(LEGACY_STORAGE_KEY);
    }
  } catch {
    // Storage can be unavailable in restricted browser contexts. The current
    // session still remains memory-only because this module never reads it.
  }
}

function removeLegacyKeyWrittenByAnotherTab(event: StorageEvent): void {
  if (event.key === LEGACY_STORAGE_KEY && event.newValue !== null) {
    removeLegacyPersistedKey();
  }
}

removeLegacyPersistedKey();
// A tab still running the previous bundle can write the key back after this
// bundle's startup cleanup. Storage events fire in the other same-origin tabs,
// so any current tab removes that late legacy write immediately.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', removeLegacyKeyWrittenByAnotherTab);
}

export const playgroundKeyStore = new Store<PlaygroundKeyState>({
  apiKey: null,
});

export function setPlaygroundKey(apiKey: string): void {
  playgroundKeyStore.setState(() => ({ apiKey }));
}

export function clearPlaygroundKey(): void {
  playgroundKeyStore.setState(() => ({ apiKey: null }));
  removeLegacyPersistedKey();
}
