import { describe, expect, mock, test } from 'bun:test';

import {
  ActionName,
  AGENT_WIRE_VERSION,
  type AgentEvent,
  AgentEventSchema,
  type AgentUiChangeEvent,
  type AgentUtteranceInput,
  CallId,
  ChangeId,
  type ChartRequest,
  ChartRequestMessage,
  type DiagnosticEvent,
  InstanceId,
  isErr,
  type JsonValue,
  MessageId,
  ok,
  RunId,
  SessionId,
  VariantName,
} from '@maelstrom-co/protocol';
import { EventType, type StreamChunk } from '@tanstack/ai';
import { z } from 'zod';

import {
  type ClarifyingPlanner,
  createEngine,
  type PlanningInput,
  serverTool,
  ToolError,
} from '../../index.js';
import { defer } from '../__test-helpers__/defer.js';
import {
  makeTilingRequest,
  silentLogger,
  threeViewCalendarVessel,
} from '../__test-helpers__/fixtures.js';
import {
  blockingPlanner,
  failingPlanner,
  scriptedPlanner,
  throwingPlanner,
} from '../__test-helpers__/stub-planner.js';
import { providerError } from '../errors.js';
import type { PlannerCandidate } from '../planner/candidate.js';
import { named } from '../planner/instrument.js';
import { pipeline } from '../planner/pipeline.js';
import {
  createFakeAgentRunTime,
  type FakeAgentRunTime,
} from './__test-helpers__/fake-agent-run-time.js';
import {
  type ScriptedModelCall,
  scriptedFailingTurn,
  scriptedTextAdapter,
  scriptedTextTurn,
  scriptedToolTurn,
  scriptedUsage,
} from './__test-helpers__/scripted-text-adapter.js';
import {
  type AgentConfig,
  type AgentModelFactory,
  resolveAgentConfig,
} from './agent-config.js';
import { NOT_RUN_TOOL_SUMMARY } from './agent-run-policy.js';
import * as agentRunQueueModule from './agent-run-queue.js';
import type { AgentRunQueue, AgentRunQueueOptions } from './agent-run-queue.js';
import { type AgentRunBudgets, BUDGET_CLOSING_MESSAGE } from './agent-run.js';
import type { ShowPlanner } from './planner-show-queue.js';
import {
  createToolResultStore,
  type ToolResultStore,
} from './tool-result-store.js';
import {
  createTranscript,
  toolCallRef,
  type Transcript,
} from './transcript.js';

const USER_SENTINEL = 'user-sentinel-7f3a';
const TOKEN_SENTINEL = 'token-sentinel-91c2';
const PLANNER_PROSE_SENTINEL = 'PLANNER PROSE SENTINEL';

const LATEST_ORDER = {
  orderId: 'o-1',
  total: 42,
  items: ['squeaky bone', 'catnip mouse'],
};

const TEST_BUDGETS: AgentRunBudgets = {
  maxTurns: 6,
  maxElapsedMs: 60_000,
  maxTokens: 10_000,
  maxToolCalls: 6,
};

const realCreateAgentRunQueue = agentRunQueueModule.createAgentRunQueue;
const sessionInternals: SessionInternals[] = [];

void mock.module('./agent-run-queue.js', () => ({
  ...agentRunQueueModule,
  createAgentRunQueue: (options: AgentRunQueueOptions): AgentRunQueue => {
    const transcript = options.transcript ?? createTranscript();
    const toolResults = options.toolResults ?? createToolResultStore();
    const queue = realCreateAgentRunQueue({
      ...options,
      transcript,
      toolResults,
    });
    sessionInternals.push({
      queue,
      transcript,
      toolResults,
      planShow: options.planShow,
    });
    return queue;
  },
}));

