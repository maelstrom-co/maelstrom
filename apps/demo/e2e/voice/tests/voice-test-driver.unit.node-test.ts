import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import type { Page } from '@playwright/test';
import type { VoiceObservationPayloads } from './voice-test-driver.ts';
import {
  createVoiceTestDriver,
  startVoiceProcess,
} from './voice-test-driver.ts';

function mockPage() {
  const events = new EventEmitter();
  const addedScripts: unknown[] = [];
  let binding: ((source: unknown, event: unknown) => unknown) | undefined;
  const page = Object.assign(events, {
    addInitScript: async (...args: unknown[]) => {
      addedScripts.push(args);
    },
    exposeBinding: async (
      _name: string,
      callback: (source: unknown, event: unknown) => unknown,
    ) => {
      binding = callback;
    },
    goto: async (_url: string) => {},
    evaluate: async <T, A>(_fn: (arg: A) => T | Promise<T>, _arg?: A) =>
      undefined as T,
  });
  return {
    page: page as unknown as Page,
    addedScripts,
    close() {
      events.emit('close');
    },
    async send(event: unknown) {
      await binding?.({}, event);
    },
  };
}

test('exposes a live observation bridge with identity, sequence, source, and independent clocks', async () => {
  const fixture = mockPage();
  let now = 100;
  const driver = createVoiceTestDriver(fixture.page, {
    sessionId: 'session-test',
    pageId: 'page-test',
    nodeNow: () => now++,
  });
  const after = driver.cursor();
  await driver.navigate('https://demo.example/path?mode=test');
  assert.equal(fixture.addedScripts.length, 2);
  await fixture.send({
    type: 'voice-state',
    source: 'voice-orb',
    clock: 987,
    payload: { state: 'listening' },
  });
  const observation = await driver.waitForObservation(
    (value) => value.type === 'voice-state',
    { after },
  );
  assert.deepEqual(observation.identity, {
    sessionId: 'session-test',
    pageId: 'page-test',
  });
  assert.equal(observation.sequence, 2);
  assert.equal(observation.source, 'browser');
  assert.equal(
    (observation.payload as VoiceObservationPayloads['voice-state']).state,
    'listening',
  );
  assert.deepEqual(observation.clock, {
    domain: 'browser-performance',
    elapsedMs: 987,
  });
  assert.equal(driver.observations[0]?.clock.domain, 'node-monotonic');
  await driver.dispose();
});

test('buffer overflow is observable and stale cursors fail rather than lose fast events', async () => {
  const fixture = mockPage();
  const driver = createVoiceTestDriver(fixture.page, {
    sessionId: 'bounded',
    bufferCapacity: 2,
  });
  await driver.navigate(undefined, false);
  const cursor = driver.cursor();
  const droppedBefore = driver.bufferStatus.dropped;
  for (let index = 0; index < 4; index++)
    await fixture.send({
      type: 'voice-state',
      source: 'voice-orb',
      clock: index,
      payload: { state: `event-${index}` },
    });
  assert.equal(driver.bufferStatus.size, 2);
  assert.equal(driver.bufferStatus.dropped - droppedBefore, 4);
  await assert.rejects(
    driver.waitForObservation(() => true, { after: cursor }),
    /cursor expired.*overflow/,
  );
  const newest = await driver.waitForObservation(
    (event) =>
      event.type === 'voice-state' &&
      (event.payload as VoiceObservationPayloads['voice-state']).state ===
        'event-3',
    { after: { ...cursor, sequence: 5 } },
  );
  assert.equal(
    (newest.payload as VoiceObservationPayloads['voice-state']).state,
    'event-3',
  );
  await driver.dispose();
});

test('waits settle on timeout, abort, page close, and disposal; subscriptions unsubscribe', async () => {
  const fixture = mockPage();
  const driver = createVoiceTestDriver(fixture.page);
  await driver.navigate(undefined, false);
  const controller = new AbortController();
  const aborted = driver.waitForObservation(() => false, {
    signal: controller.signal,
  });
  controller.abort();
  await assert.rejects(aborted, /aborted/);
  await assert.rejects(
    driver.waitForObservation(() => false, { timeoutMs: 5 }),
    /Timed out/,
  );
  const closed = driver.waitForObservation(() => false);
  fixture.close();
  await assert.rejects(closed, /page closed/);
  await driver.dispose();

  const second = mockPage();
  const disposed = createVoiceTestDriver(second.page);
  await disposed.navigate(undefined, false);
  const pending = disposed.waitForObservation(() => false);
  await disposed.dispose();
  await assert.rejects(pending, /aborted|disposed/);
});

