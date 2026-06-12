import { describe, expect, test } from 'bun:test';

import {
  AssistantInjectionMessage,
  MessageId,
  SessionId,
} from '@maelstrom-co/protocol';

import type { HistoryEntry } from './history-store.js';
import { truncate } from './truncation.js';

const entry = (idLabel: string, size = 10): HistoryEntry => ({
  kind: 'injection',
  input: AssistantInjectionMessage({
    sessionId: SessionId('s'),
    content: 'x'.repeat(size),
    id: MessageId(idLabel),
  }),
});

// Estimator that returns the length of the injection content, or a fixed
// fallback for turn entries. Keeps tests readable without constructing full
// MaelstromResponse fixtures.
const estimate = (e: HistoryEntry): number =>
  e.kind === 'injection' ? e.input.content.length : 0;

describe('truncate', () => {
  test('returns the input unchanged when both caps are satisfied', () => {
    const entries = [entry('a'), entry('b'), entry('c')];
    const out = truncate(entries, {
      maxEntries: 10,
      maxChars: 1_000,
      estimate,
    });
    expect(out).toEqual(entries);
  });

  test('drops oldest entries to fit maxEntries, newest retained', () => {
    const entries = [entry('a'), entry('b'), entry('c'), entry('d')];
    const out = truncate(entries, {
      maxEntries: 2,
      maxChars: 1_000,
      estimate,
    });
    expect(out.map((e) => (e.kind === 'injection' ? e.input.id : ''))).toEqual([
      MessageId('c'),
      MessageId('d'),
    ]);
  });

  test('drops oldest entries to fit maxChars, newest retained', () => {
    // Each entry has size 10, so three entries total 30 chars.
    const entries = [entry('a', 10), entry('b', 10), entry('c', 10)];
    const out = truncate(entries, {
      maxEntries: 100,
      maxChars: 20,
      estimate,
    });
    // Budget fits two entries (20 chars); oldest drops.
    expect(out.map((e) => (e.kind === 'injection' ? e.input.id : ''))).toEqual([
      MessageId('b'),
      MessageId('c'),
    ]);
  });

  test('drops to satisfy whichever cap is tighter', () => {
    const entries = [
      entry('a', 10),
      entry('b', 10),
      entry('c', 10),
      entry('d', 10),
    ];
    // maxEntries = 3 would allow three; maxChars = 15 only fits one (sum of 2 = 20 > 15).
    const out = truncate(entries, {
      maxEntries: 3,
      maxChars: 15,
      estimate,
    });
    expect(out.map((e) => (e.kind === 'injection' ? e.input.id : ''))).toEqual([
      MessageId('d'),
    ]);
  });

  test('returns empty when input is empty', () => {
    expect(truncate([], { maxEntries: 10, maxChars: 100, estimate })).toEqual(
      [],
    );
  });

  test('returns empty when maxEntries is 0', () => {
    const entries = [entry('a'), entry('b')];
    expect(
      truncate(entries, { maxEntries: 0, maxChars: 1_000, estimate }),
    ).toEqual([]);
  });

  test('returns empty when maxChars is 0', () => {
    const entries = [entry('a'), entry('b')];
    expect(
      truncate(entries, { maxEntries: 10, maxChars: 0, estimate }),
    ).toEqual([]);
  });

  test('retains only the newest when a single entry exceeds maxChars', () => {
    // The spec says "drop oldest until satisfied." If the sole remaining
    // newest entry alone exceeds maxChars, dropping it too would lose the
    // user's most recent turn. We make the pragmatic choice to retain it.
    const entries = [entry('a', 5), entry('b', 1_000)];
    const out = truncate(entries, {
      maxEntries: 10,
      maxChars: 50,
      estimate,
    });
    expect(out.map((e) => (e.kind === 'injection' ? e.input.id : ''))).toEqual([
      MessageId('b'),
    ]);
  });

  test('is a pure function — does not mutate the input array', () => {
    const entries = [entry('a'), entry('b'), entry('c')];
    const snapshot = [...entries];
    truncate(entries, { maxEntries: 1, maxChars: 1_000, estimate });
    expect(entries).toEqual(snapshot);
  });
});
