import type { ChartDimensions, ChartPosition, ChartSize } from './chart.js';
import type { Vessel } from './vessel.js';

/** Request from client to engine */
export interface ChartRequest {
  type: 'chart_request';
  /** Unique request ID for correlation */
  id: string;
  /** Request context */
  context: {
    /** The user's natural language intent */
    userIntent: string;
    /** Current Chart dimensions */
    chartDimensions: ChartDimensions;
    /** Unix timestamp */
    timestamp: number;
    /** Session identifier for conversation continuity */
    sessionId: string;
  };
  /** All Vessel instances with their current variant state */
  instances: VesselInstanceSnapshot[];
  /** All registered Vessel definitions */
  vessels: Vessel[];
  /** Current layout - which instances are visible and where (empty = all hidden) */
  layout: LayoutDirective[];
}

/** Snapshot of a Vessel instance's state (for wire transfer) */
export interface VesselInstanceSnapshot {
  instanceId: string;
  vesselId: string;
  variant: string;
}

/** TTS configuration for speech output */
export interface SpeechOutput {
  /** Priority level - 'high' interrupts current speech */
  priority?: 'low' | 'normal' | 'high';
  /** Voice identifier hint */
  voice?: string;
}

/** Response from engine to client */
export interface MaelstromResponse {
  type: 'maelstrom_response';
  /** Correlates to request ID */
  requestId: string;
  /** User-facing conversational message (displayed as text or spoken via TTS) */
  userMessage: string;
  /** LLM's internal reasoning for debugging/transparency (not shown to user) */
  rationale: string;
  /** Actions to execute (in order) */
  executionPlan: ActionExecution[];
  /** Layout changes to apply after actions complete */
  layoutDirective: LayoutDirective[];
  /** Optional TTS configuration for userMessage */
  speechOutput?: SpeechOutput;
}

/** An action to execute on a Vessel instance */
export interface ActionExecution {
  /** Target Vessel instance */
  instanceId: string;
  /** Action name (must be valid for current variant) */
  action: string;
  /** Action parameters */
  params?: Record<string, unknown>;
}

/** Instruction to position a Vessel on the Chart */
export interface LayoutDirective {
  /** Target Vessel instance */
  instanceId: string;
  /** New position on the Chart */
  position: ChartPosition;
  /** Size to allocate (must be >= variant's minSize) */
  size: ChartSize;
}

/** Error response from engine */
export interface ErrorResponse {
  type: 'error';
  /** Correlates to request ID (if available) */
  requestId?: string;
  /** Error code */
  code: ErrorCode;
  /** Human-readable error message */
  message: string;
  /** Additional error details */
  details?: unknown;
}

export type ErrorCode =
  | 'PARSE_ERROR'
  | 'VALIDATION_ERROR'
  | 'LLM_ERROR'
  | 'TIMEOUT'
  | 'INTERNAL_ERROR';

// ============================================================================
// Event Types
// ============================================================================

export interface ActionStartedEvent {
  type: 'action_started';
  instanceId: string;
  action: string;
  params?: Record<string, unknown>;
  timestamp: number;
}

export interface ActionCompletedEvent {
  type: 'action_completed';
  instanceId: string;
  action: string;
  fromVariant: string;
  toVariant: string;
  success: boolean;
  error?: string;
  duration: number;
  timestamp: number;
}

export interface LayoutAppliedEvent {
  type: 'layout_applied';
  directives: LayoutDirective[];
  timestamp: number;
}

export type MaelstromEvent =
  | ActionStartedEvent
  | ActionCompletedEvent
  | LayoutAppliedEvent;

// ============================================================================
// Utility Types
// ============================================================================

export type Result<T, E = Error> =
  | { success: true; value: T }
  | { success: false; error: E };
