import { describe, expect, mock, test } from 'bun:test';
import type { JobContext } from '@livekit/agents';

// Stub the LiveKit SDK + native plugins so importing the agent module never
// touches real bindings. Only the enum/sentinel shapes the helpers read matter.
const END_OF_STREAM = Symbol('END_OF_STREAM');

// Placeholder constructor for SDK classes whose behavior is irrelevant here.
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
  RoomEvent: {
    DataReceived: 'dataReceived',
    TrackSubscribed: 'trackSubscribed',
  },
  TrackKind: { KIND_AUDIO: 'audio' },
  TrackPublishOptions: Stub,
  TrackSource: { SOURCE_MICROPHONE: 'mic' },
}));

const {
  resolveLiveKitCredentials,
  resolveSttDrainTimeoutMs,
  waitForParticipantOrTimeout,
  pumpTtsStream,
  runSpeechRecognition,
  cancelInFlightTts,
  createSpeakHandler,
  createTurnAggregator,
  createSubscribedMicrophoneTrackHandler,
  createTurnControlHandler,
} = await import('./agent');
const { SPEAK_UTTERANCE_ID_ATTR, TURN_TOPIC } = await import(
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

describe('resolveSttDrainTimeoutMs', () => {
  test('defaults to 5000ms when unset', () => {
    expect(resolveSttDrainTimeoutMs({})).toBe(5000);
  });

  test('parses a valid positive value', () => {
    expect(
      resolveSttDrainTimeoutMs({ MAELSTROM_STT_DRAIN_TIMEOUT_MS: '1250' }),
    ).toBe(1250);
  });

  test('fails closed on invalid values', () => {
    expect(() =>
      resolveSttDrainTimeoutMs({ MAELSTROM_STT_DRAIN_TIMEOUT_MS: 'never' }),
    ).toThrow(/MAELSTROM_STT_DRAIN_TIMEOUT_MS/);
    expect(() =>
      resolveSttDrainTimeoutMs({ MAELSTROM_STT_DRAIN_TIMEOUT_MS: '0' }),
    ).toThrow(/MAELSTROM_STT_DRAIN_TIMEOUT_MS/);
  });
});

function createManualScheduler() {
  let scheduled: (() => void) | null = null;
  return {
    schedule(callback: () => void) {
      scheduled = callback;
      return () => {
        if (scheduled === callback) scheduled = null;
      };
    },
    fire() {
      const callback = scheduled;
      scheduled = null;
      callback?.();
    },
  };
}

describe('createTurnAggregator', () => {
  test('combines all finals from the draining stream and emits the ending turn once', async () => {
    const emitted: string[] = [];
    const scheduler = createManualScheduler();
    const agg = createTurnAggregator({
      flushTimeoutMs: 10_000,
      emit: (t) => emitted.push(t),
      scheduleFallback: scheduler.schedule,
    });

    agg.pushFinal('show the');
    const ended = agg.endTurn();
    agg.pushFinal('weather');
    agg.pushFinal('tomorrow');
    expect(emitted).toEqual([]);
    agg.completeTurn();
    await ended;

    expect(emitted).toEqual(['show the weather tomorrow']);
    agg.completeTurn();
    expect(emitted).toEqual(['show the weather tomorrow']);
    agg.dispose();
  });

  test('a late final arriving after the fallback fired does not leak into the next turn', async () => {
    const emitted: string[] = [];
    const scheduler = createManualScheduler();
    const agg = createTurnAggregator({
      flushTimeoutMs: 10,
      emit: (t) => emitted.push(t),
      scheduleFallback: scheduler.schedule,
    });

    agg.pushFinal('first');
    const firstEnded = agg.endTurn();
    scheduler.fire();
    await firstEnded;
    expect(emitted).toEqual(['first']);

    // The turn-0 trailing final arrives late (after the fallback already emitted) —
    // it must be dropped, never prepended to the next turn.
    agg.pushFinal('straggler');
    agg.completeTurn();

    // A fresh turn runs cleanly, unpolluted by the straggler.
    agg.pushFinal('second');
    const secondEnded = agg.endTurn();
    agg.pushFinal('turn');
    agg.completeTurn();
    await secondEnded;
    expect(emitted).toEqual(['first', 'second turn']);
    agg.dispose();
  });

  test("an empty turn does not swallow the next turn's first final", async () => {
    const emitted: string[] = [];
    const scheduler = createManualScheduler();
    const agg = createTurnAggregator({
      flushTimeoutMs: 10,
      emit: (t) => emitted.push(t),
      scheduleFallback: scheduler.schedule,
    });

    const ended = agg.endTurn(); // accidental tap: no speech, so no trailing final arrives
    scheduler.fire();
    await ended;
    expect(emitted).toEqual([]); // empty turn publishes nothing
    agg.completeTurn();

    // The next real hold must be captured in full.
    agg.pushFinal('real');
    const realEnded = agg.endTurn();
    agg.pushFinal('intent');
    agg.completeTurn();
    await realEnded;
    expect(emitted).toEqual(['real intent']);
    agg.dispose();
  });
});

describe('waitForParticipantOrTimeout', () => {
  test('resolves with the participant when one joins', async () => {
    const participant = { identity: 'user' } as unknown as Awaited<
      ReturnType<JobContext['waitForParticipant']>
    >;
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
    const frames = [
      { frame: 'a' },
      { frame: 'b' },
      END_OF_STREAM,
      { frame: 'c' },
    ];
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

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function makeControllableAudioStream() {
  const frames: unknown[] = [];
  let wake = deferred();
  let ended = false;
  const state = { iteratorCount: 0 };
  return {
    state,
    push(frame: unknown) {
      frames.push(frame);
      wake.resolve();
    },
    end() {
      ended = true;
      wake.resolve();
    },
    stream: {
      async *[Symbol.asyncIterator]() {
        state.iteratorCount++;
        while (!ended || frames.length > 0) {
          if (frames.length === 0) {
            await wake.promise;
            wake = deferred();
            continue;
          }
          yield frames.shift();
        }
      },
    },
  };
}

type FakeSpeechStream = ReturnType<typeof makeControllableSpeechStream>;

function makeControllableSpeechStream(
  id: number,
  order: string[],
  opts: { endInputError?: Error; keepIteratorOpenOnClose?: boolean } = {},
) {
  const events: unknown[] = [];
  let wake = deferred();
  let finished = false;
  let iteratorError: unknown;
  const state = {
    closeCount: 0,
    endInputCount: 0,
    pushed: [] as unknown[],
  };
  return {
    state,
    emit(event: unknown) {
      events.push(event);
      wake.resolve();
    },
    finish() {
      finished = true;
      wake.resolve();
    },
    fail(error: unknown) {
      iteratorError = error;
      wake.resolve();
    },
    stream: {
      pushFrame(frame: unknown) {
        order.push(`push:${id}:${String(frame)}`);
        state.pushed.push(frame);
      },
      endInput() {
        order.push(`end:${id}`);
        state.endInputCount++;
        if (opts.endInputError) throw opts.endInputError;
      },
      close() {
        order.push(`close:${id}`);
        state.closeCount++;
        if (!opts.keepIteratorOpenOnClose) finished = true;
        wake.resolve();
      },
      async *[Symbol.asyncIterator]() {
        while (!finished || events.length > 0) {
          if (iteratorError) throw iteratorError;
          if (events.length === 0) {
            await wake.promise;
            wake = deferred();
            continue;
          }
          yield events.shift();
        }
        if (iteratorError) throw iteratorError;
      },
    },
  };
}

async function waitFor(check: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (check()) return;
    await Promise.resolve();
  }
  throw new Error('condition was not reached');
}

function createRecognitionHarness(
  opts: {
    streamOptions?: (id: number) => {
      endInputError?: Error;
      keepIteratorOpenOnClose?: boolean;
    };
    drainDeadline?: { promise: Promise<void> };
  } = {},
) {
  const order: string[] = [];
  const audio = makeControllableAudioStream();
  const streams: FakeSpeechStream[] = [];
  const finals: string[] = [];
  const receivedFinals: string[] = [];
  const scheduler = createManualScheduler();
  const drainDeadline = opts.drainDeadline;
  let customDeadlineUsed = false;
  const aggregator = createTurnAggregator({
    emit: (text) => finals.push(text),
    fallback: false,
  });
  let endTurn: (() => Promise<void>) | null = null;
  const run = runSpeechRecognition({
    // biome-ignore lint/suspicious/noExplicitAny: structural test double for AudioStream
    audioStream: audio.stream as any,
    createSpeechStream: () => {
      const id = streams.length + 1;
      order.push(`create:${id}`);
      const fake = makeControllableSpeechStream(
        id,
        order,
        opts.streamOptions?.(id),
      );
      streams.push(fake);
      // biome-ignore lint/suspicious/noExplicitAny: structural test double for SpeechStream
      return fake.stream as any;
    },
    onFinalTranscript: (text) => {
      receivedFinals.push(text);
      aggregator.pushFinal(text);
    },
    onTurnEnd: () => aggregator.endTurn(),
    onTurnDrained: () => aggregator.completeTurn(),
    drainTimeoutMs: 5000,
    createDrainDeadline: drainDeadline
      ? () => {
          if (!customDeadlineUsed) {
            customDeadlineUsed = true;
            return { promise: drainDeadline.promise, cancel: () => {} };
          }
          return { promise: new Promise<void>(() => {}), cancel: () => {} };
        }
      : undefined,
    setEndTurnHandler: (handler) => {
      endTurn = handler;
    },
  });
  run.catch(() => {});
  return {
    audio,
    aggregator,
    endTurn: () => {
      if (!endTurn) throw new Error('turn handler is not installed');
      return endTurn();
    },
    finals,
    order,
    receivedFinals,
    run,
    scheduler,
    streams,
  };
}

const finalEvent = (text: string) => ({
  type: 'final_transcript',
  alternatives: [{ text }],
});

describe('runSpeechRecognition per-turn lifecycle', () => {
  test('keeps one audio iterator while ending, draining, closing, and replacing each speech stream', async () => {
    const harness = createRecognitionHarness();
    await waitFor(() => harness.streams.length === 1);
    harness.audio.push('turn-1');
    await waitFor(() => harness.streams[0].state.pushed.length === 1);

    const boundary = harness.endTurn();
    expect(harness.streams[0].state.endInputCount).toBe(1);
    harness.streams[0].emit(finalEvent(' late final '));
    harness.streams[0].emit(finalEvent(' segment '));
    await Promise.resolve();
    expect(harness.finals).toEqual([]);
    expect(harness.streams).toHaveLength(1);
    harness.streams[0].finish();
    await boundary;

    expect(harness.order).toEqual([
      'create:1',
      'push:1:turn-1',
      'end:1',
      'close:1',
      'create:2',
    ]);
    expect(harness.finals).toEqual(['late final segment']);
    harness.audio.push('turn-2');
    await waitFor(() => harness.streams[1].state.pushed.length === 1);
    expect(harness.streams[1].state.pushed).toEqual(['turn-2']);
    expect(harness.audio.state.iteratorCount).toBe(1);

    harness.audio.end();
    harness.streams[1].finish();
    await harness.run;
  });

  test('defers the aggregation fallback while the provider stream is still draining', async () => {
    const harness = createRecognitionHarness();
    await waitFor(() => harness.streams.length === 1);
    const boundary = harness.endTurn();
    harness.streams[0].emit(finalEvent('still draining'));
    await waitFor(() => harness.receivedFinals.length === 1);

    harness.scheduler.fire();
    expect(harness.finals).toEqual([]);

    harness.streams[0].emit(finalEvent('complete turn'));
    harness.streams[0].finish();
    await boundary;
    expect(harness.finals).toEqual(['still draining complete turn']);
    harness.audio.end();
    harness.streams[1].finish();
    await harness.run;
  });

  test('coalesces duplicate boundaries while a stream drains', async () => {
    const harness = createRecognitionHarness();
    await waitFor(() => harness.streams.length === 1);
    const first = harness.endTurn();
    const duplicate = harness.endTurn();
    expect(harness.streams[0].state.endInputCount).toBe(1);
    harness.streams[0].finish();
    await Promise.all([first, duplicate]);
    expect(harness.streams).toHaveLength(2);
    harness.audio.end();
    harness.streams[1].finish();
    await harness.run;
  });

  test('drops frames during provider drain without blocking the track frame pump', async () => {
    const harness = createRecognitionHarness();
    await waitFor(() => harness.streams.length === 1);
    const boundary = harness.endTurn();
    harness.audio.push('dropped-while-draining');
    await Promise.resolve();
    expect(harness.streams[0].state.pushed).toEqual([]);
    harness.streams[0].finish();
    await boundary;
    expect(harness.streams[1].state.pushed).toEqual([]);
    harness.audio.push('next-turn');
    await waitFor(() => harness.streams[1].state.pushed.length === 1);
    expect(harness.streams[1].state.pushed).toEqual(['next-turn']);
    harness.audio.end();
    harness.streams[1].finish();
    await harness.run;
  });

  test('does not create a successor when track teardown starts during drain', async () => {
    const harness = createRecognitionHarness();
    await waitFor(() => harness.streams.length === 1);
    const boundary = harness.endTurn();
    harness.audio.end();
    harness.streams[0].finish();
    await Promise.all([boundary, harness.run]);
    expect(harness.streams).toHaveLength(1);
    expect(harness.streams[0].state.closeCount).toBe(1);
  });

  test('observes iterator failure, closes the stream, and installs a clean successor without another frame', async () => {
    const rejections: unknown[] = [];
    const onUnhandled = (error: unknown) => rejections.push(error);
    process.on('unhandledRejection', onUnhandled);
    try {
      const harness = createRecognitionHarness();
      await waitFor(() => harness.streams.length === 1);
      const boundary = harness.endTurn();
      harness.streams[0].emit(finalEvent('salvaged before failure'));
      await waitFor(() => harness.receivedFinals.length === 1);
      harness.streams[0].fail(new Error('iterator failed'));
      await expect(boundary).rejects.toThrow('iterator failed');
      expect(harness.finals).toEqual(['salvaged before failure']);
      expect(harness.streams).toHaveLength(2);
      expect(harness.streams[0].state.closeCount).toBe(1);
      await Promise.resolve();
      expect(rejections).toEqual([]);
      harness.audio.end();
      harness.streams[1].finish();
      await harness.run;
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });

  test('observes endInput failure, closes, and recovers without another audio frame', async () => {
    const harness = createRecognitionHarness({
      streamOptions: (id) =>
        id === 1 ? { endInputError: new Error('end input failed') } : {},
    });
    await waitFor(() => harness.streams.length === 1);
    await expect(harness.endTurn()).rejects.toThrow('end input failed');
    expect(harness.streams).toHaveLength(2);
    expect(harness.streams[0].state.closeCount).toBe(1);
    harness.audio.end();
    harness.streams[1].finish();
    await harness.run;
  });

  test('times out a stalled provider drain, closes it, and installs a clean successor', async () => {
    const deadline = deferred();
    const harness = createRecognitionHarness({ drainDeadline: deadline });
    await waitFor(() => harness.streams.length === 1);
    const boundary = harness.endTurn();
    harness.audio.push('dropped-during-timeout');
    await Promise.resolve();
    deadline.resolve();
    await expect(boundary).rejects.toThrow(/drain timed out/i);
    expect(harness.streams[0].state.closeCount).toBe(1);
    expect(harness.streams).toHaveLength(2);
    expect(harness.streams[1].state.pushed).toEqual([]);
    harness.audio.push('after-timeout');
    await waitFor(() => harness.streams[1].state.pushed.length === 1);
    expect(harness.streams[1].state.pushed).toEqual(['after-timeout']);
    harness.audio.end();
    harness.streams[1].finish();
    await harness.run;
  });

  test('drops a late final from a timed-out stream before the successor turn', async () => {
    const deadline = deferred();
    const harness = createRecognitionHarness({
      drainDeadline: deadline,
      streamOptions: (id) =>
        id === 1 ? { keepIteratorOpenOnClose: true } : {},
    });
    await waitFor(() => harness.streams.length === 1);
    const firstBoundary = harness.endTurn();
    harness.streams[0].emit(finalEvent('salvaged'));
    await Promise.resolve();
    deadline.resolve();
    await expect(firstBoundary).rejects.toThrow(/drain timed out/i);
    expect(harness.finals).toEqual(['salvaged']);

    harness.streams[0].emit(finalEvent('stale late final'));
    await Promise.resolve();
    harness.streams[0].finish();

    const secondBoundary = harness.endTurn();
    harness.streams[1].emit(finalEvent('successor'));
    harness.streams[1].finish();
    await secondBoundary;
    expect(harness.finals).toEqual(['salvaged', 'successor']);
    harness.audio.end();
    harness.streams[2].finish();
    await harness.run;
  });

  test('ignores interim and empty finals while trimming valid final transcripts', async () => {
    const harness = createRecognitionHarness();
    await waitFor(() => harness.streams.length === 1);
    const boundary = harness.endTurn();
    harness.streams[0].emit({
      type: 'interim_transcript',
      alternatives: [{ text: 'ignored' }],
    });
    harness.streams[0].emit(finalEvent('   '));
    harness.streams[0].emit(finalEvent(' accepted '));
    harness.streams[0].finish();
    await boundary;
    expect(harness.finals).toEqual(['accepted']);
    harness.audio.end();
    harness.streams[1].finish();
    await harness.run;
  });

  test('an empty turn rotates cleanly and the next real turn still receives audio', async () => {
    const harness = createRecognitionHarness();
    await waitFor(() => harness.streams.length === 1);
    const emptyBoundary = harness.endTurn();
    harness.streams[0].finish();
    await emptyBoundary;
    harness.audio.push('real-turn');
    await waitFor(() => harness.streams[1].state.pushed.length === 1);
    expect(harness.streams[1].state.pushed).toEqual(['real-turn']);
    harness.audio.end();
    harness.streams[1].finish();
    await harness.run;
  });

  test('routes an authorized TURN_TOPIC tts_cancel while STT drains', async () => {
    const harness = createRecognitionHarness();
    await waitFor(() => harness.streams.length === 1);
    const boundary = harness.endTurn();
    const stream = { close: mock(() => {}) };
    const source = { clearQueue: mock(() => {}) };
    const handler = createTurnControlHandler({
      boundIdentity: 'user',
      endTurn: () => harness.endTurn(),
      cancelTts: () => {
        // biome-ignore lint/suspicious/noExplicitAny: structural TTS doubles
        cancelInFlightTts(stream as any, source as any);
      },
      onMalformed: () => {},
      onTurnEndError: () => {},
    });
    handler(
      new TextEncoder().encode(JSON.stringify({ type: 'tts_cancel' })),
      { identity: 'user' },
      undefined,
      TURN_TOPIC,
    );
    expect(stream.close).toHaveBeenCalledTimes(1);
    expect(source.clearQueue).toHaveBeenCalledTimes(1);
    expect(harness.streams).toHaveLength(1);
    harness.streams[0].finish();
    await boundary;
    expect(harness.order.slice(-2)).toEqual(['close:1', 'create:2']);
    harness.audio.end();
    harness.streams[1].finish();
    await harness.run;
  });
});

describe('createTurnControlHandler', () => {
  test('ignores turn controls from any identity except the bound user', async () => {
    const endTurn = mock(async () => {});
    const cancelTts = mock(() => {});
    const handler = createTurnControlHandler({
      boundIdentity: 'bound-user',
      endTurn,
      cancelTts,
      onMalformed: () => {},
      onTurnEndError: () => {},
    });
    const payload = new TextEncoder().encode(
      JSON.stringify({ type: 'turn_end' }),
    );
    const cancelPayload = new TextEncoder().encode(
      JSON.stringify({ type: 'tts_cancel' }),
    );

    handler(payload, { identity: 'other-user' }, undefined, TURN_TOPIC);
    handler(payload, undefined, undefined, TURN_TOPIC);
    handler(cancelPayload, { identity: 'other-user' }, undefined, TURN_TOPIC);
    await Promise.resolve();

    expect(endTurn).not.toHaveBeenCalled();
    expect(cancelTts).not.toHaveBeenCalled();
  });

  test('treats malformed controls as a metadata-only no-op', () => {
    const malformed = mock(() => {});
    const handler = createTurnControlHandler({
      boundIdentity: 'user',
      endTurn: async () => {},
      cancelTts: () => {},
      onMalformed: malformed,
      onTurnEndError: () => {},
    });

    handler(
      new TextEncoder().encode('{raw transcript'),
      { identity: 'user' },
      undefined,
      TURN_TOPIC,
    );

    expect(malformed).toHaveBeenCalledTimes(1);
    expect(malformed.mock.calls[0]).toEqual([]);
  });
});

describe('createSubscribedMicrophoneTrackHandler', () => {
  test('runs at most one expected-user microphone track and safely ignores overlap', async () => {
    const firstDone = deferred();
    const processed: unknown[] = [];
    const handler = createSubscribedMicrophoneTrackHandler({
      expectedIdentity: 'user',
      processTrack: async (track: unknown) => {
        processed.push(track);
        if (processed.length === 1) await firstDone.promise;
      },
      onProcessingError: () => {},
      onIgnoredTrack: () => {},
    });
    const first = { kind: 'audio' };
    const overlapping = { kind: 'audio' };
    const successor = { kind: 'audio' };

    handler(first as never, { identity: 'user' });
    handler(overlapping as never, { identity: 'user' });
    await Promise.resolve();
    expect(processed).toEqual([first]);

    firstDone.resolve();
    await waitFor(() => processed.length === 1);
    for (let attempt = 0; attempt < 10; attempt++) await Promise.resolve();
    handler(successor as never, { identity: 'user' });
    await waitFor(() => processed.length === 2);
    expect(processed).toEqual([first, successor]);
  });

  test('ignores audio tracks from an unexpected participant', async () => {
    const processTrack = mock(async () => {});
    const handler = createSubscribedMicrophoneTrackHandler({
      expectedIdentity: 'user',
      processTrack,
      onProcessingError: () => {},
      onIgnoredTrack: () => {},
    });

    handler({ kind: 'audio' } as never, { identity: 'attacker' });
    await Promise.resolve();

    expect(processTrack).not.toHaveBeenCalled();
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
