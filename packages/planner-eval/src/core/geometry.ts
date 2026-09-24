import {
  type ChartRequest,
  type InstanceId,
  parseTilingSplitToken,
  type TilingNode,
  tilingLeafInstanceId,
} from '@maelstrom-co/protocol';

/** A leaf's region on the Chart, in grid units from the top-left corner. */
export interface LeafRect {
  readonly instanceId: InstanceId;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * The region of every leaf of `tree` on the request's Chart, in tree order.
 * `V` splits divide the width left to right, `H` splits the height top to
 * bottom; null leaves take their share without a rect. `undefined` when the
 * tree is malformed: a repaired split token, a token that is neither a split
 * nor a leaf, too few children for a split, or tokens after the root closes.
 *
 * The scorers keep their own copy of this rule so the eval never measures a
 * planner with that planner's ruler; a test in the Jev plugin holds it equal
 * to the planner's.
 */
export function treeRects(
  request: ChartRequest,
  tree: readonly TilingNode[],
): readonly LeafRect[] | undefined {
  const remaining: Omit<LeafRect, 'instanceId'>[] = [
    {
      x: 0,
      y: 0,
      width: request.context.chartDimensions.columns,
      height: request.context.chartDimensions.rows,
    },
  ];
  const rects: LeafRect[] = [];
  for (const token of tree) {
    const space = remaining.pop();
    if (!space) return undefined;
    const branch = parseTilingSplitToken(token);
    if (branch) {
      if (branch.repaired) return undefined;
      const total = branch.weights.reduce((sum, weight) => sum + weight, 0);
      const children: Omit<LeafRect, 'instanceId'>[] = [];
      let offset = 0;
      for (const weight of branch.weights) {
        const fraction = weight / total;
        children.push(
          branch.axis === 'V'
            ? {
                x: space.x + space.width * offset,
                y: space.y,
                width: space.width * fraction,
                height: space.height,
              }
            : {
                x: space.x,
                y: space.y + space.height * offset,
                width: space.width,
                height: space.height * fraction,
              },
        );
        offset += fraction;
      }
      remaining.push(...children.reverse());
    } else if (token !== null) {
      const instanceId = tilingLeafInstanceId(token);
      if (instanceId === null) return undefined;
      rects.push({ instanceId, ...space });
    }
  }
  return remaining.length === 0 ? rects : undefined;
}
