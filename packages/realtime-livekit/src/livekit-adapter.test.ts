import { beforeEach, describe, expect, mock, spyOn, test } from 'bun:test';
import type { RealtimeAdapterEvent, UnixSeconds } from '@maelstrom-co/realtime';
import { RealtimeVoiceError } from '@maelstrom-co/realtime';
import './__tests__/setup.js';
import type { LiveKitAdapterOptions } from './livekit-adapter.types.js';
import type { LiveKitTokenGrant } from './livekit-token.js';
import type { LocalAudioPreRoll } from './local-audio-pre-roll.js';

// --- Mocks for livekit-client ---

const mockRoomConnect = mock(async () => {});
const mockRoomDisconnect = mock(async () => {});
const mockPublishData = mock(async () => {});
const mockSendText = mock(async (_text: string, _opts?: unknown) => ({}));
const mockStartAudio = mock(async () => {});
const mockPauseUpstream = mock(async () => {});
const mockResumeUpstream = mock(async () => {});
const mockReplaceTrack = mock(async () => {});
const mockMuteLocalMic = mock(async () => {});
const mockUnmuteLocalMic = mock(async () => {});
const mockCreateLocalAudioTrack = mock(async () => mockMicPublication.track);
const mockPublishTrack = mock(async (_track: unknown) => mockMicPublication);
const mockBridgeStartAutomaticTurn = mock(async (_preRollMs: number) => {});
const mockBridgeStartManualTurn = mock(async () => {});
const mockBridgeEndTurn = mock(async () => {});
const mockBridgeDestroy = mock(async () => {});
const mockVadStart = mock(async () => {});
const mockVadPause = mock(async () => {});
const mockVadDestroy = mock(async () => {});
const capturedVadOptions: Record<string, unknown>[] = [];
const mockMicVADNew = mock(async (options?: Record<string, unknown>) => {
  capturedVadOptions.push(options ?? {});
  return {
    start: mockVadStart,
    pause: mockVadPause,
    destroy: mockVadDestroy,
  };
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}
const mockGeneratedTrack = {
  enabled: true,
  stop: mock(() => {}),
} as unknown as MediaStreamTrack;
const mockBridge = {
  track: mockGeneratedTrack,
  startAutomaticTurn: mockBridgeStartAutomaticTurn,
  startManualTurn: mockBridgeStartManualTurn,
  endTurn: mockBridgeEndTurn,
  destroy: mockBridgeDestroy,
};
const mockCreateLocalAudioPreRoll = mock<() => Promise<LocalAudioPreRoll>>(
  async () => {
    throw new Error('AudioWorklet unavailable');
  },
);

// A live mic publication, returned by getTrackPublication(Source.Microphone).
// The publication and its clone intentionally have independent enabled state:
// LiveKit mutes the former between turns, while VAD must read the latter.
const mockPublishedMicTrack = {
  enabled: false,
  clone: mock(() => mockMicCloneTrack),
  stop: mock(() => {}),
};
const mockMicCloneTrack = {
  enabled: false,
  stop: mock(() => {}),
};
const mockSetMicrophoneEnabled = mock(async (enabled: boolean) => {
  mockPublishedMicTrack.enabled = enabled;
});
const mockMicPublication = {
  track: {
    isMuted: false,
    mediaStream: { id: 'published-mic-stream' } as unknown as MediaStream,
    mediaStreamTrack: mockPublishedMicTrack as unknown as MediaStreamTrack,
    mute: mockMuteLocalMic,
    unmute: mockUnmuteLocalMic,
    stop: mockPublishedMicTrack.stop,
    pauseUpstream: mockPauseUpstream,
    resumeUpstream: mockResumeUpstream,
    replaceTrack: mockReplaceTrack,
  },
};

class TestMediaStream {
  constructor(readonly tracks: MediaStreamTrack[]) {}

  getAudioTracks(): MediaStreamTrack[] {
    return this.tracks;
  }
}

globalThis.MediaStream = TestMediaStream as unknown as typeof MediaStream;

const mockLocalParticipant = {
  setMicrophoneEnabled: mockSetMicrophoneEnabled,
  publishTrack: mockPublishTrack,
  publishData: mockPublishData,
  sendText: mockSendText,
  startAudio: mockStartAudio,
  getTrackPublication: mock((_source: string) => mockMicPublication),
};

function makeMockRoom() {
  const handlers: Record<string, ((...args: unknown[]) => void)[]> = {};
  return {
    on: mock((event: string, handler: (...args: unknown[]) => void) => {
      if (!handlers[event]) handlers[event] = [];
      handlers[event].push(handler);
    }),
    off: mock(() => {}),
    connect: mockRoomConnect,
    disconnect: mockRoomDisconnect,
    startAudio: mockStartAudio,
    localParticipant: mockLocalParticipant,
    _emit: (event: string, ...args: unknown[]) => {
      handlers[event]?.forEach((h) => {
        h(...args);
      });
    },
  };
}

let currentRoom = makeMockRoom();

mock.module('livekit-client', () => ({
  createLocalAudioTrack: mockCreateLocalAudioTrack,
  Room: class {
    on = currentRoom.on;
    off = currentRoom.off;
    connect = currentRoom.connect;
    disconnect = currentRoom.disconnect;
    startAudio = currentRoom.startAudio;
    localParticipant = currentRoom.localParticipant;
  },
  RoomEvent: {
    TranscriptionReceived: 'transcriptionReceived',
    Disconnected: 'disconnected',
    TrackSubscribed: 'trackSubscribed',
    DataReceived: 'dataReceived',
  },
  Track: { Kind: { Audio: 'audio' }, Source: { Microphone: 'microphone' } },
  setLogLevel: mock(() => {}),
}));

mock.module('./local-audio-pre-roll.js', () => ({
  createLocalAudioPreRoll: mockCreateLocalAudioPreRoll,
}));

mock.module('@ricky0123/vad-web', () => ({
  MicVAD: { new: mockMicVADNew },
}));

const { LiveKitAdapter } = await import('./livekit-adapter');
const { SPEAK_TOPIC, SPEAK_UTTERANCE_ID_ATTR, TURN_TOPIC, TTS_TOPIC } =
  await import('./protocol');

// The utterance id the client stamped on the most recent speak text stream — the
// worker echoes this on its TTS status packets, so tests read it back to forge a
// matching (current) or mismatching (stale) status.
function lastUtteranceId(): number {
  const opts = mockSendText.mock.calls.at(-1)?.[1] as
    | { attributes?: Record<string, string> }
    | undefined;
  return Number(opts?.attributes?.[SPEAK_UTTERANCE_ID_ATTR]);
}

function encodeTtsWithId(
  type: 'tts_done' | 'tts_error',
  utteranceId: number,
): Uint8Array {
  return new TextEncoder().encode(JSON.stringify({ type, utteranceId }));
}

// Asserts the most recent speak carried `text` on SPEAK_TOPIC with a positive
// utterance id stamped in its attributes (the id itself is dynamic).
function expectSpoke(text: string): void {
  const [spoken, opts] = (mockSendText.mock.calls.at(-1) ?? []) as [
    string,
    { topic: string; attributes?: Record<string, string> },
  ];
  expect(spoken).toBe(text);
  expect(opts.topic).toBe(SPEAK_TOPIC);
  expect(Number(opts.attributes?.[SPEAK_UTTERANCE_ID_ATTR])).toBeGreaterThan(0);
}

const DEFAULT_GRANT: LiveKitTokenGrant = {
  token: 'test-token',
  url: 'ws://localhost:7880',
  expiresAt: (Math.floor(Date.now() / 1000) + 900) as UnixSeconds,
};

function makeAdapter(
  mintToken: (roomName: string) => Promise<LiveKitTokenGrant> = async () =>
    DEFAULT_GRANT,
  options: Pick<LiveKitAdapterOptions, 'thinkingFallbackMs' | 'vad'> = {},
) {
  const events: RealtimeAdapterEvent[] = [];
  // Default the thinking fallback OFF so tests don't leak a real timer; the
  // fallback-specific tests opt into a short interval explicitly.
  const adapter = new LiveKitAdapter({
    mintToken,
    roomName: 'room-1',
    thinkingFallbackMs: 0,
    ...options,
  });
  adapter.on((e) => events.push(e));
  return { adapter, events };
}

function states(events: RealtimeAdapterEvent[]): string[] {
  return events
    .filter(
      (e): e is Extract<RealtimeAdapterEvent, { type: 'state' }> =>
        e.type === 'state',
    )
    .map((e) => e.state);
}

// ---

describe('LiveKitAdapter connect', () => {
  beforeEach(() => {
    currentRoom = makeMockRoom();
    mockRoomConnect.mockReset();
    mockRoomDisconnect.mockReset();
    mockRoomDisconnect.mockImplementation(async () => {});
    mockSetMicrophoneEnabled.mockReset();
    mockSetMicrophoneEnabled.mockImplementation(async (enabled: boolean) => {
      mockPublishedMicTrack.enabled = enabled;
    });
    mockCreateLocalAudioTrack.mockReset();
    mockCreateLocalAudioTrack.mockImplementation(
      async () => mockMicPublication.track,
    );
    mockPublishTrack.mockReset();
    mockPublishTrack.mockImplementation(async () => mockMicPublication);
    mockMuteLocalMic.mockReset();
    mockMuteLocalMic.mockImplementation(async () => {
      mockPublishedMicTrack.enabled = false;
      mockMicPublication.track.isMuted = true;
    });
    mockUnmuteLocalMic.mockReset();
    mockUnmuteLocalMic.mockImplementation(async () => {
      mockGeneratedTrack.enabled = true;
      mockMicPublication.track.isMuted = false;
    });
    mockMicPublication.track.isMuted = false;
    mockPublishedMicTrack.enabled = false;
    mockMicCloneTrack.enabled = false;
    mockGeneratedTrack.enabled = true;
    mockPublishedMicTrack.clone.mockClear();
    mockPublishedMicTrack.stop.mockClear();
    mockMicCloneTrack.stop.mockClear();
    mockCreateLocalAudioPreRoll.mockReset();
    mockCreateLocalAudioPreRoll.mockImplementation(async () => {
      throw new Error('AudioWorklet unavailable');
    });
    mockPauseUpstream.mockReset();
    mockResumeUpstream.mockReset();
    mockReplaceTrack.mockReset();
    mockBridgeStartAutomaticTurn.mockReset();
    mockBridgeStartAutomaticTurn.mockImplementation(async () => {});
    mockBridgeStartManualTurn.mockReset();
    mockBridgeStartManualTurn.mockImplementation(async () => {});
    mockBridgeEndTurn.mockReset();
    mockBridgeEndTurn.mockImplementation(async () => {});
    mockBridgeDestroy.mockReset();
    mockBridgeDestroy.mockImplementation(async () => {});
    mockVadStart.mockReset();
    mockVadStart.mockImplementation(async () => {});
    mockVadPause.mockReset();
    mockVadPause.mockImplementation(async () => {});
    mockVadDestroy.mockReset();
    mockVadDestroy.mockImplementation(async () => {});
    mockMicVADNew.mockClear();
    capturedVadOptions.length = 0;
  });

  test('emits connecting → connected and publishes+mutes the mic', async () => {
    const { adapter, events } = makeAdapter();
    await adapter.connect({ tools: [], instructions: '' });

    expect(states(events)).toEqual(['connecting', 'connected']);
    expect(mockRoomConnect).toHaveBeenCalledWith(
      'ws://localhost:7880',
      'test-token',
    );
    expect(mockCreateLocalAudioTrack).toHaveBeenCalledTimes(1);
    expect(mockPublishTrack).toHaveBeenCalledWith(mockMicPublication.track);
    expect(mockSetMicrophoneEnabled.mock.calls.map((c) => c[0])).toEqual([
      false,
    ]);
  });

  test('mutes locally acquired audio before its first publication and exposes mode only after upstream pause', async () => {
    const order: string[] = [];
    let rawEnabledAtPublish: boolean | undefined;
    let cloneEnabledAtPublish: boolean | undefined;
    mockCreateLocalAudioTrack.mockImplementationOnce(async () => {
      order.push('acquire');
      return mockMicPublication.track;
    });
    mockPublishedMicTrack.clone.mockImplementationOnce(() => {
      order.push('clone');
      return mockMicCloneTrack;
    });
    mockMuteLocalMic.mockImplementationOnce(async () => {
      mockPublishedMicTrack.enabled = false;
      order.push('mute');
    });
    mockPublishTrack.mockImplementationOnce(async (track) => {
      const localTrack = track as typeof mockMicPublication.track;
      rawEnabledAtPublish = localTrack.mediaStreamTrack.enabled;
      cloneEnabledAtPublish = mockMicCloneTrack.enabled;
      order.push('publish');
      return mockMicPublication;
    });
    mockPauseUpstream.mockImplementationOnce(async () => {
      order.push('pause');
    });
    const { adapter } = makeAdapter(undefined, { vad: false });
    adapter.on((event) => {
      if (event.type === 'turn_mode') order.push(`mode:${event.mode}`);
    });

    await adapter.connect({ tools: [], instructions: '' });

    expect(order).toEqual([
      'acquire',
      'clone',
      'mute',
      'publish',
      'pause',
      'mode:manual',
    ]);
    expect(rawEnabledAtPublish).toBe(false);
    expect(cloneEnabledAtPublish).toBe(true);
    expect(mockPublishedMicTrack.enabled).toBe(false);
  });

  test('publishes one generated track and pauses upstream while automatic turns are idle', async () => {
    mockCreateLocalAudioPreRoll.mockImplementationOnce(async () => mockBridge);
    const { adapter } = makeAdapter();

    await adapter.connect({ tools: [], instructions: '' });

    expect(mockCreateLocalAudioPreRoll).toHaveBeenCalledTimes(1);
    expect(mockReplaceTrack).toHaveBeenCalledWith(mockGeneratedTrack, true);
    // Raw capture is paused before bridge setup, then the generated publication
    // is paused again after replaceTrack resumes upstream internally.
    expect(mockPauseUpstream).toHaveBeenCalledTimes(2);
    expect(mockSetMicrophoneEnabled).not.toHaveBeenCalled();
    expect(mockPublishedMicTrack.stop).toHaveBeenCalledTimes(1);
  });

  test('establishes automatic mode without exposing manual turn control', async () => {
    mockCreateLocalAudioPreRoll.mockImplementationOnce(async () => mockBridge);
    const { adapter, events } = makeAdapter();

    await adapter.connect({ tools: [], instructions: '' });

    expect(events).toContainEqual({ type: 'turn_mode', mode: 'automatic' });
    expect(mockMicVADNew).toHaveBeenCalledTimes(1);
    expect(mockVadStart).toHaveBeenCalledTimes(1);
    expect(adapter.turnControl).toBeUndefined();
  });

  test('starts VAD on the local clone before announcing automatic mode', async () => {
    const start = deferred<void>();
    mockCreateLocalAudioPreRoll.mockImplementationOnce(async () => mockBridge);
    mockVadStart.mockImplementationOnce(() => start.promise);
    const { adapter, events } = makeAdapter(undefined, {
      vad: {
        assetBaseUrl: '/custom-vad',
        preRollMs: 125,
        providerOptions: { positiveSpeechThreshold: 0.8 },
      },
    });

    const connecting = adapter.connect({ tools: [], instructions: '' });
    for (let attempts = 0; attempts < 100; attempts += 1) {
      if (mockVadStart.mock.calls.length > 0) break;
      await Promise.resolve();
    }

    expect(events).not.toContainEqual({ type: 'turn_mode', mode: 'automatic' });
    const options = capturedVadOptions[0] as {
      baseAssetPath?: string;
      getStream?: () => Promise<MediaStream>;
      positiveSpeechThreshold?: number;
    };
    expect(options.baseAssetPath).toBe('/custom-vad/');
    expect(options.positiveSpeechThreshold).toBe(0.8);
    await expect(options.getStream?.()).resolves.toBe(
      adapter.getAudioStreams().mic,
    );

    start.resolve();
    await connecting;
    expect(events).toContainEqual({ type: 'turn_mode', mode: 'automatic' });
    expect(adapter.turnControl).toBeUndefined();
  });

  test('serializes automatic speech callbacks and sends pre-roll once per turn', async () => {
    mockCreateLocalAudioPreRoll.mockImplementationOnce(async () => mockBridge);
    const { adapter } = makeAdapter(undefined, { vad: { preRollMs: 125 } });
    await adapter.connect({ tools: [], instructions: '' });
    const options = capturedVadOptions[0] as {
      onSpeechStart?: () => Promise<void>;
      onSpeechEnd?: () => Promise<void>;
    };

    const firstStart = options.onSpeechStart?.();
    const duplicateStart = options.onSpeechStart?.();
    const firstEnd = options.onSpeechEnd?.();
    const secondStart = options.onSpeechStart?.();
    const secondEnd = options.onSpeechEnd?.();
    await Promise.all([
      firstStart,
      duplicateStart,
      firstEnd,
      secondStart,
      secondEnd,
    ]);

    expect(
      mockBridgeStartAutomaticTurn.mock.calls.map((call) => call[0]),
    ).toEqual([125, 125]);
    expect(mockBridgeEndTurn).toHaveBeenCalledTimes(2);
    expect(mockResumeUpstream).toHaveBeenCalledTimes(2);
    expect(mockPauseUpstream).toHaveBeenCalledTimes(4);
  });

  test('closes a short automatic turn once on VAD misfire without leaving automatic mode', async () => {
    mockCreateLocalAudioPreRoll.mockImplementationOnce(async () => mockBridge);
    const { adapter, events } = makeAdapter();
    await adapter.connect({ tools: [], instructions: '' });
    mockPublishData.mockClear();
    const options = capturedVadOptions[0] as {
      onSpeechStart?: () => Promise<void>;
      onSpeechEnd?: () => Promise<void>;
      onVADMisfire?: () => Promise<void>;
    };
    await options.onSpeechStart?.();

    await options.onVADMisfire?.();
    expect(mockBridgeEndTurn).toHaveBeenCalledTimes(1);
    await Promise.all([options.onVADMisfire?.(), options.onSpeechEnd?.()]);

    const publishCalls = mockPublishData.mock.calls as unknown as [
      Uint8Array,
    ][];
    const turnEnds = publishCalls.filter(([payload]) => {
      const message = JSON.parse(new TextDecoder().decode(payload));
      return message.type === 'turn_end';
    });
    expect(mockPauseUpstream).toHaveBeenCalledTimes(3);
    expect(turnEnds).toHaveLength(1);
    expect(events.filter((event) => event.type === 'turn_mode')).toEqual([
      { type: 'turn_mode', mode: 'automatic' },
    ]);
    expect(adapter.turnControl).toBeUndefined();
  });

  test('resumes upstream before emitting automatic pre-roll', async () => {
    const order: string[] = [];
    mockCreateLocalAudioPreRoll.mockImplementationOnce(async () => mockBridge);
    const { adapter } = makeAdapter();
    await adapter.connect({ tools: [], instructions: '' });
    mockResumeUpstream.mockImplementationOnce(async () => {
      order.push('resume-upstream');
    });
    mockBridgeStartAutomaticTurn.mockImplementationOnce(async () => {
      order.push('emit-pre-roll');
    });
    const options = capturedVadOptions[0] as {
      onSpeechStart?: () => Promise<void>;
    };

    await options.onSpeechStart?.();

    // The generated track must be upstream-live before buffered samples leave
    // the pre-roll bridge, or the beginning of the utterance is dropped.
    expect(order).toEqual(['resume-upstream', 'emit-pre-roll']);
  });

  test('destroys VAD on disconnect and fences its callbacks from a fresh reconnect', async () => {
    mockCreateLocalAudioPreRoll.mockImplementation(async () => mockBridge);
    const { adapter } = makeAdapter();
    await adapter.connect({ tools: [], instructions: '' });
    const stale = capturedVadOptions[0] as {
      onSpeechStart?: () => Promise<void>;
      onSpeechEnd?: () => Promise<void>;
      onVADMisfire?: () => Promise<void>;
    };

    await adapter.disconnect();
    currentRoom = makeMockRoom();
    await adapter.connect({ tools: [], instructions: '' });
    const fresh = capturedVadOptions[1] as {
      onSpeechStart?: () => Promise<void>;
      onSpeechEnd?: () => Promise<void>;
    };
    mockBridgeStartAutomaticTurn.mockClear();
    mockBridgeEndTurn.mockClear();

    await stale.onSpeechStart?.();
    await stale.onSpeechEnd?.();
    await stale.onVADMisfire?.();
    await fresh.onSpeechStart?.();
    await fresh.onSpeechEnd?.();

    expect(mockVadDestroy).toHaveBeenCalledTimes(1);
    expect(mockBridgeStartAutomaticTurn).toHaveBeenCalledTimes(1);
    expect(mockBridgeEndTurn).toHaveBeenCalledTimes(1);
  });

  test('degrades a VAD start failure to manual without failing the room', async () => {
    const cause = new Error('VAD assets unavailable');
    mockCreateLocalAudioPreRoll.mockImplementationOnce(async () => mockBridge);
    mockVadStart.mockImplementationOnce(async () => {
      throw cause;
    });
    const { adapter, events } = makeAdapter();

    await expect(
      adapter.connect({ tools: [], instructions: '' }),
    ).resolves.toBeUndefined();

    expect(states(events).at(-1)).toBe('connected');
    expect(events).toContainEqual({
      type: 'turn_mode',
      mode: 'manual',
      error: cause,
    });
    expect(mockVadDestroy).toHaveBeenCalledTimes(1);
    expect(adapter.turnControl).toBeDefined();
  });

  test('pauses automatic VAD and upstream before exposing manual fallback after a callback failure', async () => {
    const cause = new Error('automatic pre-roll failed');
    mockCreateLocalAudioPreRoll.mockImplementationOnce(async () => mockBridge);
    mockBridgeStartAutomaticTurn.mockImplementationOnce(async () => {
      throw cause;
    });
    const { adapter, events } = makeAdapter();
    await adapter.connect({ tools: [], instructions: '' });
    const options = capturedVadOptions[0] as {
      onSpeechStart?: () => Promise<void>;
    };
    let controlAvailableAtManualEvent = false;
    adapter.on((event) => {
      if (event.type === 'turn_mode' && event.mode === 'manual') {
        controlAvailableAtManualEvent = adapter.turnControl !== undefined;
      }
    });

    await options.onSpeechStart?.();

    expect(mockVadPause).toHaveBeenCalledTimes(1);
    expect(mockPauseUpstream.mock.calls.length).toBeGreaterThanOrEqual(4);
    expect(events).toContainEqual({
      type: 'turn_mode',
      mode: 'manual',
      error: cause,
    });
    expect(controlAvailableAtManualEvent).toBe(true);
  });

  test('waits for the degradation pause before exposing manual fallback', async () => {
    const cause = new Error('automatic pre-roll failed');
    const degradationPause = deferred<void>();
    let pauseCount = 0;
    mockCreateLocalAudioPreRoll.mockImplementationOnce(async () => mockBridge);
    mockBridgeStartAutomaticTurn.mockImplementationOnce(async () => {
      throw cause;
    });
    mockPauseUpstream.mockImplementation(async () => {
      pauseCount += 1;
      if (pauseCount === 4) await degradationPause.promise;
    });
    const { adapter, events } = makeAdapter();
    await adapter.connect({ tools: [], instructions: '' });
    const options = capturedVadOptions[0] as {
      onSpeechStart?: () => Promise<void>;
    };

    const failing = options.onSpeechStart?.();
    for (let attempts = 0; attempts < 20 && pauseCount < 4; attempts += 1) {
      await Promise.resolve();
    }

    expect(pauseCount).toBe(4);
    expect(adapter.turnControl).toBeUndefined();
    expect(events).not.toContainEqual({
      type: 'turn_mode',
      mode: 'manual',
      error: cause,
    });

    degradationPause.resolve();
    await failing;
    expect(adapter.turnControl).toBeDefined();
    expect(events).toContainEqual({
      type: 'turn_mode',
      mode: 'manual',
      error: cause,
    });
  });

  test('does not finalize an automatic turn twice when degradation follows a finalized drain failure', async () => {
    const cause = new Error('local drain failed');
    mockCreateLocalAudioPreRoll.mockImplementationOnce(async () => mockBridge);
    mockBridgeEndTurn.mockImplementationOnce(async () => {
      throw cause;
    });
    const { adapter, events } = makeAdapter();
    await adapter.connect({ tools: [], instructions: '' });
    mockPublishData.mockClear();
    const options = capturedVadOptions[0] as {
      onSpeechStart?: () => Promise<void>;
      onSpeechEnd?: () => Promise<void>;
    };
    await options.onSpeechStart?.();

    await options.onSpeechEnd?.();
    await options.onSpeechEnd?.();

    expect(mockBridgeEndTurn).toHaveBeenCalledTimes(1);
    const publishCalls = mockPublishData.mock.calls as unknown as [
      Uint8Array,
    ][];
    const turnEnds = publishCalls.filter(([payload]) => {
      const message = JSON.parse(new TextDecoder().decode(payload));
      return message.type === 'turn_end';
    });
    expect(turnEnds).toHaveLength(1);
    expect(events).toContainEqual({
      type: 'turn_mode',
      mode: 'manual',
      error: expect.objectContaining({ cause }),
    });
  });

  test('degrades to manual when a VAD misfire closes after a finalized drain failure', async () => {
    const cause = new Error('local drain failed');
    mockCreateLocalAudioPreRoll.mockImplementationOnce(async () => mockBridge);
    mockBridgeEndTurn.mockImplementationOnce(async () => {
      throw cause;
    });
    const { adapter, events } = makeAdapter();
    await adapter.connect({ tools: [], instructions: '' });
    mockPublishData.mockClear();
    const options = capturedVadOptions[0] as {
      onSpeechStart?: () => Promise<void>;
      onVADMisfire?: () => Promise<void>;
    };
    await options.onSpeechStart?.();

    await options.onVADMisfire?.();

    expect(mockBridgeEndTurn).toHaveBeenCalledTimes(1);
    expect(events).toContainEqual({
      type: 'turn_mode',
      mode: 'manual',
      error: expect.objectContaining({ cause }),
    });
    expect(adapter.turnControl).toBeDefined();
  });

  test('does not publish manual fallback when disconnect wins a delayed degradation', async () => {
    const cause = new Error('automatic pre-roll failed');
    const degradationPause = deferred<void>();
    let pauseCount = 0;
    mockCreateLocalAudioPreRoll.mockImplementationOnce(async () => mockBridge);
    mockBridgeStartAutomaticTurn.mockImplementationOnce(async () => {
      throw cause;
    });
    mockPauseUpstream.mockImplementation(async () => {
      pauseCount += 1;
      if (pauseCount === 4) await degradationPause.promise;
    });
    const { adapter, events } = makeAdapter();
    await adapter.connect({ tools: [], instructions: '' });
    const options = capturedVadOptions[0] as {
      onSpeechStart?: () => Promise<void>;
    };

    const failing = options.onSpeechStart?.();
    for (let attempts = 0; attempts < 20 && pauseCount < 4; attempts += 1) {
      await Promise.resolve();
    }
    const disconnecting = adapter.disconnect();
    degradationPause.resolve();
    await Promise.all([failing, disconnecting]);

    expect(adapter.turnControl).toBeUndefined();
    expect(events).not.toContainEqual({
      type: 'turn_mode',
      mode: 'manual',
      error: cause,
    });
  });

  test('reconnect reevaluates automatic mode after a runtime degradation', async () => {
    const cause = new Error('automatic pre-roll failed');
    mockCreateLocalAudioPreRoll.mockImplementation(async () => mockBridge);
    mockBridgeStartAutomaticTurn.mockImplementationOnce(async () => {
      throw cause;
    });
    const { adapter, events } = makeAdapter();
    await adapter.connect({ tools: [], instructions: '' });
    const stale = capturedVadOptions[0] as {
      onSpeechStart?: () => Promise<void>;
    };
    await stale.onSpeechStart?.();
    expect(adapter.turnControl).toBeDefined();

    await adapter.disconnect();
    currentRoom = makeMockRoom();
    await adapter.connect({ tools: [], instructions: '' });

    expect(adapter.turnControl).toBeUndefined();
    expect(events.filter((event) => event.type === 'turn_mode').at(-1)).toEqual(
      {
        type: 'turn_mode',
        mode: 'automatic',
      },
    );
  });

  test('a failed degradation pause is fatal and tears down the connection instead of exposing manual control', async () => {
    const cause = new Error('automatic pre-roll failed');
    let pauseCount = 0;
    mockCreateLocalAudioPreRoll.mockImplementationOnce(async () => mockBridge);
    mockBridgeStartAutomaticTurn.mockImplementationOnce(async () => {
      throw cause;
    });
    mockPauseUpstream.mockImplementation(async () => {
      pauseCount += 1;
      if (pauseCount >= 3) throw new Error('upstream pause failed');
    });
    const { adapter, events } = makeAdapter();
    await adapter.connect({ tools: [], instructions: '' });
    const options = capturedVadOptions[0] as {
      onSpeechStart?: () => Promise<void>;
    };

    await options.onSpeechStart?.();

    expect(adapter.turnControl).toBeUndefined();
    expect(
      events.some(
        (event) => event.type === 'turn_mode' && event.mode === 'manual',
      ),
    ).toBe(false);
    expect(
      events.some(
        (event) =>
          event.type === 'error' &&
          event.error instanceof RealtimeVoiceError &&
          event.error.code === 'CONNECTION_FAILED',
      ),
    ).toBe(true);
    expect(mockRoomDisconnect).toHaveBeenCalledTimes(1);
    expect(mockVadDestroy).toHaveBeenCalledTimes(1);
    expect(mockBridgeDestroy).toHaveBeenCalledTimes(1);
    expect(adapter.getAudioStreams()).toEqual({
      mic: undefined,
      playback: undefined,
    });
  });

  test('a fatal pause while handling VAD start failure rejects connect and cleans every local generation resource', async () => {
    const cause = new Error('VAD assets unavailable');
    let pauseCount = 0;
    mockCreateLocalAudioPreRoll.mockImplementationOnce(async () => mockBridge);
    mockVadStart.mockImplementationOnce(async () => {
      throw cause;
    });
    mockPauseUpstream.mockImplementation(async () => {
      pauseCount += 1;
      if (pauseCount === 3) throw new Error('upstream pause failed');
    });
    const { adapter, events } = makeAdapter();

    await expect(
      adapter.connect({ tools: [], instructions: '' }),
    ).rejects.toMatchObject({ code: 'CONNECTION_FAILED' });

    expect(states(events)).toEqual(['connecting', 'error']);
    expect(events.some((event) => event.type === 'turn_mode')).toBe(false);
    expect(mockRoomDisconnect).toHaveBeenCalledTimes(1);
    expect(mockVadDestroy).toHaveBeenCalledTimes(1);
    expect(mockBridgeDestroy).toHaveBeenCalledTimes(1);
    expect(mockMicCloneTrack.stop).toHaveBeenCalledTimes(1);
    expect(adapter.getAudioStreams()).toEqual({
      mic: undefined,
      playback: undefined,
    });
  });

  test('an automatic turn-end data-channel failure is fatal and tears down without manual fallback', async () => {
    mockCreateLocalAudioPreRoll.mockImplementationOnce(async () => mockBridge);
    const { adapter, events } = makeAdapter();
    await adapter.connect({ tools: [], instructions: '' });
    const options = capturedVadOptions[0] as {
      onSpeechStart?: () => Promise<void>;
      onSpeechEnd?: () => Promise<void>;
    };
    await options.onSpeechStart?.();
    mockPublishData.mockImplementationOnce(async () => {
      throw new Error('required data channel closed');
    });

    await options.onSpeechEnd?.();

    expect(adapter.turnControl).toBeUndefined();
    expect(
      events.some(
        (event) => event.type === 'turn_mode' && event.mode === 'manual',
      ),
    ).toBe(false);
    expect(
      events.some(
        (event) =>
          event.type === 'error' &&
          event.error instanceof RealtimeVoiceError &&
          event.error.code === 'DATA_CHANNEL_ERROR',
      ),
    ).toBe(true);
    expect(mockRoomDisconnect).toHaveBeenCalledTimes(1);
    expect(mockVadDestroy).toHaveBeenCalledTimes(1);
    expect(mockBridgeDestroy).toHaveBeenCalledTimes(1);
  });

  test('a VAD misfire turn-end data-channel failure is fatal without manual fallback', async () => {
    mockCreateLocalAudioPreRoll.mockImplementationOnce(async () => mockBridge);
    const { adapter, events } = makeAdapter();
    await adapter.connect({ tools: [], instructions: '' });
    const options = capturedVadOptions[0] as {
      onSpeechStart?: () => Promise<void>;
      onVADMisfire?: () => Promise<void>;
    };
    await options.onSpeechStart?.();
    mockPublishData.mockImplementationOnce(async () => {
      throw new Error('required data channel closed');
    });

    await options.onVADMisfire?.();

    expect(adapter.turnControl).toBeUndefined();
    expect(
      events.some(
        (event) => event.type === 'turn_mode' && event.mode === 'manual',
      ),
    ).toBe(false);
    expect(
      events.some(
        (event) =>
          event.type === 'error' &&
          event.error instanceof RealtimeVoiceError &&
          event.error.code === 'DATA_CHANNEL_ERROR',
      ),
    ).toBe(true);
  });

  test('vad false skips automatic resources and establishes manual mode after muting', async () => {
    const order: string[] = [];
    mockPauseUpstream.mockImplementationOnce(async () => {
      order.push('pause');
    });
    mockResumeUpstream.mockImplementationOnce(async () => {
      order.push('resume');
    });
    mockSetMicrophoneEnabled.mockImplementation(async (enabled: boolean) => {
      order.push(enabled ? 'enable' : 'disable');
      mockPublishedMicTrack.enabled = enabled;
    });
    const { adapter, events } = makeAdapter(undefined, { vad: false });
    let controlAvailableAtModeEvent = false;
    adapter.on((event) => {
      if (event.type === 'turn_mode') {
        controlAvailableAtModeEvent = adapter.turnControl !== undefined;
        order.push(`mode:${event.mode}`);
      }
    });

    await adapter.connect({ tools: [], instructions: '' });

    expect(mockCreateLocalAudioPreRoll).not.toHaveBeenCalled();
    expect(mockPublishedMicTrack.clone).toHaveBeenCalledTimes(1);
    expect(mockPauseUpstream).toHaveBeenCalledTimes(1);
    expect(mockResumeUpstream).not.toHaveBeenCalled();
    expect(order.indexOf('pause')).toBeLessThan(order.indexOf('mode:manual'));
    expect(order.indexOf('disable')).toBeLessThan(order.indexOf('mode:manual'));
    expect(events).toContainEqual({ type: 'turn_mode', mode: 'manual' });
    expect(controlAvailableAtModeEvent).toBe(true);
    expect(adapter.turnControl).toBeDefined();
  });

  test.each([
    [null],
    ['automatic'],
    [1],
    [[]],
  ])('runtime vad value %p degrades the connected room to manual with a diagnostic', async (vad) => {
    const { adapter, events } = makeAdapter(undefined, { vad: vad as never });

    await expect(
      adapter.connect({ tools: [], instructions: '' }),
    ).resolves.toBeUndefined();

    expect(states(events).at(-1)).toBe('connected');
    const mode = events.find((event) => event.type === 'turn_mode');
    expect(mode).toMatchObject({ type: 'turn_mode', mode: 'manual' });
    expect(mode?.type === 'turn_mode' && mode.error).toBeInstanceOf(TypeError);
    expect(adapter.turnControl).toBeDefined();
  });

  test('invalid automatic configuration degrades the connected room to manual', async () => {
    const { adapter, events } = makeAdapter(undefined, {
      vad: { preRollMs: 501 },
    });

    await expect(
      adapter.connect({ tools: [], instructions: '' }),
    ).resolves.toBeUndefined();

    expect(states(events).at(-1)).toBe('connected');
    const mode = events.find((event) => event.type === 'turn_mode');
    expect(mode).toMatchObject({ type: 'turn_mode', mode: 'manual' });
    expect(mode?.type === 'turn_mode' && mode.error).toBeInstanceOf(TypeError);
    expect(mockCreateLocalAudioPreRoll).not.toHaveBeenCalled();
    expect(adapter.turnControl).toBeDefined();
  });

  test("keeps replacement audio disabled until LiveKit's replaceTrack resume is paused", async () => {
    const order: string[] = [];
    let upstreamPaused = false;
    let generatedEnabledWhenReplacementResumed: boolean | undefined;
    let pauseCount = 0;
    let releaseReplacementPause!: () => void;
    mockCreateLocalAudioPreRoll.mockImplementationOnce(async () => mockBridge);
    mockPauseUpstream.mockImplementation(() => {
      pauseCount += 1;
      upstreamPaused = true;
      order.push('pause');
      if (pauseCount === 2) {
        return new Promise<void>((resolve) => {
          releaseReplacementPause = resolve;
        });
      }
      return Promise.resolve();
    });
    mockReplaceTrack.mockImplementationOnce(async () => {
      // livekit-client 2.13.1 resumes upstream as a replaceTrack side effect.
      upstreamPaused = false;
      generatedEnabledWhenReplacementResumed = mockGeneratedTrack.enabled;
      order.push('replace-resumed');
    });
    const { adapter } = makeAdapter();

    const connecting = adapter.connect({ tools: [], instructions: '' });
    for (let attempts = 0; attempts < 10; attempts += 1) {
      if (mockPauseUpstream.mock.calls.length === 2) break;
      await Promise.resolve();
    }

    expect(order).toEqual(['pause', 'replace-resumed', 'pause']);
    expect(generatedEnabledWhenReplacementResumed).toBe(false);
    expect(upstreamPaused).toBe(true);
    expect(adapter.turnControl).toBeUndefined();

    releaseReplacementPause();
    await connecting;

    expect(adapter.turnControl).toBeUndefined();
  });

  test.each([
    ['automatic', false],
    ['manual degradation', true],
  ])('logically unmutes the generated publication while upstream remains paused in %s mode', async (_mode, failVadStart) => {
    const order: string[] = [];
    let upstreamPaused = false;
    mockCreateLocalAudioPreRoll.mockImplementationOnce(async () => mockBridge);
    mockPauseUpstream.mockImplementation(async () => {
      upstreamPaused = true;
      order.push('pause');
    });
    mockReplaceTrack.mockImplementationOnce(async () => {
      upstreamPaused = false;
      order.push('replace-resumed');
    });
    mockUnmuteLocalMic.mockImplementationOnce(async () => {
      expect(upstreamPaused).toBe(true);
      expect(mockGeneratedTrack.enabled).toBe(false);
      mockGeneratedTrack.enabled = true;
      mockMicPublication.track.isMuted = false;
      order.push('unmute');
    });
    if (failVadStart) {
      mockVadStart.mockImplementationOnce(async () => {
        throw new Error('VAD startup failed');
      });
    }
    const { adapter, events } = makeAdapter();

    await adapter.connect({ tools: [], instructions: '' });

    expect(order.slice(0, 4)).toEqual([
      'pause',
      'replace-resumed',
      'pause',
      'unmute',
    ]);
    expect(mockMicPublication.track.isMuted).toBe(false);
    expect(upstreamPaused).toBe(true);
    expect(mockGeneratedTrack.enabled).toBe(true);
    expect(
      events.filter((event) => event.type === 'turn_mode').at(-1),
    ).toMatchObject({
      type: 'turn_mode',
      mode: failVadStart ? 'manual' : 'automatic',
    });
  });

  test('pauses the raw publication before asynchronous bridge initialization', async () => {
    const order: string[] = [];
    let rawEnabledDuringBridgeInitialization: boolean | undefined;
    mockSetMicrophoneEnabled.mockImplementation(async (enabled: boolean) => {
      mockPublishedMicTrack.enabled = enabled;
      order.push(enabled ? 'enable' : 'disable');
    });
    mockPauseUpstream.mockImplementationOnce(async () => {
      order.push('pause');
    });
    mockCreateLocalAudioPreRoll.mockImplementationOnce(async () => {
      order.push('bridge-init');
      rawEnabledDuringBridgeInitialization = mockPublishedMicTrack.enabled;
      return mockBridge;
    });
    const { adapter } = makeAdapter();

    await adapter.connect({ tools: [], instructions: '' });

    expect(order).toEqual(['pause', 'bridge-init']);
    expect(rawEnabledDuringBridgeInitialization).toBe(false);
  });

  test('restores native upstream control after bridge initialization falls back to manual', async () => {
    const order: string[] = [];
    mockPauseUpstream.mockImplementationOnce(async () => {
      order.push('pause');
    });
    mockSetMicrophoneEnabled.mockImplementation(async (enabled: boolean) => {
      order.push(enabled ? 'enable' : 'disable');
    });
    mockResumeUpstream.mockImplementationOnce(async () => {
      order.push('resume');
    });
    const { adapter } = makeAdapter();

    await adapter.connect({ tools: [], instructions: '' });
    await adapter.turnControl?.startTurn();

    expect(order).toEqual(['pause', 'disable', 'resume', 'enable']);
  });

  test('cleans raw, clone, and generated resources when track replacement fails', async () => {
    mockCreateLocalAudioPreRoll.mockImplementationOnce(async () => mockBridge);
    mockReplaceTrack.mockImplementationOnce(async () => {
      throw new Error('replace failed');
    });
    const { adapter } = makeAdapter();

    await expect(
      adapter.connect({ tools: [], instructions: '' }),
    ).rejects.toThrow('replace failed');

    expect(mockPublishedMicTrack.stop).toHaveBeenCalledTimes(1);
    expect(mockMicCloneTrack.stop).toHaveBeenCalledTimes(1);
    expect(mockBridgeDestroy).toHaveBeenCalledTimes(1);
  });

  test('treats generated-track unmute failure as fatal and cleans every local resource', async () => {
    mockCreateLocalAudioPreRoll.mockImplementationOnce(async () => mockBridge);
    mockUnmuteLocalMic.mockImplementationOnce(async () => {
      throw new Error('unmute failed');
    });
    const { adapter, events } = makeAdapter();

    await expect(
      adapter.connect({ tools: [], instructions: '' }),
    ).rejects.toThrow('unmute failed');

    expect(states(events)).toEqual(['connecting', 'error']);
    expect(events.some((event) => event.type === 'turn_mode')).toBe(false);
    expect(mockRoomDisconnect).toHaveBeenCalledTimes(1);
    expect(mockPublishedMicTrack.stop).toHaveBeenCalledTimes(1);
    expect(mockMicCloneTrack.stop).toHaveBeenCalledTimes(1);
    expect(mockBridgeDestroy).toHaveBeenCalledTimes(1);
    expect(adapter.getAudioStreams()).toEqual({
      mic: undefined,
      playback: undefined,
    });
  });

  test('owns and destroys the generated bridge while track replacement is pending', async () => {
    let releaseReplace!: () => void;
    mockCreateLocalAudioPreRoll.mockImplementationOnce(async () => mockBridge);
    mockReplaceTrack.mockImplementationOnce(
      () => new Promise<void>((resolve) => (releaseReplace = resolve)),
    );
    const { adapter } = makeAdapter();

    const connecting = adapter.connect({ tools: [], instructions: '' });
    for (let attempts = 0; attempts < 10; attempts += 1) {
      if (mockReplaceTrack.mock.calls.length > 0) break;
      await Promise.resolve();
    }
    expect(mockReplaceTrack).toHaveBeenCalledTimes(1);

    await adapter.disconnect();

    expect(mockBridgeDestroy).toHaveBeenCalledTimes(1);
    expect(mockMicCloneTrack.stop).toHaveBeenCalledTimes(1);
    releaseReplace();
    await expect(connecting).rejects.toMatchObject({
      code: 'CONNECT_SUPERSEDED',
    });
  });

  test('destroys a bridge that finishes initializing after disconnect', async () => {
    let releaseBridge!: (bridge: LocalAudioPreRoll) => void;
    mockCreateLocalAudioPreRoll.mockImplementationOnce(
      () =>
        new Promise<LocalAudioPreRoll>((resolve) => {
          releaseBridge = resolve;
        }),
    );
    const { adapter } = makeAdapter();

    const connecting = adapter.connect({ tools: [], instructions: '' });
    for (let attempts = 0; attempts < 10; attempts += 1) {
      if (mockCreateLocalAudioPreRoll.mock.calls.length > 0) break;
      await Promise.resolve();
    }
    expect(mockCreateLocalAudioPreRoll).toHaveBeenCalledTimes(1);

    await adapter.disconnect();
    releaseBridge(mockBridge);

    await expect(connecting).rejects.toMatchObject({
      code: 'CONNECT_SUPERSEDED',
    });
    expect(mockBridgeDestroy).toHaveBeenCalledTimes(1);
    expect(mockReplaceTrack).not.toHaveBeenCalled();
  });

  test('destroys the generated audio generation on disconnect', async () => {
    mockCreateLocalAudioPreRoll.mockImplementationOnce(async () => mockBridge);
    const { adapter } = makeAdapter();
    await adapter.connect({ tools: [], instructions: '' });

    await adapter.disconnect();

    expect(mockBridgeDestroy).toHaveBeenCalledTimes(1);
    expect(mockMicCloneTrack.stop).toHaveBeenCalledTimes(1);
  });

  test('a token failure wraps as TOKEN_MINT_FAILED, tears down, and ends in error state', async () => {
    const cause = new Error('LiveKit credentials not configured');
    const { adapter, events } = makeAdapter(async () => {
      throw cause;
    });

    const error = await adapter.connect({ tools: [], instructions: '' }).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(RealtimeVoiceError);
    expect((error as RealtimeVoiceError).code).toBe('TOKEN_MINT_FAILED');
    expect((error as RealtimeVoiceError).cause).toBe(cause);
    expect(states(events)).toEqual(['connecting', 'error']);
  });

  test('rejects a second connect with an ALREADY_CONNECTED RealtimeVoiceError', async () => {
    const { adapter } = makeAdapter();
    await adapter.connect({ tools: [], instructions: '' });

    const error = await adapter.connect({ tools: [], instructions: '' }).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(RealtimeVoiceError);
    expect((error as RealtimeVoiceError).code).toBe('ALREADY_CONNECTED');
  });

  test('a mic-permission denial on connect surfaces MIC_PERMISSION_DENIED', async () => {
    const { adapter, events } = makeAdapter();
    // livekit-client surfaces the browser getUserMedia rejection here.
    const denied = Object.assign(new Error('Permission denied'), {
      name: 'NotAllowedError',
    });
    mockCreateLocalAudioTrack.mockImplementationOnce(async () => {
      throw denied;
    });

    const error = await adapter.connect({ tools: [], instructions: '' }).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(RealtimeVoiceError);
    expect((error as RealtimeVoiceError).code).toBe('MIC_PERMISSION_DENIED');
    expect(mockPublishTrack).not.toHaveBeenCalled();
    expect(states(events)).toEqual(['connecting', 'error']);
  });

  test('a post-connect step failure disconnects the room, not just teardown', async () => {
    mockRoomDisconnect.mockClear();
    const { adapter, events } = makeAdapter();
    // room.connect succeeds; the mic publish (a later step) blows up. A generic
    // (non-permission) failure maps to CONNECTION_FAILED, carrying the cause.
    const cause = new Error('mic publish failed');
    mockPublishTrack.mockImplementationOnce(async () => {
      throw cause;
    });

    const error = await adapter.connect({ tools: [], instructions: '' }).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(RealtimeVoiceError);
    expect((error as RealtimeVoiceError).code).toBe('CONNECTION_FAILED');
    expect((error as RealtimeVoiceError).cause).toBe(cause);
    // The already-connected room must be torn down over the wire, not leaked.
    expect(mockRoomDisconnect).toHaveBeenCalled();
    expect(mockPublishedMicTrack.stop).toHaveBeenCalledTimes(1);
    expect(mockMicCloneTrack.stop).toHaveBeenCalledTimes(1);
    expect(states(events)).toEqual(['connecting', 'error']);
  });

  test('a connect failure whose room.disconnect fires Disconnected still ends in error state', async () => {
    mockRoomDisconnect.mockClear();
    const { adapter, events } = makeAdapter();
    const cause = new Error('signal connection failed');
    mockRoomConnect.mockImplementationOnce(async () => {
      throw cause;
    });
    // Real livekit-client fires RoomEvent.Disconnected as a side effect of
    // room.disconnect(). That handler runs teardown (superseding the connect
    // guard) before the catch resumes — so an `attempt.isCurrent` read taken
    // AFTER the disconnect would wrongly report this sole genuine attempt as
    // superseded and skip the error emit, stalling the state stream at
    // `connecting`. The catch must still tear down and emit `error`.
    mockRoomDisconnect.mockImplementationOnce(async () => {
      currentRoom._emit('disconnected');
    });

    const error = await adapter.connect({ tools: [], instructions: '' }).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(error).toBe(cause);
    expect(mockRoomDisconnect).toHaveBeenCalled();
    expect(states(events)).toEqual(['connecting', 'error']);
  });

  test('an unexpected Disconnected emits a fatal CONNECTION_FAILED (not a bare idle) and tears down so the adapter can reconnect', async () => {
    const { adapter, events } = makeAdapter();
    await adapter.connect({ tools: [], instructions: '' });

    currentRoom._emit('disconnected');

    // A server/network drop the adapter did not initiate is fatal: emit a
    // RealtimeVoiceError so RealtimeSession's `error` path runs cleanup (it
    // unsubscribes the adapter), instead of a bare `idle` state the session
    // treats as a no-op — which would leave a stale subscription behind and
    // double-handle every event after the next connect().
    const err = events.find((e) => e.type === 'error');
    expect(err?.type === 'error' && err.error).toBeInstanceOf(
      RealtimeVoiceError,
    );
    expect(
      err?.type === 'error' && (err.error as RealtimeVoiceError).code,
    ).toBe('CONNECTION_FAILED');
    expect(states(events)).not.toContain('idle');

    // Teardown still ran, so a fresh connect must not throw 'already connected'.
    await expect(
      adapter.connect({ tools: [], instructions: '' }),
    ).resolves.toBeUndefined();
  });

  test('a locally-initiated disconnect() does not emit an error even when it fires Disconnected', async () => {
    const { adapter, events } = makeAdapter();
    await adapter.connect({ tools: [], instructions: '' });

    // Real LiveKit fires RoomEvent.Disconnected as a result of room.disconnect().
    // An adapter-initiated teardown must stay silent — no fatal error.
    mockRoomDisconnect.mockImplementationOnce(async () => {
      currentRoom._emit('disconnected');
    });

    await adapter.disconnect();

    expect(events.some((e) => e.type === 'error')).toBe(false);
  });

  test('a disconnect during an in-flight connect rejects CONNECT_SUPERSEDED and abandons the orphaned room', async () => {
    mockRoomConnect.mockClear();
    mockRoomDisconnect.mockClear();
    let releaseToken!: (grant: LiveKitTokenGrant) => void;
    const tokenPromise = new Promise<LiveKitTokenGrant>((res) => {
      releaseToken = res;
    });
    const { adapter, events } = makeAdapter(() => tokenPromise);

    const connecting = adapter.connect({ tools: [], instructions: '' });
    await adapter.disconnect();
    releaseToken(DEFAULT_GRANT);

    // A superseded connect must reject rather than resolve as if it connected —
    // the same observable behavior as the OpenAI adapter (this was the bug: a
    // stale LiveKit connect used to resolve silently).
    const error = await connecting.then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(RealtimeVoiceError);
    expect((error as RealtimeVoiceError).code).toBe('CONNECT_SUPERSEDED');

    // Staleness was detected after mintToken resolved: we never proceeded to
    // join, and never reported a live connection.
    expect(mockRoomConnect).not.toHaveBeenCalled();
    expect(states(events)).not.toContain('connected');
    // The superseded attempt must not stomp the disconnect back into 'error'.
    expect(states(events)).not.toContain('error');
    // The orphaned room was disconnected.
    expect(mockRoomDisconnect).toHaveBeenCalled();
  });

  test('a connect superseded by a newer connect rejects without clobbering the winner', async () => {
    mockRoomConnect.mockClear();
    mockRoomDisconnect.mockClear();
    // First attempt parks on mintToken; a disconnect frees the guard, then a
    // second attempt (with an immediate grant) wins.
    let releaseFirstToken!: (grant: LiveKitTokenGrant) => void;
    const firstToken = new Promise<LiveKitTokenGrant>((res) => {
      releaseFirstToken = res;
    });
    let call = 0;
    const { adapter, events } = makeAdapter(() => {
      call += 1;
      return call === 1 ? firstToken : Promise.resolve(DEFAULT_GRANT);
    });

    const first = adapter.connect({ tools: [], instructions: '' });
    // Free the connecting guard so a second connect can start and supersede.
    await adapter.disconnect();
    const second = adapter.connect({ tools: [], instructions: '' });
    await second;

    // Now let the stale first attempt resume — it must reject, not resolve.
    releaseFirstToken(DEFAULT_GRANT);
    const error = await first.then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(RealtimeVoiceError);
    expect((error as RealtimeVoiceError).code).toBe('CONNECT_SUPERSEDED');

    // The winner is fully connected and was not driven into 'error' by the loser.
    expect(states(events).at(-1)).toBe('connected');
  });
});

describe('LiveKitAdapter disconnect teardown', () => {
  beforeEach(() => {
    currentRoom = makeMockRoom();
    mockRoomConnect.mockReset();
    mockRoomDisconnect.mockReset();
    mockRoomDisconnect.mockImplementation(async () => {});
    mockSetMicrophoneEnabled.mockReset();
  });

  test('a rejecting room.disconnect() still tears down so a later connect() can succeed', async () => {
    const { adapter } = makeAdapter();
    await adapter.connect({ tools: [], instructions: '' });

    const cause = new Error('disconnect failed');
    mockRoomDisconnect.mockImplementationOnce(async () => {
      throw cause;
    });

    // The rejection must propagate to the caller...
    const error = await adapter.disconnect().then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(error).toBe(cause);

    // ...but teardown still ran, so a fresh connect is not rejected as
    // ALREADY_CONNECTED — a failed disconnect must not wedge the adapter.
    await expect(
      adapter.connect({ tools: [], instructions: '' }),
    ).resolves.toBeUndefined();
  });

  test('disables and destroys local audio before awaiting room disconnect', async () => {
    const order: string[] = [];
    mockCreateLocalAudioPreRoll.mockImplementationOnce(async () => mockBridge);
    mockBridgeDestroy.mockImplementationOnce(async () => {
      order.push('destroy-local-audio');
    });
    mockRoomDisconnect.mockImplementationOnce(async () => {
      order.push('disconnect-room');
    });
    const { adapter } = makeAdapter();
    mockMicCloneTrack.stop.mockClear();
    await adapter.connect({ tools: [], instructions: '' });

    await adapter.disconnect();
    await adapter.disconnect();

    expect(order).toEqual(['destroy-local-audio', 'disconnect-room']);
    expect(mockGeneratedTrack.enabled).toBe(false);
    expect(mockBridgeDestroy).toHaveBeenCalledTimes(1);
    expect(mockMicCloneTrack.stop).toHaveBeenCalledTimes(1);
  });
});

describe('LiveKitAdapter transcript → tool_call synthesis', () => {
  beforeEach(() => {
    currentRoom = makeMockRoom();
    mockSetMicrophoneEnabled.mockReset();
    mockSetMicrophoneEnabled.mockImplementation(async (enabled: boolean) => {
      mockPublishedMicTrack.enabled = enabled;
    });
    mockPublishedMicTrack.enabled = false;
    mockMicCloneTrack.enabled = false;
    mockPublishedMicTrack.clone.mockClear();
    mockPublishedMicTrack.stop.mockClear();
    mockMicCloneTrack.stop.mockClear();
  });

  test('a final transcript emits a transcript event then an update_ui tool call', async () => {
    const { adapter, events } = makeAdapter();
    await adapter.connect({ tools: [], instructions: '' });

    currentRoom._emit('transcriptionReceived', [
      { text: 'show', final: true },
      { text: 'the weather', final: true },
      { text: 'ignored', final: false },
    ]);

    const transcript = events.find((e) => e.type === 'transcript');
    expect(transcript).toEqual({
      type: 'transcript',
      role: 'user',
      text: 'show the weather',
      final: true,
    });

    const toolCall = events.find((e) => e.type === 'tool_call');
    expect(toolCall).toMatchObject({ type: 'tool_call', name: 'update_ui' });
    if (toolCall?.type !== 'tool_call') throw new Error('expected tool_call');
    expect(JSON.parse(toolCall.argumentsJson)).toEqual({
      intent: 'show the weather',
    });
    // ToolCallId brands a non-empty string.
    expect(typeof toolCall.callId).toBe('string');
    expect((toolCall.callId as string).length).toBeGreaterThan(0);
  });

  test('synthesized tool calls get distinct call ids', async () => {
    const { adapter, events } = makeAdapter();
    await adapter.connect({ tools: [], instructions: '' });

    currentRoom._emit('transcriptionReceived', [{ text: 'one', final: true }]);
    currentRoom._emit('transcriptionReceived', [{ text: 'two', final: true }]);

    const ids = events
      .filter(
        (e): e is Extract<RealtimeAdapterEvent, { type: 'tool_call' }> =>
          e.type === 'tool_call',
      )
      .map((e) => e.callId as string);
    expect(ids.length).toBe(2);
    expect(ids[0]).not.toBe(ids[1]);
  });

  test('an empty or non-final transcription emits nothing', async () => {
    const { adapter, events } = makeAdapter();
    await adapter.connect({ tools: [], instructions: '' });
    const before = events.length;

    currentRoom._emit('transcriptionReceived', [{ text: '   ', final: true }]);
    currentRoom._emit('transcriptionReceived', [
      { text: 'partial', final: false },
    ]);

    expect(events.length).toBe(before);
  });
});

function encodeTts(type: 'tts_done' | 'tts_error'): Uint8Array {
  return new TextEncoder().encode(JSON.stringify({ type }));
}

describe('LiveKitAdapter sendToolResult → speak topic', () => {
  beforeEach(() => {
    currentRoom = makeMockRoom();
    mockSendText.mockReset();
    mockSetMicrophoneEnabled.mockReset();
  });

  test('speaks the structural summary when there is no engine userMessage', async () => {
    const { adapter, events } = makeAdapter();
    await adapter.connect({ tools: [], instructions: '' });

    await adapter.sendToolResult('call-1' as never, {
      ok: true,
      summary: 'Weather is on screen.',
    });

    expectSpoke('Weather is on screen.');
    // speaking is announced on hand-off and STAYS until the worker signals
    // playout end — it no longer collapses when the text is handed off.
    expect(states(events).at(-1)).toBe('speaking');
  });

  test('prefers the engine userMessage over the structural summary', async () => {
    const { adapter } = makeAdapter();
    await adapter.connect({ tools: [], instructions: '' });

    await adapter.sendToolResult('call-1' as never, {
      ok: true,
      summary: '1 vessel on screen, tiling layout: weather (default).',
      userMessage: 'Here is your weather.',
    });

    expectSpoke('Here is your weather.');
  });

  test('collapses speaking → connected only when the worker signals tts_done', async () => {
    const { adapter, events } = makeAdapter();
    await adapter.connect({ tools: [], instructions: '' });

    await adapter.sendToolResult('call-1' as never, {
      ok: true,
      summary: 'Done.',
    });
    expect(states(events).at(-1)).toBe('speaking');

    currentRoom._emit(
      'dataReceived',
      encodeTts('tts_done'),
      undefined,
      undefined,
      TTS_TOPIC,
    );
    expect(states(events).at(-1)).toBe('connected');
  });

  test('a send failure is non-fatal: a plain error event, no fatal RealtimeVoiceError, releases speaking', async () => {
    const { adapter, events } = makeAdapter();
    await adapter.connect({ tools: [], instructions: '' });
    mockSendText.mockImplementationOnce(async () => {
      throw new Error('stream closed');
    });

    await adapter.sendToolResult('call-1' as never, {
      ok: true,
      summary: 'Done.',
    });

    // The update_ui already applied and nothing waits on the spoken read-back —
    // so a send failure is surfaced as a plain Error (logged, non-fatal), never a
    // session-fatal RealtimeVoiceError. Mirrors the OpenAI adapter's parallel case.
    const err = events.find((e) => e.type === 'error');
    expect(err?.type === 'error' && err.error).toBeInstanceOf(Error);
    expect(err?.type === 'error' && err.error).not.toBeInstanceOf(
      RealtimeVoiceError,
    );
    expect(
      events.some(
        (e) => e.type === 'error' && e.error instanceof RealtimeVoiceError,
      ),
    ).toBe(false);
    // No audio will play, so speaking must not linger.
    expect(states(events).at(-1)).toBe('connected');
  });

  test('with no active room, is non-fatal: no error event, no throw, and no send', async () => {
    const { adapter, events } = makeAdapter();
    // Never connected — no room. A `#room` unset here means an intentional
    // teardown raced this in-flight read-back of an already-applied update_ui;
    // real connection loss is surfaced by the room's connection-state events.
    // So this must not tear the session down.
    await expect(
      adapter.sendToolResult('call-1' as never, { ok: true, summary: 'Done.' }),
    ).resolves.toBeUndefined();

    // No RealtimeVoiceError (which RealtimeSession treats as fatal).
    expect(events.some((e) => e.type === 'error')).toBe(false);
    expect(mockSendText).not.toHaveBeenCalled();
  });

  test('serializes a read-only snapshot result rather than voicing it', async () => {
    const { adapter } = makeAdapter();
    await adapter.connect({ tools: [], instructions: '' });

    // get_ui_state / get_capabilities send raw snapshots (no `ok` field) — the
    // model would read these as JSON, so there is nothing conversational to say.
    await adapter.sendToolResult('call-3' as never, { vessels: [] });
    expectSpoke('{"vessels":[]}');
  });
});

describe('LiveKitAdapter turnControl (push-to-talk) state mapping', () => {
  beforeEach(() => {
    currentRoom = makeMockRoom();
    mockRoomDisconnect.mockReset();
    mockRoomDisconnect.mockImplementation(async () => {});
    mockSetMicrophoneEnabled.mockReset();
    mockSetMicrophoneEnabled.mockImplementation(async (enabled: boolean) => {
      mockPublishedMicTrack.enabled = enabled;
    });
    mockPauseUpstream.mockReset();
    mockPauseUpstream.mockImplementation(async () => {});
    mockResumeUpstream.mockReset();
    mockResumeUpstream.mockImplementation(async () => {});
    mockPublishData.mockReset();
    mockPublishData.mockImplementation(async () => {});
  });

  test('startTurn resumes native upstream before unmuting and emits speech_started + listening', async () => {
    const order: string[] = [];
    const { adapter, events } = makeAdapter(undefined, { vad: false });
    await adapter.connect({ tools: [], instructions: '' });
    mockResumeUpstream.mockImplementationOnce(async () => {
      order.push('resume');
    });
    mockSetMicrophoneEnabled.mockImplementationOnce(async () => {
      order.push('enable');
    });

    await adapter.turnControl?.startTurn();

    expect(order).toEqual(['resume', 'enable']);
    expect(mockSetMicrophoneEnabled).toHaveBeenCalledWith(true);
    expect(events.some((e) => e.type === 'speech_started')).toBe(true);
    expect(states(events).at(-1)).toBe('listening');
  });

  test('endTurn publishes turn_end on the turn topic, mutes, emits thinking', async () => {
    const { adapter, events } = makeAdapter();
    await adapter.connect({ tools: [], instructions: '' });
    mockSetMicrophoneEnabled.mockReset();

    await adapter.turnControl?.endTurn();

    const [payload, opts] = mockPublishData.mock.calls.at(-1) as unknown as [
      Uint8Array,
      { reliable: boolean; topic: string },
    ];
    expect(opts).toEqual({ reliable: true, topic: TURN_TOPIC });
    expect(JSON.parse(new TextDecoder().decode(payload))).toEqual({
      type: 'turn_end',
    });
    expect(mockSetMicrophoneEnabled).toHaveBeenCalledWith(false);
    expect(states(events).at(-1)).toBe('thinking');
  });

  test('endTurn mutes and pauses native upstream before publishing turn_end', async () => {
    const order: string[] = [];
    const { adapter } = makeAdapter();
    await adapter.connect({ tools: [], instructions: '' });
    mockSetMicrophoneEnabled.mockImplementation(async () => {
      order.push('mute');
    });
    mockPauseUpstream.mockImplementation(async () => {
      order.push('pause');
    });
    mockPublishData.mockImplementation(async () => {
      order.push('publish');
    });

    await adapter.turnControl?.endTurn();

    expect(order).toEqual(['mute', 'pause', 'publish']);
  });

  test('a native upstream resume failure is fatal and never enables the microphone', async () => {
    const { adapter, events } = makeAdapter();
    await adapter.connect({ tools: [], instructions: '' });
    mockSetMicrophoneEnabled.mockClear();
    mockResumeUpstream.mockImplementationOnce(async () => {
      throw new Error('resume failed');
    });

    await adapter.turnControl?.startTurn();

    expect(mockSetMicrophoneEnabled).not.toHaveBeenCalledWith(true);
    expect(states(events)).not.toContain('listening');
    expect(
      events.some(
        (event) =>
          event.type === 'error' &&
          event.error instanceof RealtimeVoiceError &&
          event.error.code === 'CONNECTION_FAILED',
      ),
    ).toBe(true);
    expect(mockRoomDisconnect).toHaveBeenCalledTimes(1);
  });

  test('a native upstream pause failure is fatal and never publishes turn_end', async () => {
    const { adapter, events } = makeAdapter();
    await adapter.connect({ tools: [], instructions: '' });
    mockPublishData.mockClear();
    mockPauseUpstream.mockImplementationOnce(async () => {
      throw new Error('pause failed');
    });

    await adapter.turnControl?.endTurn();

    expect(mockSetMicrophoneEnabled).toHaveBeenCalledWith(false);
    expect(mockPublishData).not.toHaveBeenCalled();
    expect(states(events)).not.toContain('thinking');
    expect(
      events.some(
        (event) =>
          event.type === 'error' &&
          event.error instanceof RealtimeVoiceError &&
          event.error.code === 'CONNECTION_FAILED',
      ),
    ).toBe(true);
    expect(mockRoomDisconnect).toHaveBeenCalledTimes(1);
  });

  test('endTurn surfaces a fatal DATA_CHANNEL_ERROR when publishData rejects, still muted, and stops the turn', async () => {
    const { adapter, events } = makeAdapter(undefined, {
      thinkingFallbackMs: 10,
    });
    await adapter.connect({ tools: [], instructions: '' });
    mockSetMicrophoneEnabled.mockClear();
    mockPublishData.mockImplementationOnce(async () => {
      throw new Error('data channel closed');
    });

    await adapter.turnControl?.endTurn();

    expect(mockSetMicrophoneEnabled).toHaveBeenCalledWith(false);
    const err = events.find((e) => e.type === 'error');
    expect(err?.type === 'error' && err.error).toBeInstanceOf(
      RealtimeVoiceError,
    );
    expect(
      err?.type === 'error' && (err.error as RealtimeVoiceError).code,
    ).toBe('DATA_CHANNEL_ERROR');
    // A broken data channel is fatal: the session tears down on the error, so we
    // must not emit `thinking` (it would clobber the session's `error` state) or
    // arm the fallback — dead work on a torn-down session. `connected` (from
    // connect) stays the last state; endTurn emits nothing after the fatal error.
    expect(states(events)).not.toContain('thinking');
    expect(states(events)).toEqual(['connecting', 'connected']);

    // And no fallback was armed: it would emit a (spurious) state after the
    // fallback interval, but nothing more is emitted.
    const before = events.length;
    await new Promise((r) => setTimeout(r, 40));
    expect(events.length).toBe(before);
  });

  test('endTurn surfaces a fatal CONNECTION_FAILED when muting rejects and then stops the turn', async () => {
    const { adapter, events } = makeAdapter();
    await adapter.connect({ tools: [], instructions: '' });
    mockPublishData.mockClear();
    mockSetMicrophoneEnabled.mockImplementationOnce(async () => {
      throw new Error('mute failed');
    });

    await adapter.turnControl?.endTurn();

    const err = events.find((e) => e.type === 'error');
    expect(
      err?.type === 'error' && (err.error as RealtimeVoiceError).code,
    ).toBe('CONNECTION_FAILED');
    // A mute failure is loss of the connection (fatal): the session tears down,
    // so we must not publish turn_end over the dead channel or emit thinking.
    expect(mockPublishData).not.toHaveBeenCalled();
    expect(states(events)).not.toContain('thinking');
  });

  test('startTurn surfaces a CONNECTION_FAILED when unmuting rejects and skips listening', async () => {
    const { adapter, events } = makeAdapter();
    await adapter.connect({ tools: [], instructions: '' });
    mockSetMicrophoneEnabled.mockImplementationOnce(async () => {
      throw new Error('unmute failed');
    });

    await adapter.turnControl?.startTurn();

    const err = events.find((e) => e.type === 'error');
    expect(
      err?.type === 'error' && (err.error as RealtimeVoiceError).code,
    ).toBe('CONNECTION_FAILED');
    // Mic never went hot, so we must not claim to be listening.
    expect(states(events)).not.toContain('listening');
  });

  test('startTurn maps a mic-permission denial to MIC_PERMISSION_DENIED', async () => {
    const { adapter, events } = makeAdapter();
    await adapter.connect({ tools: [], instructions: '' });
    const denied = Object.assign(new Error('Permission denied'), {
      name: 'PermissionDeniedError',
    });
    mockSetMicrophoneEnabled.mockImplementationOnce(async () => {
      throw denied;
    });

    await adapter.turnControl?.startTurn();

    const err = events.find((e) => e.type === 'error');
    expect(
      err?.type === 'error' && (err.error as RealtimeVoiceError).code,
    ).toBe('MIC_PERMISSION_DENIED');
    expect(states(events)).not.toContain('listening');
  });

  test('a barge-in during speaking publishes tts_cancel then still unmutes and listens', async () => {
    const { adapter, events } = makeAdapter();
    await adapter.connect({ tools: [], instructions: '' });

    // Assistant is speaking; the user barges in.
    await adapter.sendToolResult('call-1' as never, {
      ok: true,
      summary: 'Talking…',
    });
    expect(states(events).at(-1)).toBe('speaking');
    mockSetMicrophoneEnabled.mockClear();
    mockPublishData.mockClear();

    await adapter.turnControl?.startTurn();

    const [payload, opts] = mockPublishData.mock.calls.at(-1) as unknown as [
      Uint8Array,
      { reliable: boolean; topic: string },
    ];
    expect(opts).toEqual({ reliable: true, topic: TURN_TOPIC });
    expect(JSON.parse(new TextDecoder().decode(payload))).toEqual({
      type: 'tts_cancel',
    });
    expect(mockSetMicrophoneEnabled).toHaveBeenCalledWith(true);
    expect(states(events).at(-1)).toBe('listening');
  });

  test('mutes already-playing remote audio before awaiting the cancel publish', async () => {
    const { adapter } = makeAdapter();
    await adapter.connect({ tools: [], instructions: '' });
    let audio!: HTMLAudioElement;
    currentRoom._emit('trackSubscribed', {
      kind: 'audio',
      mediaStream: { id: 'tts-stream' },
      attach: (element: HTMLAudioElement) => {
        audio = element;
      },
    });
    await adapter.sendToolResult('call-1' as never, {
      ok: true,
      summary: 'Talking.',
    });
    expect(audio).toBeDefined();
    audio.muted = false;
    Object.defineProperty(audio, 'paused', {
      configurable: true,
      value: false,
    });
    mockSetMicrophoneEnabled.mockClear();

    let releaseCancel!: () => void;
    mockPublishData.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          expect(audio.muted).toBe(true);
          expect(audio.paused).toBe(false);
          releaseCancel = resolve;
        }),
    );

    const starting = adapter.turnControl?.startTurn();
    await Promise.resolve();
    expect(audio.muted).toBe(true);
    expect(mockSetMicrophoneEnabled).not.toHaveBeenCalledWith(true);

    releaseCancel();
    await starting;
  });

  test('latches a barge-in mute before the remote audio sink is attached', async () => {
    const { adapter } = makeAdapter();
    await adapter.connect({ tools: [], instructions: '' });
    await adapter.sendToolResult('call-1' as never, {
      ok: true,
      summary: 'Talking.',
    });

    await adapter.turnControl?.startTurn();

    let audio!: HTMLAudioElement;
    let mutedAtAttach: boolean | undefined;
    currentRoom._emit('trackSubscribed', {
      kind: 'audio',
      mediaStream: { id: 'tts-stream' },
      attach: (element: HTMLAudioElement) => {
        audio = element;
        mutedAtAttach = element.muted;
      },
    });
    expect(mutedAtAttach).toBe(true);

    await adapter.sendToolResult('call-2' as never, {
      ok: true,
      summary: 'New turn.',
    });
    expect(audio.muted).toBe(false);
  });

  test('serializes endTurn behind a delayed barge-in start so the hidden turn stays muted', async () => {
    const { adapter } = makeAdapter();
    await adapter.connect({ tools: [], instructions: '' });
    await adapter.sendToolResult('call-1' as never, {
      ok: true,
      summary: 'Talking.',
    });
    mockSetMicrophoneEnabled.mockClear();
    mockPublishData.mockClear();
    let releaseCancel!: () => void;
    mockPublishData.mockImplementationOnce(
      () => new Promise<void>((resolve) => (releaseCancel = resolve)),
    );

    const starting = adapter.turnControl?.startTurn();
    await Promise.resolve();
    const ending = adapter.turnControl?.endTurn();
    await Promise.resolve();

    releaseCancel();
    await Promise.all([starting, ending]);

    expect(mockSetMicrophoneEnabled.mock.calls.map((call) => call[0])).toEqual([
      true,
      false,
    ]);
    const publishCalls = mockPublishData.mock.calls as unknown as [
      Uint8Array,
      unknown,
    ][];
    const turnMessages = publishCalls.map(([payload]) =>
      JSON.parse(new TextDecoder().decode(payload)),
    );
    expect(turnMessages).toEqual([
      { type: 'tts_cancel' },
      { type: 'turn_end' },
    ]);
  });

  test('disconnect fences an in-flight start and its queued end from a replacement room', async () => {
    const { adapter, events } = makeAdapter();
    await adapter.connect({ tools: [], instructions: '' });
    await adapter.sendToolResult('call-1' as never, {
      ok: true,
      summary: 'Talking.',
    });
    mockSetMicrophoneEnabled.mockClear();
    mockPublishData.mockClear();
    let releaseCancel!: () => void;
    mockPublishData.mockImplementationOnce(
      () => new Promise<void>((resolve) => (releaseCancel = resolve)),
    );

    const starting = adapter.turnControl?.startTurn();
    await Promise.resolve();
    const ending = adapter.turnControl?.endTurn();
    await Promise.resolve();

    await adapter.disconnect();
    currentRoom = makeMockRoom();
    await adapter.connect({ tools: [], instructions: '' });
    const stateCountAfterReconnect = states(events).length;
    mockSetMicrophoneEnabled.mockClear();
    mockPublishData.mockClear();

    releaseCancel();
    await Promise.all([starting, ending]);

    expect(mockSetMicrophoneEnabled).not.toHaveBeenCalled();
    expect(mockPublishData).not.toHaveBeenCalled();
    expect(states(events).slice(stateCountAfterReconnect)).toEqual([]);

    await adapter.turnControl?.startTurn();
    await adapter.turnControl?.endTurn();

    expect(mockSetMicrophoneEnabled.mock.calls.map((call) => call[0])).toEqual([
      true,
      false,
    ]);
    expect(mockPublishData).toHaveBeenCalledTimes(1);
  });

  test('does not mute playback for an ordinary listening start', async () => {
    const { adapter } = makeAdapter();
    await adapter.connect({ tools: [], instructions: '' });
    let audio!: HTMLAudioElement;
    currentRoom._emit('trackSubscribed', {
      kind: 'audio',
      mediaStream: { id: 'tts-stream' },
      attach: (element: HTMLAudioElement) => {
        audio = element;
      },
    });

    await adapter.turnControl?.startTurn();

    expect(audio.muted).toBe(false);
  });

  test('stale TTS completion does not unmute a barge-in-muted player', async () => {
    const { adapter } = makeAdapter();
    await adapter.connect({ tools: [], instructions: '' });
    let audio!: HTMLAudioElement;
    currentRoom._emit('trackSubscribed', {
      kind: 'audio',
      mediaStream: { id: 'tts-stream' },
      attach: (element: HTMLAudioElement) => {
        audio = element;
      },
    });
    await adapter.sendToolResult('call-1' as never, {
      ok: true,
      summary: 'Talking.',
    });
    await adapter.turnControl?.startTurn();

    currentRoom._emit(
      'dataReceived',
      encodeTts('tts_done'),
      undefined,
      undefined,
      TTS_TOPIC,
    );

    expect(audio.muted).toBe(true);
  });

  test('the next assistant TTS handoff unmutes playback', async () => {
    const { adapter } = makeAdapter();
    await adapter.connect({ tools: [], instructions: '' });
    let audio!: HTMLAudioElement;
    currentRoom._emit('trackSubscribed', {
      kind: 'audio',
      mediaStream: { id: 'tts-stream' },
      attach: (element: HTMLAudioElement) => {
        audio = element;
      },
    });
    await adapter.sendToolResult('call-1' as never, {
      ok: true,
      summary: 'Talking.',
    });
    await adapter.turnControl?.startTurn();
    expect(audio.muted).toBe(true);

    await adapter.sendToolResult('call-2' as never, {
      ok: true,
      summary: 'New turn.',
    });

    expect(audio.muted).toBe(false);
  });

  test('repeated barge-in calls publish one cancel and enable the mic once', async () => {
    const { adapter } = makeAdapter();
    await adapter.connect({ tools: [], instructions: '' });
    await adapter.sendToolResult('call-1' as never, {
      ok: true,
      summary: 'Talking.',
    });
    mockPublishData.mockClear();
    mockSetMicrophoneEnabled.mockClear();
    let releaseCancel!: () => void;
    mockPublishData.mockImplementationOnce(
      () => new Promise<void>((resolve) => (releaseCancel = resolve)),
    );

    const first = adapter.turnControl?.startTurn();
    const second = adapter.turnControl?.startTurn();
    await Promise.resolve();
    releaseCancel();
    await Promise.all([first, second]);

    expect(mockPublishData).toHaveBeenCalledTimes(1);
    expect(mockSetMicrophoneEnabled).toHaveBeenCalledTimes(1);
  });

  test('repeated end calls share one native mute, pause, and turn_end operation', async () => {
    const pause = deferred<void>();
    const { adapter } = makeAdapter(undefined, { vad: false });
    await adapter.connect({ tools: [], instructions: '' });
    mockSetMicrophoneEnabled.mockClear();
    mockPauseUpstream.mockClear();
    mockPublishData.mockClear();
    mockPauseUpstream.mockImplementationOnce(() => pause.promise);

    const first = adapter.turnControl?.endTurn();
    const second = adapter.turnControl?.endTurn();
    for (let attempts = 0; attempts < 10; attempts += 1) {
      if (mockPauseUpstream.mock.calls.length > 0) break;
      await Promise.resolve();
    }

    expect(mockSetMicrophoneEnabled).toHaveBeenCalledTimes(1);
    expect(mockPauseUpstream).toHaveBeenCalledTimes(1);
    expect(mockPublishData).not.toHaveBeenCalled();

    pause.resolve();
    await Promise.all([first, second]);

    expect(mockPublishData).toHaveBeenCalledTimes(1);
  });

  test('a startTurn from connected (no assistant audio) does not publish tts_cancel', async () => {
    const { adapter } = makeAdapter();
    await adapter.connect({ tools: [], instructions: '' });
    mockPublishData.mockClear();

    await adapter.turnControl?.startTurn();

    expect(mockPublishData).not.toHaveBeenCalled();
  });

  test('a tts_cancel publish rejection is non-fatal: no error event, warns once, and the turn still proceeds', async () => {
    const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const { adapter, events } = makeAdapter();
      await adapter.connect({ tools: [], instructions: '' });

      // First barge-in: assistant speaking, cancel publish rejects.
      await adapter.sendToolResult('call-1' as never, {
        ok: true,
        summary: 'Talking…',
      });
      mockSetMicrophoneEnabled.mockClear();
      mockPublishData.mockImplementationOnce(async () => {
        throw new Error('data channel closed');
      });

      await adapter.turnControl?.startTurn();

      // A failed TTS cancel is non-fatal — no RealtimeVoiceError (which
      // RealtimeSession treats as session-fatal) may be emitted.
      expect(events.some((e) => e.type === 'error')).toBe(false);
      // The turn still proceeds: mic unmuted, listening emitted.
      expect(mockSetMicrophoneEnabled).toHaveBeenCalledWith(true);
      expect(states(events).at(-1)).toBe('listening');

      const cancelWarns = () =>
        warnSpy.mock.calls.filter(
          (c) => typeof c[1] === 'string' && c[1].includes('TTS cancel'),
        ).length;
      expect(cancelWarns()).toBe(1);

      // Second barge-in with the same failure warns no further (warn-once per
      // connection via #warnedNonFatalKinds).
      await adapter.sendToolResult('call-2' as never, {
        ok: true,
        summary: 'Talking…',
      });
      mockPublishData.mockImplementationOnce(async () => {
        throw new Error('data channel closed');
      });
      await adapter.turnControl?.startTurn();
      expect(cancelWarns()).toBe(1);
    } finally {
      warnSpy.mockRestore();
    }
  });

  test('a microphone-enable failure recovers playback from the barge-in mute', async () => {
    const { adapter } = makeAdapter();
    await adapter.connect({ tools: [], instructions: '' });
    let audio!: HTMLAudioElement;
    currentRoom._emit('trackSubscribed', {
      kind: 'audio',
      mediaStream: { id: 'tts-stream' },
      attach: (element: HTMLAudioElement) => {
        audio = element;
      },
    });
    await adapter.sendToolResult('call-1' as never, {
      ok: true,
      summary: 'Talking.',
    });
    mockSetMicrophoneEnabled.mockImplementationOnce(async () => {
      throw new Error('mic unavailable');
    });

    await adapter.turnControl?.startTurn();

    expect(audio.muted).toBe(false);
  });

  test('a cancel publish failure leaves a recoverable mute until the next TTS handoff', async () => {
    const { adapter } = makeAdapter();
    await adapter.connect({ tools: [], instructions: '' });
    let audio!: HTMLAudioElement;
    currentRoom._emit('trackSubscribed', {
      kind: 'audio',
      mediaStream: { id: 'tts-stream' },
      attach: (element: HTMLAudioElement) => {
        audio = element;
      },
    });
    await adapter.sendToolResult('call-1' as never, {
      ok: true,
      summary: 'Talking.',
    });
    mockPublishData.mockImplementationOnce(async () => {
      throw new Error('data channel closed');
    });

    await adapter.turnControl?.startTurn();

    expect(audio.muted).toBe(true);
    await adapter.sendToolResult('call-2' as never, {
      ok: true,
      summary: 'Recovered.',
    });
    expect(audio.muted).toBe(false);
  });

  test('a tts_done arriving after a barge-in does not stomp the newer listening state', async () => {
    const { adapter, events } = makeAdapter();
    await adapter.connect({ tools: [], instructions: '' });

    // Assistant starts speaking, then the user barges in (push-to-talk) while
    // audio is still playing — state advances to listening.
    await adapter.sendToolResult('call-1' as never, {
      ok: true,
      summary: 'Talking…',
    });
    expect(states(events).at(-1)).toBe('speaking');
    await adapter.turnControl?.startTurn();
    expect(states(events).at(-1)).toBe('listening');

    // The now-stale worker tts_done must NOT collapse back to connected.
    currentRoom._emit(
      'dataReceived',
      encodeTts('tts_done'),
      undefined,
      undefined,
      TTS_TOPIC,
    );
    expect(states(events).at(-1)).toBe('listening');
  });

  test('disconnect removes the hidden player and resets its mute state', async () => {
    const { adapter } = makeAdapter();
    await adapter.connect({ tools: [], instructions: '' });
    let audio!: HTMLAudioElement;
    currentRoom._emit('trackSubscribed', {
      kind: 'audio',
      mediaStream: { id: 'tts-stream' },
      attach: (element: HTMLAudioElement) => {
        audio = element;
      },
    });
    await adapter.sendToolResult('call-1' as never, {
      ok: true,
      summary: 'Talking.',
    });
    await adapter.turnControl?.startTurn();
    expect(audio.muted).toBe(true);
    const removeSpy = spyOn(audio, 'remove');

    await adapter.disconnect();

    expect(audio.muted).toBe(false);
    expect(removeSpy).toHaveBeenCalledTimes(1);
    expect(adapter.getAudioStreams().playback).toBeUndefined();
  });

  test('disconnect clears a latched mute before reconnect attaches a sink', async () => {
    const { adapter } = makeAdapter();
    await adapter.connect({ tools: [], instructions: '' });
    await adapter.sendToolResult('call-1' as never, {
      ok: true,
      summary: 'Talking.',
    });
    await adapter.turnControl?.startTurn();

    await adapter.disconnect();
    currentRoom = makeMockRoom();
    await adapter.connect({ tools: [], instructions: '' });

    let audio!: HTMLAudioElement;
    currentRoom._emit('trackSubscribed', {
      kind: 'audio',
      mediaStream: { id: 'next-tts-stream' },
      attach: (element: HTMLAudioElement) => {
        audio = element;
      },
    });

    expect(audio.muted).toBe(false);
  });
});