describe('agent route through the Engine handle', () => {
  describe('a single utterance', () => {
    test('streams its opening, tool breadcrumbs and reply in wire order, each decodable, with no internal events', async () => {
      const order = orderTool();
      const model = scriptedTextAdapter([
        scriptedToolTurn(
          [{ id: 'c1', name: 'latest_order', args: {} }],
          scriptedUsage(10, 2),
        ),
        scriptedTextTurn(['Your last order ', 'was o-1.'], scriptedUsage(4, 1)),
      ]);
      const session = openAgentSession({
        model: model.adapter,
        tools: [order.tool],
      });

      await session.send(utterance('input-1', 'what was my last order?'));

      const runId = runIdOf(session.received, 'input-1');
      expect(session.received.map((event) => event.type)).toEqual([
        'placeholder',
        'accepted',
        'started',
        'tool_call',
        'tool_result',
        'message',
        'message',
        'finished',
      ]);
      expect(session.received[1]).toMatchObject({
        type: 'accepted',
        disposition: 'agent',
        runId,
      });
      expect(runId).not.toBeNull();
      expect(session.received[3]).toEqual({
        type: 'tool_call',
        version: AGENT_WIRE_VERSION,
        runId,
        turnId: `${runId}:t1`,
        callId: CallId('c1'),
        name: 'latest_order',
      });
      expect(session.received[3]).not.toHaveProperty('args');
      expect(session.received[4]).toEqual({
        type: 'tool_result',
        version: AGENT_WIRE_VERSION,
        runId,
        turnId: `${runId}:t1`,
        callId: CallId('c1'),
        name: 'latest_order',
        ok: true,
        summary: 'Order o-1 for 42',
      });
      expect(lastFinished(session.received)).toMatchObject({
        runId,
        reason: 'completed',
        ok: true,
        reply: 'Your last order was o-1.',
      });
      for (const event of session.received) {
        expect(AgentEventSchema.safeParse(event).success).toBe(true);
      }
      expect(JSON.stringify(session.received)).not.toContain(
        'tool_phase_ended',
      );
      expect(session.plannerCalls()).toBe(1);
    });

    test('identity reaches the tool context exactly and never a model request, tool arguments, the wire or the transcript', async () => {
      const order = orderTool();
      const model = scriptedTextAdapter([
        scriptedToolTurn(
          [{ id: 'c1', name: 'latest_order', args: {} }],
          scriptedUsage(1, 1),
        ),
        scriptedTextTurn(['Done.'], scriptedUsage(1, 1)),
      ]);
      const session = openAgentSession({
        model: model.adapter,
        tools: [order.tool],
      });

      await session.send(utterance('input-1', 'last order?'));

      expect(order.contexts).toHaveLength(1);
      expect(order.contexts[0]?.user).toBe(session.user);
      expect(order.contexts[0]?.token).toBe(TOKEN_SENTINEL);
      const surfaces = [
        ...model.requests.map(serializeLoosely),
        JSON.stringify(order.args),
        JSON.stringify(session.received),
        JSON.stringify(session.internals().transcript.renderPriorMessages()),
      ];
      for (const surface of surfaces) {
        expect(surface).not.toContain(USER_SENTINEL);
        expect(surface).not.toContain(TOKEN_SENTINEL);
      }
    });
  });

  describe('loop-driven shows', () => {
    test('a tool phase with a successful result plans one replyless show and sends its change with the run id', async () => {
      const time = createFakeAgentRunTime();
      const order = orderTool({ intentFacts: orderFacts });
      const model = scriptedTextAdapter([
        scriptedToolTurn(
          [{ id: 'c1', name: 'latest_order', args: {} }],
          scriptedUsage(1, 1),
        ),
        scriptedTextTurn(['It was o-1.'], scriptedUsage(1, 1)),
      ]);
      const session = openAgentSession({
        time,
        model: model.adapter,
        tools: [order.tool],
        planner: addEventPlanner,
      });

      await session.send(
        utterance('input-1', 'show me my last order', calendarChart()),
      );
      await waitUntil(() =>
        session.received.some((event) => event.type === 'ui_change'),
      );

      const runId = runIdOf(session.received, 'input-1');
      expect(session.plannerCalls()).toBe(1);
      const plannerInput = session.plannerInputs()[0];
      expect(plannerInput?.sessionId).toBe(SessionId('agent-route'));
      expect(plannerInput?.history).toEqual([]);
      expect(plannerInput?.messageId).not.toBe(MessageId('input-1'));
      const planned = plannerInput?.request;
      expect(planned?.skipReply).toBe(true);
      expect(planned?.intentFacts).toEqual({
        'latest_order:c1': orderFacts(LATEST_ORDER),
      });
      expect(planned?.context.updateReasons).toEqual([
        { type: 'user_intent', intent: 'show me my last order' },
      ]);
      const change = session.received.find(
        (event) => event.type === 'ui_change',
      );
      expect(change).toMatchObject({ type: 'ui_change', runId });
      if (change?.type !== 'ui_change') throw new Error('no ui_change');
      expect(change.changeId.length).toBeGreaterThan(0);
      expect(AgentEventSchema.safeParse(change).success).toBe(true);
    });

    test('one tool phase with two calls plans one show whose facts hold both calls in call order', async () => {
      const orders = [LATEST_ORDER, { ...LATEST_ORDER, orderId: 'o-2' }];
      let served = 0;
      const order = orderTool({
        intentFacts: orderFacts,
        latestOrder: () => {
          const next = orders[served];
          served += 1;
          if (next === undefined) throw new Error('only two orders scripted');
          return Promise.resolve(next);
        },
      });
      const model = scriptedTextAdapter([
        scriptedToolTurn(
          [
            { id: 'c1', name: 'latest_order', args: {} },
            { id: 'c2', name: 'latest_order', args: {} },
          ],
          scriptedUsage(1, 1),
        ),
        scriptedTextTurn(['Two orders.'], scriptedUsage(1, 1)),
      ]);
      const session = openAgentSession({
        model: model.adapter,
        tools: [order.tool],
        planner: addEventPlanner,
      });

      await session.send(
        utterance('input-1', 'show my last two orders', calendarChart()),
      );
      await waitUntil(() => uiChangesOf(session.received).length === 1);

      expect(session.plannerCalls()).toBe(1);
      const facts = session.plannerInputs()[0]?.request.intentFacts ?? {};
      expect(Object.keys(facts)).toEqual([
        'latest_order:c1',
        'latest_order:c2',
      ]);
      expect(facts).toEqual({
        'latest_order:c1': orderFacts(LATEST_ORDER),
        'latest_order:c2': orderFacts({ ...LATEST_ORDER, orderId: 'o-2' }),
      });
    });

    test('a second show waits for the first change to be acknowledged and plans on the acknowledged Chart', async () => {
      const time = createFakeAgentRunTime();
      const gate = defer<PlannerCandidate>();
      const firstShow = blockingPlanner(gate);
      let plannerCall = 0;
      const model = scriptedTextAdapter([
        scriptedToolTurn(
          [{ id: 'c1', name: 'latest_order', args: {} }],
          scriptedUsage(1, 1),
        ),
        scriptedToolTurn(
          [{ id: 'c2', name: 'latest_order', args: {} }],
          scriptedUsage(1, 1),
        ),
        scriptedTextTurn(['Both shown.'], scriptedUsage(1, 1)),
      ]);
      const session = openAgentSession({
        time,
        model: model.adapter,
        tools: [orderTool({ intentFacts: orderFacts }).tool],
        planner: (input, ctx) => {
          plannerCall += 1;
          return plannerCall === 1
            ? firstShow.planner(input, ctx)
            : addEventPlanner(input, ctx);
        },
      });

      await session.send(
        utterance('input-1', 'show my orders twice', calendarChart()),
      );
      await firstShow.entered;
      const runId = runIdOf(session.received, 'input-1');
      expect(lastFinished(session.received)).toMatchObject({
        runId,
        reason: 'completed',
      });
      expect(session.plannerCalls()).toBe(1);

      gate.resolve(addEventCandidate(calendarChart()));
      await waitUntil(() => uiChangesOf(session.received).length === 1);
      await settle();
      expect(session.plannerCalls()).toBe(1);

      const [firstChange] = uiChangesOf(session.received);
      if (firstChange === undefined) throw new Error('no ui_change');
      const acknowledged = weekCalendarChart();
      await session.connection.send(
        acknowledgementOf(firstChange, acknowledged),
      );
      await waitUntil(() => uiChangesOf(session.received).length === 2);

      expect(session.plannerCalls()).toBe(2);
      const second = session.plannerInputs()[1]?.request;
      expect(second?.instances).toEqual(acknowledged.instances);
      expect(second?.layout).toEqual(acknowledged.layout);
      expect(second?.intentFacts).toEqual({
        'latest_order:c2': orderFacts(LATEST_ORDER),
      });
      expect(uiChangesOf(session.received)[1]).toMatchObject({ runId });
      expect(session.received.map(typeOf)).not.toContain('error');
    });

    test('the run reaches its next model turn and finishes while its change still awaits acknowledgement', async () => {
      const releaseSecondTurn = defer<void>();
      const model = scriptedTextAdapter([
        scriptedToolTurn(
          [{ id: 'c1', name: 'latest_order', args: {} }],
          scriptedUsage(1, 1),
        ),
        async function* (request) {
          await releaseSecondTurn.promise;
          yield* scriptedTextTurn(
            ['It was o-1.'],
            scriptedUsage(1, 1),
          )(request);
        },
      ]);
      const session = openAgentSession({
        model: model.adapter,
        tools: [orderTool({ intentFacts: orderFacts }).tool],
        planner: addEventPlanner,
      });

      const sent = session.send(
        utterance('input-1', 'show me my last order', calendarChart()),
      );
      await waitUntil(
        () =>
          uiChangesOf(session.received).length === 1 &&
          model.requests.length === 2,
      );
      const runId = runIdOf(session.received, 'input-1');
      expect(session.received.map(typeOf)).not.toContain('finished');
      releaseSecondTurn.resolve();
      await sent;
      await waitUntil(() => session.received.map(typeOf).includes('finished'));

      expect(indexOf(session.received, 'ui_change', runId)).toBeLessThan(
        indexOf(session.received, 'finished', runId),
      );
      expect(lastFinished(session.received)).toMatchObject({
        runId,
        reason: 'completed',
        ok: true,
        reply: 'It was o-1.',
      });
      const [change] = uiChangesOf(session.received);
      if (change === undefined) throw new Error('no ui_change');
      const beforeAcknowledgement = session.received.length;
      await session.connection.send(acknowledgementOf(change, calendarChart()));
      expect(session.received.slice(beforeAcknowledgement)).toEqual([]);
      expect(
        serializeLoosely(session.internals().transcript.renderPriorMessages()),
      ).toContain(`[show ${runId}:t1] Screen updated:`);
    });

    test('an acknowledged change leaves a queued note and a screen note that the next run prompt includes', async () => {
      const model = scriptedTextAdapter([
        scriptedToolTurn(
          [{ id: 'c1', name: 'latest_order', args: {} }],
          scriptedUsage(1, 1),
        ),
        scriptedTextTurn(['It was o-1.'], scriptedUsage(1, 1)),
        scriptedTextTurn(['It is on your calendar.'], scriptedUsage(1, 1)),
      ]);
      const session = openAgentSession({
        model: model.adapter,
        tools: [orderTool({ intentFacts: orderFacts }).tool],
        planner: addEventPlanner,
      });

      await session.send(
        utterance('input-1', 'show me my last order', calendarChart()),
      );
      await waitUntil(() => uiChangesOf(session.received).length === 1);
      const [change] = uiChangesOf(session.received);
      if (change === undefined) throw new Error('no ui_change');
      await session.connection.send(acknowledgementOf(change, calendarChart()));

      const runId = runIdOf(session.received, 'input-1');
      const queuedNote = `[show ${runId}:t1] Show queued: latest_order result.`;
      const screenNote = `[show ${runId}:t1] Screen updated: ran addEvent on calendar → month. Visible: calendar (month).`;
      const transcript = serializeLoosely(
        session.internals().transcript.renderPriorMessages(),
      );
      expect(transcript).toContain(queuedNote);
      expect(transcript).toContain(screenNote);

      await session.send(
        utterance('input-2', 'where is it now?', calendarChart()),
      );

      const nextPrompt = serializeLoosely(model.requests[2]?.messages);
      expect(nextPrompt).toContain(queuedNote);
      expect(nextPrompt).toContain(screenNote);
      expect(nextPrompt.indexOf(queuedNote)).toBeLessThan(
        nextPrompt.indexOf(screenNote),
      );
    });

    test('planner prose on a replyless show never reaches the wire, the transcript or a later prompt', async () => {
      const model = scriptedTextAdapter([
        scriptedToolTurn(
          [{ id: 'c1', name: 'latest_order', args: {} }],
          scriptedUsage(1, 1),
        ),
        scriptedTextTurn(['It was o-1.'], scriptedUsage(1, 1)),
        scriptedTextTurn(['Anything else?'], scriptedUsage(1, 1)),
      ]);
      const session = openAgentSession({
        model: model.adapter,
        tools: [orderTool({ intentFacts: orderFacts }).tool],
        planner: scriptedPlanner([
          {
            ...addEventCandidate(calendarChart()),
            userMessage: PLANNER_PROSE_SENTINEL,
          },
        ]),
      });

      await session.send(
        utterance('input-1', 'show me my last order', calendarChart()),
      );
      await waitUntil(() => uiChangesOf(session.received).length === 1);
      const [change] = uiChangesOf(session.received);
      if (change === undefined) throw new Error('no ui_change');
      await session.connection.send(acknowledgementOf(change, calendarChart()));
      await session.send(
        utterance('input-2', 'anything else?', calendarChart()),
      );

      expect(session.plannerCalls()).toBe(1);
      expect(change.response).not.toHaveProperty('userMessage');
      expect(change.response).not.toHaveProperty('diagnostics');
      expect(change.response.executionPlan).toHaveLength(1);
      const messages = session.received.filter(
        (event) => event.type === 'message',
      );
      expect(messages.length).toBeGreaterThan(0);
      for (const message of messages) {
        expect(JSON.stringify(message)).not.toContain(PLANNER_PROSE_SENTINEL);
      }
      const surfaces = [
        JSON.stringify(session.received),
        serializeLoosely(session.internals().transcript.renderPriorMessages()),
        ...model.requests.map(serializeLoosely),
      ];
      for (const surface of surfaces) {
        expect(surface).not.toContain(PLANNER_PROSE_SENTINEL);
      }
      expect(model.requests).toHaveLength(3);
    });

    test('show diagnostics carry the run owner and change id while the intent and screen note stay behind readContent', async () => {
      const intent = 'show me my last order';
      const model = scriptedTextAdapter([
        scriptedToolTurn(
          [{ id: 'c1', name: 'latest_order', args: {} }],
          scriptedUsage(1, 1),
        ),
        scriptedTextTurn(['It was o-1.'], scriptedUsage(1, 1)),
      ]);
      const session = openAgentSession({
        model: model.adapter,
        tools: [orderTool({ intentFacts: orderFacts }).tool],
        planner: pipeline(named('arrange', addEventPlanner)),
      });

      await session.send(utterance('input-1', intent, calendarChart()));
      await waitUntil(() => uiChangesOf(session.received).length === 1);
      const [change] = uiChangesOf(session.received);
      if (change === undefined) throw new Error('no ui_change');
      await session.connection.send(acknowledgementOf(change, calendarChart()));

      const runId = runIdOf(session.received, 'input-1');
      for (const kind of [
        'engine.planner.started',
        'engine.planner.completed',
        'engine.stage.started',
        'engine.stage.completed',
        'engine.candidate.validated',
        'engine.validation.completed',
      ]) {
        for (const event of diagnosticsOfKind(session.diagnostics, kind)) {
          expect(event.runId).toBe(runId);
          expect(event.requestId).toBeUndefined();
          expect(event.metadata.inputId).toBe('input-1');
          expect(event.metadata.turnId).toBe(`${runId}:t1`);
        }
      }
      const [emitted] = diagnosticsOfKind(
        session.diagnostics,
        'engine.agent.ui_change.emitted',
      );
      const [applied] = diagnosticsOfKind(
        session.diagnostics,
        'engine.agent.ui_change.applied',
      );
      if (emitted === undefined || applied === undefined)
        throw new Error('the change was not observed');
      for (const event of [emitted, applied]) {
        expect(event.runId).toBe(runId);
        expect(event.metadata.changeId).toBe(change.changeId);
      }
      const screenNote =
        'Screen updated: ran addEvent on calendar → month. Visible: calendar (month).';
      for (const event of session.diagnostics) {
        for (const value of Object.values(event.metadata)) {
          expect(String(value)).not.toContain(intent);
          expect(String(value)).not.toContain('Screen updated');
        }
      }
      const [plannerStarted] = diagnosticsOfKind(
        session.diagnostics,
        'engine.planner.started',
      );
      if (plannerStarted === undefined) throw new Error('no planner call');
      expect(serializeLoosely(session.readContentOf(plannerStarted))).toContain(
        intent,
      );
      expect(session.readContentOf(emitted)).toMatchObject({
        intent,
        intentFacts: { 'latest_order:c1': orderFacts(LATEST_ORDER) },
      });
      expect(session.readContentOf(applied)).toMatchObject({ screenNote });
    });

    test('a tool phase whose only result failed makes no Planner call and writes no note', async () => {
      const order = orderTool({
        intentFacts: orderFacts,
        latestOrder: () => Promise.reject(new ToolError('No orders yet.')),
      });
      const model = scriptedTextAdapter([
        scriptedToolTurn(
          [{ id: 'c1', name: 'latest_order', args: {} }],
          scriptedUsage(1, 1),
        ),
        scriptedTextTurn(['You have no orders yet.'], scriptedUsage(1, 1)),
      ]);
      const session = openAgentSession({
        model: model.adapter,
        tools: [order.tool],
        planner: addEventPlanner,
      });

      await session.send(
        utterance('input-1', 'show me my last order', calendarChart()),
      );
      await settle();

      expect(lastFinished(session.received)).toMatchObject({
        reason: 'completed',
      });
      expect(session.plannerCalls()).toBe(0);
      expect(uiChangesOf(session.received)).toEqual([]);
      expect(
        serializeLoosely(session.internals().transcript.renderPriorMessages()),
      ).not.toContain('[show ');
    });

    test('an unknown change id and a wrong outcome count are refused while the change stays pending until a valid acknowledgement', async () => {
      const session = openAgentSession({
        model: twoShowTurns().adapter,
        tools: [orderTool({ intentFacts: orderFacts }).tool],
        planner: addEventPlanner,
      });

      await session.send(
        utterance('input-1', 'show my orders twice', calendarChart()),
      );
      await waitUntil(() => uiChangesOf(session.received).length === 1);
      const [firstChange] = uiChangesOf(session.received);
      if (firstChange === undefined) throw new Error('no ui_change');

      const beforeStray = session.received.length;
      await session.connection.send(strayAcknowledgement());
      expect(session.received.slice(beforeStray)).toEqual([
        strayAcknowledgementRefusal(),
      ]);

      const beforeWrongCount = session.received.length;
      await session.connection.send({
        ...acknowledgementOf(firstChange, calendarChart()),
        actionOutcomes: [],
      });
      expect(session.received.slice(beforeWrongCount)).toEqual([
        {
          type: 'error',
          version: AGENT_WIRE_VERSION,
          changeId: firstChange.changeId,
          code: 'invalid_action_outcomes',
          error: 'Expected one outcome per Action.',
        },
      ]);
      await settle();
      expect(session.plannerCalls()).toBe(1);
      expect(
        serializeLoosely(session.internals().transcript.renderPriorMessages()),
      ).not.toContain('Screen updated');

      await session.connection.send(
        acknowledgementOf(firstChange, calendarChart()),
      );
      await waitUntil(() => uiChangesOf(session.received).length === 2);

      expect(session.plannerCalls()).toBe(2);
      expect(
        serializeLoosely(session.internals().transcript.renderPriorMessages()),
      ).toContain('Screen updated: ran addEvent on calendar → month.');
    });

    test('an acknowledgement sent synchronously from inside the ui_change listener is accepted', async () => {
      const session = openAgentSession({
        model: twoShowTurns().adapter,
        tools: [orderTool({ intentFacts: orderFacts }).tool],
        planner: addEventPlanner,
      });
      const acknowledged = weekCalendarChart();
      let acknowledgedInListener = false;
      session.connection.subscribe((event) => {
        if (event.type !== 'ui_change' || acknowledgedInListener) return;
        acknowledgedInListener = true;
        void session.connection.send(acknowledgementOf(event, acknowledged));
      });

      await session.send(
        utterance('input-1', 'show my orders twice', calendarChart()),
      );
      await waitUntil(() => uiChangesOf(session.received).length === 2);

      expect(acknowledgedInListener).toBe(true);
      expect(session.received.map(typeOf)).not.toContain('error');
      expect(session.plannerInputs()[1]?.request.instances).toEqual(
        acknowledged.instances,
      );
      const runId = runIdOf(session.received, 'input-1');
      expect(
        serializeLoosely(session.internals().transcript.renderPriorMessages()),
      ).toContain(
        `[show ${runId}:t1] Screen updated: ran addEvent on calendar → week. Visible: calendar (week).`,
      );
    });

    test('an acknowledgement timeout starts the next queued show on the last known Chart', async () => {
      const time = createFakeAgentRunTime();
      const session = openAgentSession({
        time,
        acknowledgementTimeoutMs: 5_000,
        model: twoShowTurns().adapter,
        tools: [orderTool({ intentFacts: orderFacts }).tool],
        planner: scriptedPlanner([
          addEventCandidate(weekCalendarChart()),
          addEventCandidate(calendarChart()),
        ]),
      });

      await session.send(
        utterance('input-1', 'show my orders twice', calendarChart()),
      );
      await waitUntil(() => uiChangesOf(session.received).length === 1);
      await settle();
      const [firstChange] = uiChangesOf(session.received);
      expect(firstChange?.response.layout).toEqual(weekCalendarChart().layout);
      time.advance(4_999);
      await settle();
      expect(session.plannerCalls()).toBe(1);

      time.advance(1);
      await waitUntil(() => uiChangesOf(session.received).length === 2);

      expect(session.plannerCalls()).toBe(2);
      const second = session.plannerInputs()[1]?.request;
      expect(second?.layout).toEqual(calendarChart().layout);
      expect(second?.instances).toEqual(calendarChart().instances);
      expect(second?.intentFacts).toEqual({
        'latest_order:c2': orderFacts(LATEST_ORDER),
      });
      expect(session.received.map(typeOf)).not.toContain('error');
    });

    test.each([
      [
        'a failing planner',
        failingPlanner(providerError('provider down', undefined)),
      ],
      ['a throwing planner', throwingPlanner(new Error('planner crashed'))],
      ['a needs-clarification result', clarifyingPlanner],
      ['an empty plan with nothing to show', nothingToShowPlanner],
    ] as const)(
      '%s releases the queue for the next show and sends no ui_change',
      async (_case, firstShow: ClarifyingPlanner) => {
        const release = defer<void>();
        const session = openAgentSession({
          model: twoShowTurns().adapter,
          tools: [orderTool({ intentFacts: orderFacts }).tool],
          planner: plannersInOrder([
            heldUntil(release.promise, firstShow),
            addEventPlanner,
          ]),
        });

        await session.send(
          utterance('input-1', 'show my orders twice', calendarChart()),
        );
        await settle();
        expect(session.plannerCalls()).toBe(1);
        release.resolve();
        await waitUntil(() => uiChangesOf(session.received).length === 1);
        await settle();

        expect(session.plannerCalls()).toBe(2);
        expect(session.plannerInputs()[1]?.request.intentFacts).toEqual({
          'latest_order:c2': orderFacts(LATEST_ORDER),
        });
        const changes = uiChangesOf(session.received);
        expect(changes).toHaveLength(1);
        expect(changes[0]?.response.executionPlan).toHaveLength(1);
        const runId = runIdOf(session.received, 'input-1');
        const firstShowPlanning = session.diagnostics.filter(
          (event) =>
            event.kind.startsWith('engine.planner.') &&
            event.metadata.turnId === `${runId}:t1`,
        );
        expect(firstShowPlanning.map((event) => event.kind)).toEqual(
          expect.arrayContaining([
            'engine.planner.started',
            'engine.planner.completed',
          ]),
        );
        for (const event of firstShowPlanning) {
          expect(event.runId).toBe(runId);
          expect(event.requestId).toBeUndefined();
          expect(event.metadata.inputId).toBe('input-1');
        }
      },
    );

    test('closing the connection aborts a show plan in flight and sends no ui_change for it', async () => {
      const gate = defer<PlannerCandidate>();
      const blocking = blockingPlanner(gate);
      const signals: (AbortSignal | undefined)[] = [];
      const session = openAgentSession({
        model: scriptedTextAdapter([
          scriptedToolTurn(
            [{ id: 'c1', name: 'latest_order', args: {} }],
            scriptedUsage(1, 1),
          ),
          scriptedTextTurn(['It was o-1.'], scriptedUsage(1, 1)),
        ]).adapter,
        tools: [orderTool({ intentFacts: orderFacts }).tool],
        planner: (input, ctx) => {
          signals.push(ctx.signal);
          return blocking.planner(input, ctx);
        },
      });

      await session.send(
        utterance('input-1', 'show me my last order', calendarChart()),
      );
      await blocking.entered;
      const beforeClose = session.received.length;
      session.connection.close();
      gate.resolve(addEventCandidate(calendarChart()));
      await settle();

      expect(signals).toHaveLength(1);
      expect(signals[0]?.aborted).toBe(true);
      expect(session.received.slice(beforeClose)).toEqual([]);
    });

    test('handle() still refuses a needs-clarification result after a show planned one', async () => {
      const session = openAgentSession({
        model: scriptedTextAdapter([
          scriptedToolTurn(
            [{ id: 'c1', name: 'latest_order', args: {} }],
            scriptedUsage(1, 1),
          ),
          scriptedTextTurn(['It was o-1.'], scriptedUsage(1, 1)),
        ]).adapter,
        tools: [orderTool({ intentFacts: orderFacts }).tool],
        planner: clarifyingPlanner,
      });

      await session.send(
        utterance('input-1', 'show me my last order', calendarChart()),
      );
      await waitUntil(() => session.plannerCalls() === 1);
      await settle();
      const handled = await session.engine.handle(
        ChartRequestMessage({
          sessionId: SessionId('agent-route'),
          id: MessageId('handled-request'),
          request: { ...calendarChart(), skipReply: true },
        }),
      );

      expect(uiChangesOf(session.received)).toEqual([]);
      expect(isErr(handled) && handled.error).toMatchObject({
        _tag: 'ValidationError',
        field: 'skipReply',
      });
    });

    describe('the show planner a connection wires', () => {
      test('a needs-clarification result becomes the Planner question alone', async () => {
        const session = openAgentSession({ planner: clarifyingPlanner });

        const result = await session.internals().planShow(directShowInput());

        expect(result).toEqual(
          ok({
            type: 'needs_clarification',
            question: 'Which order do you mean?',
          }),
        );
      });

      test('a failing planner comes back as its error', async () => {
        const session = openAgentSession({
          planner: failingPlanner(providerError('provider down', undefined)),
        });

        const result = await session.internals().planShow(directShowInput());

        expect(isErr(result) && result.error._tag).toBe('ProviderError');
      });

      test('an aborted signal cancels a plan in flight', async () => {
        const gate = defer<PlannerCandidate>();
        const blocking = blockingPlanner(gate);
        const session = openAgentSession({ planner: blocking.planner });
        const controller = new AbortController();

        const pending = session
          .internals()
          .planShow(directShowInput(controller.signal));
        await blocking.entered;
        controller.abort('connection closed');

        const result = await pending;
        expect(isErr(result) && result.error._tag).toBe('CancellationError');
      });
    });
  });

  describe('budget endings', () => {
    test('a turn cap of 2 runs the first turn tools, refuses the second turn tools and closes with the budget message', async () => {
      const order = orderTool();
      const model = scriptedTextAdapter([
        scriptedToolTurn(
          [{ id: 'c1', name: 'latest_order', args: {} }],
          scriptedUsage(1, 1),
        ),
        scriptedToolTurn(
          [{ id: 'c2', name: 'latest_order', args: {} }],
          scriptedUsage(1, 1),
        ),
        scriptedTextTurn(['never sent'], scriptedUsage(1, 1)),
      ]);
      const session = openAgentSession({
        model: model.adapter,
        tools: [order.tool],
        budgets: { maxTurns: 2 },
      });

      await session.send(utterance('input-1', 'last order?'));

      const runId = runIdOf(session.received, 'input-1');
      expect(order.args).toHaveLength(1);
      expect(model.requests).toHaveLength(2);
      expect(session.received).toContainEqual({
        type: 'tool_result',
        version: AGENT_WIRE_VERSION,
        runId,
        turnId: `${runId}:t2`,
        callId: CallId('c2'),
        name: 'latest_order',
        ok: false,
        summary: NOT_RUN_TOOL_SUMMARY,
      });
      expectBudgetEnding(session.received, runId);
    });

    test('the deadline passing mid model call keeps the sent deltas and closes with the budget message', async () => {
      const time = createFakeAgentRunTime();
      const stalled: StalledCall = { closed: false };
      const model = scriptedTextAdapter([
        stallingTurn(['Looking ', 'it up'], stalled),
      ]);
      const session = openAgentSession({
        time,
        model: model.adapter,
        tools: [orderTool().tool],
        budgets: { maxElapsedMs: 100 },
      });

      const sent = session.send(utterance('input-1', 'last order?'));
      await waitUntil(
        () =>
          session.received.filter((event) => event.type === 'message')
            .length === 2,
      );
      expect(stalled.signal?.aborted).toBe(false);
      time.advance(100);
      await sent;

      const runId = runIdOf(session.received, 'input-1');
      expect(
        session.received
          .filter((event) => event.type === 'message')
          .map((event) => event.delta),
      ).toEqual(['Looking ', 'it up', BUDGET_CLOSING_MESSAGE]);
      expect(stalled.signal?.aborted).toBe(true);
      expectBudgetEnding(session.received, runId);
    });

    test('a token cap reached after the first tool turn refuses the second turn tools and closes with the budget message', async () => {
      const order = orderTool();
      const model = scriptedTextAdapter([
        scriptedToolTurn(
          [{ id: 'c1', name: 'latest_order', args: {} }],
          scriptedUsage(4, 2),
        ),
        scriptedToolTurn(
          [{ id: 'c2', name: 'latest_order', args: {} }],
          scriptedUsage(4, 2),
        ),
        scriptedTextTurn(['never sent'], scriptedUsage(1, 1)),
      ]);
      const session = openAgentSession({
        model: model.adapter,
        tools: [order.tool],
        budgets: { maxTokens: 10 },
      });

      await session.send(utterance('input-1', 'last order?'));

      const runId = runIdOf(session.received, 'input-1');
      expect(order.args).toHaveLength(1);
      expectBudgetEnding(session.received, runId);
    });

    test('a batch larger than the remaining tool calls runs none of them and closes with the budget message', async () => {
      const order = orderTool();
      const model = scriptedTextAdapter([
        scriptedToolTurn(
          ['c1', 'c2', 'c3'].map((id) => ({
            id,
            name: 'latest_order',
            args: {},
          })),
          scriptedUsage(1, 1),
        ),
        scriptedTextTurn(['never sent'], scriptedUsage(1, 1)),
      ]);
      const session = openAgentSession({
        model: model.adapter,
        tools: [order.tool],
        budgets: { maxToolCalls: 2 },
      });

      await session.send(utterance('input-1', 'last order?'));

      const runId = runIdOf(session.received, 'input-1');
      expect(order.args).toEqual([]);
      expect(model.requests).toHaveLength(1);
      expectBudgetEnding(session.received, runId);
    });
  });

  describe('failures', () => {
    test('a tool throwing ToolError reports its summary and the run continues to completion', async () => {
      const order = orderTool({
        latestOrder: () => Promise.reject(new ToolError('No orders yet.')),
      });
      const model = scriptedTextAdapter([
        scriptedToolTurn(
          [{ id: 'c1', name: 'latest_order', args: {} }],
          scriptedUsage(1, 1),
        ),
        scriptedTextTurn(['You have no orders yet.'], scriptedUsage(1, 1)),
      ]);
      const session = openAgentSession({
        model: model.adapter,
        tools: [order.tool],
      });

      await session.send(utterance('input-1', 'last order?'));

      const runId = runIdOf(session.received, 'input-1');
      expect(session.received).toContainEqual({
        type: 'tool_result',
        version: AGENT_WIRE_VERSION,
        runId,
        turnId: `${runId}:t1`,
        callId: CallId('c1'),
        name: 'latest_order',
        ok: false,
        summary: 'No orders yet.',
      });
      expect(lastFinished(session.received)).toMatchObject({
        reason: 'completed',
        ok: true,
        reply: 'You have no orders yet.',
      });
    });

    test('a model failing after some deltas keeps them and ends as error with no reply and no closing message', async () => {
      const secret = 'provider-secret-5d1e';
      const model = scriptedTextAdapter([
        scriptedFailingTurn(
          ['Let me ', 'check'],
          `upstream exploded with key ${secret}`,
        ),
      ]);
      const session = openAgentSession({ model: model.adapter });

      await session.send(utterance('input-1', 'last order?'));

      const runId = runIdOf(session.received, 'input-1');
      expect(
        session.received
          .filter((event) => event.type === 'message')
          .map((event) => [event.turnId, event.delta]),
      ).toEqual([
        [`${runId}:t1`, 'Let me '],
        [`${runId}:t1`, 'check'],
      ]);
      const finished = lastFinished(session.received);
      expect(finished).toMatchObject({
        runId,
        reason: 'error',
        ok: false,
        code: expect.any(String),
        error: expect.any(String),
      });
      expect(finished).not.toHaveProperty('reply');
      expect(JSON.stringify(session.received)).not.toContain(secret);
    });
  });

  describe('session transcript across runs', () => {
    test('a second utterance sees the first run as summaries with run-qualified refs while the store keeps the full result', async () => {
      const order = orderTool();
      const model = scriptedTextAdapter([
        scriptedToolTurn(
          [{ id: 'c1', name: 'latest_order', args: {} }],
          scriptedUsage(1, 1),
        ),
        scriptedTextTurn(['It was o-1.'], scriptedUsage(1, 1)),
        scriptedTextTurn(['It cost 42.'], scriptedUsage(1, 1)),
      ]);
      const session = openAgentSession({
        model: model.adapter,
        tools: [order.tool],
      });

      await session.send(utterance('input-1', 'what was my last order?'));
      await session.send(utterance('input-2', 'how much was it?'));

      const firstRun = runIdOf(session.received, 'input-1');
      const secondRun = runIdOf(session.received, 'input-2');
      expect(secondRun).not.toBe(firstRun);
      const secondPrompt = serializeLoosely(model.requests[2]?.messages);
      expect(secondPrompt).toContain('what was my last order?');
      expect(secondPrompt).toContain('It was o-1.');
      expect(secondPrompt).toContain(`[tool call ${firstRun}:c1] latest_order`);
      expect(secondPrompt).toContain(
        `[tool result ${firstRun}:c1] ok: Order o-1 for 42`,
      );
      expect(secondPrompt).toContain(
        `[show ${firstRun}:t1] Show queued: latest_order result.`,
      );
      expect(secondPrompt).not.toContain('squeaky bone');
      expect(
        session
          .internals()
          .toolResults.get(toolCallRef(firstRun, CallId('c1'))),
      ).toEqual({
        callId: CallId('c1'),
        name: 'latest_order',
        ok: true,
        summary: 'Order o-1 for 42',
        value: LATEST_ORDER,
      });
    });

    test('a budget ending shows the closing message and its limit in the next run prompt', async () => {
      const model = scriptedTextAdapter([
        scriptedToolTurn(
          [{ id: 'c1', name: 'latest_order', args: {} }],
          scriptedUsage(1, 1),
        ),
        scriptedTextTurn(['Sorry about that.'], scriptedUsage(1, 1)),
      ]);
      const session = openAgentSession({
        model: model.adapter,
        tools: [orderTool().tool],
        budgets: { maxTurns: 1 },
      });

      await session.send(utterance('input-1', 'last order?'));
      await session.send(utterance('input-2', 'what happened?'));

      const firstRun = runIdOf(session.received, 'input-1');
      const nextPrompt = serializeLoosely(model.requests[1]?.messages);
      expect(nextPrompt).toContain(
        `[closing message ${firstRun}] ${BUDGET_CLOSING_MESSAGE}`,
      );
      expect(nextPrompt).toContain(
        `[run ${firstRun} ended: budget, limit turns]`,
      );
    });

    test('an error ending shows the partial text marked as ended with error in the next run prompt', async () => {
      const model = scriptedTextAdapter([
        scriptedFailingTurn(['Let me ', 'check'], 'upstream exploded'),
        scriptedTextTurn(['Here it is.'], scriptedUsage(1, 1)),
      ]);
      const session = openAgentSession({ model: model.adapter });

      await session.send(utterance('input-1', 'last order?'));
      await session.send(utterance('input-2', 'try again'));

      const firstRun = runIdOf(session.received, 'input-1');
      const failed = lastFinishedOf(session.received, firstRun);
      const nextPrompt = serializeLoosely(model.requests[1]?.messages);
      expect(nextPrompt).toContain('Let me check');
      expect(nextPrompt).toContain(
        `[run ${firstRun} ended: error ${failed.code}, ${failed.error}, reply above is partial]`,
      );
    });
  });

  describe('serial queue', () => {
    test('a second utterance during an active run is accepted at once and starts after the first finishes, building on its transcript', async () => {
      const release = defer<void>();
      const toolStarted = defer<void>();
      const order = orderTool({
        latestOrder: async () => {
          toolStarted.resolve();
          await release.promise;
          return LATEST_ORDER;
        },
      });
      const model = scriptedTextAdapter([
        scriptedToolTurn(
          [{ id: 'c1', name: 'latest_order', args: {} }],
          scriptedUsage(1, 1),
        ),
        scriptedTextTurn(['It was o-1.'], scriptedUsage(1, 1)),
        scriptedTextTurn(['It cost 42.'], scriptedUsage(1, 1)),
      ]);
      const session = openAgentSession({
        model: model.adapter,
        tools: [order.tool],
      });

      const first = session.send(utterance('input-1', 'last order?'));
      await toolStarted.promise;
      const second = session.send(utterance('input-2', 'how much was it?'));

      const firstRun = runIdOf(session.received, 'input-1');
      const secondRun = runIdOf(session.received, 'input-2');
      expect(session.received.map((event) => event.type)).toEqual([
        'placeholder',
        'accepted',
        'started',
        'tool_call',
        'placeholder',
        'accepted',
      ]);
      expect(session.received[5]).toMatchObject({
        type: 'accepted',
        disposition: 'agent',
        runId: secondRun,
      });

      release.resolve();
      await Promise.all([first, second]);

      const finishedFirst = session.received.findIndex(
        (event) => event.type === 'finished' && event.runId === firstRun,
      );
      const startedSecond = session.received.findIndex(
        (event) => event.type === 'started' && event.runId === secondRun,
      );
      expect(finishedFirst).toBeGreaterThan(-1);
      expect(startedSecond).toBeGreaterThan(finishedFirst);
      expect(lastFinished(session.received)).toMatchObject({
        runId: secondRun,
        reason: 'completed',
        reply: 'It cost 42.',
      });
      const secondPrompt = serializeLoosely(model.requests[2]?.messages);
      expect(secondPrompt).toContain('last order?');
      expect(secondPrompt).toContain('It was o-1.');
      expect(secondPrompt).toContain(
        `[tool result ${firstRun}:c1] ok: Order o-1 for 42`,
      );
    });
  });

  describe('run control and resolution', () => {
    test('cancelling the active run during a tool call finishes it as cancelled, drops its late tool result and starts the queued run', async () => {
      const release = defer<void>();
      const toolStarted = defer<void>();
      let toolSignal: AbortSignal | undefined;
      const order = orderTool({
        latestOrder: async (signal) => {
          toolSignal = signal;
          toolStarted.resolve();
          await release.promise;
          return LATEST_ORDER;
        },
      });
      const model = scriptedTextAdapter([
        scriptedToolTurn(
          [{ id: 'c1', name: 'latest_order', args: {} }],
          scriptedUsage(1, 1),
        ),
        scriptedTextTurn(['Second run reply.'], scriptedUsage(1, 1)),
      ]);
      const session = openAgentSession({
        model: model.adapter,
        tools: [order.tool],
      });

      const first = session.send(utterance('input-1', 'last order?'));
      await toolStarted.promise;
      const second = session.send(utterance('input-2', 'and before that?'));
      const firstRun = runIdOf(session.received, 'input-1');
      const secondRun = runIdOf(session.received, 'input-2');
      session.internals().queue.cancelRun(firstRun);
      expect(toolSignal?.aborted).toBe(true);
      release.resolve();
      await Promise.all([first, second]);

      expect(eventsOf(session.received, firstRun).map(typeOf)).toEqual([
        'accepted',
        'started',
        'tool_call',
        'finished',
      ]);
      expect(lastFinishedOf(session.received, firstRun)).toMatchObject({
        reason: 'cancelled',
        ok: false,
      });
      expect(lastFinishedOf(session.received, firstRun)).not.toHaveProperty(
        'reply',
      );
      expect(indexOf(session.received, 'started', secondRun)).toBeGreaterThan(
        indexOf(session.received, 'finished', firstRun),
      );
      expect(lastFinished(session.received)).toMatchObject({
        runId: secondRun,
        reason: 'completed',
        reply: 'Second run reply.',
      });
    });

    test('cancelling the active run during a model call drops the deltas the model streams after the abort', async () => {
      const stalled: StalledCall = { closed: false };
      const model = scriptedTextAdapter([
        stallingTurn(['Checking '], stalled, ['too late']),
        scriptedTextTurn(['Second run reply.'], scriptedUsage(1, 1)),
      ]);
      const session = openAgentSession({ model: model.adapter });

      const first = session.send(utterance('input-1', 'last order?'));
      await waitUntil(() =>
        session.received.some((event) => event.type === 'message'),
      );
      const second = session.send(utterance('input-2', 'and before that?'));
      const firstRun = runIdOf(session.received, 'input-1');
      const secondRun = runIdOf(session.received, 'input-2');
      session.internals().queue.cancelRun(firstRun);
      await Promise.all([first, second]);

      expect(stalled.signal?.aborted).toBe(true);
      expect(
        eventsOf(session.received, firstRun).flatMap((event) =>
          event.type === 'message' ? [event.delta] : [],
        ),
      ).toEqual(['Checking ']);
      expect(JSON.stringify(session.received)).not.toContain('too late');
      expect(lastFinishedOf(session.received, firstRun)).toMatchObject({
        reason: 'cancelled',
        ok: false,
      });
      expect(lastFinished(session.received)).toMatchObject({
        runId: secondRun,
        reason: 'completed',
      });
    });

    test('an agent run finishes without any ui_applied and a stray one during or after the run is refused as an unknown change without touching the run', async () => {
      const release = defer<void>();
      const toolStarted = defer<void>();
      const order = orderTool({
        latestOrder: async () => {
          toolStarted.resolve();
          await release.promise;
          return LATEST_ORDER;
        },
      });
      const model = scriptedTextAdapter([
        scriptedToolTurn(
          [{ id: 'c1', name: 'latest_order', args: {} }],
          scriptedUsage(1, 1),
        ),
        scriptedTextTurn(['It was o-1.'], scriptedUsage(1, 1)),
      ]);
      const session = openAgentSession({
        model: model.adapter,
        tools: [order.tool],
      });

      const first = session.send(utterance('input-1', 'last order?'));
      await toolStarted.promise;
      const duringRun = session.received.length;
      await session.connection.send(strayAcknowledgement());
      expect(session.received.slice(duringRun)).toEqual([
        strayAcknowledgementRefusal(),
      ]);
      expect(session.internals().queue.pendingRuns()).toBe(1);
      release.resolve();
      await first;

      expect(session.received.map(typeOf)).toEqual([
        'placeholder',
        'accepted',
        'started',
        'tool_call',
        'error',
        'tool_result',
        'message',
        'finished',
      ]);
      expect(lastFinished(session.received)).toMatchObject({
        reason: 'completed',
        ok: true,
        reply: 'It was o-1.',
      });
      const afterRun = session.received.length;
      await session.connection.send(strayAcknowledgement());
      expect(session.received.slice(afterRun)).toEqual([
        strayAcknowledgementRefusal(),
      ]);
      expect(session.internals().queue.pendingRuns()).toBe(0);
    });

    test('closing the connection mid-run aborts the tool signal and emits nothing further, not even finished', async () => {
      const release = defer<void>();
      const toolStarted = defer<void>();
      let toolSignal: AbortSignal | undefined;
      const order = orderTool({
        latestOrder: async (signal) => {
          toolSignal = signal;
          toolStarted.resolve();
          await release.promise;
          return LATEST_ORDER;
        },
      });
      const model = scriptedTextAdapter([
        scriptedToolTurn(
          [{ id: 'c1', name: 'latest_order', args: {} }],
          scriptedUsage(1, 1),
        ),
        scriptedTextTurn(['never sent'], scriptedUsage(1, 1)),
      ]);
      const session = openAgentSession({
        model: model.adapter,
        tools: [order.tool],
      });

      const first = session.send(utterance('input-1', 'last order?'));
      await toolStarted.promise;
      const beforeClose = session.received.length;
      session.connection.close();
      expect(toolSignal?.aborted).toBe(true);
      release.resolve();
      await first;
      await settle();

      expect(session.received).toHaveLength(beforeClose);
      expect(session.received.map(typeOf)).not.toContain('finished');
      expect(model.requests).toHaveLength(1);
      expect(session.diagnostics.map((event) => event.kind)).not.toContain(
        'engine.agent.run.finished',
      );
    });

    test('a budget resolver receives the connection user once per run before started and its values replace the defaults', async () => {
      const calls: { user: unknown; eventsBefore: number }[] = [];
      const model = scriptedTextAdapter([
        scriptedToolTurn(
          [{ id: 'c1', name: 'latest_order', args: {} }],
          scriptedUsage(1, 1),
        ),
        scriptedTextTurn(['Second run reply.'], scriptedUsage(1, 1)),
      ]);
      const session = openAgentSession({
        model: model.adapter,
        tools: [orderTool().tool],
        budgets: (ctx) => {
          calls.push({
            user: ctx.user,
            eventsBefore: session.received.length,
          });
          return { maxTurns: 1 };
        },
      });

      await session.send(utterance('input-1', 'last order?'));
      await session.send(utterance('input-2', 'what happened?'));

      const runs = [
        runIdOf(session.received, 'input-1'),
        runIdOf(session.received, 'input-2'),
      ];
      expect(calls).toHaveLength(2);
      calls.forEach((call, index) => {
        const runId = runs[index] as RunId;
        expect(call.user).toBe(session.user);
        expect(call.eventsBefore).toBeGreaterThan(
          indexOf(session.received, 'accepted', runId),
        );
        expect(call.eventsBefore).toBeLessThanOrEqual(
          indexOf(session.received, 'started', runId),
        );
      });
      expect(model.requests).toHaveLength(2);
      expectBudgetEnding(session.received, runs[0] as RunId);
      expect(lastFinished(session.received)).toMatchObject({
        runId: runs[1],
        reason: 'completed',
      });
    });

    test('a budget resolver returning a zero token cap closes the run with the budget message before any model call', async () => {
      const model = scriptedTextAdapter([
        scriptedTextTurn(['never sent'], scriptedUsage(1, 1)),
      ]);
      const session = openAgentSession({
        model: model.adapter,
        budgets: () => ({ maxTokens: 0 }),
      });

      await session.send(utterance('input-1', 'last order?'));

      const runId = runIdOf(session.received, 'input-1');
      expect(model.requests).toHaveLength(0);
      expect(eventsOf(session.received, runId).map(typeOf)).toEqual([
        'accepted',
        'started',
        'message',
        'finished',
      ]);
      expectBudgetEnding(session.received, runId);
    });

    test('an agent slot without budgets resolves to 12 turns, 120,000 ms, 100,000 tokens and 24 tool calls', () => {
      expect(
        resolveAgentConfig({ model: scriptedTextAdapter([]).adapter }).budgets,
      ).toEqual({
        maxTurns: 12,
        maxElapsedMs: 120_000,
        maxTokens: 100_000,
        maxToolCalls: 24,
      });
    });

    test('a model factory receives the connection user once per run and its adapter serves every turn of that run', async () => {
      const perRun = ['First run reply.', 'Second run reply.'].map((reply) =>
        scriptedTextAdapter([
          scriptedToolTurn(
            [{ id: 'c1', name: 'latest_order', args: {} }],
            scriptedUsage(1, 1),
          ),
          scriptedTextTurn([reply], scriptedUsage(1, 1)),
        ]),
      );
      const factoryUsers: unknown[] = [];
      const factory: AgentModelFactory = (ctx) => {
        const next = perRun[factoryUsers.length];
        factoryUsers.push(ctx.user);
        if (next === undefined) throw new Error('unexpected factory call');
        return next.adapter;
      };
      const session = openAgentSession({
        model: factory,
        tools: [orderTool().tool],
      });

      await session.send(utterance('input-1', 'last order?'));
      await session.send(utterance('input-2', 'and again?'));

      expect(factoryUsers).toHaveLength(2);
      for (const user of factoryUsers) expect(user).toBe(session.user);
      expect(perRun.map((adapter) => adapter.requests.length)).toEqual([2, 2]);
      expect(
        session.received.flatMap((event) =>
          event.type === 'finished' ? [event.reply] : [],
        ),
      ).toEqual(['First run reply.', 'Second run reply.']);
    });

    test('a static adapter serves every turn of consecutive runs', async () => {
      const model = scriptedTextAdapter([
        scriptedToolTurn(
          [{ id: 'c1', name: 'latest_order', args: {} }],
          scriptedUsage(1, 1),
        ),
        scriptedTextTurn(['First run reply.'], scriptedUsage(1, 1)),
        scriptedTextTurn(['Second run reply.'], scriptedUsage(1, 1)),
      ]);
      const session = openAgentSession({
        model: model.adapter,
        tools: [orderTool().tool],
      });

      await session.send(utterance('input-1', 'last order?'));
      await session.send(utterance('input-2', 'and again?'));

      expect(model.requests).toHaveLength(3);
      expect(
        session.received.flatMap((event) =>
          event.type === 'finished' ? [event.reply] : [],
        ),
      ).toEqual(['First run reply.', 'Second run reply.']);
    });

    test.each(['budget resolver', 'model factory'] as const)(
      'a throwing %s ends that run as error without started and the queued run still starts',
      async (failing) => {
        const secret = 'setup-secret-4b9e';
        let setupCalls = 0;
        const failFirstCall = () => {
          setupCalls += 1;
          if (setupCalls === 1) throw new Error(`setup exploded: ${secret}`);
        };
        const model = scriptedTextAdapter([
          scriptedTextTurn(['Second run reply.'], scriptedUsage(1, 1)),
        ]);
        const session = openAgentSession(
          failing === 'budget resolver'
            ? {
                model: model.adapter,
                budgets: () => {
                  failFirstCall();
                  return TEST_BUDGETS;
                },
              }
            : {
                model: () => {
                  failFirstCall();
                  return model.adapter;
                },
              },
        );

        const first = session.send(utterance('input-1', 'last order?'));
        const second = session.send(utterance('input-2', 'try again'));
        await Promise.all([first, second]);

        const firstRun = runIdOf(session.received, 'input-1');
        const secondRun = runIdOf(session.received, 'input-2');
        expect(eventsOf(session.received, firstRun).map(typeOf)).toEqual([
          'accepted',
          'finished',
        ]);
        const failed = lastFinishedOf(session.received, firstRun);
        expect(failed).toMatchObject({
          reason: 'error',
          ok: false,
          code: expect.any(String),
          error: expect.any(String),
        });
        expect(failed).not.toHaveProperty('reply');
        expect(JSON.stringify(session.received)).not.toContain(secret);
        expect(eventsOf(session.received, secondRun).map(typeOf)).toEqual([
          'accepted',
          'started',
          'message',
          'finished',
        ]);
        expect(lastFinished(session.received)).toMatchObject({
          runId: secondRun,
          reason: 'completed',
          reply: 'Second run reply.',
        });
      },
    );

    test('finished metrics and the observed run metadata count turns, tool calls, reported tokens and time since started', async () => {
      const time = createFakeAgentRunTime();
      const order = orderTool({
        latestOrder: () => {
          time.advance(250);
          return Promise.resolve(LATEST_ORDER);
        },
      });
      const model = scriptedTextAdapter([
        scriptedToolTurn(
          [{ id: 'c1', name: 'latest_order', args: {} }],
          scriptedUsage(10, 2),
        ),
        scriptedToolTurn(
          [{ id: 'c2', name: 'latest_order', args: {} }],
          undefined,
        ),
        scriptedTextTurn(['Done.'], scriptedUsage(4, 1)),
      ]);
      const session = openAgentSession({
        time,
        model: model.adapter,
        tools: [order.tool],
        budgets: () => {
          time.advance(1_000);
          return { ...TEST_BUDGETS, maxTokens: Infinity };
        },
      });

      await session.send(utterance('input-1', 'last order?'));

      const runId = runIdOf(session.received, 'input-1');
      const counters = {
        turns: 3,
        toolCalls: 2,
        elapsedMs: 500,
        inputTokens: 14,
        outputTokens: 3,
      };
      expect(lastFinishedOf(session.received, runId)).toMatchObject({
        reason: 'completed',
        metrics: counters,
      });
      expect(
        session.diagnostics.find(
          (event) =>
            event.kind === 'engine.agent.run.finished' && event.runId === runId,
        )?.metadata,
      ).toMatchObject({
        reason: 'completed',
        outcome: 'succeeded',
        ...counters,
        unreportedUsageCalls: 1,
      });
    });

    test('without an agent slot an utterance takes the UI-only route and creates no agent run queue', async () => {
      const createdBefore = sessionInternals.length;
      let plannerCalls = 0;
      const engine = createEngine({
        logger: silentLogger,
        retry: false,
        planner: (input) => {
          plannerCalls += 1;
          return Promise.resolve(
            ok({
              type: 'plan',
              userMessage: 'Your calendar is visible.',
              rationale: '',
              executionPlan: [],
              layout:
                input.request.layout.type === 'tiling'
                  ? input.request.layout
                  : { tree: [], instances: [] },
            }),
          );
        },
      });
      const connection = engine.openConnection({
        sessionId: SessionId('ui-only-route'),
        user: null,
      });
      const received: AgentEvent[] = [];
      connection.subscribe((event) => {
        received.push(event);
      });

      await connection.send(utterance('input-1', 'keep my calendar visible'));
      connection.close();

      expect(received.map(typeOf)).toEqual([
        'placeholder',
        'accepted',
        'ui_change',
      ]);
      expect(received[1]).toMatchObject({ disposition: 'ui_only' });
      expect(plannerCalls).toBe(1);
      expect(sessionInternals).toHaveLength(createdBefore);
    });
  });
});

