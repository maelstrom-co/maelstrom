import assert from 'node:assert/strict';
import type { InstrumentAttributes } from '@maelstrom-co/engine';
import { createEngine } from '@maelstrom-co/engine';
import {
  buildGridResponse,
  makePlanningInput,
  makeStageContext,
  silentLogger,
} from '@maelstrom-co/engine/_testing';
import {
  buildJevPlanner,
  completeLayoutInline,
  type JevLayoutPlan,
} from '@maelstrom-co/planner-jev/_internal';
import {
  conversation,
  makeContext,
  makeInput,
  makeRequest,
  scriptedAsk,
} from '@maelstrom-co/planner-jev/_testing';
import { llmPlanner } from '@maelstrom-co/planner-llm';
import {
  ChartRequestMessage,
  getVisibleInstanceIds,
} from '@maelstrom-co/protocol';
import {
  type AnyTextAdapter,
  EventType,
  type StreamChunk,
  type TokenUsage,
} from '@tanstack/ai';
import { fakeText } from '@tanstack/ai/testing';

let unexpectedNetwork = 0;
function forbidNetwork(): never {
  unexpectedNetwork++;
  throw new Error('Unexpected network request in planner integration test.');
}

const entries = ['planner', 'complete', 'inline'] as const;
type Entry = (typeof entries)[number];
const modes = [
  'combined',
  'stream-finalization',
  'direct-finalization',
] as const;
type Mode = (typeof modes)[number];

function adapterFor(
  mode: Mode,
  stream: () => AsyncGenerator<StreamChunk>,
  structuredOutput: AnyTextAdapter['structuredOutput'],
) {
  return Object.assign(fakeText({ model: 'offline' }), {
    supportsCombinedToolsAndSchema: () => mode === 'combined',
    chatStream: stream,
    structuredOutput,
    ...(mode === 'stream-finalization'
      ? { structuredOutputStream: stream }
      : {}),
  });
}

function dataFor(entry: Entry) {
  return entry === 'planner' ? buildGridResponse() : { userMessage: 'Done.' };
}

async function* successfulStream(
  data: unknown,
  usage: TokenUsage,
): AsyncGenerator<StreamChunk> {
  yield {
    type: EventType.TEXT_MESSAGE_START,
    messageId: 'message',
    role: 'assistant',
    timestamp: 1,
  };
  yield {
    type: EventType.TEXT_MESSAGE_CONTENT,
    messageId: 'message',
    delta: JSON.stringify(data),
    timestamp: 2,
  };
  yield {
    type: EventType.TEXT_MESSAGE_END,
    messageId: 'message',
    timestamp: 3,
  };
  yield {
    type: 'CUSTOM',
    name: 'structured-output.complete',
    value: { object: data, raw: JSON.stringify(data) },
    timestamp: 4,
  };
  yield {
    type: EventType.RUN_FINISHED,
    runId: 'run',
    threadId: 'session',
    finishReason: 'stop',
    usage,
    timestamp: 5,
  };
}

async function invoke(
  entry: Entry,
  adapter: AnyTextAdapter,
  signal?: AbortSignal,
) {
  const events: { name: string; attributes: InstrumentAttributes }[] = [];
  const instrument = {
    stage: makeStageContext().instrument.stage,
    event: (name: string, attributes: InstrumentAttributes) => {
      if (name === 'llm.call') events.push({ name, attributes });
    },
  };
  const input = makePlanningInput();
  const request = makeRequest('keep the current layout');
  const visible = getVisibleInstanceIds(request.layout);
  const plan: JevLayoutPlan = {
    plan: {
      selection: {
        input: makeInput(request),
        instances: request.instances.map((instance) => ({
          ...instance,
          decision: 'keep',
          visible: visible.has(instance.instanceId),
          fresh: false,
        })),
        answers: [],
      },
      actions: [],
      asks: [],
      answers: [],
    },
    layoutId: 'preserve',
    tree: request.layout.type === 'tiling' ? request.layout.tree : [],
    answers: [],
  };
  const result =
    entry === 'planner'
      ? await llmPlanner({ adapter })(
          input,
          makeStageContext({ origin: input, signal, instrument }),
        )
      : entry === 'complete'
        ? await buildJevPlanner({
            ask: scriptedAsk(conversation({ layout: 'preserve' })).ask,
            llm: { adapter },
            fallback: () => assert.fail('Unexpected planner fallback.'),
          })(
            plan.plan.selection.input,
            makeContext(plan.plan.selection.input, { signal, instrument }),
          )
        : await completeLayoutInline({ adapter })(
            {
              ...plan,
              plan: { ...plan.plan, minConfidence: 1 },
              source: 'preserve',
            },
            makeContext(plan.plan.selection.input, { signal, instrument }),
          );
  return { result, events };
}

