import { expect, test } from 'bun:test';
import { join } from 'node:path';

test('the real OpenAI adapter omits zero cache reads before evaluation accounting', () => {
  const probe = `
    import assert from 'node:assert/strict';
    import { chat } from '@tanstack/ai';
    import { createOpenaiChat } from '@tanstack/ai-openai';
    import { withUsage } from ${JSON.stringify(join(import.meta.dir, '..', 'core', 'usage-adapter.ts'))};

    for (const cachedTokens of [0, 3]) {
      let requests = 0;
      const adapter = createOpenaiChat('gpt-5.2', 'synthetic-test-key', {
        baseURL: 'https://provider.invalid/v1',
        fetch: async () => {
          requests++;
          const response = {
            id: 'offline-response', model: 'gpt-5.2', status: 'completed',
            output: [{ type: 'message', id: 'offline-message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: '{}', annotations: [] }] }],
            usage: { input_tokens: 12, output_tokens: 2, total_tokens: 14, input_tokens_details: { cached_tokens: cachedTokens }, output_tokens_details: { reasoning_tokens: 0 } },
          };
          return new Response('event: response.completed\\ndata: ' + JSON.stringify({ type: 'response.completed', response }) + '\\n\\n', {
            headers: { 'Content-Type': 'text/event-stream' },
          });
        },
      });
      const calls = [];
      const wrapped = withUsage(adapter, 'planner', call => calls.push(call));
      const reply = await chat({
        adapter: wrapped, messages: [{ role: 'user', content: 'synthetic' }],
        threadId: 'synthetic-thread', stream: false, debug: false,
      });
      assert.equal(reply.text, '{}');
      assert.equal(requests, 1);
      assert.equal(calls.length, 1);
      assert.deepEqual(calls[0].usage, {
        inputTokens: 12, outputTokens: 2, totalTokens: 14,
        ...(cachedTokens > 0 ? { cachedInputTokens: cachedTokens } : {}),
      });
    }
  `;
  const run = Bun.spawnSync(
    [process.execPath, '--conditions=@maelstrom-co/source', '-e', probe],
    { cwd: join(import.meta.dir, '..', '..') },
  );
  expect(run.stderr.toString()).toBe('');
  expect(run.exitCode).toBe(0);
  expect(run.stdout.toString()).toBe('');
});
