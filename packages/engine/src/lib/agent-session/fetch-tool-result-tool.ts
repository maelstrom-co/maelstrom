import { z } from 'zod';

import { ToolError } from './server-tool.js';
import type { ToolRegistryEntry } from './tool-registry.js';

/** Name the loop model calls the built-in stored result reader by. */
export const FETCH_TOOL_RESULT_TOOL_NAME = 'fetch_tool_result';

/**
 * Most JSON-serialized characters a Server Tool result may have to enter the
 * prompt in full. A larger result enters as its result id and summary, and
 * the model reads it with {@link FETCH_TOOL_RESULT_TOOL_NAME}.
 */
export const INLINE_TOOL_RESULT_MAX_CHARS = 8_000;

/** A stored result the fetch tool found, or `undefined` when no result has the id. */
export type StoredToolResultLookup = (
  resultId: string,
) => { readonly value: unknown } | undefined;

/** Input of `fetch_tool_result`. */
export interface FetchToolResultInput {
  /** The result id a withheld tool result carried. */
  readonly resultId: string;
}

const inputSchema = z.object({
  resultId: z
    .string()
    .min(1)
    .describe('The resultId of the tool result to read.'),
});

const outputSchema = z.unknown();

const DESCRIPTION = [
  'Reads the full result of an earlier tool call by its resultId.',
  'A large tool result reaches you only as its resultId and a summary.',
  'Call this when the summary is not enough to answer.',
].join(' ');

/**
 * Builds the `fetch_tool_result` entry of one Agent Run. It returns the
 * stored value of a successful tool call of the session, found through
 * `lookup`, and fails with a {@link ToolError} when no stored result has the id.
 */
export function createFetchToolResultToolEntry(
  lookup: StoredToolResultLookup,
): ToolRegistryEntry {
  const summarize = () => 'read a stored tool result';
  return {
    tool: {
      name: FETCH_TOOL_RESULT_TOOL_NAME,
      description: DESCRIPTION,
      input: inputSchema,
      output: outputSchema,
      locus: 'server',
      sideEffect: 'read_only',
      approval: 'never',
      execute: (input) => {
        const { resultId } = input as FetchToolResultInput;
        const stored = lookup(resultId);
        if (stored === undefined) {
          return Promise.reject(
            new ToolError(`No stored result has the id ${resultId}`),
          );
        }
        return Promise.resolve(stored.value);
      },
      summarize,
    },
    locus: 'server',
    sideEffect: 'read_only',
    approval: 'never',
    summarize,
  };
}

/** Length of a value's JSON form, or `undefined` when it cannot be serialized. */
export function serializedLength(value: unknown): number | undefined {
  try {
    return (JSON.stringify(value) ?? 'null').length;
  } catch {
    return undefined;
  }
}
