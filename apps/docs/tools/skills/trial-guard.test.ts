import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import guard from './trial-guard';

test('plan-only tools cannot mutate and alternate path syntax cannot bypass consumer boundaries', async () => {
  const root = await mkdtemp(join(tmpdir(), 'skill-guard-'));
  type Handler = Parameters<Parameters<typeof guard>[0]['on']>[1];
  let handler: Handler | undefined;
  guard({
    on(_event, registered) {
      handler = registered;
    },
  });
  if (!handler) throw new Error('Guard did not register its tool-call handler');
  const decide = (toolName: string, path: string) =>
    handler?.({ toolName, input: { path } }, { cwd: root });
  try {
    await writeFile(join(root, 'app.ts'), 'export const state = 1;');
    expect(decide('read', 'app.ts')).toBeUndefined();
    for (const tool of ['edit', 'write', 'bash', 'powershell'])
      expect(decide(tool, 'app.ts')?.block).toBe(true);
    for (const path of [
      '@/etc/hosts',
      'file:///etc/hosts',
      '../outside.ts',
      '~/private.ts',
    ])
      expect(decide('read', path)?.block).toBe(true);
    await symlink('/outside/nonexistent', join(root, 'dangling'));
    expect(decide('read', 'dangling')?.block).toBe(true);
    await mkdir(join(root, 'nested'));
    await symlink('/etc/hosts', join(root, 'nested/outside'));
    for (const tool of ['grep', 'find', 'ls'])
      expect(decide(tool, 'nested')?.block).toBe(true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
