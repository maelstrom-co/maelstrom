// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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

  it('clearPlaygroundKey removes the key from state and localStorage', () => {
    setPlaygroundKey('sk-abc', true);
    clearPlaygroundKey();
    expect(playgroundKeyStore.state.apiKey).toBeNull();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });
});
