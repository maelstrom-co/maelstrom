import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import type { MotionRect } from './flip.js';
import { EXIT_CLEANUP_BUFFER_MS, motionSuppressed } from './motion-config.js';
import type { ResolvedChartMotionConfig } from './motion-config.js';

export interface ExitingEntry<T> {
  readonly id: string;
  readonly item: T;
  readonly rect: MotionRect;
}

// `current`/`measureRect` are read through refs updated every render so the
// effect can key on `signature` alone (mirroring useChartMotion's
// layoutSignature contract) without either re-firing on every render for
// callers that build `current` inline, or closing over stale values.
export function useExitingInstances<T>(
  current: ReadonlyArray<readonly [string, T]>,
  measureRect: (id: string) => MotionRect | null,
  motion: ResolvedChartMotionConfig,
  signature: string,
): ReadonlyArray<ExitingEntry<T>> {
  const [entries, setEntries] = useState<ReadonlyArray<ExitingEntry<T>>>([]);
  const prevItemsRef = useRef<Map<string, T>>(new Map());
  const lastRectsRef = useRef<Map<string, MotionRect>>(new Map());
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const currentRef = useRef(current);
  currentRef.current = current;
  const measureRectRef = useRef(measureRect);
  measureRectRef.current = measureRect;

  // Refreshed every render (no dep array) so a future exit always carries the
  // latest variant/props, even when `signature` — which excludes item data —
  // is unchanged between the change and the eventual removal.
  useEffect(() => {
    prevItemsRef.current = new Map(current);
  });

  // Clear timers on unmount only -- the main effect below re-runs on every
  // pass and must NOT sweep timers that are still counting down for entries
  // that survived across passes.
  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    };
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: signature is a deliberate re-run trigger, not read in the body — current/measureRect come from refs by design (see the comment above the hook), and signature's identity (layoutKey@sizeKey) is what must gate re-detection.
  useLayoutEffect(() => {
    const current = currentRef.current;
    const measureRect = measureRectRef.current;

    if (motionSuppressed(motion)) {
      // Deliberately do NOT reset lastRectsRef here: an id that disappears on
      // the first active pass after unsuppression has no live node to
      // measure, so the pre-suppression snapshot is its only rect.
      for (const timer of timersRef.current.values()) clearTimeout(timer);
      timersRef.current.clear();
      prevItemsRef.current = new Map(current);
      setEntries((prev) => (prev.length > 0 ? [] : prev));
      return;
    }

    const currentIds = new Set(current.map(([id]) => id));

    // A re-added id cancels its own pending exit.
    const reAppeared = new Set<string>();
    for (const id of currentIds) {
      const timer = timersRef.current.get(id);
      if (timer) {
        clearTimeout(timer);
        timersRef.current.delete(id);
        reAppeared.add(id);
      }
    }

    // An id present last pass but absent now starts exiting, carrying the
    // last rect snapshotted for it (measureRect is the live fallback for the
    // rare case nothing was snapshotted, e.g. it entered and exited within
    // the same pass).
    const newlyExiting: ExitingEntry<T>[] = [];
    for (const [id, item] of prevItemsRef.current) {
      if (currentIds.has(id)) continue;
      const rect = lastRectsRef.current.get(id) ?? measureRect(id);
      if (!rect) continue;
      newlyExiting.push({ id, item, rect });
    }

    if (reAppeared.size > 0 || newlyExiting.length > 0) {
      setEntries((prev) => {
        const withoutReAppeared = reAppeared.size > 0 ? prev.filter((entry) => !reAppeared.has(entry.id)) : prev;
        return newlyExiting.length > 0 ? [...withoutReAppeared, ...newlyExiting] : withoutReAppeared;
      });

      for (const entry of newlyExiting) {
        const timer = setTimeout(() => {
          timersRef.current.delete(entry.id);
          setEntries((prev) => prev.filter((e) => e.id !== entry.id));
        }, motion.durationMs + EXIT_CLEANUP_BUFFER_MS);
        timersRef.current.set(entry.id, timer);
      }
    }

    const nextRects = new Map<string, MotionRect>();
    for (const id of currentIds) {
      const rect = measureRect(id);
      if (rect) nextRects.set(id, rect);
    }
    lastRectsRef.current = nextRects;
    prevItemsRef.current = new Map(current);
  }, [signature, motion]);

  return entries;
}