interface SessionInternals {
  readonly queue: AgentRunQueue;
  readonly transcript: Transcript;
  readonly toolResults: ToolResultStore;
  readonly planShow: ShowPlanner;
}

interface StalledCall {
  signal?: AbortSignal;
  closed: boolean;
}

function openAgentSession(
  overrides: {
    readonly time?: FakeAgentRunTime;
    readonly model?: AgentConfig['model'];
    readonly tools?: AgentConfig['tools'];
    readonly budgets?: AgentConfig['budgets'];
    readonly planner?: ClarifyingPlanner;
    readonly acknowledgementTimeoutMs?: number;
  } = {},
) {
  const time = overrides.time ?? createFakeAgentRunTime();
  const received: AgentEvent[] = [];
  const user = { id: USER_SENTINEL };
  const plannerInputs: PlanningInput[] = [];
  const planner = overrides.planner ?? nothingToShowPlanner;
  const createdBefore = sessionInternals.length;
  const engine = createEngine({
    logger: silentLogger,
    retry: false,
    planner: (input, ctx) => {
      plannerInputs.push(input);
      return planner(input, ctx);
    },
    agent: {
      model: overrides.model ?? scriptedTextAdapter([]).adapter,
      instructions: 'You help pet shop customers.',
      tools: overrides.tools ?? [],
      budgets:
        typeof overrides.budgets === 'function'
          ? overrides.budgets
          : { ...TEST_BUDGETS, ...overrides.budgets },
    },
  });
  const diagnostics: DiagnosticEvent[] = [];
  const diagnosticContents = new Map<DiagnosticEvent, () => unknown>();
  engine.observeDiagnostics?.((event, readContent) => {
    diagnostics.push(event);
    if (readContent !== undefined) diagnosticContents.set(event, readContent);
  });
  const connection = engine.openConnection({
    sessionId: SessionId('agent-route'),
    user,
    token: TOKEN_SENTINEL,
    clock: time.clock.now,
    scheduleTimeout: time.clock.scheduleTimeout,
    ...(overrides.acknowledgementTimeoutMs === undefined
      ? {}
      : { acknowledgementTimeoutMs: overrides.acknowledgementTimeoutMs }),
  });
  connection.subscribe((event) => {
    received.push(event);
  });
  const internals = sessionInternals[createdBefore];
  if (internals === undefined || sessionInternals.length !== createdBefore + 1)
    throw new Error('the connection did not create one agent run queue');
  return {
    engine,
    connection,
    received,
    diagnostics,
    readContentOf: (event: DiagnosticEvent) =>
      diagnosticContents.get(event)?.(),
    user,
    send: (input: AgentUtteranceInput) => connection.send(input),
    plannerCalls: () => plannerInputs.length,
    plannerInputs: () => plannerInputs,
    internals: () => internals,
  };
}

