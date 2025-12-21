import type {
  ActionExecution,
  ChartDimensions,
  ChartRequest,
  LayoutDirective,
  MaelstromEvent,
  MaelstromResponse,
  Vessel,
  VesselInstance,
} from '@maelstrom/protocol';

// ============================================================================
// Connection Types
// ============================================================================

export type ConnectionState =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'error';

/**
 * Engine connector - abstraction over transport mechanism.
 * Can be implemented for WebSocket, HTTP, or direct in-memory calls.
 */
export interface EngineConnector {
  /** Send a request to the engine and get a response */
  process(request: ChartRequest): Promise<MaelstromResponse>;
  /** Optional: connect to the engine (for stateful connections like WebSocket) */
  connect?(): Promise<void>;
  /** Optional: disconnect from the engine */
  disconnect?(): void;
  /** Optional: subscribe to connection state changes */
  onConnectionStateChange?(
    callback: (state: ConnectionState) => void,
  ): () => void;
}

// ============================================================================
// Registry Types
// ============================================================================

export interface VesselRegistration {
  vessel: Vessel;
  /** React component to render this vessel */
  component: React.ComponentType<VesselComponentProps>;
}

export interface VesselComponentProps {
  /** The vessel instance being rendered */
  instance: VesselInstance;
  /** Current variant's props */
  variantProps: Record<string, unknown>;
  /** Execute an action on this instance */
  executeAction: (actionName: string, params?: Record<string, unknown>) => void;
}

// ============================================================================
// Orchestrator State
// ============================================================================

export interface MaelstromState {
  /** Registered vessel definitions */
  vessels: Map<string, VesselRegistration>;
  /** Active vessel instances (tracks variant state) */
  instances: Map<string, VesselInstance>;
  /** Current layout from engine - source of truth for what's rendered */
  layout: LayoutDirective[];
  /** Current chart dimensions */
  chartDimensions: ChartDimensions;
  /** Connection state */
  connectionState: ConnectionState;
  /** Whether a request is in flight */
  isProcessing: boolean;
  /** Last error message */
  lastError: string | null;
  /** Last engine response */
  lastResponse: MaelstromResponse | null;
}

export type MaelstromAction =
  | { type: 'REGISTER_VESSEL'; registration: VesselRegistration }
  | { type: 'UNREGISTER_VESSEL'; vesselId: string }
  | { type: 'ADD_INSTANCE'; instance: VesselInstance }
  | {
      type: 'UPDATE_INSTANCE';
      instanceId: string;
      updates: Partial<VesselInstance>;
    }
  | { type: 'REMOVE_INSTANCE'; instanceId: string }
  | { type: 'SET_CHART_DIMENSIONS'; dimensions: ChartDimensions }
  | { type: 'SET_CONNECTION_STATE'; state: ConnectionState }
  | { type: 'SET_PROCESSING'; isProcessing: boolean }
  | { type: 'SET_ERROR'; error: string | null }
  | { type: 'APPLY_LAYOUT'; directives: LayoutDirective[] }
  | { type: 'EXECUTE_ACTION'; execution: ActionExecution }
  | { type: 'SET_LAST_RESPONSE'; response: MaelstromResponse | null };

// ============================================================================
// Provider Config
// ============================================================================

export interface MaelstromProviderProps {
  /** Engine connector for communication */
  connector: EngineConnector;
  /** Session ID for conversation continuity */
  sessionId?: string;
  /** Cell size in pixels (default: 80) */
  cellSizePx?: number;
  /** Enable debug mode */
  debug?: boolean;
  /** Event handler for Maelstrom events */
  onEvent?: (event: MaelstromEvent) => void;
  /**
   * Called when the engine returns a response.
   * Use this to handle userMessage (display in chat, speak via TTS, etc.)
   */
  onResponse?: (response: MaelstromResponse) => void;
  /**
   * Called when an error occurs during processing.
   */
  onError?: (error: Error) => void;
  /** Children */
  children: React.ReactNode;
}
