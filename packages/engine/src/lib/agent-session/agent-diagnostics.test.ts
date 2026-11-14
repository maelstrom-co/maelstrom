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

import {
  type ClarifyingPlanner,
  createDiagnosticConnection,
  createEngine,
} from '../../index.js';
import {
  makeTilingRequest,
  silentLogger,
} from '../__test-helpers__/fixtures.js';
import {
  capturingAgentRunQueueModule,
  capturingPlannerShowQueueModule,
  openAgentSession,
  TEST_BUDGETS,
  tilingLayoutOf,
  utterance,
} from './__test-helpers__/agent-session-harness.js';
import { createFakeAgentRunTime } from './__test-helpers__/fake-agent-run-time.js';
import {
  type ScriptedModelCall,
  scriptedTextAdapter,
  scriptedTextTurn,
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
});

describe('session-level acknowledgement diagnostics', () => {
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

  test('on a UI-only connection a ui_applied with the wrong outcome count yields a session-owned ui_applied.rejected', async () => {
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

    expect(
      sessionEventsOfKind(
        session.diagnostics,
        'engine.agent.ui_applied.rejected',
      ).map((event) => event.metadata),
    ).toEqual([{ changeId: change.changeId, code: 'invalid_action_outcomes' }]);
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

function diagnosticsSubscription(sessionId: string) {
  return {
    type: 'client.diagnostics.subscribe',
    id: MessageId(),
    sessionId: SessionId(sessionId),
    enabled: true,
    includeContent: false,
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