async function cancelledUsage() {
  for (const entry of entries) {
    for (const mode of modes) {
      const controller = new AbortController();
      const adapter = adapterFor(
        mode,
        async function* (): AsyncGenerator<StreamChunk> {
          controller.abort('superseded');
          yield {
            type: EventType.RUN_ERROR,
            timestamp: 1,
            message: 'Private provider response.',
            usage: [{ inputTokens: 7, outputTokens: 2, totalTokens: 9 }],
          };
        },
        async () => {
          controller.abort('superseded');
          return {
            data: dataFor(entry),
            rawText: JSON.stringify(dataFor(entry)),
            usage: { promptTokens: 7, completionTokens: 2, totalTokens: 9 },
          };
        },
      );
      const { result, events } = await invoke(
        entry,
        adapter,
        controller.signal,
      );
      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.equal(result.error._tag, 'CancellationError');
      }
      assert.equal(events.length, 1);
      assert.equal(events[0]?.name, 'llm.call');
      assert.equal(events[0]?.attributes['maelstrom.outcome'], 'cancelled');
      assert.equal(events[0]?.attributes['gen_ai.usage.input_tokens'], 7);
      assert.equal(events[0]?.attributes['gen_ai.usage.output_tokens'], 2);
      assert.equal(
        JSON.stringify(events).includes('Private provider response.'),
        false,
      );
    }
  }
}

async function providerAbort() {
  for (const entry of entries) {
    for (const mode of modes) {
      const adapter = adapterFor(
        mode,
        () => {
          throw new DOMException('Private provider response.', 'AbortError');
        },
        async () => {
          throw new DOMException('Private provider response.', 'AbortError');
        },
      );
      const { result, events } = await invoke(entry, adapter);
      assert.equal(result.ok, false, entry);
      if (!result.ok)
        assert.equal(result.error._tag, 'CancellationError', entry);
      assert.equal(events.length, 1, entry);
      assert.equal(
        events[0]?.attributes['maelstrom.outcome'],
        'cancelled',
        entry,
      );
      assert.equal(
        JSON.stringify(events).includes('Private provider response.'),
        false,
      );
    }
  }
}

async function providerAbortEvent() {
  for (const entry of entries) {
    for (const mode of ['combined', 'stream-finalization'] as const) {
      for (const terminal of ['metadata', 'code', 'provider-error'] as const) {
        const source = {
          provider: 'offline',
          api: 'offline',
          model: 'offline',
        };
        const adapter = adapterFor(
          mode,
          async function* (): AsyncGenerator<StreamChunk> {
            yield {
              type: EventType.RUN_ERROR,
              timestamp: 1,
              message: 'Private aborted provider response.',
              ...(terminal === 'metadata'
                ? {
                    metadata: {
                      tanstack: { source, stopReason: 'aborted' as const },
                    },
                  }
                : terminal === 'code'
                  ? { code: 'aborted' }
                  : {
                      code: 'provider_failure',
                      metadata: {
                        tanstack: { source, stopReason: 'error' as const },
                      },
                    }),
              usage: [{ inputTokens: 7, outputTokens: 2, totalTokens: 9 }],
            };
          },
          async () => assert.fail('Unexpected direct structured output.'),
        );
        const { result, events } = await invoke(entry, adapter);
        const label = `${entry}/${mode}/${terminal}`;
        assert.equal(result.ok, false, label);
        if (!result.ok)
          assert.equal(
            result.error._tag,
            terminal === 'provider-error'
              ? 'ProviderError'
              : 'CancellationError',
            label,
          );
        assert.equal(events.length, 1, label);
        assert.equal(
          events[0]?.attributes['maelstrom.outcome'],
          terminal === 'provider-error' ? 'error' : 'cancelled',
          label,
        );
        assert.equal(events[0]?.attributes['gen_ai.usage.input_tokens'], 7);
        assert.equal(events[0]?.attributes['gen_ai.usage.output_tokens'], 2);
        assert.equal(
          JSON.stringify(events).includes('Private aborted provider response.'),
          false,
        );
      }
    }
  }
}

async function distinctAttempts() {
  for (const entry of entries) {
    for (const mode of modes) {
      let attempts = 0;
      const data = dataFor(entry);
      const usage = { promptTokens: 5, completionTokens: 1, totalTokens: 6 };
      const adapter = adapterFor(
        mode,
        async function* (): AsyncGenerator<StreamChunk> {
          attempts++;
          if (attempts === 1) {
            yield {
              type: EventType.RUN_ERROR,
              message: 'Private rate limit.',
              retryAfterMs: 0,
              timestamp: 1,
              usage: [{ inputTokens: 2, outputTokens: 0, totalTokens: 2 }],
            };
            return;
          }
          yield* successfulStream(data, usage);
        },
        async () => {
          attempts++;
          if (attempts === 1) throw new Error('Private rate limit.');
          return { data, rawText: JSON.stringify(data), usage };
        },
      );
      const first = await invoke(entry, adapter);
      assert.equal(first.result.ok, false, `${entry}/${mode}`);
      assert.equal(
        attempts,
        1,
        'A failed request must not start an unrequested retry.',
      );
      assert.equal(first.events.length, 1);
      assert.equal(first.events[0]?.attributes['maelstrom.outcome'], 'error');
      assert.equal(
        first.events[0]?.attributes['gen_ai.usage.input_tokens'],
        mode === 'direct-finalization' ? undefined : 2,
      );
      const second = await invoke(entry, adapter);
      assert.equal(second.result.ok, true, `${entry}/${mode}`);
      assert.equal(attempts, 2);
      assert.equal(second.events.length, 1);
      assert.equal(second.events[0]?.attributes['maelstrom.outcome'], 'ok');
      assert.equal(
        second.events[0]?.attributes['gen_ai.usage.input_tokens'],
        5,
      );
      assert.equal(
        second.events[0]?.attributes['gen_ai.usage.output_tokens'],
        1,
      );
      assert.equal(
        JSON.stringify([...first.events, ...second.events]).includes(
          'Private rate limit.',
        ),
        false,
      );
    }
  }
}

