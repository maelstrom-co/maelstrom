import { expect, mock, test } from 'bun:test';

import {
  AGENT_WIRE_VERSION,
  type AgentEvent,
  type AgentUiAppliedInput,
  AssistantInjectionMessage,
  ChartRequestMessage,
  err,
  MessageId,
  ok,
  SessionId,
} from '@maelstrom-co/protocol';
import { install } from '@sinonjs/fake-timers';

import {
  type AgentConnection,
  createEngine,
  createInMemoryStore,
  type Engine,
  type HistoryConfig,
  type HistoryStore,
  type PlanningInput,
  validationError,
} from '../../index.js';
import {
  buildGridResponse,
  makeGridRequest,
  silentLogger,
} from '../__test-helpers__/fixtures.js';

const sessionId = SessionId('native-history');
const response = () =>
  buildGridResponse({ executionPlan: [], userMessage: 'Planned calendar' });
const submit = (connection: AgentConnection, id: string) =>
  connection.send({
    type: 'utterance',
    version: AGENT_WIRE_VERSION,
    inputId: MessageId(id),
    text: id,
    source: 'text',
    chart: makeGridRequest(),
  });
function observe(engine: Engine, id = sessionId) {
  const connection = engine.openConnection({ sessionId: id, user: null });
  const events: AgentEvent[] = [];
  connection.subscribe((event) => events.push(event));
  return { connection, events };
}
function acknowledge(
  connection: AgentConnection,
  events: AgentEvent[],
  status: AgentUiAppliedInput['status'] = 'applied',
) {
  const change = events.filter((event) => event.type === 'ui_change').at(-1);
  if (!change) throw new Error('Missing UI change');
  return connection.send({
    type: 'ui_applied',
    version: AGENT_WIRE_VERSION,
    changeId: change.changeId,
    status,
    chart: makeGridRequest(),
    actionOutcomes: [],
  });
}
async function inject(engine: Engine, content: string, id = sessionId) {
  expect(
    (
      await engine.handle(
        AssistantInjectionMessage({
          sessionId: id,
          id: MessageId('seed'),
          timestamp: 1,
          content,
        }),
      )
    ).ok,
  ).toBe(true);
}
const drain = () => new Promise<void>((resolve) => setImmediate(resolve));

test.each(['applied', 'failed'] as const)(
  'queued turns see recorded planning history after %s acknowledgement',
  async (status) => {
    const backing = createInMemoryStore();
    const writing = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const planned: PlanningInput[] = [];
    const store: HistoryStore = {
      ...backing,
      async append(id, entry) {
        if (entry.kind === 'turn' && entry.input.id === MessageId('first')) {
          writing.resolve();
          await release.promise;
        }
        return backing.append(id, entry);
      },
    };
    const engine = createEngine({
      logger: silentLogger,
      retry: false,
      history: { store },
      planner: async (input) => {
        planned.push(input);
        return ok(response());
      },
    });
    await inject(engine, 'Keep calendar visible');
    const { connection, events } = observe(engine);
    try {
      const first = submit(connection, 'first');
      await writing.promise;
      const queued = submit(connection, 'second');
      expect(planned[0]?.history).toEqual([
        { role: 'assistant', content: 'Keep calendar visible' },
      ]);
      expect(events.some((event) => event.type === 'ui_change')).toBe(false);
      release.resolve();
      await first;
      expect(planned).toHaveLength(1);
      const recorded = await backing.get(sessionId);
      expect(recorded.at(-1)).toMatchObject({
        kind: 'turn',
        input: { id: 'first', sessionId },
        output: { response: { userMessage: 'Planned calendar' } },
      });
      expect(events.some((event) => event.type === 'finished')).toBe(false);
      await acknowledge(connection, events, status);
      await queued;
      expect(planned.map((input) => input.messageId)).toEqual(
        ['first', 'second'].map(MessageId),
      );
      expect(planned[1]?.history).toEqual([
        { role: 'assistant', content: 'Keep calendar visible' },
        { role: 'user', content: 'first' },
        { role: 'assistant', content: 'Planned calendar' },
      ]);
      expect(
        (await backing.get(sessionId)).map((entry) => entry.input.id),
      ).toEqual(['seed', 'first', 'second'].map(MessageId));
    } finally {
      release.resolve();
      connection.close();
    }
  },
);

