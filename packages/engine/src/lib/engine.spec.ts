import type { ChartRequest, Vessel } from '@maelstrom/protocol';
import { describe, expect, it, vi } from 'vitest';
import { createEngine } from './engine.js';
import type { LLMProvider } from './types.js';
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

function createMockProvider(response: string): LLMProvider {
  return {
    complete: vi.fn().mockResolvedValue(response),
  };
}

describe('createEngine', () => {
  it('should process a request and return a response', async () => {
    const mockResponse = JSON.stringify({
      rationale: 'Switching to week view as requested',
      executionPlan: [{ instanceId: 'calendar-1', action: 'showWeek' }],
      layoutDirective: [
        {
          instanceId: 'calendar-1',
          position: { row: 0, column: 0 },
          size: { width: 6, height: 3 },
        },
      ],
    });

    const provider = createMockProvider(mockResponse);
    const engine = createEngine({ provider });

    const result = await engine.process(baseRequest);

    expect(result.type).toBe('maelstrom_response');
    expect(result.requestId).toBe('test-1');
    expect(result.executionPlan).toHaveLength(1);
    expect(result.executionPlan[0].action).toBe('showWeek');
    expect(provider.complete).toHaveBeenCalledOnce();
  });

  it('should pass system prompt to provider', async () => {
    const mockResponse = JSON.stringify({
      rationale: 'Test',
      executionPlan: [],
      layoutDirective: [],
    });

    const provider = createMockProvider(mockResponse);
    const customPrompt = 'You are a custom assistant';
    const engine = createEngine({ provider, systemPrompt: customPrompt });

    await engine.process(baseRequest);

    expect(provider.complete).toHaveBeenCalledWith(
      expect.any(String),
      customPrompt,
    );
  });

  it('should retry on provider failure', async () => {
    const provider: LLMProvider = {
      complete: vi
        .fn()
        .mockRejectedValueOnce(new Error('Network error'))
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce(
          JSON.stringify({
            rationale: 'Success on third try',
            executionPlan: [],
            layoutDirective: [],
          }),
        ),
    };

    const engine = createEngine({
      provider,
      retry: { maxAttempts: 3, initialDelayMs: 10 },
    });

    const result = await engine.process(baseRequest);

    expect(result.rationale).toBe('Success on third try');
    expect(provider.complete).toHaveBeenCalledTimes(3);
  });

  it('should throw after max retries exceeded', async () => {
    const provider: LLMProvider = {
      complete: vi.fn().mockRejectedValue(new Error('Always fails')),
    };

    const engine = createEngine({
      provider,
      retry: { maxAttempts: 2, initialDelayMs: 10 },
    });

    await expect(engine.process(baseRequest)).rejects.toThrow(EngineError);
    expect(provider.complete).toHaveBeenCalledTimes(2);
  });

  it('should not retry on parse errors', async () => {
    const provider: LLMProvider = {
      complete: vi.fn().mockResolvedValue('not valid json'),
    };

    const engine = createEngine({
      provider,
      retry: { maxAttempts: 3, initialDelayMs: 10 },
    });

    await expect(engine.process(baseRequest)).rejects.toThrow(EngineError);
    expect(provider.complete).toHaveBeenCalledTimes(1);
  });

  it('should timeout if provider takes too long', async () => {
    const provider: LLMProvider = {
      complete: vi
        .fn()
        .mockImplementation(
          () => new Promise((resolve) => setTimeout(resolve, 5000)),
        ),
    };

    const engine = createEngine({
      provider,
      timeout: 100,
      retry: { maxAttempts: 1 },
    });

    await expect(engine.process(baseRequest)).rejects.toThrow('timed out');
  }, 10000);
});
