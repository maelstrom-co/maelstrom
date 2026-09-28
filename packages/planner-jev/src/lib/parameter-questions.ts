import type {
  ActionParameterEnumSnapshot,
  StageContext,
} from '@maelstrom-co/engine';
import type { ActionParameter, ChartRequest } from '@maelstrom-co/protocol';

import { enumValues, parameterCandidates } from './parameters.js';
import { choice, type JsonValue, type Question } from './questions.js';
import type { PendingParameter } from './types.js';

/** One parameter question: its id, the candidate each `v<n>` option stands for, and how the LLM would fill it. */
export interface ParameterSlot {
  readonly id: string;
  readonly name: string;
  readonly candidates: readonly unknown[];
  readonly pending: PendingParameter;
}

export interface ParameterQuestions {
  readonly slots: readonly ParameterSlot[];
  readonly questions: Readonly<Record<string, Question>>;
}

/** Values Jev bound, values the LLM fills, and parameters the request gives no value for. */
export interface BoundParameters {
  readonly params: Readonly<Record<string, unknown>>;
  readonly pending: readonly PendingParameter[];
  readonly missing: readonly PendingParameter[];
}

/**
 * One question per parameter, with ids `<prefix>/<name>`: a candidate
 * value, `stated_elsewhere`, `not_stated`, and `omit` for an optional one.
 * `lead` names the action, for example `For action 1, setLocation on
 * weather-main`. An enumerated parameter's question also carries the
 * parameter's definition with its listed values, since the request state
 * may not include the action definition.
 */
export function parameterQuestions(
  parameters: readonly ActionParameter[],
  prefix: string,
  lead: string,
  intent: string,
  snapshot: ActionParameterEnumSnapshot | undefined,
): ParameterQuestions {
  const slots: ParameterSlot[] = [];
  const questions: Record<string, Question> = {};
  for (const parameter of parameters) {
    const id = `${prefix}/${parameter.name}`;
    const enumerated = enumValues(parameter, snapshot);
    const candidates = parameterCandidates(parameter, intent, enumerated);
    slots.push({
      id,
      name: parameter.name,
      candidates,
      pending: {
        name: parameter.name,
        type: parameter.type,
        description: parameter.description,
        ...(enumerated.length > 0 && { enum: enumerated }),
      },
    });
    const selectionRule =
      enumerated.length > 0
        ? 'Choose the listed value the request clearly refers to, even when the wording differs. Accept clear short names, aliases, abbreviations and contextual references when they identify a single listed option. Use the listed value. Do not guess when several options fit or none clearly matches.'
        : 'Pick an option only when it is itself the value, for example a city name, never a phrase that describes, names indirectly or points to the value.';
    const question = `${lead}, choose the value of ${parameter.name} (${parameter.type}): ${parameter.description}. ${selectionRule}`;
    questions[id] = choice(
      enumerated.length > 0
        ? {
            question,
            parameter: {
              name: parameter.name,
              type: parameter.type,
              description: parameter.description,
              enum: enumerated as readonly JsonValue[],
            },
          }
        : question,
      {
        ...Object.fromEntries(
          candidates.map((value, index) => [
            `v${index}`,
            JSON.stringify(value),
          ]),
        ),
        stated_elsewhere:
          enumerated.length > 0
            ? 'The request gives a value that no listed option clearly matches, or that several listed options could match.'
            : 'The request refers to the value indirectly (a landmark, event, "the capital of X", a relative description) or states it in a form none of the options match exactly.',
        not_stated: 'The request does not give a value.',
        ...(parameter.required === false && {
          omit: 'This optional parameter was not requested.',
        }),
      },
    );
  }
  return { slots, questions };
}

/** Applies the chosen option of every slot, in slot order. */
export function bindParameterChoices(
  slots: readonly ParameterSlot[],
  choices: Readonly<Record<string, string>>,
): BoundParameters {
  const params: Record<string, unknown> = {};
  const pending: PendingParameter[] = [];
  const missing: PendingParameter[] = [];
  for (const slot of slots) {
    const picked = choices[slot.id];
    switch (picked) {
      case 'omit':
        break;
      case 'stated_elsewhere':
        pending.push(slot.pending);
        break;
      case 'not_stated':
        missing.push(slot.pending);
        break;
      default:
        params[slot.name] = slot.candidates[Number(picked?.slice(1))];
    }
  }
  return { params, pending, missing };
}

/** The request's enum snapshot, when `request` is the one the snapshot was taken for. */
export function enumSnapshotOf(
  request: ChartRequest,
  ctx: StageContext,
): ActionParameterEnumSnapshot | undefined {
  return request.vessels === ctx.origin.request.vessels
    ? ctx.enumSnapshot
    : undefined;
}
