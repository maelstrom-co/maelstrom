import { z } from 'zod';

import type { PendingParameter, PlannedAction } from './types.js';

/** A `stated_elsewhere` parameter the LLM fills, keyed `p<i>` in the output schema. */
export interface Slot {
  readonly key: string;
  readonly action: PlannedAction;
  readonly parameter: PendingParameter;
}

/** What the completion call returns. */
export type Completion = {
  readonly userMessage: string;
  readonly params?: Readonly<Record<string, unknown>>;
};

/**
 * `{ userMessage }`, plus `params` with one nullable key per pending slot
 * typed from its parameter, plus any `extra` fields. Object parameters
 * travel as JSON strings.
 */
export function outputSchema(
  slots: readonly Slot[],
  extra: z.ZodRawShape = {},
): z.ZodType<Completion> {
  const userMessage = z
    .string()
    .describe(
      'The reply to the user, displayed in the chat and spoken aloud. Short and friendly.',
    );
  if (slots.length === 0) return z.object({ userMessage, ...extra });
  return z.object({
    userMessage,
    params: z.object(
      Object.fromEntries(
        slots.map((slot) => [
          slot.key,
          valueSchema(slot.parameter)
            .nullable()
            .describe(
              `${slot.parameter.name} for ${slot.action.action} on ${slot.action.instanceId}: ${slot.parameter.description}`,
            ),
        ]),
      ),
    ),
    ...extra,
  });
}

/** The value the LLM filled for `parameter`, or `undefined` when it gave none usable. */
export function parseFill(parameter: PendingParameter, raw: unknown): unknown {
  if (raw === null || raw === undefined) return undefined;
  if (parameter.type !== 'object') return raw;
  if (typeof raw !== 'string') return undefined;
  try {
    const value: unknown = JSON.parse(raw);
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? value
      : undefined;
  } catch {
    return undefined;
  }
}

function valueSchema(parameter: PendingParameter): z.ZodType {
  const values = parameter.enum ?? [];
  if (values.length > 0) {
    const literals = values.map((value) =>
      z.literal(value as string | number | boolean),
    );
    return literals.length === 1
      ? literals[0]
      : z.union(literals as unknown as [z.ZodType, z.ZodType, ...z.ZodType[]]);
  }
  switch (parameter.type) {
    case 'string':
      return z.string();
    case 'number':
      return z.number();
    case 'boolean':
      return z.boolean();
    case 'object':
      return z.string().describe('A JSON object, as a string');
  }
}
