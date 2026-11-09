import { expect, test } from 'bun:test';

import {
  type AgentRunOptions,
  BUDGET_CLOSING_MESSAGE,
  DEFAULT_AGENT_RUN_BUDGETS,
} from './agent-run.js';

test('default budgets and the closing message keep their settled values', () => {
  expect(DEFAULT_AGENT_RUN_BUDGETS).toEqual({
    maxTurns: 12,
    maxElapsedMs: 120_000,
    maxTokens: 100_000,
    maxToolCalls: 24,
  });
  expect(Object.isFrozen(DEFAULT_AGENT_RUN_BUDGETS)).toBe(true);
  expect(BUDGET_CLOSING_MESSAGE).toBe(
    'I could not finish this within my limits. Try a narrower question.',
  );
});

test('the reserved inbox option accepts no value', () => {
  const signal = new AbortController().signal;
  const withoutInbox: AgentRunOptions = { signal };
  // @ts-expect-error inbox is reserved and not implemented
  const withInbox: AgentRunOptions = { signal, inbox: {} };
  expect(withoutInbox.inbox).toBeUndefined();
  expect(withInbox.signal).toBe(signal);
});
