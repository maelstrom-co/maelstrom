import type { EngineConnector } from '@maelstrom-co/client';
import {
  DEFAULT_LAYOUT_MODE,
  Orchestrator,
  SessionId,
} from '@maelstrom-co/client';
import type { LayoutMode, VesselId } from '@maelstrom-co/protocol';
import { toError } from '@maelstrom-co/protocol';
import type { ComponentType, ReactNode } from 'react';
import { lazy, useEffect, useMemo, useRef, useState } from 'react';
import type { ChartMotionConfig } from './chart/motion/motion-config.js';
import type { ConfigOverrides } from './config-types.js';
import { resolveConfig } from './config-types.js';
import type { MaelstromContextPair, MaelstromContextValue } from './context.js';
import { useLatestRef } from './use-latest-ref.js';
import type {
  AnyVesselEntry,
  LazyVesselComponentLoader,
  TypedVesselProps,
} from './vessel-entry-types.js';
import { isLazyEntry } from './vessel-entry-types.js';

/** Props for the Maelstrom Provider component. */
export interface MaelstromProviderProps {
  /**
   * Engine connector. Changing the identity of this prop swaps the
   * transport on the live Orchestrator (`Orchestrator.setConnector`) rather
   * than rebuilding it — the arranged board, vessel registry, and chart
   * dimensions all survive. Use this for re-auth; it does not start a new
   * session.
   */
  connector: EngineConnector;
  /**
   * Session ID for conversation continuity. Auto-generated if omitted.
   * Captured once on mount — changing it afterwards is ignored (a console
   * warning says so). To switch sessions, remount the Provider with a new
   * `key`.
   */
  sessionId?: string;
  /**
   * Layout algorithm used by the engine. Changing this pushes the new mode
   * into the live Orchestrator (`Orchestrator.setLayoutMode`) rather than
   * rebuilding it. Omitting it after having set it falls back to the
   * Orchestrator's own default rather than freezing on the last mode.
   */
  layoutMode?: LayoutMode;
  /** Grid cell size in pixels. Overrides the factory default. */
  cellSizePx?: number;
  /** Tiling layout gap in pixels. Overrides the factory default. */
  tilingPaddingPx?: number;
  /** Enable debug logging. Overrides the factory default. */
  debug?: boolean;
  /**
   * Chart motion/choreography settings. Overrides the factory default as a
   * whole object — when provided, the factory's `motion` is ignored entirely
   * rather than merged per-field. Pass a stable reference (hoist or memoize
   * it): a new object identity on every render re-resolves the config and
   * re-renders all Maelstrom consumers.
   */
  motion?: ChartMotionConfig;
  /** Called on Orchestrator startup failures, connection failures, processIntent failures, and executeAction failures. Errors also surface via useMaelstrom(). */
  onError?: (error: Error) => void;
  children: ReactNode;
}

