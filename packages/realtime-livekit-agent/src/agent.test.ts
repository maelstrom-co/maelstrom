import { test, expect, mock, describe } from 'bun:test';
import type { JobContext } from '@livekit/agents';

// Stub the LiveKit SDK + native plugins so importing the agent module never
// touches real bindings. Only the enum/sentinel shapes the helpers read matter.
const END_OF_STREAM = Symbol('END_OF_STREAM');

// Placeholder constructor for SDK classes the module imports but the helpers
// under test never instantiate (only `entry`/`processAudioTrack` do, and those
// are not driven here).
class Stub {}

mock.module('@livekit/agents', () => ({
  cli: { runApp: mock(() => {}) },
  defineAgent: mock((opts: unknown) => opts),
  ServerOptions: Stub,
  stt: { SpeechEventType: { FINAL_TRANSCRIPT: 'final_transcript' } },
  tts: { SynthesizeStream: { END_OF_STREAM } },
}));
mock.module('@livekit/agents-plugin-deepgram', () => ({ STT: Stub }));
mock.module('@livekit/agents-plugin-cartesia', () => ({ TTS: Stub }));
mock.module('@livekit/rtc-node', () => ({
  AudioSource: Stub,
  AudioStream: Stub,
  LocalAudioTrack: { createAudioTrack: mock(() => ({})) },
  RoomEvent: { DataReceived: 'dataReceived', TrackSubscribed: 'trackSubscribed' },
  TrackKind: { KIND_AUDIO: 'audio' },
  TrackPublishOptions: Stub,
  TrackSource: { SOURCE_MICROPHONE: 'mic' },
}));

const {
  resolveLiveKitCredentials,
  waitForParticipantOrTimeout,
  pumpTtsStream,
  runSpeechRecognition,
  cancelInFlightTts,
} = await import('./agent');

describe('resolveLiveKitCredentials', () => {
  test('returns the config when all vars are present', () => {
    const config = resolveLiveKitCredentials({
      LIVEKIT_URL: 'ws://host:7880',
      LIVEKIT_API_KEY: 'key',
      LIVEKIT_API_SECRET: 'secret',
    });
    expect(config).toEqual({
      wsURL: 'ws://host:7880',
      apiKey: 'key',
      apiSecret: 'secret',
    });
  });

  test('throws listing every missing var (no silent dev fallbacks)', () => {
    expect(() => resolveLiveKitCredentials({})).toThrow(
      /LIVEKIT_URL.*LIVEKIT_API_KEY.*LIVEKIT_API_SECRET/,
    );
  });

  test('names only the missing var', () => {
    expect(() =>
      resolveLiveKitCredentials({
        LIVEKIT_URL: 'ws://host:7880',
        LIVEKIT_API_KEY: 'key',
      }),
    ).toThrow(/LIVEKIT_API_SECRET/);
  });
});

describe('waitForParticipantOrTimeout', () => {
  test('resolves with the participant when one joins', async () => {
    const participant = { identity: 'user' };
    const ctx = {
      waitForParticipant: mock(async () => participant),
    } as unknown as JobContext;
    const result = await waitForParticipantOrTimeout(ctx, 'user', 1000);
    expect(result).toBe(participant);
  });

  test('resolves null when no participant joins before the deadline', async () => {
    const ctx = {
      waitForParticipant: mock(() => new Promise(() => {})),
    } as unknown as JobContext;
    const result = await waitForParticipantOrTimeout(ctx, 'user', 20);
    expect(result).toBeNull();
  });
});

// A SynthesizeStream stand-in: yields the given items then completes.
function makeFakeTtsStream(items: unknown[]) {
  const state = { closed: false };
  return {
    stream: {
      close: () => {
        state.closed = true;
      },
      async *[Symbol.asyncIterator]() {
        for (const item of items) yield item;
      },
    },
    state,
  };
}

describe('pumpTtsStream', () => {
  test('captures frames until END_OF_STREAM then closes the stream', async () => {
    const frames = [{ frame: 'a' }, { frame: 'b' }, END_OF_STREAM, { frame: 'c' }];
    const { stream, state } = makeFakeTtsStream(frames);
    const captured: unknown[] = [];
    // biome-ignore lint/suspicious/noExplicitAny: structural test double for SynthesizeStream
    await pumpTtsStream(stream as any, async (frame) => {
      captured.push(frame);
    });
    expect(captured).toEqual(['a', 'b']);
    expect(state.closed).toBe(true);
  });

  test('closes the stream even when frame capture throws', async () => {
    const { stream, state } = makeFakeTtsStream([{ frame: 'a' }]);
    await expect(
      // biome-ignore lint/suspicious/noExplicitAny: structural test double for SynthesizeStream
      pumpTtsStream(stream as any, async () => {
        throw new Error('capture boom');
      }),
    ).rejects.toThrow('capture boom');
    expect(state.closed).toBe(true);
  });
});

