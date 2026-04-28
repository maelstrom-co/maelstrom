import type {
  GridLayout,
  LayoutMode,
  TilingLayout,
} from '@maelstrom-co/protocol';

import { assertNever } from '../../assert-never.js';
import type {
  LLMGridPosition,
  LLMOutput,
  LLMTilingInstance,
} from '../../pipeline/call-llm.js';
import { buildGridLayout } from './build-grid-layout.js';
import { buildTilingLayout } from './build-tiling-layout.js';

/**
 * The LLM output schemas intentionally omit the `type` discriminant to reduce
 * token usage. We reconstruct it here based on `mode` from the request, which
 * selected the same schema used for the LLM call.
 */
export function buildLayout(
  llmLayout: LLMOutput['layout'],
  mode: LayoutMode,
): GridLayout | TilingLayout {
  switch (mode) {
    case 'grid': {
      return buildGridLayout(
        llmLayout as { positions: ReadonlyArray<LLMGridPosition> },
      );
    }
    case 'tiling': {
      return buildTilingLayout(
        llmLayout as {
          tree: ReadonlyArray<string | null>;
          instances: ReadonlyArray<LLMTilingInstance>;
        },
      );
    }
    default:
      return assertNever(mode, 'Unsupported layout mode');
  }
}