export function createProvider(
  contextPair: MaelstromContextPair,
  vesselEntries: readonly AnyVesselEntry[],
  factoryConfig: ConfigOverrides,
) {
  const { Context } = contextPair;

  return function MaelstromProvider({
    connector,
    sessionId,
    layoutMode,
    cellSizePx,
    tilingPaddingPx,
    debug,
    motion,
    onError,
    children,
  }: MaelstromProviderProps) {
    // Resolve config: Provider overrides → factory defaults → hardcoded defaults
    const config = useMemo(
      () =>
        resolveConfig(factoryConfig, {
          cellSizePx,
          tilingPaddingPx,
          debug,
          motion,
        }),
      [cellSizePx, tilingPaddingPx, debug, motion],
    );

    // Build registries once from static entries
    const {
      componentRegistry,
      loadingRegistry,
      lazyVesselIds,
      lazyLoaderRegistry,
    } = useMemo(
      () => buildRegistries(vesselEntries),
      [], // vesselEntries is stable (from factory closure)
    );

    // Stable ref for onError — allows hook to call without triggering re-renders
    const onErrorRef = useLatestRef(onError);
    // Read inside the construction effect below so narrowing its deps to
    // [stableSessionId] doesn't capture a stale connector at construction
    // time — connector changes are pushed in via setConnector() instead.
    const connectorRef = useLatestRef(connector);

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
    const [orchestrator, setOrchestrator] = useState<InstanceType<
      typeof Orchestrator
    > | null>(null);

    // biome-ignore lint/correctness/useExhaustiveDependencies: onErrorRef and connectorRef are useLatestRef (stable identity, .current always fresh) — listing their .current would re-create the Orchestrator on every onError/connector identity change, defeating the point of narrowing this effect to session identity alone. connector, layoutMode, and debug are deliberately excluded: a connector change is pushed into the live Orchestrator by the setConnector effect below, layoutMode by the setLayoutMode effect below, and debug only gates logging so it applies starting from the next mount rather than live.
    useEffect(() => {
      let instance: Orchestrator;
      try {
        instance = new Orchestrator(connectorRef.current, {
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
        // A failed rebuild must not leave a *previous, already-disposed*
        // instance looking current in context: this effect's cleanup (for
        // the prior successful build) already ran and disposed it before
        // this body executed, so without this, `orchestrator` state would
        // keep pointing at a dead instance — every click a silent no-op,
        // every processIntent throwing 'disposed', with nothing in the UI
        // to signal it and no dependency left to change to trigger a retry.
        setOrchestrator(null);
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
    }, [stableSessionId]);

    // Push a connector swap into the live Orchestrator instead of rebuilding
    // it — a no-op on the render that first sets `orchestrator`, since the
    // instance was just constructed with this exact connector.
    useEffect(() => {
      orchestrator?.setConnector(connector);
    }, [orchestrator, connector]);

    // Same reasoning as the setConnector effect above, for layoutMode — with
    // one twist: `layoutMode` is optional, and clearing it (a settings
    // toggle turning an override off) must fall back to the default rather
    // than being skipped. A falsy guard here would leave the live
    // Orchestrator on whatever mode was last set while the app believes
    // it's back on the default. `DEFAULT_LAYOUT_MODE` is the same constant
    // the constructor's own default resolves to, so this can't drift from
    // it. setLayoutMode is a plain assignment, so re-asserting the current
    // mode here on mount is a harmless no-op, same as setConnector above.
    useEffect(() => {
      orchestrator?.setLayoutMode(layoutMode ?? DEFAULT_LAYOUT_MODE);
    }, [orchestrator, layoutMode]);

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
        lazyLoaderRegistry,
        chartMountedRef,
      };
    }, [
      orchestrator,
      connector,
      config,
      onErrorRef,
      componentRegistry,
      loadingRegistry,
      lazyVesselIds,
      lazyLoaderRegistry,
    ]);

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

    // TODO(MAE-86): Retain previous orchestrator during a session change to
    // avoid unmounting children for one frame while the new orchestrator is
    // created inside useEffect. connector and layoutMode no longer rebuild
    // the Orchestrator at all — only a session change (remount by key) does.
    if (!value) return null;

    return <Context.Provider value={value}>{children}</Context.Provider>;
  };
}

/**
 * Build component + loading registries from static vessel entries.
 *
 * Lazy entries are wrapped with React.lazy(). Any component that renders a lazy
 * vessel must be wrapped in a <Suspense> boundary — the Chart component handles
 * this internally.
 */
function buildRegistries(entries: readonly AnyVesselEntry[]) {
  const componentRegistry = new Map<
    VesselId,
    // biome-ignore lint/suspicious/noExplicitAny: registry holds components for heterogeneous vessel definitions; ComponentType's props are contravariant, so `unknown` fails both the VesselDefinition constraint and JSX call sites in chart.tsx — see context.ts's MaelstromContextValue.componentRegistry for the same constraint.
    ComponentType<TypedVesselProps<any>>
  >();
  const loadingRegistry = new Map<
    VesselId,
    ComponentType<{ vesselId: VesselId }>
  >();
  const lazyVesselIds = new Set<VesselId>();
  const lazyLoaderRegistry = new Map<
    VesselId,
    // biome-ignore lint/suspicious/noExplicitAny: same erasure requirement as componentRegistry above.
    LazyVesselComponentLoader<any>
  >();

  for (const entry of entries) {
    const id = entry.vessel.id;
    if (isLazyEntry(entry)) {
      componentRegistry.set(id, lazy(entry.component));
      loadingRegistry.set(id, entry.loadingComponent);
      lazyVesselIds.add(id);
      lazyLoaderRegistry.set(id, entry.component);
    } else {
      componentRegistry.set(id, entry.component);
    }
  }

  return {
    componentRegistry,
    loadingRegistry,
    lazyVesselIds,
    lazyLoaderRegistry,
  };
}
