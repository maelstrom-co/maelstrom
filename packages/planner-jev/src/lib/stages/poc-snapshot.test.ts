import { afterEach, describe, expect, test } from 'bun:test';
import { join } from 'node:path';

import { mockChat } from '../__test-helpers__/mock-chat.js';
import {
  POC_CASES,
  type PocRun,
  runPocCase,
} from '../__test-helpers__/poc-fixtures.js';
import { jevPlanner } from '../jev-planner.js';

const SNAPSHOT = join(
  import.meta.dir,
  '../__test-helpers__/poc-evaluations.json',
);

// Regenerate with UPDATE_POC_SNAPSHOT=1 only for a deliberate POC change.
const UPDATE = process.env.UPDATE_POC_SNAPSHOT === '1';
const pinned: Record<string, PocRun> = (await Bun.file(SNAPSHOT).exists())
  ? await Bun.file(SNAPSHOT).json()
  : {};
const updated: Record<string, PocRun> = {};

afterEach(() => mockChat.mockReset());

describe('frozen POC snapshot', () => {
  for (const fixture of POC_CASES)
    test(`${fixture.name} sends the pinned evaluations and ships the pinned candidate`, async () => {
      const run = await runPocCase(fixture, (options) => jevPlanner(options));
      updated[fixture.name] = run;
      if (UPDATE) return;
      expect(run).toEqual(pinned[fixture.name] as PocRun);
    });

  test('pins every fixture and nothing else', async () => {
    if (UPDATE)
      await Bun.write(SNAPSHOT, `${JSON.stringify(updated, null, 2)}\n`);
    expect(Object.keys(pinned)).toEqual(POC_CASES.map((c) => c.name));
  });
});