const nothingToShowPlanner: ClarifyingPlanner = (input) =>
  Promise.resolve(
    ok({
      type: 'plan',
      rationale: 'Nothing to show.',
      executionPlan: [],
      layout: tilingLayoutOf(input.request),
    }),
  );

function orderTool(
  options: {
    readonly latestOrder?: (
      signal: AbortSignal,
    ) => Promise<typeof LATEST_ORDER>;
    readonly intentFacts?: (
      order: typeof LATEST_ORDER,
    ) => Readonly<Record<string, JsonValue>>;
  } = {},
) {
  const contexts: { user: unknown; token?: string }[] = [];
  const args: unknown[] = [];
  const tool = serverTool({
    name: 'latest_order',
    description: 'Returns the latest order of the user',
    input: z.object({}),
    output: z.object({
      orderId: z.string(),
      total: z.number(),
      items: z.array(z.string()),
    }),
    sideEffect: 'read_only',
    execute: (input, ctx) => {
      args.push(input);
      contexts.push({ user: ctx.user, token: ctx.token });
      return (options.latestOrder ?? (() => Promise.resolve(LATEST_ORDER)))(
        ctx.signal,
      );
    },
    summarize: (output) => `Order ${output.orderId} for ${output.total}`,
    ...(options.intentFacts === undefined
      ? {}
      : { intentFacts: options.intentFacts }),
  });
  return { tool, contexts, args };
}

