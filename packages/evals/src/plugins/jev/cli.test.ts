import { describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const PACKAGE_ROOT = resolve(import.meta.dir, '../../..');

/** Runs one of the package's entry points with no provider key in the environment. */
async function cli(entry: string, args: readonly string[]) {
  const out = await mkdtemp(join(tmpdir(), 'evals-cli-'));
  try {
    const proc = Bun.spawn(
      [
        'bun',
        '--conditions=@maelstrom-co/source',
        entry,
        ...args,
        '--out',
        out,
      ],
      {
        cwd: PACKAGE_ROOT,
        env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '' },
        stdout: 'pipe',
        stderr: 'pipe',
      },
    );
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    let status: unknown;
    try {
      status = JSON.parse(await readFile(join(out, 'status.json'), 'utf8'));
    } catch {
      status = undefined;
    }
    return { stdout, stderr, exitCode, status };
  } finally {
    await rm(out, { recursive: true, force: true });
  }
}

describe('the eval command line over both plugins', () => {
  test('names every arm of both plugins on an unknown --arm', async () => {
    const { stderr, exitCode } = await cli('src/eval/cli.ts', [
      '--arm',
      'nope',
    ]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain(
      '--arm: unknown arm nope; known arms: baseline, jev-poc (alias jev), jev-ungated-stepwise-preset-inline, jev-ungated-batched-preset-inline, jev-ungated-per-instance-preset-inline, jev-gated-stepwise-preset-inline, jev-gated-batched-preset-inline, jev-gated-per-instance-preset-inline, jev-gated-per-instance-preset-or-llm-inline, jev-gated-per-instance-preset-or-llm-parallel, jev-gated-per-instance-composed-pairs-gate-and-defer-inline, jev-ungated-per-instance-preset-or-llm-inline',
    );
  }, 30_000);

  test('the baseline needs only the OpenAI key', async () => {
    const { stderr, exitCode, status } = await cli('src/eval/cli.ts', [
      '--arm',
      'baseline',
    ]);
    expect(exitCode).toBe(2);
    expect(stderr).toContain('planner eval skipped: missing OPENAI_API_KEY.');
    expect(status).toEqual({ status: 'skipped', missing: ['OPENAI_API_KEY'] });
  }, 30_000);

  test('a Jev arm needs the OpenAI and TypeSafe keys, and --grader the judge keys', async () => {
    const jev = await cli('src/eval/cli.ts', ['--arm', 'jev-poc']);
    expect(jev.exitCode).toBe(2);
    expect(jev.status).toEqual({
      status: 'skipped',
      missing: ['OPENAI_API_KEY', 'TYPESAFE_API_KEY', 'JEV_MODEL'],
    });
    const graded = await cli('src/eval/cli.ts', [
      '--arm',
      'baseline',
      '--grader',
    ]);
    expect(graded.status).toEqual({
      status: 'skipped',
      missing: ['OPENAI_API_KEY', 'TYPESAFE_API_KEY', 'JEV_MODEL'],
    });
  }, 30_000);
});

describe('the stage eval command line over the Jev modules', () => {
  test('names the stage modules on an unknown --stage', async () => {
    const { stderr, exitCode } = await cli('src/eval-stages/cli.ts', [
      '--stage',
      'nope',
    ]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain('--stage must be one of select, actions, layout');
  }, 30_000);

  test('the actions stage needs the TypeSafe keys', async () => {
    const skipped = await cli('src/eval-stages/cli.ts', ['--stage', 'actions']);
    expect(skipped.exitCode).toBe(2);
    expect(skipped.stderr).toContain(
      'stage eval skipped: missing TYPESAFE_API_KEY, JEV_MODEL',
    );
  }, 30_000);

  test('the layout stage needs the TypeSafe keys and validates its own flags', async () => {
    const skipped = await cli('src/eval-stages/cli.ts', ['--stage', 'layout']);
    expect(skipped.exitCode).toBe(2);
    expect(skipped.stderr).toContain(
      'stage eval skipped: missing TYPESAFE_API_KEY, JEV_MODEL',
    );
    const flagged = await cli('src/eval-stages/cli.ts', [
      '--stage',
      'layout',
      '--spatial-signal',
      'live',
    ]);
    expect(flagged.exitCode).toBe(1);
    expect(flagged.stderr).toContain(
      '--spatial-signal must be one of gold, recorded-live',
    );
  }, 30_000);
});
