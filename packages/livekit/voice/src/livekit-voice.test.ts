import { test, expect, mock, beforeEach, describe } from 'bun:test';
import { renderHook, act } from '@testing-library/react';

// --- Mocks for livekit-client ---

const mockRoomConnect = mock(async () => {});
const mockRoomDisconnect = mock(async () => {});
const mockPublishData = mock(async () => {});
const mockSetMicrophoneEnabled = mock(async () => undefined);
const mockSendText = mock(async (_text: string, _opts?: unknown) => ({}));
const mockStartAudio = mock(async () => {});

const mockLocalParticipant = {
  setMicrophoneEnabled: mockSetMicrophoneEnabled,
  publishData: mockPublishData,
  sendText: mockSendText,
  trackPublications: new Map(),
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
    canPlaybackAudio: true,
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
  Room: class {
    on = currentRoom.on;
    off = currentRoom.off;
    connect = currentRoom.connect;
    disconnect = currentRoom.disconnect;
    startAudio = currentRoom.startAudio;
    canPlaybackAudio = currentRoom.canPlaybackAudio;
    localParticipant = currentRoom.localParticipant;
  },
  RoomEvent: {
    TranscriptionReceived: 'transcriptionReceived',
    Connected: 'connected',
    Disconnected: 'disconnected',
    Reconnecting: 'reconnecting',
    Reconnected: 'reconnected',
    TrackSubscribed: 'trackSubscribed',
    AudioPlaybackStatusChanged: 'audioPlaybackChanged',
  },
  Track: { Kind: { Audio: 'audio' } },
  DataPacket_Kind: { RELIABLE: 0 },
  setLogLevel: mock(() => {}),
}));

// The token transport is injected (not a module dependency), so tests drive it
// through a mutable impl: default succeeds, individual tests can throw.
type MockToken = { token: string; url: string };
const DEFAULT_TOKEN: MockToken = {
  token: 'test-token',
  url: 'ws://localhost:7880',
};
let getTokenImpl: (roomName: string) => Promise<MockToken> = async () =>
  DEFAULT_TOKEN;
const getToken = (roomName: string) => getTokenImpl(roomName);

const { liveKitVoice } = await import('./livekit-voice');

// Captures the processing_completed subscriber the hook registers, so tests can
// drive the read-only response-observation seam directly.
let capturedProcessingCb: ((e: { response: unknown }) => void) | null = null;
const mockOff = mock(() => {});

// Minimal orchestrator mock
function makeOrchestrator() {
  capturedProcessingCb = null;
  mockOff.mockReset();
  return {
    processIntent: mock(async (_text: string) => ({})),
    requestCoordinator: {
      events: {
        on: mock((event: string, cb: (e: { response: unknown }) => void) => {
          if (event === 'processing_completed') capturedProcessingCb = cb;
          return mockOff;
        }),
      },
    },
  };
}

function makeResponse(userMessage: string) {
  return {
    type: 'maelstrom_response',
    requestId: 'req-1',
    userMessage,
    rationale: '',
    executionPlan: [],
    layout: { type: 'grid', cells: [] },
  } as never;
}

function makeCtx(orchestrator: ReturnType<typeof makeOrchestrator>) {
  return {
    useMaelstromContext: () => ({
      orchestrator: orchestrator as never,
      connector: {} as never,
      config: {} as never,
      onErrorRef: { current: undefined } as never,
    }),
  };
}

// ---

