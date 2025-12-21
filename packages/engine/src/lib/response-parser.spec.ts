import type { ChartRequest, Vessel } from '@maelstrom/protocol';
import { describe, expect, it } from 'vitest';
import { parseResponse } from './response-parser.js';
import { EngineError } from './types.js';

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
        {
          name: 'showWeek',
          description: 'Switch to week view',
          transitionsTo: 'week',
        },
      ],
    },
    week: {
      props: { view: 'week' },
      minSize: { width: 6, height: 3 },
      actions: [
        {
          name: 'showMonth',
          description: 'Back to month',
          transitionsTo: 'month',
        },
      ],
    },
  },
};

const baseRequest: ChartRequest = {
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

describe('parseResponse', () => {
  it('should parse valid JSON response', () => {
    const llmResponse = JSON.stringify({
      rationale: 'Switching to week view',
      executionPlan: [{ instanceId: 'calendar-1', action: 'showWeek' }],
      layoutDirective: [
        {
          instanceId: 'calendar-1',
          position: { row: 0, column: 0 },
          size: { width: 6, height: 3 },
        },
      ],
    });

    const result = parseResponse(llmResponse, baseRequest);

    expect(result.type).toBe('maelstrom_response');
    expect(result.requestId).toBe('test-1');
    expect(result.rationale).toBe('Switching to week view');
    expect(result.executionPlan).toHaveLength(1);
    expect(result.executionPlan[0].action).toBe('showWeek');
    expect(result.layoutDirective).toHaveLength(1);
  });

  it('should parse JSON wrapped in markdown code blocks', () => {
    const llmResponse = `Here's my response:

\`\`\`json
{
  "rationale": "Switching to week view",
  "executionPlan": [
    { "instanceId": "calendar-1", "action": "showWeek" }
  ],
  "layoutDirective": [
    { "instanceId": "calendar-1", "position": { "row": 0, "column": 0 }, "size": { "width": 6, "height": 3 } }
  ]
}
\`\`\`

Hope this helps!`;

    const result = parseResponse(llmResponse, baseRequest);

    expect(result.executionPlan).toHaveLength(1);
    expect(result.executionPlan[0].action).toBe('showWeek');
  });

  it('should skip invalid actions for current variant', () => {
    const llmResponse = JSON.stringify({
      rationale: 'Test',
      executionPlan: [
        { instanceId: 'calendar-1', action: 'showMonth' }, // Invalid - showMonth is only in week variant
      ],
      layoutDirective: [],
    });

    const result = parseResponse(llmResponse, baseRequest);

    expect(result.executionPlan).toHaveLength(0);
  });

  it('should skip actions for non-existent instances', () => {
    const llmResponse = JSON.stringify({
      rationale: 'Test',
      executionPlan: [
        { instanceId: 'weather-1', action: 'refresh' }, // Instance doesn't exist
      ],
      layoutDirective: [],
    });

    const result = parseResponse(llmResponse, baseRequest);

    expect(result.executionPlan).toHaveLength(0);
  });

  it('should clamp positions to valid bounds', () => {
    const llmResponse = JSON.stringify({
      rationale: 'Test',
      executionPlan: [],
      layoutDirective: [
        {
          instanceId: 'calendar-1',
          position: { row: 100, column: 100 },
          size: { width: 4, height: 4 },
        },
      ],
    });

    const result = parseResponse(llmResponse, baseRequest);

    expect(result.layoutDirective[0].position.row).toBe(7); // clamped to rows - 1
    expect(result.layoutDirective[0].position.column).toBe(11); // clamped to columns - 1
  });

  it('should throw on invalid JSON', () => {
    expect(() => parseResponse('not json', baseRequest)).toThrow(EngineError);
  });

  it('should throw when no JSON found', () => {
    expect(() =>
      parseResponse('Just some text without JSON', baseRequest),
    ).toThrow(EngineError);
  });

  it('should handle empty execution plan and layout', () => {
    const llmResponse = JSON.stringify({
      rationale: 'No changes needed',
      executionPlan: [],
      layoutDirective: [],
    });

    const result = parseResponse(llmResponse, baseRequest);

    expect(result.executionPlan).toHaveLength(0);
    expect(result.layoutDirective).toHaveLength(0);
  });
});
