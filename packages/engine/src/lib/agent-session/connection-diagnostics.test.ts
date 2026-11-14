import { describe, expect, mock, test } from 'bun:test';

import {
  AGENT_WIRE_VERSION,
  type AgentEvent,
  type AgentFinishedEvent,
  type AgentUiChangeEvent,
  ChangeId,
  type DiagnosticEvent,
  MessageId,
  ok,
  type RunId,
  SessionId,
} from '@maelstrom-co/protocol';
import { EventType, type StreamChunk } from '@tanstack/ai';
import { z } from 'zod';

import {
  type ClarifyingPlanner,
  createDiagnosticConnection,
  createEngine,
  serverTool,
  ToolError,
} from '../../index.js';
import { defer } from '../__test-helpers__/defer.js';
import {
  makeTilingRequest,
  silentLogger,
} from '../__test-helpers__/fixtures.js';
import { named } from '../planner/instrument.js';
import { pipeline } from '../planner/pipeline.js';
import {
  acknowledgementOf,
  addEventPlanner,
  calendarChart,
  capturingAgentRunQueueModule,
  capturingPlannerShowQueueModule,
  LATEST_ORDER,
  openAgentSession,
  orderFacts,
  orderTool,
  runIdOf,
  settle,
  TEST_BUDGETS,
  tilingLayoutOf,
  uiChangesOf,
  utterance,
  waitUntil,
} from './__test-helpers__/agent-session-harness.js';
import { createFakeAgentRunTime } from './__test-helpers__/fake-agent-run-time.js';
import {
  type ScriptedModelCall,
  scriptedFailingTurn,
  scriptedTextAdapter,
  scriptedTextTurn,
  scriptedToolTurn,
  scriptedUsage,
} from './__test-helpers__/scripted-text-adapter.js';

void mock.module('./planner-show-queue.js', capturingPlannerShowQueueModule);
void mock.module('./agent-run-queue.js', capturingAgentRunQueueModule);

describe('session-level input diagnostics', () => {
  test('a repeated input id yields one session-owned input.ignored, forwarded to a diagnostic connection of the session', async () => {
    const model = scriptedTextAdapter([
      scriptedTextTurn(['Hello.'], scriptedUsage(2, 1)),
    ]);
    const session = openAgentSession({ model: model.adapter });
    const frames: string[] = [];
    const forwarding = createDiagnosticConnection(session.engine, {
      enabled: true,
      sessionId: SessionId('agent-route'),
      send: (frame) => frames.push(frame),
    });
    await forwarding.handle(diagnosticsSubscription('agent-route'));

    await session.send(utterance('input-1', 'hello'));
    await session.send(utterance('input-1', 'hello'));

    const ignored = sessionEventsOfKind(
      session.diagnostics,
      'engine.agent.input.ignored',
    );
    expect(ignored).toHaveLength(1);
    expect(ignored[0]?.metadata).toEqual({
      inputId: 'input-1',
      reason: 'duplicate_input',
    });
    expect(
      frames
        .map((frame) => (JSON.parse(frame) as { event: DiagnosticEvent }).event)
        .filter((event) => event.kind === 'engine.agent.input.ignored'),
    ).toMatchObject([{ metadata: { inputId: 'input-1' } }]);
    forwarding.dispose();
    session.connection.close();
  });

  test('an invalid input yields a session-owned input.rejected with code invalid_input', async () => {
    const session = openAgentSession();

    await session.connection.send({ type: 'not_an_input' });

    const rejected = sessionEventsOfKind(
      session.diagnostics,
      'engine.agent.input.rejected',
    );
    expect(rejected.map((event) => event.metadata)).toEqual([
      { code: 'invalid_input' },
    ]);
    session.connection.close();
  });

  test('a 33rd pending utterance against a held model yields a session-owned input.rejected with code queue_full and its input id', async () => {
    const model = scriptedTextAdapter([heldTurn()]);
    const session = openAgentSession({ model: model.adapter });
    const sends: Promise<void>[] = [];

    for (let index = 1; index <= 33; index += 1)
      sends.push(session.send(utterance(`input-${index}`, 'hello')));

    expect(session.received.at(-1)).toMatchObject({
      type: 'error',
      inputId: 'input-33',
      code: 'queue_full',
    });
    expect(
      sessionEventsOfKind(
        session.diagnostics,
        'engine.agent.input.rejected',
      ).map((event) => event.metadata),
    ).toEqual([{ code: 'queue_full', inputId: 'input-33' }]);
    session.connection.close();
    await Promise.all(sends);
  });

  test('on a UI-only connection an invalid input yields exactly one input.rejected and no ui_applied.rejected', async () => {
    const session = openUiOnlySession();

    await session.connection.send({ type: 'not_an_input' });

    expect(
      sessionEventsOfKind(
        session.diagnostics,
        'engine.agent.input.rejected',
      ).map((event) => event.metadata),
    ).toEqual([{ code: 'invalid_input' }]);
    expect(
      sessionEventsOfKind(
        session.diagnostics,
        'engine.agent.ui_applied.rejected',
      ),
    ).toHaveLength(0);
    session.connection.close();
  });

  test('on a UI-only connection a repeated input id yields one input.ignored', async () => {
    const session = openUiOnlySession();

    await session.connection.send(utterance('input-1', 'hello'));
    await session.connection.send(utterance('input-1', 'hello'));

    const ignored = sessionEventsOfKind(
      session.diagnostics,
      'engine.agent.input.ignored',
    );
    expect(ignored).toHaveLength(1);
    expect(ignored[0]?.metadata).toEqual({
      inputId: 'input-1',
      reason: 'duplicate_input',
    });
    session.connection.close();
  });
});