describe('LiveKitAdapter TTS utterance-id staleness', () => {
  beforeEach(() => {
    currentRoom = makeMockRoom();
    mockSetMicrophoneEnabled.mockReset();
    mockPublishData.mockReset();
    mockSendText.mockReset();
    mockSendText.mockImplementation(async () => ({}));
  });

  const settle = (ms: number) => new Promise((r) => setTimeout(r, ms));

  test('a current-utterance tts_done collapses speaking normally', async () => {
    const { adapter, events } = makeAdapter();
    await adapter.connect({ tools: [], instructions: '' });

    await adapter.sendToolResult('call-1' as never, {
      ok: true,
      summary: 'Done.',
    });
    expect(states(events).at(-1)).toBe('speaking');

    // The worker echoes the utterance id the client stamped on the speak stream.
    currentRoom._emit(
      'dataReceived',
      encodeTtsWithId('tts_done', lastUtteranceId()),
      undefined,
      undefined,
      TTS_TOPIC,
    );
    expect(states(events).at(-1)).toBe('connected');
  });

  test('client stamps the utterance id on the speak text stream', async () => {
    const { adapter } = makeAdapter();
    await adapter.connect({ tools: [], instructions: '' });

    await adapter.sendToolResult('call-1' as never, {
      ok: true,
      summary: 'Done.',
    });

    const opts = mockSendText.mock.calls.at(-1)?.[1] as {
      topic: string;
      attributes?: Record<string, string>;
    };
    expect(opts.topic).toBe(SPEAK_TOPIC);
    expect(Number(opts.attributes?.[SPEAK_UTTERANCE_ID_ATTR])).toBeGreaterThan(
      0,
    );
  });

  test('a stale tts_done from a barged-past utterance is a no-op: fallback not cleared, state unchanged, and the fallback still fires', async () => {
    const { adapter, events } = makeAdapter(undefined, {
      thinkingFallbackMs: 20,
    });
    await adapter.connect({ tools: [], instructions: '' });

    // Assistant is speaking utterance A.
    await adapter.sendToolResult('call-1' as never, {
      ok: true,
      summary: 'Talking…',
    });
    const utteranceA = lastUtteranceId();
    expect(states(events).at(-1)).toBe('speaking');

    // User barges in (invalidating A) then releases without speaking → thinking +
    // armed empty-turn fallback.
    await adapter.turnControl?.startTurn();
    await adapter.turnControl?.endTurn();
    expect(states(events).at(-1)).toBe('thinking');

    // The cancelled utterance A's tts_done still arrives (the worker's clearQueue
    // resolved its playout). It must be dropped whole: no fallback clear, no state
    // change — otherwise the UI wedges in `thinking`.
    currentRoom._emit(
      'dataReceived',
      encodeTtsWithId('tts_done', utteranceA),
      undefined,
      undefined,
      TTS_TOPIC,
    );
    expect(states(events).at(-1)).toBe('thinking');

    // Fallback was NOT cleared by the stale packet, so it still rescues the UI.
    await settle(50);
    expect(states(events).at(-1)).toBe('connected');
  });
});

