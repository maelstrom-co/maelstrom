import type { Engine } from '@maelstrom-co/engine-old';
import type { ChartRequest, ChartRequestMessage } from '@maelstrom-co/protocol';
import type {
  ChartRequest as LegacyChartRequest,
  MaelstromResponse as LegacyMaelstromResponse,
  VoiceClientMessage,
  VoiceServerMessage,
} from '@maelstrom-co/protocol-old';
import type { AudioChunk, VoiceSession } from '@maelstrom-co/voice-server';

import { adaptEnvelopeToLegacyRequest } from './legacy-engine-adapter.js';
import { toProtocolChartRequest } from './voice-intent-adapter.js';

type WsTransport = {
  sendMessage: (message: VoiceServerMessage) => void;
  sendEngineError: (error: string) => void;
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

function mirrorChartRequest(request: LegacyChartRequest): ChartRequest {
  const protocolRequest = toProtocolChartRequest(request);

  return {
    type: protocolRequest.type,
    context: {
      updateReasons: protocolRequest.context.updateReasons.map((reason) => ({
        ...reason,
      })),
      chartDimensions: protocolRequest.context.chartDimensions,
      layoutMode: protocolRequest.context.layoutMode,
    },
    instances: protocolRequest.instances.map((instance) => ({
      instanceId: instance.instanceId,
      vesselId: instance.vesselId,
      variant: instance.variant,
    })),
    vessels: protocolRequest.vessels.map((vessel) => vessel),
    layout:
      protocolRequest.layout.type === 'grid'
        ? {
            type: 'grid',
            positions: protocolRequest.layout.positions.map((position) => ({
              instanceId: position.instanceId,
              position: position.position,
              size: position.size,
            })),
          }
        : {
            type: 'tiling',
            tree: protocolRequest.layout.tree.map((node) => node),
            instances: protocolRequest.layout.instances.map((instance) => ({
              instanceId: instance.instanceId,
              vesselId: instance.vesselId,
              variant: instance.variant,
            })),
          },
  };
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

  const reportEngineError = (context: string, error: unknown) => {
    const message = getErrorMessage(error);
    console.error(`${context}: ${message}`);
    sendEngineError(message);
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
    request: VoiceClientMessage & {
      type: 'client.maelstrom.process';
    },
  ) => {
    // Wire format carries a ChartRequestMessage envelope (MAE-148), not the
    // legacy flat ChartRequest that protocol-old types suggest.
    const envelope = request.request as unknown as ChartRequestMessage;
    const legacyRequest = adaptEnvelopeToLegacyRequest(envelope);
    latestChartRequest = mirrorChartRequest(legacyRequest);

    if (voiceSession) {
      const response = await voiceSession.processRequest(latestChartRequest, {
        speakResponse: latestChartRequest.context.updateReasons.some(
          (reason) => reason.type === 'user_intent',
        ),
      });
      if (response) {
        sendMessage({
          type: 'engine.maelstrom.response',
          sessionId,
          requestId: envelope.id,
          response: response as unknown as LegacyMaelstromResponse,
        });
      }
      return;
    }

    const response = await engine.process(legacyRequest);
    sendMessage({
      type: 'engine.maelstrom.response',
      sessionId,
      requestId: envelope.id,
      response,
    });
  };

  return {
    getLatestChartRequest() {
      return latestChartRequest;
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
