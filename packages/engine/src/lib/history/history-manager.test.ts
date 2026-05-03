import { describe, expect, test } from 'bun:test';

import type {
  ChartRequest,
  ChartResponseOutput,
  MaelstromResponse,
} from '@maelstrom-co/protocol';
import {
  AssistantInjectionMessage,
  ChartRequestMessage,
  MessageId,
  SessionId,
} from '@maelstrom-co/protocol';

import { makeGridRequest } from '../__test-helpers__/fixtures.js';
import type { HistoryEntry, HistoryStore } from './history-store.js';
import { createInMemoryStore } from './in-memory-store.js';
import { createHistoryManager } from './history-manager.js';

const defer = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};

// Adapts the shared makeGridRequest fixture, overriding the user_intent
// reason. Dropping the local hand-rolled request removed an
// `as unknown as ChartRequest` cast that was masking shape drift (the prior
// version used `chartDimensions: { width, height }` instead of
// `{ columns, rows }` — caught only because the cast silenced tsc).
const buildRequest = (intent: string): ChartRequest => {
  const base = makeGridRequest();
  return {
    ...base,
    context: {
      ...base.context,
      updateReasons: [{ type: 'user_intent', intent }],
    },
  };
};

const buildInput = (
  sessionId: ReturnType<typeof SessionId>,
  id: ReturnType<typeof MessageId>,
  intent: string,
  timestamp?: number,
): ChartRequestMessage =>
  ChartRequestMessage({
    sessionId,
    id,
    timestamp,
    request: buildRequest(intent),
  });

const buildOutput = (
  sessionId: ReturnType<typeof SessionId>,
  id: ReturnType<typeof MessageId>,
  userMessage: string,
): ChartResponseOutput => {
  const response: MaelstromResponse = {
    type: 'maelstrom_response',
    requestId: id,
    userMessage,
    rationale: '',
    executionPlan: [],
    layout: { type: 'grid', positions: [] },
  };
  return {
    type: 'chart_response',
    sessionId,
    id,
    response,
  };
};

// Spread `inner`'s methods and apply `overrides` on top so future
// HistoryStore additions only need bindings updated here, not in every
// inline mock. The explicit per-method spread (rather than `...inner`)
// makes a missing method on `inner` surface as a TypeScript error here
// rather than at each call site.
const wrap = (
  inner: HistoryStore,
  overrides: Partial<HistoryStore>,
): HistoryStore => ({
  append: inner.append.bind(inner),
  get: inner.get.bind(inner),
  replace: inner.replace.bind(inner),
  clear: inner.clear.bind(inner),
  getResponseById: inner.getResponseById.bind(inner),
  ...overrides,
});

const recordingStore = (): { store: HistoryStore; calls: string[] } => {
  const inner = createInMemoryStore();
  const calls: string[] = [];
  return {
    calls,
    store: wrap(inner, {
      async append(sid, entry) {
        calls.push(`append:${entry.kind}:${entry.input.id}`);
        return inner.append(sid, entry);
      },
    }),
  };
};

