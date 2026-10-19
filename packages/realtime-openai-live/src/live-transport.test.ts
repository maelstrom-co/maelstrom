import { afterEach, describe, expect, mock, test } from 'bun:test';
import type {
  AdapterDiagnosticObservation,
  AdapterVoiceObservation,
  RealtimeTransportAdapter,
} from '@maelstrom-co/realtime';
import type {
  LiveExchangeResponse,
  LiveSessionConfig,
} from '@maelstrom-co/realtime-protocol/openai-live';
import { install } from '@sinonjs/fake-timers';
import { OpenAILiveTransport } from './live-transport.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const config: LiveSessionConfig = {
  model: 'gpt-live-1',
  delegation: { type: 'responses', responses: { model: 'backend' } },
};
class Track extends EventTarget {
  kind = 'audio';
  enabled = true;
  muted = false;
  readyState = 'live';
  stopped = 0;
  stop() {
    this.stopped++;
    this.readyState = 'ended';
  }
}
class Stream {
  constructor(readonly tracks: Track[] = []) {}
  getTracks() {
    return this.tracks;
  }
  getAudioTracks() {
    return this.tracks;
  }
  addTrack(track: Track) {
    this.tracks.push(track);
  }
}
class Channel extends EventTarget {
  readyState = 'open';
  sent: string[] = [];
  closed = false;
  send(data: string) {
    this.sent.push(JSON.parse(data).type);
  }
  close() {
    this.closed = true;
    this.dispatchEvent(new Event('close'));
  }
  event(type: string, fields: object = {}) {
    this.dispatchEvent(
      new MessageEvent('message', {
        data: JSON.stringify({ type, event_id: 'evt', ...fields }),
      }),
    );
  }
}
class Peer extends EventTarget {
  channel = new Channel();
  connectionState = 'new';
  iceGatheringState = 'complete';
  localDescription = { sdp: 'v=0\r\no=offer' };
  closed = false;
  remote = 0;
  offerGate?: Promise<void>;
  localGate?: Promise<void>;
  answerGate?: Promise<void>;
  addTrack() {}
  createDataChannel() {
    return this.channel;
  }
  async createOffer() {
    await this.offerGate;
    return { type: 'offer', sdp: this.localDescription.sdp };
  }
  async setLocalDescription() {
    await this.localGate;
  }
  async setRemoteDescription() {
    this.remote++;
    await this.answerGate;
  }
  close() {
    this.closed = true;
  }
}
const all: OpenAILiveTransport[] = [];
afterEach(async () => {
  for (const transport of all.splice(0)) await transport.disconnect();
});
function harness(
  options: {
    permission?: Promise<MediaStream>;
    exchangeGate?: Promise<void>;
    handshake?: number;
    close?: number;
    playbackBargeIn?: boolean;
  } = {},
) {
  const peer = new Peer();
  const mic = new Track();
  let calls = 0;
  let playbackCalls = 0;
  let rejectPlay = false;
  const audio = {
    srcObject: null,
    pause() {},
    play: async () => {
      playbackCalls++;
      if (rejectPlay) throw new Error('blocked');
    },
  };
  const transport = new OpenAILiveTransport({
    handshakeTimeoutMs: options.handshake ?? 1000,
    playbackBargeIn: options.playbackBargeIn,
    closeTimeoutMs: options.close ?? 5,
    createPeer: () => peer as unknown as RTCPeerConnection,
    createAudio: () => audio as unknown as HTMLAudioElement,
    getMicrophone: () =>
      options.permission ??
      Promise.resolve(new Stream([mic]) as unknown as MediaStream),
    exchange: async (_, signal) => {
      calls++;
      await options.exchangeGate;
      expect(typeof signal.aborted).toBe('boolean');
      return {
        session: { id: 'live_opaque' },
        transport: { type: 'webrtc', sdp: 'v=0\r\no=answer' },
      };
    },
  });
  all.push(transport);
  const contract: RealtimeTransportAdapter<LiveSessionConfig> = transport;
  const start = () => contract.connect(config);
  const started = () =>
    peer.channel.event('session.started', { session: { id: 'live_opaque' } });
  return {
    transport,
    peer,
    mic,
    audio,
    start,
    started,
    calls: () => calls,
    playbackCalls: () => playbackCalls,
    rejectPlayback: (value: boolean) => {
      rejectPlay = value;
    },
  };
}

