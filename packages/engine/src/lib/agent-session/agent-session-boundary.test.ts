import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import ts from 'typescript';

/**
 * The agent session runs on the server, so it must stay free of the browser
 * client, React, and the realtime packages. Those packages are browser or
 * realtime layer code and pulling them in would drag that layer into every
 * server and worker consumer of the engine.
 */

const AGENT_SESSION_DIRECTORY = import.meta.dir;

const FORBIDDEN_PACKAGE =
  /^(?:react|@maelstrom-co\/(?:client|react[^/]*|realtime[^/]*))(?:\/|$)/;

describe('forbidden module matcher', () => {
  test.each([
    ['a static import', "import { a } from '@maelstrom-co/client';"],
    ['a side-effect import', "import 'react';"],
    ['a type-only import', "import type { A } from '@maelstrom-co/react';"],
    ['a re-export', "export { a } from '@maelstrom-co/realtime';"],
    ['a star re-export', "export * from '@maelstrom-co/realtime-protocol';"],
    ['a dynamic import', "const m = await import('react');"],
    ['a client subpath', "import { a } from '@maelstrom-co/client/testing';"],
    ['a react subpath', "import { a } from 'react/jsx-runtime';"],
    ['a react package variant', "import { a } from '@maelstrom-co/react-old';"],
    [
      'a react package variant subpath',
      "import { a } from '@maelstrom-co/react-query/hooks';",
    ],
    [
      'a realtime package variant',
      "import { a } from '@maelstrom-co/realtime-voice';",
    ],
    [
      'a realtime package subpath',
      "import { a } from '@maelstrom-co/realtime/server';",
    ],
  ])('flags %s', (_form, source) => {
    expect(forbiddenModules(source)).toHaveLength(1);
  });

  test.each([
    ['a relative import', "import { a } from './react.js';"],
    ['a lookalike package', "import { a } from 'reactive';"],
    [
      'a hyphenated lookalike package',
      "import { a } from 'react-something-else';",
    ],
    [
      'an unrelated scoped package',
      "import { a } from '@maelstrom-co/engine';",
    ],
    [
      'a lookalike client package',
      "import { a } from '@maelstrom-co/client-tools';",
    ],
    [
      'the specifier inside a comment or string',
      "// import 'react';\nconst text = \"import 'react'\";",
    ],
  ])('ignores %s', (_form, source) => {
    expect(forbiddenModules(source)).toEqual([]);
  });
});

describe('agent session import boundary', () => {
  test('no agent session file imports browser or realtime packages', () => {
    const files = agentSessionSourceFiles(AGENT_SESSION_DIRECTORY);
    expect(files.length).toBeGreaterThan(10);
    expect(
      files.some((file) => file.includes(`${sep}__test-helpers__${sep}`)),
    ).toBe(true);
    const violations = files.flatMap((file) =>
      forbiddenModules(readFileSync(file, 'utf8')).map(
        (specifier) =>
          `${relative(AGENT_SESSION_DIRECTORY, file).split(sep).join('/')} imports ${specifier}`,
      ),
    );
    expect(violations).toEqual([]);
  });
});

function forbiddenModules(source: string): string[] {
  return referencedModules(source).filter((specifier) =>
    FORBIDDEN_PACKAGE.test(specifier),
  );
}

function referencedModules(source: string): string[] {
  const file = ts.createSourceFile(
    'source.ts',
    source,
    ts.ScriptTarget.Latest,
    true,
  );
  const modules: string[] = [];
  const visit = (node: ts.Node): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier !== undefined &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    ) {
      modules.push(node.moduleSpecifier.text);
    } else if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) &&
          node.expression.text === 'require')) &&
      node.arguments[0] !== undefined &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      modules.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return modules;
}

function agentSessionSourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return agentSessionSourceFiles(path);
    return entry.name.endsWith('.ts') ? [path] : [];
  });
}
