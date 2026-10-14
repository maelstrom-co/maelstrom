import { describe, expect, test } from 'bun:test';
import { assertUniqueStageModules, runStageEvalCli } from './stage-cli.js';
import type { RegisteredStageEval } from './stage-eval.js';

function fakeModule(name: string): RegisteredStageEval {
  return { name } as unknown as RegisteredStageEval;
}

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
