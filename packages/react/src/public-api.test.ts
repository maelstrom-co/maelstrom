import { expect, expectTypeOf, spyOn, test } from 'bun:test';
import { readFileSync } from 'node:fs';

import type { MessageId, SendMessageOptions } from '@maelstrom-co/client';

import * as testingApi from './_testing.js';
import {
  type AgentRunState,
  type AgentRunStatus,
  type AgentRunsSnapshot,
  createMaelstrom,
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
    'pending' | 'working' | 'streaming' | 'finished' | 'failed' | 'lost'
  >();
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
  expectTypeOf<UseAgentRunResult['run']>().toEqualTypeOf<
    AgentRunsSnapshot['run']
  >();
  expectTypeOf<UseAgentRunResult['runs']>().toEqualTypeOf<
    AgentRunsSnapshot['runs']
  >();
  expectTypeOf<UseAgentRunResult['error']>().toEqualTypeOf<
    AgentRunsSnapshot['error']
  >();
  expectTypeOf<UseAgentRunResult['sendMessage']>().toEqualTypeOf<
    (text: string, options?: SendMessageOptions) => Promise<MessageId>
  >();

  const rootSource = readFileSync(
    new URL('./index.ts', import.meta.url),
    'utf8',
  );
  for (const name of [
    'AgentRunState',
    'AgentRunStatus',
    'AgentRunsSnapshot',
    'UseAgentRunResult',
  ]) {
    expect(rootSource).toMatch(new RegExp(`\\b${name}\\b`));
  }
});
