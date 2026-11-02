import {
  ActionName,
  AGENT_WIRE_VERSION,
  type AgentEvent,
  type AgentUiChangeEvent,
  type AgentUtteranceInput,
  type ChartRequest,
  type DiagnosticEvent,
  InstanceId,
  type JsonValue,
  MessageId,
  ok,
  type RunId,
  SessionId,
} from '@maelstrom-co/protocol';
import { z } from 'zod';

import {
  type ClarifyingPlanner,
  createEngine,
  type PlanningInput,
  serverTool,
} from '../../../index.js';
import {
  makeTilingRequest,
  silentLogger,
  threeViewCalendarVessel,
} from '../../__test-helpers__/fixtures.js';
import type { AgentConfig } from '../agent-config.js';
import * as agentRunQueueModule from '../agent-run-queue.js';
import type {
  AgentRunQueue,
  AgentRunQueueOptions,
} from '../agent-run-queue.js';
import type { AgentRunBudgets } from '../agent-run.js';
import * as plannerShowQueueModule from '../planner-show-queue.js';
import type { PlannerShowQueueOptions } from '../planner-show-queue.js';
import type { SessionPlanner } from '../session-planner.js';
import type { ToolResultStore } from '../tool-result-store.js';
import type { Transcript } from '../transcript.js';
import {
  createFakeAgentRunTime,
  type FakeAgentRunTime,
} from './fake-agent-run-time.js';
import { scriptedTextAdapter } from './scripted-text-adapter.js';

/** A user value the host authenticates, which must never reach the model or the wire. */
export const USER_SENTINEL = 'user-sentinel-7f3a';

/** An application token, which must never reach the model or the wire. */
export const TOKEN_SENTINEL = 'token-sentinel-91c2';

/** What the scripted `latest_order` tool returns by default. */
export const LATEST_ORDER = {
  orderId: 'o-1',
  total: 42,
  items: ['squeaky bone', 'catnip mouse'],
};

/** Budgets roomy enough that no scripted run reaches them unless a test lowers one. */
export const TEST_BUDGETS: AgentRunBudgets = {
  maxTurns: 6,
  maxElapsedMs: 60_000,
  maxTokens: 10_000,
  maxToolCalls: 6,
};

/** The session objects behind one agent connection, captured as the connection creates them. */
export interface SessionInternals {
  readonly queue: AgentRunQueue;
  readonly transcript: Transcript;
  readonly toolResults: ToolResultStore;
  readonly planner: SessionPlanner;
}

/**
 * Every agent connection's internals, in creation order. Filled only when the
 * test file replaces both queue modules with {@link capturingPlannerShowQueueModule}
 * and {@link capturingAgentRunQueueModule} through `mock.module`.
 */
export const sessionInternals: SessionInternals[] = [];

const realCreateAgentRunQueue = agentRunQueueModule.createAgentRunQueue;
const realCreatePlannerShowQueue =
  plannerShowQueueModule.createPlannerShowQueue;
let lastShowPlanner: SessionPlanner | undefined;

/** The Planner show queue module, recording the planner each connection's show queue receives. */
export function capturingPlannerShowQueueModule() {
  return {
    ...plannerShowQueueModule,
    createPlannerShowQueue: (options: PlannerShowQueueOptions) => {
      lastShowPlanner = options.planner;
      return realCreatePlannerShowQueue(options);
    },
  };
}

/** The Agent Run queue module, recording each connection's internals in {@link sessionInternals}. */
export function capturingAgentRunQueueModule() {
  return {
    ...agentRunQueueModule,
    createAgentRunQueue: (options: AgentRunQueueOptions): AgentRunQueue => {
      const planner = lastShowPlanner;
      if (planner === undefined)
        throw new Error('the connection created no show queue');
      lastShowPlanner = undefined;
      const queue = realCreateAgentRunQueue(options);
      sessionInternals.push({
        queue,
        transcript: options.transcript,
        toolResults: options.toolResults,
        planner,
      });
      return queue;
    },
  };
}

/** Options of {@link openAgentSession}. */
export interface AgentSessionOverrides {
  readonly time?: FakeAgentRunTime;
  readonly model?: AgentConfig['model'];
  readonly tools?: AgentConfig['tools'];
  readonly budgets?: AgentConfig['budgets'];
  readonly planner?: ClarifyingPlanner;
  readonly acknowledgementTimeoutMs?: number;
}

/**
 * Opens one agent connection through `createEngine(...).openConnection(...)`
 * with fake run time, records its wire events and every Engine diagnostic,
 * and exposes the session internals the connection created.
 */
export function openAgentSession(overrides: AgentSessionOverrides = {}) {
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

/** A Planner that keeps the screen as it is. */
export const nothingToShowPlanner: ClarifyingPlanner = (input) =>
  Promise.resolve(
    ok({
      type: 'plan',
      rationale: 'Nothing to show.',
      executionPlan: [],
      layout: tilingLayoutOf(input.request),
    }),
  );

/**
 * A read-only `latest_order` Server Tool that records the arguments and
 * context of every call.
 */
export function orderTool(
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

/** A typed utterance on a tiling Chart. */
export function utterance(
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

/** The intent facts the `latest_order` tool reports for an order. */
export function orderFacts(order: typeof LATEST_ORDER) {
  return { orderId: order.orderId, itemCount: order.items.length };
}

/** A tiling Chart holding the three-view calendar Vessel. */
export function calendarChart(): ChartRequest {
  return makeTilingRequest({ vessels: [threeViewCalendarVessel] });
}

/** A Planner that runs `addEvent` on the calendar and keeps the layout. */
export const addEventPlanner: ClarifyingPlanner = (input) =>
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

/** The `ui_change` events among `events`, in order. */
export function uiChangesOf(
  events: readonly AgentEvent[],
): AgentUiChangeEvent[] {
  return events.filter(
    (event): event is AgentUiChangeEvent => event.type === 'ui_change',
  );
}

/** A `ui_applied` that reports every Action of `change` as applied on `chart`. */
export function acknowledgementOf(
  change: AgentUiChangeEvent,
  chart: ChartRequest,
) {
  return {
    type: 'ui_applied',
    status: 'applied',
    version: AGENT_WIRE_VERSION,
    changeId: change.changeId,
    chart,
    actionOutcomes: change.response.executionPlan.map(() => ({ ok: true })),
  } as const;
}

/** Resolves once `condition` holds, checking once per macrotask. Throws after 100 checks. */
export async function waitUntil(condition: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (condition()) return;
    await new Promise((resolve) => {
      setImmediate(resolve);
    });
  }
  throw new Error('condition never held');
}

/** Lets 20 macrotasks run, so work started by a stopped run can surface. */
export async function settle(): Promise<void> {
  for (let tick = 0; tick < 20; tick += 1) {
    await new Promise((resolve) => {
      setImmediate(resolve);
    });
  }
}

/** The run id of the `accepted` event for `inputId`. Throws when there is none. */
export function runIdOf(events: readonly AgentEvent[], inputId: string): RunId {
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

/** The tiling layout of a Chart. Throws for any other layout. */
export function tilingLayoutOf(request: ChartRequest) {
  if (request.layout.type !== 'tiling')
    throw new Error('agent session tests send tiling Charts');
  return request.layout;
}
