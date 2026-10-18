import type { Orchestrator } from '@maelstrom-co/client';

export function layoutSnapshot(orchestrator: Orchestrator) {
  const { instances, layout } = orchestrator.commandProcessor.store.state;
  const retained = [];
  for (const { instanceId, vesselId, variant } of instances.values()) {
    if (retained.length === 1000) break;
    retained.push({ instanceId, vesselId, variant });
  }
  return {
    version: 1,
    instanceCount: instances.size,
    instances: retained,
    layoutMode: orchestrator.getConfig().layoutMode,
    chartDimensions: { ...orchestrator.chartManager.getDimensions() },
    layout:
      layout?.type === 'grid'
        ? {
            type: layout.type,
            positions: layout.positions
              .slice(0, 1001)
              .map(({ instanceId, position, size }) => ({
                instanceId,
                position: { row: position.row, column: position.column },
                size: { width: size.width, height: size.height },
              })),
          }
        : layout?.type === 'tiling'
          ? {
              type: layout.type,
              tree: layout.tree.slice(0, 2049),
              instances: layout.instances
                .slice(0, 1000)
                .map(({ instanceId, vesselId, variant }) => ({
                  instanceId,
                  vesselId,
                  variant,
                })),
            }
          : null,
  };
}
