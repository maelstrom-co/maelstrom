import { z } from 'zod';

import type { ChartDimensions } from './chart.js';
// Referenced via `{@link}` in the ChartRequest JSDoc below — type-only import
// keeps IDE hover/jump-to-definition uniform across resolvers.
import type { ChartRequestMessage } from './engine-message.js';
import type { InstanceId } from './instance.js';
import type { LayoutMode } from './layout.js';
import type { GridLayout, TilingLayout } from './response.js';
import {
  ActionExecutionSchema,
  GridLayoutSchema,
  TilingLayoutSchema,
} from './schemas.js';
import type { Vessel } from './vessel.js';

// ---------------------------------------------------------------------------
// Update reasons
// ---------------------------------------------------------------------------

/** Reason for triggering an engine update - user intent */
export interface UserIntentReason {
  readonly type: 'user_intent';
  /** The user's natural language intent */
  readonly intent: string;
}

/** Reason for triggering an engine update - chart resize */
export interface ChartResizeReason {
  readonly type: 'chart_resize';
  readonly previous: ChartDimensions;
  readonly current: ChartDimensions;
}

/** Reason for triggering an engine update - vessel state mutation */
export interface VesselMutationReason {
  readonly type: 'vessel_mutation';
  readonly instanceId: InstanceId;
  /** Description of what changed */
  readonly changes: string;
}

/** Union of all possible update reasons */
export type UpdateReason =
  | UserIntentReason
  | ChartResizeReason
  | VesselMutationReason;

// ---------------------------------------------------------------------------
// Request types
// ---------------------------------------------------------------------------

/** Snapshot of a Vessel instance's state (for wire transfer) */
export interface VesselInstanceSnapshot {
  readonly instanceId: InstanceId;
  readonly vesselId: string;
  readonly variant: string;
}

/**
 * Request from client to engine.
 *
 * Message identity (`id`), session binding (`sessionId`), and timestamp live
 * on the surrounding {@link ChartRequestMessage} envelope — this payload only
 * carries the chart state and the reasons for the update.
 */
export interface ChartRequest {
  readonly type: 'chart_request';
  readonly context: {
    /** Reasons that triggered this update (can be batched) */
    readonly updateReasons: readonly UpdateReason[];
    readonly chartDimensions: ChartDimensions;
    readonly layoutMode: LayoutMode;
  };
  /** All Vessel instances with their current variant state */
  readonly instances: readonly VesselInstanceSnapshot[];
  /** All registered Vessel definitions */
  readonly vessels: readonly Vessel[];
  /** Current layout (mode-specific) */
  readonly layout: GridLayout | TilingLayout;
}

// ---------------------------------------------------------------------------
// LLM structured-output schemas
// ---------------------------------------------------------------------------

export const GridResponseSchema = z.object({
  userMessage: z
    .string()
    .describe(
      'A friendly, conversational response to the user. This will be displayed in the chat UI and spoken aloud via TTS.',
    ),
  rationale: z
    .string()
    .describe(
      'Internal reasoning for debugging/transparency. Not shown to the user.',
    ),
  executionPlan: z
    .array(ActionExecutionSchema)
    .describe(
      'Actions to execute on vessel instances (in order). Empty array if no actions needed.',
    ),
  layout: GridLayoutSchema.describe(
    'Grid layout with positions for each visible instance.',
  ),
});

export type GridResponse = z.infer<typeof GridResponseSchema>;

export const TilingResponseSchema = z.object({
  userMessage: z
    .string()
    .describe(
      'A friendly, conversational response to the user. This will be displayed in the chat UI and spoken aloud via TTS.',
    ),
  rationale: z
    .string()
    .describe(
      'Internal reasoning for debugging/transparency. Not shown to the user.',
    ),
  executionPlan: z
    .array(ActionExecutionSchema)
    .describe(
      'Actions to execute on vessel instances (in order). Empty array if no actions needed. CRITICAL: Include actions for newly created instances that require configuration.',
    ),
  layout: TilingLayoutSchema.describe(
    'Tiling layout with binary tree structure and instance declarations.',
  ),
});

export type TilingResponse = z.infer<typeof TilingResponseSchema>;
