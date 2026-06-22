import { test, expect, mock, beforeEach, describe } from 'bun:test';

// --- Mocks for livekit-client ---

const mockRoomConnect = mock(async () => {});
const mockRoomDisconnect = mock(async () => {});
const mockPublishData = mock(async () => {});
const mockSetMicrophoneEnabled = mock(async () => undefined);
const mockSendText = mock(async (_text: string, _opts?: unknown) => ({}));

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
}));

// --- Mocks for get-livekit-token ---

// Stub createServerFn so importing the real ./get-livekit-token module does not
// pull a TanStack Start runtime; the real mintLiveKitToken stays intact for the
// sibling token-route test (Bun's mock.module is process-global).
mock.module('@tanstack/react-start', () => ({
  createServerFn: () => ({
    inputValidator: () => ({ handler: () => () => undefined }),
  }),
}));

// Import after mocks are set up
const { liveKitVoice } = await import('./livekit-voice');

// Minimal orchestrator mock
function makeOrchestrator() {
  return {
    processIntent: mock(async (_text: string) => ({})),
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
    const ext = liveKitVoice()(makeCtx(orchestrator));
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

    seams.onResponse(makeResponse('   '));
    expect(speak).not.toHaveBeenCalled();
  });

  test('a custom shouldSpeak predicate gates the speak transport', async () => {
    const orchestrator = makeOrchestrator();
    const { defaultSeams } = await import('./seams');
    const speak = mock(async (_text: string) => {});
    const never = () => false;
    const seams = defaultSeams(orchestrator as never, speak, never);

    seams.onResponse(makeResponse('would be spoken if predicate allowed'));
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
    const ext = liveKitVoice()(makeCtx(orchestrator));
    const keys = Object.keys(ext);
    expect(keys).toContain('voice');
    expect(keys).not.toContain('Provider');
    expect(keys).not.toContain('Chart');
    expect(keys).not.toContain('useMaelstrom');
  });

  test('extension returned synchronously (no then property)', () => {
    const orchestrator = makeOrchestrator();
    const ext = liveKitVoice()(makeCtx(orchestrator));
    expect((ext as { then?: unknown }).then).toBeUndefined();
  });
});

describe('createSpeakTransport', () => {
  beforeEach(() => {
    mockSendText.mockReset();
  });

  test('sends text to the worker over the speak topic', async () => {
    const { createSpeakTransport, SPEAK_TOPIC } = await import(
      './livekit-voice'
    );
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
