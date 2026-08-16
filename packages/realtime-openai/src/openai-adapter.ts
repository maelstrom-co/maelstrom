import type { Unsubscribe, VoiceSessionState } from '@maelstrom-co/client';
import { Logger } from '@maelstrom-co/client';
import type { MessageId, ToolCallId } from '@maelstrom-co/protocol';
import type {
  AdapterAudioStreams,
  AdapterConnectOptions,
  GreetingSpeechResult,
  RealtimeAdapterEvent,
  RealtimeGreetingAdapter,
  RealtimeProviderAdapter,
  RealtimeToolSpec,
  ToolResult,
} from '@maelstrom-co/realtime';
import { ConnectRaceGuard, RealtimeVoiceError } from '@maelstrom-co/realtime';
import type {
  OpenAIBuiltInVoice,
  OpenAITokenGrant,
} from '@maelstrom-co/realtime-protocol/openai';
import type {
  OpenAIAdapterOptions,
  SynthesizeGreeting,
} from './openai-adapter.types.js';
import {
  asString,
  isRecord,
  parseOpenAIServerEvent,
} from './parse-openai-event.js';
import {
  createUnexpectedEventTracker,
  type UnexpectedEventTracker,
} from './unexpected-event-tracker.js';
import { deriveVoiceActivity } from './voice-activity.js';
import {
  raceAbortSignal,
  WebAudioGreetingPlayer,
} from './web-audio-greeting-player.js';

const REALTIME_CALLS_URL = 'https://api.openai.com/v1/realtime/calls';

/** Stable id for the single latest-wins grounding context item. */
const GROUNDING_ITEM_ID = 'maelstrom-grounding';

// ICE `disconnected` is often transient and self-recovers, so it is tolerated
// for this long before being treated as a fatal connection failure.
const ICE_DISCONNECT_GRACE_MS = 5000;

const DEFAULT_TRANSCRIPTION_MODEL = 'gpt-4o-mini-transcribe';

const AUDIO_PROCESSING_PREFERENCES = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
} as const;

const UNAVAILABLE_AUDIO_PROCESSING_SETTINGS = {
  echoCancellation: 'unavailable',
  noiseSuppression: 'unavailable',
  autoGainControl: 'unavailable',
} as const;

/**
 * Projects only applied AEC/NS/AGC booleans from the original audio track.
 * Missing, throwing, malformed, and non-boolean settings become `unavailable`;
 * each browser-owned field is snapshotted exactly once before boolean
 * validation, so changing accessors cannot substitute later values. The result
 * never retains device metadata from the browser settings object.
 */
function audioProcessingSettings(track: MediaStreamTrack | undefined) {
  let getSettings: unknown;
  try {
    getSettings = (
      track as { getSettings?: () => MediaTrackSettings } | undefined
    )?.getSettings;
  } catch {
    return UNAVAILABLE_AUDIO_PROCESSING_SETTINGS;
  }
  if (typeof getSettings !== 'function') {
    return UNAVAILABLE_AUDIO_PROCESSING_SETTINGS;
  }

  let settings: unknown;
  try {
    settings = Reflect.apply(getSettings, track, []);
  } catch {
    return UNAVAILABLE_AUDIO_PROCESSING_SETTINGS;
  }

  if (typeof settings !== 'object' || settings === null) {
    return UNAVAILABLE_AUDIO_PROCESSING_SETTINGS;
  }

  const booleanSetting = (
    key: 'echoCancellation' | 'noiseSuppression' | 'autoGainControl',
  ): boolean | 'unavailable' => {
    let value: unknown;
    try {
      value = Reflect.get(settings, key);
    } catch {
      return 'unavailable';
    }
    return typeof value === 'boolean' ? value : 'unavailable';
  };

  return {
    echoCancellation: booleanSetting('echoCancellation'),
    noiseSuppression: booleanSetting('noiseSuppression'),
    autoGainControl: booleanSetting('autoGainControl'),
  } as const;
}

const DEFAULT_OUTPUT_VOICE: OpenAIBuiltInVoice = 'marin';
const DEFAULT_SERVER_VAD_THRESHOLD = 0.5;
const DEFAULT_BARGE_IN_MODE = 'immediate';

type OutputActivity = 'not-started' | 'active' | 'stopped' | 'cleared';
type CompletedTranscript = 'unseen' | 'useful' | 'empty';

interface ResponseInFlight {
  readonly responseId?: string;
}

interface GreetingMicrophoneGate {
  readonly operation: AbortController;
  readonly connectionGeneration: number;
  readonly tracks: readonly {
    readonly track: MediaStreamTrack;
    readonly previousEnabled: boolean;
  }[];
}

interface InterruptionLedgerEntry {
  interruptionEvaluated: boolean;
  committed: boolean;
  completedTranscript: CompletedTranscript;
  responseCreateQueued: boolean;
  responseCreateSent: boolean;
  responseCancelAttempted: boolean;
  outputClearPending: boolean;
  standaloneOutputClearAttempted: boolean;
}

function createInterruptionLedgerEntry(): InterruptionLedgerEntry {
  return {
    interruptionEvaluated: false,
    committed: false,
    completedTranscript: 'unseen',
    responseCreateQueued: false,
    responseCreateSent: false,
    responseCancelAttempted: false,
    outputClearPending: false,
    standaloneOutputClearAttempted: false,
  };
}

function toOpenAITool(spec: RealtimeToolSpec): unknown {
  return {
    type: 'function',
    name: spec.name,
    description: spec.description,
    parameters: spec.parametersJsonSchema,
  };
}

