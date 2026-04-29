import { describe, expect, mock, test } from 'bun:test';

import { InstanceId, MessageId, SessionId } from '@maelstrom-co/protocol';

import {
  createDemoVoiceIntentAdapter,
  toProtocolChartRequest,
} from './voice-intent-adapter.js';

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

  test('toProtocolChartRequest drops envelope-only ids while converting instance ids to branded protocol values', () => {
    const request = toProtocolChartRequest({
      type: 'chart_request',
      id: 'req-legacy',
      context: {
        updateReasons: [
          { type: 'vessel_mutation', instanceId: 'inst-1', changes: 'changed' },
        ],
        chartDimensions: { columns: 12, rows: 8 },
        timestamp: 1,
        sessionId: 'session-legacy',
        layoutMode: 'tiling',
      },
      instances: [
        { instanceId: 'inst-1', vesselId: 'calendar', variant: 'month' },
      ],
      vessels: [],
      layout: {
        type: 'tiling',
        tree: ['inst-1'],
        instances: [
          { instanceId: 'inst-1', vesselId: 'calendar', variant: 'month' },
        ],
      },
    });

    expect(request).not.toHaveProperty('id');
    expect(request.instances[0]?.instanceId).toBe('inst-1');
    expect(request.layout.tree[0]).toBe('inst-1');
  });

  test('processIntent forwards the legacy engine response and returns the protocol response', async () => {
    const engine = {
      process: mock(async () => ({
        requestId: 'req-1',
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
        requestId: 'req-1',
      }),
    );
    expect(response.userMessage).toBe('hello back');
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
