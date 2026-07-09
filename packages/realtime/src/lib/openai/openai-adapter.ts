import { Logger } from '@maelstrom-co/client';
import type { Unsubscribe } from '@maelstrom-co/client';
import type { TokenHandshakeResponse } from '@maelstrom-co/protocol';

import type {
  AdapterConnectOptions,
  RealtimeAdapterEvent,
  RealtimeProviderAdapter,
  RealtimeToolSpec,
} from '../provider-adapter.types.js';
import { parseOaiServerEvent } from './parse-oai-event.js';
import {
  INITIAL_RESPONSE_LIFECYCLE_STATE,
  markResponseActive,
  markResponseInactive,
  requestResponseCreate,
  type ResponseLifecycleState,
} from './response-lifecycle.js';
import { createUnexpectedEventTracker } from './unexpected-event-tracker.js';

const REALTIME_CALLS_URL = 'https://api.openai.com/v1/realtime/calls';

/** Stable id for the single latest-wins grounding context item. */
const GROUNDING_ITEM_ID = 'maelstrom-grounding';

/** Options for {@link createOpenAiAdapter}. */
export interface CreateOpenAiAdapterOptions {
  /**
   * Mints the ephemeral OpenAI realtime client secret this adapter connects
   * with. Called once per `connect()`. The token handshake is assigned to
   * the adapter — `RealtimeSession` never sees a credential.
   */
  readonly mintToken: () => Promise<TokenHandshakeResponse>;
  /** Enable verbose debug tracing (default false). */
  readonly debug?: boolean;
}

function toOaiTool(spec: RealtimeToolSpec): unknown {
  return {
    type: 'function',
    name: spec.name,
    description: spec.description,
    parameters: spec.parametersJsonSchema,
  };
}

/**
 * Creates a {@link RealtimeProviderAdapter} that connects the browser
 * directly to OpenAI `gpt-realtime` over WebRTC: mints an ephemeral client
 * secret via the injected `mintToken`, exchanges SDP with
 * `POST /v1/realtime/calls`, and drives tool calls / grounding pushes over
 * the `oai-events` data channel.
 *
 * The data-channel envelope → adapter-event mapping lives in
 * {@link parseOaiServerEvent}; this factory is thin `RTCPeerConnection` glue
 * around it — the WebRTC transport itself is not unit-tested, but the
 * envelope parsing and response-lifecycle bookkeeping it delegates to are.
 *
 * @example
 * ```ts
 * const adapter = createOpenAiAdapter({
 *   mintToken: () => fetch('/api/realtime/mint', { method: 'POST', ... }).then(r => r.json()),
 * });
 * const session = new RealtimeSession({ adapter, instance, sessionId });
 * await session.connect();
 * ```
 */
