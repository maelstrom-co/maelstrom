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
    const [stderr, exitCode] = await Promise.all([
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    let status: unknown;
    try {
      status = JSON.parse(await readFile(join(out, 'status.json'), 'utf8'));
    } catch {
      status = undefined;
    }
    return { stderr, exitCode, status };
  } finally {
    await rm(out, { recursive: true, force: true });
  }
}

describe('the eval command line with the Decisions plugin', () => {
  test('names the Decisions arms on an unknown --arm', async () => {
    const { stderr, exitCode } = await cli('src/eval/cli.ts', [
      '--arm',
      'nope',
    ]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain(
      'jev-ungated-per-instance-preset-or-llm-inline, decisions-poc, decisions-composed-pairs',
    );
  }, 30_000);

  test('a Decisions arm needs only the OpenAI key', async () => {
    const { exitCode, status } = await cli('src/eval/cli.ts', [
      '--arm',
      'decisions-poc',
    ]);
    expect(exitCode).toBe(2);
    expect(status).toEqual({ status: 'skipped', missing: ['OPENAI_API_KEY'] });
  }, 30_000);

  test('--grader on a Decisions arm also needs the TypeSafe judge keys', async () => {
    const { exitCode, status } = await cli('src/eval/cli.ts', [
      '--arm',
      'decisions-poc',
      '--grader',
    ]);
    expect(exitCode).toBe(2);
    expect(status).toEqual({
      status: 'skipped',
      missing: ['OPENAI_API_KEY', 'TYPESAFE_API_KEY', 'JEV_MODEL'],
    });
  }, 30_000);
});

describe('the stage eval command line with the Decisions modules', () => {
  test('names the Decisions modules on an unknown --stage', async () => {
    const { stderr, exitCode } = await cli('src/eval-stages/cli.ts', [
      '--stage',
      'nope',
    ]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain(
      '--stage must be one of select, actions, layout, decisions-select, decisions-actions, decisions-layout',
    );
  }, 30_000);

  test('decisions-select needs only the OpenAI key', async () => {
    const { stderr, exitCode } = await cli('src/eval-stages/cli.ts', [
      '--stage',
      'decisions-select',
    ]);
    expect(exitCode).toBe(2);
    expect(stderr).toContain('stage eval skipped: missing OPENAI_API_KEY\n');
  }, 30_000);
});