describe('HistoryManager.recordTurn', () => {
  test('persists a turn entry via the store', async () => {
    const store = createInMemoryStore();
    const mgr = createHistoryManager({
      store,
      maxEntries: 10,
      maxChars: 1_000,
    });
    const s = SessionId('s');
    const id = MessageId('t1');
    await mgr.recordTurn(buildInput(s, id, 'hello'), buildOutput(s, id, 'hi'));
    const entries = await store.get(s);
    expect(entries.length).toBe(1);
    expect(entries[0]?.kind).toBe('turn');
  });

  test('applies transformEntry to the entry before persistence', async () => {
    const store = createInMemoryStore();
    const mgr = createHistoryManager({
      store,
      maxEntries: 10,
      maxChars: 1_000,
      transformEntry: (entry) =>
        entry.kind === 'turn'
          ? {
              ...entry,
              output: {
                ...entry.output,
                response: {
                  ...entry.output.response,
                  rationale: '[redacted]',
                },
              },
            }
          : entry,
    });
    const s = SessionId('s');
    const id = MessageId('t1');
    await mgr.recordTurn(buildInput(s, id, 'hello'), buildOutput(s, id, 'hi'));
    const [entry] = await store.get(s);
    if (entry?.kind !== 'turn') {
      throw new Error('expected turn entry');
    }
    expect(entry.output.response.rationale).toBe('[redacted]');
  });

  test('applies transformEntry to injection entries too (covers the non-turn branch)', async () => {
    const store = createInMemoryStore();
    const mgr = createHistoryManager({
      store,
      maxEntries: 10,
      maxChars: 1_000,
      // The transform must run for both kinds. Earlier coverage only
      // exercised the turn branch; this one pins the injection branch so a
      // future refactor can't silently drop it.
      transformEntry: (entry) =>
        entry.kind === 'injection'
          ? {
              ...entry,
              input: {
                ...entry.input,
                content: `[wrapped] ${entry.input.content}`,
              },
            }
          : entry,
    });
    const s = SessionId('s');
    await mgr.addAssistantMessage(
      AssistantInjectionMessage({
        sessionId: s,
        content: 'hi',
        id: MessageId('inj-1'),
      }),
    );
    const [entry] = await store.get(s);
    if (entry?.kind !== 'injection') throw new Error('expected injection');
    expect(entry.input.content).toBe('[wrapped] hi');
  });

  test('locks input.id post-transformEntry (hook cannot break dedup)', async () => {
    const store = createInMemoryStore();
    const mgr = createHistoryManager({
      store,
      maxEntries: 10,
      maxChars: 1_000,
      transformEntry: (entry) =>
        entry.kind === 'turn'
          ? {
              ...entry,
              input: { ...entry.input, id: MessageId('forged-id') },
            }
          : entry,
    });
    const s = SessionId('s');
    await mgr.recordTurn(
      buildInput(s, MessageId('original-id'), 'hi'),
      buildOutput(s, MessageId('original-id'), 'hello'),
    );
    const [entry] = await store.get(s);
    if (entry?.kind !== 'turn') throw new Error('expected turn entry');
    expect(entry.input.id).toBe(MessageId('original-id'));
  });

  test('locks input.timestamp post-transformEntry (hook cannot reorder history)', async () => {
    const store = createInMemoryStore();
    const mgr = createHistoryManager({
      store,
      maxEntries: 10,
      maxChars: 1_000,
      transformEntry: (entry) =>
        entry.kind === 'turn'
          ? {
              ...entry,
              input: { ...entry.input, timestamp: 999_999_999 },
            }
          : entry,
    });
    const s = SessionId('s');
    const inputAt100 = ChartRequestMessage({
      sessionId: s,
      id: MessageId('t'),
      timestamp: 100,
      request: buildRequest('hi'),
    });
    await mgr.recordTurn(inputAt100, buildOutput(s, MessageId('t'), 'hello'));
    const [entry] = await store.get(s);
    if (entry?.kind !== 'turn') throw new Error('expected turn entry');
    expect(entry.input.timestamp).toBe(100);
  });

  test('locks kind post-transformEntry (hook cannot flip discriminator)', async () => {
    const store = createInMemoryStore();
    const mgr = createHistoryManager({
      store,
      maxEntries: 10,
      maxChars: 1_000,
      // Hook tries to flip a turn into an injection. The lock must restore
      // the original discriminator so downstream pattern-matching stays
      // consistent with the entry's actual shape.
      transformEntry: (entry) =>
        ({
          kind: 'injection',
          input: AssistantInjectionMessage({
            sessionId: entry.input.sessionId,
            content: 'forged',
            id: entry.input.id,
          }),
        }) as HistoryEntry,
    });
    const s = SessionId('s');
    await mgr.recordTurn(
      buildInput(s, MessageId('t'), 'hi'),
      buildOutput(s, MessageId('t'), 'hello'),
    );
    const [entry] = await store.get(s);
    expect(entry?.kind).toBe('turn');
  });

  test('locks input.sessionId post-transformEntry on injections', async () => {
    const store = createInMemoryStore();
    const mgr = createHistoryManager({
      store,
      maxEntries: 10,
      maxChars: 1_000,
      transformEntry: (entry) =>
        entry.kind === 'injection'
          ? {
              ...entry,
              input: { ...entry.input, sessionId: SessionId('forged-session') },
            }
          : entry,
    });
    const real = SessionId('real-session');
    await mgr.addAssistantMessage(
      AssistantInjectionMessage({
        sessionId: real,
        content: 'hi',
        id: MessageId('inj-1'),
      }),
    );
    const [entry] = await store.get(real);
    if (entry?.kind !== 'injection')
      throw new Error('expected injection entry');
    expect(entry.input.sessionId).toBe(real);
  });

  test('disables the entry cap when maxEntries is omitted', async () => {
    const store = createInMemoryStore();
    const mgr = createHistoryManager({ store, maxChars: 10_000 });
    const s = SessionId('s');
    for (let i = 0; i < 5; i += 1) {
      await mgr.recordTurn(
        buildInput(s, MessageId(`t${i}`), `intent-${i}`),
        buildOutput(s, MessageId(`t${i}`), `resp-${i}`),
      );
    }
    expect((await store.get(s)).length).toBe(5);
  });

  test('disables the char budget when maxChars is omitted', async () => {
    const store = createInMemoryStore();
    const mgr = createHistoryManager({ store, maxEntries: 100 });
    const s = SessionId('s');
    // Enough entries that a small char budget would truncate most of them.
    for (let i = 0; i < 10; i += 1) {
      await mgr.recordTurn(
        buildInput(s, MessageId(`t${i}`), 'x'.repeat(200)),
        buildOutput(s, MessageId(`t${i}`), 'y'.repeat(200)),
      );
    }
    expect((await store.get(s)).length).toBe(10);
  });

  test('enforces truncation after append (newest-first)', async () => {
    const store = createInMemoryStore();
    const mgr = createHistoryManager({
      store,
      maxEntries: 2,
      maxChars: 10_000,
    });
    const s = SessionId('s');
    await mgr.recordTurn(
      buildInput(s, MessageId('t1'), 'a'),
      buildOutput(s, MessageId('t1'), 'A'),
    );
    await mgr.recordTurn(
      buildInput(s, MessageId('t2'), 'b'),
      buildOutput(s, MessageId('t2'), 'B'),
    );
    await mgr.recordTurn(
      buildInput(s, MessageId('t3'), 'c'),
      buildOutput(s, MessageId('t3'), 'C'),
    );
    const entries = await store.get(s);
    expect(entries.length).toBe(2);
    expect(entries.map((e) => (e.kind === 'turn' ? e.input.id : ''))).toEqual([
      MessageId('t2'),
      MessageId('t3'),
    ]);
  });

  test('serializes concurrent recordTurn calls on the same session', async () => {
    const { store, calls } = recordingStore();
    // Make append visibly span multiple microtask ticks so overlap is observable.
    const slowAppend = async (
      sid: ReturnType<typeof SessionId>,
      entry: HistoryEntry,
    ) => {
      calls.push(`start:${entry.input.id}`);
      await Promise.resolve();
      await Promise.resolve();
      calls.push(`end:${entry.input.id}`);
      return { inserted: true };
    };
    const wrappedStore = wrap(store, { append: slowAppend });

    const mgr = createHistoryManager({
      store: wrappedStore,
      maxEntries: 10,
      maxChars: 1_000,
    });
    const s = SessionId('s');
    calls.length = 0;
    await Promise.all([
      mgr.recordTurn(
        buildInput(s, MessageId('a'), 'first'),
        buildOutput(s, MessageId('a'), 'A'),
      ),
      mgr.recordTurn(
        buildInput(s, MessageId('b'), 'second'),
        buildOutput(s, MessageId('b'), 'B'),
      ),
    ]);

    expect(calls).toEqual([
      'start:' + MessageId('a'),
      'end:' + MessageId('a'),
      'start:' + MessageId('b'),
      'end:' + MessageId('b'),
    ]);
  });

  test('parallelizes recordTurn calls across different sessions', async () => {
    const order: string[] = [];
    const wrappedStore = wrap(createInMemoryStore(), {
      async append(_sid, entry) {
        order.push(`start:${entry.input.id}`);
        await Promise.resolve();
        await Promise.resolve();
        order.push(`end:${entry.input.id}`);
        return { inserted: true };
      },
    });
    const mgr = createHistoryManager({
      store: wrappedStore,
      maxEntries: 10,
      maxChars: 1_000,
    });
    const a = SessionId('a');
    const b = SessionId('b');
    await Promise.all([
      mgr.recordTurn(
        buildInput(a, MessageId('x'), 'intent-a'),
        buildOutput(a, MessageId('x'), 'A'),
      ),
      mgr.recordTurn(
        buildInput(b, MessageId('y'), 'intent-b'),
        buildOutput(b, MessageId('y'), 'B'),
      ),
    ]);

    // With parallel sessions the two starts come first, then the two ends.
    expect(order.slice(0, 2).sort()).toEqual(
      ['start:' + MessageId('x'), 'start:' + MessageId('y')].sort(),
    );
    expect(order.slice(2).sort()).toEqual(
      ['end:' + MessageId('x'), 'end:' + MessageId('y')].sort(),
    );
  });
});