/**
 * A {@link RealtimeProviderAdapter} that connects the browser directly to
 * OpenAI `gpt-realtime` over WebRTC: mints an ephemeral client secret via the
 * injected `mintToken`, exchanges SDP with `POST /v1/realtime/calls`, and
 * drives tool calls / grounding pushes over the `oai-events` data channel.
 *
 * The data-channel envelope → adapter-event mapping lives in
 * {@link parseOpenAIServerEvent}; this class owns the provider-specific WebRTC,
 * response lifecycle, and transcript-confirmed interruption bookkeeping around
 * that mapping. The browser's WebRTC implementation itself is not unit-tested.
 *
 * @example
 * ```ts
 * const adapter = new OpenAIAdapter({
 *   mintToken: () => fetch('/api/realtime/mint', { method: 'POST', ... }).then(r => r.json()),
 * });
 * const session = new RealtimeSession({ adapter, instance, sessionId });
 * await session.connect();
 * ```
 */
export class OpenAIAdapter
  implements RealtimeProviderAdapter, RealtimeGreetingAdapter
{
  readonly #mintToken: () => Promise<OpenAITokenGrant>;
  readonly #logger: Logger;
  readonly #transcription: false | { readonly model?: string } | undefined;
  readonly #serverVadThreshold: number;
  readonly #bargeInMode: 'immediate' | 'transcript-confirmed';
  readonly #voice: OpenAIBuiltInVoice;
  readonly #synthesizeGreeting: SynthesizeGreeting | undefined;
  readonly #greetingPlayer = new WebAudioGreetingPlayer();
  readonly #handlers = new Set<(event: RealtimeAdapterEvent) => void>();

  #pc: RTCPeerConnection | undefined;
  #dc: RTCDataChannel | undefined;
  #micStream: MediaStream | undefined;
  #playbackStream: MediaStream | undefined;
  #audioEl: HTMLAudioElement | undefined;
  #groundingItemExists = false;
  // Guards the window between connect() being called and `#pc` being
  // assigned — `mintToken()` is the first await, so without this a second
  // connect() during that round-trip would pass the `#pc` check too and leak
  // its own RTCPeerConnection + mic stream.
  #connecting = false;
  // Detects, once each in-flight connect() await (mint, getUserMedia, SDP)
  // resumes, that a newer connect()/teardown overtook it — so the stale attempt
  // aborts instead of clobbering the winner's shared state.
  readonly #connectGuard = new ConnectRaceGuard();
  #iceGraceTimer: ReturnType<typeof setTimeout> | undefined;
  #responseInFlight: ResponseInFlight | undefined;
  #toolFollowUpPending = false;
  // Re-entrant provider events cannot drain a newly eligible response while a
  // cancel-derived output clear is still being sent or awaited.
  #responseCreateDrainBlockDepth = 0;
  #responseCreateDrainDeferred = false;
  readonly #validatedTurnQueue: string[] = [];
  readonly #settledResponseIds = new Set<string>();
  #voiceActivity: VoiceSessionState = 'connected';
  #unexpectedEvents: UnexpectedEventTracker = createUnexpectedEventTracker();
  #connectionGeneration = 0;
  readonly #interruptionLedger = new Map<string, InterruptionLedgerEntry>();
  #activeResponseId: string | undefined;
  #outputActivity: OutputActivity = 'not-started';
  /** Operation-scoped controller for in-flight greeting synthesis/playback. */
  #greetingOp: AbortController | undefined;
  #greetingMicrophoneGate: GreetingMicrophoneGate | undefined;

  constructor(options: OpenAIAdapterOptions) {
    const serverVadThreshold =
      options.serverVad?.threshold ?? DEFAULT_SERVER_VAD_THRESHOLD;
    if (
      !Number.isFinite(serverVadThreshold) ||
      serverVadThreshold < 0 ||
      serverVadThreshold > 1
    ) {
      throw new TypeError(
        'OpenAIAdapter serverVad.threshold must be a finite number between 0 and 1',
      );
    }
    const bargeInMode = options.serverVad?.bargeInMode ?? DEFAULT_BARGE_IN_MODE;
    if (
      bargeInMode === 'transcript-confirmed' &&
      options.transcription === false
    ) {
      throw new TypeError(
        'OpenAIAdapter transcript-confirmed barge-in requires input transcription',
      );
    }

    this.#mintToken = options.mintToken;
    this.#transcription = options.transcription;
    this.#serverVadThreshold = serverVadThreshold;
    this.#bargeInMode = bargeInMode;
    this.#voice = options.voice ?? DEFAULT_OUTPUT_VOICE;
    this.#synthesizeGreeting = options.synthesizeGreeting;
    this.#logger = new Logger(options.debug ?? false, 'OpenAIAdapter');
  }

  /**
   * Mints a token, captures the microphone, and opens the browser-to-OpenAI
   * WebRTC session. Capture requests AEC, noise suppression, and automatic gain
   * control as best-effort browser preferences; it does not promise that a
   * browser, device, or audio route applies them. After acquisition is confirmed
   * as current, enabled debug logging projects only applied booleans (or
   * `unavailable`) from the original track before attachment. Superseded
   * acquisitions are stopped without attachment or diagnostics, and missing or
   * throwing settings APIs do not fail connection.
   *
   * Duplicate connections are rejected. Token, microphone, and SDP failures
   * reject after this attempt's resources are released. Unlike LiveKit, OpenAI
   * owns turn detection and has no local VAD clone or publication gate.
   */
  async connect(opts: AdapterConnectOptions): Promise<void> {
    if (this.#pc || this.#connecting) {
      throw new RealtimeVoiceError(
        'ALREADY_CONNECTED',
        'OpenAI realtime adapter is already connected',
      );
    }
    this.#connecting = true;
    const attempt = this.#connectGuard.begin();
    // Captured by the data channel's onopen closure below so a slow ICE/DTLS
    // establishment (the gap between SDP exchange and channel open) is
    // attributable rather than folded into an opaque "connect() was slow".
    const connectStart = Date.now();

    // Attempt-local handles: shared `#pc`/`#micStream` are only published once
    // the post-getUserMedia current-check passes, so a superseded attempt can
    // abandon exactly its own connection + mic without touching the winner's.
    let connection: RTCPeerConnection | undefined;
    let micStream: MediaStream | undefined;
    try {
      let token: OpenAITokenGrant;
      try {
        token = await this.#mintToken();
      } catch (error) {
        throw new RealtimeVoiceError(
          'TOKEN_MINT_FAILED',
          'Failed to mint an ephemeral realtime token',
          error,
        );
      }
      attempt.assertCurrent();
      this.#logger.debug('connect timing', {
        step: 'mint',
        ms: Date.now() - connectStart,
      });

      connection = new RTCPeerConnection();

      micStream = await this.#acquireMicrophone();
      attempt.assertCurrent();
      this.#logger.debug('connect timing', {
        step: 'getUserMedia',
        ms: Date.now() - connectStart,
      });
      if (this.#logger.isEnabled) {
        this.#logger.debug('microphone audio processing', {
          audioProcessing: {
            requested: AUDIO_PROCESSING_PREFERENCES,
            applied: audioProcessingSettings(micStream.getAudioTracks()[0]),
          },
        });
      }
      for (const track of micStream.getTracks()) {
        connection.addTrack(track, micStream);
      }

      // Past the post-getUserMedia check — this attempt is still current, so
      // publishing to the shared fields is safe.
      this.#startConnectionGeneration();
      this.#pc = connection;
      this.#micStream = micStream;
      this.#connecting = false;
      this.#wireConnectionEvents(connection);
      const dataChannelReady = this.#openDataChannel(
        connection,
        opts,
        connectStart,
      );

      const [, channel] = await Promise.all([
        this.#exchangeSdp(connection, token, connectStart),
        dataChannelReady,
      ]);
      attempt.assertCurrent();
      if (
        channel !== this.#dc ||
        connection !== this.#pc ||
        channel.readyState !== 'open'
      ) {
        throw new RealtimeVoiceError(
          'DATA_CHANNEL_ERROR',
          'OpenAI realtime data channel closed during connection setup',
        );
      }
    } catch (error) {
      // Always close this attempt's own connection + mic. They may never have
      // reached the shared fields (e.g. a failure before the post-getUserMedia
      // publish), in which case teardown() alone wouldn't clean them up.
      this.#closeAbandonedAttempt(connection, micStream);
      // Teardown may close a still-opening data channel, whose local readiness
      // promise rejects with DATA_CHANNEL_ERROR. Preserve the adapter-wide
      // contract that an overtaken connect always rejects CONNECT_SUPERSEDED.
      if (!attempt.isCurrent) attempt.assertCurrent();
      if (attempt.isCurrent) {
        // Still the current attempt — a genuine handshake failure. Reset the
        // rest of the shared session state (data channel, audio element,
        // lifecycle) so a retry starts clean. A superseded attempt skips this
        // so it never clobbers the winner's state.
        this.#teardown();
      }
      throw error;
    }
  }

  // Closes only the passed attempt's own resources — never the shared
  // `#pc`/`#micStream`, which by the time this runs belong to the winner.
  #closeAbandonedAttempt(
    connection: RTCPeerConnection | undefined,
    micStream: MediaStream | undefined,
  ): void {
    micStream?.getTracks().forEach((track) => {
      track.stop();
    });
    if (connection) {
      for (const sender of connection.getSenders()) {
        sender.track?.stop();
      }
      connection.close();
    }
  }

  async disconnect(): Promise<void> {
    this.#teardown();
  }

  getAudioStreams(): AdapterAudioStreams {
    return { mic: this.#micStream, playback: this.#playbackStream };
  }

  async sendToolResult(callId: ToolCallId, output: ToolResult): Promise<void> {
    this.#logger.debug('→ sendToolResult', { callId, output });
    if (!this.#dc || this.#dc.readyState !== 'open') {
      this.#emit({
        type: 'error',
        error: new Error(
          `sendToolResult: data channel not open (callId=${callId})`,
        ),
      });
      return;
    }
    try {
      this.#dc.send(
        JSON.stringify({
          type: 'conversation.item.create',
          item: {
            type: 'function_call_output',
            call_id: callId,
            output: JSON.stringify(output),
          },
        }),
      );
      this.#requestToolFollowUp();
    } catch (error) {
      this.#emit({ type: 'error', error });
    }
  }

  injectGrounding(text: string): void {
    // Droppable, unlike sendToolResult above: grounding is latest-wins
    // sidechannel context, so a push landing on a closed channel (e.g.
    // mid-handshake) is a benign race — the next settle re-pushes fresher
    // state anyway. A lost tool result, by contrast, wedges the model
    // conversation and must surface as an error.
    if (!this.#dc || this.#dc.readyState !== 'open') {
      this.#logger.debug('injectGrounding: data channel not open, dropping');
      return;
    }
    try {
      if (this.#groundingItemExists) {
        this.#dc.send(
          JSON.stringify({
            type: 'conversation.item.delete',
            item_id: GROUNDING_ITEM_ID,
          }),
        );
      }
      this.#dc.send(
        JSON.stringify({
          type: 'conversation.item.create',
          item: {
            id: GROUNDING_ITEM_ID,
            type: 'message',
            role: 'system',
            content: [{ type: 'input_text', text }],
          },
        }),
      );
      this.#groundingItemExists = true;
    } catch (error) {
      this.#emit({ type: 'error', error });
    }
  }

  on(handler: (event: RealtimeAdapterEvent) => void): Unsubscribe {
    this.#handlers.add(handler);
    return () => {
      this.#handlers.delete(handler);
    };
  }

  /**
   * Unlock greeting audio synchronously within the initiating user gesture.
   * Must never throw. Failures surface later as `not_started` from
   * {@link speakAssistantText}. Only activates when a synthesizer is configured.
   */
  activateAudio(): void {
    try {
      if (this.#synthesizeGreeting === undefined) return;
      this.#greetingPlayer.activate();
    } catch {
      // Never throw from the gesture path; readiness fails later.
    }
  }

  /**
   * Speak the exact configured greeting text once the coordinator hands off.
   * Sends provider history first, then synthesizes and plays WAV bytes without
   * waiting for any provider acknowledgement. During decode and playback, each
   * current microphone audio track is disabled (sending silence, not ending the
   * track) and then restored to its prior value. Never issues `response.create`.
   *
   * Pre-send failures return `not_started`. Once the send call returns,
   * every later outcome settles as `accepted`.
   */
  async speakAssistantText(args: {
    readonly id: MessageId;
    readonly text: string;
    readonly signal: AbortSignal;
  }): Promise<GreetingSpeechResult> {
    if (!this.#dc || this.#dc.readyState !== 'open') return 'not_started';
    if (this.#synthesizeGreeting === undefined) return 'not_started';
    if (args.signal.aborted) return 'not_started';

    const readiness = await this.#greetingPlayer.ensureReady(args.signal);
    if (!readiness.ok) return 'not_started';
    // Re-check channel after the readiness await — disconnect may have raced.
    if (!this.#dc || this.#dc.readyState !== 'open') return 'not_started';
    if (args.signal.aborted) return 'not_started';

    const { text } = args;
    const synthesize = this.#synthesizeGreeting;

    try {
      this.#dc.send(
        JSON.stringify({
          type: 'conversation.item.create',
          item: {
            // Engine message IDs can exceed OpenAI's 32-character item-ID limit.
            type: 'message',
            role: 'assistant',
            status: 'completed',
            content: [{ type: 'output_text', text }],
          },
        }),
      );
    } catch {
      // No delivery began — the only retriable outcome after readiness.
      return 'not_started';
    }

    // Send succeeded: every later outcome is terminal `accepted`.
    this.#abortGreetingPlayback();
    const op = new AbortController();
    this.#greetingOp = op;
    let microphoneGate: GreetingMicrophoneGate | undefined;
    const onCallerAbort = (): void => {
      op.abort();
    };
    if (args.signal.aborted) {
      op.abort();
    } else {
      args.signal.addEventListener('abort', onCallerAbort, { once: true });
    }

    try {
      // Race the synthesizer against abort so an uncooperative pending fetch
      // cannot hang the adapter (or the coordinator's speech-in-flight) after
      // disconnect/abort. Late synth settlement is observed inside the race.
      const synthRace = await raceAbortSignal(
        synthesize({
          text,
          voice: this.#voice,
          signal: op.signal,
        }),
        op.signal,
      );
      if (synthRace.status === 'aborted') return 'accepted';
      if (op.signal.aborted) return 'accepted';
      microphoneGate = this.#createGreetingMicrophoneGate(op);
      for (const { track } of microphoneGate.tracks) track.enabled = false;
      await this.#greetingPlayer.play(synthRace.value, op.signal);
    } catch (error) {
      // Synthesis/decode/playback failure after send — still accepted.
      this.#logger.debug('greeting synthesis or playback failed', error);
    } finally {
      args.signal.removeEventListener('abort', onCallerAbort);
      this.#settleGreetingOperation(op, microphoneGate);
    }
    return 'accepted';
  }

  #wireConnectionEvents(connection: RTCPeerConnection): void {
    const audio = new Audio();
    audio.autoplay = true;
    this.#audioEl = audio;
    connection.ontrack = (event) => {
      // Ignore events from a superseded/abandoned connection — only the
      // current shared `#pc` may drive playback.
      if (connection !== this.#pc) return;
      this.#playbackStream = event.streams[0];
      audio.srcObject = event.streams[0] ?? null;
    };
    connection.oniceconnectionstatechange = () => {
      // Ignore events from a superseded/abandoned connection.
      if (connection !== this.#pc) return;
      const state = connection.iceConnectionState;
      if (state === 'failed') {
        // `failed` is terminal — ICE has exhausted its own recovery.
        this.#clearIceGraceTimer();
        this.#emit({
          type: 'error',
          error: new RealtimeVoiceError(
            'CONNECTION_FAILED',
            'ICE connection failed',
          ),
        });
        return;
      }
      if (state === 'disconnected') {
        // Often transient and self-recovering — open a grace window rather
        // than failing immediately; a recovery to connected/completed below
        // cancels it, and teardown() clears it so it never fires afterwards.
        if (this.#iceGraceTimer === undefined) {
          this.#iceGraceTimer = setTimeout(() => {
            this.#iceGraceTimer = undefined;
            if (connection !== this.#pc) return;
            this.#emit({
              type: 'error',
              error: new RealtimeVoiceError(
                'CONNECTION_FAILED',
                'ICE connection disconnected',
              ),
            });
          }, ICE_DISCONNECT_GRACE_MS);
        }
        return;
      }
      if (state === 'connected' || state === 'completed') {
        this.#clearIceGraceTimer();
      }
    };
  }

  #clearIceGraceTimer(): void {
    if (this.#iceGraceTimer !== undefined) {
      clearTimeout(this.#iceGraceTimer);
      this.#iceGraceTimer = undefined;
    }
  }

  /**
   * Acquires a microphone with non-mandatory browser processing preferences.
   * The stream remains unattached and unlogged until `connect()` confirms that
   * this acquisition still belongs to the current connection attempt.
   */
  async #acquireMicrophone(): Promise<MediaStream> {
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: AUDIO_PROCESSING_PREFERENCES,
      });
    } catch (error) {
      const name = (error as { name?: unknown } | null)?.name;
      throw name === 'NotAllowedError' || name === 'PermissionDeniedError'
        ? new RealtimeVoiceError(
            'MIC_PERMISSION_DENIED',
            'Microphone permission was denied',
            error,
          )
        : new RealtimeVoiceError(
            'CONNECTION_FAILED',
            'Failed to acquire the microphone',
            error,
          );
    }
    return stream;
  }

  #openDataChannel(
    connection: RTCPeerConnection,
    opts: AdapterConnectOptions,
    connectStart: number,
  ): Promise<RTCDataChannel> {
    const channel = connection.createDataChannel('oai-events');
    const generation = this.#connectionGeneration;
    this.#dc = channel;
    channel.onmessage = (event: MessageEvent) => {
      if (channel !== this.#dc || generation !== this.#connectionGeneration)
        return;
      this.#handleDataChannelMessage(event.data as unknown, generation);
    };
    return new Promise<RTCDataChannel>((resolve, reject) => {
      let settled = false;
      let opened = false;
      channel.onopen = () => {
        if (settled) return;
        if (channel !== this.#dc || connection !== this.#pc) {
          settled = true;
          reject(
            new RealtimeVoiceError(
              'CONNECT_SUPERSEDED',
              'connect() was superseded before the data channel opened',
            ),
          );
          return;
        }
        this.#logger.debug('connect timing', {
          step: 'dataChannelOpen',
          ms: Date.now() - connectStart,
        });
        const sessionUpdate = {
          type: 'session.update',
          session: {
            type: 'realtime',
            tools: opts.tools.map(toOpenAITool),
            instructions: opts.instructions,
            ...this.#audioConfig(),
          },
        };
        this.#logger.debug('→ session.update', sessionUpdate);
        try {
          channel.send(JSON.stringify(sessionUpdate));
          opened = true;
          settled = true;
          resolve(channel);
        } catch (cause) {
          settled = true;
          reject(
            new RealtimeVoiceError(
              'DATA_CHANNEL_ERROR',
              'Failed to configure the OpenAI realtime data channel',
              cause,
            ),
          );
        }
      };
      channel.onerror = () => {
        const error = new RealtimeVoiceError(
          'DATA_CHANNEL_ERROR',
          'OpenAI realtime data channel error',
        );
        if (!settled) {
          settled = true;
          reject(error);
          return;
        }
        if (!opened) return;
        if (channel !== this.#dc) return;
        this.#emit({ type: 'error', error });
      };
      channel.onclose = () => {
        if (settled) return;
        settled = true;
        reject(
          new RealtimeVoiceError(
            'DATA_CHANNEL_ERROR',
            'OpenAI realtime data channel closed before opening',
          ),
        );
      };
    });
  }

  async #exchangeSdp(
    connection: RTCPeerConnection,
    token: OpenAITokenGrant,
    connectStart: number,
  ): Promise<void> {
    let offer: RTCSessionDescriptionInit;
    try {
      offer = await connection.createOffer();
      await connection.setLocalDescription(offer);
    } catch (error) {
      throw new RealtimeVoiceError(
        'CONNECTION_FAILED',
        'Failed to create a local SDP offer',
        error,
      );
    }

    const sdp = connection.localDescription?.sdp;
    if (!sdp) {
      throw new RealtimeVoiceError(
        'CONNECTION_FAILED',
        'Failed to create a local SDP offer',
      );
    }

    let response: Response;
    try {
      response = await fetch(REALTIME_CALLS_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token.value}`,
          'Content-Type': 'application/sdp',
        },
        body: sdp,
      });
    } catch (error) {
      throw new RealtimeVoiceError(
        'CONNECTION_FAILED',
        'OpenAI realtime call setup request failed',
        error,
      );
    }

    if (!response.ok) {
      throw new RealtimeVoiceError(
        'CONNECTION_FAILED',
        `OpenAI realtime call setup failed with status ${response.status}`,
      );
    }

    let answerSdp: string;
    try {
      answerSdp = await response.text();
    } catch (error) {
      throw new RealtimeVoiceError(
        'CONNECTION_FAILED',
        'Failed to read the remote SDP answer',
        error,
      );
    }
    this.#logger.debug('connect timing', {
      step: 'sdpExchange',
      ms: Date.now() - connectStart,
    });
    try {
      await connection.setRemoteDescription({ type: 'answer', sdp: answerSdp });
    } catch (error) {
      throw new RealtimeVoiceError(
        'CONNECTION_FAILED',
        'Failed to apply the remote SDP answer',
        error,
      );
    }
    this.#logger.debug('connect timing', {
      step: 'setRemoteDescription',
      ms: Date.now() - connectStart,
    });
  }

  /**
   * Builds the GA Realtime API audio configuration. The output voice and
   * provider-owned input controls are always present; disabling transcription
   * removes only the optional transcription model. Immediate barge-in delegates
   * response creation and interruption to OpenAI. Transcript-confirmed mode
   * disables both provider actions for adapter-controlled handling.
   */
  #audioConfig(): Record<string, unknown> {
    const input = {
      noise_reduction: { type: 'near_field' },
      turn_detection: {
        type: 'server_vad',
        threshold: this.#serverVadThreshold,
        prefix_padding_ms: 300,
        silence_duration_ms: 500,
        create_response: this.#bargeInMode === 'immediate',
        interrupt_response: this.#bargeInMode === 'immediate',
      },
      ...(this.#transcription === false
        ? {}
        : {
            transcription: {
              model: this.#transcription?.model ?? DEFAULT_TRANSCRIPTION_MODEL,
            },
          }),
    };
    return { audio: { input, output: { voice: this.#voice } } };
  }

  #emit(event: RealtimeAdapterEvent): void {
    for (const handler of this.#handlers) handler(event);
  }

  #createGreetingMicrophoneGate(
    operation: AbortController,
  ): GreetingMicrophoneGate {
    const uniqueTracks = new Set(this.#micStream?.getAudioTracks() ?? []);
    const gate: GreetingMicrophoneGate = {
      operation,
      connectionGeneration: this.#connectionGeneration,
      tracks: [...uniqueTracks].map((track) => ({
        track,
        previousEnabled: track.enabled,
      })),
    };
    this.#greetingMicrophoneGate = gate;
    return gate;
  }

  /**
   * Settle only the current greeting owner. A current gate restores exact prior
   * track values before the gate and operation are cleared and playback stops;
   * stale operations and generations are complete no-ops.
   */
  #settleGreetingOperation(
    operation: AbortController,
    gate: GreetingMicrophoneGate | undefined,
  ): void {
    if (gate !== undefined) {
      if (
        this.#greetingMicrophoneGate !== gate ||
        gate.operation !== operation ||
        this.#greetingOp !== operation ||
        gate.connectionGeneration !== this.#connectionGeneration
      ) {
        return;
      }
      for (const { track, previousEnabled } of gate.tracks) {
        track.enabled = previousEnabled;
      }
      this.#greetingMicrophoneGate = undefined;
    } else if (
      this.#greetingOp !== operation ||
      this.#greetingMicrophoneGate !== undefined
    ) {
      return;
    }

    if (this.#greetingOp !== operation) return;
    this.#greetingOp = undefined;
    this.#greetingPlayer.stop();
  }

  /**
   * Abort in-flight greeting synthesis/playback without closing the session.
   * Any current decode/playback microphone gate restores before the shared
   * player stops. Player AudioContext is retained across reconnects, and stale
   * operation or generation cleanup cannot affect its replacement. When an
   * expected operation is supplied, a different or absent owner is a no-op.
   */
  #abortGreetingPlayback(expectedOp?: AbortController): void {
    const greetingOp = this.#greetingOp;
    if (expectedOp !== undefined && greetingOp !== expectedOp) return;
    if (greetingOp === undefined) return;
    const gate =
      this.#greetingMicrophoneGate?.operation === greetingOp
        ? this.#greetingMicrophoneGate
        : undefined;
    greetingOp.abort();
    this.#settleGreetingOperation(greetingOp, gate);
  }

  #startConnectionGeneration(): void {
    this.#connectionGeneration += 1;
    this.#interruptionLedger.clear();
    this.#responseInFlight = undefined;
    this.#toolFollowUpPending = false;
    this.#responseCreateDrainBlockDepth = 0;
    this.#responseCreateDrainDeferred = false;
    this.#validatedTurnQueue.length = 0;
    this.#settledResponseIds.clear();
    this.#activeResponseId = undefined;
    this.#outputActivity = 'not-started';
  }

  #teardown(): void {
    // Invalidate any connect() still mid-handshake so it abandons its own
    // attempt instead of clobbering shared state when its awaits resume.
    this.#connectGuard.supersede();
    this.#clearIceGraceTimer();
    // Abort in-flight greeting synthesis/playback so disconnect cannot hang.
    // Fresh lifecycle state for a later reconnect; player context is retained.
    this.#abortGreetingPlayback();
    this.#audioEl?.pause();
    if (this.#audioEl) this.#audioEl.srcObject = null;
    this.#audioEl = undefined;
    this.#playbackStream = undefined;
    this.#dc?.close();
    if (this.#pc) {
      for (const sender of this.#pc.getSenders()) {
        sender.track?.stop();
      }
      this.#pc.close();
    }
    this.#micStream?.getTracks().forEach((track) => {
      track.stop();
    });
    this.#pc = undefined;
    this.#dc = undefined;
    this.#micStream = undefined;
    this.#groundingItemExists = false;
    this.#connecting = false;
    this.#voiceActivity = 'connected';
    this.#unexpectedEvents = createUnexpectedEventTracker();
    this.#startConnectionGeneration();
  }

  #handleDataChannelMessage(raw: unknown, generation: number): void {
    if (generation !== this.#connectionGeneration) return;
    let parsed: unknown;
    try {
      parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch (error) {
      this.#logger.error('← data-channel parse error', raw, error);
      this.#emit({ type: 'error', error });
      return;
    }
    const type = isRecord(parsed) ? asString(parsed.type) : undefined;
    const isInputTranscriptDelta =
      type === 'conversation.item.input_audio_transcription.delta';
    const previousActivity = this.#voiceActivity;
    let lifecycleCategory:
      | 'speech_started'
      | 'speech_stopped'
      | 'committed'
      | 'transcript_completed'
      | undefined;
    switch (type) {
      case 'input_audio_buffer.speech_started':
        lifecycleCategory = 'speech_started';
        break;
      case 'input_audio_buffer.speech_stopped':
        lifecycleCategory = 'speech_stopped';
        break;
      case 'input_audio_buffer.committed':
        lifecycleCategory = 'committed';
        break;
      case 'conversation.item.input_audio_transcription.completed':
        lifecycleCategory = 'transcript_completed';
        break;
    }

    // Lifecycle diagnostics are fixed projections: content and provider
    // metadata are inspected only long enough to classify the event and are
    // never retained by the logger.
    if (lifecycleCategory === 'transcript_completed') {
      const transcript = isRecord(parsed)
        ? asString(parsed.transcript)
        : undefined;
      this.#logger.debug('input lifecycle', {
        category: lifecycleCategory,
        role: 'user',
        final: true,
        useful: transcript !== undefined && transcript.trim().length > 0,
      });
    } else if (lifecycleCategory !== undefined) {
      this.#logger.debug('input lifecycle', { category: lifecycleCategory });
      if (
        lifecycleCategory === 'speech_started' &&
        previousActivity === 'speaking' &&
        this.#bargeInMode === 'immediate'
      ) {
        this.#logger.debug('input lifecycle', {
          category: 'assistant_interruption',
        });
      }
    }
    if (lifecycleCategory === undefined && !isInputTranscriptDelta) {
      // Noisy transcript deltas flood the console — log only their type.
      if (type === 'response.audio_transcript.delta') {
        this.#logger.debug('←', type);
      } else {
        this.#logger.debug('←', type, parsed);
      }
    }

    // Response-lifecycle bookkeeping is driven off the raw event type, not
    // the parsed adapter event — `parseOpenAIServerEvent` has no mapping for
    // these (and shouldn't grow one just for this internal concern).
    // `response.done` is terminal for every outcome (its `response.status`
    // field carries completed/cancelled/failed/incomplete) — there is no
    // separate `response.cancelled` server event.
    if (type === 'response.created') {
      this.#handleResponseCreated(parsed);
    } else if (type === 'response.done') {
      this.#handleResponseDone(parsed);
    } else if (type === 'output_audio_buffer.started') {
      this.#outputActivity = 'active';
      this.#fulfillClearObligations();
    } else if (type === 'output_audio_buffer.stopped') {
      this.#outputActivity = 'stopped';
      this.#fulfillClearObligations();
    } else if (type === 'output_audio_buffer.cleared') {
      this.#outputActivity = 'cleared';
      this.#fulfillClearObligations();
    }

    if (type !== undefined) {
      const nextActivity = deriveVoiceActivity(this.#voiceActivity, type);
      if (nextActivity !== null && nextActivity !== this.#voiceActivity) {
        this.#voiceActivity = nextActivity;
        this.#emit({ type: 'state', state: nextActivity });
      }
    }

    // Barge-in normally stops adapter-owned greeting Web Audio only. During the
    // current decode/playback microphone gate, skip only that local abort; state
    // derivation and provider-neutral speech_started propagation remain intact.
    if (
      type === 'input_audio_buffer.speech_started' &&
      this.#bargeInMode === 'immediate' &&
      this.#greetingMicrophoneGate === undefined
    ) {
      this.#abortGreetingPlayback();
    }

    if (isInputTranscriptDelta) this.#handleInputTranscriptDelta(parsed);
    if (this.#bargeInMode === 'transcript-confirmed') {
      if (type === 'input_audio_buffer.committed') {
        this.#handleCommittedItem(parsed);
      } else if (
        type === 'conversation.item.input_audio_transcription.completed'
      ) {
        this.#handleCompletedTranscript(parsed);
      }
    }

    const event = parseOpenAIServerEvent(parsed);
    if (event) {
      if (lifecycleCategory === undefined && !isInputTranscriptDelta) {
        this.#logger.debug('parsed →', event.type, event);
      }
      this.#emit(event);
    } else {
      if (lifecycleCategory === undefined && !isInputTranscriptDelta) {
        this.#logger.debug('unrecognized or unparsed event', type, parsed);
      }
      if (type !== undefined && this.#unexpectedEvents.track(type)) {
        this.#logger.warn('unexpected realtime event type', type);
      }
    }
  }

  #responseId(event: unknown): string | undefined {
    if (!isRecord(event) || !isRecord(event.response)) return undefined;
    const id = asString(event.response.id);
    return id !== undefined && id.length > 0 ? id : undefined;
  }

  #requestToolFollowUp(): void {
    if (
      this.#responseInFlight !== undefined ||
      this.#responseCreateDrainBlocked()
    ) {
      this.#toolFollowUpPending = true;
      if (this.#responseInFlight === undefined) {
        this.#responseCreateDrainDeferred = true;
      }
      return;
    }
    this.#attemptResponseCreate();
  }

  #requestValidatedTurn(itemId: string, entry: InterruptionLedgerEntry): void {
    if (entry.responseCreateQueued) return;
    entry.responseCreateQueued = true;
    if (
      this.#responseInFlight === undefined &&
      !this.#toolFollowUpPending &&
      !this.#responseCreateDrainBlocked()
    ) {
      entry.responseCreateSent = true;
      this.#attemptResponseCreate();
      return;
    }
    this.#validatedTurnQueue.push(itemId);
    if (this.#responseInFlight === undefined) {
      this.#responseCreateDrainDeferred = true;
    }
  }

  #attemptResponseCreate(): void {
    this.#responseInFlight = {};
    try {
      if (!this.#dc || this.#dc.readyState !== 'open') {
        throw new Error('response.create: data channel not open');
      }
      this.#dc.send(JSON.stringify({ type: 'response.create' }));
    } catch (error) {
      this.#emit({ type: 'error', error });
    }
  }

  #handleResponseCreated(event: unknown): void {
    const responseId = this.#responseId(event);
    if (responseId === undefined || this.#settledResponseIds.has(responseId)) {
      this.#logger.debug('response arbiter', { category: 'created-unmatched' });
      return;
    }
    const current = this.#responseInFlight;
    if (current === undefined) {
      this.#responseInFlight = { responseId };
    } else if (current.responseId === undefined) {
      this.#responseInFlight = { responseId };
    } else {
      if (current.responseId !== responseId) {
        this.#logger.debug('response arbiter', {
          category: 'created-conflict',
        });
      }
      return;
    }
    this.#activeResponseId = responseId;
    this.#outputActivity = 'not-started';
  }

  #handleResponseDone(event: unknown): void {
    const responseId = this.#responseId(event);
    const current = this.#responseInFlight;
    if (
      responseId === undefined ||
      current === undefined ||
      this.#settledResponseIds.has(responseId)
    ) {
      return;
    }
    if (current.responseId !== undefined && current.responseId !== responseId)
      return;

    this.#settledResponseIds.add(responseId);
    this.#responseInFlight = undefined;
    if (
      this.#activeResponseId === responseId ||
      current.responseId === undefined
    ) {
      this.#activeResponseId = undefined;
    }
    this.#drainResponseCreate();
  }

  #drainResponseCreate(): void {
    if (this.#responseInFlight !== undefined) return;
    if (this.#responseCreateDrainBlocked()) {
      this.#responseCreateDrainDeferred = true;
      return;
    }
    this.#responseCreateDrainDeferred = false;
    if (this.#toolFollowUpPending) {
      this.#toolFollowUpPending = false;
      this.#attemptResponseCreate();
      return;
    }
    const itemId = this.#validatedTurnQueue.shift();
    if (itemId === undefined) return;
    const entry = this.#interruptionLedger.get(itemId);
    if (!entry || entry.responseCreateSent) return;
    entry.responseCreateSent = true;
    this.#attemptResponseCreate();
  }

  #responseCreateDrainBlocked(): boolean {
    if (this.#responseCreateDrainBlockDepth > 0) return true;
    for (const entry of this.#interruptionLedger.values()) {
      if (entry.outputClearPending) return true;
    }
    return false;
  }

  #resumeResponseCreateDrain(): void {
    if (!this.#responseCreateDrainDeferred) return;
    this.#drainResponseCreate();
  }

  #handleCommittedItem(event: unknown): void {
    const correlated = this.#correlatedItem(event);
    if (correlated === undefined) return;
    const [itemId, entry] = correlated;
    entry.committed = true;
    this.#requestResponseForEligibleItem(itemId, entry);
  }

  #handleCompletedTranscript(event: unknown): void {
    const correlated = this.#correlatedItem(event);
    if (correlated === undefined) return;
    const [itemId, entry] = correlated;
    if (entry.completedTranscript === 'unseen') {
      const transcript = isRecord(event)
        ? asString(event.transcript)
        : undefined;
      entry.completedTranscript =
        transcript !== undefined && transcript.trim().length > 0
          ? 'useful'
          : 'empty';
    }
    this.#requestResponseForEligibleItem(itemId, entry);
  }

  #correlatedItem(
    event: unknown,
  ): readonly [string, InterruptionLedgerEntry] | undefined {
    if (!isRecord(event)) return undefined;
    const itemId = asString(event.item_id);
    if (itemId === undefined || itemId.trim().length === 0) return undefined;
    const entry =
      this.#interruptionLedger.get(itemId) ?? createInterruptionLedgerEntry();
    this.#interruptionLedger.set(itemId, entry);
    return [itemId, entry];
  }

  #requestResponseForEligibleItem(
    itemId: string,
    entry: InterruptionLedgerEntry,
  ): void {
    if (entry.committed && entry.completedTranscript === 'useful') {
      this.#requestValidatedTurn(itemId, entry);
    }
  }

  #handleInputTranscriptDelta(event: unknown): void {
    if (!isRecord(event)) return;
    const itemId = asString(event.item_id);
    const delta = asString(event.delta);
    const useful = delta !== undefined && delta.trim().length > 0;
    if (itemId === undefined || itemId.trim().length === 0) {
      this.#logger.debug('input interruption', {
        category: 'uncorrelated',
        useful,
      });
      return;
    }
    if (!useful) {
      this.#logger.debug('input interruption', {
        category: 'not-useful',
        useful: false,
      });
      return;
    }
    if (this.#bargeInMode !== 'transcript-confirmed') {
      this.#logger.debug('input interruption', {
        category: 'useful-delta',
        useful: true,
      });
      return;
    }

    const entry =
      this.#interruptionLedger.get(itemId) ?? createInterruptionLedgerEntry();
    this.#interruptionLedger.set(itemId, entry);
    if (entry.interruptionEvaluated) return;
    entry.interruptionEvaluated = true;

    let targeted = false;
    const greetingOp = this.#greetingOp;
    if (greetingOp !== undefined) {
      targeted = true;
      this.#logger.debug('input interruption', {
        category: 'interruption-greeting',
        useful: true,
      });
      this.#abortGreetingPlayback(greetingOp);
    }

    if (this.#activeResponseId !== undefined) {
      targeted = true;
      this.#cancelActiveResponse(entry, this.#activeResponseId);
    } else if (this.#outputActivity === 'active') {
      targeted = true;
      this.#sendStandaloneOutputClear(entry);
    }

    if (!targeted) {
      this.#logger.debug('input interruption', {
        category: 'interruption-no-target',
        useful: true,
      });
    }
  }

  #cancelActiveResponse(
    entry: InterruptionLedgerEntry,
    responseId: string,
  ): void {
    if (entry.responseCancelAttempted) return;
    entry.responseCancelAttempted = true;
    this.#logger.debug('input interruption', {
      category: 'interruption-cancel',
      useful: true,
    });
    this.#responseCreateDrainBlockDepth += 1;
    try {
      this.#dc?.send(
        JSON.stringify({ type: 'response.cancel', response_id: responseId }),
      );
      entry.outputClearPending = true;
      this.#fulfillClearObligations();
    } catch (error) {
      this.#emit({ type: 'error', error });
      if (this.#outputActivity === 'active') {
        this.#sendStandaloneOutputClear(entry);
      }
    } finally {
      this.#responseCreateDrainBlockDepth -= 1;
      this.#resumeResponseCreateDrain();
    }
  }

  #sendStandaloneOutputClear(entry: InterruptionLedgerEntry): void {
    if (entry.standaloneOutputClearAttempted) return;
    entry.standaloneOutputClearAttempted = true;
    this.#logger.debug('input interruption', {
      category: 'interruption-clear',
      useful: true,
    });
    try {
      this.#dc?.send(JSON.stringify({ type: 'output_audio_buffer.clear' }));
    } catch (error) {
      this.#emit({ type: 'error', error });
    }
  }

  #fulfillClearObligations(): void {
    this.#responseCreateDrainBlockDepth += 1;
    try {
      for (const entry of this.#interruptionLedger.values()) {
        if (!entry.outputClearPending) continue;
        if (
          this.#outputActivity === 'stopped' ||
          this.#outputActivity === 'cleared'
        ) {
          entry.outputClearPending = false;
          continue;
        }
        if (this.#outputActivity !== 'active') continue;
        entry.outputClearPending = false;
        this.#logger.debug('input interruption', {
          category: 'interruption-clear',
          useful: true,
        });
        try {
          this.#dc?.send(JSON.stringify({ type: 'output_audio_buffer.clear' }));
        } catch (error) {
          this.#emit({ type: 'error', error });
        }
      }
    } finally {
      this.#responseCreateDrainBlockDepth -= 1;
      this.#resumeResponseCreateDrain();
    }
  }
}
