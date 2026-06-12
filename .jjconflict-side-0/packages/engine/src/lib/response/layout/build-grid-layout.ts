import type { GridLayout, GridPosition } from '@maelstrom-co/protocol';

export function buildGridLayout(llmLayout: {
  positions: ReadonlyArray<GridPosition>;
}): GridLayout {
  return { type: 'grid', positions: llmLayout.positions };
}
