import type { MessageId, SessionId } from '@maelstrom-co/protocol';
import type { ActionExecution } from './action-runner.js';
import type {
  ChartDimensions,
  ChartPosition,
  ChartSize,
  LayoutMode,
  TilingNode,
} from './chart.js';
import type { Vessel } from './vessel.js';

// ============================================================================
// Update Reason Types
// ============================================================================

/** Reason for triggering an engine update - user intent */
export interface UserIntentReason {
  type: 'user_intent';
  /** The user's natural language intent */
  intent: string;
}

/** Reason for triggering an engine update - chart resize */
export interface ChartResizeReason {
  type: 'chart_resize';
  /** Previous chart dimensions */
  previous: ChartDimensions;
  /** Current chart dimensions */
  current: ChartDimensions;
}

/** Reason for triggering an engine update - vessel state mutation */
export interface VesselMutationReason {
  type: 'vessel_mutation';
  /** The instance that was mutated */
  instanceId: string;
  /** Description of what changed */
  changes: string;
}

/** Union of all possible update reasons */
export type UpdateReason =
  | UserIntentReason
  | ChartResizeReason
  | VesselMutationReason;

// ============================================================================
// Request/Response Types
// ============================================================================

/** Request from client to engine */
export interface ChartRequest {
  type: 'chart_request';
  /** Unique request ID for correlation */
  id: MessageId;
  /** Request context */
  context: {
    /** Reasons that triggered this update (can be batched) */
    updateReasons: UpdateReason[];
    /** Current Chart dimensions */
    chartDimensions: ChartDimensions;
    /** Unix timestamp */
    timestamp: number;
    /** Session identifier for conversation continuity */
    sessionId: SessionId;
    /** Layout mode for the chart */
    layoutMode: LayoutMode;
  };
  /** All Vessel instances with their current variant state */
  instances: VesselInstanceSnapshot[];
  /** All registered Vessel definitions */
  vessels: Vessel[];
  /** Current layout (mode-specific) */
  layout: GridLayout | TilingLayout;
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

// ============================================================================
// Layout Types
// ============================================================================

/** Grid layout - array of positioned instances */
export interface GridLayout {
  type: 'grid';
  /** Position and size for each visible instance */
  positions: GridPosition[];
}

/** Position of an instance in grid layout */
export interface GridPosition {
  /** Target Vessel instance */
  instanceId: string;
  /** Position on the Chart */
  position: ChartPosition;
  /** Size to allocate (must be >= variant's minSize) */
  size: ChartSize;
}

/** Tiling layout - binary tree structure with instance declarations */
export interface TilingLayout {
  type: 'tiling';
  /** Binary tree as preorder traversal */
  tree: TilingNode[];
  /** All instances that should exist (existing + new) with their variants */
  instances: VesselInstanceSnapshot[];
}

/** Union of layout types */
export type Layout = GridLayout | TilingLayout;

// ============================================================================
// Response Types
// ============================================================================

/** Response from engine to client */
export interface MaelstromResponse {
  type: 'maelstrom_response';
  /** Correlates to request ID */
  requestId: string;
  /** User-facing conversational message (displayed as text or spsuccessen via TTS) */
  userMessage: string;
  /** LLM's internal reasoning for debugging/transparency (not shown to user) */
  rationale: string;
  /** Actions to execute (in order) */
  executionPlan: ActionExecution[];
  /** Layout (mode-specific) - determines visible instances and their arrangement */
  layout: GridLayout | TilingLayout;
  /** Optional TTS configuration for userMessage */
  speechOutput?: SpeechOutput;
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
  layout: GridLayout | TilingLayout;
  timestamp: number;
}

export type MaelstromEvent =
  | ActionStartedEvent
  | ActionCompletedEvent
  | LayoutAppliedEvent;

// Utility Types
// ============================================================================

export type Success<T> = {
  readonly success: true;
  readonly value: T;
};

export type Err<E extends Error = Error> = {
  readonly success: false;
  readonly error: E;
};

export type Result<T, E extends Error = Error> = Success<T> | Err<E>;

export const Success = <T>(value?: T): Success<T | undefined> => ({
  success: true,
  value,
});

export const Err = <E extends Error = Error>(error: E): Err<E> => ({
  success: false,
  error,
});

export const isSuccess = <T, E extends Error>(
  r: Result<T, E>,
): r is Success<T> => r.success;

export const isErr = <T, E extends Error>(r: Result<T, E>): r is Err<E> =>
  !r.success;

// ============================================================================
// Type Guards
// ============================================================================

export function isGridLayout(layout: Layout): layout is GridLayout {
  return layout.type === 'grid';
}

export function isTilingLayout(layout: Layout): layout is TilingLayout {
  return layout.type === 'tiling';
}
