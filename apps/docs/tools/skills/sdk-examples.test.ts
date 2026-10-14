import { expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import ts from 'typescript';

const root = resolve(import.meta.dir, '../../../..');

test('shipped SDK recipes and voice README examples compile against published declarations', async () => {
  const paths: Record<string, string[]> = {};
  const examples = new Map<string, string>();
  const packages = await readdir(join(root, 'packages'), {
    withFileTypes: true,
  });
  let guideCount = 0;
  for (const entry of packages.filter((entry) => entry.isDirectory())) {
    const packageRoot = join(root, 'packages', entry.name);
    if (!existsSync(join(packageRoot, 'package.json'))) continue;
    const manifest = JSON.parse(
      await readFile(join(packageRoot, 'package.json'), 'utf8'),
    );
    for (const [subpath, exported] of Object.entries(manifest.exports ?? {})) {
      if (
        typeof exported === 'object' &&
        exported !== null &&
        'types' in exported &&
        typeof exported.types === 'string'
      ) {
        paths[manifest.name + (subpath === '.' ? '' : subpath.slice(1))] = [
          join(packageRoot, exported.types),
        ];
      }
    }
    if (!manifest.files?.includes('skills')) continue;
    guideCount++;
    const guideRoot = join(
      packageRoot,
      'skills',
      `maelstrom-${entry.name}-sdk`,
    );
    const skill = await readFile(join(guideRoot, 'SKILL.md'), 'utf8');
    expect(skill).toContain('(references/common-tasks.md)');
    const recipes = await readFile(
      join(guideRoot, 'references/common-tasks.md'),
      'utf8',
    );
    expect(recipes).toContain('## Verify');
    expect(recipes).toContain('## Troubleshoot');
    const blocks = [...recipes.matchAll(/```(?:ts|tsx)\n([\s\S]*?)\n```/g)];
    expect(blocks.length).toBeGreaterThan(0);
    for (const [index, match] of blocks.entries()) {
      examples.set(
        join(
          root,
          'apps/docs',
          '__sdk_examples__',
          `${entry.name}-${index}.tsx`,
        ),
        match[1],
      );
    }
    for (const source of [skill, recipes]) {
      const from =
        source === skill
          ? join(guideRoot, 'SKILL.md')
          : join(guideRoot, 'references/common-tasks.md');
      for (const match of source.matchAll(/\]\(([^)]+)\)/g)) {
        if (/^(?:https?:|#)/.test(match[1])) continue;
        const destination = resolve(dirname(from), match[1].split('#')[0]);
        expect(destination.startsWith(`${guideRoot}${sep}`)).toBe(true);
        expect(await readFile(destination, 'utf8')).not.toBe('');
      }
    }
  }
  expect(guideCount).toBe(16);
  const liveGuide = await readFile(
    join(
      root,
      'apps/docs/src/content/docs/guides/voice/live-opening-recovery.mdx',
    ),
    'utf8',
  );
  for (const name of [
    'realtime',
    'react-realtime',
    'realtime-openai-live',
    'realtime-openai-live-server',
  ]) {
    const readme = await readFile(
      join(root, 'packages', name, 'README.md'),
      'utf8',
    );
    const blocks = [...readme.matchAll(/```(?:ts|tsx)\n([\s\S]*?)\n```/g)];
    expect(blocks.length).toBeGreaterThan(0);
    for (const [index, match] of blocks.entries()) {
      if (name.startsWith('realtime-openai-live'))
        expect(liveGuide).toContain(match[1]);
      examples.set(
        join(
          root,
          'apps/docs',
          '__sdk_examples__',
          `${name}-readme-${index}.tsx`,
        ),
        (name === 'realtime'
          ? "declare const session: import('@maelstrom-co/realtime').RealtimeSession;\ndeclare const telemetry: import('@maelstrom-co/telemetry').Telemetry;\n"
          : '') + match[1],
      );
    }
  }
  const options: ts.CompilerOptions = {
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    jsx: ts.JsxEmit.ReactJSX,
    baseUrl: root,
    paths,
  };
  const host = ts.createCompilerHost(options);
  const sourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (name, languageVersion, ...rest) =>
    examples.has(name)
      ? ts.createSourceFile(
          name,
          examples.get(name) ?? '',
          languageVersion,
          true,
          ts.ScriptKind.TSX,
        )
      : sourceFile(name, languageVersion, ...rest);
  const exists = host.fileExists.bind(host);
  host.fileExists = (name) => examples.has(name) || exists(name);
  const program = ts.createProgram([...examples.keys()], options, host);
  const errors = ts
    .getPreEmitDiagnostics(program)
    .filter(
      (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,
    );
  expect(
    ts.formatDiagnosticsWithColorAndContext(errors, {
      getCurrentDirectory: () => root,
      getCanonicalFileName: (name) => name,
      getNewLine: () => '\n',
    }),
  ).toBe('');
});
