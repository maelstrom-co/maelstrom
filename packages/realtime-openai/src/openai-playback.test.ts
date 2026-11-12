import { afterEach, beforeEach, expect, mock, test } from 'bun:test';

import type { AdapterConnectOptions } from '@maelstrom-co/realtime';
import type { UnixSeconds } from '@maelstrom-co/realtime-protocol';

import { OpenAIAdapter } from './openai-adapter.js';

class Channel {
  readyState = 'connecting';
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  sent: string[] = [];
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.readyState = 'closed';
  }
}
class Stream {
  tracks = [{ kind: 'audio', enabled: true, stop: mock(() => {}) }];
  getTracks() {
    return this.tracks;
  }
  getAudioTracks() {
    return this.tracks;
  }
}
class Peer {
  static instances: Peer[] = [];
  channel = new Channel();
  closed = false;
  iceConnectionState = 'new';
  localDescription: { type: string; sdp: string } | undefined;
  ontrack: ((event: { streams: MediaStream[] }) => void) | null = null;
  oniceconnectionstatechange: (() => void) | null = null;
  constructor() {
    Peer.instances.push(this);
  }
  createDataChannel() {
    return this.channel;
  }
  addTrack(track: unknown) {
    return { track };
  }
  async createOffer() {
    return { type: 'offer', sdp: 'synthetic-offer' };
  }
  async setLocalDescription(description: { type: string; sdp: string }) {
    this.localDescription = description;
  }
  async setRemoteDescription() {}
  close() {
    this.closed = true;
  }
}
class AudioElement {
  static instances: AudioElement[] = [];
  autoplay = false;
  srcObject: MediaStream | null = null;
  paused = true;
  play = mock(async () => {
    this.paused = false;
  });
  constructor() {
    AudioElement.instances.push(this);
  }
  pause() {
    this.paused = true;
  }
}
const adapters: OpenAIAdapter[] = [];
let originals: Array<[string, PropertyDescriptor | undefined]> = [];
let exchange = mock(async () => ({
  ok: true,
  status: 200,
  text: async () => 'synthetic-answer',
}));
const microphone = mock(async () => new Stream());
beforeEach(() => {
  Peer.instances = [];
  AudioElement.instances = [];
  exchange = mock(async () => ({
    ok: true,
    status: 200,
    text: async () => 'synthetic-answer',
  }));
  microphone.mockClear();
  const values = {
    RTCPeerConnection: Peer,
    Audio: AudioElement,
    fetch: exchange,
    navigator: { mediaDevices: { getUserMedia: microphone } },
  };
  originals = Object.entries(values).map(([key, value]) => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, {
      value,
      writable: true,
      configurable: true,
    });
    return [key, descriptor];
  });
});
afterEach(async () => {
  try {
    for (const adapter of adapters.splice(0)) await adapter.disconnect();
  } finally {
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});

async function flush() {
  for (let i = 0; i < 30; i++) await Promise.resolve();
}
async function connect(adapter: OpenAIAdapter) {
  const options: AdapterConnectOptions = {
    tools: [],
    instructions: 'Synthetic playback test',
    prepareGreeting: false,
  };
  const pending = adapter.connect(options);
  await flush();
  const peer = Peer.instances.at(-1);
  if (!peer?.channel.onopen) throw new Error('Synthetic channel was not wired');
  peer.channel.readyState = 'open';
  peer.channel.onopen();
  await pending;
  const audio = AudioElement.instances.at(-1);
  if (!audio) throw new Error('Remote audio element missing');
  return { peer, audio };
}
function adapter() {
  const mint = mock(async () => ({
    provider: 'openai' as const,
    value: 'ek-synthetic',
    model: 'gpt-realtime',
    expiresAt: (Math.floor(Date.now() / 1000) + 60) as UnixSeconds,
  }));
  const instance = new OpenAIAdapter({ mintToken: mint });
  adapters.push(instance);
  return { instance, mint };
}

test('blocked remote playback is observable and retries the existing session', async () => {
  const { instance, mint } = adapter();
  const { peer, audio } = await connect(instance);
  const error = Object.assign(new Error('Browser blocked autoplay'), {
    name: 'NotAllowedError',
  });
  audio.play.mockRejectedValueOnce(error);
  const remote = new Stream() as unknown as MediaStream;
  peer.ontrack?.({ streams: [remote] });
  await flush();
  expect(instance.getAudioPlaybackStatus()).toBe('blocked');
  expect(peer.closed).toBe(false);

  const retry = instance.resumeAudioPlayback();
  expect(audio.play).toHaveBeenCalledTimes(2);
  await retry;
  expect(instance.getAudioPlaybackStatus()).toBe('playing');
  expect(mint).toHaveBeenCalledTimes(1);
  expect(exchange).toHaveBeenCalledTimes(1);
  expect(microphone).toHaveBeenCalledTimes(1);
  expect(Peer.instances).toHaveLength(1);
});

function deferred() {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
function remoteStream(): MediaStream {
  return new Stream() as unknown as MediaStream;
}

test('a failed explicit retry remains recoverable without a transport error', async () => {
  const { instance, mint } = adapter();
  const events: string[] = [];
  instance.on((event) => events.push(event.type));
  const { peer, audio } = await connect(instance);
  audio.play.mockRejectedValueOnce(
    new DOMException('Blocked', 'NotAllowedError'),
  );
  peer.ontrack?.({ streams: [remoteStream()] });
  await flush();
  audio.play.mockRejectedValueOnce(
    new DOMException('Still blocked', 'NotAllowedError'),
  );
  await expect(instance.resumeAudioPlayback()).rejects.toThrow(
    'Audio playback could not start',
  );
  expect(instance.getAudioPlaybackStatus()).toBe('blocked');
  expect(events).not.toContain('error');
  expect(peer.closed).toBe(false);
  expect(mint).toHaveBeenCalledTimes(1);
});

test('observer failures do not prevent playback or completed disconnect cleanup', async () => {
  const { instance } = adapter();
  const { peer, audio } = await connect(instance);
  const states: string[] = [];
  instance.subscribeAudioPlayback(() => {
    throw new Error('Synchronous view failure');
  });
  instance.subscribeAudioPlayback(async () => {
    throw new Error('Asynchronous view failure');
  });
  const release = instance.subscribeAudioPlayback(() =>
    states.push(instance.getAudioPlaybackStatus()),
  );
  expect(states).toEqual([]);
  peer.ontrack?.({ streams: [remoteStream()] });
  await flush();
  expect(states).toEqual(['ready', 'playing']);
  await instance.disconnect();
  await flush();
  expect(states).toEqual(['ready', 'playing', 'unavailable']);
  expect(peer.closed).toBe(true);
  expect(audio.paused).toBe(true);
  expect(audio.srcObject).toBeNull();
  release();
});

test('a retired play rejection cannot overwrite a replacement connection', async () => {
  const { instance } = adapter();
  const first = await connect(instance);
  const old = deferred();
  first.audio.play.mockImplementationOnce(() => old.promise);
  first.peer.ontrack?.({ streams: [remoteStream()] });
  await flush();
  await instance.disconnect();
  const next = await connect(instance);
  next.peer.ontrack?.({ streams: [remoteStream()] });
  await flush();
  expect(instance.getAudioPlaybackStatus()).toBe('playing');
  old.reject(new DOMException('Old connection blocked', 'NotAllowedError'));
  await flush();
  expect(instance.getAudioPlaybackStatus()).toBe('playing');
  expect(next.peer.closed).toBe(false);
});

test('a retired play fulfillment cannot restore playing after disconnect', async () => {
  const { instance } = adapter();
  const { peer, audio } = await connect(instance);
  const old = deferred();
  audio.play.mockImplementationOnce(() => old.promise);
  peer.ontrack?.({ streams: [remoteStream()] });
  await flush();
  await instance.disconnect();
  old.resolve();
  await flush();
  expect(instance.getAudioPlaybackStatus()).toBe('unavailable');
  expect(audio.srcObject).toBeNull();
  expect(audio.paused).toBe(true);
});

test('the latest retry owns the playback result on the same stream', async () => {
  const { instance } = adapter();
  const { peer, audio } = await connect(instance);
  audio.play.mockRejectedValueOnce(
    new DOMException('Blocked', 'NotAllowedError'),
  );
  peer.ontrack?.({ streams: [remoteStream()] });
  await flush();
  const old = deferred();
  audio.play.mockImplementationOnce(() => old.promise);
  const olderRetry = instance.resumeAudioPlayback();
  await instance.resumeAudioPlayback();
  old.reject(new DOMException('Older retry blocked', 'NotAllowedError'));
  await olderRetry;
  expect(instance.getAudioPlaybackStatus()).toBe('playing');
});

test('stream replacement retires pending playback even on the same audio element', async () => {
  const { instance } = adapter();
  const { peer, audio } = await connect(instance);
  const old = deferred();
  audio.play.mockImplementationOnce(() => old.promise);
  peer.ontrack?.({ streams: [remoteStream()] });
  await flush();
  const replacement = remoteStream();
  peer.ontrack?.({ streams: [replacement] });
  await flush();
  old.reject(new DOMException('Old stream blocked', 'NotAllowedError'));
  await flush();
  expect(instance.getAudioPlaybackStatus()).toBe('playing');
  expect(audio.srcObject).toBe(replacement);
});

test('an empty remote stream retires playback and makes retry a no-op', async () => {
  const { instance, mint } = adapter();
  const { peer, audio } = await connect(instance);
  peer.ontrack?.({ streams: [remoteStream()] });
  await flush();
  peer.ontrack?.({ streams: [] });
  await instance.resumeAudioPlayback();
  expect(instance.getAudioPlaybackStatus()).toBe('unavailable');
  expect(audio.srcObject).toBeNull();
  expect(audio.play).toHaveBeenCalledTimes(1);
  expect(mint).toHaveBeenCalledTimes(1);
});

test('a ready observer can retry without a duplicate automatic attempt', async () => {
  const { instance } = adapter();
  const { peer, audio } = await connect(instance);
  instance.subscribeAudioPlayback(() => {
    if (instance.getAudioPlaybackStatus() === 'ready')
      void instance.resumeAudioPlayback();
  });
  peer.ontrack?.({ streams: [remoteStream()] });
  await flush();
  expect(audio.play).toHaveBeenCalledTimes(1);
  expect(instance.getAudioPlaybackStatus()).toBe('playing');
});

test('a ready observer can disconnect before automatic playback begins', async () => {
  const { instance } = adapter();
  const { peer, audio } = await connect(instance);
  instance.subscribeAudioPlayback(() => {
    if (instance.getAudioPlaybackStatus() === 'ready')
      void instance.disconnect();
  });
  const snapshots: string[] = [];
  instance.subscribeAudioPlayback(() =>
    snapshots.push(instance.getAudioPlaybackStatus()),
  );
  peer.ontrack?.({ streams: [remoteStream()] });
  await flush();
  expect(snapshots).toEqual(['unavailable']);
  expect(audio.play).not.toHaveBeenCalled();
  expect(peer.closed).toBe(true);
  expect(instance.getAudioPlaybackStatus()).toBe('unavailable');
});

test('retry before a remote stream exists does not create a session', async () => {
  const { instance, mint } = adapter();
  await instance.resumeAudioPlayback();
  expect(instance.getAudioPlaybackStatus()).toBe('unavailable');
  expect(mint).not.toHaveBeenCalled();
  expect(exchange).not.toHaveBeenCalled();
  expect(microphone).not.toHaveBeenCalled();
});

test('a non-policy play failure retains diagnostics without tearing down voice', async () => {
  const { instance } = adapter();
  const { peer, audio } = await connect(instance);
  audio.play.mockRejectedValueOnce(new Error('Output not ready'));
  peer.ontrack?.({ streams: [remoteStream()] });
  await flush();
  expect(instance.getAudioPlaybackStatus()).toBe('ready');
  const failure = new Error('Output still not ready');
  audio.play.mockRejectedValueOnce(failure);
  const retry = instance.resumeAudioPlayback();
  await expect(retry).rejects.toThrow('Audio playback could not start');
  await expect(retry).rejects.toHaveProperty('cause', failure);
  expect(instance.getAudioPlaybackStatus()).toBe('ready');
  expect(peer.closed).toBe(false);
});

test('released observers do not receive later playback changes', async () => {
  const { instance } = adapter();
  const observed = mock();
  const release = instance.subscribeAudioPlayback(observed);
  release();
  release();
  const { peer } = await connect(instance);
  peer.ontrack?.({ streams: [remoteStream()] });
  await flush();
  await instance.disconnect();
  expect(observed).not.toHaveBeenCalled();
});

test('a failure observer can retire an explicit retry without leaking its error', async () => {
  const { instance } = adapter();
  const { peer, audio } = await connect(instance);
  peer.ontrack?.({ streams: [remoteStream()] });
  await flush();
  instance.subscribeAudioPlayback(() => {
    if (instance.getAudioPlaybackStatus() === 'blocked')
      void instance.disconnect();
  });
  audio.play.mockRejectedValueOnce(
    new DOMException('Blocked', 'NotAllowedError'),
  );
  await instance.resumeAudioPlayback();
  expect(instance.getAudioPlaybackStatus()).toBe('unavailable');
  expect(peer.closed).toBe(true);
});

test('inspecting a playback failure cannot restore status after that attempt retires', async () => {
  const { instance } = adapter();
  const { peer, audio } = await connect(instance);
  peer.ontrack?.({ streams: [remoteStream()] });
  await flush();
  const error = Object.defineProperty({}, 'name', {
    get() {
      void instance.disconnect();
      return 'NotAllowedError';
    },
  });
  audio.play.mockRejectedValueOnce(error);
  await instance.resumeAudioPlayback();
  expect(instance.getAudioPlaybackStatus()).toBe('unavailable');
  expect(peer.closed).toBe(true);
});
