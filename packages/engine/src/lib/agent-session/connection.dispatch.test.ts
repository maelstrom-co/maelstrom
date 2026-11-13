import { expect, mock, test } from 'bun:test';

import {
  AGENT_WIRE_VERSION,
  type AgentChartRequestInput,
  type AgentEvent,
  type AgentUiAppliedInput,
  type ChartRequest,
  InstanceId,
  MessageId,
  ok,
  SessionId,
  type UpdateReason,
} from '@maelstrom-co/protocol';
import { install } from '@sinonjs/fake-timers';

import {
  type AgentConnection,
  createEngine,
  createInMemoryStore,
  type Engine,
  type HistoryStore,
  type OpenConnectionOptions,
  type PlanningInput,
} from '../../index.js';
import {
  buildGridResponse,
  makeGridRequest,
  makeTilingRequest,
  silentLogger,
} from '../__test-helpers__/fixtures.js';

const sessionId = SessionId('native-dispatch');
const response = () => buildGridResponse({ executionPlan: [] });
const input = (
  id: string,
  request = makeGridRequest(),
): AgentChartRequestInput => ({
  type: 'chart_request',
  version: AGENT_WIRE_VERSION,
  inputId: MessageId(id),
  request,
});
const utterance = (id: string) => ({
  type: 'utterance',
  version: AGENT_WIRE_VERSION,
  inputId: MessageId(id),
  text: id,
  source: 'text',
  chart: makeGridRequest(),
});
function observe(engine: Engine, options: Partial<OpenConnectionOptions> = {}) {
  const connection = engine.openConnection({
    sessionId,
    user: null,
    ...options,
  });
  const events: AgentEvent[] = [];
  connection.subscribe((event) => events.push(event));
  return { connection, events };
}
function acknowledge(
  connection: AgentConnection,
  events: AgentEvent[],
  status: AgentUiAppliedInput['status'] = 'applied',
  chart = makeGridRequest(),
) {
  const change = events.filter((event) => event.type === 'ui_change').at(-1);
  if (!change) throw new Error('Missing UI change');
  return connection.send({
    type: 'ui_applied',
    version: AGENT_WIRE_VERSION,
    changeId: change.changeId,
    status,
    chart,
    actionOutcomes: [],
  });
}
const resized = (columns: number) =>
  makeGridRequest({
    context: {
      layoutMode: 'grid',
      chartDimensions: { columns, rows: 8 },
      updateReasons: [
        {
          type: 'chart_resize',
          previous: { columns: 12, rows: 8 },
          current: { columns, rows: 8 },
        },
      ],
    },
  });

test.each(['applied', 'failed'] as const)(
  'the next dispatch owns its full planning request after %s evidence captures an older Chart',
  async (status) => {
    const planned: PlanningInput[] = [];
    const { connection, events } = observe(
      createEngine({
        logger: silentLogger,
        retry: false,
        planner: async (plan) => {
          planned.push(plan);
          if (plan.request.layout.type === 'grid') return ok(response());
          return ok({
            type: 'plan',
            userMessage: 'Current Chart',
            rationale: '',
            executionPlan: [],
            layout: plan.request.layout,
          });
        },
      }),
    );
    try {
      await connection.send(utterance('first'));
      await acknowledge(connection, events, status, resized(18));
      const fresh: ChartRequest = {
        ...makeTilingRequest(),
        context: { ...resized(24).context, layoutMode: 'tiling' },
        skipReply: true,
        intentFacts: { selected: 'event-2' },
      };
      await connection.send(input('next', fresh));
      expect(planned).toHaveLength(2);
      expect(planned[1]?.request).toEqual(fresh);
      expect(events.filter((event) => event.type === 'ui_change')).toHaveLength(
        2,
      );
    } finally {
      connection.close();
    }
  },
);