function orderFacts(order: typeof LATEST_ORDER) {
  return { orderId: order.orderId, itemCount: order.items.length };
}

function utterance(
  inputId: string,
  text: string,
  chart: ChartRequest = makeTilingRequest(),
): AgentUtteranceInput {
  return {
    type: 'utterance',
    version: AGENT_WIRE_VERSION,
    inputId: MessageId(inputId),
    text,
    source: 'text',
    chart,
  };
}

function tilingLayoutOf(request: ChartRequest) {
  if (request.layout.type !== 'tiling')
    throw new Error('agent route tests send tiling Charts');
  return request.layout;
}

function calendarChart(): ChartRequest {
  return makeTilingRequest({ vessels: [threeViewCalendarVessel] });
}

const addEventPlanner: ClarifyingPlanner = (input) =>
  Promise.resolve(
    ok({
      type: 'plan',
      rationale: 'Add the order to the calendar.',
      executionPlan: [
        {
          instanceId: InstanceId('calendar-main'),
          action: ActionName('addEvent'),
        },
      ],
      layout: tilingLayoutOf(input.request),
    }),
  );

function addEventCandidate(chart: ChartRequest): PlannerCandidate {
  return {
    type: 'plan',
    rationale: 'Add the order to the calendar.',
    executionPlan: [
      {
        instanceId: InstanceId('calendar-main'),
        action: ActionName('addEvent'),
      },
    ],
    layout: tilingLayoutOf(chart),
    userMessage: 'Added the order to your calendar.',
  };
}

