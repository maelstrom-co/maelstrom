import { finalVariants } from '@maelstrom-co/engine';
import { isErr, ok, type VesselInstanceSnapshot } from '@maelstrom-co/protocol';
import { deferAt, STAGE_NAME } from '../defer.js';
import { layoutChoices } from '../layouts.js';
import { choice, noul, readAnswer, recentHistory } from '../questions.js';
import type { LayoutStage } from '../stages/stage-types.js';
import type { AnswerRecord } from '../types.js';
import type { Ask } from '../typesafe-client.js';
import { layoutKeepOrDefault } from './layout-keep-or-default.js';

const STAGE = STAGE_NAME.jevLayout;

/**
 * One Jev call asking whether the request wants a different arrangement
 * (`needsChange`), which offered layout fits it best (`layout`), and
 * whether none of them do (`needsBetter`). No change keeps the current
 * tree, or falls back to the balanced default, without shipping the
 * `layout` choice; needing better hands the layout off; otherwise the
 * chosen option ships.
 */
export function layoutPresetOrLlm(ask: Ask): LayoutStage {
  return async (plan, ctx) => {
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
    if (visible.length === 0) return layoutKeepOrDefault(plan, ctx);

    const choices = layoutChoices(request, visible, {
      describe: 'placements',
    });
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
          needsChange: noul(
            'The latest intent states an arrangement for the visible instances that differs from the current layout.',
          ),
          layout: choice(
            'Arrange exactly these already selected visible instances, matching the arrangement the request states, if any. All offered layouts fit the Chart and every minimum size. Do not reconsider which instances are visible.',
            Object.fromEntries(
              choices.map((option) => [option.id, option.description]),
            ),
          ),
          needsBetter: noul(
            'None of the offered layouts is the arrangement the latest intent states.',
          ),
        },
      },
      ctx,
    );
    if (isErr(reply)) return reply;

    const needsChange = readAnswer(reply.value, 'needsChange', STAGE, ctx);
    if (isErr(needsChange)) return needsChange;
    const layoutAnswer = readAnswer(reply.value, 'layout', STAGE, ctx);
    if (isErr(layoutAnswer)) return layoutAnswer;
    const needsBetter = readAnswer(reply.value, 'needsBetter', STAGE, ctx);
    if (isErr(needsBetter)) return needsBetter;

    const answers: readonly AnswerRecord[] = [
      { stage: STAGE, question: 'needsChange', ...needsChange.value },
      { stage: STAGE, question: 'layout', ...layoutAnswer.value },
      { stage: STAGE, question: 'needsBetter', ...needsBetter.value },
    ];

    if (needsChange.value.choice === 'no') {
      const fallback = await layoutKeepOrDefault(plan, ctx);
      if (isErr(fallback)) return fallback;
      return ok({ ...fallback.value, answers });
    }
    if (needsBetter.value.choice === 'yes')
      return ok({ plan, source: 'llm', answers });

    const chosen = choices.find(
      (option) => option.id === layoutAnswer.value.choice,
    );
    if (!chosen) return deferAt(ctx, STAGE, 'answer_missing', 'layout');
    return ok({
      plan,
      source: 'jev',
      layoutId: chosen.id,
      tree: chosen.tree,
      answers,
    });
  };
}
