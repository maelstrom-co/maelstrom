import { z } from 'zod';

import type { Mutable } from './_drift-guards.ts';
import type { LayoutMode } from './layout.ts';
import { MAX_EXECUTION_PLAN_ENTRIES } from './model-output-limits.ts';
import {
  ActionExecutionSchema,
  GridLayoutSchema,
  TilingLayoutSchema,
} from './schemas.ts';

/**
 * A Planner result that asks the user a question. It may also carry the
 * changes the Planner could already make alongside the question: for "Show
 * Apple and Alphabet stock" it can lay out Apple and ask which Alphabet share
 * class the user means. Without `layout` and `executionPlan` it leaves the
 * screen unchanged.
 *
 * `M` is the request's layout mode and picks the `layout` shape, as
 * `GridResponse` and `TilingResponse` do for a plan result. The default
 * accepts either shape.
 *
 * Only valid when the chart request set `skipReply: true`. A caller that
 * leaves `skipReply` unset expects a reply-bearing response, so the Engine
 * rejects this result on that path. Engine validation accepts it when the
 * flag is set, but `Engine.handle` still refuses it with
 * `Err(ValidationError)` on field `skipReply`, because a `chart_response` has
 * no shape for a question. A replyless plan result does ship, with
 * `userMessage` absent.
 */
export interface NeedsClarification<M extends LayoutMode = LayoutMode> {
  /** Discriminant that tells this result apart from a plan result. */
  readonly type: 'needs_clarification';
  /** The question the Planner needs answered before it can proceed. Never blank. */
  readonly question: string;
  /** Suggested answers the caller may offer the user. Each one is non-blank. */
  readonly options?: readonly string[];
  /**
   * Layout the Planner could already settle, in the request's mode. Absent
   * means the current layout stays as it is.
   */
  readonly layout?: ClarificationLayoutFor<M>;
  /**
   * Actions the Planner could already plan, in order, with the same shape
   * and limit as a plan result's execution plan. Absent means no Actions.
   */
  readonly executionPlan?: readonly ClarificationAction[];
}

/**
 * Zod parser for a grid-mode {@link NeedsClarification}. Rejects a blank
 * `question`, any blank or non-string entry in `options`, a tiling `layout`,
 * and an execution plan longer than a plan result allows.
 */
export const GridNeedsClarificationSchema =
  clarificationSchemaWithLayout(GridLayoutSchema);

/**
 * Zod parser for a tiling-mode {@link NeedsClarification}. Rejects a blank
 * `question`, any blank or non-string entry in `options`, a grid `layout`,
 * and an execution plan longer than a plan result allows.
 */
export const TilingNeedsClarificationSchema =
  clarificationSchemaWithLayout(TilingLayoutSchema);

/**
 * Zod parser for a {@link NeedsClarification} of either layout mode. Prefer
 * {@link GridNeedsClarificationSchema} or
 * {@link TilingNeedsClarificationSchema} when the request's mode is known,
 * since this parser cannot reject a `layout` that disagrees with it.
 */
export const NeedsClarificationSchema = clarificationSchemaWithLayout(
  z.union([GridLayoutSchema, TilingLayoutSchema]),
);

type ClarificationAction = z.infer<typeof ActionExecutionSchema>;

type ClarificationLayoutFor<M extends LayoutMode> = M extends 'grid'
  ? z.infer<typeof GridLayoutSchema>
  : z.infer<typeof TilingLayoutSchema>;

function clarificationSchemaWithLayout<Layout extends z.ZodType>(
  layout: Layout,
) {
  return z.object({
    type: z.literal('needs_clarification'),
    question: z.string().refine(isNonBlank, {
      message: 'question must not be blank',
    }),
    options: z
      .array(
        z.string().refine(isNonBlank, { message: 'options must not be blank' }),
      )
      .optional(),
    layout: layout.optional(),
    executionPlan: z
      .array(ActionExecutionSchema)
      .max(MAX_EXECUTION_PLAN_ENTRIES)
      .optional(),
  });
}

function isNonBlank(value: string): boolean {
  return value.trim().length > 0;
}

type _InferredNeedsClarification = z.infer<typeof NeedsClarificationSchema>;
const _needsClarificationFwd: _InferredNeedsClarification extends Mutable<NeedsClarification>
  ? true
  : false = true;
const _needsClarificationBwd: Mutable<NeedsClarification> extends _InferredNeedsClarification
  ? true
  : false = true;

type _InferredGridClarification = z.infer<typeof GridNeedsClarificationSchema>;
const _gridClarificationFwd: _InferredGridClarification extends Mutable<
  NeedsClarification<'grid'>
>
  ? true
  : false = true;
const _gridClarificationBwd: Mutable<
  NeedsClarification<'grid'>
> extends _InferredGridClarification
  ? true
  : false = true;

type _InferredTilingClarification = z.infer<
  typeof TilingNeedsClarificationSchema
>;
const _tilingClarificationFwd: _InferredTilingClarification extends Mutable<
  NeedsClarification<'tiling'>
>
  ? true
  : false = true;
const _tilingClarificationBwd: Mutable<
  NeedsClarification<'tiling'>
> extends _InferredTilingClarification
  ? true
  : false = true;

void [
  _needsClarificationFwd,
  _needsClarificationBwd,
  _gridClarificationFwd,
  _gridClarificationBwd,
  _tilingClarificationFwd,
  _tilingClarificationBwd,
];
