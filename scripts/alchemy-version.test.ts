import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  alchemyProjects,
  assertAlchemyVersion,
  assertWorkspaceAlchemyVersion,
} from './alchemy-version.ts';

test('refuses an older PR after the shared store requires beta.85', async () => {
  const root = await mkdtemp('/tmp/alchemy-version-');
  try {
    const directory = join(root, 'infra/platform/node_modules/alchemy');
    await mkdir(directory, { recursive: true });
    await writeFile(
      join(directory, 'package.json'),
      JSON.stringify({ version: '2.0.0-beta.83' }),
    );
    expect(() => assertAlchemyVersion(root, '2.0.0-beta.85')).toThrow(
      'before accessing the shared state store',
    );
    expect(() => assertAlchemyVersion(root, undefined)).not.toThrow();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('requires both the core and the extracted provider to match the store caller version', async () => {
  const root = await mkdtemp('/tmp/alchemy-version-');
  try {
    for (const [name, version] of [
      ['alchemy', '2.0.0-beta.85'],
      ['@alchemy.run/cloudflare', '2.0.0-beta.84'],
    ] as const) {
      const directory = join(root, 'infra/platform/node_modules', name);
      await mkdir(directory, { recursive: true });
      await writeFile(
        join(directory, 'package.json'),
        JSON.stringify({ version }),
      );
    }
    expect(() => assertAlchemyVersion(root, '2.0.0-beta.85')).toThrow(
      '@alchemy.run/cloudflare',
    );
    await writeFile(
      join(
        root,
        'infra/platform/node_modules/@alchemy.run/cloudflare/package.json',
      ),
      JSON.stringify({ version: '2.0.0-beta.85' }),
    );
    expect(() => assertAlchemyVersion(root, '2.0.0-beta.85')).not.toThrow();
    expect(() => assertAlchemyVersion(root, 'latest')).toThrow('exact beta');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('platform beta.85 cannot authorize a separately installed beta.83 app caller', async () => {
  const root = await mkdtemp('/tmp/alchemy-mixed-callers-');
  try {
    for (const [project, version] of [
      ['infra/platform', '2.0.0-beta.85'],
      ['apps/demo', '2.0.0-beta.83'],
    ] as const) {
      const directory = join(root, project, 'node_modules/alchemy');
      await mkdir(directory, { recursive: true });
      await writeFile(
        join(directory, 'package.json'),
        JSON.stringify({ version }),
      );
    }
    const provider = join(
      root,
      'infra/platform/node_modules/@alchemy.run/cloudflare',
    );
    await mkdir(provider, { recursive: true });
    await writeFile(
      join(provider, 'package.json'),
      JSON.stringify({ version: '2.0.0-beta.85' }),
    );
    expect(() => assertAlchemyVersion(root, '2.0.0-beta.85')).not.toThrow();
    expect(() =>
      assertAlchemyVersion(root, '2.0.0-beta.85', 'apps/demo'),
    ).toThrow('before accessing');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

for (const stale of ['infra/platform', 'apps/demo'] as const) {
  test(`refuses mixed imports before a deployment can leave its state lookup broken (${stale})`, async () => {
    const root = await mkdtemp('/tmp/alchemy-cross-project-');
    try {
      for (const project of alchemyProjects) {
        for (const name of ['alchemy', '@alchemy.run/cloudflare']) {
          const directory = join(root, project, 'node_modules', name);
          await mkdir(directory, { recursive: true });
          await writeFile(
            join(directory, 'package.json'),
            JSON.stringify({
              version: project === stale ? '2.0.0-beta.83' : '2.0.0-beta.85',
            }),
          );
        }
      }
      expect(() =>
        assertWorkspaceAlchemyVersion(root, '2.0.0-beta.85'),
      ).toThrow('before accessing');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}