test('configured history crosses connections within a session without cached-response replay', async () => {
  const backing = createInMemoryStore();
  const lookup = mock(backing.getResponseById);
  const planned: PlanningInput[] = [];
  const engine = createEngine({
    logger: silentLogger,
    retry: false,
    history: { store: { ...backing, getResponseById: lookup } },
    planner: async (input) => {
      planned.push(input);
      return ok(
        buildGridResponse({
          executionPlan: [],
          userMessage: `Plan ${planned.length}`,
        }),
      );
    },
  });
  await inject(engine, 'Private context');
  expect(
    (
      await engine.handle(
        ChartRequestMessage({
          sessionId,
          id: MessageId('reused'),
          request: makeGridRequest(),
        }),
      )
    ).ok,
  ).toBe(true);
  lookup.mockClear();
  const first = observe(engine);
  const other = observe(engine, SessionId('other-session'));
  const replacement = observe(engine);
  try {
    await submit(first.connection, 'reused');
    expect(
      first.events.find((event) => event.type === 'ui_change')?.response
        .userMessage,
    ).toBe('Plan 2');
    expect(planned[1]?.history).toContainEqual({
      role: 'assistant',
      content: 'Plan 1',
    });
    await submit(first.connection, 'reused');
    expect(planned).toHaveLength(2);
    await acknowledge(first.connection, first.events, 'unknown');
    await submit(first.connection, 'stopped');
    expect(planned).toHaveLength(2);
    first.connection.close();
    await submit(other.connection, 'reused');
    expect(planned[2]?.history).toEqual([]);
    await submit(replacement.connection, 'reused');
    expect(
      replacement.events.find((event) => event.type === 'ui_change')?.response
        .userMessage,
    ).toBe('Plan 4');
    expect(lookup).not.toHaveBeenCalled();
    expect(
      (await backing.get(sessionId)).map((entry) => entry.input.id),
    ).toEqual(['seed', 'reused'].map(MessageId));
    expect(
      (await backing.get(SessionId('other-session'))).map(
        (entry) => entry.input.id,
      ),
    ).toEqual([MessageId('reused')]);
  } finally {
    first.connection.close();
    other.connection.close();
    replacement.connection.close();
  }
});

test.each([{ maxEntries: 1 }, { maxChars: 5 }])(
  'native history uses configured transforms, projection, and retention (%j)',
  async (budget) => {
    const store = createInMemoryStore();
    const histories: PlanningInput['history'][] = [];
    const history: HistoryConfig = {
      store,
      ...budget,
      transformEntry: (entry) => ({ ...entry, metadata: entry.input.id }),
      deriveLLMContext: (entry) => [
        { role: 'assistant', content: String(entry.metadata) },
      ],
    };
    const engine = createEngine({
      logger: silentLogger,
      retry: false,
      history,
      planner: async (input) => {
        histories.push(input.history);
        return ok(response());
      },
    });
    await inject(engine, 'Hello');
    const { connection, events } = observe(engine);
    try {
      await submit(connection, 'one');
      const queued = submit(connection, 'two');
      await acknowledge(connection, events);
      await queued;
      expect(histories).toEqual([
        [{ role: 'assistant', content: 'seed' }],
        [{ role: 'assistant', content: 'one' }],
      ]);
      expect(await store.get(sessionId)).toMatchObject([
        { kind: 'turn', input: { id: 'two' }, metadata: 'two' },
      ]);
    } finally {
      connection.close();
    }
  },
);

test('a history read failure fails only that run and releases queued work without planning on empty context', async () => {
  const backing = createInMemoryStore();
  const reading = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  let reads = 0;
  const planned: PlanningInput[] = [];
  const error = mock(() => {});
  const engine = createEngine({
    logger: { ...silentLogger, error },
    retry: false,
    history: {
      store: {
        ...backing,
        async get(id) {
          if (++reads === 1) {
            reading.resolve();
            await release.promise;
            throw new Error('read unavailable');
          }
          return backing.get(id);
        },
      },
    },
    planner: async (input) => {
      planned.push(input);
      return ok(response());
    },
  });
  const { connection, events } = observe(engine);
  try {
    const first = submit(connection, 'unreadable');
    await reading.promise;
    const queued = submit(connection, 'next');
    release.resolve();
    await Promise.all([first, queued]);
    expect(planned.map((input) => input.messageId)).toEqual([
      MessageId('next'),
    ]);
    expect(events.find((event) => event.type === 'finished')).toMatchObject({
      ok: false,
      code: 'HistoryError',
      reply: '',
    });
    expect(
      (await backing.get(sessionId)).map((entry) => entry.input.id),
    ).toEqual([MessageId('next')]);
    expect(error).toHaveBeenCalledWith(
      'Failed to load history context',
      expect.any(Error),
      expect.objectContaining({
        op: 'get_llm_context',
        messageId: 'unreadable',
        sessionId,
      }),
    );
  } finally {
    release.resolve();
    connection.close();
  }
});

