import { describe, expect, mock, test } from 'bun:test';

import {
  CallId,
  type DiagnosticEvent,
  MessageId,
  RunId,
  SessionId,
} from '@maelstrom-co/protocol';
import type { TextOptions } from '@tanstack/ai';
import { z } from 'zod';

import { createDiagnosticConnection } from '../../index.js';
import { silentLogger } from '../__test-helpers__/fixtures.js';
import {
  capturingAgentRunQueueModule,
  capturingScreenChangeQueueModule,
  openAgentSession,
  runIdOf,
  TEST_BUDGETS,
  utterance,
} from './__test-helpers__/agent-session-harness.js';
import {
  type ScriptedModelCall,
  scriptedTextAdapter,
  scriptedTextTurn,
  scriptedToolTurn,
  scriptedUsage,
} from './__test-helpers__/scripted-text-adapter.js';
import {
  type AgentRunEvent,
  type AgentRunInput,
  type AgentRunToolResultEvent,
  runAgent,
} from './agent-run.js';
import { serverTool } from './server-tool.js';
import { createToolRegistry } from './tool-registry.js';
import { createToolResultStore } from './tool-result-store.js';

void mock.module('./screen-change-queue.js', capturingScreenChangeQueueModule);
void mock.module('./agent-run-queue.js', capturingAgentRunQueueModule);

