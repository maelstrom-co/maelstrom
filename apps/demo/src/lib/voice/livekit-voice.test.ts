import { test, expect, mock, beforeEach, describe } from 'bun:test';

// --- Mocks for livekit-client ---

const mockRoomConnect = mock(async () => {});
const mockRoomDisconnect = mock(async () => {});
const mockPublishData = mock(async () => {});
const mockSetMicrophoneEnabled = mock(async () => undefined);

const mockLocalParticipant = {
  setMicrophoneEnabled: mockSetMicrophoneEnabled,
  publishData: mockPublishData,
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
      handlers[event]?.forEach((h) => h(...args));
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
  },
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
    const seams = defaultSeams(orchestrator as never);

    await seams.onTranscript('show me the weather');
    expect(orchestrator.processIntent).toHaveBeenCalledWith('show me the weather');
  });

  test('custom onTranscript override is called instead of processIntent', async () => {
    const orchestrator = makeOrchestrator();
    const customOnTranscript = mock(async (_text: string) => {});

    const { defaultSeams } = await import('./seams');
    const defaultS = defaultSeams(orchestrator as never);

    const customSeam = { ...defaultS, onTranscript: customOnTranscript };
    await customSeam.onTranscript('hello world');

    expect(customOnTranscript).toHaveBeenCalledWith('hello world');
    expect(orchestrator.processIntent).not.toHaveBeenCalled();
  });

  test('onResponse default is a noop', async () => {
    const orchestrator = makeOrchestrator();
    const { defaultSeams } = await import('./seams');
    const seams = defaultSeams(orchestrator as never);

    const result = seams.onResponse('hello');
    expect(result).toBeUndefined();
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