test('provider diagnostics keep arguments lazy and project only supported native evidence', async () => {
  const h = harness();
  const source: RealtimeTransportAdapter<LiveSessionConfig> = h.transport;
  const observations: AdapterDiagnosticObservation[] = [];
  const release = source.diagnostics?.subscribe((observation) =>
    observations.push(observation),
  );
  const ready = h.start();
  await tick();
  h.started();
  await ready;
  h.peer.channel.event('response.event', {
    delegation_id: 'delegation-1',
    event: {
      type: 'response.output_item.done',
      response_id: 'response-1',
      item: {
        type: 'function_call',
        call_id: 'call-1',
        name: 'update_ui',
        arguments: JSON.stringify({
          intent: `private words sk-${'a'.repeat(40)}`,
          apiKey: 'provider-secret',
        }),
        extra: 'unrelated-content',
      },
    },
  });
  expect(observations).toHaveLength(1);
  expect(observations[0]?.metadata).toMatchObject({
    direction: 'received',
    delegationId: 'delegation-1',
    responseId: 'response-1',
    callId: 'call-1',
    tool: 'update_ui',
  });
  expect(JSON.stringify(observations)).not.toMatch(
    /private words|provider-secret|unrelated-content|arguments|intent/,
  );
  expect(observations[0]?.readContent?.()).toEqual({
    intent: 'private words [REDACTED]',
  });
  expect(observations[0]?.providerGeneration).toBe(1);
  release?.();
});

test('diagnostic failures cannot change native sends and failed sends are not reported as successful', async () => {
  const h = harness();
  const observations: AdapterDiagnosticObservation[] = [];
  const errors: unknown[] = [];
  h.transport.on((event) => {
    if (event.type === 'error') errors.push(event.error);
  });
  h.transport.diagnostics.subscribe(async () => {
    throw new Error('optional rejection');
  });
  h.transport.diagnostics.subscribe(() => ({
    // biome-ignore lint/suspicious/noThenProperty: Observer results may fail during thenable assimilation.
    get then() {
      throw new Error('optional then getter');
    },
  }));
  h.transport.diagnostics.subscribe((observation) =>
    observations.push(observation),
  );
  const ready = h.start();
  await tick();
  h.started();
  await ready;
  const nativeMessages: string[] = [];
  h.peer.channel.addEventListener('message', () =>
    nativeMessages.push('received'),
  );
  h.peer.channel.event('session.delegation.created', {
    delegation: { id: 'delegation-1', response_id: 'response-1' },
  });
  h.transport.send({ type: 'response.create', event_id: 'continuation-1' }, 1);
  await tick();
  expect(errors).toEqual([]);
  expect(nativeMessages).toEqual(['received']);
  expect(h.peer.channel.sent).toEqual(['response.create']);
  expect(
    observations.map((observation) => [
      observation.metadata.type,
      observation.metadata.direction,
    ]),
  ).toEqual([
    ['session.delegation.created', 'received'],
    ['response.create', 'sent'],
  ]);
  h.peer.channel.send = () => {
    throw new Error('native send failure');
  };
  expect(() =>
    h.transport.send(
      { type: 'response.create', event_id: 'failed-continuation' },
      1,
    ),
  ).toThrow();
  expect(observations).toHaveLength(2);
  expect(h.transport.getSnapshot().state).toBe('error');
});

test('semantic context tags correlate acknowledgments without reading context prose', async () => {
  const h = harness();
  const observations: AdapterDiagnosticObservation[] = [];
  h.transport.diagnostics.subscribe((observation) =>
    observations.push(observation),
  );
  const ready = h.start();
  await tick();
  h.started();
  await ready;
  h.transport.send(
    {
      type: 'session.thinking.append',
      event_id: 'context-1',
      delegation_id: null,
      content: 'private context without a diagnostic prefix',
    },
    1,
    'ui_snapshot',
  );
  h.peer.channel.event('session.thinking.appended', {
    client_event_id: 'context-1',
  });
  expect(observations.map((observation) => observation.metadata)).toMatchObject(
    [
      {
        direction: 'sent',
        type: 'session.thinking.append',
        contextKind: 'ui_snapshot',
        eventId: 'context-1',
      },
      {
        direction: 'received',
        type: 'session.thinking.appended',
        clientEventId: 'context-1',
      },
    ],
  );
  expect(JSON.stringify(observations)).not.toMatch(
    /private context|snapshotRevision/,
  );
  expect(observations[0]?.readContent?.()).toBeUndefined();
});

