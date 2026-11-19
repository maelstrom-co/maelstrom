import { describe, expect, test } from 'bun:test';
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve, sep } from 'node:path';

import ts from 'typescript';

/**
 * `chat()` from `@tanstack/ai` drives a whole model loop, so the repository
 * reaches it through explicit boundaries: the Agent Run seam, the two planner
 * LLM call files, and application-owned AG-UI goal loops. Other Engine code
 * talks to `runAgent` in `agent-run.ts`. The
 * Oxlint `eslint/no-restricted-imports` rule enforces this at edit time, and
 * this suite checks both the source tree and every config that defines the
 * rule, because a package config that defines its own rule replaces the root
 * rule instead of merging with it.
 */

const repoRoot = resolve(import.meta.dir, '../../../../..');

const CHAT_ALLOWLIST = [
  'apps/agui-demo/src/server/goal-runtime.ts',
  'apps/agui-workspace-poc/src/host.ts',
  'packages/engine/src/lib/agent-session/agent-run-chat.ts',
  'packages/planner-jev/src/lib/llm-call.ts',
  'packages/planner-llm/src/lib/call-llm.ts',
];

const AGENT_RUN_CHAT = join(
  repoRoot,
  'packages/engine/src/lib/agent-session/agent-run-chat.ts',
);

const TANSTACK_AI = '@tanstack/ai';

const SCANNED_ROOTS = ['packages', 'apps'];

const SOURCE_EXTENSION = /\.(?:[cm]?[jt]s|[jt]sx)$/;

const EXCLUDED_FILE = /\.test\.tsx?$/;

const EXCLUDED_DIRECTORIES = new Set([
  'dist',
  'node_modules',
  '__test-helpers__',
  '__fixtures__',
]);

const OXLINT_BIN = join(repoRoot, 'node_modules/oxlint/bin/oxlint');

describe('chat value import detector', () => {
  test.each([
    ['a named import', "import { chat } from '@tanstack/ai';"],
    ['a renamed import', "import { chat as runChat } from '@tanstack/ai';"],
    [
      'a named import beside inline type specifiers',
      "import {\n  type AnyTextAdapter,\n  chat,\n} from '@tanstack/ai';",
    ],
    [
      'a namespace import then a chat member read',
      "import * as ai from '@tanstack/ai';\nai.chat({ adapter });",
    ],
    [
      'a namespace import then a chat element read',
      "import * as ai from '@tanstack/ai';\nconst run = ai['chat'];",
    ],
    [
      'a namespace import then a chat destructure',
      "import * as ai from '@tanstack/ai';\nconst { chat: run } = ai;",
    ],
    ['a dynamic import', "const ai = await import('@tanstack/ai');"],
    ['a require call', "const ai = require('@tanstack/ai');"],
    ['a named re-export', "export { chat } from '@tanstack/ai';"],
    ['a renamed re-export', "export { chat as runChat } from '@tanstack/ai';"],
    ['a star re-export', "export * from '@tanstack/ai';"],
    ['a namespace re-export', "export * as ai from '@tanstack/ai';"],
  ])('counts %s', (_form, source) => {
    expect(importsChatValue(source)).toBe(true);
  });

  test.each([
    ['a type-only import', "import type { chat } from '@tanstack/ai';"],
    ['an inline type specifier', "import { type chat } from '@tanstack/ai';"],
    ['a type-only re-export', "export type { chat } from '@tanstack/ai';"],
    [
      'a value import of another export',
      "import { toolDefinition } from '@tanstack/ai';",
    ],
    [
      'a re-export of another export',
      "export { toolDefinition } from '@tanstack/ai';",
    ],
    [
      'a namespace import without a chat read',
      "import * as ai from '@tanstack/ai';\nai.toolDefinition({ name });",
    ],
    [
      'a chat import from a subpath',
      "import { chat } from '@tanstack/ai/adapters';",
    ],
    ['a chat import from another module', "import { chat } from './chat.js';"],
    [
      'the specifier inside a comment or string',
      "// import { chat } from '@tanstack/ai';\nconst text = \"import { chat } from '@tanstack/ai'\";",
    ],
  ])('ignores %s', (_form, source) => {
    expect(importsChatValue(source)).toBe(false);
  });
});

describe('chat import source scan', () => {
  test('only the allowlisted files import the chat value', () => {
    const files = scannedSourceFiles();
    expect(files.length).toBeGreaterThan(100);
    const importers = files
      .filter((file) => importsChatValue(readFileSync(file, 'utf8'), file))
      .map((file) => relative(repoRoot, file).split(sep).join('/'))
      .sort();
    expect(importers).toEqual(CHAT_ALLOWLIST);
  });
});

describe('agent run chat seam', () => {
  test('the module reader sees every import form', () => {
    expect(
      referencedModules(
        [
          "import { a } from 'static-import';",
          "import 'side-effect-import';",
          "export { b } from 're-export';",
          "export * from 'star-re-export';",
          "const c = await import('dynamic-import');",
          "const d = require('require-call');",
          "import type { E } from 'type-import';",
        ].join('\n'),
      ),
    ).toEqual([
      'static-import',
      'side-effect-import',
      're-export',
      'star-re-export',
      'dynamic-import',
      'require-call',
      'type-import',
    ]);
  });

  test('the TanStack tool cache middleware stays out of the loop', () => {
    const modules = referencedModules(readFileSync(AGENT_RUN_CHAT, 'utf8'));
    expect(modules).toContain(TANSTACK_AI);
    expect(
      modules.filter(
        (specifier) =>
          specifier === '@tanstack/ai/middlewares' ||
          specifier.startsWith('@tanstack/ai/middlewares/'),
      ),
    ).toEqual([]);
  });
});

