import { afterEach, describe, expect, test } from 'bun:test';
import { join } from 'node:path';

import { mockChat } from '../__test-helpers__/mock-chat.js';
import {
  POC_CASES,
  type PocRun,
  runPocCase,
} from '../__test-helpers__/poc-fixtures.js';
import { jevPlanner } from '../jev-planner.js';
import { createJevDeps } from '../stages-next/deps.js';
import { buildJevPocRebuiltPlanner } from './jev-poc-rebuilt.js';

const pinned = (await Bun.file(
  join(import.meta.dir, '../__test-helpers__/poc-evaluations.json'),
).json()) as Record<string, PocRun>;

afterEach(() => mockChat.mockReset());

describe('jev-poc-rebuilt parity with jev-poc', () => {
  for (const fixture of POC_CASES)
    test(`${fixture.name}: same evaluations, completion call and candidate`, async () => {
      const poc = await runPocCase(fixture, (options) => jevPlanner(options));
      const rebuilt = await runPocCase(fixture, (options) =>
        buildJevPocRebuiltPlanner(createJevDeps(options)),
      );
      expect(rebuilt).toEqual(poc);
      expect(rebuilt).toEqual(pinned[fixture.name] as PocRun);
    });
});