describe('acknowledgement refusal diagnostics', () => {
  test('on an agent connection a ui_applied for an unknown change yields a session-owned ui_applied.rejected', async () => {
    const session = openAgentSession();

    await session.connection.send(strayAcknowledgement());

    expect(session.received).toEqual([strayRefusal()]);
    expect(
      sessionEventsOfKind(
        session.diagnostics,
        'engine.agent.ui_applied.rejected',
      ).map((event) => event.metadata),
    ).toEqual([{ changeId: 'stray-change', code: 'unknown_change' }]);
    expect(
      session.diagnostics.filter(
        (event) => event.kind === 'engine.agent.input.rejected',
      ),
    ).toEqual([]);
    session.connection.close();
  });

  test('on a UI-only connection a ui_applied for an unknown change yields a session-owned ui_applied.rejected', async () => {
    const session = openUiOnlySession();

    await session.connection.send(strayAcknowledgement());

    expect(session.received).toEqual([strayRefusal()]);
    expect(
      sessionEventsOfKind(
        session.diagnostics,
        'engine.agent.ui_applied.rejected',
      ).map((event) => event.metadata),
    ).toEqual([{ changeId: 'stray-change', code: 'unknown_change' }]);
    expect(
      session.diagnostics.filter(
        (event) => event.kind === 'engine.agent.input.rejected',
      ),
    ).toEqual([]);
    session.connection.close();
  });

  test('on a UI-only connection a ui_applied with the wrong outcome count yields a ui_applied.rejected owned by the run of the change', async () => {
    const session = openUiOnlySession();
    await session.connection.send(utterance('input-1', 'show my calendar'));
    const change = session.received.find(
      (event): event is AgentUiChangeEvent => event.type === 'ui_change',
    );
    if (change === undefined) throw new Error('no ui_change event');

    await session.connection.send({
      type: 'ui_applied',
      version: AGENT_WIRE_VERSION,
      changeId: change.changeId,
      chart: makeTilingRequest(),
      actionOutcomes: [{ ok: true }],
    });

    const rejected = session.diagnostics.filter(
      (event) => event.kind === 'engine.agent.ui_applied.rejected',
    );
    expect(rejected).toHaveLength(1);
    expect(rejected[0]).not.toHaveProperty('requestId');
    expect(rejected[0]).toMatchObject({ runId: change.runId });
    expect(rejected[0]?.metadata).toEqual({
      changeId: change.changeId,
      code: 'invalid_action_outcomes',
      inputId: 'input-1',
    });
    session.connection.close();
  });
});

