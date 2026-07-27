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
  /**
   * Command-processor batch status, when the caller's store exposes one
   * (the real `orchestrator.commandProcessor.store` always does). Used only
   * to detect an idle -> processing transition — the start of a fresh
   * command batch — so a still-lingering flash from a prior batch doesn't
   * carry forward into one that never touched it.
   */
  readonly status?: string;
}

export interface InstancesStoreLike {
  readonly state: InstancesStoreState;
  subscribe(listener: (value: InstancesStoreState) => void): {
    unsubscribe(): void;
  };
}

interface ExecutedAction {
  readonly instanceId: string;
}

interface ExecuteActionsCommandLike {
  readonly kind: string;
  readonly executionPlan?: readonly ExecutedAction[];
}

/** Minimal shape this hook needs from `orchestrator.commandProcessor.events` — kept narrow so tests can pass a fake emitter instead of a real CommandProcessor. */
export interface CommandEventsLike {
  on(
    event: 'command_complete',
    cb: (payload: { readonly command: ExecuteActionsCommandLike }) => void,
  ): () => void;
}

function snapshotOf(
  instances: ReadonlyMap<string, TouchableInstance>,
): Map<string, TouchableInstance> {
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
    // Entering vessels are deliberately excluded: the motion system already
    // gives them an enter animation, and the flash means "the assistant
    // changed something that was already on the board".
    if (prevInstance && !isSameShape(prevInstance, nextInstance)) {
      changed.add(id);
    }
  }
  return changed;
}

/**
 * Tracks which instanceIds changed `{variant, position, size}` — or were the
 * target of an executed action — in the most recent store settle, clearing
 * back to empty ~`clearAfterMs` after each change so the caller can drive a
 * one-shot "the assistant just touched this" flash. Diffs by value (not
 * object identity) — the store re-notifies on every command in a batch
 * (status transitions, etc.), most of which leave `instances` unchanged, so
 * those notifications produce an empty diff and are silently ignored rather
 * than clobbering the reported set.
 *
 * `events` (optional) covers content-only mutations: an executed action can
 * change a vessel's own data (e.g. add a calendar event) without touching
 * `{variant, position, size}` at all, which the shape diff alone would miss.
 * When provided, `command_complete` events for `execute_actions` commands
 * add their `executionPlan` instanceIds to the next settle's changed set —
 * still excluding instances that weren't already on the board, same as the
 * shape diff's "entering" rule.
 */
export function useTouchedInstances(
  store: InstancesStoreLike,
  clearAfterMs = DEFAULT_CLEAR_AFTER_MS,
  events?: CommandEventsLike,
): ReadonlySet<string> {
  const [touched, setTouched] = useState<ReadonlySet<string>>(EMPTY_SET);
  const snapshotRef = useRef<Map<string, TouchableInstance> | null>(null);
  const clearTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const pendingActionTargetsRef = useRef<Set<string>>(new Set());
  const statusRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    // Fresh baseline on (re)subscribe — a swapped store must not report its
    // entire initial instance set as "just touched".
    snapshotRef.current = snapshotOf(store.state.instances);
    pendingActionTargetsRef.current = new Set();
    statusRef.current = store.state.status;

    const subscription = store.subscribe((next) => {
      // A batch produces several notifications (status transitions, the
      // shape-changing one, the terminal empty-diff one that folds in a
      // pending action target) — union each into the accumulated set rather
      // than replacing it, or a later empty-diff notification would clobber
      // an earlier one's flash. The idle -> processing transition marks a
      // fresh batch starting, so any flash still lingering from a prior
      // batch (not yet cleared by the debounce timer below) is dropped
      // rather than carried into a batch that never touched it.
      const startingNewBatch =
        statusRef.current === 'idle' && next.status === 'processing';
      statusRef.current = next.status;

      const nextSnapshot = snapshotOf(next.instances);
      const prevSnapshot = snapshotRef.current ?? new Map();
      const changed = diff(prevSnapshot, nextSnapshot);

      for (const id of pendingActionTargetsRef.current) {
        if (prevSnapshot.has(id) && nextSnapshot.has(id)) changed.add(id);
      }
      pendingActionTargetsRef.current.clear();

      snapshotRef.current = nextSnapshot;

      if (changed.size === 0 && !startingNewBatch) return;

      setTouched((prev) => {
        const base = startingNewBatch ? EMPTY_SET : prev;
        return changed.size === 0 ? base : new Set([...base, ...changed]);
      });

      if (changed.size > 0) {
        clearTimeout(clearTimerRef.current);
        clearTimerRef.current = setTimeout(
          () => setTouched(EMPTY_SET),
          clearAfterMs,
        );
      }
    });

    const unsubscribeEvents = events?.on('command_complete', ({ command }) => {
      if (command.kind !== 'execute_actions' || !command.executionPlan) return;
      for (const { instanceId } of command.executionPlan) {
        pendingActionTargetsRef.current.add(instanceId);
      }
    });

    return () => {
      subscription.unsubscribe();
      unsubscribeEvents?.();
      clearTimeout(clearTimerRef.current);
    };
  }, [store, clearAfterMs, events]);

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
// Instance ids can be influenced by LLM output, so they must never be
// interpolated raw into a selector string — an id containing `"` or `]`
// (e.g. `foo"]bar`) produces an invalid selector and throws a SyntaxError.
// CSS.escape() neutralizes that for any spec-compliant selector engine; the
// try/catch is an extra backstop so a still-malformed selector can never
// crash the app, only skip that one flash.
function select(id: string): Element | null {
  try {
    return document.querySelector(`[data-instance-id="${CSS.escape(id)}"]`);
  } catch {
    return null;
  }
}

export function useFlashInstances(touchedIds: ReadonlySet<string>): void {
  const previousRef = useRef<ReadonlySet<string>>(EMPTY_SET);

  useLayoutEffect(() => {
    const previous = previousRef.current;

    for (const id of previous) {
      if (touchedIds.has(id)) continue;
      select(id)?.removeAttribute('data-flash');
    }
    for (const id of touchedIds) {
      select(id)?.setAttribute('data-flash', 'true');
    }

    previousRef.current = touchedIds;

    return () => {
      for (const id of touchedIds) {
        select(id)?.removeAttribute('data-flash');
      }
      previousRef.current = EMPTY_SET;
    };
  }, [touchedIds]);
}
