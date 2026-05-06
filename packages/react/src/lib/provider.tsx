import { Orchestrator, SessionId } from '@maelstrom-co/client';
import type { EngineConnector } from '@maelstrom-co/client';
import type { LayoutMode, VesselId } from '@maelstrom-co/protocol';
import { toError } from '@maelstrom-co/protocol';
import type { ComponentType, ReactNode } from 'react';
import { lazy, useEffect, useMemo, useRef, useState } from 'react';

import type { ResolvedMaelstromConfig } from './config-types.js';
import { resolveConfig } from './config-types.js';
import { useLatestRef } from './use-latest-ref.js';
import type { MaelstromContextPair, MaelstromContextValue } from './context.js';
import type { AnyVesselEntry, LazyVesselEntry, TypedVesselProps } from './vessel-entry-types.js';

/** Props for the Maelstrom Provider component. */
export interface MaelstromProviderProps {
  /** Engine connector — should be a stable reference; changing it recreates the Orchestrator. */
  connector: EngineConnector;
  /** Session ID for conversation continuity. Auto-generated if omitted. */
  sessionId?: string;
  /** Layout algorithm used by the engine. */
  layoutMode?: LayoutMode;
  /** Grid cell size in pixels. Overrides the factory default. */
  cellSizePx?: number;
  /** Tiling layout gap in pixels. Overrides the factory default. */
  tilingPaddingPx?: number;
  /** Enable debug logging. Overrides the factory default. */
  debug?: boolean;
  /** Called on connection and processIntent errors. Errors also surface via useMaelstrom(). */
  onError?: (error: Error) => void;
  children: ReactNode;
}

export function createProvider(
  contextPair: MaelstromContextPair,
  vesselEntries: readonly AnyVesselEntry[],
  factoryConfig: Partial<ResolvedMaelstromConfig>,
) {
  const { Context } = contextPair;

  return function MaelstromProvider({
    connector,
    sessionId,
    layoutMode,
    cellSizePx,
    tilingPaddingPx,
    debug,
    onError,
    children,
  }: MaelstromProviderProps) {
    // Resolve config: Provider overrides → factory defaults → hardcoded defaults
    const config = useMemo(
      () => resolveConfig(factoryConfig, { cellSizePx, tilingPaddingPx, debug }),
      [cellSizePx, tilingPaddingPx, debug],
    );

    // Build registries once from static entries
    const { componentRegistry, loadingRegistry, lazyVesselIds } = useMemo(
      () => buildRegistries(vesselEntries),
      [], // vesselEntries is stable (from factory closure)
    );

    // Stable ref for onError — allows hook to call without triggering re-renders
    const onErrorRef = useLatestRef(onError);

    // Guard: only one Chart may be mounted per Provider
    const chartMountedRef = useRef(false);

    // Stable session ID: use the prop if provided, otherwise generate once on mount.
    // Empty/whitespace strings are normalised to auto-gen so a parent passing
    // uninitialised state (`useState('')`) does not throw during render.
    // Changing the sessionId prop after mount is ignored — unmount and remount the Provider instead.
    const [stableSessionId] = useState(() =>
      sessionId?.trim() ? SessionId(sessionId) : SessionId(),
    );
    const initialSessionIdRef = useRef(sessionId);
    const hasWarnedSessionChangeRef = useRef(false);

    useEffect(() => {
      if (
        !hasWarnedSessionChangeRef.current &&
        sessionId !== initialSessionIdRef.current
      ) {
        hasWarnedSessionChangeRef.current = true;
        console.warn(
          '[Maelstrom] sessionId prop changed after initial mount. ' +
            'This is ignored — sessionId is captured once on mount. ' +
            'To switch sessions, unmount and remount the Provider with a new key.',
        );
      }
    }, [sessionId]);

    // Orchestrator lifecycle — creates fresh instance per mount, disposes on unmount.
    // StrictMode safe: cleanup disposes the first instance, second setup creates a new one.
    const [orchestrator, setOrchestrator] = useState<InstanceType<typeof Orchestrator> | null>(null);

    useEffect(() => {
      let instance: Orchestrator;
      try {
        instance = new Orchestrator(connector, {
          sessionId: stableSessionId,
          ...(layoutMode && { layoutMode }),
          debug: config.debug,
        });

        // Register all static vessels
        for (const entry of vesselEntries) {
          instance.vesselManager.registerVessel(entry.vessel);
        }
      } catch (err) {
        const error = toError(err);
        console.error('[Maelstrom] Failed to create Orchestrator:', error);
        onErrorRef.current?.(error);
        return;
      }

      setOrchestrator(instance);

      instance.connect().catch((err) => {
        const error = toError(err);
        onErrorRef.current?.(error);
      });

      return () => {
        instance.dispose().catch((err) => {
          console.error('[Maelstrom] Dispose error:', err);
        });
      };
    }, [connector, stableSessionId, layoutMode, config.debug]);

    // Context value — recomputes when orchestrator or config changes
    // (registry refs are static but listed to satisfy exhaustive-deps)
    const value: MaelstromContextValue | null = useMemo(() => {
      if (!orchestrator) return null;
      return {
        orchestrator,
        connector,
        config,
        onErrorRef,
        componentRegistry,
        loadingRegistry,
        lazyVesselIds,
        vesselEntries,
        chartMountedRef,
      };
    }, [orchestrator, connector, config, componentRegistry, loadingRegistry, lazyVesselIds]);

    // Keep contextRef in sync for non-hook access (registerVessel).
    // Set synchronously during render so registerVessel works inside useMemo.
    // Cleanup on unmount clears the ref to prevent stale access.
    const { contextRef } = contextPair;
    contextRef.current = value;
    useEffect(() => {
      return () => {
        contextRef.current = null;
      };
    }, []);

    // TODO(MAE-86): Retain previous orchestrator during transitions to avoid
    // unmounting children when connector/sessionId/layoutMode change mid-session.
    // Currently returns null (unmounts children for one frame) while the new
    // orchestrator is created inside useEffect.
    if (!value) return null;

    return <Context.Provider value={value}>{children}</Context.Provider>;
  };
}

function isLazyEntry(entry: AnyVesselEntry): entry is LazyVesselEntry<any> {
  return 'loadingComponent' in entry;
}

/**
 * Build component + loading registries from static vessel entries.
 *
 * Lazy entries are wrapped with React.lazy(). Any component that renders a lazy
 * vessel must be wrapped in a <Suspense> boundary — the Chart component handles
 * this internally.
 */
function buildRegistries(entries: readonly AnyVesselEntry[]) {
  const componentRegistry = new Map<VesselId, ComponentType<TypedVesselProps<any>>>();
  const loadingRegistry = new Map<VesselId, ComponentType<{ vesselId: string }>>();
  const lazyVesselIds = new Set<VesselId>();

  for (const entry of entries) {
    const id = entry.vessel.id;
    if (isLazyEntry(entry)) {
      componentRegistry.set(id, lazy(entry.component));
      loadingRegistry.set(id, entry.loadingComponent);
      lazyVesselIds.add(id);
    } else {
      componentRegistry.set(id, entry.component);
    }
  }

  return { componentRegistry, loadingRegistry, lazyVesselIds };
}
