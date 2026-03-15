import type { ChartDimensions } from '@maelstrom/protocol';

export type ChartManagerState = {
  chartDimensions: ChartDimensions;
};

export function createInitialChartManagerState(): ChartManagerState {
  return {
    chartDimensions: { columns: 12, rows: 8 },
  };
}
