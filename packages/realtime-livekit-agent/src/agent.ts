/**
 * Maelstrom voice agent worker.
 *
 * STT path: user mic audio → Deepgram STT → transcript → client via publishTranscription.
 * TTS path: client sends a `speak` text stream (the response's summary) → Cartesia TTS
 *   → published back to the room as an audio track the client attaches and plays.
 *
 * No agent LLM — the Maelstrom engine is the only orchestrator. The client receives the
 * transcript (synthesized into an update_ui tool call) and sends the tool-result summary
 * back to speak.
 */

import {
  cli,
  defineAgent,
  type JobContext,
  ServerOptions,
  stt,
  tts,
} from '@livekit/agents';
import { TTS } from '@livekit/agents-plugin-cartesia';
import { STT } from '@livekit/agents-plugin-deepgram';
import {
  type AudioFrame,
  AudioSource,
  AudioStream,
  LocalAudioTrack,
  type RemoteTrack,
  RoomEvent,
  type TextStreamReader,
  TrackKind,
  TrackPublishOptions,
  TrackSource,
} from '@livekit/rtc-node';
import {
  SPEAK_TOPIC,
  SPEAK_UTTERANCE_ID_ATTR,
  TTS_TOPIC,
  type TtsDoneMessage,
  type TtsErrorMessage,
  TURN_TOPIC,
  USER_PARTICIPANT_IDENTITY,
} from '@maelstrom-co/realtime-livekit/protocol';

