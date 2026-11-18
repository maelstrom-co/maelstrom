import { beforeAll, expect, test } from 'bun:test';
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { verifyPicomatch } from './audit-dependencies';

const root = join(import.meta.dir, '..');

let copies: string[];
beforeAll(() => {
  copies = verifyPicomatch(root);
}, 60_000);

test('each locked parser preserves simple filename matching without repeating an already unbounded wildcard', () => {
  expect(copies.length).toBeGreaterThan(0);
  for (const directory of copies) {
    const match = createRequire(import.meta.url)(directory);
    for (const options of [{}, { maxExtglobRecursion: false }]) {
      expect(match('+(src*)', options)('src-lib.ts')).toBe(true);
      expect(match('+(src*)', options)('lib.ts')).toBe(false);
      expect(match.makeRe('+(src*)', options).source).not.toContain(')+');
    }
    expect(match('+(src-*|x).ts', { flags: 'u' })('src-main.ts')).toBe(true);
    expect(match('+(src-*lib-*).ts', { flags: 'u' })('src-a-lib-b.ts')).toBe(
      true,
    );
    const rewritten = match
      .parse('+(src-*lib-*)')
      .tokens.find(
        (token: { unboundedOutput?: boolean }) => token.unboundedOutput,
      );
    expect(rewritten?.type).toBe('text');
    expect(match('**/*.{ts,tsx}')('src/components/Chart.tsx')).toBe(true);
    expect(match('**/*.md')('src/components/Chart.tsx')).toBe(false);
  }
});

test('a second, modified copy of an approved version blocks the audit exception', () => {
  const [source] = copies;
  const version = createRequire(import.meta.url)(
    join(source, 'package.json'),
  ).version;
  const temp = mkdtempSync(join(tmpdir(), 'audit-copy-'));
  try {
    const top = join(temp, 'node_modules', 'picomatch');
    const nested = join(
      temp,
      'node_modules',
      'consumer',
      'dist',
      'node_modules',
      'picomatch',
    );
    cpSync(source, top, { recursive: true });
    mkdirSync(join(temp, 'node_modules', 'consumer'), { recursive: true });
    cpSync(source, nested, { recursive: true });
    writeFileSync(
      join(temp, 'bun.lock'),
      JSON.stringify({
        workspaces: { '': {} },
        packages: { picomatch: ['picomatch@' + version] },
      }),
    );
    expect(verifyPicomatch(temp)).toHaveLength(2);
    writeFileSync(join(nested, 'lib', 'parse.js'), '// mismatched parser');
    expect(() => verifyPicomatch(temp)).toThrow('Unverified picomatch');
    rmSync(nested, { recursive: true });
    const scoped = join(
      temp,
      'node_modules',
      '@scope',
      'node_modules',
      'picomatch',
    );
    cpSync(source, scoped, { recursive: true });
    writeFileSync(join(scoped, 'lib', 'parse.js'), '// mismatched scoped copy');
    expect(() => verifyPicomatch(temp)).toThrow('Unverified picomatch');
    rmSync(scoped, { recursive: true });
    const aliasRoot = join(temp, 'node_modules', 'consumer', 'node_modules');
    const alias = join(aliasRoot, 'a-alias');
    mkdirSync(alias, { recursive: true });
    writeFileSync(
      join(alias, 'package.json'),
      '{"name":"consumer","version":"1.0.0"}',
    );
    symlinkSync(alias, join(aliasRoot, 'picomatch'), 'junction');
    expect(() => verifyPicomatch(temp)).toThrow('Unverified picomatch');
    rmSync(aliasRoot, { recursive: true });
    rmSync(top, { recursive: true });
    expect(() => verifyPicomatch(temp)).toThrow('No verified installation');
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});
