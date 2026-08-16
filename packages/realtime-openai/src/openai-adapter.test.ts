import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import type {
  CapabilitySnapshot,
  UIStructuralSnapshot,
} from '@maelstrom-co/client';
import { MessageId, SessionId, ToolCallId } from '@maelstrom-co/protocol';
import type {
  AdapterConnectOptions,
  RealtimeInstance,
  RealtimeProviderAdapter,
} from '@maelstrom-co/realtime';
import {
  GreetingCoordinator,
  RealtimeSession,
  RealtimeVoiceError,
} from '@maelstrom-co/realtime';
import type { UnixSeconds } from '@maelstrom-co/realtime-protocol';
import type { OpenAITokenGrant } from '@maelstrom-co/realtime-protocol/openai';
import FakeTimers from '@sinonjs/fake-timers';
import { OpenAIAdapter } from './openai-adapter.js';

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

// ============================================================================
// Fakes
// ============================================================================

class FakeTrack {
  stopped = false;
  getSettingsCalls = 0;
  getSettingsImpl: (() => MediaTrackSettings) | undefined;

  getSettings(): MediaTrackSettings {
    this.getSettingsCalls += 1;
    return this.getSettingsImpl?.() ?? {};
  }

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

  getAudioTracks(): FakeTrack[] {
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
  onclose: (() => void) | null = null;

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.closed = true;
    this.readyState = 'closed';
    this.onclose?.();
  }

  triggerOpen(): void {
    this.readyState = 'open';
    this.onopen?.();
  }

  triggerError(): void {
    this.onerror?.();
  }

  receive(payload: unknown): void {
    this.onmessage?.({ data: JSON.stringify(payload) });
  }

  receiveRaw(payload: unknown): void {
    this.onmessage?.({ data: payload });
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

let getUserMediaImpl: (
  constraints?: MediaStreamConstraints,
) => Promise<FakeMediaStream>;
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
    value: {
      mediaDevices: {
        getUserMedia: (constraints?: MediaStreamConstraints) =>
          getUserMediaImpl(constraints),
      },
    },
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
  const channel = await connectAndOpen(adapter);
  const pc = FakeRTCPeerConnection.instances[0];
  if (!channel || !pc)
    throw new Error('connectWithChannel: no data channel created');
  return { adapter, channel, connection: pc };
}

async function latestDataChannel(
  exclude?: FakeDataChannel,
): Promise<FakeDataChannel> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const channel = FakeRTCPeerConnection.instances.at(-1)?.dataChannel;
    if (channel && channel !== exclude) return channel;
    await Promise.resolve();
  }
  throw new Error('no data channel');
}

async function connectAndOpen(
  adapter: OpenAIAdapter,
): Promise<FakeDataChannel> {
  const previousChannel = FakeRTCPeerConnection.instances.at(-1)?.dataChannel;
  const connecting = adapter.connect(connectOpts);
  const channel = await latestDataChannel(previousChannel);
  channel.triggerOpen();
  await connecting;
  return channel;
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
    await connectAndOpen(adapter);
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
    await connectAndOpen(adapter);
    expect(FakeRTCPeerConnection.instances).toHaveLength(2);
    expect(FakeRTCPeerConnection.instances[1]?.closed).toBe(false);
  });
});

// ============================================================================
// Microphone audio processing
// ============================================================================

