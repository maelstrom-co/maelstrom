/**
 * Maelstrom Client - Message Processing, Layout Management & Connection Handling
 *
 * This package provides the core client infrastructure for processing
 * Maelstrom engine messages, managing vessel layouts, and handling connections
 * using TanStack Store.
 *
 * Architecture:
 * - ConnectionManager: Handles connection lifecycle with retries and circuit breaker
 * - CommandProcessor: Event Loop pattern for processing commands sequentially
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

export type { CloseCodeClassification } from '@maelstrom-co/connectors';
// Shared connection contract — the wire-level pieces moved to
// @maelstrom-co/connectors so engine hosts can import them without a browser
// package. Re-exported here so client consumers keep one import surface.
export {
  classifyCloseCode,
  DEFAULT_HEARTBEAT_INTERVAL_MS,
  HEARTBEAT_PING_FRAME,
  HEARTBEAT_PONG_FRAME,
  isHeartbeatPingFrame,
  isHeartbeatPongFrame,
} from '@maelstrom-co/connectors';
// `TilingSplit` is the axis type accepted by createTilingSplitNode's
// `direction` parameter; `Result` is what CommandProcessor.waitForIdle resolves.
export type { Result, TilingSplit } from '@maelstrom-co/protocol';
// Identity primitives re-exported from protocol for convenience.
// Each name exports both the branded type and the factory function.
export { MessageId, SessionId } from '@maelstrom-co/protocol';
// Chart Manager
export type { ChartManagerEvents } from './lib/chart-manager/chart-manager.js';
export { ChartManager } from './lib/chart-manager/chart-manager.js';
export {
  type ChartManagerState,
  createInitialChartManagerState,
} from './lib/chart-manager/chart-manager.state.js';
export type { ChartManagerOptions } from './lib/chart-manager/chart-manager.types.js';
export type {
  ComputedTile,
  Rect,
  TilingLeafNode,
  TilingSplitChild,
  TilingSplitNode,
  TilingTreeNode,
} from './lib/chart-manager/tiling.js';
export {
  computeTilingLayout,
  createTilingSplitNode,
  parseTilingTree,
} from './lib/chart-manager/tiling.js';
// Action Manager
export { ActionManager } from './lib/command-processor/action-manager.js';
export type { ActionResult } from './lib/command-processor/action-result.js';
export type {
  ActionHandler,
  ActionNames,
  ActionParams,
  ActionRecord,
  ActionRunner,
  AnyActionRunner,
  BatchExecutionResult,
  VariantNames,
} from './lib/command-processor/action-runner.types.js';
// Command Processor
export type {
  Command,
  ExecuteActionsCommand,
  SetLayoutCommand,
} from './lib/command-processor/command.types.js';
export type { CommandBatchResult } from './lib/command-processor/command-batch-result.js';
export type { CommandProcessorEvents } from './lib/command-processor/command-processor.js';
export { CommandProcessor } from './lib/command-processor/command-processor.js';
export {
  type CommandProcessingState,
  type CommandProcessingStatus,
  createInitialCommandProcessingState,
} from './lib/command-processor/command-processor.state.js';
export type { CommandProcessorOptions } from './lib/command-processor/command-processor.types.js';
// Layout Manager
export { applyLayout } from './lib/command-processor/layout-manager.js';
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
  AcknowledgedAssistantConnector,
  AssistantMessage,
  AssistantMessageOutcome,
  CircuitStatus,
  ConnectionStatus,
  ConnectorCapabilities,
  ConnectorEvent,
  EngineConnector,
  PushConnector,
} from './lib/connection-manager/connector.types.js';
export {
  isAcknowledgedAssistantConnector,
  WireEngineError,
} from './lib/connection-manager/connector.types.js';
export type { HttpConnectorOptions } from './lib/connection-manager/connectors/http-connector.js';
// Connectors
export { HttpConnector } from './lib/connection-manager/connectors/http-connector.js';
export type { WebSocketConnectorOptions } from './lib/connection-manager/connectors/web-socket-connector.js';
export { WebSocketConnector } from './lib/connection-manager/connectors/web-socket-connector.js';
// Orchestrator
export { buildChartRequest } from './lib/orchestrator/build-chart-request.js';
export { ConnectorSupersededError } from './lib/orchestrator/connector-superseded-error.js';
export type {
  EnqueueIntentOptions,
  IntentNotSubmittedReason,
  IntentQueueOptions,
  IntentResult,
  IntentSchedulerState,
  IntentSchedulerView,
  IntentScope,
  IntentSnapshot,
  IntentSubmission,
} from './lib/orchestrator/intent-scheduler.types.js';
export { Orchestrator } from './lib/orchestrator/orchestrator.js';
export type {
  GridOrchestratorOptions,
  OrchestratorOptions,
  OrchestratorOptionsBase,
  OrchestratorViewState,
  ResolvedOrchestratorOptions,
  TilingOrchestratorOptions,
} from './lib/orchestrator/orchestrator.types.js';
export { DEFAULT_LAYOUT_MODE } from './lib/orchestrator/orchestrator.types.js';
export type {
  RequestCoordinatorEvents,
  RequestCoordinatorState,
} from './lib/orchestrator/request-coordinator.js';
export { RequestCoordinator } from './lib/orchestrator/request-coordinator.js';
export type { RequestCoordinatorOptions } from './lib/orchestrator/request-coordinator.types.js';
export { RequestInFlightError } from './lib/orchestrator/request-in-flight-error.js';
// Types
export type { Unsubscribe, VesselInstance } from './lib/types.js';
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
// Voice Session
export type {
  CapabilityOptionOmission,
  CapabilitySnapshot,
  CapabilitySnapshotProjection,
  VesselCapability,
  VesselCapabilityAction,
  VesselCapabilityParameter,
  VesselCapabilityVariant,
} from './lib/voice-session/capability-snapshot.js';
export {
  MAX_CAPABILITY_OPTION_COUNT,
  MAX_CAPABILITY_OPTIONS_TOTAL_CHARS,
  readCapabilitySnapshot,
} from './lib/voice-session/capability-snapshot.js';
export type { UIStructuralSnapshot } from './lib/voice-session/ui-structural-snapshot.js';
export { readStructuralSnapshot } from './lib/voice-session/ui-structural-snapshot.js';
export type {
  TimedTranscriptFragment,
  VoiceActivity,
  VoiceApplicationWork,
  VoiceApplicationWorkSource,
  VoiceCaption,
  VoiceConnectionState,
  VoiceMediaObservation,
  VoiceObservationSnapshot,
  VoiceObservationSource,
} from './lib/voice-session/voice-observations.js';
export type {
  GroundingUpdate,
  SpeakableResult,
  TranscriptEntry,
  VoiceSession,
  VoiceSessionState,
} from './lib/voice-session/voice-session.types.js';
