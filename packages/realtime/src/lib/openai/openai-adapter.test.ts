import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import type {
  CapabilitySnapshot,
  UIStructuralSnapshot,
} from '@maelstrom-co/client';
import { SessionId, ToolCallId } from '@maelstrom-co/protocol';
import FakeTimers from '@sinonjs/fake-timers';
import type {
  AdapterConnectOptions,
  RealtimeProviderAdapter,
} from '../realtime-session/provider-adapter.types.js';
import { RealtimeSession } from '../realtime-session/realtime-session.js';
import type { RealtimeInstance } from '../realtime-session/realtime-session.types.js';
import { RealtimeVoiceError } from '../realtime-voice-error.js';
import type { UnixSeconds } from '../token/unix-seconds.js';
import { OpenAIAdapter } from './openai-adapter.js';
import type { OpenAITokenGrant } from './openai-token.js';

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

// ============================================================================
// Fakes
// ============================================================================

class FakeTrack {
  stopped = false;
  stop(): void {
    this.stopped = true;
  }
}

class FakeMediaStream {
  static instances: FakeMediaStream[] = [];
  readonly tracks: FakeTrack[];

  constructor(trackCount = 1) {
    this.tracks = Array.from({ length: trackCount }, () => new FakeTrack());
    FakeMediaStream.instances.push(this);
  }

  getTracks(): FakeTrack[] {
    return this.tracks;
  }
}

class FakeDataChannel {
  readonly sent: string[] = [];
  closed = false;
  readyState = 'connecting';
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.closed = true;
    this.readyState = 'closed';
  }

  triggerOpen(): void {
    this.readyState = 'open';
    this.onopen?.();
  }

  receive(payload: unknown): void {
    this.onmessage?.({ data: JSON.stringify(payload) });
  }
}

interface FakeSender {
  track: FakeTrack | null;
}

class FakeRTCPeerConnection {
  static instances: FakeRTCPeerConnection[] = [];

  closed = false;
  ontrack: ((event: { streams: readonly unknown[] }) => void) | null = null;
  oniceconnectionstatechange: (() => void) | null = null;
  iceConnectionState = 'new';
  localDescription: { type: string; sdp: string } | undefined;
  dataChannel: FakeDataChannel | undefined;
  private readonly senders: FakeSender[] = [];

  constructor() {
    FakeRTCPeerConnection.instances.push(this);
  }

  createDataChannel(_label: string): FakeDataChannel {
    this.dataChannel = new FakeDataChannel();
    return this.dataChannel;
  }

  addTrack(track: FakeTrack): FakeSender {
    const sender: FakeSender = { track };
    this.senders.push(sender);
    return sender;
  }

  getSenders(): FakeSender[] {
    return this.senders;
  }

  async createOffer(): Promise<{ type: string; sdp: string }> {
    return createOfferImpl();
  }

  async setLocalDescription(desc: {
    type: string;
    sdp: string;
  }): Promise<void> {
    this.localDescription = desc;
  }

  async setRemoteDescription(desc: {
    type: string;
    sdp: string;
  }): Promise<void> {
    return setRemoteDescriptionImpl(desc);
  }

  close(): void {
    this.closed = true;
  }
}

class FakeAudio {
  static instances: FakeAudio[] = [];

  autoplay = false;
  paused = true;
  #srcObject: unknown = null;

  constructor() {
    FakeAudio.instances.push(this);
  }

  get srcObject(): unknown {
    return this.#srcObject;
  }

  set srcObject(value: unknown) {
    this.#srcObject = value;
    if (value && this.autoplay) this.paused = false;
  }

  pause(): void {
    this.paused = true;
  }
}

// ============================================================================
// Harness
// ============================================================================

const fakeToken: OpenAITokenGrant = {
  provider: 'openai',
  value: 'ek-test-secret',
  expiresAt: (Math.floor(Date.now() / 1000) + 60) as UnixSeconds,
  model: 'gpt-realtime',
};

const connectOpts: AdapterConnectOptions = {
  tools: [
    {
      name: 'get_ui_state',
      description: 'reads UI state',
      parametersJsonSchema: {},
    },
  ],
  instructions: 'be helpful',
};

