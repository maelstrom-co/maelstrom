import type { Engine } from '@maelstrom-co/engine';
import {
  AssistantInjectionMessage,
  type ChartRequest,
  type ChartRequestMessage,
  ChartRequestMessageSchema,
  type GridLayout,
  type MaelstromResponse,
  isErr,
  MessageId,
  type SessionId,
  type TilingLayout,
  type VoiceClientMessage,
  type VoiceServerMessage,
} from '@maelstrom-co/protocol';
import type { AudioChunk, VoiceSession } from '@maelstrom-co/voice-server';

import { getProviderErrorMetadata } from './provider-error-metadata.js';
import type { ProviderErrorMetadata as VoiceErrorMetadata } from './provider-error-metadata.js';
import { flattenErrorChain } from './voice-error-format.js';

type LegacyAssistantEngine = {
  addAssistantMessage: (message: {
    id: string;
    sessionId: string;
    message: string;
  }) => Promise<void>;
};

type LegacyProcessEngine = {
  process: (request: ChartRequest) => Promise<unknown>;
};

type WsTransport = {
  sendMessage: (message: VoiceServerMessage) => void;
  sendEngineError: (
    error: string,
    requestIdOrMetadata?: MessageId | VoiceErrorMetadata,
    metadata?: VoiceErrorMetadata,
  ) => void;
};

type BinaryAudioSender = (data: ArrayBuffer | Blob) => Promise<void>;

interface DemoVoiceWsSessionControllerOptions {
  sessionId: SessionId;
  voiceSession: VoiceSession | null;
  engine: Engine | LegacyAssistantEngine | LegacyProcessEngine;
  transport: WsTransport;
  forwardBinaryAudioInput: BinaryAudioSender;
}

function getErrorCause(error: Error): unknown {
  if (!('cause' in error)) {
    return undefined;
  }

  return error.cause;
}

