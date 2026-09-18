import {
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  spyOn,
  test,
} from 'bun:test';
import type { RealtimeAdapterEvent } from '@maelstrom-co/realtime';
import {
  GreetingCoordinator,
  RealtimeSession,
  RealtimeVoiceError,
} from '@maelstrom-co/realtime';
import type { UnixSeconds } from '@maelstrom-co/realtime-protocol';
import type { LiveKitTokenGrant } from '@maelstrom-co/realtime-protocol/livekit';
import type { LocalAudioPreRoll } from '@maelstrom-co/realtime-vad';
import './__tests__/setup.js';
import type { LiveKitAdapterOptions } from './livekit-adapter.types.js';

// --- Mocks for livekit-client ---

const mockRoomConnect = mock(async () => {});
const mockRoomDisconnect = mock(async () => {});
const mockPublishData = mock(async () => {});
const mockSendText = mock(async (_text: string, _opts?: unknown) => ({}));
const mockStartAudio = mock(async () => {});
const mockPauseUpstream = mock(async () => {});
const mockResumeUpstream = mock(async () => {});
const mockReplaceTrack = mock(
  async (_track?: unknown, _options?: unknown) => {},
);
const mockMuteLocalMic = mock(async () => {});
const mockUnmuteLocalMic = mock(async () => {});
const mockCreateLocalAudioTrack = mock(
  async (_options?: unknown) => mockMicPublication.track,
);
const mockPublishTrack = mock(async (_track: unknown) => mockMicPublication);
const mockGetTrackPublication = mock((_source: string) => mockMicPublication);
const mockBridgeStartAutomaticTurn = mock(async (_preRollMs: number) => {});
const mockBridgeStartManualTurn = mock(async () => {});
const mockBridgeClear = mock(async () => {});
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
  clear: mockBridgeClear,
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
  getSettings: mock(() => ({}) as MediaTrackSettings),
  clone: mock(() => mockMicCloneTrack),
  stop: mock(() => {}),
};
const mockMicCloneTrack = {
  enabled: false,
  clone: mock(() => mockManualReplacementTrack),
  stop: mock(() => {}),
};
const mockManualReplacementTrack = {
  enabled: true,
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
  getTrackPublication: mockGetTrackPublication,
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
/** Counts `new Room()` constructions across the livekit-client mock. */
let roomConstructCount = 0;
/** Ordered lifecycle probes for gesture-unlock / connect sequencing tests. */
const lifecycleOrder: string[] = [];

mock.module('livekit-client', () => ({
  ParticipantKind: { AGENT: 4 },
  createLocalAudioTrack: mockCreateLocalAudioTrack,
  Room: class {
    constructor() {
      roomConstructCount += 1;
      lifecycleOrder.push('Room');
    }
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
    ParticipantDisconnected: 'participantDisconnected',
  },
  Track: { Kind: { Audio: 'audio' }, Source: { Microphone: 'microphone' } },
  setLogLevel: mock(() => {}),
}));

mock.module('@ricky0123/vad-web', () => ({
  MicVAD: { new: mockMicVADNew },
}));

const realtimeVad = await import('@maelstrom-co/realtime-vad');
mock.module('@maelstrom-co/realtime-vad', () => ({
  ...realtimeVad,
  createLocalAudioPreRoll: mockCreateLocalAudioPreRoll,
}));

const { LiveKitAdapter } = await import('./livekit-adapter');
const {
  SPEAK_TOPIC,
  SPEAK_UTTERANCE_ID_ATTR,
  TURN_TOPIC,
  TTS_TOPIC,
  TTS_READY_TOPIC,
} = await import('@maelstrom-co/realtime-protocol/livekit');
const { MessageId } = await import('@maelstrom-co/protocol');
const { SessionId } = await import('@maelstrom-co/protocol');

describe('real-session LiveKit trigger admission', () => {
  afterEach(() => {
    mockPublishData.mockImplementation(async () => {});
    mockSetMicrophoneEnabled.mockImplementation(async (enabled: boolean) => {
      mockPublishedMicTrack.enabled = enabled;
    });
  });
  beforeEach(() => {
    currentRoom = makeMockRoom();
    mockCreateLocalAudioTrack.mockClear();
    mockPublishData.mockClear();
    mockPublishData.mockImplementation(async () => {});
    mockSendText.mockClear();
    mockSetMicrophoneEnabled.mockImplementation(async (enabled: boolean) => {
      mockPublishedMicTrack.enabled = enabled;
    });
    capturedVadOptions.length = 0;
    mockBridgeStartAutomaticTurn.mockClear();
    mockCreateLocalAudioPreRoll.mockImplementation(async () => {
      throw new Error('AudioWorklet unavailable');
    });
  });
  const worker = { identity: 'worker', sid: 'worker-1', kind: 4 };
  const packet = (value: unknown, participant = worker) =>
    currentRoom._emit(
      'dataReceived',
      new TextEncoder().encode(JSON.stringify(value)),
      participant,
      undefined,
      'trigger-turn',
    );
  const terminal = (boundary: Record<string, unknown>, text: string) =>
    packet({ ...boundary, type: 'turn_result', outcome: 'success', text });
  async function setup(
    onActivate?: () => Promise<void>,
    drainTimeoutMs = 5000,
    acknowledge = true,
    vad: LiveKitAdapterOptions['vad'] = false,
  ) {
    const { adapter, events } = makeAdapter(undefined, { vad });
    const intents: string[] = [];
    const session = new RealtimeSession({
      adapter,
      sessionId: SessionId('livekit-trigger'),
      greeting: { text: 'Welcome', coordinator: new GreetingCoordinator() },
      activation: {
        mode: 'trigger',
        phrase: 'hello maelstrom',
        inactivityMs: 1000,
        onActivate,
      },
      instance: {
        submitIntent: async (text) => {
          intents.push(text);
          return { userMessage: 'Done' };
        },
        waitForIdle: async () => {},
        getStructuralSnapshot: () => ({
          instances: [],
          layout: null,
          layoutMode: 'grid',
          chartDimensions: { rows: 8, columns: 12 },
        }),
        getCapabilitySnapshot: () => {
          throw new Error('not used');
        },
        onSettled: () => () => {},
        addAssistantMessageAcknowledged: async () => 'inserted',
        observeEngineConnection: (cb) => {
          cb(true);
          return () => {};
        },
      },
    });
    const connected = session.connect();
    connected.catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, 10));
    const call = mockPublishData.mock.calls.at(-1) as unknown as [Uint8Array];
    expect(call).toBeDefined();
    const request = JSON.parse(new TextDecoder().decode(call[0]));
    expect(request.type).toBe('turn_capability');
    expect(mockCreateLocalAudioTrack).not.toHaveBeenCalled();
    packet(
      { ...request, type: 'turn_capability_ack', drainTimeoutMs },
      { ...worker, kind: 0 },
    );
    packet({
      ...request,
      type: 'turn_capability_ack',
      nonce: 'wrong',
      drainTimeoutMs,
    });
    expect(mockCreateLocalAudioTrack).not.toHaveBeenCalled();
    if (acknowledge)
      packet({ ...request, type: 'turn_capability_ack', drainTimeoutMs });
    await connected;
    const end = async () => {
      await adapter.turnControl?.startTurn();
      await adapter.turnControl?.endTurn();
      const args = mockPublishData.mock.calls.at(-1) as unknown as [Uint8Array];
      return JSON.parse(new TextDecoder().decode(args[0]));
    };
    return { adapter, session, intents, events, end };
  }

  test('holds a later final behind the trigger and hook without legacy captions or TTS', async () => {
    const hook = deferred<void>();
    const h = await setup(() => hook.promise);
    const first = await h.end();
    const second = await h.end();
    terminal(second, 'weather');
    currentRoom._emit('transcriptionReceived', [
      { final: true, text: 'legacy leak' },
    ]);
    expect(h.intents).toEqual([]);
    terminal(first, 'hello maelstrom');
    expect(h.session.activationState).toBe('activating');
    expect(h.events.filter((e) => e.type === 'transcript')).toEqual([]);
    hook.resolve();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(h.intents).toEqual(['weather']);
    expect(mockSendText).toHaveBeenCalledTimes(1);
    await h.session.disconnect();
  });

  test('empty and failed terminals advance source order; spoofed and duplicate results do not act', async () => {
    const h = await setup();
    const empty = await h.end();
    const failed = await h.end();
    const wake = await h.end();
    terminal(wake, 'hello maelstrom');
    expect(h.session.activationState).toBe('waiting');
    packet({ ...empty, type: 'turn_result', outcome: 'empty', text: '' });
    packet({ ...failed, type: 'turn_result', outcome: 'error', text: '' });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(h.session.activationState).toBe('active');
    expect(h.intents).toEqual([]);
    const request = await h.end();
    const result = {
      ...request,
      type: 'turn_result',
      outcome: 'success',
      text: 'weather',
    };
    packet(result, { ...worker, sid: 'replacement' });
    packet({ ...result, nonce: 'retired' });
    expect(h.intents).toEqual([]);
    packet(result);
    packet(result);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(h.intents).toEqual(['weather']);
    await h.session.disconnect();
    packet(result);
    expect(h.intents).toEqual(['weather']);
  });

  for (const outcome of ['resolve', 'reject', 'timeout'] as const) {
    test(`continuing post-trigger speech survives hook ${outcome} without premature interruption`, async () => {
      const hook = deferred<void>();
      const h = await setup(() =>
        outcome === 'reject' ? Promise.reject(new Error('hook')) : hook.promise,
      );
      const wake = await h.end();
      await h.adapter.turnControl?.startTurn();
      terminal(wake, 'hello maelstrom');
      expect(h.session.activationState).toBe('activating');
      expect(mockSendText).not.toHaveBeenCalled();
      if (outcome === 'resolve') hook.resolve();
      await new Promise((resolve) =>
        setTimeout(resolve, outcome === 'timeout' ? 2050 : 10),
      );
      expect(h.session.activationState).toBe('active');
      await h.adapter.turnControl?.endTurn();
      const args = mockPublishData.mock.calls.at(-1) as unknown as [Uint8Array];
      const end = JSON.parse(new TextDecoder().decode(args[0]));
      terminal(end, 'weather');
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(h.intents).toEqual(['weather']);
      await h.session.disconnect();
    });
  }

  test('disconnect drops held text and a late hook cannot replay it', async () => {
    const hook = deferred<void>();
    const h = await setup(() => hook.promise);
    const wake = await h.end();
    const request = await h.end();
    terminal(wake, 'hello maelstrom');
    terminal(request, 'weather');
    await h.session.disconnect();
    hook.resolve();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(h.intents).toEqual([]);
    expect(mockSendText).not.toHaveBeenCalled();
  });

  test('playback owns inactivity until its trusted ID drains; expiry never cancels', async () => {
    const h = await setup();
    const wake = await h.end();
    terminal(wake, 'hello maelstrom');
    const request = await h.end();
    terminal(request, 'weather');
    await new Promise((resolve) => setTimeout(resolve, 10));
    const id = lastUtteranceId();
    currentRoom._emit(
      'dataReceived',
      encodeTtsWithId('tts_done', id + 1),
      worker,
      undefined,
      TTS_TOPIC,
    );
    currentRoom._emit(
      'dataReceived',
      encodeTtsWithId('tts_done', id),
      { ...worker, sid: 'other' },
      undefined,
      TTS_TOPIC,
    );
    await new Promise((resolve) => setTimeout(resolve, 1100));
    expect(h.session.activationState).toBe('active');
    currentRoom._emit(
      'dataReceived',
      encodeTtsWithId('tts_done', id),
      worker,
      undefined,
      TTS_TOPIC,
    );
    await new Promise((resolve) => setTimeout(resolve, 1100));
    expect(h.session.activationState).toBe('waiting');
    const controls = mockPublishData.mock.calls.map(
      (args) =>
        JSON.parse(
          new TextDecoder().decode((args as unknown as [Uint8Array])[0]),
        ).type,
    );
    expect(controls).not.toContain('tts_cancel');
    terminal(wake, 'hello maelstrom');
    expect(h.session.activationState).toBe('waiting');
    const extended = await h.end();
    terminal(extended, 'hello maelstrom show weather');
    expect(h.session.activationState).toBe('waiting');
    expect(h.intents).toEqual(['weather']);
    await h.session.disconnect();
  });

  test('admitted active speech retains barge-in cancellation', async () => {
    const h = await setup();
    const wake = await h.end();
    terminal(wake, 'hello maelstrom');
    const request = await h.end();
    terminal(request, 'weather');
    await new Promise((resolve) => setTimeout(resolve, 10));
    await h.adapter.turnControl?.startTurn();
    const args = mockPublishData.mock.calls.at(-1) as unknown as [Uint8Array];
    expect(JSON.parse(new TextDecoder().decode(args[0])).type).toBe(
      'tts_cancel',
    );
    await h.session.disconnect();
  });

  test('missing correlated result settles without late wake or legacy fallback', async () => {
    const h = await setup(undefined, 1);
    const wake = await h.end();
    await new Promise((resolve) => setTimeout(resolve, 5100));
    terminal(wake, 'hello maelstrom');
    expect(h.session.activationState).toBe('waiting');
    expect(h.intents).toEqual([]);
    await h.session.disconnect();
  }, 10000);

  test('an old worker fails setup before capture rather than using legacy transcripts', async () => {
    await expect(setup(undefined, 5000, false)).rejects.toMatchObject({
      code: 'ACTIVATION_ADAPTER_UNSUPPORTED',
    });
    expect(mockCreateLocalAudioTrack).not.toHaveBeenCalled();
  }, 10000);

  test('losing the pinned worker closes the connection rather than trusting a replacement', async () => {
    const h = await setup();
    currentRoom._emit('participantDisconnected', worker);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(h.session.state).toBe('error');
    expect(h.adapter.turnControl).toBeUndefined();
    await h.session.disconnect();
  });

  for (const outcome of ['reject', 'timeout'] as const) {
    test(`completed held input releases only after hook ${outcome}`, async () => {
      const hook = deferred<void>();
      const h = await setup(() =>
        hook.promise.then(() => {
          throw new Error('hook');
        }),
      );
      const wake = await h.end();
      const request = await h.end();
      terminal(request, 'weather');
      terminal(wake, 'hello maelstrom');
      expect(h.intents).toEqual([]);
      if (outcome === 'reject') hook.resolve();
      await new Promise((resolve) =>
        setTimeout(resolve, outcome === 'timeout' ? 2050 : 10),
      );
      expect(h.intents).toEqual(['weather']);
      await h.session.disconnect();
    });
  }

  test('automatic misfires settle their ordinal and preserve transported pre-roll overlap exclusion', async () => {
    mockCreateLocalAudioPreRoll.mockImplementation(async () => mockBridge);
    const h = await setup(undefined, 5000, true, { preRollMs: 250 });
    const vad = capturedVadOptions.at(-1) as {
      onSpeechStart: () => Promise<void>;
      onSpeechEnd: () => Promise<void>;
      onVADMisfire: () => Promise<void>;
    };
    const last = () => {
      const args = mockPublishData.mock.calls.at(-1) as unknown as [Uint8Array];
      return JSON.parse(new TextDecoder().decode(args[0]));
    };
    await vad.onSpeechStart();
    await vad.onVADMisfire();
    expect(last()).toMatchObject({
      type: 'turn_end',
      turnId: 1,
      cancelled: true,
    });
    terminal(last(), 'hello maelstrom');
    expect(h.session.activationState).toBe('waiting');
    await new Promise((resolve) => setTimeout(resolve, 260));
    await vad.onSpeechStart();
    await vad.onSpeechEnd();
    terminal(last(), 'hello maelstrom');
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(h.session.activationState).toBe('active');
    await vad.onSpeechStart();
    await vad.onSpeechEnd();
    terminal(last(), 'overlapping request');
    expect(h.intents).toEqual([]);
    expect(mockBridgeStartAutomaticTurn).toHaveBeenCalledWith(250);
    await h.session.disconnect();
  });

  test('VAD setup failure still permits a manual trigger and separate request', async () => {
    const h = await setup(undefined, 5000, true, true);
    expect(h.adapter.turnControl).toBeDefined();
    terminal(await h.end(), 'hello maelstrom');
    terminal(await h.end(), 'weather');
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(h.intents).toEqual(['weather']);
    await h.session.disconnect();
  });

  test('a failed manual start and cancellation publication fail the session closed', async () => {
    const h = await setup();
    mockSetMicrophoneEnabled.mockImplementation(async (enabled: boolean) => {
      if (enabled) throw new Error('capture failed');
    });
    mockPublishData.mockImplementation(async () => {
      throw new Error('publication failed');
    });
    await h.adapter.turnControl?.startTurn();
    expect(h.session.state).toBe('error');
    expect(h.intents).toEqual([]);
    await h.session.disconnect();
  });
});

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
  options: Pick<
    LiveKitAdapterOptions,
    'debug' | 'thinkingFallbackMs' | 'vad' | 'greetingReadyWaitMs'
  > = {},
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
    mockGetTrackPublication.mockReset();
    mockGetTrackPublication.mockImplementation(() => mockMicPublication);
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
    mockPublishedMicTrack.getSettings.mockReset();
    mockPublishedMicTrack.getSettings.mockImplementation(
      () => ({}) as MediaTrackSettings,
    );
    mockMicCloneTrack.enabled = false;
    mockManualReplacementTrack.enabled = true;
    mockGeneratedTrack.enabled = true;
    mockPublishedMicTrack.clone.mockClear();
    mockPublishedMicTrack.stop.mockClear();
    mockMicCloneTrack.stop.mockClear();
    mockMicCloneTrack.clone.mockClear();
    mockManualReplacementTrack.stop.mockClear();
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
    mockBridgeClear.mockReset();
    mockBridgeClear.mockImplementation(async () => {});
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

  test('requests non-mandatory AEC, noise suppression, and automatic gain control preferences', async () => {
    const { adapter } = makeAdapter(undefined, { vad: false });

    await adapter.connect({ tools: [], instructions: '' });

    const options = mockCreateLocalAudioTrack.mock.calls[0]?.[0];
    expect(options).toEqual({
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    });
    expect(JSON.stringify(options)).not.toContain('exact');
  });

  test('inspects only accepted original-track settings before cloning and logs a bounded projection', async () => {
    const order: string[] = [];
    mockPublishedMicTrack.getSettings.mockImplementationOnce(() => {
      order.push('settings');
      return {
        echoCancellation: false,
        noiseSuppression: true,
        autoGainControl: false,
        deviceId: 'sensitive-device-id',
        groupId: 'sensitive-group-id',
        sampleRate: 48_000,
      };
    });
    mockPublishedMicTrack.clone.mockImplementationOnce(() => {
      order.push('clone');
      return mockMicCloneTrack;
    });
    const debug = spyOn(console, 'debug').mockImplementation(() => {});
    try {
      const { adapter } = makeAdapter(undefined, { debug: true, vad: false });
      await adapter.connect({ tools: [], instructions: '' });

      const audioProcessingCall = debug.mock.calls.find(
        (call) => call[1] === 'microphone audio processing',
      );
      expect(order).toEqual(['settings', 'clone']);
      expect(audioProcessingCall).toEqual([
        '[LiveKitAdapter]',
        'microphone audio processing',
        {
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
        },
      ]);
      expect(JSON.stringify(audioProcessingCall)).not.toContain('sensitive');
      expect(JSON.stringify(audioProcessingCall)).not.toContain('sampleRate');
    } finally {
      debug.mockRestore();
    }
  });

  test('projects missing and non-boolean original-track settings as unavailable', async () => {
    mockPublishedMicTrack.getSettings.mockImplementationOnce(
      () =>
        ({
          echoCancellation: true,
          noiseSuppression: 'enabled',
        }) as unknown as MediaTrackSettings,
    );
    const debug = spyOn(console, 'debug').mockImplementation(() => {});
    try {
      const { adapter } = makeAdapter(undefined, { debug: true, vad: false });
      await adapter.connect({ tools: [], instructions: '' });

      expect(
        debug.mock.calls.find(
          (call) => call[1] === 'microphone audio processing',
        )?.[2],
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
    } finally {
      debug.mockRestore();
    }
  });

  test('keeps connecting and projects unavailable settings when getSettings throws', async () => {
    mockPublishedMicTrack.getSettings.mockImplementationOnce(() => {
      throw new Error('settings unavailable');
    });
    const debug = spyOn(console, 'debug').mockImplementation(() => {});
    try {
      const { adapter } = makeAdapter(undefined, { debug: true, vad: false });
      await expect(
        adapter.connect({ tools: [], instructions: '' }),
      ).resolves.toBeUndefined();

      expect(
        debug.mock.calls.find(
          (call) => call[1] === 'microphone audio processing',
        )?.[2],
      ).toMatchObject({
        audioProcessing: {
          applied: {
            echoCancellation: 'unavailable',
            noiseSuppression: 'unavailable',
            autoGainControl: 'unavailable',
          },
        },
      });
    } finally {
      debug.mockRestore();
    }
  });

  test('contains a throwing getSettings lookup without failing connection', async () => {
    const rawTrack = {
      enabled: false,
      clone: mock(() => mockMicCloneTrack),
      stop: mock(() => {}),
    };
    Object.defineProperty(rawTrack, 'getSettings', {
      get() {
        throw new Error('browser-owned method lookup failed');
      },
    });
    const micTrack = {
      ...mockMicPublication.track,
      mediaStreamTrack: rawTrack as unknown as MediaStreamTrack,
      stop: rawTrack.stop,
    } as typeof mockMicPublication.track;
    mockCreateLocalAudioTrack.mockImplementationOnce(async () => micTrack);
    const debug = spyOn(console, 'debug').mockImplementation(() => {});
    try {
      const { adapter } = makeAdapter(undefined, { debug: true, vad: false });
      await expect(
        adapter.connect({ tools: [], instructions: '' }),
      ).resolves.toBeUndefined();

      expect(
        debug.mock.calls.find(
          (call) => call[1] === 'microphone audio processing',
        )?.[2],
      ).toMatchObject({
        audioProcessing: {
          applied: {
            echoCancellation: 'unavailable',
            noiseSuppression: 'unavailable',
            autoGainControl: 'unavailable',
          },
        },
      });
    } finally {
      debug.mockRestore();
    }
  });

  test('reads each browser-owned setting once and projects only booleans', async () => {
    const reads = {
      echoCancellation: 0,
      noiseSuppression: 0,
      autoGainControl: 0,
    };
    const settings = Object.defineProperties(
      {},
      {
        echoCancellation: {
          get() {
            reads.echoCancellation += 1;
            return reads.echoCancellation === 1 ? true : 'sensitive-device-id';
          },
        },
        noiseSuppression: {
          get() {
            reads.noiseSuppression += 1;
            throw new Error('setting access failed');
          },
        },
        autoGainControl: {
          get() {
            reads.autoGainControl += 1;
            return reads.autoGainControl === 1 ? false : 'sensitive-group-id';
          },
        },
      },
    );
    mockPublishedMicTrack.getSettings.mockImplementationOnce(
      () => settings as MediaTrackSettings,
    );
    const debug = spyOn(console, 'debug').mockImplementation(() => {});
    try {
      const { adapter } = makeAdapter(undefined, { debug: true, vad: false });
      await expect(
        adapter.connect({ tools: [], instructions: '' }),
      ).resolves.toBeUndefined();

      const audioProcessingCall = debug.mock.calls.find(
        (call) => call[1] === 'microphone audio processing',
      );
      expect(reads).toEqual({
        echoCancellation: 1,
        noiseSuppression: 1,
        autoGainControl: 1,
      });
      expect(audioProcessingCall?.[2]).toMatchObject({
        audioProcessing: {
          applied: {
            echoCancellation: true,
            noiseSuppression: 'unavailable',
            autoGainControl: false,
          },
        },
      });
      expect(JSON.stringify(audioProcessingCall)).not.toContain('sensitive');
    } finally {
      debug.mockRestore();
    }
  });

  test('stops an acquired unpublished track once when diagnostics throw', async () => {
    const debug = spyOn(console, 'debug').mockImplementation(() => {
      throw new Error('diagnostic sink failed');
    });
    try {
      const { adapter } = makeAdapter(undefined, { debug: true, vad: false });

      await expect(
        adapter.connect({ tools: [], instructions: '' }),
      ).rejects.toMatchObject({ code: 'CONNECTION_FAILED' });

      expect(mockPublishedMicTrack.stop).toHaveBeenCalledTimes(1);
      expect(mockPublishedMicTrack.clone).not.toHaveBeenCalled();
      expect(mockPublishTrack).not.toHaveBeenCalled();
    } finally {
      debug.mockRestore();
    }
  });

  test('keeps connecting and projects unavailable settings when getSettings is absent', async () => {
    const rawTrack = {
      enabled: false,
      clone: mock(() => mockMicCloneTrack),
      stop: mock(() => {}),
    } as unknown as MediaStreamTrack;
    const micTrack = {
      ...mockMicPublication.track,
      mediaStreamTrack: rawTrack,
      stop: rawTrack.stop,
    } as typeof mockMicPublication.track;
    mockCreateLocalAudioTrack.mockImplementationOnce(async () => micTrack);
    const debug = spyOn(console, 'debug').mockImplementation(() => {});
    try {
      const { adapter } = makeAdapter(undefined, { debug: true, vad: false });
      await expect(
        adapter.connect({ tools: [], instructions: '' }),
      ).resolves.toBeUndefined();

      expect(
        debug.mock.calls.find(
          (call) => call[1] === 'microphone audio processing',
        )?.[2],
      ).toMatchObject({
        audioProcessing: {
          applied: {
            echoCancellation: 'unavailable',
            noiseSuppression: 'unavailable',
            autoGainControl: 'unavailable',
          },
        },
      });
    } finally {
      debug.mockRestore();
    }
  });

  test('does not log audio processing when debug logging is disabled', async () => {
    const debug = spyOn(console, 'debug').mockImplementation(() => {});
    try {
      const { adapter } = makeAdapter(undefined, { vad: false });
      await adapter.connect({ tools: [], instructions: '' });
      expect(debug).not.toHaveBeenCalled();
      expect(mockPublishedMicTrack.getSettings).not.toHaveBeenCalled();
    } finally {
      debug.mockRestore();
    }
  });

  test('mutes locally acquired audio before its first publication and exposes mode only after upstream pause', async () => {
    const order: string[] = [];
    let rawEnabledAtPublish: boolean | undefined;
    let cloneEnabledAtPublish: boolean | undefined;
    mockCreateLocalAudioTrack.mockImplementationOnce(async () => {
      order.push('acquire');
      return mockMicPublication.track;
    });
    mockPublishedMicTrack.getSettings.mockImplementationOnce(() => {
      order.push('settings');
      return {};
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

  test('does not let superseded VAD initialization overwrite reconnect manual mode', async () => {
    const staleStart = deferred<void>();
    const winnerCause = new Error('winner VAD start failed');
    mockCreateLocalAudioPreRoll.mockImplementation(async () => mockBridge);
    mockVadStart
      .mockImplementationOnce(() => staleStart.promise)
      .mockImplementationOnce(async () => {
        throw winnerCause;
      });
    const { adapter, events } = makeAdapter();

    const staleConnect = adapter.connect({ tools: [], instructions: '' });
    for (let attempts = 0; attempts < 100; attempts += 1) {
      if (mockVadStart.mock.calls.length > 0) break;
      await Promise.resolve();
    }
    expect(mockVadStart).toHaveBeenCalledTimes(1);

    await adapter.disconnect();
    currentRoom = makeMockRoom();
    await adapter.connect({ tools: [], instructions: '' });

    expect(adapter.turnControl).toBeDefined();
    expect(events.filter((event) => event.type === 'turn_mode').at(-1)).toEqual(
      {
        type: 'turn_mode',
        mode: 'manual',
        error: winnerCause,
      },
    );

    staleStart.resolve();
    await expect(staleConnect).rejects.toMatchObject({
      code: 'CONNECT_SUPERSEDED',
    });

    expect(events.filter((event) => event.type === 'turn_mode')).toEqual([
      { type: 'turn_mode', mode: 'manual', error: winnerCause },
    ]);
    expect(adapter.turnControl).toBeDefined();
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

  test('cancels a short automatic turn on VAD misfire without signaling end or thinking', async () => {
    const order: string[] = [];
    mockCreateLocalAudioPreRoll.mockImplementationOnce(async () => mockBridge);
    const { adapter, events } = makeAdapter();
    await adapter.connect({ tools: [], instructions: '' });
    events.length = 0;
    mockBridgeEndTurn.mockImplementationOnce(async () => {
      order.push('drain');
    });
    mockPauseUpstream.mockImplementationOnce(async () => {
      order.push('pause-upstream');
    });
    adapter.on((event) => {
      if (event.type === 'state' && event.state === 'connected') {
        order.push('idle');
      }
    });
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
    expect(turnEnds).toHaveLength(0);
    expect(order).toEqual(['drain', 'pause-upstream', 'idle']);
    expect(states(events).at(-1)).toBe('connected');
    expect(
      states(events).filter((state) => state === 'connected'),
    ).toHaveLength(1);
    expect(states(events)).not.toContain('thinking');
    expect(events.filter((event) => event.type === 'turn_mode')).toEqual([]);
    expect(adapter.turnControl).toBeUndefined();
  });

  test('does not emit connected when disconnect supersedes a delayed misfire drain', async () => {
    const drain = deferred<void>();
    mockCreateLocalAudioPreRoll.mockImplementationOnce(async () => mockBridge);
    mockBridgeEndTurn.mockImplementationOnce(() => drain.promise);
    const { adapter, events } = makeAdapter();
    await adapter.connect({ tools: [], instructions: '' });
    const options = capturedVadOptions[0] as {
      onSpeechStart?: () => Promise<void>;
      onVADMisfire?: () => Promise<void>;
    };
    await options.onSpeechStart?.();
    events.length = 0;

    const cancelling = options.onVADMisfire?.();
    for (
      let attempts = 0;
      attempts < 20 && mockBridgeEndTurn.mock.calls.length === 0;
      attempts += 1
    ) {
      await Promise.resolve();
    }
    const disconnecting = adapter.disconnect();
    drain.resolve();
    await Promise.all([cancelling, disconnecting]);

    expect(states(events)).not.toContain('connected');
    expect(states(events)).not.toContain('thinking');
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

  test('replaces a failed pre-roll bridge with disabled native capture before exposing manual control', async () => {
    const cause = new Error('automatic pre-roll failed');
    const order: string[] = [];
    let upstreamPaused = true;
    mockCreateLocalAudioPreRoll.mockImplementationOnce(async () => mockBridge);
    mockBridgeStartAutomaticTurn.mockImplementationOnce(async () => {
      throw cause;
    });
    mockPauseUpstream.mockImplementation(async () => {
      upstreamPaused = true;
      order.push('pause');
    });
    mockResumeUpstream.mockImplementation(async () => {
      upstreamPaused = false;
      order.push('resume');
    });
    mockMuteLocalMic.mockImplementation(async () => {
      mockMicPublication.track.isMuted = true;
      order.push('mute');
    });
    mockMicCloneTrack.clone.mockImplementationOnce(() => {
      order.push('clone-native');
      return mockManualReplacementTrack;
    });
    mockBridgeDestroy.mockImplementationOnce(async () => {
      expect(upstreamPaused).toBe(true);
      order.push('destroy-bridge');
    });
    mockSetMicrophoneEnabled.mockImplementation(async (enabled: boolean) => {
      mockManualReplacementTrack.enabled = enabled;
      mockMicPublication.track.isMuted = !enabled;
      order.push(enabled ? 'enable' : 'disable');
    });
    const { adapter } = makeAdapter();
    adapter.on((event) => {
      if (event.type === 'turn_mode' && event.mode === 'manual') {
        expect(upstreamPaused).toBe(true);
        expect(mockManualReplacementTrack.enabled).toBe(false);
        expect(mockMicPublication.track.isMuted).toBe(true);
        order.push('manual');
      }
    });
    await adapter.connect({ tools: [], instructions: '' });
    const automaticMicStream = adapter.getAudioStreams().mic;
    mockReplaceTrack.mockImplementationOnce(async (track?: unknown) => {
      expect(track).toBe(mockManualReplacementTrack);
      expect(mockManualReplacementTrack.enabled).toBe(false);
      expect(mockMicPublication.track.isMuted).toBe(true);
      expect(upstreamPaused).toBe(true);
      order.push('replace');
      // LiveKit may resume the sender while swapping the underlying track.
      upstreamPaused = false;
    });
    const options = capturedVadOptions[0] as {
      onSpeechStart?: () => Promise<void>;
    };

    await options.onSpeechStart?.();

    expect(mockReplaceTrack).toHaveBeenLastCalledWith(
      mockManualReplacementTrack,
      {
        userProvidedTrack: true,
        stopProcessor: true,
      },
    );
    expect(order.slice(-7)).toEqual([
      'pause',
      'mute',
      'clone-native',
      'replace',
      'pause',
      'destroy-bridge',
      'manual',
    ]);
    expect(mockManualReplacementTrack.enabled).toBe(false);
    expect(mockMicCloneTrack.stop).toHaveBeenCalledTimes(1);
    expect(adapter.getAudioStreams().mic).not.toBe(automaticMicStream);
    expect(adapter.getAudioStreams().mic?.getAudioTracks()).toEqual([
      mockManualReplacementTrack as unknown as MediaStreamTrack,
    ]);

    mockBridgeStartManualTurn.mockClear();
    await adapter.turnControl?.startTurn();
    expect(mockBridgeStartManualTurn).not.toHaveBeenCalled();
    expect(mockManualReplacementTrack.enabled).toBe(true);
    expect(mockMicPublication.track.isMuted).toBe(false);

    await adapter.turnControl?.endTurn();
    expect(mockManualReplacementTrack.enabled).toBe(false);
    expect(mockMicPublication.track.isMuted).toBe(true);
    expect(upstreamPaused).toBe(true);
    expect(order.slice(-2)).toEqual(['disable', 'pause']);

    await adapter.disconnect();
    expect(mockMicCloneTrack.stop).toHaveBeenCalledTimes(1);
    expect(mockManualReplacementTrack.stop).toHaveBeenCalledTimes(1);
    expect(mockBridgeDestroy).toHaveBeenCalledTimes(1);
  });

  test('re-pauses a replacement that resumes upstream before honoring a stale generation', async () => {
    const cause = new Error('automatic pre-roll failed');
    const replacing = deferred<void>();
    let upstreamPaused = true;
    mockCreateLocalAudioPreRoll.mockImplementationOnce(async () => mockBridge);
    mockBridgeStartAutomaticTurn.mockImplementationOnce(async () => {
      throw cause;
    });
    mockPauseUpstream.mockImplementation(async () => {
      upstreamPaused = true;
    });
    mockResumeUpstream.mockImplementation(async () => {
      upstreamPaused = false;
    });
    const { adapter, events } = makeAdapter();
    await adapter.connect({ tools: [], instructions: '' });
    mockReplaceTrack.mockImplementationOnce(async () => {
      upstreamPaused = false;
      await replacing.promise;
    });
    const options = capturedVadOptions[0] as {
      onSpeechStart?: () => Promise<void>;
    };

    const failing = options.onSpeechStart?.();
    for (
      let attempts = 0;
      attempts < 20 && mockReplaceTrack.mock.calls.length < 2;
      attempts += 1
    ) {
      await Promise.resolve();
    }
    const disconnecting = adapter.disconnect();
    replacing.resolve();
    await Promise.all([failing, disconnecting]);

    expect(upstreamPaused).toBe(true);
    expect(mockMicCloneTrack.stop).toHaveBeenCalledTimes(1);
    expect(mockManualReplacementTrack.enabled).toBe(false);
    expect(mockManualReplacementTrack.stop).toHaveBeenCalledTimes(1);
    expect(adapter.turnControl).toBeUndefined();
    expect(
      events.some(
        (event) => event.type === 'turn_mode' && event.mode === 'manual',
      ),
    ).toBe(false);
  });

  test('does not retire a successor microphone clone when stale generation replacement completes', async () => {
    const cause = new Error('automatic pre-roll failed');
    const replacing = deferred<void>();
    mockCreateLocalAudioPreRoll.mockImplementationOnce(async () => mockBridge);
    mockBridgeStartAutomaticTurn.mockImplementationOnce(async () => {
      throw cause;
    });
    const { adapter } = makeAdapter();
    await adapter.connect({ tools: [], instructions: '' });
    mockReplaceTrack.mockImplementationOnce(async () => replacing.promise);
    const staleOptions = capturedVadOptions[0] as {
      onSpeechStart?: () => Promise<void>;
    };

    const staleFailure = staleOptions.onSpeechStart?.();
    for (
      let attempts = 0;
      attempts < 20 && mockReplaceTrack.mock.calls.length < 2;
      attempts += 1
    ) {
      await Promise.resolve();
    }
    await adapter.disconnect();

    const successorClone = {
      enabled: false,
      stop: mock(() => {}),
    } as unknown as MediaStreamTrack;
    const successorRaw = {
      enabled: true,
      clone: mock(() => successorClone),
      stop: mock(() => {}),
    } as unknown as MediaStreamTrack;
    const successorMicTrack = {
      ...mockMicPublication.track,
      mediaStream: { id: 'successor-mic-stream' } as unknown as MediaStream,
      mediaStreamTrack: successorRaw,
      mute: mock(async () => {
        successorRaw.enabled = false;
      }),
      resumeUpstream: mock(async () => {}),
      stop: mock(() => {
        successorRaw.stop();
      }),
    } as typeof mockMicPublication.track;
    mockCreateLocalAudioTrack.mockImplementationOnce(
      async () => successorMicTrack,
    );
    currentRoom = makeMockRoom();
    await adapter.connect({ tools: [], instructions: '' });
    const successorMicStream = adapter.getAudioStreams().mic;

    replacing.resolve();
    await staleFailure;

    expect(successorClone.stop).not.toHaveBeenCalled();
    expect(adapter.getAudioStreams().mic).toBe(successorMicStream);
    expect(adapter.getAudioStreams().mic?.getAudioTracks()).toEqual([
      successorClone,
    ]);

    await adapter.disconnect();
    expect(successorClone.stop).toHaveBeenCalledTimes(1);
  });

  test('fails transport instead of exposing manual control when replacement capture is unavailable', async () => {
    const cause = new Error('automatic pre-roll failed');
    mockCreateLocalAudioPreRoll.mockImplementationOnce(async () => mockBridge);
    mockBridgeStartAutomaticTurn.mockImplementationOnce(async () => {
      throw cause;
    });
    mockMicCloneTrack.clone.mockImplementationOnce(() => undefined as never);
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
    expect(mockBridgeDestroy).toHaveBeenCalledTimes(1);
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

  test('degrades to manual without signaling turn end when misfire drain is uncertain', async () => {
    const cause = new Error('local drain failed');
    const order: string[] = [];
    mockCreateLocalAudioPreRoll.mockImplementationOnce(async () => mockBridge);
    mockBridgeEndTurn.mockImplementationOnce(async () => {
      order.push('drain-failed');
      throw cause;
    });
    const { adapter, events } = makeAdapter();
    await adapter.connect({ tools: [], instructions: '' });
    mockPauseUpstream.mockImplementation(async () => {
      order.push('pause-upstream');
    });
    adapter.on((event) => {
      if (event.type === 'state' && event.state === 'connected') {
        order.push('connected');
      }
      if (event.type === 'turn_mode' && event.mode === 'manual') {
        order.push('manual');
      }
    });
    mockPublishData.mockClear();
    const options = capturedVadOptions[0] as {
      onSpeechStart?: () => Promise<void>;
      onVADMisfire?: () => Promise<void>;
    };
    await options.onSpeechStart?.();

    await options.onVADMisfire?.();

    expect(mockBridgeEndTurn).toHaveBeenCalledTimes(1);
    const publishCalls = mockPublishData.mock.calls as unknown as [
      Uint8Array,
    ][];
    expect(
      publishCalls.some(([payload]) => {
        const message = JSON.parse(new TextDecoder().decode(payload));
        return message.type === 'turn_end';
      }),
    ).toBe(false);
    expect(events).toContainEqual({
      type: 'turn_mode',
      mode: 'manual',
      error: expect.objectContaining({ cause }),
    });
    expect(order).toEqual([
      'drain-failed',
      'pause-upstream',
      'connected',
      'pause-upstream',
      'pause-upstream',
      'manual',
    ]);
    expect(states(events).at(-1)).toBe('connected');
    expect(states(events)).not.toContain('thinking');
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

  test('an automatic turn end without a published microphone track is fatal before turn_end', async () => {
    mockCreateLocalAudioPreRoll.mockImplementationOnce(async () => mockBridge);
    const { adapter, events } = makeAdapter();
    await adapter.connect({ tools: [], instructions: '' });
    const options = capturedVadOptions[0] as {
      onSpeechStart?: () => Promise<void>;
      onSpeechEnd?: () => Promise<void>;
    };
    await options.onSpeechStart?.();
    mockGetTrackPublication.mockImplementation(() => undefined as never);
    mockPublishData.mockClear();

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
          event.error.code === 'CONNECTION_FAILED',
      ),
    ).toBe(true);
    expect(mockPublishData).not.toHaveBeenCalled();
    expect(mockRoomDisconnect).toHaveBeenCalledTimes(1);
  });

  test('automatic degradation without a published microphone track is fatal without manual fallback', async () => {
    const cause = new Error('automatic pre-roll failed');
    mockCreateLocalAudioPreRoll.mockImplementationOnce(async () => mockBridge);
    mockBridgeStartAutomaticTurn.mockImplementationOnce(async () => {
      throw cause;
    });
    const { adapter, events } = makeAdapter();
    await adapter.connect({ tools: [], instructions: '' });
    let publicationReads = 0;
    mockGetTrackPublication.mockImplementation(() => {
      publicationReads += 1;
      return publicationReads <= 2 ? mockMicPublication : (undefined as never);
    });
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
  });

  test('a VAD misfire upstream-pause failure is fatal without manual fallback', async () => {
    mockCreateLocalAudioPreRoll.mockImplementationOnce(async () => mockBridge);
    const { adapter, events } = makeAdapter();
    await adapter.connect({ tools: [], instructions: '' });
    const options = capturedVadOptions[0] as {
      onSpeechStart?: () => Promise<void>;
      onVADMisfire?: () => Promise<void>;
    };
    await options.onSpeechStart?.();
    events.length = 0;
    mockPauseUpstream.mockImplementationOnce(async () => {
      throw new Error('upstream pause failed');
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
          event.error.code === 'CONNECTION_FAILED',
      ),
    ).toBe(true);
    expect(states(events)).not.toContain('connected');
    expect(states(events)).not.toContain('thinking');
  });

  test('a VAD misfire without a published microphone track is fatal without manual fallback', async () => {
    mockCreateLocalAudioPreRoll.mockImplementationOnce(async () => mockBridge);
    const { adapter, events } = makeAdapter();
    await adapter.connect({ tools: [], instructions: '' });
    const options = capturedVadOptions[0] as {
      onSpeechStart?: () => Promise<void>;
      onVADMisfire?: () => Promise<void>;
    };
    await options.onSpeechStart?.();
    mockGetTrackPublication.mockImplementation(() => undefined as never);
    mockPublishData.mockClear();

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
          event.error.code === 'CONNECTION_FAILED',
      ),
    ).toBe(true);
    expect(mockRoomDisconnect).toHaveBeenCalledTimes(1);
    expect(mockPublishData).not.toHaveBeenCalled();
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

  test('does not announce turn mode until generated-track unmute settles', async () => {
    const unmute = deferred<void>();
    mockCreateLocalAudioPreRoll.mockImplementationOnce(async () => mockBridge);
    mockUnmuteLocalMic.mockImplementationOnce(async () => {
      await unmute.promise;
      mockGeneratedTrack.enabled = true;
      mockMicPublication.track.isMuted = false;
    });
    const { adapter, events } = makeAdapter();

    const connecting = adapter.connect({ tools: [], instructions: '' });
    for (let attempts = 0; attempts < 10; attempts += 1) {
      if (mockUnmuteLocalMic.mock.calls.length > 0) break;
      await Promise.resolve();
    }

    expect(mockUnmuteLocalMic).toHaveBeenCalledTimes(1);
    expect(events.some((event) => event.type === 'turn_mode')).toBe(false);

    unmute.resolve();
    await connecting;

    expect(events.filter((event) => event.type === 'turn_mode')).toEqual([
      { type: 'turn_mode', mode: 'automatic' },
    ]);
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
    let staleContinuationReleased = false;
    const staleTrack = {
      enabled: true,
      stop: mock(() => {}),
    } as unknown as MediaStreamTrack;
    const staleBridgeDestroy = mock(async () => {});
    const staleBridge = {
      ...mockBridge,
      track: staleTrack,
      destroy: staleBridgeDestroy,
    };
    const currentTrack = {
      enabled: true,
      stop: mock(() => {}),
    } as unknown as MediaStreamTrack;
    const currentBridgeDestroy = mock(async () => {});
    const currentBridge = {
      ...mockBridge,
      track: currentTrack,
      destroy: currentBridgeDestroy,
    };
    mockCreateLocalAudioPreRoll
      .mockImplementationOnce(async () => staleBridge)
      .mockImplementationOnce(async () => currentBridge);
    mockReplaceTrack.mockImplementationOnce(
      () => new Promise<void>((resolve) => (releaseReplace = resolve)),
    );
    mockUnmuteLocalMic.mockImplementation(async () => {
      if (staleContinuationReleased) staleTrack.enabled = true;
    });
    const { adapter } = makeAdapter();

    const connecting = adapter.connect({ tools: [], instructions: '' });
    for (let attempts = 0; attempts < 10; attempts += 1) {
      if (mockReplaceTrack.mock.calls.length > 0) break;
      await Promise.resolve();
    }
    expect(mockReplaceTrack).toHaveBeenCalledTimes(1);

    await adapter.disconnect();

    expect(staleBridgeDestroy).toHaveBeenCalledTimes(1);
    expect(staleTrack.enabled).toBe(false);
    expect(mockMicCloneTrack.stop).toHaveBeenCalledTimes(1);

    currentRoom = makeMockRoom();
    await adapter.connect({ tools: [], instructions: '' });
    const pauseCallsBeforeStaleContinuation =
      mockPauseUpstream.mock.calls.length;
    const unmuteCallsBeforeStaleContinuation =
      mockUnmuteLocalMic.mock.calls.length;

    staleContinuationReleased = true;
    releaseReplace();
    await expect(connecting).rejects.toMatchObject({
      code: 'CONNECT_SUPERSEDED',
    });

    expect(staleTrack.enabled).toBe(false);
    expect(mockPauseUpstream).toHaveBeenCalledTimes(
      pauseCallsBeforeStaleContinuation,
    );
    expect(mockUnmuteLocalMic).toHaveBeenCalledTimes(
      unmuteCallsBeforeStaleContinuation,
    );
    expect(currentTrack.enabled).toBe(true);
    expect(currentBridgeDestroy).not.toHaveBeenCalled();
    expect(adapter.getAudioStreams().mic).toBeDefined();
  });

  test('does not unmute a stale generated track after its replacement pause settles', async () => {
    const stalePause = deferred<void>();
    let pauseCount = 0;
    let staleContinuationReleased = false;
    const staleTrack = {
      enabled: true,
      stop: mock(() => {}),
    } as unknown as MediaStreamTrack;
    const staleBridge = { ...mockBridge, track: staleTrack };
    const currentTrack = {
      enabled: true,
      stop: mock(() => {}),
    } as unknown as MediaStreamTrack;
    const currentBridge = { ...mockBridge, track: currentTrack };
    mockCreateLocalAudioPreRoll
      .mockImplementationOnce(async () => staleBridge)
      .mockImplementationOnce(async () => currentBridge);
    mockPauseUpstream.mockImplementation(() => {
      pauseCount += 1;
      return pauseCount === 2 ? stalePause.promise : Promise.resolve();
    });
    mockUnmuteLocalMic.mockImplementation(async () => {
      if (staleContinuationReleased) staleTrack.enabled = true;
    });
    const { adapter, events } = makeAdapter();

    const staleConnect = adapter.connect({ tools: [], instructions: '' });
    for (let attempts = 0; attempts < 10; attempts += 1) {
      if (mockPauseUpstream.mock.calls.length === 2) break;
      await Promise.resolve();
    }
    expect(mockPauseUpstream).toHaveBeenCalledTimes(2);

    await adapter.disconnect();
    currentRoom = makeMockRoom();
    await adapter.connect({ tools: [], instructions: '' });
    const unmuteCallsBeforeStaleContinuation =
      mockUnmuteLocalMic.mock.calls.length;
    const turnModesBeforeStaleContinuation = events.filter(
      (event) => event.type === 'turn_mode',
    );

    staleContinuationReleased = true;
    stalePause.resolve();
    await expect(staleConnect).rejects.toMatchObject({
      code: 'CONNECT_SUPERSEDED',
    });

    expect(staleTrack.enabled).toBe(false);
    expect(mockUnmuteLocalMic).toHaveBeenCalledTimes(
      unmuteCallsBeforeStaleContinuation,
    );
    expect(currentTrack.enabled).toBe(true);
    expect(events.filter((event) => event.type === 'turn_mode')).toEqual(
      turnModesBeforeStaleContinuation,
    );
  });

  test('disables a stale generated track when disconnect wins a pending unmute', async () => {
    const staleUnmute = deferred<void>();
    const staleTrack = {
      enabled: true,
      stop: mock(() => {}),
    } as unknown as MediaStreamTrack;
    const staleBridge = { ...mockBridge, track: staleTrack };
    const currentTrack = {
      enabled: true,
      stop: mock(() => {}),
    } as unknown as MediaStreamTrack;
    const currentBridge = { ...mockBridge, track: currentTrack };
    mockCreateLocalAudioPreRoll
      .mockImplementationOnce(async () => staleBridge)
      .mockImplementationOnce(async () => currentBridge);
    mockUnmuteLocalMic
      .mockImplementationOnce(async () => {
        await staleUnmute.promise;
        staleTrack.enabled = true;
      })
      .mockImplementationOnce(async () => {
        currentTrack.enabled = true;
      });
    const { adapter, events } = makeAdapter();

    const staleConnect = adapter.connect({ tools: [], instructions: '' });
    for (let attempts = 0; attempts < 10; attempts += 1) {
      if (mockUnmuteLocalMic.mock.calls.length > 0) break;
      await Promise.resolve();
    }
    expect(mockUnmuteLocalMic).toHaveBeenCalledTimes(1);

    await adapter.disconnect();
    currentRoom = makeMockRoom();
    await adapter.connect({ tools: [], instructions: '' });
    const pauseCallsBeforeStaleContinuation =
      mockPauseUpstream.mock.calls.length;
    const unmuteCallsBeforeStaleContinuation =
      mockUnmuteLocalMic.mock.calls.length;
    const turnModesBeforeStaleContinuation = events.filter(
      (event) => event.type === 'turn_mode',
    );

    staleUnmute.resolve();
    await expect(staleConnect).rejects.toMatchObject({
      code: 'CONNECT_SUPERSEDED',
    });

    expect(staleTrack.enabled).toBe(false);
    expect(currentTrack.enabled).toBe(true);
    expect(mockPauseUpstream).toHaveBeenCalledTimes(
      pauseCallsBeforeStaleContinuation,
    );
    expect(mockUnmuteLocalMic).toHaveBeenCalledTimes(
      unmuteCallsBeforeStaleContinuation,
    );
    expect(events.filter((event) => event.type === 'turn_mode')).toEqual(
      turnModesBeforeStaleContinuation,
    );
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

  test('a stale microphone acquisition is stopped without settings, clone, diagnostics, or publication', async () => {
    const acquired = deferred<typeof mockMicPublication.track>();
    const getSettings = mock(() => ({ echoCancellation: true }));
    const clone = mock(() => mockMicCloneTrack);
    const stop = mock(() => {});
    const rawTrack = {
      enabled: true,
      getSettings,
      clone,
      stop,
    } as unknown as MediaStreamTrack;
    const staleMicTrack = {
      ...mockMicPublication.track,
      mediaStreamTrack: rawTrack,
      stop,
    } as typeof mockMicPublication.track;
    mockCreateLocalAudioTrack.mockImplementationOnce(() => acquired.promise);
    const debug = spyOn(console, 'debug').mockImplementation(() => {});
    try {
      const { adapter } = makeAdapter(undefined, { debug: true, vad: false });
      const connecting = adapter.connect({ tools: [], instructions: '' });
      for (let attempts = 0; attempts < 20; attempts += 1) {
        if (mockCreateLocalAudioTrack.mock.calls.length > 0) break;
        await Promise.resolve();
      }

      await adapter.disconnect();
      acquired.resolve(staleMicTrack);

      await expect(connecting).rejects.toMatchObject({
        code: 'CONNECT_SUPERSEDED',
      });
      expect(stop).toHaveBeenCalledTimes(1);
      expect(getSettings).not.toHaveBeenCalled();
      expect(clone).not.toHaveBeenCalled();
      expect(mockPublishTrack).not.toHaveBeenCalled();
      expect(
        debug.mock.calls.some(
          (call) => call[1] === 'microphone audio processing',
        ),
      ).toBe(false);
    } finally {
      debug.mockRestore();
    }
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

  test('a stale publication completion releases only its attempt resources after reconnect', async () => {
    const makeMic = () => {
      const clone = {
        enabled: false,
        stop: mock(() => {}),
      };
      const raw = {
        enabled: true,
        clone: mock(() => clone as unknown as MediaStreamTrack),
        stop: mock(() => {}),
      };
      const track = {
        isMuted: false,
        mediaStream: { id: 'attempt-mic-stream' } as unknown as MediaStream,
        mediaStreamTrack: raw as unknown as MediaStreamTrack,
        mute: mock(async () => {
          raw.enabled = false;
        }),
        unmute: mock(async () => {}),
        pauseUpstream: mock(async () => {}),
        resumeUpstream: mock(async () => {}),
        replaceTrack: mock(async () => {}),
        stop: raw.stop,
      };
      return { clone, raw, track, publication: { track } };
    };
    const stale = makeMic();
    const winner = makeMic();
    const stalePublication = deferred<typeof stale.publication>();
    let acquired = 0;
    mockCreateLocalAudioTrack.mockImplementation(async () =>
      acquired++ === 0 ? stale.track : winner.track,
    );
    mockPublishTrack.mockImplementation((track) =>
      track === stale.track
        ? stalePublication.promise
        : Promise.resolve(winner.publication),
    );
    const { adapter } = makeAdapter(undefined, { vad: false });

    const staleConnect = adapter.connect({ tools: [], instructions: '' });
    for (let attempts = 0; attempts < 20; attempts += 1) {
      if (mockPublishTrack.mock.calls.length > 0) break;
      await Promise.resolve();
    }
    expect(mockPublishTrack).toHaveBeenCalledWith(stale.track);

    await adapter.disconnect();
    currentRoom = makeMockRoom();
    await adapter.connect({ tools: [], instructions: '' });
    const winnerStream = adapter.getAudioStreams().mic;

    stalePublication.resolve(stale.publication);
    await expect(staleConnect).rejects.toMatchObject({
      code: 'CONNECT_SUPERSEDED',
    });

    expect(stale.raw.stop).toHaveBeenCalledTimes(1);
    expect(stale.clone.stop).toHaveBeenCalledTimes(1);
    expect(winner.raw.stop).not.toHaveBeenCalled();
    expect(winner.clone.stop).not.toHaveBeenCalled();
    expect(adapter.getAudioStreams().mic).toBe(winnerStream);
    expect(adapter.getAudioStreams().mic?.getAudioTracks()).toEqual([
      winner.clone as unknown as MediaStreamTrack,
    ]);

    await adapter.disconnect();
    expect(stale.raw.stop).toHaveBeenCalledTimes(1);
    expect(stale.clone.stop).toHaveBeenCalledTimes(1);
    expect(winner.raw.stop).toHaveBeenCalledTimes(1);
    expect(winner.clone.stop).toHaveBeenCalledTimes(1);
  });

  test('a stale replacement rejection cannot release reconnect microphone ownership', async () => {
    let rejectStaleReplacement!: (error: Error) => void;
    const staleReplacement = new Promise<void>((_resolve, reject) => {
      rejectStaleReplacement = reject;
    });
    const winnerBridge = deferred<LocalAudioPreRoll>();
    const makeMic = (replaceTrack: () => Promise<void>) => {
      const clone = {
        enabled: false,
        stop: mock(() => {}),
      };
      const raw = {
        enabled: false,
        clone: mock(() => clone as unknown as MediaStreamTrack),
        stop: mock(() => {}),
      };
      const track = {
        isMuted: false,
        mediaStream: { id: 'attempt-mic-stream' } as unknown as MediaStream,
        mediaStreamTrack: raw as unknown as MediaStreamTrack,
        mute: mock(async () => {}),
        unmute: mock(async () => {}),
        pauseUpstream: mock(async () => {}),
        resumeUpstream: mock(async () => {}),
        replaceTrack: mock(replaceTrack),
        stop: raw.stop,
      };
      return { clone, raw, track };
    };
    const stale = makeMic(() => staleReplacement);
    const winner = makeMic(async () => {});
    let acquired = 0;
    mockCreateLocalAudioTrack.mockImplementation(async () =>
      acquired++ === 0 ? stale.track : winner.track,
    );
    mockPublishTrack.mockImplementation(async () => mockMicPublication);
    mockCreateLocalAudioPreRoll
      .mockImplementationOnce(async () => mockBridge)
      .mockImplementationOnce(() => winnerBridge.promise);
    const { adapter } = makeAdapter();

    const staleConnect = adapter.connect({ tools: [], instructions: '' });
    for (let attempts = 0; attempts < 10; attempts += 1) {
      if (stale.track.replaceTrack.mock.calls.length > 0) break;
      await Promise.resolve();
    }
    expect(stale.track.replaceTrack).toHaveBeenCalledTimes(1);

    await adapter.disconnect();
    currentRoom = makeMockRoom();
    const winnerConnect = adapter.connect({ tools: [], instructions: '' });
    for (let attempts = 0; attempts < 10; attempts += 1) {
      if (mockCreateLocalAudioPreRoll.mock.calls.length === 2) break;
      await Promise.resolve();
    }
    expect(mockCreateLocalAudioPreRoll).toHaveBeenCalledTimes(2);

    const staleFailure = new Error('stale replacement failed');
    rejectStaleReplacement(staleFailure);
    await expect(staleConnect).rejects.toBe(staleFailure);

    expect(winner.raw.stop).not.toHaveBeenCalled();
    expect(winner.clone.stop).not.toHaveBeenCalled();
    expect(adapter.getAudioStreams().mic?.getAudioTracks()).toEqual([
      winner.clone as unknown as MediaStreamTrack,
    ]);

    await adapter.disconnect();
    expect(winner.raw.stop).toHaveBeenCalledTimes(1);
    expect(winner.clone.stop).toHaveBeenCalledTimes(1);

    winnerBridge.resolve(mockBridge);
    await expect(winnerConnect).rejects.toMatchObject({
      code: 'CONNECT_SUPERSEDED',
    });
  });

  test('a stale initial pause continuation cannot touch reconnect microphone resources or emit turn mode', async () => {
    const stalePause = deferred<void>();
    const winnerPause = deferred<void>();
    const makeMic = (pauseUpstream: () => Promise<void>) => {
      const clone = {
        enabled: false,
        stop: mock(() => {}),
      };
      const raw = {
        enabled: false,
        clone: mock(() => clone as unknown as MediaStreamTrack),
        stop: mock(() => {}),
      };
      const track = {
        isMuted: false,
        mediaStream: { id: 'attempt-mic-stream' } as unknown as MediaStream,
        mediaStreamTrack: raw as unknown as MediaStreamTrack,
        mute: mock(async () => {}),
        unmute: mock(async () => {}),
        pauseUpstream: mock(pauseUpstream),
        resumeUpstream: mock(async () => {}),
        replaceTrack: mock(async () => {}),
        stop: raw.stop,
      };
      const publication = { track };
      return { clone, raw, track, publication };
    };
    const stale = makeMic(() => stalePause.promise);
    const winner = makeMic(() => winnerPause.promise);
    let acquired = 0;
    let published = stale.publication;
    mockCreateLocalAudioTrack.mockImplementation(async () =>
      acquired++ === 0 ? stale.track : winner.track,
    );
    mockPublishTrack.mockImplementation(async (track) => {
      published =
        track === stale.track ? stale.publication : winner.publication;
      return published;
    });
    mockGetTrackPublication.mockImplementation(() => published);
    mockCreateLocalAudioPreRoll.mockImplementation(async () => mockBridge);
    const { adapter, events } = makeAdapter();
    const snapshotWinner = () => ({
      cloneReads: winner.raw.clone.mock.calls.length,
      rawStops: winner.raw.stop.mock.calls.length,
      cloneStops: winner.clone.stop.mock.calls.length,
      mutes: winner.track.mute.mock.calls.length,
      unmutes: winner.track.unmute.mock.calls.length,
      pauses: winner.track.pauseUpstream.mock.calls.length,
      resumes: winner.track.resumeUpstream.mock.calls.length,
      replacements: winner.track.replaceTrack.mock.calls.length,
      bridges: mockCreateLocalAudioPreRoll.mock.calls.length,
      rawEnabled: winner.raw.enabled,
      cloneEnabled: winner.clone.enabled,
      publicationMuted: winner.track.isMuted,
      turnModes: events.filter((event) => event.type === 'turn_mode'),
    });

    const staleConnect = adapter.connect({ tools: [], instructions: '' });
    for (let attempts = 0; attempts < 10; attempts += 1) {
      if (stale.track.pauseUpstream.mock.calls.length > 0) break;
      await Promise.resolve();
    }
    expect(stale.track.pauseUpstream).toHaveBeenCalledTimes(1);

    await adapter.disconnect();
    currentRoom = makeMockRoom();
    const winnerConnect = adapter.connect({ tools: [], instructions: '' });
    for (let attempts = 0; attempts < 10; attempts += 1) {
      if (winner.track.pauseUpstream.mock.calls.length > 0) break;
      await Promise.resolve();
    }
    expect(winner.track.pauseUpstream).toHaveBeenCalledTimes(1);
    const winnerSnapshot = snapshotWinner();

    stalePause.resolve();
    await expect(staleConnect).rejects.toMatchObject({
      code: 'CONNECT_SUPERSEDED',
    });
    const afterStale = snapshotWinner();
    winnerPause.resolve();
    await winnerConnect;

    expect(afterStale).toEqual(winnerSnapshot);
    expect(adapter.getAudioStreams().mic?.getAudioTracks()).toEqual([
      winner.clone as unknown as MediaStreamTrack,
    ]);

    await adapter.disconnect();
    mockCreateLocalAudioTrack.mockImplementation(
      async () => mockMicPublication.track,
    );
    mockPublishTrack.mockImplementation(async () => mockMicPublication);
    mockGetTrackPublication.mockImplementation(() => mockMicPublication);
    mockCreateLocalAudioPreRoll.mockImplementation(async () => {
      throw new Error('AudioWorklet unavailable');
    });
    mockBridgeDestroy.mockClear();
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

  test('debug logging excludes speech-derived and credential-like content', async () => {
    const debug = spyOn(console, 'debug').mockImplementation(() => {});
    const sensitiveText =
      'transcript-private speak-private audio-private token-private secret-private';

    try {
      const { adapter } = makeAdapter(undefined, { debug: true });
      await adapter.connect({ tools: [], instructions: '' });

      await adapter.sendToolResult('call-privacy' as never, {
        ok: true,
        summary: 'structural-summary-private',
        userMessage: sensitiveText,
      });

      expect(debug).toHaveBeenCalledWith('[LiveKitAdapter]', '→ speak', {
        callId: 'call-privacy',
        resultKind: 'update_ui',
      });
      const loggedArguments = JSON.stringify(debug.mock.calls);
      expect(loggedArguments).not.toContain(sensitiveText);
      expect(loggedArguments).not.toContain('structural-summary-private');
      expect(loggedArguments).not.toContain('transcript-private');
      expect(loggedArguments).not.toContain('speak-private');
      expect(loggedArguments).not.toContain('audio-private');
      expect(loggedArguments).not.toContain('token-private');
      expect(loggedArguments).not.toContain('secret-private');
    } finally {
      debug.mockRestore();
    }
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

  test('a finalized manual bridge drain failure warns but preserves ordering and the next turn', async () => {
    const drainCause = new Error('bounded local drain failed');
    const order: string[] = [];
    const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});
    mockCreateLocalAudioPreRoll.mockReset();
    mockCreateLocalAudioPreRoll.mockImplementationOnce(async () => mockBridge);
    mockVadStart.mockReset();
    mockVadStart.mockImplementationOnce(async () => {
      throw new Error('VAD unavailable');
    });
    mockBridgeEndTurn.mockReset();
    mockBridgeEndTurn.mockImplementation(async () => {});
    mockBridgeEndTurn.mockImplementationOnce(async () => {
      order.push('drain');
      throw drainCause;
    });

    try {
      const { adapter, events } = makeAdapter();
      adapter.on((event) => {
        if (event.type === 'state' && event.state === 'thinking') {
          order.push('thinking');
        }
      });
      await adapter.connect({ tools: [], instructions: '' });
      expect(adapter.turnControl).toBeDefined();
      const eventCountBeforeTurn = events.length;
      mockPauseUpstream.mockImplementationOnce(async () => {
        order.push('pause');
      });
      mockPublishData.mockImplementationOnce(async () => {
        order.push('turn_end');
      });

      await adapter.turnControl?.startTurn();
      await adapter.turnControl?.endTurn();

      expect(order).toEqual(['drain', 'pause', 'turn_end', 'thinking']);
      const [payload] = mockPublishData.mock.calls.at(-1) as unknown as [
        Uint8Array,
      ];
      expect(JSON.parse(new TextDecoder().decode(payload))).toEqual({
        type: 'turn_end',
      });
      expect(mockRoomDisconnect).not.toHaveBeenCalled();
      const drainWarnings = () =>
        warnSpy.mock.calls.filter(
          (call) =>
            typeof call[1] === 'string' && call[1].includes('audio drain'),
        );
      expect(drainWarnings()).toHaveLength(1);
      expect(drainWarnings()[0]).not.toContain(drainCause);

      order.length = 0;
      mockBridgeEndTurn.mockImplementationOnce(async () => {
        throw drainCause;
      });
      await adapter.turnControl?.startTurn();
      await adapter.turnControl?.endTurn();

      expect(states(events).slice(-2)).toEqual(['listening', 'thinking']);
      expect(mockBridgeStartManualTurn).toHaveBeenCalledTimes(2);
      expect(mockBridgeEndTurn).toHaveBeenCalledTimes(2);
      expect(drainWarnings()).toHaveLength(1);
      expect(
        events
          .slice(eventCountBeforeTurn)
          .some((event) => event.type === 'error'),
      ).toBe(false);
      expect(adapter.turnControl).toBeDefined();
    } finally {
      mockCreateLocalAudioPreRoll.mockReset();
      mockCreateLocalAudioPreRoll.mockImplementation(async () => {
        throw new Error('AudioWorklet unavailable');
      });
      warnSpy.mockRestore();
    }
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

  test('a turn started while thinking cancels its outstanding utterance exactly once', async () => {
    const { adapter, events } = makeAdapter(undefined, {
      thinkingFallbackMs: 10,
    });
    await adapter.connect({ tools: [], instructions: '' });
    let audio!: HTMLAudioElement;
    currentRoom._emit('trackSubscribed', {
      kind: 'audio',
      mediaStream: { id: 'tts-stream' },
      attach: (element: HTMLAudioElement) => {
        audio = element;
      },
    });
    Object.defineProperty(audio, 'paused', {
      configurable: true,
      value: true,
    });
    await adapter.sendToolResult('call-1' as never, {
      ok: true,
      summary: 'Pending response.',
    });
    const outstandingUtterance = lastUtteranceId();
    await adapter.turnControl?.endTurn();
    expect(states(events).at(-1)).toBe('thinking');
    mockPublishData.mockClear();

    await Promise.all([
      adapter.turnControl?.startTurn(),
      adapter.turnControl?.startTurn(),
    ]);

    expect(mockPublishData).toHaveBeenCalledTimes(1);
    const [payload, options] = mockPublishData.mock.calls[0] as unknown as [
      Uint8Array,
      { reliable: boolean; topic: string },
    ];
    expect(JSON.parse(new TextDecoder().decode(payload))).toEqual({
      type: 'tts_cancel',
    });
    expect(options).toEqual({ reliable: true, topic: TURN_TOPIC });
    expect(audio.muted).toBe(false);
    expect(states(events).at(-1)).toBe('listening');

    for (const type of ['tts_done', 'tts_error'] as const) {
      currentRoom._emit(
        'dataReceived',
        encodeTtsWithId(type, outstandingUtterance),
        undefined,
        undefined,
        TTS_TOPIC,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(states(events).at(-1)).toBe('listening');
    expect(audio.muted).toBe(false);
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

  test('a startTurn from thinking without an outstanding utterance does not publish tts_cancel', async () => {
    const { adapter, events } = makeAdapter();
    await adapter.connect({ tools: [], instructions: '' });
    await adapter.turnControl?.startTurn();
    await adapter.turnControl?.endTurn();
    expect(states(events).at(-1)).toBe('thinking');
    mockPublishData.mockClear();

    await adapter.turnControl?.startTurn();

    expect(mockPublishData).not.toHaveBeenCalled();
    expect(states(events).at(-1)).toBe('listening');
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

  for (const terminalType of ['tts_done', 'tts_error'] as const) {
    test(`a matching ${terminalType} does not leave a phantom utterance for a later empty turn`, async () => {
      const { adapter, events } = makeAdapter();
      await adapter.connect({ tools: [], instructions: '' });
      await adapter.sendToolResult('call-1' as never, {
        ok: true,
        summary: 'Finished.',
      });

      currentRoom._emit(
        'dataReceived',
        encodeTtsWithId(terminalType, lastUtteranceId()),
        undefined,
        undefined,
        TTS_TOPIC,
      );
      expect(states(events).at(-1)).toBe('connected');

      await adapter.turnControl?.endTurn();
      expect(states(events).at(-1)).toBe('thinking');
      mockPublishData.mockClear();
      await adapter.turnControl?.startTurn();

      expect(mockPublishData).not.toHaveBeenCalled();
      expect(states(events).at(-1)).toBe('listening');
    });

    test(`an id-less ${terminalType} accepted for the current utterance does not leave a phantom cancel`, async () => {
      const { adapter, events } = makeAdapter();
      await adapter.connect({ tools: [], instructions: '' });
      await adapter.sendToolResult('call-1' as never, {
        ok: true,
        summary: 'Finished.',
      });

      currentRoom._emit(
        'dataReceived',
        encodeTts(terminalType),
        undefined,
        undefined,
        TTS_TOPIC,
      );
      expect(states(events).at(-1)).toBe('connected');

      await adapter.turnControl?.endTurn();
      expect(states(events).at(-1)).toBe('thinking');
      mockPublishData.mockClear();
      await adapter.turnControl?.startTurn();

      expect(mockPublishData).not.toHaveBeenCalled();
      expect(states(events).at(-1)).toBe('listening');
    });
  }

  test('a failed speak handoff does not leave a phantom utterance for a later empty turn', async () => {
    mockSendText.mockImplementationOnce(async () => {
      throw new Error('speak handoff failed');
    });
    const { adapter, events } = makeAdapter();
    await adapter.connect({ tools: [], instructions: '' });
    await adapter.sendToolResult('call-1' as never, {
      ok: true,
      summary: 'Not handed off.',
    });
    expect(states(events).at(-1)).toBe('connected');

    await adapter.turnControl?.endTurn();
    expect(states(events).at(-1)).toBe('thinking');
    mockPublishData.mockClear();
    await adapter.turnControl?.startTurn();

    expect(mockPublishData).not.toHaveBeenCalled();
    expect(states(events).at(-1)).toBe('listening');
  });

  test('an older failed handoff neither clears nor collapses the newer utterance', async () => {
    const handoffA = deferred<void>();
    mockSendText
      .mockImplementationOnce(async () => {
        await handoffA.promise;
        throw new Error('older speak handoff failed');
      })
      .mockImplementationOnce(async () => ({}));
    const { adapter, events } = makeAdapter();
    await adapter.connect({ tools: [], instructions: '' });

    const sendingA = adapter.sendToolResult('call-1' as never, {
      ok: true,
      summary: 'Older response.',
    });
    const sendingB = adapter.sendToolResult('call-2' as never, {
      ok: true,
      summary: 'Current response.',
    });
    await sendingB;
    const utteranceB = lastUtteranceId();

    handoffA.resolve();
    await sendingA;

    expect(states(events).at(-1)).toBe('speaking');
    mockPublishData.mockClear();
    await adapter.turnControl?.startTurn();

    expect(mockPublishData).toHaveBeenCalledTimes(1);
    currentRoom._emit(
      'dataReceived',
      encodeTtsWithId('tts_done', utteranceB),
      undefined,
      undefined,
      TTS_TOPIC,
    );
    expect(states(events).at(-1)).toBe('listening');
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

  for (const terminalType of ['tts_done', 'tts_error'] as const) {
    test(`a late id-less ${terminalType} after barge-in does not cancel the replacement empty-turn fallback`, async () => {
      const { adapter, events } = makeAdapter(undefined, {
        thinkingFallbackMs: 20,
      });
      await adapter.connect({ tools: [], instructions: '' });
      await adapter.sendToolResult('call-1' as never, {
        ok: true,
        summary: 'Superseded response.',
      });

      await adapter.turnControl?.startTurn();
      await adapter.turnControl?.endTurn();
      expect(states(events).at(-1)).toBe('thinking');

      currentRoom._emit(
        'dataReceived',
        encodeTts(terminalType),
        undefined,
        undefined,
        TTS_TOPIC,
      );
      expect(states(events).at(-1)).toBe('thinking');

      await settle(50);
      expect(states(events).at(-1)).toBe('connected');
    });
  }
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

  test('a current id-less tts signal cancels the thinking fallback', async () => {
    const { adapter, events } = makeAdapter(undefined, {
      thinkingFallbackMs: 10,
    });
    await adapter.connect({ tools: [], instructions: '' });
    await adapter.sendToolResult('call-1' as never, {
      ok: true,
      summary: 'Current response.',
    });

    await adapter.turnControl?.endTurn();
    // Legacy workers omit the id, so the outstanding utterance establishes that
    // this terminal status is current and may cancel the empty-turn fallback.
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

describe('LiveKitAdapter greeting capability', () => {
  const greetingId = MessageId('greeting:s1');
  const greetingText = 'Welcome aboard.';

  beforeEach(() => {
    currentRoom = makeMockRoom();
    roomConstructCount = 0;
    lifecycleOrder.length = 0;
    mockRoomConnect.mockReset();
    mockRoomConnect.mockImplementation(async () => {
      lifecycleOrder.push('room.connect');
    });
    mockRoomDisconnect.mockReset();
    mockRoomDisconnect.mockImplementation(async () => {});
    mockSendText.mockReset();
    mockSendText.mockImplementation(async () => ({}));
    mockStartAudio.mockReset();
    mockStartAudio.mockImplementation(async () => {
      lifecycleOrder.push('startAudio');
    });
    mockCreateLocalAudioTrack.mockReset();
    mockCreateLocalAudioTrack.mockImplementation(
      async () => mockMicPublication.track,
    );
    mockPublishTrack.mockReset();
    mockPublishTrack.mockImplementation(async () => mockMicPublication);
    mockGetTrackPublication.mockReset();
    mockGetTrackPublication.mockImplementation(() => mockMicPublication);
    mockPauseUpstream.mockReset();
    mockPauseUpstream.mockImplementation(async () => {});
    mockPublishedMicTrack.enabled = false;
    mockMicCloneTrack.enabled = false;
    mockCreateLocalAudioPreRoll.mockReset();
    mockCreateLocalAudioPreRoll.mockImplementation(async () => {
      throw new Error('AudioWorklet unavailable');
    });
  });

  test('without activateAudio, speakAssistantText is not_started and never sends', async () => {
    const { adapter } = makeAdapter(undefined, { greetingReadyWaitMs: 20 });
    await adapter.connect({ tools: [], instructions: '' });
    // Ready packet would otherwise allow send — unlock gate is independent.
    currentRoom._emit(
      'dataReceived',
      new TextEncoder().encode(JSON.stringify({ type: 'tts_ready' })),
      undefined,
      undefined,
      TTS_READY_TOPIC,
    );

    await expect(
      adapter.speakAssistantText({
        id: greetingId,
        text: greetingText,
        signal: new AbortController().signal,
      }),
    ).resolves.toBe('not_started');
    expect(mockSendText).not.toHaveBeenCalled();
  });

  test('suppresses when tts_ready never arrives within greetingReadyWaitMs', async () => {
    const { adapter } = makeAdapter(undefined, { greetingReadyWaitMs: 30 });
    await adapter.connect({ tools: [], instructions: '' });
    adapter.activateAudio();

    await expect(
      adapter.speakAssistantText({
        id: greetingId,
        text: greetingText,
        signal: new AbortController().signal,
      }),
    ).resolves.toBe('not_started');
    expect(mockSendText).not.toHaveBeenCalled();
  });

  test('ready packet unlocks SPEAK_TOPIC send of exact text and returns accepted', async () => {
    const { adapter, events } = makeAdapter(undefined, {
      greetingReadyWaitMs: 5000,
    });
    await adapter.connect({ tools: [], instructions: '' });
    adapter.activateAudio();
    let playbackStarts = 0;

    const speak = adapter.speakAssistantText({
      id: greetingId,
      text: greetingText,
      signal: new AbortController().signal,
      onPlaybackStart: () => {
        playbackStarts += 1;
      },
    });
    // Yield so the waiter is registered, then announce ready.
    await Promise.resolve();
    currentRoom._emit(
      'dataReceived',
      new TextEncoder().encode(JSON.stringify({ type: 'tts_ready' })),
      undefined,
      undefined,
      TTS_READY_TOPIC,
    );
    await expect(speak).resolves.toBe('accepted');
    expectSpoke(greetingText);
    expect(playbackStarts).toBe(0);
    currentRoom._emit(
      'dataReceived',
      new TextEncoder().encode(
        JSON.stringify({
          type: 'tts_started',
          utteranceId: lastUtteranceId(),
        }),
      ),
      undefined,
      undefined,
      TTS_TOPIC,
    );
    expect(playbackStarts).toBe(1);
    expect(states(events).at(-1)).toBe('speaking');
  });

  test('requires a matching utterance id before publishing the greeting caption', async () => {
    const { adapter } = makeAdapter(undefined, { greetingReadyWaitMs: 5000 });
    await adapter.connect({ tools: [], instructions: '' });
    adapter.activateAudio();
    currentRoom._emit(
      'dataReceived',
      new TextEncoder().encode(JSON.stringify({ type: 'tts_ready' })),
      undefined,
      undefined,
      TTS_READY_TOPIC,
    );
    let playbackStarts = 0;
    await adapter.speakAssistantText({
      id: greetingId,
      text: greetingText,
      signal: new AbortController().signal,
      onPlaybackStart: () => {
        playbackStarts += 1;
      },
    });
    const utteranceId = lastUtteranceId();

    for (const payload of [
      { type: 'tts_started' },
      { type: 'tts_started', utteranceId: utteranceId + 1 },
    ]) {
      currentRoom._emit(
        'dataReceived',
        new TextEncoder().encode(JSON.stringify(payload)),
        undefined,
        undefined,
        TTS_TOPIC,
      );
    }
    expect(playbackStarts).toBe(0);

    currentRoom._emit(
      'dataReceived',
      new TextEncoder().encode(
        JSON.stringify({ type: 'tts_started', utteranceId }),
      ),
      undefined,
      undefined,
      TTS_TOPIC,
    );
    expect(playbackStarts).toBe(1);
  });

  test('retains a queued greeting caption when a later utterance becomes current', async () => {
    const { adapter } = makeAdapter(undefined, { greetingReadyWaitMs: 5000 });
    await adapter.connect({ tools: [], instructions: '' });
    adapter.activateAudio();
    currentRoom._emit(
      'dataReceived',
      new TextEncoder().encode(JSON.stringify({ type: 'tts_ready' })),
      undefined,
      undefined,
      TTS_READY_TOPIC,
    );
    let playbackStarts = 0;
    await adapter.speakAssistantText({
      id: greetingId,
      text: greetingText,
      signal: new AbortController().signal,
      onPlaybackStart: () => {
        playbackStarts += 1;
      },
    });
    const greetingUtteranceId = lastUtteranceId();
    await adapter.sendToolResult('later-call' as never, {
      ok: true,
      summary: 'Later response.',
    });
    expect(lastUtteranceId()).toBe(greetingUtteranceId + 1);

    currentRoom._emit(
      'dataReceived',
      new TextEncoder().encode(
        JSON.stringify({
          type: 'tts_started',
          utteranceId: greetingUtteranceId,
        }),
      ),
      undefined,
      undefined,
      TTS_TOPIC,
    );
    expect(playbackStarts).toBe(1);
  });

  test('abort while waiting for ready returns not_started without send', async () => {
    const { adapter } = makeAdapter(undefined, { greetingReadyWaitMs: 5000 });
    await adapter.connect({ tools: [], instructions: '' });
    adapter.activateAudio();

    const controller = new AbortController();
    const speak = adapter.speakAssistantText({
      id: greetingId,
      text: greetingText,
      signal: controller.signal,
    });
    await Promise.resolve();
    controller.abort();
    await expect(speak).resolves.toBe('not_started');
    expect(mockSendText).not.toHaveBeenCalled();
  });

  test('ambiguous send rejection returns terminal accepted and collapses local speaking state', async () => {
    const { adapter, events } = makeAdapter(undefined, {
      greetingReadyWaitMs: 5000,
    });
    await adapter.connect({ tools: [], instructions: '' });
    adapter.activateAudio();
    currentRoom._emit(
      'dataReceived',
      new TextEncoder().encode(JSON.stringify({ type: 'tts_ready' })),
      undefined,
      undefined,
      TTS_READY_TOPIC,
    );

    mockSendText.mockImplementationOnce(async () => {
      throw new Error('send failed');
    });

    await expect(
      adapter.speakAssistantText({
        id: greetingId,
        text: greetingText,
        signal: new AbortController().signal,
      }),
    ).resolves.toBe('accepted');
    // The adapter cannot prove non-delivery after sendText starts. It collapses
    // local state but returns a terminal result so the coordinator cannot retry.
    expect(states(events)).toContain('speaking');
    expect(states(events).at(-1)).toBe('connected');
    expect(events.some((e) => e.type === 'error')).toBe(false);
  });

  test('teardown resets ttsReady; a reconnect requires a fresh tts_ready', async () => {
    const { adapter } = makeAdapter(undefined, { greetingReadyWaitMs: 40 });
    await adapter.connect({ tools: [], instructions: '' });
    adapter.activateAudio();
    currentRoom._emit(
      'dataReceived',
      new TextEncoder().encode(JSON.stringify({ type: 'tts_ready' })),
      undefined,
      undefined,
      TTS_READY_TOPIC,
    );

    await adapter.disconnect();

    // Fresh room after reconnect — readiness must be re-announced.
    currentRoom = makeMockRoom();
    await adapter.connect({ tools: [], instructions: '' });
    adapter.activateAudio();

    await expect(
      adapter.speakAssistantText({
        id: greetingId,
        text: greetingText,
        signal: new AbortController().signal,
      }),
    ).resolves.toBe('not_started');
    expect(mockSendText).not.toHaveBeenCalled();
  });

  test('a genuinely late tts_ready after teardown is a no-op under the room-currency guard', async () => {
    const { adapter } = makeAdapter(undefined, { greetingReadyWaitMs: 40 });
    await adapter.connect({ tools: [], instructions: '' });
    adapter.activateAudio();

    // Retain the old room's emitter, then tear the adapter down so `#room` no
    // longer matches. A late ready packet on the abandoned room must not arm
    // readiness for the next connection.
    const oldRoom = currentRoom;
    await adapter.disconnect();
    oldRoom._emit(
      'dataReceived',
      new TextEncoder().encode(JSON.stringify({ type: 'tts_ready' })),
      undefined,
      undefined,
      TTS_READY_TOPIC,
    );

    currentRoom = makeMockRoom();
    await adapter.connect({ tools: [], instructions: '' });
    adapter.activateAudio();

    await expect(
      adapter.speakAssistantText({
        id: greetingId,
        text: greetingText,
        signal: new AbortController().signal,
      }),
    ).resolves.toBe('not_started');
    expect(mockSendText).not.toHaveBeenCalled();
  });

  test('an earlier wait finish cannot clear a newer waiter deadline', async () => {
    const { adapter } = makeAdapter(undefined, { greetingReadyWaitMs: 60 });
    await adapter.connect({ tools: [], instructions: '' });
    adapter.activateAudio();

    const firstAbort = new AbortController();
    const firstSpeak = adapter.speakAssistantText({
      id: greetingId,
      text: greetingText,
      signal: firstAbort.signal,
    });
    await Promise.resolve();

    const secondSpeak = adapter.speakAssistantText({
      id: greetingId,
      text: 'Later greeting',
      signal: new AbortController().signal,
    });
    await Promise.resolve();

    // Settling the replaced wait must not strip the active wait's timeout.
    firstAbort.abort();
    await expect(firstSpeak).resolves.toBe('not_started');

    const secondOutcome = await Promise.race([
      secondSpeak,
      new Promise<'hung'>((resolve) => {
        setTimeout(() => resolve('hung'), 200);
      }),
    ]);
    expect(secondOutcome).toBe('not_started');
    expect(mockSendText).not.toHaveBeenCalled();
  });

  test('activateAudio constructs Room and invokes startAudio before token mint/connect', async () => {
    const { adapter } = makeAdapter(async () => {
      lifecycleOrder.push('mintToken');
      return DEFAULT_GRANT;
    });

    adapter.activateAudio();
    expect(lifecycleOrder).toEqual(['Room', 'startAudio']);
    expect(roomConstructCount).toBe(1);
    expect(mockStartAudio).toHaveBeenCalledTimes(1);

    await adapter.connect({ tools: [], instructions: '' });
    expect(lifecycleOrder).toEqual([
      'Room',
      'startAudio',
      'mintToken',
      'room.connect',
    ]);
    // Prepared room is reused — connect must not construct a second Room.
    expect(roomConstructCount).toBe(1);
  });

  test('activateAudio startAudio rejection is non-fatal and raises no unhandled rejection', async () => {
    mockStartAudio.mockImplementation(async () => {
      lifecycleOrder.push('startAudio');
      throw new Error('autoplay blocked');
    });

    const rejections: unknown[] = [];
    const onUnhandled = (reason: unknown) => {
      rejections.push(reason);
    };
    process.on('unhandledRejection', onUnhandled);
    try {
      const { adapter } = makeAdapter();
      expect(() => adapter.activateAudio()).not.toThrow();
      expect(mockStartAudio).toHaveBeenCalledTimes(1);
      expect(lifecycleOrder).toEqual(['Room', 'startAudio']);
      await Promise.resolve();
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      expect(rejections).toEqual([]);

      await expect(
        adapter.connect({ tools: [], instructions: '' }),
      ).resolves.toBeUndefined();
      expect(roomConstructCount).toBe(1);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });

  test('reconnect after disconnect prepares a fresh room rather than reusing the old one', async () => {
    const { adapter } = makeAdapter();
    adapter.activateAudio();
    await adapter.connect({ tools: [], instructions: '' });
    expect(roomConstructCount).toBe(1);

    await adapter.disconnect();
    currentRoom = makeMockRoom();
    lifecycleOrder.length = 0;

    adapter.activateAudio();
    expect(roomConstructCount).toBe(2);
    expect(lifecycleOrder).toEqual(['Room', 'startAudio']);

    await adapter.connect({ tools: [], instructions: '' });
    expect(roomConstructCount).toBe(2);
  });

  test('a second connect while joined still throws ALREADY_CONNECTED after activateAudio prepare', async () => {
    const { adapter } = makeAdapter();
    adapter.activateAudio();
    await adapter.connect({ tools: [], instructions: '' });

    let error: unknown;
    try {
      await adapter.connect({ tools: [], instructions: '' });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(RealtimeVoiceError);
    expect((error as RealtimeVoiceError).code).toBe('ALREADY_CONNECTED');
    expect(roomConstructCount).toBe(1);
  });
});
