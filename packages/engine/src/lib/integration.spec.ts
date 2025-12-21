import type { ChartRequest, Vessel } from '@maelstrom/protocol';
import { describe, expect, it } from 'vitest';
import { createAISDKProvider } from './ai-sdk-provider.js';
import { createEngine } from './engine.js';

// Skip integration tests if no API key is set
const GOOGLE_API_KEY = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
const describeIntegration = GOOGLE_API_KEY ? describe : describe.skip;

const calendarVessel: Vessel = {
  id: 'calendar',
  name: 'Calendar',
  description: 'Calendar for scheduling and viewing dates',
  defaultVariant: 'month',
  variants: {
    month: {
      props: { view: 'month' },
      minSize: { width: 4, height: 4 },
      actions: [
        {
          name: 'showWeek',
          description: 'Switch to week view',
          transitionsTo: 'week',
        },
        {
          name: 'collapse',
          description: 'Minimize the calendar',
          transitionsTo: 'collapsed',
        },
      ],
    },
    week: {
      props: { view: 'week' },
      minSize: { width: 6, height: 3 },
      actions: [
        {
          name: 'showMonth',
          description: 'Switch to month view',
          transitionsTo: 'month',
        },
      ],
    },
    collapsed: {
      props: { collapsed: true },
      minSize: { width: 2, height: 1 },
      actions: [
        {
          name: 'expand',
          description: 'Expand the calendar',
          transitionsTo: 'month',
        },
      ],
    },
  },
};

const weatherVessel: Vessel = {
  id: 'weather',
  name: 'Weather',
  description: 'Shows current weather conditions',
  defaultVariant: 'current',
  variants: {
    current: {
      props: { mode: 'current' },
      minSize: { width: 2, height: 2 },
      actions: [
        {
          name: 'showForecast',
          description: 'Show extended forecast',
          transitionsTo: 'forecast',
        },
      ],
    },
    forecast: {
      props: { mode: 'forecast' },
      minSize: { width: 4, height: 3 },
      actions: [
        {
          name: 'showCurrent',
          description: 'Show current conditions',
          transitionsTo: 'current',
        },
      ],
    },
  },
};

describeIntegration('Engine Integration (Google Gemini)', () => {
  it('should process user intent and return valid response', async () => {
    // Dynamic import to avoid errors when package is not installed
    const { google } = await import('@ai-sdk/google');

    const provider = createAISDKProvider(google('gemini-2.0-flash'));
    const engine = createEngine({ provider, timeout: 30000 });

    const request: ChartRequest = {
      type: 'chart_request',
      id: 'integration-test-1',
      context: {
        userIntent: 'Show me the weekly calendar view',
        chartDimensions: { columns: 12, rows: 8 },
        timestamp: Date.now(),
        sessionId: 'integration-session',
      },
      instances: [
        {
          instanceId: 'calendar-1',
          vesselId: 'calendar',
          variant: 'month',
          position: { row: 0, column: 0 },
          size: { width: 4, height: 4 },
        },
      ],
      vessels: [calendarVessel, weatherVessel],
    };

    const response = await engine.process(request);

    expect(response.type).toBe('maelstrom_response');
    expect(response.requestId).toBe('integration-test-1');
    expect(response.rationale).toBeTruthy();

    // The LLM should recognize the intent to show week view
    // It should execute showWeek action on calendar-1
    const calendarAction = response.executionPlan.find(
      (a) => a.instanceId === 'calendar-1',
    );
    expect(calendarAction).toBeDefined();
    expect(calendarAction?.action).toBe('showWeek');
  }, 60000);

  it('should handle multiple vessels', async () => {
    const { google } = await import('@ai-sdk/google');

    const provider = createAISDKProvider(google('gemini-2.0-flash'));
    const engine = createEngine({ provider, timeout: 30000 });

    const request: ChartRequest = {
      type: 'chart_request',
      id: 'integration-test-2',
      context: {
        userIntent: 'Minimize the calendar and show the weather forecast',
        chartDimensions: { columns: 12, rows: 8 },
        timestamp: Date.now(),
        sessionId: 'integration-session',
      },
      instances: [
        {
          instanceId: 'calendar-1',
          vesselId: 'calendar',
          variant: 'month',
          position: { row: 0, column: 0 },
          size: { width: 4, height: 4 },
        },
        {
          instanceId: 'weather-1',
          vesselId: 'weather',
          variant: 'current',
          position: { row: 0, column: 5 },
          size: { width: 2, height: 2 },
        },
      ],
      vessels: [calendarVessel, weatherVessel],
    };

    const response = await engine.process(request);

    expect(response.type).toBe('maelstrom_response');
    expect(response.executionPlan.length).toBeGreaterThanOrEqual(1);

    // Should have actions for both vessels
    const actions = response.executionPlan.map((a) => a.action);
    expect(actions).toContain('collapse');
    expect(actions).toContain('showForecast');
  }, 60000);
});