describe('HistoryManager.addAssistantMessage', () => {
  test('persists an injection and reports inserted=true on a new id', async () => {
    const store = createInMemoryStore();
    const mgr = createHistoryManager({
      store,
      maxEntries: 10,
      maxChars: 1_000,
    });
    const s = SessionId('s');
    const result = await mgr.addAssistantMessage(
      AssistantInjectionMessage({
        sessionId: s,
        content: 'seeded',
        id: MessageId('inj-1'),
      }),
    );
    expect(result.inserted).toBe(true);
    const entries = await store.get(s);
    expect(entries.length).toBe(1);
    expect(entries[0]?.kind).toBe('injection');
  });

  test('reports inserted=false on a duplicate message id (silent skip)', async () => {
    const store = createInMemoryStore();
    const mgr = createHistoryManager({
      store,
      maxEntries: 10,
      maxChars: 1_000,
    });
    const s = SessionId('s');
    const id = MessageId('inj-1');
    await mgr.addAssistantMessage(
      AssistantInjectionMessage({ sessionId: s, content: 'first', id }),
    );
    const second = await mgr.addAssistantMessage(
      AssistantInjectionMessage({ sessionId: s, content: 'second', id }),
    );
    expect(second.inserted).toBe(false);
  });

  test('append fires through immediately even while recordTurn holds the session lock', async () => {
    const turnGate = defer<void>();
    const inner = createInMemoryStore();
    const events: string[] = [];
    const wrappedStore = wrap(inner, {
      async append(sid, entry) {
        events.push(`append-start:${entry.kind}`);
        if (entry.kind === 'turn') {
          await turnGate.promise;
        }
        const r = await inner.append(sid, entry);
        events.push(`append-end:${entry.kind}`);
        return r;
      },
    });
    const mgr = createHistoryManager({
      store: wrappedStore,
      maxEntries: 10,
      maxChars: 1_000,
    });
    const s = SessionId('s');

    // recordTurn parks inside its append (mutex held).
    const turnPromise = mgr.recordTurn(
      buildInput(s, MessageId('t'), 'intent'),
      buildOutput(s, MessageId('t'), 'A'),
    );
    for (let i = 0; i < 3; i += 1) await Promise.resolve();
    expect(events).toEqual(['append-start:turn']);

    // The injection's store.append must complete while the turn append is
    // still parked. The whole addAssistantMessage promise won't resolve yet
    // (its truncation step serializes via the mutex), but the append fires
    // through.
    const injectionPromise = mgr.addAssistantMessage(
      AssistantInjectionMessage({
        sessionId: s,
        content: 'seeded',
        id: MessageId('i'),
      }),
    );
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
    expect(events).toContain('append-end:injection');

    turnGate.resolve();
    await Promise.all([turnPromise, injectionPromise]);
  });

  test('runs truncation after a successful injection insert', async () => {
    const store = createInMemoryStore();
    const mgr = createHistoryManager({
      store,
      maxEntries: 3,
      maxChars: 10_000,
    });
    const s = SessionId('s');
    for (let i = 0; i < 5; i += 1) {
      await mgr.addAssistantMessage(
        AssistantInjectionMessage({
          sessionId: s,
          content: `inj-${i}`,
          id: MessageId(`i${i}`),
        }),
      );
    }
    expect((await store.get(s)).length).toBe(3);
  });

  test('serializes truncation across concurrent recordTurn + addAssistantMessage', async () => {
    // With maxEntries: 1, every successful insert triggers a replace().
    // Without serialization, the two replace() calls would race and one
    // could clobber the other's append. With serialization, the store
    // converges on exactly one entry — the newest by timestamp.
    const store = createInMemoryStore();
    const mgr = createHistoryManager({
      store,
      maxEntries: 1,
      maxChars: 10_000,
    });
    const s = SessionId('s');
    await Promise.all([
      mgr.recordTurn(
        buildInput(s, MessageId('t'), 'intent', 100),
        buildOutput(s, MessageId('t'), 'response'),
      ),
      mgr.addAssistantMessage(
        AssistantInjectionMessage({
          sessionId: s,
          content: 'inj',
          id: MessageId('i'),
          timestamp: 200,
        }),
      ),
    ]);
    const entries = await store.get(s);
    expect(entries.length).toBe(1);
    // The newer-by-timestamp entry is the one retained.
    expect(entries[0]?.kind).toBe('injection');
  });
});

