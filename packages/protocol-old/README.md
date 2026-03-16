# @maelstrom-co/protocol-old

Shared types and transport-agnostic message contract for Maelstrom.

This package defines the cross-cutting concerns between client and engine: TypeScript types for Vessels and the Chart, plus the protocol messages that define their communication. Transport mechanism (WebSocket, HTTP, in-memory) is a separate concern handled elsewhere.

---

## Installation

```bash
npm install @maelstrom-co/protocol-old
```

---

## Chart Types

The Chart is the canvas where Vessels are positioned. All positioning uses chart units (integers), not pixels.

```typescript
/** Default chart cell size in pixels */
export const DEFAULT_CHART_CELL_PX = 80;

/**
 * Position on the Chart (in chart units)
 */
export interface ChartPosition {
  /** Column index (0-based, from left) */
  x: number;
  /** Row index (0-based, from top) */
  y: number;
}

/**
 * Size in chart units
 */
export interface ChartSize {
  /** Width in chart cells */
  w: number;
  /** Height in chart cells */
  h: number;
}

/**
 * Available chart space
 */
export interface ChartDimensions {
  /** Number of available columns */
  cols: number;
  /** Number of available rows */
  rows: number;
}

/**
 * Configuration for the Chart
 */
export interface ChartConfig {
  /** Size of each chart cell in pixels. Defaults to DEFAULT_CHART_CELL_PX (80) */
  cellSizePx?: number;
}

/**
 * Pixel dimensions (for rendering)
 */
export interface PixelDimensions {
  width: number;
  height: number;
}
```

---

## Vessel Types

Vessels are state machines. Each Vessel defines a set of **variants** (states) and **actions** (transitions). The LLM orchestrates Vessels by invoking actions that transition between variants.

### Vessel

```typescript
/**
 * Definition of a Vessel as a state machine
 */
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

/**
 * A variant represents a distinct state of the Vessel
 */
export interface VesselVariant {
  /** State properties for this variant */
  props: Record<string, unknown>;

  /** Minimum size required to display this variant */
  minSize: ChartSize;

  /** Actions available when in this variant */
  actions: VesselAction[];
}
```

### Vessel Actions

Actions are transitions in the state machine. Each action declares what it does and optionally what variant it transitions to.

```typescript
/**
 * An action that can be invoked on a Vessel
 */
export interface VesselAction {
  /** Action identifier (unique within the variant) */
  name: string;

  /** Description for the LLM */
  description: string;

  /** Parameter definitions */
  parameters?: ActionParameter[];

  /**
   * Target variant after this action executes.
   * If undefined, action has side effects but doesn't change variant.
   */
  transitionsTo?: string;
}

/**
 * Parameter definition for an action
 */
export interface ActionParameter {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'object';
  description: string;
  required?: boolean;
  defaultValue?: unknown;
  enum?: unknown[];
}
```

### Vessel Instance

```typescript
/**
 * Runtime instance of a Vessel
 */
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
```

### Example

```typescript
const calendar: Vessel = {
  id: 'calendar',
  name: 'Calendar',
  description: 'Calendar for scheduling and date selection',
  defaultVariant: 'month',

  variants: {
    'month': {
      props: { view: 'month' },
      minSize: { w: 4, h: 4 },
      actions: [
        { name: 'showWeek', description: 'Switch to week view', transitionsTo: 'week' },
        { name: 'collapse', description: 'Minimize the calendar', transitionsTo: 'collapsed' },
        { name: 'refresh', description: 'Refresh calendar data' },
      ],
    },
    'week': {
      props: { view: 'week' },
      minSize: { w: 6, h: 3 },
      actions: [
        { name: 'showMonth', description: 'Back to month view', transitionsTo: 'month' },
        { name: 'selectDay', description: 'Open a specific day',
          parameters: [{ name: 'date', type: 'string', description: 'ISO date', required: true }],
          transitionsTo: 'day' },
      ],
    },
    'day': {
      props: { view: 'day' },
      minSize: { w: 3, h: 5 },
      actions: [
        { name: 'back', description: 'Return to week view', transitionsTo: 'week' },
      ],
    },
    'collapsed': {
      props: { view: 'month', collapsed: true },
      minSize: { w: 2, h: 1 },
      actions: [
        { name: 'expand', description: 'Expand calendar', transitionsTo: 'month' },
      ],
    },
  },
};
```

