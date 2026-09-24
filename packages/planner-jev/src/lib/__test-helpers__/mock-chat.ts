import { mock } from 'bun:test';

import type { AnyTextAdapter } from '@tanstack/ai';
import type { z } from 'zod';

/** The options `chat()` receives, as far as tests inspect them. */
export interface ChatCall {
  readonly messages: readonly {
    readonly role: string;
    readonly content: string;
  }[];
  readonly systemPrompts: readonly string[];
  readonly outputSchema: z.ZodObject<z.ZodRawShape>;
  readonly abortController: AbortController;
}

/**
 * Stands in for `@tanstack/ai`'s `chat` once {@link installMockChat} has run,
 * the way the engine's own tests mock it.
 */
export const mockChat = mock<(options: ChatCall) => Promise<unknown>>();

/**
 * Replaces `@tanstack/ai`'s `chat` with {@link mockChat} for the rest of the
 * process, bindings already imported included. Call it at the top of every
 * test file that relies on the mock; importing this module installs nothing,
 * so runtime code that shares a barrel with it keeps the real `chat`.
 */
export function installMockChat(): typeof mockChat {
  mock.module('@tanstack/ai', () => ({
    chat: (options: ChatCall) => mockChat(options),
  }));
  return mockChat;
}

/** The options of the `index`th mocked `chat()` call. */
export function chatCall(index = 0): ChatCall {
  const call = mockChat.mock.calls[index];
  if (!call) throw new Error(`chat() was not called ${index + 1} times`);
  return call[0];
}

/** The last user message of the `index`th mocked `chat()` call. */
export function chatPrompt(index = 0): string {
  return chatCall(index).messages.at(-1)?.content ?? '';
}

// AnyTextAdapter's phantom type field has no runtime shape.
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
