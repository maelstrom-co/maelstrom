import { afterEach, describe, expect, it, mock, spyOn } from 'bun:test';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  assertRegistryMetadata,
  collectRegistryMetadataProblems,
} from './assert-registry-metadata.ts';

const tempDirs: string[] = [];

afterEach(() => {
  mock.restore();
  for (const dir of tempDirs.splice(0))
    rmSync(dir, { force: true, recursive: true });
});

function workspace(manifest: Record<string, unknown>): string {
  const cwd = mkdtempSync(join(tmpdir(), 'registry-metadata-'));
  tempDirs.push(cwd);
  mkdirSync(join(cwd, 'packages/example'), { recursive: true });
  writeFileSync(
    join(cwd, 'package.json'),
    JSON.stringify({ workspaces: ['packages/*'] }),
  );
  writeFileSync(
    join(cwd, 'packages/example/package.json'),
    JSON.stringify(manifest),
  );
  cpSync('LICENSE', join(cwd, 'packages/example/LICENSE'));
  writeFileSync(join(cwd, 'packages/example/README.md'), '# Example');
  return cwd;
}

function validManifest() {
  return {
    name: '@maelstrom-co/example',
    version: '1.0.0',
    description: 'Example package',
    keywords: ['one', 'two', 'three'],
    license: 'MIT',
    homepage: 'https://maelstrom-ai.co',
    bugs: { url: 'https://github.com/maelstrom-co/maelstrom/issues' },
    repository: {
      url: 'https://github.com/maelstrom-co/maelstrom.git',
      directory: 'packages/example',
    },
    publishConfig: { access: 'public', registry: 'https://registry.npmjs.org' },
  };
}

describe('registry metadata preflight', () => {
  it('keeps every publishable workspace package ready for release', () => {
    expect(
      collectRegistryMetadataProblems(join(import.meta.dir, '..')),
    ).toEqual([]);
  });

  it('rejects private GitHub metadata before a release can target the wrong registry', () => {
    const cwd = workspace({
      ...validManifest(),
      repository: {
        url: 'git+https://github.com/maelstrom-co/maelstrom.git',
        directory: 'packages/example',
      },
      publishConfig: {
        access: 'restricted',
        registry: 'https://npm.pkg.github.com',
      },
    });

    const messages = collectRegistryMetadataProblems(cwd).map(
      ({ message }) => message,
    );
    spyOn(console, 'error').mockImplementation(() => {});
    expect(messages).toContain(
      '@maelstrom-co/example publishConfig.registry must be "https://registry.npmjs.org"',
    );
    expect(messages).toContain(
      '@maelstrom-co/example publishConfig.access must be "public"',
    );
    expect(() => assertRegistryMetadata(cwd)).toThrow(
      'Registry metadata validation failed.',
    );
  });

  it('accepts public npm metadata for unauthenticated consumers', () => {
    const log = spyOn(console, 'log').mockImplementation(() => {});
    expect(collectRegistryMetadataProblems(workspace(validManifest()))).toEqual(
      [],
    );
    expect(log).not.toHaveBeenCalled();
  });

  it('rejects additional npm request options before packing beside a publishing identity', () => {
    const manifest = validManifest();
    const cwd = workspace({
      ...manifest,
      publishConfig: { ...manifest.publishConfig, 'strict-ssl': false },
    });
    expect(collectRegistryMetadataProblems(cwd)).toContainEqual({
      file: 'packages/example/package.json',
      message:
        '@maelstrom-co/example publishConfig must contain only registry and access',
    });
  });

  it('requires explicit public access so a scoped package cannot default to restricted', () => {
    const manifest = validManifest();
    const cwd = workspace({
      ...manifest,
      publishConfig: { registry: manifest.publishConfig.registry },
    });
    expect(collectRegistryMetadataProblems(cwd)).toContainEqual({
      file: 'packages/example/package.json',
      message: '@maelstrom-co/example publishConfig.access must be "public"',
    });
  });
});
