import { expect, test } from 'bun:test';
import { join } from 'node:path';

test('real TanStack usage reaches every planner path without doubling evaluation totals', () => {
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
    import { tokenTotals } from ${JSON.stringify(join(packages, 'evals', 'src', 'core', 'report.ts'))};

    const specUsage = [
      { inputTokens: 12, outputTokens: 3, totalTokens: 15 },
      { inputTokens: 4, outputTokens: 2, totalTokens: 6 },
    ];
    const totals = { promptTokens: 16, completionTokens: 5, totalTokens: 21 };
    function adapter(mode, data, reported, wireUsage = specUsage, directUsage = totals, terminalError = false, repeated = false) {
      async function* stream() {
        yield { type: 'RUN_STARTED', runId: 'r', threadId: 't', timestamp: 1 };
        if (terminalError) {
          yield { type: 'RUN_ERROR', runId: 'r', threadId: 't', timestamp: 2, message: 'Private provider failure.', usage: reported ? wireUsage : [] };
          return;
        }
        yield { type: 'TEXT_MESSAGE_START', messageId: 'm', role: 'assistant', timestamp: 2 };
        yield { type: 'TEXT_MESSAGE_CONTENT', messageId: 'm', delta: JSON.stringify(data), timestamp: 3 };
        yield { type: 'TEXT_MESSAGE_END', messageId: 'm', timestamp: 4 };
        if (mode === 'stream-finalization') {
          yield { type: 'CUSTOM', name: 'structured-output.complete', value: { object: data, raw: JSON.stringify(data) }, timestamp: 5 };
        }
        yield { type: 'RUN_FINISHED', runId: 'r', threadId: 't', finishReason: 'stop', timestamp: 6, usage: reported ? wireUsage : [] };
        if (repeated) yield { type: 'RUN_FINISHED', runId: 'r', threadId: 't', finishReason: 'stop', timestamp: 7, usage: wireUsage };
      }
      return {
        kind: 'text', name: 'offline', model: 'offline',
        supportsCombinedToolsAndSchema: () => mode === 'combined',
        chatStream: stream,
        ...(mode === 'stream-finalization' ? { structuredOutputStream: stream } : {}),
        async structuredOutput() {
          return { data, rawText: JSON.stringify(data), ...(reported ? { usage: directUsage } : {}) };
        },
      };
    }

    let checked = 0;
    for (const mode of ['combined', 'stream-finalization', 'direct-finalization']) {
      for (const entry of ['planner', 'complete', 'inline']) {
        for (const scenario of ['reported', 'missing', 'invalid', 'labels', 'partial', 'output-only', 'total-only', 'zero', 'split', 'error-reported', 'error-missing', 'error-partial', 'error-zero', 'error-legacy', 'repeated']) {
          if (mode === 'direct-finalization' && !['reported', 'missing', 'invalid', 'zero'].includes(scenario)) continue;
          const failed = scenario === 'invalid' || scenario.startsWith('error-');
          const reported = !['missing', 'error-missing'].includes(scenario);
          const fixture = {
            labels: { wire: [{ provider: 'offline' }], expected: undefined },
            partial: { wire: [{ inputTokens: 7 }], expected: { inputTokens: 7 } },
            'output-only': { wire: [{ outputTokens: 0 }], expected: { outputTokens: 0 } },
            'total-only': { wire: [{ totalTokens: 3 }], expected: { totalTokens: 3 } },
            zero: { wire: [{ inputTokens: 0, outputTokens: 0, totalTokens: 0 }], expected: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } },
            split: { wire: [{ inputTokens: 7 }, { outputTokens: 3, totalTokens: 10 }], expected: { inputTokens: 7, outputTokens: 3, totalTokens: 10 } },
            'error-partial': { wire: [{ inputTokens: 7 }], expected: { inputTokens: 7 } },
            'error-zero': { wire: [{ inputTokens: 0, outputTokens: 0, totalTokens: 0 }], expected: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } },
            'error-legacy': { wire: totals, expected: { inputTokens: 16, outputTokens: 5, totalTokens: 21 } },
          }[scenario];
          const expectedUsage = fixture ? fixture.expected : reported ? { inputTokens: 16, outputTokens: 5, totalTokens: 21 } : undefined;
          const data = scenario === 'invalid'
            ? { userMessage: 42 }
            : entry === 'planner' ? buildGridResponse() : { userMessage: 'Private output.' };
          const events = [];
          const calls = [];
          const instrument = {
            stage: (_name, stage) => stage,
            event: (name, attributes) => events.push({ name, attributes }),
          };
          const wrapped = withUsage(adapter(mode, data, reported, fixture?.wire, scenario === 'zero' ? { promptTokens: 0, completionTokens: 0, totalTokens: 0 } : totals, scenario.startsWith('error-'), scenario === 'repeated'), entry === 'planner' ? 'planner' : 'complete', call => calls.push(call));
          const plan = completionPlan(makeRequest('hide the tasks'));
          const ctx = makeContext(plan.plan.selection.input, { instrument });
          const result = entry === 'planner'
            ? await llmPlanner({ adapter: wrapped })(makePlanningInput(), makeStageContext({ instrument }))
            : entry === 'complete'
              ? await llmComplete({ adapter: wrapped })(plan, ctx)
              : await callLlm({ adapter: wrapped }, 'Private prompt.', z.object({ userMessage: z.string() }), [], ctx);
          const label = [mode, entry, scenario].join('/');
          assert.equal(result.ok, !failed, label);
          assert.equal(events.length, 1, label);
          assert.equal(calls.length, 1, label);
          const event = events[0];
          assert.equal(event.name, 'llm.call', label);
          const { ['maelstrom.latency_ms']: latency, ...attributes } = event.attributes;
          assert.ok(Number.isFinite(latency) && latency >= 0, label);
          assert.deepEqual(attributes, {
            'gen_ai.request.model': 'offline',
            'maelstrom.message_id': 'req-1',
            'maelstrom.session_id': 'session-1',
            'maelstrom.outcome': failed ? 'error' : 'ok',
            ...(expectedUsage?.inputTokens !== undefined ? { 'gen_ai.usage.input_tokens': expectedUsage.inputTokens } : {}),
            ...(expectedUsage?.outputTokens !== undefined ? { 'gen_ai.usage.output_tokens': expectedUsage.outputTokens } : {}),
          }, label);
          assert.deepEqual(calls[0].usage, expectedUsage, label);
          assert.deepEqual(tokenTotals(calls), {
            calls: 1,
            input: expectedUsage?.inputTokens ?? 0,
            output: expectedUsage?.outputTokens ?? 0,
            withoutUsage: expectedUsage?.inputTokens === undefined || expectedUsage?.outputTokens === undefined ? 1 : 0,
          }, label);
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
  expect(run.stdout.toString().trim()).toBe('102');
});
