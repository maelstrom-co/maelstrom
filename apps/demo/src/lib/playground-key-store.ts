import { Store } from '@tanstack/store';

export const STORAGE_KEY = 'maelstrom-playground-key';

export interface PlaygroundKeyState {
  readonly apiKey: string | null;
  /**
   * True only when `apiKey` actually made it into localStorage. A key can be
   * present here without this being true — a `remember: false` save, or a
   * `remember: true` save whose `localStorage.setItem` threw, both leave the
   * key in memory only — so UI copy claiming the key is "saved on this
   * device" must gate on this, not on `apiKey` alone.
   */
  readonly persisted: boolean;
}

// localStorage isn't just "undefined in some environments" — merely reading
// the property can throw (Chrome with third-party/all cookies blocked
// raises SecurityError; Safari private-mode raises QuotaExceededError on
// writes). This module runs at import time, so an unguarded throw here would
// take down the whole app bundle rather than degrading to in-memory-only key
// custody for the session.
function readInitialKey(): string | null {
  try {
    return typeof localStorage === 'undefined'
      ? null
      : localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

const initialKey = readInitialKey();

export const playgroundKeyStore = new Store<PlaygroundKeyState>({
  apiKey: initialKey,
  // The only source for an initial key is localStorage (there is no
  // in-memory state before this module has even finished evaluating), so a
  // non-null result here always means a persisted key.
  persisted: initialKey !== null,
});

export function setPlaygroundKey(apiKey: string, remember: boolean): void {
  if (!remember) {
    playgroundKeyStore.setState(() => ({ apiKey, persisted: false }));
    // A previous key may have been persisted under `remember: true` — clear
    // it, or readInitialKey() resurrects it on the next load even though the
    // visitor just asked for this key to be session-only.
    try {
      if (typeof localStorage !== 'undefined')
        localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Nothing further to do — the in-memory store already holds the
      // session-only key.
    }
    return;
  }
  let persisted = false;
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, apiKey);
      persisted = true;
    }
  } catch {
    // Storage unavailable or full — the key still lives in the in-memory
    // store for this session, which is the behavior a `remember: false` key
    // already gets. `persisted` stays false so the UI never claims a write
    // that didn't happen.
  }
  playgroundKeyStore.setState(() => ({ apiKey, persisted }));
}

export function clearPlaygroundKey(): void {
  playgroundKeyStore.setState(() => ({ apiKey: null, persisted: false }));
  try {
    if (typeof localStorage !== 'undefined')
      localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing further to do — the in-memory store is already cleared.
  }
}