async function preflightCancellation() {
  for (const entry of entries) {
    const controller = new AbortController();
    controller.abort('superseded');
    const adapter = Object.assign(fakeText({ model: 'offline' }), {
      chatStream(): never {
        assert.fail('Preflight cancellation started provider work.');
      },
      async structuredOutput(): Promise<never> {
        assert.fail('Preflight cancellation started provider work.');
      },
    });
    const { result, events } = await invoke(entry, adapter, controller.signal);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error._tag, 'CancellationError');
    // A cancelled pipeline stops before completion, so no LLM call starts.
    assert.equal(events.length, entry === 'complete' ? 0 : 1);
    if (entry !== 'complete')
      assert.equal(events[0]?.attributes['maelstrom.outcome'], 'cancelled');
    assert.equal(
      Object.hasOwn(events[0]?.attributes ?? {}, 'gen_ai.usage.input_tokens'),
      false,
    );
  }
}

async function frozenAdapter() {
  for (const entry of entries) {
    for (const mode of modes) {
      const data = dataFor(entry);
      const usage = { promptTokens: 5, completionTokens: 1, totalTokens: 6 };
      const adapter = Object.freeze(
        adapterFor(
          mode,
          () => successfulStream(data, usage),
          async () => ({ data, rawText: JSON.stringify(data), usage }),
        ),
      );
      const { result, events } = await invoke(entry, adapter);
      assert.equal(result.ok, true, `${entry}/${mode}`);
      assert.equal(events.length, 1);
      assert.equal(events[0]?.attributes['maelstrom.outcome'], 'ok');
      assert.equal(events[0]?.attributes['gen_ai.usage.input_tokens'], 5);
    }
  }
}

async function correctionRetry() {
  for (const mode of modes) {
    let attempts = 0;
    const events: InstrumentAttributes[] = [];
    const next = () => {
      attempts++;
      return {
        data:
          attempts === 1
            ? buildGridResponse({
                layout: {
                  positions: [
                    {
                      instanceId: 'calendar-main',
                      position: { row: 0, column: 10 },
                      size: { width: 6, height: 4 },
                    },
                  ],
                },
              })
            : buildGridResponse(),
        usage:
          attempts === 1
            ? { promptTokens: 2, completionTokens: 0, totalTokens: 2 }
            : { promptTokens: 5, completionTokens: 1, totalTokens: 6 },
      };
    };
    const adapter = adapterFor(
      mode,
      async function* () {
        const { data, usage } = next();
        yield* successfulStream(data, usage);
      },
      async () => {
        const { data, usage } = next();
        return { data, rawText: JSON.stringify(data), usage };
      },
    );
    const input = makePlanningInput();
    const engine = createEngine({
      planner: llmPlanner({ adapter }),
      retry: { max: 1 },
      logger: silentLogger,
      instrument: {
        stage: makeStageContext().instrument.stage,
        event: (name, attributes) => {
          if (name === 'llm.call') events.push(attributes);
        },
      },
    });
    const result = await engine.handle(
      ChartRequestMessage({
        id: input.messageId,
        sessionId: input.sessionId,
        request: input.request,
      }),
    );
    assert.equal(result.ok, true, mode);
    assert.equal(attempts, 2, mode);
    assert.deepEqual(
      events.map((event) => event['gen_ai.usage.input_tokens']),
      [2, 5],
      mode,
    );
    assert.deepEqual(
      events.map((event) => event['gen_ai.usage.output_tokens']),
      [0, 1],
      mode,
    );
    assert.ok(
      events.every(
        (event) =>
          event['maelstrom.message_id'] === input.messageId &&
          event['maelstrom.session_id'] === input.sessionId,
      ),
    );
  }
}

const scenarios = {
  'cancelled-usage': cancelledUsage,
  'provider-abort': providerAbort,
  'provider-abort-event': providerAbortEvent,
  'distinct-attempts': distinctAttempts,
  'preflight-cancellation': preflightCancellation,
  'frozen-adapter': frozenAdapter,
  'correction-retry': correctionRetry,
};
const scenario = process.argv[2];
if (import.meta.main && scenario && Object.hasOwn(scenarios, scenario)) {
  globalThis.fetch = Object.assign(async () => forbidNetwork(), {
    preconnect: forbidNetwork,
  });
  await scenarios[scenario as keyof typeof scenarios]();
  assert.equal(unexpectedNetwork, 0);
  console.log(scenario);
}
