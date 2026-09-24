import { describe, expect, test } from 'bun:test';
import type { Logger } from '@maelstrom-co/engine';
import type { ChartDimensions, GridPosition } from '@maelstrom-co/protocol';
import { InstanceId } from '@maelstrom-co/protocol';
import {
  computeAvailableIslands,
  type Island,
  serializeIslands,
} from './islands.js';

const DIMS: ChartDimensions = { columns: 4, rows: 3 };

function occupy(
  instanceId: string,
  row: number,
  column: number,
  width: number,
  height: number,
): GridPosition {
  return {
    instanceId: InstanceId(instanceId),
    position: { row, column },
    size: { width, height },
  };
}

function createSpyLogger(): { logger: Logger; warns: string[] } {
  const warns: string[] = [];
  const logger: Logger = {
    debug: () => {},
    info: () => {},
    warn: (msg) => warns.push(msg),
    error: () => {},
  };
  return { logger, warns };
}

describe('computeAvailableIslands', () => {
  test('returns one island covering the entire chart when layout is empty', () => {
    const islands = computeAvailableIslands(DIMS, []);
    expect(islands).toHaveLength(1);
    expect(islands[0]).toEqual({
      position: { row: 0, column: 0 },
      size: { width: 4, height: 3 },
    });
  });

  test('returns an empty array when the chart is fully occupied', () => {
    const islands = computeAvailableIslands(DIMS, [occupy('a', 0, 0, 4, 3)]);
    expect(islands).toEqual([]);
  });

  test('finds the rectangle next to a single occupied cell', () => {
    const islands = computeAvailableIslands(DIMS, [occupy('a', 0, 0, 2, 2)]);
    expect(islands).toContainEqual<Island>({
      position: { row: 0, column: 2 },
      size: { width: 2, height: 3 },
    });
    expect(islands).toContainEqual<Island>({
      position: { row: 2, column: 0 },
      size: { width: 4, height: 1 },
    });
  });

  test('orders islands largest-first by area', () => {
    const islands = computeAvailableIslands(DIMS, [occupy('a', 0, 0, 1, 1)]);
    const areas = islands.map((i) => i.size.width * i.size.height);
    const sorted = [...areas].sort((a, b) => b - a);
    expect(areas).toEqual(sorted);
  });

  test('clips occupancy that extends outside the chart and warns', () => {
    // Size (width=10, height=10) at (0,0) overflows a 4x3 chart.
    // Implementation must clip to chart bounds, not throw, and surface
    // the anomaly through the logger so upstream state corruption is
    // observable instead of silently erasing the free-space section.
    const { logger, warns } = createSpyLogger();
    const islands = computeAvailableIslands(
      DIMS,
      [occupy('a', 0, 0, 10, 10)],
      logger,
    );
    expect(islands).toEqual([]);
    expect(warns).toHaveLength(1);
    expect(warns[0]).toContain('"a"');
    expect(warns[0]).toContain('10x10');
    expect(warns[0]).toContain('4x3');
  });

  test('returned islands are never strictly contained in one another', () => {
    // A single 2x2 occupied cell carves the remaining free space into
    // multiple overlapping free rectangles that the histogram scan emits
    // as nested candidates before dedup (e.g. the full-width bottom strip
    // and its left sub-strip both get produced row-by-row). Dedup must
    // keep the larger and drop the strictly-contained one.
    const islands = computeAvailableIslands({ columns: 4, rows: 4 }, [
      occupy('a', 0, 0, 2, 2),
    ]);

    // Guard against over-dedup: the absence-of-containment check below is
    // vacuously true on [] or a singleton, so pin the minimum population.
    expect(islands.length).toBeGreaterThanOrEqual(2);

    for (const inner of islands) {
      for (const outer of islands) {
        if (inner === outer) continue;
        const contains =
          outer.position.row <= inner.position.row &&
          outer.position.column <= inner.position.column &&
          outer.position.row + outer.size.height >=
            inner.position.row + inner.size.height &&
          outer.position.column + outer.size.width >=
            inner.position.column + inner.size.width;
        const strictlyContained =
          contains &&
          outer.size.width * outer.size.height >
            inner.size.width * inner.size.height;
        expect(strictlyContained).toBe(false);
      }
    }
  });

  test('L-shape: two diagonal occupants carve two disjoint 2x2 free regions', () => {
    const islands = computeAvailableIslands({ columns: 4, rows: 4 }, [
      occupy('a', 0, 0, 2, 2),
      occupy('b', 2, 2, 2, 2),
    ]);
    expect(islands).toContainEqual<Island>({
      position: { row: 0, column: 2 },
      size: { width: 2, height: 2 },
    });
    expect(islands).toContainEqual<Island>({
      position: { row: 2, column: 0 },
      size: { width: 2, height: 2 },
    });
  });

  test('doughnut hole: central occupant leaves four rim strips as maximal rectangles', () => {
    const islands = computeAvailableIslands({ columns: 4, rows: 4 }, [
      occupy('a', 1, 1, 2, 2),
    ]);
    expect(islands).toContainEqual<Island>({
      position: { row: 0, column: 0 },
      size: { width: 4, height: 1 },
    });
    expect(islands).toContainEqual<Island>({
      position: { row: 3, column: 0 },
      size: { width: 4, height: 1 },
    });
    expect(islands).toContainEqual<Island>({
      position: { row: 0, column: 0 },
      size: { width: 1, height: 4 },
    });
    expect(islands).toContainEqual<Island>({
      position: { row: 0, column: 3 },
      size: { width: 1, height: 4 },
    });
  });

  test('multi-occupant disjoint: stale heights do not leak between obstacles', () => {
    const islands = computeAvailableIslands({ columns: 4, rows: 3 }, [
      occupy('a', 0, 0, 1, 1),
      occupy('b', 0, 3, 1, 1),
    ]);
    // Bottom two rows span full width; top row exposes a 2-cell middle strip.
    expect(islands).toContainEqual<Island>({
      position: { row: 1, column: 0 },
      size: { width: 4, height: 2 },
    });
    expect(islands).toContainEqual<Island>({
      position: { row: 0, column: 1 },
      size: { width: 2, height: 3 },
    });
  });

  test('edge-meeting occupancy: full last column leaves a clean rectangular free region', () => {
    const { logger, warns } = createSpyLogger();
    const islands = computeAvailableIslands(
      DIMS,
      [occupy('a', 0, 3, 1, 3)],
      logger,
    );
    expect(islands).toHaveLength(1);
    expect(islands[0]).toEqual({
      position: { row: 0, column: 0 },
      size: { width: 3, height: 3 },
    });
    // column + width == columns is on-boundary, not out-of-bounds — no warn.
    expect(warns).toEqual([]);
  });
});

describe('serializeIslands', () => {
  test('emits the no-free-space message on empty input', () => {
    expect(serializeIslands([])).toBe(
      'No free space available. Consider hiding or resizing existing vessels.',
    );
  });

  test('emits a header and one line per island with area and coordinates', () => {
    const islands: Island[] = [
      { position: { row: 0, column: 2 }, size: { width: 2, height: 3 } },
      { position: { row: 2, column: 0 }, size: { width: 4, height: 1 } },
    ];
    const output = serializeIslands(islands);
    expect(output).toContain('Free regions where vessels can be placed:');
    expect(output).toContain('- 2x3 (6 cells) at row=0, col=2');
    expect(output).toContain('- 4x1 (4 cells) at row=2, col=0');
  });
});