describe('run.finished durationMs', () => {
  test('a completed agent run reports durationMs equal to the wire elapsedMs', async () => {
    const time = createFakeAgentRunTime();
    const model = scriptedTextAdapter([
      advancingTurn(time.advanceWithoutFiring, 250, ['Hello.']),
    ]);
    const session = openAgentSession({ time, model: model.adapter });

    await session.send(utterance('input-1', 'hello'));

    const finished = finishedOf(session.received);
    expect(finished.metrics.elapsedMs).toBe(250);
    expect(runFinishedOf(session.diagnostics, finished.runId)).toMatchObject({
      durationMs: 250,
      elapsedMs: 250,
    });
    session.connection.close();
  });

  test('a UI-only run reports durationMs equal to the wire elapsedMs', async () => {
    const session = openUiOnlySession(40);
    await session.connection.send(utterance('input-1', 'show my calendar'));
    const change = session.received.find(
      (event): event is AgentUiChangeEvent => event.type === 'ui_change',
    );
    if (change === undefined) throw new Error('no ui_change event');

    await session.connection.send({
      type: 'ui_applied',
      version: AGENT_WIRE_VERSION,
      changeId: change.changeId,
      chart: makeTilingRequest(),
      actionOutcomes: [],
    });

    const finished = finishedOf(session.received);
    expect(finished.metrics.elapsedMs).toBe(40);
    expect(runFinishedOf(session.diagnostics, finished.runId)).toMatchObject({
      durationMs: 40,
    });
    session.connection.close();
  });

  test('a queued agent run cancelled before it starts reports durationMs equal to the wire elapsedMs', async () => {
    const model = scriptedTextAdapter([heldTurn()]);
    const session = openAgentSession({ model: model.adapter });
    const first = session.send(utterance('input-1', 'hello'));
    const second = session.send(utterance('input-2', 'and then?'));
    const accepted = session.received.find(
      (event) => event.type === 'accepted' && event.inputId === 'input-2',
    );
    if (accepted?.type !== 'accepted' || accepted.runId === null)
      throw new Error('input-2 was not accepted into a run');

    session.internals().queue.cancelRun(accepted.runId);
    await second;

    const finished = finishedOf(session.received);
    expect(finished).toMatchObject({
      runId: accepted.runId,
      reason: 'cancelled',
    });
    expect(runFinishedOf(session.diagnostics, accepted.runId).durationMs).toBe(
      finished.metrics.elapsedMs,
    );
    session.connection.close();
    await first;
  });

  test('without a diagnostic listener a completed agent run still sends finished with full metrics', async () => {
    const time = createFakeAgentRunTime();
    const model = scriptedTextAdapter([
      advancingTurn(time.advanceWithoutFiring, 250, ['Hello.']),
    ]);
    const received: AgentEvent[] = [];
    const connection = createEngine({
      logger: silentLogger,
      retry: false,
      planner: keepScreenPlanner,
      agent: {
        model: model.adapter,
        instructions: 'You help pet shop customers.',
        tools: [],
        budgets: TEST_BUDGETS,
      },
    }).openConnection({
      sessionId: SessionId('unobserved'),
      user: null,
      clock: time.clock.now,
      scheduleTimeout: time.clock.scheduleTimeout,
    });
    connection.subscribe((event) => {
      received.push(event);
    });

    await connection.send(utterance('input-1', 'hello'));

    expect(finishedOf(received).metrics).toEqual({
      turns: 1,
      toolCalls: 0,
      elapsedMs: 250,
      inputTokens: 2,
      outputTokens: 1,
    });
    connection.close();
  });
});

