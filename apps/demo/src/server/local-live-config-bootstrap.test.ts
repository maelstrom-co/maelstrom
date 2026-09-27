import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfigFromFile } from 'vite';
import { expect, it } from 'vitest';

const appRoot = fileURLToPath(new URL('../../', import.meta.url));
const workspaceRoot = resolve(appRoot, '../..');

it.each([
  { enabled: false, hosted: false },
  { enabled: true, hosted: false },
  { enabled: true, hosted: true },
])('loads build configuration before workspace output exists: %j', async (mode) => {
  const fixture = await mkdtemp(join(tmpdir(), 'maelstrom-config-bootstrap-'));
  try {
    await mkdir(join(fixture, 'src/server'), { recursive: true });
    for (const path of [
      'local-live-dev-plugin.ts',
      'src/server/local-live-access.ts',
      'src/server/live-session.ts',
    ]) {
      await copyFile(join(appRoot, path), join(fixture, path));
    }
    for (const name of ['realtime-openai-live-server', 'realtime-protocol']) {
      const directory = join(fixture, 'node_modules/@maelstrom-co', name);
      await mkdir(directory, { recursive: true });
      await writeFile(
        join(directory, 'package.json'),
        await readFile(join(workspaceRoot, 'packages', name, 'package.json')),
      );
    }
    await writeFile(join(fixture, 'package.json'), '{"type":"module"}');
    await writeFile(
      join(fixture, 'vite.config.mjs'),
      `
      import { localLiveDevPlugin } from './local-live-dev-plugin.ts';
      export default { plugins: [localLiveDevPlugin(${JSON.stringify({ ...mode, password: 'fixture-password-not-a-provider-key', apiKey: '' })})] };
    `,
    );
    const result = await loadConfigFromFile(
      { command: 'build', mode: 'production' },
      join(fixture, 'vite.config.mjs'),
      fixture,
      'silent',
    );
    expect(result?.config.plugins).toEqual([
      expect.objectContaining({ name: 'maelstrom-local-live' }),
    ]);
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});
