import { expect, test } from 'bun:test';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const SRC = join(import.meta.dir, '..');

/** What the entry points in this folder import; the entry points themselves run on import. */
const RUNTIME_MODULES = [
  'core/cli.ts',
  'core/grader-validate.ts',
  'core/report-cli.ts',
  'core/stage-cli.ts',
  'plugins/index.ts',
  'plugins/jev/plugin.ts',
  'plugins/llm/plugin.ts',
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
