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
    expect(playgroundKeyStore.state.persisted).toBe(false);
  });

  it('marks persisted:true only for a remember:true save, so UI copy can tell "saved on this device" apart from "this session only"', () => {
    setPlaygroundKey('sk-session-only', false);
    expect(playgroundKeyStore.state.persisted).toBe(false);

    setPlaygroundKey('sk-remembered', true);
    expect(playgroundKeyStore.state.persisted).toBe(true);
  });

  it('setPlaygroundKey still updates state when localStorage.setItem throws', () => {
    // Spies on the instance, not Storage.prototype: happy-dom lazily
    // memoizes an own `setItem` property on `localStorage` the first time
    // it's actually called (already happened in the tests above), which
    // would silently shadow a prototype-level spy from here on and make
    // this throw path untestable.
    const spy = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    try {
      expect(() => setPlaygroundKey('sk-abc', true)).not.toThrow();
      expect(playgroundKeyStore.state.apiKey).toBe('sk-abc');
      // remember:true asked for persistence, but the write actually failed —
      // persisted must reflect what happened, not the caller's intent, or
      // the UI would tell a visitor their key is "saved on this device" when
      // it never touched storage.
      expect(playgroundKeyStore.state.persisted).toBe(false);
    } finally {
      spy.mockRestore();
    }
  });

  it('clearPlaygroundKey still clears state when localStorage.removeItem throws', () => {
    setPlaygroundKey('sk-abc', true);
    // Spies on the instance, not Storage.prototype: happy-dom lazily
    // memoizes an own `removeItem` property on `localStorage` the first
    // time it's actually called (already happened above, and in any test
    // that ran earlier in this file), which would silently shadow a
    // prototype-level spy from here on.
    const spy = vi.spyOn(localStorage, 'removeItem').mockImplementation(() => {
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

describe('module init when localStorage already holds a key', () => {
  it('starts with persisted:true for a key that was already in localStorage at import time', async () => {
    // The returning-visitor path (the flip side of the throw/blocked case
    // above): a key that was genuinely persisted on a previous visit must
    // read back as persisted, or the drawer would wrongly tell a returning
    // visitor their key is session-only.
    localStorage.setItem(STORAGE_KEY, 'sk-preexisting');
    vi.resetModules();
    try {
      const fresh = await import('./playground-key-store');
      expect(fresh.playgroundKeyStore.state.apiKey).toBe('sk-preexisting');
      expect(fresh.playgroundKeyStore.state.persisted).toBe(true);
    } finally {
      vi.resetModules();
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
