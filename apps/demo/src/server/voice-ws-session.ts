import type { Engine } from '@maelstrom-co/engine';
import {
  AssistantInjectionMessage,
  type ChartRequest,
  type ChartRequestMessage,
  ChartRequestMessageSchema,
  type GridLayout,
  isErr,
  MessageId,
  type SessionId,
  type TilingLayout,
  type VoiceClientMessage,
  type VoiceServerMessage,
} from '@maelstrom-co/protocol';
import type { AudioChunk, VoiceSession } from '@maelstrom-co/voice-server';

type WsTransport = {
  sendMessage: (message: VoiceServerMessage) => void;
  sendEngineError: (error: string, requestId?: MessageId) => void;
};

type BinaryAudioSender = (data: ArrayBuffer | Blob) => Promise<void>;

interface DemoVoiceWsSessionControllerOptions {
  sessionId: SessionId;
  voiceSession: VoiceSession | null;
  engine: Engine;
  transport: WsTransport;
  forwardBinaryAudioInput: BinaryAudioSender;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof error.message === 'string'
  ) {
    return error.message;
  }
  return String(error);
}

function normalizeAudioData(data: unknown): Uint8Array | null {
  if (data instanceof Uint8Array) {
    return data;
  }

  if (Array.isArray(data)) {
    return Uint8Array.from(data);
  }

  if (typeof data === 'object' && data !== null) {
    const byteValues = Object.values(data).filter(
      (value): value is number => typeof value === 'number',
    );

    return byteValues.length > 0 ? Uint8Array.from(byteValues) : null;
  }

  return null;
}

function isAudioEncoding(value: string): value is AudioChunk['encoding'] {
  return value === 'linear16' || value === 'opus' || value === 'pcm';
}

/**
 * Re-attach the layout discriminator after `safeParse`. `GridLayoutSchema` /
 * `TilingLayoutSchema` don't model the `type` field that the hand-written
 * `GridLayout` / `TilingLayout` interfaces carry, so Zod strips it on parse —
 * but the prompt builder gates on `layout.type`. `context.layoutMode` is the
 * authoritative source for which branch we have.
 */
function reattachLayoutDiscriminator(request: ChartRequest): ChartRequest {
  if (request.context.layoutMode === 'grid') {
    const grid = request.layout as GridLayout;
    return { ...request, layout: { ...grid, type: 'grid' } };
  }
  const tiling = request.layout as TilingLayout;
  return { ...request, layout: { ...tiling, type: 'tiling' } };
}

function extractRequestIdHint(raw: unknown): MessageId | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const id = (raw as { id?: unknown }).id;
  return typeof id === 'string' && id.length > 0 ? MessageId(id) : undefined;
}

