import { useStore } from '@tanstack/react-store';
import { useCallback, useEffect, useRef, useState } from 'react';

import type { ActionExecution } from '@maelstrom-co/protocol-old';

import type { MaelstromContextPair } from './context.js';
import type {
  AnyVesselEntry,
  ExtractVesselByIdFromEntries,
  TypedVesselProps,
  VesselIds,
} from './vessel-entry-types.js';

const warnedOnce = new Set<string>();

function warnOnce(key: string, message: string) {
  if (!warnedOnce.has(key)) {
    warnedOnce.add(key);
    console.warn(message);
  }
}

/**
 * Factory that creates the m.useVessel() hook bound to a specific Maelstrom context.
 *
 * The returned hook:
 * - Returns null when the instance doesn't exist or belongs to a different vessel type
 * - Returns TypedVesselProps<V> with a correctly typed variantProps discriminated union
 * - executeAction triggers an immediate optimistic variant transition (if transitionsTo is set)
 *   then dispatches to registered action runners via CommandProcessor
 *
 * Note: transitionsTo is a field on VesselAction from @maelstrom-co/protocol-old,
 * read from the vessel definition in orchestrator.vesselManager.store.
 */
export function createUseVessel<const T extends readonly AnyVesselEntry[]>(
  contextPair: MaelstromContextPair,
) {
  const { useMaelstromContext } = contextPair;

  return function useVessel<Id extends VesselIds<T>>(
    vesselId: Id,
    instanceId: string,
  ): TypedVesselProps<ExtractVesselByIdFromEntries<T, Id>> | null {
    const { orchestrator, config } = useMaelstromContext();

    // Subscribe to this specific instance
    const instance = useStore(
      orchestrator.commandProcessor.store,
      (s) => s.instances.get(instanceId),
    );

    // Subscribe to the vessel definition for prop/action lookups
    const vessel = useStore(
      orchestrator.vesselManager.store,
      (s) => s.vessels.get(vesselId),
    );

    // Optimistic variant: overrides store variant immediately on executeAction.
    // Cleared when the store instance updates (engine responded).
    const [optimisticVariant, setOptimisticVariant] = useState<string | null>(null);

    // biome-ignore lint/correctness/useExhaustiveDependencies: intentional — clear optimistic state when the store instance changes (engine responded), not when optimisticVariant itself changes
    useEffect(() => {
      if (optimisticVariant !== null) setOptimisticVariant(null);
    }, [instance]);

    // Roll back optimistic variant when an action fails for this instance
    useEffect(() => {
      return orchestrator.commandProcessor.events.on('action_error', (event) => {
        if (event.instanceId === instanceId) {
          setOptimisticVariant(null);
        }
      });
    }, [orchestrator, instanceId]);

    // Refs for values read inside the stable executeAction callback
    const optimisticRef = useRef(optimisticVariant);
    optimisticRef.current = optimisticVariant;
    const instanceRef = useRef(instance);
    instanceRef.current = instance;

    const executeAction = useCallback(
      (name: string, params?: Record<string, unknown>) => {
        if (config.debug) {
          console.log(`[Maelstrom] executeAction: ${name}`, params);
        }

        // Optimistic transition: resolve from the active variant only
        if (vessel) {
          const currentVariant = optimisticRef.current ?? instanceRef.current?.variant;
          const variantDef = currentVariant ? vessel.variants[currentVariant] : null;
          const action = variantDef?.actions.find((a) => a.name === name);
          if (action?.transitionsTo) {
            if (vessel.variants[action.transitionsTo]) {
              setOptimisticVariant(action.transitionsTo);
            } else if (config.debug) {
              console.warn(
                `[Maelstrom] executeAction: "${name}" has transitionsTo "${action.transitionsTo}" but that variant does not exist on vessel "${vesselId}"`,
              );
            }
          }
        }

        // Dispatch to action runners (fire & forget).
        // TODO(MAE-88): roll back optimisticVariant on failure once executeActions returns a Promise
        orchestrator.commandProcessor.executeActions([
          {
            instanceId,
            action: name,
            ...(params && { params }),
          } as ActionExecution,
        ]);
      },
      [orchestrator, instanceId, vessel, config.debug],
    );

    // Guard: instance must exist and belong to the requested vessel type
    if (!instance) return null;
    if (instance.vesselId !== vesselId) {
      if (config.debug) {
        console.warn(
          `[Maelstrom] useVessel: instance "${instanceId}" belongs to vessel "${instance.vesselId}", not "${vesselId}"`,
        );
      }
      return null;
    }
    if (!vessel) {
      warnOnce(
        `vessel:${vesselId}`,
        `[Maelstrom] useVessel: vessel "${vesselId}" not found — was it registered with the Provider?`,
      );
      return null;
    }

    const currentVariant = optimisticVariant ?? instance.variant;
    const variantDef = vessel.variants[currentVariant];
    if (!variantDef) {
      warnOnce(
        `variant:${vesselId}:${currentVariant}`,
        `[Maelstrom] useVessel: variant "${currentVariant}" not found in vessel "${vesselId}" — protocol mismatch?`,
      );
      return null;
    }

    return {
      instanceId,
      variantProps: { variant: currentVariant, ...variantDef.props },
      executeAction,
    } as TypedVesselProps<ExtractVesselByIdFromEntries<T, Id>>;
  };
}