describe('HistoryManager.getHistory', () => {
  test('returns full entries in insertion order', async () => {
    const store = createInMemoryStore();
    const mgr = createHistoryManager({
      store,
      maxEntries: 10,
      maxChars: 1_000,
    });
    const s = SessionId('s');
    await mgr.recordTurn(
      buildInput(s, MessageId('t1'), 'a'),
      buildOutput(s, MessageId('t1'), 'A'),
    );
    await mgr.addAssistantMessage(
      AssistantInjectionMessage({
        sessionId: s,
        content: 'seeded',
        id: MessageId('i1'),
      }),
    );
    const entries = await mgr.getHistory(s);
    expect(entries.map((e) => e.kind)).toEqual(['turn', 'injection']);
  });

  test('returns an empty array for an unknown session', async () => {
    const mgr = createHistoryManager({
      store: createInMemoryStore(),
      maxEntries: 10,
      maxChars: 1_000,
    });
    expect(await mgr.getHistory(SessionId('fresh'))).toEqual([]);
  });
});

describe('HistoryManager.getLLMContext', () => {
  test('turn produces user + assistant messages', async () => {
    const mgr = createHistoryManager({
      store: createInMemoryStore(),
      maxEntries: 10,
      maxChars: 1_000,
    });
    const s = SessionId('s');
    await mgr.recordTurn(
      buildInput(s, MessageId('t'), 'book me a flight'),
      buildOutput(s, MessageId('t'), 'sure, where to?'),
    );
    const ctx = await mgr.getLLMContext(s);
    expect(ctx).toEqual([
      { role: 'user', content: 'book me a flight' },
      { role: 'assistant', content: 'sure, where to?' },
    ]);
  });

  test('injection produces a single assistant message', async () => {
    const mgr = createHistoryManager({
      store: createInMemoryStore(),
      maxEntries: 10,
      maxChars: 1_000,
    });
    const s = SessionId('s');
    await mgr.addAssistantMessage(
      AssistantInjectionMessage({
        sessionId: s,
        content: 'FYI flights are cheap on Tuesdays',
        id: MessageId('i'),
      }),
    );
    const ctx = await mgr.getLLMContext(s);
    expect(ctx).toEqual([
      { role: 'assistant', content: 'FYI flights are cheap on Tuesdays' },
    ]);
  });

  test('preserves insertion order across kinds', async () => {
    const mgr = createHistoryManager({
      store: createInMemoryStore(),
      maxEntries: 10,
      maxChars: 1_000,
    });
    const s = SessionId('s');
    await mgr.recordTurn(
      buildInput(s, MessageId('t1'), 'hi'),
      buildOutput(s, MessageId('t1'), 'hello'),
    );
    await mgr.addAssistantMessage(
      AssistantInjectionMessage({
        sessionId: s,
        content: 'interlude',
        id: MessageId('i1'),
      }),
    );
    await mgr.recordTurn(
      buildInput(s, MessageId('t2'), 'ok'),
      buildOutput(s, MessageId('t2'), 'cool'),
    );
    const ctx = await mgr.getLLMContext(s);
    expect(ctx.map((m) => m.content)).toEqual([
      'hi',
      'hello',
      'interlude',
      'ok',
      'cool',
    ]);
  });

  test('returns an empty array for an unknown session', async () => {
    const mgr = createHistoryManager({
      store: createInMemoryStore(),
      maxEntries: 10,
      maxChars: 1_000,
    });
    expect(await mgr.getLLMContext(SessionId('fresh'))).toEqual([]);
  });

  test('emits an assistant message even when response.userMessage is empty', async () => {
    // Pin current behavior: the default projection does not filter empty
    // userMessage. If the prompt builder ever needs that filter, it should
    // own it explicitly rather than relying on this projection to elide.
    const mgr = createHistoryManager({
      store: createInMemoryStore(),
      maxEntries: 10,
      maxChars: 1_000,
    });
    const s = SessionId('s');
    await mgr.recordTurn(
      buildInput(s, MessageId('t'), 'hi'),
      buildOutput(s, MessageId('t'), ''),
    );
    const ctx = await mgr.getLLMContext(s);
    expect(ctx).toEqual([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: '' },
    ]);
  });

  test('orders by envelope timestamp regardless of insertion order', async () => {
    // Simulates: user sends chart_request at T=100, injection fires at T=150
    // while the LLM is still running, turn is recorded at real-time T=300.
    // Insertion order is [injection, turn] but timestamps say [turn, injection].
    const mgr = createHistoryManager({
      store: createInMemoryStore(),
      maxEntries: 10,
      maxChars: 1_000,
    });
    const s = SessionId('s');

    await mgr.addAssistantMessage(
      AssistantInjectionMessage({
        sessionId: s,
        content: 'injection-at-150',
        id: MessageId('inj'),
        timestamp: 150,
      }),
    );
    await mgr.recordTurn(
      buildInput(s, MessageId('turn'), 'request at 100', 100),
      buildOutput(s, MessageId('turn'), 'response'),
    );

    const ctx = await mgr.getLLMContext(s);
    expect(ctx.map((m) => m.content)).toEqual([
      'request at 100',
      'response',
      'injection-at-150',
    ]);
  });

  test('skips the user leg when the turn carried no user_intent reasons', async () => {
    const mgr = createHistoryManager({
      store: createInMemoryStore(),
      maxEntries: 10,
      maxChars: 1_000,
    });
    const s = SessionId('s');
    const base = makeGridRequest();
    const input = ChartRequestMessage({
      sessionId: s,
      id: MessageId('t'),
      request: {
        ...base,
        context: {
          ...base.context,
          updateReasons: [
            {
              type: 'chart_resize',
              previous: { columns: 5, rows: 5 },
              current: { columns: 10, rows: 10 },
            },
          ],
        },
      },
    });
    await mgr.recordTurn(input, buildOutput(s, MessageId('t'), 'relayed out'));
    const ctx = await mgr.getLLMContext(s);
    expect(ctx).toEqual([{ role: 'assistant', content: 'relayed out' }]);
  });

  test('uses a custom deriveLLMContext projection when provided', async () => {
    interface TurnMeta {
      readonly redacted: boolean;
    }
    const mgr = createHistoryManager<TurnMeta>({
      store: createInMemoryStore<TurnMeta>(),
      maxEntries: 10,
      maxChars: 1_000,
      transformEntry: (entry) =>
        entry.kind === 'turn'
          ? { ...entry, metadata: { redacted: true } }
          : entry,
      deriveLLMContext: (entry) => {
        if (entry.kind === 'turn' && entry.metadata?.redacted) {
          return [{ role: 'assistant', content: '[redacted]' }];
        }
        return [
          {
            role: 'assistant',
            content:
              entry.kind === 'turn'
                ? entry.output.response.userMessage
                : entry.input.content,
          },
        ];
      },
    });
    const s = SessionId('s');
    await mgr.recordTurn(
      buildInput(s, MessageId('t'), 'hi'),
      buildOutput(s, MessageId('t'), 'hello'),
    );
    const ctx = await mgr.getLLMContext(s);
    expect(ctx).toEqual([{ role: 'assistant', content: '[redacted]' }]);
  });
});

