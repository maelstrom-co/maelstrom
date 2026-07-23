import { test, expect, mock, beforeEach, describe, spyOn } from 'bun:test';
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
const { SPEAK_TOPIC, TURN_TOPIC, TTS_TOPIC, SPEAK_UTTERANCE_ID_ATTR } = await import('./protocol');

// The utterance id the client stamped on the most recent speak text stream — the
// worker echoes this on its TTS status packets, so tests read it back to forge a
// matching (current) or mismatching (stale) status.
function lastUtteranceId(): number {
  const opts = mockSendText.mock.calls.at(-1)?.[1] as
    | { attributes?: Record<string, string> }
    | undefined;
  return Number(opts?.attributes?.[SPEAK_UTTERANCE_ID_ATTR]);
}

function encodeTtsWithId(type: 'tts_done' | 'tts_error', utteranceId: number): Uint8Array {
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

  test('rejects a second connect with an ALREADY_CONNECTED RealtimeVoiceError', async () => {
    const { adapter } = makeAdapter();
    await adapter.connect({ tools: [], instructions: '' });

    const error = await adapter
      .connect({ tools: [], instructions: '' })
      .then(() => undefined, (e: unknown) => e);
    expect(error).toBeInstanceOf(RealtimeVoiceError);
    expect((error as RealtimeVoiceError).code).toBe('ALREADY_CONNECTED');
  });

  test('a mic-permission denial on connect surfaces MIC_PERMISSION_DENIED', async () => {
    const { adapter, events } = makeAdapter();
    // livekit-client surfaces the browser getUserMedia rejection here.
    const denied = Object.assign(new Error('Permission denied'), {
      name: 'NotAllowedError',
    });
    mockSetMicrophoneEnabled.mockImplementationOnce(async () => {
      throw denied;
    });

    const error = await adapter
      .connect({ tools: [], instructions: '' })
      .then(() => undefined, (e: unknown) => e);
    expect(error).toBeInstanceOf(RealtimeVoiceError);
    expect((error as RealtimeVoiceError).code).toBe('MIC_PERMISSION_DENIED');
    expect(states(events)).toEqual(['connecting', 'error']);
  });

  test('a post-connect step failure disconnects the room, not just teardown', async () => {
    mockRoomDisconnect.mockClear();
    const { adapter, events } = makeAdapter();
    // room.connect succeeds; the mic publish (a later step) blows up. A generic
    // (non-permission) failure maps to CONNECTION_FAILED, carrying the cause.
    const cause = new Error('mic publish failed');
    mockSetMicrophoneEnabled.mockImplementationOnce(async () => {
      throw cause;
    });

    const error = await adapter
      .connect({ tools: [], instructions: '' })
      .then(() => undefined, (e: unknown) => e);
    expect(error).toBeInstanceOf(RealtimeVoiceError);
    expect((error as RealtimeVoiceError).code).toBe('CONNECTION_FAILED');
    expect((error as RealtimeVoiceError).cause).toBe(cause);
    // The already-connected room must be torn down over the wire, not leaked.
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
    expect(err?.type === 'error' && err.error).toBeInstanceOf(RealtimeVoiceError);
    expect(err?.type === 'error' && (err.error as RealtimeVoiceError).code).toBe(
      'CONNECTION_FAILED',
    );
    expect(states(events)).not.toContain('idle');

    // Teardown still ran, so a fresh connect must not throw 'already connected'.
    await expect(adapter.connect({ tools: [], instructions: '' })).resolves.toBeUndefined();
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
    const error = await connecting.then(() => undefined, (e: unknown) => e);
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
    const error = await first.then(() => undefined, (e: unknown) => e);
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
    const error = await adapter
      .disconnect()
      .then(() => undefined, (e: unknown) => e);
    expect(error).toBe(cause);

    // ...but teardown still ran, so a fresh connect is not rejected as
    // ALREADY_CONNECTED — a failed disconnect must not wedge the adapter.
    await expect(
      adapter.connect({ tools: [], instructions: '' }),
    ).resolves.toBeUndefined();
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

    await adapter.sendToolResult('call-1' as never, { ok: true, summary: 'Done.' });
    expect(states(events).at(-1)).toBe('speaking');

    currentRoom._emit('dataReceived', encodeTts('tts_done'), undefined, undefined, TTS_TOPIC);
    expect(states(events).at(-1)).toBe('connected');
  });

  test('a send failure is non-fatal: a plain error event, no fatal RealtimeVoiceError, releases speaking', async () => {
    const { adapter, events } = makeAdapter();
    await adapter.connect({ tools: [], instructions: '' });
    mockSendText.mockImplementationOnce(async () => {
      throw new Error('stream closed');
    });

    await adapter.sendToolResult('call-1' as never, { ok: true, summary: 'Done.' });

    // The update_ui already applied and nothing waits on the spoken read-back —
    // so a send failure is surfaced as a plain Error (logged, non-fatal), never a
    // session-fatal RealtimeVoiceError. Mirrors the OpenAI adapter's parallel case.
    const err = events.find((e) => e.type === 'error');
    expect(err?.type === 'error' && err.error).toBeInstanceOf(Error);
    expect(err?.type === 'error' && err.error).not.toBeInstanceOf(RealtimeVoiceError);
    expect(events.some((e) => e.type === 'error' && e.error instanceof RealtimeVoiceError)).toBe(
      false,
    );
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

  test('endTurn surfaces a fatal DATA_CHANNEL_ERROR when publishData rejects, still muted, and stops the turn', async () => {
    const { adapter, events } = makeAdapter(undefined, { thinkingFallbackMs: 10 });
    await adapter.connect({ tools: [], instructions: '' });
    mockSetMicrophoneEnabled.mockClear();
    mockPublishData.mockImplementationOnce(async () => {
      throw new Error('data channel closed');
    });

    await adapter.turnControl.endTurn();

    expect(mockSetMicrophoneEnabled).toHaveBeenCalledWith(false);
    const err = events.find((e) => e.type === 'error');
    expect(err?.type === 'error' && err.error).toBeInstanceOf(RealtimeVoiceError);
    expect(err?.type === 'error' && (err.error as RealtimeVoiceError).code).toBe(
      'DATA_CHANNEL_ERROR',
    );
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

    await adapter.turnControl.endTurn();

    const err = events.find((e) => e.type === 'error');
    expect(err?.type === 'error' && (err.error as RealtimeVoiceError).code).toBe(
      'CONNECTION_FAILED',
    );
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

    await adapter.turnControl.startTurn();

    const err = events.find((e) => e.type === 'error');
    expect(err?.type === 'error' && (err.error as RealtimeVoiceError).code).toBe(
      'CONNECTION_FAILED',
    );
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

    await adapter.turnControl.startTurn();

    const err = events.find((e) => e.type === 'error');
    expect(err?.type === 'error' && (err.error as RealtimeVoiceError).code).toBe(
      'MIC_PERMISSION_DENIED',
    );
    expect(states(events)).not.toContain('listening');
  });

  test('a barge-in during speaking publishes tts_cancel then still unmutes and listens', async () => {
    const { adapter, events } = makeAdapter();
    await adapter.connect({ tools: [], instructions: '' });

    // Assistant is speaking; the user barges in.
    await adapter.sendToolResult('call-1' as never, { ok: true, summary: 'Talking…' });
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

  test('a tts_cancel publish rejection is non-fatal: no error event, warns once, and the turn still proceeds', async () => {
    const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const { adapter, events } = makeAdapter();
      await adapter.connect({ tools: [], instructions: '' });

      // First barge-in: assistant speaking, cancel publish rejects.
      await adapter.sendToolResult('call-1' as never, { ok: true, summary: 'Talking…' });
      mockSetMicrophoneEnabled.mockClear();
      mockPublishData.mockImplementationOnce(async () => {
        throw new Error('data channel closed');
      });

      await adapter.turnControl.startTurn();

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
      await adapter.sendToolResult('call-2' as never, { ok: true, summary: 'Talking…' });
      mockPublishData.mockImplementationOnce(async () => {
        throw new Error('data channel closed');
      });
      await adapter.turnControl.startTurn();
      expect(cancelWarns()).toBe(1);
    } finally {
      warnSpy.mockRestore();
    }
  });

  test('a tts_done arriving after a barge-in does not stomp the newer listening state', async () => {
    const { adapter, events } = makeAdapter();
    await adapter.connect({ tools: [], instructions: '' });

    // Assistant starts speaking, then the user barges in (push-to-talk) while
    // audio is still playing — state advances to listening.
    await adapter.sendToolResult('call-1' as never, { ok: true, summary: 'Talking…' });
    expect(states(events).at(-1)).toBe('speaking');
    await adapter.turnControl.startTurn();
    expect(states(events).at(-1)).toBe('listening');

    // The now-stale worker tts_done must NOT collapse back to connected.
    currentRoom._emit('dataReceived', encodeTts('tts_done'), undefined, undefined, TTS_TOPIC);
    expect(states(events).at(-1)).toBe('listening');
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

    await adapter.sendToolResult('call-1' as never, { ok: true, summary: 'Done.' });
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

    await adapter.sendToolResult('call-1' as never, { ok: true, summary: 'Done.' });

    const opts = mockSendText.mock.calls.at(-1)?.[1] as {
      topic: string;
      attributes?: Record<string, string>;
    };
    expect(opts.topic).toBe(SPEAK_TOPIC);
    expect(Number(opts.attributes?.[SPEAK_UTTERANCE_ID_ATTR])).toBeGreaterThan(0);
  });

  test('a stale tts_done from a barged-past utterance is a no-op: fallback not cleared, state unchanged, and the fallback still fires', async () => {
    const { adapter, events } = makeAdapter(undefined, { thinkingFallbackMs: 20 });
    await adapter.connect({ tools: [], instructions: '' });

    // Assistant is speaking utterance A.
    await adapter.sendToolResult('call-1' as never, { ok: true, summary: 'Talking…' });
    const utteranceA = lastUtteranceId();
    expect(states(events).at(-1)).toBe('speaking');

    // User barges in (invalidating A) then releases without speaking → thinking +
    // armed empty-turn fallback.
    await adapter.turnControl.startTurn();
    await adapter.turnControl.endTurn();
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

  test('a worker tts_error is non-fatal: no error event, and speaking collapses', async () => {
    const { adapter, events } = makeAdapter();
    await adapter.connect({ tools: [], instructions: '' });

    // The update_ui already rendered; only its spoken read-back failed.
    await adapter.sendToolResult('call-1' as never, { ok: true, summary: 'Done.' });
    expect(states(events).at(-1)).toBe('speaking');

    currentRoom._emit('dataReceived', encodeTts('tts_error'), undefined, undefined, TTS_TOPIC);

    // Non-fatal: no RealtimeVoiceError (which would tear the session down)...
    expect(events.some((e) => e.type === 'error')).toBe(false);
    // ...and the transient speaking state is released so the UI doesn't hang.
    expect(states(events).at(-1)).toBe('connected');
  });

  test('a malformed TTS_TOPIC packet is non-fatal and collapses speaking', async () => {
    const { adapter, events } = makeAdapter();
    await adapter.connect({ tools: [], instructions: '' });

    await adapter.sendToolResult('call-1' as never, { ok: true, summary: 'Done.' });
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