describe('agent run diagnostics', () => {
  test('a two-turn run with a loop-driven show reports its run, turns and tool call, and its Planner events carry the run owner and the turn id', async () => {
    const model = scriptedTextAdapter([
      scriptedToolTurn(
        [{ id: 'provider-call-1', name: 'latest_order', args: {} }],
        scriptedUsage(3, 2),
      ),
      scriptedTextTurn(['It was o-1.'], scriptedUsage(5, 4)),
    ]);
    const session = openAgentSession({
      model: model.adapter,
      tools: [orderTool({ intentFacts: orderFacts }).tool],
      planner: pipeline(named('arrange', addEventPlanner)),
    });

    await session.send(
      utterance('input-1', 'show me my last order', calendarChart()),
    );
    await waitUntil(() => uiChangesOf(session.received).length === 1);
    const [change] = uiChangesOf(session.received);
    if (change === undefined) throw new Error('no ui_change');
    await session.connection.send(acknowledgementOf(change, calendarChart()));

    const runId = runIdOf(session.received, 'input-1');
    const firstTurn = `${runId}:t1`;
    const secondTurn = `${runId}:t2`;
    for (const event of session.diagnostics) {
      expect(event.runId).toBe(runId);
      expect(event.requestId).toBeUndefined();
      expect(event.metadata.inputId).toBe('input-1');
    }
    expect(runLifecycleOf(session.diagnostics)).toEqual([
      [
        'engine.agent.input.accepted',
        { inputId: 'input-1', source: 'text', disposition: 'agent' },
      ],
      [
        'engine.agent.run.started',
        { inputId: 'input-1', disposition: 'agent' },
      ],
      [
        'engine.agent.turn.started',
        { inputId: 'input-1', turnId: firstTurn, turnIndex: 1 },
      ],
      [
        'engine.agent.tool.started',
        {
          inputId: 'input-1',
          turnId: firstTurn,
          callId: 'c1',
          toolName: 'latest_order',
        },
      ],
      [
        'engine.agent.tool.completed',
        {
          inputId: 'input-1',
          turnId: firstTurn,
          callId: 'c1',
          toolName: 'latest_order',
          outcome: 'succeeded',
          durationMs: 0,
        },
      ],
      [
        'engine.agent.turn.finished',
        {
          inputId: 'input-1',
          turnId: firstTurn,
          turnIndex: 1,
          toolCalls: 1,
          inputTokens: 3,
          outputTokens: 2,
        },
      ],
      [
        'engine.agent.turn.started',
        { inputId: 'input-1', turnId: secondTurn, turnIndex: 2 },
      ],
      [
        'engine.agent.turn.finished',
        {
          inputId: 'input-1',
          turnId: secondTurn,
          turnIndex: 2,
          toolCalls: 0,
          inputTokens: 5,
          outputTokens: 4,
        },
      ],
      [
        'engine.agent.run.finished',
        expect.objectContaining({
          reason: 'completed',
          turns: 2,
          toolCalls: 1,
          inputTokens: 8,
          outputTokens: 6,
        }),
      ],
    ]);
    const kinds = session.diagnostics.map((event) => event.kind);
    const plannerEvents = session.diagnostics.filter(
      (event) =>
        event.kind.startsWith('engine.planner.') ||
        event.kind.startsWith('engine.stage.'),
    );
    expect(plannerEvents.map((event) => event.kind)).toEqual(
      expect.arrayContaining([
        'engine.planner.started',
        'engine.planner.completed',
        'engine.stage.started',
        'engine.stage.completed',
      ]),
    );
    for (const event of plannerEvents)
      expect(event.metadata.turnId).toBe(firstTurn);
    expect(kinds.indexOf('engine.planner.started')).toBeGreaterThan(
      kinds.indexOf('engine.agent.tool.completed'),
    );
    const emitted = session.diagnostics.find(
      (event) => event.kind === 'engine.agent.ui_change.emitted',
    );
    expect(emitted?.metadata).toMatchObject({
      changeId: change.changeId,
      turnId: firstTurn,
    });
    expect(kinds.indexOf('engine.agent.ui_change.emitted')).toBeGreaterThan(
      kinds.indexOf('engine.planner.completed'),
    );
    session.connection.close();
  });

  test('turn token counts are absent for a turn whose provider call reported no usage, and reported counts sum to the run totals', async () => {
    const model = scriptedTextAdapter([
      scriptedToolTurn(
        [{ id: 'provider-call-1', name: 'latest_order', args: {} }],
        undefined,
      ),
      scriptedTextTurn(['It was o-1.'], scriptedUsage(5, 4)),
    ]);
    const session = openAgentSession({
      model: model.adapter,
      tools: [orderTool().tool],
      budgets: { maxTokens: Number.POSITIVE_INFINITY },
    });

    await session.send(utterance('input-1', 'show me my last order'));

    const turns = session.diagnostics
      .filter((event) => event.kind === 'engine.agent.turn.finished')
      .map((event) => event.metadata);
    expect(turns).toHaveLength(2);
    expect(turns[0]).not.toHaveProperty('inputTokens');
    expect(turns[0]).not.toHaveProperty('outputTokens');
    expect(turns[1]).toMatchObject({ inputTokens: 5, outputTokens: 4 });
    expect(finishedOf(session.received).metrics).toMatchObject({
      inputTokens: 5,
      outputTokens: 4,
    });
    session.connection.close();
  });

  test.each([
    ['completed', 'completed'],
    ['budget', 'turn cap'],
    ['error', 'throwing adapter'],
    ['cancelled', 'cancelled run'],
  ] as const)(
    'a %s ending (%s) reports run.finished counters equal to the wire metrics and durationMs equal to elapsedMs',
    async (reason) => {
      const time = createFakeAgentRunTime();
      const session = openAgentSession({
        time,
        ...endingScenario(reason, time.advanceWithoutFiring),
      });

      const sent = session.send(utterance('input-1', 'show me my last order'));
      if (reason === 'cancelled') {
        await waitUntil(() =>
          session.diagnostics.some(
            (event) => event.kind === 'engine.agent.turn.started',
          ),
        );
        time.advanceWithoutFiring(30);
        session
          .internals()
          .queue.cancelRun(runIdOf(session.received, 'input-1'));
      }
      await sent;

      const finished = finishedOf(session.received);
      expect(finished.reason).toBe(reason);
      const metadata = runFinishedOf(session.diagnostics, finished.runId);
      expect(metadata).toMatchObject({ ...finished.metrics });
      expect(metadata.durationMs).toBe(finished.metrics.elapsedMs);
      expect(
        session.diagnostics.filter(
          (event) => event.kind === 'engine.agent.turn.started',
        ),
      ).toHaveLength(finished.metrics.turns);
      session.connection.close();
    },
  );

  test('a throwing tool completes as failed with a duration', async () => {
    const model = scriptedTextAdapter([
      scriptedToolTurn(
        [{ id: 'provider-call-1', name: 'latest_order', args: {} }],
        scriptedUsage(1, 1),
      ),
      scriptedTextTurn(['You have no orders yet.'], scriptedUsage(1, 1)),
    ]);
    const session = openAgentSession({
      model: model.adapter,
      tools: [
        orderTool({
          latestOrder: () => Promise.reject(new ToolError('No orders yet.')),
        }).tool,
      ],
    });

    await session.send(utterance('input-1', 'show me my last order'));

    expect(toolEventsOf(session.diagnostics)).toEqual([
      ['engine.agent.tool.started', expect.objectContaining({ callId: 'c1' })],
      [
        'engine.agent.tool.completed',
        expect.objectContaining({
          callId: 'c1',
          outcome: 'failed',
          durationMs: 0,
        }),
      ],
    ]);
    session.connection.close();
  });

  test('a call refused by the tool-call budget completes as not_run without a duration and never starts', async () => {
    const model = scriptedTextAdapter([
      scriptedToolTurn(
        [
          { id: 'provider-call-1', name: 'latest_order', args: {} },
          { id: 'provider-call-2', name: 'latest_order', args: {} },
        ],
        scriptedUsage(1, 1),
      ),
      scriptedTextTurn(['Done.'], scriptedUsage(1, 1)),
    ]);
    const session = openAgentSession({
      model: model.adapter,
      tools: [orderTool().tool],
      budgets: { maxToolCalls: 1 },
    });

    await session.send(utterance('input-1', 'show me my last two orders'));

    const tools = toolEventsOf(session.diagnostics);
    expect(tools.map(([kind]) => kind)).toEqual([
      'engine.agent.tool.completed',
      'engine.agent.tool.completed',
    ]);
    for (const [, metadata] of tools) {
      expect(metadata.outcome).toBe('not_run');
      expect(metadata).not.toHaveProperty('durationMs');
    }
    session.connection.close();
  });

  test('tool.started is published before the tool runs and tool.completed measures the tool on the run clock', async () => {
    const time = createFakeAgentRunTime();
    const model = scriptedTextAdapter([
      scriptedToolTurn(
        [{ id: 'provider-call-1', name: 'latest_order', args: {} }],
        scriptedUsage(1, 1),
      ),
      scriptedTextTurn(['It was o-1.'], scriptedUsage(1, 1)),
    ]);
    let startedSeenByTool = false;
    let sideEffectAt = 0;
    const session = openAgentSession({
      time,
      model: model.adapter,
      tools: [
        orderTool({
          latestOrder: () => {
            startedSeenByTool = session.diagnostics.some(
              (event) => event.kind === 'engine.agent.tool.started',
            );
            sideEffectAt = Date.now();
            time.advanceWithoutFiring(75);
            return Promise.resolve(LATEST_ORDER);
          },
        }).tool,
      ],
    });

    await session.send(utterance('input-1', 'show me my last order'));

    const [started, completed] = session.diagnostics.filter((event) =>
      event.kind.startsWith('engine.agent.tool.'),
    );
    expect(startedSeenByTool).toBe(true);
    expect(started?.at).toBeLessThanOrEqual(sideEffectAt);
    expect(completed?.metadata.durationMs).toBe(75);
    session.connection.close();
  });

  test('text, payloads, arguments and results are forwarded only to a subscription that includes content', async () => {
    const model = scriptedTextAdapter([
      scriptedToolTurn(
        [
          {
            id: 'provider-call-1',
            name: 'find_order',
            args: { orderNumber: ARGS_SENTINEL },
          },
        ],
        scriptedUsage(1, 1),
      ),
      scriptedTextTurn([REPLY_SENTINEL], scriptedUsage(1, 1)),
    ]);
    const session = openAgentSession({
      model: model.adapter,
      tools: [findOrderTool()],
      planner: addEventPlanner,
    });
    const structural: string[] = [];
    const withContent: string[] = [];
    const forwarders = [
      createDiagnosticConnection(session.engine, {
        enabled: true,
        sessionId: SessionId('agent-route'),
        send: (frame) => structural.push(frame),
      }),
      createDiagnosticConnection(session.engine, {
        enabled: true,
        sessionId: SessionId('agent-route'),
        send: (frame) => withContent.push(frame),
      }),
    ] as const;
    await forwarders[0].handle(diagnosticsSubscription('agent-route'));
    await forwarders[1].handle(diagnosticsSubscription('agent-route', true));

    await session.send(
      utterance('input-1', UTTERANCE_SENTINEL, calendarChart()),
    );
    await waitUntil(() => uiChangesOf(session.received).length === 1);
    const [change] = uiChangesOf(session.received);
    if (change === undefined) throw new Error('no ui_change');

    expect(structural.length).toBeGreaterThan(0);
    for (const frame of structural) {
      for (const sentinel of [
        UTTERANCE_SENTINEL,
        REPLY_SENTINEL,
        ARGS_SENTINEL,
        RESULT_SENTINEL,
      ])
        expect(frame).not.toContain(sentinel);
    }
    const contentOf = (kind: string, turnIndex?: number) =>
      withContent
        .map((frame) => (JSON.parse(frame) as { event: DiagnosticEvent }).event)
        .find(
          (event) =>
            event.kind === kind &&
            (turnIndex === undefined || event.metadata.turnIndex === turnIndex),
        )?.content;
    expect(contentOf('engine.agent.turn.finished', 2)).toEqual({
      text: REPLY_SENTINEL,
    });
    expect(contentOf('engine.agent.tool.started')).toEqual({
      args: { orderNumber: ARGS_SENTINEL },
    });
    expect(contentOf('engine.agent.tool.completed')).toEqual({
      result: {
        ok: true,
        summary: 'Found the order',
        value: { orderId: 'o-1', note: RESULT_SENTINEL },
      },
    });
    expect(contentOf('engine.agent.ui_change.emitted')).toMatchObject({
      response: change.response,
    });
    for (const forwarder of forwarders) forwarder.dispose();
    session.connection.close();
  });

  test('without a diagnostic listener a run still sends its full wire sequence and metrics, and metadata observers get structural activity only', async () => {
    const model = scriptedTextAdapter([
      scriptedToolTurn(
        [
          {
            id: 'provider-call-1',
            name: 'find_order',
            args: { orderNumber: ARGS_SENTINEL },
          },
        ],
        scriptedUsage(1, 1),
      ),
      scriptedTextTurn([REPLY_SENTINEL], scriptedUsage(2, 3)),
    ]);
    const engine = createEngine({
      logger: silentLogger,
      retry: false,
      planner: keepScreenPlanner,
      agent: {
        model: model.adapter,
        instructions: 'You help pet shop customers.',
        tools: [findOrderTool({ withFacts: false })],
        budgets: TEST_BUDGETS,
      },
    });
    const observed: [string, Readonly<Record<string, unknown>>][] = [];
    engine.observeMetadata?.((kind, metadata) => {
      observed.push([kind, metadata]);
    });
    const received: AgentEvent[] = [];
    const connection = engine.openConnection({
      sessionId: SessionId('unobserved'),
      user: null,
    });
    connection.subscribe((event) => {
      received.push(event);
    });

    await connection.send(utterance('input-1', UTTERANCE_SENTINEL));

    expect(received.map((event) => event.type)).toEqual([
      'placeholder',
      'accepted',
      'started',
      'tool_call',
      'tool_result',
      'message',
      'finished',
    ]);
    expect(finishedOf(received).metrics).toMatchObject({
      turns: 2,
      toolCalls: 1,
      inputTokens: 3,
      outputTokens: 4,
    });
    expect(observed.map(([kind]) => kind)).toEqual(
      expect.arrayContaining([
        'engine.agent.run.started',
        'engine.agent.turn.started',
        'engine.agent.turn.finished',
        'engine.agent.tool.started',
        'engine.agent.tool.completed',
      ]),
    );
    expect(JSON.stringify(observed)).not.toContain(REPLY_SENTINEL);
    expect(JSON.stringify(observed)).not.toContain(ARGS_SENTINEL);
    expect(JSON.stringify(observed)).not.toContain(RESULT_SENTINEL);
    connection.close();
  });

  test('after cancelRun no turn or tool event is published for the run, even when its tool settles later', async () => {
    const release = defer<typeof LATEST_ORDER>();
    const session = openAgentSession({
      model: scriptedTextAdapter([
        scriptedToolTurn(
          [{ id: 'provider-call-1', name: 'latest_order', args: {} }],
          scriptedUsage(1, 1),
        ),
        scriptedTextTurn(['It was o-1.'], scriptedUsage(1, 1)),
      ]).adapter,
      tools: [orderTool({ latestOrder: () => release.promise }).tool],
    });

    const sent = session.send(utterance('input-1', 'show me my last order'));
    await waitUntil(() =>
      session.diagnostics.some(
        (event) => event.kind === 'engine.agent.tool.started',
      ),
    );
    const runId = runIdOf(session.received, 'input-1');
    const cancelledAt = session.diagnostics.length;
    session.internals().queue.cancelRun(runId);
    await sent;
    release.resolve(LATEST_ORDER);
    await settle();

    expect(finishedOf(session.received).reason).toBe('cancelled');
    expect(activityKindsOf(session.diagnostics.slice(cancelledAt))).toEqual([]);
    session.connection.close();
  });

  test('after close no turn or tool event is published for the active run, even when its tool settles later', async () => {
    const release = defer<typeof LATEST_ORDER>();
    const session = openAgentSession({
      model: scriptedTextAdapter([
        scriptedToolTurn(
          [{ id: 'provider-call-1', name: 'latest_order', args: {} }],
          scriptedUsage(1, 1),
        ),
        scriptedTextTurn(['It was o-1.'], scriptedUsage(1, 1)),
      ]).adapter,
      tools: [orderTool({ latestOrder: () => release.promise }).tool],
    });

    const sent = session.send(utterance('input-1', 'show me my last order'));
    await waitUntil(() =>
      session.diagnostics.some(
        (event) => event.kind === 'engine.agent.tool.started',
      ),
    );
    const closedAt = session.diagnostics.length;
    session.connection.close();
    await sent;
    release.resolve(LATEST_ORDER);
    await settle();

    expect(activityKindsOf(session.diagnostics.slice(closedAt))).toEqual([]);
  });

  test('a queued run cancelled before it starts reports no run.started', async () => {
    const session = openAgentSession({
      model: scriptedTextAdapter([heldTurn()]).adapter,
    });
    const first = session.send(utterance('input-1', 'hello'));
    const second = session.send(utterance('input-2', 'and then?'));
    await waitUntil(() =>
      session.diagnostics.some(
        (event) => event.kind === 'engine.agent.run.started',
      ),
    );
    const secondRun = runIdOf(session.received, 'input-2');

    session.internals().queue.cancelRun(secondRun);
    await second;

    const kindsOfSecond = session.diagnostics
      .filter((event) => event.runId === secondRun)
      .map((event) => event.kind);
    expect(kindsOfSecond).toEqual([
      'engine.agent.input.accepted',
      'engine.agent.run.finished',
    ]);
    expect(
      session.diagnostics.filter(
        (event) => event.kind === 'engine.agent.run.started',
      ),
    ).toHaveLength(1);
    session.connection.close();
    await first;
  });
});

