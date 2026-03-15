// Re-exports from connector.types — kept for internal import compatibility.
// External consumers should import directly from connector.types or the package index.
export type {
  CircuitStatus,
  ConnectionStatus,
  EngineConnector,
  Unsubscribe,
} from './connector.types.js';
export type { ConnectionOptions } from './connection-manager.types.js';
export { DEFAULT_CONNECTION_OPTIONS } from './connection-manager.types.js';
