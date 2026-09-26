#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  cp,
  mkdir,
  readdir,
  readFile,
  realpath,
  rename,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const sdkPackages = ['protocol', 'connectors', 'client', 'react'];
const sdkVersion = '0.1.0-alpha.4';

function run(executable, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(executable, args, {
      cwd: options.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk) => (stdout += chunk));
    child.stderr.setEncoding('utf8').on('data', (chunk) => (stderr += chunk));
    child.once('error', reject);
    child.once('close', (code, signal) => {
      if (code !== 0) {
        reject(
          new Error(
            `${executable} ${args.join(' ')} failed (${signal ?? code})\n${stderr}${stdout}`,
          ),
        );
      } else resolvePromise(stdout.trim());
    });
  });
}

async function packSdk(root, trialRoot, packageName) {
  const packageDir = join(trialRoot, `package-${packageName}`);
  const vendor = join(trialRoot, 'vendor');
  await mkdir(packageDir, { recursive: true });
  await mkdir(vendor, { recursive: true });
  const packedName = await run('npm', [
    'pack',
    join(root, 'packages', packageName),
    '--pack-destination',
    trialRoot,
    '--silent',
  ]);
  await run('tar', [
    '-xzf',
    join(trialRoot, packedName),
    '-C',
    packageDir,
    '--strip-components=1',
  ]);
  const manifestPath = join(packageDir, 'package.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const catalogVersions = {
    react: { '@tanstack/react-store': '0.9.3' },
    client: { '@tanstack/store': '0.9.3' },
    protocol: { nanoid: '5.1.16', zod: '4.4.3' },
    connectors: {},
  };
  for (const [dependency, version] of Object.entries(
    catalogVersions[packageName],
  )) {
    if (manifest.dependencies?.[dependency] !== 'catalog:') {
      throw new Error(
        `Unexpected catalog dependency: ${packageName}:${dependency}`,
      );
    }
    manifest.dependencies[dependency] = version;
  }
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  const archive = await run(
    'npm',
    ['pack', '--pack-destination', vendor, '--silent'],
    { cwd: packageDir },
  );
  return join(vendor, archive);
}

export async function prepareFixtures(root, trialRoot) {
  const fixtures = join(root, 'apps/docs/prompts/acceptance/fixtures');
  for (const name of [
    'onboarding',
    'migration-inventory',
    'migration-conversion',
    'modeling/src',
    'debugging',
  ]) {
    await mkdir(join(trialRoot, name), { recursive: true });
  }

  const onboarding = join(trialRoot, 'onboarding');
  await cp(join(fixtures, 'onboarding-react'), onboarding, { recursive: true });
  await rename(
    join(onboarding, 'package.json.fixture'),
    join(onboarding, 'package.json'),
  );
  await rename(
    join(onboarding, 'project.json.fixture'),
    join(onboarding, 'project.json'),
  );
  const migrationSource = join(fixtures, 'migration-react');
  for (const project of ['migration-inventory', 'migration-conversion']) {
    const target = join(trialRoot, project);
    await cp(migrationSource, target, { recursive: true });
    await rename(
      join(target, 'package.json.fixture'),
      join(target, 'package.json'),
    );
  }
  for (const [source, target] of [
    ['modeling-react/src/Queue.tsx', 'modeling/src/Queue.tsx'],
    ['debugging-react/report.md', 'debugging/report.md'],
  ]) {
    await cp(join(fixtures, source), join(trialRoot, target));
  }

  const shared = join(migrationSource, '.trial');
  await cp(shared, join(onboarding, '.trial'), { recursive: true });
  await cp(
    join(migrationSource, 'src/testConnector.ts'),
    join(onboarding, 'src/testConnector.ts'),
  );

  const migration = join(trialRoot, 'migration-inventory');
  const conversion = join(trialRoot, 'migration-conversion');
  const equalFiles = [migration, conversion].map(async (project) =>
    (await treeFiles(project))
      .map((file) => file.slice(project.length + 1))
      .sort(),
  );
  const [inventoryFiles, conversionFiles] = await Promise.all(equalFiles);
  if (JSON.stringify(inventoryFiles) !== JSON.stringify(conversionFiles))
    throw new Error('Migration fixture scaffold trees differ');
  for (const path of inventoryFiles) {
    if (
      !(await readFile(join(migration, path))).equals(
        await readFile(join(conversion, path)),
      )
    )
      throw new Error(`Migration scaffold differs: ${path}`);
  }
  const hashes = [];
  for (const input of ['src/SearchPanel.tsx', 'src/search.ts']) {
    for (const project of [migration, conversion]) {
      hashes.push(`${await sha256(join(project, input))}  ${project}/${input}`);
    }
  }
  await writeFile(
    join(trialRoot, 'migration-baseline.sha256'),
    `${hashes.join('\n')}\n`,
  );
  return {
    trialRoot,
    projects: {
      onboarding,
      migrationInventory: migration,
      migrationConversion: conversion,
      modeling: join(trialRoot, 'modeling'),
      debugging: join(trialRoot, 'debugging'),
    },
    migrationBaselineSha256: join(trialRoot, 'migration-baseline.sha256'),
  };
}

