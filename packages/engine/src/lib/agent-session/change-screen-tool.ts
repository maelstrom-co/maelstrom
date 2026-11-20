import { type JsonValue, JsonValueSchema } from '@maelstrom-co/protocol';
import { z } from 'zod';

import type { ScreenChangeResult } from './screen-change-result.js';
import type { ToolRegistryEntry } from './tool-registry.js';

/** Name the loop model calls the built-in Screen Change tool by. */
export const CHANGE_SCREEN_TOOL_NAME = 'change_screen';

/** Most characters a `change_screen` goal may take. */
export const CHANGE_SCREEN_GOAL_MAX_CHARS = 500;

/** Most characters one call's referents may take once serialized as JSON. */
export const CHANGE_SCREEN_REFERENTS_MAX_CHARS = 2_000;

/**
 * What a `change_screen` call carries inside the Engine. The model-facing
 * schema hides `mode`, and `ambient` is treated as `await` until Ambient
 * Screen Changes exist.
 */
export interface ChangeScreenInput {
  /** What the screen should show, in plain words. */
  readonly goal: string;
  /** Exact values the goal refers to, such as ids and quantities. */
  readonly referents?: Readonly<Record<string, JsonValue>>;
  /** Whether the call waits for the screen. Only `await` behaviour exists. */
  readonly mode?: 'await' | 'ambient';
}

const modelFacingInputSchema = z.object({
  goal: z
    .string()
    .max(CHANGE_SCREEN_GOAL_MAX_CHARS)
    .refine((goal) => goal.trim().length > 0, {
      message: 'goal must not be blank',
    })
    .describe('What the screen should show, in plain words.'),
  referents: z
    .record(z.string(), JsonValueSchema)
    .refine(
      (referents) =>
        JSON.stringify(referents).length <= CHANGE_SCREEN_REFERENTS_MAX_CHARS,
      { message: 'referents are too long' },
    )
    .optional()
    .describe(
      'Exact values the goal refers to, such as an order id or a quantity.',
    ),
});

/**
 * Model-facing input schema of `change_screen`. Refuses a blank goal, a goal
 * over {@link CHANGE_SCREEN_GOAL_MAX_CHARS} characters and referents over
 * {@link CHANGE_SCREEN_REFERENTS_MAX_CHARS} serialized characters. Unknown
 * keys, `mode` among them, are dropped.
 */
export const changeScreenInputSchema: z.ZodType<
  Omit<ChangeScreenInput, 'mode'>
> = modelFacingInputSchema;

const screenChangeResultSchema = z.object({
  status: z.enum([
    'applied',
    'failed',
    'unknown',
    'needs_clarification',
    'cancelled',
    'queued',
  ]),
  summary: z.string(),
  changeId: z.string().optional(),
  question: z.string().optional(),
  options: z.array(z.string()).optional(),
  onScreen: z.array(z.string()).optional(),
});

const DESCRIPTION = [
  'Changes what the user sees on screen.',
  'The goal itself must contain the exact values the user gave or your tools returned, such as ids and quantities, and the same values also go in referents.',
  "Word the goal in the user's words and never name a Vessel, an Action or any other internal screen part in it. Vessel ids are only for describe_capabilities.",
  'Calls in one turn are planned together after your other tools finish.',
  'Always wait for the result before saying anything is on screen: only an applied status means it is.',
  'When the result needs clarification, ask the user its question in plain text.',
].join(' ');

/**
 * The registry entry the run uses to treat `change_screen` as a known tool:
 * its schemas, `idempotent` side effect and summary. The run executes the
 * call itself, so `execute` is never reached.
 */
export const changeScreenToolEntry: ToolRegistryEntry = {
  tool: {
    name: CHANGE_SCREEN_TOOL_NAME,
    description: DESCRIPTION,
    input: changeScreenInputSchema,
    output: screenChangeResultSchema,
    locus: 'server',
    sideEffect: 'idempotent',
    approval: 'never',
    execute: () =>
      Promise.reject(new Error('change_screen runs inside the Agent Run')),
    summarize: (result: ScreenChangeResult) => result.summary,
  },
  locus: 'server',
  sideEffect: 'idempotent',
  approval: 'never',
  summarize: (output) => (output as ScreenChangeResult).summary,
};
