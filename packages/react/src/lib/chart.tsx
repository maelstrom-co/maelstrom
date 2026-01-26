import type { VesselInstance } from '@maelstrom/client';
import type { LayoutDirective } from '@maelstrom/protocol';
import {
  type CSSProperties,
  type ReactNode,
  Suspense,
  useEffect,
  useMemo,
  useRef,
} from 'react';
import { useMaelstromContext } from './context';
import { ErrorBoundary } from './error-boundary';
import {
  useChartDimensionsFromViewport,
  useVesselComponentProps,
} from './hooks';
import { VesselLoadError, VesselLoadingSkeleton } from './loading';

// ============================================================================
// Chart Container
// ============================================================================

export interface ChartProps {
  /** Additional class name */
  className?: string;
  /** Additional styles */
  style?: CSSProperties;
  /** Show debug grid overlay */
  showGrid?: boolean;
  /** Grid line color (debug mode) */
  gridColor?: string;
  /** Background color */
  backgroundColor?: string;
  /** Children (typically not needed, vessels are rendered automatically) */
  children?: ReactNode;
}

/**
 * The Chart container that renders all vessel instances using CSS Grid.
 * Vessel sizes are determined by their current variant's minSize.
 */
export function Chart({
  className,
  style,
  showGrid = false,
  gridColor = 'rgba(128, 128, 128, 0.2)',
  backgroundColor = 'transparent',
  children,
}: ChartProps) {
  const { state, debug } = useMaelstromContext();
  const containerRef = useRef<HTMLDivElement>(null);
  const updateDimensions = useChartDimensionsFromViewport();

  // Handle resize
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver((entries: ResizeObserverEntry[]) => {
      const entry = entries[0];
      if (entry) {
        const { width, height } = entry.contentRect;
        updateDimensions(width, height);
      }
    });

    observer.observe(container);
    return () => observer.disconnect();
  }, [updateDimensions]);

  const { columns, rows } = state.chartDimensions;

  // CSS Grid container style using 1fr for flexible cell sizing
  const containerStyle: CSSProperties = useMemo(
    () => ({
      display: 'grid',
      gridTemplateColumns: `repeat(${columns}, 1fr)`,
      gridTemplateRows: `repeat(${rows}, 1fr)`,
      width: '100%',
      height: '100%',
      overflow: 'hidden',
      backgroundColor,
      position: 'relative',
      ...style,
    }),
    [columns, rows, backgroundColor, style],
  );

  // Debug grid overlay style
  const gridOverlayStyle: CSSProperties = useMemo(
    () => ({
      position: 'absolute',
      inset: 0,
      backgroundImage: `
        linear-gradient(to right, ${gridColor} 1px, transparent 1px),
        linear-gradient(to bottom, ${gridColor} 1px, transparent 1px)
      `,
      backgroundSize: `${100 / columns}% ${100 / rows}%`,
      pointerEvents: 'none',
      zIndex: 0,
    }),
    [gridColor, columns, rows],
  );

  // Render only what's in the layout directive (engine controls visibility)
  const instancesToRender = state.layout
    .map((directive) => {
      const instance = state.instances.get(directive.instanceId);
      return instance ? { instance, directive } : null;
    })
    .filter(
      (
        item,
      ): item is { instance: VesselInstance; directive: LayoutDirective } =>
        item !== null,
    );

  return (
    <div ref={containerRef} className={className} style={containerStyle}>
      {(showGrid || debug) && <div style={gridOverlayStyle} />}
      {instancesToRender.map(({ instance, directive }) => (
        <VesselRenderer
          key={instance.instanceId}
          instance={instance}
          directive={directive}
        />
      ))}
      {children}
    </div>
  );
}

// ============================================================================
// Vessel Renderer
// ============================================================================

interface VesselRendererProps {
  instance: VesselInstance;
  directive: LayoutDirective;
}

function VesselRenderer({ instance, directive }: VesselRendererProps) {
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

  // Get vessel metadata for the loading skeleton
  const vessel = orchestrator.getRegistry().get(instance.vesselId);
  const isLazy = lazyVesselIds.has(instance.vesselId);

  // Use position and size from the layout directive (engine's instructions)
  const { position, size } = directive;

  // CSS Grid placement using grid-column and grid-row
  // Grid lines are 1-indexed, so we add 1 to the position
  const gridColumnStart = position.column + 1;
  const gridRowStart = position.row + 1;
  const gridColumnEnd = gridColumnStart + size.width;
  const gridRowEnd = gridRowStart + size.height;

  const wrapperStyle: CSSProperties = {
    gridColumn: `${gridColumnStart} / ${gridColumnEnd}`,
    gridRow: `${gridRowStart} / ${gridRowEnd}`,
    zIndex: 1,
    transition: 'all 0.3s ease-out',
    minWidth: 0,
    minHeight: 0,
  };

  // Use custom loading component if provided, otherwise fall back to default
  const LoadingComponent =
    loadingRegistry.get(instance.vesselId) || VesselLoadingSkeleton;
  const loadingFallback = (
    <LoadingComponent vesselId={instance.vesselId} vesselName={vessel?.name} />
  );

  // For lazy components, wrap in Suspense with error boundary
  // For eager components, render directly (Suspense has no effect)
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

// ============================================================================
// Debug Overlay
// ============================================================================

export interface ChartDebugOverlayProps {
  /** Show instance boundaries */
  showBoundaries?: boolean;
  /** Show instance info labels */
  showLabels?: boolean;
}

/**
 * Debug overlay that shows instance positions and info (based on current layout)
 */
export function ChartDebugOverlay({
  showBoundaries = true,
  showLabels = true,
}: ChartDebugOverlayProps) {
  const { state } = useMaelstromContext();
  const { columns, rows } = state.chartDimensions;

  // Use layout for what's rendered, look up instance for variant info
  const layoutItems = state.layout
    .map((directive) => {
      const instance = state.instances.get(directive.instanceId);
      return instance ? { instance, directive } : null;
    })
    .filter(
      (
        item,
      ): item is { instance: VesselInstance; directive: LayoutDirective } =>
        item !== null,
    );

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 9999,
        display: 'grid',
        gridTemplateColumns: `repeat(${columns}, 1fr)`,
        gridTemplateRows: `repeat(${rows}, 1fr)`,
      }}
    >
      {layoutItems.map(({ instance, directive }) => {
        const { position, size } = directive;

        const gridColumnStart = position.column + 1;
        const gridRowStart = position.row + 1;
        const gridColumnEnd = gridColumnStart + size.width;
        const gridRowEnd = gridRowStart + size.height;

        return (
          <div
            key={instance.instanceId}
            style={{
              gridColumn: `${gridColumnStart} / ${gridColumnEnd}`,
              gridRow: `${gridRowStart} / ${gridRowEnd}`,
              border: showBoundaries
                ? '2px dashed rgba(255, 0, 0, 0.5)'
                : undefined,
              boxSizing: 'border-box',
              position: 'relative',
            }}
          >
            {showLabels && (
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
                {instance.instanceId}
                <br />
                {instance.variant}
                <br />({position.column}, {position.row}) {size.width}x
                {size.height}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
