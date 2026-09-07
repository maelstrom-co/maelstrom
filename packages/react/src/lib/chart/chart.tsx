import type { ComputedTile, Rect, VesselInstance } from '@maelstrom-co/client';
import { computeTilingLayout, parseTilingTree } from '@maelstrom-co/client';
import type {
  ChartDimensions,
  GridLayout,
  InstanceId,
  TilingLayout,
} from '@maelstrom-co/protocol';
import { getVisibleInstanceIds } from '@maelstrom-co/protocol';
import { useStore } from '@tanstack/react-store';
import {
  type ComponentType,
  type CSSProperties,
  lazy,
  memo,
  type ReactNode,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { buildExecuteAction } from '../build-execute-action.js';
import type { MaelstromContextPair } from '../context.js';
import { warnOnce } from '../warn-once.js';
import { ErrorBoundary } from './error-boundary.js';
import { VesselLoadError, VesselLoadingSkeleton } from './loading.js';
import type { MotionRect } from './motion/flip.js';
import { exitKeyframes } from './motion/flip.js';
import { measureInstanceRects } from './motion/measure.js';
import type { ResolvedChartMotionConfig } from './motion/motion-config.js';
import { useChartMotion } from './motion/use-chart-motion.js';
import { useExitingInstances } from './motion/use-exiting-instances.js';

// Shared shape for one child slot of the container's single render pass,
// covering both live instances and exit ghosts — see the render-entry
// construction in each layout branch below for why they must share a slot.
interface RenderEntry {
  readonly id: string;
  readonly instance: VesselInstance;
  readonly style: CSSProperties;
  readonly exiting?: ResolvedChartMotionConfig;
}

// A repeated instanceId reaches React as two siblings sharing one key, which
// reconciliation resolves by dropping or reusing the wrong subtree — vessel
// state silently attaching to the wrong tile. Encoding the occurrence index
// into the key turns that into two mounted subtrees rendering the same
// instance: visibly wrong instead of quietly wrong. An InstanceId is any
// non-empty string, so a plain separator is not enough — ids `a` and `a#1`
// would both reach `a#1`. Length-prefixing makes the encoding injective, and
// every occurrence including the first is encoded so no id can be written two
// ways.
//
// The warning is deliberately not `config.debug`-gated: debug defaults to
// false, and React's own duplicate-key warning is compiled out of production
// react-dom, so gating here would leave production with no signal at all.
function withCollisionKeys<T extends { readonly id: string }>(
  entries: readonly T[],
): ReadonlyArray<T & { readonly key: string }> {
  const seen = new Map<string, number>();
  return entries.map((entry) => {
    const seenBefore = seen.get(entry.id) ?? 0;
    seen.set(entry.id, seenBefore + 1);
    if (seenBefore > 0) {
      warnOnce(
        `chart:duplicate-instance:${entry.id}`,
        `[Maelstrom] Duplicate instanceId "${entry.id}" in layout; tiles overlap`,
      );
    }
    return { ...entry, key: `${entry.id.length}:${entry.id}:${seenBefore}` };
  });
}

// Exit ghost's visual style: absolute-positioned at its last known live rect,
// non-interactive, and behind live content (zIndex 0 vs. live's 1).
function exitGhostStyle(rect: MotionRect): CSSProperties {
  return {
    position: 'absolute',
    left: rect.x,
    top: rect.y,
    width: rect.width,
    height: rect.height,
    pointerEvents: 'none',
    zIndex: 0,
    overflow: 'hidden',
  };
}

/** Props for the `m.Chart` layout component. */
export interface ChartProps {
  /** CSS class name applied to the chart container. */
  className?: string | undefined;
  /** Additional styles merged onto the chart container (layout-critical properties cannot be overridden). */
  style?: CSSProperties | undefined;
  /** Slot content rendered inside the chart container alongside vessels. */
  children?: ReactNode;
}

/** Create the Chart component bound to a Maelstrom context. Internal — called by `createMaelstrom()`. */
export function createChart(
  contextPair: MaelstromContextPair,
): ComponentType<ChartProps> {
  const { useMaelstromContext } = contextPair;

  // ─── VesselRenderer ────────────────────────────────────────────────────────

  interface VesselRendererProps {
    instance: VesselInstance;
    style: CSSProperties;
    /**
     * Present when this render is an exit ghost rather than a live instance.
     * Carries the resolved motion config so the wrapper can run its exit
     * animation once, at the moment the live -> exiting transition happens.
     */
    exiting?: ResolvedChartMotionConfig;
  }

  const VesselRenderer = memo(
    function VesselRenderer({ instance, style, exiting }: VesselRendererProps) {
      const {
        orchestrator,
        componentRegistry,
        loadingRegistry,
        lazyVesselIds,
        lazyLoaderRegistry,
        config,
        onErrorRef,
      } = useMaelstromContext();

      const ref = useRef<HTMLDivElement>(null);

      // Fires exactly once per live -> exiting transition: keyed on the boolean
      // presence of `exiting` (not the config object, which is a fresh
      // reference every render) so the animation isn't restarted mid-flight by
      // an unrelated Chart re-render while this instance is already exiting.
      // biome-ignore lint/correctness/useExhaustiveDependencies: deliberately keyed on Boolean(exiting), not `exiting` itself or `instance` — see comment above.
      useEffect(() => {
        if (!exiting) return;
        const node = ref.current;
        if (!node || typeof node.animate !== 'function') return;
        node.animate(exitKeyframes(), {
          duration: exiting.durationMs,
          easing: exiting.easing,
          fill: 'forwards',
        });
      }, [Boolean(exiting)]);

      const vessel = useStore(orchestrator.vesselManager.store, (s) =>
        s.vessels.get(instance.vesselId),
      );

      const executeAction = useMemo(
        () =>
          buildExecuteAction(
            orchestrator,
            instance.instanceId,
            config.debug,
            onErrorRef,
          ),
        [orchestrator, instance.instanceId, config.debug, onErrorRef],
      );

      const isLazy = lazyVesselIds.has(instance.vesselId);

      // For lazy vessels, create React.lazy() locally so retry can bust the cache
      // by incrementing lazyRetryKey, producing a fresh lazy() instance.
      const [lazyRetryKey, setLazyRetryKey] = useState(0);
      const lazyLoader = isLazy
        ? lazyLoaderRegistry.get(instance.vesselId)
        : undefined;
      // biome-ignore lint/correctness/useExhaustiveDependencies: lazyRetryKey is intentionally in deps though unused in the body — incrementing it produces a fresh React.lazy() instance, busting the cached rejected Promise on retry.
      const LazyComponent = useMemo(
        () => (lazyLoader ? lazy(lazyLoader) : null),
        [lazyLoader, lazyRetryKey],
      );

      const Component = isLazy
        ? LazyComponent
        : componentRegistry.get(instance.vesselId);
      if (!Component) {
        warnOnce(
          `chart:no-component:${instance.vesselId}`,
          `[Maelstrom] No component registered for vessel "${instance.vesselId}"`,
        );
        return null;
      }
      if (!vessel) {
        warnOnce(
          `chart:no-vessel-def:${instance.vesselId}`,
          `[Maelstrom] No vessel definition found for "${instance.vesselId}"`,
        );
        return null;
      }

      const variant = vessel.variants[instance.variant];
      if (!variant) {
        // Unconditional: this instance renders as a blank tile either way,
        // and gating the only signal behind debug mode made that blank tile
        // invisible in production too (debug defaults to false).
        warnOnce(
          `chart:unknown-variant:${instance.vesselId}:${instance.variant}`,
          `[Maelstrom] Unknown variant "${instance.variant}" for vessel "${instance.vesselId}"`,
        );
        return null;
      }

      const props = {
        instanceId: instance.instanceId,
        variantProps: { variant: instance.variant, ...variant.props },
        executeAction,
      };

      const LoadingComponent =
        loadingRegistry.get(instance.vesselId) ?? VesselLoadingSkeleton;
      const loadingFallback = (
        <LoadingComponent
          vesselId={instance.vesselId}
          vesselName={vessel.name}
        />
      );

      const content = isLazy ? (
        <ErrorBoundary
          key={lazyRetryKey}
          fallback={(error) => (
            <VesselLoadError
              vesselId={instance.vesselId}
              error={error}
              debug={config.debug}
              retry={() => setLazyRetryKey((k) => k + 1)}
            />
          )}
          onError={(error) => {
            if (config.debug) {
              console.error(
                `[Maelstrom] Failed to load vessel component: ${instance.vesselId}`,
                error,
              );
            }
            onErrorRef.current?.(error);
          }}
        >
          <Suspense fallback={loadingFallback}>
            <Component {...props} />
          </Suspense>
        </ErrorBoundary>
      ) : (
        <Component {...props} />
      );

      return (
        <div
          style={style}
          data-instance-id={instance.instanceId}
          data-exiting={exiting ? '' : undefined}
          ref={ref}
        >
          {content}
        </div>
      );
    },
    (prev, next) => {
      if (prev.instance.instanceId !== next.instance.instanceId) return false;
      if (prev.instance.variant !== next.instance.variant) return false;
      if (prev.instance.vesselId !== next.instance.vesselId) return false;
      // A change in exiting-ness (undefined <-> a resolved motion config) must
      // force a re-render even if style hasn't settled yet — that's the render
      // that mounts the ref the exit effect fires against. `config.motion`
      // itself is a fresh object every Provider render, so comparing presence
      // rather than reference avoids re-rendering (and re-diffing style) on
      // every unrelated re-render once an instance is already exiting.
      if ((prev.exiting === undefined) !== (next.exiting === undefined))
        return false;
      const prevStyle = prev.style;
      const nextStyle = next.style;
      const allKeys = new Set([
        ...Object.keys(prevStyle),
        ...Object.keys(nextStyle),
      ]);
      for (const key of allKeys) {
        if (
          prevStyle[key as keyof CSSProperties] !==
          nextStyle[key as keyof CSSProperties]
        )
          return false;
      }
      return true;
    },
  );

  // ─── Grid debug overlay ─────────────────────────────────────────────────────

  interface GridDebugOverlayProps {
    columns: number;
    rows: number;
  }

  function GridDebugOverlay({ columns, rows }: GridDebugOverlayProps) {
    const overlayStyle: CSSProperties = {
      position: 'absolute',
      inset: 0,
      backgroundImage: `
        linear-gradient(to right, rgba(128,128,128,0.2) 1px, transparent 1px),
        linear-gradient(to bottom, rgba(128,128,128,0.2) 1px, transparent 1px)
      `,
      backgroundSize: `${100 / columns}% ${100 / rows}%`,
      pointerEvents: 'none',
      zIndex: 0,
    };
    return <div style={overlayStyle} data-chart-debug="grid" />;
  }

  // ─── Tiling debug overlay ────────────────────────────────────────────────────

  function TilingDebugOverlay({ tiles }: { tiles: readonly ComputedTile[] }) {
    return (
      <div
        style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          zIndex: 9999,
        }}
        data-chart-debug="tiling"
      >
        {withCollisionKeys(
          tiles.map((tile) => ({ ...tile, id: tile.instanceId })),
        ).map((tile) => (
          <div
            key={tile.key}
            style={{
              position: 'absolute',
              left: tile.rect.x,
              top: tile.rect.y,
              width: tile.rect.width,
              height: tile.rect.height,
              border: '2px dashed rgba(255,0,0,0.5)',
              boxSizing: 'border-box',
            }}
          >
            <div
              style={{
                position: 'absolute',
                top: 2,
                left: 2,
                background: 'rgba(0,0,0,0.7)',
                color: 'white',
                padding: '2px 4px',
                fontSize: '10px',
                fontFamily: 'monospace',
                borderRadius: '2px',
              }}
            >
              {tile.instanceId}
              <br />
              {Math.round(tile.rect.width)}x{Math.round(tile.rect.height)}
            </div>
          </div>
        ))}
      </div>
    );
  }

  // ─── Main Chart component ────────────────────────────────────────────────────

  return memo(function Chart({ className, style, children }: ChartProps) {
    const { orchestrator, config, chartMountedRef } = useMaelstromContext();
    const containerRef = useRef<HTMLDivElement>(null);
    const [isDuplicate, setIsDuplicate] = useState(false);

    // Guard: only one Chart per Provider
    useEffect(() => {
      if (chartMountedRef.current) {
        console.warn(
          '[Maelstrom] Only one <Chart> may be mounted per <Provider>. ' +
            'This Chart will not render. Create a separate createMaelstrom() instance for multiple Charts.',
        );
        setIsDuplicate(true);
        return;
      }
      chartMountedRef.current = true;
      return () => {
        chartMountedRef.current = false;
      };
    }, [chartMountedRef]);

    // Track pixel dimensions for tiling layout
    const [containerRect, setContainerRect] = useState<Rect>({
      x: 0,
      y: 0,
      width: 0,
      height: 0,
    });

    // Subscribe to layout and instances
    const layout = useStore(
      orchestrator.commandProcessor.store,
      (s) => s.layout,
    );
    const instances = useStore(
      orchestrator.commandProcessor.store,
      (s) => s.instances,
    );

    // Subscribe to grid dimensions (for CSS Grid template)
    const chartDimensions = useStore(
      orchestrator.chartManager.store,
      (s) => s.chartDimensions,
    );

    // ResizeObserver: convert pixel dimensions → grid cells → chartManager
    useEffect(() => {
      const container = containerRef.current;
      if (!container) return;

      const observer = new ResizeObserver((entries: ResizeObserverEntry[]) => {
        const entry = entries[0];
        if (!entry) return;
        const { width, height } = entry.contentRect;
        setContainerRect((prev) =>
          prev.width === width && prev.height === height
            ? prev
            : { x: 0, y: 0, width, height },
        );
        const columns = Math.floor(width / config.cellSizePx);
        const rows = Math.floor(height / config.cellSizePx);
        orchestrator.chartManager.setDimensions({ columns, rows });
      });

      observer.observe(container);
      return () => observer.disconnect();
    }, [orchestrator, config.cellSizePx]);

    // Tiling layout computed once per render — reused by the tiling render
    // branch below and by the exit-tracking instance list. Deliberately not an
    // input to deriveMotionKeys: keying on computed pixel rects is what made
    // every ResizeObserver tick read as a layout change.
    const tilingComputed = useMemo<readonly ComputedTile[] | null>(() => {
      if (!layout || layout.type !== 'tiling') return null;
      const tree = parseTilingTree(layout.tree);
      return computeTilingLayout(tree, containerRect, config.tilingPaddingPx);
    }, [layout, containerRect, config.tilingPaddingPx]);

    const { layoutKey, sizeKey } = useMemo(
      () =>
        deriveMotionKeys({
          layout,
          containerRect,
          chartDimensions,
          tilingPaddingPx: config.tilingPaddingPx,
          instances,
        }),
      [
        layout,
        containerRect,
        chartDimensions,
        config.tilingPaddingPx,
        instances,
      ],
    );

    // Exit tracking must re-snapshot on either kind of change, so it receives
    // the combined signature rather than one key.
    const layoutSignature = `${layoutKey}@${sizeKey}`;

    // Instances currently rendered, keyed by instanceId — feeds exit tracking
    // so a instance dropped from the next layout response gets an exit entry.
    const currentInstanceEntries = useMemo<
      ReadonlyArray<readonly [string, VesselInstance]>
    >(() => {
      const out: Array<readonly [string, VesselInstance]> = [];
      if (!layout || layout.type === 'grid') {
        for (const pos of layout?.positions ?? []) {
          const instance = instances.get(pos.instanceId);
          if (instance) out.push([pos.instanceId, instance]);
        }
      } else if (layout.type === 'tiling') {
        for (const tile of tilingComputed ?? []) {
          const instance = instances.get(tile.instanceId);
          if (instance) out.push([tile.instanceId, instance]);
        }
      }
      return out;
    }, [layout, instances, tilingComputed]);

    // Single shared children-walk (see motion/measure.ts) so FLIP baselines and
    // exit-ghost snapshots never disagree about where an instance was.
    const measureRects = useCallback(
      (): ReadonlyMap<string, MotionRect> =>
        containerRef.current
          ? measureInstanceRects(containerRef.current)
          : new Map(),
      [],
    );

    // Ordering invariant: useExitingInstances MUST run before useChartMotion.
    // Layout effects fire in hook call order, and a freshly-created WAAPI
    // animation applies its first (inverted, old-position) keyframe to
    // computed style immediately — exit snapshots taken after useChartMotion
    // starts animating would capture pre-move rects and place a later exit
    // ghost at a stale position.
    const exiting = useExitingInstances(
      currentInstanceEntries,
      measureRects,
      config.motion,
      layoutSignature,
    );

    useChartMotion(containerRef, layoutKey, sizeKey, config.motion);

    // ── Guard: duplicate Chart ────────────────────────────────────────────────

    if (isDuplicate) {
      return (
        <div
          className={className}
          style={{
            padding: '16px',
            color: '#dc2626',
            fontFamily: 'monospace',
            fontSize: '14px',
          }}
        >
          [Maelstrom] Only one {'<Chart>'} may be mounted per {'<Provider>'}.
          Create a separate createMaelstrom() instance for multiple charts.
        </div>
      );
    }

    // ── Grid layout rendering ─────────────────────────────────────────────────

    if (!layout || layout.type === 'grid') {
      const { columns, rows } = chartDimensions;

      const containerStyle: CSSProperties = {
        ...style,
        display: 'grid',
        gridTemplateColumns: `repeat(${columns}, 1fr)`,
        gridTemplateRows: `repeat(${rows}, 1fr)`,
        width: '100%',
        height: '100%',
        overflow: 'hidden',
        position: 'relative',
      };

      const gridPositions = layout?.positions ?? [];
      const instancesToRender = gridPositions
        .map((pos) => {
          const instance = instances.get(pos.instanceId);
          if (!instance && config.debug) {
            console.warn(
              `[Maelstrom] Grid layout references unknown instance "${pos.instanceId}"`,
            );
          }
          return instance ? { instance, pos } : null;
        })
        .filter(
          (
            item,
          ): item is {
            instance: VesselInstance;
            pos: (typeof gridPositions)[number];
          } => item !== null,
        );

      // Live and exiting instances are combined into ONE array, rendered from
      // a SINGLE .map() below, keyed by instanceId. Two separate .map() calls
      // (live vs. exit-ghost, with a rekeyed `exit-${id}`) are two child
      // slots to React's reconciler, which unmounts the live element and
      // mounts a fresh one for the fade — losing any local state, in-flight
      // effects, or subscriptions on the vessel. One slot with a stable key
      // lets React recognize it's the same element across the transition.
      const renderEntries: RenderEntry[] = instancesToRender.map(
        ({ instance, pos }) => {
          const colStart = pos.position.column + 1;
          const rowStart = pos.position.row + 1;
          return {
            id: instance.instanceId,
            instance,
            style: {
              gridColumn: `${colStart} / ${colStart + pos.size.width}`,
              gridRow: `${rowStart} / ${rowStart + pos.size.height}`,
              zIndex: 1,
              minWidth: 0,
              minHeight: 0,
            },
          };
        },
      );
      for (const entry of exiting) {
        renderEntries.push({
          id: entry.id,
          instance: entry.item,
          style: exitGhostStyle(entry.rect),
          exiting: config.motion,
        });
      }

      return (
        <div ref={containerRef} className={className} style={containerStyle}>
          {config.debug && columns > 0 && rows > 0 && (
            <GridDebugOverlay columns={columns} rows={rows} />
          )}
          {withCollisionKeys(renderEntries).map((entry) => (
            <VesselRenderer
              key={entry.key}
              instance={entry.instance}
              style={entry.style}
              exiting={entry.exiting}
            />
          ))}
          {children}
        </div>
      );
    }

    // ── Tiling layout rendering ───────────────────────────────────────────────

    if (layout.type === 'tiling') {
      const containerStyle: CSSProperties = {
        ...style,
        position: 'relative',
        width: '100%',
        height: '100%',
        overflow: 'hidden',
      };

      const computedTiles = tilingComputed ?? [];

      const tilesToRender = computedTiles
        .map((tile) => {
          const instance = instances.get(tile.instanceId);
          if (!instance && config.debug) {
            console.warn(
              `[Maelstrom] Tiling layout references unknown instance "${tile.instanceId}"`,
            );
          }
          return instance ? { instance, tile } : null;
        })
        .filter(
          (item): item is { instance: VesselInstance; tile: ComputedTile } =>
            item !== null,
        );

      // See the grid branch above for why live and exiting instances must
      // render from one combined array/one .map() rather than two.
      const renderEntries: RenderEntry[] = tilesToRender.map(
        ({ instance, tile }) => ({
          id: instance.instanceId,
          instance,
          style: {
            position: 'absolute',
            left: tile.rect.x,
            top: tile.rect.y,
            width: tile.rect.width,
            height: tile.rect.height,
            zIndex: 1,
            overflow: 'hidden',
          },
        }),
      );
      for (const entry of exiting) {
        renderEntries.push({
          id: entry.id,
          instance: entry.item,
          style: exitGhostStyle(entry.rect),
          exiting: config.motion,
        });
      }

      return (
        <div ref={containerRef} className={className} style={containerStyle}>
          {withCollisionKeys(renderEntries).map((entry) => (
            <VesselRenderer
              key={entry.key}
              instance={entry.instance}
              style={entry.style}
              exiting={entry.exiting}
            />
          ))}
          {config.debug && <TilingDebugOverlay tiles={computedTiles} />}
          {children}
        </div>
      );
    }

    // Fallback: unknown layout type — render empty container
    if (config.debug) {
      console.warn(
        `[Maelstrom] Unknown layout type "${(layout as { type: string }).type}", rendering empty container`,
      );
    }
    return (
      <div
        ref={containerRef}
        className={className}
        style={{
          ...style,
          width: '100%',
          height: '100%',
          position: 'relative',
        }}
      >
        {children}
      </div>
    );
  });
}

