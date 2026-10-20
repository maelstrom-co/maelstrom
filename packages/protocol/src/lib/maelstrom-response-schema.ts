import { z } from 'zod';
import type { Mutable } from './_drift-guards.ts';
import { ActionName } from './action-name.ts';
import { MessageIdSchema } from './message.ts';
import type {
  ActionExecution,
  GridLayout,
  MaelstromResponse,
  TilingLayout,
} from './response.ts';
import {
  GridLayoutSchema,
  InstanceIdSchema,
  TilingLayoutSchema,
} from './schemas.ts';

// `MaelstromResponse` ships as a hand-written interface built programmatically
// by the engine. This parser validates it where it crosses a wire boundary
// from the engine host to the client: the server envelope and the `ui_change`
// agent event. It differs from the LLM-output schemas in `request.ts`: the
// parsed form carries the layout `type` discriminator and `params` as a decoded
// object rather than the LLM's `paramsJson` string.

const ActionExecutionParsedSchema = z.object({
  instanceId: InstanceIdSchema,
  action: z.string().min(1, 'action is required').transform(ActionName),
  params: z.record(z.string(), z.unknown()).optional(),
});

const GridLayoutParsedSchema = GridLayoutSchema.extend({
  type: z.literal('grid'),
});

const TilingLayoutParsedSchema = TilingLayoutSchema.extend({
  type: z.literal('tiling'),
});

const MaelstromLayoutSchema = z.discriminatedUnion('type', [
  GridLayoutParsedSchema,
  TilingLayoutParsedSchema,
]);

/**
 * Wire-format Zod parser for {@link MaelstromResponse}. Validates the engine's
 * decision output as it crosses back to the client: the discriminator, the
 * correlation `requestId`, the user-facing/debug text, the parsed execution
 * plan (`params` as an object, not a JSON string), and the layout, whose
 * `type` must be `'grid'` or `'tiling'` and whose shape must match that arm.
 */
export const MaelstromResponseSchema = z.object({
  type: z.literal('maelstrom_response'),
  requestId: MessageIdSchema,
  userMessage: z.string(),
  rationale: z.string(),
  executionPlan: z.array(ActionExecutionParsedSchema),
  layout: MaelstromLayoutSchema,
});

// ---------------------------------------------------------------------------
// Drift guards. `Mutable<T>` (from `./_drift-guards.js`) strips `readonly`
// because `z.infer` does not synthesize it, and short-circuits on primitives
// so branded ids don't expand into a string-prototype mapped type.
// ---------------------------------------------------------------------------

type _InferredMaelstromResponse = z.infer<typeof MaelstromResponseSchema>;
// Full-shape check including `layout`: like `ChartRequest` in `request.ts`, the
// tiling arm's `vesselId` / `variant` / instance ids are branded by the shared
// schema transforms, matching the hand-written interface end-to-end, so no
// per-field carve-out is needed.
const _mrFwd: _InferredMaelstromResponse extends Mutable<MaelstromResponse>
  ? true
  : false = true;
const _mrBwd: Mutable<MaelstromResponse> extends _InferredMaelstromResponse
  ? true
  : false = true;

type _InferredActionExecution = z.infer<typeof ActionExecutionParsedSchema>;
const _aeFwd: _InferredActionExecution extends Mutable<ActionExecution>
  ? true
  : false = true;
const _aeBwd: Mutable<ActionExecution> extends _InferredActionExecution
  ? true
  : false = true;

type _InferredGridLayout = z.infer<typeof GridLayoutParsedSchema>;
const _glFwd: _InferredGridLayout extends Mutable<GridLayout> ? true : false =
  true;
const _glBwd: Mutable<GridLayout> extends _InferredGridLayout ? true : false =
  true;

type _InferredTilingLayout = z.infer<typeof TilingLayoutParsedSchema>;
const _tlFwd: _InferredTilingLayout extends Mutable<TilingLayout>
  ? true
  : false = true;
const _tlBwd: Mutable<TilingLayout> extends _InferredTilingLayout
  ? true
  : false = true;

void [_mrFwd, _mrBwd, _aeFwd, _aeBwd, _glFwd, _glBwd, _tlFwd, _tlBwd];
