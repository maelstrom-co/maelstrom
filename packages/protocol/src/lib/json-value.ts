import { z } from 'zod';

import type { Mutable } from './_drift-guards.ts';

/**
 * A value that survives `JSON.stringify` and `JSON.parse` unchanged: a
 * string, a finite number, a boolean, `null`, or an array or plain object of
 * such values. `undefined`, functions, symbols, bigints and non-finite
 * numbers are not JSON values.
 */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

/**
 * Wire-format Zod parser for {@link JsonValue}. Rejects anything JSON cannot
 * carry, at any depth: an object property holding `undefined` or a function
 * fails the parse instead of being dropped on serialization.
 *
 * The parsed value is a fresh, mutable copy, the same way every other
 * protocol schema infers mutable output; it is assignable to
 * {@link JsonValue}.
 */
export const JsonValueSchema: z.ZodType<Mutable<JsonValue>> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(JsonValueSchema),
    z.record(z.string(), JsonValueSchema),
  ]),
);