const clarifyingPlanner: ClarifyingPlanner = () =>
  Promise.resolve(
    ok({
      type: 'needs_clarification',
      question: 'Which order do you mean?',
      options: ['The latest order', 'The order from last week'],
    }),
  );

function plannersInOrder(
  planners: readonly ClarifyingPlanner[],
): ClarifyingPlanner {
  let call = 0;
  return (input, ctx) => {
    const planner = planners[call];
    call += 1;
    if (planner === undefined)
      throw new Error(`only ${planners.length} planner calls scripted`);
    return planner(input, ctx);
  };
}

function heldUntil(
  release: Promise<void>,
  planner: ClarifyingPlanner,
): ClarifyingPlanner {
  return async (input, ctx) => {
    await release;
    return planner(input, ctx);
  };
}

function twoShowTurns() {
  return scriptedTextAdapter([
    scriptedToolTurn(
      [{ id: 'c1', name: 'latest_order', args: {} }],
      scriptedUsage(1, 1),
    ),
    scriptedToolTurn(
      [{ id: 'c2', name: 'latest_order', args: {} }],
      scriptedUsage(1, 1),
    ),
    scriptedTextTurn(['Both shown.'], scriptedUsage(1, 1)),
  ]);
}

function directShowInput(signal = new AbortController().signal) {
  return {
    request: { ...calendarChart(), skipReply: true },
    messageId: MessageId('direct-show'),
    runId: RunId('direct-run'),
    inputId: MessageId('direct-input'),
    turnId: 'direct-run:t1',
    signal,
  };
}

