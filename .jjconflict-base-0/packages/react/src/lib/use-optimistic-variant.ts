import type { VariantName, Vessel } from '@maelstrom-co/protocol';
import { useCallback, useEffect, useState } from 'react';

import { useLatestRef } from './use-latest-ref.js';

/** Unsubscribe function returned by event subscriptions */
type Unsubscribe = () => void;

export interface OptimisticVariantState {
  /** The optimistic variant override, or null when tracking the store */
  current: VariantName | null;
  /**
   * Apply an optimistic transition based on the action's transitionsTo.
   * Returns true if a transition was applied, false otherwise.
   */
  applyTransition: (actionName: string) => boolean;
}

/**
 * Manages optimistic variant state for a vessel instance.
 *
 * - Applies an immediate variant transition when an action has `transitionsTo`
 * - Clears the optimistic override when the store instance changes (engine responded)
 * - Rolls back on action failure via the provided `onActionError` subscription
 */
export function useOptimisticVariant(
  instance: { variant: VariantName } | undefined,
  vessel: Vessel | undefined,
  onActionError: (handler: () => void) => Unsubscribe,
  options: { timeoutMs?: number; debug?: boolean } = {},
): OptimisticVariantState {
  const { timeoutMs = 10_000, debug = false } = options;

  const [optimisticVariant, setOptimisticVariant] =
    useState<VariantName | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional — clear optimistic state when the store instance changes (engine responded)
  useEffect(() => {
    if (optimisticVariant !== null) setOptimisticVariant(null);
  }, [instance]);

  // Roll back optimistic variant on action failure
  useEffect(() => {
    return onActionError(() => setOptimisticVariant(null));
  }, [onActionError]);

  // Auto-clear optimistic state if engine never responds
  useEffect(() => {
    if (optimisticVariant === null || timeoutMs <= 0) return;

    const timeoutId = setTimeout(() => {
      if (debug) {
        console.warn(
          `[Maelstrom] useOptimisticVariant: optimistic state "${optimisticVariant}" timed out after ${timeoutMs}ms — engine did not respond. Rolling back.`,
        );
      }
      setOptimisticVariant(null);
    }, timeoutMs);

    return () => clearTimeout(timeoutId);
  }, [optimisticVariant, timeoutMs, debug]);

  const optimisticRef = useLatestRef(optimisticVariant);
  const instanceRef = useLatestRef(instance);

  const applyTransition = useCallback(
    (actionName: string): boolean => {
      if (!vessel) return false;

      const currentVariant =
        optimisticRef.current ?? instanceRef.current?.variant;
      const variantDef = currentVariant
        ? vessel.variants[currentVariant]
        : null;
      const action = variantDef?.actions.find((a) => a.name === actionName);
      if (action?.transitionsTo) {
        if (vessel.variants[action.transitionsTo]) {
          setOptimisticVariant(action.transitionsTo);
          return true;
        }
        // Target variant doesn't exist — caller is responsible for warning
        return false;
      }
      return false;
    },
    [vessel, optimisticRef, instanceRef],
  );

  return { current: optimisticVariant, applyTransition };
}
