import { Logger } from '@maelstrom-co/client';
import type { Unsubscribe, VoiceSessionState } from '@maelstrom-co/client';
import type { ToolCallId, TokenHandshakeResponse } from '@maelstrom-co/protocol';

import type {
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
  readonly #handlers = new Set<(event: RealtimeAdapterEvent) => void>();

  #pc: RTCPeerConnection | undefined;
  #dc: RTCDataChannel | undefined;
  #micStream: MediaStream | undefined;
  #groundingItemExists = false;
  // Guards the window between connect() being called and `#pc` being
  // assigned — `mintToken()` is the first await, so without this a second
  // connect() during that round-trip would pass the `#pc` check too and leak
  // its own RTCPeerConnection + mic stream.
  #connecting = false;
  #responseLifecycle: ResponseLifecycleState = INITIAL_RESPONSE_LIFECYCLE_STATE;
  #voiceActivity: VoiceSessionState = 'connected';
  #unexpectedEvents: UnexpectedEventTracker = createUnexpectedEventTracker();

  constructor(options: OpenAIAdapterOptions) {
    this.#mintToken = options.mintToken;
    this.#logger = new Logger(options.debug ?? false, 'OpenAIAdapter');
  }

  async connect(opts: AdapterConnectOptions): Promise<void> {
    if (this.#pc || this.#connecting) {
      throw new RealtimeVoiceError('ALREADY_CONNECTED', 'OpenAI realtime adapter is already connected');
    }
    this.#connecting = true;
    // Captured by the data channel's onopen closure below so a slow ICE/DTLS
    // establishment (the gap between SDP exchange and channel open) is
    // attributable rather than folded into an opaque "connect() was slow".
    const connectStart = Date.now();

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
      this.#logger.debug('connect timing', { step: 'mint', ms: Date.now() - connectStart });

      const connection = new RTCPeerConnection();
      this.#pc = connection;
      this.#connecting = false;
      this.#wireConnectionEvents(connection);

      await this.#attachMicrophone(connection, connectStart);
      this.#openDataChannel(connection, opts, connectStart);

      await this.#exchangeSdp(connection, token, connectStart);
    } catch (error) {
      // Handshake failed partway through — tear down whatever was already
      // opened (mic stream, data channel, peer connection) so a retry
      // doesn't leak them, then let the caller's `connect()` await reject.
      this.#teardown();
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    this.#teardown();
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
    connection.ontrack = (event) => {
      audio.srcObject = event.streams[0] ?? null;
    };
    connection.oniceconnectionstatechange = () => {
      if (
        connection.iceConnectionState === 'failed' ||
        connection.iceConnectionState === 'disconnected'
      ) {
        this.#emit({
          type: 'error',
          error: new RealtimeVoiceError(
            'CONNECTION_FAILED',
            `ICE connection ${connection.iceConnectionState}`,
          ),
        });
      }
    };
  }

  async #attachMicrophone(connection: RTCPeerConnection, connectStart: number): Promise<void> {
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
    this.#micStream = stream;
    for (const track of stream.getTracks()) {
      connection.addTrack(track, stream);
    }
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

  #sendResponseCreate(): void {
    this.#dc?.send(JSON.stringify({ type: 'response.create' }));
  }

  #emit(event: RealtimeAdapterEvent): void {
    for (const handler of this.#handlers) handler(event);
  }

  #teardown(): void {
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
