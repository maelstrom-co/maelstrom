import { afterEach, describe, expect, test } from 'bun:test';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

import { installMockChat, mockChat } from '../__test-helpers__/mock-chat.js';
import {
  POC_CASES,
  type PocRun,
  runPocCase,
  runPocCaseOnDecisions,
  SCREEN_SCOPE_CASES,
} from '../__test-helpers__/poc-fixtures.js';
import { buildJevPlanner, jevPlanner } from '../jev-planner.js';
import { buildJevUngatedStepwisePlanner } from '../planners-experimental/jev-ungated-stepwise.js';
import { jevSelect } from './jev-select.js';
import { createJevDeps, type JevDeps } from './stage-deps.js';

installMockChat();

const SNAPSHOT_DIR = join(
  import.meta.dir,
  '../__test-helpers__/poc-evaluations',
);
const SCREEN_SCOPE_SNAPSHOT_DIR = join(
  import.meta.dir,
  '../__test-helpers__/poc-screen-scope-evaluations',
);
const snapshotFile = (name: string, dir = SNAPSHOT_DIR) =>
  join(dir, `${name}.json`);

// Regenerate with UPDATE_POC_SNAPSHOT=1 only for a deliberate POC change.
const UPDATE = process.env.UPDATE_POC_SNAPSHOT === '1';
const pinned = await readPinned(SNAPSHOT_DIR);
const pinnedScreenScope = await readPinned(SCREEN_SCOPE_SNAPSHOT_DIR);
const updated: Record<string, PocRun> = {};
const updatedScreenScope: Record<string, PocRun> = {};

const originalPoc = (deps: JevDeps) =>
  buildJevPlanner(deps, { select: jevSelect });

afterEach(() => mockChat.mockReset());

describe('frozen POC snapshot', () => {
  describe('jevPlanner with the screen scope select', () => {
    for (const fixture of SCREEN_SCOPE_CASES)
      test(`${fixture.name} sends the pinned evaluations and ships the pinned candidate`, async () => {
        const run = await runPocCase(fixture, (options) => jevPlanner(options));
        updatedScreenScope[fixture.name] = run;
        if (UPDATE) return;
        expect(run).toEqual(pinnedScreenScope[fixture.name] as PocRun);
      });
  });

  describe('jev-poc with the original select', () => {
    for (const fixture of POC_CASES)
      test(`${fixture.name} sends the pinned evaluations and ships the pinned candidate`, async () => {
        const run = await runPocCase(fixture, (options) =>
          originalPoc(createJevDeps(options)),
        );
        updated[fixture.name] = run;
        if (UPDATE) return;
        expect(run).toEqual(pinned[fixture.name] as PocRun);
      });
  });

  describe('jev-poc with the original select on a Decisions client', () => {
    for (const fixture of POC_CASES)
      test(`${fixture.name} sends the pinned evaluations and ships the pinned candidate`, async () => {
        const run = await runPocCaseOnDecisions(fixture, originalPoc);
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
    const names = [...POC_CASES.map((c) => c.name)].sort();
    for (const [dir, runs] of [
      [SNAPSHOT_DIR, updated],
      [SCREEN_SCOPE_SNAPSHOT_DIR, updatedScreenScope],
    ] as const) {
      if (UPDATE)
        for (const name of names)
          await Bun.write(
            snapshotFile(name, dir),
            `${JSON.stringify(runs[name], null, 2)}\n`,
          );
      const files = (await readdir(dir))
        .filter((entry) => entry.endsWith('.json'))
        .map((entry) => entry.replace(/\.json$/, ''))
        .sort();
      expect(files).toEqual(names);
    }
    expect(Object.keys(pinned).sort()).toEqual(names);
    expect(Object.keys(pinnedScreenScope).sort()).toEqual(names);
  });
});

async function readPinned(dir: string): Promise<Record<string, PocRun>> {
  const runs: Record<string, PocRun> = {};
  for (const fixture of POC_CASES) {
    const file = Bun.file(snapshotFile(fixture.name, dir));
    if (await file.exists()) runs[fixture.name] = await file.json();
  }
  return runs;
}

function withoutModel({ model: _model, ...rest }: { model: string }) {
  return rest;
}