const UTTERANCE_SENTINEL = 'utterance-sentinel-31';
const REPLY_SENTINEL = 'reply-sentinel-47';
const ARGS_SENTINEL = 'args-sentinel-55';
const RESULT_SENTINEL = 'result-sentinel-82';

const RUN_LIFECYCLE_KINDS = new Set([
  'engine.agent.input.accepted',
  'engine.agent.run.started',
  'engine.agent.turn.started',
  'engine.agent.turn.finished',
  'engine.agent.tool.started',
  'engine.agent.tool.completed',
  'engine.agent.run.finished',
]);

const keepScreenPlanner: ClarifyingPlanner = (input) =>
  Promise.resolve(
    ok({
      type: 'plan',
      userMessage: 'Kept.',
      rationale: 'Keep the screen.',
      executionPlan: [],
      layout: tilingLayoutOf(input.request),
    }),
  );

function openUiOnlySession(planningMs = 0) {
  const received: AgentEvent[] = [];
  const diagnostics: DiagnosticEvent[] = [];
  let now = 0;
  const engine = createEngine({
    logger: silentLogger,
    retry: false,
    planner: (input, ctx) => {
      now += planningMs;
      return keepScreenPlanner(input, ctx);
    },
  });
  engine.observeDiagnostics?.((event) => {
    diagnostics.push(event);
  });
  const connection = engine.openConnection({
    sessionId: SessionId('ui-only'),
    user: null,
    clock: () => now,
  });
  connection.subscribe((event) => {
    received.push(event);
  });
  return { connection, received, diagnostics };
}

