import { describe, expect, test } from 'bun:test';

import type { ChartRequest } from '@maelstrom-co/protocol';

import { makeGridRequest } from '../__test-helpers__/fixtures.js';
import {
  buildScreenChangeRequest,
  userIntentRequest,
} from './screen-change-request.js';

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
  test('replaces client skipReply and every client reason with one user_intent reason per goal', () => {
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

    const request = buildScreenChangeRequest(chart, [
      {
        callId: 'provider-call-1',
        reasonId: 'r1',
        goal: 'show my latest order',
        referents: { orderId: 'o-1' },
      },
      { callId: 'provider-call-2', reasonId: 'r2', goal: 'show my cart' },
    ]);

    expect(request).toEqual({
      ...makeGridRequest(),
      skipReply: true,
      context: {
        ...chart.context,
        updateReasons: [
          {
            type: 'user_intent',
            id: 'r1',
            intent: 'show my latest order',
            referents: { orderId: 'o-1' },
          },
          { type: 'user_intent', id: 'r2', intent: 'show my cart' },
        ],
      },
    });
    expect(JSON.stringify(request)).not.toContain('provider-call');
  });

  test('keeps the Chart snapshot fields unchanged', () => {
    const chart = makeGridRequest();

    const request = buildScreenChangeRequest(chart, [
      { callId: 'provider-call-1', reasonId: 'r1', goal: 'show my order' },
    ]);

    expect(request.instances).toEqual(chart.instances);
    expect(request.vessels).toEqual(chart.vessels);
    expect(request.layout).toEqual(chart.layout);
    expect(request.context.chartDimensions).toEqual(
      chart.context.chartDimensions,
    );
    expect(request.context.layoutMode).toBe(chart.context.layoutMode);
  });
});
