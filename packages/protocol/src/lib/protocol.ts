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

/** Audio context metadata when intent originated from speech */
export interface AudioContext {
  /** Was this transcribed from speech? */
  fromSpeech: boolean;
  /** Confidence of transcription (0-1) */
  confidence?: number;
  /** Detected language code (e.g., 'en-US') */
  language?: string;
  /** Duration of audio in seconds */
  durationInSeconds?: number;
}

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
    /** Audio metadata when intent originated from speech */
    audioContext?: AudioContext;
  };
  /** All Vessel instances with their state */
  instances: VesselInstanceState[];
  /** All registered Vessel definitions */
  vessels: Vessel[];
  /** Current layout - which instances are visible and where (empty = all hidden) */
  currentLayout?: LayoutDirective[];
}

/** Current state of a Vessel instance (for context) */
export interface VesselInstanceState {
  instanceId: string;
  vesselId: string;
  variant: string;
  position: ChartPosition;
  size: ChartSize;
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

// ============================================================================
// Audio Event Types
// ============================================================================

export interface AudioTranscriptionStartedEvent {
  type: 'audio_transcription_started';
  timestamp: number;
}

export interface AudioTranscriptionResultEvent {
  type: 'audio_transcription_result';
  /** The transcribed text */
  text: string;
  /** Whether this is a final result (vs interim) */
  isFinal: boolean;
  /** Confidence score (0-1), if available */
  confidence?: number;
  timestamp: number;
}

export interface AudioTranscriptionEndedEvent {
  type: 'audio_transcription_ended';
  /** The final complete transcript */
  finalTranscript: string;
  timestamp: number;
}

export interface AudioSpeechStartedEvent {
  type: 'audio_speech_started';
  /** The text being spoken */
  text: string;
  timestamp: number;
}

export interface AudioSpeechEndedEvent {
  type: 'audio_speech_ended';
  timestamp: number;
}

export type AudioEvent =
  | AudioTranscriptionStartedEvent
  | AudioTranscriptionResultEvent
  | AudioTranscriptionEndedEvent
  | AudioSpeechStartedEvent
  | AudioSpeechEndedEvent;

export type MaelstromEvent =
  | ActionStartedEvent
  | ActionCompletedEvent
  | LayoutAppliedEvent
  | AudioEvent;

// ============================================================================
// Utility Types
// ============================================================================

export type Result<T, E = Error> =
  | { success: true; value: T }
  | { success: false; error: E };