function findOrderTool({ withFacts = true }: { withFacts?: boolean } = {}) {
  return serverTool({
    name: 'find_order',
    description: 'Finds an order by its number',
    input: z.object({ orderNumber: z.string() }),
    output: z.object({ orderId: z.string(), note: z.string() }),
    sideEffect: 'read_only',
    execute: () => Promise.resolve({ orderId: 'o-1', note: RESULT_SENTINEL }),
    summarize: () => 'Found the order',
    ...(withFacts
      ? {
          intentFacts: (order: { orderId: string }) => ({
            orderId: order.orderId,
          }),
        }
      : {}),
  });
}

type EndingReason = 'completed' | 'budget' | 'error' | 'cancelled';

function endingScenario(
  reason: EndingReason,
  advance: (ms: number) => void,
): Parameters<typeof openAgentSession>[0] {
  switch (reason) {
    case 'completed':
      return {
        model: scriptedTextAdapter([advancingTurn(advance, 120, ['Hello.'])])
          .adapter,
      };
    case 'budget':
      return {
        model: scriptedTextAdapter([
          scriptedToolTurn(
            [{ id: 'provider-call-1', name: 'latest_order', args: {} }],
            scriptedUsage(2, 1),
          ),
        ]).adapter,
        tools: [orderTool().tool],
        budgets: { maxTurns: 1 },
      };
    case 'error':
      return {
        model: scriptedTextAdapter([scriptedFailingTurn(['Part'], 'boom')])
          .adapter,
      };
    case 'cancelled':
      return { model: scriptedTextAdapter([heldTurn()]).adapter };
  }
}

