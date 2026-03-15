import type {
  ChartDimensions,
  ChartPosition,
  ChartSize,
  GridPosition,
} from '@maelstrom/protocol';

export interface Island {
  position: ChartPosition;
  size: ChartSize;
}

export function computeAvailableIslands(
  dimensions: ChartDimensions,
  layout: GridPosition[],
): Island[] {
  const { columns, rows } = dimensions;

  const grid: boolean[][] = Array(rows)
    .fill(null)
    .map(() => Array(columns).fill(false));

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

  const islands = findMaximalRectangles(grid, rows, columns);

  return islands.sort(
    (a, b) => b.size.width * b.size.height - a.size.width * a.size.height,
  );
}

function findMaximalRectangles(
  grid: boolean[][],
  rows: number,
  columns: number,
): Island[] {
  const islands: Island[] = [];

  const heights: number[] = Array(columns).fill(0);

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < columns; c++) {
      heights[c] = grid[r][c] ? 0 : heights[c] + 1;
    }

    const rowRectangles = findRectanglesInHistogram(heights, r);
    islands.push(...rowRectangles);
  }

  return deduplicateIslands(islands);
}

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
      const top = stack.pop();
      if (!top) break;
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
      if (
        stack.length === 0 ||
        stack[stack.length - 1].height < currentHeight
      ) {
        stack.push({ index: startIndex, height: currentHeight });
      }
    }
  }

  return rectangles;
}

function deduplicateIslands(islands: Island[]): Island[] {
  if (islands.length === 0) return [];

  const sorted = [...islands].sort(
    (a, b) => b.size.width * b.size.height - a.size.width * a.size.height,
  );

  const result: Island[] = [];

  for (const island of sorted) {
    const isContained = result.some((existing) =>
      rectangleContains(existing, island),
    );

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

function rectangleContains(a: Island, b: Island): boolean {
  return (
    a.position.row <= b.position.row &&
    a.position.column <= b.position.column &&
    a.position.row + a.size.height >= b.position.row + b.size.height &&
    a.position.column + a.size.width >= b.position.column + b.size.width
  );
}

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
