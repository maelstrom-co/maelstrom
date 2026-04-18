import type { GridLayout, GridPosition } from '@maelstrom-co/protocol';
import { InstanceId } from '@maelstrom-co/protocol';

import type { LLMGridPosition } from '../../pipeline/call-llm.js';

export function buildGridLayout(llmLayout: {
  positions: ReadonlyArray<LLMGridPosition>;
}): GridLayout {
  const positions: readonly GridPosition[] = llmLayout.positions.map((p) => ({
    ...p,
    instanceId: InstanceId(p.instanceId),
  }));
  return { type: 'grid', positions };
}