function runLifecycleOf(events: readonly DiagnosticEvent[]) {
  return events
    .filter((event) => RUN_LIFECYCLE_KINDS.has(event.kind))
    .map((event) => [event.kind, event.metadata]);
}

function toolEventsOf(events: readonly DiagnosticEvent[]) {
  return events
    .filter((event) => event.kind.startsWith('engine.agent.tool.'))
    .map((event) => [event.kind, event.metadata] as const);
}

function activityKindsOf(events: readonly DiagnosticEvent[]): string[] {
  return events
    .map((event) => event.kind)
    .filter(
      (kind) =>
        kind.startsWith('engine.agent.turn.') ||
        kind.startsWith('engine.agent.tool.'),
    );
}

function sessionEventsOfKind(
  events: readonly DiagnosticEvent[],
  kind: string,
): DiagnosticEvent[] {
  const matching = events.filter((event) => event.kind === kind);
  for (const event of matching) {
    expect(event).not.toHaveProperty('runId');
    expect(event).not.toHaveProperty('requestId');
  }
  return matching;
}

function runFinishedOf(events: readonly DiagnosticEvent[], runId: RunId) {
  const finished = events.find(
    (event) =>
      event.kind === 'engine.agent.run.finished' && event.runId === runId,
  );
  if (finished === undefined)
    throw new Error(`no engine.agent.run.finished for ${runId}`);
  return finished.metadata;
}

