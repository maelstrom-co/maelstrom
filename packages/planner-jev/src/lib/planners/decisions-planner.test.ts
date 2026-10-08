import { afterEach, describe, expect, test } from 'bun:test';
import { join } from 'node:path';

import {
  dummyAdapter,
  installMockChat,
  mockChat,
} from '../__test-helpers__/mock-chat.js';
import {
  POC_CASES,
  type PocRun,
  runPocCaseOnDecisions,
} from '../__test-helpers__/poc-fixtures.js';
import {
  buildDecisionsPlanner,
  decisionsPlanner,
} from './decisions-planner.js';

installMockChat();

afterEach(() => mockChat.mockReset());

const SNAPSHOT_DIR = join(
  import.meta.dir,
  '../__test-helpers__/poc-evaluations',
);

const KEY = 'decisions-secret-key-value';

describe('buildDecisionsPlanner on the pinned POC cases', () => {
  for (const fixture of POC_CASES)
    test(`${fixture.name} asks the pinned evaluations and ships the pinned response`, async () => {
      const pinned = (await Bun.file(
        join(SNAPSHOT_DIR, `${fixture.name}.json`),
      ).json()) as PocRun;
      const run = await runPocCaseOnDecisions(fixture, buildDecisionsPlanner);
      expect(run.evaluations.map(withoutModel)).toEqual(
        pinned.evaluations.map(withoutModel),
      );
      expect(run.completions).toEqual(pinned.completions);
      expect(run.fallbackCalls).toBe(pinned.fallbackCalls);
      expect(run.response).toEqual(pinned.response);
    });
});

describe('decisionsPlanner options', () => {
  const fallback = async () => {
    throw new Error('unused');
  };

  test.each([
    [
      'a missing fallback',
      { fallback: undefined as never },
      'Invalid DecisionsPlannerOptions: fallback must be a stage',
    ],
    [
      'a missing adapter',
      { adapter: undefined as never },
      'Invalid DecisionsPlannerOptions: adapter is required',
    ],
    [
      'an invalid Decisions option',
      { decisions: { apiKey: KEY, timeoutMs: -1 } },
      'Invalid Decisions option: timeoutMs must be positive',
    ],
  ])('rejects %s without echoing the key', (_name, override, message) => {
    let caught: unknown;
    try {
      decisionsPlanner({
        decisions: { apiKey: KEY },
        adapter: dummyAdapter,
        fallback,
        ...override,
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toBe(message);
    expect((caught as Error).message).not.toContain(KEY);
  });

  test('builds a planner from valid options', () => {
    expect(
      typeof decisionsPlanner({
        decisions: { apiKey: KEY, logReplies: true },
        adapter: dummyAdapter,
        fallback,
      }),
    ).toBe('function');
  });
});

function withoutModel({ model: _model, ...rest }: { model: string }) {
  return rest;
}
