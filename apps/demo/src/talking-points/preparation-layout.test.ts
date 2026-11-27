import { computeTilingLayout, parseTilingTree } from '@maelstrom-co/client';
import { expect, it } from 'vitest';

import { MAX_TOPICS } from './outline.store';
import {
  preparationChartHeight,
  preparationHeaderHeight,
  preparationLayout,
  TOPIC_ROW_HEIGHT,
} from './preparation-layout';

it.each([
  { width: 1280, rowHeight: TOPIC_ROW_HEIGHT.desktop },
  { width: 390, rowHeight: TOPIC_ROW_HEIGHT.mobile },
])(
  'allocates a compact unboxed heading without growing Topics at width $width',
  ({ width, rowHeight }) => {
    for (const count of [0, 1, MAX_TOPICS]) {
      const topics = Array.from({ length: count }, (_, index) => ({
        id: `topic-${index}`,
        content: 'A long wrapped speaking point. '.repeat(30),
      }));
      const layout = preparationLayout(topics, rowHeight);
      const tiles = computeTilingLayout(
        parseTilingTree(layout.tree),
        {
          x: 0,
          y: 0,
          width,
          height: count * rowHeight + preparationHeaderHeight(count),
        },
        8,
      );
      expect(tiles).toHaveLength(count + 1);
      expect(tiles[0]!.instanceId).toBe('outline-main');
      expect(tiles[0]!.rect.height).toBeCloseTo((count ? 44 : 80) - 8);
      for (const [index, tile] of tiles.slice(1).entries()) {
        expect(tile.instanceId).toBe(`topic-topic-${index}-main`);
        expect(tile.rect.height).toBeCloseTo(rowHeight - 8);
      }
      expect(layout.instances.map((instance) => instance.instanceId)).toEqual(
        tiles.map((tile) => tile.instanceId),
      );
      expect(preparationChartHeight(count)).toBe(
        `calc(${count} * var(--talking-points-row-height) + ${count ? 44 : 80}px)`,
      );
    }
  },
);
