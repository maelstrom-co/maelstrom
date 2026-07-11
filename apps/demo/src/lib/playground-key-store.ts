import { Store } from '@tanstack/store';

export const STORAGE_KEY = 'maelstrom-playground-key';

export interface PlaygroundKeyState {
  readonly apiKey: string | null;
}

// localStorage isn't just "undefined in some environments" — merely reading
// the property can throw (Chrome with third-party/all cookies blocked
// raises SecurityError; Safari private-mode raises QuotaExceededError on
// writes). This module runs at import time, so an unguarded throw here would
// take down the whole app bundle rather than degrading to in-memory-only key
// custody for the session.
function readInitialKey(): string | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export const playgroundKeyStore = new Store<PlaygroundKeyState>({
  apiKey: readInitialKey(),
});

export function setPlaygroundKey(apiKey: string, remember: boolean): void {
  playgroundKeyStore.setState(() => ({ apiKey }));
  if (!remember) return;
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, apiKey);
  } catch {
    // Storage unavailable or full — the key still lives in the in-memory
    // store for this session, which is the behavior a `remember: false` key
    // already gets.
  }
}

export function clearPlaygroundKey(): void {
  playgroundKeyStore.setState(() => ({ apiKey: null }));
  try {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing further to do — the in-memory store is already cleared.
  }
}