let getUserMediaImpl: () => Promise<FakeMediaStream>;
let fetchImpl: () => Promise<{
  ok: boolean;
  status: number;
  text: () => Promise<string>;
}>;
let createOfferImpl: () => Promise<{ type: string; sdp: string }>;
let setRemoteDescriptionImpl: (desc: {
  type: string;
  sdp: string;
}) => Promise<void>;

let originalRTCPeerConnection: unknown;
let originalAudio: unknown;
let originalFetch: unknown;
let originalNavigator: PropertyDescriptor | undefined;

function restoreGlobal(key: string, original: unknown): void {
  if (original === undefined) {
    Reflect.deleteProperty(globalThis, key);
  } else {
    Object.defineProperty(globalThis, key, {
      value: original,
      configurable: true,
      writable: true,
    });
  }
}

beforeEach(() => {
  FakeRTCPeerConnection.instances = [];
  FakeMediaStream.instances = [];
  FakeAudio.instances = [];
  getUserMediaImpl = async () => new FakeMediaStream(1);
  fetchImpl = async () => ({
    ok: true,
    status: 200,
    text: async () => 'fake-answer-sdp',
  });
  createOfferImpl = async () => ({ type: 'offer', sdp: 'fake-offer-sdp' });
  setRemoteDescriptionImpl = async () => {};

  originalRTCPeerConnection = Reflect.get(globalThis, 'RTCPeerConnection');
  originalAudio = Reflect.get(globalThis, 'Audio');
  originalFetch = Reflect.get(globalThis, 'fetch');
  originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');

  Object.defineProperty(globalThis, 'RTCPeerConnection', {
    value: FakeRTCPeerConnection,
    configurable: true,
    writable: true,
  });
  Object.defineProperty(globalThis, 'Audio', {
    value: FakeAudio,
    configurable: true,
    writable: true,
  });
  Object.defineProperty(globalThis, 'fetch', {
    value: (..._args: unknown[]) => fetchImpl(),
    configurable: true,
    writable: true,
  });
  Object.defineProperty(globalThis, 'navigator', {
    value: { mediaDevices: { getUserMedia: () => getUserMediaImpl() } },
    configurable: true,
    writable: true,
  });
});

async function connectWithChannel(): Promise<{
  adapter: RealtimeProviderAdapter;
  channel: FakeDataChannel;
  connection: FakeRTCPeerConnection;
}> {
  const adapter = new OpenAIAdapter({ mintToken: async () => fakeToken });
  await adapter.connect(connectOpts);
  const pc = FakeRTCPeerConnection.instances[0];
  const channel = pc?.dataChannel;
  if (!channel || !pc)
    throw new Error('connectWithChannel: no data channel created');
  channel.triggerOpen();
  return { adapter, channel, connection: pc };
}

afterEach(() => {
  restoreGlobal('RTCPeerConnection', originalRTCPeerConnection);
  restoreGlobal('Audio', originalAudio);
  restoreGlobal('fetch', originalFetch);
  if (originalNavigator) {
    Object.defineProperty(globalThis, 'navigator', originalNavigator);
  } else {
    Reflect.deleteProperty(globalThis, 'navigator');
  }
});

// ============================================================================
// Mint failure
// ============================================================================

describe('OpenAIAdapter — mintToken failure', () => {
  it('rejects connect without constructing an RTCPeerConnection, and resets the connecting guard for a clean retry', async () => {
    let attempt = 0;
    const adapter = new OpenAIAdapter({
      mintToken: async () => {
        attempt += 1;
        if (attempt === 1) throw new Error('mint failed');
        return fakeToken;
      },
    });

    await expect(adapter.connect(connectOpts)).rejects.toThrow(
      'Failed to mint an ephemeral realtime token',
    );
    expect(FakeRTCPeerConnection.instances).toHaveLength(0);

    // The `connecting` guard must have been reset by teardown() — otherwise
    // this retry would spuriously hit the "already connected" guard.
    await adapter.connect(connectOpts);
    expect(FakeRTCPeerConnection.instances).toHaveLength(1);
  });
});

// ============================================================================
// getUserMedia failure
// ============================================================================

