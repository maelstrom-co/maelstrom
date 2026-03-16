import { useStore } from '@tanstack/react-store';
%%%%%%% diff from: nqvxrurm 2789a6b4 "chore: remove completed migration plan files" (parents of rebased revision)
\\\\\\\        to: rqoqwskx b424e402 "chore: rename package scope from @maelstrom to @maelstrom-co" (rebased revision)
 import {
   type CSSProperties,
   memo,
   type ReactNode,
   Suspense,
   useCallback,
   useEffect,
   useMemo,
   useRef,
 } from 'react';
 
-import type { VesselInstance } from '@maelstrom/client';
-import type { ChartSize, GridLayout, TilingLayout } from '@maelstrom/protocol';
-import { isGridLayout, isTilingLayout } from '@maelstrom/protocol';
+import type { VesselInstance } from '@maelstrom-co/client';
+import type { ChartSize, GridLayout, TilingLayout } from '@maelstrom-co/protocol';
+import { isGridLayout, isTilingLayout } from '@maelstrom-co/protocol';
 
 import { useMaelstromContext } from './context.js';
 import { ErrorBoundary } from './error-boundary.js';
 import {
   useChartDimensionsFromViewport,
   useVesselComponentProps,
 } from './hooks.js';
 import { VesselLoadError, VesselLoadingSkeleton } from './loading.js';
 import { TilingChart } from './tiling-chart.js';
 
 export interface ChartProps {
   className?: string;
   style?: CSSProperties;
   showGrid?: boolean;
   gridColor?: string;
   backgroundColor?: string;
   children?: ReactNode;
 }
 
 export const Chart = memo(function Chart(props: ChartProps) {
   const { layoutMode } = useMaelstromContext();
 
   console.log('Layout', layoutMode);
 
   if (layoutMode === 'tiling') {
     return (
       <TilingChart
         className={props.className}
         style={props.style}
         backgroundColor={props.backgroundColor}
       >
         {props.children}
       </TilingChart>
     );
   }
 
   return <GridChart {...props} />;
 });
 
 function extractInstanceIdsFromLayout(
   layout: GridLayout | TilingLayout | null,
 ): string[] {
   if (!layout) {
     return [];
   }
   if (isGridLayout(layout)) {
     return layout.positions.map((p) => p.instanceId);
   }
   if (isTilingLayout(layout)) {
     const ids: string[] = [];
     for (const node of layout.tree) {
       if (node !== null && node !== 'H' && node !== 'V') {
         ids.push(node);
       }
     }
     return ids;
   }
   return [];
 }
 
 interface GridPosition {
   instanceId: string;
   column: number;
   row: number;
   width: number;
   height: number;
 }
 
 function computeGridPositions(
   instanceIds: string[],
   columns: number,
   rows: number,
   _instances: Map<string, VesselInstance>,
   getMinSize: (instanceId: string) => ChartSize,
 ): GridPosition[] {
   const positions: GridPosition[] = [];
   const grid: boolean[][] = Array.from({ length: rows }, () =>
     Array(columns).fill(false),
   );
 
   for (const instanceId of instanceIds) {
     const minSize = getMinSize(instanceId);
     const width = Math.min(minSize.width, columns);
     const height = Math.min(minSize.height, rows);
 
     let placed = false;
     for (let r = 0; r <= rows - height && !placed; r++) {
       for (let c = 0; c <= columns - width && !placed; c++) {
         let canPlace = true;
         for (let dr = 0; dr < height && canPlace; dr++) {
           for (let dc = 0; dc < width && canPlace; dc++) {
             if (grid[r + dr][c + dc]) {
               canPlace = false;
             }
           }
         }
 
         if (canPlace) {
           for (let dr = 0; dr < height; dr++) {
             for (let dc = 0; dc < width; dc++) {
               grid[r + dr][c + dc] = true;
             }
           }
           positions.push({
             instanceId,
             column: c,
             row: r,
             width,
             height,
           });
           placed = true;
         }
       }
     }
 
     if (!placed) {
       positions.push({
         instanceId,
         column: 0,
         row: 0,
         width: 1,
         height: 1,
       });
     }
   }
 
   return positions;
 }
 
 function GridChart({
   className,
   style,
   showGrid = false,
   gridColor = 'rgba(128, 128, 128, 0.2)',
   backgroundColor = 'transparent',
   children,
 }: ChartProps) {
   const { messageProcessorStore, debug, orchestrator } = useMaelstromContext();
   const containerRef = useRef<HTMLDivElement>(null);
   const updateDimensions = useChartDimensionsFromViewport();
   const chartDimensions = useStore(
     orchestrator.chartManager.store,
     (state) => state.chartDimensions,
   );
   const layout = useStore(messageProcessorStore, (state) => state.layout);
   const instances = useStore(messageProcessorStore, (state) => state.instances);
 
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
 
   const { columns, rows } = chartDimensions;
 
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
 
   const getMinSize = useCallback(
     (instanceId: string): ChartSize => {
       const instance = instances.get(instanceId);
       if (!instance) return { width: 1, height: 1 };
       const vessel = orchestrator.vesselManager.get(instance.vesselId);
       if (!vessel) return { width: 1, height: 1 };
       const variant = vessel.variants[instance.variant];
       return variant?.minSize ?? { width: 1, height: 1 };
     },
     [instances, orchestrator],
   );
 
   const instanceIds = useMemo(
     () => extractInstanceIdsFromLayout(layout),
     [layout],
   );
 
   const gridPositions = useMemo(
     () =>
       computeGridPositions(instanceIds, columns, rows, instances, getMinSize),
     [instanceIds, columns, rows, instances, getMinSize],
   );
 
   const instancesToRender = gridPositions
     .map((pos) => {
       const instance = instances.get(pos.instanceId);
       return instance ? { instance, position: pos } : null;
     })
     .filter(
       (item): item is { instance: VesselInstance; position: GridPosition } =>
         item !== null,
     );
 
   return (
     <div ref={containerRef} className={className} style={containerStyle}>
       {(showGrid || debug) && <div style={gridOverlayStyle} />}
       {instancesToRender.map(({ instance, position }) => (
         <VesselRenderer
           key={instance.instanceId}
           instance={instance}
           position={position}
         />
       ))}
       {children}
     </div>
   );
 }
 
 interface VesselRendererProps {
   instance: VesselInstance;
   position: GridPosition;
 }
 
 function VesselRenderer({ instance, position }: VesselRendererProps) {
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
 
   const gridColumnStart = position.column + 1;
   const gridRowStart = position.row + 1;
   const gridColumnEnd = gridColumnStart + position.width;
   const gridRowEnd = gridRowStart + position.height;
 
   const wrapperStyle: CSSProperties = {
     gridColumn: `${gridColumnStart} / ${gridColumnEnd}`,
     gridRow: `${gridRowStart} / ${gridRowEnd}`,
     zIndex: 1,
     transition: 'all 0.3s ease-out',
     minWidth: 0,
     minHeight: 0,
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
 
 export interface ChartDebugOverlayProps {
   showBoundaries?: boolean;
   showLabels?: boolean;
 }
 
 export function ChartDebugOverlay({
   showBoundaries = true,
   showLabels = true,
 }: ChartDebugOverlayProps) {
   const { messageProcessorStore, orchestrator } = useMaelstromContext();
   const chartDimensions = useStore(
     orchestrator.chartManager.store,
     (state) => state.chartDimensions,
   );
   const layout = useStore(messageProcessorStore, (state) => state.layout);
   const instances = useStore(messageProcessorStore, (state) => state.instances);
   const { columns, rows } = chartDimensions;
 
   const getMinSize = (instanceId: string): ChartSize => {
     const instance = instances.get(instanceId);
     if (!instance) return { width: 1, height: 1 };
     const vessel = orchestrator.vesselManager.get(instance.vesselId);
     if (!vessel) return { width: 1, height: 1 };
     const variant = vessel.variants[instance.variant];
     return variant?.minSize ?? { width: 1, height: 1 };
   };
 
   const instanceIds = extractInstanceIdsFromLayout(layout);
   const gridPositions = computeGridPositions(
     instanceIds,
     columns,
     rows,
     instances,
     getMinSize,
   );
 
   const layoutItems = gridPositions
     .map((pos) => {
       const instance = instances.get(pos.instanceId);
       return instance ? { instance, position: pos } : null;
     })
     .filter(
       (item): item is { instance: VesselInstance; position: GridPosition } =>
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
       {layoutItems.map(({ instance, position }) => {
         const gridColumnStart = position.column + 1;
         const gridRowStart = position.row + 1;
         const gridColumnEnd = gridColumnStart + position.width;
         const gridRowEnd = gridRowStart + position.height;
 
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
                 <br />({position.column}, {position.row}) {position.width}x
                 {position.height}
               </div>
             )}
           </div>
         );
       })}
     </div>
   );
 }
