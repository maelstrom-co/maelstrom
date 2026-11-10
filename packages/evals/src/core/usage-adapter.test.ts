import { describe, expect, test } from 'bun:test';

import { withUsage as telemetryWithUsage } from '@maelstrom-co/telemetry/usage-adapter';
import type { AnyTextAdapter } from '@tanstack/ai';

import { LLM_ROLES, type LlmCall, withUsage } from './usage-adapter.js';

describe('evals usage adapter', () => {
  test('lists every role in report order', () => {
    expect(LLM_ROLES).toEqual([
      'planner',
      'fallback',
      'complete',
      'layout',
      'grader',
    ]);
  });

  test('re-exports the telemetry withUsage', () => {
    expect(withUsage).toBe(telemetryWithUsage);
  });

  test('labels calls with an evals role', async () => {
    const calls: LlmCall[] = [];
    const adapter = withUsage(
      {
        kind: 'text',
        name: 'fake',
        model: 'fake-model',
        structuredOutput: async () => ({
          data: 1,
          rawText: '1',
          usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 },
        }),
      } as unknown as AnyTextAdapter,
      'grader',
      (call) => calls.push(call),
    );
    await adapter.structuredOutput({} as never);
    expect(calls[0]?.role).toBe('grader');
    expect(calls[0]?.usage).toEqual({
      inputTokens: 1,
      outputTokens: 2,
      totalTokens: 3,
    });
  });
});
