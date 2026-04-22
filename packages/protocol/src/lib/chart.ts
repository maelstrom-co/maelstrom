/** Position on the Chart (in chart units) */
export interface ChartPosition {
  /** Row index (0-based, from top) */
  readonly row: number;
  /** Column index (0-based, from left) */
  readonly column: number;
}

/** Size in chart units */
export interface ChartSize {
  /** Width in chart cells */
  readonly width: number;
  /** Height in chart cells */
  readonly height: number;
}

/** Available chart space */
export interface ChartDimensions {
  /** Number of available columns */
  readonly columns: number;
  /** Number of available rows */
  readonly rows: number;
}
