import type {
  GridResponseWithoutReply,
  LayoutMode,
  NeedsClarification,
  TilingResponseWithoutReply,
} from '@maelstrom-co/protocol';
import {
  GridModelOutputSchema,
  GridNeedsClarificationSchema,
  TilingModelOutputSchema,
  TilingNeedsClarificationSchema,
} from '@maelstrom-co/protocol';
import type { z } from 'zod';

const CLARIFICATION_DESCRIPTION =
  'Set only when you cannot proceed without asking the user a question. Leave it out whenever the intent is clear. When set, the layout and executionPlan you also fill are carried along as partial changes for the parts of the request that are already clear.';

const gridSkipReplyOutputSchema = GridModelOutputSchema.omit({
  userMessage: true,
}).extend({
  clarification: GridNeedsClarificationSchema.pick({
    question: true,
    options: true,
  })
    .optional()
    .describe(CLARIFICATION_DESCRIPTION),
});

const tilingSkipReplyOutputSchema = TilingModelOutputSchema.omit({
  userMessage: true,
}).extend({
  clarification: TilingNeedsClarificationSchema.pick({
    question: true,
    options: true,
  })
    .optional()
    .describe(CLARIFICATION_DESCRIPTION),
});

/**
 * Structured-output schema a grid-mode model fills when the request set
 * `skipReply: true`: the grid model output without `userMessage`, plus an
 * optional `clarification`.
 */
export type GridSkipReplyOutputSchema = typeof gridSkipReplyOutputSchema;

/**
 * Structured-output schema a tiling-mode model fills when the request set
 * `skipReply: true`: the tiling model output without `userMessage`, plus an
 * optional `clarification`.
 */
export type TilingSkipReplyOutputSchema = typeof tilingSkipReplyOutputSchema;

/** Parsed grid-mode model output for a request that set `skipReply: true`. */
export type GridSkipReplyOutput = z.infer<GridSkipReplyOutputSchema>;

/** Parsed tiling-mode model output for a request that set `skipReply: true`. */
export type TilingSkipReplyOutput = z.infer<TilingSkipReplyOutputSchema>;

/**
 * Returns the structured-output schema sent to the model for a request that
 * set `skipReply: true` in the given layout mode. It is one flat object with
 * no `type` and no `userMessage`, and an optional `clarification` holding a
 * non-blank `question` and optional non-blank `options`. Every plan field
 * keeps the mode's model output rules, so the schema stays valid for strict
 * structured output.
 *
 * @param mode - The request's layout mode.
 */
export function skipReplyOutputSchemaFor(
  mode: 'grid',
): GridSkipReplyOutputSchema;
export function skipReplyOutputSchemaFor(
  mode: 'tiling',
): TilingSkipReplyOutputSchema;
export function skipReplyOutputSchemaFor(
  mode: LayoutMode,
): GridSkipReplyOutputSchema | TilingSkipReplyOutputSchema;
export function skipReplyOutputSchemaFor(
  mode: LayoutMode,
): GridSkipReplyOutputSchema | TilingSkipReplyOutputSchema {
  return mode === 'grid'
    ? gridSkipReplyOutputSchema
    : tilingSkipReplyOutputSchema;
}

/**
 * Maps parsed skipReply model output to the Planner result it stands for.
 * Output with a `clarification` becomes a {@link NeedsClarification} that
 * carries the same output's `layout` and `executionPlan` as partial changes,
 * and `options` only when the model gave them. Any other output becomes a
 * replyless plan stamped `type: 'plan'`, with neither a `clarification` nor
 * a `userMessage` key.
 *
 * @param parsed - Output already parsed with {@link skipReplyOutputSchemaFor}.
 */
export function toPlannerOutput(
  parsed: GridSkipReplyOutput,
): GridResponseWithoutReply | NeedsClarification<'grid'>;
export function toPlannerOutput(
  parsed: TilingSkipReplyOutput,
): TilingResponseWithoutReply | NeedsClarification<'tiling'>;
export function toPlannerOutput(
  parsed: GridSkipReplyOutput | TilingSkipReplyOutput,
): GridResponseWithoutReply | TilingResponseWithoutReply | NeedsClarification;
export function toPlannerOutput(
  parsed: GridSkipReplyOutput | TilingSkipReplyOutput,
): GridResponseWithoutReply | TilingResponseWithoutReply | NeedsClarification {
  const { clarification, ...plan } = parsed;
  if (clarification === undefined) return { type: 'plan', ...plan };
  return {
    type: 'needs_clarification',
    question: clarification.question,
    ...(clarification.options !== undefined && {
      options: clarification.options,
    }),
    layout: plan.layout,
    executionPlan: plan.executionPlan,
  };
}
