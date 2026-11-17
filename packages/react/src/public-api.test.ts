import { expect, expectTypeOf, spyOn, test } from 'bun:test';
import { readFileSync } from 'node:fs';

import type * as client from '@maelstrom-co/client';
import { isSettled as clientIsSettled } from '@maelstrom-co/client';
import type * as protocol from '@maelstrom-co/protocol';

import * as testingApi from './_testing.js';
import {
  type AgentConversationEvents,
  type AgentFinishReason,
  type AgentMessageSubmission,
  type AgentRunChange,
  type AgentRunChangeError,
  type AgentRunError,
  type AgentRunMetrics,
  type AgentRunOutcome,
  type AgentRunState,
  type AgentRunStatus,
  type AgentRunsSnapshot,
  type ChangeId,
  type ConversationLostReason,
  createMaelstrom,
  isSettled,
  type MessageId,
  type RunId,
  type SendMessageOptions,
  type SettledAgentRun,
  type UseAgentRunResult,
  vessel,
} from './index.js';
import { testVessel } from './lib/__tests__/test-vessel.fixture.js';
import { warnOnce } from './lib/warn-once.js';

test('keeps warning helpers off the root and exposes only reset through _testing', () => {
  const rootSource = readFileSync(
    new URL('./index.ts', import.meta.url),
    'utf8',
  );
  expect(rootSource).not.toMatch(/\bwarnOnce\b/);
  expect(rootSource).not.toMatch(/\bresetWarnings\b/);
  expect(Object.keys(testingApi)).toEqual(['resetWarnings']);
});

test('resetWarnings is an empty-state no-op and permits a key to warn again', () => {
  testingApi.resetWarnings();
  const warn = spyOn(console, 'warn').mockImplementation(() => {});

  try {
    warnOnce('public-api-test', 'disabled', { enabled: false });
    expect(warn).not.toHaveBeenCalled();

    warnOnce('public-api-test', 'first');
    warnOnce('public-api-test', 'duplicate');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenLastCalledWith('first');

    testingApi.resetWarnings();
    warnOnce('public-api-test', 'after reset');
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenLastCalledWith('after reset');
  } finally {
    warn.mockRestore();
    testingApi.resetWarnings();
  }
});

test('exposes useAgentRun and useAgentEvent on every Maelstrom instance', () => {
  const m = createMaelstrom({ vessels: [vessel(testVessel, () => null)] });
  const extended = m.with(() => ({}));

  expect(typeof m.useAgentRun).toBe('function');
  expect(typeof m.useAgentEvent).toBe('function');
  expect(extended.useAgentRun).toBe(m.useAgentRun);
  expect(extended.useAgentEvent).toBe(m.useAgentEvent);
});

test('exports the Agent Run types and the useAgentRun result from the root', () => {
  expectTypeOf<AgentRunStatus>().toEqualTypeOf<
    | 'pending'
    | 'working'
    | 'streaming'
    | 'finished'
    | 'ignored'
    | 'failed'
    | 'lost'
    | 'not_submitted'
  >();
  expectTypeOf<AgentRunState>().toEqualTypeOf<client.AgentRunState>();
  expectTypeOf<AgentRunsSnapshot>().toEqualTypeOf<client.AgentRunsSnapshot>();
  expectTypeOf<
    AgentRunsSnapshot['run']
  >().toEqualTypeOf<AgentRunState | null>();
  expectTypeOf<AgentRunsSnapshot['runs']>().toEqualTypeOf<
    readonly AgentRunState[]
  >();
  expectTypeOf<AgentRunState['status']>().toEqualTypeOf<AgentRunStatus>();
  expectTypeOf<keyof UseAgentRunResult>().toEqualTypeOf<
    'run' | 'runs' | 'error' | 'sendMessage'
  >();
  expectTypeOf<
    UseAgentRunResult['error']
  >().toEqualTypeOf<AgentRunError | null>();
  expectTypeOf<UseAgentRunResult['sendMessage']>().toEqualTypeOf<
    (text: string, options?: SendMessageOptions) => AgentMessageSubmission
  >();
  expectTypeOf<AgentMessageSubmission['result']>().toEqualTypeOf<
    Promise<SettledAgentRun>
  >();
  expectTypeOf<
    Extract<AgentRunState, { status: 'finished' }>['outcome']
  >().toEqualTypeOf<AgentRunOutcome>();
  expectTypeOf<
    Extract<AgentRunState, { status: 'finished' }>['ack']
  >().toEqualTypeOf<string>();
  expectTypeOf<AgentRunState['changes']>().toEqualTypeOf<
    readonly AgentRunChange[]
  >();
  expectTypeOf<AgentRunState['changeErrors']>().toEqualTypeOf<
    readonly AgentRunChangeError[]
  >();
  expect(isSettled).toBe(clientIsSettled);
});

test('re-exports the client and protocol types used by the Agent Run API', () => {
  expectTypeOf<AgentConversationEvents>().toEqualTypeOf<client.AgentConversationEvents>();
  expectTypeOf<ConversationLostReason>().toEqualTypeOf<client.ConversationLostReason>();
  expectTypeOf<MessageId>().toEqualTypeOf<client.MessageId>();
  expectTypeOf<SendMessageOptions>().toEqualTypeOf<client.SendMessageOptions>();
  expectTypeOf<AgentFinishReason>().toEqualTypeOf<protocol.AgentFinishReason>();
  expectTypeOf<AgentRunMetrics>().toEqualTypeOf<protocol.AgentRunMetrics>();
  expectTypeOf<ChangeId>().toEqualTypeOf<protocol.ChangeId>();
  expectTypeOf<RunId>().toEqualTypeOf<protocol.RunId>();
  expectTypeOf<AgentRunState['inputId']>().toEqualTypeOf<MessageId>();
  expectTypeOf<AgentRunState['runId']>().toEqualTypeOf<RunId | null>();
  expectTypeOf<AgentRunChange['changeId']>().toEqualTypeOf<ChangeId>();
  expectTypeOf<
    Extract<AgentRunState, { status: 'lost' }>['lostReason']
  >().toEqualTypeOf<ConversationLostReason | 'send_failed'>();
  expectTypeOf<AgentRunOutcome['reason']>().toEqualTypeOf<AgentFinishReason>();
  expectTypeOf<AgentRunOutcome['metrics']>().toEqualTypeOf<
    Readonly<AgentRunMetrics>
  >();
});
