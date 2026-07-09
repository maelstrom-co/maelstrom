import type { ActionRunner } from '@maelstrom-co/client';
import type { VesselDefinition, VesselId } from '@maelstrom-co/protocol';
import { InstanceId } from '@maelstrom-co/protocol';
import { type ComponentType, lazy, useEffect } from 'react';

import type { MaelstromContextPair, MaelstromContextValue } from './context.js';
import type { DynamicVesselHandle } from './dynamic-vessel-types.js';
import { createUseVesselCore } from './use-vessel-core.js';
import { warnOnce } from './warn-once.js';
import type { AnyVesselEntry, TypedVesselProps } from './vessel-entry-types.js';
import { isLazyEntry } from './vessel-entry-types.js';

/**
 * Factory that creates m.registerVessel() bound to a specific Maelstrom context.
 *
 * registerVessel is a plain function (not a hook). It reads the current context from a mutable ref
 * that the Provider keeps in sync. On success it registers the vessel with the orchestrator
 * and adds the component to the UI registries. Throws if the vessel fails validation.
 */
export function createRegisterVessel(contextPair: MaelstromContextPair) {
  const { contextRef, useMaelstromContext } = contextPair;
  const useVesselCore = createUseVesselCore(contextPair);

  return function registerVessel<V extends VesselDefinition>(
    entry: AnyVesselEntry<V>,
  ): DynamicVesselHandle<V> {
    const ctx = getContext(contextRef);
    const vesselId = entry.vessel.id as VesselId;

    if (ctx.componentRegistry.has(vesselId)) {
      warnOnce(
        `registerVessel:overwrite:${vesselId}`,
        `[Maelstrom] registerVessel: vessel "${vesselId}" is already registered. Overwriting.`,
      );
    }

    const result = ctx.orchestrator.vesselManager.registerVessel(entry.vessel);
    if (!result.valid) {
      const messages = result.issues.map((i) => i.message).join(', ');
      throw new Error(
        `[Maelstrom] registerVessel: vessel "${vesselId}" failed validation: ${messages}`,
      );
    }

    addToRegistries(ctx, entry);
    return buildHandle<V>(vesselId);
  };

  function buildHandle<V extends VesselDefinition>(
    vesselId: VesselId,
  ): DynamicVesselHandle<V> {
    return {
      useVessel(instanceId: string): TypedVesselProps<V> | null {
        const core = useVesselCore(vesselId, instanceId);

        if (!core) return null;
        if (core.vesselId !== vesselId) {
          warnOnce(
            `handle:mismatch:${instanceId}`,
            `[Maelstrom] handle.useVessel: instance "${instanceId}" belongs to vessel "${core.vesselId}", not "${vesselId}"`,
          );
          return null;
        }

        // The runtime shape matches TypedVesselProps<V>, but the structural
        // types diverge: core.executeAction is the loose `(name: string, ...)`
        // signature while TypedVesselProps requires the action-name-discriminated
        // overload. TypeScript cannot bridge these without making useVesselCore
        // generic over V, which would propagate inference cost everywhere.
        return {
          instanceId,
          variantProps: { variant: core.currentVariant, ...core.variantProps },
          executeAction: core.executeAction,
        } as unknown as TypedVesselProps<V>;
      },

      useActions(instanceId: string, runner: ActionRunner<V>): void {
        const { orchestrator } = useMaelstromContext();
        const brandedInstanceId = InstanceId(instanceId);

        useEffect(() => {
          return orchestrator.commandProcessor.registerRunner(brandedInstanceId, runner);
        }, [orchestrator, brandedInstanceId, runner]);
      },

      unregister() {
        const currentCtx = getContext(contextRef);
        // Clean up registries first (infallible Map/Set operations).
        //
        // Limitation: if this handle's registration shadowed a factory-provided
        // (static) entry for the same vesselId, that original entry is not
        // restored — the static entry was already overwritten at registration
        // time and is not snapshotted anywhere. Restoration would require a
        // separate staticEntries map populated by buildRegistries; tracked as
        // a follow-up alongside MAE-215 (unregister ordering).
        currentCtx.componentRegistry.delete(vesselId);
        currentCtx.loadingRegistry.delete(vesselId);
        currentCtx.lazyVesselIds.delete(vesselId);
        currentCtx.lazyLoaderRegistry.delete(vesselId);
        // Then unregister from vesselManager (can throw if disposed)
        currentCtx.orchestrator.vesselManager.unregisterVessel(vesselId);
      },
    };
  }
}

function getContext(contextRef: {
  current: MaelstromContextValue | null;
}): MaelstromContextValue {
  const ctx = contextRef.current;
  if (!ctx) {
    throw new Error(
      'registerVessel() must be called while a <Provider> from the same createMaelstrom() instance is mounted.',
    );
  }
  return ctx;
}

function addToRegistries(ctx: MaelstromContextValue, entry: AnyVesselEntry) {
  const vesselId = entry.vessel.id;
  if (isLazyEntry(entry)) {
    ctx.componentRegistry.set(
      vesselId,
      // biome-ignore lint/suspicious/noExplicitAny: must match componentRegistry's declared value type in context.ts (Map<VesselId, ComponentType<TypedVesselProps<any>>>) — that `any` is load-bearing for the same erasure reason documented there.
      lazy(entry.component) as ComponentType<TypedVesselProps<any>>,
    );
    ctx.loadingRegistry.set(vesselId, entry.loadingComponent);
    ctx.lazyVesselIds.add(vesselId);
    ctx.lazyLoaderRegistry.set(vesselId, entry.component);
  } else {
    ctx.componentRegistry.set(
      vesselId,
      // biome-ignore lint/suspicious/noExplicitAny: same as the lazy branch above — must match componentRegistry's declared value type.
      entry.component as ComponentType<TypedVesselProps<any>>,
    );
    ctx.loadingRegistry.delete(vesselId);
    ctx.lazyVesselIds.delete(vesselId);
    ctx.lazyLoaderRegistry.delete(vesselId);
  }
}
