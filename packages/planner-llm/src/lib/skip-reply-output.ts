import type {
  GridLayout,
  GridResponseWithoutReply,
  LayoutMode,
  NeedsClarification,
  TilingLayout,
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

/**
 * Drops the partial changes from a {@link NeedsClarification} that would
 * change nothing: its `executionPlan` is empty and its `layout` is the
 * request's current layout. Such a clarification comes back with neither
 * `layout` nor `executionPlan`, which means the screen stays as it is. A
 * clarification whose layout or Actions differ, and any plan result, is
 * returned as it is.
 *
 * Layouts match when they list the same grid positions, or the same tiling
 * tree tokens and instances, in the same order. A reordered or respelled
 * layout counts as a change.
 *
 * @param output - Planner result mapped by {@link toPlannerOutput}.
 * @param currentLayout - The request's current layout.
 */
export function withoutUnchangedPartials<
  Output extends
    | GridResponseWithoutReply
    | TilingResponseWithoutReply
    | NeedsClarification,
>(output: Output, currentLayout: GridLayout | TilingLayout): Output {
  if (output.type !== 'needs_clarification') return output;
  const { layout, executionPlan, ...question } = output;
  if (
    executionPlan === undefined ||
    executionPlan.length > 0 ||
    layout === undefined ||
    !isCurrentLayout(layout, currentLayout)
  ) {
    return output;
  }
  return question as Output;
}

type ClarificationLayout = NonNullable<NeedsClarification['layout']>;

function isCurrentLayout(
  layout: ClarificationLayout,
  currentLayout: GridLayout | TilingLayout,
): boolean {
  if (currentLayout.type === 'grid') {
    return (
      'positions' in layout &&
      sameItems(
        layout.positions,
        currentLayout.positions,
        (position, current) =>
          position.instanceId === current.instanceId &&
          position.position.row === current.position.row &&
          position.position.column === current.position.column &&
          position.size.width === current.size.width &&
          position.size.height === current.size.height,
      )
    );
  }
  return (
    'tree' in layout &&
    sameItems(layout.tree, currentLayout.tree, Object.is) &&
    sameItems(
      layout.instances,
      currentLayout.instances,
      (instance, current) =>
        instance.instanceId === current.instanceId &&
        instance.vesselId === current.vesselId &&
        instance.variant === current.variant,
    )
  );
}

function sameItems<Item, CurrentItem>(
  items: readonly Item[],
  currentItems: readonly CurrentItem[],
  matches: (item: Item, current: CurrentItem) => boolean,
): boolean {
  return (
    items.length === currentItems.length &&
    items.every((item, index) =>
      matches(item, currentItems[index] as CurrentItem),
    )
  );
}