describe('cancelInFlightTts', () => {
  function makeCancelDoubles() {
    const stream = {
      closeCount: 0,
      close() {
        this.closeCount++;
      },
    };
    const source = {
      clearCount: 0,
      clearQueue() {
        this.clearCount++;
      },
    };
    return { stream, source };
  }

  test('closes the in-flight stream and clears the queued frames', () => {
    const { stream, source } = makeCancelDoubles();
    // biome-ignore lint/suspicious/noExplicitAny: structural doubles for SynthesizeStream/AudioSource
    cancelInFlightTts(stream as any, source as any);
    expect(stream.closeCount).toBe(1);
    expect(source.clearCount).toBe(1);
  });

  test('is a no-op on the stream when idle, but still clears the queue', () => {
    const { source } = makeCancelDoubles();
    // biome-ignore lint/suspicious/noExplicitAny: structural double for AudioSource
    expect(() => cancelInFlightTts(null, source as any)).not.toThrow();
    expect(source.clearCount).toBe(1);
  });

  test('is idempotent when a second cancel arrives on the same stream', () => {
    const { stream, source } = makeCancelDoubles();
    // biome-ignore lint/suspicious/noExplicitAny: structural doubles for SynthesizeStream/AudioSource
    cancelInFlightTts(stream as any, source as any);
    // biome-ignore lint/suspicious/noExplicitAny: structural doubles for SynthesizeStream/AudioSource
    cancelInFlightTts(stream as any, source as any);
    expect(stream.closeCount).toBe(2);
    expect(source.clearCount).toBe(2);
  });
});

// A SpeechStream stand-in: yields queued events, then completes ONLY after
// endInput() is called — mirroring the real SDK iterator, so a test that never
// terminates proves the endInput()/consume deadlock is back.
function makeFakeSpeechStream(events: unknown[], opts: { throwAfterFirst?: boolean } = {}) {
  const state = { inputEnded: false, closed: false, pushed: [] as unknown[] };
  return {
    stream: {
      pushFrame: (f: unknown) => state.pushed.push(f),
      endInput: () => {
        state.inputEnded = true;
      },
      close: () => {
        state.closed = true;
      },
      flush: () => {},
      async *[Symbol.asyncIterator]() {
        let first = true;
        for (const e of events) {
          yield e;
          if (first && opts.throwAfterFirst) throw new Error('stt boom');
          first = false;
        }
        while (!state.inputEnded) {
          await new Promise((r) => setTimeout(r, 2));
        }
      },
    },
    state,
  };
}

async function* framesOf(...frames: unknown[]) {
  for (const f of frames) yield f;
}

describe('runSpeechRecognition', () => {
  test('pipes frames, ends input, collects finals, and closes', async () => {
    const events = [
      { type: 'final_transcript', alternatives: [{ text: ' hello ' }] },
      { type: 'interim', alternatives: [{ text: 'ignored' }] },
      { type: 'final_transcript', alternatives: [{ text: 'world' }] },
    ];
    const { stream, state } = makeFakeSpeechStream(events);
    const finals: string[] = [];
    await runSpeechRecognition(
      // biome-ignore lint/suspicious/noExplicitAny: structural test doubles for AudioStream/SpeechStream
      framesOf('f1', 'f2') as any,
      // biome-ignore lint/suspicious/noExplicitAny: structural test doubles for AudioStream/SpeechStream
      stream as any,
      (text) => finals.push(text),
    );
    expect(state.pushed).toEqual(['f1', 'f2']);
    expect(state.inputEnded).toBe(true);
    expect(state.closed).toBe(true);
    expect(finals).toEqual(['hello', 'world']);
  });

  test('closes the speech stream even when the consume loop throws', async () => {
    const events = [{ type: 'final_transcript', alternatives: [{ text: 'hi' }] }];
    const { stream, state } = makeFakeSpeechStream(events, { throwAfterFirst: true });
    await expect(
      runSpeechRecognition(
        // biome-ignore lint/suspicious/noExplicitAny: structural test doubles for AudioStream/SpeechStream
        framesOf('f1') as any,
        // biome-ignore lint/suspicious/noExplicitAny: structural test doubles for AudioStream/SpeechStream
        stream as any,
        () => {},
      ),
    ).rejects.toThrow('stt boom');
    expect(state.closed).toBe(true);
    expect(state.inputEnded).toBe(true);
  });
});
