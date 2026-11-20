import { describe, expect, test } from 'bun:test';

import { CallId, type ChartRequest } from '@maelstrom-co/protocol';

import { makeGridRequest } from '../__test-helpers__/fixtures.js';
import type {
  AgentRunToolPhaseEndedEvent,
  AgentRunToolPhaseResult,
} from './agent-run.js';
import {
  buildScreenChangeRequest,
  collectScreenChangeTools,
  userIntentRequest,
} from './screen-change-request.js';

describe('collectScreenChangeTools', () => {
  test('lists the successful tools in call order, repeated per call', () => {
    const screenChange = collectScreenChangeTools(
      phase([
        success('c1', 'latest_order', { orderId: 'ORD-10455' }),
        success('c2', 'search_products', { skus: ['SKU-1'] }),
        success('c3', 'latest_order', { orderId: 'ORD-10456' }),
      ]),
    );

    expect(screenChange).toEqual({
      toolNames: ['latest_order', 'search_products', 'latest_order'],
    });
  });

  test('a failed result contributes no tool name', () => {
    const screenChange = collectScreenChangeTools(
      phase([
        failure('c1', 'latest_order'),
        success('c2', 'search_products', { skus: ['SKU-1'] }),
      ]),
    );

    expect(screenChange).toEqual({ toolNames: ['search_products'] });
  });

  test('a phase with only failed results asks for no Screen Change', () => {
    expect(
      collectScreenChangeTools(
        phase([
          failure('c1', 'latest_order'),
          failure('c2', 'search_products'),
        ]),
      ),
    ).toBeUndefined();
  });
});

describe('userIntentRequest', () => {
  test('removes client skipReply and replaces every update reason with the intent', () => {
    const chart: ChartRequest = {
      ...makeGridRequest(),
      context: {
        ...makeGridRequest().context,
        updateReasons: [
          { type: 'user_intent', intent: 'old intent' },
          { type: 'user_intent', intent: 'another old intent' },
        ],
      },
      skipReply: true,
    };

    const request = userIntentRequest(chart, 'screenChange my latest order');

    expect(request).not.toHaveProperty('skipReply');
    expect(request).toEqual({
      ...makeGridRequest(),
      context: {
        ...chart.context,
        updateReasons: [
          { type: 'user_intent', intent: 'screenChange my latest order' },
        ],
      },
    });
  });
});

describe('buildScreenChangeRequest', () => {
  test('replaces client skipReply and every client reason with the intent', () => {
    const chart: ChartRequest = {
      ...makeGridRequest(),
      context: {
        ...makeGridRequest().context,
        updateReasons: [
          {
            type: 'user_intent',
            id: 'client-1',
            intent: 'old intent',
            referents: { orderId: 'ORD-1' },
          },
          { type: 'user_intent', intent: 'another old intent' },
        ],
      },
      skipReply: false,
    };

    const request = buildScreenChangeRequest(
      chart,
      'screenChange my latest order',
    );

    expect(request).toEqual({
      ...makeGridRequest(),
      skipReply: true,
      context: {
        ...chart.context,
        updateReasons: [
          { type: 'user_intent', intent: 'screenChange my latest order' },
        ],
      },
    });
  });

  test('keeps the Chart snapshot fields unchanged', () => {
    const chart = makeGridRequest();

    const request = buildScreenChangeRequest(
      chart,
      'screenChange my latest order',
    );

    expect(request.instances).toEqual(chart.instances);
    expect(request.vessels).toEqual(chart.vessels);
    expect(request.layout).toEqual(chart.layout);
    expect(request.context.chartDimensions).toEqual(
      chart.context.chartDimensions,
    );
    expect(request.context.layoutMode).toBe(chart.context.layoutMode);
  });
});

function phase(
  results: readonly AgentRunToolPhaseResult[],
): AgentRunToolPhaseEndedEvent {
  return { type: 'tool_phase_ended', turnId: 'run-1:t1', results };
}

function success(
  callId: string,
  name: string,
  value: unknown,
): AgentRunToolPhaseResult {
  return {
    callId: CallId(callId),
    name,
    ok: true,
    summary: `Result ${callId}`,
    value,
  };
}

function failure(callId: string, name: string): AgentRunToolPhaseResult {
  return {
    callId: CallId(callId),
    name,
    ok: false,
    summary: `Failed ${callId}`,
  };
}
