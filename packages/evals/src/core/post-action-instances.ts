import { finalVariants } from '@maelstrom-co/engine';
import {
  type ActionExecution,
  isOk,
  type MaelstromResponse,
  type Vessel,
  type VesselInstanceSnapshot,
} from '@maelstrom-co/protocol';

/**
 * The declared Instances in the Variant the execution plan leaves each one
 * in. A Layout declares every Instance in its Variant before the plan runs,
 * so the plan is replayed from those Variants with the Engine's own rule.
 * Actions on Instances the Layout does not declare are ignored. When the
 * replay fails, as it does for a record written while Layouts declared the
 * post-action Variant, the declared Variants are returned unchanged.
 */
export function postActionInstances(
  declared: readonly VesselInstanceSnapshot[],
  executionPlan: readonly ActionExecution[],
  vessels: readonly Vessel[],
): readonly VesselInstanceSnapshot[] {
  const declaredIds = new Set<string>(
    declared.map((instance) => instance.instanceId),
  );
  const replay = finalVariants(
    declared,
    executionPlan.filter((step) => declaredIds.has(step.instanceId)),
    vessels,
  );
  if (!isOk(replay)) return declared;
  return declared.map((instance) => ({
    ...instance,
    variant: replay.value.get(instance.instanceId) ?? instance.variant,
  }));
}

/**
 * The response's Layout as the Chart holds it once the execution plan has
 * run: a tiling Layout with each declared Instance in its post-action
 * Variant (see {@link postActionInstances}). A grid Layout carries no
 * Variants and is returned unchanged.
 */
export function postActionLayout(
  response: Pick<MaelstromResponse, 'layout' | 'executionPlan'>,
  vessels: readonly Vessel[],
): MaelstromResponse['layout'] {
  const { layout } = response;
  if (layout.type !== 'tiling') return layout;
  return {
    ...layout,
    instances: postActionInstances(
      layout.instances,
      response.executionPlan,
      vessels,
    ),
  };
}