describe('fetch by id for large tool results', () => {
  test('a large result enters the prompt as its result id and summary, never as its payload', async () => {
    const model = scriptedTextAdapter([
      toolTurn([{ id: 'p1', name: 'order_history', args: {} }]),
      textTurn('You have many orders.'),
    ]);

    await collect(runAgent(runInput(model.adapter), signalOptions()));

    expect(toolMessageContents(model.requests[1])).toEqual([
      { resultId: 'run-1:c1', summary: HISTORY_SUMMARY },
    ]);
    expect(serialized(model.requests[1])).not.toContain(PAYLOAD_SENTINEL);
  });

  test('the tool_result event of a large result carries its result id and summary and never the payload', async () => {
    const model = scriptedTextAdapter([
      toolTurn([{ id: 'p1', name: 'order_history', args: {} }]),
      textTurn('Done.'),
    ]);

    const events = await collect(
      runAgent(runInput(model.adapter), signalOptions()),
    );

    const results = toolResultsOf(events);
    expect(results).toEqual([
      {
        type: 'tool_result',
        turnId: 'run-1:t1',
        callId: CallId('c1'),
        name: 'order_history',
        ok: true,
        summary: HISTORY_SUMMARY,
        resultId: 'run-1:c1',
      },
    ]);
    expect(JSON.stringify(results)).not.toContain(PAYLOAD_SENTINEL);
  });

  test('a small result stays inline in the prompt and its tool_result carries no result id', async () => {
    const model = scriptedTextAdapter([
      toolTurn([{ id: 'p1', name: 'latest_order', args: {} }]),
      textTurn('It was o-1.'),
    ]);

    const events = await collect(
      runAgent(runInput(model.adapter), signalOptions()),
    );

    expect(toolMessageContents(model.requests[1])).toEqual([LATEST_ORDER]);
    expect(toolResultsOf(events)[0]).not.toHaveProperty('resultId');
  });

  test('the fetch tool returns the stored payload of a result of the same run as its own result', async () => {
    const model = scriptedTextAdapter([
      toolTurn([{ id: 'p1', name: 'order_history', args: {} }]),
      toolTurn([
        {
          id: 'p2',
          name: FETCH_TOOL_NAME,
          args: { resultId: 'run-1:c1' },
        },
      ]),
      textTurn('Your oldest order is o-0.'),
    ]);

    const events = await collect(
      runAgent(runInput(model.adapter), signalOptions()),
    );

    expect(toolMessageContents(model.requests[2])).toEqual([
      { resultId: 'run-1:c1', summary: HISTORY_SUMMARY },
      ORDER_HISTORY,
    ]);
    expect(toolResultsOf(events)[1]).toMatchObject({
      callId: CallId('c2'),
      name: FETCH_TOOL_NAME,
      ok: true,
    });
    expect(JSON.stringify(toolResultsOf(events))).not.toContain(
      PAYLOAD_SENTINEL,
    );
    expect(events.at(-1)).toMatchObject({
      type: 'finished',
      reason: 'completed',
    });
  });

  test('the fetch tool reads a result an earlier run of the session stored', async () => {
    const toolResults = createToolResultStore();
    toolResults.recordToolPhase(RunId('run-0'), {
      type: 'tool_phase_ended',
      turnId: 'run-0:t1',
      results: [
        {
          callId: CallId('c1'),
          name: 'order_history',
          ok: true,
          summary: HISTORY_SUMMARY,
          value: ORDER_HISTORY,
        },
      ],
    });
    const model = scriptedTextAdapter([
      toolTurn([
        { id: 'p1', name: FETCH_TOOL_NAME, args: { resultId: 'run-0:c1' } },
      ]),
      textTurn('Found it.'),
    ]);

    await collect(
      runAgent(runInput(model.adapter, { toolResults }), signalOptions()),
    );

    expect(toolMessageContents(model.requests[1])).toEqual([ORDER_HISTORY]);
  });

  test('the fetch tool answers an unknown result id with a typed failure and the run goes on', async () => {
    const model = scriptedTextAdapter([
      toolTurn([
        { id: 'p1', name: FETCH_TOOL_NAME, args: { resultId: 'run-1:c99' } },
      ]),
      textTurn('I could not find it.'),
    ]);

    const events = await collect(
      runAgent(runInput(model.adapter), signalOptions()),
    );

    expect(toolResultsOf(events)).toEqual([
      {
        type: 'tool_result',
        turnId: 'run-1:t1',
        callId: CallId('c1'),
        name: FETCH_TOOL_NAME,
        ok: false,
        summary: 'No stored result has the id run-1:c99',
      },
    ]);
    expect(toolMessageContents(model.requests[1])).toEqual([
      { ok: false, error: 'No stored result has the id run-1:c99' },
    ]);
    expect(events.at(-1)).toMatchObject({
      type: 'finished',
      reason: 'completed',
      reply: 'I could not find it.',
    });
  });

  test('the fetch tool is in the model tool catalog', async () => {
    const model = scriptedTextAdapter([textTurn('Hi.')]);

    await collect(runAgent(runInput(model.adapter), signalOptions()));

    const catalog = model.requests[0]?.tools ?? [];
    const fetchTool = catalog.find((tool) => tool.name === FETCH_TOOL_NAME);
    expect(fetchTool).toBeDefined();
    expect(fetchTool?.description).toContain('resultId');
  });

  test('a user tool may not take the fetch tool name', () => {
    expect(() =>
      createToolRegistry([
        serverTool({
          name: FETCH_TOOL_NAME,
          description: 'Impostor',
          input: z.object({}),
          output: z.object({}),
          execute: () => Promise.resolve({}),
          summarize: () => 'impostor',
        }),
      ]),
    ).toThrow(`Server tool name "${FETCH_TOOL_NAME}" is reserved`);
  });
});