function weekCalendarChart(): ChartRequest {
  const chart = calendarChart();
  const layout = tilingLayoutOf(chart);
  const week = VariantName('week');
  return {
    ...chart,
    instances: chart.instances.map((instance) => ({
      ...instance,
      variant: week,
    })),
    layout: {
      ...layout,
      instances: layout.instances.map((instance) => ({
        ...instance,
        variant: week,
      })),
    },
  };
}

function uiChangesOf(events: readonly AgentEvent[]): AgentUiChangeEvent[] {
  return events.filter(
    (event): event is AgentUiChangeEvent => event.type === 'ui_change',
  );
}

function diagnosticsOfKind(
  events: readonly DiagnosticEvent[],
  kind: string,
): DiagnosticEvent[] {
  const matching = events.filter((event) => event.kind === kind);
  if (matching.length === 0) throw new Error(`no ${kind} diagnostic`);
  return matching;
}

function acknowledgementOf(change: AgentUiChangeEvent, chart: ChartRequest) {
  return {
    type: 'ui_applied',
    version: AGENT_WIRE_VERSION,
    changeId: change.changeId,
    chart,
    actionOutcomes: change.response.executionPlan.map(() => ({ ok: true })),
  } as const;
}

function expectBudgetEnding(events: readonly AgentEvent[], runId: RunId) {
  const own = events.filter(
    (event) => 'runId' in event && event.runId === runId,
  );
  expect(own.slice(-2)).toEqual([
    {
      type: 'message',
      version: AGENT_WIRE_VERSION,
      runId,
      turnId: `${runId}:close`,
      delta: BUDGET_CLOSING_MESSAGE,
    },
    expect.objectContaining({
      type: 'finished',
      runId,
      reason: 'budget',
      ok: false,
      reply: BUDGET_CLOSING_MESSAGE,
    }),
  ]);
  for (const event of own) {
    expect(AgentEventSchema.safeParse(event).success).toBe(true);
  }
}

