import type {
  ChartDimensions,
  ChartPosition,
  ChartSize,
  LayoutDirective,
} from '@maelstrom/protocol';

/**
 * A contiguous available region on the chart.
 */
export interface Island {
  /** Top-left position of the free region */
  position: ChartPosition;
  /** Size of the available region */
  size: ChartSize;
}

/**
 * Computes available islands (free rectangular regions) on the chart.
 *
 * The algorithm:
 * 1. Creates an occupancy grid from the current layout
 * 2. Finds maximal rectangles of free cells using a histogram-based approach
 * 3. Returns islands sorted by area (largest first)
 *
 * @param dimensions - The chart dimensions (columns × rows)
 * @param layout - Current layout directives (occupied regions)
 * @returns Array of available islands, sorted by area descending
 */
export function computeAvailableIslands(
  dimensions: ChartDimensions,
  layout: LayoutDirective[],
): Island[] {
  const { columns, rows } = dimensions;

  // Create occupancy grid (true = occupied)
  const grid: boolean[][] = Array(rows)
    .fill(null)
    .map(() => Array(columns).fill(false));

  // Mark occupied cells
  for (const directive of layout) {
    const { position, size } = directive;
    for (let r = position.row; r < position.row + size.height; r++) {
      for (let c = position.column; c < position.column + size.width; c++) {
        if (r >= 0 && r < rows && c >= 0 && c < columns) {
          grid[r][c] = true;
        }
      }
    }
  }

  // Find all maximal free rectangles using the histogram method
  const islands = findMaximalRectangles(grid, rows, columns);

  // Sort by area (largest first)
  return islands.sort(
    (a, b) => b.size.width * b.size.height - a.size.width * a.size.height,
  );
}

/**
 * Finds maximal free rectangles in a grid using histogram-based approach.
 * Returns non-overlapping rectangles that cover all free space.
 */
function findMaximalRectangles(
  grid: boolean[][],
  rows: number,
  columns: number,
): Island[] {
  const islands: Island[] = [];

  // Build height histogram for each row
  // heights[c] = number of consecutive free cells above (including current row)
  const heights: number[] = Array(columns).fill(0);

  for (let r = 0; r < rows; r++) {
    // Update heights for current row
    for (let c = 0; c < columns; c++) {
      heights[c] = grid[r][c] ? 0 : heights[c] + 1;
    }

    // Find rectangles in this histogram using stack-based approach
    const rowRectangles = findRectanglesInHistogram(heights, r);
    islands.push(...rowRectangles);
  }

  // Deduplicate and merge overlapping rectangles
  return deduplicateIslands(islands);
}

/**
 * Finds all maximal rectangles in a histogram.
 * Uses a stack-based approach to find largest rectangles.
 */
function findRectanglesInHistogram(
  heights: number[],
  currentRow: number,
): Island[] {
  const rectangles: Island[] = [];
  const stack: { index: number; height: number }[] = [];
  const columns = heights.length;

  for (let c = 0; c <= columns; c++) {
    const currentHeight = c < columns ? heights[c] : 0;

    let startIndex = c;
    while (stack.length > 0 && stack[stack.length - 1].height > currentHeight) {
      const top = stack.pop()!;
      const width = c - top.index;
      const height = top.height;

      if (width > 0 && height > 0) {
        rectangles.push({
          position: {
            row: currentRow - height + 1,
            column: top.index,
          },
          size: {
            width,
            height,
          },
        });
      }

      startIndex = top.index;
    }

    if (currentHeight > 0) {
      if (stack.length === 0 || stack[stack.length - 1].height < currentHeight) {
        stack.push({ index: startIndex, height: currentHeight });
      }
    }
  }

  return rectangles;
}

/**
 * Removes duplicate and contained rectangles, keeping only maximal ones.
 */
function deduplicateIslands(islands: Island[]): Island[] {
  if (islands.length === 0) return [];

  // Sort by area descending
  const sorted = [...islands].sort(
    (a, b) => b.size.width * b.size.height - a.size.width * a.size.height,
  );

  const result: Island[] = [];

  for (const island of sorted) {
    // Check if this island is contained within any existing result
    const isContained = result.some((existing) =>
      rectangleContains(existing, island),
    );

    // Check if this island is a duplicate
    const isDuplicate = result.some(
      (existing) =>
        existing.position.row === island.position.row &&
        existing.position.column === island.position.column &&
        existing.size.width === island.size.width &&
        existing.size.height === island.size.height,
    );

    if (!isContained && !isDuplicate) {
      result.push(island);
    }
  }

  return result;
}

/**
 * Checks if rectangle A fully contains rectangle B.
 */
function rectangleContains(a: Island, b: Island): boolean {
  return (
    a.position.row <= b.position.row &&
    a.position.column <= b.position.column &&
    a.position.row + a.size.height >= b.position.row + b.size.height &&
    a.position.column + a.size.width >= b.position.column + b.size.width
  );
}

/**
 * Serializes islands to a human-readable format for the LLM prompt.
 */
export function serializeIslands(islands: Island[]): string {
  if (islands.length === 0) {
    return 'No free space available. Consider hiding or resizing existing vessels.';
  }

  const lines = ['Free regions where vessels can be placed:'];

  for (const island of islands) {
    const area = island.size.width * island.size.height;
    lines.push(
      `- ${island.size.width}x${island.size.height} (${area} cells) at row=${island.position.row}, col=${island.position.column}`,
    );
  }

  return lines.join('\n');
}