describe('OpenAIAdapter — getUserMedia failure', () => {
  it('rejects connect, closes the peer connection, and resets the connecting guard for a clean retry', async () => {
    const adapter = new OpenAIAdapter({ mintToken: async () => fakeToken });
    getUserMediaImpl = async () => {
      throw new Error('mic denied');
    };

    await expect(adapter.connect(connectOpts)).rejects.toThrow(
      'Failed to acquire the microphone',
    );
    expect(FakeRTCPeerConnection.instances).toHaveLength(1);
    expect(FakeRTCPeerConnection.instances[0]?.closed).toBe(true);

    getUserMediaImpl = async () => new FakeMediaStream(1);
    await adapter.connect(connectOpts);
    expect(FakeRTCPeerConnection.instances).toHaveLength(2);
    expect(FakeRTCPeerConnection.instances[1]?.closed).toBe(false);
  });
});

// ============================================================================
// Failed SDP exchange
// ============================================================================

describe('OpenAIAdapter — failed SDP exchange', () => {
  it('rejects connect and tears down mic tracks, data channel, and peer connection', async () => {
    const adapter = new OpenAIAdapter({ mintToken: async () => fakeToken });
    fetchImpl = async () => ({ ok: false, status: 500, text: async () => '' });

    await expect(adapter.connect(connectOpts)).rejects.toThrow('status 500');

    const pc = FakeRTCPeerConnection.instances[0];
    const stream = FakeMediaStream.instances[0];
    expect(pc?.closed).toBe(true);
    expect(pc?.dataChannel?.closed).toBe(true);
    expect(stream?.tracks.every((track) => track.stopped)).toBe(true);
  });

  it('wraps a createOffer rejection as CONNECTION_FAILED instead of letting the raw error escape', async () => {
    const adapter = new OpenAIAdapter({ mintToken: async () => fakeToken });
    const boom = new Error('createOffer exploded');
    createOfferImpl = () => Promise.reject(boom);

    const err = await adapter.connect(connectOpts).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(RealtimeVoiceError);
    expect((err as RealtimeVoiceError).code).toBe('CONNECTION_FAILED');
    expect((err as RealtimeVoiceError).cause).toBe(boom);
  });

  it('wraps a fetch rejection (network failure) as CONNECTION_FAILED instead of letting the raw error escape', async () => {
    const adapter = new OpenAIAdapter({ mintToken: async () => fakeToken });
    const boom = new Error('network down');
    fetchImpl = () => Promise.reject(boom);

    const err = await adapter.connect(connectOpts).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(RealtimeVoiceError);
    expect((err as RealtimeVoiceError).code).toBe('CONNECTION_FAILED');
    expect((err as RealtimeVoiceError).cause).toBe(boom);
  });

  it('wraps a setRemoteDescription rejection as CONNECTION_FAILED instead of letting the raw error escape', async () => {
    const adapter = new OpenAIAdapter({ mintToken: async () => fakeToken });
    const boom = new Error('bad answer sdp');
    setRemoteDescriptionImpl = () => Promise.reject(boom);

    const err = await adapter.connect(connectOpts).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(RealtimeVoiceError);
    expect((err as RealtimeVoiceError).code).toBe('CONNECTION_FAILED');
    expect((err as RealtimeVoiceError).cause).toBe(boom);
  });

  it('wraps a response.text() rejection (broken/aborted stream) as CONNECTION_FAILED instead of letting the raw error escape', async () => {
    const adapter = new OpenAIAdapter({ mintToken: async () => fakeToken });
    const boom = new Error('body stream broken');
    fetchImpl = async () => ({
      ok: true,
      status: 200,
      text: () => Promise.reject(boom),
    });

    const err = await adapter.connect(connectOpts).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(RealtimeVoiceError);
    expect((err as RealtimeVoiceError).code).toBe('CONNECTION_FAILED');
    expect((err as RealtimeVoiceError).cause).toBe(boom);
  });
});

// ============================================================================
// Double connect during mint
// ============================================================================

describe('OpenAIAdapter — double connect during mint', () => {
  it('rejects a second connect() started while the first is still awaiting mintToken, and only one RTCPeerConnection/mic stream ever exists', async () => {
    let resolveMint!: (token: OpenAITokenGrant) => void;
    const mintPromise = new Promise<OpenAITokenGrant>((resolve) => {
      resolveMint = resolve;
    });
    const adapter = new OpenAIAdapter({ mintToken: () => mintPromise });

    const first = adapter.connect(connectOpts);
    await expect(adapter.connect(connectOpts)).rejects.toThrow(
      'already connected',
    );

    resolveMint(fakeToken);
    await first;

    expect(FakeRTCPeerConnection.instances).toHaveLength(1);
    expect(FakeMediaStream.instances).toHaveLength(1);
  });
});

