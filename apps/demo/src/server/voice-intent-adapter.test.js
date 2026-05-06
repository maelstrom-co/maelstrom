import { describe, expect, mock, test } from 'bun:test';

import { InstanceId, MessageId, SessionId } from '@maelstrom-co/protocol';

import { createDemoVoiceIntentAdapter } from './voice-intent-adapter.js';

function createMirroredChartRequest() {
  return {
    type: 'chart_request',
    context: {
      updateReasons: [{ type: 'user_intent', intent: 'show my lab results' }],
      chartDimensions: { columns: 24, rows: 10 },
      layoutMode: 'grid',
    },
    instances: [
      {
        instanceId: InstanceId('inst-trends'),
        vesselId: 'lab-trends',
        variant: 'expanded',
      },
    ],
    vessels: [
      {
        id: 'lab-trends',
        name: 'Lab Trends',
        description: 'Shows lab trends over time',
        defaultVariant: 'expanded',
        variants: {
          expanded: {
            props: {},
            minSize: { w: 6, h: 4 },
            actions: [],
          },
        },
      },
    ],
    layout: {
      type: 'grid',
      positions: [
        {
          instanceId: InstanceId('inst-trends'),
          position: { x: 2, y: 1 },
          size: { w: 8, h: 4 },
        },
      ],
    },
  };
}

function createProtocolChartRequest(
  transcript,
  sessionId = SessionId('session-1'),
) {
  return {
    type: 'chart_request',
    id: MessageId('req-voice-test'),
    context: {
      updateReasons: [{ type: 'user_intent', intent: transcript }],
      chartDimensions: { columns: 12, rows: 8 },
      timestamp: 1,
      sessionId,
      layoutMode: 'tiling',
    },
    instances: [
      {
        instanceId: InstanceId('inst-calendar'),
        vesselId: 'calendar',
        variant: 'month',
      },
    ],
    vessels: [],
    layout: {
      type: 'tiling',
      tree: [InstanceId('inst-calendar')],
      instances: [
        {
          instanceId: InstanceId('inst-calendar'),
          vesselId: 'calendar',
          variant: 'month',
        },
      ],
    },
  };
}

