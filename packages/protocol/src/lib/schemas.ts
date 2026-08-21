import { z } from 'zod';

import { ActionName } from './action-name.ts';
import { InstanceId } from './instance.ts';
import {
  MAX_ACTION_PARAMS_JSON_UTF8_BYTES,
  MAX_SPLIT_CHILDREN,
  MAX_SPLIT_WEIGHT,
} from './model-output-limits.ts';
import type { TilingNode } from './response.ts';
import { isTilingSplitTokenString } from './response.ts';
import { VariantName } from './variant-name.ts';
import { VesselId } from './vessel-id.ts';

const textEncoder = new TextEncoder();

/** Returns whether a string fits within the model-output UTF-8 byte ceiling. */
function isActionParamsJsonWithinByteLimit(value: string): boolean {
  return (
    textEncoder.encode(value).byteLength <= MAX_ACTION_PARAMS_JSON_UTF8_BYTES
  );
}

// ---------------------------------------------------------------------------
// Shared schemas
// ---------------------------------------------------------------------------

/** Parses a non-negative, zero-based Chart cell position. */
export const ChartPositionSchema = z.object({
  row: z
    .number()
    .int()
    .min(0)
    .describe('Row position on the chart (0-indexed)'),
  column: z
    .number()
    .int()
    .min(0)
    .describe('Column position on the chart (0-indexed)'),
});

/** Parses a positive Chart allocation measured in cells. */
export const ChartSizeSchema = z.object({
  width: z.number().int().min(1).describe('Width in chart cells'),
  height: z.number().int().min(1).describe('Height in chart cells'),
});

/**
 * Parses model-authored Action execution output.
 *
 * IDs and Action names are branded. Optional parameters remain byte-bounded;
 * JSON syntax and semantic parameters are validated later by the Engine.
 */
export const ActionExecutionSchema = z.object({
  instanceId: z
    .string()
    .min(1, 'instanceId is required')
    .transform(InstanceId)
    .describe('The ID of the vessel instance to act upon'),
  action: z
    .string()
    .min(1, 'action is required')
    .transform(ActionName)
    .describe('The action name (must be valid for the current variant)'),
  paramsJson: z
    .string()
    .refine(isActionParamsJsonWithinByteLimit, {
      message: `paramsJson must be at most ${MAX_ACTION_PARAMS_JSON_UTF8_BYTES} UTF-8 bytes`,
    })
    .optional()
    .describe(
      `Optional JSON-encoded parameters for the action, limited to ${MAX_ACTION_PARAMS_JSON_UTF8_BYTES} UTF-8 bytes. Must be a valid JSON object string like {"orderId":"123"} or omitted if no params needed.`,
    ),
});

// ---------------------------------------------------------------------------
// Grid layout
// ---------------------------------------------------------------------------

/** Parses and brands one grid-mode Instance allocation. */
export const GridPositionSchema = z.object({
  instanceId: z
    .string()
    .min(1, 'instanceId is required')
    .transform(InstanceId)
    .describe('The ID of the vessel instance to position'),
  position: ChartPositionSchema.describe(
    'Where to place the vessel on the chart',
  ),
  size: ChartSizeSchema.describe(
    'Size to allocate (must be >= variant minSize)',
  ),
});

/**
 * Parses the model-output grid layout body.
 *
 * The schema validates individual positions but allows overlap. Chart bounds,
 * uniqueness, and Variant minimum sizes are deferred to the heal layer.
 */
export const GridLayoutSchema = z.object({
  positions: z
    .array(GridPositionSchema)
    .describe('Position and size for each visible instance'),
});

// ---------------------------------------------------------------------------
// Tiling layout
// ---------------------------------------------------------------------------

/**
 * A node in the tiling tree. The transform brands non-special strings as
 * `InstanceId`; `null` and any token with an `H` / `V` axis prefix pass
 * through unchanged.
 *
 * The prefix test claims malformed weight suffixes too. Rejecting them here
 * would cost a model round trip; misreading them as Instance IDs would report
 * an undeclared leaf instead of a bad weight. Interpretation belongs to
 * `parseTilingSplitToken`, downstream.
 */
export const TilingNodeSchema = z
  .string()
  .min(1)
  .nullable()
  .transform((value): TilingNode => {
    if (value === null) return value;
    return isTilingSplitTokenString(value) ? value : InstanceId(value);
  })
  .describe(
    'A node in the tiling tree: a split token, a vessel instance ID string for a leaf, or null for empty space. A split token is "H" (top/bottom) or "V" (left/right), optionally followed by ":" and comma-separated positive integer weights, e.g. "V:1,1,1" or "H:2,1". Bare "H"/"V" mean an even two-way split and are the preferred spelling for 50/50. The number of weights IS the number of children that token takes: "V:1,1,1" is followed by exactly three subtrees and gives each one third of the width, "H:2,1" is followed by exactly two and gives them two thirds and one third of the height.',
  );

/**
 * Preorder tiling tree. Carries the model-facing description directly, with no
 * override at the {@link TilingLayoutSchema} level: `.describe()` replaces a
 * description rather than appending to it, so a second call one level up would
 * make this teaching unreachable by the model that needs it.
 */
export const TilingTreeSchema = z
  .array(TilingNodeSchema)
  .describe(
    `Preorder traversal of the tiling tree. Instance IDs in this tree are VISIBLE; omitted instances are HIDDEN. Each instance ID may appear AT MOST ONCE — to give an instance more space, weight its split rather than repeating it. Each split token consumes exactly as many following subtrees as it declares weights (two for bare "H"/"V"), and divides its region along its axis in proportion to those weights. Use weights for arrangements that halving cannot reach: three equal columns is ["V:1,1,1", a, b, c]; a 3x3 grid is ["H:1,1,1", "V:1,1,1", a, b, c, "V:1,1,1", d, e, f, "V:1,1,1", g, h, i]. A token may declare at most ${MAX_SPLIT_CHILDREN} weights, each an integer from 1 to ${MAX_SPLIT_WEIGHT}; nest splits for wider arrangements.`,
  );

/** Parses and brands an Instance identity, Vessel identity, and current Variant. */
export const VesselInstanceSnapshotSchema = z.object({
  instanceId: z
    .string()
    .min(1, 'instanceId is required')
    .refine((value) => !isTilingSplitTokenString(value), {
      message:
        '"H", "V", and any "H:"/"V:" prefixed value are reserved for tiling split tokens',
    })
    .transform(InstanceId)
    .describe(
      'Unique instance ID. For new instances, use format "vesselId-identifier" (e.g., "calendar-main", "biomarkers-detail").',
    ),
  vesselId: z
    .string()
    .min(1, 'vesselId is required')
    .transform(VesselId)
    .describe('The vessel type ID (must match a registered vessel)'),
  variant: z
    .string()
    .min(1, 'variant is required')
    .transform(VariantName)
    .describe(
      'The variant name for this instance (must be valid for the vessel)',
    ),
});

/**
 * Parses the model-output tiling layout body.
 *
 * Tree completeness, duplicate identities, and leaf-to-Instance coherence are
 * intentionally deferred to the Engine's heal layer.
 */
export const TilingLayoutSchema = z.object({
  tree: TilingTreeSchema,
  instances: z
    .array(VesselInstanceSnapshotSchema)
    .describe(
      'All instances that should exist after this response. Include both existing instances (to keep) and new instances (to create). Instances not in this list will be deleted. IMPORTANT: When creating a new instance that needs configuration, you must ALSO add an action in executionPlan to configure it.',
    ),
});
