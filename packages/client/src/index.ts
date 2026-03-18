/**
 * Maelstrom Client - Message Processing, Layout Management & Connection Handling
 *
 * This package provides the core client infrastructure for processing
 * Maelstrom engine messages, managing vessel layouts, and handling connections
 * using TanStack Store.
 *
 * Architecture:
 * - ConnectionManager: Handles connection lifecycle with retries and circuit breaker
 * - MessageProcessor: Event Loop pattern for processing messages sequentially
 *
 * @example
 * ```typescript
 * import { Orchestrator, WebSocketConnector } from '@maelstrom-co/client';
 *
 * const connector = new WebSocketConnector({ url: 'ws://localhost:8080' });
 * const orchestrator = new Orchestrator(connector, { debug: true });
 *
 * await orchestrator.connect();
 * const response = await orchestrator.processIntent('show me data');
 * ```
 */

// Chart Manager
export type { ChartManagerEvents } from './lib/chart-manager/chart-manager.js';
export { ChartManager } from './lib/chart-manager/chart-manager.js';
export {
  type ChartManagerState,
  createInitialChartManagerState,
} from './lib/chart-manager/chart-manager.state.js';
export type { ChartManagerOptions } from './lib/chart-manager/chart-manager.types.js';
// Connection Manager
export type { ConnectionManagerEvents } from './lib/connection-manager/connection-manager.js';
export { ConnectionManager } from './lib/connection-manager/connection-manager.js';
export type { ConnectionManagerState } from './lib/connection-manager/connection-manager.state.js';
// Connection options (owned by ConnectionManager)
export type {
  ConnectionManagerOptions,
  ConnectionOptions,
} from './lib/connection-manager/connection-manager.types.js';
// Connector types (client-specific transport interfaces)
export type {
  AssistantMessage,
  AudioChunk,
  AudioFrameMeta,
  CircuitStatus,
  ConnectionStatus,
  ConnectorCapabilities,
  ConnectorEvent,
  EngineConnector,
  PushConnector,
  Unsubscribe,
  VoiceConnector,
} from './lib/connection-manager/connector.types.js';
// Connector functions and constants (not types)
export { AUDIO_FRAME_FLAGS } from './lib/connection-manager/connector.types.js';
export type { HttpConnectorOptions } from './lib/connection-manager/connectors/http-connector.js';
// Connectors
export { HttpConnector } from './lib/connection-manager/connectors/http-connector.js';
// Connector utilities for audio frame handling (used by all voice connectors)
export {
  packAudioFrame,
  parseAudioFrame,
} from './lib/connection-manager/connectors/utils.js';
export type { VoiceWebSocketConnectorOptions } from './lib/connection-manager/connectors/voice-web-socket-connector.js';
export { VoiceWebSocketConnector } from './lib/connection-manager/connectors/voice-web-socket-connector.js';
export type { WebSocketConnectorOptions } from './lib/connection-manager/connectors/web-socket-connector.js';
export { WebSocketConnector } from './lib/connection-manager/connectors/web-socket-connector.js';
// Action Manager
export { ActionManager } from './lib/message-processor/action-manager.js';
export type {
  ActionRecord,
  ActionRunner,
  AnyActionRunner,
  BatchExecutionResult,
} from './lib/message-processor/action-runner.types.js';
// Layout Manager
export { applyLayout } from './lib/message-processor/layout-manager.js';
export type { MessageProcessorEvents } from './lib/message-processor/message-processor.js';
// Message Processor
export { MessageProcessor } from './lib/message-processor/message-processor.js';
export type { MessageProcessorOptions } from './lib/message-processor/message-processor.types.js';
export type { MessageProcessingState } from './lib/message-processor/types.js';
// Orchestrator
export { buildChartRequest } from './lib/orchestrator/build-chart-request.js';
export { Orchestrator } from './lib/orchestrator/orchestrator.js';
export type {
  OrchestratorOptions,
  OrchestratorViewState,
  ResolvedOrchestratorOptions,
} from './lib/orchestrator/orchestrator.types.js';
export type {
  RequestCoordinatorEvents,
  RequestCoordinatorState,
} from './lib/orchestrator/request-coordinator.js';
export { RequestCoordinator } from './lib/orchestrator/request-coordinator.js';
export type { RequestCoordinatorOptions } from './lib/orchestrator/request-coordinator.types.js';
// Types
export type { VesselInstance } from './lib/types.js';
export type { UpdateCoordinatorEvents } from './lib/update-coordination/update-coordinator.js';
// Update Coordination
export { UpdateCoordinator } from './lib/update-coordination/update-coordinator.js';
export type { UpdateCoordinatorOptions } from './lib/update-coordination/update-coordinator.types.js';
// Utilities
export { Logger } from './lib/utils/logger.js';
export type { EventMap, EventSubscriber } from './lib/utils/typed-emitter.js';
export { TypedEmitter } from './lib/utils/typed-emitter.js';
// Vessel Management
export type { VesselManagerEvents } from './lib/vessel-management/vessel-manager.js';
export { VesselManager } from './lib/vessel-management/vessel-manager.js';
export {
  createInitialVesselManagerState,
  type VesselManagerState,
} from './lib/vessel-management/vessel-manager.state.js';
export type { VesselManagerOptions } from './lib/vessel-management/vessel-manager.types.js';
