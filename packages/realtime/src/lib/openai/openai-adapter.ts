import { Logger } from '@maelstrom-co/client';
import type { Unsubscribe, VoiceSessionState } from '@maelstrom-co/client';
import type { ToolCallId, TokenHandshakeResponse } from '@maelstrom-co/protocol';

import type {
  AdapterAudioStreams,
  AdapterConnectOptions,
  RealtimeAdapterEvent,
  RealtimeProviderAdapter,
  RealtimeToolSpec,
} from '../realtime-session/provider-adapter.types.js';
import type { OpenAIAdapterOptions } from './openai-adapter.types.js';
import { RealtimeVoiceError } from '../realtime-voice-error.js';
import { asString, isRecord, parseOpenAIServerEvent } from './parse-openai-event.js';
import {
  INITIAL_RESPONSE_LIFECYCLE_STATE,
  markResponseActive,
  markResponseInactive,
  requestResponseCreate,
  type ResponseLifecycleState,
} from './response-lifecycle.js';
import { createUnexpectedEventTracker, type UnexpectedEventTracker } from './unexpected-event-tracker.js';
import { deriveVoiceActivity } from './voice-activity.js';

const REALTIME_CALLS_URL = 'https://api.openai.com/v1/realtime/calls';

/** Stable id for the single latest-wins grounding context item. */
const GROUNDING_ITEM_ID = 'maelstrom-grounding';

// ICE `disconnected` is often transient and self-recovers, so it is tolerated
// for this long before being treated as a fatal connection failure.
const ICE_DISCONNECT_GRACE_MS = 5000;

const DEFAULT_TRANSCRIPTION_MODEL = 'gpt-4o-mini-transcribe';

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
 * {@link parseOpenAIServerEvent}; this class is thin `RTCPeerConnection` glue
 * around it — the WebRTC transport itself is not unit-tested, but the
 * envelope parsing and response-lifecycle bookkeeping it delegates to are.
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
export class OpenAIAdapter implements RealtimeProviderAdapter {
  readonly #mintToken: () => Promise<TokenHandshakeResponse>;
  readonly #logger: Logger;
  readonly #transcription: false | { readonly model?: string } | undefined;
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
  // Bumped at the start of every connect() and in every teardown() so a
  // connect() whose async steps (mint, getUserMedia, SDP) are still in flight
  // can detect, once each await resumes, that a newer connect()/teardown
  // overtook it — and abort instead of clobbering the winner's shared state.
  #connectGeneration = 0;
  #iceGraceTimer: ReturnType<typeof setTimeout> | undefined;
  #responseLifecycle: ResponseLifecycleState = INITIAL_RESPONSE_LIFECYCLE_STATE;
  #voiceActivity: VoiceSessionState = 'connected';
  #unexpectedEvents: UnexpectedEventTracker = createUnexpectedEventTracker();

  constructor(options: OpenAIAdapterOptions) {
    this.#mintToken = options.mintToken;
    this.#transcription = options.transcription;
    this.#logger = new Logger(options.debug ?? false, 'OpenAIAdapter');
  }

