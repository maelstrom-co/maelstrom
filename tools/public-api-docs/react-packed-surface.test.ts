import { afterEach, expect, test } from 'bun:test';
import {
  access,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { installPackedConsumer, type PackageAuditInput } from './audit';

const repositoryRoot = join(import.meta.dir, '../..');
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true })),
  );
});

function run(command: string[], cwd: string) {
  return Bun.spawnSync(command, { cwd, stderr: 'pipe', stdout: 'pipe' });
}

function expectSuccess(result: ReturnType<typeof Bun.spawnSync>): void {
  expect(
    result.exitCode,
    `${result.stdout.toString()}\n${result.stderr.toString()}`,
  ).toBe(0);
}

async function packPackage(
  name: string,
  directory: string,
  root: string,
): Promise<PackageAuditInput> {
  const destination = join(root, name.replaceAll('/', '-'));
  await mkdir(destination, { recursive: true });
  expectSuccess(
    run(
      [
        process.execPath,
        'pm',
        'pack',
        '--ignore-scripts',
        '--destination',
        destination,
      ],
      directory,
    ),
  );
  const tarballs = (await readdir(destination)).filter((file) =>
    file.endsWith('.tgz'),
  );
  expect(tarballs).toHaveLength(1);
  return { name, tarball: join(destination, tarballs[0]) };
}

test('the current packed React package keeps warning utilities behind _testing', async () => {
  const root = await mkdtemp(join(tmpdir(), 'react-packed-surface-'));
  temporaryRoots.push(root);

  expectSuccess(
    run(
      [
        join(repositoryRoot, 'node_modules/.bin/nx'),
        'build',
        '@maelstrom-co/react',
      ],
      repositoryRoot,
    ),
  );

  const packages = await Promise.all([
    packPackage(
      '@maelstrom-co/protocol',
      join(repositoryRoot, 'packages/protocol'),
      root,
    ),
    packPackage(
      '@maelstrom-co/client',
      join(repositoryRoot, 'packages/client'),
      root,
    ),
    packPackage(
      '@maelstrom-co/react',
      join(repositoryRoot, 'packages/react'),
      root,
    ),
  ]);
  const consumerRoot = join(root, 'consumer');
  expect((await installPackedConsumer(packages, consumerRoot)).errors).toEqual(
    [],
  );

  const installedReact = join(consumerRoot, 'node_modules/@maelstrom-co/react');
  const manifest = JSON.parse(
    await readFile(join(installedReact, 'package.json'), 'utf8'),
  ) as { exports: Record<string, unknown> };
  expect(Object.keys(manifest.exports)).not.toContain('./dist/lib/warn-once');

  const rootDeclaration = await readFile(
    join(installedReact, 'dist/index.d.ts'),
    'utf8',
  );
  const testingDeclaration = await readFile(
    join(installedReact, 'dist/_testing.d.ts'),
    'utf8',
  );
  expect(rootDeclaration).not.toContain('warnOnce');
  expect(rootDeclaration).not.toContain('resetWarnings');
  expect(testingDeclaration).toContain('resetWarnings');
  expect(testingDeclaration).not.toContain('warnOnce');

  await access(join(installedReact, 'dist/lib/warn-once.d.ts'));

  await writeFile(
    join(consumerRoot, 'surface.mjs'),
    `const root = await import('@maelstrom-co/react');\nconst testing = await import('@maelstrom-co/react/_testing');\nconsole.log(JSON.stringify({ rootWarnOnce: 'warnOnce' in root, rootResetWarnings: 'resetWarnings' in root, testingKeys: Object.keys(testing) }));\n`,
  );
  const runtimeSurface = run(
    [process.execPath, 'run', 'surface.mjs'],
    consumerRoot,
  );
  expectSuccess(runtimeSurface);
  expect(JSON.parse(runtimeSurface.stdout.toString())).toEqual({
    rootWarnOnce: false,
    rootResetWarnings: false,
    testingKeys: ['resetWarnings'],
  });

  const deepSpecifier = '@maelstrom-co/react/dist/lib/warn-once';
  const node = Bun.which('node');
  expect(node).not.toBeNull();
  const runtimeDeepImport = run(
    [
      node!,
      '--input-type=module',
      '--eval',
      `await import('${deepSpecifier}')`,
    ],
    consumerRoot,
  );
  expect(runtimeDeepImport.exitCode).not.toBe(0);
  expect(runtimeDeepImport.stderr.toString()).toContain(
    'ERR_PACKAGE_PATH_NOT_EXPORTED',
  );

  await writeFile(
    join(consumerRoot, 'deep-import.ts'),
    `import { warnOnce } from '${deepSpecifier}';\nvoid warnOnce;\n`,
  );
  await writeFile(
    join(consumerRoot, 'deep-import-tsconfig.json'),
    `${JSON.stringify(
      {
        compilerOptions: {
          module: 'ESNext',
          moduleResolution: 'Bundler',
          noEmit: true,
          strict: true,
          target: 'ES2022',
        },
        files: ['deep-import.ts'],
      },
      null,
      2,
    )}\n`,
  );
  const typeDeepImport = run(
    [
      join(repositoryRoot, 'node_modules/.bin/tsc'),
      '-p',
      'deep-import-tsconfig.json',
    ],
    consumerRoot,
  );
  expect(typeDeepImport.exitCode).not.toBe(0);
  const typeOutput = `${typeDeepImport.stdout.toString()}\n${typeDeepImport.stderr.toString()}`;
  expect(typeOutput).toContain('TS2307');
  expect(typeOutput).toContain(deepSpecifier);
});
