/** Position on the Chart (in chart units) */
export interface ChartPosition {
  /** Row index (0-based, from top) */
  row: number;
  /** Column index (0-based, from left) */
  column: number;
}

/** Size in chart units */
export interface ChartSize {
  /** Width in chart cells */
  width: number;
  /** Height in chart cells */
  height: number;
}

/** Available chart space */
export interface ChartDimensions {
  /** Number of available columns */
  columns: number;
  /** Number of available rows */
  rows: number;
}

/** Layout mode for the chart */
export type LayoutMode = 'grid' | 'tiling';

/** Split direction in a tiling binary tree */
export type TilingSplitDirection = 'H' | 'V';

/** A node in the tiling binary tree (preorder serialization) */
export type TilingNode = TilingSplitDirection | string | null;
