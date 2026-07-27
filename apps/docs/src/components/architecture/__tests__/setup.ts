import { afterEach } from 'bun:test';
import { cleanup } from '@testing-library/react';

// React 19 requires this flag for act()-based testing utilities.
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom does not implement matchMedia; components read it for prefers-reduced-motion.
// Default to "no preference" (motion allowed). Individual tests override as needed.
if (typeof window !== 'undefined' && !window.matchMedia) {
  (
    window as unknown as { matchMedia: (q: string) => MediaQueryList }
  ).matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
      dispatchEvent() {
        return false;
      },
    }) as unknown as MediaQueryList;
}

afterEach(() => {
  cleanup();
});
