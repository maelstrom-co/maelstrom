import type { Engine } from '@maelstrom-co/engine';
import {
  type ChartRequest,
  ChartRequestMessage,
  isErr,
  MessageId,
  type SessionId,
  type VoiceServerMessage,
} from '@maelstrom-co/protocol';
import type { ProcessIntent } from '@maelstrom-co/voice-server';

export function createDemoVoiceIntentAdapter(
  engine: Engine,
  sessionId: SessionId,
  sendMessage: (message: VoiceServerMessage) => void,
  getLatestChartRequest: () => ChartRequest | null,
  getExplicitRequestId: (request: ChartRequest) => MessageId | null,
): {
  buildChartRequest: (input: {
    transcript: string;
    sessionId: SessionId;
  }) => ChartRequest;
  processIntent: ProcessIntent;
} {
  const createTranscriptUpdateReasons = (
    transcript: string,
  ): ChartRequest['context']['updateReasons'] => [
    { type: 'user_intent', intent: transcript },
  ];

  const createFallbackChartRequest = (transcript: string): ChartRequest => ({
    type: 'chart_request',
    context: {
      updateReasons: createTranscriptUpdateReasons(transcript),
      chartDimensions: { columns: 12, rows: 8 },
      layoutMode: 'tiling',
    },
    instances: [],
    vessels: [],
    layout: { type: 'tiling', tree: [], instances: [] },
  });

  const createMirroredChartRequest = (
    mirroredRequest: ChartRequest,
    transcript: string,
  ): ChartRequest => ({
    ...mirroredRequest,
    context: {
      ...mirroredRequest.context,
      updateReasons: createTranscriptUpdateReasons(transcript),
    },
  });

  return {
    buildChartRequest(input): ChartRequest {
      const mirrored = getLatestChartRequest();
      return mirrored
        ? createMirroredChartRequest(mirrored, input.transcript)
        : createFallbackChartRequest(input.transcript);
    },
    processIntent: {
      async process(request, signal) {
        if (signal?.aborted) {
          throw new Error('Intent processing aborted');
        }

        // For requests originating from `client.maelstrom.process`, the WS
        // session controller stages the envelope id (keyed on the request
        // reference) so the response can be correlated with the client's
        // pending promise. STT-driven turns arrive without one and get a
        // synthetic `voice-…` id.
        const id =
          getExplicitRequestId(request) ??
          MessageId(`voice-${crypto.randomUUID()}`);
        const envelope = ChartRequestMessage({ sessionId, id, request });

        let result: Awaited<ReturnType<Engine['handle']>>;
        try {
          result = await engine.handle(envelope, signal);
        } catch (err) {
          // engine.handle is documented to return Result, never throw. The
          // catch is defensive: an unhandled rejection here would surface to
          // the client as a timeout (no engine.error frame) rather than a
          // prompt failure, so we still want a correlated emit if the
          // contract regresses. The ws-session controller's catch around
          // voiceSession.processRequest layers a second defensive emit; if
          // both fire today, that's a regression in either layer, not a
          // duplicate-emit feature.
          sendMessage({
            type: 'engine.error',
            sessionId,
            requestId: id,
            error: err instanceof Error ? err.message : String(err),
            timestamp: performance.now(),
          });
          throw err;
        }

        if (signal?.aborted) {
          throw new Error('Intent processing aborted');
        }

        if (isErr(result)) {
          sendMessage({
            type: 'engine.error',
            sessionId,
            requestId: id,
            error: result.error.message,
            timestamp: performance.now(),
          });
          throw new Error(result.error.message);
        }

        if (result.value.type !== 'chart_response') {
          throw new Error(
            `Unexpected engine output for chart_request: ${result.value.type}`,
          );
        }

        sendMessage({
          type: 'engine.maelstrom.response',
          sessionId,
          requestId: result.value.id,
          response: result.value.response,
        });

        return result.value.response;
      },
    },
  };
}