describe('liveKitVoice extension', () => {
  beforeEach(() => {
    currentRoom = makeMockRoom();
    mockRoomConnect.mockReset();
    mockSetMicrophoneEnabled.mockReset();
    mockPublishData.mockReset();
    mockSendText.mockReset();
  });

  test('factory returns an object with a voice property', () => {
    const orchestrator = makeOrchestrator();
    const ext = liveKitVoice({ getToken })(makeCtx(orchestrator));
    expect(ext).toHaveProperty('voice');
    expect(typeof ext.voice.useVoice).toBe('function');
  });

  test('default onTranscript calls orchestrator.processIntent', async () => {
    const orchestrator = makeOrchestrator();
    const { defaultSeams } = await import('./seams');
    const speak = mock(async (_text: string) => {});
    const seams = defaultSeams(orchestrator as never, speak);

    await seams.onTranscript('show me the weather');
    expect(orchestrator.processIntent).toHaveBeenCalledWith(
      'show me the weather',
    );
  });

  test('custom onTranscript override is called instead of processIntent', async () => {
    const orchestrator = makeOrchestrator();
    const customOnTranscript = mock(async (_text: string) => {});

    const { defaultSeams } = await import('./seams');
    const speak = mock(async (_text: string) => {});
    const defaultS = defaultSeams(orchestrator as never, speak);

    const customSeam = { ...defaultS, onTranscript: customOnTranscript };
    await customSeam.onTranscript('hello world');

    expect(customOnTranscript).toHaveBeenCalledWith('hello world');
    expect(orchestrator.processIntent).not.toHaveBeenCalled();
  });

  test('default onResponse speaks the userMessage via the speak transport', async () => {
    const orchestrator = makeOrchestrator();
    const { defaultSeams } = await import('./seams');
    const speak = mock(async (_text: string) => {});
    const seams = defaultSeams(orchestrator as never, speak);

    await seams.onResponse(makeResponse('Here is the weather'));
    expect(speak).toHaveBeenCalledWith('Here is the weather');
  });

  test('default onResponse does not speak an empty userMessage', async () => {
    const orchestrator = makeOrchestrator();
    const { defaultSeams } = await import('./seams');
    const speak = mock(async (_text: string) => {});
    const seams = defaultSeams(orchestrator as never, speak);

    await seams.onResponse(makeResponse('   '));
    expect(speak).not.toHaveBeenCalled();
  });

  test('a custom shouldSpeak predicate gates the speak transport', async () => {
    const orchestrator = makeOrchestrator();
    const { defaultSeams } = await import('./seams');
    const speak = mock(async (_text: string) => {});
    const never = () => false;
    const seams = defaultSeams(orchestrator as never, speak, never);

    await seams.onResponse(makeResponse('would be spoken if predicate allowed'));
    expect(speak).not.toHaveBeenCalled();
  });
});

describe('defaultShouldSpeak predicate', () => {
  test('returns true for a non-empty userMessage, false for blank', async () => {
    const { defaultShouldSpeak } = await import('./seams');
    expect(defaultShouldSpeak(makeResponse('hi'))).toBe(true);
    expect(defaultShouldSpeak(makeResponse(''))).toBe(false);
    expect(defaultShouldSpeak(makeResponse('  \n '))).toBe(false);
  });
});

describe('liveKitVoice extension factory', () => {
  test('extension keys do not collide with base instance keys', () => {
    const orchestrator = makeOrchestrator();
    const ext = liveKitVoice({ getToken })(makeCtx(orchestrator));
    const keys = Object.keys(ext);
    expect(keys).toContain('voice');
    expect(keys).not.toContain('Provider');
    expect(keys).not.toContain('Chart');
    expect(keys).not.toContain('useMaelstrom');
  });

  test('extension returned synchronously (no then property)', () => {
    const orchestrator = makeOrchestrator();
    const ext = liveKitVoice({ getToken })(makeCtx(orchestrator));
    expect((ext as { then?: unknown }).then).toBeUndefined();
  });
});

describe('createSpeakTransport', () => {
  beforeEach(() => {
    mockSendText.mockReset();
  });

  test('sends text to the worker over the speak topic', async () => {
    const { createSpeakTransport } = await import('./livekit-voice');
    const { SPEAK_TOPIC } = await import('./protocol');
    const room = { localParticipant: mockLocalParticipant } as never;
    const speak = createSpeakTransport(() => room);

    await speak('Here is the weather');

    expect(mockSendText).toHaveBeenCalledWith('Here is the weather', {
      topic: SPEAK_TOPIC,
    });
  });

  test('is a no-op when no room is joined (voice off)', async () => {
    const { createSpeakTransport } = await import('./livekit-voice');
    const speak = createSpeakTransport(() => null);

    await speak('nobody hears this');

    expect(mockSendText).not.toHaveBeenCalled();
  });
});