// ============================================================================
// Droppable grounding vs. error-worthy tool results on a closed channel
// ============================================================================

describe('OpenAIAdapter — closed data channel', () => {
  it('injectGrounding on a non-open channel drops silently, without emitting an error or sending anything', async () => {
    const adapter = new OpenAIAdapter({ mintToken: async () => fakeToken });
    await adapter.connect(connectOpts);
    // Data channel never opened (triggerOpen() not called) — readyState stays 'connecting'.
    const pc = FakeRTCPeerConnection.instances[0];
    const dc = pc?.dataChannel;
    expect(dc?.readyState).toBe('connecting');

    const events: unknown[] = [];
    adapter.on((event) => events.push(event));

    adapter.injectGrounding('4 vessels on screen');

    expect(events).toEqual([]); // no error emitted — grounding is droppable
    expect(dc?.sent).toEqual([]); // nothing sent on the closed channel
  });

  it('sendToolResult on a non-open channel still emits an error', async () => {
    const adapter = new OpenAIAdapter({ mintToken: async () => fakeToken });
    await adapter.connect(connectOpts);
    const pc = FakeRTCPeerConnection.instances[0];
    const dc = pc?.dataChannel;
    expect(dc?.readyState).toBe('connecting');

    const events: Array<{ type: string; error?: unknown }> = [];
    adapter.on((event) =>
      events.push(event as { type: string; error?: unknown }),
    );

    await adapter.sendToolResult(ToolCallId('call-1'), {
      ok: true,
      summary: 'done',
    });

    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe('error');
    expect((events[0]?.error as Error)?.message).toContain(
      'data channel not open',
    );
  });
});

// ============================================================================
// Successful connect then disconnect
// ============================================================================

describe('OpenAIAdapter — successful connect then disconnect', () => {
  it('sends session.update with tools and instructions on channel open, then disconnect tears everything down', async () => {
    const adapter = new OpenAIAdapter({ mintToken: async () => fakeToken });
    await adapter.connect(connectOpts);

    const pc = FakeRTCPeerConnection.instances[0];
    const dc = pc?.dataChannel;
    expect(dc).toBeDefined();
    dc?.triggerOpen();

    expect(dc?.sent).toHaveLength(1);
    const sessionUpdate = JSON.parse(dc?.sent[0] ?? '{}');
    expect(sessionUpdate.type).toBe('session.update');
    expect(sessionUpdate.session.tools).toEqual([
      {
        type: 'function',
        name: 'get_ui_state',
        description: 'reads UI state',
        parameters: {},
      },
    ]);
    expect(sessionUpdate.session.instructions).toBe('be helpful');

    await adapter.disconnect();

    const stream = FakeMediaStream.instances[0];
    expect(stream?.tracks.every((track) => track.stopped)).toBe(true);
    expect(pc?.closed).toBe(true);
    expect(dc?.closed).toBe(true);
  });
});

// ============================================================================
// Typed errors
// ============================================================================

describe('OpenAIAdapter — typed errors', () => {
  it('throws ALREADY_CONNECTED on double connect', async () => {
    const adapter = new OpenAIAdapter({ mintToken: async () => fakeToken });
    await adapter.connect(connectOpts);
    const err = await adapter.connect(connectOpts).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RealtimeVoiceError);
    expect((err as RealtimeVoiceError).code).toBe('ALREADY_CONNECTED');
  });

  it('wraps a mint rejection as TOKEN_MINT_FAILED with cause preserved', async () => {
    const boom = new Error('mint 500');
    const adapter = new OpenAIAdapter({
      mintToken: () => Promise.reject(boom),
    });
    const err = await adapter.connect(connectOpts).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RealtimeVoiceError);
    expect((err as RealtimeVoiceError).code).toBe('TOKEN_MINT_FAILED');
    expect((err as RealtimeVoiceError).cause).toBe(boom);
  });

  it('maps getUserMedia NotAllowedError to MIC_PERMISSION_DENIED', async () => {
    const denied = Object.assign(new Error('denied'), {
      name: 'NotAllowedError',
    });
    getUserMediaImpl = async () => {
      throw denied;
    };
    const adapter = new OpenAIAdapter({ mintToken: async () => fakeToken });
    const err = await adapter.connect(connectOpts).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RealtimeVoiceError);
    expect((err as RealtimeVoiceError).code).toBe('MIC_PERMISSION_DENIED');
  });
});

