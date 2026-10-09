import { chat, type RunFinishedEvent } from '@tanstack/ai';
import { createGeminiChat } from '@tanstack/ai-gemini';
import { afterEach, expect, test, vi } from 'vitest';

afterEach(() => vi.unstubAllGlobals());

test.each([
  { name: 'omitted output counter', usageMetadata: { promptTokenCount: 7 } },
  {
    name: 'explicit zero output counter',
    usageMetadata: { promptTokenCount: 7, candidatesTokenCount: 0 },
  },
])('documents the Gemini adapter limit for $name without provider requests', async ({
  usageMetadata,
}) => {
  const fetch = vi.fn(
    async () =>
      new Response(
        `data: ${JSON.stringify({
          candidates: [
            {
              index: 0,
              content: { role: 'model', parts: [{ text: '{}' }] },
              finishReason: 'STOP',
            },
          ],
          usageMetadata,
        })}\n\n`,
        { headers: { 'Content-Type': 'text/event-stream' } },
      ),
  );
  vi.stubGlobal('fetch', fetch);
  let usage: RunFinishedEvent['usage'];
  for await (const chunk of chat({
    adapter: createGeminiChat(
      'gemini-3.1-flash-lite-preview',
      'synthetic-test-key',
    ),
    messages: [{ role: 'user', content: 'synthetic' }],
    debug: false,
  })) {
    if (chunk.type === 'RUN_FINISHED') usage = chunk.usage;
  }
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(usage).toEqual({
    promptTokens: 7,
    completionTokens: 0,
    totalTokens: 7,
  });
});