// Cap how long the agent holds a job waiting for the user to connect before it
// releases the worker slot — LiveKit's waitForParticipant has no timeout of its
// own and would otherwise block the job forever.
const PARTICIPANT_JOIN_TIMEOUT_MS = 60_000;
const entry = async (ctx: JobContext) => {
  // Connect the agent to the room first — waitForParticipant requires a
  // connected room, and the agent must be joined to publish transcriptions.
  await ctx.connect();

  // Wait for the user participant to join, but never hang forever: if nobody
  // connects before the deadline, release the job instead of holding the slot.
  const userParticipant = await waitForParticipantOrTimeout(
    ctx,
    USER_PARTICIPANT_IDENTITY,
    PARTICIPANT_JOIN_TIMEOUT_MS,
  );
  if (!userParticipant) {
    console.error(
      `[voice-agent] no '${USER_PARTICIPANT_IDENTITY}' participant joined within ${PARTICIPANT_JOIN_TIMEOUT_MS}ms; shutting down job`,
    );
    ctx.shutdown('user participant did not join');
    return;
  }
  // Bind the now-narrowed participant to a const so the hoisted closures below
  // (which lose flow narrowing across the function boundary) use it without an
  // assertion — same pattern as localParticipant.
  const user = userParticipant;

  const deepgramSTT = new STT({
    apiKey: process.env.DEEPGRAM_API_KEY,
    model: 'nova-3',
    language: 'en-US',
  });
  const drainTimeoutMs = resolveSttDrainTimeoutMs();

  // Find the user's audio track (may already be published or arrive shortly)
  const room = ctx.room;
  // After ctx.connect() the agent is joined, so its local participant exists.
  // Guard the optional field first, THEN bind — so the const is inferred as
  // non-optional and the hoisted speak()/emitTurn() closures below (which lose
  // flow narrowing across the function boundary) use it without an assertion.
  if (!room.localParticipant) {
    throw new Error('agent room has no local participant after connect');
  }
  const localParticipant = room.localParticipant;

  // Single room-scoped turn_end listener, registered ONCE (not per track).
  // Each processAudioTrack installs its asynchronous stream-boundary handler,
  // so a turn_end packet always routes to the currently-active track. The old
  // per-track registration leaked a listener per invocation and ended stale
  // streams once more than one track existed.
  let flushActiveTurn: (() => Promise<void>) | null = null;
  // Assigned once the TTS source exists (below); a barge-in `tts_cancel` routes
  // here to abort the in-flight synthesis.
  let cancelActiveTts: (() => void) | null = null;
  room.on(
    RoomEvent.DataReceived,
    createTurnControlHandler({
      boundIdentity: user.identity,
      endTurn: () => flushActiveTurn?.() ?? Promise.resolve(),
      cancelTts: () => cancelActiveTts?.(),
      onMalformed: () => {
        console.warn('[voice-agent] ignoring malformed turn control');
      },
      onTurnEndError: () => {
        console.warn('[voice-agent] STT turn finalization failed');
      },
    }),
  );

  // --- TTS return path (Cartesia) ---
  // Publish a single audio track up front; each speak request captures frames
  // into its shared AudioSource. Cartesia reads CARTESIA_API_KEY from env and
  // defaults to the sonic-3 model + default voice.
  const cartesiaTTS = new TTS();
  cartesiaTTS.on('error', () => {
    console.error('[voice-agent] Cartesia TTS error event');
  });
  const ttsSource = new AudioSource(
    cartesiaTTS.sampleRate,
    cartesiaTTS.numChannels,
  );
  const ttsTrack = LocalAudioTrack.createAudioTrack(
    'assistant-voice',
    ttsSource,
  );
  const ttsPublishOptions = new TrackPublishOptions();
  ttsPublishOptions.source = TrackSource.SOURCE_MICROPHONE;
  await localParticipant.publishTrack(ttsTrack, ttsPublishOptions);

  // The synthesis stream currently draining into `ttsSource`, so a barge-in can
  // abort it mid-flight. Null while no speak() is in progress.
  let activeTtsStream: tts.SynthesizeStream | null = null;
  // The utterance id currently being synthesized, echoed back on this
  // utterance's `tts_done`/`tts_error` so the client can correlate late status.
  let activeUtteranceId: number | undefined;
  async function speak(text: string, utteranceId: number | undefined) {
    activeUtteranceId = utteranceId;
    const trimmed = text.trim();
    if (trimmed) {
      // Use the websocket streaming path (`stream()`), NOT `synthesize()`.
      // The Cartesia plugin unconditionally sets `max_buffer_delay_ms` in the
      // request body, which the HTTP `/tts/bytes` endpoint (used by
      // `synthesize()`) rejects with HTTP 400 — yielding zero audio frames and
      // no thrown error. The field is only valid on the websocket endpoint.
      const stream = cartesiaTTS.stream();
      activeTtsStream = stream;
      try {
        stream.pushText(trimmed);
        stream.flush();
        stream.endInput();
        await pumpTtsStream(stream, (frame) => ttsSource.captureFrame(frame));
        // Frames are queued into the shared AudioSource but not yet heard; block
        // until the queue drains so the client collapses `speaking`→`connected`
        // on real playout end, not on synthesis end. A barge-in `clearQueue()`
        // resolves this early through the same path.
        await ttsSource.waitForPlayout();
      } finally {
        if (activeTtsStream === stream) activeTtsStream = null;
      }
    }
    // Tell the client the summary has finished playing (empty summaries play
    // nothing, but still resolve the client's `speaking` state). The utterance id
    // lets the client drop this if it already barged past this utterance.
    const done: TtsDoneMessage = { type: 'tts_done', utteranceId };
    await localParticipant.publishData(
      new TextEncoder().encode(JSON.stringify(done)),
      { reliable: true, topic: TTS_TOPIC },
    );
  }

  cancelActiveTts = () => cancelInFlightTts(activeTtsStream, ttsSource);

  // Client sends the tool-result summary over the `speak` text stream.
  room.registerTextStreamHandler(
    SPEAK_TOPIC,
    createSpeakHandler({
      speak,
      onSpeakError: async () => {
        console.error('[voice-agent] TTS synthesis failed');
        // Signal the client so its UI can indicate speak-back failed rather
        // than waiting indefinitely for audio that will never arrive.
        try {
          const error: TtsErrorMessage = {
            type: 'tts_error',
            utteranceId: activeUtteranceId,
          };
          await localParticipant.publishData(
            new TextEncoder().encode(JSON.stringify(error)),
            { reliable: true, topic: TTS_TOPIC },
          );
        } catch {
          console.error('[voice-agent] failed to signal TTS error to client');
        }
      },
    }),
  );

  /** Processes one accepted microphone track without changing its STT lifecycle. */
  async function processAudioTrack(track: RemoteTrack) {
    const audioStream = new AudioStream(track);
    let segmentCounter = 0;

    /** Publishes one aggregated transcript. */
    const publishTranscript = (text: string) => {
      segmentCounter++;
      const now = BigInt(Date.now()) * 1_000_000n; // nanoseconds
      void localParticipant
        .publishTranscription({
          participantIdentity: user.identity,
          trackSid: '',
          segments: [
            {
              id: `seg-${segmentCounter}`,
              text,
              startTime: now,
              endTime: now,
              language: 'en-US',
              final: true,
            },
          ],
        })
        .catch(() => {
          console.warn('[voice-agent] transcript publication failed');
        });
    };

    // One combined intent per push-to-talk hold (not a chunk per Deepgram pause),
    // normally emitted when that turn's provider iterator finishes.
    const aggregator = createTurnAggregator({
      emit: publishTranscript,
      fallback: false,
    });

    try {
      let trackEndHandler: (() => Promise<void>) | null = null;
      await runSpeechRecognition({
        audioStream,
        createSpeechStream: () => deepgramSTT.stream(),
        onFinalTranscript: (text) => aggregator.pushFinal(text),
        onTurnEnd: () => aggregator.endTurn(),
        onTurnDrained: () => aggregator.completeTurn(),
        drainTimeoutMs,
        setEndTurnHandler: (handler) => {
          if (handler) {
            trackEndHandler = handler;
            flushActiveTurn = handler;
          } else if (flushActiveTurn === trackEndHandler) {
            flushActiveTurn = null;
          }
        },
      });
    } finally {
      aggregator.dispose();
    }
  }

  const handleMicrophoneTrack = createSubscribedMicrophoneTrackHandler({
    expectedIdentity: user.identity,
    processTrack: processAudioTrack,
    onIgnoredTrack: () => {
      console.warn('[voice-agent] ignoring overlapping microphone track');
    },
    onProcessingError: () => {
      console.warn('[voice-agent] audio track processing stopped');
    },
  });

  // Handle tracks already published when agent joins.
  for (const [, publication] of user.trackPublications) {
    if (publication.kind === TrackKind.KIND_AUDIO) {
      if (publication.track) {
        handleMicrophoneTrack(publication.track, user);
      }
    }
  }

  // Handle tracks published after agent joins
  room.on(RoomEvent.TrackSubscribed, (track, _publication, participant) => {
    handleMicrophoneTrack(track as RemoteTrack, participant);
  });
};

