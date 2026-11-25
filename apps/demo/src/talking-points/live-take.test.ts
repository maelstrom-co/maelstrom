import { afterEach, expect, it, vi } from 'vitest';

import type { LiveCapture, LiveCaptureOptions } from './live-capture';
import { createLiveTake } from './live-take';

function setup() {
  let callbacks!: LiveCaptureOptions;
  let ready!: () => void;
  const capture: LiveCapture = {
    start: () =>
      new Promise((resolve) => {
        ready = () => resolve({ inputOnly: true, turnMode: 'server_vad' });
      }),
    beginCapture: vi.fn(),
    stopCapture: vi.fn(),
    commitFinalAudio: vi.fn(() => ({
      status: 'sent' as const,
      eventId: 'commit',
    })),
    dispose: vi.fn(),
  };
  const retire = vi.fn();
  const take = createLiveTake({
    topics: [
      { id: 'one', content: 'Opening' },
      { id: 'two', content: 'Closing' },
    ],
    mintToken: async () => ({ value: 'ephemeral' }),
    createCapture: (options) => {
      callbacks = options;
      return capture;
    },
    retirePending: retire,
  });
  return {
    take,
    capture,
    retire,
    callbacks: () => callbacks,
    ready: () => ready(),
  };
}
afterEach(() => {
  vi.useRealTimers();
});

it('seeds take metadata without observing elapsed ticks and bounds streaming summaries while distinguishing callback delivery from display eligibility', async () => {
  vi.useFakeTimers();
  const { take, callbacks, ready, capture } = setup();
  const starting = take.start();
  const seen = vi.fn();
  const release = take.diagnostics.subscribe(seen);
  expect(seen.mock.calls[0]).toEqual([
    'voice.capture.snapshot',
    expect.objectContaining({
      phase: 'starting',
      providerInstanceId: take.generation,
      providerGeneration: 1,
    }),
  ]);
  ready();
  await starting;
  const baseline = seen.mock.calls.length;
  vi.advanceTimersByTime(10000);
  expect(seen).toHaveBeenCalledTimes(baseline);
  for (let i = 0; i < 1000; i++) {
    callbacks().onDelta({ itemId: 'a', contentIndex: 0, delta: 'P' });
    vi.advanceTimersByTime(100);
  }
  expect(seen.mock.calls.length - baseline).toBeLessThanOrEqual(8);
  expect(take.diagnostics.getSnapshot()).toMatchObject({
    callbacksDelta: 1000,
    displayAccepted: 1000,
    displaySuppressed: 0,
  });
  take.stop();
  callbacks().onCompleted({
    itemId: 'a',
    contentIndex: 0,
    previousItemId: undefined,
    transcript: 'PRIVATE_FINAL',
  });
  vi.advanceTimersByTime(3000);
  callbacks().onDelta({
    itemId: 'late',
    contentIndex: 0,
    delta: 'PRIVATE_LATE',
  });
  expect(take.diagnostics.getSnapshot()).toMatchObject({
    callbacksDelta: 1001,
    callbacksCompleted: 1,
    displayAccepted: 1001,
    displaySuppressed: 1,
    phase: 'stopped',
    finalCommit: 'sent',
  });
  expect(JSON.stringify(seen.mock.calls)).not.toContain('PRIVATE');
  const disposeCalls = vi.mocked(capture.dispose).mock.calls.length;
  release();
  expect(vi.mocked(capture.dispose)).toHaveBeenCalledTimes(disposeCalls);
  expect(vi.getTimerCount()).toBe(0);
  take.reset();
  const after = seen.mock.calls.length;
  callbacks().onDelta({
    itemId: 'late',
    contentIndex: 0,
    delta: 'PRIVATE_LATE',
  });
  vi.advanceTimersByTime(1000);
  expect(seen).toHaveBeenCalledTimes(after);
});

it('starts the clock only at readiness and retains final reception for the entire fixed Stop window', async () => {
  vi.useFakeTimers();
  const { take, capture, callbacks, ready, retire } = setup();
  const starting = take.start();
  vi.advanceTimersByTime(5000);
  expect(take.getSnapshot().elapsedMs).toBe(0);
  expect(capture.beginCapture).not.toHaveBeenCalled();
  ready();
  await starting;
  vi.advanceTimersByTime(1234);
  take.stop();
  expect(capture.stopCapture).toHaveBeenCalledOnce();
  expect(take.getSnapshot()).toMatchObject({
    phase: 'finalizing',
    elapsedMs: 1234,
  });
  callbacks().onCommitted({ itemId: 'a', previousItemId: null });
  vi.advanceTimersByTime(2999);
  callbacks().onCompleted({
    itemId: 'a',
    previousItemId: null,
    contentIndex: 0,
    transcript: 'Opening',
  });
  expect(take.getSnapshot().phase).toBe('finalizing');
  expect(take.getEvidence().items).toHaveLength(1);
  expect(capture.dispose).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1);
  expect(take.getSnapshot()).toMatchObject({
    phase: 'stopped',
    elapsedMs: 1234,
  });
  expect(take.getSnapshot().warning).toMatch(/incomplete/i);
  expect(retire).toHaveBeenCalledOnce();
  expect(capture.dispose).toHaveBeenCalledOnce();
});