describe('HistoryManager.clear', () => {
  test('wipes the session from the store', async () => {
    const store = createInMemoryStore();
    const mgr = createHistoryManager({
      store,
      maxEntries: 10,
      maxChars: 1_000,
    });
    const s = SessionId('s');
    await mgr.recordTurn(
      buildInput(s, MessageId('t'), 'hi'),
      buildOutput(s, MessageId('t'), 'hello'),
    );
    await mgr.clear(s);
    expect(await store.get(s)).toEqual([]);
  });

  test('serializes against an in-flight recordTurn on the same session', async () => {
    const turnGate = defer<void>();
    const inner = createInMemoryStore();
    const wrappedStore = wrap(inner, {
      async append(sid, entry) {
        if (entry.kind === 'turn') {
          await turnGate.promise;
        }
        return inner.append(sid, entry);
      },
    });
    const mgr = createHistoryManager({
      store: wrappedStore,
      maxEntries: 10,
      maxChars: 1_000,
    });
    const s = SessionId('s');

    let clearSettled = false;
    const turnPromise = mgr.recordTurn(
      buildInput(s, MessageId('t'), 'hi'),
      buildOutput(s, MessageId('t'), 'hello'),
    );
    const clearPromise = mgr.clear(s).then(() => {
      clearSettled = true;
    });

    // Yield a few times to let both operations queue up.
    for (let i = 0; i < 5; i += 1) {
      await Promise.resolve();
    }
    // clear must not have completed — it's waiting behind the in-flight turn.
    expect(clearSettled).toBe(false);

    turnGate.resolve();
    await Promise.all([turnPromise, clearPromise]);
    expect(clearSettled).toBe(true);
    expect(await wrappedStore.get(s)).toEqual([]);
  });

  test('is a no-op on a session that has never been touched', async () => {
    const store = createInMemoryStore();
    const mgr = createHistoryManager({
      store,
      maxEntries: 10,
      maxChars: 1_000,
    });
    // No prior recordTurn / addAssistantMessage on this sessionId — exercises
    // the create-on-demand mutex path (post Phase S, the lockless fast-path
    // was removed and clear always goes through lockFor).
    await mgr.clear(SessionId('never-touched'));
    expect(await store.get(SessionId('never-touched'))).toEqual([]);
  });
});

describe('HistoryManager.getResponseById', () => {
  test('delegates to store.getResponseById and returns its result verbatim', async () => {
    const store = createInMemoryStore();
    const manager = createHistoryManager({
      maxEntries: 10,
      maxChars: 1_000,
      store,
    });
    const sessionId = SessionId('s-1');
    const messageId = MessageId('msg-1');
    const input = buildInput(sessionId, messageId, 'hi');
    const output = buildOutput(sessionId, messageId, 'hi back');

    expect(await manager.getResponseById(sessionId, messageId)).toBeNull();

    await manager.recordTurn(input, output);

    expect(await manager.getResponseById(sessionId, messageId)).toEqual(output);
  });
});
