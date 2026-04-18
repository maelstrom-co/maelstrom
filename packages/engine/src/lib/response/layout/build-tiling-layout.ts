import type {
  TilingInstance,
  TilingLayout,
  TilingNode,
} from '@maelstrom-co/protocol';
import { InstanceId } from '@maelstrom-co/protocol';

import type { LLMTilingInstance } from '../../pipeline/call-llm.js';

function brandTilingNode(node: string | null): TilingNode {
  if (node === null || node === 'H' || node === 'V') return node;
  return InstanceId(node);
}

export function buildTilingLayout(llmLayout: {
  tree: ReadonlyArray<string | null>;
  instances: ReadonlyArray<LLMTilingInstance>;
}): TilingLayout {
  const tree: readonly TilingNode[] = llmLayout.tree.map(brandTilingNode);
  const instances: readonly TilingInstance[] = llmLayout.instances.map((i) => ({
    ...i,
    instanceId: InstanceId(i.instanceId),
  }));
  return { type: 'tiling', tree, instances };
}
