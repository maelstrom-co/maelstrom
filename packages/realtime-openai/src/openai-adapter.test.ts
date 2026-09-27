import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import type {
  CapabilitySnapshot,
  TimedTranscriptFragment,
  UIStructuralSnapshot,
} from '@maelstrom-co/client';
import { MessageId, SessionId, ToolCallId } from '@maelstrom-co/protocol';
import type {
  AdapterConnectOptions,
  RealtimeAdapterEvent,
  RealtimeInstance,
} from '@maelstrom-co/realtime';
import {
  GreetingCoordinator,
  RealtimeSession,
  RealtimeVoiceError,
} from '@maelstrom-co/realtime';
import type { UnixSeconds } from '@maelstrom-co/realtime-protocol';
import type { OpenAITokenGrant } from '@maelstrom-co/realtime-protocol/openai';
import FakeTimers from '@sinonjs/fake-timers';
import {
  type GreetingInterruptionRuntime,
  setGreetingInterruptionRuntimeImporterForTests,
} from './greeting-interruption-runtime.js';
import { OpenAIAdapter } from './openai-adapter.js';

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

// ============================================================================
// Fakes
// ============================================================================

class FakeTrack {
  stopped = false;
  stopCalls = 0;
  readonly enabledMutations: boolean[] = [];
  readonly lifecycle: string[] = [];
  getSettingsCalls = 0;
  getSettingsImpl: (() => MediaTrackSettings) | undefined;
  #enabled: boolean;

  constructor(
    readonly kind = 'audio',
    enabled = true,
  ) {
    this.#enabled = enabled;
  }

  get enabled(): boolean {
    return this.#enabled;
  }

  set enabled(value: boolean) {
    this.#enabled = value;
    this.enabledMutations.push(value);
    this.lifecycle.push(`enabled:${value}`);
  }

  getSettings(): MediaTrackSettings {
    this.getSettingsCalls += 1;
    return this.getSettingsImpl?.() ?? {};
  }

  stop(): void {
    this.stopped = true;
    this.stopCalls += 1;
    this.lifecycle.push('stop');
  }
}

class FakeMediaStream {
  static instances: FakeMediaStream[] = [];
  readonly tracks: FakeTrack[];

  constructor(trackCountOrTracks: number | readonly FakeTrack[] = 1) {
    this.tracks =
      typeof trackCountOrTracks === 'number'
        ? Array.from({ length: trackCountOrTracks }, () => new FakeTrack())
        : [...trackCountOrTracks];
    FakeMediaStream.instances.push(this);
  }

  getTracks(): FakeTrack[] {
    return this.tracks;
  }

  getAudioTracks(): FakeTrack[] {
    return this.tracks.filter((track) => track.kind === 'audio');
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
  replaceTrackCalls: number;
  replaceTrack(track: MediaStreamTrack | null): Promise<void>;
}

class FakeRTCPeerConnection {
  static instances: FakeRTCPeerConnection[] = [];

  closed = false;
  ontrack: ((event: { streams: readonly unknown[] }) => void) | null = null;
  oniceconnectionstatechange: (() => void) | null = null;
  iceConnectionState = 'new';
  localDescription: { type: string; sdp: string } | undefined;
  dataChannel: FakeDataChannel | undefined;
  addTrackCalls = 0;
  removeTrackCalls = 0;
  replaceTrackImpl:
    | ((sender: FakeSender, track: MediaStreamTrack | null) => Promise<void>)
    | undefined;
  private readonly senders: FakeSender[] = [];

  constructor() {
    FakeRTCPeerConnection.instances.push(this);
  }

  createDataChannel(_label: string): FakeDataChannel {
    this.dataChannel = new FakeDataChannel();
    return this.dataChannel;
  }

  addTrack(track: FakeTrack): FakeSender {
    this.addTrackCalls += 1;
    const sender: FakeSender = {
      track,
      replaceTrackCalls: 0,
      replaceTrack: async (next) => {
        sender.replaceTrackCalls += 1;
        if (this.replaceTrackImpl) {
          await this.replaceTrackImpl(sender, next);
          return;
        }
        throw new Error('replaceTrack must not be used by greeting gating');
      },
    };
    this.senders.push(sender);
    return sender;
  }

