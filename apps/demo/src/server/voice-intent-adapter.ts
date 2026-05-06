import type { Engine } from '@maelstrom-co/engine-old';
import {
  type ChartRequest,
  InstanceId,
  type MaelstromResponse,
  MessageId,
  SessionId,
  type VariantName,
  type VesselId,
  type VoiceServerMessage,
  VesselSchema,
} from '@maelstrom-co/protocol';
import type {
  ChartRequest as LegacyChartRequest,
  MaelstromResponse as LegacyMaelstromResponse,
} from '@maelstrom-co/protocol-old';
import type { ProcessIntent } from '@maelstrom-co/voice-server';

export function toLegacyChartRequest(
  request: ChartRequest,
  sessionId: string,
  id: MessageId,
): LegacyChartRequest {
  return {
    type: 'chart_request',
    id,
    context: {
      ...request.context,
      timestamp: Date.now(),
      sessionId: SessionId(sessionId),
      updateReasons: request.context.updateReasons.map((reason) => ({
        ...reason,
      })),
    },
    instances: request.instances.map((instance) => ({
      instanceId: instance.instanceId,
      vesselId: instance.vesselId,
      variant: instance.variant,
    })),
    vessels: request.vessels.map((vessel) => vessel),
    layout:
      request.layout.type === 'grid'
        ? {
            type: 'grid',
            positions: request.layout.positions.map((position) => ({
              instanceId: position.instanceId,
              position: position.position,
              size: position.size,
            })),
          }
        : {
            type: 'tiling',
            tree: request.layout.tree.map((node) => node),
            instances: request.layout.instances.map((instance) => ({
              instanceId: instance.instanceId,
              vesselId: instance.vesselId,
              variant: instance.variant,
            })),
          },
  };
}

export function toProtocolChartRequest(
  request: LegacyChartRequest,
): ChartRequest {
  return {
    type: 'chart_request',
    context: {
      ...request.context,
      updateReasons: request.context.updateReasons.map((reason) => {
        if (reason.type === 'vessel_mutation') {
          return {
            ...reason,
            instanceId: InstanceId(reason.instanceId),
          };
        }

        return { ...reason };
      }),
    },
    instances: request.instances.map((instance) => ({
      instanceId: InstanceId(instance.instanceId),
      vesselId: instance.vesselId as VesselId,
      variant: instance.variant as VariantName,
    })),
    vessels: request.vessels.map((vessel) => VesselSchema.parse(vessel)),
    layout:
      request.layout.type === 'grid'
        ? {
            type: 'grid',
            positions: request.layout.positions.map((position) => ({
              instanceId: InstanceId(position.instanceId),
              position: position.position,
              size: position.size,
            })),
          }
        : {
            type: 'tiling',
            tree: request.layout.tree.map((node) =>
              node === null || node === 'H' || node === 'V'
                ? node
                : InstanceId(node),
            ),
            instances: request.layout.instances.map((instance) => ({
              instanceId: InstanceId(instance.instanceId),
              vesselId: instance.vesselId,
              variant: instance.variant,
            })),
          },
  };
}

export function toProtocolResponse(
  response: LegacyMaelstromResponse,
): MaelstromResponse {
  return {
    type: 'maelstrom_response',
    requestId: MessageId(response.requestId),
    userMessage: response.userMessage,
    rationale: response.rationale,
    executionPlan: response.executionPlan.map((action) => ({
      instanceId: InstanceId(action.instanceId),
      action: action.action,
      params: action.params,
    })),
    layout:
      response.layout.type === 'grid'
        ? {
            type: 'grid',
            positions: response.layout.positions.map((position) => ({
              instanceId: InstanceId(position.instanceId),
              position: position.position,
              size: position.size,
            })),
          }
        : {
            type: 'tiling',
            tree: response.layout.tree.map((node) =>
              node === null || node === 'H' || node === 'V'
                ? node
                : InstanceId(node),
            ),
            instances: response.layout.instances.map((instance) => ({
              instanceId: InstanceId(instance.instanceId),
              vesselId: instance.vesselId,
              variant: instance.variant,
            })),
          },
  };
}

export function createDemoVoiceIntentAdapter(
  engine: Engine,
  sessionId: string,
  sendMessage: (message: VoiceServerMessage) => void,
  getLatestChartRequest: () => ChartRequest | null,
  getExplicitRequestId: (request: ChartRequest) => MessageId | null = () =>
    null,
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
    {
      type: 'user_intent',
      intent: transcript,
    },
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
    type: mirroredRequest.type,
    context: {
      ...mirroredRequest.context,
      updateReasons: createTranscriptUpdateReasons(transcript),
    },
    instances: mirroredRequest.instances.map((instance) => ({
      instanceId: instance.instanceId,
      vesselId: instance.vesselId,
      variant: instance.variant,
    })),
    vessels: mirroredRequest.vessels.map((vessel) => vessel),
    layout:
      mirroredRequest.layout.type === 'grid'
        ? {
            type: 'grid',
            positions: mirroredRequest.layout.positions.map((position) => ({
              instanceId: position.instanceId,
              position: position.position,
              size: position.size,
            })),
          }
        : {
            type: 'tiling',
            tree: mirroredRequest.layout.tree.map((node) => node),
            instances: mirroredRequest.layout.instances.map((instance) => ({
              instanceId: instance.instanceId,
              vesselId: instance.vesselId,
              variant: instance.variant,
            })),
          },
  });

  return {
    buildChartRequest(input): ChartRequest {
      const mirroredRequest = getLatestChartRequest();

      if (mirroredRequest) {
        return createMirroredChartRequest(mirroredRequest, input.transcript);
      }

      return createFallbackChartRequest(input.transcript);
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
        const requestId =
          getExplicitRequestId(request) ??
          MessageId(`voice-${crypto.randomUUID()}`);

        let legacyResponse: LegacyMaelstromResponse;
        try {
          legacyResponse = await engine.process(
            toLegacyChartRequest(request, sessionId, requestId),
          );
        } catch (err) {
          // Voice runtime swallows this throw via its onError pipeline, which
          // emits an uncorrelated engine.error frame. Surface a correlated one
          // first so the client's pending promise rejects immediately instead
          // of timing out.
          //
          // Single-emit contract: this adapter is the sole layer that should
          // emit `engine.error` for failures along the intent path. The
          // ws-session controller's own catch around `voiceSession.processRequest`
          // is a defensive fallback for a future runtime change that lets
          // exceptions bubble — if both fire today, that's a regression in
          // either layer, not a duplicate-emit feature.
          sendMessage({
            type: 'engine.error',
            sessionId,
            requestId,
            error: err instanceof Error ? err.message : String(err),
            timestamp: performance.now(),
          });
          throw err;
        }

        const response = toProtocolResponse(legacyResponse);

        if (signal?.aborted) {
          throw new Error('Intent processing aborted');
        }

        sendMessage({
          type: 'engine.maelstrom.response',
          sessionId,
          requestId: legacyResponse.requestId,
          response,
        });

        return response;
      },
    },
  };
}