/**
 * Builds the Maelstrom voice agent definition (the LiveKit `defineAgent` job).
 * Kept as a factory so provider options (STT/TTS) can be threaded through later
 * without changing the module's default export.
 */
export function defineMaelstromVoiceAgent() {
  return defineAgent({ entry });
}

/**
 * Default export is the agent definition itself: LiveKit's worker re-imports the
 * file named in `ServerOptions.agent` and reads its default export, so this must
 * be the agent — `runVoiceAgent` points `agent` at this same compiled module.
 */
export default defineMaelstromVoiceAgent();

/**
 * Boots the agent as a standalone worker process (separate from the app). Reads
 * LiveKit connection config from the environment; run it from a thin entry that
 * loads `.env` first.
 */
export function runVoiceAgent() {
  const { wsURL, apiKey, apiSecret } = resolveLiveKitCredentials();
  // Validate the STT deadline at worker startup, not during a live turn — the
  // same fail-closed posture as credential resolution.
  resolveSttDrainTimeoutMs();
  cli.runApp(
    new ServerOptions({
      agent: import.meta.filename,
      wsURL,
      apiKey,
      apiSecret,
    }),
  );
}

/**
 * Resolves LiveKit connection config from the environment, failing closed: any
 * missing credential throws (listing all that are absent) rather than silently
 * substituting insecure local-dev defaults that would point the worker at the
 * wrong server.
 */
