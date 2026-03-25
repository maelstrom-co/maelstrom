import type { ComputedTile, Rect, VesselInstance } from '@maelstrom-co/client';
import { computeTilingLayout, parseTilingTree } from '@maelstrom-co/client';
import type { GridLayout, TilingLayout } from '@maelstrom-co/protocol-old';
import { isGridLayout, isTilingLayout } from '@maelstrom-co/protocol-old';
import { useStore } from '@tanstack/react-store';
import {
  type CSSProperties,
  type ComponentType,
  type ReactNode,
  Suspense,
  lazy,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import type { MaelstromContextPair } from '../context.js';
import type { LazyVesselEntry } from '../vessel-entry-types.js';
import { ErrorBoundary } from './error-boundary.js';
import { VesselLoadError, VesselLoadingSkeleton } from './loading.js';

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
export function createChart(contextPair: MaelstromContextPair): ComponentType<ChartProps> {
  const { useMaelstromContext } = contextPair;

  // ─── VesselRenderer ────────────────────────────────────────────────────────

  interface VesselRendererProps {
    instance: VesselInstance;
    style: CSSProperties;
  }

  const VesselRenderer = memo(function VesselRenderer({ instance, style }: VesselRendererProps) {
    const { orchestrator, componentRegistry, loadingRegistry, lazyVesselIds, vesselEntries, config, onErrorRef } =
      useMaelstromContext();

    const vessel = useStore(
      orchestrator.vesselManager.store,
      (s) => s.vessels.get(instance.vesselId),
    );

    const executeAction = useCallback(
      (name: string, params?: Record<string, unknown>) => {
        if (config.debug) {
          console.log(`[Maelstrom] executeAction: ${name}`, params);
        }
        try {
          orchestrator.commandProcessor.executeActions([
            {
              instanceId: instance.instanceId,
              action: name,
              ...(params && { paramsJson: JSON.stringify(params) }),
            },
          ]);
        } catch (err) {
          const error = err instanceof Error ? err : new Error(String(err));
          onErrorRef.current?.(error);
        }
      },
      [orchestrator, instance.instanceId, config.debug, onErrorRef],
    );

    const isLazy = lazyVesselIds.has(instance.vesselId);

    // For lazy vessels, create React.lazy() locally so retry can bust the cache
    // by incrementing lazyRetryKey, producing a fresh lazy() instance.
    const [lazyRetryKey, setLazyRetryKey] = useState(0);
    const lazyLoader = isLazy
      ? (vesselEntries.find((e) => e.vessel.id === instance.vesselId) as LazyVesselEntry<any>)?.component
      : undefined;
    const LazyComponent = useMemo(
      () => (lazyLoader ? lazy(lazyLoader) : null),
      // lazyRetryKey is intentionally in deps: incrementing it produces a fresh
      // React.lazy() instance, busting the cached rejected Promise on retry.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [lazyLoader, lazyRetryKey],
    );

    const Component = isLazy ? LazyComponent : componentRegistry.get(instance.vesselId);
    if (!Component) {
      if (config.debug) console.warn(`[Maelstrom] No component registered for vessel "${instance.vesselId}"`);
      return null;
    }
    if (!vessel) {
      if (config.debug) console.warn(`[Maelstrom] No vessel definition found for "${instance.vesselId}"`);
      return null;
    }

    const variant = vessel.variants[instance.variant];
    if (!variant) {
      if (config.debug) console.warn(`[Maelstrom] Unknown variant "${instance.variant}" for vessel "${instance.vesselId}"`);
      return null;
    }

    const props = {
      instanceId: instance.instanceId,
      variantProps: { variant: instance.variant, ...variant.props },
      executeAction,
    };

    const LoadingComponent = loadingRegistry.get(instance.vesselId) ?? VesselLoadingSkeleton;
    const loadingFallback = (
      <LoadingComponent vesselId={instance.vesselId} vesselName={vessel.name} />
    );

    const content = isLazy ? (
      <ErrorBoundary
        key={lazyRetryKey}
        fallback={(error) => (
          <VesselLoadError vesselId={instance.vesselId} error={error} debug={config.debug} retry={() => setLazyRetryKey((k) => k + 1)} />
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
      <div style={style} data-instance-id={instance.instanceId}>
        {content}
      </div>
    );
  }, (prev, next) => {
    if (prev.instance.instanceId !== next.instance.instanceId) return false;
    if (prev.instance.variant !== next.instance.variant) return false;
    if (prev.instance.vesselId !== next.instance.vesselId) return false;
    const prevStyle = prev.style;
    const nextStyle = next.style;
    const allKeys = new Set([...Object.keys(prevStyle), ...Object.keys(nextStyle)]);
    for (const key of allKeys) {
      if (prevStyle[key as keyof CSSProperties] !== nextStyle[key as keyof CSSProperties]) return false;
    }
    return true;
  });

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

  function TilingDebugOverlay({ tiles }: { tiles: ComputedTile[] }) {
    return (
      <div
        style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 9999 }}
        data-chart-debug="tiling"
      >
        {tiles.map((tile) => (
          <div
            key={tile.instanceId}
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
    const layout = useStore(orchestrator.commandProcessor.store, (s) => s.layout);
    const instances = useStore(orchestrator.commandProcessor.store, (s) => s.instances);

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
        setContainerRect({ x: 0, y: 0, width, height });
        const columns = Math.floor(width / config.cellSizePx);
        const rows = Math.floor(height / config.cellSizePx);
        orchestrator.chartManager.setDimensions({ columns, rows });
      });

      observer.observe(container);
      return () => observer.disconnect();
    }, [orchestrator, config.cellSizePx]);

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
          [Maelstrom] Only one {'<Chart>'} may be mounted per {'<Provider>'}. Create a
          separate createMaelstrom() instance for multiple charts.
        </div>
      );
    }

    // ── Grid layout rendering ─────────────────────────────────────────────────

    if (!layout || isGridLayout(layout)) {
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

      const gridPositions = (layout as GridLayout | null)?.positions ?? [];
      const instancesToRender = gridPositions
        .map((pos) => {
          const instance = instances.get(pos.instanceId);
          if (!instance && config.debug) {
            console.warn(`[Maelstrom] Grid layout references unknown instance "${pos.instanceId}"`);
          }
          return instance ? { instance, pos } : null;
        })
        .filter(
          (
            item,
          ): item is { instance: VesselInstance; pos: (typeof gridPositions)[number] } =>
            item !== null,
        );

      return (
        <div ref={containerRef} className={className} style={containerStyle}>
          {config.debug && columns > 0 && rows > 0 && (
            <GridDebugOverlay columns={columns} rows={rows} />
          )}
          {instancesToRender.map(({ instance, pos }) => {
            const colStart = pos.position.column + 1;
            const rowStart = pos.position.row + 1;
            const vesselStyle: CSSProperties = {
              gridColumn: `${colStart} / ${colStart + pos.size.width}`,
              gridRow: `${rowStart} / ${rowStart + pos.size.height}`,
              zIndex: 1,
              transition: 'all 0.3s ease-out',
              minWidth: 0,
              minHeight: 0,
            };
            return (
              <VesselRenderer
                key={instance.instanceId}
                instance={instance}
                style={vesselStyle}
              />
            );
          })}
          {children}
        </div>
      );
    }

    // ── Tiling layout rendering ───────────────────────────────────────────────

    if (isTilingLayout(layout)) {
      const tilingLayout = layout as TilingLayout;
      const containerStyle: CSSProperties = {
        ...style,
        position: 'relative',
        width: '100%',
        height: '100%',
        overflow: 'hidden',
      };

      const tree = parseTilingTree(tilingLayout.tree);
      const computedTiles = computeTilingLayout(tree, containerRect, config.tilingPaddingPx);

      const tilesToRender = computedTiles
        .map((tile) => {
          const instance = instances.get(tile.instanceId);
          if (!instance && config.debug) {
            console.warn(`[Maelstrom] Tiling layout references unknown instance "${tile.instanceId}"`);
          }
          return instance ? { instance, tile } : null;
        })
        .filter(
          (item): item is { instance: VesselInstance; tile: ComputedTile } => item !== null,
        );

      return (
        <div ref={containerRef} className={className} style={containerStyle}>
          {tilesToRender.map(({ instance, tile }) => {
            const vesselStyle: CSSProperties = {
              position: 'absolute',
              left: tile.rect.x,
              top: tile.rect.y,
              width: tile.rect.width,
              height: tile.rect.height,
              transition: 'all 0.3s ease-out',
              overflow: 'hidden',
            };
            return (
              <VesselRenderer
                key={instance.instanceId}
                instance={instance}
                style={vesselStyle}
              />
            );
          })}
          {config.debug && <TilingDebugOverlay tiles={computedTiles} />}
          {children}
        </div>
      );
    }

    // Fallback: unknown layout type — render empty container
    if (config.debug) {
      console.warn(`[Maelstrom] Unknown layout type "${(layout as { type: string }).type}", rendering empty container`);
    }
    return (
      <div
        ref={containerRef}
        className={className}
        style={{ ...style, width: '100%', height: '100%', position: 'relative' }}
      >
        {children}
      </div>
    );
  });
}
