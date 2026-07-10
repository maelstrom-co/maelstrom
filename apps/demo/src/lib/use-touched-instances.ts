import { useEffect, useLayoutEffect, useRef, useState } from 'react';

/** How long a vessel stays flagged as "just changed" before the flash clears. */
export const DEFAULT_CLEAR_AFTER_MS = 1200;

const EMPTY_SET: ReadonlySet<string> = new Set();

interface TouchableInstance {
  readonly variant: string;
  readonly position: { readonly row: number; readonly column: number };
  readonly size: { readonly width: number; readonly height: number };
}

/** Minimal shape this hook needs from `orchestrator.commandProcessor.store` — kept narrow so tests can pass a fake store instead of a real Orchestrator. */
export interface InstancesStoreState {
  readonly instances: ReadonlyMap<string, TouchableInstance>;
}

export interface InstancesStoreLike {
  readonly state: InstancesStoreState;
  subscribe(listener: (value: InstancesStoreState) => void): { unsubscribe(): void };
}

function snapshotOf(instances: ReadonlyMap<string, TouchableInstance>): Map<string, TouchableInstance> {
  return new Map(instances);
}

function isSameShape(a: TouchableInstance, b: TouchableInstance): boolean {
  return (
    a.variant === b.variant &&
    a.position.row === b.position.row &&
    a.position.column === b.position.column &&
    a.size.width === b.size.width &&
    a.size.height === b.size.height
  );
}

function diff(
  prev: ReadonlyMap<string, TouchableInstance>,
  next: ReadonlyMap<string, TouchableInstance>,
): Set<string> {
  const changed = new Set<string>();
  for (const [id, nextInstance] of next) {
    const prevInstance = prev.get(id);
    if (!prevInstance || !isSameShape(prevInstance, nextInstance)) {
      changed.add(id);
    }
  }
  return changed;
}

/**
 * Tracks which instanceIds changed `{variant, position, size}` in the most
 * recent store settle, clearing back to empty ~`clearAfterMs` after each
 * change so the caller can drive a one-shot "the assistant just touched
 * this" flash. Diffs by value (not object identity) — the store re-notifies
 * on every command in a batch (status transitions, etc.), most of which
 * leave `instances` unchanged, so those notifications produce an empty
 * diff and are silently ignored rather than clobbering the reported set.
 */
export function useTouchedInstances(
  store: InstancesStoreLike,
  clearAfterMs = DEFAULT_CLEAR_AFTER_MS,
): ReadonlySet<string> {
  const [touched, setTouched] = useState<ReadonlySet<string>>(EMPTY_SET);
  const snapshotRef = useRef<Map<string, TouchableInstance> | null>(null);
  const clearTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    // Fresh baseline on (re)subscribe — a swapped store must not report its
    // entire initial instance set as "just touched".
    snapshotRef.current = snapshotOf(store.state.instances);

    const subscription = store.subscribe((next) => {
      const nextSnapshot = snapshotOf(next.instances);
      const prevSnapshot = snapshotRef.current ?? new Map();
      const changed = diff(prevSnapshot, nextSnapshot);
      snapshotRef.current = nextSnapshot;

      if (changed.size === 0) return;

      setTouched(changed);
      clearTimeout(clearTimerRef.current);
      clearTimerRef.current = setTimeout(() => setTouched(EMPTY_SET), clearAfterMs);
    });

    return () => {
      subscription.unsubscribe();
      clearTimeout(clearTimerRef.current);
    };
  }, [store, clearAfterMs]);

  return touched;
}

/**
 * Sets/removes a `data-flash` attribute directly on the `[data-instance-id]`
 * DOM wrappers Chart renders — a plain DOM attribute rather than React state
 * because those wrappers belong to Chart's own render tree, not this
 * component's. A layout effect (not a passive one) so the attribute lands
 * before paint, letting the CSS animation start on the same frame the
 * vessel's new content does.
 */
export function useFlashInstances(touchedIds: ReadonlySet<string>): void {
  const previousRef = useRef<ReadonlySet<string>>(EMPTY_SET);

  useLayoutEffect(() => {
    const previous = previousRef.current;

    for (const id of previous) {
      if (touchedIds.has(id)) continue;
      document.querySelector(`[data-instance-id="${id}"]`)?.removeAttribute('data-flash');
    }
    for (const id of touchedIds) {
      document.querySelector(`[data-instance-id="${id}"]`)?.setAttribute('data-flash', 'true');
    }

    previousRef.current = touchedIds;
  }, [touchedIds]);
}
