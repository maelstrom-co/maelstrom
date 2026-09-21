import {
  type ChartRequest,
  formatTilingSplitToken,
  MAX_SPLIT_CHILDREN,
  MAX_SPLIT_WEIGHT,
  type TilingNode,
  tilingLeafToken,
  type VesselInstanceSnapshot,
} from '@maelstrom-co/protocol';

interface Item {
  readonly instance: VesselInstanceSnapshot;
  readonly width: number;
  readonly height: number;
}
interface Band {
  readonly items: Item[];
  extent: number;
  thickness: number;
}
export interface Packing {
  readonly tree: readonly TilingNode[];
  readonly description: string;
}

/** Bounded shelf candidates; callers must check the encoded tree after weight quantization. */
export function packingChoices(
  request: ChartRequest,
  visible: readonly VesselInstanceSnapshot[],
  axis: 'H' | 'V',
): readonly Packing[] {
  if (
    !visible.length ||
    visible.length > MAX_SPLIT_CHILDREN * MAX_SPLIT_CHILDREN
  )
    return [];
  const items: Item[] = [];
  for (const instance of visible) {
    const minimum = request.vessels.find(
      (vessel) => vessel.id === instance.vesselId,
    )?.variants[instance.variant]?.minSize;
    if (!minimum) return [];
    items.push({ instance, ...minimum });
  }
  const orders = [
    items,
    [...items].sort((a, b) => b.width * b.height - a.width * a.height),
    [...items].sort((a, b) => b.height - a.height || b.width - a.width),
    [...items].sort((a, b) => b.width - a.width || b.height - a.height),
  ];
  return orders.flatMap((order) => {
    const result = pack(
      order,
      axis,
      request.context.chartDimensions.columns,
      request.context.chartDimensions.rows,
    );
    return result ? [result] : [];
  });
}

function weights(sizes: readonly number[]): [number, number, ...number[]] {
  let divisor = 0;
  if (sizes.every(Number.isSafeInteger)) {
    for (const size of sizes) {
      let remainder = size;
      while (remainder) [divisor, remainder] = [remainder, divisor % remainder];
    }
  }
  const reduced = sizes.map((size) => size / (divisor || 1));
  const maximum = Math.max(...reduced);
  const scale =
    maximum > MAX_SPLIT_WEIGHT || !sizes.every(Number.isSafeInteger);
  return reduced.map((size) =>
    Math.max(1, Math.round(scale ? (size / maximum) * MAX_SPLIT_WEIGHT : size)),
  ) as [number, number, ...number[]];
}

function join(
  axis: 'H' | 'V',
  children: readonly (readonly TilingNode[])[],
  sizes: readonly number[],
): readonly TilingNode[] {
  if (children.length === 1) return children[0];
  return [formatTilingSplitToken(axis, weights(sizes)), ...children.flat()];
}

function pack(
  items: readonly Item[],
  axis: 'H' | 'V',
  width: number,
  height: number,
): Packing | undefined {
  const capacity = axis === 'V' ? height : width;
  const crossCapacity = axis === 'V' ? width : height;
  const bands: Band[] = [];
  let totalThickness = 0;
  for (const item of items) {
    const extent = axis === 'V' ? item.height : item.width;
    const thickness = axis === 'V' ? item.width : item.height;
    if (extent > capacity || thickness > crossCapacity) return undefined;
    let target: Band | undefined;
    let growth = thickness;
    for (const band of bands) {
      const extra = Math.max(band.thickness, thickness) - band.thickness;
      if (
        band.items.length < MAX_SPLIT_CHILDREN &&
        band.extent + extent <= capacity &&
        extra < growth
      ) {
        target = band;
        growth = extra;
      }
    }
    if (totalThickness + growth > crossCapacity) return undefined;
    if (target) {
      target.items.push(item);
      target.extent += extent;
      target.thickness += growth;
    } else {
      if (bands.length === MAX_SPLIT_CHILDREN) return undefined;
      bands.push({ items: [item], extent, thickness });
    }
    totalThickness += growth;
  }
  const tree = join(
    axis,
    bands.map((band) =>
      join(
        axis === 'V' ? 'H' : 'V',
        band.items.map((item) => [tilingLeafToken(item.instance.instanceId)]),
        band.items.map((item) => (axis === 'V' ? item.height : item.width)),
      ),
    ),
    bands.map((band) => band.thickness),
  );
  return {
    tree,
    description: `${bands.length} size-aware ${axis === 'V' ? 'columns' : 'rows'}, with groups ${bands.map((band) => `[${band.items.map((item) => item.instance.instanceId).join(', ')}]`).join('; ')}. Unequal splits fit all ${items.length} instances using their minimum sizes.`,
  };
}
