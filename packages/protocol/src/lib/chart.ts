/** Default chart cell size in pixels */
export const DEFAULT_CHART_CELL_PX = 80;

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

/** Configuration for the Chart */
export interface ChartConfig {
  /** Size of each chart cell in pixels. Defaults to DEFAULT_CHART_CELL_PX (80) */
  cellSizePx?: number;
}

/** Pixel dimensions (for rendering) */
export interface PixelDimensions {
  width: number;
  height: number;
}
