import type { PlanningInput, Stage } from '@maelstrom-co/engine';
import {
  getVisibleInstanceIds,
  InstanceId,
  isErr,
  ok,
  VariantName,
  type Vessel,
} from '@maelstrom-co/protocol';

import { deferAt } from '../defer.js';
import {
  type ConfidencePolicy,
  choice,
  isResizeOnly,
  type Question,
  readAnswer,
  recentHistory,
} from '../questions.js';
import type { AnswerRecord, JevSelection, SelectedInstance } from '../types.js';
import type { Ask } from '../typesafe-client.js';

const STAGE = 'jevSelect';
const NEW_SLOTS_PER_VESSEL = 2;

/**
 * Decides which instances stay visible, hide, are deleted or are created.
 * Existing instances keep their variant: a variant changes only through a
 * transition action, which the next stage plans.
 */
export function jevSelect(
  ask: Ask,
  policy: ConfidencePolicy = {},
): Stage<PlanningInput, JevSelection> {
  return async (input, ctx) => {
    const { request } = input;
    if (
      request.context.layoutMode !== 'tiling' ||
      request.layout.type !== 'tiling'
    )
      return deferAt(ctx, STAGE, 'grid_mode');

    const visibleIds = getVisibleInstanceIds(request.layout);
    const takenIds = new Set<string>([
      ...request.instances.map((instance) => instance.instanceId),
      ...request.layout.instances.map((instance) => instance.instanceId),
    ]);
    const newIds = new Map<string, InstanceId[]>();
    for (const vessel of request.vessels) {
      const ids: InstanceId[] = [];
      for (let serial = 1; ids.length < NEW_SLOTS_PER_VESSEL; serial++) {
        const id = `${vessel.id}-jev-${serial}`;
        if (takenIds.has(id)) continue;
        takenIds.add(id);
        ids.push(InstanceId(id));
      }
      newIds.set(vessel.id, ids);
    }

    const resizeOnly = isResizeOnly(request);
    const questions: Record<string, Question> = {
      scope: choice(
        'Can the complete latest intent be satisfied using these vessels, their views and their registered actions? Showing, hiding, arranging or configuring widgets is supported. A chart resize with no other request is supported. Do not partially satisfy an unsupported compound request.',
        {
          supported: 'The complete request is clear and supported.',
          unsupported:
            'A requested capability, generated content, or required target is unavailable.',
          ambiguous: 'The intended target or operation is genuinely unclear.',
        },
      ),
    };
    for (const instance of request.instances) {
      const visible = visibleIds.has(instance.instanceId);
      questions[`view/${instance.instanceId}`] = choice(
        `Decide what happens to ${instance.instanceId}, currently ${visible ? 'visible' : 'hidden'} in its ${instance.variant} view. Leave unrelated instances as they are: keep a visible one, leave a hidden one hidden.${resizeOnly ? ' The chart was only resized: keep it.' : ''} View changes and content edits are planned later through actions, so keep an instance whose view or content should change.`,
        {
          keep: visible
            ? 'Keep it visible (its view or content may still change through actions).'
            : 'Show it: the instance and its state become visible again.',
          hide: visible
            ? 'Retain the instance and its state but hide it.'
            : 'Leave it hidden, retaining its state.',
          delete: 'Explicitly delete this instance and its state.',
        },
      );
    }
    const newOptions = new Map<
      string,
      Record<string, readonly VariantName[]>
    >();
    for (const vessel of request.vessels) {
      const existing = request.instances.filter(
        (instance) => instance.vesselId === vessel.id,
      ).length;
      const { criteria, variants } = newInstanceOptions(vessel);
      newOptions.set(vessel.id, variants);
      questions[`new/${vessel.id}`] = choice(
        `Select the NEW ${vessel.name} instances the latest intent needs. There are ${existing} existing instances of this type; showing or reusing one of them is not a new instance. Choose none for a type that was not requested.${resizeOnly ? ' The chart was only resized: choose none.' : ''} Layout rows or columns are not copies.`,
        criteria,
      );
    }

    const reply = await ask(
      STAGE,
      {
        state: {
          intent: request.context.updateReasons,
          history: recentHistory(input.history),
          chartDimensions: request.context.chartDimensions,
          currentLayout: request.layout.tree,
          instances: request.instances.map((instance) => ({
            ...instance,
            visible: visibleIds.has(instance.instanceId),
          })),
          vessels: request.vessels,
        },
        questions,
      },
      ctx,
    );
    if (isErr(reply)) return reply;

    const answers: AnswerRecord[] = [];
    const read = (id: string) => {
      const answer = readAnswer(reply.value, id, STAGE, ctx, policy);
      if (!isErr(answer))
        answers.push({ stage: STAGE, question: id, ...answer.value });
      return answer;
    };

    const scope = read('scope');
    if (isErr(scope)) return scope;
    if (scope.value.choice === 'unsupported')
      return deferAt(ctx, STAGE, 'scope_unsupported', 'scope');
    if (scope.value.choice === 'ambiguous')
      return deferAt(ctx, STAGE, 'scope_ambiguous', 'scope');

    const instances: SelectedInstance[] = [];
    for (const instance of request.instances) {
      const answer = read(`view/${instance.instanceId}`);
      if (isErr(answer)) return answer;
      const decision = answer.value.choice as 'keep' | 'hide' | 'delete';
      instances.push({
        instanceId: instance.instanceId,
        vesselId: instance.vesselId,
        variant: instance.variant,
        visible: decision === 'keep',
        fresh: false,
        decision,
      });
    }
    for (const vessel of request.vessels) {
      const answer = read(`new/${vessel.id}`);
      if (isErr(answer)) return answer;
      const variants = newOptions.get(vessel.id)?.[answer.value.choice] ?? [];
      const ids = newIds.get(vessel.id) ?? [];
      variants.forEach((variant, index) => {
        instances.push({
          instanceId: ids[index],
          vesselId: vessel.id,
          variant,
          visible: true,
          fresh: true,
          decision: 'create',
        });
      });
    }
    return ok({ input, instances, answers });
  };
}

function newInstanceOptions(vessel: Vessel): {
  readonly criteria: Record<string, string>;
  readonly variants: Record<string, readonly VariantName[]>;
} {
  const names = Object.keys(vessel.variants).map(VariantName);
  const criteria: Record<string, string> = {
    none: `No new ${vessel.name}. This type was not requested, or an existing instance satisfies the request.`,
  };
  const variants: Record<string, readonly VariantName[]> = { none: [] };
  for (const first of names) {
    const one = `one/${first}`;
    variants[one] = [first];
    criteria[one] =
      `Create ONE ${vessel.name} starting in its ${first} view${first === vessel.defaultVariant ? ' (the default view for ordinary display requests)' : ''}.`;
    for (const second of names) {
      const pair = `pair/${first}/${second}`;
      variants[pair] = [first, second];
      criteria[pair] =
        `Create TWO ${vessel.name} instances, starting in ${first} and ${second}. Only for an explicit request for two new copies of this type.`;
    }
  }
  return { criteria, variants };
}