describe('fetch by id on the agent route', () => {
  test('the wire tool_result of a large result carries the result id and summary and never the payload', async () => {
    const model = scriptedTextAdapter([
      toolTurn([{ id: 'p1', name: 'order_history', args: {} }]),
      textTurn('Done.'),
    ]);
    const session = openAgentSession({
      model: model.adapter,
      tools: [orderHistoryTool()],
    });

    await session.send(utterance('input-1', 'show my order history'));

    const runId = runIdOf(session.received, 'input-1');
    const results = session.received.filter(
      (event) => event.type === 'tool_result',
    );
    expect(results).toEqual([
      expect.objectContaining({
        runId,
        callId: CallId('c1'),
        ok: true,
        summary: HISTORY_SUMMARY,
        resultId: `${runId}:c1`,
      }),
    ]);
    expect(JSON.stringify(session.received)).not.toContain(PAYLOAD_SENTINEL);
    session.connection.close();
  });

  test('the fetch tool emits tool.started and tool.completed with its result id and payload size, and keeps payload and summary behind includeContent', async () => {
    const model = scriptedTextAdapter([
      toolTurn([{ id: 'p1', name: 'order_history', args: {} }]),
      fetchTurnFor('input-1'),
      textTurn('Done.'),
    ]);
    const session = openAgentSession({
      model: model.adapter,
      tools: [orderHistoryTool()],
    });
    const forwarded = await forwardDiagnostics(session.engine);
    pendingRunIds.set('input-1', () => runIdOf(session.received, 'input-1'));

    await session.send(utterance('input-1', 'show my oldest order'));

    const runId = runIdOf(session.received, 'input-1');
    const resultId = `${runId}:c1`;
    const fetchEvents = session.diagnostics.filter(
      (event) =>
        event.kind.startsWith('engine.agent.tool.') &&
        event.metadata.toolName === FETCH_TOOL_NAME,
    );
    expect(fetchEvents.map((event) => [event.kind, event.runId])).toEqual([
      ['engine.agent.tool.started', runId],
      ['engine.agent.tool.completed', runId],
    ]);
    expect(fetchEvents[0]?.metadata).toEqual({
      inputId: 'input-1',
      turnId: `${runId}:t2`,
      callId: 'c2',
      toolName: FETCH_TOOL_NAME,
      resultId,
    });
    expect(fetchEvents[1]?.metadata).toEqual({
      inputId: 'input-1',
      turnId: `${runId}:t2`,
      callId: 'c2',
      toolName: FETCH_TOOL_NAME,
      outcome: 'succeeded',
      durationMs: 0,
      resultId,
      payloadChars: JSON.stringify(ORDER_HISTORY).length,
    });
    for (const frame of forwarded.structural) {
      expect(frame).not.toContain(PAYLOAD_SENTINEL);
      expect(frame).not.toContain(HISTORY_SUMMARY);
    }
    const completedContent = forwarded
      .withContent()
      .find(
        (event) =>
          event.kind === 'engine.agent.tool.completed' &&
          event.metadata.toolName === FETCH_TOOL_NAME,
      )?.content;
    expect(JSON.stringify(completedContent)).toContain(PAYLOAD_SENTINEL);
    forwarded.dispose();
    session.connection.close();
  });

  test('a fetch of an unknown result id completes as failed with an error category', async () => {
    const model = scriptedTextAdapter([
      toolTurn([
        { id: 'p1', name: FETCH_TOOL_NAME, args: { resultId: 'nope:c1' } },
      ]),
      textTurn('Not found.'),
    ]);
    const session = openAgentSession({
      model: model.adapter,
      tools: [orderHistoryTool()],
    });

    await session.send(utterance('input-1', 'fetch something'));

    const completed = session.diagnostics.find(
      (event) =>
        event.kind === 'engine.agent.tool.completed' &&
        event.metadata.toolName === FETCH_TOOL_NAME,
    );
    expect(completed?.metadata).toMatchObject({
      callId: 'c1',
      outcome: 'failed',
      errorCategory: 'application',
      resultId: 'nope:c1',
    });
    expect(completed?.metadata).not.toHaveProperty('payloadChars');
    expect(typeof completed?.metadata.durationMs).toBe('number');
    session.connection.close();
  });
});

const FETCH_TOOL_NAME = 'fetch_tool_result';

const PAYLOAD_SENTINEL = 'payload-sentinel-5d1e';

const HISTORY_SUMMARY = '400 orders since 2019';

const LATEST_ORDER = { orderId: 'o-1', total: 42 };

const ORDER_HISTORY = {
  orders: Array.from({ length: 400 }, (_, index) => ({
    orderId: `o-${index}`,
    note: `${PAYLOAD_SENTINEL} line item details for order ${index}`,
  })),
};

const pendingRunIds = new Map<string, () => RunId>();

function orderHistoryTool() {
  return serverTool({
    name: 'order_history',
    description: 'Returns every order of the user',
    input: z.object({}),
    output: z.object({
      orders: z.array(z.object({ orderId: z.string(), note: z.string() })),
    }),
    sideEffect: 'read_only',
    execute: () => Promise.resolve(ORDER_HISTORY),
    summarize: () => HISTORY_SUMMARY,
  });
}

