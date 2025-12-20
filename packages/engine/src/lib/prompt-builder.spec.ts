import { describe, it, expect } from 'vitest';
import { buildPrompt } from './prompt-builder.js';
import type { ChartRequest, Vessel } from '@maelstrom/protocol';

const calendarVessel: Vessel = {
  id: 'calendar',
  name: 'Calendar',
  description: 'Calendar for scheduling',
  defaultVariant: 'month',
  variants: {
    month: {
      props: { view: 'month' },
      minSize: { width: 4, height: 4 },
      actions: [
        { name: 'showWeek', description: 'Switch to week view', transitionsTo: 'week' },
        { name: 'collapse', description: 'Minimize', transitionsTo: 'collapsed' },
      ],
    },
    week: {
      props: { view: 'week' },
      minSize: { width: 6, height: 3 },
      actions: [
        { name: 'showMonth', description: 'Back to month', transitionsTo: 'month' },
      ],
    },
    collapsed: {
      props: { collapsed: true },
      minSize: { width: 2, height: 1 },
      actions: [
        { name: 'expand', description: 'Expand', transitionsTo: 'month' },
      ],
    },
  },
};

describe('buildPrompt', () => {
  it('should include registered vessels', () => {
    const request: ChartRequest = {
      type: 'chart_request',
      id: 'test-1',
      context: {
        userIntent: 'Show calendar',
        chartDimensions: { columns: 12, rows: 8 },
        timestamp: Date.now(),
        sessionId: 'session-1',
      },
      instances: [],
      vessels: [calendarVessel],
    };

    const prompt = buildPrompt(request);

    expect(prompt).toContain('## Registered Vessels');
    expect(prompt).toContain('### calendar - Calendar');
    expect(prompt).toContain('Calendar for scheduling');
  });

  it('should include variant information', () => {
    const request: ChartRequest = {
      type: 'chart_request',
      id: 'test-1',
      context: {
        userIntent: 'Show calendar',
        chartDimensions: { columns: 12, rows: 8 },
        timestamp: Date.now(),
        sessionId: 'session-1',
      },
      instances: [],
      vessels: [calendarVessel],
    };

    const prompt = buildPrompt(request);

    expect(prompt).toContain('month (default)');
    expect(prompt).toContain('4×4 min');
    expect(prompt).toContain('showWeek');
    expect(prompt).toContain('→ week');
  });

  it('should include current chart dimensions', () => {
    const request: ChartRequest = {
      type: 'chart_request',
      id: 'test-1',
      context: {
        userIntent: 'Show calendar',
        chartDimensions: { columns: 15, rows: 10 },
        timestamp: Date.now(),
        sessionId: 'session-1',
      },
      instances: [],
      vessels: [calendarVessel],
    };

    const prompt = buildPrompt(request);

    expect(prompt).toContain('15 columns × 10 rows');
  });

  it('should include instance information', () => {
    const request: ChartRequest = {
      type: 'chart_request',
      id: 'test-1',
      context: {
        userIntent: 'Show week view',
        chartDimensions: { columns: 12, rows: 8 },
        timestamp: Date.now(),
        sessionId: 'session-1',
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
      vessels: [calendarVessel],
    };

    const prompt = buildPrompt(request);

    expect(prompt).toContain('calendar-1');
    expect(prompt).toContain('variant: month');
    expect(prompt).toContain('Available: showWeek');
  });

  it('should include user intent', () => {
    const request: ChartRequest = {
      type: 'chart_request',
      id: 'test-1',
      context: {
        userIntent: 'Show my weekly schedule',
        chartDimensions: { columns: 12, rows: 8 },
        timestamp: Date.now(),
        sessionId: 'session-1',
      },
      instances: [],
      vessels: [calendarVessel],
    };

    const prompt = buildPrompt(request);

    expect(prompt).toContain('## User Intent');
    expect(prompt).toContain('Show my weekly schedule');
  });
});