// ============================================================================
// Voice activity state
// ============================================================================

describe('OpenAIAdapter — voice activity state', () => {
  it('emits listening/thinking/speaking/connected across a full turn', async () => {
    const { adapter, channel } = await connectWithChannel();
    const states: string[] = [];
    adapter.on((e) => {
      if (e.type === 'state') states.push(e.state);
    });

    channel.receive({ type: 'input_audio_buffer.speech_started' });
    channel.receive({ type: 'input_audio_buffer.speech_stopped' });
    channel.receive({ type: 'response.created' });
    channel.receive({ type: 'output_audio_buffer.started' });
    channel.receive({ type: 'response.done' });
    channel.receive({ type: 'output_audio_buffer.stopped' });

    expect(states).toEqual(['listening', 'thinking', 'speaking', 'connected']);
  });

  it('does not re-emit an unchanged state', async () => {
    const { adapter, channel } = await connectWithChannel();
    const states: string[] = [];
    adapter.on((e) => {
      if (e.type === 'state') states.push(e.state);
    });

    channel.receive({ type: 'input_audio_buffer.speech_started' });
    channel.receive({ type: 'input_audio_buffer.speech_started' });
    expect(states).toEqual(['listening']);
  });
});

// ============================================================================
// Audio streams
// ============================================================================

describe('OpenAIAdapter — audio streams', () => {
  it('exposes mic and playback streams while connected and clears them on disconnect', async () => {
    const { adapter, connection } = await connectWithChannel();
    // simulate the remote track arriving:
    const remote = new FakeMediaStream();
    connection.ontrack?.({ streams: [remote] } as unknown as RTCTrackEvent);

    const streams = adapter.getAudioStreams();
    expect(streams.mic).toBeDefined();
    expect(streams.playback).toBe(remote as unknown as MediaStream);

    await adapter.disconnect();
    expect(adapter.getAudioStreams()).toEqual({
      mic: undefined,
      playback: undefined,
    });
  });

  it('pauses and detaches the playback audio element on teardown', async () => {
    const { adapter, connection } = await connectWithChannel();
    connection.ontrack?.({
      streams: [new FakeMediaStream()],
    } as unknown as RTCTrackEvent);
    const audio = FakeAudio.instances.at(-1);
    expect(audio?.paused).toBe(false);
    expect(audio?.srcObject).not.toBeNull();

    await adapter.disconnect();
    expect(audio?.paused).toBe(true);
    expect(audio?.srcObject).toBeNull();
  });
});

// ============================================================================
// Composed: RealtimeSession + real OpenAIAdapter over the WebRTC fakes
// ============================================================================

function makeInertInstance(): RealtimeInstance {
  const snapshot: UIStructuralSnapshot = {
    instances: [],
    layout: null,
    layoutMode: 'grid',
    chartDimensions: { rows: 8, columns: 12 },
  };
  const capabilitySnapshot: CapabilitySnapshot = { vessels: [] };
  return {
    submitIntent: async () => {},
    waitForIdle: async () => {},
    getStructuralSnapshot: () => snapshot,
    getCapabilitySnapshot: () => capabilitySnapshot,
    onSettled: () => () => {},
  };
}

