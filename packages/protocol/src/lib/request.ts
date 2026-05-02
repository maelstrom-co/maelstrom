import { z } from 'zod';

import type { Mutable } from './_drift-guards.js';
import type { ChartDimensions } from './chart.js';
import { ChartDimensionsSchema } from './chart.js';
// Referenced via `{@link}` in the ChartRequest JSDoc below — type-only import
// keeps IDE hover/jump-to-definition uniform across resolvers.
import type { ChartRequestMessage } from './engine-message.js';
import { InstanceId } from './instance.js';
import type { LayoutMode } from './layout.js';
import type { GridLayout, TilingLayout } from './response.js';
import {
  ActionExecutionSchema,
  GridLayoutSchema,
  TilingLayoutSchema,
  VesselInstanceSnapshotSchema,
} from './schemas.js';
import type { VariantName } from './variant-name.js';
import type { Vessel } from './vessel.js';
import { VesselSchema } from './vessel.js';
import type { VesselId } from './vessel-id.js';

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
// UpdateReason wire-format schemas
// ---------------------------------------------------------------------------

/**
 * Wire-format Zod parser for {@link UserIntentReason}. The `type`
 * discriminator pins the variant; `intent` is an arbitrary natural-language
 * string with no length constraint (callers may submit empty intents — the
 * engine prompt builder is responsible for filtering them).
 */
export const UserIntentReasonSchema = z.object({
  type: z.literal('user_intent'),
  intent: z.string(),
});

/**
 * Wire-format Zod parser for {@link ChartResizeReason}. Both `previous` and
 * `current` are full {@link ChartDimensionsSchema} objects (positive integer
 * rows + columns) — a resize event must always carry the before/after
 * shape, not a delta.
 */
export const ChartResizeReasonSchema = z.object({
  type: z.literal('chart_resize'),
  previous: ChartDimensionsSchema,
  current: ChartDimensionsSchema,
});

/**
 * Wire-format Zod parser for {@link VesselMutationReason}. `instanceId`
 * is branded to {@link InstanceId} via `.transform(...)` so the inferred
 * shape matches the hand-written interface end-to-end.
 */
export const VesselMutationReasonSchema = z.object({
  type: z.literal('vessel_mutation'),
  instanceId: z
    .string()
    .min(1, 'instanceId is required')
    .transform(InstanceId),
  changes: z.string(),
});

/**
 * Wire-format Zod parser for {@link UpdateReason}, discriminated on
 * `type`. Used by {@link ChartRequestSchema} for `context.updateReasons`.
 */
export const UpdateReasonSchema = z.discriminatedUnion('type', [
  UserIntentReasonSchema,
  ChartResizeReasonSchema,
  VesselMutationReasonSchema,
]);

// ---------------------------------------------------------------------------
// Request types
// ---------------------------------------------------------------------------

/** Snapshot of a Vessel instance's state (for wire transfer) */
export interface VesselInstanceSnapshot {
  readonly instanceId: InstanceId;
  readonly vesselId: VesselId;
  readonly variant: VariantName;
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

// ---------------------------------------------------------------------------
// ChartRequest wire-format schema
// ---------------------------------------------------------------------------

/**
 * Wire-format Zod parser for {@link ChartRequest}. Shape-level validation
 * only — cross-rules like `layout.type === context.layoutMode` and
 * `instance.vesselId ∈ vessels` are deliberately deferred (separate
 * follow-up; overlaps with the LLM-output healing semantics).
 */
export const ChartRequestSchema = z.object({
  type: z.literal('chart_request'),
  context: z.object({
    updateReasons: z.array(UpdateReasonSchema),
    chartDimensions: ChartDimensionsSchema,
    layoutMode: z.enum(['grid', 'tiling']),
  }),
  instances: z.array(VesselInstanceSnapshotSchema),
  vessels: z.array(VesselSchema),
  layout: z.union([GridLayoutSchema, TilingLayoutSchema]),
});

// ---------------------------------------------------------------------------
// Drift guards: fail typecheck if the inferred Zod shape diverges from the
// hand-written interface. `Mutable<T>` (from `./_drift-guards.js`) strips
// `readonly` because `z.infer` does not synthesize it; comparing the
// read-only interface directly would always fail. (engine-config.ts uses a
// different drift-guard strategy — per-field forward checks on a
// `Pick<>`-shaped contract — because its inferred shape can't faithfully
// reproduce phantom adapter fields.)
// ---------------------------------------------------------------------------

type _InferredChartRequest = z.infer<typeof ChartRequestSchema>;

// The `layout` field is carved out. Inside `TilingLayout`, the hand-written
// `TilingInstance` interface still types `vesselId` and `variant` as plain
// `string`, while `TilingLayoutSchema.instances` parses through
// `VesselInstanceSnapshotSchema` whose `.transform(...)` calls brand those
// fields as `VesselId` / `VariantName`. The interface and the inferred shape
// disagree at exactly that depth, so the backward direction
// (`Mutable<TilingInstance>` extends the inferred branded shape) fails
// because `string extends VesselId` is false. Runtime round-trip behaviour
// for `TilingLayoutSchema` is exercised in `request.test.ts`.
type _ChartReqWithoutLayout = Omit<ChartRequest, 'layout'>;
type _InferredChartReqWithoutLayout = Omit<_InferredChartRequest, 'layout'>;
const _chartReqFwd: _InferredChartReqWithoutLayout extends Mutable<_ChartReqWithoutLayout>
  ? true
  : false = true;
const _chartReqBwd: Mutable<_ChartReqWithoutLayout> extends _InferredChartReqWithoutLayout
  ? true
  : false = true;

type _InferredUpdateReason = z.infer<typeof UpdateReasonSchema>;
const _updateReasonFwd: _InferredUpdateReason extends Mutable<UpdateReason>
  ? true
  : false = true;
const _updateReasonBwd: Mutable<UpdateReason> extends _InferredUpdateReason
  ? true
  : false = true;

void [_chartReqFwd, _chartReqBwd, _updateReasonFwd, _updateReasonBwd];