test('malformed function arguments preserve receipt facts without exposing arbitrary payloads', async () => {
  const h = harness();
  const observations: AdapterDiagnosticObservation[] = [];
  const release = h.transport.diagnostics.subscribe((observation) =>
    observations.push(observation),
  );
  const ready = h.start();
  await tick();
  h.started();
  await ready;
  h.peer.channel.event('response.event', {
    event: {
      type: 'response.output_item.done',
      item: {
        type: 'function_call',
        call_id: 'malformed-call',
        name: 'unknown-user-text',
        arguments: '{broken',
        privateField: 'private payload',
      },
    },
  });
  expect(observations[0]?.metadata.callId).toBe('malformed-call');
  expect(observations[0]?.metadata.tool).toBeUndefined();
  expect(observations[0]?.readContent?.()).toBeUndefined();
  expect(JSON.stringify(observations)).not.toMatch(
    /private payload|unknown-user-text|broken/,
  );
  release();
  h.peer.channel.event('response.created', { response_id: 'not-observed' });
  expect(observations).toHaveLength(1);
});
describe('startup cannot outlive its explicit generation', () => {
  test.each([
    'failed',
    'closed',
  ])('terminal peer %s bypasses disconnect grace', async (state) => {
    const h = harness();
    const ready = h.start();
    await tick();
    h.started();
    await ready;
    h.peer.connectionState = state;
    h.peer.dispatchEvent(new Event('connectionstatechange'));
    expect(h.mic.stopped).toBe(1);
    expect(h.peer.closed).toBe(true);
  });

  test('End releases media during grace and its old deadline cannot close a replacement', async () => {
    const h = harness();
    const ready = h.start();
    await tick();
    h.started();
    await ready;
    const clock = install({ shouldClearNativeTimers: true });
    try {
      h.peer.connectionState = 'disconnected';
      h.peer.dispatchEvent(new Event('connectionstatechange'));
      const ended = h.transport.disconnect();
      expect(h.mic.stopped).toBe(1);
      await clock.tickAsync(5);
      await ended;
      h.mic.readyState = 'live';
      h.peer.closed = false;
      h.peer.channel.closed = false;
      const replacement = h.start();
      await clock.tickAsync(0);
      h.started();
      await replacement;
      await clock.tickAsync(5000);
      expect(h.transport.getSnapshot().state).toBe('connected');
      expect(h.peer.closed).toBe(false);
      expect(h.calls()).toBe(2);
      const stop = h.transport.disconnect();
      await clock.tickAsync(5);
      await stop;
    } finally {
      clock.uninstall();
    }
  });

  test.each([
    'session.input_transcript.delta',
    'session.output_transcript.delta',
  ])('%s rejects oversized identities instead of silently losing transcript evidence', async (type) => {
    const h = harness();
    const fragments: AdapterVoiceObservation[] = [];
    const errors: unknown[] = [];
    h.transport.observations.subscribe((event) => fragments.push(event));
    h.transport.on((event) => {
      if (event.type === 'error') errors.push(event.error);
    });
    const ready = h.start();
    await tick();
    h.started();
    await ready;
    h.peer.channel.event(type, {
      event_id: 'a'.repeat(256),
      delta: 'exact',
      start_ms: 0,
      end_ms: 1,
    });
    expect(fragments.filter((event) => event.type === 'fragment')).toEqual([
      {
        type: 'fragment',
        fragment: {
          id: 'a'.repeat(256),
          text: 'exact',
          startMs: 0,
          endMs: 1,
          role: type.includes('input') ? 'user' : 'assistant',
          speakerId: type.includes('input') ? 'user' : 'assistant',
        },
      },
    ]);
    h.peer.channel.event(type, {
      event_id: 'a'.repeat(257),
      delta: 'lost',
      start_ms: 1,
      end_ms: 2,
    });
    expect(errors).toMatchObject([{ code: 'invalid_event' }]);
    expect(fragments.filter((event) => event.type === 'fragment')).toHaveLength(
      1,
    );
  });

  test('recovers the same peer during a non-extending disconnect grace period', async () => {
    const h = harness();
    const ready = h.start();
    await tick();
    h.started();
    await ready;
    const clock = install({ shouldClearNativeTimers: true });
    const state = (value: string) => {
      h.peer.connectionState = value;
      h.peer.dispatchEvent(new Event('connectionstatechange'));
    };
    try {
      state('disconnected');
      expect(h.mic.stopped).toBe(0);
      await clock.tickAsync(4999);
      state('connected');
      await clock.tickAsync(5001);
      expect(h.transport.getSnapshot().state).toBe('connected');
      expect(h.calls()).toBe(1);
      state('disconnected');
      await clock.tickAsync(4000);
      state('disconnected');
      await clock.tickAsync(1000);
      expect(h.mic.stopped).toBe(1);
      expect(h.peer.closed).toBe(true);
    } finally {
      clock.uninstall();
    }
  });

  test.each([
    'peer',
    'audio',
    'microphone',
  ])('cancellation inside the %s factory disposes returned resources before further startup', async (stage) => {
    const peer = new Peer();
    const mic = new Track();
    const permission = deferred<MediaStream>();
    const calls: string[] = [];
    const states: string[] = [];
    let paused = 0;
    const audio = {
      srcObject: new Stream(),
      pause() {
        paused++;
      },
    };
    const cancel = (factory: string) => {
      calls.push(factory);
      if (stage === factory) void transport.disconnect();
    };
    const transport = new OpenAILiveTransport({
      createPeer: () => {
        cancel('peer');
        return peer as unknown as RTCPeerConnection;
      },
      createAudio: () => {
        cancel('audio');
        return audio as unknown as HTMLAudioElement;
      },
      getMicrophone: () => {
        cancel('microphone');
        return permission.promise;
      },
      exchange: () => {
        throw new Error('cancelled startup must not exchange');
      },
    });
    all.push(transport);
    transport.on((event) => {
      if (event.type === 'state') states.push(event.state);
    });
    await expect(transport.connect(config)).rejects.toMatchObject({
      code: 'aborted',
    });
    permission.resolve(new Stream([mic]) as unknown as MediaStream);
    await tick();
    expect(peer.closed).toBe(true);
    expect(calls).toEqual(
      ['peer', 'audio', 'microphone'].slice(
        0,
        ['peer', 'audio', 'microphone'].indexOf(stage) + 1,
      ),
    );
    expect(states).toEqual(['idle']);
    expect(transport.getSnapshot().state).toBe('closed');
    if (stage !== 'peer') {
      expect(paused).toBeGreaterThan(0);
      expect(audio.srcObject).toBeNull();
    }
    if (stage === 'microphone') expect(mic.stopped).toBe(1);
  });

  test('listener failure reporting stops when an error listener replaces the generation', async () => {
    const h = harness();
    const received: unknown[] = [];
    let replaced = false;
    h.transport.subscribe(() => {
      if (!replaced) throw new Error('observer failed');
    });
    h.transport.on((event) => {
      if (event.type === 'error' && !replaced) {
        replaced = true;
        void h.transport.disconnect();
        void h.transport.connect(config).catch(() => {});
      }
    });
    h.transport.on((event) => {
      if (event.type === 'error') received.push(event.error);
    });
    await expect(h.start()).rejects.toMatchObject({ code: 'aborted' });
    expect(h.transport.getSnapshot().generation).toBe(2);
    expect(received).toEqual([]);
  });
  test.each([
    'exchange',
    'playback',
  ])('replacement between wait resolution and the %s continuation retains its own snapshot', async (stage) => {
    const previous = globalThis.MediaStream;
    globalThis.MediaStream = Stream as unknown as typeof MediaStream;
    const exchange = deferred<LiveExchangeResponse>();
    const playback = deferred<void>();
    const peers: Peer[] = [];
    let calls = 0;
    const transport = new OpenAILiveTransport({
      closeTimeoutMs: 5,
      createPeer: () => {
        const peer = new Peer();
        peers.push(peer);
        return peer as unknown as RTCPeerConnection;
      },
      createAudio: () =>
        ({
          play: () => playback.promise,
          pause() {},
        }) as unknown as HTMLAudioElement,
      getMicrophone: async () =>
        new Stream([new Track()]) as unknown as MediaStream,
      exchange: () =>
        ++calls === 1 ? exchange.promise : new Promise(() => {}),
    });
    all.push(transport);
    try {
      const initial = transport.connect(config);
      void initial.catch(() => {});
      await tick();
      if (stage === 'playback') {
        exchange.resolve({
          session: { id: 'OLD_SESSION' },
          transport: { type: 'webrtc', sdp: 'v=0\r\n' },
        });
        await tick();
        peers[0]!.channel.event('session.started', {
          session: { id: 'OLD_SESSION' },
        });
        await initial;
        peers[0]!.dispatchEvent(
          Object.assign(new Event('track'), { track: new Track() }),
        );
        await tick();
      }
      if (stage === 'exchange')
        exchange.resolve({
          session: { id: 'OLD_SESSION' },
          transport: { type: 'webrtc', sdp: 'v=0\r\n' },
        });
      else playback.resolve();
      queueMicrotask(() =>
        queueMicrotask(() => {
          void transport.disconnect();
          peers[0]!.channel.close();
          void transport.connect(config).catch(() => {});
        }),
      );
      await tick();
      expect(transport.getSnapshot()).toMatchObject({
        generation: 2,
        state: 'connecting',
        playback: 'unavailable',
        finalization: 'pending',
      });
      expect(transport.getSnapshot().sessionId).toBeUndefined();
      expect(peers[0]!.closed).toBe(true);
    } finally {
      globalThis.MediaStream = previous;
    }
  });
  test('an exchange abort listener can connect a replacement without old teardown overwriting its state or media', async () => {
    const peers: Peer[] = [];
    const tracks: Track[] = [];
    const media: AdapterVoiceObservation[] = [];
    let calls = 0;
    const transport = new OpenAILiveTransport({
      createPeer: () => {
        const peer = new Peer();
        peers.push(peer);
        return peer as unknown as RTCPeerConnection;
      },
      createAudio: () =>
        ({ pause() {}, play: async () => {} }) as unknown as HTMLAudioElement,
      getMicrophone: async () => {
        const track = new Track();
        tracks.push(track);
        return new Stream([track]) as unknown as MediaStream;
      },
      exchange: (_, signal) => {
        if (++calls === 1)
          signal.addEventListener(
            'abort',
            () => {
              void transport.connect(config).catch(() => {});
              media.length = 0;
            },
            { once: true },
          );
        return new Promise(() => {});
      },
    });
    all.push(transport);
    transport.observations.subscribe((event) => media.push(event));
    const first = transport.connect(config);
    void first.catch(() => {});
    await tick();
    await transport.disconnect();
    await tick();
    expect(transport.getSnapshot()).toMatchObject({
      generation: 2,
      state: 'connecting',
      finalization: 'pending',
    });
    expect(media).not.toContainEqual({
      type: 'media',
      media: {
        microphone: 'inactive',
        incomingAudio: 'inactive',
        userSpeech: 'unknown',
      },
    });
    expect(peers[0]!.closed).toBe(true);
    expect(peers[0]!.channel.closed).toBe(true);
    expect(tracks[0]!.readyState).toBe('ended');
    expect(tracks[1]!.readyState).toBe('live');
  });
  test('HTTP and channel open do not establish readiness; concurrent connect does not bill twice', async () => {
    const h = harness();
    const first = h.start();
    const second = h.start();
    expect(first).toBe(second);
    let ready = false;
    void first.then(() => {
      ready = true;
    });
    await tick();
    expect(h.calls()).toBe(1);
    expect(h.peer.remote).toBe(1);
    expect(ready).toBe(false);
    h.started();
    await first;
    expect(ready).toBe(true);
    expect(h.peer.channel.sent).toEqual([]);
  });
  test('session.started during answer application is retained but does not resolve early', async () => {
    const h = harness();
    const gate = deferred<void>();
    h.peer.answerGate = gate.promise;
    const pending = h.start();
    await tick();
    h.started();
    expect(h.transport.getSnapshot().state).toBe('connecting');
    gate.resolve();
    await pending;
    expect(h.transport.getSnapshot().state).toBe('connected');
  });
  test.each([
    'permission',
    'offer',
    'local',
    'ice',
    'exchange',
    'answer',
    'started',
  ])('stop at %s releases resources and rejects startup', async (stage) => {
    const gate = deferred<void>();
    const permission = deferred<MediaStream>();
    const h = harness({
      permission: stage === 'permission' ? permission.promise : undefined,
      exchangeGate: stage === 'exchange' ? gate.promise : undefined,
    });
    if (stage === 'offer') h.peer.offerGate = gate.promise;
    if (stage === 'local') h.peer.localGate = gate.promise;
    if (stage === 'ice') h.peer.iceGatheringState = 'gathering';
    if (stage === 'answer') h.peer.answerGate = gate.promise;
    const pending = h.start();
    await tick();
    await h.transport.disconnect();
    await expect(pending).rejects.toMatchObject({ code: 'aborted' });
    const late = new Track();
    permission.resolve(new Stream([late]) as unknown as MediaStream);
    gate.resolve();
    await tick();
    expect(h.peer.closed).toBe(true);
    expect(h.peer.channel.closed).toBe(true);
    if (stage === 'permission') expect(late.readyState).toBe('ended');
    else expect(h.mic.readyState).toBe('ended');
    expect(h.transport.getSnapshot().finalization).toBe('incomplete');
    if (['permission', 'offer', 'local', 'ice'].includes(stage))
      expect(h.calls()).toBe(0);
    if (stage === 'exchange') expect(h.peer.remote).toBe(0);
  });
  test('handshake timeout includes stalled permission and releases a late grant', async () => {
    const gate = deferred<MediaStream>();
    const h = harness({ permission: gate.promise, handshake: 10 });
    await expect(h.start()).rejects.toMatchObject({
      code: 'handshake_timeout',
    });
    const late = new Track();
    gate.resolve(new Stream([late]) as unknown as MediaStream);
    await tick();
    expect(late.readyState).toBe('ended');
  });
  test('reentrant stop from state callbacks cannot resume startup or strand the microphone', async () => {
    const h = harness();
    h.transport.on((event) => {
      if (event.type === 'state' && event.state === 'connecting')
        void h.transport.disconnect();
    });
    await expect(h.start()).rejects.toMatchObject({ code: 'aborted' });
    await tick();
    expect(h.calls()).toBe(0);
    expect(h.peer.closed).toBe(true);
    expect(h.mic.readyState).toBe('ended');
  });
});
describe('continuous evidence and finalization', () => {
  test('reentrant disconnect cannot deliver an obsolete connected event to later listeners', async () => {
    const h = harness();
    const states: string[] = [];
    h.transport.on((event) => {
      if (event.type === 'state' && event.state === 'connected') {
        void h.transport.disconnect();
      }
    });
    h.transport.on((event) => {
      if (event.type === 'state') states.push(event.state);
    });
    const pending = h.start();
    await tick();
    h.started();
    await expect(pending).rejects.toMatchObject({ code: 'aborted' });
    expect(states).toEqual(['connecting', 'idle']);
  });
  test('a stale exchange and generation-bound send cannot affect the replacement session', async () => {
    const firstExchange = deferred<void>();
    const peers: Peer[] = [];
    const tracks: Track[] = [];
    let calls = 0;
    const transport = new OpenAILiveTransport({
      closeTimeoutMs: 5,
      createPeer: () => {
        const peer = new Peer();
        peers.push(peer);
        return peer as unknown as RTCPeerConnection;
      },
      createAudio: () =>
        ({ play: async () => {}, pause() {} }) as unknown as HTMLAudioElement,
      getMicrophone: async () => {
        const track = new Track();
        tracks.push(track);
        return new Stream([track]) as unknown as MediaStream;
      },
      exchange: async () => {
        const call = ++calls;
        if (call === 1) await firstExchange.promise;
        return {
          session: { id: `live_${call}` },
          transport: { type: 'webrtc', sdp: 'v=0\r\n' },
        };
      },
    });
    all.push(transport);
    const first = transport.connect(config);
    await tick();
    await transport.disconnect();
    await expect(first).rejects.toMatchObject({ code: 'aborted' });
    const second = transport.connect(config);
    await tick();
    firstExchange.resolve();
    await tick();
    peers[0]?.channel.event('session.started', { session: { id: 'live_1' } });
    expect(peers[0]?.remote).toBe(0);
    peers[1]?.channel.event('session.started', { session: { id: 'live_2' } });
    await second;
    expect(transport.getSnapshot()).toMatchObject({
      generation: 2,
      sessionId: 'live_2',
      state: 'connected',
    });
    expect(() =>
      transport.send({ type: 'response.create', event_id: 'stale' }, 1),
    ).toThrow();
    transport.send({ type: 'response.create', event_id: 'fresh' }, 2);
    expect(peers[1]?.channel.sent).toEqual(['response.create']);
    expect(tracks[0]?.readyState).toBe('ended');
  });
  test('channel loss stops capture and requires an explicit new connect', async () => {
    const h = harness();
    const pending = h.start();
    await tick();
    h.started();
    await pending;
    h.peer.channel.close();
    await tick();
    expect(h.transport.getSnapshot()).toMatchObject({
      state: 'error',
      finalization: 'incomplete',
    });
    expect(h.mic.readyState).toBe('ended');
    expect(h.calls()).toBe(1);
  });
  test('raw transcript identity, text, overlaps and timing survive without final-turn fiction', async () => {
    const h = harness();
    const observations: AdapterVoiceObservation[] = [];
    h.transport.observations.subscribe((value) => observations.push(value));
    const pending = h.start();
    await tick();
    h.started();
    await pending;
    const raw = {
      event_id: 'exact-id',
      delta: '  repeated repeated ',
      start_ms: 100,
      end_ms: 250,
    };
    h.peer.channel.event('session.input_transcript.delta', raw);
    h.peer.channel.event('session.output_transcript.delta', {
      ...raw,
      event_id: 'other',
    });
    expect(observations.filter((value) => value.type === 'fragment')).toEqual([
      {
        type: 'fragment',
        fragment: {
          id: 'exact-id',
          role: 'user',
          speakerId: 'user',
          text: raw.delta,
          startMs: 100,
          endMs: 250,
        },
      },
      {
        type: 'fragment',
        fragment: {
          id: 'other',
          role: 'assistant',
          speakerId: 'assistant',
          text: raw.delta,
          startMs: 100,
          endMs: 250,
        },
      },
    ]);
    expect(
      observations.some(
        (value) =>
          value.type === 'media' && value.media.userSpeech === 'active',
      ),
    ).toBe(false);
  });
  test('usage is cumulative, close drains, and validated final usage survives later channel closure', async () => {
    const h = harness({ close: 100 });
    const pending = h.start();
    await tick();
    h.started();
    await pending;
    h.peer.channel.event('session.usage.updated', { usage: { seconds: 10 } });
    h.peer.channel.event('session.usage.updated', {
      usage: { seconds: 12 },
      context_window: { usage_ratio: 0.4 },
    });
    expect(h.transport.getSnapshot().usageSeconds).toBe(12);
    const close = h.transport.disconnect();
    expect(h.transport.disconnect()).toBe(close);
    expect(h.mic.readyState).toBe('ended');
    expect(h.peer.closed).toBe(false);
    expect(() =>
      h.transport.send({ type: 'response.create', event_id: 'late' }, 1),
    ).toThrow();
    await expect(h.start()).rejects.toMatchObject({ code: 'closing' });
    h.peer.channel.event('session.closed', {
      usage: { seconds: 15 },
      reason: 'connection_lost',
      session: { id: 'live_opaque', model: 'gpt-live-1' },
    });
    await close;
    expect(h.transport.getSnapshot()).toMatchObject({
      finalization: 'confirmed',
      usageSeconds: 15,
      finalUsageSeconds: 15,
      contextUsageRatio: 0.4,
    });
    expect(h.peer.closed).toBe(true);
  });
  test('close timeout retains provisional usage and never invents final usage', async () => {
    const h = harness();
    const pending = h.start();
    await tick();
    h.started();
    await pending;
    h.peer.channel.event('session.usage.updated', { usage: { seconds: 9 } });
    await h.transport.disconnect();
    expect(h.transport.getSnapshot()).toMatchObject({
      finalization: 'incomplete',
      usageSeconds: 9,
    });
    expect(h.transport.getSnapshot().finalUsageSeconds).toBeUndefined();
  });
  test('nullable command errors and throwing host listeners do not prevent other listeners or cleanup', async () => {
    const h = harness();
    const errors: unknown[] = [];
    h.transport.on((event) => {
      if (event.type === 'error') errors.push(event.error);
    });
    h.transport.onServerEvent(() => {
      throw new Error('host secret');
    });
    let events = 0;
    h.transport.onServerEvent(() => {
      events++;
    });
    const pending = h.start();
    await tick();
    h.started();
    await pending;
    h.peer.channel.event('error', {
      error: { code: null, client_event_id: 'command_1' },
    });
    expect(errors).toContainEqual(
      expect.objectContaining({
        code: 'provider_rejected',
        providerCode: null,
        clientEventId: 'command_1',
        fatal: false,
      }),
    );
    expect(events).toBe(2);
    expect(h.transport.getSnapshot().state).toBe('connected');
    await h.transport.disconnect();
    expect(h.peer.closed).toBe(true);
  });
  test('nested events keep delegation and response identities at the seam without executing tools', async () => {
    const h = harness();
    const values: unknown[] = [];
    h.transport.onServerEvent((event) => values.push(event));
    const pending = h.start();
    await tick();
    h.started();
    await pending;
    const nested = {
      delegation_id: 'item_a',
      event: {
        type: 'response.completed',
        response: { id: 'resp_b', output: [], usage: { total_tokens: 99 } },
      },
    };
    h.peer.channel.event('response.event', nested);
    expect(values).toContainEqual({
      type: 'response.event',
      event_id: 'evt',
      ...nested,
    });
    expect(h.peer.channel.sent).toEqual([]);
  });
  test('malformed finalization and sudden channel loss cannot claim a confirmed bill', async () => {
    const h = harness();
    const pending = h.start();
    await tick();
    h.started();
    await pending;
    h.peer.channel.event('session.closed', {
      usage: { seconds: -1 },
      reason: 'close_requested',
      session: { id: 'live_opaque' },
    });
    expect(h.transport.getSnapshot().finalization).toBe('incomplete');
    expect(h.peer.closed).toBe(true);
  });
  test('autoplay rejection is recoverable and track arrival never guarantees audibility', async () => {
    const previous = globalThis.MediaStream;
    globalThis.MediaStream = Stream as unknown as typeof MediaStream;
    try {
      const h = harness();
      const pending = h.start();
      await tick();
      h.started();
      await pending;
      h.rejectPlayback(true);
      const track = new Track();
      const event = Object.assign(new Event('track'), { track });
      h.peer.dispatchEvent(event);
      await tick();
      expect(h.transport.getSnapshot().playback).toBe('blocked');
      h.rejectPlayback(false);
      await h.transport.activateAudio();
      expect(h.transport.getSnapshot().playback).toBe('accepted');
      expect(h.playbackCalls()).toBe(2);
      await h.transport.disconnect();
      expect(track.readyState).toBe('ended');
    } finally {
      globalThis.MediaStream = previous;
    }
  });
});

