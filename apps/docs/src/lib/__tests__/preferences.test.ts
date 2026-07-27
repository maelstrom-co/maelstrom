import { beforeEach, describe, expect, it } from 'bun:test';
import { safeGetItem, safeSetItem } from '../preferences';

describe('safeGetItem', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns the stored value', () => {
    localStorage.setItem('test-key', 'test-value');
    expect(safeGetItem('test-key')).toBe('test-value');
  });

  it('returns null for missing keys', () => {
    expect(safeGetItem('nonexistent')).toBeNull();
  });

  it('returns null when localStorage throws', () => {
    const original = Storage.prototype.getItem;
    Storage.prototype.getItem = () => {
      throw new Error('storage unavailable');
    };
    expect(safeGetItem('any')).toBeNull();
    Storage.prototype.getItem = original;
  });
});

describe('safeSetItem', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('writes the value to localStorage', () => {
    safeSetItem('test-key', 'test-value');
    expect(localStorage.getItem('test-key')).toBe('test-value');
  });

  it('does not throw when localStorage throws', () => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw new Error('storage unavailable');
    };
    expect(() => safeSetItem('any', 'val')).not.toThrow();
    Storage.prototype.setItem = original;
  });
});
