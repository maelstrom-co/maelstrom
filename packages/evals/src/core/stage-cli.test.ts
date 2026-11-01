import { describe, expect, spyOn, test } from 'bun:test';
import type { Judge } from './plugin.js';
import { assertUniqueStageModules, runStageEvalCli } from './stage-cli.js';
import type { RegisteredStageEval } from './stage-eval.js';

function fakeModule(name: string): RegisteredStageEval {
  return { name } as unknown as RegisteredStageEval;
}

test('stage CLI checks an injected judge requiredEnv before running', async () => {
  const name = 'MAELSTROM_TEST_MISSING_STAGE_JUDGE_KEY';
  const previous = process.env[name];
  delete process.env[name];
  let runs = 0;
  let judgeCalls = 0;
  const module = {
    name: 'fake',
    variants: ['one'],
    async configure() {
      return { module, meta: {} };
    },
    async run() {
      runs++;
      return [];
    },
  } as unknown as RegisteredStageEval;
  const judge: Judge = {
    requiredEnv: [name],
    async score() {
      judgeCalls++;
      return { answers: {}, calls: [] };
    },
  };
  const exit = spyOn(process, 'exit').mockImplementation((code) => {
    throw new Error(`exit ${code}`);
  });
  const error = spyOn(console, 'error').mockImplementation(() => {});
  try {
    await expect(
      runStageEvalCli(
        [module],
        ['bun', 'stage-cli', '--stage=fake', '--case=swap'],
        () => ({ judge }),
      ),
    ).rejects.toThrow('exit 2');
    expect(error).toHaveBeenCalledWith(`stage eval skipped: missing ${name}`);
    expect(runs).toBe(0);
    expect(judgeCalls).toBe(0);
  } finally {
    exit.mockRestore();
    error.mockRestore();
    if (previous === undefined) delete process.env[name];
    else process.env[name] = previous;
  }
});

test('stage CLI rejects an injected legacy rubric before configuring or running the stage', async () => {
  let configurations = 0;
  const module = {
    name: 'fake',
    async configure() {
      configurations++;
      throw new Error('must not configure');
    },
  } as unknown as RegisteredStageEval;
  const exit = spyOn(process, 'exit').mockImplementation((code) => {
    throw new Error(`exit ${code}`);
  });
  const error = spyOn(console, 'error').mockImplementation(() => {});
  try {
    await expect(
      runStageEvalCli([module], ['bun', 'stage-cli', '--stage=fake'], () => ({
        judgeRubric: 'legacy',
      })),
    ).rejects.toThrow('exit 1');
    expect(error).toHaveBeenCalledWith(
      'Stage judging supports only the surface rubric',
    );
    expect(configurations).toBe(0);
  } finally {
    exit.mockRestore();
    error.mockRestore();
  }
});

const unreadableArgv = new Proxy([] as string[], {
  get() {
    throw new Error('argv was read');
  },
});

describe('the stage module registry', () => {
  test('throws naming a module registered twice', () => {
    expect(() =>
      assertUniqueStageModules([
        fakeModule('alpha'),
        fakeModule('beta'),
        fakeModule('alpha'),
      ]),
    ).toThrow('stage module alpha is registered twice');
  });

  test('accepts modules with distinct names', () => {
    expect(() =>
      assertUniqueStageModules([fakeModule('alpha'), fakeModule('beta')]),
    ).not.toThrow();
  });

  test('the stage eval command line refuses duplicates before reading its arguments', async () => {
    await expect(
      runStageEvalCli(
        [fakeModule('alpha'), fakeModule('alpha')],
        unreadableArgv,
      ),
    ).rejects.toThrow('stage module alpha is registered twice');
  });
});