export function createOpenAiAdapter(options: CreateOpenAiAdapterOptions): RealtimeProviderAdapter {
  const { mintToken } = options;
  const logger = new Logger(options.debug ?? false, 'realtime');

  let pc: RTCPeerConnection | undefined;
  let dc: RTCDataChannel | undefined;
  let micStream: MediaStream | undefined;
  let groundingItemExists = false;
  // Guards the window between connect() being called and `pc` being
  // assigned — `mintToken()` is the first await, so without this a second
  // connect() during that round-trip would pass the `pc` check too and leak
  // its own RTCPeerConnection + mic stream.
  let connecting = false;
  let responseLifecycle: ResponseLifecycleState = INITIAL_RESPONSE_LIFECYCLE_STATE;
  let unexpectedEvents = createUnexpectedEventTracker();
  const handlers = new Set<(event: RealtimeAdapterEvent) => void>();

  function sendResponseCreate(): void {
    dc?.send(JSON.stringify({ type: 'response.create' }));
  }

  function emit(event: RealtimeAdapterEvent): void {
    for (const handler of handlers) handler(event);
  }

  function teardown(): void {
    dc?.close();
    if (pc) {
      for (const sender of pc.getSenders()) {
        sender.track?.stop();
      }
      pc.close();
    }
    micStream?.getTracks().forEach((track) => {
      track.stop();
    });
    pc = undefined;
    dc = undefined;
    micStream = undefined;
    groundingItemExists = false;
    connecting = false;
    responseLifecycle = INITIAL_RESPONSE_LIFECYCLE_STATE;
    unexpectedEvents = createUnexpectedEventTracker();
  }

  function handleDataChannelMessage(raw: unknown): void {
    let parsed: unknown;
    try {
      parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch (error) {
      logger.error('← data-channel parse error', raw, error);
      emit({ type: 'error', error });
      return;
    }
    const type = (parsed as { type?: unknown })?.type;
    // Noisy transcript deltas flood the console — log only their type.
    if (type === 'response.audio_transcript.delta') {
      logger.debug('←', type);
    } else {
      logger.debug('←', type, parsed);
    }

    // Response-lifecycle bookkeeping is driven off the raw event type, not
    // the parsed adapter event — `parseOaiServerEvent` has no mapping for
    // these (and shouldn't grow one just for this internal concern).
    if (type === 'response.created') {
      responseLifecycle = markResponseActive(responseLifecycle);
    } else if (type === 'response.done' || type === 'response.cancelled') {
      const { next, flush } = markResponseInactive(responseLifecycle);
      responseLifecycle = next;
      if (flush) sendResponseCreate();
    }

    const event = parseOaiServerEvent(parsed);
    if (event) {
      logger.debug('parsed →', event.type, event);
      emit(event);
    } else {
      logger.debug('unrecognized or unparsed event', type, parsed);
      if (typeof type === 'string' && unexpectedEvents.track(type)) {
        logger.warn('unexpected realtime event type', type);
      }
    }
  }

  return {
    async connect(opts: AdapterConnectOptions): Promise<void> {
      if (pc || connecting) {
        throw new Error('OpenAI realtime adapter is already connected');
      }
      connecting = true;

      try {
        const token = await mintToken();

        const connection = new RTCPeerConnection();
        pc = connection;
        connecting = false;

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
            emit({ type: 'error', error: new Error(`ICE connection ${connection.iceConnectionState}`) });
          }
        };

        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        micStream = stream;
        for (const track of stream.getTracks()) {
          connection.addTrack(track, stream);
        }

        const channel = connection.createDataChannel('oai-events');
        dc = channel;
        channel.onopen = () => {
          const sessionUpdate = {
            type: 'session.update',
            session: {
              type: 'realtime',
              tools: opts.tools.map(toOaiTool),
              instructions: opts.instructions,
            },
          };
          logger.debug('→ session.update', sessionUpdate);
          channel.send(JSON.stringify(sessionUpdate));
        };
        channel.onmessage = (event: MessageEvent) => {
          handleDataChannelMessage(event.data as unknown);
        };
        channel.onerror = () => {
          emit({ type: 'error', error: new Error('OpenAI realtime data channel error') });
        };

        const offer = await connection.createOffer();
        await connection.setLocalDescription(offer);

        const sdp = connection.localDescription?.sdp;
        if (!sdp) {
          throw new Error('Failed to create a local SDP offer');
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
          throw new Error(`OpenAI realtime call setup failed with status ${response.status}`);
        }

        const answerSdp = await response.text();
        await connection.setRemoteDescription({ type: 'answer', sdp: answerSdp });
      } catch (error) {
        // Handshake failed partway through — tear down whatever was already
        // opened (mic stream, data channel, peer connection) so a retry
        // doesn't leak them, then let the caller's `connect()` await reject.
        teardown();
        throw error;
      }
    },

    async disconnect(): Promise<void> {
      teardown();
    },

    async sendToolResult(callId: string, output: unknown): Promise<void> {
      logger.debug('→ sendToolResult', { callId, output });
      if (!dc || dc.readyState !== 'open') {
        emit({
          type: 'error',
          error: new Error(`sendToolResult: data channel not open (callId=${callId})`),
        });
        return;
      }
      try {
        dc.send(
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
        const { next, sendNow } = requestResponseCreate(responseLifecycle);
        responseLifecycle = next;
        if (sendNow) sendResponseCreate();
      } catch (error) {
        emit({ type: 'error', error });
      }
    },

    injectGrounding(text: string): void {
      if (!dc || dc.readyState !== 'open') {
        emit({ type: 'error', error: new Error('injectGrounding: data channel not open') });
        return;
      }
      try {
        if (groundingItemExists) {
          dc.send(JSON.stringify({ type: 'conversation.item.delete', item_id: GROUNDING_ITEM_ID }));
        }
        dc.send(
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
        groundingItemExists = true;
      } catch (error) {
        emit({ type: 'error', error });
      }
    },

    on(handler: (event: RealtimeAdapterEvent) => void): Unsubscribe {
      handlers.add(handler);
      return () => {
        handlers.delete(handler);
      };
    },
  };
}
