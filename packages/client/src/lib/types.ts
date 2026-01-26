import type {
  ChartDimensions,
  ChartPosition,
  ChartRequest,
  ChartSize,
  LayoutDirective,
  MaelstromResponse,
} from '@maelstrom/protocol';

// ============================================================================
// Rendering Constants (moved from protocol)
// ============================================================================

/** Default chart cell size in pixels */
export const DEFAULT_CELL_SIZE_PX = 80;

// ============================================================================
// Rendering Types (moved from protocol)
// ============================================================================

/** Pixel dimensions (for rendering) */
export interface PixelDimensions {
  width: number;
  height: number;
}

/** Configuration for the Chart */
export interface ChartConfig {
  /** Size of each chart cell in pixels. Defaults to DEFAULT_CELL_SIZE_PX (80) */
  cellSizePx?: number;
}

// ============================================================================
// Runtime Types
// ============================================================================

/** Runtime instance of a Vessel */
export interface VesselInstance {
  /** Unique instance ID */
  instanceId: string;
  /** ID of the Vessel type */
  vesselId: string;
  /** Current variant name */
  variant: string;
  /** Current position on the Chart */
  position: ChartPosition;
  /** Current size (>= variant's minSize) */
  size: ChartSize;
}

// ============================================================================
// Connection Types
// ============================================================================

export type ConnectionState =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'error';

/**
 * Message to inject into history without LLM processing.
 */
export interface AssistantMessage {
  sessionId: string;
  message: string;
}

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
  /** Optional: add an assistant message to history without LLM processing */
  addAssistantMessage?(message: AssistantMessage): Promise<void>;
}

// ============================================================================
// State Types
// ============================================================================

export interface MaelstromState {
  /** Active vessel instances (tracks variant state and position) */
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

// ============================================================================
// Client Configuration
// ============================================================================

export interface ClientConfig {
  /** Session ID for conversation continuity */
  sessionId?: string;
  /** Cell size in pixels (default: 80) */
  cellSizePx?: number;
  /** Enable debug mode */
  debug?: boolean;
}
