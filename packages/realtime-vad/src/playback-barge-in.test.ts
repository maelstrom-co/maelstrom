import { afterEach, beforeEach, expect, mock, test } from 'bun:test';
import { type InstalledClock, install } from '@sinonjs/fake-timers';
import type { CreateBrowserVadOptions } from './browser-vad.js';
import { resolveBrowserVadConfig } from './browser-vad-config.js';
import {
  createPlaybackBargeIn,
  type PlaybackBargeIn,
} from './playback-barge-in.js';

let boundaries: CreateBrowserVadOptions;
let finishSetup: (() => void) | undefined;
let delaySetup = false;
let destroyedVad = 0;
mock.module('./browser-vad.js', () => ({
  createBrowserVad: async (options: CreateBrowserVadOptions) => {
    boundaries = options;
    if (delaySetup)
      await new Promise<void>((resolve) => {
        finishSetup = resolve;
      });
    return {
      destroy: async () => {
        destroyedVad++;
      },
    };
  },
}));

class Track {
  enabled = true;
  stopped = 0;
  cloneTrack?: Track;
  clone() {
    this.cloneTrack = new Track();
    return this.cloneTrack;
  }
  stop() {
    this.stopped++;
  }
}
class Stream {
  constructor(readonly tracks: Track[]) {}
  getTracks() {
    return this.tracks;
  }
  getAudioTracks() {
    return this.tracks;
  }
}
class Context {
  static instances: Context[] = [];
  state = 'running';
  energy = 0.2;
  closed = 0;
  probes: Track[] = [];
  constructor() {
    Context.instances.push(this);
  }
  get currentTime() {
    return Date.now() / 1000;
  }
  async resume() {}
  async close() {
    this.closed++;
  }
  createMediaStreamSource(stream: Stream) {
    this.probes.push(...stream.tracks);
    return { connect() {}, disconnect() {} };
  }
  createAnalyser() {
    return {
      fftSize: 1024,
      disconnect() {},
      getFloatTimeDomainData: (samples: Float32Array) =>
        samples.fill(this.energy),
    };
  }
}
let clock: InstalledClock;
let gate: PlaybackBargeIn;
let failures: number;
let mic: Track;
const originals = {
  AudioContext: globalThis.AudioContext,
  MediaStream: globalThis.MediaStream,
};
beforeEach(() => {
  clock = install();
  failures = 0;
  destroyedVad = 0;
  delaySetup = false;
  finishSetup = undefined;
  Context.instances = [];
  globalThis.AudioContext = Context as unknown as typeof AudioContext;
  globalThis.MediaStream = Stream as unknown as typeof MediaStream;
  mic = new Track();
});
afterEach(() => {
  gate?.destroy();
  clock.uninstall();
  Object.assign(globalThis, originals);
});
function start() {
  const config = resolveBrowserVadConfig(true);
  if (!config.enabled) throw new Error();
  gate = createPlaybackBargeIn({
    microphone: new Stream([mic]) as unknown as MediaStream,
    config,
    onUnavailable: () => {
      failures++;
    },
  });
  return gate.ready;
}
function attach(...tracks: Track[]) {
  gate.attach(new Stream(tracks) as unknown as MediaStream);
}

test('mutes before transcripts, never changes the mic, drains through an enabled private clone, and requires post-speech quiet', async () => {
  await start();
  const output = new Track();
  const disabled = new Track();
  disabled.enabled = false;
  attach(output, disabled);
  expect(boundaries.stream.getTracks()).toEqual([
    mic as unknown as MediaStreamTrack,
  ]);
  await boundaries.startTurn();
  expect(output.enabled).toBe(false);
  expect(mic.enabled).toBe(true);
  expect(output.cloneTrack?.enabled).toBe(true);
  await clock.tickAsync(500);
  await boundaries.endTurn();
  await clock.tickAsync(2000);
  expect(output.enabled).toBe(false);
  Context.instances[0]!.energy = 0;
  await clock.tickAsync(180);
  expect(output.enabled).toBe(false);
  await clock.tickAsync(60);
  expect(output.enabled).toBe(true);
  expect(disabled.enabled).toBe(false);
  gate.destroy();
  expect(output.stopped).toBe(0);
  expect(mic.stopped).toBe(0);
  expect(output.cloneTrack?.stopped).toBe(1);
  expect(destroyedVad).toBe(1);
});

test('silence while the user speaks cannot release playback; a resumed old tail resets quiet confirmation', async () => {
  await start();
  const output = new Track();
  attach(output);
  await boundaries.startTurn();
  Context.instances[0]!.energy = 0;
  await clock.tickAsync(1000);
  expect(output.enabled).toBe(false);
  await boundaries.endTurn();
  await clock.tickAsync(160);
  Context.instances[0]!.energy = 0.2;
  await clock.tickAsync(20);
  Context.instances[0]!.energy = 0;
  await clock.tickAsync(160);
  expect(output.enabled).toBe(false);
  await clock.tickAsync(80);
  expect(output.enabled).toBe(true);
});

test('misfire recovers promptly but cannot release a previous confirmed interruption', async () => {
  await start();
  const output = new Track();
  attach(output);
  await boundaries.startTurn();
  await boundaries.cancelTurn();
  expect(output.enabled).toBe(true);
  await boundaries.startTurn();
  await boundaries.endTurn();
  await boundaries.startTurn();
  await boundaries.cancelTurn();
  expect(output.enabled).toBe(false);
});

test('late and replacement tracks inherit the gate; removal and disconnect restore exact values and fence callbacks', async () => {
  await start();
  await boundaries.startTurn();
  const first = new Track();
  attach(first);
  expect(first.enabled).toBe(false);
  attach(first);
  const second = new Track();
  attach(second);
  expect(first.enabled).toBe(true);
  expect(first.cloneTrack?.stopped).toBe(1);
  expect(second.enabled).toBe(false);
  gate.destroy();
  gate.destroy();
  await boundaries.startTurn();
  attach(first);
  expect(second.enabled).toBe(true);
  expect(second.cloneTrack?.stopped).toBe(1);
  expect(Context.instances[0]!.closed).toBe(1);
});

test('suspended monitoring fails open to provider handling instead of locking playback', async () => {
  await start();
  const output = new Track();
  attach(output);
  await boundaries.startTurn();
  Context.instances[0]!.state = 'suspended';
  await clock.tickAsync(20);
  expect(output.enabled).toBe(true);
  expect(failures).toBe(1);
  await boundaries.startTurn();
  expect(output.enabled).toBe(true);
});

test('cannot gate microphone tracks even if the caller supplies them as output', async () => {
  await start();
  attach(mic);
  await boundaries.startTurn();
  expect(mic.enabled).toBe(true);
  expect(mic.cloneTrack).toBeUndefined();
  expect(failures).toBe(1);
});

test('a timed-out detector is retired when its late initialization completes', async () => {
  delaySetup = true;
  const ready = start();
  await clock.tickAsync(5000);
  await ready;
  expect(failures).toBe(1);
  finishSetup?.();
  await clock.tickAsync(1);
  expect(destroyedVad).toBe(1);
  expect(Context.instances[0]!.closed).toBe(1);
});