it('Reset invalidates capture readiness and all old mutation authority before teardown', async () => {
  const { take, capture, ready, callbacks } = setup();
  const starting = take.start();
  take.reset();
  ready();
  await starting;
  callbacks().onCompleted({
    itemId: 'late',
    previousItemId: null,
    contentIndex: 0,
    transcript: 'Opening',
  });
  take.automaticMark('one');
  take.manualSet('one', true);
  expect(capture.beginCapture).not.toHaveBeenCalled();
  expect(take.getSnapshot()).toMatchObject({
    phase: 'preparing',
    elapsedMs: 0,
  });
  expect([...take.getSnapshot().spoken]).toEqual([]);
  expect(take.getEvidence().items).toEqual([]);
});

it('manual values lock only their Topic, including pending automatic marks and finalization', async () => {
  const { take, ready } = setup();
  const starting = take.start();
  ready();
  await starting;
  take.automaticMark('one');
  take.manualSet('one', false);
  take.automaticMark('one');
  take.automaticMark('two');
  expect([...take.getSnapshot().spoken]).toEqual(['two']);
  take.stop();
  take.manualSet('two', false);
  take.automaticMark('two');
  expect([...take.getSnapshot().spoken]).toEqual([]);
  expect([...take.getSnapshot().manualLocks]).toEqual(['one', 'two']);
  take.reset();
  expect([...take.getSnapshot().manualLocks]).toEqual([]);
});

it('checks the absolute cutoff at actual writes even before a delayed cutoff timer executes', async () => {
  const { take, ready, callbacks } = setup();
  const starting = take.start();
  ready();
  await starting;
  take.stop();
  vi.spyOn(performance, 'now').mockReturnValue(performance.now() + 4000);
  take.automaticMark('one');
  callbacks().onCompleted({
    itemId: 'late',
    previousItemId: null,
    contentIndex: 0,
    transcript: 'Opening',
  });
  expect([...take.getSnapshot().spoken]).toEqual([]);
  expect(take.getEvidence().items).toEqual([]);
  take.dispose();
  vi.restoreAllMocks();
});

it('freezes time and retains marks on fatal failure without reconnect or restart', async () => {
  vi.useFakeTimers();
  const { take, ready, callbacks, capture } = setup();
  const starting = take.start();
  ready();
  await starting;
  vi.advanceTimersByTime(500);
  take.manualSet('one', true);
  callbacks().onFatalError(new Error('redacted') as never);
  vi.advanceTimersByTime(5000);
  await take.start();
  expect(take.getSnapshot()).toMatchObject({
    phase: 'stopped',
    elapsedMs: 500,
  });
  expect([...take.getSnapshot().spoken]).toEqual(['one']);
  expect(take.getSnapshot().error).toMatch(/Reset/);
  expect(capture.stopCapture).toHaveBeenCalledOnce();
});

it('Stop during setup cannot be revived by late readiness', async () => {
  const { take, capture, ready } = setup();
  const starting = take.start();
  take.stop();
  ready();
  await starting;
  expect(take.getSnapshot()).toMatchObject({ phase: 'stopped', elapsedMs: 0 });
  expect(capture.beginCapture).not.toHaveBeenCalled();
});

it('retains the final display when its semantic evidence immediately fails coverage evaluation', async () => {
  const { take, ready, callbacks } = setup();
  const starting = take.start();
  ready();
  await starting;
  take.subscribeEvidence(() => take.coverageFailed());
  callbacks().onCompleted({
    itemId: 'a',
    contentIndex: 0,
    previousItemId: undefined,
    transcript: 'Final speech before failure.',
  });
  expect(take.getSnapshot().phase).toBe('stopped');
  expect(take.getSnapshot().transcript.map((part) => part.text)).toEqual([
    'Final speech before failure.',
  ]);
  callbacks().onDelta({ itemId: 'late', contentIndex: 0, delta: 'Too late.' });
  expect(take.getSnapshot().transcript).toHaveLength(1);
  take.dispose();
  expect(take.getSnapshot().transcript).toEqual([]);
});
