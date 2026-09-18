/**
 * Maelstrom voice agent worker.
 *
 * STT path: user mic audio → Deepgram STT → transcript → client via publishTranscription.
 * TTS path: client sends a `speak` text stream (`userMessage ?? summary`) → Cartesia TTS
 *   → published back to the room as an audio track the client attaches and plays.
 *
 * No agent LLM — the Maelstrom engine is the only orchestrator. The client receives the
 * transcript (synthesized into an update_ui tool call) and, once the UI settles, sends
 * the spoken reply back to speak.
 */

import { fileURLToPath } from 'node:url';
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
  parseTriggerTurnPacket,
  SPEAK_TOPIC,
  SPEAK_UTTERANCE_ID_ATTR,
  TRIGGER_TURN_TOPIC,
  type TriggerTurnResult,
  TTS_READY_TOPIC,
  TTS_TOPIC,
  type TtsDoneMessage,
  type TtsErrorMessage,
  type TtsReadyMessage,
  type TtsStartedMessage,
  TURN_TOPIC,
  type TurnCapabilityAck,
  USER_PARTICIPANT_IDENTITY,
} from '@maelstrom-co/realtime-protocol/livekit-wire';

/** Fixed queue-failure reasons shared by the runtime Set and derived union. */
const SPEECH_TURN_QUEUE_OVERFLOW_REASONS = [
  'successor-segment-limit',
  'segment-frame-limit',
  'segment-audio-limit',
  'total-frame-limit',
  'invalid-frame-metadata',
] as const;

/** Application-owned queue reason; provider values cannot extend this union. */
type SpeechTurnQueueOverflowReason =
  (typeof SPEECH_TURN_QUEUE_OVERFLOW_REASONS)[number];

/**
 * Fixed privacy-safe worker taxonomy. Successor creation covers both exhausted
 * post-drain construction retry and failed live-frame replacement; neither case
 * incorporates provider errors, frames, or transcript content.
 */
const WORKER_DIAGNOSTIC_REASONS = [
  'participant-join-timeout',
  'malformed-turn-control',
  'turn-finalization-failed',
  'tts-provider-failed',
  'tts-synthesis-failed',
  'tts-cancellation-failed',
  'tts-status-publication-failed',
  'tts-ready-publication-failed',
  'transcript-publication-failed',
  'overlapping-microphone-track',
  'audio-track-processing-failed',
  'stt-provider-drain-timeout',
  'stt-successor-creation-failed',
  ...SPEECH_TURN_QUEUE_OVERFLOW_REASONS,
] as const;

/** Complete application-owned reason union derived from the readonly tuple. */
type WorkerDiagnosticReason = (typeof WORKER_DIAGNOSTIC_REASONS)[number];

type WorkerDiagnostic = {
  /** Fixed application-owned category shared by every worker descriptor. */
  category: 'voice-agent';
  /** Fixed application-owned reason; never derived from provider text. */
  reason: WorkerDiagnosticReason;
  /** Optional own boolean or finite-number data property. Strings are omitted. */
  code?: number | boolean;
  /** Optional own boolean or finite-number data property. Strings are omitted. */
  status?: number | boolean;
  /** Optional own boolean or finite-number data property. Strings are omitted. */
  type?: number | boolean;
};

const WORKER_DIAGNOSTIC_REASON_SET = new Set<WorkerDiagnosticReason>(
  WORKER_DIAGNOSTIC_REASONS,
);

/**
 * Application-owned error whose message and `reason` are the same fixed worker
 * reason. Arbitrary provider or caller text is never accepted as a reason.
 */
export class WorkerDiagnosticError extends Error {
  /** Fixed whitelisted reason used by the privacy-safe diagnostic projector. */
  readonly reason: WorkerDiagnosticReason;

  /** Creates an owned error whose message and diagnostic reason are `reason`. */
  constructor(reason: WorkerDiagnosticReason) {
    super(reason);
    this.name = 'WorkerDiagnosticError';
    this.reason = reason;
  }
}

/**
 * Reads one allowed own boolean or finite-number data property without invoking
 * accessors. Strings are always omitted because provider-controlled tokens can
 * encode credentials or identifiers even when their shape looks bounded.
 */
function readOwnDiagnosticScalar(
  value: unknown,
  key: 'code' | 'status' | 'type',
): number | boolean | undefined {
  if (
    (typeof value !== 'object' || value === null) &&
    typeof value !== 'function'
  ) {
    return undefined;
  }
  let descriptor: PropertyDescriptor | undefined;
  try {
    descriptor = Object.getOwnPropertyDescriptor(value, key);
  } catch {
    return undefined;
  }
  if (!descriptor || !('value' in descriptor)) return undefined;
  const scalar = descriptor.value;
  if (typeof scalar === 'number') {
    return Number.isFinite(scalar) ? scalar : undefined;
  }
  return typeof scalar === 'boolean' ? scalar : undefined;
}

/** Reads only the whitelisted own reason of an application-owned safe error. */
function readOwnedReason(value: unknown): WorkerDiagnosticReason | undefined {
  try {
    if (!(value instanceof WorkerDiagnosticError)) return undefined;
    const descriptor = Object.getOwnPropertyDescriptor(value, 'reason');
    if (!descriptor || !('value' in descriptor)) return undefined;
    return WORKER_DIAGNOSTIC_REASON_SET.has(descriptor.value)
      ? descriptor.value
      : undefined;
  } catch {
    return undefined;
  }
}

/** Detects the queue error without allowing hostile proxies to escape. */
function isSpeechTurnQueueOverflow(
  value: unknown,
): value is SpeechTurnQueueOverflowError {
  try {
    return value instanceof SpeechTurnQueueOverflowError;
  } catch {
    return false;
  }
}

/**
 * Projects an unknown caught value into privacy-safe worker diagnostics. Output
 * always starts with fixed `category: 'voice-agent'` and an application-owned
 * reason, then may include only own data-property `code`, `status`, or `type`
 * values when they are boolean or finite numbers. Strings are always omitted,
 * including token-shaped values that could encode credentials or identifiers.
 * Accessors, inherited values, nested data, and all other fields are ignored
 * without invoking getters or traversing the value.
 *
 * The fixed taxonomy covers participant timeout, malformed control, turn
 * finalization, TTS provider/synthesis/cancellation/status publication, transcript
 * publication, overlapping/failed microphone processing, STT drain timeout,
 * exhausted successor creation/live replacement, and the five speech-turn queue
 * rejection reasons. Call sites select one of those tuple-derived literals;
 * provider values never create categories or reasons.
 *
 * Application-owned `WorkerDiagnosticError` may replace the call-site reason
 * with its fixed reason. `SpeechTurnQueueOverflowError` exposes only its fixed
 * queue reason and never optional metadata. In contrast, arbitrary
 * `message`, `name`, `stack`, `cause`, body/data/provider responses, identifiers,
 * transcripts, audio, chunks, and environment values are always prohibited.
 */
