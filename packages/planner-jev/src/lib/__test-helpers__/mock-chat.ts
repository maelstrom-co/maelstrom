import { mock } from 'bun:test';

import {
  type ChatCall,
  type ChatFunction,
  installMockChat as installChatMock,
} from './chat-mock.js';

export { type ChatCall, dummyAdapter } from './chat-mock.js';

/**
 * Stands in for `@tanstack/ai`'s `chat` once {@link installMockChat} has run,
 * the way the engine's own tests mock it.
 */
export const mockChat = mock<ChatFunction>();

/**
 * Replaces `@tanstack/ai`'s `chat` with {@link mockChat} for the rest of the
 * process, bindings already imported included. Call it at the top of every
 * test file that relies on the mock; importing this module installs nothing.
 */
export function installMockChat(): typeof mockChat {
  return installChatMock(mock, mockChat);
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