describe('LiveKitAdapter thinking fallback', () => {
  beforeEach(() => {
    currentRoom = makeMockRoom();
    mockSetMicrophoneEnabled.mockReset();
    mockPublishData.mockReset();
  });

  const settle = (ms: number) => new Promise((r) => setTimeout(r, ms));

  test('an empty turn falls back from thinking to connected after the timeout', async () => {
    const { adapter, events } = makeAdapter(undefined, {
      thinkingFallbackMs: 10,
    });
    await adapter.connect({ tools: [], instructions: '' });

    await adapter.turnControl?.endTurn();
    expect(states(events).at(-1)).toBe('thinking');

    await settle(40);
    // Nothing arrived from the worker — the client unwedges itself.
    expect(states(events).at(-1)).toBe('connected');
  });

  test('a transcript arriving cancels the thinking fallback', async () => {
    const { adapter, events } = makeAdapter(undefined, {
      thinkingFallbackMs: 10,
    });
    await adapter.connect({ tools: [], instructions: '' });

    await adapter.turnControl?.endTurn();
    currentRoom._emit('transcriptionReceived', [
      { text: 'hello', final: true },
    ]);

    await settle(40);
    // The worker responded, so the fallback must not fire a spurious connected;
    // the state stays thinking until real activity moves it.
    expect(states(events).at(-1)).toBe('thinking');
  });

  test('a tts signal cancels the thinking fallback', async () => {
    const { adapter, events } = makeAdapter(undefined, {
      thinkingFallbackMs: 10,
    });
    await adapter.connect({ tools: [], instructions: '' });

    await adapter.turnControl?.endTurn();
    // A tts signal means the worker is alive and driving state.
    currentRoom._emit(
      'dataReceived',
      encodeTts('tts_error'),
      undefined,
      undefined,
      TTS_TOPIC,
    );

    await settle(40);
    // Only the tts_error's own error path may have run; no fallback connected.
    expect(states(events).at(-1)).not.toBe('connected');
  });

  test('a fallback that fires after a barge-in does not stomp listening', async () => {
    const { adapter, events } = makeAdapter(undefined, {
      thinkingFallbackMs: 10,
    });
    await adapter.connect({ tools: [], instructions: '' });

    await adapter.turnControl?.endTurn();
    await adapter.turnControl?.startTurn();
    expect(states(events).at(-1)).toBe('listening');

    await settle(40);
    expect(states(events).at(-1)).toBe('listening');
  });
});

