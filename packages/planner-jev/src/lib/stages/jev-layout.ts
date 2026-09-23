import type { Stage } from '@maelstrom-co/engine';
import { isErr, ok } from '@maelstrom-co/protocol';

import { deferAt } from '../defer.js';
import { finalVariants } from '../final-variants.js';
import { type LayoutChoicesOptions, layoutChoices } from '../layouts.js';
import {
  type ConfidencePolicy,
  choice,
  readAnswer,
  recentHistory,
} from '../questions.js';
import type { JevActionPlan, JevLayoutPlan } from '../types.js';
import type { Ask } from '../typesafe-client.js';

const STAGE = 'jevLayout';

/**
 * Lets Jev pick a tiling tree for the visible instances among candidates
 * that fit the Chart, sizing each instance for the variant the planned
 * actions leave it in. `options` sets how the candidates are described
 * (see {@link layoutChoices}); the default is the POC's wording.
 */
export function jevLayout(
  ask: Ask,
  policy: ConfidencePolicy = {},
  options: LayoutChoicesOptions = {},
): Stage<JevActionPlan, JevLayoutPlan> {
  return async (plan, ctx) => {
    const { request } = plan.selection.input;
    const retained = plan.selection.instances.filter(
      (instance) => instance.decision !== 'delete',
    );
    const variants = finalVariants(retained, plan.actions, request.vessels);
    if (isErr(variants)) return deferAt(ctx, STAGE, 'simulation_failed');
    const visible = retained
      .filter((instance) => instance.visible)
      .map((instance) => ({
        instanceId: instance.instanceId,
        vesselId: instance.vesselId,
        variant: variants.value.get(instance.instanceId) ?? instance.variant,
      }));
    if (visible.length === 0)
      return ok({ plan, layoutId: 'empty', tree: [], answers: [] });

    const choices = layoutChoices(request, visible, options);
    if (choices.length === 0)
      return deferAt(ctx, STAGE, 'no_feasible_layout', 'layout');

    const reply = await ask(
      STAGE,
      {
        state: {
          intent: request.context.updateReasons,
          history: recentHistory(plan.selection.input.history),
          chartDimensions: request.context.chartDimensions,
          currentLayout:
            request.layout.type === 'tiling' ? request.layout.tree : [],
          views: visible,
        },
        questions: {
          layout: choice(
            'Arrange exactly these already selected visible instances. With no spatial preference in the request, choose preserve when offered, otherwise a simple balanced layout such as row or rows_2. All offered layouts fit the Chart and every minimum size. Choose unavailable only when an explicit spatial request cannot be met by any offered layout. Do not reconsider which instances are visible.',
            {
              ...Object.fromEntries(
                choices.map((option) => [option.id, option.description]),
              ),
              unavailable:
                'An explicit spatial request (a row count, a relative position or size) cannot be met by any option. Never choose this merely because no arrangement was requested.',
            },
          ),
        },
      },
      ctx,
    );
    if (isErr(reply)) return reply;
    const answer = readAnswer(reply.value, 'layout', STAGE, ctx, policy);
    if (isErr(answer)) return answer;
    const record = {
      stage: STAGE,
      question: 'layout',
      ...answer.value,
    } as const;
    if (answer.value.choice === 'unavailable')
      return deferAt(ctx, STAGE, 'layout_unavailable', 'layout');
    const chosen = choices.find((option) => option.id === answer.value.choice);
    if (!chosen) return deferAt(ctx, STAGE, 'answer_missing', 'layout');
    return ok({
      plan,
      layoutId: chosen.id,
      tree: chosen.tree,
      answers: [record],
    });
  };
}
