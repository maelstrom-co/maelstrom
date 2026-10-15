// @vitest-environment happy-dom

import { cleanup, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  type DemoMaelstrom,
  DemoMaelstromProvider,
  useDemoMaelstrom,
} from './demo-maelstrom-context';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('useDemoMaelstrom', () => {
  it('throws a clear error outside a DemoMaelstromProvider', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => renderHook(() => useDemoMaelstrom())).toThrow(
      'useDemoMaelstrom() must be used inside a <DemoMaelstromProvider>.',
    );
  });

  it('returns the instance handed to the nearest provider', () => {
    const maelstrom = { Chart: () => null } as unknown as DemoMaelstrom;
    const wrapper = ({ children }: { children: ReactNode }) => (
      <DemoMaelstromProvider maelstrom={maelstrom}>
        {children}
      </DemoMaelstromProvider>
    );
    const { result } = renderHook(() => useDemoMaelstrom(), { wrapper });
    expect(result.current).toBe(maelstrom);
  });
});