test('admission detaches a dispatch snapshot before user callbacks can mutate its source', async () => {
  const prop = { selection: { id: 'original' } };
  const defaultValue = { selection: { id: 'default' } };
  const candidate = { selection: { id: 'candidate' } };
  const request = {
    ...resized(18),
    context: {
      ...resized(18).context,
      chartDimensions: { columns: 18, rows: 8 },
    },
    vessels: makeGridRequest().vessels.map((vessel) => ({
      ...vessel,
      variants: Object.fromEntries(
        Object.entries(vessel.variants).map(([name, variant]) => [
          name,
          {
            ...variant,
            props: { ...variant.props, nested: prop },
            actions: variant.actions.map((action) => ({
              ...action,
              parameters: [
                {
                  name: 'selection',
                  description: 'Selected event',
                  type: 'object' as const,
                  defaultValue,
                  enum: [candidate],
                },
              ],
            })),
          },
        ]),
      ),
    })),
  };
  const captured = structuredClone(request);
  const planned: PlanningInput[] = [];
  const { connection } = observe(
    createEngine({
      logger: silentLogger,
      retry: false,
      planner: async (plan) => {
        planned.push(plan);
        return ok(response());
      },
    }),
  );
  connection.subscribe((event) => {
    if (event.type !== 'accepted') return;
    request.context.chartDimensions.columns = 99;
    prop.selection.id = 'changed';
    defaultValue.selection.id = 'changed';
    candidate.selection.id = 'changed';
  });
  try {
    await connection.send(input('captured', request));
    expect(request.context.chartDimensions.columns).toBe(99);
    expect(planned[0]?.request).toEqual(captured);
  } finally {
    connection.close();
  }
});

test.each(['invalid_input', 'unknown_change'] as const)(
  'dispatch from an idle %s callback starts after ordered delivery',
  async (code) => {
    const planner = mock(async () => ok(response()));
    const { connection, events } = observe(
      createEngine({ logger: silentLogger, retry: false, planner }),
    );
    let dispatched: Promise<void> | undefined;
    const secondObserver: string[] = [];
    connection.subscribe((event) => {
      if (event.type === 'error' && event.code === code)
        dispatched = connection.send(input('reentrant'));
    });
    connection.subscribe((event) => secondObserver.push(event.type));
    try {
      await connection.send(
        code === 'invalid_input'
          ? {}
          : {
              type: 'ui_applied',
              version: AGENT_WIRE_VERSION,
              changeId: 'missing',
              status: 'applied',
              chart: makeGridRequest(),
              actionOutcomes: [],
            },
      );
      expect(secondObserver.slice(0, 3)).toEqual([
        'error',
        'placeholder',
        'accepted',
      ]);
      await dispatched;
      expect(planner).toHaveBeenCalledTimes(1);
      await acknowledge(connection, events);
      await connection.send(input('next'));
      expect(planner).toHaveBeenCalledTimes(2);
    } finally {
      connection.close();
    }
  },
);

test('a dispatch that cannot detach its snapshot reserves no ID or planning slot', async () => {
  const planner = mock(async () => ok(response()));
  const { connection, events } = observe(
    createEngine({ logger: silentLogger, retry: false, planner }),
  );
  const request = makeGridRequest();
  const vessels = request.vessels.map((vessel) => ({
    ...vessel,
    variants: Object.fromEntries(
      Object.entries(vessel.variants).map(([name, variant]) => [
        name,
        {
          ...variant,
          props: { callback: () => undefined },
        },
      ]),
    ),
  }));
  try {
    await connection.send(input('same', { ...request, vessels }));
    expect(events).toEqual([
      expect.objectContaining({
        type: 'error',
        inputId: 'same',
        code: 'invalid_input',
      }),
    ]);
    expect(planner).not.toHaveBeenCalled();
    await connection.send(input('same'));
    expect(planner).toHaveBeenCalledTimes(1);
  } finally {
    connection.close();
  }
});

