import { describe, expect, test } from 'bun:test';

import type {
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
import { createInMemoryStore } from './in-memory-store.js';
import type { HistoryEntry } from './history-store.js';

const turn = (
  sessionId: ReturnType<typeof SessionId>,
  id?: ReturnType<typeof MessageId>,
): HistoryEntry => {
  const input = ChartRequestMessage({
    sessionId,
    request: makeGridRequest(),
    id,
  });
  const response: MaelstromResponse = {
    type: 'maelstrom_response',
    requestId: input.id,
    userMessage: 'ok',
    rationale: '',
    executionPlan: [],
    layout: { type: 'grid', positions: [] },
  };
  const output: ChartResponseOutput = {
    type: 'chart_response',
    sessionId,
    id: input.id,
    response,
  };
  return { kind: 'turn', input, output };
};

const injection = (
  sessionId: ReturnType<typeof SessionId>,
  content: string,
  id?: ReturnType<typeof MessageId>,
): HistoryEntry => ({
  kind: 'injection',
  input: AssistantInjectionMessage({ sessionId, content, id }),
});

describe('InMemoryStore.append', () => {
  test('inserts a new turn entry and reports inserted=true', async () => {
    const store = createInMemoryStore();
    const s = SessionId('s-1');
    const result = await store.append(s, turn(s));
    expect(result.inserted).toBe(true);
  });

  test('inserts a new injection entry and reports inserted=true', async () => {
    const store = createInMemoryStore();
    const s = SessionId('s-1');
    const result = await store.append(s, injection(s, 'hello'));
    expect(result.inserted).toBe(true);
  });

  test('dedups by message id and reports inserted=false on duplicate', async () => {
    const store = createInMemoryStore();
    const s = SessionId('s-1');
    const id = MessageId('msg-1');
    await store.append(s, injection(s, 'first', id));
    const second = await store.append(s, injection(s, 'second', id));
    expect(second.inserted).toBe(false);
  });

  test('isolates dedup per session — same message id in a different session inserts', async () => {
    const store = createInMemoryStore();
    const a = SessionId('s-a');
    const b = SessionId('s-b');
    const id = MessageId('shared');
    const first = await store.append(a, injection(a, 'hi', id));
    const second = await store.append(b, injection(b, 'hi', id));
    expect(first.inserted).toBe(true);
    expect(second.inserted).toBe(true);
  });

  test('does not overwrite the original entry on a dedup hit', async () => {
    const store = createInMemoryStore();
    const s = SessionId('s-1');
    const id = MessageId('msg-1');
    await store.append(s, injection(s, 'first', id));
    await store.append(s, injection(s, 'second-should-be-skipped', id));
    const entries = await store.get(s);
    expect(entries.length).toBe(1);
    const [entry] = entries;
    expect(entry?.kind).toBe('injection');
    if (entry?.kind === 'injection') {
      expect(entry.input.content).toBe('first');
    }
  });
});

describe('InMemoryStore.get', () => {
  test('returns entries in insertion order', async () => {
    const store = createInMemoryStore();
    const s = SessionId('s-1');
    const idA = MessageId('a');
    const idB = MessageId('b');
    const idC = MessageId('c');
    await store.append(s, injection(s, 'first', idA));
    await store.append(s, injection(s, 'second', idB));
    await store.append(s, injection(s, 'third', idC));
    const entries = await store.get(s);
    expect(entries.map((e) => (e.kind === 'injection' ? e.input.id : null))).toEqual([
      idA,
      idB,
      idC,
    ]);
  });

  test('returns an empty array for an unknown session', async () => {
    const store = createInMemoryStore();
    expect(await store.get(SessionId('unknown'))).toEqual([]);
  });
});

describe('InMemoryStore.replace', () => {
  test('overwrites the session entry list with the provided entries', async () => {
    const store = createInMemoryStore();
    const s = SessionId('s-1');
    await store.append(s, injection(s, 'old-1', MessageId('o1')));
    await store.append(s, injection(s, 'old-2', MessageId('o2')));

    const newEntries = [
      injection(s, 'new-1', MessageId('n1')),
      injection(s, 'new-2', MessageId('n2')),
    ];
    await store.replace(s, newEntries);

    const entries = await store.get(s);
    expect(entries.length).toBe(2);
    expect(entries.map((e) => (e.kind === 'injection' ? e.input.content : null))).toEqual([
      'new-1',
      'new-2',
    ]);
  });

  test('creates a session when replacing on an unknown sessionId', async () => {
    const store = createInMemoryStore();
    const s = SessionId('s-fresh');
    await store.replace(s, [injection(s, 'only', MessageId('only'))]);
    const entries = await store.get(s);
    expect(entries.length).toBe(1);
  });

  test('clears the session when replaced with an empty array', async () => {
    const store = createInMemoryStore();
    const s = SessionId('s-1');
    await store.append(s, injection(s, 'x', MessageId('x')));
    await store.replace(s, []);
    expect(await store.get(s)).toEqual([]);
  });
});

describe('InMemoryStore.clear', () => {
  test('removes all entries for the given session', async () => {
    const store = createInMemoryStore();
    const s = SessionId('s-1');
    await store.append(s, injection(s, 'x', MessageId('x')));
    await store.clear(s);
    expect(await store.get(s)).toEqual([]);
  });

  test('does not affect other sessions', async () => {
    const store = createInMemoryStore();
    const a = SessionId('s-a');
    const b = SessionId('s-b');
    await store.append(a, injection(a, 'keep', MessageId('k')));
    await store.append(b, injection(b, 'wipe', MessageId('w')));
    await store.clear(b);
    expect((await store.get(a)).length).toBe(1);
    expect(await store.get(b)).toEqual([]);
  });

  test('is a no-op on an unknown session', async () => {
    const store = createInMemoryStore();
    await store.clear(SessionId('never-seen'));
    expect(await store.get(SessionId('never-seen'))).toEqual([]);
  });
});
