import { expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

function dependencies(entry: string, seen = new Set<string>()): Set<string> {
  const file = resolve(import.meta.dirname, entry);
  if (seen.has(file)) return new Set();
  seen.add(file);
  const imports = new Set<string>();
  for (const match of readFileSync(file, 'utf8').matchAll(
    /from\s+['"]([^'"]+)['"]/g,
  )) {
    const specifier = match[1];
    if (specifier.startsWith('.')) {
      for (const dependency of dependencies(
        resolve(dirname(file), specifier.replace(/\.js$/, '.ts')),
        seen,
      ))
        imports.add(dependency);
    } else imports.add(specifier);
  }
  return imports;
}

it('keeps server dependencies out of the browser and client dependencies out of the server', () => {
  expect([...dependencies('browser.ts')].sort()).toEqual([
    '@ag-ui/core/schemas',
    '@maelstrom-co/agui-protocol',
    '@maelstrom-co/client',
    '@maelstrom-co/protocol',
  ]);
  expect([...dependencies('../../agui-server/src/server.ts')].sort()).toEqual([
    '@maelstrom-co/agui-protocol',
    '@maelstrom-co/engine',
  ]);
  expect(
    [...dependencies('../../agui-protocol/src/contract.ts')].sort(),
  ).toEqual(['@ag-ui/core/schemas', '@maelstrom-co/protocol', 'zod']);
});
