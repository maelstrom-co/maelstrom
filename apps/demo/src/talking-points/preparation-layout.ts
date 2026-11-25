import {
  formatTilingSplitToken,
  InstanceId,
  type TilingLayout,
  type TilingNode,
  tilingLeafToken,
  VariantName,
  VesselId,
} from '@maelstrom-co/protocol';

import type { Topic } from './outline.store';

export const TOPIC_ROW_HEIGHT = { desktop: 80, mobile: 104 } as const;
export const MOBILE_TOPIC_MEDIA = '(max-width: 600px)';
export function preparationHeaderHeight(topicCount: number) {
  return topicCount ? 44 : 80;
}

export function preparationChartHeight(topicCount: number) {
  return `calc(${topicCount} * var(--talking-points-row-height) + ${preparationHeaderHeight(topicCount)}px)`;
}

export function preparationLayout(
  topics: readonly Topic[],
  topicRowHeight: number = TOPIC_ROW_HEIGHT.desktop,
): TilingLayout {
  const rows = [
    {
      instanceId: InstanceId('outline-main'),
      vesselId: VesselId('outline'),
      variant: VariantName('prepare'),
      weight: preparationHeaderHeight(topics.length) / 4,
    },
    ...topics.map((topic) => ({
      instanceId: InstanceId(`topic-${topic.id}-main`),
      vesselId: VesselId(`topic-${topic.id}`),
      variant: VariantName('topic'),
      weight: topicRowHeight / 4,
    })),
  ];
  function tree(group: typeof rows): TilingNode[] {
    if (group.length <= 1)
      return group.map((row) => tilingLeafToken(row.instanceId));
    // Balanced groups keep aggregate weights within the protocol limit for all 50 Topics.
    const middle = Math.ceil(group.length / 2);
    const first = group.slice(0, middle);
    const rest = group.slice(middle);
    const weight = (items: typeof rows) =>
      items.reduce((sum, row) => sum + row.weight, 0);
    return [
      formatTilingSplitToken('H', [weight(first), weight(rest)]),
      ...tree(first),
      ...tree(rest),
    ];
  }
  return {
    type: 'tiling',
    tree: tree(rows),
    instances: rows.map(({ weight: _, ...instance }) => instance),
  };
}