const resizeReason: UpdateReason = {
  type: 'chart_resize',
  previous: { columns: 12, rows: 8 },
  current: { columns: 18, rows: 8 },
};
const mutationReason: UpdateReason = {
  type: 'vessel_mutation',
  instanceId: InstanceId('calendar-main'),
  changes: 'Event added',
};
test.each([
  [resizeReason],
  [mutationReason],
  [
    resizeReason,
    mutationReason,
    { type: 'user_intent', intent: 'Show the event' },
  ],
] satisfies UpdateReason[][])(
  'automatic and mixed updates reach planning without fabricated intent: %j',
  async (...reasons) => {
    const planned: PlanningInput[] = [];
    const request = makeGridRequest({
      context: {
        layoutMode: 'grid',
        chartDimensions: { columns: 18, rows: 8 },
        updateReasons: reasons,
      },
    });
    const { connection, events } = observe(
      createEngine({
        logger: silentLogger,
        retry: false,
        planner: async (plan) => {
          planned.push(plan);
          return ok(response());
        },
      }),
    );
    try {
      await connection.send(input('updates', request));
      expect(planned[0]?.request).toEqual(request);
      expect(events.some((event) => event.type === 'finished')).toBe(false);
      await acknowledge(connection, events);
      expect(events.at(-1)).toMatchObject({ type: 'finished', ok: true });
    } finally {
      connection.close();
    }
  },
);

test.each(['utterance', 'chart_request'] as const)(
  'dispatch cannot queue a stale snapshot behind a planning %s',
  async (kind) => {
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const store = createInMemoryStore();
    const lookup = mock(store.getResponseById);
    const planned: PlanningInput[] = [];
    const { connection, events } = observe(
      createEngine({
        logger: silentLogger,
        retry: false,
        history: { store: { ...store, getResponseById: lookup } },
        planner: async (plan) => {
          planned.push(plan);
          entered.resolve();
          if (planned.length === 1) await release.promise;
          return ok(response());
        },
      }),
    );
    try {
      const first = connection.send(
        kind === 'utterance' ? utterance('first') : input('first'),
      );
      await entered.promise;
      await connection.send(input('next', resized(18)));
      expect(events.at(-1)).toMatchObject({
        type: 'error',
        inputId: 'next',
        code: 'connection_busy',
      });
      expect(events.filter((event) => event.type === 'accepted')).toHaveLength(
        1,
      );
      expect(planned).toHaveLength(1);
      expect(await store.get(sessionId)).toEqual([]);
      release.resolve();
      await first;
      await connection.send(input('next', resized(20)));
      expect(events.at(-1)).toMatchObject({
        type: 'error',
        code: 'connection_busy',
      });
      await acknowledge(connection, events);
      expect(planned).toHaveLength(1);
      const fresh = resized(24);
      await connection.send(input('next', fresh));
      expect(planned[1]?.request).toEqual(fresh);
      expect(planned[1]?.history.length).toBeGreaterThan(0);
      expect(
        (await store.get(sessionId)).map((entry) => entry.input.id),
      ).toEqual(['first', 'next'].map(MessageId));
      expect(lookup).not.toHaveBeenCalled();
    } finally {
      release.resolve();
      connection.close();
    }
  },
);

test('reentrant finishing callbacks cannot bypass accepted FIFO work with a dispatch snapshot', async () => {
  const planned: string[] = [];
  const attempts: Promise<void>[] = [];
  const { connection, events } = observe(
    createEngine({
      logger: silentLogger,
      retry: false,
      planner: async (plan) => {
        planned.push(plan.messageId);
        return ok(response());
      },
    }),
  );
  connection.subscribe((event) => {
    if (event.type === 'message' || event.type === 'finished')
      attempts.push(connection.send(input('reentrant')));
  });
  try {
    await connection.send(input('first'));
    const queued = connection.send(utterance('queued'));
    await acknowledge(connection, events);
    await queued;
    await Promise.all(attempts);
    expect(planned).toEqual(['first', 'queued']);
    expect(
      events
        .filter((event) => event.type === 'error')
        .map((event) => event.code),
    ).toEqual(['connection_busy', 'connection_busy']);
    await acknowledge(connection, events);
    await Promise.all(attempts);
    expect(planned).toEqual(['first', 'queued']);
    await connection.send(input('reentrant', resized(24)));
    expect(planned).toEqual(['first', 'queued', 'reentrant']);
  } finally {
    connection.close();
  }
});

