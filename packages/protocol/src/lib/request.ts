import { z } from 'zod';

import type { Mutable } from './_drift-guards.ts';
import type { ChartDimensions } from './chart.ts';
import { ChartDimensionsSchema } from './chart.ts';
// Referenced via `{@link}` in the ChartRequest JSDoc below — type-only import
// keeps IDE hover/jump-to-definition uniform across resolvers.
import type { ChartRequestMessage } from './engine-message.ts';
import { InstanceId } from './instance.ts';
import type { LayoutMode } from './layout.ts';
import { MAX_EXECUTION_PLAN_ENTRIES } from './model-output-limits.ts';
import type { GridLayout, TilingLayout } from './response.ts';
import { isInstanceIdNode } from './response.ts';
import {
  ActionExecutionSchema,
  GridLayoutSchema,
  TilingLayoutSchema,
  VesselInstanceSnapshotSchema,
} from './schemas.ts';
import type { VariantName } from './variant-name.ts';
import type { Vessel } from './vessel.ts';
import { VesselSchema } from './vessel.ts';
import type { VesselId } from './vessel-id.ts';

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
  instanceId: z.string().min(1, 'instanceId is required').transform(InstanceId),
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

/**
 * Snapshot of a Vessel instance's state (for wire transfer).
 *
 * Hand-written rather than `z.infer<typeof VesselInstanceSnapshotSchema>` so
 * the `readonly` modifiers survive — `z.infer` does not synthesize them.
 */
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

/**
 * Structured-output schema for a grid-mode LLM response.
 *
 * Limits the execution plan but leaves semantic layout validation to the
 * Engine's heal layer.
 */
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
    .max(MAX_EXECUTION_PLAN_ENTRIES)
    .describe(
      `Actions to execute on vessel instances (in order), with at most ${MAX_EXECUTION_PLAN_ENTRIES} entries. Empty array if no actions needed.`,
    ),
  layout: GridLayoutSchema.describe(
    'Grid layout with positions for each visible instance.',
  ),
});

/** Parsed grid-mode LLM output before Engine healing and envelope metadata. */
export type GridResponse = z.infer<typeof GridResponseSchema>;

/**
 * Structured-output schema for a tiling-mode LLM response.
 *
 * Limits the execution plan but leaves tree and Instance coherence checks to
 * the Engine's heal layer.
 */
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
    .max(MAX_EXECUTION_PLAN_ENTRIES)
    .describe(
      `Actions to execute on vessel instances (in order), with at most ${MAX_EXECUTION_PLAN_ENTRIES} entries. Empty array if no actions needed. CRITICAL: Include actions for newly created instances that require configuration.`,
    ),
  layout: TilingLayoutSchema.describe(
    'Tiling layout with binary tree structure and instance declarations.',
  ),
});

/** Parsed tiling-mode LLM output before Engine healing and envelope metadata. */
export type TilingResponse = z.infer<typeof TilingResponseSchema>;

// ---------------------------------------------------------------------------
// ChartRequest wire-format schema
// ---------------------------------------------------------------------------

// Request-side wire format carries `type` (the `GridLayout` / `TilingLayout`
// interfaces already declare it); the LLM-output wire format does not.
// Extending here — rather than in the shared schemas — keeps the
// discriminator local to the request side and lets the discriminated union
// reject shape-vs-mode mismatches at parse time.
const RequestGridLayoutSchema = GridLayoutSchema.extend({
  type: z.literal('grid'),
});
const RequestTilingLayoutSchema = TilingLayoutSchema.extend({
  type: z.literal('tiling'),
});

/**
 * Wire-format Zod parser for {@link ChartRequest}.
 *
 * Validates payload shape via the inner schemas and enforces coherence across
 * `instances`, `vessels`, `layout`, and `context.layoutMode`. On a successful
 * parse the caller may rely on:
 *
 * - `layout.type` agreeing with `context.layoutMode`
 * - every `instances[].vesselId` resolving to a registered vessel and every
 *   `instances[].variant` declared on that vessel (own-property only — no
 *   `Object.prototype` lookalikes)
 * - the same `vesselId`/`variant` coherence on tiling `layout.instances[]`,
 *   no duplicate `instanceId` within it, and the entry list as a *superset*
 *   of input `instances` (extras allowed for newly-introduced instances;
 *   missing entries rejected)
 * - no duplicate `vesselId` in `vessels`, no duplicate `instanceId` in
 *   `instances` or `layout.positions`
 * - tiling tree leaves all declared in `layout.instances`
 * - grid `layout.positions[].instanceId` resolving to an `instances[]` entry
 *
 * Strict-fail (issues → parse failure) rather than lenient-skip: client input
 * is deterministic, so silent dropping would mutate caller state and hide the
 * same drift this validation is meant to surface.
 */