  removeTrack(_sender: FakeSender): void {
    this.removeTrackCalls += 1;
    throw new Error('removeTrack must not be used by greeting gating');
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
  adapter: OpenAIAdapter;
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

function sentFrames(channel: FakeDataChannel): Array<Record<string, unknown>> {
  return channel.sent.map(
    (frame) => JSON.parse(frame) as Record<string, unknown>,
  );
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
// Greeting-interruption configuration
// ============================================================================

describe('OpenAIAdapter — greeting interruption configuration', () => {
  const generatedTrack = new FakeTrack();
  const runtime = {
    createLocalAudioPreRoll: async () => ({
      track: generatedTrack as unknown as MediaStreamTrack,
      startAutomaticTurn: async () => {},
      startManualTurn: async () => {},
      clear: async () => {},
      endTurn: async () => {},
      destroy: async () => {},
    }),
    createBrowserVad: async () => ({ destroy: async () => {} }),
  } as unknown as GreetingInterruptionRuntime;

  it('accepts omitted, false, true, and valid object configurations synchronously', () => {
    for (const greetingInterruption of [
      undefined,
      false,
      true,
      {
        assetBaseUrl: 'https://cdn.example.com/vad',
        preRollMs: 0,
        providerOptions: { positiveSpeechThreshold: 0 },
      },
    ] as const) {
      expect(
        () =>
          new OpenAIAdapter({
            mintToken: async () => fakeToken,
            ...(greetingInterruption === undefined
              ? {}
              : { greetingInterruption }),
          }),
      ).not.toThrow();
    }
  });

  it.each([
    ['null', null],
    ['array', []],
    ['primitive', 'enabled'],
    ['unsafe asset URL', { assetBaseUrl: 'http://cdn.example.com/vad/' }],
    ['non-finite pre-roll', { preRollMs: Number.NaN }],
    ['out-of-range pre-roll', { preRollMs: 501 }],
    ['unsupported provider tuning', { providerOptions: { unsupported: true } }],
    [
      'malformed provider ratio',
      { providerOptions: { positiveSpeechThreshold: 2 } },
    ],
    ['malformed provider options', { providerOptions: [] }],
  ])('rejects invalid runtime configuration synchronously: %s', (_name, value) => {
    let thrown: unknown;
    try {
      new OpenAIAdapter({
        mintToken: async () => fakeToken,
        greetingInterruption: value as unknown as false,
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(TypeError);
    expect((thrown as Error).message).toStartWith('greetingInterruption');
  });

  it('rejects invalid configuration before token, microphone, peer, or VAD work', () => {
    let mintCalls = 0;
    let mediaCalls = 0;
    getUserMediaImpl = async () => {
      mediaCalls += 1;
      return new FakeMediaStream(1);
    };

    expect(
      () =>
        new OpenAIAdapter({
          mintToken: async () => {
            mintCalls += 1;
            return fakeToken;
          },
          greetingInterruption: { assetBaseUrl: 'http://unsafe.example/vad/' },
        }),
    ).toThrow(TypeError);

    expect(mintCalls).toBe(0);
    expect(mediaCalls).toBe(0);
    expect(FakeRTCPeerConnection.instances).toEqual([]);
  });

  it.each([
    undefined,
    false,
  ] as const)('keeps the original raw microphone attachment when %p', async (greetingInterruption) => {
    let runtimeLoads = 0;
    const restoreRuntime = setGreetingInterruptionRuntimeImporterForTests(
      async () => {
        runtimeLoads += 1;
        return runtime;
      },
    );
    const adapter = new OpenAIAdapter({
      mintToken: async () => fakeToken,
      ...(greetingInterruption === undefined ? {} : { greetingInterruption }),
    });
    try {
      await connectAndOpen(adapter);
    } finally {
      restoreRuntime();
    }

    const stream = FakeMediaStream.instances.at(-1);
    const connection = FakeRTCPeerConnection.instances.at(-1);
    expect(adapter.getAudioStreams().mic).toBe(
      stream as unknown as MediaStream,
    );
    expect(connection?.getSenders().map((sender) => sender.track)).toEqual(
      stream?.getTracks(),
    );
    expect(connection?.addTrackCalls).toBe(stream?.getTracks().length);
    expect(runtimeLoads).toBe(0);
  });

  it('lazy-loads the enabled interruption runtime during connection preparation', async () => {
    let runtimeLoads = 0;
    const restoreRuntime = setGreetingInterruptionRuntimeImporterForTests(
      async () => {
        runtimeLoads += 1;
        return runtime;
      },
    );
    const adapter = new OpenAIAdapter({
      mintToken: async () => fakeToken,
      greetingInterruption: true,
    });

    try {
      await connectAndOpen(adapter);
    } finally {
      restoreRuntime();
    }

    const stream = FakeMediaStream.instances.at(-1);
    const connection = FakeRTCPeerConnection.instances.at(-1);
    expect(adapter.getAudioStreams().mic).toBe(
      stream as unknown as MediaStream,
    );
    expect(connection?.getSenders().map((sender) => sender.track)).toEqual([
      generatedTrack,
    ]);
    expect(connection?.getSenders()[0]?.track).not.toBe(stream?.getTracks()[0]);
    expect(runtimeLoads).toBe(1);
  });
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
  it('reads initial grounding after the handshake and replaces it as data without requesting speech', async () => {
    let current = 'UI snapshot r1: calendar';
    const adapter = new OpenAIAdapter({ mintToken: async () => fakeToken });
    const getInitialGrounding = mock(() => current);
    const connecting = adapter.connect({ ...connectOpts, getInitialGrounding });
    const channel = await latestDataChannel();
    expect(getInitialGrounding).not.toHaveBeenCalled();
    current = 'UI snapshot r2: journal';
    channel.triggerOpen();
    await connecting;
    const initial = channel.sent.map((value) => JSON.parse(value));
    expect(initial.map((value) => value.type)).toEqual([
      'session.update',
      'conversation.item.create',
    ]);
    expect(initial[1].item).toMatchObject({
      role: 'user',
      content: [{ type: 'input_text', text: current }],
    });
    adapter.injectGrounding('UI snapshot r3: tasks');
    const replacement = channel.sent
      .slice(-2)
      .map((value) => JSON.parse(value));
    expect(replacement[0]).toMatchObject({
      type: 'conversation.item.delete',
      item_id: initial[1].item.id,
    });
    expect(replacement[1].item.id).toBe(initial[1].item.id);
    expect(
      channel.sent.some(
        (value) => JSON.parse(value).type === 'response.create',
      ),
    ).toBe(false);
    await adapter.disconnect();
  });

  it('keeps the connection usable when optional startup context is unavailable', async () => {
    const adapter = new OpenAIAdapter({ mintToken: async () => fakeToken });
    const events: RealtimeAdapterEvent[] = [];
    adapter.on((event) => events.push(event));
    const connecting = adapter.connect({
      ...connectOpts,
      getInitialGrounding: () => {
        throw new Error('private snapshot');
      },
    });
    const channel = await latestDataChannel();
    channel.triggerOpen();
    await connecting;
    expect(events.some((event) => event.type === 'error')).toBe(true);
    adapter.injectGrounding('Later valid snapshot');
    expect(channel.sent.at(-1)).toContain('Later valid snapshot');
    await adapter.disconnect();
  });
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

describe('OpenAIAdapter — transcript-confirmed interruption', () => {
  async function connectTranscriptConfirmed(): Promise<{
    adapter: OpenAIAdapter;
    channel: FakeDataChannel;
  }> {
    const adapter = new OpenAIAdapter({
      mintToken: async () => fakeToken,
      serverVad: { bargeInMode: 'transcript-confirmed' },
    });
    const channel = await connectAndOpen(adapter);
    channel.sent.length = 0;
    return { adapter, channel };
  }

  const usefulDelta = {
    type: 'conversation.item.input_audio_transcription.delta',
    item_id: 'user-item-1',
    delta: 'hello',
  } as const;

  const committed = (itemId: string) => ({
    type: 'input_audio_buffer.committed',
    item_id: itemId,
  });

  const completed = (itemId: string, transcript = 'useful transcript') => ({
    type: 'conversation.item.input_audio_transcription.completed',
    item_id: itemId,
    transcript,
  });

  const responseCreates = (channel: FakeDataChannel) =>
    sentFrames(channel).filter((frame) => frame.type === 'response.create');

  it.each([
    ['commit then completion', ['commit', 'completed']],
    ['completion then commit', ['completed', 'commit']],
    ['delta then completion then commit', ['delta', 'completed', 'commit']],
    [
      'duplicate commit and completion',
      ['commit', 'commit', 'completed', 'completed'],
    ],
  ] as const)('creates one response for a committed useful transcript: %s', async (_name, order) => {
    const { channel } = await connectTranscriptConfirmed();
    const itemId = 'validated-item';

    for (const event of order) {
      if (event === 'commit') channel.receive(committed(itemId));
      if (event === 'completed') channel.receive(completed(itemId));
      if (event === 'delta') {
        channel.receive({ ...usefulDelta, item_id: itemId });
      }
    }

    expect(responseCreates(channel)).toEqual([{ type: 'response.create' }]);
    expect(sentFrames(channel)).not.toContainEqual({
      type: 'input_audio_buffer.commit',
    });
  });

  it.each([
    ['useful delta only', [usefulDelta]],
    ['commit only', [committed('item-1')]],
    ['completion only', [completed('item-1')]],
    [
      'empty completed transcript',
      [committed('item-1'), completed('item-1', ' \n\t ')],
    ],
    [
      'uncorrelated events',
      [
        { ...committed('item-1'), item_id: '' },
        { ...completed('item-1'), item_id: '' },
      ],
    ],
    [
      'speech stop and commit',
      [{ type: 'input_audio_buffer.speech_stopped' }, committed('item-1')],
    ],
  ] as const)('does not create a response from %s', async (_name, events) => {
    const { channel } = await connectTranscriptConfirmed();

    for (const event of events) channel.receive(event);

    expect(responseCreates(channel)).toEqual([]);
  });

  it('queues distinct validated turns FIFO without collapsing them', async () => {
    const { channel } = await connectTranscriptConfirmed();

    channel.receive(committed('turn-1'));
    channel.receive(completed('turn-1'));
    channel.receive(completed('turn-2'));
    channel.receive(committed('turn-2'));
    expect(responseCreates(channel)).toHaveLength(1);

    channel.receive({ type: 'response.created', response: { id: 'turn-r1' } });
    channel.receive({ type: 'response.done', response: { id: 'turn-r1' } });
    expect(responseCreates(channel)).toHaveLength(2);

    channel.receive({ type: 'response.created', response: { id: 'turn-r2' } });
    channel.receive({ type: 'response.done', response: { id: 'turn-r2' } });
    channel.receive({ type: 'response.done', response: { id: 'turn-r2' } });
    expect(responseCreates(channel)).toHaveLength(2);
  });

  it.each([
    ['tools before turns', ['tool', 'tool', 'turn-1', 'turn-2']],
    ['turns before tools', ['turn-1', 'turn-2', 'tool', 'tool']],
  ] as const)('prioritizes one coalesced tool follow-up before FIFO turns: %s', async (_name, order) => {
    const { adapter, channel } = await connectTranscriptConfirmed();
    channel.receive({ type: 'response.created', response: { id: 'active-a' } });

    let toolNumber = 0;
    for (const source of order) {
      if (source === 'tool') {
        toolNumber += 1;
        await adapter.sendToolResult(ToolCallId(`call-${toolNumber}`), {
          ok: true,
          summary: 'done',
        });
      } else {
        channel.receive(committed(source));
        channel.receive(completed(source));
      }
    }
    expect(responseCreates(channel)).toHaveLength(0);

    channel.receive({ type: 'response.done', response: { id: 'active-a' } });
    expect(responseCreates(channel)).toHaveLength(1);
    channel.receive({ type: 'response.created', response: { id: 'tool-r' } });
    channel.receive({ type: 'response.done', response: { id: 'tool-r' } });
    expect(responseCreates(channel)).toHaveLength(2);
    channel.receive({ type: 'response.created', response: { id: 'turn-r1' } });
    channel.receive({ type: 'response.done', response: { id: 'turn-r1' } });
    expect(responseCreates(channel)).toHaveLength(3);
    channel.receive({ type: 'response.created', response: { id: 'turn-r2' } });
    channel.receive({ type: 'response.done', response: { id: 'turn-r2' } });
    expect(responseCreates(channel)).toHaveLength(3);
  });

  it('gives a pending tool follow-up priority after an idle validated turn', async () => {
    const { adapter, channel } = await connectTranscriptConfirmed();
    channel.receive(committed('turn-1'));
    channel.receive(completed('turn-1'));
    await adapter.sendToolResult(ToolCallId('call-1'), {
      ok: true,
      summary: 'done',
    });
    channel.receive(committed('turn-2'));
    channel.receive(completed('turn-2'));

    channel.receive({ type: 'response.created', response: { id: 'turn-r1' } });
    channel.receive({ type: 'response.done', response: { id: 'turn-r1' } });
    expect(responseCreates(channel)).toHaveLength(2);
    channel.receive({ type: 'response.created', response: { id: 'tool-r' } });
    channel.receive({ type: 'response.done', response: { id: 'tool-r' } });
    expect(responseCreates(channel)).toHaveLength(3);
  });

  it('handles done-before-created once and ignores duplicate, stale, and conflicting lifecycle events', async () => {
    const { channel } = await connectTranscriptConfirmed();
    channel.receive(committed('turn-1'));
    channel.receive(completed('turn-1'));
    channel.receive(committed('turn-2'));
    channel.receive(completed('turn-2'));

    channel.receive({ type: 'response.done', response: { id: 'done-first' } });
    expect(responseCreates(channel)).toHaveLength(2);
    channel.receive(committed('turn-3'));
    channel.receive(completed('turn-3'));
    channel.receive({ type: 'response.done', response: { id: 'done-first' } });
    channel.receive({
      type: 'response.created',
      response: { id: 'done-first' },
    });
    expect(responseCreates(channel)).toHaveLength(2);

    channel.receive({ type: 'response.created', response: { id: 'turn-r2' } });
    channel.receive({ type: 'response.created', response: { id: 'conflict' } });
    channel.receive({ type: 'response.done', response: { id: 'unmatched' } });
    channel.receive({ type: 'response.done', response: { id: 'conflict' } });
    expect(responseCreates(channel)).toHaveLength(2);
    channel.receive({ type: 'response.done', response: { id: 'turn-r2' } });
    expect(responseCreates(channel)).toHaveLength(3);
  });

  it('does not retry a failed response.create attempt from duplicate item events', async () => {
    const { adapter, channel } = await connectTranscriptConfirmed();
    const errors: unknown[] = [];
    adapter.on((event) => {
      if (event.type === 'error') errors.push(event.error);
    });
    const originalSend = channel.send.bind(channel);
    let createAttempts = 0;
    channel.send = (frame) => {
      if ((JSON.parse(frame) as { type?: string }).type === 'response.create') {
        createAttempts += 1;
        throw new Error('create failed');
      }
      originalSend(frame);
    };

    channel.receive(committed('turn-1'));
    channel.receive(completed('turn-1'));
    channel.receive(committed('turn-1'));
    channel.receive(completed('turn-1'));

    expect(createAttempts).toBe(1);
    expect(errors).toHaveLength(1);
  });

  it('retires a failed validated-turn response.create and fatally closes the scheduler before error notification', async () => {
    const { adapter, channel } = await connectTranscriptConfirmed();
    const errors: unknown[] = [];
    const createError = new Error('create failed');
    const originalSend = channel.send.bind(channel);
    let createAttempts = 0;
    channel.send = (frame) => {
      if ((JSON.parse(frame) as { type?: string }).type === 'response.create') {
        createAttempts += 1;
        throw createError;
      }
      originalSend(frame);
    };
    adapter.on((event) => {
      if (event.type !== 'error') return;
      errors.push(event.error);
      channel.receive(committed('reentrant-turn'));
      channel.receive(completed('reentrant-turn'));
      void adapter.sendToolResult(ToolCallId('reentrant-tool'), {
        ok: true,
        summary: 'done',
      });
    });

    channel.receive(committed('failed-turn'));
    channel.receive(completed('failed-turn'));
    channel.receive(committed('later-turn'));
    channel.receive(completed('later-turn'));
    await adapter.sendToolResult(ToolCallId('later-tool'), {
      ok: true,
      summary: 'done',
    });
    channel.receive({ type: 'response.done', response: { id: 'late-done' } });

    expect(createAttempts).toBe(1);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toBeInstanceOf(RealtimeVoiceError);
    expect((errors[0] as RealtimeVoiceError).code).toBe('DATA_CHANNEL_ERROR');
    expect((errors[0] as RealtimeVoiceError).cause).toBe(createError);
  });

  it('retires a failed tool follow-up response.create and never drains later work', async () => {
    const { adapter, channel } = await connectTranscriptConfirmed();
    const errors: unknown[] = [];
    const createError = new Error('tool follow-up create failed');
    const originalSend = channel.send.bind(channel);
    let createAttempts = 0;
    channel.send = (frame) => {
      if ((JSON.parse(frame) as { type?: string }).type === 'response.create') {
        createAttempts += 1;
        throw createError;
      }
      originalSend(frame);
    };
    adapter.on((event) => {
      if (event.type !== 'error') return;
      errors.push(event.error);
      channel.receive(committed('reentrant-turn'));
      channel.receive(completed('reentrant-turn'));
    });

    await adapter.sendToolResult(ToolCallId('failed-tool'), {
      ok: true,
      summary: 'done',
    });
    channel.receive(committed('later-turn'));
    channel.receive(completed('later-turn'));
    await adapter.sendToolResult(ToolCallId('later-tool'), {
      ok: true,
      summary: 'done',
    });
    channel.receive({ type: 'response.done', response: { id: 'late-done' } });

    expect(createAttempts).toBe(1);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toBeInstanceOf(RealtimeVoiceError);
    expect((errors[0] as RealtimeVoiceError).code).toBe('DATA_CHANNEL_ERROR');
    expect((errors[0] as RealtimeVoiceError).cause).toBe(createError);
  });

  it('does not interrupt provider output on raw speech_started', async () => {
    const { channel } = await connectTranscriptConfirmed();
    channel.receive({
      type: 'response.created',
      response: { id: 'response-1' },
    });
    channel.receive({ type: 'output_audio_buffer.started' });
    channel.sent.length = 0;

    channel.receive({ type: 'input_audio_buffer.speech_started' });

    expect(sentFrames(channel)).toEqual([]);
  });

  it('cancels the active response by id then clears active output exactly once', async () => {
    const { channel } = await connectTranscriptConfirmed();
    channel.receive({
      type: 'response.created',
      response: { id: 'response-1' },
    });
    channel.receive({ type: 'output_audio_buffer.started' });
    channel.sent.length = 0;

    channel.receive(usefulDelta);
    channel.receive(usefulDelta);
    channel.receive({ type: 'output_audio_buffer.started' });

    expect(sentFrames(channel)).toEqual([
      { type: 'response.cancel', response_id: 'response-1' },
      { type: 'output_audio_buffer.clear' },
    ]);
  });

  it('clears active output once when distinct input items target the same response', async () => {
    const { channel } = await connectTranscriptConfirmed();
    channel.receive({
      type: 'response.created',
      response: { id: 'response-1' },
    });
    channel.receive({ type: 'output_audio_buffer.started' });
    channel.sent.length = 0;

    channel.receive(usefulDelta);
    channel.receive({ ...usefulDelta, item_id: 'user-item-2' });

    expect(sentFrames(channel)).toEqual([
      { type: 'response.cancel', response_id: 'response-1' },
      { type: 'output_audio_buffer.clear' },
    ]);
  });

  it('re-clears late output for a distinct item without cancelling the response twice', async () => {
    const { channel } = await connectTranscriptConfirmed();
    channel.receive({
      type: 'response.created',
      response: { id: 'response-1' },
    });
    channel.receive({ type: 'output_audio_buffer.started' });
    channel.sent.length = 0;

    channel.receive(usefulDelta);
    channel.receive({ type: 'output_audio_buffer.started' });
    channel.receive({ ...usefulDelta, item_id: 'user-item-2' });

    expect(sentFrames(channel)).toEqual([
      { type: 'response.cancel', response_id: 'response-1' },
      { type: 'output_audio_buffer.clear' },
      { type: 'output_audio_buffer.clear' },
    ]);
  });

  it('does not let duplicate response.created reset active output attribution', async () => {
    const { channel } = await connectTranscriptConfirmed();
    const created = {
      type: 'response.created',
      response: { id: 'response-1' },
    } as const;
    channel.receive(created);
    channel.receive({ type: 'output_audio_buffer.started' });
    channel.receive(created);
    channel.sent.length = 0;

    channel.receive(usefulDelta);

    expect(sentFrames(channel)).toEqual([
      { type: 'response.cancel', response_id: 'response-1' },
      { type: 'output_audio_buffer.clear' },
    ]);
  });

  it('retains a pending clear through re-entrant response.done until late output starts', async () => {
    const { channel } = await connectTranscriptConfirmed();
    channel.receive({
      type: 'response.created',
      response: { id: 'response-1' },
    });
    channel.sent.length = 0;
    const originalSend = channel.send.bind(channel);
    channel.send = (frame) => {
      originalSend(frame);
      const payload = JSON.parse(frame) as { type?: string };
      if (payload.type === 'response.cancel') {
        channel.receive({
          type: 'response.done',
          response: { id: 'response-1', status: 'cancelled' },
        });
      }
    };

    channel.receive(usefulDelta);
    expect(sentFrames(channel)).toEqual([
      { type: 'response.cancel', response_id: 'response-1' },
    ]);

    channel.receive({ type: 'output_audio_buffer.started' });
    channel.receive({ type: 'output_audio_buffer.started' });
    expect(sentFrames(channel)).toEqual([
      { type: 'response.cancel', response_id: 'response-1' },
      { type: 'output_audio_buffer.clear' },
    ]);
  });

  it('releases a cancelled response clear obligation only from explicit empty output and preserves arbiter priority', async () => {
    const { adapter, channel } = await connectTranscriptConfirmed();
    channel.receive({
      type: 'response.created',
      response: { id: 'response-1' },
    });
    channel.receive(usefulDelta);
    await adapter.sendToolResult(ToolCallId('call-1'), {
      ok: true,
      summary: 'done',
    });
    channel.receive(committed('turn-2'));
    channel.receive(completed('turn-2'));
    channel.sent.length = 0;

    channel.receive({
      type: 'response.done',
      response: { id: 'response-1', status: 'cancelled', output: [] },
    });
    expect(sentFrames(channel)).toEqual([{ type: 'response.create' }]);

    channel.receive({ type: 'response.created', response: { id: 'tool-r' } });
    channel.receive({ type: 'response.done', response: { id: 'tool-r' } });
    expect(responseCreates(channel)).toHaveLength(2);
  });

  it.each([
    ['omitted output', { id: 'response-1', status: 'cancelled' }],
    [
      'malformed output',
      { id: 'response-1', status: 'cancelled', output: { length: 0 } },
    ],
    [
      'nonempty output',
      { id: 'response-1', status: 'cancelled', output: [{ id: 'item-1' }] },
    ],
  ] as const)('keeps the clear obligation for cancelled response.done with %s', async (_name, response) => {
    const { adapter, channel } = await connectTranscriptConfirmed();
    channel.receive({
      type: 'response.created',
      response: { id: 'response-1' },
    });
    channel.receive(usefulDelta);
    await adapter.sendToolResult(ToolCallId('call-1'), {
      ok: true,
      summary: 'done',
    });
    channel.sent.length = 0;

    channel.receive({ type: 'response.done', response });
    expect(sentFrames(channel)).toEqual([]);

    channel.receive({ type: 'output_audio_buffer.started' });
    expect(sentFrames(channel)).toEqual([
      { type: 'output_audio_buffer.clear' },
      { type: 'response.create' },
    ]);
  });

  it('does not release a cancelled response clear obligation from wrong, duplicate, or newer response events', async () => {
    const { adapter, channel } = await connectTranscriptConfirmed();
    channel.receive({
      type: 'response.created',
      response: { id: 'response-1' },
    });
    channel.receive(usefulDelta);
    await adapter.sendToolResult(ToolCallId('call-1'), {
      ok: true,
      summary: 'done',
    });
    channel.sent.length = 0;

    channel.receive({
      type: 'response.done',
      response: { id: 'wrong', status: 'cancelled', output: [] },
    });
    channel.receive({
      type: 'response.done',
      response: { id: 'response-1', status: 'cancelled' },
    });
    channel.receive({
      type: 'response.done',
      response: { id: 'response-1', status: 'cancelled', output: [] },
    });
    channel.receive({
      type: 'response.created',
      response: { id: 'response-2' },
    });
    channel.receive({
      type: 'response.done',
      response: { id: 'response-2', status: 'cancelled', output: [] },
    });
    expect(sentFrames(channel)).toEqual([]);

    channel.receive({ type: 'output_audio_buffer.started' });
    expect(sentFrames(channel)).toEqual([
      { type: 'output_audio_buffer.clear' },
      { type: 'response.create' },
    ]);
  });

  it('preserves cancel-before-clear order when response.done is re-entrant with active output', async () => {
    const { channel } = await connectTranscriptConfirmed();
    channel.receive({
      type: 'response.created',
      response: { id: 'response-1' },
    });
    channel.receive({ type: 'output_audio_buffer.started' });
    channel.sent.length = 0;
    const originalSend = channel.send.bind(channel);
    channel.send = (frame) => {
      originalSend(frame);
      if ((JSON.parse(frame) as { type?: string }).type === 'response.cancel') {
        channel.receive({
          type: 'response.done',
          response: { id: 'response-1', status: 'cancelled' },
        });
      }
    };

    channel.receive(usefulDelta);

    expect(sentFrames(channel)).toEqual([
      { type: 'response.cancel', response_id: 'response-1' },
      { type: 'output_audio_buffer.clear' },
    ]);
  });

  it('clears active output before draining a pending tool follow-up after re-entrant response.done', async () => {
    const { adapter, channel } = await connectTranscriptConfirmed();
    channel.receive({
      type: 'response.created',
      response: { id: 'response-1' },
    });
    channel.receive({ type: 'output_audio_buffer.started' });
    await adapter.sendToolResult(ToolCallId('call-1'), {
      ok: true,
      summary: 'done',
    });
    channel.sent.length = 0;
    const originalSend = channel.send.bind(channel);
    channel.send = (frame) => {
      originalSend(frame);
      if ((JSON.parse(frame) as { type?: string }).type === 'response.cancel') {
        channel.receive({
          type: 'response.done',
          response: { id: 'response-1', status: 'cancelled' },
        });
      }
    };

    channel.receive(usefulDelta);

    expect(sentFrames(channel)).toEqual([
      { type: 'response.cancel', response_id: 'response-1' },
      { type: 'output_audio_buffer.clear' },
      { type: 'response.create' },
    ]);
    expect(responseCreates(channel)).toHaveLength(1);
  });

  it('clears active output before draining an already validated turn after re-entrant response.done', async () => {
    const { channel } = await connectTranscriptConfirmed();
    channel.receive({
      type: 'response.created',
      response: { id: 'response-1' },
    });
    channel.receive({ type: 'output_audio_buffer.started' });
    channel.receive(committed('user-item-1'));
    channel.receive(completed('user-item-1'));
    channel.sent.length = 0;
    const originalSend = channel.send.bind(channel);
    channel.send = (frame) => {
      originalSend(frame);
      if ((JSON.parse(frame) as { type?: string }).type === 'response.cancel') {
        channel.receive({
          type: 'response.done',
          response: { id: 'response-1', status: 'cancelled' },
        });
      }
    };

    channel.receive(usefulDelta);

    expect(sentFrames(channel)).toEqual([
      { type: 'response.cancel', response_id: 'response-1' },
      { type: 'output_audio_buffer.clear' },
      { type: 'response.create' },
    ]);
    expect(responseCreates(channel)).toHaveLength(1);
  });

  it('fulfills a pending clear as already empty when output stops before starting', async () => {
    const { channel } = await connectTranscriptConfirmed();
    channel.receive({
      type: 'response.created',
      response: { id: 'response-1' },
    });
    channel.sent.length = 0;

    channel.receive(usefulDelta);
    channel.receive({ type: 'output_audio_buffer.stopped' });
    channel.receive({ type: 'output_audio_buffer.started' });

    expect(sentFrames(channel)).toEqual([
      { type: 'response.cancel', response_id: 'response-1' },
    ]);
  });

  it('surfaces cancel failure and still attempts one standalone safety clear for active output', async () => {
    const { adapter, channel } = await connectTranscriptConfirmed();
    const errors: unknown[] = [];
    adapter.on((event) => {
      if (event.type === 'error') errors.push(event.error);
    });
    channel.receive({
      type: 'response.created',
      response: { id: 'response-1' },
    });
    channel.receive({ type: 'output_audio_buffer.started' });
    channel.sent.length = 0;
    const originalSend = channel.send.bind(channel);
    const cancelError = new Error('cancel failed');
    channel.send = (frame) => {
      if ((JSON.parse(frame) as { type?: string }).type === 'response.cancel') {
        throw cancelError;
      }
      originalSend(frame);
    };

    channel.receive(usefulDelta);
    channel.receive(usefulDelta);

    expect(errors).toEqual([cancelError]);
    expect(sentFrames(channel)).toEqual([
      { type: 'output_audio_buffer.clear' },
    ]);
  });

  it('lets a distinct input item retry cancellation after the first cancel send fails', async () => {
    const { channel } = await connectTranscriptConfirmed();
    channel.receive({
      type: 'response.created',
      response: { id: 'response-1' },
    });
    channel.receive({ type: 'output_audio_buffer.started' });
    channel.sent.length = 0;
    const originalSend = channel.send.bind(channel);
    let failCancel = true;
    channel.send = (frame) => {
      if (
        failCancel &&
        (JSON.parse(frame) as { type?: string }).type === 'response.cancel'
      ) {
        failCancel = false;
        throw new Error('cancel failed');
      }
      originalSend(frame);
    };

    channel.receive(usefulDelta);
    channel.receive({ ...usefulDelta, item_id: 'user-item-2' });

    expect(sentFrames(channel)).toEqual([
      { type: 'output_audio_buffer.clear' },
      { type: 'response.cancel', response_id: 'response-1' },
    ]);
  });

  it('clears buffered output without a speculative cancel', async () => {
    const { channel } = await connectTranscriptConfirmed();
    channel.receive({ type: 'output_audio_buffer.started' });
    channel.sent.length = 0;

    channel.receive(usefulDelta);

    expect(sentFrames(channel)).toEqual([
      { type: 'output_audio_buffer.clear' },
    ]);
  });

  it('sends nothing for whitespace, missing correlation, no target, or already-empty output', async () => {
    for (const event of [
      { ...usefulDelta, delta: '  \n ' },
      { ...usefulDelta, item_id: '' },
      usefulDelta,
    ]) {
      const { channel } = await connectTranscriptConfirmed();
      channel.receive(event);
      expect(sentFrames(channel)).toEqual([]);
    }

    const { channel } = await connectTranscriptConfirmed();
    channel.receive({ type: 'output_audio_buffer.started' });
    channel.receive({ type: 'output_audio_buffer.stopped' });
    channel.sent.length = 0;
    channel.receive(usefulDelta);
    expect(sentFrames(channel)).toEqual([]);
  });

  it('ignores events from a stale data channel after reconnect', async () => {
    const adapter = new OpenAIAdapter({
      mintToken: async () => fakeToken,
      serverVad: { bargeInMode: 'transcript-confirmed' },
    });
    const staleChannel = await connectAndOpen(adapter);
    await adapter.disconnect();
    const currentChannel = await connectAndOpen(adapter);
    currentChannel.receive({
      type: 'response.created',
      response: { id: 'response-current' },
    });
    currentChannel.receive({ type: 'output_audio_buffer.started' });
    currentChannel.sent.length = 0;

    staleChannel.receive(usefulDelta);

    expect(sentFrames(currentChannel)).toEqual([]);
  });

  it('resets response attribution and validated-turn queues across reconnect', async () => {
    const adapter = new OpenAIAdapter({
      mintToken: async () => fakeToken,
      serverVad: { bargeInMode: 'transcript-confirmed' },
    });
    const staleChannel = await connectAndOpen(adapter);
    staleChannel.sent.length = 0;
    staleChannel.receive(committed('stale-turn-1'));
    staleChannel.receive(completed('stale-turn-1'));
    staleChannel.receive(committed('stale-turn-2'));
    staleChannel.receive(completed('stale-turn-2'));
    expect(responseCreates(staleChannel)).toHaveLength(1);

    await adapter.disconnect();
    const currentChannel = await connectAndOpen(adapter);
    currentChannel.sent.length = 0;
    staleChannel.receive({
      type: 'response.done',
      response: { id: 'stale-response' },
    });
    staleChannel.receive(committed('stale-turn-3'));
    staleChannel.receive(completed('stale-turn-3'));
    expect(responseCreates(currentChannel)).toHaveLength(0);

    currentChannel.receive(committed('current-turn'));
    currentChannel.receive(completed('current-turn'));
    expect(responseCreates(currentChannel)).toHaveLength(1);
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

    const forbiddenKeys = new Set([
      'id',
      'item_id',
      'event_id',
      'response_id',
      'session_id',
      'request_id',
    ]);
    const inspect = (value: unknown): void => {
      if (Array.isArray(value)) {
        value.forEach(inspect);
        return;
      }
      if (value === null || typeof value !== 'object') return;
      for (const [key, child] of Object.entries(value)) {
        expect(forbiddenKeys).not.toContain(key);
        inspect(child);
      }
    };
    debugCalls.forEach(inspect);
  }

  it('classifies input transcript deltas without logging identifiers or text and preserves delivery', async () => {
    const debugCalls: unknown[][] = [];
    const originalDebug = console.debug;
    console.debug = (...args: unknown[]) => debugCalls.push(args);
    try {
      const adapter = new OpenAIAdapter({
        mintToken: async () => fakeToken,
        debug: true,
        serverVad: { bargeInMode: 'transcript-confirmed' },
      });
      const channel = await connectAndOpen(adapter);
      const transcripts: Array<{ text: string; final: boolean }> = [];
      adapter.on((event) => {
        if (event.type === 'transcript') {
          transcripts.push({ text: event.text, final: event.final });
        }
      });
      debugCalls.length = 0;
      const rawEvent = {
        type: 'conversation.item.input_audio_transcription.delta',
        ...sensitiveFields,
        delta: sensitiveFields.transcript,
        response: { id: 'RESPONSE_ID_SENTINEL' },
      };

      channel.receiveRaw(rawEvent);

      expect(transcripts).toEqual([
        { text: sensitiveFields.transcript, final: false },
      ]);
      expect(debugCalls).toContainEqual([
        '[OpenAIAdapter]',
        'input interruption',
        expect.objectContaining({ useful: true }),
      ]);
      expectOnlySanitizedDebugArguments(debugCalls, rawEvent);
    } finally {
      console.debug = originalDebug;
    }
  });

  it('delivers assistant transcripts without logging their text', async () => {
    const debugCalls: unknown[][] = [];
    const originalDebug = console.debug;
    console.debug = (...args: unknown[]) => debugCalls.push(args);
    try {
      const { adapter, channel } = await connectDebugAdapter();
      const transcripts: Array<{ text: string; final: boolean }> = [];
      adapter.on((event) => {
        if (event.type === 'transcript') {
          transcripts.push({ text: event.text, final: event.final });
        }
      });
      debugCalls.length = 0;
      const deltaEvent = {
        type: 'response.output_audio_transcript.delta',
        ...sensitiveFields,
        delta: sensitiveFields.transcript,
      };
      const doneEvent = {
        type: 'response.output_audio_transcript.done',
        ...sensitiveFields,
      };

      channel.receiveRaw(deltaEvent);
      channel.receiveRaw(doneEvent);

      expect(transcripts).toEqual([
        { text: sensitiveFields.transcript, final: false },
        { text: sensitiveFields.transcript, final: true },
      ]);
      expect(debugCalls).toEqual([
        ['[OpenAIAdapter]', '←', 'event'],
        ['[OpenAIAdapter]', 'parsed →', 'transcript'],
        ['[OpenAIAdapter]', '←', 'event'],
        ['[OpenAIAdapter]', 'parsed →', 'transcript'],
      ]);
      expectOnlySanitizedDebugArguments(debugCalls, deltaEvent);
      expectOnlySanitizedDebugArguments(debugCalls, doneEvent);
    } finally {
      console.debug = originalDebug;
    }
  });

  it('treats current output-audio payloads as benign metadata-only diagnostics', async () => {
    const debugCalls: unknown[][] = [];
    const warnCalls: unknown[][] = [];
    const originalDebug = console.debug;
    const originalWarn = console.warn;
    console.debug = (...args: unknown[]) => debugCalls.push(args);
    console.warn = (...args: unknown[]) => warnCalls.push(args);
    try {
      const { channel } = await connectDebugAdapter();
      debugCalls.length = 0;
      warnCalls.length = 0;
      const rawEvent = {
        type: 'response.output_audio.delta',
        delta: sensitiveFields.audio,
        ...sensitiveFields,
      };

      channel.receiveRaw(rawEvent);

      expect(debugCalls).toEqual([
        ['[OpenAIAdapter]', '←', 'response.output_audio.delta'],
        [
          '[OpenAIAdapter]',
          'unrecognized or unparsed event',
          'response.output_audio.delta',
        ],
      ]);
      expect(warnCalls).toEqual([]);
      expectOnlySanitizedDebugArguments(debugCalls, rawEvent);
    } finally {
      console.debug = originalDebug;
      console.warn = originalWarn;
    }
  });

  it('never logs an arbitrary provider-controlled event type', async () => {
    const debugCalls: unknown[][] = [];
    const warnCalls: unknown[][] = [];
    const originalDebug = console.debug;
    const originalWarn = console.warn;
    console.debug = (...args: unknown[]) => debugCalls.push(args);
    console.warn = (...args: unknown[]) => warnCalls.push(args);
    try {
      const { channel } = await connectDebugAdapter();
      debugCalls.length = 0;
      warnCalls.length = 0;
      const rawEvent = {
        type: Object.values(sensitiveFields).join(':'),
        ...sensitiveFields,
      };

      channel.receiveRaw(rawEvent);

      expect(debugCalls).toEqual([
        ['[OpenAIAdapter]', '←', 'event'],
        ['[OpenAIAdapter]', 'unrecognized or unparsed event', 'unknown'],
      ]);
      expect(warnCalls).toEqual([
        ['[OpenAIAdapter]', 'unexpected realtime event type'],
      ]);
      expectOnlySanitizedDebugArguments(
        [...debugCalls, ...warnCalls],
        rawEvent,
      );
    } finally {
      console.debug = originalDebug;
      console.warn = originalWarn;
    }
  });

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
            { category: 'speech_started', greetingActive: false },
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
            { category: 'speech_started', greetingActive: false },
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
      const transcripts: Array<{ text: string; final: boolean }> = [];
      adapter.on((event) => {
        if (event.type === 'transcript') {
          transcripts.push({ text: event.text, final: event.final });
        }
      });
      debugCalls.length = 0;

      const rawEvent = {
        type: 'conversation.item.input_audio_transcription.completed',
        ...sensitiveFields,
      };
      channel.receiveRaw(rawEvent);

      expect(transcripts).toEqual([
        { text: sensitiveFields.transcript, final: true },
      ]);
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

describe('RealtimeSession + OpenAIAdapter: store captions', () => {
  it('ends a caption cleanly on the final event and starts the next item as a new caption', async () => {
    const adapter = new OpenAIAdapter({ mintToken: async () => fakeToken });
    const session = new RealtimeSession({
      adapter,
      instance: makeInertInstance(),
      sessionId: SessionId('sess-captions'),
    });
    const connecting = session.connect();
    const channel = await latestDataChannel();
    channel.triggerOpen();
    await connecting;

    for (const delta of ['Pulling ', 'that up']) {
      channel.receive({
        type: 'response.output_audio_transcript.delta',
        item_id: 'item_a',
        delta,
      });
    }
    channel.receive({
      type: 'response.output_audio_transcript.done',
      item_id: 'item_a',
      transcript: 'Pulling that up.',
    });
    channel.receive({
      type: 'response.output_audio_transcript.delta',
      item_id: 'item_b',
      delta: 'Anything else?',
    });

    const { captions, fragments } = session.observations.getSnapshot();
    expect(fragments.map((fragment) => fragment.id)).toEqual([
      'item_a',
      'item_b',
    ]);
    expect(
      captions.map(({ role, text, final }) => ({ role, text, final })),
    ).toEqual([
      { role: 'assistant', text: 'Pulling that up.', final: true },
      { role: 'assistant', text: 'Anything else?', final: false },
    ]);
    await session.disconnect();
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

  it('configures transcript-confirmed barge-in without changing transcription or output voice', async () => {
    const update = await connectAndReadSessionUpdate(
      new OpenAIAdapter({
        mintToken: async () => fakeToken,
        transcription: { model: 'whisper-1' },
        voice: 'cedar',
        serverVad: {
          threshold: 0.6,
          bargeInMode: 'transcript-confirmed',
        },
      }),
    );

    expect(update.session.audio.input).toEqual({
      noise_reduction: { type: 'near_field' },
      turn_detection: {
        type: 'server_vad',
        threshold: 0.6,
        prefix_padding_ms: 300,
        silence_duration_ms: 500,
        create_response: false,
        interrupt_response: false,
      },
      transcription: { model: 'whisper-1' },
    });
    expect(update.session.audio.output.voice).toBe('cedar');
    expectNoLegacyInputAudioFields(update);
  });

  it('keeps immediate barge-in flags when only the server VAD threshold is configured', async () => {
    const update = await connectAndReadSessionUpdate(
      new OpenAIAdapter({
        mintToken: async () => fakeToken,
        serverVad: { threshold: 0.75 },
      }),
    );

    expect(update.session.audio.input).toEqual({
      ...expectedInputControls,
      turn_detection: {
        ...expectedInputControls.turn_detection,
        threshold: 0.75,
      },
      transcription: { model: 'gpt-4o-mini-transcribe' },
    });
  });

  it('uses the default threshold with transcript-confirmed barge-in', async () => {
    const update = await connectAndReadSessionUpdate(
      new OpenAIAdapter({
        mintToken: async () => fakeToken,
        serverVad: { bargeInMode: 'transcript-confirmed' },
      }),
    );

    expect(update.session.audio.input).toEqual({
      ...expectedInputControls,
      turn_detection: {
        ...expectedInputControls.turn_detection,
        create_response: false,
        interrupt_response: false,
      },
      transcription: { model: 'gpt-4o-mini-transcribe' },
    });
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

  it('keeps immediate mode compatible with disabled transcription', async () => {
    const update = await connectAndReadSessionUpdate(
      new OpenAIAdapter({
        mintToken: async () => fakeToken,
        transcription: false,
        serverVad: { bargeInMode: 'immediate' },
      }),
    );

    expect(update.session.audio.input).toEqual(expectedInputControls);
  });

  it('rejects non-finite and out-of-range server VAD thresholds synchronously', () => {
    for (const threshold of [-0.01, 1.01, Number.NaN, Infinity, -Infinity]) {
      expect(
        () =>
          new OpenAIAdapter({
            mintToken: async () => fakeToken,
            serverVad: { threshold },
          }),
      ).toThrow(TypeError);
    }
  });

  it('accepts both inclusive server VAD threshold boundaries', async () => {
    for (const threshold of [0, 1]) {
      const update = await connectAndReadSessionUpdate(
        new OpenAIAdapter({
          mintToken: async () => fakeToken,
          serverVad: { threshold },
        }),
      );

      expect(
        (
          update.session.audio.input as {
            turn_detection: { threshold: number };
          }
        ).turn_detection.threshold,
      ).toBe(threshold);
    }
  });

  it('rejects transcript-confirmed mode without transcription before external effects', () => {
    let mintCalls = 0;
    let microphoneCalls = 0;
    getUserMediaImpl = async () => {
      microphoneCalls += 1;
      return new FakeMediaStream(1);
    };

    expect(
      () =>
        new OpenAIAdapter({
          mintToken: async () => {
            mintCalls += 1;
            return fakeToken;
          },
          transcription: false,
          serverVad: { bargeInMode: 'transcript-confirmed' },
        }),
    ).toThrow(
      new TypeError(
        'OpenAIAdapter transcript-confirmed barge-in requires input transcription',
      ),
    );
    expect(mintCalls).toBe(0);
    expect(microphoneCalls).toBe(0);
    expect(FakeRTCPeerConnection.instances).toHaveLength(0);
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
  startImpl: (() => void) | undefined;

  connect(destination: unknown): void {
    this.connectedTo = destination;
  }

  disconnect(): void {
    this.disconnected = true;
  }

  start(): void {
    this.startImpl?.();
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
  decodeAudioDataImpl: (() => Promise<GreetingFakeAudioBuffer>) | undefined;
  onSourceStart: ((source: GreetingFakeBufferSource) => void) | undefined;

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
    source.startImpl = () => this.onSourceStart?.(source);
    this.sources.push(source);
    return source;
  }

  async decodeAudioData(_data: ArrayBuffer): Promise<GreetingFakeAudioBuffer> {
    return (
      this.decodeAudioDataImpl?.() ??
      new GreetingFakeAudioBuffer(1, 8, this.sampleRate)
    );
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

  function deferred<T>(): {
    promise: Promise<T>;
    resolve(value: T): void;
  } {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((res) => {
      resolve = res;
    });
    return { promise, resolve };
  }

  async function waitForGreetingCondition(
    condition: () => boolean,
    message: string,
  ): Promise<void> {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      if (condition()) return;
      await Promise.resolve();
    }
    throw new Error(message);
  }

  function useMicTracks(tracks: readonly FakeTrack[]): {
    stream: FakeMediaStream;
    getUserMediaCalls(): number;
  } {
    const stream = new FakeMediaStream(tracks);
    let calls = 0;
    getUserMediaImpl = async () => {
      calls += 1;
      return stream;
    };
    return { stream, getUserMediaCalls: () => calls };
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
        onPlaybackStart: () => order.push('playback'),
      }),
    );

    expect(order).toEqual(['send', 'tts', 'playback']);
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

  it('observes the greeting as one final assistant fragment when playback starts', async () => {
    const { synthesizeGreeting } = makeSynthesizer();
    const adapter = new OpenAIAdapter({
      mintToken: async () => fakeToken,
      synthesizeGreeting,
    });
    await connectAndOpen(adapter);
    adapter.activateAudio();
    const order: string[] = [];
    adapter.observations.subscribe((event) => {
      if (event.type === 'fragment')
        order.push(`fragment:${event.fragment.id}:${event.fragment.text}`);
      expect(event).toMatchObject({
        type: 'fragment',
        fragment: { role: 'assistant', speakerId: 'assistant', final: true },
      });
    });

    await settleGreetingPlay(
      adapter.speakAssistantText({
        id: greetingId,
        text: greetingText,
        signal: new AbortController().signal,
        onPlaybackStart: () => order.push('playback'),
      }),
    );

    expect(order).toEqual([
      `fragment:${greetingId}:${greetingText}`,
      'playback',
    ]);
  });

  it('does not observe the greeting once its signal is aborted before playback starts', async () => {
    const controller = new AbortController();
    const { synthesizeGreeting } = makeSynthesizer({
      impl: async () => {
        controller.abort();
        return new ArrayBuffer(8);
      },
    });
    const adapter = new OpenAIAdapter({
      mintToken: async () => fakeToken,
      synthesizeGreeting,
    });
    await connectAndOpen(adapter);
    adapter.activateAudio();
    const fragments: unknown[] = [];
    adapter.observations.subscribe((event) => fragments.push(event));

    await expect(
      adapter.speakAssistantText({
        id: greetingId,
        text: greetingText,
        signal: controller.signal,
      }),
    ).resolves.toBe('accepted');

    expect(fragments).toEqual([]);
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
    const mic = new FakeTrack('audio', true);
    useMicTracks([mic]);
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
    expect(mic.enabled).toBe(true);
    expect(mic.enabledMutations).toEqual([false, true]);
  });

  it('gates microphone tracks while synthesis is pending and restores them on abort', async () => {
    const enabled = new FakeTrack('audio', true);
    const disabled = new FakeTrack('audio', false);
    useMicTracks([enabled, enabled, disabled]);
    const synthesis = deferred<ArrayBuffer>();
    let synthesisSignal: AbortSignal | undefined;
    const adapter = new OpenAIAdapter({
      mintToken: async () => fakeToken,
      synthesizeGreeting: ({ signal }) => {
        synthesisSignal = signal;
        return synthesis.promise;
      },
    });
    await connectAndOpen(adapter);
    adapter.activateAudio();
    const caller = new AbortController();
    const speak = adapter.speakAssistantText({
      id: greetingId,
      text: greetingText,
      signal: caller.signal,
    });
    await waitForGreetingCondition(
      () => synthesisSignal !== undefined,
      'greeting synthesis did not start',
    );

    expect([enabled.enabled, disabled.enabled]).toEqual([false, false]);
    expect(enabled.enabledMutations).toEqual([false]);
    expect(disabled.enabledMutations).toEqual([false]);

    caller.abort();
    // Skip observes caller abort synchronously: each unique microphone track
    // restores its exact prior value before the async greeting settles.
    expect([enabled.enabled, disabled.enabled]).toEqual([true, false]);
    expect(enabled.enabledMutations).toEqual([false, true]);
    expect(disabled.enabledMutations).toEqual([false, false]);
    await expect(speak).resolves.toBe('accepted');
    expect(synthesisSignal?.aborted).toBe(true);
    expect(enabled.enabledMutations).toEqual([false, true]);
    expect(disabled.enabledMutations).toEqual([false, false]);
  });

  it('gates every unique audio track across decode and playback, then restores exact prior values without replacing capture', async () => {
    const enabled = new FakeTrack('audio', true);
    const disabled = new FakeTrack('audio', false);
    const video = new FakeTrack('video', true);
    const mic = useMicTracks([enabled, enabled, disabled, video]);
    const synthesis = deferred<ArrayBuffer>();
    const adapter = new OpenAIAdapter({
      mintToken: async () => fakeToken,
      synthesizeGreeting: () => synthesis.promise,
    });
    await connectAndOpen(adapter);
    adapter.activateAudio();
    const context = GreetingFakeAudioContext.instances.at(-1)!;
    const decode = deferred<GreetingFakeAudioBuffer>();
    let decodeStarted = false;
    context.decodeAudioDataImpl = () => {
      decodeStarted = true;
      return decode.promise;
    };
    let valuesAtSourceStart: boolean[] | undefined;
    context.onSourceStart = () => {
      valuesAtSourceStart = [enabled.enabled, disabled.enabled, video.enabled];
    };

    const speak = adapter.speakAssistantText({
      id: greetingId,
      text: greetingText,
      signal: new AbortController().signal,
    });
    await flushMicrotasks();
    const valuesDuringSynthesis = [
      enabled.enabled,
      disabled.enabled,
      video.enabled,
    ];
    synthesis.resolve(new ArrayBuffer(8));
    await waitForGreetingCondition(
      () => decodeStarted,
      'greeting decode did not start',
    );
    const valuesDuringDecode = [
      enabled.enabled,
      disabled.enabled,
      video.enabled,
    ];
    decode.resolve(new GreetingFakeAudioBuffer(1, 8, context.sampleRate));
    await waitForGreetingCondition(
      () =>
        context.sources.length >= 2 && context.sources.at(-1)?.started === true,
      'greeting playback did not start',
    );
    const valuesDuringPlayback = [
      enabled.enabled,
      disabled.enabled,
      video.enabled,
    ];
    context.sources.at(-1)?.end();
    await expect(speak).resolves.toBe('accepted');

    expect(valuesDuringSynthesis).toEqual([false, false, true]);
    expect(valuesDuringDecode).toEqual([false, false, true]);
    expect(valuesAtSourceStart).toEqual([false, false, true]);
    expect(valuesDuringPlayback).toEqual([false, false, true]);
    expect([enabled.enabled, disabled.enabled, video.enabled]).toEqual([
      true,
      false,
      true,
    ]);
    expect(enabled.enabledMutations).toEqual([false, true]);
    expect(disabled.enabledMutations).toEqual([false, false]);
    expect(video.enabledMutations).toEqual([]);
    expect(adapter.getAudioStreams().mic).toBe(
      mic.stream as unknown as MediaStream,
    );
    expect(mic.getUserMediaCalls()).toBe(1);
    expect(enabled.stopCalls).toBe(0);
    expect(disabled.stopCalls).toBe(0);
    const connection = FakeRTCPeerConnection.instances.at(-1)!;
    expect(connection.addTrackCalls).toBe(4);
    expect(connection.removeTrackCalls).toBe(0);
    expect(
      connection.getSenders().map((sender) => sender.replaceTrackCalls),
    ).toEqual([0, 0, 0, 0]);
  });

  it.each([
    'decode',
    'source-start',
  ] as const)('restores the microphone when greeting %s fails', async (failurePoint) => {
    const mic = new FakeTrack('audio', true);
    useMicTracks([mic]);
    const adapter = new OpenAIAdapter({
      mintToken: async () => fakeToken,
      synthesizeGreeting: async () => new ArrayBuffer(8),
    });
    await connectAndOpen(adapter);
    adapter.activateAudio();
    const context = GreetingFakeAudioContext.instances.at(-1)!;
    if (failurePoint === 'decode') {
      context.decodeAudioDataImpl = async () => {
        throw new Error('decode failed');
      };
    } else {
      context.onSourceStart = () => {
        throw new Error('source start failed');
      };
    }

    await expect(
      adapter.speakAssistantText({
        id: greetingId,
        text: greetingText,
        signal: new AbortController().signal,
      }),
    ).resolves.toBe('accepted');
    expect(mic.enabled).toBe(true);
    expect(mic.enabledMutations).toEqual([false, true]);
    expect(mic.stopCalls).toBe(0);
  });

  it('restores through caller abort during decode and ignores the late decode completion', async () => {
    const mic = new FakeTrack('audio', true);
    useMicTracks([mic]);
    const adapter = new OpenAIAdapter({
      mintToken: async () => fakeToken,
      synthesizeGreeting: async () => new ArrayBuffer(8),
    });
    await connectAndOpen(adapter);
    adapter.activateAudio();
    const context = GreetingFakeAudioContext.instances.at(-1)!;
    const decode = deferred<GreetingFakeAudioBuffer>();
    let decodeStarted = false;
    context.decodeAudioDataImpl = () => {
      decodeStarted = true;
      return decode.promise;
    };
    const caller = new AbortController();
    const speak = adapter.speakAssistantText({
      id: greetingId,
      text: greetingText,
      signal: caller.signal,
    });
    await waitForGreetingCondition(() => decodeStarted, 'decode did not start');
    const valueDuringDecode = mic.enabled;

    caller.abort();
    // The caller signal is the adapter boundary used by Skip. Restoration must
    // happen synchronously even while decode remains unresolved.
    expect(mic.enabled).toBe(true);
    expect(mic.enabledMutations).toEqual([false, true]);
    await expect(speak).resolves.toBe('accepted');
    const mutationsAfterAbort = [...mic.enabledMutations];
    decode.resolve(new GreetingFakeAudioBuffer(1, 8, context.sampleRate));
    await flushMicrotasks();

    expect(valueDuringDecode).toBe(false);
    expect(mic.enabled).toBe(true);
    expect(mic.enabledMutations).toEqual([false, true]);
    expect(mic.enabledMutations).toEqual(mutationsAfterAbort);
  });

  it('restores through adapter teardown during decode before stopping the track', async () => {
    const mic = new FakeTrack('audio', true);
    useMicTracks([mic]);
    const adapter = new OpenAIAdapter({
      mintToken: async () => fakeToken,
      synthesizeGreeting: async () => new ArrayBuffer(8),
    });
    await connectAndOpen(adapter);
    adapter.activateAudio();
    const context = GreetingFakeAudioContext.instances.at(-1)!;
    const decode = deferred<GreetingFakeAudioBuffer>();
    let decodeStarted = false;
    context.decodeAudioDataImpl = () => {
      decodeStarted = true;
      return decode.promise;
    };
    const speak = adapter.speakAssistantText({
      id: greetingId,
      text: greetingText,
      signal: new AbortController().signal,
    });
    await waitForGreetingCondition(() => decodeStarted, 'decode did not start');

    await adapter.disconnect();
    await expect(speak).resolves.toBe('accepted');
    const lifecycleAfterTeardown = [...mic.lifecycle];
    decode.resolve(new GreetingFakeAudioBuffer(1, 8, context.sampleRate));
    await flushMicrotasks();

    expect(lifecycleAfterTeardown.slice(0, 3)).toEqual([
      'enabled:false',
      'enabled:true',
      'stop',
    ]);
    expect(mic.lifecycle).toEqual(lifecycleAfterTeardown);
  });

  it('restores before teardown stops tracks and stale playback completion cannot affect a reconnected mic', async () => {
    const oldMic = new FakeTrack('audio', true);
    const newMic = new FakeTrack('audio', true);
    const streams = [
      new FakeMediaStream([oldMic]),
      new FakeMediaStream([newMic]),
    ];
    let mediaCall = 0;
    getUserMediaImpl = async () => streams[mediaCall++]!;
    const adapter = new OpenAIAdapter({
      mintToken: async () => fakeToken,
      synthesizeGreeting: async () => new ArrayBuffer(8),
    });
    await connectAndOpen(adapter);
    adapter.activateAudio();
    const speak = adapter.speakAssistantText({
      id: greetingId,
      text: greetingText,
      signal: new AbortController().signal,
    });
    const firstContext = GreetingFakeAudioContext.instances.at(-1)!;
    await waitForGreetingCondition(
      () =>
        firstContext.sources.length >= 2 &&
        firstContext.sources.at(-1)?.started === true,
      'first greeting playback did not start',
    );
    const staleSource = firstContext.sources.at(-1)!;

    await adapter.disconnect();
    await expect(speak).resolves.toBe('accepted');
    await connectAndOpen(adapter);
    const newMicMutationsBeforeStaleEnd = [...newMic.enabledMutations];
    staleSource.end();
    await flushMicrotasks();

    expect(oldMic.lifecycle.slice(0, 3)).toEqual([
      'enabled:false',
      'enabled:true',
      'stop',
    ]);
    expect(oldMic.stopped).toBe(true);
    expect(newMic.enabled).toBe(true);
    expect(newMic.enabledMutations).toEqual(newMicMutationsBeforeStaleEnd);
    expect(adapter.getAudioStreams().mic).toBe(
      streams[1] as unknown as MediaStream,
    );
  });

  it('releases an active gate before replacement synthesis and stale completion cannot restore over the replacement gate', async () => {
    const mic = new FakeTrack('audio', true);
    useMicTracks([mic]);
    const replacementSynthesis = deferred<ArrayBuffer>();
    let micValueWhenReplacementSynthesisStarted: boolean | undefined;
    const adapter = new OpenAIAdapter({
      mintToken: async () => fakeToken,
      synthesizeGreeting: async ({ text }) => {
        if (text === 'Greeting B') {
          micValueWhenReplacementSynthesisStarted = mic.enabled;
          return replacementSynthesis.promise;
        }
        return new ArrayBuffer(8);
      },
    });
    await connectAndOpen(adapter);
    adapter.activateAudio();
    const speakA = adapter.speakAssistantText({
      id: MessageId('greeting:a'),
      text: 'Greeting A',
      signal: new AbortController().signal,
    });
    const context = GreetingFakeAudioContext.instances.at(-1)!;
    await waitForGreetingCondition(
      () =>
        context.sources.length >= 2 && context.sources.at(-1)?.started === true,
      'first greeting did not start',
    );
    const staleSource = context.sources.at(-1)!;
    const speakB = adapter.speakAssistantText({
      id: MessageId('greeting:b'),
      text: 'Greeting B',
      signal: new AbortController().signal,
    });
    await waitForGreetingCondition(
      () => micValueWhenReplacementSynthesisStarted !== undefined,
      'replacement synthesis did not start',
    );
    replacementSynthesis.resolve(new ArrayBuffer(8));
    await waitForGreetingCondition(
      () => context.sources.at(-1) !== staleSource,
      'replacement playback did not start',
    );
    const replacementSource = context.sources.at(-1)!;
    const mutationsBeforeStaleEnd = [...mic.enabledMutations];
    staleSource.end();
    await expect(speakA).resolves.toBe('accepted');
    await flushMicrotasks();

    expect(micValueWhenReplacementSynthesisStarted).toBe(false);
    expect(mic.enabled).toBe(false);
    expect(mic.enabledMutations).toEqual(mutationsBeforeStaleEnd);
    replacementSource.end();
    await expect(speakB).resolves.toBe('accepted');
    expect(mic.enabled).toBe(true);
    expect(mic.enabledMutations).toEqual([false, true, false, true]);
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

  it('propagates speech_started state and event without aborting local playback while the microphone gate is active', async () => {
    const mic = new FakeTrack('audio', true);
    useMicTracks([mic]);
    const { synthesizeGreeting } = makeSynthesizer();
    const adapter = new OpenAIAdapter({
      mintToken: async () => fakeToken,
      synthesizeGreeting,
    });
    const channel = await connectAndOpen(adapter);
    adapter.activateAudio();
    const events: string[] = [];
    adapter.on((event) => {
      events.push(event.type === 'state' ? `state:${event.state}` : event.type);
    });

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

    expect(events).toContain('state:listening');
    expect(events).toContain('speech_started');
    expect(playback!.stopped).toBe(false);
    expect(mic.enabled).toBe(false);
    playback!.end();
    await expect(speak).resolves.toBe('accepted');
    expect(mic.enabled).toBe(true);

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

  it('restores the microphone synchronously when Skip aborts active playback', async () => {
    const mic = new FakeTrack('audio', true);
    useMicTracks([mic]);
    const { synthesizeGreeting } = makeSynthesizer();
    const adapter = new OpenAIAdapter({
      mintToken: async () => fakeToken,
      synthesizeGreeting,
    });
    await connectAndOpen(adapter);
    adapter.activateAudio();
    const caller = new AbortController();
    const speak = adapter.speakAssistantText({
      id: greetingId,
      text: greetingText,
      signal: caller.signal,
    });
    const context = GreetingFakeAudioContext.instances.at(-1)!;
    await waitForGreetingCondition(
      () =>
        context.sources.length >= 2 && context.sources.at(-1)?.started === true,
      'playback did not start',
    );
    const playback = context.sources.at(-1)!;

    caller.abort();
    expect(mic.enabled).toBe(true);
    expect(mic.enabledMutations).toEqual([false, true]);
    expect(playback.stopped).toBe(true);
    await expect(speak).resolves.toBe('accepted');
  });

  it('does not abort pending greeting synthesis from raw speech_started while gated', async () => {
    const mic = new FakeTrack('audio', true);
    useMicTracks([mic]);
    let synthesisSignal: AbortSignal | undefined;
    const adapter = new OpenAIAdapter({
      mintToken: async () => fakeToken,
      debug: true,
      synthesizeGreeting: async ({ signal }) => {
        synthesisSignal = signal;
        return new Promise<ArrayBuffer>(() => {});
      },
    });
    const channel = await connectAndOpen(adapter);
    adapter.activateAudio();
    const events: string[] = [];
    adapter.on((event) => events.push(event.type));
    const caller = new AbortController();
    const speak = adapter.speakAssistantText({
      id: greetingId,
      text: greetingText,
      signal: caller.signal,
    });
    await waitForGreetingCondition(
      () => synthesisSignal !== undefined,
      'synthesis did not start',
    );

    const debugCalls: unknown[][] = [];
    const originalDebug = console.debug;
    console.debug = (...args: unknown[]) => debugCalls.push(args);
    try {
      channel.receive({ type: 'input_audio_buffer.speech_started' });
    } finally {
      console.debug = originalDebug;
    }

    expect(synthesisSignal?.aborted).toBe(false);
    expect(events).toContain('speech_started');
    expect(debugCalls).toContainEqual([
      '[OpenAIAdapter]',
      'input lifecycle',
      { category: 'speech_started', greetingActive: true },
    ]);
    expect(mic.enabled).toBe(false);

    caller.abort();
    await expect(speak).resolves.toBe('accepted');
    expect(mic.enabled).toBe(true);
    expect(mic.enabledMutations).toEqual([false, true]);
  });

  it('waits for a useful correlated delta before aborting transcript-confirmed greeting synthesis', async () => {
    let synthesisSignal: AbortSignal | undefined;
    const adapter = new OpenAIAdapter({
      mintToken: async () => fakeToken,
      serverVad: { bargeInMode: 'transcript-confirmed' },
      synthesizeGreeting: async ({ signal }) => {
        synthesisSignal = signal;
        return new Promise<ArrayBuffer>(() => {});
      },
    });
    const channel = await connectAndOpen(adapter);
    adapter.activateAudio();
    const speak = adapter.speakAssistantText({
      id: greetingId,
      text: greetingText,
      signal: new AbortController().signal,
    });
    await flushMicrotasks();
    expect(synthesisSignal?.aborted).toBe(false);

    channel.receive({ type: 'input_audio_buffer.speech_started' });
    expect(synthesisSignal?.aborted).toBe(false);
    channel.receive({
      type: 'conversation.item.input_audio_transcription.delta',
      item_id: 'greeting-interruption-item',
      delta: 'hello',
    });

    expect(synthesisSignal?.aborted).toBe(true);
    await expect(speak).resolves.toBe('accepted');
  });

  it('interrupts active greeting and provider output together only once', async () => {
    const { synthesizeGreeting } = makeSynthesizer();
    const adapter = new OpenAIAdapter({
      mintToken: async () => fakeToken,
      serverVad: { bargeInMode: 'transcript-confirmed' },
      synthesizeGreeting,
    });
    const channel = await connectAndOpen(adapter);
    adapter.activateAudio();
    const speak = adapter.speakAssistantText({
      id: greetingId,
      text: greetingText,
      signal: new AbortController().signal,
    });
    await flushMicrotasks();
    const playback = GreetingFakeAudioContext.instances.at(-1)?.sources.at(-1);
    expect(playback?.started).toBe(true);
    channel.receive({
      type: 'response.created',
      response: { id: 'response-1' },
    });
    channel.receive({ type: 'output_audio_buffer.started' });
    channel.sent.length = 0;
    const delta = {
      type: 'conversation.item.input_audio_transcription.delta',
      item_id: 'user-item-1',
      delta: 'hello',
    };

    channel.receive(delta);
    channel.receive(delta);

    expect(playback?.stopped).toBe(true);
    await expect(speak).resolves.toBe('accepted');
    expect(sentFrames(channel)).toEqual([
      { type: 'response.cancel', response_id: 'response-1' },
      { type: 'output_audio_buffer.clear' },
    ]);
  });

  it('aborts the prior greeting on replacement, then interrupts only the current operation', async () => {
    const signals = new Map<string, AbortSignal>();
    const adapter = new OpenAIAdapter({
      mintToken: async () => fakeToken,
      serverVad: { bargeInMode: 'transcript-confirmed' },
      synthesizeGreeting: async ({ text, signal }) => {
        signals.set(text, signal);
        return new Promise<ArrayBuffer>(() => {});
      },
    });
    const channel = await connectAndOpen(adapter);
    adapter.activateAudio();
    const callerA = new AbortController();
    const speakA = adapter.speakAssistantText({
      id: MessageId('greeting:a'),
      text: 'Greeting A',
      signal: callerA.signal,
    });
    await flushMicrotasks();
    const speakB = adapter.speakAssistantText({
      id: MessageId('greeting:b'),
      text: 'Greeting B',
      signal: new AbortController().signal,
    });
    await flushMicrotasks();

    expect(signals.get('Greeting A')?.aborted).toBe(true);
    expect(signals.get('Greeting B')?.aborted).toBe(false);

    channel.receive({
      type: 'conversation.item.input_audio_transcription.delta',
      item_id: 'replacement-interruption-item',
      delta: 'hello',
    });

    expect(signals.get('Greeting B')?.aborted).toBe(true);
    await expect(speakB).resolves.toBe('accepted');
    await expect(speakA).resolves.toBe('accepted');
  });

  it('enabled greeting publishes and gates only its generated track, then flushes one local boundary before teardown', async () => {
    const raw = new FakeTrack('audio', true);
    const generated = new FakeTrack('audio', true);
    const video = new FakeTrack('video', true);
    const stream = new FakeMediaStream([raw, video]);
    getUserMediaImpl = async () => stream;
    const order: string[] = [];
    let localBoundary: (() => Promise<void>) | undefined;
    let destroyed = 0;
    const restoreRuntime = setGreetingInterruptionRuntimeImporterForTests(
      async () =>
        ({
          createLocalAudioPreRoll: async () => ({
            track: generated as unknown as MediaStreamTrack,
            startAutomaticTurn: async (preRollMs: number) => {
              order.push(`automatic:${preRollMs}`);
            },
            startManualTurn: async () => order.push('manual'),
            clear: async () => {},
            endTurn: async () => {},
            destroy: async () => {
              destroyed += 1;
            },
          }),
          createBrowserVad: async (options: { startTurn(): Promise<void> }) => {
            localBoundary = options.startTurn;
            return { destroy: async () => order.push('vad-destroy') };
          },
        }) as never,
    );
    const adapter = new OpenAIAdapter({
      mintToken: async () => fakeToken,
      greetingInterruption: { preRollMs: 37 },
      synthesizeGreeting: async () => new ArrayBuffer(8),
    });
    try {
      const channel = await connectAndOpen(adapter);
      adapter.activateAudio();
      const connection = FakeRTCPeerConnection.instances.at(-1)!;
      expect(connection.getSenders().map((sender) => sender.track)).toEqual([
        generated,
        video,
      ]);
      expect(adapter.getAudioStreams().mic).toBe(
        stream as unknown as MediaStream,
      );

      const speak = adapter.speakAssistantText({
        id: greetingId,
        text: greetingText,
        signal: new AbortController().signal,
      });
      await waitForGreetingCondition(
        () =>
          GreetingFakeAudioContext.instances.at(-1)?.sources.at(-1)?.started ===
            true && localBoundary !== undefined,
        'enabled greeting playback did not start',
      );
      expect([raw.enabled, generated.enabled]).toEqual([true, false]);
      await localBoundary?.();
      expect(
        GreetingFakeAudioContext.instances.at(-1)?.sources.at(-1)?.stopped,
      ).toBe(true);
      expect(order).toEqual(['automatic:37', 'vad-destroy']);
      expect(generated.enabled).toBe(true);
      expect(raw.enabled).toBe(true);
      await expect(speak).resolves.toBe('accepted');
      const frames = sentFrames(channel);
      expect(
        frames.filter((frame) => frame.type === 'conversation.item.create'),
      ).toHaveLength(1);
      expect(
        frames.filter((frame) => frame.type === 'response.create'),
      ).toHaveLength(0);
      await adapter.disconnect();
      expect(destroyed).toBe(1);
      expect(generated.stopCalls).toBe(0);
      expect(raw.stopCalls).toBe(1);
    } finally {
      restoreRuntime();
    }
  });

  it('enabled natural completion and Skip settle through the manual bridge path', async () => {
    const raw = new FakeTrack('audio', true);
    const generated = new FakeTrack('audio', true);
    const stream = new FakeMediaStream([raw]);
    getUserMediaImpl = async () => stream;
    const order: string[] = [];
    const restoreRuntime = setGreetingInterruptionRuntimeImporterForTests(
      async () =>
        ({
          createLocalAudioPreRoll: async () => ({
            track: generated as unknown as MediaStreamTrack,
            startAutomaticTurn: async () => order.push('automatic'),
            startManualTurn: async () => {
              order.push(`manual:${generated.enabled}`);
            },
            clear: async () => {},
            endTurn: async () => {},
            destroy: async () => {},
          }),
          createBrowserVad: async () => ({ destroy: async () => {} }),
        }) as never,
    );
    const adapter = new OpenAIAdapter({
      mintToken: async () => fakeToken,
      greetingInterruption: true,
      synthesizeGreeting: async () => new ArrayBuffer(8),
    });
    try {
      await connectAndOpen(adapter);
      adapter.activateAudio();
      const natural = adapter.speakAssistantText({
        id: greetingId,
        text: greetingText,
        signal: new AbortController().signal,
      });
      await waitForGreetingCondition(() => {
        const context = GreetingFakeAudioContext.instances.at(-1);
        return (
          context?.sources.length === 2 &&
          context.sources.at(-1)?.started === true
        );
      }, 'natural enabled greeting did not start');
      endLatestPlayback();
      await expect(natural).resolves.toBe('accepted');
      expect(order).toEqual(['manual:false']);
      expect(generated.enabled).toBe(true);

      const skip = new AbortController();
      const skipped = adapter.speakAssistantText({
        id: MessageId('greeting:skip'),
        text: greetingText,
        signal: skip.signal,
      });
      await waitForGreetingCondition(() => {
        const context = GreetingFakeAudioContext.instances.at(-1);
        return (
          context?.sources.length === 3 &&
          context.sources.at(-1)?.started === true
        );
      }, 'Skip enabled greeting did not start');
      skip.abort();
      await expect(skipped).resolves.toBe('accepted');
      expect(order).toEqual(['manual:false', 'manual:false']);
      expect([raw.enabled, generated.enabled]).toEqual([true, true]);
    } finally {
      restoreRuntime();
    }
  });

  it('preserves immediate and transcript-confirmed arbitration after enabled greeting settlement', async () => {
    const generated = new FakeTrack('audio', true);
    const restoreRuntime = setGreetingInterruptionRuntimeImporterForTests(
      async () =>
        ({
          createLocalAudioPreRoll: async () => ({
            track: generated as unknown as MediaStreamTrack,
            startAutomaticTurn: async () => {},
            startManualTurn: async () => {},
            clear: async () => {},
            endTurn: async () => {},
            destroy: async () => {},
          }),
          createBrowserVad: async () => ({ destroy: async () => {} }),
        }) as never,
    );
    async function settleEnabledGreeting(
      adapter: OpenAIAdapter,
    ): Promise<void> {
      adapter.activateAudio();
      const speak = adapter.speakAssistantText({
        id: greetingId,
        text: greetingText,
        signal: new AbortController().signal,
      });
      await waitForGreetingCondition(() => {
        const context = GreetingFakeAudioContext.instances.at(-1);
        return (
          (context?.sources.length ?? 0) >= 2 &&
          context?.sources.at(-1)?.started === true
        );
      }, 'enabled greeting playback did not start');
      endLatestPlayback();
      await expect(speak).resolves.toBe('accepted');
    }
    try {
      const immediate = new OpenAIAdapter({
        mintToken: async () => fakeToken,
        greetingInterruption: true,
        synthesizeGreeting: async () => new ArrayBuffer(8),
      });
      const immediateChannel = await connectAndOpen(immediate);
      const immediateEvents: string[] = [];
      immediate.on((event) => immediateEvents.push(event.type));
      await settleEnabledGreeting(immediate);
      immediateChannel.sent.length = 0;
      immediateChannel.receive({
        type: 'response.created',
        response: { id: 'immediate-r1' },
      });
      immediateChannel.receive({ type: 'output_audio_buffer.started' });
      immediateChannel.receive({ type: 'input_audio_buffer.speech_started' });
      expect(sentFrames(immediateChannel)).toEqual([]);
      expect(immediateEvents).toContain('speech_started');
      expect(immediateEvents).not.toContain('turn_mode');
      expect(
        (immediate as { turnControl?: unknown }).turnControl,
      ).toBeUndefined();

      const confirmed = new OpenAIAdapter({
        mintToken: async () => fakeToken,
        greetingInterruption: true,
        serverVad: { bargeInMode: 'transcript-confirmed' },
        synthesizeGreeting: async () => new ArrayBuffer(8),
      });
      const confirmedChannel = await connectAndOpen(confirmed);
      const confirmedEvents: string[] = [];
      confirmed.on((event) => confirmedEvents.push(event.type));
      await settleEnabledGreeting(confirmed);
      confirmedChannel.sent.length = 0;
      confirmedChannel.receive({
        type: 'input_audio_buffer.committed',
        item_id: 'post-greeting-item',
      });
      confirmedChannel.receive({
        type: 'conversation.item.input_audio_transcription.completed',
        item_id: 'post-greeting-item',
        transcript: 'hello after greeting',
      });
      expect(sentFrames(confirmedChannel)).toEqual([
        { type: 'response.create' },
      ]);
      expect(confirmedEvents).not.toContain('turn_mode');
      expect(
        (confirmed as { turnControl?: unknown }).turnControl,
      ).toBeUndefined();
    } finally {
      restoreRuntime();
    }
  });

  it('loader rejection connects with raw gated greeting and never uses the runtime factories', async () => {
    const raw = new FakeTrack('audio', true);
    const stream = new FakeMediaStream([raw]);
    getUserMediaImpl = async () => stream;
    const bridgeCreates = 0;
    const vadCreates = 0;
    const restoreRuntime = setGreetingInterruptionRuntimeImporterForTests(
      async () => {
        throw new Error('chunk missing');
      },
    );
    const adapter = new OpenAIAdapter({
      mintToken: async () => fakeToken,
      greetingInterruption: true,
      synthesizeGreeting: async () => new ArrayBuffer(8),
    });
    try {
      const channel = await connectAndOpen(adapter);
      const connection = FakeRTCPeerConnection.instances.at(-1)!;
      expect(connection.getSenders().map((sender) => sender.track)).toEqual([
        raw,
      ]);
      expect(adapter.getAudioStreams().mic).toBe(
        stream as unknown as MediaStream,
      );
      adapter.activateAudio();
      const skip = new AbortController();
      const speak = adapter.speakAssistantText({
        id: greetingId,
        text: greetingText,
        signal: skip.signal,
      });
      await waitForGreetingCondition(
        () => raw.enabled === false,
        'raw greeting gate did not engage',
      );
      skip.abort();
      await expect(speak).resolves.toBe('accepted');
      expect(raw.enabled).toBe(true);
      expect(bridgeCreates).toBe(0);
      expect(vadCreates).toBe(0);
      expect(
        sentFrames(channel).filter((frame) => frame.type === 'response.create'),
      ).toHaveLength(0);
    } finally {
      restoreRuntime();
    }
  });

  it('bridge creation rejection still connects and publishes raw', async () => {
    const raw = new FakeTrack('audio', true);
    const stream = new FakeMediaStream([raw]);
    getUserMediaImpl = async () => stream;
    const restoreRuntime = setGreetingInterruptionRuntimeImporterForTests(
      async () =>
        ({
          createLocalAudioPreRoll: async () => {
            throw new Error('worklet missing');
          },
          createBrowserVad: async () => {
            throw new Error('must not create vad');
          },
        }) as never,
    );
    const adapter = new OpenAIAdapter({
      mintToken: async () => fakeToken,
      greetingInterruption: true,
    });
    try {
      await connectAndOpen(adapter);
      const connection = FakeRTCPeerConnection.instances.at(-1)!;
      expect(connection.getSenders().map((sender) => sender.track)).toEqual([
        raw,
      ]);
    } finally {
      restoreRuntime();
    }
  });

  it('post-attachment VAD setup failure replaces generated with gated raw and keeps voice connected', async () => {
    const raw = new FakeTrack('audio', true);
    const generated = new FakeTrack('audio', true);
    const stream = new FakeMediaStream([raw]);
    getUserMediaImpl = async () => stream;
    const restoreRuntime = setGreetingInterruptionRuntimeImporterForTests(
      async () =>
        ({
          createLocalAudioPreRoll: async () => ({
            track: generated as unknown as MediaStreamTrack,
            startAutomaticTurn: async () => {},
            startManualTurn: async () => {},
            clear: async () => {},
            endTurn: async () => {},
            destroy: async () => {},
          }),
          createBrowserVad: async () => {
            throw new Error('vad start');
          },
        }) as never,
    );
    const adapter = new OpenAIAdapter({
      mintToken: async () => fakeToken,
      greetingInterruption: true,
      synthesizeGreeting: async () => new ArrayBuffer(8),
    });
    const events: string[] = [];
    adapter.on((event) => events.push(event.type));
    try {
      await connectAndOpen(adapter);
      const connection = FakeRTCPeerConnection.instances.at(-1)!;
      connection.replaceTrackImpl = async (sender, track) => {
        sender.track = track as unknown as FakeTrack;
      };
      adapter.activateAudio();
      const speak = adapter.speakAssistantText({
        id: greetingId,
        text: greetingText,
        signal: new AbortController().signal,
      });
      await waitForGreetingCondition(() => {
        const context = GreetingFakeAudioContext.instances.at(-1);
        return (
          (context?.sources.length ?? 0) >= 2 &&
          context?.sources.at(-1)?.started === true
        );
      }, 'enabled greeting playback did not start');
      await waitForGreetingCondition(
        () => connection.getSenders()[0]?.track === raw,
        'generated publication was not replaced',
      );
      expect(raw.enabled).toBe(false);
      expect(connection.getSenders()[0]?.replaceTrackCalls).toBe(1);
      expect(
        (adapter as { turnControl?: unknown }).turnControl,
      ).toBeUndefined();
      expect(events).not.toContain('turn_mode');
      endLatestPlayback();
      await expect(speak).resolves.toBe('accepted');
      expect(raw.enabled).toBe(true);
    } finally {
      restoreRuntime();
    }
  });

  it('failed replaceTrack stays gated and emits CONNECTION_FAILED', async () => {
    const raw = new FakeTrack('audio', true);
    const generated = new FakeTrack('audio', true);
    const stream = new FakeMediaStream([raw]);
    getUserMediaImpl = async () => stream;
    const restoreRuntime = setGreetingInterruptionRuntimeImporterForTests(
      async () =>
        ({
          createLocalAudioPreRoll: async () => ({
            track: generated as unknown as MediaStreamTrack,
            startAutomaticTurn: async () => {},
            startManualTurn: async () => {
              throw new Error('ack timeout');
            },
            clear: async () => {},
            endTurn: async () => {},
            destroy: async () => {},
          }),
          createBrowserVad: async () => ({ destroy: async () => {} }),
        }) as never,
    );
    const adapter = new OpenAIAdapter({
      mintToken: async () => fakeToken,
      greetingInterruption: true,
      synthesizeGreeting: async () => new ArrayBuffer(8),
    });
    const errors: unknown[] = [];
    adapter.on((event) => {
      if (event.type === 'error') errors.push(event.error);
    });
    try {
      await connectAndOpen(adapter);
      adapter.activateAudio();
      const speak = adapter.speakAssistantText({
        id: greetingId,
        text: greetingText,
        signal: new AbortController().signal,
      });
      await waitForGreetingCondition(() => {
        const context = GreetingFakeAudioContext.instances.at(-1);
        return (
          (context?.sources.length ?? 0) >= 2 &&
          context?.sources.at(-1)?.started === true
        );
      }, 'enabled greeting playback did not start');
      endLatestPlayback();
      await expect(speak).resolves.toBe('accepted');
      expect(raw.enabled).toBe(false);
      expect(generated.enabled).toBe(false);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toBeInstanceOf(RealtimeVoiceError);
      expect((errors[0] as RealtimeVoiceError).code).toBe('CONNECTION_FAILED');
      expect((errors[0] as RealtimeVoiceError).message).toBe(
        'Failed to restore the OpenAI microphone publication',
      );
      await adapter.disconnect();
      expect(raw.stopCalls).toBe(1);
    } finally {
      restoreRuntime();
    }
  });

  it('automatic and manual start failures recover through replaceTrack without a second pre-roll', async () => {
    const raw = new FakeTrack('audio', true);
    const generated = new FakeTrack('audio', true);
    const stream = new FakeMediaStream([raw]);
    getUserMediaImpl = async () => stream;
    let automatic = 0;
    let localBoundary: (() => Promise<void>) | undefined;
    const restoreRuntime = setGreetingInterruptionRuntimeImporterForTests(
      async () =>
        ({
          createLocalAudioPreRoll: async () => ({
            track: generated as unknown as MediaStreamTrack,
            startAutomaticTurn: async () => {
              automatic += 1;
              throw new Error('ack timeout');
            },
            startManualTurn: async () => {
              throw new Error('ack timeout');
            },
            clear: async () => {},
            endTurn: async () => {},
            destroy: async () => {},
          }),
          createBrowserVad: async (options: { startTurn(): Promise<void> }) => {
            localBoundary = options.startTurn;
            return { destroy: async () => {} };
          },
        }) as never,
    );
    const adapter = new OpenAIAdapter({
      mintToken: async () => fakeToken,
      greetingInterruption: true,
      synthesizeGreeting: async () => new ArrayBuffer(8),
    });
    try {
      await connectAndOpen(adapter);
      const connection = FakeRTCPeerConnection.instances.at(-1)!;
      connection.replaceTrackImpl = async (sender, track) => {
        sender.track = track as unknown as FakeTrack;
      };
      adapter.activateAudio();
      const speak = adapter.speakAssistantText({
        id: greetingId,
        text: greetingText,
        signal: new AbortController().signal,
      });
      await waitForGreetingCondition(
        () => localBoundary !== undefined,
        'enabled greeting VAD did not arm',
      );
      await localBoundary?.();
      await expect(speak).resolves.toBe('accepted');
      expect(automatic).toBe(1);
      expect(connection.getSenders()[0]?.track).toBe(raw);
      expect(connection.getSenders()[0]?.replaceTrackCalls).toBe(1);
      await localBoundary?.();
      expect(automatic).toBe(1);
      expect(connection.getSenders()[0]?.replaceTrackCalls).toBe(1);
    } finally {
      restoreRuntime();
    }
  });

  it('delayed prepare after disconnect destroys the late bridge and does not attach it', async () => {
    const raw = new FakeTrack('audio', true);
    const generated = new FakeTrack('audio', true);
    const stream = new FakeMediaStream([raw]);
    getUserMediaImpl = async () => stream;
    let resolveBridge:
      | ((value: {
          track: MediaStreamTrack;
          startAutomaticTurn(): Promise<void>;
          startManualTurn(): Promise<void>;
          clear(): Promise<void>;
          endTurn(): Promise<void>;
          destroy(): Promise<void>;
        }) => void)
      | undefined;
    let destroyed = 0;
    const restoreRuntime = setGreetingInterruptionRuntimeImporterForTests(
      async () =>
        ({
          createLocalAudioPreRoll: () =>
            new Promise((resolve) => {
              resolveBridge = resolve;
            }),
          createBrowserVad: async () => ({ destroy: async () => {} }),
        }) as never,
    );
    const adapter = new OpenAIAdapter({
      mintToken: async () => fakeToken,
      greetingInterruption: true,
    });
    try {
      const connecting = adapter.connect(connectOpts);
      await waitForGreetingCondition(
        () => resolveBridge !== undefined,
        'enabled prepare did not reach bridge creation',
      );
      await adapter.disconnect();
      resolveBridge?.({
        track: generated as unknown as MediaStreamTrack,
        startAutomaticTurn: async () => {},
        startManualTurn: async () => {},
        clear: async () => {},
        endTurn: async () => {},
        destroy: async () => {
          destroyed += 1;
        },
      });
      await expect(connecting).rejects.toBeInstanceOf(RealtimeVoiceError);
      expect(destroyed).toBe(1);
      expect(
        FakeRTCPeerConnection.instances
          .at(-1)
          ?.getSenders()
          .map((sender) => sender.track),
      ).not.toContain(generated);
    } finally {
      restoreRuntime();
    }
  });

  it('reconnect ignores delayed prior-generation replace work', async () => {
    const firstGenerated = new FakeTrack('audio', true);
    const secondGenerated = new FakeTrack('audio', true);
    const firstRaw = new FakeTrack('audio', true);
    const secondRaw = new FakeTrack('audio', true);
    const streams = [
      new FakeMediaStream([firstRaw]),
      new FakeMediaStream([secondRaw]),
    ];
    let mediaCall = 0;
    getUserMediaImpl = async () => streams[mediaCall++]!;
    let creates = 0;
    const restoreRuntime = setGreetingInterruptionRuntimeImporterForTests(
      async () =>
        ({
          createLocalAudioPreRoll: async () => ({
            track: (creates++ === 0
              ? firstGenerated
              : secondGenerated) as unknown as MediaStreamTrack,
            startAutomaticTurn: async () => {},
            startManualTurn: async () => {},
            clear: async () => {},
            endTurn: async () => {},
            destroy: async () => {},
          }),
          createBrowserVad: async () => {
            throw new Error('vad start');
          },
        }) as never,
    );
    const adapter = new OpenAIAdapter({
      mintToken: async () => fakeToken,
      greetingInterruption: true,
      synthesizeGreeting: async () => new ArrayBuffer(8),
    });
    try {
      await connectAndOpen(adapter);
      const first = FakeRTCPeerConnection.instances.at(-1)!;
      first.replaceTrackImpl = async (sender, track) => {
        sender.track = track as unknown as FakeTrack;
      };
      await adapter.disconnect();
      await connectAndOpen(adapter);
      const second = FakeRTCPeerConnection.instances.at(-1)!;
      second.replaceTrackImpl = async (sender, track) => {
        sender.track = track as unknown as FakeTrack;
      };
      expect(second.getSenders()[0]?.track).toBe(secondGenerated);
      expect(second.getSenders()[0]?.replaceTrackCalls).toBe(0);
    } finally {
      restoreRuntime();
    }
  });

  it('publishes the raw microphone when reconnect has no pending greeting', async () => {
    const raw = new FakeTrack('audio', true);
    const generated = new FakeTrack('audio', true);
    getUserMediaImpl = async () => new FakeMediaStream([raw]);
    let bridgeCreates = 0;
    const restoreRuntime = setGreetingInterruptionRuntimeImporterForTests(
      async () =>
        ({
          createLocalAudioPreRoll: async () => {
            bridgeCreates += 1;
            return {
              track: generated as unknown as MediaStreamTrack,
              startAutomaticTurn: async () => {},
              startManualTurn: async () => {},
              clear: async () => {},
              endTurn: async () => {},
              destroy: async () => {},
            };
          },
          createBrowserVad: async () => ({ destroy: async () => {} }),
        }) as never,
    );
    const adapter = new OpenAIAdapter({
      mintToken: async () => fakeToken,
      greetingInterruption: true,
      synthesizeGreeting: async () => new ArrayBuffer(8),
    });

    try {
      const previousChannel =
        FakeRTCPeerConnection.instances.at(-1)?.dataChannel;
      const connecting = adapter.connect({
        ...connectOpts,
        prepareGreeting: false,
      });
      const channel = await latestDataChannel(previousChannel);
      channel.triggerOpen();
      await connecting;

      const connection = FakeRTCPeerConnection.instances.at(-1)!;
      expect(connection.getSenders()[0]?.track).toBe(raw);
      expect(bridgeCreates).toBe(0);
    } finally {
      restoreRuntime();
    }
  });

  it('Skip versus local acceptance produces exactly one terminal publication', async () => {
    const raw = new FakeTrack('audio', true);
    const generated = new FakeTrack('audio', true);
    const stream = new FakeMediaStream([raw]);
    getUserMediaImpl = async () => stream;
    const order: string[] = [];
    let localBoundary: (() => Promise<void>) | undefined;
    const restoreRuntime = setGreetingInterruptionRuntimeImporterForTests(
      async () =>
        ({
          createLocalAudioPreRoll: async () => ({
            track: generated as unknown as MediaStreamTrack,
            startAutomaticTurn: async () => order.push('automatic'),
            startManualTurn: async () => order.push('manual'),
            clear: async () => {},
            endTurn: async () => {},
            destroy: async () => {},
          }),
          createBrowserVad: async (options: { startTurn(): Promise<void> }) => {
            localBoundary = options.startTurn;
            return { destroy: async () => {} };
          },
        }) as never,
    );
    const adapter = new OpenAIAdapter({
      mintToken: async () => fakeToken,
      greetingInterruption: true,
      synthesizeGreeting: async () => new ArrayBuffer(8),
    });
    try {
      await connectAndOpen(adapter);
      adapter.activateAudio();
      const skip = new AbortController();
      const speak = adapter.speakAssistantText({
        id: greetingId,
        text: greetingText,
        signal: skip.signal,
      });
      await waitForGreetingCondition(
        () => localBoundary !== undefined,
        'enabled greeting VAD did not arm',
      );
      const accepted = localBoundary?.();
      skip.abort();
      await accepted;
      await expect(speak).resolves.toBe('accepted');
      expect(order).toHaveLength(1);
      expect(['automatic', 'manual']).toContain(order[0]);
    } finally {
      restoreRuntime();
    }
  });

  it('playback end versus disconnect stops raw once and does not leak generated resources', async () => {
    const raw = new FakeTrack('audio', true);
    const generated = new FakeTrack('audio', true);
    const stream = new FakeMediaStream([raw]);
    getUserMediaImpl = async () => stream;
    let destroyed = 0;
    const restoreRuntime = setGreetingInterruptionRuntimeImporterForTests(
      async () =>
        ({
          createLocalAudioPreRoll: async () => ({
            track: generated as unknown as MediaStreamTrack,
            startAutomaticTurn: async () => {},
            startManualTurn: async () => {},
            clear: async () => {},
            endTurn: async () => {},
            destroy: async () => {
              destroyed += 1;
            },
          }),
          createBrowserVad: async () => ({ destroy: async () => {} }),
        }) as never,
    );
    const adapter = new OpenAIAdapter({
      mintToken: async () => fakeToken,
      greetingInterruption: true,
      synthesizeGreeting: async () => new ArrayBuffer(8),
    });
    try {
      await connectAndOpen(adapter);
      adapter.activateAudio();
      const speak = adapter.speakAssistantText({
        id: greetingId,
        text: greetingText,
        signal: new AbortController().signal,
      });
      await waitForGreetingCondition(() => {
        const context = GreetingFakeAudioContext.instances.at(-1);
        return (
          (context?.sources.length ?? 0) >= 2 &&
          context?.sources.at(-1)?.started === true
        );
      }, 'enabled greeting playback did not start');
      endLatestPlayback();
      await adapter.disconnect();
      await expect(speak).resolves.toBe('accepted');
      expect(raw.stopCalls).toBe(1);
      expect(generated.stopCalls).toBe(0);
      expect(destroyed).toBe(1);
    } finally {
      restoreRuntime();
    }
  });

  it('after recovery, barge-in arbitration is unchanged and later events do not flush again', async () => {
    const generated = new FakeTrack('audio', true);
    const restoreRuntime = setGreetingInterruptionRuntimeImporterForTests(
      async () =>
        ({
          createLocalAudioPreRoll: async () => ({
            track: generated as unknown as MediaStreamTrack,
            startAutomaticTurn: async () => {
              throw new Error('must not flush after recovery');
            },
            startManualTurn: async () => {},
            clear: async () => {},
            endTurn: async () => {},
            destroy: async () => {},
          }),
          createBrowserVad: async () => {
            throw new Error('vad start');
          },
        }) as never,
    );
    async function recoverEnabledGreeting(
      bargeInMode: 'immediate' | 'transcript-confirmed',
    ): Promise<{ adapter: OpenAIAdapter; channel: FakeDataChannel }> {
      const adapter = new OpenAIAdapter({
        mintToken: async () => fakeToken,
        greetingInterruption: true,
        serverVad: { bargeInMode },
        synthesizeGreeting: async () => new ArrayBuffer(8),
      });
      const channel = await connectAndOpen(adapter);
      FakeRTCPeerConnection.instances.at(-1)!.replaceTrackImpl = async (
        sender,
        track,
      ) => {
        sender.track = track as unknown as FakeTrack;
      };
      adapter.activateAudio();
      const speak = adapter.speakAssistantText({
        id: greetingId,
        text: greetingText,
        signal: new AbortController().signal,
      });
      await waitForGreetingCondition(() => {
        const context = GreetingFakeAudioContext.instances.at(-1);
        return (
          (context?.sources.length ?? 0) >= 2 &&
          context?.sources.at(-1)?.started === true
        );
      }, 'enabled greeting playback did not start');
      endLatestPlayback();
      await expect(speak).resolves.toBe('accepted');
      return { adapter, channel };
    }
    try {
      const immediate = await recoverEnabledGreeting('immediate');
      const immediateEvents: string[] = [];
      immediate.adapter.on((event) => immediateEvents.push(event.type));
      immediate.channel.sent.length = 0;
      immediate.channel.receive({
        type: 'response.created',
        response: { id: 'post-recovery-r1' },
      });
      immediate.channel.receive({ type: 'output_audio_buffer.started' });
      immediate.channel.receive({ type: 'input_audio_buffer.speech_started' });
      expect(sentFrames(immediate.channel)).toEqual([]);
      expect(immediateEvents).toContain('speech_started');
      expect(immediateEvents).not.toContain('turn_mode');
      expect(
        (immediate.adapter as { turnControl?: unknown }).turnControl,
      ).toBeUndefined();

      const confirmed = await recoverEnabledGreeting('transcript-confirmed');
      const confirmedEvents: string[] = [];
      confirmed.adapter.on((event) => confirmedEvents.push(event.type));
      confirmed.channel.sent.length = 0;
      confirmed.channel.receive({
        type: 'conversation.item.input_audio_transcription.delta',
        item_id: 'post-recovery-item',
        delta: 'hello',
      });
      confirmed.channel.receive({
        type: 'input_audio_buffer.committed',
        item_id: 'post-recovery-item',
      });
      confirmed.channel.receive({
        type: 'conversation.item.input_audio_transcription.completed',
        item_id: 'post-recovery-item',
        transcript: 'hello after recovery',
      });
      expect(sentFrames(confirmed.channel)).toEqual([
        { type: 'response.create' },
      ]);
      expect(confirmedEvents).not.toContain('turn_mode');
    } finally {
      restoreRuntime();
    }
  });

  it('in-flight generation-N replace cannot mutate a reconnected generation N+1 sender', async () => {
    const firstGenerated = new FakeTrack('audio', true);
    const secondGenerated = new FakeTrack('audio', true);
    const firstRaw = new FakeTrack('audio', true);
    const secondRaw = new FakeTrack('audio', true);
    const streams = [
      new FakeMediaStream([firstRaw]),
      new FakeMediaStream([secondRaw]),
    ];
    let mediaCall = 0;
    getUserMediaImpl = async () => streams[mediaCall++]!;
    let creates = 0;
    let resolveFirstReplace: (() => void) | undefined;
    const restoreRuntime = setGreetingInterruptionRuntimeImporterForTests(
      async () =>
        ({
          createLocalAudioPreRoll: async () => ({
            track: (creates++ === 0
              ? firstGenerated
              : secondGenerated) as unknown as MediaStreamTrack,
            startAutomaticTurn: async () => {},
            startManualTurn: async () => {},
            clear: async () => {},
            endTurn: async () => {},
            destroy: async () => {},
          }),
          createBrowserVad: async () => {
            throw new Error('vad start');
          },
        }) as never,
    );
    const adapter = new OpenAIAdapter({
      mintToken: async () => fakeToken,
      greetingInterruption: true,
      synthesizeGreeting: async () => new ArrayBuffer(8),
    });
    try {
      await connectAndOpen(adapter);
      const first = FakeRTCPeerConnection.instances.at(-1)!;
      first.replaceTrackImpl = async (sender, track) => {
        await new Promise<void>((resolve) => {
          resolveFirstReplace = resolve;
        });
        sender.track = track as unknown as FakeTrack;
      };
      adapter.activateAudio();
      const speak = adapter.speakAssistantText({
        id: greetingId,
        text: greetingText,
        signal: new AbortController().signal,
      });
      await waitForGreetingCondition(() => {
        const context = GreetingFakeAudioContext.instances.at(-1);
        return (
          (context?.sources.length ?? 0) >= 2 &&
          context?.sources.at(-1)?.started === true
        );
      }, 'generation-N greeting playback did not start');
      await waitForGreetingCondition(
        () => resolveFirstReplace !== undefined,
        'generation-N replace did not start',
      );
      const disconnecting = adapter.disconnect();
      resolveFirstReplace?.();
      await disconnecting;
      await expect(speak).resolves.toBe('accepted');
      await connectAndOpen(adapter);
      const second = FakeRTCPeerConnection.instances.at(-1)!;
      second.replaceTrackImpl = async (sender, track) => {
        sender.track = track as unknown as FakeTrack;
      };
      expect(second.getSenders()[0]?.track).toBe(secondGenerated);
      resolveFirstReplace?.();
      await Promise.resolve();
      await Promise.resolve();
      expect(second.getSenders()[0]?.track).toBe(secondGenerated);
      expect(second.getSenders()[0]?.replaceTrackCalls).toBe(0);
      expect(first.getSenders()[0]?.track).toBe(firstRaw);
    } finally {
      restoreRuntime();
    }
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

  it('orders Engine ack → exact provider item → TTS → playback caption without provider ack or response.create', async () => {
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

    expect(order).toEqual(['engine-ack', 'provider-item', 'tts', 'caption']);

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

describe('OpenAIAdapter: transcript observations', () => {
  function observe(adapter: OpenAIAdapter) {
    const fragments: TimedTranscriptFragment[] = [];
    adapter.observations.subscribe((event) => {
      if (event.type === 'fragment') fragments.push(event.fragment);
    });
    return fragments;
  }

  it('revises one fragment per item and replaces it with the full text on the final event', async () => {
    const { adapter, channel } = await connectWithChannel();
    const fragments = observe(adapter);

    channel.receive({
      type: 'response.output_audio_transcript.delta',
      item_id: 'item_a',
      delta: 'Pulling ',
    });
    channel.receive({
      type: 'response.output_audio_transcript.delta',
      item_id: 'item_a',
      delta: 'that up',
    });
    channel.receive({
      type: 'response.output_audio_transcript.done',
      item_id: 'item_a',
      transcript: 'Pulling that up.',
    });

    expect(
      fragments.map(({ id, text, final }) => ({ id, text, final })),
    ).toEqual([
      { id: 'item_a', text: 'Pulling ', final: undefined },
      { id: 'item_a', text: 'Pulling that up', final: undefined },
      { id: 'item_a', text: 'Pulling that up.', final: true },
    ]);
    const [first, , last] = fragments;
    expect(last?.role).toBe('assistant');
    expect(last?.speakerId).toBe('assistant');
    expect(last?.startMs).toBe(first?.startMs ?? Number.NaN);
    expect(last?.endMs).toBeGreaterThanOrEqual(last?.startMs ?? 0);
  });

  it('observes user transcription deltas and completion under the input item id', async () => {
    const { adapter, channel } = await connectWithChannel();
    const fragments = observe(adapter);

    channel.receive({
      type: 'conversation.item.input_audio_transcription.delta',
      item_id: 'item_u',
      delta: 'show ',
    });
    channel.receive({
      type: 'conversation.item.input_audio_transcription.completed',
      item_id: 'item_u',
      transcript: 'Show my labs.',
    });

    expect(fragments.at(-1)).toMatchObject({
      id: 'item_u',
      role: 'user',
      text: 'Show my labs.',
      final: true,
    });
    expect(fragments).toHaveLength(2);
  });

  it('keeps the legacy transcript event alongside the observation', async () => {
    const { adapter, channel } = await connectWithChannel();
    const legacy: unknown[] = [];
    adapter.on((event) => {
      if (event.type === 'transcript') legacy.push(event);
    });
    observe(adapter);

    channel.receive({
      type: 'response.output_audio_transcript.done',
      item_id: 'item_a',
      transcript: 'Done.',
    });

    expect(legacy).toEqual([
      { type: 'transcript', role: 'assistant', text: 'Done.', final: true },
    ]);
  });

  it('reports no media evidence and skips transcripts without an item id', async () => {
    const { adapter, channel } = await connectWithChannel();
    const events: unknown[] = [];
    adapter.observations.subscribe((event) => events.push(event));

    channel.receive({ type: 'input_audio_buffer.speech_started' });
    channel.receive({ type: 'output_audio_buffer.started' });
    channel.receive({
      type: 'response.output_audio_transcript.delta',
      delta: 'no item',
    });

    expect(events).toEqual([]);
  });

  it('starts a fresh item timeline on reconnect and drops the old channel', async () => {
    const adapter = new OpenAIAdapter({ mintToken: async () => fakeToken });
    const fragments = observe(adapter);
    const first = await connectAndOpen(adapter);
    first.receive({
      type: 'conversation.item.input_audio_transcription.delta',
      item_id: 'item_x',
      delta: 'old',
    });
    await adapter.disconnect();
    const second = await connectAndOpen(adapter);
    first.receive({
      type: 'conversation.item.input_audio_transcription.delta',
      item_id: 'item_x',
      delta: ' stale',
    });
    second.receive({
      type: 'conversation.item.input_audio_transcription.delta',
      item_id: 'item_x',
      delta: 'new',
    });

    expect(fragments.map((fragment) => fragment.text)).toEqual(['old', 'new']);
  });
});
