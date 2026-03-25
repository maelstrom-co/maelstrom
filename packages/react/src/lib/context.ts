import type { Orchestrator } from '@maelstrom-co/client';
import type { ComponentType, MutableRefObject } from 'react';
import { createContext, useContext } from 'react';

import type { ResolvedMaelstromConfig } from './config-types.js';
import type { AnyVesselEntry, TypedVesselProps } from './vessel-entry-types.js';

/** Internal context value — not part of public API */
export interface MaelstromContextValue {
  orchestrator: Orchestrator;
  config: ResolvedMaelstromConfig;
  /** Ref to onError callback from Provider props — allows hook to call it without re-renders */
  onErrorRef: MutableRefObject<((error: Error) => void) | undefined>;
  /** Maps vessel ID → React component */
  componentRegistry: Map<string, ComponentType<TypedVesselProps<any>>>;
  /** Maps vessel ID → loading skeleton (for lazy vessels) */
  loadingRegistry: Map<string, ComponentType<{ vesselId: string }>>;
  /** Set of vessel IDs that are lazy-loaded */
  lazyVesselIds: Set<string>;
  /** The static vessel entries from createMaelstrom config */
  vesselEntries: readonly AnyVesselEntry[];
  /** Guard: only one Chart may be mounted per Provider */
  chartMountedRef: MutableRefObject<boolean>;
}

/** Create a new per-factory React context */
export function createMaelstromContext() {
  const Context = createContext<MaelstromContextValue | null>(null);
  Context.displayName = 'MaelstromContext';

  function useMaelstromContext(): MaelstromContextValue {
    const ctx = useContext(Context);
    if (!ctx) {
      throw new Error(
        'useMaelstrom() must be used within a <Provider> from the same createMaelstrom() instance.',
      );
    }
    return ctx;
  }

  return { Context, useMaelstromContext } as const;
}

export type MaelstromContextPair = ReturnType<typeof createMaelstromContext>;