test('dispose during initialization prevents a delayed navigation and calls browser cleanup', async () => {
  const fixture = mockPage();
  let release!: () => void;
  const init = new Promise<void>((resolve) => {
    release = resolve;
  });
  let navigations = 0;
  let cleanups = 0;
  Object.assign(fixture.page, {
    addInitScript: async () => init,
    goto: async () => {
      navigations++;
    },
    evaluate: async () => {
      cleanups++;
      return undefined;
    },
  });
  const driver = createVoiceTestDriver(fixture.page);
  const navigation = driver.navigate(undefined);
  await Promise.resolve();
  const disposing = driver.dispose();
  release();
  await assert.rejects(navigation, /disposed/);
  await disposing;
  assert.equal(navigations, 0);
  assert.equal(cleanups, 1);
});

test('subscriber callbacks do not block the browser bridge and unsubscribe is idempotent', async () => {
  const fixture = mockPage();
  const driver = createVoiceTestDriver(fixture.page);
  let callbackFinished = false;
  let callbackCount = 0;
  const unsubscribe = driver.subscribe(async () => {
    callbackCount++;
    await delay(40);
    callbackFinished = true;
  });
  await fixture.send({
    type: 'voice-state',
    source: 'voice-orb',
    clock: 1,
    payload: { state: 'fast' },
  });
  assert.equal(callbackFinished, false);
  await delay(50);
  assert.equal(callbackFinished, true);
  unsubscribe();
  unsubscribe();
  await fixture.send({
    type: 'voice-state',
    source: 'voice-orb',
    clock: 2,
    payload: { state: 'after-unsubscribe' },
  });
  await delay(50);
  assert.equal(callbackCount, 1);
  await driver.dispose();
});

test('normal subprocess completion is not cut off by the termination grace window', async () => {
  const started = performance.now();
  const playback = startVoiceProcess(
    process.execPath,
    ['-e', "setTimeout(() => { process.stdout.write('completed'); }, 2700)"],
    { timeoutMs: 5_000 },
  );
  const result = await playback.completed();
  assert.equal(result.stdout, 'completed');
  assert.ok(performance.now() - started > 2_500);
});

test('playback operations publish typed start/end lifecycle observations', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'voice-driver-playback-'));
  const binary = join(directory, 'playback');
  await writeFile(binary, '#!/bin/sh\nprintf complete\n');
  await chmod(binary, 0o755);
  const fixture = mockPage();
  const driver = createVoiceTestDriver(fixture.page);
  try {
    const process = driver.startPlayback(binary, '/tmp/scenario.wav', {
      delayMs: 3_000,
      timeoutMs: 5_000,
    });
    assert.equal((await process.completed()).stdout, 'complete');
    await delay(0);
    const events = driver.observations.filter((event) =>
      event.type.startsWith('playback-'),
    );
    assert.deepEqual(
      events.map((event) => event.type),
      ['playback-start', 'playback-end'],
    );
    assert.deepEqual(events[0]?.payload, {
      playbackId: (events[0]?.payload as { playbackId: string }).playbackId,
      fixture: 'scenario.wav',
      delayMs: 3_000,
    });
    assert.equal(events[1]?.clock.domain, 'node-monotonic');
  } finally {
    await driver.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});

test('playback subprocess timeout and abort escalate from SIGTERM to SIGKILL', async () => {
  const ignoredTerm =
    "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);";
  const timed = startVoiceProcess(process.execPath, ['-e', ignoredTerm], {
    timeoutMs: 30,
  });
  await assert.rejects(timed.completed(), /timed out/);
  const controller = new AbortController();
  const aborted = startVoiceProcess(process.execPath, ['-e', ignoredTerm], {
    timeoutMs: 5_000,
    signal: controller.signal,
  });
  controller.abort();
  await assert.rejects(aborted.completed(), /aborted/);

  const fixture = mockPage();
  const driver = createVoiceTestDriver(fixture.page);
  const owned = driver.startProcess(process.execPath, ['-e', ignoredTerm], {
    timeoutMs: 5_000,
  });
  const rejected = assert.rejects(owned.completed(), /aborted/);
  await driver.dispose();
  await rejected;
});