export function resolveLiveKitCredentials(
  env: NodeJS.ProcessEnv = process.env,
): {
  wsURL: string;
  apiKey: string;
  apiSecret: string;
} {
  const { LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET } = env;
  const missing: string[] = [];
  if (!LIVEKIT_URL) missing.push('LIVEKIT_URL');
  if (!LIVEKIT_API_KEY) missing.push('LIVEKIT_API_KEY');
  if (!LIVEKIT_API_SECRET) missing.push('LIVEKIT_API_SECRET');
  if (missing.length > 0) {
    throw new Error(
      `Missing required LiveKit environment variable(s): ${missing.join(', ')}`,
    );
  }
  return {
    wsURL: LIVEKIT_URL as string,
    apiKey: LIVEKIT_API_KEY as string,
    apiSecret: LIVEKIT_API_SECRET as string,
  };
}

/**
 * Resolves the provider stream drain deadline from
 * `MAELSTROM_STT_DRAIN_TIMEOUT_MS`, defaulting to 5000 ms. This bounds Deepgram
 * iterator completion after `endInput()`; expiry closes that provider stream
 * and allows a clean successor. Invalid values fail worker startup rather than
 * changing turn behavior later.
 */
export function resolveSttDrainTimeoutMs(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const raw = env.MAELSTROM_STT_DRAIN_TIMEOUT_MS;
  if (raw === undefined || raw === '') return DEFAULT_STT_DRAIN_TIMEOUT_MS;
  const ms = Number(raw);
  if (!Number.isFinite(ms) || ms <= 0) {
    throw new Error(
      `Invalid MAELSTROM_STT_DRAIN_TIMEOUT_MS: expected a positive number of milliseconds, got ${JSON.stringify(raw)}`,
    );
  }
  return ms;
}

const DEFAULT_STT_DRAIN_TIMEOUT_MS = 5000;

/**
 * Races {@link JobContext.waitForParticipant} against a deadline so a job never
 * blocks forever on a participant that never connects. Resolves the participant
 * on join, or `null` on timeout — the SDK method has no timeout of its own and
 * only settles on ParticipantConnected / room Disconnected.
 */
