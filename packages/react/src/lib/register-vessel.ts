import type { ActionRunner } from '@maelstrom-co/client';
import type { Vessel } from '@maelstrom-co/protocol';
import { type ComponentType, lazy, useEffect } from 'react';

import type { MaelstromContextPair, MaelstromContextValue } from './context.js';
import type { DynamicVesselHandle } from './dynamic-vessel-types.js';
import { createUseVesselCore } from './use-vessel-core.js';
import { warnOnce } from './warn-once.js';
import type {
  AnyVesselEntry,
  LazyVesselEntry,
  TypedVesselProps,
} from './vessel-entry-types.js';

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

  return function registerVessel<V extends Vessel>(
    entry: AnyVesselEntry<V>,
  ): DynamicVesselHandle<V> {
    const ctx = getContext(contextRef);
    const vesselId = entry.vessel.id;

    if (ctx.config.debug && ctx.componentRegistry.has(vesselId)) {
      console.warn(
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

  function buildHandle<V extends Vessel>(
    vesselId: string,
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

        return {
          instanceId,
          variantProps: { variant: core.currentVariant, ...core.variantProps },
          executeAction: core.executeAction,
        } as TypedVesselProps<V>;
      },

      useActions(instanceId: string, runner: ActionRunner<V>): void {
        const { orchestrator } = useMaelstromContext();

        useEffect(() => {
          return orchestrator.commandProcessor.registerRunner(instanceId, runner);
        }, [orchestrator, instanceId, runner]);
      },

      unregister() {
        const currentCtx = getContext(contextRef);
        // Clean up registries first (infallible Map/Set operations)
        currentCtx.componentRegistry.delete(vesselId);
        currentCtx.loadingRegistry.delete(vesselId);
        currentCtx.lazyVesselIds.delete(vesselId);
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
      lazy(entry.component) as ComponentType<TypedVesselProps<any>>,
    );
    ctx.loadingRegistry.set(vesselId, entry.loadingComponent);
    ctx.lazyVesselIds.add(vesselId);
  } else {
    ctx.componentRegistry.set(
      vesselId,
      entry.component as ComponentType<TypedVesselProps<any>>,
    );
    ctx.loadingRegistry.delete(vesselId);
    ctx.lazyVesselIds.delete(vesselId);
  }
}

function isLazyEntry(entry: AnyVesselEntry): entry is LazyVesselEntry<any> {
  return 'loadingComponent' in entry;
}