export function describeWorkerDiagnostic(
  reason: WorkerDiagnosticReason,
  value: unknown,
): WorkerDiagnostic {
  const ownedReason = readOwnedReason(value);
  const diagnosticReason = ownedReason ?? reason;
  const diagnostic: WorkerDiagnostic = {
    category: 'voice-agent',
    reason: diagnosticReason,
  };
  if (isSpeechTurnQueueOverflow(value)) return diagnostic;
  for (const key of ['code', 'status', 'type'] as const) {
    const scalar = readOwnDiagnosticScalar(value, key);
    if (scalar !== undefined) diagnostic[key] = scalar;
  }
  return diagnostic;
}

/**
 * Logs one descriptor with fixed voice-agent category/reason and optional safe
 * boolean or finite-number values. Strings are never projected. Hostile
 * inspection and logger failures are contained as no-ops, so diagnostics never
 * alter worker control flow.
 */
export function logWorkerDiagnostic(
  level: 'warn' | 'error',
  reason: WorkerDiagnosticReason,
  value?: unknown,
): void {
  try {
    console[level]('[voice-agent]', describeWorkerDiagnostic(reason, value));
  } catch {
    // Diagnostics are best effort and must never alter worker control flow.
  }
}

// Cap how long the agent holds a job waiting for the user to connect before it
// releases the worker slot — LiveKit's waitForParticipant has no timeout of its
// own and would otherwise block the job forever.
const PARTICIPANT_JOIN_TIMEOUT_MS = 60_000;

/**
 * LiveKit job entry for the Maelstrom voice worker. Exported so tests can run
 * the real job against a mocked {@link JobContext}.
 */
