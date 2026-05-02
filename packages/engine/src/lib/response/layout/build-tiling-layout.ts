import type {
  TilingInstance,
  TilingLayout,
  TilingNode,
} from '@maelstrom-co/protocol';

export function buildTilingLayout(llmLayout: {
  tree: ReadonlyArray<TilingNode>;
  instances: ReadonlyArray<TilingInstance>;
}): TilingLayout {
  return {
    type: 'tiling',
    tree: llmLayout.tree,
    instances: llmLayout.instances,
  };
}
