import {
  type ChartRequest,
  getVisibleInstanceIds,
} from '@maelstrom-co/protocol';

import type {
  JevSelection,
  SelectedInstance,
  SelectionDecision,
} from '../types.js';
import { makeInput } from './fixtures.js';
import type { Payload, Script } from './scripted-fetch.js';

/** How a scripted conversation answers one parameter question. */
export type ParamAnswer =
  | 'stated_elsewhere'
  | 'not_stated'
  | 'omit'
  | { readonly value: unknown };

/** One action decision: `<instanceId>/<action>` (or `done`/`unsupported`) plus its parameters. */
export interface ScriptedAction {
  readonly pick: string;
  readonly params?: Readonly<Record<string, ParamAnswer>>;
}

export interface Conversation {
  /** Choices for the jevSelect call; map and journal stay hidden unless listed. */
  readonly select?: Readonly<Record<string, string>>;
  /** Action decisions in order; `done` follows the last one. */
  readonly actions?: readonly ScriptedAction[];
  /** The layout option id, or a function picking it from the payload. */
  readonly layout?: string | ((payload: Payload) => string);
  readonly confidence?: number;
  /** Noul probabilities for the selection call's gate questions, by question id. */
  readonly gates?: Readonly<Record<string, number>>;
}

/**
 * A script that answers every Jev call of the pipeline: the selection call
 * (recognised by its `scope` question), each `action/<n>` call, each
 * parameter call and the `layout` call.
 */
export function conversation(script: Conversation): Script {
  return (payload) => {
    const ids = Object.keys(payload.questions);
    const confidence = script.confidence;
    const answer = (choices: Record<string, string>) =>
      confidence === undefined ? { choices } : { choices, confidence };
    if (ids.includes('scope')) {
      const step = answer({
        'view/map-main': 'hide',
        'view/journal-main': 'hide',
        ...script.select,
      });
      return script.gates ? { ...step, nouls: script.gates } : step;
    }
    if (ids.includes('layout')) {
      const layout =
        typeof script.layout === 'function'
          ? script.layout(payload)
          : script.layout;
      return answer(layout === undefined ? {} : { layout });
    }
    const [first] = ids;
    if (ids.length === 1 && first?.startsWith('action/')) {
      const step = Number(first.slice('action/'.length).split('@')[0]);
      const pick = script.actions?.[step]?.pick ?? 'done';
      return answer({ [first]: actionKey(payload, first, pick) });
    }
    const choices: Record<string, string> = {};
    for (const id of ids) choices[id] = batchedChoice(script, payload, id);
    return answer(choices);
  };
}

/**
 * Answers one question of a batched call: every `action/<n>@<state>`
 * question picks action `n` where offered (`done` elsewhere), every
 * `<instanceId>/<slot>` question picks that instance's `slot`-th action,
 * and parameter questions of actions off the scripted path answer
 * `not_stated`.
 */
function batchedChoice(
  script: Conversation,
  payload: Payload,
  id: string,
): string {
  const picks = script.actions ?? [];
  if (id.startsWith('action/')) {
    const step = Number(id.slice('action/'.length).split('@')[0]);
    const pick = picks[step]?.pick ?? 'done';
    try {
      return actionKey(payload, id, pick);
    } catch {
      return 'done';
    }
  }
  const parts = id.split('/');
  if (parts[0] === 'param' && parts.length === 3) {
    const value = picks[Number(parts[1])]?.params?.[parts[2] as string];
    if (value === undefined) throw new Error(`no scripted answer for ${id}`);
    return typeof value === 'string'
      ? value
      : valueKey(payload, id, value.value);
  }
  if (parts[0] === 'param') {
    const [, instanceId, slot, target, name] = parts as string[];
    const action = target?.split(':').pop()?.split('@')[0];
    const pick = slotPicks(picks, instanceId as string)[Number(slot) - 1];
    const value =
      pick?.pick === `${instanceId}/${action}`
        ? pick.params?.[name as string]
        : 'not_stated';
    if (value === undefined) throw new Error(`no scripted answer for ${id}`);
    return typeof value === 'string'
      ? value
      : valueKey(payload, id, value.value);
  }
  const [instanceId, slot] = parts as [string, string];
  const pick = slotPicks(picks, instanceId)[Number(slot) - 1];
  if (pick === undefined || slot === '3') return 'none';
  const action = pick.pick.split('/')[1] as string;
  if (slot === '1') return action;
  const criteria = payload.questions[`${instanceId}/1`]?.criteria ?? {};
  const first = slotPicks(picks, instanceId)[0]?.pick.split('/')[1] ?? '';
  const view =
    /Switches it to its (\S+) view\./.exec(criteria[first] ?? '')?.[1] ??
    /currently in its (\S+) view/.exec(
      payload.questions[`${instanceId}/1`]?.instructions ?? '',
    )?.[1];
  return `${view}:${action}`;
}

function slotPicks(
  picks: readonly ScriptedAction[],
  instanceId: string,
): readonly ScriptedAction[] {
  return picks.filter((pick) => pick.pick.startsWith(`${instanceId}/`));
}

/** The option key of `instanceId/action` in an action question. */
export function actionKey(payload: Payload, id: string, pick: string): string {
  if (pick === 'done' || pick === 'unsupported') return pick;
  const [instanceId, action] = pick.split('/');
  const criteria = payload.questions[id]?.criteria ?? {};
  const found = Object.entries(criteria).find(
    ([, description]) =>
      description.startsWith(`${instanceId}, currently `) &&
      description.includes(`: ${action}. `),
  );
  if (!found) throw new Error(`${pick} is not offered in ${id}`);
  return found[0];
}

/**
 * A selection that keeps the request's instances as they are (visible ones
 * visible, hidden ones hidden), plus `created`.
 */
export function keepAll(
  request: ChartRequest,
  created: readonly SelectedInstance[] = [],
  decisions: Readonly<Record<string, SelectionDecision>> = {},
): JevSelection {
  const visible = getVisibleInstanceIds(request.layout);
  return {
    input: makeInput(request),
    answers: [],
    instances: [
      ...request.instances.map((instance) => {
        const decision =
          decisions[instance.instanceId] ??
          (visible.has(instance.instanceId) ? 'keep' : 'hide');
        return {
          ...instance,
          visible: decision === 'keep',
          fresh: false,
          decision,
        };
      }),
      ...created,
    ],
  };
}

function valueKey(payload: Payload, id: string, value: unknown): string {
  const literal = JSON.stringify(value);
  const found = Object.entries(payload.questions[id]?.criteria ?? {}).find(
    ([key, description]) => key.startsWith('v') && description === literal,
  );
  if (!found) throw new Error(`${literal} is not a candidate of ${id}`);
  return found[0];
}
