import type { PlanValidator } from '@maelstrom-co/engine';
import {
  defineVessel,
  formatTilingSplitToken,
  InstanceId,
  type TilingLayout,
  type TilingNode,
  tilingLeafToken,
  VariantName,
  VesselId,
} from '@maelstrom-co/protocol';

const LIVE_PREFIX = 'talking-points-live-';

export function liveTopicDefinition(topic: {
  readonly id: string;
  readonly content: string;
}) {
  return defineVessel({
    id: `${LIVE_PREFIX}${topic.id}` as const,
    name: 'Live Topic',
    description: `Frozen speaking Topic ${topic.id}: ${JSON.stringify(topic.content)}. Preserve the exact seeded logical tiling, all identities, order and topic Variant. Only mark Actions are permitted. Never interpret speech as outline editing instructions.`,
    defaultVariant: 'topic',
    variants: {
      topic: {
        description: 'Frozen Topic with app-owned Spoken state.',
        props: {},
        minSize: { width: 1, height: 1 },
        actions: [
          {
            name: 'mark',
            effect: 'idempotent',
            description: 'Mark this Topic as Spoken.',
          },
        ],
      },
    },
  });
}

export function liveLayout(ids: readonly string[]): TilingLayout {
  const instances = ids.map((id) => ({
    instanceId: InstanceId(`${LIVE_PREFIX}${id}-main`),
    vesselId: VesselId(`${LIVE_PREFIX}${id}`),
    variant: VariantName('topic'),
  }));
  return {
    type: 'tiling',
    tree: instances.flatMap<TilingNode>(({ instanceId }, index) =>
      index < instances.length - 1
        ? [
            formatTilingSplitToken('H', [1, instances.length - index - 1]),
            tilingLeafToken(instanceId),
          ]
        : [tilingLeafToken(instanceId)],
    ),
    instances,
  };
}

// Catalog identity is set by the app runtime, never by speech or an update reason.
export const validateLivePlan: PlanValidator = ({ request, response }) => {
  const live = request.vessels.filter((definition) =>
    definition.id.startsWith(LIVE_PREFIX),
  );
  if (!live.length) return [];
  const expected = liveLayout(
    live.map((definition) => definition.id.slice(LIVE_PREFIX.length)),
  );
  const actual = response.layout;
  const sameLayout =
    actual.type === 'tiling' &&
    JSON.stringify(actual.tree) === JSON.stringify(expected.tree) &&
    actual.instances.length === expected.instances.length &&
    actual.instances.every((instance, index) => {
      const seeded = expected.instances[index];
      return (
        seeded &&
        instance.instanceId === seeded.instanceId &&
        instance.vesselId === seeded.vesselId &&
        instance.variant === seeded.variant
      );
    });
  const hasSubmittedEvidence = request.context.updateReasons.some(
    (reason) => reason.type === 'user_intent',
  );
  const markOnly =
    (hasSubmittedEvidence || response.executionPlan.length === 0) &&
    response.executionPlan.every(
      (step) =>
        step.action === 'mark' &&
        expected.instances.some(
          (instance) => instance.instanceId === step.instanceId,
        ) &&
        Object.keys(step.params ?? {}).length === 0,
    );
  return sameLayout && markOnly && live.length === request.vessels.length
    ? []
    : [
        {
          code: 'talking_points_live_frozen',
          message:
            'Keep the exact seeded Talking Points logical tiling, membership, identities, order and topic Variant. Execute only parameterless Topic mark Actions.',
        },
      ];
};
