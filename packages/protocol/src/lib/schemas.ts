import { z } from 'zod';

import type { Mutable } from './_drift-guards.ts';
import { ActionName } from './action-name.ts';
import { InstanceId } from './instance.ts';
import { MessageIdSchema } from './message.ts';
import {
  MAX_ACTION_PARAMS_JSON_UTF8_BYTES,
  MAX_SPLIT_CHILDREN,
  MAX_SPLIT_WEIGHT,
} from './model-output-limits.ts';
import type { MaelstromResponse, TilingNode } from './response.ts';
import {
  isTilingLeafTokenString,
  isTilingSplitTokenString,
} from './response.ts';
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

/** Parses and brands an Instance identity from wire or model output. */
export const InstanceIdSchema = z
  .string()
  .min(1, 'instanceId is required')
  .transform(InstanceId);

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
  instanceId: InstanceIdSchema.describe(
    'The ID of the vessel instance to act upon',
  ),
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
  instanceId: InstanceIdSchema.describe(
    'The ID of the vessel instance to position',
  ),
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
 * A node in the tiling tree: a split token, an `ID:`-prefixed leaf, or `null`.
 * Tokens keep the spelling they arrived with.
 *
 * A malformed weight suffix still passes — `"H:2,x"` is a split whose weights
 * are repaired downstream by `parseTilingSplitToken`, because rejecting it
 * costs a model round trip over something the tree's shape survives. A token
 * belonging to no class is refused instead: it has no shape to survive, and
 * the only alternatives are guessing which class it meant or letting it stand
 * as empty space, which turns a mis-spelled layout into a blank Chart with
 * nothing said about it.
 *
 * The refusal is `ctx.addIssue` inside the transform rather than a throw. A
 * throw raised in a Zod transform escapes `safeParse` instead of becoming an
 * issue, which would turn careless model output into an uncaught error at
 * whichever boundary parsed it.
 */
export const TilingNodeSchema = z
  .string()
  .min(1)
  .nullable()
  .transform((value, ctx): TilingNode => {
    if (
      value === null ||
      isTilingSplitTokenString(value) ||
      isTilingLeafTokenString(value)
    ) {
      return value;
    }
    ctx.addIssue({
      code: 'custom',
      message: `"${value}" is not a tiling tree node: a leaf is "ID:" followed by an instance ID, a split is "H"/"V" with optional ":" weights`,
    });
    return z.NEVER;
  })
  .describe(
    'A node in the tiling tree: a leaf, a split token, or null for empty space. A LEAF is the literal prefix "ID:" followed by an instance ID from layout.instances — write "ID:calendar-main", never a bare "calendar-main". A SPLIT TOKEN is "H" (top/bottom) or "V" (left/right), never prefixed, optionally followed by ":" and comma-separated positive integer weights, e.g. "V:1,1,1" or "H:2,1". Bare "H"/"V" mean an even two-way split and are the preferred spelling for 50/50. The number of weights IS the number of children that token takes: "V:1,1,1" is followed by exactly three subtrees and gives each one third of the width, "H:2,1" is followed by exactly two and gives them two thirds and one third of the height. A string that is neither prefixed with "ID:" nor an "H"/"V" split is rejected.',
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
    `Preorder traversal of the tiling tree. EVERY leaf is written as "ID:" followed by an instance ID: an instance called "a" appears in this array as "ID:a", and a bare "a" is rejected. Split tokens are never prefixed. Instances named in this tree are VISIBLE; omitted instances are HIDDEN. Each instance may appear AT MOST ONCE — to give an instance more space, weight its split rather than repeating it. Each split token consumes exactly as many following subtrees as it declares weights (two for bare "H"/"V"), and divides its region along its axis in proportion to those weights. Use weights for arrangements that halving cannot reach: one instance filling the chart is ["ID:a"]; two side by side is ["V", "ID:a", "ID:b"]; three equal columns is ["V:1,1,1", "ID:a", "ID:b", "ID:c"]; a left column twice as wide as the right is ["V:2,1", "ID:a", "ID:b"]; a 3x3 grid is ["H:1,1,1", "V:1,1,1", "ID:a", "ID:b", "ID:c", "V:1,1,1", "ID:d", "ID:e", "ID:f", "V:1,1,1", "ID:g", "ID:h", "ID:i"]. A token may declare at most ${MAX_SPLIT_CHILDREN} weights, each an integer from 1 to ${MAX_SPLIT_WEIGHT}; nest splits for wider arrangements.`,
  );

/** Parses and brands an Instance identity, Vessel identity, and current Variant. */
export const VesselInstanceSnapshotSchema = z.object({
  instanceId: InstanceIdSchema.describe(
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

/**
 * Canonical decoded Action schema used after provider `paramsJson` parsing.
 * Parameter keys stay arbitrary strings, including JSON-reserved names.
 */
const DecodedActionParamsSchema = z
  .custom<Record<string, unknown>>(
    (value) =>
      value !== null &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      Object.keys(value).every((key) => {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        return descriptor !== undefined && 'value' in descriptor;
      }),
    { message: 'params must be an object' },
  )
  .transform((params) => {
    const copy: Record<string, unknown> = Object.create(null);
    for (const key of Object.keys(params)) {
      const descriptor = Object.getOwnPropertyDescriptor(params, key);
      if (descriptor !== undefined && 'value' in descriptor) {
        Object.defineProperty(copy, key, {
          value: descriptor.value,
          enumerable: true,
          writable: true,
          configurable: true,
        });
      }
    }
    return copy;
  });

/**
 * Parses one canonical response action after JSON parameters have been decoded.
 *
 * Unlike {@link ActionExecutionSchema}, this schema accepts a parameter object
 * rather than provider-authored `paramsJson`. It preserves arbitrary own JSON
 * keys, including names such as `__proto__`, in a null-prototype record.
 */
export const DecodedActionExecutionSchema = z.object({
  instanceId: InstanceIdSchema,
  action: z.string().min(1, 'action is required').transform(ActionName),
  params: DecodedActionParamsSchema.optional(),
});

const DecodedGridLayoutSchema = GridLayoutSchema.extend({
  type: z.literal('grid'),
});
const DecodedTilingLayoutSchema = TilingLayoutSchema.extend({
  type: z.literal('tiling'),
});
const DecodedMaelstromLayoutSchema = z.discriminatedUnion('type', [
  DecodedGridLayoutSchema,
  DecodedTilingLayoutSchema,
]);

const PresentationTextSchema = z
  .string()
  .optional()
  .transform((value) => (value?.trim().length ? value : undefined));

/**
 * Canonical wire schema for an accepted Maelstrom plan. Presentation fields
 * are optional and blank strings normalize to absence without changing
 * nonblank text.
 */
export const MaelstromResponseSchema = z
  .object({
    type: z.literal('maelstrom_response'),
    requestId: MessageIdSchema,
    userMessage: PresentationTextSchema,
    rationale: PresentationTextSchema,
    executionPlan: z.array(DecodedActionExecutionSchema),
    layout: DecodedMaelstromLayoutSchema,
  })
  .transform(({ userMessage, rationale, ...response }) => ({
    ...response,
    ...(userMessage !== undefined && { userMessage }),
    ...(rationale !== undefined && { rationale }),
  }));

type _InferredMaelstromResponse = z.output<typeof MaelstromResponseSchema>;
const _mrFwd: _InferredMaelstromResponse extends Mutable<MaelstromResponse>
  ? true
  : false = true;
const _mrBwd: Mutable<MaelstromResponse> extends _InferredMaelstromResponse
  ? true
  : false = true;
void [_mrFwd, _mrBwd];