function latestOrderTool() {
  return serverTool({
    name: 'latest_order',
    description: 'Returns the latest order of the user',
    input: z.object({}),
    output: z.object({ orderId: z.string(), total: z.number() }),
    sideEffect: 'read_only',
    execute: () => Promise.resolve(LATEST_ORDER),
    summarize: (order) => `Order ${order.orderId}`,
  });
}

function runInput(
  adapter: AgentRunInput['adapter'],
  overrides: Partial<AgentRunInput> = {},
): AgentRunInput {
  return {
    runId: RunId('run-1'),
    adapter,
    instructions: 'You help pet shop customers.',
    registry: createToolRegistry([orderHistoryTool(), latestOrderTool()]),
    vessels: [],
    budgets: TEST_BUDGETS,
    priorMessages: [],
    utterance: 'show my order history',
    identity: { user: { id: 'user-1' } },
    clock: { now: () => 0, scheduleTimeout: () => () => undefined },
    logger: silentLogger,
    screenChanges: {
      request: () => [],
      noteBatchFillTimeout: () => undefined,
    },
    ...overrides,
  };
}

function toolTurn(
  calls: readonly { id: string; name: string; args: unknown }[],
): ScriptedModelCall {
  return scriptedToolTurn(calls, scriptedUsage(1, 1));
}

function textTurn(text: string): ScriptedModelCall {
  return scriptedTextTurn([text], scriptedUsage(1, 1));
}

// The run id is minted by the session, so the fetch arguments are built when
// the second model call is made.
function fetchTurnFor(inputId: string): ScriptedModelCall {
  return async function* (request) {
    const runId = pendingRunIds.get(inputId)?.();
    if (runId === undefined) throw new Error(`no run for ${inputId}`);
    yield* toolTurn([
      {
        id: 'p2',
        name: FETCH_TOOL_NAME,
        args: { resultId: `${runId}:c1` },
      },
    ])(request);
  };
}

function signalOptions() {
  return { signal: new AbortController().signal };
}

async function collect(
  events: AsyncIterable<AgentRunEvent>,
): Promise<AgentRunEvent[]> {
  const collected: AgentRunEvent[] = [];
  for await (const event of events) collected.push(event);
  return collected;
}

function toolResultsOf(
  events: readonly AgentRunEvent[],
): AgentRunToolResultEvent[] {
  return events.filter(
    (event): event is AgentRunToolResultEvent => event.type === 'tool_result',
  );
}

function toolMessageContents(request: TextOptions | undefined): unknown[] {
  return (request?.messages ?? [])
    .filter((message) => message.role === 'tool')
    .map((message) =>
      typeof message.content === 'string'
        ? (JSON.parse(message.content) as unknown)
        : message.content,
    );
}

function serialized(request: TextOptions | undefined): string {
  return JSON.stringify({
    messages: request?.messages,
    systemPrompts: request?.systemPrompts,
  });
}

async function forwardDiagnostics(
  engine: ReturnType<typeof openAgentSession>['engine'],
) {
  const structural: string[] = [];
  const withContent: string[] = [];
  const forwarders = [
    createDiagnosticConnection(engine, {
      enabled: true,
      sessionId: SessionId('agent-route'),
      send: (frame) => structural.push(frame),
    }),
    createDiagnosticConnection(engine, {
      enabled: true,
      sessionId: SessionId('agent-route'),
      send: (frame) => withContent.push(frame),
    }),
  ] as const;
  await forwarders[0].handle(subscription(false));
  await forwarders[1].handle(subscription(true));
  return {
    structural,
    withContent: () =>
      withContent.map(
        (frame) => (JSON.parse(frame) as { event: DiagnosticEvent }).event,
      ),
    dispose: () => {
      for (const forwarder of forwarders) forwarder.dispose();
    },
  };
}

function subscription(includeContent: boolean) {
  return {
    type: 'client.diagnostics.subscribe',
    id: MessageId(),
    sessionId: SessionId('agent-route'),
    enabled: true,
    includeContent,
  };
}
