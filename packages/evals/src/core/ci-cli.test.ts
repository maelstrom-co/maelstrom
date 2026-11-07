import { expect, spyOn, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ok } from '@maelstrom-co/protocol';

import {
  fakePluginWith,
  TOKYO_CANDIDATE,
} from './__test-helpers__/fake-planner.js';
import { runEvalCli } from './cli.js';
import { runStageEvalCli } from './stage-cli.js';
import { registerStageEval } from './stage-eval.js';

async function offline(run: (out: string) => Promise<void>) {
  const out = await mkdtemp(join(tmpdir(), 'ci-evals-'));
  const log = spyOn(console, 'log').mockImplementation(() => {});
  const deny = () => {
    throw new Error('No network allowed');
  };
  const network = spyOn(globalThis, 'fetch').mockImplementation(
    Object.assign(deny, { preconnect: deny }),
  );
  const previous = {
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    FAKE_KEY: process.env.FAKE_KEY,
  };
  process.env.OPENAI_API_KEY = 'synthetic';
  process.env.FAKE_KEY = 'synthetic';
  try {
    await run(out);
    expect(network).not.toHaveBeenCalled();
  } finally {
    network.mockRestore();
    log.mockRestore();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(out, { recursive: true, force: true });
  }
}

test('planner CI flag leaves scores informational but reports before rejecting a failed call masked by fallback', async () => {
  await offline(async (out) => {
    for (const code of [
      undefined,
      'provider_refusal',
      'provider_http',
      'option_cap',
    ] as const) {
      const runtimeFailure = code === 'provider_http' || code === 'option_cap';
      const fake = fakePluginWith({
        candidate: () => TOKYO_CANDIDATE,
        ...(code && { deferAt: 'pick', code }),
      });
      const plugin: typeof fake = {
        ...fake,
        recordTurn: (...args) => ({
          ...fake.recordTurn?.(...args),
          jevCalls: [{ outcome: code ?? 'ok' }],
        }),
        fallback: () => async () => ok(TOKYO_CANDIDATE),
      };
      const target = join(out, code ?? 'score-failure');
      const run = runEvalCli(
        [plugin],
        [
          'bun',
          'eval',
          '--case=swap',
          '--repeats=1',
          '--no-grader',
          '--fail-on-runtime-error',
          '--out',
          target,
        ],
      );
      if (runtimeFailure) await expect(run).rejects.toThrow('runtime failed');
      else await run;
      const report = await readFile(join(target, 'report.md'), 'utf8');
      expect(report).toContain('Overall pass | 0/1');
      if (runtimeFailure) expect(report).toContain(`pick/${code}`);
      if (code === 'option_cap') {
        const records = JSON.parse(
          await readFile(join(target, 'records.json'), 'utf8'),
        );
        expect(records).toMatchObject([
          {
            userMessage: TOKYO_CANDIDATE.userMessage,
            fallbackCalls: 1,
            deferral: { reason: 'pick/option_cap', provider: false },
            jevCalls: [{ outcome: 'option_cap' }],
          },
        ]);
        expect(records[0].error).toBeUndefined();
      }
    }
  });
});

test('stage CI flag writes completed reports before failing runtime errors, without gating failed scores', async () => {
  await offline(async (out) => {
    for (const runtimeFailure of [false, true]) {
      const module = registerStageEval({
        name: 'synthetic',
        stage: 'synthetic',
        variants: {
          one: () => async () => {
            if (runtimeFailure) throw new Error('synthetic runtime failure');
            return ok('candidate');
          },
        },
        makeDeps: () => ({}),
        prepare: async (_scenario, context) => ({
          applicable: true,
          input: 'input',
          origin: context.origin,
        }),
        judge: () => ({
          outcome: 'fail',
          failures: ['informational score'],
          detail: {},
        }),
      });
      const target = join(out, String(runtimeFailure));
      const run = runStageEvalCli(
        [module],
        [
          'bun',
          'stage',
          '--stage=synthetic',
          '--case=swap',
          '--repeats=1',
          '--no-grader',
          '--fail-on-runtime-error',
          '--out',
          target,
        ],
      );
      if (runtimeFailure) await expect(run).rejects.toThrow('runtime failed');
      else await run;
      expect(await readFile(join(target, 'report.md'), 'utf8')).toContain(
        '# Stage eval: synthetic',
      );
    }
  });
});