test('invalid dispatches reserve no ID and accepted IDs deduplicate across native input kinds', async () => {
  const planner = mock(async () => ok(response()));
  const { connection, events } = observe(
    createEngine({ logger: silentLogger, retry: false, planner }),
  );
  try {
    await connection.send({
      ...input('same'),
      request: {
        ...makeGridRequest(),
        layout: { type: 'tiling', tree: [], instances: [] },
      },
    });
    expect(events.at(-1)).toMatchObject({
      type: 'error',
      inputId: 'same',
      code: 'invalid_input',
    });
    expect(planner).not.toHaveBeenCalled();
    await connection.send(input('same'));
    const count = events.length;
    await connection.send(input('same', resized(24)));
    await connection.send(utterance('same'));
    expect(events).toHaveLength(count);
    expect(planner).toHaveBeenCalledTimes(1);
    await acknowledge(connection, events);
    await connection.send(input('same'));
    expect(planner).toHaveBeenCalledTimes(1);
  } finally {
    connection.close();
  }
});

test('the dispatch slot stays occupied until advisory recording settles', async () => {
  const store = createInMemoryStore();
  const writing = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const history: HistoryStore = {
    ...store,
    async append(id, entry) {
      writing.resolve();
      await release.promise;
      return store.append(id, entry);
    },
  };
  const planner = mock(async () => ok(response()));
  const { connection, events } = observe(
    createEngine({
      logger: silentLogger,
      retry: false,
      planner,
      history: { store: history },
    }),
  );
  try {
    const first = connection.send(input('first'));
    await writing.promise;
    await connection.send(input('next'));
    expect(events.at(-1)).toMatchObject({
      type: 'error',
      code: 'connection_busy',
    });
    expect(events.some((event) => event.type === 'ui_change')).toBe(false);
    expect(planner).toHaveBeenCalledTimes(1);
    release.resolve();
    await first;
    expect((await store.get(sessionId)).map((entry) => entry.input.id)).toEqual(
      [MessageId('first')],
    );
    expect(events.at(-1)?.type).toBe('ui_change');
  } finally {
    release.resolve();
    connection.close();
  }
});

test('dispatch keeps skipReply explicit and does not silently enable replyless outcomes', async () => {
  const requests: ChartRequest[] = [];
  const { connection, events } = observe(
    createEngine({
      logger: silentLogger,
      retry: false,
      planner: async (plan) => {
        requests.push(plan.request);
        return ok({
          type: 'plan',
          rationale: '',
          executionPlan: [],
          layout: { positions: [] },
        });
      },
    }),
  );
  try {
    await connection.send(
      input('replyless', { ...makeGridRequest(), skipReply: true }),
    );
    expect(requests[0]?.skipReply).toBe(true);
    expect(events.at(-1)).toMatchObject({
      type: 'finished',
      ok: false,
      code: 'ValidationError',
    });
    expect(events.some((event) => event.type === 'ui_change')).toBe(false);
  } finally {
    connection.close();
  }
});

test.each(['unknown', 'timeout'] as const)(
  'a fresh dispatch cannot restart native admission after %s',
  async (ending) => {
    const time = install({ toFake: ['setTimeout', 'clearTimeout'] });
    const planner = mock(async () => ok(response()));
    const { connection, events } = observe(
      createEngine({ logger: silentLogger, retry: false, planner }),
      { acknowledgementTimeoutMs: 10 },
    );
    try {
      await connection.send(input('first'));
      const queued = connection.send(utterance('queued'));
      if (ending === 'unknown')
        await acknowledge(connection, events, 'unknown');
      else await time.tickAsync(10);
      await queued;
      await connection.send(input('fresh', resized(24)));
      expect(events.at(-1)).toMatchObject({
        type: 'error',
        inputId: 'fresh',
        code: 'session_stopped',
      });
      await acknowledge(connection, events);
      expect(events.at(-1)).toMatchObject({
        type: 'error',
        code: 'unknown_change',
      });
      expect(planner).toHaveBeenCalledTimes(1);
      expect(
        events
          .filter((event) => event.type === 'finished')
          .map((event) => event.reason),
      ).toEqual(['error', 'cancelled']);
    } finally {
      connection.close();
      time.uninstall();
    }
  },
);
