import type { Logger } from '@maelstrom-co/engine';
import type { ChartDimensions, GridPosition } from '@maelstrom-co/protocol';

export type Island = Omit<GridPosition, 'instanceId'>;

export function computeAvailableIslands(
  dimensions: ChartDimensions,
  positions: readonly GridPosition[],
  logger?: Logger,
): readonly Island[] {
  const { columns, rows } = dimensions;
  const occupied: boolean[][] = Array.from({ length: rows }, () =>
    Array<boolean>(columns).fill(false),
  );

  for (const { instanceId, position, size } of positions) {
    if (
      position.row < 0 ||
      position.column < 0 ||
      position.row + size.height > rows ||
      position.column + size.width > columns
    ) {
      logger?.warn(
        `GridPosition "${instanceId}" (${size.width}x${size.height} at row=${position.row}, col=${position.column}) ` +
          `extends outside chart bounds ${columns}x${rows}; clipping for free-space computation.`,
      );
    }

    const rStart = Math.max(0, position.row);
    const cStart = Math.max(0, position.column);
    const rEnd = Math.min(rows, position.row + size.height);
    const cEnd = Math.min(columns, position.column + size.width);
    for (let r = rStart; r < rEnd; r++) {
      for (let c = cStart; c < cEnd; c++) {
        occupied[r][c] = true;
      }
    }
  }

  const rectangles = findMaximalRectangles(occupied, rows, columns);
  return deduplicate(rectangles);
}

export function serializeIslands(islands: readonly Island[]): string {
  if (islands.length === 0) {
    return 'No free space available. Consider hiding or resizing existing vessels.';
  }
  const lines: string[] = ['Free regions where vessels can be placed:'];
  for (const island of islands) {
    const area = island.size.width * island.size.height;
    lines.push(
      `- ${island.size.width}x${island.size.height} (${area} cells) at row=${island.position.row}, col=${island.position.column}`,
    );
  }
  return lines.join('\n');
}

// Stack-based maximal-rectangle scan over the free-space histogram of every row.
// Each row's histogram tracks, per column, how many consecutive empty cells
// sit directly above (including the current row). The stack pop emits the widest
// rectangle anchored at the current row for every histogram bar that is about
// to be shortened.
function findMaximalRectangles(
  occupied: boolean[][],
  rows: number,
  columns: number,
): Island[] {
  const rectangles: Island[] = [];
  const heights: number[] = Array<number>(columns).fill(0);

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < columns; c++) {
      heights[c] = occupied[r][c] ? 0 : heights[c] + 1;
    }
    rectangles.push(...rectanglesFromHistogram(heights, r));
  }
  return rectangles;
}

function rectanglesFromHistogram(
  heights: readonly number[],
  currentRow: number,
): Island[] {
  const rectangles: Island[] = [];
  const stack: { index: number; height: number }[] = [];
  const columns = heights.length;

  for (let c = 0; c <= columns; c++) {
    const h = c < columns ? heights[c] : 0;
    let start = c;
    while (stack.length > 0 && stack[stack.length - 1].height > h) {
      const top = stack[stack.length - 1];
      stack.pop();
      const width = c - top.index;
      if (width > 0 && top.height > 0) {
        rectangles.push({
          position: { row: currentRow - top.height + 1, column: top.index },
          size: { width, height: top.height },
        });
      }
      start = top.index;
    }
    if (h > 0 && (stack.length === 0 || stack[stack.length - 1].height < h)) {
      stack.push({ index: start, height: h });
    }
  }
  return rectangles;
}

function deduplicate(islands: readonly Island[]): Island[] {
  if (islands.length === 0) return [];
  const sorted = [...islands].sort(byDescendingArea);
  const result: Island[] = [];
  for (const island of sorted) {
    if (result.some((kept) => contains(kept, island))) continue;
    result.push(island);
  }
  return result;
}

function contains(outer: Island, inner: Island): boolean {
  return (
    outer.position.row <= inner.position.row &&
    outer.position.column <= inner.position.column &&
    outer.position.row + outer.size.height >=
      inner.position.row + inner.size.height &&
    outer.position.column + outer.size.width >=
      inner.position.column + inner.size.width
  );
}

function byDescendingArea(a: Island, b: Island): number {
  return b.size.width * b.size.height - a.size.width * a.size.height;
}