describe('RealtimeSession + OpenAIAdapter — fatal in-session error recovery', () => {
  it('tears down the adapter on a fatal ICE error (mic goes cold) so a retry connect() succeeds instead of throwing ALREADY_CONNECTED', async () => {
    const adapter = new OpenAIAdapter({ mintToken: async () => fakeToken });

    // Tracks live `on()` subscriptions against the real adapter so we can
    // assert the reconnect doesn't stack a second one on top of the dead
    // subscription from the errored session.
    let liveSubscriptions = 0;
    const rawOn = adapter.on.bind(adapter);
    adapter.on = (handler) => {
      liveSubscriptions += 1;
      const unsubscribe = rawOn(handler);
      return () => {
        liveSubscriptions -= 1;
        unsubscribe();
      };
    };

    const session = new RealtimeSession({
      adapter,
      instance: makeInertInstance(),
      sessionId: SessionId('sess-fatal-ice'),
    });

    await session.connect();
    expect(session.state).toBe('connected');

    const pc = FakeRTCPeerConnection.instances[0];
    const micStream = FakeMediaStream.instances[0];
    if (!pc || !micStream)
      throw new Error('expected a peer connection and mic stream');

    // Simulate an ICE failure mid-session — the fatal-error path the real
    // adapter takes for a dropped WebRTC connection.
    pc.iceConnectionState = 'failed';
    pc.oniceconnectionstatechange?.();

    expect(session.state).toBe('error');
    // The mic must go cold immediately — leaving it hot after a fatal error
    // is the bug: the adapter was never torn down, only the session's own
    // subscriptions were.
    expect(micStream.tracks.every((track) => track.stopped)).toBe(true);
    expect(pc.closed).toBe(true);
    expect(liveSubscriptions).toBe(0);

    // Retry: without tearing down the adapter, this would throw
    // ALREADY_CONNECTED (the adapter still thinks it's connected) and
    // clobber lastError instead of establishing a fresh connection.
    await session.connect();

    expect(session.state).toBe('connected');
    expect(session.lastError).toBeUndefined();
    expect(liveSubscriptions).toBe(1);
  });
});

// ============================================================================
// Superseded connect abandonment
// ============================================================================

describe('OpenAIAdapter — superseded connect abandonment', () => {
  it('abandons a superseded in-flight attempt, closing only its own pc + mic, while the winner stays live and owns the shared fields', async () => {
    // Controllable getUserMedia: each connect() parks here (after building its
    // pc) until its resolver is invoked, letting us drive the two attempts out
    // of order.
    const micResolvers: Array<() => void> = [];
    const micStreams: FakeMediaStream[] = [];
    getUserMediaImpl = () =>
      new Promise<FakeMediaStream>((resolve) => {
        micResolvers.push(() => {
          const stream = new FakeMediaStream(1);
          micStreams.push(stream);
          resolve(stream);
        });
      });

    const adapter = new OpenAIAdapter({ mintToken: async () => fakeToken });

    // Attempt 1 parks at getUserMedia after creating pc1.
    const first = adapter.connect(connectOpts);
    await flushMicrotasks();
    expect(FakeRTCPeerConnection.instances).toHaveLength(1);
    const pc1 = FakeRTCPeerConnection.instances[0];

    // Teardown clears the connecting guard and bumps the generation, so a
    // second connect() can start; attempt 1 is now stale.
    await adapter.disconnect();

    // Attempt 2 parks at its own getUserMedia after creating pc2.
    const second = adapter.connect(connectOpts);
    await flushMicrotasks();
    expect(FakeRTCPeerConnection.instances).toHaveLength(2);
    const pc2 = FakeRTCPeerConnection.instances[1];

    // Winner first: attempt 2's mic resolves, so it publishes to the shared
    // fields and finishes its handshake.
    micResolvers[1]?.();
    await second;
    const winnerMic = micStreams[0];

    // Loser last: attempt 1's mic resolves, it discovers it is stale and
    // abandons its own pc1 + mic without touching the shared fields.
    micResolvers[0]?.();
    const firstResult = await first.catch((e: unknown) => e);
    const loserMic = micStreams[1];

    expect(firstResult).toBeInstanceOf(RealtimeVoiceError);
    expect((firstResult as RealtimeVoiceError).code).toBe('CONNECT_SUPERSEDED');

    // Stale attempt's pc + mic are closed/stopped...
    expect(pc1?.closed).toBe(true);
    expect(loserMic?.tracks.every((track) => track.stopped)).toBe(true);

    // ...while the winner stays live and owns the shared fields.
    expect(pc2?.closed).toBe(false);
    expect(winnerMic?.tracks.some((track) => track.stopped)).toBe(false);
    expect(adapter.getAudioStreams().mic).toBe(
      winnerMic as unknown as MediaStream,
    );
  });
});