export async function maelstromVoiceJob(ctx: JobContext): Promise<void> {
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
    logWorkerDiagnostic('error', 'participant-join-timeout');
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
  const pendingAudioMsLimit = derivePendingAudioMsLimit(drainTimeoutMs);

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
  let flushActiveTurn: SpeechTurnEndHandler | null = null;
  // Assigned once the TTS source exists (below); a barge-in `tts_cancel` routes
  // here to abort the in-flight synthesis.
  let cancelActiveTts: (() => void) | null = null;
  room.on(
    RoomEvent.DataReceived,
    createTurnControlHandler({
      boundIdentity: user.identity,
      endTurn: (result) => flushActiveTurn?.(result),
      correlation: {
        drainTimeoutMs,
        publish: (packet) =>
          localParticipant.publishData(
            new TextEncoder().encode(JSON.stringify(packet)),
            { reliable: true, topic: TRIGGER_TURN_TOPIC },
          ),
      },
      cancelTts: () => cancelActiveTts?.(),
      onCancelTtsError: (error) => {
        logWorkerDiagnostic('warn', 'tts-cancellation-failed', error);
      },
      onMalformed: () => {
        logWorkerDiagnostic('warn', 'malformed-turn-control');
      },
      onTurnEndError: (error) => {
        logWorkerDiagnostic('warn', 'turn-finalization-failed', error);
      },
    }),
  );

  // --- TTS return path (Cartesia) ---
  // Publish a single audio track up front; each speak request captures frames
  // into its shared AudioSource. Cartesia reads CARTESIA_API_KEY from env and
  // defaults to the sonic-3 model + default voice.
  const cartesiaTTS = new TTS();
  cartesiaTTS.on('error', (error: unknown) => {
    logWorkerDiagnostic('error', 'tts-provider-failed', error);
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
  async function speak(text: string, utteranceId: number | undefined) {
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
        let started = false;
        await pumpTtsStream(stream, async (frame) => {
          await ttsSource.captureFrame(frame);
          if (!started) {
            started = true;
            if (utteranceId === undefined) return;
            const status: TtsStartedMessage = {
              type: 'tts_started',
              utteranceId,
            };
            void localParticipant
              .publishData(new TextEncoder().encode(JSON.stringify(status)), {
                reliable: true,
                topic: TTS_TOPIC,
              })
              .catch((error) =>
                logWorkerDiagnostic(
                  'warn',
                  'tts-status-publication-failed',
                  error,
                ),
              );
          }
        });
        // Frames are queued into the shared AudioSource but not yet heard; block
        // until the queue drains so the client collapses `speaking`→`connected`
        // on real playout end, not on synthesis end. A barge-in `clearQueue()`
        // resolves this early through the same path.
        await ttsSource.waitForPlayout();
      } finally {
        if (activeTtsStream === stream) activeTtsStream = null;
      }
    }
    // Tell the client the reply has finished playing (empty replies play
    // nothing, but still resolve the client's `speaking` state). The utterance id
    // lets the client drop this if it already barged past this utterance.
    const done: TtsDoneMessage = { type: 'tts_done', utteranceId };
    await localParticipant.publishData(
      new TextEncoder().encode(JSON.stringify(done)),
      { reliable: true, topic: TTS_TOPIC },
    );
  }

  cancelActiveTts = () => cancelInFlightTts(activeTtsStream, ttsSource);

  // Client sends `userMessage ?? summary` over the `speak` text stream.
  room.registerTextStreamHandler(
    SPEAK_TOPIC,
    createSpeakHandler({
      speak,
      onSpeakError: async (caught, utteranceId) => {
        logWorkerDiagnostic('error', 'tts-synthesis-failed', caught);
        // Signal the client so its UI can indicate speak-back failed rather
        // than waiting indefinitely for audio that will never arrive.
        try {
          const error: TtsErrorMessage = {
            type: 'tts_error',
            utteranceId,
          };
          await localParticipant.publishData(
            new TextEncoder().encode(JSON.stringify(error)),
            { reliable: true, topic: TTS_TOPIC },
          );
        } catch (error) {
          logWorkerDiagnostic('error', 'tts-status-publication-failed', error);
        }
      },
    }),
  );

  // Greeting gate: LiveKit drops a SPEAK_TOPIC text stream sent before this
  // handler (and the TTS track above) exist. Announce readiness after both and
  // replay it when the bound user rejoins an existing worker room.
  const ready: TtsReadyMessage = { type: 'tts_ready' };
  const readyPayload = new TextEncoder().encode(JSON.stringify(ready));
  const publishTtsReady = async (): Promise<void> => {
    try {
      await localParticipant.publishData(readyPayload, {
        reliable: true,
        topic: TTS_READY_TOPIC,
      });
    } catch (error) {
      logWorkerDiagnostic('warn', 'tts-ready-publication-failed', error);
    }
  };
  room.on(RoomEvent.ParticipantConnected, (participant) => {
    if (participant.identity !== user.identity) return;
    void publishTtsReady();
  });
  await publishTtsReady();

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
        .catch((error) => {
          logWorkerDiagnostic('warn', 'transcript-publication-failed', error);
        });
    };

    // One combined intent per push-to-talk hold (not a chunk per Deepgram pause),
    // normally emitted when that turn's provider iterator finishes.
    const aggregator = createTurnAggregator({
      emit: publishTranscript,
      fallback: false,
    });

    try {
      let trackEndHandler: SpeechTurnEndHandler | null = null;
      await runSpeechRecognition({
        audioStream,
        createSpeechStream: () => deepgramSTT.stream(),
        onFinalTranscript: (text) => aggregator.pushFinal(text),
        onTurnEnd: () => aggregator.endTurn(),
        onTurnDrained: () => aggregator.completeTurn(),
        drainTimeoutMs,
        pendingAudioMsLimit,
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
      logWorkerDiagnostic('warn', 'overlapping-microphone-track');
    },
    onProcessingError: (error) => {
      logWorkerDiagnostic('warn', 'audio-track-processing-failed', error);
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
}

/**
 * Builds the Maelstrom voice agent definition (the LiveKit `defineAgent` job).
 * Kept as a factory so provider options (STT/TTS) can be threaded through later
 * without changing the module's default export.
 */
export function defineMaelstromVoiceAgent() {
  return defineAgent({ entry: maelstromVoiceJob });
}

/**
 * Default export is the agent definition itself: LiveKit's worker re-imports the
 * file named in `ServerOptions.agent` and reads its default export, so this must
 * be the agent — `runVoiceAgent` points `agent` at this same compiled module.
 */
export default defineMaelstromVoiceAgent();

/**
 * Boots the agent as a standalone worker process, separate from the application
 * server that mints browser room tokens.
 *
 * Reads LiveKit connection config from the environment, so call it from a thin
 * entry that has already loaded `.env`. An invalid drain timeout or derived
 * pending-audio budget rejects before `cli.runApp`, so a worker can never start
 * with an unsafe cap and discover it mid-turn.
 *
 * `ServerOptions.agent` is set to this module's own resolved path, because the
 * LiveKit CLI re-spawns the agent per job and needs a file it can import. That
 * makes the path an invariant rather than a detail: this module must remain
 * importable from disk at the location it was loaded from, which is why it is
 * derived from `import.meta.url` and not from the caller's entry file.
 *
 * @example
 * ```js
 * // voice-worker.mjs
 * import { runVoiceAgent } from '@maelstrom-co/realtime-livekit-agent';
 *
 * runVoiceAgent();
 * ```
 *
 * Then start it with the LiveKit worker CLI verb:
 *
 * ```bash
 * node --env-file=.env voice-worker.mjs start
 * ```
 */
export function runVoiceAgent() {
  const { wsURL, apiKey, apiSecret } = resolveLiveKitCredentials();
  // Validate the STT deadline at worker startup, not during a live turn — the
  // same fail-closed posture as credential resolution.
  derivePendingAudioMsLimit(resolveSttDrainTimeoutMs());
  cli.runApp(
    new ServerOptions({
      // Not `import.meta.filename`, which Node added in 20.11 while this
      // package's `engines` allows 20.0. On those releases it is undefined, so
      // the worker starts with no agent module path and fails far from here.
      agent: fileURLToPath(import.meta.url),
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
 * and allows a clean successor. The validated value also derives the successor
 * pending-audio budget through {@link derivePendingAudioMsLimit}; invalid timeout
 * or unsafe derived values fail worker startup rather than changing turn
 * behavior later. Unset or empty configuration uses 5000 ms; configured values
 * must be finite, positive, and no greater than 60000 ms. Unlike this parser,
 * `derivePendingAudioMsLimit` only validates that its arithmetic remains safe.
 */
export function resolveSttDrainTimeoutMs(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const raw = env.MAELSTROM_STT_DRAIN_TIMEOUT_MS;
  if (raw === undefined || raw === '') return DEFAULT_STT_DRAIN_TIMEOUT_MS;
  const ms = Number(raw);
  if (!Number.isFinite(ms) || ms <= 0 || ms > MAX_STT_DRAIN_TIMEOUT_MS) {
    throw new Error(
      `Invalid MAELSTROM_STT_DRAIN_TIMEOUT_MS: expected a positive number of milliseconds no greater than ${MAX_STT_DRAIN_TIMEOUT_MS}, got ${JSON.stringify(raw)}`,
    );
  }
  return ms;
}

const DEFAULT_STT_DRAIN_TIMEOUT_MS = 5000;
const MAX_STT_DRAIN_TIMEOUT_MS = 60_000;
const PENDING_AUDIO_MS_HEADROOM = 1.5;

/**
 * Derives the successor-segment audio budget from one validated provider drain
 * timeout using a fixed 1.5× headroom and `Math.ceil`. The result is always a
 * positive safe integer; non-positive, non-finite, or overflowed inputs reject
 * before worker startup. This variable budget applies only while accumulating
 * successor audio—the segment-count and frame-count limits remain fixed.
 */
export function derivePendingAudioMsLimit(drainTimeoutMs: number): number {
  const limit = Math.ceil(drainTimeoutMs * PENDING_AUDIO_MS_HEADROOM);
  if (
    !Number.isFinite(drainTimeoutMs) ||
    drainTimeoutMs <= 0 ||
    !Number.isFinite(limit) ||
    !Number.isSafeInteger(limit)
  ) {
    throw new Error(
      'Invalid pending audio limit derived from STT drain timeout: expected a positive safe number of milliseconds',
    );
  }
  return limit;
}

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
 * overlapping summaries can't interleave frames. It captures the stream's
 * utterance id synchronously before starting `readAll()`, then supplies that same
 * id to `speak` and to `onSpeakError` for either reader or speak rejection; an
 * absent or invalid attribute remains `undefined`. `onSpeakError` rejection is
 * contained so every failed turn still resolves the private chain and later
 * turns recover without an unhandled rejection.
 *
 * `speakChain` is reassigned synchronously (no `await` before it), so turn order
 * tracks call order even when one turn's `readAll()` resolves before another's —
 * awaiting first would let a fast later call jump the queue. The immediate
 * rejection observer on `readAll()` remains necessary while a reader waits for
 * earlier serialized work.
 */
export function createSpeakHandler(deps: {
  speak: (text: string, utteranceId: number | undefined) => Promise<void>;
  onSpeakError: (
    err: unknown,
    utteranceId: number | undefined,
  ) => void | Promise<void>;
}): (
  reader: Pick<TextStreamReader, 'readAll'> & {
    info?: { attributes?: Record<string, string> };
  },
) => void {
  let speakChain: Promise<void> = Promise.resolve();
  return (reader) => {
    // Correlate this utterance with its later TTS status: the client stamps an id
    // on the stream attributes, and the worker echoes it on `tts_done`/`tts_error`
    // so the client can drop status for an utterance it already barged past.
    const utteranceId = parseUtteranceId(
      reader.info?.attributes?.[SPEAK_UTTERANCE_ID_ATTR],
    );
    const text = reader.readAll();
    // Reading starts immediately, but the chain may not reach `text` until
    // prior turns settle — attach a no-op handler now so a rejection in the
    // meantime is never reported as unhandled; the real handling still runs
    // below once the chain gets here.
    text.catch(() => {});
    speakChain = speakChain
      .then(() => text)
      .then((value) => deps.speak(value, utteranceId))
      .catch(async (err) => {
        try {
          await deps.onSpeakError(err, utteranceId);
        } catch {
          // Error reporting is best effort; recovery of the serialized chain is
          // the invariant, and reporting failures carry no additional signal.
        }
      });
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
 * no-ops. Parse failures invoke one fixed diagnostic callback per packet without
 * forwarding payloads or errors. A callback throw, rejection, or pending promise
 * is fire-and-observe and cannot escape or delay later controls.
 *
 * Cancellation is also fire-and-observe: synchronous throws and returned-promise
 * rejections reach `onCancelTtsError` exactly once, its own failure is contained,
 * and no cancellation or diagnostic promise is awaited. Production projects the
 * caught value into one fixed-category sanitized warning and never logs it raw.
 *
 * The fire-and-forget turn boundary always has an immediate rejection observer.
 * A synchronous `endTurn()` throw and an asynchronous boundary rejection are
 * normalized into exactly one internal callback. A callback synchronous throw or
 * returned-promise rejection is immediately observed and contained. Production
 * passes the caught value only to the privacy-safe diagnostic projector.
 *
 * Version-one controls negotiate a connection nonce before accepting positive
 * source ordinals. Duplicate/retired identities never advance the FIFO. Each
 * accepted boundary publishes one logical outcome, with at most the configured
 * drain budget for its result and five seconds for publication. Missing handlers,
 * cancelled turns and missing results are errors, never salvaged transcripts.
 * A new nonce drains any installed previous input before ACK; a failed drain
 * does not ACK. Support ACK alone does not imply a microphone handler exists.
 * Legacy callers without correlation fields retain their existing path.
 */
export function createTurnControlHandler(deps: {
  boundIdentity: string;
  /** Installs the result observer on the FIFO boundary; absent handler returns undefined. */
  endTurn: (
    result?: (value: SpeechTurnResult) => void,
  ) => Promise<void> | undefined;
  /** Optional version-one support; normal legacy controls do not negotiate. */
  correlation?: {
    /** Validated provider drain budget, independent of handler availability. */
    drainTimeoutMs: number;
    /** Reliable terminal/ACK handoff; failure is diagnostic, never a legacy retry. */
    publish: (packet: TurnCapabilityAck | TriggerTurnResult) => Promise<void>;
  };
  cancelTts: () => void | Promise<void>;
  onCancelTtsError: (error: unknown) => void | Promise<void>;
  onMalformed: () => void | Promise<void>;
  onTurnEndError: (error: unknown) => void | Promise<void>;
}): (
  payload: Uint8Array,
  participant: TurnControlParticipant,
  kind: unknown,
  topic: string | undefined,
) => void {
  let nonce: string | undefined;
  let lastTurnId = 0;
  let negotiation: Promise<void> | undefined;
  const retiredNonces = new Set<string>();
  /** Emits one malformed-control diagnostic without joining control ownership. */
  const reportMalformed = (): void => {
    try {
      Promise.resolve(deps.onMalformed()).catch(() => {});
    } catch {
      // Diagnostics are best effort and must not escape the room listener.
    }
  };

  /** Emits one sanitized cancellation failure without joining cancel ownership. */
  const reportCancelTtsError = (error: unknown): void => {
    try {
      Promise.resolve(deps.onCancelTtsError(error)).catch(() => {});
    } catch {
      // Diagnostics are best effort and must not escape the room listener.
    }
  };

  /** Delivers one boundary failure and observes either callback failure form. */
  const reportTurnEndError = (error: unknown): void => {
    try {
      Promise.resolve(deps.onTurnEndError(error)).catch(() => {});
    } catch {
      // Diagnostics are best effort; callback failure must not escape LiveKit's
      // fire-and-forget listener or create an unhandled rejection.
    }
  };
  const publish = (packet: TurnCapabilityAck | TriggerTurnResult): void => {
    const correlation = deps.correlation;
    if (!correlation) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(
        () => reject(new Error('Turn publication timeout')),
        5000,
      );
    });
    void Promise.race([
      Promise.resolve().then(() => correlation.publish(packet)),
      deadline,
    ])
      .catch(reportTurnEndError)
      .finally(() => clearTimeout(timer));
  };
  return (payload, participant, _kind, topic) => {
    if (topic !== TURN_TOPIC || participant?.identity !== deps.boundIdentity) {
      return;
    }
    if (payload.byteLength > 262_144) {
      reportMalformed();
      return;
    }

    let message: unknown;
    try {
      message = JSON.parse(new TextDecoder().decode(payload));
    } catch {
      reportMalformed();
      return;
    }
    if (!message || typeof message !== 'object' || !('type' in message)) {
      reportMalformed();
      return;
    }

    const type = (message as { type?: unknown }).type;
    const correlated =
      type === 'turn_capability' ||
      (type === 'turn_end' &&
        ('version' in message ||
          'nonce' in message ||
          'turnId' in message ||
          'cancelled' in message));
    if (correlated) {
      const packet = parseTriggerTurnPacket(payload);
      const correlation = deps.correlation;
      if (!packet || !correlation) {
        reportMalformed();
        return;
      }
      if (packet.type === 'turn_capability') {
        if (retiredNonces.has(packet.nonce)) return;
        if (nonce !== packet.nonce) {
          if (retiredNonces.size >= 128) return;
          if (nonce) retiredNonces.add(nonce);
          nonce = packet.nonce;
          lastTurnId = 0;
          try {
            negotiation = deps.endTurn();
          } catch (error) {
            negotiation = Promise.reject(error);
          }
          negotiation?.catch(reportTurnEndError);
        }
        const acknowledge = () => {
          if (nonce !== packet.nonce) return;
          negotiation = undefined;
          publish({
            ...packet,
            type: 'turn_capability_ack',
            drainTimeoutMs: correlation.drainTimeoutMs,
          });
        };
        if (negotiation) void negotiation.then(acknowledge, () => {});
        else acknowledge();
        return;
      }
      if (
        packet.type !== 'turn_end' ||
        packet.nonce !== nonce ||
        negotiation ||
        packet.turnId <= lastTurnId
      )
        return;
      lastTurnId = packet.turnId;
      let settled = false;
      const finish = (value: SpeechTurnResult): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        const outcome = packet.cancelled
          ? { outcome: 'error' as const, text: '' }
          : value;
        publish({
          type: 'turn_result',
          version: 1,
          nonce: packet.nonce,
          turnId: packet.turnId,
          ...outcome,
        });
      };
      const timer = setTimeout(
        () => finish({ outcome: 'error', text: '' }),
        Math.ceil(correlation.drainTimeoutMs),
      );
      try {
        const boundary = deps.endTurn(finish);
        if (!boundary) finish({ outcome: 'error', text: '' });
        else
          void boundary.then(
            () => finish({ outcome: 'error', text: '' }),
            (error) => {
              finish({ outcome: 'error', text: '' });
              reportTurnEndError(error);
            },
          );
      } catch (error) {
        finish({ outcome: 'error', text: '' });
        reportTurnEndError(error);
      }
      return;
    }
    if (type === 'turn_start') {
      reportMalformed();
    } else if (type === 'turn_end') {
      try {
        const boundary = deps.endTurn();
        boundary?.catch(reportTurnEndError).catch(() => {});
      } catch (error) {
        reportTurnEndError(error);
      }
    } else if (type === 'tts_cancel') {
      try {
        Promise.resolve(deps.cancelTts()).catch(reportCancelTtsError);
      } catch (error) {
        reportCancelTtsError(error);
      }
    } else {
      reportMalformed();
    }
  };
}

/**
 * Serializes subscribed microphone ownership for the expected user. The first
 * accepted audio track remains active until its processing promise settles;
 * overlapping tracks are ignored rather than creating a second STT boundary
 * authority. Foreign participants and non-audio tracks are silent no-ops. Both
 * synchronous and asynchronous processing failures are observed without
 * exposing raw error objects. The internal failure callback receives the caught
 * value once so production can pass it directly to the privacy-safe diagnostic
 * projector. Diagnostics are fire-and-observe rather than processing ownership:
 * a callback synchronous throw or returned-promise rejection is contained, but
 * a pending callback is never awaited and cannot delay active-track release.
 * This helper does not log independently, preventing duplicate outer and
 * processing-layer warnings.
 */
export function createSubscribedMicrophoneTrackHandler(deps: {
  expectedIdentity: string;
  processTrack: (track: RemoteTrack) => Promise<void>;
  onIgnoredTrack: () => void;
  onProcessingError: (error: unknown) => void | Promise<void>;
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
      .catch((error) => {
        try {
          Promise.resolve(deps.onProcessingError(error)).catch(() => {});
        } catch {
          // Diagnostics are best effort; callback failure must not poison track
          // ownership or become an unhandled terminal-chain rejection.
        }
      })
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

/** Final result of one FIFO boundary; errors exclude all salvaged partial text. */
export type SpeechTurnResult = Pick<TriggerTurnResult, 'outcome' | 'text'>;

/** Optional observer is bound synchronously before the FIFO begins draining. */
export type SpeechTurnEndHandler = (
  result?: (value: SpeechTurnResult) => void,
) => Promise<void>;

type SpeechTurn = {
  stream: stt.SpeechStream;
  consumeTask: Promise<void>;
  acceptsFinals: boolean;
  inputEnded: boolean;
  closed: boolean;
  text: string;
  tainted: boolean;
};

type SpeechRecognitionOptions = {
  audioStream: AsyncIterable<AudioFrame>;
  createSpeechStream: () => stt.SpeechStream;
  onFinalTranscript: (text: string) => void;
  onTurnEnd: () => void | Promise<void>;
  onTurnDrained: () => void | Promise<void>;
  /** Fixed provider drain deadline for each completed turn. */
  drainTimeoutMs: number;
  /** Derived successor-only audio cap; frame and segment limits stay fixed. */
  pendingAudioMsLimit: number;
  createDrainDeadline?: (timeoutMs: number) => DrainDeadline;
  /** Installs synchronously; `null` removal is fire-and-observe and once-only. */
  setEndTurnHandler: (handler: SpeechTurnEndHandler | null) => void;
};

const MAX_PENDING_SUCCESSOR_SEGMENTS = 4;
const MAX_PENDING_FRAMES_PER_SEGMENT = 500;
const MAX_PENDING_FRAMES_TOTAL = 2_000;

/**
 * Identifies a fail-closed speech-turn queue rejection without including audio,
 * frame metadata, transcript text, or other request-derived details. Its message
 * is exactly one of the five fixed queue-limit or invalid-metadata reasons;
 * repeated failures for an already-failed track generation are no-ops.
 */
export class SpeechTurnQueueOverflowError extends WorkerDiagnosticError {
  /** Creates a fail-closed queue error containing only its fixed reason. */
  constructor(reason: SpeechTurnQueueOverflowReason) {
    super(reason);
    this.name = 'SpeechTurnQueueOverflowError';
  }
}

type Boundary = {
  /** Observer belonging to this boundary, never a later successor. */
  result?: (value: SpeechTurnResult) => void;
  /** Rejection-observed completion exposed to the boundary caller. */
  promise: Promise<void>;
  /** Resolves the boundary's completion promise. */
  resolve: () => void;
  /** Rejects the boundary's completion promise with its terminal reason. */
  reject: (error: unknown) => void;
  /** Prevents duplicate resolution or rejection. */
  settled: boolean;
};

type SuccessorSegment = {
  /** Ordered frames retained for one future provider stream. */
  frames: AudioFrame[];
  /** Accumulated validated frame duration used by the derived audio cap. */
  audioMs: number;
  /** Distinct turn marker terminating this segment, when one has arrived. */
  boundary: Boundary | null;
};

/** Creates one immediately rejection-observed, settle-once turn boundary. */
function createBoundary(result?: (value: SpeechTurnResult) => void): Boundary {
  let resolvePromise!: () => void;
  let rejectPromise!: (error: unknown) => void;
  const promise = new Promise<void>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  promise.catch(() => {});
  return {
    result,
    promise,
    settled: false,
    resolve: resolvePromise,
    reject: rejectPromise,
  };
}

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
 * audio iterator. A boundary synchronously detaches the writable stream while
 * the frame pump retains bounded FIFO successor segments. Each segment owns its
 * ordered frames and distinct boundary promise. After the current provider
 * drains and closes, the coordinator creates one successor, replays only that
 * segment's frames, and then processes that segment's boundary before advancing.
 *
 * Each stream owns a final-transcript generation. Completion, timeout, failure,
 * or close retires that generation before aggregation completes, so a queued
 * event from the old consumer cannot enter the successor's buffer. Successful
 * drains emit all finals once; failed drains salvage only finals accepted before
 * ownership was retired. Empty turns emit nothing.
 *
 * Pending work is limited to four successor segments, 500 frames per segment,
 * 2,000 frames overall, and a per-segment audio budget derived once as 1.5× the
 * validated provider drain timeout. Only that audio budget scales with provider
 * drain configuration; segment and frame limits remain fixed. Invalid frame
 * timing metadata or any limit breach fails the track generation closed:
 * retained frames are released, every queued boundary rejects with a fixed-reason
 * `SpeechTurnQueueOverflowError`, the provider closes exactly once, and later
 * frames are no-ops until teardown. This is intentionally stricter than an
 * ordinary provider drain or close failure: that failure rejects the affected
 * boundary, releases queued successor frames and boundaries, and attempts to
 * install a clean provider stream for later audio. After fail-closed queue
 * rejection, later frames remain no-ops and direct repeated boundaries reject
 * with the retained fixed-reason error. Disposal releases queued frames and
 * resolvers before awaiting in-flight work, so teardown cannot create a
 * successor. Every internally started consumer and boundary has an immediate
 * rejection observer, including streams closed by timeout. If replay into a
 * successor throws, both the boundary being rotated and that shifted segment's
 * own boundary reject exactly once; the failed successor closes, later queued
 * segments are released, and clean-stream recovery is attempted. Post-drain
 * successor construction gets one immediate retry; if both attempts fail, the
 * coordinator rejects every retained boundary with a fixed application-owned
 * reason and exposes terminal failure to the track loop. A synchronous live
 * `pushFrame` failure instead retires that final-generation immediately, creates
 * exactly one replacement, and replays the current validated frame once. Failed
 * live replacement construction or replay uses the same visible terminal path;
 * unlike queued replay recovery, there is no affected turn boundary to reject
 * before preserving the current frame. These bounded policies differ from
 * queue-overflow fail-closed handling but never leave a live iterator without a
 * writable provider stream. The coordinator never logs
 * provider-consumer or teardown failures itself: the owning turn-end or outer
 * track-processing callback emits one privacy-safe warning, avoiding a duplicate
 * coordinator/outer report. Queue or terminal-failure notification is likewise
 * fire-and-observe: handler-removal is attempted once, but its throw, rejection,
 * or pending promise cannot interrupt mandatory cleanup or delay later-frame
 * no-ops.
 */
class SpeechTurnCoordinator {
  readonly #createSpeechStream: () => stt.SpeechStream;
  readonly #onFinalTranscript: (text: string) => void;
  readonly #onTurnEnd: () => void | Promise<void>;
  readonly #onTurnDrained: () => void | Promise<void>;
  readonly #drainTimeoutMs: number;
  /** Immutable successor-only cap derived before coordinator construction. */
  readonly #pendingAudioMsLimit: number;
  readonly #createDrainDeadline: (timeoutMs: number) => DrainDeadline;
  readonly #onQueueFailure: () => void | Promise<void>;
  #current: SpeechTurn | null = null;
  #drainingTurn: SpeechTurn | null = null;
  #activeBoundary: Boundary | null = null;
  #rotationTask: Promise<void> | null = null;
  #segments: SuccessorSegment[] = [];
  #pendingFramesTotal = 0;
  #queueFailure: SpeechTurnQueueOverflowError | null = null;
  readonly #terminalFailure: Promise<never>;
  readonly #rejectTerminalFailure: (error: unknown) => void;
  #terminalError: WorkerDiagnosticError | null = null;
  #disposed = false;

  /**
   * Creates one track-scoped coordinator and immediately opens its initial
   * provider stream. Queue-failure notification is best effort; stream factory
   * failure escapes construction before any frame or boundary is accepted.
   */
  constructor(
    createSpeechStream: () => stt.SpeechStream,
    onFinalTranscript: (text: string) => void,
    onTurnEnd: () => void | Promise<void>,
    onTurnDrained: () => void | Promise<void>,
    drainTimeoutMs: number,
    pendingAudioMsLimit: number,
    deadlineFactory: (timeoutMs: number) => DrainDeadline,
    onQueueFailure: () => void | Promise<void>,
  ) {
    this.#createSpeechStream = createSpeechStream;
    this.#onFinalTranscript = onFinalTranscript;
    this.#onTurnEnd = onTurnEnd;
    this.#onTurnDrained = onTurnDrained;
    this.#drainTimeoutMs = drainTimeoutMs;
    this.#pendingAudioMsLimit = pendingAudioMsLimit;
    this.#createDrainDeadline = deadlineFactory;
    this.#onQueueFailure = onQueueFailure;
    let rejectTerminalFailure!: (error: unknown) => void;
    this.#terminalFailure = new Promise<never>((_resolve, reject) => {
      rejectTerminalFailure = reject;
    });
    this.#terminalFailure.catch(() => {});
    this.#rejectTerminalFailure = rejectTerminalFailure;
    this.#current = this.#createTurn();
  }

  /** Rejects only when this track generation cannot create a usable successor. */
  get terminalFailure(): Promise<never> {
    return this.#terminalFailure;
  }

  pushFrame(frame: AudioFrame): void {
    if (this.#disposed || this.#queueFailure || this.#terminalError) return;
    const durationMs = this.#frameDurationMs(frame);
    if (durationMs === null) {
      this.#failQueue('invalid-frame-metadata');
      return;
    }
    if (this.#current) {
      const turn = this.#current;
      try {
        turn.stream.pushFrame(frame);
      } catch {
        this.#recoverLivePush(frame, turn);
      }
      return;
    }
    const segment = this.#openSegment();
    if (!segment) return;
    if (this.#pendingFramesTotal + 1 > MAX_PENDING_FRAMES_TOTAL) {
      this.#failQueue('total-frame-limit');
      return;
    }
    if (segment.frames.length + 1 > MAX_PENDING_FRAMES_PER_SEGMENT) {
      this.#failQueue('segment-frame-limit');
      return;
    }
    if (segment.audioMs + durationMs > this.#pendingAudioMsLimit) {
      this.#failQueue('segment-audio-limit');
      return;
    }
    segment.frames.push(frame);
    segment.audioMs += durationMs;
    this.#pendingFramesTotal++;
  }

  endTurn(result?: (value: SpeechTurnResult) => void): Promise<void> {
    if (this.#terminalError)
      return this.#rejectedBoundary(this.#terminalError, result);
    if (this.#queueFailure)
      return this.#rejectedBoundary(this.#queueFailure, result);
    if (this.#disposed)
      return result
        ? this.#rejectedBoundary(new Error('Speech turn disposed'), result)
        : Promise.resolve();

    if (this.#current) {
      const turn = this.#current;
      const boundary = createBoundary(result);
      this.#current = null;
      this.#activeBoundary = boundary;
      const rotationTask = this.#rotateQueued(turn, boundary);
      this.#rotationTask = rotationTask;
      rotationTask.catch(() => {});
      void rotationTask
        .finally(() => {
          if (this.#rotationTask === rotationTask) this.#rotationTask = null;
        })
        .catch(() => {});
      return boundary.promise;
    }

    if (!this.#rotationTask)
      return result
        ? this.#rejectedBoundary(new Error('Speech turn unavailable'), result)
        : Promise.resolve();

    const segment = this.#openSegment();
    if (!segment) {
      return this.#queueFailure
        ? this.#rejectedBoundary(this.#queueFailure, result)
        : Promise.resolve();
    }
    if (segment.boundary) {
      const next = this.#appendSegment();
      if (!next) {
        return this.#queueFailure
          ? this.#rejectedBoundary(this.#queueFailure, result)
          : Promise.resolve();
      }
      return this.#markBoundary(next, result);
    }
    return this.#markBoundary(segment, result);
  }

  async dispose(): Promise<void> {
    this.#disposed = true;
    this.#releaseSegments(new Error('Speech turn coordinator disposed'));
    if (this.#rotationTask) await this.#rotationTask;
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
      text: '',
      tainted: false,
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
      if (turn.acceptsFinals && text) {
        if (!turn.tainted) {
          turn.text = turn.text ? `${turn.text} ${text}` : text;
          if (new TextEncoder().encode(turn.text).byteLength > 250_000) {
            turn.tainted = true;
            turn.text = '';
          }
        }
        this.#onFinalTranscript(text);
      }
    }
  }

  async #rotateQueued(turn: SpeechTurn, boundary: Boundary): Promise<void> {
    let activeTurn = turn;
    let activeBoundary = boundary;
    while (true) {
      this.#drainingTurn = activeTurn;
      const failure = await this.#completeRotation(activeTurn);
      if (this.#drainingTurn === activeTurn) this.#drainingTurn = null;
      if (this.#queueFailure) return;
      if (failure !== undefined) {
        this.#releaseSegments(failure);
      }
      if (this.#disposed) {
        this.#settleBoundary(activeBoundary, failure);
        return;
      }

      const successor = this.#createPostDrainSuccessor();
      if (!successor) return;
      const segment =
        failure === undefined ? this.#segments.shift() : undefined;
      if (segment) {
        this.#pendingFramesTotal -= segment.frames.length;
        try {
          for (const frame of segment.frames) successor.stream.pushFrame(frame);
        } catch (error) {
          segment.frames.length = 0;
          this.#closeTurn(successor);
          if (segment.boundary) this.#settleBoundary(segment.boundary, error);
          this.#releaseSegments(error);
          this.#settleBoundary(activeBoundary, error);
          if (!this.#disposed) {
            try {
              this.#current = this.#createTurn();
            } catch {
              this.#current = null;
            }
          }
          return;
        }
        segment.frames.length = 0;
      }
      this.#current = successor;
      this.#settleBoundary(activeBoundary, failure, activeTurn);
      if (!segment?.boundary) return;

      activeTurn = successor;
      activeBoundary = segment.boundary;
      this.#activeBoundary = activeBoundary;
      this.#current = null;
    }
  }

  async #completeRotation(turn: SpeechTurn): Promise<unknown | undefined> {
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
    return failure;
  }

  #frameDurationMs(frame: AudioFrame): number | null {
    const { sampleRate, samplesPerChannel } = frame;
    if (
      !Number.isFinite(sampleRate) ||
      sampleRate <= 0 ||
      !Number.isFinite(samplesPerChannel) ||
      samplesPerChannel <= 0
    ) {
      return null;
    }
    const durationMs = (samplesPerChannel / sampleRate) * 1000;
    return Number.isFinite(durationMs) && durationMs > 0 ? durationMs : null;
  }

  #openSegment(): SuccessorSegment | null {
    const last = this.#segments.at(-1);
    if (last && !last.boundary) return last;
    return this.#appendSegment();
  }

  #appendSegment(): SuccessorSegment | null {
    if (this.#segments.length >= MAX_PENDING_SUCCESSOR_SEGMENTS) {
      this.#failQueue('successor-segment-limit');
      return null;
    }
    const segment: SuccessorSegment = {
      frames: [],
      audioMs: 0,
      boundary: null,
    };
    this.#segments.push(segment);
    return segment;
  }

  #markBoundary(
    segment: SuccessorSegment,
    result?: (value: SpeechTurnResult) => void,
  ): Promise<void> {
    const boundary = createBoundary(result);
    segment.boundary = boundary;
    return boundary.promise;
  }

  #failQueue(reason: SpeechTurnQueueOverflowReason): void {
    if (this.#queueFailure) return;
    const failure = new SpeechTurnQueueOverflowError(reason);
    this.#queueFailure = failure;
    this.#releaseSegments(failure);
    if (this.#activeBoundary)
      this.#settleBoundary(this.#activeBoundary, failure);
    const turn = this.#current;
    this.#current = null;
    if (turn) this.#closeTurn(turn);
    if (this.#drainingTurn) this.#closeTurn(this.#drainingTurn);
    try {
      Promise.resolve(this.#onQueueFailure()).catch(() => {});
    } catch {
      // Handler removal is best effort and cannot weaken fail-closed cleanup.
    }
  }

  /**
   * Creates a post-drain successor with one immediate retry. A successful retry
   * remains generation-scoped; repeated construction failure terminates the
   * generation through the fixed terminal channel without retaining provider
   * errors or queued audio.
   */
  #createPostDrainSuccessor(): SpeechTurn | null {
    try {
      return this.#createTurn();
    } catch {
      if (this.#disposed || this.#queueFailure || this.#terminalError)
        return null;
    }

    try {
      const successor = this.#createTurn();
      if (this.#disposed || this.#queueFailure || this.#terminalError) {
        this.#closeTurn(successor);
        return null;
      }
      return successor;
    } catch {
      this.#failTerminal();
      return null;
    }
  }

  /**
   * Retires a live stream whose synchronous push failed, creates exactly one
   * replacement, and replays the already-validated current frame exactly once.
   * Construction or replay failure closes every created stream and enters the
   * shared visible terminal path; it never retries indefinitely or retains raw
   * provider/frame data. Retiring the old final-generation before replacement
   * also fences late finals from crossing into the new turn. A stale or already
   * terminal invocation is a no-op; if generation ownership changes during the
   * synchronous replacement attempt, the replacement closes without installing.
   */
  #recoverLivePush(frame: AudioFrame, failedTurn: SpeechTurn): void {
    if (this.#current !== failedTurn || this.#terminalError) return;
    this.#current = null;
    this.#closeTurn(failedTurn);

    let replacement: SpeechTurn;
    try {
      replacement = this.#createTurn();
    } catch {
      this.#failTerminal();
      return;
    }

    try {
      replacement.stream.pushFrame(frame);
    } catch {
      this.#closeTurn(replacement);
      this.#failTerminal();
      return;
    }

    if (this.#disposed || this.#queueFailure || this.#terminalError) {
      this.#closeTurn(replacement);
      return;
    }
    this.#current = replacement;
    replacement.tainted = true;
  }

  /** Performs idempotent terminal cleanup after bounded construction recovery. */
  #failTerminal(): void {
    if (this.#terminalError) return;
    const failure = new WorkerDiagnosticError('stt-successor-creation-failed');
    this.#terminalError = failure;
    this.#releaseSegments(failure);
    if (this.#activeBoundary)
      this.#settleBoundary(this.#activeBoundary, failure);
    const turn = this.#current;
    this.#current = null;
    if (turn) this.#closeTurn(turn);
    if (this.#drainingTurn) this.#closeTurn(this.#drainingTurn);
    try {
      Promise.resolve(this.#onQueueFailure()).catch(() => {});
    } catch {
      // Handler removal is best effort and cannot weaken terminal cleanup.
    }
    this.#rejectTerminalFailure(failure);
  }

  #releaseSegments(error: unknown): void {
    for (const segment of this.#segments) {
      segment.frames.length = 0;
      if (segment.boundary) this.#settleBoundary(segment.boundary, error);
    }
    this.#segments.length = 0;
    this.#pendingFramesTotal = 0;
  }

  #settleBoundary(
    boundary: Boundary,
    error?: unknown,
    turn?: SpeechTurn,
  ): void {
    if (boundary.settled) return;
    boundary.settled = true;
    if (this.#activeBoundary === boundary) this.#activeBoundary = null;
    const result: SpeechTurnResult =
      error !== undefined || this.#disposed || !turn || turn.tainted
        ? { outcome: 'error', text: '' }
        : { outcome: turn.text ? 'success' : 'empty', text: turn.text };
    try {
      Promise.resolve(boundary.result?.(result)).catch(() => {});
    } catch {
      // Observation cannot hold or advance FIFO ownership.
    }
    if (error === undefined) boundary.resolve();
    else boundary.reject(error);
  }

  #rejectedBoundary(
    error: unknown,
    result?: (value: SpeechTurnResult) => void,
  ): Promise<void> {
    const boundary = createBoundary(result);
    this.#settleBoundary(boundary, error);
    return boundary.promise;
  }

  #closeTurn(turn: SpeechTurn): void {
    turn.acceptsFinals = false;
    if (turn.closed) return;
    turn.closed = true;
    turn.stream.close();
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
        throw new WorkerDiagnosticError('stt-provider-drain-timeout');
      }
    } finally {
      deadline?.cancel();
      this.#closeTurn(turn);
    }
  }
}

/**
 * Consumes one LiveKit audio stream for a subscribed track while delegating each
 * accepted voice turn to a distinct Deepgram stream. The installed turn handler
 * is asynchronous because it represents the full end-input, provider-drain,
 * close, and successor-install sequence; callers must observe its rejection.
 *
 * Frames yielded while a provider drains are retained in bounded FIFO successor
 * segments. Their audio cap is supplied once from the validated drain timeout;
 * unlike that derived cap, segment and frame-count limits remain fixed. Every
 * accepted `turn_end` remains a distinct marker; protocol deduplication belongs
 * to the room listener. Each marker settles after its own segment is replayed,
 * ended, drained, and closed. Queue overflow or invalid frame timing metadata
 * fails the track generation closed, removes its turn handler, releases queued
 * successors, and discards all later frames as no-ops until teardown. In
 * contrast, an ordinary provider drain or close failure rejects the affected
 * boundary, releases queued successors, and attempts clean-stream recovery for
 * later audio. Teardown releases queues and boundaries without creating another
 * provider; later failed-generation frames and repeated teardown are no-ops.
 * Post-drain construction retries once, then races a fixed terminal failure
 * against the pending audio iterator so an exhausted generation rejects even
 * when no later frame arrives. Abrupt exit initiates `iterator.return()` before
 * awaiting coordinator disposal and observes both that cancellation and the
 * still-pending `next()` independently without waiting for either. Their late
 * settlement cannot feed the disposed coordinator or escape as an unhandled
 * rejection. Normal EOF does not invoke cancellation; iterator errors retain
 * their original rejection semantics. Terminal cleanup and the `finally` path
 * share idempotent handler removal and stream closure ownership. Removal is
 * fire-and-observe: a throw, rejection, or pending promise cannot replace the
 * track outcome or delay coordinator disposal. Initial handler installation
 * remains synchronous and is not part of that best-effort cleanup contract.
 * An optional result observer belongs to the FIFO boundary before draining
 * starts. It receives successful whole text or an explicit empty/error terminal;
 * unlike legacy aggregation, failed or recovered streams never salvage text
 * into a successful correlated result. Disposal and released successors also
 * report errors. Observers cannot block rotation and are called at most once.
 */
export async function runSpeechRecognition(
  opts: SpeechRecognitionOptions,
): Promise<void> {
  let endTurnHandlerInstalled = false;
  const removeEndTurnHandler = () => {
    if (!endTurnHandlerInstalled) return;
    endTurnHandlerInstalled = false;
    try {
      Promise.resolve(opts.setEndTurnHandler(null)).catch(() => {});
    } catch {
      // Handler removal is best effort and cannot mask the track outcome.
    }
  };
  const coordinator = new SpeechTurnCoordinator(
    opts.createSpeechStream,
    opts.onFinalTranscript,
    opts.onTurnEnd,
    opts.onTurnDrained,
    opts.drainTimeoutMs,
    opts.pendingAudioMsLimit,
    opts.createDrainDeadline ?? createDrainDeadline,
    removeEndTurnHandler,
  );
  const endTurn: SpeechTurnEndHandler = (result) => coordinator.endTurn(result);
  opts.setEndTurnHandler(endTurn);
  endTurnHandlerInstalled = true;
  const iterator = opts.audioStream[Symbol.asyncIterator]();
  let pendingNext: Promise<IteratorResult<AudioFrame>> | null = null;
  try {
    while (true) {
      pendingNext = Promise.resolve().then(() => iterator.next());
      pendingNext.catch(() => {});
      const next = await Promise.race([
        pendingNext,
        coordinator.terminalFailure,
      ]);
      pendingNext = null;
      if (next.done) break;
      coordinator.pushFrame(next.value);
    }
  } finally {
    removeEndTurnHandler();
    if (pendingNext) {
      pendingNext.catch(() => {});
      try {
        Promise.resolve(iterator.return?.()).catch(() => {});
      } catch {
        // Iterator cancellation is best effort; pending next remains observed.
      }
    }
    await coordinator.dispose();
  }
}