  async connect(opts: AdapterConnectOptions): Promise<void> {
    if (this.#pc || this.#connecting) {
      throw new RealtimeVoiceError('ALREADY_CONNECTED', 'OpenAI realtime adapter is already connected');
    }
    this.#connecting = true;
    const generation = ++this.#connectGeneration;
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
      let token: TokenHandshakeResponse;
      try {
        token = await this.#mintToken();
      } catch (error) {
        throw new RealtimeVoiceError(
          'TOKEN_MINT_FAILED',
          'Failed to mint an ephemeral realtime token',
          error,
        );
      }
      this.#assertCurrent(generation);
      this.#logger.debug('connect timing', { step: 'mint', ms: Date.now() - connectStart });

      connection = new RTCPeerConnection();

      micStream = await this.#attachMicrophone(connection, connectStart);
      this.#assertCurrent(generation);

      // Past the post-getUserMedia check — this attempt is still current, so
      // publishing to the shared fields is safe.
      this.#pc = connection;
      this.#micStream = micStream;
      this.#connecting = false;
      this.#wireConnectionEvents(connection);
      this.#openDataChannel(connection, opts, connectStart);

      await this.#exchangeSdp(connection, token, connectStart);
      this.#assertCurrent(generation);
    } catch (error) {
      // Always close this attempt's own connection + mic. They may never have
      // reached the shared fields (e.g. a failure before the post-getUserMedia
      // publish), in which case teardown() alone wouldn't clean them up.
      this.#closeAbandonedAttempt(connection, micStream);
      if (generation === this.#connectGeneration) {
        // Still the current attempt — a genuine handshake failure. Reset the
        // rest of the shared session state (data channel, audio element,
        // lifecycle) so a retry starts clean. A superseded attempt skips this
        // so it never clobbers the winner's state.
        this.#teardown();
      }
      throw error;
    }
  }

  #assertCurrent(generation: number): void {
    if (generation !== this.#connectGeneration) {
      throw new RealtimeVoiceError(
        'CONNECT_SUPERSEDED',
        'connect() was superseded by a newer connect() or teardown',
      );
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

  async sendToolResult(callId: ToolCallId, output: unknown): Promise<void> {
    this.#logger.debug('→ sendToolResult', { callId, output });
    if (!this.#dc || this.#dc.readyState !== 'open') {
      this.#emit({
        type: 'error',
        error: new Error(`sendToolResult: data channel not open (callId=${callId})`),
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
      // Only one response.create may be in flight at a time — if a prior
      // response (e.g. one still driving another tool call) hasn't
      // finished, defer this one; `response.done` flushes it later.
      const { next, sendNow } = requestResponseCreate(this.#responseLifecycle);
      this.#responseLifecycle = next;
      if (sendNow) this.#sendResponseCreate();
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
          JSON.stringify({ type: 'conversation.item.delete', item_id: GROUNDING_ITEM_ID }),
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
          error: new RealtimeVoiceError('CONNECTION_FAILED', 'ICE connection failed'),
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
              error: new RealtimeVoiceError('CONNECTION_FAILED', 'ICE connection disconnected'),
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

  // Returns the acquired stream rather than self-assigning `#micStream`, so
  // connect() can publish it to the shared field only after confirming this
  // attempt hasn't been superseded.
  async #attachMicrophone(connection: RTCPeerConnection, connectStart: number): Promise<MediaStream> {
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (error) {
      const name = (error as { name?: unknown } | null)?.name;
      throw name === 'NotAllowedError' || name === 'PermissionDeniedError'
        ? new RealtimeVoiceError('MIC_PERMISSION_DENIED', 'Microphone permission was denied', error)
        : new RealtimeVoiceError('CONNECTION_FAILED', 'Failed to acquire the microphone', error);
    }
    this.#logger.debug('connect timing', { step: 'getUserMedia', ms: Date.now() - connectStart });
    for (const track of stream.getTracks()) {
      connection.addTrack(track, stream);
    }
    return stream;
  }

  #openDataChannel(
    connection: RTCPeerConnection,
    opts: AdapterConnectOptions,
    connectStart: number,
  ): void {
    const channel = connection.createDataChannel('oai-events');
    this.#dc = channel;
    channel.onopen = () => {
      this.#logger.debug('connect timing', { step: 'dataChannelOpen', ms: Date.now() - connectStart });
      const sessionUpdate = {
        type: 'session.update',
        session: {
          type: 'realtime',
          tools: opts.tools.map(toOpenAITool),
          instructions: opts.instructions,
          ...this.#transcriptionConfig(),
        },
      };
      this.#logger.debug('→ session.update', sessionUpdate);
      channel.send(JSON.stringify(sessionUpdate));
    };
    channel.onmessage = (event: MessageEvent) => {
      this.#handleDataChannelMessage(event.data as unknown);
    };
    channel.onerror = () => {
      this.#emit({
        type: 'error',
        error: new RealtimeVoiceError('DATA_CHANNEL_ERROR', 'OpenAI realtime data channel error'),
      });
    };
  }

  async #exchangeSdp(
    connection: RTCPeerConnection,
    token: TokenHandshakeResponse,
    connectStart: number,
  ): Promise<void> {
    const offer = await connection.createOffer();
    await connection.setLocalDescription(offer);

    const sdp = connection.localDescription?.sdp;
    if (!sdp) {
      throw new RealtimeVoiceError('CONNECTION_FAILED', 'Failed to create a local SDP offer');
    }

    const response = await fetch(REALTIME_CALLS_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token.value}`,
        'Content-Type': 'application/sdp',
      },
      body: sdp,
    });

    if (!response.ok) {
      throw new RealtimeVoiceError(
        'CONNECTION_FAILED',
        `OpenAI realtime call setup failed with status ${response.status}`,
      );
    }

    const answerSdp = await response.text();
    this.#logger.debug('connect timing', { step: 'sdpExchange', ms: Date.now() - connectStart });
    await connection.setRemoteDescription({ type: 'answer', sdp: answerSdp });
    this.#logger.debug('connect timing', {
      step: 'setRemoteDescription',
      ms: Date.now() - connectStart,
    });
  }

  // The `audio.input.transcription` slice of session.update, or nothing when
  // transcription is disabled. GA `type: 'realtime'` nests transcription under
  // `audio.input`, not the legacy top-level `input_audio_transcription`.
  #transcriptionConfig(): Record<string, unknown> {
    if (this.#transcription === false) return {};
    const model = this.#transcription?.model ?? DEFAULT_TRANSCRIPTION_MODEL;
    return { audio: { input: { transcription: { model } } } };
  }

  #sendResponseCreate(): void {
    this.#dc?.send(JSON.stringify({ type: 'response.create' }));
  }

  #emit(event: RealtimeAdapterEvent): void {
    for (const handler of this.#handlers) handler(event);
  }

  #teardown(): void {
    // Invalidate any connect() still mid-handshake so it abandons its own
    // attempt instead of clobbering shared state when its awaits resume.
    this.#connectGeneration++;
    this.#clearIceGraceTimer();
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
    this.#responseLifecycle = INITIAL_RESPONSE_LIFECYCLE_STATE;
    this.#voiceActivity = 'connected';
    this.#unexpectedEvents = createUnexpectedEventTracker();
  }

  #handleDataChannelMessage(raw: unknown): void {
    let parsed: unknown;
    try {
      parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch (error) {
      this.#logger.error('← data-channel parse error', raw, error);
      this.#emit({ type: 'error', error });
      return;
    }
    const type = isRecord(parsed) ? asString(parsed.type) : undefined;
    // Noisy transcript deltas flood the console — log only their type.
    if (type === 'response.audio_transcript.delta') {
      this.#logger.debug('←', type);
    } else {
      this.#logger.debug('←', type, parsed);
    }

    // Response-lifecycle bookkeeping is driven off the raw event type, not
    // the parsed adapter event — `parseOpenAIServerEvent` has no mapping for
    // these (and shouldn't grow one just for this internal concern).
    // `response.done` is terminal for every outcome (its `response.status`
    // field carries completed/cancelled/failed/incomplete) — there is no
    // separate `response.cancelled` server event.
    if (type === 'response.created') {
      this.#responseLifecycle = markResponseActive(this.#responseLifecycle);
    } else if (type === 'response.done') {
      const { next, flush } = markResponseInactive(this.#responseLifecycle);
      this.#responseLifecycle = next;
      if (flush) this.#sendResponseCreate();
    }

    if (type !== undefined) {
      const nextActivity = deriveVoiceActivity(this.#voiceActivity, type);
      if (nextActivity !== null && nextActivity !== this.#voiceActivity) {
        this.#voiceActivity = nextActivity;
        this.#emit({ type: 'state', state: nextActivity });
      }
    }

    const event = parseOpenAIServerEvent(parsed);
    if (event) {
      this.#logger.debug('parsed →', event.type, event);
      this.#emit(event);
    } else {
      this.#logger.debug('unrecognized or unparsed event', type, parsed);
      if (type !== undefined && this.#unexpectedEvents.track(type)) {
        this.#logger.warn('unexpected realtime event type', type);
      }
    }
  }
}
