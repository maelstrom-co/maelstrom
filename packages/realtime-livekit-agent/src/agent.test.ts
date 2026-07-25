import { describe, expect, mock, test } from 'bun:test';
import type { JobContext } from '@livekit/agents';

// Stub the LiveKit SDK + native plugins so importing the agent module never
// touches real bindings. Only the enum/sentinel shapes the helpers read matter.
const END_OF_STREAM = Symbol('END_OF_STREAM');

// Placeholder constructor for SDK classes whose behavior is irrelevant here.
class Stub {}

const runApp = mock(() => {});
mock.module('@livekit/agents', () => ({
  cli: { runApp },
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
  derivePendingAudioMsLimit,
  runVoiceAgent,
  waitForParticipantOrTimeout,
  pumpTtsStream,
  runSpeechRecognition,
  describeWorkerDiagnostic,
  logWorkerDiagnostic,
  SpeechTurnQueueOverflowError,
  WorkerDiagnosticError,
  cancelInFlightTts,
  createSpeakHandler,
  createTurnAggregator,
  createSubscribedMicrophoneTrackHandler,
  createTurnControlHandler,
} = await import('./agent');
const { SPEAK_UTTERANCE_ID_ATTR, TURN_TOPIC } = await import(
  '@maelstrom-co/realtime-protocol/livekit'
);

describe('privacy-safe worker diagnostics', () => {
  test('keeps only fixed reason and own boolean or finite-number metadata', () => {
    const sensitive = Object.assign(new Error('message-sentinel'), {
      apiKey: 'api-key-sentinel',
      audio: 'raw-audio-sentinel',
      body: 'body-sentinel',
      cause: new Error('cause-sentinel'),
      chunk: 'raw-chunk-sentinel',
      code: 'RATE_LIMITED-42',
      data: { token: 'nested-token-sentinel' },
      participant: 'participant-sentinel',
      requestId: 'request-sentinel',
      room: 'room-sentinel',
      sessionId: 'session-sentinel',
      status: 429,
      token: 'token-sentinel',
      transcript: 'transcript-sentinel',
      type: true,
    });
    sensitive.name = 'name-sentinel';
    sensitive.stack = 'stack-sentinel';

    const diagnostic = describeWorkerDiagnostic(
      'audio-track-processing-failed',
      sensitive,
    );

    expect(diagnostic).toEqual({
      category: 'voice-agent',
      reason: 'audio-track-processing-failed',
      status: 429,
      type: true,
    });
    const output = JSON.stringify(diagnostic);
    for (const sentinel of [
      'api-key-sentinel',
      'raw-audio-sentinel',
      'body-sentinel',
      'cause-sentinel',
      'raw-chunk-sentinel',
      'nested-token-sentinel',
      'message-sentinel',
      'name-sentinel',
      'participant-sentinel',
      'request-sentinel',
      'room-sentinel',
      'session-sentinel',
      'stack-sentinel',
      'token-sentinel',
      'transcript-sentinel',
    ]) {
      expect(output).not.toContain(sentinel);
    }
  });

  test('omits accessors, long or free-text strings, and nested values', () => {
    const value = {
      code: 'contains spaces and free text',
      status: Number.POSITIVE_INFINITY,
      type: { nested: 'nested-payload-sentinel' },
    };
    Object.defineProperty(value, 'code', {
      get: () => {
        throw new Error('getter-sentinel');
      },
    });
    Object.defineProperty(value, 'status', {
      value: 'X'.repeat(200),
      enumerable: true,
    });

    expect(describeWorkerDiagnostic('tts-provider-failed', value)).toEqual({
      category: 'voice-agent',
      reason: 'tts-provider-failed',
    });
  });

  test('independently omits long strings and non-finite numbers', () => {
    expect(
      describeWorkerDiagnostic('tts-provider-failed', {
        status: 'X'.repeat(65),
      }),
    ).toEqual({ category: 'voice-agent', reason: 'tts-provider-failed' });
    expect(
      describeWorkerDiagnostic('tts-provider-failed', {
        status: Number.POSITIVE_INFINITY,
      }),
    ).toEqual({ category: 'voice-agent', reason: 'tts-provider-failed' });
  });

  test('omits inherited code, status, and type scalars', () => {
    const value = Object.create({
      code: 'INHERITED_CODE',
      status: 503,
      type: 'INHERITED_TYPE',
    });

    expect(
      describeWorkerDiagnostic('audio-track-processing-failed', value),
    ).toEqual({
      category: 'voice-agent',
      reason: 'audio-track-processing-failed',
    });
  });

  test('handles non-errors, throwing descriptor traps, and cyclic payloads without throwing', () => {
    const cyclic: Record<string, unknown> = { code: 'CYCLIC' };
    cyclic.self = cyclic;
    const hostile = new Proxy(
      {},
      {
        getOwnPropertyDescriptor: () => {
          throw new Error('descriptor-trap-sentinel');
        },
      },
    );

    expect(describeWorkerDiagnostic('turn-finalization-failed', null)).toEqual({
      category: 'voice-agent',
      reason: 'turn-finalization-failed',
    });
    expect(
      describeWorkerDiagnostic('turn-finalization-failed', Symbol('unsafe')),
    ).toEqual({
      category: 'voice-agent',
      reason: 'turn-finalization-failed',
    });
    expect(
      describeWorkerDiagnostic('turn-finalization-failed', hostile),
    ).toEqual({
      category: 'voice-agent',
      reason: 'turn-finalization-failed',
    });
    expect(
      describeWorkerDiagnostic('turn-finalization-failed', cyclic),
    ).toEqual({
      category: 'voice-agent',
      reason: 'turn-finalization-failed',
    });
  });

  test('omits secret-like, identifier-like, and arbitrary metadata strings', () => {
    expect(
      describeWorkerDiagnostic('tts-provider-failed', {
        code: 'sk_live_credential_123',
        status: 'participant-123',
        type: 'ARBITRARY_PROVIDER_TYPE',
      }),
    ).toEqual({ category: 'voice-agent', reason: 'tts-provider-failed' });
  });

  test('retains safe boolean and finite-number metadata', () => {
    expect(
      describeWorkerDiagnostic('tts-provider-failed', {
        code: true,
        status: 503,
        type: false,
      }),
    ).toEqual({
      category: 'voice-agent',
      reason: 'tts-provider-failed',
      code: true,
      status: 503,
      type: false,
    });
  });

  test('uses only application-owned safe reasons and strips queue overflow metadata', () => {
    const safe = new WorkerDiagnosticError('stt-provider-drain-timeout');
    Object.assign(safe, { code: 'TIMEOUT', status: 408 });
    const forged = new WorkerDiagnosticError('stt-provider-drain-timeout');
    Object.defineProperty(forged, 'reason', { value: 'free-text-sentinel' });
    const overflow = new SpeechTurnQueueOverflowError('segment-frame-limit');
    Object.assign(overflow, { code: 'provider-secret-code' });

    expect(
      describeWorkerDiagnostic('audio-track-processing-failed', safe),
    ).toEqual({
      category: 'voice-agent',
      reason: 'stt-provider-drain-timeout',
      status: 408,
    });
    expect(
      describeWorkerDiagnostic('audio-track-processing-failed', overflow),
    ).toEqual({ category: 'voice-agent', reason: 'segment-frame-limit' });
    expect(
      describeWorkerDiagnostic('audio-track-processing-failed', forged),
    ).toEqual({
      category: 'voice-agent',
      reason: 'audio-track-processing-failed',
    });
  });

  test('projects every application-owned reason tuple member with a stable category', () => {
    const reasons = [
      'participant-join-timeout',
      'malformed-turn-control',
      'turn-finalization-failed',
      'tts-provider-failed',
      'tts-synthesis-failed',
      'tts-cancellation-failed',
      'tts-status-publication-failed',
      'transcript-publication-failed',
      'overlapping-microphone-track',
      'audio-track-processing-failed',
      'stt-provider-drain-timeout',
      'stt-successor-creation-failed',
      'successor-segment-limit',
      'segment-frame-limit',
      'segment-audio-limit',
      'total-frame-limit',
      'invalid-frame-metadata',
    ] as const;

    for (const reason of reasons) {
      expect(
        describeWorkerDiagnostic(
          'audio-track-processing-failed',
          new WorkerDiagnosticError(reason),
        ),
      ).toEqual({ category: 'voice-agent', reason });
    }
  });

  test('projects a provider error with no message without its string code', () => {
    expect(
      describeWorkerDiagnostic('tts-provider-failed', {
        code: 'PROVIDER_UNAVAILABLE',
      }),
    ).toEqual({
      category: 'voice-agent',
      reason: 'tts-provider-failed',
    });
  });

  test('logs only the descriptor and never throws when inspection or logging fails', () => {
    const originalWarn = console.warn;
    const calls: unknown[][] = [];
    try {
      console.warn = (...args: unknown[]) => {
        calls.push(args);
      };
      logWorkerDiagnostic('warn', 'transcript-publication-failed', {
        code: 'PUBLISH_FAILED',
        message: 'token-sentinel',
      });
      expect(calls).toEqual([
        [
          '[voice-agent]',
          {
            category: 'voice-agent',
            reason: 'transcript-publication-failed',
          },
        ],
      ]);
      expect(JSON.stringify(calls)).not.toContain('token-sentinel');

      console.warn = () => {
        throw new Error('logger-sentinel');
      };
      expect(() =>
        logWorkerDiagnostic('warn', 'transcript-publication-failed', {}),
      ).not.toThrow();
    } finally {
      console.warn = originalWarn;
    }
  });
});

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

  test('accepts the maximum 60000ms deadline', () => {
    expect(
      resolveSttDrainTimeoutMs({ MAELSTROM_STT_DRAIN_TIMEOUT_MS: '60000' }),
    ).toBe(60_000);
  });

  test('rejects a deadline above 60000ms with an actionable error', () => {
    expect(() =>
      resolveSttDrainTimeoutMs({ MAELSTROM_STT_DRAIN_TIMEOUT_MS: '60001' }),
    ).toThrow(
      'Invalid MAELSTROM_STT_DRAIN_TIMEOUT_MS: expected a positive number of milliseconds no greater than 60000',
    );
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

describe('derivePendingAudioMsLimit headroom', () => {
  test.each([
    [1, 2],
    [5_000, 7_500],
    [15_000, 22_500],
    [60_000, 90_000],
  ])('derives pending audio from drain timeout %d -> %d', (timeout, limit) => {
    expect(derivePendingAudioMsLimit(timeout)).toBe(limit);
  });

  test('rejects a pending audio limit that is non-finite or unsafe', () => {
    expect(() => derivePendingAudioMsLimit(Number.MAX_VALUE)).toThrow(
      /pending audio/i,
    );
    expect(() => derivePendingAudioMsLimit(Number.MAX_SAFE_INTEGER)).toThrow(
      /pending audio/i,
    );
  });

  test('prevents worker startup when the drain timeout exceeds its cap', () => {
    const names = [
      'LIVEKIT_URL',
      'LIVEKIT_API_KEY',
      'LIVEKIT_API_SECRET',
      'MAELSTROM_STT_DRAIN_TIMEOUT_MS',
    ] as const;
    const previous = Object.fromEntries(
      names.map((name) => [name, process.env[name]]),
    );
    runApp.mockClear();
    try {
      process.env.LIVEKIT_URL = 'wss://livekit.invalid';
      process.env.LIVEKIT_API_KEY = 'test-key';
      process.env.LIVEKIT_API_SECRET = 'test-secret';
      process.env.MAELSTROM_STT_DRAIN_TIMEOUT_MS = '60001';

      expect(() => runVoiceAgent()).toThrow(
        /MAELSTROM_STT_DRAIN_TIMEOUT_MS.*no greater than 60000/,
      );
      expect(runApp).not.toHaveBeenCalled();
    } finally {
      for (const name of names) {
        const value = previous[name];
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
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
  let iteratorError: unknown;
  const state = { iteratorCount: 0, yieldCount: 0 };
  return {
    state,
    push(frame: unknown) {
      frames.push(typeof frame === 'string' ? audioFrame(frame) : frame);
      wake.resolve();
    },
    end() {
      ended = true;
      wake.resolve();
    },
    fail(error: unknown) {
      iteratorError = error;
      wake.resolve();
    },
    stream: {
      async *[Symbol.asyncIterator]() {
        state.iteratorCount++;
        while (!ended || frames.length > 0) {
          if (iteratorError) throw iteratorError;
          if (frames.length === 0) {
            await wake.promise;
            wake = deferred();
            continue;
          }
          state.yieldCount++;
          yield frames.shift();
        }
        if (iteratorError) throw iteratorError;
      },
    },
  };
}

/**
 * Unlike the normal controllable stream, returns an iterator whose `next` and
 * `return` never settle. `returnCount` increments synchronously, allowing tests
 * to distinguish prompt cancellation initiation from awaiting its completion.
 */
function makeNeverSettlingAudioStream() {
  const nextStarted = deferred();
  const pendingNext = new Promise<IteratorResult<unknown>>(() => {});
  const pendingReturn = new Promise<IteratorResult<unknown>>(() => {});
  const state = { returnCount: 0 };
  const iterator = {
    next() {
      nextStarted.resolve();
      return pendingNext;
    },
    return() {
      state.returnCount++;
      return pendingReturn;
    },
  };
  return {
    nextStarted: nextStarted.promise,
    state,
    stream: {
      [Symbol.asyncIterator]: () => iterator,
    },
  };
}

function audioFrame(
  label: string,
  metadata: { sampleRate?: number; samplesPerChannel?: number } = {},
) {
  return {
    sampleRate: metadata.sampleRate ?? 1000,
    samplesPerChannel: metadata.samplesPerChannel ?? 1,
    toString: () => label,
  };
}

type FakeSpeechStream = ReturnType<typeof makeControllableSpeechStream>;

function makeControllableSpeechStream(
  id: number,
  order: string[],
  opts: {
    endInputError?: Error;
    keepIteratorOpenOnClose?: boolean;
    pushFrameError?: Error;
  } = {},
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
        if (opts.pushFrameError) throw opts.pushFrameError;
        state.pushed.push(String(frame));
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

/** Lets timers and rejection notifications complete one explicit event-loop turn. */
async function nextEventLoopTurn(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

/**
 * Polls across bounded event-loop turns instead of starving scheduled work with
 * microtasks. The optional label defaults to `condition` and changes only the
 * timeout diagnostic, never polling cadence or assertion behavior.
 */
async function waitFor(
  check: () => boolean,
  label = 'condition',
): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (check()) return;
    await nextEventLoopTurn();
  }
  throw new Error(`${label} was not reached`);
}

function createRecognitionHarness(
  opts: {
    /** Overrides the normal controllable iterator for cancellation edge cases. */
    audioStream?: AsyncIterable<unknown>;
    drainTimeoutMs?: number;
    streamCreationError?: (attempt: number) => Error | undefined;
    streamOptions?: (id: number) => {
      endInputError?: Error;
      keepIteratorOpenOnClose?: boolean;
      pushFrameError?: Error;
    };
    drainDeadline?: { promise: Promise<void> };
    onHandlerRemoval?: () => void | Promise<void>;
  } = {},
) {
  const order: string[] = [];
  const audio = makeControllableAudioStream();
  const streams: FakeSpeechStream[] = [];
  const finals: string[] = [];
  const receivedFinals: string[] = [];
  const scheduler = createManualScheduler();
  const drainDeadline = opts.drainDeadline;
  const drainTimeoutMs = opts.drainTimeoutMs ?? 5000;
  let customDeadlineUsed = false;
  let streamCreationAttempts = 0;
  const aggregator = createTurnAggregator({
    emit: (text) => finals.push(text),
    fallback: false,
  });
  let endTurn: (() => Promise<void>) | null = null;
  const run = runSpeechRecognition({
    // biome-ignore lint/suspicious/noExplicitAny: structural test double for AudioStream
    audioStream: (opts.audioStream ?? audio.stream) as any,
    createSpeechStream: () => {
      streamCreationAttempts++;
      const creationError = opts.streamCreationError?.(streamCreationAttempts);
      if (creationError) throw creationError;
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
    drainTimeoutMs,
    pendingAudioMsLimit: derivePendingAudioMsLimit(drainTimeoutMs),
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
      if (handler === null) {
        if (endTurn === null) return;
        endTurn = null;
        const result = opts.onHandlerRemoval?.();
        return result;
      }
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
    get streamCreationAttempts() {
      return streamCreationAttempts;
    },
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
    await waitFor(() => harness.streams.length === 1, 'initial speech stream');
    harness.audio.push('turn-1');
    await waitFor(
      () => harness.streams[0].state.pushed.length === 1,
      'first-turn frame delivery',
    );

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
    await waitFor(
      () => harness.streams[1].state.pushed.length === 1,
      'second-turn frame delivery',
    );
    expect(harness.streams[1].state.pushed).toEqual(['turn-2']);
    expect(harness.audio.state.iteratorCount).toBe(1);

    harness.audio.end();
    harness.streams[1].finish();
    await harness.run;
  });

  test('defers the aggregation fallback while the provider stream is still draining', async () => {
    const harness = createRecognitionHarness();
    await waitFor(() => harness.streams.length === 1, 'initial speech stream');
    const boundary = harness.endTurn();
    harness.streams[0].emit(finalEvent('still draining'));
    await waitFor(() => harness.receivedFinals.length === 1, 'draining final');

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

  test('rotates N, N+1, and N+2 as distinct FIFO segments without clipping or crossing frames', async () => {
    const harness = createRecognitionHarness();
    await waitFor(() => harness.streams.length === 1, 'initial speech stream');
    harness.audio.push('n');
    await waitFor(
      () => harness.streams[0].state.pushed.length === 1,
      'initial segment frame',
    );
    const first = harness.endTurn();
    harness.audio.push('n+1-a');
    harness.audio.push('n+1-b');
    await waitFor(() => harness.audio.state.yieldCount === 3, 'N+1 frames');
    await Promise.resolve();
    const second = harness.endTurn();
    harness.audio.push('n+2-a');
    harness.audio.push('n+2-b');
    await waitFor(() => harness.audio.state.yieldCount === 5, 'N+2 frames');
    await Promise.resolve();
    const third = harness.endTurn();

    expect(first).not.toBe(second);
    expect(second).not.toBe(third);
    expect(harness.streams[0].state.endInputCount).toBe(1);
    harness.streams[0].finish();
    await first;
    await waitFor(() => harness.streams.length === 2, 'N+1 speech stream');
    expect(harness.streams[1].state.pushed).toEqual(['n+1-a', 'n+1-b']);
    harness.streams[1].finish();
    await second;
    await waitFor(() => harness.streams.length === 3, 'N+2 speech stream');
    expect(harness.streams[2].state.pushed).toEqual(['n+2-a', 'n+2-b']);
    harness.streams[2].finish();
    await third;
    expect(harness.order).toEqual([
      'create:1',
      'push:1:n',
      'end:1',
      'close:1',
      'create:2',
      'push:2:n+1-a',
      'push:2:n+1-b',
      'end:2',
      'close:2',
      'create:3',
      'push:3:n+2-a',
      'push:3:n+2-b',
      'end:3',
      'close:3',
      'create:4',
    ]);
    harness.audio.end();
    harness.streams[3].finish();
    await harness.run;
  });

  test('buffers frames during provider drain and replays them before the successor boundary', async () => {
    const harness = createRecognitionHarness();
    await waitFor(() => harness.streams.length === 1, 'initial speech stream');
    const boundary = harness.endTurn();
    harness.audio.push('buffered-while-draining');
    await Promise.resolve();
    expect(harness.streams[0].state.pushed).toEqual([]);
    harness.streams[0].finish();
    await boundary;
    expect(harness.streams[1].state.pushed).toEqual([
      'buffered-while-draining',
    ]);
    harness.audio.end();
    harness.streams[1].finish();
    await harness.run;
  });

  test('fails closed when a fifth pending successor segment is retained', async () => {
    const harness = createRecognitionHarness();
    await waitFor(() => harness.streams.length === 1, 'initial speech stream');
    const active = harness.endTurn();
    const queued = Array.from({ length: 4 }, () => harness.endTurn());
    const overflow = harness.endTurn();

    await expect(overflow).rejects.toEqual(
      new SpeechTurnQueueOverflowError('successor-segment-limit'),
    );
    await expect(active).rejects.toEqual(
      new SpeechTurnQueueOverflowError('successor-segment-limit'),
    );
    for (const boundary of queued) {
      await expect(boundary).rejects.toEqual(
        new SpeechTurnQueueOverflowError('successor-segment-limit'),
      );
    }
    expect(harness.streams[0].state.closeCount).toBe(1);
    expect(() => harness.endTurn()).toThrow('turn handler is not installed');
    harness.audio.push('discarded-after-overflow');
    await Promise.resolve();
    expect(harness.streams).toHaveLength(1);
    expect(harness.streams[0].state.pushed).toEqual([]);
    harness.audio.end();
    await harness.run;
  });

  test.each([
    [
      'synchronously throws',
      () => {
        throw new Error('handler removal failed');
      },
    ],
    [
      'returns a rejected promise',
      async () => {
        throw new Error('async handler removal failed');
      },
    ],
    ['never settles', () => new Promise<void>(() => {})],
  ])('completes fail-closed cleanup when the queue-failure callback %s', async (_name, callback) => {
    const rejections = await captureUnhandledRejections(async () => {
      let callbackCount = 0;
      const harness = createRecognitionHarness({
        onHandlerRemoval: () => {
          callbackCount++;
          return callback();
        },
      });
      await waitFor(
        () => harness.streams.length === 1,
        'initial speech stream',
      );
      const active = harness.endTurn();
      harness.audio.push('retained-before-overflow');
      await waitFor(
        () => harness.audio.state.yieldCount === 1,
        'retained frame',
      );
      await nextEventLoopTurn();
      const queued = Array.from({ length: 4 }, () => harness.endTurn());
      const overflow = harness.endTurn();
      const expected = new SpeechTurnQueueOverflowError(
        'successor-segment-limit',
      );

      await expect(overflow).rejects.toEqual(expected);
      await expect(active).rejects.toEqual(expected);
      for (const boundary of queued) {
        await expect(boundary).rejects.toEqual(expected);
      }
      expect(callbackCount).toBe(1);
      expect(harness.streams[0].state.closeCount).toBe(1);
      expect(harness.streams[0].state.pushed).toEqual([]);
      expect(harness.streams).toHaveLength(1);

      harness.audio.push('discarded-after-overflow');
      await nextEventLoopTurn();
      expect(harness.streams[0].state.pushed).toEqual([]);
      harness.audio.end();
      await harness.run;
    });
    expect(rejections).toEqual([]);
  });

  test('fails closed at pending frame 501 in one segment', async () => {
    const harness = createRecognitionHarness();
    await waitFor(() => harness.streams.length === 1, 'initial speech stream');
    const active = harness.endTurn();
    for (let frame = 0; frame < 501; frame++)
      harness.audio.push(`queued-${frame}`);
    await expect(active).rejects.toEqual(
      new SpeechTurnQueueOverflowError('segment-frame-limit'),
    );
    expect(harness.streams[0].state.closeCount).toBe(1);
    harness.audio.end();
    await harness.run;
  });

  test('accepts pending audio exactly at the default drain-timeout headroom cap', async () => {
    const harness = createRecognitionHarness();
    await waitFor(() => harness.streams.length === 1, 'initial speech stream');
    const active = harness.endTurn();
    harness.audio.push(
      audioFrame('exactly-at-cap', { samplesPerChannel: 7_500 }),
    );
    await waitFor(() => harness.audio.state.yieldCount === 1, 'at-cap frame');
    await nextEventLoopTurn();

    expect(harness.streams[0].state.closeCount).toBe(0);
    harness.streams[0].finish();
    await active;
    expect(harness.streams[1].state.pushed).toEqual(['exactly-at-cap']);
    harness.audio.end();
    harness.streams[1].finish();
    await harness.run;
  });

  test('rejects the first pending audio frame over configured drain-timeout headroom', async () => {
    const harness = createRecognitionHarness({ drainTimeoutMs: 15_000 });
    await waitFor(() => harness.streams.length === 1, 'initial speech stream');
    const active = harness.endTurn();
    harness.audio.push(
      audioFrame('exactly-at-configured-cap', { samplesPerChannel: 22_500 }),
    );
    await waitFor(
      () => harness.audio.state.yieldCount === 1,
      'configured at-cap frame',
    );
    await nextEventLoopTurn();
    expect(harness.streams[0].state.closeCount).toBe(0);

    harness.audio.push(audioFrame('first-over-cap'));
    await expect(active).rejects.toEqual(
      new SpeechTurnQueueOverflowError('segment-audio-limit'),
    );
    harness.audio.end();
    await harness.run;
  });

  test('fails closed at pending frame 2001 across four segments', async () => {
    const harness = createRecognitionHarness();
    await waitFor(() => harness.streams.length === 1, 'initial speech stream');
    const active = harness.endTurn();
    const queued: Promise<void>[] = [];
    for (let segment = 0; segment < 4; segment++) {
      for (let frame = 0; frame < 500; frame++) {
        harness.audio.push(`segment-${segment}-frame-${frame}`);
      }
      await waitFor(
        () => harness.audio.state.yieldCount === (segment + 1) * 500,
        `segment ${segment} frames`,
      );
      await Promise.resolve();
      if (segment < 3) queued.push(harness.endTurn());
    }
    harness.audio.push('total-limit-plus-one');
    await expect(active).rejects.toEqual(
      new SpeechTurnQueueOverflowError('total-frame-limit'),
    );
    for (const boundary of queued) {
      await expect(boundary).rejects.toEqual(
        new SpeechTurnQueueOverflowError('total-frame-limit'),
      );
    }
    harness.audio.end();
    await harness.run;
  });

  test.each([
    ['non-finite sample rate', audioFrame('bad', { sampleRate: Number.NaN })],
    ['non-positive sample rate', audioFrame('bad', { sampleRate: 0 })],
    [
      'non-finite samples per channel',
      audioFrame('bad', { samplesPerChannel: Number.POSITIVE_INFINITY }),
    ],
    [
      'non-positive samples per channel',
      audioFrame('bad', { samplesPerChannel: 0 }),
    ],
  ])('fails closed for %s without retaining the frame', async (_name, frame) => {
    const harness = createRecognitionHarness();
    await waitFor(() => harness.streams.length === 1, 'initial speech stream');
    const active = harness.endTurn();
    harness.audio.push(frame);
    await expect(active).rejects.toEqual(
      new SpeechTurnQueueOverflowError('invalid-frame-metadata'),
    );
    expect(harness.streams[0].state.closeCount).toBe(1);
    expect(harness.streams[0].state.pushed).toEqual([]);
    harness.audio.end();
    await harness.run;
  });

  test('does not create a successor when track teardown starts during drain', async () => {
    const harness = createRecognitionHarness();
    await waitFor(() => harness.streams.length === 1, 'initial speech stream');
    const boundary = harness.endTurn();
    harness.audio.push('released-on-teardown');
    await waitFor(() => harness.audio.state.yieldCount === 1, 'teardown frame');
    await Promise.resolve();
    const queuedBoundary = harness.endTurn();
    harness.audio.end();
    harness.streams[0].finish();
    await Promise.all([boundary, harness.run]);
    await expect(queuedBoundary).rejects.toThrow(
      'Speech turn coordinator disposed',
    );
    expect(harness.streams).toHaveLength(1);
    expect(harness.streams[0].state.closeCount).toBe(1);
  });

  test.each([
    [
      'synchronously throws',
      () => {
        throw new Error('handler removal failed');
      },
    ],
    [
      'returns a rejected promise',
      async () => {
        throw new Error('async handler removal failed');
      },
    ],
    ['never settles', () => new Promise<void>(() => {})],
  ])('completes normal EOF cleanup when handler removal %s', async (_name, remove) => {
    const rejections = await captureUnhandledRejections(async () => {
      let removalCount = 0;
      const harness = createRecognitionHarness({
        onHandlerRemoval: () => {
          removalCount++;
          return remove();
        },
      });
      await waitFor(
        () => harness.streams.length === 1,
        'initial speech stream',
      );

      harness.audio.end();
      harness.streams[0].finish();
      await harness.run;

      expect(removalCount).toBe(1);
      expect(harness.streams[0].state.closeCount).toBe(1);
    });
    expect(rejections).toEqual([]);
  });

  test('preserves an audio iterator failure when handler removal also fails', async () => {
    const rejections = await captureUnhandledRejections(async () => {
      let removalCount = 0;
      const harness = createRecognitionHarness({
        onHandlerRemoval: () => {
          removalCount++;
          throw new Error('handler removal failed');
        },
      });
      await waitFor(
        () => harness.streams.length === 1,
        'initial speech stream',
      );

      harness.audio.fail(new Error('audio iterator failed'));
      harness.streams[0].finish();

      await expect(harness.run).rejects.toThrow('audio iterator failed');
      expect(removalCount).toBe(1);
      expect(harness.streams[0].state.closeCount).toBe(1);
    });
    expect(rejections).toEqual([]);
  });

  test('observes iterator failure, closes the stream, and installs a clean successor without another frame', async () => {
    const rejections = await captureUnhandledRejections(async () => {
      const harness = createRecognitionHarness();
      await waitFor(
        () => harness.streams.length === 1,
        'initial speech stream',
      );
      const boundary = harness.endTurn();
      harness.streams[0].emit(finalEvent('salvaged before failure'));
      await waitFor(
        () => harness.receivedFinals.length === 1,
        'salvaged final',
      );
      harness.streams[0].fail(new Error('iterator failed'));
      await expect(boundary).rejects.toThrow('iterator failed');
      expect(harness.finals).toEqual(['salvaged before failure']);
      expect(harness.streams).toHaveLength(2);
      expect(harness.streams[0].state.closeCount).toBe(1);
      harness.audio.end();
      harness.streams[1].finish();
      await harness.run;
    });
    expect(rejections).toEqual([]);
  });

  test('observes endInput failure, closes, and recovers without another audio frame', async () => {
    const harness = createRecognitionHarness({
      streamOptions: (id) =>
        id === 1 ? { endInputError: new Error('end input failed') } : {},
    });
    await waitFor(() => harness.streams.length === 1, 'initial speech stream');
    await expect(harness.endTurn()).rejects.toThrow('end input failed');
    expect(harness.streams).toHaveLength(2);
    expect(harness.streams[0].state.closeCount).toBe(1);
    harness.audio.end();
    harness.streams[1].finish();
    await harness.run;
  });

  test('retries one failed successor stream creation immediately and keeps recognition usable', async () => {
    const creationFailure = new Error('provider construction secret');
    const harness = createRecognitionHarness({
      streamCreationError: (attempt) =>
        attempt === 2 ? creationFailure : undefined,
    });
    await waitFor(() => harness.streams.length === 1, 'initial speech stream');

    const boundary = harness.endTurn();
    harness.streams[0].finish();
    await boundary;

    expect(harness.streamCreationAttempts).toBe(3);
    expect(harness.streams).toHaveLength(2);
    expect(harness.streams[0].state.closeCount).toBe(1);
    harness.audio.push('after-stream-creation-recovery');
    await waitFor(
      () => harness.streams[1].state.pushed.length === 1,
      'post-construction-recovery frame',
    );
    expect(harness.streams[1].state.pushed).toEqual([
      'after-stream-creation-recovery',
    ]);

    harness.audio.end();
    harness.streams[1].finish();
    await harness.run;
  });

  test('rejects pending recognition and queued boundaries after repeated successor stream creation failure', async () => {
    const rejections = await captureUnhandledRejections(async () => {
      const harness = createRecognitionHarness({
        streamCreationError: (attempt) =>
          attempt === 2 || attempt === 3
            ? new Error('provider construction secret')
            : undefined,
      });
      await waitFor(
        () => harness.streams.length === 1,
        'initial speech stream',
      );
      const activeBoundary = harness.endTurn();
      harness.audio.push('queued-frame-secret');
      await waitFor(() => harness.audio.state.yieldCount === 1, 'queued frame');
      const queuedBoundary = harness.endTurn();

      harness.streams[0].finish();

      await expect(activeBoundary).rejects.toThrow(
        'stt-successor-creation-failed',
      );
      await expect(queuedBoundary).rejects.toThrow(
        'stt-successor-creation-failed',
      );
      await expect(harness.run).rejects.toThrow(
        'stt-successor-creation-failed',
      );
      expect(harness.streamCreationAttempts).toBe(3);
      expect(harness.streams).toHaveLength(1);
      expect(harness.streams[0].state.closeCount).toBe(1);
      expect(() => harness.endTurn()).toThrow('turn handler is not installed');

      harness.audio.end();
      await nextEventLoopTurn();
    });
    expect(rejections).toEqual([]);
  });

  test('recovers one live pushFrame failure and replays the current frame exactly once', async () => {
    const rejections = await captureUnhandledRejections(async () => {
      const harness = createRecognitionHarness({
        streamOptions: (id) =>
          id === 1
            ? {
                keepIteratorOpenOnClose: true,
                pushFrameError: new Error('live provider push secret'),
              }
            : {},
      });
      await waitFor(
        () => harness.streams.length === 1,
        'initial speech stream',
      );

      harness.audio.push('live-push-frame');
      await waitFor(
        () => harness.streams.length === 2,
        'live replacement stream',
      );

      expect(harness.streamCreationAttempts).toBe(2);
      expect(harness.streams[0].state.closeCount).toBe(1);
      expect(harness.streams[0].state.pushed).toEqual([]);
      expect(harness.streams[1].state.pushed).toEqual(['live-push-frame']);

      harness.streams[0].emit(finalEvent('stale live final'));
      harness.streams[0].finish();
      await nextEventLoopTurn();
      expect(harness.finals).toEqual([]);

      harness.audio.end();
      harness.streams[1].finish();
      await harness.run;
    });
    expect(rejections).toEqual([]);
  });

  test('enters terminal failure when live push recovery cannot construct a replacement', async () => {
    const rejections = await captureUnhandledRejections(async () => {
      const harness = createRecognitionHarness({
        streamCreationError: (attempt) =>
          attempt === 2
            ? new Error('replacement construction secret')
            : undefined,
        streamOptions: (id) =>
          id === 1
            ? { pushFrameError: new Error('live provider push secret') }
            : {},
      });
      await waitFor(
        () => harness.streams.length === 1,
        'initial speech stream',
      );

      harness.audio.push('terminal-construction-frame');

      await expect(harness.run).rejects.toThrow(
        'stt-successor-creation-failed',
      );
      expect(harness.streamCreationAttempts).toBe(2);
      expect(harness.streams).toHaveLength(1);
      expect(harness.streams[0].state.closeCount).toBe(1);
      expect(() => harness.endTurn()).toThrow('turn handler is not installed');

      harness.audio.fail(new Error('late pending iterator secret'));
      await nextEventLoopTurn();
    });
    expect(rejections).toEqual([]);
  });

  test('enters terminal failure when replacement live pushFrame replay fails', async () => {
    const rejections = await captureUnhandledRejections(async () => {
      const harness = createRecognitionHarness({
        streamOptions: (id) => ({
          pushFrameError: new Error(`live push failure ${id}`),
        }),
      });
      await waitFor(
        () => harness.streams.length === 1,
        'initial speech stream',
      );

      harness.audio.push('terminal-replay-frame');

      await expect(harness.run).rejects.toThrow(
        'stt-successor-creation-failed',
      );
      expect(harness.streamCreationAttempts).toBe(2);
      expect(harness.streams).toHaveLength(2);
      expect(harness.streams[0].state.closeCount).toBe(1);
      expect(harness.streams[1].state.closeCount).toBe(1);
      expect(harness.streams[0].state.pushed).toEqual([]);
      expect(harness.streams[1].state.pushed).toEqual([]);

      harness.audio.end();
      await nextEventLoopTurn();
    });
    expect(rejections).toEqual([]);
  });

  test('terminal failure cancels a never-settling audio next and releases track processing ownership', async () => {
    const rejections = await captureUnhandledRejections(async () => {
      const audio = makeNeverSettlingAudioStream();
      const harness = createRecognitionHarness({
        audioStream: audio.stream,
        streamCreationError: (attempt) =>
          attempt === 2 || attempt === 3
            ? new Error('provider construction secret')
            : undefined,
      });
      const processed: unknown[] = [];
      const failures: unknown[] = [];
      const handler = createSubscribedMicrophoneTrackHandler({
        expectedIdentity: 'user',
        processTrack: async (track) => {
          processed.push(track);
          if (processed.length === 1) await harness.run;
        },
        onProcessingError: (error) => {
          failures.push(error);
        },
        onIgnoredTrack: () => {},
      });
      const failedTrack = { kind: 'audio' };
      const laterTrack = { kind: 'audio' };

      handler(failedTrack as never, { identity: 'user' });
      await audio.nextStarted;
      const boundary = harness.endTurn();
      harness.streams[0].finish();

      await expect(boundary).rejects.toThrow('stt-successor-creation-failed');
      await expect(harness.run).rejects.toThrow(
        'stt-successor-creation-failed',
      );
      expect(audio.state.returnCount).toBe(1);
      expect(() => harness.endTurn()).toThrow('turn handler is not installed');

      await waitFor(() => failures.length === 1, 'terminal track failure');
      await nextEventLoopTurn();
      handler(laterTrack as never, { identity: 'user' });
      await waitFor(() => processed.length === 2, 'later track processing');
      expect(processed).toEqual([failedTrack, laterTrack]);
    });
    expect(rejections).toEqual([]);
  });

  test('rejects the shifted segment boundary when successor frame replay fails', async () => {
    const unhandled = await captureUnhandledRejections(async () => {
      const replayError = new Error('successor replay failed');
      const harness = createRecognitionHarness({
        streamOptions: (id) =>
          id === 2 ? { pushFrameError: replayError } : {},
      });
      await waitFor(
        () => harness.streams.length === 1,
        'initial speech stream',
      );
      const activeBoundary = harness.endTurn();
      harness.audio.push('successor-frame');
      await waitFor(
        () => harness.audio.state.yieldCount === 1,
        'successor frame',
      );
      await Promise.resolve();
      const successorBoundary = harness.endTurn();
      let successorRejection: unknown;
      void successorBoundary.catch((error) => {
        successorRejection = error;
      });

      harness.streams[0].finish();
      await expect(activeBoundary).rejects.toBe(replayError);
      await waitFor(
        () => successorRejection !== undefined,
        'successor boundary rejection',
      );
      expect(successorRejection).toBe(replayError);
      expect(harness.streams[1].state.closeCount).toBe(1);
      expect(harness.streams).toHaveLength(3);

      harness.audio.end();
      harness.streams[2].finish();
      await harness.run;
      expect(() => harness.endTurn()).toThrow('turn handler is not installed');
      await Promise.resolve();
    });
    expect(unhandled).toEqual([]);
  });

  test('times out a stalled provider drain, closes it, and installs a clean successor', async () => {
    const deadline = deferred();
    const harness = createRecognitionHarness({ drainDeadline: deadline });
    await waitFor(() => harness.streams.length === 1, 'initial speech stream');
    const boundary = harness.endTurn();
    harness.audio.push('dropped-during-timeout');
    await Promise.resolve();
    deadline.resolve();
    await expect(boundary).rejects.toThrow('stt-provider-drain-timeout');
    expect(harness.streams[0].state.closeCount).toBe(1);
    expect(harness.streams).toHaveLength(2);
    expect(harness.streams[1].state.pushed).toEqual([]);
    harness.audio.push('after-timeout');
    await waitFor(
      () => harness.streams[1].state.pushed.length === 1,
      'post-timeout frame',
    );
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
    await waitFor(() => harness.streams.length === 1, 'initial speech stream');
    const firstBoundary = harness.endTurn();
    harness.streams[0].emit(finalEvent('salvaged'));
    await Promise.resolve();
    deadline.resolve();
    await expect(firstBoundary).rejects.toThrow('stt-provider-drain-timeout');
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
    await waitFor(() => harness.streams.length === 1, 'initial speech stream');
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
    await waitFor(() => harness.streams.length === 1, 'initial speech stream');
    const emptyBoundary = harness.endTurn();
    harness.streams[0].finish();
    await emptyBoundary;
    harness.audio.push('real-turn');
    await waitFor(
      () => harness.streams[1].state.pushed.length === 1,
      'next real-turn frame',
    );
    expect(harness.streams[1].state.pushed).toEqual(['real-turn']);
    harness.audio.end();
    harness.streams[1].finish();
    await harness.run;
  });

  test('routes an authorized TURN_TOPIC tts_cancel while STT drains', async () => {
    const harness = createRecognitionHarness();
    await waitFor(() => harness.streams.length === 1, 'initial speech stream');
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
      onCancelTtsError: () => {},
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
      onCancelTtsError: () => {},
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
      onCancelTtsError: () => {},
      onMalformed: malformed,
      onTurnEndError: () => {},
    });

    handler(
      new TextEncoder().encode('{raw transcript'),
      { identity: 'user' },
      undefined,
      TURN_TOPIC,
    );
    handler(
      new TextEncoder().encode('{}'),
      { identity: 'user' },
      undefined,
      TURN_TOPIC,
    );
    handler(
      new TextEncoder().encode(
        JSON.stringify({ type: 'unknown-control-secret-sentinel' }),
      ),
      { identity: 'user' },
      undefined,
      TURN_TOPIC,
    );

    expect(malformed).toHaveBeenCalledTimes(3);
    expect(malformed.mock.calls).toEqual([[], [], []]);
  });

  test('contains synchronous and asynchronous malformed diagnostic failures once per packet', async () => {
    const rejections = await captureUnhandledRejections(async () => {
      const calls: string[] = [];
      const syncHandler = createTurnControlHandler({
        boundIdentity: 'user',
        endTurn: async () => {},
        cancelTts: () => {},
        onCancelTtsError: () => {},
        onMalformed: () => {
          calls.push('sync');
          throw new Error('sync malformed diagnostic failed');
        },
        onTurnEndError: () => {},
      });
      const asyncHandler = createTurnControlHandler({
        boundIdentity: 'user',
        endTurn: async () => {},
        cancelTts: () => {},
        onCancelTtsError: () => {},
        onMalformed: async () => {
          calls.push('async');
          throw new Error('async malformed diagnostic failed');
        },
        onTurnEndError: () => {},
      });

      expect(() =>
        syncHandler(
          new TextEncoder().encode('{malformed'),
          { identity: 'user' },
          undefined,
          TURN_TOPIC,
        ),
      ).not.toThrow();
      asyncHandler(
        new TextEncoder().encode('{}'),
        { identity: 'user' },
        undefined,
        TURN_TOPIC,
      );
      await waitFor(() => calls.length === 2, 'malformed diagnostic callbacks');
      expect(calls).toEqual(['sync', 'async']);
    });
    expect(rejections).toEqual([]);
  });

  test('contains cancel failures once and still accepts a valid turn end', async () => {
    const rejections = await captureUnhandledRejections(async () => {
      const cancelFailure = new Error('cancel failure sentinel');
      const cancelErrors: unknown[] = [];
      let endCount = 0;
      const handler = createTurnControlHandler({
        boundIdentity: 'user',
        endTurn: async () => {
          endCount++;
        },
        cancelTts: () => {
          throw cancelFailure;
        },
        onMalformed: () => {},
        onTurnEndError: () => {},
        onCancelTtsError: (error) => {
          cancelErrors.push(error);
        },
      });

      expect(() =>
        handler(
          new TextEncoder().encode(JSON.stringify({ type: 'tts_cancel' })),
          { identity: 'user' },
          undefined,
          TURN_TOPIC,
        ),
      ).not.toThrow();
      handler(
        new TextEncoder().encode(JSON.stringify({ type: 'turn_end' })),
        { identity: 'user' },
        undefined,
        TURN_TOPIC,
      );
      await waitFor(
        () => endCount === 1 && cancelErrors.length === 1,
        'cancel failure and turn end',
      );
      expect(cancelErrors).toEqual([cancelFailure]);
      expect(endCount).toBe(1);
    });
    expect(rejections).toEqual([]);
  });

  test('observes asynchronous cancel and diagnostic rejection without blocking turn end', async () => {
    const rejections = await captureUnhandledRejections(async () => {
      const cancelFailure = new Error('async cancel failure sentinel');
      const cancelErrors: unknown[] = [];
      let endCount = 0;
      const handler = createTurnControlHandler({
        boundIdentity: 'user',
        endTurn: async () => {
          endCount++;
        },
        cancelTts: async () => {
          throw cancelFailure;
        },
        onMalformed: () => {},
        onTurnEndError: () => {},
        onCancelTtsError: async (error) => {
          cancelErrors.push(error);
          throw new Error('cancel diagnostic failure');
        },
      });

      handler(
        new TextEncoder().encode(JSON.stringify({ type: 'tts_cancel' })),
        { identity: 'user' },
        undefined,
        TURN_TOPIC,
      );
      handler(
        new TextEncoder().encode(JSON.stringify({ type: 'turn_end' })),
        { identity: 'user' },
        undefined,
        TURN_TOPIC,
      );
      await waitFor(
        () => endCount === 1 && cancelErrors.length === 1,
        'async cancel failure and turn end',
      );
      expect(cancelErrors).toEqual([cancelFailure]);
      expect(endCount).toBe(1);
    });
    expect(rejections).toEqual([]);
  });

  test('does not await a never-settling cancel callback before turn end', async () => {
    const neverSettles = new Promise<void>(() => {});
    let cancelCount = 0;
    let endCount = 0;
    const handler = createTurnControlHandler({
      boundIdentity: 'user',
      endTurn: async () => {
        endCount++;
      },
      cancelTts: () => {
        cancelCount++;
        return neverSettles;
      },
      onMalformed: () => {},
      onTurnEndError: () => {},
      onCancelTtsError: () => {},
    });

    handler(
      new TextEncoder().encode(JSON.stringify({ type: 'tts_cancel' })),
      { identity: 'user' },
      undefined,
      TURN_TOPIC,
    );
    handler(
      new TextEncoder().encode(JSON.stringify({ type: 'turn_end' })),
      { identity: 'user' },
      undefined,
      TURN_TOPIC,
    );
    await waitFor(() => endCount === 1, 'turn end after pending cancellation');
    expect(cancelCount).toBe(1);
    expect(endCount).toBe(1);
  });

  test('reports a turn-end failure once without leaking its message or rejection', async () => {
    const rejections = await captureUnhandledRejections(async () => {
      const failure = Object.assign(new Error('turn-secret-sentinel'), {
        code: 'TURN_FAILED',
      });
      const diagnostics: unknown[] = [];
      const handler = createTurnControlHandler({
        boundIdentity: 'user',
        endTurn: async () => {
          throw failure;
        },
        cancelTts: () => {},
        onCancelTtsError: () => {},
        onMalformed: () => {},
        onTurnEndError: (error) => {
          diagnostics.push(
            describeWorkerDiagnostic('turn-finalization-failed', error),
          );
        },
      });

      handler(
        new TextEncoder().encode(JSON.stringify({ type: 'turn_end' })),
        { identity: 'user' },
        undefined,
        TURN_TOPIC,
      );
      await waitFor(() => diagnostics.length === 1, 'turn-end diagnostic');
      expect(diagnostics).toEqual([
        {
          category: 'voice-agent',
          reason: 'turn-finalization-failed',
        },
      ]);
      expect(JSON.stringify(diagnostics)).not.toContain('turn-secret-sentinel');
    });
    expect(rejections).toEqual([]);
  });

  test('normalizes a synchronous turn-end throw once and contains callback failure', async () => {
    const rejections = await captureUnhandledRejections(async () => {
      const failure = new Error('synchronous turn failure');
      const reported: unknown[] = [];
      const handler = createTurnControlHandler({
        boundIdentity: 'user',
        endTurn: () => {
          throw failure;
        },
        cancelTts: () => {},
        onCancelTtsError: () => {},
        onMalformed: () => {},
        onTurnEndError: (error) => {
          reported.push(error);
          throw new Error('diagnostic callback failure');
        },
      });

      expect(() =>
        handler(
          new TextEncoder().encode(JSON.stringify({ type: 'turn_end' })),
          { identity: 'user' },
          undefined,
          TURN_TOPIC,
        ),
      ).not.toThrow();
      await Promise.resolve();
      expect(reported).toEqual([failure]);
    });
    expect(rejections).toEqual([]);
  });

  test('contains an asynchronously rejecting turn-end error callback', async () => {
    const rejections = await captureUnhandledRejections(async () => {
      const failure = new Error('asynchronous turn failure');
      const reported: unknown[] = [];
      const handler = createTurnControlHandler({
        boundIdentity: 'user',
        endTurn: async () => {
          throw failure;
        },
        cancelTts: () => {},
        onCancelTtsError: () => {},
        onMalformed: () => {},
        onTurnEndError: async (error) => {
          reported.push(error);
          throw new Error('asynchronous diagnostic callback failure');
        },
      });

      handler(
        new TextEncoder().encode(JSON.stringify({ type: 'turn_end' })),
        { identity: 'user' },
        undefined,
        TURN_TOPIC,
      );
      await waitFor(() => reported.length === 1, 'async turn-end report');
      await Promise.resolve();
      expect(reported).toEqual([failure]);
    });
    expect(rejections).toEqual([]);
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
    await waitFor(() => processed.length === 1, 'first track processing');
    // The processing promise releases ownership in its next-turn `finally`.
    await nextEventLoopTurn();
    handler(successor as never, { identity: 'user' });
    await waitFor(() => processed.length === 2, 'successor track processing');
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

  test('reports processing failure once, observes rejection, and accepts a later track', async () => {
    const rejections = await captureUnhandledRejections(async () => {
      const failure = Object.assign(new Error('processing-secret-sentinel'), {
        status: 503,
      });
      const processed: unknown[] = [];
      const diagnostics: unknown[] = [];
      const handler = createSubscribedMicrophoneTrackHandler({
        expectedIdentity: 'user',
        processTrack: async (track) => {
          processed.push(track);
          if (processed.length === 1) throw failure;
        },
        onProcessingError: (error) => {
          diagnostics.push(
            describeWorkerDiagnostic('audio-track-processing-failed', error),
          );
        },
        onIgnoredTrack: () => {},
      });
      const failed = { kind: 'audio' };
      const recovered = { kind: 'audio' };

      handler(failed as never, { identity: 'user' });
      await waitFor(() => diagnostics.length === 1, 'processing diagnostic');
      await nextEventLoopTurn();
      handler(recovered as never, { identity: 'user' });
      await waitFor(() => processed.length === 2, 'recovered track processing');

      expect(diagnostics).toEqual([
        {
          category: 'voice-agent',
          reason: 'audio-track-processing-failed',
          status: 503,
        },
      ]);
      expect(JSON.stringify(diagnostics)).not.toContain(
        'processing-secret-sentinel',
      );
      expect(processed).toEqual([failed, recovered]);
    });
    expect(rejections).toEqual([]);
  });

  test('releases track processing ownership after terminal failure so a later track restarts', async () => {
    const rejections = await captureUnhandledRejections(async () => {
      const processed: unknown[] = [];
      const failures: unknown[] = [];
      const handler = createSubscribedMicrophoneTrackHandler({
        expectedIdentity: 'user',
        processTrack: async (track) => {
          processed.push(track);
          if (processed.length === 1) {
            throw new WorkerDiagnosticError('stt-successor-creation-failed');
          }
        },
        onProcessingError: (error) => {
          failures.push(error);
        },
        onIgnoredTrack: () => {},
      });
      const failed = { kind: 'audio' };
      const restarted = { kind: 'audio' };

      handler(failed as never, { identity: 'user' });
      await waitFor(() => failures.length === 1, 'terminal processing failure');
      await nextEventLoopTurn();
      handler(restarted as never, { identity: 'user' });
      await waitFor(() => processed.length === 2, 'restarted track processing');

      expect(failures).toEqual([
        new WorkerDiagnosticError('stt-successor-creation-failed'),
      ]);
      expect(processed).toEqual([failed, restarted]);
    });
    expect(rejections).toEqual([]);
  });

  test('contains a synchronously throwing processing-error callback', async () => {
    const rejections = await captureUnhandledRejections(async () => {
      const failure = new Error('processing failed');
      const processed: unknown[] = [];
      const reported: unknown[] = [];
      const handler = createSubscribedMicrophoneTrackHandler({
        expectedIdentity: 'user',
        processTrack: async (track) => {
          processed.push(track);
          if (processed.length === 1) throw failure;
        },
        onProcessingError: (error) => {
          reported.push(error);
          throw new Error('synchronous processing callback failure');
        },
        onIgnoredTrack: () => {},
      });
      const failed = { kind: 'audio' };
      const recovered = { kind: 'audio' };

      handler(failed as never, { identity: 'user' });
      await waitFor(() => reported.length === 1, 'sync processing report');
      await nextEventLoopTurn();
      handler(recovered as never, { identity: 'user' });
      await waitFor(() => processed.length === 2, 'post-sync-failure track');

      expect(reported).toEqual([failure]);
      expect(processed).toEqual([failed, recovered]);
    });
    expect(rejections).toEqual([]);
  });

  test('contains an asynchronously rejecting processing-error callback', async () => {
    const rejections = await captureUnhandledRejections(async () => {
      const failure = new Error('processing failed');
      const processed: unknown[] = [];
      const reported: unknown[] = [];
      const handler = createSubscribedMicrophoneTrackHandler({
        expectedIdentity: 'user',
        processTrack: async (track) => {
          processed.push(track);
          if (processed.length === 1) throw failure;
        },
        onProcessingError: async (error) => {
          reported.push(error);
          throw new Error('asynchronous processing callback failure');
        },
        onIgnoredTrack: () => {},
      });
      const failed = { kind: 'audio' };
      const recovered = { kind: 'audio' };

      handler(failed as never, { identity: 'user' });
      await waitFor(() => reported.length === 1, 'async processing report');
      await nextEventLoopTurn();
      handler(recovered as never, { identity: 'user' });
      await waitFor(() => processed.length === 2, 'post-async-failure track');

      expect(reported).toEqual([failure]);
      expect(processed).toEqual([failed, recovered]);
    });
    expect(rejections).toEqual([]);
  });

  test('does not let a never-settling processing-error callback retain microphone ownership', async () => {
    const neverSettles = new Promise<void>(() => {});
    const failure = new Error('processing failed');
    const processed: unknown[] = [];
    const reported: unknown[] = [];
    const handler = createSubscribedMicrophoneTrackHandler({
      expectedIdentity: 'user',
      processTrack: async (track) => {
        processed.push(track);
        if (processed.length === 1) throw failure;
      },
      onProcessingError: (error) => {
        reported.push(error);
        return neverSettles;
      },
      onIgnoredTrack: () => {},
    });
    const failed = { kind: 'audio' };
    const recovered = { kind: 'audio' };

    handler(failed as never, { identity: 'user' });
    await waitFor(() => reported.length === 1, 'pending processing report');
    await nextEventLoopTurn();
    handler(recovered as never, { identity: 'user' });
    await waitFor(() => processed.length === 2, 'post-pending-callback track');

    expect(reported).toEqual([failure]);
    expect(processed).toEqual([failed, recovered]);
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

/** Keeps the listener installed through one full turn after the scenario completes. */
async function captureUnhandledRejections(
  run: () => void | Promise<void>,
): Promise<unknown[]> {
  const rejections: unknown[] = [];
  const onUnhandled = (error: unknown) => rejections.push(error);
  process.on('unhandledRejection', onUnhandled);
  try {
    await run();
    await nextEventLoopTurn();
    return rejections;
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }
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

  test('captures the stream utterance id before readAll can mutate reader metadata', async () => {
    const ids: Array<number | undefined> = [];
    const attributes = { [SPEAK_UTTERANCE_ID_ATTR]: '9' };
    const handler = createSpeakHandler({
      speak: async (_text, utteranceId) => {
        ids.push(utteranceId);
      },
      onSpeakError: () => {},
    });
    handler({
      info: { attributes },
      readAll: () => {
        attributes[SPEAK_UTTERANCE_ID_ATTR] = '10';
        return Promise.resolve('hello');
      },
    });

    await waitFor(() => ids.length === 1, 'captured utterance id');
    expect(ids).toEqual([9]);
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
    const rejections = await captureUnhandledRejections(async () => {
      const spoken: string[] = [];
      const errors: Array<{
        error: unknown;
        utteranceId: number | undefined;
      }> = [];
      const handler = createSpeakHandler({
        speak: async (text) => {
          spoken.push(text);
        },
        onSpeakError: (error, utteranceId) => {
          errors.push({ error, utteranceId });
        },
      });
      handler(
        makeFakeTextStreamReader(new Error('stream closed abnormally'), {
          attributes: { [SPEAK_UTTERANCE_ID_ATTR]: '8' },
        }),
      );
      // biome-ignore lint/suspicious/noExplicitAny: structural test double for TextStreamReader
      handler(makeFakeTextStreamReader('after-failure') as any);
      await waitFor(
        () => spoken.length === 1 && errors.length === 1,
        'reader failure recovery',
      );
      expect(spoken).toEqual(['after-failure']);
      expect(errors).toEqual([
        {
          error: new Error('stream closed abnormally'),
          utteranceId: 8,
        },
      ]);
    });
    expect(rejections).toEqual([]);
  });

  test('correlates a reader failure with N+1 while N was previously active', async () => {
    const rejections = await captureUnhandledRejections(async () => {
      const firstTurn = deferred();
      const errors: Array<{
        error: unknown;
        utteranceId: number | undefined;
      }> = [];
      const handler = createSpeakHandler({
        speak: async (_text, utteranceId) => {
          if (utteranceId === 20) await firstTurn.promise;
        },
        onSpeakError: (error, utteranceId) => {
          errors.push({ error, utteranceId });
        },
      });
      handler(
        makeFakeTextStreamReader('active', {
          attributes: { [SPEAK_UTTERANCE_ID_ATTR]: '20' },
        }),
      );
      await Promise.resolve();
      handler(
        makeFakeTextStreamReader(new Error('reader failed'), {
          attributes: { [SPEAK_UTTERANCE_ID_ATTR]: '21' },
        }),
      );
      firstTurn.resolve();

      await waitFor(() => errors.length === 1, 'correlated reader failure');
      expect(errors).toEqual([
        { error: new Error('reader failed'), utteranceId: 21 },
      ]);
    });
    expect(rejections).toEqual([]);
  });

  test('correlates a speak rejection and still runs the next turn', async () => {
    const rejections = await captureUnhandledRejections(async () => {
      const spoken: number[] = [];
      const errors: Array<{
        error: unknown;
        utteranceId: number | undefined;
      }> = [];
      const handler = createSpeakHandler({
        speak: async (_text, utteranceId) => {
          if (utteranceId === 30) throw new Error('speak failed');
          if (utteranceId !== undefined) spoken.push(utteranceId);
        },
        onSpeakError: (error, utteranceId) => {
          errors.push({ error, utteranceId });
        },
      });
      handler(
        makeFakeTextStreamReader('fails', {
          attributes: { [SPEAK_UTTERANCE_ID_ATTR]: '30' },
        }),
      );
      handler(
        makeFakeTextStreamReader('recovers', {
          attributes: { [SPEAK_UTTERANCE_ID_ATTR]: '31' },
        }),
      );

      await waitFor(() => spoken.length === 1, 'post-rejection speech');
      expect(errors).toEqual([
        { error: new Error('speak failed'), utteranceId: 30 },
      ]);
      expect(spoken).toEqual([31]);
    });
    expect(rejections).toEqual([]);
  });

  test('preserves id-less compatibility for reader failures', async () => {
    const rejections = await captureUnhandledRejections(async () => {
      const errors: Array<{
        error: unknown;
        utteranceId: number | undefined;
      }> = [];
      const handler = createSpeakHandler({
        speak: async () => {},
        onSpeakError: (error, utteranceId) => {
          errors.push({ error, utteranceId });
        },
      });
      handler(
        // biome-ignore lint/suspicious/noExplicitAny: structural test double for TextStreamReader
        makeFakeTextStreamReader(new Error('id-less failure')) as any,
      );

      await waitFor(() => errors.length === 1, 'id-less reader failure');
      expect(errors).toEqual([
        { error: new Error('id-less failure'), utteranceId: undefined },
      ]);
    });
    expect(rejections).toEqual([]);
  });

  test('contains a rejecting error callback so a later turn succeeds without an unhandled rejection', async () => {
    const rejections = await captureUnhandledRejections(async () => {
      const spoken: string[] = [];
      const errorIds: Array<number | undefined> = [];
      const handler = createSpeakHandler({
        speak: async (text) => {
          spoken.push(text);
        },
        onSpeakError: async (_error, utteranceId) => {
          errorIds.push(utteranceId);
          throw new Error('error callback failed');
        },
      });
      handler(
        makeFakeTextStreamReader(new Error('reader failed'), {
          attributes: { [SPEAK_UTTERANCE_ID_ATTR]: '40' },
        }),
      );
      handler(
        // biome-ignore lint/suspicious/noExplicitAny: structural test double for TextStreamReader
        makeFakeTextStreamReader('later success') as any,
      );

      await waitFor(() => spoken.length === 1, 'speech after callback failure');
      await Promise.resolve();
      expect(spoken).toEqual(['later success']);
      expect(errorIds).toEqual([40]);
    });
    expect(rejections).toEqual([]);
  });
});
