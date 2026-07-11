import { Store } from '@tanstack/store';

export const STORAGE_KEY = 'maelstrom-playground-key';

export interface PlaygroundKeyState {
  readonly apiKey: string | null;
}

function readInitialKey(): string | null {
  if (typeof localStorage === 'undefined') return null;
  return localStorage.getItem(STORAGE_KEY);
}

export const playgroundKeyStore = new Store<PlaygroundKeyState>({
  apiKey: readInitialKey(),
});

export function setPlaygroundKey(apiKey: string, remember: boolean): void {
  playgroundKeyStore.setState(() => ({ apiKey }));
  if (remember && typeof localStorage !== 'undefined') {
    localStorage.setItem(STORAGE_KEY, apiKey);
  }
}

export function clearPlaygroundKey(): void {
  playgroundKeyStore.setState(() => ({ apiKey: null }));
  if (typeof localStorage !== 'undefined') {
    localStorage.removeItem(STORAGE_KEY);
  }
}