test.each(['append', 'replace', 'transform'] as const)(
  'a %s failure is advisory and does not turn a usable plan into failed application',
  async (operation) => {
    const backing = createInMemoryStore();
    const error = mock(() => {});
    const fail = () => {
      throw new Error('storage unavailable');
    };
    const engine = createEngine({
      logger: { ...silentLogger, error },
      retry: false,
      history: {
        maxEntries: 1,
        store: {
          ...backing,
          append: async (id, entry) =>
            operation === 'append' && entry.kind === 'turn'
              ? fail()
              : backing.append(id, entry),
          replace:
            operation === 'replace' ? async () => fail() : backing.replace,
        },
        transformEntry: (entry) =>
          operation === 'transform' && entry.kind === 'turn' ? fail() : entry,
      },
      planner: async () => ok(response()),
    });
    await inject(engine, 'Seed');
    const { connection, events } = observe(engine);
    try {
      await submit(connection, 'advisory');
      expect(events.some((event) => event.type === 'finished')).toBe(false);
      await acknowledge(connection, events);
      expect(events.at(-1)).toMatchObject({
        type: 'finished',
        ok: true,
        reply: 'Planned calendar',
      });
      expect(error).toHaveBeenCalledWith(
        'Failed to record turn',
        expect.any(Error),
        { op: 'record_turn', messageId: 'advisory', sessionId },
      );
      expect(
        (await backing.get(sessionId)).map((entry) => entry.input.id),
      ).toEqual(
        (operation === 'replace' ? ['seed', 'advisory'] : ['seed']).map(
          MessageId,
        ),
      );
    } finally {
      connection.close();
    }
  },
);

test.each(['error', 'invalid-response'])(
  'unsuccessful planning never enters history (%s)',
  async (failure) => {
    const store = createInMemoryStore();
    const engine = createEngine({
      logger: silentLogger,
      retry: false,
      history: { store },
      planner: async () =>
        failure === 'error'
          ? err(validationError('Refused', 'planner'))
          : ok(buildGridResponse({ userMessage: '' })),
    });
    const { connection, events } = observe(engine);
    try {
      await submit(connection, 'failed-plan');
      expect(events.at(-1)).toMatchObject({ type: 'finished', ok: false });
      expect(events.some((event) => event.type === 'ui_change')).toBe(false);
      expect(await store.get(sessionId)).toEqual([]);
    } finally {
      connection.close();
    }
  },
);

test.each(['unknown', 'timeout'])(
  'planning history does not permit queued work after %s application',
  async (outcome) => {
    const time = install({ toFake: ['setTimeout', 'clearTimeout'] });
    const store = createInMemoryStore();
    const planner = mock(async () => ok(response()));
    const engine = createEngine({
      logger: silentLogger,
      retry: false,
      history: { store },
      planner,
    });
    const { connection, events } = observe(engine);
    try {
      await submit(connection, 'uncertain');
      const queued = submit(connection, 'queued');
      if (outcome === 'unknown')
        await acknowledge(connection, events, 'unknown');
      else await time.tickAsync(30_000);
      await queued;
      await submit(connection, 'later');
      expect(planner).toHaveBeenCalledTimes(1);
      expect(events.filter((event) => event.type === 'finished')).toMatchObject(
        [
          { ok: false, reason: 'error' },
          { ok: false, reason: 'cancelled' },
        ],
      );
      expect(events.some((event) => event.type === 'message')).toBe(false);
      expect(
        (await store.get(sessionId)).map((entry) => entry.input.id),
      ).toEqual([MessageId('uncertain')]);
    } finally {
      connection.close();
      time.uninstall();
    }
  },
);

test.each([
  { phase: 'read', reject: false },
  { phase: 'read', reject: true },
  { phase: 'planner', reject: false },
  { phase: 'append', reject: false },
  { phase: 'append', reject: true },
])(
  'close releases sends and prevents later work during $phase (reject: $reject)',
  async ({ phase, reject }) => {
    const backing = createInMemoryStore();
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    async function wait() {
      entered.resolve();
      await release.promise;
      if (reject) throw new Error('late storage failure');
    }
    const planner = mock(async () => {
      if (phase === 'planner') await wait();
      return ok(response());
    });
    const append = mock(
      async (id: SessionId, entry: Parameters<HistoryStore['append']>[1]) => {
        if (phase === 'append') await wait();
        return backing.append(id, entry);
      },
    );
    const engine = createEngine({
      logger: silentLogger,
      retry: false,
      planner,
      history: {
        store: {
          ...backing,
          append,
          async get(id) {
            if (phase === 'read') await wait();
            return backing.get(id);
          },
        },
      },
    });
    const { connection, events } = observe(engine);
    try {
      const active = submit(connection, 'active');
      await entered.promise;
      const queued = submit(connection, 'queued');
      connection.close();
      await Promise.all([active, queued]);
      const before = [...events];
      release.resolve();
      await drain();
      expect(events).toEqual(before);
      expect(events.some((event) => event.type === 'ui_change')).toBe(false);
      expect(planner).toHaveBeenCalledTimes(phase === 'read' ? 0 : 1);
      expect(append).toHaveBeenCalledTimes(phase === 'append' ? 1 : 0);
      expect(
        (await backing.get(sessionId)).map((entry) => entry.input.id),
      ).toEqual(phase === 'append' && !reject ? [MessageId('active')] : []);
    } finally {
      release.resolve();
      connection.close();
      await drain();
    }
  },
);
