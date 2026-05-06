import type { Engine } from '@maelstrom-co/engine-old';
import type {
  ChartRequest,
  ChartRequestMessage,
  MessageId,
  VoiceClientMessage,
  VoiceServerMessage,
} from '@maelstrom-co/protocol';
import type { AudioChunk, VoiceSession } from '@maelstrom-co/voice-server';

import { adaptEnvelopeToLegacyRequest } from './legacy-engine-adapter.js';
import { toProtocolResponse } from './voice-intent-adapter.js';

type WsTransport = {
  sendMessage: (message: VoiceServerMessage) => void;
  sendEngineError: (error: string, requestId?: MessageId) => void;
};

type BinaryAudioSender = (data: ArrayBuffer | Blob) => Promise<void>;

interface DemoVoiceWsSessionControllerOptions {
  sessionId: string;
  voiceSession: VoiceSession | null;
  engine: Pick<Engine, 'process' | 'addAssistantMessage'>;
  transport: WsTransport;
  forwardBinaryAudioInput: BinaryAudioSender;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
  // Identity-keyed map from the ChartRequest that enters voiceSession.processRequest
  // to the originating client envelope id. The adapter looks up by reference inside
  // processIntent so explicit responses correlate with the client's pending promise
  // instead of the synthetic `voice-…` id used for STT-driven turns. WeakMap (vs.
  // a single slot) prevents two concurrent client.maelstrom.process turns — or an
  // STT turn racing an explicit one — from clobbering each other's correlation.
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
    try {
      await engine.addAssistantMessage({
        id: message.id,
        sessionId,
        message: message.message,
      });
    } catch (err: unknown) {
      reportEngineError('[Demo WS] Add assistant message error', err);
    }
  };

  const handleMaelstromProcess = async (
    message: VoiceClientMessage & {
      type: 'client.maelstrom.process';
    },
  ) => {
    // The wire payload's `request` field is a new-protocol ChartRequestMessage
    // envelope; the protocol-old type still labels it as a legacy ChartRequest,
    // so cast at the boundary.
    const envelope = message.request as unknown as ChartRequestMessage;
    const chartRequest = envelope.request;
    latestChartRequest = chartRequest;

    if (voiceSession) {
      explicitRequestIdByRef.set(chartRequest, envelope.id);
      try {
        const response = await voiceSession.processRequest(chartRequest, {
          speakResponse: chartRequest.context.updateReasons.some(
            (reason) => reason.type === 'user_intent',
          ),
        });
        // `processRequest` resolves to undefined when the runtime aborted
        // before the intent boundary ran (e.g. an STT turn superseded this
        // explicit one). The adapter never reached its emit path, so the
        // client's pending promise would otherwise time out — surface a
        // correlated engine.error instead.
        if (response === undefined) {
          sendEngineError(
            'Request superseded before intent processing',
            envelope.id,
          );
        }
      } catch (err) {
        // Voice runtime normally swallows processIntent errors via its onError
        // pipeline; this catch is a defensive fallback so a future runtime change
        // that lets exceptions bubble still produces a correlated engine.error.
        reportEngineError('[Demo WS] processRequest error', err, envelope.id);
      }
      return;
    }

    try {
      const legacyResponse = await engine.process(
        adaptEnvelopeToLegacyRequest(envelope),
      );
      sendMessage({
        type: 'engine.maelstrom.response',
        sessionId,
        requestId: envelope.id,
        response: toProtocolResponse(legacyResponse),
      });
    } catch (err) {
      reportEngineError('[Demo WS] engine.process error', err, envelope.id);
    }
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
