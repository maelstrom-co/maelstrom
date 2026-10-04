import { afterAll, beforeAll, expect, test } from 'bun:test';
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCommand } from '../index';

let candidate: string;
const fixtures = resolve(import.meta.dir, '../../acceptance/fixtures');

beforeAll(async () => {
  candidate = await mkdtemp(join(tmpdir(), 'evaluation-browser-test-'));
  await cp(join(fixtures, 'onboarding-react'), candidate, { recursive: true });
  await cp(
    join(fixtures, 'migration-react/src/testConnector.ts'),
    join(candidate, 'src/testConnector.ts'),
  );
  await writeFile(join(candidate, 'package.json'), '{"type":"module"}\n');
  for (const name of [
    '@maelstrom-co/client',
    '@maelstrom-co/react',
    '@maelstrom-co/protocol',
    '@maelstrom-co/connectors',
    '@vitejs/plugin-react',
    'react',
    'react-dom',
    'vite',
  ]) {
    const target = join(candidate, 'node_modules', name);
    await mkdir(dirname(target), { recursive: true });
    await symlink(
      dirname(fileURLToPath(import.meta.resolve(`${name}/package.json`))),
      target,
      'dir',
    );
  }
  const workspaceRoot = resolve(import.meta.dir, '../../../../..');
  await writeFile(
    join(candidate, 'vite.config.ts'),
    `import react from '@vitejs/plugin-react';
export default {
  plugins: [react()],
  server: { fs: { allow: ${JSON.stringify([candidate, workspaceRoot])} } },
};\n`,
  );
});

afterAll(async () => {
  if (candidate) await rm(candidate, { recursive: true, force: true });
});

for (const fixture of [
  'onboarding-good',
  'onboarding-renamed-ids',
  'onboarding-hidden-ticket-rows',
]) {
  test(`browser grader observes the app SDK and checks visible rows: ${fixture}`, async () => {
    const source = await readFile(
      resolve(
        import.meta.dir,
        '../fixtures/calibration',
        fixture,
        'src/App.tsx',
      ),
      'utf8',
    );
    await writeFile(join(candidate, 'src/App.tsx'), source);
    const result = await runCommand({
      command: {
        executable: process.execPath,
        args: [
          join(import.meta.dir, 'browser-case.mjs'),
          candidate,
          'onboarding-implementation',
        ],
      },
      input: '',
      cwd: candidate,
      timeoutMs: 25_000,
    });
    if (fixture === 'onboarding-hidden-ticket-rows') {
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('ticket row 1 is not visibly rendered');
    } else {
      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({
        visibleVessel: true,
        ticketRowsValidated: 2,
        appAssertions: 'passed',
      });
    }
    expect(await readFile(join(candidate, 'src/App.tsx'), 'utf8')).toBe(source);
    await expect(
      stat(join(candidate, 'src/evaluation-observer.ts')),
    ).rejects.toThrow();
  }, 30_000);
}