export async function configureProject(project, vendorDir) {
  const manifestPath = join(project, 'package.json');
  const packageJson = JSON.parse(await readFile(manifestPath, 'utf8'));
  const sdkDeps = Object.fromEntries(
    sdkPackages.map((name) => [
      `@maelstrom-co/${name}`,
      `file:./vendor/maelstrom-co-${name}-${sdkVersion}.tgz`,
    ]),
  );
  Object.assign(packageJson.dependencies, sdkDeps);
  const pinned = {
    react: '19.2.8',
    'react-dom': '19.2.8',
    '@tanstack/react-store': '0.9.3',
    '@tanstack/store': '0.9.3',
    '@types/react': '19.2.18',
    '@types/react-dom': '19.2.4',
    '@vitejs/plugin-react': '5.2.0',
    typescript: '5.9.3',
    vite: '8.2.1',
    '@testing-library/react': '16.3.2',
    '@testing-library/dom': '10.4.1',
    '@testing-library/jest-dom': '6.9.1',
    jsdom: '27.3.0',
    vitest: '4.1.9',
  };
  for (const [name, version] of Object.entries(pinned)) {
    if (Object.hasOwn(packageJson.dependencies, name)) {
      packageJson.dependencies[name] = version;
    } else {
      packageJson.devDependencies ??= {};
      packageJson.devDependencies[name] = version;
    }
  }
  packageJson.overrides = sdkDeps;
  for (const name of sdkPackages) {
    const archive = join(vendorDir, `maelstrom-co-${name}-${sdkVersion}.tgz`);
    try {
      await readFile(archive);
    } catch {
      throw new Error(`Missing local SDK tarball ${name}`);
    }
  }
  await writeFile(manifestPath, `${JSON.stringify(packageJson, null, 2)}\n`);
}

async function runProject(trialRoot, projectName) {
  const project = join(trialRoot, projectName);
  const vendor = join(trialRoot, 'vendor');
  await mkdir(join(project, 'vendor'), { recursive: true });
  await cp(vendor, join(project, 'vendor'), { recursive: true });
  await configureProject(project, vendor);
  await run('bun', ['install'], { cwd: project });
  await run('bun', ['run', 'typecheck'], { cwd: project });
  await run('bun', ['run', '.trial/sdk-runtime.ts'], { cwd: project });
  await run('bun', ['run', 'build'], { cwd: project });
  if (projectName !== 'onboarding')
    await run('bun', ['run', 'test'], { cwd: project });
  const check = `const fs = require('node:fs'); const path = require('node:path'); for (const name of ${JSON.stringify(sdkPackages.map((name) => `@maelstrom-co/${name}`))}) { const manifestPath = require.resolve(name + '/package.json'); const relative = path.relative(process.cwd(), manifestPath); if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(name + ' resolved outside this scratch project'); const version = JSON.parse(fs.readFileSync(manifestPath, 'utf8')).version; if (version !== '${sdkVersion}') throw new Error(name + ' resolved ' + version + ', expected local workspace ${sdkVersion}'); console.log(name + '=' + version + ' (' + manifestPath + ')'); }`;
  await run('node', ['-e', check], { cwd: project });
}

async function sha256(file) {
  return createHash('sha256')
    .update(await readFile(file))
    .digest('hex');
}

async function treeFiles(root) {
  const files = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) files.push(...(await treeFiles(path)));
    else files.push(path);
  }
  return files;
}

