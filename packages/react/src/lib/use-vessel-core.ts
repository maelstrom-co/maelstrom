import type { ActionExecution } from '@maelstrom-co/protocol-old';
import { useStore } from '@tanstack/react-store';
import { useCallback, useMemo } from 'react';

import type { MaelstromContextPair } from './context.js';
import { useLatestRef } from './use-latest-ref.js';
import { useOptimisticVariant } from './use-optimistic-variant.js';
import { warnOnce } from './warn-once.js';

export interface VesselCoreResult {
  instanceId: string;
  vesselId: string;
  currentVariant: string;
  variantProps: Record<string, unknown>;
  executeAction: (name: string, params?: Record<string, unknown>) => void;
}

/**
 * Factory that creates a useVesselCore hook bound to a specific Maelstrom context.
 *
 * The returned hook subscribes to a vessel instance with optimistic transitions.
 * Used by useVessel, useInstance, and dynamic handle hooks.
 */
export function createUseVesselCore(contextPair: MaelstromContextPair) {
  const { useMaelstromContext } = contextPair;

  return function useVesselCore(
    vesselId: string | undefined,
    instanceId: string,
  ): VesselCoreResult | null {
    const { orchestrator, config } = useMaelstromContext();

    const instance = useStore(orchestrator.commandProcessor.store, (s) =>
      s.instances.get(instanceId),
    );

    const vessel = useStore(orchestrator.vesselManager.store, (s) =>
      vesselId ? s.vessels.get(vesselId) : undefined,
    );

    // Narrow the orchestrator's event bus into a stable subscribe function for useOptimisticVariant
    const onActionError = useMemo(
      () => (handler: () => void) =>
        orchestrator.commandProcessor.events.on('action_error', (event) => {
          if (event.instanceId === instanceId) handler();
        }),
      [orchestrator, instanceId],
    );

    const optimistic = useOptimisticVariant(instance, vessel, onActionError);

    const optimisticCurrentRef = useLatestRef(optimistic.current);
    const instanceRef = useLatestRef(instance);

    const executeAction = useCallback(
      (name: string, params?: Record<string, unknown>) => {
        if (config.debug) {
          console.log(`[Maelstrom] executeAction: ${name}`, params);
        }

        const applied = optimistic.applyTransition(name);

        // Warn when transitionsTo target doesn't exist (action has transitionsTo but transition wasn't applied)
        if (!applied && config.debug && vessel) {
          const currentVariant =
            optimisticCurrentRef.current ?? instanceRef.current?.variant;
          const variantDef = currentVariant
            ? vessel.variants[currentVariant]
            : null;
          const action = variantDef?.actions.find((a) => a.name === name);
          if (action?.transitionsTo) {
            console.warn(
              `[Maelstrom] executeAction: "${name}" has transitionsTo "${action.transitionsTo}" but that variant does not exist on vessel "${vesselId}"`,
            );
          }
        }

        orchestrator.commandProcessor.executeActions([
          {
            instanceId,
            action: name,
            ...(params && { params }),
          } as ActionExecution,
        ]);
      },
      [orchestrator, instanceId, optimistic.applyTransition, vessel, config.debug, vesselId, optimisticCurrentRef, instanceRef],
    );

    if (!instance) return null;
    if (!vessel) {
      warnOnce(
        `vessel:${vesselId}`,
        `[Maelstrom] useVesselCore: vessel "${vesselId}" not found — was it registered?`,
        { enabled: config.debug },
      );
      return null;
    }

    const currentVariant = optimistic.current ?? instance.variant;
    const variantDef = vessel.variants[currentVariant];
    if (!variantDef) {
      warnOnce(
        `variant:${vesselId}:${currentVariant}`,
        `[Maelstrom] useVesselCore: variant "${currentVariant}" not found on vessel "${vesselId}" — protocol mismatch?`,
        { enabled: config.debug },
      );
      return null;
    }

    return {
      instanceId,
      vesselId: instance.vesselId,
      currentVariant,
      variantProps: variantDef.props,
      executeAction,
    };
  };
}
