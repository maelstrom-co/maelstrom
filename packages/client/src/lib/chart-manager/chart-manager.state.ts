import type { ChartDimensions } from '@maelstrom-co/protocol';

/** Current dimensions used for Chart layout calculations. */
export type ChartManagerState = {
  /** Available Chart cells, expressed as columns and rows. */
  chartDimensions: ChartDimensions;
};

/** Creates Chart state with the default 12-column by 8-row dimensions. */
export function createInitialChartManagerState(): ChartManagerState {
  return {
    chartDimensions: { columns: 12, rows: 8 },
  };
}
