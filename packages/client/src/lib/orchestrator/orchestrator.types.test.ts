import { describe, expect, it } from 'bun:test';

import { createMockConnector } from '../../../test-utils/connector-mocks.js';
import { Orchestrator } from './orchestrator.js';
import { resolveOrchestratorOptions } from './orchestrator.types.js';

describe('resolveOrchestratorOptions agentRunStaleTimeoutMs', () => {
  it('defaults to 150000', () => {
    expect(resolveOrchestratorOptions().agentRunStaleTimeoutMs).toBe(150_000);
  });

  it('keeps an explicit value', () => {
    expect(
      resolveOrchestratorOptions({ agentRunStaleTimeoutMs: 5000 })
        .agentRunStaleTimeoutMs,
    ).toBe(5000);
  });

  it('keeps Infinity to disable the safety net', () => {
    expect(
      resolveOrchestratorOptions({ agentRunStaleTimeoutMs: Infinity })
        .agentRunStaleTimeoutMs,
    ).toBe(Infinity);
  });

  it('accepts the largest timer delay', () => {
    expect(
      resolveOrchestratorOptions({ agentRunStaleTimeoutMs: 2_147_483_647 })
        .agentRunStaleTimeoutMs,
    ).toBe(2_147_483_647);
  });

  it.each([2_147_483_648, 3e9])(
    'rejects %p beyond the timer limit and says Infinity disables',
    (value) => {
      expect(() =>
        resolveOrchestratorOptions({ agentRunStaleTimeoutMs: value }),
      ).toThrow(/agentRunStaleTimeoutMs.*2147483647.*Infinity/);
    },
  );

  it.each([0, -1, Number.NaN])('throws naming the option for %p', (value) => {
    expect(() =>
      resolveOrchestratorOptions({ agentRunStaleTimeoutMs: value }),
    ).toThrow(/agentRunStaleTimeoutMs/);
  });

  it('throws at Orchestrator construction', () => {
    expect(
      () =>
        new Orchestrator(createMockConnector(), { agentRunStaleTimeoutMs: 0 }),
    ).toThrow(/agentRunStaleTimeoutMs/);
  });
});