async function verifyMigrationPair(trialRoot) {
  const projects = ['migration-inventory', 'migration-conversion'].map((name) =>
    join(trialRoot, name),
  );
  const inputs = ['src/SearchPanel.tsx', 'src/search.ts'];
  const hashes = [];
  for (const input of inputs) {
    const files = await Promise.all(
      projects.map((project) => readFile(join(project, input))),
    );
    if (!files[0].equals(files[1]))
      throw new Error(`Migration baseline differs: ${input}`);
    for (let i = 0; i < projects.length; i++)
      hashes.push(
        `${await sha256(join(projects[i], input))}  ${projects[i]}/${input}`,
      );
  }
  await writeFile(
    join(trialRoot, 'migration-baseline.sha256'),
    `${hashes.join('\n')}\n`,
  );
  const ignored = new Set(['node_modules', 'vendor', 'dist']);
  const files = await Promise.all(projects.map(treeFiles));
  const normalize = (project, list) =>
    list
      .map((file) => file.slice(project.length + 1))
      .filter((path) => !path.split('/').some((part) => ignored.has(part)))
      .sort();
  const left = normalize(projects[0], files[0]);
  const right = normalize(projects[1], files[1]);
  if (JSON.stringify(left) !== JSON.stringify(right))
    throw new Error('Migration fixture scaffold trees differ');
  for (const relative of left) {
    if (
      !(await readFile(join(projects[0], relative))).equals(
        await readFile(join(projects[1], relative)),
      )
    )
      throw new Error(`Migration scaffold differs: ${relative}`);
  }
}

export async function prepareTrials(rootArg, parentArg = tmpdir()) {
  if (!rootArg)
    throw new Error(
      'Usage: node apps/docs/prompts/acceptance/prepare-trials.mjs WORKSPACE_ROOT [TEMP_PARENT]',
    );
  const root = await realpath(resolve(rootArg));
  const requestedParent = resolve(parentArg);
  await mkdir(requestedParent, { recursive: true });
  const parent = await realpath(requestedParent);
  const parentFromRoot = relative(root, parent);
  if (
    parentFromRoot === '' ||
    (parentFromRoot !== '..' &&
      !parentFromRoot.startsWith(`..${sep}`) &&
      !isAbsolute(parentFromRoot))
  ) {
    throw new Error('TEMP_PARENT must be outside the workspace checkout');
  }
  const { mkdtemp } = await import('node:fs/promises');
  const trialRoot = await mkdtemp(
    join(parent, 'maelstrom-coding-agent-trials.'),
  );
  console.log(`TRIAL_ROOT=${trialRoot}`);
  for (const packageName of sdkPackages)
    await packSdk(root, trialRoot, packageName);
  await prepareFixtures(root, trialRoot);
  for (const project of [
    'onboarding',
    'migration-inventory',
    'migration-conversion',
  ])
    await runProject(trialRoot, project);
  await verifyMigrationPair(trialRoot);
  const onboarding = join(trialRoot, 'onboarding');
  await writeFile(
    join(trialRoot, 'runtime-versions.txt'),
    await run(
      'bun',
      [
        '-e',
        'console.log("react="+require("react/package.json").version+" react-dom="+require("react-dom/package.json").version+" SDK="+require("@maelstrom-co/react/package.json").version)',
      ],
      { cwd: onboarding },
    ),
  );
  for (const project of [
    'onboarding',
    'migration-inventory',
    'migration-conversion',
  ]) {
    const listing = await run('bun', ['pm', 'ls'], {
      cwd: join(trialRoot, project),
    });
    await writeFile(
      join(trialRoot, 'runtime-versions.txt'),
      `${await readFile(join(trialRoot, 'runtime-versions.txt'), 'utf8')}\n${listing}\n`,
    );
  }
  const sdkChecksums = [];
  for (const name of sdkPackages)
    for (const file of ['package.json', 'src/index.ts', 'dist/index.js']) {
      const absolute = join(root, 'packages', name, file);
      sdkChecksums.push(`${await sha256(absolute)}  ${absolute}`);
    }
  await writeFile(
    join(trialRoot, 'sdk-source-checksums.sha256'),
    `${sdkChecksums.join('\n')}\n`,
  );
  const revision = await run('jj', [
    '-R',
    root,
    'log',
    '--no-graph',
    '-r',
    '@-',
    '-T',
    'commit_id',
  ]);
  await writeFile(
    join(trialRoot, 'workspace-source-revision.txt'),
    `${revision}\n`,
  );
  console.log(`WORKSPACE_SOURCE_REVISION=${revision}`);
  console.log(
    `MODEL_FIXTURE=${join(trialRoot, 'modeling/src/Queue.tsx')} DEBUG_REPORT=${join(trialRoot, 'debugging/report.md')}`,
  );
  console.log(
    await readFile(join(trialRoot, 'migration-baseline.sha256'), 'utf8'),
  );
  console.log(await readFile(join(trialRoot, 'runtime-versions.txt'), 'utf8'));
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  prepareTrials(process.argv[2], process.argv[3]).catch((error) => {
    console.error(error instanceof Error ? error.stack : error);
    process.exitCode = 1;
  });
}