function runIdOf(events: readonly AgentEvent[], inputId: string): RunId {
  for (const event of events) {
    if (
      event.type === 'accepted' &&
      event.inputId === inputId &&
      event.runId !== null
    ) {
      return event.runId;
    }
  }
  throw new Error(`no accepted event for ${inputId}`);
}

function eventsOf(events: readonly AgentEvent[], runId: RunId) {
  return events.filter((event) => 'runId' in event && event.runId === runId);
}

function indexOf(
  events: readonly AgentEvent[],
  type: AgentEvent['type'],
  runId: RunId,
): number {
  const index = events.findIndex(
    (event) => event.type === type && 'runId' in event && event.runId === runId,
  );
  if (index === -1) throw new Error(`no ${type} event for ${runId}`);
  return index;
}

function typeOf(event: AgentEvent): AgentEvent['type'] {
  return event.type;
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

function strayAcknowledgementRefusal(): AgentEvent {
  return {
    type: 'error',
    version: AGENT_WIRE_VERSION,
    changeId: ChangeId('stray-change'),
    code: 'unknown_change',
    error: 'Unknown UI change.',
  };
}

function lastFinished(events: readonly AgentEvent[]) {
  const last = events.filter((event) => event.type === 'finished').at(-1);
  if (last === undefined) throw new Error('no finished event');
  return last;
}

function lastFinishedOf(events: readonly AgentEvent[], runId: RunId) {
  return lastFinished(
    events.filter((event) => 'runId' in event && event.runId === runId),
  );
}

function stallingTurn(
  deltas: readonly string[],
  observed: StalledCall,
  afterAbort: readonly string[] = [],
): ScriptedModelCall {
  return async function* (request) {
    const signal =
      request.request instanceof Request ? undefined : request.request?.signal;
    observed.signal = signal ?? undefined;
    try {
      yield {
        type: EventType.RUN_STARTED,
        runId: 'provider-run',
        threadId: 'provider-thread',
        timestamp: 0,
      } satisfies StreamChunk;
      yield {
        type: EventType.TEXT_MESSAGE_START,
        messageId: 'm',
        role: 'assistant',
        timestamp: 0,
      };
      for (const delta of deltas) {
        yield {
          type: EventType.TEXT_MESSAGE_CONTENT,
          messageId: 'm',
          delta,
          timestamp: 0,
        };
      }
      await new Promise<void>((resolve) => {
        if (signal?.aborted === true) resolve();
        signal?.addEventListener('abort', () => resolve(), { once: true });
      });
      for (const delta of afterAbort) {
        yield {
          type: EventType.TEXT_MESSAGE_CONTENT,
          messageId: 'm',
          delta,
          timestamp: 0,
        };
      }
    } finally {
      observed.closed = true;
    }
  };
}

function serializeLoosely(value: unknown): string {
  const seen = new WeakSet<object>();
  return (
    JSON.stringify(value, (_key, item: unknown) => {
      if (typeof item === 'function') return undefined;
      if (typeof item === 'object' && item !== null) {
        if (seen.has(item)) return undefined;
        seen.add(item);
      }
      return item;
    }) ?? ''
  );
}

async function settle(): Promise<void> {
  for (let tick = 0; tick < 20; tick += 1) {
    await new Promise((resolve) => {
      setImmediate(resolve);
    });
  }
}

async function waitUntil(condition: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (condition()) return;
    await new Promise((resolve) => {
      setImmediate(resolve);
    });
  }
  throw new Error('condition never held');
}
