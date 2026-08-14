// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearPlaygroundKey,
  playgroundKeyStore,
  setPlaygroundKey,
} from './playground-key-store';

const LEGACY_STORAGE_KEY = 'maelstrom-playground-key';

describe('playgroundKeyStore', () => {
  beforeEach(() => {
    localStorage.clear();
    clearPlaygroundKey();
  });

  afterEach(() => {
    localStorage.clear();
    clearPlaygroundKey();
  });

  it('keeps the key in memory without writing browser storage', () => {
    setPlaygroundKey('sk-abc');

    expect(playgroundKeyStore.state.apiKey).toBe('sk-abc');
    expect(localStorage.getItem(LEGACY_STORAGE_KEY)).toBeNull();
  });

  it('clearPlaygroundKey removes the in-memory key', () => {
    setPlaygroundKey('sk-abc');
    clearPlaygroundKey();

    expect(playgroundKeyStore.state.apiKey).toBeNull();
  });
});

describe('legacy persisted key cleanup', () => {
  afterEach(() => {
    localStorage.clear();
    vi.resetModules();
  });

  it('deletes keys saved by earlier releases instead of restoring them', async () => {
    localStorage.setItem(LEGACY_STORAGE_KEY, 'sk-preexisting');
    vi.resetModules();

    const fresh = await import('./playground-key-store');

    expect(fresh.playgroundKeyStore.state.apiKey).toBeNull();
    expect(localStorage.getItem(LEGACY_STORAGE_KEY)).toBeNull();
  });

  it('deletes a legacy key written later by a tab running the old bundle', async () => {
    vi.resetModules();
    await import('./playground-key-store');
    localStorage.setItem(LEGACY_STORAGE_KEY, 'sk-old-tab');

    window.dispatchEvent(
      new StorageEvent('storage', {
        key: LEGACY_STORAGE_KEY,
        newValue: 'sk-old-tab',
      }),
    );

    expect(localStorage.getItem(LEGACY_STORAGE_KEY)).toBeNull();
  });

  it('still starts keyless when browser storage access is blocked', async () => {
    const original = Object.getOwnPropertyDescriptor(
      globalThis,
      'localStorage',
    );
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('blocked', 'SecurityError');
      },
    });
    vi.resetModules();

    try {
      const fresh = await import('./playground-key-store');
      expect(fresh.playgroundKeyStore.state.apiKey).toBeNull();
    } finally {
      if (original) Object.defineProperty(globalThis, 'localStorage', original);
      vi.resetModules();
    }
  });
});
