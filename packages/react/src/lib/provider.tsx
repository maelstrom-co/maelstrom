import type {
  EngineConnector,
  OrchestratorOptions,
} from '@maelstrom-co/client';
import {
  DEFAULT_LAYOUT_MODE,
  Orchestrator,
  SessionId,
} from '@maelstrom-co/client';
import type { TilingLayout, VesselId } from '@maelstrom-co/protocol';
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

/**
 * Props for the Maelstrom Provider component.
 *
 * Split by `layoutMode` so the one combination the Orchestrator can only
 * reject at runtime — a first-screen seed under `layoutMode: 'grid'` — is
 * unrepresentable in TypeScript rather than a guaranteed construction
 * failure that typechecks.
 */
export type MaelstromProviderProps = TilingProviderProps | GridProviderProps;

/** Props shared by both `layoutMode` branches. */
interface MaelstromProviderBaseProps {
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

/** Provider props under the default tiling mode, the only seedable one. */
interface TilingProviderProps extends MaelstromProviderBaseProps {
  /**
   * Layout algorithm used by the engine. Changing this pushes the new mode
   * into the live Orchestrator (`Orchestrator.setLayoutMode`) rather than
   * rebuilding it. Omitting it after having set it falls back to the
   * Orchestrator's own default rather than freezing on the last mode.
   */
  layoutMode?: 'tiling';
  /**
   * Layout applied once when the Provider mounts, before any engine
   * round-trip — a *proposed* first screen. The engine sees it in the next
   * chart request and may reshape or drop tiles to fit the real viewport.
   *
   * Requires `layoutMode: 'tiling'` (the default): a grid layout can only
   * reposition instances that already exist (none do at construction), and a
   * tiling layout mismatches `layoutMode: 'grid'` outright. There is no way
   * to seed a first screen in grid mode, which is why the two are split
   * across the prop union; the Orchestrator still throws on the combination
   * for untyped callers that route around the types.
   *
   * Every instance the seed names must resolve against the *static* vessel
   * list passed to `createMaelstrom`: a `vesselId` that list registers, and
   * a variant that vessel declares. Vessels registered later through
   * `m.registerVessel()` or `useVessel` are not eligible — they register
   * after the Orchestrator has already been built and validated, so a seed
   * naming one can never resolve. The seed must also carry no duplicate
   * `instanceId`, and every leaf of `tree` must appear in `instances`.
   *
   * Validated during construction, and a validation failure is fatal to the
   * Provider: the error goes to `onError` and `console.error`, but the
   * Orchestrator is never created and everything under `<MaelstromProvider>`
   * renders nothing. A seed naming an unregistered vessel id, an undeclared
   * variant, or any seed under `layoutMode: 'grid'` white-screens the app —
   * it does not silently fall back to an unseeded boot. Treat `initialLayout`
   * as configuration to verify at build time, not as a best-effort hint.
   *
   * Captured once: changing this prop after mount is ignored (a console
   * warning says so); remount with a new `key` to seed a different screen.
   */
  initialLayout?: TilingLayout;
}

/** Provider props under grid mode, where no first screen can be seeded. */
interface GridProviderProps extends MaelstromProviderBaseProps {
  /**
   * Layout algorithm used by the engine — see the tiling branch for how a
   * change is pushed into the live Orchestrator. Selecting `'grid'` forbids
   * `initialLayout`.
   */
  layoutMode: 'grid';
  /**
   * Unavailable under `layoutMode: 'grid'` — see the tiling branch's
   * `initialLayout` for why a grid board cannot be seeded.
   */
  initialLayout?: never;
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
    initialLayout,
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

    // initialLayout is an object prop, so `!==` would false-positive on every
    // re-render that passes a structurally identical but newly allocated
    // literal (the common case). Compare serialized signatures instead. That
    // is a structural approximation rather than deep equality: JSON.stringify
    // is key-order sensitive, so an equivalent layout whose object literals
    // list their keys in a different order reads as changed and warns. With
    // no initialLayout the signature is `undefined` rather than a string,
    // which still compares correctly against itself.
    //
    // Re-serializing on every render is wasted work when the caller passes a
    // stable reference (a module-level constant, or state that lives above
    // the Provider and re-renders it on unrelated changes) — cache the
    // signature and only recompute it when the reference itself changes.
    const initialLayoutSignature = useMemo(
      () => JSON.stringify(initialLayout),
      [initialLayout],
    );
    const initialLayoutSignatureRef = useRef(initialLayoutSignature);
    const hasWarnedLayoutChangeRef = useRef(false);

    useEffect(() => {
      if (
        !hasWarnedLayoutChangeRef.current &&
        initialLayoutSignature !== initialLayoutSignatureRef.current
      ) {
        hasWarnedLayoutChangeRef.current = true;
        console.warn(
          '[Maelstrom] initialLayout prop changed after initial mount. ' +
            'This is ignored — initialLayout is captured once on mount. ' +
            'To seed a different screen, remount the Provider with a new key.',
        );
      }
    }, [initialLayoutSignature]);

    // Orchestrator lifecycle — creates fresh instance per mount, disposes on unmount.
    // StrictMode safe: cleanup disposes the first instance, second setup creates a new one.
    const [orchestrator, setOrchestrator] = useState<InstanceType<
      typeof Orchestrator
    > | null>(null);

    // biome-ignore lint/correctness/useExhaustiveDependencies: onErrorRef and connectorRef are useLatestRef (stable identity, .current always fresh) — listing their .current would re-create the Orchestrator on every onError/connector identity change, defeating the point of narrowing this effect to session identity alone. connector, layoutMode, and debug are deliberately excluded: a connector change is pushed into the live Orchestrator by the setConnector effect below, layoutMode by the setLayoutMode effect below, and debug only gates logging so it applies starting from the next mount rather than live. initialLayout is excluded the same way — it is read once, from whichever render this effect's closure happened to run in (mount, or both mount passes under StrictMode's double-invoke using the *same* closure), and a later value has nothing left to attach to since the Orchestrator is already built.
    useEffect(() => {
      // `layoutMode: 'grid'` with an `initialLayout` is unrepresentable in
      // both this component's props and `OrchestratorOptions`, hence the
      // cast — but an untyped (JS) caller can still pass the pair, and the
      // Orchestrator's constructor guard is what reports it. Forwarding it
      // intact keeps that backstop reachable; dropping the seed here would
      // boot a screen the caller never asked for, silently.
      const options = {
        sessionId: stableSessionId,
        ...(layoutMode && { layoutMode }),
        ...(initialLayout && { initialLayout }),
        // Registered before `initialLayout` is validated (see the `vessels`
        // option), which registering afterward could not be.
        vessels: vesselEntries.map((entry) => entry.vessel),
        debug: config.debug,
      } as OrchestratorOptions;

      let instance: Orchestrator;
      try {
        instance = new Orchestrator(connectorRef.current, options);
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
