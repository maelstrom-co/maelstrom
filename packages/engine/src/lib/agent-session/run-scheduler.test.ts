import { expect, test } from 'bun:test';

import {
  AGENT_WIRE_VERSION,
  type AgentUiChangeEvent,
  ChangeId,
  MessageId,
  RunId,
} from '@maelstrom-co/protocol';

import { observeUiChangeEmitted } from './run-scheduler.js';

function uiChange(runId: RunId | null): AgentUiChangeEvent {
  return {
    type: 'ui_change',
    version: AGENT_WIRE_VERSION,
    runId,
    changeId: ChangeId('change-1'),
    response: {
      executionPlan: [],
      layout: { type: 'tiling', tree: [], instances: [] },
    } as unknown as AgentUiChangeEvent['response'],
  };
}

function recordingObservers() {
  const runOwned: unknown[][] = [];
  const sessionOwned: unknown[][] = [];
  return {
    runOwned,
    sessionOwned,
    observers: {
      observe: (...args: unknown[]) => {
        runOwned.push(args);
      },
      observeSession: (...args: unknown[]) => {
        sessionOwned.push(args);
      },
    },
  };
}

test('a UI change of an Agent Run is observed as run-owned', () => {
  const { runOwned, sessionOwned, observers } = recordingObservers();
  const readContent = () => ({ intent: 'show it' });
  observeUiChangeEmitted(
    uiChange(RunId('run-1')),
    MessageId('input-1'),
    observers,
    { changeId: 'change-1', actions: 0 },
    readContent,
  );
  expect(runOwned).toEqual([
    [
      RunId('run-1'),
      MessageId('input-1'),
      'engine.agent.ui_change.emitted',
      { changeId: 'change-1', actions: 0 },
      readContent,
    ],
  ]);
  expect(sessionOwned).toEqual([]);
});

test('a UI change outside any Agent Run is observed as session-owned with its metadata unchanged', () => {
  const { runOwned, sessionOwned, observers } = recordingObservers();
  observeUiChangeEmitted(uiChange(null), MessageId('input-1'), observers, {
    changeId: 'change-1',
    actions: 0,
  });
  expect(sessionOwned).toEqual([
    [
      'engine.agent.ui_change.emitted',
      { changeId: 'change-1', actions: 0 },
      undefined,
    ],
  ]);
  expect(runOwned).toEqual([]);
});