---

## Protocol Messages

### Client → Engine

#### ChartRequest

```typescript
interface ChartRequest {
  type: 'chart_request';
  id: string;
  context: {
    /** Reasons that triggered this update (can be batched) */
    updateReasons: UpdateReason[];
    chartDimensions: ChartDimensions;
    timestamp: number;
    sessionId: string;
  };
  /** Currently visible Vessel instances with their state */
  instances: VesselInstanceState[];
  /** All registered Vessel definitions */
  vessels: Vessel[];
}

/** Update reason types */
type UpdateReason =
  | { type: 'user_intent'; intent: string }
  | { type: 'chart_resize'; previous: ChartDimensions; current: ChartDimensions }
  | { type: 'vessel_mutation'; instanceId: string; changes: string };

/**
 * Current state of a Vessel instance (for context)
 */
interface VesselInstanceState {
  instanceId: string;
  vesselId: string;
  variant: string;
  position: ChartPosition;
  size: ChartSize;
}
```

### Engine → Client

#### MaelstromResponse

```typescript
interface MaelstromResponse {
  type: 'maelstrom_response';
  requestId: string;
  /** LLM's reasoning for debugging/transparency */
  rationale: string;
  /** Actions to execute (in order) */
  executionPlan: ActionExecution[];
  /** Layout changes to apply after actions complete */
  layoutDirective: LayoutDirective[];
}

interface ActionExecution {
  /** Target Vessel instance */
  instanceId: string;
  /** Action name (must be valid for current variant) */
  action: string;
  /** Action parameters */
  params?: Record<string, unknown>;
}

interface LayoutDirective {
  /** Target Vessel instance */
  instanceId: string;
  /** New position on the Chart */
  position: ChartPosition;
  /** Size to allocate (must be >= variant's minSize) */
  size: ChartSize;
}
```

#### ErrorResponse

```typescript
interface ErrorResponse {
  type: 'error';
  requestId?: string;
  code: ErrorCode;
  message: string;
  details?: unknown;
}

type ErrorCode =
  | 'PARSE_ERROR'
  | 'VALIDATION_ERROR'
  | 'LLM_ERROR'
  | 'TIMEOUT'
  | 'INTERNAL_ERROR';
```

---

## Event Types

```typescript
interface ActionStartedEvent {
  type: 'action_started';
  instanceId: string;
  action: string;
  params?: Record<string, unknown>;
  timestamp: number;
}

interface ActionCompletedEvent {
  type: 'action_completed';
  instanceId: string;
  action: string;
  fromVariant: string;
  toVariant: string;  // same as fromVariant if no transition
  success: boolean;
  error?: string;
  duration: number;
  timestamp: number;
}

interface LayoutAppliedEvent {
  type: 'layout_applied';
  directives: LayoutDirective[];
  timestamp: number;
}

type MaelstromEvent =
  | ActionStartedEvent
  | ActionCompletedEvent
  | LayoutAppliedEvent;
```

---

## LLM Serialization

The engine serializes Vessel state for the LLM prompt. Example format:

```
## Registered Vessels

### calendar - Calendar
Calendar for scheduling and date selection.

Variants:
- month (4×4): Default month view
- week (6×3): Week view
- day (3×5): Day detail view
- collapsed (2×1): Minimized

### weather - Weather Widget
Shows current weather for a location.

Variants:
- current (2×2): Current conditions
- forecast (4×3): Extended forecast

---

## Current Chart State

Dimensions: 15 cols × 10 rows

Instances:
- calendar-1 (calendar) at (0,0) 4×4, variant: month
  Available actions: showWeek → week, collapse → collapsed, refresh
- weather-1 (weather) at (5,0) 2×2, variant: current
  Available actions: showForecast → forecast
```

---

## Utility Types

```typescript
export type Result<T, E = Error> =
  | { success: true; value: T }
  | { success: false; error: E };
```

---

## Building

```bash
nx build protocol
```

## Testing

```bash
nx test protocol
```
