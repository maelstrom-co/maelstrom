import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ok } from '@maelstrom-co/protocol';
import {
  fakePluginWith,
  TOKYO_CANDIDATE,
} from './__test-helpers__/fake-planner.js';
import { runEvalCli } from './cli.js';
import * as orchestration from './run-orchestration.js';
import { runStageEvalCli } from './stage-cli.js';
import { registerStageEval } from './stage-eval.js';

let directory: string;
let network: ReturnType<typeof spyOn<typeof globalThis, 'fetch'>>;
let logging: ReturnType<typeof spyOn<typeof console, 'log'>>;
let common: ReturnType<typeof spyOn<typeof orchestration, 'runEvaluationRun'>>;
let keys: (string | undefined)[];
let exiting: ReturnType<typeof spyOn<typeof process, 'exit'>>;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'shared-eval-cli-'));
  keys = [process.env.OPENAI_API_KEY, process.env.FAKE_KEY];
  process.env.OPENAI_API_KEY = 'synthetic-unused';
  process.env.FAKE_KEY = 'synthetic-unused';
  const deny = () => {
    throw new Error('No network permitted');
  };
  network = spyOn(globalThis, 'fetch').mockImplementation(
    Object.assign(deny, { preconnect: deny }),
  );
  exiting = spyOn(process, 'exit').mockImplementation((code) => {
    throw new Error(`Unexpected CLI exit ${code}`);
  });
  logging = spyOn(console, 'log').mockImplementation(() => {});
  common = spyOn(orchestration, 'runEvaluationRun');
});
afterEach(async () => {
  expect(network).not.toHaveBeenCalled();
  common.mockRestore();
  network.mockRestore();
  logging.mockRestore();
  exiting.mockRestore();
  for (const [index, key] of ['OPENAI_API_KEY', 'FAKE_KEY'].entries()) {
    if (keys[index] === undefined) delete process.env[key];
    else process.env[key] = keys[index];
  }
  await rm(directory, { recursive: true, force: true });
});

test('both CLIs dispatch native reporting through shared orchestration without changing report formats', async () => {
  const plannerOut = join(directory, 'planner');
  await runEvalCli(
    [
      {
        ...fakePluginWith({ candidate: () => TOKYO_CANDIDATE }),
        fallback: () => async () => ok(TOKYO_CANDIDATE),
      },
    ],
    [
      'bun',
      'eval',
      '--case=quoted-location',
      '--arm=fake',
      '--repeats=2',
      '--model=gpt-5.2',
      `--out=${plannerOut}`,
    ],
  );
  const stage = registerStageEval({
    name: 'synthetic-stage',
    stage: 'synthetic-stage',
    variants: { identity: () => async (input: string) => ok(input) },
    makeDeps: () => undefined,
    prepare: async (scenario, ctx) => ({
      applicable: true as const,
      input: scenario.id,
      origin: ctx.origin,
    }),
    judge: () => ({ outcome: 'pass' as const, failures: [], detail: {} }),
    reportSections: () => ['## Synthetic native section'],
  });
  const stageOut = join(directory, 'stage');
  await runStageEvalCli(
    [stage],
    [
      'bun',
      'eval-stages',
      '--stage=synthetic-stage',
      '--case=quoted-location',
      '--repeats=2',
      '--concurrency=2',
      `--out=${stageOut}`,
    ],
  );
  expect(common).toHaveBeenCalledTimes(2);
  expect(common.mock.calls.map(([options]) => options.policy)).toEqual([
    'native:planner/v1',
    'native:stage/v1',
  ]);
  expect(
    common.mock.calls.every(
      ([options]) => typeof options.report === 'function',
    ),
  ).toBe(true);
  const plannerRecords = JSON.parse(
    await readFile(join(plannerOut, 'records.json'), 'utf8'),
  );
  const stageRecords = JSON.parse(
    await readFile(join(stageOut, 'records.json'), 'utf8'),
  );
  expect(
    plannerRecords.map((record: { repeat: number }) => record.repeat),
  ).toEqual([1, 2]);
  expect(
    stageRecords.map((record: { repeat: number }) => record.repeat),
  ).toEqual([1, 2]);
  const summary = JSON.parse(
    await readFile(join(plannerOut, 'summary.json'), 'utf8'),
  );
  expect(summary.meta).toMatchObject({
    scenarios: 1,
    repeats: 2,
    arms: 'fake',
  });
  expect(await readFile(join(plannerOut, 'report.md'), 'utf8')).toContain(
    'Fake picks',
  );
  expect(await readFile(join(stageOut, 'report.md'), 'utf8')).toContain(
    'Synthetic native section',
  );
});
