import { test, expect, mock, beforeEach, describe } from 'bun:test';
import { RealtimeVoiceError } from '@maelstrom-co/realtime';
import type { RealtimeAdapterEvent, UnixSeconds } from '@maelstrom-co/realtime';
import type { LiveKitTokenGrant } from './livekit-token.js';

// --- Mocks for livekit-client ---

const mockRoomConnect = mock(async () => {});
const mockRoomDisconnect = mock(async () => {});
const mockPublishData = mock(async () => {});
const mockSetMicrophoneEnabled = mock(async () => undefined);
const mockSendText = mock(async (_text: string, _opts?: unknown) => ({}));
const mockStartAudio = mock(async () => {});

// A live mic publication, returned by getTrackPublication(Source.Microphone).
// `mediaStream` stands in for the browser MediaStream getAudioStreams surfaces.
const mockMicStream = { id: 'mic-stream' } as unknown as MediaStream;
const mockMicPublication = {
  track: { mediaStream: mockMicStream },
};

const mockLocalParticipant = {
  setMicrophoneEnabled: mockSetMicrophoneEnabled,
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

const { LiveKitAdapter } = await import('./livekit-adapter');
const { SPEAK_TOPIC, TURN_TOPIC, TTS_TOPIC } = await import('./protocol');

const DEFAULT_GRANT: LiveKitTokenGrant = {
  token: 'test-token',
  url: 'ws://localhost:7880',
  expiresAt: (Math.floor(Date.now() / 1000) + 900) as UnixSeconds,
};

function makeAdapter(
  mintToken: (roomName: string) => Promise<LiveKitTokenGrant> = async () => DEFAULT_GRANT,
  options: { thinkingFallbackMs?: number } = {},
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
    .filter((e): e is Extract<RealtimeAdapterEvent, { type: 'state' }> => e.type === 'state')
    .map((e) => e.state);
}

// ---

describe('LiveKitAdapter connect', () => {
  beforeEach(() => {
    currentRoom = makeMockRoom();
    mockRoomConnect.mockReset();
    mockSetMicrophoneEnabled.mockReset();
  });

  test('emits connecting → connected and publishes+mutes the mic', async () => {
    const { adapter, events } = makeAdapter();
    await adapter.connect({ tools: [], instructions: '' });

    expect(states(events)).toEqual(['connecting', 'connected']);
    expect(mockRoomConnect).toHaveBeenCalledWith('ws://localhost:7880', 'test-token');
    // publish (true) then mute (false) — the hold-to-talk flip precondition.
    expect(mockSetMicrophoneEnabled.mock.calls.map((c) => c[0])).toEqual([true, false]);
  });

  test('a token failure wraps as TOKEN_MINT_FAILED, tears down, and ends in error state', async () => {
    const cause = new Error('LiveKit credentials not configured');
    const { adapter, events } = makeAdapter(async () => {
      throw cause;
    });

    const error = await adapter
      .connect({ tools: [], instructions: '' })
      .then(() => undefined, (e: unknown) => e);
    expect(error).toBeInstanceOf(RealtimeVoiceError);
    expect((error as RealtimeVoiceError).code).toBe('TOKEN_MINT_FAILED');
    expect((error as RealtimeVoiceError).cause).toBe(cause);
    expect(states(events)).toEqual(['connecting', 'error']);
  });

  test('rejects a second concurrent connect', async () => {
    const { adapter } = makeAdapter();
    await adapter.connect({ tools: [], instructions: '' });
    await expect(adapter.connect({ tools: [], instructions: '' })).rejects.toThrow(
      'already connected',
    );
  });

  test('a post-connect step failure disconnects the room, not just teardown', async () => {
    mockRoomDisconnect.mockClear();
    const { adapter, events } = makeAdapter();
    // room.connect succeeds; the mic publish (a later step) blows up.
    mockSetMicrophoneEnabled.mockImplementationOnce(async () => {
      throw new Error('mic publish failed');
    });

    await expect(adapter.connect({ tools: [], instructions: '' })).rejects.toThrow(
      'mic publish failed',
    );
    // The already-connected room must be torn down over the wire, not leaked.
    expect(mockRoomDisconnect).toHaveBeenCalled();
    expect(states(events)).toEqual(['connecting', 'error']);
  });

  test('a Disconnected event tears down so the adapter can reconnect', async () => {
    const { adapter, events } = makeAdapter();
    await adapter.connect({ tools: [], instructions: '' });

    currentRoom._emit('disconnected');
    expect(states(events).at(-1)).toBe('idle');

    // Teardown ran, so a fresh connect must not throw 'already connected'.
    await expect(adapter.connect({ tools: [], instructions: '' })).resolves.toBeUndefined();
  });

  test('a disconnect during an in-flight connect abandons the orphaned room', async () => {
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
    await connecting;

    // Staleness was detected after mintToken resolved: we never proceeded to
    // join, and never reported a live connection.
    expect(mockRoomConnect).not.toHaveBeenCalled();
    expect(states(events)).not.toContain('connected');
    // The orphaned room was disconnected.
    expect(mockRoomDisconnect).toHaveBeenCalled();
  });
});

describe('LiveKitAdapter transcript → tool_call synthesis', () => {
  beforeEach(() => {
    currentRoom = makeMockRoom();
    mockSetMicrophoneEnabled.mockReset();
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
    expect(JSON.parse(toolCall.argumentsJson)).toEqual({ intent: 'show the weather' });
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
      .filter((e): e is Extract<RealtimeAdapterEvent, { type: 'tool_call' }> => e.type === 'tool_call')
      .map((e) => e.callId as string);
    expect(ids.length).toBe(2);
    expect(ids[0]).not.toBe(ids[1]);
  });

  test('an empty or non-final transcription emits nothing', async () => {
    const { adapter, events } = makeAdapter();
    await adapter.connect({ tools: [], instructions: '' });
    const before = events.length;

    currentRoom._emit('transcriptionReceived', [{ text: '   ', final: true }]);
    currentRoom._emit('transcriptionReceived', [{ text: 'partial', final: false }]);

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

  test('sends the update_ui summary over the speak text stream', async () => {
    const { adapter, events } = makeAdapter();
    await adapter.connect({ tools: [], instructions: '' });

    await adapter.sendToolResult('call-1' as never, {
      ok: true,
      summary: 'Weather is on screen.',
    });

    expect(mockSendText).toHaveBeenCalledWith('Weather is on screen.', {
      topic: SPEAK_TOPIC,
    });
    // speaking is announced on hand-off and STAYS until the worker signals
    // playout end — it no longer collapses when the text is handed off.
    expect(states(events).at(-1)).toBe('speaking');
  });

  test('collapses speaking → connected only when the worker signals tts_done', async () => {
    const { adapter, events } = makeAdapter();
    await adapter.connect({ tools: [], instructions: '' });

    await adapter.sendToolResult('call-1' as never, { summary: 'Done.' });
    expect(states(events).at(-1)).toBe('speaking');

    currentRoom._emit('dataReceived', encodeTts('tts_done'), undefined, undefined, TTS_TOPIC);
    expect(states(events).at(-1)).toBe('connected');
  });

  test('a send failure surfaces a DATA_CHANNEL_ERROR and releases speaking', async () => {
    const { adapter, events } = makeAdapter();
    await adapter.connect({ tools: [], instructions: '' });
    mockSendText.mockImplementationOnce(async () => {
      throw new Error('stream closed');
    });

    await adapter.sendToolResult('call-1' as never, { summary: 'Done.' });

    const err = events.find((e) => e.type === 'error');
    expect(err?.type === 'error' && err.error).toBeInstanceOf(RealtimeVoiceError);
    expect(err?.type === 'error' && (err.error as RealtimeVoiceError).code).toBe(
      'DATA_CHANNEL_ERROR',
    );
    // No audio will play, so speaking must not linger.
    expect(states(events).at(-1)).toBe('connected');
  });

  test('with no active room, wraps the failure in a RealtimeVoiceError', async () => {
    const { adapter, events } = makeAdapter();
    // Never connected — no room.
    await adapter.sendToolResult('call-1' as never, { summary: 'Done.' });

    const err = events.find((e) => e.type === 'error');
    expect(err?.type === 'error' && err.error).toBeInstanceOf(RealtimeVoiceError);
    expect(err?.type === 'error' && (err.error as RealtimeVoiceError).code).toBe(
      'CONNECTION_FAILED',
    );
    expect(mockSendText).not.toHaveBeenCalled();
  });

  test('accepts a bare string output', async () => {
    const { adapter } = makeAdapter();
    await adapter.connect({ tools: [], instructions: '' });

    await adapter.sendToolResult('call-2' as never, 'plain text');
    expect(mockSendText).toHaveBeenCalledWith('plain text', { topic: SPEAK_TOPIC });
  });

  test('falls back to JSON when there is no summary field', async () => {
    const { adapter } = makeAdapter();
    await adapter.connect({ tools: [], instructions: '' });

    await adapter.sendToolResult('call-3' as never, { instances: [] });
    expect(mockSendText).toHaveBeenCalledWith('{"instances":[]}', {
      topic: SPEAK_TOPIC,
    });
  });
});

describe('LiveKitAdapter turnControl (push-to-talk) state mapping', () => {
  beforeEach(() => {
    currentRoom = makeMockRoom();
    mockSetMicrophoneEnabled.mockReset();
    mockPublishData.mockReset();
  });

  test('startTurn unmutes and emits speech_started + listening', async () => {
    const { adapter, events } = makeAdapter();
    await adapter.connect({ tools: [], instructions: '' });
    mockSetMicrophoneEnabled.mockReset();

    await adapter.turnControl.startTurn();

    expect(mockSetMicrophoneEnabled).toHaveBeenCalledWith(true);
    expect(events.some((e) => e.type === 'speech_started')).toBe(true);
    expect(states(events).at(-1)).toBe('listening');
  });

  test('endTurn publishes turn_end on the turn topic, mutes, emits thinking', async () => {
    const { adapter, events } = makeAdapter();
    await adapter.connect({ tools: [], instructions: '' });
    mockSetMicrophoneEnabled.mockReset();

    await adapter.turnControl.endTurn();

    const [payload, opts] = mockPublishData.mock.calls.at(-1) as unknown as [
      Uint8Array,
      { reliable: boolean; topic: string },
    ];
    expect(opts).toEqual({ reliable: true, topic: TURN_TOPIC });
    expect(JSON.parse(new TextDecoder().decode(payload))).toEqual({ type: 'turn_end' });
    expect(mockSetMicrophoneEnabled).toHaveBeenCalledWith(false);
    expect(states(events).at(-1)).toBe('thinking');
  });

  test('endTurn mutes the mic before publishing turn_end', async () => {
    const order: string[] = [];
    const { adapter } = makeAdapter();
    await adapter.connect({ tools: [], instructions: '' });
    mockSetMicrophoneEnabled.mockImplementation(async () => {
      order.push('mute');
    });
    mockPublishData.mockImplementation(async () => {
      order.push('publish');
    });

    await adapter.turnControl.endTurn();

    // Mute is local and must land first, so a publish rejection can't leave the
    // mic hot.
    expect(order).toEqual(['mute', 'publish']);
  });

  test('endTurn surfaces a DATA_CHANNEL_ERROR when publishData rejects but still muted', async () => {
    const { adapter, events } = makeAdapter();
    await adapter.connect({ tools: [], instructions: '' });
    mockSetMicrophoneEnabled.mockClear();
    mockPublishData.mockImplementationOnce(async () => {
      throw new Error('data channel closed');
    });

    await adapter.turnControl.endTurn();

    expect(mockSetMicrophoneEnabled).toHaveBeenCalledWith(false);
    const err = events.find((e) => e.type === 'error');
    expect(err?.type === 'error' && (err.error as RealtimeVoiceError).code).toBe(
      'DATA_CHANNEL_ERROR',
    );
    // Still advances to thinking (the fallback rescues a wedged worker later).
    expect(states(events).at(-1)).toBe('thinking');
  });

  test('endTurn surfaces a CONNECTION_FAILED when muting rejects', async () => {
    const { adapter, events } = makeAdapter();
    await adapter.connect({ tools: [], instructions: '' });
    mockSetMicrophoneEnabled.mockImplementationOnce(async () => {
      throw new Error('mute failed');
    });

    await adapter.turnControl.endTurn();

    const err = events.find((e) => e.type === 'error');
    expect(err?.type === 'error' && (err.error as RealtimeVoiceError).code).toBe(
      'CONNECTION_FAILED',
    );
  });

  test('startTurn surfaces a CONNECTION_FAILED when unmuting rejects and skips listening', async () => {
    const { adapter, events } = makeAdapter();
    await adapter.connect({ tools: [], instructions: '' });
    mockSetMicrophoneEnabled.mockImplementationOnce(async () => {
      throw new Error('unmute failed');
    });

    await adapter.turnControl.startTurn();

    const err = events.find((e) => e.type === 'error');
    expect(err?.type === 'error' && (err.error as RealtimeVoiceError).code).toBe(
      'CONNECTION_FAILED',
    );
    // Mic never went hot, so we must not claim to be listening.
    expect(states(events)).not.toContain('listening');
  });

  test('a barge-in during speaking publishes tts_cancel then still unmutes and listens', async () => {
    const { adapter, events } = makeAdapter();
    await adapter.connect({ tools: [], instructions: '' });

    // Assistant is speaking; the user barges in.
    await adapter.sendToolResult('call-1' as never, { summary: 'Talking…' });
    expect(states(events).at(-1)).toBe('speaking');
    mockSetMicrophoneEnabled.mockClear();
    mockPublishData.mockClear();

    await adapter.turnControl.startTurn();

    const [payload, opts] = mockPublishData.mock.calls.at(-1) as unknown as [
      Uint8Array,
      { reliable: boolean; topic: string },
    ];
    expect(opts).toEqual({ reliable: true, topic: TURN_TOPIC });
    expect(JSON.parse(new TextDecoder().decode(payload))).toEqual({ type: 'tts_cancel' });
    expect(mockSetMicrophoneEnabled).toHaveBeenCalledWith(true);
    expect(states(events).at(-1)).toBe('listening');
  });

  test('a startTurn from connected (no assistant audio) does not publish tts_cancel', async () => {
    const { adapter } = makeAdapter();
    await adapter.connect({ tools: [], instructions: '' });
    mockPublishData.mockClear();

    await adapter.turnControl.startTurn();

    expect(mockPublishData).not.toHaveBeenCalled();
  });

  test('a tts_cancel publish rejection surfaces DATA_CHANNEL_ERROR but still unmutes', async () => {
    const { adapter, events } = makeAdapter();
    await adapter.connect({ tools: [], instructions: '' });
    await adapter.sendToolResult('call-1' as never, { summary: 'Talking…' });
    mockSetMicrophoneEnabled.mockClear();
    mockPublishData.mockImplementationOnce(async () => {
      throw new Error('data channel closed');
    });

    await adapter.turnControl.startTurn();

    const err = events.find((e) => e.type === 'error');
    expect(err?.type === 'error' && (err.error as RealtimeVoiceError).code).toBe(
      'DATA_CHANNEL_ERROR',
    );
    // A failed cancel must not block the user's turn.
    expect(mockSetMicrophoneEnabled).toHaveBeenCalledWith(true);
    expect(states(events).at(-1)).toBe('listening');
  });

  test('a tts_done arriving after a barge-in does not stomp the newer listening state', async () => {
    const { adapter, events } = makeAdapter();
    await adapter.connect({ tools: [], instructions: '' });

    // Assistant starts speaking, then the user barges in (push-to-talk) while
    // audio is still playing — state advances to listening.
    await adapter.sendToolResult('call-1' as never, { summary: 'Talking…' });
    expect(states(events).at(-1)).toBe('speaking');
    await adapter.turnControl.startTurn();
    expect(states(events).at(-1)).toBe('listening');

    // The now-stale worker tts_done must NOT collapse back to connected.
    currentRoom._emit('dataReceived', encodeTts('tts_done'), undefined, undefined, TTS_TOPIC);
    expect(states(events).at(-1)).toBe('listening');
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
    const { adapter, events } = makeAdapter(undefined, { thinkingFallbackMs: 10 });
    await adapter.connect({ tools: [], instructions: '' });

    await adapter.turnControl.endTurn();
    expect(states(events).at(-1)).toBe('thinking');

    await settle(40);
    // Nothing arrived from the worker — the client unwedges itself.
    expect(states(events).at(-1)).toBe('connected');
  });

  test('a transcript arriving cancels the thinking fallback', async () => {
    const { adapter, events } = makeAdapter(undefined, { thinkingFallbackMs: 10 });
    await adapter.connect({ tools: [], instructions: '' });

    await adapter.turnControl.endTurn();
    currentRoom._emit('transcriptionReceived', [{ text: 'hello', final: true }]);

    await settle(40);
    // The worker responded, so the fallback must not fire a spurious connected;
    // the state stays thinking until real activity moves it.
    expect(states(events).at(-1)).toBe('thinking');
  });

  test('a tts signal cancels the thinking fallback', async () => {
    const { adapter, events } = makeAdapter(undefined, { thinkingFallbackMs: 10 });
    await adapter.connect({ tools: [], instructions: '' });

    await adapter.turnControl.endTurn();
    // A tts signal means the worker is alive and driving state.
    currentRoom._emit('dataReceived', encodeTts('tts_error'), undefined, undefined, TTS_TOPIC);

    await settle(40);
    // Only the tts_error's own error path may have run; no fallback connected.
    expect(states(events).at(-1)).not.toBe('connected');
  });

  test('a fallback that fires after a barge-in does not stomp listening', async () => {
    const { adapter, events } = makeAdapter(undefined, { thinkingFallbackMs: 10 });
    await adapter.connect({ tools: [], instructions: '' });

    await adapter.turnControl.endTurn();
    await adapter.turnControl.startTurn();
    expect(states(events).at(-1)).toBe('listening');

    await settle(40);
    expect(states(events).at(-1)).toBe('listening');
  });
});

describe('LiveKitAdapter misc surface', () => {
  beforeEach(() => {
    currentRoom = makeMockRoom();
    mockSetMicrophoneEnabled.mockReset();
  });

  test('a worker tts_error packet surfaces a RealtimeVoiceError error event', async () => {
    const { adapter, events } = makeAdapter();
    await adapter.connect({ tools: [], instructions: '' });

    currentRoom._emit('dataReceived', encodeTts('tts_error'), undefined, undefined, TTS_TOPIC);

    const err = events.find((e) => e.type === 'error');
    expect(err?.type === 'error' && err.error).toBeInstanceOf(RealtimeVoiceError);
    expect(err?.type === 'error' && (err.error as RealtimeVoiceError).code).toBe(
      'DATA_CHANNEL_ERROR',
    );
  });

  test('getAudioStreams exposes the mic publication and subscribed playback track', async () => {
    const { adapter } = makeAdapter();

    // Before connect: no room, so both streams are undefined.
    expect(adapter.getAudioStreams()).toEqual({ mic: undefined, playback: undefined });

    await adapter.connect({ tools: [], instructions: '' });

    // Mic comes from the local microphone publication.
    expect(adapter.getAudioStreams().mic).toBe(mockMicStream);
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
    expect(adapter.getAudioStreams()).toEqual({ mic: undefined, playback: undefined });
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
