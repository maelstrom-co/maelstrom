// Connector types and functions - re-exported from @maelstrom/client
export type {
  VoiceWebSocketConnectorOptions,
  WebSocketConnectorOptions,
} from '@maelstrom/client';
export {
  VoiceWebSocketConnector,
  WebSocketConnector,
} from '@maelstrom/client';

export type { AudioSetup } from './audio-utils.js';
export {
  clearCachedAudioSetup,
  getCachedAudioSetup,
  requestMicrophoneAccess,
} from './audio-utils.js';
export type { ChartDebugOverlayProps, ChartProps } from './chart.js';
export { Chart, ChartDebugOverlay } from './chart.js';
export { MaelstromProvider, useMaelstromContext } from './context.js';
export { ErrorBoundary } from './error-boundary.js';
export {
  useChartDimensions,
  useChartDimensionsFromViewport,
  useConnectionStatus,
  useInstance,
  useInstanceActions,
  useInstancesByVessel,
  useInstanceVariant,
  useMaelstrom,
  useSetChartDimensions,
  useVessel,
  useVesselActions,
  useVesselComponentProps,
  useVesselRegistration,
} from './hooks.js';
export type { VesselLoadErrorProps } from './loading.js';
export { VesselLoadError, VesselLoadingSkeleton } from './loading.js';
export { vesselRegistration } from './registration.js';
export type { ComputedTile, Rect, TilingTreeNode } from './tiling.js';
export {
  computeTilingLayout,
  getVisibleInstanceIds,
  parseTilingTree,
} from './tiling.js';
export type { TilingChartProps } from './tiling-chart.js';
export { TilingChart } from './tiling-chart.js';
export type {
  ConnectionStatus,
