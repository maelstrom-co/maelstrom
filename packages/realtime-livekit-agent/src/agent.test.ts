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
  resolveFlushTimeoutMs,
  waitForParticipantOrTimeout,
  pumpTtsStream,
  runSpeechRecognition,
  cancelInFlightTts,
  createSpeakHandler,
  createTurnAggregator,
} = await import('./agent');
const { SPEAK_UTTERANCE_ID_ATTR } = await import(
  '@maelstrom-co/realtime-livekit/protocol'
);

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

describe('resolveFlushTimeoutMs', () => {
  test('defaults to 2000ms when unset', () => {
    expect(resolveFlushTimeoutMs({})).toBe(2000);
  });

  test('parses a valid positive integer', () => {
    expect(resolveFlushTimeoutMs({ MAELSTROM_STT_FLUSH_TIMEOUT_MS: '750' })).toBe(750);
  });

  test('fails closed on a non-numeric value', () => {
    expect(() =>
      resolveFlushTimeoutMs({ MAELSTROM_STT_FLUSH_TIMEOUT_MS: 'soon' }),
    ).toThrow(/MAELSTROM_STT_FLUSH_TIMEOUT_MS/);
  });

  test('fails closed on a non-positive value', () => {
    expect(() =>
      resolveFlushTimeoutMs({ MAELSTROM_STT_FLUSH_TIMEOUT_MS: '0' }),
    ).toThrow(/MAELSTROM_STT_FLUSH_TIMEOUT_MS/);
    expect(() =>
      resolveFlushTimeoutMs({ MAELSTROM_STT_FLUSH_TIMEOUT_MS: '-5' }),
    ).toThrow(/MAELSTROM_STT_FLUSH_TIMEOUT_MS/);
  });
});

