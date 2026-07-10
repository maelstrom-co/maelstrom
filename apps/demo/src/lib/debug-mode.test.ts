// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from 'vitest';
import { isDebugRequested } from './debug-mode';

function setSearch(search: string): void {
  window.history.replaceState(null, '', `/${search}`);
}

afterEach(() => {
  setSearch('');
});

describe('isDebugRequested', () => {
  it('is false with no query string', () => {
    setSearch('');
    expect(isDebugRequested()).toBe(false);
  });

  it('is true when the URL has a bare ?debug param', () => {
    setSearch('?debug');
    expect(isDebugRequested()).toBe(true);
  });

  it('is true when debug is set alongside other params', () => {
    setSearch('?foo=bar&debug=1');
    expect(isDebugRequested()).toBe(true);
  });

  it('is false for unrelated query params', () => {
    setSearch('?foo=bar');
    expect(isDebugRequested()).toBe(false);
  });
});