test('local Live barge-in gates received audio without sending unsupported cancellation or mutating capture', async () => {
  const originalContext = globalThis.AudioContext;
  const originalStream = globalThis.MediaStream;
  let callbacks!: {
    onSpeechStart(): Promise<void>;
    onSpeechEnd(): Promise<void>;
    onVADMisfire(): Promise<void>;
  };
  let vadStream: MediaStream | undefined;
  let probeStopped = 0;
  mock.module('@ricky0123/vad-web', () => ({
    MicVAD: {
      new: async (
        options: typeof callbacks & { getStream(): Promise<MediaStream> },
      ) => {
        callbacks = options;
        vadStream = await options.getStream();
        return {
          start: async () => {},
          pause: async () => {},
          destroy: async () => {},
        };
      },
    },
  }));
  Object.assign(globalThis, {
    MediaStream: Stream,
    AudioContext: class {
      state = 'running';
      currentTime = 0;
      async resume() {}
      async close() {}
      createMediaStreamSource() {
        return { connect() {}, disconnect() {} };
      }
      createAnalyser() {
        return {
          fftSize: 1024,
          disconnect() {},
          getFloatTimeDomainData(samples: Float32Array) {
            samples.fill(0.2);
          },
        };
      }
    },
  });
  const h = harness({ playbackBargeIn: true });
  try {
    const ready = h.start();
    await tick();
    h.started();
    await ready;
    const output = new Track();
    Object.assign(output, {
      clone: () => ({
        enabled: true,
        stop: () => {
          probeStopped++;
        },
      }),
    });
    h.peer.dispatchEvent(Object.assign(new Event('track'), { track: output }));
    expect(vadStream).toBe(h.transport.getAudioStreams().mic);
    await callbacks.onSpeechStart();
    expect(output.enabled).toBe(false);
    expect(h.mic.enabled).toBe(true);
    expect(h.peer.channel.sent).toEqual([]);
    await callbacks.onVADMisfire();
    expect(output.enabled).toBe(true);
    await callbacks.onSpeechStart();
    h.peer.channel.event('session.output_transcript.delta', {
      delta: 'old tail',
      start_ms: 0,
      end_ms: 100,
    });
    await callbacks.onSpeechEnd();
    expect(output.enabled).toBe(false);
    await h.transport.disconnect();
    expect(probeStopped).toBe(1);
    expect(output.enabled).toBe(true);
    await callbacks.onSpeechStart();
    expect(output.enabled).toBe(true);
  } finally {
    await h.transport.disconnect();
    Object.assign(globalThis, {
      AudioContext: originalContext,
      MediaStream: originalStream,
    });
  }
});