export async function waitForParticipantOrTimeout(
  ctx: JobContext,
  identity: string,
  timeoutMs: number,
): Promise<Awaited<ReturnType<JobContext['waitForParticipant']>> | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), timeoutMs);
  });
  try {
    return await Promise.race([ctx.waitForParticipant(identity), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Drains a TTS synthesis stream into `captureFrame`, always closing the stream
 * — even on error — so a mid-synthesis failure can't leak the Cartesia
 * websocket connection.
 */
export async function pumpTtsStream(
  stream: tts.SynthesizeStream,
  captureFrame: (frame: AudioFrame) => Promise<void>,
): Promise<void> {
  try {
    for await (const audio of stream) {
      if (audio === tts.SynthesizeStream.END_OF_STREAM) break;
      await captureFrame(audio.frame);
    }
  } finally {
    stream.close();
  }
}

/**
 * Aborts an in-flight barge-in TTS: closes the synthesis stream (terminating the
 * pump's for-await via the stream's close sentinel) and clears the audio queue.
 * `clearQueue()` also resolves any pending `waitForPlayout()`, so the blocked
 * `speak()` unblocks and publishes `tts_done` through its normal path — the
 * client needs no extra signal. Both operations are idempotent and safe when the
 * stream is null (no speak in progress) or already ended.
 */
export function cancelInFlightTts(
  stream: tts.SynthesizeStream | null,
  source: Pick<AudioSource, 'clearQueue'>,
): void {
  stream?.close();
  source.clearQueue();
}

/**
 * Builds the `speak` text-stream handler LiveKit invokes fire-and-forget (it
 * never awaits or catches the callback's return), so every awaited step inside
 * must stay catch-covered or a rejection kills the worker process.
 *
 * Serializes turns through a chain private to this handler instance, so
 * overlapping summaries can't interleave frames; a failed turn's `onSpeakError`
 * still resolves the chain, so a bad turn never poisons the ones after it.
 * `speakChain` is reassigned synchronously (no `await` before it), so turn
 * order tracks call order even when one turn's `readAll()` resolves before
 * another's — awaiting first would let a fast later call jump the queue.
 */
export function createSpeakHandler(deps: {
  speak: (text: string, utteranceId: number | undefined) => Promise<void>;
  onSpeakError: (err: unknown) => void | Promise<void>;
}): (
  reader: Pick<TextStreamReader, 'readAll'> & {
    info?: { attributes?: Record<string, string> };
  },
) => void {
  let speakChain: Promise<void> = Promise.resolve();
  return (reader) => {
    const text = reader.readAll();
    // Correlate this utterance with its later TTS status: the client stamps an id
    // on the stream attributes, and the worker echoes it on `tts_done`/`tts_error`
    // so the client can drop status for an utterance it already barged past.
    const utteranceId = parseUtteranceId(
      reader.info?.attributes?.[SPEAK_UTTERANCE_ID_ATTR],
    );
    // Reading starts immediately, but the chain may not reach `text` until
    // prior turns settle — attach a no-op handler now so a rejection in the
    // meantime is never reported as unhandled; the real handling still runs
    // below once the chain gets here.
    text.catch(() => {});
    speakChain = speakChain
      .then(() => text)
      .then((value) => deps.speak(value, utteranceId))
      .catch((err) => deps.onSpeakError(err));
  };
}

// Attributes are strings on the wire; a missing or non-numeric id yields
// undefined, so the worker echoes no id and the client falls back to type-only
// handling of the status packet.
function parseUtteranceId(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const id = Number(raw);
  return Number.isFinite(id) ? id : undefined;
}

type TurnControlParticipant = { identity: string } | undefined;

/**
 * Creates the room-scoped control listener for push-to-talk boundaries and TTS
 * cancellation. Only the participant identity bound after job join may control
 * the session; missing, foreign, off-topic, malformed, and unknown controls are
 * no-ops. Parse failures are reported without forwarding payloads or errors, and
 * the fire-and-forget turn boundary always has a rejection observer.
 */
export function createTurnControlHandler(deps: {
  boundIdentity: string;
  endTurn: () => Promise<void>;
  cancelTts: () => void;
  onMalformed: () => void;
  onTurnEndError: () => void;
}): (
  payload: Uint8Array,
  participant: TurnControlParticipant,
  kind: unknown,
  topic: string | undefined,
) => void {
  return (payload, participant, _kind, topic) => {
    if (topic !== TURN_TOPIC || participant?.identity !== deps.boundIdentity) {
      return;
    }

    let message: unknown;
    try {
      message = JSON.parse(new TextDecoder().decode(payload));
    } catch {
      deps.onMalformed();
      return;
    }
    if (!message || typeof message !== 'object' || !('type' in message)) {
      deps.onMalformed();
      return;
    }

    const type = (message as { type?: unknown }).type;
    if (type === 'turn_start') {
      deps.onMalformed();
    } else if (type === 'turn_end') {
      void deps.endTurn().catch(() => deps.onTurnEndError());
    } else if (type === 'tts_cancel') {
      deps.cancelTts();
    } else {
      deps.onMalformed();
    }
  };
}

/**
 * Serializes subscribed microphone ownership for the expected user. The first
 * accepted audio track remains active until its processing promise settles;
 * overlapping tracks are ignored rather than creating a second STT boundary
 * authority. Foreign participants and non-audio tracks are silent no-ops. Both
 * synchronous and asynchronous processing failures are observed without
 * exposing raw error objects.
 */
export function createSubscribedMicrophoneTrackHandler(deps: {
  expectedIdentity: string;
  processTrack: (track: RemoteTrack) => Promise<void>;
  onIgnoredTrack: () => void;
  onProcessingError: () => void;
}): (track: RemoteTrack, participant: { identity: string }) => void {
  let active = false;
  return (track, participant) => {
    if (
      participant.identity !== deps.expectedIdentity ||
      track.kind !== TrackKind.KIND_AUDIO
    ) {
      return;
    }
    if (active) {
      deps.onIgnoredTrack();
      return;
    }

    active = true;
    void Promise.resolve()
      .then(() => deps.processTrack(track))
      .catch(() => deps.onProcessingError())
      .finally(() => {
        active = false;
      });
  };
}

/**
 * Aggregates Deepgram finals into one transcript per push-to-talk hold.
 *
 * Deepgram emits a final at every natural pause, so one hold yields several
 * finals. `completeTurn()` is the provider-stream ownership boundary: only after
 * that ending stream has finished (or failed and closed) are all of its finals
 * joined and emitted once. A successor stream is installed afterward, so its
 * finals cannot share this buffer.
 *
 * The optional fallback exists only for isolated users without a stream
 * coordinator. Production disables it because the coordinator's drain deadline
 * is the sole completion authority. The promise returned by `endTurn()` settles
 * after `completeTurn()` emits, or after the optional fallback. `dispose()`
 * cancels pending fallback work and settles without emitting additional text.
 */
export function createTurnAggregator(
  opts: {
    emit: (text: string) => void;
  } & (
    | { fallback: false }
    | {
        fallback?: true;
        flushTimeoutMs: number;
        scheduleFallback?: (
          callback: () => void,
          timeoutMs: number,
        ) => () => void;
      }
  ),
): {
  pushFinal: (text: string) => void;
  endTurn: () => Promise<void>;
  completeTurn: () => void;
  dispose: () => void;
} {
  const { emit } = opts;
  const scheduleFallback =
    ('scheduleFallback' in opts ? opts.scheduleFallback : undefined) ??
    ((callback: () => void, timeoutMs: number) => {
      const timer = setTimeout(callback, timeoutMs);
      return () => clearTimeout(timer);
    });
  let buffer: string[] = [];
  let ending = false;
  let emitted = false;
  let cancelFallback: (() => void) | null = null;
  let endedPromise: Promise<void> | null = null;
  let settleEndedTurn: (() => void) | null = null;

  function emitBufferedTurn(): void {
    if (emitted) return;
    emitted = true;
    const text = buffer.join(' ').replace(/\s+/g, ' ').trim();
    buffer = [];
    if (text) emit(text);
    settleEndedTurn?.();
    settleEndedTurn = null;
  }

  function resetTurn(): void {
    cancelFallback?.();
    cancelFallback = null;
    ending = false;
    emitted = false;
    buffer = [];
    endedPromise = null;
    settleEndedTurn = null;
  }

  return {
    pushFinal(text: string): void {
      if (ending && emitted) return;
      buffer.push(text);
    },
    endTurn(): Promise<void> {
      if (endedPromise) return endedPromise;
      ending = true;
      if (opts.fallback !== false) {
        cancelFallback = scheduleFallback(
          emitBufferedTurn,
          opts.flushTimeoutMs,
        );
      }
      endedPromise = new Promise<void>((resolve) => {
        settleEndedTurn = resolve;
      });
      return endedPromise;
    },
    completeTurn(): void {
      if (!ending) return;
      cancelFallback?.();
      cancelFallback = null;
      emitBufferedTurn();
      resetTurn();
    },
    dispose(): void {
      cancelFallback?.();
      settleEndedTurn?.();
      resetTurn();
    },
  };
}

type SpeechTurn = {
  stream: stt.SpeechStream;
  consumeTask: Promise<void>;
  acceptsFinals: boolean;
  inputEnded: boolean;
  closed: boolean;
};

type SpeechRecognitionOptions = {
  audioStream: AsyncIterable<AudioFrame>;
  createSpeechStream: () => stt.SpeechStream;
  onFinalTranscript: (text: string) => void;
  onTurnEnd: () => void | Promise<void>;
  onTurnDrained: () => void | Promise<void>;
  drainTimeoutMs: number;
  createDrainDeadline?: (timeoutMs: number) => DrainDeadline;
  setEndTurnHandler: (handler: (() => Promise<void>) | null) => void;
};

type DrainDeadline = {
  promise: Promise<void>;
  cancel: () => void;
};

function createDrainDeadline(timeoutMs: number): DrainDeadline {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return {
    promise: new Promise<void>((resolve) => {
      timer = setTimeout(resolve, timeoutMs);
    }),
    cancel: () => {
      if (timer) clearTimeout(timer);
    },
  };
}

/**
 * Owns one turn-scoped Deepgram stream at a time beneath a track-scoped LiveKit
 * audio iterator. A boundary synchronously detaches the writable stream, so the
 * frame pump keeps consuming and drops frames until a successor exists. It ends
 * input exactly once, drains final events to iterator completion or the
 * provider-drain deadline, closes the old stream, completes that stream's
 * aggregator ownership, and installs a clean successor without requiring
 * another LiveKit frame.
 *
 * Each stream owns a final-transcript generation. Completion, timeout, failure,
 * or close retires that generation before aggregation completes, so a queued
 * event from the old consumer cannot enter the successor's buffer. Successful
 * drains emit all finals once; failed drains salvage only finals accepted before
 * ownership was retired. Empty turns emit nothing.
 *
 * Duplicate boundaries during the same drain share one promise. Disposal marks
 * ownership dead before awaiting in-flight work, so track teardown cannot create
 * a successor. Boundary failures reject that boundary after recovery rather than
 * poisoning the track pump. Every internally started consumer and boundary has
 * an immediate rejection observer, including streams closed by timeout.
 */
class SpeechTurnCoordinator {
  readonly #createSpeechStream: () => stt.SpeechStream;
  readonly #onFinalTranscript: (text: string) => void;
  readonly #onTurnEnd: () => void | Promise<void>;
  readonly #onTurnDrained: () => void | Promise<void>;
  readonly #drainTimeoutMs: number;
  readonly #createDrainDeadline: (timeoutMs: number) => DrainDeadline;
  #current: SpeechTurn | null = null;
  #boundary: Promise<void> | null = null;
  #disposed = false;

  constructor(
    createSpeechStream: () => stt.SpeechStream,
    onFinalTranscript: (text: string) => void,
    onTurnEnd: () => void | Promise<void>,
    onTurnDrained: () => void | Promise<void>,
    drainTimeoutMs: number,
    deadlineFactory: (timeoutMs: number) => DrainDeadline,
  ) {
    this.#createSpeechStream = createSpeechStream;
    this.#onFinalTranscript = onFinalTranscript;
    this.#onTurnEnd = onTurnEnd;
    this.#onTurnDrained = onTurnDrained;
    this.#drainTimeoutMs = drainTimeoutMs;
    this.#createDrainDeadline = deadlineFactory;
    this.#current = this.#createTurn();
  }

  pushFrame(frame: AudioFrame): void {
    if (!this.#current) return;
    this.#current.stream.pushFrame(frame);
  }

  endTurn(): Promise<void> {
    if (this.#boundary) return this.#boundary;
    if (this.#disposed || !this.#current) return Promise.resolve();

    const turn = this.#current;
    this.#current = null;
    const boundary = this.#rotate(turn);
    this.#boundary = boundary;
    boundary.catch(() => {});
    void boundary
      .finally(() => {
        if (this.#boundary === boundary) this.#boundary = null;
      })
      .catch(() => {});
    return boundary;
  }

  async dispose(): Promise<void> {
    this.#disposed = true;
    if (this.#boundary) {
      await this.#boundary;
      return;
    }
    const turn = this.#current;
    this.#current = null;
    if (turn) await this.#finishTurn(turn);
  }

  #createTurn(): SpeechTurn {
    const stream = this.#createSpeechStream();
    const turn: SpeechTurn = {
      stream,
      consumeTask: Promise.resolve(),
      acceptsFinals: true,
      inputEnded: false,
      closed: false,
    };
    turn.consumeTask = this.#consume(turn);
    turn.consumeTask.catch(() => {});
    return turn;
  }

  async #consume(turn: SpeechTurn): Promise<void> {
    for await (const event of turn.stream) {
      const final = event.type === stt.SpeechEventType.FINAL_TRANSCRIPT;
      if (!final) continue;
      const text = event.alternatives?.[0]?.text?.trim();
      if (turn.acceptsFinals && text) this.#onFinalTranscript(text);
    }
  }

  async #rotate(turn: SpeechTurn): Promise<void> {
    let failure: unknown;
    try {
      await this.#finishTurn(turn);
    } catch (error) {
      failure = error;
    }
    let aggregatorSettled: Promise<void> = Promise.resolve();
    try {
      aggregatorSettled = Promise.resolve(this.#onTurnEnd());
    } catch (error) {
      aggregatorSettled = Promise.reject(error);
    }
    aggregatorSettled.catch(() => {});
    try {
      await this.#onTurnDrained();
    } catch (error) {
      failure ??= error;
    }
    try {
      await aggregatorSettled;
    } catch (error) {
      failure ??= error;
    }
    if (!this.#disposed) {
      try {
        this.#current = this.#createTurn();
      } catch (error) {
        failure ??= error;
      }
    }
    if (failure !== undefined) throw failure;
  }

  async #finishTurn(turn: SpeechTurn): Promise<void> {
    let deadline: DrainDeadline | null = null;
    try {
      if (!turn.inputEnded) {
        turn.inputEnded = true;
        turn.stream.endInput();
      }
      deadline = this.#createDrainDeadline(this.#drainTimeoutMs);
      const outcome = await Promise.race([
        turn.consumeTask.then(() => 'drained' as const),
        deadline.promise.then(() => 'timeout' as const),
      ]);
      if (outcome === 'timeout') {
        throw new Error('STT provider drain timed out');
      }
    } finally {
      deadline?.cancel();
      turn.acceptsFinals = false;
      if (!turn.closed) {
        turn.closed = true;
        turn.stream.close();
      }
    }
  }
}

/**
 * Consumes one LiveKit audio stream for a subscribed track while delegating each
 * accepted voice turn to a distinct Deepgram stream. The installed turn handler
 * is asynchronous because it represents the full end-input, provider-drain,
 * close, and successor-install sequence; callers must observe its rejection.
 *
 * Frames yielded while a boundary is pending are consumed and dropped, never
 * held for a successor or pushed into the ended stream. Ordered delivery still
 * relies on the browser pausing microphone publication before sending
 * `turn_end`; without a protocol turn identifier this package cannot correct
 * delayed controls.
 */
export async function runSpeechRecognition(
  opts: SpeechRecognitionOptions,
): Promise<void> {
  const coordinator = new SpeechTurnCoordinator(
    opts.createSpeechStream,
    opts.onFinalTranscript,
    opts.onTurnEnd,
    opts.onTurnDrained,
    opts.drainTimeoutMs,
    opts.createDrainDeadline ?? createDrainDeadline,
  );
  const endTurn = () => coordinator.endTurn();
  opts.setEndTurnHandler(endTurn);
  try {
    for await (const frame of opts.audioStream) {
      coordinator.pushFrame(frame);
    }
  } finally {
    opts.setEndTurnHandler(null);
    await coordinator.dispose();
  }
}
