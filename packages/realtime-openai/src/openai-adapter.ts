import type { Unsubscribe, VoiceSessionState } from '@maelstrom-co/client';
import { Logger } from '@maelstrom-co/client';
import type { MessageId, ToolCallId } from '@maelstrom-co/protocol';
import type {
  AdapterAudioStreams,
  AdapterConnectOptions,
  AdapterVoiceActivation,
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
import {
  type ResolvedBrowserVadConfig,
  resolveBrowserVadConfig,
} from '@maelstrom-co/realtime-vad/config';
import {
  GreetingInterruption,
  type ReplacePublicationArgs,
} from './greeting-interruption.js';
import { GreetingPresentation } from './greeting-presentation.js';
import { MicrophonePublicationGate } from './microphone-publication-gate.js';
import type {
  OpenAIAdapterOptions,
  SynthesizeGreeting,
} from './openai-adapter.types.js';
import {
  asString,
  isRecord,
  parseOpenAIServerEvent,
} from './parse-openai-event.js';
import { WebRtcPlayoutDiagnostics } from './playout-diagnostics.js';
import { ResponseArbiter } from './response-arbiter.js';
import {
  TriggerInputLedger,
  TriggerResponseLedger,
} from './trigger-admission.js';
import {
  createUnexpectedEventTracker,
  type UnexpectedEventTracker,
} from './unexpected-event-tracker.js';
import { deriveVoiceActivity } from './voice-activity.js';
import { WebAudioGreetingPlayer } from './web-audio-greeting-player.js';

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

/**
 * Validates the OpenAI-specific opt-in without inheriting the VAD API's
 * default-on `undefined` behavior. Phase 1 intentionally discards enabled
 * configuration; later phases own its runtime lifecycle.
 */
function resolveGreetingInterruptionConfig(
  greetingInterruption: unknown,
): ResolvedBrowserVadConfig {
  if (greetingInterruption === undefined || greetingInterruption === false) {
    return { enabled: false };
  }
  try {
    return resolveBrowserVadConfig(greetingInterruption);
  } catch (error) {
    if (error instanceof TypeError) {
      throw new TypeError(
        error.message.replace(/^vad\b/, 'greetingInterruption'),
        { cause: error },
      );
    }
    throw error;
  }
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
  /** Version-one source admission and activity contract; runtime provider configuration and reference acknowledgements still fail closed. */
  readonly voiceActivationVersion = 1 as const;
  #activation: AdapterVoiceActivation | undefined;
  #triggerInputs: TriggerInputLedger | undefined;
  #triggerResponses: TriggerResponseLedger | undefined;
  #triggerUnsubscribe: Unsubscribe | undefined;
  #triggerReady = false;
  readonly #bootstrapTracks = new Set<MediaStreamTrack>();
  readonly #triggerSpeech = new Map<
    string,
    { started: boolean; useful: boolean; interrupted: boolean; target?: string }
  >();
  #triggerCurrentResponse: string | undefined;
  #triggerPlaybackResponse: string | undefined;
  readonly #mintToken: () => Promise<OpenAITokenGrant>;
  readonly #logger: Logger;
  readonly #transcription: false | { readonly model?: string } | undefined;
  readonly #serverVadThreshold: number;
  readonly #bargeInMode: 'immediate' | 'transcript-confirmed';
  readonly #voice: OpenAIBuiltInVoice;
  readonly #synthesizeGreeting: SynthesizeGreeting | undefined;
  readonly #greetingInterruption: ResolvedBrowserVadConfig;
  readonly #greetingGate: MicrophonePublicationGate;
  readonly #greetingPresentation: GreetingPresentation;
  readonly #playoutDiagnostics: WebRtcPlayoutDiagnostics | undefined;
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
  #arbiter: ResponseArbiter | undefined;
  #voiceActivity: VoiceSessionState = 'connected';
  #unexpectedEvents: UnexpectedEventTracker = createUnexpectedEventTracker();
  #connectionGeneration = 0;

  constructor(options: OpenAIAdapterOptions) {
    this.#greetingInterruption = resolveGreetingInterruptionConfig(
      options.greetingInterruption,
    );
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
    this.#playoutDiagnostics = this.#logger.isEnabled
      ? new WebRtcPlayoutDiagnostics((diagnostic) =>
          this.#logger.debug('audio playout', diagnostic),
        )
      : undefined;
    this.#greetingGate = new MicrophonePublicationGate(
      () => this.#connectionGeneration,
    );
    this.#greetingPresentation = new GreetingPresentation({
      synthesize: this.#synthesizeGreeting,
      voice: this.#voice,
      player: new WebAudioGreetingPlayer(),
      gate: this.#greetingGate,
      channel: () => this.#dc,
      microphone: () => this.#micStream,
      generation: () => this.#connectionGeneration,
      debug: (category) => this.#logger.debug('greeting', { category }),
      interruption: new GreetingInterruption({
        config: this.#greetingInterruption,
        gate: this.#greetingGate,
        generation: () => this.#connectionGeneration,
        replacePublication: (args) => this.#replacePublication(args),
        debug: (category) => this.#logger.debug('greeting', { category }),
      }),
    });
    this.#arbiter = this.#newArbiter();
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
   * owns turn detection. Trigger bridge callers require input transcription;
   * their original microphone tracks stay disabled until a matching provider
   * configuration acknowledgement, bounded to ten seconds. This is a setup
   * gate, not a provider event/audio-drain barrier.
   * Trigger mode keeps automatic provider responses disabled for the entire
   * connection and retains admitted dialogue across wakes with explicit inputs.
   * Waiting capture still reaches provider transcription; it is not hardware
   * mute or provider-data erasure. Expiry never cancels or clears output.
   */
  async connect(opts: AdapterConnectOptions): Promise<void> {
    if (this.#pc || this.#connecting) {
      throw new RealtimeVoiceError(
        'ALREADY_CONNECTED',
        'OpenAI realtime adapter is already connected',
      );
    }
    if (opts.activation && this.#transcription === false) {
      throw new RealtimeVoiceError(
        'ACTIVATION_CONFIG_INVALID',
        'OpenAI trigger activation requires input transcription',
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
    let preparedMicrophone:
      | Awaited<ReturnType<GreetingPresentation['prepareMicrophone']>>
      | undefined;
    let preparedCommitted = false;
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
      if (opts.activation) {
        for (const track of micStream.getAudioTracks()) {
          if (track.enabled) {
            track.enabled = false;
            this.#bootstrapTracks.add(track);
          }
        }
      }
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
      preparedMicrophone =
        opts.activation || opts.prepareGreeting === false
          ? undefined
          : await this.#greetingPresentation.prepareMicrophone(micStream);
      attempt.assertCurrent();
      let publicationSender: RTCRtpSender | undefined;
      for (const track of micStream.getTracks()) {
        if (track.kind === 'audio' && preparedMicrophone?.generated) {
          publicationSender ??= connection.addTrack(
            preparedMicrophone.track,
            micStream,
          );
          continue;
        }
        const sender = connection.addTrack(track, micStream);
        if (track.kind === 'audio') publicationSender ??= sender;
      }

      // Past the post-getUserMedia check — this attempt is still current, so
      // publishing to the shared fields is safe.
      this.#activation = opts.activation;
      this.#startConnectionGeneration();
      if (opts.activation) this.#installTrigger(opts.activation);
      if (preparedMicrophone && publicationSender) {
        this.#greetingPresentation.attachMicrophone(
          preparedMicrophone,
          publicationSender,
          this.#connectionGeneration,
        );
        preparedCommitted = true;
      }
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
      if (!preparedCommitted) await preparedMicrophone?.abandon();
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
    connection?.close();
  }

  async disconnect(): Promise<void> {
    this.#teardown();
  }

  getAudioStreams(): AdapterAudioStreams {
    return { mic: this.#micStream, playback: this.#playbackStream };
  }

  /**
   * Sends a tool result. Trigger connections require an owned dispatched call
   * and await its exact item-created acknowledgement before queuing a follow-up;
   * missing/mismatched acknowledgement rejects and reports a fatal eligibility
   * error after at most ten seconds. Unknown or undispatched calls reject with
   * an eligibility failure, unlike LiveKit trigger mode's unknown-call no-op.
   * Repeated results for a dispatched call reuse its first result operation while
   * the trigger connection and call remain live; LiveKit consumes the call and
   * treats subsequent results as no-ops. Normal connections retain send-only
   * completion and report transport errors through adapter events.
   */
  async sendToolResult(callId: ToolCallId, output: ToolResult): Promise<void> {
    if (this.#triggerResponses)
      return this.#triggerResponses.toolResult(callId, output);
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

  /**
   * Replaces latest grounding, dropping pushes before transport readiness.
   * Trigger mode defers replacement deletion while an in-flight response uses
   * the old reference and defers dependent responses until the latest creation
   * is acknowledged. Normal mode retains immediate delete/recreate semantics.
   */
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
    if (this.#triggerResponses) {
      if (!this.#triggerReady) return;
      this.#triggerResponses.ground(text);
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

  /** Unlocks retained Web Audio activation in the initiating gesture. */
  activateAudio(): void {
    this.#greetingPresentation.activate();
  }

  /** Presents the configured local greeting in normal mode. Trigger connections return `not_started` without synthesis, playback, or consuming normal greeting proof. */
  speakAssistantText(args: {
    readonly id: MessageId;
    readonly text: string;
    readonly signal: AbortSignal;
    readonly onPlaybackStart?: () => void;
  }): Promise<GreetingSpeechResult> {
    if (this.#activation) return Promise.resolve('not_started');
    return this.#greetingPresentation.speak(args);
  }

  #wireConnectionEvents(connection: RTCPeerConnection): void {
    const audio = new Audio();
    audio.autoplay = true;
    if (this.#activation) audio.muted = true;
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
    let configuration: ((raw: unknown) => boolean) | undefined;
    channel.onmessage = (event: MessageEvent) => {
      if (channel !== this.#dc || generation !== this.#connectionGeneration)
        return;
      if (configuration?.(event.data)) return;
      this.#handleDataChannelMessage(event.data as unknown, generation);
    };
    return new Promise<RTCDataChannel>((resolve, reject) => {
      let settled = false;
      let opened = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const fail = (error: RealtimeVoiceError) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      };
      if (opts.activation)
        configuration = (raw) => {
          if (settled) return false;
          let event: unknown;
          try {
            event = typeof raw === 'string' ? JSON.parse(raw) : raw;
          } catch {
            fail(
              new RealtimeVoiceError(
                'ACTIVATION_ELIGIBILITY_FAILED',
                'Invalid OpenAI configuration acknowledgement',
              ),
            );
            return true;
          }
          if (!isRecord(event)) return true;
          if (event.type === 'error' || event.type === 'response.created') {
            fail(
              new RealtimeVoiceError(
                'ACTIVATION_ELIGIBILITY_FAILED',
                'OpenAI trigger bootstrap was not accepted',
              ),
            );
          } else if (event.type === 'session.updated' && opened) {
            if (!this.#validTriggerConfiguration(event.session)) {
              fail(
                new RealtimeVoiceError(
                  'ACTIVATION_ELIGIBILITY_FAILED',
                  'OpenAI trigger configuration acknowledgement did not match',
                ),
              );
            } else {
              settled = true;
              clearTimeout(timer);
              this.#triggerReady = true;
              for (const track of this.#bootstrapTracks)
                if (!track.enabled) track.enabled = true;
              this.#bootstrapTracks.clear();
              resolve(channel);
            }
          }
          return true;
        };
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
          opened = true;
          if (opts.activation)
            timer = setTimeout(
              () =>
                fail(
                  new RealtimeVoiceError(
                    'ACTIVATION_ELIGIBILITY_FAILED',
                    'OpenAI trigger configuration acknowledgement timed out',
                  ),
                ),
              10000,
            );
          channel.send(JSON.stringify(sessionUpdate));
          if (!opts.activation) {
            settled = true;
            resolve(channel);
          }
        } catch (cause) {
          clearTimeout(timer);
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
          clearTimeout(timer);
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
        clearTimeout(timer);
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
   * disables both provider actions for adapter-controlled handling. Trigger
   * connections also disable both flags regardless of configured barge-in;
   * admitted input drives explicit interruption instead.
   */
  #audioConfig(): Record<string, unknown> {
    const input = {
      noise_reduction: { type: 'near_field' },
      turn_detection: {
        type: 'server_vad',
        threshold: this.#serverVadThreshold,
        prefix_padding_ms: 300,
        silence_duration_ms: 500,
        create_response: !this.#activation && this.#bargeInMode === 'immediate',
        interrupt_response:
          !this.#activation && this.#bargeInMode === 'immediate',
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

  #abortGreetingPlayback(): void {
    this.#greetingPresentation.abort();
  }

  async #replacePublication(
    args: ReplacePublicationArgs,
  ): Promise<'replaced' | 'stale' | 'failed'> {
    if (args.generation !== this.#connectionGeneration) return 'stale';
    const sender = this.#pc
      ?.getSenders()
      .find((candidate) => candidate.track === args.generated);
    if (!sender) return 'stale';
    this.#greetingGate.acquire(
      this.#micStream ??
        ({ getAudioTracks: () => [args.raw] } as unknown as MediaStream),
      args.generation,
    );
    args.generated.enabled = false;
    try {
      await sender.replaceTrack(args.raw);
    } catch {
      this.#logger.debug('greeting', {
        category: 'publication-replace-failed',
      });
      this.#emit({
        type: 'error',
        error: new RealtimeVoiceError(
          'CONNECTION_FAILED',
          'Failed to restore the OpenAI microphone publication',
        ),
      });
      return 'failed';
    }
    return sender.track === args.raw ? 'replaced' : 'failed';
  }

  /**
   * Starts an isolated response-arbiter generation. Teardown and reconnect use
   * this boundary to discard queued work, clear fatal send state, and prevent
   * stale provider events from affecting the replacement session.
   */
  #startConnectionGeneration(): void {
    this.#connectionGeneration += 1;
    this.#arbiter?.close();
    this.#arbiter = this.#newArbiter();
  }

  #teardown(): void {
    // Invalidate any connect() still mid-handshake so it abandons its own
    // attempt instead of clobbering shared state when its awaits resume.
    this.#connectGuard.supersede();
    this.#triggerUnsubscribe?.();
    this.#triggerUnsubscribe = undefined;
    this.#triggerInputs?.close();
    this.#triggerInputs = undefined;
    this.#triggerResponses?.close();
    this.#triggerResponses = undefined;
    this.#activation = undefined;
    this.#triggerReady = false;
    this.#bootstrapTracks.clear();
    this.#triggerSpeech.clear();
    this.#triggerCurrentResponse = undefined;
    this.#triggerPlaybackResponse = undefined;
    this.#clearIceGraceTimer();
    // Abort greeting work and release owner-generated publication resources.
    // Fresh lifecycle state for a later reconnect; player context is retained.
    this.#greetingPresentation.disconnect();
    this.#audioEl?.pause();
    if (this.#audioEl) this.#audioEl.srcObject = null;
    this.#audioEl = undefined;
    this.#playbackStream = undefined;
    this.#dc?.close();
    this.#pc?.close();
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
    this.#playoutDiagnostics?.clear();
    this.#startConnectionGeneration();
  }

  #handleDataChannelMessage(raw: unknown, generation: number): void {
    if (generation !== this.#connectionGeneration) return;
    let parsed: unknown;
    try {
      parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch (error) {
      this.#logger.error('← data-channel parse error');
      this.#emit({ type: 'error', error });
      return;
    }
    const type = isRecord(parsed) ? asString(parsed.type) : undefined;
    if (this.#activation) {
      if (isRecord(parsed)) this.#handleTriggerMessage(parsed);
      return;
    }
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
      this.#logger.debug(
        'input lifecycle',
        lifecycleCategory === 'speech_started'
          ? {
              category: lifecycleCategory,
              greetingActive: this.#greetingPresentation.isActive,
            }
          : { category: lifecycleCategory },
      );
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
      this.#logger.debug(
        '←',
        this.#unexpectedEvents.knownType(type) ?? 'event',
      );
    }

    // Response-lifecycle bookkeeping is driven off the raw event type, not
    // the parsed adapter event — `parseOpenAIServerEvent` has no mapping for
    // these (and shouldn't grow one just for this internal concern).
    // `response.done` is terminal for every outcome (its `response.status`
    // field carries completed/cancelled/failed/incomplete) — there is no
    // separate `response.cancelled` server event.
    if (type === 'response.created') {
      this.#arbiter?.responseCreated(this.#responseId(parsed));
    } else if (type === 'response.done') {
      this.#arbiter?.responseDone(
        this.#responseId(parsed),
        this.#completedResponseHasExplicitlyEmptyOutput(parsed),
      );
    } else if (type === 'output_audio_buffer.started') {
      this.#arbiter?.outputStarted();
      if (this.#pc)
        this.#playoutDiagnostics?.start(this.#pc, this.#connectionGeneration);
    } else if (type === 'output_audio_buffer.stopped') {
      this.#arbiter?.outputStopped();
      if (this.#pc)
        this.#playoutDiagnostics?.finish(this.#pc, this.#connectionGeneration);
    } else if (type === 'output_audio_buffer.cleared') {
      this.#arbiter?.outputCleared();
      if (this.#pc)
        this.#playoutDiagnostics?.finish(this.#pc, this.#connectionGeneration);
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
      !this.#greetingPresentation.isPublicationGated
    ) {
      this.#abortGreetingPlayback();
    }

    if (isInputTranscriptDelta) {
      const itemId = this.#itemId(parsed);
      const useful =
        isRecord(parsed) &&
        typeof parsed.delta === 'string' &&
        parsed.delta.trim().length > 0;
      if (this.#bargeInMode === 'transcript-confirmed' && useful) {
        this.#logger.debug('input interruption', {
          category: 'useful-delta',
          useful: true,
        });
        if (this.#greetingPresentation.isActive) this.#abortGreetingPlayback();
        this.#arbiter?.usefulDelta(itemId);
      }
    }
    if (this.#bargeInMode === 'transcript-confirmed') {
      if (type === 'input_audio_buffer.committed') {
        this.#arbiter?.committed(this.#itemId(parsed));
      } else if (
        type === 'conversation.item.input_audio_transcription.completed'
      ) {
        const useful =
          isRecord(parsed) &&
          typeof parsed.transcript === 'string' &&
          parsed.transcript.trim().length > 0;
        this.#arbiter?.completed(this.#itemId(parsed), useful);
      }
    }

    const event = parseOpenAIServerEvent(parsed);
    if (event) {
      if (lifecycleCategory === undefined && !isInputTranscriptDelta) {
        this.#logger.debug('parsed →', event.type);
      }
      this.#emit(event);
    } else {
      if (lifecycleCategory === undefined && !isInputTranscriptDelta) {
        this.#logger.debug(
          'unrecognized or unparsed event',
          this.#unexpectedEvents.knownType(type) ?? 'unknown',
        );
      }
      if (type !== undefined && this.#unexpectedEvents.track(type)) {
        this.#logger.warn('unexpected realtime event type');
      }
    }
  }

  #newArbiter(): ResponseArbiter {
    return new ResponseArbiter({
      ...(this.#activation
        ? {
            responseInput: (inputId: string | undefined) =>
              this.#triggerResponses?.input(inputId),
          }
        : {}),
      send: (command) => {
        if (!this.#dc || this.#dc.readyState !== 'open') {
          throw new Error('OpenAI realtime data channel not open');
        }
        if (this.#triggerResponses)
          this.#triggerResponses.send(command as Record<string, unknown>);
        else this.#dc.send(JSON.stringify(command));
      },
      error: (error) => this.#emit({ type: 'error', error }),
      debug: (category) => this.#logger.debug('response arbiter', { category }),
    });
  }

  #responseId(event: unknown): string | undefined {
    if (!isRecord(event) || !isRecord(event.response)) return undefined;
    const id = asString(event.response.id);
    return id !== undefined && id.length > 0 ? id : undefined;
  }

  #completedResponseHasExplicitlyEmptyOutput(event: unknown): boolean {
    return (
      isRecord(event) &&
      isRecord(event.response) &&
      asString(event.response.status) === 'cancelled' &&
      Array.isArray(event.response.output) &&
      event.response.output.length === 0
    );
  }

  #itemId(event: unknown): string | undefined {
    if (!isRecord(event)) return undefined;
    const id = asString(event.item_id);
    return id !== undefined && id.trim().length > 0 ? id : undefined;
  }

  #requestToolFollowUp(): void {
    this.#arbiter?.requestToolFollowUp();
  }

  #validTriggerConfiguration(value: unknown): boolean {
    if (this.#transcription === false) return false;
    if (
      !isRecord(value) ||
      !isRecord(value.audio) ||
      !isRecord(value.audio.input)
    )
      return false;
    const input = value.audio.input;
    return (
      isRecord(input.turn_detection) &&
      input.turn_detection.type === 'server_vad' &&
      input.turn_detection.create_response === false &&
      input.turn_detection.interrupt_response === false &&
      isRecord(input.transcription) &&
      input.transcription.model ===
        (this.#transcription?.model ?? DEFAULT_TRANSCRIPTION_MODEL)
    );
  }

  #installTrigger(activation: AdapterVoiceActivation): void {
    const generation = this.#connectionGeneration;
    const current = () =>
      generation === this.#connectionGeneration &&
      this.#activation === activation;
    const responses = new TriggerResponseLedger(activation, {
      send: (command) => {
        if (!current() || this.#dc?.readyState !== 'open')
          throw new Error('OpenAI trigger channel unavailable');
        this.#dc.send(JSON.stringify(command));
      },
      error: (error) => {
        if (current()) this.#emit({ type: 'error', error });
      },
      changed: () => {
        if (current()) {
          this.#triggerInputs?.referencesChanged();
          this.#arbiter?.referencesChanged();
        }
      },
      followUp: (inputId) => {
        if (current()) this.#arbiter?.requestToolFollowUp(inputId);
      },
    });
    this.#triggerResponses = responses;
    this.#triggerInputs = new TriggerInputLedger(activation, {
      release: (input) => {
        if (!current()) return false;
        responses.admit(input);
        this.#interruptAdmitted();
        this.#emit({
          type: 'transcript',
          role: 'user',
          text: input.text,
          final: true,
          ancestry: input.ancestry,
        });
        if (!current()) return false;
        this.#arbiter?.committed(input.id);
        this.#arbiter?.completed(input.id, true);
        return true;
      },
      error: (error) => {
        if (current()) this.#emit({ type: 'error', error });
      },
    });
    this.#triggerUnsubscribe = activation.onChange(() => {
      if (current()) this.#interruptAdmitted();
    });
  }

  #interruptAdmitted(): void {
    for (const [id, speech] of this.#triggerSpeech) {
      if (
        speech.interrupted ||
        !(this.#bargeInMode === 'immediate' ? speech.started : speech.useful)
      )
        continue;
      if (this.#activation?.admission(id).status !== 'admitted') continue;
      speech.interrupted = true;
      const target =
        this.#triggerCurrentResponse ?? this.#triggerPlaybackResponse;
      if (speech.target && speech.target === target)
        this.#arbiter?.usefulDelta(id);
      this.#emit({ type: 'speech_started' });
    }
  }

  #handleTriggerMessage(event: Record<string, unknown>): void {
    if (!this.#triggerReady) return;
    const generation = this.#connectionGeneration;
    const type = asString(event.type);
    if (type === 'session.updated') {
      if (!this.#validTriggerConfiguration(event.session))
        this.#emit({
          type: 'error',
          error: new RealtimeVoiceError(
            'ACTIVATION_ELIGIBILITY_FAILED',
            'OpenAI trigger configuration changed unexpectedly',
          ),
        });
      return;
    }
    const itemId = asString(event.item_id);
    if (
      itemId &&
      (type === 'input_audio_buffer.speech_started' ||
        type === 'conversation.item.input_audio_transcription.delta')
    ) {
      let speech = this.#triggerSpeech.get(itemId);
      if (!speech) {
        speech = {
          started: false,
          useful: false,
          interrupted: false,
          target: this.#triggerCurrentResponse ?? this.#triggerPlaybackResponse,
        };
        this.#triggerSpeech.set(itemId, speech);
      }
      speech.started ||= type === 'input_audio_buffer.speech_started';
      speech.useful ||=
        typeof event.delta === 'string' && event.delta.trim().length > 0;
    }
    const accepted = this.#triggerResponses?.observe(event);
    if (generation !== this.#connectionGeneration) return;
    if (type === 'response.created' && !accepted) {
      this.#emit({
        type: 'error',
        error: new RealtimeVoiceError(
          'ACTIVATION_ELIGIBILITY_FAILED',
          'OpenAI emitted an unowned response',
        ),
      });
      return;
    }
    this.#triggerInputs?.observe(event);
    if (generation !== this.#connectionGeneration) return;
    this.#interruptAdmitted();
    if (accepted) {
      const responseId = this.#responseId(event) ?? asString(event.response_id);
      if (type === 'response.created') {
        if (this.#triggerResponses?.isGenerating(responseId))
          this.#triggerCurrentResponse = responseId;
        this.#arbiter?.responseCreated(responseId);
      } else if (type === 'response.done') {
        if (this.#triggerCurrentResponse === responseId)
          this.#triggerCurrentResponse = undefined;
        this.#arbiter?.responseDone(
          responseId,
          this.#completedResponseHasExplicitlyEmptyOutput(event),
        );
      } else if (type === 'output_audio_buffer.started') {
        this.#triggerPlaybackResponse = responseId;
        if (this.#audioEl) this.#audioEl.muted = false;
        this.#arbiter?.outputStarted();
      } else if (
        type === 'output_audio_buffer.stopped' ||
        type === 'output_audio_buffer.cleared'
      ) {
        if (this.#triggerPlaybackResponse === responseId)
          this.#triggerPlaybackResponse = undefined;
        if (type === 'output_audio_buffer.stopped')
          this.#arbiter?.outputStopped();
        else this.#arbiter?.outputCleared();
      }
    }
    const parsed = parseOpenAIServerEvent(event);
    if (parsed?.type === 'tool_call') {
      const ancestry = this.#triggerResponses?.toolAncestry(event);
      if (ancestry) this.#emit({ ...parsed, ancestry });
    } else if (parsed?.type === 'transcript' && parsed.role === 'assistant') {
      const ancestry = this.#triggerResponses?.ancestry(event);
      if (ancestry) this.#emit({ ...parsed, ancestry });
    }
    if (
      type &&
      (accepted ||
        (itemId && this.#activation?.admission(itemId).status === 'admitted'))
    ) {
      const state = deriveVoiceActivity(this.#voiceActivity, type);
      if (state && state !== this.#voiceActivity) {
        this.#voiceActivity = state;
        this.#emit({ type: 'state', state });
      }
    }
  }
}
