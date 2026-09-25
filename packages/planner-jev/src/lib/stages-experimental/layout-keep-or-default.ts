import { finalVariants } from '@maelstrom-co/engine';
import { isErr, ok, type VesselInstanceSnapshot } from '@maelstrom-co/protocol';
import { deferAt, STAGE_NAME } from '../defer.js';
import { layoutChoices } from '../layouts.js';
import type { LayoutStage } from '../stages/stage-types.js';

const STAGE = STAGE_NAME.jevLayout;

/**
 * Keeps the current tree when it still fits the visible set, otherwise
 * falls back to the first balanced default that fits: one side-by-side
 * row, then two stacked rows, then three (the `row`, `rows_2` and `rows_3`
 * layouts of `layoutChoices`; a lone Instance fills the Chart). Hands the
 * layout off when none fits. Makes no Jev call.
 */
export const layoutKeepOrDefault: LayoutStage = async (plan, ctx) => {
  const { request } = plan.selection.input;
  const retained = plan.selection.instances.filter(
    (instance) => instance.decision !== 'delete',
  );
  const variants = finalVariants(retained, plan.actions, request.vessels);
  if (isErr(variants)) return deferAt(ctx, STAGE, 'simulation_failed');
  const visible: VesselInstanceSnapshot[] = retained
    .filter((instance) => instance.visible)
    .map((instance) => ({
      instanceId: instance.instanceId,
      vesselId: instance.vesselId,
      variant: variants.value.get(instance.instanceId) ?? instance.variant,
    }));

  const choices = layoutChoices(request, visible);
  const preserved = choices.find((option) => option.id === 'preserve');
  if (preserved)
    return ok({
      plan,
      source: 'preserve',
      layoutId: preserved.id,
      tree: preserved.tree,
      answers: [],
    });

  for (const id of BALANCED_DEFAULTS) {
    const fallback = choices.find((option) => option.id === id);
    if (fallback)
      return ok({
        plan,
        source: 'default',
        layoutId: fallback.id,
        tree: fallback.tree,
        answers: [],
      });
  }

  return ok({ plan, source: 'llm', answers: [] });
};

const BALANCED_DEFAULTS = ['empty', 'single', 'row', 'rows_2', 'rows_3'];
