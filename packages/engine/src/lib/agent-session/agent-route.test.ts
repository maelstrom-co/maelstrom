import { describe, expect, mock, test } from 'bun:test';

import {
  ActionName,
  AGENT_WIRE_VERSION,
  type AgentEvent,
  AgentEventSchema,
  CallId,
  ChangeId,
  type ChartRequest,
  ChartRequestMessage,
  type DiagnosticEvent,
  InstanceId,
  isErr,
  MessageId,
  ok,
  RunId,
  SessionId,
  VariantName,
} from '@maelstrom-co/protocol';
import { EventType, type StreamChunk } from '@tanstack/ai';

import {
  type ClarifyingPlanner,
  createEngine,
  ToolError,
} from '../../index.js';
import { defer } from '../__test-helpers__/defer.js';
import {
  makeTilingRequest,
  silentLogger,
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
  acknowledgementOf,
  addEventPlanner,
  calendarChart,
  capturingAgentRunQueueModule,
  capturingScreenChangeQueueModule,
  changeScreenCall,
  LATEST_ORDER,
  openAgentSession,
  orderTool,
  runIdOf,
  sessionInternals,
  settle,
  TEST_BUDGETS,
  tilingLayoutOf,
  TOKEN_SENTINEL,
  uiChangesOf,
  USER_SENTINEL,
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
import { type AgentModelFactory, resolveAgentConfig } from './agent-config.js';
import { NOT_RUN_TOOL_SUMMARY } from './agent-run-policy.js';
import {
  BUDGET_CLOSING_MESSAGE,
  DEFAULT_AGENT_RUN_BUDGETS,
} from './agent-run.js';
import { toolCallRef } from './transcript.js';

const PLANNER_PROSE_SENTINEL = 'PLANNER PROSE SENTINEL';
const PLANNER_ERROR_SENTINEL = 'planner-error-sentinel-3b8f';
const QUESTION_SENTINEL = 'question-sentinel-5d1e';
const CLARIFICATION_OPTION_SENTINEL = 'clarification-option-sentinel-a24c';

const SINGLE_TOOL_RUN_WIRE: readonly AgentEvent['type'][] = [
  'placeholder',
  'accepted',
  'started',
  'tool_call',
  'tool_result',
  'message',
  'finished',
];

void mock.module('./screen-change-queue.js', capturingScreenChangeQueueModule);
void mock.module('./agent-run-queue.js', capturingAgentRunQueueModule);

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
      expect(session.plannerCalls()).toBe(0);
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

  describe('change_screen', () => {
    test('one change_screen call plans one replyless Screen Change for its goal, and its applied result reaches the next model turn before finished', async () => {
      const goal = 'show my last order';
      const referents = { orderId: 'o-1' };
      const model = scriptedTextAdapter([
        scriptedToolTurn(
          [changeScreenCall('call-1', goal, referents)],
          scriptedUsage(1, 1),
        ),
        scriptedTextTurn(['It is on screen.'], scriptedUsage(1, 1)),
      ]);
      const session = openAgentSession({
        model: model.adapter,
        planner: addEventPlanner,
      });

      const sent = session.send(
        utterance('input-1', 'put my last order on screen', calendarChart()),
      );
      await waitUntil(() => uiChangesOf(session.received).length === 1);
      await settle();

      const runId = runIdOf(session.received, 'input-1');
      expect(session.plannerCalls()).toBe(1);
      const plannerInput = session.plannerInputs()[0];
      expect(plannerInput?.sessionId).toBe(SessionId('agent-route'));
      expect(plannerInput?.history).toEqual([]);
      expect(plannerInput?.messageId).not.toBe(MessageId('input-1'));
      expect(plannerInput?.request.skipReply).toBe(true);
      expect(plannerInput?.request.context.updateReasons).toEqual([
        { type: 'user_intent', id: 'r1', intent: goal, referents },
      ]);
      const [change] = uiChangesOf(session.received);
      if (change === undefined) throw new Error('no ui_change');
      expect(change).toMatchObject({ type: 'ui_change', runId });
      expect(AgentEventSchema.safeParse(change).success).toBe(true);
      expect(model.requests).toHaveLength(1);
      expect(session.received.map(typeOf)).not.toContain('finished');

      await session.connection.send(acknowledgementOf(change, calendarChart()));
      await sent;

      const summary = `applied: "${goal}"`;
      expect(toolResultOf(model.requests[1]?.messages, 'call-1')).toEqual({
        status: 'applied',
        summary,
        changeId: change.changeId,
      });
      expect(session.received.map(typeOf)).toEqual([
        'placeholder',
        'accepted',
        'started',
        'tool_call',
        'ui_change',
        'tool_result',
        'message',
        'finished',
      ]);
      expect(toolResultEventOf(session.received, 'c1')).toEqual({
        type: 'tool_result',
        version: AGENT_WIRE_VERSION,
        runId,
        turnId: `${runId}:t1`,
        callId: CallId('c1'),
        name: 'change_screen',
        ok: true,
        summary,
      });
      expect(lastFinished(session.received)).toMatchObject({
        runId,
        reason: 'completed',
        reply: 'It is on screen.',
      });
      expect(session.plannerCalls()).toBe(1);
      expect(
        serializeLoosely(session.internals().transcript.renderPriorMessages()),
      ).not.toContain('[screen ');
    });

    test('two change_screen calls around a held Server Tool wait for it, then plan as one Screen Change with reasons in call order and share one change id', async () => {
      const firstGoal = 'show my last order';
      const secondGoal = 'show my cart';
      const lookupStarted = defer<void>();
      const releaseLookup = defer<void>();
      const order = orderTool({
        latestOrder: async () => {
          lookupStarted.resolve();
          await releaseLookup.promise;
          return LATEST_ORDER;
        },
      });
      const model = scriptedTextAdapter([
        scriptedToolTurn(
          [
            changeScreenCall('call-1', firstGoal),
            { id: 'call-2', name: 'latest_order', args: {} },
            changeScreenCall('call-3', secondGoal),
          ],
          scriptedUsage(1, 1),
        ),
        scriptedTextTurn(['Both are on screen.'], scriptedUsage(1, 1)),
      ]);
      const session = openAgentSession({
        model: model.adapter,
        tools: [order.tool],
        planner: addEventPlanner,
      });

      const sent = session.send(
        utterance('input-1', 'show my order and my cart', calendarChart()),
      );
      await lookupStarted.promise;
      await settle();
      expect(session.plannerCalls()).toBe(0);

      releaseLookup.resolve();
      await waitUntil(() => uiChangesOf(session.received).length === 1);
      await settle();

      expect(session.plannerCalls()).toBe(1);
      expect(session.plannerInputs()[0]?.request.context.updateReasons).toEqual(
        [
          { type: 'user_intent', id: 'r1', intent: firstGoal },
          { type: 'user_intent', id: 'r2', intent: secondGoal },
        ],
      );
      const [change] = uiChangesOf(session.received);
      if (change === undefined) throw new Error('no ui_change');
      await session.connection.send(acknowledgementOf(change, calendarChart()));
      await sent;

      const results = model.requests[1]?.messages;
      expect(toolResultOf(results, 'call-1')).toEqual({
        status: 'applied',
        summary: `applied: "${firstGoal}"`,
        changeId: change.changeId,
      });
      expect(toolResultOf(results, 'call-3')).toEqual({
        status: 'applied',
        summary: `applied: "${secondGoal}"`,
        changeId: change.changeId,
      });
      expect(toolResultOf(results, 'call-2')).toEqual(LATEST_ORDER);
      expect(session.plannerCalls()).toBe(1);
      expect(uiChangesOf(session.received)).toHaveLength(1);
    });

    test('Server Tools in a turn with a change_screen call still run one at a time in written order, and the Screen Change waits for both', async () => {
      const started: string[] = [];
      const gatedTool = (name: string) => {
        const release = defer<void>();
        const { tool } = orderTool({
          name,
          latestOrder: async () => {
            started.push(name);
            await release.promise;
            return LATEST_ORDER;
          },
        });
        return { tool, release };
      };
      const writtenFirst = gatedTool('latest_order');
      const writtenSecond = gatedTool('earlier_order');
      const model = scriptedTextAdapter([
        scriptedToolTurn(
          [
            { id: 'call-1', name: 'latest_order', args: {} },
            changeScreenCall('call-2', 'show my last order'),
            { id: 'call-3', name: 'earlier_order', args: {} },
          ],
          scriptedUsage(1, 1),
        ),
        scriptedTextTurn(['Done.'], scriptedUsage(1, 1)),
      ]);
      const session = openAgentSession({
        model: model.adapter,
        tools: [writtenSecond.tool, writtenFirst.tool],
        planner: addEventPlanner,
      });

      const sent = session.send(
        utterance('input-1', 'show my last order', calendarChart()),
      );
      await waitUntil(() => started.length === 1);
      await settle();
      expect(started).toEqual(['latest_order']);
      expect(session.plannerCalls()).toBe(0);

      writtenFirst.release.resolve();
      await waitUntil(() => started.length === 2);
      await settle();
      expect(started).toEqual(['latest_order', 'earlier_order']);
      expect(session.plannerCalls()).toBe(0);
      const runId = runIdOf(session.received, 'input-1');

      writtenSecond.release.resolve();
      await waitUntil(() => uiChangesOf(session.received).length === 1);
      expect(session.plannerCalls()).toBe(1);
      const [change] = uiChangesOf(session.received);
      if (change === undefined) throw new Error('no ui_change');
      await session.connection.send(acknowledgementOf(change, calendarChart()));
      await sent;

      expect(started).toEqual(['latest_order', 'earlier_order']);
      expect(session.plannerCalls()).toBe(1);
      expect(lastFinishedOf(session.received, runId)).toMatchObject({
        reason: 'completed',
      });
    });

    test('no tool call id reaches the Planner request or the ui_change, settled diagnostics carry the call and reason ids, and goals and referents stay behind readContent', async () => {
      const firstGoal = 'show order goal-sentinel-1c9a';
      const secondGoal = 'show cart goal-sentinel-6e0b';
      const referents = { orderId: 'referent-sentinel-2f7d' };
      const providerIds = [
        'provider-call-sentinel-a',
        'provider-call-sentinel-b',
      ];
      const model = scriptedTextAdapter([
        scriptedToolTurn(
          [
            changeScreenCall(providerIds[0] as string, firstGoal, referents),
            changeScreenCall(providerIds[1] as string, secondGoal),
          ],
          scriptedUsage(1, 1),
        ),
        scriptedTextTurn(['Both are on screen.'], scriptedUsage(1, 1)),
      ]);
      const session = openAgentSession({
        model: model.adapter,
        planner: pipeline(named('arrange', addEventPlanner)),
      });

      const sent = session.send(
        utterance('input-1', 'show my order and my cart', calendarChart()),
      );
      await waitUntil(() => uiChangesOf(session.received).length === 1);
      const [change] = uiChangesOf(session.received);
      if (change === undefined) throw new Error('no ui_change');
      await session.connection.send(acknowledgementOf(change, calendarChart()));
      await sent;

      const runId = runIdOf(session.received, 'input-1');
      const engineCallIds = session.received.flatMap((event) =>
        event.type === 'tool_call' ? [event.callId] : [],
      );
      expect(engineCallIds).toEqual([CallId('c1'), CallId('c2')]);
      const forbidden = [...providerIds, ...engineCallIds];
      for (const surface of [session.plannerInputs()[0]?.request, change]) {
        expect(serializeLoosely(surface)).not.toContain('provider-call');
        for (const value of stringValuesIn(surface))
          expect(forbidden).not.toContain(value);
      }

      const [requested] = diagnosticsOfKind(
        session.diagnostics,
        'engine.agent.screen_change.requested',
      );
      expect(requested?.runId).toBe(runId);
      expect(requested?.metadata).toMatchObject({
        turnId: `${runId}:t1`,
        goals: 2,
        reasonIds: 'r1,r2',
        callIds: 'c1,c2',
      });
      expect(requested && session.readContentOf(requested)).toEqual({
        goals: [{ goal: firstGoal, referents }, { goal: secondGoal }],
      });
      const settled = diagnosticsOfKind(
        session.diagnostics,
        'engine.agent.screen_change.settled',
      );
      expect(settled.map((event) => event.metadata)).toEqual([
        {
          turnId: `${runId}:t1`,
          inputId: 'input-1',
          callId: 'c1',
          reasonId: 'r1',
          status: 'applied',
          changeId: change.changeId,
        },
        {
          turnId: `${runId}:t1`,
          inputId: 'input-1',
          callId: 'c2',
          reasonId: 'r2',
          status: 'applied',
          changeId: change.changeId,
        },
      ]);
      for (const event of settled) expect(event.runId).toBe(runId);
      const [emitted] = diagnosticsOfKind(
        session.diagnostics,
        'engine.agent.ui_change.emitted',
      );
      expect(emitted && session.readContentOf(emitted)).toMatchObject({
        goals: [firstGoal, secondGoal],
      });
      for (const kind of [
        'engine.planner.started',
        'engine.planner.completed',
        'engine.stage.started',
        'engine.stage.completed',
      ]) {
        for (const event of diagnosticsOfKind(session.diagnostics, kind)) {
          expect(event.runId).toBe(runId);
          expect(event.requestId).toBeUndefined();
          expect(event.metadata.inputId).toBe('input-1');
          expect(event.metadata.turnId).toBe(`${runId}:t1`);
        }
      }
      for (const event of session.diagnostics) {
        const metadata = serializeLoosely(event.metadata);
        expect(metadata).not.toContain('goal-sentinel');
        expect(metadata).not.toContain('referent-sentinel');
        expect(metadata).not.toContain('provider-call');
      }
    });

    test('a Planner response that changes nothing answers already on screen with no change id and sends no ui_change', async () => {
      const goal = 'show my calendar';
      const model = scriptedTextAdapter([
        scriptedToolTurn(
          [changeScreenCall('call-1', goal)],
          scriptedUsage(1, 1),
        ),
        scriptedTextTurn(['It is already there.'], scriptedUsage(1, 1)),
      ]);
      const session = openAgentSession({ model: model.adapter });

      await session.send(utterance('input-1', goal, calendarChart()));

      const runId = runIdOf(session.received, 'input-1');
      const summary = `applied (already on screen): "${goal}"`;
      expect(session.plannerCalls()).toBe(1);
      expect(toolResultOf(model.requests[1]?.messages, 'call-1')).toEqual({
        status: 'applied',
        summary,
      });
      expect(session.received.map(typeOf)).toEqual([...SINGLE_TOOL_RUN_WIRE]);
      expect(toolResultEventOf(session.received, 'c1')).toMatchObject({
        runId,
        ok: true,
        summary,
      });
    });

    test.each([
      [
        'an Err result',
        failingPlanner(providerError(PLANNER_ERROR_SENTINEL, undefined)),
        'ProviderError',
      ],
      [
        'a throw',
        throwingPlanner(new Error(PLANNER_ERROR_SENTINEL)),
        'ValidationError',
      ],
    ] as const)(
      'a Planner failure by %s answers failed for every goal, sends an error with the run id and lets the run finish',
      async (_case, failing: ClarifyingPlanner, code) => {
        const goals = ['show my last order', 'show my cart'];
        const model = scriptedTextAdapter([
          scriptedToolTurn(
            [
              changeScreenCall('call-1', goals[0] as string),
              changeScreenCall('call-2', goals[1] as string),
            ],
            scriptedUsage(1, 1),
          ),
          scriptedTextTurn(['I could not show that.'], scriptedUsage(1, 1)),
        ]);
        const session = openAgentSession({
          model: model.adapter,
          planner: failing,
        });

        await session.send(
          utterance('input-1', 'show my order and cart', calendarChart()),
        );

        const runId = runIdOf(session.received, 'input-1');
        expectFailedScreenChange(session.received, runId, code);
        const results = model.requests[1]?.messages;
        expect(toolResultOf(results, 'call-1')).toEqual({
          status: 'failed',
          summary: `failed: "${goals[0]}"`,
        });
        expect(toolResultOf(results, 'call-2')).toEqual({
          status: 'failed',
          summary: `failed: "${goals[1]}"`,
        });
        expect(toolResultEventOf(session.received, 'c1')).toMatchObject({
          ok: true,
          summary: `failed: "${goals[0]}"`,
        });
        expect(session.plannerCalls()).toBe(1);
        const [failed] = diagnosticsOfKind(
          session.diagnostics,
          'engine.agent.screen_change.failed',
        );
        expect(failed?.runId).toBe(runId);
        expect(failed?.metadata).toMatchObject({
          turnId: `${runId}:t1`,
          code,
        });
        const surfaces = [
          JSON.stringify(session.received),
          serializeLoosely(
            session.internals().transcript.renderPriorMessages(),
          ),
          ...model.requests.map(serializeLoosely),
          ...session.diagnostics.map((event) =>
            serializeLoosely(event.metadata),
          ),
        ];
        for (const surface of surfaces) {
          expect(surface).not.toContain(PLANNER_ERROR_SENTINEL);
        }
      },
    );

    test('a Screen Change planning past the 30,000 ms timeout on the fake clock has its signal aborted, answers failed, sends planning_timeout and lets the run finish', async () => {
      const time = createFakeAgentRunTime();
      const goal = 'show my last order';
      const signals: (AbortSignal | undefined)[] = [];
      const model = scriptedTextAdapter([
        scriptedToolTurn(
          [changeScreenCall('call-1', goal)],
          scriptedUsage(1, 1),
        ),
        scriptedTextTurn(['I could not show that.'], scriptedUsage(1, 1)),
      ]);
      const session = openAgentSession({
        time,
        model: model.adapter,
        planner: (input, ctx) => {
          signals.push(ctx.signal);
          return neverSettlingPlanner(input, ctx);
        },
      });

      const sent = session.send(utterance('input-1', goal, calendarChart()));
      await waitUntil(() => session.plannerCalls() === 1);
      time.advance(29_999);
      await settle();
      expect(signals[0]?.aborted).toBe(false);
      expect(session.received.map(typeOf)).not.toContain('error');
      expect(session.received.map(typeOf)).not.toContain('finished');

      time.advance(1);
      await sent;

      const runId = runIdOf(session.received, 'input-1');
      expect(signals[0]?.aborted).toBe(true);
      expectFailedScreenChange(session.received, runId, 'planning_timeout');
      expect(toolResultOf(model.requests[1]?.messages, 'call-1')).toEqual({
        status: 'failed',
        summary: `failed: "${goal}"`,
      });
      expect(session.plannerCalls()).toBe(1);
    });

    test('an acknowledgement timeout answers unknown with the change id, sends ui_ack_timeout with the run id, plans nothing again and refuses a late acknowledgement', async () => {
      const time = createFakeAgentRunTime();
      const goal = 'show my last order';
      const model = scriptedTextAdapter([
        scriptedToolTurn(
          [changeScreenCall('call-1', goal)],
          scriptedUsage(1, 1),
        ),
        scriptedTextTurn(['The screen did not confirm.'], scriptedUsage(1, 1)),
      ]);
      const session = openAgentSession({
        time,
        acknowledgementTimeoutMs: 5_000,
        model: model.adapter,
        planner: addEventPlanner,
      });

      const sent = session.send(utterance('input-1', goal, calendarChart()));
      await waitUntil(() => uiChangesOf(session.received).length === 1);
      time.advance(4_999);
      await settle();
      expect(session.received.map(typeOf)).not.toContain('finished');

      time.advance(1);
      await sent;

      const runId = runIdOf(session.received, 'input-1');
      const [change] = uiChangesOf(session.received);
      if (change === undefined) throw new Error('no ui_change');
      expect(toolResultOf(model.requests[1]?.messages, 'call-1')).toEqual({
        status: 'unknown',
        summary: `unknown (the screen did not confirm): "${goal}"`,
        changeId: change.changeId,
      });
      const errors = session.received.filter((event) => event.type === 'error');
      expect(errors).toEqual([
        {
          type: 'error',
          version: AGENT_WIRE_VERSION,
          changeId: change.changeId,
          runId,
          code: 'ui_ack_timeout',
          error: 'The UI acknowledgement did not arrive.',
        },
      ]);
      expect(AgentEventSchema.safeParse(errors[0]).success).toBe(true);
      expect(indexOf(session.received, 'error', runId)).toBeLessThan(
        indexOf(session.received, 'finished', runId),
      );
      const [timedOut] = diagnosticsOfKind(
        session.diagnostics,
        'engine.agent.ui_change.timed_out',
      );
      expect(timedOut?.metadata).toMatchObject({
        changeId: change.changeId,
        turnId: `${runId}:t1`,
      });
      expect(session.plannerCalls()).toBe(1);

      const beforeLateAcknowledgement = session.received.length;
      await session.connection.send(acknowledgementOf(change, calendarChart()));
      await settle();
      expect(session.received.slice(beforeLateAcknowledgement)).toEqual([
        {
          type: 'error',
          version: AGENT_WIRE_VERSION,
          changeId: change.changeId,
          code: 'unknown_change',
          error: 'Unknown UI change.',
        },
      ]);
      expect(session.plannerCalls()).toBe(1);
      expect(
        serializeLoosely(session.internals().transcript.renderPriorMessages()),
      ).not.toContain('[screen ');
    });

    test('an acknowledgement with a failed Action answers failed with some steps not run and the change id', async () => {
      const goal = 'show my last order';
      const model = scriptedTextAdapter([
        scriptedToolTurn(
          [changeScreenCall('call-1', goal)],
          scriptedUsage(1, 1),
        ),
        scriptedTextTurn(['Part of it failed.'], scriptedUsage(1, 1)),
      ]);
      const session = openAgentSession({
        model: model.adapter,
        planner: addEventPlanner,
      });

      const sent = session.send(utterance('input-1', goal, calendarChart()));
      await waitUntil(() => uiChangesOf(session.received).length === 1);
      const [change] = uiChangesOf(session.received);
      if (change === undefined) throw new Error('no ui_change');
      await session.connection.send({
        ...acknowledgementOf(change, calendarChart()),
        actionOutcomes: [{ ok: false, error: 'calendar is read-only' }],
      });
      await sent;

      const summary = `failed (some steps did not run): "${goal}"`;
      expect(toolResultOf(model.requests[1]?.messages, 'call-1')).toEqual({
        status: 'failed',
        summary,
        changeId: change.changeId,
      });
      expect(toolResultEventOf(session.received, 'c1')).toMatchObject({
        ok: true,
        summary,
      });
      expect(session.received.map(typeOf)).not.toContain('error');
    });

    test('Planner prose never reaches the model, the wire or the transcript, only the Engine summary does', async () => {
      const goal = 'show my last order';
      const model = scriptedTextAdapter([
        scriptedToolTurn(
          [changeScreenCall('call-1', goal)],
          scriptedUsage(1, 1),
        ),
        scriptedTextTurn(['It is on screen.'], scriptedUsage(1, 1)),
        scriptedTextTurn(['Anything else?'], scriptedUsage(1, 1)),
      ]);
      const session = openAgentSession({
        model: model.adapter,
        planner: scriptedPlanner([
          {
            ...addEventCandidate(calendarChart()),
            rationale: PLANNER_PROSE_SENTINEL,
            userMessage: PLANNER_PROSE_SENTINEL,
          },
        ]),
      });

      const sent = session.send(utterance('input-1', goal, calendarChart()));
      await waitUntil(() => uiChangesOf(session.received).length === 1);
      const [change] = uiChangesOf(session.received);
      if (change === undefined) throw new Error('no ui_change');
      await session.connection.send(acknowledgementOf(change, calendarChart()));
      await sent;
      await session.send(
        utterance('input-2', 'anything else?', calendarChart()),
      );

      expect(change.response).not.toHaveProperty('userMessage');
      expect(change.response).not.toHaveProperty('diagnostics');
      expect(toolResultOf(model.requests[1]?.messages, 'call-1')).toEqual({
        status: 'applied',
        summary: `applied: "${goal}"`,
        changeId: change.changeId,
      });
      expect(model.requests).toHaveLength(3);
      const surfaces = [
        JSON.stringify(session.received.filter((e) => e.type !== 'ui_change')),
        serializeLoosely(session.internals().transcript.renderPriorMessages()),
        ...model.requests.map(serializeLoosely),
      ];
      for (const surface of surfaces) {
        expect(surface).not.toContain(PLANNER_PROSE_SENTINEL);
      }
    });

    test('a clarification with partial changes and no verdicts sends one ui_change, and after its acknowledgement every goal answers needs_clarification with the question, options, change id and what is on screen', async () => {
      const goals = ['show my order', 'show the other one'];
      const model = scriptedTextAdapter([
        scriptedToolTurn(
          [
            changeScreenCall('call-1', goals[0] as string),
            changeScreenCall('call-2', goals[1] as string),
          ],
          scriptedUsage(1, 1),
        ),
        scriptedTextTurn(['Which order did you mean?'], scriptedUsage(1, 1)),
      ]);
      const session = openAgentSession({
        model: model.adapter,
        planner: clarifyingWithPartialChangesPlanner,
      });

      void session.send(
        utterance('input-1', 'show my orders', calendarChart()),
      );
      await waitUntil(() => uiChangesOf(session.received).length === 1);
      const [change] = uiChangesOf(session.received);
      if (change === undefined) throw new Error('no ui_change');
      expect(change.response.executionPlan).toEqual([
        {
          instanceId: InstanceId('calendar-main'),
          action: ActionName('addEvent'),
        },
      ]);
      expect(change.response).not.toHaveProperty('reasons');
      await session.connection.send(acknowledgementOf(change, calendarChart()));
      await waitUntil(() =>
        session.received.some((event) => event.type === 'finished'),
      );

      const results = model.requests[1]?.messages;
      for (const [index, providerCallId] of ['call-1', 'call-2'].entries()) {
        expect(toolResultOf(results, providerCallId)).toEqual({
          status: 'needs_clarification',
          summary: `needs clarification: "${goals[index]}"`,
          changeId: change.changeId,
          question: QUESTION_SENTINEL,
          options: [CLARIFICATION_OPTION_SENTINEL],
          onScreen: ['calendar'],
        });
      }
      const types = session.received.map(typeOf);
      expect(types.indexOf('finished')).toBeGreaterThan(
        types.indexOf('ui_change'),
      );
      for (const request of model.requests)
        expect(serializeLoosely(request)).not.toContain('addEvent');
      for (const event of session.diagnostics) {
        expect(serializeLoosely(event.metadata)).not.toContain(
          QUESTION_SENTINEL,
        );
      }
    });

    test('verdicts give each goal its own result: a planned goal answers applied and a clarification goal its own question, both with the change id and neither with onScreen', async () => {
      const model = scriptedTextAdapter([
        scriptedToolTurn(
          [
            changeScreenCall('call-1', 'add the order to the calendar'),
            changeScreenCall('call-2', 'show the matching toy'),
          ],
          scriptedUsage(1, 1),
        ),
        scriptedTextTurn(['Which toy?'], scriptedUsage(1, 1)),
      ]);
      const session = openAgentSession({
        model: model.adapter,
        planner: clarifyingWithVerdictsPlanner,
      });

      void session.send(utterance('input-1', 'do both', calendarChart()));
      await waitUntil(() => uiChangesOf(session.received).length === 1);
      const [change] = uiChangesOf(session.received);
      if (change === undefined) throw new Error('no ui_change');
      await session.connection.send(acknowledgementOf(change, calendarChart()));
      await waitUntil(() =>
        session.received.some((event) => event.type === 'finished'),
      );

      const results = model.requests[1]?.messages;
      expect(toolResultOf(results, 'call-1')).toEqual({
        status: 'applied',
        summary: 'applied: "add the order to the calendar"',
        changeId: change.changeId,
      });
      expect(toolResultOf(results, 'call-2')).toEqual({
        status: 'needs_clarification',
        summary: 'needs clarification: "show the matching toy"',
        changeId: change.changeId,
        question: 'Which toy do you mean?',
        options: ['The squeaky bone'],
      });
    });

    test('a clarification without partial changes sends nothing and answers needs_clarification with no change id and what the current layout shows', async () => {
      const model = scriptedTextAdapter([
        scriptedToolTurn(
          [changeScreenCall('call-1', 'show my order')],
          scriptedUsage(1, 1),
        ),
        scriptedTextTurn(['Which order?'], scriptedUsage(1, 1)),
      ]);
      const session = openAgentSession({
        model: model.adapter,
        planner: clarifyingPlanner,
      });

      await session.send(utterance('input-1', 'show it', calendarChart()));

      expect(toolResultOf(model.requests[1]?.messages, 'call-1')).toEqual({
        status: 'needs_clarification',
        summary: 'needs clarification: "show my order"',
        question: 'Which order do you mean?',
        options: ['The latest order', 'The order from last week'],
        onScreen: ['calendar'],
      });
      expect(session.received.map(typeOf)).not.toContain('ui_change');
    });

    test('an acknowledgement timeout on a partial change answers the planned goal unknown while the clarification goal keeps its question and the change id', async () => {
      const time = createFakeAgentRunTime();
      const model = scriptedTextAdapter([
        scriptedToolTurn(
          [
            changeScreenCall('call-1', 'add the order to the calendar'),
            changeScreenCall('call-2', 'show the matching toy'),
          ],
          scriptedUsage(1, 1),
        ),
        scriptedTextTurn(['Which toy?'], scriptedUsage(1, 1)),
      ]);
      const session = openAgentSession({
        time,
        model: model.adapter,
        planner: clarifyingWithVerdictsPlanner,
        acknowledgementTimeoutMs: 1_000,
      });

      void session.send(utterance('input-1', 'do both', calendarChart()));
      await waitUntil(() => uiChangesOf(session.received).length === 1);
      const [change] = uiChangesOf(session.received);
      if (change === undefined) throw new Error('no ui_change');
      time.advance(1_000);
      await waitUntil(() =>
        session.received.some((event) => event.type === 'finished'),
      );

      const results = model.requests[1]?.messages;
      expect(toolResultOf(results, 'call-1')).toEqual({
        status: 'unknown',
        summary:
          'unknown (the screen did not confirm): "add the order to the calendar"',
        changeId: change.changeId,
      });
      expect(toolResultOf(results, 'call-2')).toMatchObject({
        status: 'needs_clarification',
        changeId: change.changeId,
        question: 'Which toy do you mean?',
      });
    });

    test('a blank goal gets the sanitized invalid arguments failure and makes no Planner call', async () => {
      const model = scriptedTextAdapter([
        scriptedToolTurn(
          [changeScreenCall('call-1', '   ')],
          scriptedUsage(1, 1),
        ),
        scriptedTextTurn(['Sorry.'], scriptedUsage(1, 1)),
      ]);
      const session = openAgentSession({
        model: model.adapter,
        planner: addEventPlanner,
      });

      await session.send(utterance('input-1', 'show it', calendarChart()));

      expect(toolResultOf(model.requests[1]?.messages, 'call-1')).toEqual({
        ok: false,
        error: 'change_screen received invalid arguments',
      });
      expect(toolResultEventOf(session.received, 'c1')).toMatchObject({
        ok: false,
        summary: 'change_screen received invalid arguments',
      });
      expect(session.plannerCalls()).toBe(0);
      expect(lastFinished(session.received)).toMatchObject({
        reason: 'completed',
      });
    });

    test('a blank goal beside a valid change_screen call does not hold the valid goal for the fill timeout', async () => {
      const time = createFakeAgentRunTime();
      const model = scriptedTextAdapter([
        scriptedToolTurn(
          [
            changeScreenCall('call-1', '   '),
            changeScreenCall('call-2', 'add the order to the calendar'),
          ],
          scriptedUsage(1, 1),
        ),
        scriptedTextTurn(['Done.'], scriptedUsage(1, 1)),
      ]);
      const session = openAgentSession({
        time,
        model: model.adapter,
        planner: addEventPlanner,
      });

      void session.send(utterance('input-1', 'do both', calendarChart()));
      await waitUntil(() => session.plannerCalls() === 1);

      expect(session.diagnostics.map((event) => event.kind)).not.toContain(
        'engine.agent.screen_change.batch_fill_timeout',
      );
      session.connection.close();
    });

    test('change_screen calls count toward the tool call cap:a turn over it is refused as a whole with no Planner call, while the same count of Server Tools alone runs', async () => {
      const order = orderTool();
      const model = scriptedTextAdapter([
        scriptedToolTurn(
          [
            { id: 'call-1', name: 'latest_order', args: {} },
            changeScreenCall('call-2', 'show my last order'),
            changeScreenCall('call-3', 'show my cart'),
          ],
          scriptedUsage(1, 1),
        ),
        scriptedTextTurn(['never sent'], scriptedUsage(1, 1)),
      ]);
      const session = openAgentSession({
        model: model.adapter,
        tools: [order.tool],
        planner: addEventPlanner,
        budgets: { maxToolCalls: 2 },
      });

      await session.send(
        utterance('input-1', 'show my order and cart', calendarChart()),
      );

      const runId = runIdOf(session.received, 'input-1');
      expect(order.args).toEqual([]);
      expect(session.plannerCalls()).toBe(0);
      expect(uiChangesOf(session.received)).toEqual([]);
      expect(model.requests).toHaveLength(1);
      expectBudgetEnding(session.received, runId);

      const withinCap = orderTool();
      const serverToolsOnly = openAgentSession({
        model: scriptedTextAdapter([
          scriptedToolTurn(
            [
              { id: 'call-1', name: 'latest_order', args: {} },
              { id: 'call-2', name: 'latest_order', args: {} },
            ],
            scriptedUsage(1, 1),
          ),
          scriptedTextTurn(['Two orders.'], scriptedUsage(1, 1)),
        ]).adapter,
        tools: [withinCap.tool],
        budgets: { maxToolCalls: 2 },
      });
      await serverToolsOnly.send(utterance('input-1', 'last orders?'));
      expect(withinCap.args).toHaveLength(2);
      expect(lastFinished(serverToolsOnly.received)).toMatchObject({
        reason: 'completed',
      });
    });

    test('a turn of 25 calls including change_screen is over the default cap of 24 and is refused as a whole', async () => {
      const order = orderTool();
      const model = scriptedTextAdapter([
        scriptedToolTurn(
          [
            ...Array.from({ length: 24 }, (_, index) => ({
              id: `call-${index + 1}`,
              name: 'latest_order',
              args: {},
            })),
            changeScreenCall('call-25', 'show my orders'),
          ],
          scriptedUsage(1, 1),
        ),
        scriptedTextTurn(['never sent'], scriptedUsage(1, 1)),
      ]);
      const session = openAgentSession({
        model: model.adapter,
        tools: [order.tool],
        planner: addEventPlanner,
        budgets: { maxToolCalls: DEFAULT_AGENT_RUN_BUDGETS.maxToolCalls },
      });

      await session.send(
        utterance('input-1', 'show my orders', calendarChart()),
      );

      expect(order.args).toEqual([]);
      expect(session.plannerCalls()).toBe(0);
      expectBudgetEnding(
        session.received,
        runIdOf(session.received, 'input-1'),
      );
    });

    test('cancelling a run whose change awaits acknowledgement finishes it at once, starts the queued run, and the later acknowledgement becomes a Screen Note in that run', async () => {
      const goal = 'show my last order';
      const lookupStarted = defer<void>();
      const releaseLookup = defer<void>();
      const order = orderTool({
        latestOrder: async () => {
          lookupStarted.resolve();
          await releaseLookup.promise;
          return LATEST_ORDER;
        },
      });
      const model = scriptedTextAdapter([
        scriptedToolTurn(
          [changeScreenCall('call-1', goal)],
          scriptedUsage(1, 1),
        ),
        scriptedToolTurn(
          [{ id: 'call-1', name: 'latest_order', args: {} }],
          scriptedUsage(1, 1),
        ),
        scriptedTextTurn(['It is on screen now.'], scriptedUsage(1, 1)),
      ]);
      const session = openAgentSession({
        model: model.adapter,
        tools: [order.tool],
        planner: addEventPlanner,
      });

      const first = session.send(utterance('input-1', goal, calendarChart()));
      await waitUntil(() => uiChangesOf(session.received).length === 1);
      const second = session.send(
        utterance('input-2', 'is it there?', calendarChart()),
      );
      const firstRun = runIdOf(session.received, 'input-1');
      const secondRun = runIdOf(session.received, 'input-2');
      session.internals().queue.cancelRun(firstRun);
      await first;

      expect(lastFinishedOf(session.received, firstRun)).toMatchObject({
        reason: 'cancelled',
        ok: false,
      });
      await lookupStarted.promise;
      expect(indexOf(session.received, 'started', secondRun)).toBeGreaterThan(
        indexOf(session.received, 'finished', firstRun),
      );

      const [change] = uiChangesOf(session.received);
      if (change === undefined) throw new Error('no ui_change');
      const beforeAcknowledgement = session.received.length;
      await session.connection.send(acknowledgementOf(change, calendarChart()));
      await settle();
      expect(session.received.slice(beforeAcknowledgement)).toEqual([]);
      releaseLookup.resolve();
      await second;

      const lateNote = `[screen ${firstRun}:t1] Screen change settled after the run stopped waiting: applied: "${goal}"`;
      expect(model.requests).toHaveLength(3);
      expect(
        occurrencesIn(model.requests[1]?.messages, jsonEscaped(lateNote)),
      ).toBe(0);
      expect(
        occurrencesIn(model.requests[2]?.messages, jsonEscaped(lateNote)),
      ).toBe(1);
      expect(session.plannerCalls()).toBe(1);
      expect(lastFinishedOf(session.received, secondRun)).toMatchObject({
        reason: 'completed',
      });
    });

    test('cancelling a run before its batch went out answers its goal cancelled and makes no Planner call', async () => {
      const lookupStarted = defer<void>();
      const releaseLookup = defer<void>();
      const order = orderTool({
        latestOrder: async () => {
          lookupStarted.resolve();
          await releaseLookup.promise;
          return LATEST_ORDER;
        },
      });
      const model = scriptedTextAdapter([
        scriptedToolTurn(
          [
            { id: 'call-1', name: 'latest_order', args: {} },
            changeScreenCall('call-2', 'show my last order'),
          ],
          scriptedUsage(1, 1),
        ),
        scriptedTextTurn(['Second run reply.'], scriptedUsage(1, 1)),
      ]);
      const session = openAgentSession({
        model: model.adapter,
        tools: [order.tool],
        planner: addEventPlanner,
      });

      const first = session.send(
        utterance('input-1', 'show my last order', calendarChart()),
      );
      await lookupStarted.promise;
      const second = session.send(
        utterance('input-2', 'never mind', calendarChart()),
      );
      const firstRun = runIdOf(session.received, 'input-1');
      session.internals().queue.cancelRun(firstRun);
      releaseLookup.resolve();
      await Promise.all([first, second]);
      await settle();

      expect(lastFinishedOf(session.received, firstRun)).toMatchObject({
        reason: 'cancelled',
      });
      expect(session.plannerCalls()).toBe(0);
      expect(uiChangesOf(session.received)).toEqual([]);
      expect(session.diagnostics.map((event) => event.kind)).not.toContain(
        'engine.agent.screen_change.requested',
      );
      expect(lastFinished(session.received)).toMatchObject({
        reason: 'completed',
        reply: 'Second run reply.',
      });
    });

    test('a deadline ending while a change awaits acknowledgement is not held by it, and the later acknowledgement becomes a Screen Note', async () => {
      const time = createFakeAgentRunTime();
      const goal = 'show my last order';
      const model = scriptedTextAdapter([
        scriptedToolTurn(
          [changeScreenCall('call-1', goal)],
          scriptedUsage(1, 1),
        ),
        scriptedTextTurn(['Here it is.'], scriptedUsage(1, 1)),
      ]);
      const session = openAgentSession({
        time,
        model: model.adapter,
        planner: addEventPlanner,
        budgets: { maxElapsedMs: 100 },
      });

      const first = session.send(utterance('input-1', goal, calendarChart()));
      await waitUntil(() => uiChangesOf(session.received).length === 1);
      time.advance(100);
      await first;

      const firstRun = runIdOf(session.received, 'input-1');
      expectBudgetEnding(session.received, firstRun);
      const [change] = uiChangesOf(session.received);
      if (change === undefined) throw new Error('no ui_change');
      const beforeAcknowledgement = session.received.length;
      await session.connection.send(acknowledgementOf(change, calendarChart()));
      await settle();
      expect(session.received.slice(beforeAcknowledgement)).toEqual([]);
      await session.send(utterance('input-2', 'is it there?', calendarChart()));

      expect(
        occurrencesIn(
          model.requests[1]?.messages,
          jsonEscaped(
            `[screen ${firstRun}:t1] Screen change settled after the run stopped waiting: applied: "${goal}"`,
          ),
        ),
      ).toBe(1);
    });

    test('a run whose Server Tool succeeds without a change_screen call makes no Planner call', async () => {
      const model = scriptedTextAdapter([
        scriptedToolTurn(
          [{ id: 'call-1', name: 'latest_order', args: {} }],
          scriptedUsage(1, 1),
        ),
        scriptedTextTurn(['It was o-1.'], scriptedUsage(1, 1)),
      ]);
      const session = openAgentSession({
        model: model.adapter,
        tools: [orderTool().tool],
        planner: addEventPlanner,
      });

      await session.send(
        utterance('input-1', 'show me my last order', calendarChart()),
      );
      await settle();

      expect(session.received.map(typeOf)).toEqual([...SINGLE_TOOL_RUN_WIRE]);
      expect(session.plannerCalls()).toBe(0);
      expect(
        serializeLoosely(session.internals().transcript.renderPriorMessages()),
      ).not.toContain('[screen ');
    });

    test('a new run finishes without waiting for an earlier run change that still awaits acknowledgement', async () => {
      const goal = 'show my last order';
      const model = scriptedTextAdapter([
        scriptedToolTurn(
          [changeScreenCall('call-1', goal)],
          scriptedUsage(1, 1),
        ),
        scriptedTextTurn(['Hello again.'], scriptedUsage(1, 1)),
      ]);
      const session = openAgentSession({
        model: model.adapter,
        planner: addEventPlanner,
      });

      const first = session.send(utterance('input-1', goal, calendarChart()));
      await waitUntil(() => uiChangesOf(session.received).length === 1);
      const firstRun = runIdOf(session.received, 'input-1');
      session.internals().queue.cancelRun(firstRun);
      await first;
      await session.send(utterance('input-2', 'hello', calendarChart()));

      const secondRun = runIdOf(session.received, 'input-2');
      expect(model.requests).toHaveLength(2);
      expect(lastFinishedOf(session.received, secondRun)).toMatchObject({
        reason: 'completed',
        reply: 'Hello again.',
      });
      const [change] = uiChangesOf(session.received);
      if (change === undefined) throw new Error('no ui_change');
      await session.connection.send(acknowledgementOf(change, calendarChart()));
      expect(
        serializeLoosely(session.internals().transcript.renderPriorMessages()),
      ).toContain(
        jsonEscaped(
          `[screen ${firstRun}:t1] Screen change settled after the run stopped waiting: applied: "${goal}"`,
        ),
      );
    });

    test('a second turn plans on the Chart the first change was acknowledged with', async () => {
      const model = scriptedTextAdapter([
        scriptedToolTurn(
          [changeScreenCall('call-1', 'show my last order')],
          scriptedUsage(1, 1),
        ),
        scriptedToolTurn(
          [changeScreenCall('call-2', 'show my cart')],
          scriptedUsage(1, 1),
        ),
        scriptedTextTurn(['Both shown.'], scriptedUsage(1, 1)),
      ]);
      const session = openAgentSession({
        model: model.adapter,
        planner: addEventPlanner,
      });

      const sent = session.send(
        utterance('input-1', 'show my order then my cart', calendarChart()),
      );
      await waitUntil(() => uiChangesOf(session.received).length === 1);
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
      const secondChange = uiChangesOf(session.received)[1];
      if (secondChange === undefined) throw new Error('no second ui_change');
      await session.connection.send(
        acknowledgementOf(secondChange, acknowledged),
      );
      await sent;
      expect(session.received.map(typeOf)).not.toContain('error');
    });

    test('an unknown change id and a wrong outcome count are refused while the change stays pending until a valid acknowledgement', async () => {
      const goal = 'show my last order';
      const model = scriptedTextAdapter([
        scriptedToolTurn(
          [changeScreenCall('call-1', goal)],
          scriptedUsage(1, 1),
        ),
        scriptedTextTurn(['It is on screen.'], scriptedUsage(1, 1)),
      ]);
      const session = openAgentSession({
        model: model.adapter,
        planner: addEventPlanner,
      });

      const sent = session.send(utterance('input-1', goal, calendarChart()));
      await waitUntil(() => uiChangesOf(session.received).length === 1);
      const [change] = uiChangesOf(session.received);
      if (change === undefined) throw new Error('no ui_change');

      const beforeStray = session.received.length;
      await session.connection.send(strayAcknowledgement());
      expect(session.received.slice(beforeStray)).toEqual([
        strayAcknowledgementRefusal(),
      ]);

      const beforeWrongCount = session.received.length;
      await session.connection.send({
        ...acknowledgementOf(change, calendarChart()),
        actionOutcomes: [],
      });
      expect(session.received.slice(beforeWrongCount)).toEqual([
        {
          type: 'error',
          version: AGENT_WIRE_VERSION,
          changeId: change.changeId,
          code: 'invalid_action_outcomes',
          error: 'Expected one outcome per Action.',
        },
      ]);
      await settle();
      expect(session.received.map(typeOf)).not.toContain('finished');
      expect(model.requests).toHaveLength(1);
      const runId = runIdOf(session.received, 'input-1');
      const rejected = diagnosticsOfKind(
        session.diagnostics,
        'engine.agent.ui_applied.rejected',
      );
      expect(rejected).toHaveLength(2);
      const [unknownChange, wrongCount] = rejected;
      expect(unknownChange).not.toHaveProperty('runId');
      expect(unknownChange).not.toHaveProperty('requestId');
      expect(unknownChange?.metadata).toEqual({
        changeId: 'stray-change',
        code: 'unknown_change',
      });
      expect(wrongCount).not.toHaveProperty('requestId');
      expect(wrongCount?.runId).toBe(runId);
      expect(wrongCount?.metadata).toEqual({
        changeId: change.changeId,
        code: 'invalid_action_outcomes',
        inputId: 'input-1',
        turnId: `${runId}:t1`,
      });

      await session.connection.send(acknowledgementOf(change, calendarChart()));
      await sent;

      expect(toolResultOf(model.requests[1]?.messages, 'call-1')).toEqual({
        status: 'applied',
        summary: `applied: "${goal}"`,
        changeId: change.changeId,
      });
      expect(session.plannerCalls()).toBe(1);
    });

    test('an acknowledgement sent synchronously from inside the ui_change listener is accepted', async () => {
      const model = scriptedTextAdapter([
        scriptedToolTurn(
          [changeScreenCall('call-1', 'show my last order')],
          scriptedUsage(1, 1),
        ),
        scriptedTextTurn(['It is on screen.'], scriptedUsage(1, 1)),
      ]);
      const session = openAgentSession({
        model: model.adapter,
        planner: addEventPlanner,
      });
      let acknowledgedInListener = false;
      session.connection.subscribe((event) => {
        if (event.type !== 'ui_change' || acknowledgedInListener) return;
        acknowledgedInListener = true;
        void session.connection.send(
          acknowledgementOf(event, weekCalendarChart()),
        );
      });

      await session.send(
        utterance('input-1', 'show my last order', calendarChart()),
      );

      expect(acknowledgedInListener).toBe(true);
      expect(session.received.map(typeOf)).not.toContain('error');
      expect(toolResultOf(model.requests[1]?.messages, 'call-1')).toMatchObject(
        { status: 'applied' },
      );
    });

    test('closing the connection aborts a Screen Change plan in flight and sends and records nothing for it', async () => {
      const time = createFakeAgentRunTime();
      const gate = defer<PlannerCandidate>();
      const blocking = blockingPlanner(gate);
      const signals: (AbortSignal | undefined)[] = [];
      const model = scriptedTextAdapter([
        scriptedToolTurn(
          [changeScreenCall('call-1', 'show my last order')],
          scriptedUsage(1, 1),
        ),
        scriptedTextTurn(['never sent'], scriptedUsage(1, 1)),
      ]);
      const session = openAgentSession({
        time,
        model: model.adapter,
        planner: (input, ctx) => {
          signals.push(ctx.signal);
          return blocking.planner(input, ctx);
        },
      });

      const sent = session.send(
        utterance('input-1', 'show me my last order', calendarChart()),
      );
      await blocking.entered;
      const beforeClose = session.received.length;
      const transcriptBeforeClose = serializeLoosely(
        session.internals().transcript.renderPriorMessages(),
      );
      const diagnosticsBeforeClose = session.diagnostics.length;
      session.connection.close();
      expect(signals[0]?.aborted).toBe(true);
      time.advance(30_000);
      await sent;
      await settle();
      gate.resolve(addEventCandidate(calendarChart()));
      await settle();

      expect(signals).toHaveLength(1);
      expect(model.requests).toHaveLength(1);
      expect(session.received.slice(beforeClose)).toEqual([]);
      expect(
        serializeLoosely(session.internals().transcript.renderPriorMessages()),
      ).toBe(transcriptBeforeClose);
      expect(
        session.diagnostics
          .slice(diagnosticsBeforeClose)
          .filter((event) => event.kind.startsWith('engine.agent.')),
      ).toEqual([]);
    });

    test('handle() still refuses a needs-clarification result after a Screen Change planned one', async () => {
      const session = openAgentSession({
        model: scriptedTextAdapter([
          scriptedToolTurn(
            [changeScreenCall('call-1', 'show my last order')],
            scriptedUsage(1, 1),
          ),
          scriptedTextTurn(['Which order?'], scriptedUsage(1, 1)),
        ]).adapter,
        planner: clarifyingPlanner,
      });

      await session.send(
        utterance('input-1', 'show me my last order', calendarChart()),
      );
      expect(session.plannerCalls()).toBe(1);
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

    describe('the Screen Change planner a connection wires', () => {
      test('a needs-clarification result becomes the Planner question alone', async () => {
        const session = openAgentSession({ planner: clarifyingPlanner });

        const result = await session
          .internals()
          .planner(directScreenChangeInput());

        expect(result).toEqual(
          ok({
            type: 'needs_clarification',
            question: 'Which order do you mean?',
            options: ['The latest order', 'The order from last week'],
          }),
        );
      });

      test('a clarification keeps its healed partial changes and the verdicts that name a request reason', async () => {
        const session = openAgentSession({
          planner: clarifyingWithVerdictsPlanner,
        });

        const result = await session
          .internals()
          .planner(directScreenChangeInput(undefined, ['r1', 'r2']));

        expect(result).toEqual(
          ok({
            type: 'needs_clarification',
            question: 'Which toy do you mean?',
            options: ['The squeaky bone'],
            executionPlan: [
              {
                instanceId: InstanceId('calendar-main'),
                action: ActionName('addEvent'),
              },
            ],
            reasons: [
              { id: 'r1', status: 'planned' },
              {
                id: 'r2',
                status: 'needs_clarification',
                question: 'Which toy do you mean?',
                options: ['The squeaky bone'],
              },
            ],
          }),
        );
      });

      test('a plan keeps its verdicts beside the response, which carries none', async () => {
        const session = openAgentSession({
          planner: (input) =>
            Promise.resolve(
              ok({
                ...addEventCandidate(input.request),
                userMessage: undefined,
                reasons: [{ id: 'r1', status: 'planned' }],
              }),
            ),
        });

        const result = await session
          .internals()
          .planner(directScreenChangeInput(undefined, ['r1']));

        if (isErr(result) || result.value.type !== 'response')
          throw new Error('expected a response');
        expect(result.value.reasons).toEqual([{ id: 'r1', status: 'planned' }]);
        expect('reasons' in result.value.response).toBe(false);
      });

      test('a failing planner comes back as its error', async () => {
        const session = openAgentSession({
          planner: failingPlanner(providerError('provider down', undefined)),
        });

        const result = await session
          .internals()
          .planner(directScreenChangeInput());

        expect(isErr(result) && result.error._tag).toBe('ProviderError');
      });

      test('an aborted signal cancels a plan in flight', async () => {
        const gate = defer<PlannerCandidate>();
        const blocking = blockingPlanner(gate);
        const session = openAgentSession({ planner: blocking.planner });
        const controller = new AbortController();

        const pending = session
          .internals()
          .planner(directScreenChangeInput(controller.signal));
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
      expect(secondPrompt).not.toContain('[screen ');
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
        toolCalls: { requested: 2, admitted: 2 },
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
        turns: 3,
        toolCallsRequested: 2,
        toolCallsAdmitted: 2,
        elapsedMs: 500,
        inputTokens: 14,
        outputTokens: 3,
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

interface StalledCall {
  signal?: AbortSignal;
  closed: boolean;
}

const neverSettlingPlanner: ClarifyingPlanner = () => new Promise(() => {});

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

const clarifyingWithPartialChangesPlanner: ClarifyingPlanner = () =>
  Promise.resolve(
    ok({
      type: 'needs_clarification',
      question: QUESTION_SENTINEL,
      options: [CLARIFICATION_OPTION_SENTINEL],
      executionPlan: [
        {
          instanceId: InstanceId('calendar-main'),
          action: ActionName('addEvent'),
        },
      ],
    }),
  );

const clarifyingWithVerdictsPlanner: ClarifyingPlanner = () =>
  Promise.resolve(
    ok({
      type: 'needs_clarification',
      question: 'Which toy do you mean?',
      options: ['The squeaky bone'],
      executionPlan: [
        {
          instanceId: InstanceId('calendar-main'),
          action: ActionName('addEvent'),
        },
      ],
      reasons: [
        { id: 'r1', status: 'planned' },
        {
          id: 'r2',
          status: 'needs_clarification',
          question: 'Which toy do you mean?',
          options: ['The squeaky bone'],
        },
      ],
    }),
  );

function directScreenChangeInput(
  signal = new AbortController().signal,
  reasonIds: readonly string[] = [],
) {
  const chart = calendarChart();
  return {
    request: {
      ...chart,
      skipReply: true,
      context: {
        ...chart.context,
        updateReasons: reasonIds.map((id) => ({
          type: 'user_intent' as const,
          id,
          intent: `goal ${id}`,
        })),
      },
    },
    messageId: MessageId('direct-screen-change'),
    owner: {
      runId: RunId('direct-run'),
      inputId: MessageId('direct-input'),
      turnId: 'direct-run:t1',
    },
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

function diagnosticsOfKind(
  events: readonly DiagnosticEvent[],
  kind: string,
): DiagnosticEvent[] {
  const matching = events.filter((event) => event.kind === kind);
  if (matching.length === 0) throw new Error(`no ${kind} diagnostic`);
  return matching;
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

function occurrencesIn(value: unknown, needle: string): number {
  return serializeLoosely(value).split(needle).length - 1;
}

function toolResultOf(messages: unknown, providerCallId: string): unknown {
  if (!Array.isArray(messages)) throw new Error('no model messages');
  for (const message of messages as unknown[]) {
    if (
      typeof message === 'object' &&
      message !== null &&
      'role' in message &&
      message.role === 'tool' &&
      'toolCallId' in message &&
      message.toolCallId === providerCallId &&
      'content' in message
    ) {
      return typeof message.content === 'string'
        ? (JSON.parse(message.content) as unknown)
        : message.content;
    }
  }
  throw new Error(`no tool result for ${providerCallId}`);
}

function toolResultEventOf(events: readonly AgentEvent[], callId: string) {
  const result = events.find(
    (event) => event.type === 'tool_result' && event.callId === callId,
  );
  if (result === undefined) throw new Error(`no tool_result for ${callId}`);
  return result;
}

function stringValuesIn(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (typeof value !== 'object' || value === null) return [];
  return [
    ...Object.keys(value),
    ...Object.values(value).flatMap(stringValuesIn),
  ];
}

function expectFailedScreenChange(
  events: readonly AgentEvent[],
  runId: RunId,
  code: string,
) {
  const errors = events.filter((event) => event.type === 'error');
  expect(errors).toEqual([
    {
      type: 'error',
      version: AGENT_WIRE_VERSION,
      changeId: expect.any(String),
      runId,
      code,
      error: 'The screen could not be updated.',
    },
  ]);
  expect(AgentEventSchema.safeParse(errors[0]).success).toBe(true);
  expect(indexOf(events, 'error', runId)).toBeLessThan(
    indexOf(events, 'finished', runId),
  );
  expect(lastFinishedOf(events, runId)).toMatchObject({
    reason: 'completed',
    ok: true,
  });
  expect(events.map(typeOf)).not.toContain('ui_change');
}

function jsonEscaped(text: string): string {
  return JSON.stringify(text).slice(1, -1);
}