describe('LiveKitAdapter misc surface', () => {
  beforeEach(() => {
    currentRoom = makeMockRoom();
    mockRoomDisconnect.mockReset();
    mockRoomDisconnect.mockImplementation(async () => {});
    mockSetMicrophoneEnabled.mockReset();
    mockSetMicrophoneEnabled.mockImplementation(async (enabled: boolean) => {
      mockPublishedMicTrack.enabled = enabled;
    });
    mockPublishedMicTrack.enabled = false;
    mockMicCloneTrack.enabled = false;
    mockPublishedMicTrack.clone.mockClear();
    mockPublishedMicTrack.stop.mockClear();
    mockMicCloneTrack.stop.mockClear();
  });

  test('a worker tts_error is non-fatal: no error event, and speaking collapses', async () => {
    const { adapter, events } = makeAdapter();
    await adapter.connect({ tools: [], instructions: '' });

    // The update_ui already rendered; only its spoken read-back failed.
    await adapter.sendToolResult('call-1' as never, {
      ok: true,
      summary: 'Done.',
    });
    expect(states(events).at(-1)).toBe('speaking');

    currentRoom._emit(
      'dataReceived',
      encodeTts('tts_error'),
      undefined,
      undefined,
      TTS_TOPIC,
    );

    // Non-fatal: no RealtimeVoiceError (which would tear the session down)...
    expect(events.some((e) => e.type === 'error')).toBe(false);
    // ...and the transient speaking state is released so the UI doesn't hang.
    expect(states(events).at(-1)).toBe('connected');
  });

  test('a malformed TTS_TOPIC packet is non-fatal and collapses speaking', async () => {
    const { adapter, events } = makeAdapter();
    await adapter.connect({ tools: [], instructions: '' });

    await adapter.sendToolResult('call-1' as never, {
      ok: true,
      summary: 'Done.',
    });
    expect(states(events).at(-1)).toBe('speaking');

    currentRoom._emit(
      'dataReceived',
      new TextEncoder().encode('not json'),
      undefined,
      undefined,
      TTS_TOPIC,
    );

    expect(events.some((e) => e.type === 'error')).toBe(false);
    expect(states(events).at(-1)).toBe('connected');
  });

  test('getAudioStreams exposes an enabled clone independent of the muted publication', async () => {
    const { adapter } = makeAdapter();

    // Before connect: no room, so both streams are undefined.
    expect(adapter.getAudioStreams()).toEqual({
      mic: undefined,
      playback: undefined,
    });

    await adapter.connect({ tools: [], instructions: '' });

    const mic = adapter.getAudioStreams().mic;
    expect(mic?.getAudioTracks()[0]).toBe(
      mockMicCloneTrack as unknown as MediaStreamTrack,
    );
    expect(mockPublishedMicTrack.enabled).toBe(false);
    expect(mockMicCloneTrack.enabled).toBe(true);
    expect(mockPublishedMicTrack.clone).toHaveBeenCalledTimes(1);
    expect(adapter.getAudioStreams().mic).toBe(mic);
    expect(adapter.getAudioStreams().mic?.getAudioTracks()[0]).toBe(
      mockMicCloneTrack as unknown as MediaStreamTrack,
    );

    // Turn control continues to mute/unmute only the published transport track.
    await adapter.turnControl?.startTurn();
    expect(mockPublishedMicTrack.enabled).toBe(true);
    expect(mockMicCloneTrack.enabled).toBe(true);
    await adapter.turnControl?.endTurn();
    expect(mockPublishedMicTrack.enabled).toBe(false);
    expect(mockMicCloneTrack.enabled).toBe(true);
    expect(mockMicCloneTrack.stop).not.toHaveBeenCalled();

    // Playback is undefined until the worker's TTS track is subscribed.
    expect(adapter.getAudioStreams().playback).toBeUndefined();

    const playbackStream = { id: 'tts-stream' } as unknown as MediaStream;
    currentRoom._emit('trackSubscribed', {
      kind: 'audio',
      mediaStream: playbackStream,
      attach: () => {},
    });
    expect(adapter.getAudioStreams().playback).toBe(playbackStream);

    // After disconnect both streams drop.
    await adapter.disconnect();
    expect(adapter.getAudioStreams()).toEqual({
      mic: undefined,
      playback: undefined,
    });
    expect(mockMicCloneTrack.stop).toHaveBeenCalledTimes(1);
    expect(mockPublishedMicTrack.stop).toHaveBeenCalledTimes(1);
  });

  test('stops a clone exactly once when a connect attempt fails after cloning', async () => {
    const { adapter } = makeAdapter();
    mockPublishTrack.mockImplementationOnce(async () => {
      throw new Error('mute failed');
    });

    const error = await adapter.connect({ tools: [], instructions: '' }).then(
      () => undefined,
      (cause: unknown) => cause,
    );

    expect(error).toBeInstanceOf(RealtimeVoiceError);
    expect((error as RealtimeVoiceError).cause).toMatchObject({
      message: 'mute failed',
    });

    expect(mockPublishedMicTrack.clone).toHaveBeenCalledTimes(1);
    expect(mockMicCloneTrack.stop).toHaveBeenCalledTimes(1);
    expect(adapter.getAudioStreams()).toEqual({
      mic: undefined,
      playback: undefined,
    });
  });

  test('stops the old clone before creating one for a reconnect', async () => {
    const { adapter } = makeAdapter();
    await adapter.connect({ tools: [], instructions: '' });
    const firstClone = mockMicCloneTrack;

    await adapter.disconnect();
    expect(firstClone.stop).toHaveBeenCalledTimes(1);

    // The mock returns the same object, so reset its stop count to distinguish
    // the new connection's cleanup from the first connection's cleanup.
    firstClone.stop.mockClear();
    await adapter.connect({ tools: [], instructions: '' });
    expect(mockPublishedMicTrack.clone).toHaveBeenCalledTimes(2);
    expect(adapter.getAudioStreams().mic?.getAudioTracks()[0]).toBe(
      firstClone as unknown as MediaStreamTrack,
    );

    await adapter.disconnect();
    expect(firstClone.stop).toHaveBeenCalledTimes(1);
  });

  test('injectGrounding is a no-op and never throws', async () => {
    const { adapter } = makeAdapter();
    await adapter.connect({ tools: [], instructions: '' });
    expect(() => adapter.injectGrounding('anything')).not.toThrow();
  });

  test('on() returns an unsubscribe that stops delivery', async () => {
    const { adapter } = makeAdapter();
    const received: RealtimeAdapterEvent[] = [];
    const off = adapter.on((e) => received.push(e));
    off();

    await adapter.connect({ tools: [], instructions: '' });
    expect(received.length).toBe(0);
  });
});
