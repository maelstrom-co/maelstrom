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

function createProtocolChartRequest(transcript) {
  return {
    type: 'chart_request',
    context: {
      updateReasons: [{ type: 'user_intent', intent: transcript }],
      chartDimensions: { columns: 12, rows: 8 },
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

function createEngineStub(response = {}) {
  return {
    handle: mock(async (envelope) => ({
      ok: true,
      value: {
        type: 'chart_response',
        sessionId: envelope.sessionId,
        id: envelope.id,
        response: {
          type: 'maelstrom_response',
          requestId: envelope.id,
          userMessage: '',
          rationale: '',
          executionPlan: [],
          layout: { type: 'tiling', tree: [], instances: [] },
          ...response,
        },
      },
    })),
  };
}

describe('voice-intent-adapter', () => {
  test('buildChartRequest returns an empty tiling fallback when no mirrored chart context exists', () => {
    const adapter = createDemoVoiceIntentAdapter(
      createEngineStub(),
      SessionId('session-1'),
      mock(() => {}),
      () => null,
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
      createEngineStub(),
      SessionId('session-1'),
      mock(() => {}),
      () => mirroredRequest,
      () => null,
    );

    const request = adapter.buildChartRequest({
      transcript: 'show my glucose trends',
      sessionId: SessionId('session-2'),
    });

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

  test('processIntent uses the staged envelope id when one is available', async () => {
    const engine = createEngineStub({ userMessage: 'hello back' });
    const sendMessage = mock(() => {});
    const explicitId = MessageId('explicit-req-1');
    const adapter = createDemoVoiceIntentAdapter(
      engine,
      SessionId('session-1'),
      sendMessage,
      () => null,
      () => explicitId,
    );
    const request = createProtocolChartRequest('hello');

    const response = await adapter.processIntent.process(request);

    expect(engine.handle).toHaveBeenCalledTimes(1);
    expect(engine.handle.mock.calls[0]?.[0]).toMatchObject({
      type: 'chart_request',
      sessionId: SessionId('session-1'),
      id: explicitId,
      request,
    });
    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'engine.maelstrom.response',
        sessionId: SessionId('session-1'),
        requestId: explicitId,
      }),
    );
    expect(response.userMessage).toBe('hello back');
  });

  test('processIntent falls back to a synthetic voice id when no explicit id is staged', async () => {
    const engine = createEngineStub();
    const adapter = createDemoVoiceIntentAdapter(
      engine,
      SessionId('session-1'),
      mock(() => {}),
      () => null,
      () => null,
    );

    await adapter.processIntent.process(createProtocolChartRequest('hi'));

    const envelope = engine.handle.mock.calls[0]?.[0];
    expect(envelope.id).toMatch(/^voice-/);
  });

  test('processIntent surfaces engine errors as thrown errors and emits a correlated engine.error', async () => {
    const engine = {
      handle: mock(async () => ({
        ok: false,
        error: { type: 'provider', message: 'gemini outage' },
      })),
    };
    const sendMessage = mock(() => {});
    const explicitId = MessageId('err-req-1');
    const adapter = createDemoVoiceIntentAdapter(
      engine,
      SessionId('session-1'),
      sendMessage,
      () => null,
      () => explicitId,
    );

    await expect(
      adapter.processIntent.process(createProtocolChartRequest('hi')),
    ).rejects.toThrow('gemini outage');
    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'engine.error',
        sessionId: SessionId('session-1'),
        requestId: explicitId,
        error: 'gemini outage',
      }),
    );
  });

  test('processIntent emits a correlated engine.error and re-throws when engine.handle throws synchronously (defensive fallback)', async () => {
    const engine = {
      handle: mock(async () => {
        throw new Error('runtime kaboom');
      }),
    };
    const sendMessage = mock(() => {});
    const explicitId = MessageId('throw-req-1');
    const adapter = createDemoVoiceIntentAdapter(
      engine,
      SessionId('session-1'),
      sendMessage,
      () => null,
      () => explicitId,
    );

    await expect(
      adapter.processIntent.process(createProtocolChartRequest('hi')),
    ).rejects.toThrow('runtime kaboom');
    // Single emit at this layer — exactly one engine.error frame, correlated.
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'engine.error',
        sessionId: SessionId('session-1'),
        requestId: explicitId,
        error: 'runtime kaboom',
      }),
    );
  });

  test('processIntent forwards the abort signal to engine.handle', async () => {
    const engine = createEngineStub();
    const adapter = createDemoVoiceIntentAdapter(
      engine,
      SessionId('session-1'),
      mock(() => {}),
      () => null,
      () => null,
    );
    const controller = new AbortController();

    await adapter.processIntent.process(
      createProtocolChartRequest('hi'),
      controller.signal,
    );

    expect(engine.handle).toHaveBeenCalledTimes(1);
    expect(engine.handle.mock.calls[0]?.[1]).toBe(controller.signal);
  });

  test('processIntent aborts before emitting side effects when the signal is already aborted', async () => {
    const engine = createEngineStub();
    const sendMessage = mock(() => {});
    const adapter = createDemoVoiceIntentAdapter(
      engine,
      SessionId('session-1'),
      sendMessage,
      () => null,
      () => null,
    );
    const controller = new AbortController();
    controller.abort();

    await expect(
      adapter.processIntent.process(
        createProtocolChartRequest('hello'),
        controller.signal,
      ),
    ).rejects.toThrow('Intent processing aborted');
    expect(sendMessage).not.toHaveBeenCalled();
    expect(engine.handle).not.toHaveBeenCalled();
  });
});
