import { expect, test } from 'bun:test';
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { unzipSync } from 'fflate';
import { createReactStarter } from './starter-bundle';

const source = resolve(import.meta.dir, '../../starters/react');
const license = resolve(import.meta.dir, '../../../../LICENSE');
const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

test('the starter archive pins compatible SDK dependencies and standalone TypeScript settings', async () => {
  const files = unzipSync(await createReactStarter(source, license));
  const manifest = JSON.parse(text(files['package.json']));
  const tsconfig = JSON.parse(text(files['tsconfig.json']));
  expect(manifest.dependencies['@maelstrom-co/react']).toBe('0.1.1');
  expect(manifest.dependencies['@maelstrom-co/engine']).toBe('0.1.1');
  expect(manifest.overrides.zod).toBe('4.6.6');
  expect(tsconfig.references).toBeUndefined();
  expect(Object.keys(files).some((name) => name.endsWith('.template'))).toBe(
    false,
  );
  expect(text(files.LICENSE)).toContain('MIT License');
  expect(text(files['README.md'])).toContain('bun run start');
});

test('local credentials, installed packages, and build output cannot enter the starter download', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'maelstrom-starter-bundle-'));
  try {
    await cp(source, directory, { recursive: true });
    for (const path of [
      '.env',
      'node_modules/private.txt',
      'dist/private.txt',
    ]) {
      await mkdir(resolve(directory, path, '..'), { recursive: true });
      await writeFile(join(directory, path), 'DO_NOT_DISTRIBUTE');
    }
    const files = unzipSync(await createReactStarter(directory, license));
    expect(
      Object.keys(files).some(
        (name) =>
          name !== '.env.example' && /\.env|node_modules|dist\//.test(name),
      ),
    ).toBe(false);
    expect(
      Object.values(files).some((bytes) =>
        text(bytes).includes('DO_NOT_DISTRIBUTE'),
      ),
    ).toBe(false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
