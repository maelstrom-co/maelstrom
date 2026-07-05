import type { Unsubscribe } from '@maelstrom-co/client';
import type { TokenHandshakeResponse } from '@maelstrom-co/protocol';

import type {
  AdapterConnectOptions,
  RealtimeAdapterEvent,
  RealtimeProviderAdapter,
  RealtimeToolSpec,
} from '../provider-adapter.types.js';
import { parseOaiServerEvent } from './parse-oai-event.js';

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
 * {@link parseOaiServerEvent}; this class is thin `RTCPeerConnection` glue
 * around it and is exercised end-to-end in the demo spike rather than
 * unit-tested.
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

  let pc: RTCPeerConnection | undefined;
  let dc: RTCDataChannel | undefined;
  let micStream: MediaStream | undefined;
  let groundingItemExists = false;
  const handlers = new Set<(event: RealtimeAdapterEvent) => void>();

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
    micStream?.getTracks().forEach((track) => track.stop());
    pc = undefined;
    dc = undefined;
    micStream = undefined;
    groundingItemExists = false;
  }

  function handleDataChannelMessage(raw: unknown): void {
    let parsed: unknown;
    try {
      parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch (error) {
      emit({ type: 'error', error });
      return;
    }
    const event = parseOaiServerEvent(parsed);
    if (event) emit(event);
  }

  return {
    async connect(opts: AdapterConnectOptions): Promise<void> {
      if (pc) {
        throw new Error('OpenAI realtime adapter is already connected');
      }

      const token = await mintToken();

      const connection = new RTCPeerConnection();
      pc = connection;

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

      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        micStream = stream;
        for (const track of stream.getTracks()) {
          connection.addTrack(track, stream);
        }

        const channel = connection.createDataChannel('oai-events');
        dc = channel;
        channel.onopen = () => {
          channel.send(
            JSON.stringify({
              type: 'session.update',
              session: {
                type: 'realtime',
                tools: opts.tools.map(toOaiTool),
                instructions: opts.instructions,
              },
            }),
          );
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
        dc.send(JSON.stringify({ type: 'response.create' }));
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