describe('OpenAIAdapter — microphone audio processing', () => {
  it('requests non-mandatory AEC, noise suppression, and automatic gain control preferences', async () => {
    let requested: MediaStreamConstraints | undefined;
    getUserMediaImpl = async (constraints) => {
      requested = constraints;
      return new FakeMediaStream(1);
    };

    const adapter = new OpenAIAdapter({ mintToken: async () => fakeToken });
    await connectAndOpen(adapter);

    expect(requested).toEqual({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    expect(JSON.stringify(requested)).not.toContain('exact');
  });

  it('logs only requested values and boolean applied settings for the accepted original track', async () => {
    const stream = new FakeMediaStream(1);
    stream.tracks[0]!.getSettingsImpl = () => ({
      echoCancellation: false,
      noiseSuppression: true,
      autoGainControl: false,
      deviceId: 'sensitive-device-id',
      groupId: 'sensitive-group-id',
      sampleRate: 48_000,
    });
    getUserMediaImpl = async () => stream;
    const debugCalls: unknown[][] = [];
    const originalDebug = console.debug;
    console.debug = (...args: unknown[]) => debugCalls.push(args);
    try {
      const adapter = new OpenAIAdapter({
        mintToken: async () => fakeToken,
        debug: true,
      });
      await connectAndOpen(adapter);
    } finally {
      console.debug = originalDebug;
    }

    const audioProcessingCall = debugCalls.find(
      (call) => call[1] === 'microphone audio processing',
    );
    expect(audioProcessingCall?.[2]).toEqual({
      audioProcessing: {
        requested: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        applied: {
          echoCancellation: false,
          noiseSuppression: true,
          autoGainControl: false,
        },
      },
    });
    expect(JSON.stringify(audioProcessingCall)).not.toContain('sensitive');
    expect(JSON.stringify(audioProcessingCall)).not.toContain('sampleRate');
  });

  it('projects missing and non-boolean applied settings as unavailable', async () => {
    const stream = new FakeMediaStream(1);
    stream.tracks[0]!.getSettingsImpl = () =>
      ({
        echoCancellation: true,
        noiseSuppression: 'enabled',
      }) as unknown as MediaTrackSettings;
    getUserMediaImpl = async () => stream;
    const debugCalls: unknown[][] = [];
    const originalDebug = console.debug;
    console.debug = (...args: unknown[]) => debugCalls.push(args);
    try {
      const adapter = new OpenAIAdapter({
        mintToken: async () => fakeToken,
        debug: true,
      });
      await connectAndOpen(adapter);
    } finally {
      console.debug = originalDebug;
    }

    expect(
      debugCalls.find((call) => call[1] === 'microphone audio processing')?.[2],
    ).toEqual({
      audioProcessing: {
        requested: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        applied: {
          echoCancellation: true,
          noiseSuppression: 'unavailable',
          autoGainControl: 'unavailable',
        },
      },
    });
  });

  it('keeps connecting and projects unavailable settings when getSettings throws', async () => {
    const stream = new FakeMediaStream(1);
    stream.tracks[0]!.getSettingsImpl = () => {
      throw new Error('settings unavailable');
    };
    getUserMediaImpl = async () => stream;
    const debugCalls: unknown[][] = [];
    const originalDebug = console.debug;
    console.debug = (...args: unknown[]) => debugCalls.push(args);
    try {
      const adapter = new OpenAIAdapter({
        mintToken: async () => fakeToken,
        debug: true,
      });
      await connectAndOpen(adapter);
    } finally {
      console.debug = originalDebug;
    }

    expect(
      debugCalls.find((call) => call[1] === 'microphone audio processing')?.[2],
    ).toEqual({
      audioProcessing: {
        requested: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        applied: {
          echoCancellation: 'unavailable',
          noiseSuppression: 'unavailable',
          autoGainControl: 'unavailable',
        },
      },
    });
  });

  it('keeps connecting and projects unavailable settings when getSettings is absent', async () => {
    const stream = new FakeMediaStream(1);
    Object.defineProperty(stream.tracks[0], 'getSettings', {
      value: undefined,
      configurable: true,
    });
    getUserMediaImpl = async () => stream;
    const debugCalls: unknown[][] = [];
    const originalDebug = console.debug;
    console.debug = (...args: unknown[]) => debugCalls.push(args);
    try {
      const adapter = new OpenAIAdapter({
        mintToken: async () => fakeToken,
        debug: true,
      });
      await connectAndOpen(adapter);
    } finally {
      console.debug = originalDebug;
    }

    expect(
      debugCalls.find((call) => call[1] === 'microphone audio processing')?.[2],
    ).toEqual({
      audioProcessing: {
        requested: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        applied: {
          echoCancellation: 'unavailable',
          noiseSuppression: 'unavailable',
          autoGainControl: 'unavailable',
        },
      },
    });
  });

  it('contains throwing getSettings lookup and applied-setting access without failing connect', async () => {
    const unavailable = {
      echoCancellation: 'unavailable',
      noiseSuppression: 'unavailable',
      autoGainControl: 'unavailable',
    };
    const cases: Array<{
      configure: (track: FakeTrack) => void;
      expected:
        | typeof unavailable
        | {
            echoCancellation: true;
            noiseSuppression: 'unavailable';
            autoGainControl: false;
          };
    }> = [
      {
        configure: (track) => {
          Object.defineProperty(track, 'getSettings', {
            configurable: true,
            get: () => {
              throw new Error('getSettings lookup failed');
            },
          });
        },
        expected: unavailable,
      },
      {
        configure: (track) => {
          track.getSettingsImpl = () =>
            ({
              echoCancellation: true,
              get noiseSuppression(): boolean {
                throw new Error('noise suppression access failed');
              },
              autoGainControl: false,
            }) as MediaTrackSettings;
        },
        expected: {
          echoCancellation: true,
          noiseSuppression: 'unavailable',
          autoGainControl: false,
        },
      },
    ];
    const originalDebug = console.debug;

    try {
      for (const testCase of cases) {
        const stream = new FakeMediaStream(1);
        testCase.configure(stream.tracks[0]!);
        getUserMediaImpl = async () => stream;
        const debugCalls: unknown[][] = [];
        console.debug = (...args: unknown[]) => debugCalls.push(args);
        const adapter = new OpenAIAdapter({
          mintToken: async () => fakeToken,
          debug: true,
        });

        await connectAndOpen(adapter);

        expect(
          (
            debugCalls.find(
              (call) => call[1] === 'microphone audio processing',
            )?.[2] as {
              audioProcessing?: { applied?: unknown };
            }
          )?.audioProcessing?.applied,
        ).toEqual(testCase.expected);
        await adapter.disconnect();
      }
    } finally {
      console.debug = originalDebug;
    }
  });

  it('snapshots each applied setting exactly once before boolean validation', async () => {
    const stream = new FakeMediaStream(1);
    const reads = {
      echoCancellation: 0,
      noiseSuppression: 0,
      autoGainControl: 0,
    };
    stream.tracks[0]!.getSettingsImpl = () =>
      ({
        get echoCancellation(): boolean | string {
          reads.echoCancellation += 1;
          return reads.echoCancellation === 1 ? true : 'sensitive-device-id';
        },
        get noiseSuppression(): boolean | string {
          reads.noiseSuppression += 1;
          return reads.noiseSuppression === 1 ? false : 'sensitive-device-id';
        },
        get autoGainControl(): boolean | string {
          reads.autoGainControl += 1;
          return reads.autoGainControl === 1 ? true : 'sensitive-device-id';
        },
      }) as unknown as MediaTrackSettings;
    getUserMediaImpl = async () => stream;
    const debugCalls: unknown[][] = [];
    const originalDebug = console.debug;
    console.debug = (...args: unknown[]) => debugCalls.push(args);
    try {
      const adapter = new OpenAIAdapter({
        mintToken: async () => fakeToken,
        debug: true,
      });
      await connectAndOpen(adapter);

      const audioProcessingCall = debugCalls.find(
        (call) => call[1] === 'microphone audio processing',
      );
      expect(audioProcessingCall?.[2]).toEqual({
        audioProcessing: {
          requested: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
          applied: {
            echoCancellation: true,
            noiseSuppression: false,
            autoGainControl: true,
          },
        },
      });
      expect(reads).toEqual({
        echoCancellation: 1,
        noiseSuppression: 1,
        autoGainControl: 1,
      });
      expect(JSON.stringify(audioProcessingCall)).not.toContain('sensitive');
    } finally {
      console.debug = originalDebug;
    }
  });

  it('does not evaluate settings or log audio processing when debug logging is disabled', async () => {
    const stream = new FakeMediaStream(1);
    getUserMediaImpl = async () => stream;
    const debugCalls: unknown[][] = [];
    const originalDebug = console.debug;
    console.debug = (...args: unknown[]) => debugCalls.push(args);
    try {
      const adapter = new OpenAIAdapter({ mintToken: async () => fakeToken });
      await connectAndOpen(adapter);
    } finally {
      console.debug = originalDebug;
    }

    expect(debugCalls).toEqual([]);
    expect(stream.tracks[0]?.getSettingsCalls).toBe(0);
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
    const channel = await latestDataChannel();
    channel.triggerOpen();
    await first;

    expect(FakeRTCPeerConnection.instances).toHaveLength(1);
    expect(FakeMediaStream.instances).toHaveLength(1);
  });
});

// ============================================================================
// Droppable grounding vs. error-worthy tool results on a closed channel
// ============================================================================

describe('OpenAIAdapter — data-channel readiness', () => {
  it('keeps connect pending after SDP exchange until the data channel opens', async () => {
    const adapter = new OpenAIAdapter({ mintToken: async () => fakeToken });
    let connected = false;

    const connecting = adapter.connect(connectOpts).then(() => {
      connected = true;
    });
    await flushMicrotasks();

    const channel = FakeRTCPeerConnection.instances[0]?.dataChannel;
    if (!channel) throw new Error('no channel');
    expect(channel.readyState).toBe('connecting');
    expect(connected).toBe(false);

    channel.triggerOpen();
    await connecting;
    expect(connected).toBe(true);
  });

  it('rejects as superseded when disconnect closes a channel that is still opening', async () => {
    const adapter = new OpenAIAdapter({ mintToken: async () => fakeToken });
    const connecting = adapter
      .connect(connectOpts)
      .catch((error: unknown) => error);
    const channel = await latestDataChannel();
    expect(channel.readyState).toBe('connecting');

    await adapter.disconnect();
    const error = await connecting;

    expect(error).toBeInstanceOf(RealtimeVoiceError);
    expect((error as RealtimeVoiceError).code).toBe('CONNECT_SUPERSEDED');
    expect(channel.closed).toBe(true);
  });

  it('rejects and cleans up when the data channel errors before opening', async () => {
    const adapter = new OpenAIAdapter({ mintToken: async () => fakeToken });
    const connecting = adapter
      .connect(connectOpts)
      .catch((error: unknown) => error);
    const channel = await latestDataChannel();

    channel.triggerError();
    const error = await connecting;

    expect(error).toBeInstanceOf(RealtimeVoiceError);
    expect((error as RealtimeVoiceError).code).toBe('DATA_CHANNEL_ERROR');
    expect(channel.closed).toBe(true);
    expect(FakeRTCPeerConnection.instances[0]?.closed).toBe(true);
  });

  it('preserves DATA_CHANNEL_ERROR through a RealtimeSession pre-open failure', async () => {
    const adapter = new OpenAIAdapter({ mintToken: async () => fakeToken });
    const session = new RealtimeSession({
      adapter,
      instance: makeInertInstance(),
      sessionId: SessionId('sess-channel-error'),
    });
    const connecting = session.connect().catch((error: unknown) => error);
    const channel = await latestDataChannel();

    channel.triggerError();
    const error = await connecting;

    expect(error).toBeInstanceOf(RealtimeVoiceError);
    expect((error as RealtimeVoiceError).code).toBe('DATA_CHANNEL_ERROR');
    expect(session.state).toBe('error');
    expect(session.lastError).toBe(error);
  });

  it('ignores open and error callbacks from an abandoned data channel', async () => {
    const adapter = new OpenAIAdapter({ mintToken: async () => fakeToken });
    const events: unknown[] = [];
    adapter.on((event) => events.push(event));

    const first = adapter.connect(connectOpts).catch((error: unknown) => error);
    const abandoned = await latestDataChannel();
    await adapter.disconnect();
    await first;

    const second = adapter.connect(connectOpts);
    const winner = await latestDataChannel(abandoned);
    abandoned.triggerOpen();
    abandoned.triggerError();

    expect(abandoned.sent).toEqual([]);
    expect(events).toEqual([]);
    expect(winner.closed).toBe(false);

    winner.triggerOpen();
    await second;
  });

  it('does not send or emit after the first pre-open channel error', async () => {
    const adapter = new OpenAIAdapter({ mintToken: async () => fakeToken });
    const events: unknown[] = [];
    adapter.on((event) => events.push(event));
    const connecting = adapter
      .connect(connectOpts)
      .catch((error: unknown) => error);
    const channel = await latestDataChannel();

    channel.triggerError();
    channel.triggerError();
    channel.triggerOpen();
    const error = await connecting;

    expect(error).toBeInstanceOf(RealtimeVoiceError);
    expect((error as RealtimeVoiceError).code).toBe('DATA_CHANNEL_ERROR');
    expect(channel.sent).toEqual([]);
    expect(events).toEqual([]);
  });

  it('rejects when the channel closes after opening but before SDP completes', async () => {
    let resolveFetch!: (response: {
      ok: boolean;
      status: number;
      text: () => Promise<string>;
    }) => void;
    fetchImpl = () =>
      new Promise((resolve) => {
        resolveFetch = resolve;
      });
    const adapter = new OpenAIAdapter({ mintToken: async () => fakeToken });
    const connecting = adapter
      .connect(connectOpts)
      .catch((error: unknown) => error);
    const channel = await latestDataChannel();
    await flushMicrotasks();

    channel.triggerOpen();
    channel.close();
    resolveFetch({
      ok: true,
      status: 200,
      text: async () => 'fake-answer-sdp',
    });
    const error = await connecting;

    expect(error).toBeInstanceOf(RealtimeVoiceError);
    expect((error as RealtimeVoiceError).code).toBe('DATA_CHANNEL_ERROR');
    expect(FakeRTCPeerConnection.instances[0]?.closed).toBe(true);
    expect(FakeMediaStream.instances[0]?.tracks[0]?.stopped).toBe(true);
  });
});

describe('OpenAIAdapter — closed data channel', () => {
  it('injectGrounding on a non-open channel drops silently, without emitting an error or sending anything', async () => {
    const adapter = new OpenAIAdapter({ mintToken: async () => fakeToken });
    const connecting = adapter.connect(connectOpts);
    void connecting.catch(() => {});
    const dc = await latestDataChannel();
    // Data channel never opened (triggerOpen() not called) — readyState stays 'connecting'.
    expect(dc?.readyState).toBe('connecting');

    const events: unknown[] = [];
    adapter.on((event) => events.push(event));

    adapter.injectGrounding('4 vessels on screen');

    expect(events).toEqual([]); // no error emitted — grounding is droppable
    expect(dc?.sent).toEqual([]); // nothing sent on the closed channel
    await adapter.disconnect();
  });

  it('sendToolResult on a non-open channel still emits an error', async () => {
    const adapter = new OpenAIAdapter({ mintToken: async () => fakeToken });
    const connecting = adapter.connect(connectOpts);
    void connecting.catch(() => {});
    const dc = await latestDataChannel();
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
    await adapter.disconnect();
  });
});

// ============================================================================
// Successful connect then disconnect
// ============================================================================

describe('OpenAIAdapter — successful connect then disconnect', () => {
  it('sends session.update with tools and instructions on channel open, then disconnect tears everything down', async () => {
    const adapter = new OpenAIAdapter({ mintToken: async () => fakeToken });
    const dc = await connectAndOpen(adapter);

    const pc = FakeRTCPeerConnection.instances[0];
    expect(dc).toBeDefined();

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
    await connectAndOpen(adapter);
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
// Privacy-safe lifecycle diagnostics
// ============================================================================

describe('OpenAIAdapter — lifecycle diagnostics', () => {
  const sensitiveFields = {
    transcript: 'TRANSCRIPT_SENTINEL',
    audio: 'AUDIO_SENTINEL',
    event_id: 'EVENT_ID_SENTINEL',
    item_id: 'ITEM_ID_SENTINEL',
    created_at: 'TIMESTAMP_SENTINEL',
    session_id: 'SESSION_ID_SENTINEL',
    request_id: 'REQUEST_ID_SENTINEL',
    token: 'TOKEN_SENTINEL',
    unknown_raw_field: 'UNKNOWN_FIELD_SENTINEL',
  } as const;

  async function connectDebugAdapter(): Promise<{
    adapter: OpenAIAdapter;
    channel: FakeDataChannel;
  }> {
    const adapter = new OpenAIAdapter({
      mintToken: async () => fakeToken,
      debug: true,
    });
    const channel = await connectAndOpen(adapter);
    return { adapter, channel };
  }

  function expectOnlySanitizedDebugArguments(
    debugCalls: readonly (readonly unknown[])[],
    rawEvent: object,
  ): void {
    const serializedArguments = debugCalls.flatMap((call) =>
      call.map((argument) => JSON.stringify(argument)),
    );
    for (const sentinel of Object.values(sensitiveFields)) {
      expect(serializedArguments).not.toContainEqual(
        expect.stringContaining(sentinel),
      );
    }
    expect(debugCalls.flat()).not.toContain(rawEvent);
  }

  it('distinguishes lifecycle categories with fixed sanitized projections', async () => {
    const cases: Array<{
      name: string;
      event: Record<string, unknown>;
      prepare?: (channel: FakeDataChannel) => void;
      expected: unknown[][];
    }> = [
      {
        name: 'speech started',
        event: {
          type: 'input_audio_buffer.speech_started',
          ...sensitiveFields,
        },
        expected: [
          [
            '[OpenAIAdapter]',
            'input lifecycle',
            { category: 'speech_started' },
          ],
        ],
      },
      {
        name: 'speech stopped',
        event: {
          type: 'input_audio_buffer.speech_stopped',
          ...sensitiveFields,
        },
        expected: [
          [
            '[OpenAIAdapter]',
            'input lifecycle',
            { category: 'speech_stopped' },
          ],
        ],
      },
      {
        name: 'input committed',
        event: {
          type: 'input_audio_buffer.committed',
          ...sensitiveFields,
        },
        expected: [
          ['[OpenAIAdapter]', 'input lifecycle', { category: 'committed' }],
        ],
      },
      {
        name: 'useful completed user transcript',
        event: {
          type: 'conversation.item.input_audio_transcription.completed',
          ...sensitiveFields,
          transcript: `  ${sensitiveFields.transcript}  `,
        },
        expected: [
          [
            '[OpenAIAdapter]',
            'input lifecycle',
            {
              category: 'transcript_completed',
              role: 'user',
              final: true,
              useful: true,
            },
          ],
        ],
      },
      {
        name: 'non-useful completed user transcript',
        event: {
          type: 'conversation.item.input_audio_transcription.completed',
          ...sensitiveFields,
          transcript: ' \n\t ',
        },
        expected: [
          [
            '[OpenAIAdapter]',
            'input lifecycle',
            {
              category: 'transcript_completed',
              role: 'user',
              final: true,
              useful: false,
            },
          ],
        ],
      },
      {
        name: 'assistant interruption',
        prepare: (channel) => {
          channel.receive({ type: 'output_audio_buffer.started' });
        },
        event: {
          type: 'input_audio_buffer.speech_started',
          ...sensitiveFields,
        },
        expected: [
          [
            '[OpenAIAdapter]',
            'input lifecycle',
            { category: 'speech_started' },
          ],
          [
            '[OpenAIAdapter]',
            'input lifecycle',
            { category: 'assistant_interruption' },
          ],
        ],
      },
    ];
    const debugCalls: unknown[][] = [];
    const originalDebug = console.debug;
    console.debug = (...args: unknown[]) => debugCalls.push(args);
    try {
      for (const testCase of cases) {
        const { adapter, channel } = await connectDebugAdapter();
        testCase.prepare?.(channel);
        debugCalls.length = 0;

        channel.receiveRaw(testCase.event);

        expect(debugCalls, testCase.name).toEqual(testCase.expected);
        expectOnlySanitizedDebugArguments(debugCalls, testCase.event);
        await adapter.disconnect();
      }
    } finally {
      console.debug = originalDebug;
    }
  });

  it('treats missing and non-string completed transcripts as non-useful', async () => {
    const debugCalls: unknown[][] = [];
    const originalDebug = console.debug;
    console.debug = (...args: unknown[]) => debugCalls.push(args);
    try {
      for (const transcript of [undefined, 42]) {
        const { adapter, channel } = await connectDebugAdapter();
        debugCalls.length = 0;
        const rawEvent = {
          type: 'conversation.item.input_audio_transcription.completed',
          ...sensitiveFields,
          transcript,
        };
        channel.receiveRaw(rawEvent);

        expect(debugCalls).toEqual([
          [
            '[OpenAIAdapter]',
            'input lifecycle',
            {
              category: 'transcript_completed',
              role: 'user',
              final: true,
              useful: false,
            },
          ],
        ]);
        expectOnlySanitizedDebugArguments(debugCalls, rawEvent);
        await adapter.disconnect();
      }
    } finally {
      console.debug = originalDebug;
    }
  });

  it('keeps completed transcript delivery unchanged without logging its text', async () => {
    const debugCalls: unknown[][] = [];
    const originalDebug = console.debug;
    console.debug = (...args: unknown[]) => debugCalls.push(args);
    try {
      const { adapter, channel } = await connectDebugAdapter();
      const transcripts: string[] = [];
      adapter.on((event) => {
        if (event.type === 'transcript') transcripts.push(event.text);
      });
      debugCalls.length = 0;

      const rawEvent = {
        type: 'conversation.item.input_audio_transcription.completed',
        ...sensitiveFields,
      };
      channel.receiveRaw(rawEvent);

      expect(transcripts).toEqual([sensitiveFields.transcript]);
      expectOnlySanitizedDebugArguments(debugCalls, rawEvent);
    } finally {
      console.debug = originalDebug;
    }
  });

  it('emits no lifecycle diagnostics when debug logging is disabled', async () => {
    const { channel } = await connectWithChannel();
    const debugCalls: unknown[][] = [];
    const originalDebug = console.debug;
    console.debug = (...args: unknown[]) => debugCalls.push(args);
    try {
      channel.receive({
        type: 'input_audio_buffer.speech_started',
        ...sensitiveFields,
      });
      channel.receive({
        type: 'conversation.item.input_audio_transcription.completed',
        ...sensitiveFields,
      });

      expect(debugCalls).toEqual([]);
    } finally {
      console.debug = originalDebug;
    }
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
    submitIntent: async () => ({}),
    waitForIdle: async () => {},
    getStructuralSnapshot: () => snapshot,
    getCapabilitySnapshot: () => capabilitySnapshot,
    onSettled: () => () => {},
    addAssistantMessageAcknowledged: async () => 'inserted' as const,
    observeEngineConnection: () => () => {},
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

    const firstConnect = session.connect();
    (await latestDataChannel()).triggerOpen();
    await firstConnect;
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
    const retryConnect = session.connect();
    (await latestDataChannel(pc.dataChannel)).triggerOpen();
    await retryConnect;

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

    const debugCalls: unknown[][] = [];
    const originalDebug = console.debug;
    console.debug = (...args: unknown[]) => debugCalls.push(args);
    try {
      const adapter = new OpenAIAdapter({
        mintToken: async () => fakeToken,
        debug: true,
      });

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
      (await latestDataChannel()).triggerOpen();
      await second;
      const winnerMic = micStreams[0];

      // Loser last: attempt 1's mic resolves, it discovers it is stale and
      // abandons its own pc1 + mic without touching the shared fields.
      micResolvers[0]?.();
      const firstResult = await first.catch((e: unknown) => e);
      const loserMic = micStreams[1];

      expect(firstResult).toBeInstanceOf(RealtimeVoiceError);
      expect((firstResult as RealtimeVoiceError).code).toBe(
        'CONNECT_SUPERSEDED',
      );

      // Stale attempt's pc + mic are closed/stopped...
      expect(pc1?.closed).toBe(true);
      expect(pc1?.getSenders()).toHaveLength(0);
      expect(loserMic?.tracks.every((track) => track.stopped)).toBe(true);
      expect(
        debugCalls.filter((call) => call[1] === 'microphone audio processing'),
      ).toHaveLength(1);

      // ...while the winner stays live and owns the shared fields.
      expect(pc2?.closed).toBe(false);
      expect(winnerMic?.tracks.some((track) => track.stopped)).toBe(false);
      expect(adapter.getAudioStreams().mic).toBe(
        winnerMic as unknown as MediaStream,
      );
    } finally {
      console.debug = originalDebug;
    }
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
  const expectedInputControls = {
    noise_reduction: { type: 'near_field' },
    turn_detection: {
      type: 'server_vad',
      threshold: 0.5,
      prefix_padding_ms: 300,
      silence_duration_ms: 500,
      create_response: true,
      interrupt_response: true,
    },
  };

  interface SessionUpdate {
    input_audio_noise_reduction?: unknown;
    input_audio_turn_detection?: unknown;
    noise_reduction?: unknown;
    turn_detection?: unknown;
    session: {
      input_audio_noise_reduction?: unknown;
      input_audio_turn_detection?: unknown;
      noise_reduction?: unknown;
      turn_detection?: unknown;
      audio: { input: unknown; output: { voice: string } };
    };
  }

  async function connectAndReadSessionUpdate(
    adapter: OpenAIAdapter,
  ): Promise<SessionUpdate> {
    const dc = await connectAndOpen(adapter);
    return JSON.parse(dc?.sent[0] ?? '{}') as SessionUpdate;
  }

  function expectNoLegacyInputAudioFields(update: SessionUpdate): void {
    expect(update.input_audio_noise_reduction).toBeUndefined();
    expect(update.input_audio_turn_detection).toBeUndefined();
    expect(update.noise_reduction).toBeUndefined();
    expect(update.turn_detection).toBeUndefined();
    expect(update.session.input_audio_noise_reduction).toBeUndefined();
    expect(update.session.input_audio_turn_detection).toBeUndefined();
    expect(update.session.noise_reduction).toBeUndefined();
    expect(update.session.turn_detection).toBeUndefined();
  }

  it('enables input-audio transcription with the default model and marin output voice by default', async () => {
    const update = await connectAndReadSessionUpdate(
      new OpenAIAdapter({ mintToken: async () => fakeToken }),
    );
    expect(update.session.audio.input).toEqual({
      ...expectedInputControls,
      transcription: { model: 'gpt-4o-mini-transcribe' },
    });
    expect(update.session.audio.output.voice).toBe('marin');
    expectNoLegacyInputAudioFields(update);
  });

  it('uses a caller-supplied transcription model alongside output voice', async () => {
    const update = await connectAndReadSessionUpdate(
      new OpenAIAdapter({
        mintToken: async () => fakeToken,
        transcription: { model: 'whisper-1' },
        voice: 'cedar',
      }),
    );
    expect(update.session.audio.input).toEqual({
      ...expectedInputControls,
      transcription: { model: 'whisper-1' },
    });
    expect(update.session.audio.output.voice).toBe('cedar');
    expectNoLegacyInputAudioFields(update);
  });

  it('falls back to the default model when the transcription object omits model', async () => {
    const update = await connectAndReadSessionUpdate(
      new OpenAIAdapter({
        mintToken: async () => fakeToken,
        transcription: {},
      }),
    );
    expect(update.session.audio.input).toEqual({
      ...expectedInputControls,
      transcription: { model: 'gpt-4o-mini-transcribe' },
    });
    expect(update.session.audio.output.voice).toBe('marin');
    expectNoLegacyInputAudioFields(update);
  });

  it('omits input transcription when disabled but retains output voice', async () => {
    const update = await connectAndReadSessionUpdate(
      new OpenAIAdapter({
        mintToken: async () => fakeToken,
        transcription: false,
      }),
    );
    expect(update.session.audio.input).toEqual(expectedInputControls);
    expect(update.session.audio.output.voice).toBe('marin');
    expectNoLegacyInputAudioFields(update);
  });
});

// ============================================================================
// Greeting capability (RealtimeGreetingAdapter)
// ============================================================================

class GreetingFakeAudioBuffer {
  constructor(
    readonly numberOfChannels: number,
    readonly length: number,
    readonly sampleRate: number,
  ) {}
}

class GreetingFakeBufferSource {
  buffer: GreetingFakeAudioBuffer | null = null;
  onended: (() => void) | null = null;
  connectedTo: unknown = null;
  started = false;
  stopped = false;
  disconnected = false;

  connect(destination: unknown): void {
    this.connectedTo = destination;
  }

  disconnect(): void {
    this.disconnected = true;
  }

  start(): void {
    this.started = true;
  }

  stop(): void {
    this.stopped = true;
  }

  end(): void {
    this.onended?.();
  }
}

class GreetingFakeAudioContext {
  static instances: GreetingFakeAudioContext[] = [];
  readonly destination = { kind: 'destination' as const };
  readonly sampleRate = 44100;
  state: AudioContextState = 'running';
  sources: GreetingFakeBufferSource[] = [];

  constructor() {
    GreetingFakeAudioContext.instances.push(this);
  }

  resume(): Promise<void> {
    this.state = 'running';
    return Promise.resolve();
  }

  createBuffer(
    numberOfChannels: number,
    length: number,
    sampleRate: number,
  ): GreetingFakeAudioBuffer {
    return new GreetingFakeAudioBuffer(numberOfChannels, length, sampleRate);
  }

  createBufferSource(): GreetingFakeBufferSource {
    const source = new GreetingFakeBufferSource();
    this.sources.push(source);
    return source;
  }

  async decodeAudioData(_data: ArrayBuffer): Promise<GreetingFakeAudioBuffer> {
    return new GreetingFakeAudioBuffer(1, 8, this.sampleRate);
  }
}

/** End the latest playback source so play() can resolve. */
function endLatestPlayback(): void {
  const ctx = GreetingFakeAudioContext.instances.at(-1);
  const source = ctx?.sources.at(-1);
  source?.end();
}

async function settleGreetingPlay(speak: Promise<unknown>): Promise<unknown> {
  // Allow synthesize + decode microtasks, then end the buffer source.
  for (let i = 0; i < 10; i += 1) {
    await Promise.resolve();
    const ctx = GreetingFakeAudioContext.instances.at(-1);
    // sources[0] is silent unlock; playback is later.
    if (ctx && ctx.sources.length >= 2 && ctx.sources.at(-1)?.started) {
      endLatestPlayback();
      return speak;
    }
  }
  throw new Error('greeting playback source never started');
}

describe('OpenAIAdapter — greeting speakAssistantText', () => {
  const greetingId = MessageId('greeting:s1');
  const greetingText = 'Welcome aboard.';
  let originalAudioContext: unknown;

  beforeEach(() => {
    GreetingFakeAudioContext.instances = [];
    originalAudioContext = Reflect.get(globalThis, 'AudioContext');
    Object.defineProperty(globalThis, 'AudioContext', {
      value: GreetingFakeAudioContext,
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    restoreGlobal('AudioContext', originalAudioContext);
    GreetingFakeAudioContext.instances = [];
  });

  function makeSynthesizer(opts?: {
    impl?: (args: {
      text: string;
      voice: string;
      signal: AbortSignal;
    }) => Promise<ArrayBuffer>;
    calls?: Array<{ text: string; voice: string; signal: AbortSignal }>;
  }) {
    const calls =
      opts?.calls ??
      ([] as Array<{ text: string; voice: string; signal: AbortSignal }>);
    const synthesizeGreeting =
      opts?.impl ??
      (async (args: { text: string; voice: string; signal: AbortSignal }) => {
        calls.push(args);
        return new ArrayBuffer(8);
      });
    return { synthesizeGreeting, calls };
  }

  it('sends the exact assistant item before TTS without forwarding an engine ID that OpenAI may reject', async () => {
    const order: string[] = [];
    const { synthesizeGreeting, calls } = makeSynthesizer({
      impl: async (args) => {
        order.push('tts');
        calls.push(args);
        return new ArrayBuffer(8);
      },
    });
    const adapter = new OpenAIAdapter({
      mintToken: async () => fakeToken,
      synthesizeGreeting,
    });
    const channel = await connectAndOpen(adapter);
    adapter.activateAudio();
    expect(GreetingFakeAudioContext.instances).toHaveLength(1);

    const originalSend = channel.send.bind(channel);
    channel.send = (data: string) => {
      order.push('send');
      originalSend(data);
    };

    const engineGreetingId = MessageId(
      'greeting:session-123456789012345678901',
    );
    expect(String(engineGreetingId)).toHaveLength(38);

    await settleGreetingPlay(
      adapter.speakAssistantText({
        id: engineGreetingId,
        text: greetingText,
        signal: new AbortController().signal,
      }),
    );

    expect(order).toEqual(['send', 'tts']);
    const frames = channel.sent.map(
      (s) => JSON.parse(s) as { type: string; item?: unknown },
    );
    const creates = frames.filter((f) => f.type === 'conversation.item.create');
    const responses = frames.filter((f) => f.type === 'response.create');
    expect(creates).toHaveLength(1);
    expect(creates[0]).toEqual({
      type: 'conversation.item.create',
      item: {
        type: 'message',
        role: 'assistant',
        status: 'completed',
        content: [{ type: 'output_text', text: greetingText }],
      },
    });
    expect(responses).toHaveLength(0);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.text).toBe(greetingText);
    expect(calls[0]?.voice).toBe('marin');
  });

  it('completes without any conversation.item.created provider event', async () => {
    const { synthesizeGreeting } = makeSynthesizer();
    const adapter = new OpenAIAdapter({
      mintToken: async () => fakeToken,
      synthesizeGreeting,
    });
    await connectAndOpen(adapter);
    adapter.activateAudio();

    await expect(
      settleGreetingPlay(
        adapter.speakAssistantText({
          id: greetingId,
          text: greetingText,
          signal: new AbortController().signal,
        }),
      ),
    ).resolves.toBe('accepted');
  });

  it('returns not_started when the data channel is absent', async () => {
    const { synthesizeGreeting, calls } = makeSynthesizer();
    const adapter = new OpenAIAdapter({
      mintToken: async () => fakeToken,
      synthesizeGreeting,
    });
    adapter.activateAudio();
    await expect(
      adapter.speakAssistantText({
        id: greetingId,
        text: greetingText,
        signal: new AbortController().signal,
      }),
    ).resolves.toBe('not_started');
    expect(calls).toHaveLength(0);
  });

  it('returns not_started without a synthesizer and does not unlock Web Audio', async () => {
    const adapter = new OpenAIAdapter({ mintToken: async () => fakeToken });
    const channel = await connectAndOpen(adapter);
    adapter.activateAudio();
    await expect(
      adapter.speakAssistantText({
        id: greetingId,
        text: greetingText,
        signal: new AbortController().signal,
      }),
    ).resolves.toBe('not_started');
    expect(
      channel.sent.filter((s) => s.includes('conversation.item.create')),
    ).toHaveLength(0);
    expect(GreetingFakeAudioContext.instances).toHaveLength(0);
  });

  it('returns not_started when activateAudio was never called', async () => {
    const { synthesizeGreeting, calls } = makeSynthesizer();
    const adapter = new OpenAIAdapter({
      mintToken: async () => fakeToken,
      synthesizeGreeting,
    });
    const channel = await connectAndOpen(adapter);
    await expect(
      adapter.speakAssistantText({
        id: greetingId,
        text: greetingText,
        signal: new AbortController().signal,
      }),
    ).resolves.toBe('not_started');
    expect(
      channel.sent.filter((s) => s.includes('conversation.item.create')),
    ).toHaveLength(0);
    expect(calls).toHaveLength(0);
  });

  it('returns not_started when the caller signal is already aborted', async () => {
    const { synthesizeGreeting, calls } = makeSynthesizer();
    const adapter = new OpenAIAdapter({
      mintToken: async () => fakeToken,
      synthesizeGreeting,
    });
    await connectAndOpen(adapter);
    adapter.activateAudio();
    const aborted = new AbortController();
    aborted.abort();
    await expect(
      adapter.speakAssistantText({
        id: greetingId,
        text: greetingText,
        signal: aborted.signal,
      }),
    ).resolves.toBe('not_started');
    expect(calls).toHaveLength(0);
  });

  it('returns not_started when dc.send throws and never calls TTS', async () => {
    const { synthesizeGreeting, calls } = makeSynthesizer();
    const adapter = new OpenAIAdapter({
      mintToken: async () => fakeToken,
      synthesizeGreeting,
    });
    const channel = await connectAndOpen(adapter);
    adapter.activateAudio();
    channel.send = () => {
      throw new Error('dc closed');
    };
    await expect(
      adapter.speakAssistantText({
        id: greetingId,
        text: greetingText,
        signal: new AbortController().signal,
      }),
    ).resolves.toBe('not_started');
    expect(calls).toHaveLength(0);
  });

  it('returns accepted when synthesis fails after send', async () => {
    const adapter = new OpenAIAdapter({
      mintToken: async () => fakeToken,
      synthesizeGreeting: async () => {
        throw new Error('tts boom');
      },
    });
    const channel = await connectAndOpen(adapter);
    adapter.activateAudio();

    await expect(
      adapter.speakAssistantText({
        id: greetingId,
        text: greetingText,
        signal: new AbortController().signal,
      }),
    ).resolves.toBe('accepted');
    expect(
      channel.sent.some((s) => s.includes('conversation.item.create')),
    ).toBe(true);
  });

  it('returns accepted when decode/playback fails after send', async () => {
    const adapter = new OpenAIAdapter({
      mintToken: async () => fakeToken,
      synthesizeGreeting: async () => new ArrayBuffer(8),
    });
    await connectAndOpen(adapter);
    adapter.activateAudio();

    const ctx = GreetingFakeAudioContext.instances[0]!;
    ctx.decodeAudioData = async () => {
      throw new Error('bad wav');
    };

    await expect(
      adapter.speakAssistantText({
        id: greetingId,
        text: greetingText,
        signal: new AbortController().signal,
      }),
    ).resolves.toBe('accepted');
  });

  it('abort after send settles accepted and aborts the synthesizer signal without releasing it', async () => {
    let observedSignal: AbortSignal | undefined;
    // Intentionally never resolve — abort race must settle the adapter.
    const synthGate = new Promise<void>(() => {});

    const adapter = new OpenAIAdapter({
      mintToken: async () => fakeToken,
      synthesizeGreeting: async ({ signal }) => {
        observedSignal = signal;
        await synthGate;
        return new ArrayBuffer(8);
      },
    });
    await connectAndOpen(adapter);
    adapter.activateAudio();

    const controller = new AbortController();
    const speak = adapter.speakAssistantText({
      id: greetingId,
      text: greetingText,
      signal: controller.signal,
    });
    await flushMicrotasks();
    expect(observedSignal).toBeDefined();
    expect(observedSignal?.aborted).toBe(false);

    controller.abort();
    expect(observedSignal?.aborted).toBe(true);
    await expect(speak).resolves.toBe('accepted');
  });

  it('disconnect settles an uncooperative pending synthesizer without releasing it', async () => {
    let observedSignal: AbortSignal | undefined;
    // Never resolves — proves disconnect/abort race, not cooperative synth.
    const synthGate = new Promise<void>(() => {});

    const adapter = new OpenAIAdapter({
      mintToken: async () => fakeToken,
      synthesizeGreeting: async ({ signal }) => {
        observedSignal = signal;
        await synthGate;
        return new ArrayBuffer(8);
      },
    });
    await connectAndOpen(adapter);
    adapter.activateAudio();

    const speak = adapter.speakAssistantText({
      id: greetingId,
      text: greetingText,
      signal: new AbortController().signal,
    });
    await flushMicrotasks();
    expect(observedSignal?.aborted).toBe(false);

    await adapter.disconnect();
    expect(observedSignal?.aborted).toBe(true);
    await expect(speak).resolves.toBe('accepted');
  });

  it('pre-send abort while resume hangs returns not_started without releasing resume', async () => {
    // Hang AudioContext.resume so ensureReady would pend forever without abort race.
    const Original = GreetingFakeAudioContext;
    const resumeGate = new Promise<void>(() => {});
    class HangingResumeContext extends Original {
      override resume(): Promise<void> {
        return resumeGate;
      }
    }
    Object.defineProperty(globalThis, 'AudioContext', {
      value: HangingResumeContext,
      configurable: true,
      writable: true,
    });

    const { synthesizeGreeting, calls } = makeSynthesizer();
    const adapter = new OpenAIAdapter({
      mintToken: async () => fakeToken,
      synthesizeGreeting,
    });
    const channel = await connectAndOpen(adapter);
    adapter.activateAudio();

    const controller = new AbortController();
    const speak = adapter.speakAssistantText({
      id: greetingId,
      text: greetingText,
      signal: controller.signal,
    });
    await flushMicrotasks();
    controller.abort();
    await expect(speak).resolves.toBe('not_started');
    expect(calls).toHaveLength(0);
    expect(
      channel.sent.filter((s) => s.includes('conversation.item.create')),
    ).toHaveLength(0);
  });

  it('stale operation finally does not stop a newer operation playback', async () => {
    // A hangs forever on synth; B starts while A is still in-flight, then A is
    // aborted so A's finally runs after #greetingOp points at B.
    // If A unconditionally stop()s the shared player, B's source is stopped
    // and speakB settles early — this test must fail under that bug.
    const synthA = new Promise<ArrayBuffer>(() => {});
    let bCalls = 0;

    const adapter = new OpenAIAdapter({
      mintToken: async () => fakeToken,
      synthesizeGreeting: async ({ text }) => {
        if (text === 'Hi A') return synthA;
        bCalls += 1;
        return new ArrayBuffer(8);
      },
    });
    await connectAndOpen(adapter);
    adapter.activateAudio();

    const controllerA = new AbortController();
    const speakA = adapter.speakAssistantText({
      id: MessageId('greeting:a'),
      text: 'Hi A',
      signal: controllerA.signal,
    });
    await flushMicrotasks();

    // B starts while A is still awaiting its synthesizer.
    const speakB = adapter.speakAssistantText({
      id: MessageId('greeting:b'),
      text: 'Hi B',
      signal: new AbortController().signal,
    });
    await flushMicrotasks();
    expect(bCalls).toBe(1);

    const ctx = GreetingFakeAudioContext.instances.at(-1)!;
    let bSource: GreetingFakeBufferSource | undefined;
    for (let i = 0; i < 20; i += 1) {
      const candidate = ctx.sources.at(-1);
      if (candidate?.started && ctx.sources.length >= 2) {
        bSource = candidate;
        break;
      }
      await Promise.resolve();
    }
    expect(bSource).toBeDefined();
    expect(bSource!.started).toBe(true);
    expect(bSource!.stopped).toBe(false);
    expect(bSource!.disconnected).toBe(false);

    let bSettled = false;
    void speakB.then(
      () => {
        bSettled = true;
      },
      () => {
        bSettled = true;
      },
    );

    // Abort A: race settles speakA; finally must not stop B's source.
    controllerA.abort();
    await expect(speakA).resolves.toBe('accepted');
    await flushMicrotasks();
    await flushMicrotasks();

    // B must still be mid-playback: not stopped by stale A, and not settled.
    expect(bSource!.started).toBe(true);
    expect(bSource!.stopped).toBe(false);
    expect(bSource!.disconnected).toBe(false);
    expect(bSettled).toBe(false);

    // Only B's own onended may complete speakB.
    bSource!.end();
    await expect(speakB).resolves.toBe('accepted');
    expect(bSettled).toBe(true);
  });

  it('passes the configured voice to the synthesizer', async () => {
    const { synthesizeGreeting, calls } = makeSynthesizer();
    const adapter = new OpenAIAdapter({
      mintToken: async () => fakeToken,
      voice: 'cedar',
      synthesizeGreeting,
    });
    await connectAndOpen(adapter);
    adapter.activateAudio();

    await settleGreetingPlay(
      adapter.speakAssistantText({
        id: greetingId,
        text: greetingText,
        signal: new AbortController().signal,
      }),
    );
    expect(calls[0]?.voice).toBe('cedar');
  });

  it('stops active greeting playback on speech_started without tearing down the session', async () => {
    const { synthesizeGreeting } = makeSynthesizer();
    const adapter = new OpenAIAdapter({
      mintToken: async () => fakeToken,
      synthesizeGreeting,
    });
    const channel = await connectAndOpen(adapter);
    adapter.activateAudio();

    const speak = adapter.speakAssistantText({
      id: greetingId,
      text: greetingText,
      signal: new AbortController().signal,
    });

    const ctx = GreetingFakeAudioContext.instances.at(-1)!;
    let playback: GreetingFakeBufferSource | undefined;
    for (let i = 0; i < 20; i += 1) {
      const candidate = ctx.sources.at(-1);
      if (candidate?.started && ctx.sources.length >= 2) {
        playback = candidate;
        break;
      }
      await Promise.resolve();
    }
    expect(playback).toBeDefined();
    expect(playback!.stopped).toBe(false);

    const createsBefore = channel.sent.filter((s) =>
      s.includes('conversation.item.create'),
    ).length;
    expect(createsBefore).toBe(1);

    channel.receive({ type: 'input_audio_buffer.speech_started' });
    await flushMicrotasks();

    // Adapter-owned Web Audio greeting stops; speak settles accepted (post-send).
    expect(playback!.stopped).toBe(true);
    await expect(speak).resolves.toBe('accepted');

    // Session stays connected and usable; history is not resent/duplicated.
    expect(channel.readyState).toBe('open');
    expect(channel.closed).toBe(false);
    channel.send(JSON.stringify({ type: 'response.create' }));
    expect(
      channel.sent.filter((s) => s.includes('conversation.item.create')),
    ).toHaveLength(1);
    expect(
      channel.sent.filter((s) => {
        try {
          return (
            (JSON.parse(s) as { type?: string }).type === 'response.create'
          );
        } catch {
          return false;
        }
      }),
    ).toHaveLength(1);
  });
});

describe('GreetingCoordinator × OpenAIAdapter — cross-layer ordering', () => {
  const layerText = 'Cross-layer greeting text stays exact.';
  let originalAudioContext: unknown;

  beforeEach(() => {
    GreetingFakeAudioContext.instances = [];
    originalAudioContext = Reflect.get(globalThis, 'AudioContext');
    Object.defineProperty(globalThis, 'AudioContext', {
      value: GreetingFakeAudioContext,
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    restoreGlobal('AudioContext', originalAudioContext);
    GreetingFakeAudioContext.instances = [];
  });

  it('orders Engine ack → caption → exact provider item → TTS without provider ack or response.create', async () => {
    const order: string[] = [];
    const adapter = new OpenAIAdapter({
      mintToken: async () => fakeToken,
      synthesizeGreeting: async ({ text, voice }) => {
        order.push('tts');
        expect(text).toBe(layerText);
        expect(voice).toBe('marin');
        return new ArrayBuffer(8);
      },
    });
    const channel = await connectAndOpen(adapter);
    adapter.activateAudio();

    const originalSend = channel.send.bind(channel);
    channel.send = (data: string) => {
      originalSend(data);
      let parsed: { type?: string; item?: Record<string, unknown> };
      try {
        parsed = JSON.parse(data) as {
          type?: string;
          item?: Record<string, unknown>;
        };
      } catch {
        return;
      }
      if (
        parsed.type === 'conversation.item.create' &&
        parsed.item?.role === 'assistant'
      ) {
        order.push('provider-item');
      }
    };

    const sessionId = SessionId('cross-layer-sess');
    const coordinator = new GreetingCoordinator();
    const expectedId = coordinator.greetingIdFor(sessionId);

    const instance: RealtimeInstance = {
      submitIntent: async () => ({}),
      waitForIdle: async () => {},
      getStructuralSnapshot: () => ({
        instances: [],
        layout: null,
        layoutMode: 'grid',
        chartDimensions: { rows: 8, columns: 12 },
      }),
      getCapabilitySnapshot: () => ({ vessels: [] }),
      onSettled: () => () => {},
      addAssistantMessageAcknowledged: async (args) => {
        order.push('engine-ack');
        expect(args.id).toBe(expectedId);
        expect(args.message).toBe(layerText);
        return 'inserted';
      },
      observeEngineConnection: (cb) => {
        cb(true);
        return () => {};
      },
    };

    const run = coordinator.run({
      sessionId,
      text: layerText,
      instance,
      adapter,
      signal: new AbortController().signal,
      emitTranscript: (text) => {
        order.push('caption');
        expect(text).toBe(layerText);
      },
    });

    // Coordinator has more async steps than a bare speakAssistantText call;
    // wait until TTS has started playback, then end the buffer source.
    for (let i = 0; i < 40; i += 1) {
      await flushMicrotasks();
      const ctx = GreetingFakeAudioContext.instances.at(-1);
      if (
        order.includes('tts') &&
        ctx &&
        ctx.sources.length >= 2 &&
        ctx.sources.at(-1)?.started
      ) {
        endLatestPlayback();
        break;
      }
    }
    await run;

    expect(order).toEqual(['engine-ack', 'caption', 'provider-item', 'tts']);

    const frames = channel.sent.map(
      (s) => JSON.parse(s) as { type: string; item?: unknown },
    );
    const creates = frames.filter((f) => f.type === 'conversation.item.create');
    const responses = frames.filter((f) => f.type === 'response.create');
    expect(creates).toHaveLength(1);
    expect(creates[0]).toEqual({
      type: 'conversation.item.create',
      item: {
        type: 'message',
        role: 'assistant',
        status: 'completed',
        content: [{ type: 'output_text', text: layerText }],
      },
    });
    expect(responses).toHaveLength(0);
    // Completes without any conversation.item.created provider echo.
  });
});
