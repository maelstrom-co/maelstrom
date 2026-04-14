import { afterEach, describe, expect, it } from 'bun:test';
import { cleanup, renderHook, act } from '@testing-library/react';
import { useStoreSelector } from './use-store-selector.js';

interface MockStore<T> {
  state: T;
  subscribe: (cb: () => void) => { unsubscribe: () => void };
  setState: (value: T) => void;
}

function createMockStore<T>(initial: T): MockStore<T> {
  const listeners = new Set<() => void>();
  return {
    state: initial,
    subscribe: (cb: () => void) => {
      listeners.add(cb);
      return { unsubscribe: () => listeners.delete(cb) };
    },
    setState(value: T) {
      this.state = value;
      listeners.forEach((cb) => cb());
    },
  };
}

afterEach(() => cleanup());

describe('useStoreSelector', () => {
  describe('snapshot (no selector)', () => {
    it('returns the built snapshot', () => {
      const store = createMockStore({ count: 0 });
      const stores = [store];

      const { result } = renderHook(() =>
        useStoreSelector(stores, () => ({ count: store.state.count })),
      );

      expect(result.current).toEqual({ count: 0 });
    });

    it('updates when a store fires', () => {
      const store = createMockStore({ count: 0 });
      const stores = [store];

      const { result } = renderHook(() =>
        useStoreSelector(stores, () => ({ count: store.state.count })),
      );

      act(() => store.setState({ count: 5 }));

      expect(result.current).toEqual({ count: 5 });
    });

    it('preserves reference identity when snapshot is shallow-equal', () => {
      const store = createMockStore({ count: 0, label: 'hello' });
      const stores = [store];

      const { result } = renderHook(() =>
        useStoreSelector(stores, () => ({
          count: store.state.count,
          label: store.state.label,
        })),
      );

      const first = result.current;

      act(() => store.setState({ count: 0, label: 'hello' }));

      expect(result.current).toBe(first);
    });
  });

  describe('selector', () => {
    it('returns the selected value', () => {
      const store = createMockStore({ count: 0, label: 'hello' });
      const stores = [store];

      const { result } = renderHook(() =>
        useStoreSelector(
          stores,
          () => ({ count: store.state.count, label: store.state.label }),
          (s) => s.count,
        ),
      );

      expect(result.current).toBe(0);
    });

    it('updates when the selected value changes', () => {
      const store = createMockStore({ count: 0, label: 'hello' });
      const stores = [store];

      const { result } = renderHook(() =>
        useStoreSelector(
          stores,
          () => ({ count: store.state.count, label: store.state.label }),
          (s) => s.count,
        ),
      );

      act(() => store.setState({ count: 3, label: 'hello' }));

      expect(result.current).toBe(3);
    });

    it('preserves reference identity when selected value is shallow-equal', () => {
      const store = createMockStore({ count: 0, label: 'hello' });
      const stores = [store];

      const { result } = renderHook(() =>
        useStoreSelector(
          stores,
          () => ({ count: store.state.count, label: store.state.label }),
          (s) => ({ count: s.count }),
        ),
      );

      const first = result.current;

      act(() => store.setState({ count: 0, label: 'changed' }));

      expect(result.current).toBe(first);
    });
  });

  describe('non-plain objects', () => {
    it('treats distinct Error instances as not equal', () => {
      const store = createMockStore({ error: new Error('first') as Error | null });
      const stores = [store];

      const { result } = renderHook(() =>
        useStoreSelector(
          stores,
          () => ({ error: store.state.error }),
          (s) => s.error,
        ),
      );

      expect(result.current).toBeInstanceOf(Error);
      expect(result.current!.message).toBe('first');

      act(() => store.setState({ error: new Error('second') }));

      expect(result.current).toBeInstanceOf(Error);
      expect(result.current!.message).toBe('second');
    });

    it('treats distinct Date instances as not equal', () => {
      const store = createMockStore({ ts: new Date('2026-01-01') as Date | null });
      const stores = [store];

      const { result } = renderHook(() =>
        useStoreSelector(stores, () => ({ ts: store.state.ts }), (s) => s.ts),
      );

      const first = result.current;

      act(() => store.setState({ ts: new Date('2026-06-15') }));

      expect(result.current).not.toBe(first);
      expect(result.current!.toISOString()).toContain('2026-06-15');
    });

    it('treats distinct Map instances as not equal', () => {
      const store = createMockStore({ data: new Map([['a', 1]]) });
      const stores = [store];

      const { result } = renderHook(() =>
        useStoreSelector(stores, () => ({ data: store.state.data }), (s) => s.data),
      );

      const first = result.current;

      act(() => store.setState({ data: new Map([['b', 2]]) }));

      expect(result.current).not.toBe(first);
      expect(result.current.get('b')).toBe(2);
    });

    it('treats distinct RegExp instances as not equal', () => {
      const store = createMockStore({ pattern: /abc/ as RegExp });
      const stores = [store];

      const { result } = renderHook(() =>
        useStoreSelector(stores, () => ({ pattern: store.state.pattern }), (s) => s.pattern),
      );

      const first = result.current;

      act(() => store.setState({ pattern: /xyz/ }));

      expect(result.current).not.toBe(first);
      expect(result.current.source).toBe('xyz');
    });
  });

  describe('falsy selector returns', () => {
    it('memoizes when selector returns undefined', () => {
      const store = createMockStore({ a: 1, b: undefined as string | undefined });
      const stores = [store];
      let renderCount = 0;

      renderHook(() => {
        useStoreSelector(
          stores,
          () => ({ a: store.state.a, b: store.state.b }),
          (s) => s.b,
        );
        renderCount++;
      });

      const countAfterMount = renderCount;

      act(() => store.setState({ a: 2, b: undefined }));

      expect(renderCount).toBe(countAfterMount);
    });

    it('memoizes when selector returns null', () => {
      const store = createMockStore({ a: 1, b: null as string | null });
      const stores = [store];
      let renderCount = 0;

      renderHook(() => {
        useStoreSelector(
          stores,
          () => ({ a: store.state.a, b: store.state.b }),
          (s) => s.b,
        );
        renderCount++;
      });

      const countAfterMount = renderCount;

      act(() => store.setState({ a: 2, b: null }));

      expect(renderCount).toBe(countAfterMount);
    });
  });

  describe('multiple stores', () => {
    it('reacts to changes from any subscribed store', () => {
      const storeA = createMockStore({ a: 1 });
      const storeB = createMockStore({ b: 2 });
      const stores = [storeA, storeB];

      const { result } = renderHook(() =>
        useStoreSelector(stores, () => ({
          a: storeA.state.a,
          b: storeB.state.b,
        })),
      );

      expect(result.current).toEqual({ a: 1, b: 2 });

      act(() => storeB.setState({ b: 99 }));

      expect(result.current).toEqual({ a: 1, b: 99 });
    });
  });
});
