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
  expect(take.getEvidence()).toHaveLength(2);
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
  expect(take.getEvidence()).toEqual([]);
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
  expect(take.getEvidence()).toEqual([]);
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
