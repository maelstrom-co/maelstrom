import type {
  ChartDimensions,
  GridLayout,
  InstanceId,
  TilingLayout,
} from '@maelstrom-co/protocol';
import {
  parseTilingSplitToken,
  tilingLeafInstanceId,
} from '@maelstrom-co/protocol';

/**
 * Names the screen region of every rendered Instance in a layout as a phrase
 * such as "on the left", "at the top left" or "filling the screen". A band
 * that touches neither edge of an axis and sits off its centre is "inner", as
 * in "on the inner left", so four-way splits stay distinct. Tiling `H` splits
 * stack children top to bottom and `V` splits place them left to right; grid
 * positions are measured against the Chart dimensions. Instances without a
 * known position are absent from the map.
 */
export function describeRegions(
  layout: GridLayout | TilingLayout | null,
  chartDimensions: ChartDimensions,
): ReadonlyMap<InstanceId, string> {
  const rects =
    layout === null
      ? new Map<InstanceId, Rect>()
      : layout.type === 'tiling'
        ? tilingRects(layout.tree)
        : gridRects(layout, chartDimensions);
  const regions = new Map<InstanceId, string>();
  for (const [instanceId, rect] of rects) {
    regions.set(instanceId, regionName(rect));
  }
  return regions;
}

interface Rect {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

const FULL_RECT: Rect = { left: 0, right: 1, top: 0, bottom: 1 };

const EDGE_TOLERANCE = 0.01;

function tilingRects(
  tree: TilingLayout['tree'],
): ReadonlyMap<InstanceId, Rect> {
  const rects = new Map<InstanceId, Rect>();
  const pending: Rect[] = [FULL_RECT];
  for (const node of tree) {
    const rect = pending.pop();
    if (rect === undefined) break;
    const split = parseTilingSplitToken(node);
    if (split !== null) {
      pending.push(...splitRect(rect, split.axis, split.weights).reverse());
      continue;
    }
    const instanceId = tilingLeafInstanceId(node);
    if (instanceId !== null && !rects.has(instanceId)) {
      rects.set(instanceId, rect);
    }
  }
  return rects;
}

// H stacks children top to bottom; V places them left to right.
function splitRect(
  rect: Rect,
  axis: 'H' | 'V',
  weights: readonly number[],
): Rect[] {
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  const [start, end] =
    axis === 'H' ? [rect.top, rect.bottom] : [rect.left, rect.right];
  const span = end - start;
  let offset = start;
  return weights.map((weight) => {
    const from = offset;
    offset += (span * weight) / total;
    return axis === 'H'
      ? { ...rect, top: from, bottom: offset }
      : { ...rect, left: from, right: offset };
  });
}

function gridRects(
  layout: GridLayout,
  chartDimensions: ChartDimensions,
): ReadonlyMap<InstanceId, Rect> {
  const rects = new Map<InstanceId, Rect>();
  if (layout.positions.length === 0) return rects;
  const columns =
    chartDimensions.columns > 0
      ? chartDimensions.columns
      : Math.max(
          ...layout.positions.map((p) => p.position.column + p.size.width),
        );
  const rows =
    chartDimensions.rows > 0
      ? chartDimensions.rows
      : Math.max(
          ...layout.positions.map((p) => p.position.row + p.size.height),
        );
  if (columns <= 0 || rows <= 0) return rects;
  for (const { instanceId, position, size } of layout.positions) {
    if (rects.has(instanceId)) continue;
    rects.set(instanceId, {
      left: position.column / columns,
      right: (position.column + size.width) / columns,
      top: position.row / rows,
      bottom: (position.row + size.height) / rows,
    });
  }
  return rects;
}

function regionName(rect: Rect): string {
  const vertical = axisTerm(rect.top, rect.bottom, 'top', 'bottom');
  const horizontal = axisTerm(rect.left, rect.right, 'left', 'right');
  if (vertical === 'middle' && horizontal === 'middle') return 'in the center';
  if (vertical === null) {
    if (horizontal === null) return 'filling the screen';
    return horizontal === 'middle' ? 'in the middle' : `on the ${horizontal}`;
  }
  if (horizontal === null) {
    return vertical === 'middle' ? 'in the middle' : `at the ${vertical}`;
  }
  return `at the ${vertical} ${horizontal}`;
}

function axisTerm(
  start: number,
  end: number,
  startName: string,
  endName: string,
): string | null {
  const touchesStart = start <= EDGE_TOLERANCE;
  const touchesEnd = end >= 1 - EDGE_TOLERANCE;
  if (touchesStart && touchesEnd) return null;
  if (touchesStart) return startName;
  if (touchesEnd) return endName;
  const center = (start + end) / 2;
  if (center < 0.4) return `inner ${startName}`;
  if (center > 0.6) return `inner ${endName}`;
  return 'middle';
}
