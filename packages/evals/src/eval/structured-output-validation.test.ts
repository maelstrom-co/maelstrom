import { expect, test } from 'bun:test';
import { join } from 'node:path';

test('local validation preserves provider constraints and Zod semantics after terminal usage', () => {
  const jev = join(
    import.meta.dir,
    '..',
    '..',
    '..',
    'planner-jev',
    'src',
    'lib',
  );
  const probe = `
    import assert from 'node:assert/strict';
    import { chat } from '@tanstack/ai';
    import { z } from 'zod';
    import { callLlm } from ${JSON.stringify(join(jev, 'llm-call.ts'))};
    import { makeContext, makeInput, makeRequest } from ${JSON.stringify(join(jev, '__test-helpers__', 'fixtures.ts'))};

    let transforms = 0;
    const schema = z.object({
      text: z.string().min(1),
      optional: z.string().optional(),
      nullable: z.string().nullable(),
      optionalNullable: z.string().nullable().optional(),
      defaulted: z.string().default('fallback'),
      nested: z.array(z.object({ optional: z.number().optional(), nullable: z.number().nullable() })),
    }).refine(value => value.text !== 'rejected', 'Rejected by application policy')
      .transform(value => {
        transforms++;
        return { ...value, text: 'parsed:' + value.text };
      });
    const valid = {
      text: 'accepted', optional: null, nullable: null, optionalNullable: null,
      defaulted: null, nested: [{ optional: null, nullable: null }],
    };
    const usage = [{ inputTokens: 7, outputTokens: 2, totalTokens: 9 }];
    function adapter(mode, data, schemas) {
      async function* stream(options) {
        schemas.push(options.outputSchema);
        yield { type: 'TEXT_MESSAGE_START', messageId: 'm', role: 'assistant', timestamp: 1 };
        yield { type: 'TEXT_MESSAGE_CONTENT', messageId: 'm', delta: JSON.stringify(data), timestamp: 2 };
        yield { type: 'TEXT_MESSAGE_END', messageId: 'm', timestamp: 3 };
        if (mode === 'stream-finalization') {
          yield { type: 'CUSTOM', name: 'structured-output.complete', value: { object: data, raw: JSON.stringify(data) }, timestamp: 4 };
        }
        yield { type: 'RUN_FINISHED', runId: 'r', threadId: 't', finishReason: 'stop', timestamp: 5, usage };
      }
      return {
        kind: 'text', name: 'offline', model: 'offline',
        supportsCombinedToolsAndSchema: () => mode === 'combined',
        chatStream: stream,
        ...(mode === 'stream-finalization' ? { structuredOutputStream: stream } : {}),
        async structuredOutput(options) {
          schemas.push(options.outputSchema);
          return { data, rawText: JSON.stringify(data), usage: { promptTokens: 7, completionTokens: 2, totalTokens: 9 } };
        },
      };
    }

    for (const mode of ['combined', 'stream-finalization', 'direct-finalization']) {
      const baselineSchemas = [];
      transforms = 0;
      const baseline = await chat({
        adapter: adapter(mode, valid, baselineSchemas), outputSchema: schema,
        messages: [{ role: 'user', content: 'offline' }], threadId: 'session-1', stream: false, debug: false,
      });
      assert.equal(transforms, 1, mode + ': baseline transform');
      assert.deepEqual(baseline, {
        text: 'parsed:accepted', nullable: null, optionalNullable: null,
        defaulted: 'fallback', nested: [{ nullable: null }],
      }, mode + ': normalization');

      for (const rejected of [false, true]) {
        const schemas = [];
        const events = [];
        const ctx = makeContext(makeInput(makeRequest('hide the tasks')), {
          instrument: { stage: (_name, stage) => stage, event: (name, attributes) => events.push({ name, attributes }) },
        });
        transforms = 0;
        const result = await callLlm(
          { adapter: adapter(mode, { ...valid, text: rejected ? 'rejected' : 'accepted' }, schemas) },
          'offline', schema, [], ctx,
        );
        const label = mode + (rejected ? '/refinement-rejected' : '/valid');
        assert.equal(schemas.length, 1, label);
        assert.deepEqual(schemas, baselineSchemas, label + ': provider constraints');
        assert.equal(result.ok, !rejected, label);
        assert.equal(transforms, rejected ? 0 : 1, label + ': exactly-once transform');
        if (result.ok) assert.deepEqual(result.value, baseline, label);
        else assert.equal(result.error._tag, 'ProviderError', label);
        assert.equal(events.length, 1, label);
        assert.equal(events[0].name, 'llm.call', label);
        assert.equal(events[0].attributes['maelstrom.outcome'], rejected ? 'error' : 'ok', label);
        assert.equal(events[0].attributes['gen_ai.usage.input_tokens'], 7, label);
        assert.equal(events[0].attributes['gen_ai.usage.output_tokens'], 2, label);
      }
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