// Every input that can move a rendered rect, named in one place. Dependency
// arrays catch neither obligation this shape exists for: coverage — an input
// that moves a rect but reaches neither key leaves the FLIP baseline stale —
// and routing — a structural input belongs in layoutKey, which animates, and a
// pixel-remapping one in sizeKey, which silently re-measures.
interface ChartGeometryInputs {
  readonly layout: GridLayout | TilingLayout | null;
  readonly containerRect: Rect;
  readonly chartDimensions: ChartDimensions;
  readonly tilingPaddingPx: number;
  readonly instances: ReadonlyMap<InstanceId, VesselInstance>;
}

// Destructured in the body rather than the parameter list on purpose:
// `noUnusedLocals` is on and `noUnusedParameters` is not, so an input added to
// ChartGeometryInputs and then consumed by neither key fails to compile.
//
// layoutKey stays structural in both modes — grid cell units, tiling tree
// tokens. A pixel-derived layoutKey turns every ResizeObserver tick into a
// layout change, and because FLIP measures through the in-flight transform,
// each tick's scale then compounds the previous one's. Everything that remaps
// rects to new pixels while leaving logical units and tree tokens alone —
// container size, grid track counts, tiling padding — rides in sizeKey
// instead, so a re-measure happens without an animation.
//
// Container dimensions are observed through Math.round while tile positions
// reach the DOM unrounded, so a sub-pixel resize can move a tile without
// moving sizeKey. That trades up to a pixel of baseline precision for far
// fewer re-measures across a continuous resize or window drag.
function deriveMotionKeys(inputs: ChartGeometryInputs): {
  layoutKey: string;
  sizeKey: string;
} {
  const { layout, containerRect, chartDimensions, tilingPaddingPx, instances } =
    inputs;

  // Which visible ids actually resolve to a mounted wrapper decides whether an
  // instance is in the measured map at all, and `instances` is independent of
  // the tree, so two responses can share a tree and differ here. It rides in
  // sizeKey rather than layoutKey: a silent re-measure is the right response
  // to a set the structural key cannot see, where animating would not be.
  const resolvedInstanceIds = Array.from(getVisibleInstanceIds(layout))
    .filter((id) => instances.has(id))
    .sort();

  return {
    layoutKey: deriveLayoutKey(layout),
    sizeKey: `${Math.round(containerRect.width)}x${Math.round(containerRect.height)}:${chartDimensions.columns}x${chartDimensions.rows}:${tilingPaddingPx}:${JSON.stringify(resolvedInstanceIds)}`,
  };
}

// JSON.stringify rather than a separator join: an InstanceId is any non-empty
// string, so `['V', 'ID:a', 'ID:b']` and `['V', 'ID:a|ID:b']` would serialize
// alike under `join('|')` and a real layout change would read as a no-op —
// no FLIP, and no exit ghost for anything the change dropped.
function deriveLayoutKey(layout: GridLayout | TilingLayout | null): string {
  if (!layout || layout.type === 'grid') {
    const key = (layout?.positions ?? [])
      .map(
        (p) =>
          `${p.instanceId}:${p.position.row}:${p.position.column}:${p.size.width}:${p.size.height}`,
      )
      .join('|');
    return `grid:${key}`;
  }
  if (layout.type === 'tiling') {
    return `tiling:${JSON.stringify(layout.tree)}`;
  }
  return 'unknown';
}
