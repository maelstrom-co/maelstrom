import type { VesselInstance } from '@maelstrom-co/client';
import { isTilingLayout } from '@maelstrom-co/protocol-old';
import { useStore } from '@tanstack/react-store';
import {
  type CSSProperties,
  type ReactNode,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { useMaelstromContext } from './context.js';
import { ErrorBoundary } from './error-boundary.js';
import {
  useChartDimensionsFromViewport,
  useVesselComponentProps,
} from './hooks.js';
import { VesselLoadError, VesselLoadingSkeleton } from './loading.js';
import {
  type ComputedTile,
  computeTilingLayout,
  parseTilingTree,
  type Rect,
} from './tiling.js';

export interface TilingChartProps {
  className?: string | undefined;
  style?: CSSProperties | undefined;
  backgroundColor?: string | undefined;
  children?: ReactNode;
}

export function TilingChart({
  className,
  style,
  backgroundColor = 'transparent',
  children,
}: TilingChartProps) {
  const { commandProcessorStore, tilingPadding, debug } = useMaelstromContext();
  const containerRef = useRef<HTMLDivElement>(null);
  const layout = useStore(commandProcessorStore, (state) => state.layout);
  const instances = useStore(commandProcessorStore, (state) => state.instances);
  const [containerRect, setContainerRect] = useState<Rect>({
    x: 0,
    y: 0,
    width: 0,
    height: 0,
  });
  const updateDimensions = useChartDimensionsFromViewport();

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver((entries: ResizeObserverEntry[]) => {
      const entry = entries[0];
      if (entry) {
        const { width, height } = entry.contentRect;
        setContainerRect({ x: 0, y: 0, width, height });
        updateDimensions(width, height);
      }
    });

    observer.observe(container);
    return () => observer.disconnect();
  }, [updateDimensions]);

  const tree = useMemo(() => {
    if (layout && isTilingLayout(layout)) {
      return parseTilingTree(layout.tree);
    }
    return null;
  }, [layout]);

  const computedTiles = useMemo(
    () => computeTilingLayout(tree, containerRect, tilingPadding),
    [tree, containerRect, tilingPadding],
  );

  const tilesToRender = computedTiles
    .map((tile) => {
      const instance = instances.get(tile.instanceId);
      return instance ? { instance, tile } : null;
    })
    .filter(
      (item): item is { instance: VesselInstance; tile: ComputedTile } =>
        item !== null,
    );

  const containerStyle: CSSProperties = useMemo(
    () => ({
      position: 'relative',
      width: '100%',
      height: '100%',
      overflow: 'hidden',
      backgroundColor,
      ...style,
    }),
    [backgroundColor, style],
  );

  return (
    <div ref={containerRef} className={className} style={containerStyle}>
      {tilesToRender.map(({ instance, tile }) => (
        <TilingVesselRenderer
          key={instance.instanceId}
          instance={instance}
          tile={tile}
        />
      ))}
      {debug && <TilingDebugOverlay tiles={computedTiles} />}
      {children}
    </div>
  );
}

interface TilingVesselRendererProps {
  instance: VesselInstance;
  tile: ComputedTile;
}

function TilingVesselRenderer({ instance, tile }: TilingVesselRendererProps) {
  const {
    componentRegistry,
    loadingRegistry,
    orchestrator,
    lazyVesselIds,
    debug,
  } = useMaelstromContext();
  const props = useVesselComponentProps(instance.instanceId);

  const Component = componentRegistry.get(instance.vesselId);
  if (!Component || !props) {
    return null;
  }

  const vessel = orchestrator.vesselManager.get(instance.vesselId);
  const isLazy = lazyVesselIds.has(instance.vesselId);

  const { rect } = tile;

  const wrapperStyle: CSSProperties = {
    position: 'absolute',
    left: rect.x,
    top: rect.y,
    width: rect.width,
    height: rect.height,
    transition: 'all 0.3s ease-out',
    overflow: 'hidden',
  };

  const LoadingComponent =
    loadingRegistry.get(instance.vesselId) || VesselLoadingSkeleton;
  const loadingProps: { vesselId: string; vesselName?: string } = {
    vesselId: instance.vesselId,
  };
  if (vessel?.name !== undefined) {
    loadingProps.vesselName = vessel.name;
  }
  const loadingFallback = <LoadingComponent {...loadingProps} />;

  const content = isLazy ? (
    <ErrorBoundary
      fallback={(error, retry) => (
        <VesselLoadError
          vesselId={instance.vesselId}
          error={error}
          retry={retry}
        />
      )}
      onError={(error) => {
        if (debug) {
          console.error(
            `[Maelstrom] Failed to load vessel component: ${instance.vesselId}`,
            error,
          );
        }
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
    <div style={wrapperStyle} data-instance-id={instance.instanceId}>
      {content}
    </div>
  );
}

interface TilingDebugOverlayProps {
  tiles: ComputedTile[];
}

function TilingDebugOverlay({ tiles }: TilingDebugOverlayProps) {
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 9999,
      }}
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
            border: '2px dashed rgba(255, 0, 0, 0.5)',
            boxSizing: 'border-box',
          }}
        >
          <div
            style={{
              position: 'absolute',
              top: 2,
              left: 2,
              background: 'rgba(0, 0, 0, 0.7)',
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