describe('chat import lint rule', () => {
  const configs = restrictedImportConfigs();

  test('the root config and the package configs define the rule', () => {
    expect(configs).toContain('.oxlintrc.json');
    expect(configs.length).toBeGreaterThan(1);
  });

  test.each(configs)('%s rejects a chat import from @tanstack/ai', (config) => {
    const scratch = mkdtempSync(join(tmpdir(), 'maelstrom-chat-boundary-'));
    try {
      const fixture = join(scratch, 'imports.ts');
      writeFileSync(
        fixture,
        "import { chat } from '@tanstack/ai';\nexport const runChat = chat;\n",
      );
      const run = runOxlint(config, fixture, ['--format', 'json']);
      expect(run.exitCode).toBe(1);
      const report = JSON.parse(run.stdout.toString()) as {
        diagnostics: { code: string }[];
      };
      expect(
        report.diagnostics.filter((diagnostic) =>
          diagnostic.code.includes('no-restricted-imports'),
        ),
      ).toHaveLength(1);

      writeFileSync(
        fixture,
        "import { toolDefinition } from '@tanstack/ai';\nexport const defineTool = toolDefinition;\n",
      );
      const control = runOxlint(config, fixture);
      expect(control.exitCode).toBe(0);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });
});

function importsChatValue(source: string, fileName = 'source.ts'): boolean {
  const file = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const namespaces = new Set<string>();
  let found = false;

  for (const statement of file.statements) {
    if (
      ts.isImportDeclaration(statement) &&
      isTanstackAi(statement.moduleSpecifier)
    ) {
      const clause = statement.importClause;
      if (clause === undefined || clause.isTypeOnly) continue;
      const bindings = clause.namedBindings;
      if (bindings === undefined) continue;
      if (ts.isNamespaceImport(bindings)) {
        namespaces.add(bindings.name.text);
      } else if (bindings.elements.some(isChatValueSpecifier)) {
        found = true;
      }
    }
    if (
      ts.isExportDeclaration(statement) &&
      statement.moduleSpecifier !== undefined &&
      isTanstackAi(statement.moduleSpecifier) &&
      !statement.isTypeOnly
    ) {
      const clause = statement.exportClause;
      if (
        clause === undefined ||
        ts.isNamespaceExport(clause) ||
        clause.elements.some(isChatValueSpecifier)
      ) {
        found = true;
      }
    }
  }

  const visit = (node: ts.Node): void => {
    if (found) return;
    if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) &&
          node.expression.text === 'require')) &&
      node.arguments[0] !== undefined &&
      isTanstackAi(node.arguments[0])
    ) {
      found = true;
      return;
    }
    if (namespaces.size > 0 && readsChatFromNamespace(node, namespaces)) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

function readsChatFromNamespace(
  node: ts.Node,
  namespaces: ReadonlySet<string>,
): boolean {
  const isNamespace = (expression: ts.Expression) =>
    ts.isIdentifier(expression) && namespaces.has(expression.text);
  if (ts.isPropertyAccessExpression(node)) {
    return isNamespace(node.expression) && node.name.text === 'chat';
  }
  if (ts.isElementAccessExpression(node)) {
    return (
      isNamespace(node.expression) &&
      ts.isStringLiteralLike(node.argumentExpression) &&
      node.argumentExpression.text === 'chat'
    );
  }
  if (
    ts.isVariableDeclaration(node) &&
    node.initializer !== undefined &&
    isNamespace(node.initializer) &&
    ts.isObjectBindingPattern(node.name)
  ) {
    return node.name.elements.some((element) => {
      const key = element.propertyName ?? element.name;
      return ts.isIdentifier(key) && key.text === 'chat';
    });
  }
  return false;
}

function isChatValueSpecifier(
  specifier: ts.ImportSpecifier | ts.ExportSpecifier,
): boolean {
  const imported = specifier.propertyName ?? specifier.name;
  return (
    !specifier.isTypeOnly &&
    ts.isIdentifier(imported) &&
    imported.text === 'chat'
  );
}

function isTanstackAi(node: ts.Node): boolean {
  return ts.isStringLiteralLike(node) && node.text === TANSTACK_AI;
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

function scannedSourceFiles(): string[] {
  const files: string[] = [];
  for (const root of SCANNED_ROOTS) {
    for (const project of readdirSync(join(repoRoot, root), {
      withFileTypes: true,
    })) {
      if (!project.isDirectory()) continue;
      collectSourceFiles(join(repoRoot, root, project.name, 'src'), files);
    }
  }
  return files;
}

function collectSourceFiles(directory: string, files: string[]): void {
  let entries;
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!EXCLUDED_DIRECTORIES.has(entry.name))
        collectSourceFiles(path, files);
    } else if (
      SOURCE_EXTENSION.test(entry.name) &&
      !EXCLUDED_FILE.test(entry.name)
    ) {
      files.push(path);
    }
  }
}

function restrictedImportConfigs(): string[] {
  const candidates = [
    '.oxlintrc.json',
    ...readdirSync(join(repoRoot, 'packages'), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => `packages/${entry.name}/.oxlintrc.json`),
  ];
  return candidates
    .filter((config) => existsSync(join(repoRoot, config)))
    .filter((config) => {
      const parsed = JSON.parse(
        readFileSync(join(repoRoot, config), 'utf8'),
      ) as { rules?: Record<string, unknown> };
      return parsed.rules?.['eslint/no-restricted-imports'] !== undefined;
    });
}

function runOxlint(
  config: string,
  fixture: string,
  extraArguments: readonly string[] = [],
) {
  return Bun.spawnSync(
    [
      process.execPath,
      OXLINT_BIN,
      '--config',
      join(repoRoot, config),
      ...extraArguments,
      fixture,
    ],
    { cwd: repoRoot },
  );
}
