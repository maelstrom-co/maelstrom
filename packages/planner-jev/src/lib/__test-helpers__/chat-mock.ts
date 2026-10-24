import type { AnyTextAdapter, ChatMiddleware, JSONSchema } from '@tanstack/ai';
import { convertSchemaToJsonSchema } from '@tanstack/ai';

const convertOutputSchema = convertSchemaToJsonSchema;

/** The options `chat()` receives, as far as tests inspect them. */
export interface ChatCall {
  /** Stable conversation id shared by calls within one Maelstrom session. */
  readonly threadId: string;
  readonly messages: readonly {
    readonly role: string;
    readonly content: string;
  }[];
  readonly systemPrompts: readonly string[];
  readonly outputSchema: JSONSchema;
  readonly abortController: AbortController;
  /** Disables provider console logs that bypass the engine logger. */
  readonly debug: boolean;
  /** Observes provider usage without changing the request or output. */
  readonly middleware: readonly ChatMiddleware[];
}

/** A stand-in for `@tanstack/ai`'s `chat`, as far as tests call it. */
export type ChatFunction = (options: ChatCall) => Promise<unknown>;

/**
 * The test runner's function mock factory, such as `mock` from `bun:test`:
 * called with no argument it returns a fresh mock function, and `module`
 * replaces a module's exports for the rest of the process.
 */
export interface ChatMocker<Mock extends ChatFunction> {
  (implementation?: ChatFunction): Mock;
  module(specifier: string, factory: () => Record<string, unknown>): unknown;
}

/**
 * Replaces `@tanstack/ai`'s `chat` with a mock function for the rest of the
 * process, bindings already imported included, and returns that mock. Pass
 * the test runner's `mock`, for example `installMockChat(mock)` with `mock`
 * from `bun:test`, at the top of every test file that relies on it; nothing
 * is mocked until it runs. `chat` reuses a mock the caller already holds.
 */
export function installMockChat<Mock extends ChatFunction>(
  mock: ChatMocker<Mock>,
  chat: Mock = mock(),
): Mock {
  mock.module('@tanstack/ai', () => ({
    chat: (options: ChatCall) => chat(options),
    convertSchemaToJsonSchema: convertOutputSchema,
  }));
  return chat;
}

/**
 * A text adapter whose calls throw, for code paths where `chat()` is mocked.
 * The cast covers `AnyTextAdapter`'s phantom type field, which has no runtime
 * shape.
 */
export const dummyAdapter = {
  kind: 'text',
  name: 'dummy',
  model: 'dummy-model',
  chatStream: () => {
    throw new Error('dummyAdapter.chatStream is not callable in tests');
  },
  structuredOutput: () => {
    throw new Error('dummyAdapter.structuredOutput is not callable in tests');
  },
} as unknown as AnyTextAdapter;