function finishedOf(events: readonly AgentEvent[]): AgentFinishedEvent {
  const finished = events.filter(
    (event): event is AgentFinishedEvent => event.type === 'finished',
  );
  const last = finished.at(-1);
  if (last === undefined) throw new Error('no finished event');
  return last;
}

function heldTurn(): ScriptedModelCall {
  return async function* (): AsyncGenerator<StreamChunk> {
    yield {
      type: EventType.RUN_STARTED,
      runId: 'provider-run',
      threadId: 'provider-thread',
      timestamp: 0,
    };
    await new Promise<never>(() => {});
  };
}

function advancingTurn(
  advance: (ms: number) => void,
  ms: number,
  deltas: readonly string[],
): ScriptedModelCall {
  const turn = scriptedTextTurn(deltas, scriptedUsage(2, 1));
  return async function* (request) {
    advance(ms);
    yield* turn(request);
  };
}

function diagnosticsSubscription(sessionId: string, includeContent = false) {
  return {
    type: 'client.diagnostics.subscribe',
    id: MessageId(),
    sessionId: SessionId(sessionId),
    enabled: true,
    includeContent,
  };
}

function strayAcknowledgement() {
  return {
    type: 'ui_applied',
    version: AGENT_WIRE_VERSION,
    changeId: ChangeId('stray-change'),
    chart: makeTilingRequest(),
    actionOutcomes: [],
  } as const;
}

function strayRefusal(): AgentEvent {
  return {
    type: 'error',
    version: AGENT_WIRE_VERSION,
    changeId: ChangeId('stray-change'),
    code: 'unknown_change',
    error: 'Unknown UI change.',
  };
}
