// Re-export everything from the React bindings

export type { ChartDebugOverlayProps, ChartProps } from './chart';
// Components
export { Chart, ChartDebugOverlay } from './chart';
export type {
  Engine,
  HttpConnectorOptions,
  MockConnectorOptions,
  WebSocketConnectorOptions,
} from './connectors';

// Connectors
export {
  createDirectConnector,
  createHttpConnector,
  createMockConnector,
  createWebSocketConnector,
} from './connectors';
// Context & Provider
export { MaelstromProvider, useMaelstromContext } from './context';

// Error Boundary (for advanced use cases)
export { ErrorBoundary } from './error-boundary';

// Hooks
export {
  useChartDimensions,
  useChartDimensionsFromViewport,
  useConnectionState,
  useCreateInstance,
  useExecuteAction,
  useInstance,
  useInstanceActions,
  useInstancesByVessel,
  useInstanceVariant,
  useMaelstrom,
  useRemoveInstance,
  useSetChartDimensions,
  useVessel,
  useVesselComponentProps,
  useVesselRegistration,
} from './hooks';

// Loading Components
export type { VesselLoadErrorProps } from './loading';
export { VesselLoadError, VesselLoadingSkeleton } from './loading';

// Registration Helper
export { vesselRegistration } from './registration';

// Types
export type {
  ConnectionState,
  EngineConnector,
  LazyVesselComponentLoader,
  MaelstromProviderProps,
  MaelstromState,
  VesselComponentProps,
  VesselLoadingSkeletonProps,
  VesselRegistration,
} from './types';

// Utilities
export { isLazyLoader } from './types';
