import { expect, test } from 'bun:test';
import { join } from 'node:path';

test('real TanStack paths retain cache accounting once in events and evaluation records', () => {
  const packages = join(import.meta.dir, '..', '..', '..');
  const jev = join(packages, 'planner-jev', 'src', 'lib');
  const probe = `
    import assert from 'node:assert/strict';
    import { llmPlanner } from '@maelstrom-co/planner-llm';
    import { buildGridResponse, makePlanningInput, makeStageContext } from '@maelstrom-co/engine/_testing';
    import { z } from 'zod';
    import { llmComplete } from ${JSON.stringify(join(jev, 'stages', 'llm-complete.ts'))};
    import { callLlm } from ${JSON.stringify(join(jev, 'stages', 'complete-layout-inline.ts'))};
    import { makeContext, makeRequest } from ${JSON.stringify(join(jev, '__test-helpers__', 'fixtures.ts'))};
    import { completionPlan } from ${JSON.stringify(join(jev, '__test-helpers__', 'layout-fixtures.ts'))};
    import { withUsage } from ${JSON.stringify(join(packages, 'evals', 'src', 'core', 'usage-adapter.ts'))};

    let checked = 0;
    for (const mode of ['combined', 'stream-finalization', 'direct-finalization']) {
      for (const entry of ['planner', 'complete', 'inline']) {
        for (const shape of ['spec', 'legacy', 'zero', 'missing', 'error']) {
          if (mode === 'direct-finalization' && shape === 'error') continue;
          const missing = shape === 'missing';
          const failed = shape === 'error';
          const cached = shape === 'zero' ? 0 : 8;
          const written = shape === 'zero' ? 0 : 4;
          const cost = shape === 'zero' ? 0 : 0.03;
          const legacy = { promptTokens: 16, completionTokens: 5, totalTokens: 21, promptTokensDetails: { cachedTokens: cached, cacheWriteTokens: written }, cost };
          const spec = [
            { inputTokens: 12, outputTokens: 3, totalTokens: 15, cachedInputTokens: cached, cacheWriteInputTokens: written },
            { inputTokens: 4, outputTokens: 2, totalTokens: 6 },
          ];
          const data = entry === 'planner' ? buildGridResponse() : { userMessage: 'Private output.' };
          const terminal = {
            type: failed ? 'RUN_ERROR' : 'RUN_FINISHED', runId: 'r', threadId: 't', timestamp: 5,
            ...(failed ? { message: 'Private provider error.' } : { finishReason: 'stop' }),
            usage: missing ? [] : shape === 'legacy' ? legacy : spec,
            metadata: { tanstack: { usage: missing ? undefined : { cost, promptTokensDetails: { cacheWriteTokens: written }, providerUsageDetails: { secret: 'private-key' } } } },
          };
          async function* stream() {
            yield { type: 'RUN_STARTED', runId: 'r', threadId: 't', timestamp: 1 };
            if (!failed) {
              yield { type: 'TEXT_MESSAGE_START', messageId: 'm', role: 'assistant', timestamp: 2 };
              yield { type: 'TEXT_MESSAGE_CONTENT', messageId: 'm', delta: JSON.stringify(data), timestamp: 3 };
              yield { type: 'TEXT_MESSAGE_END', messageId: 'm', timestamp: 4 };
              if (mode === 'stream-finalization')
                yield { type: 'CUSTOM', name: 'structured-output.complete', value: { object: data, raw: JSON.stringify(data) }, timestamp: 4 };
            }
            yield terminal;
            yield terminal;
          }
          const calls = [];
          const events = [];
          const instrument = { stage: (_name, stage) => stage, event: (name, attributes) => events.push({ name, attributes }) };
          const adapter = withUsage({
            kind: 'text', name: 'offline', model: 'offline',
            supportsCombinedToolsAndSchema: () => mode === 'combined',
            chatStream: stream,
            ...(mode === 'stream-finalization' ? { structuredOutputStream: stream } : {}),
            async structuredOutput() { return { data, rawText: JSON.stringify(data), ...(missing ? {} : { usage: legacy }) }; },
          }, entry === 'planner' ? 'planner' : 'complete', call => calls.push(call));
          const plan = completionPlan(makeRequest('hide the tasks'));
          const ctx = makeContext(plan.plan.selection.input, { instrument });
          const result = entry === 'planner'
            ? await llmPlanner({ adapter })(makePlanningInput(), makeStageContext({ instrument }))
            : entry === 'complete' ? await llmComplete({ adapter })(plan, ctx)
            : await callLlm({ adapter }, 'Private prompt.', z.object({ userMessage: z.string() }), [], ctx);
          const label = [mode, entry, shape].join('/');
          assert.equal(result.ok, !failed, label);
          assert.equal(events.length, 1, label);
          assert.equal(calls.length, 1, label);
          assert.deepEqual(calls[0].usage, missing ? undefined : {
            inputTokens: 16, outputTokens: 5, totalTokens: 21,
            cachedInputTokens: cached, cacheWriteInputTokens: written, cost,
          }, label);
          const { ['maelstrom.latency_ms']: latency, ...attributes } = events[0].attributes;
          assert.ok(Number.isFinite(latency) && latency >= 0, label);
          assert.deepEqual(attributes, {
            'gen_ai.request.model': 'offline',
            'maelstrom.message_id': 'req-1', 'maelstrom.session_id': 'session-1',
            'maelstrom.outcome': failed ? 'error' : 'ok',
            ...(missing ? {} : {
              'gen_ai.usage.input_tokens': 16, 'gen_ai.usage.output_tokens': 5,
              'gen_ai.usage.cache_read.input_tokens': cached,
              'gen_ai.usage.cache_creation.input_tokens': written,
              'gen_ai.usage.cost': cost,
            }),
          }, label);
          assert.ok(!JSON.stringify({ events, calls }).includes('private-key'), label);
          checked++;
        }
      }
    }
    process.stdout.write(String(checked));
  `;
  const run = Bun.spawnSync(
    [process.execPath, '--conditions=@maelstrom-co/source', '-e', probe],
    { cwd: join(packages, 'evals') },
  );
  expect(run.stderr.toString()).toBe('');
  expect(run.exitCode).toBe(0);
  expect(run.stdout.toString().trim()).toBe('42');
});