describe('voice-intent-adapter', () => {
  test('buildChartRequest returns an empty tiling fallback when no mirrored chart context exists', () => {
    const adapter = createDemoVoiceIntentAdapter(
      {
        process: mock(async () => ({
          requestId: 'req-1',
          userMessage: '',
          rationale: '',
          executionPlan: [],
          layout: { type: 'tiling', tree: [], instances: [] },
        })),
      },
      SessionId('session-1'),
      mock(() => {}),
      () => null,
    );

    const request = adapter.buildChartRequest({
      transcript: 'show me the chart',
      sessionId: SessionId('session-2'),
    });

    expect(request).toEqual({
      type: 'chart_request',
      context: {
        updateReasons: [{ type: 'user_intent', intent: 'show me the chart' }],
        chartDimensions: { columns: 12, rows: 8 },
        layoutMode: 'tiling',
      },
      instances: [],
      vessels: [],
      layout: { type: 'tiling', tree: [], instances: [] },
    });
  });

  test('buildChartRequest reuses mirrored chart state and only swaps updateReasons for the transcript intent', () => {
    const mirroredRequest = createMirroredChartRequest();
    const adapter = createDemoVoiceIntentAdapter(
      {
        process: mock(async () => ({
          requestId: 'req-1',
          userMessage: '',
          rationale: '',
          executionPlan: [],
          layout: { type: 'tiling', tree: [], instances: [] },
        })),
      },
      SessionId('session-1'),
      mock(() => {}),
      () => mirroredRequest,
    );

    const request = adapter.buildChartRequest({
      transcript: 'show my glucose trends',
      sessionId: SessionId('session-2'),
    });

    expect(request.instances).toEqual(mirroredRequest.instances);
    expect(request.vessels).toEqual(mirroredRequest.vessels);
    expect(request.layout).toEqual(mirroredRequest.layout);
    expect(request.context.chartDimensions).toEqual(
      mirroredRequest.context.chartDimensions,
    );
    expect(request.context.layoutMode).toBe(mirroredRequest.context.layoutMode);

    expect(request).toEqual({
      ...mirroredRequest,
      context: {
        ...mirroredRequest.context,
        updateReasons: [
          { type: 'user_intent', intent: 'show my glucose trends' },
        ],
      },
    });
  });

  test('processIntent forwards the legacy engine response and returns the protocol response', async () => {
    const engine = {
      process: mock(async (legacyRequest) => ({
        requestId: legacyRequest.id,
        userMessage: 'hello back',
        rationale: 'rationale',
        executionPlan: [],
        layout: { type: 'tiling', tree: [], instances: [] },
      })),
    };
    const sendMessage = mock(() => {});
    const adapter = createDemoVoiceIntentAdapter(
      engine,
      SessionId('session-1'),
      sendMessage,
      () => null,
    );
    const request = createProtocolChartRequest('hello');

    const response = await adapter.processIntent.process(request);

    expect(engine.process).toHaveBeenCalledTimes(1);
    expect(engine.process).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'chart_request',
        id: expect.stringMatching(/^voice-/),
        context: expect.objectContaining({
          sessionId: 'session-1',
          updateReasons: [{ type: 'user_intent', intent: 'hello' }],
          chartDimensions: { columns: 12, rows: 8 },
          layoutMode: 'tiling',
        }),
      }),
    );
    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'engine.maelstrom.response',
        sessionId: 'session-1',
        requestId: expect.stringMatching(/^voice-/),
      }),
    );
    expect(response.userMessage).toBe('hello back');
  });

  test('processIntent uses the explicit request id when one is staged', async () => {
    const engine = {
      process: mock(async (legacyRequest) => ({
        requestId: legacyRequest.id,
        userMessage: '',
        rationale: '',
        executionPlan: [],
        layout: { type: 'tiling', tree: [], instances: [] },
      })),
    };
    const sendMessage = mock(() => {});
    const request = createProtocolChartRequest('hello');
    const getExplicitRequestId = mock(() => MessageId('explicit-id-42'));
    const adapter = createDemoVoiceIntentAdapter(
      engine,
      SessionId('session-1'),
      sendMessage,
      () => null,
      getExplicitRequestId,
    );

    await adapter.processIntent.process(request);

    expect(getExplicitRequestId).toHaveBeenCalledTimes(1);
    // Lookup-by-reference: the adapter passes the exact request it received.
    expect(getExplicitRequestId.mock.calls[0]?.[0]).toBe(request);
    expect(engine.process.mock.calls[0]?.[0]?.id).toBe('explicit-id-42');
    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'engine.maelstrom.response',
        requestId: 'explicit-id-42',
      }),
    );
  });

  test('processIntent emits a correlated engine.error before rethrowing engine.process failures', async () => {
    const engineError = new Error('LLM timeout');
    const engine = {
      process: mock(async () => {
        throw engineError;
      }),
    };
    const sendMessage = mock(() => {});
    const request = createProtocolChartRequest('hello');
    const getExplicitRequestId = mock(() => MessageId('explicit-id-99'));
    const adapter = createDemoVoiceIntentAdapter(
      engine,
      SessionId('session-1'),
      sendMessage,
      () => null,
      getExplicitRequestId,
    );

    await expect(adapter.processIntent.process(request)).rejects.toBe(
      engineError,
    );

    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'engine.error',
        sessionId: 'session-1',
        requestId: 'explicit-id-99',
        error: 'LLM timeout',
      }),
    );
    // No success frame emitted on the failure path.
    expect(sendMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'engine.maelstrom.response' }),
    );
  });

  test('processIntent emits engine.error tagged with the synthetic voice id when no explicit id is staged', async () => {
    const engine = {
      process: mock(async () => {
        throw new Error('boom');
      }),
    };
    const sendMessage = mock(() => {});
    const adapter = createDemoVoiceIntentAdapter(
      engine,
      SessionId('session-1'),
      sendMessage,
      () => null,
    );

    await expect(
      adapter.processIntent.process(createProtocolChartRequest('hello')),
    ).rejects.toThrow('boom');

    const errorCall = sendMessage.mock.calls.find(
      (call) => call[0]?.type === 'engine.error',
    );
    expect(errorCall?.[0]?.requestId).toMatch(/^voice-/);
    // MessageId is a stable branded `string`; matchers like `toBeTypeOf`
    // are sufficient since the brand erases at runtime. The /^voice-/
    // prefix above already pins the shape.
    expect(typeof errorCall?.[0]?.requestId).toBe('string');
    expect(errorCall?.[0]?.error).toBe('boom');
    // Parity with the explicit-id test: no success frame on the failure path.
    const successCall = sendMessage.mock.calls.find(
      (call) => call[0]?.type === 'engine.maelstrom.response',
    );
    expect(successCall).toBeUndefined();
  });

  test('processIntent aborts before emitting side effects when the signal is already aborted', async () => {
    const sendMessage = mock(() => {});
    const adapter = createDemoVoiceIntentAdapter(
      {
        process: mock(async () => ({
          requestId: 'req-1',
          userMessage: '',
          rationale: '',
          executionPlan: [],
          layout: { type: 'tiling', tree: [], instances: [] },
        })),
      },
      SessionId('session-1'),
      sendMessage,
      () => null,
    );
    const request = createProtocolChartRequest('hello');
    const controller = new AbortController();
    controller.abort();

    await expect(
      adapter.processIntent.process(request, controller.signal),
    ).rejects.toThrow('Intent processing aborted');
    expect(sendMessage).not.toHaveBeenCalled();
  });
});
