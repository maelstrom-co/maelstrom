import { expect, test } from 'bun:test';

import { ToolCallId } from '@maelstrom-co/protocol';
import type { RealtimeAdapterEvent, ToolResult } from '@maelstrom-co/realtime';

import type { GoalOutcome } from './goal-runner';
import { VoiceGoals } from './voice-goals';

function adapter() {
  let listener: ((event: RealtimeAdapterEvent) => void) | undefined;
  const results: { id: string; result: ToolResult }[] = [];
  let disconnects = 0;
  return {
    results,
    get disconnects() {
      return disconnects;
    },
    async connect() {},
    async disconnect() {
      disconnects++;
    },
    on(callback: (event: RealtimeAdapterEvent) => void) {
      listener = callback;
      return () => {
        listener = undefined;
      };
    },
    emit(id: string, intent: string) {
      listener?.({
        type: 'tool_call',
        callId: ToolCallId(id),
        name: 'update_ui',
        argumentsJson: JSON.stringify({ intent }),
      });
    },
    fail() {
      listener?.({ type: 'state', state: 'error' });
    },
    async sendToolResult(id: ToolCallId, result: ToolResult) {
      results.push({ id, result });
    },
  };
}
function latch<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const completed: GoalOutcome = {
  status: 'completed',
  message: 'There are no tasks.',
  applications: [],
};

test('voice waits for the whole goal, deduplicates an invocation, and can report read-only success', async () => {
  const result = latch<GoalOutcome>();
  let runs = 0;
  const voice = new VoiceGoals(
    () => {
      runs++;
      return result.promise;
    },
    () => {},
  );
  const provider = adapter();
  await voice.connect(provider);
  provider.emit('call', 'Count my tasks');
  provider.emit('call', 'Count my tasks');
  expect(runs).toBe(1);
  expect(provider.results).toEqual([]);
  result.resolve(completed);
  await result.promise;
  expect(provider.results).toEqual([
    {
      id: 'call',
      result: {
        ok: true,
        summary: completed.message,
        userMessage: completed.message,
      },
    },
  ]);
  await voice.disconnect();
});

test('a partial or uncertain goal never becomes voice success', async () => {
  const outcome = {
    status: 'unknown' as const,
    message: 'One entry was saved. Inspect and reconcile before continuing.',
    applications: ['first-write'],
  };
  const voice = new VoiceGoals(
    async () => outcome,
    () => {},
  );
  const provider = adapter();
  await voice.connect(provider);
  provider.emit('call', 'Create and append');
  await Promise.resolve();
  expect(provider.results[0]?.result).toEqual({
    ok: false,
    summary: outcome.message,
    userMessage: outcome.message,
  });
  await voice.disconnect();
});

test('a settled limitation is not reported as a successful spoken goal', async () => {
  const voice = new VoiceGoals(
    async () => ({
      status: 'incomplete',
      message: 'Weather is not visible.',
      applications: ['layout-only'],
    }),
    () => {},
  );
  const provider = adapter();
  await voice.connect(provider);
  provider.emit('call', 'Show Weather');
  await Promise.resolve();
  expect(provider.results[0]?.result).toMatchObject({
    ok: false,
    userMessage: 'Weather is not visible.',
  });
  await voice.disconnect();
});

test('a goal settling after reconnect cannot speak through either the old or replacement adapter', async () => {
  const result = latch<GoalOutcome>();
  const voice = new VoiceGoals(
    () => result.promise,
    () => {},
  );
  const old = adapter();
  await voice.connect(old);
  old.emit('call', 'Count tasks');
  await voice.disconnect();
  const fresh = adapter();
  await voice.connect(fresh);
  result.resolve(completed);
  await result.promise;
  expect(old.results).toEqual([]);
  expect(fresh.results).toEqual([]);
  expect(fresh.disconnects).toBe(0);
  await voice.disconnect();
});

test('late failure delivering an old result cannot disconnect replacement voice', async () => {
  const delivering = latch<void>();
  const release = latch<void>();
  const voice = new VoiceGoals(
    async () => completed,
    () => {},
  );
  const old = adapter();
  old.sendToolResult = async () => {
    delivering.resolve();
    await release.promise;
    throw new Error('Old channel closed');
  };
  await voice.connect(old);
  old.emit('call', 'Count tasks');
  await delivering.promise;
  await voice.disconnect();
  const fresh = adapter();
  await voice.connect(fresh);
  release.resolve();
  await release.promise;
  await Promise.resolve();
  await Promise.resolve();
  expect(fresh.disconnects).toBe(0);
  fresh.emit('fresh-call', 'Count tasks');
  await Promise.resolve();
  expect(fresh.results[0]?.result).toMatchObject({ ok: true });
  await voice.disconnect();
});

test('a terminal provider failure allows an explicit fresh connection while fencing an old goal result', async () => {
  const result = latch<GoalOutcome>();
  const voice = new VoiceGoals(
    () => result.promise,
    () => {},
  );
  const old = adapter();
  await voice.connect(old);
  old.emit('old', 'Count tasks');
  old.fail();
  const fresh = adapter();
  await voice.connect(fresh);
  result.resolve(completed);
  await result.promise;
  expect(old.results).toEqual([]);
  expect(fresh.results).toEqual([]);
  fresh.emit('fresh', 'Count tasks');
  await Promise.resolve();
  expect(fresh.results[0]?.result).toMatchObject({ ok: true });
  await voice.disconnect();
});

test('a changed invocation identity stops voice instead of submitting another goal', async () => {
  const result = latch<GoalOutcome>();
  let runs = 0;
  const events: RealtimeAdapterEvent[] = [];
  const voice = new VoiceGoals(
    () => {
      runs++;
      return result.promise;
    },
    (event) => events.push(event),
  );
  const provider = adapter();
  await voice.connect(provider);
  provider.emit('same', 'Create an entry');
  provider.emit('same', 'Create a second entry');
  await Promise.resolve();
  await Promise.resolve();
  expect(runs).toBe(1);
  expect(provider.disconnects).toBe(1);
  expect(events).toContainEqual({ type: 'state', state: 'error' });
  result.resolve(completed);
  await result.promise;
  expect(provider.results).toEqual([]);
});
