import {
  InstanceId,
  type VariantName,
  VesselId,
} from '@maelstrom-co/protocol';
import { useStore } from '@tanstack/react-store';
import { useMemo } from 'react';

import { buildExecuteAction } from './build-execute-action.js';
import type { MaelstromContextPair } from './context.js';
import { warnOnce } from './warn-once.js';

export interface VesselCoreResult {
  instanceId: InstanceId;
  vesselId: VesselId;
  currentVariant: VariantName;
  variantProps: Record<string, unknown>;
  executeAction: (name: string, params?: Record<string, unknown>) => void;
}

/**
 * Factory that creates a useVesselCore hook bound to a specific Maelstrom context.
 *
 * The returned hook subscribes to a vessel instance from the client store.
 * Used by useVessel, useInstance, and dynamic handle hooks. Variant transitions
 * are owned by the client (see `Orchestrator.invokeAction`), so this hook simply
 * reflects the store's authoritative variant.
 */
export function createUseVesselCore(contextPair: MaelstromContextPair) {
  const { useMaelstromContext } = contextPair;

  return function useVesselCore(
    vesselId: string | undefined,
    instanceId: string,
  ): VesselCoreResult | null {
    const { orchestrator, config, onErrorRef } = useMaelstromContext();

    // Brand at the React seam, but only after validating non-emptiness: an
    // empty/whitespace id degrades to the not-found path below instead of
    // throwing during render. Real constructors (not casts) on valid input.
    const brandedInstanceId = instanceId.trim() ? InstanceId(instanceId) : null;

    const instance = useStore(orchestrator.commandProcessor.store, (s) =>
      brandedInstanceId ? s.instances.get(brandedInstanceId) : undefined,
    );

    const vessel = useStore(orchestrator.vesselManager.store, (s) =>
      vesselId?.trim() ? s.vessels.get(VesselId(vesselId)) : undefined,
    );

    const executeAction = useMemo(
      () =>
        brandedInstanceId
          ? buildExecuteAction(
              orchestrator,
              brandedInstanceId,
              config.debug,
              onErrorRef,
            )
          : () => {},
      [orchestrator, brandedInstanceId, config.debug, onErrorRef],
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

    const currentVariant = instance.variant;
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
      instanceId: instance.instanceId,
      vesselId: instance.vesselId,
      currentVariant,
      variantProps: variantDef.props,
      executeAction,
    };
  };
}
