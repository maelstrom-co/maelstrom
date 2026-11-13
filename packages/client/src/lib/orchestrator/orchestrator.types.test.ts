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