export function createDemoVoiceWsSessionController(
  options: DemoVoiceWsSessionControllerOptions,
) {
  const {
    sessionId,
    voiceSession,
    engine,
    transport,
    forwardBinaryAudioInput,
  } = options;

  const { sendMessage, sendEngineError } = transport;
  let latestChartRequest: ChartRequest | null = null;
  // Identity-keyed map from the ChartRequest passed to voiceSession.processRequest
  // to the originating client envelope id. The adapter looks up by reference inside
  // processIntent so explicit responses correlate with the client's pending promise
  // instead of the synthetic `voice-…` id used for STT-driven turns. WeakMap (vs.
  // a single slot) lets concurrent client.maelstrom.process turns coexist without
  // clobbering each other's correlation. STT turns build a fresh ChartRequest in
  // the adapter, never write here, and naturally fall through to the synthetic id.
  const explicitRequestIdByRef = new WeakMap<ChartRequest, MessageId>();

  const reportEngineError = (
    context: string,
    error: unknown,
    requestId?: MessageId,
  ) => {
    const message = getErrorMessage(error);
    console.error(`${context}: ${message}`);
    sendEngineError(message, requestId);
  };

  const forwardAudioInput = (audio: AudioChunk) => {
    voiceSession?.sendAudioChunk(audio);
  };

  const startListeningIfNeeded = (errorMessage: string) => {
    if (!voiceSession || voiceSession.getVoiceState() === 'listening') {
      return;
    }

    void voiceSession.startListening().catch((err: unknown) => {
      reportEngineError(errorMessage, err);
    });
  };

  const stopListeningIfActive = (errorMessage: string) => {
    if (!voiceSession || voiceSession.getVoiceState() !== 'listening') {
      return;
    }

    void voiceSession.stopListening().catch((err: unknown) => {
      reportEngineError(errorMessage, err);
    });
  };

  const handleSpeechStart = (timestamp: number) => {
    if (!voiceSession) {
      return;
    }

    if (voiceSession.getVoiceState() === 'speaking') {
      voiceSession.interrupt();
    }

    voiceSession.handleVADEvent({
      type: 'speech_start',
      timestamp,
    });

    startListeningIfNeeded('[Demo WS] Cannot restart listening');
  };

  const handleSpeechEnd = (timestamp: number) => {
    voiceSession?.handleVADEvent({
      type: 'speech_end',
      timestamp,
    });
  };

  const handleSpeakCommand = async (text: string) => {
    if (!voiceSession) {
      return;
    }

    console.log(`[Demo WS] Speaking: "${text.substring(0, 50)}..."`);
    try {
      await voiceSession.speak(text);
    } catch (err: unknown) {
      reportEngineError('[Demo WS] Speak error', err);
    }
  };

  const handleAddAssistantMessage = async (message: {
    id: string;
    message: string;
  }) => {
    console.log(
      `[Demo WS] Adding assistant message: "${message.message.substring(0, 50)}..."`,
    );
    const messageId = MessageId(message.id);
    const envelope = AssistantInjectionMessage({
      sessionId,
      id: messageId,
      content: message.message,
    });
    const result = await engine.handle(envelope);
    if (isErr(result)) {
      reportEngineError(
        '[Demo WS] Add assistant message error',
        result.error,
        messageId,
      );
    }
  };

  const handleMaelstromProcess = async (
    message: VoiceClientMessage & {
      type: 'client.maelstrom.process';
    },
  ) => {
    // JSON.parse on the WS frame yields a typed-but-untrusted envelope.
    // safeParse against the wire schema before it reaches the voice runtime
    // or engine, and reject with a correlated engine.error on shape failure.
    const parsed = ChartRequestMessageSchema.safeParse(message.request);
    if (!parsed.success) {
      reportEngineError(
        '[Demo WS] Invalid chart_request envelope',
        parsed.error,
        extractRequestIdHint(message.request),
      );
      return;
    }
    // Reattach layout.type before handing the request downstream — see
    // `reattachLayoutDiscriminator`. The cast around the envelope itself
    // is type-only: `z.infer` types `layout` without `type`, even though
    // the runtime data carries it.
    const validated = parsed.data as unknown as ChartRequestMessage;
    const chartRequest = reattachLayoutDiscriminator(validated.request);
    const envelope: ChartRequestMessage = { ...validated, request: chartRequest };
    latestChartRequest = chartRequest;

    if (voiceSession) {
      explicitRequestIdByRef.set(chartRequest, envelope.id);
      try {
        const response = await voiceSession.processRequest(chartRequest, {
          speakResponse: chartRequest.context.updateReasons.some(
            (reason) => reason.type === 'user_intent',
          ),
        });
        // processRequest resolves to undefined when the voice runtime aborted,
        // was destroyed, was superseded by a newer turn, or absorbed a thrown
        // intent error. The supersession case is the dominant one. The
        // adapter's own catch already emits a correlated engine.error for
        // thrown errors, so a frame here is a benign duplicate in that case;
        // we still need this branch so the supersession case doesn't leave
        // the client's pending promise hanging until timeout.
        if (response === undefined) {
          sendEngineError(
            'Request superseded before intent processing',
            envelope.id,
          );
        }
      } catch (err) {
        // Voice runtime catches processIntent throws and returns undefined
        // (see runtime.executeIntentRequest). This branch is defensive: if
        // that absorption ever changes, we still want a correlated
        // engine.error rather than the silent timeout the client would
        // otherwise observe.
        reportEngineError('[Demo WS] processRequest error', err, envelope.id);
      }
      return;
    }

    const result = await engine.handle(envelope);
    if (isErr(result)) {
      reportEngineError('[Demo WS] engine.handle error', result.error, envelope.id);
      return;
    }
    if (result.value.type !== 'chart_response') {
      // Defensive against a future EngineOutput variant. chart_request inputs
      // route to chart_response today; surface a correlated error rather than
      // letting the client's pending promise hang.
      reportEngineError(
        '[Demo WS] Unexpected engine output for chart_request',
        new Error(`got ${result.value.type}, expected chart_response`),
        envelope.id,
      );
      return;
    }
    sendMessage({
      type: 'engine.maelstrom.response',
      sessionId,
      requestId: result.value.id,
      response: result.value.response,
    });
  };

  return {
    getLatestChartRequest() {
      return latestChartRequest;
    },

    getExplicitRequestId(request: ChartRequest): MessageId | null {
      const id = explicitRequestIdByRef.get(request);
      if (id === undefined) {
        return null;
      }
      // Delete so a buggy double-read can't replay a stale id; the WeakMap
      // would also drop the entry once the request is GC'd, but explicit
      // delete tightens the contract.
      explicitRequestIdByRef.delete(request);
      return id;
    },

    async onOpen() {
      console.log(`[Demo WS] WebSocket opened for session: ${sessionId}`);

      if (voiceSession) {
        try {
          await voiceSession.warmup();
        } catch (err: unknown) {
          reportEngineError('[Demo WS] Warmup failed', err);
          return;
        }

        sendMessage({
          type: 'engine.stt.ready',
          sessionId,
          timestamp: performance.now(),
        });
      }
    },

    async onMessage(data: unknown) {
      try {
        if (data instanceof ArrayBuffer || data instanceof Blob) {
          await forwardBinaryAudioInput(data);
          return;
        }

        const message = JSON.parse(String(data)) as VoiceClientMessage;

        console.log(`[Demo WS] Received message: ${message.type}`);
        switch (message.type) {
          case 'client.voice.speak':
            await handleSpeakCommand(message.text);
            break;
          case 'client.history.add_assistant_message':
            await handleAddAssistantMessage(message);
            break;
          case 'client.audio_capture.audio_sent':
            {
              const normalizedAudio = normalizeAudioData(message.data);
              if (!normalizedAudio) {
                sendEngineError('Unsupported audio payload shape');
                break;
              }

              if (!isAudioEncoding(message.encoding)) {
                sendEngineError('Unsupported audio encoding');
                break;
              }

              forwardAudioInput({
                data: normalizedAudio,
                sampleRate: message.sampleRate,
                encoding: message.encoding,
                timestamp: message.timestamp,
              });
            }
            break;
          case 'client.maelstrom.process':
            await handleMaelstromProcess(message);
            break;
          case 'client.audio_capture.ready':
            console.log('[Demo WS] Client audio capture ready');
            startListeningIfNeeded(
              '[Demo WS] Cannot start listening on audio capture ready',
            );
            break;
          case 'client.audio_capture.closed':
            console.log('[Demo WS] Client audio capture closed');
            stopListeningIfActive(
              '[Demo WS] Cannot stop listening on audio capture closed',
            );
            break;
          case 'client.vad.speech_start':
            console.log('[Demo WS] VAD detected speech start');
            handleSpeechStart(message.timestamp);
            break;
          case 'client.vad.speech_end':
            console.log('[Demo WS] VAD detected speech end');
            handleSpeechEnd(message.timestamp);
            break;
          default:
            console.warn(
              `Unknown message type: ${(message as { type: string }).type}`,
            );
        }
      } catch (error) {
        reportEngineError('WebSocket message error', error);
      }
    },

    onClose() {
      voiceSession?.destroy();
    },

    onError(error: unknown) {
      console.error(
        `WebSocket error: ${error instanceof Error ? error.message : String(error)}`,
      );
      voiceSession?.destroy();
    },
  };
}
