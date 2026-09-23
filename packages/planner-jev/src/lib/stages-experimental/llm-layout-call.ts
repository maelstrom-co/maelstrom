import type {
  CancellationError,
  ProviderError,
  StageContext,
} from '@maelstrom-co/engine';
import {
  MAX_SPLIT_CHILDREN,
  MAX_SPLIT_WEIGHT,
  type Result,
  type VesselInstanceSnapshot,
} from '@maelstrom-co/protocol';
import type { z } from 'zod';

import { intentText } from '../questions.js';
import { callLlm, LAYOUT_SCHEMA } from './complete-layout-inline.js';
import type { CompletionLlm } from './deps.js';
import type { LayoutDecision } from './types.js';

/** What {@link llmLayoutCall} returns: the tree, and nothing else. */
export type LayoutCompletion = z.infer<typeof LAYOUT_SCHEMA>;

/**
 * The small call `completeLayoutParallel` runs alongside its message-only
 * completion call on a hand-off: writes `tree` only, over the request's
 * intent, the visible instances with their variant and minimum size, the
 * Chart's dimensions and the current layout.
 */
export function llmLayoutCall(
  llm: CompletionLlm,
  decision: LayoutDecision,
  visible: readonly VesselInstanceSnapshot[],
  ctx: StageContext,
): Promise<Result<LayoutCompletion, CancellationError | ProviderError>> {
  return callLlm(
    llm,
    buildLayoutPrompt(decision, visible),
    LAYOUT_SCHEMA,
    decision.plan.selection.input.history,
    ctx,
  );
}

function buildLayoutPrompt(
  decision: LayoutDecision,
  visible: readonly VesselInstanceSnapshot[],
): string {
  const { request } = decision.plan.selection.input;
  const intent = intentText(request);
  const { columns, rows } = request.context.chartDimensions;
  const current =
    request.layout.type === 'tiling' ? request.layout.tree : undefined;
  const lines = [
    '## Request',
    intent.length > 0
      ? intent
      : 'No new words from the user: the chart was resized.',
    '',
    '## Layout to write',
    `Write the tree for a Chart of ${columns} columns by ${rows} rows. Place every instance below exactly once and no other, each in a region at least its minimum size. Follow any arrangement the request states; otherwise keep the current layout where it still fits.`,
    ...visible.map((view) => {
      const minimum = request.vessels.find((v) => v.id === view.vesselId)
        ?.variants[view.variant]?.minSize;
      return `- ID:${view.instanceId} (${view.vesselId}, ${view.variant} view${minimum ? `, at least ${minimum.width}x${minimum.height}` : ''})`;
    }),
    ...(current ? [`Current layout: ${JSON.stringify(current)}`] : []),
    `The tree is a preorder token array. "V" splits the width so its children sit side by side, "H" splits the height so its children are stacked; "V:2,1" or "H:1,1,1" weight each child with a whole number from 1 to ${MAX_SPLIT_WEIGHT}, and the number of weights is the number of children (at most ${MAX_SPLIT_CHILDREN}). Every split token is followed by each child subtree in full. A leaf is "ID:<instanceId>". Example: ["V:2,1", "ID:a", "H", "ID:b", "ID:c"] puts a side by side with b stacked with c, a taking two thirds of the shared space.`,
  ];
  return lines.join('\n');
}
