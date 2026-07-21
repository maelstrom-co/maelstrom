// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearPlaygroundKey,
  playgroundKeyStore,
  setPlaygroundKey,
  STORAGE_KEY,
} from './playground-key-store';

describe('playgroundKeyStore', () => {
  beforeEach(() => {
    localStorage.clear();
    clearPlaygroundKey();
  });
  afterEach(() => {
    localStorage.clear();
  });

  it('starts with no key when localStorage is empty', () => {
    expect(playgroundKeyStore.state.apiKey).toBeNull();
  });

  it('setPlaygroundKey updates the store state', () => {
    setPlaygroundKey('sk-abc', false);
    expect(playgroundKeyStore.state.apiKey).toBe('sk-abc');
  });

  it('setPlaygroundKey persists to localStorage only when remember is true', () => {
    setPlaygroundKey('sk-abc', true);
    expect(localStorage.getItem(STORAGE_KEY)).toBe('sk-abc');

    clearPlaygroundKey();
    setPlaygroundKey('sk-def', false);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('setPlaygroundKey with remember:false removes a PREVIOUSLY persisted key instead of resurrecting it next load', () => {
    setPlaygroundKey('sk-remembered', true);
    expect(localStorage.getItem(STORAGE_KEY)).toBe('sk-remembered');

    setPlaygroundKey('sk-session-only', false);

    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(playgroundKeyStore.state.apiKey).toBe('sk-session-only');
  });

  it('clearPlaygroundKey removes the key from state and localStorage', () => {
    setPlaygroundKey('sk-abc', true);
    clearPlaygroundKey();
    expect(playgroundKeyStore.state.apiKey).toBeNull();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('setPlaygroundKey still updates state when localStorage.setItem throws', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    try {
      expect(() => setPlaygroundKey('sk-abc', true)).not.toThrow();
      expect(playgroundKeyStore.state.apiKey).toBe('sk-abc');
    } finally {
      spy.mockRestore();
    }
  });

  it('clearPlaygroundKey still clears state when localStorage.removeItem throws', () => {
    setPlaygroundKey('sk-abc', true);
    const spy = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    try {
      expect(() => clearPlaygroundKey()).not.toThrow();
      expect(playgroundKeyStore.state.apiKey).toBeNull();
    } finally {
      spy.mockRestore();
    }
  });
});

describe('module init when localStorage access throws', () => {
  it('starts with no key instead of crashing the module', async () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
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
