import type { EngineConnector, Orchestrator } from '@maelstrom-co/client';
import type { VesselId } from '@maelstrom-co/protocol';
import type { ComponentType, MutableRefObject } from 'react';
import { createContext, useContext } from 'react';

import type { ResolvedMaelstromConfig } from './config-types.js';
import type { LazyVesselComponentLoader, TypedVesselProps } from './vessel-entry-types.js';

/** Internal context value — not part of public API */
export interface MaelstromContextValue {
  orchestrator: Orchestrator;
  connector: EngineConnector;
  config: ResolvedMaelstromConfig;
  /** Ref to onError callback from Provider props — allows hook to call it without re-renders */
  onErrorRef: MutableRefObject<((error: Error) => void) | undefined>;
  /** Maps vessel ID → React component */
  // biome-ignore lint/suspicious/noExplicitAny: registry holds components for heterogeneous vessel definitions; ComponentType's props are contravariant, so `unknown` fails both the VesselDefinition constraint and JSX call sites in chart.tsx — only `any` can erase per-vessel prop types here.
  componentRegistry: Map<VesselId, ComponentType<TypedVesselProps<any>>>;
  /** Maps vessel ID → loading skeleton (for lazy vessels) */
  loadingRegistry: Map<VesselId, ComponentType<{ vesselId: VesselId }>>;
  /** Set of vessel IDs that are lazy-loaded */
  lazyVesselIds: Set<VesselId>;
  /**
   * Raw lazy loader per vessel id. Chart wraps with React.lazy() locally on
   * each render keyed by a retry counter, so the retry path can bust the
   * cached rejected Promise. Mirrors lazyVesselIds — invariant: ids match.
   */
  // biome-ignore lint/suspicious/noExplicitAny: same erasure requirement as componentRegistry above — `unknown` doesn't satisfy the VesselDefinition constraint on LazyVesselComponentLoader.
  lazyLoaderRegistry: Map<VesselId, LazyVesselComponentLoader<any>>;
  /** Guard: only one Chart may be mounted per Provider */
  chartMountedRef: MutableRefObject<boolean>;
}

/** Create a new per-factory React context */
export function createMaelstromContext() {
  const Context = createContext<MaelstromContextValue | null>(null);
  Context.displayName = 'MaelstromContext';

  // Mutable ref for non-hook access (registerVessel)
  const contextRef: MutableRefObject<MaelstromContextValue | null> = { current: null };

  function useMaelstromContext(): MaelstromContextValue {
    const ctx = useContext(Context);
    if (!ctx) {
      throw new Error(
        'useMaelstrom() must be used within a <Provider> from the same createMaelstrom() instance.',
      );
    }
    return ctx;
  }

  return { Context, useMaelstromContext, contextRef } as const;
}

export type MaelstromContextPair = ReturnType<typeof createMaelstromContext>;
