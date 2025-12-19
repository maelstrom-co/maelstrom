import { useRef, useEffect, useMemo, type CSSProperties, type ReactNode } from 'react';
import type { VesselInstance } from '@maelstrom/protocol';
import { useMaelstromContext } from './context';
import { useChartDimensionsFromViewport, useVesselComponentProps } from './hooks';

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
 * The Chart container that renders all vessel instances.
 * Automatically manages viewport dimensions and positions vessels.
 */
export function Chart({
  className,
  style,
  showGrid = false,
  gridColor = 'rgba(128, 128, 128, 0.2)',
  backgroundColor = 'transparent',
  children,
}: ChartProps) {
  const { state, cellSizePx, debug } = useMaelstromContext();
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

  // Container style
  const containerStyle: CSSProperties = useMemo(
    () => ({
      position: 'relative',
      width: '100%',
      height: '100%',
      overflow: 'hidden',
      backgroundColor,
      ...style,
    }),
    [backgroundColor, style]
  );

  // Debug grid style
  const gridStyle: CSSProperties = useMemo(
    () => ({
      position: 'absolute',
      inset: 0,
      backgroundImage: `
        linear-gradient(to right, ${gridColor} 1px, transparent 1px),
        linear-gradient(to bottom, ${gridColor} 1px, transparent 1px)
      `,
      backgroundSize: `${cellSizePx}px ${cellSizePx}px`,
      pointerEvents: 'none',
      zIndex: 0,
    }),
    [gridColor, cellSizePx]
  );

  // Get all instances
  const instances = Array.from(state.instances.values());

  return (
    <div ref={containerRef} className={className} style={containerStyle}>
      {(showGrid || debug) && <div style={gridStyle} />}
      {instances.map((instance) => (
        <VesselRenderer key={instance.instanceId} instance={instance} />
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
}

function VesselRenderer({ instance }: VesselRendererProps) {
  const { state, cellSizePx } = useMaelstromContext();
  const props = useVesselComponentProps(instance.instanceId);

  const registration = state.vessels.get(instance.vesselId);
  if (!registration || !props) {
    return null;
  }

  const Component = registration.component;

  // Calculate pixel position and size
  const pixelX = instance.position.column * cellSizePx;
  const pixelY = instance.position.row * cellSizePx;
  const pixelWidth = instance.size.width * cellSizePx;
  const pixelHeight = instance.size.height * cellSizePx;

  const wrapperStyle: CSSProperties = {
    position: 'absolute',
    left: 0,
    top: 0,
    width: pixelWidth,
    height: pixelHeight,
    transform: `translate3d(${pixelX}px, ${pixelY}px, 0)`,
    transition: 'transform 0.3s ease-out, width 0.3s ease-out, height 0.3s ease-out',
    willChange: 'transform',
    zIndex: 1,
  };

  return (
    <div style={wrapperStyle} data-instance-id={instance.instanceId}>
      <Component {...props} />
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
 * Debug overlay that shows instance positions and info
 */
export function ChartDebugOverlay({
  showBoundaries = true,
  showLabels = true,
}: ChartDebugOverlayProps) {
  const { state, cellSizePx } = useMaelstromContext();
  const instances = Array.from(state.instances.values());

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 9999,
      }}
    >
      {instances.map((instance) => {
        const pixelX = instance.position.column * cellSizePx;
        const pixelY = instance.position.row * cellSizePx;
        const pixelWidth = instance.size.width * cellSizePx;
        const pixelHeight = instance.size.height * cellSizePx;

        return (
          <div
            key={instance.instanceId}
            style={{
              position: 'absolute',
              left: pixelX,
              top: pixelY,
              width: pixelWidth,
              height: pixelHeight,
              border: showBoundaries ? '2px dashed rgba(255, 0, 0, 0.5)' : undefined,
              boxSizing: 'border-box',
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
                <br />
                ({instance.position.column}, {instance.position.row}) {instance.size.width}x
                {instance.size.height}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
