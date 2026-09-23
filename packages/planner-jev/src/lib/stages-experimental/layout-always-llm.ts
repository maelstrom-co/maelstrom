import { ok } from '@maelstrom-co/protocol';

import type { LayoutStage } from './types.js';

/** Always hands the layout off to the LLM completion call. Makes no Jev call. */
export function layoutAlwaysLlm(): LayoutStage {
  return async (plan) => ok({ plan, source: 'llm', answers: [] });
}