describe('createTurnAggregator', () => {
  const settle = (ms: number) => new Promise((r) => setTimeout(r, ms));

  test('the flush-final emits the turn immediately, without waiting the full timeout', () => {
    const emitted: string[] = [];
    const agg = createTurnAggregator({
      flushTimeoutMs: 10_000,
      emit: (t) => emitted.push(t),
    });

    agg.pushFinal('show the');
    agg.endTurn(); // client released the button → flush()
    agg.pushFinal('weather'); // the trailing final flush() produced

    // Emitted synchronously on the flush-final, not after the 10s fallback.
    expect(emitted).toEqual(['show the weather']);
    agg.dispose();
  });

  test('a late final arriving after the fallback fired does not leak into the next turn', async () => {
    const emitted: string[] = [];
    const agg = createTurnAggregator({
      flushTimeoutMs: 10,
      emit: (t) => emitted.push(t),
    });

    agg.pushFinal('first');
    agg.endTurn();
    await settle(30); // fallback fires, emits the turn with what it had
    expect(emitted).toEqual(['first']);

    // The turn-0 flush-final arrives late (after the fallback already emitted) —
    // it must be dropped, never prepended to the next turn.
    agg.pushFinal('straggler');

    // A fresh turn runs cleanly, unpolluted by the straggler.
    agg.pushFinal('second');
    agg.endTurn();
    agg.pushFinal('turn');
    expect(emitted).toEqual(['first', 'second turn']);
    agg.dispose();
  });

  test('an empty turn does not swallow the next turn\'s first final', async () => {
    const emitted: string[] = [];
    const agg = createTurnAggregator({
      flushTimeoutMs: 10,
      emit: (t) => emitted.push(t),
    });

    agg.endTurn(); // accidental tap: no speech, so no flush-final ever arrives
    await settle(30);
    expect(emitted).toEqual([]); // empty turn publishes nothing

    // The next real hold must be captured in full.
    agg.pushFinal('real');
    agg.endTurn();
    agg.pushFinal('intent');
    expect(emitted).toEqual(['real intent']);
    agg.dispose();
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
function makeFakeSpeechStream(
  events: unknown[],
  opts: { throwAfterFirst?: boolean; throwWhenClosed?: boolean } = {},
) {
  const state = { inputEnded: false, closed: false, pushed: [] as unknown[] };
  return {
    stream: {
      pushFrame: (f: unknown) => {
        if (opts.throwWhenClosed && state.closed) {
          throw new Error('cannot push frame: stream is closed');
        }
        state.pushed.push(f);
      },
      endInput: () => {
        if (opts.throwWhenClosed && state.closed) {
          throw new Error('cannot end input: stream is closed');
        }
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

// Yields frames on a timer so the pipe task is still draining audio when the
// consume loop fails and the stream is closed underneath it.
async function* delayedFrames(...frames: unknown[]) {
  for (const f of frames) {
    await new Promise((r) => setTimeout(r, 10));
    yield f;
  }
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

  test('does not leak an unhandled rejection when the consume loop throws mid-pipe', async () => {
    const rejections: unknown[] = [];
    const onUnhandled = (err: unknown) => rejections.push(err);
    process.on('unhandledRejection', onUnhandled);
    try {
      const events = [{ type: 'final_transcript', alternatives: [{ text: 'hi' }] }];
      const { stream, state } = makeFakeSpeechStream(events, {
        throwAfterFirst: true,
        throwWhenClosed: true,
      });
      await expect(
        runSpeechRecognition(
          // biome-ignore lint/suspicious/noExplicitAny: structural test doubles for AudioStream/SpeechStream
          delayedFrames('f1', 'f2', 'f3') as any,
          // biome-ignore lint/suspicious/noExplicitAny: structural test doubles for AudioStream/SpeechStream
          stream as any,
          () => {},
        ),
      ).rejects.toThrow('stt boom');
      // Let the detached pipe task attempt its next push against the closed stream.
      await new Promise((r) => setTimeout(r, 60));
      expect(state.closed).toBe(true);
      expect(rejections).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });
});

function makeFakeTextStreamReader(
  result: string | Error,
  opts: { delayMs?: number; attributes?: Record<string, string> } = {},
) {
  return {
    info: { attributes: opts.attributes },
    readAll: () =>
      new Promise<string>((resolve, reject) => {
        const settle = () => {
          if (result instanceof Error) reject(result);
          else resolve(result);
        };
        if (opts.delayMs) setTimeout(settle, opts.delayMs);
        else settle();
      }),
  };
}

describe('createSpeakHandler', () => {
  test('speaks successive turns serially, in call order', async () => {
    const spoken: string[] = [];
    const handler = createSpeakHandler({
      speak: async (text) => {
        spoken.push(text);
      },
      onSpeakError: () => {},
    });
    // biome-ignore lint/suspicious/noExplicitAny: structural test double for TextStreamReader
    handler(makeFakeTextStreamReader('first', { delayMs: 20 }) as any);
    // biome-ignore lint/suspicious/noExplicitAny: structural test double for TextStreamReader
    handler(makeFakeTextStreamReader('second') as any);
    await new Promise((r) => setTimeout(r, 60));
    expect(spoken).toEqual(['first', 'second']);
  });

  test('forwards the utterance id from the stream attributes so the worker can echo it', async () => {
    const spoken: Array<{ text: string; utteranceId: number | undefined }> = [];
    const handler = createSpeakHandler({
      speak: async (text, utteranceId) => {
        spoken.push({ text, utteranceId });
      },
      onSpeakError: () => {},
    });
    const reader = makeFakeTextStreamReader('hello', {
      attributes: { [SPEAK_UTTERANCE_ID_ATTR]: '7' },
    });
    // biome-ignore lint/suspicious/noExplicitAny: structural test double for TextStreamReader
    handler(reader as any);
    await new Promise((r) => setTimeout(r, 20));
    expect(spoken).toEqual([{ text: 'hello', utteranceId: 7 }]);
  });

  test('forwards an undefined utterance id when the stream carries no id attribute', async () => {
    const ids: Array<number | undefined> = [];
    const handler = createSpeakHandler({
      speak: async (_text, utteranceId) => {
        ids.push(utteranceId);
      },
      onSpeakError: () => {},
    });
    // biome-ignore lint/suspicious/noExplicitAny: structural test double for TextStreamReader
    handler(makeFakeTextStreamReader('hi') as any);
    await new Promise((r) => setTimeout(r, 20));
    expect(ids).toEqual([undefined]);
  });

  test('does not leak an unhandled rejection when readAll rejects, and later turns still speak', async () => {
    const rejections: unknown[] = [];
    const onUnhandled = (err: unknown) => rejections.push(err);
    process.on('unhandledRejection', onUnhandled);
    try {
      const spoken: string[] = [];
      const errors: unknown[] = [];
      const handler = createSpeakHandler({
        speak: async (text) => {
          spoken.push(text);
        },
        onSpeakError: (err) => {
          errors.push(err);
        },
      });
      handler(
        // biome-ignore lint/suspicious/noExplicitAny: structural test double for TextStreamReader
        makeFakeTextStreamReader(new Error('stream closed abnormally')) as any,
      );
      // biome-ignore lint/suspicious/noExplicitAny: structural test double for TextStreamReader
      handler(makeFakeTextStreamReader('after-failure') as any);
      await new Promise((r) => setTimeout(r, 50));
      expect(spoken).toEqual(['after-failure']);
      expect(errors).toEqual([new Error('stream closed abnormally')]);
      expect(rejections).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });
});