// ============================================================================
// ICE disconnected grace window
// ============================================================================

describe('OpenAIAdapter — ICE disconnected grace window', () => {
  it('does not fail immediately on ICE disconnected, fails only after the grace window elapses, and a recovery cancels it', async () => {
    const clock = FakeTimers.install();
    try {
      const { adapter, connection } = await connectWithChannel();
      const errors: unknown[] = [];
      adapter.on((e) => {
        if (e.type === 'error') errors.push(e.error);
      });

      // disconnected → grace timer starts, no error yet.
      connection.iceConnectionState = 'disconnected';
      connection.oniceconnectionstatechange?.();
      expect(errors).toEqual([]);

      // Recovery before the window elapses cancels the pending failure.
      connection.iceConnectionState = 'connected';
      connection.oniceconnectionstatechange?.();
      await clock.tickAsync(10000);
      expect(errors).toEqual([]);

      // A fresh disconnected with no recovery fails once the window elapses.
      connection.iceConnectionState = 'disconnected';
      connection.oniceconnectionstatechange?.();
      await clock.tickAsync(10000);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toBeInstanceOf(RealtimeVoiceError);
      expect((errors[0] as RealtimeVoiceError).code).toBe('CONNECTION_FAILED');
    } finally {
      clock.uninstall();
    }
  });

  it('fails immediately with no grace window on ICE failed', async () => {
    const { adapter, connection } = await connectWithChannel();
    const errors: unknown[] = [];
    adapter.on((e) => {
      if (e.type === 'error') errors.push(e.error);
    });

    connection.iceConnectionState = 'failed';
    connection.oniceconnectionstatechange?.();

    expect(errors).toHaveLength(1);
    expect(errors[0]).toBeInstanceOf(RealtimeVoiceError);
    expect((errors[0] as RealtimeVoiceError).code).toBe('CONNECTION_FAILED');
  });

  it('a grace timer left pending by a disconnect never fires after teardown', async () => {
    const clock = FakeTimers.install();
    try {
      const { adapter, connection } = await connectWithChannel();
      const errors: unknown[] = [];
      adapter.on((e) => {
        if (e.type === 'error') errors.push(e.error);
      });

      connection.iceConnectionState = 'disconnected';
      connection.oniceconnectionstatechange?.();

      await adapter.disconnect();
      await clock.tickAsync(10000);

      expect(errors).toEqual([]); // teardown cleared the grace timer
    } finally {
      clock.uninstall();
    }
  });
});

// ============================================================================
// Transcription config
// ============================================================================

describe('OpenAIAdapter — transcription config', () => {
  async function connectAndReadSessionUpdate(adapter: OpenAIAdapter) {
    await adapter.connect(connectOpts);
    const dc = FakeRTCPeerConnection.instances[0]?.dataChannel;
    dc?.triggerOpen();
    return JSON.parse(dc?.sent[0] ?? '{}');
  }

  it('enables input-audio transcription with the default model by default', async () => {
    const update = await connectAndReadSessionUpdate(
      new OpenAIAdapter({ mintToken: async () => fakeToken }),
    );
    expect(update.session.audio.input.transcription).toEqual({
      model: 'gpt-4o-mini-transcribe',
    });
  });

  it('uses a caller-supplied transcription model', async () => {
    const update = await connectAndReadSessionUpdate(
      new OpenAIAdapter({
        mintToken: async () => fakeToken,
        transcription: { model: 'whisper-1' },
      }),
    );
    expect(update.session.audio.input.transcription).toEqual({
      model: 'whisper-1',
    });
  });

  it('falls back to the default model when the transcription object omits model', async () => {
    const update = await connectAndReadSessionUpdate(
      new OpenAIAdapter({
        mintToken: async () => fakeToken,
        transcription: {},
      }),
    );
    expect(update.session.audio.input.transcription).toEqual({
      model: 'gpt-4o-mini-transcribe',
    });
  });

  it('omits input-audio transcription entirely when disabled', async () => {
    const update = await connectAndReadSessionUpdate(
      new OpenAIAdapter({
        mintToken: async () => fakeToken,
        transcription: false,
      }),
    );
    expect(update.session.audio).toBeUndefined();
  });
});