function getProviderErrorMetadataFromChain(error: unknown) {
  let current: unknown = error;
  const seen = new Set<Error>();

  while (current instanceof Error) {
    if (seen.has(current)) {
      return undefined;
    }

    seen.add(current);

    const metadata = getProviderErrorMetadata(current);
    if (metadata) {
      return metadata;
    }

    current = getErrorCause(current);
  }

  return undefined;
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

function reattachLayoutDiscriminator(request: ChartRequest): ChartRequest {
  if (request.context.layoutMode === 'grid') {
    const grid = request.layout as GridLayout;
    return { ...request, layout: { ...grid, type: 'grid' } };
  }

  const tiling = request.layout as TilingLayout;
  return { ...request, layout: { ...tiling, type: 'tiling' } };
}

function extractRequestIdHint(raw: unknown): MessageId | undefined {
  if (typeof raw !== 'object' || raw === null) {
    return undefined;
  }

  const id = (raw as { id?: unknown }).id;
  return typeof id === 'string' && id.length > 0 ? MessageId(id) : undefined;
}

function hasHandleEngine(
  engine: Engine | LegacyAssistantEngine | LegacyProcessEngine,
): engine is Engine {
  return 'handle' in engine && typeof engine.handle === 'function';
}

function hasLegacyAssistantEngine(
  engine: Engine | LegacyAssistantEngine | LegacyProcessEngine,
): engine is LegacyAssistantEngine {
  return (
    'addAssistantMessage' in engine &&
    typeof engine.addAssistantMessage === 'function'
  );
}

function hasLegacyProcessEngine(
  engine: Engine | LegacyAssistantEngine | LegacyProcessEngine,
): engine is LegacyProcessEngine {
  return 'process' in engine && typeof engine.process === 'function';
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
  const explicitRequestIdByRef = new WeakMap<ChartRequest, MessageId>();

  const reportEngineError = (
    context: string,
    error: unknown,
    requestId?: MessageId,
  ) => {
    console.error(`${context}:`, error);

    const message = flattenErrorChain(error);
    const metadata = getProviderErrorMetadataFromChain(error);

    if (requestId !== undefined) {
      if (metadata) {
        sendEngineError(message, requestId, metadata);
        return;
      }

      sendEngineError(message, requestId);
      return;
    }

    if (metadata) {
      sendEngineError(message, metadata);
      return;
    }

    sendEngineError(message);
  };

  const reportCorrelatedEngineError = (
    context: string,
    error: unknown,
    requestId: MessageId,
  ) => {
    reportEngineError(context, error, requestId);
  };

  const clearExplicitRequestId = (request: ChartRequest) => {
    explicitRequestIdByRef.delete(request);
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
    if (hasHandleEngine(engine)) {
      const envelope = AssistantInjectionMessage({
        sessionId,
        id: messageId,
        content: message.message,
      });
      const result = await engine.handle(envelope);

      if (isErr(result)) {
        reportCorrelatedEngineError(
          '[Demo WS] Add assistant message error',
          result.error,
          messageId,
        );
      }

      return;
    }

    if (!hasLegacyAssistantEngine(engine)) {
      reportCorrelatedEngineError(
        '[Demo WS] Add assistant message error',
        new Error('Engine does not support assistant message injection'),
        messageId,
      );
      return;
    }

    try {
      await engine.addAssistantMessage({
        id: message.id,
        sessionId,
        message: message.message,
      });
    } catch (error) {
      reportCorrelatedEngineError(
        '[Demo WS] Add assistant message error',
        error,
        messageId,
      );
    }
  };

  const handleMaelstromProcess = async (
    message: VoiceClientMessage & {
      type: 'client.maelstrom.process';
    },
  ) => {
    const parsed = ChartRequestMessageSchema.safeParse(message.request);
    if (!parsed.success) {
      reportEngineError(
        '[Demo WS] Invalid chart_request envelope',
        parsed.error,
        extractRequestIdHint(message.request),
      );
      return;
    }

    const validated = parsed.data as unknown as ChartRequestMessage;
    const chartRequest = reattachLayoutDiscriminator(validated.request);
    const envelope: ChartRequestMessage = {
      ...validated,
      request: chartRequest,
    };
    latestChartRequest = chartRequest;

    if (voiceSession) {
      explicitRequestIdByRef.set(chartRequest, envelope.id);

      try {
        const response = await voiceSession.processRequest(chartRequest, {
          speakResponse: chartRequest.context.updateReasons.some(
            (reason) => reason.type === 'user_intent',
          ),
        });

        if (response === undefined) {
          clearExplicitRequestId(chartRequest);
          return;
        }

        const shouldSendFallbackResponse =
          explicitRequestIdByRef.has(chartRequest);
        clearExplicitRequestId(chartRequest);

        if (shouldSendFallbackResponse) {
          sendMessage({
            type: 'engine.maelstrom.response',
            sessionId,
            requestId: envelope.id,
            response,
          });
        }
      } catch (err) {
        clearExplicitRequestId(chartRequest);
        reportCorrelatedEngineError(
          '[Demo WS] processRequest error',
          err,
          envelope.id,
        );
      }

      return;
    }

    if (hasHandleEngine(engine)) {
      const result = await engine.handle(envelope);
      if (isErr(result)) {
        reportCorrelatedEngineError(
          '[Demo WS] engine.handle error',
          result.error,
          envelope.id,
        );
        return;
      }

      if (result.value.type !== 'chart_response') {
        reportCorrelatedEngineError(
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
      return;
    }

    if (!hasLegacyProcessEngine(engine)) {
      reportCorrelatedEngineError(
        '[Demo WS] engine.handle error',
        new Error('Engine does not support chart_request handling'),
        envelope.id,
      );
      return;
    }

    try {
      const response = (await engine.process(
        chartRequest,
      )) as MaelstromResponse;
      sendMessage({
        type: 'engine.maelstrom.response',
        sessionId,
        requestId: envelope.id,
        response,
      });
    } catch (error) {
      reportCorrelatedEngineError(
        '[Demo WS] engine.handle error',
        error,
        envelope.id,
      );
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
          case 'client.audio_capture.audio_sent': {
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
            break;
          }
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
