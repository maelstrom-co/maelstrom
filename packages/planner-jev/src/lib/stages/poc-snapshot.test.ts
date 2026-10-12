import { afterEach, describe, expect, test } from 'bun:test';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

import { installMockChat, mockChat } from '../__test-helpers__/mock-chat.js';
import {
  POC_CASES,
  type PocRun,
  runPocCase,
  runPocCaseOnDecisions,
} from '../__test-helpers__/poc-fixtures.js';
import { buildJevPlanner, jevPlanner } from '../jev-planner.js';
import { buildJevUngatedStepwisePlanner } from '../planners-experimental/jev-ungated-stepwise.js';
import { createJevDeps } from './stage-deps.js';

installMockChat();

const SNAPSHOT_DIR = join(
  import.meta.dir,
  '../__test-helpers__/poc-evaluations',
);
const snapshotFile = (name: string) => join(SNAPSHOT_DIR, `${name}.json`);

// Regenerate with UPDATE_POC_SNAPSHOT=1 only for a deliberate POC change.
const UPDATE = process.env.UPDATE_POC_SNAPSHOT === '1';
const pinned: Record<string, PocRun> = {};
for (const fixture of POC_CASES) {
  const file = Bun.file(snapshotFile(fixture.name));
  if (await file.exists()) pinned[fixture.name] = await file.json();
}
const updated: Record<string, PocRun> = {};

afterEach(() => mockChat.mockReset());

describe('frozen POC snapshot', () => {
  describe('jev-poc', () => {
    for (const fixture of POC_CASES)
      test(`${fixture.name} sends the pinned evaluations and ships the pinned candidate`, async () => {
        const run = await runPocCase(fixture, (options) => jevPlanner(options));
        updated[fixture.name] = run;
        if (UPDATE) return;
        expect(run).toEqual(pinned[fixture.name] as PocRun);
      });
  });

  describe('jev-poc on a Decisions client', () => {
    for (const fixture of POC_CASES)
      test(`${fixture.name} sends the pinned evaluations and ships the pinned candidate`, async () => {
        const run = await runPocCaseOnDecisions(fixture, buildJevPlanner);
        if (UPDATE) return;
        const expected = pinned[fixture.name] as PocRun;
        expect(run.evaluations.map(withoutModel)).toEqual(
          expected.evaluations.map(withoutModel),
        );
        expect(run.completions).toEqual(expected.completions);
        expect(run.fallbackCalls).toBe(expected.fallbackCalls);
        expect(run.response).toEqual(expected.response);
      });
  });

  // Holds only while the stage library still matches the POC.
  describe('jev-ungated-stepwise matches the POC today', () => {
    for (const fixture of POC_CASES)
      test(`${fixture.name} sends the POC's pinned evaluations and ships its pinned candidate`, async () => {
        const run = await runPocCase(fixture, (options) =>
          buildJevUngatedStepwisePlanner(createJevDeps(options)),
        );
        if (UPDATE) return;
        expect(run).toEqual(pinned[fixture.name] as PocRun);
      });
  });

  test('pins every fixture and nothing else', async () => {
    if (UPDATE)
      for (const fixture of POC_CASES)
        await Bun.write(
          snapshotFile(fixture.name),
          `${JSON.stringify(updated[fixture.name], null, 2)}\n`,
        );
    const files = (await readdir(SNAPSHOT_DIR))
      .filter((entry) => entry.endsWith('.json'))
      .map((entry) => entry.replace(/\.json$/, ''))
      .sort();
    expect(files).toEqual([...POC_CASES.map((c) => c.name)].sort());
    expect(Object.keys(pinned).sort()).toEqual(
      [...POC_CASES.map((c) => c.name)].sort(),
    );
  });
});

function withoutModel({ model: _model, ...rest }: { model: string }) {
  return rest;
}