describe('useVoice hook', () => {
  beforeEach(() => {
    currentRoom = makeMockRoom();
    mockRoomConnect.mockReset();
    mockRoomDisconnect.mockReset();
    mockSetMicrophoneEnabled.mockReset();
    mockPublishData.mockReset();
    mockStartAudio.mockReset();
    getTokenImpl = async () => DEFAULT_TOKEN;
  });

  function renderVoice(options: Record<string, unknown> = {}) {
    const orchestrator = makeOrchestrator();
    const ext = liveKitVoice({ getToken, ...options })(makeCtx(orchestrator));
    return { orchestrator, ...renderHook(() => ext.voice.useVoice()) };
  }

  test('connect transitions connecting→connected on RoomEvent.Connected', async () => {
    const { result } = renderVoice();
    expect(result.current.status).toBe('disconnected');

    await act(async () => {
      await result.current.setEnabled({ enabled: true }, 'room-1');
    });
    act(() => currentRoom._emit('connected'));

    expect(result.current.status).toBe('connected');
    expect(result.current.enabled).toBe(true);
  });

  test('a second setEnabled(true) while connected does not re-connect', async () => {
    const { result } = renderVoice();
    await act(async () => {
      await result.current.setEnabled({ enabled: true }, 'room-1');
    });
    const callsAfterFirst = mockRoomConnect.mock.calls.length;

    await act(async () => {
      await result.current.setEnabled({ enabled: true }, 'room-1');
    });

    expect(mockRoomConnect.mock.calls.length).toBe(callsAfterFirst);
  });

  test('connect failure sets error status, surfaces the message, leaves enabled false', async () => {
    getTokenImpl = async () => {
      throw new Error('LiveKit credentials not configured');
    };
    const { result } = renderVoice();

    await act(async () => {
      await result.current.setEnabled({ enabled: true }, 'room-1');
    });

    expect(result.current.status).toBe('error');
    expect(result.current.enabled).toBe(false);
    expect(result.current.errorMessage).toBe('LiveKit credentials not configured');
  });

  test('setEnabled(false) disconnects and clears state', async () => {
    const { result } = renderVoice();
    await act(async () => {
      await result.current.setEnabled({ enabled: true }, 'room-1');
    });
    act(() => currentRoom._emit('connected'));

    await act(async () => {
      await result.current.setEnabled({ enabled: false }, 'room-1');
    });

    expect(mockRoomDisconnect).toHaveBeenCalled();
    expect(result.current.status).toBe('disconnected');
    expect(result.current.enabled).toBe(false);
  });

  test('processing_completed drives onResponse with the response; unsubscribes on unmount', () => {
    const onResponse = mock((_r: unknown) => {});
    const orchestrator = makeOrchestrator();
    const ext = liveKitVoice({ onResponse, getToken })(makeCtx(orchestrator));
    const { unmount } = renderHook(() => ext.voice.useVoice());

    expect(capturedProcessingCb).not.toBeNull();
    act(() => capturedProcessingCb!({ response: makeResponse('spoken back') }));

    expect(onResponse).toHaveBeenCalledTimes(1);
    expect(
      (onResponse.mock.calls[0][0] as { userMessage: string }).userMessage,
    ).toBe('spoken back');

    unmount();
    expect(mockOff).toHaveBeenCalled();
  });

  test('TranscriptionReceived joins final segments, trims, and drops empty', async () => {
    const onTranscript = mock((_t: string) => {});
    const orchestrator = makeOrchestrator();
    const ext = liveKitVoice({ onTranscript, getToken })(makeCtx(orchestrator));
    const { result } = renderHook(() => ext.voice.useVoice());
    await act(async () => {
      await result.current.setEnabled({ enabled: true }, 'room-1');
    });

    act(() =>
      currentRoom._emit('transcriptionReceived', [
        { text: 'hello', final: true },
        { text: 'world', final: true },
        { text: 'ignored', final: false },
      ]),
    );
    expect(onTranscript).toHaveBeenLastCalledWith('hello world');
    expect(result.current.currentTranscript).toBe('hello world');

    onTranscript.mockReset();
    act(() =>
      currentRoom._emit('transcriptionReceived', [{ text: '   ', final: true }]),
    );
    expect(onTranscript).not.toHaveBeenCalled();
  });

  test('stopTalking publishes the turn_end packet on the turn topic', async () => {
    const { result } = renderVoice();
    await act(async () => {
      await result.current.setEnabled({ enabled: true }, 'room-1');
    });
    act(() => currentRoom._emit('connected'));

    await act(async () => {
      await result.current.stopTalking();
    });

    const call = mockPublishData.mock.calls.at(-1) as unknown as [
      Uint8Array,
      { reliable: boolean; topic: string },
    ];
    const [payload, opts] = call;
    expect(opts).toEqual({ reliable: true, topic: 'turn' });
    expect(JSON.parse(new TextDecoder().decode(payload))).toEqual({
      type: 'turn_end',
    });
  });
});
