import { expect, test } from 'bun:test';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const SRC = join(import.meta.dir, '..');

/** Every module the eval and stage-eval CLIs import, short of the CLIs, which run on import. */
const RUNTIME_MODULES = [
  'eval/arms.ts',
  'eval/grader-validate.ts',
  'eval/replay.ts',
  'eval/report.ts',
  'eval/run.ts',
  'eval/scenarios.ts',
  'eval-stages/layout.ts',
  'eval-stages/recorded-spatial.ts',
  'eval-stages/report.ts',
  'eval-stages/stage-eval.ts',
  'eval-stages/stages.ts',
];

test('the live eval modules leave @tanstack/ai chat untouched outside bun test', () => {
  const imports = RUNTIME_MODULES.map(
    (path) => `await import(${JSON.stringify(join(SRC, path))});`,
  ).join('\n');
  const probe = `
    const before = (await import('@tanstack/ai')).chat;
    ${imports}
    const after = (await import('@tanstack/ai')).chat;
    process.exit(before === after ? 0 : 1);
  `;
  const run = Bun.spawnSync(
    [process.execPath, '--conditions=@maelstrom-co/source', '-e', probe],
    { cwd: join(SRC, '..') },
  );
  expect(run.stderr.toString()).toBe('');
  expect(run.exitCode).toBe(0);
});

test('only test files import values from @maelstrom-co/planner-jev/_testing', async () => {
  const entries = await readdir(SRC, { recursive: true });
  const offenders: string[] = [];
  for (const entry of entries) {
    if (!entry.endsWith('.ts') || entry.endsWith('.test.ts')) continue;
    if (entry.includes('__test-helpers__')) continue;
    const source = await readFile(join(SRC, entry), 'utf8');
    const valueImport =
      /import\s+(?!type\b)[^;]*?from\s+'@maelstrom-co\/planner-jev\/_testing'/s;
    if (valueImport.test(source)) offenders.push(entry);
  }
  expect(offenders).toEqual([]);
});
