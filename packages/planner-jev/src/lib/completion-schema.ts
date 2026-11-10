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

/** What the completion call returns when no reply to the user is requested. */
export type ReplylessCompletion = Omit<Completion, 'userMessage'>;

/** Options for {@link outputSchema}. */
export interface OutputSchemaOptions {
  /** Whether the schema asks for `userMessage`. Defaults to `true`. */
  readonly withMessage?: boolean;
}

/**
 * `{ userMessage }`, plus `params` with one nullable key per pending slot
 * typed from its parameter, plus any `extra` fields. Object parameters
 * travel as JSON strings. With `withMessage: false` the schema leaves out
 * `userMessage` and keeps the rest.
 */
export function outputSchema(
  slots: readonly Slot[],
  extra?: z.ZodRawShape,
  options?: OutputSchemaOptions & { readonly withMessage?: true },
): z.ZodType<Completion>;
export function outputSchema(
  slots: readonly Slot[],
  extra: z.ZodRawShape | undefined,
  options: OutputSchemaOptions & { readonly withMessage: false },
): z.ZodType<ReplylessCompletion>;
export function outputSchema(
  slots: readonly Slot[],
  extra?: z.ZodRawShape,
  options?: OutputSchemaOptions,
): z.ZodType<Completion | ReplylessCompletion>;
export function outputSchema(
  slots: readonly Slot[],
  extra: z.ZodRawShape = {},
  { withMessage = true }: OutputSchemaOptions = {},
): z.ZodType<Completion | ReplylessCompletion> {
  const params: z.ZodRawShape =
    slots.length > 0 ? { params: paramsSchema(slots) } : {};
  return withMessage
    ? z.object({ userMessage: USER_MESSAGE_SCHEMA, ...params, ...extra })
    : z.object({ ...params, ...extra });
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

const USER_MESSAGE_SCHEMA = z
  .string()
  .describe(
    'The reply to the user, displayed in the chat and spoken aloud. Short and friendly.',
  );

function paramsSchema(slots: readonly Slot[]) {
  return z.object(
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
  );
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
