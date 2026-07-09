import { useCallback, useRef, useSyncExternalStore } from 'react';

const UNINITIALIZED = Symbol('useStoreSelector.uninitialized');

/** Callback takes no args — getSnapshot reads .state directly, not the subscriber value. */
interface Subscribable {
  subscribe: (cb: () => void) => { unsubscribe: () => void };
}

/**
 * Subscribes to one or more TanStack stores via `useSyncExternalStore`.
 * On each store notification, `buildSnapshot` composes a fresh value.
 * If `selector` is provided, it narrows the snapshot before returning.
 * Shallow equality prevents re-renders when the derived value hasn't changed.
 */
export function useStoreSelector<T>(stores: Subscribable[], buildSnapshot: () => T): T;
export function useStoreSelector<T, S>(stores: Subscribable[], buildSnapshot: () => T, selector: (snapshot: T) => S): S;
export function useStoreSelector<T, S>(
  stores: Subscribable[],
  buildSnapshot: () => T,
  selector: ((snapshot: T) => S) | undefined,
): T | S;
export function useStoreSelector<T, S>(
  stores: Subscribable[],
  buildSnapshot: () => T,
  selector?: (snapshot: T) => S,
): T | S {
  const selectorRef = useRef<((snapshot: T) => S) | undefined>(selector);
  selectorRef.current = selector;

  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const unsubs: Array<{ unsubscribe: () => void }> = [];
      try {
        for (const s of stores) {
          unsubs.push(s.subscribe(onStoreChange));
        }
      } catch (err) {
        unsubs.forEach((u) => {
          u.unsubscribe();
        });
        throw err;
      }
      return () => {
        unsubs.forEach((u) => {
          u.unsubscribe();
        });
      };
    },
    [stores],
  );

  // Sentinel distinguishes "no cached value yet" from a selector that returns undefined/null/false.
  const cachedRef = useRef<T | S | symbol>(UNINITIALIZED);

  // biome-ignore lint/correctness/useExhaustiveDependencies: buildSnapshot isn't listed on purpose — callers pass a fresh closure each render that proxies all reactive reads through refs, so an older captured buildSnapshot behaves identically to the latest one. `stores` (memoized per-orchestrator by the caller) is the real signal this callback must be recreated on, since buildSnapshot may otherwise close over a stale `orchestrator` captured on an earlier render.
  const getSnapshot = useCallback(() => {
    const snapshot = buildSnapshot();
    const sel = selectorRef.current;

    if (!sel) {
      if (cachedRef.current !== UNINITIALIZED && shallowEqual(cachedRef.current, snapshot)) {
        return cachedRef.current as T;
      }
      cachedRef.current = snapshot;
      return snapshot;
    }

    const selected = sel(snapshot);
    if (cachedRef.current !== UNINITIALIZED && shallowEqual(cachedRef.current, selected)) {
      return cachedRef.current as S;
    }
    cachedRef.current = selected;
    return selected;
  }, [stores]);

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

function shallowEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Object.getPrototypeOf(a) !== Object.prototype || Object.getPrototypeOf(b) !== Object.prototype) return false;
  const keysA = Object.keys(a as Record<string, unknown>);
  const keysB = Object.keys(b as Record<string, unknown>);
  if (keysA.length !== keysB.length) return false;
  for (const key of keysA) {
    if (!Object.is((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key])) return false;
  }
  return true;
}
