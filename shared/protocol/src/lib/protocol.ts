// ============================================================================
// Chart Types
// ============================================================================

/** Default chart cell size in pixels */
export const DEFAULT_CHART_CELL_PX = 80;

/** Position on the Chart (in chart units) */
export interface ChartPosition {
  /** Row index (0-based, from top) */
  row: number;
  /** Column index (0-based, from left) */
  column: number;
}

/** Size in chart units */
export interface ChartSize {
  /** Width in chart cells */
  width: number;
  /** Height in chart cells */
  height: number;
}

/** Available chart space */
export interface ChartDimensions {
  /** Number of available columns */
  columns: number;
  /** Number of available rows */
  rows: number;
}

/** Configuration for the Chart */
export interface ChartConfig {
  /** Size of each chart cell in pixels. Defaults to DEFAULT_CHART_CELL_PX (80) */
  cellSizePx?: number;
}

/** Pixel dimensions (for rendering) */
export interface PixelDimensions {
  width: number;
  height: number;
}

// ============================================================================
// Vessel Types
// ============================================================================

/** Definition of a Vessel as a state machine */
export interface Vessel {
  /** Unique identifier */
  id: string;
  /** Human-readable name */
  name: string;
  /** Semantic description for the LLM to understand purpose */
  description: string;
  /** The variant to start in */
  defaultVariant: string;
  /** Available variants (states) */
  variants: Record<string, VesselVariant>;
}

/** A variant represents a distinct state of the Vessel */
export interface VesselVariant {
  /** State properties for this variant */
  props: Record<string, unknown>;
  /** Minimum size required to display this variant */
  minSize: ChartSize;
  /** Actions available when in this variant */
  actions: VesselAction[];
}

/** An action that can be invoked on a Vessel */
export interface VesselAction {
  /** Action identifier (unique within the variant) */
  name: string;
  /** Description for the LLM */
  description: string;
  /** Parameter definitions */
  parameters?: ActionParameter[];
  /** Target variant after this action executes. Undefined = no state change */
  transitionsTo?: string;
}

/** Parameter definition for an action */
export interface ActionParameter {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'object';
  description: string;
  required?: boolean;
  defaultValue?: unknown;
  enum?: unknown[];
}

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
// Protocol Messages
// ============================================================================

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
  /** Currently visible Vessel instances with their state */
  instances: VesselInstanceState[];
  /** All registered Vessel definitions */
  vessels: Vessel[];
}

/** Current state of a Vessel instance (for context) */
export interface VesselInstanceState {
  instanceId: string;
  vesselId: string;
  variant: string;
  position: ChartPosition;
  size: ChartSize;
}

/** Response from engine to client */
export interface MaelstromResponse {
  type: 'maelstrom_response';
  /** Correlates to request ID */
  requestId: string;
  /** LLM's reasoning for debugging/transparency */
  rationale: string;
  /** Actions to execute (in order) */
  executionPlan: ActionExecution[];
  /** Layout changes to apply after actions complete */
  layoutDirective: LayoutDirective[];
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