export const ChartRequestSchema = z
  .object({
    type: z.literal('chart_request'),
    context: z.object({
      updateReasons: z.array(UpdateReasonSchema),
      chartDimensions: ChartDimensionsSchema,
      layoutMode: z.enum(['grid', 'tiling']),
    }),
    instances: z.array(VesselInstanceSnapshotSchema),
    vessels: z.array(VesselSchema),
    layout: z.discriminatedUnion('type', [
      RequestGridLayoutSchema,
      RequestTilingLayoutSchema,
    ]),
  })
  .superRefine((req, ctx) => {
    if (req.layout.type !== req.context.layoutMode) {
      ctx.addIssue({
        code: 'custom',
        message: `context.layoutMode is "${req.context.layoutMode}" but layout.type is "${req.layout.type}"`,
        path: ['context', 'layoutMode'],
      });
    }

    // First-wins on duplicates: last-write-overwrite would mask the
    // structural break and silently let downstream membership checks pass.
    const vesselsById = new Map<VesselId, Vessel>();
    req.vessels.forEach((vessel, i) => {
      if (vesselsById.has(vessel.id)) {
        ctx.addIssue({
          code: 'custom',
          message: `Duplicate vessel id "${vessel.id}"`,
          path: ['vessels', i, 'id'],
        });
        return;
      }
      vesselsById.set(vessel.id, vessel);
    });

    const inputInstanceIds = new Set<InstanceId>();
    req.instances.forEach((inst, i) => {
      if (inputInstanceIds.has(inst.instanceId)) {
        ctx.addIssue({
          code: 'custom',
          message: `Duplicate instance id "${inst.instanceId}"`,
          path: ['instances', i, 'instanceId'],
        });
      } else {
        inputInstanceIds.add(inst.instanceId);
      }
    });

    // Skip the variant check when the vessel is missing — variant has no
    // semantic frame without it, and a second issue per orphan is noise.
    // Shared by both ref-bearing loops below.
    const checkVesselVariantRef = (
      ref: { instanceId: InstanceId; vesselId: VesselId; variant: VariantName },
      basePath: ReadonlyArray<string | number>,
      label: 'Instance' | 'Layout instance',
    ): void => {
      const vessel = vesselsById.get(ref.vesselId);
      if (vessel === undefined) {
        ctx.addIssue({
          code: 'custom',
          message: `${label} "${ref.instanceId}" references unknown vesselId "${ref.vesselId}"`,
          path: [...basePath, 'vesselId'],
        });
        return;
      }
      // `Object.hasOwn` rather than `in` — `vessel.variants` is a plain
      // object whose prototype chain includes `Object.prototype`, so a
      // variant name like `'toString'` or `'__proto__'` would resolve as
      // a true `in` membership and silently bypass this rule.
      if (!Object.hasOwn(vessel.variants, ref.variant)) {
        ctx.addIssue({
          code: 'custom',
          message: `${label} "${ref.instanceId}" references unknown variant "${ref.variant}" on vessel "${ref.vesselId}"`,
          path: [...basePath, 'variant'],
        });
      }
    };

    req.instances.forEach((inst, i) => {
      checkVesselVariantRef(inst, ['instances', i], 'Instance');
    });

    if (req.layout.type === 'grid') {
      // Duplicate positions are rejected because the renderer cannot place
      // one instance at two coordinates.
      const seenPositionInstanceIds = new Set<InstanceId>();
      req.layout.positions.forEach((pos, i) => {
        if (seenPositionInstanceIds.has(pos.instanceId)) {
          ctx.addIssue({
            code: 'custom',
            message: `Duplicate grid position for instanceId "${pos.instanceId}"`,
            path: ['layout', 'positions', i, 'instanceId'],
          });
        } else {
          seenPositionInstanceIds.add(pos.instanceId);
        }
        if (!inputInstanceIds.has(pos.instanceId)) {
          ctx.addIssue({
            code: 'custom',
            message: `Grid position references unknown instanceId "${pos.instanceId}"`,
            path: ['layout', 'positions', i, 'instanceId'],
          });
        }
      });
    } else {
      const layoutInstanceIds = new Set<InstanceId>();
      req.layout.instances.forEach((li, i) => {
        if (layoutInstanceIds.has(li.instanceId)) {
          ctx.addIssue({
            code: 'custom',
            message: `Duplicate layout.instances id "${li.instanceId}"`,
            path: ['layout', 'instances', i, 'instanceId'],
          });
          return;
        }
        layoutInstanceIds.add(li.instanceId);
        checkVesselVariantRef(
          li,
          ['layout', 'instances', i],
          'Layout instance',
        );
      });

      // Extras in `layout.instances` are allowed (newly-introduced instances
      // not yet in the runtime list); the input must still be a subset.
      req.instances.forEach((inst, i) => {
        if (!layoutInstanceIds.has(inst.instanceId)) {
          ctx.addIssue({
            code: 'custom',
            message: `Instance "${inst.instanceId}" is missing from tiling layout.instances`,
            path: ['instances', i, 'instanceId'],
          });
        }
      });

      req.layout.tree.forEach((node, i) => {
        if (!isInstanceIdNode(node)) return;
        if (!layoutInstanceIds.has(node)) {
          ctx.addIssue({
            code: 'custom',
            message: `Tiling tree leaf "${node}" is not declared in layout.instances`,
            path: ['layout', 'tree', i],
          });
        }
      });
    }
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

// Full-shape check including `layout`: `TilingInstance.{vesselId, variant}`
// are branded `VesselId` / `VariantName`, matching the `.transform(...)` output
// of `VesselInstanceSnapshotSchema`, so the interface and the inferred shape
// agree end-to-end.
const _chartReqFwd: _InferredChartRequest extends Mutable<ChartRequest>
  ? true
  : false = true;
const _chartReqBwd: Mutable<ChartRequest> extends _InferredChartRequest
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
